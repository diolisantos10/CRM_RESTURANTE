"use client";

/**
 * O FUNIL — o quadro, agora com cartões que se arrastam.
 *
 * ── O QUE FALTAVA ───────────────────────────────────────────────────────────
 *
 * Até 26/08/2026 este quadro mostrava só a CONTAGEM. Um Kanban sem cartão é um
 * relatório: informa e não deixa fazer nada. O vendedor via "3 em negociação" e,
 * para mover qualquer um deles, tinha que sair do quadro, achar o lead na fila e
 * abrir a ficha — quatro telas para um gesto que devia ser um.
 *
 * O que não se registra no fluxo não se registra. Era por isso que a etapa
 * envelhecia: o gesto certo custava caro demais.
 *
 * ── POR QUE AS TERMINAIS APARECEM NO QUADRO ─────────────────────────────────
 *
 * Um Kanban que só mostra o caminho feliz obriga a sair do quadro para registrar
 * a perda. E o que não se registra no fluxo não se registra: o vendedor fecha a
 * tela, promete voltar depois, e o lead perdido fica em "negociação" para sempre
 * inflando o funil.
 *
 * ── E POR QUE PERDER ABRE UMA PERGUNTA ──────────────────────────────────────
 *
 * Arrastar para "Perdido" abre o motivo, e o motivo é obrigatório. É o único
 * lugar do produto que interrompe o gesto do usuário para exigir um dado — e a
 * interrupção é o ponto: "o que mais nos faz perder" é a pergunta que paga a
 * próxima decisão de produto, e ela não se responde lendo trezentas notas.
 *
 * ── ⚠️ ARRASTAR NÃO É AUTORIZAÇÃO ───────────────────────────────────────────
 *
 * Quem decide se o movimento vale é o servidor: `moverNaSala` valida a régua, a
 * alçada e o motivo. Esta tela desfaz o movimento na hora em que a rota recusa —
 * um cartão que fica na coluna nova depois de um 403 ensina que o quadro mente.
 */

import { useCallback, useEffect, useState } from "react";

interface Coluna {
  etapa: string;
  rotulo: string;
  total: number;
}

interface Cartao {
  id: string;
  nome: string;
  restaurante: string | null;
  ultimaInteracaoEm: string | null;
  score: number | null;
  atendidoPor: "NINGUEM" | "IA" | "HUMANO" | "AGUARDANDO_HUMANO";
}

interface Motivo {
  id: string;
  rotulo: string;
  grupo: string | null;
  exigeDetalhe: boolean;
}

type Estado =
  | { fase: "carregando" }
  | { fase: "pronto"; colunas: Coluna[]; cartoes: Record<string, Cartao[]>; motivos: Motivo[] }
  | { fase: "semAcesso" }
  | { fase: "erro"; detalhe: string | null };

/** Terminais ficam visualmente separadas: elas encerram, não avançam. */
const TERMINAIS = new Set(["GANHO", "PERDIDO", "NUTRICAO"]);

/** O que o quadro pede quando o destino é "Perdido". */
interface PerguntaDaPerda {
  cartao: Cartao;
  de: string;
  para: string;
}

export function FunilClient() {
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [tentativa, setTentativa] = useState(0);
  const [arrastando, setArrastando] = useState<{ cartao: Cartao; de: string } | null>(null);
  const [perguntando, setPerguntando] = useState<PerguntaDaPerda | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const recarregar = useCallback(() => setTentativa((t) => t + 1), []);

  useEffect(() => {
    let vivo = true;

    (async () => {
      try {
        const r = await fetch("/api/admin/sala-de-vendas/funil", { cache: "no-store" });
        if (!vivo) return;

        if (r.status === 401 || r.status === 403) {
          setEstado({ fase: "semAcesso" });
          return;
        }

        const j = (await r.json()) as {
          ok: boolean;
          data?: { colunas: Coluna[]; cartoes: Record<string, Cartao[]>; motivosDePerda: Motivo[] };
          error?: string;
        };
        if (!vivo) return;

        if (!j.ok || !j.data) {
          setEstado({ fase: "erro", detalhe: j.error ?? null });
          return;
        }

        setEstado({
          fase: "pronto",
          colunas: j.data.colunas,
          cartoes: j.data.cartoes ?? {},
          motivos: j.data.motivosDePerda,
        });
      } catch (e) {
        if (vivo) setEstado({ fase: "erro", detalhe: e instanceof Error ? e.message : null });
      }
    })();

    return () => { vivo = false; };
  }, [tentativa]);

  /**
   * Move de verdade — e desfaz na tela quando o servidor recusa.
   *
   * O cartão pula para a coluna nova ANTES da resposta, porque um quadro que
   * espera meio segundo a cada arrasto é um quadro que ninguém usa. O preço
   * disso é ter que desfazer: um cartão que fica onde não devia depois de uma
   * recusa é pior que a espera, porque ensina que o quadro mente.
   */
  async function mover(cartao: Cartao, de: string, para: string, motivoPerdaId?: string, nota?: string) {
    if (de === para) return;
    setAviso(null);

    setEstado((e) => (e.fase === "pronto" ? aplicarNaTela(e, cartao, de, para) : e));

    try {
      const r = await fetch("/api/admin/sala-de-vendas/funil", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: cartao.id, para, motivoPerdaId, nota }),
      });

      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        recusas?: Array<{ campo?: string; motivo?: string }>;
      };

      if (!r.ok || !j.ok) {
        // Volta o cartão para onde estava, e diz por quê. Uma recusa muda é o
        // que faz a pessoa arrastar de novo achando que o clique falhou.
        setEstado((e) => (e.fase === "pronto" ? aplicarNaTela(e, cartao, para, de) : e));
        setAviso(
          j.recusas?.map((x) => x.motivo).filter(Boolean).join("; ") ||
            j.error ||
            "O movimento não foi aceito.",
        );
      }
    } catch {
      setEstado((e) => (e.fase === "pronto" ? aplicarNaTela(e, cartao, para, de) : e));
      setAviso("Sem resposta do servidor — o cartão voltou para onde estava.");
    }
  }

  function soltarEm(para: string) {
    const a = arrastando;
    setArrastando(null);
    if (!a || a.de === para) return;

    // "Perdido" é o único destino que interrompe o gesto: sem motivo, a pergunta
    // "o que mais nos faz perder" fica sem resposta para sempre.
    if (para === "PERDIDO") {
      setPerguntando({ cartao: a.cartao, de: a.de, para });
      return;
    }

    void mover(a.cartao, a.de, para);
  }

  if (estado.fase === "carregando") {
    return <p className="p-6 text-[13px] text-muted">Carregando o funil…</p>;
  }

  if (estado.fase === "semAcesso") {
    return (
      <p className="p-6 text-[13.5px] leading-relaxed text-ink2">
        Sem acesso ao funil. É preciso um login interno.
      </p>
    );
  }

  if (estado.fase === "erro") {
    return (
      <div className="p-6">
        <p className="text-[13.5px] text-ink2">
          {estado.detalhe ?? "Não foi possível carregar o funil."}
        </p>
        <button
          type="button"
          onClick={recarregar}
          className="mt-2 rounded-full border border-line2 bg-paper px-3 py-1 text-[12.5px] text-ink2"
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  const total = estado.colunas.reduce((s, c) => s + c.total, 0);

  return (
    <div className="min-h-full bg-canvas px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1400px]">
        <header className="mb-5">
          <h1 className="text-2xl font-semibold tracking-[-.02em] text-ink">Funil comercial</h1>
          <p className="mt-1 max-w-[70ch] text-[13.5px] leading-relaxed text-muted">
            Arraste o cartão para mover o lead de etapa. A soma das colunas bate
            com o que você consegue abrir — um quadro que mostra mais do que
            deixa ver ensina que o número mente.
          </p>
        </header>

        {aviso && (
          <p role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-900">
            {aviso}
          </p>
        )}

        {total === 0 ? (
          <p className="rounded-2xl border border-line bg-paper p-5 text-[13.5px] leading-relaxed text-ink2">
            Nenhum lead no seu escopo ainda. Quando os primeiros entrarem, as
            colunas se enchem sozinhas.
          </p>
        ) : (
          /* Rola na horizontal DENTRO do próprio contêiner: onze colunas nunca
             cabem numa tela, e deixar a página rolar de lado quebraria o resto. */
          <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            <div className="flex min-w-max items-start gap-2">
              {estado.colunas.map((c) => (
                <ColunaDoQuadro
                  key={c.etapa}
                  coluna={c}
                  total={total}
                  cartoes={estado.cartoes[c.etapa] ?? []}
                  arrastando={arrastando}
                  aoPegar={(cartao) => setArrastando({ cartao, de: c.etapa })}
                  aoSoltar={() => soltarEm(c.etapa)}
                />
              ))}
            </div>
          </div>
        )}

        {perguntando && (
          <PorQuePerdeu
            motivos={estado.motivos}
            aoCancelar={() => setPerguntando(null)}
            aoConfirmar={(motivoPerdaId, nota) => {
              const p = perguntando;
              setPerguntando(null);
              void mover(p.cartao, p.de, p.para, motivoPerdaId, nota);
            }}
          />
        )}

        <MotivosDePerda motivos={estado.motivos} />
      </div>
    </div>
  );
}

/** Move o cartão entre colunas na tela, e acerta as contagens junto. */
function aplicarNaTela(
  e: Extract<Estado, { fase: "pronto" }>,
  cartao: Cartao,
  de: string,
  para: string,
): Estado {
  const cartoes = { ...e.cartoes };
  cartoes[de] = (cartoes[de] ?? []).filter((c) => c.id !== cartao.id);
  cartoes[para] = [cartao, ...(cartoes[para] ?? [])];

  // A contagem anda junto. Deixá-la parada faria o total contradizer os cartões
  // que a própria pessoa acabou de mover — e ela confiaria no número, não neles.
  const colunas = e.colunas.map((c) =>
    c.etapa === de ? { ...c, total: Math.max(0, c.total - 1) }
    : c.etapa === para ? { ...c, total: c.total + 1 }
    : c,
  );

  return { ...e, cartoes, colunas };
}

function ColunaDoQuadro({
  coluna, total, cartoes, arrastando, aoPegar, aoSoltar,
}: {
  coluna: Coluna;
  total: number;
  cartoes: Cartao[];
  arrastando: { cartao: Cartao; de: string } | null;
  aoPegar: (c: Cartao) => void;
  aoSoltar: () => void;
}) {
  const terminal = TERMINAIS.has(coluna.etapa);
  const proporcao = total > 0 ? Math.round((coluna.total / total) * 100) : 0;
  const alvo = arrastando !== null && arrastando.de !== coluna.etapa;
  const escondidos = coluna.total - cartoes.length;

  return (
    <section
      onDragOver={(e) => { if (alvo) e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); aoSoltar(); }}
      className={cx(
        "w-[196px] shrink-0 rounded-2xl border p-3 transition-colors",
        terminal ? "border-dashed border-line2 bg-canvas" : "border-line bg-paper",
        alvo && "border-ink2 bg-chip",
      )}
    >
      <h2 className="text-[12px] font-semibold leading-snug text-ink2">{coluna.rotulo}</h2>

      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-ink">{coluna.total}</p>

      {/* A proporção só aparece quando há coluna cheia: "0%" em toda coluna de um
          funil vazio é ruído que ninguém consegue usar. */}
      {coluna.total > 0 && (
        <p className="text-[11.5px] tabular-nums text-muted">{proporcao}% do total</p>
      )}

      <ul className="mt-2.5 space-y-1.5">
        {cartoes.map((c) => (
          <li key={c.id}>
            <CartaoDoLead cartao={c} aoPegar={() => aoPegar(c)} />
          </li>
        ))}
      </ul>

      {/* ⚠️ O que ficou de fora é DITO. Truncar em silêncio faria o total parecer
          errado — e quem confere acharia que o quadro perdeu leads. */}
      {escondidos > 0 && (
        <p className="mt-2 text-[11.5px] leading-snug text-muted">
          +{escondidos} nesta etapa. O quadro mostra os {cartoes.length} mais
          parados; a lista inteira está em Filas.
        </p>
      )}
    </section>
  );
}

function CartaoDoLead({ cartao, aoPegar }: { cartao: Cartao; aoPegar: () => void }) {
  return (
    <article
      draggable
      onDragStart={aoPegar}
      className="cursor-grab rounded-xl border border-line2 bg-paper px-2.5 py-2 active:cursor-grabbing"
    >
      {/* ⭐ O nome vira link para a ficha. O quadro deixava MOVER o lead entre
          colunas e não deixava ABRI-LO: para ver a qualificação era preciso
          sair daqui e caçá-lo em outra tela.

          ⚠️ `stopPropagation` e `preventDefault` no arraste: sem eles o clique
          no nome disputa com o gesto de arrastar do cartão, e o quadro fica com
          um link que às vezes navega e às vezes não — que é pior que link
          nenhum, porque ensina a não confiar no cartão. */}
      <a
        href={`/comercial/conversas?leadId=${encodeURIComponent(cartao.id)}`}
        onClick={(e) => e.stopPropagation()}
        onDragStart={(e) => e.preventDefault()}
        className="block truncate text-[12.5px] font-medium leading-snug text-ink underline decoration-line2 underline-offset-2 hover:decoration-brand-500"
      >
        {cartao.nome}
      </a>

      {cartao.restaurante && (
        <p className="truncate text-[11.5px] leading-snug text-muted">{cartao.restaurante}</p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <DeQuemE quem={cartao.atendidoPor} />
        <span className="text-[11px] tabular-nums text-muted">{desdeQuando(cartao.ultimaInteracaoEm)}</span>
      </div>
    </article>
  );
}

/**
 * Quem está com o lead.
 *
 * Aparece no cartão porque é a informação que impede duas pessoas na mesma
 * conversa. "Esperando gente" tem destaque próprio: é a fila mais importante da
 * Sala — uma venda em queda livre, invisível em qualquer lista por etapa.
 */
function DeQuemE({ quem }: { quem: Cartao["atendidoPor"] }) {
  const mapa = {
    NINGUEM: { rotulo: "sem dono", cor: "border-line2 bg-canvas text-muted" },
    IA: { rotulo: "TA", cor: "border-line2 bg-chip text-ink2" },
    HUMANO: { rotulo: "com gente", cor: "border-line2 bg-chip text-ink2" },
    AGUARDANDO_HUMANO: { rotulo: "esperando gente", cor: "border-sky-200 bg-sky-50 text-sky-800" },
  } as const;

  const e = mapa[quem] ?? mapa.NINGUEM;

  return (
    <span className={`rounded border px-1.5 py-px text-[10.5px] font-medium ${e.cor}`}>
      {e.rotulo}
    </span>
  );
}

/** "há 3 dias", "hoje", "nunca". Data crua obriga a fazer a conta de cabeça. */
function desdeQuando(iso: string | null): string {
  if (!iso) return "nunca falaram";

  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias} dias`;
}

/**
 * A pergunta que interrompe o gesto.
 *
 * É o único lugar do produto que para o usuário para exigir um dado, e a
 * interrupção é o ponto: perda sem motivo estruturado não vira relatório, e "o
 * que mais nos faz perder" fica sem resposta.
 */
function PorQuePerdeu({
  motivos, aoCancelar, aoConfirmar,
}: {
  motivos: Motivo[];
  aoCancelar: () => void;
  aoConfirmar: (motivoPerdaId: string, nota?: string) => void;
}) {
  const [escolhido, setEscolhido] = useState<string>("");
  const [nota, setNota] = useState("");

  const motivo = motivos.find((m) => m.id === escolhido);
  const faltaDetalhe = Boolean(motivo?.exigeDetalhe) && !nota.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-[420px] rounded-2xl border border-line bg-paper p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold tracking-[-.01em] text-ink">Por que perdemos?</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Sem isso a perda não vira relatório, e a pergunta fica sem resposta.
        </p>

        {motivos.length === 0 ? (
          <p className="mt-3 text-[13px] leading-relaxed text-ink2">
            Nenhum motivo cadastrado ainda — e enquanto for assim, nenhum lead
            pode ser marcado como perdido.
          </p>
        ) : (
          <>
            <ul className="mt-3 space-y-1">
              {motivos.map((m) => (
                <li key={m.id}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-canvas">
                    <input
                      type="radio"
                      name="motivo-da-perda"
                      className="mt-[3px]"
                      checked={escolhido === m.id}
                      onChange={() => setEscolhido(m.id)}
                    />
                    <span className="text-[13px] leading-snug text-ink">{m.rotulo}</span>
                  </label>
                </li>
              ))}
            </ul>

            {motivo?.exigeDetalhe && (
              <label className="mt-2 block">
                <span className="mb-1 block text-[12px] font-medium text-ink2">
                  Este motivo pede um detalhe
                </span>
                <textarea
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-line2 bg-canvas px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink2"
                />
              </label>
            )}
          </>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={aoCancelar}
            className="rounded-xl border border-line2 bg-canvas px-3 py-1.5 text-[13px] font-medium text-ink2"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!escolhido || faltaDetalhe}
            onClick={() => aoConfirmar(escolhido, nota.trim() || undefined)}
            className="rounded-xl bg-ink px-3 py-1.5 text-[13px] font-semibold text-paper disabled:opacity-50"
          >
            Marcar como perdido
          </button>
        </div>
      </div>
    </div>
  );
}

function MotivosDePerda({ motivos }: { motivos: Motivo[] }) {
  return (
    <section className="mt-6 rounded-2xl border border-line bg-paper p-4">
      <h2 className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">
        Motivos de perda cadastrados
      </h2>

      {motivos.length === 0 ? (
        <p className="mt-2 max-w-[70ch] text-[13px] leading-relaxed text-ink2">
          <strong>Nenhum motivo cadastrado ainda</strong> — e enquanto for assim,
          nenhum lead pode ser marcado como perdido. É deliberado: perda sem motivo
          estruturado não vira relatório, e a pergunta &quot;o que mais nos faz
          perder&quot; fica sem resposta.
          <span className="mt-1.5 block text-muted">
            O catálogo é criado sozinho a cada publicação. Se continuar vazio
            depois de alguns minutos, é sinal de que a publicação ainda não
            terminou — ou de que falta a senha de administração no ambiente.
          </span>
        </p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {motivos.map((m) => (
            <li
              key={m.id}
              className="rounded-full border border-line2 bg-chip px-2 py-0.5 text-[12px] text-ink2"
            >
              {m.rotulo}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function cx(...p: Array<string | false | null | undefined>): string {
  return p.filter(Boolean).join(" ");
}
