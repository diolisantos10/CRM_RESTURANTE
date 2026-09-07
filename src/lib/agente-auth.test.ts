import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  autenticarAgente,
  segredoApresentado,
  variavelDaChave,
} from "./agente-auth";
import { ACESSOS_DECLARADOS } from "@/services/organizacao/acessosDeclarados";

/**
 * ⛔⛔ A PORTA DO AGENTE — as formas de ela virar porta dos fundos.
 *
 *   1. abrir para conta que ninguém declarou
 *   2. variável ausente virar "entra qualquer um"
 *   3. a recusa DIZER qual das três coisas falhou, entregando o organograma
 *   4. dois crachás caírem no mesmo nome de variável e um abrir a porta do outro
 */

const DECLARADO = ACESSOS_DECLARADOS[0]!;
const VAR = variavelDaChave(DECLARADO.crachaConnect);
const SEGREDO = "chave-de-prova-do-agente-bem-longa";

const guardado = new Map<string, string | undefined>();

beforeEach(() => {
  guardado.set(VAR, process.env[VAR]);
  process.env[VAR] = SEGREDO;
});

afterEach(() => {
  for (const [n, v] of guardado) {
    if (v === undefined) delete process.env[n];
    else process.env[n] = v;
  }
  guardado.clear();
});

describe("o nome da variável", () => {
  it("sai do crachá, sem o código conhecer agente nenhum", () => {
    expect(variavelDaChave("dioli.control-room.diretoria.diretor-geral")).toBe(
      "FOOCCI_CHAVE_DE_AGENTE_DIOLI_CONTROL_ROOM_DIRETORIA_DIRETOR_GERAL",
    );
  });

  it("⛔ dois declarados nunca caem no mesmo nome", () => {
    // Colisão faria a chave de um agente abrir a porta do outro, e nada
    // apontaria para isso — os dois continuariam parecendo corretos.
    const nomes = ACESSOS_DECLARADOS.map((a) => variavelDaChave(a.crachaConnect));
    expect(new Set(nomes).size).toBe(nomes.length);
  });
});

describe("a conferência", () => {
  it("⭐ crachá declarado com o segredo certo entra", () => {
    const r = autenticarAgente(DECLARADO.crachaConnect, SEGREDO);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.acesso.email).toBe(DECLARADO.email);
  });

  it("aceita o crachá em qualquer caixa", () => {
    expect(autenticarAgente(DECLARADO.crachaConnect.toUpperCase(), SEGREDO).ok).toBe(true);
  });

  it("⛔ segredo errado não entra", () => {
    expect(autenticarAgente(DECLARADO.crachaConnect, "quase-a-chave-certa-mas-nao").ok).toBe(false);
  });

  it("⛔ crachá NÃO declarado não entra, mesmo com variável posta", () => {
    const intruso = "dioli.control-room.desenvolvimento.qualidade";
    process.env[variavelDaChave(intruso)] = SEGREDO;
    try {
      // A lista do repositório é a única fonte de quem tem porta de agente.
      // Sem esta trava, criar a variável seria conceder acesso sem revisão.
      expect(autenticarAgente(intruso, SEGREDO).ok).toBe(false);
    } finally {
      delete process.env[variavelDaChave(intruso)];
    }
  });

  it("⛔ sem variável configurada é porta FECHADA, nunca aberta", () => {
    delete process.env[VAR];
    expect(autenticarAgente(DECLARADO.crachaConnect, SEGREDO).ok).toBe(false);
    expect(autenticarAgente(DECLARADO.crachaConnect, "").ok).toBe(false);
  });

  it("⛔ as três recusas são a MESMA — sem oráculo de organograma", () => {
    const semChave = (() => {
      delete process.env[VAR];
      const r = autenticarAgente(DECLARADO.crachaConnect, SEGREDO);
      process.env[VAR] = SEGREDO;
      return r;
    })();
    const naoDeclarado = autenticarAgente("dioli.control-room.nao.existe", SEGREDO);
    const segredoErrado = autenticarAgente(DECLARADO.crachaConnect, "outra-coisa-qualquer");

    // Motivos diferentes diriam quais crachás existem e quais já têm chave.
    expect(semChave).toEqual(naoDeclarado);
    expect(naoDeclarado).toEqual(segredoErrado);
  });
});

describe("o cabeçalho", () => {
  it("lê Bearer, e nada além de Bearer", () => {
    expect(segredoApresentado("Bearer abc123")).toBe("abc123");
    expect(segredoApresentado("bearer abc123")).toBe("abc123");
    expect(segredoApresentado("Basic abc123")).toBe("");
    expect(segredoApresentado(null)).toBe("");
    expect(segredoApresentado("abc123")).toBe("");
  });
});
