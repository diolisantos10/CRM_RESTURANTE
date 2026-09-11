/**
 * ENRIQUECER POR PLANILHA — atualizar campos vazios de itens existentes.
 *
 * ── O CASO DE USO ───────────────────────────────────────────────────────────
 *
 * Importou-se uma lista de prospecção. Depois, descobriu-se que naquela lista
 * faltava o nome do restaurante, ou a cidade, ou o tipo — informação que está
 * em outra planilha. Sem criar duplicata, sem mexer em quem já foi abordado,
 * sem enviar mensagem nova: só preencher o vazio com o que chegou.
 *
 * ── O QUE ELE FAZ ───────────────────────────────────────────────────────────
 *
 * Para cada linha da planilha de entrada:
 * 1. Normaliza o WhatsApp
 * 2. Acha todos os items existentes com aquele número
 * 3. Preenche os campos nulos (nome, empresa, cidade, estado, tipo)
 * 4. Registra qual arquivo, qual data, qual usuário fez a operação
 * 5. Devolve um resumo do que mudou
 *
 * ── O QUE ELE NÃO FAZ ───────────────────────────────────────────────────────
 *
 * - NÃO cria items novos (só preenche os existentes)
 * - NÃO toca em fields já preenchidos (só preenche nulos)
 * - NÃO recoloca items em fila (o que foi abordado continua abordado)
 * - NÃO envia mensagem (só atualiza base)
 * - NÃO tira de lote nenhum (cada item continua no seu)
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { analisarWhatsappBr } from "@/lib/whatsapp-br";
import type { LinhaLida } from "./lerPlanilha";
import { grafiasDoTelefone } from "./casamento";

type Cliente = PrismaClient | Prisma.TransactionClient;

export interface ResultadoDoEnriquecimento {
  linhasProcessadas: number;
  itemsEncontrados: number;
  itemsEnriquecidos: number;
  camposAtualizados: number;
  naoEncontrados: number;
  naoAlterados: number;
  erros: Array<{ linha: number; motivo: string }>;
}

/**
 * Normaliza o WhatsApp para o formato de busca: `55` + DDD + número.
 * Devolve `null` se for inválido.
 */
function normalizarWhatsappParaBusca(whatsapp: string): string | null {
  try {
    const analise = analisarWhatsappBr(whatsapp);
    if (!analise.ok) return null;
    return analise.digitos;
  } catch {
    return null;
  }
}

/**
 * Os campos de TEXTO simples que o enriquecimento preenche — nome (do
 * responsável), empresa (o restaurante), e os catorze da ampliação de
 * 11/09/2026. Uma lista só, para não repetir a mesma verificação campo a
 * campo: `canaisAtuais`, `numeroDeUnidades`, `observacoes` e `tags` são
 * tratados à parte, porque não são texto simples (dois são lista, um é
 * número, um é texto longo que pode ter vindo vazio de propósito).
 */
const CAMPOS_DE_TEXTO = [
  "nome",
  "empresa",
  "cidade",
  "estado",
  "tipo",
  "email",
  "cargo",
  "telefoneSecundario",
  "bairro",
  "endereco",
  "cep",
  "cnpj",
  "instagram",
  "site",
  "googleMapsUrl",
] as const satisfies readonly (keyof LinhaLida)[];

/**
 * Preenche os campos nulos de um item com valores não-nulos da linha.
 * Devolve só o que a LINHA trouxe — quem decide o que realmente muda é
 * `mudancasParaOItem`, comparando contra o item de verdade.
 */
function contarCamposAVencer(
  linha: LinhaLida,
): Partial<Record<(typeof CAMPOS_DE_TEXTO)[number], string>> {
  const updates: Partial<Record<(typeof CAMPOS_DE_TEXTO)[number], string>> = {};
  for (const campo of CAMPOS_DE_TEXTO) {
    const v = linha[campo];
    if (typeof v === "string" && v) updates[campo] = v;
  }
  return updates;
}

/**
 * ⭐ Enriquece a lista: preenche campos vazios de items existentes
 * a partir de uma planilha.
 */
export async function enriquecerPlanilhaDeItems(
  db: Cliente,
  linhas: LinhaLida[],
  metadados?: {
    nomeArquivo?: string;
    usuario?: string;
    dataEnriquecimento?: Date;
  },
): Promise<ResultadoDoEnriquecimento> {
  const resultado: ResultadoDoEnriquecimento = {
    linhasProcessadas: linhas.length,
    itemsEncontrados: 0,
    itemsEnriquecidos: 0,
    camposAtualizados: 0,
    naoEncontrados: 0,
    naoAlterados: 0,
    erros: [],
  };

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]!;

    // Validar que existe telefone
    if (!linha.whatsapp || !linha.whatsapp.trim()) {
      resultado.erros.push({ linha: i + 1, motivo: "sem telefone" });
      continue;
    }

    // Normalizar o WhatsApp
    const whatsappDigits = normalizarWhatsappParaBusca(linha.whatsapp);
    if (!whatsappDigits) {
      resultado.erros.push({ linha: i + 1, motivo: "telefone inválido" });
      continue;
    }

    // Achar items com este WhatsApp
    const grafias = grafiasDoTelefone(whatsappDigits);
    if (grafias.length === 0) {
      resultado.erros.push({ linha: i + 1, motivo: "WhatsApp não normalizável" });
      continue;
    }

    try {
      // Buscar items existentes
      const items = await db.itemDeProspeccao.findMany({
        where: { whatsappDigits: { in: grafias } },
      });

      if (items.length === 0) {
        resultado.naoEncontrados++;
        continue;
      }

      resultado.itemsEncontrados += items.length;

      // Montar os updates para este item
      const updates = contarCamposAVencer(linha);

      // Atualizar cada item: só preencher o que é null (ou lista/observação vazia)
      for (const item of items) {
        const mudancas: Record<string, string | number | string[]> = {};

        for (const campo of CAMPOS_DE_TEXTO) {
          const novo = updates[campo];
          if (item[campo] === null && novo) mudancas[campo] = novo;
        }

        if (item.numeroDeUnidades === null && linha.numeroDeUnidades !== null) {
          mudancas.numeroDeUnidades = linha.numeroDeUnidades;
        }
        if (item.canaisAtuais.length === 0 && linha.canaisAtuais.length > 0) {
          mudancas.canaisAtuais = linha.canaisAtuais;
        }
        if (item.observacoes === null && linha.observacoes) {
          mudancas.observacoes = linha.observacoes;
        }
        if (item.tags.length === 0 && linha.tags.length > 0) {
          mudancas.tags = linha.tags;
        }

        if (Object.keys(mudancas).length === 0) {
          resultado.naoAlterados++;
          continue;
        }

        // Aplicar a atualização
        await db.itemDeProspeccao.update({
          where: { id: item.id },
          data: mudancas,
        });

        resultado.itemsEnriquecidos++;
        resultado.camposAtualizados += Object.keys(mudancas).length;
      }
    } catch (e) {
      const motivo = e instanceof Error ? e.message : "erro desconhecido";
      resultado.erros.push({ linha: i + 1, motivo });
    }
  }

  return resultado;
}
