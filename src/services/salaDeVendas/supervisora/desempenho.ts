/**
 * AVALIAÇÃO POR AGENTE — item 5 do comando.
 *
 * ── NENHUMA TABELA NOVA ALÉM DO QUE JÁ SE GRAVA POR MENSAGEM ────────────────
 *
 * Tudo aqui é agregação sobre `SupervisoraAvaliacao`, que já grava
 * `autorUserId`/`papelDoAgente` por mensagem (item 4 da missão). Nenhuma tabela
 * de "desempenho consolidado" existe nem é criada — consolidar é reler.
 *
 * ── O QUE É MEDIDO E O QUE NÃO É ─────────────────────────────────────────────
 *
 * `CRITERIOS_DA_FASE_3` é a lista tal como o pedido original do CEO a descreve
 * (mensagem invasiva, insistência, pitch errado, robótico, promessa incorreta,
 * tom, naturalidade, timing do pitch, personalização, pressão comercial,
 * interrogatório, mensagens em sequência) — o painel da parte 2 usa estes
 * NOMES, e cada um corresponde 1:1 a um `MotivoDaSupervisora` do schema.
 * "Respeito a recusas" mapeia para `INSISTENCIA_APOS_RECUSA` (a ausência dela é
 * o defeito que esse motivo nomeia).
 *
 * Alguns traços que a FASE 3 original menciona em linguagem de coaching
 * ("capacidade de ouvir", "empatia genuína") não têm hoje um sinal automático
 * que os meça sem confundir com os motivos acima — e `LeadAvaliacaoQA` já cobre
 * parte disso, por humano, na régua de QA de CONVERSA inteira (`ESCUTA`,
 * `EMPATIA`, ver `qa.ts`). Documentados como NÃO MEDIDOS aqui, e não chutados.
 */

import type { PrismaClient, Prisma, MotivoDaSupervisora, VeredictoDaSupervisora } from "@prisma/client";

type Cliente = PrismaClient | Prisma.TransactionClient;

export const CRITERIOS_DA_FASE_3: ReadonlyArray<{ motivo: MotivoDaSupervisora; rotulo: string }> = [
  { motivo: "MENSAGEM_INVASIVA", rotulo: "Mensagem invasiva" },
  { motivo: "INSISTENCIA_APOS_RECUSA", rotulo: "Respeito a recusas (insistência)" },
  { motivo: "PITCH_ERRADO", rotulo: "Pitch certo para a etapa/perfil" },
  { motivo: "TOM_ROBOTICO", rotulo: "Naturalidade (tom não robótico)" },
  { motivo: "PROMESSA_INCORRETA", rotulo: "Promessa correta" },
  { motivo: "PERSONALIZACAO_FRACA", rotulo: "Personalização" },
  { motivo: "PRESSAO_COMERCIAL", rotulo: "Pressão comercial" },
  { motivo: "INTERROGATORIO", rotulo: "Interrogatório" },
  { motivo: "SEQUENCIA_DE_MENSAGENS", rotulo: "Mensagens em sequência" },
  { motivo: "TIMING_RUIM", rotulo: "Timing do pitch" },
] as const;

/** Traços que a FASE 3 pede e que hoje NÃO têm sinal automático — documentado,
 *  nunca inventado como número. */
export const CRITERIOS_NAO_MEDIDOS_AUTOMATICAMENTE: readonly string[] = [
  "Capacidade de ouvir (escuta ativa) — critério subjetivo de coaching; use `LeadAvaliacaoQA.ESCUTA`, avaliação humana por conversa.",
  "Empatia genuína — idem; `LeadAvaliacaoQA.EMPATIA`.",
];

export interface DesempenhoDoAgente {
  autorUserId: string | null;
  papelDoAgente: string | null;
  total: number;
  porVeredito: Record<VeredictoDaSupervisora, number>;
  porMotivo: Partial<Record<MotivoDaSupervisora, number>>;
  bloqueadas: number;
  handoffsDisparados: number;
}

/**
 * Agrega por `autorUserId` (quando presente) ou `papelDoAgente` (fallback, para
 * o TA, que não tem `autorUserId` de pessoa).
 */
export async function desempenhoPorAgente(
  db: Cliente,
  params: { de?: Date; ate?: Date; autorUserId?: string; papelDoAgente?: string } = {},
): Promise<DesempenhoDoAgente[]> {
  const where: Prisma.SupervisoraAvaliacaoWhereInput = {
    ...(params.autorUserId ? { autorUserId: params.autorUserId } : {}),
    ...(params.papelDoAgente ? { papelDoAgente: params.papelDoAgente } : {}),
    ...(params.de || params.ate
      ? { criadaEm: { ...(params.de ? { gte: params.de } : {}), ...(params.ate ? { lt: params.ate } : {}) } }
      : {}),
  };

  const linhas = await db.supervisoraAvaliacao.findMany({
    where,
    select: {
      autorUserId: true,
      papelDoAgente: true,
      veredito: true,
      motivos: true,
      bloqueada: true,
      handoffDisparado: true,
    },
  });

  const porChave = new Map<string, DesempenhoDoAgente>();

  for (const l of linhas) {
    const chave = l.autorUserId ?? `papel:${l.papelDoAgente ?? "desconhecido"}`;
    let agg = porChave.get(chave);
    if (!agg) {
      agg = {
        autorUserId: l.autorUserId,
        papelDoAgente: l.papelDoAgente,
        total: 0,
        porVeredito: { VERDE: 0, AMARELO: 0, VERMELHO: 0, CRITICO: 0 },
        porMotivo: {},
        bloqueadas: 0,
        handoffsDisparados: 0,
      };
      porChave.set(chave, agg);
    }
    agg.total += 1;
    agg.porVeredito[l.veredito] += 1;
    if (l.bloqueada) agg.bloqueadas += 1;
    if (l.handoffDisparado) agg.handoffsDisparados += 1;
    for (const m of l.motivos) agg.porMotivo[m] = (agg.porMotivo[m] ?? 0) + 1;
  }

  return [...porChave.values()].sort((a, b) => b.total - a.total);
}

/**
 * Quantas vezes o MESMO agente foi reprovado (VERMELHO/CRITICO) recentemente —
 * o sinal de "repetição" que aciona a camada profunda (`camadaProfunda.ts`).
 *
 * Por `autorUserId` quando existe (SDR humano, ou a IA assinando como um
 * "agente" nomeado); por `papelDoAgente` quando não (o TA sem pessoa por trás).
 * Nunca os dois juntos: misturar contaria a mesma reprovação duas vezes se
 * algum dia as duas chaves coexistirem.
 */
export async function contarReprovacoesRecentes(
  db: Cliente,
  params: { autorUserId?: string | null; papelDoAgente?: string | null; desde: Date; excluirMensagemId?: string },
): Promise<number> {
  if (!params.autorUserId && !params.papelDoAgente) return 0;

  return db.supervisoraAvaliacao.count({
    where: {
      ...(params.autorUserId ? { autorUserId: params.autorUserId } : { papelDoAgente: params.papelDoAgente }),
      veredito: { in: ["VERMELHO", "CRITICO"] },
      criadaEm: { gte: params.desde },
      ...(params.excluirMensagemId ? { mensagemId: { not: params.excluirMensagemId } } : {}),
    },
  });
}
