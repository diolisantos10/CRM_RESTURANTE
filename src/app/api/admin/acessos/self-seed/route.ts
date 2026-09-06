/**
 * POST /api/admin/acessos/self-seed
 *
 * Aplica os acessos declarados em `acessosDeclarados.ts`. Idempotente.
 *
 * ── POR QUE UMA ROTA CHAMADA PELO BOOT ──────────────────────────────────────
 *
 * Ordem do CEO, 06/09/2026: *"quem vai fazer é você que vai entrar lá e fazer e
 * enviar essa mensagem é você, está decidido."*
 *
 * A saída errada seria dar uma credencial de administrador a quem constrói.
 * Aqui não nasce credencial nenhuma: a concessão é **declarada no repositório**
 * e aplicada pela própria plataforma na subida, com o `ADMIN_SECRET` que já vive
 * no container. É o quarto uso do mesmo molde — `seed-howtos`,
 * `demo-bakery/self-seed` e `sala-de-vendas/seed` são os três anteriores.
 *
 * ⚠️ E ela NUNCA troca senha de quem já existe: rodando a cada deploy, isso
 * expulsaria a pessoa da própria conta toda subida. Ver o arquivo do serviço.
 */

import { NextRequest } from "next/server";
import { checkAdminRequest } from "@/lib/admin-auth";
import { ok, unauthorized, serverError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { aplicarAcessosDeclarados } from "@/services/organizacao/acessosDeclarados";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (!checkAdminRequest(req)) return unauthorized();
    const r = await aplicarAcessosDeclarados(prisma, req.nextUrl.origin);
    // ⚠️ Sem a senha na resposta, aqui e em lugar nenhum: esta rota é chamada
    // pelo script de boot, e o que ela devolve vai para o log do deploy.
    return ok(r);
  } catch (err) {
    console.error("[POST /api/admin/acessos/self-seed]", err);
    return serverError();
  }
}
