/**
 * EVOLUÇÃO DE PROMPT — os níveis 2 e 3 do comando.
 *
 *   Nível 1 (correção da mensagem atual) NÃO mora aqui: é a reescrita de
 *   `revisao.ts` em modo GUARD/INTERVENTION, automática, e nunca toca
 *   `SdrIaConfigVersao`.
 *
 *   Nível 2 (esta seção: `registrarSugestao`) grava uma sugestão PERMANENTE
 *   para revisão humana. Não aplica sozinha.
 *
 *   Nível 3 (`aprovarSugestaoECriarVersao`) só a partir de uma sugestão
 *   APROVADA por humano: cria uma `SdrIaConfigVersao` nova em RASCUNHO, com os
 *   metadados de auditoria. **Nunca publica sozinha** — publicar continua
 *   sendo `publicarVersaoExistente` (`ta/interruptor.ts`), ação humana pela
 *   mesma tela/rota de sempre.
 *
 * ── A REGRA QUE O COMANDO PEDE, VIRANDO VALIDAÇÃO ───────────────────────────
 *
 * *"Uma mudança permanente não pode nascer de uma única conversa isolada,
 * salvo erro grave/informação falsa/risco de segurança."* Isto é
 * `validarEvidencia` abaixo: menos de duas evidências (`evidenciaMensagemIds`)
 * exige `erroGrave: true` explícito — nunca assumido.
 */

import type { PrismaClient, Prisma, AutorDaMensagem, SituacaoDaVersao } from "@prisma/client";

type Cliente = PrismaClient | Prisma.TransactionClient;

// ── Nível 2 ──────────────────────────────────────────────────────────────────

export interface NovaSugestao {
  agenteAfetadoTipo?: AutorDaMensagem | null;
  agenteAfetadoUserId?: string | null;
  papelDoAgente?: string | null;
  problemaObservado: string;
  evidenciaMensagemIds: string[];
  evidenciaLeadIds: string[];
  trechoAnterior?: string | null;
  trechoNovoProposto?: string | null;
  justificativa: string;
  autor?: "SISTEMA" | "SUPERVISORA";
}

export async function registrarSugestao(
  db: Cliente,
  s: NovaSugestao,
): Promise<{ ok: true; sugestaoId: string } | { ok: false; causa: "semEvidencia" | "semProblema" }> {
  if (!s.problemaObservado?.trim()) return { ok: false, causa: "semProblema" };
  if (s.evidenciaMensagemIds.length === 0) return { ok: false, causa: "semEvidencia" };

  const criada = await db.supervisoraSugestaoDePrompt.create({
    data: {
      agenteAfetadoTipo: s.agenteAfetadoTipo ?? null,
      agenteAfetadoUserId: s.agenteAfetadoUserId ?? null,
      papelDoAgente: s.papelDoAgente ?? null,
      problemaObservado: s.problemaObservado.trim(),
      evidenciaMensagemIds: s.evidenciaMensagemIds,
      evidenciaLeadIds: s.evidenciaLeadIds,
      trechoAnterior: s.trechoAnterior ?? null,
      trechoNovoProposto: s.trechoNovoProposto ?? null,
      justificativa: s.justificativa.trim(),
      autor: s.autor ?? "SUPERVISORA",
      situacao: "PENDENTE",
    },
    select: { id: true },
  });

  return { ok: true, sugestaoId: criada.id };
}

export async function rejeitarSugestao(
  db: Cliente,
  params: { sugestaoId: string; revisorId: string; nota?: string | null; agora?: Date },
): Promise<{ ok: true } | { ok: false; causa: "naoExiste" | "naoEstavaPendente" }> {
  const agora = params.agora ?? new Date();
  const r = await db.supervisoraSugestaoDePrompt.updateMany({
    where: { id: params.sugestaoId, situacao: "PENDENTE" },
    data: { situacao: "REJEITADA", revisadaPorId: params.revisorId, revisadaEm: agora, notaDaRevisao: params.nota ?? null },
  });
  if (r.count === 1) return { ok: true };

  const existe = await db.supervisoraSugestaoDePrompt.findUnique({ where: { id: params.sugestaoId } });
  return existe ? { ok: false, causa: "naoEstavaPendente" } : { ok: false, causa: "naoExiste" };
}

// ── Nível 3 ──────────────────────────────────────────────────────────────────

/** O que muda na ficha do TA. Todo campo omitido herda da versão ativa hoje. */
export interface PatchDaVersao {
  identidade?: string;
  tomDeVoz?: string;
  objetivos?: string;
  perguntas?: string[];
  /** Substitui a lista inteira. Para ADICIONAR uma proibição sem perder as
   *  existentes, quem chama lê `versaoAtiva.proibidos` e concatena antes. */
  proibidos?: string[];
}

export interface ResultadoDeCriarVersao {
  ok: true;
  versaoId: string;
  numero: number;
}

export type CausaDeRecusaDaVersao =
  | "sugestaoNaoExiste"
  | "sugestaoNaoAprovada"
  | "semConfigDoTA"
  | "evidenciaInsuficiente";

/**
 * Cria a `SdrIaConfigVersao` (nível 3) a partir de uma sugestão JÁ aprovada.
 *
 * ⚠️ A sugestão precisa estar `APROVADA` — aprovar é ato humano, separado
 * (mude `situacao` para `APROVADA` antes de chamar isto; não há atalho aqui que
 * pule essa etapa). Nasce sempre em `RASCUNHO`: publicar é outra ação, outro
 * botão, e sempre humana.
 */
export async function aprovarSugestaoECriarVersao(
  db: Cliente,
  params: {
    sugestaoId: string;
    patch: PatchDaVersao;
    criadaPorId: string;
    testeCorrespondente?: string | null;
    /** Obrigatório quando a sugestão tem menos de 2 evidências — a regra do
     *  comando: mudança permanente não nasce de uma conversa isolada, salvo
     *  erro grave/informação falsa/risco de segurança. */
    erroGrave?: boolean;
    situacaoInicial?: Extract<SituacaoDaVersao, "RASCUNHO" | "EM_TESTE">;
    agora?: Date;
  },
): Promise<ResultadoDeCriarVersao | { ok: false; causa: CausaDeRecusaDaVersao }> {
  const agora = params.agora ?? new Date();

  const sugestao = await db.supervisoraSugestaoDePrompt.findUnique({ where: { id: params.sugestaoId } });
  if (!sugestao) return { ok: false, causa: "sugestaoNaoExiste" };
  if (sugestao.situacao !== "APROVADA") return { ok: false, causa: "sugestaoNaoAprovada" };

  if (sugestao.evidenciaMensagemIds.length < 2 && !params.erroGrave) {
    return { ok: false, causa: "evidenciaInsuficiente" };
  }

  const config = await db.sdrIaConfig.findUnique({
    where: { slug: "ta" },
    select: {
      id: true,
      versaoAtiva: {
        select: { identidade: true, tomDeVoz: true, objetivos: true, perguntas: true, proibidos: true, gatilhos: true },
      },
    },
  });
  if (!config) return { ok: false, causa: "semConfigDoTA" };

  const base = config.versaoAtiva;

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
      situacao: params.situacaoInicial ?? "RASCUNHO",
      identidade: params.patch.identidade ?? base?.identidade ?? "",
      tomDeVoz: params.patch.tomDeVoz ?? base?.tomDeVoz ?? null,
      objetivos: params.patch.objetivos ?? base?.objetivos ?? null,
      perguntas: params.patch.perguntas ?? base?.perguntas ?? [],
      proibidos: params.patch.proibidos ?? base?.proibidos ?? [],
      gatilhos: base?.gatilhos ?? [],
      origemSugestaoId: sugestao.id,
      agenteAfetado: sugestao.papelDoAgente ?? sugestao.agenteAfetadoUserId ?? "todos",
      problemaObservado: sugestao.problemaObservado,
      evidencias: sugestao.evidenciaMensagemIds,
      trechoAnterior: sugestao.trechoAnterior,
      trechoNovoProposto: sugestao.trechoNovoProposto,
      justificativaDaAlteracao: sugestao.justificativa,
      criadaPorId: params.criadaPorId,
      testeCorrespondente: params.testeCorrespondente ?? null,
    },
    select: { id: true, numero: true },
  });

  await db.supervisoraSugestaoDePrompt.update({
    where: { id: sugestao.id },
    data: {
      situacao: "APLICADA",
      revisadaPorId: params.criadaPorId,
      revisadaEm: agora,
      versaoResultanteId: criada.id,
    },
  });

  return { ok: true, versaoId: criada.id, numero: criada.numero };
}
