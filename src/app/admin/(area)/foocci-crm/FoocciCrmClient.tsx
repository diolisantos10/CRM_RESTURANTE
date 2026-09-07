"use client";

/**
 * A tela do CRM da Foocci.
 *
 * TRÊS REGRAS QUE ESTA TELA OBEDECE, E QUE NÃO SÃO NEGOCIÁVEIS:
 *
 * 1. **Nenhum número inventado.** Quando a amostra é pequena, o back-end manda
 *    `taxa: null` + a explicação por extenso, e a tela escreve "ainda não dá para
 *    dizer". Não existe caminho aqui que transforme null em 0%.
 * 2. **Métrica sem período é métrica errada.** Todo número desta tela está preso
 *    ao seletor de período. Não há coluna "vitalícia".
 * 3. **Os três estados existem de verdade** (carregando / vazio / erro). O vazio
 *    é o estado REAL de hoje — a base está zerada — então ele ensina o que fazer
 *    em vez de dizer "nenhum resultado".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ROTULO_ETAPA, DESCRICAO_ETAPA, TODAS_AS_ETAPAS,
  ROTULO_INTERACAO, formataTaxa,
  type FoocciLeadStage, type FoocciInteractionType, type TipoDeInteracao,
} from "@/services/foocci-crm/foocciCrmFunnel";

// ── Tipos do que as rotas devolvem (espelho leve, sem importar Prisma no cliente) ──

interface Degrau {
  de: string; para: string; base: number; alcancaram: number;
  taxa: number | null; motivoSemTaxa: string | null; explicacao: string;
}

interface Performance {
  periodo: { chave: string; rotulo: string; rotuloAnterior: string; dias: number };
  resumo: {
    chegaram: number; chegaramAnterior: number; variacaoPercentual: number | null;
    naoAbordados: number; fechados: number; perdidos: number; emAndamento: number;
    baseTotal: number;
  };
  funil: {
    etapas: Array<{ stage: FoocciLeadStage; alcancaram: number; agora: number }>;
    degraus: Degrau[];
    perdidos: number;
    total: number;
    pontaAPonta: Degrau | null;
    minimoParaTaxa: number;
  };
  origens: Array<{
    rotulo: string; canal: string; canalRotulo: string; campanha: string | null;
    chegaram: number; qualificados: number; fechados: number; perdidos: number;
    taxaFechamento: number | null; explicacaoTaxa: string;
  }>;
  minimoParaTaxa: number;
  semOrigemIdentificada: number;
}

interface Contato {
  id: string; nome: string; codigo: string | null; whatsapp: string; whatsappLink: string | null;
  pediuSilencio: boolean;
  restaurante: string | null; cidade: string | null; tipo: string | null; desafio: string | null;
  stage: FoocciLeadStage; stageChangedAt: string; stageChangedBy: string | null;
  origemRotulo: string; canal: string; utmCampaign: string | null;
  createdAt: string; lastContactedAt: string | null; lastInteractionAt: string | null;
  submissions: number; notifiedAt: string | null; notifyError: string | null; interacoes: number;
}

interface Dossie extends Contato {
  origem: {
    legado: string | null; utmSource: string | null; utmMedium: string | null;
    utmCampaign: string | null; utmContent: string | null; utmTerm: string | null;
    clickId: string | null; landingPath: string | null; referrer: string | null;
    canal: string; rotulo: string;
  };
  respostas: Array<{ pergunta: string; resposta: string }>;
  // `TipoDeInteracao` (os doze do banco), e não o subconjunto que ESTA tela
  // escreve: o histórico mostra tudo que aconteceu, inclusive o que a Sala de
  // Vendas gravou. Declarar o subconjunto aqui foi o que deixou quatro tipos
  // caírem em `ROTULO_INTERACAO[...] === undefined` e renderizarem em branco.
  historico: Array<{
    id: string; tipo: TipoDeInteracao; fromStage: FoocciLeadStage | null;
    toStage: FoocciLeadStage | null; actor: string; nota: string | null; createdAt: string;
  }>;
}

const PERIODOS = [
  { chave: "today",         rotulo: "Hoje" },
  { chave: "7d",            rotulo: "7 dias" },
  { chave: "30d",           rotulo: "30 dias" },
  { chave: "current_month", rotulo: "Este mês" },
  { chave: "last_month",    rotulo: "Mês passado" },
] as const;

// A cor sobe de temperatura conforme o lead avança, e as três terminais fogem
// da escala de propósito: verde para ganho, cinza para perda, azul para espera.
// Quem bate o olho na lista precisa distinguir "acabou bem", "acabou mal" e
// "ainda não acabou" sem ler o rótulo.
const COR_ETAPA: Record<FoocciLeadStage, string> = {
  NOVO:             "bg-sky-500/15 text-sky-300 border-sky-500/30",
  PRIMEIRO_CONTATO: "bg-brand-500/15 text-brand-300 border-brand-500/30",
  EM_QUALIFICACAO:  "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  QUALIFICADO:      "bg-violet-500/15 text-violet-300 border-violet-500/30",
  DEMO_AGENDADA:    "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  DEMO_REALIZADA:   "bg-pink-500/15 text-pink-300 border-pink-500/30",
  PROPOSTA_ENVIADA: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  EM_NEGOCIACAO:    "bg-orange-500/15 text-orange-300 border-orange-500/30",
  GANHO:            "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  PERDIDO:          "bg-gray-500/15 text-gray-400 border-gray-500/30",
  NUTRICAO:         "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
};

const TIPOS_INTERACAO: FoocciInteractionType[] = [
  "MENSAGEM_ENVIADA", "RESPOSTA_RECEBIDA", "LIGACAO", "REUNIAO", "NOTA",
];

function dataHora(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

function dataCurta(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

export function FoocciCrmClient() {
  const [aba, setAba] = useState<"funil" | "base">("funil");
  const [periodo, setPeriodo] = useState<string>("30d");

  const [perf, setPerf] = useState<Performance | null>(null);
  const [contatos, setContatos] = useState<Contato[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [filtroEtapa, setFiltroEtapa] = useState<string>("");
  const [somenteNaoAbordados, setSomenteNaoAbordados] = useState(false);
  const [busca, setBusca] = useState("");

  const [abertoId, setAbertoId] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const q = new URLSearchParams({ period: periodo });
      const qc = new URLSearchParams();
      if (filtroEtapa) qc.set("stage", filtroEtapa);
      if (somenteNaoAbordados) qc.set("naoAbordados", "1");
      if (busca.trim()) qc.set("busca", busca.trim());

      const [rp, rc] = await Promise.all([
        fetch(`/api/admin/foocci-crm/performance?${q}`),
        fetch(`/api/admin/foocci-crm/contatos?${qc}`),
      ]);
      const jp = await rp.json();
      const jc = await rc.json();
      if (!rp.ok || !jp.ok) throw new Error(jp.error ?? `HTTP ${rp.status}`);
      if (!rc.ok || !jc.ok) throw new Error(jc.error ?? `HTTP ${rc.status}`);
      setPerf(jp.data as Performance);
      setContatos((jc.data as { contatos: Contato[] }).contatos);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
    } finally {
      setCarregando(false);
    }
  }, [periodo, filtroEtapa, somenteNaoAbordados, busca]);

  useEffect(() => { void carregar(); }, [carregar]);

  const baseVazia = perf !== null && perf.resumo.baseTotal === 0;

  return (
    <div className="p-4 sm:p-6">
      <Cabecalho />

      {/* Período — obrigatório por construção: nenhum número desta tela é vitalício. */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {PERIODOS.map((p) => (
          <button
            key={p.chave}
            type="button"
            onClick={() => setPeriodo(p.chave)}
            className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors ${
              periodo === p.chave
                ? "border-brand-500 bg-brand-500/15 text-brand-300"
                : "border-gray-800 bg-gray-900 text-gray-400 hover:border-gray-700 hover:text-gray-200"
            }`}
          >
            {p.rotulo}
          </button>
        ))}
      </div>

      {carregando && <Esqueleto />}

      {!carregando && erro && <Erro mensagem={erro} onTentarDeNovo={() => void carregar()} />}

      {!carregando && !erro && baseVazia && <BaseVazia />}

      {!carregando && !erro && !baseVazia && perf && (
        <>
          <Resumo perf={perf} />

          <div className="mt-6 flex gap-1 border-b border-gray-800">
            <Aba ativa={aba === "funil"} onClick={() => setAba("funil")}>Funil e origem</Aba>
            <Aba ativa={aba === "base"} onClick={() => setAba("base")}>
              Base de contatos{contatos ? ` (${contatos.length})` : ""}
            </Aba>
          </div>

          {aba === "funil" ? (
            <SecaoFunil perf={perf} />
          ) : (
            <SecaoBase
              contatos={contatos}
              filtroEtapa={filtroEtapa}
              setFiltroEtapa={setFiltroEtapa}
              somenteNaoAbordados={somenteNaoAbordados}
              setSomenteNaoAbordados={setSomenteNaoAbordados}
              busca={busca}
              setBusca={setBusca}
              onAbrir={setAbertoId}
            />
          )}
        </>
      )}

      {abertoId && (
        <GavetaContato
          id={abertoId}
          onFechar={() => setAbertoId(null)}
          onMudou={() => { void carregar(); }}
        />
      )}
    </div>
  );
}

// ── Pedaços da tela ───────────────────────────────────────────────────────────

function Cabecalho() {
  return (
    <header>
      <h1 className="text-xl font-semibold text-white sm:text-2xl">CRM da Foocci</h1>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-gray-400">
        A base de contatos que a <strong className="font-semibold text-gray-200">Foocci</strong> capturou —
        donos de restaurante vindos do site e das campanhas de tráfego. É desta base que o SDR trabalha.
      </p>
      <p className="mt-1 text-xs text-gray-500">
        Não confundir com o CRM do produto (<code className="rounded bg-gray-800 px-1">/crm</code>),
        que é do lojista para os clientes dele.
      </p>
    </header>
  );
}

function Aba({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px rounded-t-xl border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        ativa
          ? "border-brand-500 text-white"
          : "border-transparent text-gray-500 hover:text-gray-300"
      }`}
    >
      {children}
    </button>
  );
}

function Esqueleto() {
  return (
    <div className="mt-6 space-y-4" aria-busy="true" aria-label="Carregando">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl border border-gray-800 bg-gray-900" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl border border-gray-800 bg-gray-900" />
    </div>
  );
}

function Erro({ mensagem, onTentarDeNovo }: { mensagem: string; onTentarDeNovo: () => void }) {
  return (
    <div className="mt-6 rounded-2xl border border-red-900/60 bg-red-950/40 p-5">
      <p className="text-sm font-semibold text-red-300">Não consegui carregar o CRM</p>
      {/* Guardrail 6: o alerta carrega a própria evidência. */}
      <p className="mt-1 break-words text-sm text-red-200/80">{mensagem}</p>
      <button
        type="button"
        onClick={onTentarDeNovo}
        className="mt-3 rounded-xl bg-red-900/60 px-3 py-1.5 text-sm font-medium text-red-100 hover:bg-red-900"
      >
        Tentar de novo
      </button>
    </div>
  );
}

/**
 * O estado vazio REAL de hoje. Ele ensina, porque quem chega aqui pela primeira
 * vez precisa saber que a base enche sozinha e o que fazer para ela encher certo.
 */
function BaseVazia() {
  return (
    <div className="mt-6 max-w-2xl rounded-2xl border border-dashed border-gray-700 bg-gray-900/60 px-6 py-12 text-center">
      <p className="text-base font-semibold text-gray-100">Nenhum contato na base ainda.</p>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-gray-400">
        Todo formulário de demonstração do site cai aqui na hora — sem depender do e-mail de aviso.
        Enquanto ninguém preencher, esta tela fica assim mesmo, e isso é o certo: número zero é zero,
        não é erro.
      </p>
      <div className="mx-auto mt-6 max-w-xl rounded-xl border border-gray-800 bg-gray-950/60 p-4 text-left">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Para saber qual anúncio funciona
        </p>
        <p className="mt-2 text-sm leading-relaxed text-gray-400">
          Use link com parâmetro de campanha no anúncio. O site guarda a origem da primeira página
          que a pessoa abrir e manda junto com o formulário:
        </p>
        <code className="mt-2 block break-all rounded-lg bg-black/40 px-3 py-2 text-xs text-brand-300">
          https://foocci.com.br/site?utm_source=facebook&amp;utm_medium=cpc&amp;utm_campaign=NOME_DA_CAMPANHA&amp;utm_content=NOME_DO_ANUNCIO
        </code>
        <p className="mt-2 text-xs text-gray-500">
          Sem esses parâmetros o contato entra como <em>&quot;Direto / não identificado&quot;</em> — e aí
          ninguém consegue dizer qual anúncio o trouxe.
        </p>
      </div>
    </div>
  );
}

function Card({ titulo, valor, apoio }: { titulo: string; valor: string; apoio?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{titulo}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{valor}</p>
      {apoio && <div className="mt-1 text-xs text-gray-400">{apoio}</div>}
    </div>
  );
}

function Resumo({ perf }: { perf: Performance }) {
  const r = perf.resumo;
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card
        titulo={`Chegaram (${perf.periodo.rotulo})`}
        valor={String(r.chegaram)}
        apoio={
          r.variacaoPercentual === null
            ? <span>Sem base anterior para comparar</span>
            : <span className={r.variacaoPercentual >= 0 ? "text-emerald-400" : "text-red-400"}>
                {r.variacaoPercentual >= 0 ? "+" : ""}
                {(r.variacaoPercentual * 100).toFixed(0)}% {perf.periodo.rotuloAnterior}
              </span>
        }
      />
      <Card
        titulo="Ainda não abordados"
        valor={String(r.naoAbordados)}
        apoio={<span>a fila de trabalho do SDR</span>}
      />
      <Card titulo="Fechados no período" valor={String(r.fechados)} apoio={<span>{r.emAndamento} em andamento · {r.perdidos} perdidos</span>} />
      <Card titulo="Base inteira" valor={String(r.baseTotal)} apoio={<span>contatos desde o início</span>} />
    </div>
  );
}

function SecaoFunil({ perf }: { perf: Performance }) {
  const maior = Math.max(...perf.funil.etapas.map((e) => e.alcancaram), 1);

  return (
    <div className="mt-5 space-y-5">
      {/* ── Funil ───────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-800 bg-gray-900 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-white">
          Funil dos contatos que chegaram · {perf.periodo.rotulo}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">
          Coorte de chegada: acompanha quem <em>entrou</em> no período, mesmo que tenha avançado depois.
          Quem já alcançou uma etapa conta nela para sempre, ainda que hoje esteja perdido.
        </p>

        <div className="mt-4 space-y-1">
          {perf.funil.etapas.map((e, i) => {
            const degrau = perf.funil.degraus[i - 1];
            return (
              <div key={e.stage}>
                {degrau && (
                  <div className="flex items-center gap-2 py-1.5 pl-3 text-xs">
                    <span className="text-gray-600">↓</span>
                    {degrau.taxa === null ? (
                      <span className="text-amber-400/90">{degrau.explicacao}</span>
                    ) : (
                      <span className="text-gray-400">
                        <strong className="font-semibold text-white">{formataTaxa(degrau.taxa)}</strong>{" "}
                        avançaram — {degrau.alcancaram} de {degrau.base}
                      </span>
                    )}
                  </div>
                )}
                <div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-sm font-semibold text-gray-100">{ROTULO_ETAPA[e.stage]}</span>
                    <span className="text-sm text-gray-400">
                      <strong className="font-semibold text-white">{e.alcancaram}</strong> alcançaram
                      <span className="text-gray-600"> · </span>
                      {e.agora} aqui agora
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-800">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${Math.max((e.alcancaram / maior) * 100, e.alcancaram > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-gray-500">{DESCRICAO_ETAPA[e.stage]}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-800 pt-3 text-xs">
          <span className="text-gray-400">
            Fora do funil: <strong className="text-gray-200">{perf.funil.perdidos}</strong> perdidos
          </span>
          {perf.funil.pontaAPonta && (
            <span className={perf.funil.pontaAPonta.taxa === null ? "text-amber-400/90" : "text-gray-400"}>
              Ponta a ponta: {perf.funil.pontaAPonta.taxa === null
                ? perf.funil.pontaAPonta.explicacao
                : `${formataTaxa(perf.funil.pontaAPonta.taxa)} dos que chegaram fecharam`}
            </span>
          )}
        </div>
      </section>

      {/* ── Origem ──────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-800 bg-gray-900 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-white">De onde vieram</h2>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">
          Agrupado pela campanha e pelo anúncio do link de entrada. Taxa só aparece a partir de{" "}
          {perf.minimoParaTaxa} contatos na origem — abaixo disso, o que existe são as contagens.
        </p>

        {perf.origens.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-gray-700 px-4 py-8 text-center text-sm text-gray-500">
            Nenhum contato chegou neste período.
          </p>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="py-2 pr-4 font-semibold">Origem</th>
                    <th className="py-2 pr-4 font-semibold">Canal</th>
                    <th className="py-2 pr-4 text-right font-semibold">Chegaram</th>
                    <th className="py-2 pr-4 text-right font-semibold">Qualificados</th>
                    <th className="py-2 pr-4 text-right font-semibold">Fechados</th>
                    <th className="py-2 font-semibold">Conversão</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/70">
                  {perf.origens.map((o) => (
                    <tr key={o.rotulo} className="align-top">
                      <td className="py-2.5 pr-4 font-medium text-gray-100">{o.rotulo}</td>
                      <td className="py-2.5 pr-4 text-gray-400">{o.canalRotulo}</td>
                      <td className="py-2.5 pr-4 text-right text-gray-200">{o.chegaram}</td>
                      <td className="py-2.5 pr-4 text-right text-gray-400">{o.qualificados}</td>
                      <td className="py-2.5 pr-4 text-right text-gray-400">{o.fechados}</td>
                      <td className="py-2.5">
                        {o.taxaFechamento === null ? (
                          <span className="text-xs text-amber-400/90">ainda não dá para dizer</span>
                        ) : (
                          <span className="font-semibold text-white">{formataTaxa(o.taxaFechamento)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {perf.semOrigemIdentificada > 0 && (
              <p className="mt-3 rounded-xl border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
                <strong>{perf.semOrigemIdentificada}</strong>{" "}
                {perf.semOrigemIdentificada === 1 ? "contato chegou" : "contatos chegaram"} sem nenhum
                sinal de campanha. Eles entraram direto ou o link do anúncio veio sem parâmetro —
                use <code className="rounded bg-black/30 px-1">utm_campaign</code> nos anúncios para
                que apareçam separados aqui.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function SecaoBase({
  contatos, filtroEtapa, setFiltroEtapa, somenteNaoAbordados, setSomenteNaoAbordados,
  busca, setBusca, onAbrir,
}: {
  contatos: Contato[] | null;
  filtroEtapa: string;
  setFiltroEtapa: (v: string) => void;
  somenteNaoAbordados: boolean;
  setSomenteNaoAbordados: (v: boolean) => void;
  busca: string;
  setBusca: (v: string) => void;
  onAbrir: (id: string) => void;
}) {
  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar nome, restaurante, cidade, telefone ou código (#A7K2M)"
          /* `!border-*`: o globals.css tem uma regra base para input/select/textarea
             com a borda clara do painel do lojista, e ela vence por especificidade
             num tema escuro. Corrigido aqui, na tela que estou tocando. */
          className="min-w-[220px] flex-1 rounded-xl border !border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none placeholder:text-gray-600 focus:!border-brand-500"
        />
        <select
          value={filtroEtapa}
          onChange={(e) => setFiltroEtapa(e.target.value)}
          aria-label="Filtrar por etapa"
          className="rounded-xl border !border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:!border-brand-500"
        >
          <option value="">Todas as etapas</option>
          {TODAS_AS_ETAPAS.map((s) => (
            <option key={s} value={s}>{ROTULO_ETAPA[s]}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setSomenteNaoAbordados(!somenteNaoAbordados)}
          className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
            somenteNaoAbordados
              ? "border-brand-500 bg-brand-500/15 text-brand-300"
              : "border-gray-800 bg-gray-900 text-gray-400 hover:text-gray-200"
          }`}
        >
          Só não abordados
        </button>
      </div>

      {contatos === null || contatos.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-gray-700 px-4 py-10 text-center text-sm text-gray-500">
          Nenhum contato com esses filtros.
        </p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-2xl border border-gray-800">
          {/* Celular: cartões. Tabela de 8 colunas em 375px é ilegível. */}
          <ul className="divide-y divide-gray-800 lg:hidden">
            {contatos.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onAbrir(c.id)}
                  className="w-full bg-gray-900 px-4 py-3 text-left hover:bg-gray-800/60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium text-gray-100">
                      {c.nome}
                      {c.codigo && <CodigoDoLead codigo={c.codigo} />}
                    </span>
                    <Selo stage={c.stage} />
                  </div>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {c.restaurante ?? "restaurante não informado"}
                    {c.cidade ? ` · ${c.cidade}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {dataCurta(c.createdAt)} · {c.origemRotulo}
                  </p>
                  {!c.lastContactedAt && (
                    <p className="mt-1 text-xs font-medium text-brand-400">ainda não abordado</p>
                  )}
                </button>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto lg:block">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-900 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Quando</th>
                  <th className="px-4 py-3 font-semibold">Nome</th>
                  <th className="px-4 py-3 font-semibold">Restaurante</th>
                  <th className="px-4 py-3 font-semibold">Cidade</th>
                  <th className="px-4 py-3 font-semibold">Origem</th>
                  <th className="px-4 py-3 font-semibold">Etapa</th>
                  <th className="px-4 py-3 font-semibold">Último contato</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800 bg-gray-950/40">
                {contatos.map((c) => (
                  <tr key={c.id} className="align-middle hover:bg-gray-900/60">
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">{dataCurta(c.createdAt)}</td>
                    <td className="px-4 py-3 font-medium text-gray-100">
                      {c.nome}
                      {c.codigo && <CodigoDoLead codigo={c.codigo} />}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{c.restaurante ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-400">{c.cidade ?? "—"}</td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-gray-400" title={c.origemRotulo}>
                      {c.origemRotulo}
                    </td>
                    <td className="px-4 py-3"><Selo stage={c.stage} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-400">
                      {c.lastContactedAt
                        ? dataCurta(c.lastContactedAt)
                        : <span className="text-brand-400">nunca</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => onAbrir(c.id)}
                        className="rounded-lg border border-gray-700 px-2.5 py-1 text-xs font-medium text-gray-300 hover:border-brand-500 hover:text-brand-300"
                      >
                        Abrir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * O código que a pessoa leva junto no "oi" do WhatsApp. Fica colado no nome de
 * propósito: quando a mensagem chega com `#A7K2M`, quem atende precisa achar
 * ESTA linha — e a busca do topo aceita o código exatamente como foi colado.
 */
function CodigoDoLead({ codigo }: { codigo: string }) {
  return (
    <span className="ml-2 rounded-md bg-gray-800 px-1.5 py-0.5 align-middle text-[11px] font-semibold tracking-wide text-gray-400">
      #{codigo}
    </span>
  );
}

function Selo({ stage }: { stage: FoocciLeadStage }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${COR_ETAPA[stage]}`}>
      {ROTULO_ETAPA[stage]}
    </span>
  );
}

// ── Gaveta do contato — o que o SDR vê, e o que o CEO edita ───────────────────

function GavetaContato({ id, onFechar, onMudou }: { id: string; onFechar: () => void; onMudou: () => void }) {
  const [dossie, setDossie] = useState<Dossie | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [nota, setNota] = useState("");
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/admin/foocci-crm/contatos/${id}`);
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setDossie(j.data as Dossie);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao abrir o contato.");
    } finally {
      setCarregando(false);
    }
  }, [id]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function mover(para: FoocciLeadStage) {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/admin/foocci-crm/contatos/${id}/etapa`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ para, nota: nota.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setNota("");
      await carregar();
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui mudar a etapa.");
    } finally {
      setSalvando(false);
    }
  }

  async function registrar(tipo: FoocciInteractionType) {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/admin/foocci-crm/contatos/${id}/interacao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, nota: nota.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setNota("");
      await carregar();
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui registrar.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    setSalvando(true);
    try {
      const r = await fetch(`/api/admin/foocci-crm/contatos/${id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      onMudou();
      onFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui excluir.");
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onFechar} aria-hidden="true" />
      <aside
        role="dialog"
        aria-label="Contato"
        className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-gray-800 bg-gray-950 shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-800 bg-gray-950/95 px-4 py-3 backdrop-blur">
          <h2 className="truncate text-base font-semibold text-white">
            {dossie?.nome ?? "Contato"}
          </h2>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="rounded-lg px-2 py-1 text-gray-400 hover:bg-gray-800 hover:text-gray-100"
          >
            ✕
          </button>
        </div>

        {carregando && (
          <div className="space-y-3 p-4" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl border border-gray-800 bg-gray-900" />
            ))}
          </div>
        )}

        {!carregando && erro && !dossie && (
          <div className="p-4">
            <Erro mensagem={erro} onTentarDeNovo={() => void carregar()} />
          </div>
        )}

        {dossie && (
          <div className="space-y-4 p-4">
            {erro && (
              <p role="alert" className="rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                {erro}
              </p>
            )}

            {/* Quem é — o cartão que o SDR lê antes de abordar */}
            <section className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Selo stage={dossie.stage} />
                <span className="text-xs text-gray-500">
                  desde {dataHora(dossie.stageChangedAt)}
                  {dossie.stageChangedBy ? ` · por ${dossie.stageChangedBy}` : ""}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                {/* Quem pediu silêncio não vira link clicável — e o motivo
                    aparece ao lado do número, não numa nota de rodapé. Sem isto
                    o vendedor abria o dossiê de quem mandou "PARE", via o número
                    em laranja, clicava, e o WhatsApp abria a conversa. */}
                <Linha rotulo="WhatsApp" valor={
                  dossie.pediuSilencio
                    ? (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <span className="text-gray-300">{dossie.whatsapp}</span>
                        <span className="rounded-lg border border-amber-900/60 bg-amber-950/40 px-2 py-0.5 text-xs font-medium text-amber-200">
                          pediu silêncio — não contate
                        </span>
                      </span>
                    )
                    : dossie.whatsappLink
                      ? <a href={dossie.whatsappLink} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-400 hover:underline">{dossie.whatsapp}</a>
                      : <span className="text-gray-300">{dossie.whatsapp}</span>
                } />
                <Linha rotulo="Restaurante" valor={dossie.restaurante ?? "—"} />
                <Linha rotulo="Cidade" valor={dossie.cidade ?? "—"} />
                <Linha rotulo="Entrou em" valor={dataHora(dossie.createdAt)} />
                <Linha rotulo="Último contato nosso" valor={dossie.lastContactedAt ? dataHora(dossie.lastContactedAt) : "nunca abordado"} />
                <Linha rotulo="Formulários preenchidos" valor={String(dossie.submissions)} />
              </dl>
              {/* Guardrail 6: o aviso por e-mail é conveniência, mas quando ele
                  falha o motivo aparece — com o caso concreto, não "algo falhou". */}
              {!dossie.notifiedAt && (
                <p className="mt-3 rounded-xl border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
                  O aviso por e-mail deste contato não saiu
                  {dossie.notifyError ? `: ${dossie.notifyError}` : "."} O contato está salvo do
                  mesmo jeito — esta base é o cofre, o e-mail é só o aviso.
                </p>
              )}
            </section>

            {/* O que ele respondeu */}
            <section className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
              <h3 className="text-sm font-semibold text-white">O que respondeu no formulário</h3>
              {dossie.respostas.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">
                  Só nome e WhatsApp — os outros campos do formulário são opcionais e ele não preencheu.
                </p>
              ) : (
                <dl className="mt-2 space-y-1.5 text-sm">
                  {dossie.respostas.map((r) => (
                    <Linha key={r.pergunta} rotulo={r.pergunta} valor={r.resposta} />
                  ))}
                </dl>
              )}
            </section>

            {/* De onde veio */}
            <section className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
              <h3 className="text-sm font-semibold text-white">De onde veio</h3>
              <p className="mt-1 text-sm text-gray-300">{dossie.origem.rotulo}</p>
              <dl className="mt-2 space-y-1 text-xs">
                {dossie.origem.utmCampaign && <Linha rotulo="Campanha" valor={dossie.origem.utmCampaign} />}
                {dossie.origem.utmContent && <Linha rotulo="Anúncio" valor={dossie.origem.utmContent} />}
                {dossie.origem.utmSource && <Linha rotulo="Fonte" valor={dossie.origem.utmSource} />}
                {dossie.origem.utmMedium && <Linha rotulo="Mídia" valor={dossie.origem.utmMedium} />}
                {dossie.origem.referrer && <Linha rotulo="Veio de" valor={dossie.origem.referrer} />}
                {dossie.origem.landingPath && <Linha rotulo="Entrou por" valor={dossie.origem.landingPath} />}
                {dossie.origem.legado && <Linha rotulo="Enviou de" valor={dossie.origem.legado} />}
              </dl>
              {!dossie.origem.utmSource && !dossie.origem.utmCampaign && !dossie.origem.clickId && !dossie.origem.referrer && (
                <p className="mt-2 text-xs text-amber-400/90">
                  Sem sinal de campanha. Não dá para dizer qual anúncio trouxe este contato —
                  e chutar seria pior que não saber.
                </p>
              )}
            </section>

            {/* Registrar o que aconteceu */}
            <section className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
              <h3 className="text-sm font-semibold text-white">Registrar</h3>
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                rows={2}
                placeholder="Observação (opcional) — vai junto com o registro"
                className="mt-2 w-full rounded-xl border !border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none placeholder:text-gray-600 focus:!border-brand-500"
              />

              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-gray-500">O que aconteceu</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {TIPOS_INTERACAO.map((t) => (
                  <button
                    key={t}
                    type="button"
                    disabled={salvando}
                    onClick={() => void registrar(t)}
                    className="rounded-xl border border-gray-700 px-2.5 py-1.5 text-xs font-medium text-gray-300 hover:border-brand-500 hover:text-brand-300 disabled:opacity-50"
                  >
                    {ROTULO_INTERACAO[t]}
                  </button>
                ))}
              </div>

              <p className="mt-4 text-xs font-medium uppercase tracking-wide text-gray-500">Mover para a etapa</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {TODAS_AS_ETAPAS.filter((s) => s !== dossie.stage).map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={salvando}
                    onClick={() => void mover(s)}
                    className="rounded-xl border border-gray-700 px-2.5 py-1.5 text-xs font-medium text-gray-300 hover:border-brand-500 hover:text-brand-300 disabled:opacity-50"
                  >
                    {ROTULO_ETAPA[s]}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-600">
                Toda mudança fica registrada com autor e data no histórico abaixo.
              </p>
            </section>

            {/* Histórico */}
            <section className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
              <h3 className="text-sm font-semibold text-white">Histórico de contato</h3>
              <p className="mt-0.5 text-xs text-gray-500">
                É isto que o agente SDR lê antes de abordar. Não se apaga.
              </p>
              <ol className="mt-3 space-y-2.5">
                {dossie.historico.map((h) => (
                  <li key={h.id} className="border-l-2 border-gray-800 pl-3">
                    <p className="text-sm text-gray-200">
                      {ROTULO_INTERACAO[h.tipo]}
                      {h.tipo === "MUDANCA_ETAPA" && h.toStage && (
                        <span className="text-gray-400">
                          {" "}— {h.fromStage ? ROTULO_ETAPA[h.fromStage] : "início"} → {ROTULO_ETAPA[h.toStage]}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">
                      {dataHora(h.createdAt)} · por {h.actor}
                    </p>
                    {h.nota && <p className="mt-0.5 text-xs italic text-gray-400">“{h.nota}”</p>}
                  </li>
                ))}
              </ol>
            </section>

            {/* Excluir — LGPD e o lead de teste */}
            <section className="rounded-2xl border border-red-900/40 bg-red-950/20 p-4">
              <h3 className="text-sm font-semibold text-red-300">Excluir contato</h3>
              <p className="mt-1 text-xs leading-relaxed text-red-200/70">
                Apaga o contato e todo o histórico dele, sem volta. É o direito de eliminação da LGPD —
                e o jeito de tirar um contato de teste da base.
              </p>
              {confirmandoExclusao ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={salvando}
                    onClick={() => void excluir()}
                    className="rounded-xl bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Confirmo, excluir {dossie.nome}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmandoExclusao(false)}
                    className="rounded-xl border border-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:text-white"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmandoExclusao(true)}
                  className="mt-3 rounded-xl border border-red-800 px-3 py-1.5 text-sm font-medium text-red-300 hover:bg-red-950/60"
                >
                  Excluir
                </button>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <dt className="text-xs text-gray-500">{rotulo}:</dt>
      <dd className="text-gray-300">{valor}</dd>
    </div>
  );
}
