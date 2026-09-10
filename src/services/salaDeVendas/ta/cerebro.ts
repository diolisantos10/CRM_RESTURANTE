/**
 * O CÉREBRO DO TA — o modelo redigindo, com a casa segurando as duas pontas.
 *
 * ── O QUE MUDA A PARTIR DAQUI ───────────────────────────────────────────────
 *
 * Até 26/08/2026 o TA respondia por correspondência: achava o item mais próximo
 * na base de verdade e devolvia o texto pronto. Isso era seguro e era **duro** —
 * ele repetia a FAQ do site palavra por palavra, não entendia uma pergunta
 * torta, e a conversa morria no segundo turno.
 *
 * O CEO pediu um SDR de verdade, e SDR de verdade conversa. Então quem redige
 * agora é um modelo. Mas a diferença entre isto e "plugar o ChatGPT" está toda
 * em duas frases:
 *
 *   · **antes:** ele só lê o que a casa deixou passar (`conhecimento.ts`);
 *   · **depois:** ele só fala o que o `verificador.ts` aprovar.
 *
 * O modelo é o meio. As duas pontas são código, e código não se convence.
 *
 * ── E A RESPOSTA DETERMINÍSTICA NÃO FOI EMBORA ──────────────────────────────
 *
 * `responder()` continua ali e continua sendo chamada — virou o CHÃO. Se a chave
 * do modelo faltar, se a rede cair, se a resposta for reprovada duas vezes, o TA
 * responde do jeito antigo em vez de emudecer. Um lead esperando é pior que uma
 * resposta dura.
 *
 * Isso não é um `catch` de conveniência: é a decisão de que **o pior caso deste
 * arquivo é o comportamento de ontem**, e não silêncio.
 */

import { selectEngineRouted } from "@/services/brain/engines/AIEngineRouter";
import { callStructuredJson } from "@/services/brain/engines/OpenAIEngineAdapter";
import { buscarNoConhecimento, type PedacoDeConhecimento } from "./conhecimento";
import { buscarNaVerdade, type Achado } from "./verdade";
import {
  verificarResposta,
  LIMITE_DE_CARACTERES,
  LIMITE_DE_FRASES,
  type Veredito,
  type ContextoDaVerificacao,
} from "./verificador";
import { VERSAO_1, type TextoDaVersao } from "./ficha";
import { blocoDoOficio, type PosturaDoAgente } from "./oficio";
import { LINKS_DO_FOOCCI, pediuInformacaoObjetiva } from "./links";
import { ultimaFalaDoTAPerguntou } from "./responder";
import { comPrazo } from "./prazo";

/**
 * ⚠️ QUEM ESCOLHE O MODELO É O BRAIN, E NÃO ESTE ARQUIVO.
 *
 * A primeira versão importava `@/lib/openai` direto e fixava `gpt-4o-mini` numa
 * constante. O portão arquitetural da casa reprovou, e com razão: a Lei 1 do
 * Brain diz que todo agente raciocina ATRAVÉS do motor, e ninguém fala com a
 * IA-piloto por fora (`docs/brain-golden-rule.md`).
 *
 * Não é burocracia. Um modelo escolhido dentro deste arquivo é um modelo que
 * ninguém troca sem deploy, que não aparece no roteamento governado, e que
 * ignora a queda para MOCK quando não há chave. O `agentId` abaixo é o nome pelo
 * qual o TA aparece nesse roteamento — trocar o motor dele passa a ser
 * configuração, e não edição de código.
 */
const AGENTE = "sdr-ta-foocci";

/**
 * Quantas vezes se tenta de novo quando o verificador reprova.
 *
 * Uma. A segunda tentativa recebe o motivo da reprovação e costuma consertar —
 * o modelo citou um preço de cabeça e, avisado, usa o da tabela. A terceira
 * quase nunca conserta o que a segunda não consertou, e cada tentativa é tempo
 * de alguém esperando no WhatsApp.
 */
const TENTATIVAS_APOS_REPROVA = 1;

/**
 * Quanto tempo o TA espera o modelo antes de responder pelo chão.
 *
 * ── O INCIDENTE DE 09/09/2026 ───────────────────────────────────────────────
 *
 * Às 09h42 o TA falhou cinco vezes seguidas para o CEO. A causa não foi o
 * modelo cair: foi o modelo DEMORAR. A chamada rodava dentro da transação de
 * banco que declara a identidade ao RLS, e o Prisma fecha essa transação em
 * 5 s. Modelo em 6 s = transação morta = turno "quebrou" = lead sem resposta.
 *
 * A transação saiu de volta do modelo (`atender.ts`), e ISTO é a outra metade:
 * um teto explícito. Vinte segundos é muito para uma conversa de WhatsApp e
 * ainda assim é um teto — sem ele, um provedor pendurado prende o turno até o
 * socket morrer, e a pessoa fica olhando para "digitando…" por um minuto.
 * Estourou, sai o chão determinístico, na hora, com o motivo escrito.
 */
export const PRAZO_DO_MODELO_MS = 20_000;

export type OrigemDaFala = "modelo" | "modelo-na-segunda" | "chao-deterministico";

export interface FalaDoTA {
  texto: string;
  origem: OrigemDaFala;
  /** Em que a resposta se apoia — o que a Sala vê na tela de ensaio. */
  apoiadoEm: Array<{ id: string; fonte: string }>;
  /** As reprovações que aconteceram no caminho. Vazio no caminho feliz. */
  reprovacoes: Veredito[];
  /** Por que saiu assim. Frase curta, para a trilha. */
  porque: string;
}

export interface PedidoAoCerebro {
  mensagem: string;
  nome?: string | null;
  /** Os turnos anteriores, do mais antigo para o mais novo. */
  historico?: Array<{ deQuem: "cliente" | "ta"; texto: string }>;
  ficha?: TextoDaVersao;
  /**
   * Sondar ou fechar. Vem da temperatura do lead, calculada pelo qualificador.
   *
   * Omitido = `"qualificar"`, e o padrão é deliberado: conversa sem postura
   * declarada é conversa sobre a qual não se sabe nada, e o erro caro é soltar o
   * closer em cima de quem ninguém mediu.
   */
  postura?: PosturaDoAgente;
  /**
   * Teto de espera pelo modelo, em milissegundos. Omitido = `PRAZO_DO_MODELO_MS`.
   * Injetável para o teste provar o estouro sem esperar vinte segundos de relógio.
   */
  prazoMs?: number;
}

/**
 * O cérebro está ligado?
 *
 * Quem responde é o roteador do Brain: sem provedor configurado ele devolve
 * `MOCK`, que é a forma da casa dizer "não há IA-piloto de verdade aqui". Ler a
 * variável de ambiente na mão daria a resposta certa hoje e a errada no dia em
 * que o roteamento mudasse de provedor.
 */
export async function cerebroDisponivel(): Promise<boolean> {
  try {
    const engine = await selectEngineRouted(AGENTE);
    return engine.provider !== "MOCK";
  } catch {
    return false;
  }
}

/**
 * Monta o que o modelo lê antes de escrever.
 *
 * ── POR QUE O CONTEXTO É MONTADO AQUI, E NÃO PEDIDO AO MODELO ───────────────
 *
 * A alternativa seria dar ao modelo uma ferramenta de busca e deixá-lo procurar.
 * Ficaria mais elegante e seria pior: cada busca é uma ida e volta, a conversa
 * fica lenta, e o modelo decide sozinho o que ler — inclusive decidir não ler
 * nada e responder de memória, que é exatamente o que não pode acontecer.
 *
 * Aqui a casa escolhe o que ele lê. Ele não tem como não ler.
 */
export function montarContexto(pergunta: string): {
  conhecimento: PedacoDeConhecimento[];
  verdade: Achado[];
} {
  return {
    conhecimento: buscarNoConhecimento(pergunta),
    verdade: buscarNaVerdade(pergunta),
  };
}

function instrucao(
  ficha: TextoDaVersao,
  ctx: ReturnType<typeof montarContexto>,
  postura: PosturaDoAgente = "qualificar",
): string {
  const verdades = ctx.verdade.map((a) => `- ${a.item.texto}`).join("\n");
  const conhecimento = ctx.conhecimento
    .map((p) => `### ${p.secao} (${p.capitulo})\n${p.texto}`)
    .join("\n\n");

  return [
    `Você é ${ficha.identidade}`,
    "",
    `TOM: ${ficha.tomDeVoz}`,
    "",
    // O ofício vem de `oficio.ts` e não digitado aqui: é texto que se revisa
    // lendo, e enterrado no meio de uma função ninguém o lê inteiro nunca mais.
    blocoDoOficio(postura),
    "",
    "O QUE VOCÊ PODE AFIRMAR — palavra por palavra, sem alterar número nenhum:",
    verdades || "(nada específico foi encontrado para esta pergunta)",
    "",
    "O QUE VOCÊ SABE SOBRE O PRODUTO — use para EXPLICAR, com as suas palavras.",
    "Isto é material interno: traduza para linguagem de dono de restaurante, e",
    "nunca cite nome de arquivo, de campo técnico ou de sistema interno.",
    "",
    conhecimento || "(nada específico foi encontrado para esta pergunta)",
    "",
    "PROIBIDO, e estas são travas de verdade — o texto é conferido depois e",
    "reprovado se você desobedecer:",
    ...ficha.proibidos.map((p) => `- ${p}`),
    "- Inventar qualquer valor em reais que não esteja acima.",
    "- Prometer prazo de implantação.",
    "- Garantir resultado, faturamento ou percentual.",
    "- Afirmar integração com iFood, Rappi ou qualquer marketplace.",
    "- Dizer que contratou, ativou ou fechou alguma coisa pelo cliente.",
    "",
    "SE NÃO SOUBER: diga que não sabe e ofereça chamar alguém do time. Isso é",
    "uma resposta boa. Inventar é o único erro que não tem conserto.",
    "",
    // ── Os links, a cadência de pergunta e o tamanho — pedido do CEO, 09/09/2026.
    //
    // Os três são conferidos em código depois (`verificador.ts`): o teto de
    // tamanho e a pergunta fora de hora REPROVAM a resposta. Estão escritos aqui
    // para o modelo não gastar a tentativa em algo que vai ser barrado.
    "LINKS QUE VOCÊ MANDA — o endereço inteiro, exatamente como está aqui, sem",
    "encurtar e sem inventar outro:",
    `- Site: ${LINKS_DO_FOOCCI.site}`,
    `- Planos e preços: ${LINKS_DO_FOOCCI.precos} (mande quando perguntarem preço ou plano)`,
    `- Ver o Foocci funcionando, sem cadastro: ${LINKS_DO_FOOCCI.demo} (mande quando pedirem demo, teste ou "como é")`,
    `- Assinar: ${LINKS_DO_FOOCCI.assinar} (mande quando quiserem contratar, assinar ou começar)`,
    "",
    "TAMANHO — trava de verdade, o texto é reprovado se passar:",
    `- No máximo ${LIMITE_DE_FRASES} frases e ${LIMITE_DE_CARACTERES} caracteres. Mire em três frases curtas.`,
    "",
    "PERGUNTA — trava de verdade, o texto é reprovado se passar:",
    "- Se a pessoa pediu preço, link, demo ou como assinar: entregue e PARE. Nenhuma pergunta.",
    "- Se a sua mensagem anterior já terminou em pergunta, esta não pergunta nada.",
    "- No máximo uma pergunta a cada duas mensagens suas. Uma resposta sem pergunta é uma resposta completa.",
  ].join("\n");
}

/**
 * O TA pensa e escreve.
 *
 * **Nunca lança.** Uma exceção aqui derrubaria o webhook, e a Meta reentrega o
 * que falhou — a mesma mensagem batendo na mesma falha em laço. Toda saída ruim
 * vira o chão determinístico, com o motivo escrito.
 */
export async function pensar(
  pedido: PedidoAoCerebro,
  chao: (p: PedidoAoCerebro) => FalaDoTA,
): Promise<FalaDoTA> {
  const ficha = pedido.ficha ?? VERSAO_1;

  const engine = await selectEngineRouted(AGENTE).catch(() => null);
  if (!engine || engine.provider === "MOCK") {
    return { ...chao(pedido), porque: "sem IA-piloto configurada — respondeu pelo caminho determinístico" };
  }

  const ctx = montarContexto(pedido.mensagem);
  const apoiadoEm = [
    ...ctx.verdade.map((a) => ({ id: a.item.id, fonte: a.item.fonte })),
    ...ctx.conhecimento.map((p) => ({ id: p.id, fonte: "manual-operacional" })),
  ];

  const reprovacoes: Veredito[] = [];
  let correcao = "";

  // O que o verificador precisa saber da conversa, calculado UMA vez: a pessoa
  // pediu coisa objetiva? A última fala do TA já foi pergunta?
  const contexto: ContextoDaVerificacao = {
    pediuInformacaoObjetiva: pediuInformacaoObjetiva(pedido.mensagem),
    ultimaFalaDoTAPerguntou: ultimaFalaDoTAPerguntou(pedido.historico),
  };

  for (let tentativa = 0; tentativa <= TENTATIVAS_APOS_REPROVA; tentativa++) {
    const texto = await escrever(
      engine,
      instrucao(ficha, ctx, pedido.postura),
      pedido,
      correcao,
    );
    if (texto === null) break; // rede, modelo fora do ar ou prazo estourado — cai no chão

    const veredito = verificarResposta(texto, contexto);
    if (veredito.aprovada) {
      return {
        texto,
        origem: tentativa === 0 ? "modelo" : "modelo-na-segunda",
        apoiadoEm,
        reprovacoes,
        porque: tentativa === 0
          ? "o modelo redigiu e o verificador aprovou"
          : `o modelo corrigiu depois de reprovado (${reprovacoes[0]?.detalhe ?? ""})`,
      };
    }

    reprovacoes.push(veredito);
    // A segunda tentativa recebe o motivo — não uma repreensão genérica. Dizer
    // "você errou" faz o modelo reescrever tudo; dizer "R$ 149 não está na
    // tabela" faz ele trocar o número e manter o resto.
    correcao =
      `A sua resposta anterior foi REPROVADA pela verificação da empresa: ${veredito.detalhe}. ` +
      "Reescreva corrigindo exatamente isso. Se o problema foi um valor, use apenas os valores " +
      "que aparecem em O QUE VOCÊ PODE AFIRMAR. Se foi uma promessa, retire-a — não a suavize. " +
      "Se foi tamanho, corte até caber. Se foi pergunta, termine sem pergunta.";
  }

  const base = chao(pedido);
  return {
    ...base,
    reprovacoes,
    porque: reprovacoes.length
      ? `o modelo foi reprovado ${reprovacoes.length}× (${reprovacoes[0]!.detalhe}) — respondeu pelo caminho determinístico`
      : "o modelo não respondeu — respondeu pelo caminho determinístico",
  };
}

/**
 * Uma ida ao piloto, pelo motor do Brain. `null` quando não deu para falar.
 *
 * ── POR QUE O HISTÓRICO VAI DENTRO DO TEXTO, E NÃO COMO TURNOS ──────────────
 *
 * `callStructuredJson` manda um `system` e um `user` — é o contrato do motor,
 * igual para todo agente da casa. O histórico entra escrito dentro do `user`,
 * exatamente como o `BrainReasoner` já faz com `sanitizedHistory`.
 *
 * Perde-se um pouco da marcação de papéis e ganha-se a coisa que importa: uma
 * porta só para falar com a IA. Um segundo caminho, mais bonito, seria um
 * segundo lugar onde alguém esqueceria de aplicar uma regra nova.
 */
async function escrever(
  engine: Awaited<ReturnType<typeof selectEngineRouted>>,
  sistema: string,
  pedido: PedidoAoCerebro,
  correcao: string,
): Promise<string | null> {
  const historico = (pedido.historico ?? []).slice(-8);

  const userContent = [
    historico.length
      ? "CONVERSA ATÉ AQUI (do mais antigo ao mais novo):\n" +
        historico.map((t) => `${t.deQuem === "cliente" ? "Cliente" : "Você"}: ${t.texto}`).join("\n")
      : "",
    `MENSAGEM DO CLIENTE AGORA: "${pedido.mensagem}"`,
    correcao,
  ].filter(Boolean).join("\n\n");

  try {
    // ── O PRAZO — ver `prazo.ts`. Estourou, `null`, e o chão responde. ──────
    const chamada = callStructuredJson({
      selection: engine,
      systemPrompt: sistema,
      userContent,
      // Texto livre, e não JSON: o que sai daqui é uma mensagem de WhatsApp.
      responseFormat: "text",
      // Baixa, e não zero. Zero deixa a fala idêntica turno após turno, e um
      // vendedor que responde sempre com a mesma construção é reconhecido como
      // robô em três mensagens. Alta inventa.
      temperature: 0.6,
      // ── O TETO, E POR QUE ELE NÃO É MAIS APERTADO ────────────────────────
      //
      // Quem mantém a resposta curta é a instrução, não este número. O motor
      // LANÇA quando o modelo bate no teto (`cortado_por_limite`), e aqui um
      // lançamento vira queda para o chão determinístico — ou seja, um teto
      // apertado não produz resposta curta: produz resposta SECA, e sem
      // ninguém entender por quê.
      //
      // 220 era apertado para português, que gasta mais token que inglês na
      // mesma frase. 400 continua sendo curto (umas 250 palavras) e deixa de
      // transformar uma resposta um pouco mais longa em silêncio do modelo.
      maxTokens: 400,
    });

    const raw = await comPrazo(chamada, pedido.prazoMs ?? PRAZO_DO_MODELO_MS);
    if (raw === null) return null; // prazo estourado — o chão responde

    return raw.trim() || null;
  } catch {
    // Silencioso de propósito: o chamador já escreve o motivo no resultado, e o
    // texto do erro do provedor pode carregar pedaço de credencial.
    return null;
  }
}
