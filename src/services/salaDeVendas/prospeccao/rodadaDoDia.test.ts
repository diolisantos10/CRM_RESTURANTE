/**
 * A RODADA DO DIA — o laço, e as três reações que ele precisa distinguir.
 *
 * ─── POR QUE ESTE LAÇO EXISTE ───────────────────────────────────────────────
 * Medido em 08/09/2026: `abordarItemDaFila` aborda UM item, a rota só sabia
 * acioná-lo um por chamada, e **não existe cron de prospecção** — nenhuma das
 * 17 pastas de `api/cron` é da Sala. Os "250 por dia" que o CEO pediu eram, na
 * prática, 250 acionamentos manuais.
 *
 * ─── O QUE ESTE ARQUIVO GUARDA, e é a única coisa difícil aqui ─────────────
 * A diferença entre **o portão funcionando** e **o caminho quebrado**.
 *
 *   · opt-out, lote não liberado → o portão fez o trabalho. **Pula e segue.**
 *     Parar aqui deixaria um silêncio no topo da lista bloqueando os outros 249.
 *   · teto/freio → não é defeito e não adianta tentar o próximo. **Encerra.**
 *   · a Meta recusou, o banco não gravou → **PARA**, e grita.
 *
 * A regra de parar na primeira falha é do Diretor Geral, com a razão dita:
 * *"não empurre 250 em cima de um defeito — é assim que se queima uma lista de
 * 4.000 num dia."*
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const selecao = vi.hoisted(() => ({
  montarFilaDeProspeccao: vi.fn(),
  materializarLead: vi.fn(),
}));
vi.mock("./selecao", () => selecao);

const abordar = vi.hoisted(() => ({ abordarLead: vi.fn() }));
vi.mock("../abordar", () => abordar);

const freio = vi.hoisted(() => ({ conferirRitmo: vi.fn() }));
vi.mock("../freioDeRitmo", () => freio);

import { abordarARodadaDoDia } from "./abordarDaFila";

/**
 * ⚠️ `liberadoPorUserId`, e NÃO `liberadoPor`.
 *
 * A versão anterior deste duplo devolvia `liberadoPor: "quem_liberou"`, e o caso
 * abaixo afirmava que `autorUserId` saía daí. **O teste codificava o defeito**:
 * em produção `liberadoPor` guarda o rótulo de tela `Nome (userId)`, e entregá-lo
 * a uma coluna com chave estrangeira derrubou a primeira rodada real com
 * `Foreign key constraint violated` — HTTP 500, os dez contatos perdidos.
 *
 * `user.findMany` existe aqui porque o id agora é CONFERIDO antes de valer.
 */
const db = {
  loteDeProspeccao: {
    findMany: vi.fn(async () => [{ id: "lote1", liberadoPorUserId: "u_liberou" }]),
  },
  /** ⚠️ `internalUser`: a chave estrangeira de `autorUserId` aponta para
   *  `internal_users`, não para `users`. Conferir contra a tabela errada não
   *  casava nada — foi o defeito de 08/09/2026, medido em produção. */
  internalUser: { findMany: vi.fn(async () => [{ id: "u_liberou" }]) },
} as never;

const banco = db as unknown as {
  loteDeProspeccao: { findMany: ReturnType<typeof vi.fn> };
  internalUser: { findMany: ReturnType<typeof vi.fn> };
};

function fila(quantos: number) {
  return {
    liberados: Array.from({ length: quantos }, (_, i) => ({
      itemId: `i${i + 1}`,
      loteId: "lote1",
      leadId: null,
      nome: `Restaurante ${i + 1}`,
      whatsapp: `1199999000${i}`,
      decisao: { sendable: true },
    })),
    barrados: [],
    motivoDaFilaVazia: null,
    usadosHoje: 0,
    tetoDoDia: 250,
  };
}

/**
 * O pré-voo APROVANDO — o padrão destes casos, que são sobre o laço.
 *
 * ⚠️ Ele é explícito em toda chamada, e não um default da função, porque o tipo
 * exige: chamador novo não compila sem dizer qual é o pré-voo dele. Aqui isso
 * custa uma linha por caso; em produção evita a rodada nascer sem conferência.
 */
const preVooOk = async () => ({
  pronto: true as const,
  modelo: { nome: "abordagem_foocci", idioma: "pt_BR", status: "APPROVED", variaveis: 1 },
  parametrosQueMandamos: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` zera as implementações do duplo de banco; sem restaurá-las,
  // todo caso a partir do segundo veria lote e usuário inexistentes.
  banco.loteDeProspeccao.findMany.mockResolvedValue([{ id: "lote1", liberadoPorUserId: "u_liberou" }]);
  banco.internalUser.findMany.mockResolvedValue([{ id: "u_liberou" }]);
  freio.conferirRitmo.mockResolvedValue({ pode: true });
  selecao.materializarLead.mockImplementation(async (_db: unknown, itemId: string) => ({
    materializado: true,
    leadId: `lead_${itemId}`,
  }));
  abordar.abordarLead.mockResolvedValue({ abordou: true, mensagemId: "m1" });
});

describe("o caminho feliz", () => {
  it("⭐ aborda a fila inteira e termina por 'filaAcabou'", async () => {
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(3));

    const r = await abordarARodadaDoDia(db, { autor: "HUMANO", autorUserId: "u1", canalPronto: true, preVoo: preVooOk });

    expect(r.abordados).toBe(3);
    expect(r.pulados).toBe(0);
    expect(r.parouPor).toBe("filaAcabou");
    expect(r.falha).toBeNull();
    expect(r.extrato.map((e) => e.itemId)).toEqual(["i1", "i2", "i3"]);
  });

  it("⭐ o FREIO é relido a cada item — a objeção do comentário da rota", async () => {
    // A rota argumentava contra aceitar lista: "faria o freio valer para o lote
    // inteiro a partir de uma leitura só". A objeção está certa, e a rodada não
    // a viola — é isto que este caso tranca.
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(4));

    await abordarARodadaDoDia(db, { autor: "HUMANO", autorUserId: "u1", canalPronto: true, preVoo: preVooOk });

    expect(freio.conferirRitmo, "o freio foi lido uma vez para o lote inteiro").toHaveBeenCalledTimes(4);
  });
});

describe("⭐ o portão funcionando NÃO para a rodada", () => {
  it("quem pediu silêncio é pulado, e os outros são abordados", async () => {
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(3));
    abordar.abordarLead
      .mockResolvedValueOnce({ abordou: false, motivo: "portaoRecusou", detalhe: "pediu silêncio" })
      .mockResolvedValue({ abordou: true, mensagemId: "m" });

    const r = await abordarARodadaDoDia(db, { autor: "HUMANO", autorUserId: "u1", canalPronto: true, preVoo: preVooOk });

    expect(r.abordados, "um opt-out no topo travou a lista inteira").toBe(2);
    expect(r.pulados).toBe(1);
    expect(r.parouPor).toBe("filaAcabou");
    // ⭐ O `detalhe` viaja junto: `motivo` é a CLASSE, e o portão do lead tem sete
    // regras dentro dela. Sem isto, o log diz "portaoRecusou" e não diz o quê.
    expect(r.extrato[0]).toEqual({
      itemId: "i1", ok: false, motivo: "portaoRecusou", detalhe: "pediu silêncio",
    });
  });

  it("item que não virou lead é pulado, não é falha", async () => {
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(2));
    selecao.materializarLead.mockResolvedValueOnce({ materializado: false, motivo: "Item em situação DUPLICADO." });

    const r = await abordarARodadaDoDia(db, { autor: "HUMANO", autorUserId: "u1", canalPronto: true, preVoo: preVooOk });

    expect(r.pulados).toBe(1);
    expect(r.abordados).toBe(1);
    expect(r.parouPor).toBe("filaAcabou");
  });
});

describe("⛔ o caminho quebrado PARA na primeira falha", () => {
  /**
   * ⚠️ ESTE CASO MUDOU DE REGRA EM 08/09, POR ORDEM — não por conveniência.
   *
   * Ele dizia: *"a Meta recusou: para, e os seguintes NÃO são tentados"*, e
   * estava certo enquanto se supunha que recusa da Meta significava caminho
   * quebrado. O Diretor Geral corrigiu a suposição: o caso mais provável é uma
   * LINHA RUIM DA LISTA (contato sem nome, modelo com `{{1}}`), e aí *"um
   * contato pulado custa um contato; uma rodada travada custa o dia"*.
   *
   * A intenção original — **não empurrar 250 em cima de um defeito** — continua
   * de pé, e é o caso logo abaixo: três recusas seguidas param. O que mudou foi
   * onde fica a fronteira entre exceção e padrão, não a proteção.
   */
  it("⭐ a Meta recusando uma vez NÃO para mais — pula e segue", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(5));
    abordar.abordarLead
      .mockResolvedValueOnce({ abordou: true, mensagemId: "m1" })
      .mockResolvedValueOnce({ abordou: false, motivo: "aMetaRecusou", detalhe: "template not found" })
      .mockResolvedValue({ abordou: true, mensagemId: "mX" });

    const r = await abordarARodadaDoDia(db, { autor: "HUMANO", autorUserId: "u1", canalPronto: true, preVoo: preVooOk });

    expect(r.parouPor).toBe("filaAcabou");
    expect(r.abordados, "uma linha ruim custou os outros quatro contatos").toBe(4);
    expect(r.pulados).toBe(1);
    expect(abordar.abordarLead).toHaveBeenCalledTimes(5);
    erro.mockRestore();
  });

  it("banco que não grava também para a rodada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(3));
    abordar.abordarLead.mockResolvedValue({ abordou: false, motivo: "naoConseguiuGravar", detalhe: "db" });

    const r = await abordarARodadaDoDia(db, { autor: "HUMANO", autorUserId: "u1", canalPronto: true, preVoo: preVooOk });

    expect(r.parouPor).toBe("falha");
    expect(abordar.abordarLead).toHaveBeenCalledTimes(1);
  });
});

describe("o freio encerra sem ser falha", () => {
  it("⭐ teto do dia atingido: encerra como fim normal, e não como defeito", async () => {
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(4));
    freio.conferirRitmo
      .mockResolvedValueOnce({ pode: true })
      .mockResolvedValue({ pode: false, detalhe: "teto do dia" });

    const r = await abordarARodadaDoDia(db, { autor: "HUMANO", autorUserId: "u1", canalPronto: true, preVoo: preVooOk });

    expect(r.parouPor, "o teto do dia foi tratado como defeito").toBe("freio");
    expect(r.falha).toBeNull();
    expect(r.abordados).toBe(1);
  });
});

describe("o teto da rodada", () => {
  it("⭐ manda no máximo o que foi pedido, mesmo com fila maior", async () => {
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(10));

    const r = await abordarARodadaDoDia(db, { autor: "HUMANO", autorUserId: "u1", canalPronto: true, preVoo: preVooOk, teto: 3 });

    expect(r.abordados).toBe(3);
    expect(r.parouPor).toBe("tetoDaRodada");
    expect(abordar.abordarLead).toHaveBeenCalledTimes(3);
  });

  it("o teto também é passado para a fila, e não só conferido depois", async () => {
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(2));
    await abordarARodadaDoDia(db, { autor: "HUMANO", autorUserId: "u1", canalPronto: true, preVoo: preVooOk, teto: 10 });
    expect(selecao.montarFilaDeProspeccao.mock.calls[0][1]).toMatchObject({ limite: 10 });
  });
});

describe("fila vazia", () => {
  it("não é falha, não grita, e diz que a fila acabou", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(0));

    const r = await abordarARodadaDoDia(db, { autor: "HUMANO", autorUserId: "u1", canalPronto: true, preVoo: preVooOk });

    expect(r).toMatchObject({ abordados: 0, pulados: 0, parouPor: "filaAcabou", falha: null });
    expect(erro).not.toHaveBeenCalled();
    erro.mockRestore();
  });
});


describe("⭐ a rodada AUTOMÁTICA — e ela não é anônima", () => {
  /**
   * `abordarLead` promete, no cabeçalho dele, que *"toda mensagem que sai em
   * nome da empresa tem um responsável, e 'o sistema mandou' não é resposta
   * para o dia em que alguém perguntar quem falou com aquela pessoa"*.
   *
   * A rodada das 9h não quebra essa promessa: o responsável de cada item é
   * **quem liberou o lote dele** — uma pessoa, com nome, que autorizou a casa a
   * falar com aquela lista. É isto que estes dois casos trancam.
   */
  it("⭐ o responsável de cada item é quem LIBEROU o lote", async () => {
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(2));

    await abordarARodadaDoDia(db, { autor: "SISTEMA", canalPronto: true, preVoo: preVooOk });

    expect(abordar.abordarLead).toHaveBeenCalledTimes(2);
    for (const chamada of abordar.abordarLead.mock.calls) {
      expect(chamada[1]).toMatchObject({ autor: "SISTEMA", autorUserId: "u_liberou" });
    }
  });

  it("⭐ lote SEM quem liberou não é abordado — ninguém autorizou", async () => {
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(2));
    banco.loteDeProspeccao.findMany.mockResolvedValue([{ id: "lote1", liberadoPorUserId: null }]);

    const r = await abordarARodadaDoDia(db, { autor: "SISTEMA", canalPronto: true, preVoo: preVooOk });

    expect(r.abordados, "mandou mensagem sem ninguém responder por ela").toBe(0);
    expect(r.pulados).toBe(2);
    expect(r.extrato[0]).toMatchObject({ motivo: "semResponsavel" });
    expect(abordar.abordarLead).not.toHaveBeenCalled();
  });

  it("a rodada humana continua usando quem clicou, e não o lote", async () => {
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(1));

    await abordarARodadaDoDia(db, { autor: "HUMANO", autorUserId: "u1", canalPronto: true, preVoo: preVooOk });

    expect(abordar.abordarLead.mock.calls[0][1]).toMatchObject({ autor: "HUMANO", autorUserId: "u1" });
  });
});

describe("⭐ a Meta recusando não mata mais a rodada no primeiro", () => {
  /**
   * Ordem do Diretor Geral, 08/09: *"se o parâmetro faltar, pule o contato e
   * siga em vez de parar a rodada inteira. Um contato pulado custa um contato;
   * uma rodada travada custa o dia."*
   *
   * O caso concreto: o modelo tem `{{1}}`, o contato veio da lista sem nome, o
   * código manda zero parâmetros, a Meta recusa. Com a regra antiga, **o
   * primeiro contato sem nome derrubava os outros 249**.
   *
   * E o outro extremo é pior: token vencido faz a Meta recusar TODOS, e "pula
   * sempre" gastaria a lista inteira contra a mesma parede, em silêncio.
   */
  it("⭐ uma recusa isolada é pulada, e a rodada segue até o fim", async () => {
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(4));
    abordar.abordarLead
      .mockResolvedValueOnce({ abordou: false, motivo: "aMetaRecusou", detalhe: "sem parâmetro" })
      .mockResolvedValue({ abordou: true, mensagemId: "m" });

    const r = await abordarARodadaDoDia(db, { autor: "HUMANO", autorUserId: "u1", canalPronto: true, preVoo: preVooOk });

    expect(r.parouPor, "um contato ruim derrubou a rodada inteira").toBe("filaAcabou");
    expect(r.abordados).toBe(3);
    expect(r.pulados).toBe(1);
    expect(abordar.abordarLead).toHaveBeenCalledTimes(4);
  });

  it("⭐ TRÊS recusas seguidas param a rodada — vira padrão, não exceção", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(10));
    abordar.abordarLead.mockResolvedValue({ abordou: false, motivo: "aMetaRecusou", detalhe: "token" });

    const r = await abordarARodadaDoDia(db, { autor: "HUMANO", autorUserId: "u1", canalPronto: true, preVoo: preVooOk });

    expect(r.parouPor).toBe("falha");
    expect(r.pulados).toBe(3);
    expect(abordar.abordarLead, "gastou a lista batendo na mesma parede").toHaveBeenCalledTimes(3);

    const grito = erro.mock.calls.find((c) => String(c[0]).includes("recusou seguidas"));
    expect(grito, "parou calada").toBeTruthy();
    erro.mockRestore();
  });

  it("⭐ o contador zera a cada sucesso — o que importa é a SEQUÊNCIA", async () => {
    // Lista com contatos ruins ESPALHADOS tem de rodar inteira. Sem o zeramento,
    // a terceira recusa da lista mataria a rodada mesmo com envios no meio.
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(6));
    const recusa = { abordou: false, motivo: "aMetaRecusou", detalhe: "sem nome" };
    const ok = { abordou: true, mensagemId: "m" };
    abordar.abordarLead
      .mockResolvedValueOnce(recusa).mockResolvedValueOnce(ok)
      .mockResolvedValueOnce(recusa).mockResolvedValueOnce(ok)
      .mockResolvedValueOnce(recusa).mockResolvedValueOnce(ok);

    const r = await abordarARodadaDoDia(db, { autor: "HUMANO", autorUserId: "u1", canalPronto: true, preVoo: preVooOk });

    expect(r.parouPor).toBe("filaAcabou");
    expect(r.abordados).toBe(3);
    expect(r.pulados).toBe(3);
  });

  it("⭐ A METADE QUE NÃO MUDA: banco que não grava continua parando na PRIMEIRA", async () => {
    // Recusa da Meta é uma linha ruim da lista; banco que não grava é a máquina.
    // Tratar os dois igual seria perder a proteção que motivou a regra.
    vi.spyOn(console, "error").mockImplementation(() => {});
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(5));
    abordar.abordarLead.mockResolvedValue({ abordou: false, motivo: "naoConseguiuGravar", detalhe: "db" });

    const r = await abordarARodadaDoDia(db, { autor: "HUMANO", autorUserId: "u1", canalPronto: true, preVoo: preVooOk });

    expect(r.parouPor).toBe("falha");
    expect(abordar.abordarLead).toHaveBeenCalledTimes(1);
  });
});

/**
 * ⭐ O PRÉ-VOO — a conferência do modelo antes do primeiro contato.
 *
 * O que estes casos guardam é UM princípio, e não uma lista de causas:
 * **aborta quando 100% dos envios falhariam; segue quando a perda é parcial ou
 * desconhecida.** Se alguém trocar a regra por outra, é aqui que quebra.
 *
 * O que o cliente "lê" continua sendo receber ou não receber — por isso todo
 * caso mede quantas chamadas de envio de fato aconteceram, e não o veredito.
 */
describe("a rodada confere o modelo antes de gastar o primeiro contato", () => {
  const reprova = (causa: string, detalhe = "d") =>
    async () => ({ pronto: false as const, causa: causa as never, detalhe });

  beforeEach(() => {
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(5));
    abordar.abordarLead.mockResolvedValue({ abordou: true, mensagemId: "m" });
  });

  it("⭐ modelo esperando 2 variáveis: NINGUÉM é abordado — nem os três do limite", async () => {
    // Sem o pré-voo, o #216 descobriria isto queimando três nomes da lista.
    // Este é o caso que justifica a peça inteira existir.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await abordarARodadaDoDia(db, {
      autor: "HUMANO", autorUserId: "u1", canalPronto: true,
      preVoo: reprova("variaveisNaoBatem", "o modelo espera 2 variáveis e o envio manda 1"),
    });

    expect(r.parouPor).toBe("preVoo");
    expect(r.abordados).toBe(0);
    expect(abordar.abordarLead, "gastou contato para aprender o que a consulta já dizia")
      .not.toHaveBeenCalled();
  });

  it.each(["semNomeConfigurado", "semToken", "naoAchado", "naoAprovado", "variaveisNaoBatem"])(
    "aborta em %s — porque nenhuma mensagem sairia",
    async (causa) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const r = await abordarARodadaDoDia(db, {
        autor: "HUMANO", autorUserId: "u1", canalPronto: true, preVoo: reprova(causa),
      });

      expect(r.parouPor).toBe("preVoo");
      expect(abordar.abordarLead).not.toHaveBeenCalled();
    },
  );

  it("⭐ a Graph não respondeu: a rodada SEGUE — não sei não é o mesmo que está errado", async () => {
    // Guardrail 5: aterrar o dia por uma LEITURA que caiu seria a proteção mais
    // destrutiva que o problema. Se o envio também estiver quebrado, o #216 para
    // em três — a lista continua protegida por baixo.
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await abordarARodadaDoDia(db, {
      autor: "HUMANO", autorUserId: "u1", canalPronto: true,
      preVoo: reprova("metaRecusou", "HTTP_500"),
    });

    expect(r.parouPor).toBe("filaAcabou");
    expect(r.abordados).toBe(5);
    expect(
      aviso.mock.calls.find((c) => String(c[0]).includes("SEM conferir o modelo")),
      "rodou sem conferência e não disse a ninguém",
    ).toBeTruthy();
    aviso.mockRestore();
  });

  it("o motivo do aborto sobe inteiro, e o itemId é null porque não houve item", async () => {
    // Quem investiga precisa da causa e do detalhe. `itemId` inventado mandaria
    // procurar um culpado que não existe.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await abordarARodadaDoDia(db, {
      autor: "HUMANO", autorUserId: "u1", canalPronto: true,
      preVoo: reprova("naoAprovado", '"abordagem_foocci" está REJECTED na Meta'),
    });

    expect(r.falha).toEqual({
      itemId: null,
      motivo: "naoAprovado",
      detalhe: '"abordagem_foocci" está REJECTED na Meta',
    });
  });

  it("a fila nem é montada quando o pré-voo reprova — a rodada não começa", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await abordarARodadaDoDia(db, {
      autor: "HUMANO", autorUserId: "u1", canalPronto: true, preVoo: reprova("naoAchado"),
    });

    expect(selecao.montarFilaDeProspeccao).not.toHaveBeenCalled();
  });
});

/**
 * ⭐ O ID ÓRFÃO — o degrau que o defeito de 08/09/2026 deixou visível.
 *
 * Trocar `liberadoPor` por `liberadoPorUserId` conserta o formato do dado. Não
 * conserta a pergunta seguinte: **e se o id existir na coluna e não existir em
 * `users`?** Usuário removido, ou preenchimento retroativo que não casou. Sem a
 * conferência, a rodada voltaria a estourar chave estrangeira na gravação — o
 * mesmo 500, um degrau adiante.
 */
describe("o responsável é conferido, não presumido", () => {
  it("⭐ id que não existe em `users` NÃO é abordado — vira item pulado, não rodada morta", async () => {
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(2));
    banco.loteDeProspeccao.findMany.mockResolvedValue([
      { id: "lote1", liberadoPorUserId: "u_que_foi_removido" },
    ]);
    banco.internalUser.findMany.mockResolvedValue([]); // ninguém com esse id

    const r = await abordarARodadaDoDia(db, { autor: "SISTEMA", canalPronto: true, preVoo: preVooOk });

    expect(abordar.abordarLead, "gravaria com um autor que o banco não reconhece")
      .not.toHaveBeenCalled();
    expect(r.parouPor, "a rodada morreu em vez de pular").toBe("filaAcabou");
    expect(r.pulados).toBe(2);
    expect(r.extrato[0]!.motivo).toBe("semResponsavel");
  });

  it("não pergunta por usuário nenhum quando não há lote com responsável", async () => {
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(1));
    banco.loteDeProspeccao.findMany.mockResolvedValue([{ id: "lote1", liberadoPorUserId: null }]);

    await abordarARodadaDoDia(db, { autor: "SISTEMA", canalPronto: true, preVoo: preVooOk });

    expect(banco.internalUser.findMany, "consulta inútil por uma lista vazia").not.toHaveBeenCalled();
  });

  it("HUMANO não passa por essa conferência — o id vem da sessão dele", async () => {
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(1));

    await abordarARodadaDoDia(db, {
      autor: "HUMANO", autorUserId: "u1", canalPronto: true, preVoo: preVooOk,
    });

    expect(abordar.abordarLead).toHaveBeenCalledTimes(1);
    expect(banco.loteDeProspeccao.findMany).not.toHaveBeenCalled();
  });
});

/**
 * ⭐ O DIAGNÓSTICO DO LOTE SEM RESPONSÁVEL — guardrail 6, terceira vez no dia.
 *
 * `semResponsavel: 10` é verdadeiro e não investiga nada: as duas causas
 * possíveis pedem consertos opostos, e sem o rótulo cru no log a investigação
 * exige acesso ao banco de produção — que quem lê o log não tem.
 */
describe("o lote sem responsável diz POR QUE", () => {
  it("⭐ grita com o rótulo cru quando o id não foi preenchido", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(1));
    banco.loteDeProspeccao.findMany.mockResolvedValue([
      { id: "lote1", liberadoPorUserId: null, liberadoPor: "Fulano de Tal" },
    ]);

    await abordarARodadaDoDia(db, { autor: "SISTEMA", canalPronto: true, preVoo: preVooOk });

    const grito = erro.mock.calls.find((c) => String(c[0]).includes("sem responsável"));
    expect(grito, "pulou dez contatos em silêncio").toBeTruthy();
    expect((grito as unknown[])[1]).toMatchObject({
      loteId: "lote1",
      liberadoPorUserId: null,
      idExisteEmUsers: false,
      rotuloLiberadoPor: "Fulano de Tal",
    });
    erro.mockRestore();
  });

  it("distingue id ausente de id órfão — as duas causas pedem consertos opostos", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(1));
    banco.loteDeProspeccao.findMany.mockResolvedValue([
      { id: "lote1", liberadoPorUserId: "u_removido", liberadoPor: "Fulano (u_removido)" },
    ]);
    banco.internalUser.findMany.mockResolvedValue([]);

    await abordarARodadaDoDia(db, { autor: "SISTEMA", canalPronto: true, preVoo: preVooOk });

    const grito = erro.mock.calls.find((c) => String(c[0]).includes("sem responsável"));
    expect((grito as unknown[])[1]).toMatchObject({
      liberadoPorUserId: "u_removido",
      idExisteEmUsers: false,
    });
    erro.mockRestore();
  });

  it("lote com responsável válido não grita", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    selecao.montarFilaDeProspeccao.mockResolvedValue(fila(1));

    await abordarARodadaDoDia(db, { autor: "SISTEMA", canalPronto: true, preVoo: preVooOk });

    expect(erro.mock.calls.find((c) => String(c[0]).includes("sem responsável"))).toBeFalsy();
    erro.mockRestore();
  });
});
