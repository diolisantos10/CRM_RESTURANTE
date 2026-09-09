/**
 * Meta WhatsApp Cloud API webhook — a ÚNICA porta de entrada de WhatsApp do Foocci.
 *
 * GET  — handshake de verificação da Meta (hub.challenge) com o verify token do app.
 * POST — eventos assinados: valida X-Hub-Signature-256, normaliza, deduplica por
 *        wamid (Message.externalMessageId @unique), mapeia phone_number_id →
 *        restaurante, grava a entrada na Central de Conversas e aplica os status de
 *        entrega nas mensagens de saída.
 *
 * ── HISTÓRIA, para ninguém achar que sempre foi assim ────────────────────────
 * Até 04/08/2026 existiam DOIS webhooks e eles **não eram simétricos**: o da
 * Evolution carregava comando do Build OS, pedido por texto, opt-out, resgate de
 * carrinho e atribuição de receita; este aqui gravava a mensagem e chamava o
 * Cérebro. Com a Evolution eliminada por ordem do CEO, o caminho dela foi PORTADO
 * para cá antes de ser apagado — apagar sem paridade seria derrubar recurso em
 * produção. As duas metades ficaram em módulos próprios, testáveis:
 *
 *   • `InboundGuardsService`     — opt-out, atribuição, carrinho, política de IA
 *   • `InboundAgentDispatch`     — Build OS, pedido por texto, agentMode, host
 *
 * Sempre devolve 200 rápido para a Meta não desativar a inscrição.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ConversationStatus } from "@prisma/client";
import { MetaAppCredentialsService } from "@/services/meta/MetaAppCredentialsService";
import { verifyMetaChallenge, validateMetaSignature, normalizeMetaWebhook } from "@/services/whatsapp/providers/metaWebhook";
import { foocciSalesPhoneNumberId } from "@/services/foocci-sdr/FoocciSalesChannel";
import { wabasDaSalaNoEnvelope } from "./wabaDaSala";
import { MetaConfigService } from "@/services/whatsapp/MetaConfigService";
import { WhatsAppBrainRuntimeService, isWhatsAppBrainEnabled } from "@/services/whatsapp/brain/WhatsAppBrainRuntimeService";
import { isSupportPhoneNumberId, handleInboundSupport } from "@/services/support/SupportWhatsAppService";
import { InboundGuardsService } from "@/services/whatsapp/inbound/InboundGuardsService";
import { dispatchInboundAgent, interceptBuildOsCommand } from "@/services/whatsapp/inbound/InboundAgentDispatch";
import { isBuildOsPhoneNumberId } from "@/services/buildos/BuildOsMetaChannel";
import { isFoocciSalesPhoneNumberId, decidirDesvioParaVendas } from "@/services/foocci-sdr/FoocciSalesChannel";
import { receberMensagemDeVendas } from "@/services/foocci-sdr/FoocciSalesInbound";
import { tipoDaMeta, statusDaMeta, aplicarStatus } from "@/services/salaDeVendas/conversa";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const creds = await MetaAppCredentialsService.getResolved();
  const challenge = verifyMetaChallenge(
    { mode: sp.get("hub.mode"), token: sp.get("hub.verify_token"), challenge: sp.get("hub.challenge") },
    creds.webhookVerifyToken,
  );
  if (challenge != null) return new NextResponse(challenge, { status: 200 });
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const raw = await req.text();

  // Signature check — FAIL CLOSED. A missing app secret must reject (not accept
  // unsigned, spoofable payloads that could inject inbound messages into any tenant).
  const secret = (await MetaAppCredentialsService.getResolved()).appSecret;
  if (!secret) {
    console.error("[webhook/meta/whatsapp] app secret not set (admin screen nor META_APP_SECRET) — rejecting unsigned webhook");
    return NextResponse.json({ ok: false, error: "webhook not configured" }, { status: 401 });
  }
  if (!validateMetaSignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    console.warn("[webhook/meta/whatsapp] invalid signature — rejected");
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }, { status: 200 }); }

  try {
    await processMetaWebhook(payload);
  } catch (err) {
    console.error("[webhook/meta/whatsapp] processing error", err);
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}

const ACTIVE_STATUSES: ConversationStatus[] = [
  ConversationStatus.OPEN, ConversationStatus.BOT, ConversationStatus.HUMAN,
  ConversationStatus.AI_ATENDENDO, ConversationStatus.HUMANO_ASSUMIU,
];

async function processMetaWebhook(payload: unknown): Promise<void> {
  const norm = normalizeMetaWebhook(payload);

  // ── O ID DA CONTA (WABA) DA SALA DE VENDAS — que sempre chegou e sempre foi jogado fora ──
  //
  // ⚠️ MEDIDO EM 08/09/2026, e é a razão de esta peça existir. A Sala não conseguia
  // listar os modelos aprovados da Meta porque não sabia a QUAL CONTA perguntar, e os
  // três caminhos da Graph foram medidos e falham com o token de produção (#227, #228).
  // A conclusão escrita naquele dia foi *"não há fonte interna"* — e ela estava certa
  // sobre o BANCO e errada sobre o CANAL.
  //
  // `entry[].id` É o id da conta, e ele vem em TODA notificação da Meta. O tipo logo
  // abaixo, na leitura de coexistência, declarava só `changes` — então o campo nunca
  // foi lido por ninguém. Não é dado que falta: é dado que a gente descarta.
  //
  // Doutrina 33 aplicada à nossa própria casa: incapacidade declarada em documento
  // tem de ser medida como código. "Não há fonte interna" era afirmação de manual, e
  // custou uma noite inteira de caça a um número que passa por aqui todo dia.
  //
  // 🔒 SÓ LOG, DE PROPÓSITO. Gravar em tabela exigiria migração, e migração em
  // produção às cinco da manhã, sem o Diretor do produto, é risco maior que o
  // problema (guardrail 5). O id não é segredo — é o endereço público da conta —
  // então o log é lugar honesto para ele. Quem lê o log escreve `FOOCCI_SALES_WABA_ID`
  // no ambiente, e a Sala passa a ler os modelos sozinha.
  //
  // ⚠️ E POR ISSO ESTA PEÇA É PROVISÓRIA POR ESCRITO: o conserto definitivo é
  // persistir e alimentar `contaDoNumeroDeVendas` direto, sem humano no meio. Enquanto
  // isso não existir, isto aqui é o que transforma um pedido de DADO ("copie o id da
  // tela") num pedido de GESTO ("mande um oi para o número") — e gesto não se digita
  // errado.
  for (const waba of wabasDaSalaNoEnvelope(payload, foocciSalesPhoneNumberId())) {
    console.info(
      `[webhook/meta/whatsapp] ⭐ WABA DA SALA DE VENDAS: ${waba} — escreva este valor em ` +
      `FOOCCI_SALES_WABA_ID e a conferência de modelos para de depender de humano nenhum`,
    );
  }

  // ── Coexistência: eco da mensagem que o ATENDENTE mandou do celular ─────────
  //
  // ⚠️ ÚNICO ITEM SEM PARIDADE APÓS A SAÍDA DA EVOLUTION (04/08/2026).
  //
  // O webhook da Evolution tratava `fromMe`: quando alguém da equipe respondia
  // pelo WhatsApp Web/celular, a mensagem entrava na Central como HUMAN_EXTERNAL
  // **e** carimbava `handoffAlarmAckAt` — foi assim que se resolveu o crônico
  // "apita e não para", em que conversa já respondida pelo celular seguia tocando
  // por horas.
  //
  // Na Meta o equivalente é `smb_message_echoes`, que só chega em número onboardado
  // por Business App Onboarding. O formato real do payload **nunca foi validado
  // contra um evento ao vivo** — e escrever no banco a partir de um formato
  // adivinhado é pior que não escrever: cria mensagem fantasma na conversa do
  // cliente e silencia alarme que deveria tocar (guardrail 5).
  //
  // Então: registramos o evento COM A EVIDÊNCIA necessária para implementar
  // (guardrail 6), e NÃO ingerimos. O que isso custa, dito sem maquiagem:
  //   • resposta dada pelo celular não aparece na Central de Conversas;
  //   • o alarme de handoff não é silenciado automaticamente por ela.
  // Não custa mensagem de cliente: entrada normal continua vindo em `messages`.
  try {
    const body = payload as { entry?: Array<{ changes?: Array<{ field?: string; value?: unknown }> }> };
    const coex = (body?.entry ?? [])
      .flatMap((e) => e.changes ?? [])
      .filter((c) => c.field === "history" || c.field === "smb_app_state_sync" || c.field === "smb_message_echoes");
    for (const c of coex) {
      // Só as CHAVES do payload — nunca conteúdo de mensagem, nunca telefone.
      const shape = c.value && typeof c.value === "object" ? Object.keys(c.value as object) : [];
      console.info(
        `[webhook/meta/whatsapp] evento de coexistência NÃO ingerido: field=${c.field} chaves=[${shape.join(",")}] ` +
        `— eco de resposta pelo celular ainda não entra na Central nem silencia o alarme de handoff`,
      );
    }
  } catch { /* best-effort — never block the webhook */ }

  // Delivery statuses → update the matching OUTBOUND message.
  for (const s of norm.statuses) {
    const failed = s.status === "failed";
    await prisma.message.updateMany({
      where: { externalMessageId: s.providerMessageId },
      data: {
        externalStatus: s.status,
        providerStatus: s.status,
        ...(failed && s.errorCode ? { providerError: `META_${s.errorCode}` } : {}),
        ...(s.status === "delivered" ? { deliveredAt: s.timestamp ?? new Date() } : {}),
        ...(s.status === "read"      ? { readAt: s.timestamp ?? new Date() }      : {}),
        ...(failed && s.errorCode ? { errorMessage: `META_${s.errorCode}` } : {}),
      },
    });

    // ── E a MESMA confirmação para a Sala de Vendas ─────────────────────────
    //
    // O `updateMany` acima só alcança `Message`, que é a conversa do restaurante
    // com o cliente dele. A mensagem que a Sala manda para um prospecto vive em
    // `LeadMensagem`, e sem esta segunda passagem ela ficaria eternamente
    // "enviada": o vendedor nunca veria o ✓✓, e não teria como saber que a
    // entrega falhou.
    //
    // As duas tabelas são disjuntas por construção (um `wamid` pertence a uma ou
    // a outra), então não há risco de escrita cruzada — e `aplicarStatus` só
    // avança na escada, nunca retrocede.
    const statusDaSala = statusDaMeta(s.status);
    if (statusDaSala) {
      await aplicarStatus(prisma, {
        waMessageId: s.providerMessageId,
        status: statusDaSala,
        erro: failed && s.errorCode ? `META_${s.errorCode}` : null,
      }).catch((err) =>
        console.error("[webhook/meta/whatsapp] status da Sala de Vendas falhou", err),
      );
    }
  }

  // Inbound customer messages → Central de Conversas.
  for (const m of norm.messages) {
    if (!m.phoneNumberId) continue;

    // Número DEDICADO do Agente de TI: desvia ANTES do fluxo de restaurante — a
    // equipe fala com o suporte técnico, não com o garçom. Gated: se o número de
    // suporte não estiver configurado, isSupportPhoneNumberId é sempre false e o
    // fluxo abaixo segue idêntico (aditivo, zero risco). Shadow-safe: só diagnostica.
    if (isSupportPhoneNumberId(m.phoneNumberId)) {
      void handleInboundSupport({ fromPhone: m.fromPhone, text: m.text ?? null, isText: m.type === "text" })
        .catch((err) => console.error("[webhook/meta/whatsapp] support dispatch failed", err));
      continue;
    }

    // Canal MASTER do Build OS: número dedicado da equipe, sem restaurante.
    // Desvia ANTES do fluxo de cliente — aqui não se cria Customer, Conversation
    // nem Message, e nada disso chega no garçom. Gated: com o canal desligado,
    // `isBuildOsPhoneNumberId` é sempre false e o fluxo abaixo segue idêntico.
    if (isBuildOsPhoneNumberId(m.phoneNumberId)) {
      const isCmdText = m.type === "text" && Boolean((m.text ?? "").trim());
      if (isCmdText) {
        void interceptBuildOsCommand({
          restaurantId: null,
          phone:        m.fromPhone,
          senderName:   m.profileName ?? undefined,
          content:      m.text ?? "",
          channelId:    m.phoneNumberId,
        }).catch((err) => console.error("[webhook/meta/whatsapp] Build OS dispatch failed", err));
      }
      // Isolamento do Master: o que não era comando é simplesmente ignorado,
      // NUNCA persistido como mensagem de cliente.
      continue;
    }

    // Número de VENDAS da Foocci: quem escreve aqui é um dono de restaurante
    // interessado no produto, não cliente de restaurante nenhum. Desvia ANTES do
    // fluxo de restaurante — e por isso NÃO cria Customer, Conversation nem
    // Message: prospecto não entra na Central de Conversas de lojista algum.
    //
    // POR QUE ESTE DESVIO PRECISA EXISTIR: sem ele, esta mensagem cairia no
    // `if (!cfg)` logo abaixo — um `console.warn` e o descarte. O site já manda a
    // pessoa escrever esse "oi" (`src/components/marketing/config.ts`); faltava
    // alguém do outro lado.
    //
    // Gated: com `FOOCCI_SALES_PHONE_NUMBER_ID`/`FOOCCI_SALES_ACCESS_TOKEN`
    // ausentes, `isFoocciSalesPhoneNumberId` é sempre false e este webhook se
    // comporta exatamente como antes. Aditivo, risco zero.
    //
    // ── ⚠️ O QUE ACONTECE DEPOIS DAQUI MUDOU EM 26/08/2026 ─────────────────
    //
    // Este comentário dizia "NENHUMA RESPOSTA SAI DAQUI", e deixou de ser
    // verdade: a recepção agora chama o TA, que redige e grava a resposta.
    //
    // A frase certa é outra, e ela continua valendo: **nada é ENTREGUE sem a
    // chave do dono**. A resposta nasce PENDENTE, e só vira mensagem no
    // telefone de alguém com `FOOCCI_SDR_SEND_ENABLED` ligada.
    //
    // `void` de propósito: a Meta exige resposta rápida do webhook e reentrega
    // o que demora. Compor com modelo leva segundos — segurar o 200 esperando
    // por isso faria a Meta reenviar a mesma mensagem, e o cliente receberia a
    // resposta duas vezes. A recepção não lança, então nada fica sem dono.
    // ══════════════════════════════════════════════════════════════════════
    // ⛔⛔ UM NÚMERO NÃO PODE SER DE VENDAS **E** DE RESTAURANTE.
    //
    // ── O DANO, MEDIDO EM 06/09/2026 ─────────────────────────────────────
    //
    // `FOOCCI_SALES_PHONE_NUMBER_ID` estava com o id de um número que **não é
    // da Foocci** — apontava para um número registrado no mesmo aplicativo da
    // Meta, ou seja, de um restaurante. E o desvio abaixo é cego: ele compara
    // com a variável e segue, sem perguntar de quem é o número.
    //
    // Resultado: TODA mensagem que chegava naquele número era desviada para a
    // caixa de vendas e **nunca chegava ao restaurante**. Três pessoas
    // escreveram — 27/08, 31/08 e 06/09 — e viraram "lead" com o próprio
    // telefone no campo nome. Ninguém respondeu nenhuma, e o dono do
    // restaurante não teve como saber que existiam.
    //
    // ── A REGRA, E POR QUE ELA CAI PARA ESTE LADO ────────────────────────
    //
    // Na dúvida, **o cliente do restaurante ganha**. Prospecção perdida se
    // recupera com outra abordagem; cliente que escreveu para um restaurante e
    // não foi respondido é uma venda perdida do NOSSO cliente, por culpa nossa.
    //
    // E a recusa GRITA: `console.error` com o id e a instrução. Uma variável
    // errada que sequestra conversa em silêncio é a pior forma deste defeito —
    // foi assim que ele viveu semanas sem ninguém notar.
    // ══════════════════════════════════════════════════════════════════════
    // ⚠️ Quem BUSCA o dado é este arquivo; quem DECIDE é `decidirDesvioParaVendas`,
    // que é pura e testada caso a caso. A consulta só acontece quando o número
    // bate com o de vendas — o webhook de restaurante não paga por esta trava.
    const veredito = decidirDesvioParaVendas({
      phoneNumberId: m.phoneNumberId,
      ehDeUmRestaurante: isFoocciSalesPhoneNumberId(m.phoneNumberId)
        ? (await MetaConfigService.getByPhoneNumberId(m.phoneNumberId)) !== null
        : false,
    });

    if (veredito.conflito) {
      console.error(`[webhook/meta/whatsapp] ⛔ ${veredito.conflito}`);
    }

    if (veredito.desviar) {
      // Desde 25/08/2026 a mensagem é GRAVADA, e não só anotada: a Sala de
      // Vendas precisa abrir a conversa, e antes disto a linha do tempo dizia
      // "escreveu no WhatsApp" sem guardar o que a pessoa escreveu.
      //
      // `providerMessageId` é o que impede a reentrega da Meta de duplicar a
      // conversa — a trava é a unicidade da coluna, no banco.
      const { tipo, tipoCru } = tipoDaMeta(m.type, m.media?.kind);

      void receberMensagemDeVendas({
        fromPhone:     m.fromPhone,
        text:          m.text ?? null,
        profileName:   m.profileName ?? null,
        waMessageId:   m.providerMessageId,
        tipo,
        tipoCru,
        legenda:       m.media?.caption ?? null,
        midiaId:       m.media?.id ?? null,
        midiaMimeType: m.media?.mimeType ?? null,
        midiaNome:     m.media?.filename ?? null,
        // O carimbo do PROVEDOR, não a hora da gravação: numa reentrega os dois
        // diferem em minutos, e ordenar pela gravação embaralharia a conversa.
        agora:         m.timestamp,
      })
        .then((r) => console.info(`[webhook/meta/whatsapp] vendas: ${r.status} — ${r.detalhe}`))
        .catch((err) => console.error("[webhook/meta/whatsapp] recepção de vendas falhou", err));
      continue;
    }

    const cfg = await MetaConfigService.getByPhoneNumberId(m.phoneNumberId);
    if (!cfg) { console.warn(`[webhook/meta/whatsapp] unknown phone_number_id=${m.phoneNumberId} — no restaurant matched`); continue; }

    // Supressão dura de comando interno num número de RESTAURANTE. Um `/build`
    // aqui nunca é executado (o portão de canal do Build OS reprova), mas também
    // nunca pode chegar ao cliente nem à IA — por isso é interceptado ANTES de
    // virar Customer/Conversation/Message.
    if (m.type === "text" && (m.text ?? "").trim()) {
      const buildOs = await interceptBuildOsCommand({
        restaurantId: cfg.restaurantId,
        phone:        m.fromPhone,
        senderName:   m.profileName ?? undefined,
        content:      m.text ?? "",
        channelId:    m.phoneNumberId,
      });
      if (buildOs.intercepted) {
        console.info(`[webhook/meta/whatsapp] mensagem interceptada pelo Build OS (${buildOs.reason})`);
        continue;
      }
    }

    // Dedupe by wamid — never write the same message twice.
    const existing = await prisma.message.findUnique({
      where:  { externalMessageId: m.providerMessageId },
      select: { id: true },
    });
    if (existing) continue;

    const conv = await findOrCreateConversation(cfg.restaurantId, m.fromPhone, m.profileName);
    // Media (image/audio/video/document/sticker): store the Meta media id so the
    // authenticated attachment proxy can download the bytes on demand. whatsappMedia
    // flags the viewer; metaMediaId routes it to the Meta (not Evolution) download path.
    const mediaType: "TEXT" | "IMAGE" | "AUDIO" | "DOCUMENT" =
      m.media?.kind === "image" || m.media?.kind === "sticker" ? "IMAGE" :
      m.media?.kind === "audio" ? "AUDIO" :
      m.media ? "DOCUMENT" : "TEXT"; // video/document → DOCUMENT (viewer uses real mime)
    await prisma.message.create({
      data: {
        conversationId:    conv.id,
        direction:         "INBOUND",
        senderType:        "CUSTOMER",
        content:           m.text ?? "",
        type:              mediaType,
        sentAt:            m.timestamp,
        externalMessageId: m.providerMessageId,
        externalStatus:    "received",
        provider:          "META_CLOUD_API",
        providerMessageId: m.providerMessageId,
        providerStatus:    "received",
        metadata:          {
          provider:      "META_CLOUD_API",
          phoneNumberId: m.phoneNumberId,
          messageType:   m.type,
          ...(m.media ? {
            whatsappMedia: true,
            metaMediaId:   m.media.id,
            mimetype:      m.media.mimeType,
            fileName:      m.media.filename,
          } : {}),
        },
      },
    });
    await prisma.conversation.update({
      where: { id: conv.id },
      data:  { lastMessageAt: m.timestamp, unreadCount: { increment: 1 } },
    });

    // ── Guardas de entrada ──────────────────────────────────────────────────
    // Até 02/08 este bloco chamava o Cérebro direto, com um comentário dizendo
    // que alimentava "o mesmo pipeline da Evolution". Não alimentava: opt-out,
    // atribuição de CRM, resgate de carrinho e a política central de IA (que
    // carrega a trava de Staff/Fornecedor, P0-A) ficavam TODOS de fora.
    //
    // Na prática isso significava que um cliente da Meta podia responder "PARAR"
    // e continuar recebendo, e que a IA respondia em conversa marcada como
    // não-cliente. Agora as guardas rodam antes de qualquer agente.
    const isText = m.type === "text" && Boolean((m.text ?? "").trim());
    const guards = await InboundGuardsService.apply({
      conversationId: conv.id,
      restaurantId:   cfg.restaurantId,
      customerId:     conv.customerId,
      messageText:    m.text ?? null,
      isTextMessage:  isText,
    });

    if (!guards.aiMayRespond) {
      // Log com o motivo concreto — guardrail 6, o alerta carrega a própria
      // evidência. "A IA não respondeu" sem o porquê é o suporte mais caro que
      // existe.
      console.info(
        `[webhook/meta/whatsapp] IA não responde nesta conversa (${guards.reason}) conv=${conv.id}`,
      );
      continue;
    }

    // ── Quem responde ───────────────────────────────────────────────────────
    // Portado do webhook da Evolution em 04/08: pedido por texto (piloto
    // controlado), `agentMode` e o host. Antes daqui saía uma chamada seca ao
    // Cérebro — o que fazia o pedido por texto NUNCA rotear pela Meta.
    const dispatch = await dispatchInboundAgent({
      restaurantId:   cfg.restaurantId,
      conversationId: conv.id,
      customerId:     conv.customerId,
      phone:          m.fromPhone,
      messageText:    m.text ?? null,
      isTextMessage:  isText,
      channelId:      m.phoneNumberId,
    });
    console.info(`[webhook/meta/whatsapp] agente=${dispatch.handler} (${dispatch.reason}) conv=${conv.id}`);
  }
}

/**
 * Garante um Customer para o número que acabou de escrever.
 *
 * Existe como função própria porque é usado em DOIS pontos: ao criar a conversa
 * e ao curar conversa antiga que ficou sem cliente vinculado. Estava só no
 * primeiro, e por isso o opt-out não pegava quem já tinha conversa aberta.
 */
async function upsertCustomerForInbound(
  restaurantId: string,
  fromPhone: string,
  tail: string,
  profileName?: string | null,
): Promise<{ id: string; name: string | null; phone: string | null } | null> {
  return prisma.customer.upsert({
    where:  { phone_restaurantId: { phone: fromPhone, restaurantId } },
    create: { restaurantId, phone: fromPhone, name: profileName ?? fromPhone },
    update: profileName ? { name: profileName } : {},
    select: { id: true, name: true, phone: true },
  }).catch(async (err) => {
    // Número com formato divergente (ex.: 9º dígito) pode não bater no unique.
    // Cai para a busca por sufixo em vez de perder a mensagem.
    console.warn(`[webhook/meta/whatsapp] upsert de Customer falhou — buscando por sufixo`, err);
    return prisma.customer.findFirst({
      where:  { restaurantId, phone: { contains: tail } },
      select: { id: true, name: true, phone: true },
    });
  });
}

async function findOrCreateConversation(
  restaurantId: string,
  fromPhone:    string,
  profileName:  string | null,
): Promise<{ id: string; customerId: string | null }> {
  const tail = fromPhone.slice(-8);
  const existing = await prisma.conversation.findFirst({
    where: {
      restaurantId,
      channel: "WHATSAPP",
      status:  { in: ACTIVE_STATUSES },
      OR: [
        { customerPhone: { contains: tail } },
        { customer: { phone: { contains: tail } } },
      ],
    },
    orderBy: { lastMessageAt: "desc" },
    select:  { id: true, customerPhone: true, customerId: true },
  });
  if (existing) {
    // Self-heal the channel phone: Meta's wa_id (fromPhone) is the authoritative,
    // deliverable recipient for /messages. Conversations created earlier (or matched
    // via a malformed CRM Customer.phone) can carry a number the Cloud API rejects
    // (seen live: 12-digit local without the 55 country code → INVALID_PHONE, bot
    // silently mute). Overwrite whenever it differs so replies always target the
    // exact number that just messaged us.
    if (existing.customerPhone !== fromPhone) {
      await prisma.conversation.update({
        where: { id: existing.id },
        data:  { customerPhone: fromPhone },
      }).catch(() => { /* best-effort — reply still uses stored phone if this fails */ });
    }

    // Conversa antiga SEM cliente vinculado é um furo de LGPD, não um detalhe:
    // a guarda de opt-out precisa de um `customerId` para marcar quem pediu
    // silêncio. Enquanto ele for null, "PARAR" não grava nada, não loga nada, e
    // a IA responde normalmente — para sempre, porque a conversa é reusada.
    // Conversas criadas antes de o upsert existir aqui carregam esse null, então
    // cura-se no primeiro contato seguinte em vez de esperar uma migração.
    if (!existing.customerId) {
      const curado = await upsertCustomerForInbound(restaurantId, fromPhone, tail, profileName);
      if (curado?.id) {
        await prisma.conversation.update({
          where: { id: existing.id },
          data:  { customerId: curado.id },
        }).catch((err) => console.error("[webhook/meta/whatsapp] não consegui vincular cliente à conversa", err));
        return { ...existing, customerId: curado.id };
      }
      // Não deu para criar/achar o cliente: registra alto, porque este turno
      // passa sem poder aplicar opt-out.
      console.error("[webhook/meta/whatsapp] conversa sem customerId e upsert falhou — opt-out NÃO aplicável neste turno", { conversationId: existing.id, restaurantId });
    }
    return existing;
  }

  // Cliente de CRM. O caminho da Evolution fazia UPSERT aqui — este webhook só
  // fazia `findFirst`, e por isso um número novo entrava SEM Customer. Não é
  // detalhe: sem `customerId` o opt-out ("PARAR") é pulado, porque a guarda de
  // saída precisa de um contato para marcar. Quem sofria era justamente quem
  // ainda não tinha comprado.
  //
  // O `name` só é atualizado quando a Meta manda um `profileName` — nunca se
  // sobrescreve um nome real com um número de telefone.
  const customer = await upsertCustomerForInbound(restaurantId, fromPhone, tail, profileName);

  return prisma.conversation.create({
    data: {
      restaurantId,
      channel:       "WHATSAPP",
      status:        "OPEN",
      customerId:    customer?.id ?? null,
      // Channel phone = Meta's wa_id, NOT Customer.phone: the CRM value can be in a
      // format the Cloud API rejects; wa_id is exactly what /messages accepts back.
      customerPhone: fromPhone,
      customerName:  customer?.name ?? profileName ?? fromPhone,
      contextType:   "INBOUND",
    },
    select: { id: true, customerId: true },
  });
}
