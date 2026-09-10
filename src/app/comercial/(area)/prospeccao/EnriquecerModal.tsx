"use client";

import { useCallback, useRef, useState } from "react";

interface Coluna {
  nome: string;
  indice: number;
}

interface ResultadoEnriquecimento {
  sucesso: boolean;
  erro?: string;
  resultado?: {
    processados: number;
    atualizados: number;
    naoEncontrados: number;
    erros: Array<{ linha: number; erro: string }>;
  };
  colunas?: string[];
  parametros?: {
    separador: string;
    temCabecalho: boolean;
    descartadasSemTelefone: number;
  };
}

const CAMPOS_DISPONIVEIS = [
  { id: "telefone", label: "Telefone (WhatsApp)" },
  { id: "nome", label: "Nome" },
  { id: "empresa", label: "Empresa" },
  { id: "cidade", label: "Cidade" },
  { id: "estado", label: "Estado (UF)" },
  { id: "tipo", label: "Tipo de contato" },
];

export function EnriquecerModal({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [colunas, setColunas] = useState<Coluna[]>([]);
  const [mapeamento, setMapeamento] = useState<Record<string, string>>({});
  const [fase, setFase] = useState<"upload" | "preview" | "processando" | "resultado">("upload");
  const [resultado, setResultado] = useState<ResultadoEnriquecimento | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const inputFile = useRef<HTMLInputElement>(null);

  const aoSelecionarArquivo = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setArquivo(file);
      setFase("preview");
      setColunas([]);
      setMapeamento({});
    }
  }, []);

  const aoAlterarMapeamento = useCallback((coluna: string, campo: string) => {
    setMapeamento((prev) => {
      if (!campo) {
        const { [coluna]: _, ...resto } = prev;
        return resto;
      }
      return { ...prev, [coluna]: campo };
    });
  }, []);

  const aoExecutar = useCallback(async () => {
    if (!arquivo) return;

    setOcupado(true);
    setFase("processando");

    const formData = new FormData();
    formData.append("arquivo", arquivo);

    try {
      const res = await fetch("/api/admin/sala-de-vendas/prospeccao/enriquecer", {
        method: "POST",
        body: formData,
      });

      const dados = (await res.json()) as ResultadoEnriquecimento;

      if (!res.ok) {
        setFase("resultado");
        setResultado({
          sucesso: false,
          erro: dados.erro || "Erro ao processar arquivo",
        });
      } else {
        setFase("resultado");
        setResultado(dados);
        // Atualizar colunas detectadas na tela de preview
        if (dados.colunas) {
          const novasColunas = dados.colunas.map((nome, i) => ({ nome, indice: i }));
          setColunas(novasColunas);
        }
      }
    } catch (e) {
      setFase("resultado");
      setResultado({
        sucesso: false,
        erro: e instanceof Error ? e.message : "Erro ao enviar arquivo",
      });
    } finally {
      setOcupado(false);
    }
  }, [arquivo]);

  const aoFecharInternal = useCallback(() => {
    setFase("upload");
    setArquivo(null);
    setColunas([]);
    setMapeamento({});
    setResultado(null);
    onFechar();
  }, [onFechar]);

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-paper">
        <div className="sticky top-0 border-b border-line bg-paper px-6 py-4">
          <h2 className="text-[16px] font-semibold text-ink">
            Enriquecer dados de uma lista existente
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            Carregue um CSV/XLSX para preencher campos vazios de contatos existentes
          </p>
        </div>

        <div className="space-y-4 px-6 py-4">
          {/* ── FASE 1: UPLOAD ── */}
          {fase === "upload" && (
            <div className="space-y-3">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-line bg-canvas p-6 transition-colors hover:border-brand-500">
                <svg
                  className="h-8 w-8 text-muted"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33A3 3 0 0116.5 19.5H6.75z"
                  />
                </svg>
                <div className="text-center">
                  <p className="text-[13px] font-semibold text-ink">
                    {arquivo ? arquivo.name : "Clique ou arraste um arquivo"}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted">CSV, TSV ou XLSX</p>
                </div>
                <input
                  ref={inputFile}
                  type="file"
                  accept=".csv,.tsv,.xlsx,.xls"
                  onChange={aoSelecionarArquivo}
                  className="hidden"
                />
              </label>

              <div className="flex gap-2">
                <button
                  onClick={aoFecharInternal}
                  className="flex-1 rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* ── FASE 2: PREVIEW E MAPEAMENTO ── */}
          {fase === "preview" && colunas.length > 0 && (
            <div className="space-y-3">
              <div>
                <p className="text-[12px] font-semibold text-ink">
                  Mapeie as colunas do seu arquivo
                </p>
                <p className="mt-0.5 text-[12px] text-muted">
                  Selecione qual coluna corresponde a cada campo
                </p>
              </div>

              <div className="space-y-2">
                {colunas.map((col) => (
                  <div key={col.indice} className="flex gap-2">
                    <label className="flex-1 text-[12.5px]">
                      <span className="block text-[12px] font-semibold text-ink">{col.nome}</span>
                      <select
                        value={mapeamento[col.nome] || ""}
                        onChange={(e) => aoAlterarMapeamento(col.nome, e.target.value)}
                        className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-[12.5px] text-ink"
                      >
                        <option value="">Não usar</option>
                        {CAMPOS_DISPONIVEIS.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setFase("upload")}
                  className="flex-1 rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink"
                >
                  Voltar
                </button>
                <button
                  onClick={aoExecutar}
                  disabled={ocupado}
                  className="flex-1 rounded-lg bg-brand-500 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                >
                  Processar
                </button>
              </div>
            </div>
          )}

          {/* ── FASE 3: PROCESSANDO ── */}
          {fase === "processando" && (
            <div className="flex flex-col items-center justify-center gap-3 py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brand-500" />
              <p className="text-[13px] text-muted">Processando arquivo...</p>
            </div>
          )}

          {/* ── FASE 4: RESULTADO ── */}
          {fase === "resultado" && resultado && (
            <div className="space-y-3">
              {resultado.sucesso ? (
                <>
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                    <p className="text-[13px] font-semibold text-green-900">✓ Enriquecimento concluído</p>
                    <ul className="mt-2 space-y-1 text-[12.5px] text-green-800">
                      <li>Processados: {resultado.resultado?.processados}</li>
                      <li>Atualizados: {resultado.resultado?.atualizados}</li>
                      <li>Não encontrados: {resultado.resultado?.naoEncontrados}</li>
                    </ul>
                    {resultado.resultado?.erros.length ? (
                      <div className="mt-2 text-[12px] text-red-700">
                        <p className="font-semibold">Erros encontrados:</p>
                        <ul className="mt-1 space-y-0.5">
                          {resultado.resultado.erros.slice(0, 5).map((e, i) => (
                            <li key={i}>
                              Linha {e.linha}: {e.erro}
                            </li>
                          ))}
                          {resultado.resultado.erros.length > 5 && (
                            <li>... e mais {resultado.resultado.erros.length - 5}</li>
                          )}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-[13px] font-semibold text-red-900">✕ Erro ao processar</p>
                  <p className="mt-1 text-[12.5px] text-red-800">{resultado.erro}</p>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setFase("upload")}
                  className="flex-1 rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink"
                >
                  Carregar outro arquivo
                </button>
                <button
                  onClick={aoFecharInternal}
                  className="flex-1 rounded-lg bg-brand-500 px-4 py-2 text-[13px] font-semibold text-white"
                >
                  Pronto
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
