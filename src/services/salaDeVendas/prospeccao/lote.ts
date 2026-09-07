/**
 * O LOTE DE PROSPECÇÃO — carregar a lista sem queimar a lista.
 *
 * ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 *
 * A base de contatos é o ativo mais valioso desta empresa e o mais fácil de
 * destruir: bastam um disparo grande e um punhado de denúncias para o número
 * comercial ser restringido — e o número restringido não afeta só a prospecção,
 * afeta o atendimento de quem já é cliente.
 *
 * Por isso importar NÃO é abordar. São dois atos separados, com duas decisões
 * separadas: carregar (`importarLote`) é conferência; liberar (`liberarLote`) é
 * autorização, e é dela que sai a base legal declarada.
 *
 * ── O QUE ESTE ARQUIVO NÃO FAZ ──────────────────────────────────────────────
 *
 * Não envia mensagem. Não escolhe quem abordar. Não liga a prospecção. Ele
 * carrega, deduplica e registra — e nada aqui alcança o telefone de ninguém.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { analisarWhatsappBr } from "@/lib/whatsapp-br";
import { existeLeadParaTelefone } from "./casamento";

type Cliente = PrismaClient | Prisma.TransactionClient;

export interface LinhaDaLista {
  nome?: string | null;
  whatsapp: string;
  empresa?: string | null;
  cidade?: string | null;
  estado?: string | null;
  tipo?: string | null;
}

export interface PedidoDeImportacao {
  nome: string;
  /** Por que temos estes contatos. Obrigatório, e é texto de gente. */
  proveniencia: string;
  linhas: LinhaDaLista[];
  criadoPor?: string | null;
  /** Teto próprio do lote. O teto global continua valendo por cima. */
  limiteDiario?: number;
}

export interface ResultadoDaImportacao {
  loteId: string;
  recebidas: number;
  aceitas: number;
  /** Telefone repetido dentro da própria planilha. */
  repetidasNoArquivo: number;
  /** Telefone que já está esperando abordagem em outro lote. */
  repetidasEmOutroLote: number;
  /** Telefone que não é telefone. */
  invalidas: number;
  /** Já existe como lead na base — entra marcado, não vira carteira nova. */
  jaEramLead: number;
}

/** Teto de segurança por importação. Lista gigante entra em partes, conferida. */
export const MAX_LINHAS_POR_IMPORTACAO = 500;

export class ListaGrandeDemais extends Error {
  constructor(recebidas: number) {
    super(
      `A importação traz ${recebidas} linhas e o teto por lote é ${MAX_LINHAS_POR_IMPORTACAO}. ` +
        `Divida em lotes menores — lote grande é o que ninguém confere antes de liberar.`,
    );
    this.name = "ListaGrandeDemais";
  }
}

export class ProvenienciaAusente extends Error {
  constructor() {
    super(
      "O lote precisa declarar de onde vieram os contatos. Sem essa frase não " +
        "há como responder, depois, por que abordamos estas pessoas.",
    );
    this.name = "ProvenienciaAusente";
  }
}

/**
 * Carrega a lista num lote RASCUNHO.
 *
 * ── AS TRÊS DEDUPLICAÇÕES, E POR QUE SÃO TRÊS ───────────────────────────────
 *
 *   1. **dentro do arquivo** — a mesma planilha costuma repetir a mesma loja em
 *      duas linhas; sem isto o mesmo telefone seria abordado duas vezes;
 *   2. **contra os outros lotes ainda pendentes** — reimportar a mesma planilha
 *      cria um lote NOVO, então o índice único `(loteId, whatsappDigits)` não
 *      pega nada entre importações. Sem a consulta explícita, o mesmo telefone
 *      ficaria pendente em dois lotes e seria abordado duas vezes por pessoas
 *      diferentes, cada uma achando que era a primeira;
 *   3. **contra a base de leads** — quem já é lead não vira carteira nova. Ele
 *      entra como `DUPLICADO`, com o `leadId` apontando para a carteira que já
 *      existe, e é justamente isso que impede dois donos para a mesma pessoa.
 *
 * A terceira é a que evita o erro caro: prospectar como estranho alguém que já
 * está em conversa com a gente.
 */
/**
 * O que a conferência diz de UMA linha.
 *
 * Os nomes são de gente porque eles chegam à tela: quem sobe uma lista precisa
 * ler "já era lead" e entender, não decifrar um código.
 */
export type SituacaoDaLinha =
  | "NOVA"
  | "JA_ERA_LEAD"
  | "PENDENTE_EM_OUTRO_LOTE"
  | "REPETIDA_NO_ARQUIVO"
  | "TELEFONE_INVALIDO";

export interface LinhaConferida {
  situacao: SituacaoDaLinha;
  /** Só dígitos, quando o telefone é plausível. */
  digitos: string | null;
  /** Preenchido quando o contato já existe como lead. */
  leadId: string | null;
}

export interface ConferenciaDaLista {
  recebidas: number;
  /** Contatos que a base ainda não conhece. É o número que interessa. */
  novas: number;
  jaEramLead: number;
  repetidasEmOutroLote: number;
  repetidasNoArquivo: number;
  invalidas: number;
  linhas: LinhaConferida[];
}

/**
 * ⭐ CONFERE A LISTA SEM ESCREVER NADA — "quantos destes já temos?"
 *
 * ── POR QUE ELA EXISTE ──────────────────────────────────────────────────────
 *
 * Pedido do CEO em 07/09/2026: *"quando um arquivo chegar, fale: olha, esses
 * cinquenta aqui já estão, mas esses vinte aqui são novos."* Até então a
 * resposta só aparecia DEPOIS de importar — e importar é ato que grava.
 *
 * ── ⚠️ E POR QUE `importarLote` USA ESTA MESMA FUNÇÃO ──────────────────────
 *
 * Porque a alternativa era escrever a mesma regra duas vezes, e duas
 * implementações da mesma regra divergem no primeiro conserto que alguém fizer
 * em uma só. A conferência prévia e a importação **têm de dar o mesmo
 * resultado** — e a única forma honesta de garantir isso é serem o mesmo
 * código, não dois que se parecem.
 *
 * ── O CASAMENTO É PELA CAUDA, E ISSO IMPORTA ───────────────────────────────
 *
 * `existeLeadParaTelefone` casa pelos últimos oito dígitos: a base tem
 * telefones em formato legado, e igualdade exata deixaria passar como "novo"
 * quem já é lead — **inclusive quem pediu silêncio**.
 */
export async function conferirLista(
  db: Cliente,
  linhas: readonly LinhaDaLista[],
): Promise<ConferenciaDaLista> {
  const vistos = new Set<string>();
  const resultado: LinhaConferida[] = [];

  let novas = 0;
  let jaEramLead = 0;
  let repetidasEmOutroLote = 0;
  let repetidasNoArquivo = 0;
  let invalidas = 0;

  for (const linha of linhas) {
    const analise = analisarWhatsappBr(linha.whatsapp ?? "");

    if (!analise.ok) {
      invalidas += 1;
      resultado.push({ situacao: "TELEFONE_INVALIDO", digitos: null, leadId: null });
      continue;
    }

    const digitos = analise.digitos;

    if (vistos.has(digitos)) {
      repetidasNoArquivo += 1;
      resultado.push({ situacao: "REPETIDA_NO_ARQUIVO", digitos, leadId: null });
      continue;
    }
    vistos.add(digitos);

    const leadExistente = await existeLeadParaTelefone(db, digitos);

    // O mesmo telefone esperando abordagem em outro lote. Não é lead ainda, e
    // por isso a busca acima não o encontra — mas abordar seria em duplicidade.
    const pendenteEmOutroLote = leadExistente
      ? null
      : await db.itemDeProspeccao.findFirst({
          where: { whatsappDigits: digitos, situacao: "PENDENTE" },
          select: { id: true },
        });

    if (leadExistente) {
      jaEramLead += 1;
      resultado.push({ situacao: "JA_ERA_LEAD", digitos, leadId: leadExistente.id });
    } else if (pendenteEmOutroLote) {
      repetidasEmOutroLote += 1;
      resultado.push({ situacao: "PENDENTE_EM_OUTRO_LOTE", digitos, leadId: null });
    } else {
      novas += 1;
      resultado.push({ situacao: "NOVA", digitos, leadId: null });
    }
  }

  return {
    recebidas: linhas.length,
    novas,
    jaEramLead,
    repetidasEmOutroLote,
    repetidasNoArquivo,
    invalidas,
    linhas: resultado,
  };
}

export async function importarLote(
  db: Cliente,
  pedido: PedidoDeImportacao,
): Promise<ResultadoDaImportacao> {
  const proveniencia = pedido.proveniencia?.trim() ?? "";
  if (proveniencia === "") throw new ProvenienciaAusente();
  if (pedido.linhas.length > MAX_LINHAS_POR_IMPORTACAO) {
    throw new ListaGrandeDemais(pedido.linhas.length);
  }

  // O teto do lote vem do corpo da requisição, e corpo de requisição não valida
  // a si mesmo: negativo vira zero, e ausente vira o padrão conservador.
  const limiteDiario =
    typeof pedido.limiteDiario === "number" && Number.isFinite(pedido.limiteDiario)
      ? Math.max(0, Math.floor(pedido.limiteDiario))
      : 20;

  const lote = await db.loteDeProspeccao.create({
    data: {
      nome: pedido.nome.trim() || "Lote sem nome",
      proveniencia,
      criadoPor: pedido.criadoPor ?? null,
      limiteDiario,
    },
    select: { id: true },
  });

  // ⚠️ A MESMA função que a tela usa para conferir antes de subir. Escrever a
  // regra de duplicidade duas vezes faria a conferência prometer um número e a
  // importação entregar outro — e quem descobre é o operador, no fim.
  const conferencia = await conferirLista(db, pedido.linhas);

  for (let i = 0; i < pedido.linhas.length; i++) {
    const linha = pedido.linhas[i]!;
    const v = conferencia.linhas[i]!;

    if (v.situacao === "TELEFONE_INVALIDO") {
      await db.itemDeProspeccao.create({
        data: {
          loteId: lote.id,
          nome: texto(linha.nome),
          whatsapp: String(linha.whatsapp ?? ""),
          // Sem dígitos válidos não há chave; o id mantém a linha única e
          // rastreável sem fingir um telefone que não existe.
          whatsappDigits: `invalido:${idUnicoDeLinhaInvalida()}`,
          empresa: texto(linha.empresa),
          cidade: texto(linha.cidade),
          estado: texto(linha.estado),
          tipo: texto(linha.tipo),
          situacao: "RECUSADO",
          motivo: "Telefone com formato improvável.",
          processadoEm: new Date(),
        },
      });
      continue;
    }

    // Repetida dentro do próprio arquivo não vira linha: a primeira já entrou,
    // e gravar a segunda criaria duas fichas para o mesmo telefone no mesmo
    // lote — que é o que a chave única do lote impediria com um erro feio.
    if (v.situacao === "REPETIDA_NO_ARQUIVO") continue;

    const duplicada = v.situacao !== "NOVA";

    await db.itemDeProspeccao.create({
      data: {
        loteId: lote.id,
        nome: texto(linha.nome),
        whatsapp: String(linha.whatsapp),
        whatsappDigits: v.digitos!,
        empresa: texto(linha.empresa),
        cidade: texto(linha.cidade),
        estado: texto(linha.estado),
        tipo: texto(linha.tipo),
        situacao: duplicada ? "DUPLICADO" : "PENDENTE",
        leadId: v.leadId,
        motivo:
          v.situacao === "JA_ERA_LEAD"
            ? "Já existe como lead na base."
            : v.situacao === "PENDENTE_EM_OUTRO_LOTE"
              ? "Já está pendente em outro lote de prospecção."
              : null,
        processadoEm: duplicada ? new Date() : null,
      },
    });
  }

  const { novas: aceitas, repetidasNoArquivo, repetidasEmOutroLote, invalidas, jaEramLead } =
    conferencia;

  return {
    loteId: lote.id,
    recebidas: pedido.linhas.length,
    aceitas,
    repetidasNoArquivo,
    repetidasEmOutroLote,
    invalidas,
    jaEramLead,
  };
}

/**
 * Libera o lote para abordagem — o ato que cria a autorização.
 *
 * A base legal declarada é a `proveniencia` do lote, e quem libera fica
 * registrado. Não existe liberar "no automático": se ninguém assinou, ninguém
 * autorizou.
 */
export async function liberarLote(
  db: Cliente,
  loteId: string,
  quem: string,
): Promise<{ ok: boolean; motivo?: string }> {
  const lote = await db.loteDeProspeccao.findUnique({
    where: { id: loteId },
    select: { situacao: true, proveniencia: true },
  });
  if (!lote) return { ok: false, motivo: "Lote não encontrado." };
  if ((lote.proveniencia ?? "").trim() === "") {
    return { ok: false, motivo: "Lote sem proveniência declarada." };
  }
  if (lote.situacao === "ENCERRADO") {
    return { ok: false, motivo: "Lote encerrado não volta a abordar." };
  }

  await db.loteDeProspeccao.update({
    where: { id: loteId },
    data: {
      situacao: "LIBERADO",
      liberadoEm: new Date(),
      liberadoPor: quem,
      // Retomar um lote pausado limpa a pausa, mas não apaga quem pausou:
      // essa história vive na trilha, não nesta linha.
      pausadoEm: null,
    },
  });

  return { ok: true };
}

/**
 * Pausa imediata de um lote. Efeito na próxima seleção, sem deploy.
 *
 * Devolve `{ok:false}` para lote inexistente em vez de deixar o P2025 do Prisma
 * subir: um freio que responde 500 é um freio que a pessoa não sabe se pegou.
 */
export async function pausarLote(
  db: Cliente,
  loteId: string,
  quem: string,
): Promise<{ ok: boolean; motivo?: string }> {
  const existe = await db.loteDeProspeccao.findUnique({
    where: { id: loteId },
    select: { id: true },
  });
  if (!existe) return { ok: false, motivo: "Lote não encontrado." };

  await db.loteDeProspeccao.update({
    where: { id: loteId },
    data: { situacao: "PAUSADO", pausadoEm: new Date(), pausadoPor: quem },
  });
  return { ok: true };
}

function texto(v: string | null | undefined): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
}

/**
 * Sufixo único para linhas sem telefone utilizável.
 *
 * `randomUUID` e não `Math.random()`: o índice único `(loteId, whatsappDigits)`
 * transforma colisão em P2002, e P2002 aqui derruba a importação inteira por
 * causa de duas linhas inválidas. O nome antigo ainda dizia "crypto" usando
 * `Math.random()` — nome que mente sobre garantia é como a garantia se perde.
 */
function idUnicoDeLinhaInvalida(): string {
  return randomUUID();
}
