/**
 * POST /api/admin/sala-de-vendas/abordagem — a primeira mensagem sai por aqui.
 *
 * ── AS TRÊS CAMADAS, COMO NO RESTO DA SALA ──────────────────────────────────
 *
 *   1. `guardarSalaDeVendas` — você é da Sala? (protege o endereço)
 *   2. `podeVerOLead`        — este lead é alcançável por você? (protege o dado)
 *   3. `abordarLead`         — o portão do lead e o freio de ritmo decidem
 *
 * ── ⚠️ UM LEAD POR CHAMADA, E É DE PROPÓSITO ───────────────────────────────
 *
 * Esta rota **não** aceita lista. Quem quiser abordar dez chama dez vezes — e a
 * cada vez o freio de ritmo é consultado de novo, com o número atualizado.
 * Aceitar um array aqui faria o freio ser lido uma vez e valer para o lote
 * inteiro, que é exatamente o defeito que o freio existe para impedir.
 *
 * ── O QUE ELA DEVOLVE QUANDO NÃO MANDA ─────────────────────────────────────
 *
 * O motivo, sempre, em campo separado e em frase de gente. "Não deu" sem motivo
 * faz quem está operando tentar de novo — e tentar de novo é a pior reação a um
 * teto de ritmo.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardarSalaDeVendas, somenteLeitura, podeVerOLead } from "../_guarda";
import { abordarLead, type ResultadoDaAbordagem } from "@/services/salaDeVendas/abordar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const portao = await guardarSalaDeVendas(req, "abordar_lead");
  if (!portao.ok) return portao.resposta;

  if (somenteLeitura(portao.sessao)) {
    return NextResponse.json({ ok: false, error: "Auditoria lê e não escreve." }, { status: 403 });
  }

  const corpo = (await req.json().catch(() => null)) as { leadId?: string } | null;
  const leadId = corpo?.leadId?.trim();
  if (!leadId) {
    return NextResponse.json({ ok: false, error: "leadId é obrigatório." }, { status: 400 });
  }

  const acesso = await podeVerOLead(portao.sessao, leadId, "abordar_lead");
  if (!acesso.ok) return acesso.resposta;

  const r = await abordarLead(prisma, { leadId, autorUserId: portao.sessao.userId });

  if (r.abordou) {
    return NextResponse.json({ ok: true, data: { mensagemId: r.mensagemId } });
  }

  return NextResponse.json(
    { ok: false, error: frase(r), motivo: r.motivo, detalhe: r.detalhe },
    { status: r.motivo === "leadNaoExiste" ? 404 : 409 },
  );
}

/**
 * O motivo em frase de gente.
 *
 * `ritmo` não é erro e a frase não pode soar como um: quem está abordando
 * precisa entender que o sistema está segurando de propósito, e que insistir é
 * justamente o que não se deve fazer.
 */
function frase(r: Extract<ResultadoDaAbordagem, { abordou: false }>): string {
  switch (r.motivo) {
    case "leadNaoExiste":
      return "Este contato não existe mais.";
    case "portaoRecusou":
      return `Não pode ser abordado agora: ${r.detalhe}`;
    case "ritmo":
      return `O freio de ritmo segurou esta abordagem — ${r.detalhe}. Isto é proteção do número, não falha: tente mais tarde.`;
    case "naoConseguiuGravar":
      return "Não consegui registrar a mensagem, então nada foi enviado.";
    case "aMetaRecusou":
      return `Registrei a mensagem, mas o WhatsApp recusou o envio: ${r.detalhe}`;
    default:
      return "Não foi possível abordar.";
  }
}
