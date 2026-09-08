/**
 * A conferência do modelo, ANTES de disparar.
 *
 * Pergunta do CEO que originou isto: *"Como podemos fazer igual o Foocci, que já
 * puxa os modelos aprovados sozinho?"* — o produto já lê os modelos do
 * restaurante da Graph; a Sala não lia nenhum.
 *
 * ⭐ O que estes casos guardam é a diferença entre **recusar por uma consulta**
 * e **descobrir queimando contato**: um modelo com duas variáveis faz a Meta
 * recusar 100% dos envios, e sem esta conferência a rodada só saberia depois de
 * gastar três contatos da lista até bater o limite de recusas.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/services/whatsapp/metaFlag", () => ({
  metaGraphUrl: (c: string) => `https://graph.facebook.com/v21.0/${c}`,
}));

import { conferirModeloDeAbordagem, listarModelosDeVendas } from "./modelosDaMeta";

const TOKEN = "token-de-teste";
const guardado = { ...process.env };

/** Responde a resolução da conta e depois a lista de modelos. */
function metaResponde(modelos: unknown[], conta: unknown = { whatsapp_business_account: { id: "999" } }) {
  globalThis.fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(conta), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: modelos }), { status: 200 })) as never;
}

const corpo = (texto: string) => [{ type: "BODY", text: texto }];

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.FOOCCI_SALES_PHONE_NUMBER_ID = "123456";
  process.env.FOOCCI_SDR_MODELO_ABORDAGEM = "foocci_abordagem_v1";
  process.env.FOOCCI_SDR_MODELO_IDIOMA = "pt_BR";
});
afterEach(() => { process.env = { ...guardado }; });

describe("ler os modelos da conta do número de vendas", () => {
  it("⭐ conta as variáveis de cada modelo, com a MESMA contagem do produto", async () => {
    metaResponde([
      { name: "sem_variavel", language: "pt_BR", status: "APPROVED", components: corpo("Olá, tudo bem?") },
      { name: "uma", language: "pt_BR", status: "APPROVED", components: corpo("Olá {{1}}, tudo bem?") },
      { name: "duas", language: "pt_BR", status: "PENDING", components: corpo("Olá {{1}}, aqui é {{2}}") },
    ]);

    const r = await listarModelosDeVendas(TOKEN);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.modelos).toEqual([
      { nome: "sem_variavel", idioma: "pt_BR", status: "APPROVED", variaveis: 0 },
      { nome: "uma",          idioma: "pt_BR", status: "APPROVED", variaveis: 1 },
      { nome: "duas",         idioma: "pt_BR", status: "PENDING",  variaveis: 2 },
    ]);
  });

  it("a conta é resolvida a partir do número — não é mais uma variável para alguém errar", async () => {
    metaResponde([]);
    await listarModelosDeVendas(TOKEN);

    const primeira = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(String(primeira[0])).toContain("123456?fields=whatsapp_business_account");
  });

  it("a Meta recusando vira erro declarado, e não lista vazia", async () => {
    // Lista vazia diria "a conta não tem modelo" — que é outra coisa, e mandaria
    // procurar no lugar errado.
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "token expirado" } }), { status: 401 }),
    ) as never;

    const r = await listarModelosDeVendas(TOKEN);
    expect(r.ok).toBe(false);
  });
});

describe("⭐ a conferência antes do disparo", () => {
  it("⭐ modelo aprovado com UMA variável: pronto", async () => {
    metaResponde([{ name: "foocci_abordagem_v1", language: "pt_BR", status: "APPROVED", components: corpo("Olá {{1}}!") }]);

    const r = await conferirModeloDeAbordagem(TOKEN);

    expect(r.pronto).toBe(true);
    if (r.pronto) expect(r.modelo.variaveis).toBe(1);
  });

  it("modelo aprovado SEM variável também passa — o envio manda zero quando não há nome", async () => {
    metaResponde([{ name: "foocci_abordagem_v1", language: "pt_BR", status: "APPROVED", components: corpo("Olá!") }]);
    expect((await conferirModeloDeAbordagem(TOKEN)).pronto).toBe(true);
  });

  it("⭐ DUAS variáveis: recusa ANTES de queimar contato", async () => {
    // Sem isto, os três primeiros contatos da lista seriam gastos só para
    // descobrir o que uma consulta responde.
    metaResponde([{ name: "foocci_abordagem_v1", language: "pt_BR", status: "APPROVED", components: corpo("Olá {{1}}, aqui é {{2}}") }]);

    const r = await conferirModeloDeAbordagem(TOKEN);

    expect(r.pronto).toBe(false);
    if (!r.pronto) {
      expect(r.causa).toBe("variaveisNaoBatem");
      expect(r.detalhe).toContain("2 variáveis");
    }
  });

  it("⭐ modelo não aprovado: recusa, e o detalhe diz em que estado ele está", async () => {
    metaResponde([{ name: "foocci_abordagem_v1", language: "pt_BR", status: "REJECTED", components: corpo("Olá {{1}}!") }]);

    const r = await conferirModeloDeAbordagem(TOKEN);
    expect(r.pronto).toBe(false);
    if (!r.pronto) {
      expect(r.causa).toBe("naoAprovado");
      expect(r.detalhe).toContain("REJECTED");
    }
  });

  it("modelo que não existe na conta: recusa dizendo quantos existem", async () => {
    metaResponde([{ name: "outro_qualquer", language: "pt_BR", status: "APPROVED", components: corpo("oi") }]);

    const r = await conferirModeloDeAbordagem(TOKEN);
    expect(r.pronto).toBe(false);
    if (!r.pronto) {
      expect(r.causa).toBe("naoAchado");
      expect(r.detalhe).toContain("1 modelos");
    }
  });

  it("sem nome configurado: recusa nomeando a variável, e nem chama a Meta", async () => {
    delete process.env.FOOCCI_SDR_MODELO_ABORDAGEM;
    globalThis.fetch = vi.fn() as never;

    const r = await conferirModeloDeAbordagem(TOKEN);

    expect(r.pronto).toBe(false);
    if (!r.pronto) expect(r.detalhe).toContain("FOOCCI_SDR_MODELO_ABORDAGEM");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("⭐ idioma diferente ainda é um achado — 'não achei' mandaria procurar o modelo errado", async () => {
    metaResponde([{ name: "foocci_abordagem_v1", language: "en_US", status: "APPROVED", components: corpo("Hi {{1}}!") }]);

    const r = await conferirModeloDeAbordagem(TOKEN);

    expect(r.pronto).toBe(true);
    if (r.pronto) expect(r.modelo.idioma).toBe("en_US");
  });
});
