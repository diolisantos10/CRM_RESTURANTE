/**
 * AS TRAVAS DO PRIMEIRO CONTATO.
 *
 * O fio deste arquivo: **a casa passa a falar primeiro, e falar primeiro é o ato
 * mais fácil de estragar.** Cada teste aqui é uma forma concreta de estragar —
 * abordar quem pediu silêncio, abordar duas vezes, insistir uma terceira,
 * escrever de madrugada, mandar texto livre onde a Meta exige modelo, estourar o
 * teto do dia, ou consumir a fila só de olhar para ela.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { modeloAprovado, renderizarModelo, primeiroNome } from "@/services/foocci-sdr/ModeloAprovado";
import { lerTeto, TETO_MAXIMO_POR_DIA, configDoPrimeiroContato } from "./config";
import { montarFilaDePrimeiroContato } from "./fila";
import { abordarLead } from "./disparo";
import { rodarPrimeiroContato } from "./rodada";

/** Quarta-feira, 14h em São Paulo — dentro da janela, para não misturar causas. */
const AGORA = new Date("2026-09-02T17:00:00Z");

const CHAVES = [
  "FOOCCI_PRIMEIRO_CONTATO_LIGADO",
  "FOOCCI_PRIMEIRO_CONTATO_TETO_DIARIO",
  "FOOCCI_SALES_TEMPLATE_ABERTURA",
  "FOOCCI_SALES_TEMPLATE_ABERTURA_IDIOMA",
  "FOOCCI_SALES_TEMPLATE_ABERTURA_PARAMS",
  "FOOCCI_SALES_TEMPLATE_ABERTURA_CORPO",
  "FOOCCI_SALES_TEMPLATE_LEMBRETE",
  "FOOCCI_SALES_TEMPLATE_LEMBRETE_PARAMS",
  "FOOCCI_SDR_SEND_ENABLED",
  "FOOCCI_SALES_PHONE_NUMBER_ID",
  "FOOCCI_SALES_ACCESS_TOKEN",
  "FOOCCI_SALES_PROVIDER",
] as const;

const guardado: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const c of CHAVES) {
    guardado[c] = process.env[c];
    delete process.env[c];
  }
});

afterEach(() => {
  for (const c of CHAVES) {
    if (guardado[c] === undefined) delete process.env[c];
    else process.env[c] = guardado[c];
  }
  vi.restoreAllMocks();
});

/** Liga tudo: canal da Meta, envio do SDR, primeiro contato e os dois modelos. */
function ligarTudo(teto = 20) {
  process.env.FOOCCI_SALES_PHONE_NUMBER_ID = "123456";
  process.env.FOOCCI_SALES_ACCESS_TOKEN = "token-de-teste";
  process.env.FOOCCI_SDR_SEND_ENABLED = "true";
  process.env.FOOCCI_PRIMEIRO_CONTATO_LIGADO = "true";
  process.env.FOOCCI_PRIMEIRO_CONTATO_TETO_DIARIO = String(teto);
  process.env.FOOCCI_SALES_TEMPLATE_ABERTURA = "foocci_abertura_v1";
  process.env.FOOCCI_SALES_TEMPLATE_ABERTURA_PARAMS = "nome";
  process.env.FOOCCI_SALES_TEMPLATE_ABERTURA_CORPO = "Oi {{1}}, aqui é da Foocci.";
  process.env.FOOCCI_SALES_TEMPLATE_LEMBRETE = "foocci_lembrete_v1";
}

const LEAD = {
  id: "lead1",
  nome: "José Carlos da Silva",
  whatsapp: "5511987654321",
  restaurante: "Cantina do Zé",
  cidade: "São Paulo",
  optOutAt: null as Date | null,
  consentAt: new Date("2026-09-01T12:00:00Z"),
  createdAt: new Date("2026-09-01T12:00:00Z"),
  lastContactedAt: null as Date | null,
  stage: "NOVO" as const,
};

interface EstadoDoBanco {
  leads?: unknown[];
  lead?: unknown | null;
  tentativas?: number;
  usadosHoje?: number;
  reserva?: number;
}

function fakeDb(estado: EstadoDoBanco = {}) {
  const db: Record<string, any> = {
    siteLead: {
      findMany: vi.fn(async () => estado.leads ?? [LEAD]),
      findFirst: vi.fn(async () => (estado.lead === undefined ? LEAD : estado.lead)),
      findUnique: vi.fn(async () => (estado.lead === undefined ? LEAD : estado.lead)),
      updateMany: vi.fn(async () => ({ count: estado.reserva ?? 1 })),
      update: vi.fn(async () => ({})),
    },
    leadMensagem: {
      count: vi.fn(async () => estado.tentativas ?? 0),
      create: vi.fn(async () => ({ id: "msg1" })),
      update: vi.fn(async () => ({})),
    },
    siteLeadInteraction: {
      count: vi.fn(async () => estado.usadosHoje ?? 0),
      create: vi.fn(async () => ({})),
    },
    leadCadencia: { updateMany: vi.fn(async () => ({ count: 0 })) },
    leadTarefa: { create: vi.fn(async () => ({})) },
  };
  db.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return db;
}

/** A Meta aceitando. Nenhum teste deste arquivo toca a rede de verdade. */
function metaAceita() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// O MODELO APROVADO — a trava que a Meta impõe e o código passou a impor
// ═══════════════════════════════════════════════════════════════════════════

describe("modelo aprovado pela Meta", () => {
  it("⛔ sem nome declarado no ambiente, não existe modelo", () => {
    // O estado real de 05/09/2026: nenhum modelo declarado no repositório.
    expect(modeloAprovado("ABERTURA")).toBeNull();
    expect(modeloAprovado("LEMBRETE")).toBeNull();
  });

  it("lê nome, idioma e parâmetros; pt_BR é o padrão", () => {
    process.env.FOOCCI_SALES_TEMPLATE_ABERTURA = "foocci_abertura_v1";
    process.env.FOOCCI_SALES_TEMPLATE_ABERTURA_PARAMS = "nome, restaurante";
    const m = modeloAprovado("ABERTURA")!;
    expect(m.nome).toBe("foocci_abertura_v1");
    expect(m.idioma).toBe("pt_BR");
    expect(m.parametros).toEqual(["nome", "restaurante"]);
  });

  it("⛔ parâmetro fora da lista fechada invalida o modelo inteiro", () => {
    // O caso: alguém escreve `PARAMS=desafio` achando que preenche {{1}}. Sem
    // esta recusa, o modelo sairia com um parâmetro a menos e a Meta rejeitaria
    // no primeiro lead real — longe de quem digitou.
    process.env.FOOCCI_SALES_TEMPLATE_ABERTURA = "foocci_abertura_v1";
    process.env.FOOCCI_SALES_TEMPLATE_ABERTURA_PARAMS = "desafio";
    expect(modeloAprovado("ABERTURA")).toBeNull();
  });

  it("usa o PRIMEIRO nome, não o nome do formulário inteiro", () => {
    expect(primeiroNome("José Carlos da Silva Júnior")).toBe("José");
  });

  it("⛔ parâmetro sem dado é recusa, nunca espaço em branco", () => {
    process.env.FOOCCI_SALES_TEMPLATE_ABERTURA = "x";
    process.env.FOOCCI_SALES_TEMPLATE_ABERTURA_PARAMS = "restaurante";
    const r = renderizarModelo(modeloAprovado("ABERTURA")!, {
      nome: "Ana",
      restaurante: "   ",
      cidade: null,
    });
    expect(r.ok).toBe(false);
  });

  it("o texto guardado na conversa é o corpo aprovado, com o parâmetro no lugar", () => {
    process.env.FOOCCI_SALES_TEMPLATE_ABERTURA = "x";
    process.env.FOOCCI_SALES_TEMPLATE_ABERTURA_PARAMS = "nome";
    process.env.FOOCCI_SALES_TEMPLATE_ABERTURA_CORPO = "Oi {{1}}, aqui é da Foocci.";
    const r = renderizarModelo(modeloAprovado("ABERTURA")!, {
      nome: "Ana Paula",
      restaurante: null,
      cidade: null,
    });
    expect(r.ok && r.texto).toBe("Oi Ana, aqui é da Foocci.");
  });

  it("sem corpo declarado, guarda uma linha descritiva — nunca uma frase inventada", () => {
    process.env.FOOCCI_SALES_TEMPLATE_ABERTURA = "foocci_abertura_v1";
    process.env.FOOCCI_SALES_TEMPLATE_ABERTURA_PARAMS = "nome";
    const r = renderizarModelo(modeloAprovado("ABERTURA")!, {
      nome: "Ana",
      restaurante: null,
      cidade: null,
    });
    expect(r.ok && r.texto).toBe('[modelo aprovado "foocci_abertura_v1" (Ana)]');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A CHAVE E O TETO
// ═══════════════════════════════════════════════════════════════════════════

describe("chave e teto", () => {
  it("nasce desligado e com teto zero", () => {
    const c = configDoPrimeiroContato();
    expect(c.ligado).toBe(false);
    expect(c.tetoDiario).toBe(0);
  });

  it("⛔ teto que não é número vira ZERO, nunca um padrão generoso", () => {
    expect(lerTeto("vinte")).toBe(0);
    expect(lerTeto("-5")).toBe(0);
    expect(lerTeto(undefined)).toBe(0);
  });

  it("o teto tem teto: nem que digitem 5000", () => {
    expect(lerTeto("5000")).toBe(TETO_MAXIMO_POR_DIA);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A FILA — leitura, e só leitura
// ═══════════════════════════════════════════════════════════════════════════

describe("fila do primeiro contato", () => {
  it("⛔ desligada, a fila volta vazia e diz por quê", async () => {
    const db = fakeDb();
    const fila = await montarFilaDePrimeiroContato(db as never, { canalPronto: true, agora: AGORA });
    expect(fila.liberados).toHaveLength(0);
    expect(fila.motivoDaFilaVazia).toContain("desligado");
    // E não chega a olhar a base: fila desligada não custa consulta de lead.
    expect(db.siteLead.findMany).not.toHaveBeenCalled();
  });

  it("⛔ teto zero é 'nada sai', mesmo com a chave ligada", async () => {
    process.env.FOOCCI_PRIMEIRO_CONTATO_LIGADO = "true";
    const db = fakeDb();
    const fila = await montarFilaDePrimeiroContato(db as never, { canalPronto: true, agora: AGORA });
    expect(fila.motivoDaFilaVazia).toContain("zero");
    expect(db.siteLead.findMany).not.toHaveBeenCalled();
  });

  it("⛔ teto do dia já gasto barra a fila inteira", async () => {
    ligarTudo(3);
    const db = fakeDb({ usadosHoje: 3 });
    const fila = await montarFilaDePrimeiroContato(db as never, { canalPronto: true, agora: AGORA });
    expect(fila.motivoDaFilaVazia).toContain("Teto do dia atingido (3/3)");
  });

  it("libera quem preencheu o formulário e nunca escreveu", async () => {
    ligarTudo();
    const db = fakeDb();
    const fila = await montarFilaDePrimeiroContato(db as never, { canalPronto: true, agora: AGORA });
    expect(fila.liberados).toHaveLength(1);
    expect(fila.liberados[0]!.papel).toBe("ABERTURA");
    expect(fila.liberados[0]!.modelo).toBe("foocci_abertura_v1");
  });

  it("⛔ MONTAR A FILA NÃO ESCREVE NADA — a lição da prospecção", async () => {
    ligarTudo();
    const db = fakeDb();
    await montarFilaDePrimeiroContato(db as never, { canalPronto: true, agora: AGORA });
    expect(db.siteLead.update).not.toHaveBeenCalled();
    expect(db.siteLead.updateMany).not.toHaveBeenCalled();
    expect(db.leadMensagem.create).not.toHaveBeenCalled();
    expect(db.siteLeadInteraction.create).not.toHaveBeenCalled();
  });

  it("⛔ quem JÁ ESCREVEU não entra: esse é do caminho reativo", async () => {
    ligarTudo();
    const db = fakeDb();
    await montarFilaDePrimeiroContato(db as never, { canalPronto: true, agora: AGORA });
    const where = db.siteLead.findMany.mock.calls[0]![0].where;
    expect(where.mensagens).toEqual({ none: { direcao: "ENTRADA" } });
    // E quem pediu silêncio nem é lido.
    expect(where.optOutAt).toBeNull();
    // Lista de prospecção tem portão próprio e não passa por aqui.
    expect(where.fonte.in).toEqual(["FORMULARIO_DEMONSTRACAO", "AGENDAMENTO"]);
    // Se uma pessoa assumiu, o robô cala.
    expect(where.atendidoPor.in).toEqual(["NINGUEM", "IA"]);
  });

  it("⛔ sem modelo aprovado, todo mundo é barrado com o motivo certo", async () => {
    ligarTudo();
    delete process.env.FOOCCI_SALES_TEMPLATE_ABERTURA;
    const db = fakeDb();
    const fila = await montarFilaDePrimeiroContato(db as never, { canalPronto: true, agora: AGORA });
    expect(fila.liberados).toHaveLength(0);
    expect(fila.barrados[0]!.decisao.reason).toBe("SEM_MODELO_APROVADO");
  });

  it("⛔ com o envio do SDR desligado, o portão barra por CANAL_INDISPONIVEL", async () => {
    ligarTudo();
    const db = fakeDb();
    const fila = await montarFilaDePrimeiroContato(db as never, { canalPronto: false, agora: AGORA });
    expect(fila.barrados[0]!.decisao.reason).toBe("CANAL_INDISPONIVEL");
  });

  it("⛔ terceira tentativa não existe: uma abertura e um lembrete", async () => {
    ligarTudo();
    const db = fakeDb({ tentativas: 2, leads: [{ ...LEAD, lastContactedAt: new Date("2026-08-20T12:00:00Z") }] });
    const fila = await montarFilaDePrimeiroContato(db as never, { canalPronto: true, agora: AGORA });
    expect(fila.barrados[0]!.decisao.reason).toBe("TETO_DE_TENTATIVAS");
  });

  it("quem já recebeu a abertura entra como LEMBRETE", async () => {
    ligarTudo();
    const db = fakeDb({
      tentativas: 1,
      leads: [{ ...LEAD, lastContactedAt: new Date("2026-08-25T12:00:00Z") }],
    });
    const fila = await montarFilaDePrimeiroContato(db as never, { canalPronto: true, agora: AGORA });
    expect(fila.liberados[0]!.papel).toBe("LEMBRETE");
    expect(fila.liberados[0]!.modelo).toBe("foocci_lembrete_v1");
  });

  it("⛔ formulário de mais de 90 dias não é interesse vivo", async () => {
    ligarTudo();
    const velho = new Date("2026-01-10T12:00:00Z");
    const db = fakeDb({ leads: [{ ...LEAD, consentAt: velho, createdAt: velho }] });
    const fila = await montarFilaDePrimeiroContato(db as never, { canalPronto: true, agora: AGORA });
    expect(fila.barrados[0]!.decisao.reason).toBe("CONSENTIMENTO_VENCIDO");
  });

  it("⛔ domingo não se aborda ninguém", async () => {
    ligarTudo();
    const db = fakeDb();
    const domingo = new Date("2026-09-06T15:00:00Z");
    const fila = await montarFilaDePrimeiroContato(db as never, { canalPronto: true, agora: domingo });
    expect(fila.barrados[0]!.decisao.reason).toBe("FORA_DA_JANELA");
  });

  it("o teto do dia é contado por EVENTO de abordagem, não por lead", async () => {
    ligarTudo();
    const db = fakeDb();
    await montarFilaDePrimeiroContato(db as never, { canalPronto: true, agora: AGORA });
    const where = db.siteLeadInteraction.count.mock.calls[0]![0].where;
    expect(where.actor).toBe("primeiro-contato");
    expect(where.tipo).toBe("MENSAGEM_ENVIADA");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// O DISPARO — o único que fala com alguém
// ═══════════════════════════════════════════════════════════════════════════

describe("disparo", () => {
  it("⛔ desligado não toca no banco nem na rede", async () => {
    const fetchSpy = metaAceita();
    const db = fakeDb();
    const r = await abordarLead(db as never, "lead1", { agora: AGORA });
    expect(r.abordado).toBe(false);
    expect(!r.abordado && r.motivo).toBe("desligado");
    expect(db.siteLead.updateMany).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("⛔ com FOOCCI_SDR_SEND_ENABLED desligada, o portão reprova e nada sai", async () => {
    ligarTudo();
    delete process.env.FOOCCI_SDR_SEND_ENABLED;
    const fetchSpy = metaAceita();
    const db = fakeDb();
    const r = await abordarLead(db as never, "lead1", { agora: AGORA });
    expect(!r.abordado && r.motivo).toBe("portaoReprovou");
    expect(!r.abordado && r.detalhe).toContain("CANAL_INDISPONIVEL");
    expect(db.leadMensagem.create).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("⛔ o teto do dia é relido do banco a cada abordagem", async () => {
    ligarTudo(2);
    const db = fakeDb({ usadosHoje: 2 });
    const r = await abordarLead(db as never, "lead1", { agora: AGORA });
    expect(!r.abordado && r.motivo).toBe("tetoDoDia");
  });

  it("⛔ lead inelegível (silêncio, já escreveu, assumido) não é abordado", async () => {
    ligarTudo();
    const db = fakeDb({ lead: null });
    const r = await abordarLead(db as never, "lead1", { agora: AGORA });
    expect(!r.abordado && r.motivo).toBe("leadNaoElegivel");
  });

  it("⛔ duas rodadas simultâneas: só UMA aborda", async () => {
    // A reserva é comparar-e-trocar. Quem recebe count 0 desiste sem gravar
    // mensagem nenhuma — sem isso, a pessoa receberia duas aberturas.
    ligarTudo();
    metaAceita();
    const db = fakeDb({ reserva: 0 });
    const r = await abordarLead(db as never, "lead1", { agora: AGORA });
    expect(!r.abordado && r.motivo).toBe("outroJaPegou");
    expect(db.leadMensagem.create).not.toHaveBeenCalled();
  });

  it("caminho feliz: grava como TEMPLATE, registra a abordagem e confirma o envio", async () => {
    ligarTudo();
    const fetchSpy = metaAceita();
    const db = fakeDb();

    const r = await abordarLead(db as never, "lead1", { agora: AGORA });
    expect(r.abordado).toBe(true);

    const gravada = db.leadMensagem.create.mock.calls[0]![0].data;
    expect(gravada.tipo).toBe("TEMPLATE");
    expect(gravada.templateNome).toBe("foocci_abertura_v1");
    expect(gravada.texto).toBe("Oi José, aqui é da Foocci.");
    // SISTEMA, não IA: nenhum modelo de linguagem escreveu esta frase.
    expect(gravada.autor).toBe("SISTEMA");

    const trilha = db.siteLeadInteraction.create.mock.calls[0]![0].data;
    expect(trilha.actor).toBe("primeiro-contato");
    expect(trilha.tipo).toBe("MENSAGEM_ENVIADA");

    expect(db.leadMensagem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ENVIADA" }) }),
    );

    // E o que foi para a Meta é um TEMPLATE, não texto livre.
    const corpo = JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body));
    expect(corpo.type).toBe("template");
    expect(corpo.template.name).toBe("foocci_abertura_v1");
    expect(corpo.template.language.code).toBe("pt_BR");
    expect(corpo.template.components[0].parameters[0].text).toBe("José");
  });

  it("⛔ recusa da Meta marca a mensagem como falha, com o motivo", async () => {
    ligarTudo();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "template not found" } }), { status: 400 }),
    );
    const db = fakeDb();
    const r = await abordarLead(db as never, "lead1", { agora: AGORA });
    expect(!r.abordado && r.motivo).toBe("aMetaRecusou");
    expect(db.leadMensagem.update.mock.calls[0]![0].data.status).toBe("FALHOU");
  });

  it("⛔ falha ao gravar DEVOLVE a reserva — o lead não some da fila", async () => {
    ligarTudo();
    metaAceita();
    const db = fakeDb();
    db.leadMensagem.create = vi.fn(async () => {
      throw new Error("banco fora do ar");
    });
    const r = await abordarLead(db as never, "lead1", { agora: AGORA });
    expect(!r.abordado && r.motivo).toBe("naoGravou");
    // Duas escritas condicionais: a reserva e a devolução dela.
    expect(db.siteLead.updateMany).toHaveBeenCalledTimes(2);
    expect(db.siteLead.updateMany.mock.calls[1]![0].data.lastContactedAt).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A RODADA
// ═══════════════════════════════════════════════════════════════════════════

describe("rodada", () => {
  it("com tudo desligado, a rodada não aborda ninguém e diz por quê", async () => {
    const fetchSpy = metaAceita();
    const db = fakeDb();
    const r = await rodarPrimeiroContato(db as never, { agora: AGORA });
    expect(r.abordados).toBe(0);
    expect(r.fila.motivoDaFilaVazia).toContain("desligado");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ligada, aborda quem a fila liberou", async () => {
    ligarTudo();
    metaAceita();
    const db = fakeDb();
    const r = await rodarPrimeiroContato(db as never, { agora: AGORA });
    expect(r.abordados).toBe(1);
  });
});
