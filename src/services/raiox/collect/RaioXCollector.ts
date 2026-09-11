/**
 * Raio-X — coleta do estado de operação (server-only, SOMENTE LEITURA).
 *
 * A única camada do módulo que fala com o banco, e ela só lê: nenhum `create`,
 * `update`, `delete`, `upsert` ou `executeRaw`. Nunca envia mensagem, nunca
 * cria pedido, nunca toca em pagamento. `noSideEffects.test.ts` prova isso por
 * varredura, e não por promessa.
 *
 * Cada bloco é isolado: um erro de consulta vira "não sei" COM MOTIVO em vez de
 * derrubar a coleta inteira ou — pior — devolver zero. Zero é uma afirmação
 * sobre o mundo; erro de consulta não autoriza afirmação nenhuma.
 *
 * Cada bloco tem tempo limite próprio. Consulta que não volta é ausência de
 * informação, e ausência de informação tem que aparecer no relatório como
 * ausência, não como calmaria.
 */

import { prisma } from "@/lib/prisma";
import { available, unavailable, type Block, type RaioXSample } from "../types";
import type {
  AiSample,
  BillingSample,
  BrainSample,
  BusinessSample,
  CartsSample,
  DataSample,
  GatesSample,
  JobsSample,
  MessagesSample,
  PrintSample,
  StuckJob,
} from "../types";
import { scanSource } from "./SourceScanner";

// ── janelas e prazos (num lugar só, para o relatório poder citá-los) ──────────
export const WINDOW_HOURS = 24;
export const MESSAGE_PENDING_AFTER_MIN = 60;
export const PRINT_PENDING_AFTER_MIN = 15;
export const CART_STALE_AFTER_HOURS = 24;
export const BILLING_STALLED_AFTER_DAYS = 3;
export const JOB_STUCK_AFTER_HOURS = 2;
export const RESTAURANT_SILENT_AFTER_DAYS = 30;
/** A auditoria é noturna: 30h dá folga de um atraso sem virar alarme falso. */
export const AUDIT_EXPECTED_WITHIN_HOURS = 30;
/** Limiares da escada de liberação do Cérebro (docs/brain-universal-roadmap.md). */
export const PROMOTION_THRESHOLDS = { minSamples: 20, minCoherencePassPct: 70 };

/**
 * Os agentes de quem se ESPERA evidência de sombra continuamente.
 *
 * É uma declaração humana, de propósito. Derivar a lista do que a tabela já
 * contém faria o silêncio se autoabsolver: um agente que nunca gravou nada
 * nunca seria cobrado, que é exatamente o defeito que este item veio pegar.
 *
 * Quem grava cada um:
 *  • "whatsapp" — WhatsAppBrainRuntimeService.ts:115, a cada conversa em sombra;
 *  • "crm"      — ScheduledCampaignRunnerService.ts:2014, ao fim de cada disparo
 *                 de campanha COM envio real, e só se CRM_BRAIN_SHADOW_ENABLED
 *                 for a string "true" (linha 1518).
 *
 * Agente novo entra aqui de propósito, junto com a linha que o grava.
 */
export const AGENTES_COM_SOMBRA_ESPERADA = ["whatsapp", "crm"] as const;

/**
 * Quantas horas sem gravar até a sombra de um agente esperado virar alarme.
 *
 * 7 dias não é número escolhido a dedo: é a janela que `getShadowStats` usa por
 * padrão (BrainShadowEvidenceService.ts:57) e que os gates de promoção leem
 * (crmAgentGovernance.ts:59). Passado esse prazo sem uma amostra, o gate de
 * promoção está lendo ZERO por construção — o alarme dispara exatamente no
 * momento em que o tempo em sombra deixa de valer alguma coisa.
 */
export const SHADOW_SILENT_AFTER_HOURS = 7 * 24;

const BLOCK_TIMEOUT_MS = 20_000;
const SAMPLE_LIMIT = 25;

const hoursAgo = (now: Date, h: number) => new Date(now.getTime() - h * 3600_000);
const daysAgo = (now: Date, d: number) => new Date(now.getTime() - d * 86400_000);
const minutesBetween = (a: Date, b: Date) => Math.max(0, Math.round((a.getTime() - b.getTime()) / 60_000));
const hoursBetween = (a: Date, b: Date) => Math.max(0, Math.round((a.getTime() - b.getTime()) / 3600_000));
const daysBetween = (a: Date, b: Date) => Math.max(0, Math.round((a.getTime() - b.getTime()) / 86400_000));

/**
 * Roda um coletor de bloco protegido: erro e estouro de tempo viram bloco
 * indisponível com o motivo. Nunca lança, nunca devolve dado parcial mudo.
 */
export async function collectBlock<T>(name: string, fn: () => Promise<T>): Promise<Block<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const data = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`tempo esgotado após ${BLOCK_TIMEOUT_MS / 1000}s`)),
          BLOCK_TIMEOUT_MS,
        );
      }),
    ]);
    return available(data);
  } catch (err) {
    return unavailable<T>(`${name}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── blocos ────────────────────────────────────────────────────────────────────

async function collectAi(now: Date): Promise<AiSample> {
  const since = hoursAgo(now, WINDOW_HOURS);
  const logs = await prisma.aIInteractionLog.findMany({
    where: { createdAt: { gte: since } },
    select: {
      model: true,
      success: true,
      totalTokens: true,
      estimatedCostUsd: true,
      errorMessage: true,
      restaurantId: true,
      conversationId: true,
    },
  });

  // `estimatedCostUsd` null significa CUSTO INDETERMINADO (modelo fora da tabela
  // de preços), não custo zero. Converter null em 0 aqui reintroduziria, um andar
  // acima, o mesmo defeito que o logger acabou de matar: o total ficaria menor
  // que a realidade sem nada no relatório indicando a lacuna. Guardrail 1.
  const micro = (v: unknown): number | null =>
    v === null || v === undefined ? null : Math.round(Number(v) * 1_000_000);

  const byModelMap = new Map<string, { calls: number; failures: number; totalTokens: number; knownCostMicroUsd: number; unpricedCalls: number }>();
  const byConv = new Map<string, { calls: number; knownCostMicroUsd: number; unpricedCalls: number; restaurantId: string | null }>();
  let knownCostMicroUsd = 0;
  let unpricedCalls = 0;
  const unpricedModels = new Set<string>();
  let totalFailures = 0;
  const failureSamples: AiSample["failureSamples"] = [];

  for (const l of logs) {
    const cost = micro(l.estimatedCostUsd);
    const unpriced = cost === null;
    if (unpriced) {
      unpricedCalls++;
      unpricedModels.add(l.model || "(vazio)");
    } else {
      knownCostMicroUsd += cost;
    }
    const g = byModelMap.get(l.model) ?? { calls: 0, failures: 0, totalTokens: 0, knownCostMicroUsd: 0, unpricedCalls: 0 };
    g.calls++;
    g.totalTokens += l.totalTokens;
    if (unpriced) g.unpricedCalls++;
    else g.knownCostMicroUsd += cost;
    if (!l.success) {
      g.failures++;
      totalFailures++;
      if (failureSamples.length < SAMPLE_LIMIT) {
        failureSamples.push({ model: l.model, error: l.errorMessage ?? "(sem mensagem)", restaurantId: l.restaurantId });
      }
    }
    byModelMap.set(l.model, g);
    if (l.conversationId) {
      const c = byConv.get(l.conversationId) ?? { calls: 0, knownCostMicroUsd: 0, unpricedCalls: 0, restaurantId: l.restaurantId };
      c.calls++;
      if (unpriced) c.unpricedCalls++;
      else c.knownCostMicroUsd += cost;
      byConv.set(l.conversationId, c);
    }
  }

  const heaviestIds = [...byConv.entries()].sort((a, b) => b[1].calls - a[1].calls).slice(0, 20);
  const convs = heaviestIds.length
    ? await prisma.conversation.findMany({
        where: { id: { in: heaviestIds.map(([id]) => id) } },
        select: { id: true, orderId: true, orderDraftId: true },
      })
    : [];
  const convIndex = new Map(convs.map((c) => [c.id, c]));

  return {
    windowHours: WINDOW_HOURS,
    totalCalls: logs.length,
    totalFailures,
    knownCostMicroUsd,
    unpricedCalls,
    unpricedModels: [...unpricedModels].sort(),
    byModel: [...byModelMap.entries()].map(([model, g]) => ({ model, ...g })),
    failureSamples,
    heaviestConversations: heaviestIds.map(([conversationId, c]) => {
      const found = convIndex.get(conversationId);
      return {
        conversationId,
        restaurantId: c.restaurantId,
        calls: c.calls,
        knownCostMicroUsd: c.knownCostMicroUsd,
        unpricedCalls: c.unpricedCalls,
        // Conversa não encontrada → `null`, e a sonda não a conta como
        // desperdício. Não sei ≠ não gerou pedido.
        producedOrder: found ? Boolean(found.orderId ?? found.orderDraftId) : null,
      };
    }),
  };
}

async function collectMessages(now: Date): Promise<MessagesSample> {
  const since = hoursAgo(now, WINDOW_HOURS);
  const pendingCutoff = new Date(now.getTime() - MESSAGE_PENDING_AFTER_MIN * 60_000);

  const [outboundTotal, failedRows, pendingRows] = await Promise.all([
    prisma.message.count({ where: { direction: "OUTBOUND", sentAt: { gte: since } } }),
    // Só falha DECLARADA pelo provedor. "Sem confirmação de entrega" não entra:
    // Evolution e Instagram nem sempre confirmam, e inferir falha do silêncio
    // seria transformar ausência de informação em informação.
    prisma.message.findMany({
      where: {
        direction: "OUTBOUND",
        sentAt: { gte: since },
        OR: [{ externalStatus: "failed" }, { providerStatus: "failed" }, { providerError: { not: null } }],
      },
      select: { id: true, conversationId: true, externalStatus: true, providerError: true, errorMessage: true, sentAt: true },
      take: SAMPLE_LIMIT,
      orderBy: { sentAt: "desc" },
    }),
    prisma.message.findMany({
      where: { direction: "OUTBOUND", sentAt: { gte: since, lte: pendingCutoff }, externalStatus: "pending" },
      select: { id: true, conversationId: true, externalStatus: true, providerError: true, errorMessage: true, sentAt: true },
      take: SAMPLE_LIMIT,
      orderBy: { sentAt: "asc" },
    }),
  ]);

  const [failedCount, pendingCount] = await Promise.all([
    prisma.message.count({
      where: {
        direction: "OUTBOUND",
        sentAt: { gte: since },
        OR: [{ externalStatus: "failed" }, { providerStatus: "failed" }, { providerError: { not: null } }],
      },
    }),
    prisma.message.count({
      where: { direction: "OUTBOUND", sentAt: { gte: since, lte: pendingCutoff }, externalStatus: "pending" },
    }),
  ]);

  return {
    windowHours: WINDOW_HOURS,
    outboundTotal,
    failed: failedCount,
    stuckPending: pendingCount,
    pendingAfterMinutes: MESSAGE_PENDING_AFTER_MIN,
    samples: [...failedRows, ...pendingRows].slice(0, SAMPLE_LIMIT).map((m) => ({
      messageId: m.id,
      conversationId: m.conversationId,
      status: m.externalStatus ?? "(sem status)",
      error: m.providerError ?? m.errorMessage ?? "(sem erro registrado)",
      ageMinutes: minutesBetween(now, m.sentAt),
    })),
  };
}

async function collectPrint(now: Date): Promise<PrintSample> {
  const pendingCutoff = new Date(now.getTime() - PRINT_PENDING_AFTER_MIN * 60_000);
  const [dead, stuckPending, claimedStale, rows] = await Promise.all([
    prisma.printJob.count({ where: { status: "DEAD" } }),
    prisma.printJob.count({ where: { status: "PENDING", createdAt: { lte: pendingCutoff } } }),
    prisma.printJob.count({ where: { status: "CLAIMED", claimedAt: { lte: pendingCutoff } } }),
    prisma.printJob.findMany({
      where: {
        OR: [
          { status: "DEAD" },
          { status: "PENDING", createdAt: { lte: pendingCutoff } },
          { status: "CLAIMED", claimedAt: { lte: pendingCutoff } },
        ],
      },
      select: { id: true, restaurantId: true, orderId: true, status: true, attempts: true, error: true, createdAt: true },
      take: SAMPLE_LIMIT,
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return {
    dead,
    stuckPending,
    claimedStale,
    pendingAfterMinutes: PRINT_PENDING_AFTER_MIN,
    samples: rows.map((j) => ({
      jobId: j.id,
      restaurantId: j.restaurantId,
      orderId: j.orderId,
      status: j.status,
      attempts: j.attempts,
      ageMinutes: minutesBetween(now, j.createdAt),
      error: j.error ?? "(sem erro registrado)",
    })),
  };
}

async function collectCarts(now: Date): Promise<CartsSample> {
  const cutoff = hoursAgo(now, CART_STALE_AFTER_HOURS);
  const [drafts, sessions] = await Promise.all([
    prisma.orderDraft.findMany({
      where: { status: "OPEN", updatedAt: { lte: cutoff } },
      select: { id: true, restaurantId: true, totalAmount: true, updatedAt: true },
      take: 500,
      orderBy: { updatedAt: "asc" },
    }),
    prisma.whatsAppOrderingSession.findMany({
      where: {
        status: { in: ["ACTIVE", "AWAITING_CUSTOMER", "READY_TO_CONFIRM", "AWAITING_PAYMENT"] },
        expiresAt: { not: null, lte: now },
      },
      select: { id: true, restaurantId: true, status: true, lastMessageAt: true },
      take: 200,
      orderBy: { lastMessageAt: "asc" },
    }),
  ]);

  const valueCents = drafts.reduce((a, d) => a + Math.round(Number(d.totalAmount) * 100), 0);

  return {
    staleAfterHours: CART_STALE_AFTER_HOURS,
    staleDrafts: drafts.length,
    staleDraftsValueCents: valueCents,
    expiredSessionsNotClosed: sessions.length,
    draftSamples: drafts.slice(0, SAMPLE_LIMIT).map((d) => ({
      draftId: d.id,
      restaurantId: d.restaurantId,
      ageHours: hoursBetween(now, d.updatedAt),
      totalCents: Math.round(Number(d.totalAmount) * 100),
    })),
    sessionSamples: sessions.slice(0, SAMPLE_LIMIT).map((s) => ({
      sessionId: s.id,
      restaurantId: s.restaurantId,
      status: s.status,
      ageHours: hoursBetween(now, s.lastMessageAt),
    })),
  };
}

async function collectBilling(now: Date): Promise<BillingSample> {
  const stalledCutoff = daysAgo(now, BILLING_STALLED_AFTER_DAYS);
  const [provisionRows, priceSyncRows, stalledRows, invoices] = await Promise.all([
    prisma.planSubscription.findMany({
      where: { provisionError: { not: null } },
      select: { id: true, provisionError: true, updatedAt: true },
      take: SAMPLE_LIMIT,
    }),
    prisma.planSubscription.findMany({
      where: { priceSyncError: { not: null } },
      select: { id: true, priceSyncError: true, updatedAt: true },
      take: SAMPLE_LIMIT,
    }),
    prisma.planSubscription.findMany({
      where: {
        status: { in: ["AGUARDANDO_ACEITE", "ACEITO", "AGUARDANDO_PAGAMENTO"] },
        createdAt: { lte: stalledCutoff },
      },
      select: { id: true, status: true, createdAt: true, priceCents: true, mpInitPoint: true },
      take: 200,
      orderBy: { createdAt: "asc" },
    }),
    prisma.planInvoice.findMany({
      where: { status: "PENDENTE" },
      select: { amountCents: true, createdAt: true },
      take: 2000,
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return {
    stalledAfterDays: BILLING_STALLED_AFTER_DAYS,
    provisionErrors: provisionRows.map((r) => ({
      subscriptionId: r.id,
      error: r.provisionError ?? "",
      ageDays: daysBetween(now, r.updatedAt),
    })),
    priceSyncErrors: priceSyncRows.map((r) => ({
      subscriptionId: r.id,
      error: r.priceSyncError ?? "",
      ageDays: daysBetween(now, r.updatedAt),
    })),
    stalledSubscriptions: stalledRows.slice(0, SAMPLE_LIMIT).map((r) => ({
      subscriptionId: r.id,
      status: r.status,
      ageDays: daysBetween(now, r.createdAt),
      amountCents: r.priceCents,
    })),
    missingPaymentLink: stalledRows
      .filter((r) => !r.mpInitPoint && r.status !== "AGUARDANDO_ACEITE")
      .slice(0, SAMPLE_LIMIT)
      .map((r) => ({ subscriptionId: r.id, status: r.status, ageDays: daysBetween(now, r.createdAt) })),
    pendingInvoices: invoices.length,
    pendingInvoicesValueCents: invoices.reduce((a, i) => a + i.amountCents, 0),
    oldestPendingInvoiceDays: invoices[0] ? daysBetween(now, invoices[0].createdAt) : null,
  };
}

async function collectGates(now: Date): Promise<GatesSample> {
  const last = await prisma.qualityAuditRun.findFirst({
    orderBy: { createdAt: "desc" },
    select: { id: true, globalStatus: true, createdAt: true, countsBySeverity: true },
  });
  if (!last) {
    return { lastRun: null, expectedWithinHours: AUDIT_EXPECTED_WITHIN_HOURS, blockingFindings: [] };
  }
  const blocking = await prisma.qualityAuditFinding.findMany({
    where: { runId: last.id, OR: [{ severity: "P0" }, { status: "FAIL" }] },
    select: { auditorId: true, severity: true, title: true },
    take: SAMPLE_LIMIT,
  });
  return {
    lastRun: {
      runId: last.id,
      globalStatus: last.globalStatus,
      ageHours: hoursBetween(now, last.createdAt),
      countsBySeverity: (last.countsBySeverity ?? {}) as Record<string, number>,
    },
    expectedWithinHours: AUDIT_EXPECTED_WITHIN_HOURS,
    blockingFindings: blocking,
  };
}

async function collectBrain(now: Date): Promise<BrainSample> {
  const since = hoursAgo(now, WINDOW_HOURS);
  const [logs, configs, ultimas] = await Promise.all([
    prisma.brainShadowLog.findMany({
      where: { createdAt: { gte: since } },
      // agentId entra aqui porque o total agregado esconde o agente parado.
      select: { coherence: true, reasoningMode: true, agentId: true },
      take: 5000,
    }),
    prisma.brainFreeFormConfig.findMany({
      where: { mode: { not: "SHADOW_ONLY" } },
      select: { restaurantId: true, mode: true, paused: true },
      take: SAMPLE_LIMIT,
    }),
    // Sem recorte de janela DE PROPÓSITO: a pergunta é "faz quanto tempo que
    // este agente não grava", e ela não tem resposta dentro de uma janela que
    // já está vazia.
    prisma.brainShadowLog.groupBy({
      by: ["agentId"],
      _max: { createdAt: true },
    }),
  ]);

  // agentId nulo = recepcionista, pela semântica das linhas antigas
  // (BrainShadowEvidenceService.ts:65).
  const nome = (id: string | null) => id ?? "whatsapp";

  const ultimaPorAgente = new Map<string, Date | null>();
  for (const u of ultimas) ultimaPorAgente.set(nome(u.agentId), u._max.createdAt ?? null);

  const agentes = new Set<string>([...ultimaPorAgente.keys(), ...logs.map((l) => nome(l.agentId))]);
  const porAgente = [...agentes].sort().map((agentId) => {
    const doAgente = logs.filter((l) => nome(l.agentId) === agentId);
    const ultima = ultimaPorAgente.get(agentId) ?? null;
    return {
      agentId,
      amostras: doAgente.length,
      coherencePass: doAgente.filter((l) => l.coherence === "PASS").length,
      coherenceFail: doAgente.filter((l) => l.coherence === "FAIL").length,
      coherenceNeedsReview: doAgente.filter((l) => l.coherence === "NEEDS_REVIEW").length,
      ultimaAmostraHorasAtras: ultima ? hoursBetween(now, ultima) : null,
    };
  });

  return {
    windowHours: WINDOW_HOURS,
    shadowSamples: logs.length,
    coherencePass: logs.filter((l) => l.coherence === "PASS").length,
    coherenceFail: logs.filter((l) => l.coherence === "FAIL").length,
    coherenceNeedsReview: logs.filter((l) => l.coherence === "NEEDS_REVIEW").length,
    fallbackModes: logs.filter((l) => l.reasoningMode === "FALLBACK").length,
    liveConfigs: configs,
    promotionThresholds: PROMOTION_THRESHOLDS,
    porAgente,
    agentesEsperados: [...AGENTES_COM_SOMBRA_ESPERADA],
    silencioAlarmaAposHoras: SHADOW_SILENT_AFTER_HOURS,
  };
}

async function collectJobs(now: Date): Promise<JobsSample> {
  const cutoff = hoursAgo(now, JOB_STUCK_AFTER_HOURS);
  const [imports, extractions, campaignSends, fiscal] = await Promise.all([
    prisma.importJob.findMany({
      where: { status: { in: ["VALIDATING", "IMPORTING"] }, createdAt: { lte: cutoff }, completedAt: null },
      select: { id: true, status: true, createdAt: true, filename: true, totalRows: true },
      take: SAMPLE_LIMIT,
    }),
    prisma.agentLibraryExtractionJob.findMany({
      where: {
        stage: { in: ["PENDING", "EXTRACTING_TEXT", "CHUNKING", "PROCESSING_CHUNKS", "CONSOLIDATING"] },
        updatedAt: { lte: cutoff },
      },
      select: { id: true, stage: true, updatedAt: true, processedChunks: true, totalChunks: true, lastError: true },
      take: SAMPLE_LIMIT,
    }),
    prisma.campaignExecution.count({ where: { status: "PENDING", createdAt: { lte: cutoff } } }),
    prisma.fiscalDocument.count({ where: { status: { in: ["PENDENTE", "ERRO"] }, createdAt: { lte: cutoff } } }),
  ]);

  const stuck: StuckJob[] = [
    ...imports.map((j) => ({
      kind: "importação",
      jobId: j.id,
      status: j.status,
      ageHours: hoursBetween(now, j.createdAt),
      detail: `${j.filename} · ${j.totalRows} linhas`,
    })),
    ...extractions.map((j) => ({
      kind: "extração de biblioteca",
      jobId: j.id,
      status: j.stage,
      ageHours: hoursBetween(now, j.updatedAt),
      detail: `${j.processedChunks}/${j.totalChunks} pedaços · ${j.lastError ?? "sem erro"}`,
    })),
  ];

  return {
    stuckAfterHours: JOB_STUCK_AFTER_HOURS,
    stuck,
    pendingCampaignSends: campaignSends,
    stuckFiscalDocs: fiscal,
  };
}

async function collectData(now: Date): Promise<DataSample> {
  const since = hoursAgo(now, WINDOW_HOURS);
  const silentCutoff = daysAgo(now, RESTAURANT_SILENT_AFTER_DAYS);

  const [
    msgTotal, msgNew, aiTotal, aiNew, shadowTotal, shadowNew, convTotal, convNew,
    restaurants,
  ] = await Promise.all([
    prisma.message.count(),
    prisma.message.count({ where: { sentAt: { gte: since } } }),
    prisma.aIInteractionLog.count(),
    prisma.aIInteractionLog.count({ where: { createdAt: { gte: since } } }),
    prisma.brainShadowLog.count(),
    prisma.brainShadowLog.count({ where: { createdAt: { gte: since } } }),
    prisma.conversation.count(),
    prisma.conversation.count({ where: { createdAt: { gte: since } } }),
    prisma.restaurant.findMany({
      where: { isActive: true, isDemo: false },
      select: { id: true, name: true, orders: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 } },
      take: 500,
    }),
  ]);

  const silent = restaurants
    .filter((r) => !r.orders[0] || r.orders[0].createdAt <= silentCutoff)
    .map((r) => ({
      restaurantId: r.id,
      name: r.name,
      silentDays: r.orders[0] ? daysBetween(now, r.orders[0].createdAt) : null,
    }));

  return {
    windowHours: WINDOW_HOURS,
    growth: [
      { table: "messages", total: msgTotal, addedInWindow: msgNew },
      { table: "ai_interaction_logs", total: aiTotal, addedInWindow: aiNew },
      { table: "brain_shadow_logs", total: shadowTotal, addedInWindow: shadowNew },
      { table: "conversations", total: convTotal, addedInWindow: convNew },
    ],
    silentRestaurants: silent,
    silentAfterDays: RESTAURANT_SILENT_AFTER_DAYS,
  };
}

async function collectBusiness(now: Date): Promise<BusinessSample> {
  const since24 = hoursAgo(now, 24);
  const since8d = daysAgo(now, 8);

  const restaurants = await prisma.restaurant.findMany({
    where: { isActive: true, isDemo: false },
    select: { id: true, name: true },
    take: 500,
  });

  // Pedidos importados carregam a data do evento original e distorceriam a
  // leitura de "hoje": ficam de fora de propósito.
  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: since8d }, importedAt: null, status: { not: "CANCELLED" } },
    select: { restaurantId: true, createdAt: true, total: true },
    take: 20000,
  });

  const index = new Map(restaurants.map((r) => [r.id, { last24: 0, prev: 0, revenue: 0 }]));
  for (const o of orders) {
    const bucket = index.get(o.restaurantId);
    if (!bucket) continue;
    if (o.createdAt >= since24) {
      bucket.last24++;
      bucket.revenue += Math.round(Number(o.total) * 100);
    } else {
      bucket.prev++;
    }
  }

  const pulse = restaurants.map((r) => {
    const b = index.get(r.id)!;
    return {
      restaurantId: r.id,
      name: r.name,
      ordersLast24h: b.last24,
      avgDailyPrevious7d: Math.round((b.prev / 7) * 10) / 10,
      revenueLast24hCents: b.revenue,
    };
  });

  return {
    restaurants: pulse.sort((a, b) => b.ordersLast24h - a.ordersLast24h),
    totalOrdersLast24h: pulse.reduce((a, r) => a + r.ordersLast24h, 0),
    totalRevenueLast24hCents: pulse.reduce((a, r) => a + r.revenueLast24hCents, 0),
  };
}

// ── coleta completa ───────────────────────────────────────────────────────────

export interface CollectOptions {
  now?: Date;
  /** Raiz para a varredura de código. Em produção, o diretório do processo. */
  sourceRoot?: string;
}

export async function collectSample(opts: CollectOptions = {}): Promise<RaioXSample> {
  const now = opts.now ?? new Date();
  const root = opts.sourceRoot ?? process.cwd();

  const [ai, messages, print, carts, billing, gates, brain, jobs, data, business] = await Promise.all([
    collectBlock("chamadas de IA", () => collectAi(now)),
    collectBlock("mensagens", () => collectMessages(now)),
    collectBlock("fila de impressão", () => collectPrint(now)),
    collectBlock("carrinhos e sessões", () => collectCarts(now)),
    collectBlock("assinaturas", () => collectBilling(now)),
    collectBlock("auditoria de qualidade", () => collectGates(now)),
    collectBlock("raciocínio em sombra", () => collectBrain(now)),
    collectBlock("trabalhos de fundo", () => collectJobs(now)),
    collectBlock("volumetria", () => collectData(now)),
    collectBlock("pedidos", () => collectBusiness(now)),
  ]);

  // A varredura de código é síncrona e não toca no banco; mesmo assim passa
  // pelo mesmo envelope, para que uma falha dela também vire "não sei".
  const source = await collectBlock("código-fonte", async () => {
    const block = scanSource({ root });
    if (!block.ok) throw new Error(block.reason);
    return block.data;
  });

  return { collectedAt: now, ai, messages, print, carts, billing, gates, brain, jobs, data, business, source };
}
