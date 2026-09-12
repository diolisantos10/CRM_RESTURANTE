/**
 * PROVA DO ITEM 6 DA AUDITORIA (12/09/2026) — `publicarVersaoExistente` É
 * ATÔMICA, DE VERDADE, CONTRA POSTGRES REAL.
 *
 * ── O QUE ESTE ARQUIVO PROVA, E POR QUE PRECISA DE BANCO DE VERDADE ─────────
 *
 * `publicarVersaoExistente` (`src/services/salaDeVendas/ta/interruptor.ts`)
 * faz duas escritas — marcar a versão nova como `PUBLICADA` e apontar
 * `SdrIaConfig.versaoAtivaId` para ela. Até 12/09/2026 elas eram sequenciais,
 * fora de transação: se a SEGUNDA falhasse depois que a PRIMEIRA já tivesse
 * comitado, o banco ficava com uma versão `PUBLICADA` que o TA não estava
 * usando — estado parcial de verdade, não hipotético.
 *
 * Um dublê de banco (objeto comum, sem transação real) não consegue provar
 * isto: "a primeira escrita não persiste" só é uma afirmação verdadeira
 * quando existe um `ROLLBACK` de verdade por trás dela. Por isso este arquivo
 * mora nas jornadas (Postgres real), e não na bateria unitária.
 *
 * ── COMO A FALHA "ENTRE AS DUAS OPERAÇÕES" É FORÇADA ────────────────────────
 *
 * Um `Proxy` em cima do `PrismaClient` real intercepta só o `$transaction` e,
 * dentro dele, só `sdrIaConfig.update` (a SEGUNDA escrita) — fazendo-a lançar.
 * `sdrIaConfigVersao.update` (a PRIMEIRA) roda de verdade, contra o banco de
 * verdade, dentro da MESMA transação real que o Prisma abre. Se o código sob
 * teste envolve as duas num único `$transaction`, o Postgres desfaz a
 * primeira escrita sozinho quando a segunda lança — e é isso que o teste lê de
 * volta, com uma conexão nova, depois que a chamada terminou.
 *
 * ⚠️ Nenhuma mensagem sai: este arquivo nem toca `lead_mensagens`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { publicarVersaoExistente } from "@/services/salaDeVendas/ta/interruptor";

const prisma = new PrismaClient();

function envolverModeloConfigComFalha(modeloReal: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(modeloReal, {
    get(mAlvo, mProp, mReceptor) {
      if (mProp === "update") {
        return () => {
          throw new Error(
            "falha injetada de propósito (teste de atomicidade) — a segunda escrita nunca deveria persistir sem a primeira",
          );
        };
      }
      return Reflect.get(mAlvo, mProp, mReceptor);
    },
  });
}

/**
 * Envolve um `PrismaClient` real para que `sdrIaConfig.update` (a SEGUNDA
 * escrita) sempre lance — tanto se for chamada DIRETO no cliente (o jeito do
 * código antes do conserto, sem transação nenhuma) quanto se for chamada
 * DENTRO de uma transação (o jeito depois do conserto). O resto — incluindo
 * `sdrIaConfigVersao.update`, a PRIMEIRA escrita — passa direto para o
 * cliente real, dentro da mesma transação real quando houver uma.
 *
 * Interceptar as duas formas é o que torna este dublê útil como CONTROLE
 * NEGATIVO: contra o código de ANTES do conserto (sem `$transaction`), a
 * primeira escrita acontece e FICA — não há nada para desfazê-la — provando
 * o estado parcial. Contra o código depois do conserto, a mesma falha cai
 * dentro da transação, e o Postgres desfaz a primeira escrita sozinho.
 */
function comFalhaInjetadaNaSegundaEscrita(db: PrismaClient): PrismaClient {
  return new Proxy(db, {
    get(alvo, prop, receptor) {
      if (prop === "sdrIaConfig") {
        return envolverModeloConfigComFalha(Reflect.get(alvo, prop, receptor) as Record<string, unknown>);
      }
      if (prop === "$transaction") {
        return (fn: (tx: unknown) => unknown) =>
          (Reflect.get(alvo, prop, receptor) as PrismaClient["$transaction"]).call(alvo, (tx: unknown) => {
            const txComFalha = new Proxy(tx as object, {
              get(txAlvo, txProp, txReceptor) {
                if (txProp === "sdrIaConfig") {
                  return envolverModeloConfigComFalha(Reflect.get(txAlvo, txProp, txReceptor) as Record<string, unknown>);
                }
                return Reflect.get(txAlvo, txProp, txReceptor);
              },
            });
            return fn(txComFalha);
          });
      }
      return Reflect.get(alvo, prop, receptor);
    },
  }) as PrismaClient;
}

beforeAll(async () => {
  await prisma.sdrIaConfigVersao.deleteMany({ where: { config: { slug: "ta-jornada-atomicidade" } } });
  await prisma.sdrIaConfig.deleteMany({ where: { slug: "ta-jornada-atomicidade" } });
});

afterAll(async () => {
  await prisma.sdrIaConfigVersao.deleteMany({ where: { config: { slug: "ta-jornada-atomicidade" } } });
  await prisma.sdrIaConfig.deleteMany({ where: { slug: "ta-jornada-atomicidade" } });
  await prisma.$disconnect();
});

describe("Item 6 — publicarVersaoExistente é atômica", () => {
  it("⭐ uma falha na SEGUNDA escrita desfaz a PRIMEIRA — nenhum estado parcial", async () => {
    const config = await prisma.sdrIaConfig.create({
      data: { slug: "ta-jornada-atomicidade", nome: "TA (jornada de atomicidade)", ligado: false },
    });
    const versaoAntiga = await prisma.sdrIaConfigVersao.create({
      data: {
        configId: config.id,
        numero: 1,
        situacao: "PUBLICADA",
        identidade: "versão antiga",
      },
    });
    await prisma.sdrIaConfig.update({ where: { id: config.id }, data: { versaoAtivaId: versaoAntiga.id } });

    const versaoNova = await prisma.sdrIaConfigVersao.create({
      data: {
        configId: config.id,
        numero: 2,
        situacao: "RASCUNHO",
        identidade: "versão nova, ainda não publicada",
      },
    });

    const dbComFalha = comFalhaInjetadaNaSegundaEscrita(prisma);

    await expect(
      publicarVersaoExistente(dbComFalha, {
        configSlug: "ta-jornada-atomicidade",
        versaoId: versaoNova.id,
        porUserId: null,
      }),
    ).rejects.toThrow(/falha injetada/);

    // ⭐ A PROVA: lida de volta com uma conexão que NÃO fez parte da transação
    // que falhou — se a primeira escrita tivesse persistido sozinha, a versão
    // nova apareceria aqui como PUBLICADA mesmo com o ponteiro não tendo
    // mudado. Ela tem que voltar exatamente como estava ANTES da chamada.
    const versaoNovaDepois = await prisma.sdrIaConfigVersao.findUniqueOrThrow({ where: { id: versaoNova.id } });
    expect(versaoNovaDepois.situacao).toBe("RASCUNHO");
    expect(versaoNovaDepois.publicadaEm).toBeNull();

    const configDepois = await prisma.sdrIaConfig.findUniqueOrThrow({ where: { id: config.id } });
    expect(configDepois.versaoAtivaId).toBe(versaoAntiga.id);

    // E a versão antiga não foi tocada por nenhuma das duas escritas.
    const versaoAntigaDepois = await prisma.sdrIaConfigVersao.findUniqueOrThrow({ where: { id: versaoAntiga.id } });
    expect(versaoAntigaDepois.situacao).toBe("PUBLICADA");
  });

  it("sem falha injetada, as duas escritas acontecem juntas normalmente", async () => {
    const config = await prisma.sdrIaConfig.create({
      data: { slug: "ta-jornada-atomicidade-ok", nome: "TA (jornada de atomicidade, caminho feliz)", ligado: false },
    });
    const versao = await prisma.sdrIaConfigVersao.create({
      data: { configId: config.id, numero: 1, situacao: "RASCUNHO", identidade: "versão única" },
    });

    const r = await publicarVersaoExistente(prisma, {
      configSlug: "ta-jornada-atomicidade-ok",
      versaoId: versao.id,
      porUserId: null,
    });

    expect(r).toMatchObject({ ok: true, numero: 1, eraAAtiva: false });

    const versaoDepois = await prisma.sdrIaConfigVersao.findUniqueOrThrow({ where: { id: versao.id } });
    expect(versaoDepois.situacao).toBe("PUBLICADA");

    const configDepois = await prisma.sdrIaConfig.findUniqueOrThrow({ where: { id: config.id } });
    expect(configDepois.versaoAtivaId).toBe(versao.id);

    await prisma.sdrIaConfigVersao.deleteMany({ where: { configId: config.id } });
    await prisma.sdrIaConfig.delete({ where: { id: config.id } });
  });
});
