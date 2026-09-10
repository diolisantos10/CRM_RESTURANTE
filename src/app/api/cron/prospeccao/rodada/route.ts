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
import {
  abordarARodadaDoDia,
  type ResultadoDaRodada,
} from "@/services/salaDeVendas/prospeccao/abordarDaFila";
import { canalDeVendasPronto } from "@/services/foocci-sdr/FoocciSalesChannel";
import { preVooDoModelo } from "@/services/foocci-sdr/modelosDaMeta";
import { reservarRodadaAutomaticaDoDia } from "@/services/salaDeVendas/prospeccao/agendador";

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

/**
 * Quantos itens saíram por cada motivo — a evidência que o número sozinho não dá.
 *
 * `ok` é o envio que aconteceu; o resto é o motivo da fila, sem tradução. Traduzir
 * aqui faria o log dizer uma explicação que o serviço não deu.
 */
function contarMotivos(extrato: ResultadoDaRodada["extrato"]): Record<string, number> {
  const conta: Record<string, number> = {};
  for (const linha of extrato) {
    const chave = linha.ok ? "ok" : linha.motivo ?? "(sem motivo)";
    conta[chave] = (conta[chave] ?? 0) + 1;
  }
  return conta;
}

/**
 * ⭐ UM CASO CONCRETO POR MOTIVO — e não a lista inteira.
 *
 * ── POR QUE ISTO EXISTE, e é a MESMA lição duas vezes ───────────────────────
 *
 * `porMotivo` sozinho devolveu `portaoRecusou: 10` na rodada de 08/09/2026.
 * Verdadeiro, e inútil: o portão do lead tem **sete regras** (silêncio pedido,
 * telefone, canal, histórico, consentimento, teto de tentativas, descanso,
 * horário) e a linha não dizia qual delas barrou. Foi o guardrail 6 quase
 * cumprido — que é o mesmo que não cumprido.
 *
 * Um exemplo por motivo, e não todos, porque numa rodada de 250 os detalhes
 * repetem: o que muda a investigação é **qual regra**, não quantas vezes a
 * mesma frase apareceu. A contagem já está em `porMotivo`.
 */
function exemploDeCadaMotivo(extrato: ResultadoDaRodada["extrato"]): Record<string, string> {
  const exemplos: Record<string, string> = {};
  for (const linha of extrato) {
    if (linha.ok || !linha.motivo || !linha.detalhe) continue;
    if (exemplos[linha.motivo] === undefined) exemplos[linha.motivo] = linha.detalhe;
  }
  return exemplos;
}

export async function POST(req: NextRequest) {
  const guarda = conferirCron(req);
  if (!guarda.ok) {
    return NextResponse.json({ ok: false, error: guarda.erro }, { status: guarda.status });
  }

  const corpo = (await req.json().catch(() => ({}))) as { teto?: unknown; automatica?: unknown };
  const teto =
    typeof corpo.teto === "number" && Number.isInteger(corpo.teto) && corpo.teto > 0
      ? corpo.teto
      : undefined;

  // ── A RODADA AUTOMÁTICA RESERVA O DIA — a manual, não ─────────────────────
  //
  // Desde 10/09/2026 existem dois agendadores para a rodada das 9h: o interno
  // (`AgendadorDaProspeccao`) e este cron do GitHub, que ficou como reserva
  // porque atrasou 3h43 num dia e não disparou no outro. Quando o GitHub acorda
  // atrasado e o interno já rodou, esta linha é o que impede o dia de mandar o
  // dobro. `automatica: true` vem do evento `schedule` do workflow; disparo à
  // mão (`workflow_dispatch`) não reserva — o teto do dia já é o freio dele.
  if (corpo.automatica === true) {
    const reserva = await reservarRodadaAutomaticaDoDia(prisma, new Date(), "cron do GitHub");
    if (!reserva.reservou) {
      console.info(`[cron/prospeccao/rodada] rodada automática NÃO rodou — ${reserva.detalhe}`);
      return NextResponse.json({
        ok: true,
        data: {
          abordados: 0,
          pulados: 0,
          parouPor: reserva.motivo,
          falha: null,
          extrato: [],
          detalhe: reserva.detalhe,
        },
      });
    }
  }

  const r = await abordarARodadaDoDia(prisma, {
    autor: "SISTEMA",
    canalPronto: canalDeVendasPronto(),
    preVoo: preVooDoModelo,
    ...(teto !== undefined ? { teto } : {}),
  });

  // ⚠️ O resultado vai para o log SEMPRE, e não só quando dá errado. Uma rodada
  // que manda zero e uma que não rodou são indistinguíveis para quem olha de
  // fora — e é essa confusão que faz uma lista queimar sem ninguém perceber.
  //
  // ⭐ E vai COM OS MOTIVOS. Em 08/09/2026 a primeira rodada real devolveu
  // `abordados: 0, pulados: 10, parouPor: filaAcabou` — e essa linha, sozinha,
  // não diz **nada** sobre o que aconteceu com os dez. É o guardrail 6 quebrado
  // no meu próprio código: *"alerta que diz 'algo falhou' sem o caso concreto é
  // ruído que ninguém investiga"*. O extrato já trazia a resposta; o log a
  // jogava fora.
  console.info("[cron/prospeccao/rodada] rodada concluída", {
    abordados: r.abordados,
    pulados: r.pulados,
    parouPor: r.parouPor,
    falha: r.falha,
    porMotivo: contarMotivos(r.extrato),
    exemploPorMotivo: exemploDeCadaMotivo(r.extrato),
  });

  return NextResponse.json({ ok: true, data: r });
}
