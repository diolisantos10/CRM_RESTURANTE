/**
 * A CLASSIFICAÇÃO — o backend decide, linha a linha, o que fazer com um
 * arquivo misto. Redesenho da prospecção automática e minimalista, 12/09/2026.
 *
 * ── O PROBLEMA QUE ISTO RESOLVE ─────────────────────────────────────────────
 *
 * Até aqui existiam DOIS caminhos para subir uma planilha — `importarLote`
 * (lista nova) e `enriquecerPlanilhaDeItems` (preencher vazio) — e era QUEM
 * OPERAVA quem escolhia qual dos dois chamar. O CEO pediu o oposto: ele só
 * sobe listas; toda classificação (novo/duplicata/enriquecimento/conflito/
 * inválido/inelegível/já abordado/opt-out) é decisão do backend.
 *
 * ── ⚠️ O QUE ESTE ARQUIVO NÃO FAZ ────────────────────────────────────────────
 *
 * Não reimplementa NENHUMA regra de dedup, de casamento de telefone ou de
 * preenchimento de campo. As duas únicas escritas de verdade (`importarLote`,
 * `enriquecerPlanilhaDeItems`) continuam sendo QUEM decide o que é gravado —
 * este arquivo decide QUANDO chamar cada uma, e complementa o relatório com
 * leituras extras (opt-out, já abordado) que os dois escritores não precisam
 * saber para fazer o trabalho deles.
 *
 * ── A ORDEM IMPORTA ──────────────────────────────────────────────────────────
 *
 *   1. `classificarLinhasParaRelatorio` — SÓ LEITURA. Passa por cada linha,
 *      reaproveitando `casamento.ts` (o mesmo casamento de telefone de
 *      `conferirLista`) e `diferencasDeCampos` (o mesmo diff de
 *      `enriquecerPlanilhaDeItems`), e devolve uma classificação por linha —
 *      para a tela mostrar a contagem certa, ANTES de gravar qualquer coisa.
 *   2. `classificarArquivoDeImportacao` — a única ESCRITA. Chama
 *      `importarLote` com o arquivo inteiro (ele já faz as três deduplicações
 *      e cria o RECUSADO/DUPLICADO/PENDENTE certos), depois chama
 *      `enriquecerPlanilhaDeItems` com o MESMO arquivo inteiro (preenche o
 *      que faltava nos itens que já existiam de ANTES desta importação — o
 *      item recém-criado pelo passo 1 já nasce com tudo preenchido, então a
 *      segunda passada não tem nada a fazer nele). Uma chamada, dois
 *      escritores testados, zero regra nova.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { analisarWhatsappBr } from "@/lib/whatsapp-br";
import { acharLeadPeloTelefone, grafiasDoTelefone } from "./casamento";
import {
  importarLote,
  type LinhaDaLista,
  type PedidoDeImportacao,
  type ResultadoDaImportacao,
} from "./lote";
import {
  enriquecerPlanilhaDeItems,
  diferencasDeCampos,
  type ResultadoDoEnriquecimento,
} from "./enriquecerPlanilha";
import { arquivoJaImportado } from "./importacao";
import type { LinhaLida } from "./lerPlanilha";

type Cliente = PrismaClient | Prisma.TransactionClient;

/**
 * ⭐ AS OITO CLASSIFICAÇÕES — nome estável, é o que a parte 2 (UI) vai ler.
 *
 *   NOVO             telefone não existe em lugar nenhum da casa.
 *   DUPLICATA_EXATA  o MESMO telefone já apareceu — dentro deste mesmo
 *                    arquivo, ou porque este arquivo (mesmo hash) já
 *                    tinha subido antes.
 *   ENRIQUECIMENTO   já existe um item na Base fria com este telefone, e a
 *                    linha nova traz algum campo hoje vazio.
 *   CONFLITO         já existe um item, e a linha nova traz um valor
 *                    DIFERENTE de um campo já preenchido — nada é
 *                    sobrescrito; o conflito é só auditado.
 *   INVALIDO         o telefone não é um telefone.
 *   JA_EXISTENTE     telefone já conhecido (lead ou item da Base fria) e não
 *                    há OPT_OUT/JA_ABORDADO/CONFLITO/ENRIQUECIMENTO a dizer.
 *   JA_ABORDADO      o lead já tem `LeadMensagem` de SAÍDA confirmada.
 *   OPT_OUT          o lead já pediu silêncio (`optOutAt` preenchido).
 */
export type ClassificacaoDaLinha =
  | "NOVO"
  | "DUPLICATA_EXATA"
  | "ENRIQUECIMENTO"
  | "CONFLITO"
  | "INVALIDO"
  | "JA_EXISTENTE"
  | "JA_ABORDADO"
  | "OPT_OUT";

/** Os status de saída que provam que a mensagem SAIU de verdade — não basta ter sido gravada `PENDENTE`. */
const STATUS_DE_ENVIO_CONFIRMADO = ["ENVIADA", "ENTREGUE", "LIDA"] as const;

export interface CampoDivergente {
  campo: string;
  valorAtual: string;
  valorNovo: string;
}

export interface LinhaClassificada {
  /** Índice da linha dentro do arquivo recebido (0-based) — para a tela apontar qual é qual. */
  indice: number;
  classificacao: ClassificacaoDaLinha;
  digitos: string | null;
  leadId: string | null;
  /** O item da Base fria que casou com este telefone, quando existe. */
  itemExistenteId: string | null;
  /** Preenchido só quando `classificacao` é `ENRIQUECIMENTO` ou `CONFLITO`. */
  camposParaPreencher: string[];
  /** Preenchido só quando `classificacao` é `CONFLITO`. */
  camposEmConflito: CampoDivergente[];
  /**
   * Falta o dado que o modelo de abordagem hoje exige e não tem substituto —
   * `empresa` (o "nome do restaurante" de `abordarLead`/`camposDoModelo`,
   * que não tem fallback como a saudação tem). Entra na base, mas nunca fica
   * elegível para a mensagem que exige essa variável — ver
   * `conferirElegibilidadeReal`/`montarParametros`.
   *
   * ⚠️ Só é calculado para `NOVO` e `ENRIQUECIMENTO` — é para essas duas
   * classes que a pergunta "este contato vai ficar pronto pra mensagem?"
   * importa; para as demais o campo é sempre `false`.
   */
  semDadoParaOModelo: boolean;
}

/**
 * ⭐ O CAMPO SEM SUBSTITUTO — hoje é só um: `empresa`.
 *
 * `abordarLead`/`camposDoModelo` (`abordar.ts`) montam três variáveis do
 * template `abordagem_restaurante_fria`: a saudação (com fallback entre
 * `restaurante` e `nome`), o nome do restaurante (SÓ `restaurante`/`empresa`,
 * sem fallback) e a procedência (do LOTE, sempre presente — é campo
 * obrigatório de `importarLote`/`abrirImportacao`). Então o único jeito de um
 * CONTATO nascer sem dado para o modelo é faltar `empresa` — e, se `empresa`
 * também faltar, a saudação cai para `nome`; só quando os DOIS faltam a
 * saudação também falha, mas `empresa` já teria acusado a pendência primeiro.
 *
 * Extraída como função para a parte 2 (UI) e um teste de regressão não
 * repetirem esta lista se o contrato do modelo ganhar uma quarta variável.
 */
export function faltaDadoParaOModelo(campos: { empresa: string | null }): boolean {
  return !campos.empresa || campos.empresa.trim() === "";
}

/** `LinhaDaLista` (o que a importação recebe) → `LinhaLida` (o que os leitores/comparadores esperam). Só normaliza a forma; nenhuma regra nova. */
export function linhaDaListaParaLinhaLida(l: LinhaDaLista): LinhaLida {
  return {
    nome: l.nome ?? null,
    whatsapp: l.whatsapp,
    empresa: l.empresa ?? null,
    cidade: l.cidade ?? null,
    estado: l.estado ?? null,
    tipo: l.tipo ?? null,
    email: l.email ?? null,
    cargo: l.cargo ?? null,
    telefoneSecundario: l.telefoneSecundario ?? null,
    bairro: l.bairro ?? null,
    endereco: l.endereco ?? null,
    cep: l.cep ?? null,
    cnpj: l.cnpj ?? null,
    instagram: l.instagram ?? null,
    site: l.site ?? null,
    googleMapsUrl: l.googleMapsUrl ?? null,
    numeroDeUnidades: l.numeroDeUnidades ?? null,
    canaisAtuais: l.canaisAtuais ?? [],
    observacoes: l.observacoes ?? null,
    tags: l.tags ?? [],
  };
}

/**
 * ⭐ CLASSIFICA UMA LINHA — SÓ LEITURA, nada é gravado.
 *
 * `vistosNoArquivo` é COMPARTILHADO entre as chamadas de um mesmo arquivo — é
 * ele que detecta o telefone repetido dentro do próprio arquivo, do mesmo
 * jeito que `conferirLista` faz com o `Set` local dela. `arquivoJaExistia` é
 * calculado UMA VEZ por arquivo (via `arquivoJaImportado`, pelo hash) e
 * passado para toda linha — reconsultar o hash linha a linha seria a mesma
 * pergunta feita mil vezes para a mesma resposta.
 */
export async function classificarLinhaDeImportacao(
  db: Cliente,
  linha: LinhaDaLista,
  ctx: { vistosNoArquivo: Set<string>; arquivoJaExistia: boolean; indice: number },
): Promise<LinhaClassificada> {
  const base = {
    indice: ctx.indice,
    leadId: null as string | null,
    itemExistenteId: null as string | null,
    camposParaPreencher: [] as string[],
    camposEmConflito: [] as CampoDivergente[],
    semDadoParaOModelo: false,
  };

  const analise = analisarWhatsappBr(linha.whatsapp ?? "");
  if (!analise.ok) {
    return { ...base, classificacao: "INVALIDO", digitos: null };
  }
  const digitos = analise.digitos;

  // ── Repetido dentro do MESMO arquivo, ou o arquivo (mesmo hash) já subiu ──
  const repetidoNoArquivo = ctx.vistosNoArquivo.has(digitos);
  if (!repetidoNoArquivo) ctx.vistosNoArquivo.add(digitos);
  if (repetidoNoArquivo || ctx.arquivoJaExistia) {
    return { ...base, classificacao: "DUPLICATA_EXATA", digitos };
  }

  // ── Já é lead? Opt-out e já-abordado só existem para quem já é lead ──────
  const lead = await acharLeadPeloTelefone(db, digitos);
  if (lead) {
    if (lead.optOutAt) {
      return { ...base, classificacao: "OPT_OUT", digitos, leadId: lead.id };
    }
    const saidaConfirmada = await db.leadMensagem.findFirst({
      where: {
        leadId: lead.id,
        direcao: "SAIDA",
        status: { in: [...STATUS_DE_ENVIO_CONFIRMADO] },
      },
      select: { id: true },
    });
    if (saidaConfirmada) {
      return { ...base, classificacao: "JA_ABORDADO", digitos, leadId: lead.id };
    }
    return { ...base, classificacao: "JA_EXISTENTE", digitos, leadId: lead.id };
  }

  // ── Já existe na Base fria (item de outro lote), mesmo sem ser lead? ─────
  const grafias = grafiasDoTelefone(digitos);
  const itemExistente =
    grafias.length > 0
      ? await db.itemDeProspeccao.findFirst({
          where: { whatsappDigits: { in: grafias } },
          orderBy: { criadoEm: "desc" },
        })
      : null;

  if (itemExistente) {
    const linhaLida = linhaDaListaParaLinhaLida(linha);
    const { mudancas, conflitos } = diferencasDeCampos(itemExistente, linhaLida);

    if (conflitos.length > 0) {
      return {
        ...base,
        classificacao: "CONFLITO",
        digitos,
        itemExistenteId: itemExistente.id,
        camposParaPreencher: Object.keys(mudancas),
        camposEmConflito: conflitos,
        semDadoParaOModelo: faltaDadoParaOModelo({
          empresa: mudancas.empresa != null ? String(mudancas.empresa) : itemExistente.empresa,
        }),
      };
    }
    if (Object.keys(mudancas).length > 0) {
      return {
        ...base,
        classificacao: "ENRIQUECIMENTO",
        digitos,
        itemExistenteId: itemExistente.id,
        camposParaPreencher: Object.keys(mudancas),
        semDadoParaOModelo: faltaDadoParaOModelo({
          empresa: mudancas.empresa != null ? String(mudancas.empresa) : itemExistente.empresa,
        }),
      };
    }
    return { ...base, classificacao: "JA_EXISTENTE", digitos, itemExistenteId: itemExistente.id };
  }

  // ── NOVO ───────────────────────────────────────────────────────────────
  return {
    ...base,
    classificacao: "NOVO",
    digitos,
    semDadoParaOModelo: faltaDadoParaOModelo({ empresa: linha.empresa ?? null }),
  };
}

export interface ResumoDaClassificacao {
  /** Total de linhas recebidas — a soma de todos os campos abaixo (mais as classificações informativas). */
  analisadas: number;
  /** Contatos novos que entraram na Base fria. */
  novos: number;
  /** Itens já existentes que ganharam algum campo preenchido. */
  enriquecidos: number;
  /** Já conhecidos e sem nada de novo a fazer — `JA_EXISTENTE` + `JA_ABORDADO` + `OPT_OUT`. */
  jaExistentes: number;
  /** Telefone com formato improvável. */
  invalidos: number;
  /**
   * Entrou na base (`NOVO` ou `ENRIQUECIMENTO`), mas falta o dado que o
   * modelo de abordagem exige — nunca fica elegível para a mensagem
   * enquanto isso não for corrigido. Ver `faltaDadoParaOModelo`.
   */
  aguardandoInformacao: number;

  // ── Informativos — aditivos, para quem quiser o detalhe fino ────────────
  duplicatasExatas: number;
  conflitos: number;
  jaAbordados: number;
  optOut: number;
  linhas: LinhaClassificada[];
}

/**
 * ⭐ CLASSIFICA O ARQUIVO INTEIRO PARA RELATÓRIO — SÓ LEITURA.
 *
 * Usada tanto pela conferência prévia (antes de gravar — igual `conferirLista`
 * faz hoje) quanto para montar o resumo final depois de `classificarArquivoDeImportacao`
 * escrever. Recebe `arquivoHash` opcional: quando presente, confere UMA VEZ se
 * este arquivo já subiu antes (ver `arquivoJaImportado`).
 */
export async function classificarLinhasParaRelatorio(
  db: Cliente,
  linhas: readonly LinhaDaLista[],
  opcoes: { arquivoHash?: string | null } = {},
): Promise<ResumoDaClassificacao> {
  const arquivoAnterior = opcoes.arquivoHash
    ? await arquivoJaImportado(db, opcoes.arquivoHash)
    : null;

  const vistosNoArquivo = new Set<string>();
  const linhasClassificadas: LinhaClassificada[] = [];

  for (let i = 0; i < linhas.length; i++) {
    linhasClassificadas.push(
      await classificarLinhaDeImportacao(db, linhas[i]!, {
        vistosNoArquivo,
        arquivoJaExistia: arquivoAnterior !== null,
        indice: i,
      }),
    );
  }

  return montarResumo(linhasClassificadas);
}

function montarResumo(linhas: LinhaClassificada[]): ResumoDaClassificacao {
  let novos = 0;
  let enriquecidos = 0;
  let jaExistentes = 0;
  let invalidos = 0;
  let aguardandoInformacao = 0;
  let duplicatasExatas = 0;
  let conflitos = 0;
  let jaAbordados = 0;
  let optOut = 0;

  for (const l of linhas) {
    if (l.semDadoParaOModelo) aguardandoInformacao += 1;

    switch (l.classificacao) {
      case "NOVO":
        novos += 1;
        break;
      case "ENRIQUECIMENTO":
        enriquecidos += 1;
        break;
      case "CONFLITO":
        conflitos += 1;
        // Um conflito ainda preenche os campos que estavam vazios — conta
        // nas duas métricas quando for o caso, e nunca faz a soma bater
        // "errado": `conflitos` é informativo, à parte de `enriquecidos`.
        if (l.camposParaPreencher.length > 0) enriquecidos += 1;
        break;
      case "INVALIDO":
        invalidos += 1;
        break;
      case "DUPLICATA_EXATA":
        duplicatasExatas += 1;
        jaExistentes += 1;
        break;
      case "JA_ABORDADO":
        jaAbordados += 1;
        jaExistentes += 1;
        break;
      case "OPT_OUT":
        optOut += 1;
        jaExistentes += 1;
        break;
      case "JA_EXISTENTE":
        jaExistentes += 1;
        break;
      default: {
        const nuncaAcontece: never = l.classificacao;
        return nuncaAcontece;
      }
    }
  }

  return {
    analisadas: linhas.length,
    novos,
    enriquecidos,
    jaExistentes,
    invalidos,
    aguardandoInformacao,
    duplicatasExatas,
    conflitos,
    jaAbordados,
    optOut,
    linhas,
  };
}

export interface PedidoDeImportacaoClassificada {
  nome: string;
  proveniencia: string;
  linhas: LinhaDaLista[];
  criadoPor?: string | null;
  criadoPorUserId?: string | null;
  importacaoId?: string | null;
  limiteDiario?: number;
  /** Hash do ARQUIVO (não do lote) — usado para reconhecer resubmissão e para auditar conflitos. */
  arquivoHash?: string | null;
  /** O nome do arquivo, gravado em `ConflitoDeImportacao.arquivoOrigem`. */
  arquivoNome?: string | null;
}

export interface ResultadoDaImportacaoClassificada {
  resumo: ResumoDaClassificacao;
  /** O que `importarLote` de fato gravou — para quem quiser o detalhe cru. */
  importacao: ResultadoDaImportacao;
  /** O que `enriquecerPlanilhaDeItems` de fato gravou. */
  enriquecimento: ResultadoDoEnriquecimento;
}

/**
 * ⭐ A ÚNICA CHAMADA QUE UM ARQUIVO MISTO PRECISA — classifica para o
 * relatório e despacha para os dois escritores testados.
 *
 * ── POR QUE NÃO EXISTE UM TERCEIRO "ESCRITOR" AQUI ─────────────────────────
 *
 * Porque escrever um terceiro caminho duplicaria a MESMA decisão que
 * `importarLote`/`enriquecerPlanilhaDeItems` já tomam sozinhos, com o risco de
 * as duas cópias da regra discordarem no primeiro conserto que alguém fizer
 * numa só (a mesma lição que o cabeçalho de `conferirLista` já registra).
 *
 * A ordem É a regra: primeiro `importarLote` (cria o que é NOVO, marca
 * DUPLICADO o que já existia, RECUSADO o inválido — as três deduplicações de
 * sempre), depois `enriquecerPlanilhaDeItems` com o MESMO arquivo (preenche o
 * que faltava em itens que já existiam de ANTES desta chamada — o item que
 * `importarLote` acabou de criar já nasce com tudo preenchido, então a
 * segunda passada não encontra nada para mudar nele).
 */
export async function classificarArquivoDeImportacao(
  db: Cliente,
  pedido: PedidoDeImportacaoClassificada,
): Promise<ResultadoDaImportacaoClassificada> {
  const resumo = await classificarLinhasParaRelatorio(db, pedido.linhas, {
    arquivoHash: pedido.arquivoHash,
  });

  const pedidoDeLote: PedidoDeImportacao = {
    nome: pedido.nome,
    proveniencia: pedido.proveniencia,
    linhas: pedido.linhas,
    criadoPor: pedido.criadoPor,
    criadoPorUserId: pedido.criadoPorUserId,
    importacaoId: pedido.importacaoId,
    limiteDiario: pedido.limiteDiario,
  };
  const importacao = await importarLote(db, pedidoDeLote);

  const linhasLidas = pedido.linhas.map(linhaDaListaParaLinhaLida);
  const enriquecimento = await enriquecerPlanilhaDeItems(db, linhasLidas, {
    nomeArquivo: pedido.arquivoNome ?? pedido.nome,
    usuario: pedido.criadoPor ?? undefined,
  });

  return { resumo, importacao, enriquecimento };
}
