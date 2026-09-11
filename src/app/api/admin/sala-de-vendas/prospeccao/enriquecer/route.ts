/**
 * ENRIQUECER — preencher campos vazios de items existentes com dados de planilha.
 *
 *   POST application/json
 *     - linhas: LinhaLida[]  (já lidas e mapeadas pela tela — ver o porquê abaixo)
 *     - nomeArquivo: string
 *
 * Não cria item novo, não toca em campo já preenchido, não reabre lote
 * encerrado, e não envia mensagem nenhuma. Só preenche o vazio.
 *
 * ── POR QUE O CORPO É JSON JÁ LIDO, E NÃO O ARQUIVO CRU ─────────────────────
 *
 * `lerPlanilha` só entende texto (CSV/TSV). XLSX é um zip binário — mandar
 * `arquivo.text()` para dentro dele produz lixo, não linhas. A tela de
 * importação (`ReceberLista.tsx`) já resolveu isso: converte Excel para CSV NO
 * NAVEGADOR com a biblioteca `xlsx` antes de mandar qualquer coisa ao servidor.
 * Esta rota segue a mesma régua — o navegador lê e mapeia (inclusive o
 * mapeamento manual escolhido na tela), o servidor só confere e aplica. Um
 * leitor de planilha só, não dois divergindo.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardarSalaDeVendas } from "../../_guarda";
import type { LinhaLida } from "@/services/salaDeVendas/prospeccao/lerPlanilha";
import { enriquecerPlanilhaDeItems } from "@/services/salaDeVendas/prospeccao/enriquecerPlanilha";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Teto de sanidade — aqui não se cria lote (não é o limite de 500/lote da
 *  importação), só se atualiza item existente, mas corpo sem limite nenhum é
 *  uma requisição gigante esperando para travar o processo. */
const MAX_LINHAS_POR_ENRIQUECIMENTO = 20_000;

function pareceLinhaLida(v: unknown): v is LinhaLida {
  if (typeof v !== "object" || v === null) return false;
  const l = v as Record<string, unknown>;
  return typeof l.whatsapp === "string";
}

interface Corpo {
  linhas?: unknown;
  nomeArquivo?: unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const portao = await guardarSalaDeVendas(req, "enriquecer_prospeccao");
  if (!portao.ok) return portao.resposta;

  let corpo: Corpo;
  try {
    corpo = (await req.json()) as Corpo;
  } catch {
    return NextResponse.json({ ok: false, error: "Corpo inválido — esperado JSON." }, { status: 400 });
  }

  if (!Array.isArray(corpo.linhas) || corpo.linhas.length === 0) {
    return NextResponse.json({ ok: false, error: "Nenhuma linha para processar." }, { status: 400 });
  }

  if (corpo.linhas.length > MAX_LINHAS_POR_ENRIQUECIMENTO) {
    return NextResponse.json(
      {
        ok: false,
        error: `${corpo.linhas.length} linhas excede o teto de ${MAX_LINHAS_POR_ENRIQUECIMENTO} por rodada.`,
      },
      { status: 400 },
    );
  }

  if (!corpo.linhas.every(pareceLinhaLida)) {
    return NextResponse.json(
      { ok: false, error: "Linha em formato inválido — falta 'whatsapp' em string." },
      { status: 400 },
    );
  }

  const nomeArquivo =
    typeof corpo.nomeArquivo === "string" && corpo.nomeArquivo.trim()
      ? corpo.nomeArquivo.trim()
      : "arquivo sem nome";
  const dataEnriquecimento = new Date();

  let resultado;
  try {
    resultado = await enriquecerPlanilhaDeItems(prisma, corpo.linhas as LinhaLida[], {
      nomeArquivo,
      usuario: portao.sessao.nome,
      dataEnriquecimento,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro desconhecido";
    return NextResponse.json(
      { ok: false, error: "Erro ao processar enriquecimento.", detalhe: msg },
      { status: 500 },
    );
  }

  // ── AUDITORIA — arquivo, usuário, data, contagem ────────────────────────
  //
  // Sem isto, enriquecer é invisível depois: ninguém sabe quem preencheu o quê
  // nem quando. Falha ao gravar a trilha NÃO desfaz o enriquecimento — os dados
  // já mudaram no banco — mas fica no log do servidor: "enriqueci e não
  // consegui contar" é pior que "não enriqueci" quando alguém precisar
  // reconstituir depois quem fez o quê.
  try {
    await prisma.internalAuditEvent.create({
      data: {
        actorType: "INTERNAL_USER",
        actorId: portao.sessao.userId,
        actorLabel: `${portao.sessao.nome} (${portao.sessao.userId})`,
        acao: "enriquecer_prospeccao",
        recurso: "sala-de-vendas:prospeccao",
        resultado: "PERMITIDO",
        detalhe: {
          arquivoNome: nomeArquivo,
          dataEnriquecimento: dataEnriquecimento.toISOString(),
          linhasProcessadas: resultado.linhasProcessadas,
          itemsEncontrados: resultado.itemsEncontrados,
          itemsEnriquecidos: resultado.itemsEnriquecidos,
          camposAtualizados: resultado.camposAtualizados,
          naoEncontrados: resultado.naoEncontrados,
          naoAlterados: resultado.naoAlterados,
          totalErros: resultado.erros.length,
        },
      },
    });
  } catch (e) {
    console.error("[enriquecer] falha ao gravar auditoria:", e);
  }

  return NextResponse.json({ ok: true, data: resultado });
}
