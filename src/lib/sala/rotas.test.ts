/**
 * A SALA MUDOU DE ENDEREÇO — e nada pode ter ficado para trás.
 *
 * ── O QUE ESTE ARQUIVO GUARDA ───────────────────────────────────────────────
 *
 * Em 26/08/2026 a Sala saiu de `/admin/sala-de-vendas` para `/comercial`, por
 * decisão do CEO: quem atende cliente não trabalha dentro do painel de
 * administração da empresa.
 *
 * Mudança de endereço é o tipo de trabalho que o compilador não protege. Um
 * `href` esquecido não quebra o build — vira um botão que leva a lugar nenhum,
 * descoberto por um vendedor no meio de uma conversa com cliente. Daí estes
 * casos, que valem por três coisas:
 *
 *   1. **o endereço velho continua chegando**, inclusive nas duas telas que
 *      mudaram de nome no caminho;
 *   2. **ninguém digitou caminho à mão** em outro arquivo;
 *   3. **as abas continuam fechando por papel** — a mudança de casa não podia
 *      abrir portas que estavam fechadas.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  COMERCIAL,
  ENTRADA,
  ROTAS,
  BASE_ANTIGA,
  destinoDoEnderecoAntigo,
  abasDoComercial,
} from "./rotas";

describe("o endereço antigo continua chegando", () => {
  it("a raiz cai na raiz nova", () => {
    expect(destinoDoEnderecoAntigo(BASE_ANTIGA)).toBe(COMERCIAL);
    expect(destinoDoEnderecoAntigo(`${BASE_ANTIGA}/`)).toBe(COMERCIAL);
  });

  it("⭐ as duas telas que mudaram de NOME também chegam", () => {
    // O caso que carrega o arquivo. Um redireciono que só trocasse o prefixo
    // mandaria `/admin/sala-de-vendas/atendimento` para `/comercial/atendimento`,
    // que não existe — e o 404 cairia justamente em cima da tela de trabalho do
    // dia do vendedor.
    expect(destinoDoEnderecoAntigo(`${BASE_ANTIGA}/atendimento`)).toBe(ROTAS.conversas);
    expect(destinoDoEnderecoAntigo(`${BASE_ANTIGA}/canal`)).toBe(ROTAS.whatsapp);
  });

  it("as que não mudaram de nome passam direto", () => {
    for (const [chave, destino] of [
      ["funil", ROTAS.funil],
      ["painel", ROTAS.painel],
      ["precos", ROTAS.precos],
      ["agentes", ROTAS.agentes],
      ["ensaio", ROTAS.ensaio],
      ["acessos", ROTAS.acessos],
    ] as const) {
      expect(destinoDoEnderecoAntigo(`${BASE_ANTIGA}/${chave}`), chave).toBe(destino);
    }
  });

  it("um caminho mais fundo preserva a cauda", () => {
    // Links de conversa levam o id do lead junto. Perder a cauda mandaria a
    // pessoa para a lista em vez da conversa que ela clicou.
    expect(destinoDoEnderecoAntigo(`${BASE_ANTIGA}/atendimento/lead-123`))
      .toBe(`${ROTAS.conversas}/lead-123`);
  });
});

describe("ninguém digitou o endereço à mão em outro lugar", () => {
  // A trava estrutural. Uma asserção de comportamento provaria que os endereços
  // de HOJE estão certos; ler o código-fonte prova que o caminho para errar
  // amanhã não existe — endereço vem daqui, e de lugar nenhum além.
  const RAIZ = path.resolve(__dirname, "../..");

  /**
   * Varredura recursiva com `readdirSync`, e não `fs.globSync`.
   *
   * ⚠️ `globSync` existe no Node da máquina de desenvolvimento e NÃO existe no
   * Node do CI — o teste passou aqui e reprovou lá com "globSync is not a
   * function". É o mesmo molde que `services/brain/architecture.test.ts` já
   * usava; usar duas técnicas para a mesma varredura era a diferença entre
   * verde local e vermelho no runner.
   */
  function listar(dir: string, acc: string[] = []): string[] {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const completo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        if (entrada.name === "node_modules") continue;
        listar(completo, acc);
      } else if (/\.(ts|tsx)$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)) {
        acc.push(path.relative(RAIZ, completo).split(path.sep).join("/"));
      }
    }
    return acc;
  }

  function fontesDoProduto(): string[] {
    return listar(RAIZ)
      // Este módulo é a fonte, e o redireciono existe justamente para citar o
      // endereço velho. Os dois são o lugar certo de a string aparecer.
      .filter((f) => !f.endsWith("lib/sala/rotas.ts"))
      .filter((f) => !f.includes("sala-de-vendas/[[...resto]]"));
  }

  it("nenhuma tela do produto ainda aponta para /admin/sala-de-vendas", () => {
    const culpados = fontesDoProduto().filter((f) =>
      readFileSync(path.join(RAIZ, f), "utf8").includes('"/admin/sala-de-vendas'),
    );

    expect(culpados, `endereço antigo digitado à mão em: ${culpados.join(", ")}`).toEqual([]);
  });
});

describe("as abas continuam fechando por papel", () => {
  const rotulos = (papel: Parameters<typeof abasDoComercial>[0]) =>
    abasDoComercial(papel).map((a) => a.rotulo);

  it("⭐ o vendedor NÃO ganhou aba nova na mudança de casa", () => {
    // Mudar de endereço não podia ser a ocasião em que alguém passou a enxergar
    // o painel da operação, o canal da Meta ou a criação de acesso.
    const dele = rotulos("AGENTE_HUMANO");
    expect(dele).not.toContain("Painel");
    expect(dele).not.toContain("WhatsApp");
    expect(dele).not.toContain("Criar acesso");
  });

  it("⭐ o SDR humano também não ganha a aba da Supervisora", () => {
    // A Supervisora compara o desempenho dos agentes entre si — a mesma razão
    // de negócio por que o Painel é fechado para o SDR.
    expect(rotulos("AGENTE_HUMANO")).not.toContain("Supervisora");
    for (const papel of ["MASTER_CEO", "DIRETOR_FOOCCI", "GERENTE_DEPARTAMENTO", "AUDITOR_QA"] as const) {
      expect(rotulos(papel), papel).toContain("Supervisora");
    }
  });

  it("mas ele continua alcançando o trabalho do dia", () => {
    // A metade que passa. Sem ela, uma lista que escondesse TUDO de todos
    // passaria no caso acima e deixaria o vendedor sem tela nenhuma.
    const dele = rotulos("AGENTE_HUMANO");
    expect(dele).toContain("Filas");
    expect(dele).toContain("Conversas");
    expect(dele).toContain("Funil");
  });

  it("criar acesso é só do dono", () => {
    expect(rotulos("MASTER_CEO")).toContain("Criar acesso");
    expect(rotulos("DIRETOR_FOOCCI")).toContain("Criar acesso");
    expect(rotulos("GERENTE_DEPARTAMENTO")).not.toContain("Criar acesso");
    expect(rotulos("AUDITOR_QA")).not.toContain("Criar acesso");
  });

  it("quem entra pela senha da casa vê tudo — ela não carrega papel", () => {
    expect(rotulos(null)).toContain("Criar acesso");
    expect(rotulos(null)).toContain("Painel");
  });

  it("toda aba pende de /comercial, e a entrada também", () => {
    for (const a of abasDoComercial(null)) {
      expect(a.href.startsWith(COMERCIAL), a.href).toBe(true);
    }
    expect(ENTRADA.startsWith(COMERCIAL)).toBe(true);
  });
});
