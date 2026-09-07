/**
 * Abordagem fria sai por MODELO APROVADO — nunca por texto livre.
 *
 * ─── A PEÇA QUE FALTAVA, medida em 07/09/2026 ───────────────────────────────
 * O canal de vendas só sabia montar `type: "text"` (`FoocciSalesChannel.ts`,
 * antes deste conserto). Texto livre só é entregue DENTRO da janela de 24 horas
 * depois de a pessoa escrever para a gente. **Abordagem fria é, por definição,
 * fora dela** — e mandar texto livre para contato frio é o que derruba o número
 * no WhatsApp oficial.
 *
 * O construtor de modelo já existia na casa (`metaPayload.ts:60`, comentado como
 * *"business-initiated / outside 24h"*) e este canal **nunca o importava**. Era
 * a peça que faltava entre "a lista está carregada" e "a primeira mensagem sai".
 *
 * ─── E AS DUAS VARIÁVEIS QUE NINGUÉM LIA ────────────────────────────────────
 * `FOOCCI_SDR_MODELO_ABORDAGEM` e `FOOCCI_SDR_MODELO_IDIOMA` estão na produção
 * e **não apareciam em nenhum arquivo do repositório**. Quem as salvou acreditou
 * ter configurado o texto aprovado; não tinha configurado nada, e não havia erro
 * nem log dizendo isso. Agora são elas que mandam — e a ausência delas RECUSA.
 *
 * ─── O QUE ESTE ARQUIVO MEDE ────────────────────────────────────────────────
 * O **corpo HTTP que sai para a Graph API** — não a função que o monta. É o que
 * a Meta recebe, e é o que decide se a mensagem é entregue ou se o número é
 * marcado.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/services/whatsapp/metaFlag", () => ({
  metaGraphUrl: (caminho: string) => `https://graph.facebook.com/v21.0/${caminho}`,
}));

import { enviarModeloDeVendas, enviarTextoDeVendas } from "./FoocciSalesChannel";
import type { LeadSafetyDecision } from "./LeadContactSafety";

const APROVADO = { sendable: true } as LeadSafetyDecision;
const REPROVADO = { sendable: false, reason: "PEDIU_SILENCIO" } as unknown as LeadSafetyDecision;

const TELEFONE = "11943723316";

const guardado = { ...process.env };

function corpoEnviado(): Record<string, unknown> {
  const chamada = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
  return JSON.parse((chamada[1] as { body: string }).body);
}

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.FOOCCI_SALES_PHONE_NUMBER_ID = "123456";
  process.env.FOOCCI_SALES_ACCESS_TOKEN = "token-de-teste";
  process.env.FOOCCI_SDR_SEND_ENABLED = "true";
  process.env.FOOCCI_SDR_MODELO_ABORDAGEM = "foocci_abordagem_v1";
  delete process.env.FOOCCI_SDR_MODELO_IDIOMA;
  delete process.env.FOOCCI_SALES_PROVIDER;

  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as never;
});

afterEach(() => {
  process.env = { ...guardado };
});

describe("o corpo que a Meta recebe", () => {
  it("⭐ é um MODELO, com o nome e o idioma do ambiente", async () => {
    const r = await enviarModeloDeVendas(APROVADO, TELEFONE, ["Dona Ana", "Marmitaria Divino Sabor"]);

    expect(r.ok).toBe(true);
    const corpo = corpoEnviado() as {
      type: string;
      template: { name: string; language: { code: string }; components?: unknown[] };
    };

    expect(corpo.type, "mandou texto livre para contato frio").toBe("template");
    expect(corpo.template.name).toBe("foocci_abordagem_v1");
    expect(corpo.template.language.code).toBe("pt_BR");
    expect(corpo.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Dona Ana" }, { type: "text", text: "Marmitaria Divino Sabor" }] },
    ]);
  });

  it("o idioma do ambiente vence o padrão", async () => {
    process.env.FOOCCI_SDR_MODELO_IDIOMA = "pt_PT";
    await enviarModeloDeVendas(APROVADO, TELEFONE);
    const corpo = corpoEnviado() as { template: { language: { code: string } } };
    expect(corpo.template.language.code).toBe("pt_PT");
  });

  it("modelo sem parâmetro não manda componente vazio", async () => {
    await enviarModeloDeVendas(APROVADO, TELEFONE);
    const corpo = corpoEnviado() as { template: { components?: unknown } };
    expect(corpo.template.components).toBeUndefined();
  });

  it("⭐ REGRESSÃO: o envio de texto continua sendo texto", async () => {
    await enviarTextoDeVendas(APROVADO, TELEFONE, "oi, tudo bem?");
    const corpo = corpoEnviado() as { type: string; text: { body: string } };
    expect(corpo.type).toBe("text");
    expect(corpo.text.body).toBe("oi, tudo bem?");
  });
});

describe("sem o modelo configurado, ninguém é abordado", () => {
  it("⭐ recusa, e o erro NOMEIA a variável que falta", async () => {
    delete process.env.FOOCCI_SDR_MODELO_ABORDAGEM;

    const r = await enviarModeloDeVendas(APROVADO, TELEFONE);

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("FOOCCI_SDR_MODELO_ABORDAGEM");
    expect(globalThis.fetch, "bateu na Meta sem ter modelo").not.toHaveBeenCalled();
  });

  it("nome só com espaço em branco conta como ausente", async () => {
    process.env.FOOCCI_SDR_MODELO_ABORDAGEM = "   ";
    const r = await enviarModeloDeVendas(APROVADO, TELEFONE);
    expect(r.ok).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("os portões que já existiam valem igual para o modelo", () => {
  it("⭐ portão do lead reprovado: não sai, e nem chega a olhar o modelo", async () => {
    const r = await enviarModeloDeVendas(REPROVADO, TELEFONE);

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("portão do lead reprovou");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("envio desligado: não sai", async () => {
    process.env.FOOCCI_SDR_SEND_ENABLED = "false";
    const r = await enviarModeloDeVendas(APROVADO, TELEFONE);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("FOOCCI_SDR_SEND_ENABLED");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("canal sem chave: não sai", async () => {
    delete process.env.FOOCCI_SALES_ACCESS_TOKEN;
    const r = await enviarModeloDeVendas(APROVADO, TELEFONE);
    expect(r.ok).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("telefone inválido: não sai", async () => {
    const r = await enviarModeloDeVendas(APROVADO, "123");
    expect(r.ok).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("⭐ a ORDEM das recusas não mudou: o portão do lead vem antes do envio desligado", async () => {
    // As duas condições falham ao mesmo tempo; a mensagem diz qual venceu.
    process.env.FOOCCI_SDR_SEND_ENABLED = "false";
    const r = await enviarModeloDeVendas(REPROVADO, TELEFONE);
    expect(r.ok === false && r.error).toContain("portão do lead reprovou");
  });
});

describe("quando a Meta recusa", () => {
  it("o erro dela volta mascarado, e não como sucesso", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "template name does not exist" } }), { status: 400 }),
    ) as never;

    const r = await enviarModeloDeVendas(APROVADO, TELEFONE);

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error.length).toBeGreaterThan(0);
  });
});
