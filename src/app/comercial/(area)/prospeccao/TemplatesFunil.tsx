"use client";

/**
 * TEMPLATES — os cinco modelos, lado a lado, com o funil de cada um.
 * Redesenho da prospecção automática e minimalista, 12/09/2026 (item 3 do
 * pedido do CEO). Espelha `FunilDoModelo` (`funilDoModelo.ts`) e
 * `ModeloSincronizado` (`sincronizarModelos.ts`) — lidos juntos por
 * `?recorte=funil` — sem inventar métrica nova: tudo aqui já é o que
 * `LeadMensagem`/`SiteLead` gravam.
 *
 * Expansível e fora dos três blocos principais, como o pedido permite: o CEO
 * decide ligar/pausar/importar sem nunca precisar abrir isto — quem quiser
 * comparar os modelos clica para abrir.
 */

import { useState } from "react";

export interface FunilDoModelo {
  templateNome: string;
  tentativas: number;
  enviados: number;
  entregues: number;
  lidos: number;
  falharam: number;
  respondidos: number;
  comRespostaPositiva: number;
  optOut: number;
}

export interface ModeloSincronizado {
  nome: string;
  idioma: string;
  situacao: string;
  autorizado: boolean;
}

interface Props {
  funil: FunilDoModelo[] | null;
  modelos: ModeloSincronizado[] | null;
}

function Metrica({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div>
      <p className="text-[10.5px] uppercase text-muted">{rotulo}</p>
      <p className="text-[14px] font-semibold text-ink tabular-nums">{valor}</p>
    </div>
  );
}

export function TemplatesFunil({ funil, modelos }: Props) {
  const [aberto, setAberto] = useState(false);

  const situacaoDoModelo = new Map(modelos?.map((m) => [m.nome, m]) ?? []);

  return (
    <section className="rounded-2xl border border-line bg-paper p-4">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <h2 className="text-[15px] font-semibold text-ink">
          Modelos de abordagem
          {funil && funil.length > 0 && (
            <span className="ml-1.5 font-normal text-muted">({funil.length})</span>
          )}
        </h2>
        <span className="shrink-0 text-[12px] text-muted">{aberto ? "recolher ▲" : "ver ▼"}</span>
      </button>

      {aberto && (
        <div className="mt-3 border-t border-line pt-3">
          {!funil || funil.length === 0 ? (
            <p className="text-[12.5px] text-muted">
              Nenhum envio registrado ainda por nenhum modelo — os números aparecem aqui depois da
              primeira rodada.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {funil.map((f) => {
                const modelo = situacaoDoModelo.get(f.templateNome);
                return (
                  <div key={f.templateNome} className="rounded-xl border border-line bg-canvas p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[13px] font-semibold text-ink">{f.templateNome}</span>
                      {modelo && (
                        <span
                          className={`text-[11px] font-semibold ${
                            modelo.situacao === "APPROVED" && modelo.autorizado ? "text-ink2" : "text-amber-700"
                          }`}
                        >
                          {modelo.situacao === "APPROVED"
                            ? modelo.autorizado
                              ? "aprovado e autorizado"
                              : "aprovado, não autorizado"
                            : modelo.situacao.toLowerCase()}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <Metrica rotulo="Enviado" valor={f.enviados} />
                      <Metrica rotulo="Entregue" valor={f.entregues} />
                      <Metrica rotulo="Lido" valor={f.lidos} />
                      <Metrica rotulo="Respondido" valor={f.respondidos} />
                      <Metrica rotulo="Resp. positiva" valor={f.comRespostaPositiva} />
                      <Metrica rotulo="Opt-out" valor={f.optOut} />
                      <Metrica rotulo="Falhou" valor={f.falharam} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
