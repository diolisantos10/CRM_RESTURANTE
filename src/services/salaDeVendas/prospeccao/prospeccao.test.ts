/**
 * As travas da prospecção.
 *
 * O fio deste arquivo: **a lista é o ativo, e todo teste aqui existe para provar
 * que ela não é queimada por descuido.** Cada caso é uma forma concreta de
 * queimar — abordar quem pediu silêncio, abordar duas vezes, criar dois donos
 * para a mesma pessoa, estourar o teto, ou gravar consentimento que não houve.
 */

import { describe, it, expect, vi } from "vitest";
import {
  importarLote,
  ListaGrandeDemais,
  ProvenienciaAusente,
  MAX_LINHAS_POR_IMPORTACAO,
} from "./lote";
import { montarFilaDeProspeccao, materializarLead, conferirElegibilidadeReal } from "./selecao";
import { avaliarAbordagemDeProspeccao } from "@/services/foocci-sdr/LeadContactSafety";

/** Quarta-feira, 14h em São Paulo — dentro da janela, para não misturar causas. */
const AGORA = new Date("2026-09-02T17:00:00Z");

// ═══════════════════════════════════════════════════════════════════════════
// O PORTÃO DA ABORDAGEM FRIA
// ═══════════════════════════════════════════════════════════════════════════

const BASE = {
  telefone: "11987654321",
  optOutAt: null,
  tentativas: 0,
  ultimoContatoEm: null,
  historicoConhecido: true,
  canalPronto: true,
  prospeccaoLiberada: true,
  baseLegalDeclarada: "Lista pública de restaurantes de Curitiba, coletada em 08/2026.",
  agora: AGORA,
};

describe("portão da abordagem fria", () => {
  it("libera quando tudo está declarado e dentro das regras", () => {
    expect(avaliarAbordagemDeProspeccao(BASE).sendable).toBe(true);
  });

  it("⛔ opt-out é terminal, e vence até a base legal mais bem escrita", () => {
    const d = avaliarAbordagemDeProspeccao({ ...BASE, optOutAt: new Date("2026-01-01") });
    expect(d.sendable).toBe(false);
    expect(d.reason).toBe("LEAD_OPT_OUT");
  });

  it("⛔ sem base legal declarada não aborda ninguém", () => {
    // O caso que este teste protege: alguém importa uma planilha achada num
    // grupo, deixa a proveniência vazia e libera. Sem esta trava, o sistema
    // abordaria estranhos sem ninguém conseguir responder de onde vieram.
    const d = avaliarAbordagemDeProspeccao({ ...BASE, baseLegalDeclarada: "   " });
    expect(d.sendable).toBe(false);
    expect(d.reason).toBe("PROSPECCAO_SEM_BASE_LEGAL");
  });

  it("⛔ prospecção desligada barra, mesmo com tudo o resto perfeito", () => {
    const d = avaliarAbordagemDeProspeccao({ ...BASE, prospeccaoLiberada: false });
    expect(d.sendable).toBe(false);
    expect(d.reason).toBe("PROSPECCAO_DESLIGADA");
  });

  it("⛔ histórico desconhecido é NÃO — zero não é histórico limpo", () => {
    const d = avaliarAbordagemDeProspeccao({ ...BASE, historicoConhecido: false });
    expect(d.sendable).toBe(false);
    expect(d.reason).toBe("HISTORICO_DESCONHECIDO");
  });

  it("⛔ o teto de insistência vale igual ao do lead que nos procurou", () => {
    const d = avaliarAbordagemDeProspeccao({ ...BASE, tentativas: 2 });
    expect(d.sendable).toBe(false);
    expect(d.reason).toBe("TETO_DE_TENTATIVAS");
  });

  it("⛔ descanso entre tentativas é respeitado", () => {
    const d = avaliarAbordagemDeProspeccao({
      ...BASE,
      tentativas: 1,
      ultimoContatoEm: new Date(AGORA.getTime() - 2 * 3_600_000),
    });
    expect(d.sendable).toBe(false);
    expect(d.reason).toBe("DESCANSO_ATIVO");
  });

  it("⛔ canal não pronto barra antes de qualquer coisa de negócio", () => {
    const d = avaliarAbordagemDeProspeccao({ ...BASE, canalPronto: false });
    expect(d.sendable).toBe(false);
    expect(d.reason).toBe("CANAL_INDISPONIVEL");
  });

  it("⛔ fora da janela não aborda (domingo de manhã)", () => {
    const domingo = new Date("2026-09-06T13:00:00Z");
    const d = avaliarAbordagemDeProspeccao({ ...BASE, agora: domingo });
    expect(d.sendable).toBe(false);
    expect(d.reason).toBe("FORA_DA_JANELA");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// IMPORTAÇÃO
// ═══════════════════════════════════════════════════════════════════════════

function dbDeImportacao(
  leadsExistentes: Record<string, string> = {},
  pendentesEmOutroLote: string[] = [],
) {
  const itensCriados: any[] = [];
  return {
    itensCriados,
    db: {
      loteDeProspeccao: {
        create: vi.fn().mockResolvedValue({ id: "lote1" }),
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
      itemDeProspeccao: {
        create: vi.fn(async ({ data }: any) => {
          itensCriados.push(data);
          return { id: `i${itensCriados.length}` };
        }),
        update: vi.fn().mockResolvedValue({}),
        findFirst: vi.fn(async ({ where }: any) =>
          pendentesEmOutroLote.includes(where.whatsappDigits) ? { id: "outro-item" } : null,
        ),
      },
      siteLead: {
        // O casamento é por igualdade contra as GRAFIAS possíveis do telefone
        // (`in`), e não por sufixo — o dublê imita isso para o teste medir o
        // código real.
        findFirst: vi.fn(async ({ where }: any) => {
          const grafias: string[] = where.whatsappDigits?.in ?? [];
          const achado = Object.entries(leadsExistentes).find(([digitos]) =>
            grafias.includes(digitos),
          );
          return achado ? { id: achado[1] } : null;
        }),
      },
    } as any,
  };
}

describe("importar a lista", () => {
  it("⛔ recusa lote sem proveniência declarada", async () => {
    const { db } = dbDeImportacao();
    await expect(
      importarLote(db, { nome: "Curitiba", proveniencia: "  ", linhas: [] }),
    ).rejects.toBeInstanceOf(ProvenienciaAusente);
  });

  it("⛔ recusa lista maior que o teto por lote", async () => {
    const { db } = dbDeImportacao();
    const linhas = Array.from({ length: MAX_LINHAS_POR_IMPORTACAO + 1 }, (_, i) => ({
      whatsapp: `1198765${String(i).padStart(4, "0")}`,
    }));
    await expect(
      importarLote(db, { nome: "Gigante", proveniencia: "lista", linhas }),
    ).rejects.toBeInstanceOf(ListaGrandeDemais);
  });

  it("o mesmo telefone repetido no arquivo entra uma vez só", async () => {
    const { db, itensCriados } = dbDeImportacao();
    const r = await importarLote(db, {
      nome: "Curitiba",
      proveniencia: "Lista pública, 08/2026",
      linhas: [
        { whatsapp: "(11) 98765-4321", nome: "Cantina A" },
        { whatsapp: "11987654321", nome: "Cantina A (de novo)" },
      ],
    });

    expect(r.recebidas).toBe(2);
    expect(r.repetidasNoArquivo).toBe(1);
    expect(itensCriados).toHaveLength(1);
  });

  it("⭐ quem já é lead entra como DUPLICADO e aponta para a carteira existente", async () => {
    // O erro que este teste evita é o mais caro da operação: prospectar como
    // estranho alguém que já está conversando com a gente — dois donos, duas
    // abordagens, e o cliente percebendo que a casa não se fala.
    const { db, itensCriados } = dbDeImportacao({ "5511987654321": "lead-existente" });
    const r = await importarLote(db, {
      nome: "Curitiba",
      proveniencia: "Lista pública, 08/2026",
      linhas: [{ whatsapp: "11987654321" }],
    });

    expect(r.jaEramLead).toBe(1);
    expect(r.aceitas).toBe(0);
    expect(itensCriados[0].situacao).toBe("DUPLICADO");
    expect(itensCriados[0].leadId).toBe("lead-existente");
  });

  it("⭐ o mesmo telefone pendente em OUTRO lote não é abordado duas vezes", async () => {
    // Reimportar a planilha cria um lote NOVO, então o índice único
    // `(loteId, whatsappDigits)` não pega nada entre importações. Sem esta
    // consulta, o mesmo contato ficaria pendente em dois lotes e receberia duas
    // abordagens de pessoas diferentes, cada uma achando que era a primeira.
    const { db, itensCriados } = dbDeImportacao({}, ["5511987654321"]);

    const r = await importarLote(db, {
      nome: "Curitiba (de novo)",
      proveniencia: "Lista pública, 08/2026",
      linhas: [{ whatsapp: "11987654321" }],
    });

    expect(r.repetidasEmOutroLote).toBe(1);
    expect(r.aceitas).toBe(0);
    expect(itensCriados[0].situacao).toBe("DUPLICADO");
  });

  it("telefone impossível é RECUSADO com motivo, e não some", async () => {
    const { db, itensCriados } = dbDeImportacao();
    const r = await importarLote(db, {
      nome: "Curitiba",
      proveniencia: "Lista pública, 08/2026",
      linhas: [{ whatsapp: "123" }],
    });

    expect(r.invalidas).toBe(1);
    expect(itensCriados[0].situacao).toBe("RECUSADO");
    expect(itensCriados[0].motivo).toBeTruthy();
  });

  /**
   * ⛔ ESTE CASO MUDOU DE LADO EM 10/09/2026, POR ORDEM — e a troca fica
   * registrada, porque até ontem ele provava exatamente o contrário.
   *
   * Ele exigia que o lote nascesse `RASCUNHO`: importar não autorizava abordar,
   * e alguém tinha de clicar "Liberar". A regra era boa e virou defeito quando a
   * operação cresceu — o arquivo é fatiado de 500 em 500, então uma lista de
   * 8.000 contatos pedia **dezesseis** cliques de liberação para uma decisão que
   * a pessoa já tinha tomado ao subir o arquivo. Ordem do Diretor Geral: a base
   * é contínua, e importação válida entra no estoque.
   *
   * ── ⚠️ O QUE NÃO PODE TER SE PERDIDO NA TROCA ─────────────────────────────
   *
   * A autorização não sumiu; mudou de lugar. Continua havendo ato humano
   * declarado e com dono: a **proveniência** (obrigatória — o caso da
   * `ProvenienciaAusente` acima é a sonda de controle disso) e o
   * `liberadoPorUserId`, que grava QUEM assinou. Sem estas duas linhas, "base
   * contínua" teria virado "abordar sem ninguém ter assinado", que é outra
   * coisa e é justamente o que a regra velha existia para impedir.
   */
  it("⭐ a importação já entra na base contínua — e ainda assim tem quem assinou", async () => {
    const { db } = dbDeImportacao();
    await importarLote(db, {
      nome: "Curitiba",
      proveniencia: "Lista pública, 08/2026",
      criadoPor: "Dioli (u-1)",
      criadoPorUserId: "u-1",
      linhas: [{ whatsapp: "11987654321" }],
    });
    const dados = (db.loteDeProspeccao.create as any).mock.calls[0][0].data;

    expect(dados.situacao).toBe("LIBERADO");
    // A base legal declarada continua viajando com o lote.
    expect(dados.proveniencia).toBe("Lista pública, 08/2026");
    // E continua havendo um responsável que o banco reconhece.
    expect(dados.liberadoPorUserId).toBe("u-1");
    expect(dados.liberadoEm).toBeInstanceOf(Date);
  });

  it("⛔ sem id de responsável, o lote entra SEM assinatura — e a rodada não o aborda", async () => {
    // A sonda de controle da regra acima. `liberadoPorUserId` vem da sessão; se
    // um chamador antigo não o mandar, o campo tem de ficar AUSENTE em vez de
    // receber o rótulo de tela. Foi essa confusão exata — rótulo `Nome (id)`
    // entregue a uma coluna com chave estrangeira — que derrubou a primeira
    // rodada real em 08/09/2026, com HTTP 500 levando junto outros nove
    // contatos que não tinham nada a ver com o problema.
    const { db } = dbDeImportacao();
    await importarLote(db, {
      nome: "Curitiba",
      proveniencia: "Lista pública, 08/2026",
      criadoPor: "Dioli (u-1)",
      linhas: [{ whatsapp: "11987654321" }],
    });
    const dados = (db.loteDeProspeccao.create as any).mock.calls[0][0].data;

    expect(dados.liberadoPorUserId).toBeUndefined();
    expect(dados.liberadoPor).toBe("Dioli (u-1)");
  });
});

// ⛔ `describe("liberar o lote", ...)` foi removido em 11/09/2026:
// `liberarLote`/`pausarLote` deixaram de existir (`lote.ts`) — a operação por
// lotes foi apagada, não escondida. Ver `selecao.test` / `prospeccao.test.ts`
// mais abaixo para a prova de que a situação do lote não gate mais nada.

// ═══════════════════════════════════════════════════════════════════════════
// A FILA DO DIA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param abordagensHoje quantas saíram desde a meia-noite de São Paulo.
 * @param janela quantas saíram nas últimas 24h corridas (a conta da Meta) e na
 *   última hora. Separado de `abordagensHoje` de propósito: os dois divergem
 *   todo dia, e é dessa divergência que nasce o defeito da meia-noite.
 */
function dbDeFila(
  config: any,
  itens: any[] = [],
  abordagensHoje = 0,
  leadNaBase: any = null,
  janela: { nas24h?: number; naHora?: number } = {},
) {
  const leadsCriados: any[] = [];
  const nas24h = janela.nas24h ?? 0;
  const naHora = janela.naHora ?? 0;

  return {
    leadsCriados,
    db: {
      prospeccaoConfig: { findUnique: vi.fn().mockResolvedValue(config) },
      itemDeProspeccao: {
        findMany: vi.fn().mockResolvedValue(itens),
        update: vi.fn().mockResolvedValue({}),
      },
      siteLead: {
        count: vi.fn().mockResolvedValue(abordagensHoje),
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(leadNaBase),
        create: vi.fn(async ({ data }: any) => {
          leadsCriados.push(data);
          return { id: "novo-lead", optOutAt: null, lastContactedAt: null };
        }),
      },
      leadMensagem: {
        // O freio faz DUAS contagens na mesma tabela — hora e 24h — e o dublê
        // precisa distinguir qual é qual, senão um teste da janela derrubaria o
        // teto da hora junto e passaria pelo motivo errado. A janela pedida
        // está no `gte`.
        count: vi.fn(async (args: any) => {
          const gte: Date | undefined = args?.where?.ocorreuEm?.gte;
          if (!gte) return 0;
          const atras = AGORA.getTime() - gte.getTime();
          return atras <= 60 * 60 * 1000 + 1000 ? naHora : nas24h;
        }),
      },
    } as any,
  };
}

const ITEM = {
  id: "i1",
  loteId: "lote1",
  leadId: null,
  nome: "Cantina do Zé",
  whatsapp: "11987654321",
  whatsappDigits: "5511987654321",
  empresa: "Cantina do Zé",
  cidade: "Curitiba",
  tipo: "Italiana",
  // ── ⭐ AMPLIAÇÃO DA BASE FRIA, 11/09/2026 ──────────────────────────────────
  // `materializarLead` lê estes quatro para decidir se cria LeadQualificacao
  // e para transferir email/tags — sem eles aqui, `item.canaisAtuais.length`
  // quebraria em runtime (undefined não tem `.length`).
  email: null,
  numeroDeUnidades: null,
  canaisAtuais: [] as string[],
  observacoes: null,
  tags: [] as string[],
  lote: { id: "lote1", proveniencia: "Lista pública, 08/2026", limiteDiario: 20 },
};

describe("a fila do dia", () => {
  it("⛔ sem configuração nenhuma a prospecção está DESLIGADA, não liberada", async () => {
    // A falha que este teste evita é a pior classe: banco novo, tabela vazia, e
    // o código interpretando ausência de configuração como permissão.
    const { db } = dbDeFila(null, [ITEM]);
    const fila = await montarFilaDeProspeccao(db, { canalPronto: true, agora: AGORA });
    expect(fila.liberados).toHaveLength(0);
    expect(fila.motivoDaFilaVazia).toContain("desligada");
  });

  it("⛔ pausa tem efeito imediato, sem deploy", async () => {
    const { db } = dbDeFila(
      { outboundLigado: true, limiteDiario: 20, pausadoEm: new Date(), motivo: "número instável" },
      [ITEM],
    );
    const fila = await montarFilaDeProspeccao(db, { canalPronto: true, agora: AGORA });
    expect(fila.liberados).toHaveLength(0);
    expect(fila.motivoDaFilaVazia).toContain("pausada");
  });

  it("⛔ teto do dia atingido esvazia a fila e diz o número", async () => {
    const { db } = dbDeFila(
      { outboundLigado: true, limiteDiario: 20, pausadoEm: null },
      [ITEM],
      20,
    );
    const fila = await montarFilaDeProspeccao(db, { canalPronto: true, agora: AGORA });
    expect(fila.liberados).toHaveLength(0);
    expect(fila.motivoDaFilaVazia).toContain("20/20");
  });

  it("⛔⛔ MONTAR A FILA NÃO ESCREVE NADA — o defeito que quase queimou a lista", async () => {
    // A primeira versão criava o lead e tirava o item de PENDENTE enquanto
    // montava a lista. Efeito medido na revisão: cada abertura da tela consumia
    // um pedaço da base, inclusive dos BARRADOS, inclusive com o canal
    // desligado, sem falar com ninguém — e o teto nunca subia, porque nada
    // gravava `lastContactedAt`. Cinco recarregamentos queimavam cem contatos.
    //
    // Este é o teste que impede a volta disso.
    const { db, leadsCriados } = dbDeFila(
      { outboundLigado: true, limiteDiario: 20, pausadoEm: null },
      [ITEM],
    );

    await montarFilaDeProspeccao(db, { canalPronto: true, agora: AGORA });

    expect(leadsCriados).toHaveLength(0);
    expect(db.siteLead.create).not.toHaveBeenCalled();
    expect(db.itemDeProspeccao.update).not.toHaveBeenCalled();
  });

  it("⭐ o lead materializado NUNCA nasce com consentimento", async () => {
    // A mentira que este teste impede: gravar `consentAt` faria o sistema
    // afirmar, para sempre, que esta pessoa nos procurou. Ela não procurou.
    const leadsCriados: any[] = [];
    const db = {
      itemDeProspeccao: {
        findUnique: vi.fn().mockResolvedValue({
          ...ITEM,
          situacao: "PENDENTE",
          lote: { situacao: "LIBERADO" },
        }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      siteLead: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }: any) => {
          leadsCriados.push(data);
          return { id: "novo-lead" };
        }),
      },
    } as any;

    const r = await materializarLead(db, "i1");

    expect(r.materializado).toBe(true);
    expect(leadsCriados).toHaveLength(1);
    expect(leadsCriados[0].consentAt).toBeUndefined();
    expect(leadsCriados[0].fonte).toBe("LISTA_PROSPECCAO");
  });

  it("materializar duas vezes não cria dois leads", async () => {
    const db = {
      itemDeProspeccao: {
        findUnique: vi.fn().mockResolvedValue({
          ...ITEM,
          situacao: "VIROU_LEAD",
          leadId: "lead-ja-criado",
          lote: { situacao: "LIBERADO" },
        }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      siteLead: { findFirst: vi.fn(), create: vi.fn() },
    } as any;

    const r = await materializarLead(db, "i1");

    expect(r).toEqual({ materializado: true, leadId: "lead-ja-criado" });
    expect(db.siteLead.create).not.toHaveBeenCalled();
  });

  it("⭐ materializa mesmo com o lote PAUSADO — ordem do CEO, 11/09/2026: lote não impede envio", async () => {
    // Até 10/09/2026 esta trava recusava, e o teste esperava `materializado:
    // false` — ver o commit anterior. A operação por lotes foi removida:
    // `materializarLead` não lê mais `lote.situacao` (nem sequer busca o lote).
    const leadsCriados: any[] = [];
    const db = {
      itemDeProspeccao: {
        findUnique: vi.fn().mockResolvedValue({
          ...ITEM,
          situacao: "PENDENTE",
        }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      siteLead: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }: any) => {
          leadsCriados.push(data);
          return { id: "novo-lead" };
        }),
      },
    } as any;

    const r = await materializarLead(db, "i1");

    expect(r.materializado, JSON.stringify(r)).toBe(true);
    expect(leadsCriados).toHaveLength(1);
  });

  it("o barrado aparece na fila com motivo — não é filtrado para a tela ficar bonita", async () => {
    const { db } = dbDeFila(
      { outboundLigado: true, limiteDiario: 20, pausadoEm: null },
      [ITEM],
    );
    // Canal não pronto: o item deve aparecer BARRADO, não sumir.
    const fila = await montarFilaDeProspeccao(db, { canalPronto: false, agora: AGORA });
    expect(fila.liberados).toHaveLength(0);
    expect(fila.barrados).toHaveLength(1);
    expect(fila.barrados[0]!.decisao.reason).toBe("CANAL_INDISPONIVEL");
  });

  it("com tudo ligado e dentro das regras, o item é liberado", async () => {
    const { db } = dbDeFila(
      { outboundLigado: true, limiteDiario: 20, pausadoEm: null },
      [ITEM],
    );
    const fila = await montarFilaDeProspeccao(db, { canalPronto: true, agora: AGORA });
    expect(fila.liberados).toHaveLength(1);
    // `null` porque o contato ainda não é lead — e não virar lead só por
    // aparecer numa lista é exatamente o ponto.
    expect(fila.liberados[0]!.leadId).toBeNull();
  });

  it("⭐⭐ a consulta NÃO filtra mais por situação do lote — ordem do CEO, 11/09/2026", async () => {
    // "Duplo de banco que ignora o argumento não testa consulta — testa o
    // retorno que você mesmo escreveu" (doutrina de abordar.test.ts). Este
    // caso inspeciona o `where` de verdade em vez de só o resultado: a
    // situação do lote sumiu por completo, e não só na prática — no `where`.
    const { db } = dbDeFila(
      { outboundLigado: true, limiteDiario: 20, pausadoEm: null },
      [ITEM],
    );
    await montarFilaDeProspeccao(db, { canalPronto: true, agora: AGORA });

    const where = (db.itemDeProspeccao.findMany as any).mock.calls[0][0].where;
    expect(where).toEqual({ situacao: "PENDENTE" });
  });
});

/**
 * ⭐ A CONFERÊNCIA — correção cirúrgica pós-merge do PR #238.
 *
 * A prova de ponta a ponta (várias páginas, zero escrita contra banco real)
 * está em `scripts/jornada-conferencia-somente-leitura.test.ts`. Aqui, com
 * dublê, ficam as duas propriedades que diferenciam esta função de
 * `montarFilaDeProspeccao`: ela NÃO some com a pausa, e a meta de elegíveis
 * pode parar a varredura antes de esgotar os pendentes.
 */
describe("a conferência (auditoria somente leitura)", () => {
  it("⭐⭐ funciona com a prospecção PAUSADA — não é 'vazio como a fila'", async () => {
    // `montarFilaDeProspeccao` devolveria fila vazia aqui. A conferência existe
    // exatamente para responder "quantos elegíveis eu tenho?" nesse estado.
    const { db } = dbDeFila(
      { outboundLigado: true, limiteDiario: 20, pausadoEm: new Date(), motivo: "pausa" },
      [ITEM],
    );
    db.itemDeProspeccao.count = vi.fn().mockResolvedValue(1);

    const c = await conferirElegibilidadeReal(db, { canalPronto: true, agora: AGORA });

    expect(c.pendentes).toBe(1);
    expect(c.elegiveis).toBe(1);
    expect(c.varreuTudo).toBe(true);
  });

  it("⛔⛔ NÃO ESCREVE NADA — nenhuma chamada de escrita, em nenhuma tabela", async () => {
    const { db } = dbDeFila({ outboundLigado: false, limiteDiario: 20, pausadoEm: null }, [ITEM]);
    db.itemDeProspeccao.count = vi.fn().mockResolvedValue(1);

    await conferirElegibilidadeReal(db, { canalPronto: true, agora: AGORA });

    expect(db.itemDeProspeccao.update).not.toHaveBeenCalled();
    expect(db.siteLead.create).not.toHaveBeenCalled();
  });

  it("capacidadeReal = min(elegíveis, saldo diário, saldo da janela)", async () => {
    const { db } = dbDeFila(
      { outboundLigado: true, limiteDiario: 3, pausadoEm: null },
      [ITEM],
      1, // usadosHoje
      null,
      { nas24h: 0 },
    );
    db.itemDeProspeccao.count = vi.fn().mockResolvedValue(1);

    const c = await conferirElegibilidadeReal(db, { canalPronto: true, agora: AGORA });

    expect(c.elegiveis).toBe(1);
    expect(c.saldoDiario).toBe(2); // 3 - 1
    expect(c.saldoDaJanela).toBe(3); // 3 - 0
    expect(c.capacidadeReal).toBe(1); // min(1, 2, 3)
  });

  it("⭐ a meta pára a varredura cedo, e diz honestamente 'varreuTudo: false'", async () => {
    const itens = Array.from({ length: 5 }, (_, i) => ({ ...ITEM, id: `i${i}` }));
    const { db } = dbDeFila({ outboundLigado: true, limiteDiario: 2000, pausadoEm: null }, itens);
    db.itemDeProspeccao.count = vi.fn().mockResolvedValue(5);

    const c = await conferirElegibilidadeReal(db, {
      canalPronto: true,
      agora: AGORA,
      alvoDeElegiveis: 2,
    });

    expect(c.elegiveis).toBe(2);
    expect(c.itensAvaliados).toBe(2); // parou nos 2, não avaliou os outros 3
    expect(c.varreuTudo).toBe(false);
    expect(c.pendentes).toBe(5); // a contagem total continua exata
  });
});

describe("o descanso configurável", () => {
  it("o valor do banco manda sobre o padrão do desenho", () => {
    // O campo existia na tela e no banco e ninguém lia: o dono ajustava, salvava,
    // e o portão continuava usando 48h fixas.
    const doisDiasAtras = new Date(AGORA.getTime() - 50 * 3_600_000);

    // Com o padrão (48h), 50h de intervalo passa.
    expect(
      avaliarAbordagemDeProspeccao({ ...BASE, tentativas: 1, ultimoContatoEm: doisDiasAtras })
        .sendable,
    ).toBe(true);

    // Com 72h configuradas, a mesma situação é barrada.
    const d = avaliarAbordagemDeProspeccao({
      ...BASE,
      tentativas: 1,
      ultimoContatoEm: doisDiasAtras,
      descansoHoras: 72,
    });
    expect(d.sendable).toBe(false);
    expect(d.reason).toBe("DESCANSO_ATIVO");
  });

  it("zero é 'sem descanso', e não 'use o padrão'", () => {
    // A diferença entre `?? REGRA` e checar o tipo: com `??`, zero cairia no
    // padrão de 48h e o dono nunca conseguiria desligar o descanso.
    const d = avaliarAbordagemDeProspeccao({
      ...BASE,
      tentativas: 1,
      ultimoContatoEm: new Date(AGORA.getTime() - 60_000),
      descansoHoras: 0,
    });
    expect(d.sendable).toBe(true);
  });
});


describe("a corrida dos dois SDRs", () => {
  it("⭐⭐ quem perde a corrida NÃO cria um segundo lead — devolve o de quem ganhou", async () => {
    // Sem a reserva por comparar-e-trocar, dois cliques simultâneos passariam
    // os dois pela leitura de "está PENDENTE", nenhum encontraria lead, e os
    // dois criariam carteira para o mesmo telefone. `whatsappDigits` é índice e
    // não único: o banco não segura isso sozinho.
    const db = {
      itemDeProspeccao: {
        findUnique: vi
          .fn()
          // 1ª leitura: o item ainda parece disponível para os dois.
          .mockResolvedValueOnce({
            ...ITEM,
            situacao: "PENDENTE",
            lote: { situacao: "LIBERADO" },
          })
          // 2ª leitura, já depois de perder a reserva: quem ganhou gravou o lead.
          .mockResolvedValueOnce({ leadId: "lead-do-vencedor" }),
        // count 0 = outro processo reservou primeiro.
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn(),
      },
      siteLead: { findFirst: vi.fn(), create: vi.fn() },
    } as any;

    const r = await materializarLead(db, "i1");

    expect(r).toEqual({ materializado: true, leadId: "lead-do-vencedor" });
    expect(db.siteLead.create).not.toHaveBeenCalled();
  });

  it("⭐ falha ao criar o lead DEVOLVE o item para a fila", async () => {
    // Sem devolver, o contato sairia da fila para sempre sem nunca ter sido
    // abordado — some em silêncio, que é a pior forma de perder alguém da lista.
    const db = {
      itemDeProspeccao: {
        findUnique: vi.fn().mockResolvedValue({
          ...ITEM,
          situacao: "PENDENTE",
          lote: { situacao: "LIBERADO" },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn(),
      },
      siteLead: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(new Error("banco fora do ar")),
      },
    } as any;

    await expect(materializarLead(db, "i1")).rejects.toThrow("banco fora do ar");

    // A última chamada tem que ser a devolução para PENDENTE.
    const devolucao = db.itemDeProspeccao.updateMany.mock.calls.at(-1)![0];
    expect(devolucao.data.situacao).toBe("PENDENTE");
    expect(devolucao.where.leadId).toBeNull();
  });
});


describe("o telefone em formato legado", () => {
  it("⛔⛔ quem pediu SILÊNCIO é encontrado mesmo gravado no formato antigo", async () => {
    // O defeito, achado em revisão: a prospecção casava item↔lead por igualdade
    // exata de dígitos. Os leads antigos vieram de um backfill em SQL cru que
    // não tirava o zero da operadora — o mesmo telefone existe como
    // `5511987654321` e como `55011987654321`.
    //
    // Com igualdade, o lead com opt-out NÃO era encontrado: o item entrava como
    // novo, o portão recebia `optOutAt: null` com `historicoConhecido: true`, e
    // liberava a abordagem COM CONVICÇÃO. Trava que destrava.
    const leadLegado = {
      id: "lead-legado",
      optOutAt: new Date("2026-01-01"),
      lastContactedAt: null,
    };

    const { db } = dbDeFila(
      { outboundLigado: true, limiteDiario: 20, pausadoEm: null },
      [ITEM], // dígitos "5511987654321"
      0,
      leadLegado, // gravado como "55011987654321" — cauda igual
    );

    const fila = await montarFilaDeProspeccao(db, { canalPronto: true, agora: AGORA });

    expect(fila.liberados).toHaveLength(0);
    expect(fila.barrados[0]!.decisao.reason).toBe("LEAD_OPT_OUT");
  });

  it("a busca enumera as grafias do telefone, e o DDD entra em todas", async () => {
    const { db } = dbDeFila(
      { outboundLigado: true, limiteDiario: 20, pausadoEm: null },
      [ITEM],
    );
    await montarFilaDeProspeccao(db, { canalPronto: true, agora: AGORA });

    const where = db.siteLead.findFirst.mock.calls[0]![0].where;
    const grafias: string[] = where.whatsappDigits.in;

    // O formato legado é procurado…
    expect(grafias).toContain("55011987654321");
    // …e o canônico também.
    expect(grafias).toContain("5511987654321");
    // ⭐ E nenhuma grafia perde o DDD: um número de outro DDD com os mesmos oito
    // finais não pode casar. Foi o defeito que a jornada pegou contra Postgres.
    expect(grafias.every((g) => g.includes("11987654321") || g.includes("1187654321"))).toBe(true);
    expect(grafias).not.toContain("5521987654321");
  });
});

describe("o descanso configurável só aperta", () => {
  it("⛔ configurar descanso MENOR que o padrão não afrouxa a abordagem fria", async () => {
    // A única trava que poderia afrouxar nesta obra é a de insistência — e ela
    // vive no portão que fala com ESTRANHOS. Quem quiser insistir mais que o
    // desenho permite muda o desenho, não a configuração.
    const { db } = dbDeFila(
      { outboundLigado: true, limiteDiario: 20, pausadoEm: null, horasEntreAbordagens: 1 },
      [ITEM],
      0,
      { id: "lead1", optOutAt: null, lastContactedAt: new Date(AGORA.getTime() - 3 * 3_600_000) },
    );

    const fila = await montarFilaDeProspeccao(db, { canalPronto: true, agora: AGORA });

    expect(fila.liberados).toHaveLength(0);
    expect(fila.barrados[0]!.decisao.reason).toBe("DESCANSO_ATIVO");
  });
});

/**
 * ⭐⭐ A JANELA MÓVEL DE 24 HORAS DA META
 *
 * Evidência confirmada no Gerenciador do WhatsApp em 10/09/2026: o número da
 * Foocci pode iniciar **2.000 conversas numa janela contínua de 24 horas**.
 *
 * ── O DEFEITO QUE ESTES CASOS IMPEDEM ──────────────────────────────────────
 *
 * `contarAbordagensDeHoje` conta pelo DIA CIVIL de São Paulo. A Meta não. À
 * 00h01, o contador do dia zera e a fila ofereceria o teto inteiro — sobre um
 * saldo que a Meta já gastou nas horas anteriores.
 *
 * O excedente não vira um erro isolado: vira recusa em série, e recusa em série
 * é como a nota de qualidade do número cai. O número é o mesmo por onde a casa
 * atende quem já é cliente.
 */
describe("⭐⭐ o saldo é o da janela de 24h, não o do dia civil", () => {
  const LIGADA = { outboundLigado: true, limiteDiario: 2000, pausadoEm: null };

  it("⛔ à meia-noite o dia zera, e a fila NÃO oferece o teto inteiro", async () => {
    // O caso exato: `usadosHoje = 0` (o dia acabou de virar) e 1.900 conversas
    // pesando das últimas 24 horas. Sobram 100, não 2.000.
    const itens = Array.from({ length: 150 }, (_, i) => ({ ...ITEM, id: `i${i}` }));
    const { db } = dbDeFila(LIGADA, itens, 0, null, { nas24h: 1900 });

    const fila = await montarFilaDeProspeccao(db, { canalPronto: true, agora: AGORA });

    expect(fila.usadosHoje).toBe(0);
    expect(fila.usadosNaJanela).toBe(1900);
    expect(fila.saldoDaJanela).toBe(100);

    // A prova: a consulta pediu no máximo o saldo da janela, e não o teto.
    const pedidos = (db.itemDeProspeccao.findMany as any).mock.calls[0][0].take;
    expect(pedidos).toBeLessThanOrEqual(100);
  });

  it("⛔ janela esgotada fecha a fila, mesmo com o dia civil zerado", async () => {
    const { db } = dbDeFila(LIGADA, [ITEM], 0, null, { nas24h: 2000 });

    const fila = await montarFilaDeProspeccao(db, { canalPronto: true, agora: AGORA });

    expect(fila.liberados).toHaveLength(0);
    expect(fila.saldoDaJanela).toBe(0);
    // A frase precisa dizer JANELA, e não "teto do dia": quem lê às 00h05
    // precisa entender por que não pode mandar com o contador do dia em zero.
    expect(fila.motivoDaFilaVazia?.toLowerCase()).toContain("24h");
  });

  it("⭐ a sonda de controle: com a janela livre, os 2.000 estão disponíveis", async () => {
    // Sem este caso, os dois acima passariam numa implementação que
    // simplesmente nunca libera nada — e a operação ficaria parada com a tela
    // dizendo que está tudo bem.
    const itens = Array.from({ length: 3 }, (_, i) => ({ ...ITEM, id: `i${i}` }));
    const { db } = dbDeFila(LIGADA, itens, 0, null, { nas24h: 0 });

    const fila = await montarFilaDeProspeccao(db, { canalPronto: true, agora: AGORA });

    expect(fila.saldoDaJanela).toBe(2000);
    expect(fila.liberados.length).toBeGreaterThan(0);
  });

  it("⛔ NÃO existe mais teto por hora — decisão do CEO, 10/09/2026", async () => {
    // O teto de 200/hora foi removido: não foi autorizado e não foi
    // apresentado pela Meta (ver `freioDeRitmo.ts`, TETO_DURO_POR_DIA). O
    // contrato vigente é só a janela móvel de 24h da Meta (2.000) e o limite
    // diário configurado — mais as travas de segurança contra falha sistêmica
    // (concorrência, retentativa, resposta a rate limit), que são de OUTRA
    // natureza e não um teto comercial por hora. Uma rajada alta na última
    // hora, sozinha, não pode mais barrar a fila.
    const { db } = dbDeFila(LIGADA, [ITEM], 0, null, { nas24h: 10, naHora: 500 });

    const fila = await montarFilaDeProspeccao(db, { canalPronto: true, agora: AGORA });

    expect(fila.saldoDaJanela).toBe(1990); // 2000 - 10 da janela de 24h; a hora não conta
    expect(fila.liberados.length).toBeGreaterThan(0);
  });
});
