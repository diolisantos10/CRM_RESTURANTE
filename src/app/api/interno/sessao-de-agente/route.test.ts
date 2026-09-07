import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const findUnique = vi.fn();
const update = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { internalUser: { findUnique: (...a: unknown[]) => findUnique(...a), update: (...a: unknown[]) => update(...a) } },
}));

import { POST } from "./route";
import { variavelDaChave } from "@/lib/agente-auth";
import { ACESSOS_DECLARADOS } from "@/services/organizacao/acessosDeclarados";

/**
 * ⛔⛔ A PORTA DO AGENTE, ponta a ponta.
 *
 * A cena que este arquivo existe para guardar é a 3: **a senha morre na
 * primeira entrada**. Sem ela, a provisória continuaria valendo — e ela viajou
 * por uma trilha append-only, ou seja, o texto dela fica escrito para sempre na
 * caixa do Connect. Segredo eternamente escrito que continua valendo é o pior
 * dos dois mundos.
 */

const DECLARADO = ACESSOS_DECLARADOS[0]!;
const VAR = variavelDaChave(DECLARADO.crachaConnect);
const SEGREDO = "chave-de-prova-da-rota-do-agente";

const CONTA = {
  id: "u1",
  nome: "Diretor Geral",
  role: "DIRETOR_FOOCCI",
  isActive: true,
  memberships: [{ isManager: true, department: { slug: "diretoria" } }],
};

function req(headers: Record<string, string>) {
  return {
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
  } as unknown as Parameters<typeof POST>[0];
}

const antes = process.env[VAR];

beforeEach(() => {
  vi.clearAllMocks();
  process.env[VAR] = SEGREDO;
  findUnique.mockResolvedValue(CONTA);
  update.mockResolvedValue({});
});

afterEach(() => {
  if (antes === undefined) delete process.env[VAR];
  else process.env[VAR] = antes;
});

describe("POST /api/interno/sessao-de-agente", () => {
  it("⭐ credencial certa devolve sessão, e o cookie sai", async () => {
    const res = await POST(
      req({ "x-foocci-agente": DECLARADO.crachaConnect, authorization: `Bearer ${SEGREDO}` }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // A largura é a que o CEO concedeu — a porta não escolhe papel.
    expect(body.papel).toBe("DIRETOR_FOOCCI");
    expect(res.headers.get("Set-Cookie") ?? "").toContain("Max-Age=");
  });

  it("⛔⛔ a senha MORRE na primeira entrada", async () => {
    await POST(req({ "x-foocci-agente": DECLARADO.crachaConnect, authorization: `Bearer ${SEGREDO}` }));

    const dados = update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    // `autenticarInterno` recusa quem não tem hash. Anular aqui é o que faz a
    // provisória — escrita para sempre numa trilha append-only — virar letra
    // morta, em vez de depender de uma data de validade.
    expect(dados.data.passwordHash, "⛔ a senha continuou valendo").toBeNull();
    expect(dados.data.deveTrocarSenha).toBe(false);
    expect(dados.data.senhaProvisoriaExpiraEm).toBeNull();
  });

  it("⛔ segredo errado: 401, e não toca no banco", async () => {
    const res = await POST(
      req({ "x-foocci-agente": DECLARADO.crachaConnect, authorization: "Bearer nao-e-a-chave" }),
    );
    expect(res.status).toBe(401);
    expect(findUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("⛔ crachá não declarado: 401 antes de qualquer consulta", async () => {
    const res = await POST(
      req({ "x-foocci-agente": "dioli.control-room.nao.declarado", authorization: `Bearer ${SEGREDO}` }),
    );
    expect(res.status).toBe(401);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("⛔ conta desativada leva a MESMA recusa, e não perde a senha", async () => {
    findUnique.mockResolvedValue({ ...CONTA, isActive: false });
    const res = await POST(
      req({ "x-foocci-agente": DECLARADO.crachaConnect, authorization: `Bearer ${SEGREDO}` }),
    );
    expect(res.status).toBe(401);
    // Anular a senha de quem foi desativado seria estragar a conta a partir de
    // uma chamada que nem deveria ter passado.
    expect(update).not.toHaveBeenCalled();
  });

  it("⛔ sem cabeçalho nenhum: 401", async () => {
    expect((await POST(req({}))).status).toBe(401);
  });

  it("a conta procurada é a DECLARADA, não uma busca pelo crachá no banco", async () => {
    await POST(req({ "x-foocci-agente": DECLARADO.crachaConnect, authorization: `Bearer ${SEGREDO}` }));
    const args = findUnique.mock.calls[0]?.[0] as { where: { email: string } };
    expect(args.where.email).toBe(DECLARADO.email.toLowerCase());
  });
});
