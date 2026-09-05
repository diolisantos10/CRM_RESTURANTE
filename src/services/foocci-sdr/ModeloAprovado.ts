/**
 * OS MODELOS APROVADOS PELA META — a chave que falta para a casa falar primeiro.
 *
 * ── POR QUE ISTO EXISTE, E POR QUE ELE NASCE VAZIO ──────────────────────────
 *
 * A Meta separa dois atos que, para nós, pareciam o mesmo:
 *
 *   · **responder** quem escreveu → texto livre, dentro da janela de 24 h;
 *   · **começar** a conversa      → só com um **modelo aprovado** por ela.
 *
 * Quem preencheu o formulário e não apertou enviar no WhatsApp **nunca escreveu
 * para a gente**. Não existe janela de 24 h aberta com essa pessoa — nunca
 * existiu. Então a primeira mensagem para ela é, por definição da Meta, uma
 * mensagem iniciada pela empresa, e texto livre ali **é recusado pela Graph API**
 * (`decideMetaSend` já dizia isso; ver `src/services/whatsapp/metaSendPolicy.ts`).
 *
 * ── ⚠️ O ESTADO MEDIDO EM 05/09/2026, E ELE É "NÃO TEM" ────────────────────
 *
 * Varredura no repositório inteiro por nome de modelo do canal de vendas:
 * **nenhum**. As únicas variáveis do canal são `FOOCCI_SALES_PROVIDER`,
 * `FOOCCI_SALES_PHONE_NUMBER_ID`, `FOOCCI_SALES_ACCESS_TOKEN` e
 * `FOOCCI_SALES_WHATSAPP_ATIVO`. Não há modelo declarado, e **eu não tenho como
 * medir daqui o que está aprovado dentro da conta da Meta** — isso exige o token
 * de vendas, que não é meu. O que está escrito aqui é o que se sabe do código:
 * *nenhum modelo declarado*. O que está aprovado do lado da Meta é pergunta para
 * o `meta`, com o token na mão.
 *
 * Por isso este arquivo é uma **fechadura vazia**: ele lê do ambiente o nome do
 * modelo, e devolve `null` enquanto ninguém o preencher. `null` faz a fila
 * inteira barrar com `SEM_MODELO_APROVADO` — visível, com motivo, em vez de uma
 * recusa da Meta descoberta no primeiro lead real.
 *
 * ── E POR QUE NÃO CHAMAR UM MODELO DE IA PARA ESCREVER A ABERTURA ───────────
 *
 * Porque não caberia mesmo que coubesse no caixa: o texto da primeira mensagem
 * **é o do modelo aprovado**, palavra por palavra. A Meta aprova o texto, não a
 * intenção. Redigir na hora produziria um texto que a Meta recusa — gastando
 * chamada de modelo para chegar em nada. Aqui não há IA nenhuma, de propósito e
 * por duas razões que apontam para o mesmo lugar.
 */

/** Os dois papéis que o desenho permite: uma abertura e um lembrete. Só. */
export type PapelDoModelo = "ABERTURA" | "LEMBRETE";

/**
 * Os campos do lead que podem preencher `{{1}}`, `{{2}}`… de um modelo.
 *
 * Lista fechada de propósito: parâmetro que sai de campo livre é por onde entra
 * texto que ninguém revisou numa mensagem que a Meta aprovou como fixa.
 */
export type CampoDoModelo = "nome" | "restaurante" | "cidade";

const CAMPOS_ACEITOS: readonly CampoDoModelo[] = ["nome", "restaurante", "cidade"];

export interface ModeloAprovado {
  papel: PapelDoModelo;
  /** O `name` do modelo dentro da Meta. É ele que vai no payload. */
  nome: string;
  /** `language.code` — `pt_BR` salvo declaração em contrário. */
  idioma: string;
  /** Campos que preenchem os parâmetros do corpo, NA ORDEM. Pode ser vazio. */
  parametros: CampoDoModelo[];
  /**
   * O corpo aprovado, com `{{1}}`, para a Sala mostrar o que foi dito.
   * `null` = ninguém declarou, e aí a conversa guarda uma linha descritiva em
   * vez de inventar a frase.
   */
  corpo: string | null;
}

/** Os dados do lead que podem virar parâmetro. Nada além disto é lido. */
export interface DadosDoLeadParaModelo {
  nome: string | null;
  restaurante: string | null;
  cidade: string | null;
}

function env(nome: string): string | null {
  const v = process.env[nome];
  return v && v.trim() !== "" ? v.trim() : null;
}

const SUFIXO: Record<PapelDoModelo, string> = {
  ABERTURA: "FOOCCI_SALES_TEMPLATE_ABERTURA",
  LEMBRETE: "FOOCCI_SALES_TEMPLATE_LEMBRETE",
};

/**
 * O modelo declarado para este papel, ou `null` se ninguém declarou.
 *
 * ⚠️ Declarado no ambiente **não é** aprovado na Meta. Esta função responde
 * "alguém disse qual modelo usar?", e é o máximo que o código consegue saber
 * sozinho. Se o nome estiver errado, quem recusa é a Meta, com erro registrado
 * na mensagem — nunca em silêncio.
 */
export function modeloAprovado(papel: PapelDoModelo): ModeloAprovado | null {
  const base = SUFIXO[papel];
  const nome = env(base);
  if (!nome) return null;

  const crus = (env(`${base}_PARAMS`) ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x !== "");

  // Campo que não está na lista fechada é ERRO DE CONFIGURAÇÃO, e erro de
  // configuração não vira "manda sem esse parâmetro": um modelo com {{1}} vazio
  // é recusado pela Meta, e um modelo com parâmetro a menos também. Devolver
  // null aqui faz a fila inteira barrar com motivo, que é o que se quer ver.
  for (const c of crus) {
    if (!(CAMPOS_ACEITOS as readonly string[]).includes(c)) return null;
  }

  return {
    papel,
    nome,
    idioma: env(`${base}_IDIOMA`) ?? "pt_BR",
    parametros: crus as CampoDoModelo[],
    corpo: env(`${base}_CORPO`),
  };
}

export type Renderizacao =
  | { ok: true; parametros: string[]; texto: string }
  | { ok: false; motivo: string };

/**
 * Preenche os parâmetros do modelo com os dados deste lead.
 *
 * ── PARÂMETRO VAZIO É RECUSA, NÃO ESPAÇO EM BRANCO ──────────────────────────
 *
 * A Graph API rejeita parâmetro vazio, e um `Olá, !` mandado para um dono de
 * restaurante é pior que não mandar nada. Um lead sem o campo que o modelo exige
 * **não é abordado** — ele fica na lista de barrados, com o motivo escrito, e
 * alguém decide o que fazer com ele.
 */
export function renderizarModelo(
  modelo: ModeloAprovado,
  lead: DadosDoLeadParaModelo,
): Renderizacao {
  const valores: string[] = [];

  for (const campo of modelo.parametros) {
    const cru = campo === "nome" ? lead.nome : campo === "restaurante" ? lead.restaurante : lead.cidade;
    const v = (cru ?? "").trim();
    if (v === "") {
      return {
        ok: false,
        motivo: `o modelo "${modelo.nome}" exige o campo "${campo}" e este contato não tem esse dado`,
      };
    }
    // Primeiro nome, e não o nome inteiro: "Olá, José Carlos da Silva Júnior"
    // denuncia formulário. O corte vale só para `nome` — cidade e restaurante
    // vão inteiros.
    valores.push(campo === "nome" ? primeiroNome(v) : v);
  }

  return { ok: true, parametros: valores, texto: textoDoModelo(modelo, valores) };
}

/** O primeiro nome, com o resto descartado. Nunca devolve vazio. */
export function primeiroNome(nomeCompleto: string): string {
  const primeiro = nomeCompleto.trim().split(/\s+/)[0] ?? "";
  return primeiro === "" ? nomeCompleto.trim() : primeiro;
}

/**
 * O que fica guardado na conversa como "o que a gente disse".
 *
 * Com o corpo declarado, é a frase de verdade, com os parâmetros no lugar. Sem
 * ele, é uma linha que diz qual modelo saiu e com o quê — feia, e honesta. O que
 * não pode existir é uma frase bonita inventada aqui: a Sala mostraria ao
 * vendedor um texto que a pessoa nunca recebeu.
 */
export function textoDoModelo(modelo: ModeloAprovado, valores: string[]): string {
  if (modelo.corpo) {
    return modelo.corpo.replace(/\{\{(\d+)\}\}/g, (achado, n: string) => {
      const v = valores[Number(n) - 1];
      return v === undefined ? achado : v;
    });
  }
  const comQue = valores.length > 0 ? ` (${valores.join(" · ")})` : "";
  return `[modelo aprovado "${modelo.nome}"${comQue}]`;
}
