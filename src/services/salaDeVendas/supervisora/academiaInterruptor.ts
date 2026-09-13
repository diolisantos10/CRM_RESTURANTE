/**
 * O INTERRUPTOR DA ACADEMIA COMERCIAL — publicar/reverter uma versão.
 *
 * ── POR QUE ISTO NÃO É `ta/interruptor.ts::publicarVersaoExistente` DIRETO ──
 *
 * `publicarVersaoExistente` já faz exatamente esta operação — marcar
 * `PUBLICADA` e mover o ponteiro singleton — para `SdrIaConfigVersao`. A
 * doutrina desta obra pede reaproveitar em vez de duplicar sempre que o TIPO
 * permitir. Aqui ele não permite, sem generalizar o Prisma Client: `db.sdrIaConfig`
 * / `db.sdrIaConfigVersao` e `db.academiaComercialConfig` /
 * `db.academiaComercialVersao` são delegates DIFERENTES (campos diferentes —
 * a config do TA tem `slug`, a da Academia é singleton por `id` fixo, como
 * `SupervisoraConfig` — e sem `configSlug` para escolher a tabela). Fazer os
 * dois casos caberem numa função só pediria um parâmetro de delegate genérico
 * (`db.sdrIaConfigVersao` vs `db.academiaComercialVersao` passados como
 * argumento) — mais indireção do que o ganho justifica para DOIS usos. Por
 * isso: uma função paralela, pequena, no MESMO desenho (mesmos passos, mesmo
 * tipo de retorno, mesma idempotência) — documentada aqui para não divergir
 * em silêncio se um dos dois lados mudar.
 *
 * ── A MESMA REGRA: O CÓDIGO NUNCA PUBLICA SOZINHO ────────────────────────────
 *
 * `scripts/semear-academia-comercial.ts` só cria `RASCUNHO`. Só esta função,
 * chamada pela rota administrativa (mesmo padrão de autorização do painel da
 * Supervisora), marca `PUBLICADA`.
 *
 * ── SITUACAO NÃO É REVOGADA DA VERSÃO ANTERIOR, DE PROPÓSITO ────────────────
 *
 * Igual a `publicarVersaoExistente`: publicar uma versão nova NÃO volta a
 * anterior para `APOSENTADA` automaticamente — o ponteiro singleton
 * (`versaoAtivaId`) é a única fonte de verdade sobre qual versão vale agora;
 * `situacao` é rastro de auditoria de quando ESTA versão foi publicada, não um
 * segundo lugar que precisa ficar sincronizado. Mesmo comportamento dos dois
 * lados — nenhum dos dois é "mais certo" que o outro.
 */

import type { PrismaClient, Prisma, SituacaoDaVersao } from "@prisma/client";

type Cliente = PrismaClient | Prisma.TransactionClient;

const SINGLETON_ID = "singleton";

export interface EstadoDaAcademia {
  temVersaoPublicada: boolean;
  versaoAtivaId: string | null;
  versaoNumero: number | null;
  situacao: SituacaoDaVersao | null;
  publicadaEm: Date | null;
}

export async function lerEstadoDaAcademia(db: Cliente): Promise<EstadoDaAcademia> {
  const config = await db.academiaComercialConfig.findUnique({
    where: { id: SINGLETON_ID },
    select: {
      versaoAtiva: { select: { id: true, numero: true, situacao: true, publicadaEm: true } },
    },
  });

  const ativa = config?.versaoAtiva ?? null;

  return {
    temVersaoPublicada: Boolean(ativa),
    versaoAtivaId: ativa?.id ?? null,
    versaoNumero: ativa?.numero ?? null,
    situacao: ativa?.situacao ?? null,
    publicadaEm: ativa?.publicadaEm ?? null,
  };
}

export type ResultadoDePublicarVersaoDaAcademia =
  | { ok: true; numero: number; eraAAtiva: boolean }
  | { ok: false; causa: "versaoNaoExiste" };

/**
 * Publica uma `AcademiaComercialVersao` que já existe — por id. É o mesmo
 * mecanismo para publicar pela primeira vez e para reverter (publicar uma
 * versão anterior de volta): as duas situações só apontam o singleton para um
 * id que já existe no banco.
 *
 * Idempotente: publicar a versão que já está ativa não erra, só avisa
 * (`eraAAtiva: true`).
 */
export async function publicarVersaoDaAcademia(
  db: Cliente,
  params: { versaoId: string; porUserId?: string | null; agora?: Date },
): Promise<ResultadoDePublicarVersaoDaAcademia> {
  const agora = params.agora ?? new Date();

  const versao = await db.academiaComercialVersao.findUnique({
    where: { id: params.versaoId },
    select: { id: true, numero: true },
  });
  if (!versao) return { ok: false, causa: "versaoNaoExiste" };

  const configAtual = await db.academiaComercialConfig.findUnique({
    where: { id: SINGLETON_ID },
    select: { versaoAtivaId: true },
  });

  if (configAtual?.versaoAtivaId === versao.id) {
    return { ok: true, numero: versao.numero, eraAAtiva: true };
  }

  // Sequencial, não `$transaction`: `db` aqui pode já ser um
  // `Prisma.TransactionClient` (mesmo motivo documentado em
  // `ta/interruptor.ts::publicarVersaoExistente`). O pior caso de uma corrida
  // rara aqui é a versão marcar `PUBLICADA` um instante antes do ponteiro
  // apontar para ela — nunca um estado que a tela leia como inconsistente.
  await db.academiaComercialVersao.update({
    where: { id: versao.id },
    data: { situacao: "PUBLICADA", publicadaEm: agora, publicadaPorId: params.porUserId ?? null },
  });

  await db.academiaComercialConfig.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, versaoAtivaId: versao.id },
    update: { versaoAtivaId: versao.id },
  });

  return { ok: true, numero: versao.numero, eraAAtiva: false };
}
