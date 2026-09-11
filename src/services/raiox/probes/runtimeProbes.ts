/**
 * Raio-X — sondas do ESTADO DE OPERAÇÃO (puras).
 *
 * Leem a amostra do banco e respondem perguntas de dinheiro e de trabalho
 * preso. Onde as sondas de código olham "o que pode dar errado", estas olham
 * "o que já está dando errado agora e ninguém viu".
 *
 * Regra de escrita seguida em todas: nenhum adjetivo sem número, e nenhum
 * número sem o caso concreto ao lado. Alerta que diz "algo parece errado" sem
 * o identificador é ruído — em duas semanas ninguém lê o relatório.
 */

import { requireBlock, type RaioXFinding, type RaioXProbe, type RaioXSample } from "../types";

const N = (n: number) => n.toLocaleString("pt-BR");
const BRL = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const USD = (micro: number) => `US$ ${(micro / 1_000_000).toFixed(2)}`;
const pct = (part: number, total: number) => (total === 0 ? 0 : Math.round((part / total) * 1000) / 10);

// ─────────────────────────────────────────────────────────────────────────────

export const iaCustoProbe: RaioXProbe = {
  id: "ia-custo",
  area: "IA",
  question: "quanto a IA consumiu nas últimas 24 horas, por motor, e quanto disso foi desperdício?",
  run(sample: RaioXSample): RaioXFinding[] {
    const s = requireBlock(sample.ai, "log de chamadas de IA");
    const metrics = {
      chamadas: s.totalCalls,
      falhas: s.totalFailures,
      custoConhecidoMicroUsd: s.knownCostMicroUsd,
      chamadasSemPreco: s.unpricedCalls,
      motores: s.byModel.length,
    };
    const top = [...s.byModel].sort((a, b) => b.knownCostMicroUsd - a.knownCostMicroUsd).slice(0, 5);
    const linhaMotores = top.map((m) => {
      const lacuna = m.unpricedCalls > 0 ? ` · ${N(m.unpricedCalls)} sem preço conhecido` : "";
      return `${m.model}: ${N(m.calls)} chamadas · ${USD(m.knownCostMicroUsd)} · ${N(m.failures)} falhas${lacuna}`;
    });

    const out: RaioXFinding[] = [];

    // O total declara a PRÓPRIA lacuna. Um número de dinheiro que esconde quantas
    // linhas ficaram de fora é da mesma família do "Total hoje" que mentia:
    // quem lê não tem como saber que está vendo só uma parte. Guardrail 6.
    const temLacuna = s.unpricedCalls > 0;
    const ressalva = temLacuna
      ? ` NÃO inclui ${N(s.unpricedCalls)} chamada(s) de custo indeterminado (${s.unpricedModels.join(", ")}) — o gasto real é MAIOR que este número.`
      : "";

    // O número do dia sempre sobe, mesmo quando está tudo bem: é ele que dá
    // sentido ao "contra ontem" da próxima madrugada.
    out.push({
      probeId: "ia-custo",
      area: "IA",
      // Lacuna de preço não é PASS: o relatório não consegue responder a pergunta
      // que a sonda faz ("quanto a IA consumiu") enquanto houver chamada sem preço.
      status: temLacuna ? "WARNING" : "PASS",
      severity: temLacuna ? "P2" : "INFO",
      title: temLacuna
        ? "Consumo de IA nas últimas 24h (parcial — há modelo sem preço)"
        : "Consumo de IA nas últimas 24h",
      summary:
        `${N(s.totalCalls)} chamadas, ${USD(s.knownCostMicroUsd)} de custo conhecido, ` +
        `em ${N(s.byModel.length)} motor(es).${ressalva}`,
      evidence: linhaMotores.length > 0 ? linhaMotores : ["nenhuma chamada registrada na janela"],
      metrics,
      recommendation: temLacuna
        ? `Somar preço de ${s.unpricedModels.join(", ")} em src/services/ai/pricing/modelPricing.ts. Até lá o custo relatado é piso, não total.`
        : "Número de acompanhamento. A leitura importante é a variação contra ontem.",
    });

    // Falha é dinheiro gasto sem resposta ao cliente. 10% com volume mínimo é o
    // ponto em que deixa de ser azar de rede.
    const taxa = pct(s.totalFailures, s.totalCalls);
    if (s.totalCalls >= 20 && taxa >= 10) {
      out.push({
        probeId: "ia-custo",
        area: "IA",
        status: "FAIL",
        severity: "P1",
        title: "Chamadas de IA falhando em série",
        summary: `${N(s.totalFailures)} de ${N(s.totalCalls)} chamadas falharam (${taxa}%) nas últimas 24h.`,
        evidence: s.failureSamples
          .slice(0, 5)
          .map((f) => `${f.model} · restaurante ${f.restaurantId ?? "(sem dono)"} · ${f.error.slice(0, 160)}`),
        metrics: { ...metrics, taxaFalhaPct: taxa },
        recommendation:
          "Cada falha é token pago sem resposta ao cliente. Ver se é cota, chave ou tempo esgotado — as três têm remédios diferentes.",
      });
    }

    return out;
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const iaRetrabalhoProbe: RaioXProbe = {
  id: "ia-retrabalho",
  area: "IA",
  question: "há conversa consumindo IA repetidamente sem virar pedido?",
  run(sample: RaioXSample): RaioXFinding[] {
    const s = requireBlock(sample.ai, "log de chamadas de IA");
    // 15 chamadas numa conversa é muito acima do atendimento normal; sem pedido
    // no fim, é retrabalho puro — a mesma pergunta processada de novo.
    const LIMITE = 15;
    const pesadas = s.heaviestConversations.filter((c) => c.calls >= LIMITE && c.producedOrder === false);
    const custo = pesadas.reduce((a, c) => a + c.knownCostMicroUsd, 0);
    const semPreco = pesadas.reduce((a, c) => a + c.unpricedCalls, 0);
    const metrics = {
      conversasCaras: pesadas.length,
      custoDesperdicadoConhecidoMicroUsd: custo,
      chamadasSemPreco: semPreco,
      limiteChamadas: LIMITE,
    };
    // Mesma regra do total: se alguma chamada dessas conversas não tem preço, o
    // desperdício informado é piso, e o relatório diz isso.
    const ressalva = semPreco > 0
      ? ` (sem contar ${N(semPreco)} chamada(s) de custo indeterminado — o desperdício real é maior)`
      : "";

    if (pesadas.length === 0) {
      return [
        {
          probeId: "ia-retrabalho",
          area: "IA",
          status: "PASS",
          severity: "INFO",
          title: "Sem conversa em retrabalho",
          summary: `Nenhuma conversa passou de ${LIMITE} chamadas de IA sem gerar pedido nas últimas 24h.`,
          evidence: [`conversas analisadas: ${N(s.heaviestConversations.length)}`],
          metrics,
          recommendation: "Nada a fazer.",
        },
      ];
    }

    return [
      {
        probeId: "ia-retrabalho",
        area: "IA",
        status: "WARNING",
        severity: "P2",
        title: "Conversas que consomem IA e não viram pedido",
        summary:
          `${N(pesadas.length)} conversa(s) passaram de ${LIMITE} chamadas sem gerar pedido, ` +
          `somando ${USD(custo)}${ressalva}. Ou o cliente não está sendo entendido, ou o agente está repetindo a si mesmo.`,
        evidence: pesadas
          .slice(0, 8)
          .map((c) => {
            const lacuna = c.unpricedCalls > 0 ? ` · ${N(c.unpricedCalls)} sem preço` : "";
            return `conversa ${c.conversationId} · ${N(c.calls)} chamadas · ${USD(c.knownCostMicroUsd)}${lacuna} · restaurante ${c.restaurantId}`;
          }),
        metrics,
        recommendation:
          "Abrir uma dessas conversas na Central e ver onde ela trava. Retrabalho de IA é a fatura pagando o mesmo trabalho duas vezes.",
      },
    ];
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const mensagensPresasProbe: RaioXProbe = {
  id: "mensagens-presas",
  area: "Mensagens",
  question: "quantas mensagens saíram com falha declarada ou ficaram penduradas?",
  run(sample: RaioXSample): RaioXFinding[] {
    const s = requireBlock(sample.messages, "mensagens enviadas");
    const metrics = {
      enviadas: s.outboundTotal,
      falhas: s.failed,
      penduradas: s.stuckPending,
    };
    const total = s.failed + s.stuckPending;

    if (total === 0) {
      return [
        {
          probeId: "mensagens-presas",
          area: "Mensagens",
          status: "PASS",
          severity: "INFO",
          title: "Nenhuma mensagem presa",
          summary: `${N(s.outboundTotal)} mensagens saíram nas últimas ${s.windowHours}h, nenhuma com falha declarada pelo provedor.`,
          evidence: [`janela: ${s.windowHours}h`],
          metrics,
          recommendation: "Nada a fazer.",
        },
      ];
    }

    return [
      {
        probeId: "mensagens-presas",
        area: "Mensagens",
        status: "FAIL",
        severity: s.failed > 0 ? "P1" : "P2",
        title: "Mensagens que não chegaram ao cliente",
        summary:
          `${N(s.failed)} com falha declarada e ${N(s.stuckPending)} paradas em "pendente" há mais de ` +
          `${s.pendingAfterMinutes} minutos, de ${N(s.outboundTotal)} enviadas.`,
        evidence: s.samples
          .slice(0, 8)
          .map(
            (m) =>
              `msg ${m.messageId} · conversa ${m.conversationId} · ${m.status} · ${N(m.ageMinutes)} min · ${m.error.slice(0, 120)}`,
          ),
        metrics,
        recommendation:
          "Conferir se é número inválido, janela de 24h da Meta fechada ou credencial vencida. Só conta o que o provedor DECLAROU falho — ausência de confirmação não entra aqui, porque nem todo canal confirma entrega.",
      },
    ];
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const filaImpressaoProbe: RaioXProbe = {
  id: "fila-impressao",
  area: "Operação",
  question: "alguma comanda deixou de sair na cozinha?",
  run(sample: RaioXSample): RaioXFinding[] {
    const s = requireBlock(sample.print, "fila de impressão");
    const metrics = { mortos: s.dead, presos: s.stuckPending, entreguesSemAck: s.claimedStale };

    if (s.dead === 0 && s.stuckPending === 0 && s.claimedStale === 0) {
      return [
        {
          probeId: "fila-impressao",
          area: "Operação",
          status: "PASS",
          severity: "INFO",
          title: "Fila de impressão limpa",
          summary: "Nenhuma comanda esgotou tentativas nem ficou parada além do prazo.",
          evidence: [`prazo considerado: ${s.pendingAfterMinutes} min`],
          metrics,
          recommendation: "Nada a fazer.",
        },
      ];
    }

    // Comanda que não sai é pedido que a cozinha não vê. É o pior efeito
    // operacional do produto e por isso sobe como P0 quando morre de vez.
    return [
      {
        probeId: "fila-impressao",
        area: "Operação",
        status: "FAIL",
        severity: s.dead > 0 ? "P0" : "P1",
        title: s.dead > 0 ? "Comanda que nunca saiu na cozinha" : "Comandas atrasadas na fila",
        summary:
          `${N(s.dead)} comanda(s) esgotaram as tentativas, ${N(s.stuckPending)} estão paradas há mais de ` +
          `${s.pendingAfterMinutes} min e ${N(s.claimedStale)} foram entregues ao Carteiro sem confirmação.`,
        evidence: s.samples
          .slice(0, 8)
          .map(
            (j) =>
              `job ${j.jobId} · pedido ${j.orderId ?? "(teste)"} · ${j.status} · ${N(j.attempts)} tentativas · ${N(j.ageMinutes)} min · ${j.error.slice(0, 100)}`,
          ),
        metrics,
        recommendation:
          "Checar se o Carteiro do restaurante está online. Comanda morta significa pedido pago que a cozinha nunca viu.",
      },
    ];
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const carrinhoParadoProbe: RaioXProbe = {
  id: "carrinho-parado",
  area: "Operação",
  question: "há carrinho ou sessão de pedido acumulando sem prazo de validade?",
  run(sample: RaioXSample): RaioXFinding[] {
    const s = requireBlock(sample.carts, "rascunhos e sessões de pedido");
    const metrics = {
      rascunhosParados: s.staleDrafts,
      valorParadoCents: s.staleDraftsValueCents,
      sessoesVencidasAbertas: s.expiredSessionsNotClosed,
    };

    const out: RaioXFinding[] = [];

    if (s.staleDrafts > 0) {
      out.push({
        probeId: "carrinho-parado",
        area: "Operação",
        status: "WARNING",
        severity: "P2",
        title: "Carrinhos abertos que ninguém vai fechar",
        summary:
          `${N(s.staleDrafts)} rascunhos seguem OPEN há mais de ${s.staleAfterHours}h, somando ${BRL(s.staleDraftsValueCents)} ` +
          `que nunca viraram pedido.`,
        evidence: s.draftSamples
          .slice(0, 6)
          .map((d) => `rascunho ${d.draftId} · restaurante ${d.restaurantId} · ${N(d.ageHours)}h · ${BRL(d.totalCents)}`),
        metrics,
        recommendation:
          "Dois ganhos no mesmo lugar: recuperação de carrinho (receita) e prazo de validade (a tabela para de crescer para sempre).",
      });
    }

    // Sessão vencida e ainda aberta é sinal de que o cron de expiração parou —
    // e o cliente do WhatsApp pode voltar a um carrinho fantasma.
    if (s.expiredSessionsNotClosed > 0) {
      out.push({
        probeId: "carrinho-parado",
        area: "Operação",
        status: "FAIL",
        severity: "P1",
        title: "Sessões de pedido vencidas e ainda abertas",
        summary:
          `${N(s.expiredSessionsNotClosed)} sessão(ões) de pedido por texto passaram do prazo e continuam ativas. ` +
          `O relógio que fecha essas sessões pode ter parado.`,
        evidence: s.sessionSamples
          .slice(0, 6)
          .map((x) => `sessão ${x.sessionId} · ${x.status} · ${N(x.ageHours)}h · restaurante ${x.restaurantId}`),
        metrics,
        recommendation: "Conferir o cron de expiração de sessões antes que um cliente retome um carrinho velho.",
      });
    }

    if (out.length === 0) {
      out.push({
        probeId: "carrinho-parado",
        area: "Operação",
        status: "PASS",
        severity: "INFO",
        title: "Nenhum carrinho encalhado",
        summary: `Nenhum rascunho aberto além de ${s.staleAfterHours}h e nenhuma sessão vencida em aberto.`,
        evidence: [`prazo considerado: ${s.staleAfterHours}h`],
        metrics,
        recommendation: "Nada a fazer.",
      });
    }

    return out;
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const assinaturasProbe: RaioXProbe = {
  id: "assinaturas",
  area: "Dinheiro",
  question: "há dinheiro parado, cobrança errada ou cliente que pagou e não recebeu a conta?",
  run(sample: RaioXSample): RaioXFinding[] {
    const s = requireBlock(sample.billing, "assinaturas e cobranças");
    const metrics = {
      pagouSemConta: s.provisionErrors.length,
      cobrancaPelaMetade: s.priceSyncErrors.length,
      paradasHaDias: s.stalledSubscriptions.length,
      semLinkDePagamento: s.missingPaymentLink.length,
      notasNaFila: s.pendingInvoices,
      notasNaFilaValorCents: s.pendingInvoicesValueCents,
    };

    const out: RaioXFinding[] = [];

    if (s.provisionErrors.length > 0) {
      out.push({
        probeId: "assinaturas",
        area: "Dinheiro",
        status: "FAIL",
        severity: "P0",
        title: "Cliente pagou e a conta não nasceu",
        summary: `${N(s.provisionErrors.length)} assinatura(s) com pagamento confirmado e falha ao criar o restaurante.`,
        evidence: s.provisionErrors.map(
          (e) => `assinatura ${e.subscriptionId} · há ${N(e.ageDays)} dia(s) · ${e.error.slice(0, 160)}`,
        ),
        metrics,
        recommendation: "É o pior caso do domínio: dinheiro recebido, produto não entregue. Resolver hoje.",
      });
    }

    if (s.priceSyncErrors.length > 0) {
      out.push({
        probeId: "assinaturas",
        area: "Dinheiro",
        status: "FAIL",
        severity: "P0",
        title: "Assinatura cobrando metade do valor para sempre",
        summary:
          `${N(s.priceSyncErrors.length)} assinatura(s) falharam ao subir do valor promocional para o valor cheio. ` +
          `Sem correção, a diferença se perde todo mês, em silêncio.`,
        evidence: s.priceSyncErrors.map(
          (e) => `assinatura ${e.subscriptionId} · há ${N(e.ageDays)} dia(s) · ${e.error.slice(0, 160)}`,
        ),
        metrics,
        recommendation: "Reprocessar a elevação de valor no Mercado Pago e conferir o carimbo de sincronização.",
      });
    }

    if (s.stalledSubscriptions.length > 0 || s.missingPaymentLink.length > 0) {
      const parado = s.stalledSubscriptions.reduce((a, x) => a + x.amountCents, 0);
      out.push({
        probeId: "assinaturas",
        area: "Dinheiro",
        status: "WARNING",
        severity: "P1",
        title: "Contratação parada no meio do caminho",
        summary:
          `${N(s.stalledSubscriptions.length)} assinatura(s) há mais de ${s.stalledAfterDays} dias sem avançar ` +
          `(${BRL(parado)} em jogo) e ${N(s.missingPaymentLink.length)} sem link de pagamento gerado.`,
        evidence: [
          ...s.stalledSubscriptions
            .slice(0, 5)
            .map((x) => `assinatura ${x.subscriptionId} · ${x.status} há ${N(x.ageDays)} dia(s) · ${BRL(x.amountCents)}`),
          ...s.missingPaymentLink
            .slice(0, 5)
            .map((x) => `assinatura ${x.subscriptionId} · ${x.status} sem link há ${N(x.ageDays)} dia(s)`),
        ],
        metrics,
        recommendation: "Cada linha é uma venda quase fechada. Um telefonema resolve mais rápido que qualquer código.",
      });
    }

    // A fila de NFS-e da própria Foocci é ESPERADA enquanto o CNPJ não pode
    // emitir. Entra como número acompanhado, nunca como alarme — alarme que se
    // sabe falso ensina a ignorar o relatório.
    out.push({
      probeId: "assinaturas",
      area: "Dinheiro",
      status: "PASS",
      severity: "INFO",
      title: "Notas da Foocci na fila",
      summary:
        `${N(s.pendingInvoices)} nota(s) aguardando emissão, somando ${BRL(s.pendingInvoicesValueCents)}` +
        (s.oldestPendingInvoiceDays !== null ? `; a mais antiga há ${N(s.oldestPendingInvoiceDays)} dia(s).` : "."),
      evidence: ["fila conhecida: emissão represada até o CNPJ da Foocci poder emitir NFS-e"],
      metrics,
      recommendation: "Acompanhar o total. O salto deste número é que interessa, não o número em si.",
    });

    return out;
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const portoesProbe: RaioXProbe = {
  id: "portoes",
  area: "Portões",
  question: "a auditoria de qualidade rodou, e o que ela encontrou?",
  run(sample: RaioXSample): RaioXFinding[] {
    const s = requireBlock(sample.gates, "auditoria de qualidade");
    const metrics = {
      horasDesdeUltimaAuditoria: s.lastRun?.ageHours ?? -1,
      achadosBloqueantes: s.blockingFindings.length,
    };

    // Nunca rodou não é "está tudo bem": é ausência de informação.
    if (!s.lastRun) {
      return [
        {
          probeId: "portoes",
          area: "Portões",
          status: "UNKNOWN",
          severity: "P1",
          title: "Nenhuma auditoria de qualidade registrada",
          summary: "Não existe execução persistida da auditoria noturna. Não sei o estado dos portões.",
          evidence: ["tabela de execuções de auditoria vazia"],
          metrics,
          recommendation: "Rodar a auditoria e conferir se o cron noturno está agendado.",
        },
      ];
    }

    const out: RaioXFinding[] = [];

    // Portão que parou de rodar reprova por construção: não saber é o pior
    // estado possível de um portão.
    if (s.lastRun.ageHours > s.expectedWithinHours) {
      out.push({
        probeId: "portoes",
        area: "Portões",
        status: "FAIL",
        severity: "P0",
        title: "A auditoria de qualidade parou de rodar",
        summary:
          `A última auditoria foi há ${N(Math.round(s.lastRun.ageHours))}h, acima do prazo de ${s.expectedWithinHours}h. ` +
          `Portão que não registra resultado não aprova — bloqueia.`,
        evidence: [`última execução ${s.lastRun.runId} · status ${s.lastRun.globalStatus}`],
        metrics,
        recommendation: "Verificar o agendamento do cron de qualidade e o segredo usado por ele.",
      });
    }

    if (s.blockingFindings.length > 0) {
      out.push({
        probeId: "portoes",
        area: "Portões",
        status: "FAIL",
        severity: "P0",
        title: "Auditoria com achado bloqueante em aberto",
        summary: `${N(s.blockingFindings.length)} achado(s) P0/FAIL na última auditoria (${s.lastRun.runId}).`,
        evidence: s.blockingFindings.map((f) => `${f.auditorId} · ${f.severity} · ${f.title}`),
        metrics,
        recommendation: "Abrir /admin/quality e tratar cada P0 antes de qualquer coisa nova.",
      });
    }

    if (out.length === 0) {
      out.push({
        probeId: "portoes",
        area: "Portões",
        status: "PASS",
        severity: "INFO",
        title: "Auditoria em dia e sem bloqueio",
        summary: `Última auditoria há ${N(Math.round(s.lastRun.ageHours))}h, status ${s.lastRun.globalStatus}, sem P0.`,
        evidence: [`execução ${s.lastRun.runId}`],
        metrics,
        recommendation: "Nada a fazer.",
      });
    }

    return out;
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const cerebroSombraProbe: RaioXProbe = {
  id: "cerebro-sombra",
  area: "Cérebro",
  question: "o raciocínio em sombra está juntando evidência com qualidade, e algo saiu de sombra?",
  run(sample: RaioXSample): RaioXFinding[] {
    const s = requireBlock(sample.brain, "registro de raciocínio em sombra");
    const avaliadas = s.coherencePass + s.coherenceFail + s.coherenceNeedsReview;
    const taxaPass = pct(s.coherencePass, avaliadas);

    // Silêncio por agente: um agente esperado que não grava há mais tempo que a
    // janela dos gates é uma escada de promoção lendo zero. Sem este recorte, um
    // recepcionista movimentado bastava para o Cérebro inteiro parecer saudável.
    const mudos = s.agentesEsperados
      .map((agentId) => {
        const linha = s.porAgente.find((a) => a.agentId === agentId);
        const horas = linha?.ultimaAmostraHorasAtras ?? null;
        return { agentId, horas, nunca: !linha || horas === null };
      })
      .filter((a) => a.nunca || (a.horas ?? 0) > s.silencioAlarmaAposHoras);

    const metrics = {
      amostras: s.shadowSamples,
      coerenciaPassPct: taxaPass,
      coerenciaFalha: s.coherenceFail,
      configsForaDeSombra: s.liveConfigs.length,
      agentesMudos: mudos.length,
    };

    const out: RaioXFinding[] = [];

    if (mudos.length > 0) {
      const dias = Math.round(s.silencioAlarmaAposHoras / 24);
      out.push({
        probeId: "cerebro-sombra",
        area: "Cérebro",
        status: "FAIL",
        severity: "P1",
        title: "Sombra parada: agente em teste que não grava evidência",
        summary:
          `${N(mudos.length)} agente(s) de quem se espera sombra não gravam amostra há mais de ${dias} dia(s). ` +
          `Enquanto isso, o gate de promoção lê ZERO para eles — tempo em sombra sem amostra não é teste, ` +
          `é a aparência de teste.`,
        evidence: mudos.map((a) =>
          a.nunca
            ? `agente "${a.agentId}": NUNCA gravou uma amostra sequer`
            : `agente "${a.agentId}": última amostra há ${N(Math.round((a.horas ?? 0) / 24))} dia(s) (${N(a.horas ?? 0)}h)`,
        ),
        metrics,
        recommendation:
          "Conferir se o caminho que grava está sendo exercitado (para o CRM: CRM_BRAIN_SHADOW_ENABLED=true " +
          "e campanhas com envio real). Não promover nada com base em tempo decorrido — a régua lê os últimos 7 dias.",
      });
    }

    if (s.liveConfigs.length > 0) {
      out.push({
        probeId: "cerebro-sombra",
        area: "Cérebro",
        status: "WARNING",
        severity: "P2",
        title: "Raciocínio livre fora de SHADOW_ONLY",
        summary:
          `${N(s.liveConfigs.length)} restaurante(s) com o raciocínio livre em modo ao vivo. ` +
          `Promoção é ato humano e legítima — este item existe para que ela nunca seja silenciosa.`,
        evidence: s.liveConfigs.map(
          (c) => `restaurante ${c.restaurantId} · modo ${c.mode}${c.paused ? " (pausado)" : ""}`,
        ),
        metrics,
        recommendation: "Confirmar que cada modo ao vivo foi decidido por gente, com data e motivo registrados.",
      });
    }

    if (avaliadas >= 20 && taxaPass < 50) {
      out.push({
        probeId: "cerebro-sombra",
        area: "Cérebro",
        status: "FAIL",
        severity: "P1",
        title: "Coerência do raciocínio em sombra caiu",
        summary: `${taxaPass}% de coerência PASS em ${N(avaliadas)} amostras avaliadas nas últimas ${s.windowHours}h.`,
        evidence: [`PASS ${N(s.coherencePass)} · FALHA ${N(s.coherenceFail)} · REVISAR ${N(s.coherenceNeedsReview)}`],
        metrics,
        recommendation: "Investigar antes de qualquer conversa sobre promoção — a evidência está piorando, não melhorando.",
      });
    }

    const prontoParaAvaliacao =
      avaliadas >= s.promotionThresholds.minSamples && taxaPass >= s.promotionThresholds.minCoherencePassPct;

    // Zero amostra NÃO pode sair como PASS. A versão anterior desta linha
    // anunciava "Evidência de sombra acumulada: 0 amostras" com status PASS — um
    // portão que não registrou resultado se apresentando como saudável. Quando o
    // silêncio já passou dos 7 dias, o FAIL acima já disse o essencial e este
    // aviso seria a mesma notícia duas vezes.
    if (s.shadowSamples === 0 && mudos.length === 0) {
      out.push({
        probeId: "cerebro-sombra",
        area: "Cérebro",
        status: "WARNING",
        severity: "P2",
        title: "Nenhuma amostra de sombra na janela",
        summary:
          `Nenhum raciocínio em sombra foi gravado nas últimas ${s.windowHours}h. Ainda dentro do prazo de ` +
          `${Math.round(s.silencioAlarmaAposHoras / 24)} dia(s), mas nada foi acrescentado à evidência hoje.`,
        evidence:
          s.porAgente.length > 0
            ? s.porAgente.map(
                (a) =>
                  `agente "${a.agentId}": última amostra há ${a.ultimaAmostraHorasAtras === null ? "—" : `${N(a.ultimaAmostraHorasAtras)}h`}`,
              )
            : ["nenhum agente jamais gravou uma amostra"],
        metrics,
        recommendation: "Um dia sem movimento é normal; uma sequência deles vira o alarme de sombra parada.",
      });
      return out;
    }

    if (s.shadowSamples > 0) {
      out.push({
        probeId: "cerebro-sombra",
        area: "Cérebro",
        status: "PASS",
        severity: "INFO",
        title: "Evidência de sombra acumulada",
        summary:
          `${N(s.shadowSamples)} amostras na janela; ${taxaPass}% de coerência PASS entre as ${N(avaliadas)} avaliadas; ` +
          `${N(s.fallbackModes)} caíram no caminho determinístico.` +
          (prontoParaAvaliacao
            ? " Os limiares de amostra e coerência estão atingidos — há material para o CEO avaliar a promoção."
            : ""),
        evidence: [
          `limiares da escada: ≥${s.promotionThresholds.minSamples} amostras e ≥${s.promotionThresholds.minCoherencePassPct}% de coerência PASS`,
          // Por agente, sempre: é o que impede o total de um agente movimentado
          // de cobrir o silêncio de outro.
          ...s.porAgente.map(
            (a) => `agente "${a.agentId}": ${N(a.amostras)} na janela · PASS ${N(a.coherencePass)} · FALHA ${N(a.coherenceFail)}`,
          ),
        ],
        metrics,
        recommendation:
          "A promoção de SHADOW_ONLY para ALLOWLIST é decisão humana. Esta linha prepara a evidência; ela não promove nada.",
      });
    }

    return out;
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const jobsTravadosProbe: RaioXProbe = {
  id: "jobs-travados",
  area: "Operação",
  question: "algum trabalho de fundo começou e nunca terminou?",
  run(sample: RaioXSample): RaioXFinding[] {
    const s = requireBlock(sample.jobs, "trabalhos de fundo");
    const metrics = {
      travados: s.stuck.length,
      enviosDeCampanhaPendentes: s.pendingCampaignSends,
      notasFiscaisPresas: s.stuckFiscalDocs,
    };
    const total = s.stuck.length + s.pendingCampaignSends + s.stuckFiscalDocs;

    if (total === 0) {
      return [
        {
          probeId: "jobs-travados",
          area: "Operação",
          status: "PASS",
          severity: "INFO",
          title: "Nenhum trabalho de fundo travado",
          summary: `Nenhuma importação, extração, campanha ou nota fiscal parada há mais de ${s.stuckAfterHours}h.`,
          evidence: [`prazo considerado: ${s.stuckAfterHours}h`],
          metrics,
          recommendation: "Nada a fazer.",
        },
      ];
    }

    return [
      {
        probeId: "jobs-travados",
        area: "Operação",
        status: "WARNING",
        severity: s.stuckFiscalDocs > 0 ? "P1" : "P2",
        title: "Trabalho começado e nunca terminado",
        summary:
          `${N(s.stuck.length)} trabalho(s) parados há mais de ${s.stuckAfterHours}h, ` +
          `${N(s.pendingCampaignSends)} envio(s) de campanha pendentes e ${N(s.stuckFiscalDocs)} nota(s) fiscal(is) presa(s).`,
        evidence: s.stuck
          .slice(0, 8)
          .map((j) => `${j.kind} ${j.jobId} · ${j.status} · há ${N(j.ageHours)}h · ${j.detail.slice(0, 100)}`),
        metrics,
        recommendation:
          "Trabalho travado ocupa fila e some do radar porque não gera erro. Nota fiscal presa é obrigação legal parada.",
      },
    ];
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const dadoMortoProbe: RaioXProbe = {
  id: "dado-morto",
  area: "Dados",
  question: "que tabela só cresce, e que restaurante parou de operar?",
  run(sample: RaioXSample): RaioXFinding[] {
    const s = requireBlock(sample.data, "volumetria e atividade");
    const metrics: Record<string, number> = {
      restaurantesSilenciosos: s.silentRestaurants.length,
    };
    for (const g of s.growth) {
      metrics[`total_${g.table}`] = g.total;
      metrics[`novos_${g.table}`] = g.addedInWindow;
    }

    const out: RaioXFinding[] = [
      {
        probeId: "dado-morto",
        area: "Dados",
        status: "PASS",
        severity: "INFO",
        title: "Volume das tabelas que só crescem",
        summary: `Crescimento nas últimas ${s.windowHours}h por tabela de registro.`,
        evidence: s.growth.map((g) => `${g.table}: ${N(g.total)} linhas (+${N(g.addedInWindow)} em ${s.windowHours}h)`),
        metrics,
        recommendation:
          "Número de acompanhamento. Tabela de log sem política de expurgo vira custo de banco e lentidão de consulta.",
      },
    ];

    if (s.silentRestaurants.length > 0) {
      out.push({
        probeId: "dado-morto",
        area: "Negócio",
        status: "WARNING",
        severity: "P1",
        title: "Restaurante ativo que parou de vender",
        summary:
          `${N(s.silentRestaurants.length)} restaurante(s) marcados como ativos e sem nenhum pedido há mais de ` +
          `${s.silentAfterDays} dias.`,
        evidence: s.silentRestaurants
          .slice(0, 10)
          .map((r) => `${r.name} (${r.restaurantId}) · ${r.silentDays === null ? "nunca vendeu" : `${N(r.silentDays)} dias sem pedido`}`),
        metrics,
        recommendation:
          "Cliente em silêncio é cancelamento em preparação. Ligar antes de descobrir pela fatura não paga.",
      });
    }

    return out;
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const pulsoNegocioProbe: RaioXProbe = {
  id: "pulso-negocio",
  area: "Negócio",
  question: "os pedidos caíram porque quebrou alguma coisa, ou porque é terça-feira?",
  run(sample: RaioXSample): RaioXFinding[] {
    const s = requireBlock(sample.business, "pedidos por restaurante");
    const metrics = {
      pedidos24h: s.totalOrdersLast24h,
      receita24hCents: s.totalRevenueLast24hCents,
      restaurantes: s.restaurants.length,
    };

    // Só olha quem tem volume: queda de 2 para 0 é ruído; de 8/dia para 0 é
    // sintoma. O relatório precisa dessa distinção para não gritar toda terça.
    const quedas = s.restaurants.filter((r) => r.avgDailyPrevious7d >= 3 && r.ordersLast24h === 0);

    const out: RaioXFinding[] = [
      {
        probeId: "pulso-negocio",
        area: "Negócio",
        status: "PASS",
        severity: "INFO",
        title: "Pedidos nas últimas 24h",
        summary: `${N(s.totalOrdersLast24h)} pedidos, ${BRL(s.totalRevenueLast24hCents)} em ${N(s.restaurants.length)} restaurante(s) ativo(s).`,
        evidence: s.restaurants
          .slice(0, 10)
          .map(
            (r) =>
              `${r.name}: ${N(r.ordersLast24h)} pedido(s) hoje · média ${r.avgDailyPrevious7d.toFixed(1)}/dia nos 7 dias anteriores`,
          ),
        metrics,
        recommendation: "Número de acompanhamento — serve de pano de fundo para todo o resto do relatório.",
      },
    ];

    if (quedas.length > 0) {
      out.push({
        probeId: "pulso-negocio",
        area: "Negócio",
        status: "WARNING",
        severity: "P1",
        title: "Restaurante com movimento e zero pedidos hoje",
        summary:
          `${N(quedas.length)} restaurante(s) com média de 3 ou mais pedidos por dia ficaram em ZERO nas últimas 24h. ` +
          `Pode ser folga — ou pode ser a loja fora do ar.`,
        evidence: quedas.map(
          (r) => `${r.name} (${r.restaurantId}) · média ${r.avgDailyPrevious7d.toFixed(1)}/dia · hoje 0`,
        ),
        metrics,
        recommendation:
          "Cruzar com a fila de impressão e as mensagens presas antes de ligar: se os três acenderem juntos, é falha técnica, não folga.",
      });
    }

    return out;
  },
};

export const RUNTIME_PROBES: readonly RaioXProbe[] = [
  iaCustoProbe,
  iaRetrabalhoProbe,
  mensagensPresasProbe,
  filaImpressaoProbe,
  carrinhoParadoProbe,
  assinaturasProbe,
  portoesProbe,
  cerebroSombraProbe,
  jobsTravadosProbe,
  dadoMortoProbe,
  pulsoNegocioProbe,
];
