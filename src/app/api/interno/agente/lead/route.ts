/**
 * ⭐ A FICHA DE UM LEAD — `?id=`.
 *
 * ⚠️ Sem segmento dinâmico de propósito: este repositório tem DUAS convenções
 * para `params` (síncrona e Promise) convivendo, e escolher a errada quebra na
 * versão seguinte do framework. Parâmetro de busca não tem esse problema.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAgente, telefoneMascarado } from "@/lib/agente-req";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const portao = exigirAgente(req, "ler:lead-detalhe");
  if (!portao.ok) return portao.resposta;

  const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
  if (id === "") {
    return NextResponse.json({ ok: false, error: "parâmetro `id` obrigatório." }, { status: 422 });
  }

  const lead = await prisma.siteLead.findUnique({
    where: { id },
    include: { qualificacao: true },
  });
  if (!lead) {
    return NextResponse.json({ ok: false, error: "lead não encontrado." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    lead: {
      id: lead.id,
      nome: lead.nome,
      restaurante: lead.restaurante,
      cidade: lead.cidade,
      telefone: telefoneMascarado(lead.whatsapp),
      tipo: lead.tipo,
      desafio: lead.desafio,
      origem: lead.origem,
      utmSource: lead.utmSource,
      utmMedium: lead.utmMedium,
      utmCampaign: lead.utmCampaign,
      fonte: lead.fonte,
      estado: lead.stage,
      estadoDesde: lead.stageChangedAt,
      estadoMudadoPor: lead.stageChangedBy,
      criadoEm: lead.createdAt,
      submissoes: lead.submissions,
      optOut: lead.optOutAt !== null,
      optOutCanal: lead.optOutCanal,
      qualificacao: lead.qualificacao
        ? {
            segmento: lead.qualificacao.segmento,
            unidades: lead.qualificacao.unidades,
            volumeMensal: lead.qualificacao.volumeMensal,
            canaisAtuais: lead.qualificacao.canaisAtuais,
            sistemaAtual: lead.qualificacao.sistemaAtual,
            dorPrincipal: lead.qualificacao.dorPrincipal,
            objetivo: lead.qualificacao.objetivo,
            urgencia: lead.qualificacao.urgencia,
            poderDeDecisao: lead.qualificacao.poderDeDecisao,
          }
        : null,
    },
  });
}
