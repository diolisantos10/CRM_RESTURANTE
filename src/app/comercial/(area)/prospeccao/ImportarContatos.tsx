"use client";

/**
 * IMPORTAR CONTATOS — bloco 1 do redesenho minimalista, 12/09/2026.
 *
 * ── O QUE MUDOU EM RELAÇÃO À TELA ANTERIOR (`ReceberLista.tsx`) ─────────────
 *
 * Antes existiam DUAS portas — "Receber lista" (`acao: "importar"`) e
 * "Enriquecer dados de uma lista existente" (`EnriquecerModal.tsx`, rota
 * `/enriquecer`) — e quem subia o arquivo precisava saber de antemão qual das
 * duas usar. O CEO pediu o fim dessa pergunta: agora existe UMA área de
 * upload, e toda linha — nova, repetida, complemento de dado que faltava —
 * passa pela MESMA chamada, `acao: "importarClassificado"`
 * (`classificarArquivoDeImportacao`, em `classificacao.ts`), que decide por
 * conta própria o que fazer com cada linha.
 *
 * ── O MAPEAMENTO MANUAL CONTINUA EXISTINDO — SÓ PAROU DE SER FORÇADO ────────
 *
 * `lerPlanilha`/`mapeamentoManual.ts` não mudaram uma linha: o reconhecimento
 * automático de coluna por cabeçalho (ou por conteúdo, na falta de cabeçalho)
 * é o mesmo. O que mudou é a TELA: antes ela sempre mostrava a grade de
 * seletores, coluna por coluna, em todo upload — mesmo quando o palpite
 * automático estava certo. Agora essa grade só aparece quando o
 * reconhecimento **de fato falhou** (nenhuma coluna reconhecida como
 * WhatsApp) — porque é exatamente aí que uma escolha manual é necessária, e
 * não antes.
 *
 * ── O RESUMO É UMA FRASE POR CATEGORIA, NÃO UMA TABELA TÉCNICA ──────────────
 *
 * `ResumoDaClassificacao` (o que o backend devolve) tem 10 campos. A tela do
 * CEO mostra os 5 que ele pediu — novos / enriquecidos / já existentes /
 * inválidos / aguardando informação — e o resto (duplicatas exatas,
 * conflitos, já abordados, opt-out) vai para "Ver relatório", recolhido.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  lerPlanilha,
  ROTULO_DO_CAMPO,
  type CampoConhecido,
  type LinhaLida,
} from "@/services/salaDeVendas/prospeccao/lerPlanilha";
import {
  lerGradeBruta,
  construirLinhasComMapeamento,
  type GradeBruta,
} from "@/services/salaDeVendas/prospeccao/mapeamentoManual";

const ROTA = "/api/admin/sala-de-vendas/prospeccao";
/** O servidor recusa acima disto. A tela quebra em partes em vez de falhar. */
const POR_LOTE = 500;

interface ArquivoLido {
  nome: string;
  tipo: string | null;
  bytes: number | null;
  hash: string | null;
  grade: GradeBruta;
  temCabecalho: boolean;
  mapeamento: Record<number, CampoConhecido | null>;
  sugestaoAutomatica: Record<number, CampoConhecido | null>;
  erro: string | null;
}

function linhasDoArquivo(a: ArquivoLido): { linhas: LinhaLida[]; descartadas: number } {
  if (a.erro) return { linhas: [], descartadas: 0 };
  return construirLinhasComMapeamento(a.grade, a.mapeamento, a.temCabecalho);
}

/**
 * Espelha `ResumoDaClassificacao` (`classificacao.ts`) — não importado
 * daquele arquivo porque ele carrega o `PrismaClient`, e este componente é
 * client. Mesmo princípio das interfaces `Fila`/`Interruptor` já usadas em
 * `ProspeccaoClient.tsx`: a forma da resposta, sem o módulo de servidor atrás.
 */
interface CampoDivergente {
  campo: string;
  valorAtual: string;
  valorNovo: string;
}
interface LinhaClassificada {
  indice: number;
  classificacao:
    | "NOVO"
    | "DUPLICATA_EXATA"
    | "ENRIQUECIMENTO"
    | "CONFLITO"
    | "INVALIDO"
    | "JA_EXISTENTE"
    | "JA_ABORDADO"
    | "OPT_OUT";
  camposEmConflito: CampoDivergente[];
}
interface ResumoDaClassificacao {
  analisadas: number;
  novos: number;
  enriquecidos: number;
  jaExistentes: number;
  invalidos: number;
  aguardandoInformacao: number;
  duplicatasExatas: number;
  conflitos: number;
  jaAbordados: number;
  optOut: number;
  linhas: LinhaClassificada[];
}

function resumoVazio(): ResumoDaClassificacao {
  return {
    analisadas: 0,
    novos: 0,
    enriquecidos: 0,
    jaExistentes: 0,
    invalidos: 0,
    aguardandoInformacao: 0,
    duplicatasExatas: 0,
    conflitos: 0,
    jaAbordados: 0,
    optOut: 0,
    linhas: [],
  };
}

function somarResumo(a: ResumoDaClassificacao, b: ResumoDaClassificacao): ResumoDaClassificacao {
  return {
    analisadas: a.analisadas + b.analisadas,
    novos: a.novos + b.novos,
    enriquecidos: a.enriquecidos + b.enriquecidos,
    jaExistentes: a.jaExistentes + b.jaExistentes,
    invalidos: a.invalidos + b.invalidos,
    aguardandoInformacao: a.aguardandoInformacao + b.aguardandoInformacao,
    duplicatasExatas: a.duplicatasExatas + b.duplicatasExatas,
    conflitos: a.conflitos + b.conflitos,
    jaAbordados: a.jaAbordados + b.jaAbordados,
    optOut: a.optOut + b.optOut,
    linhas: [...a.linhas, ...b.linhas],
  };
}

interface ImportacaoAnterior {
  id: string;
  arquivoNome: string;
  iniciadaEm: string;
  situacao: string;
  linhasTotais: number;
  linhasAceitas: number;
  criadoPorNome: string | null;
}

/** SHA-256 do conteúdo, calculado no navegador. `null` sem `crypto.subtle` (http simples) — perder o aviso de repetida é aceitável; perder a importação, não. */
async function hashDoArquivo(f: File): Promise<string | null> {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return null;
    const digest = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

export function ImportarContatos({ aoImportar }: { aoImportar: () => void }) {
  const [arquivos, setArquivos] = useState<ArquivoLido[]>([]);
  const [procedencia, setProcedencia] = useState("");
  const [canalDeObtencao, setCanalDeObtencao] = useState("");
  const [nomeDoLote, setNomeDoLote] = useState("");
  const [maisDetalhes, setMaisDetalhes] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [progresso, setProgresso] = useState<{ parte: number; de: number } | null>(null);
  const [resumo, setResumo] = useState<ResumoDaClassificacao | null>(null);
  const [relatorioAberto, setRelatorioAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [repetida, setRepetida] = useState<ImportacaoAnterior | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  const resultadosPorArquivo = useMemo(() => arquivos.map(linhasDoArquivo), [arquivos]);
  const total = resultadosPorArquivo.reduce((n, r) => n + r.linhas.length, 0);
  const descartadas = resultadosPorArquivo.reduce((n, r) => n + r.descartadas, 0);
  /** Reconhecimento automático falhou de verdade — é AQUI que o mapeamento manual reaparece. */
  const faltaMapearWhatsapp =
    arquivos.length > 0 &&
    arquivos.some((a) => !a.erro && !Object.values(a.mapeamento).some((c) => c === "whatsapp"));

  const lerArquivo = useCallback(async (f: File): Promise<ArquivoLido> => {
    const base = {
      nome: f.name,
      tipo: f.type || null,
      bytes: f.size,
      hash: await hashDoArquivo(f),
      grade: { titulos: [], linhas: [], separador: "," } as GradeBruta,
      temCabecalho: false,
      mapeamento: {} as Record<number, CampoConhecido | null>,
      sugestaoAutomatica: {} as Record<number, CampoConhecido | null>,
    };
    try {
      const ehExcel = /\.(xlsx|xlsm|xls)$/i.test(f.name);
      let texto: string;
      if (ehExcel) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
        const primeira = wb.SheetNames[0];
        if (!primeira) return { ...base, erro: "planilha sem nenhuma aba" };
        texto = XLSX.utils.sheet_to_csv(wb.Sheets[primeira]!);
      } else {
        texto = await f.text();
      }

      const sugestao = lerPlanilha(texto);
      const grade = lerGradeBruta(texto);
      if (grade.titulos.length === 0) return { ...base, erro: "não achei nenhuma linha" };

      const mapaSugerido: Record<number, CampoConhecido | null> = {};
      sugestao.colunas.forEach((c, i) => {
        mapaSugerido[i] = c.campo;
      });

      return {
        ...base,
        grade,
        temCabecalho: sugestao.temCabecalho,
        mapeamento: mapaSugerido,
        sugestaoAutomatica: mapaSugerido,
        erro: sugestao.linhas.length === 0 ? "não achei nenhuma linha com telefone" : null,
      };
    } catch (e) {
      return { ...base, erro: e instanceof Error ? e.message : "não consegui ler este arquivo" };
    }
  }, []);

  const alterarMapeamento = useCallback((indiceArquivo: number, indiceColuna: number, valor: string) => {
    setArquivos((atuais) =>
      atuais.map((a, i) =>
        i !== indiceArquivo
          ? a
          : { ...a, mapeamento: { ...a.mapeamento, [indiceColuna]: (valor || null) as CampoConhecido | null } },
      ),
    );
  }, []);

  const receber = useCallback(
    async (lista: FileList | File[]) => {
      setErro(null);
      setResumo(null);
      setRepetida(null);
      const lidos = await Promise.all(Array.from(lista).map(lerArquivo));
      setArquivos((atuais) => [...atuais, ...lidos]);
    },
    [lerArquivo],
  );

  const colar = useCallback((texto: string) => {
    if (!texto.trim()) return;
    setResumo(null);
    setRepetida(null);
    const sugestao = lerPlanilha(texto);
    const grade = lerGradeBruta(texto);
    const mapaSugerido: Record<number, CampoConhecido | null> = {};
    sugestao.colunas.forEach((c, i) => {
      mapaSugerido[i] = c.campo;
    });
    setArquivos((a) => [
      ...a,
      {
        nome: "texto colado",
        tipo: "text/plain",
        bytes: texto.length,
        hash: null,
        grade,
        temCabecalho: sugestao.temCabecalho,
        mapeamento: mapaSugerido,
        sugestaoAutomatica: mapaSugerido,
        erro: sugestao.linhas.length === 0 ? "não achei nenhuma linha com telefone" : null,
      },
    ]);
  }, []);

  /**
   * Sobe o arquivo inteiro: abre a importação, manda as partes por
   * `importarClassificado`, conclui. Mesmo esqueleto de três passos que
   * `ReceberLista.tsx` já usava — só a ação do meio mudou.
   */
  async function importar(confirmandoRepetida = false) {
    if (!procedencia.trim()) {
      setErro("Escreva de onde veio esta lista. Sem isso o servidor recusa, e com razão.");
      return;
    }
    if (faltaMapearWhatsapp) {
      setErro("Nenhuma coluna está mapeada como WhatsApp em pelo menos um arquivo. Escolha a coluna certa antes de subir.");
      return;
    }
    if (total === 0) {
      setErro("Nenhuma linha com telefone para importar, mesmo com o mapeamento atual.");
      return;
    }

    setOcupado(true);
    setErro(null);
    setResumo(null);
    if (!confirmandoRepetida) setRepetida(null);

    const todas = resultadosPorArquivo.flatMap((r) => r.linhas);
    const partes: LinhaLida[][] = [];
    for (let i = 0; i < todas.length; i += POR_LOTE) partes.push(todas.slice(i, i + POR_LOTE));

    const unico = arquivos.length === 1 ? arquivos[0]! : null;
    const nomeDaLista =
      nomeDoLote.trim() || (unico ? unico.nome : `Lista de ${new Date().toLocaleDateString("pt-BR")}`);

    let importacaoId: string | null = null;
    let acumulado = resumoVazio();

    try {
      const abertura = await fetch(ROTA, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acao: "abrirImportacao",
          arquivoNome: nomeDaLista,
          arquivoTipo: unico?.tipo ?? null,
          arquivoHash: unico?.hash ?? null,
          arquivoBytes: unico?.bytes ?? null,
          linhasTotais: total,
          proveniencia: procedencia.trim(),
          canalDeObtencao: canalDeObtencao.trim() || null,
          ...(confirmandoRepetida ? { confirmarRepetido: true } : {}),
        }),
      });

      const jsonAbertura = (await abertura.json().catch(() => null)) as {
        error?: string;
        data?: { importacaoId?: string; anterior?: ImportacaoAnterior | null };
      } | null;

      if (abertura.status === 409 && jsonAbertura?.data?.anterior) {
        setRepetida(jsonAbertura.data.anterior);
        setErro(jsonAbertura.error ?? null);
        return;
      }
      if (!abertura.ok || !jsonAbertura?.data?.importacaoId) {
        setErro(jsonAbertura?.error ?? `Não consegui abrir a importação (${abertura.status}).`);
        return;
      }
      importacaoId = jsonAbertura.data.importacaoId;

      for (let i = 0; i < partes.length; i++) {
        setProgresso({ parte: i + 1, de: partes.length });

        const res = await fetch(ROTA, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            acao: "importarClassificado",
            importacaoId,
            nome: nomeDaLista + (partes.length > 1 ? ` (parte ${i + 1}/${partes.length})` : ""),
            proveniencia: procedencia.trim(),
            linhas: partes[i],
            // ⚠️ NÃO manda `arquivoHash` aqui. `abrirImportacao` (chamado
            // acima, antes deste laço) já respondeu "esta planilha já subiu
            // antes?" pelo MESMO hash — é o que devolve 409 e pede
            // `confirmarRepetido`. Se este hash for repassado agora, a
            // classificação encontra o registro que `abrirImportacao` acabou
            // de criar PARA ESTA MESMA SUBIDA (`arquivoJaImportado` não
            // distingue "meu próprio registro, criado há 2 segundos" de "um
            // arquivo diferente, subido antes") e marca cada linha como
            // DUPLICATA_EXATA — o próprio arquivo colidindo consigo mesmo.
            // Medido no teste de aceite desta tela: 2 linhas novas viraram
            // "2 já existentes" só por causa deste campo. `arquivoNome`
            // continua indo — só rotula o `ConflitoDeImportacao`, sem
            // reconsultar hash nenhum.
            arquivoNome: nomeDaLista,
          }),
        });

        const json = (await res.json().catch(() => null)) as
          | { error?: string; data?: { resumo: ResumoDaClassificacao } }
          | null;

        if (!res.ok || !json?.data) {
          setErro(
            `${json?.error ?? `O servidor recusou (${res.status}).`}` +
              (i > 0 ? ` — as ${i} primeiras partes já entraram, e continuam valendo.` : ""),
          );
          return;
        }

        acumulado = somarResumo(acumulado, json.data.resumo);
      }

      const fim = await fetch(ROTA, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "concluirImportacao", importacaoId }),
      });
      if (!fim.ok) {
        const j = (await fim.json().catch(() => null)) as { error?: string } | null;
        setErro(
          `Os contatos entraram, mas não consegui fechar o registro da importação` +
            `${j?.error ? `: ${j.error}` : "."}`,
        );
      }

      setResumo(acumulado);
      setArquivos([]);
      setNomeDoLote("");
      setRepetida(null);
      aoImportar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui subir a lista.");
    } finally {
      setOcupado(false);
      setProgresso(null);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-paper p-4">
      <h2 className="text-[16px] font-semibold text-ink">Importar contatos</h2>
      <p className="mt-0.5 max-w-[70ch] text-[12.5px] leading-relaxed text-muted">
        Uma lista nova, uma lista antiga com dado novo, ou as duas coisas misturadas — suba o
        arquivo. O sistema decide sozinho o que é novo, o que já existe e o que só ganhou um dado
        que faltava.
      </p>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) void receber(e.dataTransfer.files);
        }}
        className="mt-3 rounded-xl border border-dashed border-line2 bg-canvas p-6 text-center"
      >
        <p className="text-[13px] text-ink2">Arraste um ou mais arquivos aqui</p>
        <button
          type="button"
          onClick={() => entrada.current?.click()}
          className="mt-2 rounded-xl bg-brand-500 px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-600"
        >
          Escolher arquivos
        </button>
        <input
          ref={entrada}
          type="file"
          multiple
          accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void receber(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="mt-2 text-[11.5px] text-muted">Excel ou CSV · ou cole a lista abaixo</p>
        <textarea
          rows={2}
          placeholder="nome, whatsapp, cidade…"
          onPaste={(e) => {
            const t = e.clipboardData.getData("text");
            if (t.trim()) {
              e.preventDefault();
              colar(t);
            }
          }}
          className="mt-1.5 w-full resize-none rounded-xl border border-line2 bg-paper px-3 py-2 text-[12.5px] text-ink outline-none focus:border-brand-400"
        />
      </div>

      {arquivos.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {arquivos.map((a, i) => {
            const { linhas, descartadas: descartadasDoArquivo } = resultadosPorArquivo[i]!;
            const semWhatsappMapeado = !a.erro && !Object.values(a.mapeamento).some((c) => c === "whatsapp");

            return (
              <div key={`${a.nome}-${i}`} className="rounded-xl border border-line bg-canvas p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13px] font-semibold text-ink">{a.nome}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setResumo(null);
                      setRepetida(null);
                      setArquivos((x) => x.filter((_, j) => j !== i));
                    }}
                    className="text-[11.5px] font-semibold text-muted underline underline-offset-2"
                  >
                    tirar
                  </button>
                </div>

                {a.erro ? (
                  <p className="mt-1 text-[12.5px] text-red-700">{a.erro}</p>
                ) : semWhatsappMapeado ? (
                  // ⭐ Reconhecimento automático falhou de verdade — só AQUI o
                  // mapeamento manual aparece (mapeamentoManual.ts, reaproveitado).
                  <div className="mt-1.5">
                    <p className="text-[11.5px] font-semibold text-amber-700">
                      Não reconheci a coluna de WhatsApp automaticamente — escolha abaixo.
                    </p>
                    <div className="mt-1.5 flex flex-col gap-1">
                      {a.grade.titulos.map((titulo, j) => (
                        <label key={j} className="flex items-center gap-2 text-[11.5px]">
                          <span className="w-32 shrink-0 truncate text-muted" title={titulo}>
                            {titulo}
                          </span>
                          <span className="shrink-0 text-muted">→</span>
                          <select
                            value={a.mapeamento[j] ?? ""}
                            onChange={(e) => alterarMapeamento(i, j, e.target.value)}
                            className="flex-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11.5px] text-ink"
                          >
                            <option value="">Ignorar esta coluna</option>
                            {(Object.entries(ROTULO_DO_CAMPO) as [CampoConhecido, string][]).map(
                              ([campo, rotulo]) => (
                                <option key={campo} value={campo}>
                                  {rotulo}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-0.5 text-[12.5px] text-ink2">
                    {linhas.length} contatos reconhecidos automaticamente
                    {descartadasDoArquivo > 0 && (
                      <span className="text-amber-700"> · {descartadasDoArquivo} sem telefone ficaram de fora</span>
                    )}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {repetida && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-[13px] font-semibold text-amber-900">Esta mesma planilha já subiu.</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-amber-900">
            &quot;{repetida.arquivoNome}&quot; · {new Date(repetida.iniciadaEm).toLocaleString("pt-BR")}
            {repetida.criadoPorNome ? ` · por ${repetida.criadoPorNome}` : ""} · {repetida.linhasAceitas} de{" "}
            {repetida.linhasTotais} linhas entraram.
          </p>
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void importar(true)}
            className="mt-2 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-amber-900 disabled:opacity-50"
          >
            Subir mesmo assim
          </button>
        </div>
      )}

      <label className="mt-3 block">
        <span className="block text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">
          De onde veio esta lista *
        </span>
        <input
          value={procedencia}
          onChange={(e) => setProcedencia(e.target.value)}
          placeholder="Ex.: lista pública de restaurantes de SP, baixada em 07/09/2026"
          className="mt-0.5 w-full rounded-xl border border-line2 bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-brand-400"
        />
      </label>

      <button
        type="button"
        onClick={() => setMaisDetalhes((v) => !v)}
        className="mt-2 text-[11.5px] font-semibold text-muted underline underline-offset-2"
      >
        {maisDetalhes ? "menos detalhes" : "mais detalhes (opcional)"}
      </button>

      {maisDetalhes && (
        <div className="mt-2 flex flex-col gap-2">
          <label className="block">
            <span className="block text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">
              Como a lista foi obtida
            </span>
            <input
              value={canalDeObtencao}
              onChange={(e) => setCanalDeObtencao(e.target.value)}
              placeholder="Ex.: busca no Google Maps · feira do setor · indicação de parceiro"
              className="mt-0.5 w-full rounded-xl border border-line2 bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-brand-400"
            />
          </label>
          <label className="block">
            <span className="block text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">
              Nome da lista
            </span>
            <input
              value={nomeDoLote}
              onChange={(e) => setNomeDoLote(e.target.value)}
              placeholder="Ex.: Pizzarias zona sul"
              className="mt-0.5 w-full rounded-xl border border-line2 bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-brand-400"
            />
          </label>
        </div>
      )}

      {total > POR_LOTE && (
        <p className="mt-2 text-[12px] text-ink2">
          {total} contatos entram em {Math.ceil(total / POR_LOTE)} partes de até {POR_LOTE} — limite
          técnico do servidor, com um histórico só.
        </p>
      )}

      <button
        onClick={() => void importar()}
        disabled={ocupado || total === 0 || faltaMapearWhatsapp}
        className="mt-3 w-full rounded-xl bg-brand-500 px-4 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-40"
      >
        {ocupado
          ? progresso
            ? `Subindo parte ${progresso.parte} de ${progresso.de}…`
            : "Subindo…"
          : faltaMapearWhatsapp
            ? "Mapeie o WhatsApp para subir"
            : total > 0
              ? `Subir ${total} contatos`
              : "Escolha um arquivo"}
      </button>

      {erro && (
        <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-[12.5px] text-red-800">
          {erro}
        </p>
      )}

      {resumo && (
        <div role="status" className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3">
          <p className="text-[13.5px] font-semibold text-green-900">
            {resumo.analisadas.toLocaleString("pt-BR")} linhas analisadas:
          </p>
          <ul className="mt-1.5 space-y-0.5 text-[13px] text-green-900">
            <li>{resumo.novos.toLocaleString("pt-BR")} contatos novos</li>
            <li>{resumo.enriquecidos.toLocaleString("pt-BR")} contatos enriquecidos</li>
            <li>{resumo.jaExistentes.toLocaleString("pt-BR")} já existentes</li>
            <li>{resumo.invalidos.toLocaleString("pt-BR")} inválidos</li>
            <li>{resumo.aguardandoInformacao.toLocaleString("pt-BR")} aguardando informação</li>
          </ul>

          <button
            type="button"
            onClick={() => setRelatorioAberto((v) => !v)}
            className="mt-2 text-[11.5px] font-semibold text-green-900 underline underline-offset-2"
          >
            {relatorioAberto ? "recolher relatório" : "Ver relatório"}
          </button>

          {relatorioAberto && (
            <div className="mt-2 space-y-2 border-t border-green-200 pt-2 text-[12px] text-green-900">
              <ul className="space-y-0.5">
                <li>Duplicatas exatas (mesmo telefone, mesmo arquivo ou já subido): {resumo.duplicatasExatas}</li>
                <li>Conflitos de dado (campo já preenchido com valor diferente): {resumo.conflitos}</li>
                <li>Já abordados antes: {resumo.jaAbordados}</li>
                <li>Pediram silêncio (opt-out): {resumo.optOut}</li>
                {descartadas > 0 && <li>Sem telefone reconhecível, não enviadas: {descartadas}</li>}
              </ul>
              {resumo.conflitos > 0 && (
                <div>
                  <p className="font-semibold">Primeiros conflitos:</p>
                  <ul className="mt-0.5 max-h-40 space-y-0.5 overflow-y-auto">
                    {resumo.linhas
                      .filter((l) => l.classificacao === "CONFLITO")
                      .slice(0, 20)
                      .map((l) => (
                        <li key={l.indice}>
                          Linha {l.indice + 1}:{" "}
                          {l.camposEmConflito.map((c) => `${c.campo} (tínhamos "${c.valorAtual}", vieram "${c.valorNovo}")`).join(", ")}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              <p className="text-green-800">
                Auditoria completa por arquivo: aba <span className="font-semibold">Importações</span>. Todos os
                contatos, com filtro por situação: <span className="font-semibold">Base fria</span>.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
