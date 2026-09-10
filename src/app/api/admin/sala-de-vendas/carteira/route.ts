/**
 * GET /api/admin/sala-de-vendas/carteira — todos os leads, numa tabela só.
 *
 * O alcance vem de `escopoDaConsulta`, o MESMO das filas: repetir a regra de
 * "o que este usuário pode ver" criaria uma segunda resposta para a mesma
 * pergunta, e as duas divergiriam no primeiro conserto.
 *
 * Só lê. Nenhum parâmetro daqui muda estado de lead nenhum.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardarSalaDeVendas } from "../_guarda";
import { escopoDaConsulta } from "@/services/salaDeVendas/filas";
import { montarCarteira, type EstadoDaCarteira } from "@/services/salaDeVendas/carteira";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ESTADOS = new Set<EstadoDaCarteira>([
  "todos", "semDesfecho", "followUpVencido", "nuncaAbordado",
  "aguardandoResposta", "ganhos", "perdidos", "silenciados",
]);

export async function GET(req: NextRequest) {
  const portao = await guardarSalaDeVendas(req, "ver_carteira");
  if (!portao.ok) return portao.resposta;

  const q = req.nextUrl.searchParams;
  const bruto = q.get("estado");
  // Estado desconhecido vira "todos" em vez de lista vazia: um filtro escrito
  // errado na URL não pode fazer a carteira parecer vazia.
  const estado = bruto && ESTADOS.has(bruto as EstadoDaCarteira) ? (bruto as EstadoDaCarteira) : "todos";

  const r = await montarCarteira(prisma, {
    escopo: escopoDaConsulta(portao.sessao),
    filtro: {
      busca: q.get("busca"),
      stage: q.get("stage"),
      temperatura: q.get("temperatura"),
      responsavel: q.get("responsavel"),
      origem: q.get("origem"),
      estado,
      limite: Number(q.get("limite") ?? "") || undefined,
    },
  });

  return NextResponse.json({ ok: true, data: r });
}
