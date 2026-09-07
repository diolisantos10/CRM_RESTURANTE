/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ESPELHO DA DOUTRINA — a lógica pura, compartilhada pelo gerador e pelo portão.
 *
 * POR QUE ISTO EXISTE, com o fato que originou (08/08/2026):
 *
 *   Uma sessão de Diretor só enxerga os repositórios anexados **na abertura**. O
 *   `dioli-brain-kit` é repositório separado. O Diretor do CityJobs abriu sem ele,
 *   tentou API, git e raw — todos negados — e trabalhou o dia inteiro sem a
 *   doutrina. Anexar depois não entra em sessão que já está rodando.
 *
 *   A saída é um ESPELHO dentro do próprio repositório: o Diretor lê `docs/kit/`
 *   do repo dele, sem depender de anexo.
 *
 * O QUE ESTE ARQUIVO **NÃO** É: uma cópia da doutrina. Ele não contém regra
 * nenhuma. Ele contém a máquina que garante que o espelho seja espelho — carimbo
 * de origem, prova de que ninguém editou à mão, e prazo de validade.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A REGRA QUE MANDA AQUI: "sem portão = reprovado" (CLAUDE.md, guardrail 2).
 *
 * Por isso `conferirEspelho` **nunca** devolve "sem opinião". Manifesto ausente,
 * ilegível ou encolhido é REPROVADO, não "nada a verificar". Espelho que
 * envelhece calado é pior que espelho nenhum: dá a sensação de estar em dia.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash } from "node:crypto";

// ─── Constantes de identidade ────────────────────────────────────────────────

export const KIT_REPO = "diolisantos10/dioli-brain-kit";
export const KIT_BRANCH = "main";

/** Pasta do espelho, relativa à raiz do repositório. GERADA — nunca editada à mão. */
export const PASTA_DO_ESPELHO = "docs/kit";

/** O carimbo de versão. Legível por humano e por máquina. */
export const CAMINHO_DO_MANIFESTO = `${PASTA_DO_ESPELHO}/_ESPELHO.json`;

/** Arquivos da pasta do espelho que NÃO são documentos espelhados. */
export const ARQUIVOS_DE_SERVICO = new Set(["_ESPELHO.json", "README.md"]);

/**
 * O segredo que o workflow precisa para clonar o kit.
 *
 * ⚠️ ESTE SEGREDO **NÃO EXISTE** no repositório em 08/08/2026. O nome está aqui
 * porque o workflow precisa referenciar algum nome; ele NÃO é uma afirmação de
 * que o segredo foi criado. Enquanto ele não existir, o workflow reprova alto e
 * claro no primeiro passo — nunca "passa" sem espelhar.
 */
export const SEGREDO_NECESSARIO = "DIOLI_BRAIN_KIT_TOKEN";

// ─── Os três prazos, e por que cada número é este ────────────────────────────

/**
 * De quanto em quanto tempo o gerador reescreve o carimbo `verificadoEm` quando
 * o kit **não mudou**.
 *
 * Não pode ser diário: commit todo dia num arquivo de docs é o ruído que faz
 * ninguém olhar (ordem explícita do CEO). Não pode ser nunca: aí "última
 * verificação" vira "última mudança do kit", que é outro fato — e o portão
 * reprovaria um espelho perfeitamente correto só porque a doutrina ficou parada.
 * Três dias dá ~10 commits/mês, cada um com `[skip ci]`.
 */
export const CADENCIA_DE_CARIMBO_DIAS = 3;

/** Acima disto o portão AVISA (passa, mas grita no console). */
export const FRESCOR_AVISO_DIAS = 7;

/**
 * Acima disto o portão REPROVA e trava o CI.
 *
 * 14 dias = ~4,6x a cadência de carimbo. Folga suficiente para fim de semana,
 * feriado, GitHub degradado e uma semana de férias — e curta o bastante para que
 * a doutrina não fique meio mês defasada sem ninguém saber.
 *
 * ⚠️ CONSEQUÊNCIA ASSUMIDA, dita antes de acontecer: como o CI roda `vitest` em
 * todo PR, um espelho parado há 14 dias **trava todos os PRs**. Isso é de
 * propósito — é o que transforma "o robô do espelho está quebrado" de silêncio
 * em fato inescapável. Para destravar: rode o gerador e commite, ou corrija o
 * workflow. Não existe "ignorar por enquanto", e é esse o ponto.
 */
export const FRESCOR_REPROVA_DIAS = 14;

/**
 * Piso de arquivos no espelho.
 *
 * O TRAP QUE ISTO FECHA: se o clone do kit falhar de um jeito silencioso (token
 * expirado que devolve repo vazio, branch renomeada, filtro que não casa nada), o
 * gerador varreria zero arquivos, apagaria o espelho inteiro e commitaria uma
 * exclusão com aparência de sucesso. Portão que aprova por omissão é P0.
 * O kit tinha 30 documentos em 07/08/2026; 20 é um piso com folga para o kit
 * encolher de verdade sem virar alarme falso.
 */
export const MINIMO_DE_ARQUIVOS = 20;

// ─── A decisão que ainda não foi tomada ──────────────────────────────────────
/*
 * ⚠️ ACHADO DE 08/08/2026, DURANTE A CONSTRUÇÃO — muda a natureza do bloco.
 *
 *   `dioli-brain-kit`        → private: true
 *   `diolisantos10/FOOCCI`   → visibility: "public"
 *
 * Espelhar o kit aqui **publica a doutrina inteira da companhia num repositório
 * aberto**: a escada de governança, o processo de cofre de credencial, o
 * histórico de incidentes (que cita cliente real pelo nome) e o quadro de quem
 * está vivo. Nenhum segredo literal — varri e não achei token, chave nem URL de
 * banco —, mas método e histórico interno não deixam de ser exposição.
 *
 * E o próprio kit proíbe: `docs/04-seguranca.md`, "Higiene operacional" —
 * *"Repos do kit e dos produtos: **privados**."*
 *
 * Isso é irreversível (histórico público, fork, índice de busca) e é decisão de
 * dono. Não é do especialista, não é do Diretor. Por isso o espelho vem
 * construído, provado e **não ligado**: quem aperta o botão é o CEO.
 */

/**
 * Vire para `true` **no mesmo commit** que trouxer `docs/kit/` para o
 * repositório. A partir daí, espelho ausente vira reprovação imediata, sem
 * período de graça — não há mais decisão pendente para justificar a ausência.
 */
export const ESPELHO_INSTALADO = true;

/**
 * Até quando "o espelho ainda não está aqui" é uma resposta aceitável.
 *
 * Existe porque a alternativa é pior: se a ausência do espelho simplesmente
 * passasse, a decisão pendente viraria silêncio e daqui a três meses ninguém
 * lembraria que existiu um piloto. Prazo é o que transforma "ainda não" em
 * "alguém precisa responder". Duas semanas a partir de 08/08/2026.
 */
export const PRAZO_PARA_DECIDIR_A_VISIBILIDADE = new Date("2026-08-22T00:00:00.000Z");

// ─── Formato do cabeçalho ────────────────────────────────────────────────────

/**
 * Linha sentinela que separa cabeçalho de conteúdo. Tudo abaixo dela é conteúdo
 * do kit, byte por byte, e é só isso que entra no hash.
 */
export const MARCA_FIM_DO_CABECALHO =
  "<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->";

const RE_SHA40 = /^[0-9a-f]{40}$/;
const RE_SHA256 = /^[0-9a-f]{64}$/;

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface EntradaDoManifesto {
  /** Caminho no ESTE repositório, ex.: `docs/kit/23-constituicao-dos-essenciais.md` */
  destino: string;
  /** Caminho no KIT, ex.: `docs/23-constituicao-dos-essenciais.md` */
  origem: string;
  /** sha256 do corpo (só o conteúdo do kit, sem cabeçalho). */
  sha256: string;
}

export interface ManifestoDoEspelho {
  kitRepo: string;
  kitBranch: string;
  /** Commit do kit que gerou este espelho. 40 hex. */
  kitCommit: string;
  /** Data do commit do kit, ISO. */
  kitCommitData: string;
  /** Quando o espelho foi conferido pela última vez com sucesso. ISO. */
  verificadoEm: string;
  /** Quem gerou. Existe para o leitor saber onde reclamar. */
  geradoPor: string;
  arquivos: EntradaDoManifesto[];
}

export interface CamposDoCabecalho {
  origem: string;
  kitCommit: string;
  sha256: string;
}

export type LeituraDeArquivo =
  | { ok: true; campos: CamposDoCabecalho; corpo: string }
  | { ok: false; motivo: string };

export type TipoDeProblema =
  | "MANIFESTO_AUSENTE"
  | "MANIFESTO_ILEGIVEL"
  | "CARIMBO_INVALIDO"
  | "ESPELHO_ENCOLHEU"
  | "ARQUIVO_SUMIU"
  | "CABECALHO_ILEGIVEL"
  | "ORIGEM_DIVERGENTE"
  | "CARIMBO_DIVERGENTE"
  | "EDITADO_A_MAO"
  | "ARQUIVO_INTRUSO"
  | "ESPELHO_VELHO"
  | "DECISAO_DE_VISIBILIDADE_VENCIDA";

export interface Problema {
  tipo: TipoDeProblema;
  destino?: string;
  detalhe: string;
}

export type EstadoDeFrescor = "OK" | "AVISO" | "VENCIDO";

export interface Frescor {
  estado: EstadoDeFrescor;
  diasDeIdade: number;
  mensagem: string;
}

export interface ResultadoDaConferencia {
  veredito: "APROVADO" | "AVISO" | "REPROVADO";
  problemas: Problema[];
  frescor: Frescor | null;
  arquivosConferidos: number;
}

// ─── Hash e cabeçalho ────────────────────────────────────────────────────────

/**
 * Normaliza antes de hashear: CRLF vira LF e o corpo sempre termina com uma
 * quebra. Sem isso, `git config core.autocrlf` num Windows qualquer reprovaria o
 * espelho inteiro por diferença invisível — que é o alarme falso que ensina a
 * ignorar o portão.
 */
export function normalizarCorpo(corpo: string): string {
  const semCR = corpo.replace(/\r\n/g, "\n");
  return semCR.endsWith("\n") ? semCR : `${semCR}\n`;
}

export function sha256DoCorpo(corpo: string): string {
  return createHash("sha256").update(normalizarCorpo(corpo), "utf8").digest("hex");
}

export function montarCabecalho(campos: CamposDoCabecalho, kitCommitCurto: string): string {
  return [
    "<!-- ESPELHO-DO-KIT",
    `origem: ${campos.origem}`,
    `kit-commit: ${campos.kitCommit}`,
    `sha256-do-corpo: ${campos.sha256}`,
    "-->",
    "",
    "> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**",
    ">",
    `> Ele é uma cópia automática de \`${KIT_REPO}\` → \`${campos.origem}\`,`,
    `> no commit \`${kitCommitCurto}\`.`,
    ">",
    "> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o",
    "> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a",
    "> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.",
    ">",
    `> Quem regenera: \`.github/workflows/kit-espelho.yml\`. Carimbo de versão em`,
    `> \`${CAMINHO_DO_MANIFESTO}\`.`,
    "",
    MARCA_FIM_DO_CABECALHO,
    "",
  ].join("\n");
}

export function montarArquivoEspelhado(
  origem: string,
  kitCommit: string,
  corpoOriginal: string,
): { conteudo: string; sha256: string } {
  const corpo = normalizarCorpo(corpoOriginal);
  const sha256 = sha256DoCorpo(corpo);
  const cabecalho = montarCabecalho({ origem, kitCommit, sha256 }, kitCommit.slice(0, 7));
  return { conteudo: `${cabecalho}${corpo}`, sha256 };
}

/** Separa cabeçalho de corpo. Cabeçalho ausente/torto é falha, nunca "tanto faz". */
export function lerArquivoEspelhado(conteudo: string): LeituraDeArquivo {
  const texto = conteudo.replace(/\r\n/g, "\n");
  const corte = texto.indexOf(MARCA_FIM_DO_CABECALHO);
  if (corte === -1) {
    return { ok: false, motivo: "não tem a linha sentinela de fim de cabeçalho" };
  }

  const cabecalho = texto.slice(0, corte);
  const corpo = texto.slice(corte + MARCA_FIM_DO_CABECALHO.length).replace(/^\n/, "");

  if (!cabecalho.startsWith("<!-- ESPELHO-DO-KIT")) {
    return { ok: false, motivo: "não começa com o bloco `<!-- ESPELHO-DO-KIT`" };
  }

  const campo = (nome: string): string | null => {
    const m = cabecalho.match(new RegExp(`^${nome}:\\s*(\\S+)\\s*$`, "m"));
    return m?.[1] ?? null;
  };

  const origem = campo("origem");
  const kitCommit = campo("kit-commit");
  const sha256 = campo("sha256-do-corpo");

  if (!origem) return { ok: false, motivo: "cabeçalho sem campo `origem`" };
  if (!kitCommit || !RE_SHA40.test(kitCommit)) {
    return { ok: false, motivo: "cabeçalho sem `kit-commit` de 40 caracteres hex" };
  }
  if (!sha256 || !RE_SHA256.test(sha256)) {
    return { ok: false, motivo: "cabeçalho sem `sha256-do-corpo` de 64 caracteres hex" };
  }

  return { ok: true, campos: { origem, kitCommit, sha256 }, corpo };
}

// ─── Frescor ─────────────────────────────────────────────────────────────────

export function conferirFrescor(verificadoEm: string, agora: Date): Frescor {
  const marco = new Date(verificadoEm);
  if (Number.isNaN(marco.getTime())) {
    return {
      estado: "VENCIDO",
      diasDeIdade: Number.POSITIVE_INFINITY,
      mensagem: `carimbo \`verificadoEm\` ilegível ("${verificadoEm}") — data que não se lê não é data.`,
    };
  }

  const dias = (agora.getTime() - marco.getTime()) / 86_400_000;
  // Carimbo no futuro é relógio errado ou carimbo forjado — as duas coisas
  // invalidam a medição, e "não sei a idade" não pode virar "está novo".
  if (dias < -1) {
    return {
      estado: "VENCIDO",
      diasDeIdade: dias,
      mensagem: `carimbo \`verificadoEm\` está no FUTURO (${verificadoEm}) — relógio errado ou carimbo forjado.`,
    };
  }

  const diasDeIdade = Math.max(0, Number(dias.toFixed(2)));

  if (diasDeIdade > FRESCOR_REPROVA_DIAS) {
    return {
      estado: "VENCIDO",
      diasDeIdade,
      mensagem:
        `O espelho da doutrina não é conferido há ${diasDeIdade.toFixed(1)} dias ` +
        `(limite: ${FRESCOR_REPROVA_DIAS}). O robô \`.github/workflows/kit-espelho.yml\` ` +
        `parou de rodar, ou está falhando. Enquanto isso, \`${PASTA_DO_ESPELHO}\` pode ` +
        `estar dizendo doutrina antiga com cara de doutrina atual.`,
    };
  }

  if (diasDeIdade > FRESCOR_AVISO_DIAS) {
    return {
      estado: "AVISO",
      diasDeIdade,
      mensagem:
        `O espelho da doutrina está com ${diasDeIdade.toFixed(1)} dias sem conferência ` +
        `(avisa em ${FRESCOR_AVISO_DIAS}, reprova em ${FRESCOR_REPROVA_DIAS}). Confira o robô.`,
    };
  }

  return {
    estado: "OK",
    diasDeIdade,
    mensagem: `Espelho conferido há ${diasDeIdade.toFixed(1)} dias.`,
  };
}

// ─── Leitura do manifesto ────────────────────────────────────────────────────

export function lerManifesto(
  bruto: string | null,
): { ok: true; manifesto: ManifestoDoEspelho } | { ok: false; problema: Problema } {
  if (bruto === null) {
    return {
      ok: false,
      problema: {
        tipo: "MANIFESTO_AUSENTE",
        detalhe:
          `\`${CAMINHO_DO_MANIFESTO}\` não existe. Sem carimbo de versão, "espelho atualizado" ` +
          `é opinião — e opinião não passa em portão. Rode \`npx ts-node scripts/espelhar-kit.ts\` ` +
          `ou dispare o workflow \`Espelho da doutrina\`.`,
      },
    };
  }

  let cru: unknown;
  try {
    cru = JSON.parse(bruto);
  } catch (erro) {
    return {
      ok: false,
      problema: {
        tipo: "MANIFESTO_ILEGIVEL",
        detalhe: `\`${CAMINHO_DO_MANIFESTO}\` não é JSON válido: ${(erro as Error).message}`,
      },
    };
  }

  const m = cru as Partial<ManifestoDoEspelho>;
  if (
    typeof m?.kitCommit !== "string" ||
    typeof m?.verificadoEm !== "string" ||
    !Array.isArray(m?.arquivos)
  ) {
    return {
      ok: false,
      problema: {
        tipo: "MANIFESTO_ILEGIVEL",
        detalhe:
          `\`${CAMINHO_DO_MANIFESTO}\` não tem os campos obrigatórios ` +
          `(\`kitCommit\`, \`verificadoEm\`, \`arquivos\`).`,
      },
    };
  }

  return { ok: true, manifesto: m as ManifestoDoEspelho };
}

// ─── O portão ────────────────────────────────────────────────────────────────

export interface EntradaDaConferencia {
  /** Conteúdo bruto do manifesto, ou `null` se o arquivo não existe. */
  manifestoBruto: string | null;
  /** destino → conteúdo. Ausente do mapa = arquivo não existe no disco. */
  conteudoPorDestino: Map<string, string>;
  /**
   * Todos os arquivos que existem em `docs/kit/` (caminho com `docs/kit/` na
   * frente), incluindo os de serviço. Serve para pegar arquivo INTRUSO — alguém
   * escrevendo doutrina à mão dentro do espelho.
   */
  arquivosPresentes: string[];
  agora: Date;
}

export function conferirEspelho(entrada: EntradaDaConferencia): ResultadoDaConferencia {
  const problemas: Problema[] = [];

  const leitura = lerManifesto(entrada.manifestoBruto);
  if (!leitura.ok) {
    // Guardrail 2: manifesto ausente/ilegível REPROVA. Nunca "nada a verificar".
    return {
      veredito: "REPROVADO",
      problemas: [leitura.problema],
      frescor: null,
      arquivosConferidos: 0,
    };
  }

  const { manifesto } = leitura;

  if (!RE_SHA40.test(manifesto.kitCommit)) {
    problemas.push({
      tipo: "CARIMBO_INVALIDO",
      detalhe: `\`kitCommit\` do manifesto não é um sha de 40 hex: "${manifesto.kitCommit}".`,
    });
  }

  if (manifesto.arquivos.length < MINIMO_DE_ARQUIVOS) {
    problemas.push({
      tipo: "ESPELHO_ENCOLHEU",
      detalhe:
        `O manifesto lista ${manifesto.arquivos.length} arquivo(s), abaixo do piso de ` +
        `${MINIMO_DE_ARQUIVOS}. Clone vazio ou filtro que não casou nada apagariam a doutrina ` +
        `com cara de sucesso — por isso isto reprova em vez de passar.`,
    });
  }

  const declarados = new Set<string>();

  for (const entradaArq of manifesto.arquivos) {
    declarados.add(entradaArq.destino);
    const conteudo = entrada.conteudoPorDestino.get(entradaArq.destino);

    if (conteudo === undefined) {
      problemas.push({
        tipo: "ARQUIVO_SUMIU",
        destino: entradaArq.destino,
        detalhe: "está no manifesto e não existe no disco.",
      });
      continue;
    }

    const lido = lerArquivoEspelhado(conteudo);
    if (!lido.ok) {
      problemas.push({
        tipo: "CABECALHO_ILEGIVEL",
        destino: entradaArq.destino,
        detalhe: `${lido.motivo}. Arquivo espelhado sem cabeçalho não diz de onde veio.`,
      });
      continue;
    }

    if (lido.campos.origem !== entradaArq.origem) {
      problemas.push({
        tipo: "ORIGEM_DIVERGENTE",
        destino: entradaArq.destino,
        detalhe: `cabeçalho diz vir de \`${lido.campos.origem}\`, manifesto diz \`${entradaArq.origem}\`.`,
      });
    }

    if (lido.campos.kitCommit !== manifesto.kitCommit) {
      problemas.push({
        tipo: "CARIMBO_DIVERGENTE",
        destino: entradaArq.destino,
        detalhe:
          `cabeçalho carimba o commit \`${lido.campos.kitCommit.slice(0, 7)}\` e o manifesto ` +
          `carimba \`${manifesto.kitCommit.slice(0, 7)}\` — meia geração, arquivo de duas épocas.`,
      });
    }

    const shaReal = sha256DoCorpo(lido.corpo);
    if (shaReal !== entradaArq.sha256 || shaReal !== lido.campos.sha256) {
      problemas.push({
        tipo: "EDITADO_A_MAO",
        destino: entradaArq.destino,
        detalhe:
          `o conteúdo não bate com o hash carimbado (real \`${shaReal.slice(0, 12)}\`, ` +
          `manifesto \`${entradaArq.sha256.slice(0, 12)}\`, cabeçalho ` +
          `\`${lido.campos.sha256.slice(0, 12)}\`). Alguém editou o espelho em vez do kit — ` +
          `a mudança não chega em nenhum outro projeto e some no próximo espelhamento.`,
      });
    }
  }

  for (const presente of entrada.arquivosPresentes) {
    const nome = presente.slice(PASTA_DO_ESPELHO.length + 1);
    if (ARQUIVOS_DE_SERVICO.has(nome)) continue;
    if (declarados.has(presente)) continue;
    problemas.push({
      tipo: "ARQUIVO_INTRUSO",
      destino: presente,
      detalhe:
        `existe dentro de \`${PASTA_DO_ESPELHO}/\` e não está no manifesto. A pasta é gerada: ` +
        `documento escrito à mão aqui parece doutrina do kit e não é.`,
    });
  }

  const frescor = conferirFrescor(manifesto.verificadoEm, entrada.agora);
  if (frescor.estado === "VENCIDO") {
    problemas.push({ tipo: "ESPELHO_VELHO", detalhe: frescor.mensagem });
  }

  const veredito: ResultadoDaConferencia["veredito"] =
    problemas.length > 0 ? "REPROVADO" : frescor.estado === "AVISO" ? "AVISO" : "APROVADO";

  return {
    veredito,
    problemas,
    frescor,
    arquivosConferidos: manifesto.arquivos.length,
  };
}

// ─── O plano de geração ──────────────────────────────────────────────────────
//
// Fica AQUI, e não no script, de propósito: `tsconfig.json` exclui `scripts/`,
// então nada que more lá é type-checked por `npm run type-check`. O script guarda
// só o que é inevitavelmente impuro (git e disco); toda decisão é desta camada,
// que é conferida pelo tsc e coberta por teste.

export interface ArquivoDoKit {
  /** Caminho relativo à raiz do kit. */
  origem: string;
  conteudo: string;
}

export interface PlanoDoEspelho {
  manifesto: ManifestoDoEspelho;
  arquivos: { destino: string; conteudo: string }[];
  readme: string;
  /** `true` se algum documento (ou o commit do kit) mudou desde o espelho anterior. */
  mudouConteudo: boolean;
  /** `true` se só o carimbo de data foi renovado pela cadência. */
  renovouCarimbo: boolean;
}

/**
 * `docs/01-filosofia.md` → `docs/kit/01-filosofia.md`
 * `CLAUDE.md`            → `docs/kit/CLAUDE.md`
 * `casos/foocci.md`      → `docs/kit/casos/foocci.md`
 */
export function destinoDe(origem: string): string {
  const semPrefixo = origem.startsWith("docs/") ? origem.slice("docs/".length) : origem;
  return `${PASTA_DO_ESPELHO}/${semPrefixo}`;
}

export function planejarEspelho(args: {
  arquivosDoKit: ArquivoDoKit[];
  kitCommit: string;
  kitCommitData: string;
  manifestoAnterior: ManifestoDoEspelho | null;
  agora: Date;
}): PlanoDoEspelho {
  const { arquivosDoKit, kitCommit, kitCommitData, manifestoAnterior, agora } = args;

  if (!RE_SHA40.test(kitCommit)) {
    throw new Error(
      `Commit do kit inválido: "${kitCommit}". Espelho sem carimbo verificável não é espelho.`,
    );
  }

  // A trava contra o clone silenciosamente vazio. Lança em vez de gerar: um
  // espelho de zero arquivo apagaria a doutrina inteira e commitaria a exclusão
  // com aparência de rotina bem-sucedida.
  if (arquivosDoKit.length < MINIMO_DE_ARQUIVOS) {
    throw new Error(
      `Só ${arquivosDoKit.length} arquivo(s) vieram do kit, abaixo do piso de ` +
        `${MINIMO_DE_ARQUIVOS}. Isso é clone vazio, branch errada ou filtro que não casou nada — ` +
        `NÃO é o kit tendo encolhido. Nada foi escrito.`,
    );
  }

  const ordenados = [...arquivosDoKit].sort((a, b) => a.origem.localeCompare(b.origem));

  const arquivos: { destino: string; conteudo: string }[] = [];
  const entradas: EntradaDoManifesto[] = [];

  for (const arq of ordenados) {
    const destino = destinoDe(arq.origem);
    const { conteudo, sha256 } = montarArquivoEspelhado(arq.origem, kitCommit, arq.conteudo);
    arquivos.push({ destino, conteudo });
    entradas.push({ destino, origem: arq.origem, sha256 });
  }

  const assinaturaNova = entradas.map((e) => `${e.destino}:${e.sha256}`).join("|");
  const assinaturaAntiga = (manifestoAnterior?.arquivos ?? [])
    .map((e) => `${e.destino}:${e.sha256}`)
    .join("|");

  const mudouConteudo =
    manifestoAnterior === null ||
    manifestoAnterior.kitCommit !== kitCommit ||
    assinaturaAntiga !== assinaturaNova;

  // Renova o carimbo por cadência mesmo sem mudança — senão "última conferência"
  // vira "última mudança do kit", que é outro fato, e o portão de frescor
  // reprovaria um espelho correto só porque a doutrina ficou parada.
  const idadeDoCarimbo =
    manifestoAnterior === null
      ? Number.POSITIVE_INFINITY
      : conferirFrescor(manifestoAnterior.verificadoEm, agora).diasDeIdade;

  const renovouCarimbo = !mudouConteudo && idadeDoCarimbo > CADENCIA_DE_CARIMBO_DIAS;

  const verificadoEm =
    mudouConteudo || renovouCarimbo
      ? agora.toISOString()
      : (manifestoAnterior?.verificadoEm ?? agora.toISOString());

  const manifesto: ManifestoDoEspelho = {
    kitRepo: KIT_REPO,
    kitBranch: KIT_BRANCH,
    kitCommit,
    kitCommitData,
    verificadoEm,
    geradoPor: ".github/workflows/kit-espelho.yml → scripts/espelhar-kit.ts",
    arquivos: entradas,
  };

  return {
    manifesto,
    arquivos,
    readme: montarReadme(manifesto),
    mudouConteudo,
    renovouCarimbo,
  };
}

/** O carimbo de versão em forma legível por gente. */
export function montarReadme(manifesto: ManifestoDoEspelho): string {
  const linhas = manifesto.arquivos.map(
    (e) => `| [\`${e.destino.slice(PASTA_DO_ESPELHO.length + 1)}\`](./${e.destino.slice(PASTA_DO_ESPELHO.length + 1)}) | \`${e.origem}\` |`,
  );

  return [
    "# Espelho da doutrina — `dioli-brain-kit` dentro do Foocci",
    "",
    "> ⚠️ **PASTA GERADA. NÃO EDITE NADA AQUI.** Toda mudança de doutrina é feita no",
    `> kit (\`${KIT_REPO}\`) pelo CEO / Diretor Geral do Cérebro. Editar um arquivo`,
    "> desta pasta reprova o CI e some no próximo espelhamento.",
    "",
    "---",
    "",
    "## Por que esta pasta existe",
    "",
    "Uma sessão de Diretor só enxerga os repositórios anexados **na abertura**. Em",
    "08/08/2026 o Diretor do CityJobs abriu sem o kit anexado, tentou API, git e raw —",
    "todos negados — e trabalhou sem a doutrina. Anexar depois não entra em sessão que",
    "já está rodando.",
    "",
    "Com o espelho, a doutrina chega como **atualização do sistema**: ela já está no",
    "repositório quando a sessão abre.",
    "",
    "## Carimbo de versão",
    "",
    "| Campo | Valor |",
    "|---|---|",
    `| Kit | \`${manifesto.kitRepo}\` (branch \`${manifesto.kitBranch}\`) |`,
    `| Commit espelhado | \`${manifesto.kitCommit}\` |`,
    `| Data do commit do kit | ${manifesto.kitCommitData} |`,
    `| Última conferência | ${manifesto.verificadoEm} |`,
    `| Documentos espelhados | ${manifesto.arquivos.length} |`,
    `| Gerado por | \`${manifesto.geradoPor}\` |`,
    "",
    `Versão de máquina: [\`_ESPELHO.json\`](./_ESPELHO.json).`,
    "",
    "## O portão que impede este espelho de apodrecer calado",
    "",
    "`src/services/doutrina/kitEspelho.test.ts` roda no CI de todo PR e **reprova**",
    "quando:",
    "",
    `- a última conferência passou de **${FRESCOR_REPROVA_DIAS} dias** (avisa em ${FRESCOR_AVISO_DIAS});`,
    "- algum arquivo desta pasta foi **editado à mão** (o hash do corpo não bate);",
    "- algum arquivo do manifesto **sumiu**, ou apareceu arquivo **intruso** aqui;",
    "- o manifesto sumiu, ficou ilegível ou o espelho encolheu abaixo do piso.",
    "",
    "## O que NÃO é espelhado, e por quê",
    "",
    "- `templates/` do kit — é código de referência, não doutrina; espelhar `.ts` dentro",
    "  de `docs/` confundiria o type-check e o lint deste repositório.",
    "- `casos/` de outros projetos — o Foocci espelha o caso dele.",
    "- `README.md` do kit — este arquivo ocupa o lugar e explica o espelho.",
    "",
    "## Como forçar uma atualização",
    "",
    "Rode o workflow **Espelho da doutrina** (`.github/workflows/kit-espelho.yml`) pelo",
    "botão *Run workflow*, ou localmente:",
    "",
    "```bash",
    "git clone --depth 1 https://github.com/" + manifesto.kitRepo + ".git /tmp/kit",
    "KIT_DIR=/tmp/kit npx ts-node --project tsconfig.scripts.json scripts/espelhar-kit.ts",
    "```",
    "",
    "---",
    "",
    "## Índice do que está espelhado",
    "",
    "| Arquivo aqui | Origem no kit |",
    "|---|---|",
    ...linhas,
    "",
  ].join("\n");
}

/**
 * O portão como ele roda no CI deste repositório.
 *
 * Diferença para `conferirEspelho`: aqui a **ausência** do espelho tem um
 * significado próprio, porque existe uma decisão de dono pendente (kit privado ×
 * repositório público). Ausência é tolerada — com aviso barulhento a cada
 * execução — **até o prazo**, e reprova depois dele.
 *
 * As quatro combinações, escritas para não sobrar dúvida:
 *
 * | Manifesto | `ESPELHO_INSTALADO` | Prazo | Resultado |
 * |---|---|---|---|
 * | existe   | qualquer | qualquer | conferência COMPLETA (integridade + frescor) |
 * | ausente  | `false`  | dentro   | AVISO — a decisão ainda está em pé |
 * | ausente  | `false`  | vencido  | REPROVADO — decisão pendente virou dívida |
 * | ausente  | `true`   | qualquer | REPROVADO — alguém apagou o espelho |
 *
 * O que isto NÃO faz: aprovar por omissão. O caminho "ausente" nunca devolve
 * APROVADO, e o aviso carrega a evidência inteira (guardrail 6).
 */
export function conferirEspelhoNoRepo(entrada: EntradaDaConferencia): ResultadoDaConferencia {
  if (entrada.manifestoBruto !== null) return conferirEspelho(entrada);

  const venceu = entrada.agora.getTime() >= PRAZO_PARA_DECIDIR_A_VISIBILIDADE.getTime();
  const oQueFalta =
    `O espelho da doutrina (\`${PASTA_DO_ESPELHO}/\`) não está neste repositório. ` +
    `A máquina está pronta e desligada de propósito: \`${KIT_REPO}\` é PRIVADO e ` +
    `\`diolisantos10/FOOCCI\` é PÚBLICO — espelhar aqui publica a doutrina inteira, ` +
    `e o próprio kit manda o contrário (\`docs/04-seguranca.md\`, "Repos do kit e dos ` +
    `produtos: privados"). Ligar é decisão do CEO, não do Diretor nem do especialista. ` +
    `Prazo para a decisão: ${PRAZO_PARA_DECIDIR_A_VISIBILIDADE.toISOString().slice(0, 10)}.`;

  if (ESPELHO_INSTALADO || venceu) {
    return {
      veredito: "REPROVADO",
      problemas: [
        {
          tipo: ESPELHO_INSTALADO ? "MANIFESTO_AUSENTE" : "DECISAO_DE_VISIBILIDADE_VENCIDA",
          detalhe: ESPELHO_INSTALADO
            ? `\`${CAMINHO_DO_MANIFESTO}\` sumiu de um espelho marcado como instalado.`
            : `${oQueFalta} O prazo PASSOU — "ainda não" deixou de ser resposta.`,
        },
      ],
      frescor: null,
      arquivosConferidos: 0,
    };
  }

  return {
    veredito: "AVISO",
    problemas: [],
    frescor: {
      estado: "AVISO",
      diasDeIdade: Number.POSITIVE_INFINITY,
      mensagem: oQueFalta,
    },
    arquivosConferidos: 0,
  };
}

/** Relatório de uma linha por problema, para virar mensagem de falha do teste. */
export function descreverProblemas(problemas: Problema[]): string {
  if (problemas.length === 0) return "(nenhum)";
  return problemas
    .map((p) => `  · [${p.tipo}]${p.destino ? ` ${p.destino}` : ""} — ${p.detalhe}`)
    .join("\n");
}
