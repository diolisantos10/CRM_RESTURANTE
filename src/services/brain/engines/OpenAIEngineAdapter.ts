/**
 * OpenAIEngineAdapter — o piloto OPENAI + o DISPATCHER de pilotos do Brain.
 *
 * callStructuredJson é o ÚNICO ponto por onde qualquer consumidor do Brain fala
 * com uma IA: ele roteia pela seleção (OPENAI / CLAUDE / GEMINI) para o adapter
 * do provider. Trocar o piloto de um agente é config governada no router —
 * nenhum consumidor muda. (Mantido neste arquivo pelo import histórico; o
 * OpenAI segue sendo o piloto default de produção.)
 */

import { openai } from "@/lib/openai";
import type OpenAI from "openai";
import type { AIEngineSelection } from "./AIEngineTypes";
import type { StructuredCallInput, StructuredCallResult, EngineUsage } from "./EngineAdapter";
import { USO_DESCONHECIDO } from "./EngineAdapter";
import { registrarUsoEmSegundoPlano } from "./EngineUsageRecorder";
import { FalhaDeMotor } from "./FalhaDeMotor";

export { openai as openaiEngine };

export interface StructuredJsonCallInput extends StructuredCallInput {
  selection: AIEngineSelection;
}

/**
 * Lê a contagem de tokens que o provedor devolveu NA MESMA resposta.
 *
 * `usage` ausente NÃO é zero: é desconhecido. Devolver `{0, 0, desconhecido:false}`
 * aqui faria o custo virar US$ 0,00 — um número inventado com aparência de
 * auditado, exatamente o defeito que `modelPricing.ts` foi escrito para matar.
 */
function lerUso(usage: OpenAI.Completions.CompletionUsage | undefined | null): EngineUsage {
  const prompt = usage?.prompt_tokens;
  const completion = usage?.completion_tokens;
  if (typeof prompt !== "number" || typeof completion !== "number") return USO_DESCONHECIDO;
  return { promptTokens: prompt, completionTokens: completion, desconhecido: false };
}

async function callOpenAI(input: StructuredCallInput): Promise<StructuredCallResult> {
  // Sem chave o SDK vai com "not-configured" e o provedor devolve 401 depois de
  // uma ida à rede. Barrar aqui troca um 401 genérico por um motivo nomeado —
  // e é o motivo que o diário do SDR precisa registrar.
  const chave = process.env.OPENAI_API_KEY;
  if (!chave || !chave.trim() || chave.trim() === "not-configured") {
    throw new FalhaDeMotor("sem_chave", "OPENAI_API_KEY ausente");
  }
  const wantsJson = (input.responseFormat ?? "json") === "json";
  // Visual input (e.g. nota de compra) rides along as an image part.
  const userContent: string | OpenAI.Chat.Completions.ChatCompletionContentPart[] =
    input.imageDataUrl
      ? [
          { type: "text", text: input.userContent },
          { type: "image_url", image_url: { url: input.imageDataUrl } },
        ]
      : input.userContent;
  const completion = await openai.chat.completions.create({
    model: input.selection.model,
    temperature: input.temperature ?? 0.2,
    ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
    ...(wantsJson ? { response_format: { type: "json_object" as const } } : {}),
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: userContent },
    ],
  });
  /* ── Por que `finish_reason` importa mais do que parece ────────────────────
   * Quando o modelo bate no teto de tokens ele devolve `finish_reason: "length"`
   * COM texto — um JSON pela metade. Sem olhar aqui, esse pedaço desce até o
   * `JSON.parse`, quebra, e o consumidor registra "a IA não entendeu" quando o
   * que houve foi um teto curto demais. Diagnóstico errado leva a conserto
   * errado: alguém iria mexer no prompt em vez de subir `maxTokens`. */
  const escolha = completion.choices[0];
  const raw = escolha?.message?.content;
  /* ── O `usage` é lido ANTES de qualquer throw ──────────────────────────────
   * Resposta truncada e resposta vazia CUSTARAM tokens: o provedor cobra pela
   * chamada, não pelo aproveitamento dela. Ler o uso só no caminho feliz faria
   * o gasto das falhas desaparecer da conta — e falha é justamente o que se
   * quer enxergar. Por isso o uso sai no erro também (`usoDaFalha`). */
  const usage = lerUso(completion.usage);
  if (escolha?.finish_reason === "length") {
    throw new FalhaDeMotor(
      "cortado_por_limite",
      `resposta truncada em ${input.maxTokens ?? "padrão"} tokens`,
      usage,
    );
  }
  if (!raw) {
    throw new FalhaDeMotor(
      "sem_conteudo",
      `finish_reason=${escolha?.finish_reason ?? "ausente"}`,
      usage,
    );
  }
  return { raw, usage };
}

/**
 * Uma chamada estruturada através do piloto roteado. Lança em erro — quem chama
 * decide o fallback (o BrainReasoner cai no determinístico que nunca inventa).
 */
export async function callStructuredJson(input: StructuredJsonCallInput): Promise<string> {
  const inicio = Date.now();
  try {
    const resultado = await despachar(input);
    registrarUsoEmSegundoPlano({
      model: input.selection.model,
      usage: resultado.usage,
      latencyMs: Date.now() - inicio,
      success: true,
      context: input.context,
    });
    return resultado.raw;
  } catch (erro) {
    /* A chamada que falhou DEPOIS de rodar no provedor também custou. Só não se
     * contabiliza o que nem chegou lá (sem chave, provider não implementado) —
     * aí `usoDaFalha` é undefined e nada é gravado, porque gravar seria inventar
     * uma chamada que não existiu. */
    const usage = usoDaFalha(erro);
    if (usage) {
      registrarUsoEmSegundoPlano({
        model: input.selection.model,
        usage,
        latencyMs: Date.now() - inicio,
        success: false,
        errorMessage: (erro as Error)?.message?.slice(0, 300),
        context: input.context,
      });
    }
    throw erro;
  }
}

/** O uso que veio junto de uma falha do provedor, quando houve chamada de fato. */
function usoDaFalha(erro: unknown): EngineUsage | null {
  return erro instanceof FalhaDeMotor ? (erro.usage ?? null) : null;
}

async function despachar(input: StructuredJsonCallInput): Promise<StructuredCallResult> {
  switch (input.selection.provider) {
    case "OPENAI":
      return callOpenAI(input);
    case "CLAUDE": {
      if (input.imageDataUrl) {
        throw new Error("Entrada de imagem ainda não suportada no piloto CLAUDE — roteie para OPENAI.");
      }
      const { callAnthropic } = await import("./AnthropicEngineAdapter");
      return callAnthropic(input);
    }
    case "GEMINI": {
      if (input.imageDataUrl) {
        throw new Error("Entrada de imagem ainda não suportada no piloto GEMINI — roteie para OPENAI.");
      }
      const { callGemini } = await import("./GeminiEngineAdapter");
      return callGemini(input);
    }
    default:
      throw new Error(`Engine ${input.selection.provider} não implementado — use o fallback determinístico.`);
  }
}
