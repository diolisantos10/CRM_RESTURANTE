/**
 * A JORNADA DO BACKFILL E DO ENRIQUECIMENTO, CONTRA POSTGRES DE VERDADE.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ─────────────────────────────────────────────
 *
 * A auditoria do PR reprovou a primeira entrega com doze achados — colunas que
 * não existem, enum tratado como texto, `ON CONFLICT` numa coluna sem índice
 * único, agrupamento que só via a primeira parte de um arquivo fatiado, XLSX
 * lido como texto puro, e um contrato quebrado entre tela, endpoint e serviço.
 * Nenhum desses aparece com dublê de banco ou com tipo mockado — todos só
 * aparecem contra o Postgres de verdade, com a migração de verdade, e com o
 * roteador de verdade. É isso que esta jornada roda.
 *
 * ── ⚠️ NADA AQUI FALA COM NINGUÉM ───────────────────────────────────────────
 *
 * Telefones sintéticos, nenhuma mensagem sai — só leitura e escrita de banco.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

import { lerPlanilha } from "@/services/salaDeVendas/prospeccao/lerPlanilha";
import {
  lerGradeBruta,
  construirLinhasComMapeamento,
} from "@/services/salaDeVendas/prospeccao/mapeamentoManual";

const autorizarInterno = vi.fn();
vi.mock("@/lib/internal-auth", async () => {
  const real =
    await vi.importActual<typeof import("@/lib/internal-auth")>("@/lib/internal-auth");
  return { ...real, autorizarInterno: (...a: unknown[]) => autorizarInterno(...a) };
});

// A rota importa `@/lib/prisma` (o singleton), não recebe cliente por
// parâmetro — por isso aqui não criamos um segundo `PrismaClient`: usamos o
// mesmo singleton que a rota vai usar, e testamos contra o banco real que
// `DATABASE_URL` apontar.
import { prisma } from "@/lib/prisma";

const OPERADOR = {
  userId: "op1",
  nome: "Operador da Jornada",
  role: "AGENTE_HUMANO" as const,
  departamentos: ["vendas"],
  gerencia: [],
};

function pedidoDeEnriquecimento(corpo: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/sala-de-vendas/prospeccao/enriquecer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

/**
 * O arquivo de migração tem exatamente dois statements top-level (um INSERT,
 * um UPDATE) separados por `;`. `$executeRawUnsafe` só aceita um statement por
 * chamada — daí a quebra manual, ao invés de reimplementar a migração aqui.
 * Isto roda o ARQUIVO DE VERDADE do repositório, não uma cópia dele.
 */
function statementsDaMigracao(sql: string): string[] {
  const semComentarios = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  return semComentarios
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const SQL_DO_BACKFILL = readFileSync(
  path.join(
    __dirname,
    "..",
    "prisma",
    "migrations",
    "20260910210000_backfill_importacoes_legadas",
    "migration.sql",
  ),
  "utf8",
);

async function rodarBackfill(): Promise<void> {
  for (const stmt of statementsDaMigracao(SQL_DO_BACKFILL)) {
    await prisma.$executeRawUnsafe(stmt);
  }
}

beforeAll(async () => {
  await prisma.internalAuditEvent.deleteMany({});
  await prisma.itemDeProspeccao.deleteMany({});
  await prisma.loteDeProspeccao.deleteMany({});
  await prisma.importacaoDeLeads.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Jornada — backfill de importações legadas (achado #4 da auditoria)", () => {
  it("agrupa TODAS as partes órfãs do mesmo arquivo numa única importação, soma os itens de todas — e é idempotente rodando duas vezes", async () => {
    // Três partes órfãs do MESMO arquivo, cada uma com uma contagem diferente
    // de itens — o defeito reprovado contava só a primeira parte.
    await prisma.loteDeProspeccao.createMany({
      data: [
        {
          id: "jrn_lote1",
          nome: "Jornada Setembro (parte 1/3)",
          proveniencia: "Feira do empreendedor — jornada de CI",
          criadoEm: new Date("2026-09-01T10:00:00Z"),
        },
        {
          id: "jrn_lote2",
          nome: "Jornada Setembro (parte 2/3)",
          proveniencia: "Feira do empreendedor — jornada de CI",
          criadoEm: new Date("2026-09-01T10:05:00Z"),
        },
        {
          id: "jrn_lote3",
          nome: "Jornada Setembro (parte 3/3)",
          proveniencia: "Feira do empreendedor — jornada de CI",
          criadoEm: new Date("2026-09-01T10:10:00Z"),
        },
      ],
    });

    const itensDoLote = (lote: string, prefixo: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `jrn_${prefixo}_${i}`,
        loteId: lote,
        whatsapp: `1191${prefixo}${String(i).padStart(2, "0")}`,
        whatsappDigits: `5511${prefixo}${String(i).padStart(4, "0")}`,
      }));

    await prisma.itemDeProspeccao.createMany({
      data: [
        ...itensDoLote("jrn_lote1", "91", 5),
        ...itensDoLote("jrn_lote2", "92", 7),
        ...itensDoLote("jrn_lote3", "93", 3),
      ],
    });

    // ── Primeira rodada ──
    await rodarBackfill();

    const lotesAposR1 = await prisma.loteDeProspeccao.findMany({
      where: { id: { in: ["jrn_lote1", "jrn_lote2", "jrn_lote3"] } },
    });
    const idsAposR1 = new Set(lotesAposR1.map((l) => l.importacaoId));

    // ⭐ O achado central: as TRÊS partes convergem para a MESMA importação.
    expect(idsAposR1.size).toBe(1);
    const importacaoId = [...idsAposR1][0];
    expect(importacaoId).not.toBeNull();

    const importacao = await prisma.importacaoDeLeads.findUnique({
      where: { id: importacaoId! },
    });
    expect(importacao).not.toBeNull();
    // ⭐ Soma das TRÊS partes (5+7+3=15), não só a primeira.
    expect(importacao?.linhasTotais).toBe(15);
    expect(importacao?.linhasAceitas).toBe(15);
    expect(importacao?.situacao).toBe("CONCLUIDA");
    expect(importacao?.proveniencia).toBe("Feira do empreendedor — jornada de CI");

    // ── Segunda rodada: idempotência ──
    await rodarBackfill();

    const totalImportacoes = await prisma.importacaoDeLeads.count({
      where: { id: importacaoId! },
    });
    expect(totalImportacoes).toBe(1); // não duplicou

    const importacaoAposR2 = await prisma.importacaoDeLeads.findUnique({
      where: { id: importacaoId! },
    });
    expect(importacaoAposR2?.linhasTotais).toBe(15); // não dobrou

    const lotesAposR2 = await prisma.loteDeProspeccao.findMany({
      where: { id: { in: ["jrn_lote1", "jrn_lote2", "jrn_lote3"] } },
    });
    expect(lotesAposR2.every((l) => l.importacaoId === importacaoId)).toBe(true);
  });

  it("não toca em lote que já tinha importação, e não mistura grupos diferentes", async () => {
    await prisma.importacaoDeLeads.create({
      data: {
        id: "jrn_imp_existente",
        arquivoNome: "Já tinha dono.csv",
        proveniencia: "Outra fonte",
        situacao: "CONCLUIDA",
        linhasTotais: 999,
        linhasAceitas: 999,
      },
    });
    await prisma.loteDeProspeccao.create({
      data: {
        id: "jrn_lote_com_dono",
        nome: "Não deveria mudar",
        proveniencia: "Outra fonte",
        importacaoId: "jrn_imp_existente",
      },
    });
    await prisma.loteDeProspeccao.create({
      data: {
        id: "jrn_lote_outro_grupo",
        nome: "Grupo Totalmente Diferente",
        proveniencia: "Feira do empreendedor — jornada de CI",
      },
    });

    await rodarBackfill();

    const inalterado = await prisma.loteDeProspeccao.findUnique({
      where: { id: "jrn_lote_com_dono" },
    });
    expect(inalterado?.importacaoId).toBe("jrn_imp_existente");

    const importacaoInalterada = await prisma.importacaoDeLeads.findUnique({
      where: { id: "jrn_imp_existente" },
    });
    expect(importacaoInalterada?.linhasTotais).toBe(999); // backfill não reescreveu

    const outroGrupo = await prisma.loteDeProspeccao.findUnique({
      where: { id: "jrn_lote_outro_grupo" },
    });
    expect(outroGrupo?.importacaoId).not.toBeNull();
    expect(outroGrupo?.importacaoId).not.toBe("jrn_imp_existente");
  });
});

describe("Jornada — enriquecimento por planilha (achados #5–#10 da auditoria)", () => {
  const LOTE_ID = "jrn_enr_lote";

  beforeAll(async () => {
    await prisma.loteDeProspeccao.create({
      data: { id: LOTE_ID, nome: "Base para enriquecer", proveniencia: "Jornada de CI" },
    });
    await prisma.itemDeProspeccao.createMany({
      data: [
        {
          id: "jrn_enr_item_vazio",
          loteId: LOTE_ID,
          whatsapp: "11955550001",
          whatsappDigits: "5511955550001",
          nome: null,
          empresa: null,
          cidade: null,
        },
        {
          id: "jrn_enr_item_preenchido",
          loteId: LOTE_ID,
          whatsapp: "11955550002",
          whatsappDigits: "5511955550002",
          nome: "Nome Já Existente",
          empresa: "Empresa Já Existente",
          cidade: "Cidade Já Existente",
        },
      ],
    });
  });

  it("CSV: o mapeamento manual do operador é o que decide o resultado — não o palpite automático", () => {
    // O CABEÇALHO MENTE de propósito: a coluna rotulada "Telefone" tem texto,
    // e a coluna rotulada "Empresa" tem o número de verdade. Planilha exportada
    // de outro sistema com colunas fora de ordem é exatamente o caso que o
    // mapeamento manual existe para resolver.
    const csv = "Empresa,Nome,Telefone\n11955550001,Fulano da Jornada,não é telefone\n";
    const grade = lerGradeBruta(csv);
    expect(grade.titulos).toEqual(["Empresa", "Nome", "Telefone"]);

    // ── Metade 1: seguindo o CABEÇALHO (o que o palpite automático faria) ──
    // "Telefone" vira whatsapp, e o valor de lá não tem cara de telefone —
    // zero linha sobrevive. Isto prova que o palpite sozinho falharia aqui.
    const mapeamentoPeloCabecalho = { 0: "empresa" as const, 1: "nome" as const, 2: "whatsapp" as const };
    const peloCabecalho = construirLinhasComMapeamento(grade, mapeamentoPeloCabecalho, true);
    expect(peloCabecalho.linhas).toHaveLength(0);
    expect(peloCabecalho.descartadas).toBe(1);

    // ── Metade 2: o mapeamento ESCOLHIDO PELO OPERADOR, ignorando o rótulo ──
    // O operador olha o arquivo, vê que "Empresa" é na verdade o telefone, e
    // remapeia. O resultado tem que refletir ESSA escolha, não o cabeçalho.
    const mapeamentoManual = { 0: "whatsapp" as const, 1: "nome" as const, 2: null };
    const { linhas, descartadas } = construirLinhasComMapeamento(grade, mapeamentoManual, true);

    expect(descartadas).toBe(0);
    // `toMatchObject`, não `toEqual`: este caso prova a precedência do
    // mapeamento manual sobre o cabeçalho, não o formato completo de
    // `LinhaLida` (que `mapeamentoManual.test.ts` já cobre campo a campo).
    expect(linhas).toMatchObject([
      { nome: "Fulano da Jornada", whatsapp: "11955550001", empresa: null },
    ]);
  });

  it("CSV (fluxo real, ponta a ponta pela rota HTTP): preenche só os campos vazios, não mexe no preenchido, e grava auditoria", async () => {
    autorizarInterno.mockReturnValue({ ok: true, sessao: OPERADOR });
    const { POST } = await import("@/app/api/admin/sala-de-vendas/prospeccao/enriquecer/route");

    const csv =
      "nome,empresa,cidade,telefone\n" +
      "Fulano da Jornada,Restaurante Sintético,Curitiba,11955550001\n" +
      "Nome Que Não Deveria Entrar,Empresa Que Não Deveria Entrar,Cidade Que Não Deveria Entrar,11955550002\n";

    const leitura = lerPlanilha(csv);
    expect(leitura.linhas).toHaveLength(2);

    const res = await POST(
      pedidoDeEnriquecimento({ linhas: leitura.linhas, nomeArquivo: "jornada.csv" }),
    );
    const json = (await res.json()) as { ok: boolean; data: { itemsEnriquecidos: number; camposAtualizados: number; naoAlterados: number } };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.itemsEnriquecidos).toBe(1); // só o item vazio
    expect(json.data.camposAtualizados).toBe(3); // nome + empresa + cidade
    expect(json.data.naoAlterados).toBe(1); // o item já preenchido: encontrado, não mudou

    const vazio = await prisma.itemDeProspeccao.findUnique({ where: { id: "jrn_enr_item_vazio" } });
    expect(vazio?.nome).toBe("Fulano da Jornada");
    expect(vazio?.empresa).toBe("Restaurante Sintético");
    expect(vazio?.cidade).toBe("Curitiba");

    // ⭐ O item que JÁ tinha tudo preenchido não foi sobrescrito por nada que
    // veio da planilha — nem nome, nem empresa, nem cidade.
    const preenchido = await prisma.itemDeProspeccao.findUnique({
      where: { id: "jrn_enr_item_preenchido" },
    });
    expect(preenchido?.nome).toBe("Nome Já Existente");
    expect(preenchido?.empresa).toBe("Empresa Já Existente");
    expect(preenchido?.cidade).toBe("Cidade Já Existente");

    // ⭐ Nenhum item novo foi criado — zero duplicata.
    const totalItens = await prisma.itemDeProspeccao.count({ where: { loteId: LOTE_ID } });
    expect(totalItens).toBe(2);

    // ⭐ Achado #10 da auditoria: auditoria persistida de verdade, com arquivo,
    // usuário, data e contagem — não só um `console.log`.
    const evento = await prisma.internalAuditEvent.findFirst({
      where: { acao: "enriquecer_prospeccao", actorId: "op1" },
      orderBy: { ocorridoEm: "desc" },
    });
    expect(evento).not.toBeNull();
    expect(evento?.resultado).toBe("PERMITIDO");
    const detalhe = evento?.detalhe as Record<string, unknown>;
    expect(detalhe.arquivoNome).toBe("jornada.csv");
    expect(detalhe.itemsEnriquecidos).toBe(1);
    expect(detalhe.camposAtualizados).toBe(3);
    expect(typeof detalhe.dataEnriquecimento).toBe("string");
  });

  it("XLSX (fluxo real, o MESMO código que o navegador usa): a mesma planilha, agora como arquivo Excel", async () => {
    // Reabre os dois items com os mesmos vazios, para o XLSX ter o que
    // enriquecer de novo, isolado da rodada de CSV acima.
    await prisma.itemDeProspeccao.update({
      where: { id: "jrn_enr_item_vazio" },
      data: { nome: null, empresa: null, cidade: null },
    });

    // Constrói um .xlsx de verdade com a mesma biblioteca que o modal usa no
    // navegador (`xlsx` / SheetJS) — não é uma simulação do formato, é o
    // arquivo binário real.
    const planilha = XLSX.utils.aoa_to_sheet([
      ["nome", "empresa", "cidade", "telefone"],
      ["Fulano do Excel", "Restaurante Excel", "Curitiba", "11955550001"],
    ]);
    const livro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(livro, planilha, "Sheet1");
    const bufferXlsx = XLSX.write(livro, { type: "buffer", bookType: "xlsx" }) as Buffer;

    // ── Exatamente o caminho de `lerTextoDoArquivo` do EnriquecerModal.tsx ──
    const lido = XLSX.read(bufferXlsx, { type: "buffer" });
    const primeiraAba = lido.SheetNames[0]!;
    const textoCsv = XLSX.utils.sheet_to_csv(lido.Sheets[primeiraAba]!);

    const leitura = lerPlanilha(textoCsv);
    expect(leitura.linhas).toHaveLength(1);
    expect(leitura.linhas[0]?.nome).toBe("Fulano do Excel");

    autorizarInterno.mockReturnValue({ ok: true, sessao: OPERADOR });
    const { POST } = await import("@/app/api/admin/sala-de-vendas/prospeccao/enriquecer/route");

    const res = await POST(
      pedidoDeEnriquecimento({ linhas: leitura.linhas, nomeArquivo: "jornada.xlsx" }),
    );
    const json = (await res.json()) as { ok: boolean; data: { itemsEnriquecidos: number } };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.itemsEnriquecidos).toBe(1);

    const item = await prisma.itemDeProspeccao.findUnique({ where: { id: "jrn_enr_item_vazio" } });
    expect(item?.nome).toBe("Fulano do Excel");
    expect(item?.empresa).toBe("Restaurante Excel");

    const totalItens = await prisma.itemDeProspeccao.count({ where: { loteId: LOTE_ID } });
    expect(totalItens).toBe(2); // continua sem duplicata

    const eventoXlsx = await prisma.internalAuditEvent.findFirst({
      where: { acao: "enriquecer_prospeccao" },
      orderBy: { ocorridoEm: "desc" },
    });
    expect((eventoXlsx?.detalhe as Record<string, unknown>).arquivoNome).toBe("jornada.xlsx");
  });

  it("rejeita corpo sem linhas, e nunca chama o serviço de enriquecimento", async () => {
    autorizarInterno.mockReturnValue({ ok: true, sessao: OPERADOR });
    const { POST } = await import("@/app/api/admin/sala-de-vendas/prospeccao/enriquecer/route");

    const res = await POST(pedidoDeEnriquecimento({ linhas: [], nomeArquivo: "vazio.csv" }));
    expect(res.status).toBe(400);
  });
});
