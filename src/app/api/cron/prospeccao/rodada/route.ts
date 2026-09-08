/**
 * POST /api/cron/prospeccao/rodada
 *
 * A RODADA DAS 9h — a abordagem que acontece sem ninguém clicar.
 *
 * ── POR QUE ESTA ROTA EXISTE, nas palavras do CEO ───────────────────────────
 *
 * *"Apertar botão pra mandar mensagem? Isso não existe! Estamos criando
 * automação."*
 *
 * Ele está certo, e a medição concordava: até 08/09/2026 a Sala tinha o caminho
 * de **um** contato (o botão "Abordar") e **nenhum cron de prospecção** — as 17
 * pastas de `api/cron` eram todas de outros domínios. Os "250 por dia" eram 250
 * acionamentos manuais, o que não é operação: é digitação.
 *
 * ── O QUE ELA FAZ, e o que ela NÃO faz ──────────────────────────────────────
 *
 * Chama `abordarARodadaDoDia` e devolve o extrato. Nada mais. Ela não escolhe
 * quem entra (é a fila), não confere o teto do dia (a fila conta no banco), não
 * monta mensagem (é o modelo aprovado) e não afrouxa portão nenhum: cada item
 * atravessa exatamente as mesmas travas de quando era clicado à mão.
 *
 * ── ⚠️ QUEM RESPONDE POR UMA MENSAGEM QUE NINGUÉM MANDOU ────────────────────
 *
 * `abordarLead` promete, no cabeçalho dele, que *"toda mensagem que sai em nome
 * da empresa tem um responsável, e 'o sistema mandou' não é resposta para o dia
 * em que alguém perguntar quem falou com aquela pessoa"*.
 *
 * A rodada automática **não quebra essa promessa**: o responsável de cada item é
 * quem **liberou o lote** dele — uma pessoa, com nome, que autorizou a casa a
 * falar com aquela lista. Lote sem `liberadoPor` não é abordado.
 *
 * ── A GUARDA É FAIL-CLOSED, e o formato importa ─────────────────────────────
 *
 * Sem `CRON_SECRET`, responde 503 e não roda. É o mesmo desenho de
 * `run-scheduled-campaigns` — e o oposto do `if (secret) { ... }` que a
 * varredura de segurança encontrou em `expire-wa-ordering-sessions`, onde a
 * ausência da variável abre a porta em vez de fechá-la.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { abordarARodadaDoDia } from "@/services/salaDeVendas/prospeccao/abordarDaFila";
import { canalDeVendasPronto } from "@/services/foocci-sdr/FoocciSalesChannel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function conferirCron(req: NextRequest): { ok: true } | { ok: false; status: 401 | 503; erro: string } {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(
      "[cron/prospeccao/rodada] CRON_SECRET não está configurado — a rodada NÃO roda. " +
        "Ausência de segredo é recusa, nunca passe livre.",
    );
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

  const corpo = (await req.json().catch(() => ({}))) as { teto?: unknown };
  const teto =
    typeof corpo.teto === "number" && Number.isInteger(corpo.teto) && corpo.teto > 0
      ? corpo.teto
      : undefined;

  const r = await abordarARodadaDoDia(prisma, {
    autor: "SISTEMA",
    canalPronto: canalDeVendasPronto(),
    ...(teto !== undefined ? { teto } : {}),
  });

  // ⚠️ O resultado vai para o log SEMPRE, e não só quando dá errado. Uma rodada
  // que manda zero e uma que não rodou são indistinguíveis para quem olha de
  // fora — e é essa confusão que faz uma lista queimar sem ninguém perceber.
  console.info("[cron/prospeccao/rodada] rodada concluída", {
    abordados: r.abordados,
    pulados: r.pulados,
    parouPor: r.parouPor,
    falha: r.falha,
  });

  return NextResponse.json({ ok: true, data: r });
}
