/**
 * comandaDoPagamento — quem confirma o pagamento manda imprimir.
 *
 * ─── O DEFEITO, medido no raio-x de 06/09/2026 ──────────────────────────────
 * Cinco caminhos deste sistema colocavam um pedido em CONFIRMED — cobrando o
 * cliente, registrando a receita no CRM, avisando o Saipos — e **nenhum deles
 * enfileirava a comanda**. O pedido existia para o financeiro e não existia para
 * a cozinha:
 *
 *   1. `api/payments/stone/webhook`                  quem paga com Stone
 *   2. `api/payments/stone/[orderId]/mark-paid`      a saída manual do Stone
 *   3. `api/payments/mercadopago/[orderId]/mark-paid` a saída manual do MP
 *   4. `api/orders/[id]/confirm-manual-payment`      ⚠️ a pior das cinco
 *   5. `WhatsAppOrderCreationService`                pedido por texto no WhatsApp
 *
 * A quarta é a pior porque é exatamente a alavanca que o lojista puxa QUANDO o
 * pagamento não confirmou sozinho: o momento em que ele mais precisa que o papel
 * saia é o momento em que o papel nunca saía.
 *
 * A quinta não estava na lista do raio-x. Apareceu ao recensear, aqui, todo
 * ponto do código que escreve `status: "CONFIRMED"` em `order` — é a razão de
 * existir o `CensoDosCaminhosQueConfirmam.test.ts` ao lado deste arquivo.
 *
 * ─── POR QUE UM MÓDULO, e não cinco linhas coladas cinco vezes ──────────────
 * Porque a regra tem uma exceção, e exceção copiada é exceção que diverge:
 * pagamento confirmado num pedido CANCELADO **não** vira papel na cozinha. Um
 * lugar só para a regra é um lugar só para testá-la, e um lugar só para o dia em
 * que ela mudar.
 *
 * ─── O QUE ESTE MÓDULO NÃO FAZ, de propósito ────────────────────────────────
 * Não emite NFC-e. Os mesmos cinco caminhos também deixam de chamar
 * `FiscalEmissionService.maybeEmitForOrder`, e é o mesmo defeito — mas a
 * numeração da NFC-e ainda colide sob concorrência (raio-x de 06/09: o número
 * 104 saiu nove vezes em 20 reservas simultâneas, sem índice único no banco).
 * Ligar a emissão em cinco portas novas antes de consertar a numeração criaria
 * um problema fiscal, difícil de desfazer, para resolver um problema fiscal.
 * Fica para o conserto da numeração, e está registrado em `docs/pendencias.md`.
 */

import { PrintQueueService } from "./PrintQueueService";

/**
 * Estados em que a cozinha ainda tem trabalho com este pedido. Fora daqui —
 * CANCELLED, DELIVERED, READY, OUT_FOR_DELIVERY — o pagamento pode ser
 * reconciliado, mas mandar papel para a cozinha seria pedir comida de novo.
 */
const AINDA_PRECISA_DE_COMANDA = new Set([
  "PENDING",
  "AWAITING_PAYMENT",
  "CONFIRMED",
  "PREPARING",
]);

export function pedidoAindaPrecisaDeComanda(statusDoPedido: string): boolean {
  return AINDA_PRECISA_DE_COMANDA.has(statusDoPedido);
}

/**
 * Enfileira a comanda de um pedido cujo pagamento acabou de ser confirmado.
 *
 * Dispara e segue (o cliente não espera a impressora) e é idempotente por
 * construção: `maybeEnqueueOrder` carimba `printQueuedAt` num `updateMany`
 * atômico, então chamar duas vezes não gera papel em dobro.
 *
 * @param statusDoPedido o status do pedido ANTES desta confirmação — é o que o
 *   chamador tem em mãos, e é o que distingue "pedido vivo" de "pedido morto".
 * @param origem aparece no log; o alerta precisa carregar a própria evidência.
 */
export function enfileirarComandaDoPagamento(entrada: {
  restaurantId: string;
  orderId: string;
  statusDoPedido: string;
  origem: string;
}): void {
  const { restaurantId, orderId, statusDoPedido, origem } = entrada;

  if (!pedidoAindaPrecisaDeComanda(statusDoPedido)) {
    console.info("[print] pagamento confirmado em pedido que não precisa mais de comanda", {
      origem, restaurantId, orderId, statusDoPedido,
    });
    return;
  }

  void PrintQueueService.maybeEnqueueOrder(restaurantId, orderId).catch((e) =>
    console.error(`[print] ${origem} enqueue failed:`, e),
  );
}
