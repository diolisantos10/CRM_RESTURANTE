/**
 * O AFERIDOR DOS ESTÁGIOS — e por que o que já existia não aferia nada.
 *
 * ── O DEFEITO DE MÉTODO ─────────────────────────────────────────────────────
 *
 * `rotulosDaSala.test.ts` confere se todo estágio tem rótulo, e a fonte que ele
 * usa é `TODAS_AS_ETAPAS` — uma lista **digitada à mão** em `foocciCrmFunnel.ts`
 * como cópia do enum do Prisma.
 *
 * Isso confere uma cópia contra outra cópia. No dia em que o `schema.prisma`
 * ganha um estágio novo e ninguém atualiza `FoocciLeadStage`, os dois mapas
 * continuam casando perfeitamente entre si, o teste fica verde, e o estágio novo
 * simplesmente **não existe** para a Sala: some do seletor, some do Kanban, e um
 * lead nele não aparece em tela nenhuma.
 *
 * Foi o que quase aconteceu em 10/09/2026 com `DISPONIVEL_PARA_PROSPECCAO` e
 * `RESPONDEU`. Quem pegou foi o TypeScript, por acaso, e não o teste — e "por
 * acaso" não é portão.
 *
 * Doutrina da casa (D-0D8): **aferidor que lê a mesma fonte que confere é
 * espelho, não aferidor.** Este arquivo lê o enum do Prisma, que é externo aos
 * dois mapas — a única fonte que o banco realmente obedece.
 */

import { describe, it, expect } from "vitest";
import { $Enums } from "@prisma/client";
import {
  TODAS_AS_ETAPAS,
  ROTULO_ETAPA,
  DESCRICAO_ETAPA,
} from "@/services/foocci-crm/foocciCrmFunnel";
import { ROTULO_CURTO } from "./rotulosDaSala";

/** O que o BANCO aceita. Não é opinião de nenhum arquivo de tela. */
const DO_BANCO = Object.values($Enums.SiteLeadStage);

describe("os estágios da Sala batem com os do banco", () => {
  it("a sonda de controle: o enum do Prisma foi mesmo lido", () => {
    // Sem isto, um `$Enums` vazio (import quebrado, cliente não gerado) faria
    // todos os testes abaixo passarem por vacuidade — comparar duas listas
    // vazias dá certo sempre, e é a pior forma de verde.
    expect(DO_BANCO.length).toBeGreaterThanOrEqual(11);
    expect(DO_BANCO).toContain("GANHO");
  });

  it("⭐ nenhum estágio do banco fica de fora da lista da Sala", () => {
    const naSala = new Set<string>(TODAS_AS_ETAPAS);
    const faltando = DO_BANCO.filter((e) => !naSala.has(e));

    expect(
      faltando,
      `estes estágios existem no banco e a Sala não conhece: ${faltando.join(", ")}. ` +
        "Um lead neles não aparece em tela nenhuma.",
    ).toEqual([]);
  });

  it("⛔ e a Sala não inventa estágio que o banco recusa", () => {
    // A direção oposta importa tanto quanto: um estágio que só existe no código
    // vira uma opção no seletor que o Postgres rejeita na hora de salvar — erro
    // que só aparece para o vendedor, no meio do atendimento.
    const noBanco = new Set<string>(DO_BANCO);
    const inventados = TODAS_AS_ETAPAS.filter((e) => !noBanco.has(e));

    expect(
      inventados,
      `a Sala oferece estágios que o banco não aceita: ${inventados.join(", ")}`,
    ).toEqual([]);
  });

  it("todo estágio do banco tem rótulo longo, curto e descrição", () => {
    const sem = DO_BANCO.filter(
      (e) =>
        !ROTULO_ETAPA[e as keyof typeof ROTULO_ETAPA] ||
        !ROTULO_CURTO[e as keyof typeof ROTULO_CURTO] ||
        !DESCRICAO_ETAPA[e as keyof typeof DESCRICAO_ETAPA],
    );

    expect(sem, `estágios sem texto de tela: ${sem.join(", ")}`).toEqual([]);
  });

  it("os dois estágios novos existem, e com o significado que motivou cada um", () => {
    // Nomear os dois aqui é de propósito: se alguém os remover por engano numa
    // limpeza futura, o teste diz exatamente o que se perdeu e por quê.
    expect(DO_BANCO).toContain("DISPONIVEL_PARA_PROSPECCAO");
    expect(DO_BANCO).toContain("RESPONDEU");

    // `RESPONDEU` precisa vir ANTES de `EM_QUALIFICACAO` na régua: ele é o vão
    // entre "falou de volta" e "estamos qualificando", e é nele que o lead
    // esfria. Depois, seria só um sinônimo de qualificação.
    const ordem = TODAS_AS_ETAPAS.indexOf("RESPONDEU");
    const qualificacao = TODAS_AS_ETAPAS.indexOf("EM_QUALIFICACAO");
    expect(ordem).toBeGreaterThanOrEqual(0);
    expect(ordem).toBeLessThan(qualificacao);
  });
});
