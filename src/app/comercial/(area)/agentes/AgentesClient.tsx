"use client";

/**
 * OS NOVE AGENTES COMERCIAIS — ficha, verdade e desempenho na mesma tela.
 *
 * ── POR QUE FICHA E DESEMPENHO JUNTOS ───────────────────────────────────────
 *
 * A ficha sozinha é um documento: diz o que a função pode e não pode, e envelhece
 * sem ninguém perceber. O desempenho sozinho é um número sem régua: "8 handoffs"
 * não diz se é muito.
 *
 * Juntos eles se cobram. A ficha diz **"mede-se por: taxa e motivo de handoff"**,
 * e o número ao lado responde. Quando o número não existe, a tela diz por quê — e
 * "o agente está desligado" é uma resposta melhor que um zero.
 *
 * ── ⚠️ E POR QUE A MATRIZ DE VERDADE ENTROU NA FRENTE (10/09/2026) ──────────
 *
 * Esta tela mostrava nove cartões iguais, cada um com selo de ligado/desligado.
 * Nove cartões com interruptor afirmam nove inteligências autônomas esperando
 * uma decisão. **São duas** — Abordagem e TA. As outras sete são cargo humano,
 * postura do TA, ou ficha que ninguém implementou.
 *
 * O selo era o pior pedaço: ele vinha de `AgentProfile.isRuntimeEnabled`, que
 * nasce `false` em toda ficha e **não liga nada em produção**. Quem lesse
 * "desligado" em sete cartões concluiria que existem sete agentes a ligar.
 *
 * A correção não é apagar o desempenho: é pôr a verdade ANTES dele, na mesma
 * tela, com o executor de cada ficha escrito por extenso. Quem abrir tem que
 * responder "quantas inteligências existem?" em cinco segundos — e a resposta
 * tem que ser um número, não uma contagem de cartões.
 *
 * ── O QUE ESTA TELA NÃO FAZ ─────────────────────────────────────────────────
 *
 * Não liga, não desliga, não edita. Não há botão que salve nada — ligar um agente
 * é decisão do proprietário, uma por uma, com gate, e um botão aqui seria o
 * atalho que contorna isso. Botão que não deveria existir é pior que botão que
 * não funciona.
 */

import { useEffect, useState, type ReactNode } from "react";

type Medida =
  | { medido: true; valor: number; nota?: string }
  | { medido: false; motivo: string };

interface Agente {
  numero: string;
  slug: string;
  nome: string;
  modo: "IA" | "HUMANO" | "HIBRIDO";
  resumo: string | null;
  pode: string[];
  naoPode: string[];
  escalaQuando: string[];
  medeSePor: string[];
  regraDura: string[];
  cadastrada: boolean;
  status: string | null;
  ligada: boolean;
  pessoas: number;
  desempenho: {
    mensagens: Medida;
    handoffs: Medida;
    qa: Medida;
    leadsAgora: Medida;
  };
}

interface Resumo {
  total: number;
  deIA: number;
  humanos: number;
  hibridos: number;
  cadastradas: number;
  ligadas: number;
  ocupados: number;
}

type CodigoDeEstado =
  | "SEM_RUNTIME"
  | "POSTURA_DE_OUTRO_RUNTIME"
  | "DESLIGADO"
  | "LIGADO_MAS_MUDO"
  | "LIGADO"
  | "NAO_MEDIDO";

interface LinhaDaMatriz {
  ficha: { numero: string; slug: string; nome: string };
  modoDeclarado: "IA" | "HUMANO" | "HIBRIDO";
  executorReal: string | null;
  executadaPor: string | null;
  modeloReal: string | null;
  agentId: string | null;
  promptOuPolitica: string | null;
  gatilho: string | null;
  ferramentas: string[];
  bancoLido: string[];
  bancoEscrito: string[];
  killSwitch: { onde: string | null; ligado: boolean | null; naoConfundirCom: string | null };
  estadoAtual: { codigo: CodigoDeEstado; frase: string };
  provaDeExecucao: string | null;
  outrosChamadores: string[];
  observacao: string | null;
}

interface Verdade {
  fichas: number;
  comRuntime: number;
  posturas: number;
  semRuntime: number;
  usamModelo: number;
  falandoAgora: number;
}

type Estado =
  | { fase: "carregando" }
  | {
      fase: "pronto";
      agentes: Agente[];
      resumo: Resumo;
      matriz: LinhaDaMatriz[];
      verdade: Verdade;
    }
  | { fase: "semAcesso" }
  | { fase: "erro"; detalhe: string | null };

const COR_MODO: Record<string, string> = {
  IA: "border-violet-200 bg-violet-50 text-violet-700",
  HUMANO: "border-sky-200 bg-sky-50 text-sky-700",
  HIBRIDO: "border-teal-200 bg-teal-50 text-teal-700",
};

const ROTULO_MODO: Record<string, string> = {
  IA: "IA",
  HUMANO: "humano",
  HIBRIDO: "híbrido",
};

/**
 * O selo de estado, e a razão de cada palavra.
 *
 * "FICHA SEM RUNTIME" é escrito por extenso, e nunca "desligado". Desligado
 * afirma que existe algo para ligar — é a frase que criou o mal-entendido que
 * esta tela agora desfaz. Sem runtime afirma que não existe.
 */
const SELO: Record<CodigoDeEstado, { texto: string; tom: string }> = {
  LIGADO: {
    texto: "COM RUNTIME · ligado",
    tom: "border-emerald-300 bg-emerald-50 text-emerald-800",
  },
  LIGADO_MAS_MUDO: {
    texto: "COM RUNTIME · ligado, mudo",
    tom: "border-amber-300 bg-amber-50 text-amber-900",
  },
  DESLIGADO: {
    texto: "COM RUNTIME · desligado",
    tom: "border-slate-300 bg-slate-100 text-slate-700",
  },
  NAO_MEDIDO: {
    texto: "COM RUNTIME · não medido",
    tom: "border-slate-300 bg-slate-100 text-slate-700",
  },
  POSTURA_DE_OUTRO_RUNTIME: {
    texto: "POSTURA DE OUTRO RUNTIME",
    tom: "border-violet-300 bg-violet-50 text-violet-800",
  },
  SEM_RUNTIME: {
    texto: "FICHA SEM RUNTIME",
    tom: "border-line2 bg-chip text-muted",
  },
};

/** Um traço, e não um vazio: célula vazia parece dado que não carregou. */
const NADA = "—";

export function AgentesClient() {
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;

    (async () => {
      try {
        const r = await fetch("/api/admin/sala-de-vendas/agentes", { cache: "no-store" });
        if (!vivo) return;

        if (r.status === 401 || r.status === 403) {
          setEstado({ fase: "semAcesso" });
          return;
        }

        const j = (await r.json()) as {
          ok: boolean;
          data?: { agentes: Agente[]; resumo: Resumo; matriz: LinhaDaMatriz[]; verdade: Verdade };
          error?: string;
        };
        if (!vivo) return;

        if (!j.ok || !j.data) {
          setEstado({ fase: "erro", detalhe: j.error ?? null });
          return;
        }

        setEstado({
          fase: "pronto",
          agentes: j.data.agentes,
          resumo: j.data.resumo,
          matriz: j.data.matriz,
          verdade: j.data.verdade,
        });
      } catch (e) {
        if (vivo) setEstado({ fase: "erro", detalhe: e instanceof Error ? e.message : null });
      }
    })();

    return () => { vivo = false; };
  }, []);

  if (estado.fase === "carregando") {
    return <p className="p-6 text-[13px] text-muted">Carregando as fichas…</p>;
  }

  if (estado.fase === "semAcesso") {
    return (
      <p className="max-w-[70ch] p-6 text-[13.5px] leading-relaxed text-ink2">
        Sem acesso. É preciso um login interno para ver as fichas.
      </p>
    );
  }

  if (estado.fase === "erro") {
    return (
      <p className="max-w-[70ch] p-6 text-[13.5px] leading-relaxed text-ink2">
        {estado.detalhe ?? "Não foi possível carregar as fichas."}
      </p>
    );
  }

  const { agentes, resumo, matriz, verdade } = estado;
  const porNumero = new Map(matriz.map((l) => [l.ficha.numero, l]));

  const comRuntime = matriz.filter((l) => l.executorReal !== null);
  const posturas = matriz.filter((l) => l.executadaPor !== null);
  const semRuntime = matriz.filter((l) => l.executorReal === null && l.executadaPor === null);

  return (
    <div className="min-h-full bg-canvas px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5">
          <h1 className="text-2xl font-semibold tracking-[-.02em] text-ink">
            Agentes comerciais
          </h1>
          <p className="mt-1 max-w-[68ch] text-[13.5px] leading-relaxed text-muted">
            As nove fichas de Vendas, com o que cada função pode, o que ela não pode,
            e como ela está indo. <strong>A ficha é um cargo, não uma pessoa</strong> —
            o desempenho é sempre do cargo inteiro.
          </p>
        </header>

        {/* ── A resposta de cinco segundos ────────────────────────────────────
            Vem primeiro e em corpo grande porque é a pergunta que a tela
            respondia errado: quantas inteligências existem? */}
        <section className="mb-4 rounded-2xl border border-line bg-paper p-4">
          <h2 className="text-[11.5px] font-semibold uppercase tracking-[.06em] text-muted">
            Quantas inteligências existem de verdade
          </h2>
          <p className="mt-1 text-[15px] leading-relaxed text-ink">
            <strong className="text-[22px] tabular-nums">{verdade.comRuntime}</strong>{" "}
            fichas têm código atrás, de {verdade.fichas}.{" "}
            {verdade.posturas > 0 && (
              <>
                Outras <strong className="tabular-nums">{verdade.posturas}</strong> são{" "}
                posturas desse mesmo cérebro, não agentes à parte.{" "}
              </>
            )}
            As demais <strong className="tabular-nums">{verdade.semRuntime}</strong> não têm
            runtime nenhum.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Numero valor={verdade.comRuntime} rotulo="com runtime" />
            <Numero valor={verdade.usamModelo} rotulo="usam modelo de IA" />
            <Numero
              valor={verdade.falandoAgora}
              rotulo="falando agora"
              nota={verdade.falandoAgora === 0 ? "ninguém fala com estranho" : undefined}
            />
            <Numero
              valor={resumo.ocupados}
              rotulo="cargos ocupados"
              nota={resumo.ocupados === 0 ? "todos vagos" : undefined}
            />
          </div>

          {/* O defeito, dito com nome e endereço. Sem esta frase, quem visse o
              painel de departamentos com "0 ligados" acharia que é o mesmo
              interruptor — e é justamente essa confusão que atrasa o TA. */}
          <p className="mt-3 max-w-[76ch] rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed text-amber-900">
            <strong>Dois interruptores com o mesmo nome.</strong>{" "}
            <span className="font-mono">AgentProfile.isRuntimeEnabled</span> aparece em
            painéis como &quot;ligado/desligado&quot;, mas nasce <span className="font-mono">false</span>{" "}
            e <strong>não liga nada em produção</strong>. Quem liga o TA é{" "}
            <span className="font-mono">SdrIaConfig.ligado</span>, na tela do interruptor.
            A coluna <em>kill switch</em> abaixo diz, ficha por ficha, qual é o de verdade.
          </p>
        </section>

        {/* ── A matriz ────────────────────────────────────────────────────── */}
        <section className="mb-5">
          <h2 className="mb-2 text-[11.5px] font-semibold uppercase tracking-[.06em] text-muted">
            Matriz de verdade — uma linha por ficha
          </h2>

          <GrupoDaMatriz
            titulo="Com runtime"
            nota="Existe um arquivo que executa esta ficha, e um chamador de produção que prova."
            tom="border-emerald-200 bg-emerald-50/40"
            linhas={comRuntime}
          />
          <GrupoDaMatriz
            titulo="Postura de outro runtime"
            nota="Não é um segundo cérebro: o runtime apontado executa esta ficha sob a mesma voz."
            tom="border-violet-200 bg-violet-50/40"
            linhas={posturas}
          />
          <GrupoDaMatriz
            titulo="Ficha sem runtime"
            nota="Nenhum código executa. Cargo humano, ou ficha que ninguém implementou."
            tom="border-line2 bg-chip/40"
            linhas={semRuntime}
          />
        </section>

        {/* ── As fichas, com o desempenho que já existia ──────────────────── */}
        <h2 className="mb-2 text-[11.5px] font-semibold uppercase tracking-[.06em] text-muted">
          As fichas, com desempenho
        </h2>
        <ul className="flex flex-col gap-2">
          {agentes.map((a) => (
            <CartaoDoAgente
              key={a.slug}
              agente={a}
              linha={porNumero.get(a.numero) ?? null}
              aberto={aberto === a.slug}
              aoAlternar={() => setAberto(aberto === a.slug ? null : a.slug)}
            />
          ))}
        </ul>

        <p className="mt-5 max-w-[68ch] text-[12.5px] leading-relaxed text-muted">
          Esta tela não liga nem desliga agente. Ligar cada um é decisão do
          proprietário, uma por vez, com evidência — um botão aqui seria o atalho
          que contorna isso.
        </p>
      </div>
    </div>
  );
}

/**
 * Um bloco da matriz, com o selo do grupo no cabeçalho.
 *
 * A separação visual é o mecanismo: numa tabela contínua de nove linhas, a
 * diferença entre ter e não ter runtime vira uma coluna que o olho pula. Em três
 * blocos rotulados, ela é a primeira coisa que se lê.
 *
 * A tabela rola na horizontal no telefone em vez de encolher a coluna do
 * executor — caminho de arquivo cortado no meio é caminho que ninguém confere.
 */
function GrupoDaMatriz({
  titulo,
  nota,
  tom,
  linhas,
}: {
  titulo: string;
  nota: string;
  tom: string;
  linhas: LinhaDaMatriz[];
}) {
  if (linhas.length === 0) return null;

  return (
    <div className={`mb-3 overflow-hidden rounded-2xl border ${tom}`}>
      <div className="border-b border-line/60 px-3 py-2">
        <p className="text-[12.5px] font-semibold text-ink">
          {titulo}{" "}
          <span className="tabular-nums font-normal text-muted">({linhas.length})</span>
        </p>
        <p className="mt-0.5 max-w-[80ch] text-[11.5px] leading-snug text-muted">{nota}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-left">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-[.04em] text-muted">
              <Th>Ficha</Th>
              <Th>Executor real</Th>
              <Th>Modelo real</Th>
              <Th>Gatilho</Th>
              <Th>Kill switch</Th>
              <Th>Estado</Th>
              <Th>Prova de execução</Th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.ficha.numero} className="border-t border-line/60 align-top">
                <Td>
                  <span className="tabular-nums text-muted">{l.ficha.numero}</span>{" "}
                  <span className="font-medium text-ink">{l.ficha.nome}</span>
                  <span className="mt-0.5 block text-[11px] text-muted">
                    declarada {ROTULO_MODO[l.modoDeclarado] ?? l.modoDeclarado}
                  </span>
                </Td>
                <Td>
                  {l.executorReal ? (
                    <code className="break-all text-[11.5px] text-ink2">{l.executorReal}</code>
                  ) : l.executadaPor ? (
                    <span className="text-[12px] text-violet-800">
                      executada pela ficha {l.executadaPor}
                    </span>
                  ) : (
                    <span className="text-[12px] font-semibold text-muted">
                      FICHA SEM RUNTIME
                    </span>
                  )}
                </Td>
                <Td>
                  {l.modeloReal ? (
                    <code className="text-[11.5px] text-ink2">{l.modeloReal}</code>
                  ) : (
                    <span className="text-muted">{NADA}</span>
                  )}
                  {l.agentId && (
                    <span className="mt-0.5 block text-[11px] text-muted">
                      agentId <code>{l.agentId}</code>
                    </span>
                  )}
                </Td>
                <Td>{l.gatilho ?? <span className="text-muted">{NADA}</span>}</Td>
                <Td>
                  {l.killSwitch.onde ? (
                    <code className="break-all text-[11.5px] text-ink2">
                      {l.killSwitch.onde}
                    </code>
                  ) : (
                    <span className="text-muted">{NADA}</span>
                  )}
                  {l.killSwitch.naoConfundirCom && (
                    <span className="mt-0.5 block text-[11px] leading-snug text-amber-800">
                      não confundir com {l.killSwitch.naoConfundirCom}
                    </span>
                  )}
                </Td>
                <Td>
                  <Etiqueta
                    texto={SELO[l.estadoAtual.codigo].texto}
                    tom={SELO[l.estadoAtual.codigo].tom}
                  />
                  <span className="mt-1 block text-[11px] leading-snug text-muted">
                    {l.estadoAtual.frase}
                  </span>
                </Td>
                <Td>
                  {l.provaDeExecucao ? (
                    <code className="break-all text-[11.5px] text-ink2">
                      {l.provaDeExecucao}
                    </code>
                  ) : (
                    // Sem prova e sem invenção. O traço é a resposta certa.
                    <span className="text-muted">{NADA}</span>
                  )}
                  {l.outrosChamadores.length > 0 && (
                    <span className="mt-0.5 block text-[11px] text-muted">
                      +{l.outrosChamadores.length} outro(s) chamador(es)
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-3 py-2 font-semibold">{children}</th>;
}

function Td({ children }: { children: ReactNode }) {
  return <td className="px-3 py-2 text-[12.5px] leading-relaxed text-ink2">{children}</td>;
}

function Numero({ valor, rotulo, nota }: { valor: number; rotulo: string; nota?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-3">
      <p className="text-2xl font-semibold tabular-nums text-ink">{valor}</p>
      <p className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">
        {rotulo}
      </p>
      {nota && <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{nota}</p>}
    </div>
  );
}

function CartaoDoAgente({
  agente,
  linha,
  aberto,
  aoAlternar,
}: {
  agente: Agente;
  /** A linha da matriz desta ficha. `null` só se o catálogo e a matriz divergirem. */
  linha: LinhaDaMatriz | null;
  aberto: boolean;
  aoAlternar: () => void;
}) {
  const a = agente;

  return (
    <li className="overflow-hidden rounded-2xl border border-line bg-paper">
      <button
        onClick={aoAlternar}
        aria-expanded={aberto}
        className="flex w-full items-start justify-between gap-3 p-4 text-left transition-colors hover:bg-canvas"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11.5px] font-semibold tabular-nums text-muted">
              {a.numero}
            </span>
            <h2 className="text-[15.5px] font-semibold text-ink">{a.nome}</h2>
            <Etiqueta texto={ROTULO_MODO[a.modo] ?? a.modo} tom={COR_MODO[a.modo]} />

            {/* ⚠️ Aqui morava o selo mentiroso: "ligado/desligado" vindo de
                `isRuntimeEnabled`, exibido em toda ficha de IA — inclusive nas
                que não têm executor. Agora o selo vem da matriz, e uma ficha sem
                runtime diz FICHA SEM RUNTIME, que é o fato. */}
            {linha && (
              <Etiqueta
                texto={SELO[linha.estadoAtual.codigo].texto}
                tom={SELO[linha.estadoAtual.codigo].tom}
              />
            )}

            {a.modo !== "IA" && (
              <Etiqueta
                texto={a.pessoas === 0 ? "cargo vago" : `${a.pessoas} pessoa(s)`}
                tom={
                  a.pessoas === 0
                    ? "border-line2 bg-chip text-muted"
                    : "border-sky-200 bg-sky-50 text-sky-700"
                }
              />
            )}
          </div>

          {a.resumo && (
            <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-ink2">
              {a.resumo}
            </p>
          )}
        </div>

        <span className="shrink-0 pt-1 text-[13px] text-muted">{aberto ? "−" : "+"}</span>
      </button>

      {aberto && (
        <div className="border-t border-line px-4 pb-4 pt-3">
          {linha && <AVerdadeDaFicha linha={linha} cadastrada={a.cadastrada} ligada={a.ligada} />}

          <Desempenho agente={a} />

          <Lista titulo="Pode" itens={a.pode} />
          <Lista titulo="Não pode" itens={a.naoPode} tom="text-red-800" />
          <Lista titulo="Escala quando" itens={a.escalaQuando} />
          <Lista titulo="Mede-se por" itens={a.medeSePor} />
          {a.regraDura.length > 0 && (
            <Lista titulo="Regra dura" itens={a.regraDura} tom="text-ink" destaque />
          )}
        </div>
      )}
    </li>
  );
}

/**
 * A verdade da ficha, dentro do cartão.
 *
 * Vem ANTES do desempenho de propósito. Ler "0 mensagens" antes de saber que não
 * existe runtime faz o zero parecer mau desempenho de um agente que trabalhou —
 * que é uma acusação, e não uma medição.
 */
function AVerdadeDaFicha({
  linha,
  cadastrada,
  ligada,
}: {
  linha: LinhaDaMatriz;
  cadastrada: boolean;
  ligada: boolean;
}) {
  const l = linha;

  return (
    <section className="mb-4 rounded-xl border border-line bg-canvas p-3">
      <h3 className="mb-2 text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">
        A verdade desta ficha
      </h3>

      <dl className="flex flex-col gap-1.5">
        <Campo rotulo="Executor real">
          {l.executorReal ? (
            <code className="break-all">{l.executorReal}</code>
          ) : l.executadaPor ? (
            <>executada pela ficha {l.executadaPor} — não é um agente separado</>
          ) : (
            <strong>FICHA SEM RUNTIME</strong>
          )}
        </Campo>
        <Campo rotulo="Modelo real">
          {l.modeloReal ? <code>{l.modeloReal}</code> : NADA}
        </Campo>
        <Campo rotulo="Prompt ou política">{l.promptOuPolitica ?? NADA}</Campo>
        <Campo rotulo="Gatilho">{l.gatilho ?? NADA}</Campo>
        <Campo rotulo="Ferramentas">
          {l.ferramentas.length > 0 ? l.ferramentas.join(", ") : NADA}
        </Campo>
        <Campo rotulo="Banco — lê">
          {l.bancoLido.length > 0 ? l.bancoLido.join(", ") : NADA}
        </Campo>
        <Campo rotulo="Banco — escreve">
          {l.bancoEscrito.length > 0 ? l.bancoEscrito.join(", ") : NADA}
        </Campo>
        <Campo rotulo="Kill switch">
          {l.killSwitch.onde ? <code className="break-all">{l.killSwitch.onde}</code> : NADA}
        </Campo>
        <Campo rotulo="Estado agora">{l.estadoAtual.frase}</Campo>
        <Campo rotulo="Prova de execução">
          {l.provaDeExecucao ? <code className="break-all">{l.provaDeExecucao}</code> : NADA}
        </Campo>
        {l.outrosChamadores.length > 0 && (
          <Campo rotulo="Outros chamadores">
            <span className="flex flex-col gap-0.5">
              {l.outrosChamadores.map((c) => (
                <code key={c} className="break-all">
                  {c}
                </code>
              ))}
            </span>
          </Campo>
        )}
      </dl>

      {l.killSwitch.naoConfundirCom && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-amber-900">
          <strong>Não confundir com:</strong> {l.killSwitch.naoConfundirCom}.{" "}
          {/* O valor da coluna enganosa fica visível, mas rotulado como o que é.
              Escondê-lo faria a tela discordar em silêncio do painel de
              departamentos, que continua exibindo essa mesma coluna. */}
          Nesta ficha ele está {cadastrada ? (ligada ? "ligado" : "desligado") : "sem linha no banco"}
          {" "}— e isso não muda nada em produção.
        </p>
      )}

      {l.observacao && (
        <p className="mt-2 max-w-[76ch] text-[11.5px] leading-relaxed text-muted">
          {l.observacao}
        </p>
      )}
    </section>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className="shrink-0 text-[11.5px] font-semibold uppercase tracking-[.03em] text-muted sm:w-44">
        {rotulo}
      </dt>
      <dd className="min-w-0 text-[12.5px] leading-relaxed text-ink2">{children}</dd>
    </div>
  );
}

/**
 * O desempenho, e o cuidado que ele exige.
 *
 * Cada número que não existe é escrito com o MOTIVO de não existir. "Sem dados"
 * sozinho parece defeito do sistema; "o agente está desligado" é uma informação
 * que o leitor consegue usar.
 */
function Desempenho({ agente }: { agente: Agente }) {
  const d = agente.desempenho;

  const linhas: Array<{ rotulo: string; m: Medida }> = [
    { rotulo: "Mensagens escritas", m: d.mensagens },
    { rotulo: "Conversas passadas adiante", m: d.handoffs },
    { rotulo: "Nota de QA", m: d.qa },
  ];

  if (agente.modo !== "IA") {
    linhas.push({ rotulo: "Leads sob responsabilidade agora", m: d.leadsAgora });
  }

  return (
    <section className="mb-4 rounded-xl border border-line bg-canvas p-3">
      <h3 className="mb-2 text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">
        Desempenho · últimos 30 dias
      </h3>

      <dl className="flex flex-col gap-1.5">
        {linhas.map((l) => (
          <div key={l.rotulo} className="flex items-baseline justify-between gap-3">
            <dt className="text-[13px] text-ink2">{l.rotulo}</dt>
            <dd className="shrink-0 text-right">
              {l.m.medido ? (
                <>
                  <span className="text-[15px] font-semibold tabular-nums text-ink">
                    {l.m.valor}
                  </span>
                  {l.m.nota && (
                    <span className="ml-1.5 text-[11.5px] text-muted">{l.m.nota}</span>
                  )}
                </>
              ) : (
                <span className="text-[12.5px] italic text-muted">{l.m.motivo}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Lista({
  titulo,
  itens,
  tom,
  destaque,
}: {
  titulo: string;
  itens: string[];
  tom?: string;
  destaque?: boolean;
}) {
  if (itens.length === 0) return null;

  return (
    <section className="mb-3">
      <h3 className="mb-1 text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">
        {titulo}
      </h3>
      <ul
        className={
          destaque
            ? "rounded-xl border border-amber-200 bg-amber-50 px-3 py-2"
            : undefined
        }
      >
        {itens.map((i, n) => (
          <li
            key={n}
            className={`flex gap-2 py-0.5 text-[13px] leading-relaxed ${tom ?? "text-ink2"}`}
          >
            <span className="shrink-0 text-muted">·</span>
            <span>{i}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Etiqueta({ texto, tom }: { texto: string; tom?: string }) {
  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 text-[11px] font-semibold ${
        tom ?? "border-line2 bg-chip text-ink2"
      }`}
    >
      {texto}
    </span>
  );
}
