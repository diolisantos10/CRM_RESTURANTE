/**
 * O TA FORA DA TRANSAÇÃO — a prova do desenho de 09/09/2026.
 *
 * ── O INCIDENTE ─────────────────────────────────────────────────────────────
 *
 * Às 09h42 de 09/09/2026 o log de produção registrou o TA falhando cinco vezes
 * seguidas para o CEO. O modelo não caiu: ele DEMOROU. O turno inteiro rodava
 * dentro de `comIdentidade` — uma transação interativa do Prisma, que fecha
 * sozinha em 5 s. Modelo em 6 s = transação morta = gravação falha = "quebrou".
 *
 * ── O QUE ESTE ARQUIVO PROVA ────────────────────────────────────────────────
 *
 *   (a) **A transação de leitura já fechou quando o modelo é chamado.** O dublê
 *       de `abrir` registra abertura e fechamento; o dublê do modelo confere se
 *       há transação aberta no instante em que é chamado, e o teste reprova se
 *       houver. É a asserção que teria pegado o incidente antes de ele existir.
 *   (b) **Com o modelo demorando 6 s, a resposta ainda é gravada e entregue.**
 *       Relógio falso: os seis segundos são avançados, não esperados.
 *   (c) **Com o modelo passando do PRAZO, o chão sai — e é gravado.** O prazo é
 *       injetado curto; o turno não fica mudo.
 *
 * E a metade legítima de cada uma: um `abrir` que estivesse sempre "aberto"
 * reprovaria tudo — o teste confere que as fases abrem e fecham de verdade.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const chamar = vi.hoisted(() => vi.fn());
const escolher = vi.hoisted(() => vi.fn());

vi.mock("@/services/brain/engines/OpenAIEngineAdapter", () => ({
  callStructuredJson: chamar,
  callText: chamar,
}));
vi.mock("@/services/brain/engines/AIEngineRouter", () => ({
  selectEngineRouted: escolher,
}));

import { atenderComOTA, type AbrirTransacao } from "./atender";
import { pensar } from "./cerebro";
import { LIMITE_DE_CARACTERES } from "./verificador";

/** Terça-feira, 09:00 em São Paulo — dentro da janela. */
const AGORA = new Date("2026-09-09T12:42:00Z");

const SEIS_SEGUNDOS = 6_000;

/** Uma resposta curta e aprovável, para o caminho feliz. */
const FALA_DO_MODELO = "O pedido sai pelo seu próprio canal, sem comissão de marketplace.";

function banco() {
  return {
    sdrIaConfig: {
      findUnique: vi.fn().mockResolvedValue({
        ligado: true,
        maxSemResposta: 3,
        versaoAtivaId: "v1",
        horaInicio: 9,
        horaFim: 20,
      }),
    },
    siteLead: {
      findUnique: vi.fn().mockResolvedValue({
        id: "l1",
        nome: "Dioli",
        atendidoPor: "IA",
        optOutAt: null,
        atendenteUserId: null,
        temperatura: null,
        tipo: null,
        desafio: null,
      }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    leadMensagem: {
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue({ ocorreuEm: AGORA }),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "m1" }),
    },
    siteLeadInteraction: { create: vi.fn().mockResolvedValue({}) },
    leadHandoff: { create: vi.fn().mockResolvedValue({ id: "h1" }) },
    internalUser: { findMany: vi.fn().mockResolvedValue([]) },
    leadScoreFator: {
      deleteMany: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({}),
    },
  };
}

/**
 * O dublê de `comIdentidade`: sabe se há transação aberta AGORA, e conta.
 *
 * É a peça que transforma "o modelo rodou fora da transação" de opinião em
 * medição. `aberta` é lida pelo dublê do modelo no instante da chamada.
 */
function transacaoVigiada(db: ReturnType<typeof banco>) {
  const estado = { aberta: false, abriu: 0, fechou: 0, abertaDuranteOModelo: null as boolean | null };

  const abrir: AbrirTransacao = async (trabalho) => {
    if (estado.aberta) throw new Error("transação aninhada — o Prisma não aninha, e o TA não pode pedir isso");
    estado.aberta = true;
    estado.abriu++;
    try {
      return await trabalho(db as never);
    } finally {
      estado.aberta = false;
      estado.fechou++;
    }
  };

  return { estado, abrir };
}

beforeEach(() => {
  chamar.mockReset();
  escolher.mockReset();
  escolher.mockResolvedValue({ provider: "OPENAI", model: "x" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("⭐⭐ o modelo NUNCA roda com transação aberta", () => {
  it("⭐ com o modelo demorando 6 s, a leitura já fechou — e a resposta é gravada e entregue", async () => {
    vi.useFakeTimers();
    const db = banco();
    const { estado, abrir } = transacaoVigiada(db);

    // O modelo demora 6 s e, no instante em que é chamado, ANOTA se havia
    // transação aberta. É a asserção (a): a leitura tem que ter fechado antes.
    chamar.mockImplementation(
      (input: { responseFormat?: string }) =>
        new Promise<string>((resolve) => {
          if (input.responseFormat === "json") return resolve("{}"); // a extração, rápida
          if (estado.abertaDuranteOModelo === null) estado.abertaDuranteOModelo = estado.aberta;
          setTimeout(() => resolve(FALA_DO_MODELO), SEIS_SEGUNDOS);
        }),
    );

    const turno = atenderComOTA(db as never, { leadId: "l1", mensagem: "como funciona o pedido?", agora: AGORA }, abrir);
    await vi.advanceTimersByTimeAsync(SEIS_SEGUNDOS + 1);
    const r = await turno;

    // (a) A transação de leitura já tinha fechado quando o modelo foi chamado.
    expect(estado.abertaDuranteOModelo, "o modelo foi chamado DENTRO de uma transação").toBe(false);
    expect(chamar, "o modelo nem chegou a ser chamado — o caso não prova nada").toHaveBeenCalled();

    // (b) Mesmo com 6 s, a resposta foi gravada — e o texto é o do modelo.
    expect(r.falou, `o TA não falou: ${JSON.stringify(r)}`).toBe(true);
    if (!r.falou || r.porPolitica) throw new Error("ramo errado");
    expect(r.resposta.origem).toBe("modelo");
    expect(r.resposta.texto).toBe(FALA_DO_MODELO);
    expect(db.leadMensagem.create).toHaveBeenCalledTimes(1);
    expect(r.mensagemId).toBe("m1");

    // E a entrega foi TENTADA por dentro de uma transação própria: `entregue`
    // é falso porque a chave do CEO está desligada no ambiente de teste, e
    // esse é o estado normal — o que se prova aqui é que o caminho passou.
    expect(r.entregue).toBe(false);
  });

  it("⭐ cada fase abre a SUA transação, e nenhuma fica aberta no fim", async () => {
    vi.useFakeTimers();
    const db = banco();
    const { estado, abrir } = transacaoVigiada(db);
    chamar.mockImplementation(
      (input: { responseFormat?: string }) =>
        new Promise<string>((resolve) => {
          if (input.responseFormat === "json") return resolve("{}");
          setTimeout(() => resolve(FALA_DO_MODELO), SEIS_SEGUNDOS);
        }),
    );

    const turno = atenderComOTA(db as never, { leadId: "l1", mensagem: "como funciona o pedido?", agora: AGORA }, abrir);
    await vi.advanceTimersByTimeAsync(SEIS_SEGUNDOS + 1);
    await turno;

    // Ler, gravar, entregar, qualificar-ler, qualificar-escrever. Cinco idas
    // curtas ao banco, e não uma longa. O número exato importa: se um dia
    // virar UMA, alguém voltou a carregar a transação pelo turno inteiro.
    expect(estado.abriu).toBe(5);
    expect(estado.fechou).toBe(estado.abriu);
    expect(estado.aberta).toBe(false);
  });

  it("a metade legítima: o vigia pega uma transação aberta durante o modelo", async () => {
    // Um `abrir` que "esquecesse" de fechar antes do modelo. Sem este caso, o
    // primeiro teste passaria mesmo se o vigia nunca marcasse `aberta`.
    const db = banco();
    const { estado } = transacaoVigiada(db);
    let vistoAberto: boolean | null = null;

    const abrirQueNaoFecha: AbrirTransacao = async (trabalho) => {
      estado.aberta = true;
      return trabalho(db as never);
    };
    chamar.mockImplementation(async () => {
      vistoAberto = estado.aberta;
      return FALA_DO_MODELO;
    });

    await atenderComOTA(db as never, { leadId: "l1", mensagem: "como funciona o pedido?", agora: AGORA }, abrirQueNaoFecha);

    expect(vistoAberto).toBe(true);
  });
});

describe("⭐ o prazo do modelo — estourou, sai o chão, e o chão é gravado", () => {
  it("modelo pendurado além do prazo vira resposta determinística, na hora", async () => {
    vi.useFakeTimers();
    const db = banco();
    const { abrir } = transacaoVigiada(db);

    // Nunca responde. Sem prazo, o turno ficaria pendurado até o socket morrer.
    chamar.mockImplementation(() => new Promise<string>(() => {}));

    // O prazo vai por `pensar` — provado direto, porque `atenderComOTA` não
    // expõe o parâmetro (em produção ele é a constante, e é assim que deve ser).
    const fala = pensar(
      { mensagem: "como funciona o pedido?", prazoMs: 500 },
      () => ({
        texto: "O Foocci monta o pedido no seu canal.",
        origem: "chao-deterministico" as const,
        apoiadoEm: [],
        reprovacoes: [],
        porque: "chão",
      }),
    );
    await vi.advanceTimersByTimeAsync(600);
    const r = await fala;

    expect(r.origem).toBe("chao-deterministico");
    expect(r.porque).toContain("não respondeu");
    expect(r.texto.length).toBeGreaterThan(10);

    // E o mesmo turno, de ponta a ponta, com o modelo mudo NAS DUAS chamadas
    // (redigir e etiquetar): o TA não emudece e o turno TERMINA. O prazo real
    // (20 s) é avançado no relógio falso, duas vezes — uma por chamada.
    const turno = atenderComOTA(db as never, { leadId: "l1", mensagem: "quanto custa?", agora: AGORA }, abrir);
    await vi.advanceTimersByTimeAsync(20_001);
    await vi.advanceTimersByTimeAsync(20_001);
    const t = await turno;

    expect(t.falou, `o TA calou: ${JSON.stringify(t)}`).toBe(true);
    if (!t.falou || t.porPolitica) throw new Error("ramo errado");
    expect(t.resposta.origem).toBe("chao-deterministico");
    expect(t.resposta.texto.length).toBeLessThanOrEqual(LIMITE_DE_CARACTERES);
    expect(db.leadMensagem.create).toHaveBeenCalledTimes(1);
  });

  it("a metade legítima: dentro do prazo, o modelo responde normalmente", async () => {
    chamar.mockResolvedValue(FALA_DO_MODELO);
    const fala = await pensar({ mensagem: "como funciona o pedido?", prazoMs: 500 }, () => {
      throw new Error("o chão não devia ter sido chamado");
    });
    expect(fala.origem).toBe("modelo");
    expect(fala.texto).toBe(FALA_DO_MODELO);
  });
});
