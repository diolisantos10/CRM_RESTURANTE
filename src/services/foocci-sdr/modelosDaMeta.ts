/**
 * OS MODELOS APROVADOS, LIDOS DA META — a Sala para de depender de alguém colar.
 *
 * ── DE ONDE VEIO ESTA PEÇA ──────────────────────────────────────────────────
 *
 * Pergunta do CEO, 08/09/2026: *"Como podemos fazer igual o Foocci, que já puxa
 * os modelos aprovados sozinho?"*
 *
 * Ele estava certo. O produto já lê os modelos do restaurante direto da Graph
 * (`MetaTemplateService.syncFromMeta`), com nome, idioma, status e — o que mais
 * importa aqui — **quantas variáveis cada um espera**. A Sala não usava nada
 * disso: o nome do modelo dela vinha de uma variável de ambiente e o texto vivia
 * só na Meta, sem ninguém conferir se um batia com o outro.
 *
 * ── O RISCO QUE ISTO EXISTE PARA MATAR ──────────────────────────────────────
 *
 * `abordarLead` manda **um** parâmetro: a saudação. Se o modelo aprovado tiver
 * `{{1}}` e `{{2}}`, **todo** envio é recusado pela Meta — e a rodada descobre
 * isso contato a contato, queimando a lista para aprender o que uma consulta
 * responde antes de começar.
 *
 * Ler da Meta também mata a dependência de memória: texto colado envelhece no
 * dia em que alguém aprova outro modelo e esquece de avisar. **A fonte da
 * verdade é a Meta, e ela responde de graça.**
 *
 * ── O QUE ESTE ARQUIVO NÃO FAZ ──────────────────────────────────────────────
 *
 * Não escreve nada na Meta, não cria modelo, não envia mensagem. Duas leituras:
 * resolver a conta a partir do número de vendas, e listar os modelos dela.
 *
 * 🔒 O token vai no cabeçalho e não sai em nenhum retorno.
 */

import { metaGraphUrl } from "@/services/whatsapp/metaFlag";
import { maskGraphResponse } from "@/services/whatsapp/providers/metaPayload";
import { countBodyVariables } from "@/services/whatsapp/MetaTemplateService";
import { foocciSalesPhoneNumberId, comOTokenDeVendas } from "./FoocciSalesChannel";
import { modeloConfigurado } from "@/services/salaDeVendas/abordar";
import { MetaAppCredentialsService } from "@/services/meta/MetaAppCredentialsService";

export interface ModeloNaMeta {
  nome: string;
  idioma: string;
  /** Como a Meta chama: APPROVED, PENDING, REJECTED… */
  status: string;
  /** Quantas variáveis `{{n}}` o corpo espera. Zero = modelo sem variável. */
  variaveis: number;
}

export type Falha = { ok: false; erro: string };

/**
 * ⭐ O CLIENTE GRAPH DA SALA — **um só**, com duas portas de entrada.
 *
 * `graphDeVendas` recebe um CAMINHO e monta o endereço com `metaGraphUrl`.
 * `graphAbsoluto` recebe o endereço já pronto — e existe por um motivo só: a
 * paginação da Meta devolve `paging.next` **absoluto, com o cursor dentro**.
 * Remontar esse endereço a partir do caminho perderia o cursor, e a varredura
 * releria a primeira página para sempre sem nunca declarar que travou.
 *
 * As duas dividem o MESMO tratamento de erro de propósito. Um segundo cliente
 * com o seu próprio `catch` é como a recusa da Meta vira `undefined` num
 * caminho e frase legível no outro — e quem investiga só encontra o mudo.
 */
export async function graphAbsoluto(url: string, token: string): Promise<unknown | Falha> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { error?: { message?: string } }).error?.message;
    return { ok: false, erro: maskGraphResponse(err ?? `HTTP_${res.status}`) };
  }
  return json;
}

export function graphDeVendas(caminho: string, token: string): Promise<unknown | Falha> {
  return graphAbsoluto(metaGraphUrl(caminho), token);
}

export function ehFalha(x: unknown): x is Falha {
  return typeof x === "object" && x !== null && (x as Falha).ok === false;
}

/**
 * A conta (WABA) dona do número de vendas.
 *
 * O ambiente da Sala guarda o `phone_number_id`, não a conta — e a listagem de
 * modelos é da conta. A Graph faz a ponte, e é por isso que este passo existe
 * em vez de mais uma variável para alguém preencher errado.
 */
export async function contaDoNumeroDeVendas(
  token: string,
): Promise<{ ok: true; wabaId: string } | Falha> {
  const id = foocciSalesPhoneNumberId();
  if (!id) return { ok: false, erro: "FOOCCI_SALES_PHONE_NUMBER_ID não está no ambiente" };

  /**
   * ── Caminho 0: alguém já sabe a resposta ──
   *
   * ⚠️ Eu evitei esta variável de propósito no #217 — *"menos uma coisa que
   * depende de alguém lembrar"*. A derivação automática era melhor **se
   * funcionasse**, e em 08/09/2026 ela foi medida com o token de produção e
   * **não funciona**: nem o número expõe a conta, nem o token traz alvo.
   *
   * Doutrina 33 aplicada a mim mesmo: a preferência por derivar era uma
   * afirmação sobre o sistema, e a medição a derrubou. A variável fica como
   * saída de emergência — quem tem o id em mãos destrava em um minuto — e os
   * caminhos automáticos continuam existindo para quando não houver ninguém.
   */
  // ── Caminho 0a: o que a casa APRENDEU do webhook ──
  //
  // ⭐ 10/09/2026, ordem do Diretor Geral: *"persistir o WABA da Sala a partir
  // de envelope válido do número comercial... manter a variável como fallback,
  // não como única fonte."*
  //
  // O `entry[].id` do webhook É o WABA, e o #230 já o encontra. Até hoje ele só
  // ia para o log, pedindo que alguém copiasse para a variável — dependência
  // humana num dado que chega sozinho, várias vezes por dia.
  //
  // ⚠️ Só vale se estiver casado com o número de vendas ATUAL. Trocar o número
  // sem trocar o WABA faria a casa consultar a conta errada — e a conta errada,
  // aqui, é a de um restaurante cliente.
  const aprendido = await wabaAprendido(id);
  if (aprendido) return { ok: true, wabaId: aprendido };

  const daMao = (process.env.FOOCCI_SALES_WABA_ID ?? "").trim();
  if (daMao) return { ok: true, wabaId: daMao };

  // ── Caminho 1: perguntar ao próprio número ──
  const r = await graphDeVendas(`${id}?fields=whatsapp_business_account{id}`, token);
  if (!ehFalha(r)) {
    const waba = (r as { whatsapp_business_account?: { id?: unknown } }).whatsapp_business_account;
    const wabaId = waba?.id != null ? String(waba.id) : "";
    if (wabaId) return { ok: true, wabaId };
  }

  /**
   * ── Caminho 2: perguntar ao TOKEN ──
   *
   * ⚠️ MEDIDO EM PRODUÇÃO, 08/09/2026: com o token de usuário de sistema, o
   * caminho 1 devolve
   *
   *   (#100) Tried accessing nonexisting field (whatsapp_business_account)
   *
   * — e o pré-voo ficava cego, seguia, e a rodada descobria o problema do
   * modelo **queimando três contatos** na Meta. A conferência que existe para
   * economizar contatos não pode depender de um único caminho de leitura.
   *
   * `debug_token` devolve `granular_scopes`, e cada permissão de WhatsApp vem
   * com os `target_ids` — que são exatamente as contas (WABA) que este token
   * alcança. É a resposta mais confiável das duas: ela vem do token, não de
   * um campo que muda de nome entre versões da Graph.
   */
  const doToken = await contaPeloToken(token);
  if (doToken.ok) return { ok: true, wabaId: doToken.wabaId };

  // ── Caminho 3: pelo negócio dono do aplicativo ──
  const doNegocio = await contaPeloNegocio(token, id);
  if (doNegocio.ok) return { ok: true, wabaId: doNegocio.wabaId };

  /**
   * ⚠️ OS DOIS MOTIVOS, e não só o primeiro.
   *
   * A versão anterior devolvia só o erro do caminho 1 quando os dois falhavam.
   * Medido em produção, 08/09/2026: o log repetia `(#100) campo inexistente` —
   * o erro do caminho 1 — e **o caminho 2 falhava em silêncio**. Investigar
   * ficou impossível sem ler o código, e o custo do não-saber foi pago em
   * contatos queimados: três por rodada.
   *
   * Guardrail 6 pela quarta vez no mesmo dia, e a única forma de parar de
   * repeti-lo é a frase carregar TUDO que se tentou.
   */
  return {
    ok: false,
    erro:
      `pelo número: ${ehFalha(r) ? r.erro : "a Meta não devolveu a conta"}` +
      ` · pelo token: ${doToken.erro}` +
      ` · pelo negócio: ${doNegocio.erro}` +
      ` · saída: defina FOOCCI_SALES_WABA_ID com o id da conta`,
  };
}

/**
 * ⭐ Caminho 3: o negócio dono do aplicativo lista as contas dele, e a gente
 * escolhe **a que contém o nosso número** — não a primeira.
 *
 * ⚠️ Escolher a primeira seria o defeito clássico desta casa numa forma nova: o
 * mesmo negócio pode ter a conta do produto (a dos restaurantes) e a da Sala.
 * Listar os modelos da conta errada devolveria "não achado" para um modelo que
 * existe, e a investigação iria procurar no lugar errado.
 */
async function contaPeloNegocio(token: string, phoneNumberId: string): Promise<ContaPeloToken> {
  const cred = await MetaAppCredentialsService.getResolved().catch(() => null);
  if (!cred?.appId) return { ok: false, erro: "sem appId para achar o negócio" };

  const app = await graphDeVendas(`${cred.appId}?fields=business{id}`, token);
  if (ehFalha(app)) return { ok: false, erro: `o aplicativo não disse o negócio: ${app.erro}` };

  const negocio = (app as { business?: { id?: unknown } }).business;
  const negocioId = negocio?.id != null ? String(negocio.id) : "";
  if (!negocioId) return { ok: false, erro: "o aplicativo não está ligado a um negócio" };

  const contas = await graphDeVendas(
    `${negocioId}/owned_whatsapp_business_accounts?fields=id&limit=100`,
    token,
  );
  if (ehFalha(contas)) return { ok: false, erro: `o negócio não listou as contas: ${contas.erro}` };

  const linhas = (contas as { data?: unknown }).data;
  const ids = (Array.isArray(linhas) ? linhas : [])
    .map((c) => (c as { id?: unknown }).id)
    .filter((v): v is string | number => v != null)
    .map(String);

  if (ids.length === 0) return { ok: false, erro: "o negócio não tem contas de WhatsApp" };

  for (const wabaId of ids) {
    const numeros = await graphDeVendas(`${wabaId}/phone_numbers?fields=id&limit=100`, token);
    if (ehFalha(numeros)) continue;
    const lista = (numeros as { data?: unknown }).data;
    const temONosso = (Array.isArray(lista) ? lista : []).some(
      (n) => String((n as { id?: unknown }).id) === phoneNumberId,
    );
    if (temONosso) return { ok: true, wabaId };
  }

  return {
    ok: false,
    erro: `nenhuma das ${ids.length} conta(s) do negócio contém o número de vendas`,
  };
}

type ContaPeloToken = { ok: true; wabaId: string } | { ok: false; erro: string };

/** As contas que o token alcança, lidas do próprio token. */
async function contaPeloToken(token: string): Promise<ContaPeloToken> {
  const cred = await MetaAppCredentialsService.getResolved().catch(() => null);
  if (!cred?.appId || !cred?.appSecret) {
    return { ok: false, erro: "sem credencial de aplicativo (appId/appSecret) para abrir o token" };
  }

  const appToken = `${cred.appId}|${cred.appSecret}`;
  const r = await graphDeVendas(
    `debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`,
    token,
  );
  if (ehFalha(r)) return { ok: false, erro: `debug_token recusou: ${r.erro}` };

  const escopos = (r as { data?: { granular_scopes?: unknown } }).data?.granular_scopes;
  if (!Array.isArray(escopos)) {
    return { ok: false, erro: "o token não trouxe `granular_scopes`" };
  }

  // A permissão de gerenciar é a que enxerga modelos; a de mensagens serve de
  // reserva, porque em contas antigas só ela vem com alvo.
  for (const nome of ["whatsapp_business_management", "whatsapp_business_messaging"]) {
    for (const e of escopos) {
      const linha = e as { scope?: unknown; target_ids?: unknown };
      if (linha.scope !== nome) continue;
      const alvos = Array.isArray(linha.target_ids) ? linha.target_ids : [];
      if (alvos.length > 0) return { ok: true, wabaId: String(alvos[0]) };
    }
  }

  // O que EXISTE no token entra na frase: é o que diz se falta permissão ou
  // se ela está lá sem alvo — dois consertos diferentes.
  const vistos = escopos
    .map((e) => (e as { scope?: unknown }).scope)
    .filter((v): v is string => typeof v === "string");
  return {
    ok: false,
    erro: `nenhuma permissão de WhatsApp com alvo. Permissões no token: ${vistos.join(", ") || "(nenhuma)"}`,
  };
}

/** Todos os modelos da conta do número de vendas, como a Meta os vê agora. */
export async function listarModelosDeVendas(
  token: string,
): Promise<{ ok: true; modelos: ModeloNaMeta[] } | Falha> {
  const conta = await contaDoNumeroDeVendas(token);
  if (!conta.ok) return conta;

  const r = await graphDeVendas(
    `${conta.wabaId}/message_templates?fields=name,language,status,components&limit=200`,
    token,
  );
  if (ehFalha(r)) return r;

  const linhas = (r as { data?: unknown }).data;
  const modelos: ModeloNaMeta[] = (Array.isArray(linhas) ? linhas : []).flatMap((t) => {
    const tpl = t as { name?: unknown; language?: unknown; status?: unknown; components?: unknown };
    if (!tpl.name) return [];
    return [{
      nome: String(tpl.name),
      idioma: String(tpl.language ?? "pt_BR"),
      status: String(tpl.status ?? "UNKNOWN").toUpperCase(),
      variaveis: countBodyVariables(tpl.components),
    }];
  });

  return { ok: true, modelos };
}

export type ConferenciaDoModelo =
  | { pronto: true; modelo: ModeloNaMeta; parametrosQueMandamos: number }
  | {
      pronto: false;
      causa:
        | "semNomeConfigurado"
        | "semToken"
        | "naoAchado"
        | "naoAprovado"
        /**
         * ⭐ 12/09/2026 — a Meta aprovou o TEXTO; o CEO não autorizou o USO.
         * `ModeloDeVendas.autorizado === false`, marcado à mão sobre um
         * modelo específico (v1 em revisão). Ver o comentário grande no
         * schema e o cabeçalho desta função.
         */
        | "naoAutorizado"
        | "variaveisNaoBatem"
        | "metaRecusou";
      detalhe: string;
    };

/** As causas de reprovação, para quem precisa reagir a cada uma. */
export type CausaDaConferencia = Extract<ConferenciaDoModelo, { pronto: false }>["causa"];

/**
 * ⭐ A CONFERÊNCIA QUE SE FAZ ANTES DE DISPARAR, e não durante.
 *
 * Responde, numa consulta: o modelo configurado existe na Meta? está aprovado?
 * quantas variáveis ele espera, e isso bate com o que o código manda?
 *
 * `parametrosQueMandamos` é **1** — a saudação (`abordarLead` monta
 * `parametros: [saudação]`, ou `[]` quando o contato não tem nome).
 *
 * ── POR QUE 0 e 1 PASSAM, e 2 NÃO ───────────────────────────────────────────
 *
 * Com `{{1}}`, o contato COM nome vai; o sem nome é recusado pela Meta e a
 * rodada pula (a defesa que o #216 instalou). É perda parcial e conhecida.
 * Com duas ou mais variáveis, **nenhum** contato passa — 100% de recusa, e a
 * rodada só descobriria isso queimando três contatos até bater o limite.
 *
 * Recusar aqui custa uma consulta. Descobrir lá custa a janela do dia.
 */
export async function conferirModeloDeAbordagem(token: string): Promise<ConferenciaDoModelo> {
  const cfg = modeloConfigurado();
  if (!cfg.nome) {
    return {
      pronto: false,
      causa: "semNomeConfigurado",
      detalhe: "FOOCCI_SDR_MODELO_ABORDAGEM não está no ambiente",
    };
  }

  const lista = await listarModelosDeVendas(token);
  if (!lista.ok) return { pronto: false, causa: "metaRecusou", detalhe: lista.erro };

  const achado = lista.modelos.find((m) => m.nome === cfg.nome && m.idioma === cfg.idioma)
    // Idioma diferente do configurado ainda é um achado — e o detalhe diz qual,
    // porque "não achei" mandaria procurar o modelo errado.
    ?? lista.modelos.find((m) => m.nome === cfg.nome);

  if (!achado) {
    return {
      pronto: false,
      causa: "naoAchado",
      detalhe: `"${cfg.nome}" não está entre os ${lista.modelos.length} modelos da conta`,
    };
  }

  if (achado.status !== "APPROVED") {
    return {
      pronto: false,
      causa: "naoAprovado",
      detalhe: `"${achado.nome}" está ${achado.status} na Meta`,
    };
  }

  // ── ⭐ O GATE DE AUTORIZAÇÃO INTERNA, 12/09/2026 ──────────────────────────
  //
  // Aprovado na Meta é a metade da pergunta. A outra metade — "o CEO já
  // autorizou a casa a USAR este modelo?" — vive em `ModeloDeVendas.autorizado`,
  // e é conferida ANTES da comparação de variáveis de propósito: um modelo
  // desautorizado pode até ter o número de variáveis certo, e ainda assim não
  // pode sair. Comparar variável primeiro esconderia a causa real por trás de
  // "variaveisNaoBatem" sempre que a coincidência numérica desse zero.
  //
  // `null` (nenhuma linha persistida ainda) não bloqueia aqui — ausência de
  // sincronização não é negação de autorização (guardrail 1). O padrão do
  // schema é `autorizado: true`; só quem MARCOU `false` à mão bloqueia.
  const autorizado = await autorizacaoDoModeloPersistido(cfg.nome, cfg.idioma);
  if (autorizado === false) {
    return {
      pronto: false,
      causa: "naoAutorizado",
      detalhe:
        `"${achado.nome}" (${achado.idioma}) está APPROVED na Meta, mas ainda não foi ` +
        `autorizado internamente para uso (autorizado=false). Autorização expressa é decisão do CEO.`,
    };
  }

  // ⛔ CORRESPONDÊNCIA EXATA, e não "no máximo uma".
  //
  // ── O DEFEITO, ATÉ 10/09/2026 ─────────────────────────────────────────────
  //
  // Esta conferência aceitava 0 OU 1 variável e declarava que o envio manda 1.
  // Mas `abordarLead` montava `nome ? [nome] : []` — **um payload que muda com
  // o contato**. Contra um modelo de `{{1}}`, o contato com nome passava e o
  // sem nome era recusado pela Meta; contra um modelo de zero variáveis, o
  // contato COM nome é que era recusado.
  //
  // Ou seja: o pré-voo dizia "pronto" e a rodada descobria o contrário, contato
  // a contato. O template aprovado tem contrato FIXO; o payload também precisa
  // ter. Quem manda no número é a Meta — este código só confere se bate.
  //
  // ── ⭐ O QUE MUDOU EM 10/09/2026, E O QUE NÃO MUDOU ────────────────────────
  //
  // NÃO mudou a regra: continua sendo igualdade EXATA, e continua bloqueando
  // antes de sair. Mudou de onde vem o número do nosso lado — do modelo que a
  // Meta respondeu e nós persistimos, com o ambiente de reserva.
  //
  // ⚠️ Isto **não** vira uma comparação de um valor consigo mesmo. `esperados`
  // vem da Meta consultada AGORA; `monta` vem do retrato gravado na última
  // sincronização. Quando alguém edita o modelo na Meta e ninguém sincroniza,
  // os dois discordam — e é justamente esse o caso em que o envio montaria pelo
  // retrato velho e a Meta recusaria 100% dos contatos.
  const esperados = achado.variaveis;
  const monta = await parametrosDoEnvioAgora();
  if (esperados !== monta) {
    return {
      pronto: false,
      causa: "variaveisNaoBatem",
      detalhe:
        `a Meta respondeu que "${achado.nome}" (${achado.idioma}) espera ${esperados} ` +
        `variável(is) e o envio monta ${monta}. Sincronize os modelos da Sala — ` +
        `na falta do banco, ajuste FOOCCI_SDR_MODELO_VARIAVEIS para ${esperados}.`,
    };
  }

  return { pronto: true, modelo: achado, parametrosQueMandamos: esperados };
}

/**
 * Quantas variáveis o envio monta — o contrato do NOSSO lado.
 *
 * ── ⭐ A FONTE MUDOU EM 10/09/2026: O BANCO VEM PRIMEIRO, O AMBIENTE É RESERVA ─
 *
 * Até aqui este número vinha **só** de `FOOCCI_SDR_MODELO_VARIAVEIS`: pedia-se a
 * uma pessoa que digitasse, num painel, um número que **a própria API da Meta
 * responde sozinha**. Todo dado que depende de alguém lembrar de atualizar
 * envelhece no dia em que outra pessoa aprova um modelo novo e não avisa — e o
 * preço deste envelhecer específico é 100% de recusa na rodada seguinte.
 *
 * Agora a primeira fonte é o modelo **persistido** por `sincronizarModelosDeVendas`,
 * que grava o que a Meta respondeu, contado por `countBodyVariables` sobre o
 * corpo real. O ambiente continua existindo como **reserva**, e não por
 * simetria: enquanto ninguém tiver sincronizado — primeira subida, banco fora
 * do ar, WABA ainda não resolvida — o número precisa vir de algum lugar
 * declarado, e "não sei" não pode virar zero (ver o bloco do vazio, abaixo).
 *
 * ⚠️ ISTO NÃO AFROUXA O CONTRATO P0.2. O pré-voo continua exigindo
 * correspondência EXATA e continua bloqueando antes de sair. O que mudou é de
 * onde sai o número do nosso lado — e a comparação segue valendo, porque o
 * outro lado da conta é a Meta **consultada agora**, ao vivo, contra um valor
 * persistido na última sincronização. Modelo editado na Meta depois do último
 * sincronismo faz os dois discordarem, e é exatamente aí que o pré-voo tem de
 * reprovar: o envio montaria pelo retrato velho.
 *
 * ⚠️ Valor inválido cai na fonte seguinte em vez de virar zero: um campo em
 * branco no painel não pode, sozinho, mudar o formato do que sai para o cliente.
 */
export function parametrosQueOEnvioMonta(
  env: NodeJS.ProcessEnv = process.env,
  doModeloPersistido: number | null = null,
): number {
  // ── Fonte 1: o que a Meta respondeu e nós gravamos ──
  //
  // O teto de 10 é o mesmo do ambiente e vale aqui também: um número absurdo
  // vindo do banco é corrupção de dado, não contrato, e seguir com ele mandaria
  // o pré-voo comparar lixo com lixo.
  if (
    doModeloPersistido !== null &&
    Number.isInteger(doModeloPersistido) &&
    doModeloPersistido >= 0 &&
    doModeloPersistido <= 10
  ) {
    return doModeloPersistido;
  }

  // ── Fonte 2: o ambiente, agora como RESERVA ──
  const bruto = (env.FOOCCI_SDR_MODELO_VARIAVEIS ?? "").trim();

  // ⚠️ VAZIO NÃO É ZERO, e o teste pegou isto na primeira rodada: `Number("")`
  // é `0`, e `0` é inteiro — a variável AUSENTE virava "mande zero parâmetros"
  // silenciosamente, mudando o formato do que sai para o cliente sem ninguém
  // ter decidido. Ausência cai no padrão; zero só vale escrito.
  if (bruto === "") return 1;

  const n = Number(bruto);
  if (!Number.isInteger(n) || n < 0 || n > 10) return 1;
  return n;
}

/**
 * ⭐ O MESMO NÚMERO, JÁ COM O BANCO CONSULTADO — a versão que a produção usa.
 *
 * `parametrosQueOEnvioMonta` fica pura e síncrona porque é ela que o teste
 * mede; esta busca o modelo persistido e entrega o resultado à função pura.
 *
 * ⛔ **O PRÉ-VOO E O ENVIO PRECISAM CHAMAR ESTA MESMA FUNÇÃO.** Se o pré-voo
 * conferir pelo banco e o envio montar pelo ambiente, a conferência aprova um
 * contrato e o disparo manda outro — e o defeito que a P0.2 existe para matar
 * volta pela porta dos fundos, agora com um pré-voo verde por cima. Régua verde
 * sobre o componente errado é pior que régua nenhuma.
 *
 * ⚠️ **Nunca lança.** Banco indisponível cai na reserva do ambiente: recusar o
 * dia inteiro de abordagem porque o Postgres piscou seria trocar um defeito por
 * outro maior.
 */
export async function parametrosDoEnvioAgora(db?: unknown): Promise<number> {
  const cfg = modeloConfigurado();
  const doBanco = await variaveisDoModeloPersistido(db, cfg.nome, cfg.idioma);
  return parametrosQueOEnvioMonta(process.env, doBanco);
}

/**
 * Quantas variáveis o modelo APROVADO e persistido tem, ou `null` na dúvida.
 *
 * `null` em qualquer incerteza — sem nome configurado, sem linha, banco fora do
 * ar — porque `null` manda o chamador para a reserva declarada. Um palpite aqui
 * (zero, por exemplo) mudaria o formato do que sai para o cliente sem ninguém
 * ter decidido: é o guardrail 1 aplicado a um número.
 *
 * ⚠️ O import é dinâmico de propósito: `sincronizarModelos` importa este
 * arquivo para resolver a conta, e um import estático de volta fecharia o ciclo.
 */
async function variaveisDoModeloPersistido(
  db: unknown,
  nome: string,
  idioma: string,
): Promise<number | null> {
  if (!nome) return null;
  try {
    const { modeloAprovadoDaSala } = await import("./sincronizarModelos");
    const linha = await modeloAprovadoDaSala(db, nome, idioma);
    return linha ? linha.variaveis : null;
  } catch {
    return null;
  }
}

/**
 * O `autorizado` do modelo persistido, ou `null` na dúvida — sem nome
 * configurado, sem linha (nunca sincronizado), banco fora do ar.
 *
 * ⚠️ `null` NUNCA é tratado como `false` por quem chama: ver o comentário
 * grande em `conferirModeloDeAbordagem`. O import dinâmico é pelo mesmo motivo
 * de `variaveisDoModeloPersistido` — `sincronizarModelos` importa este arquivo
 * de volta, e um import estático fecharia o ciclo.
 */
async function autorizacaoDoModeloPersistido(nome: string, idioma: string): Promise<boolean | null> {
  if (!nome) return null;
  try {
    const { modeloAprovadoDaSala } = await import("./sincronizarModelos");
    const linha = await modeloAprovadoDaSala(undefined, nome, idioma);
    return linha ? linha.autorizado : null;
  } catch {
    return null;
  }
}

/**
 * ⭐ O PRÉ-VOO — a conferência com o token do ambiente, pronta para ser chamada.
 *
 * `conferirModeloDeAbordagem` recebe o token porque assim ela é testável sem
 * ambiente. Esta é a versão que a produção usa: o token vem emprestado de
 * `comOTokenDeVendas` e não passa pelas mãos de ninguém.
 *
 * ⚠️ **Sem token, a resposta é `semToken` — e não uma aprovação.** O caminho
 * mudo seria devolver "está tudo bem, não consegui conferir": é exatamente o
 * guardrail 1 (ausência de informação não é informação), e é o que faria a
 * rodada sair achando que passou pela conferência.
 */
export function preVooDoModelo(): Promise<ConferenciaDoModelo> {
  return comOTokenDeVendas<ConferenciaDoModelo>(conferirModeloDeAbordagem, () => ({
    pronto: false,
    causa: "semToken",
    detalhe: "FOOCCI_SALES_ACCESS_TOKEN não está no ambiente",
  }));
}


// ─── O número, como a Meta o descreve ────────────────────────────────────────

/**
 * O cadastro do número de vendas na Meta — inclusive **o teto que ela concede**.
 *
 * ── POR QUE O TIER ENTRA AQUI, E NÃO NUMA VARIÁVEL ──────────────────────────
 *
 * `messaging_limit_tier` é quantas conversas a Meta deixa a gente INICIAR por
 * dia (`TIER_250`, `TIER_1K`, `TIER_10K`…). Ele sobe e desce sozinho, conforme
 * qualidade e volume, e ninguém do nosso lado é avisado. Um teto de operação
 * escrito à mão acima do que a Meta permite não é teto: é o número que aparece
 * na tela enquanto a plataforma corta os envios no meio da lista.
 *
 * O WABA vem junto porque é a conta de onde os modelos são lidos — mostrar o
 * número sem a conta deixaria de fora metade do que prova que estamos falando
 * da caixa certa (e a caixa errada, aqui, é a de um restaurante cliente).
 *
 * 🔒 O token entra no cabeçalho e não sai no retorno.
 */
export interface DetalhesDoNumero {
  phoneNumberId: string;
  wabaId: string | null;
  /** Como a Meta escreve o número. A prova do apontamento. */
  numero: string | null;
  nomeVerificado: string | null;
  qualidade: string | null;
  /** `TIER_250`, `TIER_1K`, `TIER_10K`, `TIER_UNLIMITED`… como a Meta devolve. */
  tier: string | null;
  /** Preenchido quando algum dos dois passos falhou. Nunca silencioso. */
  erro: string | null;
}

export async function detalhesDoNumeroDeVendas(token: string): Promise<DetalhesDoNumero> {
  const phoneNumberId = foocciSalesPhoneNumberId() ?? "";

  // A conta é resolvida primeiro e o erro dela é GUARDADO, não descartado: sem
  // WABA não há modelo para listar, e "a lista veio vazia" mandaria procurar
  // modelo perdido em vez de conta não resolvida.
  const conta = await contaDoNumeroDeVendas(token);
  const wabaId = conta.ok ? conta.wabaId : null;

  const r = await graphDeVendas(
    `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`,
    token,
  );

  if (ehFalha(r)) {
    return {
      phoneNumberId,
      wabaId,
      numero: null,
      nomeVerificado: null,
      qualidade: null,
      tier: null,
      erro: conta.ok ? r.erro : `${r.erro} · conta: ${conta.erro}`,
    };
  }

  const d = r as {
    display_phone_number?: unknown;
    verified_name?: unknown;
    quality_rating?: unknown;
    messaging_limit_tier?: unknown;
  };

  return {
    phoneNumberId,
    wabaId,
    numero: d.display_phone_number != null ? String(d.display_phone_number) : null,
    nomeVerificado: d.verified_name != null ? String(d.verified_name) : null,
    qualidade: d.quality_rating != null ? String(d.quality_rating) : null,
    tier: d.messaging_limit_tier != null ? String(d.messaging_limit_tier) : null,
    erro: conta.ok ? null : `conta: ${conta.erro}`,
  };
}


// ─── O WABA aprendido do webhook ─────────────────────────────────────────────

/**
 * O WABA persistido, **se** ele pertencer ao número de vendas de hoje.
 *
 * Devolve `null` em qualquer dúvida — sem registro, registro de outro número,
 * ou banco indisponível. `null` manda o chamador seguir para os outros
 * caminhos; um palpite mandaria a casa consultar a conta errada.
 */
export async function wabaAprendido(phoneNumberId: string): Promise<string | null> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const cfg = await prisma.prospeccaoConfig.findUnique({
      where: { id: "singleton" },
      select: { salaWabaId: true, salaWabaPhoneNumber: true },
    });
    if (!cfg?.salaWabaId) return null;
    // O par tem de bater. WABA sem número casado não prova nada.
    if (cfg.salaWabaPhoneNumber !== phoneNumberId) return null;
    return cfg.salaWabaId;
  } catch {
    return null;
  }
}

/**
 * Aprende o WABA a partir de um envelope de webhook do número de vendas.
 *
 * ── ⚠️ SÓ ESCREVE QUANDO TEM CERTEZA DOS DOIS LADOS ────────────────────────
 *
 * Exige que o `phoneNumberId` do envelope seja EXATAMENTE o número de vendas
 * configurado. Sem essa conferência, um envelope de restaurante gravaria o WABA
 * do cliente como se fosse o da Sala — e a partir daí a casa consultaria
 * modelos, limites e qualidade da conta errada.
 *
 * Idempotente e barata: só escreve quando o valor MUDA, então o caminho normal
 * (o mesmo WABA chegando o dia inteiro) não toca o banco.
 *
 * **Nunca lança.** É chamada de dentro do webhook, e um erro aqui não pode
 * derrubar o recebimento de uma mensagem de cliente.
 */
export async function aprenderWabaDaSala(input: {
  phoneNumberId: string | null | undefined;
  wabaId: string | null | undefined;
  agora?: Date;
}): Promise<void> {
  const numero = (input.phoneNumberId ?? "").trim();
  const waba = (input.wabaId ?? "").trim();
  if (!numero || !waba) return;

  const daSala = foocciSalesPhoneNumberId();
  if (!daSala || numero !== daSala) return;

  try {
    const { prisma } = await import("@/lib/prisma");
    const cfg = await prisma.prospeccaoConfig.findUnique({
      where: { id: "singleton" },
      select: { salaWabaId: true, salaWabaPhoneNumber: true },
    });
    if (cfg?.salaWabaId === waba && cfg?.salaWabaPhoneNumber === numero) return;

    await prisma.prospeccaoConfig.update({
      where: { id: "singleton" },
      data: {
        salaWabaId: waba,
        salaWabaPhoneNumber: numero,
        salaWabaVistoEm: input.agora ?? new Date(),
      },
    });
    console.info("[prospeccao] WABA da Sala aprendido do webhook", { numero, waba });
  } catch (e) {
    console.error("[prospeccao] não consegui gravar o WABA da Sala", e);
  }
}
