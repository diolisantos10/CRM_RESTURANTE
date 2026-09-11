/**
 * O dispatcher do Brain passa a MEDIR o que gasta.
 *
 * ── O defeito que estes testes reproduzem ─────────────────────────────────────
 * `callStructuredJson` é o gargalo por onde passa toda chamada de IA do Brain.
 * A OpenAI devolve `completion.usage` na MESMA resposta; o adapter lia
 * `choices[0]` e descartava o resto. Consequência medida em 28/08/2026:
 * `AIInteractionLogger.log` tinha UM chamador em todo o `src/` e a casa media o
 * custo do Garçom e de mais nada.
 *
 * ── A régua desta casa: o teste alcança o que o dono LÊ ───────────────────────
 * Não basta afirmar que uma função interna foi chamada. O último bloco pega a
 * linha EXATA que o `AIInteractionLogger` manda para o Prisma e a empurra pelo
 * mesmo caminho da Sala dos Agentes — `aggregateCost` → `agentBucket` →
 * `medidaDeCustoDoAgente` — que é o número que aparece no cartão do agente.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const cliente = vi.hoisted(() => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));
vi.mock("@/lib/openai", () => cliente);

const bancoFalso = vi.hoisted(() => ({
  prisma: { aIInteractionLog: { create: vi.fn() } },
}));
vi.mock("@/lib/prisma", () => bancoFalso);

import { callStructuredJson } from "../OpenAIEngineAdapter";
import { registrarUsoDoMotor } from "../EngineUsageRecorder";
import { USO_DESCONHECIDO } from "../EngineAdapter";
import {
  aggregateCost,
  agentBucket,
  UNATTRIBUTED,
  type UsageRow,
} from "@/services/ai/pricing/costAggregation";
import {
  AGENTES_COM_CUSTO_ATRIBUIDO,
  medidaDeCustoDoAgente,
} from "@/services/agents/sala/montagem";

const selection = { provider: "OPENAI" as const, model: "gpt-4o-mini" };
const chaveOriginal = process.env.OPENAI_API_KEY;
let avisos: ReturnType<typeof vi.spyOn>;
let erros: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = "sk-de-teste";
  bancoFalso.prisma.aIInteractionLog.create.mockResolvedValue({ id: "log_1" });
  avisos = vi.spyOn(console, "warn").mockImplementation(() => {});
  erros = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  avisos.mockRestore();
  erros.mockRestore();
  if (chaveOriginal === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = chaveOriginal;
});

function respondeCom(opts: {
  content?: string | null;
  finish_reason?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}) {
  cliente.openai.chat.completions.create.mockResolvedValue({
    choices: [{ finish_reason: opts.finish_reason ?? "stop", message: { content: opts.content ?? "{}" } }],
    ...(opts.usage === null ? {} : { usage: opts.usage ?? { prompt_tokens: 1200, completion_tokens: 300 } }),
  });
}

/** A linha que o logger mandou para o banco. `null` = nada foi gravado. */
async function linhaGravada(): Promise<Record<string, unknown> | null> {
  try {
    await vi.waitFor(() => expect(bancoFalso.prisma.aIInteractionLog.create).toHaveBeenCalled(), {
      timeout: 1000,
    });
  } catch {
    return null;
  }
  const chamadas = bancoFalso.prisma.aIInteractionLog.create.mock.calls;
  return chamadas[chamadas.length - 1][0].data as Record<string, unknown>;
}

// ── 1. O `usage` deixa de ser descartado ──────────────────────────────────────

describe("o dispatcher mede o que gasta", () => {
  it("a contagem de tokens que a OpenAI devolve chega ao registro — era ela que se perdia", async () => {
    respondeCom({ content: '{"ok":true}', usage: { prompt_tokens: 1200, completion_tokens: 300 } });

    await expect(callStructuredJson({ selection, systemPrompt: "s", userContent: "u" })).resolves.toBe(
      '{"ok":true}',
    );

    const linha = await linhaGravada();
    expect(linha, "nenhuma linha foi gravada — o usage voltou a ser descartado").not.toBeNull();
    expect(linha).toMatchObject({
      model: "gpt-4o-mini",
      promptTokens: 1200,
      completionTokens: 300,
      totalTokens: 1500,
      success: true,
    });
  });

  it("o custo gravado sai da tabela de preços, não de tarifa inventada", async () => {
    // gpt-4o-mini: 0.00015/1k entrada + 0.0006/1k saída.
    // 1200 tokens de entrada = 0.00018 · 300 de saída = 0.00018 · total 0.00036.
    respondeCom({ usage: { prompt_tokens: 1200, completion_tokens: 300 } });
    await callStructuredJson({ selection, systemPrompt: "s", userContent: "u" });

    const linha = await linhaGravada();
    expect(linha?.estimatedCostUsd).toBeCloseTo(0.00036, 8);
  });

  it("modelo fora da tabela de preços NÃO vira custo zero — vira custo desconhecido", async () => {
    respondeCom({ usage: { prompt_tokens: 100, completion_tokens: 50 } });
    await callStructuredJson({
      selection: { provider: "OPENAI", model: "gpt-modelo-que-nao-existe" },
      systemPrompt: "s",
      userContent: "u",
    });

    const linha = await linhaGravada();
    // Zero some do radar; null aparece como "não medido" na tela do dono.
    expect(linha?.estimatedCostUsd).toBeNull();
    expect(linha?.promptTokens).toBe(100);
  });

  it("provedor que NÃO devolveu usage grava desconhecido, nunca zero", async () => {
    respondeCom({ usage: null });
    await callStructuredJson({ selection, systemPrompt: "s", userContent: "u" });

    const linha = await linhaGravada();
    expect(linha?.estimatedCostUsd).toBeNull();
    expect(linha?.totalTokens).toBe(0);
  });

  it("resposta cortada pelo teto de tokens também custou — e entra na conta como falha", async () => {
    respondeCom({
      finish_reason: "length",
      content: '{"parcial": "ma',
      usage: { prompt_tokens: 900, completion_tokens: 700 },
    });

    await expect(
      callStructuredJson({ selection, systemPrompt: "s", userContent: "u", maxTokens: 700 }),
    ).rejects.toMatchObject({ motivo: "cortado_por_limite" });

    const linha = await linhaGravada();
    expect(linha, "a chamada falhou DEPOIS de gastar token e não foi contabilizada").not.toBeNull();
    expect(linha).toMatchObject({ promptTokens: 900, completionTokens: 700, success: false });
  });

  it("falha que nem chegou ao provedor NÃO é contabilizada — inventar chamada é tão errado quanto perder", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(
      callStructuredJson({ selection, systemPrompt: "s", userContent: "u" }),
    ).rejects.toMatchObject({ motivo: "sem_chave" });

    await new Promise((r) => setTimeout(r, 20));
    expect(bancoFalso.prisma.aIInteractionLog.create).not.toHaveBeenCalled();
  });
});

// ── 2. Atribuição é opcional; contabilidade não é ─────────────────────────────

describe("atribuição opcional, contabilidade obrigatória", () => {
  it("chamador que passa contexto tem o gasto atribuído", async () => {
    respondeCom({});
    await callStructuredJson({
      selection,
      systemPrompt: "s",
      userContent: "u",
      context: { restaurantId: "rest_1", agentSlug: "crm", conversationId: "conv_9" },
    });

    const linha = await linhaGravada();
    expect(linha).toMatchObject({ restaurantId: "rest_1", agentSlug: "crm", conversationId: "conv_9" });
  });

  it("chamador que NÃO passa contexto continua sendo contabilizado, como origem desconhecida", async () => {
    respondeCom({});
    await callStructuredJson({ selection, systemPrompt: "s", userContent: "u" });

    const linha = await linhaGravada();
    expect(linha, "chamada sem contexto sumiu da contabilidade").not.toBeNull();
    expect(linha).toMatchObject({ restaurantId: null, agentSlug: null, totalTokens: 1500 });
  });

  it("restaurante recusado pelo banco perde o DONO, nunca o gasto", async () => {
    // Chave estrangeira: o id passado não existe (sonda administrativa,
    // restaurante recém-apagado). A primeira gravação falha, a segunda entra.
    bancoFalso.prisma.aIInteractionLog.create
      .mockRejectedValueOnce(new Error("Foreign key constraint failed on the field: `restaurantId`"))
      .mockResolvedValueOnce({ id: "log_2" });

    await registrarUsoDoMotor({
      model: "gpt-4o-mini",
      usage: { promptTokens: 10, completionTokens: 5, desconhecido: false },
      latencyMs: 12,
      success: true,
      context: { restaurantId: "rest_que_nao_existe", agentSlug: "crm" },
    });

    const chamadas = bancoFalso.prisma.aIInteractionLog.create.mock.calls;
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1][0].data).toMatchObject({ restaurantId: null, agentSlug: "crm", promptTokens: 10 });
  });
});

// ── 3. O registro nunca derruba nem atrasa a resposta ao cliente ──────────────

describe("o medidor nunca é mais destrutivo que o problema que evita", () => {
  it("banco fora do ar não derruba a resposta ao cliente", async () => {
    bancoFalso.prisma.aIInteractionLog.create.mockRejectedValue(new Error("connection refused"));
    respondeCom({ content: '{"resposta":"ok"}' });

    await expect(
      callStructuredJson({ selection, systemPrompt: "s", userContent: "u" }),
    ).resolves.toBe('{"resposta":"ok"}');

    await vi.waitFor(() => expect(avisos).toHaveBeenCalled(), { timeout: 1000 });
  });

  it("`registrarUsoDoMotor` NUNCA rejeita — nem com entrada quebrada", async () => {
    /*
      A metade que faltava, achada por mutação: tirar o try/catch de dentro de
      `registrarUsoDoMotor` não derrubava nenhum teste, porque o `.catch` do
      disparo em segundo plano cobria o caminho do dispatcher. Mas a função é
      EXPORTADA — um chamador futuro que a espere receberia a exceção que ela
      promete nunca ter. O contrato é da função, não só do disparo.
    */
    const entradaQuebrada = { model: "gpt-4o-mini", latencyMs: 1, success: true } as never;
    await expect(registrarUsoDoMotor(entradaQuebrada)).resolves.toBeUndefined();
    expect(avisos).toHaveBeenCalled();
  });

  it("a resposta volta ANTES de o registro terminar — o cliente não espera o INSERT", async () => {
    let liberar: (() => void) | null = null;
    bancoFalso.prisma.aIInteractionLog.create.mockImplementation(
      () => new Promise((resolve) => { liberar = () => resolve({ id: "log_3" }); }),
    );
    respondeCom({ content: '{"rapido":true}' });

    // Se o dispatcher esperasse a gravação, esta linha travaria para sempre.
    await expect(
      callStructuredJson({ selection, systemPrompt: "s", userContent: "u" }),
    ).resolves.toBe('{"rapido":true}');

    await vi.waitFor(() => expect(liberar).not.toBeNull(), { timeout: 1000 });
    liberar!();
  });
});

// ── 4. O que o DONO lê: o cartão do agente na Sala ────────────────────────────

describe("a medição chega ao número que o dono lê na Sala dos Agentes", () => {
  /** Converte a linha do Prisma no formato que a Sala lê do banco. */
  function comoALinhaVoltaDoBanco(data: Record<string, unknown>): UsageRow {
    return {
      model: data.model as string,
      agentSlug: data.agentSlug as string | null,
      promptTokens: data.promptTokens as number,
      completionTokens: data.completionTokens as number,
    };
  }

  it("uma chamada de CRM pelo dispatcher vira custo no cartão do agente `crm`", async () => {
    respondeCom({ usage: { prompt_tokens: 2000, completion_tokens: 1000 } });
    await callStructuredJson({
      selection,
      systemPrompt: "s",
      userContent: "u",
      context: { restaurantId: "rest_1", agentSlug: "crm" },
    });

    const linha = await linhaGravada();
    expect(linha).not.toBeNull();

    // A MESMA linha, pelo caminho da Sala.
    const relatorio = aggregateCost([comoALinhaVoltaDoBanco(linha!)]);
    const bucket = agentBucket(relatorio, "crm");
    const instrumentado = AGENTES_COM_CUSTO_ATRIBUIDO.includes("crm");

    expect(instrumentado, "o `crm` não está na lista de agentes instrumentados").toBe(true);
    const medida = medidaDeCustoDoAgente("crm", bucket, instrumentado);

    // 2000 entrada = 0.0003 · 1000 saída = 0.0006 · total 0.0009.
    expect(medida).toMatchObject({ estado: "medido", valor: 0.0009, unidade: "US$" });
    expect(bucket.calls).toBe(1);
    expect(bucket.totalTokens).toBe(3000);
  });

  it("a chamada sem dono aparece no balde 'não atribuído' — some do agente, não do total", async () => {
    respondeCom({ usage: { prompt_tokens: 2000, completion_tokens: 1000 } });
    await callStructuredJson({ selection, systemPrompt: "s", userContent: "u" });

    const linha = await linhaGravada();
    const relatorio = aggregateCost([comoALinhaVoltaDoBanco(linha!)]);

    expect(agentBucket(relatorio, "crm").calls).toBe(0);
    expect(agentBucket(relatorio, UNATTRIBUTED).calls).toBe(1);
    // O total continua contando o gasto — é este o ganho.
    expect(relatorio.total.knownCostUsd).toBeCloseTo(0.0009, 8);
  });

  it("chamada sem contagem de tokens deixa o cartão em 'não medido', nunca em zero", async () => {
    const relatorio = aggregateCost([
      { model: "modelo-fora-da-tabela", agentSlug: "crm", promptTokens: 0, completionTokens: 0 },
    ]);
    const medida = medidaDeCustoDoAgente("crm", agentBucket(relatorio, "crm"), true);
    expect(medida.estado).toBe("naoMedido");
  });

  it("USO_DESCONHECIDO é um estado, não um zero disfarçado", () => {
    expect(USO_DESCONHECIDO.desconhecido).toBe(true);
  });
});
