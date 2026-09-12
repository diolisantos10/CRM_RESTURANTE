/**
 * A SELEÇÃO DA PROSPECÇÃO — quem seria abordado hoje, e por que só esses.
 *
 * ── ⚠️ ESTE ARQUIVO NÃO ESCREVE NADA. LEIA ISTO ANTES DE MUDÁ-LO ────────────
 *
 * A primeira versão criava o lead e marcava o item como usado **enquanto
 * montava a lista**. Parecia inofensivo e destruía a base: cada abertura da
 * tela consumia um pedaço da lista, tirava os itens de PENDENTE para sempre e
 * criava leads — inclusive dos BARRADOS, inclusive com o canal desligado, sem
 * falar com ninguém. Cinco recarregamentos queimavam cem contatos.
 *
 * Pior: o commit que a introduziu vendia esse modo — prospecção ligada, envio
 * desligado — como "o estado certo para conferir a lista antes da estreia".
 * A tela de conferência era a que mais estragava.
 *
 * A regra que ficou: **montar a fila é LEITURA.** Materializar o lead é outro
 * ato, com nome próprio (`materializarLead`), chamado por quem vai de fato
 * abordar — nunca por quem só está olhando.
 *
 * ── E QUEM ENVIA? ───────────────────────────────────────────────────────────
 *
 * Ninguém, aqui. A entrega continua em `salaDeVendas/entrega.ts`, atrás de
 * `FOOCCI_SDR_SEND_ENABLED`, que é chave do dono.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import {
  avaliarAbordagemDeProspeccao,
  REGRA,
  type LeadSafetyDecision,
} from "@/services/foocci-sdr/LeadContactSafety";
import { acharLeadPeloTelefone } from "./casamento";
import { conferirRitmo, tetosEmVigor } from "../freioDeRitmo";

type Cliente = PrismaClient | Prisma.TransactionClient;

export interface CandidatoAAbordagem {
  itemId: string;
  loteId: string;
  /** `null` enquanto o item ainda não foi materializado — e isso é normal. */
  leadId: string | null;
  nome: string | null;
  whatsapp: string;
  decisao: LeadSafetyDecision;
}

export interface FilaDeProspeccao {
  liberados: CandidatoAAbordagem[];
  barrados: CandidatoAAbordagem[];
  motivoDaFilaVazia: string | null;
  /** Conversas iniciadas desde a meia-noite de São Paulo. */
  usadosHoje: number;
  tetoDoDia: number;

  // ── ⭐ A JANELA MÓVEL DA META — acrescentada em 10/09/2026 ────────────────
  //
  // Evidência confirmada no Gerenciador do WhatsApp: o número da Foocci pode
  // iniciar **2.000 conversas numa janela contínua de 24 horas**. Não é cota
  // diária: não reinicia à meia-noite.
  //
  // ⚠️ E `usadosHoje` conta pelo DIA CIVIL. Os dois números divergem todo dia,
  // e divergem no pior sentido possível: à 00h01 o contador do dia zera e a
  // tela diria "0 de 2.000 usadas" enquanto a Meta ainda tem 1.500 conversas
  // pesando das últimas horas de ontem. Uma rodada que confiasse só no
  // `usadosHoje` tentaria 2.000 sobre um saldo de 500 — e o excedente não vira
  // erro isolado, vira recusa em série, que é como a nota de qualidade do
  // número cai.
  //
  // Os dois ficam expostos porque respondem a perguntas diferentes: `usadosHoje`
  // é a produção do dia, que a operação acompanha; `saldoDaJanela` é o que a
  // Meta REALMENTE deixa mandar agora, e é ele que manda na fila.
  /** Conversas iniciadas nas últimas 24 horas corridas. */
  usadosNaJanela: number;
  /** Quanto ainda cabe na janela de 24h da Meta. É este que limita a fila. */
  saldoDaJanela: number;
}

/**
 * Monta a fila do dia. **Somente leitura.**
 *
 * ── POR QUE O TETO É CONTADO NO BANCO ───────────────────────────────────────
 *
 * Duas instâncias do app com um contador em memória cada uma entregariam o
 * dobro do teto sem ninguém perceber — e o dobro do teto num canal de WhatsApp
 * é como se perde um número. O teto só é teto se todo mundo ler do mesmo lugar.
 */
export async function montarFilaDeProspeccao(
  db: Cliente,
  opcoes: { canalPronto: boolean; agora?: Date; limite?: number } = {
    canalPronto: false,
  },
): Promise<FilaDeProspeccao> {
  const agora = opcoes.agora ?? new Date();

  const config = await db.prospeccaoConfig.findUnique({
    where: { id: "singleton" },
  });

  // Sem configuração nenhuma a resposta é "desligada" — e não "sem limite".
  const ligada = Boolean(config?.outboundLigado) && !config?.pausadoEm;
  const tetoDoDia = config?.limiteDiario ?? 0;
  // ── O CONFIGURÁVEL SÓ APERTA, NUNCA AFROUXA ──
  //
  // Deixar o dono baixar o descanso abaixo do padrão faria a única trava que
  // afrouxa nesta obra ser justamente a de insistência — no portão que fala com
  // ESTRANHOS, que é o mais delicado dos dois. Quem quiser insistir mais que o
  // desenho permite precisa mudar o desenho, não a configuração.
  const descansoHoras = Math.max(
    REGRA.descansoHoras,
    config?.horasEntreAbordagens ?? REGRA.descansoHoras,
  );

  // ── ⭐ DOIS CONTADORES, E O QUE MANDA É O DA JANELA ───────────────────────
  //
  // `contarAbordagensDeHoje` conta pelo dia civil de São Paulo. `conferirRitmo`
  // conta as últimas 24 HORAS CORRIDAS — que é exatamente como a Meta conta as
  // conversas iniciadas pela empresa.
  //
  // A fila respeita o MENOR dos dois saldos. Sem isso, à meia-noite o contador
  // do dia zera e a fila ofereceria o teto inteiro sobre um saldo que a Meta já
  // gastou nas horas anteriores.
  const [usadosHoje, ritmo] = await Promise.all([
    contarAbordagensDeHoje(db, agora),
    conferirRitmo(db, agora, tetosEmVigor(process.env, tetoDoDia)),
  ]);

  const usadosNaJanela = ritmo.nasUltimas24h;
  const saldoDaJanela = Math.max(0, tetoDoDia - usadosNaJanela);
  const cabeNoTeto = Math.min(Math.max(0, tetoDoDia - usadosHoje), saldoDaJanela);

  const vazia = (motivo: string): FilaDeProspeccao => ({
    liberados: [],
    barrados: [],
    motivoDaFilaVazia: motivo,
    usadosHoje,
    tetoDoDia,
    usadosNaJanela,
    saldoDaJanela,
  });

  if (!ligada) {
    return vazia(
      config?.pausadoEm
        ? `Prospecção pausada${config.motivo ? `: ${config.motivo}` : "."}`
        : "Prospecção desligada.",
    );
  }

  // O freio de ritmo já barrou por conta própria — hora ou janela de 24h. A
  // frase vem dele, e não de uma reescrita aqui, para a tela dizer o mesmo que
  // o envio diria.
  if (!ritmo.pode) return vazia(ritmo.detalhe);

  if (cabeNoTeto <= 0) {
    return vazia(
      saldoDaJanela <= 0
        ? `Saldo da janela de 24h esgotado (${usadosNaJanela}/${tetoDoDia} conversas iniciadas).`
        : `Teto do dia atingido (${usadosHoje}/${tetoDoDia}).`,
    );
  }

  const quantos = Math.min(cabeNoTeto, opcoes.limite ?? cabeNoTeto);

  // ── ⭐ A OPERAÇÃO POR LOTES FOI REMOVIDA EM 11/09/2026 ─────────────────────
  //
  // Ordem explícita: "nenhuma importação pode depender de liberação manual
  // para entrar na prospecção" e "lote não pode aparecer como etapa
  // operacional nem impedir envio." Até aqui esta consulta ainda filtrava por
  // `lote: { situacao: "LIBERADO" }` — o que fazia um lote PAUSADO (pelo botão,
  // ou por `cancelarImportacao`) continuar excluindo itens da fila. Essa era
  // exatamente a "etapa operacional" que a ordem manda tirar do caminho.
  //
  // A ÚNICA trava que resta sobre QUAIS itens entram na consulta é
  // `situacao: "PENDENTE"` — o item já foi abordado, recusado ou virou lead?
  // Não entra. Nem "opt-out", "telefone inválido" nem "já abordado" precisam de
  // um segundo filtro aqui: quem pediu silêncio e quem já é lead são pegos
  // adiante, por `avaliarAbordagemDeProspeccao`, com o histórico de verdade —
  // e telefone inválido nunca chega a `PENDENTE` (`importarLote` já marca
  // `RECUSADO`). Todo contato válido importado é elegível desde o instante em
  // que entra, sem clique nenhum.
  //
  // ⚠️ `limiteDiario` do lote NÃO é mais lido. A coluna continua no banco (é
  // registro de como o lote entrou), e a fila deixou de obedecê-la: com o
  // arquivo entrando em 16 partes de 20, ela cortava a base unificada em 320 por
  // dia enquanto a tela mostrava o teto global de 2.000 ao lado — dois tetos, um
  // deles invisível, e ninguém entendendo por que a fila parava. Pedir só o que
  // se usa é o que impede a coluna de voltar a valer por descuido.
  const itens = await db.itemDeProspeccao.findMany({
    where: { situacao: "PENDENTE" },
    orderBy: { criadoEm: "asc" },
    take: quantos,
    include: {
      lote: { select: { id: true, proveniencia: true } },
    },
  });

  const liberados: CandidatoAAbordagem[] = [];
  const barrados: CandidatoAAbordagem[] = [];

  for (const item of itens) {
    // Leitura, nunca criação: se o contato já é lead, aproveitamos o histórico
    // dele; se não é, avaliamos com histórico zero — que é a verdade.
    const lead = await lerLeadDoItem(db, item);

    // O teto que vale é o do dia (contado acima, no banco) mais o teto explícito
    // da rodada, que quem aperta o botão escolhe. Nenhum outro.
    const decisao = avaliarAbordagemDeProspeccao({
      telefone: item.whatsapp,
      optOutAt: lead?.optOutAt ?? null,
      tentativas: lead?.tentativas ?? 0,
      ultimoContatoEm: lead?.lastContactedAt ?? null,
      // Verdadeiro porque os três campos acima saíram do banco agora: ou o lead
      // existe e foi lido, ou ele não existe e o histórico é genuinamente zero.
      historicoConhecido: true,
      canalPronto: opcoes.canalPronto,
      prospeccaoLiberada: true,
      baseLegalDeclarada: item.lote.proveniencia,
      descansoHoras,
      agora,
    });

    const candidato: CandidatoAAbordagem = {
      itemId: item.id,
      loteId: item.loteId,
      leadId: lead?.id ?? null,
      nome: item.nome,
      whatsapp: item.whatsapp,
      decisao,
    };

    if (decisao.sendable) liberados.push(candidato);
    else barrados.push(candidato);
  }

  return {
    liberados,
    barrados,
    motivoDaFilaVazia:
      liberados.length === 0 && barrados.length === 0
        ? "Nenhum contato pendente na Base fria — a lista acabou."
        : null,
    usadosHoje,
    tetoDoDia,
    usadosNaJanela,
    saldoDaJanela,
  };
}

/**
 * Meta de elegíveis que a conferência tenta confirmar antes de parar de
 * escanear — e também o TETO do `?alvo=` público em `route.ts`. Exportada para
 * que o teto da rota e o padrão da varredura sejam o mesmo número, e não dois
 * que alguém esquece de manter iguais.
 */
export const ALVO_DE_ELEGIVEIS_NA_CONFERENCIA = 2000;

/** Quantos itens PENDENTE a conferência lê do banco por página, ao escanear a Base fria. */
const TAMANHO_DA_PAGINA_NA_CONFERENCIA = 500;

/** Quantos candidatos avaliados entram na prévia amostral — amostra, não o total. */
const TAMANHO_DA_AMOSTRA_NA_CONFERENCIA = 50;

export interface ResultadoDaConferencia {
  /** Quantos itens estão PENDENTE na Base fria agora. Contagem exata, direto do banco. */
  pendentes: number;
  /**
   * Quantos dos itens escaneados são elegíveis PELAS REGRAS DO CONTATO — opt-out,
   * telefone, base legal, histórico, tentativas, descanso, janela de horário —
   * SE a operação estivesse ativada. Não é o que pode ser abordado agora: é o
   * que o contato em si permite, isolado do estado do canal e do interruptor
   * (ver o comentário grande abaixo). Quando `varreuTudo` é `false`, este número
   * é um PISO — "pelo menos isso" — e não o total real.
   */
  elegiveisSeAtivar: number;
  /** Quantos dos itens escaneados foram barrados PELAS REGRAS DO CONTATO — nunca por canal ou interruptor, que aqui são forçados como se estivessem ligados. */
  barrados: number;
  /** Quantos itens PENDENTE foram de fato lidos e avaliados nesta conferência. */
  itensAvaliados: number;
  /**
   * `true` só quando a varredura esgotou os PENDENTE sem nunca atingir
   * `alvoDeElegiveis` — `elegiveisSeAtivar` é então o total exato. `false`
   * quando ela parou ao confirmar a meta: sobraram pendentes nunca avaliados.
   */
  varreuTudo: boolean;
  /** A meta que a varredura tenta confirmar (2.000, salvo override explícito). */
  alvoDeElegiveis: number;

  // ── ESTADO OPERACIONAL — fatos de agora, não a hipótese usada acima ────────
  /** `FOOCCI_SALES_PHONE_NUMBER_ID`/`FOOCCI_SALES_ACCESS_TOKEN` presentes? */
  canalConfigurado: boolean;
  /** `FOOCCI_SDR_SEND_ENABLED === "true"`? A chave que hoje está desligada. */
  envioAutorizado: boolean;
  /** `outboundLigado` e não `pausadoEm`, agora — não a hipótese acima. */
  prospeccaoLigada: boolean;

  usadosHoje: number;
  tetoDoDia: number;
  /** `max(0, tetoDoDia - usadosHoje)` — o que falta do teto contado pelo dia civil. */
  saldoDiario: number;
  usadosNaJanela: number;
  /** Quanto ainda cabe na janela de 24h da Meta — ver o comentário em `FilaDeProspeccao`. */
  saldoDaJanela: number;
  /** `min(elegiveisSeAtivar, saldoDiario, saldoDaJanela)` SE a operação fosse ativada agora. */
  capacidadeAoAtivar: number;
  /**
   * A capacidade REAL, agora — `capacidadeAoAtivar` se canal, envio e
   * prospecção estiverem TODOS ligados; **zero** caso contrário. É este número,
   * e não `capacidadeAoAtivar`, que responde "quantos serão abordados se eu não
   * mudar nada".
   */
  capacidadeOperacionalAgora: number;
  /** Os primeiros até 50 itens avaliados, na ordem real da fila. AMOSTRA — não a lista inteira. */
  previaAmostral: CandidatoAAbordagem[];
}

/**
 * A CONFERÊNCIA — quantos contatos são de fato elegíveis agora, sem tocar em nada.
 *
 * ── ⛔⛔ CORREÇÃO CIRÚRGICA, 11/09/2026 — "FUNCIONA COM O ENVIO DESLIGADO" ERA
 * MENTIRA NO CÓDIGO ANTERIOR ─────────────────────────────────────────────────
 *
 * A primeira versão desta função recebia `canalPronto` de quem chamava — a
 * rota passava `canalDeVendasPronto()`, que exige `FOOCCI_SDR_SEND_ENABLED`. Com
 * a chave desligada (o estado de hoje), `avaliarAbordagemDeProspeccao` barrava
 * **todo mundo** como `CANAL_INDISPONIVEL`, e a tela mostraria zero elegíveis —
 * não porque os contatos fossem ruins, mas porque a pergunta errada estava
 * sendo feita ao portão. A auditoria pediu exatamente isto de volta: "a
 * conferência afirma funcionar com o envio desligado, mas isso não é verdade no
 * código atual."
 *
 * O DEFEITO ERA MISTURAR DUAS PERGUNTAS DIFERENTES NUMA SÓ:
 *
 *   1. ELEGIBILIDADE DO CONTATO — opt-out, telefone, base legal declarada,
 *      histórico, tentativas, descanso, janela de horário. Propriedades DO
 *      CONTATO: não mudam se alguém liga ou desliga o envio às 15h.
 *   2. ESTADO OPERACIONAL — canal configurado, envio autorizado, prospecção
 *      ligada/pausada, saldo diário, saldo da janela da Meta. Propriedades DO
 *      MOMENTO: podem mudar a qualquer hora, sem tocar em nenhum contato.
 *
 * A CORREÇÃO NÃO CRIA UM SEGUNDO PORTÃO. Ela chama o MESMO
 * `avaliarAbordagemDeProspeccao` que `montarFilaDeProspeccao` usa, com
 * `canalPronto: true` e `prospeccaoLiberada: true` FIXOS — como se a operação já
 * estivesse ativada. Isso não afrouxa nada: força só os DOIS gates
 * operacionais do portão a nunca disparar, deixando passar exclusivamente os
 * motivos de bloqueio que são do CONTATO (`LEAD_OPT_OUT`,
 * `PROSPECCAO_SEM_BASE_LEGAL`, `HISTORICO_DESCONHECIDO`, `TETO_DE_TENTATIVAS`,
 * `DESCANSO_ATIVO`, `FORA_DA_JANELA`). O resultado (`elegiveisSeAtivar`,
 * `barrados`) responde "este contato pode ser abordado, quando a operação
 * estiver ligada?" — e é exatamente a pergunta que faz sentido conferir com
 * tudo desligado.
 *
 * O ESTADO OPERACIONAL é lido À PARTE — `canalConfigurado`/`envioAutorizado`
 * vêm de quem chama (a rota, que já sabe ler `isFoocciSalesChannelConfigured`/
 * `isFoocciSdrSendEnabled`), `prospeccaoLigada` vem do `ProspeccaoConfig` que
 * esta função já lê. `capacidadeOperacionalAgora` só é maior que zero quando OS
 * TRÊS estão de pé — é essa combinação que prova, em teste, que a conferência
 * devolve `capacidadeOperacionalAgora: 0` sempre que `FOOCCI_SDR_SEND_ENABLED`
 * estiver desligado, sem depender de vasculhar cada contato de novo.
 *
 * `montarFilaDeProspeccao` continua devolvendo fila vazia com a prospecção
 * pausada — está certo para ELA, que é o primeiro passo de uma rodada de
 * verdade. Esta função nunca olha `outboundLigado`/`pausadoEm` para decidir SE
 * avalia — só para reportar `prospeccaoLigada` como um fato a mais.
 *
 * ── POR QUE PAGINAR EM VEZ DE PEGAR OS 50 PRIMEIRO ────────────────────────────
 *
 * A pergunta do dono é "existem pelo menos 2.000 elegíveis?", e os primeiros 50
 * pendentes podem estar todos barrados (uma leva ruim de opt-outs recentes, por
 * exemplo) sem que isso diga nada sobre o resto da base. A varredura avança em
 * páginas de `TAMANHO_DA_PAGINA_NA_CONFERENCIA` até confirmar a meta OU esgotar
 * os pendentes — o que vier primeiro — e diz honestamente qual dos dois aconteceu
 * (`varreuTudo`).
 *
 * `skip`/`take` em vez de cursor: é uma leitura de auditoria, não uma lista que
 * precisa ser estável sob escrita concorrente. Se uma rodada de verdade correr ao
 * mesmo tempo e mudar `situacao` de itens no meio da varredura, o pior caso é
 * pular ou reler um item — aceitável aqui, e não vale a complexidade extra de
 * paginação por cursor para um número que já nasce com margem (a meta é 2.000).
 *
 * ⚠️ `alvoDeElegiveis` NÃO é validado aqui contra um teto — esta função é
 * chamada só por código do servidor (a rota, os testes). Quem expõe um `?alvo=`
 * público (`route.ts`) é quem tem de limitá-lo antes de repassar: uma varredura
 * arbitrariamente grande pedida por URL é problema da borda pública, não desta
 * função interna.
 */
export async function conferirElegibilidadeReal(
  db: Cliente,
  opcoes: {
    /** O canal de vendas está configurado (`FOOCCI_SALES_PHONE_NUMBER_ID`/`_ACCESS_TOKEN`)? Fato de agora — não afeta `elegiveisSeAtivar`, só `capacidadeOperacionalAgora`. */
    canalConfigurado: boolean;
    /** `FOOCCI_SDR_SEND_ENABLED === "true"`? Fato de agora — mesma observação acima. */
    envioAutorizado: boolean;
    agora?: Date;
    alvoDeElegiveis?: number;
  },
): Promise<ResultadoDaConferencia> {
  const agora = opcoes.agora ?? new Date();
  const alvoDeElegiveis = opcoes.alvoDeElegiveis ?? ALVO_DE_ELEGIVEIS_NA_CONFERENCIA;

  const config = await db.prospeccaoConfig.findUnique({
    where: { id: "singleton" },
  });
  const tetoDoDia = config?.limiteDiario ?? 0;
  const descansoHoras = Math.max(
    REGRA.descansoHoras,
    config?.horasEntreAbordagens ?? REGRA.descansoHoras,
  );
  const prospeccaoLigada = Boolean(config?.outboundLigado) && !config?.pausadoEm;

  const [pendentes, usadosHoje, ritmo] = await Promise.all([
    db.itemDeProspeccao.count({ where: { situacao: "PENDENTE" } }),
    contarAbordagensDeHoje(db, agora),
    conferirRitmo(db, agora, tetosEmVigor(process.env, tetoDoDia)),
  ]);

  const usadosNaJanela = ritmo.nasUltimas24h;
  const saldoDaJanela = Math.max(0, tetoDoDia - usadosNaJanela);
  const saldoDiario = Math.max(0, tetoDoDia - usadosHoje);

  let elegiveisSeAtivar = 0;
  let barrados = 0;
  let itensAvaliados = 0;
  let pagina = 0;
  let acabouABase = false;
  let bateuAAlvo = false;
  const previaAmostral: CandidatoAAbordagem[] = [];

  while (!acabouABase && !bateuAAlvo) {
    const itens = await db.itemDeProspeccao.findMany({
      where: { situacao: "PENDENTE" },
      orderBy: { criadoEm: "asc" },
      skip: pagina * TAMANHO_DA_PAGINA_NA_CONFERENCIA,
      take: TAMANHO_DA_PAGINA_NA_CONFERENCIA,
      include: { lote: { select: { id: true, proveniencia: true } } },
    });

    if (itens.length === 0) {
      acabouABase = true;
      break;
    }

    for (const item of itens) {
      // Mesma leitura de lead que `montarFilaDeProspeccao` usa — a conferência
      // não pode divergir da rodada sobre o histórico de ninguém.
      const lead = await lerLeadDoItem(db, item);

      const decisao = avaliarAbordagemDeProspeccao({
        telefone: item.whatsapp,
        optOutAt: lead?.optOutAt ?? null,
        tentativas: lead?.tentativas ?? 0,
        ultimoContatoEm: lead?.lastContactedAt ?? null,
        historicoConhecido: true,
        // ⭐ SEMPRE true — de propósito, e é o coração da correção de
        // 11/09/2026. Ver o comentário grande da função: isto isola a
        // ELEGIBILIDADE DO CONTATO do ESTADO OPERACIONAL, que é reportado à
        // parte (`canalConfigurado`, `envioAutorizado`, `prospeccaoLigada`) e
        // decide `capacidadeOperacionalAgora`, não este laço.
        canalPronto: true,
        prospeccaoLiberada: true,
        baseLegalDeclarada: item.lote.proveniencia,
        descansoHoras,
        agora,
      });

      const candidato: CandidatoAAbordagem = {
        itemId: item.id,
        loteId: item.loteId,
        leadId: lead?.id ?? null,
        nome: item.nome,
        whatsapp: item.whatsapp,
        decisao,
      };

      if (decisao.sendable) elegiveisSeAtivar += 1;
      else barrados += 1;
      itensAvaliados += 1;

      if (previaAmostral.length < TAMANHO_DA_AMOSTRA_NA_CONFERENCIA) {
        previaAmostral.push(candidato);
      }

      if (elegiveisSeAtivar >= alvoDeElegiveis) {
        bateuAAlvo = true;
        break;
      }
    }

    if (!bateuAAlvo && itens.length < TAMANHO_DA_PAGINA_NA_CONFERENCIA) {
      acabouABase = true;
    }
    pagina += 1;
  }

  const capacidadeAoAtivar = Math.max(0, Math.min(elegiveisSeAtivar, saldoDiario, saldoDaJanela));
  const capacidadeOperacionalAgora =
    opcoes.canalConfigurado && opcoes.envioAutorizado && prospeccaoLigada ? capacidadeAoAtivar : 0;

  return {
    pendentes,
    elegiveisSeAtivar,
    barrados,
    itensAvaliados,
    varreuTudo: acabouABase && !bateuAAlvo,
    alvoDeElegiveis,
    canalConfigurado: opcoes.canalConfigurado,
    envioAutorizado: opcoes.envioAutorizado,
    prospeccaoLigada,
    usadosHoje,
    tetoDoDia,
    saldoDiario,
    usadosNaJanela,
    saldoDaJanela,
    capacidadeAoAtivar,
    capacidadeOperacionalAgora,
    previaAmostral,
  };
}

/**
 * O resultado de materializar.
 *
 * `materializado` fala só da gravação. **Permissão para abordar é outra
 * pergunta**, e quem responde na hora do envio é `escolherPortaoDoLead`
 * (`abordar.ts`): lead de `LISTA_PROSPECCAO` atravessa
 * `avaliarAbordagemDeProspeccao`; qualquer outra origem, inclusive a não
 * classificada, atravessa `avaliarContatoDeLead`.
 *
 * ⚠️ ESTE PARÁGRAFO JÁ MENTIU DUAS VEZES NO MESMO DIA, 08/09/2026. Primeiro
 * dizia que o envio usava o portão frio (não usava). Corrigido para dizer que
 * usava o morno — e **a correção envelheceu em três horas**, quando o envio
 * passou a escolher pela origem. Sem número de linha desta vez: linha citada é
 * a parte que apodrece primeiro.
 */
export type ResultadoDaMaterializacao =
  | { materializado: true; leadId: string }
  | { materializado: false; motivo: string };

interface LeadDoItem {
  id: string;
  optOutAt: Date | null;
  lastContactedAt: Date | null;
  tentativas: number;
}

/** Lê o lead do item, se ele já existir. Não cria nada. */
async function lerLeadDoItem(
  db: Cliente,
  item: { leadId: string | null; whatsappDigits: string },
): Promise<LeadDoItem | null> {
  const achado = item.leadId
    ? await db.siteLead.findUnique({
        where: { id: item.leadId },
        select: { id: true, optOutAt: true, lastContactedAt: true },
      })
    : // Pela cauda de oito dígitos, e não por igualdade: a base tem telefones em
      // formato legado, e igualdade exata não acharia quem pediu silêncio.
      await acharLeadPeloTelefone(db, item.whatsappDigits);

  if (!achado) return null;
  return { ...achado, tentativas: await contarTentativas(db, achado.id) };
}

/**
 * MATERIALIZA o item: cria (ou encontra) o lead e tira o item de PENDENTE.
 *
 * ── ⚠️ SÓ CHAME ISTO QUANDO FOR REALMENTE ABORDAR ───────────────────────────
 *
 * Este é o ato que consome a lista. Chamá-lo para montar tela, para prévia, ou
 * "só para já deixar pronto" é o defeito que esta refatoração existe para
 * matar: item que sai de PENDENTE sem ninguém ter falado com a pessoa é um
 * contato perdido em silêncio.
 *
 * ── E O QUE ELE DELIBERADAMENTE NÃO GRAVA ───────────────────────────────────
 *
 * `consentAt`. Nunca. Quem está numa lista de prospecção não consentiu com
 * nada, e gravar a data de hoje ali faria o sistema afirmar, para sempre e para
 * qualquer auditor, que esta pessoa nos procurou. O lead nasce com
 * `fonte: LISTA_PROSPECCAO`, que é a verdade: nós fomos atrás dele.
 *
 * ── ⚠️ E `materializado: true` NÃO QUER DIZER "PODE ABORDAR" ────────────────
 *
 * O retorno se chama `materializado`, e não `ok`, de propósito. Um `ok: true`
 * convidaria quem chamar a tratar o sucesso da gravação como permissão de
 * falar — e o lead encontrado pode ser justamente alguém que PEDIU SILÊNCIO, ou
 * que já está em atendimento de outra pessoa. Quem decide se pode falar é o
 * portão, sempre, e ele é chamado por quem vai enviar.
 */
export async function materializarLead(
  db: Cliente,
  itemId: string,
): Promise<ResultadoDaMaterializacao> {
  // Só o telefone — leitura barata, sem risco: é ele que decide a CHAVE do
  // travamento abaixo, e dois itens de LOTES DIFERENTES com o MESMO telefone
  // têm de travar um contra o outro, não só contra si mesmos.
  const achado = await db.itemDeProspeccao.findUnique({
    where: { id: itemId },
    select: { whatsappDigits: true },
  });
  if (!achado) return { materializado: false, motivo: "Item não encontrado." };

  // ── ⭐ A CORRIDA MEDIDA EM 12/09/2026, E A TRAVA QUE FALTAVA ────────────────
  //
  // O comentário original desta função já nomeava "a corrida dos dois SDRs" e
  // confiava a solução ao reserva-antes-de-criar em CIMA DO ITEM (`updateMany`
  // por `id`). Isso protege dois SDRs clicando o MESMO item duas vezes — e
  // NÃO protege dois ITENS DIFERENTES do MESMO telefone (o caso real de duas
  // importações concorrentes do mesmo contato, ou uma rodada que pega dois
  // PENDENTE do mesmo número por um defeito de importação a montante):
  // medido contra Postgres real, 15 materializações concorrentes de 15 itens
  // do MESMO telefone criaram até 14 `SiteLead` distintos para o mesmo
  // número — cada um "novo", sem histórico, cada um elegível para
  // `abordarLead` como se fosse a primeira vez. Isso não é um número torto no
  // relatório: é o número podendo ser abordado mais de uma vez pela casa,
  // driblando opt-out, descanso e teto porque cada lead fantasma nasce sem o
  // histórico dos outros.
  //
  // A trava certa é por TELEFONE, não por item — `pg_advisory_xact_lock`
  // serializa toda materialização deste número, de qualquer item, e libera
  // sozinha quando a transação termina (comita ou reverte). Zero risco de
  // travar para sempre por conexão devolvida ao pool sem destravar: ela não
  // é de SESSÃO (`pg_advisory_lock`, que o pool do Prisma tornaria perigosa —
  // travar numa conexão e destravar em outra), é de TRANSAÇÃO.
  const executar = (tx: Cliente) => materializarSobATravaDoTelefone(tx, itemId, achado.whatsappDigits);

  // `Prisma.TransactionClient` não tem `$transaction` — é assim que se sabe
  // se `db` já É uma transação do chamador (a trava entra nela, e quem a
  // libera é o `COMMIT`/`ROLLBACK` de quem chamou) ou se precisa abrir uma
  // aqui mesmo.
  if (!("$transaction" in db)) return executar(db);
  return db.$transaction((tx) => executar(tx));
}

async function materializarSobATravaDoTelefone(
  db: Cliente,
  itemId: string,
  whatsappDigits: string,
): Promise<ResultadoDaMaterializacao> {
  // A chave é um hash do telefone, não o telefone em si: `pg_advisory_xact_lock`
  // pede um inteiro (bigint), e `hashtext` é a mesma função que o Postgres usa
  // internamente para isto. Colisão de hash entre DOIS telefones diferentes
  // só serializaria os dois sem necessidade — nunca destrava algo que devia
  // ficar travado, que é o único erro que importa aqui.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${whatsappDigits}))`;

  // ⚠️ Não filtra mais por `lote.situacao` — ordem de 11/09/2026: lote não
  // pode impedir envio. Ver o comentário grande em `montarFilaDeProspeccao`.
  const item = await db.itemDeProspeccao.findUnique({ where: { id: itemId } });

  if (!item) return { materializado: false, motivo: "Item não encontrado." };
  if (item.situacao !== "PENDENTE") {
    // Idempotente: materializar duas vezes devolve o mesmo lead, não cria outro.
    return item.leadId
      ? { materializado: true, leadId: item.leadId }
      : { materializado: false, motivo: `Item em situação ${item.situacao}.` };
  }

  // ── ⚠️ RESERVAR ANTES DE CRIAR — A CORRIDA DOS DOIS SDRs ──────────────────
  //
  // Ler "está PENDENTE" e só depois criar o lead deixa uma janela entre as duas
  // operações. Dois SDRs clicando ao mesmo tempo (ou um clique duplo, ou duas
  // instâncias do app) passam os dois pela leitura, não encontram lead nenhum, e
  // criam **dois leads para o mesmo telefone** — dois donos para a mesma pessoa,
  // que é exatamente o que este desenho inteiro existe para impedir. E
  // `SiteLead.whatsappDigits` é índice, não único: o banco não segura.
  //
  // `updateMany` com o estado no `where` é comparar-e-trocar: **um** dos dois
  // recebe `count: 1` e segue; o outro recebe `count: 0` e lê o resultado de
  // quem ganhou. Trava de banco, não boa intenção de código.
  const reserva = await db.itemDeProspeccao.updateMany({
    where: { id: item.id, situacao: "PENDENTE" },
    data: { situacao: "VIROU_LEAD", processadoEm: new Date() },
  });

  if (reserva.count === 0) {
    const jaFeito = await db.itemDeProspeccao.findUnique({
      where: { id: item.id },
      select: { leadId: true },
    });
    return jaFeito?.leadId
      ? { materializado: true, leadId: jaFeito.leadId }
      : {
          materializado: false,
          motivo: "Outro atendimento está materializando este contato.",
        };
  }

  try {
    const existente = await acharLeadPeloTelefone(db, item.whatsappDigits);

    if (existente) {
      await db.itemDeProspeccao.update({
        where: { id: item.id },
        data: {
          situacao: "DUPLICADO",
          leadId: existente.id,
          motivo: "Já existe como lead na base.",
        },
      });
      return { materializado: true, leadId: existente.id };
    }

    const criado = await db.siteLead.create({
      data: {
        nome: item.nome ?? item.empresa ?? "Contato de prospecção",
        whatsapp: item.whatsapp,
        whatsappDigits: item.whatsappDigits,
        restaurante: item.empresa,
        cidade: item.cidade,
        tipo: item.tipo,
        // ── ⭐ AMPLIAÇÃO DA BASE FRIA, 11/09/2026 ──────────────────────────
        // Só os campos que têm um EQUIVALENTE já existente em SiteLead
        // migram — email e tags. Os demais (cargo, telefone secundário,
        // bairro, endereço, CEP, CNPJ, Instagram, site, Maps) não têm coluna
        // irmã em SiteLead hoje; ficam retidos no registro frio
        // (`ItemDeProspeccao`, ainda acessível pela ficha do contato via
        // `leadId`) em vez de inventar coluna nova numa tabela que não é
        // desta entrega.
        email: item.email,
        tags: item.tags,
        fonte: "LISTA_PROSPECCAO",
        origem: "prospeccao",
        stage: "NOVO",
        atendidoPor: "NINGUEM",
        // consentAt fica NULO de propósito — ver o comentário acima.
      },
      select: { id: true },
    });

    await db.itemDeProspeccao.update({
      where: { id: item.id },
      data: { leadId: criado.id },
    });

    // A qualificação só nasce quando há algo de fato para qualificar — criar
    // uma linha vazia em `LeadQualificacao` para todo lead de prospecção
    // encheria a tabela de registros sem informação, que ninguém filtra
    // depois.
    if (item.numeroDeUnidades !== null || item.canaisAtuais.length > 0 || item.observacoes) {
      await db.leadQualificacao.create({
        data: {
          leadId: criado.id,
          unidades: item.numeroDeUnidades,
          canaisAtuais: item.canaisAtuais,
          observacoes: item.observacoes,
        },
      });
    }

    return { materializado: true, leadId: criado.id };
  } catch (erro) {
    // ── DEVOLVER A RESERVA ──
    //
    // Sem isto, uma falha aqui deixaria o item marcado como VIROU_LEAD sem lead
    // nenhum: um contato que sai da fila para sempre e nunca é abordado — some
    // em silêncio, que é a pior forma de perder alguém da lista.
    // A compensação vai num try próprio: se `db` for uma transação, a primeira
    // falha já abortou tudo no Postgres e este update também falha — e o erro
    // dele SUBSTITUIRIA o original, enterrando o diagnóstico verdadeiro sob um
    // "current transaction is aborted".
    try {
      await db.itemDeProspeccao.updateMany({
        where: { id: item.id, leadId: null },
        data: { situacao: "PENDENTE", processadoEm: null },
      });
    } catch {
      // Numa transação, o rollback já devolve o item. Fora dela, o item fica
      // reservado e aparece na fila de exceções — nunca some calado.
    }
    throw erro;
  }
}

/** Mensagens que a casa mandou para este lead. Saída, não entrada. */
async function contarTentativas(db: Cliente, leadId: string): Promise<number> {
  return db.leadMensagem.count({ where: { leadId, direcao: "SAIDA" } });
}

/**
 * Abordagens de prospecção já feitas hoje, lidas do banco.
 *
 * ── ⚠️ ESTE CONTADOR AINDA É UMA APROXIMAÇÃO, E ISSO ESTÁ REGISTRADO ────────
 *
 * Ele conta LEADS com `fonte: LISTA_PROSPECCAO` contatados hoje, e não EVENTOS
 * de abordagem. Enquanto nada envia, a diferença é teórica. No dia em que a
 * entrega for ligada, ela vaza dos dois lados:
 *
 *   · o item que casou com um lead que JÁ EXISTIA na base (ramo `DUPLICADO`)
 *     tem outra `fonte` — abordá-lo não consome teto, e é justamente a fatia
 *     mais delicada, gente que já nos conhece;
 *   · uma conversa de CRM com um lead de fonte `LISTA_PROSPECCAO` CONSOME teto
 *     sem ninguém ter prospectado.
 *
 * **Teto só é teto quando conta o evento.** O conserto certo é o caminho de
 * envio registrar a abordagem (um evento próprio, ou `lastContactedAt` gravado
 * por ele) e este contador ler o evento. Está em `docs/pendencias.md`, e é
 * pré-condição para ligar `FOOCCI_SDR_SEND_ENABLED` — não para mergear isto,
 * que não envia nada.
 *
 * ── O DIA É O DE SÃO PAULO, NÃO O DO SERVIDOR ───────────────────────────────
 *
 * `setHours(0,0,0,0)` usa o fuso do processo, que em produção é UTC. O teto
 * viraria às 21h de Brasília: quem gastasse o teto durante a tarde ganharia um
 * teto novo no fim do expediente, dentro da janela de abordagem. Toda a janela
 * de horário desta obra já é medida em `America/Sao_Paulo`; o teto tem que
 * concordar com ela.
 */
export async function contarAbordagensDeHoje(db: Cliente, agora: Date): Promise<number> {
  const inicioDoDia = inicioDoDiaEmSaoPaulo(agora);

  return db.siteLead.count({
    where: { fonte: "LISTA_PROSPECCAO", lastContactedAt: { gte: inicioDoDia } },
  });
}

/** Meia-noite de São Paulo do dia de `agora`, devolvida em UTC. */
export function inicioDoDiaEmSaoPaulo(agora: Date): Date {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: REGRA.fusoHorario,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(agora);

  const p = (tipo: string) => Number(partes.find((x) => x.type === tipo)?.value ?? "0");

  // Quanto do dia local já passou, subtraído do instante atual: chega-se à
  // meia-noite local sem precisar saber o deslocamento do fuso (que muda com
  // horário de verão).
  const segundosDesdeAMeiaNoite = p("hour") * 3600 + p("minute") * 60 + p("second");
  return new Date(agora.getTime() - segundosDesdeAMeiaNoite * 1000);
}
