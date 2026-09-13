/**
 * NENHUMA SEÇÃO FICA ETERNAMENTE "CARREGANDO…" — SupervisoraClient.tsx.
 *
 * ── O ACHADO DA RODADA ANTERIOR ──────────────────────────────────────────────
 *
 * Quando a chamada de uma seção falhava (`!res.ok`), o código antigo só fazia
 * `return` — o estado nunca saía de `null`, e a seção ficava presa em
 * "Carregando…" para sempre, sem forma de saber que algo deu errado nem de
 * tentar de novo. Agora cada uma das quatro seções (Visão Geral, Conversas em
 * Risco, Desempenho, Prompts e Aprendizado) tem um estado explícito —
 * `carregando | sucesso | vazio | erro` — e o erro mostra uma frase curta e
 * um botão "Tentar de novo".
 *
 * ⚠️ `.test.ts`, e não `.test.tsx`: mesmo caminho de `BaseFriaClient.test.ts`/
 * `SiteAnalytics.test.ts` — `React.createElement` no lugar de JSX, porque a
 * bateria só coleta `src/**‍/*.test.ts` (`vitest.config.ts`). Por isso este
 * teste renderiza as seções EXPORTADAS diretamente (mesmo padrão de
 * `BaseFriaClient.test.ts` com `CelulaDoContato`), em vez de montar
 * `SupervisoraClient` inteiro e emular sua data-fetching — `renderToStaticMarkup`
 * não roda `useEffect`, então uma seção só se prova pelo HTML que ela gera a
 * partir do `estado` que recebe, o mesmo contrato usado pelo componente pai.
 */

import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  SecaoVisaoGeral,
  SecaoConversasEmRisco,
  SecaoDesempenho,
  SecaoPromptsEAprendizado,
  type EstadoSecao,
  type VisaoGeral,
  type ConversaEmRisco,
  type Desempenho,
  type Sugestoes,
  type Versoes,
} from "./SupervisoraClient";

const RISCO_OK: ConversaEmRisco[] = [
  {
    avaliacaoId: "av-1",
    leadId: "lead-1",
    leadNome: "Restaurante do Zé",
    leadWhatsapp: "5511999998888",
    etapa: "QUALIFICACAO",
    autorUserId: "agente-1",
    autorNome: "Fulano",
    papelDoAgente: null,
    veredito: "VERMELHO",
    motivos: ["PITCH_ERRADO"],
    motivoDetalhe: "Ofereceu o plano errado",
    bloqueada: true,
    handoffDisparado: false,
    criadaEm: "2026-09-12T10:00:00Z",
    atendidoPorAgora: "IA",
    atendenteAtualUserId: null,
  },
];

const DESEMPENHO_OK: Desempenho = {
  criterios: [{ motivo: "PITCH_ERRADO", rotulo: "Pitch errado" }],
  criteriosNaoMedidos: ["Empatia percebida"],
  agentes: [
    {
      autorUserId: "agente-1",
      papelDoAgente: null,
      nome: "Fulano",
      total: 10,
      porVeredito: { VERDE: 8, AMARELO: 1, VERMELHO: 1, CRITICO: 0 },
      porMotivo: { PITCH_ERRADO: 1 },
      bloqueadas: 1,
      handoffsDisparados: 0,
    },
  ],
};

const SUGESTOES_OK: Sugestoes = {
  pendentes: [
    {
      id: "sug-1",
      agenteAfetadoTipo: null,
      agenteAfetadoUserId: null,
      papelDoAgente: "TA",
      problemaObservado: "Tom robótico",
      evidenciaMensagemIds: ["m1", "m2"],
      evidenciaLeadIds: ["lead-1"],
      trechoAnterior: "Prezado cliente",
      trechoNovoProposto: "Oi! tudo bem?",
      justificativa: "Cliente reclamou do tom formal.",
      autor: "SUPERVISORA",
      situacao: "PENDENTE",
      criadaEm: "2026-09-12T10:00:00Z",
      notaDaRevisao: null,
    },
  ],
  historico: [],
};

const VERSOES_OK: Versoes = {
  versaoAtivaId: "v1",
  versoes: [
    {
      id: "v1",
      numero: 1,
      situacao: "PUBLICADA",
      identidade: "TA — assistente comercial",
      tomDeVoz: "direto e cordial",
      objetivos: "qualificar e agendar",
      proibidos: [],
      origemSugestaoId: null,
      agenteAfetado: null,
      problemaObservado: null,
      trechoAnterior: null,
      trechoNovoProposto: null,
      justificativaDaAlteracao: null,
      testeCorrespondente: null,
      publicadaEm: "2026-09-01T00:00:00Z",
      publicadaPor: { nome: "Diretor" },
      createdAt: "2026-09-01T00:00:00Z",
    },
  ],
};

const NAO_CHAMAR = () => {
  throw new Error("não deveria ser chamado neste teste");
};

describe("⛔ nenhuma seção fica presa em 'Carregando…' para sempre", () => {
  it("Visão Geral em erro mostra a frase + 'Tentar de novo', nunca 'Carregando…'", () => {
    const estado: EstadoSecao<VisaoGeral> = { fase: "erro", detalhe: "/rota respondeu 500" };
    const html = renderToStaticMarkup(React.createElement(SecaoVisaoGeral, { estado, onRetry: NAO_CHAMAR }));
    expect(html).toContain("Não foi possível carregar esta seção.");
    expect(html).toContain("/rota respondeu 500");
    expect(html).toContain("Tentar de novo");
    expect(html).not.toContain("Carregando…");
  });

  it("Conversas em Risco em erro mostra erro+retry, e a lista de risco não aparece", () => {
    const estado: EstadoSecao<ConversaEmRisco[]> = { fase: "erro", detalhe: "Falha de rede." };
    const html = renderToStaticMarkup(
      React.createElement(SecaoConversasEmRisco, {
        estado,
        ocupado: false,
        onAgir: NAO_CHAMAR,
        onRetry: NAO_CHAMAR,
      }),
    );
    expect(html).toContain("Tentar de novo");
    expect(html).toContain("Falha de rede.");
    expect(html).not.toContain("Carregando…");
    expect(html).not.toContain("Restaurante do Zé");
  });

  it("Desempenho em erro mostra erro+retry", () => {
    const estado: EstadoSecao<Desempenho> = { fase: "erro", detalhe: "/desempenho respondeu 503" };
    const html = renderToStaticMarkup(React.createElement(SecaoDesempenho, { estado, onRetry: NAO_CHAMAR }));
    expect(html).toContain("Tentar de novo");
    expect(html).toContain("/desempenho respondeu 503");
    expect(html).not.toContain("Carregando…");
  });

  it("Prompts e Aprendizado: só 'sugestões' falhando mostra erro só ali — 'versões' continua normal", () => {
    const estadoSugestoes: EstadoSecao<Sugestoes> = { fase: "erro", detalhe: "/sugestoes respondeu 500" };
    const estadoVersoes: EstadoSecao<Versoes> = { fase: "sucesso", dados: VERSOES_OK };
    const html = renderToStaticMarkup(
      React.createElement(SecaoPromptsEAprendizado, {
        estadoSugestoes,
        estadoVersoes,
        ocupado: false,
        onDecidirSugestao: NAO_CHAMAR,
        onPublicarVersao: NAO_CHAMAR,
        onRetrySugestoes: NAO_CHAMAR,
        onRetryVersoes: NAO_CHAMAR,
      }),
    );
    // A seção que falhou: erro + retry, nunca "Carregando…" preso.
    expect(html).toContain("/sugestoes respondeu 500");
    expect(html).toContain("Tentar de novo");
    // A outra metade da MESMA seção segue normal, com o dado de verdade.
    expect(html).toContain("v1 · PUBLICADA");
    expect(html).toContain("ATIVA");
  });

  it("as quatro seções juntas: uma em erro não impede as outras três de mostrar dado real", () => {
    const html =
      renderToStaticMarkup(
        React.createElement(
          React.Fragment,
          null,
          // Visão Geral falhando — a única em erro deste grupo.
          React.createElement(SecaoVisaoGeral, {
            estado: { fase: "erro", detalhe: "/visao-geral respondeu 500" } as EstadoSecao<VisaoGeral>,
            onRetry: NAO_CHAMAR,
          }),
          React.createElement(SecaoConversasEmRisco, {
            estado: { fase: "sucesso", dados: RISCO_OK } as EstadoSecao<ConversaEmRisco[]>,
            ocupado: false,
            onAgir: NAO_CHAMAR,
            onRetry: NAO_CHAMAR,
          }),
          React.createElement(SecaoDesempenho, {
            estado: { fase: "sucesso", dados: DESEMPENHO_OK } as EstadoSecao<Desempenho>,
            onRetry: NAO_CHAMAR,
          }),
          React.createElement(SecaoPromptsEAprendizado, {
            estadoSugestoes: { fase: "sucesso", dados: SUGESTOES_OK } as EstadoSecao<Sugestoes>,
            estadoVersoes: { fase: "sucesso", dados: VERSOES_OK } as EstadoSecao<Versoes>,
            ocupado: false,
            onDecidirSugestao: NAO_CHAMAR,
            onPublicarVersao: NAO_CHAMAR,
            onRetrySugestoes: NAO_CHAMAR,
            onRetryVersoes: NAO_CHAMAR,
          }),
        ),
      );

    // A seção quebrada: erro + retry.
    expect(html).toContain("/visao-geral respondeu 500");
    expect(html).toContain("Tentar de novo");
    // As outras três: dado real, nunca "Carregando…".
    expect(html).toContain("Restaurante do Zé");
    expect(html).toContain("Fulano");
    expect(html).toContain("Tom robótico");
    expect(html).toContain("v1 · PUBLICADA");
    expect(html).not.toContain("Carregando…");
  });

  it("estado 'vazio' é distinto de 'erro' — mostra a frase de vazio, não a de erro nem 'Carregando…'", () => {
    const estado: EstadoSecao<ConversaEmRisco[]> = { fase: "vazio" };
    const html = renderToStaticMarkup(
      React.createElement(SecaoConversasEmRisco, {
        estado,
        ocupado: false,
        onAgir: NAO_CHAMAR,
        onRetry: NAO_CHAMAR,
      }),
    );
    expect(html).toContain("Nenhuma conversa em risco agora.");
    expect(html).not.toContain("Tentar de novo");
    expect(html).not.toContain("Carregando…");
  });
});
