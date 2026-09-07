"use client";

/**
 * A RECEPÇÃO DE LISTAS — por onde um arquivo de contatos entra na casa.
 *
 * ── O BURACO, ATÉ 07/09/2026 ────────────────────────────────────────────────
 *
 * A porta de importação existia no servidor desde sempre e **nunca foi usada**:
 * ela só aceitava um JSON montado à mão. O CEO tinha listas e não tinha onde
 * pôr. Uma porta sem maçaneta é uma porta fechada.
 *
 * ── AS TRÊS COISAS QUE ESTA TELA SE RECUSA A FAZER ─────────────────────────
 *
 * 1. **Importar sem mostrar o que entendeu.** Coluna trocada não quebra nada e
 *    não acusa erro — só faz a Foocci mandar "Olá 5511988887777" para o dono de
 *    um restaurante. Por isso o mapa de colunas aparece ANTES do botão, e o
 *    botão fica embaixo dele.
 * 2. **Esconder o que foi descartado.** Linha sem telefone é contada e dita. O
 *    silêncio aqui é o que faz alguém achar que subiu 900 e ter subido 300.
 * 3. **Aceitar lista sem dizer de onde veio.** O campo de procedência é
 *    obrigatório nesta tela porque é obrigatório no servidor — e é melhor a
 *    pessoa saber disso antes de escolher o arquivo do que depois de esperar
 *    a subida.
 *
 * ── ⚠️ E ELA NÃO ABORDA NINGUÉM ─────────────────────────────────────────────
 *
 * Subir a lista **não** libera a lista. O lote entra como RASCUNHO e continua
 * precisando da liberação explícita, que é outro botão, com outro dono.
 */

import { useCallback, useRef, useState } from "react";
import { lerPlanilha, type LinhaLida, type ColunaLida } from "@/services/salaDeVendas/prospeccao/lerPlanilha";

const ROTA = "/api/admin/sala-de-vendas/prospeccao";

/** O servidor recusa acima disto. A tela quebra em partes em vez de falhar. */
const POR_LOTE = 500;

interface ArquivoLido {
  nome: string;
  linhas: LinhaLida[];
  colunas: ColunaLida[];
  descartadas: number;
  erro: string | null;
}

/** O que o servidor responde a "quantos destes já temos?". */
interface Conferencia {
  recebidas: number;
  novas: number;
  jaEramLead: number;
  repetidasEmOutroLote: number;
  repetidasNoArquivo: number;
  invalidas: number;
}

const ROTULO_CAMPO: Record<string, string> = {
  nome: "Nome da pessoa",
  whatsapp: "WhatsApp",
  empresa: "Restaurante",
  cidade: "Cidade",
  estado: "Estado",
  tipo: "Tipo",
};

export function ReceberLista({ aoImportar }: { aoImportar: () => void }) {
  const [arquivos, setArquivos] = useState<ArquivoLido[]>([]);
  const [procedencia, setProcedencia] = useState("");
  const [nomeDoLote, setNomeDoLote] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [conferencia, setConferencia] = useState<Conferencia | null>(null);
  const [conferindo, setConferindo] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const total = arquivos.reduce((n, a) => n + a.linhas.length, 0);
  const descartadas = arquivos.reduce((n, a) => n + a.descartadas, 0);

  /**
   * Lê um arquivo. Excel vira CSV pela biblioteca que a casa já tem, e daí em
   * diante segue o mesmo caminho do texto colado — um leitor só, testado uma
   * vez, em vez de dois que divergem.
   */
  const lerArquivo = useCallback(async (f: File): Promise<ArquivoLido> => {
    const base = { nome: f.name, linhas: [], colunas: [], descartadas: 0 };
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

      const r = lerPlanilha(texto);
      return {
        nome: f.name,
        linhas: r.linhas,
        colunas: r.colunas,
        descartadas: r.descartadas,
        erro: r.linhas.length === 0 ? "não achei nenhuma linha com telefone" : null,
      };
    } catch (e) {
      return { ...base, erro: e instanceof Error ? e.message : "não consegui ler este arquivo" };
    }
  }, []);

  const receber = useCallback(
    async (lista: FileList | File[]) => {
      setErro(null);
      setResultado(null);
      // A conferência anterior deixa de valer no instante em que a lista muda.
      // Número velho ao lado de arquivo novo é pior que número nenhum.
      setConferencia(null);
      const lidos = await Promise.all(Array.from(lista).map(lerArquivo));
      // Acumula: quem tem cinco arquivos escolhe cinco vezes sem perder os
      // anteriores. Substituir a cada escolha seria uma armadilha silenciosa.
      setArquivos((atuais) => [...atuais, ...lidos]);
    },
    [lerArquivo],
  );

  const colar = useCallback((texto: string) => {
    if (!texto.trim()) return;
    setConferencia(null);
    const r = lerPlanilha(texto);
    setArquivos((a) => [
      ...a,
      {
        nome: "texto colado",
        linhas: r.linhas,
        colunas: r.colunas,
        descartadas: r.descartadas,
        erro: r.linhas.length === 0 ? "não achei nenhuma linha com telefone" : null,
      },
    ]);
  }, []);

  /**
   * ⭐ "Destes, quantos já temos?" — respondido ANTES de subir.
   *
   * Pedido do CEO: *"quando um arquivo chegar, fale: esses cinquenta já estão,
   * esses vinte são novos."* Roda no servidor, com a MESMA função que a
   * importação usa depois — por isso o número da conferência e o do resultado
   * não podem discordar.
   *
   * ⚠️ Confere só a primeira parte quando a lista passa de 500. Dizer "conferi
   * 500 de 3.000" é honesto; conferir tudo antes de o operador decidir se vai
   * subir seria caro e ele nem pediu.
   */
  async function conferir() {
    setConferindo(true);
    setErro(null);
    try {
      const amostra = arquivos.flatMap((a) => a.linhas).slice(0, POR_LOTE);
      const res = await fetch(ROTA, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "conferir", linhas: amostra }),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: string;
        data?: Conferencia;
      } | null;

      if (!res.ok || !json?.data) {
        setErro(json?.error ?? `Não consegui conferir (${res.status}).`);
        return;
      }
      setConferencia(json.data);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui conferir.");
    } finally {
      setConferindo(false);
    }
  }

  async function importar() {
    if (!procedencia.trim()) {
      setErro("Escreva de onde veio esta lista. Sem isso o servidor recusa, e com razão.");
      return;
    }
    if (total === 0) {
      setErro("Nenhuma linha com telefone para importar.");
      return;
    }

    setOcupado(true);
    setErro(null);
    setResultado(null);

    const todas = arquivos.flatMap((a) => a.linhas);
    const partes: LinhaLida[][] = [];
    for (let i = 0; i < todas.length; i += POR_LOTE) partes.push(todas.slice(i, i + POR_LOTE));

    let aceitas = 0;
    let repetidas = 0;
    let invalidas = 0;

    try {
      for (let i = 0; i < partes.length; i++) {
        const res = await fetch(ROTA, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            acao: "importar",
            nome:
              (nomeDoLote.trim() || `Lista de ${new Date().toLocaleDateString("pt-BR")}`) +
              (partes.length > 1 ? ` (parte ${i + 1}/${partes.length})` : ""),
            proveniencia: procedencia.trim(),
            linhas: partes[i],
          }),
        });

        const json = (await res.json().catch(() => null)) as {
          error?: string;
          data?: { aceitas: number; repetidasNoArquivo: number; repetidasEmOutroLote: number; invalidas: number };
        } | null;

        if (!res.ok || !json?.data) {
          // Para na primeira recusa e diz quantas partes já entraram. Continuar
          // depois de um erro deixaria o operador sem saber o que subiu.
          setErro(
            `${json?.error ?? `O servidor recusou (${res.status}).`}` +
              (i > 0 ? ` — as ${i} primeiras partes já entraram.` : ""),
          );
          return;
        }

        aceitas += json.data.aceitas;
        repetidas += json.data.repetidasNoArquivo + json.data.repetidasEmOutroLote;
        invalidas += json.data.invalidas;
      }

      setResultado(
        `${aceitas} contatos entraram` +
          (repetidas ? ` · ${repetidas} já estavam na base` : "") +
          (invalidas ? ` · ${invalidas} com telefone inválido` : "") +
          (descartadas ? ` · ${descartadas} linhas sem telefone foram deixadas de fora` : "") +
          ". O lote entra como rascunho — ninguém é abordado até você liberar.",
      );
      setArquivos([]);
      setNomeDoLote("");
      setConferencia(null);
      aoImportar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui subir a lista.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="mb-4 rounded-2xl border border-line bg-paper p-4">
      <h2 className="text-[15px] font-semibold text-ink">Receber lista de contatos</h2>
      <p className="mt-0.5 max-w-[70ch] text-[12.5px] leading-relaxed text-muted">
        Excel ou CSV, vários arquivos de uma vez. A tela mostra o que entendeu de cada
        coluna <strong>antes</strong> de subir — e subir não aborda ninguém: o lote
        entra como rascunho.
      </p>

      {/* ── Escolher arquivos ── */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) void receber(e.dataTransfer.files);
        }}
        className="mt-3 rounded-xl border border-dashed border-line2 bg-canvas p-4 text-center"
      >
        <p className="text-[13px] text-ink2">Arraste os arquivos aqui</p>
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
        <p className="mt-2 text-[11.5px] text-muted">ou cole a lista no campo abaixo</p>
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

      {/* ── O que a tela entendeu ── */}
      {arquivos.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {arquivos.map((a, i) => (
            <div key={`${a.nome}-${i}`} className="rounded-xl border border-line bg-canvas p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[13px] font-semibold text-ink">{a.nome}</span>
                <button
                  type="button"
                  onClick={() => {
                    setConferencia(null);
                    setArquivos((x) => x.filter((_, j) => j !== i));
                  }}
                  className="text-[11.5px] font-semibold text-muted underline underline-offset-2"
                >
                  tirar
                </button>
              </div>

              {a.erro ? (
                <p className="mt-1 text-[12.5px] text-red-700">{a.erro}</p>
              ) : (
                <>
                  <p className="mt-0.5 text-[12.5px] text-ink2">
                    {a.linhas.length} contatos
                    {a.descartadas > 0 && (
                      <span className="text-amber-700">
                        {" "}· {a.descartadas} linhas sem telefone ficaram de fora
                      </span>
                    )}
                  </p>

                  {/* O mapa de colunas. É a parte que impede o erro silencioso. */}
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {a.colunas.map((c, j) => (
                      <li
                        key={j}
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${
                          c.campo
                            ? "border-line2 bg-paper text-ink2"
                            : "border-line2 bg-chip text-muted line-through"
                        }`}
                      >
                        {c.titulo}
                        {c.campo && ` → ${ROTULO_CAMPO[c.campo] ?? c.campo}`}
                        {c.porque === "conteudo" && " (palpite)"}
                      </li>
                    ))}
                  </ul>

                  {a.colunas.some((c) => c.porque === "conteudo") && (
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-amber-800">
                      Este arquivo não tem cabeçalho, então eu adivinhei as colunas pelo
                      conteúdo. Confira a primeira linha antes de subir.
                    </p>
                  )}

                  {a.linhas[0] && (
                    <p className="mt-1 truncate text-[11.5px] text-muted">
                      1º: {a.linhas[0].nome ?? "(sem nome)"} · {a.linhas[0].whatsapp}
                      {a.linhas[0].empresa ? ` · ${a.linhas[0].empresa}` : ""}
                    </p>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── De onde veio, e o nome do lote ── */}
      {/* ── "Destes, quantos já temos?" ────────────────────────────────────
          Antes de subir, e sem gravar nada. É a pergunta que o CEO faz ao
          receber um arquivo, e a resposta vem do MESMO cálculo que a
          importação usa depois. */}
      {total > 0 && (
        <div className="mt-3 rounded-xl border border-line bg-canvas p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-ink">
              Quantos destes já temos?
            </span>
            <button
              type="button"
              onClick={() => void conferir()}
              disabled={conferindo}
              className="rounded-lg border border-line2 bg-paper px-3 py-1.5 text-[12.5px] font-semibold text-ink2 transition-colors hover:border-brand-400 disabled:opacity-50"
            >
              {conferindo ? "Conferindo…" : conferencia ? "Conferir de novo" : "Conferir"}
            </button>
          </div>

          {conferencia ? (
            <>
              <ul className="mt-2 flex flex-col gap-0.5 text-[12.5px]">
                <li className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-ink">São novos</span>
                  <span className="font-semibold tabular-nums text-ink">{conferencia.novas}</span>
                </li>
                <li className="flex items-baseline justify-between gap-2 text-ink2">
                  <span>Já estão na base como lead</span>
                  <span className="tabular-nums">{conferencia.jaEramLead}</span>
                </li>
                <li className="flex items-baseline justify-between gap-2 text-ink2">
                  <span>Já esperando em outro lote</span>
                  <span className="tabular-nums">{conferencia.repetidasEmOutroLote}</span>
                </li>
                <li className="flex items-baseline justify-between gap-2 text-ink2">
                  <span>Repetidos dentro do próprio arquivo</span>
                  <span className="tabular-nums">{conferencia.repetidasNoArquivo}</span>
                </li>
                <li className="flex items-baseline justify-between gap-2 text-ink2">
                  <span>Telefone inválido</span>
                  <span className="tabular-nums">{conferencia.invalidas}</span>
                </li>
              </ul>

              <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
                Os repetidos entram marcados, e não viram abordagem — ninguém recebe
                duas vezes.
                {total > POR_LOTE &&
                  ` Conferi as primeiras ${POR_LOTE} de ${total}; o resto é conferido na hora de subir.`}
              </p>
            </>
          ) : (
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              O sistema compara pelos últimos oito dígitos do telefone, então pega
              contato gravado em formato antigo. Nada é gravado nesta conferência.
            </p>
          )}
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
        <span className="mt-1 block text-[11.5px] leading-relaxed text-muted">
          Obrigatório. É a resposta para &quot;por que temos o telefone desta pessoa?&quot;
          no dia em que alguém perguntar. Precisa ser verdadeiro, não bonito.
        </span>
      </label>

      <label className="mt-2 block">
        <span className="block text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">
          Nome do lote (opcional)
        </span>
        <input
          value={nomeDoLote}
          onChange={(e) => setNomeDoLote(e.target.value)}
          placeholder="Ex.: Pizzarias zona sul"
          className="mt-0.5 w-full rounded-xl border border-line2 bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-brand-400"
        />
      </label>

      {total > POR_LOTE && (
        <p className="mt-2 text-[12px] text-ink2">
          {total} contatos entram em {Math.ceil(total / POR_LOTE)} partes de até {POR_LOTE} —
          é o teto de segurança do servidor, e a tela cuida disso sozinha.
        </p>
      )}

      <button
        onClick={() => void importar()}
        disabled={ocupado || total === 0}
        className="mt-3 w-full rounded-xl bg-brand-500 px-4 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-40"
      >
        {ocupado ? "Subindo…" : total > 0 ? `Subir ${total} contatos` : "Escolha um arquivo"}
      </button>

      {erro && (
        <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-[12.5px] text-red-800">
          {erro}
        </p>
      )}
      {resultado && (
        <p role="status" className="mt-2 rounded-xl bg-green-50 px-3 py-2 text-[12.5px] text-green-900">
          {resultado}
        </p>
      )}
    </section>
  );
}
