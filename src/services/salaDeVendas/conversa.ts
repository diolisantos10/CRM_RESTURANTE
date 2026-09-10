/**
 * A CONVERSA DE UM LEAD — receber, enviar, e nunca contar a história errada.
 *
 * Este arquivo é o que transforma "chegou um webhook" em "a tela do vendedor
 * mostra a mensagem". Três coisas o governam, e as três nasceram de defeitos
 * concretos que este tipo de tela produz quando ninguém pensa nelas.
 *
 * ── 1. A MESMA MENSAGEM NÃO PODE ENTRAR DUAS VEZES ───────────────────────────
 *
 * A Meta reentrega webhook quando não recebe 200 rápido o bastante — e ela
 * reentrega a mensagem inteira, idêntica. Sem trava, a conversa mostra o cliente
 * dizendo "quanto custa?" duas vezes, e o vendedor responde duas vezes.
 *
 * A trava é a restrição UNIQUE em `waMessageId`, no banco. **Não** é o `findFirst`
 * antes do `create`: entre a leitura e a escrita cabe o segundo webhook, e ele
 * cabe justamente quando a Meta está reentregando em rajada. Guardrail 4 —
 * prompt é aviso, código é trava, e aqui a trava é do Postgres.
 *
 * ── 2. A ORDEM DA CONVERSA É A DO RELÓGIO DO PROVEDOR ────────────────────────
 *
 * `ocorreuEm` vem do carimbo da Meta; `createdAt` é quando gravamos. Numa
 * reentrega, a segunda é minutos depois da primeira, e ordenar por ela
 * embaralharia a conversa — colocando a resposta antes da pergunta.
 *
 * ── 3. "NÃO LIDAS" É CONTADO, NÃO ESTIMADO ───────────────────────────────────
 *
 * O contador em `SiteLead.naoLidas` é cache — a verdade são as linhas com
 * `lidaEm = null`. Cache existe porque a lista de conversas mostra o número em
 * TODA linha, e um `count` por lead a cada carregamento é o que faz uma tela de
 * atendimento ficar lenta justamente no dia movimentado.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { limparEntidades } from "./ta/agrupamento";
import type {
  DirecaoDaMensagem,
  TipoDaMensagem,
  StatusDaMensagem,
  AutorDaMensagem,
} from "@prisma/client";

type Cliente = PrismaClient | Prisma.TransactionClient;

/** Erro de unicidade do Postgres, via Prisma. */
const VIOLOU_UNICIDADE = "P2002";

function ehViolacaoDeUnicidade(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === VIOLOU_UNICIDADE;
}

// ── O que chega ──────────────────────────────────────────────────────────────

export interface MensagemQueChegou {
  leadId: string;
  /** Id da mensagem na Meta. É a chave da idempotência. */
  waMessageId: string;
  tipo: TipoDaMensagem;
  /** Tipo cru do provedor, preservado quando `tipo = NAO_SUPORTADO`. */
  tipoCru?: string | null;
  texto?: string | null;
  legenda?: string | null;
  midiaId?: string | null;
  midiaMimeType?: string | null;
  midiaNome?: string | null;
  duracaoSeg?: number | null;
  /** Carimbo do provedor. */
  ocorreuEm: Date;
}

export type ResultadoDeEntrada =
  | { ok: true; mensagemId: string; repetida: false }
  /**
   * Já estava gravada. NÃO é erro — é o webhook fazendo o trabalho dele.
   *
   * ⚠️ `mensagemId` é `null` no caso raro da CORRIDA: duas entregas simultâneas,
   * o índice único barrou a segunda, e dentro de uma transação já abortada não
   * há como consultar o id da primeira. O tipo diz isso em vez de fingir um id
   * — quem precisar do id trata o `null`, e quem só precisa saber "não conte de
   * novo" lê `repetida`.
   */
  | { ok: true; mensagemId: string | null; repetida: true }
  | { ok: false; causa: "leadNaoExiste" };

/**
 * Grava uma mensagem que o lead mandou.
 *
 * Devolve `repetida: true` na reentrega, em vez de estourar: reentrega é
 * comportamento normal do provedor, e um erro aqui faria o webhook devolver 500
 * — o que ensina a Meta a reentregar mais ainda.
 */
export async function registrarEntrada(
  db: Cliente,
  m: MensagemQueChegou,
): Promise<ResultadoDeEntrada> {
  // ── ⛔ OLHAR ANTES DE INSERIR, E O MOTIVO É UMA TRANSAÇÃO ABORTADA ────────
  //
  // Esta função inseria primeiro e tratava o `P2002` no `catch`. Funcionava
  // fora de transação e **mentia dentro de uma** — que é justamente como ela
  // roda em produção, porque `gravarNaConversa` a envolve em `comIdentidade`
  // para o RLS enxergar o papel declarado.
  //
  // No Postgres, um erro dentro de um bloco de transação **aborta o bloco**:
  // todo comando seguinte responde `current transaction is aborted`. Então a
  // consulta do `catch` — a que ia buscar a mensagem que já existia — falhava
  // também, e a função caía no ramo final devolvendo `leadNaoExiste`.
  //
  // Efeito medido no CI de 10/09/2026, contra Postgres de verdade: **toda
  // reentrega da Meta era reportada como "o lead sumiu"**, e o log de produção
  // dizia "mensagem NÃO gravada" para uma mensagem que estava gravada desde a
  // primeira entrega. Diagnóstico errado sobre um sistema que funcionava.
  //
  // ⚠️ Isto NÃO substitui o índice único. A consulta abaixo é o caminho comum
  // (a reentrega, que é previsível e frequente); o índice continua sendo a
  // trava para a corrida de verdade, duas entregas simultâneas. Trocar o índice
  // por esta consulta seria trocar uma trava por uma verificação.
  const jaGravada = await db.leadMensagem.findUnique({
    where: { waMessageId: m.waMessageId },
    select: { id: true },
  });
  if (jaGravada) {
    // Não mexe no espelho: o contador de não lidas já subiu na primeira vez, e
    // somar de novo mostraria duas mensagens onde há uma.
    return { ok: true, mensagemId: jaGravada.id, repetida: true };
  }

  try {
    const criada = await db.leadMensagem.create({
      data: {
        leadId: m.leadId,
        direcao: "ENTRADA",
        tipo: m.tipo,
        tipoCru: m.tipoCru ?? null,
        status: "RECEBIDA",
        waMessageId: m.waMessageId,
        texto: m.texto ?? null,
        legenda: m.legenda ?? null,
        midiaId: m.midiaId ?? null,
        midiaMimeType: m.midiaMimeType ?? null,
        midiaNome: m.midiaNome ?? null,
        duracaoSeg: m.duracaoSeg ?? null,
        ocorreuEm: m.ocorreuEm,
      },
      select: { id: true },
    });

    await atualizarEspelhoDaEntrada(db, m);
    return { ok: true, mensagemId: criada.id, repetida: false };
  } catch (e) {
    if (ehViolacaoDeUnicidade(e)) {
      // A CORRIDA de verdade: outra entrega da mesma mensagem gravou entre a
      // consulta lá em cima e este `create`. O índice único é a trava, e ela
      // funcionou.
      //
      // ⚠️ Aqui NÃO se consulta o banco de novo. Dentro de uma transação o erro
      // acima já a abortou, e a consulta falharia — foi exatamente esse o
      // defeito que a consulta prévia veio consertar. Repeti-lo aqui seria
      // reintroduzi-lo no caminho raro.
      //
      // Sem id para devolver, mas o fato é o que importa ao chamador: a
      // mensagem está gravada e este turno não deve contá-la de novo.
      return { ok: true, mensagemId: null, repetida: true };
    }

    // Chave estrangeira: o lead sumiu entre o webhook e a gravação.
    return { ok: false, causa: "leadNaoExiste" };
  }
}

/**
 * O espelho na linha do lead: última mensagem, não lidas, primeira resposta.
 *
 * `primeiraRespostaEm` só é escrito quando ainda está vazio — ele congela o
 * momento em que a pessoa respondeu PELA PRIMEIRA VEZ, que é o que o indicador
 * de tempo de primeira resposta mede. Sobrescrever a cada mensagem transformaria
 * o indicador em "tempo desde a última resposta", que é outra coisa e sempre
 * parece melhor.
 */
async function atualizarEspelhoDaEntrada(db: Cliente, m: MensagemQueChegou): Promise<void> {
  await db.siteLead.update({
    where: { id: m.leadId },
    data: {
      ultimaMensagemEm: m.ocorreuEm,
      ultimaMensagemTexto: resumoDoTexto(m),
      ultimaMensagemDeQuem: "ENTRADA",
      naoLidas: { increment: 1 },
      lastInteractionAt: m.ocorreuEm,
    },
  });

  await db.siteLead.updateMany({
    where: { id: m.leadId, primeiraRespostaEm: null },
    data: { primeiraRespostaEm: m.ocorreuEm },
  });
}

/**
 * O texto curto que a LISTA mostra.
 *
 * Mídia sem legenda não vira string vazia: vira "🎤 Áudio". Uma linha em branco
 * na lista de conversas parece defeito, e faz o vendedor abrir a conversa só
 * para descobrir o que chegou.
 */
export function resumoDoTexto(m: {
  tipo: TipoDaMensagem;
  texto?: string | null;
  legenda?: string | null;
  midiaNome?: string | null;
}): string {
  const escrito = (m.texto ?? m.legenda ?? "").trim();
  if (escrito) return escrito.slice(0, 280);

  switch (m.tipo) {
    case "AUDIO": return "🎤 Áudio";
    case "IMAGEM": return "🖼️ Imagem";
    case "VIDEO": return "🎬 Vídeo";
    case "DOCUMENTO": return m.midiaNome ? `📎 ${m.midiaNome}` : "📎 Documento";
    case "TEMPLATE": return "📋 Modelo enviado";
    case "NAO_SUPORTADO": return "📦 Conteúdo não suportado";
    default: return "";
  }
}

// ── O que sai ────────────────────────────────────────────────────────────────

export interface MensagemParaEnviar {
  leadId: string;
  texto: string;
  autor: AutorDaMensagem;
  /** Obrigatório quando `autor = HUMANO`: toda mensagem tem responsável. */
  autorUserId?: string | null;
  tipo?: TipoDaMensagem;
  templateNome?: string | null;
  agora?: Date;

  // ── A TRILHA DO TURNO ─────────────────────────────────────────────────────
  //
  // Os três nasceram do defeito de 09/09/2026: duas respostas da IA para uma
  // sequência só do lead. Sem eles o defeito é visível na tela e invisível no
  // banco — e o que não se consulta não se prova corrigido.

  /** O turno que produziu esta fala. Duas saídas com o mesmo id são o defeito. */
  turnoId?: string | null;
  /** `abordagem`, `recepcao`, `qualificacao` ou `closer`. */
  papelDoAgente?: string | null;
  /** `modelo`, `modelo-2a-tentativa` ou `deterministico`. */
  origemDaFala?: string | null;
}

export type ResultadoDeSaida =
  | { ok: true; mensagemId: string }
  | { ok: false; causa: "semTexto" }
  | { ok: false; causa: "humanoSemAutor" }
  /**
   * O banco recusou a gravação. `detalhe` traz a mensagem crua, cortada.
   *
   * ⚠️ Esta causa nasceu de um 500 em produção, 08/09/2026. A primeira rodada
   * real com o portão liberando chegou até aqui e o Prisma levantou
   * `Foreign key constraint violated: lead_mensagens_autorUserId_fkey`. A
   * exceção **atravessou** esta função, `abordarLead`, `abordarItemDaFila` e a
   * rodada inteira, e virou HTTP 500 — matando os outros nove contatos por
   * causa do primeiro.
   *
   * `abordarLead` promete devolver `naoConseguiuGravar` nesse caso. Ele não
   * conseguia: a promessa dependia de uma recusa que nunca vinha, porque o
   * caminho era exceção e não retorno.
   */
  | { ok: false; causa: "naoGravou"; detalhe: string };

/**
 * Registra uma mensagem de saída como PENDENTE, antes de tentar entregar.
 *
 * ── POR QUE GRAVAR ANTES DE ENVIAR ──
 *
 * Se o envio for gravado só depois do sucesso, uma queda entre o `POST` e a
 * gravação produz o pior estado possível: o cliente recebeu, e o sistema não
 * sabe. O vendedor manda de novo. Gravando antes, o pior caso é uma linha
 * PENDENTE que nunca saiu — visível, corrigível, e honesta.
 */
export async function registrarSaida(
  db: Cliente,
  m: MensagemParaEnviar,
): Promise<ResultadoDeSaida> {
  // ⛔ A LIMPEZA É AQUI, E É AQUI DE PROPÓSITO.
  //
  // `registrarSaida` é o funil por onde passa TODA mensagem que a empresa manda
  // — o TA, o determinístico, o aviso de handoff, o humano pela Central. Limpar
  // na composição protegeria um caminho e deixaria os outros; limpar no funil é
  // trava, não aviso (guardrail 4). O lead recebeu `&#x20;` literal em
  // 09/09/2026 porque não havia funil nenhum fazendo isto.
  const texto = limparEntidades(m.texto ?? "").trim();
  if (!texto) return { ok: false, causa: "semTexto" };

  // Item 19 do comando: registrar o responsável por cada mensagem. Sem esta
  // recusa, uma mensagem humana sem autor viraria uma mensagem órfã — e a
  // auditoria não conseguiria dizer quem falou em nome da empresa.
  if (m.autor === "HUMANO" && !m.autorUserId) return { ok: false, causa: "humanoSemAutor" };

  const agora = m.agora ?? new Date();

  // ⚠️ O `try` existe porque uma exceção aqui não para UM envio: ela sobe pela
  // rodada inteira e mata os contatos seguintes, que não têm nada a ver com o
  // problema. Falha de gravação é resultado, não acidente.
  let criada: { id: string };
  try {
    criada = await db.leadMensagem.create({
      data: {
        leadId: m.leadId,
        direcao: "SAIDA",
        tipo: m.tipo ?? "TEXTO",
        status: "PENDENTE",
        texto,
        autor: m.autor,
        autorUserId: m.autorUserId ?? null,
        templateNome: m.templateNome ?? null,
        turnoId: m.turnoId ?? null,
        papelDoAgente: m.papelDoAgente ?? null,
        origemDaFala: m.origemDaFala ?? null,
        ocorreuEm: agora,
      },
      select: { id: true },
    });
  } catch (e) {
    const detalhe = e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300);
    console.error("[conversa] o banco recusou gravar a mensagem de saída", {
      leadId: m.leadId,
      autor: m.autor,
      autorUserId: m.autorUserId ?? null,
      detalhe,
    });
    return { ok: false, causa: "naoGravou", detalhe };
  }

  await db.siteLead.update({
    where: { id: m.leadId },
    data: {
      ultimaMensagemEm: agora,
      ultimaMensagemTexto: texto.slice(0, 280),
      ultimaMensagemDeQuem: "SAIDA",
      lastContactedAt: agora,
      lastInteractionAt: agora,
    },
  });

  return { ok: true, mensagemId: criada.id };
}

/** Confirma que o provedor aceitou, guardando o id que ele devolveu. */
export async function confirmarEnvio(
  db: Cliente,
  params: { mensagemId: string; waMessageId: string },
): Promise<void> {
  await db.leadMensagem.update({
    where: { id: params.mensagemId },
    data: { status: "ENVIADA", waMessageId: params.waMessageId },
  });
}

/** Marca a falha, com o motivo do provedor. Nunca guarda token. */
export async function registrarFalhaDeEnvio(
  db: Cliente,
  params: { mensagemId: string; erro: string },
): Promise<void> {
  await db.leadMensagem.update({
    where: { id: params.mensagemId },
    data: {
      status: "FALHOU",
      erro: params.erro.slice(0, 1000),
      tentativas: { increment: 1 },
    },
  });
}

/**
 * A ordem em que os estados de entrega podem avançar.
 *
 * ── POR QUE ISTO É UMA ESCADA, E NÃO UMA ATRIBUIÇÃO ──
 *
 * A Meta entrega os callbacks de status FORA DE ORDEM com frequência: `read`
 * chega antes de `delivered` mais vezes do que se imagina. Atribuir o último que
 * chegou faria uma mensagem já lida voltar para "entregue" na tela — o vendedor
 * vê o ✓✓ azul virar cinza e conclui que o sistema está errado. Ele estaria.
 */
const ESCADA: Record<string, number> = {
  PENDENTE: 0,
  ENVIADA: 1,
  ENTREGUE: 2,
  LIDA: 3,
};

export function avancaStatus(atual: StatusDaMensagem, novo: StatusDaMensagem): boolean {
  // FALHOU é terminal e vem de fora da escada: uma falha reportada vale mais que
  // qualquer avanço, porque é a única que exige ação de alguém.
  if (novo === "FALHOU") return atual !== "FALHOU";
  if (atual === "FALHOU") return false;

  const de = ESCADA[atual];
  const para = ESCADA[novo];
  if (de === undefined || para === undefined) return false;
  return para > de;
}

/**
 * Aplica um callback de status do provedor.
 *
 * A escrita é CONDICIONAL no status atual, e não uma leitura seguida de escrita:
 * dois callbacks chegando no mesmo instante são a regra, não a exceção.
 */
export async function aplicarStatus(
  db: Cliente,
  params: { waMessageId: string; status: StatusDaMensagem; erro?: string | null },
): Promise<{ aplicado: boolean }> {
  const atual = await db.leadMensagem.findUnique({
    where: { waMessageId: params.waMessageId },
    select: { id: true, status: true },
  });

  if (!atual) return { aplicado: false };
  if (!avancaStatus(atual.status, params.status)) return { aplicado: false };

  const alterados = await db.leadMensagem.updateMany({
    where: { id: atual.id, status: atual.status },
    data: {
      status: params.status,
      erro: params.erro ? params.erro.slice(0, 1000) : undefined,
    },
  });

  return { aplicado: alterados.count === 1 };
}

// ── Leitura ──────────────────────────────────────────────────────────────────

/**
 * Marca como lidas as mensagens que o lead mandou, e zera o contador.
 *
 * Zera com `set: 0` e não com `decrement`: decrementar por mensagem lida deixa o
 * contador negativo no dia em que dois atendentes abrirem a mesma conversa.
 */
export async function marcarComoLidas(
  db: Cliente,
  params: { leadId: string; agora?: Date },
): Promise<{ lidas: number }> {
  const agora = params.agora ?? new Date();

  const r = await db.leadMensagem.updateMany({
    where: { leadId: params.leadId, direcao: "ENTRADA", lidaEm: null },
    data: { lidaEm: agora },
  });

  await db.siteLead.update({
    where: { id: params.leadId },
    data: { naoLidas: 0 },
  });

  return { lidas: r.count };
}

export interface MensagemNaTela {
  id: string;
  direcao: DirecaoDaMensagem;
  tipo: TipoDaMensagem;
  status: StatusDaMensagem;
  texto: string | null;
  legenda: string | null;
  midiaNome: string | null;
  midiaMimeType: string | null;
  duracaoSeg: number | null;
  autor: AutorDaMensagem | null;
  autorNome: string | null;
  erro: string | null;
  ocorreuEm: Date;
}

/**
 * A conversa, em ordem cronológica do provedor.
 *
 * `limite` existe porque uma conversa de três meses não cabe numa tela nem numa
 * resposta de API — e carregá-la inteira é como a tela de atendimento trava.
 */
export async function lerConversa(
  db: Cliente,
  params: { leadId: string; limite?: number },
): Promise<MensagemNaTela[]> {
  const limite = Math.min(Math.max(params.limite ?? 200, 1), 500);

  const linhas = await db.leadMensagem.findMany({
    where: { leadId: params.leadId },
    orderBy: { ocorreuEm: "desc" },
    take: limite,
    select: {
      id: true, direcao: true, tipo: true, status: true, texto: true,
      legenda: true, midiaNome: true, midiaMimeType: true, duracaoSeg: true,
      autor: true, erro: true, ocorreuEm: true,
      autorUser: { select: { nome: true } },
    },
  });

  // Buscamos do mais novo para o mais velho (para pegar as ÚLTIMAS N) e
  // devolvemos na ordem de leitura.
  return linhas.reverse().map((l) => ({
    id: l.id,
    direcao: l.direcao,
    tipo: l.tipo,
    status: l.status,
    texto: l.texto,
    legenda: l.legenda,
    midiaNome: l.midiaNome,
    midiaMimeType: l.midiaMimeType,
    duracaoSeg: l.duracaoSeg,
    autor: l.autor,
    autorNome: l.autorUser?.nome ?? null,
    erro: l.erro,
    ocorreuEm: l.ocorreuEm,
  }));
}

// ── Tradução do provedor ─────────────────────────────────────────────────────

/**
 * O tipo da Meta vira o tipo da casa.
 *
 * ── POR QUE O PADRÃO É `NAO_SUPORTADO`, E NÃO `TEXTO` ───────────────────────
 *
 * Um `default: "TEXTO"` seria mais simples e mentiria: uma localização, um
 * contato compartilhado ou uma figurinha entrariam na conversa como mensagem de
 * texto vazia. O vendedor veria uma linha em branco e concluiria que o sistema
 * perdeu a mensagem — quando na verdade ele a guardou e a descreveu errado.
 *
 * `NAO_SUPORTADO` com o tipo cru ao lado diz a verdade: chegou algo, sabemos o
 * que era, e ainda não sabemos mostrar.
 */
export function tipoDaMeta(
  tipo: string,
  kindDaMidia?: string | null,
): { tipo: TipoDaMensagem; tipoCru: string | null } {
  const t = (tipo || "").toLowerCase();
  const k = (kindDaMidia || "").toLowerCase();

  if (t === "text") return { tipo: "TEXTO", tipoCru: null };
  if (t === "template") return { tipo: "TEMPLATE", tipoCru: null };

  switch (k || t) {
    case "image": return { tipo: "IMAGEM", tipoCru: null };
    case "audio": return { tipo: "AUDIO", tipoCru: null };
    case "video": return { tipo: "VIDEO", tipoCru: null };
    case "document": return { tipo: "DOCUMENTO", tipoCru: null };
    default: return { tipo: "NAO_SUPORTADO", tipoCru: tipo || null };
  }
}

/** O status da Meta vira o status da casa. Desconhecido não vira sucesso. */
export function statusDaMeta(status: string): StatusDaMensagem | null {
  switch ((status || "").toLowerCase()) {
    case "sent": return "ENVIADA";
    case "delivered": return "ENTREGUE";
    case "read": return "LIDA";
    case "failed": return "FALHOU";
    // Um status que ninguém previu NÃO é tratado como entrega. Devolver null faz
    // o chamador ignorar e registrar — que é honesto — em vez de marcar como
    // entregue uma mensagem sobre a qual não se sabe nada.
    default: return null;
  }
}

// ── A janela de 24 horas ─────────────────────────────────────────────────────

export type JanelaDe24h =
  | { aberta: true; fechaEm: Date }
  /** Nunca houve mensagem do lead: a janela nunca chegou a abrir. */
  | { aberta: false; motivo: "nuncaFalou" }
  | { aberta: false; motivo: "expirou"; ultimaEm: Date };

/**
 * A janela de texto livre da Meta.
 *
 * Fora dela, só modelo aprovado sai — e mandar texto livre com a janela fechada
 * é erro de API que o vendedor lê como "o sistema não enviou", sem entender por
 * quê. A tela precisa dizer isso ANTES de ele digitar.
 *
 * Puro de propósito: a regra é a mesma para a tela, para a rota e para a cadência.
 */
export function janelaDe24h(
  ultimaEntradaEm: Date | null,
  agora: Date,
): JanelaDe24h {
  if (!ultimaEntradaEm) return { aberta: false, motivo: "nuncaFalou" };

  const fechaEm = new Date(ultimaEntradaEm.getTime() + 24 * 3_600_000);
  if (agora < fechaEm) return { aberta: true, fechaEm };

  return { aberta: false, motivo: "expirou", ultimaEm: ultimaEntradaEm };
}
