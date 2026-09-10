/**
 * OS LINKS — de onde vêm, e quando o TA entende que a pessoa pediu um.
 *
 * O endereço é derivado das constantes do site; o teste confere que a rota
 * existe em `src/app` — um link que o TA manda para um 404 é pior que nenhum.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { LINKS_DO_FOOCCI, ORIGEM_PUBLICA, linkPedido, pediuInformacaoObjetiva, fraseComLink } from "./links";
import { ASSINAR_URL, EXPERIMENTE_URL, PRECOS_URL } from "@/components/marketing/config";

describe("os quatro links", () => {
  it("vêm das constantes do site, com a origem pública na frente", () => {
    expect(LINKS_DO_FOOCCI.precos).toBe(`${ORIGEM_PUBLICA}${PRECOS_URL}`);
    expect(LINKS_DO_FOOCCI.demo).toBe(`${ORIGEM_PUBLICA}${EXPERIMENTE_URL}`);
    expect(LINKS_DO_FOOCCI.assinar).toBe(`${ORIGEM_PUBLICA}${ASSINAR_URL}`);
    expect(LINKS_DO_FOOCCI.site).toBe(`${ORIGEM_PUBLICA}/site`);
  });

  it("⭐ cada rota EXISTE em src/app — o TA não manda ninguém para um 404", () => {
    const rotas: Record<string, string> = {
      site: path.join("site", "(gated)", "page.tsx"),
      precos: path.join("site", "(gated)", "precos", "page.tsx"),
      demo: path.join("site", "(gated)", "experimente", "page.tsx"),
      assinar: path.join("contratar", "novo", "page.tsx"),
    };
    for (const [nome, arquivo] of Object.entries(rotas)) {
      const caminho = path.join(process.cwd(), "src", "app", arquivo);
      expect(existsSync(caminho), `${nome}: ${caminho} não existe`).toBe(true);
      // E o caminho do link é o do arquivo, sem grupo de rota.
      const semGrupo = "/" + arquivo.replace(/\(gated\)\//, "").replace(/\/page\.tsx$/, "").replace(/\\/g, "/");
      expect(LINKS_DO_FOOCCI[nome as keyof typeof LINKS_DO_FOOCCI]).toBe(`${ORIGEM_PUBLICA}${semGrupo}`);
    }
  });

  it("toda frase com link traz o endereço inteiro", () => {
    for (const qual of ["site", "precos", "demo", "assinar"] as const) {
      expect(fraseComLink(qual)).toContain(LINKS_DO_FOOCCI[qual]);
    }
  });
});

describe("o que a pessoa pediu", () => {
  it("preço, demo, assinar e link são reconhecidos", () => {
    expect(linkPedido("quanto custa?")).toBe("precos");
    expect(linkPedido("qual o valor do plano?")).toBe("precos");
    expect(linkPedido("quero ver uma demo")).toBe("demo");
    expect(linkPedido("dá pra testar antes?")).toBe("demo");
    expect(linkPedido("como assino?")).toBe("assinar");
    expect(linkPedido("quero contratar")).toBe("assinar");
    expect(linkPedido("me manda o link do site")).toBe("site");
  });

  it("assinar vence plano: 'quero assinar o plano' é assinar", () => {
    expect(linkPedido("quero assinar o plano crescimento")).toBe("assinar");
  });

  it("⭐ 'oi, vi o site de vocês' NÃO é pedido de link — é a abertura mais comum", () => {
    // Foi o primeiro defeito desta regra: "site" sozinho marcava a abertura
    // como pedido objetivo, e o TA parava de sondar no primeiro "oi".
    expect(linkPedido("oi, vi o site de vocês")).toBeNull();
    expect(pediuInformacaoObjetiva("oi, vi o site de vocês")).toBe(false);
  });

  it("conversa comum não pede nada", () => {
    for (const m of ["oi", "tenho uma pizzaria", "vendo pelo whatsapp e no salão", "o que é o Foocci?"]) {
      expect(linkPedido(m), m).toBeNull();
    }
  });
});
