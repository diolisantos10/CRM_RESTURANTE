/**
 * GET /api/admin/sala-de-vendas/supervisora/desempenho?de=…&ate=…
 *
 * A seção 3 do painel — desempenho por agente. Usa `desempenhoPorAgente`
 * (`desempenho.ts`) sem reimplementar a agregação, e devolve junto os
 * critérios nomeados (`CRITERIOS_DA_FASE_3`) e os que a casa NÃO mede
 * automaticamente (`CRITERIOS_NAO_MEDIDOS_AUTOMATICAMENTE`) — a tela precisa
 * dos dois para nunca inventar nota onde não há sinal.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardarPainelDaSupervisora } from "../_guardaDoPainel";
import {
  desempenhoPorAgente,
  CRITERIOS_DA_FASE_3,
  CRITERIOS_NAO_MEDIDOS_AUTOMATICAMENTE,
} from "@/services/salaDeVendas/supervisora/desempenho";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const portao = await guardarPainelDaSupervisora(req, "ler_desempenho_dos_agentes");
  if (!portao.ok) return portao.resposta;

  const agora = new Date();
  const params = req.nextUrl.searchParams;
  const de = params.get("de") ? new Date(params.get("de")!) : new Date(agora.getTime() - 30 * 86_400_000);
  const ate = params.get("ate") ? new Date(params.get("ate")!) : agora;

  if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime()) || de >= ate) {
    return NextResponse.json({ ok: false, error: "Período inválido." }, { status: 400 });
  }

  const agentes = await desempenhoPorAgente(prisma, { de, ate });

  const autorIds = agentes.map((a) => a.autorUserId).filter((v): v is string => !!v);
  const nomes = autorIds.length
    ? await prisma.internalUser.findMany({ where: { id: { in: autorIds } }, select: { id: true, nome: true } })
    : [];
  const nomePorId = new Map(nomes.map((n) => [n.id, n.nome]));

  return NextResponse.json({
    ok: true,
    data: {
      periodo: { de, ate },
      criterios: CRITERIOS_DA_FASE_3,
      criteriosNaoMedidos: CRITERIOS_NAO_MEDIDOS_AUTOMATICAMENTE,
      agentes: agentes.map((a) => ({
        ...a,
        nome: a.autorUserId ? nomePorId.get(a.autorUserId) ?? a.autorUserId : (a.papelDoAgente ?? "TA"),
      })),
    },
  });
}
