/**
 * A LINHA DO TEMPO DA FICHA — o que aconteceu com este lead, fora das mensagens.
 *
 * ── O DEFEITO QUE ISTO FECHA ────────────────────────────────────────────────
 *
 * `SiteLeadInteraction` grava tudo desde a captura: entrou na base, andou no
 * funil, alguém assumiu, a IA pediu gente, a nota que o vendedor escreveu. Era
 * append-only, era completo — e **nenhuma tela da área comercial mostrava**. O
 * vendedor abria a ficha e via o estado de agora, sem uma linha do que veio
 * antes. Quem quisesse a história tinha de ir ao CRM antigo, em `/admin`.
 *
 * ── ⚠️ O QUE ESTA LINHA NÃO MOSTRA, E POR QUÊ ───────────────────────────────
 *
 * `MENSAGEM_ENVIADA` e `RESPOSTA_RECEBIDA` ficam de fora. A conversa está na
 * coluna ao lado, com o texto inteiro, o autor e o estado de entrega — repetir
 * aqui produziria um resumo pior do que a coisa resumida, e a ficha (que é
 * estreita) encheria de "Respondeu · Respondeu · Respondeu" empurrando para fora
 * da tela justamente os eventos que só existem aqui.
 *
 * A tela **diz** que faz isso. Uma lista que omite em silêncio ensina o vendedor
 * a concluir "não aconteceu nada" quando o certo é "está no outro painel".
 *
 * ── ⚠️ SOBRE `interna` ──────────────────────────────────────────────────────
 *
 * `interna: true` quer dizer **o lead nunca vê**, não "a equipe não vê". Esta
 * tela é interna do começo ao fim (`guardarSalaDeVendas` + `podeVerOLead`), e
 * esconder a nota interna de quem está atendendo mataria o único lugar onde o
 * time deixa recado sobre o cliente. O que a marca faz é avisar na tela, para
 * ninguém copiar e colar o texto numa mensagem de saída.
 */

import { ROTULO_INTERACAO, ROTULO_ETAPA } from "@/services/foocci-crm/foocciCrmFunnel";
import type { TipoDeInteracao, FoocciLeadStage } from "@/services/foocci-crm/foocciCrmFunnel";

/**
 * O que a coluna da conversa já mostra, inteiro e melhor.
 *
 * Exportado de propósito: a regra de omissão precisa ser lida e testada de fora,
 * e não morar escondida dentro de um `filter`.
 */
export const JA_APARECE_NA_CONVERSA: ReadonlySet<TipoDeInteracao> = new Set([
  "MENSAGEM_ENVIADA",
  "RESPOSTA_RECEBIDA",
]);

/**
 * Autores que não são pessoas. O `actor` da tabela é um campo livre: às vezes um
 * id de usuário, às vezes um rótulo de máquina — e o rótulo cru ("agente-sdr-ia")
 * não é o que se mostra a quem está vendendo.
 */
const AUTOR_DE_MAQUINA: Readonly<Record<string, string>> = {
  sistema: "sistema",
  admin: "equipe (CRM antigo)",
  "sdr-agent": "IA de vendas",
  "agente-sdr-ia": "IA de vendas",
  distribuicao: "distribuição automática",
};

export interface InteracaoBruta {
  id: string;
  tipo: TipoDeInteracao;
  fromStage: string | null;
  toStage: string | null;
  actor: string;
  nota: string | null;
  interna: boolean;
  createdAt: Date;
}

export interface EventoDaFicha {
  id: string;
  /** ISO — quem formata para o fuso de quem olha é a tela. */
  quando: string;
  tipo: TipoDeInteracao;
  /** Já em português, e nunca vazio. */
  titulo: string;
  nota: string | null;
  interna: boolean;
  autor: string;
}

/**
 * O título de uma linha.
 *
 * `MUDANCA_ETAPA` ganha tratamento próprio porque "Mudou de etapa" sozinho não
 * responde nada: o que importa é de onde para onde. `fromStage` nulo é o evento
 * de criação — o lead não veio de etapa nenhuma.
 *
 * ⚠️ O `??` no fim não é decoração defensiva. É o que impede que um tipo novo no
 * enum do Prisma, sem rótulo aqui, vire linha em branco na tela — que foi
 * exatamente o defeito de 07/09/2026 no CRM antigo. Aparecer feio é aceitável;
 * desaparecer não é.
 */
export function tituloDoEvento(i: Pick<InteracaoBruta, "tipo" | "fromStage" | "toStage">): string {
  const base = ROTULO_INTERACAO[i.tipo] ?? i.tipo;

  if (i.tipo !== "MUDANCA_ETAPA" || !i.toStage) return base;

  const para = ROTULO_ETAPA[i.toStage as FoocciLeadStage] ?? i.toStage;
  if (!i.fromStage) return `Entrou como "${para}"`;

  const de = ROTULO_ETAPA[i.fromStage as FoocciLeadStage] ?? i.fromStage;
  return `${de} → ${para}`;
}

/**
 * Quem fez.
 *
 * ⛔ Um `actor` que não é rótulo de máquina e não bate com ninguém em
 * `InternalUser` é devolvido CRU. A tentação é trocar por "equipe" e deixar a
 * tela bonita — e isso apagaria a única pista de quem agiu. Id feio é rastro;
 * "equipe" é um fato inventado.
 */
export function nomeDoAutor(actor: string, nomes: ReadonlyMap<string, string>): string {
  return AUTOR_DE_MAQUINA[actor] ?? nomes.get(actor) ?? actor;
}

/**
 * A parte pura: filtra, ordena e traduz. Sem banco, para poder ser medida.
 *
 * Ordem: **mais recente primeiro**. A ficha é estreita e mostra poucas linhas —
 * o que o vendedor precisa ao abrir é o que acabou de acontecer, não a captura
 * de três meses atrás.
 */
export function montarLinhaDoTempo(
  brutos: readonly InteracaoBruta[],
  nomes: ReadonlyMap<string, string> = new Map(),
): EventoDaFicha[] {
  return brutos
    .filter((i) => !JA_APARECE_NA_CONVERSA.has(i.tipo))
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((i) => ({
      id: i.id,
      quando: i.createdAt.toISOString(),
      tipo: i.tipo,
      titulo: tituloDoEvento(i),
      nota: i.nota?.trim() || null,
      interna: i.interna,
      autor: nomeDoAutor(i.actor, nomes),
    }));
}

/** O mínimo de banco que esta leitura precisa — o resto do Prisma não entra. */
interface BancoDaLinha {
  siteLeadInteraction: {
    findMany(args: unknown): Promise<InteracaoBruta[]>;
  };
  internalUser: {
    findMany(args: unknown): Promise<Array<{ id: string; nome: string | null }>>;
  };
}

/** Teto de linhas. A ficha não é auditoria: o histórico inteiro vive em /admin. */
export const LIMITE_PADRAO = 30;

/**
 * Lê e monta.
 *
 * ⚠️ **O alcance é do chamador.** `SiteLeadInteraction` não está sob RLS (só as
 * tabelas `lead_*` estão), então esta função não protege nada sozinha: quem
 * chama já passou por `podeVerOLead`. Está escrito aqui para ninguém usá-la numa
 * rota nova achando que ela filtra por quem pergunta — ela não filtra.
 */
export async function lerLinhaDoTempo(
  db: BancoDaLinha,
  params: { leadId: string; limite?: number },
): Promise<EventoDaFicha[]> {
  const limite = Math.min(Math.max(params.limite ?? LIMITE_PADRAO, 1), 100);

  // Busca com folga: o filtro de mensagens acontece DEPOIS, e um lead que só
  // trocou mensagens devolveria uma lista vazia se o corte fosse no banco.
  const brutos = await db.siteLeadInteraction.findMany({
    where: { leadId: params.leadId },
    orderBy: { createdAt: "desc" },
    take: limite * 3,
    select: {
      id: true, tipo: true, fromStage: true, toStage: true,
      actor: true, nota: true, interna: true, createdAt: true,
    },
  });

  const aResolver = [
    ...new Set(brutos.map((i) => i.actor).filter((a) => !AUTOR_DE_MAQUINA[a])),
  ];

  const pessoas = aResolver.length
    ? await db.internalUser.findMany({
        where: { id: { in: aResolver } },
        select: { id: true, nome: true },
      })
    : [];

  const nomes = new Map(
    pessoas.filter((p): p is { id: string; nome: string } => !!p.nome).map((p) => [p.id, p.nome]),
  );

  return montarLinhaDoTempo(brutos, nomes).slice(0, limite);
}
