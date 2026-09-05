/**
 * A FILA DO PRIMEIRO CONTATO — quem preencheu o formulário e nunca escreveu.
 *
 * ── O BURACO QUE ISTO FECHA, MEDIDO ─────────────────────────────────────────
 *
 * `avaliarContatoDeLead` — o portão da primeira abordagem, com opt-out, teto de
 * duas tentativas, descanso de 48 h, consentimento de menos de 90 dias e janela
 * de 9 h às 20 h em dia útil — estava **construído, testado e sem um único
 * chamador no produto**. Varredura em 05/09/2026: só os testes o importavam.
 * Trava sem fechadura.
 *
 * Do outro lado, `/site/falar-com-agente` documentava o efeito: *"quem preenche
 * o formulário e não aperta enviar no WhatsApp vira lead sem conversa. A ficha
 * existe, o agente não tem o que responder."* `atenderComOTA` é reativo por
 * desenho e não vai atrás de ninguém — está certo, e continua assim.
 *
 * Esta fila é a fechadura.
 *
 * ── ⚠️ ESTE ARQUIVO NÃO ESCREVE NADA, E A LIÇÃO É EMPRESTADA ────────────────
 *
 * A prospecção aprendeu caro que montar a fila não pode consumir a fila: a
 * primeira versão dela criava lead e queimava contato a cada abertura de tela
 * (ver o cabeçalho de `prospeccao/selecao.ts`). Aqui vale a mesma regra, escrita
 * antes de custar: **montar a fila é LEITURA.** Quem aborda é `disparo.ts`.
 *
 * ── QUEM ENTRA NA FILA, E POR QUE SÓ ESSES ──────────────────────────────────
 *
 *   · **só quem nos procurou** (`FONTES_QUE_NOS_PROCURARAM`). Contato de lista,
 *     importação ou cadastro à mão fica de fora: aquilo é prospecção fria, tem
 *     portão próprio e base legal declarada por quem libera o lote. Misturar os
 *     dois faria esta fila abordar estranho sem ninguém ter autorizado;
 *   · **só quem nunca escreveu.** Uma mensagem de ENTRADA já abre a janela de
 *     24 h e entrega o lead ao caminho reativo. Falar por cima dele é mandar
 *     duas mensagens diferentes da mesma empresa no mesmo minuto;
 *   · **só quem é da IA ou de ninguém.** Se uma pessoa assumiu, o robô cala —
 *     é o mesmo degrau 2 de `ta/atender.ts`;
 *   · **só quem ainda está no começo do funil.** Lead com demonstração marcada
 *     já foi tratado por gente, mesmo que o registro esteja incompleto.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { avaliarContatoDeLead, type LeadSafetyDecision } from "@/services/foocci-sdr/LeadContactSafety";
import {
  modeloAprovado,
  renderizarModelo,
  type PapelDoModelo,
} from "@/services/foocci-sdr/ModeloAprovado";
import { inicioDoDiaEmSaoPaulo } from "../prospeccao/selecao";
import { ATOR_DO_PRIMEIRO_CONTATO, configDoPrimeiroContato } from "./config";

type Cliente = PrismaClient | Prisma.TransactionClient;

/**
 * As portas em que a própria pessoa entregou os dados. É delas — e só delas —
 * que sai o consentimento que o portão exige.
 */
export const FONTES_QUE_NOS_PROCURARAM = ["FORMULARIO_DEMONSTRACAO", "AGENDAMENTO"] as const;

/** As etapas do funil em que o primeiro contato ainda faz sentido. */
export const ETAPAS_DO_COMECO = ["NOVO", "PRIMEIRO_CONTATO"] as const;

export interface CandidatoAoPrimeiroContato {
  leadId: string;
  nome: string | null;
  whatsapp: string;
  /** ABERTURA = nunca falamos. LEMBRETE = falamos uma vez e ele não respondeu. */
  papel: PapelDoModelo;
  /** Quantas mensagens de saída já foram para esta pessoa. Medido, não estimado. */
  tentativas: number;
  criadoEm: Date;
  decisao: LeadSafetyDecision;
  /** O modelo que sairia, quando liberado. `null` quando barrado. */
  modelo: string | null;
}

export interface FilaDePrimeiroContato {
  liberados: CandidatoAoPrimeiroContato[];
  barrados: CandidatoAoPrimeiroContato[];
  motivoDaFilaVazia: string | null;
  /** Abordagens já feitas hoje — contadas por EVENTO, não por lead. */
  usadosHoje: number;
  tetoDoDia: number;
}

export interface OpcoesDaFila {
  /** O canal de vendas está configurado E com o envio ligado? */
  canalPronto: boolean;
  agora?: Date;
  /** Corta a leitura, para a tela de conferência não varrer a base inteira. */
  limite?: number;
}

/**
 * Monta a fila do dia. **Somente leitura.**
 *
 * O teto é contado no banco, e não em memória: duas instâncias do app com um
 * contador cada uma entregariam o dobro sem ninguém ver — e o dobro do teto num
 * canal de WhatsApp é como se perde um número.
 */
export async function montarFilaDePrimeiroContato(
  db: Cliente,
  opcoes: OpcoesDaFila,
): Promise<FilaDePrimeiroContato> {
  const agora = opcoes.agora ?? new Date();
  const config = configDoPrimeiroContato();

  const usadosHoje = await contarAbordagensDeHoje(db, agora);
  const tetoDoDia = config.tetoDiario;
  const cabeNoTeto = Math.max(0, tetoDoDia - usadosHoje);

  const vazia = (motivo: string): FilaDePrimeiroContato => ({
    liberados: [],
    barrados: [],
    motivoDaFilaVazia: motivo,
    usadosHoje,
    tetoDoDia,
  });

  if (!config.ligado) {
    return vazia("Primeiro contato desligado (FOOCCI_PRIMEIRO_CONTATO_LIGADO).");
  }
  if (cabeNoTeto <= 0) {
    return vazia(
      tetoDoDia === 0
        ? "Teto diário do primeiro contato é zero — nada sai."
        : `Teto do dia atingido (${usadosHoje}/${tetoDoDia}).`,
    );
  }

  const quantos = Math.min(cabeNoTeto, opcoes.limite ?? cabeNoTeto);
  const candidatos = await lerCandidatos(db, agora, quantos);

  const liberados: CandidatoAoPrimeiroContato[] = [];
  const barrados: CandidatoAoPrimeiroContato[] = [];

  for (const lead of candidatos) {
    const avaliado = await avaliarCandidato(db, lead, opcoes.canalPronto, agora);
    if (avaliado.decisao.sendable) liberados.push(avaliado);
    else barrados.push(avaliado);
  }

  return {
    liberados,
    barrados,
    motivoDaFilaVazia:
      liberados.length === 0 && barrados.length === 0
        ? "Nenhum contato do formulário esperando primeira mensagem."
        : null,
    usadosHoje,
    tetoDoDia,
  };
}

/** O lead como esta fila precisa lê-lo. */
export interface LeadCandidato {
  id: string;
  nome: string;
  whatsapp: string;
  restaurante: string | null;
  cidade: string | null;
  optOutAt: Date | null;
  consentAt: Date | null;
  createdAt: Date;
  lastContactedAt: Date | null;
}

/**
 * A consulta que define a fila.
 *
 * `mensagens: { none: { direcao: "ENTRADA" } }` é a linha mais importante daqui:
 * ela é a diferença entre "a casa começou a conversa" e "a casa respondeu".
 */
async function lerCandidatos(db: Cliente, agora: Date, quantos: number): Promise<LeadCandidato[]> {
  // O lembrete só aparece depois do descanso. Sem este corte, o lead voltaria à
  // fila na rodada seguinte e seria barrado por DESCANSO_ATIVO — correto, mas
  // ocupando a vaga de quem podia ser abordado hoje.
  const limiteDoDescanso = new Date(agora.getTime() - 48 * 3_600_000);

  return db.siteLead.findMany({
    where: {
      optOutAt: null,
      fonte: { in: [...FONTES_QUE_NOS_PROCURARAM] },
      stage: { in: [...ETAPAS_DO_COMECO] },
      atendidoPor: { in: ["NINGUEM", "IA"] },
      mensagens: { none: { direcao: "ENTRADA" } },
      OR: [{ lastContactedAt: null }, { lastContactedAt: { lte: limiteDoDescanso } }],
    },
    orderBy: { createdAt: "asc" },
    take: quantos,
    select: {
      id: true,
      nome: true,
      whatsapp: true,
      restaurante: true,
      cidade: true,
      optOutAt: true,
      consentAt: true,
      createdAt: true,
      lastContactedAt: true,
    },
  });
}

/**
 * A decisão sobre UM lead: o portão, e depois o modelo.
 *
 * ── A ORDEM É DELIBERADA ────────────────────────────────────────────────────
 *
 * Primeiro se pergunta se podemos falar com ESTA PESSOA; só depois se temos COM
 * O QUE falar. Invertendo, um lead que pediu silêncio apareceria barrado por
 * "falta modelo" — e no dia em que o modelo chegasse ele entraria na fila como
 * se nada houvesse.
 */
export async function avaliarCandidato(
  db: Cliente,
  lead: LeadCandidato,
  canalPronto: boolean,
  agora: Date,
): Promise<CandidatoAoPrimeiroContato> {
  const tentativas = await contarTentativas(db, lead.id);
  const papel: PapelDoModelo = tentativas === 0 ? "ABERTURA" : "LEMBRETE";

  const base = {
    leadId: lead.id,
    nome: lead.nome,
    whatsapp: lead.whatsapp,
    papel,
    tentativas,
    criadoEm: lead.createdAt,
  };

  const decisao = avaliarContatoDeLead({
    telefone: lead.whatsapp,
    optOutAt: lead.optOutAt,
    // `createdAt` como consentimento é autorizado pelo schema — e SÓ para as
    // fontes desta fila, em que o instante do cadastro É o instante do envio do
    // formulário. Para um lead de importação seria mentira, e é por isso que a
    // consulta acima não deixa nenhum deles chegar até aqui.
    consentimentoEm: lead.consentAt ?? lead.createdAt,
    tentativas,
    ultimoContatoEm: lead.lastContactedAt,
    // Verdadeiro porque os dois campos acima saíram do banco agora.
    historicoConhecido: true,
    canalPronto,
    agora,
  });

  if (!decisao.sendable) return { ...base, decisao, modelo: null };

  const modelo = modeloAprovado(papel);
  if (!modelo) {
    return {
      ...base,
      modelo: null,
      decisao: {
        sendable: false,
        reason: "SEM_MODELO_APROVADO",
        detail:
          `Não há modelo declarado para ${papel.toLowerCase()} — ` +
          "quem nunca escreveu para a Foocci não tem janela de 24h, e a Meta só " +
          "aceita modelo aprovado para a empresa falar primeiro.",
      },
    };
  }

  const render = renderizarModelo(modelo, {
    nome: lead.nome,
    restaurante: lead.restaurante,
    cidade: lead.cidade,
  });
  if (!render.ok) {
    return {
      ...base,
      modelo: modelo.nome,
      decisao: { sendable: false, reason: "SEM_MODELO_APROVADO", detail: render.motivo },
    };
  }

  return { ...base, decisao, modelo: modelo.nome };
}

/** Mensagens que a casa mandou para este lead. Saída, não entrada. */
export async function contarTentativas(db: Cliente, leadId: string): Promise<number> {
  return db.leadMensagem.count({ where: { leadId, direcao: "SAIDA" } });
}

/**
 * Abordagens de primeiro contato feitas hoje.
 *
 * ── ISTO CONTA EVENTO, E A DIFERENÇA NÃO É ACADÊMICA ────────────────────────
 *
 * O teto da prospecção conta LEADS com a fonte certa contatados hoje, e por isso
 * vaza dos dois lados — está anotado em `docs/pendencias.md` como pré-condição
 * para ligar o envio de lá. Aqui o contador lê a trilha da própria abordagem
 * (`SiteLeadInteraction` com `actor = "primeiro-contato"`), gravada por
 * `disparo.ts` no mesmo ato que manda a mensagem. Uma conversa de CRM com o
 * mesmo lead não consome teto; uma abordagem a quem já era conhecido consome.
 *
 * O dia é o de São Paulo, não o do servidor: em UTC o teto viraria às 21 h de
 * Brasília, dentro da janela de abordagem, dando teto novo no fim do expediente.
 */
export async function contarAbordagensDeHoje(db: Cliente, agora: Date): Promise<number> {
  return db.siteLeadInteraction.count({
    where: {
      actor: ATOR_DO_PRIMEIRO_CONTATO,
      tipo: "MENSAGEM_ENVIADA",
      createdAt: { gte: inicioDoDiaEmSaoPaulo(agora) },
    },
  });
}
