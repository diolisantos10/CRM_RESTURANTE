/**
 * A SINCRONIZAÇÃO DOS MODELOS DA SALA, MEDIDA.
 *
 * O que estes casos protegem, em ordem de gravidade:
 *
 *   1. **A paginação percorre a conta inteira.** O lado comercial lia UMA
 *      página (`limit=200`) e chamava aquilo de "os modelos da conta". Numa
 *      conta grande, o modelo em uso podia estar na página dois — e a busca
 *      diria, com toda a confiança, que ele não existe.
 *   2. **A contagem de variáveis vem do CORPO REAL.** Era digitada à mão numa
 *      variável de ambiente. Número digitado envelhece; corpo lido, não.
 *   3. **`MISSING` só em varredura completa.** Rebaixar por leitura truncada
 *      apagaria um modelo bom e travaria a abordagem — meia-leitura não é
 *      informação (guardrail 1).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/services/whatsapp/metaFlag", () => ({
  metaGraphUrl: (c: string) => `https://graph.facebook.com/v21.0/${c}`,
}));

const credenciais = vi.hoisted(() => ({ getResolved: vi.fn() }));
vi.mock("@/services/meta/MetaAppCredentialsService", () => ({
  MetaAppCredentialsService: credenciais,
}));

import { sincronizarComToken, corpoDoModelo } from "../sincronizarModelos";

const TOKEN = "token-de-teste";
const NUMERO = "000000000000001";
const guardado = { ...process.env };

const corpo = (texto: string) => [{ type: "BODY", text: texto }];

/**
 * Um banco de mentira que GUARDA o que recebeu.
 *
 * Guardar, e não só contar: o que estes casos precisam provar é o CONTEÚDO do
 * upsert (a contagem de variáveis, o corpo, a conta) — um espião que só diz
 * "foi chamado 3 vezes" passaria com o número errado gravado.
 */
function banco(aprovadosNoBanco: Array<{ id: string; nome: string; idioma: string }> = []) {
  const gravados: Array<Record<string, unknown>> = [];
  const rebaixados: Array<Record<string, unknown>> = [];

  return {
    gravados,
    rebaixados,
    db: {
      modeloDeVendas: {
        upsert: async (args: { create: Record<string, unknown> }) => {
          gravados.push(args.create);
          return {};
        },
        findMany: async () => aprovadosNoBanco,
        updateMany: async (args: { where: unknown; data: unknown }) => {
          rebaixados.push({ where: args.where, data: args.data });
          return { count: 1 };
        },
      },
    } as never,
  };
}

/** A conta resolve pelo próprio número, e depois vêm as páginas de modelos. */
function metaResponde(...paginas: unknown[]) {
  const f = vi.fn();
  f.mockResolvedValueOnce(
    new Response(JSON.stringify({ whatsapp_business_account: { id: "999" } }), { status: 200 }),
  );
  for (const p of paginas) {
    f.mockResolvedValueOnce(new Response(JSON.stringify(p), { status: 200 }));
  }
  globalThis.fetch = f as never;
  return f;
}

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.FOOCCI_SALES_PHONE_NUMBER_ID = NUMERO;
  process.env.FOOCCI_SALES_PROVIDER = "META_CLOUD_API";
  credenciais.getResolved.mockResolvedValue({ appId: "app1", appSecret: "segredo" });
});
afterEach(() => {
  process.env = { ...guardado };
});

describe("a varredura percorre a conta inteira", () => {
  it("⭐ segue `paging.next` para a segunda página — o modelo da página 2 é gravado", async () => {
    // ── O DEFEITO QUE ESTE CASO GUARDA ──
    // Uma página só, e o modelo em uso mora na dois: a busca respondia "não
    // está entre os N modelos da conta" sobre um modelo que existe, aprovado,
    // e mandava alguém procurar no lugar errado.
    const f = metaResponde(
      {
        data: [{ name: "pagina_um", language: "pt_BR", status: "APPROVED", components: corpo("Olá {{1}}") }],
        paging: { next: "https://graph.facebook.com/v21.0/999/message_templates?after=CURSOR" },
      },
      {
        data: [{ name: "pagina_dois", language: "pt_BR", status: "APPROVED", components: corpo("Oi") }],
      },
    );

    const b = banco();
    const r = await sincronizarComToken(b.db, TOKEN);

    expect(r.ok).toBe(true);
    expect(r.sincronizados).toBe(2);
    expect(r.completa).toBe(true);
    expect(b.gravados.map((g) => g.nome)).toEqual(["pagina_um", "pagina_dois"]);

    // ⚠️ O endereço da segunda chamada tem de ser o `paging.next` LITERAL. A
    // Meta põe o cursor dentro dele; remontar o caminho perderia o cursor e a
    // varredura releria a primeira página para sempre, sem nunca dizer que
    // travou.
    expect(String(f.mock.calls[2][0])).toContain("after=CURSOR");
  });

  it("erro no meio da paginação devolve falha declarada, e não sucesso parcial", async () => {
    const f = vi.fn();
    f.mockResolvedValueOnce(
      new Response(JSON.stringify({ whatsapp_business_account: { id: "999" } }), { status: 200 }),
    );
    f.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ name: "um", language: "pt_BR", status: "APPROVED", components: corpo("Oi") }],
          paging: { next: "https://graph.facebook.com/v21.0/999/message_templates?after=X" },
        }),
        { status: 200 },
      ),
    );
    f.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "token expirado" } }), { status: 401 }),
    );
    globalThis.fetch = f as never;

    const b = banco();
    const r = await sincronizarComToken(b.db, TOKEN);

    expect(r.ok).toBe(false);
    expect(r.completa).toBe(false);
    expect(r.erro).toContain("token expirado");
    // O que já foi gravado vale — é o que a Meta confirmou. O que não foi lido
    // continua sem opinião nossa.
    expect(r.sincronizados).toBe(1);
  });
});

describe("as variáveis vêm do corpo real, e não de alguém digitando", () => {
  it("⭐ conta `{{n}}` do corpo aprovado e grava o número junto do texto", async () => {
    metaResponde({
      data: [
        { name: "sem_variavel", language: "pt_BR", status: "APPROVED", components: corpo("Olá, tudo bem?") },
        { name: "uma", language: "pt_BR", status: "APPROVED", components: corpo("Olá {{1}}, tudo bem?") },
        { name: "duas", language: "pt_BR", status: "PENDING", components: corpo("Olá {{1}}, aqui é {{2}}") },
      ],
    });

    const b = banco();
    await sincronizarComToken(b.db, TOKEN);

    expect(b.gravados.map((g) => [g.nome, g.variaveis])).toEqual([
      ["sem_variavel", 0],
      ["uma", 1],
      ["duas", 2],
    ]);

    // O corpo é gravado porque a tela precisa mostrar o que o lead vai receber.
    // Nome de modelo não é frase.
    expect(b.gravados[1].corpo).toBe("Olá {{1}}, tudo bem?");
    // E a conta de origem fica carimbada: linha sem conta não prova de onde veio.
    expect(b.gravados[1].wabaId).toBe("999");
    expect(b.gravados[1].phoneNumberId).toBe(NUMERO);
  });

  it("`corpoDoModelo` ignora cabeçalho e rodapé — só o BODY é a mensagem", () => {
    const componentes = [
      { type: "HEADER", text: "Foocci" },
      { type: "BODY", text: "Olá {{1}}, posso te mostrar em 2 minutos?" },
      { type: "FOOTER", text: "Responda SAIR para não receber mais" },
    ];
    expect(corpoDoModelo(componentes)).toBe("Olá {{1}}, posso te mostrar em 2 minutos?");
  });
});

describe("⛔ MISSING só em varredura COMPLETA", () => {
  it("⭐ modelo aprovado que sumiu da Meta é rebaixado quando a varredura terminou", async () => {
    metaResponde({ data: [{ name: "vivo", language: "pt_BR", status: "APPROVED", components: corpo("Oi") }] });

    const b = banco([
      { id: "m1", nome: "vivo", idioma: "pt_BR" },
      { id: "m2", nome: "fantasma", idioma: "pt_BR" },
    ]);
    const r = await sincronizarComToken(b.db, TOKEN);

    expect(r.completa).toBe(true);
    expect(r.sumiram).toBe(1);
    // Só o fantasma. Rebaixar o que a Meta acabou de confirmar seria pior que
    // não rebaixar nada.
    expect(b.rebaixados[0]).toEqual({
      where: { id: { in: ["m2"] } },
      data: { situacao: "MISSING" },
    });
  });

  it("⛔ SONDA DE CONTROLE: varredura truncada NÃO rebaixa ninguém", async () => {
    // Onze páginas contra um teto de dez: a décima ainda aponta para a próxima,
    // e o que não foi lido NÃO pode virar "não existe na Meta". Sem esta trava,
    // uma conta grande veria modelos bons virarem MISSING e a abordagem travar.
    const paginas = Array.from({ length: 11 }, (_, i) => ({
      data: [{ name: `m${i}`, language: "pt_BR", status: "APPROVED", components: corpo("Oi") }],
      paging: { next: `https://graph.facebook.com/v21.0/999/message_templates?after=P${i}` },
    }));
    metaResponde(...paginas);

    const b = banco([{ id: "m1", nome: "fantasma", idioma: "pt_BR" }]);
    const r = await sincronizarComToken(b.db, TOKEN);

    expect(r.ok).toBe(true);
    expect(r.completa).toBe(false);
    expect(r.sumiram).toBe(0);
    expect(b.rebaixados).toHaveLength(0);
  });
});

describe("o que NÃO vira sucesso silencioso", () => {
  it("conta não resolvida devolve o motivo, e não uma lista vazia", async () => {
    // Lista vazia diria "a conta não tem modelo" — outra coisa, e mandaria
    // procurar no lugar errado.
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "(#100) campo inexistente" } }), { status: 400 }),
    ) as never;
    credenciais.getResolved.mockResolvedValue(null);

    const b = banco();
    const r = await sincronizarComToken(b.db, TOKEN);

    expect(r.ok).toBe(false);
    expect(r.sincronizados).toBe(0);
    expect(r.erro).toBeTruthy();
    expect(b.gravados).toHaveLength(0);
  });

  it("sem o número de vendas no ambiente, recusa antes de bater na Meta", async () => {
    delete process.env.FOOCCI_SALES_PHONE_NUMBER_ID;
    const f = vi.fn();
    globalThis.fetch = f as never;

    const b = banco();
    const r = await sincronizarComToken(b.db, TOKEN);

    expect(r.ok).toBe(false);
    expect(r.erro).toContain("FOOCCI_SALES_PHONE_NUMBER_ID");
    expect(f).not.toHaveBeenCalled();
  });
});
