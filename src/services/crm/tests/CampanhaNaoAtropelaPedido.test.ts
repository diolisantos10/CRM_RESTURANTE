/**
 * O caso Wellington — 29/08/2026, Sushi Cazza.
 *
 * 18:51  cliente confirma 1× Yakissoba Especial, R$ 74,00. Status "Em preparo".
 * 18:52  o CRM dispara nele uma campanha de captação: "Você já deu uma
 *        olhadinha no nosso cardápio? (…) você ganhou 10% de desconto".
 * 18:57  ele responde "Boa noite fiz um pedido" / "Mas é entrega".
 * depois SILÊNCIO — ninguém e nada respondeu.
 *
 * Este arquivo reproduz esse minuto exato nas TRÊS portas por onde ele passou,
 * e prova que hoje as três fecham:
 *
 *   1. `evaluateActiveOrderGuard` — a regra, pura.
 *   2. `ContactSafetyService.assertSendable` — o portão que TODO envio de CRM
 *      atravessa (`ScheduledCampaignRunnerService:1557` no runner recorrente,
 *      que é quem mandou a mensagem, e `CrmCampaignService:686` no envio
 *      manual). É aqui que a mensagem para.
 *   3. `resolveAudience` — o público, para o cliente ocupado nem entrar na fila.
 *   4. `markConversationCrmContext` — o silêncio: a conversa de quem tem pedido
 *      em voo não vira conversa de campanha, então `shouldAiRespond` não a cala.
 *
 * Nenhuma mensagem é enviada. Nenhum banco real é tocado.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  order:             { count: vi.fn(), findFirst: vi.fn() },
  customer:          { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
  // O segmento de aniversário passou a ler o fuso do restaurante (conserto de
  // 06/09: parabenizar no DIA, não no mês) e a filtrar dia/mês na consulta.
  restaurant:        { findUnique: vi.fn(async () => ({ timezone: "America/Sao_Paulo" })) },
  // Devolve UM aniversariante do dia de propósito: com a lista vazia o caminho
  // retorna antes do findMany, e o teste abaixo — que exige a exclusão de
  // cliente ocupado no segmento de aniversário — não teria o que conferir.
  $queryRaw:         vi.fn(async () => [{ id: "aniversariante-de-hoje" }]),
  campaignExecution: { findMany: vi.fn(async () => []) },
  conversation:      { findUnique: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/business-hours", () => ({ isRestaurantOpenNow: vi.fn(async () => true) }));
vi.mock("@/services/crm/crmWhatsAppChannel", () => ({
  isWhatsAppChannelConnected: vi.fn(async () => true),
}));

const HOT_CUTOFF  = new Date("2026-07-30T00:00:00.000Z");
const WARM_CUTOFF = new Date("2026-06-30T00:00:00.000Z");
const LOST_CUTOFF = new Date("2026-05-01T00:00:00.000Z");
vi.mock("@/lib/crm-segments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crm-segments")>();
  return {
    ...actual,
    getSegmentConfig: vi.fn(async () => ({ ...actual.DEFAULT_SEGMENT_CONFIG })),
    buildCutoffs: vi.fn(() => ({
      hotCutoff: HOT_CUTOFF, warmCutoff: WARM_CUTOFF, lostCutoff: LOST_CUTOFF,
    })),
  };
});

import { DEFAULT_SAFETY_CONFIG } from "@/lib/crm-safety";
import {
  evaluateActiveOrderGuard,
  busyCustomerOrderFilter,
  RECENT_ORDER_SILENCE_HOURS,
  ACTIVE_ORDER_STATUSES,
} from "../activeOrderGuard";
import { ContactSafetyService } from "../ContactSafetyService";
import { resolveAudience } from "../CrmCampaignService";
import { markConversationCrmContext } from "@/services/agents/AgentRoutingService";

const REST = "rest_sushi_cazza";
const CLIENTE = "cus_wellington";

/** 18:52 de 29/08/2026, horário de Brasília — o minuto do disparo. */
const DISPARO = new Date("2026-08-29T21:52:00.000Z");
/** 18:51 — um minuto antes. O pedido de R$ 74,00. */
const PEDIDO = new Date("2026-08-29T21:51:00.000Z");

const contexto = {
  safety: { ...DEFAULT_SAFETY_CONFIG },
  whatsappAvailable: true,
  globalSentToday: 0,
  restaurantOpen: true,
  contactedCustomerIds: new Set<string>(),
};

/** O envio da campanha de captação, como o runner o monta. */
function envio(over: Record<string, unknown> = {}) {
  return {
    restaurantId: REST,
    customerId: CLIENTE,
    phone: "+5511988887777",
    campaignId: "camp_cadastro_sem_compra",
    hasOptedOut: false,
    crmContactable: true,
    // Isolando a trava nova: as janelas de horário não interessam a este teste.
    enforceTimeWindows: false,
    context: contexto,
    now: DISPARO,
    ...over,
  };
}

/** Cliente livre: nenhum pedido em voo, nenhum pedido recente. */
function semPedidos() {
  db.order.count.mockResolvedValue(0);
  db.order.findFirst.mockResolvedValue(null);
}

/** O estado real do Wellington às 18:52: pedido CONFIRMED feito às 18:51. */
function pedidoEmPreparoHaUmMinuto() {
  db.order.count.mockResolvedValue(1);
  db.order.findFirst.mockResolvedValue({ createdAt: PEDIDO });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.customer.findMany.mockResolvedValue([]);
  db.campaignExecution.findMany.mockResolvedValue([]);
  db.conversation.updateMany.mockResolvedValue({ count: 1 });
  semPedidos();
});

// ─── 1. A regra, pura ────────────────────────────────────────────────────────

describe("evaluateActiveOrderGuard — a regra", () => {
  it("pedido em voo bloqueia", () => {
    const v = evaluateActiveOrderGuard(
      { known: true, hasActiveOrder: true, lastRealOrderAt: PEDIDO }, DISPARO,
    );
    expect(v.free).toBe(false);
    expect(v.reason).toBe("CUSTOMER_HAS_ACTIVE_ORDER");
  });

  it("pedido já entregue, mas dentro da janela de silêncio, bloqueia", () => {
    const umaHoraAntes = new Date(DISPARO.getTime() - 60 * 60 * 1000);
    const v = evaluateActiveOrderGuard(
      { known: true, hasActiveOrder: false, lastRealOrderAt: umaHoraAntes }, DISPARO,
    );
    expect(v.free).toBe(false);
    expect(v.reason).toBe("CUSTOMER_ORDERED_RECENTLY");
  });

  it("passada a janela, o cliente volta a ser abordável", () => {
    const foraDaJanela = new Date(
      DISPARO.getTime() - (RECENT_ORDER_SILENCE_HOURS + 1) * 60 * 60 * 1000,
    );
    const v = evaluateActiveOrderGuard(
      { known: true, hasActiveOrder: false, lastRealOrderAt: foraDaJanela }, DISPARO,
    );
    expect(v.free).toBe(true);
  });

  it("não saber reprova — ausência de informação não é informação", () => {
    const v = evaluateActiveOrderGuard(
      { known: false, hasActiveOrder: false, lastRealOrderAt: null }, DISPARO,
    );
    expect(v.free).toBe(false);
    expect(v.reason).toBe("UNKNOWN_ORDER_STATE");
  });
});

// ─── 2. O portão que todo envio atravessa ────────────────────────────────────

describe("ContactSafetyService.assertSendable — o caso Wellington", () => {
  it("🔴 cliente com pedido confirmado há 1 minuto NÃO recebe a campanha", async () => {
    pedidoEmPreparoHaUmMinuto();
    const d = await ContactSafetyService.assertSendable(envio());
    expect(d.sendable).toBe(false);
    expect(d.reason).toBe("CUSTOMER_HAS_ACTIVE_ORDER");
  });

  it("o mesmo cliente, sem pedido nenhum, continua recebendo", async () => {
    semPedidos();
    const d = await ContactSafetyService.assertSendable(envio());
    expect(d.sendable).toBe(true);
    expect(d.reason).toBeNull();
  });

  it("pedido entregue há 2h ainda cala a campanha", async () => {
    db.order.count.mockResolvedValue(0);
    db.order.findFirst.mockResolvedValue({
      createdAt: new Date(DISPARO.getTime() - 2 * 60 * 60 * 1000),
    });
    const d = await ContactSafetyService.assertSendable(envio());
    expect(d.sendable).toBe(false);
    expect(d.reason).toBe("CUSTOMER_ORDERED_RECENTLY");
  });

  it("pedido de ontem não bloqueia nada", async () => {
    db.order.count.mockResolvedValue(0);
    db.order.findFirst.mockResolvedValue({
      createdAt: new Date(DISPARO.getTime() - 26 * 60 * 60 * 1000),
    });
    const d = await ContactSafetyService.assertSendable(envio());
    expect(d.sendable).toBe(true);
  });

  it("aniversário NÃO fura a trava — isenção é de frequência, não de pedido", async () => {
    pedidoEmPreparoHaUmMinuto();
    const d = await ContactSafetyService.assertSendable(
      envio({ isBirthday: true, allowWeeklyCapOverride: true }),
    );
    expect(d.sendable).toBe(false);
    expect(d.reason).toBe("CUSTOMER_HAS_ACTIVE_ORDER");
  });

  it("desligar a família de frequência também não fura a trava", async () => {
    pedidoEmPreparoHaUmMinuto();
    const d = await ContactSafetyService.assertSendable(
      envio({ enforceFrequency: false, enforceDailyCap: false }),
    );
    expect(d.sendable).toBe(false);
    expect(d.reason).toBe("CUSTOMER_HAS_ACTIVE_ORDER");
  });

  it("recuperação de carrinho passa pela janela — é resposta, não abordagem", async () => {
    // `enforceFrequency: false` é o que a recuperação de carrinho manda
    // (`OrderDraftRecoverySendService`): ela responde a um ato do cliente. Quem
    // acabou de montar um carrinho novo está pedindo de novo; calar isso porque
    // ele almoçou às 13h seria proteção mais destrutiva que o problema.
    db.order.count.mockResolvedValue(0);
    db.order.findFirst.mockResolvedValue({
      createdAt: new Date(DISPARO.getTime() - 2 * 60 * 60 * 1000),
    });
    const d = await ContactSafetyService.assertSendable(envio({ enforceFrequency: false }));
    expect(d.sendable).toBe(true);
  });

  it("...mas nem a recuperação de carrinho fala por cima de pedido em voo", async () => {
    pedidoEmPreparoHaUmMinuto();
    const d = await ContactSafetyService.assertSendable(envio({ enforceFrequency: false }));
    expect(d.sendable).toBe(false);
    expect(d.reason).toBe("CUSTOMER_HAS_ACTIVE_ORDER");
  });

  it("a consulta é escopada ao restaurante — inquilino não vaza", async () => {
    pedidoEmPreparoHaUmMinuto();
    await ContactSafetyService.assertSendable(envio());
    const where = db.order.count.mock.calls[0][0].where;
    expect(where.restaurantId).toBe(REST);
    expect(where.customerId).toBe(CLIENTE);
    expect(where.status.in).toEqual([...ACTIVE_ORDER_STATUSES]);
  });

  it("se a consulta de pedidos explode, o envio é bloqueado — nunca liberado", async () => {
    db.order.count.mockRejectedValue(new Error("banco fora do ar"));
    const d = await ContactSafetyService.assertSendable(envio());
    expect(d.sendable).toBe(false);
  });
});

// ─── 3. O público ────────────────────────────────────────────────────────────

describe("resolveAudience — quem está ocupado nem entra na fila", () => {
  it("toda campanha exclui quem tem pedido em voo ou recente", async () => {
    await resolveAudience(REST, "cadastro-sem-compra");
    const where = db.customer.findMany.mock.calls[0][0].where;
    expect(where.orders).toBeDefined();
    expect(where.orders.none.OR[0]).toEqual({
      status: { in: [...ACTIVE_ORDER_STATUSES] },
    });
    // e o filtro do segmento continua de pé
    expect(where.totalOrders).toBe(0);
  });

  it("a exclusão vale para os outros segmentos também", async () => {
    for (const seg of ["recuperar-perdidos", "clientes-vip", "aniversariantes"]) {
      db.customer.findMany.mockClear();
      await resolveAudience(REST, seg);
      const where = db.customer.findMany.mock.calls[0][0].where;
      expect(where.orders?.none).toBeDefined();
    }
  });

  it("o filtro cobre pedido em voo E pedido dentro da janela", () => {
    const f = busyCustomerOrderFilter(DISPARO);
    expect(f.OR).toHaveLength(2);
    const janela = f.OR[1].createdAt.gte as Date;
    expect(DISPARO.getTime() - janela.getTime()).toBe(
      RECENT_ORDER_SILENCE_HOURS * 60 * 60 * 1000,
    );
  });
});

// ─── 4. O silêncio ───────────────────────────────────────────────────────────

describe("markConversationCrmContext — a conversa do pedido não vira campanha", () => {
  it("🔴 cliente com pedido em voo: a conversa NÃO é carimbada CRM_CAMPAIGN", async () => {
    db.conversation.findUnique.mockResolvedValue({
      restaurantId: REST, customerId: CLIENTE,
    });
    db.order.count.mockResolvedValue(1);

    await markConversationCrmContext("conv_wellington", "CRM_CAMPAIGN", {
      relatedCampaignId: "camp_cadastro_sem_compra",
    });

    // Sem o carimbo, `shouldAiRespond` não devolve CRM_CONTEXT e o
    // "Mas é entrega" das 18:57 encontra alguém do outro lado.
    expect(db.conversation.updateMany).not.toHaveBeenCalled();
  });

  it("cliente sem pedido em voo: o carimbo continua acontecendo", async () => {
    db.conversation.findUnique.mockResolvedValue({
      restaurantId: REST, customerId: CLIENTE,
    });
    db.order.count.mockResolvedValue(0);

    await markConversationCrmContext("conv_qualquer", "CRM_CAMPAIGN", {
      relatedCampaignId: "camp_x",
    });

    expect(db.conversation.updateMany).toHaveBeenCalledTimes(1);
    expect(db.conversation.updateMany.mock.calls[0][0].data.contextType).toBe("CRM_CAMPAIGN");
  });

  it("conversa sem cliente (lead) segue o caminho normal", async () => {
    db.conversation.findUnique.mockResolvedValue({
      restaurantId: REST, customerId: null,
    });
    await markConversationCrmContext("conv_lead", "CRM_CAMPAIGN");
    expect(db.conversation.updateMany).toHaveBeenCalledTimes(1);
  });
});
