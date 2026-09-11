/**
 * MAPEAMENTO MANUAL — dá ao operador o controle de qual coluna vira qual campo.
 *
 * ── O DEFEITO QUE ISTO EXISTE PARA MATAR ────────────────────────────────────
 *
 * `lerPlanilha` decide sozinho, por cabeçalho ou por conteúdo, e o resultado já
 * sai como `LinhaLida[]` — colunas já colapsadas em campos. Isso é ótimo para
 * a importação normal, mas no enriquecimento o operador pode DISCORDAR do
 * palpite (duas planilhas com "Nome" e "Empresa" trocados de posição, por
 * exemplo) — e a escolha dele precisa REALMENTE mudar o resultado, não só
 * aparecer bonita numa tela que ninguém lê o efeito.
 *
 * Por isso este módulo separa em dois passos o que `lerPlanilha` faz de uma
 * vez: primeiro quebra o texto em GRADE BRUTA (títulos + linhas, sem decidir
 * nada), depois aplica um mapeamento — o AUTOMÁTICO de `lerPlanilha` como
 * ponto de partida, ou o que o operador escolheu na tela.
 *
 * Reaproveita os pedaços puros e já testados de `lerPlanilha.ts`
 * (`detectarSeparador`, `quebrarLinha`, `pareceTelefone`) em vez de duplicá-los
 * — dois parsers de CSV divergindo é exatamente o tipo de fantasma que este
 * arquivo existe para não criar.
 */

import {
  detectarSeparador,
  quebrarLinha,
  pareceTelefone,
  type CampoConhecido,
  type LinhaLida,
} from "./lerPlanilha";

export interface GradeBruta {
  /** Título de cada coluna — o da primeira linha, ou "coluna N" sem cabeçalho. */
  titulos: string[];
  /** TODAS as linhas, cabeçalho incluído quando houver — quem decide é `temCabecalho`. */
  linhas: string[][];
  separador: "," | ";" | "\t";
}

/** Quebra o texto em título + linhas cruas, sem decidir para onde cada coluna vai. */
export function lerGradeBruta(texto: string): GradeBruta {
  const cruas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (cruas.length === 0) return { titulos: [], linhas: [], separador: "," };

  const separador = detectarSeparador(cruas[0]!);
  const grade = cruas.map((l) => quebrarLinha(l, separador));
  const largura = Math.max(...grade.map((l) => l.length));
  const titulos = Array.from(
    { length: largura },
    (_, i) => grade[0]?.[i]?.trim() || `coluna ${i + 1}`,
  );

  return { titulos, linhas: grade, separador };
}

/**
 * Constrói as linhas finais a partir da grade bruta e do mapeamento ESCOLHIDO
 * — índice de coluna → campo, ou `null`/ausente para "não usar".
 *
 * `temCabecalho` diz se a primeira linha da grade é título (e por isso pulada
 * como dado) ou já é a primeira linha de conteúdo.
 */
export function construirLinhasComMapeamento(
  grade: GradeBruta,
  mapeamentoPorIndice: Record<number, CampoConhecido | null>,
  temCabecalho: boolean,
): { linhas: LinhaLida[]; descartadas: number } {
  const indicePorCampo = new Map<CampoConhecido, number>();
  for (const [indiceTexto, campo] of Object.entries(mapeamentoPorIndice)) {
    if (campo) indicePorCampo.set(campo, Number(indiceTexto));
  }

  const indiceWhats = indicePorCampo.get("whatsapp") ?? -1;
  const corpo = temCabecalho ? grade.linhas.slice(1) : grade.linhas;

  const linhas: LinhaLida[] = [];
  let descartadas = 0;

  const pega = (linha: string[], campo: CampoConhecido): string | null => {
    const i = indicePorCampo.get(campo);
    if (i === undefined) return null;
    const v = (linha[i] ?? "").trim();
    return v || null;
  };

  for (const linha of corpo) {
    const whatsapp = indiceWhats >= 0 ? (linha[indiceWhats] ?? "").trim() : "";

    // Sem telefone mapeado — ou sem cara de telefone — não há o que casar.
    if (!whatsapp || !pareceTelefone(whatsapp)) {
      descartadas += 1;
      continue;
    }

    linhas.push({
      nome: pega(linha, "nome"),
      whatsapp,
      empresa: pega(linha, "empresa"),
      cidade: pega(linha, "cidade"),
      estado: pega(linha, "estado"),
      tipo: pega(linha, "tipo"),
    });
  }

  return { linhas, descartadas };
}
