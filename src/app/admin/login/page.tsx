"use client";

/**
 * A entrada do Admin — DUAS portas, e elas não são equivalentes.
 *
 * ── POR QUE DUAS ────────────────────────────────────────────────────────────
 *
 * **E-mail e senha** é a porta das pessoas. Cada uma entra com a própria
 * identidade, o papel dela decide o que ela alcança, e a trilha registra quem
 * entrou. É por aqui que o SDR entra — e até 25/08/2026 ela simplesmente **não
 * existia**: `autenticarInterno` estava escrito, testado, e sem nenhuma rota que
 * o chamasse. O único jeito de obter uma sessão interna era forjar o cookie por
 * script, que foi literalmente o que precisei fazer para capturar as evidências.
 *
 * **Admin secret** é a porta da casa. Uma senha única, sem identidade, que dá
 * acesso a tudo. Existe porque o sistema foi construído antes de haver pessoas
 * cadastradas, e continua aqui até o CEO marcar a data de desligá-la.
 *
 * A ordem na tela é a ordem da doutrina: a porta das pessoas em cima, a senha
 * única embaixo, recolhida. Quem entra pela primeira vez encontra o caminho
 * certo primeiro.
 *
 * ── PARA ONDE CADA UM VAI ───────────────────────────────────────────────────
 *
 * O destino vem do SERVIDOR, junto com a sessão. O SDR cai direto na Sala de
 * Vendas; mandá-lo para `/admin/restaurants` — o destino de todo mundo até aqui
 * — o jogaria numa tela que ele não pode ver, e a primeira coisa que ele veria
 * do sistema seria uma recusa.
 */

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ROTAS } from "@/lib/sala/rotas";

type Porta = "pessoa" | "chaveDaCasa";

export default function AdminLoginPage() {
  const router = useRouter();
  const [porta, setPorta] = useState<Porta>("pessoa");

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [secret, setSecret] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function entrarComoPessoa(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !senha) {
      setError("Informe e-mail e senha.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/session/interna", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), senha }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        data?: { destino?: string };
      };

      if (res.ok && data.ok) {
        // O destino é o que o servidor mandou. Um destino escolhido aqui seria
        // um destino que o navegador pode trocar.
        router.replace(data.data?.destino ?? "/admin/departamentos");
        return;
      }

      setError(data.error ?? "Não foi possível entrar.");
    } catch {
      setError("Erro de rede. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function entrarComAChaveDaCasa(e: FormEvent) {
    e.preventDefault();
    const val = secret.trim();
    if (!val) {
      setError("Informe o admin secret.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: val }),
      });

      if (res.ok) {
        // A entrada por segredo é a do dono. Mesmo destino que o papel MASTER_CEO
        // recebe em `destinoDe`: a Sala de Vendas, não o organograma vazio.
        router.replace(ROTAS.painel);
        return;
      }

      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error ?? "Secret inválido.");
    } catch {
      setError("Erro de rede. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  const campo =
    "w-full bg-gray-800 text-white border border-gray-700 rounded-xl px-4 py-2.5 text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent placeholder-gray-600";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-2xl font-bold tracking-tight text-white">Foocci</p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-violet-400">
            Admin Platform
          </p>
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-8">
          {porta === "pessoa" ? (
            <>
              <h1 className="mb-1 text-lg font-semibold text-white">Entrar</h1>
              <p className="mb-6 text-sm text-gray-400">
                Use o e-mail e a senha da sua conta Foocci.
              </p>

              <form onSubmit={entrarComoPessoa} className="flex flex-col gap-4">
                <div>
                  <label htmlFor="email" className="mb-1.5 block text-xs text-gray-400">
                    E-mail
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoFocus
                    autoComplete="username"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(""); }}
                    placeholder="voce@foocci.com"
                    className={campo}
                  />
                </div>

                <div>
                  <label htmlFor="senha" className="mb-1.5 block text-xs text-gray-400">
                    Senha
                  </label>
                  <input
                    id="senha"
                    type="password"
                    autoComplete="current-password"
                    value={senha}
                    onChange={(e) => { setSenha(e.target.value); setError(""); }}
                    placeholder="••••••••"
                    className={campo}
                  />
                </div>

                {error && <Erro texto={error} />}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
                >
                  {loading ? "Verificando…" : "Entrar"}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="mb-1 text-lg font-semibold text-white">Acesso administrativo</h1>
              <p className="mb-6 text-sm text-gray-400">
                A senha única da casa. Dá acesso a tudo e não identifica quem entrou.
              </p>

              <form onSubmit={entrarComAChaveDaCasa} className="flex flex-col gap-4">
                <div>
                  <label htmlFor="secret" className="mb-1.5 block text-xs text-gray-400">
                    Admin Secret
                  </label>
                  <input
                    id="secret"
                    type="password"
                    autoFocus
                    autoComplete="current-password"
                    value={secret}
                    onChange={(e) => { setSecret(e.target.value); setError(""); }}
                    placeholder="••••••••"
                    className={campo}
                  />
                </div>

                {error && <Erro texto={error} />}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
                >
                  {loading ? "Verificando…" : "Entrar"}
                </button>
              </form>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              setPorta(porta === "pessoa" ? "chaveDaCasa" : "pessoa");
              setError("");
            }}
            className="mt-5 w-full text-center text-xs text-gray-500 underline underline-offset-2 transition-colors hover:text-gray-300"
          >
            {porta === "pessoa"
              ? "Entrar com o admin secret"
              : "Entrar com e-mail e senha"}
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-gray-600">
          Acesso restrito a colaboradores Foocci.
        </p>
      </div>
    </div>
  );
}

function Erro({ texto }: { texto: string }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-400"
    >
      {texto}
    </p>
  );
}
