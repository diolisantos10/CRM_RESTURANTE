/**
 * A JORNADA DA ACADEMIA COMERCIAL, PONTA A PONTA, CONTRA POSTGRES DE VERDADE.
 *
 * ── O QUE É REAL E O QUE É DUBLÊ ──────────────────────────────────────────────
 *
 * Tudo aqui é Postgres de verdade — schema, migração, `AcademiaComercialVersao`/
 * `AcademiaComercialItem`/`AcademiaComercialConfig`, a leitura por
 * `recuperarConhecimentoRelevante`, a publicação por `publicarVersaoDaAcademia`,
 * e o encaixe em `montarContextoDaRevisao` — mesmo padrão de
 * `jornada-supervisora.test.ts`. Nenhum motor de IA é chamado nesta jornada:
 * o que se mede aqui é a MÁQUINA de dados, não o julgamento do modelo.
 *
 * ⚠️ Dados fictícios, nenhum recurso de outro produto tocado.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { semearAcademiaComercial } from "./semear-academia-comercial";
import {
  recuperarConhecimentoRelevante,
  etapaComercialDoStage,
  sinaisDaMemoria,
  LIMITE_PADRAO,
} from "@/services/salaDeVendas/supervisora/academia";
import { publicarVersaoDaAcademia, lerEstadoDaAcademia } from "@/services/salaDeVendas/supervisora/academiaInterruptor";
import { montarContextoDaRevisao } from "@/services/salaDeVendas/supervisora/contexto";

const prisma = new PrismaClient();

const GERENTE_ID = "academia-gerente-teste";

let seq = 0;
async function novoLead(over: Record<string, unknown> = {}) {
  seq += 1;
  return prisma.siteLead.create({
    data: {
      nome: `Lead Academia ${seq}`,
      whatsapp: `11966${String(770000 + seq).padStart(6, "0")}`,
      restaurante: "Restaurante da Jornada da Academia",
      tipo: "Pizzaria",
      atendidoPor: "IA",
      fonte: "MANUAL",
      ...over,
    },
  });
}

beforeAll(async () => {
  // Esta jornada é a ÚNICA que mexe nas tabelas da Academia — limpa por
  // inteiro é seguro, sem risco de pisar em dado de outro arquivo de jornada.
  await prisma.academiaComercialItem.deleteMany({});
  await prisma.academiaComercialVersao.deleteMany({});
  await prisma.academiaComercialConfig.deleteMany({});
  await prisma.siteLead.deleteMany({ where: { nome: { startsWith: "Lead Academia" } } });

  await prisma.internalUser.upsert({
    where: { id: GERENTE_ID },
    create: { id: GERENTE_ID, email: "academia-gerente-teste@jornada.teste", nome: "Gerente Teste (Academia)" },
    update: {},
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Jornada — semear a Academia Comercial", () => {
  it("1. o seed roda, cria uma versão RASCUNHO com os itens esperados (bate com o JSON)", async () => {
    const r = await semearAcademiaComercial(prisma);

    expect(r.ok).toBe(true);
    if (r.jaExistia) throw new Error("esperava uma primeira corrida, sem versão prévia");

    // 13 regras + 9 proibidos + 6 exemplos + 6 sinais + 4 critérios + 5
    // orientações — a mesma conta de `academia-comercial-v1.json`.
    expect(r.totalDeItens).toBe(43);
    expect(r.porCategoria).toMatchObject({
      REGRA_OBRIGATORIA: 13,
      COMPORTAMENTO_PROIBIDO: 9,
      EXEMPLO: 6,
      SINAL_DE_RISCO: 6,
      CRITERIO_VEREDITO: 4,
      ORIENTACAO_DE_ETAPA: 5,
    });

    const versao = await prisma.academiaComercialVersao.findUnique({ where: { id: r.versaoId } });
    expect(versao).toMatchObject({ numero: 1, situacao: "RASCUNHO" });

    const totalNoBanco = await prisma.academiaComercialItem.count({ where: { versaoId: r.versaoId } });
    expect(totalNoBanco).toBe(43);

    // Uma linha de cada categoria, rastreável até o JSON pela `chaveOriginal`.
    const regra = await prisma.academiaComercialItem.findUnique({
      where: { versaoId_chaveOriginal: { versaoId: r.versaoId, chaveOriginal: "regra-diagnostico-antes-do-pitch" } },
    });
    expect(regra).toMatchObject({
      categoria: "REGRA_OBRIGATORIA",
      etapa: "PROSPECCAO",
      titulo: "Diagnosticar antes de apresentar",
      fonteUrl: "https://theharrisconsultinggroup.com/consultative-sales-training-for-your-team-harris-consulting/",
      fonteData: "2026-09-13",
    });

    const criterio = await prisma.academiaComercialItem.findUnique({
      where: { versaoId_chaveOriginal: { versaoId: r.versaoId, chaveOriginal: "criterio-verde" } },
    });
    expect(criterio).toMatchObject({ categoria: "CRITERIO_VEREDITO", etapa: null, titulo: "VERDE" });

    const orientacao = await prisma.academiaComercialItem.findUnique({
      where: { versaoId_chaveOriginal: { versaoId: r.versaoId, chaveOriginal: "orientacao-fechamento" } },
    });
    expect(orientacao).toMatchObject({ categoria: "ORIENTACAO_DE_ETAPA", etapa: "FECHAMENTO" });
  });

  it("2. rodar o seed de novo NÃO duplica — recusa e não escreve nada", async () => {
    const antes = await prisma.academiaComercialItem.count({});
    expect(antes).toBe(43);

    const r = await semearAcademiaComercial(prisma);
    expect(r.ok).toBe(true);
    expect(r.jaExistia).toBe(true);

    const depois = await prisma.academiaComercialItem.count({});
    expect(depois).toBe(43);

    const totalDeVersoes = await prisma.academiaComercialVersao.count({});
    expect(totalDeVersoes).toBe(1);
  });
});

describe("Jornada — recuperação por contexto, sem versão publicada", () => {
  it("3. recuperarConhecimentoRelevante devolve vazio sem versão publicada", async () => {
    const estado = await lerEstadoDaAcademia(prisma);
    expect(estado.temVersaoPublicada).toBe(false);

    const r = await recuperarConhecimentoRelevante(prisma, { etapa: "PROSPECCAO" });
    expect(r).toEqual([]);
  });

  it("3b. montarContextoDaRevisao não quebra, e devolve `conhecimentoDaAcademia: []` (sem regressão)", async () => {
    const lead = await novoLead();
    const ctx = await montarContextoDaRevisao(prisma, { leadId: lead.id });

    expect(ctx.conhecimentoDaAcademia).toEqual([]);
    // O resto do contexto continua funcionando exatamente como antes desta
    // frente — a Academia é estritamente aditiva.
    expect(ctx.perfilDoLead).toContain("Restaurante da Jornada da Academia");
  });
});

let versaoV1Id: string;

describe("Jornada — publicar a v1", () => {
  it("4. publicar a versão 1 faz recuperarConhecimentoRelevante passar a devolver conteúdo", async () => {
    const v1 = await prisma.academiaComercialVersao.findFirstOrThrow({ where: { numero: 1 } });
    versaoV1Id = v1.id;

    const pub = await publicarVersaoDaAcademia(prisma, { versaoId: v1.id, porUserId: GERENTE_ID });
    expect(pub).toMatchObject({ ok: true, eraAAtiva: false, numero: 1 });

    const estado = await lerEstadoDaAcademia(prisma);
    expect(estado).toMatchObject({ temVersaoPublicada: true, versaoAtivaId: v1.id, versaoNumero: 1, situacao: "PUBLICADA" });

    const r = await recuperarConhecimentoRelevante(prisma, { etapa: "PROSPECCAO" });
    expect(r.length).toBeGreaterThan(0);
  });

  it("publicar a mesma versão de novo é idempotente (eraAAtiva: true)", async () => {
    const pub = await publicarVersaoDaAcademia(prisma, { versaoId: versaoV1Id, porUserId: GERENTE_ID });
    expect(pub).toMatchObject({ ok: true, eraAAtiva: true, numero: 1 });
  });

  it("montarContextoDaRevisao agora traz conhecimento da Academia dentro do contexto", async () => {
    const lead = await novoLead();
    const ctx = await montarContextoDaRevisao(prisma, { leadId: lead.id });
    expect(ctx.conhecimentoDaAcademia.length).toBeGreaterThan(0);
  });
});

describe("Jornada — o recorte é pequeno e filtrado pela etapa (item 5 do comando)", () => {
  it("5a. o teto de `limite` é real — nunca a base inteira", async () => {
    // O total elegível para PROSPECCAO (regra/proibido/exemplo/orientação da
    // etapa + GERAL + os `etapa: null` de sinal/critério) passa de 25 — bem
    // acima do padrão (6) e do teto pequeno pedido aqui (3).
    const comLimitePequeno = await recuperarConhecimentoRelevante(prisma, { etapa: "PROSPECCAO", limite: 3 });
    expect(comLimitePequeno.length).toBe(3);

    const comLimitePadrao = await recuperarConhecimentoRelevante(prisma, { etapa: "PROSPECCAO" });
    expect(comLimitePadrao.length).toBe(LIMITE_PADRAO);
    expect(comLimitePadrao.length).toBeLessThan(43);
  });

  it("5b. filtra por etapa: um item de PROSPECCAO não aparece quando a etapa pedida é outra", async () => {
    const daProspeccao = await recuperarConhecimentoRelevante(prisma, { etapa: "PROSPECCAO", limite: 50 });
    const textoProspeccao = daProspeccao.join(" | ");
    expect(textoProspeccao).toContain("Diagnosticar antes de apresentar");

    const daDemonstracao = await recuperarConhecimentoRelevante(prisma, { etapa: "DEMONSTRACAO", limite: 50 });
    const textoDemonstracao = daDemonstracao.join(" | ");
    // Item específico de PROSPECCAO não vaza para outra etapa — só os `GERAL`
    // e os `etapa: null` (sinal/critério) atravessam as duas consultas.
    expect(textoDemonstracao).not.toContain("Diagnosticar antes de apresentar");
  });

  it("5c. `etapaComercialDoStage` traduz o estágio do lead para a etapa da Academia", () => {
    expect(etapaComercialDoStage("NOVO")).toBe("PROSPECCAO");
    expect(etapaComercialDoStage("EM_QUALIFICACAO")).toBe("QUALIFICACAO");
    expect(etapaComercialDoStage("DEMO_AGENDADA")).toBe("DEMONSTRACAO");
    expect(etapaComercialDoStage("EM_NEGOCIACAO")).toBe("FECHAMENTO");
    expect(etapaComercialDoStage("GANHO")).toBe("GERAL");
    expect(etapaComercialDoStage(null)).toBe("GERAL");
  });

  it("5d. sinais detectados priorizam itens cujas tags casam com o sinal", async () => {
    // `sinal-irritacao-forte` tem a tag exata `irritacao-forte`.
    const sinais = sinaisDaMemoria({ irritacaoDoLead: 3, pediuParar: false });
    expect(sinais).toContain("irritacao-forte");

    const comSinal = await recuperarConhecimentoRelevante(prisma, {
      etapa: "GERAL",
      sinaisDetectados: sinais,
      limite: 1,
    });
    // Com limite 1 e um sinal que casa com exatamente um item, o item
    // priorizado É o do sinal — não um item qualquer da etapa.
    expect(comSinal[0]).toContain("Irritação escalada");
  });
});

let versaoV2Id: string;

describe("Jornada — uma segunda versão em RASCUNHO não vaza", () => {
  it("6. um item de uma v2 RASCUNHO não aparece na recuperação enquanto ela não for publicada", async () => {
    const v2 = await prisma.academiaComercialVersao.create({
      data: { numero: 2, situacao: "RASCUNHO", notaDaVersao: "v2 de teste — nunca deveria vazar" },
    });
    versaoV2Id = v2.id;

    await prisma.academiaComercialItem.create({
      data: {
        versaoId: v2.id,
        categoria: "REGRA_OBRIGATORIA",
        etapa: "GERAL",
        chaveOriginal: "regra-so-existe-na-v2",
        titulo: "ITEM EXCLUSIVO DA V2 RASCUNHO",
        conteudo: "Este texto não pode aparecer enquanto a v2 não for publicada.",
        tags: [],
      },
    });

    const r = await recuperarConhecimentoRelevante(prisma, { etapa: "GERAL", limite: 50 });
    const texto = r.join(" | ");
    expect(texto).not.toContain("ITEM EXCLUSIVO DA V2 RASCUNHO");

    // E a Academia ainda publicada continua sendo a v1.
    const estado = await lerEstadoDaAcademia(prisma);
    expect(estado.versaoAtivaId).toBe(versaoV1Id);
  });
});

describe("Jornada — publicar a v2 e reverter para a v1 (item 7, rollback igual ao do TA)", () => {
  it("7. publicar a v2 troca o conteúdo ativo; reverter para a v1 desfaz — mesmo mecanismo de `publicarVersaoExistente`", async () => {
    const pubV2 = await publicarVersaoDaAcademia(prisma, { versaoId: versaoV2Id, porUserId: GERENTE_ID });
    expect(pubV2).toMatchObject({ ok: true, eraAAtiva: false, numero: 2 });

    const estadoComV2 = await lerEstadoDaAcademia(prisma);
    expect(estadoComV2.versaoAtivaId).toBe(versaoV2Id);

    const comV2 = await recuperarConhecimentoRelevante(prisma, { etapa: "GERAL", limite: 50 });
    expect(comV2.join(" | ")).toContain("ITEM EXCLUSIVO DA V2 RASCUNHO");
    // A v1 tem 43 itens; a v2 só o item que este teste criou — a troca é real,
    // não uma união das duas versões.
    expect(comV2.join(" | ")).not.toContain("Diagnosticar antes de apresentar");

    // Rollback: publica a v1 de volta — MESMA função, MESMO caminho.
    const rollback = await publicarVersaoDaAcademia(prisma, { versaoId: versaoV1Id, porUserId: GERENTE_ID });
    expect(rollback).toMatchObject({ ok: true, eraAAtiva: false, numero: 1 });

    const estadoFinal = await lerEstadoDaAcademia(prisma);
    expect(estadoFinal.versaoAtivaId).toBe(versaoV1Id);

    const comV1DeVolta = await recuperarConhecimentoRelevante(prisma, { etapa: "PROSPECCAO", limite: 50 });
    expect(comV1DeVolta.join(" | ")).toContain("Diagnosticar antes de apresentar");
  });

  it("publicar um versaoId inexistente falha nomeando a causa", async () => {
    const r = await publicarVersaoDaAcademia(prisma, { versaoId: "nao-existe-este-id", porUserId: GERENTE_ID });
    expect(r).toMatchObject({ ok: false, causa: "versaoNaoExiste" });
  });
});
