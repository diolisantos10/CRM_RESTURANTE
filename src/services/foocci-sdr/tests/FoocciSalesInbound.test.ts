/**
 * A RECEPÇÃO do número de vendas — o "oi" que hoje seria descartado.
 *
 * O que estes casos protegem, em uma frase: no dia em que o número existir, a
 * mensagem que o site pede para a pessoa mandar **tem que chegar em algum lugar**.
 * Até 14/08 ela cairia no `if (!cfg)` do webhook da Meta
 * (`src/app/api/webhooks/meta/whatsapp/route.ts`) — um `console.warn` e o descarte.
 *
 * Nenhum banco real é tocado, nenhuma mensagem é enviada.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  siteLead: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  siteLeadInteraction: { create: vi.fn() },
  // A recepção abre transação para declarar a identidade ao RLS antes de
  // gravar a entrada e antes de chamar o TA. Aqui ela só repassa.
  $transaction: vi.fn(async (trabalho: (tx: unknown) => unknown) =>
    trabalho({ $executeRaw: vi.fn() }),
  ),
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/services/whatsapp/WhatsAppMessagingService", () => ({
  WhatsAppMessagingService: { getConnectionStatus: vi.fn() },
}));

// O TA é dublê aqui de propósito: os sete portões dele têm arquivo próprio
// (`salaDeVendas/ta/atender.test.ts`). O que ESTES casos provam é a fiação —
// que o "oi" chega até ele, com o texto certo, e só quando deve.
const taMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/salaDeVendas/ta/atender", () => ({ atenderComOTA: taMock }));

import { receberMensagemDeVendas, interpretarMensagemDeVendas } from "../FoocciSalesInbound";

const AGORA = new Date("2026-08-14T15:00:00Z");

/**
 * ⏱️ A JANELA DE AGRUPAMENTO FICA EM ZERO AQUI, e é decisão, não atalho.
 *
 * Desde 10/09/2026 o turno espera alguns segundos antes de compor, para juntar
 * a rajada de mensagens curtas que o lead manda no WhatsApp (`agrupamento.ts`).
 * Em produção isso é o conserto; num teste seriam quatro segundos parados por
 * caso, e uma suíte que dorme é uma suíte que ninguém roda.
 *
 * ⚠️ O que fica em zero é a ESPERA, não a consolidação: a leitura das entradas,
 * o carimbo do turno e a volta que pega a mensagem atrasada continuam sendo
 * exercitados. Zerar o relógio não afrouxa regra nenhuma.
 */
process.env.FOOCCI_SDR_JANELA_AGRUPAMENTO_MS = "0";

beforeEach(() => {
  // Só as TABELAS. `$transaction` é uma função no topo do objeto, e varrê-la
  // como se fosse tabela quebra o laço nas propriedades internas do dublê.
  [prismaMock.siteLead, prismaMock.siteLeadInteraction].forEach((tabela) =>
    Object.values(tabela).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset()),
  );
  prismaMock.siteLeadInteraction.create.mockResolvedValue({});
  prismaMock.siteLead.update.mockResolvedValue({});
  taMock.mockReset();
  taMock.mockResolvedValue({ falou: false, chamouGente: false, motivo: "taDesligado", detalhe: "desligado" });
});

// ── A leitura pura ────────────────────────────────────────────────────────────

describe("interpretarMensagemDeVendas", () => {
  it("acha o código que o formulário colocou na mensagem", () => {
    const r = interpretarMensagemDeVendas("Oi! Sou Ana, do restaurante Bar do Zé, e quero conhecer o Foocci. #A7K2M");
    expect(r.codigo).toBe("A7K2M");
    expect(r.pedeSilencio).toBe(false);
    expect(r.temTexto).toBe(true);
  });

  it("mensagem sem código não afirma nada — só não tem código", () => {
    expect(interpretarMensagemDeVendas("oi, quanto custa?").codigo).toBeNull();
  });

  it("reconhece pedido de silêncio", () => {
    expect(interpretarMensagemDeVendas("PARAR").pedeSilencio).toBe(true);
    expect(interpretarMensagemDeVendas("não quero receber mais").pedeSilencio).toBe(true);
  });

  it("figurinha/áudio (sem texto) não vira código nem opt-out", () => {
    const r = interpretarMensagemDeVendas(null);
    expect(r).toEqual({ codigo: null, pedeSilencio: false, temTexto: false });
  });
});

// ── A recepção ────────────────────────────────────────────────────────────────

describe("quem chega com o #código do formulário", () => {
  it("é reconhecido pelo código e ganha a resposta na linha do tempo", async () => {
    prismaMock.siteLead.findUnique.mockResolvedValue({ id: "L1", codigo: "A7K2M", optOutAt: null });

    const r = await receberMensagemDeVendas({
      fromPhone: "5511999990000",
      text: "Oi! Sou Ana e quero conhecer o Foocci. #A7K2M",
      agora: AGORA,
    });

    expect(r.status).toBe("RECONHECIDO_POR_CODIGO");
    expect(r.leadId).toBe("L1");
    expect(prismaMock.siteLead.create).not.toHaveBeenCalled();
    expect(prismaMock.siteLeadInteraction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ leadId: "L1", tipo: "RESPOSTA_RECEBIDA" }) }),
    );
  });

  it("código que não existe mais cai no telefone — não vira contato duplicado", async () => {
    prismaMock.siteLead.findUnique.mockResolvedValue(null);
    prismaMock.siteLead.findFirst.mockResolvedValue({ id: "L2", codigo: "ZZZZZ", optOutAt: null });

    const r = await receberMensagemDeVendas({ fromPhone: "5511999990000", text: "oi #A7K2M", agora: AGORA });

    expect(r.status).toBe("RECONHECIDO_POR_TELEFONE");
    expect(r.leadId).toBe("L2");
    expect(prismaMock.siteLead.create).not.toHaveBeenCalled();
  });
});

describe("quem chega sem passar pelo formulário (anúncio, indicação)", () => {
  it("vira contato novo com fonte WHATSAPP_DIRETO e consentimento datado AGORA", async () => {
    prismaMock.siteLead.findFirst.mockResolvedValue(null);
    prismaMock.siteLead.create.mockResolvedValue({ id: "L3", codigo: null, optOutAt: null });

    const r = await receberMensagemDeVendas({
      fromPhone: "5511988887777",
      text: "oi, vi o anúncio de vocês",
      profileName: "João da Pizzaria",
      agora: AGORA,
    });

    expect(r.status).toBe("CONTATO_NOVO");
    const dados = prismaMock.siteLead.create.mock.calls[0]![0].data;
    expect(dados.fonte).toBe("WHATSAPP_DIRETO");
    expect(dados.nome).toBe("João da Pizzaria");
    // Escreveu primeiro: o consentimento é o próprio ato, e tem data.
    expect(dados.consentAt).toEqual(AGORA);
  });
});

describe("quem pede silêncio", () => {
  it("é registrado como opt-out, e o pedido vem ANTES de qualquer outra coisa", async () => {
    prismaMock.siteLead.findFirst.mockResolvedValue({ id: "L4", codigo: "B2C3D", optOutAt: null });

    const r = await receberMensagemDeVendas({ fromPhone: "5511999990000", text: "PARAR", agora: AGORA });

    expect(r.status).toBe("PEDIU_SILENCIO");
    expect(prismaMock.siteLead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "L4" },
        data: expect.objectContaining({ optOutAt: AGORA, optOutCanal: "whatsapp" }),
      }),
    );
  });

  it("desconhecido que manda PARE é GRAVADO — para poder honrar o silêncio depois", async () => {
    // Sem contato na base, um "PARE" não teria onde ser registrado, e a mesma
    // pessoa voltaria a ser abordada na semana seguinte.
    prismaMock.siteLead.findFirst.mockResolvedValue(null);
    prismaMock.siteLead.create.mockResolvedValue({ id: "L5", codigo: null, optOutAt: null });

    const r = await receberMensagemDeVendas({ fromPhone: "5511977776666", text: "sair", agora: AGORA });

    expect(r.status).toBe("PEDIU_SILENCIO");
    expect(prismaMock.siteLead.create).toHaveBeenCalled();
    // E não se inventa consentimento para quem chegou pedindo para sair.
    expect(prismaMock.siteLead.create.mock.calls[0]![0].data.consentAt).toBeNull();
  });

  it("opt-out repetido não reescreve a data original", async () => {
    const antes = new Date("2026-07-01T10:00:00Z");
    prismaMock.siteLead.findFirst.mockResolvedValue({ id: "L6", codigo: null, optOutAt: antes });

    await receberMensagemDeVendas({ fromPhone: "5511999990000", text: "parar", agora: AGORA });

    expect(prismaMock.siteLead.update.mock.calls[0]![0].data.optOutAt).toEqual(antes);
  });
});

describe("falha nunca vira sucesso silencioso", () => {
  it("banco fora do ar devolve FALHOU com o motivo, sem lançar", async () => {
    prismaMock.siteLead.findFirst.mockRejectedValue(new Error("db down"));

    const r = await receberMensagemDeVendas({ fromPhone: "5511999990000", text: "oi", agora: AGORA });

    expect(r.status).toBe("FALHOU");
    expect(r.detalhe).toContain("db down");
  });
});

// ── A FIAÇÃO: o "oi" chega ao TA ─────────────────────────────────────────────
//
// Até 25/08/2026 esta ligação não existia. A recepção anotava o recado, o TA
// sabia responder, e nada os apresentava: uma pessoa escrevia no número de
// vendas e a conversa ficava esperando alguém abrir a tela. Os casos abaixo
// guardam a ligação — e, principalmente, os dois lugares onde ela NÃO acontece.

describe("a recepção entrega o turno ao TA", () => {
  it("lead reconhecido: o TA é chamado com o texto que a pessoa escreveu", async () => {
    prismaMock.siteLead.findUnique.mockResolvedValue({ id: "L1", codigo: "A7K2M", optOutAt: null });
    taMock.mockResolvedValue({ falou: true, mensagemId: "m9", resposta: { texto: "oi" } });

    const r = await receberMensagemDeVendas({
      fromPhone: "5511999990000",
      text: "quanto custa o plano crescimento? #A7K2M",
      agora: AGORA,
    });

    expect(taMock).toHaveBeenCalledTimes(1);
    expect(taMock.mock.calls[0]![1]).toMatchObject({
      leadId: "L1",
      mensagem: "quanto custa o plano crescimento? #A7K2M",
      agora: AGORA,
    });
    // E o que ele decidiu volta no resultado: "calado" e "nem consultado"
    // são estados diferentes, e a diferença responde por que o cliente ficou
    // sem resposta sem precisar abrir o banco.
    expect(r.ta).toMatchObject({ falou: true, mensagemId: "m9" });
  });

  it("contato novo também é atendido — quem escreve primeiro é quem mais espera", async () => {
    prismaMock.siteLead.findFirst.mockResolvedValue(null);
    prismaMock.siteLead.create.mockResolvedValue({ id: "L3", codigo: null, optOutAt: null });

    await receberMensagemDeVendas({
      fromPhone: "5511988887777",
      text: "oi, vi o anúncio",
      agora: AGORA,
    });

    expect(taMock).toHaveBeenCalledTimes(1);
    expect(taMock.mock.calls[0]![1]).toMatchObject({ leadId: "L3" });
  });

  it("⭐ quem pediu silêncio NÃO é entregue ao TA", async () => {
    // O caso que carrega este bloco. O TA barraria sozinho — ele tem o portão
    // de opt-out —, mas depender disso seria pôr a única garantia de silêncio
    // dentro do módulo que existe para falar. Aqui ele nem é chamado.
    prismaMock.siteLead.findFirst.mockResolvedValue({ id: "L4", codigo: null, optOutAt: null });

    const r = await receberMensagemDeVendas({
      fromPhone: "5511977776666",
      text: "PARAR",
      agora: AGORA,
    });

    expect(r.status).toBe("PEDIU_SILENCIO");
    expect(taMock).not.toHaveBeenCalled();
    expect(r.ta).toBeUndefined();
  });

  it("figurinha e áudio não vão para o TA — ele não adivinha o que tem dentro", async () => {
    prismaMock.siteLead.findFirst.mockResolvedValue({ id: "L5", codigo: null, optOutAt: null });

    await receberMensagemDeVendas({ fromPhone: "5511966665555", text: null, agora: AGORA });

    expect(taMock).not.toHaveBeenCalled();
  });

  it("mensagem só com espaços também não vai — texto vazio não é pergunta", async () => {
    // Parece o mesmo caso do de cima e NÃO é: ali o texto vem nulo, aqui vem uma
    // string de verdade que só não tem conteúdo. Sem este caso, a guarda podia
    // ser reduzida a `if (!msg.text)` e passar em tudo — deixando o TA compor
    // uma resposta de venda para alguém que apertou espaço sem querer.
    prismaMock.siteLead.findFirst.mockResolvedValue({ id: "L5b", codigo: null, optOutAt: null });

    await receberMensagemDeVendas({ fromPhone: "5511966665555", text: "   \n  ", agora: AGORA });

    expect(taMock).not.toHaveBeenCalled();
  });

  it("TA quebrado não derruba a recepção — a mensagem continua registrada", async () => {
    // A Meta reentrega o que falhou. Uma exceção aqui viraria a mesma mensagem
    // batendo em laço — e passando de novo pelos caminhos que criam contato.
    prismaMock.siteLead.findFirst.mockResolvedValue({ id: "L6", codigo: null, optOutAt: null });
    taMock.mockRejectedValue(new Error("modelo fora do ar"));

    const r = await receberMensagemDeVendas({
      fromPhone: "5511955554444",
      text: "vocês integram com iFood?",
      agora: AGORA,
    });

    expect(r.status).toBe("RECONHECIDO_POR_TELEFONE");
    expect(r.leadId).toBe("L6");
    expect(r.ta).toBeUndefined();
  });
});
