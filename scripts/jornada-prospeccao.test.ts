/**
 * A JORNADA 3 DO P0, PONTA A PONTA, CONTRA POSTGRES DE VERDADE.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ─────────────────────────────────────────────
 *
 * Os testes unitários da prospecção usam dublê de banco. Dublê prova a REGRA e
 * não prova o ENCAIXE: um `where` malformado, uma coluna que não existe, um
 * enum que o banco não conhece, uma migration que não aplica — nada disso
 * aparece com mock, e tudo isso aparece na primeira vez que alguém abre a tela
 * em produção.
 *
 * Esta jornada roda o caminho inteiro contra um Postgres criado do zero, com as
 * migrations aplicadas de verdade. Se a migration não subir, ela falha aqui — e
 * não no boot do contêiner de produção, com o app já fora do ar.
 *
 * ── ⚠️ NADA AQUI FALA COM NINGUÉM ───────────────────────────────────────────
 *
 * Dados sintéticos, telefones de teste, canal desligado. Nenhuma mensagem sai —
 * a jornada mede a máquina, não o cliente.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { importarLote, liberarLote, pausarLote } from "@/services/salaDeVendas/prospeccao/lote";
import {
  montarFilaDeProspeccao,
  materializarLead,
} from "@/services/salaDeVendas/prospeccao/selecao";

const prisma = new PrismaClient();

/** Quarta-feira, 14h em São Paulo: dentro da janela, para não misturar causas. */
const AGORA = new Date("2026-09-02T17:00:00Z");

/** O que a importação devolveu — usado pelos passos seguintes. */
let loteId = "";

beforeAll(async () => {
  // A jornada precisa nascer do zero para medir o que mede.
  await prisma.itemDeProspeccao.deleteMany({});
  await prisma.loteDeProspeccao.deleteMany({});
  await prisma.prospeccaoConfig.deleteMany({});
  await prisma.leadMensagem.deleteMany({});
  await prisma.siteLead.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Jornada 3 — prospecção, ponta a ponta", () => {
  it("1. a lista entra com proveniência, deduplicada", async () => {
    const r = await importarLote(prisma, {
      nome: "Curitiba — teste sintético",
      proveniencia: "Lista sintética criada pela jornada de CI. Nenhum contato real.",
      criadoPor: "jornada-ci",
      limiteDiario: 5,
      linhas: [
        { whatsapp: "11987654321", nome: "Cantina Sintética", cidade: "Curitiba" },
        { whatsapp: "(11) 98765-4321", nome: "A mesma, repetida no arquivo" },
        { whatsapp: "11912345678", nome: "Segunda Cantina" },
        { whatsapp: "123", nome: "Telefone impossível" },
      ],
    });

    loteId = r.loteId;

    expect(r.recebidas).toBe(4);
    expect(r.repetidasNoArquivo).toBe(1);
    expect(r.invalidas).toBe(1);
    expect(r.aceitas).toBe(2);
  });

  it("2. importar NÃO autoriza: a prospecção nasce desligada", async () => {
    const fila = await montarFilaDeProspeccao(prisma, { canalPronto: true, agora: AGORA });
    expect(fila.liberados).toHaveLength(0);
    expect(fila.motivoDaFilaVazia).toContain("desligada");
  });

  /**
   * ⛔ ESTE PASSO MUDOU DE LADO EM 10/09/2026, POR ORDEM APROVADA.
   *
   * Ele exigia que o lote nascesse `RASCUNHO` e que, mesmo com a prospecção
   * ligada, ninguém entrasse na fila até alguém clicar "Liberar". A regra era
   * boa e virou defeito quando a operação cresceu: o arquivo é fatiado de 500
   * em 500, então uma lista de 8.000 contatos exigia dezesseis liberações
   * manuais para uma decisão que a pessoa já tinha tomado ao subir o arquivo.
   *
   * ── ⚠️ O QUE O PASSO PRECISA CONTINUAR PROVANDO ─────────────────────────
   *
   * "Entra sozinho" não pode virar "sai sozinho". O que a base contínua tira é
   * a liberação por bloco — e **só** ela. Continuam de pé, e este passo mede os
   * três: o interruptor global (passo 2, acima), o teto diário, e a pausa que
   * tira uma importação inteira da fila sem apagar nada.
   */
  it("3. ⭐ ligada a prospecção, a importação JÁ está na fila — sem liberação por bloco", async () => {
    await prisma.prospeccaoConfig.create({
      data: {
        id: "singleton",
        outboundLigado: true,
        limiteDiario: 10,
        atualizadoPor: "jornada-ci",
      },
    });

    // Ninguém chamou `liberarLote`. Os dois contatos válidos estão na fila
    // porque a importação foi válida e declarou proveniência.
    const fila = await montarFilaDeProspeccao(prisma, { canalPronto: true, agora: AGORA });
    expect(fila.liberados).toHaveLength(2);
  });

  it("3b. ⛔ o TETO DIÁRIO continua mandando na base contínua", async () => {
    // A sonda de controle do passo acima. Sem ela, "entra automaticamente"
    // poderia significar "entra tudo", e o teto do dia — a única trava que
    // limita o VOLUME — teria sumido junto com a liberação por bloco.
    await prisma.prospeccaoConfig.update({
      where: { id: "singleton" },
      data: { limiteDiario: 1 },
    });

    const fila = await montarFilaDeProspeccao(prisma, { canalPronto: true, agora: AGORA });
    expect(fila.liberados).toHaveLength(1);
    expect(fila.tetoDoDia).toBe(1);

    await prisma.prospeccaoConfig.update({
      where: { id: "singleton" },
      data: { limiteDiario: 10 },
    });
  });

  it("3c. ⛔ pausar a importação tira os contatos da fila, e não apaga nada", async () => {
    // É o cancelamento de uma lista: o lote sai da fila, os contatos ficam no
    // banco. Se apagasse, não haveria como responder depois de onde veio o
    // contato de alguém que reclamou.
    const itensAntes = await prisma.itemDeProspeccao.count();
    await pausarLote(prisma, loteId, "jornada-ci");

    const fila = await montarFilaDeProspeccao(prisma, { canalPronto: true, agora: AGORA });
    expect(fila.liberados).toHaveLength(0);
    expect(await prisma.itemDeProspeccao.count()).toBe(itensAntes);

    // E retomar devolve os dois — é para isto que `liberarLote` continua
    // existindo depois da base contínua: retomar, não autorizar pela primeira
    // vez.
    expect((await liberarLote(prisma, loteId, "jornada-ci")).ok).toBe(true);
    const voltou = await montarFilaDeProspeccao(prisma, { canalPronto: true, agora: AGORA });
    expect(voltou.liberados).toHaveLength(2);
  });

  it("4. ⭐ montar a fila NÃO escreve nada", async () => {
    const leadsAntes = await prisma.siteLead.count();
    const fila = await montarFilaDeProspeccao(prisma, { canalPronto: true, agora: AGORA });
    const leadsDepois = await prisma.siteLead.count();

    expect(fila.liberados).toHaveLength(2);

    // O defeito que quase entrou: a tela consumia a lista só de ser aberta.
    expect(leadsDepois).toBe(leadsAntes);
    expect(await prisma.itemDeProspeccao.count({ where: { situacao: "PENDENTE" } })).toBe(2);
  });

  it("5. ⭐ materializar cria o lead, e ele NUNCA nasce com consentimento", async () => {
    const fila = await montarFilaDeProspeccao(prisma, { canalPronto: true, agora: AGORA });
    const alvo = fila.liberados[0]!;

    const m = await materializarLead(prisma, alvo.itemId);
    expect(m.materializado).toBe(true);

    const lead = m.materializado
      ? await prisma.siteLead.findUnique({ where: { id: m.leadId } })
      : null;

    expect(lead).not.toBeNull();
    expect(lead!.consentAt).toBeNull();
    expect(lead!.fonte).toBe("LISTA_PROSPECCAO");

    // Idempotente: materializar de novo devolve o mesmo lead.
    const m2 = await materializarLead(prisma, alvo.itemId);
    expect(m2.materializado && m.materializado && m2.leadId === m.leadId).toBe(true);
    expect(await prisma.siteLead.count()).toBe(1);
  });

  it("6. ⭐⭐ quem pediu SILÊNCIO em formato legado é barrado — a prova da correção", async () => {
    // ── POR QUE ESTE TESTE FOI REESCRITO ────────────────────────────────────
    //
    // A primeira versão pegava o lead já materializado no passo 5 e conferia que
    // ele não aparecia liberado. Ele NUNCA apareceria: o item dele saiu de
    // PENDENTE, e a fila só lê PENDENTE. A asserção passava com o portão
    // inteiro apagado — verde por ausência, exatamente o defeito que esta casa
    // nomeia. Uma revisão adversarial pegou.
    //
    // Agora o teste monta o caso real: um lead com opt-out gravado no formato
    // LEGADO (com o zero da operadora, como o backfill antigo gerava) e um item
    // NOVO, pendente, com o mesmo telefone em formato canônico. Se o casamento
    // voltar a ser por igualdade exata, este teste reprova.
    const legado = await prisma.siteLead.create({
      data: {
        nome: "Quem pediu silêncio (cadastro antigo)",
        whatsapp: "(11) 93333-4444",
        // Formato legado: `55` + `0` da operadora + nacional. É o que o backfill
        // de 20260805120000 produzia, e é o que a igualdade exata não acha.
        whatsappDigits: "55011933334444",
        fonte: "MANUAL",
        optOutAt: new Date("2026-08-01T12:00:00Z"),
        optOutCanal: "jornada-ci",
      },
    });

    // E um segundo lead, de OUTRO DDD, com os mesmos oito dígitos finais. Ele é
    // a armadilha: uma régua que compare só o fim do número trata os dois como a
    // mesma pessoa e gruda o contato na carteira errada. Este lead foi criado
    // DEPOIS do legado de propósito — quem casa por sufixo e ordena por mais
    // recente escolhe justamente ele, e reprova aqui. Foi o que aconteceu na
    // primeira execução desta jornada.
    await prisma.siteLead.create({
      data: {
        nome: "Outra pessoa, outro DDD, mesmos oito finais",
        whatsapp: "(21) 93333-4444",
        whatsappDigits: "5521933334444",
        fonte: "MANUAL",
      },
    });

    const lote = await importarLote(prisma, {
      nome: "Lote com contato que pediu silêncio",
      proveniencia: "Lista sintética da jornada.",
      criadoPor: "jornada-ci",
      limiteDiario: 5,
      linhas: [{ whatsapp: "11933334444", nome: "Mesmo telefone, formato canônico" }],
    });

    // A importação já tem que reconhecer que este contato JÁ EXISTE na base,
    // mesmo com os dígitos gravados em outro formato.
    expect(lote.jaEramLead).toBe(1);
    expect(lote.aceitas).toBe(0);

    await liberarLote(prisma, lote.loteId, "jornada-ci");

    const fila = await montarFilaDeProspeccao(prisma, { canalPronto: true, agora: AGORA });

    // Ninguém deste lote pode sair liberado.
    const liberadoIndevido = fila.liberados.some((c) => c.loteId === lote.loteId);
    expect(liberadoIndevido).toBe(false);

    // E o item tem que estar apontando para o lead CERTO — o que pediu silêncio,
    // e não o homônimo de outro DDD.
    const item = await prisma.itemDeProspeccao.findFirst({ where: { loteId: lote.loteId } });
    expect(item?.leadId).toBe(legado.id);
  });

  it("7. o freio do lote esvazia a fila", async () => {
    await pausarLote(prisma, loteId, "jornada-ci");
    const fila = await montarFilaDeProspeccao(prisma, { canalPronto: true, agora: AGORA });
    expect(fila.liberados).toHaveLength(0);
  });

  it("8. o freio geral esvazia a fila, e diz o motivo", async () => {
    await liberarLote(prisma, loteId, "jornada-ci");
    await prisma.prospeccaoConfig.update({
      where: { id: "singleton" },
      data: { pausadoEm: new Date(), pausadoPor: "jornada-ci", motivo: "teste do freio" },
    });

    const fila = await montarFilaDeProspeccao(prisma, { canalPronto: true, agora: AGORA });
    expect(fila.liberados).toHaveLength(0);
    expect(fila.motivoDaFilaVazia).toContain("pausada");
  });

  it("9. sem canal pronto, ninguém é liberado — e o barrado diz por quê", async () => {
    await prisma.prospeccaoConfig.update({
      where: { id: "singleton" },
      data: { pausadoEm: null, motivo: null },
    });

    const fila = await montarFilaDeProspeccao(prisma, { canalPronto: false, agora: AGORA });
    expect(fila.liberados).toHaveLength(0);

    // Sem esta linha o `for` abaixo passaria com a lista vazia — e uma fila
    // vazia não prova nada sobre o motivo aparecer.
    expect(fila.barrados.length).toBeGreaterThan(0);
    for (const barrado of fila.barrados) {
      expect(barrado.decisao.detail.length).toBeGreaterThan(0);
    }
  });
});
