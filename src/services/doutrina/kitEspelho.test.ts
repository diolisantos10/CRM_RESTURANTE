/*
 * ─────────────────────────────────────────────────────────────────────────────
 * O PORTÃO DO ESPELHO DA DOUTRINA
 *
 * Espelho que envelhece calado é PIOR que espelho nenhum: dá a sensação de estar
 * em dia. Este arquivo é a trava que impede isso.
 *
 * TODA TRAVA AQUI TEM DUAS METADES, e as duas são obrigatórias:
 *   (1) o caso ruim é barrado;
 *   (2) o caso legítimo PASSA.
 * Sem a segunda, o detector vira carimbo — reprova tudo, ninguém confia, e a
 * primeira pessoa que precisar entregar desliga o teste.
 *
 * As sabotagens são feitas em memória e cada uma AFIRMA, antes de julgar, que o
 * conteúdo sabotado é de fato diferente do sadio. Sabotagem que não entrou no
 * arquivo faz um teste passar por engano e parecer que a trava funciona.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ARQUIVOS_DE_SERVICO,
  CADENCIA_DE_CARIMBO_DIAS,
  CAMINHO_DO_MANIFESTO,
  ESPELHO_INSTALADO,
  FRESCOR_AVISO_DIAS,
  FRESCOR_REPROVA_DIAS,
  MINIMO_DE_ARQUIVOS,
  PASTA_DO_ESPELHO,
  PRAZO_PARA_DECIDIR_A_VISIBILIDADE,
  conferirEspelho,
  conferirEspelhoNoRepo,
  conferirFrescor,
  descreverProblemas,
  destinoDe,
  lerArquivoEspelhado,
  montarArquivoEspelhado,
  planejarEspelho,
  sha256DoCorpo,
  type EntradaDaConferencia,
  type ManifestoDoEspelho,
  type TipoDeProblema,
} from "./kitEspelho";

const RAIZ_DO_REPO = resolve(__dirname, "..", "..", "..");
const COMMIT_FALSO = "a".repeat(40);
const OUTRO_COMMIT = "b".repeat(40);
const AGORA = new Date("2026-08-08T12:00:00.000Z");

const dias = (n: number) => new Date(AGORA.getTime() - n * 86_400_000).toISOString();

// ─── Fábrica de espelho sadio ────────────────────────────────────────────────

function espelhoSadio(quantos = MINIMO_DE_ARQUIVOS + 5, kitCommit = COMMIT_FALSO) {
  const arquivosDoKit = Array.from({ length: quantos }, (_, i) => ({
    origem: `docs/${String(i).padStart(2, "0")}-doutrina.md`,
    conteudo: `# Doutrina ${i}\n\nUma regra qualquer.\n`,
  }));

  const plano = planejarEspelho({
    arquivosDoKit,
    kitCommit,
    kitCommitData: "2026-08-07T23:50:50+00:00",
    manifestoAnterior: null,
    agora: AGORA,
  });

  const conteudoPorDestino = new Map(plano.arquivos.map((a) => [a.destino, a.conteudo]));

  const entrada: EntradaDaConferencia = {
    manifestoBruto: JSON.stringify(plano.manifesto),
    conteudoPorDestino,
    arquivosPresentes: [
      ...conteudoPorDestino.keys(),
      `${PASTA_DO_ESPELHO}/_ESPELHO.json`,
      `${PASTA_DO_ESPELHO}/README.md`,
    ],
    agora: AGORA,
  };

  return { plano, entrada, arquivosDoKit };
}

const tipos = (r: ReturnType<typeof conferirEspelho>): TipoDeProblema[] =>
  r.problemas.map((p) => p.tipo);

// ═══════════════════════════════════════════════════════════════════════════
describe("cabeçalho do espelho — o carimbo de proveniência", () => {
  it("o que foi montado é relido com origem, commit e corpo intactos", () => {
    const corpo = "# Doutrina 7\n\nNão invente o que não está escrito.\n";
    const { conteudo, sha256 } = montarArquivoEspelhado("docs/07-x.md", COMMIT_FALSO, corpo);

    const lido = lerArquivoEspelhado(conteudo);
    expect(lido.ok).toBe(true);
    if (!lido.ok) return;

    expect(lido.campos.origem).toBe("docs/07-x.md");
    expect(lido.campos.kitCommit).toBe(COMMIT_FALSO);
    expect(lido.campos.sha256).toBe(sha256);
    expect(lido.corpo).toBe(corpo);
  });

  it("o cabeçalho diz, em texto que um humano lê, para não editar aqui", () => {
    const { conteudo } = montarArquivoEspelhado("docs/07-x.md", COMMIT_FALSO, "# x\n");
    expect(conteudo).toContain("NÃO EDITE ESTE ARQUIVO");
    expect(conteudo).toContain("dioli-brain-kit");
    expect(conteudo).toContain("docs/07-x.md");
  });

  // A METADE LEGÍTIMA: quebra de linha do Windows não pode reprovar o espelho.
  // Alarme falso por CRLF é o jeito mais rápido de ensinar todo mundo a ignorar
  // este portão.
  it("CRLF não muda o hash — checkout no Windows não vira falso positivo", () => {
    const lf = "# Doutrina\n\nlinha um\nlinha dois\n";
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(crlf).not.toBe(lf);
    expect(sha256DoCorpo(crlf)).toBe(sha256DoCorpo(lf));
  });

  it("arquivo sem a sentinela de cabeçalho é ilegível, não 'provavelmente ok'", () => {
    const lido = lerArquivoEspelhado("# Doutrina escrita à mão\n");
    expect(lido.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("o portão reprova espelho adulterado — e APROVA espelho sadio", () => {
  // ── A metade legítima, primeiro. Se esta cair, todas as outras são inúteis.
  it("espelho recém-gerado e íntegro passa, sem nenhum problema", () => {
    const { entrada } = espelhoSadio();
    const r = conferirEspelho(entrada);
    expect(descreverProblemas(r.problemas)).toBe("(nenhum)");
    expect(r.veredito).toBe("APROVADO");
    expect(r.arquivosConferidos).toBeGreaterThanOrEqual(MINIMO_DE_ARQUIVOS);
  });

  it("edição à mão no corpo reprova, e diz QUAL arquivo", () => {
    const { entrada } = espelhoSadio();
    const alvo = `${PASTA_DO_ESPELHO}/03-doutrina.md`;
    const original = entrada.conteudoPorDestino.get(alvo)!;
    const sabotado = original.replace("Uma regra qualquer.", "Uma regra que eu inventei.");

    // CONFIRMAR QUE A SABOTAGEM ENTROU, antes de julgar o resultado.
    expect(sabotado).not.toBe(original);
    expect(sabotado).toContain("que eu inventei");

    entrada.conteudoPorDestino.set(alvo, sabotado);
    const r = conferirEspelho(entrada);

    expect(r.veredito).toBe("REPROVADO");
    expect(tipos(r)).toContain("EDITADO_A_MAO");
    expect(r.problemas.find((p) => p.tipo === "EDITADO_A_MAO")?.destino).toBe(alvo);
  });

  it("editar o corpo E recalcular o hash do cabeçalho ainda reprova (o manifesto pega)", () => {
    const { entrada } = espelhoSadio();
    const alvo = `${PASTA_DO_ESPELHO}/04-doutrina.md`;
    const original = entrada.conteudoPorDestino.get(alvo)!;

    const lido = lerArquivoEspelhado(original);
    expect(lido.ok).toBe(true);
    if (!lido.ok) return;

    const corpoNovo = "# Doutrina 4\n\nTexto trocado.\n";
    const sabotado = original
      .replace(lido.campos.sha256, sha256DoCorpo(corpoNovo))
      .replace(lido.corpo, corpoNovo);

    expect(sabotado).not.toBe(original);
    expect(sabotado).toContain("Texto trocado.");
    expect(sabotado).toContain(sha256DoCorpo(corpoNovo));

    entrada.conteudoPorDestino.set(alvo, sabotado);
    const r = conferirEspelho(entrada);
    expect(r.veredito).toBe("REPROVADO");
    expect(tipos(r)).toContain("EDITADO_A_MAO");
  });

  it("editar o corpo E o manifesto ainda reprova (o cabeçalho pega)", () => {
    const { plano, entrada } = espelhoSadio();
    const alvo = `${PASTA_DO_ESPELHO}/05-doutrina.md`;
    const original = entrada.conteudoPorDestino.get(alvo)!;

    const lido = lerArquivoEspelhado(original);
    expect(lido.ok).toBe(true);
    if (!lido.ok) return;

    const corpoNovo = "# Doutrina 5\n\nOutro texto.\n";
    const sabotado = original.replace(lido.corpo, corpoNovo);
    expect(sabotado).not.toBe(original);
    expect(sabotado).toContain("Outro texto.");

    const manifestoSabotado: ManifestoDoEspelho = {
      ...plano.manifesto,
      arquivos: plano.manifesto.arquivos.map((e) =>
        e.destino === alvo ? { ...e, sha256: sha256DoCorpo(corpoNovo) } : e,
      ),
    };
    expect(JSON.stringify(manifestoSabotado)).not.toBe(JSON.stringify(plano.manifesto));

    entrada.conteudoPorDestino.set(alvo, sabotado);
    entrada.manifestoBruto = JSON.stringify(manifestoSabotado);

    const r = conferirEspelho(entrada);
    expect(r.veredito).toBe("REPROVADO");
    expect(tipos(r)).toContain("EDITADO_A_MAO");
  });

  it("arquivo do manifesto que sumiu do disco reprova", () => {
    const { entrada } = espelhoSadio();
    const alvo = `${PASTA_DO_ESPELHO}/06-doutrina.md`;
    expect(entrada.conteudoPorDestino.has(alvo)).toBe(true);

    entrada.conteudoPorDestino.delete(alvo);
    entrada.arquivosPresentes = entrada.arquivosPresentes.filter((p) => p !== alvo);
    expect(entrada.conteudoPorDestino.has(alvo)).toBe(false);

    const r = conferirEspelho(entrada);
    expect(r.veredito).toBe("REPROVADO");
    expect(tipos(r)).toContain("ARQUIVO_SUMIU");
  });

  it("documento escrito à mão DENTRO da pasta do espelho reprova como intruso", () => {
    const { entrada } = espelhoSadio();
    const intruso = `${PASTA_DO_ESPELHO}/99-doutrina-que-eu-inventei.md`;
    entrada.arquivosPresentes = [...entrada.arquivosPresentes, intruso];

    const r = conferirEspelho(entrada);
    expect(r.veredito).toBe("REPROVADO");
    expect(tipos(r)).toContain("ARQUIVO_INTRUSO");
    expect(r.problemas.find((p) => p.tipo === "ARQUIVO_INTRUSO")?.destino).toBe(intruso);
  });

  it("`_ESPELHO.json` e `README.md` NÃO são intrusos — são o carimbo", () => {
    const { entrada } = espelhoSadio();
    expect(entrada.arquivosPresentes).toContain(`${PASTA_DO_ESPELHO}/_ESPELHO.json`);
    expect(entrada.arquivosPresentes).toContain(`${PASTA_DO_ESPELHO}/README.md`);
    expect(tipos(conferirEspelho(entrada))).not.toContain("ARQUIVO_INTRUSO");
    expect([...ARQUIVOS_DE_SERVICO].sort()).toEqual(["README.md", "_ESPELHO.json"]);
  });

  it("cabeçalho carimbando outro commit que não o do manifesto reprova", () => {
    const { entrada } = espelhoSadio();
    const alvo = `${PASTA_DO_ESPELHO}/07-doutrina.md`;
    const original = entrada.conteudoPorDestino.get(alvo)!;
    const sabotado = original.replace(COMMIT_FALSO, OUTRO_COMMIT);

    expect(sabotado).not.toBe(original);
    expect(sabotado).toContain(OUTRO_COMMIT);

    entrada.conteudoPorDestino.set(alvo, sabotado);
    const r = conferirEspelho(entrada);
    expect(r.veredito).toBe("REPROVADO");
    expect(tipos(r)).toContain("CARIMBO_DIVERGENTE");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("guardrail 2 aplicado ao espelho — ausência nunca vira aprovação", () => {
  it("manifesto que não existe REPROVA, não é 'nada a verificar'", () => {
    const { entrada } = espelhoSadio();
    entrada.manifestoBruto = null;

    const r = conferirEspelho(entrada);
    expect(r.veredito).toBe("REPROVADO");
    expect(tipos(r)).toEqual(["MANIFESTO_AUSENTE"]);
  });

  it("manifesto ilegível REPROVA", () => {
    const { entrada } = espelhoSadio();
    entrada.manifestoBruto = "{ isto não é json";
    expect(conferirEspelho(entrada).veredito).toBe("REPROVADO");
    expect(tipos(conferirEspelho(entrada))).toEqual(["MANIFESTO_ILEGIVEL"]);
  });

  it("manifesto sem os campos obrigatórios REPROVA", () => {
    const { entrada } = espelhoSadio();
    entrada.manifestoBruto = JSON.stringify({ kitCommit: COMMIT_FALSO });
    expect(tipos(conferirEspelho(entrada))).toEqual(["MANIFESTO_ILEGIVEL"]);
  });

  it("espelho encolhido abaixo do piso REPROVA — clone vazio não passa por 'kit menor'", () => {
    const { plano } = espelhoSadio();
    const poucos = plano.manifesto.arquivos.slice(0, 3);
    const manifesto: ManifestoDoEspelho = { ...plano.manifesto, arquivos: poucos };
    expect(manifesto.arquivos.length).toBeLessThan(MINIMO_DE_ARQUIVOS);

    const conteudoPorDestino = new Map(
      plano.arquivos
        .filter((a) => poucos.some((p) => p.destino === a.destino))
        .map((a) => [a.destino, a.conteudo]),
    );

    const r = conferirEspelho({
      manifestoBruto: JSON.stringify(manifesto),
      conteudoPorDestino,
      arquivosPresentes: [...conteudoPorDestino.keys()],
      agora: AGORA,
    });
    expect(r.veredito).toBe("REPROVADO");
    expect(tipos(r)).toContain("ESPELHO_ENCOLHEU");
  });

  it("o gerador se RECUSA a escrever quando vêm poucos arquivos do kit", () => {
    expect(() =>
      planejarEspelho({
        arquivosDoKit: [{ origem: "docs/01-x.md", conteudo: "# x\n" }],
        kitCommit: COMMIT_FALSO,
        kitCommitData: "2026-08-07T23:50:50+00:00",
        manifestoAnterior: null,
        agora: AGORA,
      }),
    ).toThrow(/abaixo do piso/i);
  });

  it("o gerador se RECUSA a carimbar um commit que não é sha de 40 hex", () => {
    const { arquivosDoKit } = espelhoSadio();
    expect(() =>
      planejarEspelho({
        arquivosDoKit,
        kitCommit: "HEAD",
        kitCommitData: "2026-08-07T23:50:50+00:00",
        manifestoAnterior: null,
        agora: AGORA,
      }),
    ).toThrow(/inválido/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("frescor — o espelho não pode envelhecer calado", () => {
  it("recém-conferido: APROVADO", () => {
    const f = conferirFrescor(dias(0.5), AGORA);
    expect(f.estado).toBe("OK");
  });

  // METADE LEGÍTIMA: entre o aviso e a reprova o time ainda trabalha.
  it(`${FRESCOR_AVISO_DIAS + 1} dias: AVISA e deixa passar`, () => {
    const { entrada, plano } = espelhoSadio();
    entrada.manifestoBruto = JSON.stringify({
      ...plano.manifesto,
      verificadoEm: dias(FRESCOR_AVISO_DIAS + 1),
    });

    const r = conferirEspelho(entrada);
    expect(r.veredito).toBe("AVISO");
    expect(r.problemas).toEqual([]);
    expect(r.frescor?.estado).toBe("AVISO");
  });

  it("exatamente no limite ainda passa — portão não reprova na borda", () => {
    expect(conferirFrescor(dias(FRESCOR_REPROVA_DIAS), AGORA).estado).not.toBe("VENCIDO");
  });

  it(`${FRESCOR_REPROVA_DIAS + 1} dias: REPROVA e trava o CI`, () => {
    const { entrada, plano } = espelhoSadio();
    entrada.manifestoBruto = JSON.stringify({
      ...plano.manifesto,
      verificadoEm: dias(FRESCOR_REPROVA_DIAS + 1),
    });

    const r = conferirEspelho(entrada);
    expect(r.veredito).toBe("REPROVADO");
    expect(tipos(r)).toContain("ESPELHO_VELHO");
    expect(descreverProblemas(r.problemas)).toContain("kit-espelho.yml");
  });

  it("carimbo ilegível é VENCIDO — data que não se lê não é data", () => {
    expect(conferirFrescor("ontem de manhã", AGORA).estado).toBe("VENCIDO");
  });

  it("carimbo no FUTURO é VENCIDO — relógio errado não vira 'está novo'", () => {
    const futuro = new Date(AGORA.getTime() + 30 * 86_400_000).toISOString();
    const f = conferirFrescor(futuro, AGORA);
    expect(f.estado).toBe("VENCIDO");
    expect(f.mensagem).toContain("FUTURO");
  });

  it("a mensagem de reprova carrega a evidência: dias, limite e o que fazer", () => {
    const m = conferirFrescor(dias(40), AGORA).mensagem;
    expect(m).toContain("40.0 dias");
    expect(m).toContain(String(FRESCOR_REPROVA_DIAS));
    expect(m).toContain("kit-espelho.yml");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("cadência de carimbo — o robô diário não pode virar ruído diário", () => {
  it("kit parado e carimbo recente: NÃO renova nada, logo não há commit", () => {
    const { plano } = espelhoSadio();
    const denovo = planejarEspelho({
      arquivosDoKit: espelhoSadio().arquivosDoKit,
      kitCommit: COMMIT_FALSO,
      kitCommitData: "2026-08-07T23:50:50+00:00",
      manifestoAnterior: plano.manifesto,
      agora: new Date(AGORA.getTime() + 86_400_000), // um dia depois
    });

    expect(denovo.mudouConteudo).toBe(false);
    expect(denovo.renovouCarimbo).toBe(false);
    expect(denovo.manifesto.verificadoEm).toBe(plano.manifesto.verificadoEm);
    expect(JSON.stringify(denovo.manifesto)).toBe(JSON.stringify(plano.manifesto));
  });

  it(`kit parado e carimbo com mais de ${CADENCIA_DE_CARIMBO_DIAS} dias: renova só a data`, () => {
    const { plano } = espelhoSadio();
    const depois = new Date(AGORA.getTime() + (CADENCIA_DE_CARIMBO_DIAS + 1) * 86_400_000);
    const denovo = planejarEspelho({
      arquivosDoKit: espelhoSadio().arquivosDoKit,
      kitCommit: COMMIT_FALSO,
      kitCommitData: "2026-08-07T23:50:50+00:00",
      manifestoAnterior: plano.manifesto,
      agora: depois,
    });

    expect(denovo.mudouConteudo).toBe(false);
    expect(denovo.renovouCarimbo).toBe(true);
    expect(denovo.manifesto.verificadoEm).toBe(depois.toISOString());
  });

  it("doutrina alterada no kit: detecta mudança mesmo com o mesmo commit", () => {
    const { plano, arquivosDoKit } = espelhoSadio();
    const alterado = arquivosDoKit.map((a, i) =>
      i === 2 ? { ...a, conteudo: `${a.conteudo}\nParágrafo novo.\n` } : a,
    );
    expect(alterado[2].conteudo).not.toBe(arquivosDoKit[2].conteudo);

    const denovo = planejarEspelho({
      arquivosDoKit: alterado,
      kitCommit: COMMIT_FALSO,
      kitCommitData: "2026-08-07T23:50:50+00:00",
      manifestoAnterior: plano.manifesto,
      agora: AGORA,
    });
    expect(denovo.mudouConteudo).toBe(true);
  });

  it("mapeia origem do kit para destino no repo sem perder de onde veio", () => {
    expect(destinoDe("docs/23-constituicao-dos-essenciais.md")).toBe(
      "docs/kit/23-constituicao-dos-essenciais.md",
    );
    expect(destinoDe("CLAUDE.md")).toBe("docs/kit/CLAUDE.md");
    expect(destinoDe("casos/foocci.md")).toBe("docs/kit/casos/foocci.md");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// O ESPELHO DE VERDADE, deste repositório. Os testes acima provam que a máquina
// funciona; este prova que ela está ligada no que está no disco.
// ═══════════════════════════════════════════════════════════════════════════

function listarDoEspelho(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const cheio = join(dir, e.name);
    if (e.isDirectory()) listarDoEspelho(cheio, out);
    else out.push(relative(RAIZ_DO_REPO, cheio).split(sep).join("/"));
  }
  return out;
}

describe("a decisão pendente não pode virar silêncio", () => {
  // Kit PRIVADO × FOOCCI PÚBLICO. Enquanto o CEO não decide, o espelho pode não
  // estar aqui — mas "não está" tem prazo, e depois dele reprova.

  const semEspelho = (agora: Date): EntradaDaConferencia => ({
    manifestoBruto: null,
    conteudoPorDestino: new Map(),
    arquivosPresentes: [],
    agora,
  });

  it.skipIf(ESPELHO_INSTALADO)(
    "espelho ausente ANTES do prazo: AVISA e deixa passar, com a evidência inteira",
    () => {
      const antes = new Date(PRAZO_PARA_DECIDIR_A_VISIBILIDADE.getTime() - 86_400_000);
      const r = conferirEspelhoNoRepo(semEspelho(antes));

      expect(r.veredito).toBe("AVISO");
      expect(r.frescor?.mensagem).toContain("PRIVADO");
      expect(r.frescor?.mensagem).toContain("PÚBLICO");
      expect(r.frescor?.mensagem).toContain("04-seguranca.md");
    },
  );

  it.skipIf(ESPELHO_INSTALADO)(
    "espelho ausente DEPOIS do prazo: REPROVA — 'ainda não' tem validade",
    () => {
      const depois = new Date(PRAZO_PARA_DECIDIR_A_VISIBILIDADE.getTime() + 86_400_000);
      const r = conferirEspelhoNoRepo(semEspelho(depois));

      expect(r.veredito).toBe("REPROVADO");
      expect(tipos(r)).toEqual(["DECISAO_DE_VISIBILIDADE_VENCIDA"]);
    },
  );

  it("espelho PRESENTE é conferido por inteiro, prazo ou não — a graça não vira buraco", () => {
    const { entrada } = espelhoSadio();
    const alvo = `${PASTA_DO_ESPELHO}/08-doutrina.md`;
    const original = entrada.conteudoPorDestino.get(alvo)!;
    const sabotado = original.replace("Uma regra qualquer.", "Regra adulterada.");
    expect(sabotado).not.toBe(original);
    entrada.conteudoPorDestino.set(alvo, sabotado);

    // Bem dentro do prazo: mesmo assim reprova, porque o manifesto existe.
    entrada.agora = new Date(PRAZO_PARA_DECIDIR_A_VISIBILIDADE.getTime() - 10 * 86_400_000);
    const r = conferirEspelhoNoRepo(entrada);
    expect(r.veredito).toBe("REPROVADO");
    expect(tipos(r)).toContain("EDITADO_A_MAO");
  });

  it.runIf(ESPELHO_INSTALADO)(
    "com ESPELHO_INSTALADO ligado, sumiço do manifesto reprova na hora",
    () => {
      // Metade que só vale depois que o CEO ligar o espelho. Fica escrita agora
      // para que ligar seja trocar `false` por `true`, e não redesenhar o portão.
      const r = conferirEspelhoNoRepo(semEspelho(new Date()));
      expect(r.veredito).toBe("REPROVADO");
      expect(tipos(r)).toEqual(["MANIFESTO_AUSENTE"]);
    },
  );
});

describe("o espelho que está no disco deste repositório", () => {
  const pasta = join(RAIZ_DO_REPO, PASTA_DO_ESPELHO);
  const caminhoManifesto = join(RAIZ_DO_REPO, CAMINHO_DO_MANIFESTO);

  it.runIf(existsSync(join(RAIZ_DO_REPO, CAMINHO_DO_MANIFESTO)))(
    "se a pasta existe, ela está declarada como instalada",
    () => {
      // Espelho no disco sem `ESPELHO_INSTALADO = true` deixaria o período de
      // graça aberto para sempre — o buraco pelo qual um espelho apagado passaria
      // despercebido. Ou os dois estão ligados, ou os dois estão desligados.
      if (!existsSync(caminhoManifesto)) return;
      expect(
        ESPELHO_INSTALADO,
        `\`${PASTA_DO_ESPELHO}/\` está no repositório mas \`ESPELHO_INSTALADO\` ainda é ` +
          `\`false\`. Vire a constante em src/services/doutrina/kitEspelho.ts no mesmo commit.`,
      ).toBe(true);
    },
  );

  it("passa na conferência completa: íntegro, carimbado e dentro do prazo", () => {
    const arquivosPresentes = existsSync(pasta) ? listarDoEspelho(pasta) : [];
    const conteudoPorDestino = new Map(
      arquivosPresentes
        .filter((p) => !ARQUIVOS_DE_SERVICO.has(p.slice(PASTA_DO_ESPELHO.length + 1)))
        .map((p) => [p, readFileSync(join(RAIZ_DO_REPO, p), "utf8")]),
    );

    const r = conferirEspelhoNoRepo({
      manifestoBruto: existsSync(caminhoManifesto)
        ? readFileSync(caminhoManifesto, "utf8")
        : null,
      conteudoPorDestino,
      arquivosPresentes,
      agora: new Date(),
    });

    // AVISO grita em TODA execução do CI. É o oposto de "passou calado": o
    // portão deixa trabalhar e não deixa esquecer.
    if (r.veredito === "AVISO") {
      console.warn(`\n[ESPELHO DA DOUTRINA] ${r.frescor?.mensagem}\n`);
    }

    expect(
      r.veredito,
      `O espelho da doutrina reprovou. Conferidos: ${r.arquivosConferidos} arquivo(s).\n` +
        `${descreverProblemas(r.problemas)}\n\n` +
        `Como consertar: dispare o workflow "Espelho da doutrina", ou rode\n` +
        `  git clone --depth 1 https://github.com/diolisantos10/dioli-brain-kit.git /tmp/kit\n` +
        `  KIT_DIR=/tmp/kit npx ts-node --project tsconfig.scripts.json scripts/espelhar-kit.ts\n` +
        `Se o workflow está falhando por falta do segredo, isso é decisão do CEO — ` +
        `veja o cabeçalho de .github/workflows/kit-espelho.yml.`,
    ).not.toBe("REPROVADO");
  });

  it.runIf(existsSync(join(RAIZ_DO_REPO, CAMINHO_DO_MANIFESTO)))(
    "se há espelho, a constituição dos Essenciais está nele e legível",
    () => {
      // Este agente é um dos cinco Essenciais e a doutrina 23 é a constituição
      // dele. Se ela some do espelho, o especialista perde a própria régua.
      if (!existsSync(caminhoManifesto)) return;

      const alvo = join(RAIZ_DO_REPO, PASTA_DO_ESPELHO, "23-constituicao-dos-essenciais.md");
      expect(existsSync(alvo)).toBe(true);

      const lido = lerArquivoEspelhado(readFileSync(alvo, "utf8"));
      expect(lido.ok).toBe(true);
      if (!lido.ok) return;
      expect(lido.campos.origem).toBe("docs/23-constituicao-dos-essenciais.md");
      expect(lido.corpo).toContain("Constituição dos Essenciais");
    },
  );
});
