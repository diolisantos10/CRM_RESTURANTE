import { describe, expect, it, vi } from "vitest";
import {
  ACESSOS_DECLARADOS,
  aplicarAcessosDeclarados,
  type AcessoDeclarado,
} from "./acessosDeclarados";
import { TIPOS_DE_ACESSO } from "./pessoas";

/**
 * ⛔⛔ UMA LISTA QUE CONCEDE ACESSO A CADA DEPLOY — as formas de virar defeito.
 *
 *   1. trocar a senha de quem já existe → a pessoa é expulsa da própria conta
 *      toda subida, e a caixa dela vira depósito de senha morta
 *   2. papel inventado → uma ficha que parece acesso e nunca entra
 *   3. crachá vazio → a senha não tem para onde ir, e ninguém fica sabendo
 *   4. uma falha derrubar a subida do produto
 */

function bancoFake(existentes: string[] = []) {
  return {
    internalUser: {
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) =>
        existentes.includes(where.email) ? { id: "ja-existe" } : null,
      ),
      upsert: vi.fn(async () => ({ id: "novo" })),
    },
    department: { findUnique: vi.fn(async () => null) },
    departmentMembership: { upsert: vi.fn(async () => ({})) },
  };
}

describe("a lista declarada", () => {
  it("⛔ todo papel declarado existe de verdade", () => {
    const validos = new Set(TIPOS_DE_ACESSO.map((t) => t.papel as string));
    for (const a of ACESSOS_DECLARADOS) {
      // Papel inventado cria uma ficha que parece acesso e nunca entra — e o
      // sintoma chega semanas depois como "criei e não funciona".
      expect(validos.has(a.papel), `papel desconhecido: ${a.papel}`).toBe(true);
    }
  });

  it("⛔ todo mundo tem crachá — senão a senha não tem para onde ir", () => {
    for (const a of ACESSOS_DECLARADOS) {
      expect(a.crachaConnect.trim().length, `sem crachá: ${a.email}`).toBeGreaterThan(0);
      expect(a.crachaConnect).toMatch(/^dioli\./);
    }
  });

  it("⭐ e cada linha diz POR QUE aquela pessoa tem acesso", () => {
    for (const a of ACESSOS_DECLARADOS) {
      // Concessão sem motivo escrito é concessão que ninguém sabe revogar: seis
      // meses depois ninguém lembra se ainda faz sentido.
      expect(a.porque.length, `sem motivo: ${a.email}`).toBeGreaterThan(20);
    }
  });
});

describe("⛔⛔ aplicar de novo não mexe em quem já existe", () => {
  const um: AcessoDeclarado = {
    nome: "Diretor Geral",
    email: "diretor.geral@agentes.foocci.com.br",
    papel: "DIRETOR_FOOCCI",
    crachaConnect: "dioli.control-room.diretoria.diretor-geral",
    porque: "prova",
  };

  it("quem já existe fica INTACTO — nem senha, nem papel", async () => {
    const db = bancoFake([um.email]);
    const r = await aplicarAcessosDeclarados(db as never, "https://x", [um]);

    expect(r.intactos).toEqual([um.email]);
    expect(r.criados).toEqual([]);
    // ⛔ A linha que importa. `criarPessoa` TROCA a senha de quem já existe — é
    // certo para "esqueci minha senha" e catastrófico numa lista que roda a
    // cada deploy: a pessoa seria expulsa da própria conta toda subida.
    expect(
      db.internalUser.upsert.mock.calls.length,
      "⛔⛔ o seed trocou a senha de quem ja existia",
    ).toBe(0);
  });

  it("⛔ uma falha não derruba o resto nem lança", async () => {
    const db = bancoFake();
    db.internalUser.findUnique = vi.fn(async () => {
      throw new Error("banco fora do ar");
    });

    // Roda no boot: um defeito aqui nao pode derrubar a subida do produto.
    const r = await aplicarAcessosDeclarados(db as never, "https://x", [um]);
    expect(r.falhas).toHaveLength(1);
    expect(r.falhas[0]!.motivo).toContain("banco fora do ar");
  });
});
