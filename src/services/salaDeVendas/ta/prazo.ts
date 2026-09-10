/**
 * PRAZO — uma promessa com relógio.
 *
 * ── POR QUE EXISTE ──────────────────────────────────────────────────────────
 *
 * O TA fala com o modelo duas vezes por turno: para redigir (`cerebro.ts`) e
 * para etiquetar (`sondagem.ts`). Nenhuma das duas tinha teto de espera até
 * 09/09/2026. A primeira quebrava por outro motivo (transação de 5 s em volta),
 * e a segunda simplesmente PENDURAVA o turno: a resposta já tinha saído para o
 * cliente, mas a promessa do webhook ficava presa até o socket morrer.
 *
 * `Promise.race` com um relógio, e não `AbortSignal`: o contrato do motor não
 * aceita sinal, e este diretório não fala com o provedor por fora (Lei 1 do
 * Brain). O que a corrida garante é o que importa para quem espera: o TURNO
 * segue no prazo. A chamada perdida termina sozinha e o resultado é jogado
 * fora — e a rejeição dela é engolida para não virar `unhandledRejection`.
 *
 * O relógio é limpo nos dois desfechos, para não pendurar o processo nem o
 * teste.
 */
export async function comPrazo<T>(promessa: Promise<T>, prazoMs: number): Promise<T | null> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const estourou = new Promise<null>((resolve) => {
    relogio = setTimeout(() => resolve(null), prazoMs);
  });

  // Quem descarta a promessa perdida assume o `catch` dela.
  promessa.catch(() => null);

  try {
    return await Promise.race([promessa, estourou]);
  } finally {
    if (relogio) clearTimeout(relogio);
  }
}
