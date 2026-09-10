/**
 * A SELEÇÃO DA PROSPECÇÃO — quem seria abordado hoje, e por que só esses.
 *
 * ── ⚠️ ESTE ARQUIVO NÃO ESCREVE NADA. LEIA ISTO ANTES DE MUDÁ-LO ────────────
 *
 * A primeira versão criava o lead e marcava o item como usado **enquanto
 * montava a lista**. Parecia inofensivo e destruía a base: cada abertura da
 * tela consumia um pedaço da lista, tirava os itens de PENDENTE para sempre e
 * criava leads — inclusive dos BARRADOS, inclusive com o canal desligado, sem
 * falar com ninguém. Cinco recarregamentos queimavam cem contatos.
 *
 * Pior: o commit que a introduziu vendia esse modo — prospecção ligada, envio
 * desligado — como "o estado certo para conferir a lista antes da estreia".
 * A tela de conferência era a que mais estragava.
 *
 * A regra que ficou: **montar a fila é LEITURA.** Materializar o lead é outro
 * ato, com nome próprio (`materializarLead`), chamado por quem vai de fato
 * abordar — nunca por quem só está olhando.
 *
 * ── E QUEM ENVIA? ───────────────────────────────────────────────────────────
 *
 * Ninguém, aqui. A entrega continua em `salaDeVendas/entrega.ts`, atrás de
 * `FOOCCI_SDR_SEND_ENABLED`, que é chave do dono.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import {
  avaliarAbordagemDeProspeccao,
  REGRA,
  type LeadSafetyDecision,
} from "@/services/foocci-sdr/LeadContactSafety";
import { acharLeadPeloTelefone } from "./casamento";

type Cliente = PrismaClient | Prisma.TransactionClient;

export interface CandidatoAAbordagem {
  itemId: string;
  loteId: string;
  /** `null` enquanto o item ainda não foi materializado — e isso é normal. */
  leadId: string | null;
  nome: string | null;
  whatsapp: string;
  decisao: LeadSafetyDecision;
}

export interface FilaDeProspeccao {
  liberados: CandidatoAAbordagem[];
  barrados: CandidatoAAbordagem[];
  motivoDaFilaVazia: string | null;
  usadosHoje: number;
  tetoDoDia: number;
}

/**
 * Monta a fila do dia. **Somente leitura.**
 *
 * ── POR QUE O TETO É CONTADO NO BANCO ───────────────────────────────────────
 *
 * Duas instâncias do app com um contador em memória cada uma entregariam o
 * dobro do teto sem ninguém perceber — e o dobro do teto num canal de WhatsApp
 * é como se perde um número. O teto só é teto se todo mundo ler do mesmo lugar.
 */
export async function montarFilaDeProspeccao(
  db: Cliente,
  opcoes: { canalPronto: boolean; agora?: Date; limite?: number } = {
    canalPronto: false,
  },
): Promise<FilaDeProspeccao> {
  const agora = opcoes.agora ?? new Date();

  const config = await db.prospeccaoConfig.findUnique({
    where: { id: "singleton" },
  });

  // Sem configuração nenhuma a resposta é "desligada" — e não "sem limite".
  const ligada = Boolean(config?.outboundLigado) && !config?.pausadoEm;
  const tetoDoDia = config?.limiteDiario ?? 0;
  // ── O CONFIGURÁVEL SÓ APERTA, NUNCA AFROUXA ──
  //
  // Deixar o dono baixar o descanso abaixo do padrão faria a única trava que
  // afrouxa nesta obra ser justamente a de insistência — no portão que fala com
  // ESTRANHOS, que é o mais delicado dos dois. Quem quiser insistir mais que o
  // desenho permite precisa mudar o desenho, não a configuração.
  const descansoHoras = Math.max(
    REGRA.descansoHoras,
    config?.horasEntreAbordagens ?? REGRA.descansoHoras,
  );

  const usadosHoje = await contarAbordagensDeHoje(db, agora);
  const cabeNoTeto = Math.max(0, tetoDoDia - usadosHoje);

  const vazia = (motivo: string): FilaDeProspeccao => ({
    liberados: [],
    barrados: [],
    motivoDaFilaVazia: motivo,
    usadosHoje,
    tetoDoDia,
  });

  if (!ligada) {
    return vazia(
      config?.pausadoEm
        ? `Prospecção pausada${config.motivo ? `: ${config.motivo}` : "."}`
        : "Prospecção desligada.",
    );
  }
  if (cabeNoTeto <= 0) {
    return vazia(`Teto do dia atingido (${usadosHoje}/${tetoDoDia}).`);
  }

  const quantos = Math.min(cabeNoTeto, opcoes.limite ?? cabeNoTeto);

  // ── ⭐ A BASE É UMA SÓ — E O FILTRO DE LOTE MUDOU DE PAPEL EM 10/09/2026 ───
  //
  // `lote: { situacao: "LIBERADO" }` continua aqui, e continua sendo obrigatório,
  // mas ele já **não é mais o portão de autorização**: o lote nasce LIBERADO
  // desde que a importação passou a assinar a liberação (ver `lote.ts`). O que
  // ele faz agora é EXCLUIR o lote que alguém parou de propósito — o botão de
  // pausa, e o cancelamento de uma importação inteira, que pausa todos os lotes
  // daquele arquivo. Sem esta linha, cancelar uma importação não teria efeito
  // nenhum sobre quem é abordado amanhã de manhã.
  //
  // ⚠️ `limiteDiario` do lote NÃO é mais lido. A coluna continua no banco (é
  // registro de como o lote entrou), e a fila deixou de obedecê-la: com o
  // arquivo entrando em 16 partes de 20, ela cortava a base unificada em 320 por
  // dia enquanto a tela mostrava o teto global de 2.000 ao lado — dois tetos, um
  // deles invisível, e ninguém entendendo por que a fila parava. Pedir só o que
  // se usa é o que impede a coluna de voltar a valer por descuido.
  const itens = await db.itemDeProspeccao.findMany({
    where: { situacao: "PENDENTE", lote: { situacao: "LIBERADO" } },
    orderBy: { criadoEm: "asc" },
    take: quantos,
    include: {
      lote: { select: { id: true, proveniencia: true } },
    },
  });

  const liberados: CandidatoAAbordagem[] = [];
  const barrados: CandidatoAAbordagem[] = [];

  for (const item of itens) {
    // Leitura, nunca criação: se o contato já é lead, aproveitamos o histórico
    // dele; se não é, avaliamos com histórico zero — que é a verdade.
    const lead = await lerLeadDoItem(db, item);

    // O teto que vale é o do dia (contado acima, no banco) mais o teto explícito
    // da rodada, que quem aperta o botão escolhe. Nenhum outro.
    const decisao = avaliarAbordagemDeProspeccao({
      telefone: item.whatsapp,
      optOutAt: lead?.optOutAt ?? null,
      tentativas: lead?.tentativas ?? 0,
      ultimoContatoEm: lead?.lastContactedAt ?? null,
      // Verdadeiro porque os três campos acima saíram do banco agora: ou o lead
      // existe e foi lido, ou ele não existe e o histórico é genuinamente zero.
      historicoConhecido: true,
      canalPronto: opcoes.canalPronto,
      prospeccaoLiberada: true,
      baseLegalDeclarada: item.lote.proveniencia,
      descansoHoras,
      agora,
    });

    const candidato: CandidatoAAbordagem = {
      itemId: item.id,
      loteId: item.loteId,
      leadId: lead?.id ?? null,
      nome: item.nome,
      whatsapp: item.whatsapp,
      decisao,
    };

    if (decisao.sendable) liberados.push(candidato);
    else barrados.push(candidato);
  }

  return {
    liberados,
    barrados,
    motivoDaFilaVazia:
      liberados.length === 0 && barrados.length === 0
        ? "Nenhum contato pendente na base — ou a lista acabou, ou os lotes estão pausados."
        : null,
    usadosHoje,
    tetoDoDia,
  };
}

/**
 * O resultado de materializar.
 *
 * `materializado` fala só da gravação. **Permissão para abordar é outra
 * pergunta**, e quem responde na hora do envio é `escolherPortaoDoLead`
 * (`abordar.ts`): lead de `LISTA_PROSPECCAO` atravessa
 * `avaliarAbordagemDeProspeccao`; qualquer outra origem, inclusive a não
 * classificada, atravessa `avaliarContatoDeLead`.
 *
 * ⚠️ ESTE PARÁGRAFO JÁ MENTIU DUAS VEZES NO MESMO DIA, 08/09/2026. Primeiro
 * dizia que o envio usava o portão frio (não usava). Corrigido para dizer que
 * usava o morno — e **a correção envelheceu em três horas**, quando o envio
 * passou a escolher pela origem. Sem número de linha desta vez: linha citada é
 * a parte que apodrece primeiro.
 */
export type ResultadoDaMaterializacao =
  | { materializado: true; leadId: string }
  | { materializado: false; motivo: string };

interface LeadDoItem {
  id: string;
  optOutAt: Date | null;
  lastContactedAt: Date | null;
  tentativas: number;
}

/** Lê o lead do item, se ele já existir. Não cria nada. */
async function lerLeadDoItem(
  db: Cliente,
  item: { leadId: string | null; whatsappDigits: string },
): Promise<LeadDoItem | null> {
  const achado = item.leadId
    ? await db.siteLead.findUnique({
        where: { id: item.leadId },
        select: { id: true, optOutAt: true, lastContactedAt: true },
      })
    : // Pela cauda de oito dígitos, e não por igualdade: a base tem telefones em
      // formato legado, e igualdade exata não acharia quem pediu silêncio.
      await acharLeadPeloTelefone(db, item.whatsappDigits);

  if (!achado) return null;
  return { ...achado, tentativas: await contarTentativas(db, achado.id) };
}

/**
 * MATERIALIZA o item: cria (ou encontra) o lead e tira o item de PENDENTE.
 *
 * ── ⚠️ SÓ CHAME ISTO QUANDO FOR REALMENTE ABORDAR ───────────────────────────
 *
 * Este é o ato que consome a lista. Chamá-lo para montar tela, para prévia, ou
 * "só para já deixar pronto" é o defeito que esta refatoração existe para
 * matar: item que sai de PENDENTE sem ninguém ter falado com a pessoa é um
 * contato perdido em silêncio.
 *
 * ── E O QUE ELE DELIBERADAMENTE NÃO GRAVA ───────────────────────────────────
 *
 * `consentAt`. Nunca. Quem está numa lista de prospecção não consentiu com
 * nada, e gravar a data de hoje ali faria o sistema afirmar, para sempre e para
 * qualquer auditor, que esta pessoa nos procurou. O lead nasce com
 * `fonte: LISTA_PROSPECCAO`, que é a verdade: nós fomos atrás dele.
 *
 * ── ⚠️ E `materializado: true` NÃO QUER DIZER "PODE ABORDAR" ────────────────
 *
 * O retorno se chama `materializado`, e não `ok`, de propósito. Um `ok: true`
 * convidaria quem chamar a tratar o sucesso da gravação como permissão de
 * falar — e o lead encontrado pode ser justamente alguém que PEDIU SILÊNCIO, ou
 * que já está em atendimento de outra pessoa. Quem decide se pode falar é o
 * portão, sempre, e ele é chamado por quem vai enviar.
 */
export async function materializarLead(
  db: Cliente,
  itemId: string,
): Promise<ResultadoDaMaterializacao> {
  const item = await db.itemDeProspeccao.findUnique({
    where: { id: itemId },
    include: { lote: { select: { situacao: true } } },
  });

  if (!item) return { materializado: false, motivo: "Item não encontrado." };
  if (item.lote.situacao !== "LIBERADO") {
    return { materializado: false, motivo: "O lote deste contato não está liberado." };
  }
  if (item.situacao !== "PENDENTE") {
    // Idempotente: materializar duas vezes devolve o mesmo lead, não cria outro.
    return item.leadId
      ? { materializado: true, leadId: item.leadId }
      : { materializado: false, motivo: `Item em situação ${item.situacao}.` };
  }

  // ── ⚠️ RESERVAR ANTES DE CRIAR — A CORRIDA DOS DOIS SDRs ──────────────────
  //
  // Ler "está PENDENTE" e só depois criar o lead deixa uma janela entre as duas
  // operações. Dois SDRs clicando ao mesmo tempo (ou um clique duplo, ou duas
  // instâncias do app) passam os dois pela leitura, não encontram lead nenhum, e
  // criam **dois leads para o mesmo telefone** — dois donos para a mesma pessoa,
  // que é exatamente o que este desenho inteiro existe para impedir. E
  // `SiteLead.whatsappDigits` é índice, não único: o banco não segura.
  //
  // `updateMany` com o estado no `where` é comparar-e-trocar: **um** dos dois
  // recebe `count: 1` e segue; o outro recebe `count: 0` e lê o resultado de
  // quem ganhou. Trava de banco, não boa intenção de código.
  const reserva = await db.itemDeProspeccao.updateMany({
    where: { id: item.id, situacao: "PENDENTE" },
    data: { situacao: "VIROU_LEAD", processadoEm: new Date() },
  });

  if (reserva.count === 0) {
    const jaFeito = await db.itemDeProspeccao.findUnique({
      where: { id: item.id },
      select: { leadId: true },
    });
    return jaFeito?.leadId
      ? { materializado: true, leadId: jaFeito.leadId }
      : {
          materializado: false,
          motivo: "Outro atendimento está materializando este contato.",
        };
  }

  try {
    const existente = await acharLeadPeloTelefone(db, item.whatsappDigits);

    if (existente) {
      await db.itemDeProspeccao.update({
        where: { id: item.id },
        data: {
          situacao: "DUPLICADO",
          leadId: existente.id,
          motivo: "Já existe como lead na base.",
        },
      });
      return { materializado: true, leadId: existente.id };
    }

    const criado = await db.siteLead.create({
      data: {
        nome: item.nome ?? item.empresa ?? "Contato de prospecção",
        whatsapp: item.whatsapp,
        whatsappDigits: item.whatsappDigits,
        restaurante: item.empresa,
        cidade: item.cidade,
        tipo: item.tipo,
        fonte: "LISTA_PROSPECCAO",
        origem: "prospeccao",
        stage: "NOVO",
        atendidoPor: "NINGUEM",
        // consentAt fica NULO de propósito — ver o comentário acima.
      },
      select: { id: true },
    });

    await db.itemDeProspeccao.update({
      where: { id: item.id },
      data: { leadId: criado.id },
    });

    return { materializado: true, leadId: criado.id };
  } catch (erro) {
    // ── DEVOLVER A RESERVA ──
    //
    // Sem isto, uma falha aqui deixaria o item marcado como VIROU_LEAD sem lead
    // nenhum: um contato que sai da fila para sempre e nunca é abordado — some
    // em silêncio, que é a pior forma de perder alguém da lista.
    // A compensação vai num try próprio: se `db` for uma transação, a primeira
    // falha já abortou tudo no Postgres e este update também falha — e o erro
    // dele SUBSTITUIRIA o original, enterrando o diagnóstico verdadeiro sob um
    // "current transaction is aborted".
    try {
      await db.itemDeProspeccao.updateMany({
        where: { id: item.id, leadId: null },
        data: { situacao: "PENDENTE", processadoEm: null },
      });
    } catch {
      // Numa transação, o rollback já devolve o item. Fora dela, o item fica
      // reservado e aparece na fila de exceções — nunca some calado.
    }
    throw erro;
  }
}

/** Mensagens que a casa mandou para este lead. Saída, não entrada. */
async function contarTentativas(db: Cliente, leadId: string): Promise<number> {
  return db.leadMensagem.count({ where: { leadId, direcao: "SAIDA" } });
}

/**
 * Abordagens de prospecção já feitas hoje, lidas do banco.
 *
 * ── ⚠️ ESTE CONTADOR AINDA É UMA APROXIMAÇÃO, E ISSO ESTÁ REGISTRADO ────────
 *
 * Ele conta LEADS com `fonte: LISTA_PROSPECCAO` contatados hoje, e não EVENTOS
 * de abordagem. Enquanto nada envia, a diferença é teórica. No dia em que a
 * entrega for ligada, ela vaza dos dois lados:
 *
 *   · o item que casou com um lead que JÁ EXISTIA na base (ramo `DUPLICADO`)
 *     tem outra `fonte` — abordá-lo não consome teto, e é justamente a fatia
 *     mais delicada, gente que já nos conhece;
 *   · uma conversa de CRM com um lead de fonte `LISTA_PROSPECCAO` CONSOME teto
 *     sem ninguém ter prospectado.
 *
 * **Teto só é teto quando conta o evento.** O conserto certo é o caminho de
 * envio registrar a abordagem (um evento próprio, ou `lastContactedAt` gravado
 * por ele) e este contador ler o evento. Está em `docs/pendencias.md`, e é
 * pré-condição para ligar `FOOCCI_SDR_SEND_ENABLED` — não para mergear isto,
 * que não envia nada.
 *
 * ── O DIA É O DE SÃO PAULO, NÃO O DO SERVIDOR ───────────────────────────────
 *
 * `setHours(0,0,0,0)` usa o fuso do processo, que em produção é UTC. O teto
 * viraria às 21h de Brasília: quem gastasse o teto durante a tarde ganharia um
 * teto novo no fim do expediente, dentro da janela de abordagem. Toda a janela
 * de horário desta obra já é medida em `America/Sao_Paulo`; o teto tem que
 * concordar com ela.
 */
export async function contarAbordagensDeHoje(db: Cliente, agora: Date): Promise<number> {
  const inicioDoDia = inicioDoDiaEmSaoPaulo(agora);

  return db.siteLead.count({
    where: { fonte: "LISTA_PROSPECCAO", lastContactedAt: { gte: inicioDoDia } },
  });
}

/** Meia-noite de São Paulo do dia de `agora`, devolvida em UTC. */
export function inicioDoDiaEmSaoPaulo(agora: Date): Date {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: REGRA.fusoHorario,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(agora);

  const p = (tipo: string) => Number(partes.find((x) => x.type === tipo)?.value ?? "0");

  // Quanto do dia local já passou, subtraído do instante atual: chega-se à
  // meia-noite local sem precisar saber o deslocamento do fuso (que muda com
  // horário de verão).
  const segundosDesdeAMeiaNoite = p("hour") * 3600 + p("minute") * 60 + p("second");
  return new Date(agora.getTime() - segundosDesdeAMeiaNoite * 1000);
}
