"use client";

/**
 * A BASE FRIA — todos os contatos que nós fomos buscar, numa lista só.
 *
 * ── ⚠️ POR QUE ESTA TELA PRECISOU EXISTIR ──────────────────────────────────
 *
 * A tela antiga de Prospecção mostrava os **vinte lotes mais recentes** e os
 * **cinquenta primeiros da fila** — e não dizia que eram vinte e cinquenta.
 * Quem olhava via uma amostra e entendia "a base". Ordem do Diretor Geral:
 * *"não mostrar somente 50 contatos como se fossem a base inteira; paginação ou
 * carregamento progressivo é obrigatório."*
 *
 * ── O QUE CADA COLUNA RESPONDE ─────────────────────────────────────────────
 *
 * A coluna que mais importa é **motivo de bloqueio**. Sem ela o operador vê que
 * um contato não é abordado e não tem como saber qual das três coisas
 * aconteceu: ele pediu silêncio, a linha foi recusada na importação, ou o lote
 * inteiro está pausado. Três causas com três consertos diferentes.
 */

import { Fragment, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const ROTA = "/api/admin/sala-de-vendas/prospeccao";

export interface Contato {
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
  loteSituacao: string;
  proveniencia: string;
  responsavel: string | null;
  importacaoId: string | null;
  arquivo: string;
  canalDeObtencao: string | null;
  tentativas: number;
  ultimaTentativa: string | null;
  motivoDeBloqueio: string | null;

  // ── ⭐ CORREÇÃO, 11/09/2026 — a API já devolvia estes 14 campos
  // (`listarBaseFria`, route.ts) desde a ampliação de 11/09; esta interface e a
  // tela nunca os leram. Achado do CEO: "cidade, endereço e tipo não
  // aparecem" — cidade e tipo já vinham (colunas próprias, acima); os catorze
  // abaixo simplesmente não tinham para onde ir.
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
}

/** "—" para o campo ausente, nunca a linha sumindo — ordem do CEO, 11/09/2026. */
function valorOuTraco(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const s = String(v).trim();
  return s ? s : "—";
}

function CampoDaFicha({ rotulo, valor }: { rotulo: string; valor: string | number | null }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[.03em] text-muted">{rotulo}</dt>
      <dd className="mt-0.5 text-[12.5px] text-ink">{valorOuTraco(valor)}</dd>
    </div>
  );
}

/**
 * ⭐⭐ A CÉLULA DO CONTATO — sempre um `<button>`, nunca um `<span>`.
 *
 * ── O DEFEITO QUE ESTE COMPONENTE EXISTE PARA NÃO DEIXAR VOLTAR ─────────────
 *
 * Achado do CEO, 11/09/2026: "contatos sem leadId não são clicáveis". A causa
 * era literal — quem não tinha `leadId` virava um `<span>` sem `onClick`
 * nenhum, porque o único jeito de abrir alguma coisa era "Abrir conversa", e
 * quem não é lead não tem conversa. Isolado num componente próprio e
 * exportado, este defeito específico vira testável sem depender de banco, de
 * sessão ou de servidor: `BaseFriaClient.test.tsx` renderiza esta célula com
 * e sem `leadId` e prova, no markup, que o `<button>` está lá dos dois jeitos.
 *
 * "Abrir conversa" continua existindo — só que como um SEGUNDO elemento,
 * condicionado a `leadId`, nunca no lugar do botão que abre a ficha.
 */
export function CelulaDoContato({
  c,
  aberto,
  aoAlternar,
}: {
  c: Contato;
  aberto: boolean;
  aoAlternar: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={aoAlternar}
        className="flex items-start gap-1 text-left font-semibold text-ink hover:text-brand-700"
        aria-expanded={aberto}
      >
        <span>{c.nome || c.empresa || c.whatsapp}</span>
        <span className="mt-0.5 shrink-0 text-[10px] text-muted">{aberto ? "▲" : "▼"}</span>
      </button>
      <div className="text-[11.5px] text-muted">{c.whatsapp}</div>
      {c.leadId && (
        <a
          href={`/comercial/conversas?leadId=${c.leadId}`}
          className="mt-0.5 block text-[11.5px] font-semibold text-brand-700 hover:underline"
        >
          Abrir conversa →
        </a>
      )}
    </>
  );
}

/**
 * A FICHA EXPANDIDA — os 20 campos da Base fria, sempre os mesmos, sempre na
 * mesma ordem, campo ausente como "—". "Abrir conversa" fica FORA daqui,
 * porque é outro ato (falar com quem já é lead) e só existe quando há
 * `leadId` — a ficha em si é sempre a mesma, tenha ou não conversa aberta.
 */
export function FichaExpandidaDoContato({ c }: { c: Contato }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-4">
      <CampoDaFicha rotulo="Responsável" valor={c.nome} />
      <CampoDaFicha rotulo="Estabelecimento" valor={c.empresa} />
      <CampoDaFicha rotulo="WhatsApp" valor={c.whatsapp} />
      <CampoDaFicha rotulo="Telefone secundário" valor={c.telefoneSecundario} />
      <CampoDaFicha rotulo="Cidade/UF" valor={[c.cidade, c.estado].filter(Boolean).join("/") || null} />
      <CampoDaFicha rotulo="Bairro" valor={c.bairro} />
      <CampoDaFicha rotulo="Endereço" valor={c.endereco} />
      <CampoDaFicha rotulo="CEP" valor={c.cep} />
      <CampoDaFicha rotulo="Tipo" valor={c.tipo} />
      <CampoDaFicha rotulo="E-mail" valor={c.email} />
      <CampoDaFicha rotulo="Cargo" valor={c.cargo} />
      <CampoDaFicha rotulo="CNPJ" valor={c.cnpj} />
      <CampoDaFicha rotulo="Instagram" valor={c.instagram} />
      <CampoDaFicha rotulo="Site" valor={c.site} />
      <CampoDaFicha rotulo="Google Maps" valor={c.googleMapsUrl} />
      <CampoDaFicha rotulo="Unidades" valor={c.numeroDeUnidades} />
      <CampoDaFicha rotulo="Canais" valor={c.canaisAtuais.length ? c.canaisAtuais.join(", ") : null} />
      <CampoDaFicha rotulo="Tags" valor={c.tags.length ? c.tags.join(", ") : null} />
      <CampoDaFicha rotulo="Observações" valor={c.observacoes} />
      <CampoDaFicha rotulo="Procedência" valor={c.proveniencia} />
      <CampoDaFicha rotulo="Arquivo" valor={c.arquivo} />
    </dl>
  );
}

const SITUACOES = [
  { chave: "", rotulo: "Todas" },
  { chave: "PENDENTE", rotulo: "Esperando a vez" },
  { chave: "VIROU_LEAD", rotulo: "Já abordados" },
  { chave: "DUPLICADO", rotulo: "Duplicados" },
  { chave: "RECUSADO", rotulo: "Recusados" },
] as const;

const ROTULO_SITUACAO: Record<string, string> = {
  PENDENTE: "esperando a vez",
  VIROU_LEAD: "virou lead",
  DUPLICADO: "duplicado",
  RECUSADO: "recusado",
};

function quando(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function BaseFriaClient() {
  const params = useSearchParams();
  // Chega com a importação já filtrada quando se vem da tela de Importações.
  const importacaoId = params.get("importacaoId") ?? "";

  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState("");
  const [cidade, setCidade] = useState("");
  const [estado, setEstado] = useState("");
  const [tipo, setTipo] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

  const [linhas, setLinhas] = useState<Contato[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(25);
  const [fase, setFase] = useState<"carregando" | "pronto" | "semAcesso" | "erro">("carregando");
  const [detalhe, setDetalhe] = useState<string | null>(null);
  /** Quais fichas estão abertas agora. Todo contato entra aqui — com ou sem `leadId`. */
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  const alternar = useCallback((id: string) => {
    setExpandidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }, []);

  const carregar = useCallback(
    async (p: number) => {
      setFase("carregando");
      try {
        const q = new URLSearchParams({ recorte: "base", pagina: String(p) });
        if (busca.trim()) q.set("busca", busca.trim());
        if (situacao) q.set("situacao", situacao);
        if (cidade.trim()) q.set("cidade", cidade.trim());
        if (estado.trim()) q.set("estado", estado.trim());
        if (tipo.trim()) q.set("tipo", tipo.trim());
        if (de) q.set("de", de);
        if (ate) q.set("ate", ate);
        if (importacaoId) q.set("importacaoId", importacaoId);

        const res = await fetch(`${ROTA}?${q}`, { cache: "no-store" });
        if (res.status === 401 || res.status === 403) return setFase("semAcesso");
        if (!res.ok) {
          setDetalhe(`${ROTA} respondeu ${res.status}`);
          return setFase("erro");
        }
        const j = (await res.json()) as {
          data?: { linhas: Contato[]; total: number; porPagina: number };
        };
        setLinhas(j.data?.linhas ?? []);
        setTotal(j.data?.total ?? 0);
        setPorPagina(j.data?.porPagina ?? 25);
        setFase("pronto");
      } catch (e) {
        setDetalhe(e instanceof Error ? e.message : null);
        setFase("erro");
      }
    },
    [busca, situacao, cidade, estado, tipo, de, ate, importacaoId],
  );

  useEffect(() => {
    void carregar(pagina);
    // A busca e os filtros de texto têm botão próprio; recarregar a cada tecla
    // faria uma consulta por letra digitada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina, situacao, importacaoId]);

  const ultimaPagina = Math.max(1, Math.ceil(total / porPagina));

  function aplicar() {
    if (pagina === 1) void carregar(1);
    else setPagina(1); // o efeito recarrega
  }

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-[17px] font-semibold text-ink">Base fria</h1>
      <p className="mt-0.5 max-w-[70ch] text-[12.5px] leading-relaxed text-muted">
        O estoque contínuo de contatos que <strong>nós</strong> fomos buscar. A operação consome
        daqui respeitando o teto do dia — não há mais liberação por parte de arquivo.
      </p>

      {importacaoId && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-[12.5px] text-brand-700">
          <span>Mostrando só os contatos de uma importação.</span>
          <a href="/comercial/base-fria" className="font-semibold underline">
            ver a base inteira
          </a>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {SITUACOES.map((s) => (
          <button
            key={s.chave || "todas"}
            onClick={() => setSituacao(s.chave)}
            className={`rounded-lg border px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
              situacao === s.chave
                ? "border-brand-400 bg-brand-50 text-brand-700"
                : "border-line2 bg-paper text-ink2 hover:border-brand-300"
            }`}
          >
            {s.rotulo}
          </button>
        ))}
      </div>

      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          aplicar();
        }}
        className="mt-3 flex flex-wrap items-end gap-2"
      >
        <Campo rotulo="Buscar" valor={busca} aoMudar={setBusca} largura="w-56" dica="nome, empresa ou telefone" />
        <Campo rotulo="Cidade" valor={cidade} aoMudar={setCidade} largura="w-36" />
        <Campo rotulo="UF" valor={estado} aoMudar={setEstado} largura="w-16" />
        <Campo rotulo="Tipo" valor={tipo} aoMudar={setTipo} largura="w-36" dica="padaria, pizzaria…" />
        <Campo rotulo="Entrou de" valor={de} aoMudar={setDe} largura="w-36" tipo="date" />
        <Campo rotulo="até" valor={ate} aoMudar={setAte} largura="w-36" tipo="date" />
        <button
          type="submit"
          className="rounded-lg border border-brand-400 bg-brand-50 px-3 py-1.5 text-[12.5px] font-semibold text-brand-700"
        >
          Aplicar
        </button>
      </form>

      {fase === "carregando" && <p className="mt-4 text-[13px] text-muted">Carregando…</p>}

      {fase === "semAcesso" && (
        <p className="mt-4 text-[13px] text-muted">
          Você não tem acesso a esta tela. Fale com quem cuida dos acessos da Sala.
        </p>
      )}

      {fase === "erro" && (
        <p className="mt-4 text-[13px] text-rose-700">
          Não deu para carregar{detalhe ? `: ${detalhe}` : "."}
        </p>
      )}

      {fase === "pronto" && (
        <>
          <p className="mt-3 text-[12.5px] text-muted">
            {total} contato{total === 1 ? "" : "s"} no recorte.{" "}
            {total > porPagina && (
              <>
                Mostrando {linhas.length} — página {pagina} de {ultimaPagina}.
              </>
            )}
          </p>

          {linhas.length === 0 ? (
            <p className="mt-4 text-[13px] text-muted">
              Nenhum contato neste recorte. Ajuste os filtros ou suba uma lista pela tela de
              Prospecção.
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto rounded-xl border border-line2">
              <table className="w-full min-w-[1000px] text-[12.5px]">
                <thead className="bg-paper2 text-left text-muted">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Contato</th>
                    <th className="px-3 py-2 font-semibold">Onde</th>
                    <th className="px-3 py-2 font-semibold">Tipo</th>
                    <th className="px-3 py-2 font-semibold">Origem</th>
                    <th className="px-3 py-2 font-semibold">Entrou</th>
                    <th className="px-3 py-2 text-right font-semibold">Tentativas</th>
                    <th className="px-3 py-2 font-semibold">Última</th>
                    <th className="px-3 py-2 font-semibold">Situação</th>
                    <th className="px-3 py-2 font-semibold">Bloqueio</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((c) => {
                    const aberto = expandidos.has(c.id);
                    return (
                      <Fragment key={c.id}>
                        {/* ⭐ CORREÇÃO, 11/09/2026 — TODO contato é clicável, tenha ou
                            não `leadId`. Antes, quem não tinha `leadId` virava um
                            `<span>` sem `onClick` nenhum: achado do CEO, "contatos
                            sem leadId não são clicáveis". "Abrir conversa" continua
                            existindo, mas como ato SEPARADO — só aparece quando há
                            conversa de verdade, e nunca troca de lugar com o clique
                            que abre a ficha. */}
                        <tr className="border-t border-line2 align-top">
                          <td className="px-3 py-2">
                            <CelulaDoContato c={c} aberto={aberto} aoAlternar={() => alternar(c.id)} />
                          </td>
                          <td className="px-3 py-2 text-muted">
                            {[c.cidade, c.estado].filter(Boolean).join("/") || "—"}
                          </td>
                          <td className="px-3 py-2 text-muted">{c.tipo || "—"}</td>
                          <td className="px-3 py-2">
                            <div className="max-w-[24ch] truncate" title={c.proveniencia}>
                              {c.arquivo}
                            </div>
                            <div className="text-[11.5px] text-muted">
                              {c.responsavel ?? "sem responsável"}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-muted">{quando(c.entrouEm)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{c.tentativas}</td>
                          <td className="px-3 py-2 text-muted">{quando(c.ultimaTentativa)}</td>
                          <td className="px-3 py-2">{ROTULO_SITUACAO[c.situacao] ?? c.situacao}</td>
                          <td className="px-3 py-2">
                            {c.motivoDeBloqueio ? (
                              <span className="text-rose-700">{c.motivoDeBloqueio}</span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        </tr>
                        {aberto && (
                          <tr className="border-t border-line2 bg-canvas">
                            <td colSpan={9} className="px-4 py-3">
                              <FichaExpandidaDoContato c={c} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-3 flex items-center gap-2 text-[12.5px]">
            <button
              disabled={pagina <= 1}
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              className="rounded-md border border-line2 px-2.5 py-1.5 font-semibold text-ink2 disabled:opacity-40"
            >
              ← Anterior
            </button>
            <span className="text-muted">
              Página {pagina} de {ultimaPagina}
            </span>
            <button
              disabled={pagina >= ultimaPagina}
              onClick={() => setPagina((p) => p + 1)}
              className="rounded-md border border-line2 px-2.5 py-1.5 font-semibold text-ink2 disabled:opacity-40"
            >
              Próxima →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Campo({
  rotulo,
  valor,
  aoMudar,
  largura,
  dica,
  tipo = "text",
}: {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  largura: string;
  dica?: string;
  tipo?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11.5px] font-semibold text-muted">{rotulo}</span>
      <input
        type={tipo}
        value={valor}
        placeholder={dica}
        onChange={(e) => aoMudar(e.target.value)}
        className={`${largura} rounded-lg border border-line2 bg-paper px-2.5 py-1.5 text-[12.5px] text-ink`}
      />
    </label>
  );
}
