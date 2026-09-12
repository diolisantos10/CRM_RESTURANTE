/**
 * O INTERRUPTOR DA SUPERVISORA — chave mestra + modo, e o histórico de troca.
 *
 * ── A MESMA SEPARAÇÃO DE `SdrIaConfig.ligado` ───────────────────────────────
 *
 * `ligada` é o desligamento de emergência: `false` e nenhuma chamada acontece,
 * custo e latência zero — igual a `modo = OFF`, só que alcançável sem trocar o
 * modo (que carrega intenção: "queríamos SHADOW, só pausamos"). `modo` é o que
 * decide o que a Supervisora FAZ enquanto está ligada.
 *
 * ── ⛔ O CÓDIGO NUNCA PROMOVE MODO SOZINHO ───────────────────────────────────
 *
 * Todo caminho de leitura deste arquivo é passivo. A única escrita
 * (`alterarModo`) é chamada pela rota administrativa, que já checou o papel de
 * quem pediu — este arquivo não sabe quem está pedindo, só grava o que chegou.
 * Ele nasce com `modo = SHADOW` (o default do schema) e SHADOW é o único modo
 * de estreia aceitável em produção — GUARD/INTERVENTION exigem alguém decidir.
 */

import type { PrismaClient, Prisma, ModoDaSupervisora } from "@prisma/client";

type Cliente = PrismaClient | Prisma.TransactionClient;

export interface EstadoDaSupervisora {
  ligada: boolean;
  modo: ModoDaSupervisora;
  /** `ligada ? modo : "OFF"` — o que de fato vale para o turno agora. */
  modoEfetivo: ModoDaSupervisora;
  atualizadoPor: string | null;
  atualizadoEm: Date;
}

const PADRAO: EstadoDaSupervisora = {
  ligada: true,
  modo: "SHADOW",
  modoEfetivo: "SHADOW",
  atualizadoPor: null,
  atualizadoEm: new Date(0),
};

/**
 * Lê o estado. **Nunca escreve** — a linha singleton nasce no primeiro
 * `alterarModo`, e uma leitura que criasse a linha esconderia a primeira troca
 * de modo real dentro de um efeito colateral de GET.
 *
 * Sem linha ainda: devolve o padrão do schema (`ligada: true, modo: SHADOW`),
 * que é exatamente o que o schema gravaria se a linha existisse — a ausência de
 * configuração não é "desligado", é "ainda não decidiram nada, e o padrão vale".
 */
export async function lerConfig(db: Cliente): Promise<EstadoDaSupervisora> {
  const c = await db.supervisoraConfig.findUnique({ where: { id: "singleton" } });
  if (!c) return PADRAO;

  return {
    ligada: c.ligada,
    modo: c.modo,
    modoEfetivo: c.ligada ? c.modo : "OFF",
    atualizadoPor: c.atualizadoPor,
    atualizadoEm: c.atualizadoEm,
  };
}

/** Only para quem já leu o estado e só precisa da régua efetiva. */
export function modoEfetivo(estado: { ligada: boolean; modo: ModoDaSupervisora }): ModoDaSupervisora {
  return estado.ligada ? estado.modo : "OFF";
}

export type ResultadoDeAlterarModo =
  | { ok: true; modoAnterior: ModoDaSupervisora; modoNovo: ModoDaSupervisora }
  | { ok: false; causa: "semAlteradoPor" };

/**
 * Troca o modo (ou a chave mestra), com o histórico gravado.
 *
 * ── ⚠️ ESTA FUNÇÃO NÃO AUTORIZA NINGUÉM ──────────────────────────────────────
 *
 * Quem decide SE a pessoa pode chamar isto é a rota
 * (`/api/admin/sala-de-vendas/supervisora`), com o mesmo padrão de
 * `vePelaOperacaoToda`. Esta função confia em `alteradoPor` porque quem a chama
 * já verificou a sessão — chamá-la direto, sem porta na frente, é o erro que a
 * separação rota/serviço existe para impedir enxergar tarde.
 */
export async function alterarModo(
  db: Cliente,
  params: {
    novoModo?: ModoDaSupervisora;
    novaLigada?: boolean;
    alteradoPor: string;
    motivo?: string | null;
    agora?: Date;
  },
): Promise<ResultadoDeAlterarModo> {
  const alteradoPor = params.alteradoPor?.trim();
  if (!alteradoPor) return { ok: false, causa: "semAlteradoPor" };

  const agora = params.agora ?? new Date();

  // ⚠️ Sequencial, não `$transaction`: `db` aqui pode já ser um
  // `Prisma.TransactionClient` passado por quem chama (que não abre uma
  // transação dentro da outra) — o mesmo motivo por que `handoff.ts` faz suas
  // duas escritas condicionais em sequência, e não dentro de um `$transaction`.
  // A janela entre as duas escritas não é uma corrida real: no pior caso, duas
  // trocas de modo quase simultâneas produzem duas linhas de histórico
  // corretas, uma para cada troca — nunca um estado inconsistente.
  const atual = await db.supervisoraConfig.findUnique({ where: { id: "singleton" } });
  const modoAnterior = atual ? modoEfetivo(atual) : PADRAO.modoEfetivo;

  const novaLigada = params.novaLigada ?? atual?.ligada ?? PADRAO.ligada;
  const novoModo = params.novoModo ?? atual?.modo ?? PADRAO.modo;
  const modoNovo = novaLigada ? novoModo : "OFF";

  const config = await db.supervisoraConfig.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      ligada: novaLigada,
      modo: novoModo,
      atualizadoPor: alteradoPor,
    },
    update: {
      ligada: novaLigada,
      modo: novoModo,
      atualizadoPor: alteradoPor,
    },
  });

  // Só grava histórico quando algo de fato mudou — trocar "SHADOW" por
  // "SHADOW" de novo não é uma decisão, é um clique perdido, e não deveria
  // aparecer na trilha como se fosse uma.
  if (modoAnterior !== modoNovo) {
    await db.supervisoraModoHistorico.create({
      data: {
        configId: config.id,
        modoAnterior,
        modoNovo,
        alteradoPor,
        motivo: params.motivo?.trim() || null,
        alteradoEm: agora,
      },
    });
  }

  return { ok: true, modoAnterior, modoNovo };
}

export interface TrocaDeModo {
  modoAnterior: ModoDaSupervisora;
  modoNovo: ModoDaSupervisora;
  alteradoPor: string;
  motivo: string | null;
  alteradoEm: Date;
}

export async function historicoDeModo(
  db: Cliente,
  params: { limite?: number } = {},
): Promise<TrocaDeModo[]> {
  const linhas = await db.supervisoraModoHistorico.findMany({
    orderBy: { alteradoEm: "desc" },
    take: params.limite ?? 20,
  });

  return linhas.map((l) => ({
    modoAnterior: l.modoAnterior,
    modoNovo: l.modoNovo,
    alteradoPor: l.alteradoPor,
    motivo: l.motivo,
    alteradoEm: l.alteradoEm,
  }));
}
