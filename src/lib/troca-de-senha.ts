/**
 * ⛔⛔⛔ A TROCA OBRIGATÓRIA NO PRIMEIRO ACESSO — a trava, num lugar só.
 *
 * ── O QUE ELA CONSERTA ──────────────────────────────────────────────────────
 *
 * Ordem do CEO, 05/09/2026: *"deveria haver uma forma de a pessoa receber uma
 * senha provisória e já trocar. Esse é o procedimento padrão em qualquer
 * empresa."*
 *
 * Ele apontou um buraco real. A casa sorteava a senha, ela aparecia **uma vez**
 * na tela de quem estava criando o acesso — e valia **para sempre**. Ou seja:
 * quem cria o acesso fica sabendo a senha de quem entra, indefinidamente, e
 * nada no sistema jamais pede a troca. Numa empresa de uma pessoa isso passa;
 * numa empresa com sete acessos e crescendo, é uma credencial compartilhada com
 * outro nome.
 *
 * ── ⚠️ POR QUE A PERGUNTA VAI AO BANCO, E NÃO AO COOKIE ─────────────────────
 *
 * A sessão interna é assinada e não dá para forjar — mas ela é um **retrato do
 * momento do login**. Um cookie emitido antes desta trava existir não carrega o
 * campo, e um cookie emitido antes de o Admin resetar a senha de alguém carrega
 * o valor velho. Nos dois casos a leitura pelo cookie diria "não precisa
 * trocar" sobre quem precisa — e o furo apareceria justamente em quem teve a
 * senha trocada por terceiro, que é o caso que a trava existe para pegar.
 *
 * Uma consulta por `id`, indexada, por render de moldura. É o mesmo preço que o
 * console do FOOCCI Manager já paga para poder revogar acesso na hora.
 */

import { prisma } from "@/lib/prisma";

/**
 * A pessoa desta sessão ainda está com a senha que outra pessoa definiu?
 *
 * ⚠️ **Fail-closed em toda dúvida.** Usuário que sumiu do banco entre o login e
 * este render, ou banco fora do ar, devolvem `true`: o pior desfecho aqui é
 * mandar alguém trocar uma senha que já era dele — irritante e reversível. O
 * desfecho contrário é deixar passar quem devia trocar, e esse não se desfaz.
 */
export async function precisaTrocarSenha(userId: string): Promise<boolean> {
  try {
    const u = await prisma.internalUser.findUnique({
      where: { id: userId },
      select: { deveTrocarSenha: true },
    });
    return u?.deveTrocarSenha ?? true;
  } catch {
    return true;
  }
}

/** O endereço único da tela de troca. Escrito uma vez, usado em todo lugar. */
export const ROTA_DA_TROCA = "/admin/trocar-senha";

/**
 * A rota está liberada mesmo para quem tem de trocar?
 *
 * ⚠️ A lista é MÍNIMA de propósito. Cada endereço liberado aqui é um lugar onde
 * alguém com senha de terceiro consegue entrar — então só entra o que é
 * necessário para a própria troca acontecer e para a pessoa conseguir sair.
 */
export function liberadaMesmoDevendoTroca(caminho: string): boolean {
  return (
    caminho === ROTA_DA_TROCA ||
    caminho.startsWith("/api/interno/senha") ||
    caminho.startsWith("/admin/sair") ||
    caminho.startsWith("/admin/login")
  );
}
