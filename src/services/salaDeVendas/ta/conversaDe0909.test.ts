/**
 * A CONVERSA REPROVADA DE 09/09/2026 — cada defeito dela virou um caso aqui.
 *
 * ── O QUE ACONTECEU ─────────────────────────────────────────────────────────
 *
 * Um dono de padaria escreveu no número comercial. A conversa inteira foi
 * reprovada pelo Diretor Geral, com vinte e um defeitos nomeados. Os que se
 * provam sem rede e sem banco estão abaixo; os de orquestração (trava, ordem,
 * agrupamento) estão em `travaDaConversa.test.ts` e no teste da recepção.
 *
 * ⚠️ **Anonimizado**: nenhum telefone, nome ou dado real. O que se preserva é a
 * SEQUÊNCIA das frases, que é o que produziu os defeitos.
 *
 * ── POR QUE UM ARQUIVO SÓ PARA UMA CONVERSA ─────────────────────────────────
 *
 * Porque ela é a régua. Cada `it` abaixo falha se um dos defeitos voltar, e o
 * nome do caso é a frase do defeito — quem quebrar um deles lê, no relatório, a
 * reclamação original em vez de um nome de função.
 */

import { describe, it, expect } from "vitest";
import { responder } from "./responder";
import { verificarResposta } from "./verificador";
import { VERSAO_1 } from "./ficha";
import { linkOficial } from "./link";
import {
  blocoDeConduta,
  blocoDeMemoria,
  lerIrritacao,
  lerPedidoDeParar,
  MEMORIA_VAZIA,
  type MemoriaDoLead,
} from "./memoria";
import { juntarTextos, limparEntidades } from "./agrupamento";

/** O que a casa sabia sobre ele depois das primeiras trocas. */
const PADEIRO: MemoriaDoLead = {
  ...MEMORIA_VAZIA,
  segmento: "padaria",
  marketplaceAtual: "iFood",
  canaisAtuais: ["iFood"],
  dorPrincipal: "movimento fraco",
  objetivo: "vender direto e fidelizar os clientes do iFood",
};

describe("⛔ ele não pergunta o que a pessoa já respondeu", () => {
  it('"padaria" não pode gerar nova pergunta sobre tipo de cozinha', () => {
    const bloco = blocoDeMemoria(PADEIRO);

    // O fato chega ao modelo escrito, e não escondido em doze mensagens cruas.
    expect(bloco).toContain("padaria");
    expect(bloco).toContain("tipo de estabelecimento");
    // E a instrução que acompanha é explícita sobre o que não fazer.
    expect(bloco).toContain("não pergunte de novo");
  });

  it('"só vendo pelo iFood" fica guardado como marketplace e como canal', () => {
    const bloco = blocoDeMemoria(PADEIRO);
    expect(bloco).toContain("marketplace de que depende: iFood");
    expect(bloco).toContain("canais atuais: iFood");
  });

  it('"quero vender direto e fidelizar" vira objetivo, e o objetivo chega ao prompt', () => {
    expect(blocoDeMemoria(PADEIRO)).toContain("objetivo declarado: vender direto");
  });

  it("⛔ a sonda de controle: sem nada sabido, o bloco é VAZIO", () => {
    // Vazio de propósito. Um cabeçalho "O QUE JÁ SEI:" seguido de nada ensina o
    // modelo a preencher o buraco — que é a definição de inventar.
    expect(blocoDeMemoria(MEMORIA_VAZIA)).toBe("");
  });
});

describe('⛔ "não quero mais responder perguntas" para a sondagem NA HORA', () => {
  const FRASES = [
    "não quero mais responder perguntas",
    "para de perguntar",
    "chega de pergunta",
    "responde logo",
    "só me diz o preço",
  ];

  for (const frase of FRASES) {
    it(`reconhece: "${frase}"`, () => {
      expect(lerPedidoDeParar(frase)).toBe(true);
    });
  }

  it("⛔ a sonda de controle: conversa normal NÃO é lida como pedido de parar", () => {
    // Sem esta, um detector guloso calaria a sondagem na primeira frase longa —
    // e um agente que nunca pergunta não qualifica ninguém.
    expect(lerPedidoDeParar("tenho algumas perguntas sobre o plano")).toBe(false);
    expect(lerPedidoDeParar("quanto custa?")).toBe(false);
    expect(lerPedidoDeParar("me explica como funciona")).toBe(false);
  });

  it("⭐ e o caminho determinístico OBEDECE — não sobra pergunta na resposta", () => {
    const comPedido = responder(
      { mensagem: "me explica o crescimento", jaPerguntou: [], pediuPararSondagem: true },
      VERSAO_1,
    );
    expect(comPedido.perguntouIndice).toBeNull();
    expect(comPedido.porque).toContain("pediu para parar");

    // A sonda: sem o pedido, a mesma mensagem AINDA faz a sondagem andar. Se
    // não fizesse, o teste acima passaria por um motivo errado (o agente teria
    // parado de perguntar para todo mundo).
    const semPedido = responder({ mensagem: "me explica o crescimento", jaPerguntou: [] }, VERSAO_1);
    expect(semPedido.perguntouIndice).not.toBeNull();
  });

  it("a conduta escrita para o modelo diz a mesma coisa que a trava faz", () => {
    const conduta = blocoDeConduta({ ...PADEIRO, pediuPararSondagem: true });
    expect(conduta).toContain("Não faça pergunta nenhuma");
  });
});

describe("⛔ irritação é reconhecida, e muda a conduta", () => {
  it("reconhece o desabafo e o já-falei", () => {
    expect(lerIrritacao("isso é uma palhaçada")).toBe(3);
    expect(lerIrritacao("eu já falei isso")).toBe(2);
    expect(lerIrritacao("você não entendeu")).toBe(2);
  });

  it("⛔ e não vê irritação onde não há", () => {
    expect(lerIrritacao("beleza, me manda")).toBe(0);
    expect(lerIrritacao("tá bom, obrigado")).toBe(0);
  });

  it("irritada, a conduta manda reconhecer e ir direto ao ponto", () => {
    const conduta = blocoDeConduta({ ...PADEIRO, irritacao: 2 });
    expect(conduta).toContain("irritado");
    expect(conduta).toContain("Vá direto ao ponto");
  });
});

describe("⛔ NENHUMA saída pode conter espaço reservado ou link inventado", () => {
  it('⭐ "[link do site]" é REPROVADO — a frase literal que o cliente recebeu', () => {
    const v = verificarResposta("Dá uma olhada aqui: [link do site]");
    expect(v.aprovada).toBe(false);
    expect(v.motivos).toContain("placeholderNaoResolvido");
  });

  it("variável de modelo sobrando e undefined também são reprovados", () => {
    expect(verificarResposta("Olá {{1}}, tudo bem?").motivos).toContain("placeholderNaoResolvido");
    expect(verificarResposta("Seu plano é undefined").motivos).toContain("placeholderNaoResolvido");
  });

  it("⛔ endereço inventado é reprovado, mesmo sendo do domínio certo", () => {
    // O modelo inventa CAMINHO com naturalidade. `/planos` não existe, e um 404
    // no meio da venda custa a venda.
    const v = verificarResposta("Vê em https://foocci.com.br/planos");
    expect(v.aprovada).toBe(false);
    expect(v.motivos).toContain("linkForaDaLista");
  });

  it("⭐ a sonda de controle: o link OFICIAL passa", () => {
    // Sem este caso, a regra acima poderia estar reprovando toda URL — e um
    // agente que não pode mandar link nenhum não fecha nada.
    const v = verificarResposta(`Os planos estão em ${linkOficial("precos")}`);
    expect(v.aprovada, JSON.stringify(v)).toBe(true);
  });

  it("e o link oficial com pontuação colada continua passando", () => {
    // "…/precos." — o ponto final da frase não pode transformar um acerto em
    // reprovação, senão o modelo é punido por escrever português.
    const v = verificarResposta(`Está tudo em ${linkOficial("precos")}.`);
    expect(v.aprovada, JSON.stringify(v)).toBe(true);
  });
});

describe("⛔ entidade HTML não chega ao cliente", () => {
  it("⭐ &#x20; — exatamente o que o lead recebeu", () => {
    expect(limparEntidades("Perfeito!&#x20;Vou te explicar")).toBe("Perfeito! Vou te explicar");
  });

  it("converte as comuns", () => {
    expect(limparEntidades("Bar &amp; Grill")).toBe("Bar & Grill");
    expect(limparEntidades("&quot;teste&quot;")).toBe('"teste"');
  });

  it("⛔ e não estraga um & legítimo nem texto limpo", () => {
    expect(limparEntidades("Bar & Grill")).toBe("Bar & Grill");
    expect(limparEntidades("R$ 149 por mês")).toBe("R$ 149 por mês");
  });

  it("&amp;lt; vira &lt;, e não <", () => {
    // Uma camada de escape por vez. Desfazer duas muda o que a pessoa escreveu.
    expect(limparEntidades("&amp;lt;")).toBe("&lt;");
  });
});

describe("⛔ mensagens consecutivas viram UMA resposta", () => {
  it("⭐ as três frases do padeiro entram no mesmo turno, na ordem", () => {
    const junto = juntarTextos(["é padaria", "só vendo pelo iFood", "o movimento tá fraco"]);

    expect(junto).toBe("é padaria\nsó vendo pelo iFood\no movimento tá fraco");
    // Quebra de linha, e não espaço: emendadas, as três viram uma frase sem
    // sentido que o modelo tenta interpretar como uma coisa só.
    expect(junto).not.toContain("padaria só vendo");
  });
});

describe("⛔ o agente responde ANTES de perguntar", () => {
  it('"quanto custa o plano crescimento?" recebe o preço antes de qualquer pergunta', () => {
    const r = responder({ mensagem: "quanto custa o plano crescimento?", jaPerguntou: [] }, VERSAO_1);

    // A resposta se apoia em alguma fonte — não é pergunta pura.
    expect(r.apoiadoEm.length).toBeGreaterThan(0);

    // E o preço vem antes da pergunta no texto, quando há pergunta.
    if (r.perguntouIndice !== null) {
      const pergunta = VERSAO_1.perguntas[r.perguntouIndice]!;
      expect(r.texto.indexOf(pergunta)).toBeGreaterThan(0);
    }
  });
});

describe("⛔ ele não pede o telefone de quem está falando PELO telefone", () => {
  const PEDIDOS = [
    "Me passa seu WhatsApp que eu te chamo",
    "qual o seu telefone?",
    "pode me mandar seu número?",
    "me manda seu contato",
    "deixa o seu whats aí",
  ];

  for (const frase of PEDIDOS) {
    it(`reprova: "${frase}"`, () => {
      const v = verificarResposta(frase);
      expect(v.aprovada, JSON.stringify(v)).toBe(false);
      expect(v.motivos).toContain("pediuTelefoneQueJaTem");
    });
  }

  it("⭐⭐ a sonda de controle: PERGUNTAR SOBRE WhatsApp continua liberado", () => {
    // Esta é a sonda que carrega a regra. "Hoje você vende por onde?" e "você
    // vende pelo WhatsApp?" são a pergunta MAIS importante da sondagem — uma
    // expressão gulosa que casasse a palavra solta calaria justamente ela, e o
    // agente ficaria sem saber o canal atual de ninguém.
    const boas = [
      "Hoje você vende pelo WhatsApp ou só pelo marketplace?",
      "Dá pra vender pelo WhatsApp com o Foocci, sim.",
      "Seus clientes já pedem pelo WhatsApp?",
      "O número de pedidos cresce quando o canal é seu.",
    ];

    for (const frase of boas) {
      const v = verificarResposta(frase);
      expect(v.motivos, `barrou uma fala legítima: "${frase}"`).not.toContain(
        "pediuTelefoneQueJaTem",
      );
    }
  });
});
