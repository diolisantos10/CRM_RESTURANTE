/**
 * ⛔ O CONTRATO EXATO DO MODELO — P0.2, 10/09/2026.
 *
 * O envio montava `nome ? [nome] : []`: **o formato do payload mudava com o
 * contato**. Contra um modelo de `{{1}}`, quem tinha nome passava e quem não
 * tinha era recusado pela Meta — e a rodada só descobria isso queimando
 * contatos, um a um. O template aprovado tem contrato fixo; o payload também.
 */

import { describe, it, expect } from "vitest";
import { montarParametros } from "./abordar";
import { parametrosQueOEnvioMonta } from "@/services/foocci-sdr/modelosDaMeta";

const COM_TUDO = {
  nome: "Marina Gambarini",
  restaurante: "Divino Sabor",
  fonte: "LISTA_PROSPECCAO",
  cidade: "Guarulhos",
  proveniencia: "lista pública de estabelecimentos",
};
const SEM_NOME = { nome: null, restaurante: "Bar 1 Conto", fonte: "LISTA_PROSPECCAO", cidade: "Santos", proveniencia: "Google Maps" };
const SEM_PROVENIENCIA = { nome: "Omar Freitas", restaurante: "Bar 1 Conto", fonte: null, proveniencia: null };
/** Nome que é telefone + sem restaurante: não há saudação possível. */
const SEM_SAUDACAO = { nome: "5511999998888", restaurante: null, fonte: null, cidade: null };

describe("a montagem é EXATA", () => {
  it("modelo de zero variáveis manda zero, mesmo com o contato completo", () => {
    const r = montarParametros(0, COM_TUDO);
    expect(r.ok && r.parametros).toEqual([]);
  });

  it("⭐ modelo de uma variável manda exatamente uma", () => {
    const r = montarParametros(1, COM_TUDO);
    expect(r.ok && r.parametros).toHaveLength(1);
  });

  it("modelo aprovado manda nome, restaurante e procedência na ordem literal", () => {
    const r = montarParametros(3, COM_TUDO);
    expect(r.ok && r.parametros).toEqual(["Divino Sabor", "Divino Sabor", "lista pública de estabelecimentos"]);
  });

  it("modelo de duas manda as duas primeiras variáveis do contrato", () => {
    const r = montarParametros(2, COM_TUDO);
    expect(r.ok && r.parametros).toEqual(["Divino Sabor", "Divino Sabor"]);
  });

  it("contato sem nome usa o restaurante na saudação — não fica vazio", () => {
    const r = montarParametros(1, SEM_NOME);
    expect(r.ok).toBe(true);
    expect(r.ok && r.parametros[0]).toBeTruthy();
  });
});

describe("⛔ o que NÃO sai", () => {
  it("falta dado para a variável → RECUSA antes do envio, dizendo qual", () => {
    const r = montarParametros(3, SEM_PROVENIENCIA);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.falta).toContain("{{3}}");
  });

  it("modelo pede mais variáveis do que o sistema sabe preencher → recusa", () => {
    const r = montarParametros(5, COM_TUDO);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.falta).toContain("5");
  });

  it("⛔ nunca inventa conteúdo para tapar buraco", () => {
    // A tentação é preencher com "cliente", "-" ou espaço. Texto inventado no
    // meio de uma abordagem é pior que abordagem nenhuma.
    const r = montarParametros(1, SEM_SAUDACAO);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.falta).toContain("{{1}}");
  });
});

describe("o contrato vem do ambiente, e só aperta o que é válido", () => {
  it("sem variável, o padrão é 1 — o modelo em uso hoje", () => {
    expect(parametrosQueOEnvioMonta({})).toBe(1);
  });

  it("valor válido vale", () => {
    expect(parametrosQueOEnvioMonta({ FOOCCI_SDR_MODELO_VARIAVEIS: "0" })).toBe(0);
    expect(parametrosQueOEnvioMonta({ FOOCCI_SDR_MODELO_VARIAVEIS: "2" })).toBe(2);
  });

  it("sonda de controle: lixo cai no padrão, e não em zero", () => {
    // Zero por acidente mudaria o formato do que sai para o cliente sem
    // ninguém ter decidido.
    for (const v of ["", " ", "abc", "-1", "2,5", "99"]) {
      expect(parametrosQueOEnvioMonta({ FOOCCI_SDR_MODELO_VARIAVEIS: v }), v).toBe(1);
    }
  });
});
