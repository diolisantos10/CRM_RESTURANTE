/**
 * A JORNADA DA SUPERVISORA SOBRE `abordar.ts`, CONTRA POSTGRES DE VERDADE.
 *
 * ── O QUE ESTA JORNADA PROVA, E O QUE ELA NÃO PROVA ─────────────────────────
 *
 * Prova, ponta a ponta e contra o MESMO banco de produção (schema real,
 * `abordarLead` de verdade — a mesma função, não um duplo dela):
 *
 *   1. Lead saudável, GUARD ligado → o template sai INALTERADO, e
 *      `SupervisoraAvaliacao` grava VERDE, ligada ao `mensagemId`, sem
 *      `textoOriginal`/`textoReescrito` (esta camada nunca reescreve).
 *   2. SHADOW não atrasa a rodada de abordagem — medido, não afirmado.
 *   3. Ausência de `SupervisoraConfig` (ninguém decidiu nada) não impede a
 *      abordagem nem grava avaliação nenhuma — a MESMA régua de
 *      `jornada-supervisora.test.ts`, agora provada também para `abordar.ts`.
 *
 * ── ⚠️ POR QUE "LEAD INSISTIDO/OPT-OUT → BARRADO" NÃO APARECE AQUI COMO
 *    `supervisoraRecusou` ────────────────────────────────────────────────────
 *
 * `julgarAdequacao` (`supervisora/adequacaoDoTemplate.ts`) reavalia opt-out e
 * teto de tentativas como SEGUNDA opinião — de propósito, para não depender só
 * do portão estar certo (ver o cabeçalho daquele arquivo). Mas o PORTÃO
 * (trava 1 de `abordarLead`, `LeadContactSafety.ts`) usa os MESMOS números
 * (`REGRA.maxTentativas`, `REGRA.descansoHoras`) sobre um escopo IGUAL OU MAIS
 * AMPLO (toda mensagem SAIDA, não só TEMPLATE) — e roda ANTES. Nestes dois
 * casos concretos, o portão SEMPRE bloqueia primeiro, com o mesmo veredito
 * final para o lead ("não recebeu o template"), e o motivo observável por
 * `abordarLead` é `portaoRecusou`, não `supervisoraRecusou`. Isto é o desenho
 * funcionando: as duas camadas concordam. A prova de que a SUPERVISORA, por
 * si só, bloqueia estes dois casos (sem depender do portão) está em
 * `supervisora/adequacaoDoTemplate.test.ts` — chamando `avaliarAdequacaoDoTemplate`
 * diretamente, o mesmo padrão de teste que `camadaProfunda.ts`/`deveAcionar`
 * já usa para funções de decisão puras.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { importarLote } from "@/services/salaDeVendas/prospeccao/lote";
import { materializarLead } from "@/services/salaDeVendas/prospeccao/selecao";
import { abordarLead } from "@/services/salaDeVendas/abordar";
import { alterarModo } from "@/services/salaDeVendas/supervisora/config";

const enviarModelo = vi.hoisted(() => vi.fn());
const canalPronto = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/services/foocci-sdr/FoocciSalesChannel", async (original) => {
  const real = await original<typeof import("@/services/foocci-sdr/FoocciSalesChannel")>();
  return { ...real, enviarModeloDeVendas: enviarModelo, canalDeVendasPronto: canalPronto };
});

const prisma = new PrismaClient();

/** Segunda-feira, 14h em São Paulo: dentro da janela, para não misturar causas. */
const AGORA = new Date("2026-09-14T17:00:00Z");

const PHONE_NUMBER_ID_DO_TESTE = "000000000009998";
const NOME_DO_MODELO_DO_TESTE = "foocci_abordagem_inicial";
const CORPO_DO_MODELO_DO_TESTE = "Olá, {{1}}! Esta é uma abordagem sintética da jornada da Supervisora.";
const EMAIL_DO_TESTE = "jornada-supervisora-abordagem@teste.foocci";
const ambiente = { ...process.env };

let usuarioId = "";

async function novoLeadDeLista(nome: string, whatsapp: string): Promise<string> {
  const lote = await importarLote(prisma, {
    nome: `Supervisora/abordagem — ${nome}`,
    proveniencia: "Lista sintética criada pela jornada de CI. Nenhum contato real.",
    criadoPor: "jornada-ci",
    limiteDiario: 50,
    linhas: [{ whatsapp, nome, cidade: "Curitiba" }],
  });
  const item = await prisma.itemDeProspeccao.findFirst({ where: { loteId: lote.loteId } });
  if (!item) throw new Error("setup da jornada falhou: item de prospecção não criado");
  const m = await materializarLead(prisma, item.id);
  if (!m.materializado) throw new Error("setup da jornada falhou ao materializar o lead");
  return m.leadId;
}

/** Mesmo mecanismo de espera de `jornada-supervisora.test.ts`: SHADOW grava em
 *  segundo plano, então ler o banco cedo demais correria a chance de não achar
 *  a linha ainda. */
async function esperarAvaliacao(mensagemId: string, timeoutMs = 5_000) {
  const inicio = Date.now();
  for (;;) {
    const avaliacao = await prisma.supervisoraAvaliacao.findUnique({ where: { mensagemId } });
    if (avaliacao) return avaliacao;
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(`avaliação da mensagem ${mensagemId} não apareceu em ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  process.env.FOOCCI_SALES_PHONE_NUMBER_ID = PHONE_NUMBER_ID_DO_TESTE;
  process.env.FOOCCI_SDR_MODELO_ABORDAGEM = NOME_DO_MODELO_DO_TESTE;
  process.env.FOOCCI_SDR_MODELO_IDIOMA = "pt_BR";
  process.env.FOOCCI_SDR_MODELO_VARIAVEIS = "1";

  // Nasce do zero, isolada — mesmo padrão de `jornada-supervisora.test.ts` e
  // `jornada-retentativa-prospeccao.test.ts`.
  await prisma.supervisoraAvaliacao.deleteMany({});
  await prisma.supervisoraModoHistorico.deleteMany({});
  await prisma.supervisoraConfig.deleteMany({});
  await prisma.itemDeProspeccao.deleteMany({ where: { lote: { nome: { startsWith: "Supervisora/abordagem" } } } });
  await prisma.loteDeProspeccao.deleteMany({ where: { nome: { startsWith: "Supervisora/abordagem" } } });
  await prisma.leadMensagem.deleteMany({ where: { lead: { fonte: "LISTA_PROSPECCAO", whatsapp: { startsWith: "1195560" } } } });
  await prisma.siteLead.deleteMany({ where: { fonte: "LISTA_PROSPECCAO", whatsapp: { startsWith: "1195560" } } });
  await prisma.modeloDeVendas.deleteMany({ where: { phoneNumberId: PHONE_NUMBER_ID_DO_TESTE } });
  await prisma.internalUser.deleteMany({ where: { email: EMAIL_DO_TESTE } });

  await prisma.modeloDeVendas.create({
    data: {
      phoneNumberId: PHONE_NUMBER_ID_DO_TESTE,
      wabaId: "waba-jornada-supervisora-abordagem",
      nome: NOME_DO_MODELO_DO_TESTE,
      idioma: "pt_BR",
      categoria: "MARKETING",
      situacao: "APPROVED",
      variaveis: 1,
      corpo: CORPO_DO_MODELO_DO_TESTE,
    },
  });

  const usuario = await prisma.internalUser.create({
    data: { email: EMAIL_DO_TESTE, nome: "Jornada CI — Supervisora/abordagem", role: "GERENTE_DEPARTAMENTO" },
  });
  usuarioId = usuario.id;

  await prisma.prospeccaoConfig.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", outboundLigado: true, limiteDiario: 500, atualizadoPor: "jornada-ci" },
    update: { outboundLigado: true, limiteDiario: 500, pausadoEm: null },
  });
});

afterAll(async () => {
  await prisma.modeloDeVendas.deleteMany({ where: { phoneNumberId: PHONE_NUMBER_ID_DO_TESTE } });
  await prisma.internalUser.deleteMany({ where: { email: EMAIL_DO_TESTE } });
  await prisma.$disconnect();
  process.env = { ...ambiente };
});

let seq = 0;
function novoWhatsapp(): string {
  seq += 1;
  return `1195560${String(1000 + seq).padStart(4, "0")}`;
}

beforeEach(() => {
  enviarModelo.mockReset();
  enviarModelo.mockResolvedValue({ ok: true, providerMessageId: `wamid.JORNADA.SUPERVISORA.${seq}` });
  canalPronto.mockReturnValue(true);
  process.env.FOOCCI_SDR_MODELO_ABORDAGEM = NOME_DO_MODELO_DO_TESTE;
  process.env.FOOCCI_SDR_MODELO_IDIOMA = "pt_BR";
  process.env.FOOCCI_SDR_MODELO_VARIAVEIS = "1";
  process.env.FOOCCI_SALES_PHONE_NUMBER_ID = PHONE_NUMBER_ID_DO_TESTE;
});

afterEach(() => {
  process.env = { ...ambiente };
});

describe("Jornada — Supervisora sobre abordar.ts, modo GUARD", () => {
  beforeEach(async () => {
    await alterarModo(prisma, { novoModo: "GUARD", novaLigada: true, alteradoPor: "jornada-ci" });
  });

  it("1. lead saudável (nunca abordado) → template sai INALTERADO, e a Supervisora grava VERDE", async () => {
    const leadId = await novoLeadDeLista("Cantina Saudável", novoWhatsapp());

    const r = await abordarLead(prisma, { leadId, autor: "HUMANO", autorUserId: usuarioId, agora: AGORA });

    expect(r, JSON.stringify(r)).toMatchObject({ abordou: true });
    expect(enviarModelo).toHaveBeenCalledTimes(1);
    // ⛔ O template não foi tocado: os mesmos parâmetros que sairiam sem a
    // Supervisora.
    const modeloEnviado = enviarModelo.mock.calls[0]![2] as { parametros: string[] };
    expect(modeloEnviado.parametros).toEqual(["Cantina Saudável"]);

    if (!r.abordou) throw new Error("deveria ter abordado");
    const avaliacao = await prisma.supervisoraAvaliacao.findUnique({ where: { mensagemId: r.mensagemId } });
    expect(avaliacao).toMatchObject({
      veredito: "VERDE",
      bloqueada: false,
      acaoTomada: "NENHUMA",
      camada: "RAPIDA",
      modoNaEpoca: "GUARD",
      papelDoAgente: "abordagem",
      textoOriginal: null,
      textoReescrito: null,
    });
  });

  it("2. o portão e a Supervisora concordam: lead que já pediu silêncio não recebe template, e a Supervisora nem chega a gravar (o portão bloqueia primeiro)", async () => {
    const leadId = await novoLeadDeLista("Cantina Opt-out", novoWhatsapp());
    await prisma.siteLead.update({ where: { id: leadId }, data: { optOutAt: AGORA } });

    const r = await abordarLead(prisma, { leadId, autor: "HUMANO", autorUserId: usuarioId, agora: AGORA });

    // O motivo observável é o do PORTÃO (trava 1, mais cedo no arquivo) — ver
    // o cabeçalho deste arquivo. A prova de que a Supervisora, isoladamente,
    // TAMBÉM barraria este caso está em `adequacaoDoTemplate.test.ts`.
    expect(r).toMatchObject({ abordou: false, motivo: "portaoRecusou" });
    expect(enviarModelo).not.toHaveBeenCalled();
  });
});

describe("Jornada — Supervisora sobre abordar.ts, modo SHADOW", () => {
  beforeEach(async () => {
    await alterarModo(prisma, { novoModo: "SHADOW", novaLigada: true, alteradoPor: "jornada-ci" });
  });

  it("3. ⭐ SHADOW não atrasa a rodada de abordagem — grava depois, em segundo plano", async () => {
    const leadId = await novoLeadDeLista("Cantina Shadow", novoWhatsapp());

    const inicio = Date.now();
    const r = await abordarLead(prisma, { leadId, autor: "HUMANO", autorUserId: usuarioId, agora: AGORA });
    const decorrido = Date.now() - inicio;

    expect(r, JSON.stringify(r)).toMatchObject({ abordou: true });
    // Cálculo puro, sem rede — a régua de regressão é generosa (a mesma ordem
    // de grandeza que `jornada-retentativa-prospeccao` mede para o caminho
    // inteiro de `abordarLead`), mas o NÚMERO real fica no log abaixo.
    console.log(`[jornada Supervisora/abordagem] abordarLead (SHADOW) terminou em ${decorrido}ms`);
    expect(decorrido).toBeLessThan(2_000);

    if (!r.abordou) throw new Error("deveria ter abordado");
    const avaliacao = await esperarAvaliacao(r.mensagemId);
    expect(avaliacao).toMatchObject({ veredito: "VERDE", bloqueada: false, modoNaEpoca: "SHADOW" });
  });
});

describe("Jornada — sem SupervisoraConfig no banco, o modo efetivo é OFF (abordar.ts)", () => {
  it("4. ⭐ ausência de configuração nunca vira SHADOW sozinha — nenhuma avaliação roda, e a abordagem segue normal", async () => {
    await prisma.supervisoraAvaliacao.deleteMany({});
    await prisma.supervisoraConfig.deleteMany({});

    const leadId = await novoLeadDeLista("Cantina Sem Config", novoWhatsapp());
    const r = await abordarLead(prisma, { leadId, autor: "HUMANO", autorUserId: usuarioId, agora: AGORA });

    expect(r, JSON.stringify(r)).toMatchObject({ abordou: true });
    if (!r.abordou) throw new Error("deveria ter abordado");

    // Dá tempo de sobra para uma avaliação em segundo plano aparecer, SE ela
    // tivesse sido disparada por engano.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const avaliacao = await prisma.supervisoraAvaliacao.findUnique({ where: { mensagemId: r.mensagemId } });
    expect(avaliacao).toBeNull();
  });
});
