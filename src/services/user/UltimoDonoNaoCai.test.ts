/**
 * O último dono ativo de um restaurante não pode ser derrubado.
 *
 * ─── O QUE ESTAVA ABERTO ────────────────────────────────────────────────────
 * `UserService.update` e `UserService.deactivate` escreviam sem nunca ler o
 * papel do alvo. Três chamadas comuns esvaziavam o quadro de donos de uma loja:
 *
 *   PATCH /api/users/:id  { isActive: false }   num OWNER ativo
 *   PATCH /api/users/:id  { role: "STAFF"   }   num OWNER ativo
 *   DELETE /api/users/:id                       num OWNER ativo
 *
 * Qualquer MANAGER logado fazia as três. A única trava que existia — "você não
 * pode desativar a própria conta" — não pegava nenhuma: ela mora só no
 * `deactivate`, e o PATCH passa por fora dela.
 *
 * ─── POR QUE ISSO É SEGURANÇA, E NÃO SÓ UM DEFEITO DE TELA ─────────────────
 * Restaurante ativo e sem dono ativo é a condição EXATA que destranca a rota
 * pública `/api/recover`, que cria conta de OWNER sem autenticação nenhuma. Quem
 * tira o último dono não tranca só o dono para fora: abre a porta para quem
 * chegar primeiro na internet.
 *
 * ─── AS DUAS METADES ────────────────────────────────────────────────────────
 * Cada caso aqui prova a trava E o caminho legítimo. Uma trava que recusa tudo
 * não é conserto — é outro defeito, e passaria num teste que só olha o erro.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => {
  const d = {
    user: {
      findUnique: vi.fn(),
      update:     vi.fn(async () => ({ id: "u_dono", password: "hash", name: "Dona Ana", role: "STAFF", isActive: false })),
    },
    $queryRaw:    vi.fn(async () => [] as { id: string }[]),
    $transaction: vi.fn(),
  };
  d.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(d) : Promise.all(arg as unknown[]),
  );
  return d;
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { UserService } from "./UserService";

const LOJA = "rest_1";
const DONO = "u_dono";
const OUTRO_DONO = "u_dono2";
const GERENTE = "u_gerente";

/** O SQL que foi ao banco, com os parâmetros na ordem. */
function sqlEnviado() {
  const [tpl] = db.$queryRaw.mock.calls[0] as unknown as [{ strings?: string[] } | TemplateStringsArray];
  const partes = Array.isArray(tpl) ? tpl : ((tpl as { strings?: string[] }).strings ?? []);
  return [...partes].join("?");
}

function nadaFoiEscrito() {
  expect(db.user.update, "derrubou o último dono da loja").not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue({ id: DONO, restaurantId: LOJA, role: "OWNER" });
  // Por padrão: UM único dono ativo, e ele é o alvo.
  db.$queryRaw.mockResolvedValue([{ id: DONO }]);
});

describe("o único dono não cai", () => {
  it("⭐ PATCH { isActive: false } no único dono é recusado, e nada é escrito", async () => {
    const r = await UserService.update(LOJA, DONO, { isActive: false });

    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(String(r.error)).toContain("único dono ativo");
    nadaFoiEscrito();
  });

  it("⭐ PATCH { role: 'STAFF' } no único dono é recusado — rebaixar é o mesmo que tirar", async () => {
    const r = await UserService.update(LOJA, DONO, { role: "STAFF" });

    expect(r.ok).toBe(false);
    nadaFoiEscrito();
  });

  it("⭐ DELETE no único dono é recusado", async () => {
    const r = await UserService.deactivate(LOJA, DONO, GERENTE);

    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    nadaFoiEscrito();
  });

  it("rebaixar para MANAGER também conta como tirar o dono", async () => {
    const r = await UserService.update(LOJA, DONO, { role: "MANAGER" });
    expect(r.ok).toBe(false);
    nadaFoiEscrito();
  });
});

describe("a metade legítima — a trava não pode virar 'recusa tudo'", () => {
  it("⭐ com DOIS donos ativos, desativar um passa", async () => {
    db.$queryRaw.mockResolvedValue([{ id: DONO }, { id: OUTRO_DONO }]);

    const r = await UserService.deactivate(LOJA, DONO, GERENTE);

    expect(r.ok, "recusou mesmo havendo outro dono ativo").toBe(true);
    expect(db.user.update).toHaveBeenCalledTimes(1);
  });

  it("⭐ desativar quem NÃO é dono passa — o alvo nem está na lista de donos", async () => {
    db.user.findUnique.mockResolvedValue({ id: GERENTE, restaurantId: LOJA, role: "MANAGER" });
    db.$queryRaw.mockResolvedValue([{ id: DONO }]); // o único dono é outra pessoa

    const r = await UserService.deactivate(LOJA, GERENTE, DONO);

    expect(r.ok).toBe(true);
    expect(db.user.update).toHaveBeenCalledTimes(1);
  });

  it("trocar só o NOME do único dono passa, e nem consulta a lista de donos", async () => {
    const r = await UserService.update(LOJA, DONO, { name: "Ana Maria" });

    expect(r.ok).toBe(true);
    expect(db.user.update).toHaveBeenCalledTimes(1);
    expect(db.$queryRaw, "travou linha à toa numa mudança inofensiva").not.toHaveBeenCalled();
  });

  it("promover alguém A dono nunca é barrado", async () => {
    db.user.findUnique.mockResolvedValue({ id: GERENTE, restaurantId: LOJA, role: "MANAGER" });

    const r = await UserService.update(LOJA, GERENTE, { role: "OWNER" });

    expect(r.ok).toBe(true);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("a corrida, e ela é o motivo de existir uma transação", () => {
  /**
   * ⭐ ESTA ASSERÇÃO É IRMÃ DA MUTAÇÃO DO `LIMIT` NO #192.
   *
   * O dublê devolve a lista que o teste mandar, aconteça o que acontecer com o
   * SQL — então nenhuma asserção sobre o RESULTADO consegue ver se o `FOR
   * UPDATE` saiu ou ficou. Com `prisma` dublê, o SQL é o único artefato real.
   *
   * E o que ele tranca é concreto: com dois donos e duas requisições ao mesmo
   * tempo, cada uma derrubando um, um `count` em READ COMMITTED vê o outro
   * ainda ativo. As duas passam. A loja fica sem dono, e a porta do `/recover`
   * abre — que é justamente o cenário que este arquivo existe para impedir.
   */
  it("⭐ a consulta dos donos TRAVA as linhas (FOR UPDATE)", async () => {
    await UserService.update(LOJA, DONO, { isActive: false });

    const sql = sqlEnviado();
    expect(/\bfor\s+update\b/i.test(sql), "a leitura dos donos não trava linha nenhuma").toBe(true);
    expect(sql).toMatch(/role::text\s*=\s*'OWNER'/i);
    expect(sql).toMatch(/"isActive"\s*=\s*true/i);
  });

  it("a verificação acontece DENTRO da transação, junto com a escrita", async () => {
    await UserService.deactivate(LOJA, DONO, GERENTE);
    expect(db.$transaction, "travar fora da transação não trava nada").toHaveBeenCalledTimes(1);
  });
});

describe("as travas que já existiam continuam de pé", () => {
  it("usuário de outro restaurante segue 404", async () => {
    db.user.findUnique.mockResolvedValue({ id: DONO, restaurantId: "outra_loja", role: "OWNER" });

    const r = await UserService.update(LOJA, DONO, { isActive: false });

    expect(r.status).toBe(404);
    nadaFoiEscrito();
  });

  it("ninguém desativa a própria conta", async () => {
    const r = await UserService.deactivate(LOJA, DONO, DONO);
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain("your own account");
  });
});
