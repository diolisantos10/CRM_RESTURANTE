/**
 * HOMOLOGAÇÃO REAL DA CAMADA PROFUNDA — chamada de verdade, credencial de verdade.
 *
 *   npx tsx scripts/homologar-camada-profunda.ts
 *
 * ── O QUE ESTE SCRIPT É, E O QUE ELE NÃO É ───────────────────────────────────
 *
 * Chama `avaliarCamadaProfunda` (a função REAL de produção, em
 * `src/services/salaDeVendas/supervisora/camadaProfunda.ts`) com um lead e uma
 * conversa 100% SINTÉTICOS — nenhuma leitura de banco, nenhum dado real de
 * cliente. Não é um teste unitário (não faz `expect`, não mocka o motor de IA)
 * e não é mock: o objetivo inteiro é provar que a Supervisora consegue, de
 * verdade, chamar um provedor de IA real com a credencial que já existe no
 * ambiente autorizado (`ANTHROPIC_API_KEY`, GitHub Secret já em uso em
 * `.github/workflows/manual-sync-nightly.yml`).
 *
 * ⛔ SÓ RODA ONDE A CREDENCIAL EXISTE DE VERDADE — dentro do CI (workflow
 * `homologacao-camada-profunda.yml`, credencial `ANTHROPIC_API_KEY`) ou num
 * serviço temporário no Railway (credencial `OPENAI_API_KEY`, referenciada do
 * serviço FOOCCI sem nunca ser copiada). Nunca localmente. Sem a credencial do
 * provedor-alvo no ambiente, o script recusa e sai com bloqueio literal —
 * nunca finge, nunca usa MOCK como prova.
 *
 * ⛔ NUNCA chama `enviarModeloDeVendas`/`entregarMensagem`/nada que toque
 * WhatsApp — só a avaliação da Supervisora, que não entrega mensagem nenhuma.
 *
 * ── QUAL PROVEDOR, E COMO FORÇA O ROTEADOR PARA ELE ─────────────────────────
 *
 * `HOMOLOGACAO_PROVIDER` escolhe o alvo: `CLAUDE` (padrão, mantém o workflow
 * de CI existente sem mudança de comportamento) ou `OPENAI` (para o serviço
 * temporário no Railway, que só tem `OPENAI_API_KEY`).
 *
 * `AIEngineRouter.ts` não tem uma variável de ambiente tipo `AI_PROVIDER` —
 * lido o arquivo, `DEFAULT_PROVIDER` já É `"OPENAI"`, então visar OPENAI não
 * precisa de preferência nenhuma: basta a credencial estar presente. Visar
 * CLAUDE precisa de `AGENT_ENGINE_PREFERENCES` (preferência por `agentId`, um
 * objeto comum, mutável em runtime) porque o agente da camada profunda
 * (`AGENTE_CAMADA_PROFUNDA`, "supervisora-camada-profunda") não tem entrada
 * nesse mapa por padrão. Este script seta a preferência SÓ NO PROCESSO DELE
 * MESMO, em memória, antes da chamada — não edita o arquivo do router, não
 * muda o default de produção. `selectEngineRouted` ainda confere
 * `configuredProviders(env)` antes de aceitar qualquer seleção: sem a
 * credencial de verdade, a chamada cai em MOCK — o que este script trata
 * como bloqueio, nunca como sucesso.
 *
 * ── O QUE ESTE SCRIPT IMPRIME, E O QUE ELE NUNCA IMPRIME ─────────────────────
 *
 * Métricas: duração em ms, provider/model resolvidos, veredito devolvido. NUNCA
 * imprime `ANTHROPIC_API_KEY`, nem por engano dentro de um objeto de erro — todo
 * texto de erro passa por `sanear` antes de ir para o console.
 *
 * Tokens/custo: o adapter atual (`AnthropicEngineAdapter.callAnthropic`) devolve
 * só o texto da resposta — não expõe `usage` do SDK ao chamador, e este script
 * não deve mudar esse contrato (ele é usado por todo consumidor do Brain, e
 * acrescentar estado para capturar `usage` ali seria um risco de concorrência
 * em código de produção, fora do escopo desta homologação). Por isso tokens e
 * custo saem como "indisponível", nunca como zero ou como um chute — a mesma
 * régua de `estimateCostUsd`/`modelPricing.ts`: ausência de informação não é
 * informação.
 */

// Import relativo, não `@/...` — mesmo padrão dos outros scripts rodados
// direto com `tsx` neste repositório (ex. `scripts/seed-sala-de-vendas.ts`),
// que não passam pelo resolvedor de alias do Next.js.
import { avaliarCamadaProfunda } from "../src/services/salaDeVendas/supervisora/camadaProfunda";
import { AGENT_ENGINE_PREFERENCES } from "../src/services/brain/engines/AIEngineRouter";
import { findModelPrice } from "../src/services/ai/pricing/modelPricing";
import type { ContextoDaRevisao } from "../src/services/salaDeVendas/supervisora/contexto";

const AGENTE_CAMADA_PROFUNDA = "supervisora-camada-profunda";

/** `CLAUDE` (padrão, credencial `ANTHROPIC_API_KEY`) ou `OPENAI` (credencial `OPENAI_API_KEY`). */
const PROVEDOR_ALVO = (process.env.HOMOLOGACAO_PROVIDER ?? "CLAUDE").trim().toUpperCase();
const CREDENCIAL_DO_ALVO = PROVEDOR_ALVO === "OPENAI" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";

/** Tira qualquer coisa que pareça credencial de uma string antes de imprimir. */
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
  console.log("HOMOLOGAÇÃO DA CAMADA PROFUNDA — BLOQUEADA");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`bloqueio literal: ${sanear(motivo)}`);
  process.exit(1);
}

const LEAD_SINTETICO_ID = "homologacao-sintetico-lead-000";

const CONTEXTO_SINTETICO: ContextoDaRevisao = {
  ultimaMensagemDoCliente: "Oi, vocês entregam pizza no bairro Água Verde ainda hoje?",
  resumoIncremental:
    "[SINTÉTICO — homologação de CI] Lead fictício perguntou sobre entrega no bairro Água Verde.",
  etapaDoFunil: "QUALIFICACAO",
  perfilDoLead: "cliente fictício de homologação, sem histórico real",
  regrasComerciais: ["nunca prometer prazo exato sem confirmar com a loja"],
  tomDaMarca: "direto, cordial, sem emoji em excesso",
  ultimosAlertasDesteAtendimento: [],
  irritacaoDoLead: 0,
  pediuParar: false,
};

const TURNOS_SINTETICOS: Array<{ deQuem: "cliente" | "ta"; texto: string }> = [
  { deQuem: "cliente", texto: "Oi, vocês entregam pizza no bairro Água Verde ainda hoje?" },
  { deQuem: "ta", texto: "Oi! Deixa eu confirmar a área de entrega pra você — só um instante." },
  { deQuem: "cliente", texto: "Beleza, e até que horas dá pra pedir?" },
];

const RESPOSTA_PROPOSTA_SINTETICA =
  "Consigo confirmar sim! A gente entrega no Água Verde até 23h hoje. Quer que eu já separe o cardápio pra você escolher?";

const MOTIVO_DO_ACIONAMENTO_SINTETICO =
  "homologação real da camada profunda (CI) — acionamento forçado, sem gatilho de risco de verdade";

async function main() {
  const chave = process.env[CREDENCIAL_DO_ALVO];
  if (!chave || !chave.trim()) {
    bloqueio(
      `${CREDENCIAL_DO_ALVO} ausente no ambiente — este script só roda onde o secret ` +
        "existe de verdade (job de CI ou serviço temporário homologando o PR), nunca localmente.",
    );
  }

  // Visar OPENAI não precisa de preferência: já é o DEFAULT_PROVIDER do
  // roteador. Visar CLAUDE precisa — só nesta execução do processo, nunca no
  // arquivo do router. Ver o comentário grande no topo.
  if (PROVEDOR_ALVO === "CLAUDE") {
    AGENT_ENGINE_PREFERENCES[AGENTE_CAMADA_PROFUNDA] = "CLAUDE";
  }

  console.log("═══════════════════════════════════════════════════════════");
  console.log("HOMOLOGAÇÃO DA CAMADA PROFUNDA — chamada real, lead sintético");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`provedor-alvo: ${PROVEDOR_ALVO} (credencial: ${CREDENCIAL_DO_ALVO})`);
  console.log(`leadId sintético: ${LEAD_SINTETICO_ID}`);
  console.log("dado real de cliente: nenhum (100% sintético)");

  const inicio = Date.now();
  let resultado: Awaited<ReturnType<typeof avaliarCamadaProfunda>>;
  try {
    resultado = await avaliarCamadaProfunda(
      CONTEXTO_SINTETICO,
      RESPOSTA_PROPOSTA_SINTETICA,
      TURNOS_SINTETICOS,
      MOTIVO_DO_ACIONAMENTO_SINTETICO,
    );
  } catch (e) {
    // `avaliarCamadaProfunda` já captura falha de motor internamente e devolve
    // um resultado (`falhaTecnica: true`) em vez de lançar — chegar aqui é algo
    // fora do contrato dela (bug, ou algo pior). Trata como bloqueio, nunca
    // como sucesso silencioso.
    const duracaoMs = Date.now() - inicio;
    bloqueio(
      `avaliarCamadaProfunda lançou uma exceção fora do contrato dela após ${duracaoMs}ms: ` +
        (e instanceof Error ? e.message : String(e)),
    );
  }
  const duracaoMs = Date.now() - inicio;

  if (resultado.falhaTecnica) {
    // `engineProvider`/`engineModel` continuam preenchidos mesmo em falha
    // quando a seleção do motor deu certo — útil para saber ATÉ ONDE chegou.
    console.log(`duração até a falha: ${duracaoMs}ms`);
    console.log(`provider resolvido: ${resultado.engineProvider ?? "(nenhum — falhou antes de selecionar)"}`);
    console.log(`model resolvido: ${resultado.engineModel ?? "(nenhum)"}`);
    bloqueio(`a chamada real não completou — ${resultado.detalhe}`);
  }

  if (resultado.engineProvider !== PROVEDOR_ALVO) {
    // A preferência/o default não resultou no provedor-alvo — o router caiu
    // noutro provider (ou em MOCK). Isto NÃO é a homologação pedida: a missão
    // pede o provedor real via a credencial já configurada.
    bloqueio(
      `o roteador não resolveu para ${PROVEDOR_ALVO} — resolveu para ` +
        `"${resultado.engineProvider ?? "desconhecido"}" (model: ${resultado.engineModel ?? "?"}). ` +
        `Provável causa: ${CREDENCIAL_DO_ALVO} presente mas configuredProviders() não a reconheceu.`,
    );
  }

  const preco = findModelPrice(resultado.engineModel ?? "");

  console.log("");
  console.log("── RESULTADO — CHAMADA REAL COMPLETA ────────────────────────");
  console.log(`duração real medida: ${duracaoMs}ms`);
  console.log(`provider: ${resultado.engineProvider}`);
  console.log(`model: ${resultado.engineModel}`);
  console.log(`veredito devolvido: ${resultado.veredito}`);
  console.log(`motivos: ${resultado.motivos.join(", ") || "(nenhum)"}`);
  console.log(`precisaDeGente: ${resultado.precisaDeGente}`);
  console.log(
    "tokens: indisponível — o adapter atual (AnthropicEngineAdapter.callAnthropic) não expõe " +
      "`usage` do SDK ao chamador (ver comentário no topo deste script para o porquê de não mudar isso aqui).",
  );
  if (preco && preco.billingUnit === "TOKENS") {
    console.log(
      `custo: indisponível (sem tokens reais para multiplicar) — preço público de referência do modelo: ` +
        `US$ ${preco.inputUsdPer1k}/1k tokens de entrada, US$ ${preco.outputUsdPer1k}/1k de saída ` +
        `(${preco.source}, registrado em ${preco.asOf}). NÃO é o custo desta chamada — só a tarifa.`,
    );
  } else {
    console.log("custo: indisponível — modelo fora de modelPricing.ts (tabela de preços conhecidos)");
  }
  console.log("");
  console.log(
    `✓ homologação completa: chamada real ao provedor ${resultado.engineProvider}, ` +
      "sem MOCK, sem dado real de cliente, sem envio de WhatsApp.",
  );
}

main().catch((e) => {
  bloqueio(`erro inesperado no script: ${e instanceof Error ? e.message : String(e)}`);
});
