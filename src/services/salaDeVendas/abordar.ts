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
import {
  avaliarContatoDeLead,
  avaliarAbordagemDeProspeccao,
  recusaDeProspeccao,
  REGRA,
  type LeadSafetyDecision,
} from "@/services/foocci-sdr/LeadContactSafety";
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
 * ⭐ A SAUDAÇÃO DO MODELO — e por que ela não é `primeiroNome` para todo mundo.
 *
 * ── O DEFEITO QUE ISTO EVITA, medido no arquivo de 4.880 contatos ───────────
 *
 * A lista de prospecção é de ESTABELECIMENTOS, não de pessoas. A coluna "Nome"
 * traz `.it Pizza`, `100% Espetos`, `Bar do Zé`. Cortar no primeiro espaço, que
 * é o certo para gente, produz:
 *
 *     "Olá .it"        "Olá 100%"        "Olá Bar"
 *
 * Isso é pior que não saudar: parece defeito, porque é. E a lista tem 4.880.
 *
 * ── COMO A DECISÃO É TOMADA SEM ADIVINHAR ───────────────────────────────────
 *
 * Não por heurística de texto ("parece nome de empresa?"), que erraria em
 * "Marina Gambarini Restaurante" e em "Zé". Pela PROVENIÊNCIA, que o dado já
 * carrega: `fonte = LISTA_PROSPECCAO` é uma lista de negócios; um lead do
 * formulário do site é uma pessoa que digitou o próprio nome.
 *
 * O guarda contra telefone-como-nome continua valendo nos dois casos.
 */
export function saudacaoDoLead(lead: {
  nome: string | null;
  restaurante: string | null;
  fonte: string | null;
}): string | null {
  if (lead.fonte === "LISTA_PROSPECCAO") {
    // O estabelecimento inteiro. `restaurante` primeiro porque é o campo
    // dedicado; `nome` cobre a lista cuja coluna se chamava "Nome" e trazia o
    // estabelecimento — que é exatamente o arquivo de São Paulo.
    const bruto = (lead.restaurante ?? lead.nome ?? "").trim();
    if (!bruto) return null;
    if (/^[\d\s()+-]+$/.test(bruto)) return null;
    return bruto;
  }

  return primeiroNome(lead.nome);
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
  restaurante: string | null;
  fonte: string | null;
}

/**
 * A fonte que diz que este lead veio de uma lista fria. Uma constante porque a
 * string aparece em três arquivos e um erro de digitação aqui manda o lead para
 * o portão errado — em silêncio, e para o lado permissivo se fosse ao contrário.
 */
export const FONTE_DE_LISTA = "LISTA_PROSPECCAO";

/**
 * ⭐⭐ QUAL PORTÃO ESTE LEAD ATRAVESSA — decisão do Diretor Geral, 08/09/2026.
 *
 * ── O DEFEITO QUE ISTO CONSERTA, medido na primeira rodada real ─────────────
 *
 * A fila consultava `avaliarAbordagemDeProspeccao` (o **frio**) e o envio
 * consultava `avaliarContatoDeLead` (o **morno**). Dez itens saíam liberados da
 * fila e os dez eram barrados no envio — `portaoRecusou: 10`, com o token ainda
 * por cima.
 *
 * Os dois portões respondem perguntas diferentes **de propósito**:
 *
 *   · frio  — *"quem mandou abordar declarou por que temos este contato?"*
 *   · morno — *"esta pessoa entregou os dados, e há quanto tempo?"*
 *
 * Perguntar a segunda a quem nunca preencheu formulário nenhum não é rigor: é a
 * pergunta errada. E ela vinha sendo respondida com uma mentira — ver a trava 2
 * em `abordarLead`.
 *
 * ── ⚠️ ORIGEM DESCONHECIDA CAI NO MAIS RESTRITIVO ──────────────────────────
 *
 * `fonte` nula, vazia ou qualquer valor que não seja `LISTA_PROSPECCAO` vai para
 * o **morno**. A escolha é deliberada e é a única segura: se um dia alguém criar
 * uma fonte nova e esquecer de classificá-la, o erro tem de ser *"não falamos
 * com quem podíamos"*, nunca *"falamos com quem não podíamos"*.
 *
 * ── E O QUE NÃO MUDA EM NENHUM DOS DOIS ─────────────────────────────────────
 *
 * Silêncio pedido (opt-out) é a regra 1 dos dois portões, terminal e
 * inviolável. O **teto do dia** também vale igual, e vale por fora: ele é a
 * trava 2 de `abordarLead` (`conferirRitmo`), que roda depois do portão,
 * qualquer que tenha sido o portão.
 */
type PortaoDoLead =
  | { portao: "morno" }
  | { portao: "frio"; baseLegal: string; prospeccaoLiberada: boolean; descansoHoras: number }
  | { portao: "recusado"; decisao: LeadSafetyDecision };

async function escolherPortaoDoLead(
  db: Cliente,
  lead: { id: string; fonte: string | null },
): Promise<PortaoDoLead> {
  if (lead.fonte !== FONTE_DE_LISTA) return { portao: "morno" };

  // O lote é quem declara a base legal. Sem ele, não há o que declarar.
  const item = await db.itemDeProspeccao.findFirst({
    where: { leadId: lead.id },
    orderBy: { criadoEm: "desc" },
    select: { lote: { select: { situacao: true, proveniencia: true } } },
  });

  if (!item) {
    return {
      portao: "recusado",
      decisao: recusaDeProspeccao(
        "PROSPECCAO_SEM_BASE_LEGAL",
        "O lead diz vir de lista, e não há lote que o autorize — sem isso não se aborda ninguém.",
      ),
    };
  }
  if (item.lote.situacao !== "LIBERADO") {
    return {
      portao: "recusado",
      decisao: recusaDeProspeccao(
        "PROSPECCAO_DESLIGADA",
        `O lote deste contato está em ${item.lote.situacao}, não LIBERADO.`,
      ),
    };
  }

  const config = await db.prospeccaoConfig.findUnique({ where: { id: "singleton" } });

  return {
    portao: "frio",
    baseLegal: item.lote.proveniencia ?? "",
    // Mesma leitura da fila: sem configuração a resposta é "desligada", nunca
    // "sem limite". O teto do dia em si é a trava 2, e não esta.
    prospeccaoLiberada: Boolean(config?.outboundLigado) && !config?.pausadoEm,
    // ── O CONFIGURÁVEL SÓ APERTA, NUNCA AFROUXA ── idêntico à fila, e de
    // propósito: se as duas leituras divergirem, a que manda é a que vier por
    // último — e seria esta, no caminho que fala com estranhos.
    descansoHoras: Math.max(REGRA.descansoHoras, config?.horasEntreAbordagens ?? REGRA.descansoHoras),
  };
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
      restaurante: true, fonte: true,
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

  // ── Trava 1: o portão do lead, ESCOLHIDO PELA ORIGEM ───────────────────
  const escolha = await escolherPortaoDoLead(db, lead);

  const decisao =
    escolha.portao === "recusado"
      ? escolha.decisao
      : escolha.portao === "frio"
        ? avaliarAbordagemDeProspeccao({
            telefone: lead.whatsapp,
            optOutAt: lead.optOutAt,
            tentativas,
            ultimoContatoEm: lead.lastContactedAt,
            historicoConhecido: true,
            canalPronto: canalDeVendasPronto(),
            prospeccaoLiberada: escolha.prospeccaoLiberada,
            baseLegalDeclarada: escolha.baseLegal,
            descansoHoras: escolha.descansoHoras,
            agora,
          })
        : avaliarContatoDeLead({
            telefone: lead.whatsapp,
            optOutAt: lead.optOutAt,
            /**
             * ⚠️ SEM `?? lead.createdAt`, e a remoção é o coração desta mudança.
             *
             * Esta linha era `lead.consentAt ?? lead.createdAt`, com um
             * comentário dizendo que `createdAt` "é o instante do formulário".
             * **Para um lead que veio de formulário, é.** Para um lead que a
             * própria casa acabou de materializar de uma lista fria, `createdAt`
             * é o instante em que **NÓS** criamos a ficha — e o portão o lia
             * como consentimento fresquíssimo, liberando por zero dias de idade.
             *
             * Era exatamente a mentira que o portão frio foi construído para
             * não contar: *"registraria como consentimento da pessoa um ato da
             * empresa"*. Ela entrava aqui, calada, pela porta dos fundos.
             *
             * Agora `consentAt` nulo é `CONSENTIMENTO_DESCONHECIDO` — bloqueio,
             * não presunção. É mais restritivo de propósito: lead sem registro
             * de quando entregou os dados **não** é abordado por este portão.
             */
            consentimentoEm: lead.consentAt,
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
  //
  // ⭐ O TETO DO DIA VALE NOS DOIS PORTÕES, e é por isso que ele mora AQUI e não
  // dentro de nenhum deles: qualquer que tenha sido o portão, a mensagem ainda
  // passa por este freio antes de sair. Colocá-lo dentro dos portões criaria
  // duas contagens do mesmo teto — e duas contagens do mesmo teto é como se
  // manda o dobro sem ninguém perceber.
  const ritmo = await conferirRitmo(db, agora);
  if (!ritmo.pode) {
    return { abordou: false, motivo: "ritmo", detalhe: ritmo.detalhe };
  }

  const cfg = modeloConfigurado();
  const nome = saudacaoDoLead(lead);
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
