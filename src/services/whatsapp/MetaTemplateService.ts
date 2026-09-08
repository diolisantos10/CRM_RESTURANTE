/**
 * MetaTemplateService — registry of Meta message templates per restaurant, plus a
 * sync that pulls the restaurant's templates (and approval status) from the Meta Graph
 * API so the CRM send layer can resolve an APPROVED template instead of failing.
 *
 * Business-initiated WhatsApp sends OUTSIDE the 24h customer-service window must use an
 * APPROVED template; CRM/automation resolves one from here via findApproved().
 *
 * Meta-scoped. The local row mirrors
 * Meta's name/language/status/variable-count; `mappedCampaignType` is a Foocci-side link
 * (template → CRM objective) that sync preserves (never clobbers).
 */

import { prisma } from "@/lib/prisma";
import { MetaConfigService } from "./MetaConfigService";
import { metaGraphUrl } from "./metaFlag";
import { maskGraphResponse } from "./providers/metaPayload";

export interface MetaTemplateView {
  id:                 string;
  templateName:       string;
  languageCode:       string;
  category:           string;
  status:             string;
  bodyVariables:      number;
  mappedCampaignType: string | null;
  rejectedReason:     string | null;
  metaTemplateId:     string | null;
}

export interface MetaTemplateInput {
  restaurantId:        string;
  templateName:        string;
  languageCode?:       string;
  category?:           string;
  status?:             string;
  bodyVariables?:      number;
  /** Pass to set; OMIT (undefined) to preserve an existing mapping on update. */
  mappedCampaignType?: string | null;
  /** Pass to set; OMIT (undefined) to preserve on update. */
  rejectedReason?:     string | null;
  /** Pass to set; OMIT (undefined) to preserve on update. */
  metaTemplateId?:     string | null;
}

function toView(t: {
  id: string; templateName: string; languageCode: string; category: string;
  status: string; bodyVariables: number; mappedCampaignType: string | null; rejectedReason: string | null;
  metaTemplateId: string | null;
}): MetaTemplateView {
  return {
    id: t.id, templateName: t.templateName, languageCode: t.languageCode, category: t.category,
    status: t.status, bodyVariables: t.bodyVariables, mappedCampaignType: t.mappedCampaignType,
    rejectedReason: t.rejectedReason, metaTemplateId: t.metaTemplateId,
  };
}

/** Maps a Meta template status to our compact set. */
function mapMetaStatus(raw: unknown): string {
  const s = String(raw ?? "").toUpperCase();
  if (s === "APPROVED") return "APPROVED";
  if (s === "REJECTED") return "REJECTED";
  if (s === "PAUSED" || s === "DISABLED") return "DISABLED";
  return "PENDING";
}

/** Counts {{n}} placeholders in the BODY component (the highest n = variable count). */
/**
 * Quantas variáveis `{{n}}` o CORPO do modelo espera.
 *
 * Exportada em 08/09/2026 para a Sala de Vendas: ela precisa da MESMA contagem
 * para conferir, antes de disparar, se o modelo aprovado bate com os parâmetros
 * que o código manda. Reescrever essa contagem lá seria criar uma segunda
 * verdade sobre o mesmo `{{1}}` — e as duas discordariam no primeiro modelo com
 * variável no cabeçalho.
 */
export function countBodyVariables(components: unknown): number {
  if (!Array.isArray(components)) return 0;
  const body = components.find((c) => String((c as { type?: unknown })?.type).toUpperCase() === "BODY");
  const text = (body as { text?: unknown })?.text;
  const matches = String(text ?? "").match(/\{\{\s*\d+\s*\}\}/g) ?? [];
  let max = 0;
  for (const m of matches) {
    const n = parseInt(m.replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

export const MetaTemplateService = {
  async list(restaurantId: string): Promise<MetaTemplateView[]> {
    const rows = await prisma.metaMessageTemplate.findMany({
      where:   { restaurantId },
      orderBy: { templateName: "asc" },
    });
    return rows.map(toView);
  },

  async upsert(input: MetaTemplateInput): Promise<MetaTemplateView> {
    const create = {
      restaurantId:       input.restaurantId,
      templateName:       input.templateName,
      languageCode:       input.languageCode ?? "pt_BR",
      category:           input.category ?? "UTILITY",
      status:             input.status ?? "PENDING",
      bodyVariables:      input.bodyVariables ?? 0,
      mappedCampaignType: input.mappedCampaignType ?? null,
      rejectedReason:     input.rejectedReason ?? null,
      metaTemplateId:     input.metaTemplateId ?? null,
    };
    // On update, only touch status and mappedCampaignType when the caller explicitly
    // provided them. Sync passes both → they refresh. Provisioning re-runs OMIT status
    // for a template that already exists → the current status (e.g. APPROVED, set by a
    // prior sync) is PRESERVED, never clobbered back to PENDING (which would make
    // findApproved miss it and silently drop the CRM send path to freeform).
    const update: {
      category: string; bodyVariables: number; status?: string; mappedCampaignType?: string | null; rejectedReason?: string | null; metaTemplateId?: string | null;
    } = {
      category:      input.category ?? "UTILITY",
      bodyVariables: input.bodyVariables ?? 0,
    };
    if (input.status !== undefined) update.status = input.status;
    if (input.mappedCampaignType !== undefined) update.mappedCampaignType = input.mappedCampaignType;
    if (input.rejectedReason !== undefined) update.rejectedReason = input.rejectedReason;
    if (input.metaTemplateId !== undefined) update.metaTemplateId = input.metaTemplateId;

    const row = await prisma.metaMessageTemplate.upsert({
      where: {
        restaurantId_templateName_languageCode: {
          restaurantId: input.restaurantId,
          templateName: input.templateName,
          languageCode: input.languageCode ?? "pt_BR",
        },
      },
      create,
      update,
    });
    return toView(row);
  },

  /** Sets/clears the template→CRM-objective mapping for one template. */
  async setCampaignMapping(
    restaurantId: string, templateName: string, languageCode: string, mappedCampaignType: string | null,
  ): Promise<void> {
    await prisma.metaMessageTemplate.updateMany({
      where: { restaurantId, templateName, languageCode },
      data:  { mappedCampaignType },
    });
  },

  /**
   * Creates a message template on Meta (POST /{wabaId}/message_templates) and submits
   * it for review. The payload is built by metaTemplateBuilder (sequential {{n}} vars +
   * examples). Returns the new template id on success. A "template already exists" reply
   * is surfaced as { ok:false, alreadyExists:true } so provisioning can treat it as a
   * skip (idempotent re-run) rather than a hard error. Never throws.
   */
  async createOnMeta(
    restaurantId: string,
    payload: { name: string; language: string; category: string; components: Array<Record<string, unknown>> },
  ): Promise<{ ok: boolean; id?: string; error?: string; alreadyExists?: boolean }> {
    const cfg = await MetaConfigService.getResolved(restaurantId);
    if (!cfg) return { ok: false, error: "WhatsApp oficial da Meta não está conectado." };
    try {
      const res = await fetch(metaGraphUrl(`${cfg.wabaId}/message_templates`), {
        method:  "POST",
        headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = (json as { error?: { message?: string; error_user_msg?: string; code?: number; error_subcode?: number } }).error;
        // 100/2388023 + "already exists" → idempotent skip.
        const raw = `${err?.error_user_msg ?? ""} ${err?.message ?? ""}`.toLowerCase();
        const alreadyExists = raw.includes("already exists") || raw.includes("já existe") || err?.error_subcode === 2388023;
        return {
          ok: false,
          alreadyExists,
          error: maskGraphResponse(err?.error_user_msg ?? err?.message ?? "Falha ao criar o modelo na Meta."),
        };
      }
      const id = (json as { id?: unknown }).id;
      return { ok: true, id: id != null ? String(id) : undefined };
    } catch (e) {
      return { ok: false, error: maskGraphResponse(e instanceof Error ? e.message : String(e)) };
    }
  },

  /**
   * Edits an existing template IN PLACE (POST /{metaTemplateId}). Meta keeps the current
   * APPROVED version live while the edited body is re-reviewed — a zero-gap update, unlike
   * delete+recreate. Only valid when the variable shape is unchanged (same paramTokens);
   * the caller enforces that. Never throws.
   */
  async editOnMeta(
    restaurantId: string,
    metaTemplateId: string,
    payload: { category: string; components: Array<Record<string, unknown>> },
  ): Promise<{ ok: boolean; error?: string }> {
    const cfg = await MetaConfigService.getResolved(restaurantId);
    if (!cfg) return { ok: false, error: "WhatsApp oficial da Meta não está conectado." };
    try {
      const res = await fetch(metaGraphUrl(metaTemplateId), {
        method:  "POST",
        headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = (json as { error?: { message?: string; error_user_msg?: string } }).error;
        return { ok: false, error: maskGraphResponse(err?.error_user_msg ?? err?.message ?? "Falha ao editar o modelo na Meta.") };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: maskGraphResponse(e instanceof Error ? e.message : String(e)) };
    }
  },

  /**
   * Deletes a template on Meta by name (DELETE /{wabaId}/message_templates?name=…) and
   * removes the local mirror row. Used to RE-SUBMIT an edited phrase: Meta templates are
   * immutable by name, so a rejected template must be deleted before the fixed version is
   * created. Never throws.
   */
  async deleteOnMeta(restaurantId: string, templateName: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = await MetaConfigService.getResolved(restaurantId);
    if (!cfg) return { ok: false, error: "WhatsApp oficial da Meta não está conectado." };
    try {
      const res = await fetch(metaGraphUrl(`${cfg.wabaId}/message_templates?name=${encodeURIComponent(templateName)}`), {
        method:  "DELETE",
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
      });
      const json: unknown = await res.json().catch(() => ({}));
      // Remove the local mirror regardless (a missing-on-Meta template should not linger locally).
      await prisma.metaMessageTemplate.deleteMany({ where: { restaurantId, templateName } }).catch(() => {});
      if (!res.ok) {
        const err = (json as { error?: { message?: string } }).error;
        return { ok: false, error: maskGraphResponse(err?.message ?? "Falha ao remover o modelo na Meta.") };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: maskGraphResponse(e instanceof Error ? e.message : String(e)) };
    }
  },

  /**
   * Pulls the restaurant's templates from the Meta Graph API
   * (GET /{wabaId}/message_templates) and mirrors name/language/category/status/
   * variable-count locally. Preserves existing campaign mappings. Best-effort,
   * paginated. Returns a count and never throws.
   *
   * ⚠️ ESPELHO É ESPELHO NOS DOIS SENTIDOS — aprendido em 23/08/2026.
   * Antes, este sync só fazia UPSERT do que a Meta devolvia. Um modelo que a Meta
   * PAROU de listar — porque a WABA mudou, ou porque ele foi apagado lá — ficava
   * no banco com o último status conhecido, `APPROVED`, **para sempre**. E o selo
   * "✓ Meta aprovada" da tela de campanha lê exatamente esse campo.
   *
   * O estrago não era só cosmético: `findApproved()` também lê esse campo, então o
   * disparo escolhia o modelo fantasma, mandava para a Meta e levava
   * `META_132001 — template não existe`. Instrumento que dá falso positivo é pior
   * que instrumento nenhum: o lojista via cinco frases com selo verde enquanto
   * nenhuma delas existia na conta que estava enviando.
   *
   * A reconciliação abaixo fecha isso: o que a Meta não listou nesta varredura
   * deixa de valer como aprovado. Duas travas de segurança sobre ela:
   *   1. **Só roda em varredura COMPLETA e bem-sucedida.** Erro no meio da
   *      paginação devolve cedo, sem reconciliar — meia-leitura não pode virar
   *      "a Meta não tem". É o guardrail 1: ausência de informação não é informação.
   *   2. **Só rebaixa linha `APPROVED`.** É o único status que (a) destrava envio
   *      de verdade e (b) faz o produto AFIRMAR algo ao lojista. `PENDING` e
   *      `REJECTED` já são honestos por natureza — não prometem nada — e mexer
   *      neles arriscaria brigar com um modelo recém-submetido que a listagem da
   *      Meta ainda não pegou.
   */
  async syncFromMeta(restaurantId: string): Promise<{ ok: boolean; synced: number; missing?: number; error?: string }> {
    const cfg = await MetaConfigService.getResolved(restaurantId);
    if (!cfg) return { ok: false, synced: 0, error: "WhatsApp oficial da Meta não está conectado." };
    try {
      let url: string | null =
        metaGraphUrl(`${cfg.wabaId}/message_templates?fields=id,name,language,category,status,components,rejected_reason&limit=100`);
      let synced = 0;
      let pages = 0;
      // Tudo que a Meta confirmou existir nesta varredura, por nome+idioma.
      const vistos = new Set<string>();
      const chave = (name: string, lang: string) => `${name} ${lang}`;
      // Paginação truncada NÃO é varredura completa — sem isso, uma conta com mais
      // de 1000 modelos veria o resto virar "não existe na Meta".
      let completa = true;
      while (url && pages < 10) {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.accessToken}` } });
        const json: unknown = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err = (json as { error?: { message?: string } }).error?.message;
          return { ok: false, synced, error: maskGraphResponse(err ?? "Falha ao buscar modelos na Meta.") };
        }
        const data = (json as { data?: unknown }).data;
        const rows = Array.isArray(data) ? data : [];
        for (const t of rows) {
          const tpl = t as { id?: unknown; name?: unknown; language?: unknown; category?: unknown; status?: unknown; components?: unknown; rejected_reason?: unknown };
          if (!tpl.name) continue;
          const mapped = mapMetaStatus(tpl.status);
          const reasonRaw = tpl.rejected_reason != null ? String(tpl.rejected_reason) : "";
          const nome  = String(tpl.name);
          const idioma = String(tpl.language ?? "pt_BR");
          await this.upsert({
            restaurantId,
            templateName:  nome,
            languageCode:  idioma,
            category:      String(tpl.category ?? "UTILITY").toUpperCase(),
            status:        mapped,
            bodyVariables: countBodyVariables(tpl.components),
            // Rejection reason: set on REJECTED, clear otherwise (a fixed re-submit clears it).
            rejectedReason: mapped === "REJECTED" ? (reasonRaw && reasonRaw !== "NONE" ? reasonRaw : "Rejeitado pela Meta") : null,
            metaTemplateId: tpl.id != null ? String(tpl.id) : undefined, // omit → preserved
            // mappedCampaignType omitted → preserved
          });
          vistos.add(chave(nome, idioma));
          synced++;
        }
        url = (json as { paging?: { next?: string } }).paging?.next ?? null;
        pages++;
        if (url && pages >= 10) completa = false;
      }

      const missing = completa ? await this.reconcileMissing(restaurantId, vistos, chave) : 0;
      return { ok: true, synced, missing };
    } catch (e) {
      return { ok: false, synced: 0, error: maskGraphResponse(e instanceof Error ? e.message : String(e)) };
    }
  },

  /**
   * Rebaixa para `MISSING` toda linha `APPROVED` que a varredura completa da Meta
   * NÃO devolveu — o modelo não existe mais na conta que envia hoje.
   *
   * `MISSING` é status próprio de propósito, não `REJECTED`: a Meta não reprovou
   * nada, ela simplesmente não conhece este modelo aqui. Dizer "rejeitado" seria
   * trocar uma mentira por outra, e mandaria o lojista consertar um texto que não
   * tem defeito. `mappedCampaignType` e `metaTemplateId` ficam intactos, para o
   * caso de a conta antiga voltar a ser lida.
   *
   * Como `findApproved()` exige `status: "APPROVED"`, rebaixar aqui é o que impede
   * o disparo de escolher um modelo fantasma e morrer com `META_132001`.
   */
  async reconcileMissing(
    restaurantId: string,
    vistos: Set<string>,
    chave: (name: string, lang: string) => string,
  ): Promise<number> {
    const aprovadas = await prisma.metaMessageTemplate.findMany({
      where:  { restaurantId, status: "APPROVED" },
      select: { id: true, templateName: true, languageCode: true },
    });
    const orfas = aprovadas.filter((t) => !vistos.has(chave(t.templateName, t.languageCode)));
    if (orfas.length === 0) return 0;
    await prisma.metaMessageTemplate.updateMany({
      where: { id: { in: orfas.map((t) => t.id) } },
      data:  { status: "MISSING" },
    });
    return orfas.length;
  },

  /**
   * Resolve an APPROVED template for a business-initiated send. Looks up by explicit
   * name first, then by mapped campaign type. Returns null when none is approved —
   * the caller must then block with META_TEMPLATE_REQUIRED (never send freeform).
   */
  async findApproved(
    restaurantId: string,
    opts: { templateName?: string; languageCode?: string; mappedCampaignType?: string },
  ): Promise<MetaTemplateView | null> {
    const base = { restaurantId, status: "APPROVED" as const };
    if (opts.templateName) {
      const byName = await prisma.metaMessageTemplate.findFirst({
        where: { ...base, templateName: opts.templateName, ...(opts.languageCode ? { languageCode: opts.languageCode } : {}) },
      });
      if (byName) return toView(byName);
    }
    if (opts.mappedCampaignType) {
      const byType = await prisma.metaMessageTemplate.findFirst({
        where: { ...base, mappedCampaignType: opts.mappedCampaignType },
      });
      if (byType) return toView(byType);
    }
    return null;
  },
};
