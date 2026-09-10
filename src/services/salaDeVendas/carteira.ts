/**
 * A CARTEIRA — todos os leads numa tabela só, com o estado de cada um.
 *
 * ── O BURACO QUE ELA TAPA ───────────────────────────────────────────────────
 *
 * A Sala tinha filas (recortes por pergunta: "o que é meu?", "o que está
 * largado?") e tinha a ficha (um lead por vez). **Não tinha a lista inteira.**
 *
 * O efeito aparece no dia seguinte à primeira abordagem: um lead que recebeu
 * mensagem, não respondeu, não tem próxima ação e não foi marcado como perdido
 * **não aparece em fila nenhuma**. Ele não é meu, não está largado, não está
 * aguardando humano. Some — e some justamente quem custou uma abordagem.
 *
 * Ordem do Diretor Geral, 10/09/2026: *"nenhum lead pode desaparecer depois da
 * primeira mensagem."* O estado `semDesfecho` deste arquivo é essa fila.
 *
 * ── ⚠️ O QUE ELA NÃO É ──────────────────────────────────────────────────────
 *
 * Não é um CRM novo. Não cria tabela, não duplica regra, não decide nada: lê o
 * que já existe (`SiteLead` + `LeadMensagem`) e organiza. Toda decisão continua
 * onde estava — funil, portão, freio.
 */

import type { PrismaClient, Prisma } from "@prisma/client";

type Cliente = PrismaClient | Prisma.TransactionClient;

/**
 * Os estados que a operação pergunta, e que nenhuma fila respondia.
 *
 * `semDesfecho` é o motivo deste arquivo existir: abordado, sem resposta, sem
 * próxima ação e sem fim. É a fila do lead que sumiria.
 */
export type EstadoDaCarteira =
  | "todos"
  | "semDesfecho"
  | "followUpVencido"
  | "nuncaAbordado"
  | "aguardandoResposta"
  | "ganhos"
  | "perdidos"
  | "silenciados";

export interface FiltroDaCarteira {
  busca?: string | null;
  stage?: string | null;
  temperatura?: string | null;
  responsavel?: string | null;
  origem?: string | null;
  estado?: EstadoDaCarteira | null;
  limite?: number;
}

export interface LinhaDaCarteira {
  id: string;
  nome: string;
  restaurante: string | null;
  cidade: string | null;
  whatsapp: string;
  stage: string;
  temperatura: string | null;
  score: number | null;
  atendidoPor: string;
  atendenteNome: string | null;
  origem: string | null;
  criadoEm: string;
  /** Quando a Foocci falou pela última vez. `null` = nunca foi abordado. */
  ultimoContatoEm: string | null;
  /** Quando ELE falou pela última vez. `null` = nunca respondeu. */
  ultimaRespostaEm: string | null;
  /** Estado da última mensagem que saiu: PENDENTE, ENVIADA, ENTREGUE, LIDA, FALHOU. */
  estadoDaUltimaSaida: string | null;
  tentativas: number;
  proximaAcaoEm: string | null;
  proximaAcaoNota: string | null;
  followUpVencido: boolean;
  silenciado: boolean;
  motivoDaPerda: string | null;
}

/** Um dia. O follow-up vence quando a data prometida já passou. */
function venceu(quando: Date | null, agora: Date): boolean {
  return quando !== null && quando.getTime() <= agora.getTime();
}

/**
 * ⭐ O ESTADO DE UM LEAD — puro, e é a regra que a tela mostra.
 *
 * Puro de propósito: é a única parte desta carteira que DECIDE alguma coisa, e
 * decisão que mora dentro de uma consulta não se testa caso a caso.
 *
 * A ordem das perguntas é a regra:
 *
 *   1. **silenciado** ganha de tudo — quem pediu para parar não entra em fila
 *      de trabalho nenhuma, nem como pendência;
 *   2. **ganho/perdido** são desfechos: já acabaram;
 *   3. **nunca abordado** é trabalho que não começou;
 *   4. **follow-up vencido** é promessa não cumprida — mais urgente que espera;
 *   5. **aguardando resposta** é espera legítima, com prazo marcado;
 *   6. **sem desfecho** é o que sobra: abordado, sem resposta, sem próxima ação
 *      e sem fim. É o lead que sumia.
 */
export function estadoDoLead(
  l: {
    optOutAt: Date | null;
    stage: string;
    lastContactedAt: Date | null;
    ultimaRespostaEm: Date | null;
    proximaAcaoEm: Date | null;
  },
  agora: Date,
): Exclude<EstadoDaCarteira, "todos"> {
  if (l.optOutAt) return "silenciados";
  if (l.stage === "GANHO") return "ganhos";
  if (l.stage === "PERDIDO") return "perdidos";
  if (!l.lastContactedAt) return "nuncaAbordado";
  if (venceu(l.proximaAcaoEm, agora)) return "followUpVencido";
  if (l.proximaAcaoEm) return "aguardandoResposta";
  if (l.ultimaRespostaEm) return "aguardandoResposta";
  return "semDesfecho";
}

/** A busca casa nome, restaurante, cidade e telefone — em qualquer ordem. */
function recorteDaBusca(busca: string): Prisma.SiteLeadWhereInput {
  const t = busca.trim();
  const digitos = t.replace(/\D/g, "");
  const ou: Prisma.SiteLeadWhereInput[] = [
    { nome: { contains: t, mode: "insensitive" } },
    { restaurante: { contains: t, mode: "insensitive" } },
    { cidade: { contains: t, mode: "insensitive" } },
  ];
  // Telefone só entra quando o termo tem dígitos suficientes: com dois ou três
  // números, `contains` casaria com metade da base e a busca pareceria quebrada.
  if (digitos.length >= 4) ou.push({ whatsappDigits: { contains: digitos } });
  return { OR: ou };
}

/**
 * Monta a carteira.
 *
 * `escopo` é o recorte que a sessão pode enxergar — vem de `escopoDaConsulta`,
 * o MESMO das filas. Repetir a regra de alcance aqui criaria uma segunda
 * resposta para "o que este usuário pode ver", e as duas divergiriam.
 */
export async function montarCarteira(
  db: Cliente,
  params: { escopo: Prisma.SiteLeadWhereInput; filtro: FiltroDaCarteira; agora?: Date },
): Promise<{ linhas: LinhaDaCarteira[]; total: number }> {
  const agora = params.agora ?? new Date();
  const f = params.filtro;
  const limite = Math.min(Math.max(f.limite ?? 200, 1), 500);

  const where: Prisma.SiteLeadWhereInput = {
    AND: [
      params.escopo,
      f.busca?.trim() ? recorteDaBusca(f.busca) : {},
      f.stage ? { stage: f.stage as never } : {},
      f.temperatura ? { temperatura: f.temperatura as never } : {},
      f.responsavel ? { atendenteUserId: f.responsavel } : {},
      f.origem ? { fonte: f.origem as never } : {},
    ],
  };

  const [total, leads] = await Promise.all([
    db.siteLead.count({ where }),
    db.siteLead.findMany({
      where,
      orderBy: [{ lastContactedAt: "desc" }, { createdAt: "desc" }],
      take: limite,
      select: {
        id: true, nome: true, restaurante: true, cidade: true, whatsapp: true,
        stage: true, temperatura: true, score: true,
        atendidoPor: true, atendenteUserId: true,
        fonte: true, utmSource: true,
        createdAt: true, lastContactedAt: true, optOutAt: true,
        proximaAcaoEm: true, proximaAcaoNota: true,
        atendente: { select: { nome: true } },
        motivoPerda: { select: { rotulo: true } },
      },
    }),
  ]);

  if (leads.length === 0) return { linhas: [], total };

  const ids = leads.map((l) => l.id);

  // ⚠️ Duas agregações e uma varredura, e não uma consulta por lead: com 200
  // linhas na tela, "uma consulta por lead" são 600 idas ao banco a cada
  // abertura. O `groupBy` faz o mesmo trabalho em uma.
  const [saidas, ultimas] = await Promise.all([
    db.leadMensagem.groupBy({
      by: ["leadId"],
      where: { leadId: { in: ids }, direcao: "SAIDA" },
      _count: { _all: true },
    }),
    db.leadMensagem.findMany({
      where: { leadId: { in: ids } },
      orderBy: { ocorreuEm: "desc" },
      select: { leadId: true, direcao: true, status: true, ocorreuEm: true },
    }),
  ]);

  const tentativasPor = new Map(saidas.map((s) => [s.leadId, s._count._all]));

  // A primeira que aparece é a mais recente (a consulta já vem ordenada).
  const ultimaSaida = new Map<string, { status: string; ocorreuEm: Date }>();
  const ultimaEntrada = new Map<string, Date>();
  for (const m of ultimas) {
    if (m.direcao === "SAIDA") {
      if (!ultimaSaida.has(m.leadId)) ultimaSaida.set(m.leadId, { status: m.status, ocorreuEm: m.ocorreuEm });
    } else if (!ultimaEntrada.has(m.leadId)) {
      ultimaEntrada.set(m.leadId, m.ocorreuEm);
    }
  }

  const linhas = leads.map((l) => {
    const respondeuEm = ultimaEntrada.get(l.id) ?? null;
    const estado = estadoDoLead(
      {
        optOutAt: l.optOutAt,
        stage: l.stage,
        lastContactedAt: l.lastContactedAt,
        ultimaRespostaEm: respondeuEm,
        proximaAcaoEm: l.proximaAcaoEm,
      },
      agora,
    );

    return {
      linha: {
        id: l.id,
        nome: l.nome,
        restaurante: l.restaurante,
        cidade: l.cidade,
        whatsapp: l.whatsapp,
        stage: l.stage,
        temperatura: l.temperatura,
        score: l.score,
        atendidoPor: l.atendidoPor,
        atendenteNome: l.atendente?.nome ?? null,
        origem: l.fonte ?? l.utmSource ?? null,
        criadoEm: l.createdAt.toISOString(),
        ultimoContatoEm: l.lastContactedAt?.toISOString() ?? null,
        ultimaRespostaEm: respondeuEm?.toISOString() ?? null,
        estadoDaUltimaSaida: ultimaSaida.get(l.id)?.status ?? null,
        tentativas: tentativasPor.get(l.id) ?? 0,
        proximaAcaoEm: l.proximaAcaoEm?.toISOString() ?? null,
        proximaAcaoNota: l.proximaAcaoNota,
        followUpVencido: estado === "followUpVencido",
        silenciado: Boolean(l.optOutAt),
        motivoDaPerda: l.motivoPerda?.rotulo ?? null,
      } satisfies LinhaDaCarteira,
      estado,
    };
  });

  // ⚠️ O filtro de ESTADO é aplicado depois, e não no `where`: ele depende da
  // última mensagem, que não está na tabela do lead. Filtrar no banco exigiria
  // uma subconsulta por lead — e o teto de 500 linhas mantém isso barato.
  const alvo = f.estado && f.estado !== "todos" ? f.estado : null;
  const filtradas = alvo ? linhas.filter((x) => x.estado === alvo) : linhas;

  return { linhas: filtradas.map((x) => x.linha), total: alvo ? filtradas.length : total };
}
