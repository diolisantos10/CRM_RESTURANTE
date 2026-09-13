/**
 * GET /api/admin/sala-de-vendas/supervisora/conversas-em-risco?limite=…
 *
 * A seção 2 do painel — mensagens retidas ou reprovadas (VERMELHO/CRITICO),
 * mais recentes primeiro. Só leitura: a ação (assumir/transferir/liberar)
 * continua em `/api/admin/sala-de-vendas/responsavel`, que já existe — ver
 * `conversasEmRisco` em `painel.ts`.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardarPainelDaSupervisora } from "../_guardaDoPainel";
import { conversasEmRisco } from "@/services/salaDeVendas/supervisora/painel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const portao = await guardarPainelDaSupervisora(req, "ler_conversas_em_risco");
  if (!portao.ok) return portao.resposta;

  const limiteParam = req.nextUrl.searchParams.get("limite");
  const limite = limiteParam ? Math.min(200, Math.max(1, Number(limiteParam) || 50)) : 50;

  const data = await conversasEmRisco(prisma, { limite });
  return NextResponse.json({ ok: true, data });
}
