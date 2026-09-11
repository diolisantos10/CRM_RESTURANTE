/**
 * DIAGNOSTICAR LEADS TRAVADOS — só lê, nunca escreve.
 *
 * ── O QUE ISTO RESPONDE ──────────────────────────────────────────────────────
 *
 * Uma rodada de prospecção materializou `SiteLead`s e não mandou mensagem
 * nenhuma — zero `LeadMensagem`, zero `wamid`, HTTP 200. O caminho de envio
 * (`abordarLead`) tem quatro travas antes de gravar qualquer coisa; a
 * primeira que recusa em silêncio (`abordarDaFila.ts`: `portaoRecusou` e
 * `semDadoParaOModelo` são pulados, sem teto) é quem explica o formato do
 * incidente. A causa LITERAL — qual trava recusou, e com que motivo exato,
 * para CADA lead — só se mede contra o banco de verdade.
 *
 * Este script chama `diagnosticarAbordagem` — a MESMA leitura que
 * `abordarLead` faria, sem os passos que escrevem (`registrarSaida`,
 * `enviarModeloDeVendas`) — para cada id que você passar, e imprime o motivo
 * exato. Nada é alterado no banco.
 *
 * ── USO (local, ou com DATABASE_URL de produção JÁ NO AMBIENTE) ────────────
 *
 * A `DATABASE_URL` nunca é digitada aqui nem pedida a quem roda — ela já
 * precisa estar no ambiente de quem chama (ex.: `railway run`).
 *
 *   npx tsx scripts/diagnosticar-leads-travados.ts <leadId> [<leadId> ...]
 *
 *   ou, com a lista num ambiente/CI:
 *
 *   LEAD_IDS="id1,id2,id3" npx tsx scripts/diagnosticar-leads-travados.ts
 *
 * ⛔ NUNCA descobre leads sozinho. Não existe aqui nenhum `findMany` sobre a
 * base inteira — a lista de ids é sempre explícita, de quem chama. Para achar
 * QUAIS ids materializaram sem mensagem, use
 * `leadsMaterializadosSemMensagem` (`src/services/salaDeVendas/prospeccao/retentativa.ts`)
 * a partir de uma sessão com acesso ao banco — este script só diagnostica os
 * que já foram apontados.
 */

import { PrismaClient } from "@prisma/client";
import { diagnosticarAbordagem } from "../src/services/salaDeVendas/abordar";

const prisma = new PrismaClient();

function p(t = "") {
  console.log(t);
}

function idsDoChamador(): string[] {
  const doArgv = process.argv.slice(2).map((s) => s.trim()).filter(Boolean);
  if (doArgv.length > 0) return doArgv;

  return (process.env.LEAD_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const ids = idsDoChamador();

  if (ids.length === 0) {
    p("Uso: npx tsx scripts/diagnosticar-leads-travados.ts <leadId> [<leadId> ...]");
    p('  ou: LEAD_IDS="id1,id2,id3" npx tsx scripts/diagnosticar-leads-travados.ts');
    p("\nNenhum id recebido — nada foi consultado.");
    process.exitCode = 1;
    return;
  }

  p(`\n═══ DIAGNÓSTICO — ${ids.length} lead(s), somente leitura ═══`);

  const agora = new Date();
  let prontos = 0;
  let recusados = 0;

  for (const leadId of ids) {
    const r = await diagnosticarAbordagem(prisma, { leadId, agora });

    if (r.pronto) {
      prontos += 1;
      p(`\n✅ ${leadId}`);
      p(`   pronto para abordar — ${r.quantas} variável(is): ${r.parametros.join(" · ") || "(nenhuma)"}`);
      continue;
    }

    recusados += 1;
    p(`\n⛔ ${leadId}`);
    switch (r.motivo) {
      case "leadNaoExiste":
        p(`   motivo: leadNaoExiste`);
        p(`   detalhe: nenhum SiteLead com este id`);
        break;
      case "portaoRecusou":
        p(`   motivo: portaoRecusou (${r.razao ?? "sem motivo declarado"})`);
        p(`   detalhe: ${r.detalhe}`);
        break;
      case "semDadoParaOModelo":
        p(`   motivo: semDadoParaOModelo`);
        p(`   modelo exige ${r.quantas} variável(is); faltando: ${r.camposFaltando.join(", ") || "(nenhum listado)"}`);
        p(`   detalhe: ${r.detalhe}`);
        break;
    }
  }

  p(`\n═══ RESUMO — ${prontos} pronto(s) · ${recusados} recusado(s) de ${ids.length} ═══`);
  p("\n✅ Somente leitura. Nada foi alterado.");
}

main()
  .catch((e) => {
    console.error("❌", e instanceof Error ? (e.stack ?? e.message) : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
