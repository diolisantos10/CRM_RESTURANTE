/**
 * Admin area layout — server component.
 * Renders the admin sidebar + main content area.
 *
 * ── POR QUE DUAS PORTAS, E NÃO UMA ──
 *
 * Este portão aceitava SÓ a senha compartilhada (`ADMIN_SECRET`). Enquanto o
 * Admin era de uma pessoa só, isso bastava.
 *
 * Com a v3 deixou de bastar, e o defeito só apareceu abrindo a tela num
 * navegador de verdade: o SDR humano tem login próprio, a API dele responde 200,
 * e mesmo assim ele batia na tela de "Informe o admin secret". Ou seja — a
 * pessoa que a Sala de Vendas existe para atender não conseguia entrar nela, a
 * não ser recebendo a senha que abre a empresa inteira.
 *
 * Dar a senha compartilhada ao SDR seria pior que o problema: contraria o
 * critério 6 do CEO e destrói a razão de existir da identidade interna.
 *
 * Então o layout aceita as DUAS portas (ADR-003, convivência com prazo):
 *
 *   - sessão interna assinada → o caminho novo, com papel e escopo;
 *   - `ADMIN_SECRET` → o caminho antigo, que continua abrindo o que já abria.
 *
 * Quem entra por qualquer uma delas vê a moldura. O que cada um PODE fazer
 * continua decidido rota a rota, e a rota é que nega: a Sala responde 200 para o
 * SDR e 403 nos Departamentos, com a negativa na trilha.
 *
 * A moldura não é autorização — nunca foi. Ela é a casa; a fechadura está em
 * cada porta.
 */

import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { lerSessaoInterna } from "@/lib/internal-auth";
import { precisaTrocarSenha, ROTA_DA_TROCA } from "@/lib/troca-de-senha";
import { AdminSidebar } from "./AdminSidebar";

export default async function AdminAreaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessao = lerSessaoInterna();

  if (!isAdminAuthenticated() && !sessao) {
    redirect("/admin/login");
  }

  // ── ⛔⛔ SENHA DE TERCEIRO NÃO ABRE A CASA ────────────────────────────────
  //
  // ⚠️ Só para quem entrou pela SESSÃO da pessoa. Quem entra pela senha antiga
  // da casa (`ADMIN_SECRET`) não tem pessoa — não há de quem exigir troca, e
  // mandar essa porta para a tela de trocar senha travaria a única entrada que
  // existe quando ainda não há acesso nenhum criado. Essa porta tem prazo e
  // rastro próprios (ADR-003); não é aqui que ela morre.
  if (sessao && (await precisaTrocarSenha(sessao.userId))) {
    redirect(ROTA_DA_TROCA);
  }

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-white overflow-hidden lg:flex-row">
      {/* O papel desce para o menu mostrar só o que a pessoa alcança. Quem entra
          pela senha antiga não tem papel — e vê tudo, como sempre viu. */}
      <AdminSidebar papel={sessao?.role ?? null} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
