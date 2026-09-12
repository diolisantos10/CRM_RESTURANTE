/**
 * OS MODELOS DA SALA, LIDOS DA META E **GRAVADOS** — o retrato que sobrevive à
 * requisição que o buscou.
 *
 * ── O DEFEITO QUE ESTE ARQUIVO EXISTE PARA MATAR ────────────────────────────
 *
 * O lado dos restaurantes já resolvia isto direito: `MetaTemplateService.syncFromMeta`
 * varre `/{waba}/message_templates`, **pagina**, conta as variáveis do corpo e
 * **persiste** em `MetaMessageTemplate`. O lado comercial reimplementou pior —
 * `listarModelosDeVendas` lê **uma página só** (`limit=200`) e **não guarda
 * nada** — e, pior que isso, a quantidade de variáveis do modelo era declarada
 * à mão numa variável de ambiente (`FOOCCI_SDR_MODELO_VARIAVEIS`).
 *
 * Ou seja: pedia-se a uma pessoa que digitasse um número que a API da Meta
 * responde de graça, e o valor digitado envelhecia em silêncio no dia em que
 * alguém aprovasse outro modelo. O preço do envelhecer é 100% de recusa na
 * rodada seguinte, descoberta contato a contato.
 *
 * ── O QUE ESTE ARQUIVO FAZ, E O QUE NÃO FAZ ─────────────────────────────────
 *
 * Faz duas coisas: varrer a conta da Sala na Meta e espelhar o resultado em
 * `ModeloDeVendas`; e responder, do banco, qual é o modelo aprovado de um nome.
 *
 * Não escreve nada na Meta, não cria modelo, não envia mensagem.
 *
 * 🔒 O token vai no cabeçalho e não sai em nenhum retorno.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { metaGraphUrl } from "@/services/whatsapp/metaFlag";
import { maskGraphResponse } from "@/services/whatsapp/providers/metaPayload";
import { countBodyVariables } from "@/services/whatsapp/MetaTemplateService";
import { foocciSalesPhoneNumberId, comOTokenDeVendas } from "./FoocciSalesChannel";
import { contaDoNumeroDeVendas, graphAbsoluto, ehFalha } from "./modelosDaMeta";

type Cliente = PrismaClient | Prisma.TransactionClient;

/**
 * Teto de páginas, igual ao do lado restaurante.
 *
 * Não é medo de laço infinito: é o custo de uma conta grande travar a rota que
 * a pessoa acabou de clicar. Estourar o teto **não** vira erro — vira varredura
 * incompleta, e a incompletude tem consequência declarada logo abaixo.
 */
const TETO_DE_PAGINAS = 10;

export interface ModeloSincronizado {
  nome: string;
  idioma: string;
  categoria: string | null;
  situacao: string;
  variaveis: number;
  corpo: string | null;
  /**
   * ⭐ A AUTORIZAÇÃO INTERNA, 12/09/2026 — separada do `situacao` da Meta.
   * `@default(true)` no schema; `false` só quando alguém marcou à mão. Ver o
   * comentário grande em `ModeloDeVendas.autorizado`.
   */
  autorizado: boolean;
}

export interface SincronizacaoDeModelos {
  ok: boolean;
  /** Quantos modelos a Meta devolveu e nós gravamos. */
  sincronizados: number;
  /** Quantos APROVADOS sumiram da Meta e foram rebaixados a `MISSING`. */
  sumiram: number;
  /** A varredura chegou ao fim? Falso quando a paginação foi truncada. */
  completa: boolean;
  wabaId: string | null;
  /** Motivo real e mascarado. Nunca um booleano mudo. */
  erro?: string;
}

/**
 * O texto do CORPO do modelo aprovado — o que o lead vai receber, palavra por
 * palavra.
 *
 * Gravado porque a tela precisa mostrá-lo: quem opera não tem acesso ao painel
 * da Meta, e "modelo `foocci_abordagem_v1`, 1 variável" não diz a ninguém o que
 * está sendo dito em nome da empresa. Um nome de modelo não é uma frase.
 */
export function corpoDoModelo(components: unknown): string | null {
  if (!Array.isArray(components)) return null;
  const body = components.find(
    (c) => String((c as { type?: unknown })?.type).toUpperCase() === "BODY",
  );
  const texto = (body as { text?: unknown })?.text;
  const limpo = texto != null ? String(texto).trim() : "";
  return limpo ? limpo : null;
}

/**
 * ⭐ A VARREDURA, COM O TOKEN NA MÃO — testável sem ambiente.
 *
 * `sincronizarModelosDeVendas` é a versão que a produção usa; esta recebe o
 * token para que o teste possa medir paginação e reconciliação sem precisar de
 * credencial. Mesma divisão de `conferirModeloDeAbordagem` / `preVooDoModelo`.
 */
export async function sincronizarComToken(
  db: Cliente,
  token: string,
  opts: { agora?: Date } = {},
): Promise<SincronizacaoDeModelos> {
  const agora = opts.agora ?? new Date();

  const phoneNumberId = foocciSalesPhoneNumberId();
  if (!phoneNumberId) {
    return {
      ok: false,
      sincronizados: 0,
      sumiram: 0,
      completa: false,
      wabaId: null,
      erro: "FOOCCI_SALES_PHONE_NUMBER_ID não está no ambiente",
    };
  }

  // A conta vem pelo caminho que JÁ existe — webhook aprendido, variável, o
  // próprio número, o token, o negócio. Reimplementar a descoberta aqui criaria
  // uma segunda opinião sobre de qual conta os modelos vêm, e as duas
  // discordariam no dia em que uma delas fosse corrigida.
  const conta = await contaDoNumeroDeVendas(token);
  if (!conta.ok) {
    return {
      ok: false,
      sincronizados: 0,
      sumiram: 0,
      completa: false,
      wabaId: null,
      erro: conta.erro,
    };
  }

  let url: string | null = metaGraphUrl(
    `${conta.wabaId}/message_templates` +
      `?fields=id,name,language,category,status,components,rejected_reason&limit=100`,
  );

  let sincronizados = 0;
  let paginas = 0;
  /** Tudo que a Meta CONFIRMOU existir nesta varredura, por nome+idioma. */
  const vistos = new Set<string>();
  /**
   * ⛔ Paginação truncada NÃO é varredura completa.
   *
   * Sem esta bandeira, uma conta com mais modelos do que o teto de páginas
   * alcança veria o resto virar "não existe na Meta" — e um modelo bom, em uso,
   * seria rebaixado a `MISSING`, travando o envio de uma abordagem que
   * funcionava. Meia-leitura não pode virar afirmação (guardrail 1).
   */
  let completa = true;

  try {
    while (url && paginas < TETO_DE_PAGINAS) {
      const pagina: unknown = await graphAbsoluto(url, token);
      if (ehFalha(pagina)) {
        // ⚠️ Erro no meio da paginação devolve CEDO e sem reconciliar. O que já
        // foi gravado vale (é o que a Meta confirmou); o que não foi lido
        // continua sem opinião nossa.
        return {
          ok: false,
          sincronizados,
          sumiram: 0,
          completa: false,
          wabaId: conta.wabaId,
          erro: pagina.erro,
        };
      }

      const data = (pagina as { data?: unknown }).data;
      const linhas = Array.isArray(data) ? data : [];

      for (const t of linhas) {
        const tpl = t as {
          id?: unknown;
          name?: unknown;
          language?: unknown;
          category?: unknown;
          status?: unknown;
          components?: unknown;
          rejected_reason?: unknown;
        };
        if (!tpl.name) continue;

        const nome = String(tpl.name);
        const idioma = String(tpl.language ?? "pt_BR");
        const situacao = String(tpl.status ?? "UNKNOWN").toUpperCase();
        const motivo = tpl.rejected_reason != null ? String(tpl.rejected_reason) : "";

        await db.modeloDeVendas.upsert({
          where: { phoneNumberId_nome_idioma: { phoneNumberId, nome, idioma } },
          create: {
            phoneNumberId,
            wabaId: conta.wabaId,
            nome,
            idioma,
            categoria: tpl.category != null ? String(tpl.category).toUpperCase() : null,
            situacao,
            // ⭐ O número que antes era digitado à mão, agora contado do corpo
            // real — e pela MESMA função do lado restaurante. Uma segunda
            // contagem do mesmo `{{1}}` discordaria da primeira no dia em que
            // aparecesse variável no cabeçalho.
            variaveis: countBodyVariables(tpl.components),
            metaTemplateId: tpl.id != null ? String(tpl.id) : null,
            motivoDaRecusa:
              situacao === "REJECTED" ? (motivo && motivo !== "NONE" ? motivo : "Rejeitado pela Meta") : null,
            corpo: corpoDoModelo(tpl.components),
            sincronizadoEm: agora,
          },
          update: {
            // O WABA entra no update também: a conta pode ter mudado, e uma
            // linha carimbada com a conta antiga mentiria sobre a origem.
            wabaId: conta.wabaId,
            categoria: tpl.category != null ? String(tpl.category).toUpperCase() : null,
            situacao,
            variaveis: countBodyVariables(tpl.components),
            metaTemplateId: tpl.id != null ? String(tpl.id) : null,
            // Motivo de recusa é LIMPO quando o modelo deixa de estar rejeitado:
            // um reenvio corrigido que continuasse exibindo a recusa antiga
            // mandaria alguém consertar um texto que já está bom.
            motivoDaRecusa:
              situacao === "REJECTED" ? (motivo && motivo !== "NONE" ? motivo : "Rejeitado pela Meta") : null,
            corpo: corpoDoModelo(tpl.components),
            sincronizadoEm: agora,
          },
        });

        vistos.add(chave(nome, idioma));
        sincronizados++;
      }

      url = (pagina as { paging?: { next?: unknown } }).paging?.next != null
        ? String((pagina as { paging?: { next?: unknown } }).paging?.next)
        : null;
      paginas++;
      if (url && paginas >= TETO_DE_PAGINAS) completa = false;
    }

    const sumiram = completa
      ? await rebaixarOsQueSumiram(db, phoneNumberId, vistos)
      : 0;

    return { ok: true, sincronizados, sumiram, completa, wabaId: conta.wabaId };
  } catch (e) {
    return {
      ok: false,
      sincronizados,
      sumiram: 0,
      completa: false,
      wabaId: conta.wabaId,
      erro: maskGraphResponse(e instanceof Error ? e.message : String(e)),
    };
  }
}

/**
 * ⭐ A VARREDURA COMO A PRODUÇÃO A CHAMA — o token vem emprestado e não passa
 * pelas mãos de ninguém.
 *
 * ⚠️ Sem token a resposta é uma FALHA declarada, e não "sincronizei zero". Zero
 * modelos e "não consegui perguntar" são estados diferentes: o primeiro manda
 * criar modelo na Meta, o segundo manda colar a credencial.
 */
export function sincronizarModelosDeVendas(
  db: Cliente,
  opts: { agora?: Date } = {},
): Promise<SincronizacaoDeModelos> {
  return comOTokenDeVendas<SincronizacaoDeModelos>(
    (token) => sincronizarComToken(db, token, opts),
    () => ({
      ok: false,
      sincronizados: 0,
      sumiram: 0,
      completa: false,
      wabaId: null,
      erro: "FOOCCI_SALES_ACCESS_TOKEN não está no ambiente",
    }),
  );
}

const chave = (nome: string, idioma: string) => `${nome} ${idioma}`;

/**
 * Rebaixa para `MISSING` todo modelo `APPROVED` que a varredura COMPLETA não
 * devolveu — ele não existe mais na conta que envia hoje.
 *
 * ── AS DUAS CAUTELAS, COPIADAS DE `reconcileMissing` ────────────────────────
 *
 *   1. **Só roda em varredura completa** (a decisão é de quem chama). Rebaixar
 *      por leitura truncada apagaria um modelo bom e travaria a abordagem.
 *   2. **Só rebaixa `APPROVED`.** É o único estado que (a) destrava envio e
 *      (b) faz o sistema AFIRMAR algo a quem opera. `PENDING` e `REJECTED` já
 *      são honestos por natureza, e mexer neles brigaria com um modelo recém
 *      submetido que a listagem da Meta ainda não pegou.
 *
 * `MISSING` é estado próprio de propósito, e não `REJECTED`: a Meta não
 * reprovou nada, ela simplesmente não conhece este modelo aqui. Dizer
 * "rejeitado" mandaria alguém corrigir um texto que não tem defeito.
 *
 * ⚠️ O `where` é preso ao `phoneNumberId` da varredura. Sem isso, sincronizar a
 * Sala rebaixaria os modelos de qualquer outro número gravado na mesma tabela.
 */
export async function rebaixarOsQueSumiram(
  db: Cliente,
  phoneNumberId: string,
  vistos: Set<string>,
): Promise<number> {
  const aprovados = await db.modeloDeVendas.findMany({
    where: { phoneNumberId, situacao: "APPROVED" },
    select: { id: true, nome: true, idioma: true },
  });

  const orfaos = aprovados.filter(
    (m: { id: string; nome: string; idioma: string }) => !vistos.has(chave(m.nome, m.idioma)),
  );
  if (orfaos.length === 0) return 0;

  await db.modeloDeVendas.updateMany({
    where: { id: { in: orfaos.map((m: { id: string }) => m.id) } },
    data: { situacao: "MISSING" },
  });
  return orfaos.length;
}

/**
 * O modelo APROVADO da Sala, lido do banco.
 *
 * ── POR QUE LER DO BANCO, E NÃO DA META ─────────────────────────────────────
 *
 * Esta pergunta é feita no caminho do envio, contato a contato. Batendo na Meta
 * a cada lead, uma rodada de 2.000 abordagens vira 2.000 consultas a mais — e o
 * dia em que a Graph ficar lenta, a rodada inteira para por causa de um dado
 * que não muda entre um contato e o seguinte.
 *
 * ⚠️ `null` quando não há linha, quando o modelo não está aprovado, ou quando o
 * número de vendas não está configurado. Nunca um palpite: quem chama tem uma
 * reserva declarada para seguir, e um chute aqui mudaria o formato do que sai.
 */
export async function modeloAprovadoDaSala(
  db: unknown,
  nome: string,
  idioma: string,
): Promise<ModeloSincronizado | null> {
  const phoneNumberId = foocciSalesPhoneNumberId();
  if (!phoneNumberId || !nome) return null;

  const cliente = (db ?? (await import("@/lib/prisma")).prisma) as Cliente;

  const linha = await cliente.modeloDeVendas.findUnique({
    where: { phoneNumberId_nome_idioma: { phoneNumberId, nome, idioma } },
    select: {
      nome: true,
      idioma: true,
      categoria: true,
      situacao: true,
      variaveis: true,
      corpo: true,
      autorizado: true,
    },
  });

  if (!linha || linha.situacao !== "APPROVED") return null;
  return linha;
}

/** Todos os modelos gravados do número de vendas, para a tela e a rota. */
export async function modelosSincronizadosDaSala(db?: unknown): Promise<ModeloSincronizado[]> {
  const phoneNumberId = foocciSalesPhoneNumberId();
  if (!phoneNumberId) return [];

  const cliente = (db ?? (await import("@/lib/prisma")).prisma) as Cliente;

  return cliente.modeloDeVendas.findMany({
    where: { phoneNumberId },
    orderBy: [{ situacao: "asc" }, { nome: "asc" }],
    select: {
      nome: true,
      idioma: true,
      categoria: true,
      situacao: true,
      variaveis: true,
      corpo: true,
      autorizado: true,
    },
  });
}
