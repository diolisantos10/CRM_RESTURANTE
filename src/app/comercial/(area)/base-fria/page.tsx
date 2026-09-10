/**
 * Comercial → Base fria. O estoque contínuo de contatos que ainda não abordamos.
 *
 * A tela que substitui "vinte lotes mostrados como se fossem a base". Aqui a
 * base é uma só, paginada, e o lote volta a ser o que sempre deveria ter sido:
 * um detalhe de importação, não uma carteira separada que alguém precisa
 * liberar de uma em uma.
 */

import { Suspense } from "react";
import { BaseFriaClient } from "./BaseFriaClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Base fria · Sala de Vendas" };

export default function BaseFriaPage() {
  // `useSearchParams` exige fronteira de Suspense no App Router; sem ela a
  // página inteira vira renderização de cliente e o build reclama.
  return (
    <Suspense fallback={<div className="p-4 text-[13px] text-muted sm:p-6">Carregando…</div>}>
      <BaseFriaClient />
    </Suspense>
  );
}
