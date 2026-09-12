/**
 * A SUPERVISORA — estado e o interruptor de modo.
 *
 *   GET  → estado atual (ligada, modo, quem mexeu por último) + histórico
 *   POST → { modo?: "OFF"|"SHADOW"|"GUARD"|"INTERVENTION", ligada?: boolean, motivo?: string }
 *
 * ── ⚠️ QUEM PODE MUDAR O MODO ────────────────────────────────────────────────
 *
 * Ler é da Sala inteira — inclusive o auditor: saber em que modo a Supervisora
 * está é dado de auditoria, não de operação. **Mudar de modo é papel de
 * gestão**, o mesmo padrão de `vePelaOperacaoToda` menos o auditor (que lê e
 * não decide política): `MASTER_CEO`, `DIRETOR_FOOCCI`, `GERENTE_DEPARTAMENTO`.
 *
 * O código NUNCA muda o próprio modo (guardrail 3) — esta rota é a única porta,
 * e ela exige papel de gestão em toda chamada.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardarSalaDeVendas } from "../_guarda";
import { lerConfig, alterarModo, historicoDeModo } from "@/services/salaDeVendas/supervisora/config";
import type { ModoDaSupervisora } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODOS_VALIDOS: readonly ModoDaSupervisora[] = ["OFF", "SHADOW", "GUARD", "INTERVENTION"];

/** Quem decide POLÍTICA de qualidade — não confundir com quem só lê. */
const PODE_MUDAR_MODO = new Set(["MASTER_CEO", "DIRETOR_FOOCCI", "GERENTE_DEPARTAMENTO"]);

export async function GET(req: NextRequest) {
  const portao = await guardarSalaDeVendas(req, "ler_estado_da_supervisora");
  if (!portao.ok) return portao.resposta;

  const estado = await lerConfig(prisma);
  const historico = await historicoDeModo(prisma, { limite: 20 });

  return NextResponse.json({
    ok: true,
    data: {
      ...estado,
      historico,
      podeMudarModo: PODE_MUDAR_MODO.has(portao.sessao.role),
    },
  });
}

interface Corpo {
  modo?: unknown;
  ligada?: unknown;
  motivo?: unknown;
}

export async function POST(req: NextRequest) {
  const portao = await guardarSalaDeVendas(req, "mudar_modo_da_supervisora");
  if (!portao.ok) return portao.resposta;

  if (!PODE_MUDAR_MODO.has(portao.sessao.role)) {
    return NextResponse.json(
      { ok: false, error: "Mudar o modo da Supervisora é decisão de gestão." },
      { status: 403 },
    );
  }

  const c = (await req.json().catch(() => ({}))) as Corpo;

  if (c.modo !== undefined && !MODOS_VALIDOS.includes(c.modo as ModoDaSupervisora)) {
    return NextResponse.json(
      { ok: false, error: `modo inválido — use um de: ${MODOS_VALIDOS.join(", ")}` },
      { status: 400 },
    );
  }
  if (c.ligada !== undefined && typeof c.ligada !== "boolean") {
    return NextResponse.json({ ok: false, error: "`ligada` precisa ser boolean" }, { status: 400 });
  }
  if (c.modo === undefined && c.ligada === undefined) {
    return NextResponse.json(
      { ok: false, error: "informe `modo` e/ou `ligada` — sem nenhum dos dois, nada mudaria" },
      { status: 400 },
    );
  }

  const r = await alterarModo(prisma, {
    novoModo: c.modo as ModoDaSupervisora | undefined,
    novaLigada: c.ligada as boolean | undefined,
    alteradoPor: portao.sessao.userId,
    motivo: typeof c.motivo === "string" ? c.motivo : null,
  });

  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.causa }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: r });
}
