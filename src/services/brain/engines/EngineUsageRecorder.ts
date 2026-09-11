/**
 * EngineUsageRecorder — o medidor de consumo do dispatcher do Brain.
 *
 * ── O defeito que este módulo existe para consertar ───────────────────────────
 * `callStructuredJson` é o gargalo por onde passa TODA chamada de IA do Brain
 * (~20 chamadores de produção). A OpenAI devolve `completion.usage` — a contagem
 * de tokens — NA MESMA resposta, de graça. O adapter lia `choices[0]` e jogava o
 * `usage` fora. Resultado medido em 28/08/2026: `AIInteractionLogger.log` tinha
 * UM chamador em todo o `src/` (`AIOrderService.ts`), e a casa media o custo do
 * Garçom e de mais nada.
 *
 * ── As três regras que este arquivo carrega ───────────────────────────────────
 * 1. NUNCA derruba nem atrasa a resposta ao cliente. Toda falha é engolida com
 *    `console.warn`. Nada aqui propaga (guardrail 5: proteção que dispara não
 *    pode ser mais destrutiva que o problema que ela evita).
 * 2. Atribuição é opcional; contabilidade não é. Sem `context`, a linha entra
 *    com restaurante e agente nulos e cai no balde "não atribuído" da Sala dos
 *    Agentes. Ter o total sem dono é melhor que não ter total.
 * 3. Não se inventa tarifa nem contagem. Provedor que não devolveu `usage` grava
 *    `tokensUnknown: true` → custo `null` → a tela lê "não medido", não "zero".
 *    Modelo fora de `modelPricing.ts` grava custo `null` pelo mesmo caminho.
 */

import type { EngineCallContext, EngineUsage } from "./EngineAdapter";

/**
 * Import TARDIO de propósito. `AIInteractionLogger` puxa o cliente do Prisma;
 * carregá-lo estaticamente colocaria o banco no grafo de import de
 * `callStructuredJson`, que é o gargalo de TODO o Brain. O medidor não pode ser
 * o motivo de o motor não subir.
 */
async function logger() {
  const { AIInteractionLogger } = await import("@/services/ai/AIInteractionLogger");
  return AIInteractionLogger;
}

/**
 * Duas gravações, escritas com o nome do escritor à vista.
 *
 * A varredura de `salaReal.test.ts` procura literalmente `AIInteractionLogger.log(`
 * para saber quem escreve no registro de custo. Chamar por um apelido
 * (`registrador.log`) esconderia este arquivo dela — e escritor invisível para o
 * detector é portão que aprova por omissão (guardrail 2). O nome fica.
 */
async function gravarLinha(
  entrada: Parameters<Awaited<ReturnType<typeof logger>>["log"]>[0],
): Promise<{ gravado: boolean; erro?: unknown }> {
  const AIInteractionLogger = await logger();
  return AIInteractionLogger.log(entrada);
}

export interface EntradaDeUso {
  readonly model: string;
  readonly usage: EngineUsage;
  readonly latencyMs: number;
  readonly success: boolean;
  readonly errorMessage?: string;
  readonly context?: EngineCallContext;
}

/**
 * Grava UMA chamada do motor. Assíncrona e SEM `await` no caminho crítico —
 * quem chama usa `registrarUsoEmSegundoPlano`.
 *
 * A segunda tentativa sem atribuição não é zelo: `restaurantId` tem chave
 * estrangeira para `Restaurant`. Um chamador que passa um id que não existe
 * (sonda administrativa, ambiente de teste, restaurante recém-apagado) faria o
 * INSERT inteiro falhar — e a chamada sumiria da contabilidade por causa da
 * ATRIBUIÇÃO, que é a parte opcional. Perder o dono é aceitável; perder o gasto
 * não é.
 */
export async function registrarUsoDoMotor(entrada: EntradaDeUso): Promise<void> {
  try {
    await gravar(entrada);
  } catch (err) {
    // O medidor NUNCA propaga. Nem quando o próprio import falha.
    console.warn("[EngineUsageRecorder] falha ao contabilizar uso de IA:", err);
  }
}

async function gravar(entrada: EntradaDeUso): Promise<void> {
  const base = {
    model: entrada.model,
    promptTokens: entrada.usage.desconhecido ? 0 : entrada.usage.promptTokens,
    completionTokens: entrada.usage.desconhecido ? 0 : entrada.usage.completionTokens,
    latencyMs: Math.max(0, Math.round(entrada.latencyMs)),
    success: entrada.success,
    errorMessage: entrada.errorMessage,
    agentSlug: entrada.context?.agentSlug ?? null,
    conversationId: entrada.context?.conversationId ?? null,
    tokensUnknown: entrada.usage.desconhecido,
  };

  const restaurantId = entrada.context?.restaurantId ?? null;

  const primeira = await gravarLinha({ ...base, restaurantId });
  if (primeira.gravado) return;

  if (restaurantId) {
    const semDono = await gravarLinha({ ...base, restaurantId: null });
    if (semDono.gravado) {
      console.warn(
        `[EngineUsageRecorder] uso de ${entrada.model} gravado SEM restaurante: ` +
          `o id "${restaurantId}" foi recusado pelo banco. O gasto está contabilizado, a atribuição não.`,
      );
      return;
    }
  }

  console.warn(
    `[EngineUsageRecorder] uso de ${entrada.model} NÃO foi contabilizado:`,
    primeira.erro,
  );
}

/**
 * Dispara o registro FORA do caminho crítico e devolve na hora.
 *
 * Chamada síncrona de propósito: o teste consegue afirmar que o dispatcher
 * mediu a chamada sem depender de timer, e o cliente não espera o INSERT.
 */
export function registrarUsoEmSegundoPlano(entrada: EntradaDeUso): void {
  void registrarUsoDoMotor(entrada).catch((err) => {
    // Rede de segurança final. `registrarUsoDoMotor` já engole tudo; se um dia
    // deixar de engolir, a resposta ao cliente continua não sabendo disso.
    console.warn("[EngineUsageRecorder] falha inesperada ao contabilizar uso:", err);
  });
}
