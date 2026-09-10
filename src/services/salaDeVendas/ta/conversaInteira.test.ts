/**
 * UMA CONVERSA INTEIRA — o desenho de ponta a ponta, num caso só.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE, TENDO OS OUTROS ────────────────────────────
 *
 * Os outros testes deste diretório provam peças: o verificador barra, o portão
 * escala, a sondagem não avança à toa. Cada um isolado, como tem que ser.
 *
 * Nenhum deles prova que as peças, juntas, produzem uma CONVERSA. E é a conversa
 * que o CEO vai olhar — não a suíte. Um sistema pode ter todas as peças verdes e
 * uma conversa que se perde no terceiro turno: a sondagem repetindo, o histórico
 * não chegando, o handoff disparando cedo demais.
 *
 * Este arquivo roda cinco turnos seguidos, do "oi" ao pedido de gente, e afirma o
 * que muda entre eles. É o teste que se lê para entender o produto.
 *
 * O modelo é dublê e as falas são roteirizadas: aqui não se mede a QUALIDADE do
 * texto (isso é do ensaio, com um humano lendo), mede-se se a máquina em volta
 * dele se comporta ao longo do tempo.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const criar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/openai", () => ({ openai: { chat: { completions: { create: criar } } } }));

import { falar } from "./falar";
import { tabelaPublicada } from "../precos";
import { LINKS_DO_FOOCCI } from "./links";

const ambiente = { ...process.env };

/** O preço REAL do primeiro plano — o TA não pode citar outro. */
const PRECO = tabelaPublicada()[0]!.ciclos.find((c) => c.ciclo === "MENSAL")!.doCiclo;

const FALAS_DO_MODELO = [
  "Oi! Aqui é o TA, do Foocci. Que tipo de restaurante você tem?",
  // ⚠️ SEM pergunta no fim, desde 09/09/2026: "quanto custa?" é pedido de
  // informação objetiva, e a regra do CEO é entregar e parar. A versão antiga
  // desta fala ("...Hoje você vende mais pelo marketplace ou pelo seu canal?")
  // é REPROVADA pelo verificador agora — e este roteiro é o que o modelo
  // escreveria depois de aprender a regra.
  `O Essencial sai por ${PRECO} por mês. Os três planos estão em ${LINKS_DO_FOOCCI.precos}`,
  "Hoje a gente não integra com o iFood — o Foocci trabalha no seu canal próprio.",
  "Faz sentido. Com entrega própria a comissão fica bem menor que a do marketplace.",
  // O modelo TENTA chamar gente por conta própria no último turno. Não é ele
  // quem decide — e o teste abaixo prova que a decisão veio de outro lugar.
  "Claro, vou chamar alguém do time agora.",
];

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-teste-nao-e-uma-chave-real";
  let i = 0;
  criar.mockReset();
  criar.mockImplementation(async () => ({
    choices: [{ message: { content: FALAS_DO_MODELO[Math.min(i++, FALAS_DO_MODELO.length - 1)] } }],
  }));
});

afterEach(() => {
  process.env = { ...ambiente };
});

describe("do 'oi' ao pedido de gente, cinco turnos", () => {
  it("⭐ a conversa avança, a sondagem acompanha, e o handoff é do código", async () => {
    const turnos = [
      "oi, vi o site de vocês",
      "quanto custa?",
      "vocês trabalham com iFood?",
      "é que eu pago muita comissão hoje",
      "quero falar com uma pessoa",
    ];

    const jaPerguntou: number[] = [];
    const historico: Array<{ deQuem: "cliente" | "ta"; texto: string }> = [];
    const resultados = [];

    for (const t of turnos) {
      const r = await falar({ mensagem: t, nome: "Marcos", jaPerguntou, historico });
      resultados.push(r);
      if (r.perguntouIndice !== null) jaPerguntou.push(r.perguntouIndice);
      historico.push({ deQuem: "cliente", texto: t }, { deQuem: "ta", texto: r.texto });
    }

    const [um, dois, tres, quatro, cinco] = resultados;

    // 1. Abertura: o modelo redige e faz a primeira pergunta da sondagem.
    expect(um!.origem).toBe("modelo");
    expect(um!.perguntouIndice).toBe(0);

    // 2. Preço: aprovado porque é o da tabela, com o link — e SEM pergunta,
    // porque a pessoa pediu uma informação objetiva. A sondagem não anda.
    expect(dois!.origem).toBe("modelo");
    expect(dois!.reprovacoes).toEqual([]);
    expect(dois!.perguntouIndice).toBeNull();
    expect(dois!.texto).toContain(PRECO);
    expect(dois!.texto).toContain(LINKS_DO_FOOCCI.precos);

    // 3. ⭐ Ele NEGA a integração — resposta honesta, e o verificador deixa
    // passar. E não perguntou nada, então a sondagem NÃO anda.
    expect(tres!.origem).toBe("modelo");
    expect(tres!.reprovacoes).toEqual([]);
    expect(tres!.perguntouIndice, "queimou uma pergunta sem ter perguntado").toBeNull();

    // 4. Objeção respondida sem prometer nada.
    expect(quatro!.origem).toBe("modelo");
    expect(quatro!.reprovacoes).toEqual([]);

    // 5. ⭐ O modelo ESCREVEU "vou chamar alguém" no turno 5 — e não foi ele
    // quem decidiu. A fala que saiu é a do código, e o motivo tem nome.
    expect(cinco!.origem).toBe("handoff-deterministico");
    expect(cinco!.handoff).toEqual({ deve: true, motivo: "PEDIU_HUMANO" });
    expect(cinco!.texto).not.toBe(FALAS_DO_MODELO[4]);

    // E a sondagem terminou com UMA pergunta feita em cinco turnos — não
    // cinco. Era [0, 1] até 09/09/2026; a pergunta do turno 2 saiu porque a
    // pessoa tinha pedido o preço. É o número que uma conversa de verdade produz.
    expect(jaPerguntou).toEqual([0]);
  });

  it("o histórico cresce e chega ao modelo a cada turno", async () => {
    // Sem isto o TA cumprimenta a mesma pessoa a cada mensagem. É a diferença
    // entre uma conversa e uma sequência de respostas soltas.
    const historico: Array<{ deQuem: "cliente" | "ta"; texto: string }> = [];

    await falar({ mensagem: "oi", historico });
    historico.push({ deQuem: "cliente", texto: "oi" }, { deQuem: "ta", texto: "Oi! Aqui é o TA." });
    await falar({ mensagem: "quanto custa?", historico });

    const segundaChamada = criar.mock.calls[1]![0] as { messages: Array<{ content: string }> };
    const enviado = segundaChamada.messages.map((m) => m.content).join("\n");

    expect(enviado).toContain("CONVERSA ATÉ AQUI");
    expect(enviado).toContain("Cliente: oi");
  });

  it("⭐ e se o modelo cair no meio, a conversa continua", async () => {
    // O pior dia do sistema. Dois turnos com modelo, o terceiro sem — e o TA
    // continua respondendo, mais seco, sem deixar o lead falando sozinho.
    const r1 = await falar({ mensagem: "oi, vi o site" });
    expect(r1.origem).toBe("modelo");

    criar.mockRejectedValue(new Error("503 Service Unavailable"));

    const r2 = await falar({ mensagem: "quanto custa o plano essencial?" });
    expect(r2.origem).toBe("chao-deterministico");
    expect(r2.texto.length).toBeGreaterThan(10);
  });
});
