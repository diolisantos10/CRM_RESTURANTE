/**
 * A REVISÃO — o ÚNICO ponto de encaixe da Supervisora no fluxo de envio.
 *
 * ── POR QUE AQUI, E NÃO EM `atender.ts` OU NA ROTA DA CONVERSA ──────────────
 *
 * `entrega.ts` (`entregarMensagem`) é o único caminho por onde passa TODA fala
 * livre que a empresa manda a um lead: a IA (`ta/atender.ts`, dois pontos — a
 * resposta de venda e o aviso de handoff), o humano digitando
 * (`/api/admin/sala-de-vendas/conversa`) e o conector do handoff
 * (`connect/conector/foocci/ligacao.ts`). Plugar a revisão UMA vez, dentro de
 * `entregarMensagem`, cobre "todos os agentes" com uma implementação só — sem
 * dois caminhos de revisão que podem divergir (a doutrina explícita da missão).
 *
 * `abordar.ts` (templates de prospecção aprovados) usa `enviarModeloDeVendas`
 * diretamente, nunca `entregarMensagem` — fora do escopo desta camada porque
 * não é fala composta, é template fixo já aprovado. Documentado, não coberto.
 *
 * ── A REGRA DE FALHA, AO PÉ DA LETRA ─────────────────────────────────────────
 *
 * Esta função NUNCA lança. Um erro em qualquer camada vira `falhaTecnica`, e o
 * que isso significa depende só do modo:
 *
 *   - OFF: a função nem roda — ver `entrega.ts`, que só chama isto quando
 *     `modoEfetivo !== "OFF"`.
 *   - SHADOW: falha é só um registro. `prosseguir` continua `true`, o texto
 *     continua o original. Observador que quebra o sistema observado é o
 *     oposto do desenho.
 *   - GUARD/INTERVENTION: falha é reprovação técnica. `prosseguir = false`. A
 *     mensagem nunca sai às cegas.
 */

import type { PrismaClient, Prisma, AutorDaMensagem, VeredictoDaSupervisora, AcaoDaSupervisora, ModoDaSupervisora } from "@prisma/client";
import { lerConfig, modoEfetivo } from "./config";
import { montarContextoDaRevisao, ultimosTurnos } from "./contexto";
import { avaliarCamadaRapida, type ResultadoDaCamada } from "./camadaRapida";
import { avaliarCamadaProfunda, deveAcionar } from "./camadaProfunda";
import { contarReprovacoesRecentes } from "./desempenho";
import { passarParaGente } from "../handoff";
import { registrarSugestao } from "./sugestoes";
import { limparEntidades } from "../ta/agrupamento";

type Cliente = PrismaClient | Prisma.TransactionClient;

/** Janela para contar "reprovado recentemente" pelo mesmo agente. */
const JANELA_DE_REPETICAO_MS = 24 * 60 * 60 * 1000;

export interface ParametrosDaRevisao {
  mensagemId: string;
  leadId: string;
  texto: string;
  autorMensagem: AutorDaMensagem | null;
  autorUserId: string | null;
  papelDoAgente: string | null;
  agora?: Date;
}

export interface ResultadoDaRevisao {
  /** `entregarMensagem` só segue para a Meta quando isto é `true`. */
  prosseguir: boolean;
  /** O texto que de fato deve ser entregue — pode ter sido reescrito. */
  textoParaEnviar: string;
  avaliacaoId: string | null;
  motivoDeRetencao: string | null;
}

const SEM_EFEITO = (texto: string): ResultadoDaRevisao => ({
  prosseguir: true,
  textoParaEnviar: texto,
  avaliacaoId: null,
  motivoDeRetencao: null,
});

/**
 * A função que `entrega.ts` chama. Decide se a mensagem de `mensagemId` pode
 * seguir para `enviarTextoDeVendas`, e com qual texto.
 */
export async function revisarAntesDeEntregar(
  db: Cliente,
  params: ParametrosDaRevisao,
): Promise<ResultadoDaRevisao> {
  const agora = params.agora ?? new Date();

  let config;
  try {
    config = await lerConfig(db);
  } catch {
    // Não conseguir nem LER a config é, na dúvida, tratar como se estivesse
    // ligada — a Supervisora que não liga sozinha (guardrail 3) também não
    // deveria desligar sozinha por um erro de leitura. Mas sem saber o modo,
    // o mais seguro possível sem travar tudo é agir como SHADOW: observa,
    // nunca bloqueia.
    return revisarComModoForcado(db, params, "SHADOW", agora);
  }

  const modo = modoEfetivo(config);
  if (modo === "OFF") return SEM_EFEITO(params.texto);

  return revisarComModoForcado(db, params, modo, agora);
}

async function revisarComModoForcado(
  db: Cliente,
  params: ParametrosDaRevisao,
  modo: ModoDaSupervisora,
  agora: Date,
): Promise<ResultadoDaRevisao> {
  try {
    return await revisarDeFato(db, params, modo, agora);
  } catch (e) {
    // ⛔ Uma exceção que escapou de tudo o que já é `try/catch` lá dentro —
    // rede caindo no meio de uma escrita, por exemplo. Mesma régua de sempre:
    // SHADOW/OFF não intervém; GUARD/INTERVENTION retém.
    console.error("[supervisora] a revisão quebrou de um jeito não previsto", {
      mensagemId: params.mensagemId,
      leadId: params.leadId,
      erro: e instanceof Error ? e.message : String(e),
    });
    if (modo === "SHADOW") return SEM_EFEITO(params.texto);
    return {
      prosseguir: false,
      textoParaEnviar: params.texto,
      avaliacaoId: null,
      motivoDeRetencao: "a Supervisora quebrou de forma inesperada — retido por segurança",
    };
  }
}

async function revisarDeFato(
  db: Cliente,
  params: ParametrosDaRevisao,
  modo: ModoDaSupervisora,
  agora: Date,
): Promise<ResultadoDaRevisao> {
  const ctx = await montarContextoDaRevisao(db, {
    leadId: params.leadId,
    mensagemAvaliadaId: params.mensagemId,
  });

  const rapida = await avaliarCamadaRapida(ctx, params.texto);

  const reprovacoesRecentes = await contarReprovacoesRecentes(db, {
    autorUserId: params.autorUserId,
    papelDoAgente: params.autorUserId ? null : params.papelDoAgente,
    desde: new Date(agora.getTime() - JANELA_DE_REPETICAO_MS),
    excluirMensagemId: params.mensagemId,
  });

  const decisao = deveAcionar({
    veredictoDaCamadaRapida: rapida.falhaTecnica ? null : rapida.veredito,
    irritacaoDoLead: ctx.irritacaoDoLead,
    pediuParar: ctx.pediuParar,
    reprovacoesRecentesDoAgente: reprovacoesRecentes,
  });

  let final: ResultadoDaCamada = rapida;
  let camada: "RAPIDA" | "PROFUNDA" = "RAPIDA";
  let precisaDeGente = false;
  let sugestaoPermanente: string | null = null;

  // A falha técnica da camada rápida NÃO impede a profunda de tentar — são
  // motores possivelmente diferentes, e uma sondagem a mais vale a pena quando
  // um gatilho concreto (irritação, pedido de parar) já existe de qualquer
  // forma, sem depender do veredito da rápida.
  if (decisao.aciona || (rapida.falhaTecnica && (ctx.irritacaoDoLead >= 2 || ctx.pediuParar))) {
    const turnos = await ultimosTurnos(db, params.leadId).catch(() => []);
    const profunda = await avaliarCamadaProfunda(
      ctx,
      params.texto,
      turnos,
      decisao.motivo ?? "falha técnica da camada rápida com sinal de risco presente",
    );
    // A profunda é "mais capaz": quando ela conseguiu avaliar, sua palavra vale
    // mais que a da rápida — mesmo que a rápida tenha aprovado.
    if (!profunda.falhaTecnica || rapida.falhaTecnica) {
      final = profunda;
      camada = "PROFUNDA";
      precisaDeGente = profunda.precisaDeGente;
      sugestaoPermanente = profunda.sugestaoPermanente;
    }
  }

  return aplicarDecisao(db, params, modo, camada, final, precisaDeGente, sugestaoPermanente, agora);
}

async function aplicarDecisao(
  db: Cliente,
  params: ParametrosDaRevisao,
  modo: ModoDaSupervisora,
  camada: "RAPIDA" | "PROFUNDA",
  resultado: ResultadoDaCamada,
  precisaDeGente: boolean,
  sugestaoPermanente: string | null,
  agora: Date,
): Promise<ResultadoDaRevisao> {
  const emShadow = modo === "SHADOW";
  const podeAgir = modo === "GUARD" || modo === "INTERVENTION";

  let acaoTomada: AcaoDaSupervisora = "NENHUMA";
  let bloqueada = false;
  let handoffDisparado = false;
  let textoParaEnviar = params.texto;
  let prosseguir = true;
  let motivoDeRetencao: string | null = null;

  if (podeAgir) {
    if (resultado.falhaTecnica) {
      bloqueada = true;
      acaoTomada = "BLOQUEOU";
      prosseguir = false;
      motivoDeRetencao = `a Supervisora não conseguiu avaliar esta mensagem: ${resultado.detalhe}`;
    } else {
      switch (resultado.veredito) {
        case "VERDE":
          acaoTomada = "NENHUMA";
          break;
        case "AMARELO": {
          const reescrito = limparEntidades(resultado.textoReescrito ?? params.texto).trim();
          textoParaEnviar = reescrito || params.texto;
          acaoTomada = "REESCREVEU";
          await db.leadMensagem.update({
            where: { id: params.mensagemId },
            data: { texto: textoParaEnviar },
          });
          break;
        }
        case "VERMELHO":
        case "CRITICO":
          bloqueada = true;
          prosseguir = false;
          motivoDeRetencao = resultado.detalhe;
          // CRITICO sempre escala (a camada profunda já garante
          // `precisaDeGente = true` nesse caso). VERMELHO escala também quando
          // a camada profunda apontou explicitamente que esta conversa
          // específica precisa de gente — nem todo VERMELHO precisa: um texto
          // ruim que não sai não é, por si, motivo para tirar a IA do lead.
          if (resultado.veredito === "CRITICO" || precisaDeGente) {
            acaoTomada = "BLOQUEOU_E_ESCALOU";
            handoffDisparado = await tentarEscalar(db, params, resultado, agora);
          } else {
            acaoTomada = "BLOQUEOU";
          }
          break;
      }
    }
  }

  // Nível 2: uma sugestão permanente para revisão humana — nunca aplica
  // sozinha. Só quando a camada profunda de fato apontou um padrão (não em
  // toda reprovação isolada) e só a partir de uma reprovação real (nunca a
  // partir de uma falha técnica).
  if (!resultado.falhaTecnica && sugestaoPermanente) {
    await registrarSugestao(db, {
      papelDoAgente: params.papelDoAgente,
      agenteAfetadoTipo: params.autorMensagem,
      agenteAfetadoUserId: params.autorUserId,
      problemaObservado: sugestaoPermanente,
      evidenciaMensagemIds: [params.mensagemId],
      evidenciaLeadIds: [params.leadId],
      justificativa: `Camada profunda da Supervisora, veredito ${resultado.veredito}: ${resultado.detalhe}`,
    }).catch((e) => {
      console.error("[supervisora] não consegui registrar a sugestão de nível 2", e);
    });
  }

  const avaliacao = await db.supervisoraAvaliacao
    .create({
      data: {
        mensagemId: params.mensagemId,
        leadId: params.leadId,
        autorMensagem: params.autorMensagem,
        autorUserId: params.autorUserId,
        papelDoAgente: params.papelDoAgente,
        camada,
        modoNaEpoca: modo,
        veredito: resultado.veredito,
        motivos: resultado.motivos,
        motivoDetalhe: resultado.detalhe,
        textoOriginal: acaoTomada === "REESCREVEU" || bloqueada ? params.texto : null,
        textoReescrito: acaoTomada === "REESCREVEU" ? textoParaEnviar : null,
        bloqueada: emShadow ? false : bloqueada,
        acaoTomada: emShadow ? "NENHUMA" : acaoTomada,
        handoffDisparado: emShadow ? false : handoffDisparado,
        falhaTecnica: resultado.falhaTecnica,
        engineProvider: resultado.engineProvider,
        engineModel: resultado.engineModel,
        criadaEm: agora,
      },
      select: { id: true },
    })
    .catch((e) => {
      // Não conseguir GRAVAR o veredito é grave para a auditoria, mas não pode
      // ser o motivo de travar (SHADOW) ou liberar (GUARD) uma mensagem — a
      // decisão sobre a mensagem já foi tomada acima; só o registro falhou.
      console.error("[supervisora] não consegui gravar a avaliação", {
        mensagemId: params.mensagemId,
        erro: e instanceof Error ? e.message : String(e),
      });
      return null;
    });

  if (emShadow) {
    // ⭐ SHADOW: grava o que TERIA acontecido, mas a entrega segue como se a
    // Supervisora não existisse. Mesmo um CRITICO aqui não bloqueia, não
    // reescreve e não escala.
    return { prosseguir: true, textoParaEnviar: params.texto, avaliacaoId: avaliacao?.id ?? null, motivoDeRetencao: null };
  }

  return {
    prosseguir,
    textoParaEnviar,
    avaliacaoId: avaliacao?.id ?? null,
    motivoDeRetencao,
  };
}

/** Tenta acionar o handoff. Não lança — se o lead já não é da IA (um humano
 *  está atendendo, por exemplo), a escalada por handoff não se aplica, e isso
 *  é registrado, não forçado. */
async function tentarEscalar(
  db: Cliente,
  params: ParametrosDaRevisao,
  resultado: ResultadoDaCamada,
  agora: Date,
): Promise<boolean> {
  try {
    const r = await passarParaGente(db, {
      leadId: params.leadId,
      motivoEscrito:
        "A Supervisora reteve uma mensagem e pediu apoio de gente: " + resultado.detalhe,
      dossie: { resumo: `Supervisora (CRÍTICO): ${resultado.detalhe}` },
      motivoExplicito: "RISCO",
      agora,
    });
    return r.ok;
  } catch (e) {
    console.error("[supervisora] não consegui escalar para gente", {
      leadId: params.leadId,
      erro: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

export type { VeredictoDaSupervisora };
