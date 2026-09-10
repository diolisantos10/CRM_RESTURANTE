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
import { abordarLead, primeiroNome, saudacaoDoLead, restauranteDoLead, resumoDoModelo, modeloConfigurado } from "./abordar";

const enviarModelo = vi.hoisted(() => vi.fn());
const canalPronto = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/services/foocci-sdr/FoocciSalesChannel", async (original) => {
  const real = await original<typeof import("@/services/foocci-sdr/FoocciSalesChannel")>();
  return { ...real, enviarModeloDeVendas: enviarModelo, canalDeVendasPronto: canalPronto };
});

const ambiente = { ...process.env };

const LEAD = {
  id: "L1",
  nome: "Marina Gambarini",
  whatsapp: "+5511999998888",
  optOutAt: null as Date | null,
  consentAt: new Date("2026-09-01T10:00:00Z"),
  createdAt: new Date("2026-09-01T10:00:00Z"),
  lastContactedAt: null as Date | null,
  // O modelo de abordagem fria pede restaurante ({{1}}/{{2}}) e lugar ({{3}}).
  restaurante: "Cantina da Marina" as string | null,
  cidade: "São Paulo" as string | null,
  fonte: null as string | null,
};

const AGORA = new Date("2026-09-07T13:00:00Z");

function banco(over: {
  lead?: (Partial<typeof LEAD> & { fonte?: string | null }) | null;
  tentativas?: number;
  jaSairam?: number;
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
        findUnique: async () =>
          over.lead === null ? null : { ...LEAD, ...(over.lead ?? {}) },
        update: async (args: { data: Record<string, unknown> }) => {
          carimbos.push(args.data);
          return {};
        },
      },
      leadMensagem: {
        count: async (args: { where: { tipo?: string } }) =>
          // A ponte conta duas coisas diferentes com o mesmo `count`: as
          // tentativas anteriores (sem `tipo`) e o ritmo (com `tipo: TEMPLATE`).
          args.where.tipo === "TEMPLATE" ? (over.jaSairam ?? 0) : (over.tentativas ?? 0),
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
  process.env.FOOCCI_SDR_MODELO_ABORDAGEM = "abordagem_restaurante_fria";
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
    expect(gravadas[0]!.templateNome).toBe("abordagem_restaurante_fria");
    expect(gravadas[0]!.status).toBe("PENDENTE");
    expect(atualizadas[0]!.status).toBe("ENVIADA");
  });

  it("⭐ leva o MAPA do modelo: restaurante em {{1}} e {{2}}, o lugar em {{3}}", async () => {
    const { db } = banco();
    await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    const modelo = enviarModelo.mock.calls[0]![2] as { parametros: string[] };
    expect(modelo.parametros).toEqual(["Cantina da Marina", "Cantina da Marina", "São Paulo"]);
  });

  it("⭐ lead de lista: o lugar vem do ITEM (bairro, cidade), que é quem guarda o bairro", async () => {
    const { db } = banco({
      lead: { nome: "Bar do Zé", restaurante: null, cidade: null, fonte: "LISTA_PROSPECCAO" },
      item: {
        bairro: "Pinheiros", cidade: "São Paulo", estado: "SP",
        lote: { situacao: "LIBERADO", proveniencia: "Lista pública (SP)" },
      } as never,
    });
    await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    const modelo = enviarModelo.mock.calls[0]![2] as { parametros: string[] };
    expect(modelo.parametros).toEqual(["Bar do Zé", "Bar do Zé", "Pinheiros, São Paulo"]);
  });

  it("toda mensagem sai com responsável — nunca 'o sistema mandou'", async () => {
    const { db, gravadas } = banco();
    await abordarLead(db, { leadId: "L1", autorUserId: "u7", agora: AGORA });
    expect(gravadas[0]!.autorUserId).toBe("u7");
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

  it("⛔ contato sem o campo que o modelo pede é PULADO com `campoVazio:{{n}}` — nada gravado, nada enviado", async () => {
    const { db, gravadas } = banco({ lead: { restaurante: null } });
    const r = await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    expect(r).toEqual({ abordou: false, motivo: "campoVazio", detalhe: "campoVazio:{{1}}" });
    expect(gravadas).toHaveLength(0);
    expect(enviarModelo).not.toHaveBeenCalled();
  });

  it("⛔ modelo configurado sem mapa: não sai no chute", async () => {
    process.env.FOOCCI_SDR_MODELO_ABORDAGEM = "modelo_que_ninguem_mapeou";
    const { db } = banco();
    const r = await abordarLead(db, { leadId: "L1", autorUserId: "u1", agora: AGORA });

    expect(r.abordou).toBe(false);
    if (!r.abordou) expect(r.motivo).toBe("semMapa");
    expect(enviarModelo).not.toHaveBeenCalled();
  });

  it("o restaurante do mapa: lista → estabelecimento; formulário → o campo `restaurante`, nunca o primeiro nome", () => {
    expect(restauranteDoLead({ nome: "Bar do Zé", restaurante: null, fonte: "LISTA_PROSPECCAO" })).toBe("Bar do Zé");
    expect(restauranteDoLead({ nome: "Marina Gambarini", restaurante: "Cantina da Marina", fonte: null })).toBe("Cantina da Marina");
    expect(restauranteDoLead({ nome: "Marina Gambarini", restaurante: null, fonte: null })).toBeNull();
  });
});

describe("a configuração do modelo", () => {
  it("idioma tem padrão pt_BR, nome não tem padrão nenhum", () => {
    // Nome com padrão faria a casa mandar um modelo que ninguém escolheu.
    expect(modeloConfigurado({})).toEqual({ nome: "", idioma: "pt_BR" });
  });

  it("o resumo gravado na conversa diz qual modelo saiu", () => {
    // Bolha vazia na tela do vendedor é pior que uma que diz o nome do modelo.
    expect(resumoDoModelo({ nome: "abordagem_restaurante_fria", idioma: "pt_BR", parametros: ["Bar do Zé", "Bar do Zé", "Pinheiros, São Paulo"] }))
      .toBe("[modelo: abordagem_restaurante_fria] (Bar do Zé · Bar do Zé · Pinheiros, São Paulo)");
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

  it("lote que não está LIBERADO barra o envio — pausar tem efeito aqui também", async () => {
    const { db } = banco({
      lead: DE_LISTA,
      item: { lote: { situacao: "PAUSADO", proveniencia: "Lista pública" } },
    });

    const r = await abordarLead(db, { leadId: "L1", autor: "SISTEMA", autorUserId: "u1", agora: AGORA });

    expect(r.abordou).toBe(false);
    expect(r.abordou === false && r.detalhe).toContain("PAUSADO");
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
