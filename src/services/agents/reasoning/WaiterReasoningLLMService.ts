/**
 * WaiterReasoningLLMService — the real LLM reasoning call (structured JSON output).
 *
 * Routed through the Brain's engine dispatcher (selectEngineRouted +
 * callStructuredJson) — trocar o piloto do waiter é config governada, não
 * caça a código. The model acts as a restaurant-service + consultative-sales +
 * agent-safety expert.
 * It MUST answer the customer's actual question (payment→payment), never change
 * the subject, and never invent facts when context is missing.
 *
 * Throws if OPENAI_API_KEY is absent or the call/parse fails — the caller
 * (WaiterReasoningService) then falls back to the deterministic reasoning.
 */

import { selectEngineRouted } from "@/services/brain/engines/AIEngineRouter";
import { callStructuredJson } from "@/services/brain/engines/OpenAIEngineAdapter";
import type { AgentReasoningContext, AgentReasoningIntent, AgentReasoningInput } from "./AgentReasoningTypes";

export interface LLMReasoningCore {
  primaryIntent: AgentReasoningIntent;
  secondaryIntents: AgentReasoningIntent[];
  confidence: number;
  customerNeed: string;
  directAnswerStrategy: string;
  idealResponse: string;
  trainingRule: string;
  expectedImpact: string;
  safetyNotes: string[];
  shouldEscalate: boolean;
  escalationReason?: string;
}

const SYSTEM_PROMPT =
  "Você é um especialista em atendimento de restaurante, venda consultiva, condução de pedido, " +
  "segurança operacional (anti-alucinação) e treinamento de agentes de IA do Foocci. " +
  "Você analisa UMA fala real (já sanitizada) de cliente e raciocina ANTES de propor treinamento. " +
  "REGRAS OBRIGATÓRIAS: (1) identifique a intenção principal real; (2) a resposta ideal deve responder " +
  "DIRETAMENTE à pergunta do cliente — nunca troque de assunto; (3) se a pergunta for sobre pagamento, " +
  "responda sobre pagamento; (4) use apenas o CONTEXTO fornecido — se faltar contexto, NÃO invente " +
  "(diga que precisa confirmar); (5) mantenha o cliente no fluxo do pedido; (6) resposta ideal curta e " +
  "aplicável; (7) gere também a regra de treinamento e o impacto esperado. " +
  "Responda SOMENTE em JSON com as chaves: primaryIntent, secondaryIntents (array), confidence (0..1), " +
  "customerNeed, directAnswerStrategy, idealResponse, trainingRule, expectedImpact, safetyNotes (array), " +
  "shouldEscalate (boolean), escalationReason. " +
  "primaryIntent ∈ [PAYMENT_QUESTION, PAYMENT_BENEFIT_QUESTION, MENU_QUESTION, PRICE_QUESTION, " +
  "DELIVERY_QUESTION, PICKUP_QUESTION, ORDER_BY_TEXT, INDECISIVE_CUSTOMER, HUNGRY_CUSTOMER, GROUP_ORDER, " +
  "DIETARY_RESTRICTION, COMPLAINT, PRAISE, ABANDONMENT_RISK, UPSELL_ACCEPTED, UPSELL_REJECTED, GENERAL_SUPPORT, UNKNOWN].";

function contextBlock(ctx: AgentReasoningContext): string {
  const pm = ctx.paymentMethods.length ? ctx.paymentMethods.join(", ") : "(não cadastrado)";
  return [
    `Restaurante: ${ctx.restaurantName ?? "(desconhecido)"}`,
    `Formas de pagamento cadastradas: ${pm}`,
    `Aceita benefício refeição (Alelo/VR/Sodexo)? ${ctx.knowsMealVoucher ? "sim" : "NÃO CADASTRADO — não afirme que aceita"}`,
    `Delivery: ${ctx.acceptsDelivery == null ? "(desconhecido)" : ctx.acceptsDelivery ? "sim" : "não"}`,
    `Retirada: ${ctx.acceptsPickup == null ? "(desconhecido)" : ctx.acceptsPickup ? "sim" : "não"}`,
    `Contexto ausente (NÃO inventar): ${ctx.missingContext.join("; ") || "nenhum"}`,
  ].join("\n");
}

export async function reasonWithLLM(
  input: AgentReasoningInput,
  ctx: AgentReasoningContext,
  /** Optional guardrail intent that MUST be respected. */
  forcedIntent?: AgentReasoningIntent | null,
): Promise<LLMReasoningCore> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY ausente");

  const userContent = [
    `CONTEXTO DO RESTAURANTE:\n${contextBlock(ctx)}`,
    forcedIntent ? `\nINTENÇÃO OBRIGATÓRIA (guardrail determinístico): ${forcedIntent} — respeite-a.` : "",
    `\nMENSAGEM DO CLIENTE (sanitizada): "${input.customerMessage}"`,
    input.waiterResponse ? `\nRESPOSTA ATUAL DO WAITER (sanitizada): "${input.waiterResponse}"` : "",
  ].join("\n");

  const selection = await selectEngineRouted("waiter", { taskProfile: "REASON" });
  if (selection.provider === "MOCK") throw new Error("nenhum piloto de IA configurado");
  const raw = await callStructuredJson({
    selection,
    systemPrompt: SYSTEM_PROMPT,
    userContent,
    temperature: 0.2,
    // Só o agente. O contexto de raciocínio traz o NOME do restaurante, não o
    // id — e nome não é id. Fica sem restaurante, com o gasto contabilizado.
    context: { agentSlug: "waiter" },
  });
  const parsed = JSON.parse(raw) as Partial<LLMReasoningCore>;
  if (!parsed.primaryIntent || !parsed.idealResponse || !parsed.trainingRule) {
    throw new Error("LLM JSON incompleto");
  }

  return {
    primaryIntent: (forcedIntent ?? parsed.primaryIntent) as AgentReasoningIntent,
    secondaryIntents: Array.isArray(parsed.secondaryIntents) ? parsed.secondaryIntents : [],
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7,
    customerNeed: parsed.customerNeed ?? "",
    directAnswerStrategy: parsed.directAnswerStrategy ?? "",
    idealResponse: parsed.idealResponse,
    trainingRule: parsed.trainingRule,
    expectedImpact: parsed.expectedImpact ?? "",
    safetyNotes: Array.isArray(parsed.safetyNotes) ? parsed.safetyNotes : [],
    shouldEscalate: parsed.shouldEscalate === true,
    escalationReason: parsed.escalationReason,
  };
}
