/**
 * O FUNIL POR MODELO — quantos saíram, entregaram, foram lidos, responderam,
 * e quantos deram opt-out, agrupados por template. Redesenho da prospecção
 * automática e minimalista, 12/09/2026 (item 3 do pedido do CEO: métricas por
 * modelo, para a Sala saber qual template está funcionando).
 *
 * ── DE ONDE VÊM OS NÚMEROS, E POR QUE NÃO É UMA SEGUNDA FONTE DE VERDADE ────
 *
 * Tudo sai de `LeadMensagem` (agrupado por `templateNome`, persistido desde o
 * #246) e de `SiteLead` (`optOutAt`, `stage`). Nenhum contador novo, nenhuma
 * tabela nova: este arquivo LÊ o que a conversa e o CRM já gravam — a mesma
 * régua do cabeçalho de `selecao.ts` ("nenhuma segunda opinião sobre o mesmo
 * fato").
 *
 * ── "RESPOSTA POSITIVA" — A DECISÃO DE DESIGN QUE A PARTE 2 PRECISA SABER ───
 *
 * Não existe hoje um campo "sentimento" ou "resposta positiva" gravado em
 * lugar nenhum (procurado em `LeadMensagem`, `conversa.ts`, `matrizDeVerdade.ts`
 * e `abordar.ts` antes de escrever isto). O que existe, e é o sinal mais
 * próximo, é `SiteLead.stage` (`SiteLeadStage`) — a esteira de qualificação
 * que a Sala já usa para todo lead, de prospecção ou não. Este arquivo lê
 * "respondeu" como "tem pelo menos uma `LeadMensagem` de ENTRADA" (o fato
 * mais bruto: a pessoa escreveu de volta) e "resposta positiva" como "o
 * `stage` avançou para além de `RESPONDEU`" (`EM_QUALIFICACAO` em diante,
 * exceto `PERDIDO`) — ou seja, respondeu E a conversa seguiu para
 * qualificação. Se um dia nascer um campo de sentimento dedicado, é ELE que
 * estas duas contagens devem passar a ler — não um segundo cálculo aqui.
 */

import type { PrismaClient, Prisma } from "@prisma/client";

type Cliente = PrismaClient | Prisma.TransactionClient;

/**
 * Os `stage` que representam "respondeu, e a conversa avançou" — ver o
 * comentário grande do arquivo. `RESPONDEU` sozinho não entra: ele já é
 * contado em `respondidos`, e contar os dois juntos inflaria "positiva" com
 * quem só respondeu "quem é vc" e nunca mais escreveu.
 */
const ESTAGIOS_DE_RESPOSTA_POSITIVA = [
  "EM_QUALIFICACAO",
  "QUALIFICADO",
  "DEMO_AGENDADA",
  "DEMO_REALIZADA",
  "PROPOSTA_ENVIADA",
  "EM_NEGOCIACAO",
  "GANHO",
] as const;

/** Os status de `LeadMensagem` que provam entrega/leitura de verdade — nunca `PENDENTE`, que é só "aceita por nós". */
const STATUS_ENTREGUE = ["ENTREGUE", "LIDA"] as const;
const STATUS_ENVIADO = ["ENVIADA", "ENTREGUE", "LIDA"] as const;

export interface FunilDoModelo {
  templateNome: string;
  /** Tentativas de envio deste template — inclui as que falharam. */
  tentativas: number;
  enviados: number;
  entregues: number;
  lidos: number;
  falharam: number;
  /** Leads distintos abordados com este template que escreveram de volta ao menos uma vez. */
  respondidos: number;
  /** Subconjunto de `respondidos` cujo `stage` avançou para qualificação (ver o cabeçalho). */
  comRespostaPositiva: number;
  /** Leads distintos abordados com este template que hoje têm `optOutAt` preenchido. */
  optOut: number;
}

/**
 * ⭐ O FUNIL, AGRUPADO POR MODELO.
 *
 * Duas consultas: uma para os status de envio (agregável por `groupBy`), e
 * uma leitura dos leads distintos por modelo — para `respondidos`,
 * `comRespostaPositiva` e `optOut`, que dependem de outra tabela
 * (`LeadMensagem` de ENTRADA) e de `SiteLead`, e não são uma simples contagem
 * por `status`.
 */
export async function funilPorModelo(db: Cliente): Promise<FunilDoModelo[]> {
  const porStatus = await db.leadMensagem.groupBy({
    by: ["templateNome", "status"],
    where: { direcao: "SAIDA", tipo: "TEMPLATE", templateNome: { not: null } },
    _count: { _all: true },
  });

  const nomes = [...new Set(porStatus.map((l) => l.templateNome).filter((v): v is string => !!v))];
  if (nomes.length === 0) return [];

  // `leadId` por modelo — uma linha por (templateNome, leadId), não por
  // mensagem: um lead pode ter recebido o mesmo template mais de uma vez (o
  // retentativa reenvia), e contar duas vezes o MESMO lead infla "respondidos".
  const envios = await db.leadMensagem.findMany({
    where: { direcao: "SAIDA", tipo: "TEMPLATE", templateNome: { in: nomes } },
    select: { templateNome: true, leadId: true },
  });

  const leadIdsPorModelo = new Map<string, Set<string>>();
  for (const e of envios) {
    if (!e.templateNome) continue;
    const conjunto = leadIdsPorModelo.get(e.templateNome) ?? new Set<string>();
    conjunto.add(e.leadId);
    leadIdsPorModelo.set(e.templateNome, conjunto);
  }

  const todosOsLeadIds = [...new Set(envios.map((e) => e.leadId))];

  const [leads, entradas] = await Promise.all([
    db.siteLead.findMany({
      where: { id: { in: todosOsLeadIds } },
      select: { id: true, optOutAt: true, stage: true },
    }),
    db.leadMensagem.findMany({
      where: { direcao: "ENTRADA", leadId: { in: todosOsLeadIds } },
      select: { leadId: true },
    }),
  ]);

  const leadPorId = new Map(leads.map((l) => [l.id, l]));
  const responderam = new Set(entradas.map((e) => e.leadId));

  const contagemPorStatus = new Map<string, Map<string, number>>();
  for (const linha of porStatus) {
    if (!linha.templateNome) continue;
    const mapa = contagemPorStatus.get(linha.templateNome) ?? new Map<string, number>();
    mapa.set(linha.status, linha._count._all);
    contagemPorStatus.set(linha.templateNome, mapa);
  }

  return nomes.map((templateNome): FunilDoModelo => {
    const statusDoModelo = contagemPorStatus.get(templateNome) ?? new Map<string, number>();
    const somaStatus = (status: readonly string[]) =>
      status.reduce((n, s) => n + (statusDoModelo.get(s) ?? 0), 0);

    const leadIds = [...(leadIdsPorModelo.get(templateNome) ?? new Set<string>())];

    let respondidos = 0;
    let comRespostaPositiva = 0;
    let optOut = 0;
    for (const leadId of leadIds) {
      const lead = leadPorId.get(leadId);
      if (lead?.optOutAt) optOut += 1;
      if (responderam.has(leadId)) {
        respondidos += 1;
        if (lead && (ESTAGIOS_DE_RESPOSTA_POSITIVA as readonly string[]).includes(lead.stage)) {
          comRespostaPositiva += 1;
        }
      }
    }

    return {
      templateNome,
      tentativas: somaStatus(["PENDENTE", ...STATUS_ENVIADO, "FALHOU"]),
      enviados: somaStatus(STATUS_ENVIADO),
      entregues: somaStatus(STATUS_ENTREGUE),
      lidos: statusDoModelo.get("LIDA") ?? 0,
      falharam: statusDoModelo.get("FALHOU") ?? 0,
      respondidos,
      comRespostaPositiva,
      optOut,
    };
  });
}
