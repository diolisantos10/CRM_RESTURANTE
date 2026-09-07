import { describe, it, expect, vi } from "vitest";
import { escopoDaConsulta, filtroDaFila, listarFila, FILAS, ordenacaoDaFila } from "./filas";
import type { NomeDaFila } from "./filas";
import type { SessaoInterna } from "@/lib/internal-auth";

const sessao = (over: Partial<SessaoInterna> = {}): SessaoInterna => ({
  userId: "u1",
  nome: "SDR",
  role: "AGENTE_HUMANO",
  departamentos: ["vendas"],
  gerencia: [],
  ...over,
});

const AGORA = new Date("2026-08-25T12:00:00Z");

/**
 * ── O CRITÉRIO 6, NA CAMADA QUE COSTUMA FALTAR ──
 *
 * "SDR humano visualiza somente a Sala de Vendas autorizada."
 *
 * A rota protege o endereço. Estes testes protegem o DADO: eles olham o `where`
 * que sai para o banco. Um teste que só conferisse o resultado passaria numa
 * base de teste sem leads de outro SDR — e passaria exatamente até o dia em que
 * houvesse um.
 */
describe("o escopo da consulta", () => {
  it("o CEO e o Diretor não têm filtro — enxergam a base inteira", () => {
    expect(escopoDaConsulta(sessao({ role: "MASTER_CEO" }))).toEqual({});
    expect(escopoDaConsulta(sessao({ role: "DIRETOR_FOOCCI" }))).toEqual({});
  });

  it("o Agente Gerente Comercial enxerga Vendas inteiro", () => {
    // É ele quem distribui a fila e responde pelo SLA. Sem isso não teria como
    // ver a carteira do time que ele gerencia.
    const gerente = sessao({ role: "GERENTE_DEPARTAMENTO", gerencia: ["vendas"] });
    expect(escopoDaConsulta(gerente)).toEqual({});
  });

  it("o gerente de OUTRO departamento NÃO enxerga Vendas", () => {
    const financeiro = sessao({
      role: "GERENTE_DEPARTAMENTO",
      departamentos: ["financeiro"],
      gerencia: ["financeiro"],
    });
    expect(escopoDaConsulta(financeiro)).not.toEqual({});
  });

  it("o SDR fica preso aos leads dele mais os livres", () => {
    const filtro = escopoDaConsulta(sessao());
    expect(filtro).toEqual({
      OR: [
        { atendenteUserId: "u1" },
        { atendidoPor: { in: ["NINGUEM", "AGUARDANDO_HUMANO"] } },
      ],
    });
  });

  it("o SDR vê os leads LIVRES — senão as duas filas de pegar trabalho viriam vazias", () => {
    // O isolamento é contra ver a carteira dos OUTROS, não contra ver o que
    // está disponível. Sem isso, "sem responsável" e "aguardando humano" — as
    // duas filas que existem para ele pegar trabalho — nunca teriam nada.
    const filtro = escopoDaConsulta(sessao()) as { OR: Array<Record<string, unknown>> };
    const livres = filtro.OR.find((o) => "atendidoPor" in o);
    expect(livres).toBeDefined();
  });

  it("o filtro do SDR NÃO contém nada que devolva a base inteira", () => {
    // A metade que reprova: se alguém trocar o OR por um `{}`, isto pega.
    const filtro = escopoDaConsulta(sessao());
    expect(Object.keys(filtro).length).toBeGreaterThan(0);
  });
});

describe("fila e escopo se SOMAM, nunca se substituem", () => {
  it("toda fila do SDR sai com AND entre escopo e filtro", () => {
    // Um `OR` aqui deixaria a fila furar o isolamento — e é o tipo de erro que
    // passa despercebido porque a tela continua parecendo certa.
    for (const f of FILAS) {
      const filtro = filtroDaFila(f.nome, sessao(), AGORA);
      expect(filtro.AND, `fila ${f.nome}`).toBeDefined();
      expect(Array.isArray(filtro.AND), `fila ${f.nome}`).toBe(true);
      expect((filtro.AND as unknown[]).length, `fila ${f.nome}`).toBe(2);
    }
  });

  it("a fila 'todos' do SDR ainda carrega o escopo dele", () => {
    // "Todos" é a base inteira DO ESCOPO, não a base inteira.
    const filtro = filtroDaFila("todos", sessao(), AGORA);
    const [escopo] = filtro.AND as Array<Record<string, unknown>>;
    expect(escopo).toHaveProperty("OR");
  });

  it("a fila 'todos' do CEO não tem escopo restritivo", () => {
    const filtro = filtroDaFila("todos", sessao({ role: "MASTER_CEO" }), AGORA);
    const [escopo] = filtro.AND as Array<Record<string, unknown>>;
    expect(escopo).toEqual({});
  });
});

describe("o que cada fila pergunta", () => {
  const daFila = (nome: Parameters<typeof filtroDaFila>[0]) =>
    (filtroDaFila(nome, sessao({ role: "MASTER_CEO" }), AGORA).AND as Array<
      Record<string, unknown>
    >)[1];

  it("aguardando humano: a IA parou e ninguém pegou", () => {
    expect(daFila("aguardandoHumano")).toEqual({ atendidoPor: "AGUARDANDO_HUMANO" });
  });

  it("sem responsável: ninguém assumiu", () => {
    expect(daFila("semResponsavel")).toEqual({ atendidoPor: "NINGUEM" });
  });

  it("meus leads: meus E com dono humano", () => {
    // Sem o `atendidoPor: HUMANO`, um lead que eu já devolvi para a IA
    // continuaria aparecendo como meu.
    expect(daFila("meusLeads")).toEqual({ atendenteUserId: "u1", atendidoPor: "HUMANO" });
  });

  it("sem resposta ignora as três etapas terminais", () => {
    // Cobrar resposta de quem já fechou ou já foi perdido é ruído puro. NUTRICAO
    // entrou na lista quando o funil foi para 11 etapas: cobrar silêncio de quem
    // a gente mesmo mandou esperar noventa dias encheria a fila de gente em dia.
    const f = daFila("semResposta") as { stage: { notIn: string[] } };
    expect(f.stage.notIn).toEqual(["GANHO", "PERDIDO", "NUTRICAO"]);
  });

  it("follow-up vencido só conta quem espera há mais de um dia", () => {
    const f = daFila("followUpVencido") as {
      atendidoPor: string;
      atendenteDesde: { lt: Date };
    };
    expect(f.atendidoPor).toBe("AGUARDANDO_HUMANO");
    expect(AGORA.getTime() - f.atendenteDesde.lt.getTime()).toBe(86_400_000);
  });

  it("toda fila tem título e pergunta escritos, e nenhuma se repete", () => {
    // A pergunta aparece na tela. Fila sem pergunta é filtro que ninguém sabe
    // para que serve.
    //
    // ⚠️ Isto já foi `toHaveLength(7)`, e a contagem caiu no dia em que as duas
    // filas do CEO entraram — vermelho que não denunciava defeito nenhum, só que
    // o número mudou. Contagem fixa não é regra. A regra é que **toda** fila
    // esteja escrita e nenhuma duplique nome — essa vale para 7, para 9 e para a
    // próxima que entrar.
    expect(FILAS.length).toBeGreaterThan(0);
    for (const f of FILAS) {
      expect(f.titulo.length, f.nome).toBeGreaterThan(0);
      expect(f.pergunta.length, f.nome).toBeGreaterThan(10);
    }

    const nomes = FILAS.map((f) => f.nome);
    expect(new Set(nomes).size, `fila duplicada em ${nomes.join(", ")}`).toBe(nomes.length);
  });

  it("⭐ as duas filas do CEO existem pelo nome", () => {
    // O que a contagem fixa realmente queria proteger: que ninguém suma com uma
    // fila sem querer. Aqui a asserção é sobre a fila que PRECISA existir, e não
    // sobre quantas existem — apagando a do closer, este caso cai pelo nome dela
    // em vez de reclamar de aritmética.
    const nomes = FILAS.map((f) => f.nome);
    expect(nomes, "sumiu a fila do qualificador").toContain("aguardandoQualificacao");
    expect(nomes, "sumiu a fila do closer").toContain("qualificados");
  });
});

describe("listar a fila", () => {
  function bancoFalso(linhas: unknown[] = []) {
    return {
      siteLead: {
        findMany: vi.fn().mockResolvedValue(linhas),
        count: vi.fn().mockResolvedValue(0),
      },
    };
  }

  it("a consulta que sai para o banco carrega o escopo do SDR", async () => {
    const db = bancoFalso();
    await listarFila(db as never, { fila: "todos", sessao: sessao(), agora: AGORA });

    const where = db.siteLead.findMany.mock.calls[0]![0].where;
    expect(where.AND).toBeDefined();
    expect((where.AND as Array<Record<string, unknown>>)[0]).toHaveProperty("OR");
  });

  it("as contagens também são contadas dentro do escopo", async () => {
    // Se a contagem ignorasse o escopo, o SDR veria "42 leads sem responsável"
    // e abriria uma lista com 3. O número mentiria mesmo com a lista certa.
    const db = bancoFalso();
    await listarFila(db as never, { fila: "todos", sessao: sessao(), agora: AGORA });

    expect(db.siteLead.count).toHaveBeenCalledTimes(FILAS.length);
    for (const chamada of db.siteLead.count.mock.calls) {
      const where = chamada[0].where as { AND: Array<Record<string, unknown>> };
      expect(where.AND[0]).toHaveProperty("OR");
    }
  });

  it("banco fora do ar devolve leituraOk false com motivo, não lista vazia", async () => {
    const db = bancoFalso();
    db.siteLead.findMany.mockRejectedValueOnce(new Error("connection refused"));

    const r = await listarFila(db as never, { fila: "todos", sessao: sessao(), agora: AGORA });

    expect(r.leituraOk).toBe(false);
    expect(r.motivo).toContain("connection refused");
    expect(r.leads).toEqual([]);
  });

  it("base vazia com banco no ar devolve leituraOk true", async () => {
    const r = await listarFila(bancoFalso([]) as never, {
      fila: "todos",
      sessao: sessao(),
      agora: AGORA,
    });
    expect(r.leituraOk).toBe(true);
    expect(r.motivo).toBeUndefined();
  });

  it("ordena por quem espera há mais tempo", async () => {
    // Fila de espera ordenada por data de criação faria o lead que espera há
    // três dias ficar embaixo do que chegou agora.
    const db = bancoFalso();
    await listarFila(db as never, { fila: "aguardandoHumano", sessao: sessao(), agora: AGORA });

    const orderBy = db.siteLead.findMany.mock.calls[0]![0].orderBy;
    expect(orderBy[0]).toEqual({ atendenteDesde: "asc" });
  });
});

/**
 * ── AS DUAS FILAS DO DESENHO DO CEO ─────────────────────────────────────────
 *
 * Ele descreveu a estrutura em 27/08/2026: *"o primeiro agente vai ser o agente
 * que vai sondá-lo, que é o qualificador... frio, morno, quente... Aí a gente
 * passa pro closer. (...) São duas listas."*
 *
 * O que estes casos guardam não é a existência das filas — é o que separa uma
 * fila útil de uma lista bonita:
 *
 *  · **quem NÃO entra** — um desqualificado na fila do closer faz um agente
 *    agressivo atacar quem nunca poderia comprar;
 *  · **em que ORDEM** — ninguém trabalha lista inteira, trabalha o topo. A
 *    ordenação É a decisão de quem é atendido hoje;
 *  · **`null` não é FRIO** — é o que separa "ninguém mediu" de "medido e frio",
 *    e é a fila do qualificador inteira.
 */
describe("⭐ as duas filas: quem qualifica e quem fecha", () => {
  function bancoFalso(linhas: unknown[] = []) {
    return {
      siteLead: {
        findMany: vi.fn().mockResolvedValue(linhas),
        count: vi.fn().mockResolvedValue(0),
      },
    };
  }

  /** O pedaço do `where` que é da fila, já separado do escopo da sessão. */
  function daFila(fila: Parameters<typeof filtroDaFila>[0]) {
    const f = filtroDaFila(fila, sessao({ role: "MASTER_CEO" }), AGORA);
    return (f.AND as Array<Record<string, unknown>>)[1]!;
  }

  it("aguardando qualificação é quem NUNCA foi medido — e null não é FRIO", () => {
    // A distinção que carrega a fila. Se `temperatura` fosse FRIO por omissão,
    // esta lista viria sempre vazia e o qualificador não teria trabalho — com a
    // tela inteira parecendo correta.
    expect(daFila("aguardandoQualificacao")).toMatchObject({ temperatura: null });
  });

  it("⭐ e o desqualificado NÃO entra na fila do closer", () => {
    // O caso caro. Um agente agressivo em cima de uma loja de roupa queima
    // número de WhatsApp e não vende nada — e ela somaria pontos, porque a
    // desqualificação é sobre público, não sobre sinal.
    const alvo = daFila("qualificados").temperatura as { in: string[] };

    expect(alvo.in, "o desqualificado entrou na fila do closer").not.toContain("DESQUALIFICADO");
    expect(alvo.in, "quem está em nutrição foi jogado pro closer").not.toContain("NUTRICAO");
    expect(alvo.in).toContain("QUENTE");
    expect(alvo.in, "o morno sumiu da fila — é ele que precisa de agendamento").toContain("MORNO");
  });

  it("as duas ignoram quem já terminou o funil", () => {
    // Cobrar qualificação de um lead GANHO é mandar o agente falar com quem já
    // assinou.
    for (const fila of ["aguardandoQualificacao", "qualificados"] as const) {
      const stage = daFila(fila).stage as { notIn: string[] };
      expect(stage.notIn, `${fila} atende quem já acabou`).toEqual(
        expect.arrayContaining(["GANHO", "PERDIDO"]),
      );
    }
  });

  it("⭐ a fila do closer chega ordenada por temperatura, não por data", async () => {
    // Antes disto, TODA fila saía com a mesma ordenação fixa — a lista do closer
    // chegaria por data de criação, ignorando a temperatura recém-calculada. O
    // qualificador rodaria, o número apareceria na tela, e não mudaria a ordem
    // de ataque de ninguém: régua ligada, decisão igual.
    const db = bancoFalso();
    await listarFila(db as never, { fila: "qualificados", sessao: sessao(), agora: AGORA });

    const orderBy = db.siteLead.findMany.mock.calls[0]![0].orderBy;
    // `asc` porque a ordem declarada do enum começa em PRIORIDADE_MAXIMA.
    expect(orderBy[0], "a fila do closer não olha a temperatura").toEqual({ temperatura: "asc" });
  });

  it("a fila de qualificar chega pelo mais antigo — ninguém sabe nada de ninguém", async () => {
    const db = bancoFalso();
    await listarFila(db as never, {
      fila: "aguardandoQualificacao",
      sessao: sessao(),
      agora: AGORA,
    });

    expect(db.siteLead.findMany.mock.calls[0]![0].orderBy[0]).toEqual({ createdAt: "asc" });
  });

  it("⭐ a temperatura chega na TELA, e não só na ordenação", async () => {
    // Uma lista ordenada por um critério invisível é a pior armadilha: o
    // operador vê uma ordem que não explica, conclui que está aleatória, e passa
    // a ignorar o topo — que era exatamente o que a ordenação queria destacar.
    const db = bancoFalso([
      {
        id: "l1",
        nome: "Bar do Zé",
        restaurante: "Bar do Zé",
        cidade: "SP",
        stage: "QUALIFICADO",
        atendidoPor: "IA",
        atendenteUserId: null,
        atendente: null,
        motivoDoPedido: null,
        atendenteDesde: null,
        utmSource: null,
        utmCampaign: null,
        lastContactedAt: null,
        createdAt: AGORA,
        temperatura: "QUENTE",
        score: 72,
      },
    ]);

    const r = await listarFila(db as never, {
      fila: "qualificados",
      sessao: sessao(),
      agora: AGORA,
    });

    expect(r.leads[0]!.temperatura, "a etiqueta não chega na tela").toBe("QUENTE");
    expect(r.leads[0]!.score).toBe(72);
  });

  it("as duas filas novas também são contadas — senão o botão nasce sem número", async () => {
    const db = bancoFalso();
    await listarFila(db as never, { fila: "todos", sessao: sessao(), agora: AGORA });

    const r = await listarFila(db as never, { fila: "todos", sessao: sessao(), agora: AGORA });
    expect(r.contagens).toHaveProperty("aguardandoQualificacao");
    expect(r.contagens).toHaveProperty("qualificados");
  });
});

/**
 * ⛔⛔ A ORDEM DA FILA — e por que ela virou teste em 07/09/2026.
 *
 * A fila "Sem responsável" responde à pergunta *"o que está largado?"*. Ela caía
 * no `default`, que desempata por `createdAt: "desc"`. Como ninguém nessa fila
 * tem atendente, o desempate virava a ordem inteira: **o mais novo no topo e o
 * mais abandonado no fim** — exatamente ao contrário do que a pergunta pede.
 *
 * Medido em 06/09/2026: o lead mais velho da base esperava 21 dias, tinha vindo
 * da página de PREÇOS, e estava no fundo da lista feita para encontrá-lo.
 */
describe("⛔ a ordem das filas põe quem espera mais primeiro", () => {
  it("Sem responsável ordena pelo mais antigo", () => {
    expect(ordenacaoDaFila("semResponsavel")).toEqual([{ createdAt: "asc" }]);
  });

  it("Aguardando qualificação ordena pelo mais antigo", () => {
    expect(ordenacaoDaFila("aguardandoQualificacao")).toEqual([{ createdAt: "asc" }]);
  });

  it("⛔ NENHUMA fila desempata pelo mais recente", () => {
    // `createdAt: "desc"` em qualquer lugar desta função é o defeito voltando:
    // é confortável para quem opera (o assunto está fresco) e é exatamente como
    // um lead antigo nunca mais é tocado.
    const todas: NomeDaFila[] = [
      "aguardandoQualificacao", "qualificados", "semResponsavel", "meusLeads",
      "comIA", "aguardandoHumano", "semResposta", "followUpVencido", "todos",
    ];
    for (const f of todas) {
      for (const criterio of ordenacaoDaFila(f)) {
        expect(
          (criterio as Record<string, string>).createdAt,
          `a fila "${f}" desempata pelo mais recente`,
        ).not.toBe("desc");
      }
    }
  });
});
