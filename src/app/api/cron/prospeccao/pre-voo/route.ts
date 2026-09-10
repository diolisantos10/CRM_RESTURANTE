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
 * ── DESDE 10/09/2026 ELA É O RAIO-X INTEIRO DA SALA ─────────────────────────
 *
 * Três coisas que ninguém conseguia medir sem o painel da Meta ou o banco de
 * produção passam a sair daqui, só leitura:
 *
 *   · **os modelos da conta, com o corpo** — "espera 3 variáveis" não diz quais;
 *   · **os interruptores** — a chave de envio, a chave da IA falar sozinha, o
 *     interruptor da prospecção no banco e a chave mestra do TA. Em 10/09 a
 *     pergunta "o que impede envio real hoje?" não tinha resposta medível: os
 *     valores do ambiente vêm redigidos para quem não é dono do Railway;
 *   · **a fila, contada** — lotes por situação e itens pendentes.
 *
 * Nenhum segredo sai: são booleanos, contagens e o texto que o cliente leria.
 *
 * ── O QUE ELA NÃO FAZ ───────────────────────────────────────────────────────
 *
 * Não monta fila, não materializa lead, não grava mensagem, não chama
 * `abordarLead`. Leituras contra a Graph e o banco, e um veredito. Rodar isto
 * mil vezes não fala com ninguém.
 *
 * A guarda é a mesma da rodada, e fail-closed: sem `CRON_SECRET`, 503.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { preVooDoModelo, modelosDaSala } from "@/services/foocci-sdr/modelosDaMeta";
import {
  canalDeVendasPronto,
  isFoocciSdrSendEnabled,
  iaRespondeSozinha,
} from "@/services/foocci-sdr/FoocciSalesChannel";
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

/**
 * Os interruptores e a fila, lidos do banco — e cada falha de leitura vira
 * campo dizendo que falhou, nunca um valor inventado (guardrail 1).
 */
async function raioXDoBanco() {
  const [prospeccao, ta, lotes, pendentesEmLoteLiberado, pendentesNoTotal] = await Promise.all([
    prisma.prospeccaoConfig.findUnique({ where: { id: "singleton" } }).catch(() => undefined),
    prisma.sdrIaConfig
      .findUnique({ where: { slug: "ta" }, select: { ligado: true, versaoAtivaId: true } })
      .catch(() => undefined),
    prisma.loteDeProspeccao
      .groupBy({ by: ["situacao"], _count: { _all: true } })
      .catch(() => undefined),
    prisma.itemDeProspeccao
      .count({ where: { situacao: "PENDENTE", lote: { situacao: "LIBERADO" } } })
      .catch(() => null),
    prisma.itemDeProspeccao.count({ where: { situacao: "PENDENTE" } }).catch(() => null),
  ]);

  return {
    interruptores: {
      envioLigado: isFoocciSdrSendEnabled(),
      iaRespondeSozinha: iaRespondeSozinha(),
      prospeccao:
        prospeccao === undefined
          ? { leitura: "falhou" as const }
          : prospeccao === null
            ? { leitura: "ok" as const, existe: false, ligada: false, pausadaEm: null, limiteDiario: 0 }
            : {
                leitura: "ok" as const,
                existe: true,
                ligada: prospeccao.outboundLigado && !prospeccao.pausadoEm,
                pausadaEm: prospeccao.pausadoEm,
                motivo: prospeccao.motivo,
                limiteDiario: prospeccao.limiteDiario,
                horasEntreAbordagens: prospeccao.horasEntreAbordagens,
                // A rodada automática de hoje aconteceu? Quem e quando — de fora.
                ultimaRodadaAutomaticaEm: prospeccao.ultimaRodadaAutomaticaEm,
                ultimaRodadaAutomaticaPor: prospeccao.ultimaRodadaAutomaticaPor,
              },
      ta:
        ta === undefined
          ? { leitura: "falhou" as const }
          : { leitura: "ok" as const, ligado: Boolean(ta?.ligado), temVersaoPublicada: Boolean(ta?.versaoAtivaId) },
    },
    fila: {
      lotesPorSituacao:
        lotes === undefined
          ? "leitura falhou"
          : Object.fromEntries(lotes.map((l) => [l.situacao, l._count._all])),
      itensPendentesEmLoteLiberado: pendentesEmLoteLiberado,
      itensPendentesNoTotal: pendentesNoTotal,
    },
  };
}

export async function POST(req: NextRequest) {
  const guarda = conferirCron(req);
  if (!guarda.ok) {
    return NextResponse.json({ ok: false, error: guarda.erro }, { status: guarda.status });
  }

  const [conferencia, lista, banco] = await Promise.all([
    preVooDoModelo(),
    modelosDaSala(),
    raioXDoBanco(),
  ]);
  const cfg = modeloConfigurado();

  // 🔒 O nome do modelo e o idioma são configuração, não segredo — e sem eles o
  // veredito não diz nada a quem lê. O token nunca aparece: nada aqui o devolve.
  const data = {
    modeloConfigurado: { nome: cfg.nome || null, idioma: cfg.idioma },
    canalPronto: canalDeVendasPronto(),
    conferencia,
    modelos: lista.ok ? lista.modelos : { erro: lista.erro },
    ...banco,
  };

  console.info("[cron/prospeccao/pre-voo] conferência do modelo", data);

  return NextResponse.json({ ok: true, data });
}
