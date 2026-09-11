/**
 * EngineAdapter — o contrato comum de todo piloto (IA) plugado no Brain.
 *
 * "A IA é o piloto: troca-troca." Cada provider implementa UMA função de
 * chamada estruturada; o dispatcher (callStructuredJson) roteia pela seleção
 * do AIEngineRouter. Nenhum consumidor do Brain conhece SDK de provider.
 */

import type { AIEngineSelection } from "./AIEngineTypes";

export interface StructuredCallInput {
  selection: AIEngineSelection;
  systemPrompt: string;
  userContent: string;
  temperature?: number;
  maxTokens?: number;
  /** "json" (default) força objeto JSON; "text" devolve texto livre. */
  responseFormat?: "json" | "text";
  /**
   * Entrada visual opcional (data URL base64, ex.: leitura de nota de compra).
   * Suportada hoje pelo piloto OPENAI; os demais lançam erro claro — o caller
   * decide o fallback, como em qualquer falha de engine.
   */
  imageDataUrl?: string;
  /**
   * De onde veio esta chamada. OPCIONAL de propósito — nenhum chamador existente
   * é obrigado a mudar. Quem passa, tem o gasto ATRIBUÍDO; quem não passa, é
   * contabilizado como origem desconhecida. O que nunca acontece é a chamada
   * sumir da contabilidade por falta de contexto.
   */
  context?: EngineCallContext;
}

export interface EngineCallContext {
  /** Restaurante dono da chamada. Ausente = origem sem dono (SDR, oficina, FAQ). */
  restaurantId?: string;
  /** Slug do agente. Ausente = "não atribuído" — NUNCA um chute. */
  agentSlug?: string;
  conversationId?: string;
}

/**
 * Contagem de tokens devolvida pelo provedor NA MESMA resposta.
 *
 * `desconhecido: true` é um estado de primeira classe, não um zero. Provedor que
 * não devolveu `usage` não gastou zero — não se sabe quanto gastou, e custo
 * calculado sobre zero seria um número inventado com cara de auditado.
 */
export interface EngineUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly desconhecido: boolean;
}

export const USO_DESCONHECIDO: EngineUsage = {
  promptTokens: 0,
  completionTokens: 0,
  desconhecido: true,
};

/** O que um adapter de provider devolve: o texto E o que ele custou. */
export interface StructuredCallResult {
  readonly raw: string;
  readonly usage: EngineUsage;
}

/** Cada adapter de provider implementa isto. Lança em erro — o caller decide o fallback. */
export type EngineCall = (input: StructuredCallInput) => Promise<StructuredCallResult>;
