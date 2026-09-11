"use client";

/**
 * ENRIQUECER DADOS — preencher campos vazios de contatos já importados.
 *
 * ── POR QUE A LEITURA ACONTECE AQUI, NO NAVEGADOR, E NÃO NO SERVIDOR ────────
 *
 * XLSX é um zip binário. `lerPlanilha` só entende texto. `ReceberLista.tsx` já
 * resolveu isso para a importação: converte Excel para CSV com a biblioteca
 * `xlsx` ANTES de qualquer coisa sair do navegador. Este modal repete a mesma
 * régua — um leitor de planilha só, não dois que podem divergir — e além
 * disso deixa o operador REMAPEAR as colunas quando o palpite automático
 * errar, aplicando de verdade a escolha dele antes de mandar ao servidor.
 */

import { useCallback, useMemo, useState } from "react";
import { lerPlanilha, type CampoConhecido, type LinhaLida } from "@/services/salaDeVendas/prospeccao/lerPlanilha";
import {
  lerGradeBruta,
  construirLinhasComMapeamento,
  type GradeBruta,
} from "@/services/salaDeVendas/prospeccao/mapeamentoManual";

interface ResultadoEnriquecimento {
  linhasProcessadas: number;
  itemsEncontrados: number;
  itemsEnriquecidos: number;
  camposAtualizados: number;
  naoEncontrados: number;
  naoAlterados: number;
  erros: Array<{ linha: number; motivo: string }>;
}

/**
 * Os 20 campos da Base fria. Rótulos explícitos por ordem do CEO, 11/09/2026:
 * "Nome" é sempre o RESPONSÁVEL, "Empresa" é sempre o RESTAURANTE, e "Tipo de
 * restaurante" mapeia para o campo técnico `tipo` — nunca para Empresa. Um
 * operador que só olha a lista de rótulos, sem ler código nenhum, não pode
 * ter dúvida de qual é qual.
 */
const CAMPOS_DISPONIVEIS: Array<{ id: CampoConhecido; label: string }> = [
  { id: "whatsapp", label: "WhatsApp principal" },
  { id: "nome", label: "Nome do responsável" },
  { id: "cargo", label: "Cargo / função" },
  { id: "empresa", label: "Restaurante / Empresa" },
  { id: "tipo", label: "Tipo de restaurante" },
  { id: "telefoneSecundario", label: "Telefone secundário" },
  { id: "email", label: "E-mail" },
  { id: "cidade", label: "Cidade" },
  { id: "estado", label: "Estado (UF)" },
  { id: "bairro", label: "Bairro" },
  { id: "endereco", label: "Endereço" },
  { id: "cep", label: "CEP" },
  { id: "cnpj", label: "CNPJ" },
  { id: "instagram", label: "Instagram" },
  { id: "site", label: "Site" },
  { id: "googleMapsUrl", label: "URL do Google Maps" },
  { id: "numeroDeUnidades", label: "Número de unidades" },
  { id: "canaisAtuais", label: "Canais atuais / marketplaces" },
  { id: "observacoes", label: "Observações" },
  { id: "tags", label: "Tags" },
];

type Fase = "upload" | "preview" | "processando" | "resultado";

interface Erro {
  mensagem: string;
}

async function lerTextoDoArquivo(f: File): Promise<string> {
  const ehExcel = /\.(xlsx|xlsm|xls)$/i.test(f.name);
  if (!ehExcel) return f.text();

  const XLSX = await import("xlsx");
  const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
  const primeira = wb.SheetNames[0];
  if (!primeira) throw new Error("planilha sem nenhuma aba");
  return XLSX.utils.sheet_to_csv(wb.Sheets[primeira]!);
}

export function EnriquecerModal({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const [fase, setFase] = useState<Fase>("upload");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [grade, setGrade] = useState<GradeBruta | null>(null);
  const [temCabecalho, setTemCabecalho] = useState(false);
  const [mapeamento, setMapeamento] = useState<Record<number, CampoConhecido | null>>({});
  const [descartadasNaLeitura, setDescartadasNaLeitura] = useState(0);
  const [erroDeLeitura, setErroDeLeitura] = useState<string | null>(null);
  const [carregandoArquivo, setCarregandoArquivo] = useState(false);
  const [resultado, setResultado] = useState<ResultadoEnriquecimento | null>(null);
  const [erroDeExecucao, setErroDeExecucao] = useState<Erro | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const totalMapeado = useMemo(
    () => Object.values(mapeamento).some((c) => c === "whatsapp"),
    [mapeamento],
  );

  const aoSelecionarArquivo = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setCarregandoArquivo(true);
    setErroDeLeitura(null);
    setArquivo(file);

    try {
      const texto = await lerTextoDoArquivo(file);

      // Usa `lerPlanilha` só para o PALPITE inicial (cabeçalho detectado, campo
      // sugerido por coluna) — quem decide o resultado final é sempre
      // `construirLinhasComMapeamento`, mesmo quando o operador não muda nada.
      const sugestao = lerPlanilha(texto);
      const gradeBruta = lerGradeBruta(texto);

      if (gradeBruta.titulos.length === 0) {
        setErroDeLeitura("Arquivo vazio — nenhuma linha encontrada.");
        setCarregandoArquivo(false);
        return;
      }

      const mapaSugerido: Record<number, CampoConhecido | null> = {};
      sugestao.colunas.forEach((c, i) => {
        mapaSugerido[i] = c.campo;
      });

      setGrade(gradeBruta);
      setTemCabecalho(sugestao.temCabecalho);
      setMapeamento(mapaSugerido);
      setDescartadasNaLeitura(sugestao.descartadas);
      setFase("preview");
    } catch (err) {
      setErroDeLeitura(err instanceof Error ? err.message : "não consegui ler este arquivo");
    } finally {
      setCarregandoArquivo(false);
    }
  }, []);

  const aoAlterarMapeamento = useCallback((indice: number, valor: string) => {
    setMapeamento((prev) => ({
      ...prev,
      [indice]: (valor || null) as CampoConhecido | null,
    }));
  }, []);

  const aoExecutar = useCallback(async () => {
    if (!grade || !arquivo) return;

    const { linhas, descartadas } = construirLinhasComMapeamento(grade, mapeamento, temCabecalho);

    if (linhas.length === 0) {
      setErroDeExecucao({
        mensagem:
          descartadas > 0
            ? `Nenhuma linha com telefone válido depois do mapeamento (${descartadas} descartadas). Confira a coluna marcada como "Telefone (WhatsApp)".`
            : "Nenhuma linha para processar com este mapeamento.",
      });
      return;
    }

    setOcupado(true);
    setFase("processando");
    setErroDeExecucao(null);

    try {
      const res = await fetch("/api/admin/sala-de-vendas/prospeccao/enriquecer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linhas: linhas satisfies LinhaLida[],
          nomeArquivo: arquivo.name,
        }),
      });

      const json = (await res.json().catch(() => null)) as
        | { ok: true; data: ResultadoEnriquecimento }
        | { ok: false; error: string }
        | null;

      if (!res.ok || !json?.ok) {
        setFase("resultado");
        setErroDeExecucao({ mensagem: json?.ok === false ? json.error : `O servidor recusou (${res.status}).` });
        return;
      }

      setResultado(json.data);
      setFase("resultado");
    } catch (e) {
      setFase("resultado");
      setErroDeExecucao({ mensagem: e instanceof Error ? e.message : "não consegui falar com o servidor" });
    } finally {
      setOcupado(false);
    }
  }, [grade, mapeamento, temCabecalho, arquivo]);

  const aoFecharInternal = useCallback(() => {
    setFase("upload");
    setArquivo(null);
    setGrade(null);
    setMapeamento({});
    setTemCabecalho(false);
    setDescartadasNaLeitura(0);
    setErroDeLeitura(null);
    setResultado(null);
    setErroDeExecucao(null);
    onFechar();
  }, [onFechar]);

  const aoReiniciar = useCallback(() => {
    setFase("upload");
    setArquivo(null);
    setGrade(null);
    setMapeamento({});
    setTemCabecalho(false);
    setDescartadasNaLeitura(0);
    setErroDeLeitura(null);
    setResultado(null);
    setErroDeExecucao(null);
  }, []);

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
                <svg className="h-8 w-8 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33A3 3 0 0116.5 19.5H6.75z"
                  />
                </svg>
                <div className="text-center">
                  <p className="text-[13px] font-semibold text-ink">
                    {carregandoArquivo
                      ? "Lendo arquivo..."
                      : (arquivo?.name ?? "Clique ou arraste um arquivo")}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted">CSV, TSV ou XLSX</p>
                </div>
                <input
                  type="file"
                  accept=".csv,.tsv,.xlsx,.xlsm,.xls"
                  onChange={aoSelecionarArquivo}
                  disabled={carregandoArquivo}
                  className="hidden"
                />
              </label>

              {erroDeLeitura && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800">
                  {erroDeLeitura}
                </p>
              )}

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
          {fase === "preview" && grade && (
            <div className="space-y-3">
              <div>
                <p className="text-[12px] font-semibold text-ink">
                  Mapeie as colunas do seu arquivo
                </p>
                <p className="mt-0.5 text-[12px] text-muted">
                  {temCabecalho
                    ? "Cabeçalho detectado — confira e corrija se algo saiu errado."
                    : "Sem cabeçalho reconhecível — a casa tentou adivinhar pelo conteúdo."}
                  {descartadasNaLeitura > 0 &&
                    ` ${descartadasNaLeitura} linha(s) sem telefone reconhecível no palpite inicial.`}
                </p>
                {!totalMapeado && (
                  <p className="mt-1 text-[12px] font-semibold text-amber-700">
                    Nenhuma coluna está marcada como Telefone — escolha uma antes de processar.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                {grade.titulos.map((titulo, indice) => (
                  <div key={indice} className="flex gap-2">
                    <label className="flex-1 text-[12.5px]">
                      <span className="block text-[12px] font-semibold text-ink">{titulo}</span>
                      <select
                        value={mapeamento[indice] ?? ""}
                        onChange={(e) => aoAlterarMapeamento(indice, e.target.value)}
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

              {erroDeExecucao && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800">
                  {erroDeExecucao.mensagem}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={aoReiniciar}
                  className="flex-1 rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink"
                >
                  Voltar
                </button>
                <button
                  onClick={aoExecutar}
                  disabled={ocupado || !totalMapeado}
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
          {fase === "resultado" && (
            <div className="space-y-3">
              {resultado ? (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                  <p className="text-[13px] font-semibold text-green-900">✓ Enriquecimento concluído</p>
                  <ul className="mt-2 space-y-1 text-[12.5px] text-green-800">
                    <li>Linhas processadas: {resultado.linhasProcessadas}</li>
                    <li>Contatos encontrados: {resultado.itemsEncontrados}</li>
                    <li>Contatos enriquecidos: {resultado.itemsEnriquecidos}</li>
                    <li>Campos preenchidos: {resultado.camposAtualizados}</li>
                    <li>Não encontrados: {resultado.naoEncontrados}</li>
                    <li>Já preenchidos (sem alteração): {resultado.naoAlterados}</li>
                  </ul>
                  {resultado.erros.length > 0 && (
                    <div className="mt-2 text-[12px] text-red-700">
                      <p className="font-semibold">Linhas com problema:</p>
                      <ul className="mt-1 space-y-0.5">
                        {resultado.erros.slice(0, 5).map((e, i) => (
                          <li key={i}>
                            Linha {e.linha}: {e.motivo}
                          </li>
                        ))}
                        {resultado.erros.length > 5 && <li>... e mais {resultado.erros.length - 5}</li>}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-[13px] font-semibold text-red-900">✕ Erro ao processar</p>
                  <p className="mt-1 text-[12.5px] text-red-800">{erroDeExecucao?.mensagem}</p>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={aoReiniciar}
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
