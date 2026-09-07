/**
 * POST /api/print-agent/poll — heartbeat + job pickup for the Carteiro.
 *
 * Called every few seconds by the local agent. It:
 *   1. authenticates via the agent token,
 *   2. records the heartbeat + the printers the agent currently sees,
 *   3. returns the station→printer mapping and CLAIMS any pending print jobs.
 *
 * Public route (token-auth). The cloud never reaches into the LAN — the agent
 * always initiates.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveByToken } from "@/services/print/PrintAgentService";
import { emprestarJobs, resgatarJobsVencidos } from "@/services/print/PrintJobLease";
import { prisma } from "@/lib/prisma";
import { restoreNulFromPg } from "@/lib/pg-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    token?: unknown;
    printers?: unknown;
    version?: unknown;
  };
  const token = typeof body.token === "string" ? body.token : "";
  const agent = await resolveByToken(token);
  if (!agent) return NextResponse.json({ ok: false, error: "Não pareado." }, { status: 401 });

  const printers = Array.isArray(body.printers)
    ? body.printers.filter((p): p is string => typeof p === "string").slice(0, 100)
    : undefined;

  await prisma.printAgent.update({
    where: { id: agent.id },
    data: {
      lastSeenAt: new Date(),
      agentVersion: typeof body.version === "string" ? body.version.slice(0, 40) : agent.agentVersion,
      ...(printers ? { reportedPrinters: printers } : {}),
    },
  });

  const stations = await prisma.printStation.findMany({
    where: { restaurantId: agent.restaurantId },
    orderBy: { position: "asc" },
    select: { key: true, name: true, printerName: true, enabled: true },
  });

  // Primeiro o resgate: comanda que saiu daqui e nunca voltou com ack volta
  // para a fila. Antes disto o job ficava CLAIMED para sempre e o restaurante
  // simplesmente não imprimia, sem erro nenhum aparecer.
  await resgatarJobsVencidos(agent.restaurantId).catch((e) =>
    console.error("[print] resgate falhou", e),
  );

  const jobs = await emprestarJobs(agent.restaurantId);

  return NextResponse.json({
    ok: true,
    stations,
    // O job foi gravado com o 0x00 do ESC/POS escapado (o Postgres recusa esse
    // byte em texto). Aqui, e SÓ aqui, ele volta ao original: o Carteiro recebe
    // exatamente os mesmos bytes de sempre. Ver src/lib/pg-text.ts.
    jobs: jobs.map((j) => ({
      id: j.id,
      printerName: j.printerName,
      title: restoreNulFromPg(j.title),
      body: restoreNulFromPg(j.body),
    })),
  });
}
