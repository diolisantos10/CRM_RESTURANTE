/**
 * Raio-X noturno — contratos (módulo PURO).
 *
 * O raio-x tem duas metades e este módulo é a primeira: a COLETA determinística.
 * Ela varre o sistema e produz EVIDÊNCIA — números, identificadores, casos
 * concretos. A leitura (o relatório de negócio) é feita depois, por uma sessão
 * humana/dirigida, sobre o que está aqui. A separação é o ponto do desenho:
 * coleta que depende de IA erra diferente toda noite, e aí "piorou desde ontem"
 * deixa de significar alguma coisa.
 *
 * Três invariantes que a modelagem sustenta por construção, não por convenção:
 *
 *  1. AUSÊNCIA DE DADO NÃO É "ESTÁ TUDO BEM" (guardrail 1). Todo pedaço da
 *     amostra é um `Block<T>`: ou veio (`ok: true`) ou não veio, com o motivo.
 *     A sonda nunca recebe zero no lugar de "não consegui ler" — ela nem chega
 *     a rodar: o orquestrador emite `UNKNOWN` no lugar dela.
 *
 *  2. SONDA QUE NÃO REGISTROU RESULTADO REPROVA (guardrail 2). Sonda que
 *     devolve lista vazia, ou que explode, vira `UNKNOWN`, e qualquer `UNKNOWN`
 *     impede o veredito global de ser `PASS`. Esquecer nunca vira "aprovado".
 *
 *  3. ACHADO CARREGA A PRÓPRIA EVIDÊNCIA (guardrail 6). `evidence` é o caso
 *     concreto (id, número, nome) e `metrics` são os números comparáveis com a
 *     execução de ontem. Achado sem evidência é ruído que ninguém investiga.
 *
 * Este arquivo não importa prisma, nem rede, nem runtime. Quem fala com o banco
 * é `collect/` — e só ele. Ver `noSideEffects.test.ts`.
 */

/** Veredito de um achado. `UNKNOWN` = a sonda não conseguiu concluir. */
export type RaioXStatus = "PASS" | "WARNING" | "FAIL" | "UNKNOWN";

/** Gravidade. `INFO` = número de acompanhamento, sem ação exigida. */
export type RaioXSeverity = "P0" | "P1" | "P2" | "INFO";

/** Área de negócio do achado — é por ela que o relatório se organiza. */
export type RaioXArea =
  | "IA"
  | "Mensagens"
  | "Operação"
  | "Dinheiro"
  | "Portões"
  | "Cérebro"
  | "Dados"
  | "Negócio";

/**
 * Um pedaço da amostra. Ou veio, ou não veio COM MOTIVO — nunca "veio vazio"
 * por omissão. É aqui que o guardrail 1 vira tipo.
 */
export type Block<T> = { ok: true; data: T } | { ok: false; reason: string };

/** Atalho para declarar um bloco indisponível com o motivo. */
export function unavailable<T>(reason: string): Block<T> {
  return { ok: false, reason };
}

/** Atalho para declarar um bloco disponível. */
export function available<T>(data: T): Block<T> {
  return { ok: true, data };
}

/**
 * Lançada por `requireBlock` quando a sonda depende de um bloco que não veio.
 * O orquestrador a distingue de um defeito da sonda: o primeiro é "não sei", o
 * segundo é "a sonda quebrou". Os dois viram UNKNOWN, com textos diferentes.
 */
export class DataUnavailableError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "DataUnavailableError";
  }
}

/**
 * Extrai os dados de um bloco ou interrompe a sonda com "não sei".
 * A sonda NUNCA deve inspecionar `block.ok` para seguir com valores default —
 * seria transformar ausência de dado em informação.
 */
export function requireBlock<T>(block: Block<T>, what: string): T {
  if (!block.ok) throw new DataUnavailableError(`${what} — ${block.reason}`);
  return block.data;
}

// ── achado ────────────────────────────────────────────────────────────────────

export interface RaioXFinding {
  /** Id estável da sonda que produziu o achado (chave de comparação). */
  probeId: string;
  area: RaioXArea;
  status: RaioXStatus;
  severity: RaioXSeverity;
  /** Frase curta, em português, que o relatório pode usar como título. */
  title: string;
  /** O que é, com o número. Sem adjetivo sem número. */
  summary: string;
  /** Casos concretos: ids, nomes, valores. Sanitizado na persistência. */
  evidence: string[];
  /**
   * Números comparáveis entre execuções. A chave é estável e o valor é
   * numérico — é o que permite dizer "37, contra 4 ontem".
   */
  metrics: Record<string, number>;
  /**
   * Variação contra a execução anterior, por chave de `metrics`.
   * `null` = sem base de comparação (primeira execução, ou métrica nova).
   * Ausência de base NÃO vira zero — zero significaria "estável".
   */
  deltas?: Record<string, number | null>;
  recommendation: string;
}

// ── amostra ───────────────────────────────────────────────────────────────────

export interface AiCallGroup {
  /** Modelo/motor conforme registrado no log (ex.: "gpt-4o-mini"). */
  model: string;
  calls: number;
  failures: number;
  totalTokens: number;
  /**
   * Custo em micro-dólares das chamadas que SABEMOS precificar (inteiro; evita
   * float em dinheiro). Chamadas sem preço conhecido NÃO entram aqui — elas são
   * contadas em `unpricedCalls`. O nome diz "known" de propósito: um campo
   * chamado `cost` que na verdade é o custo de um subconjunto mente.
   */
  knownCostMicroUsd: number;
  /** Chamadas cujo custo é INDETERMINADO (modelo não precificado). */
  unpricedCalls: number;
}

export interface AiConversationLoad {
  conversationId: string;
  /** `null` quando a conversa não pertence a um restaurante. */
  restaurantId: string | null;
  calls: number;
  knownCostMicroUsd: number;
  /** Chamadas desta conversa sem custo conhecido. */
  unpricedCalls: number;
  /** A conversa gerou pedido/rascunho? `null` = a conversa não foi encontrada. */
  producedOrder: boolean | null;
}

export interface AiSample {
  windowHours: number;
  totalCalls: number;
  totalFailures: number;
  /**
   * Soma do custo CONHECIDO. Não é "o custo total" enquanto
   * `unpricedCalls > 0` — e é por isso que o relatório precisa declarar a
   * lacuna junto com o número.
   */
  knownCostMicroUsd: number;
  /** Quantas chamadas da janela ficaram sem custo conhecido. */
  unpricedCalls: number;
  /** Quais modelos causaram a lacuna — o alerta carrega a própria evidência. */
  unpricedModels: string[];
  byModel: AiCallGroup[];
  /** Amostras das falhas, já truncadas (mensagem de erro crua). */
  /** `restaurantId: null` = chamada sem restaurante dono (SDR, oficina, FAQ). Não é dado faltando: é dado que não existe. */
  failureSamples: { model: string; error: string; restaurantId: string | null }[];
  /** Conversas mais pesadas na janela, ordem decrescente de chamadas. */
  heaviestConversations: AiConversationLoad[];
}

export interface MessagesSample {
  windowHours: number;
  outboundTotal: number;
  /** Falha DECLARADA pelo provedor (externalStatus/providerError). */
  failed: number;
  /** Enviada e ainda em "pending" há mais de `pendingAfterMinutes`. */
  stuckPending: number;
  pendingAfterMinutes: number;
  samples: {
    messageId: string;
    conversationId: string;
    status: string;
    error: string;
    ageMinutes: number;
  }[];
}

export interface PrintSample {
  /** Jobs que esgotaram tentativas — comanda que não saiu. */
  dead: number;
  /** PENDING mais velhos que `pendingAfterMinutes`. */
  stuckPending: number;
  pendingAfterMinutes: number;
  claimedStale: number;
  samples: {
    jobId: string;
    restaurantId: string;
    orderId: string | null;
    status: string;
    attempts: number;
    ageMinutes: number;
    error: string;
  }[];
}

export interface CartsSample {
  staleAfterHours: number;
  /** Rascunhos OPEN parados além do prazo. */
  staleDrafts: number;
  staleDraftsValueCents: number;
  /** Sessões de pedido por texto vencidas e ainda não expiradas pelo cron. */
  expiredSessionsNotClosed: number;
  draftSamples: { draftId: string; restaurantId: string; ageHours: number; totalCents: number }[];
  sessionSamples: { sessionId: string; restaurantId: string; status: string; ageHours: number }[];
}

export interface BillingSample {
  stalledAfterDays: number;
  /** Pagou e a conta não nasceu — o pior caso deste domínio. */
  provisionErrors: { subscriptionId: string; error: string; ageDays: number }[];
  /** Falha ao elevar o valor no MP: o cliente pagaria metade para sempre. */
  priceSyncErrors: { subscriptionId: string; error: string; ageDays: number }[];
  /** Aceite/pagamento parado há dias. */
  stalledSubscriptions: { subscriptionId: string; status: string; ageDays: number; amountCents: number }[];
  /** Contratação sem link de pagamento gerado. */
  missingPaymentLink: { subscriptionId: string; status: string; ageDays: number }[];
  /** Notas da própria Foocci na fila (fila conhecida — ver a sonda). */
  pendingInvoices: number;
  pendingInvoicesValueCents: number;
  oldestPendingInvoiceDays: number | null;
}

export interface GatesSample {
  /** Última auditoria de qualidade persistida, ou `null` se nunca rodou. */
  lastRun: {
    runId: string;
    globalStatus: string;
    ageHours: number;
    countsBySeverity: Record<string, number>;
  } | null;
  /** Prazo além do qual a auditoria é considerada parada. */
  expectedWithinHours: number;
  /** Títulos dos achados P0/FAIL da última auditoria. */
  blockingFindings: { auditorId: string; severity: string; title: string }[];
}

/**
 * A sombra de UM agente. Existe porque o total agregado esconde o caso que mais
 * importa: um agente parado enquanto outro produz. Antes deste recorte, um
 * recepcionista movimentado bastava para o Cérebro inteiro parecer saudável e a
 * sombra do CRM podia estar morta há meses sem uma linha de alerta.
 */
export interface BrainAgentShadow {
  /** "whatsapp" | "crm" | … — a linha antiga com agentId nulo conta como "whatsapp". */
  agentId: string;
  /** Amostras dentro da janela de coleta (windowHours). */
  amostras: number;
  coherencePass: number;
  coherenceFail: number;
  coherenceNeedsReview: number;
  /**
   * Horas desde a última amostra deste agente em TODA a história da tabela —
   * não só na janela. `null` = o agente nunca gravou uma amostra sequer.
   *
   * É este campo, e não `amostras`, que responde "faz quanto tempo que essa
   * sombra não grava nada". Campanha que não roda hoje é normal; sombra que não
   * grava há uma semana é a régua de promoção lendo zero.
   */
  ultimaAmostraHorasAtras: number | null;
}

export interface BrainSample {
  windowHours: number;
  shadowSamples: number;
  coherencePass: number;
  coherenceFail: number;
  coherenceNeedsReview: number;
  fallbackModes: number;
  /** Configurações fora de SHADOW_ONLY — transparência, não veredito. */
  liveConfigs: { restaurantId: string; mode: string; paused: boolean }[];
  /** Limiares da escada de liberação, para o relatório citar sem inventar. */
  promotionThresholds: { minSamples: number; minCoherencePassPct: number };
  /** Um item por agente que JÁ gravou alguma vez. Agente que nunca gravou não aparece aqui. */
  porAgente: BrainAgentShadow[];
  /**
   * Os agentes de quem se ESPERA evidência de sombra. Declaração humana escrita
   * no coletor — não é inferida do que a tabela contém, senão um agente que
   * nunca gravou nada nunca seria cobrado (o silêncio se autoabsolveria).
   */
  agentesEsperados: string[];
  /** A partir de quantas horas sem gravar a sombra de um agente esperado vira alarme. */
  silencioAlarmaAposHoras: number;
}

export interface StuckJob {
  kind: string;
  jobId: string;
  status: string;
  ageHours: number;
  detail: string;
}

export interface JobsSample {
  stuckAfterHours: number;
  stuck: StuckJob[];
  /** Envios de campanha parados em PENDING. */
  pendingCampaignSends: number;
  /** Notas fiscais de pedido presas em PENDENTE/ERRO. */
  stuckFiscalDocs: number;
}

export interface TableGrowth {
  table: string;
  total: number;
  addedInWindow: number;
}

export interface DataSample {
  windowHours: number;
  growth: TableGrowth[];
  /** Restaurantes ativos (não-demo) sem pedido no período de silêncio. */
  silentRestaurants: { restaurantId: string; name: string; silentDays: number | null }[];
  silentAfterDays: number;
}

export interface RestaurantPulse {
  restaurantId: string;
  name: string;
  ordersLast24h: number;
  /** Média diária dos 7 dias anteriores (sem contar as últimas 24h). */
  avgDailyPrevious7d: number;
  revenueLast24hCents: number;
}

export interface BusinessSample {
  restaurants: RestaurantPulse[];
  totalOrdersLast24h: number;
  totalRevenueLast24hCents: number;
}

// ── amostra do CÓDIGO (os cinco padrões nomeados) ─────────────────────────────
//
// O raio-x não olha o que acabou de mudar (isso é auditoria adversarial, e o CI
// já faz). Olha o que JÁ ESTAVA LÁ e ninguém questiona mais. Estes cinco blocos
// varrem o código-fonte procurando instâncias concretas de padrões que, em
// outro produto da casa, custaram dinheiro por meses sem nunca falhar em voz
// alta.

/** Padrão 5 — porta aberta: rota pública que encosta em chamada paga. */
export interface PublicPaidRoute {
  route: string;
  file: string;
  /** Cadeia de imports até o arquivo que faz a chamada paga. */
  pathToCost: string[];
  /** Defesas encontradas no próprio arquivo da rota (rate limit, assinatura, token). */
  guards: string[];
}

/** Padrão 2 — id aceito sem conferir de quem é. */
export interface UnscopedIdRoute {
  file: string;
  route: string;
  /** Linhas onde um id de dono chega pela requisição. */
  intake: { line: number; snippet: string }[];
  /** Provas de posse encontradas no arquivo (nenhuma = suspeito). */
  ownershipProofs: string[];
}

/** Padrão 3 — promessa que o código não cumpre: veredito escrito como literal. */
export interface HollowCheck {
  file: string;
  line: number;
  field: string;
  snippet: string;
  /** Nome da função onde o literal está, quando identificável. */
  enclosing: string | null;
}

/** Padrão 4 — estado morto: campo gravado que nenhum leitor consome. */
export interface DeadStateField {
  model: string;
  field: string;
  /** Arquivos onde o campo é ESCRITO. */
  writes: { file: string; line: number }[];
  /** Contagem de leituras encontradas (zero = morto). */
  reads: number;
}

/** Padrão 1/5 — retentativa ou laço sem teto, caro quando alcança motor pago. */
export interface UnboundedLoop {
  file: string;
  line: number;
  kind: string;
  snippet: string;
  /** O arquivo alcança uma chamada paga? Eleva de incômodo a sangria. */
  reachesPaidCall: boolean;
}

export interface SourceSample {
  /** Raiz varrida, para a evidência apontar caminho relativo estável. */
  root: string;
  filesScanned: number;
  /** Arquivos que fazem chamada paga (motor de IA, geração de imagem, áudio). */
  paidCallFiles: string[];
  publicPaidRoutes: PublicPaidRoute[];
  /** Rotas públicas que NÃO alcançam chamada paga — o denominador honesto. */
  publicRoutesTotal: number;
  unscopedIdRoutes: UnscopedIdRoute[];
  routesWithIdIntakeTotal: number;
  hollowChecks: HollowCheck[];
  deadStateFields: DeadStateField[];
  schemaFieldsChecked: number;
  unboundedLoops: UnboundedLoop[];
}

/** A amostra completa. JSON-serializável de propósito: é o que torna a coleta reproduzível e testável sem banco. */
export interface RaioXSample {
  collectedAt: Date;
  ai: Block<AiSample>;
  messages: Block<MessagesSample>;
  print: Block<PrintSample>;
  carts: Block<CartsSample>;
  billing: Block<BillingSample>;
  gates: Block<GatesSample>;
  brain: Block<BrainSample>;
  jobs: Block<JobsSample>;
  data: Block<DataSample>;
  business: Block<BusinessSample>;
  source: Block<SourceSample>;
}

// ── sonda ─────────────────────────────────────────────────────────────────────

export interface RaioXContext {
  runId: string;
  now: Date;
}

export interface RaioXProbe {
  id: string;
  area: RaioXArea;
  /** A pergunta de negócio que a sonda responde. Vai no catálogo e no relatório. */
  question: string;
  /**
   * Avalia a amostra. DEVE devolver ao menos um achado — inclusive quando está
   * tudo bem (um `PASS` com o número). Devolver vazio é tratado como "não
   * registrou resultado" e vira UNKNOWN.
   */
  run(sample: RaioXSample, ctx: RaioXContext): RaioXFinding[];
}

// ── resultado ─────────────────────────────────────────────────────────────────

export interface RaioXReport {
  runId: string;
  startedAt: Date;
  finishedAt: Date;
  probeIds: string[];
  findings: RaioXFinding[];
  countsByStatus: Record<RaioXStatus, number>;
  countsBySeverity: Record<RaioXSeverity, number>;
  /**
   * FAIL se houver P0/FAIL · WARNING se houver P1/P2/WARNING/UNKNOWN ·
   * PASS só quando TODAS as sondas registraram resultado e nada acendeu.
   */
  globalStatus: RaioXStatus;
  /** Execução usada como base de comparação, ou `null` se não havia nenhuma. */
  comparedToRunId: string | null;
  comparedToAt: Date | null;
  /** Blocos da amostra que não vieram, com o motivo. Vai inteiro para o relatório. */
  unavailableBlocks: { block: string; reason: string }[];
}

/** Métricas da execução anterior, achatadas em `probeId.metricKey`. */
export type PreviousMetrics = Record<string, number>;
