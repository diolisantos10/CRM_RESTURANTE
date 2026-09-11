/** Comercial → Prospecção: receber/enriquecer, o interruptor, a Base fria e a fila automática. */

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
