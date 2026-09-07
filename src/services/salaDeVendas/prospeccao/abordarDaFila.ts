/**
 * O ÚLTIMO ELO — da fila de prospecção para a mensagem que sai.
 *
 * ── O QUE ESTAVA FALTANDO ───────────────────────────────────────────────────
 *
 * A casa tinha as duas pontas e nenhum fio entre elas:
 *
 *   · `materializarLead` transforma um item da lista em lead — e **não tinha um
 *     único chamador em produção**;
 *   · `abordarLead` manda a mensagem — e só sabia partir de um lead que já
 *     existisse.
 *
 * Este arquivo é o fio. Nada mais.
 *
 * ── ⚠️ POR QUE O FREIO É CONSULTADO AQUI, ANTES DE MATERIALIZAR ────────────
 *
 * `abordarLead` já confere o ritmo — mas ele confere DEPOIS que o lead existe.
 * Materializar primeiro e descobrir o teto depois deixaria um lead criado que
 * ninguém abordou: uma ficha órfã na base, nascida de uma tentativa que não
 * aconteceu. Multiplicado por uma lista grande, isso enche a carteira de gente
 * com quem a empresa nunca falou.
 *
 * A conferência dupla custa uma consulta e evita esse lixo. É repetição com
 * motivo, e está escrito qual é.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { materializarLead } from "./selecao";
import { abordarLead, type ResultadoDaAbordagem } from "../abordar";
import { conferirRitmo } from "../freioDeRitmo";

type Cliente = PrismaClient | Prisma.TransactionClient;

/** Os motivos de `abordarLead`, sem repetir a lista à mão. */
type MotivoDaAbordagem = Extract<ResultadoDaAbordagem, { abordou: false }>["motivo"];

export type ResultadoDaFila =
  | { abordou: true; leadId: string; mensagemId: string }
  | {
      abordou: false;
      /** `naoVirouLead` = o item nem chegou a ser lead (lote não liberado, já usado…). */
      motivo: "naoVirouLead" | MotivoDaAbordagem;
      detalhe: string;
    };

export async function abordarItemDaFila(
  db: Cliente,
  params: { itemId: string; autorUserId: string; agora?: Date },
): Promise<ResultadoDaFila> {
  const agora = params.agora ?? new Date();

  // ⚠️ ANTES de materializar. Ver o cabeçalho.
  const ritmo = await conferirRitmo(db, agora);
  if (!ritmo.pode) {
    return { abordou: false, motivo: "ritmo", detalhe: ritmo.detalhe };
  }

  const m = await materializarLead(db, params.itemId);
  if (!m.materializado) {
    return { abordou: false, motivo: "naoVirouLead", detalhe: m.motivo };
  }

  const r = await abordarLead(db, {
    leadId: m.leadId,
    autorUserId: params.autorUserId,
    agora,
  });

  if (r.abordou) {
    return { abordou: true, leadId: m.leadId, mensagemId: r.mensagemId };
  }

  // O motivo de `abordarLead` sobe inteiro. Traduzir aqui faria a tela mostrar
  // uma explicação que o serviço não deu.
  return { abordou: false, motivo: r.motivo, detalhe: r.detalhe };
}
