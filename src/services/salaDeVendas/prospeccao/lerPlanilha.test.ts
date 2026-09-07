/**
 * A leitura da planilha, medida.
 *
 * Este é o ponto onde o erro NÃO aparece: coluna trocada não quebra nada, não
 * gera exceção, não pinta nada de vermelho. Só faz a Foocci mandar "Olá
 * 5511988887777" para o dono de um restaurante.
 *
 * Por isso a maioria destes casos é sobre **não trocar coluna**.
 */

import { describe, it, expect } from "vitest";
import { lerPlanilha, quebrarLinha, detectarSeparador, pareceTelefone } from "./lerPlanilha";

describe("com cabeçalho", () => {
  it("⭐ usa os nomes das colunas, que é a intenção declarada de quem montou", () => {
    const r = lerPlanilha(
      ["nome,whatsapp,cidade", "Marina,11988887777,São Paulo", "Omar,11977776666,Santos"].join("\n"),
    );

    expect(r.temCabecalho).toBe(true);
    expect(r.linhas).toHaveLength(2);
    expect(r.linhas[0]).toMatchObject({
      nome: "Marina",
      whatsapp: "11988887777",
      cidade: "São Paulo",
    });
  });

  it("entende sinônimos e ignora acento e maiúscula", () => {
    const r = lerPlanilha(
      ["Razão Social;Telefone;UF", "Bar do Zé;11988887777;SP"].join("\n"),
    );
    expect(r.linhas[0]).toMatchObject({
      empresa: "Bar do Zé",
      whatsapp: "11988887777",
      estado: "SP",
    });
  });

  it("coluna que a casa não conhece é IGNORADA, e a tela vê que foi", () => {
    const r = lerPlanilha(["nome,whatsapp,faturamento", "Marina,11988887777,90000"].join("\n"));
    const ignorada = r.colunas.find((c) => c.titulo === "faturamento");
    expect(ignorada?.campo).toBeNull();
    expect(ignorada?.porque).toBe("ignorada");
  });

  it("⛔ cabeçalho SEM telefone não é tratado como cabeçalho", () => {
    // Senão a primeira linha de dados sumiria da lista sem ninguém notar.
    const r = lerPlanilha(["tipo,categoria", "pizzaria,italiana"].join("\n"));
    expect(r.temCabecalho).toBe(false);
  });
});

describe("sem cabeçalho", () => {
  it("acha o telefone pelo conteúdo e diz que foi palpite", () => {
    const r = lerPlanilha(["Marina,11988887777", "Omar,11977776666"].join("\n"));

    expect(r.temCabecalho).toBe(false);
    expect(r.linhas[0]).toMatchObject({ nome: "Marina", whatsapp: "11988887777" });
    expect(r.colunas.find((c) => c.campo === "whatsapp")?.porque).toBe("conteudo");
  });

  it("o telefone pode estar na primeira coluna", () => {
    const r = lerPlanilha(["11988887777,Marina", "11977776666,Omar"].join("\n"));
    expect(r.linhas[0]).toMatchObject({ whatsapp: "11988887777", nome: "Marina" });
  });

  it("uma coluna só, só telefones", () => {
    const r = lerPlanilha(["11988887777", "11977776666"].join("\n"));
    expect(r.linhas.map((l) => l.whatsapp)).toEqual(["11988887777", "11977776666"]);
    expect(r.linhas[0]!.nome).toBeNull();
  });
});

describe("⛔ o defeito que estraga em silêncio", () => {
  it("nome com vírgula entre aspas NÃO empurra o telefone para a coluna errada", () => {
    // Sem respeitar aspas, "Bar do Zé, o melhor" vira duas colunas e o telefone
    // cai no lugar da cidade. Nada quebra; o cliente é que recebe errado.
    const r = lerPlanilha(
      ['nome,whatsapp,cidade', '"Bar do Zé, o melhor",11988887777,Santos'].join("\n"),
    );
    expect(r.linhas[0]).toMatchObject({
      nome: "Bar do Zé, o melhor",
      whatsapp: "11988887777",
      cidade: "Santos",
    });
  });

  it("aspas duplicadas viram uma aspa literal", () => {
    expect(quebrarLinha('"Bar ""do"" Zé",119', ",")).toEqual(['Bar "do" Zé', "119"]);
  });

  it("sonda de controle: sem aspas, a vírgula do meio REALMENTE separa", () => {
    // Se este passasse com 2 campos, o teste de cima estaria verde por acidente.
    expect(quebrarLinha("Bar do Zé, o melhor,119", ",")).toHaveLength(3);
  });
});

describe("linha sem telefone", () => {
  it("é contada e descartada, nunca sumida em silêncio", () => {
    const r = lerPlanilha(
      ["nome,whatsapp", "Marina,11988887777", "Sem telefone,", "Outro,abc"].join("\n"),
    );
    expect(r.linhas).toHaveLength(1);
    expect(r.descartadas).toBe(2);
  });
});

describe("o separador", () => {
  it("reconhece vírgula, ponto-e-vírgula e tabulação", () => {
    expect(detectarSeparador("a,b,c")).toBe(",");
    expect(detectarSeparador("a;b;c")).toBe(";");
    expect(detectarSeparador("a\tb\tc")).toBe("\t");
  });

  it("planilha do Excel em pt-BR (ponto-e-vírgula) é lida certo", () => {
    const r = lerPlanilha(["nome;whatsapp", "Marina;11988887777"].join("\n"));
    expect(r.separador).toBe(";");
    expect(r.linhas[0]!.whatsapp).toBe("11988887777");
  });

  it("coluna colada do Excel (tabulação) também", () => {
    const r = lerPlanilha(["nome\twhatsapp", "Marina\t11988887777"].join("\n"));
    expect(r.separador).toBe("\t");
    expect(r.linhas[0]!.nome).toBe("Marina");
  });
});

describe("telefone plausível", () => {
  it("aceita o que é telefone brasileiro, com ou sem formatação", () => {
    expect(pareceTelefone("11988887777")).toBe(true);
    expect(pareceTelefone("+55 (11) 98888-7777")).toBe(true);
    expect(pareceTelefone("1133334444")).toBe(true);
  });

  it("recusa o que não é", () => {
    for (const v of ["", "abc", "123", "9999999999999999"]) {
      expect(pareceTelefone(v), `"${v}"`).toBe(false);
    }
  });
});

describe("entrada vazia", () => {
  it("não estoura, devolve lista vazia", () => {
    expect(lerPlanilha("").linhas).toEqual([]);
    expect(lerPlanilha("\n\n  \n").linhas).toEqual([]);
  });
});
