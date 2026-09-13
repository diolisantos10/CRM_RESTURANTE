/**
 * O INTERRUPTOR DO TA — publicar a versão e ligar o agente.
 *
 * ── POR QUE ISTO PRECISA DE TELA, E NÃO DE COMANDO ──────────────────────────
 *
 * Quem decide se um robô fala com estranho em nome da empresa é o dono, e o dono
 * não abre terminal. Enquanto ligar o TA exigisse `UPDATE sdr_ia_config`, a
 * decisão dele dependeria de alguém traduzir a decisão em SQL — e a data em que
 * o agente foi ligado não seria a data em que ele decidiu.
 *
 * ── AS DUAS COISAS SÃO SEPARADAS, E É DE PROPÓSITO ──────────────────────────
 *
 *   · **Publicar a versão** é dizer QUEM ele é: identidade, tom, proibições,
 *     gatilhos. Sem versão publicada ele fica calado mesmo ligado — seria um
 *     agente sem identidade e sem lista de proibições.
 *   · **Ligar** é dizer que ele pode trabalhar.
 *
 * Publicar não liga. Um botão só, que fizesse as duas, tiraria do dono a chance
 * de revisar o texto antes de o agente existir.
 *
 * ── ⚠️ E NENHUMA DAS DUAS FAZ O TA ENVIAR MENSAGEM ──────────────────────────
 *
 * A terceira chave — `FOOCCI_SDR_SEND_ENABLED` — mora no ambiente e não nesta
 * tela, e a separação não é descuido. Ligado, o TA recebe, pensa e GRAVA o que
 * diria, como PENDENTE. Entregar é outro ato: receber e pensar é seguro; falar
 * com um estranho em nome da empresa é outra coisa.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { VERSAO_1 } from "./ficha";

type Cliente = PrismaClient | Prisma.TransactionClient;

export interface EstadoDoTA {
  ligado: boolean;
  /** Sem isto ele fica calado mesmo ligado. */
  temVersaoPublicada: boolean;
  versaoNumero: number | null;
  horaInicio: number;
  horaFim: number;
  maxSemResposta: number;
  /** A ficha publicada, para a tela mostrar o que foi aprovado. */
  identidade: string | null;
  proibidos: string[];
}

export async function lerEstadoDoTA(db: Cliente): Promise<EstadoDoTA | null> {
  const c = await db.sdrIaConfig.findUnique({
    where: { slug: "ta" },
    select: {
      ligado: true,
      horaInicio: true,
      horaFim: true,
      maxSemResposta: true,
      versaoAtiva: { select: { numero: true, identidade: true, proibidos: true } },
    },
  });

  if (!c) return null;

  return {
    ligado: c.ligado,
    temVersaoPublicada: Boolean(c.versaoAtiva),
    versaoNumero: c.versaoAtiva?.numero ?? null,
    horaInicio: c.horaInicio,
    horaFim: c.horaFim,
    maxSemResposta: c.maxSemResposta,
    identidade: c.versaoAtiva?.identidade ?? null,
    proibidos: c.versaoAtiva?.proibidos ?? [],
  };
}

export type ResultadoDePublicar =
  | { ok: true; numero: number; jaEstava: boolean }
  | { ok: false; causa: "semConfig" };

/**
 * Publica a ficha do TA como a versão ativa.
 *
 * Idempotente por CONTEÚDO: publicar duas vezes a mesma ficha não cria uma
 * segunda versão. Sem isso, um duplo clique na tela viraria "versão 2" sem nada
 * ter mudado — e o número da versão deixaria de significar alguma coisa.
 */
export async function publicarAFicha(
  db: Cliente,
  params: { porUserId?: string | null; agora?: Date } = {},
): Promise<ResultadoDePublicar> {
  const agora = params.agora ?? new Date();

  const config = await db.sdrIaConfig.findUnique({
    where: { slug: "ta" },
    select: {
      id: true,
      versaoAtiva: { select: { id: true, numero: true, identidade: true, notaDaVersao: true } },
    },
  });

  if (!config) return { ok: false, causa: "semConfig" };

  const atual = config.versaoAtiva;
  if (atual && atual.identidade === VERSAO_1.identidade && atual.notaDaVersao === VERSAO_1.notaDaVersao) {
    return { ok: true, numero: atual.numero, jaEstava: true };
  }

  const ultima = await db.sdrIaConfigVersao.findFirst({
    where: { configId: config.id },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });

  const numero = (ultima?.numero ?? 0) + 1;

  const criada = await db.sdrIaConfigVersao.create({
    data: {
      configId: config.id,
      numero,
      situacao: "PUBLICADA",
      identidade: VERSAO_1.identidade,
      tomDeVoz: VERSAO_1.tomDeVoz,
      objetivos: VERSAO_1.objetivos,
      perguntas: VERSAO_1.perguntas,
      proibidos: VERSAO_1.proibidos,
      gatilhos: VERSAO_1.gatilhos,
      notaDaVersao: VERSAO_1.notaDaVersao,
      publicadaEm: agora,
      publicadaPorId: params.porUserId ?? null,
    },
    select: { id: true, numero: true },
  });

  await db.sdrIaConfig.update({
    where: { id: config.id },
    data: { versaoAtivaId: criada.id },
  });

  return { ok: true, numero: criada.numero, jaEstava: false };
}

export type ResultadoDeLigar =
  | { ok: true; ligado: boolean }
  | { ok: false; causa: "semConfig" | "semVersaoPublicada" };

/**
 * Liga ou desliga o TA.
 *
 * ⚠️ **Ligar exige versão publicada.** Um agente ligado sem ficha seria um
 * agente sem identidade e sem lista de proibições — e o `atender.ts` o manteria
 * calado de qualquer forma. Recusar aqui troca um silêncio inexplicável na
 * conversa por uma frase na tela de quem apertou o botão.
 *
 * Desligar nunca exige nada. A trava é só no sentido que liga: proteção que
 * atrapalha desligar é proteção pior que o problema.
 */
export async function ligarOTA(
  db: Cliente,
  ligado: boolean,
): Promise<ResultadoDeLigar> {
  const config = await db.sdrIaConfig.findUnique({
    where: { slug: "ta" },
    select: { id: true, versaoAtivaId: true },
  });

  if (!config) return { ok: false, causa: "semConfig" };
  if (ligado && !config.versaoAtivaId) return { ok: false, causa: "semVersaoPublicada" };

  await db.sdrIaConfig.update({ where: { id: config.id }, data: { ligado } });
  return { ok: true, ligado };
}

export type ResultadoDePublicarVersaoExistente =
  | { ok: true; numero: number; eraAAtiva: boolean }
  | { ok: false; causa: "semConfig" | "versaoNaoExiste" | "versaoDeOutraConfig" };

/**
 * Publica uma `SdrIaConfigVersao` que JÁ EXISTE — por número, ou por id.
 *
 * ── ESTE É O ROLLBACK, E TAMBÉM É O PUBLICAR DA SUPERVISORA ─────────────────
 *
 * `publicarAFicha`, acima, sempre cria uma versão nova a partir do código
 * (`VERSAO_1`) — serve à ficha escrita à mão. Uma versão nascida de
 * `supervisora/sugestoes.ts` (nível 3) já existe no banco, em `RASCUNHO`; e
 * reverter para uma versão antiga é, por definição, apontar para algo que já
 * existia. As duas situações são a MESMA operação: marcar `PUBLICADA` e mover
 * `versaoAtivaId`. Escrever um "rollback" separado duplicaria o mecanismo que
 * `versaoAtivaId` já é.
 *
 * Idempotente: publicar a versão que já está ativa não erra, só avisa
 * (`eraAAtiva: true`) — dois cliques no mesmo botão não podem produzir dois
 * efeitos diferentes.
 */
export async function publicarVersaoExistente(
  db: Cliente,
  params: { configSlug?: string; versaoId: string; porUserId?: string | null; agora?: Date },
): Promise<ResultadoDePublicarVersaoExistente> {
  const agora = params.agora ?? new Date();

  const config = await db.sdrIaConfig.findUnique({
    where: { slug: params.configSlug ?? "ta" },
    select: { id: true, versaoAtivaId: true },
  });
  if (!config) return { ok: false, causa: "semConfig" };

  const versao = await db.sdrIaConfigVersao.findUnique({
    where: { id: params.versaoId },
    select: { id: true, numero: true, configId: true },
  });
  if (!versao) return { ok: false, causa: "versaoNaoExiste" };
  if (versao.configId !== config.id) return { ok: false, causa: "versaoDeOutraConfig" };

  if (config.versaoAtivaId === versao.id) {
    return { ok: true, numero: versao.numero, eraAAtiva: true };
  }

  // ⛔ MEDIDO EM 12/09/2026: "sequencial, não `$transaction`" era o defeito,
  // não a explicação dele.
  //
  // Este comentário dizia que duas escritas em sequência bastavam porque "o
  // pior caso de uma corrida rara aqui é a versão marcar PUBLICADA um
  // instante antes de `versaoAtivaId` apontar para ela" — como se o único
  // risco fosse uma LEITURA pegando o meio do caminho. Não é: se o processo
  // cair, a conexão cair, ou a SEGUNDA escrita falhar por qualquer motivo
  // (constraint, timeout, o banco fora do ar por um instante) DEPOIS que a
  // primeira já fez `COMMIT` sozinha, o banco fica com uma versão marcada
  // `PUBLICADA` e `sdr_ia_config.versaoAtivaId` ainda apontando para a
  // antiga — um estado parcial de verdade, não hipotético, e exatamente o que
  // uma auditoria pediria para nunca acontecer num interruptor de produção.
  //
  // As duas escritas têm que nascer e morrer juntas: ou as duas acontecem, ou
  // nenhuma. `db.$transaction` cobre o caso comum (chamado direto da rota,
  // com `prisma`, sem transação em volta). Quando `db` já é um
  // `Prisma.TransactionClient` (chamado de dentro de outra transação — e um
  // `tx` não tem `$transaction`, porque não se abre transação dentro de
  // transação), as duas escritas já herdam a atomicidade da transação que o
  // CHAMADOR abriu, e rodam nela direto, sem tentar abrir uma nova.
  const escreverAsDuas = (cliente: Cliente) =>
    cliente.sdrIaConfigVersao
      .update({
        where: { id: versao.id },
        data: {
          situacao: "PUBLICADA",
          publicadaEm: agora,
          publicadaPorId: params.porUserId ?? null,
        },
      })
      .then(() => cliente.sdrIaConfig.update({ where: { id: config.id }, data: { versaoAtivaId: versao.id } }));

  if (ehClientePleno(db)) {
    await db.$transaction((tx) => escreverAsDuas(tx));
  } else {
    await escreverAsDuas(db);
  }

  return { ok: true, numero: versao.numero, eraAAtiva: false };
}

/**
 * `true` só para um `PrismaClient` de verdade — um `Prisma.TransactionClient`
 * (o `tx` que `db.$transaction(async (tx) => ...)` passa para dentro) não tem
 * `$transaction` no seu próprio tipo. Decide se `publicarVersaoExistente`
 * precisa abrir a sua própria transação ou se já está dentro de uma que o
 * chamador abriu (e que já cobre as duas escritas).
 */
function ehClientePleno(db: Cliente): db is PrismaClient {
  return typeof (db as Partial<PrismaClient>).$transaction === "function";
}
