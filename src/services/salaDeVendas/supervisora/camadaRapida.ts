/**
 * A CAMADA RÁPIDA — o modelo barato, em toda mensagem, olhando o que o regex
 * não alcança.
 *
 * ── A DIVISÃO COM `ta/verificador.ts` ────────────────────────────────────────
 *
 * `verificarResposta` já reprova, determinístico e sem custo de modelo: preço
 * fora da tabela, promessa de prazo, garantia de resultado, integração
 * inventada, fechamento em nome do cliente, negar ser agente, placeholder
 * vazado, link fora da lista, pedir telefone repetido. Isso já rodou, dentro de
 * `falar()`/`pensar()`, ANTES de a mensagem chegar aqui. Esta camada NUNCA
 * reproduz essas checagens — o prompt abaixo diz isso ao modelo explicitamente,
 * porque um "juiz" que reprova de novo o que o regex já aprovou é dois motivos
 * de bloqueio brigando pelo mesmo caso.
 *
 * O que esta camada cobre é o que só se vê olhando tom e ritmo: mensagem
 * invasiva, insistência depois de recusa, pitch fora de hora, tom robótico,
 * falta de personalização, pressão comercial, interrogatório (pergunta atrás de
 * pergunta sem responder o que foi perguntado), mensagens em sequência sem
 * esperar resposta.
 *
 * ── ⛔ A REGRA DE FALHA ──────────────────────────────────────────────────────
 *
 * Sem motor configurado (`MOCK`), erro de rede, ou JSON que não parseia: nunca
 * vira aprovação silenciosa. Devolve `falhaTecnica: true`. Quem decide o que
 * isso significa para a entrega é `revisao.ts`, olhando o MODO — em SHADOW/OFF
 * uma falha daqui é só um registro; em GUARD/INTERVENTION vira retenção.
 */

import { selectEngineRouted } from "@/services/brain/engines/AIEngineRouter";
import { callStructuredJson } from "@/services/brain/engines/OpenAIEngineAdapter";
import type { MotivoDaSupervisora, VeredictoDaSupervisora } from "@prisma/client";
import type { ContextoDaRevisao } from "./contexto";

/** O nome pelo qual esta camada aparece no roteamento governado do Brain. */
export const AGENTE_CAMADA_RAPIDA = "supervisora-camada-rapida";

const MOTIVOS_VALIDOS = new Set<MotivoDaSupervisora>([
  "MENSAGEM_INVASIVA",
  "INSISTENCIA_APOS_RECUSA",
  "PITCH_ERRADO",
  "TOM_ROBOTICO",
  "PROMESSA_INCORRETA",
  "PERSONALIZACAO_FRACA",
  "PRESSAO_COMERCIAL",
  "INTERROGATORIO",
  "SEQUENCIA_DE_MENSAGENS",
  "TIMING_RUIM",
  "OUTRO",
]);

const VEREDITOS_VALIDOS = new Set<VeredictoDaSupervisora>(["VERDE", "AMARELO", "VERMELHO", "CRITICO"]);

export interface ResultadoDaCamada {
  veredito: VeredictoDaSupervisora;
  motivos: MotivoDaSupervisora[];
  /** Frase curta com o caso concreto — nunca um veredito mudo (guardrail 6). */
  detalhe: string;
  /** Só quando `veredito === "AMARELO"`. */
  textoReescrito: string | null;
  falhaTecnica: boolean;
  engineProvider: string | null;
  engineModel: string | null;
}

function falhaTecnica(motivo: string, engine?: { provider: string; model: string } | null): ResultadoDaCamada {
  return {
    veredito: "VERMELHO",
    motivos: ["FALHA_TECNICA"],
    detalhe: motivo,
    textoReescrito: null,
    falhaTecnica: true,
    engineProvider: engine?.provider ?? null,
    engineModel: engine?.model ?? null,
  };
}

function instrucao(ctx: ContextoDaRevisao): string {
  return [
    "Você é a SUPERVISORA DE QUALIDADE de uma sala de vendas por WhatsApp.",
    "Sua função é revisar UMA mensagem que um agente (humano OU inteligência",
    "artificial) está prestes a mandar a um lead/cliente, ANTES de ela sair.",
    "",
    "⛔ NÃO REPITA O QUE JÁ FOI VERIFICADO. Preço fora da tabela, prazo",
    "prometido, garantia de resultado, integração inventada, fechamento em nome",
    "do cliente, negar ser um agente, link fora da lista e placeholder não",
    "preenchido JÁ FORAM checados por um verificador determinístico separado.",
    "Não reprove por nenhum desses motivos — eles não existem mais nesta",
    "mensagem se ela chegou até você.",
    "",
    "O QUE VOCÊ AVALIA, e só isso:",
    "- MENSAGEM_INVASIVA: pergunta ou insiste em algo que a pessoa não abriu",
    "  espaço para falar, ou passa por cima do que ela pediu.",
    "- INSISTENCIA_APOS_RECUSA: o lead já disse não/recusou e a mensagem",
    "  empurra o mesmo assunto de novo.",
    "- PITCH_ERRADO: oferta ou argumento que não bate com o que o lead contou",
    "  (segmento, dor, etapa do funil).",
    "- TOM_ROBOTICO: texto genérico, decorado, sem ligação com o que a pessoa",
    "  acabou de escrever.",
    "- PROMESSA_INCORRETA: sugere algo fora do que a marca afirma, mesmo sem",
    "  citar número (isso o verificador determinístico já barra).",
    "- PERSONALIZACAO_FRACA: ignora um fato que já se sabe sobre o lead.",
    "- PRESSAO_COMERCIAL: urgência artificial, escassez inventada, empurrar",
    "  fechamento sem a pessoa ter sinalizado interesse.",
    "- INTERROGATORIO: pergunta em cima de pergunta, sem responder o que foi",
    "  perguntado primeiro.",
    "- SEQUENCIA_DE_MENSAGENS: texto escrito como se fossem várias mensagens",
    "  picadas, quando deveria ser uma só.",
    "- TIMING_RUIM: o assunto certo, na hora errada da conversa.",
    "",
    `TOM DA MARCA: ${ctx.tomDaMarca}`,
    "",
    ctx.regrasComerciais.length
      ? `REGRAS COMERCIAIS DESTA CASA:\n${ctx.regrasComerciais.map((r) => `- ${r}`).join("\n")}`
      : "",
    "",
    // Recorte pequeno da Academia Comercial (`supervisora/academia.ts`) — só
    // aparece quando há versão publicada; vazio é o comportamento de hoje.
    ctx.conhecimentoDaAcademia.length
      ? `CONHECIMENTO DA ACADEMIA COMERCIAL (venda consultiva, para esta etapa):\n${ctx.conhecimentoDaAcademia.map((c) => `- ${c}`).join("\n")}`
      : "",
    "",
    `ETAPA DO FUNIL: ${ctx.etapaDoFunil}`,
    `PERFIL DO LEAD: ${ctx.perfilDoLead}`,
    ctx.resumoIncremental ? `\n${ctx.resumoIncremental}` : "",
    ctx.irritacaoDoLead >= 2 ? "\n⚠️ O LEAD ESTÁ IRRITADO." : "",
    ctx.pediuParar ? "\n⚠️ O LEAD JÁ PEDIU PARA PARAR DE RESPONDER PERGUNTAS." : "",
    ctx.ultimosAlertasDesteAtendimento.length
      ? `\nALERTAS ANTERIORES NESTE ATENDIMENTO:\n${ctx.ultimosAlertasDesteAtendimento.map((a) => `- ${a}`).join("\n")}`
      : "",
    "",
    "Responda em JSON, e SÓ JSON, neste formato exato:",
    `{"veredito": "VERDE" | "AMARELO" | "VERMELHO" | "CRITICO",`,
    ` "motivos": ["MENSAGEM_INVASIVA" | "INSISTENCIA_APOS_RECUSA" | "PITCH_ERRADO" | "TOM_ROBOTICO" | "PROMESSA_INCORRETA" | "PERSONALIZACAO_FRACA" | "PRESSAO_COMERCIAL" | "INTERROGATORIO" | "SEQUENCIA_DE_MENSAGENS" | "TIMING_RUIM" | "OUTRO"],`,
    ` "detalhe": "frase curta e concreta explicando o veredito",`,
    ` "textoReescrito": "só quando veredito=AMARELO — a mesma mensagem, corrigida, mesmo tom" }`,
    "",
    "VERDE = pode sair como está. AMARELO = pequeno ajuste resolve, mande o",
    "texto corrigido. VERMELHO = não deve sair assim, sem reescrita seu (quem",
    "decide se retém é o sistema, não você). CRITICO = como VERMELHO, e além",
    "disso a conversa deveria ir para uma pessoa AGORA (ex.: lead muito irritado,",
    "pedido de parar sendo ignorado, insistência grave e repetida).",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function avaliarCamadaRapida(
  ctx: ContextoDaRevisao,
  respostaProposta: string,
): Promise<ResultadoDaCamada> {
  let engine: Awaited<ReturnType<typeof selectEngineRouted>> | null = null;
  try {
    engine = await selectEngineRouted(AGENTE_CAMADA_RAPIDA, { taskProfile: "JUDGE" });
  } catch {
    return falhaTecnica("não foi possível selecionar um motor de IA");
  }

  if (!engine || engine.provider === "MOCK") {
    return falhaTecnica("sem motor de IA configurado para a Supervisora");
  }

  const userContent = [
    `MENSAGEM DO CLIENTE (a mais recente): "${ctx.ultimaMensagemDoCliente ?? "(nenhuma — abertura de conversa)"}"`,
    `RESPOSTA PROPOSTA PELO AGENTE, A REVISAR: "${respostaProposta}"`,
  ].join("\n\n");

  let raw: string;
  try {
    raw = await callStructuredJson({
      selection: engine,
      systemPrompt: instrucao(ctx),
      userContent,
      responseFormat: "json",
      temperature: 0.1,
      maxTokens: 500,
    });
  } catch (e) {
    return falhaTecnica(
      `o motor de IA falhou: ${e instanceof Error ? e.message : "erro desconhecido"}`,
      engine,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return falhaTecnica("o motor devolveu um JSON inválido", engine);
  }

  return interpretarResposta(parsed, engine);
}

function interpretarResposta(
  parsed: unknown,
  engine: { provider: string; model: string },
): ResultadoDaCamada {
  if (typeof parsed !== "object" || parsed === null) {
    return falhaTecnica("a resposta do motor não é um objeto", engine);
  }
  const p = parsed as Record<string, unknown>;

  const veredito = typeof p.veredito === "string" && VEREDITOS_VALIDOS.has(p.veredito as VeredictoDaSupervisora)
    ? (p.veredito as VeredictoDaSupervisora)
    : null;
  if (!veredito) {
    return falhaTecnica(`veredito ausente ou inválido: ${String(p.veredito)}`, engine);
  }

  const motivosBrutos = Array.isArray(p.motivos) ? p.motivos : [];
  const motivos = motivosBrutos.filter(
    (m): m is MotivoDaSupervisora => typeof m === "string" && MOTIVOS_VALIDOS.has(m as MotivoDaSupervisora),
  );
  // Reprovação sem motivo nomeado é veredito mudo (guardrail 6) — em vez de
  // aceitar isso, marca OUTRO e o detalhe crua explica o resto.
  if (veredito !== "VERDE" && motivos.length === 0) motivos.push("OUTRO");

  const detalhe = typeof p.detalhe === "string" && p.detalhe.trim() ? p.detalhe.trim() : "sem detalhe do motor";

  const textoReescrito =
    veredito === "AMARELO" && typeof p.textoReescrito === "string" && p.textoReescrito.trim()
      ? p.textoReescrito.trim()
      : null;

  // AMARELO sem texto reescrito é uma promessa que a camada não cumpriu — a
  // orquestração (`revisao.ts`) trata isso como falha técnica de verdade, não
  // como aprovação disfarçada.
  if (veredito === "AMARELO" && !textoReescrito) {
    return falhaTecnica("veredito AMARELO sem texto reescrito", engine);
  }

  return {
    veredito,
    motivos,
    detalhe,
    textoReescrito,
    falhaTecnica: false,
    engineProvider: engine.provider,
    engineModel: engine.model,
  };
}
