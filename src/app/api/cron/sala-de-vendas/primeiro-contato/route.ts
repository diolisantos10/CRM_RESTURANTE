/**
 * O GATILHO DO PRIMEIRO CONTATO.
 *
 *   GET  → a fila: quem SERIA abordado agora, e por que os outros não. Leitura.
 *   POST → a rodada: aborda quem a fila liberou.
 *
 * ── AUTENTICAÇÃO, E POR QUE ELA É A DA PRÓPRIA ROTA ─────────────────────────
 *
 * `/api/cron/*` não exige sessão de lojista (o middleware deixa passar), porque
 * quem chama é máquina e máquina não tem cookie. O portão é o `CRON_SECRET`
 * daqui, **fail-closed**: sem segredo configurado a rota responde 503 a todo
 * mundo, e o segredo do admin não abre. Silêncio na configuração nunca é
 * permissão de entrar.
 *
 * ── ⚠️ `?simular=1` NO GET, E O QUE ELE NÃO FAZ ────────────────────────────
 *
 * Com `FOOCCI_SDR_SEND_ENABLED` desligada — o estado de hoje — o portão barra
 * TODO MUNDO com `CANAL_INDISPONIVEL`, e a fila deixa de responder a pergunta
 * que interessa antes da estreia: *"quem estaria liberado se a chave estivesse
 * ligada?"*. `?simular=1` faz a leitura fingir que o canal está pronto.
 *
 * Ele existe **só no GET**, que não escreve nada e não fala com ninguém. O POST
 * lê o estado real do canal, sempre — e não aceita este parâmetro. Uma
 * simulação que pudesse mandar mensagem seria a tela de conferência virando a
 * coisa mais perigosa do sistema, que é o erro que a prospecção já cometeu uma
 * vez e documentou no cabeçalho de `prospeccao/selecao.ts`.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canalDeVendasPronto, describeFoocciSalesChannel } from "@/services/foocci-sdr/FoocciSalesChannel";
import { modeloAprovado } from "@/services/foocci-sdr/ModeloAprovado";
import { configDoPrimeiroContato } from "@/services/salaDeVendas/primeiroContato/config";
import { montarFilaDePrimeiroContato } from "@/services/salaDeVendas/primeiroContato/fila";
import { rodarPrimeiroContato } from "@/services/salaDeVendas/primeiroContato/rodada";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Recusa = { status: 401 | 503; erro: string };

function conferirSegredo(req: NextRequest): Recusa | null {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || segredo.trim() === "") {
    return { status: 503, erro: "CRON_SECRET não está configurado — a porta fica fechada" };
  }
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${segredo}`) {
    return { status: 401, erro: "não autorizado" };
  }
  return null;
}

/** O estado das três chaves, sem segredo nenhum — só presença. */
function estadoDasChaves() {
  const canal = describeFoocciSalesChannel();
  const config = configDoPrimeiroContato();
  return {
    envioDoSdrLigado: canal.envioLigado,
    canalConfigurado: canal.configurado,
    primeiroContatoLigado: config.ligado,
    tetoDiario: config.tetoDiario,
    modeloDeAbertura: modeloAprovado("ABERTURA")?.nome ?? null,
    modeloDeLembrete: modeloAprovado("LEMBRETE")?.nome ?? null,
  };
}

export async function GET(req: NextRequest) {
  const recusa = conferirSegredo(req);
  if (recusa) return NextResponse.json({ ok: false, erro: recusa.erro }, { status: recusa.status });

  const simular = req.nextUrl.searchParams.get("simular") === "1";

  const fila = await montarFilaDePrimeiroContato(prisma, {
    canalPronto: simular ? true : canalDeVendasPronto(),
  });

  return NextResponse.json({
    ok: true,
    simulado: simular,
    chaves: estadoDasChaves(),
    fila,
  });
}

export async function POST(req: NextRequest) {
  const recusa = conferirSegredo(req);
  if (recusa) return NextResponse.json({ ok: false, erro: recusa.erro }, { status: recusa.status });

  const rodada = await rodarPrimeiroContato(prisma);

  return NextResponse.json({
    ok: true,
    chaves: estadoDasChaves(),
    abordados: rodada.abordados,
    recusados: rodada.recusados,
    barrados: rodada.barrados,
    motivoDaFilaVazia: rodada.fila.motivoDaFilaVazia,
    usadosHoje: rodada.fila.usadosHoje,
    tetoDoDia: rodada.fila.tetoDoDia,
    resultados: rodada.resultados,
    // Os barrados vão junto e com motivo: sem eles, uma rodada que não abordou
    // ninguém é indistinguível de uma rodada sem fila.
    naoAbordados: rodada.fila.barrados.map((c) => ({
      leadId: c.leadId,
      papel: c.papel,
      motivo: c.decisao.reason,
      detalhe: c.decisao.detail,
    })),
  });
}
