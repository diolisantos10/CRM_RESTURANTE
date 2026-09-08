/**
 * TESTE DE CLASSE dos MEDIDORES — não é o teste do cron de qualidade.
 *
 * A pergunta aqui não é "o cron de qualidade está vigiado?", e sim:
 * "É POSSÍVEL um medidor novo nascer invisível?"
 *
 * A doença de 08/2026 não foi a URL errada. Foi um cron morrer e ninguém saber
 * por dez dias. Um alarme que vigia só o cron que já morreu conserta o passado.
 * O que impede a repetição é a régua: todo workflow AGENDADO deste repositório
 * precisa estar declarado — ou vigiado, ou dispensado com motivo escrito. Quem
 * criar o próximo cron vai esbarrar neste arquivo antes de subir.
 *
 * Três dentes:
 *  1. varredura dos workflows: nenhum agendado fica de fora da declaração;
 *  2. o alarme falha FECHADO: rastro velho/ausente/ilegível acende, sempre;
 *  3. o alarme não pode depender do agendador que ele vigia.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  avaliarMedidores,
  MEDIDORES,
  type MedidorVigiado,
} from "./MeasurementFreshnessAlarm";

const WORKFLOWS_DIR = join(process.cwd(), ".github/workflows");

/**
 * Medidores COM VIGIA REAL: têm rastro com carimbo de tempo, legível de fora,
 * e estão em MEDIDORES.
 */
const VIGIADOS = new Set<string>([
  "quality-audit-cron.yml",
]);

/**
 * DECLARADOS SEM VIGIA — o inventário honesto, com motivo por linha.
 *
 * Estar nesta lista não é absolvição: é uma dívida escrita, com nome. O que ela
 * impede é o pior caso — um cron novo entrar sem ninguém decidir nada a respeito.
 *
 * O motivo é sempre o mesmo em substância: estes crons não deixam um rastro com
 * carimbo de tempo que dê para ler de fora, então hoje não há como medir o
 * frescor deles sem inventar número. O conserto de raiz (batimento universal:
 * cada rota /api/cron/* registrando o próprio último sucesso) pede migração de
 * schema e decisão do CEO — enquanto não existe, a lista fica à vista.
 */
const DECLARADOS_SEM_VIGIA: Record<string, string> = {
  "agent-library-process.yml": "fila de processamento; sem carimbo de última execução legível de fora",
  "agent-training-cron.yml": "esteira de treino; rastro por lote, sem carimbo de execução do cron",
  "brain-ingest-experiences.yml": "ingestão do cofre de experiências; sem carimbo de execução",
  "brain-shadow-replay.yml": "reprocessamento de sombra; grava amostras, não execução",
  "crm-cron.yml": "disparo de campanha; o rastro é por campanha, não por execução do cron",
  "crm-shadow-training.yml": "treino em sombra; grava amostras, não execução",
  "help-faq-mine.yml": "mineração de FAQ; sem carimbo de execução",
  "instagram-token-refresh.yml": "renovação de token; o efeito é a validade do token, não uma linha de execução",
  "kit-espelho.yml": "espelho de doutrina; roda no GitHub, não bate no produto",
  "manual-sync-nightly.yml": "sincronização de manual; roda no GitHub, não bate no produto",
  "meta-token-health.yml": "saúde de token Meta; sem carimbo de execução",
  // ⚠️ DISPENSADO COM DATA DE VALIDADE, e o motivo é honesto: uma rodada que
  // não abordou ninguém — fila vazia, que é o caso normal em dia sem lote
  // liberado — não deixa linha nenhuma no banco. Um medidor de frescor sobre
  // `LeadMensagem` acusaria "morreu" todo dia em que legitimamente não havia
  // quem abordar, e alarme que grita sem motivo é alarme que ninguém lê.
  //
  // O que vigia esta rodada hoje é o próprio job: ele REPROVA quando a rodada
  // para por falha, e o GitHub avisa. É vigia de fora, não do banco.
  //
  // Vira VIGIADO no dia em que a rodada carimbar a própria execução — e esse
  // carimbo é a dívida que fica registrada aqui, não escondida.
  "prospeccao-rodada.yml": "rodada de prospecção; sem carimbo de execução, e fila vazia não deixa rastro — vigiada pela reprovação do próprio job",
  "raiox-noturno.yml": "raio-x noturno; grava relatório, ainda sem leitura de frescor",
  "waiter-simulation-run.yml": "simulação do Garçom; grava corrida, ainda sem leitura de frescor",
  "waiter-training-real-conversations.yml": "intake de conversas reais; rastro por conversa",
  "whatsapp-live-learning-review.yml": "revisão de aprendizado; sem carimbo de execução",
  "whatsapp-master-simulator.yml": "simulador mestre; grava corrida, ainda sem leitura de frescor",
};

/** Workflows que rodam por agendamento (os que podem morrer em silêncio). */
function workflowsAgendados(): string[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .filter((f) => /^\s*schedule:/m.test(readFileSync(join(WORKFLOWS_DIR, f), "utf8")));
}

describe("dente 1 — nenhum medidor nasce invisível", () => {
  it("todo workflow AGENDADO está declarado: vigiado ou dispensado com motivo", () => {
    const declarados = new Set([...VIGIADOS, ...Object.keys(DECLARADOS_SEM_VIGIA)]);
    const orfaos = workflowsAgendados().filter((f) => !declarados.has(f));
    expect(
      orfaos,
      `Cron AGENDADO sem declaração: ${orfaos.join(", ")}.\n` +
        "Um cron que morre em silêncio deixa número velho na tela com cara de novo — foi o que\n" +
        "aconteceu por 10 dias em 08/2026. Declare o novo em VIGIADOS (com um medidor em\n" +
        "MEDIDORES lendo o RASTRO que ele deixa no banco) ou em DECLARADOS_SEM_VIGIA com o motivo.",
    ).toEqual([]);
  });

  it("todo medidor registrado aponta para um workflow que existe de verdade", () => {
    const existentes = new Set(readdirSync(WORKFLOWS_DIR));
    for (const m of MEDIDORES) {
      const arquivo = m.workflow.split("/").pop() ?? "";
      expect(existentes.has(arquivo), `${m.id} aponta para ${m.workflow}, que não existe`).toBe(true);
      expect(VIGIADOS.has(arquivo), `${arquivo} tem medidor mas não está em VIGIADOS`).toBe(true);
    }
  });

  it("o medidor que a escada obedece está vigiado (é o que derruba todo mundo se parar)", () => {
    expect(MEDIDORES.map((m) => m.id)).toContain("quality-audit");
  });
});

describe("dente 2 — o alarme falha FECHADO", () => {
  const medidor = (ultimaMedicao: MedidorVigiado["ultimaMedicao"]): MedidorVigiado[] => [
    { id: "teste", nome: "Medidor de teste", workflow: ".github/workflows/quality-audit-cron.yml", limiteHoras: 30, ultimaMedicao },
  ];
  const AGORA = new Date("2026-08-24T12:00:00.000Z");
  const hAtras = (h: number) => new Date(AGORA.getTime() - h * 3_600_000);

  const casos: [string, MedidorVigiado["ultimaMedicao"]][] = [
    ["nunca mediu (sem rastro)", async () => null],
    ["rastro vencido", async () => hAtras(31)],
    ["rastro muito vencido (o caso real: 248h)", async () => hAtras(248)],
    ["carimbo ilegível", async () => new Date("não-é-data")],
    ["banco fora do ar", async () => { throw new Error("connection refused"); }],
  ];

  it.each(casos)("%s ⇒ ALARME ACESO", async (_nome, leitura) => {
    const [e] = await avaliarMedidores({ now: AGORA, medidores: medidor(leitura) });
    expect(e.fresco).toBe(false);
    expect(e.motivo).toMatch(/PARADO|SEM RASTRO|ILEGÍVEL/);
  });

  it("rastro fresco ⇒ alarme apagado (senão o alarme seria decoração acesa)", async () => {
    const [e] = await avaliarMedidores({ now: AGORA, medidores: medidor(async () => hAtras(1)) });
    expect(e.fresco).toBe(true);
    expect(e.idadeHoras).toBe(1);
  });

  it("na fronteira ainda vale; um passo além, acende", async () => {
    const [dentro] = await avaliarMedidores({ now: AGORA, medidores: medidor(async () => hAtras(29.9)) });
    const [fora] = await avaliarMedidores({ now: AGORA, medidores: medidor(async () => hAtras(30.1)) });
    expect(dentro.fresco).toBe(true);
    expect(fora.fresco).toBe(false);
  });

  it("um medidor quebrado não esconde os outros", async () => {
    const estados = await avaliarMedidores({
      now: AGORA,
      medidores: [
        ...medidor(async () => { throw new Error("boom"); }),
        { id: "ok", nome: "outro", workflow: ".github/workflows/quality-audit-cron.yml", limiteHoras: 30, ultimaMedicao: async () => hAtras(1) },
      ],
    });
    expect(estados).toHaveLength(2);
    expect(estados[0].fresco).toBe(false);
    expect(estados[1].fresco).toBe(true);
  });
});

describe("dente 3 — o alarme não depende do agendador que vigia", () => {
  it("a régua de idade do alarme é a MESMA que derruba de degrau", async () => {
    // Duas réguas diferentes para o mesmo fato dariam painel verde com a escada
    // caindo. O medidor da qualidade tem que usar VERDICT_MAX_AGE_HOURS.
    const { VERDICT_MAX_AGE_HOURS } = await import("./LiveStageGuard");
    const quality = MEDIDORES.find((m) => m.id === "quality-audit");
    expect(quality?.limiteHoras).toBe(VERDICT_MAX_AGE_HOURS);
  });

  it("o alarme lê o RASTRO no banco, nunca pergunta ao GitHub Actions", () => {
    // Cron que morre não avisa que morreu: um vigia que consultasse o próprio
    // agendador morreria junto. O arquivo não pode falar com a API do agendador.
    const fonte = readFileSync(join(process.cwd(), "src/services/brain/runtime/MeasurementFreshnessAlarm.ts"), "utf8");
    expect(fonte).not.toMatch(/api\.github\.com|actions\/runs|workflow_dispatch|fetch\(/);
  });

  it("o alarme mora em caminho servido a pedido, não em horário marcado", () => {
    // /api/health é lido por gente e por máquina o tempo todo, sem agendador.
    const health = readFileSync(join(process.cwd(), "src/app/api/health/route.ts"), "utf8");
    expect(health).toContain("resumoDeFrescorParaHealth");
  });
});
