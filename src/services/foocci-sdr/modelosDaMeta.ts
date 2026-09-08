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

type Falha = { ok: false; erro: string };

async function graphDeVendas(caminho: string, token: string): Promise<unknown | Falha> {
  const res = await fetch(metaGraphUrl(caminho), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { error?: { message?: string } }).error?.message;
    return { ok: false, erro: maskGraphResponse(err ?? `HTTP_${res.status}`) };
  }
  return json;
}

function ehFalha(x: unknown): x is Falha {
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

  if (achado.variaveis > 1) {
    return {
      pronto: false,
      causa: "variaveisNaoBatem",
      detalhe: `o modelo espera ${achado.variaveis} variáveis e o envio manda 1`,
    };
  }

  return { pronto: true, modelo: achado, parametrosQueMandamos: 1 };
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
