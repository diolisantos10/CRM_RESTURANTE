/**
 * GET /api/admin/sala-de-vendas/agentes
 *
 * As nove fichas comerciais, com o desempenho real de cada uma.
 *
 * ── QUEM VÊ ─────────────────────────────────────────────────────────────────
 *
 * Todo mundo da Sala, inclusive o SDR. As fichas descrevem o que cada função
 * PODE e NÃO PODE — e o SDR precisa ler a dele para saber onde ele para e onde
 * o Closer começa. Esconder isso dele transformaria a alçada em folclore.
 *
 * O que ele NÃO vê é o desempenho individual dos colegas — e não vê porque a
 * ficha é um cargo, não uma pessoa: o número é sempre agregado.
 *
 * ── E, DESDE 10/09/2026, A MATRIZ DE VERDADE ────────────────────────────────
 *
 * A resposta leva junto quantas dessas nove fichas têm código atrás. Vai no
 * MESMO payload de propósito: numa segunda rota, a tela poderia desenhar os nove
 * cartões antes de a verdade chegar — e o instante em que ela mostra nove
 * agentes sem contradição é o instante que produz o mal-entendido.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardarSalaDeVendas } from "../_guarda";
import {
  agentesComerciais,
  resumir,
  fichasComerciais,
} from "@/services/salaDeVendas/agentesComerciais";
import {
  matrizDeVerdade,
  contarAVerdade,
  lerRuntimeDaMatriz,
  NADA_MEDIDO,
} from "@/services/salaDeVendas/matrizDeVerdade";
import { comSessao } from "@/services/salaDeVendas/identidadeNoBanco";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const portao = await guardarSalaDeVendas(req, "ler_agentes_comerciais");
  if (!portao.ok) return portao.resposta;

  const agora = new Date();
  const p = req.nextUrl.searchParams;
  const de = p.get("de") ? new Date(p.get("de")!) : new Date(agora.getTime() - 30 * 86_400_000);
  const ate = p.get("ate") ? new Date(p.get("ate")!) : agora;

  if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime()) || de >= ate) {
    return NextResponse.json({ ok: false, error: "Período inválido." }, { status: 400 });
  }

  try {
    // O desempenho vem de mensagens, handoffs e avaliações — todas sob RLS.
    const agentes = await comSessao(prisma, portao.sessao, (tx) =>
      agentesComerciais(tx as never, { de, ate }),
    );

    // A leitura do runtime é lida FORA do `comSessao` porque `SdrIaConfig` é
    // configuração da casa, não dado de lead — não há linha de RLS para ela.
    //
    // E ela falha sozinha: uma leitura de estado que não voltou não pode derrubar
    // as fichas, que são o conteúdo principal da tela. Sem ela, a matriz sai
    // inteira com "não medido", que é uma resposta honesta.
    let leitura = NADA_MEDIDO;
    try {
      leitura = await lerRuntimeDaMatriz(prisma);
    } catch (e) {
      console.error("[sala-de-vendas/agentes] estado do runtime não medido:", e);
    }

    const matriz = matrizDeVerdade(fichasComerciais(), leitura);

    return NextResponse.json({
      ok: true,
      data: {
        agentes,
        resumo: resumir(agentes),
        matriz,
        verdade: contarAVerdade(matriz),
        periodo: { de, ate },
      },
    });
  } catch (e) {
    // O catálogo é lido do disco. Se o arquivo sumir, a resposta diz ISSO — e
    // não uma lista vazia, que a tela mostraria como "nenhum agente existe".
    console.error("[sala-de-vendas/agentes] falhou:", e);
    return NextResponse.json(
      {
        ok: false,
        error:
          "Não foi possível ler o catálogo de agentes. O documento " +
          "02-DEPARTAMENTOS-E-AGENTES.md é a fonte, e ele não pôde ser lido.",
      },
      { status: 500 },
    );
  }
}
