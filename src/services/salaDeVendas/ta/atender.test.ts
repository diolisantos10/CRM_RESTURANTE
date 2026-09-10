/**
 * A PONTE — os sete portões, um por um.
 *
 * ── O QUE ESTE ARQUIVO GUARDA ───────────────────────────────────────────────
 *
 * `atenderComOTA` é a única função do produto que faz um robô falar em nome da
 * empresa com um estranho. Todo defeito aqui é um defeito que o cliente lê.
 *
 * Por isso cada portão aparece **duas vezes**: uma provando que ele barra, e
 * outra provando que ele deixa passar quando deve. Um teste que só prova o
 * bloqueio passaria numa função que devolvesse `calar()` na primeira linha e
 * nunca respondesse a ninguém — e essa função seria aprovada por engano.
 *
 * O caso de longe mais importante é o do PENDENTE: nada aqui entrega mensagem.
 */

import { describe, it, expect, vi } from "vitest";
import { atenderComOTA, type ResultadoDoTurno } from "./atender";

/** Terça-feira, 09:00 em São Paulo. Dentro da janela, dia útil. */
const AGORA = new Date("2026-08-25T12:00:00Z");
/** Mesma terça, 00:00 em São Paulo. */
const MADRUGADA = new Date("2026-08-25T03:00:00Z");
/** Sábado ao meio-dia em São Paulo — dentro do horário, fora do dia útil. */
const SABADO = new Date("2026-08-29T15:00:00Z");

interface Ajustes {
  config?: Record<string, unknown> | null;
  lead?: Record<string, unknown> | null;
  saidasDesdeAUltimaEntrada?: number;
  textosJaEnviados?: string[];
  /** O time de agentes que existe no banco. Vazio = instalação nova. */
  timeNoBanco?: Array<{ id: string; nome: string; email: string }>;
  /** Quantos clientes abertos cada agente já tem, para o desempate de carga. */
  cargaDosAgentes?: Array<{ atendenteUserId: string; _count: { _all: number } }>;
  /** O que a casa JÁ sabia sobre o lead. `null` = ficha em branco. */
  qualificacao?: Record<string, unknown> | null;
}

function banco(a: Ajustes = {}) {
  const config =
    a.config === null
      ? null
      : {
          ligado: true,
          maxSemResposta: 3,
          versaoAtivaId: "v1",
          horaInicio: 9,
          horaFim: 20,
          ...a.config,
        };

  const lead =
    a.lead === null
      ? null
      : {
          id: "l1",
          nome: "Marina Duarte",
          atendidoPor: "IA",
          optOutAt: null,
          score: 40,
          stage: "EM_QUALIFICACAO",
          ...a.lead,
        };

  return {
    sdrIaConfig: { findUnique: vi.fn().mockResolvedValue(config) },
    siteLead: {
      findUnique: vi.fn().mockResolvedValue(lead),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      groupBy: vi.fn().mockResolvedValue(a.cargaDosAgentes ?? []),
    },
    leadMensagem: {
      count: vi.fn().mockResolvedValue(a.saidasDesdeAUltimaEntrada ?? 0),
      findFirst: vi.fn().mockResolvedValue({ ocorreuEm: AGORA }),
      findMany: vi
        .fn()
        .mockResolvedValue((a.textosJaEnviados ?? []).map((texto) => ({ texto }))),
      create: vi.fn().mockResolvedValue({ id: "m1" }),
    },
    siteLeadInteraction: { create: vi.fn().mockResolvedValue({}) },
    leadHandoff: { create: vi.fn().mockResolvedValue({ id: "h1" }) },
    // ⭐ A MEMÓRIA DO LEAD, no dublê, desde 10/09/2026.
    //
    // Não é adorno: `lerMemoria` roda ANTES de compor e `gravarMemoria` roda
    // depois de qualificar. Sem esta tabela aqui, as duas caem no ramo de erro e
    // os casos passariam sem exercitar nada da memória — verde por vacuidade.
    leadQualificacao: {
      findUnique: vi.fn().mockResolvedValue(a.qualificacao ?? null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    // Desde 27/08/2026 a tomada do lead escolhe um agente do time e grava o
    // `atendenteUserId` dele. `a.timeNoBanco` deixa o caso decidir se o time
    // existe: vazio é o estado de uma instalação nova, e o TA precisa
    // continuar atendendo — sem nome, mas atendendo.
    internalUser: {
      findMany: vi.fn().mockResolvedValue(a.timeNoBanco ?? []),
    },
  };
}

/** Uma pergunta comum, que a base de verdade responde e não chama gente. */
const PERGUNTA = "quanto custa o plano crescimento?";

/**
 * "Ele falou" — e, quando não falou, DIZ POR QUÊ.
 *
 * Existe por causa de 26/08/2026: este arquivo reprovou no CI e passou aqui, e
 * a mensagem foi `expected false to be true`. Levou uma investigação inteira
 * para descobrir que a causa era a meia-noite virando hora 24 num ICU diferente.
 *
 * `atenderComOTA` nunca lança e sempre NOMEIA o motivo de calar — a asserção
 * crua jogava fora exatamente a informação que o código se deu ao trabalho de
 * produzir. Uma reprovação tem que caber na tela do CI.
 */
function falou(r: ResultadoDoTurno): boolean {
  if (r.falou) return true;
  const porque = r.chamouGente
    ? `ele chamou gente (${r.motivo})`
    : `ele calou: ${r.motivo} — ${r.detalhe}`;
  throw new Error(`esperava que o TA respondesse, mas ${porque}`);
}

// ── O caso que carrega o arquivo ─────────────────────────────────────────────

describe("⭐ o TA responde, e a resposta NÃO sai daqui", () => {
  it("compõe, grava e devolve o id — com status PENDENTE", async () => {
    const db = banco();
    const r = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: PERGUNTA,
      agora: AGORA,
    });

    expect(falou(r)).toBe(true);
    if (!r.falou || r.porPolitica) return;
    expect(r.mensagemId).toBe("m1");
    expect(r.resposta.texto.length).toBeGreaterThan(10);

    // A trava. PENDENTE é o que separa "ele pensou" de "ele falou": quem
    // entrega é o canal, e o canal só entrega com a chave do CEO ligada.
    const gravada = db.leadMensagem.create.mock.calls[0]![0]!.data;
    expect(gravada.status).toBe("PENDENTE");
    expect(gravada.direcao).toBe("SAIDA");
  });

  it("grava como IA, e nunca como SISTEMA nem como gente sem nome", async () => {
    // `SISTEMA` é cadência e template operacional — coisa que ninguém redigiu.
    // Confundir os dois apaga a diferença entre "o robô escreveu" e "a máquina
    // disparou o passo 2", que é a pergunta que a auditoria faz primeiro.
    const db = banco();
    await atenderComOTA(db as never, { leadId: "l1", mensagem: PERGUNTA, agora: AGORA });

    expect(db.leadMensagem.create.mock.calls[0]![0]!.data.autor).toBe("IA");
  });

  it("o que ele afirma vem apoiado em alguma fonte", async () => {
    // Sem isto, uma resposta inventada passaria em todos os outros testes.
    const db = banco();
    const r = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: PERGUNTA,
      agora: AGORA,
    });

    expect(falou(r)).toBe(true);
    if (!r.falou || r.porPolitica) return;
    expect(r.resposta.apoiadoEm.length).toBeGreaterThan(0);
  });
});

// ── Portão 1: a chave mestra ────────────────────────────────────────────────

describe("portão 1 — o TA está ligado?", () => {
  it("desligado, ele não compõe NADA", async () => {
    const db = banco({ config: { ligado: false } });
    const r = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: PERGUNTA,
      agora: AGORA,
    });

    expect(r).toMatchObject({ falou: false, chamouGente: false, motivo: "taDesligado" });
    // E o portão é o PRIMEIRO: nem o lead chegou a ser lido.
    expect(db.siteLead.findUnique).not.toHaveBeenCalled();
    expect(db.leadMensagem.create).not.toHaveBeenCalled();
  });

  it("ligado sem versão publicada também cala", async () => {
    // Um agente ligado sem versão é um agente sem identidade e sem lista de
    // proibições — exatamente o que não pode falar com ninguém.
    const db = banco({ config: { versaoAtivaId: null } });
    const r = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: PERGUNTA,
      agora: AGORA,
    });

    expect(r).toMatchObject({ motivo: "taDesligado" });
    expect(db.leadMensagem.create).not.toHaveBeenCalled();
  });

  it("sem configuração nenhuma, cala — ausência não é permissão", async () => {
    const db = banco({ config: null });
    const r = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: PERGUNTA,
      agora: AGORA,
    });

    expect(r).toMatchObject({ motivo: "taDesligado" });
  });
});

// ── Portão 2: de quem é o lead ──────────────────────────────────────────────

describe("portão 2 — o TA não fala por cima de quem assumiu", () => {
  it("lead com humano: cala", async () => {
    // O defeito que este portão impede é o cliente receber duas respostas
    // diferentes da mesma empresa no mesmo minuto.
    const db = banco({ lead: { atendidoPor: "HUMANO" } });
    const r = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: PERGUNTA,
      agora: AGORA,
    });

    expect(r).toMatchObject({ falou: false, motivo: "leadNaoEDaIA" });
    expect(db.leadMensagem.create).not.toHaveBeenCalled();
  });

  it("lead já esperando gente: cala também", async () => {
    // O TA já pediu gente. Voltar a falar desfaz o pedido dele mesmo na frente
    // do cliente — e quem pegar a fila encontra uma conversa que andou sozinha.
    const db = banco({ lead: { atendidoPor: "AGUARDANDO_HUMANO" } });
    const r = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: PERGUNTA,
      agora: AGORA,
    });

    expect(r).toMatchObject({ motivo: "leadNaoEDaIA" });
  });

  it("⭐ ao atender um lead sem dono, a IA ASSUME — e ele sai da fila de abandonados", async () => {
    // O defeito: o lead nascia `NINGUEM`, o TA respondia sem assumir, e ele
    // continuava aparecendo na fila "Sem responsável" no exato momento em que
    // estava sendo atendido. Um SDR humano entrava para salvar, e o cliente
    // recebia duas vozes na mesma conversa.
    const db = banco({ lead: { atendidoPor: "NINGUEM" } });
    await atenderComOTA(db as never, { leadId: "l1", mensagem: PERGUNTA, agora: AGORA });

    expect(db.siteLead.updateMany, "não assumiu o lead").toHaveBeenCalled();
    const chamada = db.siteLead.updateMany.mock.calls[0]![0]!;
    expect(chamada.data).toMatchObject({ atendidoPor: "IA" });
    // ⭐ Condicional a NINGUEM, dentro da escrita. Entre ler e escrever, uma
    // pessoa pode ter assumido — e a IA não pode tomar de volta.
    expect(chamada.where, "assumiu sem condição — pode roubar de um humano")
      .toMatchObject({ atendidoPor: "NINGUEM" });
  });

  it("lead sem dono ainda: o TA PODE atender", async () => {
    // A metade que passa, e ela importa: `NINGUEM` é o estado em que quase todo
    // lead novo nasce. Um portão que barrasse `NINGUEM` deixaria o TA mudo para
    // sempre e passaria em todos os testes de bloqueio deste arquivo.
    const db = banco({ lead: { atendidoPor: "NINGUEM" } });
    const r = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: PERGUNTA,
      agora: AGORA,
    });

    expect(falou(r)).toBe(true);
  });

  it("lead que não existe: cala com o id no motivo", async () => {
    const db = banco({ lead: null });
    const r = await atenderComOTA(db as never, {
      leadId: "sumiu",
      mensagem: PERGUNTA,
      agora: AGORA,
    });

    expect(r).toMatchObject({ motivo: "leadNaoExiste" });
    if (r.falou || r.chamouGente) return;
    expect(r.detalhe).toContain("sumiu");
  });
});

// ── Portão 3: silêncio pedido ───────────────────────────────────────────────

describe("portão 3 — quem pediu silêncio não recebe, nem se escrever", () => {
  it("opt-out cala, mesmo com o cliente perguntando", async () => {
    const db = banco({ lead: { optOutAt: new Date("2026-07-01T10:00:00Z") } });
    const r = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: PERGUNTA,
      agora: AGORA,
    });

    expect(r).toMatchObject({ motivo: "pediuSilencio" });
    expect(db.leadMensagem.create).not.toHaveBeenCalled();
  });

  it("⭐ mas o portão de ABORDAGEM não é aplicado a quem escreveu", async () => {
    // O caso que justifica a ponte não chamar `avaliarContatoDeLead`.
    //
    // Aquele portão reprova consentimento com mais de 90 dias, exige 48h de
    // descanso e conta um teto de 2 tentativas. Este lead falha em TODOS eles —
    // e ainda assim tem que ser respondido, porque foi ELE quem escreveu.
    // Recusar aqui seria usar a proteção contra a pessoa que ela protege.
    const db = banco({
      lead: {
        consentAt: new Date("2025-01-01T00:00:00Z"), // vencidíssimo
        lastContactedAt: new Date("2026-08-25T11:55:00Z"), // 5 minutos atrás
      },
      saidasDesdeAUltimaEntrada: 0,
    });

    const r = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: PERGUNTA,
      agora: AGORA,
    });

    expect(falou(r)).toBe(true);
  });
});

// ── Portão 4: horário ───────────────────────────────────────────────────────

describe("portão 4 — a janela, e ela é a CONFIGURADA", () => {
  it("madrugada cala", async () => {
    const db = banco();
    const r = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: PERGUNTA,
      agora: MADRUGADA,
    });

    expect(r).toMatchObject({ motivo: "foraDeHorario" });
  });

  it("sábado cala, mesmo em pleno horário comercial", async () => {
    // Fim de semana não é configurável, e é de propósito: deixá-lo ajustável
    // abriria a regra pela porta dos fundos.
    const db = banco();
    const r = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: PERGUNTA,
      agora: SABADO,
    });

    expect(r).toMatchObject({ motivo: "foraDeHorario" });
  });

  it("⭐ ampliar a janela na configuração REALMENTE amplia", async () => {
    // A prova de que o botão da tela não é enfeite. Sem ela, a ponte podia usar
    // a constante fixa do SDR de abordagem e passar em tudo — deixando o dono
    // mexendo num controle desconectado.
    const db = banco({ config: { horaInicio: 0, horaFim: 24 } });
    const r = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: PERGUNTA,
      agora: MADRUGADA,
    });

    expect(falou(r)).toBe(true);
  });

  it("e estreitar REALMENTE estreita", async () => {
    const db = banco({ config: { horaInicio: 14, horaFim: 18 } });
    const r = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: PERGUNTA,
      agora: AGORA, // 09:00 em São Paulo
    });

    expect(r).toMatchObject({ motivo: "foraDeHorario" });
  });
});

// ── Portão 5: insistência ───────────────────────────────────────────────────

describe("portão 5 — ele para sozinho de insistir", () => {
  it("no teto, cala", async () => {
    // Sem este degrau o TA vira perseguição automatizada — e é o defeito que o
    // cliente denuncia em vez de responder.
    const db = banco({ config: { maxSemResposta: 3 }, saidasDesdeAUltimaEntrada: 3 });
    const r = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: PERGUNTA,
      agora: AGORA,
    });

    expect(r).toMatchObject({ motivo: "insistiuDemais" });
    expect(db.leadMensagem.create).not.toHaveBeenCalled();
  });

  it("abaixo do teto, responde", async () => {
    const db = banco({ config: { maxSemResposta: 3 }, saidasDesdeAUltimaEntrada: 2 });
    const r = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: PERGUNTA,
      agora: AGORA,
    });

    expect(falou(r)).toBe(true);
  });

  it("conta só o que saiu DEPOIS da última coisa que o cliente escreveu", async () => {
    // Contar tudo que já saiu na vida do lead faria o TA emudecer numa conversa
    // longa e saudável — justamente a que está indo bem.
    const db = banco();
    await atenderComOTA(db as never, { leadId: "l1", mensagem: PERGUNTA, agora: AGORA });

    const where = db.leadMensagem.count.mock.calls[0]![0]!.where;
    expect(where.direcao).toBe("SAIDA");
    expect(where.ocorreuEm).toHaveProperty("gt");
  });
});

// ── Portão 7a: quando é caso de gente ───────────────────────────────────────

describe("portão 7a — chama gente e PARA", () => {
  it("pedido de humano: passa o bastão e NÃO manda resposta de venda", async () => {
    // O defeito que este caso guarda: mandar "vou chamar alguém" junto com a
    // fala de venda faz o cliente responder à pergunta errada — e quem pega a
    // fila encontra uma conversa que já andou sem ele.
    const db = banco();
    const r = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: "quero falar com uma pessoa, por favor",
      agora: AGORA,
    });

    expect(r).toMatchObject({ falou: false, chamouGente: true, motivo: "PEDIU_HUMANO" });
    expect(db.leadHandoff.create).toHaveBeenCalledTimes(1);

    // UMA mensagem, e ela é o aviso — não a resposta de venda.
    expect(db.leadMensagem.create).toHaveBeenCalledTimes(1);
    const dita = db.leadMensagem.create.mock.calls[0]![0]!.data.texto as string;
    expect(dita).toMatch(/chamar algu[ée]m/i);
    expect(dita, "mandou preço junto com o pedido de gente").not.toMatch(/R\$/);
  });

  it("⭐ e o cliente É AVISADO de que alguém vem", async () => {
    // O defeito de 26/08/2026: o TA passava o bastão e voltava calado. O handoff
    // era registrado, o dono do lead mudava, a fila recebia o dossiê — e quem
    // acabou de escrever "quero falar com alguém" não recebia nada.
    //
    // Do lado de dentro tudo parecia certo. Do lado de fora era silêncio depois
    // de um pedido, que é a pior resposta possível a um pedido.
    const db = banco();
    await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: "quero falar com uma pessoa",
      agora: AGORA,
    });

    expect(db.leadMensagem.create, "passou o bastão em silêncio").toHaveBeenCalledTimes(1);
    expect(db.leadMensagem.create.mock.calls[0]![0]!.data.status).toBe("PENDENTE");
    expect(db.leadMensagem.create.mock.calls[0]![0]!.data.autor).toBe("IA");
  });

  it("desconto sai da mão da IA, e o dossiê carrega a frase do cliente", async () => {
    const db = banco();
    const r = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: "consegue fazer por um preço melhor? preciso de desconto",
      agora: AGORA,
    });

    expect(r).toMatchObject({ chamouGente: true, motivo: "PEDIU_DESCONTO" });

    // Quem pega a fila lê ISTO antes de abrir a conversa.
    const dossie = db.leadHandoff.create.mock.calls[0]![0]!.data;
    expect(JSON.stringify(dossie)).toContain("desconto");
  });

  it("handoff recusado: cala com o motivo VERDADEIRO, e não mente outro", async () => {
    // Um `calar()` com motivo emprestado é pior que nenhum: a fila de defeitos
    // passa a apontar para o lugar errado.
    const db = banco();
    db.siteLead.updateMany.mockResolvedValue({ count: 0 }); // outra mão pegou antes

    const r = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: "quero falar com uma pessoa",
      agora: AGORA,
    });

    expect(r).toMatchObject({ falou: false, chamouGente: false, motivo: "handoffRecusado" });
    expect(db.leadMensagem.create).not.toHaveBeenCalled();
  });

  it("conversa tranquila NÃO chama gente", async () => {
    // A metade que passa. Sem ela, um gatilho que disparasse sempre passaria em
    // todos os casos acima e o TA nunca responderia nada sozinho.
    const db = banco();
    await atenderComOTA(db as never, { leadId: "l1", mensagem: PERGUNTA, agora: AGORA });

    expect(db.leadHandoff.create).not.toHaveBeenCalled();
  });
});

// ── A memória da sondagem ───────────────────────────────────────────────────

describe("ele não repete pergunta que já fez", () => {
  it("uma pergunta já enviada não volta no turno seguinte", async () => {
    // Repetir pergunta que a pessoa já respondeu é o que mais denuncia um robô
    // numa conversa. A memória é DERIVADA das mensagens, e não de um contador —
    // contador se dessincroniza no dia em que alguém apaga uma mensagem.
    const db = banco();
    const primeira = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: PERGUNTA,
      agora: AGORA,
    });

    expect(falou(primeira)).toBe(true);
    if (!primeira.falou || primeira.porPolitica) return;
    if (primeira.resposta.perguntouIndice === null) return; // não sondou, nada a guardar

    const segunda = banco({ textosJaEnviados: [primeira.resposta.texto] });
    const r2 = await atenderComOTA(segunda as never, {
      leadId: "l1",
      mensagem: "e como funciona a implantação?",
      agora: AGORA,
    });

    expect(falou(r2)).toBe(true);
    if (!r2.falou || r2.porPolitica) return;
    expect(r2.resposta.perguntouIndice).not.toBe(primeira.resposta.perguntouIndice);
  });
});

// ── E a promessa do cabeçalho ───────────────────────────────────────────────

describe("a ponte nunca derruba quem a chama", () => {
  it("banco fora do ar não vira exceção no webhook", async () => {
    // Derrubar o webhook é pior que perder uma resposta: a Meta reentrega, e a
    // reentrega bate na mesma falha em laço.
    const db = banco();
    db.sdrIaConfig.findUnique.mockRejectedValue(new Error("connection refused"));

    await expect(
      atenderComOTA(db as never, { leadId: "l1", mensagem: PERGUNTA, agora: AGORA }),
    ).resolves.toMatchObject({ falou: false });
  });
});

describe("⭐ o aviso de que vem gente não pode falhar calado", () => {
  /**
   * ─── A FALHA MUDA MAIS CARA DA SALA ───────────────────────────────────────
   * `atender.ts` jogava fora o retorno de `entregarMensagem` no aviso de
   * handoff. É o pedido de gente: o lead pediu uma pessoa, pediu desconto ou
   * ficou bravo. O TA para de vender de propósito e manda UMA coisa — "alguém
   * já vem". Se essa única mensagem não sai, o lead fica em **silêncio
   * absoluto** e o funil registra o handoff como se tivesse dado certo.
   * Ninguém consegue distinguir "avisado e esperando" de "abandonado sem saber".
   *
   * ─── E ESTE ARQUIVO JÁ PROVAVA O CENÁRIO SEM PERCEBER ────────────────────
   * O cabeçalho diz: *"nada aqui entrega mensagem"*. Ou seja, **todos** os casos
   * deste arquivo já rodavam pelo caminho da entrega que falha — e nenhum
   * olhava. O defeito estava debaixo de 500 linhas de teste verde.
   */
  it("⭐ quando o aviso não sai, o log GRITA com o lead e o motivo", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = banco();

    const r = await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: "quero falar com uma pessoa, por favor",
      agora: AGORA,
    });

    expect(r).toMatchObject({ chamouGente: true });

    const gritos = erro.mock.calls.filter((c) => String(c[0]).includes("aviso de que vem gente"));
    expect(gritos.length, "o aviso não saiu e ninguém foi avisado disso").toBe(1);

    // Guardrail 6: o alerta carrega a própria evidência. "Algo falhou" sem o
    // caso concreto é ruído que ninguém investiga.
    const prova = gritos[0]![1] as Record<string, unknown>;
    expect(prova.leadId, "o alerta não diz de qual lead se trata").toBe("l1");
    expect(prova.motivo, "o alerta não diz por que não saiu").toBeTruthy();

    erro.mockRestore();
  });

  /**
   * ⚠️ UMA MUTAÇÃO SOBREVIVEU AQUI, E EU NÃO A MATEI. Fica escrito por quê.
   *
   * Troquei `if (!entregaDoAviso.entregue)` por `if (true)` — ou seja, o alerta
   * passaria a gritar TAMBÉM quando o aviso chega ao lead — e os 29 casos
   * continuaram verdes.
   *
   * A razão é o próprio cabeçalho deste arquivo: *"nada aqui entrega mensagem"*.
   * Neste banco de mentira a entrega **sempre** falha, então `!entregue` é
   * sempre verdadeiro e as duas versões se comportam igual. **Em produção elas
   * não se comportam igual**: com `if (true)` o log gritaria em todo handoff
   * bem-sucedido, e alerta que grita sempre é alerta que ninguém lê — que é
   * exatamente a doença que este conserto existe para tratar.
   *
   * O que mataria a mutação é um caso em que a entrega DÁ CERTO, e ele não cabe
   * neste arquivo: exigiria as chaves da Meta, `FOOCCI_SDR_SEND_ENABLED`,
   * `FOOCCI_SDR_IA_RESPONDE_SOZINHA`, `leadMensagem.findUnique` e o `fetch` da
   * Graph — um segundo arranjo inteiro, que mudaria o banco compartilhado pelos
   * outros 27 casos. Está anotado como dívida, e não disfarçado de coberto.
   */
  it("⭐ A METADE LEGÍTIMA: turno normal não grita — o alerta é do aviso, não de toda entrega", async () => {
    // Sem esta, bastaria um console.error incondicional para o caso acima passar
    // — e o log viraria ruído em todo turno, que é como um alerta morre.
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = banco();

    await atenderComOTA(db as never, { leadId: "l1", mensagem: PERGUNTA, agora: AGORA });

    const gritos = erro.mock.calls.filter((c) => String(c[0]).includes("aviso de que vem gente"));
    expect(gritos.length, "gritou num turno que não teve handoff nenhum").toBe(0);

    erro.mockRestore();
  });
});

/**
 * ⭐⭐ QUEM CHAMA A MEMÓRIA — o defeito predileto desta casa, medido cinco vezes.
 *
 * `LeadQualificacao` existe desde sempre. `sondagem.ts` extrai os fatos desde
 * sempre. O que não existia era **a linha que liga os dois**: o turno pontuava
 * com os fatos e os jogava fora, e a tabela tinha um único escritor — a tela,
 * quando um humano digitava.
 *
 * Peça escrita, testada e sem chamador é o defeito que esta casa já cometeu
 * cinco vezes (`materializarLead`, `motivoDeHandoffPorPreco`, e outros três).
 * Os casos abaixo existem para que o sexto não seja este. Eles não conferem se
 * a memória é bonita: conferem que **alguém a chama em produção**.
 */
describe("⭐⭐ a memória do lead é LIDA antes de compor e GRAVADA depois", () => {
  it("⭐ o turno grava o que descobriu — sem isto, o prompt chega vazio para sempre", async () => {
    const db = banco({ lead: { tipo: "padaria" } });

    await atenderComOTA(db as never, { leadId: "l1", mensagem: PERGUNTA, agora: AGORA });

    expect(
      db.leadQualificacao.upsert,
      "ninguém gravou a memória — os fatos extraídos morreram no turno, como antes de 10/09",
    ).toHaveBeenCalled();

    const escrito = db.leadQualificacao.upsert.mock.calls[0]![0] as {
      where: { leadId: string };
      update: Record<string, unknown>;
    };
    expect(escrito.where.leadId).toBe("l1");
    expect(escrito.update.segmento).toBe("padaria");
    // Carimbo da máquina, separado do `updatedAt`: distingue o que a IA soube do
    // que uma pessoa corrigiu depois.
    expect(escrito.update.atualizadoPelaIaEm).toBeInstanceOf(Date);
  });

  it("⭐ e a memória é LIDA no mesmo turno — a leitura acontece, não só a escrita", async () => {
    const db = banco({ qualificacao: { leadId: "l1", segmento: "padaria" } });

    await atenderComOTA(db as never, { leadId: "l1", mensagem: PERGUNTA, agora: AGORA });

    expect(
      db.leadQualificacao.findUnique,
      "o turno compôs sem consultar o que já sabia sobre a pessoa",
    ).toHaveBeenCalledWith({ where: { leadId: "l1" } });
  });

  it('⛔ "não quero mais responder perguntas" é gravado NO MESMO turno, não no seguinte', async () => {
    // A ordem é o conserto. Gravar depois de compor consertaria a conversa a
    // partir da mensagem seguinte — ou seja, tarde: o lead já teria recebido
    // mais uma pergunta, que foi exatamente o que aconteceu em 09/09.
    const db = banco();

    await atenderComOTA(db as never, {
      leadId: "l1",
      mensagem: "não quero mais responder perguntas, me manda o preço",
      agora: AGORA,
    });

    const pedidos = db.leadQualificacao.upsert.mock.calls
      .map((c) => (c[0] as { update: Record<string, unknown> }).update)
      .filter((u) => u.pediuPararSondagem === true);

    expect(pedidos.length, "o pedido de parar não foi gravado neste turno").toBeGreaterThan(0);
  });

  it("⛔ a sonda de controle: uma mensagem comum NÃO marca pedido de parar", async () => {
    // Sem esta, um detector guloso marcaria todo mundo e o agente pararia de
    // qualificar a base inteira — um estrago silencioso e muito pior.
    const db = banco();

    await atenderComOTA(db as never, { leadId: "l1", mensagem: PERGUNTA, agora: AGORA });

    const marcou = db.leadQualificacao.upsert.mock.calls
      .map((c) => (c[0] as { update: Record<string, unknown> }).update)
      .some((u) => u.pediuPararSondagem === true);

    expect(marcou, "marcou pedido de parar numa pergunta comum sobre preço").toBe(false);
  });
});
