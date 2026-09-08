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

const credenciais = vi.hoisted(() => ({ getResolved: vi.fn() }));
vi.mock("@/services/meta/MetaAppCredentialsService", () => ({
  MetaAppCredentialsService: credenciais,
}));

import { conferirModeloDeAbordagem, listarModelosDeVendas, preVooDoModelo } from "./modelosDaMeta";

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
  credenciais.getResolved.mockResolvedValue({ appId: "app1", appSecret: "segredo" });
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

/**
 * ⭐ O PRÉ-VOO — a versão que a produção chama, com o token do ambiente.
 *
 * O caso que importa aqui é o do token AUSENTE. O caminho mudo seria devolver
 * "está tudo bem, não consegui conferir" — guardrail 1: ausência de informação
 * não é informação. A rodada sairia achando que passou pela conferência.
 */
describe("o pré-voo com o token do ambiente", () => {
  it("⭐ sem FOOCCI_SALES_ACCESS_TOKEN: reprova por `semToken`, e NÃO chama a Meta", async () => {
    delete process.env.FOOCCI_SALES_ACCESS_TOKEN;
    const rede = vi.fn();
    globalThis.fetch = rede as never;

    const r = await preVooDoModelo();

    expect(r).toEqual({
      pronto: false,
      causa: "semToken",
      detalhe: "FOOCCI_SALES_ACCESS_TOKEN não está no ambiente",
    });
    expect(rede, "tentou falar com a Meta sem credencial").not.toHaveBeenCalled();
  });

  it("com token, confere de verdade — e o token não aparece no retorno", async () => {
    process.env.FOOCCI_SALES_ACCESS_TOKEN = "segredo-do-numero";
    metaResponde([
      { name: "foocci_abordagem_v1", language: "pt_BR", status: "APPROVED", components: corpo("Olá {{1}}") },
    ]);

    const r = await preVooDoModelo();

    expect(r.pronto).toBe(true);
    expect(JSON.stringify(r), "🔒 o token vazou no retorno").not.toContain("segredo-do-numero");
  });
});

/**
 * ⭐ A CONTA LIDA DO TOKEN — o caminho que salva o pré-voo quando o número não fala.
 *
 * ── MEDIDO EM PRODUÇÃO, 08/09/2026 ──────────────────────────────────────────
 *
 * Com o token de usuário de sistema, perguntar ao número devolve
 * `(#100) Tried accessing nonexisting field (whatsapp_business_account)`.
 * O pré-voo ficava cego, seguia, e a rodada descobria o problema do modelo
 * **queimando três contatos** — exatamente o custo que ele existe para evitar.
 */
describe("achar a conta quando o número não responde", () => {
  it("⭐ cai para o `debug_token` e lê os alvos da permissão", async () => {
    globalThis.fetch = vi.fn()
      // 1ª: o número recusa, como na produção
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: { message: "(#100) Tried accessing nonexisting field (whatsapp_business_account)" } }),
        { status: 400 },
      ))
      // 2ª: o token diz quais contas ele alcança
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          granular_scopes: [
            { scope: "whatsapp_business_messaging", target_ids: ["111"] },
            { scope: "whatsapp_business_management", target_ids: ["999"] },
          ],
        },
      }), { status: 200 }))
      // 3ª: a listagem de modelos, já com a conta certa
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ name: "foocci_abordagem_v1", language: "pt_BR", status: "APPROVED", components: corpo("Olá {{1}}, tudo bem?") }],
      }), { status: 200 })) as never;

    const r = await conferirModeloDeAbordagem(TOKEN);

    expect(r.pronto, JSON.stringify(r)).toBe(true);
    const urls = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0]);
    expect(urls[2], "listou os modelos da conta errada").toContain("/999/message_templates");
  });

  it("prefere `management` a `messaging` — é a permissão que enxerga modelos", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "(#100)" } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          granular_scopes: [
            { scope: "whatsapp_business_messaging", target_ids: ["111"] },
            { scope: "whatsapp_business_management", target_ids: ["999"] },
          ],
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 })) as never;

    await listarModelosDeVendas(TOKEN);

    const urls = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0]);
    expect(urls[2]).toContain("/999/");
  });

  it("sem credencial de aplicativo, a falha continua sendo falha — não vira aprovação", async () => {
    credenciais.getResolved.mockRejectedValue(new Error("sem app"));
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "(#100) campo inexistente" } }), { status: 400 }),
    ) as never;

    const r = await conferirModeloDeAbordagem(TOKEN);

    expect(r.pronto).toBe(false);
    expect(r.pronto === false && r.causa).toBe("metaRecusou");
  });
});
