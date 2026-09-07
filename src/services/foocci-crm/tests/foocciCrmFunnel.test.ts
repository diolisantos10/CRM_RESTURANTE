/**
 * A trava do número honesto.
 *
 * O pedido do CEO tem uma frase que vira teste: "se não há dado suficiente para
 * uma taxa, a tela diz 'ainda não dá para dizer' em vez de mostrar 0% ou 100%
 * enganoso". Estes testes existem para que ninguém consiga "melhorar" a tela
 * mostrando uma porcentagem com três contatos.
 */

import { describe, it, expect } from "vitest";
import { $Enums } from "@prisma/client";
import {
  computeFunnel, montaDegrau, formataTaxa, podeMover, indiceEtapa,
  SEQUENCIA_FUNIL, MIN_LEADS_PARA_TAXA, contaComoAbordagem, ROTULO_INTERACAO,
  type FoocciLeadStage, type TipoDeInteracao,
} from "../foocciCrmFunnel";

function leads(pares: Array<[FoocciLeadStage, FoocciLeadStage]>) {
  return pares.map(([atual, maisAvancada]) => ({ atual, maisAvancada }));
}

/** n contatos que chegaram e nunca saíram de NOVO. */
function novos(n: number) {
  return leads(Array.from({ length: n }, () => ["NOVO", "NOVO"] as [FoocciLeadStage, FoocciLeadStage]));
}

describe("taxa de conversão — amostra insuficiente NUNCA vira número", () => {
  it("não calcula taxa com menos contatos que o mínimo", () => {
    const d = montaDegrau("NOVO", "PRIMEIRO_CONTATO", MIN_LEADS_PARA_TAXA - 1, 1);
    expect(d.taxa).toBeNull();
    expect(d.motivoSemTaxa).toBe("amostra_insuficiente");
    expect(d.explicacao).toContain("Ainda não dá para dizer");
    // As CONTAGENS continuam disponíveis: fato é fato, o que se esconde é a razão.
    expect(d.base).toBe(MIN_LEADS_PARA_TAXA - 1);
    expect(d.alcancaram).toBe(1);
  });

  it("o caso perigoso: 1 de 1 NÃO vira 100%", () => {
    const d = montaDegrau("NOVO", "GANHO", 1, 1);
    expect(d.taxa).toBeNull();
    expect(formataTaxa(d.taxa)).toBe("ainda não dá para dizer");
  });

  it("o outro caso perigoso: 0 de 3 NÃO vira 0%", () => {
    const d = montaDegrau("NOVO", "GANHO", 3, 0);
    expect(d.taxa).toBeNull();
    expect(formataTaxa(d.taxa)).not.toContain("0%");
  });

  it("etapa sem ninguém diz que está sem ninguém, não 0%", () => {
    const d = montaDegrau("PROPOSTA_ENVIADA", "GANHO", 0, 0);
    expect(d.taxa).toBeNull();
    expect(d.motivoSemTaxa).toBe("sem_ninguem");
    expect(d.explicacao).toContain("Ninguém chegou");
  });

  it("calcula a taxa a partir do mínimo, e só a partir dele", () => {
    const abaixo = montaDegrau("NOVO", "PRIMEIRO_CONTATO", MIN_LEADS_PARA_TAXA - 1, 5);
    const exato  = montaDegrau("NOVO", "PRIMEIRO_CONTATO", MIN_LEADS_PARA_TAXA, 5);
    expect(abaixo.taxa).toBeNull();
    expect(exato.taxa).toBeCloseTo(5 / MIN_LEADS_PARA_TAXA);
  });

  it("o funil inteiro respeita a trava quando a base é pequena", () => {
    const r = computeFunnel(leads([
      ["PRIMEIRO_CONTATO", "PRIMEIRO_CONTATO"],
      ["GANHO", "GANHO"],
      ["NOVO", "NOVO"],
    ]));
    expect(r.total).toBe(3);
    for (const d of r.degraus) expect(d.taxa).toBeNull();
    expect(r.pontaAPonta?.taxa).toBeNull();
  });
});

describe("computeFunnel — o que conta e o que não conta", () => {
  it("um contato conta em todas as etapas até onde chegou", () => {
    const r = computeFunnel(leads([["PROPOSTA_ENVIADA", "PROPOSTA_ENVIADA"]]));
    const por = Object.fromEntries(r.etapas.map((e) => [e.stage, e.alcancaram]));
    expect(por.NOVO).toBe(1);
    expect(por.PRIMEIRO_CONTATO).toBe(1);
    expect(por.QUALIFICADO).toBe(1);
    expect(por.PROPOSTA_ENVIADA).toBe(1);
    expect(por.GANHO).toBe(0);
  });

  it("quem virou PERDIDO continua contando na etapa mais alta que alcançou", () => {
    // É aqui que o funil mostra ONDE vaza. Se o perdido sumisse do degrau
    // "qualificado → proposta", um mês de propostas recusadas pareceria um mês
    // sem propostas — e a conclusão seria consertar a etapa errada.
    const r = computeFunnel(leads([["PERDIDO", "PROPOSTA_ENVIADA"]]));
    const por = Object.fromEntries(r.etapas.map((e) => [e.stage, e.alcancaram]));
    expect(por.PROPOSTA_ENVIADA).toBe(1);
    expect(r.perdidos).toBe(1);
    // …mas ele não está "parado" em nenhuma etapa do funil.
    expect(r.etapas.every((e) => e.agora === 0)).toBe(true);
  });

  it("PERDIDO fica fora da sequência do funil", () => {
    expect(SEQUENCIA_FUNIL).not.toContain("PERDIDO");
    expect(indiceEtapa("PERDIDO")).toBe(-1);
  });

  it("separa 'alcançaram' de 'estão aqui agora'", () => {
    const r = computeFunnel(leads([
      ["GANHO", "GANHO"],
      ["PRIMEIRO_CONTATO", "PRIMEIRO_CONTATO"],
    ]));
    const contatado = r.etapas.find((e) => e.stage === "PRIMEIRO_CONTATO")!;
    expect(contatado.alcancaram).toBe(2); // os dois passaram por PRIMEIRO_CONTATO
    expect(contatado.agora).toBe(1);      // só um está parado ali
  });

  it("com amostra suficiente a taxa aparece e bate com as contagens", () => {
    // 12 chegaram, 6 foram contatados.
    const base = [
      ...novos(6),
      ...leads(Array.from({ length: 6 }, () => ["PRIMEIRO_CONTATO", "PRIMEIRO_CONTATO"] as [FoocciLeadStage, FoocciLeadStage])),
    ];
    const r = computeFunnel(base);
    const primeiro = r.degraus[0]!;
    expect(primeiro.base).toBe(12);
    expect(primeiro.alcancaram).toBe(6);
    expect(primeiro.taxa).toBeCloseTo(0.5);
    expect(formataTaxa(primeiro.taxa)).toBe("50%");
  });

  it("base vazia não produz taxa nenhuma", () => {
    const r = computeFunnel([]);
    expect(r.total).toBe(0);
    expect(r.pontaAPonta).toBeNull();
    for (const d of r.degraus) expect(d.taxa).toBeNull();
  });
});

describe("interações de saída", () => {
  it("só o que a Foocci FEZ conta como abordagem", () => {
    expect(contaComoAbordagem("MENSAGEM_ENVIADA")).toBe(true);
    expect(contaComoAbordagem("LIGACAO")).toBe(true);
    expect(contaComoAbordagem("REUNIAO")).toBe(true);
    // Uma anotação interna não pode tirar o contato da fila de "não abordados".
    expect(contaComoAbordagem("NOTA")).toBe(false);
    expect(contaComoAbordagem("RESPOSTA_RECEBIDA")).toBe(false);
    expect(contaComoAbordagem("CAPTURA")).toBe(false);
  });

  it("assumir um lead NÃO é ter falado com ele", () => {
    // Se contasse, o lead sumiria da fila "ninguém falou com ele" no clique de
    // "Assumir" — abandonado e invisível ao mesmo tempo.
    expect(contaComoAbordagem("ASSUMIU_HUMANO")).toBe(false);
    expect(contaComoAbordagem("DEVOLVEU_PARA_IA")).toBe(false);
    expect(contaComoAbordagem("PEDIU_HUMANO")).toBe(false);
    expect(contaComoAbordagem("NOTA_INTERNA")).toBe(false);
  });
});

/**
 * ⛔ O AFERIDOR — e ele mede contra o BANCO, não contra a lista ao lado.
 *
 * O defeito de 07/09/2026 foi exatamente este: `ROTULO_INTERACAO` tinha oito
 * entradas, o banco tinha doze, e nada gritou. Um teste que percorresse
 * `Object.keys(ROTULO_INTERACAO)` teria passado feliz — estaria conferindo o
 * mapa consigo mesmo. A única fonte que não mente aqui é o enum do Prisma.
 */
describe("rótulos de interação × enum do banco", () => {
  it("todo tipo que o banco aceita tem rótulo em português", () => {
    const doBanco = Object.keys($Enums.SiteLeadInteractionType);
    expect(doBanco.length).toBeGreaterThan(0); // sonda: o enum foi mesmo lido

    const semRotulo = doBanco.filter((t) => !ROTULO_INTERACAO[t as TipoDeInteracao]);
    expect(semRotulo).toEqual([]);
  });

  it("não sobra rótulo para tipo que o banco não conhece", () => {
    const doBanco = new Set(Object.keys($Enums.SiteLeadInteractionType));
    expect(Object.keys(ROTULO_INTERACAO).filter((t) => !doBanco.has(t))).toEqual([]);
  });

  it("a sonda de controle: um tipo inventado NÃO tem rótulo", () => {
    // Sem isto, os dois testes acima passariam mesmo com um `Record` que
    // devolvesse qualquer coisa para qualquer chave.
    expect(ROTULO_INTERACAO["ASSUMIU_TUDO" as TipoDeInteracao]).toBeUndefined();
  });
});

describe("transições", () => {
  it("permite pular etapa — o histórico guarda o pulo", () => {
    expect(podeMover("NOVO", "GANHO")).toBe(true);
  });

  it("não permite 'mover' para a etapa em que já está", () => {
    expect(podeMover("PROPOSTA_ENVIADA", "PROPOSTA_ENVIADA")).toBe(false);
  });

  it("recusa etapa que não existe", () => {
    expect(podeMover("NOVO", "QUASE_FECHANDO" as FoocciLeadStage)).toBe(false);
  });
});
