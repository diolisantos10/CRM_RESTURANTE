/**
 * FoocciCrmService — a base de prospects DA FOOCCI (não a do restaurante).
 *
 * ⚠️ Leia o aviso no topo de `foocciCrmFunnel.ts` antes de mexer aqui. Este
 * diretório NÃO tem `restaurantId` e nunca vai ter: são donos de restaurante que
 * a Foocci quer vender, não clientes de um lojista. Cruzar as duas bases seria
 * vazamento entre a Foocci e um tenant.
 *
 * O QUE ESTE SERVIÇO GARANTE:
 *
 *  1. **Nenhuma mudança de etapa sem registro.** `moverEtapa` escreve o estado e
 *     a interação na MESMA transação. Não existe caminho no código que mude
 *     `stage` sem gerar histórico — é a trava, não o combinado.
 *  2. **O histórico é append-only.** Nada aqui faz update ou delete de interação.
 *     O único apagamento é em cascata, quando o contato inteiro é excluído.
 *  3. **`actor` é obrigatório.** Quem mudou faz parte do fato. Uma etapa sem
 *     autor é uma etapa que ninguém responde por — e daqui a pouco o agente SDR
 *     também escreve aqui, então saber "foi o robô ou foi o CEO" deixa de ser
 *     detalhe.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
  type FoocciLeadStage,
  type FoocciInteractionType,
  type TipoDeInteracao,
  contaComoAbordagem,
  podeMover,
  indiceEtapa,
} from "./foocciCrmFunnel";
import { normalizaWhatsapp, rotuloDaOrigem, canalDoContato, linkWhatsapp } from "./leadOrigin";
import { pediuSilencio } from "@/services/foocci-sdr/LeadContactSafety";
import { extractLeadCode, LEAD_CODE_LEN } from "@/lib/site/leadCode";

/** Quem pode aparecer como autor. Texto livre viraria "admin"/"Admin"/"adm". */
export type FoocciCrmActor = "admin" | "sistema" | "sdr-agent";

const MAX_NOTA = 1000;

function limpaNota(nota?: string | null): string | null {
  if (typeof nota !== "string") return null;
  const t = nota.trim().slice(0, MAX_NOTA);
  return t === "" ? null : t;
}

// ── Escrita ───────────────────────────────────────────────────────────────────

export interface MoverEtapaInput {
  leadId: string;
  para: FoocciLeadStage;
  actor: FoocciCrmActor;
  nota?: string | null;
}

export interface MoverEtapaResultado {
  ok: boolean;
  erro?: string;
  de?: FoocciLeadStage;
  para?: FoocciLeadStage;
  em?: Date;
}

/**
 * Move o contato de etapa E registra quem fez, quando e por quê — atômico.
 *
 * A transação não é zelo decorativo: se o update passasse e a interação
 * falhasse, o funil mostraria um contato em "Fechado" que ninguém fechou, e o
 * histórico — que é a fonte da verdade da etapa — não teria como corrigir.
 */
export async function moverEtapa(input: MoverEtapaInput): Promise<MoverEtapaResultado> {
  const lead = await prisma.siteLead.findUnique({
    where: { id: input.leadId },
    select: { id: true, stage: true },
  });
  if (!lead) return { ok: false, erro: "Contato não encontrado." };

  const de = lead.stage as FoocciLeadStage;
  if (!podeMover(de, input.para)) {
    return {
      ok: false,
      erro: de === input.para
        ? "O contato já está nesta etapa."
        : "Etapa inválida.",
    };
  }

  const agora = new Date();

  await prisma.$transaction([
    prisma.siteLead.update({
      where: { id: lead.id },
      data: {
        stage: input.para,
        stageChangedAt: agora,
        stageChangedBy: input.actor,
        lastInteractionAt: agora,
      },
    }),
    prisma.siteLeadInteraction.create({
      data: {
        leadId: lead.id,
        tipo: "MUDANCA_ETAPA",
        fromStage: de,
        toStage: input.para,
        actor: input.actor,
        nota: limpaNota(input.nota),
        createdAt: agora,
      },
    }),
  ]);

  return { ok: true, de, para: input.para, em: agora };
}

export interface RegistrarInteracaoInput {
  leadId: string;
  tipo: Exclude<FoocciInteractionType, "MUDANCA_ETAPA">;
  actor: FoocciCrmActor;
  nota?: string | null;
}

/**
 * Registra o que aconteceu com o contato sem mexer na etapa.
 *
 * É por aqui que o agente SDR vai dizer "mandei mensagem" e "ele respondeu".
 * Interação de SAÍDA move `lastContactedAt`, que é o que tira o contato da fila
 * de "ainda não abordados". Uma anotação interna não pode fazer isso — senão o
 * SDR "perde" gente que nunca recebeu mensagem nenhuma.
 */
export async function registrarInteracao(
  input: RegistrarInteracaoInput,
): Promise<{ ok: boolean; erro?: string; em?: Date }> {
  const lead = await prisma.siteLead.findUnique({
    where: { id: input.leadId },
    select: { id: true },
  });
  if (!lead) return { ok: false, erro: "Contato não encontrado." };

  const agora = new Date();
  const abordagem = contaComoAbordagem(input.tipo);

  await prisma.$transaction([
    prisma.siteLeadInteraction.create({
      data: {
        leadId: lead.id,
        tipo: input.tipo,
        actor: input.actor,
        nota: limpaNota(input.nota),
        createdAt: agora,
      },
    }),
    prisma.siteLead.update({
      where: { id: lead.id },
      data: {
        lastInteractionAt: agora,
        ...(abordagem ? { lastContactedAt: agora } : {}),
      },
    }),
  ]);

  return { ok: true, em: agora };
}

/**
 * Exclusão definitiva de um contato (LGPD, direito de eliminação — e o lead de
 * teste do CEO). Cascata apaga o histórico junto: guardar a linha do tempo de
 * alguém que pediu para sair seria manter o dado pessoal por outro nome.
 */
export async function excluirContato(leadId: string): Promise<{ ok: boolean; erro?: string }> {
  try {
    await prisma.siteLead.delete({ where: { id: leadId } });
    return { ok: true };
  } catch {
    return { ok: false, erro: "Contato não encontrado." };
  }
}

// ── Leitura ───────────────────────────────────────────────────────────────────

export interface ListarContatosFiltro {
  /** Etapa exata. Omitido = todas. */
  stage?: FoocciLeadStage;
  /** true = só quem a Foocci ainda não abordou (a fila do SDR). */
  somenteNaoAbordados?: boolean;
  /** Busca por nome, restaurante, cidade ou telefone. */
  busca?: string;
  de?: Date;
  ate?: Date;
  limite?: number;
}

export interface ContatoResumo {
  id: string;
  nome: string;
  /**
   * Código curto que viaja na mensagem do WhatsApp (`#A7K2M`). É por ele que um
   * "oi" que chega solto vira ESTE contato — por isso a busca também aceita ele.
   */
  codigo: string | null;
  whatsapp: string;
  /**
   * ⚠️ `null` QUANDO A PESSOA PEDIU SILÊNCIO — e a nulidade é a trava, não o aviso.
   *
   * A tela já sabia tratar `null` (mostra o número sem link). Zerar aqui fecha o
   * caminho no servidor: nenhuma tela futura consegue oferecer o clique, nem por
   * esquecimento. Prompt é aviso; código é trava (guardrail 4).
   */
  whatsappLink: string | null;
  /** Pediu para não receber mensagem. Definitivo, por qualquer canal. */
  pediuSilencio: boolean;
  restaurante: string | null;
  cidade: string | null;
  tipo: string | null;
  desafio: string | null;
  stage: FoocciLeadStage;
  stageChangedAt: Date;
  stageChangedBy: string | null;
  origemRotulo: string;
  canal: string;
  utmCampaign: string | null;
  createdAt: Date;
  lastContactedAt: Date | null;
  lastInteractionAt: Date | null;
  submissions: number;
  /** Aviso por e-mail: só conveniência. O cofre é esta base. */
  notifiedAt: Date | null;
  notifyError: string | null;
  interacoes: number;
}

export async function listarContatos(f: ListarContatosFiltro = {}): Promise<ContatoResumo[]> {
  const where: Prisma.SiteLeadWhereInput = {};

  if (f.stage) where.stage = f.stage;
  if (f.somenteNaoAbordados) where.lastContactedAt = null;
  if (f.de || f.ate) where.createdAt = { ...(f.de && { gte: f.de }), ...(f.ate && { lt: f.ate }) };

  const busca = f.busca?.trim();
  if (busca) {
    const digitos = busca.replace(/\D/g, "");
    // O código pode ser colado com `#` ou sem, e o teclado do celular capitaliza
    // sozinho — quem atende cola o que chegou no WhatsApp, não o que é bonito.
    const codigo = extractLeadCode(busca) ?? busca.replace(/^#/, "").toUpperCase();
    where.OR = [
      { nome:        { contains: busca, mode: "insensitive" } },
      { restaurante: { contains: busca, mode: "insensitive" } },
      { cidade:      { contains: busca, mode: "insensitive" } },
      ...(codigo.length === LEAD_CODE_LEN ? [{ codigo }] : []),
      ...(digitos.length >= 4 ? [{ whatsappDigits: { contains: digitos } }] : []),
    ];
  }

  const leads = await prisma.siteLead.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(f.limite ?? 300, 1000),
    include: { _count: { select: { interactions: true } } },
  });

  return leads.map((l) => ({
    id: l.id,
    nome: l.nome,
    codigo: l.codigo,
    whatsapp: l.whatsapp,
    whatsappLink: pediuSilencio(l.optOutAt) ? null : linkWhatsapp(l.whatsapp),
    pediuSilencio: pediuSilencio(l.optOutAt),
    restaurante: l.restaurante,
    cidade: l.cidade,
    tipo: l.tipo,
    desafio: l.desafio,
    stage: l.stage as FoocciLeadStage,
    stageChangedAt: l.stageChangedAt,
    stageChangedBy: l.stageChangedBy,
    origemRotulo: rotuloDaOrigem(l),
    canal: canalDoContato(l),
    utmCampaign: l.utmCampaign,
    createdAt: l.createdAt,
    lastContactedAt: l.lastContactedAt,
    lastInteractionAt: l.lastInteractionAt,
    submissions: l.submissions,
    notifiedAt: l.notifiedAt,
    notifyError: l.notifyError,
    interacoes: l._count.interactions,
  }));
}

export interface InteracaoResumo {
  id: string;
  /**
   * ⚠️ `TipoDeInteracao`, e não `FoocciInteractionType`: aqui se LÊ o que está
   * gravado, e o banco grava doze tipos. Até 07/09/2026 este campo declarava o
   * subconjunto de oito que a tela do admin escreve, e o `as` logo abaixo calava
   * o compilador. O preço apareceu na tela: os quatro tipos da Sala de Vendas
   * não achavam rótulo, e o histórico mostrava a linha em branco.
   */
  tipo: TipoDeInteracao;
  fromStage: FoocciLeadStage | null;
  toStage: FoocciLeadStage | null;
  actor: string;
  nota: string | null;
  createdAt: Date;
}

/**
 * O DOSSIÊ — tudo que se sabe sobre um contato, num objeto só.
 *
 * ⭐ **ESTE É O PONTO DE INTEGRAÇÃO DO AGENTE SDR.** Quando o agente nascer, ele
 * chama isto (ou `GET /api/admin/foocci-crm/contatos/[id]`) para montar a
 * abordagem, e escreve de volta com `registrarInteracao` / `moverEtapa`. Nada
 * mais precisa ser construído do lado do dado — ver `docs/crm-foocci.md`.
 *
 * O campo `historico` já vem em ordem cronológica: o agente lê a última linha
 * para saber se alguém já falou com essa pessoa, exatamente como uma campanha do
 * CRM do produto lê o `CRMContactLedger` antes de enviar.
 */
export interface DossieContato extends ContatoResumo {
  /** Origem crua, para quem quiser reagrupar sem depender do rótulo. */
  origem: {
    legado: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmTerm: string | null;
    clickId: string | null;
    landingPath: string | null;
    referrer: string | null;
    canal: string;
    rotulo: string;
  };
  /** O que a pessoa respondeu no formulário, em linguagem de gente. */
  respostas: Array<{ pergunta: string; resposta: string }>;
  historico: InteracaoResumo[];
}

export async function getDossie(leadId: string): Promise<DossieContato | null> {
  const l = await prisma.siteLead.findUnique({
    where: { id: leadId },
    include: {
      interactions: { orderBy: { createdAt: "asc" } },
      _count: { select: { interactions: true } },
    },
  });
  if (!l) return null;

  const respostas: Array<{ pergunta: string; resposta: string }> = [];
  if (l.restaurante) respostas.push({ pergunta: "Nome do restaurante", resposta: l.restaurante });
  if (l.cidade)      respostas.push({ pergunta: "Cidade",              resposta: l.cidade });
  if (l.tipo)        respostas.push({ pergunta: "Tipo de restaurante", resposta: l.tipo });
  if (l.desafio)     respostas.push({ pergunta: "Principal desafio",   resposta: l.desafio });

  return {
    id: l.id,
    nome: l.nome,
    codigo: l.codigo,
    whatsapp: l.whatsapp,
    whatsappLink: pediuSilencio(l.optOutAt) ? null : linkWhatsapp(l.whatsapp),
    pediuSilencio: pediuSilencio(l.optOutAt),
    restaurante: l.restaurante,
    cidade: l.cidade,
    tipo: l.tipo,
    desafio: l.desafio,
    stage: l.stage as FoocciLeadStage,
    stageChangedAt: l.stageChangedAt,
    stageChangedBy: l.stageChangedBy,
    origemRotulo: rotuloDaOrigem(l),
    canal: canalDoContato(l),
    utmCampaign: l.utmCampaign,
    createdAt: l.createdAt,
    lastContactedAt: l.lastContactedAt,
    lastInteractionAt: l.lastInteractionAt,
    submissions: l.submissions,
    notifiedAt: l.notifiedAt,
    notifyError: l.notifyError,
    interacoes: l._count.interactions,
    origem: {
      legado: l.origem,
      utmSource: l.utmSource,
      utmMedium: l.utmMedium,
      utmCampaign: l.utmCampaign,
      utmContent: l.utmContent,
      utmTerm: l.utmTerm,
      clickId: l.clickId,
      landingPath: l.landingPath,
      referrer: l.referrer,
      canal: canalDoContato(l),
      rotulo: rotuloDaOrigem(l),
    },
    respostas,
    historico: l.interactions.map((i) => ({
      id: i.id,
      tipo: i.tipo as TipoDeInteracao,
      fromStage: i.fromStage as FoocciLeadStage | null,
      toStage: i.toStage as FoocciLeadStage | null,
      actor: i.actor,
      nota: i.nota,
      createdAt: i.createdAt,
    })),
  };
}

/**
 * A etapa MAIS AVANÇADA que cada contato já alcançou.
 *
 * Não é o estado atual: quem chegou em PROPOSTA e virou PERDIDO alcançou
 * PROPOSTA. Usar só o estado atual esconderia justamente onde o funil vaza — o
 * degrau "qualificado → proposta" apareceria vazio num mês em que várias
 * propostas foram recusadas.
 */
export function maisAvancadaAlcancada(
  atual: FoocciLeadStage,
  historicoToStages: Array<FoocciLeadStage | null>,
): FoocciLeadStage {
  let melhor = indiceEtapa(atual);
  let nome: FoocciLeadStage = melhor >= 0 ? atual : "NOVO";
  if (melhor < 0) melhor = 0;

  for (const s of historicoToStages) {
    if (!s) continue;
    const i = indiceEtapa(s);
    if (i > melhor) { melhor = i; nome = s; }
  }
  return nome;
}

// Reexport para quem só quer normalizar telefone sem descobrir onde ele mora.
export { normalizaWhatsapp };
