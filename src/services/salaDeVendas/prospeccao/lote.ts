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
 * ── ⚠️ O QUE MUDOU EM 10/09/2026, E POR QUE ─────────────────────────────────
 *
 * Este cabeçalho dizia, em letras firmes, que *"importar NÃO é abordar; são dois
 * atos separados"*. A frase era bonita e o efeito dela, medido, era outro: o
 * frontend fatia o arquivo em partes de 500, então uma lista de 8.000 nascia
 * como **dezesseis** lotes RASCUNHO e alguém precisava clicar "Liberar"
 * dezesseis vezes. Não era uma decisão consciente repetida — era a mesma
 * decisão, tomada uma vez, cobrada dezesseis. Ato que se repete assim não é
 * conferido: é despachado no automático, que é justamente o oposto do que a
 * separação existia para conseguir.
 *
 * Agora o lote nasce **LIBERADO**, e a autorização não sumiu — ela mudou de
 * lugar. Quem autoriza é quem importa, e a assinatura fica gravada
 * (`liberadoPor`, `liberadoPorUserId`) junto com a `proveniencia`, que continua
 * obrigatória (`ProvenienciaAusente`). A base legal declarada é a mesma de
 * sempre; o que deixou de existir é o clique que ninguém lia.
 *
 * ⚠️ Quem pode importar passou a ser quem podia liberar. A trava vive na rota
 * (`vePelaOperacaoToda`), e sem ela esta mudança teria aberto uma porta lateral:
 * o SDR, que nunca pôde autorizar, autorizaria importando.
 *
 * ── O QUE ESTE ARQUIVO NÃO FAZ ──────────────────────────────────────────────
 *
 * Não envia mensagem. Não escolhe quem abordar. Não liga a prospecção. Ele
 * carrega, deduplica e registra — e nada aqui alcança o telefone de ninguém.
 * Com o interruptor global desligado (o padrão), lote liberado não aborda
 * ninguém: a liberação diz "esta lista pode", e não "manda agora".
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

  // ── ⭐ AMPLIAÇÃO DA BASE FRIA, 11/09/2026 — todos opcionais, todos aditivos ──
  email?: string | null;
  cargo?: string | null;
  telefoneSecundario?: string | null;
  bairro?: string | null;
  endereco?: string | null;
  cep?: string | null;
  cnpj?: string | null;
  instagram?: string | null;
  site?: string | null;
  googleMapsUrl?: string | null;
  numeroDeUnidades?: number | null;
  canaisAtuais?: string[];
  observacoes?: string | null;
  tags?: string[];
}

export interface PedidoDeImportacao {
  nome: string;
  /** Por que temos estes contatos. Obrigatório, e é texto de gente. */
  proveniencia: string;
  linhas: LinhaDaLista[];
  /** Rótulo de tela de quem subiu, `Nome (userId)`. NÃO é um id. */
  criadoPor?: string | null;
  /**
   * ⭐ O ID DE VERDADE de quem subiu — e, desde 10/09/2026, de quem AUTORIZOU.
   *
   * Vai para `liberadoPorUserId`, que é a coluna que a rodada automática lê para
   * saber quem responde por cada mensagem. Lote sem ele não é abordado: a
   * promessa de que "toda mensagem que sai em nome da empresa tem um
   * responsável" só se cumpre com um id que o banco reconheça.
   *
   * ⚠️ Tem que sair da SESSÃO. Aceitar este campo do corpo da requisição deixaria
   * qualquer um assinar a autorização com o nome de outro.
   */
  criadoPorUserId?: string | null;
  /**
   * A importação (o ARQUIVO inteiro) a que este lote pertence.
   *
   * É o campo que transforma "16 lotes de 500" em UMA lista de 8.000 aos olhos
   * de quem operou. Opcional porque lote sem importação continua válido — o
   * histórico anterior a 10/09/2026 não tem nenhuma.
   */
  importacaoId?: string | null;
  /**
   * ⚠️ COLUNA APOSENTADA. Continua sendo gravada e **não reduz mais a fila**.
   *
   * Ver `LoteDeProspeccao.limiteDiario` no schema e o comentário da consulta em
   * `selecao.ts`: o teto que vale é o global, mais o teto explícito da rodada.
   */
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
  /**
   * Por motivo, quantas linhas NÃO vão virar abordagem.
   *
   * ── POR QUE UM MAPA, E NÃO SÓ OS NÚMEROS ──
   *
   * Os contadores acima respondem "quantas". Só o mapa responde "por quê" na
   * língua de quem operou — e é a segunda pergunta que aparece quando alguém
   * sobe 8.000 linhas e a fila mostra 5.200. Sem ela, a diferença de 2.800 vira
   * desconfiança do sistema inteiro.
   *
   * A soma dos valores é exatamente `recebidas - aceitas`. Se um dia não for,
   * é porque uma classe de recusa deixou de ser contada — e o teste da
   * conferência quebra por isso, de propósito.
   */
  motivosDeRecusa: Record<string, number>;
}

/**
 * As frases de recusa, em um lugar só.
 *
 * Elas são CHAVE de agregação (viram `{motivo: quantas}` no registro da
 * importação) e texto de tela ao mesmo tempo. Digitá-las solta em cada ponto
 * faria "Já existe como lead na base." e "Já existe como lead na base" virarem
 * duas linhas diferentes no mesmo relatório — o tipo de divergência que ninguém
 * revisa porque parece igual.
 */
export const MOTIVO = {
  jaEraLead: "Já existe como lead na base",
  pendenteEmOutroLote: "Já estava pendente em outra importação",
  repetidaNoArquivo: "Repetido dentro do próprio arquivo",
  telefoneInvalido: "Telefone com formato improvável",
} as const;

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
 * Carrega a lista num lote — que nasce LIBERADO, elegível na hora (ver o
 * comentário grande logo abaixo, na criação do lote).
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

  // ── ⭐ O LOTE NASCE LIBERADO — E A ASSINATURA NASCE COM ELE ───────────────
  //
  // O que autoriza é a `proveniencia` (recusada acima quando vazia) mais a
  // assinatura de quem subiu. Nascer RASCUNHO produzia dezesseis cliques de
  // "Liberar" para UMA lista de 8.000 — e dezesseis cliques iguais em sequência
  // não são dezesseis conferências, são um reflexo.
  //
  // ⚠️ `liberadoPorUserId` é o campo que a rodada automática lê para responder
  // por cada mensagem. Sem ele o lote entra liberado e **nenhum item é
  // abordado** (`abordarDaFila` pula lote sem responsável de verdade): a lista
  // ficaria parada sem explicação. Por isso quem chama tem que trazer o id da
  // sessão, e a rota é quem garante isso.
  const agora = new Date();
  const lote = await db.loteDeProspeccao.create({
    data: {
      nome: pedido.nome.trim() || "Lote sem nome",
      proveniencia,
      criadoPor: pedido.criadoPor ?? null,
      limiteDiario,
      ...(pedido.importacaoId ? { importacaoId: pedido.importacaoId } : {}),
      situacao: "LIBERADO",
      liberadoEm: agora,
      liberadoPor: pedido.criadoPor ?? null,
      ...(pedido.criadoPorUserId ? { liberadoPorUserId: pedido.criadoPorUserId } : {}),
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
          ...camposAmpliados(linha),
          situacao: "RECUSADO",
          // A MESMA frase que vira chave em `motivosDeRecusa`. Duas grafias do
          // mesmo motivo viram duas linhas no relatório da importação, e ninguém
          // revisa isso porque as duas parecem certas.
          motivo: MOTIVO.telefoneInvalido,
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
        ...camposAmpliados(linha),
        situacao: duplicada ? "DUPLICADO" : "PENDENTE",
        leadId: v.leadId,
        motivo:
          v.situacao === "JA_ERA_LEAD"
            ? MOTIVO.jaEraLead
            : v.situacao === "PENDENTE_EM_OUTRO_LOTE"
              ? MOTIVO.pendenteEmOutroLote
              : null,
        processadoEm: duplicada ? new Date() : null,
      },
    });
  }

  const { novas: aceitas, repetidasNoArquivo, repetidasEmOutroLote, invalidas, jaEramLead } =
    conferencia;

  // Só os motivos que ocorreram. Zerar as quatro chaves sempre encheria o
  // relatório de linhas "0" e escondia a que importa no meio delas.
  const motivosDeRecusa: Record<string, number> = {};
  if (jaEramLead > 0) motivosDeRecusa[MOTIVO.jaEraLead] = jaEramLead;
  if (repetidasEmOutroLote > 0) motivosDeRecusa[MOTIVO.pendenteEmOutroLote] = repetidasEmOutroLote;
  if (repetidasNoArquivo > 0) motivosDeRecusa[MOTIVO.repetidaNoArquivo] = repetidasNoArquivo;
  if (invalidas > 0) motivosDeRecusa[MOTIVO.telefoneInvalido] = invalidas;

  return {
    loteId: lote.id,
    recebidas: pedido.linhas.length,
    aceitas,
    repetidasNoArquivo,
    repetidasEmOutroLote,
    invalidas,
    jaEramLead,
    motivosDeRecusa,
  };
}

// ── ⛔ `liberarLote` E `pausarLote` FORAM REMOVIDAS EM 11/09/2026 ────────────
//
// Ordem explícita: "lote pode continuar existindo internamente só para
// rastrear arquivo, procedência, responsável e data — não pode aparecer como
// etapa operacional nem impedir envio." `montarFilaDeProspeccao` e
// `materializarLead` pararam de ler `LoteDeProspeccao.situacao` (ver
// `selecao.ts`), então uma função que só girava esse campo ficaria mentindo:
// o botão pareceria pausar a lista e não pausaria mais nada. Função que não
// tem mais efeito nenhum e ainda promete um é pior que função nenhuma.
//
// `cancelarImportacao` (`importacao.ts`) continua marcando os lotes como
// PAUSADO — mas isso hoje é só HISTÓRICO na aba Importações, não trava mais
// a seleção. Se um dia for preciso parar de verdade um arquivo específico em
// andamento, o mecanismo é outro (ex.: mover os itens para uma situação
// própria) — decisão separada, fora desta entrega.

function texto(v: string | null | undefined): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
}

/**
 * Os catorze campos da ampliação da Base fria, normalizados de uma vez —
 * evita repetir a mesma lista nos dois `create()` acima (recusado e aceito).
 */
function camposAmpliados(linha: LinhaDaLista) {
  return {
    email: texto(linha.email),
    cargo: texto(linha.cargo),
    telefoneSecundario: texto(linha.telefoneSecundario),
    bairro: texto(linha.bairro),
    endereco: texto(linha.endereco),
    cep: texto(linha.cep),
    cnpj: texto(linha.cnpj),
    instagram: texto(linha.instagram),
    site: texto(linha.site),
    googleMapsUrl: texto(linha.googleMapsUrl),
    numeroDeUnidades:
      typeof linha.numeroDeUnidades === "number" && Number.isFinite(linha.numeroDeUnidades)
        ? Math.max(0, Math.floor(linha.numeroDeUnidades))
        : null,
    canaisAtuais: linha.canaisAtuais ?? [],
    observacoes: texto(linha.observacoes),
    tags: linha.tags ?? [],
  };
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
