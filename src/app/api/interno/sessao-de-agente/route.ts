/**
 * ⭐⭐⭐ A PORTA DO AGENTE — sessão sem senha, credencial a cada chamada.
 *
 * A justificativa longa está em `src/lib/agente-auth.ts`. O resumo: a sala de
 * um agente barra o ato de autenticar com senha em produção, e barra com razão.
 * Enquanto a única entrada for por senha, agente nenhum entra — em nenhum
 * prazo, com nenhuma senha.
 *
 *   POST /api/interno/sessao-de-agente
 *        x-foocci-agente: dioli.control-room.diretoria.diretor-geral
 *        Authorization: Bearer <a chave daquele agente>
 *        → 200 + Set-Cookie (a mesma sessão interna que uma pessoa recebe)
 *
 * ── ⛔⛔ A TRAVA QUE FECHA O ASSUNTO DA SENHA DE UMA VEZ ───────────────────
 *
 * Ao emitir a primeira sessão de agente, a conta **PERDE a senha**
 * (`passwordHash` nulo). Não é "a provisória vence": é a entrada por senha
 * deixando de existir para aquela conta, para sempre — `autenticarInterno`
 * recusa quem não tem hash.
 *
 * Isso resolve três coisas de uma vez, e nenhuma delas por acaso:
 *
 *   1. A senha provisória viajou por uma trilha **append-only**: o texto fica
 *      na caixa do Connect para sempre. Anular o hash é o que faz aquele texto
 *      virar letra morta — em vez de um segredo eternamente escrito que só
 *      expira por data.
 *   2. Some a corrida contra o prazo de 48h.
 *   3. Some a troca obrigatória, que para um agente sempre foi teatro: ninguém
 *      "escolhe uma senha própria" quando não digita senha nenhuma.
 *
 * ⚠️ **A largura é a que o CEO concedeu, e nem um grau a mais.** Ele decidiu
 * `DIRETOR_FOOCCI` em 06/09, contra a minha recomendação de `AUDITOR_QA`. Esta
 * porta entrega exatamente o papel que já está no banco — não escolhe papel,
 * não promove, não estreita. Estreitar aqui seria eu revendo a decisão dele por
 * dentro de um conserto técnico, que é a pior forma de mudar uma decisão: sem
 * ninguém perceber. A recomendação de estreitar fica registrada, separada.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { criarCookieInterno, type SessaoInterna } from "@/lib/internal-auth";
import { autenticarAgente, segredoApresentado } from "@/lib/agente-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // ⛔ UMA recusa para tudo que dá errado antes de a conta ser encontrada.
  // Crachá desconhecido, chave ausente e segredo errado respondem igual.
  const naoConfere = NextResponse.json(
    { ok: false, error: "credencial de agente não confere" },
    { status: 401 },
  );

  const cracha = (req.headers.get("x-foocci-agente") ?? "").trim();
  const conferido = autenticarAgente(cracha, segredoApresentado(req.headers.get("authorization")));
  if (!conferido.ok) return naoConfere;

  // A conta sai do e-mail DECLARADO, e não de uma busca pelo crachá no banco.
  // Assim a lista do repositório é a única fonte de "quem tem porta de agente",
  // e some a pergunta "e se dois usuários tiverem o mesmo crachá?".
  const user = await prisma.internalUser.findUnique({
    where: { email: conferido.acesso.email.trim().toLowerCase() },
    include: { memberships: { include: { department: true } } },
  });

  // ⚠️ Conta declarada que ainda não existe, ou desativada, cai na MESMA recusa.
  // Dizer "existe mas está desativada" confirmaria a conta a quem testasse.
  if (!user || !user.isActive) return naoConfere;

  const sessao: SessaoInterna = {
    userId: user.id,
    nome: user.nome,
    role: user.role,
    departamentos: user.memberships.map((m) => m.department.slug),
    gerencia: user.memberships.filter((m) => m.isManager).map((m) => m.department.slug),
  };

  // ⛔ A senha morre aqui. Idempotente: quem já entrou uma vez não tem mais
  // hash, e o update apenas repete o mesmo estado.
  await prisma.internalUser.update({
    where: { id: user.id },
    data: {
      passwordHash: null,
      deveTrocarSenha: false,
      senhaProvisoriaExpiraEm: null,
      senhaDefinidaEm: new Date(),
    },
  });

  const resp = NextResponse.json({
    ok: true,
    nome: user.nome,
    papel: user.role,
    // ⚠️ Dito na resposta de propósito: quem chama precisa saber que a conta
    // deixou de ter senha, senão vai procurar a provisória para sempre.
    senhaRemovida: true,
    aviso:
      "esta conta não tem mais senha: a entrada é por credencial de agente, apresentada a cada " +
      "chamada. A senha provisória que viajou pela caixa do Connect não vale mais nada.",
  });
  resp.headers.set("Set-Cookie", criarCookieInterno(sessao));
  return resp;
}
