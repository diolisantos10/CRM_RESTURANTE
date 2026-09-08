/**
 * O TA falando — e as três coisas que ele nunca pode fazer.
 *
 * O teste que carrega mais peso aqui é o do "não sei". Um vendedor de IA sem
 * base de verdade inventa, e inventar integração ou prazo é o defeito mais caro
 * que esta função tem: o cliente compra pela promessa e descobre na implantação.
 *
 * Por isso quase metade destes casos afirma o que ele **não** diz.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { responder, lerSinaisDoTexto, pareceUmaPergunta } from "./responder";
import { baseDeVerdade, buscarNaVerdade, COBERTURA_MINIMA } from "./verdade";
import { VERSAO_1, QUANDO_NAO_SEI } from "./ficha";

describe("a base de verdade", () => {
  it("é montada das fontes, e nenhuma frase de venda é digitada nela", () => {
    // A trava de verdade deste diretório. Uma afirmação escrita à mão aqui
    // viveria fora do site, fora da revisão do CEO e fora do dia em que ele
    // mudasse de ideia — e passaria em todos os outros testes.
    const fonte = readFileSync(path.join(__dirname, "verdade.ts"), "utf8");
    const semComentarios = fonte
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    // Nenhum valor em reais.
    expect(semComentarios).not.toMatch(/R\$\s*\d/);
    // E nenhuma promessa de produto escrita direto no código.
    for (const proibida of [/integra com/i, /funciona com o iFood/i, /em \d+ dias/i]) {
      expect(semComentarios, `afirmação digitada: ${proibida}`).not.toMatch(proibida);
    }
  });

  it("tem preço dos três planos, vindo da tabela viva", () => {
    const ids = baseDeVerdade().map((i) => i.id);
    expect(ids).toContain("preco-essencial");
    expect(ids).toContain("preco-crescimento");
    expect(ids).toContain("preco-performance");
  });

  it("todo item declara de onde veio", () => {
    for (const item of baseDeVerdade()) {
      expect(item.fonte, item.id).toBeTruthy();
      expect(item.texto.length, item.id).toBeGreaterThan(20);
    }
  });

  it("acha o preço quando perguntam o preço", () => {
    const r = buscarNaVerdade("quanto custa o plano crescimento");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]!.item.id).toBe("preco-crescimento");
  });

  it("NÃO acha nada quando a pergunta é de outro assunto", () => {
    // A metade que sustenta o "não sei". Sem o piso de admissão, estas perguntas
    // voltariam com o item mais parecido e o TA responderia com ele.
    //
    // ⚠️ Em 26/08/2026 este caso usava "vocês emitem nota fiscal eletrônica" e
    // passou a REPROVAR — porque a base ganhou a resposta honesta sobre nota
    // fiscal (integração incluída, custo do documento é com o emissor). O teste
    // estava certo e envelheceu: o exemplo de "fora de escopo" virou escopo.
    // Trocado por perguntas que continuam fora, e não afrouxado.
    expect(buscarNaVerdade("qual a cor do uniforme dos entregadores")).toEqual([]);
    expect(buscarNaVerdade("vocês patrocinam campeonato de futebol amador")).toEqual([]);
  });

  it("mas ACHA a nota fiscal — o escopo cresceu, e de propósito", () => {
    // O outro lado da mudança acima. Sem este caso, alguém poderia "consertar" o
    // teste anterior removendo o item da base e ninguém notaria que o TA voltou
    // a não saber responder uma pergunta que todo dono de restaurante faz.
    const r = buscarNaVerdade("como funciona a nota fiscal de vocês");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]!.item.fonte).toBe("servico-a-parte");
  });

  it("o piso é uma fração da PERGUNTA, não do item", () => {
    // Medir ao contrário premiaria item curto: um texto de cinco palavras que
    // casa duas pareceria ótimo e não teria respondido nada.
    expect(COBERTURA_MINIMA).toBeGreaterThan(0.3);
    expect(COBERTURA_MINIMA).toBeLessThan(0.6);
  });
});

describe("os sinais que ele lê do texto", () => {
  it("pedido explícito de gente é reconhecido", () => {
    for (const frase of [
      "quero falar com uma pessoa",
      "me liga por favor",
      "chama alguém aí",
    ]) {
      expect(lerSinaisDoTexto(frase).pediuHumano, frase).toBe(true);
    }
  });

  it("conversa normal NÃO dispara nada", () => {
    // A metade que passa. Sem ela, um sinal que disparasse sempre passaria em
    // todos os casos acima e mandaria toda conversa para gente.
    const s = lerSinaisDoTexto("oi, tenho uma pizzaria em Santo André");
    expect(s.pediuHumano).toBeFalsy();
    expect(s.pediuProposta).toBeFalsy();
    expect(s.pediuDesconto).toBeFalsy();
    expect(s.sentimentoNegativo).toBeFalsy();
  });

  it("desconto e proposta são reconhecidos", () => {
    expect(lerSinaisDoTexto("consegue fazer por menos?").pediuDesconto).toBe(true);
    expect(lerSinaisDoTexto("me manda uma proposta").pediuProposta).toBe(true);
  });
});

describe("o turno do TA", () => {
  it("no primeiro contato ele se apresenta e faz UMA pergunta", () => {
    const r = responder({ mensagem: "oi", nome: "Marcos Silva" });

    expect(r.texto).toContain("Marcos");
    // ⛔ Era `toContain("TA")` até 07/09/2026. A sigla saiu da saudação porque o
    // código nunca a define em lugar nenhum — quem provou foi o CEO,
    // perguntando "o que é TA?". Se o dono da empresa não sabe, o dono do
    // restaurante também não sabe.
    expect(r.texto).toContain("agente de atendimento do Foocci");
    expect(r.texto).not.toContain("TA,");
    expect(r.perguntouIndice).toBe(0);
    expect(r.handoff.deve).toBe(false);
    // Uma pergunta por mensagem — duas fazem a pessoa responder só a última.
    expect(r.texto.split("?").length - 1).toBeLessThanOrEqual(1);
  });

  it("responde preço com o número da tabela, e não inventa", () => {
    const r = responder({ mensagem: "quanto custa o plano crescimento?" });

    expect(r.apoiadoEm.map((a) => a.id)).toContain("preco-crescimento");
    expect(r.apoiadoEm[0]!.fonte).toBe("tabela-de-preco");
    expect(r.texto).toMatch(/R\$/);
  });

  it("⭐ pergunta que a base não cobre vira 'não sei' e chama gente", () => {
    // O caso mais importante deste arquivo.
    const r = responder({ mensagem: "vocês integram com o sistema Colibri?" });

    expect(r.texto).toContain(QUANDO_NAO_SEI);
    expect(r.apoiadoEm).toEqual([]);
    expect(r.handoff.deve).toBe(true);
    expect(r.handoff.motivo).toBe("INFORMACAO_NAO_CONFIRMADA");
  });

  it("pedido de gente vem ANTES de qualquer outra coisa", () => {
    // Mesmo perguntando preço na mesma frase: ignorar um pedido explícito é o
    // pior defeito possível numa conversa de venda.
    const r = responder({ mensagem: "quanto custa? quero falar com uma pessoa" });

    expect(r.handoff.deve).toBe(true);
    expect(r.handoff.motivo).toBe("PEDIU_HUMANO");
    expect(r.perguntouIndice).toBeNull();
  });

  it("desconto sai da mão dele, sempre", () => {
    const r = responder({ mensagem: "consegue fazer um desconto?" });
    expect(r.handoff.deve).toBe(true);
    expect(r.handoff.motivo).toBe("PEDIU_DESCONTO");
  });

  it("'bom dia' NÃO cai no ramo do não sei", () => {
    // Sem `pareceUmaPergunta`, o TA abriria a conversa dizendo que não sabe —
    // o pior primeiro contato possível.
    const r = responder({ mensagem: "bom dia" });
    expect(r.texto).not.toContain(QUANDO_NAO_SEI);
    expect(r.handoff.deve).toBe(false);
  });

  it("a sondagem anda na ordem publicada e não repete", () => {
    const primeira = responder({ mensagem: "tenho uma pizzaria", jaPerguntou: [] });
    const segunda = responder({ mensagem: "duas unidades", jaPerguntou: [0] });

    expect(primeira.perguntouIndice).toBe(0);
    expect(segunda.perguntouIndice).toBe(1);
    expect(segunda.texto).toContain(VERSAO_1.perguntas[1]);
  });

  it("acabadas as perguntas, ele não inventa uma sexta", () => {
    const todas = VERSAO_1.perguntas.map((_, i) => i);
    const r = responder({ mensagem: "isso mesmo", jaPerguntou: todas });
    expect(r.perguntouIndice).toBeNull();
  });

  it("a resposta NUNCA é vazia", () => {
    for (const m of ["", "   ", "?", "kkkk", "👍"]) {
      const r = responder({ mensagem: m, jaPerguntou: [0, 1] });
      expect(r.texto.trim().length, `mensagem ${JSON.stringify(m)}`).toBeGreaterThan(0);
    }
  });

  it("toda afirmação tem apoio declarado — ou não há afirmação", () => {
    // A propriedade que sustenta tudo: se `apoiadoEm` está vazio, o texto é
    // saudação, pergunta da ficha ou a frase do "não sei". Nunca conteúdo.
    const r = responder({ mensagem: "oi, tudo bem?", jaPerguntou: [0] });
    if (r.apoiadoEm.length === 0) {
      const daFicha =
        VERSAO_1.perguntas.some((p) => r.texto.includes(p)) ||
        r.texto.includes(QUANDO_NAO_SEI) ||
        r.texto.includes("TA");
      expect(daFicha, `texto sem origem: ${r.texto}`).toBe(true);
    }
  });

  it("nunca usa mais de dois apoios — três viram parede de texto", () => {
    const r = responder({ mensagem: "quanto custa o plano essencial e o crescimento por mês" });
    expect(r.apoiadoEm.length).toBeLessThanOrEqual(2);
  });
});

describe("`pareceUmaPergunta`", () => {
  it("reconhece pergunta com e sem ponto de interrogação", () => {
    expect(pareceUmaPergunta("quanto custa")).toBe(true);
    expect(pareceUmaPergunta("vocês integram com iFood")).toBe(true);
    expect(pareceUmaPergunta("tem app?")).toBe(true);
  });

  it("não confunde afirmação com pergunta", () => {
    expect(pareceUmaPergunta("tenho um restaurante em Santos")).toBe(false);
    expect(pareceUmaPergunta("bom dia")).toBe(false);
  });
});

/**
 * ── OS DOIS DEFEITOS QUE O PRIMEIRO ENSAIO ACHOU ────────────────────────────
 *
 * Nenhum dos dois aparecia em teste: os dois só aparecem vendo o TA falar. É a
 * razão de a tela de ensaio existir antes de ligar qualquer coisa.
 */
describe("achados do ensaio de 25/08", () => {
  it("perguntou de UM plano, recebe UM preço", () => {
    // Antes: "quanto custa o Crescimento?" devolvia Crescimento E Essencial —
    // e o segundo parece empurrão de vendedor, o tom que a ficha proíbe.
    const r = responder({ mensagem: "quanto custa o plano Crescimento?" });

    expect(r.apoiadoEm.map((a) => a.id)).toEqual(["preco-crescimento"]);
    expect(r.texto).not.toContain("Essencial");
  });

  it("não manda de volta para o site quem já está no WhatsApp", () => {
    // Antes: "oi, vi o site de vocês" respondia "tire suas dúvidas pelo botão
    // de contato aqui do site" — mandava quem já está falando com a gente
    // voltar ao site para falar com a gente.
    const r = responder({ mensagem: "oi, vi o site de vocês" });

    expect(r.texto).not.toMatch(/aqui do site|bot[ãa]o de contato|p[áa]gina de pre[çc]os/i);
  });

  it("nenhum item da base empurra o lead de volta para a página", () => {
    for (const item of baseDeVerdade()) {
      expect(
        item.texto,
        `${item.id} manda o lead para o site — inútil para quem já saiu dele`,
      ).not.toMatch(/aqui do site|bot[ãa]o de contato|p[áa]gina de pre[çc]os/i);
    }
  });

  it("e a base NÃO ficou vazia por causa do filtro", () => {
    // A metade que passa. Um filtro largo demais esvaziaria a base e o TA diria
    // "não sei" para tudo — verde em todos os casos acima, e inútil.
    expect(baseDeVerdade().length).toBeGreaterThan(8);
  });
});
