/**
 * CrmCampaignService
 *
 * Orchestrates CRM campaign execution:
 *   1. Audience resolution — query real customer data by segment/template.
 *   2. Message personalization — variable substitution per customer.
 *   3. Campaign creation — Campaign + CampaignExecution records.
 *   4. Sending — canal oficial (WhatsAppMessagingService) + Chat Inbox logging + status tracking.
 *
 * Sending requires explicit human approval via the review UI before calling `send()`.
 * This service NEVER sends autonomously.
 */

import { prisma } from "@/lib/prisma";
import { busyCustomerOrderFilter } from "./activeOrderGuard";
import { WhatsAppMessagingService } from "@/services/whatsapp/WhatsAppMessagingService";
import { isWhatsAppChannelConnected, SendFailure, NO_WHATSAPP_CONFIG_DETAIL } from "./crmWhatsAppChannel";
import { sendMetaCrmMessage } from "./metaCrmSend";
import { normalizePhoneBR, isValidPhoneBR } from "@/lib/crm/normalizePhone";
import { generateMessageFingerprint, suggestCampaignFamilyKey } from "./messageFingerprint";
import { RelationshipProgramService } from "./RelationshipProgramService";
import { getPublicMenuUrl, getPublicSiteUrl, sanitizeCustomerUrl } from "@/lib/public-url";
import { isGuestIdentifier } from "@/lib/guest";
import { ConversationStatus } from "@prisma/client";
import { markConversationCrmContext, buildConversationMetadataForCrmSend, CONTEXT_TYPE } from "@/services/agents/AgentRoutingService";
import { getSegmentConfig, buildCutoffs } from "@/lib/crm-segments";
import { isBirthdayCampaign } from "@/lib/crm-safety";
import { ContactSafetyService } from "@/services/crm/ContactSafetyService";
import { renderCrmMessage } from "./renderCrmMessage";

// ─── types ────────────────────────────────────────────────────

export interface AudienceCustomer {
  id:          string;
  name:        string;
  phone:       string;
  tier:        string;
  segment:     string;
  totalOrders: number;
  totalSpend:  number;
  lastOrderAt: string | null;
}

export interface CreateCampaignInput {
  name:            string;
  templateId?:     string;   // "recuperar-frios" etc.
  targetSegment:   string;   // "FRIO" | "MORNO" | "VIP" | etc.
  messageTemplate: string;   // raw template with {nome} placeholders
  objective?:      string;
  channel?:        string;
  scheduledAt?:    Date;     // if set, campaign starts as SCHEDULED
  scheduleConfig?: any; // Prisma Json? field
  audienceConfig?: any; // Prisma Json? field
  couponCode?:     string;   // optional coupon link for attribution
  promotionId?:    string;   // optional promotion link for attribution
  campaignFamilyKey?: string; // stable concept key (auto-suggested if omitted)
  dedupePolicy?:   any;       // { dedupeByConcept?, dedupeByMessage?, dedupeWindowDays?, allowResendToImpacted? }
}

export interface CampaignRecipientRow {
  id:           string;
  customerId:   string;
  customerName: string;
  customerPhone: string;
  messageText:  string;
  status:       string;
}

export interface SendInput {
  messages: Array<{ recipientId: string; messageText: string }>;
  /** Cap how many PENDING executions are processed in this call. 0 = no limit. */
  limit?: number;
}

export interface SendResult {
  totalSent:        number;
  totalFailed:      number;
  /** Safety blocks (weekly cap / cooldown / opt-out / dedupe) — NOT failures. */
  totalBlocked:     number;
  /** Recipients skipped before any provider call (no/invalid phone) — NOT failures. */
  totalSkipped:     number;
  duplicateSkipped: number;
  results:          Array<{ id: string; status: "SENT" | "FAILED" | "BLOCKED" | "SKIPPED"; error?: string }>;
}

// ─── template → segment mapping ───────────────────────────────

const TEMPLATE_SEGMENT_MAP: Record<string, string> = {
  "clientes-quentes":   "QUENTE",
  "quente-esfriando":   "QUENTE_ESFRIANDO",
  "cadastro-sem-compra":"SEM_PEDIDOS",
  "recuperar-frios":    "FRIO",
  "recuperar-perdidos": "PERDIDO",
  "reativar-mornos":    "MORNO",
  "segunda-compra":     "PRIMEIRO_PEDIDO",
  "clientes-vip":       "VIP",
  "pedido-avaliacao":   "RECENTE_AVALIACAO",
  "recorrente-sumido":  "RECORRENTE_SUMIDO",
  "aniversariantes":    "ANIVERSARIANTES",
  "cupom-vencendo":     "CUPOM_VENCENDO",
  "indique-amigo":      "INDICACAO",
  "subiu-de-nivel":     "SUBIU_DE_NIVEL",
  "quase-no-proximo-nivel": "QUASE_PROXIMO_NIVEL",
  "mimo-mensal-nivel":  "MIMO_MENSAL_NIVEL",
  "aumentar-bebidas":   "SEM_BEBIDA",
  "aumentar-sobremesas":"SEM_SOBREMESA",
};

// ─── audience resolution ──────────────────────────────────────

const MAX_AUDIENCE = 500; // safety cap

export async function resolveAudience(
  restaurantId: string,
  targetSegment: string,
  templateId?: string,
  /** Event-based tuning: how many days after the event to target (review, 2nd purchase). */
  opts?: {
    triggerDays?: number;
    /**
     * QUEM JÁ FOI CONTATADO — e por que isto entra AQUI, e não depois.
     *
     * ── O DEFEITO, medido no diagnóstico de 28/08/2026 ────────────────────
     *
     * A audiência é cortada em `MAX_AUDIENCE` (500) **ordenada por
     * `lastOrderAt asc`** — ou seja, os mais antigos primeiro, que são
     * exatamente os frios e os perdidos. A exclusão de quem já recebeu
     * acontecia **depois**, em memória, no runner.
     *
     * O efeito é uma parede: **as mesmas 500 pessoas mais antigas ocupam a
     * lista para sempre.** Contatadas todas, o filtro em memória zera a fila,
     * a campanha devolve "sem novos elegíveis", fica ACTIVE e MUDA — com o
     * resto da base **nunca alcançado**. E não vira alerta em lugar nenhum.
     *
     * ⚠️ E o número 500 não é o defeito. Subir para 5.000 só move a parede
     * 4.500 pessoas adiante e recria o mesmo silêncio depois. O defeito é a
     * ORDEM das duas operações.
     */
    excluirIds?: readonly string[];
  }
): Promise<AudienceCustomer[]> {
  // Resolve canonical segment — template IDs (e.g. "recuperar-frios") may arrive in targetSegment
  const rawSeg = (targetSegment ?? "").trim();
  const seg = (TEMPLATE_SEGMENT_MAP[rawSeg] ?? rawSeg)
    || (templateId ? TEMPLATE_SEGMENT_MAP[templateId] : null)
    || "TODOS";
  const rid = restaurantId;
  const now = new Date();

  // A exclusão entra na CONSULTA, para que o `take` conte 500 pessoas que ainda
  // não foram contatadas — e não 500 que já foram.
  const excluir = opts?.excluirIds ?? [];

  const baseWhere = {
    ...(excluir.length > 0 ? { id: { notIn: [...excluir] } } : {}),
    restaurantId:   rid,
    isGuest:        false,
    isActive:       true,
    hasOptedOut:    false,
    crmContactable: true,           // exclude no-phone imported customers
    phone:          { not: null },  // belt-and-suspenders: require a real phone
    // Quem está no meio de um pedido não entra em público de campanha —
    // NENHUMA campanha. A regra e o caso que a criou estão em
    // `activeOrderGuard.ts`. Aqui é o primeiro dos dois lugares em que ela
    // mora: este filtro poupa orçamento e faz a prévia do lojista contar a
    // verdade. O segundo, e o que de fato trava o envio, é o
    // `ContactSafetyService`, por destinatário, no instante do disparo — o
    // público é resolvido antes do lote, e um pedido pode entrar no meio dele.
    // Guardrail 4: prompt é aviso, código é trava; e a trava que vale é a que
    // fica na última porta.
    orders:         { none: busyCustomerOrderFilter(now) },
  };

  const baseSelect = {
    id: true, name: true, phone: true,
    tier: true, segment: true,
    totalOrders: true, totalSpend: true,
    lastOrderAt: true, importedLastOrderAt: true,
  } as const;

  type Row = {
    id: string; name: string; phone: string | null;
    tier: string; segment: string;
    totalOrders: number; totalSpend: { toNumber(): number };
    lastOrderAt: Date | null; importedLastOrderAt: Date | null;
  };

  function serialize(rows: Row[]): AudienceCustomer[] {
    return rows
      .filter((r) => r.phone && !isGuestIdentifier(r.phone) && r.phone.trim() !== "")
      .map((r) => ({
        id:          r.id,
        name:        r.name,
        phone:       r.phone!,
        tier:        r.tier,
        segment:     r.segment,
        totalOrders: r.totalOrders,
        totalSpend:  r.totalSpend.toNumber(),
        // Fall back to importedLastOrderAt so imported customers get correct days-since calc
        lastOrderAt: (r.lastOrderAt ?? r.importedLastOrderAt)?.toISOString() ?? null,
      }));
  }

  // Load segment config once — used for date-based audience resolution
  const segCfg  = await getSegmentConfig(restaurantId);
  const cutoffs = buildCutoffs(segCfg, now);

  switch (seg) {
    case "FRIO":
      return serialize(await prisma.customer.findMany({
        where: {
          ...baseWhere,
          OR: [
            { lastOrderAt: { lt: cutoffs.warmCutoff } },
            { lastOrderAt: null, importedLastOrderAt: { lt: cutoffs.warmCutoff } },
          ],
        },
        orderBy: [{ lastOrderAt: "asc" }, { importedLastOrderAt: "asc" }],
        take: MAX_AUDIENCE, select: baseSelect,
      }) as Row[]);

    case "MORNO":
      return serialize(await prisma.customer.findMany({
        where: {
          ...baseWhere,
          OR: [
            { lastOrderAt: { gte: cutoffs.warmCutoff, lt: cutoffs.hotCutoff } },
            { lastOrderAt: null, importedLastOrderAt: { gte: cutoffs.warmCutoff, lt: cutoffs.hotCutoff } },
          ],
        },
        orderBy: [{ lastOrderAt: "asc" }, { importedLastOrderAt: "asc" }],
        take: MAX_AUDIENCE, select: baseSelect,
      }) as Row[]);

    case "PERDIDO":
      // Effective last order older than lostMinDays — the "lost" tier. Mirrors the
      // preview (CrmAudienceService "recuperar-perdidos"). Without this case the
      // segment fell through to default:TODOS and blasted the whole base.
      return serialize(await prisma.customer.findMany({
        where: {
          ...baseWhere,
          OR: [
            { lastOrderAt: { lt: cutoffs.lostCutoff } },
            { lastOrderAt: null, importedLastOrderAt: { lt: cutoffs.lostCutoff } },
          ],
        },
        orderBy: [{ lastOrderAt: "asc" }, { importedLastOrderAt: "asc" }],
        take: MAX_AUDIENCE, select: baseSelect,
      }) as Row[]);

    case "QUENTE":
      return serialize(await prisma.customer.findMany({
        where: {
          ...baseWhere,
          OR: [
            { lastOrderAt: { gte: cutoffs.hotCutoff } },
            { lastOrderAt: null, importedLastOrderAt: { gte: cutoffs.hotCutoff } },
          ],
        },
        orderBy: { totalSpend: "desc" },
        take: MAX_AUDIENCE, select: baseSelect,
      }) as Row[]);

    case "QUENTE_ESFRIANDO": {
      // Proactive rescue: still QUENTE, but in the last ~week of the hot window —
      // ordered between (hotMaxDays - COOLING) and hotMaxDays days ago, about to
      // turn MORNO. Catch them before they drop a level.
      const COOLING_WINDOW_DAYS = 7;
      const coolingCutoff = new Date(
        now.getTime() - Math.max(1, segCfg.hotMaxDays - COOLING_WINDOW_DAYS) * 86_400_000,
      );
      return serialize(await prisma.customer.findMany({
        where: {
          ...baseWhere,
          OR: [
            { lastOrderAt:         { gte: cutoffs.hotCutoff, lte: coolingCutoff } },
            { lastOrderAt: null, importedLastOrderAt: { gte: cutoffs.hotCutoff, lte: coolingCutoff } },
          ],
        },
        orderBy: [{ lastOrderAt: "asc" }, { importedLastOrderAt: "asc" }],
        take: MAX_AUDIENCE, select: baseSelect,
      }) as Row[]);
    }

    case "VIP":
      return serialize(await prisma.customer.findMany({
        where: { ...baseWhere, tier: { in: ["OURO", "DIAMANTE"] } },
        orderBy: [{ tier: "asc" }, { totalSpend: "desc" }],
        take: MAX_AUDIENCE, select: baseSelect,
      }) as Row[]);

    case "SEM_PEDIDOS":
      // Identified (contactable via baseWhere) but NEVER purchased — no native and
      // no imported order history. Prime target for a first-order campaign.
      return serialize(await prisma.customer.findMany({
        where: {
          ...baseWhere,
          totalOrders: 0,
          OR: [{ importedOrderCount: null }, { importedOrderCount: 0 }],
        },
        orderBy: { createdAt: "desc" },
        take: MAX_AUDIENCE, select: baseSelect,
      }) as Row[]);

    case "PRIMEIRO_PEDIDO": {
      // 2nd-purchase nudge: customers with exactly one order, placed at least
      // `triggerDays` ago (give them time before nudging). Default 3 days.
      const days  = Math.max(0, opts?.triggerDays ?? 3);
      const until = new Date(now.getTime() - days * 86_400_000);
      return serialize(await prisma.customer.findMany({
        where: { ...baseWhere, totalOrders: 1, lastOrderAt: { lte: until } },
        orderBy: { lastOrderAt: "desc" },
        take: MAX_AUDIENCE, select: baseSelect,
      }) as Row[]);
    }

    case "INDICACAO":
      // Anyone who has already ordered (native or imported) — happy customers are
      // the ones worth arming with their personal referral link.
      return serialize(await prisma.customer.findMany({
        where: {
          ...baseWhere,
          OR: [{ totalOrders: { gte: 1 } }, { importedOrderCount: { gte: 1 } }],
        },
        orderBy: { lastOrderAt: "desc" },
        take: MAX_AUDIENCE, select: baseSelect,
      }) as Row[]);

    case "SUBIU_DE_NIVEL": {
      // Customers who moved UP a tier within the last `triggerDays` days — the
      // congratulate-and-reward window (tierUpAt is stamped by the tier writers).
      const days  = Math.max(1, opts?.triggerDays ?? 7);
      const since = new Date(now.getTime() - days * 86_400_000);
      return serialize(await prisma.customer.findMany({
        where:   { ...baseWhere, tierUpAt: { gte: since } },
        orderBy: { tierUpAt: "desc" } as never,
        take: MAX_AUDIENCE, select: baseSelect,
      }) as Row[]);
    }

    case "QUASE_PROXIMO_NIVEL": {
      // Customers within 20% of the NEXT tier's spend threshold (spend-based only).
      const s = await RelationshipProgramService.getSettings(restaurantId);
      const near = (threshold: number) => ({ gte: threshold * 0.8, lt: threshold });
      return serialize(await prisma.customer.findMany({
        where: {
          ...baseWhere,
          OR: [
            { tier: "BRONZE", totalSpend: near(Number(s.silverMinSpend)) },
            { tier: "PRATA",  totalSpend: near(Number(s.goldMinSpend)) },
            { tier: "OURO",   totalSpend: near(Number(s.diamondMinSpend)) },
          ],
        },
        orderBy: { totalSpend: "desc" },
        take: MAX_AUDIENCE, select: baseSelect,
      }) as Row[]);
    }

    case "MIMO_MENSAL_NIVEL": {
      // Which levels get a monthly mimo is the OWNER's call: send only to tiers that
      // have a reward configured in the campaign's tierCoupons (set from the Benefícios
      // panel — any tier, Bronze included). No config yet → legacy Prata+ default, so
      // existing setups keep working. "Monthly" is enforced by recontactDays (30).
      const mimoCamp = await prisma.campaign.findFirst({
        where:   { restaurantId: rid, templateId: "mimo-mensal-nivel", status: { notIn: ["SENT", "COMPLETED", "CANCELLED"] as never[] } },
        orderBy: { createdAt: "desc" },
        select:  { scheduleConfig: true },
      });
      const tierCoupons = (mimoCamp?.scheduleConfig as { tierCoupons?: Record<string, unknown> } | null)?.tierCoupons ?? {};
      const configured  = Object.keys(tierCoupons).filter((k) => tierCoupons[k]);
      const targetTiers = configured.length > 0 ? configured : ["PRATA", "OURO", "DIAMANTE"];
      return serialize(await prisma.customer.findMany({
        where:   { ...baseWhere, tier: { in: targetTiers } },
        orderBy: [{ tier: "desc" }, { totalSpend: "desc" }],
        take: MAX_AUDIENCE, select: baseSelect,
      }) as Row[]);
    }

    case "CUPOM_VENCENDO": {
      // Customers holding an ACTIVE (unused) coupon that expires within the next
      // `triggerDays` days (i.e. warned N days BEFORE expiry) — the last window
      // to convert it into an order.
      const days  = Math.max(1, opts?.triggerDays ?? 5);
      const until = new Date(now.getTime() + days * 86_400_000);
      return serialize(await prisma.customer.findMany({
        where: {
          ...baseWhere,
          coupons: { some: { status: "ACTIVE", expiresAt: { gte: now, lte: until } } },
        },
        orderBy: { lastOrderAt: "desc" },
        take: MAX_AUDIENCE, select: baseSelect,
      }) as Row[]);
    }

    case "RECENTE_AVALIACAO": {
      // Review request: orders placed between `triggerDays` and triggerDays+14 days
      // ago — i.e. a few days after delivery, not immediately. Default 2 days.
      const days  = Math.max(0, opts?.triggerDays ?? 2);
      const from  = new Date(now.getTime() - (days + 14) * 86_400_000);
      const until = new Date(now.getTime() - days * 86_400_000);
      return serialize(await prisma.customer.findMany({
        where: { ...baseWhere, lastOrderAt: { gte: from, lte: until } },
        orderBy: { lastOrderAt: "desc" },
        take: MAX_AUDIENCE, select: baseSelect,
      }) as Row[]);
    }

    case "RECORRENTE_SUMIDO":
      return serialize(await prisma.customer.findMany({
        where: {
          ...baseWhere,
          totalOrders: { gte: 2 },
          OR: [
            { lastOrderAt: { gte: cutoffs.warmCutoff, lt: cutoffs.hotCutoff } },
            { lastOrderAt: null, importedLastOrderAt: { gte: cutoffs.warmCutoff, lt: cutoffs.hotCutoff } },
          ],
        },
        orderBy: { totalOrders: "desc" },
        take: MAX_AUDIENCE, select: baseSelect,
      }) as Row[]);

    case "RECORRENTES":
      return serialize(await prisma.customer.findMany({
        where: { ...baseWhere, totalOrders: { gte: 2 } },
        orderBy: { totalOrders: "desc" },
        take: MAX_AUDIENCE, select: baseSelect,
      }) as Row[]);

    case "ANIVERSARIANTES": {
      /**
       * NO DIA DO ANIVERSÁRIO — decisão do CEO, 06/09/2026.
       *
       * ── O QUE ESTAVA ERRADO, medido contra Postgres real no raio-x ────────
       *
       * O filtro era do MÊS inteiro (`birthDate.getMonth() === currentMonth`), e
       * ele rodava em JS DEPOIS do `take: MAX_AUDIENCE`. Base de 1.200 clientes,
       * dia 9 de setembro:
       *
       *     fazem aniversário no mês ....... 100
       *     fazem aniversário HOJE .......... 15
       *     a campanha devolvia ............. 40
       *     desses 40, faziam hoje ........... 6
       *
       * Ou seja: **34 de 40 mensagens diziam "Feliz aniversário" no dia errado**,
       * cada uma queimando um cupom do orçamento mensal — e 60 dos 100
       * aniversariantes do mês eram inalcançáveis, porque o corte vinha antes do
       * filtro. Era a parede das 500 (PR #183) num lugar que aquele PR não tocou.
       *
       * O repositório tinha QUATRO respostas diferentes para a mesma pergunta, e
       * a única certa estava no motor aposentado (`AutomationSchedulerService`).
       *
       * ── O QUE ENTRA ──────────────────────────────────────────────────────
       *
       * O dia e o mês entram na CONSULTA, antes de qualquer corte. `birthDate` é
       * `timestamp` sem fuso, então `EXTRACT` sobre ele é estável — não depende
       * do fuso da sessão do banco.
       *
       * E "hoje" é o hoje DO RESTAURANTE, não o do servidor. O servidor roda em
       * UTC; sem isso, das 21h à meia-noite em Brasília o sistema já estaria
       * parabenizando os aniversariantes de amanhã. É o mesmo defeito de fuso que
       * o raio-x achou no motor de promoção.
       */
      const dono = await prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: { timezone: true },
      });
      const fuso = dono?.timezone || "America/Sao_Paulo";
      const hojeNaLoja = new Intl.DateTimeFormat("en-CA", {
        timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit",
      }).format(now); // "AAAA-MM-DD"
      const mes = Number(hojeNaLoja.slice(5, 7));
      const dia = Number(hojeNaLoja.slice(8, 10));

      const doDia = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM customers
        WHERE "restaurantId" = ${restaurantId}
          AND "birthDate" IS NOT NULL
          AND EXTRACT(MONTH FROM "birthDate") = ${mes}
          AND EXTRACT(DAY   FROM "birthDate") = ${dia}
      `;
      if (doDia.length === 0) return serialize([]);

      // O corte só acontece DEPOIS de o dia já ter filtrado — nunca antes.
      return serialize(await prisma.customer.findMany({
        where: { ...baseWhere, id: { in: doDia.map((r) => r.id) } },
        orderBy: { totalOrders: "desc" },
        take: MAX_AUDIENCE,
        select: baseSelect,
      }) as Row[]);
    }

    case "TODOS":
    default:
      return serialize(await prisma.customer.findMany({
        where: baseWhere,
        orderBy: { lastOrderAt: "desc" },
        take: MAX_AUDIENCE, select: baseSelect,
      }) as Row[]);
  }
}

// ─── message personalization ──────────────────────────────────

interface MessageContext {
  restaurantName:  string;
  pedidoUrl:       string;
  googleReviewUrl: string | null;
  instagramUrl?:   string | null;
}

export function personalizeMessage(
  template: string,
  customer: AudienceCustomer,
  ctx: MessageContext
): string {
  // Delegates to the single canonical CRM renderer so every send path (campaigns,
  // automations, recurring runner) resolves variables, double braces and links
  // identically ({instagram} goes through buildInstagramUrl inside the renderer).
  // The exact saved template is rendered — no AI prefix, no rewrite.
  return renderCrmMessage(
    template,
    {
      name: customer.name,
      tier: customer.tier,
      lastOrderAt: customer.lastOrderAt,
      id: customer.id,
      // ⭐ O telefone é o que faz `{link_cardapio}` abrir JÁ IDENTIFICADO. Ele
      // sempre esteve aqui em `AudienceCustomer` e não era repassado — por isso
      // o cupom do CRM caía numa tela pedindo "informe seu WhatsApp", do lado de
      // fora do cadastro que continha o próprio cupom.
      phone: customer.phone,
    },
    ctx,
  );
}

// ─── campaign creation ────────────────────────────────────────

export class CrmCampaignService {
  /**
   * Create a campaign: resolve audience, personalize messages, persist.
   * Returns the campaign with all recipients.
   */
  static async create(
    restaurantId: string,
    input: CreateCampaignInput
  ): Promise<{ campaignId: string; totalAudience: number; recipients: CampaignRecipientRow[] }> {
    // Load context data
    const [restaurant, brandConfig, agentCfg] = await Promise.all([
      prisma.restaurant.findUnique({
        where: { id: restaurantId },
        select: { name: true, slug: true },
      }),
      prisma.restaurantBrandConfig.findUnique({
        where: { restaurantId },
        select: { googleReviewUrl: true, instagramUrl: true },
      }),
      prisma.whatsAppAgentConfig.findUnique({
        where: { restaurantId },
        select: { menuUrl: true },
      }),
    ]);

    // Same menu link the WhatsApp agent sends: owner-configured URL (Cardápio page) wins,
    // fall back to the auto /pedido/{slug} link; /qr/ remapped to /pedido/.
    const rawMenuUrl   = agentCfg?.menuUrl?.trim() || (restaurant?.slug ? getPublicMenuUrl(restaurant.slug) : null);
    const fixedMenuUrl = rawMenuUrl?.replace(/\/qr\/([^/?]+)/, "/pedido/$1") ?? rawMenuUrl;
    const pedidoUrl    = fixedMenuUrl ? sanitizeCustomerUrl(fixedMenuUrl) : getPublicSiteUrl();

    const ctx: MessageContext = {
      restaurantName:  restaurant?.name ?? "nossa loja",
      pedidoUrl,
      googleReviewUrl: brandConfig?.googleReviewUrl ?? null,
      instagramUrl:    brandConfig?.instagramUrl    ?? null,
    };

    // Recurring campaigns resolve audience at execution time, not creation time
    const isRecurring = (input.scheduleConfig as { mode?: string } | undefined)?.mode === "RECURRING";

    const customers = isRecurring
      ? []
      : await resolveAudience(restaurantId, input.targetSegment, input.templateId);

    // Create campaign + executions in a transaction
    const campaign = await prisma.$transaction(async (tx) => {
      const c = await tx.campaign.create({
        data: {
          restaurantId,
          name:           input.name,
          message:        input.messageTemplate,
          objective:      input.objective ?? null,
          channel:        input.channel ?? "WHATSAPP",
          targetSegment:  input.targetSegment,
          templateId:     input.templateId ?? null,
          totalAudience:  customers.length,
          // RECURRING → ACTIVE immediately; scheduled once → SCHEDULED; else DRAFT
          status:         isRecurring ? "ACTIVE" as never : (input.scheduledAt ? "SCHEDULED" : "DRAFT"),
          scheduledAt:    input.scheduledAt ?? null,
          scheduleConfig: input.scheduleConfig ?? undefined,
          audienceConfig: input.audienceConfig ?? undefined,
          couponCode:     input.couponCode     ?? null,
          promotionId:    input.promotionId    ?? null,
          // Governance identity: concept key + message fingerprint enable dedupe
          // and impact memory that survive delete/recreate.
          campaignFamilyKey:  input.campaignFamilyKey?.trim() || suggestCampaignFamilyKey({ name: input.name, objective: input.objective }),
          messageFingerprint: generateMessageFingerprint(input.messageTemplate),
          dedupePolicy:       input.dedupePolicy ?? undefined,
        },
      });

      if (!isRecurring && customers.length > 0) {
        await tx.campaignExecution.createMany({
          data: customers.map((customer) => ({
            campaignId:    c.id,
            restaurantId,
            customerId:    customer.id,
            customerName:  customer.name,
            customerPhone: customer.phone,
            messageText:   personalizeMessage(input.messageTemplate, customer, ctx),
            status:        "PENDING",
          })),
        });
      }

      return c;
    });

    // Fetch created executions
    const executions = await prisma.campaignExecution.findMany({
      where:   { campaignId: campaign.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, customerId: true, customerName: true,
        customerPhone: true, messageText: true, status: true,
      },
    });

    const recipients: CampaignRecipientRow[] = executions.map((e) => ({
      id:            e.id,
      customerId:    e.customerId,
      customerName:  e.customerName ?? "",
      customerPhone: e.customerPhone ?? "",
      messageText:   e.messageText ?? "",
      status:        e.status,
    }));

    return { campaignId: campaign.id, totalAudience: customers.length, recipients };
  }

  /**
   * Execute sending for a campaign.
   * Accepts message overrides (user may have edited messages in the review UI).
   * Requires human to have clicked "Enviar mensagens" — never called automatically.
   */
  static async send(
    campaignId: string,
    restaurantId: string,
    input: SendInput
  ): Promise<SendResult> {
    // Validate campaign ownership
    const campaign = await prisma.campaign.findUnique({
      where:  { id: campaignId },
      select: { id: true, restaurantId: true, status: true, templateId: true, objective: true, targetSegment: true, audienceConfig: true },
    });

    if (!campaign || campaign.restaurantId !== restaurantId) {
      throw new Error("Campaign not found");
    }

    // Birthday campaigns bypass cross-campaign frequency cooldowns; they
    // still respect opt-out, phone validation, and WhatsApp availability.
    const isBirthday = isBirthdayCampaign(campaign);
    if (campaign.status === "SENT" || campaign.status === "SENDING") {
      throw new Error("Campaign is already sent or sending");
    }

    // Canal único: ou o WhatsApp oficial está conectado, ou este envio não começa.
    // A campanha continua PENDING e o operador vê o erro na hora — falhar antes de
    // marcar SENDING é melhor que uma campanha travada em "enviando" sem canal.
    if (!(await isWhatsAppChannelConnected(restaurantId))) {
      throw new Error(`WhatsApp not configured: ${NO_WHATSAPP_CONFIG_DETAIL}`);
    }

    // Mark campaign as SENDING
    await prisma.campaign.update({
      where: { id: campaignId },
      data:  { status: "SENDING" },
    });

    // Build override map
    const overrideMap = new Map(input.messages.map((m) => [m.recipientId, m.messageText]));

    // Fetch executions — honour caller-supplied batch limit if set
    const executions = await prisma.campaignExecution.findMany({
      where:   { campaignId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take:    input.limit && input.limit > 0 ? input.limit : undefined,
      select: { id: true, customerId: true, customerPhone: true, messageText: true },
    });

    // Pre-fetch opt-out status for all customers in this batch (safety check)
    const customerIds = executions.map((e) => e.customerId).filter(Boolean) as string[];
    const optedOutIds = new Set(
      customerIds.length > 0
        ? (await prisma.customer.findMany({
            where: { id: { in: customerIds }, hasOptedOut: true },
            select: { id: true },
          })).map((c) => c.id)
        : []
    );

    // Customer first names — needed to fill Meta template body params (e.g. {{1}}=nome).
    // Cheap single batch.
    const customerNames = new Map<string, string>(
      customerIds.length > 0
        ? (await prisma.customer.findMany({
            where:  { id: { in: customerIds } },
            select: { id: true, name: true },
          })).map((c) => [c.id, c.name] as [string, string])
        : []
    );

    // Pre-fetch customers already successfully reached via any other campaign in the last 24 h.
    // Prevents sending the same customer a second CRM WhatsApp message on the same day.
    // Birthday campaigns are exempt: their window occurs at most once per year per customer
    // and must not be blocked by a recent promotion or reactivation message.
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentlySentIds = new Set(
      !isBirthday && customerIds.length > 0
        ? (await prisma.campaignExecution.findMany({
            where: {
              restaurantId,
              customerId:   { in: customerIds },
              campaignId:   { not: campaignId },
              status:       { in: ["SENT", "DELIVERED", "READ"] },
              sentAt:       { gte: cutoff24h },
            },
            select: { customerId: true },
          })).map((e) => e.customerId).filter(Boolean) as string[]
        : []
    );

    // Unified contact-safety context (built once per batch). This is the
    // authoritative gate — it ADDS per-customer cooldown + weekly-cap
    // enforcement on top of the legacy opt-out / phone / 24h guards below.
    // Manual send is human-triggered: time-window and daily-cap gates are
    // overridden (a human explicitly clicked "Enviar"), but every per-customer
    // safety rule (opt-out, contactability, phone, cooldown, weekly cap,
    // cross-campaign 24h dedup) is still enforced.
    // Canal já confirmado no início do send() — repetir o que foi verificado, não presumir.
    const safetyContext = await ContactSafetyService.buildGlobalContext(restaurantId, {
      whatsappAvailable: true,
    });

    let totalSent        = 0;
    let totalFailed      = 0;
    let totalBlocked     = 0;
    let totalSkipped     = 0;
    let duplicateSkipped = 0;
    const results: SendResult["results"] = [];

    for (const exec of executions) {
      // Authoritative unified safety gate.
      const decision = await ContactSafetyService.assertSendable({
        restaurantId,
        customerId:    exec.customerId ?? null,
        phone:         exec.customerPhone ?? null,
        campaignId,
        isBirthday,
        enforceTimeWindows: false, // human-triggered manual send
        enforceDailyCap:    false, // human override
        context:        safetyContext,
      });
      if (!decision.sendable) {
        // Safety block — recorded as BLOCKED (not a failure), machine reason kept.
        await prisma.campaignExecution.update({
          where: { id: exec.id },
          data:  { status: "BLOCKED" as never, failedReason: decision.detail ?? decision.reason ?? "Bloqueado", errorMessage: decision.reason ?? "UNKNOWN_ERROR" },
        });
        totalBlocked++;
        if (decision.reason === "RECENT_CRM_MESSAGE_24H" || decision.reason === "DUPLICATE_CAMPAIGN_RECIPIENT") {
          duplicateSkipped++;
        }
        results.push({ id: exec.id, status: "BLOCKED", error: decision.reason ?? "BLOCKED" });
        continue;
      }

      // 24 h duplicate guard: não envia se este cliente já recebeu uma mensagem
      // de CRM bem-sucedida de outra campanha hoje.
      if (exec.customerId && recentlySentIds.has(exec.customerId)) {
        await prisma.campaignExecution.update({
          where: { id: exec.id },
          data:  { status: "BLOCKED" as never, failedReason: "Mensagem recente (24h)", errorMessage: "RECENT_CRM_MESSAGE_24H" },
        });
        duplicateSkipped++;
        totalBlocked++;
        results.push({ id: exec.id, status: "BLOCKED", error: "DUPLICATE_24H_SKIP" });
        continue;
      }

      // LGPD safety: skip opted-out customers even if they slipped into the execution list
      if (exec.customerId && optedOutIds.has(exec.customerId)) {
        await prisma.campaignExecution.update({
          where: { id: exec.id },
          data:  { status: "BLOCKED" as never, failedReason: "Cliente opt-out", errorMessage: "CUSTOMER_OPTED_OUT" },
        });
        totalBlocked++;
        results.push({ id: exec.id, status: "BLOCKED", error: "Cliente opt-out" });
        continue;
      }

      const phone = normalizePhoneBR(exec.customerPhone);
      if (!isValidPhoneBR(phone)) {
        // Recipient-data problem — SKIP antes de qualquer chamada ao canal. Isto NÃO é
        // falha de provedor e nunca pode ser contado em "Falhas".
        const hasRawPhone = Boolean((exec.customerPhone ?? "").trim());
        await prisma.campaignExecution.update({
          where: { id: exec.id },
          data:  hasRawPhone
            ? { status: "SKIPPED" as never, failedReason: "Telefone inválido", errorMessage: "INVALID_PHONE_FORMAT" }
            : { status: "SKIPPED" as never, failedReason: "Sem telefone",      errorMessage: "MISSING_PHONE" },
        });
        totalSkipped++;
        results.push({ id: exec.id, status: "SKIPPED", error: hasRawPhone ? "Telefone inválido" : "Sem telefone" });
        continue;
      }

      const messageText = overrideMap.get(exec.id) ?? exec.messageText ?? "";
      if (!messageText.trim()) {
        await prisma.campaignExecution.update({
          where: { id: exec.id },
          data:  { status: "FAILED", failedReason: "Mensagem vazia" },
        });
        totalFailed++;
        results.push({ id: exec.id, status: "FAILED", error: "Mensagem vazia" });
        continue;
      }

      try {
        // Envio pelo canal único. Marketing para audiência fria está fora da janela
        // de 24h → tem que ser modelo APROVADO; `sendMetaCrmMessage` resolve o modelo
        // da campanha e preenche os parâmetros, caindo em texto livre só quando não
        // há modelo nenhum configurado.
        const firstName = (customerNames.get(exec.customerId ?? "") ?? "").split(" ")[0] || "Cliente";
        const { result: sendResult } = await sendMetaCrmMessage(WhatsAppMessagingService, {
          restaurantId, phone, freeformText: messageText, firstName,
          campaign: { objective: campaign.objective, audienceConfig: campaign.audienceConfig },
        });

        // Recusa deliberada da política do canal (ex.: fora da janela de 24h sem
        // modelo aprovado) é BLOQUEIO, não falha de entrega — e não some da tela.
        if (!sendResult.ok && sendResult.status === "BLOCKED") {
          await prisma.campaignExecution.update({
            where: { id: exec.id },
            data:  {
              status:       "BLOCKED" as never,
              failedReason: sendResult.error ?? "Envio bloqueado pela política do canal",
              errorMessage: sendResult.blockReason ?? "CHANNEL_POLICY_BLOCKED",
            },
          });
          totalBlocked++;
          results.push({ id: exec.id, status: "BLOCKED", error: sendResult.blockReason ?? "CHANNEL_POLICY_BLOCKED" });
          continue;
        }
        if (!sendResult.ok) {
          throw new SendFailure(sendResult.error ?? "Falha no envio", sendResult.errorCode ?? "SEND_FAILED");
        }

        const externalMessageId = sendResult.providerMessageId;
        const providerUsed      = sendResult.provider;

        const now = new Date();

        // Find or create WhatsApp conversation for this customer
        const convId = await findOrCreateCrmConversation(
          restaurantId, exec.customerId, exec.customerPhone!, campaignId
        );

        // Force CRM context on the (re)used conversation so the AI greeting guard
        // fires on the customer's reply and Central shows the "Campanha enviada" badge.
        await markConversationCrmContext(convId, "CRM_CAMPAIGN", { relatedCampaignId: campaignId });

        // Log outbound message in Chat Inbox.
        // Intentionally do NOT update Conversation.lastMessageAt here — CRM outbound
        // messages must not float campaign conversations above real support threads
        // in the Atendimento sort order. lastMessageAt is updated only when the
        // customer sends an inbound reply (handled by WebhookProcessorService).
        await prisma.$transaction([
          prisma.message.create({
            data: {
              conversationId:    convId,
              direction:         "OUTBOUND",
              senderType:        "AI",
              content:           messageText,
              type:              "TEXT",
              sentAt:            now,
              externalMessageId,
              externalStatus:    "sent",
              metadata:          { ...buildConversationMetadataForCrmSend(campaignId, exec.id) as object, crmProvider: providerUsed },
            },
          }),
          prisma.campaignExecution.update({
            where: { id: exec.id },
            data: {
              status:      "SENT",
              sentAt:      now,
              messageText,         // persist final text (may differ from original draft)
            },
          }),
        ]);

        totalSent++;
        results.push({ id: exec.id, status: "SENT" });
      } catch (err) {
        // Falha real de envio — o código do provedor é preservado para a classificação.
        const isSendFailure = err instanceof SendFailure;
        const errMsg    = isSendFailure ? err.message : (err instanceof Error ? err.message : "Erro desconhecido");
        const errorCode = isSendFailure ? err.errorCode : errMsg;
        await prisma.campaignExecution.update({
          where: { id: exec.id },
          data:  { status: "FAILED", failedReason: errMsg, errorMessage: errorCode },
        });
        totalFailed++;
        results.push({ id: exec.id, status: "FAILED", error: errMsg });
      }
    }

    // Finalize campaign status + counters
    await prisma.campaign.update({
      where: { id: campaignId },
      data:  {
        status:      totalSent === 0 ? "CANCELLED" : "SENT",
        sentAt:      new Date(),
        totalSent:   { increment: totalSent   },
        totalFailed: { increment: totalFailed },
      },
    });

    return { totalSent, totalFailed, totalBlocked, totalSkipped, duplicateSkipped, results };
  }
}

// ─── helper: find or create WhatsApp conversation ─────────────

async function findOrCreateCrmConversation(
  restaurantId: string,
  customerId:   string,
  phone:        string,
  campaignId:   string
): Promise<string> {
  // Prefer existing OPEN/BOT/HUMAN WhatsApp conversation
  const existing = await prisma.conversation.findFirst({
    where: {
      restaurantId,
      customerId,
      channel: "WHATSAPP",
      status:  { in: [ConversationStatus.OPEN, ConversationStatus.BOT, ConversationStatus.HUMAN] },
    },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true },
  });

  if (existing) return existing.id;

  // Get customer name for denormalized fields
  const customer = await prisma.customer.findUnique({
    where:  { id: customerId },
    select: { name: true, phone: true },
  });

  // Create a fresh conversation tagged with the CRM campaign
  const conv = await prisma.conversation.create({
    data: {
      restaurantId,
      customerId,
      channel:          "WHATSAPP",
      status:           ConversationStatus.OPEN,
      customerPhone:    customer?.phone ?? phone,
      customerName:     customer?.name ?? phone,
      contextType:      CONTEXT_TYPE.CRM_CAMPAIGN,
      relatedCampaignId: campaignId,
    },
  });

  return conv.id;
}
