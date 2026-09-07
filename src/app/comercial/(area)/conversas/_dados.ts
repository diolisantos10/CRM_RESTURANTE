"use client";

/**
 * A ponta de leitura da tela de atendimento.
 *
 * Mesma doutrina de `../_dados.ts`: quatro fases, e "sem acesso" é caso normal
 * enquanto ninguém tiver login interno — tratá-lo como erro faria a tela gritar
 * vermelho num estado esperado.
 */

import { useCallback, useEffect, useState } from "react";
import type { MensagemNaTela, JanelaDe24h } from "@/services/salaDeVendas/conversa";
import type { FatorDoScore } from "@/services/salaDeVendas/score";
import type { EventoDaFicha } from "@/services/salaDeVendas/linhaDoTempo";

export const ROTA_CONVERSA = "/api/admin/sala-de-vendas/conversa";
export const ROTA_FICHA = "/api/admin/sala-de-vendas/ficha";
export const ROTA_FUNIL = "/api/admin/sala-de-vendas/funil";
export const ROTA_TAREFAS = "/api/admin/sala-de-vendas/tarefas";
export const ROTA_AGENDA = "/api/admin/sala-de-vendas/agenda";

export interface Qualificacao {
  segmento: string | null;
  unidades: number | null;
  volumeMensal: number | null;
  canaisAtuais: string[];
  sistemaAtual: string | null;
  dorPrincipal: string | null;
  objetivo: string | null;
  planoDeInteresse: string | null;
  urgencia: string | null;
  poderDeDecisao: string | null;
  faixaDeOrcamento: string | null;
  observacoes: string | null;
}

export interface LeadNaConversa {
  id: string;
  nome: string;
  whatsapp: string;
  email: string | null;
  restaurante: string | null;
  cidade: string | null;
  tipo: string | null;
  stage: string;
  score: number | null;
  temperatura: string | null;
  atendidoPor: string;
  atendenteUserId: string | null;
  atendenteDesde: string | null;
  motivoDoPedido: string | null;
  tags: string[];
  prioritario: boolean;
  utmSource: string | null;
  utmCampaign: string | null;
  origem: string | null;
  codigo: string | null;
  optOutAt: string | null;
  consentAt: string | null;
  proximaAcaoEm: string | null;
  proximaAcaoNota: string | null;
  qualificacao: Qualificacao | null;
  atendente: { nome: string } | null;
}

export interface DadosDaConversa {
  lead: LeadNaConversa;
  mensagens: MensagemNaTela[];
  fatoresDoScore: FatorDoScore[];
  /**
   * O histórico do lead FORA das mensagens — captura, movimento no funil, quem
   * assumiu, notas. Mais recente primeiro, já em português e com o autor
   * resolvido pelo servidor.
   */
  linhaDoTempo: EventoDaFicha[];
  janela: JanelaDe24h;
  podeEscrever: boolean;
  /**
   * Por que o cartão está vazio — `null` quando há conversa.
   *
   * Montado no servidor (`anterioresASala`), e não aqui: "ninguém falou com
   * ele" e "chegou antes de a Sala existir" produzem o mesmo branco na tela, e
   * a regra que separa os dois precisa viver perto do teste.
   */
  avisoDoSilencio: { titulo: string; texto: string; tom: "historico" | "alerta" } | null;
}

export type EstadoDaConversa =
  | { fase: "vazio" }
  | { fase: "carregando" }
  | { fase: "pronto"; dados: DadosDaConversa }
  | { fase: "semAcesso" }
  | { fase: "erro"; detalhe: string | null };

export function useConversa(leadId: string | null) {
  const [estado, setEstado] = useState<EstadoDaConversa>({ fase: "vazio" });
  const [tentativa, setTentativa] = useState(0);

  const recarregar = useCallback(() => setTentativa((t) => t + 1), []);

  useEffect(() => {
    if (!leadId) {
      setEstado({ fase: "vazio" });
      return;
    }

    let vivo = true;
    setEstado({ fase: "carregando" });

    (async () => {
      try {
        const r = await fetch(`${ROTA_CONVERSA}?leadId=${encodeURIComponent(leadId)}`, {
          cache: "no-store",
        });

        if (!vivo) return;

        if (r.status === 401 || r.status === 403) {
          setEstado({ fase: "semAcesso" });
          return;
        }

        // 404 aqui é o isolamento funcionando: o lead não é seu. A tela diz
        // isso sem inventar um erro de sistema.
        if (r.status === 404) {
          setEstado({ fase: "erro", detalhe: "Esta conversa não está disponível para você." });
          return;
        }

        const j = (await r.json()) as { ok: boolean; data?: DadosDaConversa; error?: string };
        if (!vivo) return;

        if (!j.ok || !j.data) {
          setEstado({ fase: "erro", detalhe: j.error ?? null });
          return;
        }

        setEstado({ fase: "pronto", dados: j.data });
      } catch (e) {
        if (vivo) {
          setEstado({ fase: "erro", detalhe: e instanceof Error ? e.message : null });
        }
      }
    })();

    return () => { vivo = false; };
  }, [leadId, tentativa]);

  return { estado, recarregar };
}

export type Resultado =
  | { ok: true; aviso?: string }
  | { ok: false; mensagem: string; conflito?: boolean };

async function enviar(rota: string, metodo: string, corpo: unknown): Promise<Resultado> {
  try {
    const r = await fetch(rota, {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });

    const j = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      data?: { aviso?: string };
      recusas?: Array<{ campo: string; motivo: string }>;
    };

    if (r.ok && j.ok) return { ok: true, aviso: j.data?.aviso };

    // A recusa de validação vira uma frase legível, e não um objeto cru: quem
    // está atendendo precisa saber o que corrigir, não depurar a API.
    if (j.recusas?.length) {
      return { ok: false, mensagem: j.recusas.map((x) => x.motivo).join(" · ") };
    }

    return {
      ok: false,
      mensagem: j.error ?? `Não foi possível concluir (HTTP ${r.status}).`,
      conflito: r.status === 409,
    };
  } catch (e) {
    return { ok: false, mensagem: e instanceof Error ? e.message : "Falha de rede." };
  }
}

export const escrever = (leadId: string, texto: string, acao?: "notaInterna") =>
  enviar(ROTA_CONVERSA, "POST", { leadId, texto, acao: acao ?? "enviar" });

export const marcarLidas = (leadId: string) =>
  enviar(ROTA_CONVERSA, "POST", { leadId, acao: "marcarLidas" });

export const salvarFicha = (corpo: Record<string, unknown>) =>
  enviar(ROTA_FICHA, "PATCH", corpo);

export const moverEtapa = (corpo: {
  leadId: string;
  para: string;
  motivoPerdaId?: string | null;
  nota?: string | null;
}) => enviar(ROTA_FUNIL, "POST", corpo);

export const criarTarefa = (corpo: {
  leadId: string;
  titulo: string;
  venceEm: string;
  tipo?: string;
}) => enviar(ROTA_TAREFAS, "POST", corpo);

/** "há 3 min", "há 2 h". Relógio do navegador — é a tela de quem está olhando. */
export function desde(iso: string | Date | null): string | null {
  if (!iso) return null;
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return null;

  const min = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

/**
 * Dia e hora curtos, para a linha do tempo.
 *
 * Sem o dia, "14:32" numa lista que atravessa meses é pior que nada: parece hoje.
 */
export function dataHoraCurta(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

/** Hora curta para a bolha da conversa. */
export function hora(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
