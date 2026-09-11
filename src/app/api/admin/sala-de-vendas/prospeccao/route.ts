/**
 * PROSPECÇÃO — a porta da importação, do interruptor e da fila do dia.
 *
 *   GET  ?recorte=fila           → fila do dia + interruptor + resumo da Base fria
 *   GET  ?recorte=importacoes    → histórico de arquivos (paginado)
 *   GET  ?recorte=importacao     → os contatos de UMA importação (paginado)
 *   GET  ?recorte=base           → a base contínua, com busca e filtros
 *   POST { acao: "abrirImportacao" }   → declara o arquivo antes das partes
 *   POST { acao: "importar" }          → carrega uma parte, já elegível
 *   POST { acao: "concluirImportacao" }→ fecha o arquivo
 *   POST { acao: "cancelarImportacao"} → desfaz: marca o arquivo cancelado (histórico), sem apagar
 *   POST { acao: "rodada" }      → dispara a rodada automática do dia
 *   POST { acao: "interruptor" } → liga/desliga/pausa a prospecção inteira
 *
 * ── ⛔ A OPERAÇÃO POR LOTES FOI REMOVIDA EM 11/09/2026 ───────────────────────
 *
 * Não existe mais "liberar lista" nem "pausar lote" nesta rota — as ações
 * `liberar` e `pausarLote` foram apagadas, não só escondidas. Ordem explícita:
 * *"nenhuma importação pode depender de liberação manual"* e *"lote não pode
 * aparecer como etapa operacional nem impedir envio."* Todo contato válido
 * importado entra direto na Base fria contínua e fica elegível na hora —
 * `montarFilaDeProspeccao` (`selecao.ts`) só olha `situacao: "PENDENTE"` do
 * item, nunca mais a situação do lote.
 *
 * `LoteDeProspeccao` continua existindo no banco só para rastrear arquivo,
 * procedência, responsável e data — histórico, visível na aba Importações —
 * e não decide mais quem é abordado.
 *
 * ── QUEM PODE O QUÊ, E POR QUE NÃO É UM PAPEL SÓ ────────────────────────────
 *
 * Ler a fila é trabalho de SDR. **Autorizar a casa a falar com estranhos não é.**
 * Essa decisão responde por danos que o SDR não tem como avaliar — número
 * restringido, denúncia, marca queimada — e por isso exige papel de gestão,
 * mesmo que o SDR veja a tela inteira. Subir um arquivo é o que autoriza hoje
 * (ver `lote.ts`), e por isso `importar`/`abrirImportacao` exigem o mesmo papel
 * de quem dispara a rodada.
 *
 * ⚠️ Nenhuma ação daqui envia mensagem por conta própria. A entrega continua
 * atrás de `FOOCCI_SDR_SEND_ENABLED`, que mora no ambiente e é do dono.
 */

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { guardarSalaDeVendas, somenteLeitura, vePelaOperacaoToda } from "../_guarda";
import { abordarItemDaFila, abordarARodadaDoDia } from "@/services/salaDeVendas/prospeccao/abordarDaFila";
import {
  conferirLista,
  importarLote,
  ListaGrandeDemais,
  ProvenienciaAusente,
  MAX_LINHAS_POR_IMPORTACAO,
  type LinhaDaLista,
} from "@/services/salaDeVendas/prospeccao/lote";
import {
  abrirImportacao,
  arquivoJaImportado,
  cancelarImportacao,
  concluirImportacao,
  falharImportacao,
  somarParteNaImportacao,
} from "@/services/salaDeVendas/prospeccao/importacao";
import { montarFilaDeProspeccao } from "@/services/salaDeVendas/prospeccao/selecao";
import { canalDeVendasPronto } from "@/services/foocci-sdr/FoocciSalesChannel";
import { preVooDoModelo } from "@/services/foocci-sdr/modelosDaMeta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A PÁGINA, e por que ela tem teto próprio.
 *
 * Sem `porPagina` máximo, `?porPagina=999999` seria uma varredura da base
 * inteira servida a qualquer sessão da Sala — e a base é o ativo. O teto não é
 * desconfiança de quem opera: é o que impede uma URL de virar exportação.
 */
const POR_PAGINA_PADRAO = 50;
const POR_PAGINA_MAX = 200;

function paginacao(params: URLSearchParams): { pagina: number; porPagina: number; pular: number } {
  const bruta = Number(params.get("pagina"));
  const pagina = Number.isFinite(bruta) && bruta >= 1 ? Math.floor(bruta) : 1;

  const brutaPorPagina = Number(params.get("porPagina"));
  const porPagina =
    Number.isFinite(brutaPorPagina) && brutaPorPagina >= 1
      ? Math.min(POR_PAGINA_MAX, Math.floor(brutaPorPagina))
      : POR_PAGINA_PADRAO;

  return { pagina, porPagina, pular: (pagina - 1) * porPagina };
}

/** Texto de filtro que veio da URL. Vazio é ausência, não filtro por "". */
function filtro(params: URLSearchParams, chave: string): string | null {
  const v = params.get(chave)?.trim();
  return v ? v : null;
}

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

type Acao =
  | "conferir"
  | "abrirImportacao"
  | "importar"
  | "concluirImportacao"
  | "cancelarImportacao"
  | "abordar"
  | "rodada"
  | "interruptor";

interface Corpo {
  acao?: Acao;
  // abordar
  itemId?: string;
  // rodada — teto DESTA rodada, além do teto do dia
  teto?: number;
  // conferir / importar
  nome?: string;
  proveniencia?: string;
  linhas?: LinhaDaLista[];
  limiteDiario?: number;
  // importação (o arquivo inteiro)
  importacaoId?: string;
  arquivoNome?: string;
  arquivoTipo?: string;
  arquivoHash?: string;
  arquivoBytes?: number;
  linhasTotais?: number;
  canalDeObtencao?: string;
  /** "Sei que esta planilha já subiu, quero subir de novo." */
  confirmarRepetido?: boolean;
  // interruptor
  ligado?: boolean;
  pausar?: boolean;
  motivo?: string;
  horasEntreAbordagens?: number;
}

/**
 * ⭐ AS AÇÕES QUE AUTORIZAM A CASA A FALAR COM ESTRANHOS.
 *
 * Todas exigem `vePelaOperacaoToda`. A lista está aqui, em um lugar só, porque
 * ela cresceu — e cresceu por um motivo que vale registrar: desde que o lote
 * nasce LIBERADO, **subir um arquivo é autorizar**. Se `importar` e
 * `abrirImportacao` tivessem ficado na guarda de baixo, o SDR passaria a
 * autorizar pela porta da importação exatamente aquilo que hoje exige quem
 * responde pela marca — e ninguém veria, porque o 403 continuaria aparecendo
 * no lugar de sempre.
 *
 * `cancelarImportacao` entra pelo lado oposto: parar a lista dos outros também é
 * decisão de quem responde pela operação. `rodada` guardada aqui, e não como
 * `abordar`, pelo mesmo motivo de sempre: mandar a casa falar com duzentos
 * estranhos de uma vez é da mesma natureza que autorizar a lista.
 */
const ACOES_QUE_AUTORIZAM = new Set<Acao>([
  "abrirImportacao",
  "importar",
  "concluirImportacao",
  "cancelarImportacao",
  "rodada",
  "interruptor",
]);

export async function GET(req: NextRequest) {
  const portao = await guardarSalaDeVendas(req, "ver_prospeccao");
  if (!portao.ok) return portao.resposta;

  const params = req.nextUrl.searchParams;
  const recorte = params.get("recorte") ?? "fila";

  if (recorte === "importacoes") return listarImportacoes(params);
  if (recorte === "importacao") return listarContatosDaImportacao(params);
  if (recorte === "base") return listarBaseFria(params);

  const [fila, config, totalNaBase, pendentesNaBase] = await Promise.all([
    // Teto de leitura: sem ele, um teto diário alto faria cada abertura da tela
    // varrer a fila inteira, com uma consulta de lead por item. A tela mostra
    // uma página; o teto do dia continua sendo o do banco.
    montarFilaDeProspeccao(prisma, { canalPronto: canalDeVendasPronto(), limite: 50 }),
    prisma.prospeccaoConfig.findUnique({ where: { id: "singleton" } }),
    prisma.itemDeProspeccao.count(),
    // ⚠️ Só `situacao: "PENDENTE"` — desde 11/09/2026 a situação do lote não
    // exclui mais ninguém daqui (ver o cabeçalho deste arquivo).
    prisma.itemDeProspeccao.count({ where: { situacao: "PENDENTE" } }),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      fila,
      // O RESUMO da Base fria — não a lista. A lista de verdade, com busca e
      // detalhe expansível por contato, é `?recorte=base`.
      base: { total: totalNaBase, pendentes: pendentesNaBase },
      // Ausência de configuração é dita como está: desligada, teto zero. Não é
      // "sem limite", e a tela precisa poder mostrar a diferença.
      interruptor: config ?? {
        outboundLigado: false,
        limiteDiario: 0,
        horasEntreAbordagens: 72,
        pausadoEm: null,
        motivo: null,
        ultimaRodadaAutomaticaEm: null,
        ultimaRodadaAutomaticaPor: null,
      },
      canalPronto: canalDeVendasPronto(),
    },
  });
}

/** O histórico de arquivos: um arquivo por linha, e não dezesseis lotes. */
async function listarImportacoes(params: URLSearchParams) {
  const { pagina, porPagina, pular } = paginacao(params);

  const [linhas, total] = await Promise.all([
    prisma.importacaoDeLeads.findMany({
      orderBy: { iniciadaEm: "desc" },
      skip: pular,
      take: porPagina,
      include: {
        // Quantos lotes o arquivo virou, e quantos deles ainda estão de pé. É o
        // que traduz "16 partes" de volta para "uma lista".
        lotes: { select: { id: true, situacao: true, _count: { select: { itens: true } } } },
      },
    }),
    prisma.importacaoDeLeads.count(),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      linhas: linhas.map((i) => ({
        ...i,
        lotes: undefined,
        totalDeLotes: i.lotes.length,
        lotesPausados: i.lotes.filter((l) => l.situacao === "PAUSADO").length,
        itensNaBase: i.lotes.reduce((n, l) => n + l._count.itens, 0),
      })),
      total,
      pagina,
      porPagina,
    },
  });
}

/**
 * Os contatos de UMA importação.
 *
 * Existe porque "aceitos: 5.200" é um número, e número não se confere. Quem
 * desconfia do relatório precisa poder abrir a lista e olhar os nomes — é a
 * diferença entre um registro auditável e um placar.
 */
async function listarContatosDaImportacao(params: URLSearchParams) {
  const importacaoId = filtro(params, "importacaoId");
  if (!importacaoId) {
    return NextResponse.json({ ok: false, error: "importacaoId é obrigatório." }, { status: 400 });
  }

  const { pagina, porPagina, pular } = paginacao(params);
  const situacao = filtro(params, "situacao");

  const where: Prisma.ItemDeProspeccaoWhereInput = {
    lote: { importacaoId },
    ...(situacao ? { situacao: situacao as Prisma.EnumSituacaoDoItemFilter["equals"] } : {}),
  };

  const [importacao, linhas, total] = await Promise.all([
    prisma.importacaoDeLeads.findUnique({ where: { id: importacaoId } }),
    prisma.itemDeProspeccao.findMany({
      where,
      orderBy: { criadoEm: "asc" },
      skip: pular,
      take: porPagina,
      include: { lote: { select: { id: true, nome: true, situacao: true } } },
    }),
    prisma.itemDeProspeccao.count({ where }),
  ]);

  if (!importacao) {
    return NextResponse.json({ ok: false, error: "Importação não encontrada." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    data: { importacao, linhas, total, pagina, porPagina },
  });
}

/**
 * ⭐ A BASE CONTÍNUA — o estoque unificado, e não "os lotes".
 *
 * ── POR QUE ESTA LISTA EXISTE ───────────────────────────────────────────────
 *
 * Porque a pergunta que ninguém conseguia responder era simples: *"quantos
 * contatos nós temos, e quem são?"*. A resposta morava espalhada em dezesseis
 * lotes por arquivo, cada um com um contador, e a única tela que existia
 * mostrava vinte deles. Estoque que não se enxerga inteiro não se administra.
 *
 * ⚠️ `tentativas` e `última tentativa` vêm do lead, e não do item: o item é a
 * ficha de entrada, o lead é quem tem histórico. Item sem lead ainda não foi
 * abordado — e o zero ali é verdade, não buraco.
 */
async function listarBaseFria(params: URLSearchParams) {
  const { pagina, porPagina, pular } = paginacao(params);

  const busca = filtro(params, "busca");
  const de = filtro(params, "de");
  const ate = filtro(params, "ate");

  const soDigitos = busca ? busca.replace(/\D/g, "") : "";

  const entrada: Prisma.DateTimeFilter = {};
  if (de && !Number.isNaN(Date.parse(de))) entrada.gte = new Date(de);
  // O fim do dia, e não a meia-noite: filtrar "até 10/09" com `lte` na
  // meia-noite esconderia tudo o que entrou naquele dia — o dia que a pessoa
  // acabou de digitar porque é o que ela quer ver.
  if (ate && !Number.isNaN(Date.parse(ate))) entrada.lte = new Date(`${ate}T23:59:59.999Z`);

  const situacao = filtro(params, "situacao");
  const cidade = filtro(params, "cidade");
  const estado = filtro(params, "estado");
  const tipo = filtro(params, "tipo");
  const importacaoId = filtro(params, "importacaoId");
  const responsavel = filtro(params, "responsavel");
  const situacaoDoLote = filtro(params, "situacaoDoLote");

  const where: Prisma.ItemDeProspeccaoWhereInput = {
    ...(situacao ? { situacao: situacao as Prisma.EnumSituacaoDoItemFilter["equals"] } : {}),
    ...(cidade ? { cidade: { contains: cidade, mode: "insensitive" } } : {}),
    ...(estado ? { estado: { equals: estado, mode: "insensitive" } } : {}),
    ...(tipo ? { tipo: { contains: tipo, mode: "insensitive" } } : {}),
    ...(Object.keys(entrada).length ? { criadoEm: entrada } : {}),
    ...(importacaoId || responsavel || situacaoDoLote
      ? {
          lote: {
            ...(importacaoId ? { importacaoId } : {}),
            // Responsável é o id de VERDADE de quem assinou a liberação — e não
            // o rótulo de tela. Filtrar por rótulo pegaria homônimo e perderia
            // quem trocou de nome.
            ...(responsavel ? { liberadoPorUserId: responsavel } : {}),
            ...(situacaoDoLote
              ? { situacao: situacaoDoLote as Prisma.EnumSituacaoDoLoteFilter["equals"] }
              : {}),
          },
        }
      : {}),
    ...(busca
      ? {
          OR: [
            { nome: { contains: busca, mode: "insensitive" } },
            { empresa: { contains: busca, mode: "insensitive" } },
            // Só dígitos: quem procura "(11) 98765-4321" digita de um jeito e o
            // banco guarda de outro. Sem isto, buscar por telefone nunca acha.
            ...(soDigitos.length >= 4 ? [{ whatsappDigits: { contains: soDigitos } }] : []),
          ],
        }
      : {}),
  };

  const [linhas, total] = await Promise.all([
    prisma.itemDeProspeccao.findMany({
      where,
      orderBy: { criadoEm: "desc" },
      skip: pular,
      take: porPagina,
      include: {
        lote: {
          select: {
            id: true,
            nome: true,
            situacao: true,
            proveniencia: true,
            liberadoPor: true,
            importacao: { select: { id: true, arquivoNome: true, canalDeObtencao: true } },
          },
        },
      },
    }),
    prisma.itemDeProspeccao.count({ where }),
  ]);

  // ── O HISTÓRICO DA PÁGINA, EM DUAS CONSULTAS E NÃO EM CINQUENTA ──
  //
  // Uma consulta de lead por linha renderizada é o laço que derruba a tela
  // quando a base cresce. Os ids da página vão juntos, de uma vez.
  const leadIds = [...new Set(linhas.map((l) => l.leadId).filter((v): v is string => !!v))];

  const [leads, saidas] = await Promise.all([
    leadIds.length
      ? prisma.siteLead.findMany({
          where: { id: { in: leadIds } },
          select: { id: true, optOutAt: true, lastContactedAt: true },
        })
      : Promise.resolve([]),
    leadIds.length
      ? prisma.leadMensagem.groupBy({
          by: ["leadId"],
          where: { leadId: { in: leadIds }, direcao: "SAIDA" },
          _count: { _all: true },
          _max: { ocorreuEm: true },
        })
      : Promise.resolve([] as Array<{ leadId: string; _count: { _all: number }; _max: { ocorreuEm: Date | null } }>),
  ]);

  const porLead = new Map(leads.map((l) => [l.id, l]));
  const porTentativas = new Map(saidas.map((s) => [s.leadId, s]));

  return NextResponse.json({
    ok: true,
    data: {
      linhas: linhas.map((item) => {
        const lead = item.leadId ? porLead.get(item.leadId) : undefined;
        const saida = item.leadId ? porTentativas.get(item.leadId) : undefined;

        return {
          id: item.id,
          // ── Colunas principais (a tela mostra estas por padrão) ──────────
          nome: item.nome,
          whatsapp: item.whatsapp,
          empresa: item.empresa,
          cidade: item.cidade,
          estado: item.estado,
          tipo: item.tipo,
          situacao: item.situacao,
          entrouEm: item.criadoEm,
          leadId: item.leadId,

          // ── ⭐ AMPLIAÇÃO DA BASE FRIA, 11/09/2026 — detalhe expansível ────
          // Não são colunas da tabela: a ficha do contato as mostra quando o
          // operador expande a linha. Ver regra 8 da entrega.
          cargo: item.cargo,
          telefoneSecundario: item.telefoneSecundario,
          email: item.email,
          bairro: item.bairro,
          endereco: item.endereco,
          cep: item.cep,
          cnpj: item.cnpj,
          instagram: item.instagram,
          site: item.site,
          googleMapsUrl: item.googleMapsUrl,
          numeroDeUnidades: item.numeroDeUnidades,
          canaisAtuais: item.canaisAtuais,
          observacoes: item.observacoes,
          tags: item.tags,

          // ── Rastro do arquivo — histórico, não etapa operacional ─────────
          // `loteId`/`proveniencia`/`responsavel` continuam existindo só para
          // responder "de onde veio, e quem assinou" (regra 7 da entrega); a
          // situação do lote NÃO decide mais quem é abordado.
          loteId: item.loteId,
          proveniencia: item.lote.proveniencia,
          responsavel: item.lote.liberadoPor,
          importacaoId: item.lote.importacao?.id ?? null,
          arquivo: item.lote.importacao?.arquivoNome ?? item.lote.nome,
          canalDeObtencao: item.lote.importacao?.canalDeObtencao ?? null,
          tentativas: saida?._count._all ?? 0,
          ultimaTentativa: saida?._max.ocorreuEm ?? lead?.lastContactedAt ?? null,
          // O motivo de bloqueio em UMA frase. Só o silêncio pedido e o motivo
          // gravado na entrada (telefone repetido, já era lead…) — lote
          // pausado deixou de bloquear em 11/09/2026, então deixou de entrar
          // aqui: dizer "Lote pausado" quando o pausado não impede mais nada
          // seria a tela mentindo sobre o que o sistema faz.
          motivoDeBloqueio: lead?.optOutAt ? "Pediu silêncio" : item.motivo,
        };
      }),
      total,
      pagina,
      porPagina,
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

  // ── A GUARDA DE AUTORIZAÇÃO, ANTES DE QUALQUER ESCRITA ────────────────────
  //
  // Aqui em cima, e não dentro de cada ramo: um 403 devolvido depois de a lista
  // já ter entrado seria mensagem de erro por cima de fato consumado.
  if (c.acao && ACOES_QUE_AUTORIZAM.has(c.acao) && !vePelaOperacaoToda(portao.sessao)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Autorizar prospecção é de quem responde pela marca — SDR conduz, não autoriza. " +
          "Subir lista passou a liberar a lista, então subir também é autorizar.",
      },
      { status: 403 },
    );
  }

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

  // ── Abrir a importação: o arquivo é declarado ANTES de qualquer parte ─────
  //
  // Devolve, junto do id, a importação anterior com o mesmo conteúdo — se
  // houver. A tela precisa poder dizer "esta planilha já subiu em tal data"
  // enquanto ainda dá para desistir.
  if (c.acao === "abrirImportacao") {
    const proveniencia = c.proveniencia?.trim() ?? "";
    if (proveniencia === "") {
      // A mesma recusa de `importarLote`, adiantada: descobrir que falta a
      // procedência depois de subir 8.000 linhas é descobrir tarde demais.
      return NextResponse.json(
        { ok: false, error: new ProvenienciaAusente().message },
        { status: 400 },
      );
    }

    // ── ⚠️ A PLANILHA REPETIDA É BARRADA AQUI, E NÃO AVISADA DEPOIS ─────────
    //
    // Prompt é aviso; código é trava. Um aviso mostrado depois da abertura
    // chegaria com o arquivo já subindo, e a única saída seria cancelar uma
    // importação recém-criada — deixando registro de cancelamento para um erro
    // que nem chegou a acontecer. Aqui nada é criado: quem quiser subir de novo
    // (e às vezes se quer mesmo, com a lista atualizada) reenvia com
    // `confirmarRepetido`, e essa insistência é uma decisão consciente.
    const anterior = await arquivoJaImportado(prisma, c.arquivoHash);
    if (anterior && c.confirmarRepetido !== true) {
      return NextResponse.json(
        {
          ok: false,
          error:
            `Esta mesma planilha já subiu em ` +
            `${anterior.iniciadaEm.toLocaleDateString("pt-BR")} como "${anterior.arquivoNome}"` +
            `${anterior.criadoPorNome ? `, por ${anterior.criadoPorNome}` : ""}.`,
          data: { anterior },
        },
        { status: 409 },
      );
    }

    const importacaoId = await abrirImportacao(prisma, {
      arquivoNome: c.arquivoNome ?? "arquivo sem nome",
      arquivoTipo: c.arquivoTipo,
      arquivoHash: c.arquivoHash,
      arquivoBytes: c.arquivoBytes,
      linhasTotais: c.linhasTotais,
      proveniencia,
      canalDeObtencao: c.canalDeObtencao,
      criadoPor: quem,
      // ⚠️ Da SESSÃO, nunca do corpo. Aceitar `criadoPorUserId` de fora deixaria
      // qualquer um assinar a autorização com o nome de outra pessoa — e é essa
      // assinatura que a rodada automática usa como responsável de cada mensagem.
      criadoPorUserId: portao.sessao.userId,
      criadoPorNome: portao.sessao.nome,
    });

    return NextResponse.json({ ok: true, data: { importacaoId, anterior } });
  }

  // ── Importar UMA parte. O lote entra LIBERADO e assinado ──
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
        criadoPorUserId: portao.sessao.userId,
        importacaoId: c.importacaoId,
        limiteDiario: c.limiteDiario,
      });

      // O registro do arquivo acompanha a parte que acabou de entrar. Somar aqui,
      // e não no fim, é o que faz a tela mostrar progresso verdadeiro numa lista
      // de 8.000 — e o que deixa números certos mesmo se a parte 9 derrubar.
      if (c.importacaoId) await somarParteNaImportacao(prisma, c.importacaoId, r);

      return NextResponse.json({ ok: true, data: r });
    } catch (e) {
      // ── A IMPORTAÇÃO QUE MORREU NO MEIO DIZ QUE MORREU ──
      //
      // Sem isto, a parte 9 derrubando deixaria o registro em PROCESSANDO para
      // sempre — e "processando" há três dias é o estado que faz alguém esperar
      // por algo que não vai acontecer. As partes que já entraram continuam
      // valendo: são contatos reais, com procedência e assinatura.
      //
      // ⚠️ O que este ramo NÃO alcança é a falha de rede, em que o pedido nunca
      // chega. Aí o registro fica mesmo PROCESSANDO, e é a tela de importações
      // que mostra isso — a alternativa seria o servidor adivinhar silêncio.
      if (c.importacaoId) {
        await falharImportacao(
          prisma,
          c.importacaoId,
          e instanceof Error ? e.message : String(e),
        ).catch(() => {
          // Registro de falha que falha não pode esconder a falha original.
        });
      }
      if (e instanceof ProvenienciaAusente || e instanceof ListaGrandeDemais) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
      }
      throw e;
    }
  }

  if (c.acao === "concluirImportacao") {
    if (!c.importacaoId) {
      return NextResponse.json({ ok: false, error: "importacaoId é obrigatório." }, { status: 400 });
    }
    const r = await concluirImportacao(prisma, c.importacaoId);
    return NextResponse.json(r.ok ? { ok: true } : { ok: false, error: r.motivo }, {
      status: r.ok ? 200 : 409,
    });
  }

  // ── Cancelar: pausa os lotes daquele arquivo, e não apaga nada ──
  if (c.acao === "cancelarImportacao") {
    if (!c.importacaoId) {
      return NextResponse.json({ ok: false, error: "importacaoId é obrigatório." }, { status: 400 });
    }
    const r = await cancelarImportacao(prisma, c.importacaoId, {
      quem,
      quemUserId: portao.sessao.userId,
      motivo: c.motivo,
    });
    return NextResponse.json(
      r.ok ? { ok: true, data: { lotesPausados: r.lotesPausados } } : { ok: false, error: r.motivo },
      { status: r.ok ? 200 : 409 },
    );
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
   * A RODADA DO DIA — o laço que faltava, e desde 11/09/2026 o ÚNICO jeito de
   * abordar em volume — não existe mais "liberar lote por lote".
   *
   * ⚠️ O comentário da ação `abordar`, logo acima, argumenta contra aceitar uma
   * lista: *"faria o freio valer para o lote inteiro a partir de uma leitura
   * só"*. **A objeção está certa, e esta ação não a viola:** a rodada chama
   * `abordarItemDaFila` uma vez por item, e ele relê `conferirRitmo` a cada
   * chamada. O freio continua sendo lido por abordagem, não por rodada.
   *
   * A guarda de autorização está em `ACOES_QUE_AUTORIZAM`, lá em cima, junto
   * com as outras — mandar a casa falar com duzentos estranhos de uma vez é da
   * mesma natureza que autorizar a lista, não que tocar um contato.
   */
  if (c.acao === "rodada") {
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
