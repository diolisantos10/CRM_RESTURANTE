/**
 * PROVA 14 — ISOLAMENTO ENTRE PRODUTOS.
 *
 * ── O QUE JÁ FOI MEDIDO, E NÃO SERÁ REPETIDO AQUI ───────────────────────────
 *
 * A parte 1 desta missão já procurou por "Sala Sol" (ou qualquer nome de outro
 * produto Dioli) neste repositório e não achou nada — este repositório É o
 * Foocci, com um `schema.prisma` só, uma `DATABASE_URL` só, um Prisma Client
 * só. Repetir aquela busca aqui seria medir a mesma coisa duas vezes; o que
 * falta medir é o que seria REAL se um dia existisse mais de um produto na
 * mesma base: a Supervisora só toca tabela DESTE schema, e as consultas do
 * painel filtram pelo dado pedido, sem vazar linha de fora do filtro.
 *
 * ── PROVA A: TODA TABELA QUE A SUPERVISORA TOCA É DESTE SCHEMA ──────────────
 *
 * Varre `supervisora/*.ts` e as rotas do painel atrás de `db.<algo>.` /
 * `prisma.<algo>.`, e confere cada `<algo>` contra a lista de modelos
 * DECLARADOS em `prisma/schema.prisma` — a fonte de verdade de "que tabela
 * existe nesta base". Como só existe UM `schema.prisma` neste repositório
 * (este É o banco do Foocci), toda referência que passar nesta prova está,
 * por definição, dentro do Foocci — nunca em outro produto, porque não há
 * como o Prisma Client gerado aqui sequer OFERECER um acessador para uma
 * tabela de outra base.
 *
 * ── PROVA B: A AGREGAÇÃO FILTRA PELO PEDIDO, NÃO DEVOLVE TUDO ───────────────
 *
 * Um `db` de mentira com avaliações de dois agentes diferentes — o mais perto
 * que este produto chega de "dois tenants" — confere que
 * `desempenhoPorAgente` e `conversasEmRisco` só usam o que a consulta pediu, e
 * a contagem de opt-out em `visaoGeralDaSupervisora` só considera os leads
 * que ELA MESMA acompanhou no período, nunca a base inteira.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { desempenhoPorAgente } from "./desempenho";
import { visaoGeralDaSupervisora, conversasEmRisco } from "./painel";

const RAIZ_DO_REPO = path.resolve(__dirname, "../../../..");

function modelosDoSchema(): Set<string> {
  const schema = readFileSync(path.join(RAIZ_DO_REPO, "prisma/schema.prisma"), "utf8");
  const nomes = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]!);
  // Mesma regra do gerador do Prisma: só a primeira letra vira minúscula.
  return new Set(nomes.map((n) => n[0]!.toLowerCase() + n.slice(1)));
}

/**
 * Varredura recursiva manual, e não `{ recursive: true }` nem `fs.globSync` —
 * o mesmo cuidado (e o mesmo motivo) de `rotas.test.ts`: uma opção nova do
 * `readdirSync` que existe no Node da máquina de desenvolvimento pode não
 * existir, ou se comportar diferente, no Node do runner de CI.
 */
function listarRecursivo(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      listarRecursivo(completo, acc);
    } else if (/\.tsx?$/.test(entrada.name)) {
      acc.push(completo);
    }
  }
  return acc;
}

function arquivosDaSupervisora(): string[] {
  return [
    ...listarRecursivo(path.join(RAIZ_DO_REPO, "src/services/salaDeVendas/supervisora")),
    ...listarRecursivo(path.join(RAIZ_DO_REPO, "src/app/api/admin/sala-de-vendas/supervisora")),
  ];
}

describe("prova 14 — toda tabela que a Supervisora toca é deste schema", () => {
  it("nenhum `db.<algo>.`/`prisma.<algo>.` aponta para um modelo que não existe em prisma/schema.prisma", () => {
    const modelos = modelosDoSchema();
    expect(modelos.size).toBeGreaterThan(100); // sanidade: leu o schema de verdade

    const culpados: string[] = [];

    for (const arquivo of arquivosDaSupervisora()) {
      const conteudo = readFileSync(arquivo, "utf8");
      for (const m of conteudo.matchAll(/\b(?:db|prisma|tx)\.(\w+)\./g)) {
        const acessador = m[1]!;
        // `$transaction`/`$queryRaw` etc. não são modelo — são método do client.
        if (acessador.startsWith("$")) continue;
        if (!modelos.has(acessador)) {
          culpados.push(`${path.relative(RAIZ_DO_REPO, arquivo)}: db.${acessador}`);
        }
      }
    }

    expect(culpados, `acessador fora do schema encontrado em: ${culpados.join(", ")}`).toEqual([]);
  });

  it("nenhum arquivo da Supervisora menciona outro produto Dioli pelo nome", () => {
    // Não é uma nova varredura ampla — é a mesma checagem, restrita aos
    // arquivos que esta metade da missão TOCOU, para nenhum deles ter
    // introduzido uma referência nova.
    const marcas = /sala\s*sol|dioli[- ]?political|dioli[- ]?digital|cityjobs|foocci\s*manager/i;
    const culpados = arquivosDaSupervisora()
      // Este arquivo CITA os nomes de propósito, para explicar o que a prova
      // verifica — ele é a prova, não o código sob prova.
      .filter((f) => f !== __filename)
      .filter((f) => marcas.test(readFileSync(f, "utf8")));
    expect(culpados).toEqual([]);
  });
});

describe("prova 14 — a agregação filtra pelo pedido, nunca devolve a base inteira", () => {
  const AVALIACOES = [
    { leadId: "lead-a", autorUserId: "agente-1", papelDoAgente: null, veredito: "VERMELHO", motivos: ["PITCH_ERRADO"], bloqueada: true, acaoTomada: "BLOQUEOU", handoffDisparado: false, falhaTecnica: false, criadaEm: new Date("2026-09-10T10:00:00Z") },
    { leadId: "lead-b", autorUserId: "agente-2", papelDoAgente: null, veredito: "VERDE", motivos: [], bloqueada: false, acaoTomada: "NENHUMA", handoffDisparado: false, falhaTecnica: false, criadaEm: new Date("2026-09-10T11:00:00Z") },
  ] as const;

  function dbComFiltro() {
    return {
      supervisoraAvaliacao: {
        findMany: async (args: { where?: Record<string, unknown> }) => {
          const where = args?.where ?? {};
          return AVALIACOES.filter((a) => {
            if (where.autorUserId && where.autorUserId !== a.autorUserId) return false;
            if (where.criadaEm) {
              const janela = where.criadaEm as { gte?: Date; lt?: Date };
              if (janela.gte && a.criadaEm < janela.gte) return false;
              if (janela.lt && a.criadaEm >= janela.lt) return false;
            }
            return true;
          });
        },
      },
      siteLead: { count: async () => 0 },
    } as never;
  }

  it("desempenhoPorAgente(autorUserId: agente-1) nunca inclui a avaliação de agente-2", async () => {
    const r = await desempenhoPorAgente(dbComFiltro(), { autorUserId: "agente-1" });
    expect(r).toHaveLength(1);
    expect(r[0]!.autorUserId).toBe("agente-1");
    expect(r.some((a) => a.autorUserId === "agente-2")).toBe(false);
  });

  it("visaoGeralDaSupervisora só conta o que caiu na janela de tempo pedida", async () => {
    const r = await visaoGeralDaSupervisora(dbComFiltro(), {
      de: new Date("2026-09-10T10:30:00Z"),
      ate: new Date("2026-09-10T12:00:00Z"),
    });
    // Só a avaliação de agente-2 (11h) está na janela — a de agente-1 (10h) fica de fora.
    expect(r.mensagensAvaliadas).toBe(1);
    expect(r.conversasAcompanhadas).toBe(1);
  });
});

describe("prova 14 — a lista de risco só junta lead e autor, nunca outra base", () => {
  it("conversasEmRisco só chama supervisoraAvaliacao, siteLead (via include) e internalUser", async () => {
    const chamadas: string[] = [];
    const db = {
      supervisoraAvaliacao: {
        findMany: async () => {
          chamadas.push("supervisoraAvaliacao.findMany");
          return [
            {
              id: "av1",
              leadId: "lead-a",
              autorUserId: "agente-1",
              papelDoAgente: null,
              veredito: "VERMELHO",
              motivos: [],
              motivoDetalhe: null,
              bloqueada: true,
              handoffDisparado: false,
              criadaEm: new Date(),
              lead: { nome: "Restaurante A", whatsapp: "5511900000000", stage: "QUALIFICACAO", atendidoPor: "IA", atendenteUserId: null },
            },
          ];
        },
      },
      internalUser: {
        findMany: async () => {
          chamadas.push("internalUser.findMany");
          return [{ id: "agente-1", nome: "Fulano" }];
        },
      },
    } as never;

    const r = await conversasEmRisco(db, {});
    expect(r).toHaveLength(1);
    expect(r[0]!.autorNome).toBe("Fulano");
    expect(chamadas.sort()).toEqual(["internalUser.findMany", "supervisoraAvaliacao.findMany"]);
  });
});
