/**
 * POST /api/cron/prospeccao/pre-voo
 *
 * A CONFERÊNCIA DO MODELO, SOZINHA — sem fila, sem lead, sem enviar nada.
 *
 * ── POR QUE ESTA ROTA EXISTE, e ela custou seis contatos ────────────────────
 *
 * Em 08/09/2026 a rodada de prospecção foi disparada quatro vezes para
 * descobrir por que a Meta recusava. Duas dessas vezes chegaram ao envio e
 * gastaram **três contatos cada** — seis nomes de uma lista de 4.000 — para
 * aprender uma coisa que uma consulta de leitura responde de graça:
 *
 *   (#132000) Number of parameters does not match the expected number of params
 *
 * O pré-voo (`conferirModeloDeAbordagem`) existe exatamente para isso, e ele
 * estava cego — mas **descobrir que ele estava cego também custou contatos**,
 * porque a única forma de executá-lo era disparando a rodada inteira.
 *
 * É o mesmo raciocínio do pré-voo, um degrau acima: **a peça que evita gasto
 * não pode ser testável só gastando.**
 *
 * ── O QUE ELA NÃO FAZ ───────────────────────────────────────────────────────
 *
 * Não monta fila, não materializa lead, não grava mensagem, não chama
 * `abordarLead`. Duas leituras contra a Graph e um veredito. Rodar isto mil
 * vezes não fala com ninguém.
 *
 * A guarda é a mesma da rodada, e fail-closed: sem `CRON_SECRET`, 503.
 */

import { NextRequest, NextResponse } from "next/server";
import { preVooDoModelo } from "@/services/foocci-sdr/modelosDaMeta";
import { canalDeVendasPronto } from "@/services/foocci-sdr/FoocciSalesChannel";
import { modeloConfigurado } from "@/services/salaDeVendas/abordar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function conferirCron(req: NextRequest): { ok: true } | { ok: false; status: 401 | 503; erro: string } {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/prospeccao/pre-voo] CRON_SECRET não configurado — ausência de segredo é recusa.");
    return { ok: false, status: 503, erro: "CRON_SECRET não configurado" };
  }
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return { ok: false, status: 401, erro: "Unauthorized" };
  }
  return { ok: true };
}

export async function POST(req: NextRequest) {
  const guarda = conferirCron(req);
  if (!guarda.ok) {
    return NextResponse.json({ ok: false, error: guarda.erro }, { status: guarda.status });
  }

  const conferencia = await preVooDoModelo();
  const cfg = modeloConfigurado();

  // 🔒 O nome do modelo e o idioma são configuração, não segredo — e sem eles o
  // veredito não diz nada a quem lê. O token nunca aparece: `preVooDoModelo`
  // não o devolve.
  const data = {
    modeloConfigurado: { nome: cfg.nome || null, idioma: cfg.idioma },
    canalPronto: canalDeVendasPronto(),
    conferencia,
  };

  console.info("[cron/prospeccao/pre-voo] conferência do modelo", data);

  return NextResponse.json({ ok: true, data });
}
