/**
 * ⭐⭐⭐ A SENHA PROVISÓRIA VIAJA DE MÁQUINA PARA MÁQUINA.
 *
 * ── A ORDEM, E POR QUE ESTE ARQUIVO É O JEITO CERTO DE CUMPRI-LA ────────────
 *
 * CEO, 05/09/2026: *"Você vai passar a senha pela caixa de entrada e avisar que
 * essa senha é só para entrar, e fazer a senha dele."*
 *
 * O jeito errado seria alguém ler a senha na tela e digitá-la numa conversa.
 * Aí ela passa por uma pessoa, por um chat, e por qualquer lugar que guarde
 * esse chat. Aqui ela sai de `criarPessoa` e entra na caixa do crachá **sem
 * passar por olho humano nenhum** — nem o de quem criou o acesso.
 *
 * ── ⚠️ E ELA VAI PARA UMA TRILHA QUE NÃO SE APAGA ──────────────────────────
 *
 * A caixa do Connect é append-only. O texto com a senha fica lá para sempre.
 * Isso é aceitável por **duas** travas que existem do outro lado, e só por elas:
 *
 *   1. **PODER** — a provisória não abre nada. Ela só abre a tela de definir a
 *      senha (`ROTA_DA_TROCA`); toda a operação fica fechada até a troca.
 *   2. **TEMPO** — ela vence. Passado o prazo, o texto na caixa descreve uma
 *      senha que não entra mais em lugar nenhum.
 *
 * Sem as duas, mandar senha por caixa postal seria um defeito. Com as duas, o
 * que fica registrado é um segredo que já morreu.
 *
 * ⛔ **Nunca lança.** O acesso já foi criado quando esta função roda: derrubar a
 * criação porque o aviso falhou seria trocar "a pessoa não recebeu o recado" por
 * "a pessoa não tem acesso". O defeito volta como campo, e quem chamou decide.
 */

import { VARIAVEL_DA_URL_DO_NUCLEO } from "@/services/connect/conector/contrato";
import { VARIAVEL_DO_SEGREDO } from "@/services/connect/porta";

/** No NÚCLEO: a porta genérica de mensagem entre crachás. */
const CAMINHO_DA_MENSAGEM = "/api/connect/mensagem";

/** Teto de espera. O aviso não pode segurar a tela de quem criou o acesso. */
const TETO_MS = 5_000;

export type ResultadoDoAviso =
  | { avisou: true; mensagemId: string }
  | { avisou: false; motivo: string };

/**
 * O texto do recado.
 *
 * ⚠️ A primeira frase diz **o que a senha NÃO faz**. Quem recebe uma senha
 * assume que ela abre o sistema; descobrir depois que não abre parece defeito.
 * Dizer antes transforma a mesma tela numa etapa esperada.
 */
export function corpoDoAviso(dados: {
  senha: string;
  urlDaTroca: string;
  expiraEm: Date;
}): string {
  return [
    "Seu acesso foi criado. A senha abaixo é PROVISÓRIA e serve para uma coisa só:",
    "entrar e definir a sua própria senha. Ela não abre mais nada do sistema.",
    "",
    `    senha provisória: ${dados.senha}`,
    `    onde usar:        ${dados.urlDaTroca}`,
    `    vale até:         ${dados.expiraEm.toISOString()}`,
    "",
    "Assim que você definir a sua, esta morre — e ninguém além de você conhece a nova.",
    "Se o prazo vencer antes, peça outra: a que está aqui deixa de entrar sozinha.",
    "",
    "⚠️ Esta caixa é um histórico que não se apaga. É por isso que a senha acima",
    "não abre a operação e tem prazo: o que fica registrado aqui é um segredo que",
    "já venceu.",
  ].join("\n");
}

/**
 * Manda a senha provisória para a caixa do crachá, pelo canal que já existe.
 *
 * ⚠️ `buscar` é injetável para a suíte nunca falar com o núcleo de verdade —
 * mesma régua do resto da casa.
 */
export async function avisarAcessoCriado(
  dados: {
    crachaConnect: string;
    /** O crachá do produto que assina o recado. */
    de: string;
    senha: string;
    urlDaTroca: string;
    expiraEm: Date;
  },
  buscar: typeof fetch = fetch,
): Promise<ResultadoDoAviso> {
  const url = process.env[VARIAVEL_DA_URL_DO_NUCLEO];
  const segredo = process.env[VARIAVEL_DO_SEGREDO];

  // ⛔ FAIL-CLOSED, e em silêncio útil: sem canal configurado não há para onde
  // mandar, e isso não é erro — é a casa ainda não ligada ao núcleo. O motivo
  // volta nomeado para a tela poder dizer "a senha está aqui, copie".
  if (!url || !segredo) {
    return { avisou: false, motivo: `canal do Connect não configurado (${VARIAVEL_DA_URL_DO_NUCLEO}/${VARIAVEL_DO_SEGREDO})` };
  }
  if (!dados.crachaConnect.trim()) {
    return { avisou: false, motivo: "esta pessoa não tem crachá no Connect" };
  }

  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TETO_MS);
  try {
    const r = await buscar(`${url.replace(/\/+$/, "")}${CAMINHO_DA_MENSAGEM}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dioli-connect-secret": segredo,
      },
      body: JSON.stringify({
        de: dados.de,
        para: dados.crachaConnect.trim().toLowerCase(),
        tipo: "conversa",
        assunto: "Seu acesso foi criado — senha provisória",
        corpo: corpoDoAviso(dados),
        // ⚠️ `restrito`: o corpo carrega um segredo vivo até a troca. A
        // classificação é o que impede este texto de ser lido por um motor de
        // IA lá do outro lado — o egresso recusa tudo que não é público ou
        // interno.
        classificacao: "restrito",
        // Um aviso por acesso criado. Reenvio de tela não vira segunda senha na
        // caixa dizendo coisa diferente da primeira.
        idempotencia: `aviso-de-acesso:${dados.crachaConnect}:${dados.expiraEm.toISOString()}`,
      }),
      signal: controle.signal,
    });

    const corpo = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.status !== 201) {
      // ⛔ Sem eco do corpo enviado na mensagem de erro: ele contém a senha.
      return { avisou: false, motivo: `o núcleo recusou o aviso (HTTP ${r.status}, ${String(corpo.codigo ?? "sem código")})` };
    }
    return { avisou: true, mensagemId: String(corpo.mensagemId ?? "") };
  } catch (erro) {
    const nome = erro instanceof Error ? erro.name : "erro";
    return { avisou: false, motivo: nome === "AbortError" ? "o núcleo não respondeu a tempo" : nome };
  } finally {
    clearTimeout(relogio);
  }
}
