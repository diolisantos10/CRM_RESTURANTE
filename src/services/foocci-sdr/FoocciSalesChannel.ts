/**
 * FoocciSalesChannel — o número de VENDAS da Foocci. A porta do SDR.
 *
 * ── O buraco que este arquivo tapa ───────────────────────────────────────────
 * Todo envio de WhatsApp do Foocci é **por restaurante**: o provedor busca a
 * credencial pelo `restaurantId`. A Foocci vendendo o Foocci não tem restaurante.
 * Antes daqui existiam exatamente dois números sem dono — o do suporte técnico e
 * o Master do Build OS — e usar qualquer um deles para vender misturaria prospecto
 * com comando de sistema. `docs/sdr-foocci-desenho.md` já dizia: *"não é opção"*.
 *
 * Este é o terceiro número sem restaurante, e o primeiro que existe para falar
 * com quem ainda não é cliente. Por isso ele nasce com mais travas, não menos.
 *
 * ── DESLIGADO POR CONSTRUÇÃO, em três chaves independentes ───────────────────
 *   1. `FOOCCI_SALES_PHONE_NUMBER_ID` + `FOOCCI_SALES_ACCESS_TOKEN` ausentes →
 *      o canal não existe: não recebe e não envia.
 *   2. `FOOCCI_SDR_SEND_ENABLED` ≠ "true" → RECEBE (a conversa entra e fica
 *      registrada) mas NÃO ENVIA. É este o estado de hoje, e é deliberado: a
 *      escada de liberação do Cérebro exige evidência antes da primeira mensagem.
 *   3. Nenhum envio acontece sem uma decisão APROVADA do portão de lead — e a
 *      decisão é o primeiro parâmetro da função, não uma checagem que alguém
 *      pode esquecer de fazer. Guardrail 4: prompt é aviso, código é trava.
 *
 * Meio-configurado é desligado, como no resto da casa: sequestrar a mensagem sem
 * poder responder deixaria o lead falando sozinho.
 *
 * ── A COSTURA DO PROVEDOR — por que ela existe e o que ela NÃO é ─────────────
 * Hoje o Foocci tem **um** provedor: a Meta homologada (a Evolution saiu em
 * 04/08/2026 por ordem do CEO — ver `src/services/whatsapp/activeProvider.ts`).
 * `resolverProvedorDeVendas()` existe para que a escolha do canal do SDR seja
 * **uma variável de ambiente**, e para que um provedor não previsto **falhe
 * declarando**, em vez de cair silenciosamente na Meta.
 *
 * Isto NÃO é a Evolution voltando. É a diferença entre trocar de canal amanhã
 * mexendo num arquivo e ter que caçar o envio espalhado por dez chamadas.
 *
 * 🔒 O token nunca é logado, nem mascarado, nem devolvido em resposta de API.
 */

import { metaGraphUrl } from "@/services/whatsapp/metaFlag";
import {
  buildMetaTextPayload,
  buildMetaTemplatePayload,
  toMetaRecipient,
  maskGraphResponse,
} from "@/services/whatsapp/providers/metaPayload";
import type { LeadSafetyDecision } from "./LeadContactSafety";

// ─── Identidade do canal ────────────────────────────────────────────────────────

/**
 * Provedores que este canal sabe operar.
 *
 * `NAO_SUPORTADO` não é um erro de digitação — é a resposta honesta para um valor
 * que ninguém implementou. O que ele evita é a falha mais cara que já aconteceu
 * neste repositório: um `else` tratado como sucesso.
 */
export type ProvedorDeVendas = "META_CLOUD_API" | "NAO_SUPORTADO";

export function resolverProvedorDeVendas(): ProvedorDeVendas {
  const v = (process.env.FOOCCI_SALES_PROVIDER ?? "META_CLOUD_API").trim().toUpperCase();
  return v === "META_CLOUD_API" ? "META_CLOUD_API" : "NAO_SUPORTADO";
}

/** `phone_number_id` do número de vendas (presença, nunca o segredo). */
export function foocciSalesPhoneNumberId(): string | null {
  const v = process.env.FOOCCI_SALES_PHONE_NUMBER_ID;
  return v && v.trim() ? v.trim() : null;
}

function foocciSalesAccessToken(): string | null {
  const v = process.env.FOOCCI_SALES_ACCESS_TOKEN;
  return v && v.trim() ? v.trim() : null;
}

/** O canal existe? (recebe e, se autorizado, envia). */
export function isFoocciSalesChannelConfigured(): boolean {
  return (
    resolverProvedorDeVendas() === "META_CLOUD_API" &&
    foocciSalesPhoneNumberId() !== null &&
    foocciSalesAccessToken() !== null
  );
}

/**
 * A CHAVE DO ENVIO, separada da chave do canal — e a separação é o ponto.
 *
 * Receber é seguro: a mensagem já chegou, e não registrá-la só perde informação.
 * Enviar é o que fala em nome da empresa com um estranho. Por isso "estar
 * configurado" nunca liga o envio sozinho; é preciso dizer sim de novo, aqui.
 */
export function isFoocciSdrSendEnabled(): boolean {
  return (process.env.FOOCCI_SDR_SEND_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** Pronto para ENVIAR = canal configurado **e** envio autorizado. */
export function canalDeVendasPronto(): boolean {
  return isFoocciSalesChannelConfigured() && isFoocciSdrSendEnabled();
}

/**
 * ⛔⛔ A SEGUNDA CHAVE: a máquina pode falar SOZINHA com o cliente?
 *
 * ── POR QUE ELA PRECISOU EXISTIR, EM 07/09/2026 ─────────────────────────────
 *
 * `FOOCCI_SDR_SEND_ENABLED` era uma chave só, e abria DUAS portas de tamanhos
 * muito diferentes:
 *
 *   1. o vendedor digita na tela e a mensagem dele sai — um humano leu, pensou
 *      e escreveu, e outro humano recebe;
 *   2. a IA responde sozinha ao WhatsApp que acabou de chegar, **sem ninguém ler
 *      antes** — `ta/atender.ts` entrega dentro do próprio caminho do webhook.
 *
 * O CEO autorizou a primeira. Quem pediu a autorização (eu) descreveu só a
 * primeira, e a chave entregava as duas. **Autorização obtida com uma descrição
 * menor que o ato não é autorização** — e a correção não é lembrar disso na
 * próxima vez, é fazer a máquina não conseguir.
 *
 * Padrão desligada, e o nome diz o que ela faz.
 */
export function iaRespondeSozinha(): boolean {
  return (process.env.FOOCCI_SDR_IA_RESPONDE_SOZINHA ?? "").trim().toLowerCase() === "true";
}

/**
 * Quem mandou a mensagem que está para sair.
 *
 * Declarado em cada chamada, nunca deduzido. Herdar isso do contexto foi
 * exatamente o defeito: o caminho do webhook e o da tela chamavam a MESMA
 * função com os MESMOS argumentos, e nada no código distinguia um humano
 * escrevendo de uma máquina respondendo.
 */
export type QuemMandou = "pessoa" | "maquina";

/**
 * A trava de quem manda, pura e sem ambiente — para poder ser medida.
 *
 * `pessoa` passa sempre: quem digitou já decidiu. `maquina` só passa com a
 * segunda chave ligada.
 */
export function maquinaPodeFalar(quemMandou: QuemMandou, liberada: boolean): boolean {
  return quemMandou === "pessoa" || liberada;
}

/**
 * Esta mensagem chegou no número de vendas da Foocci?
 *
 * Com o canal desligado devolve sempre `false` — e é assim que o webhook do
 * WhatsApp continua se comportando exatamente como hoje enquanto ninguém
 * configurar nada. Aditivo, risco zero.
 */
export function isFoocciSalesPhoneNumberId(phoneNumberId: string | null | undefined): boolean {
  return isFoocciSalesChannelConfigured() && phoneNumberId === foocciSalesPhoneNumberId();
}

/**
 * ⛔⛔ O DESVIO PARA VENDAS — e a única condição que o impede.
 *
 * ── O DANO, MEDIDO EM 06/09/2026 ───────────────────────────────────────────
 *
 * `FOOCCI_SALES_PHONE_NUMBER_ID` estava com o id de um número que **não é da
 * Foocci**: um número registrado no mesmo aplicativo da Meta, ou seja, de um
 * restaurante. O webhook comparava com a variável e desviava, sem perguntar de
 * quem era o número.
 *
 * Toda mensagem que chegava ali era desviada para a caixa de vendas e **nunca
 * chegava ao restaurante**. Três pessoas escreveram — 27/08, 31/08 e 06/09 — e
 * viraram "lead" com o próprio telefone no campo nome. Ninguém respondeu, e o
 * dono do restaurante não teve como saber que existiam.
 *
 * ── A REGRA, E PARA QUE LADO ELA CAI ───────────────────────────────────────
 *
 * Na dúvida, **o cliente do restaurante ganha**. Prospecção perdida se recupera
 * com outra abordagem; cliente que escreveu para um restaurante e não foi
 * respondido é uma venda perdida do NOSSO cliente, por culpa nossa.
 *
 * ⚠️ **Função pura**, no molde de `LeadContactSafety`: quem busca o dado é o
 * chamador, quem decide é esta função. Assim a regra é provável caso a caso, e
 * nenhum caminho de webhook consegue "esquecer" de consultá-la sem que isso
 * apareça no tipo.
 */
export interface VeredictoDoDesvio {
  /** true → a mensagem é de vendas. false → segue o fluxo de restaurante. */
  desviar: boolean;
  /**
   * Preenchido só quando a configuração se contradiz: o número de vendas é,
   * ao mesmo tempo, o número de um restaurante. É erro de ambiente, e quem
   * recebe este campo tem de GRITAR — sequestrar conversa em silêncio foi
   * exatamente como este defeito viveu semanas sem ninguém notar.
   */
  conflito: string | null;
}

export function decidirDesvioParaVendas(input: {
  phoneNumberId: string | null | undefined;
  /** Este mesmo número resolve para um restaurante cadastrado? */
  ehDeUmRestaurante: boolean;
}): VeredictoDoDesvio {
  if (!isFoocciSalesPhoneNumberId(input.phoneNumberId)) {
    return { desviar: false, conflito: null };
  }

  if (input.ehDeUmRestaurante) {
    return {
      desviar: false,
      conflito:
        `FOOCCI_SALES_PHONE_NUMBER_ID=${input.phoneNumberId} é o número de um RESTAURANTE. ` +
        "O desvio de vendas foi IGNORADO e a mensagem segue para o restaurante. Corrija a " +
        "variável no ambiente — enquanto ela estiver assim, nenhum lead de vendas nasce por aqui.",
    };
  }

  return { desviar: true, conflito: null };
}

/** Estado do canal para tela de diagnóstico — sem segredo, só presença. */
export function describeFoocciSalesChannel(): {
  provedor: ProvedorDeVendas;
  configurado: boolean;
  envioLigado: boolean;
  phoneNumberIdSet: boolean;
  accessTokenSet: boolean;
  phoneNumberIdMasked: string | null;
} {
  const id = foocciSalesPhoneNumberId();
  return {
    provedor: resolverProvedorDeVendas(),
    configurado: isFoocciSalesChannelConfigured(),
    envioLigado: canalDeVendasPronto(),
    phoneNumberIdSet: id !== null,
    accessTokenSet: foocciSalesAccessToken() !== null,
    phoneNumberIdMasked: id ? `…${id.slice(-4)}` : null,
  };
}

// ─── A conferência ──────────────────────────────────────────────────────────────

/**
 * O token alcança o número real?
 *
 * ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 *
 * Em 26/08/2026 o token foi gerado na caixa do **número de teste** do painel da
 * Meta — que é onde o botão fica mais à mão. Um token gerado no portfólio ou na
 * conta errada **autentica normalmente** e só falha na hora de tocar no número
 * de verdade, com um erro de permissão. Sem esta função, a descoberta viria no
 * primeiro cliente real, com a mensagem já perdida.
 *
 * `describeFoocciSalesChannel()` responde "as variáveis estão preenchidas?".
 * Esta responde a pergunta que importa: **"elas funcionam juntas?"**. Presença
 * de credencial nunca foi prova de que ela serve (guardrail 1).
 *
 * ── O QUE ELA NÃO FAZ ───────────────────────────────────────────────────────
 *
 * Não envia mensagem. É um GET no próprio número — lê o cadastro dele e volta.
 * Conferir o canal não pode custar uma mensagem a um estranho.
 *
 * 🔒 O token vai no cabeçalho e não sai em lugar nenhum do retorno.
 */
export type ConferenciaDoCanal =
  | {
      ok: true;
      /** Como a Meta mostra o número — a prova de que é o número certo. */
      numero: string | null;
      nomeVerificado: string | null;
      qualidade: string | null;
    }
  | {
      ok: false;
      causa: "semPhoneNumberId" | "semToken" | "provedorNaoSuportado" | "aMetaRecusou";
      detalhe: string;
    };

export async function conferirCanalDeVendas(): Promise<ConferenciaDoCanal> {
  if (resolverProvedorDeVendas() !== "META_CLOUD_API") {
    return {
      ok: false,
      causa: "provedorNaoSuportado",
      detalhe: `FOOCCI_SALES_PROVIDER=${process.env.FOOCCI_SALES_PROVIDER ?? "(vazio)"}`,
    };
  }

  const phoneNumberId = foocciSalesPhoneNumberId();
  if (!phoneNumberId) {
    return {
      ok: false,
      causa: "semPhoneNumberId",
      detalhe: "FOOCCI_SALES_PHONE_NUMBER_ID não está no ambiente",
    };
  }

  const token = foocciSalesAccessToken();
  if (!token) {
    return {
      ok: false,
      causa: "semToken",
      detalhe: "FOOCCI_SALES_ACCESS_TOKEN não está no ambiente",
    };
  }

  try {
    const res = await fetch(
      metaGraphUrl(`${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`),
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const json: unknown = await res.json().catch(() => ({}));

    if (!res.ok) {
      const err = (json as { error?: { message?: string } }).error ?? {};
      return {
        ok: false,
        causa: "aMetaRecusou",
        detalhe: maskGraphResponse(err.message ?? `HTTP_${res.status}`),
      };
    }

    const d = json as {
      display_phone_number?: string;
      verified_name?: string;
      quality_rating?: string;
    };
    return {
      ok: true,
      numero: d.display_phone_number ?? null,
      nomeVerificado: d.verified_name ?? null,
      qualidade: d.quality_rating ?? null,
    };
  } catch (e) {
    return {
      ok: false,
      causa: "aMetaRecusou",
      detalhe: maskGraphResponse(e instanceof Error ? e.message : String(e)),
    };
  }
}

// ─── Envio ──────────────────────────────────────────────────────────────────────

export interface EnvioDeVendasResult {
  ok: boolean;
  /** Motivo real, mascarado. Nunca um booleano mudo (guardrail 6). */
  error?: string;
}

/**
 * Envia texto pelo número de vendas da Foocci.
 *
 * ⚠️ O PRIMEIRO PARÂMETRO É A DECISÃO DO PORTÃO, e é de propósito. Não existe
 * assinatura desta função que permita enviar sem ter avaliado o lead: quem tenta
 * precisa fabricar uma decisão aprovada, e isso é visível em revisão de código —
 * ao contrário de "esqueci de chamar o portão", que não aparece em lugar nenhum.
 *
 * Ordem das recusas: decisão → autorização de envio → configuração → formato.
 * A decisão vem primeiro porque é a única que fala do DESTINATÁRIO; as outras
 * falam de nós.
 */
export async function enviarTextoDeVendas(
  decisao: LeadSafetyDecision,
  toPhone: string,
  text: string,
): Promise<EnvioDeVendasResult> {
  if (!decisao.sendable) {
    return { ok: false, error: `portão do lead reprovou: ${decisao.reason ?? "sem motivo declarado"}` };
  }

  if (!isFoocciSdrSendEnabled()) {
    // NÃO é erro — é o estado normal de hoje. O SDR redige e não envia enquanto
    // a escada de liberação não tiver evidência suficiente.
    return { ok: false, error: "envio do SDR desligado (FOOCCI_SDR_SEND_ENABLED)" };
  }

  const provedor = resolverProvedorDeVendas();
  if (provedor !== "META_CLOUD_API") {
    // Guardrail 1 na costura: provedor desconhecido não vira "manda pela Meta".
    return { ok: false, error: `provedor de vendas não suportado (FOOCCI_SALES_PROVIDER=${provedor})` };
  }

  const phoneNumberId = foocciSalesPhoneNumberId();
  const token = foocciSalesAccessToken();
  if (!phoneNumberId || !token) {
    return { ok: false, error: "canal de vendas da Foocci não configurado" };
  }

  const recipient = toMetaRecipient(toPhone);
  if (!recipient) return { ok: false, error: "telefone inválido" };

  try {
    const res = await fetch(metaGraphUrl(`${phoneNumberId}/messages`), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildMetaTextPayload(recipient, text)),
    });
    if (!res.ok) {
      const json: unknown = await res.json().catch(() => ({}));
      const err = (json as { error?: { message?: string } }).error ?? {};
      return { ok: false, error: maskGraphResponse(err.message ?? `HTTP_${res.status}`) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: maskGraphResponse(e instanceof Error ? e.message : String(e)) };
  }
}

// ─── Envio por MODELO (abordagem) ───────────────────────────────────────────────

/**
 * O modelo aprovado que vai sair, e os valores das variáveis dele.
 *
 * `parametros` entra na ordem de `{{1}}, {{2}}, …`. A ordem é do modelo, não
 * nossa — trocar dois de lugar manda o nome do restaurante no lugar da cidade,
 * e a Meta aceita numa boa: quem vê o erro é o cliente.
 */
export interface ModeloDeAbordagem {
  nome: string;
  /** Código de idioma como a Meta registrou, ex.: `pt_BR`. */
  idioma: string;
  parametros: string[];
}

/**
 * ⭐ ENVIA UM MODELO APROVADO — a primeira mensagem para quem nunca escreveu.
 *
 * ── POR QUE ELA PRECISOU EXISTIR ────────────────────────────────────────────
 *
 * `enviarTextoDeVendas` monta **texto puro**, e texto puro só vale dentro da
 * janela de 24h depois de a pessoa ter escrito. Para abordagem fria a Meta
 * exige modelo aprovado — e o canal de vendas não sabia mandar um. O montador
 * (`buildMetaTemplatePayload`) já existia e servia ao CRM do restaurante; o que
 * faltava era esta função.
 *
 * ── ⚠️ ELA NÃO SABE, E NÃO DEVE SABER, SOBRE RITMO ─────────────────────────
 *
 * O freio (`salaDeVendas/freioDeRitmo`) fica em quem CHAMA, não aqui. Uma
 * função de envio que também conta quanto já saiu vira dois assuntos num
 * arquivo só, e o teste de um passa a depender do banco do outro.
 *
 * A ordem das recusas é a MESMA de `enviarTextoDeVendas`, e de propósito: a
 * decisão do portão primeiro, porque é a única que fala do DESTINATÁRIO; as
 * outras falam de nós.
 */
export async function enviarModeloDeVendas(
  decisao: LeadSafetyDecision,
  toPhone: string,
  modelo: ModeloDeAbordagem,
): Promise<EnvioDeVendasResult> {
  if (!decisao.sendable) {
    return { ok: false, error: `portão do lead reprovou: ${decisao.reason ?? "sem motivo declarado"}` };
  }

  if (!isFoocciSdrSendEnabled()) {
    return { ok: false, error: "envio do SDR desligado (FOOCCI_SDR_SEND_ENABLED)" };
  }

  const provedor = resolverProvedorDeVendas();
  if (provedor !== "META_CLOUD_API") {
    return { ok: false, error: `provedor de vendas não suportado (FOOCCI_SALES_PROVIDER=${provedor})` };
  }

  const phoneNumberId = foocciSalesPhoneNumberId();
  const token = foocciSalesAccessToken();
  if (!phoneNumberId || !token) {
    return { ok: false, error: "canal de vendas da Foocci não configurado" };
  }

  // ⛔ Modelo sem nome ou sem idioma não vira "manda assim mesmo". A Meta
  // devolveria um erro genérico, e o motivo real — configuração faltando do
  // nosso lado — chegaria à tela disfarçado de recusa da Meta.
  const nome = modelo.nome?.trim();
  const idioma = modelo.idioma?.trim();
  if (!nome) return { ok: false, error: "modelo de abordagem sem nome (FOOCCI_SDR_MODELO_ABORDAGEM)" };
  if (!idioma) return { ok: false, error: "modelo de abordagem sem idioma (FOOCCI_SDR_MODELO_IDIOMA)" };

  // ⚠️ Parâmetro vazio é recusado em vez de virar espaço em branco no meio da
  // frase. "Olá , tudo bem?" é pior que não mandar: parece defeito, e é.
  const vazio = modelo.parametros.findIndex((p) => !p || !p.trim());
  if (vazio >= 0) {
    return { ok: false, error: `variável {{${vazio + 1}}} do modelo veio vazia` };
  }

  const recipient = toMetaRecipient(toPhone);
  if (!recipient) return { ok: false, error: "telefone inválido" };

  try {
    const res = await fetch(metaGraphUrl(`${phoneNumberId}/messages`), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildMetaTemplatePayload(recipient, nome, idioma, modelo.parametros)),
    });
    if (!res.ok) {
      const json: unknown = await res.json().catch(() => ({}));
      const err = (json as { error?: { message?: string } }).error ?? {};
      return { ok: false, error: maskGraphResponse(err.message ?? `HTTP_${res.status}`) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: maskGraphResponse(e instanceof Error ? e.message : String(e)) };
  }
}
