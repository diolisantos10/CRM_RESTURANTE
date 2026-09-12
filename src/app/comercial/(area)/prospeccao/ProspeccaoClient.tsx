"use client";

/**
 * A PROSPECÇÃO — redesenho automático e minimalista, 12/09/2026.
 *
 * ── O PEDIDO DO CEO, E O QUE ELE MUDA AQUI ──────────────────────────────────
 *
 * "Ele só sobe listas, define quantos contatos por dia, e liga/pausa."
 * Toda decisão técnica — novo/duplicata/enriquecimento/conflito/inválido/
 * inelegível — já é automática no backend (`classificacao.ts`, `selecao.ts`,
 * `modelosDaMeta.ts`). O trabalho desta tela é parar de expor essas decisões:
 * a partir de hoje ela é EXATAMENTE três blocos.
 *
 *   1. IMPORTAR CONTATOS  — `ImportarContatos.tsx`, uma área de upload só,
 *      sempre `importarClassificado`. Nunca pergunta "importar ou enriquecer".
 *   2. OPERAÇÃO           — `OperacaoBlock.tsx`, o teto do dia, o interruptor
 *      (o kill switch de verdade), os números do dia e a próxima execução.
 *   3. AVISO OPERACIONAL  — `AvisoOperacionalView.tsx`, e só aparece quando
 *      `avaliarAvisoOperacional` (`avisoOperacional.ts`) encontra um problema
 *      real que impede o envio.
 *
 * Uma quarta seção, "Modelos de abordagem" (`TemplatesFunil.tsx`), fica FORA
 * dos três blocos — expansível, para quem quiser comparar os cinco modelos —
 * e nunca precisa ser aberta para operar a tela.
 *
 * ── O QUE SAIU DAQUI, E PARA ONDE FOI ───────────────────────────────────────
 *
 * "Enriquecer dados de uma lista existente" como ação separada, os cartões da
 * Base fria, "Fila automática"/"Conferência da Base fria" como botões
 * visíveis, a prévia técnica dos primeiros 50, e as explicações sobre
 * pendentes/travas/materialização. Nenhum mecanismo foi apagado — Base fria
 * (`/comercial/base-fria`), Importações (`/comercial/importacoes`) e a
 * conferência (`?recorte=conferencia`, ainda usada aqui só para os NÚMEROS,
 * nunca a prévia) continuam de pé como ferramenta interna.
 *
 * ── NADA AQUI ENVIA MENSAGEM SOZINHO ────────────────────────────────────────
 *
 * Esta tela importa, configura e mostra o estado. A entrega continua atrás de
 * `FOOCCI_SDR_SEND_ENABLED`, no ambiente, do dono — e é exatamente a ausência
 * dela que o Aviso operacional aponta hoje, sem citar a variável.
 */

import { useCallback, useEffect, useState } from "react";
import { ImportarContatos } from "./ImportarContatos";
import { OperacaoBlock, type Interruptor } from "./OperacaoBlock";
import { AvisoOperacionalView } from "./AvisoOperacionalView";
import { TemplatesFunil, type FunilDoModelo, type ModeloSincronizado } from "./TemplatesFunil";
import {
  avaliarAvisoOperacional,
  type ConferenciaDoCanalParaAviso,
  type ConferenciaDoModeloParaAviso,
} from "./avisoOperacional";

const ROTA = "/api/admin/sala-de-vendas/prospeccao";

interface DadosPrincipais {
  interruptor: Interruptor;
  canalPronto: boolean;
  proximaRodadaEm: string | null;
}

interface Conferencia {
  pendentes: number;
  elegiveisSeAtivar: number;
  usadosHoje: number;
  tetoDoDia: number;
  saldoDiario: number;
  saldoDaJanela: number;
  canalConfigurado: boolean;
  envioAutorizado: boolean;
}

type Estado =
  | { fase: "carregando" }
  | { fase: "pronto"; dados: DadosPrincipais }
  | { fase: "semAcesso" }
  | { fase: "erro"; detalhe: string | null };

export function ProspeccaoClient() {
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [tentativa, setTentativa] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [avisoDeAcao, setAvisoDeAcao] = useState<string | null>(null);

  const [conferencia, setConferencia] = useState<Conferencia | null>(null);
  const [canal, setCanal] = useState<ConferenciaDoCanalParaAviso | null>(null);
  const [preVoo, setPreVoo] = useState<ConferenciaDoModeloParaAviso | null>(null);
  const [funil, setFunil] = useState<FunilDoModelo[] | null>(null);
  const [modelos, setModelos] = useState<ModeloSincronizado[] | null>(null);

  const recarregar = useCallback(() => setTentativa((t) => t + 1), []);

  // ── Os dados principais: interruptor, canal, próxima rodada ───────────────
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch(ROTA, { cache: "no-store" });
        if (res.status === 401 || res.status === 403) {
          if (vivo) setEstado({ fase: "semAcesso" });
          return;
        }
        if (!res.ok) {
          if (vivo) setEstado({ fase: "erro", detalhe: `${ROTA} respondeu ${res.status}` });
          return;
        }
        const corpo = (await res.json()) as {
          data?: {
            interruptor?: Interruptor;
            canalPronto?: boolean;
            proximaRodadaEm?: string;
          };
        };
        if (!corpo?.data?.interruptor) {
          if (vivo) setEstado({ fase: "erro", detalhe: "resposta em formato inesperado" });
          return;
        }
        if (vivo) {
          setEstado({
            fase: "pronto",
            dados: {
              interruptor: corpo.data.interruptor,
              canalPronto: Boolean(corpo.data.canalPronto),
              proximaRodadaEm: corpo.data.proximaRodadaEm ?? null,
            },
          });
        }
      } catch (e) {
        if (vivo) setEstado({ fase: "erro", detalhe: e instanceof Error ? e.message : null });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [tentativa]);

  // ── A conferência, o canal, o pré-voo e o funil — em paralelo, sem travar
  // a tela principal. Cada um falha em silêncio (o Aviso operacional some
  // esse pedaço da avaliação em vez de derrubar a tela — guardrail 1: ausência
  // de informação não é conclusão de problema, e também não é conclusão de
  // que está tudo bem).
  useEffect(() => {
    if (estado.fase !== "pronto") return;
    let vivo = true;

    (async () => {
      try {
        const res = await fetch(`${ROTA}?recorte=conferencia`, { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { data?: Conferencia } | null;
        if (vivo && res.ok && json?.data) setConferencia(json.data);
      } catch {
        // silencioso — ver comentário acima.
      }
    })();

    (async () => {
      try {
        const res = await fetch(`${ROTA}?recorte=canal`, { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { data?: ConferenciaDoCanalParaAviso } | null;
        if (vivo && res.ok && json?.data) setCanal(json.data);
      } catch {
        // silencioso
      }
    })();

    (async () => {
      try {
        const res = await fetch(`${ROTA}?recorte=preVoo`, { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { data?: ConferenciaDoModeloParaAviso } | null;
        if (vivo && res.ok && json?.data) setPreVoo(json.data);
      } catch {
        // silencioso
      }
    })();

    (async () => {
      try {
        const res = await fetch(`${ROTA}?recorte=funil`, { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as {
          data?: { funil?: FunilDoModelo[]; modelos?: ModeloSincronizado[] };
        } | null;
        if (vivo && res.ok && json?.data) {
          setFunil(json.data.funil ?? []);
          setModelos(json.data.modelos ?? []);
        }
      } catch {
        // silencioso
      }
    })();

    return () => {
      vivo = false;
    };
  }, [estado.fase, tentativa]);

  const agir = useCallback(
    async (corpo: Record<string, unknown>) => {
      setOcupado(true);
      setAvisoDeAcao(null);
      try {
        const res = await fetch(ROTA, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        });
        const json = (await res.json().catch(() => null)) as { error?: string; data?: unknown } | null;
        if (!res.ok) {
          setAvisoDeAcao(json?.error ?? `A ação foi recusada (${res.status}).`);
          return null;
        }
        recarregar();
        return json?.data ?? null;
      } catch (e) {
        setAvisoDeAcao(e instanceof Error ? e.message : "Falha de rede.");
        return null;
      } finally {
        setOcupado(false);
      }
    },
    [recarregar],
  );

  if (estado.fase === "carregando") {
    return <div className="p-6 text-[13px] text-muted">Carregando…</div>;
  }

  if (estado.fase === "semAcesso") {
    return <div className="p-6 text-[13px] text-muted">Sua conta não alcança a prospecção.</div>;
  }

  if (estado.fase === "erro") {
    return (
      <div className="p-6">
        <p className="text-[13px] text-ink">Não foi possível ler a prospecção.</p>
        {estado.detalhe && <p className="mt-1 text-[12.5px] text-muted">{estado.detalhe}</p>}
        <button
          onClick={recarregar}
          className="mt-3 rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-ink"
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  const { interruptor, proximaRodadaEm } = estado.dados;

  const aviso = avaliarAvisoOperacional({
    canal,
    envioAutorizado: conferencia?.envioAutorizado ?? null,
    preVoo,
    conferencia: conferencia
      ? {
          elegiveisSeAtivar: conferencia.elegiveisSeAtivar,
          pendentes: conferencia.pendentes,
          saldoDiario: conferencia.saldoDiario,
          saldoDaJanela: conferencia.saldoDaJanela,
          tetoDoDia: conferencia.tetoDoDia,
        }
      : null,
  });

  return (
    <div className="space-y-5 p-4 sm:p-6">
      {avisoDeAcao && (
        <p className="rounded-lg border border-line bg-paper px-3 py-2 text-[12.5px] text-ink">{avisoDeAcao}</p>
      )}

      {/* ── 1. IMPORTAR CONTATOS ────────────────────────────────────────── */}
      <ImportarContatos aoImportar={recarregar} />

      {/* ── 2. OPERAÇÃO ─────────────────────────────────────────────────── */}
      <OperacaoBlock
        interruptor={interruptor}
        proximaRodadaEm={proximaRodadaEm}
        numeros={
          conferencia
            ? {
                usadosHoje: conferencia.usadosHoje,
                tetoDoDia: conferencia.tetoDoDia,
                elegiveisSeAtivar: conferencia.elegiveisSeAtivar,
                pendentes: conferencia.pendentes,
              }
            : null
        }
        ocupado={ocupado}
        agir={agir}
      />

      {/* ── 3. AVISO OPERACIONAL — só aparece com problema real ─────────── */}
      <AvisoOperacionalView aviso={aviso} />

      {/* ── Modelos de abordagem — fora dos 3 blocos, expansível ─────────── */}
      <TemplatesFunil funil={funil} modelos={modelos} />
    </div>
  );
}
