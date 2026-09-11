/**
 * A JORNADA DA CONFERÊNCIA, PONTA A PONTA, CONTRA POSTGRES DE VERDADE.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ─────────────────────────────────────────────
 *
 * Correção pós-merge do PR #238: a primeira versão da tela de conferência
 * (a que existia antes de `montarFilaDeProspeccao` virar somente leitura)
 * consumia a lista só de ser aberta. A régua que ficou: **nenhuma leitura pode
 * escrever**. Esta jornada é a prova disso para `conferirElegibilidadeReal`
 * (`selecao.ts`) — chamada várias vezes seguidas, simulando abrir e recarregar
 * a tela — contra um banco real, e não contra dublê.
 *
 * Ela também prova o que a auditoria pediu explicitamente: que a conferência
 * funciona com a prospecção pausada (não devolve vazio como
 * `montarFilaDeProspeccao` devolveria), que a varredura vai além dos 50
 * primeiros para confirmar uma meta de elegíveis, e que ela diz honestamente
 * quando parou cedo (`varreuTudo: false`) versus quando esgotou a base
 * (`varreuTudo: true`).
 *
 * ── ⚠️ NADA AQUI FALA COM NINGUÉM ───────────────────────────────────────────
 *
 * Dados sintéticos, telefones de teste, canal desligado nas etapas onde não é
 * o que se está medindo. Nenhuma mensagem sai.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { importarLote } from "@/services/salaDeVendas/prospeccao/lote";
import { conferirElegibilidadeReal } from "@/services/salaDeVendas/prospeccao/selecao";

const prisma = new PrismaClient();

/** Quarta-feira, 14h em São Paulo: dentro da janela, para não misturar causas. */
const AGORA = new Date("2026-09-02T17:00:00Z");

/** 60 números válidos e distintos — mais que a amostra (50), menos que a meta padrão (2.000). */
function linhasSinteticas(quantas: number) {
  return Array.from({ length: quantas }, (_, i) => ({
    whatsapp: `119${String(10000000 + i).padStart(8, "0")}`,
    nome: `Contato sintético ${i + 1}`,
  }));
}

beforeAll(async () => {
  await prisma.itemDeProspeccao.deleteMany({});
  await prisma.loteDeProspeccao.deleteMany({});
  await prisma.prospeccaoConfig.deleteMany({});
  await prisma.leadMensagem.deleteMany({});
  await prisma.siteLead.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Jornada — conferência somente leitura da Base fria", () => {
  it("1. sessenta contatos válidos entram na Base fria, todos PENDENTE", async () => {
    const r = await importarLote(prisma, {
      nome: "Lote da conferência — jornada de CI",
      proveniencia: "Lista sintética criada pela jornada de CI. Nenhum contato real.",
      criadoPor: "jornada-ci",
      limiteDiario: 100,
      linhas: linhasSinteticas(60),
    });

    expect(r.aceitas).toBe(60);
    expect(await prisma.itemDeProspeccao.count({ where: { situacao: "PENDENTE" } })).toBe(60);
  });

  it("2. ⭐ funciona SEM configuração nenhuma — não é 'sem config = fila vazia'", async () => {
    // Nenhum ProspeccaoConfig criado ainda. `montarFilaDeProspeccao` devolveria
    // fila vazia aqui ("Prospecção desligada."). A conferência não pode: é
    // exatamente a pergunta que precisa de resposta ANTES de ligar.
    expect(await prisma.prospeccaoConfig.count()).toBe(0);

    const c = await conferirElegibilidadeReal(prisma, { canalPronto: true, agora: AGORA });

    expect(c.pendentes).toBe(60);
    expect(c.elegiveis).toBe(60); // sem histórico nenhum, todos elegíveis
    expect(c.barrados).toBe(0);
    expect(c.itensAvaliados).toBe(60);
    expect(c.varreuTudo).toBe(true); // 60 < meta padrão de 2.000 — varredura completa
    expect(c.alvoDeElegiveis).toBe(2000);
  });

  it("3. ⭐⭐ a meta 'ao menos N' pára cedo, e diz honestamente que não varreu tudo", async () => {
    const c = await conferirElegibilidadeReal(prisma, {
      canalPronto: true,
      agora: AGORA,
      alvoDeElegiveis: 10,
    });

    expect(c.elegiveis).toBe(10);
    expect(c.itensAvaliados).toBe(10); // parou assim que confirmou a meta — não os 60
    expect(c.varreuTudo).toBe(false); // sobraram 50 pendentes nunca avaliados nesta chamada
    expect(c.pendentes).toBe(60); // o TOTAL continua exato — é contagem direta, não a varredura
  });

  it("4. ⭐ a varredura NÃO se limita aos 50 primeiros pendentes", async () => {
    // Meta maior que a amostra: se a função limitasse a análise aos 50
    // primeiros (o defeito que a auditoria pediu para não repetir), o alvo de
    // 55 nunca seria confirmado — só existem 60 pendentes, e ela teria que
    // olhar além do tamanho da amostra para chegar lá.
    const c = await conferirElegibilidadeReal(prisma, {
      canalPronto: true,
      agora: AGORA,
      alvoDeElegiveis: 55,
    });

    expect(c.elegiveis).toBe(55);
    expect(c.itensAvaliados).toBe(55);
    expect(c.itensAvaliados).toBeGreaterThan(50);
  });

  it("5. a prévia amostral tem no máximo 50 itens, claramente rotulada como amostra", async () => {
    const c = await conferirElegibilidadeReal(prisma, { canalPronto: true, agora: AGORA });
    expect(c.previaAmostral).toHaveLength(50);
    expect(c.itensAvaliados).toBe(60); // avaliou os 60; a amostra guarda só os 50 primeiros
  });

  it("6. ⭐⭐ prospecção PAUSADA — a conferência continua avaliando de verdade", async () => {
    await prisma.prospeccaoConfig.create({
      data: {
        id: "singleton",
        outboundLigado: true,
        limiteDiario: 2000,
        atualizadoPor: "jornada-ci",
        pausadoEm: new Date(),
        pausadoPor: "jornada-ci",
        motivo: "pausa da jornada",
      },
    });

    const c = await conferirElegibilidadeReal(prisma, { canalPronto: true, agora: AGORA });
    expect(c.elegiveis, "a pausa zerou a conferência — ela devia ignorar o interruptor").toBe(60);
    expect(c.saldoDiario).toBe(2000);
    expect(c.saldoDaJanela).toBe(2000);
    expect(c.capacidadeReal).toBe(60); // min(60 elegíveis, saldo diário 2000, saldo da janela 2000)

    await prisma.prospeccaoConfig.update({
      where: { id: "singleton" },
      data: { pausadoEm: null, pausadoPor: null, motivo: null },
    });
  });

  it("7. capacidadeReal = min(elegíveis, saldo diário, saldo da janela Meta) — a fórmula exata", async () => {
    // `tetoDoDia` (config.limiteDiario) alimenta os DOIS saldos — o do dia
    // civil e o da janela da Meta (ver o comentário grande em `selecao.ts`).
    // Com ninguém abordado ainda hoje nem na janela, os dois saldos ficam
    // iguais ao teto configurado; o que este caso prova é que os ELEGÍVEIS
    // (60) são o número maior e não vencem — quem manda é o menor dos três.
    await prisma.prospeccaoConfig.update({ where: { id: "singleton" }, data: { limiteDiario: 5 } });

    const c = await conferirElegibilidadeReal(prisma, { canalPronto: true, agora: AGORA });
    expect(c.elegiveis).toBe(60);
    expect(c.saldoDiario).toBe(5);
    expect(c.saldoDaJanela).toBe(5);
    expect(c.capacidadeReal).toBe(Math.min(c.elegiveis, c.saldoDiario, c.saldoDaJanela));
    expect(c.capacidadeReal).toBe(5);

    await prisma.prospeccaoConfig.update({ where: { id: "singleton" }, data: { limiteDiario: 2000 } });
  });

  it("8. ⭐⭐⭐ A PROVA CENTRAL — abrir/recarregar a conferência VÁRIAS VEZES não altera NADA", async () => {
    const itensAntes = await prisma.itemDeProspeccao.findMany({
      orderBy: { id: "asc" },
      select: { id: true, situacao: true, leadId: true, processadoEm: true },
    });
    const leadsAntes = await prisma.siteLead.count();
    const mensagensAntes = await prisma.leadMensagem.count();

    // Simula seis "aberturas de tela" seguidas — inclusive com metas diferentes,
    // que fazem a varredura percorrer quantidades diferentes de itens.
    for (const alvo of [2000, 5, 60, 1, 55, 2000]) {
      await conferirElegibilidadeReal(prisma, { canalPronto: true, agora: AGORA, alvoDeElegiveis: alvo });
    }

    const itensDepois = await prisma.itemDeProspeccao.findMany({
      orderBy: { id: "asc" },
      select: { id: true, situacao: true, leadId: true, processadoEm: true },
    });

    expect(itensDepois).toEqual(itensAntes);
    expect(itensDepois.every((i) => i.situacao === "PENDENTE" && i.leadId === null)).toBe(true);
    expect(await prisma.siteLead.count()).toBe(leadsAntes);
    expect(await prisma.siteLead.count()).toBe(0);
    expect(await prisma.leadMensagem.count()).toBe(mensagensAntes);
  });

  it("9. quem pediu silêncio some dos elegíveis e aparece nos barrados — mesma regra da rodada", async () => {
    const algum = await prisma.itemDeProspeccao.findFirstOrThrow({
      where: { situacao: "PENDENTE" },
      orderBy: { criadoEm: "asc" },
    });

    await prisma.siteLead.create({
      data: {
        nome: "Pediu silêncio",
        whatsapp: algum.whatsapp,
        whatsappDigits: algum.whatsappDigits,
        fonte: "MANUAL",
        optOutAt: new Date("2026-08-01T12:00:00Z"),
        optOutCanal: "jornada-ci",
      },
    });

    const c = await conferirElegibilidadeReal(prisma, { canalPronto: true, agora: AGORA });
    expect(c.elegiveis).toBe(59);
    expect(c.barrados).toBe(1);
    expect(c.pendentes).toBe(60); // opt-out barra, mas o item continua PENDENTE — não foi tocado

    // E, de novo, a leitura não pode ter promovido ninguém: o item continua
    // PENDENTE, sem leadId — só o SiteLead que este PRÓPRIO teste criou existe.
    expect(algum && (await prisma.itemDeProspeccao.findUniqueOrThrow({ where: { id: algum.id } })).situacao).toBe(
      "PENDENTE",
    );
    expect(await prisma.siteLead.count()).toBe(1);
  });
});
