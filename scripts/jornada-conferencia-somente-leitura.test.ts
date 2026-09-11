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
 * ── ⛔ CORREÇÃO CIRÚRGICA DE 11/09/2026 — "FUNCIONA COM O ENVIO DESLIGADO" ERA
 * MENTIRA, E ESTA JORNADA AGORA PROVA O CONTRÁRIO ────────────────────────────
 *
 * A primeira versão recebia `canalPronto` de quem chamava (a rota passava
 * `canalDeVendasPronto()`, que exige `FOOCCI_SDR_SEND_ENABLED`). Com a chave
 * desligada — o estado real de hoje — todo mundo era barrado como
 * `CANAL_INDISPONIVEL`, e a conferência mostrava zero elegíveis com a base
 * cheia de contatos bons. Esta jornada roda com `FOOCCI_SDR_SEND_ENABLED`
 * efetivamente desligado (`envioAutorizado: false`, o mesmo valor que
 * `isFoocciSdrSendEnabled()` devolveria) e prova que os contatos continuam
 * elegíveis — e que `capacidadeOperacionalAgora` fica em zero sozinho, sem
 * precisar reavaliar nenhum contato.
 *
 * ── ⚠️ NADA AQUI FALA COM NINGUÉM ───────────────────────────────────────────
 *
 * Dados sintéticos, telefones de teste. Nenhuma mensagem sai.
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

  it("2. ⭐⭐⭐ FUNCIONA COM O ENVIO DESLIGADO — a mentira que a correção fecha", async () => {
    // `canalConfigurado: false, envioAutorizado: false` — exatamente o estado
    // real de hoje (`FOOCCI_SDR_SEND_ENABLED` desligado, nenhum número
    // configurado). Nenhum ProspeccaoConfig criado ainda, então também é
    // "sem configuração nenhuma": `montarFilaDeProspeccao` devolveria fila
    // vazia aqui. A conferência não pode — é exatamente a pergunta que precisa
    // de resposta ANTES de ligar qualquer coisa.
    expect(await prisma.prospeccaoConfig.count()).toBe(0);

    const c = await conferirElegibilidadeReal(prisma, {
      canalConfigurado: false,
      envioAutorizado: false,
      agora: AGORA,
    });

    expect(c.pendentes).toBe(60);
    expect(c.elegiveisSeAtivar, "o envio desligado não pode barrar o CONTATO").toBe(60);
    expect(c.barrados).toBe(0);
    expect(c.itensAvaliados).toBe(60);
    expect(c.varreuTudo).toBe(true); // 60 < meta padrão de 2.000 — varredura completa
    expect(c.alvoDeElegiveis).toBe(2000);

    // O estado operacional é reportado como FATO — não como hipótese.
    expect(c.canalConfigurado).toBe(false);
    expect(c.envioAutorizado).toBe(false);
    expect(c.prospeccaoLigada).toBe(false);

    // Sem ProspeccaoConfig ainda, `tetoDoDia` é 0 — capacidadeAoAtivar também
    // seria 0 aqui por essa segunda razão (sem teto configurado, nada cabe).
    // O passo 6, adiante, isola a causa que importa: com teto configurado e
    // elegíveis de sobra, capacidadeAoAtivar fica POSITIVO e é só o envio
    // desligado que zera capacidadeOperacionalAgora.
    expect(
      c.capacidadeOperacionalAgora,
      "capacidade operacional agora tem que ser ZERO com o envio desligado",
    ).toBe(0);
  });

  it("3. ⭐⭐ a meta 'ao menos N' pára cedo, e diz honestamente que não varreu tudo", async () => {
    const c = await conferirElegibilidadeReal(prisma, {
      canalConfigurado: false,
      envioAutorizado: false,
      agora: AGORA,
      alvoDeElegiveis: 10,
    });

    expect(c.elegiveisSeAtivar).toBe(10);
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
      canalConfigurado: false,
      envioAutorizado: false,
      agora: AGORA,
      alvoDeElegiveis: 55,
    });

    expect(c.elegiveisSeAtivar).toBe(55);
    expect(c.itensAvaliados).toBe(55);
    expect(c.itensAvaliados).toBeGreaterThan(50);
  });

  it("5. a prévia amostral tem no máximo 50 itens, claramente rotulada como amostra", async () => {
    const c = await conferirElegibilidadeReal(prisma, {
      canalConfigurado: false,
      envioAutorizado: false,
      agora: AGORA,
    });
    expect(c.previaAmostral).toHaveLength(50);
    expect(c.itensAvaliados).toBe(60); // avaliou os 60; a amostra guarda só os 50 primeiros
  });

  it("6. ⭐⭐ prospecção PAUSADA, canal E envio LIGADOS — a conferência avalia de verdade, mas a capacidade agora zera", async () => {
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

    const c = await conferirElegibilidadeReal(prisma, {
      canalConfigurado: true,
      envioAutorizado: true,
      agora: AGORA,
    });
    expect(c.elegiveisSeAtivar, "a pausa zerou a conferência — ela devia ignorar o interruptor").toBe(60);
    expect(c.saldoDiario).toBe(2000);
    expect(c.saldoDaJanela).toBe(2000);
    expect(c.capacidadeAoAtivar).toBe(60); // min(60 elegíveis, saldo diário 2000, saldo da janela 2000)
    expect(c.prospeccaoLigada).toBe(false);
    expect(c.capacidadeOperacionalAgora, "a pausa também tem que zerar a capacidade agora").toBe(0);

    await prisma.prospeccaoConfig.update({
      where: { id: "singleton" },
      data: { pausadoEm: null, pausadoPor: null, motivo: null },
    });
  });

  it("7. capacidadeAoAtivar = min(elegíveis, saldo diário, saldo da janela Meta) — a fórmula exata", async () => {
    // `tetoDoDia` (config.limiteDiario) alimenta os DOIS saldos — o do dia
    // civil e o da janela da Meta (ver o comentário grande em `selecao.ts`).
    // Com ninguém abordado ainda hoje nem na janela, os dois saldos ficam
    // iguais ao teto configurado; o que este caso prova é que os ELEGÍVEIS
    // (60) são o número maior e não vencem — quem manda é o menor dos três.
    await prisma.prospeccaoConfig.update({ where: { id: "singleton" }, data: { limiteDiario: 5 } });

    const c = await conferirElegibilidadeReal(prisma, {
      canalConfigurado: true,
      envioAutorizado: true,
      agora: AGORA,
    });
    expect(c.elegiveisSeAtivar).toBe(60);
    expect(c.saldoDiario).toBe(5);
    expect(c.saldoDaJanela).toBe(5);
    expect(c.capacidadeAoAtivar).toBe(Math.min(c.elegiveisSeAtivar, c.saldoDiario, c.saldoDaJanela));
    expect(c.capacidadeAoAtivar).toBe(5);
    // Prospecção está ligada de novo (pausadoEm limpo no passo anterior) — a
    // capacidade agora acompanha a hipótese quando tudo está ligado.
    expect(c.prospeccaoLigada).toBe(true);
    expect(c.capacidadeOperacionalAgora).toBe(5);

    await prisma.prospeccaoConfig.update({ where: { id: "singleton" }, data: { limiteDiario: 2000 } });
  });

  it("8. ⭐⭐⭐ A PROVA CENTRAL — abrir/recarregar a conferência VÁRIAS VEZES não altera NADA", async () => {
    const itensAntes = await prisma.itemDeProspeccao.findMany({
      orderBy: { id: "asc" },
      select: { id: true, situacao: true, leadId: true, processadoEm: true },
    });
    const leadsAntes = await prisma.siteLead.count();
    const mensagensAntes = await prisma.leadMensagem.count();

    // Simula seis "aberturas de tela" seguidas — inclusive com metas e estados
    // operacionais diferentes (envio ligado e desligado), que fazem a
    // varredura percorrer quantidades diferentes de itens.
    for (const opcoes of [
      { canalConfigurado: false, envioAutorizado: false, alvoDeElegiveis: 2000 },
      { canalConfigurado: true, envioAutorizado: false, alvoDeElegiveis: 5 },
      { canalConfigurado: false, envioAutorizado: true, alvoDeElegiveis: 60 },
      { canalConfigurado: true, envioAutorizado: true, alvoDeElegiveis: 1 },
      { canalConfigurado: true, envioAutorizado: true, alvoDeElegiveis: 55 },
      { canalConfigurado: false, envioAutorizado: false, alvoDeElegiveis: 2000 },
    ]) {
      await conferirElegibilidadeReal(prisma, { ...opcoes, agora: AGORA });
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
    expect(await prisma.leadMensagem.count()).toBe(0); // nenhuma chamada de envio ocorreu
  });

  it("9. quem pediu silêncio some dos elegíveis e aparece nos barrados — mesma regra da rodada, mesmo com o envio desligado", async () => {
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

    const c = await conferirElegibilidadeReal(prisma, {
      canalConfigurado: false,
      envioAutorizado: false,
      agora: AGORA,
    });
    expect(c.elegiveisSeAtivar).toBe(59);
    expect(c.barrados).toBe(1);
    expect(c.pendentes).toBe(60); // opt-out barra, mas o item continua PENDENTE — não foi tocado

    // E, de novo, a leitura não pode ter promovido ninguém: o item continua
    // PENDENTE, sem leadId — só o SiteLead que este PRÓPRIO teste criou existe.
    expect((await prisma.itemDeProspeccao.findUniqueOrThrow({ where: { id: algum.id } })).situacao).toBe(
      "PENDENTE",
    );
    expect(await prisma.siteLead.count()).toBe(1);
  });
});

/**
 * ⭐⭐⭐ DESEMPENHO EM VOLUME — a prova de que a sequência de consultas por
 * contato não causa timeout numa Base fria do tamanho real.
 *
 * A auditoria pediu pelo menos 4.967 contatos sintéticos, com o tempo total
 * relatado. A carga é inserida com `createMany` (não via `importarLote`, que
 * faz uma consulta de casamento por linha — aqui o que se mede é
 * `conferirElegibilidadeReal`, não a importação, que já tem sua própria
 * jornada em `jornada-base-fria-ampliada.test.ts`).
 */
describe("Jornada — desempenho com a Base fria em volume real", () => {
  const TOTAL_DE_DESEMPENHO = 4967;

  it("10. varredura completa de 4.967 contatos termina em tempo hábil, sem timeout — e com o envio desligado", async () => {
    const lote = await prisma.loteDeProspeccao.create({
      data: {
        nome: "Lote de desempenho — jornada de CI",
        proveniencia: "Lista sintética de desempenho da jornada de CI. Nenhum contato real.",
        situacao: "LIBERADO",
        liberadoEm: new Date(),
        liberadoPor: "jornada-ci",
      },
    });

    // criadoEm estritamente crescente a partir de AGORA (execução real), para
    // que a ordenação `criadoEm asc` da varredura seja determinística mesmo
    // interposta com os itens dos passos 1–9.
    const base = Date.now();
    await prisma.itemDeProspeccao.createMany({
      data: Array.from({ length: TOTAL_DE_DESEMPENHO }, (_, i) => {
        const whatsapp = `119${String(20000000 + i).padStart(8, "0")}`;
        return {
          loteId: lote.id,
          nome: `Contato de desempenho ${i + 1}`,
          whatsapp,
          whatsappDigits: `55${whatsapp}`,
          situacao: "PENDENTE" as const,
          criadoEm: new Date(base + i),
        };
      }),
    });

    const pendentesTotais = await prisma.itemDeProspeccao.count({ where: { situacao: "PENDENTE" } });
    expect(pendentesTotais).toBeGreaterThanOrEqual(TOTAL_DE_DESEMPENHO);

    const inicio = Date.now();
    const c = await conferirElegibilidadeReal(prisma, {
      // Prova junto, em volume: funciona com o envio desligado.
      canalConfigurado: false,
      envioAutorizado: false,
      agora: AGORA,
      // Meta acima do total disponível força a varredura COMPLETA — não só os
      // primeiros 2.000 do padrão.
      alvoDeElegiveis: pendentesTotais + 1000,
    });
    const duracaoMs = Date.now() - inicio;

    // eslint-disable-next-line no-console
    console.log(
      `[jornada-conferencia-desempenho] ${c.itensAvaliados} itens avaliados em ${duracaoMs}ms ` +
        `(${(duracaoMs / c.itensAvaliados).toFixed(2)}ms/item), varreuTudo=${c.varreuTudo}, ` +
        `elegiveisSeAtivar=${c.elegiveisSeAtivar}, barrados=${c.barrados}`,
    );

    expect(c.itensAvaliados).toBe(pendentesTotais);
    expect(c.varreuTudo).toBe(true);
    expect(c.elegiveisSeAtivar).toBeGreaterThanOrEqual(TOTAL_DE_DESEMPENHO); // sem histórico, todos elegíveis
    expect(c.capacidadeOperacionalAgora).toBe(0); // envio desligado, mesmo em volume

    // Teto generoso, bem abaixo do testTimeout de 60s desta config — com folga
    // para não ficar frágil numa máquina mais lenta que a de CI.
    expect(duracaoMs).toBeLessThan(45_000);
  }, 60_000);
});
