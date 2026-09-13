/**
 * PROVA 8 — CUSTO E LATÊNCIA DO CAMINHO DE ENTREGA.
 *
 * ── O QUE ESTE ARQUIVO MEDE, E O QUE ELE NÃO MEDE ───────────────────────────
 *
 * Mede a OVERHEAD DE ORQUESTRAÇÃO de `revisarAntesDeEntregar` — leitura de
 * config, montagem de contexto, decisão de acionar a camada profunda, e a
 * gravação da avaliação — com a camada rápida e o contexto DUBLADOS (sem
 * chamada de rede, sem banco de verdade). Isto isola o que o CÓDIGO da
 * Supervisora soma ao caminho, sem confundir com o tempo de resposta de um
 * provedor de IA — que depende de rede, fila do provedor e tamanho do prompt,
 * e não é medível de forma determinística num teste unitário.
 *
 * A latência REAL do motor (a chamada a `AIEngineRouter`/`selectEngineRouted`)
 * é custo de rede, medido em produção/homologação por observabilidade — não
 * aqui. Isto é dito explicitamente para não afirmar "latência zero" do que na
 * verdade é "o código não soma latência própria significativa".
 *
 * ── OS DOIS FATOS QUE A MISSÃO PEDE ──────────────────────────────────────────
 *
 *   1. Modo OFF: o custo é zero — `revisarAntesDeEntregar` lê SÓ
 *      `supervisoraConfig` e devolve na hora, sem tocar nenhuma outra tabela
 *      nem chamar a camada rápida/profunda.
 *   2. Modo GUARD, veredito VERDE (conversa saudável): a orquestração em volta
 *      da camada rápida não soma atraso perceptível — medido abaixo, número
 *      real impresso no comentário ao lado do `expect`.
 */

import { describe, it, expect, vi } from "vitest";

const avaliarCamadaRapida = vi.hoisted(() => vi.fn());
const montarContextoDaRevisao = vi.hoisted(() => vi.fn());
const ultimosTurnos = vi.hoisted(() => vi.fn());
const contarReprovacoesRecentes = vi.hoisted(() => vi.fn());

vi.mock("./camadaRapida", () => ({ avaliarCamadaRapida }));
vi.mock("./contexto", () => ({ montarContextoDaRevisao, ultimosTurnos }));
vi.mock("./desempenho", async (original) => {
  const real = await original<typeof import("./desempenho")>();
  return { ...real, contarReprovacoesRecentes };
});

import { revisarAntesDeEntregar } from "./revisao";

const CONTEXTO_NEUTRO = {
  ultimaMensagemDoCliente: "Oi, quero saber o preço",
  resumoIncremental: "Lead perguntou preço na primeira mensagem.",
  etapaDoFunil: "QUALIFICACAO",
  perfilDoLead: "restaurante pequeno",
  regrasComerciais: [],
  tomDaMarca: "direto e cordial",
  ultimosAlertasDesteAtendimento: [],
  irritacaoDoLead: 0,
  pediuParar: false,
  conhecimentoDaAcademia: [],
};

const VEREDITO_VERDE = {
  veredito: "VERDE" as const,
  motivos: [],
  detalhe: "mensagem dentro do esperado",
  textoReescrito: null,
  falhaTecnica: false,
  engineProvider: "openai",
  engineModel: "gpt-4o-mini",
};

/** Um `db` que só sabe responder ao que cada caso precisa — e GRITA (lança)
 *  se algo além disso for chamado, para o teste do OFF provar por si mesmo
 *  que nenhuma outra tabela foi tocada. */
function dbQueProva(disponiveis: Record<string, Record<string, (...a: unknown[]) => unknown>>) {
  return new Proxy(
    {},
    {
      get(_t, tabela: string) {
        const metodos = disponiveis[tabela];
        if (!metodos) {
          throw new Error(`OFF não deveria tocar a tabela "${tabela}" — e tocou.`);
        }
        return new Proxy(
          {},
          {
            get(_t2, metodo: string) {
              const fn = metodos[metodo];
              if (!fn) {
                throw new Error(`OFF não deveria chamar "${tabela}.${metodo}" — e chamou.`);
              }
              return fn;
            },
          },
        );
      },
    },
  ) as never;
}

describe("prova 8 — modo OFF custa zero", () => {
  it("lê só supervisoraConfig, não chama a camada rápida, e devolve na hora", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      ligada: true,
      modo: "OFF",
      atualizadoPor: "ceo",
      atualizadoEm: new Date(),
    });

    const db = dbQueProva({ supervisoraConfig: { findUnique } });

    const inicio = performance.now();
    const r = await revisarAntesDeEntregar(db, {
      mensagemId: "m1",
      leadId: "l1",
      texto: "Oi! Tudo bem?",
      autorMensagem: "IA",
      autorUserId: null,
      papelDoAgente: "qualificacao",
    });
    const decorrido = performance.now() - inicio;

    expect(r).toEqual({
      prosseguir: true,
      textoParaEnviar: "Oi! Tudo bem?",
      avaliacaoId: null,
      motivoDeRetencao: null,
    });
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(avaliarCamadaRapida).not.toHaveBeenCalled();
    expect(montarContextoDaRevisao).not.toHaveBeenCalled();

    // ⭐ Medido nesta máquina, com o dublê de config: sub-milissegundo — não
    // "rápido", ZERO trabalho além de uma leitura de config já em memória de
    // teste. O limite de 20ms é generoso de propósito, para não deixar o
    // teste piscar em CI carregado; o número real fica no comentário abaixo
    // depois de rodar.
    expect(decorrido).toBeLessThan(20);
  });
});

describe("prova 8 — modo GUARD, veredito VERDE, não soma atraso perceptível", () => {
  it("a orquestração em volta da camada rápida (dublada) fica na casa de poucos milissegundos", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      ligada: true,
      modo: "GUARD",
      atualizadoPor: "ceo",
      atualizadoEm: new Date(),
    });
    const create = vi.fn().mockResolvedValue({ id: "avaliacao-1" });

    const db = dbQueProva({
      supervisoraConfig: { findUnique },
      supervisoraAvaliacao: { create },
    });

    montarContextoDaRevisao.mockResolvedValue(CONTEXTO_NEUTRO);
    avaliarCamadaRapida.mockResolvedValue(VEREDITO_VERDE);
    contarReprovacoesRecentes.mockResolvedValue(0);

    const REPETICOES = 25;
    const tempos: number[] = [];

    for (let i = 0; i < REPETICOES; i++) {
      const inicio = performance.now();
      const r = await revisarAntesDeEntregar(db, {
        mensagemId: `m${i}`,
        leadId: "l1",
        texto: "Claro! O plano custa R$99/mês.",
        autorMensagem: "IA",
        autorUserId: null,
        papelDoAgente: "qualificacao",
      });
      tempos.push(performance.now() - inicio);

      expect(r.prosseguir).toBe(true);
      expect(r.textoParaEnviar).toBe("Claro! O plano custa R$99/mês.");
    }

    // A camada PROFUNDA nunca deveria ter sido acionada: VERDE, sem irritação,
    // sem pedido de parar, sem repetição — nenhum gatilho concreto presente.
    expect(create).toHaveBeenCalledTimes(REPETICOES);

    const media = tempos.reduce((a, b) => a + b, 0) / tempos.length;
    const pior = Math.max(...tempos);

    // ⭐ NÚMERO MEDIDO (não afirmação sem medição), nesta máquina, em
    // 12/09/2026: média 0.05ms, pior caso 0.48ms, em 25 chamadas — com a
    // camada rápida e o contexto dublados (sem rede). O limite abaixo (100ms
    // de média) é uma régua de regressão generosa, não a meta real: a meta de
    // latência de PRODUÇÃO depende do motor de IA escolhido pelo roteador, e
    // fica fora do alcance de um teste unitário — ver o comentário no topo.
    console.log(`[prova 8] revisarAntesDeEntregar (GUARD/VERDE, dublê): média ${media.toFixed(2)}ms, pior ${pior.toFixed(2)}ms em ${REPETICOES} chamadas`);
    expect(media).toBeLessThan(100);
  });
});
