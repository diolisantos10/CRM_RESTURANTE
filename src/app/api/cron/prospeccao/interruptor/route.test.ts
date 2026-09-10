/**
 * O interruptor da prospecção por cron: fail-closed, e liga só com teto.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const banco = vi.hoisted(() => ({
  prisma: { prospeccaoConfig: { findUnique: vi.fn(), upsert: vi.fn() } },
}));
vi.mock("@/lib/prisma", () => banco);

import { POST } from "./route";

const guardado = { ...process.env };

function bater(body: unknown, auth?: string) {
  return POST(
    new NextRequest("https://foocci.com.br/api/cron/prospeccao/interruptor", {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.CRON_SECRET = "segredo";
  banco.prisma.prospeccaoConfig.findUnique.mockResolvedValue({ limiteDiario: 0, outboundLigado: false, pausadoEm: null });
  banco.prisma.prospeccaoConfig.upsert.mockImplementation(async ({ update }: { update: Record<string, unknown> }) => ({
    limiteDiario: 0, motivo: null, atualizadoPor: null, ...update,
  }));
});
afterEach(() => { process.env = { ...guardado }; });

describe("a guarda", () => {
  it("sem CRON_SECRET: 503 e nada muda", async () => {
    delete process.env.CRON_SECRET;
    const res = await bater({ ligado: false }, "Bearer x");
    expect(res.status).toBe(503);
    expect(banco.prisma.prospeccaoConfig.upsert).not.toHaveBeenCalled();
  });
  it("segredo errado: 401", async () => {
    expect((await bater({ ligado: false }, "Bearer errado")).status).toBe(401);
  });
});

describe("o interruptor", () => {
  it("`ligado` ausente é recusado — não existe padrão", async () => {
    const res = await bater({}, "Bearer segredo");
    expect(res.status).toBe(400);
    expect(banco.prisma.prospeccaoConfig.upsert).not.toHaveBeenCalled();
  });

  it("⛔ ligar com teto zero é recusado, como na tela", async () => {
    const res = await bater({ ligado: true }, "Bearer segredo");
    expect(res.status).toBe(400);
    expect(banco.prisma.prospeccaoConfig.upsert).not.toHaveBeenCalled();
  });

  it("ligar com teto grava ligado, sem pausa, com quem e o teto", async () => {
    const res = await bater({ ligado: true, limiteDiario: 20, quem: "Diretor", motivo: "o CEO disse vai" }, "Bearer segredo");
    expect(res.status).toBe(200);
    const upsert = banco.prisma.prospeccaoConfig.upsert.mock.calls[0]![0] as { update: Record<string, unknown> };
    expect(upsert.update).toMatchObject({
      outboundLigado: true, pausadoEm: null, pausadoPor: null, limiteDiario: 20, atualizadoPor: "Diretor", motivo: "o CEO disse vai",
    });
    const json = (await res.json()) as { data: { ligada: boolean } };
    expect(json.data.ligada).toBe(true);
  });

  it("desligar vira PAUSA carimbada — quem e quando ficam gravados", async () => {
    const res = await bater({ ligado: false, quem: "Diretor" }, "Bearer segredo");
    expect(res.status).toBe(200);
    const upsert = banco.prisma.prospeccaoConfig.upsert.mock.calls[0]![0] as { update: Record<string, unknown> };
    expect(upsert.update).toMatchObject({ outboundLigado: false, pausadoPor: "Diretor" });
    expect(upsert.update.pausadoEm).toBeInstanceOf(Date);
    const json = (await res.json()) as { data: { ligada: boolean } };
    expect(json.data.ligada).toBe(false);
  });
});
