/**
 * A JORNADA DO FUNIL POR MODELO, CONTRA POSTGRES DE VERDADE — redesenho da
 * prospecção automática e minimalista, 12/09/2026 (item 3 do pedido do CEO).
 *
 * ── O QUE ELA PROVA ──────────────────────────────────────────────────────────
 *
 * `funilPorModelo` (`funilDoModelo.ts`) agrupa `LeadMensagem` por
 * `templateNome` e devolve, por modelo: tentativas, enviados, entregues,
 * lidos, falharam, respondidos, opt-out e "com resposta positiva" — tudo lido
 * dos campos que já existem (`LeadMensagem.status`/`direcao`,
 * `SiteLead.optOutAt`/`stage`), nunca uma segunda fonte de verdade.
 *
 * ⚠️ NADA AQUI FALA COM A META: dados sintéticos, leitura pura.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { funilPorModelo } from "@/services/foocci-sdr/funilDoModelo";

const TEMPLATE = "JORNADA_FUNIL_PROBE";

beforeAll(async () => {
  await prisma.leadMensagem.deleteMany({ where: { templateNome: TEMPLATE } });
  await prisma.siteLead.deleteMany({ where: { whatsappDigits: { startsWith: "5511900000" } } });
});

afterAll(async () => {
  await prisma.leadMensagem.deleteMany({ where: { templateNome: TEMPLATE } });
  await prisma.siteLead.deleteMany({ where: { whatsappDigits: { startsWith: "5511900000" } } });
  await prisma.$disconnect();
});

describe("Jornada — funilPorModelo agrupa por template, lendo dos campos que já existem", () => {
  it("⭐ tentativas, enviados, entregues, lidos, falharam, respondidos, opt-out e resposta positiva — cada um do fato certo", async () => {
    // l1: recebeu, LEU, RESPONDEU, e a conversa avançou até QUALIFICADO — a
    // "resposta positiva" do cabeçalho de `funilDoModelo.ts`.
    const l1 = await prisma.siteLead.create({
      data: {
        nome: "Respondeu e qualificou",
        whatsapp: "11900000001",
        whatsappDigits: "5511900000001",
        fonte: "LISTA_PROSPECCAO",
        stage: "QUALIFICADO",
      },
    });
    // l2: recebeu (ENTREGUE), pediu silêncio depois — nunca respondeu.
    const l2 = await prisma.siteLead.create({
      data: {
        nome: "Pediu silêncio",
        whatsapp: "11900000002",
        whatsappDigits: "5511900000002",
        fonte: "LISTA_PROSPECCAO",
        optOutAt: new Date(),
      },
    });
    // l3: a Meta recusou o envio — falha pura, sem entrega nem resposta.
    const l3 = await prisma.siteLead.create({
      data: { nome: "Falhou", whatsapp: "11900000003", whatsappDigits: "5511900000003", fonte: "LISTA_PROSPECCAO" },
    });
    // l4: respondeu, mas o `stage` NUNCA avançou de RESPONDEU — conta como
    // "respondido", nunca como "resposta positiva" (ver o cabeçalho do arquivo).
    const l4 = await prisma.siteLead.create({
      data: {
        nome: "Respondeu só 'quem é vc'",
        whatsapp: "11900000004",
        whatsappDigits: "5511900000004",
        fonte: "LISTA_PROSPECCAO",
        stage: "RESPONDEU",
      },
    });

    await prisma.leadMensagem.createMany({
      data: [
        { leadId: l1.id, direcao: "SAIDA", tipo: "TEMPLATE", status: "LIDA", templateNome: TEMPLATE, ocorreuEm: new Date() },
        { leadId: l2.id, direcao: "SAIDA", tipo: "TEMPLATE", status: "ENTREGUE", templateNome: TEMPLATE, ocorreuEm: new Date() },
        { leadId: l3.id, direcao: "SAIDA", tipo: "TEMPLATE", status: "FALHOU", templateNome: TEMPLATE, ocorreuEm: new Date() },
        { leadId: l4.id, direcao: "SAIDA", tipo: "TEMPLATE", status: "ENVIADA", templateNome: TEMPLATE, ocorreuEm: new Date() },
      ],
    });
    await prisma.leadMensagem.createMany({
      data: [
        { leadId: l1.id, direcao: "ENTRADA", tipo: "TEXTO", status: "RECEBIDA", ocorreuEm: new Date() },
        { leadId: l4.id, direcao: "ENTRADA", tipo: "TEXTO", status: "RECEBIDA", ocorreuEm: new Date() },
      ],
    });

    const funil = await funilPorModelo(prisma);
    const linha = funil.find((f) => f.templateNome === TEMPLATE);

    expect(linha).toBeDefined();
    expect(linha).toMatchObject({
      tentativas: 4,
      enviados: 3, // LIDA + ENTREGUE + ENVIADA — não conta o FALHOU
      entregues: 2, // ENTREGUE + LIDA
      lidos: 1,
      falharam: 1,
      respondidos: 2, // l1 e l4
      comRespostaPositiva: 1, // só l1 — l4 respondeu mas ficou em RESPONDEU
      optOut: 1, // l2
    });
  });

  it("modelo sem NENHUM envio não aparece na lista — nunca uma linha de zeros inventada", async () => {
    const funil = await funilPorModelo(prisma);
    expect(funil.some((f) => f.templateNome === "MODELO_QUE_NUNCA_ENVIOU_NADA")).toBe(false);
  });
});
