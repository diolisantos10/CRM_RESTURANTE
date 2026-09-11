/**
 * FalhaDeMotor — o PORQUÊ de a IA não ter respondido, em vez de só "não veio".
 *
 * ── O buraco que isto tapa ───────────────────────────────────────────────────
 * Todo consumidor do Brain tem um caminho determinístico para quando a IA falha,
 * e isso é certo. O errado era o silêncio: `catch { return null }` engole
 * igualmente uma chave ausente (config), um timeout (rede), um JSON quebrado
 * (modelo) e uma resposta cortada pelo teto de tokens (limite). São quatro
 * problemas com quatro donos diferentes, e nenhum aparecia em lugar nenhum.
 *
 * Guardrail 6 da casa: o alerta carrega a própria evidência. Um motivo nomeado é
 * a menor evidência possível — e é o que o diário do SDR precisa registrar por
 * turno para alguém conseguir dizer "a IA parou de responder ontem às 14h porque
 * a chave saiu do ar", em vez de "às vezes ele não entende".
 *
 * Não guarda conteúdo de mensagem: só a forma da falha.
 */

import type { EngineUsage } from "./EngineAdapter";

/** Por que a IA não devolveu leitura utilizável. */
export type MotivoDeFalhaDaIA =
  /** Não há credencial configurada — o motor nem chegou a ser chamado. */
  | "sem_chave"
  /** A chamada demorou demais ou foi abortada. */
  | "timeout"
  /** Rede/servidor do provedor: conexão caiu, 5xx, DNS. */
  | "erro_de_rede"
  /** O modelo respondeu, mas o texto não era JSON válido. */
  | "json_invalido"
  /** O modelo bateu no teto de tokens e a resposta veio pela metade. */
  | "cortado_por_limite"
  /** A resposta veio vazia (sem conteúdo, sem erro). */
  | "sem_conteudo"
  /** Nenhum dos acima — fica declarado como desconhecido, nunca como sucesso. */
  | "desconhecido";

/** Erro do motor que já sabe se explicar. */
export class FalhaDeMotor extends Error {
  readonly motivo: MotivoDeFalhaDaIA;
  /**
   * Tokens que a chamada CONSUMIU mesmo tendo falhado. Resposta cortada pelo
   * teto e resposta vazia são cobradas pelo provedor — o gasto existe e precisa
   * entrar na conta. `undefined` = a falha aconteceu ANTES de o provedor rodar
   * (sem chave, por exemplo) e não há nada a contabilizar.
   */
  readonly usage?: EngineUsage;

  constructor(motivo: MotivoDeFalhaDaIA, detalhe: string, usage?: EngineUsage) {
    super(`${motivo}: ${detalhe}`);
    this.name = "FalhaDeMotor";
    this.motivo = motivo;
    this.usage = usage;
  }
}

function textoDoErro(e: unknown): string {
  if (e instanceof Error) return `${e.name} ${e.message}`.toLowerCase();
  return String(e ?? "").toLowerCase();
}

function statusDoErro(e: unknown): number | null {
  if (e && typeof e === "object" && "status" in e) {
    const s = (e as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return null;
}

/**
 * Classifica QUALQUER erro vindo de uma chamada de motor.
 *
 * Nunca devolve null: quando não dá para saber, devolve `desconhecido`. Ausência
 * de informação não é informação (guardrail 1) — mas ela fica escrita.
 */
export function classificarFalhaDeMotor(e: unknown): MotivoDeFalhaDaIA {
  if (e instanceof FalhaDeMotor) return e.motivo;

  const status = statusDoErro(e);
  if (status === 401 || status === 403) return "sem_chave";
  if (status === 408 || status === 429) return "timeout";
  if (status !== null && status >= 500) return "erro_de_rede";

  const t = textoDoErro(e);
  if (t.includes("api key") || t.includes("apikey") || t.includes("not-configured") || t.includes("unauthorized")) {
    return "sem_chave";
  }
  if (t.includes("timeout") || t.includes("timed out") || t.includes("etimedout") || t.includes("abort")) {
    return "timeout";
  }
  if (
    t.includes("fetch failed") || t.includes("econnreset") || t.includes("econnrefused") ||
    t.includes("enotfound") || t.includes("socket") || t.includes("network")
  ) {
    return "erro_de_rede";
  }
  if (t.includes("json")) return "json_invalido";
  return "desconhecido";
}

/** Frase curta para log e para o diário. Sem conteúdo de cliente. */
export function explicarMotivo(motivo: MotivoDeFalhaDaIA): string {
  switch (motivo) {
    case "sem_chave":          return "sem chave de IA configurada";
    case "timeout":            return "a IA não respondeu a tempo";
    case "erro_de_rede":       return "rede ou provedor de IA fora do ar";
    case "json_invalido":      return "a IA respondeu, mas não em JSON válido";
    case "cortado_por_limite": return "a resposta da IA foi cortada pelo teto de tokens";
    case "sem_conteudo":       return "a IA devolveu resposta vazia";
    case "desconhecido":       return "falha de IA não classificada";
  }
}
