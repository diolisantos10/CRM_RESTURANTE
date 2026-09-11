/**
 * A RETENTATIVA — recuperar um `SiteLead` que nasceu sem nenhuma `LeadMensagem`.
 *
 * ── O DEFEITO QUE ESTE ARQUIVO CONSERTA ─────────────────────────────────────
 *
 * `materializarLead` cria o `SiteLead`; `abordarLead` manda a mensagem. Entre
 * os dois cabe um `"pula"` silencioso (`abordarDaFila.ts`: `portaoRecusou` e
 * `semDadoParaOModelo` são pulados, sem teto, e a rodada termina normal). O
 * resultado medido em produção em 11/09/2026: 20 `SiteLead` materializados,
 * ZERO `LeadMensagem`, ZERO `wamid`, HTTP 200 — e a tela mostra os 20 como
 * "Sem resposta", indistinguível de "abordagem enviada e ainda sem retorno".
 *
 * Materializar sem enviar não pode ficar com a cara de sucesso. Este arquivo
 * dá duas coisas à casa:
 *
 *   1. **A CONSULTA** (`leadsMaterializadosSemMensagem`) — encontra esses
 *      leads, para eles pararem de ser invisíveis.
 *   2. **A RETENTATIVA** (`retentarLeadsMaterializadosSemMensagem`) — manda a
 *      mensagem que faltou, para uma lista EXPLÍCITA de ids. Nunca descobre
 *      um lead novo sozinha: quem chama decide quem entra na lista.
 *
 * ── ⛔ O QUE ISTO NÃO FAZ ────────────────────────────────────────────────────
 *
 * Não reimplementa o envio. A retentativa chama `abordarLead` — a MESMA
 * função de produção, exatamente uma vez por lead — porque duas funções que
 * mandam mensagem em nome da empresa é o próprio defeito que o cabeçalho de
 * `abordar.ts` existe para impedir: *"dois caminhos para falar com estranho é
 * como se perde a conta do que a empresa disse a quem."*
 *
 * Não afrouxa nenhuma trava: o teto do dia (`conferirRitmo`, dentro de
 * `abordarLead`), o portão do lead e a auto-pausa por recusas seguidas da
 * Meta (`reagirA` + `pausarPorRecusasDaMeta`, reaproveitadas de
 * `abordarDaFila.ts`) valem exatamente como valeriam numa rodada normal.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { abordarLead, FONTE_DE_LISTA, type ResultadoDaAbordagem } from "../abordar";
import { reagirA, pausarPorRecusasDaMeta, LIMITE_DE_RECUSAS } from "./abordarDaFila";

type Cliente = PrismaClient | Prisma.TransactionClient;

// ═══════════════════════════════════════════════════════════════════════════
// A CONSULTA — quem está materializado e nunca recebeu mensagem nenhuma.
// ═══════════════════════════════════════════════════════════════════════════

export interface LeadMaterializadoSemMensagem {
  id: string;
  nome: string | null;
  whatsapp: string | null;
  cidade: string | null;
  restaurante: string | null;
  createdAt: Date;
}

/**
 * `SiteLead` de `fonte = LISTA_PROSPECCAO` sem NENHUMA `LeadMensagem` —
 * entrada ou saída, qualquer status. É a assinatura exata do incidente: a
 * ficha existe, e a Sala nunca chegou a escrever nada nela.
 *
 * ⚠️ `mensagens: { none: {} }` é o filtro de relação do próprio Prisma — não
 * um `NOT IN` escrito à mão contra uma subconsulta. É o "join/where" que a
 * missão pediu, com o Prisma fazendo o SQL, não uma segunda leitura da mesma
 * pergunta.
 *
 * `ids` é opcional e filtra por `id: { in: ids } ` quando presente — a mesma
 * forma que `retentarLeadsMaterializadosSemMensagem` exige de quem a chama:
 * uma lista explícita, nunca um `findMany` aberto sobre a base inteira.
 */
export async function leadsMaterializadosSemMensagem(
  db: Cliente,
  params: { ids?: string[] } = {},
): Promise<LeadMaterializadoSemMensagem[]> {
  return db.siteLead.findMany({
    where: {
      fonte: FONTE_DE_LISTA,
      mensagens: { none: {} },
      ...(params.ids ? { id: { in: params.ids } } : {}),
    },
    select: { id: true, nome: true, whatsapp: true, cidade: true, restaurante: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// A RETENTATIVA — envia o que faltou, uma vez por lead, escopada à lista.
// ═══════════════════════════════════════════════════════════════════════════

/** Os motivos de `abordarLead`, sem repetir a lista à mão. */
type MotivoDaAbordagem = Extract<ResultadoDaAbordagem, { abordou: false }>["motivo"];

export type ResultadoDoLeadNaRetentativa =
  | { leadId: string; enviado: true; mensagemId: string; wamid: string | null }
  | {
      leadId: string;
      enviado: false;
      motivo:
        /** O id não estava na lista recebida. Não deveria ser alcançável — é a defesa (a). */
        | "foraDoEscopo"
        | "leadNaoExiste"
        /** O lead existe, mas não é `LISTA_PROSPECCAO` — esta retentativa só recupera prospecção fria. */
        | "fonteInvalida"
        /** Idempotência: já existe `LeadMensagem` confirmada para este lead. Nada foi reenviado. */
        | "jaEnviado"
        | MotivoDaAbordagem;
      detalhe: string;
    };

export interface ResultadoDaRetentativaEmLote {
  resultados: ResultadoDoLeadNaRetentativa[];
  /**
   * `listaAcabou` = todos os ids foram processados. `ritmo` = o teto do
   * dia/24h bateu no meio da lista, e o resto foi deixado de fora — tentar o
   * próximo bateria na mesma parede. `recusasDaMeta` = a auto-pausa disparou.
   * `falha` = o caminho quebrou por razão nossa (banco, lead sumiu no meio).
   */
  parouPor: "listaAcabou" | "ritmo" | "recusasDaMeta" | "falha";
}

/**
 * Manda a mensagem que faltou, para cada lead da lista — e só para eles.
 *
 * ── A ORDEM, POR LEAD, E POR QUÊ ────────────────────────────────────────────
 *
 *   (a) o id está LITERALMENTE na lista recebida — defesa contra o chamador
 *       errado. Redundante com o `for` que só percorre `params.leadIds`, e
 *       de propósito: se algum dia este laço passar a ler de outro lugar
 *       (uma consulta, um cache), a trava continua de pé sozinha.
 *   (b) o lead existe e é `fonte = LISTA_PROSPECCAO` — esta retentativa não
 *       é um segundo caminho de envio para lead de formulário.
 *   (c) NÃO existe `LeadMensagem` já confirmada (`ENVIADA`, `ENTREGUE` ou
 *       `LIDA`) para ele — idempotência: rodar esta função duas vezes sobre
 *       a mesma lista nunca duplica um envio que já saiu.
 *   (d) `abordarLead` — a MESMA função de produção — exatamente uma vez.
 *
 * ── A AUTO-PAUSA, REAPROVEITADA E NÃO REINVENTADA ───────────────────────────
 *
 * `reagirA` classifica o motivo de cada recusa; `pausarPorRecusasDaMeta`
 * grava a pausa persistente depois de `LIMITE_DE_RECUSAS` recusas seguidas da
 * Meta. São as MESMAS funções de `abordarDaFila.ts` — uma segunda regra de
 * limite aqui divergiria da primeira no dia em que uma delas mudasse.
 */
export async function retentarLeadsMaterializadosSemMensagem(
  db: Cliente,
  params: {
    leadIds: string[];
    autor: "HUMANO" | "SISTEMA";
    autorUserId: string;
    agora?: Date;
  },
): Promise<ResultadoDaRetentativaEmLote> {
  const agora = params.agora ?? new Date();
  const permitidos = new Set(params.leadIds);
  const resultados: ResultadoDoLeadNaRetentativa[] = [];
  /** Recusas da Meta em sequência. Zera a cada envio que dá certo. */
  let recusasSeguidas = 0;

  for (const leadId of params.leadIds) {
    // (a) defesa: só processa o que está literalmente na lista recebida.
    if (!permitidos.has(leadId)) {
      resultados.push({ leadId, enviado: false, motivo: "foraDoEscopo", detalhe: "id fora da lista recebida" });
      continue;
    }

    // (b) o lead existe e é da prospecção fria.
    const lead = await db.siteLead.findUnique({
      where: { id: leadId },
      select: { id: true, fonte: true },
    });

    if (!lead) {
      resultados.push({ leadId, enviado: false, motivo: "leadNaoExiste", detalhe: leadId });
      continue;
    }

    if (lead.fonte !== FONTE_DE_LISTA) {
      resultados.push({
        leadId,
        enviado: false,
        motivo: "fonteInvalida",
        detalhe:
          `este lead é fonte=${lead.fonte ?? "desconhecida"}, não ${FONTE_DE_LISTA} — ` +
          "a retentativa só recupera prospecção fria",
      });
      continue;
    }

    // (c) idempotência — já existe uma LeadMensagem CONFIRMADA para ele?
    const jaConfirmada = await db.leadMensagem.findFirst({
      where: { leadId, direcao: "SAIDA", status: { in: ["ENVIADA", "ENTREGUE", "LIDA"] } },
      select: { id: true, waMessageId: true },
      orderBy: { ocorreuEm: "desc" },
    });

    if (jaConfirmada) {
      resultados.push({
        leadId,
        enviado: true,
        mensagemId: jaConfirmada.id,
        wamid: jaConfirmada.waMessageId,
      });
      continue;
    }

    // (d) a MESMA função de produção, exatamente uma vez.
    const r = await abordarLead(db, {
      leadId,
      autor: params.autor,
      autorUserId: params.autorUserId,
      agora,
    });

    if (r.abordou) {
      recusasSeguidas = 0;
      // `abordarLead` não devolve o `wamid` — ele foi gravado na linha por
      // `confirmarEnvio`. Lido de volta, e não inventado, é o único jeito
      // honesto de mostrar o id real da Meta a quem chamou a retentativa.
      const linha = await db.leadMensagem.findUnique({
        where: { id: r.mensagemId },
        select: { waMessageId: true },
      });
      resultados.push({ leadId, enviado: true, mensagemId: r.mensagemId, wamid: linha?.waMessageId ?? null });
      continue;
    }

    resultados.push({ leadId, enviado: false, motivo: r.motivo, detalhe: r.detalhe });

    const reacao = reagirA(r.motivo);

    if (reacao === "encerra") {
      // O freio do dia/hora. Tentar o próximo bateria na mesma parede.
      return { resultados, parouPor: "ritmo" };
    }

    if (reacao === "pulaComLimite") {
      recusasSeguidas += 1;
      if (recusasSeguidas >= LIMITE_DE_RECUSAS) {
        await pausarPorRecusasDaMeta(db, {
          agora,
          recusasSeguidas,
          itemId: leadId,
          detalhe: r.detalhe,
          abordadosAntes: resultados.filter((x) => x.enviado).length,
        });
        return { resultados, parouPor: "recusasDaMeta" };
      }
      continue;
    }

    if (reacao === "falha") {
      // O caminho está quebrado por razão nossa (banco, lead que sumiu no
      // meio da lista). Para aqui, como a fila normal faria.
      return { resultados, parouPor: "falha" };
    }

    // "pula" — o portão fazendo o trabalho dele (opt-out, falta de dado para
    // o modelo). É uma linha ruim da lista, não um defeito: os demais ids da
    // lista continuam sendo tentados.
  }

  return { resultados, parouPor: "listaAcabou" };
}
