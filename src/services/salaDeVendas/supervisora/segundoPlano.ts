/**
 * O DESPACHO EM SEGUNDO PLANO — extraído de `revisao.ts` em 12/09/2026 para
 * `adequacaoDoTemplate.ts` (a avaliação da Supervisora sobre `abordar.ts`)
 * poder rodar em SHADOW sem atrasar, com a MESMA mecânica, sem copiar o
 * arquivo inteiro.
 *
 * ── ⚠️ O QUE ISTO NÃO FAZ ────────────────────────────────────────────────────
 *
 * NÃO decide modo. `revisao.ts` e `adequacaoDoTemplate.ts` continuam lendo
 * `lerConfig`/`modoEfetivo`, cada um por conta própria, e só chamam
 * `dispararEmSegundoPlano` DEPOIS de já terem decidido "isto é SHADOW". Extrair
 * a decisão de modo para cá seria criar uma segunda fonte da verdade sobre o
 * que SHADOW significa — exatamente o que a missão original proíbe. O que
 * este arquivo generaliza é só a MECÂNICA de rodar sem bloquear: esperar o
 * commit da transação quando `db` é um `tx`, aplicar um teto de tempo, e nunca
 * deixar uma "unhandled rejection" escapar.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { prisma as prismaSingleton } from "@/lib/prisma";

type Cliente = PrismaClient | Prisma.TransactionClient;

/**
 * `true` só para um `PrismaClient` de verdade — um `Prisma.TransactionClient`
 * (o `tx` que `db.$transaction(async (tx) => ...)` passa para dentro) não tem
 * `$transaction` no seu próprio tipo, porque não se abre transação dentro de
 * transação. É a distinção que importa aqui: um `tx` só é válido enquanto o
 * callback que o recebeu não retornou — usá-lo depois (em trabalho que roda
 * "em segundo plano", por definição depois de o chamador já ter seguido em
 * frente) é usar uma conexão que pode já ter sido devolvida ao pool.
 */
export function ehClientePleno(db: Cliente): db is PrismaClient {
  return typeof (db as Partial<PrismaClient>).$transaction === "function";
}

/**
 * Quanto esperar, só quando `db` era um `tx`, antes de a avaliação em segundo
 * plano tocar o banco pelo cliente avulso (`prismaSingleton`) — ver o
 * comentário completo (a corrida com o COMMIT) em `revisao.ts`, onde este
 * número nasceu. 300ms é generoso: o `COMMIT` da transação do webhook
 * historicamente termina bem abaixo de 50ms neste banco.
 */
export const ATRASO_PADRAO_ANTES_DE_TOCAR_O_BANCO_MS = 300;

export interface OpcoesDoDespacho {
  /** Sobrescreve `ATRASO_PADRAO_ANTES_DE_TOCAR_O_BANCO_MS` quando `db` não é
   *  um cliente pleno. Raramente necessário. */
  atrasoMs?: number;
  /** Teto de tempo para a tarefa inteira. Estourar chama `onTimeoutOuErro`. */
  timeoutMs: number;
  /** Chamado uma vez, para um timeout OU uma exceção da tarefa — nunca as
   *  duas. Recebe o cliente durável (o mesmo que a tarefa recebeu), para
   *  poder registrar a falha técnica sem reabrir a decisão de qual cliente
   *  usar. Erros daqui de dentro são só logados pelo chamador; nunca sobem. */
  onTimeoutOuErro: (clienteDuravel: Cliente, erro: unknown, estourouTimeout: boolean) => Promise<void>;
}

/**
 * Dispara `tarefa` sem bloquear quem chamou — não tem `await` no ponto de
 * chamada, de propósito. `tarefa` recebe um cliente que sobrevive além desta
 * chamada (nunca o `tx` original, quando `db` era um).
 */
export function dispararEmSegundoPlano(
  db: Cliente,
  tarefa: (clienteDuravel: Cliente) => Promise<void>,
  opts: OpcoesDoDespacho,
): void {
  const clienteDuravel = ehClientePleno(db) ? db : prismaSingleton;
  const atraso = ehClientePleno(db) ? 0 : (opts.atrasoMs ?? ATRASO_PADRAO_ANTES_DE_TOCAR_O_BANCO_MS);

  const tarefaCompleta = (async () => {
    if (atraso > 0) await new Promise((r) => setTimeout(r, atraso));

    let estourou = false;
    const timeout = new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        estourou = true;
        reject(new Error(`avaliação em segundo plano excedeu ${opts.timeoutMs}ms`));
      }, opts.timeoutMs);
    });

    try {
      await Promise.race([tarefa(clienteDuravel), timeout]);
    } catch (e) {
      await opts.onTimeoutOuErro(clienteDuravel, e, estourou).catch(() => {
        // Última linha de defesa: nem o registro da falha conseguiu rodar.
        // Quem passou `onTimeoutOuErro` já loga o próprio erro; aqui não há
        // mais nada a fazer além de não deixar isto virar um throw.
      });
    }
  })();

  // `void` no ponto de chamada já diz "não espero por isto"; este `.catch` é
  // só para o Node nunca reportar "unhandled rejection" de uma tarefa que,
  // por desenho, ninguém está esperando.
  tarefaCompleta.catch(() => {});
}
