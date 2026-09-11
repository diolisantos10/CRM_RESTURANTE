"use client";

/**
 * A PROSPECÇÃO — a tela onde a casa decide falar com estranhos.
 *
 * ── ⛔ A OPERAÇÃO POR LOTES FOI REMOVIDA EM 11/09/2026 ───────────────────────
 *
 * Ordem explícita do CEO: *"nenhuma importação pode depender de liberação
 * manual"* e *"lote não pode aparecer como etapa operacional nem impedir
 * envio."* Esta tela não tem mais seção "Lotes", nem botão "Liberar", nem
 * botão "Pausar" por lista. O que existia ali virou histórico — a aba
 * Importações continua contando de qual arquivo cada contato veio.
 *
 * A operação correta, de hoje em diante: **planilha entra → contatos vão
 * direto para a Base fria → o sistema seleciona até o teto de elegíveis → a
 * rodada automática (ou "Rodar agora") aborda.** Nenhum clique de liberação
 * no meio do caminho.
 *
 * ── O QUE ESTA TELA MOSTRA, E POR QUE NESTA ORDEM ───────────────────────────
 *
 * 1. Receber/enriquecer contatos — a porta de entrada, sempre no topo.
 * 2. O interruptor geral, com o limite e o saldo disponível ao lado — quem
 *    abre esta tela precisa saber, em um segundo, se a casa está abordando
 *    gente agora, e conseguir parar sem procurar o botão.
 * 3. O resumo da Base fria — quantos contatos existem, quantos elegíveis, e a
 *    ficha de cada um (colunas principais + detalhe expansível).
 * 4. A situação da fila automática — quantos seriam liberados agora, a última
 *    rodada, e o botão para disparar uma rodada manual.
 *
 * ── ⚠️ NADA AQUI ENVIA MENSAGEM SOZINHO ─────────────────────────────────────
 *
 * Esta tela seleciona e mostra. A entrega continua atrás de
 * `FOOCCI_SDR_SEND_ENABLED`, no ambiente, e é do dono. "Rodar agora" chama a
 * MESMA rodada que o agendador das 9h chama — não é um caminho novo.
 */

import { useCallback, useEffect, useState } from "react";
import { ReceberLista } from "./ReceberLista";
import { EnriquecerModal } from "./EnriquecerModal";

const ROTA = "/api/admin/sala-de-vendas/prospeccao";

interface Fila {
  liberados: unknown[];
  barrados: unknown[];
  motivoDaFilaVazia: string | null;
  usadosHoje: number;
  tetoDoDia: number;
  /** Conversas iniciadas nas últimas 24h corridas — a conta da Meta. */
  usadosNaJanela: number;
  /** O que a Meta ainda deixa mandar agora. É este que limita a fila. */
  saldoDaJanela: number;
}

interface Interruptor {
  outboundLigado: boolean;
  limiteDiario: number;
  horasEntreAbordagens: number;
  pausadoEm: string | null;
  motivo: string | null;
  /** Quando a rodada das 9h (ou um "Rodar agora") rodou pela última vez. */
  ultimaRodadaAutomaticaEm: string | null;
  ultimaRodadaAutomaticaPor: string | null;
}

interface ResumoDaBase {
  total: number;
  pendentes: number;
}

interface Dados {
  fila: Fila;
  base: ResumoDaBase;
  interruptor: Interruptor;
  canalPronto: boolean;
}

type Estado =
  | { fase: "carregando" }
  | { fase: "pronto"; dados: Dados }
  | { fase: "semAcesso" }
  | { fase: "erro"; detalhe: string | null };

/** Uma linha da Base fria — as colunas principais + tudo que o detalhe expansível mostra. */
interface ContatoDaBase {
  id: string;
  nome: string | null;
  whatsapp: string;
  empresa: string | null;
  cidade: string | null;
  estado: string | null;
  tipo: string | null;
  situacao: string;
  entrouEm: string;
  leadId: string | null;
  cargo: string | null;
  telefoneSecundario: string | null;
  email: string | null;
  bairro: string | null;
  endereco: string | null;
  cep: string | null;
  cnpj: string | null;
  instagram: string | null;
  site: string | null;
  googleMapsUrl: string | null;
  numeroDeUnidades: number | null;
  canaisAtuais: string[];
  observacoes: string | null;
  tags: string[];
  proveniencia: string | null;
  responsavel: string | null;
  arquivo: string | null;
  canalDeObtencao: string | null;
  motivoDeBloqueio: string | null;
}

interface ResultadoDaRodada {
  abordados: number;
  pulados: number;
  parouPor: "filaAcabou" | "tetoDaRodada" | "freio" | "falha" | "preVoo";
  falha: { itemId: string | null; motivo: string; detalhe: string } | null;
}

/** Linhas de detalhe que só aparecem quando a pessoa expande o contato. */
function LinhaDeDetalhe({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  if (!valor) return null;
  return (
    <p className="text-[12px] text-muted">
      <span className="text-ink">{rotulo}:</span> {valor}
    </p>
  );
}

function FichaDoContato({ c }: { c: ContatoDaBase }) {
  const [aberto, setAberto] = useState(false);
  const endereco = [c.endereco, c.bairro, c.cep].filter(Boolean).join(", ");

  return (
    <li className="rounded-xl border border-line bg-paper p-3">
      <button
        onClick={() => setAberto((a) => !a)}
        className="flex w-full flex-wrap items-start justify-between gap-2 text-left"
      >
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-ink">
            {c.empresa ?? "Sem empresa"} · {c.nome ?? "Sem responsável"}
          </p>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {c.whatsapp}
            {c.cidade ? ` · ${c.cidade}${c.estado ? `/${c.estado}` : ""}` : ""}
            {c.tipo ? ` · ${c.tipo}` : ""}
          </p>
        </div>
        <span className="shrink-0 text-[12px] text-muted">{aberto ? "recolher ▲" : "detalhes ▼"}</span>
      </button>

      {aberto && (
        <div className="mt-2.5 space-y-1 border-t border-line pt-2.5">
          <LinhaDeDetalhe rotulo="Cargo" valor={c.cargo} />
          <LinhaDeDetalhe rotulo="Telefone secundário" valor={c.telefoneSecundario} />
          <LinhaDeDetalhe rotulo="E-mail" valor={c.email} />
          <LinhaDeDetalhe rotulo="Endereço" valor={endereco || null} />
          <LinhaDeDetalhe rotulo="CNPJ" valor={c.cnpj} />
          <LinhaDeDetalhe rotulo="Instagram" valor={c.instagram} />
          <LinhaDeDetalhe rotulo="Site" valor={c.site} />
          <LinhaDeDetalhe rotulo="Google Maps" valor={c.googleMapsUrl} />
          <LinhaDeDetalhe
            rotulo="Unidades"
            valor={c.numeroDeUnidades !== null ? String(c.numeroDeUnidades) : null}
          />
          <LinhaDeDetalhe
            rotulo="Canais atuais"
            valor={c.canaisAtuais.length ? c.canaisAtuais.join(", ") : null}
          />
          <LinhaDeDetalhe rotulo="Observações" valor={c.observacoes} />
          <LinhaDeDetalhe rotulo="Tags" valor={c.tags.length ? c.tags.join(", ") : null} />
          <LinhaDeDetalhe rotulo="Procedência" valor={c.proveniencia} />
          <LinhaDeDetalhe rotulo="Canal de obtenção" valor={c.canalDeObtencao} />
          <LinhaDeDetalhe rotulo="Arquivo" valor={c.arquivo} />
          <LinhaDeDetalhe
            rotulo="Entrou em"
            valor={new Date(c.entrouEm).toLocaleDateString("pt-BR")}
          />
          <LinhaDeDetalhe rotulo="Situação" valor={c.situacao} />
          <LinhaDeDetalhe rotulo="Motivo de bloqueio" valor={c.motivoDeBloqueio} />
        </div>
      )}
    </li>
  );
}

export function ProspeccaoClient() {
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [modalEnriquecerAberto, setModalEnriquecerAberto] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  /** Quantas abordagens por dia. Vazio até a tela ler o que está no banco. */
  const [teto, setTeto] = useState<string>("");
  const [contatos, setContatos] = useState<ContatoDaBase[] | null>(null);
  const [resultadoRodada, setResultadoRodada] = useState<ResultadoDaRodada | null>(null);

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

  // ── O RESUMO DA BASE FRIA — as 10 fichas mais recentes ──────────────────
  //
  // Uma consulta separada, e não parte do GET principal: a lista de contatos
  // (com endereço, CNPJ, Instagram…) é bem mais pesada que a fila e o
  // interruptor, e a tela principal não deveria esperar por ela para mostrar
  // o freio — que é a informação mais urgente.
  useEffect(() => {
    if (estado.fase !== "pronto") return;
    let vivo = true;
    (async () => {
      try {
        const res = await fetch(`${ROTA}?recorte=base&porPagina=10`, { cache: "no-store" });
        if (!res.ok) return;
        const corpo = (await res.json()) as { data?: { linhas?: ContatoDaBase[] } };
        if (vivo) setContatos(corpo.data?.linhas ?? []);
      } catch {
        // O resumo é um extra; falhar aqui não pode derrubar a tela inteira.
      }
    })();
    return () => {
      vivo = false;
    };
  }, [estado.fase, tentativa]);

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
        const json = (await res.json().catch(() => null)) as
          | { error?: string; data?: unknown }
          | null;
        if (!res.ok) {
          // A recusa do servidor aparece com as palavras dele. Traduzir aqui
          // faria a tela inventar um motivo que o servidor não deu.
          setAviso(json?.error ?? `A ação foi recusada (${res.status}).`);
          return null;
        }
        recarregar();
        return json?.data ?? null;
      } catch (e) {
        setAviso(e instanceof Error ? e.message : "Falha de rede.");
        return null;
      } finally {
        setOcupado(false);
      }
    },
    [recarregar],
  );

  const dispararRodada = useCallback(async () => {
    setResultadoRodada(null);
    const dados = await agir({ acao: "rodada" });
    if (dados) setResultadoRodada(dados as ResultadoDaRodada);
  }, [agir]);

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

  const { fila, base, interruptor, canalPronto } = estado.dados;
  const pausada = Boolean(interruptor.pausadoEm);
  const ligada = interruptor.outboundLigado && !pausada;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {aviso && (
        <p className="rounded-lg border border-line bg-paper px-3 py-2 text-[12.5px] text-ink">
          {aviso}
        </p>
      )}

      {/* ── 1. RECEBER / ENRIQUECER CONTATOS ─────────────────────────────── */}
      <ReceberLista aoImportar={recarregar} />

      <section className="rounded-xl border border-line bg-paper p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-ink">Enriquecer dados</h2>
          <button
            onClick={() => setModalEnriquecerAberto(true)}
            className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink transition-colors hover:bg-canvas"
          >
            Enriquecer dados de uma lista existente
          </button>
        </div>
        <p className="mt-1 text-[12.5px] text-muted">
          Preenche só os campos vazios de contatos que já estão na Base fria — nunca cria contato novo, nunca sobrescreve o que já existe.
        </p>
      </section>

      {/* ── 2. O INTERRUPTOR GERAL, COM LIMITE E SALDO ───────────────────── */}
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
            {/*
              ⭐ O NÚMERO QUE MANDA, e ele não é o de cima.
              A Meta conta conversas iniciadas numa janela CORRIDA de 24 horas —
              não numa cota que zera à meia-noite. Mostrar só "abordagens hoje"
              faria a tela dizer "0 de 2.000" à 00h05 com 1.500 conversas ainda
              pesando de ontem. Os dois aparecem, e o saldo vem em destaque.
            */}
            <p className="mt-0.5 text-[12.5px] font-semibold text-ink2">
              Saldo da Meta agora: <span className="tabular-nums">{fila.saldoDaJanela}</span>{" "}
              conversas
              <span className="font-normal text-muted">
                {" "}
                · {fila.usadosNaJanela} iniciadas nas últimas 24h
              </span>
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

      {/* ── 3. RESUMO DA BASE FRIA ────────────────────────────────────────── */}
      <section>
        <h2 className="text-[15px] font-semibold text-ink">Base fria</h2>
        <p className="mt-1 text-[12.5px] text-muted">
          <span className="font-semibold text-ink">{base.total}</span> contatos no total ·{" "}
          <span className="font-semibold text-ink">{base.pendentes}</span> elegíveis para abordagem
        </p>

        <ul className="mt-3 space-y-2">
          {(contatos ?? []).map((c) => (
            <FichaDoContato key={c.id} c={c} />
          ))}
          {contatos !== null && contatos.length === 0 && (
            <li className="text-[12.5px] text-muted">
              Nenhum contato ainda. A lista entra pela porta de importação acima.
            </li>
          )}
          {contatos === null && <li className="text-[12.5px] text-muted">Carregando a Base fria…</li>}
        </ul>
      </section>

      {/* ── 4. SITUAÇÃO DA FILA AUTOMÁTICA ───────────────────────────────── */}
      <section className="rounded-xl border border-line bg-paper p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Fila automática</h2>
            {fila.motivoDaFilaVazia ? (
              <p className="mt-1 text-[12.5px] text-muted">{fila.motivoDaFilaVazia}</p>
            ) : (
              <p className="mt-1 text-[12.5px] text-muted">
                <span className="font-semibold text-ink">{fila.liberados.length}</span> prontos para a
                próxima rodada ·{" "}
                <span className="font-semibold text-ink">{fila.barrados.length}</span> barrados agora
              </p>
            )}
            <p className="mt-1 text-[12px] text-muted">
              {interruptor.ultimaRodadaAutomaticaEm
                ? `Última rodada: ${new Date(interruptor.ultimaRodadaAutomaticaEm).toLocaleString("pt-BR")}${
                    interruptor.ultimaRodadaAutomaticaPor ? ` · ${interruptor.ultimaRodadaAutomaticaPor}` : ""
                  }`
                : "Nenhuma rodada automática rodou ainda."}
            </p>
          </div>

          <button
            disabled={ocupado}
            onClick={dispararRodada}
            className="rounded-lg bg-brand-500 px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
          >
            Rodar agora
          </button>
        </div>

        {resultadoRodada && (
          <p className="mt-3 rounded-lg border border-line px-3 py-2 text-[12.5px] text-ink">
            {resultadoRodada.abordados} abordados, {resultadoRodada.pulados} pulados — parou por{" "}
            {resultadoRodada.parouPor}
            {resultadoRodada.falha ? `: ${resultadoRodada.falha.detalhe}` : ""}
          </p>
        )}
      </section>

      <EnriquecerModal
        aberto={modalEnriquecerAberto}
        onFechar={() => setModalEnriquecerAberto(false)}
      />
    </div>
  );
}
