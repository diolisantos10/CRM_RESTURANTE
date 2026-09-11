/**
 * montagem — transforma os insumos crus da Sala dos Agentes no contrato da tela.
 *
 * MÓDULO PURO. Nenhum import de `prisma`, `fs`, `process.env` ou rede. Quem lê o
 * mundo é `leitura.ts`; aqui só se DECIDE o estado de cada medida.
 *
 * ── Por que a separação é obrigatória, e não estilo ───────────────────────────
 * Já nos queimou: uma regra correta ficou invisível porque o teste mockava o
 * módulo inteiro que a continha. Com a decisão isolada num módulo puro, o teste
 * alimenta o caso ruim direto e o portão prova a REGRA, não o encanamento.
 *
 * ── A regra que governa cada linha deste arquivo ──────────────────────────────
 * O cartão nunca escreve zero quando a resposta é "não sei". Não existe `?? 0`,
 * `|| 0` nem `Number(x) || 0` em cima de métrica aqui — o tipo `Medida` torna
 * isso desnecessário e o teste `salaSemZeroSilencioso` trava o arquivo.
 */

import type {
  CartaoAgente,
  CartaoMotor,
  EstadoAgente,
  Medida,
  MotorDoAgente,
  SalaDosAgentes,
} from "../salaDosAgentes.types";
import { medido, naoMedido, zeroProvado } from "../salaDosAgentes.types";
import type { AdminAgentProfileView } from "../types";
import {
  aggregateCost,
  agentBucket,
  UNATTRIBUTED,
  UNKNOWN_PROVIDER,
  providerOf,
  type CostBucket,
  type UsageRow,
} from "../../ai/pricing/costAggregation";
import { MODEL_PRICES, type ModelProvider } from "../../ai/pricing/modelPricing";
import type { Amostra } from "./amostra";
import { contarEntradas, diasDesde, type ContagemDeEntradas } from "./contagemDeEntradas";

// ── Constantes de domínio ──────────────────────────────────────────────────────

/** Janela da aba Configurações e das métricas de custo. */
export const JANELA_DIAS = 30;

/**
 * Os cinco Essenciais (doutrina 21, fechada pelo CEO em 07/08/2026). A mesma
 * lista que `elencoObrigatorio.test.ts` protege. Eles vêm com todo projeto e não
 * são apagados — na Sala aparecem marcados para que ninguém proponha aposentar
 * um deles por "não ter trabalhado esta semana".
 */
export const ESSENCIAIS = [
  "qualidade",
  "cerebro",
  "interface",
  "experiencia",
  "seguranca",
] as const;

/**
 * ONDE o custo de IA é efetivamente registrado — apurado por varredura em
 * 28/08/2026, não por memória.
 *
 * `AIInteractionLog` tem DOIS escritores, e cada um cobre uma metade:
 *
 *  1. `AIInteractionLogger.log` chamado de `src/services/ai/AIOrderService.ts:1271`,
 *     sempre com `agentSlug: "waiter"` (`AIOrderService.ts:1256`) — o fluxo de
 *     pedido do Garçom, que nunca passou pelo Brain.
 *  2. `src/services/brain/engines/EngineUsageRecorder.ts`, disparado por
 *     `callStructuredJson` (`OpenAIEngineAdapter.ts`) — o gargalo por onde passa
 *     TODA chamada do Brain. Até 28/08/2026 este caminho lia `completion.usage`
 *     e o descartava: ~20 chamadores de produção gastavam sem deixar rastro.
 *
 * A atribuição por agente vem de `BrainReasoner.reasonAsAgent`, que repassa
 * `req.agentId` e `req.businessId` ao dispatcher — por isso os quatro perfis
 * ativos aparecem abaixo. Chamador que NÃO passa contexto continua sendo
 * contabilizado, no balde "não atribuído": o total é medido, o dono não.
 *
 * O que AINDA fica de fora (não importa `callStructuredJson` e não loga):
 * `WhatsAppReceptionistService`, `AISimulatorService`, `ChatSimService`,
 * `KnowledgeEmbeddingService` (embeddings), `TranscriptionAdapter` (áudio) e
 * `imageEnhancement/providers/openai.ts` (imagem).
 *
 * Consequência que atravessa o arquivo inteiro: **ausência de linha nunca vira
 * `zeroProvado`** para custo. O teste `umUnicoEscritorDeLog` reprova quando um
 * escritor NOVO aparecer no código — porque nesse dia esta frase deixa de ser
 * verdade e o motivo precisa mudar junto.
 */
export const AGENTES_COM_CUSTO_ATRIBUIDO: readonly string[] = [
  "waiter",
  "crm",
  "whatsapp",
  "suporte-tecnico",
];

export const COBERTURA_DO_LOG =
  "o registro de custo cobre o fluxo de pedido do Garçom (src/services/ai/AIOrderService.ts:1271) e " +
  "TODA chamada que passa pelo dispatcher do Brain (src/services/brain/engines/OpenAIEngineAdapter.ts), " +
  "medida desde 28/08/2026; recepcionista do WhatsApp, simulador, laboratório de chat, embeddings, " +
  "transcrição de áudio e geração de imagem chamam IA por fora e ainda não gravam nele";

/** `agentSlug` passou a existir nesta data — nada antes dela pode ser atribuído. */
export const DESDE_QUANDO_HA_ATRIBUICAO = "2026-08-07";

/** Um agente de desenvolvimento é considerado ativo se registrou algo nesta janela. */
export const JANELA_DE_ATIVIDADE_DIAS = 30;

// ── Insumos (o que `leitura.ts` entrega) ──────────────────────────────────────

/** Os três arquivos que descrevem um agente de desenvolvimento, crus. */
export interface ArquivosDoAgenteDeDesenvolvimento {
  /** Nome do arquivo em `.claude/agents`, sem `.md`. */
  readonly slug: string;
  /** `.claude/agents/<slug>.md` */
  readonly perfil: Amostra<string>;
  /** `docs/agents/<slug>/oficina.md` */
  readonly oficina: Amostra<string>;
  /** `docs/agents/<slug>/vitrine.md` */
  readonly vitrine: Amostra<string>;
}

export interface MotorDeProduto {
  readonly provedor: string;
  readonly modelo: string;
}

export interface InsumosDaSala {
  /** Injetado. Nunca `new Date()` dentro da montagem — o teste precisa mandar. */
  readonly agora: Date;
  readonly janelaDias: number;
  readonly perfisDeProduto: Amostra<readonly AdminAgentProfileView[]>;
  /** Motor resolvido pelo roteador do Brain, por slug de agente de produto. */
  readonly motoresPorSlug: Readonly<Record<string, MotorDeProduto>>;
  readonly arquivosDeDesenvolvimento: Amostra<readonly ArquivosDoAgenteDeDesenvolvimento[]>;
  /** Linhas de `AIInteractionLog` na janela. */
  readonly usoDeIA: Amostra<readonly UsageRow[]>;
  /** Provedores com chave configurada NESTE runtime. Não é teste de credencial viva. */
  readonly provedoresLigados: readonly ModelProvider[];
}

// ── Frontmatter dos agentes de desenvolvimento (puro) ─────────────────────────

export interface Frontmatter {
  readonly nome: string | null;
  readonly descricao: string | null;
  readonly ferramentas: readonly string[];
}

/**
 * Lê o cabeçalho YAML de `.claude/agents/<slug>.md`.
 *
 * Não uso um parser de YAML de propósito: o frontmatter aqui tem três campos e
 * um deles é escalar dobrado (`description: >`). Trazer dependência para isso
 * ampliaria a superfície sem ganho, e o teste cobre os 12 arquivos reais.
 */
export function lerFrontmatter(md: string): Frontmatter {
  const bloco = /^---\s*\n([\s\S]*?)\n---\s*(\n|$)/.exec(md);
  if (!bloco) return { nome: null, descricao: null, ferramentas: [] };
  const corpo = bloco[1]!;

  const nome = /^name:\s*(\S+)\s*$/m.exec(corpo)?.[1] ?? null;

  const ferramentasBrutas = /^tools:\s*\[(.*?)\]\s*$/m.exec(corpo)?.[1] ?? "";
  const ferramentas = ferramentasBrutas
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  return { nome, descricao: lerDescricao(corpo), ferramentas };
}

function lerDescricao(corpo: string): string | null {
  const linhas = corpo.split(/\r?\n/);
  const i = linhas.findIndex((l) => /^description:/.test(l));
  if (i < 0) return null;

  const mesmaLinha = linhas[i]!.replace(/^description:\s*/, "").replace(/^[|>][-+]?\s*$/, "").trim();
  const partes: string[] = mesmaLinha ? [mesmaLinha] : [];
  for (let j = i + 1; j < linhas.length; j++) {
    const l = linhas[j]!;
    if (!/^\s/.test(l)) break; // saiu do escalar dobrado
    const t = l.trim();
    if (t === "") break;
    partes.push(t);
  }
  const texto = partes.join(" ").trim();
  return texto.length > 0 ? texto : null;
}

/**
 * A função do agente em UMA frase — a linha que o dono lê no cartão.
 *
 * Deriva do `description:` do próprio perfil (dado, não invenção). O prefixo
 * "Use para " é linguagem de despacho e sai; frase longa demais é cortada no
 * primeiro dois-pontos, que nestes arquivos separa o assunto da enumeração.
 */
export function funcaoEmUmaFrase(descricao: string | null): string | null {
  if (!descricao) return null;
  let t = descricao.replace(/\s+/g, " ").trim();
  t = t.replace(/^Use\s+para\s+/i, "");

  const fim = t.search(/\.(\s|$)/);
  if (fim > 0) t = t.slice(0, fim);

  if (t.length > 180) {
    const doisPontos = t.indexOf(":");
    if (doisPontos >= 30) t = t.slice(0, doisPontos);
  }
  t = t.trim();
  if (t.length === 0) return null;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Nome de exibição, extraído da primeira linha do corpo do perfil
 * (`Você é o especialista do **Cérebro** do Foocci`). Confirmado nos 12 arquivos
 * em 07/08. Quando não casa, cai no slug — que é fato, não chute.
 */
export function nomeLegivel(md: string, slug: string): string {
  const m = /Você é\s+(?:o|a)\s+[^*\n]{0,60}\*\*([^*\n]{1,60})\*\*/.exec(md);
  const bruto = m?.[1]?.trim();
  if (!bruto) return slug;
  return bruto.charAt(0).toUpperCase() + bruto.slice(1);
}

// ── Medidas dos agentes de desenvolvimento ────────────────────────────────────

export interface RegistroAvaliado {
  readonly medida: Medida;
  readonly contagem: ContagemDeEntradas | null;
}

/**
 * O estado da medida de UM arquivo de registro (oficina ou vitrine).
 *
 * Quatro saídas e nenhuma delas é um zero de conveniência:
 *   arquivo não lido  → naoMedido com o motivo da leitura
 *   formato estranho  → naoMedido com a primeira linha como evidência
 *   arquivo sem nada  → zeroProvado (o único zero honesto desta tela)
 *   formato conhecido → medido
 */
export function avaliarRegistro(
  amostra: Amostra<string>,
  rotuloDoArquivo: string,
  agora: Date,
): RegistroAvaliado {
  if (!amostra.ok) {
    return { medida: naoMedido(`${rotuloDoArquivo}: ${amostra.motivo}`), contagem: null };
  }
  const contagem = contarEntradas(amostra.dados, agora);

  if (contagem.formato === "desconhecido") {
    const amostraLinha = contagem.amostraNaoReconhecida
      ? ` A primeira linha de conteúdo é: "${contagem.amostraNaoReconhecida}".`
      : "";
    return {
      medida: naoMedido(
        `${rotuloDoArquivo} tem ${contagem.linhasDeConteudo} linhas de conteúdo em formato não reconhecido ` +
          `(nem seção "## …", nem bloco datado).${amostraLinha} Contar zero aqui seria mentira.`,
      ),
      contagem,
    };
  }
  if (contagem.formato === "vazio") {
    return { medida: zeroProvado(), contagem };
  }
  return { medida: medido(contagem.entradas, "entradas"), contagem };
}

/**
 * Quantas entradas caem na janela — a resposta direta à pergunta do CEO
 * ("quem está sendo usado, quem não está").
 *
 * Foi escolhida no lugar de "dias desde a última entrada" por um detalhe de
 * exibição que vira mentira: nesta tela `zeroProvado` aparece como "—". Em
 * "dias desde a última entrada", zero significa *registrou hoje* — e sairia como
 * um traço, exatamente igual ao agente que nunca registrou nada. Aqui, zero
 * significa "nada nos últimos 30 dias", e o traço lê certo.
 */
export function medidaDeEntradasRecentes(
  contagem: ContagemDeEntradas | null,
  agora: Date,
  janelaDias: number,
  motivoDaFalha?: string,
): Medida {
  // Guardrail 6: o motivo que a tela mostra é o mesmo que explica a falha de
  // leitura — "não pôde ser lida" sem o caminho é ruído que ninguém investiga.
  if (!contagem) return naoMedido(motivoDaFalha ?? "a oficina não pôde ser lida");
  if (contagem.formato === "desconhecido") {
    return naoMedido("o formato da oficina não foi reconhecido — sem data de entrada legível");
  }
  if (contagem.formato === "vazio") return zeroProvado();
  if (contagem.entradasSemData > 0) {
    return naoMedido(
      `${contagem.entradasSemData} de ${contagem.entradas} entradas não têm data legível no título — ` +
        `não dá para dizer quantas caem nos últimos ${janelaDias} dias sem chutar`,
    );
  }
  const recentes = contagem.datas.filter((d) => diasDesde(d, agora) <= janelaDias).length;
  return recentes === 0 ? zeroProvado() : medido(recentes, "entradas");
}

/**
 * O pontinho do agente de desenvolvimento.
 *
 * `desligado` é reservado a quem o Diretor NÃO CONSEGUE despachar (perfil
 * ilegível ou sem `name:` — um perfil malformado é carregado como nada).
 * `atencao` cobre tanto "parado há mais de 30 dias" quanto "não sei dizer" —
 * são leituras diferentes, e por isso cada caso deixa a sua linha em `lacunas`.
 */
export function estadoDeDesenvolvimento(
  frontmatter: Frontmatter,
  perfilLido: boolean,
  contagemDaOficina: ContagemDeEntradas | null,
  agora: Date,
): EstadoAgente {
  if (!perfilLido || !frontmatter.nome) return "desligado";
  if (!contagemDaOficina) return "atencao";
  if (contagemDaOficina.formato !== "cabecalho" && contagemDaOficina.formato !== "datado") {
    return "atencao";
  }
  if (!contagemDaOficina.ultimaData) return "atencao";
  return diasDesde(contagemDaOficina.ultimaData, agora) <= JANELA_DE_ATIVIDADE_DIAS
    ? "trabalhando"
    : "atencao";
}

// ── Medidas dos agentes de produto ────────────────────────────────────────────

function motivoSemAtribuicao(slug: string): string {
  return (
    `nenhuma chamada de IA registra o agente "${slug}". A atribuição por agente ` +
    `(campo agentSlug) nasceu em ${DESDE_QUANDO_HA_ATRIBUICAO} e ${COBERTURA_DO_LOG}. ` +
    `Zero aqui significaria "não gastou", e não é isso que sabemos.`
  );
}

/**
 * Custo em dólares atribuído ao agente na janela.
 *
 * Quatro portas, e três delas NÃO produzem número:
 *   agente sem instrumentação      → naoMedido
 *   nenhuma linha na janela        → naoMedido (a cobertura do log é parcial)
 *   modelo sem preço por token     → naoMedido, com os modelos no motivo
 *   parte precificada, parte não   → naoMedido, com o piso E o buraco no motivo
 *
 * O caso PARTIAL é o mais tentador de arredondar: existe um número real
 * (`knownCostUsd`). Mostrá-lo como "o custo" transformaria um PISO em TOTAL —
 * exatamente a família de defeito do "Total hoje" que somava a página.
 */
export function medidaDeCustoDoAgente(
  slug: string,
  bucket: CostBucket,
  instrumentado: boolean,
): Medida {
  if (!instrumentado || bucket.calls === 0) return naoMedido(motivoSemAtribuicao(slug));

  if (bucket.status === "UNPRICED") {
    return naoMedido(
      `${bucket.calls} chamadas em ${bucket.unpricedModels.join(", ")} — modelo fora da tabela de preços ` +
        `ou cobrado em outra unidade (minuto de áudio, imagem). Custo por token não se aplica.`,
    );
  }
  if (bucket.status === "PARTIAL") {
    return naoMedido(
      `US$ ${bucket.knownCostUsd.toFixed(6)} medidos em ${bucket.calls - bucket.unpricedCalls} de ` +
        `${bucket.calls} chamadas; as outras ${bucket.unpricedCalls} são de ${bucket.unpricedModels.join(", ")}, ` +
        `sem preço por token. O total é desconhecido — o valor medido é piso, não conta fechada.`,
    );
  }
  return bucket.knownCostUsd === 0 ? zeroProvado() : medido(bucket.knownCostUsd, "US$");
}

export function medidaDeChamadas(
  slug: string,
  bucket: CostBucket,
  instrumentado: boolean,
): Medida {
  if (!instrumentado || bucket.calls === 0) return naoMedido(motivoSemAtribuicao(slug));
  return medido(bucket.calls, "chamadas");
}

export function medidaDeTokens(
  slug: string,
  bucket: CostBucket,
  instrumentado: boolean,
): Medida {
  if (!instrumentado || bucket.calls === 0) return naoMedido(motivoSemAtribuicao(slug));
  return bucket.totalTokens === 0 ? zeroProvado() : medido(bucket.totalTokens, "tokens");
}

/** Rótulo humano da área do perfil. Área desconhecida sai crua, nunca traduzida por chute. */
const AREA_EM_PORTUGUES: Readonly<Record<string, string>> = {
  ORCHESTRATOR: "Orquestração",
  SECURITY: "Segurança",
  WAITER: "Atendimento",
  WHATSAPP: "WhatsApp",
  CRM: "Relacionamento",
  UI_UX: "Interface",
  MANUAL: "Manual",
  QA: "Qualidade",
  INTEGRATION: "Integrações",
  BRANDING: "Marca",
  ANALYTICS: "Análise",
  GENERAL: "Geral",
};

export function areaLegivel(area: string): string {
  return AREA_EM_PORTUGUES[area] ?? area;
}

// ── Montagem ──────────────────────────────────────────────────────────────────

export function montarSalaDosAgentes(insumos: InsumosDaSala): SalaDosAgentes {
  const lacunas: string[] = [];
  const agentes: CartaoAgente[] = [];

  const linhas = insumos.usoDeIA.ok ? insumos.usoDeIA.dados : null;
  const relatorio = linhas ? aggregateCost(linhas) : null;

  agentes.push(...montarProduto(insumos, relatorio, lacunas));
  agentes.push(...montarDesenvolvimento(insumos, lacunas));

  const motores = montarMotores(insumos, linhas, relatorio, lacunas);

  // ── Lacunas estruturais: valem sempre, medidas ou não ──────────────────────
  lacunas.push(
    `Data de implantação: nenhuma das duas populações registra quando o agente entrou no ar. ` +
      `O registro de perfis guarda "atualizado em", não "criado em", e o perfil em .claude/agents é um arquivo ` +
      `markdown sem data. Por isso "No ar desde" vem vazio — a alternativa seria inventar.`,
  );
  lacunas.push(
    `Custo de IA: ${COBERTURA_DO_LOG}. O total desta tela é, portanto, um piso do gasto real — nunca a fatura.`,
  );
  lacunas.push(
    `"Ligada", na aba Configurações, quer dizer que a chave do provedor está configurada neste runtime. ` +
      `NÃO é teste de credencial viva: uma chave revogada continua aparecendo como ligada. ` +
      `(Foi assim que o painel de Integrações escreveu "Conectado" com o token morto.)`,
  );

  if (!insumos.usoDeIA.ok) {
    lacunas.push(`Nenhuma métrica de custo pôde ser apurada: ${insumos.usoDeIA.motivo}.`);
  }
  if (!insumos.perfisDeProduto.ok) {
    lacunas.push(`Os agentes de produto não puderam ser listados: ${insumos.perfisDeProduto.motivo}.`);
  }
  if (!insumos.arquivosDeDesenvolvimento.ok) {
    lacunas.push(
      `Os agentes de desenvolvimento não puderam ser listados: ${insumos.arquivosDeDesenvolvimento.motivo}.`,
    );
  }

  return { agentes, motores, lacunas };
}

function montarProduto(
  insumos: InsumosDaSala,
  relatorio: ReturnType<typeof aggregateCost> | null,
  lacunas: string[],
): CartaoAgente[] {
  if (!insumos.perfisDeProduto.ok) return [];

  const cartoes: CartaoAgente[] = [];
  for (const perfil of insumos.perfisDeProduto.dados) {
    const instrumentado =
      relatorio !== null && AGENTES_COM_CUSTO_ATRIBUIDO.includes(perfil.slug);
    const bucket = relatorio
      ? agentBucket(relatorio, perfil.slug)
      : vazio(perfil.slug);

    const ativo = perfil.status === "ACTIVE";
    const estado: EstadoAgente = !ativo
      ? "desligado"
      : bucket.calls > 0
        ? "trabalhando"
        : "atencao";

    const motorConfigurado = insumos.motoresPorSlug[perfil.slug];
    const motor: MotorDoAgente = !ativo
      ? {
          tipo: "naoAplica",
          explicacao: `Perfil em ${perfil.status} — não roda em produção, não tem motor atribuído.`,
        }
      : motorConfigurado
        ? { tipo: "configurado", provedor: motorConfigurado.provedor, modelo: motorConfigurado.modelo }
        : {
            tipo: "naoAplica",
            explicacao: "O roteador do Brain não resolve motor para este slug — não há modelo a exibir.",
          };

    cartoes.push({
      slug: perfil.slug,
      nome: perfil.name,
      funcao: perfil.title ?? perfil.description ?? perfil.mission ?? perfil.slug,
      area: areaLegivel(perfil.area),
      populacao: "produto",
      estado,
      noArDesde: null,
      motor,
      essencial: false,
      metricas: [
        { rotulo: "Chamadas de IA (30d)", medida: medidaDeChamadas(perfil.slug, bucket, instrumentado) },
        { rotulo: "Custo atribuído (30d)", medida: medidaDeCustoDoAgente(perfil.slug, bucket, instrumentado) },
        { rotulo: "Tokens (30d)", medida: medidaDeTokens(perfil.slug, bucket, instrumentado) },
      ],
    });
  }

  const semAtribuicao = insumos.perfisDeProduto.dados
    .filter((p) => p.status === "ACTIVE" && !AGENTES_COM_CUSTO_ATRIBUIDO.includes(p.slug))
    .map((p) => p.slug);
  if (semAtribuicao.length > 0) {
    lacunas.push(
      `Agentes de produto ativos sem custo atribuível: ${semAtribuicao.join(", ")}. ` +
        `Eles aparecem em "atenção" porque não dá para dizer se trabalharam — e não porque estejam quebrados.`,
    );
  }

  if (relatorio) {
    const naoAtribuido = relatorio.byAgent.find((b) => b.key === UNATTRIBUTED);
    if (naoAtribuido && naoAtribuido.calls > 0) {
      lacunas.push(
        `${naoAtribuido.calls} chamadas de IA nos últimos ${insumos.janelaDias} dias não dizem de qual agente vieram ` +
          `(anteriores a ${DESDE_QUANDO_HA_ATRIBUICAO} ou gravadas sem o campo). ` +
          `Elas não foram somadas a nenhum cartão.`,
      );
    }
  }

  return cartoes;
}

function montarDesenvolvimento(insumos: InsumosDaSala, lacunas: string[]): CartaoAgente[] {
  if (!insumos.arquivosDeDesenvolvimento.ok) return [];

  const cartoes: CartaoAgente[] = [];
  const semSala: string[] = [];
  const formatoEstranho: string[] = [];

  for (const arq of insumos.arquivosDeDesenvolvimento.dados) {
    const md = arq.perfil.ok ? arq.perfil.dados : "";
    const frontmatter = lerFrontmatter(md);

    const oficina = avaliarRegistro(arq.oficina, "oficina.md", insumos.agora);
    const vitrine = avaliarRegistro(arq.vitrine, "vitrine.md", insumos.agora);

    if (!arq.oficina.ok) semSala.push(arq.slug);
    if (oficina.contagem?.formato === "desconhecido") formatoEstranho.push(arq.slug);

    cartoes.push({
      slug: arq.slug,
      nome: arq.perfil.ok ? nomeLegivel(md, arq.slug) : arq.slug,
      funcao:
        funcaoEmUmaFrase(frontmatter.descricao) ??
        (arq.perfil.ok
          ? "Perfil sem descrição legível no cabeçalho."
          : `Perfil não lido: ${arq.perfil.motivo}`),
      area: "Desenvolvimento",
      populacao: "desenvolvimento",
      estado: estadoDeDesenvolvimento(frontmatter, arq.perfil.ok, oficina.contagem, insumos.agora),
      noArDesde: null,
      motor: {
        tipo: "naoAplica",
        explicacao:
          "Roda dentro da sessão do Diretor. O modelo é o da sessão, não configuração desta tela — " +
          "um seletor aqui seria um controle que mente.",
      },
      essencial: (ESSENCIAIS as readonly string[]).includes(arq.slug),
      metricas: [
        { rotulo: "Entradas na oficina", medida: oficina.medida },
        { rotulo: "Entradas na vitrine", medida: vitrine.medida },
        {
          rotulo: `Entradas nos últimos ${insumos.janelaDias} dias`,
          medida: medidaDeEntradasRecentes(
            oficina.contagem,
            insumos.agora,
            insumos.janelaDias,
            arq.oficina.ok ? undefined : `oficina.md: ${arq.oficina.motivo}`,
          ),
        },
      ],
    });
  }

  if (semSala.length > 0) {
    lacunas.push(
      `Sem sala em docs/agents: ${semSala.join(", ")}. Sala nasce sob demanda, então isto pode ser ` +
        `agente novo — mas o trabalho dele não é mensurável até a primeira entrada.`,
    );
  }
  if (formatoEstranho.length > 0) {
    lacunas.push(
      `Oficina em formato não reconhecido: ${formatoEstranho.join(", ")}. A contagem ficou "não medido" ` +
        `de propósito — devolver zero apagaria trabalho que existe.`,
    );
  }

  return cartoes;
}

/** Frase fixa do provedor + os modelos que ESTE projeto realmente chama. */
const PARA_QUE_SERVE: Readonly<Record<string, string>> = {
  OPENAI: "Conversa do Garçom e do recepcionista, embeddings do conhecimento, transcrição de áudio e geração de imagem",
  ANTHROPIC: "Motor alternativo do roteador do Brain (raciocínio)",
  GOOGLE: "Motor alternativo do roteador do Brain (raciocínio)",
  INTERNAL: "Motores determinísticos locais — não chamam API paga",
};

const ROTULO_DO_PROVEDOR: Readonly<Record<string, string>> = {
  OPENAI: "OpenAI",
  ANTHROPIC: "Anthropic (Claude)",
  GOOGLE: "Google (Gemini)",
  INTERNAL: "Motor interno",
};

function montarMotores(
  insumos: InsumosDaSala,
  linhas: readonly UsageRow[] | null,
  relatorio: ReturnType<typeof aggregateCost> | null,
  lacunas: string[],
): CartaoMotor[] {
  const provedores = [...new Set(MODEL_PRICES.map((p) => p.provider))];
  const usoPorProvedor = mapaProvedorParaAgentes(linhas);

  const cartoes: CartaoMotor[] = provedores.map((provedor) => {
    const modelos = MODEL_PRICES.filter((p) => p.provider === provedor).map((p) => p.model);
    const bucket = relatorio?.byProvider.find((b) => b.key === provedor) ?? null;

    return {
      provedor: ROTULO_DO_PROVEDOR[provedor] ?? provedor,
      ligada: provedor === "INTERNAL" ? true : insumos.provedoresLigados.includes(provedor),
      paraQueServe: `${PARA_QUE_SERVE[provedor] ?? "Uso não declarado"} — modelos: ${modelos.join(", ")}`,
      custo30Dias: custoDoProvedor(provedor, bucket, relatorio !== null, insumos.janelaDias),
      usadaPor: [...(usoPorProvedor.get(provedor) ?? [])].sort(),
    };
  });

  // Chamadas a modelos que a tabela de preços não conhece existem de verdade e
  // custam dinheiro de verdade. Sem cartão próprio elas sumiriam da tela.
  const desconhecido = relatorio?.byProvider.find((b) => b.key === UNKNOWN_PROVIDER);
  if (desconhecido && desconhecido.calls > 0) {
    cartoes.push({
      provedor: "Não identificado",
      ligada: true,
      paraQueServe: `Chamadas a modelos fora da tabela de preços: ${desconhecido.unpricedModels.join(", ")}`,
      custo30Dias: naoMedido(
        `${desconhecido.calls} chamadas em ${desconhecido.unpricedModels.join(", ")} — ` +
          `modelo não precificado. Não são cobradas ao preço de nenhum outro modelo.`,
      ),
      usadaPor: [...(usoPorProvedor.get(UNKNOWN_PROVIDER) ?? [])].sort(),
    });
    lacunas.push(
      `${desconhecido.calls} chamadas de IA usaram modelos fora da tabela de preços ` +
        `(${desconhecido.unpricedModels.join(", ")}). O custo delas é desconhecido e não entrou em nenhuma soma.`,
    );
  }

  return cartoes;
}

function custoDoProvedor(
  provedor: string,
  bucket: CostBucket | null,
  houveLeitura: boolean,
  janelaDias: number,
): Medida {
  /*
    O motor interno é o único zero CONHECIDO da aba: `mock` e `local` são
    determinísticos e não chamam API paga (`billingUnit: "NONE"` na tabela de
    preços, que os classifica como FREE). Aqui zero não é ausência de dado — é o
    dado. Escrever "não medido" neste cartão ensinaria o dono a ignorar o
    "não medido" dos outros, que significa outra coisa.
  */
  if (provedor === "INTERNAL") return zeroProvado();

  if (!houveLeitura) {
    return naoMedido("o registro de chamadas de IA não pôde ser lido");
  }
  if (!bucket || bucket.calls === 0) {
    return naoMedido(
      `nenhuma chamada deste provedor chegou ao registro nos últimos ${janelaDias} dias, e ${COBERTURA_DO_LOG}. ` +
        `Escrever zero aqui afirmaria que não houve gasto — e não sabemos disso.`,
    );
  }
  if (bucket.status === "UNPRICED") {
    return naoMedido(
      `${bucket.calls} chamadas em ${bucket.unpricedModels.join(", ")} — cobradas por minuto de áudio, ` +
        `por imagem ou fora da tabela. Custo por token não se aplica e não entra na soma.`,
    );
  }
  if (bucket.status === "PARTIAL") {
    return naoMedido(
      `US$ ${bucket.knownCostUsd.toFixed(6)} medidos em ${bucket.calls - bucket.unpricedCalls} de ` +
        `${bucket.calls} chamadas; ${bucket.unpricedCalls} em ${bucket.unpricedModels.join(", ")} sem preço ` +
        `por token. O total do provedor é desconhecido.`,
    );
  }
  return bucket.knownCostUsd === 0 ? zeroProvado() : medido(bucket.knownCostUsd, "US$");
}

/** Quais agentes usaram cada provedor. Vazio enquanto o log não atribuir agente. */
function mapaProvedorParaAgentes(linhas: readonly UsageRow[] | null): Map<string, Set<string>> {
  const mapa = new Map<string, Set<string>>();
  if (!linhas) return mapa;
  for (const linha of linhas) {
    const slug = typeof linha.agentSlug === "string" ? linha.agentSlug.trim() : "";
    if (slug === "") continue; // sem agente NÃO vira "usado por ninguém" nem por todos
    const chave = providerOf(linha.model);
    const conjunto = mapa.get(chave) ?? new Set<string>();
    conjunto.add(slug);
    mapa.set(chave, conjunto);
  }
  return mapa;
}

/** Balde vazio para quando não houve leitura — nunca some com balde medido. */
function vazio(key: string): CostBucket {
  return {
    key,
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    knownCostUsd: 0,
    unpricedCalls: 0,
    unpricedModels: [],
    status: "NO_USAGE",
  };
}
