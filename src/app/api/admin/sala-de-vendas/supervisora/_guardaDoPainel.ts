/**
 * A GUARDA DO PAINEL DA SUPERVISORA.
 *
 * ── POR QUE NÃO É `guardarSalaDeVendas` ──────────────────────────────────────
 *
 * A guarda da Sala (`../_guarda.ts`) aceita `AGENTE_HUMANO` de propósito — é a
 * área de trabalho do SDR. O painel da Supervisora mostra desempenho
 * comparado de agentes, prompt do TA e o interruptor de modo: informação de
 * gestão sobre pessoas e sobre o comportamento do agente de IA, no mesmo
 * espírito do painel do gerente (`../painel/route.ts`), que também mantém a
 * própria lista de papéis em vez de reaproveitar a guarda da Sala.
 *
 * Ler é `MASTER_CEO`, `DIRETOR_FOOCCI`, `GERENTE_DEPARTAMENTO` e
 * `AUDITOR_QA` — o mesmo conjunto que já enxerga o Painel e o Agente na aba.
 * Escrever (aprovar/rejeitar sugestão, publicar versão) é só quem decide
 * política: o auditor lê e não decide — o mesmo motivo por que ele não muda o
 * modo em `route.ts`.
 */

import { NextRequest, NextResponse } from "next/server";
import { autorizarInterno, type SessaoInterna } from "@/lib/internal-auth";
import { prisma } from "@/lib/prisma";

export type PortaoDoPainel =
  | { ok: true; sessao: SessaoInterna }
  | { ok: false; resposta: NextResponse };

const PAPEIS_QUE_LEEM = ["MASTER_CEO", "DIRETOR_FOOCCI", "GERENTE_DEPARTAMENTO", "AUDITOR_QA"] as const;

/** Quem decide política — aprovar sugestão, publicar versão. Auditor fora. */
export const PODE_DECIDIR = new Set(["MASTER_CEO", "DIRETOR_FOOCCI", "GERENTE_DEPARTAMENTO"]);

export async function guardarPainelDaSupervisora(req: NextRequest, acao: string): Promise<PortaoDoPainel> {
  const auth = autorizarInterno(req, { papeis: [...PAPEIS_QUE_LEEM] });

  if (!auth.ok) {
    try {
      await prisma.internalAuditEvent.create({
        data: {
          actorType: auth.sessao ? "INTERNAL_USER" : "ANONIMO",
          actorLabel: auth.sessao ? `${auth.sessao.nome} (${auth.sessao.userId})` : "anônimo",
          acao,
          recurso: "sala-de-vendas/supervisora/painel",
          resultado: "NEGADO",
          motivo: auth.motivo,
        },
      });
    } catch {
      // Trilha fora do ar não abre a porta.
    }
    return { ok: false, resposta: NextResponse.json({ ok: false, error: auth.motivo }, { status: auth.status }) };
  }

  return { ok: true, sessao: auth.sessao };
}

export function exigirPodeDecidir(sessao: SessaoInterna): NextResponse | null {
  if (PODE_DECIDIR.has(sessao.role)) return null;
  return NextResponse.json(
    { ok: false, error: "Esta ação é decisão de gestão — o auditor lê e não decide." },
    { status: 403 },
  );
}
