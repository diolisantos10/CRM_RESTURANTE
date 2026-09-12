/**
 * FoocciSalesInbound — o que acontece quando alguém escreve no número de VENDAS.
 *
 * ── O buraco que isto tapa, e ele é o buraco principal ───────────────────────
 * O webhook da Meta mapeia `phone_number_id` → restaurante
 * (`src/app/api/webhooks/meta/whatsapp/route.ts:167`). Quando não bate nenhum, a
 * mensagem é registrada num `console.warn` e **descartada**. O número de vendas da
 * Foocci não tem restaurante — ou seja: no dia em que o CEO ligar o número, o
 * "oi" que o site pediu para a pessoa mandar chegaria e sumiria, com um aviso que
 * ninguém lê. O site inteiro já está pronto para mandar esse "oi"
 * (`src/components/marketing/config.ts`), e não havia ninguém do outro lado.
 *
 * ── O que este módulo faz, e o que ele DELIBERADAMENTE não faz ───────────────
 * FAZ: reconhece de quem é o "oi" (pelo `#código` do formulário, ou pelo
 * telefone), cria o contato quando ele não existe, aplica pedido de silêncio e
 * registra a entrada na linha do tempo do lead.
 *
 * NÃO ENVIA NADA. Nunca enviou e continua não enviando: quem entrega é o canal,
 * e o canal só entrega com `FOOCCI_SDR_SEND_ENABLED` ligada pelo CEO.
 *
 * ⚠️ MUDOU EM 25/08/2026 — antes este cabeçalho dizia "não redige". Passou a
 * redigir. A recepção agora chama o TA (`salaDeVendas/ta/atender.ts`) depois de
 * gravar a entrada, e o que ele compõe fica em `lead_mensagens` como PENDENTE.
 *
 * A separação que continua valendo — e é a que importa — não é entre "anotar" e
 * "redigir": é entre **pensar** e **falar**. Receber, entender e compor não
 * chegam a ninguém de fora. Entregar é outro ato, com outra chave, e essa chave
 * não está aqui.
 *
 * O TA decide sozinho se pode falar: são sete portões dentro dele, e o primeiro
 * é a chave mestra do CEO. Este módulo não repete nenhum deles — repetir portão
 * é o jeito de acabar com duas versões da mesma regra e uma delas desatualizada.
 *
 * ⚠️ E NÃO TOCA em `Customer`, `Conversation` nem `Message`: quem escreve no
 * número de vendas é um dono de restaurante interessado no Foocci, não cliente de
 * restaurante nenhum. Misturar as duas bases colocaria prospecto dentro da
 * Central de Conversas de algum lojista.
 */

import { prisma } from "@/lib/prisma";
import { extractLeadCode } from "@/lib/site/leadCode";
import { detectOptOutIntent } from "@/services/crm/ContactSafetyService";
import { analisarWhatsappBr } from "@/lib/whatsapp-br";
import { normalizaWhatsapp } from "@/services/foocci-crm/leadOrigin";
import { registrarEntrada } from "@/services/salaDeVendas/conversa";
import { comIdentidade, comoSistema } from "@/services/salaDeVendas/identidadeNoBanco";
import { atenderComOTA, type ResultadoDoTurno } from "@/services/salaDeVendas/ta/atender";
import { comATravaDaConversa } from "@/services/salaDeVendas/travaDaConversa";
import {
  carimbarTurno,
  chegouEntradaDepois,
  esperar,
  janelaDeAgrupamento,
  juntarEntradasDoTurno,
} from "@/services/salaDeVendas/ta/agrupamento";
import type { TipoDaMensagem } from "@prisma/client";

// ─── A parte pura ───────────────────────────────────────────────────────────────

export interface LeituraDaMensagem {
  /** O `#A7K2M` que o formulário colocou na mensagem, quando veio. */
  codigo: string | null;
  /** A pessoa está pedindo para parar de receber. */
  pedeSilencio: boolean;
  /** Tem texto de verdade (não é só figurinha, áudio ou anexo). */
  temTexto: boolean;
}

/**
 * Lê a mensagem sem tocar em banco. Separada para caber em teste sem mock, e
 * porque é ela que carrega as duas decisões que mudam tudo: quem é a pessoa e se
 * ela quer silêncio.
 */
export function interpretarMensagemDeVendas(text: string | null | undefined): LeituraDaMensagem {
  const t = (text ?? "").trim();
  return {
    codigo: t ? extractLeadCode(t) : null,
    pedeSilencio: detectOptOutIntent(t),
    temTexto: t.length > 0,
  };
}

// ─── O resultado ────────────────────────────────────────────────────────────────

export type EntradaDeVendasStatus =
  /** Contato reconhecido pelo `#código` da mensagem — o caminho feliz. */
  | "RECONHECIDO_POR_CODIGO"
  /** Reconhecido pelo telefone (mensagem sem código, ou código perdido). */
  | "RECONHECIDO_POR_TELEFONE"
  /** Ninguém conhecido: contato novo, criado como WHATSAPP_DIRETO. */
  | "CONTATO_NOVO"
  /** Pediu silêncio. Registrado; nada mais será enviado, nunca. */
  | "PEDIU_SILENCIO"
  /** Não deu para gravar. Nunca vira sucesso silencioso (guardrail 1). */
  | "FALHOU";

export interface EntradaDeVendas {
  status: EntradaDeVendasStatus;
  leadId: string | null;
  codigo: string | null;
  /** Frase curta com o caso concreto, para o log (guardrail 6). */
  detalhe: string;
  /**
   * O que o TA fez com este "oi", quando chegou a ser chamado.
   *
   * Ausente = ele não foi consultado (pedido de silêncio, mensagem sem texto,
   * reentrega confirmada da Meta, ou falha antes disso). **Presente e calado é
   * diferente de ausente**, e a diferença é o que permite responder "por que
   * o TA não respondeu aquele cliente?" sem abrir o banco.
   */
  ta?: ResultadoDoTurno;
}

// ─── O recepcionista ────────────────────────────────────────────────────────────

export interface MensagemDeVendas {
  /** `wa_id` de quem escreveu — o número que a Meta devolveria numa resposta. */
  fromPhone: string;
  text: string | null;
  /** Nome do perfil do WhatsApp, quando a Meta manda. */
  profileName?: string | null;
  agora?: Date;

  // ── A CONVERSA (Sala de Vendas, 25/08/2026) ───────────────────────────────
  //
  // Até aqui este módulo registrava que a pessoa escreveu, sem guardar O QUE
  // ela escreveu: a linha do tempo dizia "Escreveu no WhatsApp de vendas" e a
  // mensagem morria no log do webhook. Servia para o SDR saber que havia
  // movimento; não servia para ninguém ATENDER — a tela de atendimento
  // precisava abrir a conversa, e não havia conversa.
  //
  // Os campos abaixo são opcionais para o módulo continuar funcionando para
  // quem já o chamava. Sem `waMessageId` a mensagem não é gravada, porque sem
  // ele não há como impedir que a reentrega da Meta duplique a conversa.
  /** `id` da mensagem na Meta. É a chave da idempotência. */
  waMessageId?: string | null;
  tipo?: TipoDaMensagem;
  /** Tipo cru do provedor quando não sabemos representá-lo. */
  tipoCru?: string | null;
  legenda?: string | null;
  midiaId?: string | null;
  midiaMimeType?: string | null;
  midiaNome?: string | null;
  duracaoSeg?: number | null;
}

/**
 * Recebe o "oi" e devolve o que aconteceu. Nunca lança: derrubar o webhook é pior
 * que perder o registro de uma mensagem — mas a falha vem escrita, nunca como
 * silêncio.
 */
export async function receberMensagemDeVendas(msg: MensagemDeVendas): Promise<EntradaDeVendas> {
  const agora = msg.agora ?? new Date();
  const leitura = interpretarMensagemDeVendas(msg.text);

  const analise = analisarWhatsappBr(msg.fromPhone);
  const digitos = analise.ok ? analise.digitos : normalizaWhatsapp(msg.fromPhone);

  try {
    const lead = await encontrarLead(leitura.codigo, digitos, msg.fromPhone);

    // ── 1. Pediu silêncio ───────────────────────────────────────────────────
    // Vem antes de tudo: nem "contato novo" tem precedência sobre alguém dizendo
    // PARE. Se a pessoa não existe na base e manda PARE, gravamos o contato
    // JUSTAMENTE para poder honrar o silêncio — uma base que não sabe quem pediu
    // para parar volta a incomodar a mesma pessoa na semana seguinte.
    if (leitura.pedeSilencio) {
      const alvo = lead ?? (await criarContatoDeWhatsApp(msg, digitos, agora, { jaOptOut: true }));
      if (!alvo) {
        return { status: "FALHOU", leadId: null, codigo: null, detalhe: "pedido de silêncio recebido e NÃO gravado" };
      }
      await prisma.siteLead.update({
        where: { id: alvo.id },
        data: {
          optOutAt: alvo.optOutAt ?? agora, // idempotente: não reescreve a data original
          optOutCanal: alvo.optOutAt ? undefined : "whatsapp",
          lastInteractionAt: agora,
        },
      });
      await registrarInteracao(alvo.id, "NOTA", "Pediu para não receber mais mensagens (WhatsApp).", agora);
      // A mensagem do pedido de silêncio é gravada como qualquer outra: ela É a
      // evidência do opt-out. Uma auditoria de LGPD que só encontra a data, sem
      // o texto que a originou, não consegue demonstrar nada.
      await gravarNaConversa(alvo.id, msg, agora);
      return {
        status: "PEDIU_SILENCIO",
        leadId: alvo.id,
        codigo: alvo.codigo,
        detalhe: "opt-out registrado — nada mais será enviado a este contato",
      };
    }

    // ── 2. Contato novo: escreveu direto, sem passar pelo formulário ─────────
    // Acontece com quem vem de anúncio "Click to WhatsApp" ou de indicação. Quem
    // escreve primeiro está consentindo em ser respondido — por isso `consentAt`
    // é AGORA, e não uma data emprestada de outro lugar.
    if (!lead) {
      const novo = await criarContatoDeWhatsApp(msg, digitos, agora, { jaOptOut: false });
      if (!novo) {
        return { status: "FALHOU", leadId: null, codigo: null, detalhe: "contato novo NÃO gravado" };
      }
      const gravacao = await gravarNaConversa(novo.id, msg, agora);
      return {
        status: "CONTATO_NOVO",
        leadId: novo.id,
        codigo: novo.codigo,
        detalhe: "primeiro contato pelo WhatsApp, sem formulário",
        ta: gravacao.repetida ? undefined : await chamarOTA(novo.id, msg, leitura, agora),
      };
    }

    // ── 3. Já conhecido: a linha do tempo ganha a resposta ───────────────────
    await prisma.siteLead.update({
      where: { id: lead.id },
      data: { lastInteractionAt: agora },
    });
    await registrarInteracao(lead.id, "RESPOSTA_RECEBIDA", "Escreveu no WhatsApp de vendas.", agora);
    const gravacao = await gravarNaConversa(lead.id, msg, agora);

    return {
      status: leitura.codigo && lead.codigo === leitura.codigo ? "RECONHECIDO_POR_CODIGO" : "RECONHECIDO_POR_TELEFONE",
      leadId: lead.id,
      codigo: lead.codigo,
      detalhe: leitura.codigo ? `código #${leitura.codigo}` : "reconhecido pelo telefone",
      ta: gravacao.repetida ? undefined : await chamarOTA(lead.id, msg, leitura, agora),
    };
  } catch (e) {
    console.error("[foocci-sdr] falha ao receber mensagem de vendas:", e);
    return {
      status: "FALHOU",
      leadId: null,
      codigo: null,
      detalhe: e instanceof Error ? e.message.slice(0, 200) : "erro desconhecido",
    };
  }
}

/**
 * O que `gravarNaConversa` conseguiu descobrir sobre esta entrada — só o que o
 * chamador precisa para decidir se chama o TA.
 *
 * `repetida: true` é a única coisa que importa para quem chama: **é** a mesma
 * mensagem que a Meta já entregou antes (o índice único de `waMessageId` viu),
 * então nada além dela deve tratar este webhook como coisa nova — nem gravar
 * de novo, nem compor resposta de novo.
 */
interface ResultadoDaGravacao {
  repetida: boolean;
}

/**
 * Grava a mensagem na conversa do lead.
 *
 * ── POR QUE ELA NUNCA DERRUBA A RECEPÇÃO ────────────────────────────────────
 *
 * Um `catch` que engole erro costuma ser preguiça. Aqui é decisão: o contato já
 * foi reconhecido e a linha do tempo já registrou o movimento. Se a gravação da
 * conversa falhar, perder ISSO é ruim; devolver erro ao webhook e fazer a Meta
 * reentregar a mesma mensagem — que criaria contato duplicado nos caminhos
 * acima — é pior.
 *
 * A falha vai para o log com o motivo, nunca como silêncio (guardrail 6).
 *
 * Sem `waMessageId` não grava: sem ele a reentrega da Meta entraria de novo, e
 * a conversa mostraria a pessoa perguntando o preço duas vezes.
 *
 * ── ⛔ `repetida: true` TEM QUE CHEGAR AO CHAMADOR, E CHEGAVA SÓ ATÉ AQUI ────
 *
 * Medido em 12/09/2026, contra Postgres de verdade: esta função sabia que a
 * entrada era uma reentrega da Meta (`registrarEntrada` devolve `repetida:
 * true`, o índice único da ENTRADA barrando a segunda gravação) — e jogava
 * fora essa informação, devolvendo `void`. Quem chamava seguia direto para
 * `chamarOTA`, sem saber que nada de novo tinha chegado.
 *
 * `chamarOTA`, por sua vez, não relê o texto que chegou: ele relê "o que está
 * PENDENTE" (`juntarEntradasDoTurno`). Numa reentrega, a entrada original já
 * foi consolidada e carimbada no primeiro turno — então não há nada pendente
 * — e o CHÃO de `turnoConsolidado` (pensado para quando a gravação da entrada
 * FALHOU de verdade) entra em ação por engano, responde ao texto cru do
 * webhook, e grava uma SAÍDA nova. Resultado: a Meta reentrega o "oi" que já
 * foi respondido, e o cliente recebe a mesma resposta duas vezes — o defeito
 * que a trava de idempotência da ENTRADA existe para evitar, só que do lado
 * da SAÍDA, que ela nunca olhou.
 *
 * A trava de índice único continua sendo só da ENTRADA — não dá para (nem faz
 * sentido) estender um índice único a "resposta enviada". A correção é o
 * chamador respeitar o que esta função já sabia: reentrega confirmada não
 * chama o TA, ponto.
 */
async function gravarNaConversa(
  leadId: string,
  msg: MensagemDeVendas,
  agora: Date,
): Promise<ResultadoDaGravacao> {
  // Capturado numa const: o estreitamento de `msg.waMessageId` pelo `if` acima
  // não sobrevive à entrada no fecho passado a `comIdentidade`.
  const waMessageId = msg.waMessageId;
  // Sem `waMessageId` não há como saber se é reentrega — trata-se como mensagem
  // nova, que é o comportamento de sempre (guardrail 1: ausência não é negação).
  if (!waMessageId) return { repetida: false };

  try {
    // Roda como SISTEMA porque não há pessoa logada: é a Meta entregando um
    // webhook. Sem declarar identidade, a verificação de duplicata dentro de
    // `registrarEntrada` não enxergaria a mensagem já gravada (RLS) e a
    // reentrega seria tratada como um lead inexistente.
    const r = await comIdentidade(
      prisma,
      comoSistema("webhook da Meta: recepção de mensagem, sem usuário logado"),
      (tx) => registrarEntrada(tx, {
      leadId,
      waMessageId,
      tipo: msg.tipo ?? "TEXTO",
      tipoCru: msg.tipoCru ?? null,
      texto: msg.text ?? null,
      legenda: msg.legenda ?? null,
      midiaId: msg.midiaId ?? null,
      midiaMimeType: msg.midiaMimeType ?? null,
      midiaNome: msg.midiaNome ?? null,
      duracaoSeg: msg.duracaoSeg ?? null,
      ocorreuEm: agora,
      }),
    );

    if (!r.ok) {
      console.error(`[foocci-sdr] mensagem NÃO gravada na conversa do lead ${leadId}: ${r.causa}`);
      // Falha de gravação (ex.: lead sumiu) não é reentrega confirmada — não há
      // base para calar o TA por causa disto. Comportamento de sempre: segue.
      return { repetida: false };
    }

    return { repetida: r.repetida };
  } catch (e) {
    console.error("[foocci-sdr] falha ao gravar mensagem na conversa:", e);
    return { repetida: false };
  }
}

/**
 * Chama o TA — depois de a entrada estar gravada, e nunca antes.
 *
 * ── A ORDEM É O DESENHO ─────────────────────────────────────────────────────
 *
 * O TA lê a conversa para saber o que já perguntou. Chamá-lo antes de gravar a
 * mensagem que acabou de chegar o faria responder ao turno anterior — e repetir
 * uma pergunta que a pessoa acabou de responder é a coisa que mais denuncia um
 * robô numa conversa.
 *
 * ── E POR QUE ELE NUNCA DERRUBA A RECEPÇÃO ──────────────────────────────────
 *
 * Mesmo motivo de `gravarNaConversa`: o contato já foi reconhecido e a mensagem
 * já está na conversa. Devolver erro ao webhook faria a Meta reentregar — e a
 * reentrega passaria de novo pelos caminhos que criam contato. Perder uma
 * resposta do TA é ruim; duplicar o contato do cliente é pior.
 *
 * `atenderComOTA` já não lança, e o `catch` aqui é o cinto do cinto.
 */
/**
 * ⭐ QUANTAS VOLTAS O TURNO DÁ ANTES DE DESISTIR.
 *
 * Enquanto este turno compõe, o lead pode escrever de novo. Essa mensagem nova
 * **não consegue** tomar a trava — e sem o laço abaixo ela ficaria sem resposta
 * para sempre: a trava teria trocado uma resposta dupla por uma mensagem
 * perdida, que é pior.
 *
 * Três é o teto porque o laço tem de acabar. Um lead que escreve sem parar é
 * atendido nas três primeiras voltas e, na quarta mensagem, pela chamada nova
 * que o webhook dispara — o turno solta a trava ao sair, e ela está livre.
 */
const VOLTAS_DO_TURNO = 3;

async function chamarOTA(
  leadId: string,
  msg: MensagemDeVendas,
  leitura: LeituraDaMensagem,
  agora: Date,
): Promise<ResultadoDoTurno | undefined> {
  // Sem texto não há o que responder: figurinha, áudio e anexo não passam pela
  // base de verdade, e o TA não adivinha o que tem dentro de um áudio. Quem
  // atende isso é gente — e o lead já está na fila com a mídia na conversa.
  if (!leitura.temTexto || !msg.text) return undefined;

  try {
    const r = await comATravaDaConversa(prisma, { leadId, agora }, async (donoDoTurno) =>
      turnoConsolidado(leadId, donoDoTurno, agora, msg.text!),
    );

    // `null` = a conversa já tinha um turno correndo. **Não é perda**: a nossa
    // mensagem já está gravada, e o turno vizinho relê as entradas depois da
    // janela — então ele responde por nós. Este é o caminho que faz três
    // mensagens em rajada virarem UMA resposta.
    if (r === null) {
      console.info(`[foocci-sdr] turno vizinho já atende o lead ${leadId}; esta mensagem entra nele`);
      return undefined;
    }
    return r;
  } catch (e) {
    console.error(`[foocci-sdr] o TA não conseguiu atender o lead ${leadId}:`, e);
    return undefined;
  }
}

/**
 * O turno, já com a trava na mão.
 *
 * ── A ORDEM AQUI É O CONSERTO INTEIRO ───────────────────────────────────────
 *
 *   1. **espera a janela** — só na primeira volta, para juntar a rajada;
 *   2. **relê as entradas do banco** — e não usa o texto que chegou no webhook.
 *      Esta é a linha que consolida: o que responde é *tudo o que ele escreveu
 *      desde a última vez que falamos*, na ordem do relógio;
 *   3. **compõe e entrega**;
 *   4. **confere se chegou mensagem nova** enquanto compunha. Se chegou, dá
 *      outra volta — sem esperar de novo, porque a rajada já passou.
 */
async function turnoConsolidado(
  leadId: string,
  donoDoTurno: string,
  agora: Date,
  /**
   * ⭐ O CHÃO: o texto que chegou no webhook, agora mesmo.
   *
   * A consolidação lê do banco porque é lá que estão as mensagens irmãs. Mas o
   * banco pode não ter esta: `gravarNaConversa` desiste em silêncio quando a
   * Meta manda um evento sem `waMessageId`, e uma leitura que devolve vazio
   * faria o agente **não responder a alguém que acabou de escrever**.
   *
   * Consolidar é melhoria. Responder é obrigação. Quando a melhoria não tem o
   * que ler, responde-se ao texto que chegou — que é o comportamento de ontem,
   * e ontem pelo menos respondia.
   */
  textoQueChegou: string,
): Promise<ResultadoDoTurno | undefined> {
  let ultimo: ResultadoDoTurno | undefined;

  for (let volta = 0; volta < VOLTAS_DO_TURNO; volta++) {
    if (volta === 0) await esperar(janelaDeAgrupamento());

    // ⛔ A CONSOLIDAÇÃO INTEIRA É OPCIONAL, E O `catch` É O QUE DIZ ISSO.
    //
    // Medido em 10/09/2026, ao ligar esta máquina: cada peça nova que entrou no
    // caminho do turno — a trava, a memória, esta leitura — trouxe junto a
    // mesma armadilha. Se ela falha, a exceção sobe, o `catch` lá de cima
    // devolve `undefined`, o webhook responde 200, e **o lead nunca recebe
    // resposta**. Três vezes o mesmo defeito, com três causas diferentes.
    //
    // Então a regra é estrutural, e não peça por peça: falhou a consolidação,
    // responde-se ao texto que chegou. Nenhuma melhoria desta entrega tem
    // permissão de calar o agente.
    const entradas = await juntarEntradasDoTurno(prisma, leadId).catch((e) => {
      console.error(`[foocci-sdr] não consegui consolidar as entradas do lead ${leadId}:`, e);
      return null;
    });

    // Nada pendente no banco. Duas causas, e elas pedem coisas opostas:
    //
    //   · na PRIMEIRA volta é a gravação que não aconteceu (ou a leitura
    //     falhou) — e aí o chão responde, porque há alguém esperando do outro
    //     lado;
    //   · nas voltas SEGUINTES é o resultado bom: já respondemos tudo o que
    //     ele escreveu. Aqui, insistir com o texto do chão mandaria uma
    //     segunda resposta para a mesma frase — o defeito que viemos consertar.
    if (!entradas) {
      if (volta > 0) return ultimo;

      console.warn(
        `[foocci-sdr] lead ${leadId}: nenhuma entrada pendente no banco; ` +
          "respondendo ao texto que chegou no webhook",
      );
      return await comIdentidade(
        prisma,
        comoSistema("webhook da Meta: o TA respondendo, sem usuário logado"),
        (tx) =>
          atenderComOTA(tx, {
            leadId,
            mensagem: textoQueChegou,
            agora,
            turnoId: `${donoDoTurno}:chao`,
          }),
      );
    }

    const turnoId = `${donoDoTurno}:${volta}`;
    await carimbarTurno(prisma, entradas.ids, turnoId);

    // Dentro de `comIdentidade` pelo mesmo motivo da gravação da entrada: o RLS
    // precisa do papel declarado, senão a escrita do TA não passa pela trava.
    ultimo = await comIdentidade(
      prisma,
      comoSistema("webhook da Meta: o TA respondendo, sem usuário logado"),
      (tx) => atenderComOTA(tx, { leadId, mensagem: entradas.texto, agora, turnoId }),
    );

    // Mesma regra: se não dá para saber se chegou algo novo, encerra o turno.
    // Errar aqui para o lado de "dar mais uma volta" mandaria uma segunda
    // resposta; errar para o lado de parar deixa a mensagem seguinte para a
    // chamada nova do webhook, que já vem a caminho.
    const chegouNovo = await chegouEntradaDepois(prisma, leadId, entradas.ateQuando).catch(
      () => false,
    );
    if (!chegouNovo) return ultimo;

    console.info(
      `[foocci-sdr] lead ${leadId} escreveu enquanto o turno compunha; consolidando de novo`,
    );
  }

  return ultimo;
}

// ─── Peças ──────────────────────────────────────────────────────────────────────

type LeadResumo = { id: string; codigo: string | null; optOutAt: Date | null };

/**
 * Acha o contato. Duas chaves, nesta ordem, e a ordem importa:
 *
 *  1. o `#código` — é o único elo EXATO entre este "oi" e o formulário que a
 *     pessoa acabou de preencher;
 *  2. o telefone — funciona sempre, mas casa pelo fim do número, o que tolera
 *     nono dígito e DDI e por isso é a segunda escolha, nunca a primeira.
 *
 * Não achar não afirma nada sobre a pessoa (guardrail 1): é só ausência de
 * registro, e o chamador trata como contato novo.
 */
async function encontrarLead(
  codigo: string | null,
  digitos: string | null,
  fromPhone: string,
): Promise<LeadResumo | null> {
  const select = { id: true, codigo: true, optOutAt: true } as const;

  if (codigo) {
    const porCodigo = await prisma.siteLead.findUnique({ where: { codigo }, select });
    if (porCodigo) return porCodigo;
  }

  const cauda = (digitos ?? fromPhone).replace(/\D/g, "").slice(-8);
  if (cauda.length < 8) return null;

  return prisma.siteLead.findFirst({
    where: { whatsappDigits: { contains: cauda } },
    orderBy: { createdAt: "desc" },
    select,
  });
}

/** Cria o contato de quem chegou direto pelo WhatsApp. Devolve null se falhar. */
async function criarContatoDeWhatsApp(
  msg: MensagemDeVendas,
  digitos: string | null,
  agora: Date,
  opts: { jaOptOut: boolean },
): Promise<LeadResumo | null> {
  try {
    const criado = await prisma.siteLead.create({
      data: {
        nome: (msg.profileName ?? "").trim() || msg.fromPhone,
        whatsapp: msg.fromPhone,
        whatsappDigits: digitos,
        fonte: "WHATSAPP_DIRETO",
        stage: "NOVO",
        // Escreveu primeiro: o consentimento é o próprio ato, e é datado aqui.
        // Para quem já chega pedindo silêncio não se registra consentimento nenhum.
        consentAt: opts.jaOptOut ? null : agora,
        lastInteractionAt: agora,
      },
      select: { id: true, codigo: true, optOutAt: true },
    });
    await registrarInteracao(
      criado.id,
      "CAPTURA",
      "Escreveu direto no WhatsApp de vendas, sem passar pelo formulário.",
      agora,
    );
    return criado;
  } catch (e) {
    console.error("[foocci-sdr] não consegui criar o contato de WhatsApp:", e);
    return null;
  }
}

/** A linha do tempo é append-only e best-effort: nunca derruba o recebimento. */
async function registrarInteracao(
  leadId: string,
  tipo: "CAPTURA" | "RESPOSTA_RECEBIDA" | "NOTA",
  nota: string,
  agora: Date,
): Promise<void> {
  await prisma.siteLeadInteraction
    .create({ data: { leadId, tipo, actor: "sistema", nota, createdAt: agora } })
    .catch((e) => console.error("[foocci-sdr] falha ao registrar interação:", e));
}
