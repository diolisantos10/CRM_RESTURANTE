/**
 * LeadContactSafety — o portão de contato do SDR da Foocci.
 *
 * ── POR QUE NÃO REUSAMOS O PORTÃO DO CRM ─────────────────────────────────────
 * `ContactSafetyService` governa a relação com o cliente **de um restaurante**:
 * ele conta `CampaignExecution`, lê `Customer`, respeita horário de loja. Um lead
 * do site não é nada disso — não tem restaurante, não tem `customerId`, não tem
 * histórico de campanha. Chamar aquele portão com um lead era exatamente a
 * armadilha P0 de `docs/sdr-foocci-desenho.md` (fechada em 14/08 com
 * `UNKNOWN_CONTACT_HISTORY`).
 *
 * Então o SDR tem portão próprio, e ele é **mais rígido** que o do CRM por um
 * motivo que não é técnico: o CRM fala com quem já comprou; o SDR fala com um
 * estranho, em nome da empresa. Estranho tem menos paciência e mais botão de
 * denúncia — e denúncia é o que queima número.
 *
 * ── A REGRA DA CASA, aplicada aqui ───────────────────────────────────────────
 * PURO: sem banco, sem rede, sem relógio escondido (o `agora` entra por
 * parâmetro). Quem busca os dados é o chamador; quem decide é esta função. Assim
 * a decisão é testável caso a caso, e nenhum caminho de envio pode "esquecer" de
 * consultar o portão sem que isso apareça no tipo.
 *
 * NÃO SEI = NÃO. Todo campo que descreve o que sabemos do lead é obrigatório, e
 * há um `historicoConhecido` explícito. Zero tentativas só vale como "nunca
 * abordei" quando alguém realmente contou.
 */

// ─── Motivos ────────────────────────────────────────────────────────────────────

export type LeadBlockReason =
  /** Não foi possível apurar quantas vezes já falamos com esta pessoa. */
  | "HISTORICO_DESCONHECIDO"
  /** A pessoa pediu silêncio. Terminal, todos os canais, para sempre. */
  | "LEAD_OPT_OUT"
  | "LEAD_SEM_TELEFONE"
  | "LEAD_TELEFONE_INVALIDO"
  /** Preencheu o formulário há tempo demais — aquilo já não é interesse vivo. */
  | "CONSENTIMENTO_VENCIDO"
  /** Não há registro de quando (nem se) a pessoa entregou os dados. */
  | "CONSENTIMENTO_DESCONHECIDO"
  /** Fora de 9h–19h, ou fim de semana. Mais rígido que o CRM, de propósito. */
  | "FORA_DA_JANELA"
  /** Já foram feitas as tentativas que o desenho permite (abertura + lembrete). */
  | "TETO_DE_TENTATIVAS"
  /** Já falamos com esta pessoa há pouco — dê espaço. */
  | "DESCANSO_ATIVO"
  /** O canal de vendas não está configurado, ou o envio está desligado. */
  | "CANAL_INDISPONIVEL"
  /** Prospecção fria sem base legal declarada por quem responde pela marca. */
  | "PROSPECCAO_SEM_BASE_LEGAL"
  /** A prospecção está desligada, ou pausada, ou o teto do dia acabou. */
  | "PROSPECCAO_DESLIGADA";

export interface LeadSafetyDecision {
  /** true → pode falar. false → não pode, e o motivo está ao lado. */
  sendable: boolean;
  reason: LeadBlockReason | null;
  /** Frase curta em português, com o caso concreto (guardrail 6). */
  detail: string;
}

// ─── Os números, e de onde eles vêm ─────────────────────────────────────────────

/**
 * As constantes do desenho aprovado. Elas vivem aqui, exportadas, porque um
 * número escondido dentro de um `if` é um número que ninguém consegue conferir —
 * e o CEO tem direito de perguntar "quantas vezes esse robô insiste?" e receber
 * uma resposta com arquivo e linha.
 */
export const REGRA = {
  /**
   * Janela útil de abordagem, hora local de São Paulo.
   *
   * Decisão do CEO em 27/08/2026: *"a gente não pode colocar os agentes falando
   * com as pessoas depois das oito da noite. Faz um intervalo das nove da manhã
   * às oito da noite. Depois disso ninguém atende mais."*
   *
   * ⚠️ `fimHora: 20` com a comparação `hora >= fimHora` faz a última hora
   * atendida ser a das 19h — **às 20h em ponto a Sala fecha**. É o que ele
   * pediu; escrever 21 aqui para "atender até as 20h" atenderia até 20h59, e um
   * agente escrevendo às 20h50 é exatamente o que ele proibiu.
   *
   * ⚠️ E este número é só o PADRÃO DE SEGURANÇA, usado quando ninguém informa a
   * janela. A que vale no dia a dia vem da configuração do TA no banco
   * (`horaInicio`/`horaFim`), ajustável pelo dono. Os dois estavam discordando —
   * 19 aqui, 20 no banco — e discordância assim não aparece em teste: aparece
   * num cliente que escreveu às 19h30 e não foi respondido.
   */
  janela: { inicioHora: 9, fimHora: 20 },
  /** 1 = segunda … 5 = sexta. Sábado e domingo estão fora, e não é negociável. */
  diasUteis: [1, 2, 3, 4, 5] as const,
  /**
   * Teto duro de tentativas por lead: **uma abertura e um lembrete**. Não é
   * "quantas cabem"; é quantas uma pessoa educada faria antes de entender que a
   * resposta é o silêncio.
   */
  maxTentativas: 2,
  /** Horas de descanso entre a abertura e o lembrete. */
  descansoHoras: 48,
  /**
   * Prazo do consentimento. Um formulário de oito meses não é interesse vivo: é
   * um dado velho que a pessoa já esqueceu que deu.
   */
  consentimentoDias: 90,
  fusoHorario: "America/Sao_Paulo",
} as const;

// ─── Entrada ────────────────────────────────────────────────────────────────────

export interface LeadSafetyInput {
  /** Telefone do lead, como veio do formulário. */
  telefone: string | null;
  /** Preenchido = pediu silêncio. Terminal. */
  optOutAt: Date | null;
  /**
   * Quando a pessoa entregou os dados. `null` significa "não sei", e não sei é
   * NÃO — bloqueio, nunca presunção.
   *
   * ⛔ **NUNCA passe `createdAt` aqui.** Este doc dizia o contrário até
   * 08/09/2026 — mandava o chamador usar `createdAt` "para contato da primeira
   * safra". A instrução era verdadeira para lead de formulário, onde as duas
   * datas coincidem, e **falsa e perigosa** para qualquer lead que a própria
   * casa cria: aí `createdAt` é o instante em que **NÓS** montamos a ficha, e o
   * portão o lia como consentimento fresquíssimo, de idade zero.
   *
   * Foi assim que lead de lista fria atravessou este portão liberado, com a
   * data da nossa própria importação no lugar do consentimento de alguém. A
   * linha `consentAt ?? createdAt` foi removida de `abordar.ts` no mesmo dia, e
   * este parágrafo sobreviveu a ela por três horas — continuando a mandar o
   * próximo chamador fazer exatamente o que tinha acabado de ser proibido.
   *
   * **Sem registro de consentimento, o portão certo é outro** — quem vem de
   * lista atravessa `avaliarAbordagemDeProspeccao`, que troca esta pergunta
   * pela base legal declarada no lote.
   */
  consentimentoEm: Date | null;
  /**
   * Quantas mensagens de saída a Foocci já mandou para este lead.
   * Só é lido quando `historicoConhecido` é true.
   */
  tentativas: number;
  /** Quando a Foocci falou com esta pessoa pela última vez. */
  ultimoContatoEm: Date | null;
  /**
   * ⚠️ OBRIGATÓRIO E É O PONTO DO ARQUIVO.
   * `true`  → `tentativas` e `ultimoContatoEm` foram realmente apurados.
   * `false` → não foi possível apurar; zero é ignorância, não histórico limpo.
   */
  historicoConhecido: boolean;
  /** O canal de vendas está configurado E ligado para enviar? */
  canalPronto: boolean;
  /** Injetável para teste. */
  agora?: Date;
}

// ─── Auxiliares ─────────────────────────────────────────────────────────────────

function bloqueia(reason: LeadBlockReason, detail: string): LeadSafetyDecision {
  return { sendable: false, reason, detail };
}

/** Dígitos plausíveis para um telefone brasileiro com DDI. */
export function telefonePlausivel(v: string | null | undefined): boolean {
  if (!v) return false;
  const d = v.replace(/\D/g, "");
  return d.length >= 10 && d.length <= 13;
}

/**
 * Dia da semana (0=dom…6=sáb) e hora, no fuso de São Paulo.
 *
 * Feito com `Intl` e não com `getHours()` de propósito: o servidor roda em UTC, e
 * `getHours()` daria 19h em Londres às 16h em São Paulo — três horas de invasão
 * na casa das pessoas, num robô que existe justamente para não incomodar.
 *
 * ── ⚠️ `hourCycle: "h23"`, E ELE NÃO É DECORAÇÃO ────────────────────────────
 *
 * Antes daqui a opção era `hour12: false`, que **não fixa o ciclo**: o motor
 * escolhe entre h23 (00–23) e h24 (01–24) conforme a versão do ICU embutida no
 * Node. Na mesma data e no mesmo código, `hour12: false` devolveu `00` na
 * máquina de desenvolvimento e `24` no runner do CI.
 *
 * O estrago é silencioso e mora exatamente na meia-noite: com a janela indo até
 * as 24, `24 >= 24` fecha o canal — ou seja, quem configura "24 horas por dia" é
 * o único que fica sem atendimento, e só na virada do dia.
 *
 * O `% 24` depois é cinto do cinto: se algum motor voltar a devolver 24, ele
 * vira 0 aqui em vez de virar um bloqueio em produção.
 */
export function agendaLocal(agora: Date, tz: string = REGRA.fusoHorario): { dia: number; hora: number; minuto: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p = fmt.formatToParts(agora);
  const mapa: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dia: mapa[p.find((x) => x.type === "weekday")?.value ?? "Sun"] ?? 0,
    hora: parseInt(p.find((x) => x.type === "hour")?.value ?? "0", 10) % 24,
    minuto: parseInt(p.find((x) => x.type === "minute")?.value ?? "0", 10),
  };
}

/**
 * true quando AGORA está fora da janela de abordagem.
 *
 * A janela entra por parâmetro porque ela é **ajustável pelo dono**: a
 * configuração do TA guarda `horaInicio`/`horaFim`, e um botão na tela que o
 * código ignora é pior que botão nenhum — ele ensina que a configuração vale, e
 * ela não vale. O padrão continua sendo `REGRA`, que é o que o SDR de abordagem
 * usa e não se negocia.
 *
 * O que **não** entra por parâmetro é o fim de semana. Sábado e domingo estão
 * fora, e a linha acima do `REGRA.diasUteis` diz que não é negociável — deixar
 * isso configurável seria abrir a regra pela porta dos fundos.
 */
export function foraDaJanela(
  agora: Date,
  janela: { inicioHora: number; fimHora: number } = REGRA.janela,
): boolean {
  const { dia, hora } = agendaLocal(agora);
  if (!(REGRA.diasUteis as readonly number[]).includes(dia)) return true;
  return hora < janela.inicioHora || hora >= janela.fimHora;
}

// ─── O portão ───────────────────────────────────────────────────────────────────

/**
 * Pode o SDR falar com este lead agora?
 *
 * A ORDEM DAS PERGUNTAS É DELIBERADA e vale como documentação: primeiro o que é
 * inviolável (silêncio pedido), depois o que é impossível (sem telefone, sem
 * canal), depois o que é ignorância (histórico, consentimento), e só então o que
 * é medida (janela, teto, descanso). O motivo devolvido é sempre o primeiro que
 * se aplica — e é por isso que "ela pediu para parar" nunca é encoberto por
 * "está fora do horário".
 */
export function avaliarContatoDeLead(input: LeadSafetyInput): LeadSafetyDecision {
  const agora = input.agora ?? new Date();

  // 1. Silêncio pedido — inviolável, terminal, todos os canais.
  if (input.optOutAt) {
    return bloqueia("LEAD_OPT_OUT", "Esta pessoa pediu para não receber mensagens.");
  }

  // 2. Dá para entregar?
  if (!input.telefone || input.telefone.trim() === "") {
    return bloqueia("LEAD_SEM_TELEFONE", "Contato sem telefone.");
  }
  if (!telefonePlausivel(input.telefone)) {
    return bloqueia("LEAD_TELEFONE_INVALIDO", "Telefone com formato improvável.");
  }
  if (!input.canalPronto) {
    return bloqueia("CANAL_INDISPONIVEL", "O canal de vendas da Foocci não está pronto para enviar.");
  }

  // 3. O que NÃO se sabe. Aqui mora a diferença entre este portão e o do CRM.
  if (!input.historicoConhecido) {
    return bloqueia(
      "HISTORICO_DESCONHECIDO",
      "Não foi possível apurar quantas vezes já falamos com esta pessoa — reprovado por precaução.",
    );
  }
  if (!input.consentimentoEm) {
    return bloqueia(
      "CONSENTIMENTO_DESCONHECIDO",
      "Não há registro de quando esta pessoa entregou os dados.",
    );
  }

  // 4. O consentimento ainda é vivo?
  const idadeDias = (agora.getTime() - input.consentimentoEm.getTime()) / 86_400_000;
  if (idadeDias > REGRA.consentimentoDias) {
    return bloqueia(
      "CONSENTIMENTO_VENCIDO",
      `Preencheu o formulário há ${Math.floor(idadeDias)} dias (teto ${REGRA.consentimentoDias}).`,
    );
  }
  // Data no futuro é dado corrompido, não consentimento fresquíssimo.
  if (idadeDias < 0) {
    return bloqueia("CONSENTIMENTO_DESCONHECIDO", "Data de consentimento no futuro — dado inconsistente.");
  }

  // 5. Insistência: o teto duro do desenho.
  if (input.tentativas >= REGRA.maxTentativas) {
    return bloqueia(
      "TETO_DE_TENTATIVAS",
      `Já foram ${input.tentativas} tentativas (teto ${REGRA.maxTentativas}: uma abertura e um lembrete).`,
    );
  }

  // 6. Descanso entre tentativas.
  if (input.ultimoContatoEm) {
    const horas = (agora.getTime() - input.ultimoContatoEm.getTime()) / 3_600_000;
    if (horas < REGRA.descansoHoras) {
      return bloqueia(
        "DESCANSO_ATIVO",
        `Falamos há ${Math.floor(horas)}h (descanso de ${REGRA.descansoHoras}h).`,
      );
    }
  }

  // 7. Horário. Por último porque é o único bloqueio que passa sozinho com o
  // tempo — os anteriores exigem que alguém ou alguma coisa mude.
  if (foraDaJanela(agora)) {
    return bloqueia(
      "FORA_DA_JANELA",
      `Fora da janela de abordagem (${REGRA.janela.inicioHora}h–${REGRA.janela.fimHora}h, dias úteis, horário de São Paulo).`,
    );
  }

  return { sendable: true, reason: null, detail: "Liberado." };
}

/**
 * A pessoa pediu silêncio?
 *
 * ── POR QUE ISTO EXISTE SEPARADO DO PORTÃO ───────────────────────────────────
 *
 * `avaliarContatoDeLead` governa **abordar um estranho**: ela conta tentativas,
 * exige descanso, cobra consentimento fresco, checa se o canal está pronto.
 * Está certo para o SDR que sai atrás de alguém que não pediu nada.
 *
 * **Responder a quem acabou de escrever é outro ato.** Recusar resposta a quem
 * mandou "oi" porque "já foram 2 tentativas" ou "está fora da janela de
 * abordagem" seria usar a proteção contra a pessoa que ela protege — o erro do
 * guardrail 5, a proteção pior que o problema.
 *
 * Mas UMA das dez regras atravessa os dois atos: quem pediu para não receber
 * mensagem não recebe, tenha escrito ou não. Ela mora aqui, e não copiada lá,
 * porque a semântica do opt-out tem que ter **um** dono. Um `if (lead.optOutAt)`
 * solto em outro arquivo é a segunda definição — e é a que ninguém lembra de
 * mudar no dia em que a regra mudar.
 */
export function pediuSilencio(optOutAt: Date | null | undefined): boolean {
  return Boolean(optOutAt);
}

/**
 * O bloqueio some sozinho com o tempo, ou precisa de gente?
 *
 * Existe por causa da lição do incidente da Nicole, que virou guardrail 5: a
 * proteção não pode ser pior que o problema. Um bloqueio de horário se resolve
 * esperando; um "pediu silêncio" nunca se resolve, e insistir nele é o erro.
 * Quem monta fila usa isto para saber o que reagendar e o que arquivar — em vez
 * de tentar tudo de novo daqui a pouco.
 */
export function bloqueioPassaSozinho(reason: LeadBlockReason): boolean {
  return reason === "FORA_DA_JANELA" || reason === "DESCANSO_ATIVO" || reason === "CANAL_INDISPONIVEL";
}

// ─── PROSPECÇÃO FRIA ────────────────────────────────────────────────────────────

/**
 * A entrada do portão da prospecção.
 *
 * É quase a mesma de `LeadSafetyInput`, e a diferença é a única que importa:
 * aqui não existe `consentimentoEm`, porque **não existe consentimento**. Quem
 * está numa lista de prospecção não preencheu formulário nenhum.
 */
export interface ProspeccaoSafetyInput
  extends Omit<LeadSafetyInput, "consentimentoEm"> {
  /**
   * A frase que quem liberou o lote escreveu para responder "por que temos o
   * contato desta pessoa?". Vazio = ninguém respondeu = não aborda.
   */
  baseLegalDeclarada: string | null;
  /** A prospecção está ligada, não pausada, e ainda cabe no teto do dia? */
  prospeccaoLiberada: boolean;
  /**
   * Descanso entre abordagens, quando o dono configurou um diferente do padrão.
   *
   * Existe porque o campo estava na tela e no banco e **ninguém lia**: o dono
   * ajustava o número, salvava, e o portão continuava usando o valor fixo. Botão
   * que não faz nada é pior que botão ausente — ele ensina que a configuração
   * não vale.
   */
  descansoHoras?: number | null;
}

/**
 * O PORTÃO DA ABORDAGEM FRIA.
 *
 * ── POR QUE ELE MORA NESTE ARQUIVO ──────────────────────────────────────────
 *
 * Porque o próprio arquivo já diz, sobre o opt-out, que a semântica de contato
 * precisa ter **um** dono: *"um `if (lead.optOutAt)` solto em outro arquivo é a
 * segunda definição — e é a que ninguém lembra de mudar no dia em que a regra
 * mudar"*. Escrever a prospecção em `services/salaDeVendas/` criaria exatamente
 * essa segunda definição, com a agravante de ser a que fala com estranhos.
 *
 * ── O QUE MUDA EM RELAÇÃO A `avaliarContatoDeLead` ──────────────────────────
 *
 * Uma coisa só, e ela é substituição, não afrouxamento:
 *
 *   · lá, a pergunta é **"esta pessoa entregou os dados, e há quanto tempo?"**;
 *   · aqui, é **"quem mandou abordar declarou por que temos este contato?"**.
 *
 * Passar `liberadoEm` do lote no campo `consentimentoEm` do outro portão teria
 * funcionado, passado nos testes e sido **mentira**: registraria como
 * consentimento da pessoa um ato da empresa. No dia em que alguém perguntasse
 * "onde está o consentimento dele?", o sistema apontaria para a data em que nós
 * mesmos decidimos abordá-lo.
 *
 * ── O QUE NÃO MUDA, E É DE PROPÓSITO ────────────────────────────────────────
 *
 * Opt-out, telefone plausível, canal pronto, histórico conhecido, teto de
 * tentativas, descanso e janela de horário valem **iguais**. Abordar quem nunca
 * pediu nada é mais delicado que responder quem escreveu, não menos — nenhuma
 * dessas travas afrouxa aqui.
 */
/**
 * ⭐ RECUSA DE PROSPECÇÃO MONTADA FORA DO PORTÃO — e o vocabulário continua aqui.
 *
 * O portão frio decide sobre o que ele recebe. Duas causas ele **não pode ver**,
 * porque acontecem antes de qualquer campo ser preenchido: o lead diz vir de
 * lista e não há lote que o autorize, ou o lote existe e não está liberado.
 *
 * Quem descobre isso é quem lê o banco (`abordar.ts`). Montar a recusa lá com um
 * objeto literal criaria a **segunda definição** de bloqueio — exatamente o que
 * o cabeçalho deste arquivo proíbe: *"um `if (lead.optOutAt)` solto em outro
 * arquivo é a segunda definição, e é a que ninguém lembra de mudar"*. Por isso a
 * frase é construída aqui, com os mesmos motivos do resto.
 */
/**
 * A recusa por silêncio pedido, montada fora do portão — mesma frase, mesmo
 * motivo, um dono só.
 *
 * Ela existe porque o silêncio precisa ser conferido **antes** de qualquer
 * outra coisa, inclusive antes de descobrir qual portão o lead atravessa. Sem
 * isto, o chamador teria de escrever `bloqueia("LEAD_OPT_OUT", …)` no arquivo
 * dele — e aí "esta pessoa pediu para não receber mensagens" passaria a existir
 * em dois lugares, com o segundo sendo o que ninguém lembra de mudar.
 */
export function recusaDeSilencio(): LeadSafetyDecision {
  return bloqueia("LEAD_OPT_OUT", "Esta pessoa pediu para não receber mensagens.");
}

export function recusaDeProspeccao(
  reason: "PROSPECCAO_SEM_BASE_LEGAL" | "PROSPECCAO_DESLIGADA",
  detail: string,
): LeadSafetyDecision {
  return bloqueia(reason, detail);
}

export function avaliarAbordagemDeProspeccao(
  input: ProspeccaoSafetyInput,
): LeadSafetyDecision {
  const agora = input.agora ?? new Date();

  // 1. Silêncio pedido — inviolável, terminal, igual ao outro portão.
  if (input.optOutAt) {
    return bloqueia("LEAD_OPT_OUT", "Esta pessoa pediu para não receber mensagens.");
  }

  // 2. Dá para entregar?
  if (!input.telefone || input.telefone.trim() === "") {
    return bloqueia("LEAD_SEM_TELEFONE", "Contato sem telefone.");
  }
  if (!telefonePlausivel(input.telefone)) {
    return bloqueia("LEAD_TELEFONE_INVALIDO", "Telefone com formato improvável.");
  }
  if (!input.canalPronto) {
    return bloqueia("CANAL_INDISPONIVEL", "O canal de vendas da Foocci não está pronto para enviar.");
  }

  // 3. A chave da prospecção. Desligada por padrão, e pausar tem efeito imediato.
  if (!input.prospeccaoLiberada) {
    return bloqueia(
      "PROSPECCAO_DESLIGADA",
      "A prospecção está desligada, pausada, ou o teto do dia já foi atingido.",
    );
  }

  // 4. A pergunta que substitui o consentimento — e não a finge.
  const base = (input.baseLegalDeclarada ?? "").trim();
  if (base === "") {
    return bloqueia(
      "PROSPECCAO_SEM_BASE_LEGAL",
      "O lote não declara por que temos este contato — sem isso não se aborda ninguém.",
    );
  }

  // 5. O que NÃO se sabe continua sendo não.
  if (!input.historicoConhecido) {
    return bloqueia(
      "HISTORICO_DESCONHECIDO",
      "Não foi possível apurar quantas vezes já falamos com esta pessoa — reprovado por precaução.",
    );
  }

  // 6. Insistência e descanso: idênticos ao outro portão, de propósito.
  if (input.tentativas >= REGRA.maxTentativas) {
    return bloqueia(
      "TETO_DE_TENTATIVAS",
      `Já foram ${input.tentativas} tentativas (teto ${REGRA.maxTentativas}: uma abertura e um lembrete).`,
    );
  }
  if (input.ultimoContatoEm) {
    // O configurado manda; o padrão do desenho é a rede de segurança de quem
    // nunca configurou. Zero é um valor legítimo ("sem descanso"), então a
    // pergunta é sobre existir, não sobre ser verdadeiro.
    const descanso =
      typeof input.descansoHoras === "number" ? input.descansoHoras : REGRA.descansoHoras;
    const horas = (agora.getTime() - input.ultimoContatoEm.getTime()) / 3_600_000;
    if (horas < descanso) {
      return bloqueia(
        "DESCANSO_ATIVO",
        `Falamos há ${Math.floor(horas)}h (descanso de ${descanso}h).`,
      );
    }
  }

  // 7. Horário, por último, pelo mesmo motivo do outro portão.
  if (foraDaJanela(agora)) {
    return bloqueia(
      "FORA_DA_JANELA",
      `Fora da janela de abordagem (${REGRA.janela.inicioHora}h–${REGRA.janela.fimHora}h, dias úteis, horário de São Paulo).`,
    );
  }

  return { sendable: true, reason: null, detail: "Liberado." };
}
