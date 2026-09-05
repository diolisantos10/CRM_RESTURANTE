/**
 * O DISPARO — o único lugar desta obra que fala com o telefone de alguém.
 *
 * ── AS TRÊS CHAVES QUE PRECISAM ESTAR LIGADAS, NESTA ORDEM ──────────────────
 *
 *   1. `FOOCCI_SDR_SEND_ENABLED` — do CEO, e não se mexe daqui. Sem ela
 *      `canalDeVendasPronto()` é falso, o portão barra com `CANAL_INDISPONIVEL`
 *      e nada chega nem a ser reservado;
 *   2. `FOOCCI_PRIMEIRO_CONTATO_LIGADO` + teto do dia — a chave própria desta
 *      obra, que nasce desligada e com teto zero;
 *   3. um modelo aprovado pela Meta declarado no ambiente. Sem ele a Graph API
 *      recusa a mensagem, porque quem nunca escreveu para a Foocci não tem
 *      janela de 24 h aberta. Ver `foocci-sdr/ModeloAprovado.ts`.
 *
 * Nenhuma delas está ligada hoje, e este arquivo não liga nenhuma.
 *
 * ── POR QUE ISTO NÃO PASSA POR `entrega.ts` ─────────────────────────────────
 *
 * `entregarMensagem` entrega TEXTO LIVRE de uma mensagem PENDENTE. É o caminho
 * certo para responder quem escreveu — e é justamente o que a Meta recusa aqui.
 * Reaproveitá-la faria toda primeira mensagem sair como texto livre e voltar
 * recusada, com a linha marcada como FALHOU e o lead sem receber nada. As duas
 * entregas se parecem no código e são atos diferentes na política da Meta; o
 * nome separado é o que impede a confusão de voltar.
 *
 * O que É reaproveitado é o resto: `registrarSaida`, `confirmarEnvio` e
 * `registrarFalhaDeEnvio` continuam sendo os donos da conversa.
 */

import type { PrismaClient } from "@prisma/client";
import {
  canalDeVendasPronto,
  enviarModeloDeVendas,
} from "@/services/foocci-sdr/FoocciSalesChannel";
import { modeloAprovado, renderizarModelo } from "@/services/foocci-sdr/ModeloAprovado";
import { registrarSaida, confirmarEnvio, registrarFalhaDeEnvio } from "../conversa";
import { moverNaSala } from "../funil";
import { ATOR_DO_PRIMEIRO_CONTATO, configDoPrimeiroContato } from "./config";
import {
  avaliarCandidato,
  contarAbordagensDeHoje,
  ETAPAS_DO_COMECO,
  FONTES_QUE_NOS_PROCURARAM,
  type CandidatoAoPrimeiroContato,
} from "./fila";

export type MotivoDeNaoAbordar =
  | "desligado"
  | "tetoDoDia"
  | "leadNaoElegivel"
  | "portaoReprovou"
  | "outroJaPegou"
  | "naoGravou"
  | "aMetaRecusou";

export type ResultadoDaAbordagem =
  | { abordado: true; leadId: string; mensagemId: string; modelo: string }
  | { abordado: false; leadId: string; motivo: MotivoDeNaoAbordar; detalhe: string };

/**
 * Aborda UM lead. Nunca lança.
 *
 * ── TUDO É RELIDO AQUI, E ISSO NÃO É REDUNDÂNCIA ────────────────────────────
 *
 * A fila é uma fotografia; entre montá-la e chegar neste ponto a pessoa pode ter
 * pedido silêncio, um vendedor pode ter assumido o lead, e o teto do dia pode
 * ter sido gasto por outra instância do app. Reavaliar com dado fresco é o que
 * impede que a fotografia autorize um ato que o presente já proibiu.
 */
export async function abordarLead(
  db: PrismaClient,
  leadId: string,
  opcoes: { agora?: Date } = {},
): Promise<ResultadoDaAbordagem> {
  const agora = opcoes.agora ?? new Date();

  try {
    const config = configDoPrimeiroContato();
    if (!config.ligado) {
      return { abordado: false, leadId, motivo: "desligado", detalhe: "FOOCCI_PRIMEIRO_CONTATO_LIGADO não está true" };
    }

    // O teto é relido do banco a cada abordagem, e não contado em memória ao
    // longo da rodada: duas instâncias rodando ao mesmo tempo entregariam o
    // dobro, e o dobro do teto é como se perde um número de WhatsApp.
    const usados = await contarAbordagensDeHoje(db, agora);
    if (usados >= config.tetoDiario) {
      return {
        abordado: false,
        leadId,
        motivo: "tetoDoDia",
        detalhe: `teto do dia atingido (${usados}/${config.tetoDiario})`,
      };
    }

    const lead = await db.siteLead.findFirst({
      where: {
        id: leadId,
        optOutAt: null,
        fonte: { in: [...FONTES_QUE_NOS_PROCURARAM] },
        stage: { in: [...ETAPAS_DO_COMECO] },
        atendidoPor: { in: ["NINGUEM", "IA"] },
        mensagens: { none: { direcao: "ENTRADA" } },
      },
      select: {
        id: true, nome: true, whatsapp: true, restaurante: true, cidade: true,
        optOutAt: true, consentAt: true, createdAt: true, lastContactedAt: true,
        stage: true,
      },
    });

    if (!lead) {
      return {
        abordado: false,
        leadId,
        motivo: "leadNaoElegivel",
        detalhe: "o lead não existe, pediu silêncio, já escreveu, mudou de etapa ou foi assumido por alguém",
      };
    }

    const candidato: CandidatoAoPrimeiroContato = await avaliarCandidato(
      db,
      lead,
      canalDeVendasPronto(),
      agora,
    );

    if (!candidato.decisao.sendable) {
      return {
        abordado: false,
        leadId,
        motivo: "portaoReprovou",
        detalhe: `${candidato.decisao.reason}: ${candidato.decisao.detail}`,
      };
    }

    // O portão já garantiu que existe modelo e que ele preenche com os dados
    // deste lead; refazer aqui é o que dá o texto e os parâmetros, e mantém a
    // decisão e o payload saindo da MESMA leitura.
    const modelo = modeloAprovado(candidato.papel);
    if (!modelo) {
      return { abordado: false, leadId, motivo: "portaoReprovou", detalhe: "sem modelo aprovado declarado" };
    }
    const render = renderizarModelo(modelo, {
      nome: lead.nome,
      restaurante: lead.restaurante,
      cidade: lead.cidade,
    });
    if (!render.ok) {
      return { abordado: false, leadId, motivo: "portaoReprovou", detalhe: render.motivo };
    }

    // ── A RESERVA — comparar-e-trocar, não boa intenção ────────────────────
    //
    // Duas rodadas simultâneas (dois cron, um clique duplo, duas instâncias)
    // passariam as duas por tudo acima e mandariam DUAS mensagens de abertura
    // para a mesma pessoa. `updateMany` com o valor lido dentro do `where` faz
    // uma só ganhar: a outra recebe `count: 0` e desiste. Trava de banco.
    const anterior = lead.lastContactedAt;
    const reserva = await db.siteLead.updateMany({
      where: { id: lead.id, lastContactedAt: anterior },
      data: { lastContactedAt: agora },
    });
    if (reserva.count === 0) {
      return {
        abordado: false,
        leadId,
        motivo: "outroJaPegou",
        detalhe: "outra rodada abordou este contato primeiro",
      };
    }

    let mensagemId: string;
    try {
      const gravada = await registrarSaida(db, {
        leadId: lead.id,
        texto: render.texto,
        // SISTEMA, e não IA: nada aqui foi redigido por modelo nenhum. O texto é
        // o do modelo aprovado, palavra por palavra — dizer "IA" faria a Sala
        // atribuir ao TA uma frase que ele não escreveu.
        autor: "SISTEMA",
        tipo: "TEMPLATE",
        templateNome: modelo.nome,
        agora,
      });
      if (!gravada.ok) throw new Error(`registrarSaida recusou: ${gravada.causa}`);
      mensagemId = gravada.mensagemId;

      // A trilha da abordagem. É ELA que o teto do dia conta — por isso é
      // gravada no mesmo ato, e não depois de o provedor responder: uma
      // abordagem que saiu e não foi contada é teto furado.
      await db.siteLeadInteraction.create({
        data: {
          leadId: lead.id,
          tipo: "MENSAGEM_ENVIADA",
          actor: ATOR_DO_PRIMEIRO_CONTATO,
          nota: `${candidato.papel.toLowerCase()} pelo modelo "${modelo.nome}"`,
          createdAt: agora,
        },
      });
    } catch (erro) {
      // ── DEVOLVER A RESERVA ──
      //
      // Sem isto, uma falha de gravação deixaria o lead marcado como "falamos
      // com ele" sem mensagem nenhuma: ele sairia da fila por 48 h e depois
      // voltaria como LEMBRETE de uma abertura que nunca aconteceu.
      try {
        await db.siteLead.updateMany({
          where: { id: lead.id, lastContactedAt: agora },
          data: { lastContactedAt: anterior },
        });
      } catch {
        // A reserva fica de pé e o lead reaparece na fila em 48 h. Nunca some
        // calado — e é por isso que a compensação vai num try próprio.
      }
      return {
        abordado: false,
        leadId,
        motivo: "naoGravou",
        detalhe: erro instanceof Error ? erro.message.slice(0, 200) : "erro ao gravar a mensagem",
      };
    }

    const enviado = await enviarModeloDeVendas(
      candidato.decisao,
      lead.whatsapp,
      modelo,
      render.parametros,
    );

    if (!enviado.ok) {
      await registrarFalhaDeEnvio(db, { mensagemId, erro: enviado.error ?? "erro sem motivo" });
      return {
        abordado: false,
        leadId,
        motivo: "aMetaRecusou",
        detalhe: enviado.error ?? "erro sem motivo",
      };
    }

    await confirmarEnvio(db, { mensagemId, waMessageId: `local:${mensagemId}` });

    // A etapa anda só depois de a Meta aceitar. Andar antes faria o funil contar
    // como "primeiro contato feito" uma mensagem que voltou recusada.
    if (lead.stage === "NOVO") {
      await moverNaSala(db, {
        leadId: lead.id,
        para: "PRIMEIRO_CONTATO",
        actor: ATOR_DO_PRIMEIRO_CONTATO,
        nota: `abertura automática pelo modelo "${modelo.nome}"`,
        agora,
      });
    }

    return { abordado: true, leadId: lead.id, mensagemId, modelo: modelo.nome };
  } catch (e) {
    return {
      abordado: false,
      leadId,
      motivo: "naoGravou",
      detalhe: e instanceof Error ? e.message.slice(0, 200) : "erro desconhecido",
    };
  }
}
