/**
 * ⭐ A LISTA DE LEADS — com o telefone MASCARADO.
 *
 * Pedido do Diretor Geral em 06/09/2026: nome, restaurante, cidade, telefone e
 * origem. O telefone sai mascarado por decisão minha, a pedido dele — a
 * justificativa inteira está em `telefoneMascarado`.
 *
 * ⚠️ `optOut` viaja junto e não é enfeite: é quem pediu silêncio. Uma lista de
 * leads sem essa marca é uma lista que convida ao contato de quem mandou parar.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAgente, telefoneMascarado } from "@/lib/agente-req";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const portao = exigirAgente(req, "ler:leads");
  if (!portao.ok) return portao.resposta;

  const bruto = (req.nextUrl.searchParams.get("limite") ?? "50").trim();
  const limite = Number.parseInt(bruto, 10);
  // Janela ilegível NÃO vira o padrão em silêncio: quem pediu 200 e recebeu 50
  // leria uma lista pela metade achando que a viu inteira.
  if (!Number.isFinite(limite) || limite <= 0 || limite > 200) {
    return NextResponse.json(
      { ok: false, error: `"${bruto}" não é um limite entre 1 e 200. Nada foi lido.` },
      { status: 422 },
    );
  }

  const estado = (req.nextUrl.searchParams.get("estado") ?? "").trim();

  const leads = await prisma.siteLead.findMany({
    where: estado === "" ? {} : { stage: estado as never },
    orderBy: { createdAt: "desc" },
    take: limite,
    select: {
      id: true, nome: true, restaurante: true, cidade: true, whatsapp: true,
      origem: true, utmSource: true, utmCampaign: true, fonte: true,
      stage: true, stageChangedAt: true, createdAt: true, optOutAt: true,
    },
  });

  return NextResponse.json({
    ok: true,
    total: leads.length,
    limite,
    leads: leads.map((l) => ({
      id: l.id,
      nome: l.nome,
      restaurante: l.restaurante,
      cidade: l.cidade,
      telefone: telefoneMascarado(l.whatsapp),
      origem: l.origem,
      utmSource: l.utmSource,
      utmCampaign: l.utmCampaign,
      fonte: l.fonte,
      estado: l.stage,
      estadoDesde: l.stageChangedAt,
      criadoEm: l.createdAt,
      optOut: l.optOutAt !== null,
    })),
    aviso:
      "telefone mascarado por padrão. `optOut: true` é quem pediu silêncio — não contatar, " +
      "por nenhum canal.",
  });
}
