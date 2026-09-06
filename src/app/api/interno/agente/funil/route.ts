/**
 * ⭐ O FUNIL — quantos leads em cada estado. Só contagem, nenhum dado pessoal.
 *
 * `stage` é enum no banco de propósito ("estado é DADO, nunca texto livre"),
 * então esta rota conta o que a casa já modelou, sem inventar categoria.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAgente } from "@/lib/agente-req";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const portao = exigirAgente(req, "ler:funil");
  if (!portao.ok) return portao.resposta;

  const linhas = await prisma.siteLead.groupBy({
    by: ["stage"],
    _count: { _all: true },
  });

  const porEstado = Object.fromEntries(linhas.map((l) => [l.stage, l._count._all]));
  const total = linhas.reduce((s, l) => s + l._count._all, 0);

  return NextResponse.json({
    ok: true,
    total,
    porEstado,
    // ⚠️ Estado que não aparece tem ZERO, e não "não sei". A diferença importa:
    // quem lê um funil sem uma etapa conclui que ela não existe.
    aviso: "estados ausentes do mapa têm zero leads. Nenhum dado pessoal nesta rota.",
  });
}
