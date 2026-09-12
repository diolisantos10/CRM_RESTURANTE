/**
 * O PAINEL DA SUPERVISORA — Visão Geral e Conversas em Risco.
 *
 * ── UMA FONTE SÓ ─────────────────────────────────────────────────────────────
 *
 * A Visão Geral é inteira agregada sobre `SupervisoraAvaliacao`: conversas
 * acompanhadas, mensagens corrigidas, mensagens bloqueadas, escaladas para
 * gente e o ranking de motivos são todos colunas ou campos desta mesma tabela,
 * lidos com um `findMany` e somados aqui — igual ao molde de
 * `desempenhoPorAgente` (`desempenho.ts`), que já faz a mesma coisa por
 * agente. Nenhuma tabela de "resumo consolidado" existe nem nasce aqui.
 *
 * A única informação que NÃO mora em `SupervisoraAvaliacao` e ainda assim
 * aparece na Visão Geral é "opt-outs": pedir para parar é um fato do LEAD
 * (`SiteLead.optOutAt`), nunca da mensagem avaliada. Contá-lo aqui não é abrir
 * uma segunda fonte para o que a Supervisora mede — é a única fonte real para
 * um fato que ela não mede, restrita aos leads que ELA acompanhou no período
 * (nunca a base inteira), para a Visão Geral não emprestar número de fora do
 * que está sob observação.
 *
 * ── CONVERSAS EM RISCO ───────────────────────────────────────────────────────
 *
 * Lê as avaliações retidas (`bloqueada`) ou reprovadas (VERMELHO/CRITICO),
 * mais recentes primeiro, com o nome do lead e de quem está com ele agora —
 * só o necessário para a tela decidir qual das três ações já existentes
 * (`assumir`/`pedirHumano`/`devolver`, todas em `responsavel.ts`/`handoff.ts`
 * por trás da rota `/api/admin/sala-de-vendas/responsavel`) está disponível.
 * Nenhuma ação nova nasce aqui — este arquivo só LÊ.
 */

import type {
  PrismaClient,
  Prisma,
  MotivoDaSupervisora,
  VeredictoDaSupervisora,
} from "@prisma/client";
import { CRITERIOS_DA_FASE_3 } from "./desempenho";

type Cliente = PrismaClient | Prisma.TransactionClient;

export interface VisaoGeralDaSupervisora {
  periodo: { de: Date; ate: Date };
  conversasAcompanhadas: number;
  mensagensAvaliadas: number;
  mensagensCorrigidas: number;
  mensagensBloqueadas: number;
  escaladasParaGente: number;
  falhasTecnicas: number;
  /** Leads acompanhados no período que pediram para parar (`SiteLead.optOutAt`
   *  dentro da janela) — ver nota no topo do arquivo sobre por que este é o
   *  único número que não vem só de `SupervisoraAvaliacao`. */
  optOuts: number;
  porVeredito: Record<VeredictoDaSupervisora, number>;
  /** Os motivos mais frequentes no período, com rótulo pronto para a tela —
   *  os mesmos nomes de `CRITERIOS_DA_FASE_3`, mais os dois que não são um
   *  "critério de desempenho" (falha técnica, outro). */
  principaisRiscos: Array<{ motivo: MotivoDaSupervisora; rotulo: string; total: number }>;
}

const ROTULO_DO_MOTIVO: Record<MotivoDaSupervisora, string> = Object.fromEntries([
  ...CRITERIOS_DA_FASE_3.map((c) => [c.motivo, c.rotulo] as const),
  ["FALHA_TECNICA", "Falha técnica da Supervisora"],
  ["OUTRO", "Outro"],
]) as Record<MotivoDaSupervisora, string>;

export async function visaoGeralDaSupervisora(
  db: Cliente,
  params: { de: Date; ate: Date },
): Promise<VisaoGeralDaSupervisora> {
  const linhas = await db.supervisoraAvaliacao.findMany({
    where: { criadaEm: { gte: params.de, lt: params.ate } },
    select: {
      leadId: true,
      veredito: true,
      motivos: true,
      bloqueada: true,
      acaoTomada: true,
      handoffDisparado: true,
      falhaTecnica: true,
    },
  });

  const leadsAcompanhados = new Set<string>();
  const porVeredito: Record<VeredictoDaSupervisora, number> = {
    VERDE: 0,
    AMARELO: 0,
    VERMELHO: 0,
    CRITICO: 0,
  };
  const porMotivo = new Map<MotivoDaSupervisora, number>();
  let mensagensCorrigidas = 0;
  let mensagensBloqueadas = 0;
  let escaladasParaGente = 0;
  let falhasTecnicas = 0;

  for (const l of linhas) {
    leadsAcompanhados.add(l.leadId);
    porVeredito[l.veredito] += 1;
    if (l.acaoTomada === "REESCREVEU") mensagensCorrigidas += 1;
    if (l.bloqueada) mensagensBloqueadas += 1;
    if (l.handoffDisparado) escaladasParaGente += 1;
    if (l.falhaTecnica) falhasTecnicas += 1;
    for (const m of l.motivos) porMotivo.set(m, (porMotivo.get(m) ?? 0) + 1);
  }

  const optOuts =
    leadsAcompanhados.size === 0
      ? 0
      : await db.siteLead.count({
          where: {
            id: { in: [...leadsAcompanhados] },
            optOutAt: { gte: params.de, lt: params.ate },
          },
        });

  const principaisRiscos = [...porMotivo.entries()]
    .map(([motivo, total]) => ({ motivo, rotulo: ROTULO_DO_MOTIVO[motivo], total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  return {
    periodo: { de: params.de, ate: params.ate },
    conversasAcompanhadas: leadsAcompanhados.size,
    mensagensAvaliadas: linhas.length,
    mensagensCorrigidas,
    mensagensBloqueadas,
    escaladasParaGente,
    falhasTecnicas,
    optOuts,
    porVeredito,
    principaisRiscos,
  };
}

export interface ConversaEmRisco {
  avaliacaoId: string;
  leadId: string;
  leadNome: string;
  leadWhatsapp: string;
  etapa: string | null;
  autorUserId: string | null;
  autorNome: string | null;
  papelDoAgente: string | null;
  veredito: VeredictoDaSupervisora;
  motivos: MotivoDaSupervisora[];
  motivoDetalhe: string | null;
  bloqueada: boolean;
  handoffDisparado: boolean;
  criadaEm: Date;
  /** Quem está com o lead agora — é isto que decide qual das três ações a
   *  tela oferece (ver `AcoesDisponiveis` no cliente). */
  atendidoPorAgora: string;
  atendenteAtualUserId: string | null;
}

/**
 * As conversas que pedem atenção agora: retidas OU reprovadas
 * (VERMELHO/CRITICO), mais recentes primeiro. Uma linha por AVALIAÇÃO, não
 * por lead — um lead com duas mensagens ruins aparece duas vezes, de
 * propósito: a segunda reprovação é, ela mesma, um sinal.
 */
export async function conversasEmRisco(
  db: Cliente,
  params: { limite?: number; de?: Date; ate?: Date } = {},
): Promise<ConversaEmRisco[]> {
  const linhas = await db.supervisoraAvaliacao.findMany({
    where: {
      OR: [{ bloqueada: true }, { veredito: { in: ["VERMELHO", "CRITICO"] } }],
      ...(params.de || params.ate
        ? {
            criadaEm: {
              ...(params.de ? { gte: params.de } : {}),
              ...(params.ate ? { lt: params.ate } : {}),
            },
          }
        : {}),
    },
    orderBy: { criadaEm: "desc" },
    take: params.limite ?? 50,
    select: {
      id: true,
      leadId: true,
      autorUserId: true,
      papelDoAgente: true,
      veredito: true,
      motivos: true,
      motivoDetalhe: true,
      bloqueada: true,
      handoffDisparado: true,
      criadaEm: true,
      lead: { select: { nome: true, whatsapp: true, stage: true, atendidoPor: true, atendenteUserId: true } },
    },
  });

  const autorIds = [...new Set(linhas.map((l) => l.autorUserId).filter((v): v is string => !!v))];
  const autores = autorIds.length
    ? await db.internalUser.findMany({ where: { id: { in: autorIds } }, select: { id: true, nome: true } })
    : [];
  const nomePorId = new Map(autores.map((a) => [a.id, a.nome]));

  return linhas.map((l) => ({
    avaliacaoId: l.id,
    leadId: l.leadId,
    leadNome: l.lead.nome,
    leadWhatsapp: l.lead.whatsapp,
    etapa: l.lead.stage,
    autorUserId: l.autorUserId,
    autorNome: l.autorUserId ? nomePorId.get(l.autorUserId) ?? null : null,
    papelDoAgente: l.papelDoAgente,
    veredito: l.veredito,
    motivos: l.motivos,
    motivoDetalhe: l.motivoDetalhe,
    bloqueada: l.bloqueada,
    handoffDisparado: l.handoffDisparado,
    criadaEm: l.criadaEm,
    atendidoPorAgora: l.lead.atendidoPor,
    atendenteAtualUserId: l.lead.atendenteUserId,
  }));
}
