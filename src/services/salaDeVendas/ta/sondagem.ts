/**
 * A SONDAGEM — ouvir a conversa e virar sinal.
 *
 * ── A PEÇA QUE FALTAVA, E COMO ELA APARECEU ─────────────────────────────────
 *
 * O CEO perguntou em 27/08/2026: *"você já fez teste com esse qualificador?"*.
 * Fui conferir e achei coisa pior que teste faltando: **a régua de temperatura
 * existia, estava testada, e ninguém a chamava.**
 *
 * `score.ts` sabe transformar sinais em `FRIO / MORNO / QUENTE`. O TA sabe
 * conversar e fazer as perguntas de descoberta. E não havia nada entre os dois:
 * o agente perguntava "quantas unidades você tem?", a pessoa respondia "três", e
 * a resposta **morria na conversa**. Todo lead ficava sem etiqueta.
 *
 * É o mesmo defeito que a entrega de mensagem tinha: peça pronta, testada, sem
 * chamador. Por dentro parece tudo certo; por fora não acontece nada.
 *
 * Este arquivo é a peça do meio.
 *
 * ── ⚠️ EXTRAIR NÃO É RESPONDER, E A DIFERENÇA MUDA O DESENHO ────────────────
 *
 * Compor uma fala aceita improviso — duas respostas diferentes podem ser as duas
 * boas. Extrair sinal não: `unidades: 3` está certo ou está errado, e o erro vai
 * direto para a temperatura, que decide quem o closer ataca primeiro.
 *
 * Daí três decisões que parecem exageradas e não são:
 *
 *  · **temperatura 0** — a mesma conversa produz sempre o mesmo sinal;
 *  · **só o que foi DITO** — o modelo é proibido de deduzir. "Tenho um
 *    restaurante" não vira `unidades: 1`, porque a pessoa não disse isso;
 *  · **nulo é resposta legítima** — e é a mais comum. Um extrator que preenche
 *    tudo para "ajudar" fabrica score, e score fabricado manda o closer atacar
 *    quem nunca falou nada.
 *
 * ── E POR QUE ELE NUNCA APAGA O QUE JÁ SE SABE ──────────────────────────────
 *
 * A sondagem roda a cada turno, e cada turno enxerga só um pedaço da conversa.
 * Se o resultado substituísse a ficha, o lead que disse "tenho 3 lojas" no turno
 * 2 perderia esse dado no turno 5 — e o score cairia sem ninguém mexer em nada.
 *
 * `juntarSinais` só escreve por cima do que está vazio. Fato descoberto não
 * desaparece porque a conversa mudou de assunto.
 */

import { selectEngineRouted } from "@/services/brain/engines/AIEngineRouter";
import { callStructuredJson } from "@/services/brain/engines/OpenAIEngineAdapter";
import { comPrazo } from "./prazo";
import { PRAZO_DO_MODELO_MS } from "./cerebro";
import type { SinaisDoLead } from "../score";

const AGENTE = "sdr-ta-foocci";

/** Um turno da conversa, do jeito que o TA já guarda. */
export interface TurnoDaConversa {
  deQuem: "cliente" | "ta";
  texto: string;
}

/**
 * O formato que o modelo é obrigado a devolver, escrito DENTRO da instrução.
 *
 * ⚠️ A primeira versão declarava isto como um `schema` passado ao motor — e o
 * motor da casa não recebe esquema. O objeto teria ficado ali, bonito e
 * **inerte**: o modelo nunca o veria, devolveria o formato que quisesse, e
 * `limpar()` transformaria tudo em `null`. Todo lead sairia sem sinal, com o
 * arquivo inteiro parecendo correto.
 *
 * É a mesma família de defeito que originou este arquivo: peça escrita, peça
 * não conectada. Por isso o formato mora no texto que o modelo LÊ.
 *
 * As descrições ficam junto de cada campo porque são elas que evitam o erro
 * caro — o modelo deduzindo o que a pessoa não disse.
 */
const FORMATO_ESCRITO = [
  "Devolva SOMENTE um objeto JSON com exatamente estes campos:",
  "",
  '  "unidades": número inteiro ou null — quantas casas/lojas. SÓ se ela disse o número.',
  '  "volumeMensal": número inteiro ou null — pedidos por mês, se informou.',
  '  "canaisAtuais": lista de textos ou null — por onde vende hoje, em minúsculas:',
  "      ifood, rappi, whatsapp, instagram, salao, entrega propria.",
  '  "sistemaAtual": texto ou null — sistema/PDV de hoje, se citou o nome.',
  '  "dorPrincipal": texto ou null — o que mais incomoda, nas palavras dela.',
  '  "urgencia": texto ou null — quando quer resolver. Ex.: "pra semana que vem", "sem pressa".',
  '  "poderDeDecisao": texto ou null — se decide sozinha ou depende de sócio/matriz.',
  '  "faixaDeOrcamento": texto ou null — quanto pode gastar, se falou.',
  '  "ehRestaurante": true, false ou null — leia a definição abaixo antes de responder.',
].join("\n");

const INSTRUCAO = [
  "Você lê a conversa entre um dono de restaurante e o atendimento da Foocci e extrai FATOS.",
  "",
  FORMATO_ESCRITO,
  "",
  "REGRAS, e elas valem mais que a vontade de preencher:",
  "1. Só registre o que a pessoa DISSE. Nunca deduza, nunca complete, nunca estime.",
  "2. Na dúvida, devolva null. Null é resposta certa e é a mais comum.",
  '3. "Tenho um restaurante" NÃO é unidades=1 — ela falou do negócio, não da quantidade.',
  '4. "Tenho outra loja no centro" É unidades=2, porque ela contou.',
  "5. Não invente canal que ela não citou. Não traduza marca em categoria.",
  "",
  "O QUE CONTA COMO CLIENTE DA FOOCCI (campo ehRestaurante):",
  "A Foocci atende quem VENDE COMIDA OU BEBIDA para consumo — e o nome do",
  "campo engana, então vale a lista:",
  "",
  "  SIM: restaurante, bar, boteco, pub, lanchonete, pizzaria, hamburgueria,",
  "       japonês, cafeteria, padaria, confeitaria, doceria, açaí, sorveteria,",
  "       food truck, adega com consumo, casa noturna que serve comida,",
  "       marmitaria, self-service, delivery de comida, dark kitchen.",
  "",
  "  NÃO: loja de roupa, salão de beleza, farmácia, oficina, imobiliária,",
  "       mercado sem cozinha, e qualquer negócio que não sirva comida.",
  "",
  "6. ehRestaurante=false SÓ para os do segundo grupo. Bar é SIM.",
  "7. Na dúvida sobre o ramo, devolva null — nunca false. Um false errado",
  "   apaga um cliente de verdade; um null só adia a pergunta.",
  "",
  "Você não conversa e não opina. Devolve o objeto, e só.",
].join("\n");

/**
 * Lê a conversa e devolve o que dá para afirmar.
 *
 * **Nunca lança.** Roda dentro do turno do TA, depois de o cliente já ter
 * escrito: uma exceção aqui derrubaria a resposta que estava pronta para sair.
 * Sem modelo disponível, devolve tudo nulo — a ficha simplesmente não avança
 * neste turno, que é bem melhor que a conversa morrer.
 */
export async function extrairSinais(
  historico: TurnoDaConversa[],
  mensagemDeAgora: string,
): Promise<SinaisDoLead> {
  const vazio: SinaisDoLead = {};

  const falas = [...historico, { deQuem: "cliente" as const, texto: mensagemDeAgora }]
    .filter((t) => t.texto.trim())
    .map((t) => `${t.deQuem === "cliente" ? "CLIENTE" : "ATENDIMENTO"}: ${t.texto.trim()}`)
    .join("\n");

  if (!falas) return vazio;

  try {
    const engine = await selectEngineRouted(AGENTE);
    if (engine.provider === "MOCK") return vazio;

    // Com prazo (09/09/2026): esta é a SEGUNDA chamada ao modelo do turno, e
    // roda depois de a resposta já ter saído. Sem teto, um provedor pendurado
    // prendia a promessa do webhook para sempre — sem dano ao cliente, mas com
    // um turno que nunca termina. Estourou, o lead fica sem etiqueta neste
    // turno, e o próximo tenta de novo com a conversa maior.
    const bruto = await comPrazo(
      callStructuredJson({
        selection: engine,
        systemPrompt: INSTRUCAO,
        userContent: `Conversa:\n${falas}`,
        responseFormat: "json",
        // ⚠️ Zero, e não 0.6 como na composição da fala. Extração é medição: a
        // mesma conversa tem de produzir o mesmo sinal, ou a temperatura de um
        // lead muda entre dois turnos sem ninguém ter dito nada novo.
        temperature: 0,
        maxTokens: 400,
      }),
      PRAZO_DO_MODELO_MS,
    );
    if (bruto === null) return vazio;

    return limpar(bruto);
  } catch {
    // Modelo fora do ar, resposta truncada, JSON inválido. Nada disso pode
    // impedir o cliente de receber resposta.
    return vazio;
  }
}

/**
 * Confere o que voltou do modelo antes de deixar virar score.
 *
 * Não é paranoia com o modelo: é que o resultado alimenta um número que decide
 * prioridade de ataque comercial. `unidades: -3` ou `unidades: 9000` viraria
 * pontuação sem ninguém notar, porque a régua só soma.
 */
function limpar(bruto: unknown): SinaisDoLead {
  if (!bruto || typeof bruto !== "object") return {};
  const o = bruto as Record<string, unknown>;

  const inteiroPlausivel = (v: unknown, teto: number): number | null => {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    const n = Math.trunc(v);
    return n > 0 && n <= teto ? n : null;
  };

  const texto = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    // Corta a frase longa: aqui cabe um fato, não um parágrafo. Texto solto
    // grande costuma ser o modelo narrando a conversa em vez de extrair.
    return t && t.length <= 160 ? t : null;
  };

  const canais = Array.isArray(o.canaisAtuais)
    ? o.canaisAtuais
        .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
        .map((c) => c.trim().toLowerCase())
        .slice(0, 8)
    : null;

  return {
    // 200 unidades: acima disso é rede grande demais para o modelo ter lido
    // certo, e o erro mais provável é ele ter pego o número de PEDIDOS.
    unidades: inteiroPlausivel(o.unidades, 200),
    volumeMensal: inteiroPlausivel(o.volumeMensal, 1_000_000),
    canaisAtuais: canais?.length ? canais : null,
    sistemaAtual: texto(o.sistemaAtual),
    dorPrincipal: texto(o.dorPrincipal),
    urgencia: texto(o.urgencia),
    poderDeDecisao: texto(o.poderDeDecisao),
    faixaDeOrcamento: texto(o.faixaDeOrcamento),
    ehRestaurante: typeof o.ehRestaurante === "boolean" ? o.ehRestaurante : null,
  };
}

/**
 * Junta o que já se sabia com o que acabou de aparecer.
 *
 * ⚠️ **O novo só entra onde o antigo está vazio.** A sondagem roda a cada turno
 * e enxerga um pedaço da conversa por vez: se ela substituísse, o "tenho 3
 * lojas" dito no turno 2 sumiria no turno 5, e o score cairia sozinho.
 *
 * A exceção é `mensagensDoLead`, que é contagem e não descoberta — esse sempre
 * vale o mais recente.
 */
export function juntarSinais(antes: SinaisDoLead, agora: SinaisDoLead): SinaisDoLead {
  const manter = <T>(velho: T | null | undefined, novo: T | null | undefined): T | null =>
    velho !== null && velho !== undefined ? velho : (novo ?? null);

  return {
    unidades: manter(antes.unidades, agora.unidades),
    volumeMensal: manter(antes.volumeMensal, agora.volumeMensal),
    canaisAtuais: antes.canaisAtuais?.length ? antes.canaisAtuais : (agora.canaisAtuais ?? null),
    sistemaAtual: manter(antes.sistemaAtual, agora.sistemaAtual),
    dorPrincipal: manter(antes.dorPrincipal, agora.dorPrincipal),
    urgencia: manter(antes.urgencia, agora.urgencia),
    poderDeDecisao: manter(antes.poderDeDecisao, agora.poderDeDecisao),
    faixaDeOrcamento: manter(antes.faixaDeOrcamento, agora.faixaDeOrcamento),

    // ⚠️ `ehRestaurante: false` é DESQUALIFICAÇÃO, e precisa sobreviver.
    // `manter` já faz isso (false não é null nem undefined) — mas a linha está
    // escrita à parte porque um `||` aqui, escrito por descuido, trocaria o
    // `false` pelo valor novo e ressuscitaria um lead desqualificado.
    ehRestaurante: antes.ehRestaurante !== null && antes.ehRestaurante !== undefined
      ? antes.ehRestaurante
      : (agora.ehRestaurante ?? null),

    mensagensDoLead: agora.mensagensDoLead ?? antes.mensagensDoLead ?? null,
  };
}
