/**
 * AnthropicEngineAdapter — o piloto CLAUDE do Brain.
 *
 * Só ativa quando ANTHROPIC_API_KEY existe (o router já não seleciona CLAUDE
 * sem a chave). Cliente lazy/singleton; JSON garantido por instrução no system
 * prompt + prefill "{" (a API da Anthropic não tem response_format json).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { StructuredCallInput, StructuredCallResult, EngineUsage } from "./EngineAdapter";
import { USO_DESCONHECIDO } from "./EngineAdapter";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

/** `usage` ausente é desconhecido, nunca zero — mesma regra do piloto OPENAI. */
function lerUso(usage: { input_tokens?: number; output_tokens?: number } | undefined | null): EngineUsage {
  const entrada = usage?.input_tokens;
  const saida = usage?.output_tokens;
  if (typeof entrada !== "number" || typeof saida !== "number") return USO_DESCONHECIDO;
  return { promptTokens: entrada, completionTokens: saida, desconhecido: false };
}

export async function callAnthropic(input: StructuredCallInput): Promise<StructuredCallResult> {
  const wantsJson = (input.responseFormat ?? "json") === "json";
  const system = wantsJson
    ? `${input.systemPrompt}\n\nIMPORTANTE: responda SOMENTE com um objeto JSON válido, sem markdown, sem texto fora do JSON.`
    : input.systemPrompt;

  const response = await getClient().messages.create({
    model: input.selection.model,
    max_tokens: input.maxTokens ?? 1024,
    temperature: input.temperature ?? 0.2,
    system,
    messages: wantsJson
      ? [
          { role: "user", content: input.userContent },
          { role: "assistant", content: "{" }, // prefill: força a resposta a começar como JSON
        ]
      : [{ role: "user", content: input.userContent }],
  });

  const block = response.content.find((b) => b.type === "text");
  const text = block && block.type === "text" ? block.text : "";
  if (!text) throw new Error("Engine CLAUDE sem conteúdo");
  return { raw: wantsJson ? `{${text}` : text, usage: lerUso(response.usage) };
}
