/**
 * CINCO TURNOS — o que o CEO pediu para o TA falar, provado numa conversa.
 *
 * ── O PEDIDO (09/09/2026) ───────────────────────────────────────────────────
 *
 *   · **entregar o link** quando fizer sentido: preços, demo, assinar;
 *   · **não terminar toda resposta com pergunta** — no máximo uma a cada duas,
 *     e nunca quando a pessoa pediu uma informação objetiva;
 *   · **curto**: dentro do teto do verificador.
 *
 * ── COMO SE PROVA ───────────────────────────────────────────────────────────
 *
 * Um lead escreve cinco mensagens em sequência — oi / o que é / quanto custa /
 * quero ver demo / como assino — entrando por `atenderComOTA`, o degrau de
 * produção, com um banco de mentira que ACUMULA a conversa (é dele que o TA lê
 * o que já perguntou e o histórico que manda ao modelo).
 *
 * E roda DUAS vezes:
 *
 *   1. com o modelo dublado, seguindo o roteiro que um modelo obediente
 *      escreveria — prova que a trava deixa passar o que deve;
 *   2. com o modelo DESLIGADO — só o chão determinístico. Prova que as três
 *      exigências valem no pior dia do TA, e não só quando o modelo colabora.
 *
 * Nenhuma das asserções mede QUALIDADE de texto. Medem o que dá para medir:
 * tamanho, presença do link certo, ausência da pergunta fora de hora.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const chamar = vi.hoisted(() => vi.fn());
const escolher = vi.hoisted(() => vi.fn());

vi.mock("@/services/brain/engines/OpenAIEngineAdapter", () => ({
  callStructuredJson: chamar,
  callText: chamar,
}));
vi.mock("@/services/brain/engines/AIEngineRouter", () => ({
  selectEngineRouted: escolher,
}));

import { atenderComOTA, type ResultadoDoTurno } from "./atender";
import { LINKS_DO_FOOCCI } from "./links";
import { VERSAO_1 } from "./ficha";
import { tabelaPublicada } from "../precos";
import { LIMITE_DE_CARACTERES, LIMITE_DE_FRASES, contarFrases, verificarResposta } from "./verificador";

/** Terça-feira, 09:00 em São Paulo. */
const AGORA = new Date("2026-09-08T12:00:00Z");

const PRECO = tabelaPublicada()[0]!.ciclos.find((c) => c.ciclo === "MENSAL")!.doCiclo;

const AS_CINCO = [
  "oi",
  "o que é o Foocci?",
  "quanto custa?",
  "quero ver uma demo",
  "como assino?",
] as const;

/**
 * O roteiro de um modelo que aprendeu as regras. Cada fala é o que sairia
 * para a mensagem de mesmo índice. Repare: só a PRIMEIRA pergunta.
 */
const ROTEIRO_DO_MODELO = [
  "Oi, Dioli — aqui é o agente de atendimento do Foocci. Que tipo de restaurante você tem?",
  "É um sistema pra restaurante vender no próprio canal: cardápio, pedido, pagamento e WhatsApp, sem comissão de marketplace.",
  `O Essencial é ${PRECO} por mês. Os três planos estão em ${LINKS_DO_FOOCCI.precos}`,
  `Dá pra ver funcionando agora, sem cadastro: ${LINKS_DO_FOOCCI.demo}. Depois me conta o que achou.`,
  `Pra assinar é por aqui: ${LINKS_DO_FOOCCI.assinar}. Você escolhe o plano e aceita o termo ali mesmo.`,
];

type Msg = { direcao: "ENTRADA" | "SAIDA"; texto: string; ocorreuEm: Date };

/**
 * Um banco que acumula a conversa. `findMany` respeita o `where.direcao` e o
 * `orderBy` que o TA usa — é o que faz `perguntasJaFeitas` e `conversaAteAqui`
 * enxergarem os turnos anteriores, como em produção.
 */
function bancoComConversa() {
  const mensagens: Msg[] = [];
  let relogio = AGORA.getTime();
  const proximo = () => new Date((relogio += 1000));

  const findMany = vi.fn(async (args: { where?: { direcao?: string }; orderBy?: { ocorreuEm?: string }; take?: number }) => {
    let lista = mensagens.filter((m) => !args.where?.direcao || m.direcao === args.where.direcao);
    if (args.orderBy?.ocorreuEm === "desc") lista = [...lista].reverse();
    if (args.take) lista = lista.slice(0, args.take);
    return lista.map((m) => ({ direcao: m.direcao, texto: m.texto }));
  });

  const db = {
    sdrIaConfig: {
      findUnique: vi.fn().mockResolvedValue({ ligado: true, maxSemResposta: 3, versaoAtivaId: "v1", horaInicio: 9, horaFim: 20 }),
    },
    siteLead: {
      findUnique: vi.fn().mockResolvedValue({
        id: "l1", nome: "Dioli Santos", atendidoPor: "IA", optOutAt: null, atendenteUserId: null, temperatura: null, tipo: null, desafio: null,
      }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    leadMensagem: {
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn(async () => ({ ocorreuEm: [...mensagens].reverse().find((m) => m.direcao === "ENTRADA")?.ocorreuEm ?? new Date(0) })),
      findMany,
      create: vi.fn(async (args: { data: { texto: string } }) => {
        mensagens.push({ direcao: "SAIDA", texto: args.data.texto, ocorreuEm: proximo() });
        return { id: `m${mensagens.length}` };
      }),
    },
    siteLeadInteraction: { create: vi.fn().mockResolvedValue({}) },
    leadHandoff: { create: vi.fn().mockResolvedValue({ id: "h1" }) },
    internalUser: { findMany: vi.fn().mockResolvedValue([]) },
    leadScoreFator: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
  };

  /** O cliente escreveu — a entrada é gravada ANTES de o TA ser chamado, como no webhook. */
  const entrou = (texto: string) => mensagens.push({ direcao: "ENTRADA", texto, ocorreuEm: proximo() });

  return { db, entrou };
}

function textoDe(r: ResultadoDoTurno): string {
  if (!r.falou) throw new Error(`o TA não falou: ${JSON.stringify(r)}`);
  return r.porPolitica ? r.texto : r.resposta.texto;
}

async function conversar(): Promise<string[]> {
  const { db, entrou } = bancoComConversa();
  const respostas: string[] = [];
  for (const m of AS_CINCO) {
    entrou(m);
    const r = await atenderComOTA(db as never, { leadId: "l1", mensagem: m, agora: AGORA });
    respostas.push(textoDe(r));
  }
  return respostas;
}

/** As asserções do CEO, aplicadas às cinco respostas — iguais nas duas variantes. */
function oQueOCEOPediu(respostas: string[]) {
  expect(respostas).toHaveLength(5);
  const [, , preco, demo, assinar] = respostas;

  // Curto: nenhuma acima do teto — e o teto é o do verificador, não outro.
  for (const [i, r] of respostas.entries()) {
    expect(r.length, `turno ${i + 1} passou de ${LIMITE_DE_CARACTERES} caracteres: "${r}"`).toBeLessThanOrEqual(LIMITE_DE_CARACTERES);
    expect(contarFrases(r), `turno ${i + 1} passou de ${LIMITE_DE_FRASES} frases: "${r}"`).toBeLessThanOrEqual(LIMITE_DE_FRASES);
  }

  // Nem todas terminam com pergunta.
  const terminamComPergunta = respostas.filter((r) => r.trim().endsWith("?")).length;
  expect(terminamComPergunta, "todas as respostas terminam com pergunta").toBeLessThan(respostas.length);

  // Pedido objetivo → resposta sem pergunta nenhuma. É a regra, não a média.
  expect(preco, "perguntou depois de o lead pedir o preço").not.toContain("?");
  expect(demo, "perguntou depois de o lead pedir demo").not.toContain("?");
  expect(assinar, "perguntou depois de o lead pedir para assinar").not.toContain("?");

  // O link certo, na resposta certa.
  expect(preco).toContain(LINKS_DO_FOOCCI.precos);
  expect(demo).toContain(LINKS_DO_FOOCCI.demo);
  expect(assinar).toContain(LINKS_DO_FOOCCI.assinar);

  // Nenhuma pergunta da sondagem aparece duas vezes na conversa — a pessoa
  // que respondeu (ou ignorou) não ouve a mesma pergunta de novo.
  for (const pergunta of VERSAO_1.perguntas) {
    const vezes = respostas.filter((r) => r.includes(pergunta)).length;
    expect(vezes, `a pergunta "${pergunta}" apareceu ${vezes}×`).toBeLessThanOrEqual(1);
  }

  // E a mesma pergunta não volta no turno seguinte, com as mesmas palavras.
  for (let i = 1; i < respostas.length; i++) {
    const anterior = respostas[i - 1]!.match(/[^.!?]*\?/)?.[0]?.trim();
    if (anterior) expect(respostas[i], `turno ${i + 1} repetiu a pergunta do turno ${i}`).not.toContain(anterior);
  }
}

beforeEach(() => {
  chamar.mockReset();
  escolher.mockReset();
});

describe("⭐⭐ cinco turnos — oi / o que é / quanto custa / demo / assinar", () => {
  it("⭐ com o modelo redigindo: links, sem pergunta em pedido objetivo, curto", async () => {
    escolher.mockResolvedValue({ provider: "OPENAI", model: "x" });
    let i = 0;
    chamar.mockImplementation(async (input: { responseFormat?: string }) => {
      if (input.responseFormat === "json") return "{}"; // a extração de sinais
      return ROTEIRO_DO_MODELO[Math.min(i++, ROTEIRO_DO_MODELO.length - 1)]!;
    });

    const respostas = await conversar();

    oQueOCEOPediu(respostas);
    // E foi o MODELO que falou nos cinco — nenhum caiu no chão por reprovação.
    // Sem isto, um roteiro ruim passaria nas asserções de cima pelo chão.
    expect(respostas).toEqual(ROTEIRO_DO_MODELO);
  });

  it("⭐ com o modelo DESLIGADO — o chão determinístico cumpre as mesmas regras", async () => {
    escolher.mockResolvedValue({ provider: "MOCK", model: "nenhum" });

    const respostas = await conversar();

    oQueOCEOPediu(respostas);
    expect(chamar, "o modelo foi chamado com o cérebro desligado").not.toHaveBeenCalled();

    // O chão cita o preço da tabela, e não só o link.
    expect(respostas[2]).toContain(PRECO);
    // E cada resposta do chão passaria pelo verificador como se fosse do modelo.
    for (const [i, r] of respostas.entries()) {
      const v = verificarResposta(r);
      expect(v.aprovada, `turno ${i + 1} reprovado: ${v.detalhe}`).toBe(true);
    }
  });

  it("a metade que reprova: o roteiro ANTIGO — pergunta depois do preço — cai no chão, e o chão ainda cumpre", async () => {
    // O que o modelo fazia até 09/09/2026. Se este roteiro passasse pela trava,
    // a regra do CEO seria aviso, não trava.
    escolher.mockResolvedValue({ provider: "OPENAI", model: "x" });
    const ROTEIRO_ANTIGO = [
      "Oi! Aqui é o agente de atendimento do Foocci. Que tipo de restaurante você tem?",
      "É um sistema de vendas pra restaurante. Hoje você vende por onde?",
      `O Essencial sai por ${PRECO} por mês. Hoje você vende mais pelo marketplace ou pelo seu canal?`,
      "Claro! Você prefere ver por vídeo ou ao vivo?",
      "Posso te ajudar com isso. Qual plano você quer?",
    ];
    let i = 0;
    chamar.mockImplementation(async (input: { responseFormat?: string }) => {
      if (input.responseFormat === "json") return "{}";
      // Cada turno tenta duas vezes (a reprovação dá uma segunda chance); as
      // duas recebem a mesma fala teimosa.
      return ROTEIRO_ANTIGO[Math.min(Math.floor(i++ / 2), ROTEIRO_ANTIGO.length - 1)]!;
    });

    const respostas = await conversar();

    // Os turnos 3, 4 e 5 (pedido objetivo + pergunta) NÃO são o que o modelo
    // escreveu: a trava reprovou e o chão respondeu.
    expect(respostas[2]).not.toBe(ROTEIRO_ANTIGO[2]);
    expect(respostas[3]).not.toBe(ROTEIRO_ANTIGO[3]);
    expect(respostas[4]).not.toBe(ROTEIRO_ANTIGO[4]);
    // O turno 2 (pergunta logo depois de outra pergunta) também.
    expect(respostas[1]).not.toBe(ROTEIRO_ANTIGO[1]);
    // E o que saiu no lugar cumpre o que o CEO pediu.
    oQueOCEOPediu(respostas);
  });
});
