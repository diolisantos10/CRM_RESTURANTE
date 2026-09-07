/**
 * A SEGUNDA CHAVE: a máquina não fala sozinha com o cliente.
 *
 * ── O DEFEITO, DE 07/09/2026 ────────────────────────────────────────────────
 *
 * `FOOCCI_SDR_SEND_ENABLED` era uma chave só para duas portas muito diferentes:
 * o vendedor mandando o que acabou de digitar, e a IA respondendo sozinha ao
 * WhatsApp que acabou de chegar. O CEO autorizou a primeira depois de eu
 * descrever só a primeira — e a chave entregava as duas.
 *
 * A correção não é lembrar disso na próxima vez. É a máquina não conseguir.
 *
 * ── O QUE ESTES TESTES PROTEGEM ─────────────────────────────────────────────
 *
 *   1. Com o envio ligado e a IA desligada, a saída de MÁQUINA não sai.
 *   2. No mesmo estado, a saída de PESSOA sai — senão a trava teria quebrado a
 *      única coisa que o dono autorizou.
 *   3. A recusa acontece ANTES de qualquer leitura de banco: mensagem que não
 *      pode sair não vira consulta, e muito menos chamada à Meta.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const enviado: Array<{ telefone: string; texto: string }> = [];

vi.mock("@/services/foocci-sdr/FoocciSalesChannel", async (importOriginal) => {
  const real = await importOriginal<
    typeof import("@/services/foocci-sdr/FoocciSalesChannel")
  >();
  return {
    ...real,
    // O canal fica "pronto" sem chaves da Meta: o que está sob teste é a trava
    // de quem manda, e não a configuração.
    canalDeVendasPronto: () => true,
    describeFoocciSalesChannel: () => ({ configurado: true }),
    enviarTextoDeVendas: async (_d: unknown, telefone: string, texto: string) => {
      enviado.push({ telefone, texto });
      return { ok: true as const };
    },
  };
});

const { entregarMensagem } = await import("./entrega");
// Vindas do módulo REAL (o mock preserva tudo que não fixou), para a regra pura
// ser medida como ela é em produção, e não como o mock a imagina.
const { maquinaPodeFalar, iaRespondeSozinha } = await import(
  "@/services/foocci-sdr/FoocciSalesChannel"
);

/** Banco mínimo que conta quantas vezes foi tocado. */
function banco() {
  const toques = { leituras: 0, confirmacoes: 0 };
  return {
    toques,
    db: {
      leadMensagem: {
        findUnique: async () => {
          toques.leituras += 1;
          return {
            id: "m1",
            status: "PENDENTE",
            direcao: "SAIDA",
            texto: "oi, tudo bem?",
            lead: { whatsapp: "5511999999999", optOutAt: null },
          };
        },
        update: async () => {
          toques.confirmacoes += 1;
          return {};
        },
      },
    } as never,
  };
}

beforeEach(() => {
  enviado.length = 0;
  process.env.FOOCCI_SDR_SEND_ENABLED = "true";
  delete process.env.FOOCCI_SDR_IA_RESPONDE_SOZINHA;
});

afterEach(() => {
  delete process.env.FOOCCI_SDR_SEND_ENABLED;
  delete process.env.FOOCCI_SDR_IA_RESPONDE_SOZINHA;
});

describe("com o envio ligado e a IA desligada", () => {
  it("⛔ a MÁQUINA não fala com o cliente", async () => {
    const { db } = banco();
    const r = await entregarMensagem(db, "m1", "maquina");

    expect(r.entregue).toBe(false);
    expect(r.entregue === false && r.motivo).toBe("maquinaNaoFalaSozinha");
    expect(enviado).toEqual([]);
  });

  it("a recusa vem ANTES de tocar o banco", async () => {
    // Sem isto, a trava poderia estar depois da leitura — e uma mensagem
    // barrada ainda custaria consulta, ou pior, já teria virado chamada à Meta.
    const { db, toques } = banco();
    await entregarMensagem(db, "m1", "maquina");
    expect(toques.leituras).toBe(0);
  });

  it("⭐ a PESSOA continua falando — é o que o dono autorizou", async () => {
    // Esta é a sonda que dá sentido às duas de cima. Se ela ficasse vermelha, a
    // trava teria desligado justamente a porta que era para abrir.
    const { db } = banco();
    const r = await entregarMensagem(db, "m1", "pessoa");

    expect(r.entregue).toBe(true);
    expect(enviado).toHaveLength(1);
    expect(enviado[0]!.texto).toBe("oi, tudo bem?");
  });
});

describe("com as duas chaves ligadas", () => {
  it("a máquina volta a falar — a trava não é um bloqueio permanente", async () => {
    process.env.FOOCCI_SDR_IA_RESPONDE_SOZINHA = "true";
    const { db } = banco();
    const r = await entregarMensagem(db, "m1", "maquina");
    expect(r.entregue).toBe(true);
    expect(enviado).toHaveLength(1);
  });
});

describe("a regra pura, sem ambiente", () => {
  it("pessoa passa sempre; máquina só com a chave", () => {
    expect(maquinaPodeFalar("pessoa", false)).toBe(true);
    expect(maquinaPodeFalar("pessoa", true)).toBe(true);
    expect(maquinaPodeFalar("maquina", false)).toBe(false);
    expect(maquinaPodeFalar("maquina", true)).toBe(true);
  });

  it("a chave nova é DESLIGADA por omissão", () => {
    delete process.env.FOOCCI_SDR_IA_RESPONDE_SOZINHA;
    expect(iaRespondeSozinha()).toBe(false);
  });

  it("só a palavra exata liga — 'sim', '1' e 'TRUE ' não contam", () => {
    // Uma trava que aceita qualquer coisa parecida com verdade é uma trava que
    // liga sozinha no dia em que alguém digitar "1" no painel.
    for (const v of ["sim", "1", "yes", "on", ""]) {
      process.env.FOOCCI_SDR_IA_RESPONDE_SOZINHA = v;
      expect(iaRespondeSozinha(), `"${v}" não pode ligar`).toBe(false);
    }
    process.env.FOOCCI_SDR_IA_RESPONDE_SOZINHA = "  TRUE  ";
    expect(iaRespondeSozinha()).toBe(true); // aparado e sem caixa, isto é "true"
  });
});
