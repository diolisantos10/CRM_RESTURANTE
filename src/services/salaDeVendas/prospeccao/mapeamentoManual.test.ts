/**
 * O mapeamento manual precisa realmente mudar o resultado — achado #7 da
 * auditoria era exatamente a escolha do operador não chegar a lugar nenhum.
 */

import { describe, it, expect } from "vitest";
import { lerGradeBruta, construirLinhasComMapeamento } from "./mapeamentoManual";

describe("lerGradeBruta", () => {
  it("quebra título e corpo sem decidir nada sobre as colunas", () => {
    const grade = lerGradeBruta("Nome,Telefone\nFulano,11987654321\n");
    expect(grade.titulos).toEqual(["Nome", "Telefone"]);
    expect(grade.linhas).toEqual([
      ["Nome", "Telefone"],
      ["Fulano", "11987654321"],
    ]);
    expect(grade.separador).toBe(",");
  });

  it("arquivo vazio devolve grade vazia, sem lançar", () => {
    expect(lerGradeBruta("")).toEqual({ titulos: [], linhas: [], separador: "," });
  });
});

describe("construirLinhasComMapeamento", () => {
  const grade = lerGradeBruta(
    "Nome,Telefone,Cidade\nFulano,11987654321,Curitiba\nBeltrano,não é telefone,SP\n",
  );

  it("aplica o mapeamento escolhido — não redetecta pelo cabeçalho", () => {
    const mapeamento = { 0: "empresa" as const, 1: "whatsapp" as const, 2: "cidade" as const };
    const { linhas, descartadas } = construirLinhasComMapeamento(grade, mapeamento, true);

    expect(descartadas).toBe(1); // "Beltrano" tem telefone inválido
    expect(linhas).toEqual([
      { nome: null, whatsapp: "11987654321", empresa: "Fulano", cidade: "Curitiba", estado: null, tipo: null },
    ]);
  });

  it("coluna marcada como 'não usar' (null) não aparece em nenhum campo", () => {
    const mapeamento = { 0: null, 1: "whatsapp" as const, 2: null };
    const { linhas } = construirLinhasComMapeamento(grade, mapeamento, true);
    expect(linhas[0]).toEqual({
      nome: null,
      whatsapp: "11987654321",
      empresa: null,
      cidade: null,
      estado: null,
      tipo: null,
    });
  });

  it("sem coluna nenhuma mapeada para whatsapp, todas as linhas são descartadas", () => {
    const mapeamento = { 0: "nome" as const, 1: null, 2: "cidade" as const };
    const { linhas, descartadas } = construirLinhasComMapeamento(grade, mapeamento, true);
    expect(linhas).toHaveLength(0);
    expect(descartadas).toBe(2);
  });

  it("sem cabeçalho, a primeira linha inteira é dado", () => {
    const semCabecalho = lerGradeBruta("Fulano,11987654321,Curitiba\n");
    const mapeamento = { 0: "nome" as const, 1: "whatsapp" as const, 2: "cidade" as const };
    const { linhas } = construirLinhasComMapeamento(semCabecalho, mapeamento, false);
    expect(linhas).toEqual([
      { nome: "Fulano", whatsapp: "11987654321", empresa: null, cidade: "Curitiba", estado: null, tipo: null },
    ]);
  });
});
