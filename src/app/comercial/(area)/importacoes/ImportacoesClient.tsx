"use client";

/**
 * AS IMPORTAÇÕES — um arquivo por linha, e o que aconteceu com ele.
 *
 * ── O QUE ESTA TELA EXISTE PARA RESPONDER ──────────────────────────────────
 *
 * No dia em que alguém perguntar *"de onde vocês tiraram o meu telefone?"*, a
 * resposta precisa caber numa frase e ter lastro. Antes de 10/09/2026 a casa
 * sabia que o lead veio de `LISTA_PROSPECCAO` e sabia a proveniência escrita à
 * mão no lote. Não sabia o arquivo, nem quantas linhas foram recusadas e por
 * quê, nem exatamente quem subiu.
 *
 * ── ⚠️ E POR QUE ELA MOSTRA O QUE FOI RECUSADO ──────────────────────────────
 *
 * A tentação é mostrar só o que entrou. Mas o número que denuncia uma lista
 * ruim é o de fora: 800 linhas com 300 telefones inválidos não é uma lista de
 * 500 contatos — é uma lista que alguém precisa olhar antes de a operação
 * gastar o dia com ela.
 */

import { Fragment, useCallback, useEffect, useState } from "react";

const ROTA = "/api/admin/sala-de-vendas/prospeccao";

interface Importacao {
  id: string;
  arquivoNome: string;
  arquivoHash: string | null;
  linhasTotais: number;
  linhasAceitas: number;
  novos: number;
  duplicadosNoArquivo: number;
  duplicadosEmOutras: number;
  jaEramLeads: number;
  telefonesInvalidos: number;
  linhasRecusadas: number;
  motivosDeRecusa: Record<string, number> | null;
  proveniencia: string;
  canalDeObtencao: string | null;
  criadoPor: string | null;
  criadoPorNome: string | null;
  situacao: string;
  erroTecnico: string | null;
  iniciadaEm: string;
  concluidaEm: string | null;
  canceladaEm: string | null;
  canceladaPor: string | null;
  motivoDoCancelamento: string | null;
  totalDeLotes: number;
  lotesPausados: number;
  itensNaBase: number;
}

const ROTULO_SITUACAO: Record<string, string> = {
  PROCESSANDO: "processando",
  CONCLUIDA: "concluída",
  FALHOU: "falhou",
  CANCELADA: "cancelada",
};

const COR_SITUACAO: Record<string, string> = {
  PROCESSANDO: "border-amber-300 bg-amber-50 text-amber-700",
  CONCLUIDA: "border-emerald-300 bg-emerald-50 text-emerald-700",
  FALHOU: "border-rose-300 bg-rose-50 text-rose-700",
  CANCELADA: "border-line2 bg-paper text-muted",
};

function quando(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function ImportacoesClient() {
  const [linhas, setLinhas] = useState<Importacao[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(25);
  const [aberta, setAberta] = useState<string | null>(null);
  const [fase, setFase] = useState<"carregando" | "pronto" | "semAcesso" | "erro">("carregando");
  const [detalhe, setDetalhe] = useState<string | null>(null);

  const carregar = useCallback(async (p: number) => {
    setFase("carregando");
    try {
      const res = await fetch(`${ROTA}?recorte=importacoes&pagina=${p}`, { cache: "no-store" });
      if (res.status === 401 || res.status === 403) return setFase("semAcesso");
      if (!res.ok) {
        setDetalhe(`${ROTA} respondeu ${res.status}`);
        return setFase("erro");
      }
      const j = (await res.json()) as {
        data?: { linhas: Importacao[]; total: number; pagina: number; porPagina: number };
      };
      setLinhas(j.data?.linhas ?? []);
      setTotal(j.data?.total ?? 0);
      setPorPagina(j.data?.porPagina ?? 25);
      setFase("pronto");
    } catch (e) {
      setDetalhe(e instanceof Error ? e.message : null);
      setFase("erro");
    }
  }, []);

  useEffect(() => {
    void carregar(pagina);
  }, [carregar, pagina]);

  async function cancelar(id: string, arquivo: string) {
    const motivo = window.prompt(
      `Cancelar a importação de "${arquivo}"?\n\n` +
        "Os contatos NÃO são apagados — os lotes ficam pausados e saem da fila. " +
        "Escreva o motivo:",
    );
    if (!motivo?.trim()) return;

    const res = await fetch(ROTA, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acao: "cancelarImportacao", importacaoId: id, motivo: motivo.trim() }),
    });
    if (!res.ok) {
      window.alert(`Não deu para cancelar: a rota respondeu ${res.status}.`);
      return;
    }
    void carregar(pagina);
  }

  const ultimaPagina = Math.max(1, Math.ceil(total / porPagina));

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-[17px] font-semibold text-ink">Importações</h1>
      <p className="mt-0.5 max-w-[70ch] text-[12.5px] leading-relaxed text-muted">
        Um arquivo por linha. É aqui que se responde <strong>de onde veio cada contato</strong> —
        qual arquivo, quem subiu, quando, e o que foi recusado. Os contatos em si ficam
        na Base fria.
      </p>

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

      {fase === "pronto" && linhas.length === 0 && (
        <p className="mt-4 text-[13px] text-muted">
          Nenhuma importação ainda. Suba uma lista pela tela de Prospecção.
        </p>
      )}

      {fase === "pronto" && linhas.length > 0 && (
        <>
          <p className="mt-3 text-[12.5px] text-muted">
            {total} importaç{total === 1 ? "ão" : "ões"}.
          </p>

          <div className="mt-2 overflow-x-auto rounded-xl border border-line2">
            <table className="w-full min-w-[900px] text-[12.5px]">
              <thead className="bg-paper2 text-left text-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">Arquivo</th>
                  <th className="px-3 py-2 font-semibold">Quando</th>
                  <th className="px-3 py-2 font-semibold">Quem subiu</th>
                  <th className="px-3 py-2 font-semibold">Procedência</th>
                  <th className="px-3 py-2 text-right font-semibold">Linhas</th>
                  <th className="px-3 py-2 text-right font-semibold">Novos</th>
                  <th className="px-3 py-2 text-right font-semibold">Recusadas</th>
                  <th className="px-3 py-2 font-semibold">Situação</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {linhas.map((i) => (
                  // A chave vai no Fragment, e não nos `<tr>` de dentro: com a
                  // chave nos filhos, React perde a identidade da linha ao
                  // abrir o detalhe e a tabela pisca inteira.
                  <Fragment key={i.id}>
                    <tr className="border-t border-line2 align-top">
                      <td className="px-3 py-2">
                        <button
                          onClick={() => setAberta(aberta === i.id ? null : i.id)}
                          className="text-left font-semibold text-brand-700 hover:underline"
                        >
                          {i.arquivoNome}
                        </button>
                        <div className="text-[11.5px] text-muted">
                          {/* "16 partes" traduzido de volta para "uma lista". */}
                          {i.totalDeLotes > 1 ? `${i.totalDeLotes} partes · ` : ""}
                          {i.itensNaBase} na base
                          {i.lotesPausados > 0 ? ` · ${i.lotesPausados} pausadas` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted">{quando(i.iniciadaEm)}</td>
                      <td className="px-3 py-2">{i.criadoPorNome ?? i.criadoPor ?? "—"}</td>
                      <td className="px-3 py-2 max-w-[26ch] truncate" title={i.proveniencia}>
                        {i.proveniencia}
                        {i.canalDeObtencao ? (
                          <div className="text-[11.5px] text-muted">via {i.canalDeObtencao}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{i.linhasTotais}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700">
                        {i.novos}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-rose-700">
                        {i.linhasRecusadas + i.telefonesInvalidos}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-md border px-1.5 py-0.5 text-[11.5px] font-semibold ${
                            COR_SITUACAO[i.situacao] ?? "border-line2 bg-paper text-ink2"
                          }`}
                        >
                          {ROTULO_SITUACAO[i.situacao] ?? i.situacao.toLowerCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {i.situacao !== "CANCELADA" && (
                          <button
                            onClick={() => void cancelar(i.id, i.arquivoNome)}
                            className="rounded-md border border-line2 px-2 py-1 text-[11.5px] font-semibold text-ink2 hover:border-rose-300 hover:text-rose-700"
                          >
                            Cancelar
                          </button>
                        )}
                      </td>
                    </tr>

                    {aberta === i.id && (
                      <tr className="border-t border-line2 bg-paper2">
                        <td colSpan={9} className="px-3 py-3">
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <Numero rotulo="Aceitas" valor={i.linhasAceitas} />
                            <Numero rotulo="Novos contatos" valor={i.novos} />
                            <Numero rotulo="Repetidos no arquivo" valor={i.duplicadosNoArquivo} />
                            <Numero rotulo="Repetidos de outras listas" valor={i.duplicadosEmOutras} />
                            <Numero rotulo="Já eram leads" valor={i.jaEramLeads} />
                            <Numero rotulo="Telefones inválidos" valor={i.telefonesInvalidos} />
                            <Numero rotulo="Contatos na base" valor={i.itensNaBase} />
                            <Numero rotulo="Partes" valor={i.totalDeLotes} />
                          </div>

                          {i.motivosDeRecusa && Object.keys(i.motivosDeRecusa).length > 0 && (
                            <div className="mt-3">
                              <p className="text-[12px] font-semibold text-ink2">Por que foram recusadas</p>
                              <ul className="mt-1 space-y-0.5 text-[12px] text-muted">
                                {Object.entries(i.motivosDeRecusa).map(([motivo, n]) => (
                                  <li key={motivo}>
                                    {n} × {motivo}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          <div className="mt-3 space-y-0.5 text-[12px] text-muted">
                            <p>Concluída em {quando(i.concluidaEm)}</p>
                            {i.arquivoHash && (
                              <p className="font-mono text-[11px]">
                                impressão do arquivo: {i.arquivoHash.slice(0, 16)}…
                              </p>
                            )}
                            {i.erroTecnico && (
                              <p className="text-rose-700">Erro técnico: {i.erroTecnico}</p>
                            )}
                            {i.canceladaEm && (
                              <p className="text-rose-700">
                                Cancelada em {quando(i.canceladaEm)} por {i.canceladaPor ?? "—"}
                                {i.motivoDoCancelamento ? ` — ${i.motivoDoCancelamento}` : ""}
                              </p>
                            )}
                          </div>

                          <a
                            href={`/comercial/base-fria?importacaoId=${i.id}`}
                            className="mt-3 inline-block rounded-md border border-line2 px-2.5 py-1.5 text-[12px] font-semibold text-brand-700 hover:border-brand-300"
                          >
                            Ver os contatos desta importação →
                          </a>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

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

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="rounded-lg border border-line2 bg-paper px-2.5 py-2">
      <div className="text-[11.5px] text-muted">{rotulo}</div>
      <div className="text-[15px] font-semibold tabular-nums text-ink">{valor}</div>
    </div>
  );
}
