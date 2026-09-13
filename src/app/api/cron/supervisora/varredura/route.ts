/**
 * POST /api/cron/supervisora/varredura
 *
 * A varredura do modo `INTERVENTION` — pausa conversa em andamento fora do
 * fluxo de uma mensagem específica (`supervisora/intervencao.ts`). Só faz
 * algo quando a Supervisora está de fato em `INTERVENTION`; nos outros modos
 * devolve `rodou: false` e não toca em nenhum lead — o mesmo padrão fail-safe
 * de `/api/cron/prospeccao/interruptor`.
 *
 * Guarda por `CRON_SECRET`, igual às outras rotas de cron da casa: sem
 * segredo configurado, 503 — ausência de segredo é recusa, nunca abertura.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { varrerConversasEmAndamento } from "@/services/salaDeVendas/supervisora/intervencao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function conferirCron(req: NextRequest): { ok: true } | { ok: false; status: 401 | 503; erro: string } {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/supervisora/varredura] CRON_SECRET não configurado — ausência de segredo é recusa.");
    return { ok: false, status: 503, erro: "CRON_SECRET não configurado" };
  }
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return { ok: false, status: 401, erro: "Unauthorized" };
  }
  return { ok: true };
}

export async function POST(req: NextRequest) {
  const guarda = conferirCron(req);
  if (!guarda.ok) {
    return NextResponse.json({ ok: false, error: guarda.erro }, { status: guarda.status });
  }

  const r = await varrerConversasEmAndamento(prisma, new Date());

  return NextResponse.json({ ok: true, data: r });
}
