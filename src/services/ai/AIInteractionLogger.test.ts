/**
 * Portão de FIAÇÃO: prova que a regra pura chega mesmo ao payload gravado.
 *
 * Mockamos SÓ o prisma. O módulo de preço NÃO é mockado de propósito — a lição
 * da vitrine é que uma regra correta ficou invisível porque o teste mockava o
 * módulo inteiro que a continha. Aqui o preço é calculado de verdade.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const create = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { aIInteractionLog: { create: (...a: unknown[]) => create(...a) } },
}));

import { AIInteractionLogger } from "./AIInteractionLogger";

const base = {
  restaurantId: "r1",
  conversationId: "c1",
  promptTokens: 10_000,
  completionTokens: 5_000,
  latencyMs: 120,
  turnNumber: 1,
  toolCalls: [],
  success: true,
};

const payload = () => create.mock.calls[0][0].data;

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({});
});

describe("custo gravado", () => {
  // METADE 1 — modelo desconhecido grava NULL, não o preço do gpt-4o.
  it("modelo desconhecido grava estimatedCostUsd = null", async () => {
    await AIInteractionLogger.log({ ...base, model: "deepseek-chat" });

    const gpt4oCost = (10_000 / 1000) * 0.0025 + (5_000 / 1000) * 0.01;
    expect(payload().estimatedCostUsd).toBeNull();
    expect(payload().estimatedCostUsd).not.toBe(gpt4oCost);
  });

  // METADE 2 — modelo conhecido continua gravando o número certo.
  it("modelo conhecido grava o custo calculado", async () => {
    await AIInteractionLogger.log({ ...base, model: "gpt-4o-mini" });

    expect(payload().estimatedCostUsd).toBeCloseTo(
      (10_000 / 1000) * 0.00015 + (5_000 / 1000) * 0.0006,
      10,
    );
  });
});

describe("agentSlug gravado", () => {
  // METADE 1 — ausente/vazio grava NULL, nunca um agente chutado.
  it.each([undefined, null, "", "   "])("agentSlug %j grava null", async (slug) => {
    await AIInteractionLogger.log({
      ...base,
      model: "gpt-4o-mini",
      agentSlug: slug as string | null | undefined,
    });

    expect(payload().agentSlug).toBeNull();
  });

  // METADE 2 — slug conhecido é gravado (e normalizado).
  it("agentSlug conhecido é gravado", async () => {
    await AIInteractionLogger.log({ ...base, model: "gpt-4o-mini", agentSlug: "  waiter " });
    expect(payload().agentSlug).toBe("waiter");
  });
});

describe("falha de log nunca quebra o fluxo do cliente", () => {
  it("erro do prisma é engolido — nunca lança", async () => {
    create.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    /*
      A garantia é a mesma de sempre: NÃO LANÇA. O que mudou em 28/08/2026 é que
      o resultado passou a ser DITO em vez de sumir — o medidor do motor precisa
      saber que a linha não entrou para tentar de novo sem atribuição. Trocar
      isto por `throw` derrubaria o fluxo do cliente (guardrail 5).
    */
    await expect(
      AIInteractionLogger.log({ ...base, model: "gpt-4o-mini" }),
    ).resolves.toMatchObject({ gravado: false });

    spy.mockRestore();
  });

  it("gravação bem-sucedida devolve `gravado: true`", async () => {
    // A outra metade: sem ela, devolver sempre `{gravado:false}` passaria no
    // teste acima — e o medidor gravaria tudo duas vezes, achando que falhou.
    await expect(
      AIInteractionLogger.log({ ...base, model: "gpt-4o-mini" }),
    ).resolves.toEqual({ gravado: true });
  });
});

describe("contagem de tokens incompleta", () => {
  // METADE 1 — o provedor não devolveu `usage` em alguma iteração: custo do turno
  // é indeterminado, mesmo com modelo precificado. Piso não vira total.
  it("tokensUnknown grava estimatedCostUsd = null mesmo em modelo conhecido", async () => {
    await AIInteractionLogger.log({ ...base, model: "gpt-4o-mini", tokensUnknown: true });

    expect(payload().estimatedCostUsd).toBeNull();
    // Os tokens contados continuam gravados — eles são o que se sabe.
    expect(payload().totalTokens).toBe(15_000);
  });

  // METADE 2 — contagem completa continua produzindo número.
  it("tokensUnknown false/ausente grava o custo normalmente", async () => {
    await AIInteractionLogger.log({ ...base, model: "gpt-4o-mini", tokensUnknown: false });

    expect(payload().estimatedCostUsd).toBeGreaterThan(0);
  });
});
