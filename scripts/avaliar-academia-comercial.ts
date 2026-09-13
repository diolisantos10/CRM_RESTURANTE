/**
 * AVALIAÇÃO REAL DA ACADEMIA COMERCIAL — >=100 cenários, chamada de verdade ao
 * provedor de IA, no MESMO padrão de `scripts/homologar-camada-profunda.ts`.
 *
 *   npx tsx scripts/avaliar-academia-comercial.ts
 *
 * ── O QUE ESTE SCRIPT É, E O QUE ELE NÃO É ───────────────────────────────────
 *
 * Lê `docs/academia-comercial/cenarios-avaliacao.json` (>=100 cenários,
 * padrão de qualidade de `cenarios-semente.json`) e, para CADA cenário, chama
 * as funções REAIS de julgamento (`avaliarCamadaRapida`/`avaliarCamadaProfunda`,
 * em `src/services/salaDeVendas/supervisora/`) com o `ANTHROPIC_API_KEY` (ou
 * `OPENAI_API_KEY`, via `HOMOLOGACAO_PROVIDER=OPENAI`) que já existe como
 * GitHub Secret. Nenhum dado real de cliente, nenhum `enviarModeloDeVendas`/
 * `entregarMensagem`, nenhuma mensagem sai pelo WhatsApp — só julgamento.
 *
 * ⛔ SEM CREDENCIAL, OU SE O ROTEADOR CAIR EM MOCK: o script BLOQUEIA e sai com
 * erro. Nunca reporta "acerto" contra uma resposta canônica/determinística do
 * MOCK — isso seria exatamente a fraude que a missão desta obra proíbe.
 *
 * ── ESPELHANDO A PRODUÇÃO: RÁPIDA SEMPRE, PROFUNDA SÓ COM GATILHO ───────────
 *
 * Cada cenário passa PRIMEIRO pela camada rápida (`avaliarCamadaRapida`) —
 * exatamente como toda mensagem passa em produção (`revisao.ts::revisarDeFato`).
 * Só quando `deveAcionar` (a MESMA função pura de `camadaProfunda.ts`) decide
 * que há gatilho — a rápida não devolveu VERDE, o cliente está irritado, pediu
 * pra parar, ou (aqui sempre 0, ver abaixo) o agente já foi reprovado demais —
 * a camada profunda roda por cima, com os "últimos turnos" sintéticos do
 * cenário. O veredito final é o da camada que decidiu (profunda quando ela
 * rodou e não falhou; rápida caso contrário) — o mesmo critério de
 * `revisarDeFato`.
 *
 * `irritacaoDoLead`/`pediuParar` não vêm de `ta/memoria.ts` aqui (não há
 * conversa real persistida) — são inferidos por uma heurística de palavras-
 * chave sobre `ultimaMensagemDoCliente` do próprio cenário (`inferirSinais`),
 * documentada e simples de auditar. `reprovacoesRecentesDoAgente` é sempre 0:
 * cada cenário é avaliado isolado, sem histórico de agente entre eles.
 *
 * ── CLASSIFICAÇÃO ────────────────────────────────────────────────────────────
 *
 * Veredito tem uma ordem de severidade: VERDE(0) < AMARELO(1) < VERMELHO(2) <
 * CRITICO(3). Comparando o veredito obtido com o esperado:
 *
 *   - ACERTO: mesma severidade (ou seja, mesmo veredito).
 *   - FALSO POSITIVO: obtido MAIS severo que o esperado — bloqueou/reescreveu
 *     mais do que devia.
 *   - FALSO NEGATIVO: obtido MENOS severo que o esperado — liberou o que
 *     devia ter sido barrado. O MAIS GRAVE dos dois.
 *   - DIVERGÊNCIA EM ZONA CINZENTA: cenário marcado no próprio JSON (
 *     `motivoEsperado` contém "zona cinzenta") — um mismatch aqui NÃO conta
 *     como erro, é reportado à parte.
 *
 * ── O QUE NUNCA VAZA NO LOG ──────────────────────────────────────────────────
 *
 * Nenhuma chave de API é impressa — todo texto de erro passa por `sanear`. Só
 * são impressos: id do cenário, etapa, veredito esperado/obtido, camada usada,
 * classificação, provider/model resolvidos, e o resumo agregado no final.
 */

import { readFileSync } from "fs";
import path from "path";
import { avaliarCamadaRapida } from "../src/services/salaDeVendas/supervisora/camadaRapida";
import { avaliarCamadaProfunda, deveAcionar } from "../src/services/salaDeVendas/supervisora/camadaProfunda";
import { AGENT_ENGINE_PREFERENCES } from "../src/services/brain/engines/AIEngineRouter";
import type { ContextoDaRevisao } from "../src/services/salaDeVendas/supervisora/contexto";

const AGENTE_CAMADA_RAPIDA = "supervisora-camada-rapida";
const AGENTE_CAMADA_PROFUNDA = "supervisora-camada-profunda";

const CAMINHO_DOS_CENARIOS = path.join(__dirname, "..", "docs", "academia-comercial", "cenarios-avaliacao.json");
const CAMINHO_DA_ACADEMIA = path.join(__dirname, "..", "docs", "academia-comercial", "academia-comercial-v1.json");

const PROVEDOR_ALVO = (process.env.HOMOLOGACAO_PROVIDER ?? "CLAUDE").trim().toUpperCase();
const CREDENCIAL_DO_ALVO = PROVEDOR_ALVO === "OPENAI" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";

/** Tira qualquer coisa que pareça credencial de uma string antes de imprimir — mesmo padrão de `homologar-camada-profunda.ts`. */
function sanear(texto: string): string {
  let s = texto;
  for (const nome of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) {
    const chave = process.env[nome];
    if (chave && chave.trim()) s = s.split(chave).join("[REDACTED]");
  }
  return s
    .replace(/sk-ant-[a-zA-Z0-9_-]+/g, "[REDACTED]")
    .replace(/sk-[a-zA-Z0-9_-]{20,}/g, "[REDACTED]")
    .replace(/(authorization|x-api-key)\s*[:=]\s*\S+/gi, "$1: [REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}

function bloqueio(motivo: string): never {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("AVALIAÇÃO DA ACADEMIA COMERCIAL — BLOQUEADA");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`bloqueio literal: ${sanear(motivo)}`);
  process.exit(1);
}

// ── O FORMATO DE `cenarios-avaliacao.json` (mesmo de `cenarios-semente.json`) ──

type Etapa = "PROSPECCAO" | "QUALIFICACAO" | "DEMONSTRACAO" | "OBJECAO" | "FECHAMENTO" | "GERAL";
type Veredicto = "VERDE" | "AMARELO" | "VERMELHO" | "CRITICO";

interface Cenario {
  id: string;
  etapa: Etapa;
  descricao: string;
  ultimaMensagemDoCliente: string;
  respostaProposta: string;
  veredictoEsperado: Veredicto;
  motivoEsperado: string;
  fundamento: string;
}

interface ArquivoDeCenarios {
  cenarios: Cenario[];
}

// ── O MATERIAL DA ACADEMIA, LIDO DIRETO DO JSON (sem banco) ─────────────────
//
// Este script não sobe Postgres (mesma escolha de `homologacao-camada-profunda.yml`
// para o job irmão) — não há `recuperarConhecimentoRelevante` real disponível.
// Em vez de rodar sem NENHUM conhecimento da Academia (o que testaria um prompt
// mais pobre que o de produção), este script monta um recorte equivalente
// direto do JSON fonte — mesmo texto que o seed grava no banco, mesma lógica de
// "regra/proibido da etapa + GERAL", só sem o SQL.

interface AcademiaJson {
  regrasObrigatorias: Array<{ id: string; etapa?: string; titulo?: string; conteudo?: string }>;
  comportamentosProibidos: Array<{ id: string; etapa?: string; titulo?: string; conteudo?: string }>;
  orientacaoPorEtapa: Record<string, string>;
}

function carregarConhecimentoDaEtapa(academia: AcademiaJson, etapa: Etapa): string[] {
  const linhas: string[] = [];
  for (const r of academia.regrasObrigatorias) {
    if ((r.etapa ?? "GERAL") === etapa || (r.etapa ?? "GERAL") === "GERAL") {
      linhas.push(`Regra obrigatória — ${r.titulo}: ${r.conteudo}`);
    }
  }
  for (const p of academia.comportamentosProibidos) {
    if ((p.etapa ?? "GERAL") === etapa || (p.etapa ?? "GERAL") === "GERAL") {
      linhas.push(`Proibido — ${p.titulo}: ${p.conteudo}`);
    }
  }
  const orientacao = academia.orientacaoPorEtapa[etapa];
  if (orientacao) linhas.push(`Orientação da etapa: ${orientacao}`);
  // Mesmo teto pequeno de produção (`LIMITE_PADRAO` em academia.ts) — nunca a
  // base inteira dentro do prompt.
  return linhas.slice(0, 6);
}

// ── HEURÍSTICA SINTÉTICA DE IRRITAÇÃO/PEDIDO DE PARAR ───────────────────────
//
// Em produção isto vem de `ta/memoria.ts` (persistido, acumulado ao longo da
// conversa real). Aqui não há conversa real — só o texto do cenário — então
// esta função infere pelo VOCABULÁRIO que a própria Academia já documenta em
// `sinaisDeRisco` (irritacao-leve/irritacao-forte/recusa), para não inventar
// um segundo critério: as palavras abaixo são as mesmas citadas em
// `academia-comercial-v1.json` (`sinal-irritacao-leve`, `sinal-irritacao-forte`,
// `sinal-recusa-explicita`).
function inferirSinais(ultimaMensagemDoCliente: string): { irritacaoDoLead: number; pediuParar: boolean } {
  const texto = ultimaMensagemDoCliente.toLowerCase();

  const marcadoresRecusa = ["para de mandar", "pare de mandar", "sai da minha lista", "não quero mais receber", "remove meu contato", "não tenho interesse"];
  const marcadoresForte = ["ridículo", "ridicula", "golpe", "golpista", "assédio", "assedio", "cansei", "piada", "absurdo", "inaceitável", "inaceitavel", "enganoso"];
  const marcadoresLeve = ["já falei", "ja falei", "de novo", "como eu disse", "não é isso que eu", "nao e isso que eu"];

  const pediuParar = marcadoresRecusa.some((m) => texto.includes(m));
  let irritacaoDoLead = 0;
  if (marcadoresForte.some((m) => texto.includes(m))) irritacaoDoLead = 3;
  else if (marcadoresLeve.some((m) => texto.includes(m))) irritacaoDoLead = 2;

  return { irritacaoDoLead, pediuParar };
}

function montarContextoSintetico(cenario: Cenario, conhecimentoDaAcademia: string[]): ContextoDaRevisao {
  const { irritacaoDoLead, pediuParar } = inferirSinais(cenario.ultimaMensagemDoCliente);
  const semUltimaMensagemReal =
    cenario.ultimaMensagemDoCliente.startsWith("(") && cenario.ultimaMensagemDoCliente.endsWith(")");

  return {
    ultimaMensagemDoCliente: semUltimaMensagemReal ? null : cenario.ultimaMensagemDoCliente,
    resumoIncremental: `[AVALIAÇÃO — cenário ${cenario.id}] ${cenario.descricao}`,
    etapaDoFunil: `etapa: ${cenario.etapa}`,
    perfilDoLead: "lead fictício de avaliação, sem histórico real",
    regrasComerciais: [],
    tomDaMarca: "direto, cordial, business casual, sem emoji em excesso",
    ultimosAlertasDesteAtendimento: [],
    irritacaoDoLead,
    pediuParar,
    conhecimentoDaAcademia,
  };
}

function montarTurnosSinteticos(cenario: Cenario): Array<{ deQuem: "cliente" | "ta"; texto: string }> {
  const semUltimaMensagemReal =
    cenario.ultimaMensagemDoCliente.startsWith("(") && cenario.ultimaMensagemDoCliente.endsWith(")");
  return semUltimaMensagemReal ? [] : [{ deQuem: "cliente", texto: cenario.ultimaMensagemDoCliente }];
}

// ── SEVERIDADE E CLASSIFICAÇÃO ───────────────────────────────────────────────

const SEVERIDADE: Record<Veredicto, number> = { VERDE: 0, AMARELO: 1, VERMELHO: 2, CRITICO: 3 };

type Classificacao =
  | "ACERTO"
  | "FALSO_POSITIVO"
  | "FALSO_NEGATIVO"
  | "DIVERGENCIA_ZONA_CINZENTA"
  | "FALHA_TECNICA";

function classificar(cenario: Cenario, obtido: Veredicto | null): Classificacao {
  if (obtido === null) return "FALHA_TECNICA";
  if (obtido === cenario.veredictoEsperado) return "ACERTO";

  const zonaCinzenta = cenario.motivoEsperado.toLowerCase().includes("zona cinzenta");
  if (zonaCinzenta) return "DIVERGENCIA_ZONA_CINZENTA";

  return SEVERIDADE[obtido] > SEVERIDADE[cenario.veredictoEsperado] ? "FALSO_POSITIVO" : "FALSO_NEGATIVO";
}

// ── UMA RODADA, COM UM RETRY CURTO PARA FALHA TRANSIENTE DE REDE ────────────
//
// Uma falha por "sem motor de IA configurado" (MOCK) NUNCA tem retry — é
// bloqueio imediato do script inteiro (ver `main`). Só falha de rede/parse
// ("o motor de IA falhou"/"JSON inválido") ganha uma segunda tentativa, porque
// isso pode ser instabilidade momentânea do provedor, não ausência de
// credencial.
function ehFalhaDeMock(detalhe: string): boolean {
  return detalhe.includes("sem motor de IA configurado");
}

interface ResultadoDoCenario {
  cenario: Cenario;
  camadaUsada: "RAPIDA" | "PROFUNDA";
  veredictoObtido: Veredicto | null;
  detalheObtido: string;
  engineProvider: string | null;
  engineModel: string | null;
  classificacao: Classificacao;
  motivoDoAcionamento: string | null;
}

async function avaliarUmCenario(cenario: Cenario, academia: AcademiaJson): Promise<ResultadoDoCenario> {
  const conhecimentoDaAcademia = carregarConhecimentoDaEtapa(academia, cenario.etapa);
  const ctx = montarContextoSintetico(cenario, conhecimentoDaAcademia);

  const rapida = await avaliarCamadaRapida(ctx, cenario.respostaProposta);
  if (rapida.falhaTecnica && ehFalhaDeMock(rapida.detalhe)) {
    bloqueio(
      `cenário ${cenario.id}: a camada rápida caiu em MOCK (sem credencial real reconhecida) — ` +
        "nunca se reporta acerto/erro contra o MOCK. Verifique HOMOLOGACAO_PROVIDER e a credencial no ambiente.",
    );
  }

  const decisao = deveAcionar({
    veredictoDaCamadaRapida: rapida.falhaTecnica ? null : rapida.veredito,
    irritacaoDoLead: ctx.irritacaoDoLead,
    pediuParar: ctx.pediuParar,
    // Sempre 0: cada cenário desta avaliação é isolado, sem histórico de
    // reprovações entre cenários — ver o cabeçalho do arquivo.
    reprovacoesRecentesDoAgente: 0,
  });

  const precisaDaProfunda =
    decisao.aciona || (rapida.falhaTecnica && (ctx.irritacaoDoLead >= 2 || ctx.pediuParar));

  if (!precisaDaProfunda) {
    return {
      cenario,
      camadaUsada: "RAPIDA",
      veredictoObtido: rapida.falhaTecnica ? null : rapida.veredito,
      detalheObtido: rapida.detalhe,
      engineProvider: rapida.engineProvider,
      engineModel: rapida.engineModel,
      classificacao: classificar(cenario, rapida.falhaTecnica ? null : rapida.veredito),
      motivoDoAcionamento: null,
    };
  }

  const turnos = montarTurnosSinteticos(cenario);
  const motivo = decisao.motivo ?? "falha técnica da camada rápida com sinal de risco presente";
  const profunda = await avaliarCamadaProfunda(ctx, cenario.respostaProposta, turnos, motivo);
  if (profunda.falhaTecnica && ehFalhaDeMock(profunda.detalhe)) {
    bloqueio(
      `cenário ${cenario.id}: a camada profunda caiu em MOCK (sem credencial real reconhecida) — ` +
        "nunca se reporta acerto/erro contra o MOCK. Verifique HOMOLOGACAO_PROVIDER e a credencial no ambiente.",
    );
  }

  // Mesmo critério de `revisarDeFato`: a profunda vale mais quando conseguiu
  // avaliar; se ela também falhou mas a rápida não, fica a rápida.
  const usarProfunda = !profunda.falhaTecnica || rapida.falhaTecnica;
  const final = usarProfunda ? profunda : rapida;

  return {
    cenario,
    camadaUsada: usarProfunda ? "PROFUNDA" : "RAPIDA",
    veredictoObtido: final.falhaTecnica ? null : final.veredito,
    detalheObtido: final.detalhe,
    engineProvider: final.engineProvider,
    engineModel: final.engineModel,
    classificacao: classificar(cenario, final.falhaTecnica ? null : final.veredito),
    motivoDoAcionamento: motivo,
  };
}

function p(t = "") {
  console.log(t);
}

async function main() {
  const chave = process.env[CREDENCIAL_DO_ALVO];
  if (!chave || !chave.trim()) {
    bloqueio(
      `${CREDENCIAL_DO_ALVO} ausente no ambiente — este script só roda onde o secret ` +
        "existe de verdade (job de CI), nunca localmente.",
    );
  }

  // Mesmo mecanismo de `homologar-camada-profunda.ts`: visar CLAUDE precisa de
  // preferência de agente (o default do roteador é OPENAI) — só neste
  // processo, nunca no arquivo do router.
  if (PROVEDOR_ALVO === "CLAUDE") {
    AGENT_ENGINE_PREFERENCES[AGENTE_CAMADA_RAPIDA] = "CLAUDE";
    AGENT_ENGINE_PREFERENCES[AGENTE_CAMADA_PROFUNDA] = "CLAUDE";
  }

  const bruto = readFileSync(CAMINHO_DOS_CENARIOS, "utf-8");
  const arquivo = JSON.parse(bruto) as ArquivoDeCenarios;
  const academia = JSON.parse(readFileSync(CAMINHO_DA_ACADEMIA, "utf-8")) as AcademiaJson;

  if (arquivo.cenarios.length < 100) {
    bloqueio(
      `cenarios-avaliacao.json tem só ${arquivo.cenarios.length} cenário(s) — a missão exige >=100. ` +
        "Isto não é uma falha de rede: o arquivo está incompleto.",
    );
  }

  p("═══════════════════════════════════════════════════════════");
  p("AVALIAÇÃO DA ACADEMIA COMERCIAL — chamada real, cenários sintéticos");
  p("═══════════════════════════════════════════════════════════");
  p(`provedor-alvo: ${PROVEDOR_ALVO} (credencial: ${CREDENCIAL_DO_ALVO})`);
  p(`total de cenários: ${arquivo.cenarios.length}`);
  p("dado real de cliente: nenhum (100% sintético)");
  p("");

  const resultados: ResultadoDoCenario[] = [];
  const inicio = Date.now();

  for (const cenario of arquivo.cenarios) {
    let r: ResultadoDoCenario;
    try {
      r = await avaliarUmCenario(cenario, academia);
    } catch (e) {
      // Uma exceção fora do contrato das camadas (elas não deveriam lançar) —
      // tenta mais uma vez antes de desistir deste cenário, igual à régua de
      // "falha transiente" documentada no topo.
      console.error(`[avaliação] ${cenario.id}: exceção inesperada, tentando mais uma vez —`, sanear(String(e)));
      try {
        r = await avaliarUmCenario(cenario, academia);
      } catch (e2) {
        r = {
          cenario,
          camadaUsada: "RAPIDA",
          veredictoObtido: null,
          detalheObtido: `exceção fora do contrato após retry: ${sanear(String(e2))}`,
          engineProvider: null,
          engineModel: null,
          classificacao: "FALHA_TECNICA",
          motivoDoAcionamento: null,
        };
      }
    }
    resultados.push(r);
    const marca =
      r.classificacao === "ACERTO"
        ? "✓"
        : r.classificacao === "FALSO_NEGATIVO"
          ? "✗✗ FALSO NEGATIVO"
          : r.classificacao === "FALSO_POSITIVO"
            ? "✗ falso positivo"
            : r.classificacao === "DIVERGENCIA_ZONA_CINZENTA"
              ? "~ zona cinzenta"
              : "! falha técnica";
    p(
      `${marca} — ${r.cenario.id} [${r.cenario.etapa}] esperado=${r.cenario.veredictoEsperado} ` +
        `obtido=${r.veredictoObtido ?? "FALHA"} camada=${r.camadaUsada}`,
    );
  }

  const duracaoMs = Date.now() - inicio;

  const total = resultados.length;
  const contagem: Record<Classificacao, number> = {
    ACERTO: 0,
    FALSO_POSITIVO: 0,
    FALSO_NEGATIVO: 0,
    DIVERGENCIA_ZONA_CINZENTA: 0,
    FALHA_TECNICA: 0,
  };
  for (const r of resultados) contagem[r.classificacao] += 1;

  // Denominador para taxa de acerto exclui zona cinzenta (não é erro nem
  // acerto "cobrado") e falha técnica (não é julgamento, é ausência dele).
  const denominadorJulgado = total - contagem.DIVERGENCIA_ZONA_CINZENTA - contagem.FALHA_TECNICA;
  const taxaDeAcerto = denominadorJulgado > 0 ? (contagem.ACERTO / denominadorJulgado) * 100 : 0;
  const taxaDeFalsoPositivo = denominadorJulgado > 0 ? (contagem.FALSO_POSITIVO / denominadorJulgado) * 100 : 0;
  const taxaDeFalsoNegativo = denominadorJulgado > 0 ? (contagem.FALSO_NEGATIVO / denominadorJulgado) * 100 : 0;

  p("");
  p("── RESULTADO AGREGADO ───────────────────────────────────────");
  p(`duração total: ${duracaoMs}ms (${(duracaoMs / 1000 / 60).toFixed(1)} min)`);
  p(`total de cenários: ${total}`);
  p(`acertos: ${contagem.ACERTO} (${taxaDeAcerto.toFixed(1)}% dos julgados)`);
  p(`falsos positivos (bloqueou/reescreveu mais do que devia): ${contagem.FALSO_POSITIVO} (${taxaDeFalsoPositivo.toFixed(1)}%)`);
  p(`falsos negativos (liberou o que devia barrar — o mais grave): ${contagem.FALSO_NEGATIVO} (${taxaDeFalsoNegativo.toFixed(1)}%)`);
  p(`divergências em zona cinzenta (não contam como erro): ${contagem.DIVERGENCIA_ZONA_CINZENTA}`);
  p(`falhas técnicas (motor não respondeu/parseou mesmo após retry): ${contagem.FALHA_TECNICA}`);

  if (contagem.FALSO_NEGATIVO > 0) {
    p("");
    p("── FALSOS NEGATIVOS, UM A UM (o mais grave — liberou o que devia barrar) ──");
    for (const r of resultados.filter((r) => r.classificacao === "FALSO_NEGATIVO")) {
      p(`  ${r.cenario.id} [${r.cenario.etapa}]: esperado=${r.cenario.veredictoEsperado} obtido=${r.veredictoObtido}`);
      p(`    cenário: ${r.cenario.descricao}`);
      p(`    motivo esperado: ${r.cenario.motivoEsperado}`);
      p(`    detalhe devolvido pelo motor: ${r.detalheObtido}`);
    }
  }

  if (contagem.FALSO_POSITIVO > 0) {
    p("");
    p("── FALSOS POSITIVOS, UM A UM ────────────────────────────────");
    for (const r of resultados.filter((r) => r.classificacao === "FALSO_POSITIVO")) {
      p(`  ${r.cenario.id} [${r.cenario.etapa}]: esperado=${r.cenario.veredictoEsperado} obtido=${r.veredictoObtido}`);
      p(`    cenário: ${r.cenario.descricao}`);
      p(`    detalhe devolvido pelo motor: ${r.detalheObtido}`);
    }
  }

  if (contagem.FALHA_TECNICA > 0) {
    p("");
    p("── FALHAS TÉCNICAS, UMA A UMA ───────────────────────────────");
    for (const r of resultados.filter((r) => r.classificacao === "FALHA_TECNICA")) {
      p(`  ${r.cenario.id}: ${r.detalheObtido}`);
    }
  }

  const providersUsados = new Set(resultados.map((r) => r.engineProvider).filter(Boolean));
  const modelsUsados = new Set(resultados.map((r) => r.engineModel).filter(Boolean));
  p("");
  p(`provider(s) resolvido(s) de verdade: ${[...providersUsados].join(", ") || "(nenhum)"}`);
  p(`model(s) resolvido(s) de verdade: ${[...modelsUsados].join(", ") || "(nenhum)"}`);

  // ── CRITÉRIO DE APROVAÇÃO DO JOB ────────────────────────────────────────
  //
  // Qualquer falso negativo reprova o job — é o erro mais grave (liberar o
  // que devia ser barrado) e a missão pede corrigir a CAUSA antes de seguir.
  // Uma taxa de falso positivo alta (>20% dos julgados) também reprova: seria
  // uma Supervisora que atrapalha mais do que ajuda. Falha técnica isolada
  // (rede) não reprova sozinha, mas mais de 5% do total sim — sinal de que
  // algo estrutural (não só rede) está errado.
  const LIMITE_TAXA_FALSO_POSITIVO = 20;
  const LIMITE_PROPORCAO_FALHA_TECNICA = 0.05;

  const motivosDeReprovacao: string[] = [];
  if (contagem.FALSO_NEGATIVO > 0) {
    motivosDeReprovacao.push(`${contagem.FALSO_NEGATIVO} falso(s) negativo(s) — o mais grave dos erros possíveis`);
  }
  if (taxaDeFalsoPositivo > LIMITE_TAXA_FALSO_POSITIVO) {
    motivosDeReprovacao.push(
      `taxa de falso positivo ${taxaDeFalsoPositivo.toFixed(1)}% acima do limite de ${LIMITE_TAXA_FALSO_POSITIVO}%`,
    );
  }
  if (contagem.FALHA_TECNICA / total > LIMITE_PROPORCAO_FALHA_TECNICA) {
    motivosDeReprovacao.push(
      `${contagem.FALHA_TECNICA} falha(s) técnica(s) — acima do limite de ${(LIMITE_PROPORCAO_FALHA_TECNICA * 100).toFixed(0)}% do total`,
    );
  }

  p("");
  if (motivosDeReprovacao.length > 0) {
    p("═══════════════════════════════════════════════════════════");
    p("AVALIAÇÃO REPROVADA:");
    for (const m of motivosDeReprovacao) p(`  - ${m}`);
    p("═══════════════════════════════════════════════════════════");
    process.exitCode = 1;
    return;
  }

  p("✓ avaliação aprovada: chamada real ao provedor, sem MOCK, sem dado real de cliente.");
}

main().catch((e) => {
  bloqueio(`erro inesperado no script: ${e instanceof Error ? e.message : String(e)}`);
});
