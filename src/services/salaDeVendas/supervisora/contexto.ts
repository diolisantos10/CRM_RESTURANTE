/**
 * O CONTEXTO DA REVISÃO — o que a Supervisora lê antes de julgar UMA mensagem.
 *
 * ── ⛔ NUNCA A CONVERSA INTEIRA, NUNCA UM SEGUNDO RESUMO ─────────────────────
 *
 * A camada rápida recebe o RESUMO INCREMENTAL (`blocoDeMemoria`, de
 * `ta/memoria.ts`) e não o histórico cru — doutrina explícita da missão: reenviar
 * a conversa inteira a cada mensagem é o que faz o custo da Supervisora crescer
 * com o tamanho da conversa em vez de ficar plano. A memória já existe, já é
 * mantida por `atender.ts` a cada turno, e é construída para exatamente este
 * uso — ler daqui, nunca reextrair.
 *
 * A camada profunda, mais rara e mais cara por natureza, pode olhar os últimos
 * turnos além do resumo — é o que permite ela notar "a mesma pergunta de
 * novo" ou "ele já recusou isso duas mensagens atrás", que um resumo estruturado
 * não guarda bem.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { lerMemoria, blocoDeMemoria, blocoDeConduta } from "../ta/memoria";

type Cliente = PrismaClient | Prisma.TransactionClient;

export interface ContextoDaRevisao {
  ultimaMensagemDoCliente: string | null;
  /** `blocoDeMemoria` + `blocoDeConduta`, prontos para o prompt. */
  resumoIncremental: string;
  etapaDoFunil: string;
  perfilDoLead: string;
  /** Os `proibidos` da versão PUBLICADA do TA. Vazio quando não há versão. */
  regrasComerciais: string[];
  /** Identidade + tom da versão publicada — o que "soar como a marca" quer dizer. */
  tomDaMarca: string;
  /** As últimas avaliações da Supervisora NESTE atendimento — para ela não
   *  repetir o mesmo alerta como se fosse novidade, e para notar padrão. */
  ultimosAlertasDesteAtendimento: string[];
  /** Sinais de código, sem custo de modelo — vêm de `ta/memoria.ts`. */
  irritacaoDoLead: number;
  pediuParar: boolean;
}

/** As últimas N mensagens da conversa, mais antiga primeiro — só para a camada
 *  PROFUNDA. A rápida não recebe isto: ver o cabeçalho do arquivo. */
export async function ultimosTurnos(
  db: Cliente,
  leadId: string,
  take = 12,
): Promise<Array<{ deQuem: "cliente" | "ta"; texto: string }>> {
  const msgs = await db.leadMensagem.findMany({
    where: { leadId, texto: { not: null } },
    orderBy: { ocorreuEm: "desc" },
    take,
    select: { direcao: true, texto: true },
  });

  return msgs
    .reverse()
    .map((m) => ({
      deQuem: m.direcao === "ENTRADA" ? ("cliente" as const) : ("ta" as const),
      texto: m.texto ?? "",
    }))
    .filter((t) => t.texto.trim().length > 0);
}

export async function montarContextoDaRevisao(
  db: Cliente,
  params: { leadId: string; mensagemAvaliadaId?: string | null },
): Promise<ContextoDaRevisao> {
  const [lead, ultimaEntrada, memoria, config, alertas] = await Promise.all([
    db.siteLead.findUnique({
      where: { id: params.leadId },
      select: { nome: true, restaurante: true, tipo: true, stage: true, temperatura: true },
    }),
    db.leadMensagem.findFirst({
      where: { leadId: params.leadId, direcao: "ENTRADA" },
      orderBy: { ocorreuEm: "desc" },
      select: { texto: true },
    }),
    lerMemoria(db, params.leadId),
    db.sdrIaConfig.findUnique({
      where: { slug: "ta" },
      select: { versaoAtiva: { select: { identidade: true, tomDeVoz: true, proibidos: true } } },
    }),
    db.supervisoraAvaliacao.findMany({
      where: {
        leadId: params.leadId,
        ...(params.mensagemAvaliadaId ? { mensagemId: { not: params.mensagemAvaliadaId } } : {}),
      },
      orderBy: { criadaEm: "desc" },
      take: 5,
      select: { veredito: true, motivos: true, motivoDetalhe: true, criadaEm: true },
    }),
  ]);

  const resumo = [blocoDeMemoria(memoria), blocoDeConduta(memoria)].filter(Boolean).join("\n\n");

  const perfil = lead
    ? [lead.restaurante || lead.nome, lead.tipo].filter(Boolean).join(" — ")
    : "(lead não encontrado)";

  const etapa = lead
    ? `etapa: ${lead.stage ?? "não classificada"}; temperatura: ${lead.temperatura ?? "não classificada"}`
    : "não medido";

  return {
    ultimaMensagemDoCliente: ultimaEntrada?.texto ?? null,
    resumoIncremental: resumo,
    etapaDoFunil: etapa,
    perfilDoLead: perfil,
    regrasComerciais: config?.versaoAtiva?.proibidos ?? [],
    tomDaMarca: config?.versaoAtiva
      ? `${config.versaoAtiva.identidade}${config.versaoAtiva.tomDeVoz ? " — tom: " + config.versaoAtiva.tomDeVoz : ""}`
      : "(nenhuma versão publicada do TA — sem tom de marca declarado)",
    ultimosAlertasDesteAtendimento: alertas.map(
      (a) => `${a.veredito} (${a.motivos.join(", ") || "sem motivo nomeado"}): ${a.motivoDetalhe ?? ""}`,
    ),
    // ⚠️ Vem da MEMÓRIA persistida (`ta/memoria.ts`), não recalculado da última
    // mensagem: `memoria.irritacao` já é o máximo acumulado da conversa inteira
    // (só sobe, nunca desce — ver `mesclar` em `memoria.ts`), e é exatamente o
    // detector de irritação/pedido de parar que a missão pede reaproveitar, não
    // um segundo.
    irritacaoDoLead: memoria.irritacao,
    pediuParar: memoria.pediuPararSondagem,
  };
}
