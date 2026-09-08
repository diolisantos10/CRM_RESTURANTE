/**
 * PROSPECÇÃO — a porta do lote, do interruptor e da fila do dia.
 *
 *   GET                          → fila do dia + estado do interruptor
 *   POST { acao: "importar" }    → carrega lista num lote RASCUNHO
 *   POST { acao: "liberar" }     → autoriza o lote (registra quem assinou)
 *   POST { acao: "pausarLote" }  → trava um lote
 *   POST { acao: "interruptor" } → liga/desliga/pausa a prospecção inteira
 *
 * ── QUEM PODE O QUÊ, E POR QUE NÃO É UM PAPEL SÓ ────────────────────────────
 *
 * Ler a fila é trabalho de SDR. **Liberar lote e mexer no interruptor não são.**
 * Autorizar a casa a falar com estranhos é decisão de quem responde pela marca,
 * e por isso essas duas ações exigem papel de gestão — mesmo que o SDR consiga
 * ver a tela inteira.
 *
 * ⚠️ Nenhuma ação daqui envia mensagem. A entrega continua atrás de
 * `FOOCCI_SDR_SEND_ENABLED`, que mora no ambiente e é do dono.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardarSalaDeVendas, somenteLeitura, vePelaOperacaoToda } from "../_guarda";
import { abordarItemDaFila, abordarARodadaDoDia } from "@/services/salaDeVendas/prospeccao/abordarDaFila";
import {
  conferirLista,
  importarLote,
  liberarLote,
  pausarLote,
  ListaGrandeDemais,
  ProvenienciaAusente,
  MAX_LINHAS_POR_IMPORTACAO,
  type LinhaDaLista,
} from "@/services/salaDeVendas/prospeccao/lote";
import { montarFilaDeProspeccao } from "@/services/salaDeVendas/prospeccao/selecao";
import { canalDeVendasPronto } from "@/services/foocci-sdr/FoocciSalesChannel";
import { preVooDoModelo } from "@/services/foocci-sdr/modelosDaMeta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inteiro não-negativo vindo de corpo de requisição, ou `null`.
 *
 * ⚠️ `typeof NaN === "number"` e `typeof Infinity === "number"`. Sem esta
 * função, `NaN <= 0` é `false` — a trava do teto zero seria CONTORNADA por um
 * campo em branco — e `Math.max(0, NaN)` é `NaN`, que vai para uma coluna
 * INTEGER e derruba a rota com 500. Um `2,5` digitado no campo tem o mesmo fim.
 */
function inteiroNaoNegativo(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.floor(v));
}

interface Corpo {
  acao?: "conferir" | "importar" | "abordar" | "rodada" | "liberar" | "pausarLote" | "interruptor";
  // abordar
  itemId?: string;
  // rodada — teto DESTA rodada, além do teto do dia
  teto?: number;
  // conferir / importar
  nome?: string;
  proveniencia?: string;
  linhas?: LinhaDaLista[];
  limiteDiario?: number;
  // liberar / pausarLote
  loteId?: string;
  // interruptor
  ligado?: boolean;
  pausar?: boolean;
  motivo?: string;
  horasEntreAbordagens?: number;
}

export async function GET(req: NextRequest) {
  const portao = await guardarSalaDeVendas(req, "ver_prospeccao");
  if (!portao.ok) return portao.resposta;

  const [fila, lotes, config] = await Promise.all([
    // Teto de leitura: sem ele, um teto diário alto faria cada abertura da tela
    // varrer a fila inteira, com uma consulta de lead por item. A tela mostra
    // uma página; o teto do dia continua sendo o do banco.
    montarFilaDeProspeccao(prisma, { canalPronto: canalDeVendasPronto(), limite: 50 }),
    prisma.loteDeProspeccao.findMany({
      orderBy: { criadoEm: "desc" },
      take: 20,
      include: { _count: { select: { itens: true } } },
    }),
    prisma.prospeccaoConfig.findUnique({ where: { id: "singleton" } }),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      fila,
      lotes,
      // Ausência de configuração é dita como está: desligada, teto zero. Não é
      // "sem limite", e a tela precisa poder mostrar a diferença.
      interruptor: config ?? {
        outboundLigado: false,
        limiteDiario: 0,
        horasEntreAbordagens: 72,
        pausadoEm: null,
        motivo: null,
      },
      canalPronto: canalDeVendasPronto(),
    },
  });
}

export async function POST(req: NextRequest) {
  const portao = await guardarSalaDeVendas(req, "mexer_na_prospeccao");
  if (!portao.ok) return portao.resposta;

  if (somenteLeitura(portao.sessao)) {
    return NextResponse.json({ ok: false, error: "Auditoria lê e não escreve." }, { status: 403 });
  }

  let c: Corpo;
  try {
    c = (await req.json()) as Corpo;
  } catch {
    return NextResponse.json({ ok: false, error: "Corpo inválido." }, { status: 400 });
  }

  const quem = `${portao.sessao.nome} (${portao.sessao.userId})`;

  // ── Conferir: só lê, e não grava nada ─────────────────────────────────────
  //
  // "Destes 500, quantos já temos?" — respondido ANTES de importar, porque
  // importar grava. Usa exatamente a mesma função que a importação usa depois,
  // e é por isso que os dois números não podem discordar.
  //
  // ⚠️ Não exige procedência: conferir não é abordar, e obrigar a escrever a
  // base legal para simplesmente contar duplicados faria o operador inventar
  // uma frase só para passar da tela — que é o oposto do que o campo existe
  // para conseguir.
  if (c.acao === "conferir") {
    if (!Array.isArray(c.linhas) || c.linhas.length === 0) {
      return NextResponse.json({ ok: false, error: "Lista vazia." }, { status: 400 });
    }
    if (c.linhas.length > MAX_LINHAS_POR_IMPORTACAO) {
      return NextResponse.json(
        { ok: false, error: new ListaGrandeDemais(c.linhas.length).message },
        { status: 400 },
      );
    }

    const r = await conferirLista(prisma, c.linhas);
    // O detalhe linha a linha não sai daqui: a tela precisa dos NÚMEROS, e
    // devolver a lista inteira de volta só engordaria a resposta.
    return NextResponse.json({
      ok: true,
      data: {
        recebidas: r.recebidas,
        novas: r.novas,
        jaEramLead: r.jaEramLead,
        repetidasEmOutroLote: r.repetidasEmOutroLote,
        repetidasNoArquivo: r.repetidasNoArquivo,
        invalidas: r.invalidas,
      },
    });
  }

  // ── Importar: conferência, não autorização ──
  if (c.acao === "importar") {
    if (!Array.isArray(c.linhas) || c.linhas.length === 0) {
      return NextResponse.json({ ok: false, error: "Lista vazia." }, { status: 400 });
    }
    try {
      const r = await importarLote(prisma, {
        nome: c.nome ?? "Lote sem nome",
        proveniencia: c.proveniencia ?? "",
        linhas: c.linhas,
        criadoPor: quem,
        limiteDiario: c.limiteDiario,
      });
      return NextResponse.json({ ok: true, data: r });
    } catch (e) {
      if (e instanceof ProvenienciaAusente || e instanceof ListaGrandeDemais) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
      }
      throw e;
    }
  }

  // ── Abordar UM item da fila ───────────────────────────────────────────────
  //
  // Um por chamada, como na rota de abordagem por lead: dez abordagens são dez
  // chamadas, e o freio de ritmo é lido de novo a cada uma. Aceitar uma lista
  // aqui faria o freio valer para o lote inteiro a partir de uma leitura só.
  if (c.acao === "abordar") {
    const itemId = c.itemId?.trim();
    if (!itemId) {
      return NextResponse.json({ ok: false, error: "itemId é obrigatório." }, { status: 400 });
    }

    const r = await abordarItemDaFila(prisma, {
      itemId,
      autor: "HUMANO",
      autorUserId: portao.sessao.userId,
    });

    if (r.abordou) {
      return NextResponse.json({ ok: true, data: { leadId: r.leadId, mensagemId: r.mensagemId } });
    }

    return NextResponse.json(
      { ok: false, error: fraseDaAbordagem(r.motivo, r.detalhe), motivo: r.motivo },
      { status: 409 },
    );
  }

  /**
   * A RODADA DO DIA — o laço que faltava.
   *
   * ⚠️ O comentário da ação `abordar`, logo acima, argumenta contra aceitar uma
   * lista: *"faria o freio valer para o lote inteiro a partir de uma leitura
   * só"*. **A objeção está certa, e esta ação não a viola:** a rodada chama
   * `abordarItemDaFila` uma vez por item, e ele relê `conferirRitmo` a cada
   * chamada. O freio continua sendo lido por abordagem, não por rodada.
   *
   * O que muda é só quem aperta o botão. Sem isto, os 250 do CEO são 250
   * cliques — medido em 08/09/2026: não existe cron de prospecção.
   *
   * Guardada como `liberar` e `interruptor`, e não como `abordar`: mandar a
   * casa falar com duzentos estranhos de uma vez é da mesma natureza que
   * autorizar a lista, não que tocar um contato.
   */
  if (c.acao === "rodada") {
    if (!vePelaOperacaoToda(portao.sessao)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Disparar a rodada é de quem responde pela marca — SDR conduz, não autoriza.",
        },
        { status: 403 },
      );
    }

    const teto = typeof c.teto === "number" && Number.isInteger(c.teto) && c.teto > 0
      ? c.teto
      : undefined;

    const r = await abordarARodadaDoDia(prisma, {
      autor: "HUMANO",
      autorUserId: portao.sessao.userId,
      canalPronto: canalDeVendasPronto(),
      preVoo: preVooDoModelo,
      ...(teto !== undefined ? { teto } : {}),
    });

    return NextResponse.json({ ok: true, data: r });
  }

  // ── As duas ações que autorizam a casa a falar com estranhos ──
  if (c.acao === "liberar" || c.acao === "interruptor") {
    if (!vePelaOperacaoToda(portao.sessao)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Autorizar prospecção é de quem responde pela marca — SDR conduz, não autoriza.",
        },
        { status: 403 },
      );
    }
  }

  if (c.acao === "liberar") {
    if (!c.loteId) {
      return NextResponse.json({ ok: false, error: "loteId é obrigatório." }, { status: 400 });
    }
    const r = await liberarLote(prisma, c.loteId, quem, portao.sessao.userId);
    return NextResponse.json(r.ok ? { ok: true } : { ok: false, error: r.motivo }, {
      status: r.ok ? 200 : 400,
    });
  }

  if (c.acao === "pausarLote") {
    if (!c.loteId) {
      return NextResponse.json({ ok: false, error: "loteId é obrigatório." }, { status: 400 });
    }
    const r = await pausarLote(prisma, c.loteId, quem);
    return NextResponse.json(r.ok ? { ok: true } : { ok: false, error: r.motivo }, {
      status: r.ok ? 200 : 404,
    });
  }

  if (c.acao === "interruptor") {
    const agora = new Date();
    const pausando = c.pausar === true;

    // ── LIGAR COM TETO ZERO É LIGAR NADA ──
    //
    // O padrão do campo é 0, e uma prospecção "ligada" com teto 0 devolve fila
    // vazia para sempre. O dono clicaria em Ligar, veria "Teto do dia atingido
    // (0/0)" e concluiria que o produto está quebrado — quando na verdade ele
    // obedeceu. Recusar aqui é mais honesto que aceitar e não fazer nada.
    if (!pausando && c.ligado === true) {
      const tetoInformado = inteiroNaoNegativo(c.limiteDiario);
      const tetoAtual =
        tetoInformado ??
        ((await prisma.prospeccaoConfig.findUnique({ where: { id: "singleton" } }))
          ?.limiteDiario ?? 0);

      if (tetoAtual <= 0) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Informe quantas abordagens por dia antes de ligar. Ligar com teto zero não aborda ninguém.",
          },
          { status: 400 },
        );
      }
    }

    const dados = {
      outboundLigado: pausando ? false : Boolean(c.ligado),
      pausadoEm: pausando ? agora : null,
      pausadoPor: pausando ? quem : null,
      // Só mexe no motivo quando ele vem: ligar sem informar motivo estava
      // apagando a explicação da pausa anterior, que é justamente o texto que
      // alguém vai procurar depois para entender por que a casa parou.
      ...(typeof c.motivo === "string" ? { motivo: c.motivo } : pausando ? { motivo: null } : {}),
      atualizadoPor: quem,
      ...(inteiroNaoNegativo(c.limiteDiario) !== null
        ? { limiteDiario: inteiroNaoNegativo(c.limiteDiario)! }
        : {}),
      ...(inteiroNaoNegativo(c.horasEntreAbordagens) !== null
        ? { horasEntreAbordagens: inteiroNaoNegativo(c.horasEntreAbordagens)! }
        : {}),
    };

    const config = await prisma.prospeccaoConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...dados },
      update: dados,
    });

    return NextResponse.json({ ok: true, data: config });
  }

  return NextResponse.json({ ok: false, error: "Ação desconhecida." }, { status: 400 });
}

/**
 * O motivo em frase de gente, para a tela da fila.
 *
 * `ritmo` não é erro e a frase não pode soar como um: quem está abordando
 * precisa entender que o sistema segurou de propósito, e que insistir é
 * justamente o que não se deve fazer.
 */
function fraseDaAbordagem(motivo: string, detalhe: string): string {
  switch (motivo) {
    case "ritmo":
      return `O freio de ritmo segurou — ${detalhe}. É proteção do número, não falha: tente mais tarde.`;
    case "naoVirouLead":
      return `Este contato não entrou na carteira: ${detalhe}`;
    case "portaoRecusou":
      return `Não pode ser abordado: ${detalhe}`;
    case "naoConseguiuGravar":
      return "Não consegui registrar a mensagem, então nada foi enviado.";
    case "aMetaRecusou":
      return `Registrei a mensagem, mas o WhatsApp recusou: ${detalhe}`;
    default:
      return `Não foi possível abordar: ${detalhe}`;
  }
}
