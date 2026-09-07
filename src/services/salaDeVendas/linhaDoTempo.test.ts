/**
 * A linha do tempo da ficha, medida.
 *
 * O que estes testes protegem, em ordem de gravidade:
 *
 *   1. **Nenhum evento vira linha em branco.** Foi o defeito real do CRM antigo:
 *      quatro tipos sem rótulo renderizavam data, autor e nenhuma palavra. Aqui
 *      há um teste que passa TODOS os tipos do banco e exige título não vazio.
 *   2. **A omissão é declarada.** Só mensagem sai da lista, e só porque a
 *      conversa mostra melhor. Um teste diz exatamente quais tipos somem.
 *   3. **Autor desconhecido não vira "equipe".** Id feio é rastro; "equipe" é
 *      fato inventado.
 */

import { describe, it, expect } from "vitest";
import { $Enums } from "@prisma/client";
import {
  montarLinhaDoTempo,
  tituloDoEvento,
  nomeDoAutor,
  lerLinhaDoTempo,
  JA_APARECE_NA_CONVERSA,
  type InteracaoBruta,
} from "./linhaDoTempo";

function bruta(over: Partial<InteracaoBruta> = {}): InteracaoBruta {
  return {
    id: "i1",
    tipo: "NOTA",
    fromStage: null,
    toStage: null,
    actor: "sistema",
    nota: null,
    interna: false,
    createdAt: new Date("2026-09-01T12:00:00Z"),
    ...over,
  };
}

describe("nenhum evento sai em branco", () => {
  it("todo tipo que o banco aceita produz um título com texto", () => {
    const tipos = Object.keys($Enums.SiteLeadInteractionType) as InteracaoBruta["tipo"][];
    expect(tipos.length).toBeGreaterThan(0); // sonda: o enum foi mesmo lido

    for (const tipo of tipos) {
      const t = tituloDoEvento({ tipo, fromStage: null, toStage: null });
      expect(t, `tipo ${tipo} ficou sem título`).toBeTruthy();
      expect(t.trim().length, `tipo ${tipo} ficou com título vazio`).toBeGreaterThan(0);
    }
  });

  it("um tipo que ninguém previu aparece pelo próprio nome, e não sumido", () => {
    // O caso do CRM antigo: rótulo faltando. Feio é aceitável; invisível não.
    const t = tituloDoEvento({
      tipo: "TIPO_QUE_AINDA_NAO_EXISTE" as InteracaoBruta["tipo"],
      fromStage: null,
      toStage: null,
    });
    expect(t).toBe("TIPO_QUE_AINDA_NAO_EXISTE");
  });
});

describe("mudança de etapa diz de onde para onde", () => {
  it("com origem, mostra o caminho", () => {
    expect(
      tituloDoEvento({ tipo: "MUDANCA_ETAPA", fromStage: "NOVO", toStage: "QUALIFICADO" }),
    ).toBe("Novo lead → Qualificado");
  });

  it("sem origem, é o evento de criação", () => {
    expect(
      tituloDoEvento({ tipo: "MUDANCA_ETAPA", fromStage: null, toStage: "NOVO" }),
    ).toBe('Entrou como "Novo lead"');
  });

  it("etapa desconhecida aparece crua em vez de sumir", () => {
    expect(
      tituloDoEvento({ tipo: "MUDANCA_ETAPA", fromStage: null, toStage: "ETAPA_X" }),
    ).toBe('Entrou como "ETAPA_X"');
  });
});

describe("o que a conversa já mostra fica fora", () => {
  it("some mensagem enviada e resposta recebida — e nada mais", () => {
    expect([...JA_APARECE_NA_CONVERSA].sort()).toEqual([
      "MENSAGEM_ENVIADA",
      "RESPOSTA_RECEBIDA",
    ]);
  });

  it("a lista filtra as duas e mantém o resto", () => {
    const linha = montarLinhaDoTempo([
      bruta({ id: "a", tipo: "MENSAGEM_ENVIADA" }),
      bruta({ id: "b", tipo: "RESPOSTA_RECEBIDA" }),
      bruta({ id: "c", tipo: "ASSUMIU_HUMANO" }),
      bruta({ id: "d", tipo: "CAPTURA" }),
    ]);
    expect(linha.map((e) => e.id)).toEqual(["c", "d"]);
  });

  it("sonda de controle: um lead que SÓ trocou mensagens devolve lista vazia", () => {
    // Se este passasse com resultado não-vazio, o filtro não estaria filtrando.
    const linha = montarLinhaDoTempo([
      bruta({ id: "a", tipo: "MENSAGEM_ENVIADA" }),
      bruta({ id: "b", tipo: "RESPOSTA_RECEBIDA" }),
    ]);
    expect(linha).toEqual([]);
  });
});

describe("ordem", () => {
  it("o mais recente vem primeiro", () => {
    const linha = montarLinhaDoTempo([
      bruta({ id: "velho", createdAt: new Date("2026-08-01T10:00:00Z") }),
      bruta({ id: "novo", createdAt: new Date("2026-09-05T10:00:00Z") }),
      bruta({ id: "meio", createdAt: new Date("2026-08-20T10:00:00Z") }),
    ]);
    expect(linha.map((e) => e.id)).toEqual(["novo", "meio", "velho"]);
  });

  it("não altera o array que recebeu", () => {
    const entrada = [
      bruta({ id: "velho", createdAt: new Date("2026-08-01T10:00:00Z") }),
      bruta({ id: "novo", createdAt: new Date("2026-09-05T10:00:00Z") }),
    ];
    montarLinhaDoTempo(entrada);
    expect(entrada.map((e) => e.id)).toEqual(["velho", "novo"]);
  });
});

describe("quem fez", () => {
  it("rótulo de máquina vira frase de gente", () => {
    expect(nomeDoAutor("agente-sdr-ia", new Map())).toBe("IA de vendas");
    expect(nomeDoAutor("sistema", new Map())).toBe("sistema");
    expect(nomeDoAutor("distribuicao", new Map())).toBe("distribuição automática");
  });

  it("id de pessoa vira o nome dela", () => {
    expect(nomeDoAutor("usr_1", new Map([["usr_1", "Marina"]]))).toBe("Marina");
  });

  it("⛔ id que ninguém resolveu sai CRU, e não como 'equipe'", () => {
    // Trocar por um rótulo genérico apagaria a única pista de quem agiu.
    expect(nomeDoAutor("usr_sumiu", new Map())).toBe("usr_sumiu");
  });
});

describe("a nota", () => {
  it("nota só de espaço vira null — a tela não abre caixa vazia", () => {
    expect(montarLinhaDoTempo([bruta({ nota: "   " })])[0]!.nota).toBeNull();
  });

  it("a marca de interna atravessa sem ser reinterpretada", () => {
    const linha = montarLinhaDoTempo([
      bruta({ id: "a", tipo: "NOTA_INTERNA", interna: true, nota: "cliente é irmão do sócio" }),
      bruta({ id: "b", tipo: "NOTA", interna: false, nota: "pediu proposta" }),
    ]);
    expect(linha.find((e) => e.id === "a")!.interna).toBe(true);
    expect(linha.find((e) => e.id === "b")!.interna).toBe(false);
  });
});

describe("lerLinhaDoTempo — a leitura", () => {
  function banco(brutos: InteracaoBruta[], pessoas: Array<{ id: string; nome: string | null }> = []) {
    const chamadas: { interacao?: unknown; usuario?: unknown } = {};
    return {
      chamadas,
      db: {
        siteLeadInteraction: {
          findMany: async (args: unknown) => {
            chamadas.interacao = args;
            return brutos;
          },
        },
        internalUser: {
          findMany: async (args: unknown) => {
            chamadas.usuario = args;
            return pessoas;
          },
        },
      },
    };
  }

  it("resolve o nome de quem agiu", async () => {
    const { db } = banco(
      [bruta({ id: "a", tipo: "ASSUMIU_HUMANO", actor: "usr_1" })],
      [{ id: "usr_1", nome: "Marina" }],
    );
    const linha = await lerLinhaDoTempo(db, { leadId: "L1" });
    expect(linha[0]!.autor).toBe("Marina");
  });

  it("não vai ao banco de usuários quando todo autor é máquina", async () => {
    const { db, chamadas } = banco([bruta({ actor: "sistema" }), bruta({ id: "b", actor: "sistema" })]);
    await lerLinhaDoTempo(db, { leadId: "L1" });
    expect(chamadas.usuario).toBeUndefined();
  });

  it("busca com folga, para o filtro de mensagens não esvaziar a lista", async () => {
    // Cortar no banco e filtrar depois devolveria vazio para um lead cujas
    // últimas 30 interações são todas mensagens.
    const { db, chamadas } = banco([]);
    await lerLinhaDoTempo(db, { leadId: "L1", limite: 10 });
    expect((chamadas.interacao as { take: number }).take).toBeGreaterThan(10);
  });

  it("respeita o limite pedido depois de filtrar", async () => {
    const muitos = Array.from({ length: 40 }, (_, n) =>
      bruta({ id: `e${n}`, createdAt: new Date(2026, 8, 1, n) }),
    );
    const { db } = banco(muitos);
    const linha = await lerLinhaDoTempo(db, { leadId: "L1", limite: 5 });
    expect(linha).toHaveLength(5);
  });

  it("limite absurdo não vira consulta absurda", async () => {
    const { db, chamadas } = banco([]);
    await lerLinhaDoTempo(db, { leadId: "L1", limite: 10_000 });
    expect((chamadas.interacao as { take: number }).take).toBeLessThanOrEqual(300);
  });

  it("pergunta só pelo lead pedido", async () => {
    const { db, chamadas } = banco([]);
    await lerLinhaDoTempo(db, { leadId: "L7" });
    expect((chamadas.interacao as { where: { leadId: string } }).where).toEqual({ leadId: "L7" });
  });
});
