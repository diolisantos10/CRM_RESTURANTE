/**
 * A ponte, medida.
 *
 * O que estes casos protegem, em ordem de gravidade:
 *
 *   1. **A ordem das travas.** Portão do lead antes do freio: recusar por
 *      ritmo alguém que nem podia ser abordado esconderia o motivo verdadeiro.
 *   2. **Gravar antes de enviar.** O pior caso tem de ser uma linha visível, e
 *      nunca um cliente que recebeu sem o sistema saber.
 *   3. **A recusa da Meta fica escrita na linha.** Falha silenciosa aqui faz o
 *      vendedor esperar resposta de uma mensagem que nunca saiu.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { montarParametros, abordarLead, primeiroNome, saudacaoDoLead, resumoDoModelo, modeloConfigurado, renderizarCorpoDoModelo } from "./abordar";

const enviarModelo = vi.hoisted(() => vi.fn());
const canalPronto = vi.hoisted(() => vi.fn(() => true));
const modeloAprovado = vi.hoisted(() => vi.fn());

vi.mock("@/services/foocci-sdr/FoocciSalesChannel", async (original) => {
  const real = await original<typeof import("@/services/foocci-sdr/FoocciSalesChannel")>();
  return { ...real, enviarModeloDeVendas: enviarModelo, canalDeVendasPronto: canalPronto };
});

vi.mock("@/services/foocci-sdr/sincronizarModelos", () => ({
  modeloAprovadoDaSala: modeloAprovado,
}));

const ambiente = { ...process.env };

const LEAD = {
  id: "L1",
  nome: "Marina Gambarini",
  whatsapp: "+5511999998888",
  optOutAt: null as Date | null,
  consentAt: new Date("2026-09-01T10:00:00Z"),
  createdAt: new Date("2026-09-01T10:00:00Z"),
  lastContactedAt: null as Date | null,
};

const AGORA = new Date("2026-09-07T13:00:00Z");

function banco(over: {
  lead?: (Partial<typeof LEAD> & { fonte?: string | null; restaurante?: string | null; cidade?: string | null }) | null;
  tentativas?: number;
  jaSairam?: number;
  /** `historicoDeAbordagens`: quando foi a última abordagem por TEMPLATE a
   *  este lead. `undefined` (padrão) = nenhuma ainda. */
  ultimaAbordagemEm?: Date;
  /** O item de prospecção do lead. `null` = não existe nenhum. */
  item?: { lote: { situacao: string; proveniencia: string | null } } | null;
  config?: {
    outboundLigado?: boolean;
    pausadoEm?: Date | null;
    horasEntreAbordagens?: number;
    limiteDiario?: number;
  } | null;
  /** Quantas abordagens de lista já saíram hoje — o teto do dia da prospecção. */
  usadosHoje?: number;
} = {}) {
  const gravadas: Array<Record<string, unknown>> = [];
  const atualizadas: Array<Record<string, unknown>> = [];
  /** `registrarSaida` também carimba `lastContactedAt` no lead. */
  const carimbos: Array<Record<string, unknown>> = [];
  /** Toda consulta feita ao banco, com os argumentos — ver o duplo abaixo. */
  const consultas: Array<Record<string, unknown>> = [];

  return {
    gravadas,
    atualizadas,
    carimbos,
    consultas,
    db: {
      siteLead: {
        /** `contarAbordagensDeHoje`, reusada do `selecao.ts`. */
        count: async () => over.usadosHoje ?? 0,
        /**
         * ⛔ CORRIGIDO, 11/09/2026 — este duplo devolvia `{...LEAD, ...over.lead}`
         * IGNORANDO o `select` recebido. Foi exatamente esse ponto cego que deixou
         * `cidade` faltar do `select` real de `abordarLead` sem nenhum dos 41
         * testes deste arquivo perceber: o duplo inventava o campo de volta,
         * mesmo quando o código de produção nunca o pedia ao banco.
         *
         * Agora a resposta é FILTRADA pelo `select` recebido, como o Prisma faz de
         * verdade — campo fora do `select` não volta, ponto final. "Duplo de banco
         * que ignora o argumento não testa consulta — testa o retorno que você
         * mesmo escreveu" (doutrina já registrada acima, para `itemDeProspeccao`).
         */
        findUnique: async (args: { select?: Record<string, boolean> }) => {
          consultas.push({ modelo: "siteLead.findUnique", ...args });
          if (over.lead === null) return null;
          const completo: Record<string, unknown> = { ...LEAD, ...(over.lead ?? {}) };
          if (!args.select) return completo;
          const filtrado: Record<string, unknown> = {};
          for (const campo of Object.keys(args.select)) {
            if (args.select[campo]) filtrado[campo] = completo[campo];
          }
          return filtrado;
        },
        update: async (args: { data: Record<string, unknown> }) => {
          carimbos.push(args.data);
          return {};
        },
      },
      leadMensagem: {
        count: async (args: { where: { tipo?: string } }) =>
          // A ponte conta duas coisas diferentes com o mesmo `count`: as
          // tentativas anteriores (sem `tipo`) e o ritmo (com `tipo: TEMPLATE`).
          // ⚠️ Desde 12/09/2026, `historicoDeAbordagens` (a Supervisora sobre
          // `abordar.ts`) TAMBÉM conta com `tipo: TEMPLATE`, mas nos três
          // testes que usam `jaSairam` o freio já barra antes de a Supervisora
          // rodar — nunca chegam aqui com `jaSairam` alto.
          args.where.tipo === "TEMPLATE" ? (over.jaSairam ?? 0) : (over.tentativas ?? 0),
        /** `historicoDeAbordagens` — a última abordagem por TEMPLATE a este
         *  lead. `null` por padrão: nenhum teste deste arquivo testa a
         *  Supervisora de adequação diretamente (ela tem arquivo próprio,
         *  `adequacaoDoTemplate.test.ts`); aqui só precisa não quebrar. */
        findFirst: async () => (over.ultimaAbordagemEm === undefined ? null : { ocorreuEm: over.ultimaAbordagemEm }),
        create: async (args: { data: Record<string, unknown> }) => {
          gravadas.push(args.data);
          return { id: "m1" };
        },
        update: async (args: { data: Record<string, unknown> }) => {
          atualizadas.push(args.data);
          return {};
        },
      },
      itemDeProspeccao: {
        /**
         * ⚠️ GUARDA OS ARGUMENTOS. Achado da revisão adversarial de 08/09/2026:
         * o duplo era `async () => valor`, e por isso **nenhum** dos 822 testes
         * verdes olhava para o `where`, o `orderBy` ou o `select` das consultas
         * novas. Três mutações graves sobreviviam — inclusive trocar
         * `where: { leadId }` por `where: {}`, que faria todo lead de lista
         * herdar o lote de outra pessoa.
         *
         * A regra que fica: **duplo de banco que ignora o argumento não testa
         * consulta — testa o retorno que você mesmo escreveu.**
         */
        findFirst: async (args: Record<string, unknown>) => {
          consultas.push({ modelo: "itemDeProspeccao", ...args });
          return over.item === undefined
            ? { lote: { situacao: "LIBERADO", proveniencia: "Lista pública de CNPJs de restaurantes (SP)" } }
            : over.item;
        },
      },
      prospeccaoConfig: {
        findUnique: async (args: Record<string, unknown>) => {
          consultas.push({ modelo: "prospeccaoConfig", ...args });
          return over.config === undefined
            ? { outboundLigado: true, pausadoEm: null, horasEntreAbordagens: null, limiteDiario: 250 }
            : over.config;
        },
      },
    } as never,
  };
}

beforeEach(() => {
  enviarModelo.mockReset();
  enviarModelo.mockResolvedValue({ ok: true });
  canalPronto.mockReturnValue(true);
  modeloAprovado.mockImplementation(async () => {
    const n = Number(process.env.FOOCCI_SDR_MODELO_VARIAVEIS || "1");
    const corpos: Record<number, string> = {
      1: "Olá, {{1}}! Aqui é a Foocci.",
      2: "Olá, {{1}}! Estou falando com o {{2}}.",
      3: "Olá, {{1}}! Estou falando com o {{2}} porque encontramos vocês em {{3}}.",
    };
    return {
      nome: "foocci_abordagem_inicial",
      idioma: "pt_BR",
      situacao: "APPROVED",
      variaveis: n,
      corpo: corpos[n] ?? "Olá, {{1}}! Aqui é a Foocci.",
    };
  });
  process.env.FOOCCI_SDR_MODELO_ABORDAGEM = "foocci_abordagem_inicial";
  process.env.FOOCCI_SDR_MODELO_IDIOMA = "pt_BR";
});

afterEach(() => {
  process.env = { ...ambiente };
});

describe("o caminho feliz", () => {
  it("⭐ grava como TEMPLATE, manda o modelo e confirma o envio", async () => {
    const { db, gravadas, atualizadas } = banco();

    const r = await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    expect(r.abordou).toBe(true);
    expect(gravadas[0]!.tipo).toBe("TEMPLATE");
    expect(gravadas[0]!.templateNome).toBe("foocci_abordagem_inicial");
    expect(gravadas[0]!.status).toBe("PENDENTE");
    expect(atualizadas[0]!.status).toBe("ENVIADA");
  });

  it("leva o primeiro nome como {{1}}", async () => {
    const { db } = banco();
    await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    const modelo = enviarModelo.mock.calls[0]![2] as { parametros: string[] };
    expect(modelo.parametros).toEqual(["Marina"]);
  });

  it("toda mensagem sai com responsável — nunca 'o sistema mandou'", async () => {
    const { db, gravadas } = banco();
    await abordarLead(db, { leadId: "L1", autorUserId: "u7", agora: AGORA });
    expect(gravadas[0]!.autorUserId).toBe("u7");
  });
});

/**
 * ⛔⛔ CONTRATO REAL DO TEMPLATE — confirmado na Meta em 11/09/2026.
 *
 * O texto aprovado exige, nesta ordem: saudação, restaurante e procedência.
 * A procedência pertence ao lote e precisa chegar tanto ao diagnóstico quanto
 * ao envio real; se qualquer um montar outra ordem, o teste falha antes de uma
 * nova rodada em produção.
 */
describe("⛔⛔ o payload segue o template aprovado na Meta", () => {
  const semVariaveisExtras = () => {
    delete process.env.FOOCCI_SDR_MODELO_VARIAVEIS;
  };

  afterEach(semVariaveisExtras);

  it("modelo de duas variáveis leva saudação e restaurante", async () => {
    process.env.FOOCCI_SDR_MODELO_VARIAVEIS = "2";
    const { db } = banco({ lead: { restaurante: "Divino Sabor", cidade: "Curitiba", fonte: "LISTA_PROSPECCAO" } });

    const r = await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    expect(r.abordou, JSON.stringify(r)).toBe(true);
    const modelo = enviarModelo.mock.calls[0]![2] as { parametros: string[] };
    // fonte LISTA_PROSPECCAO: a saudação leva o nome INTEIRO da coluna da
    // lista, não o primeiro nome (ver "a saudação do modelo", acima).
    expect(modelo.parametros).toEqual(["Divino Sabor", "Divino Sabor"]);
  });

  it("modelo aprovado de três variáveis leva a procedência declarada no lote", async () => {
    process.env.FOOCCI_SDR_MODELO_VARIAVEIS = "3";
    const { db } = banco({ lead: { restaurante: "Divino Sabor", fonte: "LISTA_PROSPECCAO" } });

    const r = await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    expect(r.abordou, JSON.stringify(r)).toBe(true);
    const modelo = enviarModelo.mock.calls[0]![2] as { parametros: string[] };
    expect(modelo.parametros).toEqual([
      "Divino Sabor",
      "Divino Sabor",
      "Lista pública de CNPJs de restaurantes (SP)",
    ]);
  });

  it("⛔⛔ a sonda de regressão — `select` do siteLead.findUnique tem que pedir `cidade`", async () => {
    // Prova direta, e não só pelo comportamento: se `cidade: true` sumir de novo
    // do `select` de `abordarLead`, este teste reprova apontando exatamente
    // onde, em vez de esperar alguém notar que uma rodada inteira parou.
    const { db, consultas } = banco();
    await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    const consulta = consultas.find((c) => c.modelo === "siteLead.findUnique");
    const select = consulta?.select as Record<string, boolean> | undefined;
    expect(select?.cidade, "select do lead não pede mais `cidade`").toBe(true);
  });
});

describe("⛔ a ordem das travas", () => {
  it("o portão do lead vem ANTES do freio", async () => {
    // Com o freio estourado E o lead em opt-out, o motivo tem de ser o opt-out.
    // Ao contrário, a tela diria "espere uma hora" para alguém que nunca mais
    // pode ser abordado.
    const { db } = banco({ lead: { optOutAt: new Date("2026-09-02") }, jaSairam: 9999 });

    const r = await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    expect(r.abordou).toBe(false);
    expect(r.abordou === false && r.motivo).toBe("portaoRecusou");
    expect(r.abordou === false && r.detalhe).toContain("LEAD_OPT_OUT");
  });

  it("quem pediu silêncio não recebe, e nada é gravado", async () => {
    const { db, gravadas } = banco({ lead: { optOutAt: new Date("2026-09-02") } });
    await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    expect(gravadas).toHaveLength(0);
    expect(enviarModelo).not.toHaveBeenCalled();
  });

  it("⛔ o freio barra antes de gravar qualquer coisa", async () => {
    const { db, gravadas } = banco({ jaSairam: 9999 });

    const r = await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    expect(r.abordou === false && r.motivo).toBe("ritmo");
    expect(gravadas).toHaveLength(0);
    expect(enviarModelo).not.toHaveBeenCalled();
  });

  it("lead que não existe não vira envio às cegas", async () => {
    const { db } = banco({ lead: null });
    const r = await abordarLead(db, { leadId: "sumiu", autorUserId: "u1", agora: AGORA });
    expect(r.abordou === false && r.motivo).toBe("leadNaoExiste");
  });

  it("canal desligado é recusa do portão, não tentativa", async () => {
    canalPronto.mockReturnValue(false);
    const { db } = banco();
    const r = await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });
    expect(r.abordou === false && r.motivo).toBe("portaoRecusou");
    expect(enviarModelo).not.toHaveBeenCalled();
  });
});

describe("quando a Meta recusa", () => {
  it("⛔ a linha vira FALHOU com o motivo escrito, nunca sucesso silencioso", async () => {
    enviarModelo.mockResolvedValue({ ok: false, error: "Template name does not exist" });
    const { db, gravadas, atualizadas } = banco();

    const r = await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    expect(r.abordou).toBe(false);
    expect(r.abordou === false && r.motivo).toBe("aMetaRecusou");
    // Gravou ANTES de tentar: a linha existe mesmo com a entrega falhando.
    expect(gravadas).toHaveLength(1);
    expect(atualizadas[0]!.status).toBe("FALHOU");
    expect(atualizadas[0]!.erro).toContain("Template name does not exist");
  });
});

describe("o primeiro nome", () => {
  it("pega só o primeiro", () => {
    expect(primeiroNome("Marina Gambarini")).toBe("Marina");
    expect(primeiroNome("  Omar  Freitas ")).toBe("Omar");
  });

  it("⛔ nome que é telefone NÃO vira saudação", () => {
    // Três das cinco fichas da base têm o próprio número no campo nome.
    // "Olá 5511999998888" é pior que não chamar pelo nome.
    expect(primeiroNome("5511999998888")).toBeNull();
    expect(primeiroNome("+55 (11) 99999-8888")).toBeNull();
  });

  it("vazio vira null, e não string vazia", () => {
    expect(primeiroNome("")).toBeNull();
    expect(primeiroNome("   ")).toBeNull();
    expect(primeiroNome(null)).toBeNull();
  });

  it("⛔ lead sem nome utilizável NÃO vira payload menor — é recusado", () => {
    // ── MUDOU EM 10/09/2026 (P0.2) ────────────────────────────────────────
    // Antes, um contato sem nome utilizável mandava `parametros: []` — payload
    // MENOR contra um modelo de `{{1}}`, e a Meta recusava. O formato do que
    // sai não pode depender do contato: ou tem o dado, ou não sai.
    const r = montarParametros(1, {
      nome: "5511999998888",
      restaurante: null,
      fonte: null,
      cidade: null,
    });
    expect(r.ok).toBe(false);
  });
});

describe("a configuração do modelo", () => {
  it("idioma tem padrão pt_BR, nome não tem padrão nenhum", () => {
    // Nome com padrão faria a casa mandar um modelo que ninguém escolheu.
    expect(modeloConfigurado({})).toEqual({ nome: "", idioma: "pt_BR" });
  });

  it("o resumo gravado na conversa diz qual modelo saiu", () => {
    // Bolha vazia na tela do vendedor é pior que uma que diz o nome do modelo.
    expect(resumoDoModelo({ nome: "foocci_abordagem_inicial", idioma: "pt_BR", parametros: ["Marina"] }))
      .toBe("[modelo: foocci_abordagem_inicial] (Marina)");
  });

  it("grava na conversa exatamente o texto renderizado que o cliente recebe", async () => {
    const { db, gravadas } = banco();
    const r = await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    expect(r.abordou, JSON.stringify(r)).toBe(true);
    expect(gravadas[0]?.texto).toBe("Olá, Marina! Aqui é a Foocci.");
    expect(gravadas[0]?.templateNome).toBe("foocci_abordagem_inicial");
  });

  it("recusa antes do envio quando o corpo integral não está sincronizado", async () => {
    modeloAprovado.mockResolvedValue(null);
    const { db, gravadas } = banco();
    const r = await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    expect(r.abordou).toBe(false);
    expect(gravadas).toHaveLength(0);
    expect(enviarModelo).not.toHaveBeenCalled();
  });
});

describe("texto integral do template", () => {
  it("substitui todas as variáveis na ordem aprovada", () => {
    const r = renderizarCorpoDoModelo(
      "Olá, {{1}}! Estou falando com o {{2}} porque encontramos vocês em {{3}}.",
      ["Kiyota Sushi", "Kiyota Sushi", "Google"],
    );
    expect(r).toEqual({
      ok: true,
      texto: "Olá, Kiyota Sushi! Estou falando com o Kiyota Sushi porque encontramos vocês em Google.",
    });
  });

  it("não grava texto parcial quando falta uma variável", () => {
    expect(renderizarCorpoDoModelo("Olá {{1}}, origem {{2}}", ["João"])).toEqual({
      ok: false,
      falta: "não foi possível renderizar {{2}} do modelo aprovado",
    });
  });
});

describe("⭐ a saudação do modelo — o arquivo de 4.880 é de estabelecimentos, não de gente", () => {
  /**
   * Medido no arquivo que o CEO mandou: a coluna "Nome" traz `.it Pizza`,
   * `100% Espetos`, `Bar do Zé`. Cortar no primeiro espaço — que é o certo para
   * gente — produziria "Olá .it", "Olá 100%", "Olá Bar" em 4.880 mensagens.
   *
   * Pior que não saudar: parece defeito, porque é.
   */
  const daLista = (nome: string, restaurante: string | null = null) => ({
    nome,
    restaurante,
    fonte: "LISTA_PROSPECCAO",
  });

  it("⭐ estabelecimento vai INTEIRO, e não cortado no primeiro espaço", () => {
    expect(saudacaoDoLead(daLista(".it Pizza"))).toBe(".it Pizza");
    expect(saudacaoDoLead(daLista("100% Espetos e Petiscos"))).toBe("100% Espetos e Petiscos");
    expect(saudacaoDoLead(daLista("Bar do Zé"))).toBe("Bar do Zé");
  });

  it("o campo dedicado vence a coluna genérica", () => {
    expect(saudacaoDoLead(daLista("contato", "Pizzaria Dona Ana"))).toBe("Pizzaria Dona Ana");
  });

  it("⭐ A METADE LEGÍTIMA: lead do formulário continua sendo saudado pelo PRIMEIRO nome", () => {
    // Sem esta, "usar o nome inteiro" viraria regra geral e o site passaria a
    // dizer "Olá Marina Gambarini" a quem digitou o próprio nome.
    expect(saudacaoDoLead({ nome: "Marina Gambarini", restaurante: null, fonte: "FORMULARIO_DEMONSTRACAO" }))
      .toBe("Marina");
  });

  it("telefone como nome continua não virando saudação, nos dois caminhos", () => {
    expect(saudacaoDoLead(daLista("5511999998888"))).toBeNull();
    expect(saudacaoDoLead(daLista("+55 (11) 99999-8888"))).toBeNull();
    expect(saudacaoDoLead({ nome: "5511999998888", restaurante: null, fonte: "FORMULARIO_DEMONSTRACAO" }))
      .toBeNull();
  });

  it("sem nome nenhum devolve null — e aí o modelo vai sem parâmetro", () => {
    expect(saudacaoDoLead(daLista(""))).toBeNull();
    expect(saudacaoDoLead({ nome: null, restaurante: null, fonte: "LISTA_PROSPECCAO" })).toBeNull();
  });
});

/**
 * ⭐⭐ O PORTÃO ESCOLHIDO PELA ORIGEM — decisão do Diretor Geral, 08/09/2026.
 *
 * ── O QUE ESTES CASOS GUARDAM ───────────────────────────────────────────────
 *
 * A fila consultava o portão FRIO e o envio consultava o MORNO. Dez itens saíam
 * liberados da fila e os dez morriam no envio (`portaoRecusou: 10`), medido na
 * primeira rodada real. Perguntar *"quando esta pessoa entregou os dados?"* a
 * quem nunca preencheu formulário nenhum não é rigor — é a pergunta errada.
 *
 * As três travas que vieram junto, e cada uma tem caso próprio aqui:
 *
 *   1. o portão é escolhido pela ORIGEM, e origem desconhecida cai no morno;
 *   2. `consentAt` nulo NUNCA cai em `createdAt`;
 *   3. opt-out e teto do dia valem nos DOIS portões.
 */
describe("qual portão o lead atravessa", () => {
  const DE_LISTA = { fonte: "LISTA_PROSPECCAO", consentAt: null };

  it("⭐ lead de lista SEM consentimento é abordado — é o caso que a rodada media em zero", async () => {
    // Este é o caso concreto: 4.000 contatos de lista, nenhum com formulário
    // preenchido. Antes desta mudança, os 4.000 seriam barrados um a um.
    const { db } = banco({ lead: DE_LISTA });

    const r = await abordarLead(db, { leadId: "L1", autor: "SISTEMA", autorUserId: "u1", agora: AGORA });

    expect(r.abordou, JSON.stringify(r)).toBe(true);
  });

  it("⭐ e a base legal vem do LOTE, não de uma data nossa disfarçada de consentimento", async () => {
    // Lote sem proveniência = ninguém declarou por que temos o contato.
    const { db } = banco({
      lead: DE_LISTA,
      item: { lote: { situacao: "LIBERADO", proveniencia: "" } },
    });

    const r = await abordarLead(db, { leadId: "L1", autor: "SISTEMA", autorUserId: "u1", agora: AGORA });

    expect(r.abordou).toBe(false);
    expect(r.abordou === false && r.detalhe).toContain("PROSPECCAO_SEM_BASE_LEGAL");
  });

  it("lead que diz vir de lista e não tem lote nenhum: recusado, e o motivo diz isso", async () => {
    const { db } = banco({ lead: DE_LISTA, item: null });

    const r = await abordarLead(db, { leadId: "L1", autor: "SISTEMA", autorUserId: "u1", agora: AGORA });

    expect(r.abordou).toBe(false);
    expect(r.abordou === false && r.detalhe).toContain("não há lote que o autorize");
  });

  it("⭐ lote PAUSADO NÃO barra mais o envio — ordem do CEO, 11/09/2026: lote não impede envio", async () => {
    // Até 10/09/2026 esta trava barrava, e o teste esperava exatamente isso —
    // ver o commit anterior. A operação por lotes foi removida: a base legal
    // (`proveniencia`) continua vindo do lote, mas a situação dele deixou de
    // ser lida. As únicas travas comerciais que restam são o interruptor
    // geral, o teto do dia/janela, opt-out, telefone inválido e falha
    // sistêmica — nenhuma delas é "o lote está pausado".
    const { db } = banco({
      lead: DE_LISTA,
      item: { lote: { situacao: "PAUSADO", proveniencia: "Lista pública" } },
    });

    const r = await abordarLead(db, { leadId: "L1", autor: "SISTEMA", autorUserId: "u1", agora: AGORA });

    expect(r.abordou, JSON.stringify(r)).toBe(true);
  });

  it("prospecção pausada na configuração barra, mesmo com lote liberado", async () => {
    const { db } = banco({
      lead: DE_LISTA,
      config: { outboundLigado: true, pausadoEm: new Date("2026-09-06T00:00:00Z") },
    });

    const r = await abordarLead(db, { leadId: "L1", autor: "SISTEMA", autorUserId: "u1", agora: AGORA });

    expect(r.abordou).toBe(false);
    expect(r.abordou === false && r.detalhe).toContain("PROSPECCAO_DESLIGADA");
  });

  // ── TRAVA 1: origem desconhecida cai no mais restritivo ────────────────────

  it("⭐ fonte NULA vai para o portão morno — o erro tem de ser não falar, nunca falar demais", async () => {
    // Se alguém criar uma fonte nova e esquecer de classificá-la, o lead não
    // pode escorregar para o portão de estranhos por omissão.
    const { db } = banco({ lead: { fonte: null, consentAt: null } });

    const r = await abordarLead(db, { leadId: "L1", autor: "HUMANO", autorUserId: "u1", agora: AGORA });

    expect(r.abordou).toBe(false);
    expect(r.abordou === false && r.detalhe).toContain("CONSENTIMENTO_DESCONHECIDO");
  });

  it("fonte desconhecida qualquer também cai no morno, e não no frio", async () => {
    const { db } = banco({ lead: { fonte: "FONTE_QUE_NINGUEM_CLASSIFICOU", consentAt: null } });

    const r = await abordarLead(db, { leadId: "L1", autor: "HUMANO", autorUserId: "u1", agora: AGORA });

    expect(r.abordou).toBe(false);
    expect(r.abordou === false && r.detalhe).toContain("CONSENTIMENTO_DESCONHECIDO");
  });

  // ── TRAVA 2: `consentAt` nulo nunca cai em `createdAt` ─────────────────────

  it("⭐ lead de formulário SEM consentAt é recusado — createdAt não vira consentimento", async () => {
    // Era exatamente esta linha que deixava a mentira passar: um lead criado
    // agora tinha "consentimento de zero dias de idade", que era a data em que
    // NÓS criamos a ficha.
    const { db } = banco({
      lead: { fonte: "FORMULARIO_DEMONSTRACAO", consentAt: null, createdAt: AGORA },
    });

    const r = await abordarLead(db, { leadId: "L1", autor: "HUMANO", autorUserId: "u1", agora: AGORA });

    expect(r.abordou, "createdAt voltou a ser lido como consentimento").toBe(false);
    expect(r.abordou === false && r.detalhe).toContain("CONSENTIMENTO_DESCONHECIDO");
  });

  // ── TRAVA 3: opt-out e teto do dia valem nos DOIS portões ──────────────────

  it("⭐ opt-out barra no portão FRIO igual ao morno — é a regra 1 dos dois", async () => {
    const { db } = banco({
      lead: { ...DE_LISTA, optOutAt: new Date("2026-09-02T00:00:00Z") },
    });

    const r = await abordarLead(db, { leadId: "L1", autor: "SISTEMA", autorUserId: "u1", agora: AGORA });

    expect(r.abordou).toBe(false);
    expect(r.abordou === false && r.detalhe).toContain("LEAD_OPT_OUT");
  });

  it("⭐ o teto do dia barra o lead de lista — ele vale por FORA do portão", async () => {
    // O freio roda depois do portão, qualquer que tenha sido o portão. Se o teto
    // morasse dentro de cada um, haveria duas contagens do mesmo teto — e duas
    // contagens do mesmo teto é como se manda o dobro sem ninguém perceber.
    const { db } = banco({ lead: DE_LISTA, jaSairam: 9999 });

    const r = await abordarLead(db, { leadId: "L1", autor: "SISTEMA", autorUserId: "u1", agora: AGORA });

    expect(r.abordou).toBe(false);
    expect(r.abordou === false && r.motivo).toBe("ritmo");
  });

  it("o descanso entre tentativas continua valendo no portão frio", async () => {
    const { db } = banco({
      lead: { ...DE_LISTA, lastContactedAt: new Date("2026-09-07T09:00:00Z") },
    });

    const r = await abordarLead(db, { leadId: "L1", autor: "SISTEMA", autorUserId: "u1", agora: AGORA });

    expect(r.abordou).toBe(false);
    expect(r.abordou === false && r.detalhe).toContain("DESCANSO_ATIVO");
  });

  it("o configurável só APERTA: descanso maior que o padrão vale; menor é ignorado", async () => {
    // 24h configurado é menor que as 48h do desenho — o desenho manda.
    const { db } = banco({
      lead: { ...DE_LISTA, lastContactedAt: new Date("2026-09-06T13:00:00Z") },
      // ⚠️ `limiteDiario` explícito: sem ele o teto do dia é 0 e a recusa vira
      // PROSPECCAO_DESLIGADA antes de o descanso ser sequer consultado.
      config: { outboundLigado: true, pausadoEm: null, horasEntreAbordagens: 24, limiteDiario: 250 },
    });

    const r = await abordarLead(db, { leadId: "L1", autor: "SISTEMA", autorUserId: "u1", agora: AGORA });

    expect(r.abordou, "o configurável afrouxou o descanso").toBe(false);
    expect(r.abordou === false && r.detalhe).toContain("DESCANSO_ATIVO");
  });
});

/**
 * ⭐ OS CASOS QUE A REVISÃO ADVERSARIAL DO `qualidade` COBROU — 08/09/2026.
 *
 * Ela achou três mutações vivas nas três linhas novas que tocam o banco, todas
 * pela mesma causa: o duplo de banco era `async () => valor` e nenhum dos 822
 * testes verdes olhava para o argumento da consulta.
 *
 * E achou uma inversão real: o silêncio pedido tinha deixado de ser o primeiro
 * motivo, encoberto por "o lote está pausado".
 */
describe("o que a revisão adversarial cobrou", () => {
  const DE_LISTA = { fonte: "LISTA_PROSPECCAO", consentAt: null };

  // ── A inversão do motivo ──────────────────────────────────────────────────

  it("⭐ silêncio pedido vence o lote pausado — o motivo é LEAD_OPT_OUT, não o lote", async () => {
    // O bloqueio acontecia nas duas versões. Mas o motivo é o que as camadas de
    // cima classificam e o que a pessoa lê na tela: com o motivo errado, alguém
    // libera o lote achando que resolveu, e volta a falar com quem pediu silêncio.
    const { db } = banco({
      lead: { ...DE_LISTA, optOutAt: new Date("2026-09-02T00:00:00Z") },
      item: { lote: { situacao: "PAUSADO", proveniencia: "Lista pública" } },
    });

    const r = await abordarLead(db, { leadId: "L1", autor: "SISTEMA", autorUserId: "u1", agora: AGORA });

    expect(r.abordou).toBe(false);
    expect(r.abordou === false && r.detalhe, "o lote encobriu o silêncio").toContain("LEAD_OPT_OUT");
  });

  it("silêncio pedido vence até a ausência de lote", async () => {
    const { db } = banco({
      lead: { ...DE_LISTA, optOutAt: new Date("2026-09-02T00:00:00Z") },
      item: null,
    });

    const r = await abordarLead(db, { leadId: "L1", autor: "SISTEMA", autorUserId: "u1", agora: AGORA });

    expect(r.abordou === false && r.detalhe).toContain("LEAD_OPT_OUT");
  });

  // ── As três mutações que sobreviviam ──────────────────────────────────────

  it("⭐ o lote é procurado PELO LEAD, e o mais recente — where e orderBy medidos", async () => {
    // M1: `where: { leadId }` → `where: {}` faria todo lead de lista herdar o
    // item mais recente da tabela inteira — base legal de outra pessoa.
    const { db, consultas } = banco({ lead: DE_LISTA });
    await abordarLead(db, { leadId: "L1", autor: "SISTEMA", autorUserId: "u1", agora: AGORA });

    const q = consultas.find((c) => c.modelo === "itemDeProspeccao") as
      | { where: { leadId: string }; orderBy: { criadoEm: string } }
      | undefined;
    expect(q, "não consultou o item do lead").toBeTruthy();
    expect(q!.where.leadId, "o lote seria de outra pessoa").toBe("L1");
    expect(q!.orderBy.criadoEm).toBe("desc");
  });

  it("a configuração lida é a singleton, e não a primeira que aparecer", async () => {
    const { db, consultas } = banco({ lead: DE_LISTA });
    await abordarLead(db, { leadId: "L1", autor: "SISTEMA", autorUserId: "u1", agora: AGORA });

    const q = consultas.find((c) => c.modelo === "prospeccaoConfig") as
      | { where: { id: string } }
      | undefined;
    expect(q!.where.id).toBe("singleton");
  });

  it("⭐ prospecção DESLIGADA barra — o interruptor mestre não é decorativo", async () => {
    // M3: sem este caso, apagar `Boolean(config?.outboundLigado) &&` sobrevivia,
    // e a prospecção desligada passaria a enviar.
    const { db } = banco({
      lead: DE_LISTA,
      config: { outboundLigado: false, pausadoEm: null, limiteDiario: 250 },
    });

    const r = await abordarLead(db, { leadId: "L1", autor: "SISTEMA", autorUserId: "u1", agora: AGORA });

    expect(r.abordou).toBe(false);
    expect(r.abordou === false && r.detalhe).toContain("PROSPECCAO_DESLIGADA");
  });

  it("⭐ SEM configuração nenhuma a resposta é desligada — nunca 'sem limite'", async () => {
    // Guardrail 2: esquecer o portão jamais pode significar aprovado.
    const { db } = banco({ lead: DE_LISTA, config: null });

    const r = await abordarLead(db, { leadId: "L1", autor: "SISTEMA", autorUserId: "u1", agora: AGORA });

    expect(r.abordou, "config ausente virou passe livre").toBe(false);
    expect(r.abordou === false && r.detalhe).toContain("PROSPECCAO_DESLIGADA");
  });

  // ── O teto do dia da prospecção, que o painel não via ──────────────────────

  it("⭐ o teto do dia da prospecção barra no envio — o botão do painel não fura mais", async () => {
    // Quem clica "Abordar" na tela NÃO passa pela fila, então o teto que o dono
    // configurou (hoje, dez) não valia para ele.
    const { db } = banco({
      lead: DE_LISTA,
      config: { outboundLigado: true, pausadoEm: null, limiteDiario: 10 },
      usadosHoje: 10,
    });

    const r = await abordarLead(db, { leadId: "L1", autor: "HUMANO", autorUserId: "u1", agora: AGORA });

    expect(r.abordou, "o teto do dia foi furado pelo painel").toBe(false);
    expect(r.abordou === false && r.detalhe).toContain("PROSPECCAO_DESLIGADA");
  });

  it("abaixo do teto do dia, passa", async () => {
    const { db } = banco({
      lead: DE_LISTA,
      config: { outboundLigado: true, pausadoEm: null, limiteDiario: 10 },
      usadosHoje: 9,
    });

    const r = await abordarLead(db, { leadId: "L1", autor: "HUMANO", autorUserId: "u1", agora: AGORA });

    expect(r.abordou, JSON.stringify(r)).toBe(true);
  });

  it("teto do dia ZERO não é 'sem limite' — é 'nada sai'", async () => {
    const { db } = banco({
      lead: DE_LISTA,
      config: { outboundLigado: true, pausadoEm: null, limiteDiario: 0 },
      usadosHoje: 0,
    });

    const r = await abordarLead(db, { leadId: "L1", autor: "HUMANO", autorUserId: "u1", agora: AGORA });

    expect(r.abordou, "zero virou sem limite").toBe(false);
  });
});
