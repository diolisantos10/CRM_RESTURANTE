/**
 * /api/admin/sala-de-vendas/supervisora/academia
 *
 *   GET  → as versões da Academia Comercial (`AcademiaComercialVersao`), com
 *          quantos itens cada uma tem e qual está publicada agora.
 *   POST → { acao: "publicar", versaoId } — publica OU reverte, chamando
 *          `publicarVersaoDaAcademia` (`supervisora/academiaInterruptor.ts`).
 *          Mesmo mecanismo para as duas coisas — ver o comentário lá.
 *
 * ── MESMA GUARDA DO RESTO DO PAINEL DA SUPERVISORA ──────────────────────────
 *
 * Ler é quem já enxerga o painel (`guardarPainelDaSupervisora`). Publicar uma
 * versão da Academia é decisão de gestão sobre o que a Supervisora usa para
 * JULGAR — mesma régua de quem pode publicar uma versão do TA
 * (`exigirPodeDecidir`): o auditor lê e não decide.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardarPainelDaSupervisora, exigirPodeDecidir } from "../_guardaDoPainel";
import { publicarVersaoDaAcademia } from "@/services/salaDeVendas/supervisora/academiaInterruptor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const portao = await guardarPainelDaSupervisora(req, "ler_versoes_da_academia");
  if (!portao.ok) return portao.resposta;

  const config = await prisma.academiaComercialConfig.findUnique({
    where: { id: "singleton" },
    select: { versaoAtivaId: true },
  });

  const versoes = await prisma.academiaComercialVersao.findMany({
    orderBy: { numero: "desc" },
    take: 50,
    include: {
      publicadaPor: { select: { id: true, nome: true } },
      _count: { select: { itens: true } },
    },
  });

  return NextResponse.json({
    ok: true,
    data: {
      versaoAtivaId: config?.versaoAtivaId ?? null,
      versoes: versoes.map((v) => ({
        id: v.id,
        numero: v.numero,
        situacao: v.situacao,
        notaDaVersao: v.notaDaVersao,
        totalDeItens: v._count.itens,
        publicadaEm: v.publicadaEm,
        publicadaPor: v.publicadaPor,
        criadaEm: v.criadaEm,
      })),
    },
  });
}

interface Corpo {
  acao?: unknown;
  versaoId?: unknown;
}

export async function POST(req: NextRequest) {
  const portao = await guardarPainelDaSupervisora(req, "publicar_versao_da_academia");
  if (!portao.ok) return portao.resposta;

  const recusa = exigirPodeDecidir(portao.sessao);
  if (recusa) return recusa;

  const corpo = (await req.json().catch(() => ({}))) as Corpo;
  const versaoId = typeof corpo.versaoId === "string" ? corpo.versaoId : "";
  const acao = typeof corpo.acao === "string" ? corpo.acao : "";

  if (acao !== "publicar") {
    return NextResponse.json({ ok: false, error: "acao inválida — use 'publicar'" }, { status: 400 });
  }
  if (!versaoId) {
    return NextResponse.json({ ok: false, error: "versaoId obrigatório" }, { status: 400 });
  }

  const r = await publicarVersaoDaAcademia(prisma, { versaoId, porUserId: portao.sessao.userId });
  if (r.ok) return NextResponse.json({ ok: true, data: r });

  const mensagens: Record<string, string> = {
    versaoNaoExiste: "versão não existe",
  };
  return NextResponse.json({ ok: false, error: mensagens[r.causa] ?? r.causa }, { status: 400 });
}
