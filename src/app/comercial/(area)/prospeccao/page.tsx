/**
 * Comercial → Prospecção: a tela minimalista do CEO.
 *
 * Três blocos — importar, operação, aviso operacional — e uma seção
 * expansível com o funil por modelo. Ver o cabeçalho de `ProspeccaoClient.tsx`.
 */

import { Suspense } from "react";
import { ProspeccaoClient } from "./ProspeccaoClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Prospecção" };

export default function ProspeccaoPage() {
  return (
    <Suspense fallback={<div className="p-6 text-[13px] text-muted">Carregando…</div>}>
      <ProspeccaoClient />
    </Suspense>
  );
}
