"use client";

/**
 * PESSOAS E ACESSOS — a tela de RH.
 *
 * ── O QUE ELA SUBSTITUI, E POR QUÊ ──────────────────────────────────────────
 *
 * A criação de acesso morava **dentro da área comercial**, numa tela em que quem
 * chegava escolhia o próprio papel — inclusive "CEO". O CEO leu e desmontou:
 *
 *   *"Geralmente nas empresas é o RH que tem essa função... esse modelo que você
 *   fez, em que a pessoa própria escolhe, não existe."*
 *
 * O erro não era de lugar, era de **quem decide**. Acesso não é coisa que a
 * pessoa pega; é coisa que a empresa concede.
 *
 * ── A ORDEM DA TELA ─────────────────────────────────────────────────────────
 *
 * A **lista** vem primeiro, e o formulário depois. Quem abre esta tela quase
 * sempre vem conferir alguém que já existe — "o Fulano ainda tem acesso?" — e
 * não cadastrar gente nova. Formulário em cima faz a pergunta comum descer a
 * página.
 *
 * ── ⚠️ A SENHA APARECE UMA VEZ ──────────────────────────────────────────────
 *
 * Sorteada no servidor, mostrada aqui, e guardada em lugar nenhum. Por isso o
 * cartão é grande, tem botão de copiar e não some sozinho: senha que o navegador
 * engole é uma pessoa trancada do lado de fora no primeiro dia dela.
 */

import { useCallback, useEffect, useState } from "react";
import { problemaComASenha, MINIMO_DE_CARACTERES } from "@/services/organizacao/senhaEscolhida";

const ROTA = "/api/admin/pessoas";

interface Tipo {
  papel: string;
  rotulo: string;
  resumo: string;
  pode: readonly string[];
  naoPode: readonly string[];
}

interface Pessoa {
  id: string;
  nome: string;
  email: string;
  papel: string;
  ativa: boolean;
  ultimoAcesso: string | null;
  criadaEm: string;
}

interface Criada {
  nome: string;
  email: string;
  papel: string;
  senha: string;
  /** Digitada por quem criou, ou sorteada pela casa. Muda o texto do cartão. */
  foiEscolhida: boolean;
  trocouSenha: boolean;
  /** Até quando a provisória entra. Depois disso, só outra. */
  expiraEm?: string;
  /** A senha foi entregue na caixa do Connect? Muda o que a tela pede. */
  avisoEntregue?: boolean;
  motivoDoAviso?: string | null;
}

type Fase =
  | { f: "carregando" }
  | { f: "pronto"; pessoas: Pessoa[]; tipos: Tipo[] }
  | { f: "semAcesso" }
  | { f: "erro"; detalhe: string };

export function PessoasClient() {
  const [fase, setFase] = useState<Fase>({ f: "carregando" });
  const [tentativa, setTentativa] = useState(0);
  const recarregar = useCallback(() => setTentativa((t) => t + 1), []);

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState("AGENTE_HUMANO");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criada, setCriada] = useState<Criada | null>(null);
  // Vazio = a casa sorteia. É o padrão de propósito: quem cria dez acessos de
  // uma vez não quer inventar dez senhas, e senha inventada em série é a mais
  // fraca que existe ("Foocci1", "Foocci2"...).
  const [senha, setSenha] = useState("");
  // ⚠️ Opcional de propósito: a maioria das pessoas desta casa não tem crachá
  // no Connect, e exigir o campo travaria a criação de acesso de gente.
  const [crachaConnect, setCrachaConnect] = useState("");
  const [verSenha, setVerSenha] = useState(false);
  const [copiou, setCopiou] = useState(false);
  const [mexendo, setMexendo] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch(ROTA, { cache: "no-store" });
        if (!vivo) return;
        if (r.status === 401 || r.status === 403) return setFase({ f: "semAcesso" });

        const j = (await r.json()) as {
          ok: boolean;
          data?: { pessoas: Pessoa[]; tipos: Tipo[] };
          error?: string;
        };
        if (!vivo) return;
        if (!j.ok || !j.data) {
          return setFase({ f: "erro", detalhe: j.error ?? "resposta inesperada" });
        }
        setFase({ f: "pronto", pessoas: j.data.pessoas, tipos: j.data.tipos });
      } catch {
        if (vivo) setFase({ f: "erro", detalhe: "Sem resposta do servidor." });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [tentativa]);

  // ⚠️ Só avisa depois que a pessoa digitou alguma coisa: campo vazio significa
  // "sorteia pra mim", que é um caminho válido — reclamar dele seria transformar
  // o padrão em erro.
  const problemaDaSenha = senha.length > 0 ? problemaComASenha(senha, { nome, email }) : null;

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (salvando) return;

    setSalvando(true);
    setErro(null);
    setCriada(null);
    setCopiou(false);

    try {
      const r = await fetch(ROTA, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, email, papel, senha, crachaConnect, departamentos: ["vendas"] }),
      });
      const j = (await r.json()) as { ok: boolean; data?: Criada; error?: string };

      if (!j.ok || !j.data) {
        setErro(j.error ?? "Não foi possível criar o acesso.");
        return;
      }
      setCriada(j.data);
      setNome("");
      setEmail("");
      setSenha("");
      recarregar();
    } catch {
      setErro("Sem resposta do servidor.");
    } finally {
      setSalvando(false);
    }
  }

  async function mudarAcesso(p: Pessoa) {
    if (mexendo) return;

    // A confirmação existe porque cortar acesso derruba alguém no meio do dia —
    // e o clique fica ao lado do nome, a um pixel de engano.
    const alvo = !p.ativa;
    if (!alvo && !confirm(`Cortar o acesso de ${p.nome}? Ela sai do sistema agora.`)) return;

    setMexendo(p.id);
    setErro(null);

    try {
      const r = await fetch(ROTA, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, ativa: alvo }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (!j.ok) setErro(j.error ?? "Não foi possível mudar o acesso.");
      else recarregar();
    } catch {
      setErro("Sem resposta do servidor.");
    } finally {
      setMexendo(null);
    }
  }

  if (fase.f === "carregando") {
    return <div className="mx-auto max-w-3xl p-4 text-sm text-gray-400 sm:p-6">Carregando…</div>;
  }

  if (fase.f === "semAcesso") {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4">
          <p className="text-sm font-semibold text-gray-100">Esta área é do CEO</p>
          <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-gray-400">
            Quem cria acesso escolhe o tipo dele — e portanto pode criar outro CEO.
            Por isso a porta é estreita de propósito.
          </p>
        </div>
      </div>
    );
  }

  if (fase.f === "erro") {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <div className="rounded-2xl border border-red-900/60 bg-red-950/40 p-4">
          <p className="text-sm font-semibold text-red-300">Não consegui carregar</p>
          <p className="mt-1 text-sm text-red-200/80">{fase.detalhe}</p>
          <button
            onClick={recarregar}
            className="mt-3 rounded-xl border border-red-800 px-3 py-1.5 text-sm text-red-200 hover:bg-red-900/40"
          >
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  const tipoDe = (papel: string) => fase.tipos.find((t) => t.papel === papel);
  const escolhido = tipoDe(papel);

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight text-white">Pessoas e acessos</h1>
        <p className="mt-1 max-w-[64ch] text-sm leading-relaxed text-gray-400">
          Quem entra no sistema da Foocci, e com que poderes. Aqui se cria o acesso
          de quem chega e se corta o de quem sai.
        </p>
      </header>

      {criada && (
        <div className="mb-5 rounded-2xl border-2 border-emerald-700 bg-emerald-950/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
            {criada.trocouSenha ? "Senha trocada" : "Acesso criado"}
          </p>
          <p className="mt-1 text-sm text-emerald-100">
            <strong>{criada.nome}</strong> · {criada.email} ·{" "}
            {tipoDe(criada.papel)?.rotulo ?? criada.papel}
          </p>

          {/* ⚠️ O texto muda conforme a senha foi sorteada ou digitada. "Aparece
              uma vez só" é verdade para a sorteada e mentira para a escolhida —
              e uma tela que avisa de um perigo que não existe treina a pessoa a
              ignorar o próximo aviso, que pode ser real. */}
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-emerald-400">
            {criada.foiEscolhida ? "A senha que você escolheu" : "A senha — ela aparece uma vez só"}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="select-all rounded-lg bg-gray-950 px-3 py-2 text-base font-semibold tracking-wide text-white">
              {criada.senha}
            </code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(criada.senha).then(() => setCopiou(true));
              }}
              className="rounded-lg border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-900/40"
            >
              {copiou ? "Copiado" : "Copiar"}
            </button>
          </div>
          <p className="mt-2 max-w-[62ch] text-xs leading-relaxed text-emerald-200/70">
            {criada.foiEscolhida
              ? "Guardada só como código embaralhado — nem o sistema consegue lê-la de volta. Para trocar, é só cadastrar de novo com o mesmo e-mail."
              : "Não fica guardada em lugar nenhum. Passe para a pessoa agora. Se perder, crie de novo com o mesmo e-mail — a senha é trocada e a antiga para de valer."}
          </p>

          {/* ── ⚠️ ESTA SENHA É PROVISÓRIA, E A TELA TEM DE DIZER ISSO ───────
              Sem esta linha, quem cria acha que entregou o acesso final — e
              depois estranha quando a pessoa cai numa tela de trocar senha,
              achando que o sistema quebrou. */}
          <p className="mt-3 max-w-[62ch] rounded-lg bg-gray-950/60 px-3 py-2 text-xs leading-relaxed text-emerald-200/80">
            <strong>Ela é provisória.</strong> Só abre a tela onde a pessoa define a senha dela —
            não entra em mais nada.
            {criada.expiraEm !== undefined && (
              <> Vale até <strong>{new Date(criada.expiraEm).toLocaleString("pt-BR")}</strong>.</>
            )}
          </p>

          {/* ⭐ E se ela já foi entregue sozinha, quem criou não precisa fazer
              mais nada. Se NÃO foi, a tela diz — e diz por quê, senão a pessoa
              não sabe se está esperando um recado que nunca vai chegar. */}
          {criada.avisoEntregue === true ? (
            <p className="mt-2 max-w-[62ch] text-xs leading-relaxed text-emerald-300">
              ✓ Já foi entregue na caixa do Dioli Connect dele. Você não precisa passar a senha.
            </p>
          ) : (
            criada.motivoDoAviso != null && (
              <p className="mt-2 max-w-[62ch] text-xs leading-relaxed text-amber-300/90">
                ⚠️ Não foi entregue na caixa ({criada.motivoDoAviso}). Passe a senha você mesmo.
              </p>
            )
          )}
        </div>
      )}

      {erro && (
        <p className="mb-4 rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {erro}
        </p>
      )}

      {/* ── A LISTA VEM PRIMEIRO ────────────────────────────────────────────
          Quem abre esta tela quase sempre vem conferir alguém que já existe.
          Cadastrar é a exceção. */}
      <section className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4">
        <h2 className="text-sm font-semibold text-gray-100">
          Quem tem acesso hoje{" "}
          <span className="font-normal text-gray-500">({fase.pessoas.length})</span>
        </h2>

        {fase.pessoas.length === 0 ? (
          <p className="mt-2 text-sm text-gray-400">
            Ninguém cadastrado ainda. Crie o primeiro acesso abaixo.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {fase.pessoas.map((p) => (
              <li
                key={p.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${
                  p.ativa ? "border-gray-800" : "border-gray-800/60 bg-gray-950/40"
                }`}
              >
                <span className="min-w-0">
                  <span
                    className={`block text-sm font-semibold ${
                      p.ativa ? "text-gray-100" : "text-gray-500 line-through"
                    }`}
                  >
                    {p.nome}
                  </span>
                  <span className="block truncate text-xs text-gray-500">
                    {p.email} · {tipoDe(p.papel)?.rotulo ?? p.papel} ·{" "}
                    {p.ultimoAcesso
                      ? `entrou ${quando(p.ultimoAcesso)}`
                      : "nunca entrou"}
                  </span>
                </span>

                <button
                  type="button"
                  onClick={() => void mudarAcesso(p)}
                  disabled={mexendo !== null}
                  className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                    p.ativa
                      ? "border-gray-700 text-gray-300 hover:bg-gray-800"
                      : "border-emerald-800 text-emerald-300 hover:bg-emerald-900/40"
                  }`}
                >
                  {mexendo === p.id ? "…" : p.ativa ? "Cortar acesso" : "Devolver acesso"}
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 max-w-[62ch] text-xs leading-relaxed text-gray-500">
          Cortar não apaga a pessoa: o acesso morre na hora e o histórico dela fica.
          O nome de quem atendeu cada cliente precisa continuar existindo depois que
          ela sai.
        </p>
      </section>

      {/* ── CADASTRAR ───────────────────────────────────────────────────── */}
      <section className="mt-4 rounded-2xl border border-gray-800 bg-gray-900/40 p-4">
        <h2 className="text-sm font-semibold text-gray-100">Cadastrar alguém</h2>

        <form onSubmit={criar} className="mt-3">
          <label className="block text-xs font-semibold text-gray-400" htmlFor="nome">
            Nome
          </label>
          <input
            id="nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Marina Souza"
            className="mt-1 w-full rounded-xl border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none focus:border-gray-600"
          />

          <label className="mt-3 block text-xs font-semibold text-gray-400" htmlFor="email">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="marina@foocci.com.br"
            className="mt-1 w-full rounded-xl border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none focus:border-gray-600"
          />

          {/* ── O CRACHÁ NO DIOLI CONNECT ────────────────────────────────────
              Preenchido, a senha provisória vai DIRETO para a caixa da pessoa,
              de máquina para máquina — sem passar pela tela de ninguém.

              ⚠️ Opcional: a maior parte de quem trabalha aqui não tem crachá no
              Connect, e exigir o campo travaria a criação de acesso de gente. */}
          <label className="mt-3 block text-xs font-semibold text-gray-400" htmlFor="crachaConnect">
            Crachá no Dioli Connect{" "}
            <span className="font-normal text-gray-500">
              — opcional. Preenchido, a senha vai direto para a caixa dele.
            </span>
          </label>
          <input
            id="crachaConnect"
            type="text"
            value={crachaConnect}
            onChange={(e) => setCrachaConnect(e.target.value)}
            placeholder="dioli.control-room.diretoria.diretor-geral"
            className="mt-1 w-full rounded-xl border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none focus:border-gray-600"
          />

          {/* ── A SENHA ──────────────────────────────────────────────────────
              Pedido do CEO em 27/08/2026: poder escolher, porque senha sorteada
              é impossível de guardar e acaba num post-it.

              Vazio continua sorteando de propósito — quem cria dez acessos numa
              tarde não quer inventar dez senhas, e senha inventada em série é a
              mais fraca que existe ("Foocci1", "Foocci2"...).                */}
          <label className="mt-3 block text-xs font-semibold text-gray-400" htmlFor="senha">
            Senha{" "}
            <span className="font-normal text-gray-500">
              — deixe vazio para o sistema sortear uma
            </span>
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="senha"
              type={verSenha ? "text" : "password"}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="new-password"
              placeholder={`no mínimo ${MINIMO_DE_CARACTERES} caracteres`}
              className={`w-full rounded-xl border bg-gray-950 px-3 py-2 text-sm text-white outline-none ${
                problemaDaSenha ? "border-red-800 focus:border-red-600" : "border-gray-800 focus:border-gray-600"
              }`}
            />
            <button
              type="button"
              onClick={() => setVerSenha((v) => !v)}
              className="shrink-0 rounded-xl border border-gray-800 px-3 text-xs text-gray-300 hover:border-gray-600"
            >
              {verSenha ? "Ocultar" : "Ver"}
            </button>
          </div>
          {/* O aviso aparece enquanto ela digita, e não depois do clique. Levar
              um "não" no botão faz a pessoa recomeçar o formulário inteiro. */}
          {problemaDaSenha && <p className="mt-1 text-xs text-red-400">{problemaDaSenha}</p>}
          {!problemaDaSenha && senha.length > 0 && (
            <p className="mt-1 text-xs text-emerald-400">Essa senha serve.</p>
          )}

          <fieldset className="mt-4">
            <legend className="text-xs font-semibold text-gray-400">Tipo de acesso</legend>
            <div className="mt-2 flex flex-col gap-1.5">
              {fase.tipos.map((t) => (
                <label
                  key={t.papel}
                  className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 ${
                    papel === t.papel ? "border-gray-500 bg-gray-950" : "border-gray-800"
                  }`}
                >
                  <input
                    type="radio"
                    name="papel"
                    value={t.papel}
                    checked={papel === t.papel}
                    onChange={() => setPapel(t.papel)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-gray-100">{t.rotulo}</span>
                    <span className="block text-xs text-gray-500">{t.resumo}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* ── OS PODERES, ESCRITOS ────────────────────────────────────────
              O CEO pediu: "cada um tem os seus poderes, de poder fazer algo ou
              não". Sem isto, escolher o tipo é escolher uma palavra — e a
              diferença entre "gerente" e "diretor" viraria folclore, resolvido
              perguntando ao colega mais antigo. */}
          {escolhido && (
            <div className="mt-3 grid gap-3 rounded-xl border border-gray-800 bg-gray-950/60 p-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-500">
                  Pode
                </p>
                <ul className="mt-1 space-y-0.5">
                  {escolhido.pode.map((x) => (
                    <li key={x} className="text-xs leading-snug text-gray-300">
                      — {x}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-500">
                  Não pode
                </p>
                <ul className="mt-1 space-y-0.5">
                  {escolhido.naoPode.length === 0 ? (
                    <li className="text-xs leading-snug text-gray-500">— nada é bloqueado</li>
                  ) : (
                    escolhido.naoPode.map((x) => (
                      <li key={x} className="text-xs leading-snug text-gray-300">
                        — {x}
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          )}

          <button
            type="submit"
            // Não deixa enviar o que já se sabe que o servidor recusa: levar o "não"
            // no clique faz a pessoa reabrir o formulário inteiro.
            disabled={salvando || !nome.trim() || !email.trim() || Boolean(problemaDaSenha)}
            className="mt-4 w-full rounded-xl bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-200 disabled:opacity-50"
          >
            {salvando ? "Criando…" : "Criar acesso e mostrar a senha"}
          </button>
        </form>
      </section>

      <p className="mt-4 max-w-[64ch] text-xs leading-relaxed text-gray-500">
        Quem é do comercial entra em <strong className="text-gray-300">/comercial</strong> com
        o e-mail e a senha. O que cada pessoa enxerga lá dentro é decidido pelo tipo
        escolhido aqui — no servidor, não no menu.
      </p>
    </div>
  );
}

/** Há quanto tempo, em português curto. */
function quando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "em data desconhecida";

  const horas = (Date.now() - d.getTime()) / 3_600_000;
  if (horas < 1) return "agora há pouco";
  if (horas < 24) return `há ${Math.round(horas)} h`;
  const dias = Math.round(horas / 24);
  return `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}
