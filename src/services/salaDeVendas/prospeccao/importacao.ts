/**
 * A IMPORTAÇÃO — o ARQUIVO inteiro, e a resposta a "de onde vocês tiraram o meu
 * telefone?".
 *
 * ── O BURACO QUE ESTE ARQUIVO FECHA ─────────────────────────────────────────
 *
 * Até 10/09/2026 a casa sabia que um lead veio de `LISTA_PROSPECCAO` e sabia a
 * `proveniencia` escrita à mão no lote. Não sabia de QUAL arquivo, com que nome,
 * com quantas linhas, quantas foram recusadas e por quê, nem quem exatamente
 * subiu — `criadoPor` era texto livre.
 *
 * E havia um segundo buraco, mais barulhento no dia a dia: o frontend fatia o
 * arquivo em partes de 500, então uma lista de 8.000 virava **dezesseis** lotes
 * com nomes tipo "(parte 7/16)". Para o operador aquilo nunca foi uma lista: era
 * um monte de lote, cada um com contadores próprios, e nenhuma linha somava o
 * arquivo. A importação é a linha que soma.
 *
 * ── O FIO DE UMA IMPORTAÇÃO ─────────────────────────────────────────────────
 *
 *   `abrirImportacao`         → declara o arquivo antes de qualquer parte entrar
 *   `somarParteNaImportacao`  → uma vez por parte de 500, acumulando os números
 *   `concluirImportacao`      → todas as partes entraram
 *   `falharImportacao`        → parou no meio, e diz por quê
 *   `cancelarImportacao`      → alguém desfez: os lotes param, e NADA é apagado
 *   `arquivoJaImportado`      → "esta planilha já subiu em tal data"
 *
 * ── ⚠️ O QUE ESTE ARQUIVO NÃO FAZ ───────────────────────────────────────────
 *
 * Não lê planilha, não deduplica, não cria item nenhum e não fala com telefone
 * nenhum. Ele é o LIVRO da importação — quem carrega é `importarLote`, e os dois
 * se encontram pelo `importacaoId`.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import type { ResultadoDaImportacao } from "./lote";

type Cliente = PrismaClient | Prisma.TransactionClient;

export interface AberturaDeImportacao {
  arquivoNome: string;
  /** `text/csv`, `application/vnd...sheet`, ou o que o navegador disser. */
  arquivoTipo?: string | null;
  /**
   * SHA-256 do conteúdo, calculado no navegador antes de subir.
   *
   * ⚠️ É do CONTEÚDO, e não do nome: a mesma planilha volta a subir com nome
   * novo o tempo todo ("lista (1).xlsx", "lista final.xlsx"), e é justamente
   * essa a subida que gera contato duplicado. Nome não reconhece nada.
   */
  arquivoHash?: string | null;
  arquivoBytes?: number | null;
  /** Quantas linhas o arquivo tinha, contadas ANTES de fatiar em partes. */
  linhasTotais?: number;
  /** Por que a empresa possui estes contatos. É a base legal declarada. */
  proveniencia: string;
  /** Quem ou o que obteve a lista: busca no Google, feira, indicação, parceiro. */
  canalDeObtencao?: string | null;
  /** Rótulo de tela, `Nome (userId)`. Legado, e mantido — ver o schema. */
  criadoPor?: string | null;
  /** O id de verdade. É por ele que se responsabiliza alguém. */
  criadoPorUserId?: string | null;
  criadoPorNome?: string | null;
}

/**
 * Abre o registro do arquivo. Devolve o id que as partes vão carregar.
 *
 * ── POR QUE ABRIR ANTES, E NÃO REGISTRAR NO FIM ─────────────────────────────
 *
 * Porque a importação que FALHA no meio é a que mais precisa estar registrada.
 * Um registro criado só depois da última parte deixaria exatamente o caso ruim
 * sem rastro: oito partes entraram, a nona derrubou, e a tela não tem o que
 * mostrar além de nove lotes órfãos com nome de parte.
 *
 * A situação nasce `PROCESSANDO`, que é a verdade naquele instante.
 */
export async function abrirImportacao(
  db: Cliente,
  dados: AberturaDeImportacao,
): Promise<string> {
  const criada = await db.importacaoDeLeads.create({
    data: {
      arquivoNome: dados.arquivoNome.trim() || "arquivo sem nome",
      arquivoTipo: texto(dados.arquivoTipo),
      arquivoHash: texto(dados.arquivoHash),
      arquivoBytes: inteiro(dados.arquivoBytes),
      linhasTotais: inteiro(dados.linhasTotais) ?? 0,
      proveniencia: dados.proveniencia.trim(),
      canalDeObtencao: texto(dados.canalDeObtencao),
      criadoPor: texto(dados.criadoPor),
      criadoPorUserId: texto(dados.criadoPorUserId),
      criadoPorNome: texto(dados.criadoPorNome),
    },
    select: { id: true },
  });

  return criada.id;
}

/**
 * Soma UMA parte de 500 no registro do arquivo.
 *
 * ── POR QUE `increment`, E NÃO LER-SOMAR-GRAVAR ─────────────────────────────
 *
 * Ler o contador, somar em JavaScript e gravar de volta perde escrita quando
 * duas partes chegam juntas — e o número perdido não acusa erro nenhum: a tela
 * mostra 4.500 de 8.000 para sempre, e quem operou conclui que metade da lista
 * sumiu. `increment` soma dentro do banco, que é onde a soma é atômica.
 *
 * ── ⚠️ E O MAPA DE MOTIVOS NÃO TEM `increment` ──────────────────────────────
 *
 * `motivosDeRecusa` é JSON, e JSON o Postgres não incrementa por chave. Este é o
 * único ponto que lê-e-grava, e ele **assume que as partes de um mesmo arquivo
 * entram em sequência** — que é como o navegador as manda (um `for` com `await`,
 * uma parte por vez, de propósito). Se um dia alguém paralelizar as partes para
 * ganhar tempo, é ESTE mapa que perde número, e não os contadores.
 *
 * ── ⚠️ E `linhasTotais` NÃO É SOMADO AQUI ───────────────────────────────────
 *
 * Ele é declarado na abertura, com o arquivo inteiro na mão. Somando por parte,
 * uma importação que morresse na parte 9 diria "linhasTotais: 4.500" e ficaria
 * coerente consigo mesma — escondendo justamente as 3.500 que não entraram. O
 * total é do arquivo; o resto é do que foi processado, e a diferença entre os
 * dois é informação.
 */
export async function somarParteNaImportacao(
  db: Cliente,
  importacaoId: string,
  parte: ResultadoDaImportacao,
): Promise<void> {
  // Aceito = o que vai virar abordagem. Todo o resto entrou no estoque marcado
  // (ou nem entrou, no caso do repetido dentro do próprio arquivo) e não será
  // abordado — e para quem operou isso é uma recusa, com motivo.
  const recusadas = parte.recebidas - parte.aceitas;

  const atual = await db.importacaoDeLeads.findUnique({
    where: { id: importacaoId },
    select: { motivosDeRecusa: true },
  });

  const acumulado: Record<string, number> = { ...lerMotivos(atual?.motivosDeRecusa) };
  for (const [motivo, quantas] of Object.entries(parte.motivosDeRecusa)) {
    acumulado[motivo] = (acumulado[motivo] ?? 0) + quantas;
  }

  await db.importacaoDeLeads.update({
    where: { id: importacaoId },
    data: {
      linhasAceitas: { increment: parte.aceitas },
      novos: { increment: parte.aceitas },
      duplicadosNoArquivo: { increment: parte.repetidasNoArquivo },
      duplicadosEmOutras: { increment: parte.repetidasEmOutroLote },
      jaEramLeads: { increment: parte.jaEramLead },
      telefonesInvalidos: { increment: parte.invalidas },
      linhasRecusadas: { increment: recusadas },
      motivosDeRecusa: acumulado,
    },
  });
}

/**
 * Fecha a importação como CONCLUIDA.
 *
 * ── POR QUE COMPARAR-E-TROCAR EM VEZ DE `update` DIRETO ─────────────────────
 *
 * Existe a corrida real: as partes ainda estão subindo e alguém clica em
 * "Cancelar" na tela de importações. Um `update` cego chegando depois carimbaria
 * CONCLUIDA por cima de CANCELADA — e a tela passaria a mostrar como concluída
 * uma importação cujos lotes estão todos pausados. Mentira pior que erro: o
 * operador leria "concluída", não entenderia por que ninguém é abordado, e iria
 * procurar defeito no lugar errado.
 *
 * Só conclui o que ainda está PROCESSANDO. `ok: false` quer dizer "alguém mexeu
 * nisto antes de você", e quem chamou precisa dizer isso na tela.
 */
export async function concluirImportacao(
  db: Cliente,
  importacaoId: string,
): Promise<{ ok: boolean; motivo?: string }> {
  const r = await db.importacaoDeLeads.updateMany({
    where: { id: importacaoId, situacao: "PROCESSANDO" },
    data: { situacao: "CONCLUIDA", concluidaEm: new Date() },
  });

  return r.count === 1
    ? { ok: true }
    : { ok: false, motivo: "Esta importação já foi encerrada ou cancelada." };
}

/**
 * Marca a importação como FALHOU, com o erro técnico do jeito que ele veio.
 *
 * ⚠️ **As partes que já entraram continuam valendo.** Não é sujeira que sobrou:
 * são contatos reais, com proveniência declarada e assinatura de quem subiu.
 * Apagá-los "para limpar" seria destruir dado bom por causa de uma falha de rede
 * na parte 9. Quem quiser desfazer o arquivo inteiro usa `cancelarImportacao`,
 * que é um ato com nome, dono e motivo.
 */
export async function falharImportacao(
  db: Cliente,
  importacaoId: string,
  erro: string,
): Promise<{ ok: boolean }> {
  const r = await db.importacaoDeLeads.updateMany({
    where: { id: importacaoId, situacao: "PROCESSANDO" },
    // O erro técnico entra inteiro, e não traduzido: quem lê esta coluna é quem
    // vai investigar, e frase amigável apaga justamente o detalhe que resolve.
    data: { situacao: "FALHOU", erroTecnico: erro.slice(0, 2000), concluidaEm: new Date() },
  });
  return { ok: r.count === 1 };
}

export interface ResultadoDoCancelamento {
  ok: boolean;
  motivo?: string;
  /** Quantos lotes daquele arquivo pararam. */
  lotesPausados: number;
}

/**
 * ⭐ CANCELA a importação: os lotes param, e NADA é apagado.
 *
 * ── POR QUE PAUSAR OS LOTES, E NÃO APAGAR OS CONTATOS ───────────────────────
 *
 * Porque apagar é a operação que não tem volta, e o cancelamento quase sempre é
 * conserto de engano: subiu o arquivo errado, subiu com a procedência errada,
 * subiu duas vezes. Apagando, some junto o registro de que aqueles telefones um
 * dia entraram — e é esse registro que responde, meses depois, "por que vocês
 * tinham o meu contato?". O efeito que interessa é o contato parar de ser
 * abordado, e para isso basta o lote sair de LIBERADO.
 *
 * ── ⚠️ E POR QUE PAUSADO, E NÃO ENCERRADO ───────────────────────────────────
 *
 * ENCERRADO é porta de mão única: `liberarLote` recusa lote encerrado, de
 * propósito. Um cancelamento por engano ficaria sem conserto e obrigaria a
 * reimportar o arquivo — o que cria ficha nova para telefone que já tem ficha, e
 * o índice `(loteId, whatsappDigits)` não pega nada entre lotes diferentes.
 * PAUSADO tira da fila igual (a seleção só lê lote LIBERADO) e volta com
 * `liberarLote`, que é exatamente o que aquela função passou a servir.
 */
export async function cancelarImportacao(
  db: Cliente,
  importacaoId: string,
  quemEComQueMotivo: { quem: string; quemUserId?: string | null; motivo?: string | null },
): Promise<ResultadoDoCancelamento> {
  const importacao = await db.importacaoDeLeads.findUnique({
    where: { id: importacaoId },
    select: { situacao: true },
  });

  if (!importacao) return { ok: false, motivo: "Importação não encontrada.", lotesPausados: 0 };
  if (importacao.situacao === "CANCELADA") {
    return { ok: false, motivo: "Esta importação já estava cancelada.", lotesPausados: 0 };
  }

  const agora = new Date();

  // Os lotes primeiro, e o registro depois. Na ordem inversa, uma falha entre as
  // duas escritas deixaria a importação marcada como cancelada com os lotes
  // ainda abordando — o pior dos dois estados possíveis. Assim, a falha deixa os
  // lotes parados e a importação ainda aberta: alguém repete o cancelamento e
  // acabou.
  //
  // ⚠️ ENCERRADO fica de fora do `where`: lote encerrado já não aborda, e
  // reabri-lo como PAUSADO faria um lote com fim declarado voltar a parecer
  // retomável.
  const lotes = await db.loteDeProspeccao.updateMany({
    where: { importacaoId, situacao: { in: ["RASCUNHO", "LIBERADO"] } },
    data: { situacao: "PAUSADO", pausadoEm: agora, pausadoPor: quemEComQueMotivo.quem },
  });

  await db.importacaoDeLeads.update({
    where: { id: importacaoId },
    data: {
      situacao: "CANCELADA",
      canceladaEm: agora,
      canceladaPor: quemEComQueMotivo.quem,
      canceladaPorUserId: texto(quemEComQueMotivo.quemUserId),
      motivoDoCancelamento: texto(quemEComQueMotivo.motivo),
    },
  });

  return { ok: true, lotesPausados: lotes.count };
}

export interface ImportacaoAnterior {
  id: string;
  arquivoNome: string;
  iniciadaEm: Date;
  situacao: string;
  linhasTotais: number;
  linhasAceitas: number;
  criadoPorNome: string | null;
  criadoPor: string | null;
}

/**
 * "Esta planilha já subiu?" — respondido pelo conteúdo, antes de subir de novo.
 *
 * ── O CASO QUE ELA EVITA ────────────────────────────────────────────────────
 *
 * A mesma lista subindo duas vezes não gera abordagem duplicada (a deduplicação
 * por telefone segura isso), mas gera uma base cheia de fichas marcadas, um
 * relatório de importação que não bate com o que a pessoa acha que fez, e a
 * dúvida de sempre: "será que a primeira subida deu certo?". Reconhecer o
 * arquivo responde a dúvida antes de ela virar uma segunda subida.
 *
 * ── ⚠️ HASH VAZIO NUNCA CASA ────────────────────────────────────────────────
 *
 * Sem esta guarda, um `null` procurado no banco encontraria TODAS as importações
 * antigas sem hash — e a tela avisaria "esta planilha já subiu" para qualquer
 * arquivo novo. Aviso que sempre aparece é aviso que ninguém lê.
 *
 * ── ⚠️ E A CANCELADA NÃO CONTA ──────────────────────────────────────────────
 *
 * Cancelar é justamente o gesto de quem vai subir de novo, corrigido. Avisar
 * "já subiu" logo depois do cancelamento seria o sistema reclamando do conserto
 * que ele mesmo pediu.
 */
export async function arquivoJaImportado(
  db: Cliente,
  hash: string | null | undefined,
): Promise<ImportacaoAnterior | null> {
  const limpo = texto(hash);
  if (!limpo) return null;

  return db.importacaoDeLeads.findFirst({
    where: { arquivoHash: limpo, situacao: { not: "CANCELADA" } },
    orderBy: { iniciadaEm: "desc" },
    select: {
      id: true,
      arquivoNome: true,
      iniciadaEm: true,
      situacao: true,
      linhasTotais: true,
      linhasAceitas: true,
      criadoPorNome: true,
      criadoPor: true,
    },
  });
}

/** O JSON do banco vira mapa de números, e lixo vira mapa vazio. */
function lerMotivos(valor: unknown): Record<string, number> {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  const saida: Record<string, number> = {};
  for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) saida[chave] = v;
  }
  return saida;
}

function texto(v: string | null | undefined): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
}

/**
 * Inteiro não-negativo, ou `null`.
 *
 * ⚠️ `typeof NaN === "number"`: sem a checagem de finitude, um campo em branco
 * vindo do navegador vira `NaN`, o `NaN` vai para uma coluna INTEGER e derruba a
 * abertura da importação inteira com 500.
 */
function inteiro(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.floor(v));
}
