/**
 * A CAMADA PROFUNDA — o modelo mais capaz, só quando algo concreto já apontou
 * problema. Não roda em toda mensagem: o motivo de existir uma camada rápida
 * barata é justamente poupar esta.
 *
 * ── OS GATILHOS, TODOS JÁ MEDIDOS EM OUTRO LUGAR ────────────────────────────
 *
 * Nenhum destes é um detector novo. `deveAcionar` só junta o que já existe:
 *
 *   - irritação do lead (`ta/memoria.ts`, `lerIrritacao`/`memoria.irritacao`);
 *   - pedido de silêncio/parar (`memoria.pediuPararSondagem`);
 *   - um `MotivoDoHandoff` já presente nos sinais da conversa (`handoff.ts`);
 *   - baixa confiança da camada rápida (qualquer coisa que não seja VERDE);
 *   - repetição: o MESMO agente (por `autorUserId` ou, na ausência dele, por
 *     `papelDoAgente`) já foi reprovado pela Supervisora recentemente. Isto é
 *     novo — não existia detector de repetição antes desta frente — e mora em
 *     `desempenho.ts` (`contarReprovacoesRecentes`), contado pelo chamador e
 *     passado aqui como número, para esta função continuar pura e testável.
 */

import { selectEngineRouted } from "@/services/brain/engines/AIEngineRouter";
import { callStructuredJson } from "@/services/brain/engines/OpenAIEngineAdapter";
import type { MotivoDoHandoff } from "@prisma/client";
import type { ContextoDaRevisao } from "./contexto";
import type { ResultadoDaCamada } from "./camadaRapida";

export const AGENTE_CAMADA_PROFUNDA = "supervisora-camada-profunda";

/** A partir de quantas reprovações recentes do MESMO agente se considera padrão,
 *  e não incidente isolado. */
export const LIMIAR_DE_REPETICAO = 2;

export interface GatilhosDaCamadaProfunda {
  veredictoDaCamadaRapida: ResultadoDaCamada["veredito"] | null;
  irritacaoDoLead: number;
  pediuParar: boolean;
  motivoDeHandoffPresente?: MotivoDoHandoff | null;
  reprovacoesRecentesDoAgente: number;
}

export interface DecisaoDeAcionar {
  aciona: boolean;
  /** Nomeado, para a linha gravada explicar por que a camada cara rodou. */
  motivo: string | null;
}

/** PURA — sem banco, sem modelo. Testável caso a caso. */
export function deveAcionar(g: GatilhosDaCamadaProfunda): DecisaoDeAcionar {
  if (g.veredictoDaCamadaRapida && g.veredictoDaCamadaRapida !== "VERDE") {
    return { aciona: true, motivo: `camada rápida devolveu ${g.veredictoDaCamadaRapida}` };
  }
  if (g.irritacaoDoLead >= 2) return { aciona: true, motivo: "lead irritado (grau 2+)" };
  if (g.pediuParar) return { aciona: true, motivo: "lead pediu para parar" };
  if (g.motivoDeHandoffPresente) {
    return { aciona: true, motivo: `sinal de handoff presente: ${g.motivoDeHandoffPresente}` };
  }
  if (g.reprovacoesRecentesDoAgente >= LIMIAR_DE_REPETICAO) {
    return {
      aciona: true,
      motivo: `o mesmo agente já foi reprovado ${g.reprovacoesRecentesDoAgente}× recentemente`,
    };
  }
  return { aciona: false, motivo: null };
}

function instrucao(ctx: ContextoDaRevisao, motivoDoAcionamento: string, turnos: string): string {
  return [
    "Você é a SUPERVISORA DE QUALIDADE, na sua REVISÃO PROFUNDA — mais cara,",
    "acionada porque algo concreto já apontou problema nesta conversa:",
    `"${motivoDoAcionamento}"`,
    "",
    "Sua tarefa: confirmar (ou não) o problema com a CONVERSA inteira à vista, e",
    "decidir se esta conversa precisa ir para uma PESSOA agora — não só se a",
    "mensagem atual pode sair.",
    "",
    "⛔ Não repita checagem de preço/prazo/garantia/integração/link — isso já foi",
    "verificado em outra camada, determinística.",
    "",
    `TOM DA MARCA: ${ctx.tomDaMarca}`,
    ctx.resumoIncremental ? `\n${ctx.resumoIncremental}` : "",
    turnos ? `\nOS ÚLTIMOS TURNOS DESTA CONVERSA:\n${turnos}` : "",
    ctx.ultimosAlertasDesteAtendimento.length
      ? `\nALERTAS ANTERIORES:\n${ctx.ultimosAlertasDesteAtendimento.map((a) => `- ${a}`).join("\n")}`
      : "",
    "",
    "Responda em JSON, e SÓ JSON:",
    `{"veredito": "VERDE" | "AMARELO" | "VERMELHO" | "CRITICO",`,
    ` "motivos": ["MENSAGEM_INVASIVA" | "INSISTENCIA_APOS_RECUSA" | "PITCH_ERRADO" | "TOM_ROBOTICO" | "PROMESSA_INCORRETA" | "PERSONALIZACAO_FRACA" | "PRESSAO_COMERCIAL" | "INTERROGATORIO" | "SEQUENCIA_DE_MENSAGENS" | "TIMING_RUIM" | "OUTRO"],`,
    ` "detalhe": "frase curta e concreta",`,
    ` "textoReescrito": "só se veredito=AMARELO",`,
    ` "precisaDeGente": true | false,`,
    ` "sugestaoPermanente": "se este é um padrão do agente que merece mudar o roteiro dele, descreva em uma frase o que deveria mudar — senão, null" }`,
    "",
    "CRITICO implica precisaDeGente=true. Fora isso, precisaDeGente pode ser",
    "true mesmo com veredito VERMELHO quando a conversa está se perdendo.",
  ].join("\n");
}

export interface ResultadoDaCamadaProfunda extends ResultadoDaCamada {
  precisaDeGente: boolean;
  sugestaoPermanente: string | null;
}

function falha(motivo: string, engine?: { provider: string; model: string } | null): ResultadoDaCamadaProfunda {
  return {
    veredito: "CRITICO",
    motivos: ["FALHA_TECNICA"],
    detalhe: motivo,
    textoReescrito: null,
    falhaTecnica: true,
    engineProvider: engine?.provider ?? null,
    engineModel: engine?.model ?? null,
    precisaDeGente: false,
    sugestaoPermanente: null,
  };
}

export async function avaliarCamadaProfunda(
  ctx: ContextoDaRevisao,
  respostaProposta: string,
  turnos: Array<{ deQuem: "cliente" | "ta"; texto: string }>,
  motivoDoAcionamento: string,
): Promise<ResultadoDaCamadaProfunda> {
  let engine: Awaited<ReturnType<typeof selectEngineRouted>> | null = null;
  try {
    engine = await selectEngineRouted(AGENTE_CAMADA_PROFUNDA, { taskProfile: "REASON" });
  } catch {
    return falha("não foi possível selecionar um motor de IA");
  }
  if (!engine || engine.provider === "MOCK") {
    return falha("sem motor de IA configurado para a Supervisora (camada profunda)");
  }

  const textoDosTurnos = turnos
    .map((t) => `${t.deQuem === "cliente" ? "Cliente" : "Agente"}: ${t.texto}`)
    .join("\n");

  const userContent = [
    `RESPOSTA PROPOSTA PELO AGENTE, A REVISAR: "${respostaProposta}"`,
  ].join("\n\n");

  let raw: string;
  try {
    raw = await callStructuredJson({
      selection: engine,
      systemPrompt: instrucao(ctx, motivoDoAcionamento, textoDosTurnos),
      userContent,
      responseFormat: "json",
      temperature: 0.1,
      maxTokens: 700,
    });
  } catch (e) {
    return falha(`o motor de IA falhou: ${e instanceof Error ? e.message : "erro desconhecido"}`, engine);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return falha("o motor devolveu um JSON inválido", engine);
  }

  return interpretar(parsed, engine);
}

const MOTIVOS_VALIDOS = new Set([
  "MENSAGEM_INVASIVA", "INSISTENCIA_APOS_RECUSA", "PITCH_ERRADO", "TOM_ROBOTICO",
  "PROMESSA_INCORRETA", "PERSONALIZACAO_FRACA", "PRESSAO_COMERCIAL", "INTERROGATORIO",
  "SEQUENCIA_DE_MENSAGENS", "TIMING_RUIM", "OUTRO",
]);
const VEREDITOS_VALIDOS = new Set(["VERDE", "AMARELO", "VERMELHO", "CRITICO"]);

function interpretar(parsed: unknown, engine: { provider: string; model: string }): ResultadoDaCamadaProfunda {
  if (typeof parsed !== "object" || parsed === null) {
    return falha("a resposta do motor não é um objeto", engine);
  }
  const p = parsed as Record<string, unknown>;

  const veredito = typeof p.veredito === "string" && VEREDITOS_VALIDOS.has(p.veredito)
    ? (p.veredito as ResultadoDaCamada["veredito"])
    : null;
  if (!veredito) return falha(`veredito ausente ou inválido: ${String(p.veredito)}`, engine);

  const motivosBrutos = Array.isArray(p.motivos) ? p.motivos : [];
  const motivos = motivosBrutos.filter(
    (m): m is ResultadoDaCamada["motivos"][number] => typeof m === "string" && MOTIVOS_VALIDOS.has(m),
  );
  if (veredito !== "VERDE" && motivos.length === 0) motivos.push("OUTRO");

  const detalhe = typeof p.detalhe === "string" && p.detalhe.trim() ? p.detalhe.trim() : "sem detalhe do motor";
  const textoReescrito =
    veredito === "AMARELO" && typeof p.textoReescrito === "string" && p.textoReescrito.trim()
      ? p.textoReescrito.trim()
      : null;
  if (veredito === "AMARELO" && !textoReescrito) {
    return falha("veredito AMARELO sem texto reescrito", engine);
  }

  const precisaDeGente = veredito === "CRITICO" || p.precisaDeGente === true;
  const sugestaoPermanente =
    typeof p.sugestaoPermanente === "string" && p.sugestaoPermanente.trim()
      ? p.sugestaoPermanente.trim()
      : null;

  return {
    veredito,
    motivos,
    detalhe,
    textoReescrito,
    falhaTecnica: false,
    engineProvider: engine.provider,
    engineModel: engine.model,
    precisaDeGente,
    sugestaoPermanente,
  };
}
