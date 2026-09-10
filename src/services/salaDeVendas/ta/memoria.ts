/**
 * A MEMÓRIA DO LEAD — o que ele já contou, e que não se pergunta de novo.
 *
 * ── O DEFEITO, LIDO NA CONVERSA REAL DE 09/09/2026 ──────────────────────────
 *
 *     lead:  é padaria
 *     TA:    (…) que tipo de cozinha vocês trabalham?
 *     lead:  só vendo pelo iFood
 *     TA:    (…) por quais canais vocês vendem hoje?
 *
 * Não é o modelo sendo burro. É a casa jogando fora o que ele descobriu.
 *
 * `sondagem.ts` já extraía os fatos a cada turno — segmento, sistema atual, dor,
 * canais, orçamento. `atender.ts` usava esses fatos para calcular o score e
 * **não gravava nenhum**. A tabela `LeadQualificacao` existia desde sempre e
 * tinha **um único escritor: a tela**, quando um humano digitava.
 *
 * E o prompt do modelo recebia só `{mensagem, nome, jaPerguntou, historico}`.
 * Nem a ficha, nem o formulário do site (`SiteLead.tipo`, `SiteLead.desafio`),
 * nem uma linha do que já se sabia.
 *
 * ── ⚠️ POR QUE NÃO BASTAVA "O HISTÓRICO JÁ ESTÁ NO PROMPT" ──────────────────
 *
 * Estava, e não resolvia. Doze mensagens cruas obrigam o modelo a reextrair os
 * fatos a cada turno, e ele reextrai mal: perde o que ficou na décima terceira,
 * confunde quem disse o quê, e — o pior — não distingue *"ele respondeu isto"*
 * de *"eu perguntei isto e ele desconversou"*. Fato guardado em campo não se
 * reinterpreta.
 *
 * ── O QUE ESTE ARQUIVO NÃO FAZ ──────────────────────────────────────────────
 *
 * Não decide o que responder e não chama modelo. Ele lê, escreve e formata o
 * que a casa já sabe.
 */

import type { PrismaClient, Prisma } from "@prisma/client";

type Cliente = PrismaClient | Prisma.TransactionClient;

/** Tudo o que a casa sabe sobre este lead, num objeto só. */
export interface MemoriaDoLead {
  segmento: string | null;
  sistemaAtual: string | null;
  marketplaceAtual: string | null;
  canaisAtuais: string[];
  dorPrincipal: string | null;
  objetivo: string | null;
  unidades: number | null;
  volumeMensal: number | null;
  urgencia: string | null;
  poderDeDecisao: string | null;
  faixaDeOrcamento: string | null;
  planoDeInteresse: string | null;
  objecoes: string[];
  funcionalidadesDeInteresse: string[];
  pedidoExplicito: string | null;
  pediuPararSondagem: boolean;
  pediuHumano: boolean;
  irritacao: number;
  perguntasJaFeitas: string[];
}

export const MEMORIA_VAZIA: MemoriaDoLead = {
  segmento: null,
  sistemaAtual: null,
  marketplaceAtual: null,
  canaisAtuais: [],
  dorPrincipal: null,
  objetivo: null,
  unidades: null,
  volumeMensal: null,
  urgencia: null,
  poderDeDecisao: null,
  faixaDeOrcamento: null,
  planoDeInteresse: null,
  objecoes: [],
  funcionalidadesDeInteresse: [],
  pedidoExplicito: null,
  pediuPararSondagem: false,
  pediuHumano: false,
  irritacao: 0,
  perguntasJaFeitas: [],
};

/**
 * Lê a memória.
 *
 * ⚠️ Junta DUAS fontes, e a ordem importa: o que o lead digitou no formulário do
 * site (`SiteLead.tipo`, `SiteLead.desafio`) entra como piso, e o que ele contou
 * na conversa sobrescreve. O formulário é mais antigo e menos específico; a
 * conversa é agora. Na direção contrária, um "padaria" dito no WhatsApp seria
 * apagado por um "restaurante" marcado no site três semanas antes.
 */
export async function lerMemoria(db: Cliente, leadId: string): Promise<MemoriaDoLead> {
  try {
    return await lerMemoriaOuQuebrar(db, leadId);
  } catch (e) {
    // ⛔ MEMÓRIA É MELHORIA, NUNCA REQUISITO PARA RESPONDER.
    //
    // Esta função entrou no caminho quente do turno em 10/09/2026, e a primeira
    // medição mostrou o preço: uma falha de leitura aqui subia por `falar()` e
    // derrubava o turno inteiro com `motivo: "quebrou"` — o cliente ficava sem
    // resposta nenhuma porque a casa não conseguiu lembrar o tipo do
    // restaurante dele. Trocar "responde pior" por "não responde" é o pior
    // negócio possível numa conversa de venda.
    //
    // Sem memória o agente volta a ser o de ontem: pergunta o que já sabia.
    // Chato, e infinitamente melhor que mudo. O erro vai para o log com o lead
    // nomeado, nunca como silêncio.
    console.error(`[memoria] não consegui ler a memória do lead ${leadId}:`, e);
    return MEMORIA_VAZIA;
  }
}

async function lerMemoriaOuQuebrar(db: Cliente, leadId: string): Promise<MemoriaDoLead> {
  const [lead, q] = await Promise.all([
    db.siteLead.findUnique({
      where: { id: leadId },
      select: { tipo: true, desafio: true },
    }),
    db.leadQualificacao.findUnique({ where: { leadId } }),
  ]);

  return {
    ...MEMORIA_VAZIA,
    segmento: texto(q?.segmento) ?? texto(lead?.tipo),
    sistemaAtual: texto(q?.sistemaAtual),
    marketplaceAtual: texto(q?.marketplaceAtual),
    canaisAtuais: q?.canaisAtuais ?? [],
    dorPrincipal: texto(q?.dorPrincipal) ?? texto(lead?.desafio),
    objetivo: texto(q?.objetivo),
    unidades: q?.unidades ?? null,
    volumeMensal: q?.volumeMensal ?? null,
    urgencia: texto(q?.urgencia),
    poderDeDecisao: texto(q?.poderDeDecisao),
    faixaDeOrcamento: texto(q?.faixaDeOrcamento),
    planoDeInteresse: texto(q?.planoDeInteresse),
    objecoes: q?.objecoes ?? [],
    funcionalidadesDeInteresse: q?.funcionalidadesDeInteresse ?? [],
    pedidoExplicito: texto(q?.pedidoExplicito),
    pediuPararSondagem: q?.pediuPararSondagem ?? false,
    pediuHumano: q?.pediuHumano ?? false,
    irritacao: q?.irritacao ?? 0,
    perguntasJaFeitas: q?.perguntasJaFeitas ?? [],
  };
}

/**
 * Grava o que se aprendeu neste turno.
 *
 * ── ⛔ A REGRA MAIS IMPORTANTE DAQUI: NUNCA APAGAR COM `null` ───────────────
 *
 * A extração falha às vezes — o modelo não achou o segmento nesta mensagem, e
 * devolve `null`. Se `null` sobrescrevesse, um turno ruim **apagaria** o
 * "padaria" que o lead disse cinco mensagens atrás, e o agente voltaria a
 * perguntar. Seria o mesmo defeito, agora causado pelo conserto.
 *
 * Então: só escreve o que veio preenchido. Esquecer é uma decisão de gente, pela
 * tela — nunca um efeito colateral de uma extração que não achou nada.
 *
 * As listas (`canaisAtuais`, `objecoes`, `funcionalidadesDeInteresse`) **somam**
 * sem repetir, pelo mesmo motivo.
 *
 * Nunca lança: perder o registro da memória é ruim; deixar o cliente sem
 * resposta porque a memória não gravou é pior.
 */
export async function gravarMemoria(
  db: Cliente,
  leadId: string,
  novo: Partial<MemoriaDoLead>,
  agora: Date = new Date(),
): Promise<void> {
  try {
    const atual = await lerMemoria(db, leadId);
    const dados = mesclar(atual, novo);

    await db.leadQualificacao.upsert({
      where: { leadId },
      create: { leadId, ...dados, atualizadoPelaIaEm: agora },
      update: { ...dados, atualizadoPelaIaEm: agora },
    });
  } catch (e) {
    console.error(`[memoria] não consegui gravar a memória do lead ${leadId}:`, e);
  }
}

/** O que muda, e só o que muda. Campo ausente ou vazio não apaga o que já havia. */
function mesclar(atual: MemoriaDoLead, novo: Partial<MemoriaDoLead>) {
  const escalar = <T>(vindo: T | null | undefined, tinha: T | null): T | null =>
    vindo === null || vindo === undefined || vindo === "" ? tinha : vindo;

  const juntarListas = (vindo: string[] | undefined, tinha: string[]): string[] => {
    if (!vindo || vindo.length === 0) return tinha;
    const vistos = new Set(tinha.map((s) => s.toLowerCase().trim()));
    const saida = [...tinha];
    for (const item of vindo) {
      const chave = item.toLowerCase().trim();
      if (chave && !vistos.has(chave)) {
        vistos.add(chave);
        saida.push(item.trim());
      }
    }
    return saida;
  };

  return {
    segmento: escalar(novo.segmento, atual.segmento),
    sistemaAtual: escalar(novo.sistemaAtual, atual.sistemaAtual),
    marketplaceAtual: escalar(novo.marketplaceAtual, atual.marketplaceAtual),
    canaisAtuais: juntarListas(novo.canaisAtuais, atual.canaisAtuais),
    dorPrincipal: escalar(novo.dorPrincipal, atual.dorPrincipal),
    objetivo: escalar(novo.objetivo, atual.objetivo),
    unidades: escalar(novo.unidades, atual.unidades),
    volumeMensal: escalar(novo.volumeMensal, atual.volumeMensal),
    urgencia: escalar(novo.urgencia, atual.urgencia),
    poderDeDecisao: escalar(novo.poderDeDecisao, atual.poderDeDecisao),
    faixaDeOrcamento: escalar(novo.faixaDeOrcamento, atual.faixaDeOrcamento),
    planoDeInteresse: escalar(novo.planoDeInteresse, atual.planoDeInteresse),
    objecoes: juntarListas(novo.objecoes, atual.objecoes),
    funcionalidadesDeInteresse: juntarListas(
      novo.funcionalidadesDeInteresse,
      atual.funcionalidadesDeInteresse,
    ),
    pedidoExplicito: escalar(novo.pedidoExplicito, atual.pedidoExplicito),
    perguntasJaFeitas: juntarListas(novo.perguntasJaFeitas, atual.perguntasJaFeitas),
    // ⚠️ Os três abaixo só sobem, nunca descem, e isso é deliberado: quem pediu
    // para parar de responder pergunta não "despede" no turno seguinte por ter
    // escrito uma frase neutra. Voltar atrás é ato de gente, pela tela.
    pediuPararSondagem: atual.pediuPararSondagem || Boolean(novo.pediuPararSondagem),
    pediuPararSondagemEm:
      !atual.pediuPararSondagem && novo.pediuPararSondagem ? new Date() : undefined,
    pediuHumano: atual.pediuHumano || Boolean(novo.pediuHumano),
    pediuHumanoEm: !atual.pediuHumano && novo.pediuHumano ? new Date() : undefined,
    irritacao: Math.max(atual.irritacao, novo.irritacao ?? 0),
  };
}

// ─── O que se lê do texto, sem modelo nenhum ────────────────────────────────

/**
 * ⛔ "NÃO QUERO MAIS RESPONDER PERGUNTAS."
 *
 * A frase que o TA ignorou em 09/09 e depois da qual ele continuou sondando.
 *
 * Está aqui, em código, e não como instrução no prompt, porque isto é dano real:
 * insistir depois de um pedido explícito de parar é o caminho mais curto para o
 * bloqueio e a denúncia — e prompt é aviso, código é trava (guardrail 4).
 *
 * ⚠️ Sem `\b` no fim das alternativas com acento: em JavaScript `\b` é ASCII, e
 * `/pergunta\b/` **não casa** com "perguntação". A casa já pagou essa lição com
 * `/rob[ôo]\b/`, que não casava com "robô não" — a frase mais provável de todas.
 */
const PEDE_PARAR_PERGUNTA =
  /(n[ãa]o quero (mais )?(responder|falar)|para de (perguntar|me perguntar)|chega de pergunta|quantas perguntas|s[óo] (me )?(manda|diz|fala)|sem mais pergunta|responde (logo|direto)|para com (as )?pergunta)/i;

/** Irritação em três degraus. Degrau é resposta diferente, não adjetivo. */
const IRRITADO_FORTE = /\b(p[ée]ssimo|horr[íi]vel|absurdo|golpe|palha[çc]ada|enrola[çc][ãa]o|vai se|merda|porra)/i;
const IRRITADO_MEDIO = /(perda de tempo|n[ãa]o (est[áa]|ta) (me )?ajudando|voc[êe] n[ãa]o (entende|entendeu)|de novo a mesma|j[áa] (falei|disse|respondi))/i;

export function lerPedidoDeParar(mensagem: string): boolean {
  return PEDE_PARAR_PERGUNTA.test(mensagem);
}

export function lerIrritacao(mensagem: string): number {
  if (IRRITADO_FORTE.test(mensagem)) return 3;
  if (IRRITADO_MEDIO.test(mensagem)) return 2;
  return 0;
}

/**
 * ⭐ O BLOCO QUE ENTRA NO PROMPT — o que já se sabe, escrito de uma vez.
 *
 * Devolve string vazia quando não se sabe nada. **Vazio é resultado**: um bloco
 * "O QUE JÁ SEI: —" ensinaria o modelo a preencher os buracos, que é a definição
 * de inventar. Ausência de informação não é informação (guardrail 1).
 */
export function blocoDeMemoria(m: MemoriaDoLead): string {
  const linhas: string[] = [];

  const diz = (rotulo: string, valor: string | number | null) => {
    if (valor === null || valor === "" || valor === undefined) return;
    linhas.push(`- ${rotulo}: ${valor}`);
  };

  diz("tipo de estabelecimento", m.segmento);
  diz("unidades", m.unidades);
  diz("sistema que usa hoje", m.sistemaAtual);
  diz("marketplace de que depende", m.marketplaceAtual);
  if (m.canaisAtuais.length) diz("canais atuais", m.canaisAtuais.join(", "));
  diz("dor principal", m.dorPrincipal);
  diz("objetivo declarado", m.objetivo);
  diz("volume mensal", m.volumeMensal);
  diz("urgência", m.urgencia);
  diz("quem decide", m.poderDeDecisao);
  diz("faixa de orçamento", m.faixaDeOrcamento);
  diz("plano de interesse", m.planoDeInteresse);
  if (m.funcionalidadesDeInteresse.length) {
    diz("recursos que ele mesmo puxou", m.funcionalidadesDeInteresse.join(", "));
  }
  if (m.objecoes.length) diz("objeções que ele já levantou", m.objecoes.join(" | "));
  diz("pedido explícito dele", m.pedidoExplicito);

  if (linhas.length === 0) return "";

  return [
    "O QUE VOCÊ JÁ SABE SOBRE ESTA PESSOA (ela já contou — não pergunte de novo):",
    ...linhas,
    "",
    "Use estes fatos na resposta. Perguntar de novo o que está nesta lista é o erro",
    "que mais rápido faz um dono de restaurante largar a conversa.",
  ].join("\n");
}

/**
 * A ordem de parar de sondar, quando ela existe.
 *
 * Separada do bloco acima porque é regra de conduta, não fato sobre o lead — e
 * porque ela vale mesmo quando não se sabe mais nada dele.
 */
export function blocoDeConduta(m: MemoriaDoLead): string {
  const linhas: string[] = [];

  if (m.pediuPararSondagem) {
    linhas.push(
      "⛔ ELE PEDIU PARA PARAR DE RESPONDER PERGUNTAS. Não faça pergunta nenhuma.",
      "Responda o que ele perguntar, ofereça o próximo passo concreto, e pare.",
    );
  }
  if (m.irritacao >= 2) {
    linhas.push(
      "Ele está irritado. Reconheça isso em uma frase, sem justificar e sem se defender.",
      "Vá direto ao ponto. Nada de simpatia decorativa.",
    );
  }
  if (m.pediuHumano) {
    linhas.push("Ele já pediu falar com uma pessoa. Não tente contornar isso para vender.");
  }

  return linhas.join("\n");
}

function texto(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}
