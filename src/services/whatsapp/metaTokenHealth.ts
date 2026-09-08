/**
 * metaTokenHealth — pergunta À META, todo dia, se a credencial de cada restaurante
 * ainda está viva.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * O Instagram caiu em 23/07/2026 e ficou treze dias mudo porque um token expirou sem
 * avisar ninguém. Depois daquilo o Instagram ganhou varredura diária. **O WhatsApp
 * nunca ganhou** — e o WhatsApp é o canal que atende o restaurante agora. O único
 * sinal que existia era um aviso de tela a ≤30 dias (`MetaConfigService.getPublic`
 * → `tokenExpiringSoon`), alimentado por um `tokenExpiresAt` gravado **uma única
 * vez, no onboarding**, e que ninguém garante estar atualizado. Registrado como
 * achado 5 do raio-x de 05/08 em `docs/agents/meta/oficina.md`.
 *
 * O QUE ESTA VARREDURA **NÃO** FAZ, DE PROPÓSITO
 * ---------------------------------------------
 * Ela **não desconecta, não desabilita e não apaga nada**. Guardrail 5: a proteção
 * não pode ser mais destrutiva que o problema. Um erro de rede na consulta não pode
 * derrubar o canal de um restaurante que está atendendo. As únicas escritas são
 * `tokenExpiresAt` (que só melhora o aviso que já existe) e `lastHealthCheckAt`.
 *
 * "NÃO CONSEGUI PERGUNTAR" É PROBLEMA, NÃO SILÊNCIO
 * -------------------------------------------------
 * Guardrail 1: ausência de informação não é informação. Se faltar credencial de app,
 * ou a Meta não responder, `isValid` fica **null** — nunca `true` — e isso vira
 * atenção. O buraco descrito na oficina de 06/08 era exatamente este: num dia
 * saudável o sistema nunca dizia "estou cego", e a cegueira só aparecia de carona
 * num incidente que já estava acontecendo.
 */

import { prisma } from "@/lib/prisma";
import { MetaConfigService } from "./MetaConfigService";
import { metaGraphUrl } from "./metaFlag";
import { MetaAppCredentialsService } from "@/services/meta/MetaAppCredentialsService";
import { maskGraphResponse } from "./providers/metaPayload";
import {
  comOTokenDeVendas,
  foocciSalesPhoneNumberId,
  isFoocciSdrSendEnabled,
} from "@/services/foocci-sdr/FoocciSalesChannel";

/** A partir de quantos dias para o vencimento a credencial vira pergunta para humano. */
export const TOKEN_WARN_DAYS = 30;

/**
 * Permissão sem a qual o número não manda nem recebe mensagem. Se o token não a
 * carrega, o canal está morto mesmo com o token "válido".
 */
export const REQUIRED_SCOPE = "whatsapp_business_messaging";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MetaTokenHealthOne {
  restaurantId:       string;
  displayPhoneNumber: string | null;
  /** true quando a Meta respondeu. false = não deu para perguntar (não é "está ruim"). */
  answered:           boolean;
  /** null = não sabemos. NUNCA true por omissão. */
  isValid:            boolean | null;
  expiresAt:          string | null;
  expiresInDays:      number | null;
  /** Token de usuário de sistema costuma não expirar — `expires_at: 0` na Meta. */
  neverExpires:       boolean;
  /** O token foi emitido pelo NOSSO aplicativo? null quando não deu para perguntar. */
  appIdMatches:       boolean | null;
  tokenAppId:         string | null;
  scopes:             string[];
  hasRequiredScope:   boolean | null;
  error:              string | null;
}

export interface MetaTokenHealthSweep {
  totalConfigs:   number;
  answered:       number;
  results:        MetaTokenHealthOne[];
  /** true quando esta rodada merece um humano. */
  needsAttention: boolean;
  /** Por quê — o alerta carrega a própria evidência (guardrail 6). */
  attention:      string[];
  /**
   * ⭐ A credencial da SALA DE VENDAS — o número da Foocci, não o de um cliente.
   *
   * Campo separado de propósito: ela não é um restaurante e não tem linha em
   * `metaWhatsAppConfig`. Enfiá-la em `results` faria `totalConfigs` mentir e
   * daria a ela um `restaurantId` que não existe.
   */
  salaDeVendas:   MetaTokenHealthOne;
}

/**
 * O "dono" da credencial da Sala, no lugar onde os outros trazem `restaurantId`.
 *
 * Não é um id de restaurante e nunca deve virar um: os parênteses existem para
 * que ninguém a use como chave de banco por engano.
 */
export const DONO_DA_SALA_DE_VENDAS = "(sala-de-vendas)";

/**
 * ⭐⭐ A CREDENCIAL QUE NINGUÉM VIGIAVA — e é a que carrega a prospecção inteira.
 *
 * ── COMO ISTO FOI DESCOBERTO, em 08/09/2026 ─────────────────────────────────
 *
 * A primeira rodada de prospecção real disparou e voltou **zero abordados**. O
 * pré-voo do modelo respondeu, com as palavras da Meta:
 *
 *   *"Error validating access token: Session has expired on Tuesday,
 *   25-Aug-26 21:00:00 PDT."*
 *
 * **O token da Sala estava vencido havia catorze dias.** Nenhuma mensagem sairia
 * naquele dia — nem dez, nem duzentos e cinquenta, com ou sem modelo aprovado.
 *
 * ── ⚠️ E A VARREDURA DIÁRIA ESTAVA VERDE O TEMPO TODO ───────────────────────
 *
 * Ela varre `metaWhatsAppConfig`, que é a tabela dos **restaurantes**. O número
 * da Foocci não mora em tabela nenhuma: mora em `FOOCCI_SALES_ACCESS_TOKEN`, no
 * ambiente. Então a varredura perguntava à Meta sobre todos os tokens **menos o
 * único que a operação comercial depende** — e passava, todo dia, sem mentir e
 * sem ajudar.
 *
 * Este arquivo nasceu porque *"o Instagram ficou treze dias mudo em julho porque
 * um token expirou sem avisar ninguém"*. Catorze dias depois, a mesma coisa
 * aconteceu no número de vendas, com a varredura ligada. **Vigia que olha para
 * o lado errado é indistinguível de vigia que não existe.**
 */
export async function conferirCredencialDaSala(
  warnDays = TOKEN_WARN_DAYS,
): Promise<{ one: MetaTokenHealthOne; attention: string[] }> {
  const numero = foocciSalesPhoneNumberId();
  const enviando = isFoocciSdrSendEnabled();
  const attention: string[] = [];

  const vazio: MetaTokenHealthOne = {
    restaurantId: DONO_DA_SALA_DE_VENDAS,
    displayPhoneNumber: numero,
    answered: false, isValid: null, expiresAt: null, expiresInDays: null,
    neverExpires: false, appIdMatches: null, tokenAppId: null,
    scopes: [], hasRequiredScope: null, error: null,
  };

  const health = await comOTokenDeVendas(
    (token) => inspectMetaToken(token),
    () => ({
      answered: false as const, isValid: null, expiresAt: null, expiresInDays: null,
      neverExpires: false, appIdMatches: null, tokenAppId: null,
      scopes: [] as string[], hasRequiredScope: null,
      error: "FOOCCI_SALES_ACCESS_TOKEN não está no ambiente",
    }),
  );

  const one: MetaTokenHealthOne = { ...vazio, ...health };
  const quem = `Número de vendas da Foocci${numero ? ` (phone_number_id ${numero})` : ""}`;

  // ⚠️ Sem token, a Sala não fala com ninguém. Só vira alerta quando o envio
  // está LIGADO — desligada, "sem credencial" é um estado, não um defeito.
  if (!one.answered) {
    if (enviando || numero) {
      attention.push(
        `${quem}: NÃO consegui perguntar à Meta se a credencial está viva — ${one.error ?? "motivo não informado"}.`
        + ` Enquanto isso valer, a prospecção manda zero e o log diz "fila acabou".`,
      );
    }
    return { one, attention };
  }

  if (one.isValid === false) {
    attention.push(
      `${quem}: a credencial está MORTA segundo a Meta${one.error ? ` — ${one.error}` : ""}.`
      + ` A prospecção NÃO envia nada, e a rodada termina verde com zero abordados.`,
    );
  } else if (!one.neverExpires && one.expiresInDays !== null && one.expiresInDays <= warnDays) {
    attention.push(
      `${quem}: a credencial vence em ${one.expiresInDays} dia(s) (${one.expiresAt}).`
      + ` Não existe renovação automática — passando disso, a operação comercial para sem aviso.`,
    );
  }

  if (one.hasRequiredScope === false) {
    attention.push(
      `${quem}: a credencial não carrega a permissão \`${REQUIRED_SCOPE}\`.`
      + ` Permissões vistas: ${one.scopes.join(", ") || "(nenhuma)"}. Sem ela o número não aborda ninguém.`,
    );
  }

  return { one, attention };
}

/**
 * Lê o `debug_token` da Meta para UM token, usando a chave do aplicativo.
 * Best-effort: qualquer falha vira `answered: false`, nunca uma conclusão.
 */
export async function inspectMetaToken(
  accessToken: string,
): Promise<Omit<MetaTokenHealthOne, "restaurantId" | "displayPhoneNumber">> {
  const vazio = {
    answered: false, isValid: null, expiresAt: null, expiresInDays: null,
    neverExpires: false, appIdMatches: null, tokenAppId: null,
    scopes: [] as string[], hasRequiredScope: null,
  };

  const { appId, appSecret } = await MetaAppCredentialsService.getResolved();
  if (!appId || !appSecret) {
    return { ...vazio, error: "sem credencial de aplicativo (META_APP_ID/META_APP_SECRET) — não deu para perguntar à Meta" };
  }

  try {
    const appToken = `${appId}|${appSecret}`;
    const res = await fetch(
      metaGraphUrl(`debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appToken)}`),
    );
    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (json as { error?: { message?: string } }).error?.message;
      return { ...vazio, error: maskGraphResponse(msg ?? `HTTP ${res.status} ao consultar debug_token`) };
    }

    const data = (json as {
      data?: { app_id?: string; is_valid?: boolean; expires_at?: number; scopes?: string[]; error?: { message?: string } };
    }).data;
    if (!data) return { ...vazio, error: "resposta da Meta sem o campo `data`" };

    const expiresAtSec = typeof data.expires_at === "number" ? data.expires_at : null;
    const neverExpires = expiresAtSec === 0;
    const expiresAt    = expiresAtSec && expiresAtSec > 0 ? new Date(expiresAtSec * 1000) : null;
    const scopes       = Array.isArray(data.scopes) ? data.scopes.filter((s): s is string => typeof s === "string") : [];

    return {
      answered:      true,
      isValid:       data.is_valid === true,
      expiresAt:     expiresAt?.toISOString() ?? null,
      expiresInDays: expiresAt ? Math.floor((expiresAt.getTime() - Date.now()) / DAY_MS) : null,
      neverExpires,
      // O `app_id` é a única prova de que "existe UM só aplicativo" não é só combinado.
      appIdMatches:  typeof data.app_id === "string" ? data.app_id === appId : null,
      tokenAppId:    typeof data.app_id === "string" ? data.app_id : null,
      scopes,
      // Sem lista de escopos a Meta não está dizendo "faltou" — está calada (guardrail 1).
      hasRequiredScope: scopes.length > 0 ? scopes.includes(REQUIRED_SCOPE) : null,
      error:         data.error?.message ? maskGraphResponse(data.error.message) : null,
    };
  } catch (e) {
    return { ...vazio, error: maskGraphResponse(e instanceof Error ? e.message : String(e)) };
  }
}

/**
 * Varre TODAS as configs de WhatsApp da Meta e devolve o estado de cada credencial.
 * Nunca lança. Nunca desconecta nada.
 */
export async function sweepMetaTokenHealth(warnDays = TOKEN_WARN_DAYS): Promise<MetaTokenHealthSweep> {
  const rows = await prisma.metaWhatsAppConfig
    .findMany({ select: { restaurantId: true } })
    .catch(() => [] as Array<{ restaurantId: string }>);

  const results: MetaTokenHealthOne[] = [];
  const attention: string[] = [];

  for (const row of rows) {
    const cfg = await MetaConfigService.getResolved(row.restaurantId).catch(() => null);
    if (!cfg) {
      results.push({
        restaurantId: row.restaurantId, displayPhoneNumber: null, answered: false, isValid: null,
        expiresAt: null, expiresInDays: null, neverExpires: false, appIdMatches: null,
        tokenAppId: null, scopes: [], hasRequiredScope: null,
        error: "config existe mas não abriu (token não descriptografou?)",
      });
      attention.push(
        `WhatsApp do restaurante ${row.restaurantId}: a configuração existe mas a credencial não abriu`
        + ` — provável ENCRYPTION_KEY trocada. Envio e recebimento deste número estão em risco.`,
      );
      continue;
    }

    const health = await inspectMetaToken(cfg.accessToken);
    const one: MetaTokenHealthOne = {
      restaurantId: row.restaurantId,
      displayPhoneNumber: cfg.displayPhoneNumber,
      ...health,
    };
    results.push(one);

    const quem = `WhatsApp do restaurante ${row.restaurantId}${cfg.displayPhoneNumber ? ` (${cfg.displayPhoneNumber})` : ""}`;

    if (!one.answered) {
      // Cegueira é problema. Nunca "aprovado por omissão" (guardrail 2).
      attention.push(`${quem}: NÃO consegui perguntar à Meta se a credencial está viva — ${one.error ?? "motivo não informado"}.`);
      continue;
    }

    if (one.isValid === false) {
      attention.push(
        `${quem}: a credencial está MORTA segundo a Meta${one.error ? ` — ${one.error}` : ""}.`
        + ` Este número não envia nem recebe mensagem. Só reconexão pelo dono resolve.`,
      );
    } else if (!one.neverExpires && one.expiresInDays !== null && one.expiresInDays <= warnDays) {
      attention.push(
        `${quem}: a credencial vence em ${one.expiresInDays} dia(s) (${one.expiresAt}).`
        + ` Não existe renovação automática para o WhatsApp — passando disso, o número fica mudo sem aviso.`,
      );
    }

    if (one.appIdMatches === false) {
      attention.push(
        `${quem}: a credencial foi emitida por OUTRO aplicativo da Meta (app ${one.tokenAppId}), não pelo nosso.`
        + ` Enquanto isso valer, o nosso app não recebe os webhooks deste número.`,
      );
    }

    if (one.hasRequiredScope === false) {
      attention.push(
        `${quem}: a credencial não carrega a permissão \`${REQUIRED_SCOPE}\`.`
        + ` Permissões vistas: ${one.scopes.join(", ") || "(nenhuma)"}. Sem ela o número não troca mensagem.`,
      );
    }

    // Escrita mínima e não destrutiva: só melhora o aviso de tela que já existe.
    await prisma.metaWhatsAppConfig.updateMany({
      where: { restaurantId: row.restaurantId },
      data: {
        lastHealthCheckAt: new Date(),
        ...(one.expiresAt ? { tokenExpiresAt: new Date(one.expiresAt) } : {}),
      },
    }).catch(() => {});
  }

  // O WhatsApp é o produto no ar. Zero configuração aqui não é "ninguém usa" —
  // é o canal do restaurante ter sumido do banco, e isso alguém precisa saber.
  if (rows.length === 0) {
    attention.push(
      "Nenhum restaurante tem WhatsApp da Meta configurado. Se algum deveria estar atendendo,"
      + " a configuração dele sumiu do banco.",
    );
  }

  // ⭐ A credencial da Sala entra na MESMA varredura, e não num job separado que
  // alguém esqueceria de agendar. Ela é o único token que a operação comercial
  // usa, e foi o único que ninguém olhava.
  const sala = await conferirCredencialDaSala(warnDays);
  attention.push(...sala.attention);

  return {
    totalConfigs:   rows.length,
    answered:       results.filter((r) => r.answered).length,
    results,
    needsAttention: attention.length > 0,
    attention,
    salaDeVendas:   sala.one,
  };
}
