/**
 * RESET COMERCIAL — zera Leads e Base fria inteiros, com rede e portão.
 *
 * Autorizado pelo CEO, 11/09/2026: "nenhum lead foi realmente atendido e
 * nenhuma mensagem válida foi enviada" — reset literal, incluindo os leads
 * originados pelo site, para reimportar as listas completas.
 *
 *   MODO=simular   (padrão)  → só lê. Contagem de cada tabela, na ordem em que
 *                               sairiam.
 *   MODO=exportar             → só lê. Grava a rede (backup) em arquivo local
 *                               e mostra o sha256.
 *   MODO=apagar               → o caminho sem volta. Exige TODOS os portões:
 *                               reset habilitado, prospecção pausada, envio
 *                               desligado, confirmação por frase e o sha256
 *                               do backup já gravado.
 *
 * Uso (local ou com DATABASE_URL de produção JÁ NO AMBIENTE — nunca digitada
 * aqui, nunca pedida a quem roda o script):
 *
 *   npx tsx scripts/reset-comercial.ts
 *   MODO=exportar npx tsx scripts/reset-comercial.ts
 *   RESET_COMERCIAL_HABILITADO=sim MODO=apagar \
 *     CONFIRMAR="APAGAR TODOS OS LEADS COMERCIAIS" \
 *     SHA256=<o da exportação> \
 *     npx tsx scripts/reset-comercial.ts
 *
 * ── O QUE SAI ────────────────────────────────────────────────────────────────
 *
 * Toda a família de SiteLead (mensagens, conversas, qualificações,
 * tarefas/compromissos/propostas, handoffs, fatores de score, avaliações de
 * QA e critérios, inscrições em cadência) e toda a Base fria (itens, lotes,
 * importações). Nada mais.
 *
 * ── O QUE FICA, PORQUE NUNCA É TOCADO ───────────────────────────────────────
 *
 * Usuários e acessos (`InternalUser`), agentes e suas configurações, os
 * templates aprovados da Meta (`modelos_de_vendas`), credenciais e
 * integrações (variáveis de ambiente), `ProspeccaoConfig` (o interruptor
 * continua exatamente como estava — pausado, se estava pausado) e as
 * cadências/motivos de perda (são modelo, não dado de lead). A estrutura do
 * banco e as migrations não mudam em nenhuma hipótese: este script só apaga
 * LINHAS, nunca tabela ou coluna.
 *
 * ── OS DOIS PORTÕES QUE NÃO EXISTEM NO RESTO DA CASA ────────────────────────
 *
 * Diferente da purga de restaurante (que só olha slug e assinatura), este
 * reset PRECISA que a prospecção esteja pausada e o envio esteja desligado
 * ANTES de apagar — porque apagar leads com o envio ligado deixaria
 * `AgendadorDaProspeccao` correndo atrás de uma base que está sendo destruída
 * ao mesmo tempo. Os dois são checados no banco e no ambiente, não na palavra
 * de quem roda o comando (guardrail 4: código é a trava).
 */

import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const prisma = new PrismaClient();

// ═══════════════════════════════════════════════════════════════════════════
// A ORDEM DE EXCLUSÃO — filhos antes dos pais, medida contra o schema real.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `SiteLead` e `SiteLeadInteraction` não têm `@@map` no schema — a tabela real
 * é o NOME DO MODELO, ao pé da letra e com maiúsculas (confirmado com `\dt`
 * contra Postgres real; todas as demais têm `@@map` em snake_case).
 */
const ORDEM_DE_RESET = [
  "lead_avaliacao_criterios",
  "lead_avaliacoes_qa",
  "lead_cadencias",
  "lead_qualificacoes",
  "lead_handoffs",
  "lead_propostas",
  "lead_compromissos",
  "lead_tarefas",
  "lead_score_fatores",
  "lead_mensagens",
  '"SiteLeadInteraction"',
  '"SiteLead"',
  "itens_de_prospeccao",
  "lotes_de_prospeccao",
  "importacoes_de_leads",
] as const;

/** O nome de exibição, sem aspas — para relatório, não para SQL. */
function rotulo(tabela: string): string {
  return tabela.replace(/"/g, "");
}

/** Tabelas que PROVAM a preservação — contadas antes e depois, e têm de bater. */
const TABELAS_PRESERVADAS = ["internal_users", "modelos_de_vendas", "cadencias", "motivos_de_perda"];

// ═══════════════════════════════════════════════════════════════════════════
// OS PORTÕES
// ═══════════════════════════════════════════════════════════════════════════

class ResetBloqueadoError extends Error {
  constructor(
    readonly motivo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ResetBloqueadoError";
  }
}

function resetHabilitado(): boolean {
  return process.env.RESET_COMERCIAL_HABILITADO === "sim";
}

/** Prospecção pausada = desligada, ou ligada mas com `pausadoEm` gravado. */
async function prospeccaoEstaPausada(): Promise<{ pausada: boolean; detalhe: string }> {
  const config = await prisma.prospeccaoConfig.findUnique({ where: { id: "singleton" } });
  if (!config) return { pausada: true, detalhe: "sem ProspeccaoConfig — nunca foi ligada" };
  const pausada = !config.outboundLigado || config.pausadoEm !== null;
  return {
    pausada,
    detalhe: `outboundLigado=${config.outboundLigado} pausadoEm=${config.pausadoEm?.toISOString() ?? "null"}`,
  };
}

function envioEstaDesligado(): boolean {
  return (process.env.FOOCCI_SDR_SEND_ENABLED ?? "").trim().toLowerCase() !== "true";
}

const FRASE_DE_CONFIRMACAO = "APAGAR TODOS OS LEADS COMERCIAIS";

// ═══════════════════════════════════════════════════════════════════════════
// CONTAGEM — dry-run, somente leitura
// ═══════════════════════════════════════════════════════════════════════════

async function contar(tabela: string): Promise<number> {
  const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*)::bigint AS n FROM ${tabela}`);
  return Number(r[0]?.n ?? 0);
}

interface Simulacao {
  passos: { ordem: number; tabela: string; linhas: number }[];
  totalLinhas: number;
  preservadas: Record<string, number>;
  portoes: { motivo: string; passaria: boolean; detalhe: string }[];
}

async function simular(): Promise<Simulacao> {
  const passos: Simulacao["passos"] = [];
  let ordem = 0;
  for (const tabela of ORDEM_DE_RESET) {
    passos.push({ ordem: ++ordem, tabela: rotulo(tabela), linhas: await contar(tabela) });
  }

  const preservadas: Record<string, number> = {};
  for (const t of TABELAS_PRESERVADAS) preservadas[t] = await contar(t);

  const { pausada, detalhe: detalheProspeccao } = await prospeccaoEstaPausada();
  const envioDesligado = envioEstaDesligado();

  const portoes: Simulacao["portoes"] = [
    { motivo: "RESET_HABILITADO", passaria: resetHabilitado(), detalhe: "RESET_COMERCIAL_HABILITADO=sim" },
    { motivo: "PROSPECCAO_PAUSADA", passaria: pausada, detalhe: detalheProspeccao },
    {
      motivo: "ENVIO_DESLIGADO",
      passaria: envioDesligado,
      detalhe: `FOOCCI_SDR_SEND_ENABLED=${process.env.FOOCCI_SDR_SEND_ENABLED ?? "(ausente)"}`,
    },
  ];

  return {
    passos,
    totalLinhas: passos.reduce((s, p) => s + p.linhas, 0),
    preservadas,
    portoes,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// A REDE — exportação canônica + sha256
// ═══════════════════════════════════════════════════════════════════════════

function canonicalizar(valor: unknown): unknown {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "bigint") return valor.toString();
  if (valor instanceof Date) return valor.toISOString();
  if (Buffer.isBuffer(valor)) return `base64:${valor.toString("base64")}`;
  if (Array.isArray(valor)) return valor.map(canonicalizar);
  if (typeof valor === "object") {
    const o = valor as Record<string, unknown>;
    if (typeof (o as { toFixed?: unknown }).toFixed === "function") return String(valor);
    const saida: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) saida[k] = canonicalizar(o[k]);
    return saida;
  }
  return valor;
}

function ordenarLinhas(linhas: unknown[]): unknown[] {
  return [...linhas].sort((a, b) => {
    const ia = (a as { id?: string })?.id ?? JSON.stringify(a);
    const ib = (b as { id?: string })?.id ?? JSON.stringify(b);
    return String(ia).localeCompare(String(ib));
  });
}

interface Exportacao {
  geradoEm: string;
  dados: Record<string, unknown[]>;
  sha256: string;
  bytes: number;
  totalLinhas: number;
}

/** SOMENTE LEITURA. A rede inteira, antes de qualquer corte. */
async function exportar(): Promise<Exportacao> {
  const dados: Record<string, unknown[]> = {};
  for (const tabela of ORDEM_DE_RESET) {
    const linhas = await prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM ${tabela}`);
    dados[rotulo(tabela)] = ordenarLinhas(linhas).map(canonicalizar);
  }

  const texto = JSON.stringify(canonicalizar(dados));
  const sha256 = createHash("sha256").update(texto).digest("hex");

  return {
    geradoEm: new Date().toISOString(),
    dados,
    sha256,
    bytes: Buffer.byteLength(texto, "utf8"),
    totalLinhas: Object.values(dados).reduce((s, v) => s + v.length, 0),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// O CORTE
// ═══════════════════════════════════════════════════════════════════════════

interface ResultadoDoReset {
  apagadoEm: string;
  linhasPorTabela: Record<string, number>;
  totalLinhas: number;
  preservadasAntes: Record<string, number>;
  preservadasDepois: Record<string, number>;
}

async function executar(pedido: { confirmar: string; sha256DoBackup: string }): Promise<ResultadoDoReset> {
  if (!resetHabilitado()) {
    throw new ResetBloqueadoError(
      "RESET_DESLIGADO",
      "RESET_COMERCIAL_HABILITADO não vale 'sim' neste ambiente. O reset está desligado.",
    );
  }

  if (pedido.confirmar !== FRASE_DE_CONFIRMACAO) {
    throw new ResetBloqueadoError(
      "CONFIRMACAO_NAO_CONFERE",
      `CONFIRMAR precisa ser exatamente "${FRASE_DE_CONFIRMACAO}".`,
    );
  }

  const { pausada, detalhe: detalheProspeccao } = await prospeccaoEstaPausada();
  if (!pausada) {
    throw new ResetBloqueadoError(
      "PROSPECCAO_NAO_PAUSADA",
      `A prospecção precisa estar pausada antes do reset. Estado atual: ${detalheProspeccao}.`,
    );
  }

  if (!envioEstaDesligado()) {
    throw new ResetBloqueadoError(
      "ENVIO_NAO_DESLIGADO",
      "FOOCCI_SDR_SEND_ENABLED precisa estar desligado (diferente de 'true') antes do reset.",
    );
  }

  if (!pedido.sha256DoBackup) {
    throw new ResetBloqueadoError(
      "SEM_REDE",
      "Sem sha256DoBackup não há prova de que a exportação foi feita. Rode MODO=exportar primeiro.",
    );
  }

  // A rede é conferida CONTRA O BANCO agora, não contra a palavra de quem
  // chamou — detecta dado novo entrando entre a exportação e o corte.
  const conferencia = await exportar();
  if (conferencia.sha256 !== pedido.sha256DoBackup) {
    throw new ResetBloqueadoError(
      "REDE_DIVERGENTE",
      `sha256 informado (${pedido.sha256DoBackup}) não bate com o estado atual do banco ` +
        `(${conferencia.sha256}). Exporte de novo e confira antes de apagar.`,
    );
  }

  const preservadasAntes: Record<string, number> = {};
  for (const t of TABELAS_PRESERVADAS) preservadasAntes[t] = await contar(t);

  const linhasPorTabela: Record<string, number> = {};

  await prisma.$transaction(
    async (tx) => {
      for (const tabela of ORDEM_DE_RESET) {
        const apagadas = await tx.$executeRawUnsafe(`DELETE FROM ${tabela}`);
        linhasPorTabela[rotulo(tabela)] = apagadas;
      }

      // O registro de auditoria do PRÓPRIO reset, na mesma transação: ou o
      // reset inteiro (exclusões + registro) sai, ou nada sai.
      await tx.internalAuditEvent.create({
        data: {
          actorType: "SYSTEM",
          actorLabel: "reset-comercial (script, autorizado pelo CEO 11/09/2026)",
          acao: "reset-comercial",
          recurso: "comercial:leads+base-fria",
          resultado: "PERMITIDO",
          detalhe: {
            linhasPorTabela,
            sha256DoBackup: pedido.sha256DoBackup,
            geradoEmDoBackup: conferencia.geradoEm,
          },
        },
      });
    },
    { timeout: 120_000 },
  );

  const preservadasDepois: Record<string, number> = {};
  for (const t of TABELAS_PRESERVADAS) preservadasDepois[t] = await contar(t);

  return {
    apagadoEm: new Date().toISOString(),
    linhasPorTabela,
    totalLinhas: Object.values(linhasPorTabela).reduce((a, b) => a + b, 0),
    preservadasAntes,
    preservadasDepois,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════

const MODO = (process.env.MODO || "simular").toLowerCase();

function p(t = "") {
  console.log(t);
}

function mostrarSimulacao(s: Simulacao) {
  p(`\n═══ SIMULAÇÃO — reset comercial ═══`);
  p(`   total de linhas que sairiam: ${s.totalLinhas}`);
  p(`\n   ── ORDEM DE EXCLUSÃO ──`);
  for (const passo of s.passos) {
    p(`   ${String(passo.ordem).padStart(3)}. ${passo.tabela.padEnd(28)} ${String(passo.linhas).padStart(8)}`);
  }
  p(`\n   ── PRESERVADAS (não saem, contadas para provar depois) ──`);
  for (const [t, n] of Object.entries(s.preservadas)) p(`        ${t.padEnd(28)} ${String(n).padStart(8)}`);
  p(`\n   ── PORTÕES ──`);
  for (const portao of s.portoes) {
    p(`        ${portao.passaria ? "✅" : "⛔"} ${portao.motivo}: ${portao.detalhe}`);
  }
  if (s.portoes.every((b) => b.passaria)) p("\n   Todos os portões passariam. MODO=apagar seguiria adiante.");
  else p("\n   Pelo menos um portão bloquearia MODO=apagar hoje.");
}

async function main() {
  const s = await simular();
  mostrarSimulacao(s);

  if (MODO === "simular") {
    p("\n✅ Somente leitura. Nada foi apagado.");
    return;
  }

  if (MODO === "exportar" || MODO === "apagar") {
    p("\n⏳ Montando a rede (exportação)...");
    const e = await exportar();
    const arquivo = `backup-comercial-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(arquivo, JSON.stringify(e, null, 2));
    p(`💾 rede gravada em ${arquivo}`);
    p(`   linhas: ${e.totalLinhas} · bytes: ${e.bytes}`);
    p(`   sha256: ${e.sha256}`);
    p("   ⚠️  este arquivo contém dado pessoal (nome, telefone, conversa). Guarde onde dê para recuperar.");

    if (MODO === "exportar") {
      p("\n✅ Somente leitura. Nada foi apagado.");
      return;
    }

    const CONFIRMAR = process.env.CONFIRMAR ?? "";
    const SHA256 = process.env.SHA256 ?? "";

    if (!SHA256) {
      p(
        `\n❌ MODO=apagar exige SHA256 no ambiente — o da rede acima: ${e.sha256}\n` +
          "   Pedido de novo, à mão, de propósito: colar o sha256 é o momento em que alguém\n" +
          "   confirma que olhou o arquivo, não que ele apenas foi gerado.",
      );
      process.exitCode = 1;
      return;
    }

    try {
      const r = await executar({ confirmar: CONFIRMAR, sha256DoBackup: SHA256 });
      p(`\n🗑️  Reset concluído em ${r.apagadoEm}. ${r.totalLinhas} linha(s).`);
      for (const [t, q] of Object.entries(r.linhasPorTabela)) p(`   · ${t}: ${q}`);
      p(`\n   ── PRESERVADAS, ANTES → DEPOIS (têm de bater) ──`);
      let todasBateram = true;
      for (const t of TABELAS_PRESERVADAS) {
        const antes = r.preservadasAntes[t];
        const depois = r.preservadasDepois[t];
        const bateu = antes === depois;
        if (!bateu) todasBateram = false;
        p(`        ${bateu ? "✅" : "⛔"} ${t.padEnd(28)} ${antes} → ${depois}`);
      }
      p(todasBateram ? "\n✅ RESET CONCLUÍDO — preservação confirmada." : "\n⛔ ALERTA — algo preservado mudou.");
    } catch (err) {
      if (err instanceof ResetBloqueadoError) {
        p(`\n❌ Reset recusado — ${err.motivo}: ${err.message}`);
        process.exitCode = 1;
        return;
      }
      throw err;
    }
    return;
  }

  p(`MODO desconhecido: "${MODO}". Use simular | exportar | apagar.`);
  process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("❌", e instanceof Error ? e.stack ?? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
