/**
 * ⛔ O IDENTIFICADOR REAL DA META — P0.1, 10/09/2026.
 *
 * A resposta de sucesso da Graph API era descartada: a chamada devolvia
 * `{ ok: true }` e `abordarLead` gravava `local:<mensagemId>` — um id que a
 * Meta nunca viu. Os eventos `sent`, `delivered`, `read` e `failed` chegam
 * carregando o `wamid` DELA e não casavam com linha nenhuma.
 *
 * A tela não estava faltando. A CHAVE estava.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { enviarModeloDeVendas, idDaMensagemNaResposta } from "../FoocciSalesChannel";
import type { LeadSafetyDecision } from "../LeadContactSafety";

const APROVADO: LeadSafetyDecision = { sendable: true, reason: null, detail: "teste" };
const MODELO = { nome: "foocci_abordagem_inicial", idioma: "pt_BR", parametros: ["Marina"] };
const WAMID = "wamid.HBgNNTUxMTk5OTk4ODg4RQIAERgSN0EyM0Y0";

const ambiente = { ...process.env };

function ligarTudo() {
  process.env.FOOCCI_SALES_PHONE_NUMBER_ID = "000000000000001";
  process.env.FOOCCI_SALES_ACCESS_TOKEN = "EAAtoken-de-teste";
  process.env.FOOCCI_SDR_SEND_ENABLED = "true";
  process.env.FOOCCI_SALES_PROVIDER = "META_CLOUD_API";
}

function respondendo(corpo: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status: ok ? 200 : 400, json: async () => corpo }) as never),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(process.env)) if (k.startsWith("FOOCCI_S")) delete process.env[k];
  ligarTudo();
});
afterEach(() => {
  process.env = { ...ambiente };
});

describe("a leitura do wamid", () => {
  it("⭐ lê messages[0].id da resposta de sucesso", () => {
    expect(idDaMensagemNaResposta({ messages: [{ id: WAMID }] })).toBe(WAMID);
  });

  it("devolve null para toda forma de ausência", () => {
    for (const j of [null, {}, { messages: [] }, { messages: [{}] }, { messages: [{ id: "" }] }, { messages: "x" }]) {
      expect(idDaMensagemNaResposta(j), JSON.stringify(j)).toBeNull();
    }
  });
});

describe("o envio", () => {
  it("⭐ sucesso devolve o wamid REAL, e não um id nosso", async () => {
    respondendo({ messages: [{ id: WAMID }] });
    const r = await enviarModeloDeVendas(APROVADO, "+5511999998888", MODELO);

    expect(r.ok).toBe(true);
    expect(r.providerMessageId).toBe(WAMID);
    expect(r.providerMessageId).not.toContain("local:");
  });

  it("⛔ 200 SEM id NÃO é sucesso", async () => {
    // Sem o id, o status nunca casa: a mensagem ficaria ENVIADA para sempre,
    // sem entregue, sem lida e — o pior — sem falhou.
    respondendo({ messages: [] });
    const r = await enviarModeloDeVendas(APROVADO, "+5511999998888", MODELO);

    expect(r.ok).toBe(false);
    expect(r.error).toContain("sem id de mensagem");
    expect(r.providerMessageId).toBeUndefined();
  });

  it("sonda de controle: a recusa da Meta continua vindo com o motivo dela", async () => {
    // Sem esta cena, a trava nova poderia estar engolindo o erro real da Meta
    // e devolvendo sempre "sem id".
    respondendo({ error: { message: "Template name does not exist" } }, false);
    const r = await enviarModeloDeVendas(APROVADO, "+5511999998888", MODELO);

    expect(r.ok).toBe(false);
    expect(r.error).toContain("Template name does not exist");
  });
});
