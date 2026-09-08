/**
 * O VERIFICADOR — a trava que fica DEPOIS do modelo.
 *
 * ── POR QUE ELE EXISTE, E POR QUE NÃO É UM PEDAÇO DO PROMPT ─────────────────
 *
 * A partir de 26/08/2026 quem redige a fala do TA é um modelo. Isso resolve o
 * problema de a conversa ser dura e cria o problema de a conversa ser **falsa**:
 * modelo perguntado sobre o que não sabe inventa, e inventa em português
 * excelente, com aparência de fundamentado.
 *
 * Escrever "não invente preço" no prompt é aviso. Guardrail 4 desta casa: para o
 * que causa dano real, exija o mecanismo, não a boa intenção escrita. Este
 * arquivo é o mecanismo — ele lê o que o modelo produziu e decide se aquilo pode
 * chegar num estranho.
 *
 * ── O QUE ELE BARRA, E POR QUE CADA UM ──────────────────────────────────────
 *
 *   1. **Valor em reais que não está na tabela.** O defeito mais caro possível:
 *      o cliente fecha por um preço e a cobrança vem outra. Não existe erro de
 *      vendas pior que esse, porque ele já nasce como pedido de reembolso.
 *   2. **Promessa de prazo.** "Em 3 dias você está no ar" é um compromisso que
 *      quem redigiu não pode assumir e quem implanta vai ter que cumprir.
 *   3. **Garantia de resultado.** "Aumenta 30% seu faturamento" é o tipo de
 *      frase que fecha negócio hoje e vira processo depois.
 *   4. **Nome de integração que não existe.** "Funciona com o iFood" dito para
 *      quem vive de iFood é o exemplo canônico: o cliente compra por causa disso.
 *   5. **Fechar em nome do cliente.** Quem assina é o cliente, no checkout. O TA
 *      dizendo "já deixei contratado" inventa um ato que não aconteceu.
 *
 * ── O QUE ACONTECE QUANDO ELE BARRA ─────────────────────────────────────────
 *
 * Nada é "corrigido". Uma resposta remendada por expressão regular vira frase
 * quebrada, e frase quebrada denuncia o robô mais rápido que resposta nenhuma.
 * O verificador **reprova**, nomeia o motivo, e quem chamou decide: cair na
 * resposta determinística ou chamar gente. Reprovar é barato; consertar texto de
 * modelo com remendo é o começo de um sistema que ninguém entende.
 */

import { tabelaPublicada } from "../precos";

export type MotivoDaReprovacao =
  | "precoForaDaTabela"
  | "prometeuPrazo"
  | "garantiuResultado"
  | "integracaoInventada"
  | "fechouPeloCliente"
  | "negouSerAgente"
  | "vazio";

export interface Veredito {
  aprovada: boolean;
  /** Vazio quando aprovada. Mais de um motivo pode se aplicar ao mesmo texto. */
  motivos: MotivoDaReprovacao[];
  /** Frase curta com o caso concreto, para a trilha e para a tela de ensaio. */
  detalhe: string;
}

/**
 * As integrações que existem, e é só isso.
 *
 * Derivadas do Manual — os títulos das seções do capítulo de integrações —, e
 * não digitadas aqui. Uma lista escrita à mão neste arquivo envelheceria no dia
 * em que a próxima integração entrasse, e o TA passaria a ser barrado por falar
 * de algo que a empresa acabou de lançar.
 */
import { baseDeConhecimento } from "./conhecimento";

function integracoesQueExistem(): string[] {
  const secoes = baseDeConhecimento()
    .filter((p) => p.capitulo === "integracoes")
    .map((p) => p.secao.toLowerCase());

  return secoes.flatMap((s) => s.split(/[\s/(),–—-]+/)).filter((w) => w.length > 2);
}

/**
 * Nomes que um lead de restaurante cita, e que o Foocci **não** integra.
 *
 * Lista explícita porque o dano é assimétrico: dizer "sim, funciona com o iFood"
 * para quem tira metade do faturamento do iFood fecha o negócio na hora e
 * explode na implantação. Não dá para depender de o modelo simplesmente não
 * mencionar — ele menciona, porque é o que aparece em todo texto sobre
 * restaurante que ele já leu.
 *
 * Um nome daqui só reprova quando vem AFIRMADO. O TA precisa poder dizer "não
 * integramos com o iFood" sem ser barrado por ter dito a palavra.
 */
const CITADOS_QUE_NAO_EXISTEM = [
  "ifood", "rappi", "uber eats", "ubereats", "99food", "aiqfome",
  "goomer", "anota ai", "anotaai", "delivery much", "deliverymuch",
];

/** "integra com X", "funciona com X", "conecta com X" — a forma AFIRMATIVA. */
const AFIRMA_INTEGRACAO =
  /\b(integra(?:mos|ção|cao)?|funciona|conecta(?:mos)?|compat[íi]vel|sincroniza(?:mos)?)\b[^.!?]{0,40}?\b(com|ao|à|no|na)\b[^.!?]{0,30}/gi;

/**
 * A negação, e ela precisa estar COLADA no verbo.
 *
 * ── A LIÇÃO DE 26/08/2026 ───────────────────────────────────────────────────
 *
 * A primeira versão procurava negação em qualquer lugar da frase, com uma lista
 * que incluía "nenhum" e "sem". Resultado: *"o Foocci funciona com o iFood **sem
 * problema nenhum**"* — a mentira mais cara que este verificador existe para
 * barrar — foi lida como negação e **aprovada**.
 *
 * "Sem problema nenhum" é reforço, não negação. A diferença entre negar uma
 * integração e enfatizá-la é a posição: quem nega diz "**não** integra". Por
 * isso a busca é por negação nos poucos caracteres ANTES do verbo, e a lista
 * perdeu "sem" e "nenhum" — as duas palavras que aparecem em português muito
 * mais como ênfase do que como recusa.
 */
const NEGA_ANTES_DO_VERBO = /\b(n[ãa]o|nunca|jamais|ainda n[ãa]o)\s*$/i;

const PROMETE_PRAZO =
  /\b(em|dentro de|até)\s+\d+\s*(dia|dias|hora|horas|semana|semanas|minuto|minutos)\b|\b(hoje mesmo|amanh[ãa]|na mesma hora)\s+(voc[êe]|j[áa]|est[áa])/i;

const GARANTE_RESULTADO =
  /\b(garant(?:o|imos|ido|ia)|com certeza (?:vai|voc[êe])|certamente (?:vai|aumenta)|prometo)\b|\baumenta\s+\d+\s*%|\b\d+\s*%\s+(?:a mais|de aumento|de faturamento)/i;

/**
 * ⛔ O AGENTE DIZENDO QUE É GENTE.
 *
 * ── POR QUE ISTO VIROU TRAVA EM 07/09/2026 ─────────────────────────────────
 *
 * Até hoje o `oficio.ts` PROIBIA o agente de dizer as palavras "IA" e "modelo",
 * e o `cerebro.ts` justificava a temperatura 0.6 como "não ser reconhecido como
 * robô em três mensagens". Somadas, as duas regras produziam um agente
 * instruído a esconder o que é — sem que ninguém tivesse decidido isso.
 *
 * O CEO decidiu o contrário: *"não precisa enganar alguém... é só falar que é
 * agente de atendimento do Foocci."* A regra nova está escrita no ofício, mas
 * **regra no prompt é aviso, não trava**: o modelo pode não obedecer, e o
 * cliente não tem como saber que foi enganado.
 *
 * Esta expressão é a trava. Ela pega a NEGAÇÃO — "sou pessoa", "não sou robô",
 * "sou de carne e osso", "falando com um humano" — e reprova a resposta antes
 * de sair. Uma resposta que simplesmente não toca no assunto passa normal: o
 * agente não é obrigado a se anunciar em toda mensagem, só a não mentir quando
 * perguntado.
 */
// ⚠️ SEM `\b` no fim, e isso é medido, não estilo: em JavaScript `\b` só
// conhece letra ASCII, então `/rob[ôo]\b/` NÃO casa com "robô não" — a borda
// depois do "ô" nunca acontece. A primeira versão desta trava passou batido
// exatamente na frase mais provável de todas ("não sou um robô não").
const NEGOU_SER_AGENTE =
  /(?:n[ãa]o sou (?:um |uma )?(?:rob[ôo]|m[áa]quina|intelig[êe]ncia artificial|ia\b|bot|sistema|programa)|sou (?:uma )?pessoa(?: de verdade| real)?|sou (?:um |uma )?(?:humano|humana|atendente de verdade)|carne e osso|sou gente|est[áa] falando com (?:uma pessoa|um humano|gente))/i;

const FECHOU_PELO_CLIENTE =
  /\b(j[áa] (?:deixei|deixamos|contratei|contratamos|ativei|ativamos)|acabei de contratar|deixei contratado|j[áa] est[áa] contratado)\b/i;

/** Todo valor em reais que aparece no texto, em centavos. */
function valoresEmReais(texto: string): number[] {
  const achados: number[] = [];
  const re = /R\$\s*([\d.]+)(?:,(\d{2}))?/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    const inteiro = Number(m[1]!.replace(/\./g, ""));
    const centavos = m[2] ? Number(m[2]) : 0;
    if (Number.isFinite(inteiro)) achados.push(inteiro * 100 + centavos);
  }
  return achados;
}

/**
 * Todo valor que o TA tem direito de dizer.
 *
 * Vem da mesma tabela que o checkout cobra — não de uma cópia. É a única forma
 * de "o preço que ele falou" e "o preço que vai ser cobrado" serem a mesma coisa
 * por construção, e não por alguém ter lembrado de atualizar os dois.
 */
export function valoresPermitidos(): Set<number> {
  const permitidos = new Set<number>();

  for (const plano of tabelaPublicada()) {
    for (const c of plano.ciclos) {
      for (const rotulo of [c.doCiclo, c.equivalenteAoMes, c.primeiraCobranca]) {
        for (const v of valoresEmReais(rotulo ?? "")) permitidos.add(v);
      }
    }
  }

  return permitidos;
}

/**
 * Esta resposta pode sair?
 *
 * PURA: sem banco, sem rede, sem relógio. Quem busca os dados é o chamador; quem
 * decide é esta função — do mesmo jeito que o portão de contato do SDR. Assim
 * cada reprovação é testável caso a caso, e nenhum caminho de envio pode
 * "esquecer" de verificar sem que isso apareça no tipo.
 */
export function verificarResposta(texto: string): Veredito {
  const motivos: MotivoDaReprovacao[] = [];
  const detalhes: string[] = [];

  const limpo = (texto ?? "").trim();
  if (!limpo) {
    return { aprovada: false, motivos: ["vazio"], detalhe: "o modelo devolveu texto vazio" };
  }

  // 1. Preço fora da tabela.
  const permitidos = valoresPermitidos();
  const forasDeTabela = valoresEmReais(limpo).filter((v) => !permitidos.has(v));
  if (forasDeTabela.length) {
    motivos.push("precoForaDaTabela");
    detalhes.push(
      `citou ${forasDeTabela.map((c) => `R$ ${(c / 100).toFixed(2)}`).join(", ")}, ` +
        "que não está na tabela publicada",
    );
  }

  // 2. Prazo.
  const prazo = PROMETE_PRAZO.exec(limpo);
  if (prazo) {
    motivos.push("prometeuPrazo");
    detalhes.push(`prometeu prazo ("${prazo[0].trim()}")`);
  }

  // 3. Garantia de resultado.
  const garantia = GARANTE_RESULTADO.exec(limpo);
  if (garantia) {
    motivos.push("garantiuResultado");
    detalhes.push(`garantiu resultado ("${garantia[0].trim()}")`);
  }

  // 4. Integração inventada — só quando AFIRMADA.
  const inventada = integracaoAfirmadaQueNaoExiste(limpo);
  if (inventada) {
    motivos.push("integracaoInventada");
    detalhes.push(`afirmou integração com ${inventada}, que não existe`);
  }

  // 5. Fechou em nome do cliente.
  const fechou = FECHOU_PELO_CLIENTE.exec(limpo);
  if (fechou) {
    motivos.push("fechouPeloCliente");
    detalhes.push(`disse ter contratado pelo cliente ("${fechou[0].trim()}")`);
  }

  // 6. Negou ser um agente.
  //
  // ⚠️ Vem por último de propósito: as cinco de cima falam do NEGÓCIO (preço,
  // prazo, promessa), e esta fala de QUEM ESTÁ FALANDO. Se um dia só uma
  // reprovação puder ser mostrada, o vendedor precisa ver primeiro a que muda
  // a proposta — mas nenhuma delas é mais grave que esta para quem recebe.
  const negou = NEGOU_SER_AGENTE.exec(limpo);
  if (negou) {
    motivos.push("negouSerAgente");
    detalhes.push(`negou ser um agente ("${negou[0].trim()}")`);
  }

  return {
    aprovada: motivos.length === 0,
    motivos,
    detalhe: motivos.length ? detalhes.join("; ") : "aprovada",
  };
}

/**
 * O nome citado foi AFIRMADO como integração, ou negado?
 *
 * A diferença é a razão de esta função existir em vez de um `includes`. O TA
 * precisa poder dizer "não, não integramos com o iFood" — que é uma resposta
 * honesta e boa. Barrar isso o obrigaria a desviar do assunto justo na pergunta
 * que mais decide a venda.
 */
function integracaoAfirmadaQueNaoExiste(texto: string): string | null {
  const existentes = new Set(integracoesQueExistem());

  // Frase a frase: a negação vale para a frase em que ela está, e não para o
  // parágrafo. "Integramos com Mercado Pago. Não integramos com iFood." tem uma
  // afirmação e uma negação, e tratá-las juntas apagaria as duas.
  for (const frase of texto.split(/(?<=[.!?])\s+|\n+/)) {
    const baixa = frase.toLowerCase();

    // O nome precisa estar na frase antes de valer a pena olhar o verbo.
    const citado = CITADOS_QUE_NAO_EXISTEM.find(
      (nome) => baixa.includes(nome) && !existentes.has(nome),
    );
    if (!citado) continue;

    AFIRMA_INTEGRACAO.lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = AFIRMA_INTEGRACAO.exec(frase)) !== null) {
      // Os poucos caracteres antes do verbo. É aí que "não" mora quando a frase
      // está negando — e é aí que "sem problema nenhum" NÃO está.
      const antes = frase.slice(Math.max(0, m.index - 20), m.index);
      if (NEGA_ANTES_DO_VERBO.test(antes)) continue;

      return citado;
    }
  }

  return null;
}
