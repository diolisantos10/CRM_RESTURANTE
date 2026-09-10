/**
 * A RÉGUA DA MATRIZ DE VERDADE.
 *
 * ── O QUE ESTE ARQUIVO PRECISA IMPEDIR ──────────────────────────────────────
 *
 * A matriz é uma afirmação escrita à mão: "este arquivo executa esta ficha".
 * Afirmação escrita à mão apodrece — alguém renomeia `abordar.ts`, alguém apaga
 * um chamador, alguém acrescenta uma ficha e copia o bloco da ficha de cima com
 * o executor junto. Nada disso quebra o build, e a tela continua afirmando com a
 * mesma confiança de antes.
 *
 * ── E POR QUE METADE DOS TESTES AQUI MEXE NOS DADOS DE PROPÓSITO ────────────
 *
 * Um teste que só confere a matriz de hoje passa para sempre — inclusive no dia
 * em que a checagem parar de checar. Régua que só confirma o que já está certo
 * não é régua: é um carimbo.
 *
 * Então cada invariante é escrita como uma FUNÇÃO de conferência, e é conferida
 * duas vezes: contra a matriz real (tem que passar) e contra uma matriz
 * adulterada de propósito (tem que reprovar). O segundo caso é o que prova que a
 * régua mede.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { fichasComerciais } from "./agentesComerciais";
import {
  matrizDeVerdade,
  contarAVerdade,
  caminhosAfirmados,
  NADA_MEDIDO,
  type LinhaDaMatriz,
  type LeituraDoRuntime,
} from "./matrizDeVerdade";

const RAIZ = process.cwd();
const fichas = fichasComerciais(RAIZ);
const matriz = matrizDeVerdade(fichas);

/** Um clone raso e editável de uma linha, para as sondas de adulteração. */
function adulterar(numero: string, patch: Partial<LinhaDaMatriz>): LinhaDaMatriz[] {
  return matriz.map((l) => (l.ficha.numero === numero ? { ...l, ...patch } : l));
}

// ─── As conferências, isoladas para poderem ser viradas contra dados falsos ──

/** Ficha sem executor não pode ter modelo. Devolve os números que violam. */
function semExecutorMasComModelo(linhas: LinhaDaMatriz[]): string[] {
  return linhas
    .filter((l) => l.executorReal === null && l.modeloReal !== null)
    .map((l) => l.ficha.numero);
}

/** Cargo humano não tem runtime, nem próprio nem emprestado. */
function humanaComRuntime(linhas: LinhaDaMatriz[]): string[] {
  return linhas
    .filter(
      (l) =>
        l.modoDeclarado === "HUMANO" &&
        (l.executorReal !== null ||
          l.executadaPor !== null ||
          l.agentId !== null ||
          l.modeloReal !== null ||
          l.killSwitch.onde !== null),
    )
    .map((l) => l.ficha.numero);
}

/** Todo caminho afirmado tem que existir no disco. */
function caminhosQueNaoExistem(linhas: LinhaDaMatriz[]): string[] {
  const quebrados: string[] = [];
  for (const l of linhas) {
    for (const c of [l.executorReal, l.provaDeExecucao, ...l.outrosChamadores]) {
      if (c && !existsSync(path.join(RAIZ, c))) quebrados.push(`${l.ficha.numero}: ${c}`);
    }
  }
  return quebrados;
}

/** Quem tem executor tem que ter prova de que alguém o chama em produção. */
function comExecutorSemProva(linhas: LinhaDaMatriz[]): string[] {
  return linhas
    .filter((l) => l.executorReal !== null && l.provaDeExecucao === null)
    .map((l) => l.ficha.numero);
}

/** Postura aponta para uma ficha que existe e que de fato tem runtime. */
function posturaOrfa(linhas: LinhaDaMatriz[]): string[] {
  const comRuntime = new Set(
    linhas.filter((l) => l.executorReal !== null).map((l) => l.ficha.numero),
  );
  return linhas
    .filter((l) => l.executadaPor !== null && !comRuntime.has(l.executadaPor))
    .map((l) => `${l.ficha.numero} → ${l.executadaPor}`);
}

// ─── O retrato de hoje ────────────────────────────────────────────────────────

describe("a matriz cobre o catálogo", () => {
  it("tem uma linha por ficha comercial, e são nove", () => {
    expect(matriz).toHaveLength(fichas.length);
    expect(matriz).toHaveLength(9);
  });

  it("conta duas inteligências com runtime, e não nove", () => {
    const c = contarAVerdade(matriz);
    expect(c.fichas).toBe(9);
    // O número que o CEO precisa ver. Se ele mudar, alguém construiu ou apagou
    // um runtime — e essa é uma notícia, não um detalhe de teste.
    expect(c.comRuntime).toBe(2);
    expect(c.posturas).toBe(2);
    // Só o TA usa modelo. A Abordagem dispara template da Meta.
    expect(c.usamModelo).toBe(1);
  });

  it("as duas com runtime são a Abordagem (1.2) e o TA (1.5)", () => {
    const comRuntime = matriz.filter((l) => l.executorReal !== null).map((l) => l.ficha.numero);
    expect(comRuntime.sort()).toEqual(["1.2", "1.5"]);
  });

  it("Recepção e Qualificação não somem da lista e apontam para o 1.5", () => {
    for (const numero of ["1.3", "1.4"]) {
      const l = matriz.find((x) => x.ficha.numero === numero)!;
      expect(l, numero).toBeDefined();
      expect(l.executorReal, numero).toBeNull();
      expect(l.executadaPor, numero).toBe("1.5");
      expect(l.estadoAtual.codigo, numero).toBe("POSTURA_DE_OUTRO_RUNTIME");
    }
  });

  it("o kill switch do TA é SdrIaConfig.ligado, e diz qual NÃO é", () => {
    const ta = matriz.find((l) => l.ficha.numero === "1.5")!;
    expect(ta.killSwitch.onde).toContain("SdrIaConfig.ligado");
    // A confusão entre os dois é o defeito. Se alguém apagar esta frase, o teste
    // cai — porque a frase é o remédio, não um comentário.
    expect(ta.killSwitch.naoConfundirCom).toContain("isRuntimeEnabled");
  });

  it("a Abordagem não tem modelo, e o null é declarado e não esquecido", () => {
    const ab = matriz.find((l) => l.ficha.numero === "1.2")!;
    expect(ab.executorReal).toBe("src/services/salaDeVendas/abordar.ts");
    expect(ab.modeloReal).toBeNull();
    expect(ab.agentId).toBeNull();
    expect(ab.promptOuPolitica).toContain("Meta");
  });

  it("sem leitura do banco, nenhum estado é afirmado como desligado", () => {
    const semMedir = matrizDeVerdade(fichas, NADA_MEDIDO);
    for (const l of semMedir.filter((x) => x.executorReal !== null)) {
      expect(l.estadoAtual.codigo, l.ficha.numero).toBe("NAO_MEDIDO");
      expect(l.killSwitch.ligado, l.ficha.numero).toBeNull();
    }
  });
});

// ─── As invariantes, contra a matriz real ─────────────────────────────────────

describe("as invariantes valem hoje", () => {
  it("toda ficha sem executor tem executorReal e modeloReal nulos", () => {
    for (const l of matriz.filter((x) => x.executorReal === null)) {
      expect(l.executorReal, l.ficha.numero).toBeNull();
      expect(l.modeloReal, l.ficha.numero).toBeNull();
    }
    expect(semExecutorMasComModelo(matriz)).toEqual([]);
  });

  it("nenhum cargo humano tem runtime", () => {
    expect(humanaComRuntime(matriz)).toEqual([]);
  });

  it("todo caminho afirmado existe no disco", () => {
    expect(caminhosQueNaoExistem(matriz)).toEqual([]);
  });

  it("quem tem executor tem prova de chamador de produção", () => {
    expect(comExecutorSemProva(matriz)).toEqual([]);
  });

  it("nenhuma postura aponta para uma ficha sem runtime", () => {
    expect(posturaOrfa(matriz)).toEqual([]);
  });

  it("a lista completa de caminhos afirmados existe no disco", () => {
    // `caminhosAfirmados` inclui afirmações de fichas que talvez nem estejam no
    // catálogo lido. É de propósito: uma afirmação órfã apodrece calada.
    const quebrados = caminhosAfirmados().filter((c) => !existsSync(path.join(RAIZ, c)));
    expect(quebrados).toEqual([]);
  });
});

// ─── ⭐ As sondas: a régua reprova quando alguém mente? ───────────────────────

describe("a régua reprova a mentira (sondas de adulteração)", () => {
  it("REPROVA quando uma ficha humana é marcada com runtime", () => {
    // 1.6 SDR Humano ganha um executor, como se alguém tivesse copiado o bloco
    // do TA. É o erro mais fácil de cometer nesta matriz.
    const falsa = adulterar("1.6", {
      executorReal: "src/services/salaDeVendas/ta/atender.ts",
      agentId: "sdr-ta-foocci",
    });
    expect(humanaComRuntime(falsa)).toContain("1.6");
    expect(humanaComRuntime(falsa)).not.toEqual([]);
  });

  it("REPROVA quando um cargo humano vira postura de outro runtime", () => {
    // A tentação registrada na própria matriz: o Closer (1.8) é humano, e o TA
    // tem postura de fechamento. Apontar `executadaPor` aqui marcaria a ficha
    // humana como tendo runtime.
    const falsa = adulterar("1.8", { executadaPor: "1.5" });
    expect(humanaComRuntime(falsa)).toContain("1.8");
  });

  it("REPROVA quando provaDeExecucao aponta para arquivo inexistente", () => {
    const falsa = adulterar("1.5", {
      provaDeExecucao: "src/services/foocci-sdr/FoocciSalesInboundQueNaoExiste.ts",
    });
    const quebrados = caminhosQueNaoExistem(falsa);
    expect(quebrados).toHaveLength(1);
    expect(quebrados[0]).toContain("1.5");
  });

  it("REPROVA quando o executor aponta para arquivo inexistente", () => {
    const falsa = adulterar("1.2", { executorReal: "src/services/salaDeVendas/abordarr.ts" });
    expect(caminhosQueNaoExistem(falsa)).not.toEqual([]);
  });

  it("REPROVA quando um chamador secundário some do disco", () => {
    const falsa = adulterar("1.2", {
      outrosChamadores: ["src/app/api/cron/prospeccao/rodada/route-apagada.ts"],
    });
    expect(caminhosQueNaoExistem(falsa)).not.toEqual([]);
  });

  it("REPROVA quando uma ficha sem executor ganha modelo", () => {
    // O defeito nomeado no cabeçalho da matriz: `null` virando "gpt-4o-mini"
    // porque a ficha parece um agente de IA.
    const falsa = adulterar("1.3", { modeloReal: "OPENAI/gpt-4o-mini" });
    expect(semExecutorMasComModelo(falsa)).toEqual(["1.3"]);
  });

  it("REPROVA quando um executor é declarado sem chamador de produção", () => {
    const falsa = adulterar("1.5", { provaDeExecucao: null });
    expect(comExecutorSemProva(falsa)).toEqual(["1.5"]);
  });

  it("REPROVA quando uma postura aponta para uma ficha que não tem runtime", () => {
    const falsa = adulterar("1.3", { executadaPor: "1.9" });
    expect(posturaOrfa(falsa)).toContain("1.3 → 1.9");
  });
});

// ─── O estado, quando há leitura ──────────────────────────────────────────────

describe("o estado sai do que foi medido, nunca do que parece", () => {
  const medido = (p: Partial<LeituraDoRuntime>): LeituraDoRuntime => ({
    ...NADA_MEDIDO,
    ...p,
  });

  it("TA ligado sem versão publicada não é 'ligado'", () => {
    const linhas = matrizDeVerdade(
      fichas,
      medido({ taLigado: true, taTemVersaoPublicada: false }),
    );
    const ta = linhas.find((l) => l.ficha.numero === "1.5")!;
    // Ligar exige versão publicada, e sem ela o TA fica calado. Dizer "ligado"
    // aqui mandaria alguém esperar resposta de um agente mudo.
    expect(ta.estadoAtual.codigo).toBe("DESLIGADO");
  });

  it("TA ligado e com versão, mas sem as chaves de envio, sai MUDO", () => {
    const linhas = matrizDeVerdade(
      fichas,
      medido({
        taLigado: true,
        taTemVersaoPublicada: true,
        canalEnvia: false,
        iaRespondeSozinha: false,
        modeloDoTA: "OPENAI/gpt-4o-mini",
      }),
    );
    const ta = linhas.find((l) => l.ficha.numero === "1.5")!;
    expect(ta.estadoAtual.codigo).toBe("LIGADO_MAS_MUDO");
    expect(ta.estadoAtual.frase).toContain("FOOCCI_SDR_SEND_ENABLED");
    expect(ta.estadoAtual.frase).toContain("FOOCCI_SDR_IA_RESPONDE_SOZINHA");
    expect(ta.modeloReal).toBe("OPENAI/gpt-4o-mini");
  });

  it("o modelo medido só chega em quem tem chamada de modelo", () => {
    const linhas = matrizDeVerdade(fichas, medido({ modeloDoTA: "OPENAI/gpt-4o-mini" }));
    const comModelo = linhas.filter((l) => l.modeloReal !== null).map((l) => l.ficha.numero);
    // Uma só. A leitura do roteador não pode vazar para as outras oito.
    expect(comModelo).toEqual(["1.5"]);
  });

  it("a Abordagem acompanha o canal, e não o interruptor do TA", () => {
    const linhas = matrizDeVerdade(
      fichas,
      medido({ taLigado: false, taTemVersaoPublicada: false, canalEnvia: true }),
    );
    const ab = linhas.find((l) => l.ficha.numero === "1.2")!;
    expect(ab.estadoAtual.codigo).toBe("LIGADO");
    expect(ab.killSwitch.ligado).toBe(true);
  });

  it("cargo humano nunca sai como ligado, mesmo com tudo medido ligado", () => {
    const linhas = matrizDeVerdade(
      fichas,
      medido({
        taLigado: true,
        taTemVersaoPublicada: true,
        canalEnvia: true,
        iaRespondeSozinha: true,
        modeloDoTA: "OPENAI/gpt-4o-mini",
      }),
    );
    for (const l of linhas.filter((x) => x.modoDeclarado === "HUMANO")) {
      expect(l.estadoAtual.codigo, l.ficha.numero).toBe("SEM_RUNTIME");
      expect(l.killSwitch.ligado, l.ficha.numero).toBeNull();
      expect(l.modeloReal, l.ficha.numero).toBeNull();
    }
  });
});
