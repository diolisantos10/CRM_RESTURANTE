/**
 * /api/admin/sala-de-vendas/supervisora/sugestoes
 *
 *   GET  → as sugestões de prompt (nível 2), mais recentes primeiro.
 *   POST → { acao: "aprovar" | "rejeitar", sugestaoId, ... }
 *
 * ── "APROVAR" NA TELA É DUAS ESCRITAS NO SERVIÇO, UMA SÓ NA TELA ────────────
 *
 * `sugestoes.ts` (nível 2/3) exige de propósito que a sugestão já esteja
 * `APROVADA` antes de `aprovarSugestaoECriarVersao` aceitar criar a versão —
 * "aprovar é ato humano, separado" (ver o comentário lá). Do ponto de vista de
 * quem clica, as duas coisas são UM gesto: aprovar ESTA sugestão vira ESTA
 * versão. Por isso a rota faz as duas em sequência: marca `APROVADA` (só se
 * ainda estiver `PENDENTE` — idempotente para um retry depois de uma falha de
 * evidência) e então chama `aprovarSugestaoECriarVersao`. Nenhuma lógica nova:
 * as duas funções já existiam, só a ORDEM de chamada é desta rota.
 *
 * Rejeitar é `rejeitarSugestao`, direto — nada a compor.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardarPainelDaSupervisora, exigirPodeDecidir } from "../_guardaDoPainel";
import {
  rejeitarSugestao,
  aprovarSugestaoECriarVersao,
  type PatchDaVersao,
} from "@/services/salaDeVendas/supervisora/sugestoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const portao = await guardarPainelDaSupervisora(req, "ler_sugestoes_da_supervisora");
  if (!portao.ok) return portao.resposta;

  const linhas = await prisma.supervisoraSugestaoDePrompt.findMany({
    orderBy: { criadaEm: "desc" },
    take: 100,
  });

  return NextResponse.json({
    ok: true,
    data: {
      pendentes: linhas.filter((s) => s.situacao === "PENDENTE"),
      historico: linhas.filter((s) => s.situacao !== "PENDENTE"),
    },
  });
}

interface Corpo {
  acao?: unknown;
  sugestaoId?: unknown;
  nota?: unknown;
  patch?: unknown;
  erroGrave?: unknown;
  testeCorrespondente?: unknown;
}

function lerPatch(v: unknown): PatchDaVersao {
  const p = (v ?? {}) as Record<string, unknown>;
  return {
    identidade: typeof p.identidade === "string" && p.identidade.trim() ? p.identidade : undefined,
    tomDeVoz: typeof p.tomDeVoz === "string" && p.tomDeVoz.trim() ? p.tomDeVoz : undefined,
    objetivos: typeof p.objetivos === "string" && p.objetivos.trim() ? p.objetivos : undefined,
    perguntas: Array.isArray(p.perguntas) ? p.perguntas.filter((x): x is string => typeof x === "string") : undefined,
    proibidos: Array.isArray(p.proibidos) ? p.proibidos.filter((x): x is string => typeof x === "string") : undefined,
  };
}

export async function POST(req: NextRequest) {
  const portao = await guardarPainelDaSupervisora(req, "decidir_sugestao_da_supervisora");
  if (!portao.ok) return portao.resposta;

  const recusa = exigirPodeDecidir(portao.sessao);
  if (recusa) return recusa;

  const corpo = (await req.json().catch(() => ({}))) as Corpo;
  const sugestaoId = typeof corpo.sugestaoId === "string" ? corpo.sugestaoId : "";
  const acao = typeof corpo.acao === "string" ? corpo.acao : "";
  const nota = typeof corpo.nota === "string" ? corpo.nota : null;

  if (!sugestaoId) {
    return NextResponse.json({ ok: false, error: "sugestaoId obrigatório" }, { status: 400 });
  }

  if (acao === "rejeitar") {
    const r = await rejeitarSugestao(prisma, { sugestaoId, revisorId: portao.sessao.userId, nota });
    if (r.ok) return NextResponse.json({ ok: true, data: { sugestaoId } });
    return NextResponse.json(
      { ok: false, error: r.causa === "naoExiste" ? "sugestão não existe" : "sugestão já foi decidida" },
      { status: r.causa === "naoExiste" ? 404 : 409 },
    );
  }

  if (acao === "aprovar") {
    const agora = new Date();

    const atual = await prisma.supervisoraSugestaoDePrompt.findUnique({ where: { id: sugestaoId } });
    if (!atual) return NextResponse.json({ ok: false, error: "sugestão não existe" }, { status: 404 });

    if (atual.situacao === "REJEITADA" || atual.situacao === "APLICADA") {
      return NextResponse.json(
        { ok: false, error: `sugestão já foi decidida (${atual.situacao.toLowerCase()})` },
        { status: 409 },
      );
    }

    if (atual.situacao === "PENDENTE") {
      const marcada = await prisma.supervisoraSugestaoDePrompt.updateMany({
        where: { id: sugestaoId, situacao: "PENDENTE" },
        data: { situacao: "APROVADA", revisadaPorId: portao.sessao.userId, revisadaEm: agora, notaDaRevisao: nota },
      });
      // Perder a corrida aqui (outra pessoa aprovou/rejeitou no meio) não é
      // erro de programa — `aprovarSugestaoECriarVersao` abaixo relê o estado
      // e recusa direito se não estiver mais `APROVADA`.
      if (marcada.count !== 1) {
        const relida = await prisma.supervisoraSugestaoDePrompt.findUnique({ where: { id: sugestaoId } });
        if (relida?.situacao !== "APROVADA") {
          return NextResponse.json(
            { ok: false, error: "outra pessoa decidiu esta sugestão antes" },
            { status: 409 },
          );
        }
      }
    }

    const r = await aprovarSugestaoECriarVersao(prisma, {
      sugestaoId,
      patch: lerPatch(corpo.patch),
      criadaPorId: portao.sessao.userId,
      testeCorrespondente: typeof corpo.testeCorrespondente === "string" ? corpo.testeCorrespondente : null,
      erroGrave: corpo.erroGrave === true,
      agora,
    });

    if ("ok" in r && r.ok) {
      return NextResponse.json({ ok: true, data: r });
    }

    const causa = (r as { causa: string }).causa;
    const mensagens: Record<string, string> = {
      sugestaoNaoExiste: "sugestão não existe",
      sugestaoNaoAprovada: "a sugestão precisa estar aprovada antes de virar versão",
      semConfigDoTA: "a ficha do TA ainda não existe — publique a versão inicial primeiro",
      evidenciaInsuficiente:
        "menos de duas evidências: marque 'erro grave' explicitamente para criar a versão mesmo assim, ou junte mais evidência",
    };
    return NextResponse.json(
      { ok: false, error: mensagens[causa] ?? causa, causa },
      { status: causa === "evidenciaInsuficiente" ? 422 : 400 },
    );
  }

  return NextResponse.json({ ok: false, error: "acao inválida — use 'aprovar' ou 'rejeitar'" }, { status: 400 });
}
