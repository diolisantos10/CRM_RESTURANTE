"use client";

/**
 * O QUE O LEAD VAI RECEBER — a tela que mostra a frase, e não o nome dela.
 *
 * ── POR QUE ELA PRECISOU EXISTIR ────────────────────────────────────────────
 *
 * Quem opera a Sala não tem acesso ao painel da Meta. Até aqui, tudo que o
 * sistema dizia sobre a abordagem era o NOME do modelo — `foocci_abordagem_v1`
 * — e um número de variáveis que alguém tinha digitado à mão numa variável de
 * ambiente. Nome de modelo não é frase: dava para operar semanas sem ninguém
 * nunca ter lido o texto que sai em nome da empresa para um estranho.
 *
 * Aqui a frase aparece inteira, com as variáveis marcadas, e o modelo escolhido
 * vem sinalizado. É a diferença entre confiar e conferir.
 *
 * ── A REGRA DESTA TELA, IGUAL À DA CONFERÊNCIA AO LADO ──────────────────────
 *
 * Nenhuma frase daqui pode exigir que quem lê saiba o que é uma variável de
 * ambiente. O nome técnico aparece, mas em segundo plano.
 */

import { useCallback, useEffect, useState } from "react";

interface Numero {
  phoneNumberId: string;
  wabaId: string | null;
  numero: string | null;
  nomeVerificado: string | null;
  qualidade: string | null;
  tier: string | null;
  erro: string | null;
}

interface Modelo {
  nome: string;
  idioma: string;
  categoria: string | null;
  situacao: string;
  variaveis: number;
  corpo: string | null;
}

interface Selecionado {
  nome: string;
  idioma: string;
}

type Estado =
  | { fase: "carregando" }
  | { fase: "pronto"; numero: Numero; modelos: Modelo[]; selecionado: Selecionado }
  | { fase: "semAcesso" }
  | { fase: "erro"; detalhe: string | null };

export function ModelosClient() {
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [tentativa, setTentativa] = useState(0);
  const [sincronizando, setSincronizando] = useState(false);
  const [recado, setRecado] = useState<{ tom: "bom" | "ruim"; texto: string } | null>(null);

  useEffect(() => {
    let vivo = true;

    (async () => {
      try {
        const r = await fetch("/api/admin/sala-de-vendas/whatsapp", { cache: "no-store" });
        if (!vivo) return;

        if (r.status === 401 || r.status === 403) {
          setEstado({ fase: "semAcesso" });
          return;
        }

        const j = (await r.json()) as {
          ok: boolean;
          data?: { numero: Numero; modelos: Modelo[]; selecionado: Selecionado };
          error?: string;
        };
        if (!vivo) return;

        if (!j.ok || !j.data) {
          setEstado({ fase: "erro", detalhe: j.error ?? null });
          return;
        }

        setEstado({
          fase: "pronto",
          numero: j.data.numero,
          modelos: j.data.modelos,
          selecionado: j.data.selecionado,
        });
      } catch (e) {
        if (vivo) setEstado({ fase: "erro", detalhe: e instanceof Error ? e.message : null });
      }
    })();

    return () => {
      vivo = false;
    };
  }, [tentativa]);

  const sincronizar = useCallback(async () => {
    setSincronizando(true);
    setRecado(null);
    try {
      const r = await fetch("/api/admin/sala-de-vendas/whatsapp", { method: "POST" });
      const j = (await r.json()) as {
        ok: boolean;
        data?: { resultado: { sincronizados: number; sumiram: number; completa: boolean } };
        error?: string;
      };

      if (!j.ok || !j.data) {
        // ⚠️ O motivo real da Meta vai para a tela. "Não deu certo" faria quem
        // opera chamar quem escreve o código para descobrir o que já está escrito.
        setRecado({ tom: "ruim", texto: j.error ?? "Não consegui perguntar à Meta." });
        return;
      }

      const { sincronizados, sumiram, completa } = j.data.resultado;
      setRecado({
        tom: "bom",
        texto:
          `${sincronizados} modelo(s) lidos da Meta` +
          (sumiram > 0 ? ` · ${sumiram} sumiram da conta e foram marcados` : "") +
          // A varredura truncada é DITA. Silenciar isso faria a lista parecer
          // completa quando ela não é — e o que não foi lido não é "não existe".
          (completa ? "" : " · a conta tem mais modelos do que coube nesta varredura"),
      });
      setTentativa((t) => t + 1);
    } catch (e) {
      setRecado({ tom: "ruim", texto: e instanceof Error ? e.message : "Falha de rede." });
    } finally {
      setSincronizando(false);
    }
  }, []);

  if (estado.fase === "carregando") {
    return <p className="mt-5 text-[13px] text-muted">Lendo os modelos…</p>;
  }

  if (estado.fase === "semAcesso") {
    return (
      <p className="mt-5 text-[13.5px] leading-relaxed text-ink2">
        Sem acesso. Os modelos são de quem enxerga a operação inteira.
      </p>
    );
  }

  if (estado.fase === "erro") {
    return (
      <p className="mt-5 text-[13.5px] text-ink2">
        {estado.detalhe ?? "Não foi possível ler os modelos."}
      </p>
    );
  }

  const { numero, modelos, selecionado } = estado;

  return (
    <>
      <OCadastroDoNumero numero={numero} />

      <section className="mt-5 rounded-2xl border border-line bg-paper p-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">
              O que o lead recebe
            </h2>
            <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-muted">
              Os modelos aprovados nesta conta da Meta, com o texto exato e
              quantas informações cada um precisa. A contagem vem da Meta —
              ninguém digita esse número.
            </p>
          </div>

          <button
            type="button"
            onClick={sincronizar}
            disabled={sincronizando}
            className="shrink-0 rounded-full border border-line2 bg-paper px-3.5 py-1.5 text-[12.5px] font-medium text-ink2 hover:bg-chip disabled:opacity-50"
          >
            {sincronizando ? "Perguntando à Meta…" : "Buscar modelos na Meta"}
          </button>
        </header>

        {recado ? (
          <p
            className={cx(
              "mt-3 break-words text-[12.5px]",
              recado.tom === "bom" ? "text-emerald-600" : "text-amber-700",
            )}
          >
            {recado.texto}
          </p>
        ) : null}

        {modelos.length === 0 ? (
          <p className="mt-3 max-w-[62ch] text-[13px] leading-relaxed text-ink2">
            Nenhum modelo guardado ainda. Clique em <strong>Buscar modelos na
            Meta</strong> — isso não manda mensagem para ninguém, só lê a conta.
          </p>
        ) : (
          <ul className="mt-3.5 space-y-3">
            {modelos.map((m) => (
              <Linha
                key={`${m.nome} ${m.idioma}`}
                modelo={m}
                escolhido={m.nome === selecionado.nome && m.idioma === selecionado.idioma}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * O cadastro do número: quem é, de qual conta, e **quanto a Meta deixa falar**.
 *
 * O teto vem primeiro entre os números porque é o único que muda sozinho e
 * derruba a rodada sem avisar. Qualidade vem ao lado porque é a causa: a Meta
 * corta o teto de quem piora.
 */
function OCadastroDoNumero({ numero }: { numero: Numero }) {
  if (numero.erro && !numero.numero) {
    return (
      <section className="mt-5 rounded-2xl border border-line2 bg-canvas p-4">
        <h2 className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">
          O número na Meta
        </h2>
        <p className="mt-2 max-w-[62ch] break-words text-[13px] leading-relaxed text-ink2">
          Não consegui perguntar à Meta. Resposta dela:{" "}
          <span className="text-muted">{numero.erro}</span>
        </p>
      </section>
    );
  }

  const linhas: Array<{ rotulo: string; valor: string; nota?: string }> = [
    {
      rotulo: "Número comercial",
      valor: numero.numero ?? "sem identificação",
      nota: numero.nomeVerificado ?? undefined,
    },
    {
      rotulo: "Conta da Meta (WABA)",
      // ⚠️ "não resolvida" e "vazia" não são a mesma coisa. Sem a conta, nenhum
      // modelo pode ser lido — e quem vê um campo em branco supõe que está tudo
      // certo e o problema é outro.
      valor: numero.wabaId ?? "não resolvida",
      nota: numero.wabaId ? "é dela que os modelos abaixo são lidos" : numero.erro ?? undefined,
    },
    {
      rotulo: "Quantas conversas a Meta deixa iniciar por dia",
      valor: traduzirTier(numero.tier),
      nota: "sobe e desce sozinho, conforme qualidade e volume",
    },
    {
      rotulo: "Qualidade do número",
      valor: traduzirQualidade(numero.qualidade),
    },
  ];

  return (
    <section className="mt-5 rounded-2xl border border-line bg-paper p-4">
      <h2 className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-muted">
        O número na Meta
      </h2>

      <dl className="mt-2.5 space-y-2.5">
        {linhas.map((l) => (
          <div key={l.rotulo}>
            <dt className="text-[11.5px] text-muted">{l.rotulo}</dt>
            <dd className="text-[13.5px] leading-snug text-ink">
              <strong className="font-medium">{l.valor}</strong>
              {l.nota ? <span className="text-muted"> — {l.nota}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Linha({ modelo, escolhido }: { modelo: Modelo; escolhido: boolean }) {
  const aprovado = modelo.situacao === "APPROVED";

  return (
    <li
      className={cx(
        "rounded-xl border p-3",
        escolhido ? "border-emerald-500/40 bg-emerald-500/[.05]" : "border-line2 bg-canvas",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[13.5px] font-medium text-ink">{modelo.nome}</span>
        <span className="text-[11.5px] text-muted">{modelo.idioma}</span>
        {modelo.categoria ? (
          <span className="text-[11.5px] text-muted">· {modelo.categoria}</span>
        ) : null}
        <span
          className={cx(
            "rounded-full px-2 py-[1px] text-[11px]",
            aprovado ? "bg-emerald-500/15 text-emerald-700" : "bg-chip text-ink2",
          )}
        >
          {traduzirSituacao(modelo.situacao)}
        </span>
        {escolhido ? (
          <span className="rounded-full bg-emerald-600 px-2 py-[1px] text-[11px] font-medium text-white">
            é este que sai
          </span>
        ) : null}
      </div>

      {/* ⭐ O CORPO APROVADO, INTEIRO. É o único jeito de quem opera ver o que o
          lead lê. `whitespace-pre-wrap` porque a quebra de linha faz parte do
          texto aprovado — remontá-la num parágrafo só mostraria outra mensagem. */}
      {modelo.corpo ? (
        <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-paper px-3 py-2 text-[13px] leading-relaxed text-ink2">
          {modelo.corpo}
        </p>
      ) : (
        <p className="mt-2 text-[12.5px] text-muted">
          A Meta não devolveu o corpo deste modelo.
        </p>
      )}

      <p className="mt-1.5 text-[11.5px] text-muted">
        {modelo.variaveis === 0
          ? "não precisa de nenhuma informação do lead"
          : `precisa de ${modelo.variaveis} informação(ões) do lead — {{1}}${
              modelo.variaveis > 1 ? " … {{" + modelo.variaveis + "}}" : ""
            }`}
      </p>
    </li>
  );
}

/**
 * O tier em português de gente.
 *
 * ⚠️ Tier ausente NÃO vira "ilimitado" nem some da tela: vira "a Meta não
 * informou". Supor o teto para cima é como a rodada é planejada para 2.000 e
 * cortada em 250 no meio da lista.
 */
function traduzirTier(tier: string | null): string {
  if (!tier) return "a Meta não informou";
  const mapa: Record<string, string> = {
    TIER_50: "50 por dia",
    TIER_250: "250 por dia",
    TIER_1K: "1.000 por dia",
    TIER_10K: "10.000 por dia",
    TIER_100K: "100.000 por dia",
    TIER_UNLIMITED: "sem teto declarado",
  };
  return mapa[tier.toUpperCase()] ?? tier;
}

function traduzirQualidade(q: string | null): string {
  if (!q) return "a Meta não informou";
  const mapa: Record<string, string> = {
    GREEN: "alta",
    YELLOW: "média — a Meta está de olho",
    RED: "baixa — risco de bloqueio",
    UNKNOWN: "ainda sem histórico",
  };
  return mapa[q.toUpperCase()] ?? q;
}

function traduzirSituacao(s: string): string {
  const mapa: Record<string, string> = {
    APPROVED: "aprovado",
    PENDING: "em análise",
    REJECTED: "recusado",
    PAUSED: "pausado pela Meta",
    DISABLED: "desativado",
    // Nosso estado, e não da Meta: ela não reprovou nada, simplesmente não
    // conhece mais este modelo nesta conta. Dizer "recusado" mandaria alguém
    // corrigir um texto que não tem defeito.
    MISSING: "sumiu da conta",
  };
  return mapa[s.toUpperCase()] ?? s.toLowerCase();
}

function cx(...p: Array<string | false | null | undefined>): string {
  return p.filter(Boolean).join(" ");
}
