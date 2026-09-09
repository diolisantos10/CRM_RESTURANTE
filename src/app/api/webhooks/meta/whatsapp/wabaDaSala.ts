/**
 * O ID DA CONTA (WABA) DA SALA, LIDO DO ENVELOPE DO WEBHOOK.
 *
 * ⚠️ POR QUE ESTE ARQUIVO É SEPARADO DA ROTA — medido em 09/09/2026, custou um
 * deploy vermelho. A função nasceu exportada dentro de `route.ts` e o CI passou:
 * type-check verde, testes verdes. O `next build` recusou:
 *
 *   Type error: Route "src/app/api/webhooks/meta/whatsapp/route.ts" does not
 *   match the required types of a Next.js Route.
 *   "wabasDaSalaNoEnvelope" is not a valid Route export field.
 *
 * Arquivo de rota do Next só exporta handler. E a lição vale além do Next:
 * **portão verde que não atravessa o mesmo caminho da produção aprova o que a
 * produção recusa.** O CI daqui não roda `next build`; foi o deploy que mediu.
 * Ausência de alarme não é sinal de saúde — de novo, e desta vez comigo.
 */

/**
 * Os ids de conta (WABA) que este envelope traz PARA O NOSSO NÚMERO DE VENDAS.
 *
 * Exportada e pura de propósito: é a única parte que tem regra, e ela precisa ser
 * testável sem montar um webhook inteiro. A peça que descobre um dado não pode
 * exigir uma chamada real para ser conferida — foi essa a lição de 08/09/2026,
 * quando a conferência que existia para economizar contato só rodava gastando três.
 *
 * Devolve vazio quando o número de vendas não está configurado, quando a
 * notificação é de outro número, ou quando o envelope não tem `id` — nunca joga.
 */
export function wabasDaSalaNoEnvelope(payload: unknown, numeroDeVendas: string | null): string[] {
  if (!numeroDeVendas) return [];
  const envelope = payload as {
    entry?: Array<{ id?: unknown; changes?: Array<{ value?: { metadata?: { phone_number_id?: unknown } } }> }>;
  };
  const achados: string[] = [];
  for (const e of envelope?.entry ?? []) {
    const daSala = (e?.changes ?? []).some(
      (c) => String(c?.value?.metadata?.phone_number_id ?? "") === numeroDeVendas,
    );
    const id = e?.id != null ? String(e.id).trim() : "";
    if (daSala && id && !achados.includes(id)) achados.push(id);
  }
  return achados;
}
