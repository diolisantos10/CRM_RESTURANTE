/**
 * A ESCADA DE MODO OBRIGATÓRIA — `alterarModo` (config.ts).
 *
 * ── O ACHADO DA RODADA ANTERIOR, E O QUE ESTE ARQUIVO PROVA ─────────────────
 *
 * `alterarModo` aceitava qualquer transição entre OFF/SHADOW/GUARD/
 * INTERVENTION — inclusive OFF direto para INTERVENTION, sem nunca passar por
 * SHADOW/GUARD. A escada agora vive no código, não só na doutrina do
 * cabeçalho do arquivo. Este teste usa um dublê de banco em memória (mesmo
 * padrão de `isolamento.test.ts`/`latencia.test.ts`) — não precisa de
 * Postgres real: a régua está inteira em `alterarModo`, sem SQL condicional.
 *
 *   1. Salto de 2+ degraus é recusado, E registrado no histórico com
 *      `aceita: false` — inclusive quando a linha singleton ainda não existe
 *      (a FK de `supervisoraModoHistorico.configId` não pode quebrar a
 *      recusa).
 *   2. Avanço de exatamente 1 degrau é aceito.
 *   3. Regressão — para OFF ou para qualquer degrau abaixo, mesmo pulando
 *      vários de uma vez — é sempre aceita e imediata.
 *   4. Reativar depois de cair para OFF reinicia a escada: `ligada:false`
 *      então `ligada:true, modo:"GUARD"` direto é o MESMO salto de
 *      OFF→GUARD, e é recusado — precisa passar por SHADOW de novo.
 */

import { describe, it, expect } from "vitest";
import type { ModoDaSupervisora } from "@prisma/client";
import { alterarModo } from "./config";

interface LinhaDeConfig {
  id: string;
  ligada: boolean;
  modo: ModoDaSupervisora;
  atualizadoPor: string | null;
  atualizadoEm: Date;
}

interface LinhaDeHistorico {
  id: string;
  configId: string;
  modoAnterior: ModoDaSupervisora;
  modoNovo: ModoDaSupervisora;
  alteradoPor: string;
  motivo: string | null;
  alteradoEm: Date;
  aceita: boolean;
}

/** Dublê de banco em memória — só o que `alterarModo` de fato chama. */
function dbFalso(inicial: LinhaDeConfig | null = null) {
  let config: LinhaDeConfig | null = inicial;
  const historico: LinhaDeHistorico[] = [];

  const db = {
    supervisoraConfig: {
      findUnique: async () => config,
      upsert: async ({
        create,
        update,
      }: {
        create: Omit<LinhaDeConfig, "atualizadoEm">;
        update: Partial<LinhaDeConfig>;
      }) => {
        config = config
          ? { ...config, ...update, atualizadoEm: new Date() }
          : { atualizadoEm: new Date(), atualizadoPor: null, ...create };
        return config;
      },
    },
    supervisoraModoHistorico: {
      create: async ({ data }: { data: Omit<LinhaDeHistorico, "id"> }) => {
        const linha: LinhaDeHistorico = { id: `h${historico.length + 1}`, ...data };
        historico.push(linha);
        return linha;
      },
    },
  } as never;

  return { db, historico, config: () => config };
}

describe("alterarModo — a escada", () => {
  it("salto de 2 degraus (OFF→GUARD) é recusado e registrado com aceita:false", async () => {
    const { db, historico, config } = dbFalso({
      id: "singleton",
      ligada: false,
      modo: "SHADOW",
      atualizadoPor: "alguem",
      atualizadoEm: new Date(0),
    });

    const r = await alterarModo(db, { novaLigada: true, novoModo: "GUARD", alteradoPor: "gestor-1" });

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("esperava recusa");
    expect(r.causa).toBe("saltoPerigoso");
    if (r.causa === "saltoPerigoso") {
      expect(r.detalhe).toMatch(/OFF/);
      expect(r.detalhe).toMatch(/GUARD/);
    }

    // Registrado — não desaparece sem rastro.
    expect(historico).toHaveLength(1);
    expect(historico[0]).toMatchObject({
      modoAnterior: "OFF",
      modoNovo: "GUARD",
      alteradoPor: "gestor-1",
      aceita: false,
    });

    // E a configuração NÃO mudou — a tentativa foi recusada de verdade.
    expect(config()).toMatchObject({ ligada: false, modo: "SHADOW", atualizadoPor: "alguem" });
  });

  it("salto de 2+ degraus (sem linha ainda → INTERVENTION) é recusado mesmo sem linha singleton (FK segura)", async () => {
    const { db, historico, config } = dbFalso(null);

    // Sem linha nenhuma, `lerConfig`/`alterarModo` tratam "ninguém decidiu
    // nada" como OFF (`SEM_CONFIGURACAO`, ver config.ts) — pedir INTERVENTION
    // direto é OFF→INTERVENTION, um salto de 3 degraus.
    const r = await alterarModo(db, { novoModo: "INTERVENTION", alteradoPor: "gestor-1" });

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("esperava recusa");
    expect(r.causa).toBe("saltoPerigoso");

    expect(historico).toHaveLength(1);
    expect(historico[0]).toMatchObject({
      modoAnterior: "OFF",
      modoNovo: "INTERVENTION",
      aceita: false,
    });

    // A linha singleton nasceu (para a FK), mas com "ninguém decidiu nada" —
    // OFF, nunca ligada — a tentativa foi recusada, nada mudou de fato.
    expect(config()).toMatchObject({ ligada: false, modo: "OFF", atualizadoPor: null });
  });

  it("salto de 2 degraus (sem linha ainda → GUARD) também é recusado", async () => {
    const { db, historico } = dbFalso(null);

    // OFF→GUARD é um salto de 2 — mesma recusa, mesmo sem SHADOW no meio.
    const r = await alterarModo(db, { novoModo: "GUARD", alteradoPor: "gestor-1" });

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("esperava recusa");
    expect(r.causa).toBe("saltoPerigoso");
    expect(historico[0]).toMatchObject({ modoAnterior: "OFF", modoNovo: "GUARD", aceita: false });
  });

  it("avanço de exatamente 1 degrau (sem linha ainda → SHADOW) é aceito", async () => {
    const { db, historico, config } = dbFalso(null);

    // Sem linha nenhuma, o efetivo de origem é OFF — pedir SHADOW é um avanço
    // de exatamente 1 degrau, o único aceitável para quem nunca configurou nada.
    const r = await alterarModo(db, { novoModo: "SHADOW", alteradoPor: "gestor-1" });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("esperava aceite");
    expect(r.modoAnterior).toBe("OFF");
    expect(r.modoNovo).toBe("SHADOW");
    expect(historico[0]).toMatchObject({ aceita: true });
    expect(config()).toMatchObject({ ligada: true, modo: "SHADOW", atualizadoPor: "gestor-1" });
  });

  it("avanço de exatamente 1 degrau (SHADOW→GUARD) é aceito", async () => {
    const { db, historico, config } = dbFalso({
      id: "singleton",
      ligada: true,
      modo: "SHADOW",
      atualizadoPor: "alguem",
      atualizadoEm: new Date(0),
    });

    const r = await alterarModo(db, { novoModo: "GUARD", alteradoPor: "gestor-1" });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("esperava aceite");
    expect(r.modoAnterior).toBe("SHADOW");
    expect(r.modoNovo).toBe("GUARD");

    expect(historico).toHaveLength(1);
    expect(historico[0]).toMatchObject({ modoAnterior: "SHADOW", modoNovo: "GUARD", aceita: true });
    expect(config()).toMatchObject({ ligada: true, modo: "GUARD", atualizadoPor: "gestor-1" });
  });

  it("regressão de qualquer ponto para OFF é sempre aceita e imediata (inclusive pulando degraus)", async () => {
    const { db, historico } = dbFalso({
      id: "singleton",
      ligada: true,
      modo: "INTERVENTION",
      atualizadoPor: "alguem",
      atualizadoEm: new Date(0),
    });

    // Desligar (`ligada:false`) sempre cai para OFF, mesmo vindo de INTERVENTION.
    const r = await alterarModo(db, { novaLigada: false, alteradoPor: "gestor-1", motivo: "freio de emergência" });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("esperava aceite");
    expect(r.modoAnterior).toBe("INTERVENTION");
    expect(r.modoNovo).toBe("OFF");
    expect(historico[0]).toMatchObject({ modoAnterior: "INTERVENTION", modoNovo: "OFF", aceita: true });
  });

  it("regressão de vários degraus sem desligar (INTERVENTION→SHADOW) também é aceita de imediato", async () => {
    const { db, historico } = dbFalso({
      id: "singleton",
      ligada: true,
      modo: "INTERVENTION",
      atualizadoPor: "alguem",
      atualizadoEm: new Date(0),
    });

    const r = await alterarModo(db, { novoModo: "SHADOW", alteradoPor: "gestor-1" });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("esperava aceite");
    expect(r.modoAnterior).toBe("INTERVENTION");
    expect(r.modoNovo).toBe("SHADOW");
    expect(historico[0]).toMatchObject({ aceita: true });
  });

  it("reativar depois de cair para OFF reinicia a escada — ligada:true + modo:GUARD direto é recusado", async () => {
    // Estado: já esteve em GUARD, mas foi desligado — `modo` na base ainda
    // guarda "GUARD" (só `ligada` virou false), exatamente como o freio de
    // emergência grava hoje.
    const { db: dbRecusa, historico: historicoRecusa } = dbFalso({
      id: "singleton",
      ligada: false,
      modo: "GUARD",
      atualizadoPor: "alguem",
      atualizadoEm: new Date(0),
    });

    const recusado = await alterarModo(dbRecusa, {
      novaLigada: true,
      novoModo: "GUARD",
      alteradoPor: "gestor-1",
    });
    expect(recusado.ok).toBe(false);
    if (recusado.ok) throw new Error("esperava recusa");
    expect(recusado.causa).toBe("saltoPerigoso");
    expect(historicoRecusa[0]).toMatchObject({ modoAnterior: "OFF", modoNovo: "GUARD", aceita: false });

    // O caminho correto — passar por SHADOW de novo — é aceito.
    const { db: dbAceite, historico: historicoAceite } = dbFalso({
      id: "singleton",
      ligada: false,
      modo: "GUARD",
      atualizadoPor: "alguem",
      atualizadoEm: new Date(0),
    });
    const aceito = await alterarModo(dbAceite, {
      novaLigada: true,
      novoModo: "SHADOW",
      alteradoPor: "gestor-1",
    });
    expect(aceito.ok).toBe(true);
    if (!aceito.ok) throw new Error("esperava aceite");
    expect(aceito.modoAnterior).toBe("OFF");
    expect(aceito.modoNovo).toBe("SHADOW");
    expect(historicoAceite[0]).toMatchObject({ aceita: true });
  });
});
