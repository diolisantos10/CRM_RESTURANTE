/**
 * /api/admin/sala-de-vendas/supervisora/versoes
 *
 *   GET  → as versões do TA (`SdrIaConfigVersao`), com os metadados de
 *          auditoria da Supervisora, e qual está ativa agora.
 *   POST → { acao: "publicar", versaoId } — publica OU reverte, chamando
 *          `publicarVersaoExistente` (`ta/interruptor.ts`). É o MESMO
 *          mecanismo para as duas coisas — ver o comentário lá.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardarPainelDaSupervisora, exigirPodeDecidir } from "../_guardaDoPainel";
import { publicarVersaoExistente } from "@/services/salaDeVendas/ta/interruptor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const portao = await guardarPainelDaSupervisora(req, "ler_versoes_do_ta");
  if (!portao.ok) return portao.resposta;

  const config = await prisma.sdrIaConfig.findUnique({
    where: { slug: "ta" },
    select: { id: true, versaoAtivaId: true },
  });

  const versoes = config
    ? await prisma.sdrIaConfigVersao.findMany({
        where: { configId: config.id },
        orderBy: { numero: "desc" },
        take: 50,
        include: { publicadaPor: { select: { id: true, nome: true } } },
      })
    : [];

  return NextResponse.json({
    ok: true,
    data: {
      versaoAtivaId: config?.versaoAtivaId ?? null,
      versoes,
    },
  });
}

interface Corpo {
  acao?: unknown;
  versaoId?: unknown;
}

export async function POST(req: NextRequest) {
  const portao = await guardarPainelDaSupervisora(req, "publicar_versao_do_ta");
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

  const r = await publicarVersaoExistente(prisma, { versaoId, porUserId: portao.sessao.userId });
  if (r.ok) return NextResponse.json({ ok: true, data: r });

  const mensagens: Record<string, string> = {
    semConfig: "a ficha do TA ainda não existe",
    versaoNaoExiste: "versão não existe",
    versaoDeOutraConfig: "esta versão pertence a outra ficha",
  };
  return NextResponse.json({ ok: false, error: mensagens[r.causa] ?? r.causa }, { status: 400 });
}
