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

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const ROTA = "/api/admin/sala-de-vendas/prospeccao";

interface Contato {
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
                  {linhas.map((c) => (
                    <tr key={c.id} className="border-t border-line2 align-top">
                      <td className="px-3 py-2">
                        {c.leadId ? (
                          <a
                            href={`/comercial/conversas?leadId=${c.leadId}`}
                            className="font-semibold text-brand-700 hover:underline"
                          >
                            {c.nome || c.empresa || c.whatsapp}
                          </a>
                        ) : (
                          <span className="font-semibold text-ink">
                            {c.nome || c.empresa || c.whatsapp}
                          </span>
                        )}
                        <div className="text-[11.5px] text-muted">{c.whatsapp}</div>
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
                  ))}
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
