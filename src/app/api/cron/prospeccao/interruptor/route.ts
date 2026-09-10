/**
 * POST /api/cron/prospeccao/interruptor   { ligado: boolean, motivo?: string, limiteDiario?: number }
 *
 * O INTERRUPTOR DA PROSPECÇÃO, ALCANÇÁVEL SEM O PAINEL.
 *
 * ── POR QUE ESTA ROTA EXISTE ────────────────────────────────────────────────
 *
 * Ordem do Diretor Geral, 10/09/2026: *"NENHUMA abordagem sai até o CEO dizer
 * 'vai'."* E a pergunta que veio junto — *"confirme QUAL trava impede envio
 * real hoje"* — não tinha resposta medível: o interruptor da prospecção mora
 * no banco, e quem opera a Sala de fora (o Diretor, numa sessão remota) não
 * tem o painel nem o banco. A única trava que ele alcançava era
 * `FOOCCI_SDR_SEND_ENABLED`, que derruba junto a resposta do TA a quem escreve.
 *
 * Esta rota é o mesmo interruptor da tela de Prospecção (`ProspeccaoConfig`,
 * a chave que a fila lê em `montarFilaDeProspeccao`), com a mesma regra —
 * **ligar com teto zero é ligar nada, e é recusado** — só que acionável por
 * `CRON_SECRET`, via workflow. Desligado, a fila nasce vazia e a rodada não
 * aborda ninguém, seja quem for que a dispare.
 *
 * ── O QUE ELA NÃO É ─────────────────────────────────────────────────────────
 *
 * Não é o "vai" do CEO. O "vai" é humano; isto é a mão que o executa — e que
 * pode desfazê-lo em um minuto. Quem ligou fica gravado em `atualizadoPor`.
 *
 * A guarda é a mesma da rodada, fail-closed: sem `CRON_SECRET`, 503.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function conferirCron(req: NextRequest): { ok: true } | { ok: false; status: 401 | 503; erro: string } {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/prospeccao/interruptor] CRON_SECRET não configurado — ausência de segredo é recusa.");
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

  const corpo = (await req.json().catch(() => ({}))) as {
    ligado?: unknown;
    motivo?: unknown;
    limiteDiario?: unknown;
    quem?: unknown;
  };

  if (typeof corpo.ligado !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "informe `ligado: true` ou `ligado: false` — sem padrão, de propósito" },
      { status: 400 },
    );
  }

  const quem = typeof corpo.quem === "string" && corpo.quem.trim() ? corpo.quem.trim() : "cron/interruptor";
  const motivo = typeof corpo.motivo === "string" ? corpo.motivo.trim() : null;
  const teto =
    typeof corpo.limiteDiario === "number" && Number.isInteger(corpo.limiteDiario) && corpo.limiteDiario >= 0
      ? corpo.limiteDiario
      : null;

  const atual = await prisma.prospeccaoConfig.findUnique({ where: { id: "singleton" } });

  // ── LIGAR COM TETO ZERO É LIGAR NADA — a mesma recusa da tela ──
  if (corpo.ligado) {
    const tetoQueValeria = teto ?? atual?.limiteDiario ?? 0;
    if (tetoQueValeria <= 0) {
      return NextResponse.json(
        { ok: false, error: "Informe `limiteDiario` > 0 antes de ligar. Ligar com teto zero não aborda ninguém." },
        { status: 400 },
      );
    }
  }

  const agora = new Date();
  const dados = {
    outboundLigado: corpo.ligado,
    // Desligar por aqui é PAUSA com carimbo: fica quem, quando e por quê. Ligar
    // limpa a pausa — e mantém o motivo anterior se nenhum novo vier.
    pausadoEm: corpo.ligado ? null : agora,
    pausadoPor: corpo.ligado ? null : quem,
    ...(motivo !== null ? { motivo } : {}),
    atualizadoPor: quem,
    ...(teto !== null ? { limiteDiario: teto } : {}),
  };

  const config = await prisma.prospeccaoConfig.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...dados },
    update: dados,
  });

  console.info("[cron/prospeccao/interruptor] prospecção", {
    ligada: config.outboundLigado && !config.pausadoEm,
    limiteDiario: config.limiteDiario,
    quem,
    motivo: config.motivo,
  });

  return NextResponse.json({
    ok: true,
    data: {
      ligada: config.outboundLigado && !config.pausadoEm,
      limiteDiario: config.limiteDiario,
      pausadaEm: config.pausadoEm,
      motivo: config.motivo,
      atualizadoPor: config.atualizadoPor,
    },
  });
}
