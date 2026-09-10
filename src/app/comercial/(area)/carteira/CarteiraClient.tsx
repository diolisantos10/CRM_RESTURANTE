"use client";

/**
 * A CARTEIRA — a tabela de todos os leads.
 *
 * ── ⚠️ POR QUE O FILTRO PADRÃO NÃO É "TODOS" ───────────────────────────────
 *
 * É **"Sem desfecho"**. Quem abre esta tela de manhã não precisa da base
 * inteira: precisa de quem recebeu mensagem e ficou no limbo — sem resposta,
 * sem próxima ação, sem fim. Abrir em "todos" enterraria essa lista no meio de
 * centenas de linhas, que é exatamente como esses leads sumiam antes.
 *
 * A base inteira está a um clique, no primeiro botão.
 */

import { useCallback, useEffect, useState } from "react";

const ROTA = "/api/admin/sala-de-vendas/carteira";

interface Linha {
  id: string;
  nome: string;
  restaurante: string | null;
  cidade: string | null;
  stage: string;
  temperatura: string | null;
  atendenteNome: string | null;
  origem: string | null;
  ultimoContatoEm: string | null;
  ultimaRespostaEm: string | null;
  estadoDaUltimaSaida: string | null;
  tentativas: number;
  proximaAcaoEm: string | null;
  proximaAcaoNota: string | null;
  followUpVencido: boolean;
  silenciado: boolean;
  motivoDaPerda: string | null;
}

const ESTADOS = [
  { chave: "semDesfecho", rotulo: "Sem desfecho", pergunta: "abordei e ficou no limbo" },
  { chave: "followUpVencido", rotulo: "Follow-up vencido", pergunta: "prometi e não fiz" },
  { chave: "aguardandoResposta", rotulo: "Em conversa", pergunta: "está andando" },
  { chave: "nuncaAbordado", rotulo: "Nunca abordado", pergunta: "não comecei" },
  { chave: "ganhos", rotulo: "Ganhos", pergunta: "fechou" },
  { chave: "perdidos", rotulo: "Perdidos", pergunta: "acabou" },
  { chave: "silenciados", rotulo: "Pediram silêncio", pergunta: "não se fala mais" },
  { chave: "todos", rotulo: "Todos", pergunta: "a base inteira" },
] as const;

const ROTULO_ENTREGA: Record<string, string> = {
  PENDENTE: "não saiu",
  ENVIADA: "enviada",
  ENTREGUE: "entregue",
  LIDA: "lida",
  FALHOU: "falhou",
};

function quando(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dias = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (dias === 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias} d`;
}

export function CarteiraClient() {
  const [estado, setEstado] = useState<string>("semDesfecho");
  const [busca, setBusca] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [total, setTotal] = useState(0);
  const [fase, setFase] = useState<"carregando" | "pronto" | "semAcesso" | "erro">("carregando");
  const [detalhe, setDetalhe] = useState<string | null>(null);

  const carregar = useCallback(async (est: string, termo: string) => {
    setFase("carregando");
    try {
      const p = new URLSearchParams({ estado: est });
      if (termo.trim()) p.set("busca", termo.trim());
      const res = await fetch(`${ROTA}?${p}`, { cache: "no-store" });
      if (res.status === 401 || res.status === 403) return setFase("semAcesso");
      if (!res.ok) {
        setDetalhe(`${ROTA} respondeu ${res.status}`);
        return setFase("erro");
      }
      const j = (await res.json()) as { data?: { linhas: Linha[]; total: number } };
      setLinhas(j.data?.linhas ?? []);
      setTotal(j.data?.total ?? 0);
      setFase("pronto");
    } catch (e) {
      setDetalhe(e instanceof Error ? e.message : null);
      setFase("erro");
    }
  }, []);

  useEffect(() => {
    void carregar(estado, busca);
    // A busca tem botão próprio: recarregar a cada tecla faria uma consulta por
    // letra digitada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-[17px] font-semibold text-ink">Carteira</h1>
      <p className="mt-0.5 max-w-[70ch] text-[12.5px] leading-relaxed text-muted">
        Todos os leads, com o que aconteceu com cada um. A tela abre em{" "}
        <strong>Sem desfecho</strong> de propósito: é a lista de quem recebeu mensagem
        e ficou no limbo — a única que some sozinha das outras telas.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {ESTADOS.map((e) => (
          <button
            key={e.chave}
            onClick={() => setEstado(e.chave)}
            title={e.pergunta}
            className={`rounded-lg border px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
              estado === e.chave
                ? "border-brand-400 bg-brand-50 text-brand-700"
                : "border-line2 bg-paper text-ink2 hover:border-brand-300"
            }`}
          >
            {e.rotulo}
          </button>
        ))}
      </div>

      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void carregar(estado, busca);
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={busca}
          onChange={(ev) => setBusca(ev.target.value)}
          placeholder="Nome, restaurante, cidade ou telefone"
          className="min-w-0 flex-1 rounded-xl border border-line2 bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-brand-400"
        />
        <button className="shrink-0 rounded-xl bg-brand-500 px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-600">
          Buscar
        </button>
      </form>

      {fase === "carregando" && <p className="mt-4 text-[13px] text-muted">Carregando…</p>}
      {fase === "semAcesso" && (
        <p className="mt-4 text-[13px] text-muted">Sem acesso. É preciso um login interno.</p>
      )}
      {fase === "erro" && (
        <p className="mt-4 text-[13px] text-red-700">{detalhe ?? "Não consegui carregar."}</p>
      )}

      {fase === "pronto" && (
        <>
          <p className="mt-3 text-[12.5px] text-muted">
            {linhas.length} de {total}
          </p>

          {linhas.length === 0 ? (
            <p className="mt-3 rounded-xl border border-line bg-paper px-3 py-3 text-[13px] text-muted">
              Nenhum lead neste recorte.
            </p>
          ) : (
            /* A tabela rola sozinha no celular; a página não. */
            <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-paper">
              <table className="w-full min-w-[860px] text-[12.5px]">
                <thead className="border-b border-line text-left text-[11.5px] uppercase tracking-[.04em] text-muted">
                  <tr>
                    <th className="px-3 py-2">Quem</th>
                    <th className="px-3 py-2">Etapa</th>
                    <th className="px-3 py-2">Responsável</th>
                    <th className="px-3 py-2">Origem</th>
                    <th className="px-3 py-2">Último contato</th>
                    <th className="px-3 py-2">Entrega</th>
                    <th className="px-3 py-2 text-right">Tentativas</th>
                    <th className="px-3 py-2">Próxima ação</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.id} className="border-b border-line last:border-0 hover:bg-canvas">
                      <td className="px-3 py-2">
                        <a
                          href={`/comercial/conversas?leadId=${encodeURIComponent(l.id)}`}
                          className="font-semibold text-ink underline decoration-line2 underline-offset-2 hover:decoration-brand-400"
                        >
                          {l.nome}
                        </a>
                        {l.restaurante && <span className="block text-[11.5px] text-muted">{l.restaurante}</span>}
                        {l.silenciado && (
                          <span className="mt-0.5 inline-block rounded-full bg-red-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-red-700">
                            pediu silêncio
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-ink2">
                        {l.stage}
                        {l.motivoDaPerda && (
                          <span className="block text-[11px] text-muted">{l.motivoDaPerda}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-ink2">{l.atendenteNome ?? "—"}</td>
                      <td className="px-3 py-2 text-ink2">{l.origem ?? "—"}</td>
                      <td className="px-3 py-2 text-ink2">{quando(l.ultimoContatoEm)}</td>
                      <td className="px-3 py-2 text-ink2">
                        {l.estadoDaUltimaSaida ? (ROTULO_ENTREGA[l.estadoDaUltimaSaida] ?? l.estadoDaUltimaSaida) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink2">{l.tentativas}</td>
                      <td className="px-3 py-2">
                        {l.proximaAcaoEm ? (
                          <span className={l.followUpVencido ? "font-semibold text-red-700" : "text-ink2"}>
                            {l.proximaAcaoNota ?? "sem nota"} · {quando(l.proximaAcaoEm)}
                          </span>
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
        </>
      )}
    </div>
  );
}
