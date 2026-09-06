import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { exigirAgente, telefoneMascarado } from "./agente-req";
import { variavelDaChave } from "./agente-auth";
import { ACESSOS_DECLARADOS } from "@/services/organizacao/acessosDeclarados";

/**
 * ⛔⛔ O PORTÃO ÚNICO das rotas de agente, e a máscara do telefone.
 *
 * A cena que mais importa é a do telefone: ele é dado pessoal de uma pessoa
 * real que preencheu um formulário. Se um dia alguém "melhorar" devolvendo o
 * número inteiro, nada quebra e ninguém percebe — o vazamento é silencioso por
 * natureza. Por isso a trava é teste, e não recomendação.
 */

const DECLARADO = ACESSOS_DECLARADOS[0]!;
const VAR = variavelDaChave(DECLARADO.crachaConnect);
const SEGREDO = "chave-de-prova-do-portao";
const antes = process.env[VAR];

beforeEach(() => { process.env[VAR] = SEGREDO; });
afterEach(() => {
  if (antes === undefined) delete process.env[VAR];
  else process.env[VAR] = antes;
});

function req(headers: Record<string, string>) {
  return new NextRequest("http://localhost:3000/x", { headers });
}

const bom = {
  "x-foocci-agente": DECLARADO.crachaConnect,
  authorization: `Bearer ${SEGREDO}`,
};

describe("o portão único", () => {
  it("⭐ deixa passar credencial boa com a capacidade declarada", () => {
    const r = exigirAgente(req(bom), "ler:leads");
    expect(r.ok).toBe(true);
  });

  it("⛔ credencial ruim: 401, e a recusa é cega", async () => {
    const r = exigirAgente(req({ ...bom, authorization: "Bearer errada" }), "ler:leads");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.resposta.status).toBe(401);
    // Nada aqui pode dizer qual crachá existe nem qual capacidade faltou: quem
    // ainda não provou quem é não recebe pista nenhuma.
    expect(await r.resposta.json()).toEqual({
      ok: false,
      error: "credencial de agente não confere",
    });
  });

  it("⛔ credencial boa e capacidade NÃO declarada: 403", async () => {
    const r = exigirAgente(req(bom), "escrever:leads");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.resposta.status).toBe(403);
    // Aqui a recusa PODE ser específica: quem chegou já provou quem é.
    expect((await r.resposta.json()).error).toContain("escrever:leads");
  });

  it("⛔⛔ nenhuma capacidade de ESCRITA é declarada para ninguém", () => {
    // O Diretor Geral recusou escrita explicitamente, tendo o papel que a
    // permitiria. Se um dia entrar uma por distração, esta cena cai.
    for (const a of ACESSOS_DECLARADOS) {
      for (const c of a.alcance) {
        expect(c.startsWith("ler:"), `capacidade que não é leitura: ${c}`).toBe(true);
      }
    }
  });
});

describe("⛔⛔ o telefone sai mascarado", () => {
  it("mostra só os quatro últimos dígitos", () => {
    expect(telefoneMascarado("+55 (11) 98765-4321")).toBe("••••4321");
    expect(telefoneMascarado("5511987654321")).toBe("••••4321");
  });

  it("número curto demais não vaza nada", () => {
    expect(telefoneMascarado("12")).toBe("••••");
  });

  it("ausência continua sendo ausência, e não texto", () => {
    // `null` não pode virar "••••": quem lê precisa distinguir "não temos o
    // telefone" de "temos e está escondido".
    expect(telefoneMascarado(null)).toBeNull();
  });

  it("⛔ o número inteiro NUNCA aparece na saída", () => {
    const inteiro = "5511987654321";
    expect(telefoneMascarado(inteiro)).not.toContain("98765");
    expect(telefoneMascarado(inteiro)!.replace(/\D/g, "").length).toBe(4);
  });
});
