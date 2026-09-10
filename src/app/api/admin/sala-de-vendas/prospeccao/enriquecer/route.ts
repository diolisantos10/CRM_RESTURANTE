/**
 * ENRIQUECER — preencher campos vazios de items existentes com dados de planilha.
 *
 *   POST multipart/form-data
 *     - arquivo: File (CSV/XLSX)
 *     - (opcionalmente) mapeamento de colunas via URL params
 *
 * Valida credenciais, recebe arquivo, analisa estrutura, e preenche campos
 * vazios dos items já existentes. NÃO cria duplicata, NÃO toca em já abordados.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardarSalaDeVendas } from "../../_guarda";
import { lerPlanilha, type LeituraDaPlanilha } from "@/services/salaDeVendas/prospeccao/lerPlanilha";
import { enriquecerPlanilhaDeItems } from "@/services/salaDeVendas/prospeccao/enriquecerPlanilha";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Valida credenciais, recebe arquivo, analisa, e enriquece items.
 *
 * Resposta:
 * - 200 com resumo de enriquecimento
 * - 400 arquivo ou estrutura inválida
 * - 403 sem permissão
 * - 500 erro do servidor
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Verificar credenciais
  const portao = await guardarSalaDeVendas(req, "escrever");
  if (!portao.ok) {
    return portao.resposta;
  }

  try {
    // Receber o FormData
    const form = await req.formData();
    const arquivo = form.get("arquivo");

    if (!arquivo || !(arquivo instanceof File)) {
      return NextResponse.json(
        { erro: "arquivo obrigatório e deve ser File" },
        { status: 400 },
      );
    }

    // Ler o arquivo como texto
    const texto = await arquivo.text();

    // Analisar a planilha (detecta colunas e estrutura)
    let leitura: LeituraDaPlanilha;
    try {
      leitura = lerPlanilha(texto);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "erro ao analisar arquivo";
      return NextResponse.json(
        { erro: "arquivo não é CSV/TSV válido", detalhe: msg },
        { status: 400 },
      );
    }

    // Validar que encontrou linhas
    if (leitura.linhas.length === 0) {
      return NextResponse.json(
        { erro: "arquivo vazio ou sem linhas válidas" },
        { status: 400 },
      );
    }

    // Enriquecer a planilha
    const resultado = await enriquecerPlanilhaDeItems(
      prisma,
      leitura.linhas,
      {
        nomeArquivo: arquivo.name,
        usuario: portao.sessao.nome,
        dataEnriquecimento: new Date(),
      },
    );

    // Devolver o resultado
    return NextResponse.json({
      sucesso: true,
      resultado,
      colunas: leitura.colunas,
      parametros: {
        separador: leitura.separador,
        temCabecalho: leitura.temCabecalho,
        descartadasSemTelefone: leitura.descartadas,
      },
    });
  } catch (e) {
    console.error("[enriquecer] erro:", e);
    const msg = e instanceof Error ? e.message : "erro desconhecido";
    return NextResponse.json(
      { erro: "erro ao processar enriquecimento", detalhe: msg },
      { status: 500 },
    );
  }
}
