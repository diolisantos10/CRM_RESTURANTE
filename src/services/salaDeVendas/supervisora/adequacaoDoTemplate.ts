/**
 * A ADEQUAÇÃO DO TEMPLATE — o encaixe da Supervisora em `abordar.ts`.
 *
 * ── O PEDIDO DO CEO, 12/09/2026 ──────────────────────────────────────────────
 *
 * *"A Supervisora não pode reescrever o template — o conteúdo é fixo,
 * homologado pela Meta. Mas ela precisa AVALIAR se aquele template é
 * apropriado PARA ESTE LEAD AGORA: momento, frequência, repetição, opt-out,
 * insistência, adequação do pitch/cadência. E poder LIBERAR ou IMPEDIR o
 * envio — nunca alterar o texto."*
 *
 * Por isso esta função nunca devolve `textoReescrito`, nunca escreve em
 * `LeadMensagem.texto`, e a única decisão que produz é `prosseguir: true|false`
 * — `abordarLead` decide o resto.
 *
 * ── POR QUE UM ARQUIVO SEPARADO DE `revisao.ts` ──────────────────────────────
 *
 * `revisao.ts` revisa FALA COMPOSTA — texto que um agente (IA ou humano)
 * escreveu, e que PODE ser reescrito (veredito AMARELO). Um template de
 * prospecção aprovado é o oposto: conteúdo fixo, que a Supervisora nunca toca.
 * Colocar as duas coisas na mesma função faria `textoReescrito` "às vezes
 * existir, às vezes não" pelo mesmo tipo — mais difícil de auditar do que dois
 * arquivos pequenos, cada um fiel ao que cobre.
 *
 * ── POR QUE DETERMINÍSTICO, E NÃO UM MODELO DE IA ────────────────────────────
 *
 * Hoje existe UM template configurado globalmente para toda a prospecção
 * (`modeloConfigurado`, `abordar.ts`) — não há um segundo pitch para escolher,
 * então "este pitch combina com este lead?" não tem uma segunda resposta
 * possível para um "juiz" de IA comparar. O que de fato varia de lead para
 * lead — e é exatamente o que o CEO pediu para avaliar ("momento, frequência,
 * repetição, opt-out, insistência") — é medível em cima do HISTÓRICO real de
 * abordagens: quantas vezes este lead já recebeu um template, há quanto
 * tempo, e se pediu silêncio. "Adequação de cadência", aqui, é isso: o momento
 * certo para o único pitch que existe. Se um dia houver mais de um template
 * para escolher entre eles, a pergunta muda de natureza (viraria "qual pitch"
 * e não só "agora ou não") e um julgamento de IA passaria a fazer sentido —
 * este arquivo não fecha essa porta, só não a abre sem necessidade real.
 *
 * ⚠️ Isto também significa que, ao contrário de `camadaRapida.ts`, não existe
 * aqui `falhaTecnica` por "motor de IA fora do ar" — não há motor. A única
 * falha possível é uma exceção inesperada (ex.: escrita no banco), tratada com
 * a MESMA régua de fail-closed do resto da Supervisora (ver mais abaixo).
 *
 * ── OS MESMOS MODOS, A MESMA RÉGUA DE FALHA (ver `revisao.ts`) ──────────────
 *
 * A leitura do modo é SEMPRE `lerConfig`/`modoEfetivo` — a MESMA fonte que
 * `revisao.ts` usa. Nunca uma segunda leitura de config, nunca uma segunda
 * definição do que cada modo significa:
 *
 *   - OFF: não roda.
 *   - SHADOW: grava o veredito, nunca bloqueia, e NÃO ATRASA a rodada de
 *     abordagem — dispara em segundo plano com `dispararEmSegundoPlano`
 *     (`segundoPlano.ts`), o MESMO mecanismo que `revisao.ts` já resolveu para
 *     mensagem livre, extraído para os dois usarem sem copiar.
 *   - GUARD/INTERVENTION: bloqueiam de verdade — `abordarLead` não chama
 *     `enviarModeloDeVendas` quando `prosseguir` é `false`.
 *
 * Sem `SupervisoraConfig` no banco (ninguém decidiu nada ainda), `lerConfig`
 * já devolve OFF — esta função não repete essa régua, só confia nela.
 */

import type { PrismaClient, Prisma, ModoDaSupervisora, MotivoDaSupervisora, VeredictoDaSupervisora } from "@prisma/client";
import { lerConfig, modoEfetivo } from "./config";
import { dispararEmSegundoPlano } from "./segundoPlano";
import { REGRA } from "@/services/foocci-sdr/LeadContactSafety";

type Cliente = PrismaClient | Prisma.TransactionClient;

/** O que `abordarLead` já sabe sobre as abordagens anteriores a este lead,
 *  contado por ELE (que já tem o lead em mãos) e passado aqui — esta função
 *  nunca consulta o banco para descobrir isto, pela mesma razão que
 *  `camadaProfunda.ts` recebe `reprovacoesRecentesDoAgente` já contado: manter
 *  a decisão pura e testável sem banco embutido. */
export interface HistoricoDeAbordagens {
  /** Quantos TEMPLATES (não mensagem livre) já saíram para este lead —
   *  `LeadMensagem` com `direcao: SAIDA, tipo: TEMPLATE`. */
  tentativasAnteriores: number;
  /** Quando foi a abordagem por template mais recente. `null` = nunca. */
  ultimaAbordagemEm: Date | null;
  /** Copiado do lead. Checado aqui como SEGUNDA opinião, de propósito — ver
   *  o comentário grande no topo do arquivo em `julgarAdequacao`. */
  optOutAt: Date | null;
}

export interface ParametrosDaAdequacao {
  mensagemId: string;
  leadId: string;
  autor: "HUMANO" | "SISTEMA";
  autorUserId: string;
  historico: HistoricoDeAbordagens;
  agora?: Date;
}

export interface ResultadoDaAdequacao {
  /** `abordarLead` só chama `enviarModeloDeVendas` quando isto é `true`. */
  prosseguir: boolean;
  avaliacaoId: string | null;
  /** Só quando `prosseguir` é `false` — o motivo que `abordarLead` devolve
   *  como `supervisoraRecusou`. */
  motivoDeRetencao: string | null;
}

const LIBERADO: ResultadoDaAdequacao = { prosseguir: true, avaliacaoId: null, motivoDeRetencao: null };

/**
 * Teto para a checagem em segundo plano do SHADOW. Generoso mesmo sendo
 * cálculo puro (sem rede, sem modelo) — existe pela mesma razão que
 * `revisao.ts` tem um teto: nunca deixar uma tarefa pendurada para sempre, e
 * o custo de ter um teto alto demais é zero enquanto o cálculo em si for
 * rápido, que é o caso aqui.
 */
const TIMEOUT_AVALIACAO_ASSINCRONA_MS = 5_000;

/**
 * A função que `abordarLead` chama, entre `registrarSaida` e
 * `enviarModeloDeVendas`. Decide se o envio pode seguir.
 */
export async function avaliarAdequacaoDoTemplate(
  db: Cliente,
  params: ParametrosDaAdequacao,
): Promise<ResultadoDaAdequacao> {
  const agora = params.agora ?? new Date();

  let config;
  try {
    config = await lerConfig(db);
  } catch {
    // Mesma régua de `revisao.ts`: não conseguir nem LER a config é, na
    // dúvida, tratado como SHADOW — observa, nunca bloqueia, nunca espera.
    dispararAvaliacaoEmSegundoPlano(db, params, agora);
    return LIBERADO;
  }

  const modo = modoEfetivo(config);
  if (modo === "OFF") return LIBERADO;

  if (modo === "SHADOW") {
    dispararAvaliacaoEmSegundoPlano(db, params, agora);
    return LIBERADO;
  }

  // Só sobra GUARD/INTERVENTION — bloqueantes de verdade.
  try {
    const julgamento = julgarAdequacao(params.historico, agora);
    return await gravarEDecidir(db, params, modo, julgamento, agora);
  } catch (e) {
    // ⛔ Uma exceção que escapou de tudo — ex.: a gravação em
    // `SupervisoraAvaliacao` lançou de um jeito que `gravarEDecidir` não previu.
    // GUARD/INTERVENTION retêm: o template nunca sai às cegas.
    console.error("[supervisora] a avaliação de adequação do template quebrou de forma inesperada", {
      mensagemId: params.mensagemId,
      leadId: params.leadId,
      erro: e instanceof Error ? e.message : String(e),
    });
    return {
      prosseguir: false,
      avaliacaoId: null,
      motivoDeRetencao: "a Supervisora quebrou de forma inesperada — retido por segurança",
    };
  }
}

/**
 * Dispara a avaliação SHADOW sem bloquear a rodada de abordagem. Reaproveita
 * `dispararEmSegundoPlano` (`segundoPlano.ts`) — a MESMA mecânica que
 * `revisao.ts` usa para mensagem livre — para nunca duplicar a corrida contra
 * o commit da transação nem o cuidado de nunca deixar um "unhandled
 * rejection" escapar.
 */
function dispararAvaliacaoEmSegundoPlano(db: Cliente, params: ParametrosDaAdequacao, agora: Date): void {
  dispararEmSegundoPlano(
    db,
    async (clienteDuravel) => {
      const julgamento = julgarAdequacao(params.historico, agora);
      await gravarEDecidir(clienteDuravel, params, "SHADOW", julgamento, agora);
    },
    {
      timeoutMs: TIMEOUT_AVALIACAO_ASSINCRONA_MS,
      onTimeoutOuErro: async (clienteDuravel, erro, estourou) => {
        console.error(
          "[supervisora] avaliação assíncrona da adequação do template não terminou a tempo ou quebrou",
          {
            mensagemId: params.mensagemId,
            leadId: params.leadId,
            estourouTimeout: estourou,
            erro: erro instanceof Error ? erro.message : String(erro),
          },
        );
        await registrarFalhaTecnicaAssincrona(clienteDuravel, params, agora, erro).catch((e2) => {
          console.error(
            "[supervisora] não consegui nem registrar a falha técnica da adequação do template",
            { mensagemId: params.mensagemId, erro: e2 instanceof Error ? e2.message : String(e2) },
          );
        });
      },
    },
  );
}

async function registrarFalhaTecnicaAssincrona(
  db: Cliente,
  params: ParametrosDaAdequacao,
  agora: Date,
  erro: unknown,
): Promise<void> {
  await db.supervisoraAvaliacao.create({
    data: {
      mensagemId: params.mensagemId,
      leadId: params.leadId,
      autorMensagem: params.autor,
      autorUserId: params.autorUserId,
      papelDoAgente: "abordagem",
      camada: "RAPIDA",
      modoNaEpoca: "SHADOW",
      veredito: "VERMELHO",
      motivos: ["FALHA_TECNICA"],
      motivoDetalhe:
        "avaliação assíncrona da adequação do template (SHADOW): " +
        (erro instanceof Error ? erro.message : String(erro)),
      bloqueada: false,
      acaoTomada: "NENHUMA",
      handoffDisparado: false,
      falhaTecnica: true,
      engineProvider: null,
      engineModel: null,
      criadaEm: agora,
    },
  });
}

export interface ResultadoDoJulgamento {
  veredito: VeredictoDaSupervisora;
  motivos: MotivoDaSupervisora[];
  detalhe: string;
}

/**
 * As travas de negócio que a Supervisora aplica sobre a prospecção fria —
 * PURA, sem banco, testável caso a caso.
 *
 * ⭐ São as MESMAS perguntas que `LeadContactSafety` já responde no portão
 * (trava 1 de `abordarLead`, ANTES desta função rodar) — reavaliadas aqui, de
 * propósito, como uma SEGUNDA opinião independente: a Supervisora existe para
 * não depender só do portão estar certo. Reusa as MESMAS constantes de
 * `REGRA` (nunca um segundo número): um teto duplicado que diverge do
 * original é pior que nenhum teto, porque parece proteção e não é.
 *
 * Nunca devolve AMARELO: não há reescrita possível aqui (guardrail do CEO —
 * ver o cabeçalho do arquivo), então o vocabulário desta função é só VERDE
 * (libera) e VERMELHO (barra). CRITICO também não se aplica: não há conversa
 * em andamento para escalar para gente antes mesmo de a primeira mensagem
 * sair.
 */
export function julgarAdequacao(historico: HistoricoDeAbordagens, agora: Date): ResultadoDoJulgamento {
  if (historico.optOutAt) {
    return {
      veredito: "VERMELHO",
      motivos: ["INSISTENCIA_APOS_RECUSA"],
      detalhe: `o lead pediu para não receber mensagens (optOutAt: ${historico.optOutAt.toISOString()}) — mandar um template agora seria insistir depois da recusa`,
    };
  }

  if (historico.tentativasAnteriores >= REGRA.maxTentativas) {
    return {
      veredito: "VERMELHO",
      motivos: ["INSISTENCIA_APOS_RECUSA"],
      detalhe: `já foram ${historico.tentativasAnteriores} abordagens por template a este lead (teto ${REGRA.maxTentativas}: uma abertura e um lembrete) — mais uma é insistência, não prospecção`,
    };
  }

  if (historico.ultimaAbordagemEm) {
    const horasDesde = (agora.getTime() - historico.ultimaAbordagemEm.getTime()) / (1000 * 60 * 60);
    if (horasDesde < REGRA.descansoHoras) {
      return {
        veredito: "VERMELHO",
        motivos: ["TIMING_RUIM"],
        detalhe: `a última abordagem a este lead foi há ${horasDesde.toFixed(1)}h — cedo demais para insistir de novo (descanso mínimo ${REGRA.descansoHoras}h)`,
      };
    }
  }

  return {
    veredito: "VERDE",
    motivos: [],
    detalhe: "lead saudável para prospecção: sem opt-out, sem excesso de tentativas, cadência dentro da janela de descanso",
  };
}

async function gravarEDecidir(
  db: Cliente,
  params: ParametrosDaAdequacao,
  modo: ModoDaSupervisora,
  julgamento: ResultadoDoJulgamento,
  agora: Date,
): Promise<ResultadoDaAdequacao> {
  const emShadow = modo === "SHADOW";
  const podeAgir = modo === "GUARD" || modo === "INTERVENTION";
  const bloqueada = podeAgir && julgamento.veredito !== "VERDE";

  const avaliacao = await db.supervisoraAvaliacao
    .create({
      data: {
        mensagemId: params.mensagemId,
        leadId: params.leadId,
        autorMensagem: params.autor,
        autorUserId: params.autorUserId,
        papelDoAgente: "abordagem",
        camada: "RAPIDA",
        modoNaEpoca: modo,
        veredito: julgamento.veredito,
        motivos: julgamento.motivos,
        motivoDetalhe: julgamento.detalhe,
        // ⛔ Nunca preenchidos: esta camada não reescreve — ver o cabeçalho.
        textoOriginal: null,
        textoReescrito: null,
        bloqueada: emShadow ? false : bloqueada,
        acaoTomada: emShadow ? "NENHUMA" : bloqueada ? "BLOQUEOU" : "NENHUMA",
        handoffDisparado: false,
        falhaTecnica: false,
        engineProvider: null,
        engineModel: null,
        criadaEm: agora,
      },
      select: { id: true },
    })
    .catch((e) => {
      // Não conseguir GRAVAR o veredito é grave para a auditoria, mas não pode
      // ser o motivo de travar (SHADOW) ou liberar (GUARD) um template — a
      // decisão já foi tomada acima; só o registro falhou.
      console.error("[supervisora] não consegui gravar a avaliação de adequação do template", {
        mensagemId: params.mensagemId,
        erro: e instanceof Error ? e.message : String(e),
      });
      return null;
    });

  if (emShadow) {
    // SHADOW grava o que TERIA acontecido; o envio segue como se a
    // Supervisora não existisse.
    return { prosseguir: true, avaliacaoId: avaliacao?.id ?? null, motivoDeRetencao: null };
  }

  return {
    prosseguir: !bloqueada,
    avaliacaoId: avaliacao?.id ?? null,
    motivoDeRetencao: bloqueada ? julgamento.detalhe : null,
  };
}
