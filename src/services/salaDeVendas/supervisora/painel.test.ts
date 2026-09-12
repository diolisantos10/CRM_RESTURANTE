/**
 * `painel.ts` — a agregação que alimenta as seções 1 e 2 do painel.
 *
 * Sem Postgres: um `db` de mentira que implementa só o subconjunto do Prisma
 * que estas funções usam. O objetivo aqui é a MATEMÁTICA da agregação — a
 * prova contra Postgres real de que as tabelas existem e as colunas batem já
 * é a jornada do backend (`scripts/jornada-supervisora.test.ts`).
 */

import { describe, it, expect, vi } from "vitest";
import { visaoGeralDaSupervisora, conversasEmRisco } from "./painel";

function linha(over: Partial<{
  leadId: string;
  veredito: "VERDE" | "AMARELO" | "VERMELHO" | "CRITICO";
  motivos: string[];
  bloqueada: boolean;
  acaoTomada: "NENHUMA" | "REESCREVEU" | "BLOQUEOU" | "BLOQUEOU_E_ESCALOU";
  handoffDisparado: boolean;
  falhaTecnica: boolean;
  criadaEm: Date;
}> = {}) {
  return {
    leadId: "lead-1",
    veredito: "VERDE" as const,
    motivos: [] as string[],
    bloqueada: false,
    acaoTomada: "NENHUMA" as const,
    handoffDisparado: false,
    falhaTecnica: false,
    criadaEm: new Date("2026-09-10T12:00:00Z"),
    ...over,
  };
}

describe("visaoGeralDaSupervisora", () => {
  it("soma cada coluna certa a partir das mesmas linhas — nenhuma tabela nova", async () => {
    const linhas = [
      linha({ leadId: "l1", veredito: "VERDE" }),
      linha({ leadId: "l1", veredito: "AMARELO", acaoTomada: "REESCREVEU" }),
      linha({ leadId: "l2", veredito: "VERMELHO", bloqueada: true, acaoTomada: "BLOQUEOU", motivos: ["PITCH_ERRADO"] }),
      linha({ leadId: "l3", veredito: "CRITICO", bloqueada: true, acaoTomada: "BLOQUEOU_E_ESCALOU", handoffDisparado: true, motivos: ["PROMESSA_INCORRETA", "PITCH_ERRADO"] }),
      linha({ leadId: "l4", veredito: "VERMELHO", falhaTecnica: true, bloqueada: true }),
    ];

    const findMany = vi.fn().mockResolvedValue(linhas);
    const count = vi.fn().mockResolvedValue(1);
    const db = { supervisoraAvaliacao: { findMany }, siteLead: { count } } as never;

    const r = await visaoGeralDaSupervisora(db, { de: new Date("2026-09-01"), ate: new Date("2026-09-11") });

    expect(r.mensagensAvaliadas).toBe(5);
    // l1 aparece duas vezes, l2/l3/l4 uma vez cada — 4 leads distintos.
    expect(r.conversasAcompanhadas).toBe(4);
    expect(r.mensagensCorrigidas).toBe(1);
    expect(r.mensagensBloqueadas).toBe(3);
    expect(r.escaladasParaGente).toBe(1);
    expect(r.falhasTecnicas).toBe(1);
    expect(r.porVeredito).toEqual({ VERDE: 1, AMARELO: 1, VERMELHO: 2, CRITICO: 1 });
    // PITCH_ERRADO aparece em l2 e l3 → 2; é o motivo mais frequente.
    expect(r.principaisRiscos[0]).toMatchObject({ motivo: "PITCH_ERRADO", total: 2 });

    // O count de opt-out é restrito aos leads QUE APARECERAM nas avaliações —
    // nunca a base inteira: prova de que não é uma segunda fonte solta.
    expect(count).toHaveBeenCalledWith({
      where: { id: { in: expect.arrayContaining(["l1", "l2", "l3", "l4"]) }, optOutAt: expect.anything() },
    });
  });

  it("sem nenhuma avaliação na janela, não chama siteLead.count — nada para restringir", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn();
    const db = { supervisoraAvaliacao: { findMany }, siteLead: { count } } as never;

    const r = await visaoGeralDaSupervisora(db, { de: new Date("2026-09-01"), ate: new Date("2026-09-02") });

    expect(r.conversasAcompanhadas).toBe(0);
    expect(r.optOuts).toBe(0);
    expect(count).not.toHaveBeenCalled();
  });
});

describe("conversasEmRisco", () => {
  it("só pede VERMELHO/CRÍTICO/bloqueada, mais recente primeiro (delegado ao orderBy)", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { supervisoraAvaliacao: { findMany }, internalUser: { findMany: vi.fn() } } as never;

    await conversasEmRisco(db, { limite: 10 });

    const args = findMany.mock.calls[0]![0];
    expect(args.where.OR).toEqual([{ bloqueada: true }, { veredito: { in: ["VERMELHO", "CRITICO"] } }]);
    expect(args.orderBy).toEqual({ criadaEm: "desc" });
    expect(args.take).toBe(10);
  });

  it("resolve o nome do autor por internalUser, e não deixa autor sem nome sem explicação", async () => {
    const linhas = [
      {
        id: "av1",
        leadId: "lead-1",
        autorUserId: "user-1",
        papelDoAgente: null,
        veredito: "VERMELHO",
        motivos: [],
        motivoDetalhe: "pitch errado",
        bloqueada: true,
        handoffDisparado: false,
        criadaEm: new Date(),
        lead: { nome: "Padaria X", whatsapp: "5511911112222", stage: "PRIMEIRO_CONTATO", atendidoPor: "IA", atendenteUserId: null },
      },
      {
        id: "av2",
        leadId: "lead-2",
        autorUserId: null,
        papelDoAgente: "qualificacao",
        veredito: "CRITICO",
        motivos: [],
        motivoDetalhe: null,
        bloqueada: true,
        handoffDisparado: true,
        criadaEm: new Date(),
        lead: { nome: "Pizzaria Y", whatsapp: "5511933334444", stage: "QUALIFICACAO", atendidoPor: "AGUARDANDO_HUMANO", atendenteUserId: null },
      },
    ];

    const db = {
      supervisoraAvaliacao: { findMany: vi.fn().mockResolvedValue(linhas) },
      internalUser: { findMany: vi.fn().mockResolvedValue([{ id: "user-1", nome: "Maria" }]) },
    } as never;

    const r = await conversasEmRisco(db, {});

    expect(r[0]!.autorNome).toBe("Maria");
    // TA sem autorUserId: nome fica null, e a tela usa `papelDoAgente` no lugar
    // (ver SupervisoraClient) — nunca inventa um nome de pessoa para a IA.
    expect(r[1]!.autorNome).toBeNull();
    expect(r[1]!.papelDoAgente).toBe("qualificacao");
  });
});
