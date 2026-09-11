/**
 * PORTÃO CONTRA OS ARQUIVOS REAIS DESTE REPOSITÓRIO.
 *
 * Os testes de `montagem.test.ts` provam a REGRA com insumos fabricados. Este
 * arquivo prova que a regra sobrevive ao material de verdade — que é onde a
 * armadilha estava: o formato das entradas de oficina NÃO é uniforme, e um
 * contador ingênuo devolve zero para o `garcom`.
 *
 * Não toca prisma: importa só a metade de disco (`leituraDeArquivos`) e a
 * montagem pura.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { veio } from "../amostra";
import { lerAgentesDeDesenvolvimento } from "../leituraDeArquivos";
import {
  AGENTES_COM_CUSTO_ATRIBUIDO,
  COBERTURA_DO_LOG,
  ESSENCIAIS,
  montarSalaDosAgentes,
} from "../montagem";
import { DEFAULT_AGENT_PROFILES } from "../../defaultAgentProfiles";
import { estaEmOperacao } from "@/app/admin/(area)/sala-dos-agentes/_estados";
import type { AdminAgentProfileView } from "../../types";

const RAIZ = process.cwd();
const AGORA = new Date();

function salaDeDesenvolvimento() {
  return montarSalaDosAgentes({
    agora: AGORA,
    janelaDias: 30,
    perfisDeProduto: veio([]),
    motoresPorSlug: {},
    arquivosDeDesenvolvimento: lerAgentesDeDesenvolvimento(RAIZ),
    usoDeIA: veio([]),
    provedoresLigados: [],
  });
}

/**
 * A Sala montada com o registro REAL de agentes de produto — a mesma projeção
 * que `getAdminAgentProfiles()` faz quando o flag de banco está desligado
 * (que é o estado de produção).
 */
function salaDeProduto() {
  const perfis: AdminAgentProfileView[] = DEFAULT_AGENT_PROFILES.map((p) => ({
    ...p,
    updatedAt: null,
    origin: "code" as const,
  }));
  return montarSalaDosAgentes({
    agora: AGORA,
    janelaDias: 30,
    perfisDeProduto: veio(perfis),
    motoresPorSlug: {},
    arquivosDeDesenvolvimento: veio([]),
    usoDeIA: veio([]),
    provedoresLigados: [],
  });
}

describe("os agentes deste repositório aparecem na Sala", () => {
  const sala = salaDeDesenvolvimento();

  it("todo perfil em .claude/agents virou cartão", () => {
    const arquivos = readdirSync(path.join(RAIZ, ".claude", "agents"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
    expect(sala.agentes.map((a) => a.slug).sort()).toEqual(arquivos);
    expect(arquivos.length).toBeGreaterThanOrEqual(5);
  });

  it("os cinco Essenciais estão marcados", () => {
    for (const slug of ESSENCIAIS) {
      const cartao = sala.agentes.find((a) => a.slug === slug);
      expect(cartao, `${slug} sumiu da Sala`).toBeDefined();
      expect(cartao!.essencial, slug).toBe(true);
    }
  });

  it("nenhum cartão tem nome ou função vazios", () => {
    for (const a of sala.agentes) {
      expect(a.nome.trim().length, a.slug).toBeGreaterThan(0);
      expect(a.funcao.trim().length, a.slug).toBeGreaterThan(0);
    }
  });
});

describe("o contador de 'fora de operação' lê o registro, e não outra lista", () => {
  /*
    ── POR QUE ESTE BLOCO EXISTE ──────────────────────────────────────────────

    Em 07/08/2026 o CEO apagou quatro perfis placeholder do registro
    (`orchestrator`, `security-governance`, `ui-ux`, `qa-test`) e mandou
    conferir se o número da Sala acompanhava: "se não acompanhar, o contador
    está lendo de outro lugar e isso é um defeito novo."

    A pergunta é legítima porque este produto JÁ TEVE essa família de defeito
    duas vezes — o "Total hoje" que somava a página e o contador que dizia
    "12 falam com o cliente" com oito rascunhos no meio. Contador que não muda
    quando o dado muda é indistinguível de contador correto, até o dia em que
    é caro.

    Os testes de `_estados.test.ts` provam o PREDICADO com elenco fabricado.
    Este prova a CADEIA INTEIRA contra o registro de verdade:
    registro → montarSalaDosAgentes → estado → estaEmOperacao → número.
  */
  const sala = salaDeProduto();
  const fora = sala.agentes.filter((a) => !estaEmOperacao(a));

  it("são QUATRO fora de operação — o número acompanhou o corte, não ficou em oito", () => {
    expect(
      fora.map((a) => a.slug).sort(),
      "o contador de 'fora de operação' não bate com os DRAFT do registro",
    ).toEqual(["analytics-product", "branding", "integration", "manual-constitution"]);
  });

  it("nenhum dos quatro nomes apagados sobrou como cartão na Sala", () => {
    // A metade que reprova: recriar o perfil faz o nome duplicado reaparecer na
    // tela do dono, ao lado do Essencial de mesmo trabalho.
    const slugs = sala.agentes.map((a) => a.slug);
    for (const apagado of ["orchestrator", "security-governance", "ui-ux", "qa-test"]) {
      expect(slugs, `"${apagado}" voltou a aparecer na Sala`).not.toContain(apagado);
    }
  });

  it("os quatro EM operação continuam montando — o corte não esvaziou a tela", () => {
    /*
      A metade que passa. Sem ela, apagar o registro inteiro deixaria os dois
      testes acima verdes ("zero fora de operação", "nenhum apagado presente")
      enquanto a Sala virava uma tela vazia. Guardrail 5: a proteção não pode
      ser mais destrutiva que o problema.
    */
    const dentro = sala.agentes.filter(estaEmOperacao).map((a) => a.slug).sort();
    expect(dentro).toEqual(["crm", "suporte-tecnico", "waiter", "whatsapp"]);
  });

  it("as parcelas fecham com o total de cartões de produto", () => {
    // Um cartão que caísse fora das duas parcelas sumiria da tela sem avisar.
    expect(fora.length + sala.agentes.filter(estaEmOperacao).length).toBe(sala.agentes.length);
    expect(sala.agentes.length).toBe(DEFAULT_AGENT_PROFILES.length);
  });
});

describe("a armadilha da contagem, medida contra os arquivos de verdade", () => {
  const sala = salaDeDesenvolvimento();

  it("`garcom` NÃO conta zero — a oficina dele não usa `## `", () => {
    /*
      Esta é a asserção que dá razão de existir ao módulo de contagem.
      `docs/agents/garcom/oficina.md` registra os blocos como
      `2026-08-03 — **título**` depois de uma régua horizontal, sem cabeçalho
      nenhum. Um `grep -c '^## '` devolve 0 — e zero, aqui, seria a mentira que
      esta tela existe para não contar.
    */
    const garcom = sala.agentes.find((a) => a.slug === "garcom")!;
    const oficina = garcom.metricas.find((m) => m.rotulo === "Entradas na oficina")!.medida;
    expect(oficina.estado).toBe("medido");
    if (oficina.estado === "medido") expect(oficina.valor).toBeGreaterThanOrEqual(7);
  });

  it("nenhum agente com sala existente sai medido em zero", () => {
    // "medido: 0" é o estado que esta tela nunca pode produzir a partir de um
    // arquivo que tem conteúdo. Ou o número é real, ou é `naoMedido` com motivo.
    for (const a of sala.agentes) {
      for (const m of a.metricas) {
        if (m.medida.estado === "medido") {
          expect(m.medida.valor, `${a.slug} / ${m.rotulo}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("toda oficina lida foi reconhecida, ou a Sala declarou a lacuna", () => {
    const naoReconhecidos = sala.agentes.filter((a) => {
      const m = a.metricas.find((x) => x.rotulo === "Entradas na oficina")!.medida;
      return m.estado === "naoMedido" && m.motivo.includes("não reconhecido");
    });
    if (naoReconhecidos.length > 0) {
      expect(sala.lacunas.join(" ")).toContain("formato não reconhecido");
    }
    // Em 07/08/2026 os 11 arquivos de oficina existentes casam com um dos dois
    // formatos. Se um novo formato entrar, este teste continua verde — mas a
    // lacuna aparece na tela, que é o comportamento desejado.
    expect(naoReconhecidos.map((a) => a.slug)).toEqual([]);
  });

  it("agente sem sala vira `naoMedido` declarado, não zero", () => {
    const semSala = sala.agentes.filter((a) => {
      const m = a.metricas.find((x) => x.rotulo === "Entradas na oficina")!.medida;
      return m.estado === "naoMedido" && m.motivo.includes("não existe");
    });
    if (semSala.length > 0) {
      expect(sala.lacunas.join(" ")).toContain("Sem sala em docs/agents");
      for (const a of semSala) expect(a.estado).toBe("atencao");
    }
  });
});

// ── Travas estruturais: o que faz o motivo escrito na tela deixar de ser verdade ──

/**
 * Tira comentários antes de varrer.
 *
 * Sem isto o portão reprova a própria documentação — o cabeçalho de
 * `montagem.ts` cita `?? 0` justamente para explicar por que ele não existe lá.
 * Detector que barra o texto que explica a regra é o carimbo que faz o time
 * parar de escrever comentário.
 */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function arquivosDeCodigo(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome === ".next") continue;
    const completo = path.join(dir, nome);
    if (statSync(completo).isDirectory()) {
      saida.push(...arquivosDeCodigo(completo));
      continue;
    }
    if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)) saida.push(completo);
  }
  return saida;
}

describe("as afirmações que a Sala escreve na tela continuam verdadeiras", () => {
  it("`AIInteractionLog` tem exatamente os DOIS escritores que a Sala declara", () => {
    /*
      A Sala diz ao dono, em `lacunas`, EXATAMENTE o que o custo cobre. No dia em
      que um terceiro `AIInteractionLogger.log` entrar, essa frase vira mentira —
      e mentira em texto explicativo é pior que número errado, porque desarma a
      desconfiança.

      A metade que reprova: acrescentar um ponto de log novo sem atualizar
      `COBERTURA_DO_LOG` e `AGENTES_COM_CUSTO_ATRIBUIDO`.
      A metade que passa: os dois escritores legítimos de hoje — o fluxo de
      pedido do Garçom e o medidor do dispatcher do Brain — continuam ali.
    */
    /*
      `semComentarios` não é zelo: sem ele, um COMENTÁRIO que cite
      `AIInteractionLogger.log(` faz o arquivo entrar na lista sem escrever nada
      — e, pior, faz um arquivo que DEIXOU de escrever continuar aparecendo como
      escritor. Foi exatamente o que uma mutação pegou em 28/08/2026: trocar a
      chamada por um apelido (`registrador.log`) escondia o escritor do detector,
      e o teste passava porque o comentário do arquivo casava com a regex.
    */
    const chamadas = arquivosDeCodigo(path.join(RAIZ, "src")).filter((f) =>
      /AIInteractionLogger\.log\(/.test(semComentarios(readFileSync(f, "utf8"))),
    );
    expect(chamadas.map((f) => path.relative(RAIZ, f)).sort()).toEqual([
      "src/services/ai/AIOrderService.ts",
      "src/services/brain/engines/EngineUsageRecorder.ts",
    ]);
    expect(AGENTES_COM_CUSTO_ATRIBUIDO).toEqual(["waiter", "crm", "whatsapp", "suporte-tecnico"]);

    /*
      A segunda metade da varredura: quem escreve DIRETO no banco, sem passar
      pelo logger, também é escritor — e escaparia da regex acima. Só o próprio
      logger pode chamar `aIInteractionLog.create`.
    */
    const escritoresDiretos = arquivosDeCodigo(path.join(RAIZ, "src")).filter((f) =>
      /aIInteractionLog\.create\(/.test(semComentarios(readFileSync(f, "utf8"))),
    );
    expect(escritoresDiretos.map((f) => path.relative(RAIZ, f))).toEqual([
      "src/services/ai/AIInteractionLogger.ts",
    ]);
  });

  it("a frase que o dono lê nomeia os DOIS caminhos medidos e o que ficou de fora", () => {
    /*
      `COBERTURA_DO_LOG` é a única linha da tela que diz ao dono o quanto do gasto
      o número dele representa. Ela envelheceu calada uma vez (dizia "só o
      Garçom" quando o dispatcher do Brain já era o maior consumidor). Este teste
      é o alarme: a frase precisa citar o arquivo de cada caminho medido E
      continuar nomeando quem ficou fora — senão o piso vira "a fatura".
    */
    expect(COBERTURA_DO_LOG).toContain("src/services/ai/AIOrderService.ts:1271");
    expect(COBERTURA_DO_LOG).toContain("src/services/brain/engines/OpenAIEngineAdapter.ts");
    expect(COBERTURA_DO_LOG).toContain("recepcionista do WhatsApp");
    expect(COBERTURA_DO_LOG).toContain("transcrição de áudio");
  });

  it("nenhum módulo da Sala usa `?? 0`, `|| 0` ou `Number(x) || 0` em cima de métrica", () => {
    /*
      O tipo `Medida` existe justamente para tornar esse atalho desnecessário. A
      varredura é literal de propósito: foi um `?? 0` esquecido num consumidor que
      transformou o conserto do produtor de custo em número errado com aparência
      de auditado (vitrine do `cerebro`, 07/08).
    */
    const modulos = arquivosDeCodigo(path.join(RAIZ, "src/services/agents/sala"));
    expect(modulos.length).toBeGreaterThanOrEqual(5);
    for (const arquivo of modulos) {
      const fonte = semComentarios(readFileSync(arquivo, "utf8"));
      const rel = path.relative(RAIZ, arquivo);
      expect(fonte, `${rel} usa ?? 0`).not.toMatch(/\?\?\s*0\b/);
      expect(fonte, `${rel} usa || 0`).not.toMatch(/\|\|\s*0\b/);
    }
  });

  it("a montagem é pura: não importa prisma nem fs", () => {
    // Se a decisão voltar a morar junto do encanamento, o teste precisa mockar o
    // módulo inteiro — e a regra some de vista. Já aconteceu aqui.
    for (const nome of ["montagem.ts", "contagemDeEntradas.ts", "amostra.ts"]) {
      const fonte = semComentarios(
        readFileSync(path.join(RAIZ, "src/services/agents/sala", nome), "utf8"),
      );
      expect(fonte, `${nome} importa prisma`).not.toMatch(/from\s+["'].*prisma/);
      expect(fonte, `${nome} importa fs`).not.toMatch(/from\s+["']node:fs["']/);
      expect(fonte, `${nome} lê process.env`).not.toMatch(/process\.env/);
    }
  });
});
