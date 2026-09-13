/** Comercial → Supervisora: a camada de revisão que acompanha todo agente. */

import { Suspense } from "react";
import { SupervisoraClient } from "./SupervisoraClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Supervisora" };

export default function SupervisoraPage() {
  return (
    <Suspense fallback={<div className="p-6 text-[13px] text-muted">Carregando…</div>}>
      <SupervisoraClient />
    </Suspense>
  );
}
