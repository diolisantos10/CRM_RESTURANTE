/**
 * AS FILAS DA SALA DE VENDAS.
 *
 * Cada fila responde a uma pergunta que o SDR faz de verdade durante o dia. Não
 * são filtros bonitos: são as sete perguntas do documento 03.
 *
 * ── A FILA MAIS IMPORTANTE É "AGUARDANDO HUMANO" ──
 *
 * Um lead que a IA devolveu e que ninguém pegou é uma venda em queda livre — e
 * ele é **invisível** em qualquer lista organizada por etapa do funil, porque
 * continua em CONTATADO ou QUALIFICADO como qualquer outro. Sem esta fila, o
 * defeito só aparece quando o lead some.
 *
 * ── ONDE O ESCOPO DO SDR É APLICADO ──
 *
 * No `where` da consulta, não na tela e não só na rota.
 *
 * A rota protege o endereço; a consulta protege o dado. Basta um parâmetro
 * esquecido para a consulta devolver a base inteira e a tela mostrar tudo — que
 * é o defeito clássico de RBAC que só vive na porta. Aqui o filtro é montado por
 * `escopoDaConsulta`, que recebe a sessão e não aceita ser chamado sem ela.
 */

import type {
  Prisma,
  PrismaClient,
  LeadAtendidoPor,
  SiteLeadStage,
  LeadTemperatura,
} from "@prisma/client";
import type { SessaoInterna } from "@/lib/internal-auth";
import { enxergaTudo } from "@/lib/internal-auth";

type Cliente = PrismaClient | Prisma.TransactionClient;

export type NomeDaFila =
  | "aguardandoQualificacao"
  | "qualificados"
  | "semResponsavel"
  | "meusLeads"
  | "comIA"
  | "aguardandoHumano"
  | "semResposta"
  | "followUpVencido"
  | "todos";

export interface Fila {
  nome: NomeDaFila;
  titulo: string;
  /** A pergunta que a fila responde. Aparece na tela. */
  pergunta: string;
}

export const FILAS: readonly Fila[] = [
  // ── As duas filas do desenho do CEO ────────────────────────────────────────
  //
  // Ele descreveu a estrutura em 27/08/2026: *"basicamente a gente precisa de
  // uma fila de leads... o primeiro agente vai ser o agente que vai sondá-lo,
  // que é o qualificador... frio, morno, quente... Aí a gente passa pro closer.
  // (...) São duas listas."*
  //
  // ⚠️ Elas não substituem as de baixo — respondem a outra pergunta. As antigas
  // organizam por **quem atende** ("o que é meu?", "o que está largado?"); estas
  // duas organizam por **em que ponto do funil o lead está**. Um mesmo lead
  // aparece nas duas visões, e é isso mesmo.
  {
    nome: "aguardandoQualificacao",
    titulo: "Aguardando qualificação",
    pergunta: "quem chegou e ainda ninguém mediu?",
  },
  {
    nome: "qualificados",
    titulo: "Qualificados",
    pergunta: "quem já foi medido e está pronto pro fechamento?",
  },
  {
    nome: "aguardandoHumano",
    titulo: "Aguardando humano",
    pergunta: "o que a IA parou e me espera?",
  },
  { nome: "semResponsavel", titulo: "Sem responsável", pergunta: "o que está largado?" },
  { nome: "meusLeads", titulo: "Meus leads", pergunta: "o que é meu?" },
  { nome: "comIA", titulo: "Atendidos pela IA", pergunta: "o que está andando sozinho?" },
  { nome: "semResposta", titulo: "Sem resposta", pergunta: "quem eu falei e não voltou?" },
  {
    nome: "followUpVencido",
    titulo: "Follow-ups vencidos",
    pergunta: "o que eu prometi e não fiz?",
  },
  { nome: "todos", titulo: "Todos", pergunta: "a base inteira do meu escopo" },
] as const;

/**
 * O recorte que a sessão pode enxergar.
 *
 * Quem enxerga a empresa inteira recebe `{}` — sem filtro. O agente humano
 * recebe um filtro que o prende aos leads DELE mais os que estão livres para
 * pegar. Nunca à base inteira.
 *
 * ── POR QUE O SDR VÊ OS LEADS LIVRES ──
 *
 * Sem isso ele veria só o que já é dele, e as filas "sem responsável" e
 * "aguardando humano" viriam sempre vazias — as duas filas que existem
 * justamente para ele pegar trabalho. O isolamento é contra ver a carteira dos
 * OUTROS, não contra ver o que está disponível.
 */
export function escopoDaConsulta(sessao: SessaoInterna): Prisma.SiteLeadWhereInput {
  if (enxergaTudo(sessao)) return {};

  // O Agente Gerente Comercial administra Vendas e enxerga o departamento
  // inteiro — é ele quem distribui a fila e responde pelo SLA.
  if (sessao.gerencia.includes("vendas")) return {};

  return {
    OR: [
      { atendenteUserId: sessao.userId },
      { atendidoPor: { in: ["NINGUEM", "AGUARDANDO_HUMANO"] } },
    ],
  };
}

/** Dias sem resposta que fazem um lead cair na fila "sem resposta". */
const DIAS_SEM_RESPOSTA = 3;

/**
 * O filtro de uma fila, já combinado com o escopo da sessão.
 *
 * O `AND` é deliberado: fila e escopo se somam, nunca se substituem. Um `OR`
 * aqui deixaria a fila furar o isolamento — e é o tipo de erro que passa
 * despercebido porque a tela continua parecendo certa.
 */
export function filtroDaFila(
  fila: NomeDaFila,
  sessao: SessaoInterna,
  agora: Date,
): Prisma.SiteLeadWhereInput {
  const escopo = escopoDaConsulta(sessao);
  const limite = new Date(agora.getTime() - DIAS_SEM_RESPOSTA * 86_400_000);

  const daFila: Prisma.SiteLeadWhereInput = (() => {
    switch (fila) {
      case "aguardandoQualificacao":
        // `temperatura: null` é literalmente "ninguém mediu" — e é diferente de
        // FRIO, que é "medido e não esquentou". Escrever FRIO por omissão
        // esconderia esta fila inteira, que é justamente a do qualificador.
        //
        // O funil aberto entra junto: cobrar qualificação de um lead GANHO ou
        // PERDIDO é mandar o agente falar com quem já acabou.
        return {
          temperatura: null,
          stage: { notIn: ["GANHO", "PERDIDO"] },
        };
      case "qualificados":
        // A fila do closer. DESQUALIFICADO fica de fora por definição — foi
        // medido e não é público. NUTRICAO também: é espera deliberada, e um
        // closer agressivo em cima de quem a gente mesmo mandou esperar é o
        // caminho mais curto para perder o contato.
        //
        // ⚠️ FRIO entra. Ele é lead medido e continua sendo trabalho de alguém;
        // o que muda é a POSIÇÃO dele na lista, não a existência.
        return {
          temperatura: { in: ["PRIORIDADE_MAXIMA", "QUENTE", "MORNO", "FRIO"] },
          stage: { notIn: ["GANHO", "PERDIDO"] },
        };
      case "aguardandoHumano":
        return { atendidoPor: "AGUARDANDO_HUMANO" };
      case "semResponsavel":
        return { atendidoPor: "NINGUEM" };
      case "meusLeads":
        return { atendenteUserId: sessao.userId, atendidoPor: "HUMANO" };
      case "comIA":
        return { atendidoPor: "IA" };
      case "semResposta":
        // Falamos e a pessoa não voltou: existe contato de saída, e o último
        // movimento de qualquer tipo é o próprio contato — ou seja, nada
        // aconteceu depois. E o funil ainda está aberto.
        return {
          lastContactedAt: { not: null, lt: limite },
          // "Funil ainda aberto" = não terminou. As três terminais entram aqui:
          // GANHO e PERDIDO encerraram, e NUTRICAO é espera deliberada — cobrar
          // silêncio de quem a gente mesmo mandou esperar seria ruído.
          stage: { notIn: ["GANHO", "PERDIDO", "NUTRICAO"] },
        };
      case "followUpVencido":
        // Prometido e não cumprido: alguém pediu gente há mais de um dia e o
        // lead continua esperando.
        return {
          atendidoPor: "AGUARDANDO_HUMANO",
          atendenteDesde: { lt: new Date(agora.getTime() - 86_400_000) },
        };
      case "todos":
      default:
        return {};
    }
  })();

  return { AND: [escopo, daFila] };
}

export interface LeadNaFila {
  id: string;
  nome: string;
  restaurante: string | null;
  cidade: string | null;
  stage: SiteLeadStage;
  atendidoPor: LeadAtendidoPor;
  atendenteUserId: string | null;
  atendenteNome: string | null;
  motivoDoPedido: string | null;
  atendenteDesde: Date | null;
  origem: { utmSource: string | null; utmCampaign: string | null };
  lastContactedAt: Date | null;
  createdAt: Date;

  /**
   * A leitura da qualificação. `null` = ninguém mediu — e a tela escreve isso,
   * não "frio".
   *
   * ⚠️ Sai daqui porque a fila `qualificados` é **ordenada por ela**. Uma lista
   * ordenada por um critério que não aparece na tela é a pior espécie de
   * armadilha: o operador vê uma ordem que não explica, conclui que está
   * aleatória, e passa a ignorar o topo — que é exatamente o que a ordenação
   * existia para destacar.
   */
  temperatura: LeadTemperatura | null;
  /** O número por trás da leitura. `null` quando não há sinal nenhum. */
  score: number | null;
}

export interface ResultadoDaFila {
  leituraOk: boolean;
  motivo?: string;
  leads: LeadNaFila[];
  /** Quantos leads existem em cada fila, dentro do escopo da sessão. */
  contagens: Record<NomeDaFila, number>;
}

const VAZIO: Record<NomeDaFila, number> = {
  aguardandoQualificacao: 0,
  qualificados: 0,
  semResponsavel: 0,
  meusLeads: 0,
  comIA: 0,
  aguardandoHumano: 0,
  semResposta: 0,
  followUpVencido: 0,
  todos: 0,
};

/**
 * Em que ordem cada fila chega na tela.
 *
 * ── POR QUE ISTO NÃO É DETALHE ──────────────────────────────────────────────
 *
 * Ninguém trabalha uma lista inteira. Trabalha-se o topo. A ordenação é, na
 * prática, **a decisão de quem é atendido hoje e quem espera** — e ela estava
 * fixa para todas as filas, o que fazia a lista do closer chegar ordenada por
 * data de criação, ignorando a temperatura que acabou de ser calculada.
 *
 * ── ⚠️ O RISCO QUE FICA DE PÉ, E ELE TEM NOME ───────────────────────────────
 *
 * Na fila `qualificados`, temperatura vem primeiro. Se um dia entrar QUENTE em
 * volume maior do que o time consegue atender, **o MORNO nunca sobe** — fica
 * eternamente abaixo, visível e nunca trabalhado. A segunda chave (quem espera
 * há mais tempo) alivia dentro da faixa, e não entre faixas.
 *
 * Isso não é bug para consertar agora: é **política comercial**, e política é
 * decisão do CEO, não escolha silenciosa de quem escreve a consulta. Quando o
 * volume chegar lá, as saídas são fila separada para MORNO ou envelhecimento
 * que promove de faixa. Fica escrito aqui para a hora ser reconhecida.
 */
/**
 * ⭐ A ORDEM DE CADA FILA. **Exportada porque ela é uma regra de negócio**, e
 * regra de negócio sem teste volta no primeiro rebase distraído — esta já
 * enterrou um lead de 21 dias no fim da lista que existia para achá-lo.
 */
export function ordenacaoDaFila(fila: NomeDaFila): Prisma.SiteLeadOrderByWithRelationInput[] {
  switch (fila) {
    case "qualificados":
      // A ordem do enum `LeadTemperatura` no schema é PRIORIDADE_MAXIMA,
      // QUENTE, MORNO, FRIO — então `asc` é "mais quente primeiro". Depende da
      // ordem de declaração do enum: mexer nela reordena esta fila.
      return [{ temperatura: "asc" }, { scoreAt: "asc" }];
    case "aguardandoQualificacao":
      // Quem chegou primeiro e ninguém mediu. Aqui o custo é o tempo parado, e
      // não existe "mais importante" — ninguém sabe nada sobre nenhum deles.
      return [{ createdAt: "asc" }];
    case "semResponsavel":
      // ⭐ "O que está largado?" — e a resposta certa é o MAIS LARGADO primeiro.
      //
      // Até 07/09/2026 esta fila caía no `default`, que ordena por
      // `atendenteDesde` e desempata com `createdAt: "desc"`. Ninguém aqui tem
      // atendente, então o desempate virava a ordem inteira: **o mais novo no
      // topo e o mais abandonado no fim.**
      //
      // Medido em 06/09/2026: o lead mais velho da base esperava 21 dias, tinha
      // vindo da página de PREÇOS, e estava no fundo da lista que existe
      // justamente para encontrá-lo.
      return [{ createdAt: "asc" }];
    default:
      // ⚠️ O desempate é `asc`, e não `desc`. Entre dois leads igualmente
      // parados, quem espera há mais tempo vem primeiro — em toda fila.
      // Ordenar pelo mais recente é confortável para quem opera (o assunto está
      // fresco) e é exatamente como um lead antigo nunca mais é tocado.
      return [{ atendenteDesde: "asc" }, { createdAt: "asc" }];
  }
}

export async function listarFila(
  db: Cliente,
  params: { fila: NomeDaFila; sessao: SessaoInterna; agora?: Date; limite?: number },
): Promise<ResultadoDaFila> {
  const agora = params.agora ?? new Date();

  try {
    const [linhas, ...contados] = await Promise.all([
      db.siteLead.findMany({
        where: filtroDaFila(params.fila, params.sessao, agora),
        orderBy: ordenacaoDaFila(params.fila),
        take: params.limite ?? 100,
        include: { atendente: { select: { nome: true } } },
      }),
      ...FILAS.map((f) =>
        db.siteLead.count({ where: filtroDaFila(f.nome, params.sessao, agora) }),
      ),
    ]);

    const contagens = { ...VAZIO };
    FILAS.forEach((f, i) => {
      contagens[f.nome] = contados[i] ?? 0;
    });

    return {
      leituraOk: true,
      contagens,
      leads: linhas.map((l) => ({
        id: l.id,
        nome: l.nome,
        restaurante: l.restaurante,
        cidade: l.cidade,
        stage: l.stage,
        atendidoPor: l.atendidoPor,
        atendenteUserId: l.atendenteUserId,
        atendenteNome: l.atendente?.nome ?? null,
        motivoDoPedido: l.motivoDoPedido,
        atendenteDesde: l.atendenteDesde,
        origem: { utmSource: l.utmSource, utmCampaign: l.utmCampaign },
        lastContactedAt: l.lastContactedAt,
        createdAt: l.createdAt,
        temperatura: l.temperatura,
        score: l.score,
      })),
    };
  } catch (erro) {
    // Lista vazia com sucesso faria a tela escrever "nenhum lead", que é uma
    // afirmação sobre a base. "Não consegui perguntar" é sobre o sistema.
    return {
      leituraOk: false,
      motivo: erro instanceof Error ? erro.message : "erro desconhecido ao ler a fila",
      leads: [],
      contagens: { ...VAZIO },
    };
  }
}
