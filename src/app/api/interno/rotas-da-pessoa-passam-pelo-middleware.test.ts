import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * ⛔⛔ A LINHA DO MIDDLEWARE — a terceira vez que esta casa cai na mesma armadilha.
 *
 * ── O DANO, MEDIDO EM PRODUÇÃO EM 06/09/2026 ──────────────────────────────
 *
 * A troca obrigatória de senha subiu no #188 e foi reportada como pronta.
 * Estava morta. `/admin/trocar-senha` é público no middleware, então a tela
 * carregava normalmente; o POST para `/api/interno/senha` — que NÃO tinha
 * linha — levava o 401 genérico do middleware. Nenhuma linha do handler
 * chegava a rodar. Uma pessoa obrigada a trocar a senha não tinha como trocar.
 *
 * Medido assim, contra produção, antes do conserto:
 *
 *   POST https://foocci.com.br/api/interno/senha
 *   → 401 {"success":false,"error":"Unauthorized"}
 *
 * ⚠️ E o disfarce é o que torna isto caro: esse 401 PARECE a recusa da rota.
 * A rota também responde 401 quando não há sessão, com `{"ok":false,...}`. Quem
 * depura sem comparar o FORMATO conclui "minha credencial está errada" e passa
 * o dia trocando cabeçalho.
 *
 * ── O QUE ESTE ARQUIVO GUARDA ─────────────────────────────────────────────
 *
 * Que as rotas da pessoa da casa CHEGUEM a executar. Não que sejam abertas —
 * cada uma tem a própria trava, provada nos arquivos vizinhos. Aqui é só a
 * pergunta anterior a todas: *o handler roda?*
 */

const getToken = vi.hoisted(() => vi.fn(async () => null));
vi.mock("next-auth/jwt", () => ({ getToken }));

import { middleware } from "@/middleware";

const DA_SENHA = "/api/interno/senha";
const DO_AGENTE = "/api/interno/sessao-de-agente";

/**
 * ⭐ O caminho de controle: um vizinho que NÃO tem linha. Ele mede o "sem a
 * linha" de verdade, em vez de supor o que aconteceria.
 */
const SEM_LINHA = "/api/coisa-que-nao-tem-linha";

function chamar(caminho: string): NextRequest {
  return new NextRequest(`http://localhost:3000${caminho}`, {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": "application/json" },
    body: "{}",
  });
}

beforeEach(() => {
  getToken.mockClear();
  vi.stubEnv("NEXTAUTH_SECRET", "qualquer-coisa-para-o-getToken");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("⛔ as rotas da pessoa da casa chegam a executar", () => {
  it("a troca de senha passa, e o middleware nem consulta o token", async () => {
    const res = await middleware(chamar(DA_SENHA));
    // `NextResponse.next()` não carrega o 401; e o token nem é consultado,
    // porque a rota nunca dependeu da sessão de LOJISTA.
    expect(res.status).not.toBe(401);
    expect(getToken).not.toHaveBeenCalled();
  });

  it("a porta do agente passa, e o middleware nem consulta o token", async () => {
    const res = await middleware(chamar(DO_AGENTE));
    expect(res.status).not.toBe(401);
    expect(getToken).not.toHaveBeenCalled();
  });

  it("⭐ e o vizinho SEM linha leva o 401 genérico — a medição do dano", async () => {
    const res = await middleware(chamar(SEM_LINHA));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Unauthorized" });
    // A prova de que a diferença é a linha, e não outra coisa qualquer.
    expect(getToken).toHaveBeenCalled();
  });

  it("⚠️ o 401 do middleware tem FORMATO diferente do 401 da rota", async () => {
    const doMiddleware = await (await middleware(chamar(SEM_LINHA))).json();
    // A rota responde `{ok:false, error:"não autorizado"}`. O middleware
    // responde `{success:false, error:"Unauthorized"}`. Guardar a diferença é o
    // que permite, no próximo incidente, saber em UMA olhada se o handler
    // chegou a rodar.
    expect(doMiddleware).toHaveProperty("success", false);
    expect(doMiddleware).not.toHaveProperty("ok");
  });
});
