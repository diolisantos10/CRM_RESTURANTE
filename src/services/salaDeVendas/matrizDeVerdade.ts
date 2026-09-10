/**
 * A MATRIZ DE VERDADE — quantas inteligências existem, de fato.
 *
 * ── O DEFEITO QUE ESTE ARQUIVO EXISTE PARA MATAR ────────────────────────────
 *
 * A tela `/comercial/agentes` mostra nove cartões. Nove cartões parecem nove
 * inteligências autônomas. **São duas.** As outras sete são cargo humano, postura
 * de um runtime que já está na lista, ou ficha sem nada atrás.
 *
 * Isso não é um mal-entendido de quem lê: é o que a tela diz. Cada ficha tem
 * selo de "ligado/desligado", e um selo de estado em cima de uma ficha vazia
 * afirma que existe algo para ligar. Quem abre conta nove, planeja em cima de
 * nove, e descobre a diferença no dia em que precisar de uma das sete.
 *
 * ── E O DEFEITO DENTRO DO DEFEITO: DOIS INTERRUPTORES COM O MESMO NOME ──────
 *
 * `AgentProfile.isRuntimeEnabled` **não liga nada em produção.** Nasce `false`
 * em toda ficha (`defaultAgentProfiles.ts`, `fichasDaEmpresa.ts:373`), e os três
 * lugares que o leem ou só exibem (`agentesComerciais.ts:244`,
 * `painelDeDepartamentos.ts:241`) ou estão atrás de uma flag de ambiente
 * desligada (`AgentProfileService.ts:293`). Quem de fato faz o TA falar é
 * `SdrIaConfig.ligado` — outra coluna, em outra tabela, com outra tela.
 *
 * Um dia alguém vai ligar o `isRuntimeEnabled` acreditando ter ligado o agente,
 * e vai embora achando que o TA está atendendo. Este arquivo escreve os dois
 * lado a lado, com nome e endereço, para que essa confusão não sobreviva a uma
 * leitura.
 *
 * ── A REGRA DE OURO DESTE ARQUIVO ───────────────────────────────────────────
 *
 * **Nada aqui é preenchido por parecer.** Ficha sem executor devolve `null`, e
 * `null` não vira "gpt-4o-mini" porque as outras usam. `provaDeExecucao` é o
 * caminho de um chamador de produção que existe no disco — e o teste lê o disco
 * justamente para que uma prova que deixou de existir derrube a régua em vez de
 * continuar afirmando.
 *
 * ── O QUE É ESTÁTICO E O QUE É MEDIDO ───────────────────────────────────────
 *
 *   · **Estático** (qual arquivo é o executor, qual é o gatilho): a constante
 *     `AFIRMACOES` abaixo. É afirmação verificada à mão, com data — nenhum
 *     código deduz isso, porque não há como deduzir.
 *   · **Medido** (o interruptor está ligado? qual modelo o roteador escolhe?):
 *     `lerRuntimeDaMatriz`, que vai ao banco e ao roteador do Brain.
 *
 * A função que junta os dois é pura. Quem não conseguir medir passa `null`, e a
 * linha sai "não medido" — nunca "desligado", que seria uma afirmação que
 * ninguém fez.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import type { FichaDaEmpresa, ModoDeExecucao } from "@/services/agents/fichasDaEmpresa";

type Cliente = PrismaClient | Prisma.TransactionClient;

// ─── O que a matriz devolve ────────────────────────────────────────────────────

/**
 * O interruptor de verdade de uma ficha — e o que ele **não** é.
 *
 * `naoConfundirCom` não é decoração. A confusão entre `isRuntimeEnabled` e
 * `SdrIaConfig.ligado` é o defeito que esta matriz nasceu para matar, e um campo
 * que só dissesse onde está o interruptor certo deixaria o errado de pé, sem
 * ninguém nunca escrever que ele é o errado.
 */
export interface KillSwitch {
  /** Onde mora o interruptor que de fato liga. `null` = não há o que ligar. */
  onde: string | null;
  /** Está ligado agora? `null` = não medido (nunca "desligado" por omissão). */
  ligado: boolean | null;
  /** O interruptor que PARECE ser este e não é. */
  naoConfundirCom: string | null;
}

export type CodigoDeEstado =
  /** Não há runtime. Cargo humano, ou ficha que ninguém implementou. */
  | "SEM_RUNTIME"
  /** É postura de um runtime que já está nesta lista. Não é um segundo cérebro. */
  | "POSTURA_DE_OUTRO_RUNTIME"
  /** Tem runtime, e o interruptor está desligado. */
  | "DESLIGADO"
  /** Interruptor ligado, mas a entrega ao cliente está barrada por outra chave. */
  | "LIGADO_MAS_MUDO"
  /** Ligado e com entrega liberada: fala com estranho agora. */
  | "LIGADO"
  /** Tem runtime, e ninguém conseguiu ler o estado. */
  | "NAO_MEDIDO";

export interface EstadoAtual {
  codigo: CodigoDeEstado;
  /** Uma frase de gente. É o que a tela escreve. */
  frase: string;
}

export interface LinhaDaMatriz {
  ficha: { numero: string; slug: string; nome: string };
  modoDeclarado: ModoDeExecucao;

  /** Caminho do arquivo que executa esta ficha. `null` = FICHA SEM RUNTIME. */
  executorReal: string | null;
  /**
   * Quando a ficha é POSTURA de outro runtime, o número da ficha que a executa.
   *
   * Recepção e Qualificação não somem da lista e não viram agente independente:
   * elas apontam para o 1.5. Some da lista e a operação perde a régua de cada
   * etapa; vira agente independente e a empresa conta três cérebros onde há um.
   */
  executadaPor: string | null;

  /**
   * O modelo que de fato responde por esta ficha, medido no roteador.
   *
   * `null` quando não existe chamada de modelo no caminho — e este `null` é
   * informação, não lacuna: **Abordagem não usa modelo nenhum.** Ela dispara
   * template homologado pela Meta. Preencher aqui um nome de modelo "porque é
   * um agente de IA" seria inventar um cérebro que não existe.
   */
  modeloReal: string | null;
  /** O nome pelo qual esta ficha aparece no roteamento do Brain. */
  agentId: string | null;
  /** Onde está escrito o que ela diz: prompt publicado, ou política/template. */
  promptOuPolitica: string | null;
  /** O que faz esta ficha acordar. */
  gatilho: string | null;
  ferramentas: string[];
  bancoLido: string[];
  bancoEscrito: string[];

  killSwitch: KillSwitch;
  estadoAtual: EstadoAtual;

  /** Caminho do chamador de PRODUÇÃO. `null` quando não há. Nunca inventado. */
  provaDeExecucao: string | null;
  /** Os demais chamadores de produção. O teste confere todos no disco. */
  outrosChamadores: string[];

  /**
   * O que não cabe em nenhuma coluna e mentiria se ficasse de fora.
   *
   * Existe por causa do 1.8 Closer: a ficha é HUMANA e não tem runtime, mas o
   * TA tem uma postura de fechamento. Apontar `executadaPor` ali marcaria uma
   * ficha humana como tendo runtime — exatamente o erro que o teste caça. A
   * nota diz o fato sem deixar a coluna mentir.
   */
  observacao: string | null;
}

// ─── As afirmações estáticas ──────────────────────────────────────────────────

interface AfirmacaoDeRuntime {
  executorReal: string | null;
  executadaPor: string | null;
  /**
   * Existe chamada de modelo no caminho desta ficha?
   *
   * Separado de `modeloReal` de propósito: o NOME do modelo é medido no
   * roteador e muda por configuração; a EXISTÊNCIA da chamada é fato do código
   * e só muda com deploy. Juntos num campo só, um `null` de medição falha
   * pareceria "esta ficha não usa modelo", que é outra afirmação.
   */
  temChamadaDeModelo: boolean;
  agentId: string | null;
  promptOuPolitica: string | null;
  gatilho: string | null;
  ferramentas: string[];
  bancoLido: string[];
  bancoEscrito: string[];
  killSwitchOnde: string | null;
  killSwitchNaoConfundirCom: string | null;
  /** De que chaves a ENTREGA ao cliente depende, além do interruptor. */
  entregaDependeDe: Array<"canal" | "iaSozinha">;
  provaDeExecucao: string | null;
  outrosChamadores: string[];
  observacao: string | null;
}

/**
 * ⚠️ AFIRMAÇÃO VERIFICADA À MÃO EM 10/09/2026, lendo o código, arquivo por
 * arquivo. Não é gerada, não é inferida do nome da ficha e não se atualiza
 * sozinha.
 *
 * Quem mexer no executor de uma ficha precisa mexer aqui — e o teste
 * `matrizDeVerdade.test.ts` derruba a suíte quando um caminho declarado aqui
 * deixa de existir no disco. É essa a trava: sem ela, esta constante viraria em
 * três meses um documento antigo com cara de verdade corrente, que é pior que
 * documento nenhum. Documento nenhum deixa a dúvida viva; este mataria a dúvida
 * e deixaria o defeito.
 *
 * A chave é o `numero` do catálogo ("1.5"), e não o slug: o número é como o
 * proprietário se refere à ficha e não muda quando alguém reescreve o título.
 */
const AFIRMACOES: Readonly<Record<string, AfirmacaoDeRuntime>> = {
  // 1.1 Agente Gerente Comercial · HUMANO
  "1.1": {
    executorReal: null,
    executadaPor: null,
    temChamadaDeModelo: false,
    agentId: null,
    promptOuPolitica: null,
    gatilho: null,
    ferramentas: [],
    bancoLido: [],
    bancoEscrito: [],
    killSwitchOnde: null,
    killSwitchNaoConfundirCom: null,
    entregaDependeDe: [],
    provaDeExecucao: null,
    outrosChamadores: [],
    observacao: "Cargo humano. Não há código que o execute, e não deve haver.",
  },

  // 1.2 Agente de Abordagem · IA — o único runtime que fala PRIMEIRO.
  "1.2": {
    executorReal: "src/services/salaDeVendas/abordar.ts",
    executadaPor: null,
    // ⚠️ MEDIDO, e é a linha mais contraintuitiva da matriz: `abordar.ts` não
    // importa nada de `services/brain` e não chama modelo nenhum. A abordagem é
    // um template homologado pela Meta com parâmetros preenchidos em código.
    // Ela é "IA" na ficha e determinística no arquivo — e essa diferença é
    // justamente o que a tela precisa parar de esconder.
    temChamadaDeModelo: false,
    agentId: null,
    promptOuPolitica:
      "src/services/foocci-sdr/modelosDaMeta.ts — modelo aprovado pela Meta, sem prompt",
    gatilho: "POST /api/admin/sala-de-vendas/abordagem (a mão) e o cron da rodada de prospecção",
    ferramentas: [
      "FoocciSalesChannel.enviarModeloDeVendas",
      "LeadContactSafety (consentimento, silêncio, janela)",
      "freioDeRitmo",
      "prospeccao/selecao.contarAbordagensDeHoje",
    ],
    bancoLido: ["SiteLead", "ItemDeProspeccao", "LeadMensagem"],
    bancoEscrito: ["LeadMensagem", "SiteLead"],
    killSwitchOnde:
      "FOOCCI_SDR_SEND_ENABLED + canal configurado (canalDeVendasPronto) — ambiente, não banco",
    killSwitchNaoConfundirCom:
      "AgentProfile.isRuntimeEnabled — lido só para exibir; não liga esta ficha",
    entregaDependeDe: ["canal"],
    provaDeExecucao: "src/app/api/admin/sala-de-vendas/abordagem/route.ts",
    outrosChamadores: [
      "src/services/salaDeVendas/prospeccao/abordarDaFila.ts",
      "src/app/api/cron/prospeccao/rodada/route.ts",
      "src/app/api/admin/sala-de-vendas/prospeccao/route.ts",
    ],
    observacao:
      "A única ficha que fala com quem não escreveu. Não usa modelo: dispara template da Meta.",
  },

  // 1.3 Agente de Recepção · IA — POSTURA do TA, não um segundo cérebro.
  "1.3": {
    executorReal: null,
    executadaPor: "1.5",
    // Sem executor próprio, sem modelo próprio. O modelo que atende a recepção
    // é o do 1.5, e é lá que ele está escrito. Repetir o nome do modelo aqui
    // faria a soma da tela contar dois consumidores de IA onde há um.
    temChamadaDeModelo: false,
    agentId: null,
    promptOuPolitica:
      "src/services/salaDeVendas/ta/oficio.ts — OFICIO_DO_ATENDIMENTO, executado pelo 1.5",
    gatilho: "o mesmo do 1.5: mensagem recebida no WhatsApp de vendas",
    ferramentas: [],
    bancoLido: [],
    bancoEscrito: [],
    killSwitchOnde: "o mesmo do 1.5: SdrIaConfig.ligado (slug='ta')",
    killSwitchNaoConfundirCom:
      "AgentProfile.isRuntimeEnabled — lido só para exibir; não liga esta ficha",
    entregaDependeDe: [],
    provaDeExecucao: null,
    outrosChamadores: [],
    observacao:
      "Ficha separada porque o que se MEDE é diferente (segundos até a primeira resposta). " +
      "Runtime é um só.",
  },

  // 1.4 Agente de Qualificação · IA — POSTURA do TA.
  "1.4": {
    executorReal: null,
    executadaPor: "1.5",
    temChamadaDeModelo: false,
    agentId: null,
    promptOuPolitica:
      "src/services/salaDeVendas/ta/sondagem.ts + ta/oficio.ts — executado pelo 1.5",
    gatilho: "o mesmo do 1.5: mensagem recebida no WhatsApp de vendas",
    ferramentas: [],
    bancoLido: [],
    bancoEscrito: [],
    killSwitchOnde: "o mesmo do 1.5: SdrIaConfig.ligado (slug='ta')",
    killSwitchNaoConfundirCom:
      "AgentProfile.isRuntimeEnabled — lido só para exibir; não liga esta ficha",
    entregaDependeDe: [],
    provaDeExecucao: null,
    outrosChamadores: [],
    observacao:
      "Ficha separada porque se mede por cobertura da sondagem. Runtime é o do 1.5.",
  },

  // 1.5 Agente SDR IA — TA · IA — o único cérebro de verdade da Sala.
  "1.5": {
    executorReal: "src/services/salaDeVendas/ta/atender.ts",
    executadaPor: null,
    // MEDIDO: atender.ts → falar.ts → cerebro.ts → callStructuredJson, com o
    // motor escolhido por selectEngineRouted("sdr-ta-foocci").
    temChamadaDeModelo: true,
    agentId: "sdr-ta-foocci",
    promptOuPolitica:
      "src/services/salaDeVendas/ta/ficha.ts (VERSAO_1, publicada como SdrIaConfigVersao) " +
      "+ ta/oficio.ts",
    gatilho: "mensagem recebida no WhatsApp de vendas (webhook da Meta)",
    ferramentas: [
      "ta/conhecimento.ts (base da Foocci)",
      "ta/verdade.ts (tabela de preços)",
      "ta/verificador.ts (reprova a fala antes de sair)",
      "ta/sondagem.ts",
      "score.ts",
      "handoff.ts",
      "entrega.ts",
      "ta/consultarGerente.ts",
    ],
    bancoLido: ["SdrIaConfig", "SiteLead", "LeadMensagem"],
    bancoEscrito: ["LeadMensagem", "SiteLead", "LeadHandoff"],
    killSwitchOnde: "SdrIaConfig.ligado (slug='ta') — ligado pela tela do interruptor",
    killSwitchNaoConfundirCom:
      "AgentProfile.isRuntimeEnabled — nasce false, é lido só para exibir e NÃO liga o TA",
    // Duas chaves além do interruptor, e as duas são de ambiente: o canal envia,
    // e a máquina pode falar sozinha. Ligado sem elas, o TA pensa e grava o que
    // diria — e não fala com ninguém.
    entregaDependeDe: ["canal", "iaSozinha"],
    provaDeExecucao: "src/services/foocci-sdr/FoocciSalesInbound.ts",
    outrosChamadores: [],
    observacao:
      "Executa também a Recepção (1.3) e a Qualificação (1.4), sob uma voz só, " +
      "e tem uma postura de fechamento (ta/oficio.ts, OFICIO_DO_FECHAMENTO).",
  },

  // 1.6 Agente SDR Humano · HUMANO
  "1.6": {
    executorReal: null,
    executadaPor: null,
    temChamadaDeModelo: false,
    agentId: null,
    promptOuPolitica: null,
    gatilho: null,
    ferramentas: [],
    bancoLido: [],
    bancoEscrito: [],
    killSwitchOnde: null,
    killSwitchNaoConfundirCom: null,
    entregaDependeDe: [],
    provaDeExecucao: null,
    outrosChamadores: [],
    observacao: "Cargo humano. A Sala de Vendas é a ferramenta dele, não o executor dele.",
  },

  // 1.7 Agente Consultor · HUMANO
  "1.7": {
    executorReal: null,
    executadaPor: null,
    temChamadaDeModelo: false,
    agentId: null,
    promptOuPolitica: null,
    gatilho: null,
    ferramentas: [],
    bancoLido: [],
    bancoEscrito: [],
    killSwitchOnde: null,
    killSwitchNaoConfundirCom: null,
    entregaDependeDe: [],
    provaDeExecucao: null,
    outrosChamadores: [],
    observacao: "Cargo humano.",
  },

  // 1.8 Agente Closer · HUMANO
  "1.8": {
    executorReal: null,
    executadaPor: null,
    temChamadaDeModelo: false,
    agentId: null,
    promptOuPolitica: null,
    gatilho: null,
    ferramentas: [],
    bancoLido: [],
    bancoEscrito: [],
    killSwitchOnde: null,
    killSwitchNaoConfundirCom: null,
    entregaDependeDe: [],
    provaDeExecucao: null,
    outrosChamadores: [],
    // ⚠️ Aqui mora a tentação. O TA tem `OFICIO_DO_FECHAMENTO`, escolhido por
    // `posturaDoLead` — ou seja, existe comportamento de closer rodando. Mas a
    // FICHA 1.8 é humana e não tem executor: preencher `executadaPor: "1.5"`
    // marcaria um cargo humano como tendo runtime, que é o erro que o teste
    // caça. O fato fica na nota; a coluna continua honesta.
    observacao:
      "Cargo humano. O TA (1.5) tem uma postura de fechamento (OFICIO_DO_FECHAMENTO), " +
      "mas esta ficha não tem executor e não é o TA.",
  },

  // 1.9 Agente CRM e RevOps · HÍBRIDO
  "1.9": {
    executorReal: null,
    executadaPor: null,
    temChamadaDeModelo: false,
    agentId: null,
    promptOuPolitica: null,
    gatilho: null,
    ferramentas: [],
    bancoLido: [],
    bancoEscrito: [],
    killSwitchOnde: null,
    killSwitchNaoConfundirCom: null,
    entregaDependeDe: [],
    provaDeExecucao: null,
    outrosChamadores: [],
    observacao:
      "Híbrida no catálogo, sem executor no código. Hoje é trabalho de gente com relatório.",
  },
};

/**
 * A ficha que não está declarada acima.
 *
 * Sai como SEM RUNTIME, e é o padrão certo: quando alguém escrever a ficha 1.10
 * no catálogo, ela aparece na tela dizendo que não tem runtime — que é a
 * verdade até alguém construir um. O padrão oposto (assumir que tem) faria uma
 * ficha nova nascer com cara de agente ligado.
 */
const SEM_AFIRMACAO: AfirmacaoDeRuntime = {
  executorReal: null,
  executadaPor: null,
  temChamadaDeModelo: false,
  agentId: null,
  promptOuPolitica: null,
  gatilho: null,
  ferramentas: [],
  bancoLido: [],
  bancoEscrito: [],
  killSwitchOnde: null,
  killSwitchNaoConfundirCom: null,
  entregaDependeDe: [],
  provaDeExecucao: null,
  outrosChamadores: [],
  observacao: "Ficha nova no catálogo, ainda não conferida à mão nesta matriz.",
};

// ─── A parte medida ───────────────────────────────────────────────────────────

/**
 * O que só o banco e o roteador sabem.
 *
 * Todo campo aceita `null`, e `null` significa **não medido** — nunca
 * "desligado". Um `false` inventado por falta de leitura seria a mesma classe de
 * erro que esta matriz combate: afirmação sem medição.
 */
export interface LeituraDoRuntime {
  /** `SdrIaConfig.ligado` do slug "ta". */
  taLigado: boolean | null;
  /** Sem versão publicada o TA fica calado mesmo ligado (ta/atender.ts). */
  taTemVersaoPublicada: boolean | null;
  /** `canalDeVendasPronto()`: canal configurado E `FOOCCI_SDR_SEND_ENABLED`. */
  canalEnvia: boolean | null;
  /** `iaRespondeSozinha()`: `FOOCCI_SDR_IA_RESPONDE_SOZINHA`. */
  iaRespondeSozinha: boolean | null;
  /** O motor que o roteador do Brain escolhe para `sdr-ta-foocci`, hoje. */
  modeloDoTA: string | null;
}

/** Uma leitura que não mediu nada. Útil para a tela renderizar sem banco. */
export const NADA_MEDIDO: LeituraDoRuntime = {
  taLigado: null,
  taTemVersaoPublicada: null,
  canalEnvia: null,
  iaRespondeSozinha: null,
  modeloDoTA: null,
};

/**
 * Vai ao banco e ao roteador e traz o que é dinâmico.
 *
 * Cada leitura é protegida por conta própria: o roteador do Brain fora do ar não
 * pode apagar o estado do interruptor, que é a informação mais importante da
 * tela. Um `try` só em volta de tudo transformaria uma falha pequena em "não
 * medido" para a matriz inteira.
 */
export async function lerRuntimeDaMatriz(db: Cliente): Promise<LeituraDoRuntime> {
  const leitura: LeituraDoRuntime = { ...NADA_MEDIDO };

  try {
    const c = await db.sdrIaConfig.findUnique({
      where: { slug: "ta" },
      select: { ligado: true, versaoAtivaId: true },
    });
    // Config ausente é medição válida e significa "não há TA configurado" — não
    // é falha de leitura. Por isso `false`, e não `null`.
    leitura.taLigado = c?.ligado ?? false;
    leitura.taTemVersaoPublicada = Boolean(c?.versaoAtivaId);
  } catch {
    // Fica `null`: a tela escreve "não medido".
  }

  try {
    const { canalDeVendasPronto, iaRespondeSozinha } = await import(
      "@/services/foocci-sdr/FoocciSalesChannel"
    );
    leitura.canalEnvia = canalDeVendasPronto();
    leitura.iaRespondeSozinha = iaRespondeSozinha();
  } catch {
    /* não medido */
  }

  try {
    const { selectEngineRouted } = await import("@/services/brain/engines/AIEngineRouter");
    // O MESMO agentId e o MESMO taskProfile padrão que `ta/cerebro.ts` usa. Medir
    // com outros parâmetros devolveria um modelo que ninguém chama.
    const engine = await selectEngineRouted("sdr-ta-foocci");
    leitura.modeloDoTA = `${engine.provider}/${engine.model}`;
  } catch {
    /* não medido */
  }

  return leitura;
}

// ─── A junção, pura ───────────────────────────────────────────────────────────

function estadoDe(
  modo: ModoDeExecucao,
  a: AfirmacaoDeRuntime,
  leitura: LeituraDoRuntime,
): { estado: EstadoAtual; ligado: boolean | null } {
  if (a.executadaPor) {
    return {
      estado: {
        codigo: "POSTURA_DE_OUTRO_RUNTIME",
        frase: `postura executada pela ficha ${a.executadaPor} — não é um agente separado`,
      },
      ligado: null,
    };
  }

  if (!a.executorReal) {
    return {
      estado: {
        codigo: "SEM_RUNTIME",
        frase:
          modo === "HUMANO"
            ? "cargo humano — não há runtime, e não deve haver"
            : "ficha sem runtime — nenhum código executa esta ficha",
      },
      ligado: null,
    };
  }

  // A partir daqui existe executor. O interruptor de cada um é diferente, e a
  // afirmação estática já disse qual é.
  const ligado =
    a.killSwitchOnde === null
      ? null
      : a.agentId === "sdr-ta-foocci"
        ? // Ligar exige versão publicada, e sem ela o TA fica calado mesmo com a
          // coluna em `true`. Reportar só a coluna diria "ligado" sobre um agente
          // que não abre a boca.
          leitura.taLigado === null || leitura.taTemVersaoPublicada === null
          ? null
          : leitura.taLigado && leitura.taTemVersaoPublicada
        : leitura.canalEnvia;

  if (ligado === null) {
    return {
      estado: { codigo: "NAO_MEDIDO", frase: "não medido — o estado não pôde ser lido" },
      ligado: null,
    };
  }

  if (!ligado) {
    return {
      estado: { codigo: "DESLIGADO", frase: `desligado em ${a.killSwitchOnde}` },
      ligado: false,
    };
  }

  const faltando: string[] = [];
  if (a.entregaDependeDe.includes("canal") && leitura.canalEnvia === false) {
    faltando.push("FOOCCI_SDR_SEND_ENABLED");
  }
  if (a.entregaDependeDe.includes("iaSozinha") && leitura.iaRespondeSozinha === false) {
    faltando.push("FOOCCI_SDR_IA_RESPONDE_SOZINHA");
  }

  if (faltando.length > 0) {
    return {
      estado: {
        codigo: "LIGADO_MAS_MUDO",
        frase: `ligado, mas não entrega: falta ${faltando.join(" e ")}`,
      },
      ligado: true,
    };
  }

  return {
    estado: { codigo: "LIGADO", frase: "ligado e entregando — fala com estranho agora" },
    ligado: true,
  };
}

/**
 * A matriz. Função pura: mesmas fichas e mesma leitura, mesma saída.
 *
 * Pura porque é o que permite testá-la sem banco e sem rede — e uma régua sobre
 * a honestidade da tela que só rodasse com infraestrutura de pé seria uma régua
 * que ninguém roda.
 */
export function matrizDeVerdade(
  fichas: FichaDaEmpresa[],
  leitura: LeituraDoRuntime = NADA_MEDIDO,
): LinhaDaMatriz[] {
  return fichas.map((f) => {
    const a = AFIRMACOES[f.numero] ?? SEM_AFIRMACAO;
    const { estado, ligado } = estadoDe(f.modo, a, leitura);

    return {
      ficha: { numero: f.numero, slug: f.slug, nome: f.nome },
      modoDeclarado: f.modo,
      executorReal: a.executorReal,
      executadaPor: a.executadaPor,
      // A trava contra o defeito que dá nome a este arquivo: sem chamada de
      // modelo declarada, `modeloReal` é null e não há caminho que o preencha.
      modeloReal: a.temChamadaDeModelo ? leitura.modeloDoTA : null,
      agentId: a.agentId,
      promptOuPolitica: a.promptOuPolitica,
      gatilho: a.gatilho,
      ferramentas: a.ferramentas,
      bancoLido: a.bancoLido,
      bancoEscrito: a.bancoEscrito,
      killSwitch: {
        onde: a.killSwitchOnde,
        ligado,
        naoConfundirCom: a.killSwitchNaoConfundirCom,
      },
      estadoAtual: estado,
      provaDeExecucao: a.provaDeExecucao,
      outrosChamadores: a.outrosChamadores,
      observacao: a.observacao,
    };
  });
}

export interface ContagemDaVerdade {
  /** Quantas fichas o catálogo tem. */
  fichas: number;
  /** Quantas têm executor próprio. **É este o número que a empresa tem.** */
  comRuntime: number;
  /** Quantas são postura de um runtime que já foi contado. */
  posturas: number;
  /** Quantas não têm runtime nenhum. */
  semRuntime: number;
  /** Quantas usam modelo de IA de fato. */
  usamModelo: number;
  /** Quantas estão falando com estranho agora. */
  falandoAgora: number;
}

/**
 * A contagem que responde à pergunta de cinco segundos.
 *
 * `comRuntime` não soma posturas de propósito: Recepção e Qualificação rodam no
 * cérebro do TA, e contá-las como runtime devolveria "quatro inteligências" —
 * que é a mentira que esta matriz existe para desfazer.
 */
export function contarAVerdade(linhas: LinhaDaMatriz[]): ContagemDaVerdade {
  return {
    fichas: linhas.length,
    comRuntime: linhas.filter((l) => l.executorReal !== null).length,
    posturas: linhas.filter((l) => l.executadaPor !== null).length,
    semRuntime: linhas.filter((l) => l.executorReal === null && l.executadaPor === null).length,
    usamModelo: linhas.filter((l) => l.agentId !== null).length,
    falandoAgora: linhas.filter((l) => l.estadoAtual.codigo === "LIGADO").length,
  };
}

/**
 * Os caminhos que esta matriz afirma existirem — para o teste conferir no disco.
 *
 * Exportado porque a régua precisa da lista COMPLETA. Um teste que conferisse só
 * os caminhos que ele conhece de cor deixaria passar exatamente a afirmação nova
 * que alguém acabou de escrever sem verificar.
 */
export function caminhosAfirmados(): string[] {
  const todos: string[] = [];
  for (const a of Object.values(AFIRMACOES)) {
    if (a.executorReal) todos.push(a.executorReal);
    if (a.provaDeExecucao) todos.push(a.provaDeExecucao);
    todos.push(...a.outrosChamadores);
  }
  return [...new Set(todos)];
}
