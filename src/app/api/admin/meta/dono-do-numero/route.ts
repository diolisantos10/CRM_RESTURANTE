/**
 * GET /api/admin/meta/dono-do-numero?phoneNumberId=… — admin, SOMENTE LEITURA.
 *
 * "De quem é este número de WhatsApp?" — a pergunta que a casa não sabia
 * responder, e cuja ausência deixou três clientes de um restaurante sem resposta
 * por dez dias. A história inteira está em `@/services/whatsapp/donoDoNumero`.
 *
 * Nada é alterado. Nenhum token, nem cifrado nem mascarado, aparece na resposta.
 */

import { NextRequest } from "next/server";
import { checkAdminRequest } from "@/lib/admin-auth";
import { ok, unauthorized, badRequest, serverError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { deQuemEONumero, pareceIdDeNumero } from "@/services/whatsapp/donoDoNumero";
import { foocciSalesPhoneNumberId } from "@/services/foocci-sdr/FoocciSalesChannel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!checkAdminRequest(req)) return unauthorized();

  try {
    const bruto = req.nextUrl.searchParams.get("phoneNumberId")?.trim() ?? "";
    if (!pareceIdDeNumero(bruto)) {
      return badRequest("Informe phoneNumberId (só dígitos, 10 a 20).");
    }

    return ok(await deQuemEONumero(prisma, bruto, foocciSalesPhoneNumberId()));
  } catch (e) {
    console.error("[meta] dono-do-numero falhou:", e);
    return serverError("Não consegui consultar.");
  }
}
