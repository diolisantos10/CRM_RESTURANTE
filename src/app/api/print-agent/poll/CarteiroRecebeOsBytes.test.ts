/**
 * A ROTA do Carteiro devolve o ESC/POS com os bytes repostos.
 *
 * POR QUE ESTE ARQUIVO EXISTE, e ele nasceu de uma mutação que sobreviveu:
 * o teste da fila (`services/print/ByteNuloNaoDerrubaComanda.test.ts`) prova que
 * `escapeNulForPg` e `restoreNulFromPg` são inversos exatos. Ao apagar o
 * `restoreNulFromPg` DESTA rota, aquele teste continuou verde — porque provava a
 * função, não o CHAMADOR. Sem esta prova, a comanda seria gravada certa e
 * entregue à impressora com a sentinela no lugar do `0x00`: o corte de papel
 * viraria um caractere impresso, e ninguém veria isso num teste.
 *
 * O que ele mede é o corpo HTTP que o agente da loja recebe — o fim da linha do
 * lado do servidor.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const NUL = "\u0000";
const SENTINELA = "\uE000";
/** GS V 0x00 — corte total de papel. É o comando que fecha toda comanda. */
const CORTE = "\u001d\u0056\u0000";

const db = vi.hoisted(() => ({
  printAgent:   { update: vi.fn() },
  printStation: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const agente = vi.hoisted(() => ({ resolveByToken: vi.fn() }));
vi.mock("@/services/print/PrintAgentService", () => agente);

const fila = vi.hoisted(() => ({ emprestarJobs: vi.fn(), resgatarJobsVencidos: vi.fn() }));
vi.mock("@/services/print/PrintJobLease", () => fila);

import { POST } from "./route";

/** Uma comanda como ela está GRAVADA: com a sentinela no lugar do 0x00. */
const COMANDA_GRAVADA = `PEDIDO 77${SENTINELA}HOT ROLL${SENTINELA}\u001d\u0056${SENTINELA}`;

beforeEach(() => {
  vi.clearAllMocks();
  agente.resolveByToken.mockResolvedValue({ id: "ag_1", restaurantId: "rest_1", agentVersion: "1.0" });
  db.printAgent.update.mockResolvedValue({});
  db.printStation.findMany.mockResolvedValue([]);
  fila.resgatarJobsVencidos.mockResolvedValue(0);
  fila.emprestarJobs.mockResolvedValue([
    { id: "job_1", printerName: "Cz1", title: `Pedido 77${SENTINELA}`, body: COMANDA_GRAVADA },
  ]);
});

function pedir() {
  return POST(new Request("https://foocci.com.br/api/print-agent/poll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "tok", printers: ["Cz1"], version: "1.0" }),
  }) as never);
}

describe("o Carteiro recebe os bytes de verdade", () => {
  it("⭐ o corpo entregue tem 0x00 e NÃO tem a sentinela", async () => {
    const json = await (await pedir()).json();
    const job = json.jobs[0];

    expect(job.body.includes(NUL), "a rota entregou sem repor o 0x00").toBe(true);
    expect(job.body.includes(SENTINELA), "a sentinela vazou para a impressora").toBe(false);
    expect(job.title.includes(SENTINELA), "a sentinela vazou no título").toBe(false);
  });

  it("⭐ o comando de CORTAR PAPEL chega inteiro na impressora", async () => {
    const json = await (await pedir()).json();
    expect(json.jobs[0].body).toContain(CORTE);
  });

  it("o texto legível continua igual, e o tamanho não muda", async () => {
    const json = await (await pedir()).json();
    expect(json.jobs[0].body).toContain("HOT ROLL");
    expect(json.jobs[0].body.length).toBe(COMANDA_GRAVADA.length);
  });

  it("job sem sentinela atravessa intacto", async () => {
    fila.emprestarJobs.mockResolvedValue([
      { id: "job_2", printerName: "Cz1", title: "TESTE", body: "PAPEL DE TESTE" },
    ]);
    const json = await (await pedir()).json();
    expect(json.jobs[0].body).toBe("PAPEL DE TESTE");
  });
});
