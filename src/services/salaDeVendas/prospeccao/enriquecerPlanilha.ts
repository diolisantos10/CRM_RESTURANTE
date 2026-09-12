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
 * ── ⭐ E, DESDE 12/09/2026, TAMBÉM AUDITA O CONFLITO ────────────────────────
 *
 * Quando a planilha nova traz um valor DIFERENTE de um campo que já está
 * preenchido, esta função continua sem sobrescrever — o dado original é a
 * verdade — mas agora REGISTRA a divergência em `ConflitoDeImportacao`
 * (`campo`, `valorAtual`, `valorNovo`, o arquivo de origem). Antes disso a
 * divergência era descartada em silêncio: ninguém sabia que uma segunda fonte
 * discordava do que já estava gravado.
 *
 * ── O QUE ELE NÃO FAZ ───────────────────────────────────────────────────────
 *
 * - NÃO cria items novos (só preenche os existentes)
 * - NÃO toca em campo já preenchido (só preenche nulos — o divergente vira
 *   conflito auditado, nunca sobrescrita)
 * - NÃO recoloca items em fila (o que foi abordado continua abordado)
 * - NÃO envia mensagem (só atualiza base)
 * - NÃO tira de lote nenhum (cada item continua no seu)
 */

import type { PrismaClient, Prisma, ItemDeProspeccao } from "@prisma/client";
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
  /** ⭐ 12/09/2026 — quantos campos DIVERGENTES foram detectados e auditados (nunca sobrescritos). */
  conflitos: number;
  /** O detalhe de cada conflito — para quem quiser mostrar, sem precisar reconsultar o banco. */
  detalheDeConflitos: Array<{ itemId: string; campo: string; valorAtual: string; valorNovo: string }>;
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

/** Os campos do item que `diferencasDeCampos` precisa enxergar — um subconjunto de `ItemDeProspeccao`. */
export type ItemParaComparar = Pick<
  ItemDeProspeccao,
  (typeof CAMPOS_DE_TEXTO)[number] | "id" | "numeroDeUnidades" | "canaisAtuais" | "observacoes" | "tags"
>;

export interface ConflitoDeCampo {
  campo: string;
  valorAtual: string;
  valorNovo: string;
}

export interface DiferencasDeCampos {
  /** O que vai PREENCHER — o item tem `null`, a linha trouxe valor. */
  mudancas: Record<string, string | number | string[]>;
  /** O que DIVERGE — o item já tem valor, a linha trouxe outro. NUNCA aplicado. */
  conflitos: ConflitoDeCampo[];
}

/**
 * ⭐ A REGRA DE "O QUE MUDA", EXTRAÍDA EM 12/09/2026 — uma função só, para
 * `enriquecerPlanilhaDeItems` e a classificação da importação (`classificacao.ts`)
 * nunca decidirem coisas diferentes sobre o mesmo par (item existente, linha nova).
 *
 * Três destinos por campo, e só três:
 *   1. Item `null`, linha tem valor → `mudancas` (vai preencher).
 *   2. Item preenchido, linha tem OUTRO valor → `conflitos` (nunca aplicado,
 *      só auditado — o dado original é a verdade).
 *   3. Qualquer outro caso (linha vazia, ou os dois iguais) → nada. Não é
 *      silêncio: é "não há nada para fazer aqui".
 */
export function diferencasDeCampos(item: ItemParaComparar, linha: LinhaLida): DiferencasDeCampos {
  const mudancas: Record<string, string | number | string[]> = {};
  const conflitos: ConflitoDeCampo[] = [];

  for (const campo of CAMPOS_DE_TEXTO) {
    const novo = typeof linha[campo] === "string" ? (linha[campo] as string).trim() : "";
    if (!novo) continue;

    const atual = item[campo];
    if (atual === null) {
      mudancas[campo] = novo;
    } else if (atual.trim() !== novo) {
      conflitos.push({ campo, valorAtual: atual, valorNovo: novo });
    }
    // atual === novo (mesmo valor, grafia diferente de espaço): nada a fazer.
  }

  if (item.numeroDeUnidades === null && linha.numeroDeUnidades !== null) {
    mudancas.numeroDeUnidades = linha.numeroDeUnidades;
  } else if (
    item.numeroDeUnidades !== null &&
    linha.numeroDeUnidades !== null &&
    item.numeroDeUnidades !== linha.numeroDeUnidades
  ) {
    conflitos.push({
      campo: "numeroDeUnidades",
      valorAtual: String(item.numeroDeUnidades),
      valorNovo: String(linha.numeroDeUnidades),
    });
  }

  // Listas (`canaisAtuais`, `tags`) e o texto longo (`observacoes`) só
  // preenchem quando vazias — divergência de LISTA não vira "conflito de
  // campo único": a régua de conflito é para um valor discordando de outro,
  // e duas listas parciais não são exatamente isso. Preenchimento continua
  // valendo; a auditoria de conflito, aqui, fica para os campos escalares.
  if (item.canaisAtuais.length === 0 && linha.canaisAtuais.length > 0) {
    mudancas.canaisAtuais = linha.canaisAtuais;
  }
  if (item.observacoes === null && linha.observacoes) {
    mudancas.observacoes = linha.observacoes;
  } else if (item.observacoes !== null && linha.observacoes && item.observacoes.trim() !== linha.observacoes.trim()) {
    conflitos.push({ campo: "observacoes", valorAtual: item.observacoes, valorNovo: linha.observacoes });
  }
  if (item.tags.length === 0 && linha.tags.length > 0) {
    mudancas.tags = linha.tags;
  }

  return { mudancas, conflitos };
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
    conflitos: 0,
    detalheDeConflitos: [],
  };
  const arquivoOrigem = metadados?.nomeArquivo ?? null;

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

      // Um item por vez: `diferencasDeCampos` decide o que preenche e o que
      // diverge — a MESMA função que `classificacao.ts` usa para classificar
      // a linha antes de chegar aqui.
      for (const item of items) {
        const { mudancas, conflitos } = diferencasDeCampos(item, linha);

        // ── OS CONFLITOS SÃO AUDITADOS, NUNCA APLICADOS ─────────────────────
        //
        // O dado original continua na base — só o registro do divergente é
        // novo. Grava mesmo quando não há nada para PREENCHER (um item cheio
        // pode, ainda assim, receber um valor novo divergente para um campo
        // que já tinha).
        if (conflitos.length > 0) {
          await db.conflitoDeImportacao.createMany({
            data: conflitos.map((c) => ({
              itemId: item.id,
              campo: c.campo,
              valorAtual: c.valorAtual,
              valorNovo: c.valorNovo,
              arquivoOrigem,
            })),
          });
          resultado.conflitos += conflitos.length;
          resultado.detalheDeConflitos.push(
            ...conflitos.map((c) => ({ itemId: item.id, ...c })),
          );
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
