import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET } from "./route";
import { variavelDaChave } from "@/lib/agente-auth";
import {
  ACESSOS_DECLARADOS,
  CAPACIDADES,
  type AcessoDeclarado,
} from "@/services/organizacao/acessosDeclarados";

/**
 * ⛔⛔ A PORTA SEM SESSÃO.
 *
 * A cena que este arquivo existe para guardar é a 1: **nenhum `Set-Cookie`**.
 * O cookie é exatamente o que a sala do Diretor Geral recusa; se um dia alguém
 * "melhorar" esta rota emitindo sessão junto, ela para de servir para a única
 * pessoa para quem foi construída — e o sintoma seria um bloqueio silencioso do
 * outro lado, sem erro nenhum deste.
 */

const DECLARADO = ACESSOS_DECLARADOS[0]!;
const VAR = variavelDaChave(DECLARADO.crachaConnect);
const SEGREDO = "chave-de-prova-sem-sessao";

function req(headers: Record<string, string>) {
  return {
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
  } as unknown as Parameters<typeof GET>[0];
}

const comCredencial = {
  "x-foocci-agente": DECLARADO.crachaConnect,
  authorization: `Bearer ${SEGREDO}`,
};

const antes = process.env[VAR];

beforeEach(() => {
  process.env[VAR] = SEGREDO;
});

afterEach(() => {
  if (antes === undefined) delete process.env[VAR];
  else process.env[VAR] = antes;
});

describe("GET /api/interno/agente/quem-sou", () => {
  it("⛔⛔ NÃO emite cookie — é a razão de existir da rota", async () => {
    const res = await GET(req(comCredencial));
    expect(res.status).toBe(200);
    // A sala que esta rota atende recusa o ato de virar usuário logado. Um
    // Set-Cookie aqui a mataria em silêncio, do outro lado, sem erro deste.
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect((await res.json()).sessao).toBeNull();
  });

  it("⭐ devolve identidade e o próprio alcance", async () => {
    const body = await (await GET(req(comCredencial))).json();
    expect(body.ok).toBe(true);
    expect(body.cracha).toBe(DECLARADO.crachaConnect);
    expect(body.alcance).toEqual([...DECLARADO.alcance]);
  });

  it("⛔ credencial errada: 401", async () => {
    const res = await GET(
      req({ ...comCredencial, authorization: "Bearer nao-e-a-chave" }),
    );
    expect(res.status).toBe(401);
  });

  it("⛔ credencial boa e alcance que não declara a capacidade: 403", async () => {
    const semAlcance: AcessoDeclarado = { ...DECLARADO, alcance: [] };
    const original = ACESSOS_DECLARADOS[0];
    // A lista é `readonly` no tipo, não congelada em execução — trocar o item
    // aqui é o jeito honesto de medir a recusa sem inventar um segundo caminho.
    (ACESSOS_DECLARADOS as AcessoDeclarado[])[0] = semAlcance;
    try {
      const res = await GET(req(comCredencial));
      expect(res.status).toBe(403);
      // ⚠️ Alcance vazio é "não lê nada", nunca "lê tudo". Esquecer o campo não
      // pode virar acesso total por omissão.
      expect((await res.json()).alcance).toEqual([]);
    } finally {
      (ACESSOS_DECLARADOS as AcessoDeclarado[])[0] = original!;
    }
  });
});

describe("o alcance declarado", () => {
  it("⛔ toda capacidade declarada existe na lista fechada", () => {
    const validas = new Set<string>(CAPACIDADES);
    for (const a of ACESSOS_DECLARADOS) {
      for (const c of a.alcance) {
        // Capacidade inventada num arquivo de configuração é permissão que
        // ninguém revisou — e passaria calada, por não bater com nada.
        expect(validas.has(c), `capacidade desconhecida: ${c} (${a.email})`).toBe(true);
      }
    }
  });

  it("⚠️ o alcance NÃO é o papel — são decisões diferentes", () => {
    // O CEO escolheu o papel da CONTA antes de esta porta existir. Se um dia
    // alguém "simplificar" derivando o alcance do papel, esta cena cai.
    for (const a of ACESSOS_DECLARADOS) {
      expect(a.alcance).not.toContain(a.papel);
    }
  });
});
