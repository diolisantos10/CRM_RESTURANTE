"use client";

/**
 * A SUPERVISORA — o painel que mostra, em segundos, quem está atendendo mal,
 * quais conversas exigem atenção, o que a Supervisora corrigiu e quais
 * mudanças de prompt estão funcionando.
 *
 * ── QUATRO SEÇÕES, NA ORDEM QUE O CEO PEDIU ─────────────────────────────────
 *
 *   1. Visão Geral — os números da janela, agregados sobre
 *      `SupervisoraAvaliacao` (ver `visao-geral/route.ts`).
 *   2. Conversas em Risco — mensagens retidas ou reprovadas, com as MESMAS
 *      três ações que já existem em `responsavel.ts`/`handoff.ts` por trás de
 *      `/api/admin/sala-de-vendas/responsavel`: assumir, transferir (pedir
 *      humano) e liberar (devolver para a IA). Nenhuma ação nova nasce aqui.
 *   3. Desempenho dos Agentes — `desempenhoPorAgente`, com os critérios
 *      nomeados da FASE 3 e os que a casa NÃO mede automaticamente, sempre
 *      rotulados como tal — nunca um número inventado.
 *   4. Prompts e Aprendizado — as sugestões pendentes (nível 2) e as versões
 *      do TA (nível 3), com aprovar/rejeitar e publicar/reverter.
 *
 * ── O CONTROLE DE MODO ───────────────────────────────────────────────────────
 *
 * Sempre visível no topo. Trocar para GUARD/INTERVENTION pede uma confirmação
 * de texto explícita — a rota já trava por papel (`podeMudarModo`); esta tela
 * reforça com o mesmo espírito do "Ligar prospecção" da tela de Prospecção.
 */

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";

const ROTA_MODO = "/api/admin/sala-de-vendas/supervisora";
const ROTA_VISAO_GERAL = `${ROTA_MODO}/visao-geral`;
const ROTA_RISCO = `${ROTA_MODO}/conversas-em-risco`;
const ROTA_DESEMPENHO = `${ROTA_MODO}/desempenho`;
const ROTA_SUGESTOES = `${ROTA_MODO}/sugestoes`;
const ROTA_VERSOES = `${ROTA_MODO}/versoes`;
const ROTA_RESPONSAVEL = "/api/admin/sala-de-vendas/responsavel";

type Modo = "OFF" | "SHADOW" | "GUARD" | "INTERVENTION";
type Veredito = "VERDE" | "AMARELO" | "VERMELHO" | "CRITICO";

const ROTULO_DO_MODO: Record<Modo, string> = {
  OFF: "Desligada",
  SHADOW: "Observando (SHADOW)",
  GUARD: "Corrigindo e bloqueando (GUARD)",
  INTERVENTION: "Intervindo (INTERVENTION)",
};

const EXPLICACAO_DO_MODO: Record<Modo, string> = {
  OFF: "Nenhuma chamada acontece. Comportamento de hoje, sem custo nem latência.",
  SHADOW: "Avalia e grava todo veredito, mas nunca muda o que sai. Modo de estreia.",
  GUARD: "VERDE libera; AMARELO reescreve antes de enviar; VERMELHO retém; CRÍTICO retém e escala para gente.",
  INTERVENTION: "Tudo de GUARD, mais a capacidade de pausar/assumir uma conversa em andamento.",
};

interface EstadoDoModo {
  ligada: boolean;
  modo: Modo;
  modoEfetivo: Modo;
  atualizadoPor: string | null;
  atualizadoEm: string;
  podeMudarModo: boolean;
  historico: Array<{ modoAnterior: Modo; modoNovo: Modo; alteradoPor: string; motivo: string | null; alteradoEm: string }>;
}

interface VisaoGeral {
  periodo: { de: string; ate: string };
  conversasAcompanhadas: number;
  mensagensAvaliadas: number;
  mensagensCorrigidas: number;
  mensagensBloqueadas: number;
  escaladasParaGente: number;
  falhasTecnicas: number;
  optOuts: number;
  porVeredito: Record<Veredito, number>;
  principaisRiscos: Array<{ motivo: string; rotulo: string; total: number }>;
}

interface ConversaEmRisco {
  avaliacaoId: string;
  leadId: string;
  leadNome: string;
  leadWhatsapp: string;
  etapa: string | null;
  autorUserId: string | null;
  autorNome: string | null;
  papelDoAgente: string | null;
  veredito: Veredito;
  motivos: string[];
  motivoDetalhe: string | null;
  bloqueada: boolean;
  handoffDisparado: boolean;
  criadaEm: string;
  atendidoPorAgora: "NINGUEM" | "IA" | "HUMANO" | "AGUARDANDO_HUMANO";
  atendenteAtualUserId: string | null;
}

interface Criterio {
  motivo: string;
  rotulo: string;
}

interface DesempenhoDoAgente {
  autorUserId: string | null;
  papelDoAgente: string | null;
  nome: string;
  total: number;
  porVeredito: Record<Veredito, number>;
  porMotivo: Partial<Record<string, number>>;
  bloqueadas: number;
  handoffsDisparados: number;
}

interface Sugestao {
  id: string;
  agenteAfetadoTipo: string | null;
  agenteAfetadoUserId: string | null;
  papelDoAgente: string | null;
  problemaObservado: string;
  evidenciaMensagemIds: string[];
  evidenciaLeadIds: string[];
  trechoAnterior: string | null;
  trechoNovoProposto: string | null;
  justificativa: string;
  autor: string;
  situacao: "PENDENTE" | "APROVADA" | "REJEITADA" | "APLICADA";
  criadaEm: string;
  notaDaRevisao: string | null;
}

interface VersaoDoTA {
  id: string;
  numero: number;
  situacao: "RASCUNHO" | "EM_TESTE" | "PUBLICADA" | "APOSENTADA";
  identidade: string;
  tomDeVoz: string | null;
  objetivos: string | null;
  proibidos: string[];
  origemSugestaoId: string | null;
  agenteAfetado: string | null;
  problemaObservado: string | null;
  trechoAnterior: string | null;
  trechoNovoProposto: string | null;
  justificativaDaAlteracao: string | null;
  testeCorrespondente: string | null;
  publicadaEm: string | null;
  publicadaPor: { nome: string } | null;
  createdAt: string;
}

function fmtData(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR");
}

/** Cartão numérico simples — repetido seis vezes na Visão Geral. */
function Cartao({ rotulo, valor, nota }: { rotulo: string; valor: number | string; nota?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase text-muted">{rotulo}</p>
      <p className="text-[18px] font-semibold text-ink tabular-nums">{valor}</p>
      {nota && <p className="text-[11.5px] text-muted">{nota}</p>}
    </div>
  );
}

function Secao({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-paper p-4">
      <h2 className="text-[15px] font-semibold text-ink">{titulo}</h2>
      {subtitulo && <p className="mt-0.5 text-[12.5px] text-muted">{subtitulo}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 0. O CONTROLE DE MODO
// ═══════════════════════════════════════════════════════════════════════════

function ControleDeModo({
  estado,
  ocupado,
  onMudar,
}: {
  estado: EstadoDoModo;
  ocupado: boolean;
  onMudar: (modo: Modo) => void;
}) {
  const [selecionado, setSelecionado] = useState<Modo>(estado.modo);
  const [historicoAberto, setHistoricoAberto] = useState(false);

  useEffect(() => setSelecionado(estado.modo), [estado.modo]);

  const confirmarEEnviar = () => {
    if (selecionado === estado.modo) return;

    const alvoDeRisco = selecionado === "GUARD" || selecionado === "INTERVENTION";
    const mensagem = alvoDeRisco
      ? `Mudar para ${ROTULO_DO_MODO[selecionado]} faz a Supervisora passar a REESCREVER e BLOQUEAR mensagens de verdade, para todos os agentes. Esta é uma decisão de gestão. Confirmar?`
      : `Mudar o modo da Supervisora para ${ROTULO_DO_MODO[selecionado]}. Confirmar?`;

    if (!window.confirm(mensagem)) return;
    onMudar(selecionado);
  };

  return (
    <section className="rounded-xl border border-line bg-paper p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">
            Supervisora — {ROTULO_DO_MODO[estado.modoEfetivo]}
          </h2>
          <p className="mt-0.5 max-w-xl text-[12.5px] text-muted">{EXPLICACAO_DO_MODO[estado.modoEfetivo]}</p>
          <p className="mt-1 text-[12px] text-muted">
            {estado.atualizadoPor
              ? `Última troca por ${estado.atualizadoPor}, em ${fmtData(estado.atualizadoEm)}`
              : "Nunca foi trocada — nasceu no padrão."}
          </p>
        </div>

        {estado.podeMudarModo ? (
          <div className="flex items-center gap-2">
            <select
              value={selecionado}
              onChange={(e) => setSelecionado(e.target.value as Modo)}
              className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-[13px] text-ink"
            >
              {(["OFF", "SHADOW", "GUARD", "INTERVENTION"] as const).map((m) => (
                <option key={m} value={m}>
                  {ROTULO_DO_MODO[m]}
                </option>
              ))}
            </select>
            <button
              disabled={ocupado || selecionado === estado.modo}
              onClick={confirmarEEnviar}
              className="rounded-lg bg-ink px-3 py-1.5 text-[13px] font-semibold text-paper disabled:opacity-50"
            >
              Confirmar
            </button>
          </div>
        ) : (
          <p className="text-[12px] text-muted">Sua conta lê o modo, mas não pode trocá-lo.</p>
        )}
      </div>

      <button
        onClick={() => setHistoricoAberto((a) => !a)}
        className="mt-3 text-[12px] font-semibold text-ink2 underline decoration-line underline-offset-2"
      >
        {historicoAberto ? "Ocultar histórico de trocas" : `Ver histórico de trocas (${estado.historico.length})`}
      </button>

      {historicoAberto && (
        <ul className="mt-2 space-y-1 border-t border-line pt-2">
          {estado.historico.length === 0 && <li className="text-[12.5px] text-muted">Nenhuma troca ainda.</li>}
          {estado.historico.map((h, i) => (
            <li key={i} className="text-[12px] text-ink2">
              {h.modoAnterior} → <span className="font-semibold text-ink">{h.modoNovo}</span> por {h.alteradoPor} em{" "}
              {fmtData(h.alteradoEm)}
              {h.motivo ? ` · ${h.motivo}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. VISÃO GERAL
// ═══════════════════════════════════════════════════════════════════════════

function SecaoVisaoGeral({ dados }: { dados: VisaoGeral | null }) {
  return (
    <Secao
      titulo="Visão Geral"
      subtitulo={
        dados
          ? `${fmtData(dados.periodo.de)} até ${fmtData(dados.periodo.ate)} — direto de SupervisoraAvaliacao`
          : undefined
      }
    >
      {!dados ? (
        <p className="text-[12.5px] text-muted">Carregando…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
            <Cartao rotulo="Conversas acompanhadas" valor={dados.conversasAcompanhadas} />
            <Cartao rotulo="Mensagens avaliadas" valor={dados.mensagensAvaliadas} />
            <Cartao rotulo="Mensagens corrigidas" valor={dados.mensagensCorrigidas} nota="reescritas antes de sair" />
            <Cartao rotulo="Mensagens bloqueadas" valor={dados.mensagensBloqueadas} nota="retidas, não saíram" />
            <Cartao rotulo="Escaladas para gente" valor={dados.escaladasParaGente} nota="handoff disparado" />
            <Cartao
              rotulo="Opt-outs"
              valor={dados.optOuts}
              nota="entre os leads acompanhados"
            />
          </div>

          {dados.falhasTecnicas > 0 && (
            <p className="mt-3 rounded-lg border border-line px-3 py-2 text-[12px] text-muted">
              {dados.falhasTecnicas} avaliação(ões) tiveram falha técnica da própria Supervisora nesta janela.
            </p>
          )}

          <div className="mt-4 border-t border-line pt-3">
            <p className="text-[12px] font-semibold text-ink">Por veredito</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink2">
              <span>VERDE: <strong className="text-ink">{dados.porVeredito.VERDE}</strong></span>
              <span>AMARELO: <strong className="text-ink">{dados.porVeredito.AMARELO}</strong></span>
              <span>VERMELHO: <strong className="text-ink">{dados.porVeredito.VERMELHO}</strong></span>
              <span>CRÍTICO: <strong className="text-ink">{dados.porVeredito.CRITICO}</strong></span>
            </div>
          </div>

          <div className="mt-4 border-t border-line pt-3">
            <p className="text-[12px] font-semibold text-ink">Principais riscos</p>
            {dados.principaisRiscos.length === 0 ? (
              <p className="mt-1 text-[12.5px] text-muted">Nenhum risco registrado nesta janela.</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {dados.principaisRiscos.map((r) => (
                  <li key={r.motivo} className="flex justify-between text-[12.5px] text-ink2">
                    <span>{r.rotulo}</span>
                    <span className="font-semibold text-ink tabular-nums">{r.total}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Secao>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. CONVERSAS EM RISCO
// ═══════════════════════════════════════════════════════════════════════════

function acoesDisponiveis(c: ConversaEmRisco): Array<{ chave: "assumir" | "pedirHumano" | "devolver"; rotulo: string }> {
  const acoes: Array<{ chave: "assumir" | "pedirHumano" | "devolver"; rotulo: string }> = [];
  if (c.atendidoPorAgora !== "HUMANO") acoes.push({ chave: "assumir", rotulo: "Assumir" });
  if (c.atendidoPorAgora === "IA" || c.atendidoPorAgora === "NINGUEM") {
    acoes.push({ chave: "pedirHumano", rotulo: "Transferir para humano" });
  }
  if (c.atendidoPorAgora === "HUMANO") acoes.push({ chave: "devolver", rotulo: "Liberar para a IA" });
  return acoes;
}

function SecaoConversasEmRisco({
  linhas,
  ocupado,
  onAgir,
}: {
  linhas: ConversaEmRisco[] | null;
  ocupado: boolean;
  onAgir: (c: ConversaEmRisco, chave: "assumir" | "pedirHumano" | "devolver") => void;
}) {
  return (
    <Secao
      titulo="Conversas em Risco"
      subtitulo="Mensagens retidas ou reprovadas (VERMELHO/CRÍTICO), mais recentes primeiro."
    >
      {!linhas ? (
        <p className="text-[12.5px] text-muted">Carregando…</p>
      ) : linhas.length === 0 ? (
        <p className="text-[12.5px] text-muted">Nenhuma conversa em risco agora.</p>
      ) : (
        <ul className="space-y-2">
          {linhas.map((c) => (
            <li key={c.avaliacaoId} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-ink">
                    {c.leadNome} <span className="font-normal text-muted">· {c.leadWhatsapp}</span>
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-ink2">
                    Agente: {c.autorNome ?? c.papelDoAgente ?? "TA"} · Etapa: {c.etapa ?? "—"} · Veredito:{" "}
                    <strong className="text-ink">{c.veredito}</strong>
                    {c.bloqueada && <strong className="text-ink"> · RETIDA</strong>}
                    {c.handoffDisparado && " · escalou para gente"}
                  </p>
                  {c.motivoDetalhe && <p className="mt-0.5 text-[12px] text-muted">{c.motivoDetalhe}</p>}
                  {c.motivos.length > 0 && (
                    <p className="mt-0.5 text-[11.5px] text-muted">{c.motivos.join(", ")}</p>
                  )}
                  <p className="mt-0.5 text-[11px] text-muted">{fmtData(c.criadaEm)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {acoesDisponiveis(c).map((a) => (
                    <button
                      key={a.chave}
                      disabled={ocupado}
                      onClick={() => onAgir(c, a.chave)}
                      className="rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold text-ink transition-colors hover:bg-canvas disabled:opacity-50"
                    >
                      {a.rotulo}
                    </button>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. DESEMPENHO DOS AGENTES
// ═══════════════════════════════════════════════════════════════════════════

function SecaoDesempenho({
  dados,
}: {
  dados: { criterios: Criterio[]; criteriosNaoMedidos: string[]; agentes: DesempenhoDoAgente[] } | null;
}) {
  return (
    <Secao
      titulo="Desempenho dos Agentes"
      subtitulo="Por agente (IA ou humano) que a Supervisora avaliou na janela."
    >
      {!dados ? (
        <p className="text-[12.5px] text-muted">Carregando…</p>
      ) : dados.agentes.length === 0 ? (
        <p className="text-[12.5px] text-muted">Nenhuma avaliação nesta janela ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase text-muted">
                <th className="py-1.5 pr-3">Agente</th>
                <th className="py-1.5 pr-3">Avaliadas</th>
                <th className="py-1.5 pr-3">Verde</th>
                <th className="py-1.5 pr-3">Amarelo</th>
                <th className="py-1.5 pr-3">Vermelho</th>
                <th className="py-1.5 pr-3">Crítico</th>
                <th className="py-1.5 pr-3">Bloqueadas</th>
                <th className="py-1.5 pr-3">Handoffs</th>
                <th className="py-1.5 pr-3">Erro mais comum</th>
              </tr>
            </thead>
            <tbody>
              {dados.agentes.map((a, i) => {
                const piorMotivo = Object.entries(a.porMotivo).sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0))[0];
                const rotuloDoMotivo = piorMotivo
                  ? dados.criterios.find((c) => c.motivo === piorMotivo[0])?.rotulo ?? piorMotivo[0]
                  : "—";
                return (
                  <tr key={`${a.autorUserId ?? a.papelDoAgente}-${i}`} className="border-b border-line last:border-0">
                    <td className="py-1.5 pr-3 font-semibold text-ink">{a.nome}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{a.total}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{a.porVeredito.VERDE}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{a.porVeredito.AMARELO}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{a.porVeredito.VERMELHO}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{a.porVeredito.CRITICO}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{a.bloqueadas}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{a.handoffsDisparados}</td>
                    <td className="py-1.5 pr-3 text-ink2">
                      {piorMotivo ? `${rotuloDoMotivo} (${piorMotivo[1]})` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dados && dados.criteriosNaoMedidos.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-[12px] font-semibold text-ink">Critérios que a casa NÃO mede automaticamente</p>
          <ul className="mt-1 space-y-0.5">
            {dados.criteriosNaoMedidos.map((c) => (
              <li key={c} className="text-[12px] text-muted">
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Secao>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. PROMPTS E APRENDIZADO
// ═══════════════════════════════════════════════════════════════════════════

function LinhaDaSugestao({
  s,
  ocupado,
  onDecidir,
}: {
  s: Sugestao;
  ocupado: boolean;
  onDecidir: (id: string, acao: "aprovar" | "rejeitar", extra: Record<string, unknown>) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [campo, setCampo] = useState<"identidade" | "tomDeVoz" | "objetivos" | "proibidos">("proibidos");
  const [valor, setValor] = useState(s.trechoNovoProposto ?? "");
  const [erroGrave, setErroGrave] = useState(false);

  const poucaEvidencia = s.evidenciaMensagemIds.length < 2;

  return (
    <li className="rounded-lg border border-line p-3">
      <button onClick={() => setAberto((a) => !a)} className="flex w-full items-start justify-between gap-2 text-left">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-ink">
            {s.papelDoAgente ?? s.agenteAfetadoUserId ?? "todos"} · {s.problemaObservado}
          </p>
          <p className="mt-0.5 text-[11.5px] text-muted">
            {s.evidenciaMensagemIds.length} evidência(s) · {fmtData(s.criadaEm)} · {s.situacao}
          </p>
        </div>
        <span className="shrink-0 text-[12px] text-muted">{aberto ? "recolher ▲" : "detalhes ▼"}</span>
      </button>

      {aberto && (
        <div className="mt-2.5 space-y-2 border-t border-line pt-2.5">
          <p className="text-[12px] text-ink2">
            <span className="font-semibold text-ink">Justificativa:</span> {s.justificativa}
          </p>
          {s.trechoAnterior && (
            <p className="text-[12px] text-muted">
              <span className="font-semibold text-ink">Antes:</span> {s.trechoAnterior}
            </p>
          )}
          {s.trechoNovoProposto && (
            <p className="text-[12px] text-muted">
              <span className="font-semibold text-ink">Proposto:</span> {s.trechoNovoProposto}
            </p>
          )}

          {s.situacao === "PENDENTE" && (
            <div className="space-y-2 rounded-lg bg-canvas p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[12px] text-muted">Aplicar em:</label>
                <select
                  value={campo}
                  onChange={(e) => setCampo(e.target.value as typeof campo)}
                  className="rounded-lg border border-line bg-paper px-2 py-1 text-[12.5px] text-ink"
                >
                  <option value="proibidos">Proibidos (adiciona uma linha)</option>
                  <option value="identidade">Identidade</option>
                  <option value="tomDeVoz">Tom de voz</option>
                  <option value="objetivos">Objetivos</option>
                </select>
              </div>
              <textarea
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                rows={2}
                placeholder="Texto final que a versão nova deve ter neste campo"
                className="w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-[12.5px] text-ink"
              />
              {poucaEvidencia && (
                <label className="flex items-center gap-1.5 text-[12px] text-ink2">
                  <input type="checkbox" checked={erroGrave} onChange={(e) => setErroGrave(e.target.checked)} />
                  Menos de duas evidências — marcar como erro grave/risco para aprovar mesmo assim
                </label>
              )}
              <div className="flex gap-2">
                <button
                  disabled={ocupado || !valor.trim()}
                  onClick={() =>
                    onDecidir(s.id, "aprovar", {
                      patch: { [campo]: campo === "proibidos" ? [valor.trim()] : valor.trim() },
                      erroGrave,
                    })
                  }
                  className="rounded-lg bg-brand-500 px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  Aprovar e criar versão
                </button>
                <button
                  disabled={ocupado}
                  onClick={() => onDecidir(s.id, "rejeitar", {})}
                  className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink disabled:opacity-50"
                >
                  Rejeitar
                </button>
              </div>
            </div>
          )}
          {s.notaDaRevisao && (
            <p className="text-[12px] text-muted">
              <span className="font-semibold text-ink">Nota da revisão:</span> {s.notaDaRevisao}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function DiffDeVersao({ ativa, versao }: { ativa: VersaoDoTA | null; versao: VersaoDoTA }) {
  const campos: Array<{ rotulo: string; antes: string; depois: string }> = [
    { rotulo: "Identidade", antes: ativa?.identidade ?? "—", depois: versao.identidade },
    { rotulo: "Tom de voz", antes: ativa?.tomDeVoz ?? "—", depois: versao.tomDeVoz ?? "—" },
    { rotulo: "Objetivos", antes: ativa?.objetivos ?? "—", depois: versao.objetivos ?? "—" },
    { rotulo: "Proibidos", antes: (ativa?.proibidos ?? []).join("; ") || "—", depois: versao.proibidos.join("; ") || "—" },
  ];

  return (
    <div className="mt-2 space-y-2 border-t border-line pt-2">
      {campos
        .filter((c) => c.antes !== c.depois)
        .map((c) => (
          <div key={c.rotulo} className="text-[12px]">
            <p className="font-semibold text-ink">{c.rotulo}</p>
            <p className="text-muted">Antes: {c.antes}</p>
            <p className="text-ink2">Depois: {c.depois}</p>
          </div>
        ))}
      {campos.every((c) => c.antes === c.depois) && (
        <p className="text-[12px] text-muted">Sem diferença de conteúdo com a versão ativa.</p>
      )}
    </div>
  );
}

function LinhaDaVersao({
  versao,
  ativa,
  ehAtiva,
  ocupado,
  onPublicar,
}: {
  versao: VersaoDoTA;
  ativa: VersaoDoTA | null;
  ehAtiva: boolean;
  ocupado: boolean;
  onPublicar: (versaoId: string) => void;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <li className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button onClick={() => setAberto((a) => !a)} className="min-w-0 text-left">
          <p className="text-[13px] font-semibold text-ink">
            v{versao.numero} · {versao.situacao}
            {ehAtiva && <span className="ml-1.5 font-semibold text-ink">· ATIVA</span>}
          </p>
          <p className="mt-0.5 text-[12px] text-muted">
            {versao.agenteAfetado ? `Agente: ${versao.agenteAfetado} · ` : ""}
            {versao.problemaObservado ?? "Sem origem em sugestão da Supervisora — criada pela ficha manual."}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {versao.publicadaEm
              ? `Publicada em ${fmtData(versao.publicadaEm)}${versao.publicadaPor ? ` por ${versao.publicadaPor.nome}` : ""}`
              : "Ainda não publicada"}
            {versao.testeCorrespondente ? ` · prova: ${versao.testeCorrespondente}` : ""}
          </p>
        </button>
        {!ehAtiva && (
          <button
            disabled={ocupado}
            onClick={() => {
              if (
                window.confirm(
                  `Publicar a versão ${versao.numero} agora? Isto muda o que o TA fala para todo lead a partir do próximo turno.`,
                )
              ) {
                onPublicar(versao.id);
              }
            }}
            className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold text-ink transition-colors hover:bg-canvas disabled:opacity-50"
          >
            Publicar / reverter para esta
          </button>
        )}
      </div>
      {aberto && <DiffDeVersao ativa={ativa} versao={versao} />}
    </li>
  );
}

function SecaoPromptsEAprendizado({
  sugestoes,
  versoes,
  versaoAtivaId,
  ocupado,
  onDecidirSugestao,
  onPublicarVersao,
}: {
  sugestoes: { pendentes: Sugestao[]; historico: Sugestao[] } | null;
  versoes: VersaoDoTA[] | null;
  versaoAtivaId: string | null;
  ocupado: boolean;
  onDecidirSugestao: (id: string, acao: "aprovar" | "rejeitar", extra: Record<string, unknown>) => void;
  onPublicarVersao: (versaoId: string) => void;
}) {
  const ativa = versoes?.find((v) => v.id === versaoAtivaId) ?? null;

  return (
    <Secao titulo="Prompts e Aprendizado" subtitulo="Sugestões pendentes de revisão, e as versões do TA.">
      <div>
        <p className="text-[12px] font-semibold text-ink">
          Sugestões pendentes {sugestoes ? `(${sugestoes.pendentes.length})` : ""}
        </p>
        {!sugestoes ? (
          <p className="mt-1 text-[12.5px] text-muted">Carregando…</p>
        ) : sugestoes.pendentes.length === 0 ? (
          <p className="mt-1 text-[12.5px] text-muted">Nenhuma sugestão pendente.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {sugestoes.pendentes.map((s) => (
              <LinhaDaSugestao key={s.id} s={s} ocupado={ocupado} onDecidir={onDecidirSugestao} />
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5 border-t border-line pt-3">
        <p className="text-[12px] font-semibold text-ink">Versões do TA</p>
        {!versoes ? (
          <p className="mt-1 text-[12.5px] text-muted">Carregando…</p>
        ) : versoes.length === 0 ? (
          <p className="mt-1 text-[12.5px] text-muted">Nenhuma versão ainda.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {versoes.map((v) => (
              <LinhaDaVersao
                key={v.id}
                versao={v}
                ativa={ativa}
                ehAtiva={v.id === versaoAtivaId}
                ocupado={ocupado}
                onPublicar={onPublicarVersao}
              />
            ))}
          </ul>
        )}
      </div>
    </Secao>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// A TELA
// ═══════════════════════════════════════════════════════════════════════════

type Fase = "carregando" | "pronto" | "semAcesso" | "erro";

const barraDeAviso: CSSProperties = { wordBreak: "break-word" };

export function SupervisoraClient() {
  const [fase, setFase] = useState<Fase>("carregando");
  const [erroDetalhe, setErroDetalhe] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  const [modo, setModo] = useState<EstadoDoModo | null>(null);
  const [visaoGeral, setVisaoGeral] = useState<VisaoGeral | null>(null);
  const [risco, setRisco] = useState<ConversaEmRisco[] | null>(null);
  const [desempenho, setDesempenho] = useState<{
    criterios: Criterio[];
    criteriosNaoMedidos: string[];
    agentes: DesempenhoDoAgente[];
  } | null>(null);
  const [sugestoes, setSugestoes] = useState<{ pendentes: Sugestao[]; historico: Sugestao[] } | null>(null);
  const [versoes, setVersoes] = useState<{ versaoAtivaId: string | null; versoes: VersaoDoTA[] } | null>(null);

  const recarregar = useCallback(() => setTentativa((t) => t + 1), []);

  // O modo decide se a tela existe. As outras quatro seções carregam juntas,
  // depois — e uma falhando não derruba as outras (mesmo padrão da Prospecção).
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch(ROTA_MODO, { cache: "no-store" });
        if (res.status === 401 || res.status === 403) {
          if (vivo) setFase("semAcesso");
          return;
        }
        if (!res.ok) {
          if (vivo) {
            setErroDetalhe(`${ROTA_MODO} respondeu ${res.status}`);
            setFase("erro");
          }
          return;
        }
        const corpo = (await res.json()) as { data?: EstadoDoModo };
        if (!corpo?.data) {
          if (vivo) {
            setErroDetalhe("resposta em formato inesperado");
            setFase("erro");
          }
          return;
        }
        if (vivo) {
          setModo(corpo.data);
          setFase("pronto");
        }
      } catch (e) {
        if (vivo) {
          setErroDetalhe(e instanceof Error ? e.message : null);
          setFase("erro");
        }
      }
    })();
    return () => {
      vivo = false;
    };
  }, [tentativa]);

  useEffect(() => {
    if (fase !== "pronto") return;
    let vivo = true;

    async function carregar<T>(rota: string, setter: (v: T) => void) {
      try {
        const res = await fetch(rota, { cache: "no-store" });
        if (!res.ok) return;
        const corpo = (await res.json()) as { data?: T };
        if (vivo && corpo?.data !== undefined) setter(corpo.data);
      } catch {
        // Uma seção falhar não pode derrubar as outras três.
      }
    }

    carregar<VisaoGeral>(ROTA_VISAO_GERAL, setVisaoGeral);
    carregar<ConversaEmRisco[]>(ROTA_RISCO, setRisco);
    carregar<{ criterios: Criterio[]; criteriosNaoMedidos: string[]; agentes: DesempenhoDoAgente[] }>(
      ROTA_DESEMPENHO,
      setDesempenho,
    );
    carregar<{ pendentes: Sugestao[]; historico: Sugestao[] }>(ROTA_SUGESTOES, setSugestoes);
    carregar<{ versaoAtivaId: string | null; versoes: VersaoDoTA[] }>(ROTA_VERSOES, setVersoes);

    return () => {
      vivo = false;
    };
  }, [fase, tentativa]);

  const postar = useCallback(
    async (rota: string, corpo: Record<string, unknown>) => {
      setOcupado(true);
      setAviso(null);
      try {
        const res = await fetch(rota, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        });
        const json = (await res.json().catch(() => null)) as { error?: string; data?: unknown } | null;
        if (!res.ok) {
          setAviso(json?.error ?? `A ação foi recusada (${res.status}).`);
          return false;
        }
        recarregar();
        return true;
      } catch (e) {
        setAviso(e instanceof Error ? e.message : "Falha de rede.");
        return false;
      } finally {
        setOcupado(false);
      }
    },
    [recarregar],
  );

  const mudarModo = useCallback((novoModo: Modo) => postar(ROTA_MODO, { modo: novoModo }), [postar]);

  const agirNaConversa = useCallback(
    (c: ConversaEmRisco, chave: "assumir" | "pedirHumano" | "devolver") => {
      const resumo = `Supervisora (${c.veredito}${c.bloqueada ? ", retida" : ""}): ${
        c.motivoDetalhe ?? c.motivos.join(", ") ?? "conversa marcada em risco"
      }`;
      const corpo: Record<string, unknown> =
        chave === "pedirHumano"
          ? {
              acao: "pedirHumano",
              leadId: c.leadId,
              motivo: "Escalado pela tela da Supervisora — conversa em risco.",
              dossie: { resumo },
            }
          : chave === "devolver"
            ? {
                acao: "devolver",
                leadId: c.leadId,
                objetivo: "Assumido pela Supervisora — retomar com o objetivo da última etapa.",
                dossie: { resumo },
              }
            : { acao: "assumir", leadId: c.leadId };
      postar(ROTA_RESPONSAVEL, corpo);
    },
    [postar],
  );

  const decidirSugestao = useCallback(
    (id: string, acao: "aprovar" | "rejeitar", extra: Record<string, unknown>) =>
      postar(ROTA_SUGESTOES, { acao, sugestaoId: id, ...extra }),
    [postar],
  );

  const publicarVersao = useCallback(
    (versaoId: string) => postar(ROTA_VERSOES, { acao: "publicar", versaoId }),
    [postar],
  );

  if (fase === "carregando") {
    return <div className="p-6 text-[13px] text-muted">Carregando…</div>;
  }

  if (fase === "semAcesso") {
    return <div className="p-6 text-[13px] text-muted">Sua conta não alcança a Supervisora.</div>;
  }

  if (fase === "erro" || !modo) {
    return (
      <div className="p-6">
        <p className="text-[13px] text-ink">Não foi possível ler a Supervisora.</p>
        {erroDetalhe && <p className="mt-1 text-[12.5px] text-muted">{erroDetalhe}</p>}
        <button onClick={recarregar} className="mt-3 rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-ink">
          Tentar de novo
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {aviso && (
        <p style={barraDeAviso} className="rounded-lg border border-line bg-paper px-3 py-2 text-[12.5px] text-ink">
          {aviso}
        </p>
      )}

      <ControleDeModo estado={modo} ocupado={ocupado} onMudar={mudarModo} />
      <SecaoVisaoGeral dados={visaoGeral} />
      <SecaoConversasEmRisco linhas={risco} ocupado={ocupado} onAgir={agirNaConversa} />
      <SecaoDesempenho dados={desempenho} />
      <SecaoPromptsEAprendizado
        sugestoes={sugestoes}
        versoes={versoes?.versoes ?? null}
        versaoAtivaId={versoes?.versaoAtivaId ?? null}
        ocupado={ocupado}
        onDecidirSugestao={decidirSugestao}
        onPublicarVersao={publicarVersao}
      />
    </div>
  );
}
