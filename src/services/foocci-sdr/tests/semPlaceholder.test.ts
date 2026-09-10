/**
 * ⛔ NENHUMA MENSAGEM SAI COM VARIÁVEL NÃO RESOLVIDA.
 *
 * O pré-voo do modelo confere QUANTAS variáveis saem; ele não olha o conteúdo
 * delas. Um parâmetro com `{{2}}` sobrando, um rascunho `[link do site]` ou um
 * `undefined` coagido a texto passa por todas as travas de contagem — e a Meta
 * aceita numa boa, porque ela confere formato, não sentido.
 *
 * Quem lê "Olá undefined, aqui é a Foocci" é o prospecto, e a abordagem fria só
 * tem uma primeira impressão. Bloquear custa um contato; mandar queima o lead e
 * a reputação do número junto.
 *
 * ⚠️ Os casos que PASSAM valem tanto quanto os que barram: uma trava que barra
 * texto legítimo é desligada na primeira semana, e a partir daí não barra nada.
 */

import { describe, it, expect } from "vitest";
import { temPlaceholderNaoResolvido } from "../semPlaceholder";

describe("o que NÃO sai", () => {
  it("⭐ variável do modelo que ninguém substituiu", () => {
    expect(temPlaceholderNaoResolvido("Olá Marina, aqui é a Foocci — atendemos em {{2}}")).toBe("{{2}}");
  });

  it("variável com espaço dentro também é variável", () => {
    expect(temPlaceholderNaoResolvido("Olá {{ 1 }}")).toBe("{{ 1 }}");
  });

  it("⭐ rascunho entre colchetes — o texto que virou mensagem sem ser preenchido", () => {
    expect(temPlaceholderNaoResolvido("Veja em [link do site]")).toBe("[link do site]");
  });

  it("⭐ `undefined` — o dado que não chegou, coagido a texto", () => {
    expect(temPlaceholderNaoResolvido("Olá undefined, tudo bem?")).toBe("undefined");
  });

  it("`null` e `NaN` pelo mesmo motivo", () => {
    expect(temPlaceholderNaoResolvido("Olá null")).toBe("null");
    expect(temPlaceholderNaoResolvido("São NaN unidades")).toBe("NaN");
  });

  it("devolve o TRECHO, e não `true` — cada ofensor é um conserto diferente", () => {
    // `{{2}}` é modelo trocado; `[cidade]` é rascunho; `undefined` é dado que
    // não chegou. Um booleano mandaria quem investiga abrir o payload à mão.
    const r = temPlaceholderNaoResolvido("Olá {{1}}");
    expect(typeof r).toBe("string");
  });
});

describe("o que passa — e precisa passar", () => {
  it("⭐ texto limpo passa", () => {
    expect(
      temPlaceholderNaoResolvido("Olá Marina, aqui é a Foocci. Posso te mostrar em 2 minutos?"),
    ).toBeNull();
  });

  it("palavras que CONTÊM as proibidas não são barradas", () => {
    // ⚠️ É o `\b` que faz isto: "nullable" contém `null` e "undefinedness"
    // contém `undefined`. Sem a borda, os dois seriam barrados — e uma trava
    // que barra texto legítimo é desligada na primeira semana, e a partir daí
    // não barra mais nada.
    expect(temPlaceholderNaoResolvido("O campo nullable e a undefinedness do caso")).toBeNull();
  });

  it("`nan` minúsculo não é `NaN` — nome de gente não vira defeito", () => {
    expect(temPlaceholderNaoResolvido("Falei com a Nanci ontem")).toBeNull();
  });

  it("texto vazio ou ausente não é ofensa", () => {
    expect(temPlaceholderNaoResolvido("")).toBeNull();
    expect(temPlaceholderNaoResolvido(null)).toBeNull();
    expect(temPlaceholderNaoResolvido(undefined)).toBeNull();
  });
});
