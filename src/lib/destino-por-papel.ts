/**
 * A porta de entrada de cada papel.
 *
 * ── POR QUE ISTO NÃO MORA NA ROTA ───────────────────────────────────────────
 *
 * Morava, e o `next build` recusou: um arquivo `route.ts` só pode exportar os
 * métodos HTTP e um punhado de configurações. Qualquer outro export é erro de
 * compilação — e o `tsc` não pega, porque é regra do Next, não do TypeScript.
 *
 * Aqui fora ele também fica testável sem subir rota.
 */

import type { InternalRole } from "@prisma/client";
import { ROTAS } from "@/lib/sala/rotas";

/**
 * Para onde a pessoa vai depois de entrar.
 *
 * O SDR cai direto no ATENDIMENTO, e não na lista de filas: a fila é o índice, o
 * atendimento é o trabalho. Mandá-lo para `/admin/restaurants` — o destino de
 * todo mundo até 25/08/2026 — o jogava numa tela que ele não pode ver, e a
 * primeira coisa que ele veria do sistema seria uma recusa.
 *
 * O destino é decidido no SERVIDOR e viaja junto com a sessão. Decidido no
 * cliente, seria um destino que o navegador pode trocar.
 */
export function destinoDe(papel: InternalRole): string {
  switch (papel) {
    case "AGENTE_HUMANO":
      return ROTAS.conversas;
    case "GERENTE_DEPARTAMENTO":
    case "AUDITOR_QA":
      return ROTAS.painel;
    /**
     * ⚠️ O CEO E O DIRETOR ENTRAM PELA SALA DE VENDAS — ordem do CEO, 10/09/2026.
     *
     * Até hoje caíam em `/admin/departamentos`, uma tela que dizia, com todas as
     * letras, "a estrutura ainda não foi montada — nada depende disto para
     * funcionar". Primeira coisa que o dono via ao entrar: um painel de zeros
     * sobre um organograma que só existe no documento. E apertava voltar.
     *
     * *"Enquanto isso não estiver de pé rodando e vendendo a gente não vai fazer
     * mais nenhum projeto."* A porta de entrada tem de ser o lugar onde a
     * companhia decide se vive: o painel comercial. Quando a prioridade mudar,
     * esta linha muda com ela — e é por isso que ela está aqui, com data, e não
     * espalhada em três `router.replace`.
     */
    case "MASTER_CEO":
    case "DIRETOR_FOOCCI":
      return ROTAS.painel;
    default:
      return "/admin/departamentos";
  }
}
