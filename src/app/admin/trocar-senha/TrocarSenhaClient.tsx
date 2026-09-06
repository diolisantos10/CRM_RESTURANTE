"use client";

/**
 * ⚠️ O texto desta tela é metade do trabalho.
 *
 * Quem chega aqui não pediu para trocar senha: foi mandado. Uma tela que só diz
 * "troque sua senha" faz a pessoa achar que houve invasão, ou que ela fez algo
 * errado. Então a tela diz o MOTIVO na primeira linha — a senha atual passou
 * por outra pessoa — e o motivo é verdadeiro, não é fórmula.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TrocarSenhaClient({ nome }: { nome: string }) {
  const router = useRouter();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [repetida, setRepetida] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    // ⚠️ Conferido aqui só para a pessoa não perder a digitação. A régua que
    // vale é a do servidor — trava que só existe na tela é decoração.
    if (nova !== repetida) {
      setErro("As duas senhas novas não são iguais.");
      return;
    }

    setSalvando(true);
    const r = await fetch("/api/interno/senha", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ atual, nova }),
    });
    const dados = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setSalvando(false);

    if (!dados.ok) {
      setErro(dados.error ?? "Não foi possível trocar a senha.");
      return;
    }
    router.replace("/comercial");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Defina a sua senha, {nome}</h1>
        <p className="mt-2 text-sm opacity-80">
          A senha com que você entrou foi criada por outra pessoa e apareceu na tela dela. Enquanto
          você não definir uma própria, ela continua sendo de duas pessoas — por isso esta é a única
          tela que abre agora.
        </p>
      </div>

      <form onSubmit={enviar} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Senha que você recebeu
          <input
            type="password"
            value={atual}
            onChange={(e) => setAtual(e.target.value)}
            autoComplete="current-password"
            required
            className="rounded border border-line bg-transparent p-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Sua senha nova
          <input
            type="password"
            value={nova}
            onChange={(e) => setNova(e.target.value)}
            autoComplete="new-password"
            required
            className="rounded border border-line bg-transparent p-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Repita a senha nova
          <input
            type="password"
            value={repetida}
            onChange={(e) => setRepetida(e.target.value)}
            autoComplete="new-password"
            required
            className="rounded border border-line bg-transparent p-2"
          />
        </label>

        {erro !== null && (
          <p role="alert" className="text-sm text-red-400">
            {erro}
          </p>
        )}

        <button
          type="submit"
          disabled={salvando}
          className="rounded bg-white/10 p-2 text-sm font-medium disabled:opacity-50"
        >
          {salvando ? "Salvando…" : "Definir minha senha"}
        </button>
      </form>
    </main>
  );
}
