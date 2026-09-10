"use client";

/**
 * A leitura da conferência, em português de gente.
 *
 * ── A REGRA DESTA TELA ──────────────────────────────────────────────────────
 *
 * Nenhuma frase daqui pode exigir que quem lê saiba o que é uma variável de
 * ambiente. "FOOCCI_SALES_ACCESS_TOKEN ausente" é diagnóstico de engenheiro;
 * "falta a senha da Meta, e é você quem cola" é uma frase que resolve.
 *
 * O nome técnico aparece, mas em segundo plano — para quem for procurar no
 * Railway saber o que procurar, sem ser o texto principal.
 */

import { useCallback, useEffect, useState } from "react";

interface Presenca {
  provedor: string;
  configurado: boolean;
  envioLigado: boolean;
  phoneNumberIdSet: boolean;
  accessTokenSet: boolean;
  phoneNumberIdMasked: string | null;
}

type Conferencia =
  | { ok: true; numero: string | null; nomeVerificado: string | null; qualidade: string | null }
  | { ok: false; causa: string; detalhe: string };

type Estado =
  | { fase: "carregando" }
  | { fase: "pronto"; presenca: Presenca; conferencia: Conferencia }
  | { fase: "semAcesso" }
  | { fase: "erro"; detalhe: string | null };

/** O número real da Foocci, como a Meta o escreve. A prova do apontamento. */
const NUMERO_ESPERADO = "5511943723316";

export function ConferenciaClient() {
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [tentativa, setTentativa] = useState(0);

  const reconferir = useCallback(() => {
    setEstado({ fase: "carregando" });
    setTentativa((t) => t + 1);
  }, []);

  useEffect(() => {
    let vivo = true;

    (async () => {
      try {
        const r = await fetch("/api/admin/sala-de-vendas/canal", { cache: "no-store" });
        if (!vivo) return;

        if (r.status === 401 || r.status === 403) {
          setEstado({ fase: "semAcesso" });
          return;
        }

        const j = (await r.json()) as {
          ok: boolean;
          data?: { presenca: Presenca; conferencia: Conferencia };
          error?: string;
        };
        if (!vivo) return;

        if (!j.ok || !j.data) {
          setEstado({ fase: "erro", detalhe: j.error ?? null });
          return;
        }

        setEstado({ fase: "pronto", presenca: j.data.presenca, conferencia: j.data.conferencia });
      } catch (e) {
        if (vivo) setEstado({ fase: "erro", detalhe: e instanceof Error ? e.message : null });
      }
    })();

    return () => { vivo = false; };
  }, [tentativa]);

  if (estado.fase === "carregando") {
    return <p className="text-[13px] text-muted">Perguntando à Meta…</p>;
  }

  if (estado.fase === "semAcesso") {
    return (
      <p className="text-[13.5px] leading-relaxed text-ink2">
        Sem acesso. Esta tela é de quem enxerga a operação inteira.
      </p>
    );
  }

  if (estado.fase === "erro") {
    return (
      <p className="text-[13.5px] text-ink2">
        {estado.detalhe ?? "Não foi possível conferir o canal."}
      </p>
    );
  }

  const { presenca, conferencia } = estado;

  // ⚠️ O envelope da página saiu daqui para o `page.tsx` em 10/09/2026, quando
  // os modelos passaram a dividir a tela com a conferência. Enquanto cada
  // pedaço trazia o próprio `min-h-full`, o segundo entrava dentro do primeiro
  // ou embaixo dele com outra margem — e uma tela com duas larguras de coluna
  // parece defeito porque é.
  return (
    <>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={reconferir}
          className="shrink-0 rounded-full border border-line2 bg-paper px-3.5 py-1.5 text-[12.5px] font-medium text-ink2 hover:bg-chip"
        >
          Conferir de novo
        </button>
      </div>

      <Veredito conferencia={conferencia} />

      <AsTresChaves presenca={presenca} />
    </>
  );
}

/**
 * O veredito vem primeiro e ocupa a tela.
 *
 * Um painel que lista seis linhas de estado e deixa a conclusão para o leitor
 * montar é um painel que só serve para quem já sabia a resposta.
 */
function Veredito({ conferencia }: { conferencia: Conferencia }) {
  if (conferencia.ok) {
    const digitos = (conferencia.numero ?? "").replace(/\D/g, "");
    const oNumeroCerto = digitos.endsWith(NUMERO_ESPERADO.slice(-8));

    // ⚠️ Responder "ok" para o número ERRADO é o pior resultado possível desta
    // tela: tudo pareceria pronto e as mensagens sairiam por outro telefone.
    if (!oNumeroCerto) {
      return (
        <Cartao tom="atencao" titulo="As chaves funcionam — mas apontam para outro número">
          <p>
            A Meta respondeu com <strong>{conferencia.numero ?? "um número sem identificação"}</strong>,
            e o WhatsApp da Foocci é o <strong>(11) 94372-3316</strong>.
          </p>
          <p className="mt-2">
            O identificador do número está errado. As mensagens sairiam pelo
            telefone errado — não ligue o envio assim.
          </p>
        </Cartao>
      );
    }

    return (
      <Cartao tom="bom" titulo="Está tudo certo com a Meta">
        <p>
          A Meta confirmou o número <strong>{conferencia.numero}</strong>
          {conferencia.nomeVerificado ? <> , em nome de <strong>{conferencia.nomeVerificado}</strong></> : null}.
        </p>
        {conferencia.qualidade ? (
          <p className="mt-2">
            Qualidade do número, segundo a Meta: <strong>{traduzirQualidade(conferencia.qualidade)}</strong>.
          </p>
        ) : null}
      </Cartao>
    );
  }

  const { titulo, texto } = explicar(conferencia.causa);

  return (
    <Cartao tom="ruim" titulo={titulo}>
      <p>{texto}</p>
      {/* O motivo cru da Meta fica junto, em segundo plano: ele não serve para
          decidir nada, mas é o que faz a diferença quando alguém precisa
          entender por que a recusa aconteceu. */}
      <p className="mt-2 break-words text-[12px] text-muted">
        Resposta da Meta: {conferencia.detalhe}
      </p>
    </Cartao>
  );
}

function explicar(causa: string): { titulo: string; texto: string } {
  switch (causa) {
    case "semToken":
      return {
        titulo: "Falta a senha da Meta",
        texto:
          "O identificador do número está no ar, mas a senha (o token) ainda não foi colada. Sem ela ninguém fala com a Meta.",
      };
    case "semPhoneNumberId":
      return {
        titulo: "Falta o identificador do número",
        texto:
          "A senha está no ar, mas não há identificador do telefone. A Meta não sabe por qual número falar.",
      };
    case "provedorNaoSuportado":
      return {
        titulo: "O canal está configurado para um provedor que não existe",
        texto: "Alguém trocou o provedor por um valor que o sistema não sabe operar.",
      };
    default:
      return {
        titulo: "A Meta recusou",
        texto:
          "As duas chaves estão no ar, mas a Meta não aceitou. O caso mais comum é a senha ter nascido na conta de teste em vez da conta da Foocci — ela autentica e não alcança o número real.",
      };
  }
}

function traduzirQualidade(q: string): string {
  const mapa: Record<string, string> = {
    GREEN: "alta",
    YELLOW: "média — a Meta está de olho",
    RED: "baixa — risco de bloqueio",
    UNKNOWN: "ainda sem histórico",
  };
  return mapa[q.toUpperCase()] ?? q;
}

/**
 * As três chaves, e o que cada uma faz.
 *
 * A do envio aparece aqui e NÃO no veredito de propósito: ela não tem nada a
 * ver com a Meta aceitar ou recusar. É a decisão do dono sobre falar ou só
 * pensar — e misturá-la com "o canal funciona" já confundiu isso uma vez.
 */
function AsTresChaves({ presenca }: { presenca: Presenca }) {
  const linhas = [
    {
      pronta: presenca.phoneNumberIdSet,
      titulo: "O identificador do número",
      diz: presenca.phoneNumberIdMasked
        ? `no ar, terminando em ${presenca.phoneNumberIdMasked}`
        : "não está no ar",
      nome: "FOOCCI_SALES_PHONE_NUMBER_ID",
    },
    {
      pronta: presenca.accessTokenSet,
      titulo: "A senha da Meta",
      diz: presenca.accessTokenSet ? "no ar" : "não está no ar — é você quem cola",
      nome: "FOOCCI_SALES_ACCESS_TOKEN",
    },
    {
      pronta: presenca.envioLigado,
      titulo: "A permissão de enviar",
      diz: presenca.envioLigado
        ? "ligada — o agente fala com os clientes"
        : "desligada — o agente escreve, guarda e não manda",
      nome: "FOOCCI_SDR_SEND_ENABLED",
    },
  ];

  return (
    <section className="mt-5 rounded-2xl border border-line bg-paper p-4">
      <h2 className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">
        As três chaves
      </h2>

      <ul className="mt-2.5 space-y-2.5">
        {linhas.map((l) => (
          <li key={l.nome} className="flex items-start gap-2.5">
            <span
              aria-hidden
              className={cx(
                "mt-[3px] h-2 w-2 shrink-0 rounded-full",
                l.pronta ? "bg-emerald-500" : "bg-line2",
              )}
            />
            <div className="min-w-0">
              <p className="text-[13.5px] leading-snug text-ink">
                <strong className="font-medium">{l.titulo}</strong> — {l.diz}
              </p>
              <p className="break-all text-[11.5px] text-muted">{l.nome}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-3 max-w-[62ch] text-[12.5px] leading-relaxed text-muted">
        A terceira é separada de propósito: receber e pensar é seguro; falar com
        um estranho em nome da empresa é outra decisão, e ela é sua.
      </p>
    </section>
  );
}

function Cartao({
  tom,
  titulo,
  children,
}: {
  tom: "bom" | "ruim" | "atencao";
  titulo: string;
  children: React.ReactNode;
}) {
  const borda = {
    bom: "border-emerald-500/40 bg-emerald-500/[.06]",
    ruim: "border-line2 bg-canvas",
    atencao: "border-amber-500/50 bg-amber-500/[.07]",
  }[tom];

  return (
    <section className={cx("rounded-2xl border p-4 sm:p-5", borda)}>
      <h2 className="text-[15px] font-semibold leading-snug tracking-[-.01em] text-ink">
        {titulo}
      </h2>
      <div className="mt-1.5 max-w-[62ch] text-[13.5px] leading-relaxed text-ink2">
        {children}
      </div>
    </section>
  );
}

function cx(...p: Array<string | false | null | undefined>): string {
  return p.filter(Boolean).join(" ");
}
