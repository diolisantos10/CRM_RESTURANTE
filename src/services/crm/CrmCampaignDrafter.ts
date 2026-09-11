/**
 * CrmCampaignDrafter — cria uma campanha a partir de um PEDIDO em linguagem
 * natural (texto ou voz). O lojista fala/digita "quero recuperar quem sumiu há
 * mais de 30 dias com 10% de desconto" e a IA monta o rascunho da campanha:
 * objetivo, público-alvo, mensagem (no tom, sem inventar) e cupom sugerido.
 *
 * Texto → extração estruturada pelo motor governado (selectEngineRouted "crm").
 * Voz → transcrição (Whisper) antes. Devolve um RASCUNHO para o lojista revisar
 * e criar — nunca cria/envia sozinho.
 */

import { selectEngineRouted } from "@/services/brain/engines/AIEngineRouter";
import { callStructuredJson } from "@/services/brain/engines/OpenAIEngineAdapter";
import { buildCrmProfileDirective } from "@/services/crm/CrmAgentProfile";
import { detectSpamLanguage } from "@/services/crm/MessageVariationService";
export { transcribeAudio } from "@/services/brain/engines/TranscriptionAdapter";

/** Segmentos e objetivos aceitos pela criação de campanha. */
export const DRAFT_SEGMENTS = ["FRIO", "MORNO", "QUENTE", "VIP", "PRIMEIRO_PEDIDO", "RECORRENTE_SUMIDO", "TODOS"] as const;
export const DRAFT_OBJECTIVES = ["RECUPERAR", "RECOMPRA", "TICKET", "BEBIDA", "SOBREMESA", "AVALIACAO", "VIP", "OUTRO"] as const;

export interface CampaignDraft {
  name: string;
  objective: string;
  targetSegment: string;
  messageTemplate: string;
  couponPercent: number | null;
  notes: string;
}

function coerceEnum(value: unknown, allowed: readonly string[], fallback: string): string {
  const v = typeof value === "string" ? value.toUpperCase().trim() : "";
  return allowed.includes(v) ? v : fallback;
}

/** Monta o rascunho de campanha a partir do pedido em texto. Nunca cria/envia. */
export async function draftCampaign(restaurantId: string, requestText: string): Promise<{ ok: boolean; draft?: CampaignDraft; error?: string }> {
  const text = requestText.trim();
  if (!text) return { ok: false, error: "pedido vazio" };
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === "not-configured") {
    return { ok: false, error: "IA não configurada" };
  }

  const selection = await selectEngineRouted("crm", { businessId: restaurantId, taskProfile: "GENERATE" });

  const systemPrompt = [
    buildCrmProfileDirective(),
    "",
    "TAREFA: transformar o PEDIDO do lojista numa campanha de CRM (WhatsApp). Responda SOMENTE em JSON:",
    "{ name, objective, targetSegment, messageTemplate, couponPercent, notes }",
    `• objective ∈ [${DRAFT_OBJECTIVES.join(", ")}] (RECUPERAR = trazer de volta; RECOMPRA = comprar de novo; OUTRO se não encaixar).`,
    `• targetSegment ∈ [${DRAFT_SEGMENTS.join(", ")}] (FRIO/MORNO/QUENTE por recência; VIP; PRIMEIRO_PEDIDO; TODOS).`,
    "• messageTemplate: mensagem curta, no tom da marca, com {nome} e, quando útil, {link_cardapio}. Use {cupom} SÓ se houver desconto no pedido. NUNCA invente preço/produto/promoção.",
    "• couponPercent: número do desconto se o lojista pediu (ex.: 10), senão null. Nada de spam ('imperdível', 'clique agora').",
    "• name: nome curto e claro da campanha. notes: 1 frase do que você entendeu.",
  ].join("\n");

  let raw: string;
  try {
    raw = await callStructuredJson({
      selection,
      systemPrompt,
      userContent: `PEDIDO DO LOJISTA: "${text}"`,
      temperature: 0.4,
      maxTokens: 400,
      context: { restaurantId, agentSlug: "crm" },
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 120) : "erro no motor de IA" };
  }

  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(raw) as Record<string, unknown>; }
  catch { return { ok: false, error: "não consegui interpretar o pedido" }; }

  const messageTemplate = String(parsed.messageTemplate ?? "").trim();
  if (!messageTemplate || detectSpamLanguage(messageTemplate).length > 0) {
    return { ok: false, error: "não consegui montar uma mensagem segura — tente reformular o pedido" };
  }
  const rawPct = Number(parsed.couponPercent);
  const couponPercent = Number.isFinite(rawPct) && rawPct > 0 && rawPct <= 90 ? Math.round(rawPct) : null;

  return {
    ok: true,
    draft: {
      name: String(parsed.name ?? "Nova campanha").slice(0, 80),
      objective: coerceEnum(parsed.objective, DRAFT_OBJECTIVES, "OUTRO"),
      targetSegment: coerceEnum(parsed.targetSegment, DRAFT_SEGMENTS, "TODOS"),
      messageTemplate: messageTemplate.slice(0, 600),
      couponPercent,
      notes: String(parsed.notes ?? "").slice(0, 200),
    },
  };
}
