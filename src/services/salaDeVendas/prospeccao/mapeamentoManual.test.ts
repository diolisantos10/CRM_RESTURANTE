/**
 * O mapeamento manual precisa realmente mudar o resultado — achado #7 da
 * auditoria era exatamente a escolha do operador não chegar a lugar nenhum.
 */

import { describe, it, expect } from "vitest";
import { lerGradeBruta, construirLinhasComMapeamento } from "./mapeamentoManual";
import type { LinhaLida } from "./lerPlanilha";

/**
 * Uma `LinhaLida` com todos os catorze campos da ampliação de 11/09/2026 no
 * padrão vazio. As asserções abaixo só sobrescrevem o que o caso testa —
 * sem isto, todo `toEqual` teria de listar vinte campos para comparar três.
 */
const LINHA_VAZIA: LinhaLida = {
  nome: null,
  whatsapp: "",
  empresa: null,
  cidade: null,
  estado: null,
  tipo: null,
  email: null,
  cargo: null,
  telefoneSecundario: null,
  bairro: null,
  endereco: null,
  cep: null,
  cnpj: null,
  instagram: null,
  site: null,
  googleMapsUrl: null,
  numeroDeUnidades: null,
  canaisAtuais: [],
  observacoes: null,
  tags: [],
};

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
      { ...LINHA_VAZIA, whatsapp: "11987654321", empresa: "Fulano", cidade: "Curitiba" },
    ]);
  });

  it("coluna marcada como 'não usar' (null) não aparece em nenhum campo", () => {
    const mapeamento = { 0: null, 1: "whatsapp" as const, 2: null };
    const { linhas } = construirLinhasComMapeamento(grade, mapeamento, true);
    expect(linhas[0]).toEqual({ ...LINHA_VAZIA, whatsapp: "11987654321" });
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
      { ...LINHA_VAZIA, nome: "Fulano", whatsapp: "11987654321", cidade: "Curitiba" },
    ]);
  });

  it("⭐ mapeia os catorze campos novos, inclusive lista e número", () => {
    const g = lerGradeBruta(
      "Tel,Cargo,Unidades,Canais,Obs\n" +
        "11987654321,Sócio,3,\"iFood, Rappi\",Cliente antigo\n",
    );
    const mapeamento = {
      0: "whatsapp" as const,
      1: "cargo" as const,
      2: "numeroDeUnidades" as const,
      3: "canaisAtuais" as const,
      4: "observacoes" as const,
    };
    const { linhas } = construirLinhasComMapeamento(g, mapeamento, true);
    expect(linhas).toEqual([
      {
        ...LINHA_VAZIA,
        whatsapp: "11987654321",
        cargo: "Sócio",
        numeroDeUnidades: 3,
        canaisAtuais: ["iFood", "Rappi"],
        observacoes: "Cliente antigo",
      },
    ]);
  });
});
