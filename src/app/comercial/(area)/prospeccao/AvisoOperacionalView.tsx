"use client";

/**
 * AVISO OPERACIONAL — bloco 3. Só aparece quando `avaliarAvisoOperacional`
 * (`avisoOperacional.ts`, testada isoladamente) encontra um problema real.
 * Sem problema, este componente não renderiza nada — inclusive nenhum
 * "tudo certo" decorativo, que só ocuparia espaço sem informar nada de novo.
 */

import type { AvisoOperacional } from "./avisoOperacional";

export function AvisoOperacionalView({ aviso }: { aviso: AvisoOperacional | null }) {
  if (!aviso) return null;

  return (
    <section
      role="alert"
      className="rounded-2xl border border-amber-300 bg-amber-50 p-4"
    >
      <p className="text-[13.5px] font-semibold text-amber-900">Aviso operacional</p>
      <p className="mt-0.5 text-[13px] leading-relaxed text-amber-900">{aviso.titulo}</p>
      {aviso.detalhe && <p className="mt-1 text-[12px] leading-relaxed text-amber-800">{aviso.detalhe}</p>}
    </section>
  );
}
