/**
 * A TRAVA DE UMA CONVERSA — uma resposta por turno, e não duas.
 *
 * ── O DEFEITO QUE ELA CONSERTA, MEDIDO NA CONVERSA DE 09/09/2026 ────────────
 *
 * O lead escreveu três mensagens curtas em sequência, como gente escreve no
 * WhatsApp: *"é padaria"*, *"só vendo pelo iFood"*, *"o movimento tá fraco"*. O
 * TA respondeu **duas vezes**, e fora de ordem.
 *
 * A causa não estava no modelo. Está no caminho:
 *
 *   1. o webhook da Meta responde 200 na hora e dispara o TA em `void`, sem
 *      esperar (`webhooks/meta/whatsapp/route.ts`, `FoocciSalesInbound`);
 *   2. três mensagens em dois segundos são três disparos;
 *   3. cada disparo lê o histórico **sem as mensagens dos outros dois**, porque
 *      elas ainda não terminaram de gravar;
 *   4. cada um compõe uma resposta para um pedaço da conversa;
 *   5. quem chamar o modelo mais rápido chega primeiro — e a ordem da conversa
 *      passa a ser a ordem da latência da OpenAI, não a do relógio.
 *
 * ── ⚠️ POR QUE ISTO É UMA TABELA, E NÃO UMA VARIÁVEL DE MÓDULO ──────────────
 *
 * O app roda em mais de um processo. Um `Set` em memória protege um processo
 * contra si mesmo e **não protege nada contra o processo vizinho** — e o caso de
 * 09/09 é justamente o do vizinho. Uma trava só é trava se todos lerem do mesmo
 * lugar; o banco é esse lugar. Guardrail 4 da casa: prompt é aviso, código é
 * trava — e trava em memória, aqui, seria aviso com cara de trava.
 *
 * ── POR QUE ELA EXPIRA, E POR QUE ISSO NÃO É UM BURACO ──────────────────────
 *
 * Um processo que morre no meio do turno deixaria a conversa trancada para
 * sempre: uma falha de um turno viraria um lead que nunca mais é atendido. Com
 * `expiraEm`, passada a hora a trava vale como inexistente.
 *
 * O preço é conhecido e aceito: se um turno demorar MAIS que a validade, outro
 * pode entrar. Por isso a validade é folgada em relação ao tempo de um turno
 * (segundos), e por isso `soltar` só apaga a trava de quem a tomou — soltar a
 * trava alheia é o mesmo que não ter trava.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

type Cliente = PrismaClient | Prisma.TransactionClient;

/**
 * Quanto tempo uma trava vale.
 *
 * Um turno do TA são poucos segundos: ler a conversa, chamar o modelo (com uma
 * segunda tentativa quando o verificador reprova), gravar e entregar. Noventa
 * segundos dão folga de sobra para o pior caso e ainda destravam a conversa bem
 * antes de a pessoa desistir de esperar.
 */
export const VALIDADE_DA_TRAVA_MS = 90_000;

export interface TravaTomada {
  tomada: true;
  /** O bilhete que prova que a trava é sua. Guarde para soltar. */
  donoDoTurno: string;
}

export interface TravaNegada {
  tomada: false;
  /** Quem está com ela. Vai para o log, nunca para o cliente. */
  donoAtual: string;
  expiraEm: Date;
}

export type ResultadoDaTrava = TravaTomada | TravaNegada;

/**
 * ⭐ TOMA A TRAVA DA CONVERSA, OU DIZ QUE ELA JÁ TEM DONO.
 *
 * ── POR QUE SÃO DUAS ESCRITAS, E POR QUE ISSO É ATÔMICO ─────────────────────
 *
 *   1. **`create`** — vence a corrida no caso comum. A chave primária é o
 *      `leadId`, então dois processos criando ao mesmo tempo produzem UM sucesso
 *      e um `P2002`. Quem levou o `P2002` perdeu, e sabe disso.
 *
 *   2. **`updateMany` com `expiraEm <= agora`** — só para roubar trava vencida.
 *      Parece uma condição de corrida e não é: no Postgres, em `READ COMMITTED`,
 *      um `UPDATE` que esbarra numa linha travada por outra transação espera,
 *      e **reavalia o `WHERE` depois que a outra confirma**. Se o vizinho já
 *      empurrou `expiraEm` para o futuro, a nossa condição deixa de casar e o
 *      `count` volta 0. Dois ladrões, um roubo.
 *
 * ⚠️ Não use `upsert` no lugar disto. `upsert` sobrescreveria a trava de um
 * turno VIVO — que é exatamente o que esta função existe para impedir.
 */
export async function tomarATrava(
  db: Cliente,
  params: {
    leadId: string;
    agora?: Date;
    /** A última mensagem de entrada conhecida ao tomar a trava. */
    ultimaEntradaId?: string | null;
    validadeMs?: number;
  },
): Promise<ResultadoDaTrava> {
  const agora = params.agora ?? new Date();
  const expiraEm = new Date(agora.getTime() + (params.validadeMs ?? VALIDADE_DA_TRAVA_MS));
  const donoDoTurno = randomUUID();
  const ultimaEntradaId = params.ultimaEntradaId ?? null;

  try {
    await db.travaDaConversa.create({
      data: { leadId: params.leadId, donoDoTurno, tomadaEm: agora, expiraEm, ultimaEntradaId },
    });
    return { tomada: true, donoDoTurno };
  } catch (e) {
    // Qualquer erro que não seja "já existe" é problema de verdade e sobe. Uma
    // trava que engole falha de banco e devolve "não consegui" transformaria uma
    // queda do Postgres em silêncio do atendimento.
    if (!ehColisaoDeChave(e)) throw e;
  }

  const roubadas = await db.travaDaConversa.updateMany({
    where: { leadId: params.leadId, expiraEm: { lte: agora } },
    data: { donoDoTurno, tomadaEm: agora, expiraEm, ultimaEntradaId },
  });

  if (roubadas.count === 1) return { tomada: true, donoDoTurno };

  const atual = await db.travaDaConversa.findUnique({
    where: { leadId: params.leadId },
    select: { donoDoTurno: true, expiraEm: true },
  });

  // A trava sumiu entre o `updateMany` e a leitura (o dono soltou). Não é erro:
  // é a conversa livre. Quem chamou tenta de novo se quiser.
  return {
    tomada: false,
    donoAtual: atual?.donoDoTurno ?? "(soltou entre a tentativa e a leitura)",
    expiraEm: atual?.expiraEm ?? agora,
  };
}

/**
 * Solta a trava — **só se ela for sua**.
 *
 * O `donoDoTurno` no `where` não é zelo: sem ele, um turno lento que já teve a
 * trava roubada por vencimento apagaria, ao terminar, a trava do turno que
 * assumiu no lugar dele. O resultado seria dois turnos soltos na mesma conversa
 * — o defeito que a trava veio impedir, agora causado pela própria trava.
 */
export async function soltarATrava(
  db: Cliente,
  params: { leadId: string; donoDoTurno: string },
): Promise<{ soltou: boolean }> {
  const r = await db.travaDaConversa.deleteMany({
    where: { leadId: params.leadId, donoDoTurno: params.donoDoTurno },
  });
  return { soltou: r.count > 0 };
}

/**
 * A trava ainda é minha?
 *
 * Perguntado ANTES de enviar. Um turno que passou da validade e teve a trava
 * roubada não pode mandar a resposta que compôs: ela foi escrita sem enxergar o
 * que chegou depois, e sairia atropelando a resposta do turno novo.
 */
export async function aTravaAindaEMinha(
  db: Cliente,
  params: { leadId: string; donoDoTurno: string; agora?: Date },
): Promise<boolean> {
  const agora = params.agora ?? new Date();
  const t = await db.travaDaConversa.findUnique({
    where: { leadId: params.leadId },
    select: { donoDoTurno: true, expiraEm: true },
  });
  if (!t) return false;
  return t.donoDoTurno === params.donoDoTurno && t.expiraEm.getTime() > agora.getTime();
}

/**
 * Roda `trabalho` com a conversa travada, e solta no fim aconteça o que
 * acontecer.
 *
 * ⚠️ O `finally` é a peça. Sem ele, uma exceção no meio do turno deixa a trava
 * de pé até vencer, e a conversa fica muda por um minuto e meio — punindo o
 * lead por um erro nosso.
 *
 * Devolve `null` quando a trava já tinha dono. **`null` não é falha**: é o
 * turno vizinho dizendo "eu cuido desta conversa, e vou enxergar a sua mensagem
 * também, porque ela já está gravada".
 */
export async function comATravaDaConversa<T>(
  db: Cliente,
  params: { leadId: string; agora?: Date; ultimaEntradaId?: string | null; validadeMs?: number },
  trabalho: (dono: string) => Promise<T>,
): Promise<T | null> {
  let trava: ResultadoDaTrava;
  try {
    trava = await tomarATrava(db, params);
  } catch (e) {
    // ⛔ TRAVA QUEBRADA NÃO PODE CALAR O AGENTE — e esta linha é o conserto de
    // um risco medido em 10/09/2026, no minuto em que a trava foi ligada.
    //
    // Se a tabela não existe (migração ainda não rodou, deploy na frente do
    // banco) ou o Postgres oscila, `tomarATrava` levanta. Sem este ramo a
    // exceção subia e **toda mensagem de todo lead ficava sem resposta**, em
    // silêncio, com o webhook devolvendo 200 alegremente.
    //
    // Pesar os dois lados é simples: sem trava, o pior caso é a resposta dupla
    // que existia ontem — chato, visível, e que ninguém morre. Com a trava
    // quebrando o turno, o pior caso é a Sala inteira muda sem ninguém notar.
    // Segue-se sem trava, e o log GRITA.
    console.error(
      `[trava] A TRAVA FALHOU no lead ${params.leadId} — seguindo SEM ela. ` +
        "Risco de resposta dupla até isto ser consertado.",
      e,
    );
    return await trabalho("sem-trava");
  }

  if (!trava.tomada) return null;

  try {
    return await trabalho(trava.donoDoTurno);
  } finally {
    await soltarATrava(db, { leadId: params.leadId, donoDoTurno: trava.donoDoTurno }).catch((e) => {
      // Falhar ao soltar não pode derrubar um turno que deu certo: a trava vence
      // sozinha, e a resposta do lead já saiu.
      console.error(`[trava] não consegui soltar a trava do lead ${params.leadId}:`, e);
    });
  }
}

/** O `P2002` do Prisma — violação de chave única. */
function ehColisaoDeChave(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}
