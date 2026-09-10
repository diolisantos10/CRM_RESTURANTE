/**
 * O mapa do modelo, medido.
 *
 * O que estes casos guardam: a Meta nunca recebe string vazia, o item sem campo
 * é pulado com o motivo `campoVazio:{{n}}`, e o pré-voo reprova NOMEANDO a
 * variável que falta — o defeito de 08/09 custou seis contatos para aprender
 * "espera 3, mandamos 1", sem dizer quais.
 */

import { describe, it, expect } from "vitest";
import {
  montarParametros,
  conferirMapaContraModelo,
  mapaDoModelo,
  valorDoCampo,
} from "./mapaDoModelo";

const COMPLETO = { restaurante: "Bar do Zé", bairro: "Pinheiros", cidade: "São Paulo", estado: "SP" };

describe("⭐ o mapa de abordagem_restaurante_fria — decisão do Diretor Geral, 10/09/2026", () => {
  it("{{1}} e {{2}} = restaurante; {{3}} = bairro, cidade", () => {
    expect(mapaDoModelo("abordagem_restaurante_fria")).toEqual(["restaurante", "restaurante", "localidade"]);
    expect(montarParametros("abordagem_restaurante_fria", COMPLETO)).toEqual({
      ok: true,
      parametros: ["Bar do Zé", "Bar do Zé", "Pinheiros, São Paulo"],
    });
  });

  it("bairro vazio → cidade; cidade vazia → estado", () => {
    expect(valorDoCampo("localidade", { ...COMPLETO, bairro: null })).toBe("São Paulo");
    expect(valorDoCampo("localidade", { ...COMPLETO, bairro: "  " })).toBe("São Paulo");
    expect(valorDoCampo("localidade", { ...COMPLETO, bairro: null, cidade: null })).toBe("SP");
    // Bairro sem cidade não localiza: cai para o estado, não fica "Pinheiros, ".
    expect(valorDoCampo("localidade", { ...COMPLETO, cidade: null })).toBe("SP");
  });

  it("⛔ campo vazio PULA o item com `campoVazio:{{n}}` — nunca string vazia para a Meta", () => {
    expect(montarParametros("abordagem_restaurante_fria", { ...COMPLETO, restaurante: null })).toEqual({
      ok: false, causa: "campoVazio", variavel: 1, detalhe: "campoVazio:{{1}}",
    });
    expect(
      montarParametros("abordagem_restaurante_fria", { ...COMPLETO, bairro: null, cidade: null, estado: null }),
    ).toEqual({ ok: false, causa: "campoVazio", variavel: 3, detalhe: "campoVazio:{{3}}" });
  });

  it("restaurante que é telefone não vira saudação", () => {
    expect(valorDoCampo("restaurante", { ...COMPLETO, restaurante: "+55 (11) 99999-8888" })).toBeNull();
  });

  it("modelo sem mapa não sai no chute", () => {
    const r = montarParametros("modelo_que_ninguem_mapeou", COMPLETO);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.causa).toBe("semMapa");
    expect(r.detalhe).toContain("modelo_que_ninguem_mapeou");
  });
});

describe("⭐ o pré-voo confere o mapa contra a Meta", () => {
  it("três variáveis na Meta, três no mapa: pronto, e diz quantas manda", () => {
    expect(conferirMapaContraModelo("abordagem_restaurante_fria", 3)).toEqual({ ok: true, parametros: 3 });
  });

  it("⭐ reprova NOMEANDO a variável que falta", () => {
    const r = conferirMapaContraModelo("abordagem_restaurante_fria", 4);
    expect(r).toMatchObject({ ok: false, causa: "variaveisNaoBatem" });
    if (r.ok) return;
    expect(r.detalhe).toContain("falta {{4}}");
  });

  it("reprova nomeando a variável que SOBRA — mandar a mais também é recusa da Meta", () => {
    const r = conferirMapaContraModelo("abordagem_restaurante_fria", 2);
    expect(r).toMatchObject({ ok: false, causa: "variaveisNaoBatem" });
    if (r.ok) return;
    expect(r.detalhe).toContain("sobra {{3}}");
  });

  it("modelo com variáveis e sem mapa: reprova por `semMapa`", () => {
    const r = conferirMapaContraModelo("foocci_abordagem_v1", 1);
    expect(r).toMatchObject({ ok: false, causa: "semMapa" });
  });

  it("modelo SEM variável não precisa de mapa", () => {
    expect(conferirMapaContraModelo("aviso_sem_variavel", 0)).toEqual({ ok: true, parametros: 0 });
  });
});
