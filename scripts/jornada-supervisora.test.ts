/**
 * A JORNADA DA SUPERVISORA, PONTA A PONTA, CONTRA POSTGRES DE VERDADE.
 *
 * ── O QUE É REAL E O QUE É DUBLÊ, E POR QUÊ ──────────────────────────────────
 *
 * Postgres real: schema, migração, `SupervisoraConfig`/`SupervisoraAvaliacao`,
 * `LeadMensagem`, o encaixe em `entregarMensagem` — tudo isso é medido contra o
 * banco de verdade, no mesmo padrão de `jornada-prospeccao.test.ts`.
 *
 * Dublê, e só isto: `@/lib/openai` (o "juízo" da IA-piloto — nenhuma chamada
 * real ao provedor) e `enviarTextoDeVendas` (nenhuma mensagem real sai pelo
 * WhatsApp). É o MESMO padrão que `entrega.test.ts` e `ta/falar.test.ts` já
 * usam nesta casa: teste que depende de rede é teste que reprova por sorte.
 *
 * ⚠️ Dados fictícios, números de teste, nenhum recurso de outro produto tocado.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const criar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/openai", () => ({
  openai: { chat: { completions: { create: criar } } },
}));

const enviar = vi.hoisted(() => vi.fn());
vi.mock("@/services/foocci-sdr/FoocciSalesChannel", async (original) => {
  const real = await original<typeof import("@/services/foocci-sdr/FoocciSalesChannel")>();
  return { ...real, enviarTextoDeVendas: enviar };
});

import type { Prisma } from "@prisma/client";
import { registrarSaida } from "@/services/salaDeVendas/conversa";
import { entregarMensagem } from "@/services/salaDeVendas/entrega";
import { alterarModo } from "@/services/salaDeVendas/supervisora/config";
import { desempenhoPorAgente, contarReprovacoesRecentes } from "@/services/salaDeVendas/supervisora/desempenho";
import { registrarSugestao, aprovarSugestaoECriarVersao } from "@/services/salaDeVendas/supervisora/sugestoes";
import { publicarVersaoExistente } from "@/services/salaDeVendas/ta/interruptor";
import { varrerConversasEmAndamento } from "@/services/salaDeVendas/supervisora/intervencao";

const prisma = new PrismaClient();

const AGORA = new Date("2026-09-12T17:00:00Z");
const ambiente = { ...process.env };

/** As três chaves ligadas — canal configurado, envio ligado, IA pode falar
 *  sozinha. Nenhuma bate na Meta de verdade: `enviarTextoDeVendas` é dublê. */
function ligarCanal() {
  process.env.FOOCCI_SALES_PHONE_NUMBER_ID = "000000000000001";
  process.env.FOOCCI_SALES_ACCESS_TOKEN = "EAAtoken-de-teste";
  process.env.FOOCCI_SDR_SEND_ENABLED = "true";
  process.env.FOOCCI_SDR_IA_RESPONDE_SOZINHA = "true";
  process.env.OPENAI_API_KEY = "sk-teste-nao-e-uma-chave-real";
}

/** Uma resposta JSON do "juízo" da Supervisora, na próxima chamada. */
function proximoJuizo(obj: Record<string, unknown>) {
  criar.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: "stop" }],
  });
}

/**
 * ⭐ 12/09/2026 — SHADOW não é mais síncrona: `entregarMensagem` já devolveu
 * quando a avaliação ainda está em voo. Testes que verificam o que a
 * Supervisora GRAVOU em SHADOW precisam esperar por ela — sem isto, o teste
 * correria a chance de ler o banco antes da escrita assíncrona acontecer.
 *
 * Faz *polling* curto em vez de um `sleep` fixo: mais rápido no caso comum
 * (a maioria das corridas encontra a linha bem antes do teto) e não falha à
 * toa quando a máquina de CI está devagar.
 */
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

let seq = 0;
async function novoLead(over: Partial<Prisma.SiteLeadCreateInput> = {}) {
  seq += 1;
  return prisma.siteLead.create({
    data: {
      nome: `Lead Supervisora ${seq}`,
      whatsapp: `11955${String(560000 + seq).padStart(6, "0")}`,
      restaurante: "Cantina da Jornada",
      tipo: "Italiana",
      atendidoPor: "IA",
      fonte: "MANUAL",
      ...over,
    },
  });
}

beforeAll(async () => {
  // A jornada nasce do zero, isolada das outras — nenhuma delas cria
  // `SupervisoraConfig` nem lead com `atendidoPor: "IA"` já pronto.
  // Tabelas que só ESTA jornada usa — apagadas por inteiro, sem risco de pisar
  // em dado de outro arquivo de jornada.
  await prisma.supervisoraAvaliacao.deleteMany({});
  await prisma.supervisoraSugestaoDePrompt.deleteMany({});
  await prisma.supervisoraModoHistorico.deleteMany({});
  await prisma.supervisoraConfig.deleteMany({});
  // Tabelas compartilhadas — restrito aos leads desta jornada (prefixo do
  // nome), para não tocar em dado de outro arquivo `jornada-*.test.ts`.
  await prisma.leadHandoff.deleteMany({ where: { lead: { nome: { startsWith: "Lead Supervisora" } } } });
  await prisma.leadMensagem.deleteMany({ where: { lead: { nome: { startsWith: "Lead Supervisora" } } } });
  await prisma.siteLeadInteraction.deleteMany({ where: { lead: { nome: { startsWith: "Lead Supervisora" } } } });
  await prisma.siteLead.deleteMany({ where: { nome: { startsWith: "Lead Supervisora" } } });

  // Duas pessoas fictícias, reais na tabela: `LeadMensagem.autorUserId` e
  // `SdrIaConfigVersao.publicadaPorId` têm chave estrangeira de verdade para
  // `InternalUser` — um id inventado sem a linha por trás quebra a gravação.
  await prisma.internalUser.upsert({
    where: { id: "sdr-humano-teste-1" },
    create: { id: "sdr-humano-teste-1", email: "sdr-teste-1@jornada.supervisora.teste", nome: "SDR Teste 1" },
    update: {},
  });
  await prisma.internalUser.upsert({
    where: { id: "gerente-teste" },
    create: { id: "gerente-teste", email: "gerente-teste@jornada.supervisora.teste", nome: "Gerente Teste" },
    update: {},
  });

  // Uma versão publicada do TA, para o contexto ter tom/regras de verdade.
  // Recriada do zero a cada corrida — este arquivo é o único que mexe na
  // config "ta" via jornada, então limpar por inteiro é seguro e mantém o
  // arquivo re-executável sem violar `@@unique([configId, numero])`.
  const config = await prisma.sdrIaConfig.upsert({
    where: { slug: "ta" },
    create: { slug: "ta", nome: "TA", ligado: true },
    update: { versaoAtivaId: null },
  });
  await prisma.sdrIaConfigVersao.deleteMany({ where: { configId: config.id } });
  const versao = await prisma.sdrIaConfigVersao.create({
    data: {
      configId: config.id,
      numero: 1,
      situacao: "PUBLICADA",
      identidade: "Agente Maria, do time Foocci",
      tomDeVoz: "direto, sem gíria, sem emoji em excesso",
      proibidos: ["prometer desconto sem autorização", "afirmar prazo de implantação"],
      publicadaEm: AGORA,
    },
  });
  await prisma.sdrIaConfig.update({ where: { id: config.id }, data: { versaoAtivaId: versao.id } });
});

afterAll(async () => {
  await prisma.$disconnect();
  process.env = { ...ambiente };
});

beforeEach(() => {
  criar.mockReset();
  enviar.mockReset();
  enviar.mockResolvedValue({ ok: true });
  ligarCanal();
});

describe("Jornada — modo OFF (comportamento de hoje, sem custo)", () => {
  it("nenhuma chamada à Supervisora acontece", async () => {
    await alterarModo(prisma, { novoModo: "OFF", novaLigada: true, alteradoPor: "teste" });

    const lead = await novoLead();
    const gravada = await registrarSaida(prisma, {
      leadId: lead.id,
      texto: "Oi! Claro, te ajudo. Quantas lojas vocês têm hoje?",
      autor: "IA",
      papelDoAgente: "qualificacao",
    });
    expect(gravada.ok).toBe(true);
    if (!gravada.ok) return;

    const r = await entregarMensagem(prisma, gravada.mensagemId, "maquina");

    expect(r.entregue).toBe(true);
    expect(criar).not.toHaveBeenCalled();

    const avaliacao = await prisma.supervisoraAvaliacao.findUnique({ where: { mensagemId: gravada.mensagemId } });
    expect(avaliacao).toBeNull();
  });
});

describe("Jornada — modo GUARD", () => {
  beforeEach(async () => {
    // ⛔ 13/09/2026 — `alterarModo` agora exige a escada (OFF→SHADOW→GUARD→
    // INTERVENTION, um degrau de cada vez; ver config.ts). Vindo de OFF (o
    // describe anterior termina lá), pedir GUARD direto seria um salto de 2 e
    // seria recusado. Passa por SHADOW primeiro; repetir o mesmo modo é
    // regressão/no-op e sempre aceito, então isto é seguro em toda rodada.
    await alterarModo(prisma, { novoModo: "SHADOW", novaLigada: true, alteradoPor: "teste" });
    await alterarModo(prisma, { novoModo: "GUARD", novaLigada: true, alteradoPor: "teste" });
  });

  it("1. mensagem normal → liberada sem reescrita (VERDE)", async () => {
    proximoJuizo({ veredito: "VERDE", motivos: [], detalhe: "resposta direta e no tom certo" });

    const lead = await novoLead();
    await prisma.leadMensagem.create({
      data: { leadId: lead.id, direcao: "ENTRADA", texto: "quanto custa?", ocorreuEm: AGORA },
    });
    const gravada = await registrarSaida(prisma, {
      leadId: lead.id,
      texto: "O plano mensal sai R$ 149 por loja. Quantas lojas vocês têm?",
      autor: "IA",
      papelDoAgente: "qualificacao",
      agora: AGORA,
    });
    if (!gravada.ok) throw new Error("não gravou");

    const r = await entregarMensagem(prisma, gravada.mensagemId, "maquina");

    expect(r.entregue).toBe(true);
    expect(enviar).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "O plano mensal sai R$ 149 por loja. Quantas lojas vocês têm?",
    );

    const msg = await prisma.leadMensagem.findUnique({ where: { id: gravada.mensagemId } });
    expect(msg?.texto).toBe("O plano mensal sai R$ 149 por loja. Quantas lojas vocês têm?");

    const avaliacao = await prisma.supervisoraAvaliacao.findUnique({ where: { mensagemId: gravada.mensagemId } });
    expect(avaliacao).toMatchObject({ veredito: "VERDE", bloqueada: false, acaoTomada: "NENHUMA" });
  });

  it("2. pitch invasivo → corrigido (AMARELO, texto reescrito de verdade)", async () => {
    const textoOriginal = "Você TEM que fechar hoje, essa condição não vai durar!";
    const textoCorrigido = "Essa condição vale até sexta. Quer que eu já reserve para vocês?";
    proximoJuizo({
      veredito: "AMARELO",
      motivos: ["PRESSAO_COMERCIAL"],
      detalhe: "usa urgência artificial (\"TEM que\", \"não vai durar\")",
      textoReescrito: textoCorrigido,
    });

    const lead = await novoLead();
    const gravada = await registrarSaida(prisma, {
      leadId: lead.id,
      texto: textoOriginal,
      autor: "IA",
      papelDoAgente: "closer",
      agora: AGORA,
    });
    if (!gravada.ok) throw new Error("não gravou");

    const r = await entregarMensagem(prisma, gravada.mensagemId, "maquina");

    expect(r.entregue).toBe(true);
    expect(enviar).toHaveBeenCalledWith(expect.anything(), expect.anything(), textoCorrigido);

    // ⭐ 10. GUARD aplica a correção DE VERDADE: o texto de `LeadMensagem` mudou
    // antes da entrega, não só o veredito foi anotado ao lado.
    const msg = await prisma.leadMensagem.findUnique({ where: { id: gravada.mensagemId } });
    expect(msg?.texto).toBe(textoCorrigido);

    const avaliacao = await prisma.supervisoraAvaliacao.findUnique({ where: { mensagemId: gravada.mensagemId } });
    expect(avaliacao).toMatchObject({
      veredito: "AMARELO",
      acaoTomada: "REESCREVEU",
      bloqueada: false,
      textoOriginal,
      textoReescrito: textoCorrigido,
    });
  });

  it("3. insistência depois de recusa → bloqueada (VERMELHO)", async () => {
    proximoJuizo({
      veredito: "VERMELHO",
      motivos: ["INSISTENCIA_APOS_RECUSA"],
      detalhe: "o lead já disse que não tem interesse agora, e a mensagem insiste no mesmo assunto",
    });

    const lead = await novoLead();
    const gravada = await registrarSaida(prisma, {
      leadId: lead.id,
      texto: "Só reforçando: temos uma condição especial se você fechar essa semana!",
      autor: "IA",
      papelDoAgente: "closer",
      agora: AGORA,
    });
    if (!gravada.ok) throw new Error("não gravou");

    const r = await entregarMensagem(prisma, gravada.mensagemId, "maquina");

    expect(r).toMatchObject({ entregue: false, motivo: "retidaPelaSupervisora" });
    expect(enviar).not.toHaveBeenCalled();

    const msg = await prisma.leadMensagem.findUnique({ where: { id: gravada.mensagemId } });
    // Continua PENDENTE — retido não é FALHOU (que é vocabulário de erro técnico
    // de envio; a régua de `entrega.ts` proíbe misturar os dois).
    expect(msg?.status).toBe("PENDENTE");

    const avaliacao = await prisma.supervisoraAvaliacao.findUnique({ where: { mensagemId: gravada.mensagemId } });
    expect(avaliacao).toMatchObject({ veredito: "VERMELHO", bloqueada: true, acaoTomada: "BLOQUEOU" });
  });

  it("4. opt-out → respeitado, sem a Supervisora precisar duplicar nada (regressão)", async () => {
    const lead = await novoLead({ optOutAt: AGORA });
    const gravada = await registrarSaida(prisma, {
      leadId: lead.id,
      texto: "Oi de novo! Vamos continuar nossa conversa?",
      autor: "IA",
      papelDoAgente: "qualificacao",
      agora: AGORA,
    });
    if (!gravada.ok) throw new Error("não gravou");

    const r = await entregarMensagem(prisma, gravada.mensagemId, "maquina");

    // O portão 3 (`LeadContactSafety`) barra ANTES de a Supervisora ser
    // chamada — ela nem roda.
    expect(r).toMatchObject({ entregue: false, motivo: "leadPediuSilencio" });
    expect(criar).not.toHaveBeenCalled();
    const avaliacao = await prisma.supervisoraAvaliacao.findUnique({ where: { mensagemId: gravada.mensagemId } });
    expect(avaliacao).toBeNull();
  });

  it("6. promessa inexistente já é barrada pelo verificador determinístico — a Supervisora não duplica", async () => {
    // `verificarResposta` roda dentro de `falar()`/`pensar()`, ANTES de
    // `registrarSaida`. Este teste prova que, se uma promessa de prazo
    // CHEGASSE até aqui (não deveria — é o caso do item 6 do comando), a
    // arquitetura não pede à Supervisora para reproduzir aquele motivo: a
    // camada rápida não tem "prometeuPrazo" no seu vocabulário de motivos.
    const { verificarResposta } = await import("@/services/salaDeVendas/ta/verificador");
    const veredito = verificarResposta("Em 3 dias você já está no ar, prometo!");
    expect(veredito.aprovada).toBe(false);
    expect(veredito.motivos).toContain("prometeuPrazo");
    // E o enum `MotivoDaSupervisora` do schema não tem esse nome — provando que
    // não existe um segundo lugar que reprova pelo mesmo motivo com um nome
    // diferente.
    const nomesDaSupervisora = [
      "MENSAGEM_INVASIVA", "INSISTENCIA_APOS_RECUSA", "PITCH_ERRADO", "TOM_ROBOTICO",
      "PROMESSA_INCORRETA", "PERSONALIZACAO_FRACA", "PRESSAO_COMERCIAL", "INTERROGATORIO",
      "SEQUENCIA_DE_MENSAGENS", "TIMING_RUIM", "FALHA_TECNICA", "OUTRO",
    ];
    expect(nomesDaSupervisora).not.toContain("prometeuPrazo");
  });

  it("7. desconto não autorizado → bloqueado via handoff.ts (PEDIU_DESCONTO), sem a Supervisora interferir", async () => {
    const { gatilhosQueDispararam } = await import("@/services/salaDeVendas/handoff");
    const disparados = gatilhosQueDispararam({ pediuDesconto: true });
    expect(disparados).toContain("PEDIU_DESCONTO");
    // Este caminho é resolvido em `atender.ts` ANTES de `falar()` compor
    // qualquer coisa (passo 6 do arquivo) — a mensagem de venda nunca chega a
    // ser gravada, então nunca chega a `entregarMensagem`. A Supervisora não
    // tem o que revisar aqui porque não há o que revisar.
  });

  it("5 / 15a. cliente irritado + falha técnica da Supervisora → RETIDA, nunca liberada às cegas", async () => {
    // A falha técnica, nas DUAS camadas — a irritação aciona a profunda mesmo
    // com a rápida falhando, então as duas chamadas precisam de resposta.
    criar.mockResolvedValue({
      choices: [{ message: { content: "não sou JSON nenhum" }, finish_reason: "stop" }],
    });

    const lead = await novoLead();
    // Irritação registrada na memória (mesmo detector que `atender.ts` já usa).
    await prisma.leadQualificacao.upsert({
      where: { leadId: lead.id },
      create: { leadId: lead.id, irritacao: 3 },
      update: { irritacao: 3 },
    });

    const gravada = await registrarSaida(prisma, {
      leadId: lead.id,
      texto: "Entendo. Posso te ajudar com mais alguma coisa?",
      autor: "IA",
      papelDoAgente: "recepcao",
      agora: AGORA,
    });
    if (!gravada.ok) throw new Error("não gravou");

    const r = await entregarMensagem(prisma, gravada.mensagemId, "maquina");

    // 15. GUARD com falha técnica: NUNCA libera às cegas.
    expect(r).toMatchObject({ entregue: false, motivo: "retidaPelaSupervisora" });
    expect(enviar).not.toHaveBeenCalled();

    const avaliacao = await prisma.supervisoraAvaliacao.findUnique({ where: { mensagemId: gravada.mensagemId } });
    expect(avaliacao?.falhaTecnica).toBe(true);
    expect(avaliacao?.bloqueada).toBe(true);
  });

  it("5. cliente irritado, mensagem crítica → CRITICO encaminha para gente (passarParaGente)", async () => {
    proximoJuizo({
      veredito: "CRITICO",
      motivos: ["INSISTENCIA_APOS_RECUSA", "PRESSAO_COMERCIAL"],
      detalhe: "o lead pediu para parar e a mensagem insiste em fechar",
      precisaDeGente: true,
      sugestaoPermanente: null,
    });

    const lead = await novoLead();
    await prisma.leadQualificacao.upsert({
      where: { leadId: lead.id },
      create: { leadId: lead.id, irritacao: 3, pediuHumano: false },
      update: { irritacao: 3 },
    });

    const gravada = await registrarSaida(prisma, {
      leadId: lead.id,
      texto: "Vamos fechar agora? É a última chance dessa condição.",
      autor: "IA",
      papelDoAgente: "closer",
      agora: AGORA,
    });
    if (!gravada.ok) throw new Error("não gravou");

    const r = await entregarMensagem(prisma, gravada.mensagemId, "maquina");

    expect(r).toMatchObject({ entregue: false, motivo: "retidaPelaSupervisora" });
    expect(enviar).not.toHaveBeenCalled();

    const avaliacao = await prisma.supervisoraAvaliacao.findUnique({ where: { mensagemId: gravada.mensagemId } });
    expect(avaliacao).toMatchObject({ veredito: "CRITICO", acaoTomada: "BLOQUEOU_E_ESCALOU", handoffDisparado: true });

    const leadDepois = await prisma.siteLead.findUnique({ where: { id: lead.id } });
    expect(leadDepois?.atendidoPor).toBe("AGUARDANDO_HUMANO");

    const handoff = await prisma.leadHandoff.findFirst({ where: { leadId: lead.id }, orderBy: { createdAt: "desc" } });
    expect(handoff?.motivo).toBe("RISCO");
  });
});

describe("Jornada — modo SHADOW", () => {
  beforeEach(async () => {
    await alterarModo(prisma, { novoModo: "SHADOW", novaLigada: true, alteradoPor: "teste" });
  });

  it("9. grava o veredito, e a mensagem sai INALTERADA mesmo quando o veredito seria VERMELHO", async () => {
    const textoOriginal = "Só reforçando: essa condição não vai durar, feche agora!";
    proximoJuizo({
      veredito: "VERMELHO",
      motivos: ["INSISTENCIA_APOS_RECUSA", "PRESSAO_COMERCIAL"],
      detalhe: "insiste depois de recusa, com pressão de urgência",
    });

    const lead = await novoLead();
    const gravada = await registrarSaida(prisma, {
      leadId: lead.id,
      texto: textoOriginal,
      autor: "IA",
      papelDoAgente: "closer",
      agora: AGORA,
    });
    if (!gravada.ok) throw new Error("não gravou");

    const r = await entregarMensagem(prisma, gravada.mensagemId, "maquina");

    // Sai EXATAMENTE como sairia sem a Supervisora — e sai antes de a
    // avaliação (assíncrona desde 12/09/2026) sequer ter tido tempo de
    // terminar, por isso o texto abaixo já está disponível na hora.
    expect(r.entregue).toBe(true);
    expect(enviar).toHaveBeenCalledWith(expect.anything(), expect.anything(), textoOriginal);

    const msg = await prisma.leadMensagem.findUnique({ where: { id: gravada.mensagemId } });
    expect(msg?.texto).toBe(textoOriginal);

    // ⭐ A avaliação chega DEPOIS — `entregarMensagem` não espera por ela.
    const avaliacao = await esperarAvaliacao(gravada.mensagemId);
    expect(avaliacao).toMatchObject({
      veredito: "VERMELHO",
      bloqueada: false,
      acaoTomada: "NENHUMA",
      handoffDisparado: false,
      modoNaEpoca: "SHADOW",
    });

    // Não escalou: o lead continua com a IA.
    const leadDepois = await prisma.siteLead.findUnique({ where: { id: lead.id } });
    expect(leadDepois?.atendidoPor).toBe("IA");
  });

  it("15b. falha da Supervisora em SHADOW não derruba o turno — a mensagem sai normalmente", async () => {
    criar.mockResolvedValueOnce({ choices: [{ message: { content: "isto não é JSON" }, finish_reason: "stop" }] });

    const lead = await novoLead();
    const gravada = await registrarSaida(prisma, {
      leadId: lead.id,
      texto: "Perfeito! Vamos seguir então.",
      autor: "IA",
      papelDoAgente: "qualificacao",
      agora: AGORA,
    });
    if (!gravada.ok) throw new Error("não gravou");

    const r = await entregarMensagem(prisma, gravada.mensagemId, "maquina");

    expect(r.entregue).toBe(true);
    expect(enviar).toHaveBeenCalled();

    // A falha (JSON que não parseia) foi registrada, e não silenciada — a
    // Supervisora continua tentando, só que agora em segundo plano.
    const avaliacao = await esperarAvaliacao(gravada.mensagemId);
    expect(avaliacao.falhaTecnica).toBe(true);
    expect(avaliacao.modoNaEpoca).toBe("SHADOW");
  });

  it("⭐ 16. SHADOW NÃO ATRASA a entrega — a mensagem sai antes de a avaliação (lenta de propósito) terminar", async () => {
    // O "juízo" da Supervisora demora 2s para responder — uma camada rápida
    // lenta de verdade, não um dublê instantâneo. Se `entregarMensagem` ainda
    // esperasse por ela (o defeito medido em 12/09/2026), este teste levaria
    // pelo menos 2s. Ele não deveria — SHADOW dispara e segue.
    criar.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                choices: [
                  {
                    message: { content: JSON.stringify({ veredito: "VERDE", motivos: [], detalhe: "ok" }) },
                    finish_reason: "stop",
                  },
                ],
              }),
            2_000,
          );
        }),
    );

    const textoOriginal = "Show, te mando os detalhes por aqui mesmo.";
    const lead = await novoLead();
    const gravada = await registrarSaida(prisma, {
      leadId: lead.id,
      texto: textoOriginal,
      autor: "IA",
      papelDoAgente: "qualificacao",
      agora: AGORA,
    });
    if (!gravada.ok) throw new Error("não gravou");

    const inicio = Date.now();
    const r = await entregarMensagem(prisma, gravada.mensagemId, "maquina");
    const decorridoAteEntregar = Date.now() - inicio;

    expect(r.entregue).toBe(true);
    expect(enviar).toHaveBeenCalledWith(expect.anything(), expect.anything(), textoOriginal);

    // ⭐ O NÚMERO QUE PROVA O ITEM: a entrega termina em uma fração dos 2s que
    // a avaliação está levando — bem abaixo do teto de folga usado aqui
    // (metade do atraso simulado). Medido, não afirmado: ver o console.log.
    console.log(`[prova SHADOW não bloqueia] entregarMensagem terminou em ${decorridoAteEntregar}ms (avaliação simulada: 2000ms)`);
    expect(decorridoAteEntregar).toBeLessThan(1_000);

    // A avaliação, no entanto, chega — só que depois, em segundo plano.
    const avaliacao = await esperarAvaliacao(gravada.mensagemId, 5_000);
    expect(avaliacao.veredito).toBe("VERDE");
  });
});

describe("Jornada — sem SupervisoraConfig no banco, o modo efetivo é OFF", () => {
  it("⭐ 17. ausência de configuração NUNCA vira SHADOW sozinha — nenhuma avaliação roda", async () => {
    // Nenhum `alterarModo` foi chamado nesta suíte ainda: a linha singleton
    // não existe. Isto é o estado do dia em que a tabela é criada e ninguém
    // decidiu nada — e "ninguém decidiu" tem que valer OFF, não SHADOW.
    await prisma.supervisoraAvaliacao.deleteMany({});
    await prisma.supervisoraConfig.deleteMany({});

    const lead = await novoLead();
    const gravada = await registrarSaida(prisma, {
      leadId: lead.id,
      texto: "Oi! Sem problema, te explico certinho.",
      autor: "IA",
      papelDoAgente: "qualificacao",
      agora: AGORA,
    });
    if (!gravada.ok) throw new Error("não gravou");

    const r = await entregarMensagem(prisma, gravada.mensagemId, "maquina");

    expect(r.entregue).toBe(true);
    expect(criar).not.toHaveBeenCalled();

    // Dá tempo de sobra para uma avaliação em segundo plano aparecer, SE ela
    // tivesse sido disparada por engano — e confere que não apareceu.
    await new Promise((r2) => setTimeout(r2, 300));
    const avaliacao = await prisma.supervisoraAvaliacao.findUnique({ where: { mensagemId: gravada.mensagemId } });
    expect(avaliacao).toBeNull();
  });
});

describe("Jornada — ativar a Supervisora pela rota é ato explícito e registrado", () => {
  it("⭐ 18. `alterarModo` (o mecanismo por trás da rota POST) grava em SupervisoraModoHistorico com quem e quando", async () => {
    await prisma.supervisoraModoHistorico.deleteMany({});
    await prisma.supervisoraConfig.deleteMany({});

    const agora = new Date("2026-09-12T18:00:00Z");
    const r = await alterarModo(prisma, {
      novoModo: "SHADOW",
      novaLigada: true,
      alteradoPor: "gerente-teste",
      motivo: "estreia da Supervisora, decisão do CEO",
      agora,
    });

    expect(r).toMatchObject({ ok: true, modoAnterior: "OFF", modoNovo: "SHADOW" });

    const estado = await prisma.supervisoraConfig.findUnique({ where: { id: "singleton" } });
    expect(estado).toMatchObject({ ligada: true, modo: "SHADOW", atualizadoPor: "gerente-teste" });

    const historico = await prisma.supervisoraModoHistorico.findFirst({
      where: { alteradoPor: "gerente-teste" },
      orderBy: { alteradoEm: "desc" },
    });
    expect(historico).toMatchObject({
      modoAnterior: "OFF",
      modoNovo: "SHADOW",
      alteradoPor: "gerente-teste",
      motivo: "estreia da Supervisora, decisão do CEO",
    });
    expect(historico?.alteradoEm.toISOString()).toBe(agora.toISOString());
  });
});

describe("Jornada — modo INTERVENTION", () => {
  beforeEach(async () => {
    // Mesma régua: sobe um degrau de cada vez (o teste 18, logo acima, deixa
    // o estado em SHADOW) — SHADOW→INTERVENTION direto seria um salto de 2.
    await alterarModo(prisma, { novoModo: "SHADOW", novaLigada: true, alteradoPor: "teste" });
    await alterarModo(prisma, { novoModo: "GUARD", novaLigada: true, alteradoPor: "teste" });
    await alterarModo(prisma, { novoModo: "INTERVENTION", novaLigada: true, alteradoPor: "teste" });
  });

  it("11a. GUARD+ ainda vale: CRITICO bloqueia e escala igual a GUARD", async () => {
    proximoJuizo({
      veredito: "CRITICO",
      motivos: ["MENSAGEM_INVASIVA"],
      detalhe: "ignora o pedido de silêncio do lead",
      precisaDeGente: true,
    });

    const lead = await novoLead();
    await prisma.leadQualificacao.upsert({
      where: { leadId: lead.id },
      create: { leadId: lead.id, pediuPararSondagem: true },
      update: { pediuPararSondagem: true },
    });

    const gravada = await registrarSaida(prisma, {
      leadId: lead.id,
      texto: "Só mais uma pergunta rápida: qual seu faturamento mensal?",
      autor: "IA",
      papelDoAgente: "qualificacao",
      agora: AGORA,
    });
    if (!gravada.ok) throw new Error("não gravou");

    const r = await entregarMensagem(prisma, gravada.mensagemId, "maquina");
    expect(r).toMatchObject({ entregue: false, motivo: "retidaPelaSupervisora" });

    const leadDepois = await prisma.siteLead.findUnique({ where: { id: lead.id } });
    expect(leadDepois?.atendidoPor).toBe("AGUARDANDO_HUMANO");
  });

  it("11b. ⭐ a capacidade EXCLUSIVA de INTERVENTION: pausa fora do fluxo de uma mensagem de saída", async () => {
    // Um lead que já pediu humano, sem NENHUMA mensagem de saída pendente —
    // GUARD nunca chegaria a olhar para ele, porque GUARD só age quando HÁ algo
    // saindo. `varrerConversasEmAndamento` é o que INTERVENTION tem a mais.
    const lead = await novoLead();
    await prisma.leadQualificacao.upsert({
      where: { leadId: lead.id },
      create: { leadId: lead.id, pediuHumano: true },
      update: { pediuHumano: true },
    });

    const resultado = await varrerConversasEmAndamento(prisma, AGORA);

    expect(resultado.rodou).toBe(true);
    expect(resultado.leadsPausados.map((p) => p.leadId)).toContain(lead.id);

    const leadDepois = await prisma.siteLead.findUnique({ where: { id: lead.id } });
    expect(leadDepois?.atendidoPor).toBe("AGUARDANDO_HUMANO");
  });

  it("a varredura NÃO roda em GUARD — só INTERVENTION tem esta capacidade", async () => {
    await alterarModo(prisma, { novoModo: "GUARD", novaLigada: true, alteradoPor: "teste" });
    const resultado = await varrerConversasEmAndamento(prisma, AGORA);
    expect(resultado).toMatchObject({ rodou: false, leadsAvaliados: 0, leadsPausados: [] });
  });
});

describe("Jornada — repetição pelo mesmo agente aciona a camada profunda", () => {
  beforeEach(async () => {
    await alterarModo(prisma, { novoModo: "GUARD", novaLigada: true, alteradoPor: "teste" });
  });

  it("duas reprovações recentes do mesmo agente contam, e acionam a profunda mesmo com a rápida em VERDE", async () => {
    const lead1 = await novoLead();
    const lead2 = await novoLead();
    const AUTOR = "sdr-humano-teste-1";

    // Duas reprovações prévias, do MESMO autor, em leads diferentes.
    for (const lead of [lead1, lead2]) {
      const msg = await prisma.leadMensagem.create({
        data: { leadId: lead.id, direcao: "SAIDA", status: "ENVIADA", texto: "x", autor: "HUMANO", autorUserId: AUTOR, ocorreuEm: AGORA },
      });
      await prisma.supervisoraAvaliacao.create({
        data: {
          mensagemId: msg.id,
          leadId: lead.id,
          autorUserId: AUTOR,
          camada: "RAPIDA",
          modoNaEpoca: "GUARD",
          veredito: "VERMELHO",
          motivos: ["PRESSAO_COMERCIAL"],
          motivoDetalhe: "anterior",
          bloqueada: true,
          acaoTomada: "BLOQUEOU",
          criadaEm: AGORA,
        },
      });
    }

    const contagem = await contarReprovacoesRecentes(prisma, { autorUserId: AUTOR, desde: new Date(AGORA.getTime() - 3600_000) });
    expect(contagem).toBe(2);

    // Terceira mensagem do MESMO autor: a rápida aprova (VERDE), mas o padrão
    // de repetição deveria acionar a profunda mesmo assim.
    proximoJuizo({ veredito: "VERDE", motivos: [], detalhe: "parece ok isoladamente" });
    proximoJuizo({ veredito: "VERMELHO", motivos: ["PRESSAO_COMERCIAL"], detalhe: "padrão recorrente deste agente", sugestaoPermanente: "revisar o roteiro de fechamento deste agente" });

    const lead3 = await novoLead();
    const gravada = await registrarSaida(prisma, {
      leadId: lead3.id,
      texto: "Mensagem nova, aparentemente neutra.",
      autor: "HUMANO",
      autorUserId: AUTOR,
      agora: AGORA,
    });
    if (!gravada.ok) throw new Error("não gravou");

    const r = await entregarMensagem(prisma, gravada.mensagemId, "pessoa");

    expect(r).toMatchObject({ entregue: false, motivo: "retidaPelaSupervisora" });
    const avaliacao = await prisma.supervisoraAvaliacao.findUnique({ where: { mensagemId: gravada.mensagemId } });
    expect(avaliacao).toMatchObject({ camada: "PROFUNDA", veredito: "VERMELHO" });

    // E o nível 2 registrou uma sugestão para revisão humana.
    const sugestao = await prisma.supervisoraSugestaoDePrompt.findFirst({
      where: { agenteAfetadoUserId: AUTOR },
      orderBy: { criadaEm: "desc" },
    });
    expect(sugestao?.situacao).toBe("PENDENTE");
    expect(sugestao?.evidenciaMensagemIds).toContain(gravada.mensagemId);
  });
});

describe("Jornada — desempenho por agente (item 5)", () => {
  it("agrega por autorUserId as avaliações já gravadas", async () => {
    const desempenho = await desempenhoPorAgente(prisma, { autorUserId: "sdr-humano-teste-1" });
    expect(desempenho.length).toBeGreaterThan(0);
    const linha = desempenho[0]!;
    expect(linha.total).toBeGreaterThanOrEqual(3);
    expect(linha.porVeredito.VERMELHO).toBeGreaterThanOrEqual(2);
  });
});

describe("Jornada — evolução de prompt, nível 3 (versão nova) e rollback", () => {
  it("12. cria uma SdrIaConfigVersao nova com os metadados completos, a partir de uma sugestão aprovada", async () => {
    const lead = await novoLead();
    const s = await registrarSugestao(prisma, {
      papelDoAgente: "closer",
      problemaObservado: "O agente promete desconto sem ter autorização.",
      evidenciaMensagemIds: ["m1", "m2"],
      evidenciaLeadIds: [lead.id],
      trechoAnterior: "proibidos: [\"prometer desconto sem autorização\"]",
      trechoNovoProposto: "proibidos: [\"prometer desconto sem autorização\", \"oferecer parcelamento não publicado\"]",
      justificativa: "Duas conversas diferentes mostraram o mesmo padrão de oferta indevida.",
    });
    expect(s.ok).toBe(true);
    if (!s.ok) return;

    await prisma.supervisoraSugestaoDePrompt.update({
      where: { id: s.sugestaoId },
      data: { situacao: "APROVADA", revisadaPorId: "gerente-teste" },
    });

    const r = await aprovarSugestaoECriarVersao(prisma, {
      sugestaoId: s.sugestaoId,
      patch: { proibidos: ["prometer desconto sem autorização", "oferecer parcelamento não publicado"] },
      criadaPorId: "gerente-teste",
      testeCorrespondente: "scripts/jornada-supervisora.test.ts",
    });

    expect(r).toMatchObject({ ok: true });
    if (!("versaoId" in r)) throw new Error("esperava sucesso");

    const versao = await prisma.sdrIaConfigVersao.findUnique({ where: { id: r.versaoId } });
    expect(versao).toMatchObject({
      situacao: "RASCUNHO",
      agenteAfetado: "closer",
      problemaObservado: "O agente promete desconto sem ter autorização.",
      justificativaDaAlteracao: "Duas conversas diferentes mostraram o mesmo padrão de oferta indevida.",
      criadaPorId: "gerente-teste",
      testeCorrespondente: "scripts/jornada-supervisora.test.ts",
    });
    expect(versao?.evidencias).toEqual(["m1", "m2"]);
    expect(versao?.proibidos).toContain("oferecer parcelamento não publicado");

    // Nunca publica sozinha.
    const configDepois = await prisma.sdrIaConfig.findUnique({ where: { slug: "ta" } });
    expect(configDepois?.versaoAtivaId).not.toBe(r.versaoId);

    const sugestaoDepois = await prisma.supervisoraSugestaoDePrompt.findUnique({ where: { id: s.sugestaoId } });
    expect(sugestaoDepois?.situacao).toBe("APLICADA");
    expect(sugestaoDepois?.versaoResultanteId).toBe(r.versaoId);
  });

  it("recusa criar versão a partir de sugestão com 1 evidência só, sem `erroGrave`", async () => {
    const s = await registrarSugestao(prisma, {
      problemaObservado: "Um caso isolado.",
      evidenciaMensagemIds: ["m-unica"],
      evidenciaLeadIds: [],
      justificativa: "Só uma conversa.",
    });
    if (!s.ok) throw new Error("deveria ter registrado");
    await prisma.supervisoraSugestaoDePrompt.update({ where: { id: s.sugestaoId }, data: { situacao: "APROVADA" } });

    const r = await aprovarSugestaoECriarVersao(prisma, {
      sugestaoId: s.sugestaoId,
      patch: {},
      criadaPorId: "gerente-teste",
    });

    expect(r).toMatchObject({ ok: false, causa: "evidenciaInsuficiente" });
  });

  it("13. rollback: publicar uma versão ANTERIOR desfaz a mudança", async () => {
    const configAntes = await prisma.sdrIaConfig.findUnique({ where: { slug: "ta" }, select: { id: true, versaoAtivaId: true } });
    const versaoOriginal = configAntes!.versaoAtivaId!;

    // Publica uma nova (simulando que a sugestão do teste anterior foi
    // aprovada e publicada).
    const novaVersao = await prisma.sdrIaConfigVersao.findFirst({
      where: { configId: configAntes!.id, situacao: "RASCUNHO" },
      orderBy: { numero: "desc" },
    });
    if (!novaVersao) throw new Error("preciso de uma versão RASCUNHO do teste anterior");

    const pub = await publicarVersaoExistente(prisma, { versaoId: novaVersao.id, porUserId: "gerente-teste" });
    expect(pub).toMatchObject({ ok: true, eraAAtiva: false });

    const configDepoisDePublicar = await prisma.sdrIaConfig.findUnique({ where: { slug: "ta" } });
    expect(configDepoisDePublicar?.versaoAtivaId).toBe(novaVersao.id);

    // Rollback: publica a ORIGINAL de volta.
    const rollback = await publicarVersaoExistente(prisma, { versaoId: versaoOriginal, porUserId: "gerente-teste" });
    expect(rollback).toMatchObject({ ok: true });

    const configFinal = await prisma.sdrIaConfig.findUnique({ where: { slug: "ta" } });
    expect(configFinal?.versaoAtivaId).toBe(versaoOriginal);
  });
});
