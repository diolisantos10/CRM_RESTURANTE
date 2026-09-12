"use client";

/**
 * OPERAÇÃO — bloco 2 do redesenho minimalista, 12/09/2026.
 *
 * Contatos por dia (edita e salva sozinho), o interruptor (o kill switch de
 * verdade — `outboundLigado`/`pausadoEm`, lidos a cada rodada por
 * `agendador.ts`/`abordarDaFila.ts`), "enviados hoje" e "elegíveis restantes"
 * (do MESMO `conferirElegibilidadeReal` que a auditoria já usa — nenhuma
 * segunda fonte), e a próxima execução automática.
 *
 * ── A ARMADILHA DO "SALVAR SÓ O TETO" ───────────────────────────────────────
 *
 * A ação `interruptor` da rota SEMPRE recalcula `outboundLigado`/`pausadoEm`
 * a partir de `c.ligado`/`c.pausar` — nunca só some. Mandar `{ limiteDiario }`
 * sozinho, sem repetir o estado atual, desligaria a prospecção como efeito
 * colateral de editar um número. Por isso todo salvamento automático desta
 * tela REPETE o estado vigente (`ligado`, e `pausar`+`motivo` quando pausada)
 * — nunca manda só o campo que mudou.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface Interruptor {
  outboundLigado: boolean;
  limiteDiario: number;
  pausadoEm: string | null;
  motivo: string | null;
  ultimaRodadaAutomaticaEm: string | null;
  ultimaRodadaAutomaticaPor: string | null;
}

export interface NumerosDoDia {
  usadosHoje: number;
  tetoDoDia: number;
  elegiveisSeAtivar: number;
  pendentes: number;
}

interface Props {
  interruptor: Interruptor;
  proximaRodadaEm: string | null;
  numeros: NumerosDoDia | null;
  ocupado: boolean;
  agir: (corpo: Record<string, unknown>) => Promise<unknown>;
}

/**
 * ⚠️ `timeZone` fixo em `America/Sao_Paulo` — de propósito, e não decoração.
 * A rodada dispara na hora de São Paulo (`horaDaRodada`/`REGRA.fusoHorario`
 * em `agendador.ts`), não na hora de quem está olhando a tela. Sem fixar o
 * fuso, `toLocaleString` usa o do navegador — e num navegador em UTC, "9h de
 * São Paulo" apareceria escrito "12h", o que é mentira sobre quando a rodada
 * roda de verdade.
 */
function formatarData(iso: string | null): string {
  if (!iso) return "—";
  return `${new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })} (SP)`;
}

export function OperacaoBlock({ interruptor, proximaRodadaEm, numeros, ocupado, agir }: Props) {
  const pausada = Boolean(interruptor.pausadoEm);
  const ligada = interruptor.outboundLigado && !pausada;

  const [tetoInput, setTetoInput] = useState(String(interruptor.limiteDiario));
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const salvoTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // O campo segue o servidor quando NADA foi digitado nesta sessão — assim um
  // `recarregar()` depois de outra ação não some com o número que a pessoa
  // acabou de ver, mas também não sobrescreve uma digitação em andamento.
  useEffect(() => {
    if (debounce.current === null) setTetoInput(String(interruptor.limiteDiario));
  }, [interruptor.limiteDiario]);

  const salvarTeto = useCallback(
    (valor: number) => {
      setSalvando(true);
      const payload: Record<string, unknown> = {
        acao: "interruptor",
        limiteDiario: valor,
        ligado: interruptor.outboundLigado,
      };
      if (pausada) {
        payload.pausar = true;
        if (interruptor.motivo) payload.motivo = interruptor.motivo;
      }
      void agir(payload).then((r) => {
        setSalvando(false);
        if (r !== null) {
          setSalvo(true);
          if (salvoTimeout.current) clearTimeout(salvoTimeout.current);
          salvoTimeout.current = setTimeout(() => setSalvo(false), 2000);
        }
      });
    },
    [agir, interruptor.outboundLigado, interruptor.motivo, pausada],
  );

  const aoDigitarTeto = useCallback(
    (valor: string) => {
      setTetoInput(valor);
      setSalvo(false);
      if (debounce.current) clearTimeout(debounce.current);
      const n = Number(valor);
      if (!Number.isFinite(n) || n < 0 || valor.trim() === "") return;
      debounce.current = setTimeout(() => {
        debounce.current = null;
        salvarTeto(Math.floor(n));
      }, 700);
    },
    [salvarTeto],
  );

  const ligar = useCallback(() => {
    const limite = Math.max(0, Math.floor(Number(tetoInput) || interruptor.limiteDiario));
    const mensagem = `A operação abordará até ${limite} contato${limite === 1 ? "" : "s"} por dia. Confirmar?`;
    if (!window.confirm(mensagem)) return;
    void agir({ acao: "interruptor", ligado: true, limiteDiario: limite });
  }, [agir, tetoInput, interruptor.limiteDiario]);

  const pausar = useCallback(() => {
    void agir({ acao: "interruptor", pausar: true, motivo: "pausa manual" });
  }, [agir]);

  return (
    <section className="rounded-2xl border border-line bg-paper p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-ink">Operação</h2>
          <p className="mt-0.5 text-[13px] font-semibold">
            {ligada ? (
              <span className="text-ink2">Prospecção ativa</span>
            ) : pausada ? (
              <span className="text-ink">Prospecção pausada</span>
            ) : (
              <span className="text-muted">Prospecção desligada</span>
            )}
          </p>
        </div>

        {ligada ? (
          <button
            disabled={ocupado}
            onClick={pausar}
            className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-semibold text-paper disabled:opacity-50"
          >
            Pausar agora
          </button>
        ) : (
          <button disabled={ocupado} onClick={ligar} className="rounded-lg bg-brand-500 px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-50">
            Ligar prospecção
          </button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="block text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">
            Contatos por dia
          </span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min={0}
              step={1}
              value={tetoInput}
              onChange={(e) => aoDigitarTeto(e.target.value)}
              className="w-24 rounded-lg border border-line2 bg-canvas px-3 py-1.5 text-[14px] font-semibold text-ink outline-none focus:border-brand-400"
            />
            <span className="text-[11.5px] text-muted" aria-live="polite">
              {salvando ? "salvando…" : salvo ? "salvo ✓" : ""}
            </span>
          </div>
        </label>

        <div>
          <span className="block text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">
            Próxima execução
          </span>
          <p className="mt-1 text-[14px] font-semibold text-ink">{formatarData(proximaRodadaEm)}</p>
          <p className="mt-0.5 text-[11.5px] text-muted">
            {interruptor.ultimaRodadaAutomaticaEm
              ? `Última rodada: ${formatarData(interruptor.ultimaRodadaAutomaticaEm)}`
              : "Nenhuma rodada automática rodou ainda."}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 rounded-xl border border-line bg-canvas p-3 sm:grid-cols-2">
        <div>
          <span className="block text-[11.5px] uppercase text-muted">Enviados hoje</span>
          <p className="mt-0.5 text-[16px] font-semibold text-ink tabular-nums">
            {numeros ? `${numeros.usadosHoje} de ${numeros.tetoDoDia}` : "—"}
          </p>
        </div>
        <div>
          <span className="block text-[11.5px] uppercase text-muted">Elegíveis restantes</span>
          <p className="mt-0.5 text-[16px] font-semibold text-ink tabular-nums">
            {numeros ? numeros.elegiveisSeAtivar : "—"}
          </p>
        </div>
      </div>
    </section>
  );
}
