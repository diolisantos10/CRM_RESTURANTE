/**
 * ⭐⭐⭐ A PESSOA DEFINE A PRÓPRIA SENHA — e é a única porta que faz isso.
 *
 * ── POR QUE ELA EXISTE ──────────────────────────────────────────────────────
 *
 * `POST /api/admin/pessoas` cria e troca senha, e é **só do CEO**. Serve para
 * conceder acesso — não para a pessoa cuidar do acesso dela. Sem esta rota, a
 * troca obrigatória no primeiro acesso seria uma exigência sem caminho: a casa
 * mandaria trocar e não haveria onde.
 *
 * ── ⛔ AS TRÊS TRAVAS, E CADA UMA FECHA UM BURACO DIFERENTE ─────────────────
 *
 *   1. **Exige a senha ATUAL.** Sem isso, um cookie roubado vira troca de senha
 *      — o atacante fecharia a porta por dentro e o dono perderia a conta.
 *   2. **A nova não pode ser igual à atual.** Senão "trocar" vira um clique que
 *      não troca nada, e a senha que um terceiro leu continua valendo com o
 *      carimbo de trocada — que é pior que não ter trocado, porque agora
 *      ninguém mais desconfia.
 *   3. **A nova passa pela MESMA régua** (`problemaComASenha`) que o Admin usa.
 *      Duas réguas discordariam no primeiro mês, e a fraca venceria.
 *
 * ⚠️ E a sessão é REEMITIDA no fim: o cookie antigo descreve um mundo em que a
 * pessoa devia trocar. Sem reemitir, ela trocaria e continuaria sendo mandada
 * para a tela de troca até o cookie vencer.
 */

import { NextResponse, type NextRequest } from "next/server";
import { compare, hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  lerSessaoInternaDaRequest,
  criarCookieInterno,
} from "@/lib/internal-auth";
import { problemaComASenha } from "@/services/organizacao/senhaEscolhida";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sessao = lerSessaoInternaDaRequest(req);
  if (!sessao) {
    return NextResponse.json({ ok: false, error: "não autorizado" }, { status: 401 });
  }

  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const atual = typeof corpo.atual === "string" ? corpo.atual : "";
  const nova = typeof corpo.nova === "string" ? corpo.nova : "";

  if (!atual || !nova) {
    return NextResponse.json(
      { ok: false, error: "Informe a senha atual e a nova." },
      { status: 400 },
    );
  }

  const user = await prisma.internalUser.findUnique({
    where: { id: sessao.userId },
    select: { id: true, nome: true, email: true, passwordHash: true, isActive: true },
  });
  if (!user || !user.isActive || !user.passwordHash) {
    return NextResponse.json({ ok: false, error: "não autorizado" }, { status: 401 });
  }

  // ⛔ TRAVA 1 — a senha atual. Cookie sozinho não troca senha.
  if (!(await compare(atual, user.passwordHash))) {
    return NextResponse.json({ ok: false, error: "A senha atual não confere." }, { status: 400 });
  }

  // ⛔ TRAVA 2 — trocar tem de trocar.
  if (await compare(nova, user.passwordHash)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "A nova senha é igual à atual. A senha que você recebeu passou por outra pessoa — " +
          "repeti-la deixa tudo como estava, agora com aparência de resolvido.",
      },
      { status: 400 },
    );
  }

  // ⛔ TRAVA 3 — a mesma régua do Admin, e não uma paralela.
  const problema = problemaComASenha(nova, { nome: user.nome, email: user.email });
  if (problema) return NextResponse.json({ ok: false, error: problema }, { status: 400 });

  await prisma.internalUser.update({
    where: { id: user.id },
    data: {
      passwordHash: await hash(nova, 10),
      deveTrocarSenha: false,
      senhaDefinidaEm: new Date(),
    },
  });

  // ⚠️ Cookie novo: o antigo descreve um mundo em que ela ainda devia trocar.
  const resp = NextResponse.json({ ok: true });
  resp.headers.set("Set-Cookie", criarCookieInterno(sessao));
  return resp;
}
