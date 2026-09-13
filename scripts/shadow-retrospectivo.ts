/**
 * SHADOW RETROSPECTIVO — a Academia calibrando sobre atendimento QUE JÁ
 * ACONTECEU, não esperando cliente novo escrever.
 *
 *   npx tsx scripts/shadow-retrospectivo.ts
 *
 * ── O QUE ISTO É, E O QUE ISTO NUNCA FAZ ─────────────────────────────────────
 *
 * Busca `LeadMensagem` de SAÍDA já enviadas há muito tempo (mais o turno de
 * ENTRADA anterior, para dar contexto), roda `avaliarCamadaRapida`/
 * `avaliarCamadaProfunda` (as MESMAS funções reais de produção) sobre elas, e
 * grava o veredito numa tabela pequena e nova (`AcademiaRevisaoRetrospectiva`)
 * — só para CONSULTA, nunca para ação.
 *
 * ⛔ ESTRITAMENTE LEITURA sobre tudo que já aconteceu:
 *   - NUNCA chama `revisarAntesDeEntregar`/`revisarDeFato`/`aplicarDecisao` —
 *     só as funções de JULGAMENTO puro (`avaliarCamadaRapida`/`avaliarCamadaProfunda`).
 *   - NUNCA escreve em `LeadMensagem.texto` (a mensagem já foi enviada há
 *     muito tempo — reescrevê-la agora não faz sentido nenhum).
 *   - NUNCA cria `SupervisoraAvaliacao` (aquela tabela é o veredito que valeu
 *     NO MOMENTO do envio; isto aqui é o veredito de HOJE, olhando pra trás —
 *     ver o comentário grande em `AcademiaRevisaoRetrospectiva`, no schema).
 *   - NUNCA chama `entregarMensagem`/`enviarTextoDeVendas`/nada que toque
 *     WhatsApp — este import nem existe neste arquivo, de propósito.
 *
 * ── ⚠️ HONESTIDADE OBRIGATÓRIA SOBRE O DADO ─────────────────────────────────
 *
 * Este script roda contra QUALQUER Postgres apontado por `DATABASE_URL` — ele
 * não sabe, e não tem como saber, se está rodando contra produção real ou
 * contra um ambiente de teste. Quem roda é responsável por essa honestidade:
 * a saída sempre imprime o `leadId`/quantidade de mensagens tocadas, nunca
 * "sucesso" genérico, para que qualquer leitor consiga JULGAR se aquilo é
 * dado real ou sintético pelo próprio conteúdo. Nesta obra (missão da Academia
 * Comercial), rodou-se contra o dado SINTÉTICO local das jornadas desta sessão
 * — para provar o MECANISMO (paginação, leitura, gravação), não para calibrar
 * de verdade. Calibração real depende de alguém com acesso ao Postgres de
 * produção rodar este MESMO script lá.
 *
 * ── PAGINAÇÃO OBRIGATÓRIA — NUNCA "A BASE INTEIRA" ──────────────────────────
 *
 * `tamanhoDoLote` tem um teto rígido (`TAMANHO_MAXIMO_DO_LOTE`). Uma chamada
 * sempre processa NO MÁXIMO um lote, devolve `proximoCursor`, e quem chama
 * decide se continua. O `main()` de linha de comando processa só UM lote por
 * execução, de propósito — rodar "a base inteira" é uma decisão explícita de
 * quem opera (chamar de novo com o cursor), nunca o comportamento padrão.
 */

import { PrismaClient, type Prisma, type VeredictoDaSupervisora, type CamadaDaSupervisora } from "@prisma/client";
import { avaliarCamadaRapida, type ResultadoDaCamada } from "../src/services/salaDeVendas/supervisora/camadaRapida";
import { avaliarCamadaProfunda, deveAcionar } from "../src/services/salaDeVendas/supervisora/camadaProfunda";
import { contarReprovacoesRecentes } from "../src/services/salaDeVendas/supervisora/desempenho";
import { montarContextoDaRevisao } from "../src/services/salaDeVendas/supervisora/contexto";

type Cliente = PrismaClient | Prisma.TransactionClient;

/** Nunca mais que isto num único lote, mesmo se pedirem mais — proteção
 *  contra "rodar a base inteira sem querer". */
export const TAMANHO_MAXIMO_DO_LOTE = 500;
export const TAMANHO_PADRAO_DO_LOTE = 100;

/** Janela para "reprovado recentemente" — mesma janela de `revisao.ts`. */
const JANELA_DE_REPETICAO_MS = 24 * 60 * 60 * 1000;

export interface ParametrosDoShadowRetrospectivo {
  /** Início do recorte de tempo (inclusive) — obrigatório: nunca "desde sempre". */
  desde: Date;
  /** Fim do recorte de tempo (exclusive). Padrão: agora. */
  ate?: Date;
  /** Máximo de mensagens processadas NESTA chamada. Padrão `TAMANHO_PADRAO_DO_LOTE`,
   *  nunca acima de `TAMANHO_MAXIMO_DO_LOTE`. */
  tamanhoDoLote?: number;
  /** `mensagemId` da última mensagem processada numa chamada anterior, para
   *  continuar a paginação de onde parou. */
  cursor?: string | null;
  /** Rótulo desta execução, gravado em cada linha — só para auditoria de qual
   *  rodada gerou o quê. */
  loteId?: string | null;
}

export interface ResultadoDoShadowRetrospectivo {
  /** Quantas mensagens de fato passaram por avaliação nesta chamada. */
  processadas: number;
  /** Mensagens no recorte que já tinham revisão retrospectiva — não
   *  reprocessadas (idempotência: rodar o mesmo lote de novo não duplica). */
  jaRevisadasNoRecorte: number;
  falhasTecnicas: number;
  porVeredito: Record<VeredictoDaSupervisora, number>;
  porCamada: Record<CamadaDaSupervisora, number>;
  /** `mensagemId` da última mensagem desta página — passe como `cursor` na
   *  próxima chamada para continuar. `null` quando não há mais nada a paginar
   *  dentro do recorte `desde`/`ate`. */
  proximoCursor: string | null;
  temMais: boolean;
}

/**
 * Os últimos N turnos ATÉ (e incluindo) um instante de referência — variante
 * de `contexto.ts::ultimosTurnos` que NÃO olha o futuro da conversa em
 * relação à mensagem sendo revisada. Isto importa só aqui: uma revisão
 * retrospectiva de uma mensagem de 2 semanas atrás não deveria enxergar
 * turnos que só aconteceram depois — vazaria contexto que o agente, na época,
 * não tinha.
 */
async function turnosAte(
  db: Cliente,
  leadId: string,
  referencia: Date,
  take = 12,
): Promise<Array<{ deQuem: "cliente" | "ta"; texto: string }>> {
  const msgs = await db.leadMensagem.findMany({
    where: { leadId, texto: { not: null }, ocorreuEm: { lte: referencia } },
    orderBy: { ocorreuEm: "desc" },
    take,
    select: { direcao: true, texto: true },
  });

  return msgs
    .reverse()
    .map((m) => ({
      deQuem: m.direcao === "ENTRADA" ? ("cliente" as const) : ("ta" as const),
      texto: m.texto ?? "",
    }))
    .filter((t) => t.texto.trim().length > 0);
}

/**
 * O CORAÇÃO DO SCRIPT — exportado à parte de `main()` para o teste de jornada
 * poder chamar diretamente contra a mesma conexão/transação de banco, no
 * mesmo padrão de `semearAcademiaComercial`.
 */
export async function rodarShadowRetrospectivo(
  db: Cliente,
  params: ParametrosDoShadowRetrospectivo,
): Promise<ResultadoDoShadowRetrospectivo> {
  const ate = params.ate ?? new Date();
  const tamanhoDoLote = Math.min(
    Math.max(1, params.tamanhoDoLote ?? TAMANHO_PADRAO_DO_LOTE),
    TAMANHO_MAXIMO_DO_LOTE,
  );

  if (params.desde >= ate) {
    throw new Error("`desde` precisa ser anterior a `ate` — recorte de tempo vazio ou invertido");
  }

  // ⛔ Só SAÍDA (o que a Foocci mandou), com texto, dentro do recorte, e SEM
  // revisão retrospectiva ainda — filtrado no WHERE, nunca buscado inteiro e
  // filtrado em JS (mesma doutrina de `academia.ts`).
  //
  // ⚠️ O CURSOR NÃO USA `cursor`/`skip` DO PRISMA, DE PROPÓSITO — MEDIDO: a
  // âncora de uma página (a última mensagem da página anterior) já tem
  // `revisaoRetrospectiva` preenchida quando a próxima página é buscada (foi
  // ela mesma quem gravou). O recurso `cursor` do Prisma busca a posição da
  // âncora DENTRO do conjunto já filtrado por `where` — como a âncora não
  // satisfaz mais `revisaoRetrospectiva: { is: null }`, o Prisma não a
  // encontra no conjunto filtrado e a paginação pula registros (medido: uma
  // mensagem no meio da janela sumia, sem erro nenhum). A tupla
  // `(ocorreuEm, id) > (ocorreuEm da âncora, id da âncora)`, expressa como
  // `where` explícito, não tem esse problema — não depende de a âncora ainda
  // satisfazer o filtro de "não revisada".
  let comparacaoDoCursor: Prisma.LeadMensagemWhereInput | undefined;
  if (params.cursor) {
    const ancora = await db.leadMensagem.findUnique({
      where: { id: params.cursor },
      select: { ocorreuEm: true },
    });
    if (ancora) {
      comparacaoDoCursor = {
        OR: [
          { ocorreuEm: { gt: ancora.ocorreuEm } },
          { ocorreuEm: ancora.ocorreuEm, id: { gt: params.cursor } },
        ],
      };
    }
    // Âncora não encontrada (id inválido/apagada): segue sem restrição de
    // cursor — mais seguro reprocessar um pedaço do que pular a janela
    // inteira em silêncio.
  }

  const where: Prisma.LeadMensagemWhereInput = {
    direcao: "SAIDA",
    texto: { not: null },
    ocorreuEm: { gte: params.desde, lt: ate },
    revisaoRetrospectiva: { is: null },
    ...(comparacaoDoCursor ?? {}),
  };

  // Busca uma mensagem A MAIS que o lote pedido só para saber se há mais
  // depois desta página — nunca para processá-la.
  const pagina = await db.leadMensagem.findMany({
    where,
    orderBy: [{ ocorreuEm: "asc" }, { id: "asc" }],
    take: tamanhoDoLote + 1,
    select: {
      id: true,
      leadId: true,
      texto: true,
      ocorreuEm: true,
      autorUserId: true,
      papelDoAgente: true,
    },
  });

  const temMais = pagina.length > tamanhoDoLote;
  const mensagens = temMais ? pagina.slice(0, tamanhoDoLote) : pagina;

  // Quantas do recorte TOTAL já tinham revisão — só para o relatório dar uma
  // ideia de quanto do período já foi coberto por rodadas anteriores.
  const jaRevisadasNoRecorte = await db.leadMensagem.count({
    where: {
      direcao: "SAIDA",
      texto: { not: null },
      ocorreuEm: { gte: params.desde, lt: ate },
      revisaoRetrospectiva: { isNot: null },
    },
  });

  const porVeredito: Record<VeredictoDaSupervisora, number> = { VERDE: 0, AMARELO: 0, VERMELHO: 0, CRITICO: 0 };
  const porCamada: Record<CamadaDaSupervisora, number> = { RAPIDA: 0, PROFUNDA: 0 };
  let falhasTecnicas = 0;

  for (const msg of mensagens) {
    // `montarContextoDaRevisao` é 100% leitura (memória, config do TA,
    // conhecimento da Academia, últimos alertas) — o mesmo contexto que a
    // Supervisora usaria se estivesse revisando esta mensagem hoje.
    const ctx = await montarContextoDaRevisao(db, { leadId: msg.leadId, mensagemAvaliadaId: msg.id });

    const rapida: ResultadoDaCamada = await avaliarCamadaRapida(ctx, msg.texto ?? "");

    const reprovacoesRecentes = await contarReprovacoesRecentes(db, {
      autorUserId: msg.autorUserId,
      papelDoAgente: msg.autorUserId ? null : msg.papelDoAgente,
      desde: new Date(msg.ocorreuEm.getTime() - JANELA_DE_REPETICAO_MS),
      excluirMensagemId: msg.id,
    });

    const decisao = deveAcionar({
      veredictoDaCamadaRapida: rapida.falhaTecnica ? null : rapida.veredito,
      irritacaoDoLead: ctx.irritacaoDoLead,
      pediuParar: ctx.pediuParar,
      reprovacoesRecentesDoAgente: reprovacoesRecentes,
    });

    let final: ResultadoDaCamada = rapida;
    let camada: CamadaDaSupervisora = "RAPIDA";

    if (decisao.aciona || (rapida.falhaTecnica && (ctx.irritacaoDoLead >= 2 || ctx.pediuParar))) {
      const turnos = await turnosAte(db, msg.leadId, msg.ocorreuEm).catch(() => []);
      const profunda = await avaliarCamadaProfunda(
        ctx,
        msg.texto ?? "",
        turnos,
        decisao.motivo ?? "falha técnica da camada rápida com sinal de risco presente (retrospectivo)",
      );
      if (!profunda.falhaTecnica || rapida.falhaTecnica) {
        final = profunda;
        camada = "PROFUNDA";
      }
    }

    if (final.falhaTecnica) falhasTecnicas += 1;
    porVeredito[final.veredito] += 1;
    porCamada[camada] += 1;

    // Grava a revisão — nunca toca `LeadMensagem` nem `SupervisoraAvaliacao`.
    // `.catch` local: um erro de gravação (ex.: corrida rara com outra rodada
    // tocando a mesma mensagem) vira log, não interrompe o lote inteiro —
    // mesma régua de `revisao.ts::aplicarDecisao`.
    await db.academiaRevisaoRetrospectiva
      .create({
        data: {
          mensagemId: msg.id,
          leadId: msg.leadId,
          ocorreuEmOriginal: msg.ocorreuEm,
          camada,
          veredito: final.veredito,
          motivos: final.motivos,
          motivoDetalhe: final.detalhe,
          falhaTecnica: final.falhaTecnica,
          engineProvider: final.engineProvider,
          engineModel: final.engineModel,
          loteId: params.loteId ?? null,
        },
      })
      .catch((e) => {
        console.error("[shadow-retrospectivo] não consegui gravar a revisão retrospectiva", {
          mensagemId: msg.id,
          erro: e instanceof Error ? e.message : String(e),
        });
      });
  }

  return {
    processadas: mensagens.length,
    jaRevisadasNoRecorte,
    falhasTecnicas,
    porVeredito,
    porCamada,
    proximoCursor: temMais ? mensagens[mensagens.length - 1].id : null,
    temMais,
  };
}

function p(t = "") {
  console.log(t);
}

async function main() {
  const desdeStr = process.env.SHADOW_RETRO_DESDE;
  if (!desdeStr) {
    console.error(
      "❌ SHADOW_RETRO_DESDE é obrigatório (ISO 8601, ex.: 2026-09-01T00:00:00Z) — " +
        "nunca 'a base inteira' sem recorte de tempo explícito.",
    );
    process.exitCode = 1;
    return;
  }
  const desde = new Date(desdeStr);
  const ate = process.env.SHADOW_RETRO_ATE ? new Date(process.env.SHADOW_RETRO_ATE) : new Date();
  const tamanhoDoLote = process.env.SHADOW_RETRO_LOTE ? Number(process.env.SHADOW_RETRO_LOTE) : TAMANHO_PADRAO_DO_LOTE;
  const cursor = process.env.SHADOW_RETRO_CURSOR || null;
  const loteId = process.env.SHADOW_RETRO_LOTE_ID || `manual-${new Date().toISOString()}`;

  p("═══════════════════════════════════════════════════════════");
  p("SHADOW RETROSPECTIVO — calibração sobre atendimento já enviado");
  p("═══════════════════════════════════════════════════════════");
  p(
    "⚠️ Este script roda contra o Postgres de QUALQUER ambiente apontado por " +
      "DATABASE_URL. Ele não sabe se isto é produção ou um ambiente de teste — " +
      "quem roda é responsável por essa distinção. Modo estritamente leitura sobre " +
      "o que já foi enviado: nunca reescreve, nunca bloqueia, nunca envia mensagem.",
  );
  p(`recorte: ${desde.toISOString()} até ${ate.toISOString()}`);
  p(`tamanho do lote: ${Math.min(tamanhoDoLote, TAMANHO_MAXIMO_DO_LOTE)} (teto rígido: ${TAMANHO_MAXIMO_DO_LOTE})`);
  p(`loteId: ${loteId}`);
  if (cursor) p(`continuando a partir do cursor: ${cursor}`);
  p("");

  const prisma = new PrismaClient();
  try {
    const r = await rodarShadowRetrospectivo(prisma, { desde, ate, tamanhoDoLote, cursor, loteId });

    p("── RESULTADO DESTE LOTE ─────────────────────────────────────");
    p(`mensagens processadas nesta chamada: ${r.processadas}`);
    p(`já tinham revisão no recorte (não reprocessadas): ${r.jaRevisadasNoRecorte}`);
    p(`falhas técnicas: ${r.falhasTecnicas}`);
    p(`por veredito: ${JSON.stringify(r.porVeredito)}`);
    p(`por camada: ${JSON.stringify(r.porCamada)}`);
    if (r.temMais) {
      p("");
      p(`⚠️ Há mais mensagens no recorte além deste lote. Para continuar, rode de novo com:`);
      p(`   SHADOW_RETRO_CURSOR=${r.proximoCursor}`);
    } else {
      p("");
      p("✓ recorte inteiro coberto — sem mais mensagens pendentes neste intervalo.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("❌", e instanceof Error ? (e.stack ?? e.message) : e);
    process.exitCode = 1;
  });
}
