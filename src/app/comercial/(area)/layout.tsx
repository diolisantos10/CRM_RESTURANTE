/**
 * A ÁREA COMERCIAL — a casa de quem vende o Foocci.
 *
 * ── POR QUE ELA SAIU DE DENTRO DO ADMIN ─────────────────────────────────────
 *
 * Até 26/08/2026 esta área morava em `/admin/sala-de-vendas`, dentro da moldura
 * escura do Admin, com a barra lateral da empresa inteira ao lado. Funcionava, e
 * estava errado por duas razões que não são de estética:
 *
 *   · **O endereço ensina.** Uma pessoa cujo trabalho é atender cliente lendo
 *     `/admin` na barra do navegador aprende que está num lugar que não é dela —
 *     e a primeira coisa que ela vê do sistema é uma barra cheia de portas que
 *     devolvem 403.
 *   · **A moldura convida.** Ter Departamentos, Restaurantes e Qualidade a um
 *     clique de distância transforma "não alcança" em "tenta e descobre".
 *
 * Agora é `/comercial`: mesmo motor, mesmo banco, mesmas conversas — endereço
 * próprio e moldura própria. **Não** é `/atendimento`, que já é a caixa de
 * conversas do restaurante; a distinção não é de gosto, é de quem trabalha ali.
 * Aqui é a área de quem VENDE o Foocci, não a de quem o usa. **Nada foi duplicado**: os arquivos foram MOVIDOS,
 * não copiados. Uma segunda cópia da Sala seria a pior coisa que este repositório
 * poderia ganhar hoje.
 *
 * ── ⚠️ A MOLDURA NÃO É A FECHADURA ──────────────────────────────────────────
 *
 * Este layout exige uma sessão para desenhar a casa, e esconde a aba de quem não
 * pode abri-la. O que cada pessoa PODE fazer continua decidido rota a rota, no
 * servidor: quem digitar o endereço direto continua batendo na rota, que recusa.
 * A moldura é a casa; a fechadura está em cada porta.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { lerSessaoInterna } from "@/lib/internal-auth";
import { precisaTrocarSenha, ROTA_DA_TROCA } from "@/lib/troca-de-senha";
import { ENTRADA, abasDoComercial } from "@/lib/sala/rotas";
import { SairDoComercial } from "./SairDoComercial";

export const metadata = {
  title: { default: "Comercial Foocci", template: "%s · Comercial Foocci" },
};

export default async function ComercialLayout({ children }: { children: React.ReactNode }) {
  const sessao = lerSessaoInterna();

  // ── ⚠️ UMA PORTA SÓ, E ELA TEM NOME ──────────────────────────────────────
  //
  // Antes eram duas: a sessão da pessoa **ou** a senha da casa. A senha da casa
  // abria a moldura — todos os menus — e as rotas de dentro a recusavam. Meia
  // porta.
  //
  // O CEO abriu e disse o que via: *"é uma tela sem nada, só com login e senha.
  // Não tem que aparecer os menus, nada."* Ele estava certo, e o defeito era
  // pior que estético: uma sala cheia de abas em que **nenhuma abre** ensina que
  // o sistema está quebrado. E era o contrário — o sistema estava recusando
  // corretamente alguém sem nome.
  //
  // Agora, sem sessão de pessoa, não há casa: há a tela de entrar.
  //
  // A porta de emergência não sumiu — ela mudou de lugar. `/comercial/acessos`
  // vive FORA desta moldura e continua aceitando a senha da casa, senão o
  // primeiro acesso da vida não teria por onde nascer.
  if (!sessao) {
    redirect(ENTRADA);
  }

  // ── ⛔⛔ QUEM ESTÁ COM SENHA DE TERCEIRO NÃO ENTRA NA SALA ────────────────
  //
  // A trava mora no LAYOUT pelo mesmo motivo estrutural da porta acima: é ele
  // quem renderiza `children`. Enquanto a troca não acontecer, a página nem
  // executa e nenhuma consulta dela toca o banco. Tela nova nasce protegida sem
  // ninguém lembrar de proteger — o oposto de uma guarda copiada arquivo a
  // arquivo, que só falta onde ninguém olhou.
  if (await precisaTrocarSenha(sessao.userId)) {
    redirect(ROTA_DA_TROCA);
  }

  const abas = abasDoComercial(sessao.role);

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <header className="shrink-0 border-b border-line bg-paper">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <span className="text-[15px] font-semibold tracking-[-.02em] text-ink">
              Comercial
            </span>
            <span className="truncate text-[12.5px] text-muted">Foocci</span>
          </div>

          <div className="flex min-w-0 items-center gap-3">
            {/* O nome de quem está logado fica visível o tempo todo. Numa sala
                onde assumir conversa é ato registrado, "quem sou eu agora" não
                pode depender de memória — nem de abrir outra tela para conferir. */}
            <span className="hidden truncate text-[12.5px] text-ink2 sm:block">
              {sessao.nome}
            </span>
            <SairDoComercial />
          </div>
        </div>

        <nav aria-label="Seções da área comercial" className="overflow-x-auto">
          <ul className="flex min-w-max gap-1 px-3 pb-1.5">
            {abas.map((a) => (
              <li key={a.href}>
                <Link
                  href={a.href}
                  className="block rounded-lg px-3 py-1.5 text-[13px] font-semibold text-ink2 transition-colors hover:bg-canvas hover:text-ink"
                >
                  {a.rotulo}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
