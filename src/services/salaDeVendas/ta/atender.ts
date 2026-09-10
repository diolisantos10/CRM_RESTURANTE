/**
 * A PONTE — do "oi" do cliente até o que o TA responde.
 *
 * ── O QUE FALTAVA, EXATAMENTE ───────────────────────────────────────────────
 *
 * As duas pontas existiam e não se encontravam:
 *
 *   · `FoocciSalesInbound` recebe o "oi", reconhece de quem é e registra —
 *     e diz, no próprio cabeçalho, que **não redige e não envia nada**;
 *   · o compositor da fala do TA existia, e nada o chamava.
 *
 * Este arquivo é a fiação entre os dois. Ele não inventa comportamento novo:
 * decide **se** o TA pode falar, chama quem compõe, e grava o que sairia.
 *
 * ── OS SETE PORTÕES, NESTA ORDEM ────────────────────────────────────────────
 *
 * A ordem é o desenho, e cada degrau existe por um motivo que já custou caro
 * em algum lugar:
 *
 *   1. **O TA está ligado?** `sdr_ia_config.ligado` é a chave mestra do CEO.
 *      Desligado, esta função para no primeiro `if` — e é assim que ela nasce.
 *   2. **O lead é da IA?** Se um humano assumiu, o TA **cala**. Falar por cima
 *      de quem assumiu é o defeito que faz o cliente receber duas respostas
 *      diferentes da mesma empresa no mesmo minuto.
 *   3. **A pessoa pediu silêncio?** `LeadContactSafety` decide, e a resposta
 *      dele é definitiva.
 *   4. **Estamos na janela de horário?** Robô que responde às 3 h da manhã
 *      denuncia que é robô — e a regra de horário existe antes disso.
 *   5. **Ele já insistiu demais?** `maxSemResposta` para sozinho. Sem este
 *      degrau, o TA vira perseguição automatizada.
 *   6. **Compor.** `falar()` decide: gatilho de gente é resolvido em código,
 *      antes do modelo; o resto o modelo redige, ancorado no Manual, e passa
 *      pelo verificador antes de existir. Chão determinístico se ele falhar.
 *   7. **Gravar.** A mensagem nasce PENDENTE, sempre.
 *   8. **Entregar, se o dono ligou a entrega.** Desligada, ela fica PENDENTE.
 *
 * ── A ENTREGA É OUTRA CHAVE, E ISSO NÃO É PROVISÓRIO ────────────────────────
 *
 * O que sai desta função é uma linha em `lead_mensagens`, que nasce PENDENTE.
 * Ela só vira uma mensagem no telefone de alguém se `FOOCCI_SDR_SEND_ENABLED`
 * estiver ligada — decisão do CEO, separada de "o TA está ligado".
 *
 * São duas chaves de propósito: **receber e pensar é seguro; falar com um
 * estranho em nome da empresa é outra coisa.** Uma mensagem PENDENTE que nunca
 * saiu é visível e corrigível; uma que saiu sem autorização não volta.
 *
 * ── E QUANDO É CASO DE GENTE ────────────────────────────────────────────────
 *
 * O TA não responde E chama gente ao mesmo tempo. Se o gatilho disparou, ele
 * diz que vai chamar alguém e **para** — o dossiê vai junto, pelo caminho já
 * provado de `passarParaGente`. Mandar a resposta de venda junto com o "vou
 * chamar alguém" é o que faz o lead responder à pergunta errada.
 *
 * Mas ele **diz**. O aviso de que alguém vem é gravado e entregue como qualquer
 * outra mensagem: passar o bastão em silêncio deixa quem pediu uma pessoa sem
 * resposta nenhuma — que é a pior resposta possível a um pedido.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { falar, type FalaFinal } from "./falar";
import { VERSAO_1 } from "./ficha";
import { registrarSaida } from "../conversa";
import { entregarMensagem } from "../entrega";
import { passarParaGente } from "../handoff";
import { iaAssumeSeEstaLivre } from "../responsavel";
import { pediuSilencio, foraDaJanela } from "@/services/foocci-sdr/LeadContactSafety";
import { consultarGerente } from "./consultarGerente";
import {
  atenderComOConector,
  type DependenciasDoConector,
  type ResultadoDoConector,
} from "@/services/connect/conector/atendimento";
import { ligacaoDoFoocci } from "@/services/connect/conector/foocci/ligacao";
import { traduzirAssuntos } from "@/services/connect/conector/foocci/traducao";
import type { ArmazemDePendencias } from "@/services/connect/conector/pendencias";
import { foraDaAlcadaNaMensagem } from "../precos";
import { extrairSinais, juntarSinais } from "./sondagem";
import { posturaDoLead } from "./oficio";
import {
  blocoDeConduta,
  blocoDeMemoria,
  gravarMemoria,
  lerIrritacao,
  lerMemoria,
  lerPedidoDeParar,
  type MemoriaDoLead,
} from "./memoria";
import { escreverOScore, type SinaisDoLead } from "../score";

/**
 * Aceita a transação além do cliente solto — igual a `conversa.ts` e
 * `handoff.ts`. O webhook chama esta função **dentro** de `comIdentidade`, que
 * abre transação para declarar o papel ao RLS; sem isto o tipo obrigaria a
 * escrever fora da identidade, que é onde a trava do banco não enxerga.
 */
type Cliente = PrismaClient | Prisma.TransactionClient;

/**
 * O aviso que sai quando quem parou o TA foi o gatilho de preço.
 *
 * Curto e fixo, pela mesma razão que a fala de handoff de `falar()` é curta e
 * fixa: quem pediu uma condição fora da tabela quer saber que alguém vai
 * responder, não quer uma última tentativa de contornar.
 *
 * ⚠️ E ele **não promete prazo**. "Volto ainda hoje" seria inventar um SLA que
 * não existe em lugar nenhum do sistema — e a mensagem de um agente é o pior
 * lugar do mundo para uma promessa que ninguém confere.
 */
export const AVISO_DE_QUE_VEM_GENTE =
  "Entendi o que você precisa. Isso aí é decisão que eu não posso tomar sozinho, " +
  "então já passei pro time com tudo o que você me contou — alguém vem falar com você.";

export type MotivoDeCalar =
  | "taDesligado"
  | "leadNaoEDaIA"
  | "pediuSilencio"
  | "foraDeHorario"
  | "insistiuDemais"
  | "leadNaoExiste"
  /** O gatilho de gente disparou e o handoff recusou. Ninguém fala. */
  | "handoffRecusado"
  /** Ele compôs e o banco não aceitou. A fala existiu e se perdeu. */
  | "naoConseguiuGravar"
  /** Alguma coisa quebrou no caminho. O turno morre calado, o webhook não. */
  | "quebrou";

export type ResultadoDoTurno =
  /**
   * Ele respondeu, e a mensagem está gravada.
   *
   * `entregue` diz se ela chegou a SAIR. Falso é o estado normal enquanto o dono
   * não ligar a entrega — e a distinção existe porque "o TA respondeu" e "o
   * cliente recebeu" são coisas diferentes que pareciam a mesma.
   *
   * ⚠️ `porPolitica: false` é escrito, e não omitido, para que as duas formas de
   * "ele falou" sejam separáveis em código — quem lê `resposta` precisa saber
   * que está no ramo em que ela existe.
   */
  | { falou: true; porPolitica: false; mensagemId: string; resposta: FalaFinal; entregue: boolean }
  /**
   * ⭐ PASSO 3: ele respondeu SOZINHO, por uma política que a empresa já tinha
   * decidido — e **não chamou ninguém**.
   *
   * É variante à parte, e não um campo a mais na de cima, porque o que saiu para
   * o cliente **não é** `resposta.texto`: é o texto da política, que veio do
   * núcleo. Enfiar as duas no mesmo formato faria a auditoria contar como fala
   * composta pelo modelo uma frase que o modelo não escreveu.
   */
  | {
      falou: true;
      porPolitica: true;
      politicaId: string;
      mensagemId: string | null;
      texto: string;
      entregue: boolean;
    }
  /** Ele parou e chamou gente. Não há resposta de venda a enviar. */
  | { falou: false; chamouGente: true; handoffId: string; motivo: string }
  /** Ele calou, e o motivo é sempre nomeado. */
  | { falou: false; chamouGente: false; motivo: MotivoDeCalar; detalhe: string };

export interface PedidoDeTurno {
  leadId: string;
  /**
   * O que o cliente escreveu — **já consolidado**.
   *
   * ⚠️ Desde 10/09/2026 isto não é mais "a mensagem que chegou no webhook": é
   * tudo o que ele escreveu desde a última vez que a empresa falou, junto e na
   * ordem do relógio (ver `agrupamento.ts`). Quem chama com uma linha só está
   * respondendo a um pedaço da frase — foi assim que o TA perguntou o tipo de
   * cozinha para quem tinha acabado de dizer "é padaria".
   */
  mensagem: string;
  agora?: Date;
  /**
   * O turno a que esta fala pertence, carimbado também nas entradas.
   *
   * Sem ele, duas respostas para a mesma sequência ficam indistinguíveis de duas
   * respostas para duas sequências — e o defeito de resposta dupla só se prova
   * corrigido no olho de quem lê a conversa.
   */
  turnoId?: string | null;
  /**
   * Injetável **só para o teste**. No caminho de produção nada disto é passado:
   * o `fetch` é o do runtime, o ambiente é o `process.env`, o armazém é a
   * tabela. Está aqui para que o passo 2 seja provável sem rede e sem Postgres.
   */
  conector?: DependenciasDoConector & { armazem?: ArmazemDePendencias };
}

/**
 * O TA atende um turno.
 *
 * **Nunca lança**, e a casca é aqui em cima de propósito. Quem chama esta função
 * é o webhook da Meta, e a Meta **reentrega o que falhou**: uma exceção não
 * perde uma resposta, ela vira laço — a mesma mensagem batendo na mesma falha
 * de minuto em minuto.
 *
 * O que a casca NÃO faz é engolir. A quebra volta nomeada, com a mensagem do
 * erro dentro, porque um `catch` que devolve silêncio é como um defeito vira
 * "o TA simplesmente não respondeu aquele cliente" — e ninguém acha.
 */
export async function atenderComOTA(
  db: Cliente,
  pedido: PedidoDeTurno,
): Promise<ResultadoDoTurno> {
  try {
    return await executarTurno(db, pedido);
  } catch (e) {
    return {
      falou: false,
      chamouGente: false,
      motivo: "quebrou",
      detalhe: `o turno quebrou: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

async function executarTurno(
  db: Cliente,
  pedido: PedidoDeTurno,
): Promise<ResultadoDoTurno> {
  const agora = pedido.agora ?? new Date();

  const calar = (motivo: MotivoDeCalar, detalhe: string): ResultadoDoTurno => ({
    falou: false,
    chamouGente: false,
    motivo,
    detalhe,
  });

  // ── 1. A chave mestra ───────────────────────────────────────────────────
  const config = await db.sdrIaConfig.findUnique({
    where: { slug: "ta" },
    select: {
      ligado: true,
      maxSemResposta: true,
      versaoAtivaId: true,
      horaInicio: true,
      horaFim: true,
    },
  });

  if (!config?.ligado) {
    return calar("taDesligado", "o TA está desligado — nada foi composto");
  }
  // Sem versão publicada o TA fica calado, e o schema já diz isso com essas
  // palavras. Ligado sem versão seria um agente sem identidade nem proibições.
  if (!config.versaoAtivaId) {
    return calar("taDesligado", "o TA está ligado mas não tem versão publicada");
  }

  const lead = await db.siteLead.findUnique({
    where: { id: pedido.leadId },
    // `atendenteUserId` entra porque a mensagem passou a ser assinada: quando a
    // IA já era dona do lead, quem assina é o agente que JÁ estava com ele — e
    // esse nome só existe aqui.
    select: {
      id: true,
      nome: true,
      atendidoPor: true,
      optOutAt: true,
      atendenteUserId: true,
      // A temperatura decide se quem fala é o sondador ou o closer. Sem ela na
      // consulta, o closer não existiria na prática: o ofício estaria escrito e
      // nunca vestido — o mesmo defeito de peça sem chamador que já apareceu
      // três vezes nesta base.
      temperatura: true,
    },
  });

  if (!lead) return calar("leadNaoExiste", `lead ${pedido.leadId} não existe`);

  // ── 2. O lead é da IA? ──────────────────────────────────────────────────
  //
  // `AGUARDANDO_HUMANO` também cala: o TA já pediu gente, e voltar a falar
  // desfaz o pedido dele mesmo na frente do cliente.
  if (lead.atendidoPor !== "NINGUEM" && lead.atendidoPor !== "IA") {
    return calar(
      "leadNaoEDaIA",
      `o lead está com ${lead.atendidoPor} — o TA não fala por cima de quem assumiu`,
    );
  }

  // ── 3. Pediu silêncio? ──────────────────────────────────────────────────
  //
  // ⚠️ Aqui NÃO se chama `avaliarContatoDeLead`, e a ausência é deliberada.
  // Aquele portão governa **abordar** um estranho: conta tentativas, exige 48h
  // de descanso, cobra consentimento de menos de 90 dias. Aplicá-lo a quem
  // acabou de escrever recusaria resposta a um cliente por "já foram duas
  // tentativas" — usar a proteção contra a pessoa que ela protege.
  //
  // Do portão vale uma regra só, e é a que atravessa os dois atos: silêncio
  // pedido. Ela vem de lá importada, nunca copiada.
  if (pediuSilencio(lead.optOutAt)) {
    return calar("pediuSilencio", "esta pessoa pediu para não receber mensagens");
  }

  // ── 4. Janela de horário ────────────────────────────────────────────────
  //
  // A janela vem da CONFIGURAÇÃO, não da constante do SDR de abordagem: a tela
  // do TA mostra `horaInicio`/`horaFim` como ajuste do dono, e um botão que o
  // código ignora ensina que a configuração vale quando ela não vale.
  //
  // ⚠️ Anotado e NÃO resolvido: quem escreve às 23 h está esperando resposta
  // agora, e calar pode ser pior que responder fora do horário. A janela foi
  // desenhada para proteger quem NÃO chamou. Soltar o TA da madrugada é decisão
  // do CEO, não minha — enquanto ela não vier, vale o horário configurado.
  if (foraDaJanela(agora, { inicioHora: config.horaInicio, fimHora: config.horaFim })) {
    return calar(
      "foraDeHorario",
      `fora da janela do TA (${config.horaInicio}h–${config.horaFim}h, dias úteis, horário de São Paulo)`,
    );
  }

  // ── 5. Insistiu demais? ─────────────────────────────────────────────────
  const semResposta = await db.leadMensagem.count({
    where: {
      leadId: lead.id,
      direcao: "SAIDA",
      ocorreuEm: { gt: await ultimaEntrada(db, lead.id) },
    },
  });

  if (semResposta >= config.maxSemResposta) {
    return calar(
      "insistiuDemais",
      `${semResposta} mensagens sem resposta, o limite é ${config.maxSemResposta}`,
    );
  }

  // ── 5b. A IA assume o lead, se ele não era de ninguém ───────────────────
  //
  // Todo lead nasce `NINGUEM` e cai na fila "Sem responsável". Enquanto o TA
  // respondia sem assumir, o lead aparecia como abandonado no exato momento em
  // que estava sendo atendido — e um humano entrava para salvar, dando ao
  // cliente duas vozes na mesma conversa.
  //
  // A escrita é condicional a `NINGUEM`: se alguém assumiu entre o portão 2 e
  // aqui, a IA não toma de volta. Não assumir não é falha — só quer dizer que o
  // lead já tem dono, e o portão 2 vai calar a IA no próximo turno.
  //
  // ── E QUEM ASSUME TEM NOME ────────────────────────────────────────────────
  //
  // Até 27/08/2026 a tomada gravava `atendenteUserId: null` — atendimento sem
  // dono. O CEO perguntou *"cadê o agente pra atender o lead?"* e a resposta
  // honesta era: existe e não atende ninguém. Agora ela escolhe um agente do
  // time (o mais livre) e o nome dele viaja daqui até a assinatura da mensagem.
  const tomada = await iaAssumeSeEstaLivre(db, { leadId: lead.id, agora });

  // ⚠️ Quem assina.
  //
  // Se a IA assumiu AGORA, assina o agente escolhido agora. Se ela já era dona
  // (o portão 2 deixou passar), assina QUEM JÁ ESTAVA com o lead — nunca um
  // agente novo. Trocar de agente no meio da conversa daria ao cliente duas
  // vozes com nomes diferentes, que é pior que uma voz sem nome.
  //
  // `null` quando o time ainda não existe no banco: a mensagem sai sem autor
  // nomeado, como antes. Melhor um atendimento sem nome do que nenhum — o
  // cliente já escreveu e está esperando.
  const assina = tomada.assumiu ? (tomada.agente?.userId ?? null) : lead.atendenteUserId;

  // ── 6. Compor ───────────────────────────────────────────────────────────
  //
  // `falar()` e não `responder()`: desde 26/08/2026 quem redige é um modelo,
  // com o determinístico como chão. A decisão de escalar continua sendo tomada
  // em código, ANTES do modelo — quem quer isso escrito está em `falar.ts`.
  const [jaPerguntou, historico, memoriaAnterior] = await Promise.all([
    perguntasJaFeitas(db, lead.id),
    conversaAteAqui(db, lead.id),
    lerMemoria(db, lead.id),
  ]);

  // ── ⭐ 5b. O QUE ELE ACABOU DE PEDIR, LIDO ANTES DE COMPOR ──────────────
  //
  // Gravado ANTES da composição, e não depois, e a ordem é o conserto: em
  // 09/09/2026 o lead escreveu "não quero mais responder perguntas" e recebeu
  // outra pergunta **no mesmo turno**. Ler isto depois de compor consertaria a
  // conversa a partir da mensagem seguinte — ou seja, tarde.
  const pediuParar = lerPedidoDeParar(pedido.mensagem);
  const irritacaoAgora = lerIrritacao(pedido.mensagem);

  if (pediuParar || irritacaoAgora > 0) {
    await gravarMemoria(
      db,
      lead.id,
      { pediuPararSondagem: pediuParar, irritacao: irritacaoAgora },
      agora,
    );
  }

  const memoria: MemoriaDoLead = {
    ...memoriaAnterior,
    pediuPararSondagem: memoriaAnterior.pediuPararSondagem || pediuParar,
    irritacao: Math.max(memoriaAnterior.irritacao, irritacaoAgora),
  };

  // A postura sai da temperatura que o qualificador escreveu no turno anterior.
  // QUENTE e PRIORIDADE_MAXIMA viram closer; o resto — MORNO, FRIO e sobretudo
  // `null`, que é "ninguém mediu" — continua sondando. Ver `posturaDoLead`.
  // ⭐ A POSTURA VIRA VARIÁVEL porque ela agora também é MÉTRICA. Ela decide o
  // ofício que entra no prompt e, desde 10/09/2026, é gravada em cada mensagem
  // como `papelDoAgente`. Sem gravar, o desempenho de "recepção", "qualificação"
  // e "closer" só poderia ser deduzido do estágio do lead — que muda DEPOIS da
  // mensagem, e portanto atribui a fala ao papel errado.
  const postura = posturaDoLead(lead.temperatura);
  const papelDoAgente = postura === "fechar" ? "closer" : "qualificacao";

  const r = await falar(
    {
      mensagem: pedido.mensagem,
      nome: lead.nome,
      jaPerguntou,
      historico,
      memoria: blocoDeMemoria(memoria),
      conduta: blocoDeConduta(memoria),
      // A trava do determinístico. O bloco de conduta acima avisa o modelo; esta
      // linha impede o chão de fazer a pergunta quando o modelo cair.
      pediuPararSondagem: memoria.pediuPararSondagem,
    },
    VERSAO_1,
    postura,
  );

  // ── ⭐ 6b. O GATILHO DE PREÇO GANHA CHAMADOR ────────────────────────────
  //
  // `motivoDeHandoffPorPreco` estava escrita, testada e **órfã**: nenhum caminho
  // de produção chegava até ela. Medido em 30/08/2026, e foi o quarto caso do
  // mesmo defeito no mesmo dia. Esta linha é o chamador que faltava.
  //
  // O elo que faltava não era a peça: era traduzir o texto do cliente em
  // assunto. `foraDaAlcadaNaMensagem` faz isso, em código e antes do modelo —
  // mesma doutrina de `falar.ts`: a decisão de escalar não é do modelo.
  //
  // ⚠️ Repare que ele escala por conta própria: mesmo que `falar()` não tenha
  // visto motivo nenhum, um assunto fora da alçada PARA o agente. Era esse o
  // buraco — uma mensagem que não usasse as palavras de `PEDE_PROPOSTA` mas
  // pedisse permuta passaria batida e o agente responderia por cima.
  const foraDaAlcada = foraDaAlcadaNaMensagem(pedido.mensagem);

  const deveChamarGente = (r.handoff.deve && r.handoff.motivo) || foraDaAlcada.length > 0;

  // ── 7a. É caso de gente: consulta o gerente, chama a fila, e PARA ───────
  if (deveChamarGente) {
    // O motivo enumerado. Quando quem disparou foi só o gatilho de preço, o
    // motivo é `PEDIU_PROPOSTA`: o lead pediu uma condição que a empresa precisa
    // decidir, que é o que essa etiqueta quer dizer na fila.
    const motivoExplicito = r.handoff.motivo ?? "PEDIU_PROPOSTA";

    // ── ⭐⭐ 7a-i. O CONECTOR PADRÃO — CONSULTA A POLÍTICA ANTES DE ESCALAR ─
    //
    // Este é o passo que o PR #178 não deu. Lá, todo assunto fora da alçada
    // subia ao gerente — **inclusive quando a empresa já tinha decidido aquilo
    // na semana passada**. O gerente virava pombo-correio da própria decisão,
    // uma vez por cliente.
    //
    // `atenderComOConector` faz, nesta ordem: consulta a política no núcleo; se
    // houver uma **válida** (viva, vigente, e que valha para ESTE cliente),
    // responde agora e não escala; não havendo, escala pelo caminho abaixo,
    // grava a pendência que faz a resposta voltar, e **avisa o cliente** de que
    // a decisão está pendente.
    //
    // ⛔ Nenhuma política é guardada aqui. A memória de decisão mora na Control
    // Room; este produto só pergunta, recebe e entrega.
    // ── ⭐ A TRADUÇÃO, ANTES DE QUALQUER COISA IR PARA O FIO ───────────────
    //
    // O núcleo tem vocabulário FECHADO de assuntos de decisão, e as palavras da
    // Sala não estão nele. Medido contra produção em 30/08/2026: **zero
    // interseção** — toda escalada real do Foocci morria em
    // `assunto_fora_do_vocabulario`, e o cliente ficava esperando um gerente
    // que nunca foi perguntado.
    //
    // ⚠️ Traduz-se só o que VAI NO FIO. A fila humana continua lendo as palavras
    // da Sala (`foraDaAlcada`, logo abaixo, no dossiê): quem pega a fila é gente
    // daqui, e "permuta" diz mais a ela do que `forma_de_pagamento_nao_padrao`.
    const traduzidos = traduzirAssuntos(foraDaAlcada);

    const conector =
      traduzidos.paraONucleo.length > 0
        ? await atenderComOConector(
            ligacaoDoFoocci(db, {
              assinaUserId: assina,
              armazem: pedido.conector?.armazem,
            }),
            {
              conversa: lead.id,
              // ⚠️ O id do lead, e nunca o telefone ou o e-mail. A pergunta que
              // sai daqui não carrega dado pessoal: o núcleo precisa saber QUEM
              // pergunta só para distinguir exceção de regra, e um identificador
              // opaco resolve isso inteiro.
              referenciaDoCliente: lead.id,
              assuntos: traduzidos.paraONucleo,
              pergunta: pedido.mensagem,
              agora,
            },
            // ── A ESCALADA É DO PRODUTO ───────────────────────────────────
            //
            // No Foocci ela é `consultarGerente`, pela porta do Dioli Connect,
            // com o caso do lead junto — o mesmo caminho provado no PR #178. O
            // conector não sabe o que é um lead; ele só precisa saber se abriu.
            async ({ protocolo, assuntos, politicaRecusada }) => {
              const r = await consultarGerente({
                protocolo,
                // ⭐ Os assuntos que vêm do conector — já no vocabulário da
                // casa. Usar a lista local aqui seria traduzir para a consulta
                // de política e mandar o nome de dentro no despacho: as duas
                // portas do núcleo leem o mesmo vocabulário fechado.
                foraDaAlcada: assuntos,
                caso: {
                  leadId: lead.id,
                  nome: lead.nome,
                  resumo: `O lead escreveu: "${pedido.mensagem}"`,
                  historico: (historico ?? []).map((t) => ({ deQuem: t.deQuem, texto: t.texto })),
                  // ⚠️ Quando existia decisão anterior e ela NÃO valia (revogada,
                  // exceção de outro cliente), isso vai escrito para o gerente.
                  // A pergunta que ele recebe é outra quando já houve resposta.
                  oQueTrava: [
                    foraDaAlcada.map((f) => `${f.assunto}: ${f.motivo}`).join(" | "),
                    politicaRecusada,
                  ]
                    .filter(Boolean)
                    .join(" || "),
                },
              });
              return r.consultado
                ? { aberta: true, fio: r.fio, detalhe: r.paraODossie }
                : { aberta: false, fio: null, detalhe: r.paraODossie };
            },
            pedido.conector,
          )
        : null;

    // ── ⭐ PASSO 3: havia política. O cliente já foi respondido, e ACABOU ───
    //
    // Sem escalada, sem fila, sem espera. É o caso que o CEO descreveu: "se
    // houver resposta válida, ele responde ao cliente IMEDIATAMENTE".
    if (conector?.respondeu) {
      return {
        falou: true,
        porPolitica: true,
        politicaId: conector.politicaId,
        mensagemId: conector.mensagemId,
        texto: conector.texto,
        entregue: conector.entregue,
      };
    }

    const consulta = resumoDaConsulta(conector, traduzidos.semTraducao);

    const h = await passarParaGente(db, {
      leadId: lead.id,
      motivoEscrito: r.porque,
      motivoExplicito,
      dossie: {
        // O resumo é o que `validarDossie` exige, e por um motivo prático:
        // quem pegar a fila lê ISTO antes de abrir a conversa. A frase literal
        // do cliente vale mais que qualquer paráfrase — é o que fez o TA parar.
        resumo: `O cliente escreveu: "${pedido.mensagem}"`,
        // ⭐ O que trava, e o que já foi feito a respeito. As duas coisas na
        // mesma frase de propósito: a fila precisa saber que existe uma consulta
        // em curso (ou que ela falhou) antes de decidir o que fazer.
        objecoes: consulta
          ? `${foraDaAlcada.map((f) => `${f.assunto}: ${f.motivo}`).join("\n")}\n\n${consulta.paraODossie}`
          : undefined,
        proximaAcao: "responder a esta mensagem — o TA parou e não respondeu nada",
      },
      agora,
    });

    if (h.ok) {
      // ── ⚠️ O CLIENTE PRECISA SABER QUE ALGUÉM VEM ────────────────────────
      //
      // Até 26/08/2026 o TA passava o bastão e voltava calado: o handoff era
      // registrado, o dono do lead mudava, a fila recebia o dossiê — e a pessoa
      // que acabou de escrever "quero falar com alguém" **não recebia nada**.
      //
      // Do lado de dentro tudo parecia certo. Do lado de fora era silêncio
      // depois de um pedido, que é a pior resposta possível a um pedido.
      //
      // A fala do handoff é gravada como qualquer outra mensagem e entregue
      // pelo mesmo caminho. Se falhar, o handoff CONTINUA valendo: o bastão já
      // passou, e desfazê-lo por causa da mensagem deixaria o lead sem ninguém.
      //
      // ── ⚠️ E O TEXTO NÃO PODE SER A FALA DE VENDA ────────────────────────
      //
      // Quando quem disparou foi SÓ o gatilho de preço, `falar()` não sabia que
      // ia haver handoff: `r.texto` é a resposta comercial que ele compôs. Mandá-la
      // aqui daria ao cliente uma resposta de venda logo depois de ele ter
      // pedido uma condição que a empresa não decidiu — e ele responderia à
      // pergunta errada, exatamente o que o cabeçalho deste arquivo proíbe.
      //
      // Nesse caso o texto é o aviso determinístico, curto e verdadeiro.
      //
      // ── ⭐ E UMA VOZ SÓ, QUANDO O CONECTOR JÁ FALOU ──────────────────────
      //
      // O conector avisa o cliente de que a decisão está pendente, e esse aviso
      // diz a mesma coisa que este: *alguém vai responder, você não precisa
      // cobrar*. Mandar os dois seguidos entregaria duas frases quase iguais no
      // mesmo minuto, e a segunda faria o agente parecer travado.
      //
      // ⚠️ A escolha é pular ESTE, e não o do conector: o do conector é o que
      // corresponde a uma consulta REGISTRADA, com protocolo e conversa de
      // volta. Este aqui é o chão de quando não houve consulta nenhuma.
      if (!oConectorJaAvisou(conector)) {
        const texto = r.handoff.deve ? r.texto : AVISO_DE_QUE_VEM_GENTE;

        const avisoGravado = await registrarSaida(db, {
          leadId: lead.id,
          texto,
          autor: "IA",
          // Assina igual à fala de venda: o cliente acabou de conversar com
          // "Agente Maria" e o aviso de que vem gente não pode chegar anônimo.
          autorUserId: assina,
          agora,
          turnoId: pedido.turnoId ?? null,
          // O aviso de handoff não é venda: é o agente parando. Marcado como
          // `recepcao` para não inflar a métrica do papel que estava vendendo.
          papelDoAgente: "recepcao",
          origemDaFala: r.origem,
        });

        // "maquina": ninguém leu este aviso antes de ele sair. Quem decide se
        // ele pode sair é `FOOCCI_SDR_IA_RESPONDE_SOZINHA`, não esta linha.
        if (avisoGravado.ok) {
          const entregaDoAviso = await entregarMensagem(db, avisoGravado.mensagemId, "maquina");

          /**
           * ⚠️ O RETORNO DESTA LINHA ERA JOGADO FORA — e era a falha muda mais
           * cara da Sala.
           *
           * Aqui é o pedido de gente: o lead pediu uma pessoa, pediu desconto ou
           * ficou bravo. O TA para de vender de propósito e manda UMA coisa —
           * "alguém já vem". Se essa única mensagem não sai, acontece o pior
           * arranjo possível: o lead fica em silêncio absoluto, e o sistema
           * registra o handoff como se tivesse dado certo. Ninguém no funil vê
           * diferença entre "avisado e esperando" e "abandonado sem saber".
           *
           * O turno NÃO falha por causa disto, e é deliberado: a mensagem está
           * gravada, aparece na tela e o motivo fica na própria linha. Derrubar o
           * turno faria a Meta reentregar a fala do cliente e o TA responder duas
           * vezes — a mesma razão dada na entrega da resposta de venda, abaixo.
           *
           * O que muda é que agora ele GRITA, com o caso concreto junto
           * (guardrail 6): alerta que diz "algo falhou" sem o lead e sem o motivo
           * é ruído que ninguém investiga.
           */
          if (!entregaDoAviso.entregue) {
            console.error("[ta] o aviso de que vem gente NÃO chegou ao lead", {
              leadId: lead.id,
              handoffId: h.handoffId,
              mensagemId: avisoGravado.mensagemId,
              motivo: entregaDoAviso.motivo,
              detalhe: entregaDoAviso.detalhe,
            });
          }
        }
      }

      return { falou: false, chamouGente: true, handoffId: h.handoffId, motivo: h.motivo };
    }

    // O handoff recusou. As duas saídas erradas: responder com a fala de venda
    // (ignora o gatilho que disparou) ou calar mentindo o motivo. Fica o motivo
    // verdadeiro, nomeado, e o lead segue com a IA para a próxima tentativa —
    // `passarParaGente` só troca o dono depois de validar, então nada ficou
    // pela metade.
    return calar("handoffRecusado", `o handoff recusou: ${h.causa}`);
  }

  // ── 7b. Grava o que ele diria. PENDENTE, sempre ─────────────────────────
  const gravada = await registrarSaida(db, {
    leadId: lead.id,
    // IA, e não SISTEMA: `SISTEMA` é cadência e template operacional, coisa que
    // ninguém redigiu. Isto aqui é fala composta, e a auditoria precisa poder
    // separar "o robô escreveu" de "a máquina disparou o passo 2".
    autor: "IA",
    // ⚠️ `autor: "IA"` E `autorUserId` juntos, de propósito. O primeiro diz O QUE
    // falou (robô, não pessoa) e o segundo diz QUEM (Agente Maria). A auditoria
    // precisa dos dois: sem o primeiro, um dia alguém conta fala de robô como
    // produtividade de gente; sem o segundo, a conversa não tem nome.
    autorUserId: assina,
    texto: r.texto,
    agora,
    turnoId: pedido.turnoId ?? null,
    papelDoAgente,
    origemDaFala: r.origem,
  });

  if (!gravada.ok) {
    // Só acontece se o texto vier vazio — `responder()` promete que não vem,
    // mas a promessa mora em outro arquivo. Sem este ramo, uma quebra lá viraria
    // um `undefined` silencioso no id da mensagem.
    return calar("naoConseguiuGravar", `a mensagem não foi gravada: ${gravada.causa}`);
  }

  // ── 8. Entregar, SE o dono ligou a entrega ──────────────────────────────
  //
  // Desligada, `entregarMensagem` não faz nada e a mensagem continua PENDENTE —
  // que é o estado de hoje e continua sendo o padrão. A chave é do CEO.
  //
  // ⛔ **"maquina", e é ESTA a linha mais perigosa do arquivo.** Aqui a IA
  // responde a um estranho no WhatsApp sem que ninguém tenha lido antes. Até
  // 07/09/2026 ela dependia da MESMA chave que liberava o vendedor a mandar o
  // que acabou de digitar — duas coisas de tamanhos muito diferentes atrás de
  // um interruptor só. Agora esta exige `FOOCCI_SDR_IA_RESPONDE_SOZINHA`.
  //
  // ⚠️ A falha de entrega NÃO derruba o turno. A mensagem já está gravada, e o
  // que se perde é a saída — recuperável, visível na tela, e com o motivo
  // guardado na própria linha. Transformar isso em erro faria a Meta reentregar
  // o "oi" do cliente e o TA responder duas vezes.
  const entrega = await entregarMensagem(db, gravada.mensagemId, "maquina");

  // ── 9. Qualificar: ouvir o que ele disse e etiquetar ────────────────────
  //
  // ⚠️ **DEPOIS de entregar, e nunca antes.** Qualificar chama o modelo de
  // novo, e o cliente já está esperando desde o portão 1. Pôr isto antes da
  // entrega somaria a espera da extração à espera da composição — e a única
  // coisa que o cliente percebe é o tempo até a resposta chegar.
  //
  // Foi o buraco que o CEO destampou em 27/08/2026 perguntando *"você já fez
  // teste com esse qualificador?"*: a régua de temperatura existia, testada, e
  // NINGUÉM a chamava. O agente perguntava "quantas unidades?", a pessoa
  // respondia "três", e a resposta morria na conversa. Todo lead sem etiqueta,
  // e a fila do closer vazia para sempre.
  await qualificar(db, { leadId: lead.id, mensagem: pedido.mensagem, agora });

  return {
    falou: true,
    porPolitica: false,
    mensagemId: gravada.mensagemId,
    resposta: r,
    entregue: entrega.entregue,
  };
}

/**
 * O que o dossiê da fila precisa saber sobre a consulta — ou `null` quando não
 * houve consulta nenhuma (nenhum assunto fora da alçada disparou).
 *
 * ⚠️ A frase vale nos dois desfechos, e é de propósito: um dossiê que não diz se
 * o gerente foi acionado faz a pessoa da fila acionar de novo, ou pior, achar
 * que já foi.
 */
function resumoDaConsulta(
  conector: ResultadoDoConector | null,
  semTraducao: string[],
): { paraODossie: string } | null {
  // ⚠️ O que não tem par no vocabulário fechado da casa **não some**. Sai
  // nomeado no dossiê, porque a diferença entre "o gerente não respondeu ainda"
  // e "esta parte nem chegou a ser perguntada" é a diferença entre esperar e
  // agir — e quem pega a fila é a única pessoa que pode agir.
  const naoPerguntado =
    semTraducao.length > 0
      ? ` ⚠️ Estes assuntos NÃO foram perguntados ao gerente porque não têm par no vocabulário de ` +
        `decisão da casa: ${semTraducao.join(", ")}. Quem pegar esta fila decide isso aqui dentro, ou ` +
        "pede ao Diretor Geral que o vocabulário ganhe o assunto."
      : "";

  if (!conector) {
    return naoPerguntado ? { paraODossie: naoPerguntado.trim() } : null;
  }
  return { paraODossie: `${conector.paraORastro}${naoPerguntado}` };
}

/** O conector já avisou o cliente de que a decisão está pendente? */
function oConectorJaAvisou(conector: ResultadoDoConector | null): boolean {
  return !!conector && !conector.respondeu && conector.escalou && conector.avisouOCliente;
}

/**
 * Ouve a conversa, junta com o que já se sabia, e grava a etiqueta.
 *
 * **Nunca lança, e nunca devolve nada.** O turno já terminou quando ela roda: a
 * mensagem foi composta, gravada e entregue. Uma falha aqui não pode desfazer
 * nada disso — o pior que acontece é o lead ficar mais um turno sem etiqueta, e
 * o próximo turno tenta de novo com a conversa maior.
 */
async function qualificar(
  db: Cliente,
  p: { leadId: string; mensagem: string; agora: Date },
): Promise<void> {
  try {
    // ⚠️ A conversa INTEIRA, e não a janela de 12 que a composição usa.
    //
    // Compor precisa do contexto recente; qualificar precisa de TUDO. Se a
    // extração enxergasse só as últimas 12 mensagens, o "tenho 3 lojas" dito no
    // começo cairia fora da janela numa conversa longa — e o score baixaria
    // sozinho, sem ninguém ter dito nada novo.
    //
    // Custa uma consulta a mais e resolve, sem coluna nova no banco: a conversa
    // já É o registro dos fatos.
    const msgs = await db.leadMensagem.findMany({
      where: { leadId: p.leadId, texto: { not: null } },
      orderBy: { ocorreuEm: "asc" },
      select: { direcao: true, texto: true },
    });

    const conversa = msgs.map((m) => ({
      deQuem: m.direcao === "ENTRADA" ? ("cliente" as const) : ("ta" as const),
      texto: m.texto ?? "",
    }));

    const daConversa = await extrairSinais(conversa, p.mensagem);

    // ── O QUE O FORMULÁRIO JÁ TINHA PERGUNTADO ────────────────────────────
    //
    // A pessoa preencheu tipo de restaurante e principal desafio antes de
    // escrever. Ignorar isso faria o agente perguntar de novo o que ela já
    // respondeu — e é o defeito que mais rápido faz alguém desistir.
    const ficha = await db.siteLead.findUnique({
      where: { id: p.leadId },
      select: { tipo: true, desafio: true },
    });

    const doFormulario: SinaisDoLead = {
      dorPrincipal: ficha?.desafio?.trim() || null,
      // Tipo preenchido no formulário do site é declaração de que É restaurante.
      // `null` quando vazio: ausência não vira `false`, que desqualificaria.
      ehRestaurante: ficha?.tipo?.trim() ? true : null,
    };

    // Engajamento observado, não declarado: quem escreveu três vezes está mais
    // quente que quem mandou "oi" e sumiu — e isso ninguém precisa perguntar.
    const mensagensDoLead = conversa.filter((t) => t.deQuem === "cliente").length;

    // A conversa vence o formulário: um menu suspenso é o que a pessoa achou
    // que era o problema dela antes de conversar. `juntarSinais` mantém o
    // primeiro argumento e usa o segundo só para preencher buraco.
    const sinais = juntarSinais({ ...daConversa, mensagensDoLead }, doFormulario);

    await escreverOScore(db, { leadId: p.leadId, sinais, agora: p.agora });
  } catch {
    // Modelo fora do ar, banco recusando a escrita, JSON estranho. Nada disso
    // pode transformar um atendimento que deu certo em turno quebrado.
  }
}

/** O instante da última coisa que o cliente escreveu. Epoch quando nunca. */
async function ultimaEntrada(db: Cliente, leadId: string): Promise<Date> {
  const m = await db.leadMensagem.findFirst({
    where: { leadId, direcao: "ENTRADA" },
    orderBy: { ocorreuEm: "desc" },
    select: { ocorreuEm: true },
  });
  return m?.ocorreuEm ?? new Date(0);
}

/**
 * Quais perguntas da sondagem já foram feitas.
 *
 * Derivado das mensagens que já saíram, e não de um contador guardado: um
 * contador se dessincroniza no dia em que uma mensagem é apagada, e aí o TA
 * repete uma pergunta que a pessoa já respondeu — que é a coisa que mais
 * denuncia um robô numa conversa.
 */
async function perguntasJaFeitas(db: Cliente, leadId: string): Promise<number[]> {
  const saidas = await db.leadMensagem.findMany({
    where: { leadId, direcao: "SAIDA" },
    select: { texto: true },
  });

  const ditas = saidas.map((s) => s.texto ?? "");
  return VERSAO_1.perguntas
    .map((p, i) => (ditas.some((t) => t.includes(p)) ? i : -1))
    .filter((i) => i >= 0);
}

/**
 * Os últimos turnos da conversa, do mais antigo para o mais novo.
 *
 * ── POR QUE ISTO É PARTE DO PRODUTO, E NÃO UM LUXO ──────────────────────────
 *
 * Sem histórico o TA cumprimenta a mesma pessoa três vezes, pergunta de novo o
 * que ela acabou de responder, e responde "quanto custa?" como se fosse a
 * primeira mensagem do dia. É a diferença exata entre uma conversa e uma
 * sequência de respostas soltas — e é o que qualquer pessoa reconhece como robô
 * em dois turnos.
 *
 * Doze mensagens, e não a conversa inteira: uma conversa longa estouraria o
 * contexto do modelo com o assunto de três dias atrás, e o que decide o turno
 * de agora são os últimos minutos.
 */
async function conversaAteAqui(
  db: Cliente,
  leadId: string,
): Promise<Array<{ deQuem: "cliente" | "ta"; texto: string }>> {
  const msgs = await db.leadMensagem.findMany({
    where: { leadId, texto: { not: null } },
    orderBy: { ocorreuEm: "desc" },
    take: 12,
    select: { direcao: true, texto: true },
  });

  return msgs
    .reverse()
    .map((m) => ({
      deQuem: m.direcao === "ENTRADA" ? ("cliente" as const) : ("ta" as const),
      texto: m.texto ?? "",
    }))
    .filter((t) => t.texto.trim().length > 0);
}
