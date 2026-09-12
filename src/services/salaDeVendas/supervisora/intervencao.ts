/**
 * A CAPACIDADE EXCLUSIVA DO MODO `INTERVENTION` — pausar/assumir uma conversa
 * EM ANDAMENTO, fora do fluxo de uma mensagem específica.
 *
 * ── A DIFERENÇA REAL COM `GUARD` ─────────────────────────────────────────────
 *
 * `GUARD` só age quando HÁ uma mensagem saindo — é reativo a `entregarMensagem`.
 * Mas uma conversa pode precisar de pausa mesmo sem nada saindo agora: o lead
 * acabou de escrever algo grave e o próximo turno do TA ainda não rodou (pode
 * nem rodar tão cedo, se ele ficou em silêncio). Esta varredura cobre esse vão,
 * olhando o que já está gravado — sem esperar a próxima saída para agir.
 *
 * ── NENHUM DETECTOR NOVO ─────────────────────────────────────────────────────
 *
 * Reaproveita `ta/memoria.ts` (irritação e pedido de humano, já acumulados por
 * `atender.ts` a cada turno) e `handoff.ts`/`responsavel.ts` para a pausa em
 * si — a mesma trava atômica de sempre, nunca uma segunda.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { lerConfig, modoEfetivo } from "./config";
import { lerMemoria } from "../ta/memoria";
import { passarParaGente } from "../handoff";

type Cliente = PrismaClient | Prisma.TransactionClient;

export interface LeadPausado {
  leadId: string;
  motivo: string;
}

export interface ResultadoDaVarredura {
  /** `false` quando o modo não é `INTERVENTION` — a varredura nem olha leads. */
  rodou: boolean;
  leadsAvaliados: number;
  leadsPausados: LeadPausado[];
}

/** Grau de irritação (escala de `lerIrritacao`, `ta/memoria.ts`) que basta
 *  sozinho, sem esperar a próxima mensagem de saída, para pausar. */
const IRRITACAO_QUE_PAUSA_SOZINHA = 3;

/**
 * Varre os leads hoje com a IA (`atendidoPor: "IA"`) e pausa os que já mostram
 * sinal grave. Chamável por um cron (ver `/api/cron/supervisora/varredura`) ou
 * diretamente em teste.
 *
 * **Nunca lança.** Uma falha em UM lead não pode impedir a varredura dos
 * outros — o mesmo motivo por que `abordar.ts` isola cada contato.
 */
export async function varrerConversasEmAndamento(
  db: Cliente,
  agora: Date = new Date(),
): Promise<ResultadoDaVarredura> {
  const config = await lerConfig(db);
  if (modoEfetivo(config) !== "INTERVENTION") {
    return { rodou: false, leadsAvaliados: 0, leadsPausados: [] };
  }

  const leads = await db.siteLead.findMany({
    where: { atendidoPor: "IA" },
    select: { id: true },
    take: 200,
  });

  const pausados: LeadPausado[] = [];

  for (const lead of leads) {
    try {
      const memoria = await lerMemoria(db, lead.id);
      if (memoria.irritacao < IRRITACAO_QUE_PAUSA_SOZINHA && !memoria.pediuHumano) continue;

      const motivo = memoria.pediuHumano
        ? "o lead já pediu falar com uma pessoa e a automação seguiu"
        : "irritação grave, fora do fluxo de uma mensagem de saída";

      const r = await passarParaGente(db, {
        leadId: lead.id,
        motivoEscrito: `Supervisora (INTERVENTION, varredura fora do fluxo de envio): ${motivo}`,
        dossie: { resumo: motivo },
        motivoExplicito: memoria.pediuHumano ? "PEDIU_HUMANO" : "SENTIMENTO_NEGATIVO",
        agora,
      });

      if (r.ok) pausados.push({ leadId: lead.id, motivo });
    } catch (e) {
      console.error("[supervisora] a varredura de intervenção falhou para um lead", {
        leadId: lead.id,
        erro: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { rodou: true, leadsAvaliados: leads.length, leadsPausados: pausados };
}
