/**
 * Corrige somente o espelho textual das 20 abordagens do incidente de
 * 11/09/2026. Não chama a Meta e não envia mensagem.
 *
 * Uso:
 *   npx tsx scripts/corrigir-texto-integral-20-abordagens.ts
 *   CORRIGIR_TEXTO_INTEGRAL_HABILITADO=sim npx tsx scripts/corrigir-texto-integral-20-abordagens.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  modeloConfigurado,
  montarParametros,
  renderizarCorpoDoModelo,
} from "@/services/salaDeVendas/abordar";
import { modeloAprovadoDaSala } from "@/services/foocci-sdr/sincronizarModelos";

const LEAD_IDS = [
  "cmtxbhtdv006t5vhkxyiz1xuz", "cmtxbhtgk006u5vhkdhsw0dfo",
  "cmtxbhtir006v5vhk5zhjt1pp", "cmtxbhtl6006w5vhk1kmf6p8s",
  "cmtxbhtnm006x5vhkeqz5ontd", "cmtxbhtpp006y5vhkidqjiqoz",
  "cmtxbhtrz006z5vhkwgzyb373", "cmtxbhtu300705vhks7lanttd",
  "cmtxbhtwq00715vhkcetmu9by", "cmtxbhtyt00725vhkz4c1ev2z",
  "cmtxbhu0x00735vhkamhajz1q", "cmtxbhu3700745vhk3gppyc7i",
  "cmtxbhu5a00755vhkkxnxt02q", "cmtxbhu8300765vhk1c2v9mqp",
  "cmtxbhua600775vhkwq527zwt", "cmtxbhuc700785vhk0zl53aih",
  "cmtxbhueb00795vhk0s1movnc", "cmtxbhuh3007a5vhkf8544tog",
  "cmtxbhuig007b5vhk1xi5w171", "cmtxbhuju007c5vhk7j8hpe6a",
] as const;

const prisma = new PrismaClient();

async function executar(): Promise<void> {
  const mensagens = await prisma.leadMensagem.findMany({
    where: {
      leadId: { in: [...LEAD_IDS] },
      direcao: "SAIDA",
      waMessageId: { startsWith: "wamid." },
    },
    select: {
      id: true,
      leadId: true,
      texto: true,
      templateNome: true,
      lead: { select: { nome: true, restaurante: true, fonte: true, cidade: true } },
    },
    orderBy: { ocorreuEm: "asc" },
  });

  const idsEncontrados = new Set(mensagens.map((m) => m.leadId));
  if (mensagens.length !== 20 || idsEncontrados.size !== 20) {
    throw new Error(
      `escopo recusado: esperava 20 mensagens reais de 20 leads; encontrei ${mensagens.length} de ${idsEncontrados.size}`,
    );
  }

  const cfg = modeloConfigurado();
  const modelo = await modeloAprovadoDaSala(prisma, cfg.nome, cfg.idioma);
  if (!modelo?.corpo) throw new Error("modelo aprovado sem corpo integral persistido");

  const correcoes: Array<{ id: string; leadId: string; antes: string | null; depois: string }> = [];
  for (const mensagem of mensagens) {
    if (mensagem.templateNome !== modelo.nome) {
      throw new Error(`modelo divergente na mensagem ${mensagem.id}: ${mensagem.templateNome ?? "sem nome"}`);
    }

    const item = await prisma.itemDeProspeccao.findFirst({
      where: { leadId: mensagem.leadId },
      orderBy: { criadoEm: "desc" },
      select: { lote: { select: { proveniencia: true } } },
    });
    const parametros = montarParametros(modelo.variaveis, {
      ...mensagem.lead,
      proveniencia: item?.lote.proveniencia ?? null,
    });
    if (!parametros.ok) throw new Error(`lead ${mensagem.leadId}: ${parametros.falta}`);

    const renderizado = renderizarCorpoDoModelo(modelo.corpo, parametros.parametros);
    if (!renderizado.ok) throw new Error(`lead ${mensagem.leadId}: ${renderizado.falta}`);
    correcoes.push({
      id: mensagem.id,
      leadId: mensagem.leadId,
      antes: mensagem.texto,
      depois: renderizado.texto,
    });
  }

  console.log(JSON.stringify({ modo: "conferir", mensagens: correcoes.length, textosTecnicos: correcoes.filter((c) => c.antes?.startsWith("[modelo:")).length }));
  if (process.env.CORRIGIR_TEXTO_INTEGRAL_HABILITADO !== "sim") return;

  await prisma.$transaction(
    correcoes.map((c) => prisma.leadMensagem.update({ where: { id: c.id }, data: { texto: c.depois } })),
  );

  const restantes = await prisma.leadMensagem.count({
    where: {
      id: { in: correcoes.map((c) => c.id) },
      texto: { startsWith: "[modelo:" },
    },
  });
  if (restantes !== 0) throw new Error(`pós-condição falhou: ${restantes} textos técnicos restantes`);
  console.log(JSON.stringify({ modo: "corrigir", corrigidas: correcoes.length, textosTecnicosRestantes: restantes, reenviadas: 0 }));
}

executar()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
