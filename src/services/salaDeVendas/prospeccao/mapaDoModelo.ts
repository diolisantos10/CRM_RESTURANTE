/**
 * O MAPA DO MODELO — qual campo do contato entra em cada `{{n}}`.
 *
 * ── POR QUE ISTO EXISTE, com o custo medido ─────────────────────────────────
 *
 * Até 10/09/2026 o envio mandava **um** parâmetro (a saudação) para qualquer
 * modelo. O modelo aprovado na Meta, `abordagem_restaurante_fria`, espera
 * **três**. A Meta recusou tudo com `(#132000) Number of parameters does not
 * match` — e a rodada aprendeu isso queimando seis contatos de uma lista de
 * 4.000 (08/09).
 *
 * A quantidade e a ordem das variáveis são **do modelo**, não do código. Por
 * isso o mapa é **por modelo**, pelo nome que a Meta registrou: trocar de modelo
 * é registrar outro mapa aqui, não reescrever o envio.
 *
 * ── O MAPA DE `abordagem_restaurante_fria` — decisão do Diretor Geral, 10/09 ─
 *
 *   Corpo na Meta: "Olá, {{1}}! Aqui é a Foocci, uma plataforma de atendimento
 *   e pedidos para restaurantes. Estou falando com o {{2}} porque encontramos o
 *   contato de vocês em {{3}}. Faz sentido eu te mostrar em 5 minutos como
 *   funciona? Se preferir não receber mais mensagens nossas, responda SAIR."
 *
 *   {{1}} = nome do restaurante
 *   {{2}} = nome do restaurante
 *   {{3}} = bairro + ", " + cidade  (bairro vazio → cidade; cidade vazia → estado)
 *
 * A lista fria **não tem nome de pessoa**: a coluna `nome` é o restaurante. A
 * repetição {{1}}/{{2}} é defeito de copy do modelo, não do mapa — o Diretor
 * Geral leva ao CEO um modelo novo sem nome de pessoa. Até lá, este é o que sai.
 *
 * ── A REGRA DURA: CAMPO VAZIO PULA O ITEM ───────────────────────────────────
 *
 * Nunca string vazia para a Meta. "Olá, ! Aqui é a Foocci" é pior que não
 * mandar: parece defeito, porque é. Campo vazio devolve `campoVazio:{{n}}`, e
 * quem chama pula o item com esse motivo — legível na tela e no extrato.
 *
 * ── E O PRÉ-VOO CONFERE O MAPA CONTRA A META ────────────────────────────────
 *
 * `conferirMapaContraModelo` compara o tamanho do mapa com o número de `{{n}}`
 * que a Meta diz que o modelo tem, e reprova **nomeando a variável que falta**
 * (ou que sobra). Modelo sem mapa registrado também reprova — mandar chute é o
 * que a regra existe para impedir.
 */

/** Os dados do contato de onde o mapa tira os valores. Tudo pode faltar. */
export interface DadosDoContato {
  restaurante: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
}

/**
 * Os campos que um `{{n}}` pode receber.
 *
 * `localidade` é composto: bairro + ", " + cidade, com as quedas descritas no
 * cabeçalho. É um campo próprio (e não "bairro" e "cidade" soltos) porque a
 * queda é regra de negócio do mapa, não formatação de quem chama.
 */
export type CampoDoMapa = "restaurante" | "localidade";

/** Mapa por nome de modelo. Posição 0 é `{{1}}`. */
const MAPAS: Readonly<Record<string, readonly CampoDoMapa[]>> = {
  abordagem_restaurante_fria: ["restaurante", "restaurante", "localidade"],
};

/** O mapa registrado para o modelo, ou `null` — nunca um mapa inventado. */
export function mapaDoModelo(nomeDoModelo: string): readonly CampoDoMapa[] | null {
  const nome = (nomeDoModelo ?? "").trim();
  if (!nome) return null;
  return MAPAS[nome] ?? null;
}

function limpo(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t : null;
}

/** O valor de um campo do mapa, ou `null` quando não há o que mandar. */
export function valorDoCampo(campo: CampoDoMapa, dados: DadosDoContato): string | null {
  switch (campo) {
    case "restaurante": {
      const r = limpo(dados.restaurante);
      // Restaurante cujo "nome" é o próprio telefone não vira saudação —
      // "Olá, 5511999998888!" é pior que pular.
      if (!r || /^[\d\s()+-]+$/.test(r)) return null;
      return r;
    }
    case "localidade": {
      const bairro = limpo(dados.bairro);
      const cidade = limpo(dados.cidade);
      const estado = limpo(dados.estado);
      if (bairro && cidade) return `${bairro}, ${cidade}`;
      if (cidade) return cidade;
      // Bairro sem cidade não localiza ninguém; cai para o estado.
      return estado;
    }
    default: {
      const nunca: never = campo;
      return nunca;
    }
  }
}

export type ParametrosMontados =
  | { ok: true; parametros: string[] }
  | { ok: false; causa: "semMapa"; detalhe: string }
  | {
      ok: false;
      causa: "campoVazio";
      /** 1-based: a variável `{{n}}` que ficou sem valor. */
      variavel: number;
      /** Sempre no formato `campoVazio:{{n}}` — é o que vai para o motivo do item. */
      detalhe: string;
    };

/** Monta `{{1}}…{{n}}` para o modelo, ou diz exatamente por que não dá. */
export function montarParametros(nomeDoModelo: string, dados: DadosDoContato): ParametrosMontados {
  const mapa = mapaDoModelo(nomeDoModelo);
  if (!mapa) {
    return {
      ok: false,
      causa: "semMapa",
      detalhe: `o modelo "${nomeDoModelo}" não tem mapa de variáveis registrado (mapaDoModelo.ts)`,
    };
  }

  const parametros: string[] = [];
  for (let i = 0; i < mapa.length; i += 1) {
    const valor = valorDoCampo(mapa[i]!, dados);
    if (!valor) {
      return { ok: false, causa: "campoVazio", variavel: i + 1, detalhe: `campoVazio:{{${i + 1}}}` };
    }
    parametros.push(valor);
  }
  return { ok: true, parametros };
}

export type ConferenciaDoMapa =
  | { ok: true; parametros: number }
  | { ok: false; causa: "semMapa" | "variaveisNaoBatem"; detalhe: string };

/**
 * O mapa bate com o que a Meta diz que o modelo espera?
 *
 * Reprova nomeando a variável: "falta {{3}}" manda alguém registrar o campo
 * certo; "espera 3 e o envio manda 1" mandava investigar.
 */
export function conferirMapaContraModelo(
  nomeDoModelo: string,
  variaveisDoModelo: number,
): ConferenciaDoMapa {
  const mapa = mapaDoModelo(nomeDoModelo);

  if (!mapa) {
    // Modelo sem variável não precisa de mapa: não há o que mapear.
    if (variaveisDoModelo === 0) return { ok: true, parametros: 0 };
    return {
      ok: false,
      causa: "semMapa",
      detalhe:
        `o modelo "${nomeDoModelo}" espera ${variaveisDoModelo} variável(is) e não tem mapa ` +
        `registrado — sem mapa, {{1}}…{{${variaveisDoModelo}}} sairiam no chute`,
    };
  }

  if (mapa.length < variaveisDoModelo) {
    const faltam = Array.from(
      { length: variaveisDoModelo - mapa.length },
      (_, i) => `{{${mapa.length + i + 1}}}`,
    );
    return {
      ok: false,
      causa: "variaveisNaoBatem",
      detalhe: `o modelo espera ${variaveisDoModelo} variável(is) e o mapa cobre ${mapa.length}: falta ${faltam.join(", ")}`,
    };
  }

  if (mapa.length > variaveisDoModelo) {
    const sobram = Array.from(
      { length: mapa.length - variaveisDoModelo },
      (_, i) => `{{${variaveisDoModelo + i + 1}}}`,
    );
    return {
      ok: false,
      causa: "variaveisNaoBatem",
      detalhe: `o modelo espera ${variaveisDoModelo} variável(is) e o mapa manda ${mapa.length}: sobra ${sobram.join(", ")}`,
    };
  }

  return { ok: true, parametros: mapa.length };
}
