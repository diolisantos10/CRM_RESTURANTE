/**
 * ⭐ A FILA DE CONTATO — quem está em cadência ativa, em que degrau, há quanto.
 *
 * ⚠️ `atrasado` é calculado aqui e vem dito, em vez de deixar quem lê comparar
 * datas: *"cadência que some sem motivo vira lead abandonado"* está escrito no
 * próprio modelo, e uma fila que não grita o atraso é uma fila que esconde
 * exatamente o que ela existe para mostrar.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAgente, telefoneMascarado } from "@/lib/agente-req";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const portao = exigirAgente(req, "ler:fila-de-contato");
  if (!portao.ok) return portao.resposta;

  const agora = Date.now();
  const itens = await prisma.leadCadencia.findMany({
    where: { situacao: "ATIVA" },
    orderBy: { proximoEm: "asc" },
    take: 200,
    include: {
      lead: { select: { id: true, nome: true, restaurante: true, whatsapp: true, stage: true, optOutAt: true } },
    },
  });

  return NextResponse.json({
    ok: true,
    total: itens.length,
    fila: itens.map((c) => ({
      leadId: c.lead.id,
      nome: c.lead.nome,
      restaurante: c.lead.restaurante,
      telefone: telefoneMascarado(c.lead.whatsapp),
      estado: c.lead.stage,
      optOut: c.lead.optOutAt !== null,
      passo: c.passoAtual,
      proximoEm: c.proximoEm,
      atrasado: c.proximoEm !== null && c.proximoEm.getTime() < agora,
      naFilaDesde: c.createdAt,
    })),
    aviso: "só cadências ATIVAS. `atrasado` é o próximo passo com hora já vencida.",
  });
}
