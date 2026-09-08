/**
 * A PONTE — o pedaço que faltava entre "temos o contato" e "a mensagem saiu".
 *
 * ── O BURACO, LEVANTADO EM 07/09/2026 ───────────────────────────────────────
 *
 * A máquina de prospecção da casa está inteira: importação de lote, base legal
 * obrigatória, portão de abordagem fria, teto diário, interruptor, tela. E era
 * **toda de leitura**. Nada nela alcançava o envio. Uma casa que sabe dizer
 * quem abordar e não sabe abordar.
 *
 * Este arquivo é o único caminho por onde uma abordagem sai. Um só, de
 * propósito: dois caminhos para falar com estranho é como se perde a conta do
 * que a empresa disse a quem.
 *
 * ── AS QUATRO TRAVAS, NESTA ORDEM E POR ESTE MOTIVO ────────────────────────
 *
 *   1. **O portão do lead** — fala do DESTINATÁRIO: pediu silêncio? tem
 *      telefone? o consentimento ainda vale? já tentamos demais?
 *   2. **O freio de ritmo** — fala de NÓS: quantas já saíram nesta hora e neste
 *      dia. Vem depois do portão porque recusar por ritmo alguém que nem podia
 *      ser abordado esconderia o motivo verdadeiro.
 *   3. **Gravar antes de enviar** — o pior caso vira uma linha PENDENTE
 *      visível, e não um cliente que recebeu sem o sistema saber.
 *   4. **A entrega** — e o resultado dela é registrado na própria linha, com o
 *      motivo por escrito quando a Meta recusa.
 *
 * ── ⚠️ O QUE ESTE ARQUIVO NÃO FAZ ──────────────────────────────────────────
 *
 * **Não percorre lista.** Ele aborda UM lead. Quem varre uma lista chamando
 * isto em laço é outro arquivo, e é lá que mora a decisão de quantos por vez —
 * com o freio dizendo não muito antes de a lista acabar.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { registrarSaida, confirmarEnvio, registrarFalhaDeEnvio } from "./conversa";
import { conferirRitmo } from "./freioDeRitmo";
import { avaliarContatoDeLead } from "@/services/foocci-sdr/LeadContactSafety";
import {
  canalDeVendasPronto,
  enviarModeloDeVendas,
  type ModeloDeAbordagem,
} from "@/services/foocci-sdr/FoocciSalesChannel";

type Cliente = PrismaClient | Prisma.TransactionClient;

export type ResultadoDaAbordagem =
  | { abordou: true; mensagemId: string }
  | {
      abordou: false;
      motivo:
        | "leadNaoExiste"
        /** O portão do lead recusou. `detalhe` traz o motivo declarado por ele. */
        | "portaoRecusou"
        /** Teto de abordagens da hora ou do dia. Não é falha — é o freio. */
        | "ritmo"
        | "naoConseguiuGravar"
        | "aMetaRecusou";
      detalhe: string;
    };

/**
 * O modelo configurado para abordagem.
 *
 * Vem do ambiente porque o nome e o idioma são registro na Meta, não decisão de
 * código: mudam quando o dono aprova um modelo novo, e não quando alguém faz
 * deploy. Sem configuração, `enviarModeloDeVendas` recusa citando a variável —
 * a mensagem nunca sai "assim mesmo".
 */
export function modeloConfigurado(env: NodeJS.ProcessEnv = process.env): {
  nome: string;
  idioma: string;
} {
  return {
    nome: (env.FOOCCI_SDR_MODELO_ABORDAGEM ?? "").trim(),
    idioma: (env.FOOCCI_SDR_MODELO_IDIOMA ?? "pt_BR").trim(),
  };
}

/**
 * O primeiro nome, para `{{1}}`.
 *
 * ⚠️ Função separada e exportada de propósito. Quando o texto exato do modelo
 * chegar da Meta, é AQUI que a ordem e a quantidade das variáveis mudam — e o
 * teste que guarda isso não precisa saber de banco nem de envio.
 *
 * Nome vazio vira `null`, e não string vazia: `enviarModeloDeVendas` recusa
 * variável vazia, e é melhor não mandar do que mandar "Olá , tudo bem?".
 */
export function primeiroNome(nome: string | null | undefined): string | null {
  const limpo = (nome ?? "").trim();
  if (!limpo) return null;

  // Lead cujo "nome" é o próprio telefone não vira saudação. Chamar alguém de
  // "5511" é pior que não chamar pelo nome.
  if (/^[\d\s()+-]+$/.test(limpo)) return null;

  return limpo.split(/\s+/)[0] ?? null;
}

/**
 * O texto que vai gravado na conversa junto com o modelo.
 *
 * A linha da conversa precisa dizer alguma coisa legível: uma bolha vazia na
 * tela do vendedor é pior que uma bolha que diz qual modelo saiu.
 */
export function resumoDoModelo(modelo: ModeloDeAbordagem): string {
  const vars = modelo.parametros.length ? ` (${modelo.parametros.join(" · ")})` : "";
  return `[modelo: ${modelo.nome}]${vars}`;
}

interface LeadParaAbordar {
  id: string;
  nome: string | null;
  whatsapp: string | null;
  optOutAt: Date | null;
  consentAt: Date | null;
  createdAt: Date;
  lastContactedAt: Date | null;
}

/**
 * Aborda UM lead com o modelo aprovado.
 *
 * `autorUserId` é obrigatório e não tem padrão: toda mensagem que sai em nome
 * da empresa tem um responsável, e "o sistema mandou" não é resposta para o dia
 * em que alguém perguntar quem falou com aquela pessoa.
 */
export async function abordarLead(
  db: Cliente,
  params: {
    leadId: string;
    /**
     * Quem responde por esta mensagem.
     *
     * ⚠️ Sem padrão, de propósito — a mesma razão que `entrega.ts` dá para
     * `quemMandou`: um padrão faria a chamada nova herdar "pessoa" por omissão,
     * e a declaração voltaria a depender de quem escreve o código lembrar dela.
     *
     * `SISTEMA` é a rodada automática. Ela **não** é anônima: o responsável
     * continua sendo uma pessoa — quem liberou o lote —, e é esse id que vem em
     * `autorUserId`. A promessa do cabeçalho original está mantida.
     */
    autor: "HUMANO" | "SISTEMA";
    autorUserId: string;
    agora?: Date;
  },
): Promise<ResultadoDaAbordagem> {
  const agora = params.agora ?? new Date();

  const lead = (await db.siteLead.findUnique({
    where: { id: params.leadId },
    select: {
      id: true, nome: true, whatsapp: true, optOutAt: true,
      consentAt: true, createdAt: true, lastContactedAt: true,
    },
  })) as LeadParaAbordar | null;

  if (!lead) {
    return { abordou: false, motivo: "leadNaoExiste", detalhe: params.leadId };
  }

  // Quantas vezes a Foocci já falou com esta pessoa. Contado de verdade — e por
  // isso `historicoConhecido: true` logo abaixo pode ser afirmado. Chutar zero
  // aqui e declarar o histórico como conhecido seria mentir para o portão.
  const tentativas = await db.leadMensagem.count({
    where: { leadId: lead.id, direcao: "SAIDA" },
  });

  // ── Trava 1: o portão do lead ──────────────────────────────────────────
  const decisao = avaliarContatoDeLead({
    telefone: lead.whatsapp,
    optOutAt: lead.optOutAt,
    // Quem preencheu o formulário consentiu no instante do envio. Sem
    // `consentAt`, `createdAt` é o instante do formulário — e nunca "hoje",
    // que transformaria um lead de três meses em consentimento fresco.
    consentimentoEm: lead.consentAt ?? lead.createdAt,
    tentativas,
    ultimoContatoEm: lead.lastContactedAt,
    historicoConhecido: true,
    canalPronto: canalDeVendasPronto(),
    agora,
  });

  if (!decisao.sendable) {
    return {
      abordou: false,
      motivo: "portaoRecusou",
      detalhe: `${decisao.reason ?? "sem motivo"}: ${decisao.detail ?? ""}`.trim(),
    };
  }

  // ── Trava 2: o freio de ritmo ──────────────────────────────────────────
  const ritmo = await conferirRitmo(db, agora);
  if (!ritmo.pode) {
    return { abordou: false, motivo: "ritmo", detalhe: ritmo.detalhe };
  }

  const cfg = modeloConfigurado();
  const nome = primeiroNome(lead.nome);
  const modelo: ModeloDeAbordagem = {
    nome: cfg.nome,
    idioma: cfg.idioma,
    parametros: nome ? [nome] : [],
  };

  // ── Trava 3: gravar antes de enviar ────────────────────────────────────
  const gravada = await registrarSaida(db, {
    leadId: lead.id,
    texto: resumoDoModelo(modelo),
    autor: params.autor,
    autorUserId: params.autorUserId,
    tipo: "TEMPLATE",
    templateNome: modelo.nome || null,
    agora,
  });

  if (!gravada.ok) {
    return { abordou: false, motivo: "naoConseguiuGravar", detalhe: gravada.causa };
  }

  // ── Trava 4: a entrega, com o resultado escrito na própria linha ───────
  const envio = await enviarModeloDeVendas(decisao, lead.whatsapp ?? "", modelo);

  if (!envio.ok) {
    await registrarFalhaDeEnvio(db, {
      mensagemId: gravada.mensagemId,
      erro: envio.error ?? "erro sem motivo",
    });
    return { abordou: false, motivo: "aMetaRecusou", detalhe: envio.error ?? "erro sem motivo" };
  }

  await confirmarEnvio(db, {
    mensagemId: gravada.mensagemId,
    waMessageId: `local:${gravada.mensagemId}`,
  });

  return { abordou: true, mensagemId: gravada.mensagemId };
}
