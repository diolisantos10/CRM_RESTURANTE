/**
 * GET /api/admin/sala-de-vendas/supervisora/visao-geral?de=…&ate=…
 *
 * A seção 1 do painel — os números que respondem, em segundos, "o que a
 * Supervisora fez nesta janela". Ver `painel.ts` para a agregação, que lê
 * só `SupervisoraAvaliacao` (mais `SiteLead.optOutAt`, documentado lá).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardarPainelDaSupervisora } from "../_guardaDoPainel";
import { visaoGeralDaSupervisora } from "@/services/salaDeVendas/supervisora/painel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const portao = await guardarPainelDaSupervisora(req, "ler_visao_geral_da_supervisora");
  if (!portao.ok) return portao.resposta;

  const agora = new Date();
  const params = req.nextUrl.searchParams;
  const de = params.get("de") ? new Date(params.get("de")!) : new Date(agora.getTime() - 7 * 86_400_000);
  const ate = params.get("ate") ? new Date(params.get("ate")!) : agora;

  if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime()) || de >= ate) {
    return NextResponse.json({ ok: false, error: "Período inválido." }, { status: 400 });
  }

  const data = await visaoGeralDaSupervisora(prisma, { de, ate });
  return NextResponse.json({ ok: true, data });
}
