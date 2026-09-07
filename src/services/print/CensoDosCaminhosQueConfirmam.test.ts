/**
 * O CENSO — nenhum caminho novo confirma um pedido sem mandar imprimir.
 *
 * ─── POR QUE UM CENSO, e não mais um teste ──────────────────────────────────
 * O raio-x de 06/09/2026 apontou QUATRO caminhos que confirmavam o pedido sem
 * enfileirar a comanda. Ao consertar, recenseei o repositório inteiro e apareceu
 * uma QUINTA — o pedido por texto no WhatsApp — que ninguém tinha listado.
 *
 * Isso diz o que o problema realmente é: não são cinco defeitos, é a FACILIDADE
 * de escrever o sexto. Confirmar um pedido são três linhas de Prisma; lembrar de
 * mandar imprimir é memória de quem escreve. Consertar os cinco sem trancar a
 * porta é consertar a lista de hoje.
 *
 * Este arquivo lê o código-fonte, acha todo lugar que escreve
 * `status: "CONFIRMED"` num pedido (não num rascunho), e exige que o mesmo
 * arquivo saiba mandar imprimir. Quem criar o sexto caminho reprova aqui, com o
 * nome do arquivo na mensagem.
 *
 * ─── A EXCEÇÃO, nomeada e justificada ───────────────────────────────────────
 * `OrderImportService` cria pedidos CONFIRMED que já aconteceram — importação de
 * histórico do iFood/planilha, de meses atrás. Imprimir seria mandar a cozinha
 * refazer o passado. Exceção nomeada é exceção; exceção silenciosa é defeito.
 *
 * ─── O LIMITE, dito por extenso ─────────────────────────────────────────────
 * Isto lê TEXTO, não executa nada: prova que o arquivo menciona o enfileirador,
 * não que ele o chama no ramo certo. Quem prova o ramo é
 * `CincoCaminhosQueConfirmamImprimem.test.ts`, ao lado. Os dois juntos cobrem o
 * que nenhum dos dois cobre sozinho — e é por isso que existem os dois.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../..");

/** Arquivos que criam pedido CONFIRMED e NÃO devem imprimir. Cada um com o motivo. */
const DISPENSADOS: Record<string, string> = {
  "services/crm/OrderImportService.ts":
    "importa histórico de pedidos que já aconteceram — imprimir mandaria a cozinha refazer o passado",
};

/** Como um arquivo demonstra que sabe mandar imprimir. */
const SABE_IMPRIMIR = /maybeEnqueueOrder|enfileirarComandaDoPagamento/;

/** A escrita que interessa: `…\.order\.(create|update|updateMany|upsert)` acima do status. */
const ESCRITA_PRISMA = /\b(?:tx|prisma|db|client)\.([A-Za-z]+)\.(?:create|createMany|update|updateMany|upsert)\s*\(/g;

function arquivosDeCodigo(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const alvo = path.join(dir, nome);
    if (statSync(alvo).isDirectory()) {
      if (nome === "tests" || nome === "node_modules" || nome === "__mocks__") continue;
      arquivosDeCodigo(alvo, acc);
    } else if (alvo.endsWith(".ts") && !alvo.endsWith(".test.ts") && !alvo.endsWith(".d.ts")) {
      acc.push(alvo);
    }
  }
  return acc;
}

/**
 * Qual modelo do Prisma esta linha está escrevendo? Olha para trás a partir da
 * linha do `status`, até 14 linhas, e devolve o modelo da escrita mais próxima.
 * É assim que `orderDraft.update({ status: "CONFIRMED" })` — que é fechar um
 * rascunho, não confirmar um pedido — fica de fora.
 */
function modeloEscrito(linhas: string[], iStatus: number): string | null {
  const inicio = Math.max(0, iStatus - 14);
  const janela = linhas.slice(inicio, iStatus + 1).join("\n");
  let modelo: string | null = null;
  ESCRITA_PRISMA.lastIndex = 0;
  for (let m = ESCRITA_PRISMA.exec(janela); m; m = ESCRITA_PRISMA.exec(janela)) modelo = m[1];
  return modelo;
}

/** Os arquivos que confirmam um PEDIDO (não um rascunho), com a linha de cada um. */
function caminhosQueConfirmam(): Array<{ relativo: string; linha: number; fonte: string }> {
  const achados: Array<{ relativo: string; linha: number; fonte: string }> = [];
  for (const arquivo of arquivosDeCodigo(RAIZ)) {
    const fonte = readFileSync(arquivo, "utf8");
    if (!fonte.includes('"CONFIRMED"')) continue;
    const linhas = fonte.split("\n");
    for (let i = 0; i < linhas.length; i++) {
      // `.*` de propósito: o `confirm-manual-payment` escreve o status por
      // ternário (`… ? "CONFIRMED" : order.status`). Um regex ancorado no
      // literal deixava justamente a pior das cinco portas fora do censo.
      if (!/status:\s*.*"CONFIRMED"/.test(linhas[i])) continue;
      if (modeloEscrito(linhas, i) !== "order") continue;
      achados.push({ relativo: path.relative(RAIZ, arquivo).replace(/\\/g, "/"), linha: i + 1, fonte });
    }
  }
  return achados;
}

describe("censo dos caminhos que confirmam um pedido", () => {
  it("⭐ todo arquivo que confirma um pedido sabe mandar imprimir", () => {
    const mudos = caminhosQueConfirmam()
      .filter((c) => !(c.relativo in DISPENSADOS))
      .filter((c) => !SABE_IMPRIMIR.test(c.fonte))
      .map((c) => `${c.relativo}:${c.linha}`);

    expect(
      mudos,
      "Estes arquivos colocam um pedido em CONFIRMED e nunca mandam imprimir — " +
        "é o defeito de 06/09/2026 voltando por uma porta nova. Chame " +
        "`enfileirarComandaDoPagamento` (services/print/comandaDoPagamento.ts) no " +
        "mesmo ramo que confirma, ou dispense o arquivo por escrito em DISPENSADOS, " +
        "com o motivo.",
    ).toEqual([]);
  });

  it("o censo enxerga alguma coisa — um censo que não acha nada não prova nada", () => {
    const achados = caminhosQueConfirmam().map((c) => c.relativo);
    // Medido em 07/09/2026: 10 escritas em 10 arquivos. O piso é 8 para não
    // reprovar quando um caminho legítimo for removido — mas se cair abaixo
    // disso, o regex quebrou e o portão virou enfeite.
    expect(new Set(achados).size).toBeGreaterThanOrEqual(8);
  });

  it("fechar um RASCUNHO não conta como confirmar um pedido", () => {
    const linhas = [
      "await tx.orderDraft.update({",
      "  where: { id: draftId },",
      '  data: { status: "CONFIRMED", confirmedAt: new Date() },',
    ];
    expect(modeloEscrito(linhas, 2)).toBe("orderDraft");
  });

  it("confirmar um PEDIDO conta", () => {
    const linhas = [
      "prisma.order.update({",
      "  where: { id: orderId },",
      '  data:  { status: "CONFIRMED" },',
    ];
    expect(modeloEscrito(linhas, 2)).toBe("order");
  });

  it("toda dispensa tem motivo escrito, e o arquivo dispensado existe", () => {
    for (const [relativo, motivo] of Object.entries(DISPENSADOS)) {
      expect(motivo.length, `${relativo} foi dispensado sem motivo`).toBeGreaterThan(30);
      expect(() => statSync(path.join(RAIZ, relativo))).not.toThrow();
    }
  });
});
