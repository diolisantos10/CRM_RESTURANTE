"use client";

/**
 * A SALA DE VENDAS.
 *
 * Sete filas à esquerda, a lista à direita. Cada fila responde a uma pergunta
 * que o SDR faz de verdade durante o dia — a pergunta aparece na tela, porque
 * filtro sem pergunta é filtro que ninguém sabe para que serve.
 *
 * ── O QUE ESTA TELA NÃO FAZ, E POR QUÊ ──
 *
 * Não envia mensagem. O canal de WhatsApp de vendas existe no código mas está
 * desligado, e um botão "responder" que não responde é controle que mente — o
 * pior defeito desta casa não é feiura, é o controle que finge.
 *
 * O que ela faz é o que sustenta tudo: mostrar de quem é cada lead agora, e
 * deixar assumir e devolver sem perder contexto.
 */

import { useState } from "react";
import { useSalaDeVendas, mudarResponsavel, desdeQuando } from "./_dados";
import { ROTAS, ENTRADA } from "@/lib/sala/rotas";
import type { LeadNaFila, NomeDaFila } from "@/services/salaDeVendas/filas";

function cx(...p: Array<string | false | null | undefined>): string {
  return p.filter(Boolean).join(" ");
}

export function SalaDeVendasClient() {
  const [fila, setFila] = useState<NomeDaFila>("aguardandoHumano");
  const [aviso, setAviso] = useState<string | null>(null);
  const { estado, recarregar } = useSalaDeVendas(fila);

  async function agir(
    acao: "assumir" | "devolver" | "pedirHumano",
    leadId: string,
    extra?: { objetivo?: string; motivo?: string },
  ) {
    const r = await mudarResponsavel({ acao, leadId, ...extra });
    if (r.ok) {
      setAviso(null);
      recarregar();
      return;
    }
    // Conflito não é falha do sistema: é outra pessoa tendo chegado antes.
    setAviso(r.conflito ? `${r.mensagem} — a lista foi atualizada.` : r.mensagem);
    if (r.conflito) recarregar();
  }

  return (
    <div className="min-h-full bg-canvas px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header>
          <h1 className="text-2xl font-semibold tracking-[-.02em] text-ink">Sala de Vendas</h1>
          <p className="mt-1 max-w-[70ch] text-[13.5px] leading-relaxed text-muted">
            Os restaurantes interessados em contratar a Foocci, e de quem é cada conversa agora.
          </p>
        </header>

        {estado.fase === "carregando" && <p className="mt-8 text-[13px] text-muted">Carregando…</p>}

        {estado.fase === "semAcesso" && <SemAcesso />}

        {estado.fase === "erro" && (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-5">
            <h3 className="text-[14.5px] font-semibold text-red-800">
              Não consegui carregar a fila
            </h3>
            <p className="mt-1 text-[13px] text-red-700">{estado.detalhe ?? "sem detalhe"}</p>
            <button
              type="button"
              onClick={recarregar}
              className="mt-3 rounded-xl border border-red-300 bg-white px-3.5 py-1.5 text-[13px] font-medium text-red-800 hover:bg-red-100"
            >
              Tentar de novo
            </button>
          </div>
        )}

        {estado.fase === "pronto" && (
          <>
            {aviso && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-800">
                {aviso}
              </div>
            )}

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
              <nav aria-label="Filas da Sala de Vendas">
                <ul className="space-y-1">
                  {estado.dados.filas.map((f) => {
                    const n = estado.dados.contagens[f.nome] ?? 0;
                    const ativa = f.nome === fila;
                    return (
                      <li key={f.nome}>
                        <button
                          type="button"
                          onClick={() => setFila(f.nome)}
                          aria-current={ativa ? "page" : undefined}
                          className={cx(
                            "flex w-full items-baseline justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-colors",
                            ativa
                              ? "border-brand-500 bg-paper"
                              : "border-transparent hover:border-line2 hover:bg-paper",
                          )}
                        >
                          <span>
                            <span
                              className={cx(
                                "block text-[13.5px]",
                                ativa ? "font-semibold text-ink" : "text-ink2",
                              )}
                            >
                              {f.titulo}
                            </span>
                            <span className="block text-[11.5px] leading-snug text-muted">
                              {f.pergunta}
                            </span>
                          </span>
                          <span
                            className={cx(
                              "shrink-0 rounded-full px-1.5 py-0.5 text-[11.5px] font-medium",
                              n > 0 && f.nome === "aguardandoHumano"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-canvas text-muted",
                            )}
                          >
                            {n}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </nav>

              <section>
                {estado.dados.leads.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-line2 bg-paper px-4 py-8 text-center text-[13px] text-muted">
                    Nenhum lead nesta fila.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {estado.dados.leads.map((l) => (
                      <CartaoLead key={l.id} lead={l} onAgir={agir} />
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SemAcesso() {
  return (
    <div className="mt-6 rounded-2xl border border-line2 bg-paper px-5 py-6">
      <h3 className="text-[15px] font-semibold text-ink">Entre com o seu login</h3>
      <p className="mt-1.5 max-w-[70ch] text-[13.5px] leading-relaxed text-muted">
        Você entrou com a senha da casa, e ela abre a porta mas{" "}
        <strong className="text-ink2">não tem nome</strong>. Aqui cada conversa tem
        um responsável, e responsável sem nome não responde por nada.
      </p>

      {/* ── POR QUE A TELA MUDA CONFORME QUEM ENTRA ─────────────────────────
          Não é enfeite: é o desenho que o CEO descreveu em 26/08/2026 — *"a
          plataforma é personalizável de acordo com o nível de autorização de
          cada funcionário ou agente"*.

          E já está construído, no lugar certo: `escopoDaConsulta` entra no
          `where` da consulta, então o vendedor não recebe do servidor o lead
          que não é dele. Se estivesse no menu, seria fechadura na porta com a
          janela aberta — bastaria a URL direta. */}
      <p className="mt-2 max-w-[70ch] text-[13.5px] leading-relaxed text-muted">
        O que aparece depois depende de quem você é: o vendedor vê os clientes
        dele e os números dele; o CEO e o diretor veem a operação inteira —
        as pessoas, os agentes e todos os clientes.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={ENTRADA}
          className="inline-block rounded-xl bg-brand-500 px-4 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-brand-600"
        >
          Entrar com meu login
        </a>
        {/* ── ISTO ERA UM COMANDO DE TERMINAL, E ERA O DEFEITO ──────────────
            Até 25/08/2026 esta tela imprimia `npx tsx scripts/...`. Foi a
            primeira coisa que o CEO viu ao abrir a Sala em produção — e um
            comando de terminal é, para ele, uma parede.

            A regra da casa já dizia o que fazer: "CEO não faz setup nenhum".
            Configuração que sobe de andar é trabalho de execução que o Diretor
            não achou como resolver. O comando continua certo para quem tem
            terminal; só deixou de ser a única porta.

            Virou o botão secundário porque a ordem estava invertida: quem
            chega aqui na maioria das vezes JÁ tem login e só entrou pela porta
            errada. Oferecer "criar" primeiro faz essa pessoa criar uma segunda
            conta — e trocar a senha da primeira, que é o que o `upsert` faz. */}
        <a
          href={ROTAS.acessos}
          className="inline-block rounded-xl border border-line bg-canvas px-4 py-2.5 text-[14px] font-semibold text-ink2 transition-colors hover:bg-paper"
        >
          Ainda não tenho login
        </a>
      </div>
    </div>
  );
}

function CartaoLead({
  lead: l,
  onAgir,
}: {
  lead: LeadNaFila;
  onAgir: (
    acao: "assumir" | "devolver" | "pedirHumano",
    leadId: string,
    extra?: { objetivo?: string },
  ) => void;
}) {
  const [devolvendo, setDevolvendo] = useState(false);
  const [objetivo, setObjetivo] = useState("");

  const espera = desdeQuando(l.atendenteDesde);

  // ⭐⭐ A IDADE DO LEAD — o número que decide o dia, e que a tela não mostrava.
  //
  // O cartão dizia há quanto tempo o lead está COM o atendente. Para quem não
  // tem responsável — justamente quem mais precisa de alguém — não dizia nada:
  // aparecia "Sem responsável" e ponto. Um lead parado há 21 dias e um que
  // chegou agora eram visualmente idênticos.
  //
  // Medido em 06/09/2026: o mais velho da base esperava 21 dias, tinha vindo da
  // página de PREÇOS, e ninguém sabia porque a tela não contava.
  const idade = desdeQuando(l.createdAt);
  const diasParado = l.createdAt
    ? Math.floor((Date.now() - new Date(l.createdAt).getTime()) / 86_400_000)
    : 0;
  const velho = diasParado >= 7;

  return (
    <li className="rounded-2xl border border-line2 bg-paper px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {/* ⭐ O nome vira link. Era o beco: o cartão mostrava o lead e não
            deixava abrir — a ficha existe do outro lado, em `/conversas`. */}
        <a
          href={`${ROTAS.conversas}?leadId=${encodeURIComponent(l.id)}`}
          className="text-[14.5px] font-semibold text-ink underline decoration-line2 underline-offset-2 hover:decoration-brand-500"
        >
          {l.nome}
        </a>
        {l.restaurante && <span className="text-[13px] text-muted">· {l.restaurante}</span>}
        {l.cidade && <span className="text-[12.5px] text-muted">· {l.cidade}</span>}
        <span className="rounded-full bg-canvas px-1.5 py-0.5 text-[11.5px] text-ink2">
          {l.stage}
        </span>
        {idade && (
          <span
            className={
              velho
                ? "rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[11.5px] font-medium text-red-700"
                : "rounded-full bg-canvas px-1.5 py-0.5 text-[11.5px] text-muted"
            }
          >
            espera há {idade}
          </span>
        )}
      </div>

      <p className="mt-1 text-[12.5px] text-muted">
        {l.atendidoPor === "HUMANO" && (
          <>Com {l.atendenteNome ?? "alguém"}{espera && ` há ${espera}`}</>
        )}
        {l.atendidoPor === "IA" && <>Com a IA{espera && ` há ${espera}`}</>}
        {l.atendidoPor === "NINGUEM" && <em>Sem responsável</em>}
        {l.atendidoPor === "AGUARDANDO_HUMANO" && (
          <span className="text-amber-700">
            A IA pediu gente{espera ? ` há ${espera}` : " — sem carimbo de quando"}
          </span>
        )}
        {l.origem.utmCampaign && (
          <span className="text-muted"> · veio de {l.origem.utmCampaign}</span>
        )}
      </p>

      {l.motivoDoPedido && (
        <p className="mt-1.5 rounded-xl bg-canvas px-3 py-1.5 text-[12.5px] text-ink2">
          <span className="font-medium">Por que parou:</span> {l.motivoDoPedido}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap gap-2">
        {l.atendidoPor !== "HUMANO" && (
          <button
            type="button"
            onClick={() => onAgir("assumir", l.id)}
            className="rounded-xl border border-brand-500 bg-brand-50 px-3 py-1.5 text-[12.5px] font-medium text-brand-700 hover:bg-brand-100"
          >
            Assumir
          </button>
        )}

        {l.atendidoPor === "HUMANO" && !devolvendo && (
          <button
            type="button"
            onClick={() => setDevolvendo(true)}
            className="rounded-xl border border-line2 px-3 py-1.5 text-[12.5px] font-medium text-ink2 hover:bg-canvas"
          >
            Devolver para a IA
          </button>
        )}
      </div>

      {devolvendo && (
        <div className="mt-2.5 rounded-xl border border-line2 bg-canvas px-3 py-2.5">
          <label className="block text-[12.5px] font-medium text-ink2" htmlFor={`obj-${l.id}`}>
            O que a IA deve fazer a partir daqui?
          </label>
          <p className="mt-0.5 text-[11.5px] text-muted">
            Sem isso a IA retoma sem saber o que se espera dela — e pode contradizer o que você
            prometeu.
          </p>
          <input
            id={`obj-${l.id}`}
            value={objetivo}
            onChange={(e) => setObjetivo(e.target.value)}
            placeholder="ex.: confirmar o endereço e agendar a demonstração"
            className="mt-1.5 w-full rounded-lg border border-line2 bg-paper px-2.5 py-1.5 text-[12.5px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-100"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={!objetivo.trim()}
              onClick={() => {
                onAgir("devolver", l.id, { objetivo });
                setDevolvendo(false);
                setObjetivo("");
              }}
              className="rounded-lg border border-brand-500 bg-brand-50 px-3 py-1 text-[12.5px] font-medium text-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Devolver
            </button>
            <button
              type="button"
              onClick={() => {
                setDevolvendo(false);
                setObjetivo("");
              }}
              className="rounded-lg border border-line2 px-3 py-1 text-[12.5px] text-muted hover:bg-paper"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
