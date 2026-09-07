"use client";

/**
 * A PROSPECÇÃO — a tela onde a casa decide falar com estranhos.
 *
 * ── O QUE ESTA TELA MOSTRA, E POR QUE NESTA ORDEM ───────────────────────────
 *
 * Primeiro o INTERRUPTOR, antes de qualquer lista. Quem abre esta tela precisa
 * saber, em um segundo, se a casa está abordando gente agora — e conseguir
 * parar sem procurar o botão. Uma tela de prospecção que começa pela lista
 * enterra o freio embaixo do acelerador.
 *
 * Depois a FILA DO DIA, com os barrados JUNTO dos liberados. Filtrar o barrado
 * deixaria a tela bonita e a operação cega: quem some da lista sem motivo é
 * exatamente o lead que ninguém vai investigar.
 *
 * Por último os LOTES, que é onde se autoriza.
 *
 * ── ⚠️ NADA AQUI ENVIA MENSAGEM ─────────────────────────────────────────────
 *
 * Esta tela seleciona e mostra. A entrega continua atrás de
 * `FOOCCI_SDR_SEND_ENABLED`, no ambiente, e é do dono. Com a prospecção ligada
 * e a entrega desligada, esta tela responde à pergunta mais útil antes da
 * estreia: **"quem SERIA abordado hoje?"** — sem abordar ninguém.
 */

import { useCallback, useEffect, useState } from "react";
import { ReceberLista } from "./ReceberLista";

const ROTA = "/api/admin/sala-de-vendas/prospeccao";

interface Decisao {
  sendable: boolean;
  reason: string | null;
  detail: string;
}

interface Candidato {
  itemId: string;
  loteId: string;
  /** `null` enquanto o contato ainda não virou lead — e isso é o normal. */
  leadId: string | null;
  nome: string | null;
  whatsapp: string;
  decisao: Decisao;
}

interface Fila {
  liberados: Candidato[];
  barrados: Candidato[];
  motivoDaFilaVazia: string | null;
  usadosHoje: number;
  tetoDoDia: number;
}

interface Lote {
  id: string;
  nome: string;
  proveniencia: string;
  situacao: "RASCUNHO" | "LIBERADO" | "PAUSADO" | "ENCERRADO";
  limiteDiario: number;
  criadoEm: string;
  liberadoPor: string | null;
  _count?: { itens: number };
}

interface Interruptor {
  outboundLigado: boolean;
  limiteDiario: number;
  horasEntreAbordagens: number;
  pausadoEm: string | null;
  motivo: string | null;
}

interface Dados {
  fila: Fila;
  lotes: Lote[];
  interruptor: Interruptor;
  canalPronto: boolean;
}

type Estado =
  | { fase: "carregando" }
  | { fase: "pronto"; dados: Dados }
  | { fase: "semAcesso" }
  | { fase: "erro"; detalhe: string | null };

export function ProspeccaoClient() {
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [tentativa, setTentativa] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  /** Quantas abordagens por dia. Vazio até a tela ler o que está no banco. */
  const [teto, setTeto] = useState<string>("");

  const recarregar = useCallback(() => setTentativa((t) => t + 1), []);

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
        const corpo = (await res.json()) as { data?: Dados };
        if (!corpo?.data) {
          if (vivo) setEstado({ fase: "erro", detalhe: "resposta em formato inesperado" });
          return;
        }
        if (vivo) setEstado({ fase: "pronto", dados: corpo.data });
      } catch (e) {
        if (vivo) setEstado({ fase: "erro", detalhe: e instanceof Error ? e.message : null });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [tentativa]);

  const agir = useCallback(
    async (corpo: Record<string, unknown>) => {
      setOcupado(true);
      setAviso(null);
      try {
        const res = await fetch(ROTA, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        });
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) {
          // A recusa do servidor aparece com as palavras dele. Traduzir aqui
          // faria a tela inventar um motivo que o servidor não deu.
          setAviso(json?.error ?? `A ação foi recusada (${res.status}).`);
          return;
        }
        recarregar();
      } catch (e) {
        setAviso(e instanceof Error ? e.message : "Falha de rede.");
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
    return (
      <div className="p-6 text-[13px] text-muted">
        Sua conta não alcança a prospecção.
      </div>
    );
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

  const { fila, lotes, interruptor, canalPronto } = estado.dados;
  const pausada = Boolean(interruptor.pausadoEm);
  const ligada = interruptor.outboundLigado && !pausada;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {aviso && (
        <p className="rounded-lg border border-line bg-paper px-3 py-2 text-[12.5px] text-ink">
          {aviso}
        </p>
      )}

      {/* ── ONDE A LISTA ENTRA ──────────────────────────────────────────────
          Fica DEPOIS do freio e ANTES da fila, e é o lugar certo: quem chega
          com um arquivo na mão precisa ver o interruptor primeiro (a casa está
          abordando agora?) e a porta de entrada logo em seguida — sem rolar
          até o fim da tela, que é onde os lotes moram. */}
      <ReceberLista aoImportar={recarregar} />

      {/* ── O FREIO, ANTES DA LISTA ── */}
      <section className="rounded-xl border border-line bg-paper p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">
              {ligada ? "Prospecção LIGADA" : pausada ? "Prospecção PAUSADA" : "Prospecção desligada"}
            </h2>
            <p className="mt-0.5 text-[12.5px] text-muted">
              {fila.usadosHoje} de {fila.tetoDoDia} abordagens hoje
              {interruptor.motivo ? ` · ${interruptor.motivo}` : ""}
            </p>
          </div>

          <div className="flex gap-2">
            {ligada ? (
              <button
                disabled={ocupado}
                onClick={() => agir({ acao: "interruptor", pausar: true, motivo: "pausa manual" })}
                className="rounded-lg bg-ink px-3 py-1.5 text-[13px] font-semibold text-paper disabled:opacity-50"
              >
                Pausar agora
              </button>
            ) : (
              <div className="flex items-center gap-2">
                {/* O teto vem ANTES do botão, e não numa tela de configuração
                    escondida: ligar sem dizer quantos é o gesto que produz uma
                    prospecção ligada que não aborda ninguém. */}
                <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
                  <span>Máx./dia</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={teto}
                    onChange={(e) => setTeto(e.target.value)}
                    placeholder={String(interruptor.limiteDiario || "")}
                    className="w-16 rounded-lg border border-line bg-canvas px-2 py-1 text-[13px] text-ink"
                  />
                </label>
                <button
                  disabled={ocupado}
                  onClick={() =>
                    agir({
                      acao: "interruptor",
                      ligado: true,
                      ...(teto.trim() !== "" ? { limiteDiario: Number(teto) } : {}),
                    })
                  }
                  className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-ink disabled:opacity-50"
                >
                  Ligar prospecção
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Dizer que o canal está desligado é obrigação, não detalhe: sem isto a
            fila apareceria cheia de barrados e ninguém saberia por quê. */}
        {!canalPronto && (
          <p className="mt-3 rounded-lg border border-line px-3 py-2 text-[12.5px] text-muted">
            O canal de envio está desligado. A fila continua sendo calculada e
            <strong className="text-ink"> nenhuma mensagem sai</strong> — é o
            estado certo para conferir a lista antes da estreia.
          </p>
        )}
      </section>

      {/* ── A FILA DO DIA ── */}
      <section>
        <h2 className="text-[15px] font-semibold text-ink">Fila de hoje</h2>

        {fila.motivoDaFilaVazia ? (
          <p className="mt-2 text-[12.5px] text-muted">{fila.motivoDaFilaVazia}</p>
        ) : (
          <div className="mt-3 space-y-4">
            <div>
              <h3 className="text-[13px] font-semibold text-ink">
                Liberados ({fila.liberados.length})
              </h3>
              <ul className="mt-1.5 space-y-1">
                {fila.liberados.map((c) => (
                  <li
                    key={c.itemId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-paper px-3 py-2 text-[13px] text-ink"
                  >
                    <span className="min-w-0 truncate">
                      {c.nome ?? "Sem nome"} · {c.whatsapp}
                    </span>

                    {/* ⚠️ UM botão por contato, e nenhum "abordar todos".
                        Dez abordagens são dez cliques, e o freio de ritmo é lido
                        de novo a cada um. Um botão de lote leria o freio uma vez
                        e valeria para a lista inteira — que é exatamente o que o
                        freio existe para impedir. O dia em que a operação pedir
                        volume, o certo é uma fila com ritmo próprio, não um
                        laço disparado por clique. */}
                    <button
                      disabled={ocupado}
                      onClick={() => agir({ acao: "abordar", itemId: c.itemId })}
                      className="shrink-0 rounded-lg bg-brand-500 px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                    >
                      Abordar
                    </button>
                  </li>
                ))}
                {fila.liberados.length === 0 && (
                  <li className="text-[12.5px] text-muted">Ninguém liberado agora.</li>
                )}
              </ul>
            </div>

            <div>
              <h3 className="text-[13px] font-semibold text-ink">
                Barrados ({fila.barrados.length})
              </h3>
              <ul className="mt-1.5 space-y-1">
                {fila.barrados.map((c) => (
                  <li
                    key={c.itemId}
                    className="rounded-lg border border-line bg-paper px-3 py-2 text-[13px]"
                  >
                    <span className="text-ink">{c.nome ?? "Sem nome"}</span>
                    <span className="ml-2 text-[12.5px] text-muted">{c.decisao.detail}</span>
                  </li>
                ))}
                {fila.barrados.length === 0 && (
                  <li className="text-[12.5px] text-muted">Ninguém barrado.</li>
                )}
              </ul>
            </div>
          </div>
        )}
      </section>

      {/* ── OS LOTES ── */}
      <section>
        <h2 className="text-[15px] font-semibold text-ink">Lotes</h2>
        <ul className="mt-3 space-y-2">
          {lotes.map((l) => (
            <li key={l.id} className="rounded-xl border border-line bg-paper p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-ink">
                    {l.nome} · {l.situacao}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-muted">
                    {l._count?.itens ?? 0} contatos · {l.proveniencia}
                  </p>
                  {l.liberadoPor && (
                    <p className="mt-0.5 text-[12px] text-muted">Liberado por {l.liberadoPor}</p>
                  )}
                </div>

                <div className="flex gap-2">
                  {l.situacao !== "LIBERADO" && l.situacao !== "ENCERRADO" && (
                    <button
                      disabled={ocupado}
                      onClick={() => agir({ acao: "liberar", loteId: l.id })}
                      className="rounded-lg border border-line px-2.5 py-1 text-[12.5px] font-semibold text-ink disabled:opacity-50"
                    >
                      Liberar
                    </button>
                  )}
                  {l.situacao === "LIBERADO" && (
                    <button
                      disabled={ocupado}
                      onClick={() => agir({ acao: "pausarLote", loteId: l.id })}
                      className="rounded-lg border border-line px-2.5 py-1 text-[12.5px] font-semibold text-ink disabled:opacity-50"
                    >
                      Pausar
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
          {lotes.length === 0 && (
            <li className="text-[12.5px] text-muted">
              Nenhum lote carregado. A lista entra por importação conferida, em
              partes — lote grande é o que ninguém confere antes de liberar.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
