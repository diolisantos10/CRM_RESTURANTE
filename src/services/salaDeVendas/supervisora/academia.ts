/**
 * A ACADEMIA COMERCIAL — o conhecimento de venda consultiva que a Supervisora
 * consulta, sem nunca mandar o material inteiro ao modelo.
 *
 * ── ⛔ NUNCA "BUSCAR TUDO E FILTRAR EM JS" ───────────────────────────────────
 *
 * `recuperarConhecimentoRelevante` faz DUAS consultas pequenas, cada uma já
 * limitada por `take` e filtrada por `versaoId`/`etapa`/`tags` no WHERE — nunca
 * um `findMany` sem filtro seguido de `.filter()` em memória. A base inteira
 * (43 itens na v1, e cresce) nunca entra no processo de uma mensagem; só o
 * recorte que o SQL já decidiu que interessa.
 *
 * ── SÓ A VERSÃO PUBLICADA, NUNCA RASCUNHO/EM_TESTE ──────────────────────────
 *
 * Mesma doutrina de `SdrIaConfig.versaoAtivaId`: sem versão publicada, a
 * Supervisora julga como julga hoje — sem a Academia. Uma versão em RASCUNHO
 * (a próxima pesquisa, em revisão) nunca vaza para produção só por existir no
 * banco; alguém precisa publicá-la (`academiaInterruptor.ts`) primeiro.
 */

import type { PrismaClient, Prisma, EtapaComercial, SiteLeadStage, CategoriaDaAcademia } from "@prisma/client";

type Cliente = PrismaClient | Prisma.TransactionClient;

const SINGLETON_ID = "singleton";

/** Quantos itens entram no recorte quando quem chama não pede um número — um
 *  contexto de julgamento por mensagem, não a base inteira. */
export const LIMITE_PADRAO = 6;

/**
 * A etapa do funil (`SiteLeadStage`, granular, por lead) não é a etapa da
 * Academia (`EtapaComercial`, seis baldes largos, do MATERIAL de venda). Esta
 * é a única tradução entre as duas — exportada para não nascer uma segunda
 * versão dela em `contexto.ts` ou em teste.
 *
 * `GANHO`/`PERDIDO`/`NUTRICAO` caem em `GERAL`: não há "material de fechamento
 * pós-venda" nesta v1, e itens `GERAL` continuam valendo em qualquer estágio.
 */
export function etapaComercialDoStage(stage: SiteLeadStage | null | undefined): EtapaComercial {
  switch (stage) {
    case "NOVO":
    case "DISPONIVEL_PARA_PROSPECCAO":
    case "PRIMEIRO_CONTATO":
      return "PROSPECCAO";
    case "RESPONDEU":
    case "EM_QUALIFICACAO":
    case "QUALIFICADO":
      return "QUALIFICACAO";
    case "DEMO_AGENDADA":
    case "DEMO_REALIZADA":
      return "DEMONSTRACAO";
    case "PROPOSTA_ENVIADA":
    case "EM_NEGOCIACAO":
      return "FECHAMENTO";
    default:
      return "GERAL";
  }
}

export interface ParametrosDeRecuperacao {
  etapa: EtapaComercial;
  /**
   * Vocabulário comparado por IGUALDADE EXATA com `AcademiaComercialItem.tags`
   * (Postgres `hasSome`, não substring). O vocabulário real vem dos itens
   * `SINAL_DE_RISCO` da v1: `irritacao-leve`, `irritacao-forte`, `recusa`,
   * `opt-out`, `pressao-do-agente`, `objecao-repetida`, `desconto`, `alcada`.
   * `contexto.ts` já traduz `irritacaoDoLead`/`pediuParar` para este
   * vocabulário — ver `sinaisDaMemoria`, mais abaixo.
   */
  sinaisDetectados?: string[];
  /** Padrão `LIMITE_PADRAO`. Nunca a base inteira — ver o cabeçalho do arquivo. */
  limite?: number;
}

const SELECT_ITEM = {
  id: true,
  categoria: true,
  etapa: true,
  titulo: true,
  conteudo: true,
  ruim: true,
  corrigido: true,
} as const;

type ItemSelecionado = {
  id: string;
  categoria: CategoriaDaAcademia;
  etapa: EtapaComercial | null;
  titulo: string;
  conteudo: string;
  ruim: string | null;
  corrigido: string | null;
};

function formatarLinha(item: ItemSelecionado): string {
  switch (item.categoria) {
    case "REGRA_OBRIGATORIA":
      return `Regra obrigatória — ${item.titulo}: ${item.conteudo}`;
    case "COMPORTAMENTO_PROIBIDO":
      return `Proibido — ${item.titulo}: ${item.conteudo}`;
    case "EXEMPLO":
      return `Exemplo — ruim: "${item.ruim ?? ""}" | corrigido: "${item.corrigido ?? ""}" (${item.conteudo})`;
    case "SINAL_DE_RISCO":
      return `Sinal de risco (${item.titulo}): ${item.conteudo}`;
    case "CRITERIO_VEREDITO":
      return `Critério ${item.titulo}: ${item.conteudo}`;
    case "ORIENTACAO_DE_ETAPA":
      return `Orientação da etapa: ${item.conteudo}`;
  }
}

/**
 * O recorte pequeno de conhecimento da Academia para UMA revisão — nunca a
 * base inteira. Devolve `[]` sem versão publicada, sem lançar: a ausência de
 * Academia é o comportamento de hoje, não um erro.
 */
export async function recuperarConhecimentoRelevante(
  db: Cliente,
  params: ParametrosDeRecuperacao,
): Promise<string[]> {
  const limite = params.limite && params.limite > 0 ? params.limite : LIMITE_PADRAO;

  const config = await db.academiaComercialConfig.findUnique({
    where: { id: SINGLETON_ID },
    select: { versaoAtivaId: true },
  });
  if (!config?.versaoAtivaId) return [];

  const ondeEtapaOuGeral = { OR: [{ etapa: params.etapa }, { etapa: "GERAL" as const }, { etapa: null }] };
  const baseWhere = { versaoId: config.versaoAtivaId, ...ondeEtapaOuGeral };

  const selecionados: ItemSelecionado[] = [];

  // 1ª consulta: só os itens cujas tags casam com o sinal detectado agora —
  // esses vêm primeiro, porque são o que a conversa está pedindo NESTE turno.
  if (params.sinaisDetectados && params.sinaisDetectados.length > 0) {
    const prioritarios = await db.academiaComercialItem.findMany({
      where: { ...baseWhere, tags: { hasSome: params.sinaisDetectados } },
      orderBy: { criadoEm: "asc" },
      take: limite,
      select: SELECT_ITEM,
    });
    selecionados.push(...prioritarios);
  }

  // 2ª consulta: completa até `limite` com o resto do material da etapa —
  // já excluindo quem entrou na primeira, e já limitada no SQL, nunca em JS.
  if (selecionados.length < limite) {
    const restante = limite - selecionados.length;
    const complemento = await db.academiaComercialItem.findMany({
      where: { ...baseWhere, id: { notIn: selecionados.map((i) => i.id) } },
      orderBy: [{ categoria: "asc" }, { criadoEm: "asc" }],
      take: restante,
      select: SELECT_ITEM,
    });
    selecionados.push(...complemento);
  }

  return selecionados.map(formatarLinha);
}

/**
 * Traduz os sinais JÁ MEDIDOS pela memória (`ta/memoria.ts`, lidos por
 * `contexto.ts`) para o vocabulário de tags da Academia — a MESMA leitura que
 * `ContextoDaRevisao.irritacaoDoLead`/`pediuParar` já usa, nunca um segundo
 * detector. Exportada para `contexto.ts` chamar sem duplicar a régua aqui.
 */
export function sinaisDaMemoria(params: { irritacaoDoLead: number; pediuParar: boolean }): string[] {
  const sinais: string[] = [];
  if (params.irritacaoDoLead >= 3) sinais.push("irritacao-forte");
  else if (params.irritacaoDoLead >= 2) sinais.push("irritacao-leve");
  if (params.pediuParar) sinais.push("opt-out", "recusa");
  return sinais;
}
