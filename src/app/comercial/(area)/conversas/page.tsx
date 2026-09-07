/**
 * Comercial → Atendimento.
 *
 * A tela de quatro áreas do item 5 do comando. É onde o SDR passa o dia.
 *
 * ⭐ `?leadId=` abre um lead direto. É a porta que faltava: os cartões das
 * Filas e do Funil apontam para cá com o lead na mão, em vez de mostrarem um
 * lead que não se pode abrir. A justificativa inteira está no bloco de
 * `leadInicial`, em `AtendimentoClient`.
 */

import { Suspense } from "react";
import { AtendimentoClient } from "./AtendimentoClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Atendimento · Sala de Vendas" };

export default async function AtendimentoPage({
  searchParams,
}: {
  searchParams: Promise<{ leadId?: string | string[] }>;
}) {
  const sp = await searchParams;
  const bruto = Array.isArray(sp.leadId) ? sp.leadId[0] : sp.leadId;
  // ⚠️ Vazio vira `null`, e não string vazia: `useConversa("")` pediria a
  // conversa de um lead sem id, e a tela mostraria um erro que não é erro.
  const leadInicial = (bruto ?? "").trim() || null;

  return (
    <Suspense fallback={<div className="p-6 text-[13px] text-muted">Carregando…</div>}>
      <AtendimentoClient leadInicial={leadInicial} />
    </Suspense>
  );
}
