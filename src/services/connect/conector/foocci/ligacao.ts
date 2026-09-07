/**
 * ⭐ A LIGAÇÃO LOCAL DO FOOCCI — o único arquivo que este produto escreve.
 *
 * ─── O QUE ESTE ARQUIVO PROVA ───────────────────────────────────────────────
 *
 * Que o conector é PADRÃO. Tudo o que é do Foocci — que o agente se chama `ta`,
 * que a tela é a Sala de Vendas, que a conversa é um `SiteLead`, que falar com o
 * cliente é `registrarSaida` + `entregarMensagem`, que a pendência vira uma
 * linha em `connect_pendencias` — está aqui dentro, e em nenhum outro lugar da
 * pasta `conector/`.
 *
 * Conectar o CityJobs é escrever o irmão deste arquivo. Não é reescrever nada.
 *
 * ─── ⚠️ AS DUAS ESCRITAS QUE ESTA LIGAÇÃO FAZ, E O CUIDADO DE CADA UMA ──────
 *
 *   · `falarComOCliente` reusa `registrarSaida` + `entregarMensagem`, que são o
 *     caminho de produção já provado da Sala. Ela **não** escreve na tabela de
 *     mensagens por conta própria: um segundo jeito de gravar uma fala do
 *     agente seria a segunda verdade sobre quem falou com o cliente.
 *
 *   · `autor: "IA"` e não `"SISTEMA"`. `SISTEMA` é cadência e template
 *     operacional, coisa que ninguém redigiu. Isto aqui é decisão da empresa
 *     chegando pela boca do agente, e a auditoria precisa poder separar as duas.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { registrarSaida } from "@/services/salaDeVendas/conversa";
import { entregarMensagem } from "@/services/salaDeVendas/entrega";
import { PRODUTO_ID } from "@/services/connect/cadastro";
import type { FalaAoCliente, LigacaoLocal } from "../ligacaoLocal";
import type { ArmazemDePendencias } from "../pendencias";
import { armazemDePendenciasNoBanco } from "./armazem";

type Cliente = PrismaClient | Prisma.TransactionClient;

/** A tela do Foocci que usa o conector hoje. */
export const CANAL_DA_SALA = "sala-de-vendas" as const;
/** O agente que atende nessa tela. É o TA — o mesmo que já responde o lead. */
export const AGENTE_DA_SALA = "ta" as const;

export interface OpcoesDaLigacao {
  /**
   * Quem assina a mensagem. O cliente acabou de conversar com "Agente Maria" e
   * a resposta da empresa não pode chegar anônima nem com outro nome — trocar de
   * agente no meio da conversa dá ao cliente duas vozes.
   *
   * `null` quando o time ainda não existe no banco: sai sem autor nomeado, como
   * as outras mensagens da Sala já saem nesse caso.
   */
  assinaUserId?: string | null;
  /** Injetável no teste; no ar é a tabela. */
  armazem?: ArmazemDePendencias;
}

/**
 * ⭐ A ligação do Foocci.
 *
 * Recebe o `db` porque a Sala escreve **dentro da transação de identidade**
 * (`comIdentidade`), que é onde o RLS enxerga o papel de quem escreve. Escrever
 * fora dela é escrever onde a trava do banco não vê.
 */
export function ligacaoDoFoocci(db: Cliente, opcoes: OpcoesDaLigacao = {}): LigacaoLocal {
  return {
    produto: PRODUTO_ID,
    canal: CANAL_DA_SALA,
    agente: AGENTE_DA_SALA,
    armazem: opcoes.armazem ?? armazemDePendenciasNoBanco(db),

    /**
     * **Nunca lança.** Quem chama está num turno de webhook da Meta, e a Meta
     * reentrega o que falhou: uma exceção aqui não perde uma resposta, vira
     * laço — a mesma mensagem batendo na mesma falha de minuto em minuto.
     */
    async falarComOCliente(conversa, texto, ctx): Promise<FalaAoCliente> {
      try {
        const gravada = await registrarSaida(db, {
          leadId: conversa,
          texto,
          autor: "IA",
          autorUserId: opcoes.assinaUserId ?? null,
          agora: ctx.agora,
        });
        if (!gravada.ok) {
          return { registrada: false, entregue: false, causa: gravada.causa };
        }

        // ⚠️ `registrada` e `entregue` são coisas diferentes, e continuam sendo.
        // Com `FOOCCI_SDR_SEND_ENABLED` desligada a mensagem fica PENDENTE e
        // visível na tela — que é o estado normal enquanto o dono não ligar a
        // entrega. Uma falha de entrega NÃO desfaz o registro.
        //
        // "maquina": quem chega por aqui é um AGENTE, não o vendedor com o dedo
        // no botão. Mesmo instruído por gente, ele não é a pessoa que leu e
        // escreveu — e a régua desta casa é o que a máquina consegue fazer
        // sozinha, nunca a boa intenção de quem a instruiu.
        const entrega = await entregarMensagem(db, gravada.mensagemId, "maquina");
        return {
          registrada: true,
          entregue: entrega.entregue,
          mensagemId: gravada.mensagemId,
          causa: entrega.entregue ? undefined : entrega.motivo,
        };
      } catch (e) {
        return {
          registrada: false,
          entregue: false,
          causa: `a gravação da fala quebrou: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    },
  };
}
