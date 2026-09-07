/**
 * "Feliz aniversário" sai NO DIA — decisão do CEO, 06/09/2026.
 *
 * ─── O QUE ESTAVA ERRADO, medido contra Postgres real no raio-x ──────────────
 *
 * O segmento filtrava pelo MÊS inteiro, e o filtro rodava em JS DEPOIS do corte
 * de 500. Base de 1.200 clientes, dia 9 de setembro:
 *
 *     fazem aniversário no mês ....... 100
 *     fazem aniversário HOJE .......... 15
 *     a campanha devolvia ............. 40
 *     desses 40, faziam hoje ........... 6
 *
 * **34 de 40 mensagens diziam "Feliz aniversário" no dia errado**, cada uma
 * queimando um cupom do orçamento mensal — e 60 dos 100 aniversariantes do mês
 * eram inalcançáveis, porque o corte vinha antes do filtro.
 *
 * ─── O QUE ESTE ARQUIVO MEDE, e o que ele recusa medir ──────────────────────
 *
 * Não afirma que a função existe, nem que a consulta "tem o formato certo". Ele
 * pega o **SQL que sai** e confere o dia e o mês que vão nele — porque é isso
 * que decide quem recebe a mensagem. E confere a ORDEM: o dia filtra ANTES do
 * corte, senão a parede das 500 volta por outra porta.
 *
 * A ressalva honesta: `prisma` continua sendo dublê aqui, então isto prova o que
 * o banco RECEBE, não o que ele devolve. A prova de ponta a ponta contra
 * Postgres real está no raio-x de 06/09 e é ela que fecha o círculo.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  customer: { findMany: vi.fn(async () => [] as unknown[]) },
  restaurant: { findUnique: vi.fn(async () => ({ timezone: "America/Sao_Paulo" })) },
  campaignExecution: { findMany: vi.fn(async () => []) },
  order: { count: vi.fn(async () => 0), findFirst: vi.fn(async () => null) },
  conversation: { findUnique: vi.fn(async () => null), updateMany: vi.fn(async () => ({ count: 0 })) },
  restaurantCRMProfile: { findUnique: vi.fn(async () => null) },
  $queryRaw: vi.fn(async () => [] as { id: string }[]),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { resolveAudience } from "../CrmCampaignService";

const REST = "rest_1";

/** Junta o SQL e os parâmetros que o Prisma recebeu, na ordem. */
function sqlEnviado() {
  const [tpl, ...params] = db.$queryRaw.mock.calls[0] as unknown as [
    { strings?: string[] } | TemplateStringsArray,
    ...unknown[],
  ];
  const partes = Array.isArray(tpl) ? tpl : ((tpl as { strings?: string[] }).strings ?? []);
  return { sql: [...partes].join("?"), params };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.restaurant.findUnique.mockResolvedValue({ timezone: "America/Sao_Paulo" });
  db.$queryRaw.mockResolvedValue([]);
  db.customer.findMany.mockResolvedValue([]);
});

describe("o aniversário sai no dia, e não no mês", () => {
  it("⭐ o DIA vai na consulta — não é mais o mês inteiro", async () => {
    vi.setSystemTime(new Date("2026-09-09T15:00:00.000Z"));
    await resolveAudience(REST, "aniversariantes");

    expect(db.$queryRaw, "o dia não entrou na consulta").toHaveBeenCalledTimes(1);
    const { sql, params } = sqlEnviado();
    expect(sql).toContain("EXTRACT(MONTH");
    expect(sql).toContain("EXTRACT(DAY");
    // restaurantId, mês, dia — 9 de setembro.
    expect(params).toEqual([REST, 9, 9]);
    vi.useRealTimers();
  });

  it("⭐ o corte de 500 acontece DEPOIS do dia — a parede não volta por aqui", async () => {
    vi.setSystemTime(new Date("2026-09-09T15:00:00.000Z"));
    // 700 aniversariantes do dia: mais que o teto, para o corte ficar visível.
    db.$queryRaw.mockResolvedValue(
      Array.from({ length: 700 }, (_, i) => ({ id: `c${i}` })),
    );
    await resolveAudience(REST, "aniversariantes");

    const chamada = db.customer.findMany.mock.calls[0][0] as {
      where: { id?: { in: string[] } };
      take: number;
    };
    // A lista do dia inteira chega ao `where`; o `take` corta depois dela.
    expect(chamada.where.id?.in).toHaveLength(700);
    expect(chamada.take).toBe(500);

    /**
     * ⭐ E A CONSULTA DO DIA NÃO PODE TER TETO NENHUM.
     *
     * Esta asserção nasceu de uma MUTAÇÃO QUE SOBREVIVEU: pus um `LIMIT 500`
     * dentro do SQL — repondo exatamente a parede que este conserto derruba — e
     * as duas asserções acima continuaram verdes. Elas não podiam ver: o dublê
     * devolve o que o teste manda, independente do que o SQL pede.
     *
     * Enquanto `prisma` for dublê, o SQL é o único artefato real que sobra. A
     * prova de ponta a ponta continua sendo contra Postgres de verdade, e está
     * no raio-x de 06/09 — esta aqui é a rede que impede a regressão silenciosa.
     */
    const { sql } = sqlEnviado();
    expect(
      /\blimit\b/i.test(sql),
      "a consulta do dia ganhou um teto — a parede das 500 voltou por outra porta",
    ).toBe(false);
    vi.useRealTimers();
  });

  it("⭐ 'hoje' é o hoje DO RESTAURANTE, não o do servidor", async () => {
    // 23h30 de 9/9 em São Paulo = 02h30 de 10/9 em UTC. O servidor roda em UTC.
    // Sem o fuso da loja, o sistema parabenizaria os aniversariantes de AMANHÃ
    // durante as últimas três horas de todo dia.
    vi.setSystemTime(new Date("2026-09-10T02:30:00.000Z"));
    await resolveAudience(REST, "aniversariantes");

    const { params } = sqlEnviado();
    expect(params, "usou o dia do servidor em vez do dia da loja").toEqual([REST, 9, 9]);
    vi.useRealTimers();
  });

  it("restaurante sem fuso declarado cai em São Paulo, não em UTC", async () => {
    db.restaurant.findUnique.mockResolvedValue({ timezone: null } as never);
    vi.setSystemTime(new Date("2026-09-10T02:30:00.000Z"));
    await resolveAudience(REST, "aniversariantes");

    const { params } = sqlEnviado();
    expect(params).toEqual([REST, 9, 9]);
    vi.useRealTimers();
  });

  it("sem aniversariante hoje, ninguém é consultado e ninguém recebe", async () => {
    vi.setSystemTime(new Date("2026-09-09T15:00:00.000Z"));
    db.$queryRaw.mockResolvedValue([]);

    const publico = await resolveAudience(REST, "aniversariantes");

    expect(publico).toEqual([]);
    expect(
      db.customer.findMany,
      "consultou o banco à toa num dia sem aniversariante",
    ).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("a metade legítima: com aniversariante do dia, a consulta acontece", async () => {
    vi.setSystemTime(new Date("2026-09-09T15:00:00.000Z"));
    db.$queryRaw.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);

    await resolveAudience(REST, "aniversariantes");

    expect(db.customer.findMany).toHaveBeenCalledTimes(1);
    const chamada = db.customer.findMany.mock.calls[0][0] as { where: { id?: { in: string[] } } };
    expect(chamada.where.id?.in).toEqual(["c1", "c2"]);
    vi.useRealTimers();
  });
});
