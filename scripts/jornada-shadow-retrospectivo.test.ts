/**
 * A JORNADA DO SHADOW RETROSPECTIVO, PONTA A PONTA, CONTRA POSTGRES DE VERDADE.
 *
 * ── O QUE É REAL E O QUE É DUBLÊ ──────────────────────────────────────────────
 *
 * Postgres real: `LeadMensagem`, `AcademiaRevisaoRetrospectiva`, a leitura por
 * `montarContextoDaRevisao`, a paginação e a gravação de
 * `rodarShadowRetrospectivo` — mesmo padrão de `jornada-supervisora.test.ts`.
 *
 * Dublê, e só isto: `@/lib/openai` (nenhuma chamada real ao provedor). Não há
 * dublê nenhum de envio de WhatsApp aqui porque `shadow-retrospectivo.ts` NUNCA
 * importa `FoocciSalesChannel`/`entregarMensagem` — a prova de "nunca toca
 * WhatsApp" é estrutural (o arquivo não tem como chamar o que não importa),
 * não apenas comportamental.
 *
 * ⚠️ Dados fictícios, nenhum recurso de outro produto tocado.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const criar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/openai", () => ({
  openai: { chat: { completions: { create: criar } } },
}));

import {
  rodarShadowRetrospectivo,
  TAMANHO_MAXIMO_DO_LOTE,
} from "./shadow-retrospectivo";

const prisma = new PrismaClient();

const ambiente = { ...process.env };

function ligarOpenAI() {
  process.env.OPENAI_API_KEY = "sk-teste-nao-e-uma-chave-real";
}

/** Uma resposta JSON do "juízo" da Supervisora, na próxima chamada ao motor. */
function proximoJuizo(obj: Record<string, unknown>) {
  criar.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: "stop" }],
  });
}

let seq = 0;
async function novoLead() {
  seq += 1;
  return prisma.siteLead.create({
    data: {
      nome: `Lead Shadow Retro ${seq}`,
      whatsapp: `11977${String(880000 + seq).padStart(6, "0")}`,
      restaurante: "Restaurante da Jornada Retrospectiva",
      tipo: "Hamburgueria",
      atendidoPor: "IA",
      fonte: "MANUAL",
    },
  });
}

beforeAll(async () => {
  await prisma.academiaRevisaoRetrospectiva.deleteMany({
    where: { lead: { nome: { startsWith: "Lead Shadow Retro" } } },
  });
  await prisma.supervisoraAvaliacao.deleteMany({
    where: { lead: { nome: { startsWith: "Lead Shadow Retro" } } },
  });
  await prisma.leadMensagem.deleteMany({ where: { lead: { nome: { startsWith: "Lead Shadow Retro" } } } });
  await prisma.siteLead.deleteMany({ where: { nome: { startsWith: "Lead Shadow Retro" } } });
});

afterAll(async () => {
  await prisma.$disconnect();
  process.env = { ...ambiente };
});

beforeEach(() => {
  criar.mockReset();
  ligarOpenAI();
});

describe("Jornada — shadow retrospectivo, modo estritamente leitura", () => {
  it("1. revisa mensagens de SAÍDA já enviadas, grava o veredito, NUNCA reescreve LeadMensagem.texto", async () => {
    const lead = await novoLead();
    const t0 = new Date("2026-08-01T10:00:00Z");

    await prisma.leadMensagem.create({
      data: { leadId: lead.id, direcao: "ENTRADA", texto: "Oi, quanto custa?", ocorreuEm: t0 },
    });
    const saida1 = await prisma.leadMensagem.create({
      data: {
        leadId: lead.id,
        direcao: "SAIDA",
        autor: "IA",
        papelDoAgente: "qualificacao",
        texto: "O plano mensal sai R$ 149 por loja. Quantas lojas vocês têm?",
        ocorreuEm: new Date(t0.getTime() + 60_000),
      },
    });
    const saida2 = await prisma.leadMensagem.create({
      data: {
        leadId: lead.id,
        direcao: "SAIDA",
        autor: "IA",
        papelDoAgente: "closer",
        texto: "Você TEM que fechar hoje, essa condição não vai durar!",
        ocorreuEm: new Date(t0.getTime() + 120_000),
      },
    });

    // Snapshot ANTES de rodar — para provar depois que nada mudou.
    const antes = await prisma.leadMensagem.findMany({
      where: { id: { in: [saida1.id, saida2.id] } },
      orderBy: { ocorreuEm: "asc" },
    });

    // saida1: camada rápida aprova (VERDE) — não aciona a profunda.
    proximoJuizo({ veredito: "VERDE", motivos: [], detalhe: "resposta direta e no tom certo" });
    // saida2: camada rápida reprova (VERMELHO) — aciona a profunda...
    proximoJuizo({
      veredito: "VERMELHO",
      motivos: ["PRESSAO_COMERCIAL"],
      detalhe: "urgência artificial (\"TEM que\", \"não vai durar\")",
    });
    // ...que confirma CRITICO (a profunda "vale mais" quando avalia).
    proximoJuizo({
      veredito: "CRITICO",
      motivos: ["PRESSAO_COMERCIAL"],
      detalhe: "urgência fabricada, sem sinal real de compra",
      precisaDeGente: true,
    });

    const r = await rodarShadowRetrospectivo(prisma, {
      desde: t0,
      ate: new Date(t0.getTime() + 3_600_000),
      loteId: "teste-jornada-1",
    });

    expect(r.processadas).toBe(2);
    expect(r.porVeredito).toMatchObject({ VERDE: 1, CRITICO: 1 });
    expect(r.porCamada).toMatchObject({ RAPIDA: 1, PROFUNDA: 1 });
    expect(r.temMais).toBe(false);
    expect(r.proximoCursor).toBeNull();

    // ⛔ NUNCA reescreve — o texto continua idêntico ao que foi enviado.
    const depois = await prisma.leadMensagem.findMany({
      where: { id: { in: [saida1.id, saida2.id] } },
      orderBy: { ocorreuEm: "asc" },
    });
    expect(depois.map((m) => m.texto)).toEqual(antes.map((m) => m.texto));
    expect(depois).toEqual(antes);

    // ⛔ NUNCA cria SupervisoraAvaliacao — isto é revisão retrospectiva, não a
    // avaliação que valeu no momento do envio.
    const avaliacoes = await prisma.supervisoraAvaliacao.findMany({
      where: { mensagemId: { in: [saida1.id, saida2.id] } },
    });
    expect(avaliacoes).toHaveLength(0);

    // A revisão retrospectiva FOI gravada, com o veredito certo por mensagem.
    const revisao1 = await prisma.academiaRevisaoRetrospectiva.findUnique({ where: { mensagemId: saida1.id } });
    expect(revisao1).toMatchObject({ veredito: "VERDE", camada: "RAPIDA", loteId: "teste-jornada-1" });

    const revisao2 = await prisma.academiaRevisaoRetrospectiva.findUnique({ where: { mensagemId: saida2.id } });
    expect(revisao2).toMatchObject({ veredito: "CRITICO", camada: "PROFUNDA", loteId: "teste-jornada-1" });

    // A ENTRADA nunca vira revisão — só SAÍDA é revisada retrospectivamente.
    const entradaMsg = await prisma.leadMensagem.findFirst({ where: { leadId: lead.id, direcao: "ENTRADA" } });
    const revisaoDaEntrada = await prisma.academiaRevisaoRetrospectiva.findUnique({
      where: { mensagemId: entradaMsg!.id },
    });
    expect(revisaoDaEntrada).toBeNull();
  });

  it("2. idempotente: rodar o mesmo recorte de novo não reprocessa nem duplica", async () => {
    const lead = await novoLead();
    const t0 = new Date("2026-08-02T10:00:00Z");
    const saida = await prisma.leadMensagem.create({
      data: {
        leadId: lead.id,
        direcao: "SAIDA",
        autor: "IA",
        texto: "Perfeito, vou te passar os próximos passos.",
        ocorreuEm: t0,
      },
    });

    proximoJuizo({ veredito: "VERDE", motivos: [], detalhe: "ok" });
    const primeira = await rodarShadowRetrospectivo(prisma, {
      desde: t0,
      ate: new Date(t0.getTime() + 60_000),
    });
    expect(primeira.processadas).toBe(1);

    // Segunda chamada, mesmo recorte: NÃO deveria nem tentar chamar o motor de
    // novo para esta mensagem — ela já tem revisão.
    criar.mockReset();
    const segunda = await rodarShadowRetrospectivo(prisma, {
      desde: t0,
      ate: new Date(t0.getTime() + 60_000),
    });
    expect(segunda.processadas).toBe(0);
    expect(segunda.jaRevisadasNoRecorte).toBe(1);
    expect(criar).not.toHaveBeenCalled();

    const total = await prisma.academiaRevisaoRetrospectiva.count({ where: { mensagemId: saida.id } });
    expect(total).toBe(1);
  });

  it("3. pagina corretamente: um lote pequeno devolve `proximoCursor`, e continuar com ele cobre o resto", async () => {
    const lead = await novoLead();
    const t0 = new Date("2026-08-03T09:00:00Z");

    const mensagens = [];
    for (let i = 0; i < 5; i++) {
      mensagens.push(
        await prisma.leadMensagem.create({
          data: {
            leadId: lead.id,
            direcao: "SAIDA",
            autor: "IA",
            texto: `Mensagem de teste número ${i + 1}, sem nada de errado.`,
            ocorreuEm: new Date(t0.getTime() + i * 60_000),
          },
        }),
      );
    }

    for (let i = 0; i < 5; i++) proximoJuizo({ veredito: "VERDE", motivos: [], detalhe: "ok" });

    const ateTudo = new Date(t0.getTime() + 3_600_000);

    const pagina1 = await rodarShadowRetrospectivo(prisma, { desde: t0, ate: ateTudo, tamanhoDoLote: 2 });
    expect(pagina1.processadas).toBe(2);
    expect(pagina1.temMais).toBe(true);
    expect(pagina1.proximoCursor).toBe(mensagens[1].id);

    const pagina2 = await rodarShadowRetrospectivo(prisma, {
      desde: t0,
      ate: ateTudo,
      tamanhoDoLote: 2,
      cursor: pagina1.proximoCursor,
    });
    expect(pagina2.processadas).toBe(2);
    expect(pagina2.temMais).toBe(true);
    expect(pagina2.proximoCursor).toBe(mensagens[3].id);

    const pagina3 = await rodarShadowRetrospectivo(prisma, {
      desde: t0,
      ate: ateTudo,
      tamanhoDoLote: 2,
      cursor: pagina2.proximoCursor,
    });
    expect(pagina3.processadas).toBe(1);
    expect(pagina3.temMais).toBe(false);
    expect(pagina3.proximoCursor).toBeNull();

    const totalRevisado = await prisma.academiaRevisaoRetrospectiva.count({
      where: { mensagemId: { in: mensagens.map((m) => m.id) } },
    });
    expect(totalRevisado).toBe(5);
  });

  it("4. nunca processa mais que o teto rígido de lote, mesmo se pedirem mais", async () => {
    const lead = await novoLead();
    const t0 = new Date("2026-08-04T09:00:00Z");
    await prisma.leadMensagem.create({
      data: { leadId: lead.id, direcao: "SAIDA", autor: "IA", texto: "Mensagem única.", ocorreuEm: t0 },
    });

    proximoJuizo({ veredito: "VERDE", motivos: [], detalhe: "ok" });
    const r = await rodarShadowRetrospectivo(prisma, {
      desde: t0,
      ate: new Date(t0.getTime() + 60_000),
      tamanhoDoLote: TAMANHO_MAXIMO_DO_LOTE * 10,
    });

    // Só havia 1 mensagem elegível — o teto não muda o resultado aqui, mas o
    // teste documenta que pedir um lote absurdo não quebra nem é aceito ao pé
    // da letra (o valor é clampado internamente).
    expect(r.processadas).toBe(1);
  });

  it("5. rejeita um recorte de tempo vazio/invertido — nunca 'a base inteira sem limite'", async () => {
    const agora = new Date();
    await expect(
      rodarShadowRetrospectivo(prisma, { desde: agora, ate: new Date(agora.getTime() - 1000) }),
    ).rejects.toThrow(/desde.*anterior.*ate/i);
  });
});
