/**
 * A FICHA EXPANSÍVEL DA BASE FRIA, medida no markup — sem banco, sem sessão,
 * sem servidor. Ver o comentário grande em `CelulaDoContato` (BaseFriaClient.tsx)
 * para por que este componente foi isolado.
 *
 * ── O QUE ESTE ARQUIVO PROVA ─────────────────────────────────────────────────
 *
 * Achado do CEO, 11/09/2026: "751 contatos... contatos sem leadId não são
 * clicáveis." A causa: quem não tinha `leadId` virava um `<span>`, sem
 * `onClick`. Este arquivo prova, no HTML gerado, que isso não acontece mais —
 * e que "Abrir conversa" é um elemento SEPARADO, nunca o substituto do clique.
 *
 * ⚠️ `.test.ts`, e não `.test.tsx`: a bateria só coleta `src/**‍/*.test.ts`
 * (`vitest.config.ts`). `React.createElement` no lugar de sintaxe JSX é o
 * mesmo caminho que `SiteAnalytics.test.ts` já usa para o mesmo motivo.
 */

import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CelulaDoContato, FichaExpandidaDoContato, type Contato } from "./BaseFriaClient";

const CONTATO_BASE: Contato = {
  id: "c1",
  nome: "Fulano",
  whatsapp: "11988887777",
  empresa: "Restaurante do Fulano",
  cidade: "Curitiba",
  estado: "PR",
  tipo: "Pizzaria",
  situacao: "PENDENTE",
  entrouEm: "2026-09-01T12:00:00Z",
  leadId: null,
  loteSituacao: "LIBERADO",
  proveniencia: "Lista pública",
  responsavel: "Diretor",
  importacaoId: null,
  arquivo: "lista.csv",
  canalDeObtencao: null,
  tentativas: 0,
  ultimaTentativa: null,
  motivoDeBloqueio: null,
  cargo: null,
  telefoneSecundario: null,
  email: null,
  bairro: null,
  endereco: null,
  cep: null,
  cnpj: null,
  instagram: null,
  site: null,
  googleMapsUrl: null,
  numeroDeUnidades: null,
  canaisAtuais: [],
  observacoes: null,
  tags: [],
};

describe("⭐⭐ CelulaDoContato — o defeito que não pode voltar", () => {
  it("⛔⛔ SEM leadId: continua sendo um <button>, não um <span>", () => {
    const html = renderToStaticMarkup(
      React.createElement(CelulaDoContato, {
        c: { ...CONTATO_BASE, leadId: null },
        aberto: false,
        aoAlternar: () => {},
      }),
    );
    expect(html).toContain("<button");
  });

  it("⭐ COM leadId: também é um <button> — e ganha 'Abrir conversa' A MAIS, não no lugar", () => {
    const html = renderToStaticMarkup(
      React.createElement(CelulaDoContato, {
        c: { ...CONTATO_BASE, leadId: "lead-1" },
        aberto: false,
        aoAlternar: () => {},
      }),
    );
    expect(html).toContain("<button");
    expect(html).toContain("Abrir conversa");
    expect(html).toContain("/comercial/conversas?leadId=lead-1");
  });

  it("sem leadId, 'Abrir conversa' não aparece — mas o botão continua lá", () => {
    const html = renderToStaticMarkup(
      React.createElement(CelulaDoContato, {
        c: { ...CONTATO_BASE, leadId: null },
        aberto: false,
        aoAlternar: () => {},
      }),
    );
    expect(html).toContain("<button");
    expect(html).not.toContain("Abrir conversa");
  });

  it("aria-expanded reflete o estado — acessibilidade do toggle", () => {
    const fechado = renderToStaticMarkup(
      React.createElement(CelulaDoContato, { c: CONTATO_BASE, aberto: false, aoAlternar: () => {} }),
    );
    const aberto = renderToStaticMarkup(
      React.createElement(CelulaDoContato, { c: CONTATO_BASE, aberto: true, aoAlternar: () => {} }),
    );
    expect(fechado).toContain('aria-expanded="false"');
    expect(aberto).toContain('aria-expanded="true"');
  });
});

describe("⭐ FichaExpandidaDoContato — os 20 campos, ausente vira '—'", () => {
  it("campo preenchido aparece com o valor", () => {
    const html = renderToStaticMarkup(React.createElement(FichaExpandidaDoContato, { c: CONTATO_BASE }));
    expect(html).toContain("Fulano");
    expect(html).toContain("Restaurante do Fulano");
    expect(html).toContain("Curitiba/PR");
  });

  it("⛔ campo ausente aparece como '—', nunca desaparece e nunca quebra", () => {
    const html = renderToStaticMarkup(React.createElement(FichaExpandidaDoContato, { c: CONTATO_BASE }));
    // cargo, telefoneSecundario, email, bairro, endereco, cep, cnpj, instagram,
    // site, googleMapsUrl, observacoes — todos null no fixture: têm de aparecer
    // como travessão, e a lista de rótulos tem de estar toda presente.
    for (const rotulo of [
      "Cargo",
      "Telefone secundário",
      "E-mail",
      "Bairro",
      "Endereço",
      "CEP",
      "CNPJ",
      "Instagram",
      "Site",
      "Google Maps",
      "Observações",
    ]) {
      expect(html, rotulo).toContain(rotulo);
    }
    // Pelo menos um "—" por campo ausente — não uma lista vazia de rótulos.
    expect((html.match(/—/g) ?? []).length).toBeGreaterThanOrEqual(11);
  });

  it("um contato totalmente vazio (só o obrigatório) não derruba a ficha", () => {
    const vazio: Contato = {
      ...CONTATO_BASE,
      nome: null,
      empresa: null,
      cidade: null,
      estado: null,
      tipo: null,
    };
    expect(() =>
      renderToStaticMarkup(React.createElement(FichaExpandidaDoContato, { c: vazio })),
    ).not.toThrow();
  });
});
