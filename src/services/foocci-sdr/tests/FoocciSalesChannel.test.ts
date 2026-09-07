/**
 * O canal de vendas da Foocci — as travas, e a costura do provedor.
 *
 * NENHUMA MENSAGEM REAL SAI DAQUI: o `fetch` é substituído e conta as tentativas.
 * O que este arquivo prova é o contrário do envio — que ele NÃO acontece quando
 * não deve, e que quando não acontece o motivo vem escrito.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  enviarTextoDeVendas,
  isFoocciSalesChannelConfigured,
  isFoocciSalesPhoneNumberId,
  isFoocciSdrSendEnabled,
  canalDeVendasPronto,
  describeFoocciSalesChannel,
  resolverProvedorDeVendas,
  decidirDesvioParaVendas,
} from "../FoocciSalesChannel";
import type { LeadSafetyDecision } from "../LeadContactSafety";

const APROVADO: LeadSafetyDecision = { sendable: true, reason: null, detail: "Liberado." };
const REPROVADO: LeadSafetyDecision = { sendable: false, reason: "LEAD_OPT_OUT", detail: "Pediu silêncio." };

let chamadasDeRede = 0;

function ligarCanal() {
  process.env.FOOCCI_SALES_PHONE_NUMBER_ID = "222222222222222";
  process.env.FOOCCI_SALES_ACCESS_TOKEN = "token-de-teste-nao-real";
}

beforeEach(() => {
  chamadasDeRede = 0;
  delete process.env.FOOCCI_SALES_PHONE_NUMBER_ID;
  delete process.env.FOOCCI_SALES_ACCESS_TOKEN;
  delete process.env.FOOCCI_SDR_SEND_ENABLED;
  delete process.env.FOOCCI_SALES_PROVIDER;
  vi.stubGlobal("fetch", vi.fn(async () => {
    chamadasDeRede++;
    return { ok: true, json: async () => ({}) } as unknown as Response;
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.FOOCCI_SALES_PHONE_NUMBER_ID;
  delete process.env.FOOCCI_SALES_ACCESS_TOKEN;
  delete process.env.FOOCCI_SDR_SEND_ENABLED;
  delete process.env.FOOCCI_SALES_PROVIDER;
});

describe("desligado por construção — o estado de HOJE", () => {
  it("sem credencial, o canal não existe: não reconhece o número e não envia", async () => {
    expect(isFoocciSalesChannelConfigured()).toBe(false);
    expect(isFoocciSalesPhoneNumberId("222222222222222")).toBe(false);

    const r = await enviarTextoDeVendas(APROVADO, "5511999990000", "oi");
    expect(r.ok).toBe(false);
    expect(chamadasDeRede).toBe(0);
  });

  it("meio configurado é desligado — só o número, sem token", () => {
    process.env.FOOCCI_SALES_PHONE_NUMBER_ID = "222222222222222";
    expect(isFoocciSalesChannelConfigured()).toBe(false);
  });

  it("CONFIGURADO ainda não é LIGADO — receber e enviar são chaves separadas", async () => {
    ligarCanal();
    expect(isFoocciSalesChannelConfigured()).toBe(true);   // recebe
    expect(isFoocciSdrSendEnabled()).toBe(false);          // mas não fala
    expect(canalDeVendasPronto()).toBe(false);

    const r = await enviarTextoDeVendas(APROVADO, "5511999990000", "oi");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("FOOCCI_SDR_SEND_ENABLED");
    expect(chamadasDeRede).toBe(0);
  });
});

describe("o portão é o primeiro parâmetro — não dá para enviar sem avaliar", () => {
  it("decisão reprovada não vira envio, mesmo com tudo ligado", async () => {
    ligarCanal();
    process.env.FOOCCI_SDR_SEND_ENABLED = "true";

    const r = await enviarTextoDeVendas(REPROVADO, "5511999990000", "oi");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("LEAD_OPT_OUT");
    expect(chamadasDeRede).toBe(0);
  });

  it("a outra metade: com decisão aprovada e envio ligado, a mensagem sai", async () => {
    ligarCanal();
    process.env.FOOCCI_SDR_SEND_ENABLED = "true";

    const r = await enviarTextoDeVendas(APROVADO, "5511999990000", "oi");
    expect(r.ok).toBe(true);
    expect(chamadasDeRede).toBe(1);
  });

  it("telefone inválido não vira chamada de rede", async () => {
    ligarCanal();
    process.env.FOOCCI_SDR_SEND_ENABLED = "true";
    const r = await enviarTextoDeVendas(APROVADO, "123", "oi");
    expect(r.error).toBe("telefone inválido");
    expect(chamadasDeRede).toBe(0);
  });
});

describe("a costura do provedor — trocar é configuração, e o desconhecido FALHA", () => {
  it("o padrão é a Meta homologada", () => {
    expect(resolverProvedorDeVendas()).toBe("META_CLOUD_API");
  });

  it("provedor não implementado NÃO cai na Meta em silêncio — recusa declarada", async () => {
    ligarCanal();
    process.env.FOOCCI_SDR_SEND_ENABLED = "true";
    process.env.FOOCCI_SALES_PROVIDER = "ALGUM_OUTRO";

    expect(resolverProvedorDeVendas()).toBe("NAO_SUPORTADO");
    expect(isFoocciSalesChannelConfigured()).toBe(false);

    const r = await enviarTextoDeVendas(APROVADO, "5511999990000", "oi");
    expect(r.ok).toBe(false);
    expect(chamadasDeRede).toBe(0);
  });
});

describe("diagnóstico — presença, nunca segredo", () => {
  it("não devolve o token, e o phone_number_id sai mascarado", () => {
    ligarCanal();
    const d = describeFoocciSalesChannel();
    expect(d.accessTokenSet).toBe(true);
    expect(d.phoneNumberIdMasked).toBe("…2222");
    // O segredo não aparece em campo nenhum, com nome nenhum.
    expect(JSON.stringify(d)).not.toContain("token-de-teste-nao-real");
  });
});

/**
 * ⛔⛔ O DESVIO PARA VENDAS — a trava que protege o cliente do restaurante.
 *
 * Em 06/09/2026 `FOOCCI_SALES_PHONE_NUMBER_ID` estava com o id de um número que
 * não era da Foocci. Toda mensagem que chegava ali era desviada para a caixa de
 * vendas e NUNCA chegava ao restaurante: três pessoas escreveram em 27/08, 31/08
 * e 06/09 e viraram "lead" com o próprio telefone no campo nome.
 *
 * A regra que este bloco guarda: **na dúvida, o cliente do restaurante ganha.**
 */
describe("⛔ um número não pode ser de vendas E de restaurante", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  function comCanalLigado(id: string) {
    process.env.FOOCCI_SALES_PHONE_NUMBER_ID = id;
    process.env.FOOCCI_SALES_ACCESS_TOKEN = "token-de-prova-bem-longo";
  }

  it("⭐ número de vendas que NÃO é de restaurante: desvia", () => {
    comCanalLigado("111");
    const v = decidirDesvioParaVendas({ phoneNumberId: "111", ehDeUmRestaurante: false });
    expect(v.desviar).toBe(true);
    expect(v.conflito).toBeNull();
  });

  it("⛔⛔ número de vendas que TAMBÉM é de restaurante: NÃO desvia", () => {
    comCanalLigado("111");
    const v = decidirDesvioParaVendas({ phoneNumberId: "111", ehDeUmRestaurante: true });
    // A mensagem segue para o restaurante. Prospecção perdida se recupera com
    // outra abordagem; cliente que escreveu e não foi respondido, não.
    expect(v.desviar).toBe(false);
  });

  it("⛔ e o conflito GRITA, com o id dentro", () => {
    comCanalLigado("111");
    const v = decidirDesvioParaVendas({ phoneNumberId: "111", ehDeUmRestaurante: true });
    // Sequestrar conversa em silêncio foi exatamente como o defeito viveu
    // semanas sem ninguém notar. A recusa tem de dizer o que corrigir.
    expect(v.conflito).toContain("111");
    expect(v.conflito).toContain("FOOCCI_SALES_PHONE_NUMBER_ID");
  });

  it("número de outro: não desvia, e não é conflito", () => {
    comCanalLigado("111");
    const v = decidirDesvioParaVendas({ phoneNumberId: "999", ehDeUmRestaurante: true });
    expect(v.desviar).toBe(false);
    // Número de restaurante que nunca foi de vendas é o caso NORMAL — gritar
    // aqui encheria o log de alarme falso a cada mensagem de cliente.
    expect(v.conflito).toBeNull();
  });

  it("⛔ canal desligado não desvia nada", () => {
    delete process.env.FOOCCI_SALES_PHONE_NUMBER_ID;
    delete process.env.FOOCCI_SALES_ACCESS_TOKEN;
    expect(decidirDesvioParaVendas({ phoneNumberId: "111", ehDeUmRestaurante: false }).desviar).toBe(false);
  });
});
