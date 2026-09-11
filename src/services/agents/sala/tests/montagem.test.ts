/**
 * PORTÃO DA MONTAGEM — os quatro casos obrigatórios da Sala dos Agentes.
 *
 *   1. agente sem custo atribuído NÃO aparece como zero
 *   2. oficina em formato desconhecido vira `naoMedido`, não 0
 *   3. os cinco Essenciais vêm marcados
 *   4. as duas populações não se misturam numa soma só
 *
 * Cada um com as DUAS metades: a que prova que o caso ruim é barrado e a que
 * prova que o caso legítimo passa. Sem a segunda, "não medido em tudo" seria
 * uma implementação verde — e uma tela inútil.
 *
 * Nenhum destes testes toca prisma nem disco: `montarSalaDosAgentes` é puro e
 * recebe os insumos prontos. Foi de propósito — regra escondida atrás de um
 * módulo mockado inteiro já ficou invisível nesta casa.
 */

import { describe, expect, it } from "vitest";
import { veio, naoVeio } from "../amostra";
import {
  ESSENCIAIS,
  montarSalaDosAgentes,
  type InsumosDaSala,
} from "../montagem";
import type { AdminAgentProfileView } from "../../types";
import type { Medida } from "../../salaDosAgentes.types";
import type { UsageRow } from "../../../ai/pricing/costAggregation";

const AGORA = new Date("2026-08-07T12:00:00.000Z");

function perfil(over: Partial<AdminAgentProfileView> & { slug: string }): AdminAgentProfileView {
  return {
    name: over.slug,
    area: "GENERAL",
    objectives: [],
    responsibilities: [],
    skills: [],
    allowedActions: [],
    forbiddenActions: [],
    tools: [],
    knowledgeAreas: [],
    businessRules: [],
    safetyRules: [],
    escalationRules: [],
    outputRules: [],
    evaluationCriteria: [],
    status: "ACTIVE",
    visibility: "INTERNAL",
    isGlobalDefault: false,
    isRuntimeEnabled: false,
    version: "1.0",
    updatedAt: null,
    origin: "code",
    ...over,
  };
}

const PERFIL_MD = `---
name: cerebro
description: >
  Use para tudo que envolve o Cérebro: raciocínio dos agentes, portões
  de qualidade e escada de liberação.
tools: [Read, Grep, Write]
---

Você é o especialista do **Cérebro** do Foocci.

Corpo do perfil.
`;

const OFICINA_OK = `# Oficina — cerebro

---

## 2026-08-05 — Primeiro bloco

corpo

---

## 2026-08-06 — Segundo bloco

corpo
`;

const VITRINE_OK = `# Vitrine — cerebro

## Uma lição promovida

corpo
`;

function insumos(over: Partial<InsumosDaSala> = {}): InsumosDaSala {
  return {
    agora: AGORA,
    janelaDias: 30,
    perfisDeProduto: veio([]),
    motoresPorSlug: {},
    arquivosDeDesenvolvimento: veio([]),
    usoDeIA: veio([]),
    provedoresLigados: ["OPENAI"],
    ...over,
  };
}

function metrica(medidas: ReadonlyArray<{ rotulo: string; medida: Medida }>, rotulo: string): Medida {
  const m = medidas.find((x) => x.rotulo === rotulo);
  if (!m) throw new Error(`métrica "${rotulo}" não existe no cartão`);
  return m.medida;
}

const linha = (over: Partial<UsageRow> = {}): UsageRow => ({
  model: "gpt-4o-mini",
  agentSlug: "waiter",
  promptTokens: 1000,
  completionTokens: 1000,
  ...over,
});

// ── 1. agente sem custo atribuído NÃO aparece como zero ───────────────────────

describe("custo por agente", () => {
  it("agente de produto SEM atribuição sai `naoMedido`, nunca zero", () => {
    /*
      A metade que reprova. Se alguém trocar o `naoMedido` por `zeroProvado`
      "porque não tem linha nenhuma", este caso fica vermelho — e é o caso que
      faria a tela dizer que um agente não custou nada quando o que houve foi
      não termos como saber.

      O slug de exemplo era `crm` até 28/08/2026. Deixou de servir no dia em que
      o dispatcher do Brain passou a medir: o `crm` entrou em
      AGENTES_COM_CUSTO_ATRIBUIDO e usá-lo aqui testaria o oposto do que a frase
      do teste diz. O exemplo agora é um slug que de fato não tem instrumento.
    */
    const sala = montarSalaDosAgentes(
      insumos({
        perfisDeProduto: veio([perfil({ slug: "agente-sem-instrumento", area: "CRM" })]),
        usoDeIA: veio([linha({ agentSlug: "waiter" })]),
      }),
    );
    const semInstrumento = sala.agentes.find((a) => a.slug === "agente-sem-instrumento")!;
    for (const rotulo of ["Chamadas de IA (30d)", "Custo atribuído (30d)", "Tokens (30d)"]) {
      const m = metrica(semInstrumento.metricas, rotulo);
      expect(m.estado, `${rotulo} não pode ser zero`).toBe("naoMedido");
      if (m.estado === "naoMedido") expect(m.motivo).toContain("agentSlug");
    }
    expect(sala.lacunas.join(" ")).toContain("agente-sem-instrumento");
  });

  it("agente instrumentado SEM nenhuma linha na janela também sai `naoMedido`", () => {
    /*
      A armadilha que a instrumentação nova cria: estar na lista de agentes
      instrumentados NÃO prova que o agente rodou. Se `instrumentado` passasse a
      autorizar `zeroProvado`, o cartão do `crm` diria "custou US$ 0,00" num mês
      em que a cobertura simplesmente não pegou nenhuma chamada dele.
    */
    const sala = montarSalaDosAgentes(
      insumos({
        perfisDeProduto: veio([perfil({ slug: "crm", area: "CRM" })]),
        usoDeIA: veio([linha({ agentSlug: "waiter" })]),
      }),
    );
    const crm = sala.agentes.find((a) => a.slug === "crm")!;
    expect(metrica(crm.metricas, "Custo atribuído (30d)").estado).toBe("naoMedido");
  });

  it("agente COM atribuição e modelo precificado sai `medido` com o número certo", () => {
    /*
      A metade que passa. Sem ela, devolver "não medido" para tudo satisfaria o
      teste acima — e a tela nunca mostraria um custo.
      1000 tokens de entrada × 0.00015 + 1000 de saída × 0.0006 = 0.00075.
    */
    const sala = montarSalaDosAgentes(
      insumos({
        perfisDeProduto: veio([perfil({ slug: "waiter", area: "WAITER" })]),
        motoresPorSlug: { waiter: { provedor: "OpenAI", modelo: "gpt-4o-mini" } },
        usoDeIA: veio([linha(), linha()]),
      }),
    );
    const waiter = sala.agentes.find((a) => a.slug === "waiter")!;
    expect(metrica(waiter.metricas, "Chamadas de IA (30d)")).toEqual({
      estado: "medido",
      valor: 2,
      unidade: "chamadas",
    });
    expect(metrica(waiter.metricas, "Custo atribuído (30d)")).toEqual({
      estado: "medido",
      valor: 0.0015,
      unidade: "US$",
    });
    expect(waiter.estado).toBe("trabalhando");
    expect(waiter.motor).toEqual({ tipo: "configurado", provedor: "OpenAI", modelo: "gpt-4o-mini" });
  });

  it("modelo cobrado por minuto/imagem NÃO entra na soma por token", () => {
    /*
      whisper-1 é cobrado por minuto de áudio. Se ele entrasse como zero, o
      cartão somaria só a parte barata e apresentaria um PISO como se fosse a
      conta fechada. O motivo tem que carregar os dois números.
    */
    const sala = montarSalaDosAgentes(
      insumos({
        perfisDeProduto: veio([perfil({ slug: "waiter" })]),
        usoDeIA: veio([linha(), linha({ model: "whisper-1" })]),
      }),
    );
    const m = metrica(sala.agentes[0]!.metricas, "Custo atribuído (30d)");
    expect(m.estado).toBe("naoMedido");
    if (m.estado === "naoMedido") {
      expect(m.motivo).toContain("whisper-1");
      expect(m.motivo).toMatch(/piso|desconhecido/);
    }
  });

  it("perfil em rascunho aparece desligado e sem motor inventado", () => {
    const sala = montarSalaDosAgentes(
      insumos({
        perfisDeProduto: veio([perfil({ slug: "branding", status: "DRAFT" })]),
        motoresPorSlug: { branding: { provedor: "OpenAI", modelo: "gpt-4o-mini" } },
      }),
    );
    const cartao = sala.agentes[0]!;
    expect(cartao.estado).toBe("desligado");
    expect(cartao.motor.tipo).toBe("naoAplica");
  });
});

// ── 2. oficina em formato desconhecido vira `naoMedido`, não 0 ────────────────

describe("trabalho dos agentes de desenvolvimento", () => {
  const arquivo = (over: Partial<{ slug: string; perfil: string; oficina: string; vitrine: string }>) => ({
    slug: over.slug ?? "cerebro",
    perfil: veio(over.perfil ?? PERFIL_MD),
    oficina: veio(over.oficina ?? OFICINA_OK),
    vitrine: veio(over.vitrine ?? VITRINE_OK),
  });

  it("oficina em formato desconhecido vira `naoMedido` com motivo — nunca 0", () => {
    const sala = montarSalaDosAgentes(
      insumos({
        arquivosDeDesenvolvimento: veio([
          arquivo({ oficina: "# Oficina\n\nProsa solta, sem título e sem data.\n" }),
        ]),
      }),
    );
    const m = metrica(sala.agentes[0]!.metricas, "Entradas na oficina");
    expect(m.estado).toBe("naoMedido");
    if (m.estado === "naoMedido") {
      expect(m.motivo).toContain("não reconhecido");
      expect(m.motivo).toContain("Prosa solta");
    }
    expect(sala.lacunas.join(" ")).toContain("formato não reconhecido");
  });

  it("oficina em formato conhecido vira `medido` com a contagem certa", () => {
    // A metade que passa: sem ela, "não medido para todo mundo" ficaria verde.
    const sala = montarSalaDosAgentes(
      insumos({ arquivosDeDesenvolvimento: veio([arquivo({})]) }),
    );
    expect(metrica(sala.agentes[0]!.metricas, "Entradas na oficina")).toEqual({
      estado: "medido",
      valor: 2,
      unidade: "entradas",
    });
    expect(metrica(sala.agentes[0]!.metricas, "Entradas na vitrine")).toEqual({
      estado: "medido",
      valor: 1,
      unidade: "entradas",
    });
    expect(sala.agentes[0]!.estado).toBe("trabalhando");
  });

  it("oficina ausente vira `naoMedido` com o caminho no motivo, e não zero", () => {
    const sala = montarSalaDosAgentes(
      insumos({
        arquivosDeDesenvolvimento: veio([
          { slug: "seguranca", perfil: veio(PERFIL_MD), oficina: naoVeio("a oficina do agente não existe em /app/docs/agents/seguranca/oficina.md"), vitrine: naoVeio("a vitrine do agente não existe") },
        ]),
      }),
    );
    const m = metrica(sala.agentes[0]!.metricas, "Entradas na oficina");
    expect(m.estado).toBe("naoMedido");
    if (m.estado === "naoMedido") expect(m.motivo).toContain("oficina.md");
    expect(sala.agentes[0]!.estado).toBe("atencao");
  });

  it("oficina existente e vazia é o ÚNICO zero honesto da tela", () => {
    const sala = montarSalaDosAgentes(
      insumos({
        arquivosDeDesenvolvimento: veio([arquivo({ oficina: "# Oficina — novo\n\n> Append-only.\n" })]),
      }),
    );
    expect(metrica(sala.agentes[0]!.metricas, "Entradas na oficina").estado).toBe("zeroProvado");
  });

  it("agente parado há mais de 30 dias sai em `atencao`, com a janela zerada", () => {
    /*
      As duas metades juntas num caso só: o TOTAL continua medido (o trabalho
      não some do histórico), e a JANELA sai como zero provado — que é o que
      responde "quem não está sendo usado". Um agente com 3 entradas e nenhuma
      no mês é candidato a conversa com o CEO; um agente sem sala nenhuma é
      outra coisa, e por isso o segundo é `naoMedido`.
    */
    const sala = montarSalaDosAgentes(
      insumos({
        arquivosDeDesenvolvimento: veio([
          arquivo({ oficina: "# Oficina\n\n## 2026-05-01 — bloco antigo\n\ncorpo\n" }),
        ]),
      }),
    );
    expect(sala.agentes[0]!.estado).toBe("atencao");
    expect(metrica(sala.agentes[0]!.metricas, "Entradas na oficina")).toEqual({
      estado: "medido",
      valor: 1,
      unidade: "entradas",
    });
    expect(metrica(sala.agentes[0]!.metricas, "Entradas nos últimos 30 dias").estado).toBe(
      "zeroProvado",
    );
  });

  it("agente que registrou HOJE não sai com traço na janela", () => {
    /*
      A metade que reprova a métrica anterior ("dias desde a última entrada"):
      lá, quem registrou hoje valia 0 e a tela desenharia "—" — o mesmo símbolo
      de quem nunca registrou nada.
    */
    const sala = montarSalaDosAgentes(
      insumos({
        arquivosDeDesenvolvimento: veio([
          arquivo({ oficina: "# Oficina\n\n## 2026-08-07 — bloco de hoje\n\ncorpo\n" }),
        ]),
      }),
    );
    expect(metrica(sala.agentes[0]!.metricas, "Entradas nos últimos 30 dias")).toEqual({
      estado: "medido",
      valor: 1,
      unidade: "entradas",
    });
  });

  it("entrada sem data legível não vira zero na janela", () => {
    const sala = montarSalaDosAgentes(
      insumos({
        arquivosDeDesenvolvimento: veio([
          arquivo({ oficina: "# Oficina\n\n## Um bloco sem data no título\n\ncorpo\n" }),
        ]),
      }),
    );
    const m = metrica(sala.agentes[0]!.metricas, "Entradas nos últimos 30 dias");
    expect(m.estado).toBe("naoMedido");
    if (m.estado === "naoMedido") expect(m.motivo).toContain("sem chutar");
  });

  it("perfil ilegível sai `desligado` — o Diretor não consegue despachar para ele", () => {
    const sala = montarSalaDosAgentes(
      insumos({
        arquivosDeDesenvolvimento: veio([
          { slug: "fantasma", perfil: naoVeio("o perfil do agente não existe"), oficina: veio(OFICINA_OK), vitrine: veio(VITRINE_OK) },
        ]),
      }),
    );
    expect(sala.agentes[0]!.estado).toBe("desligado");
    expect(sala.agentes[0]!.funcao).toContain("não lido");
  });

  it("identidade sai do frontmatter e do corpo do perfil", () => {
    const sala = montarSalaDosAgentes(
      insumos({ arquivosDeDesenvolvimento: veio([arquivo({})]) }),
    );
    expect(sala.agentes[0]!.nome).toBe("Cérebro");
    expect(sala.agentes[0]!.funcao).toMatch(/^Tudo que envolve o Cérebro/);
    expect(sala.agentes[0]!.motor.tipo).toBe("naoAplica");
  });
});

// ── 3. os cinco Essenciais vêm marcados ──────────────────────────────────────

describe("os cinco Essenciais", () => {
  const todos = [...ESSENCIAIS, "garcom", "operacao"];

  it("os cinco vêm com `essencial: true`", () => {
    const sala = montarSalaDosAgentes(
      insumos({
        arquivosDeDesenvolvimento: veio(
          todos.map((slug) => ({
            slug,
            perfil: veio(PERFIL_MD),
            oficina: veio(OFICINA_OK),
            vitrine: veio(VITRINE_OK),
          })),
        ),
      }),
    );
    for (const slug of ESSENCIAIS) {
      expect(sala.agentes.find((a) => a.slug === slug)?.essencial, slug).toBe(true);
    }
  });

  it("quem NÃO é Essencial vem com `essencial: false`", () => {
    /*
      A metade que reprova a saída preguiçosa `essencial: true` para todos — que
      passaria no teste acima e apagaria a distinção inteira da doutrina 21.
    */
    const sala = montarSalaDosAgentes(
      insumos({
        arquivosDeDesenvolvimento: veio(
          todos.map((slug) => ({
            slug,
            perfil: veio(PERFIL_MD),
            oficina: veio(OFICINA_OK),
            vitrine: veio(VITRINE_OK),
          })),
        ),
        perfisDeProduto: veio([perfil({ slug: "waiter" })]),
      }),
    );
    expect(sala.agentes.find((a) => a.slug === "garcom")?.essencial).toBe(false);
    expect(sala.agentes.find((a) => a.slug === "operacao")?.essencial).toBe(false);
    expect(sala.agentes.find((a) => a.slug === "waiter")?.essencial).toBe(false);
  });
});

// ── 4. as duas populações não se misturam numa soma só ───────────────────────

describe("as duas populações", () => {
  const sala = montarSalaDosAgentes(
    insumos({
      perfisDeProduto: veio([perfil({ slug: "waiter", area: "WAITER" })]),
      arquivosDeDesenvolvimento: veio([
        { slug: "cerebro", perfil: veio(PERFIL_MD), oficina: veio(OFICINA_OK), vitrine: veio(VITRINE_OK) },
      ]),
      usoDeIA: veio([linha()]),
    }),
  );
  const produto = sala.agentes.filter((a) => a.populacao === "produto");
  const desenvolvimento = sala.agentes.filter((a) => a.populacao === "desenvolvimento");

  it("cada cartão declara a sua população", () => {
    expect(produto.map((a) => a.slug)).toEqual(["waiter"]);
    expect(desenvolvimento.map((a) => a.slug)).toEqual(["cerebro"]);
  });

  it("nenhum rótulo de métrica existe nas duas — somar por rótulo é impossível", () => {
    /*
      É esta a trava contra o total sem significado. Enquanto os rótulos forem
      disjuntos, uma tela que agrupe por rótulo NÃO consegue somar "custo" de
      quem não gasta com "blocos" de quem não fala com cliente.
    */
    const rotulosProduto = new Set(produto.flatMap((a) => a.metricas.map((m) => m.rotulo)));
    const rotulosDev = new Set(desenvolvimento.flatMap((a) => a.metricas.map((m) => m.rotulo)));
    for (const r of rotulosDev) expect(rotulosProduto.has(r), `rótulo repetido: ${r}`).toBe(false);
  });

  it("agente de desenvolvimento não recebe métrica de dinheiro, e vice-versa", () => {
    const dev = desenvolvimento[0]!;
    expect(dev.metricas.some((m) => /custo|token|chamada/i.test(m.rotulo))).toBe(false);
    expect(dev.motor.tipo).toBe("naoAplica");

    const prod = produto[0]!;
    expect(prod.metricas.some((m) => /oficina|vitrine/i.test(m.rotulo))).toBe(false);
  });
});

// ── Motores e lacunas ────────────────────────────────────────────────────────

describe("aba Configurações", () => {
  it("o motor interno é o único zero CONHECIDO da aba", () => {
    // mock/local não chamam API paga. Aqui zero é o dado, não a ausência dele.
    const sala = montarSalaDosAgentes(insumos({ usoDeIA: veio([linha()]) }));
    expect(sala.motores.find((m) => m.provedor === "Motor interno")!.custo30Dias.estado).toBe(
      "zeroProvado",
    );
  });

  it("provedor sem chamada registrada é `naoMedido`, não zero", () => {
    /*
      Zero aqui afirmaria "a Anthropic não me custou nada em 30 dias". O registro
      cobre UM dos cinco caminhos que chamam IA — não sabemos disso.
    */
    const sala = montarSalaDosAgentes(insumos({ usoDeIA: veio([linha()]) }));
    const anthropic = sala.motores.find((m) => m.provedor.includes("Anthropic"))!;
    expect(anthropic.custo30Dias.estado).toBe("naoMedido");
    expect(anthropic.ligada).toBe(false);
  });

  it("provedor com chamada precificada mostra o número e quem usou", () => {
    const sala = montarSalaDosAgentes(insumos({ usoDeIA: veio([linha(), linha()]) }));
    const openai = sala.motores.find((m) => m.provedor === "OpenAI")!;
    expect(openai.custo30Dias).toEqual({ estado: "medido", valor: 0.0015, unidade: "US$" });
    expect(openai.ligada).toBe(true);
    expect(openai.usadaPor).toEqual(["waiter"]);
  });

  it("modelo fora da tabela ganha cartão próprio e vira lacuna", () => {
    const sala = montarSalaDosAgentes(
      insumos({ usoDeIA: veio([linha({ model: "modelo-fantasma-v9" })]) }),
    );
    const desconhecido = sala.motores.find((m) => m.provedor === "Não identificado")!;
    expect(desconhecido.custo30Dias.estado).toBe("naoMedido");
    expect(sala.lacunas.join(" ")).toContain("modelo-fantasma-v9");
  });

  it("linha sem agente não é atribuída a ninguém e é declarada", () => {
    const sala = montarSalaDosAgentes(
      insumos({
        perfisDeProduto: veio([perfil({ slug: "waiter" })]),
        usoDeIA: veio([linha({ agentSlug: null }), linha({ agentSlug: null })]),
      }),
    );
    expect(metrica(sala.agentes[0]!.metricas, "Custo atribuído (30d)").estado).toBe("naoMedido");
    expect(sala.motores.find((m) => m.provedor === "OpenAI")!.usadaPor).toEqual([]);
    expect(sala.lacunas.join(" ")).toContain("não dizem de qual agente vieram");
  });

  it("quando o registro não pôde ser lido, nada vira zero", () => {
    const sala = montarSalaDosAgentes(
      insumos({
        perfisDeProduto: veio([perfil({ slug: "waiter" })]),
        usoDeIA: naoVeio("banco indisponível"),
      }),
    );
    for (const m of sala.motores.filter((x) => x.provedor !== "Motor interno")) {
      expect(m.custo30Dias.estado).toBe("naoMedido");
    }
    for (const met of sala.agentes[0]!.metricas) expect(met.medida.estado).toBe("naoMedido");
    expect(sala.lacunas.join(" ")).toContain("banco indisponível");
  });
});

describe("a Sala declara os próprios buracos", () => {
  it("a cobertura parcial do registro de custo está sempre nas lacunas", () => {
    const sala = montarSalaDosAgentes(insumos());
    expect(sala.lacunas.join(" ")).toContain("AIOrderService.ts:1271");
    expect(sala.lacunas.join(" ")).toContain("No ar desde");
    expect(sala.lacunas.join(" ")).toMatch(/chave.*configurada|credencial viva/i);
  });

  it("`noArDesde` vem nulo em vez de uma data inventada", () => {
    const sala = montarSalaDosAgentes(
      insumos({
        perfisDeProduto: veio([perfil({ slug: "waiter" })]),
        arquivosDeDesenvolvimento: veio([
          { slug: "cerebro", perfil: veio(PERFIL_MD), oficina: veio(OFICINA_OK), vitrine: veio(VITRINE_OK) },
        ]),
      }),
    );
    for (const a of sala.agentes) expect(a.noArDesde).toBeNull();
  });
});
