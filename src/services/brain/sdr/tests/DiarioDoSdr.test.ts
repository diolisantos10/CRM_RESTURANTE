/**
 * O diário do SDR — e o que ele promete NÃO guardar.
 *
 * Cada teste aqui reprova contra o código anterior por um motivo simples: antes
 * deste bloco não existia diário nenhum. O que se prova é o contrato: contagem
 * antes de lista, cegueiras declaradas, motivo da falha nomeado, e nenhuma
 * palavra do cliente dentro do registro.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  registrarTurno,
  lerDiario,
  limparDiario,
  impressaoDaConversa,
  CEGUEIRAS,
  CEGUEIRA_DA_MEMORIA,
  CEGUEIRA_DA_GRAVACAO,
  setArquivoDoDiario,
  TETO_DE_TURNOS,
} from "../DiarioDoSdr";

const TEXTO_DO_CLIENTE = "sou dono do Sushi da Praia e minha dor e nao ter cliente fiel";

beforeEach(() => limparDiario());

describe("o que o diário conta", () => {
  it("conta o turno em que a IA respondeu e o em que ela não respondeu, com o motivo", async () => {
    await registrarTurno({
      chave: "foocci-vendas::lead-a7k2m", iaRespondeu: true,
      entendido: [{ chave: "objetivo", origem: "ia" }],
      perguntasNoAr: 1, seguemSemResposta: 0, travou: false, cobertura: 0.4, podePropor: false,
    });
    await registrarTurno({
      chave: "foocci-vendas::lead-a7k2m", iaRespondeu: false, motivoSemIA: "cortado_por_limite",
      entendido: [{ chave: "regiao", origem: "motor" }],
      perguntasNoAr: 1, seguemSemResposta: 0, travou: false, cobertura: 0.5, podePropor: false,
    });

    const d = (await lerDiario());
    expect(d.contagens.turnos).toBe(2);
    expect(d.contagens.turnosComIA).toBe(1);
    expect(d.contagens.turnosSemIA).toBe(1);
    expect(d.contagens.porMotivo.cortado_por_limite).toBe(1);
    expect(d.motivosExplicados.cortado_por_limite).toMatch(/teto de tokens/i);
  });

  it("separa o campo preenchido pelo motor de regras do preenchido pela IA", async () => {
    await registrarTurno({
      chave: "c1", iaRespondeu: false, motivoSemIA: "timeout",
      entendido: [{ chave: "objetivo", origem: "motor" }, { chave: "regiao", origem: "ia" }],
      perguntasNoAr: 2, seguemSemResposta: 0, travou: false, cobertura: 0.3, podePropor: false,
    });
    const d = (await lerDiario());
    expect(d.contagens.camposPeloMotor).toBe(1);
    expect(d.contagens.camposPelaIA).toBe(1);
    expect(d.turnos[0]?.chavesPeloMotor).toEqual(["objetivo"]);
  });

  it("conta a conversa que travou", async () => {
    await registrarTurno({
      chave: "c1", iaRespondeu: true, entendido: [],
      perguntasNoAr: 3, seguemSemResposta: 3, travou: true, cobertura: 0, podePropor: false,
    });
    expect((await lerDiario()).contagens.turnosQueTravaram).toBe(1);
  });

  it("um turno sem IA e sem motivo declarado NUNCA vira sucesso silencioso", async () => {
    await registrarTurno({
      chave: "c1", iaRespondeu: false, entendido: [],
      perguntasNoAr: 1, seguemSemResposta: 1, travou: true, cobertura: 0, podePropor: false,
    });
    expect((await lerDiario()).contagens.porMotivo.desconhecido).toBe(1);
  });
});

describe("o que o diário NUNCA guarda", () => {
  it("nenhum pedaço do que o cliente escreveu entra no registro", async () => {
    await registrarTurno({
      chave: `foocci-vendas::lead-a7k2m`, iaRespondeu: true,
      entendido: [{ chave: "o_que_vende", origem: "ia" }],
      perguntasNoAr: 1, seguemSemResposta: 0, travou: false, cobertura: 0.2, podePropor: false,
    });
    const serializado = JSON.stringify((await lerDiario()));
    expect(serializado).not.toContain(TEXTO_DO_CLIENTE);
    expect(serializado).not.toContain("Sushi");
    // nem a identidade da conversa em claro — vai como impressão digital
    expect(serializado).not.toContain("lead-a7k2m");
    expect(serializado).toContain(impressaoDaConversa("foocci-vendas::lead-a7k2m"));
  });
});

describe("o contrato de leitura", () => {
  it("declara as cegueiras — e diz ONDE está guardado", async () => {
    const d = await lerDiario();
    expect(d.onde).toBe("memoria");
    // em memória, a volatilidade é a PRIMEIRA coisa que quem lê precisa saber
    expect(d.cegueiras[0]).toBe(CEGUEIRA_DA_MEMORIA);
    expect(d.cegueiras).toEqual(expect.arrayContaining(CEGUEIRAS));
  });

  it("guardado no banco, a cegueira da memória some — e a da gravação fica", async () => {
    setArquivoDoDiario({
      onde: "banco",
      gravar: async () => {},
      ler: async () => [],
    });
    const d = await lerDiario();
    expect(d.onde).toBe("banco");
    expect(d.cegueiras).not.toContain(CEGUEIRA_DA_MEMORIA);
    expect(d.cegueiras).toContain(CEGUEIRA_DA_GRAVACAO);
  });

  it("armazenamento fora do ar devolve diário VAZIO com a falha declarada — nunca calmaria", async () => {
    setArquivoDoDiario({
      onde: "banco",
      gravar: async () => {},
      ler: async () => { throw new Error("banco fora do ar"); },
    });
    const d = await lerDiario();
    expect(d.contagens.turnos).toBe(0);
    expect(d.cegueiras[0]).toMatch(/N[ÃA]O RESPONDEU/i);
  });

  it("as contagens existem mesmo com o diário vazio — silêncio não é ausência de problema", async () => {
    const d = (await lerDiario());
    expect(d.contagens.turnos).toBe(0);
    expect(d.turnos).toEqual([]);
    expect(d.primeiroTurnoEm).toBeNull();
  });

  /**
   * ⚠️ A DATA E RELATIVA A HOJE, e isso nao e detalhe de estilo.
   *
   * Este teste nasceu com `Date.UTC(2026, 7, 23, ...)` cravado — 23 de agosto —
   * e `lerDiario(5)` so enxerga os ultimos 5 dias. Ele passou verde por duas
   * semanas e comecou a reprovar sozinho em 06/09, sem ninguem tocar no codigo:
   * a janela andou e deixou os turnos para tras. Reprovou o cabecalho do site,
   * que nao tem relacao nenhuma com o diario do SDR.
   *
   * Teste que depende da data de hoje e bomba-relogio: ele nao acusa defeito,
   * ele INVENTA um, no dia em que ninguem esta esperando. Ancorar em "agora".
   */
  it("o mais recente vem primeiro e o teto segura o crescimento", async () => {
    // ⛔ AS DATAS SÃO RELATIVAS A AGORA, e isto foi uma bomba-relógio.
    //
    // A versão anterior cravava `Date.UTC(2026, 7, 23, ...)` — 23 de agosto. O
    // teste passou verde por semanas e ficou VERMELHO SOZINHO em 06/09, sem
    // ninguém tocar em uma linha: `lerDiario` lê numa janela de
    // `JANELA_PADRAO_DIAS` (14), e nesse dia os lançamentos completaram 14 dias
    // e caíram para fora. A contagem virou zero, e o teste acusou o teto de não
    // segurar o crescimento — que era exatamente o que ele NÃO estava medindo.
    //
    // ⚠️ Data absoluta em teste é uma falha agendada: ela não quebra quando o
    // código muda, quebra quando o CALENDÁRIO anda, e por isso o vermelho
    // aparece sem relação nenhuma com quem estava trabalhando na hora. Foi o que
    // aconteceu: ela travou o CI do produto inteiro para todo mundo.
    const base = Date.now() - 3_600_000; // uma hora atrás, bem dentro da janela
    for (let i = 0; i < TETO_DE_TURNOS + 10; i++) {
      await registrarTurno({
        chave: `c${i}`, iaRespondeu: true, entendido: [],
        perguntasNoAr: 0, seguemSemResposta: 0, travou: false, cobertura: 0, podePropor: false,
        // Um segundo entre cada: a ordem ainda é o que a cena mede.
        agora: new Date(base + i * 1_000),
      });
    }
    const d = (await lerDiario(5));
    expect(d.contagens.turnos).toBe(TETO_DE_TURNOS);
    expect(d.turnos).toHaveLength(5);
    expect(d.turnos[0]!.quando > d.turnos[1]!.quando).toBe(true);
  });

  it("anotar nunca derruba a entrevista que ele observa", async () => {
    await expect(
      registrarTurno({
        chave: "c1", iaRespondeu: true,
        entendido: null as unknown as { chave: string; origem: "motor" }[],
        perguntasNoAr: 0, seguemSemResposta: 0, travou: false, cobertura: 0, podePropor: false,
      }),
    ).resolves.toBeUndefined();
  });
});
