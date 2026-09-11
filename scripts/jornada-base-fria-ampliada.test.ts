/**
 * A JORNADA DA BASE FRIA AMPLIADA, CONTRA POSTGRES DE VERDADE — 11/09/2026.
 *
 * ── O QUE ESTA ENTREGA MUDOU, E O QUE ESTA JORNADA PROVA ────────────────────
 *
 * Catorze campos novos em `ItemDeProspeccao` (migração aditiva), a operação
 * por lotes removida (nenhuma importação depende mais de "liberar"), e a
 * transferência dos campos com equivalente para `SiteLead`/`LeadQualificacao`
 * quando o contato frio vira lead. Cada uma dessas três coisas só se prova
 * contra o banco real:
 *
 *   1. A migração é ADITIVA — dados de uma linha "antiga" (só os seis campos
 *      originais) sobrevivem intactos depois dela rodar.
 *   2. Uma importação com os vinte campos entra, fica elegível NA HORA (sem
 *      nenhum "liberar"), e os catorze novos ficam gravados.
 *   3. Materializar transfere email/tags para `SiteLead` e
 *      unidades/canais/observações para `LeadQualificacao` — só quando há
 *      algo para transferir.
 *
 * ⚠️ Nenhuma mensagem sai: dados sintéticos, canal desligado.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { importarLote } from "@/services/salaDeVendas/prospeccao/lote";
import { montarFilaDeProspeccao, materializarLead } from "@/services/salaDeVendas/prospeccao/selecao";
import { lerPlanilha } from "@/services/salaDeVendas/prospeccao/lerPlanilha";

const AGORA = new Date("2026-09-02T17:00:00Z");

beforeAll(async () => {
  await prisma.leadQualificacao.deleteMany({});
  await prisma.itemDeProspeccao.deleteMany({});
  await prisma.loteDeProspeccao.deleteMany({});
  await prisma.prospeccaoConfig.deleteMany({});
  await prisma.siteLead.deleteMany({ where: { whatsappDigits: { startsWith: "551196" } } });
  await prisma.prospeccaoConfig.create({
    data: { id: "singleton", outboundLigado: true, limiteDiario: 2000, atualizadoPor: "jornada-ci" },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Jornada — a migração é aditiva", () => {
  it("⭐ uma linha gravada ANTES da migração (só os seis campos originais) sobrevive intacta", async () => {
    // Simula um item "legado": criado sem tocar em nenhum dos catorze campos
    // novos — exatamente como toda linha gravada antes de 11/09/2026 está no
    // banco de produção agora. Se a migração fosse destrutiva ou renomeasse
    // algo, esta gravação já teria falhado ou o item abaixo viria diferente.
    const lote = await prisma.loteDeProspeccao.create({
      data: { nome: "Lote legado da jornada", proveniencia: "Lista antiga, pré-ampliação" },
    });
    const legado = await prisma.itemDeProspeccao.create({
      data: {
        loteId: lote.id,
        nome: "Contato Legado",
        whatsapp: "11955560001",
        whatsappDigits: "5511955560001",
        empresa: "Empresa Legada",
        cidade: "Curitiba",
        estado: "PR",
        tipo: "Pizzaria",
      },
    });

    // Os catorze campos novos vêm com o DEFAULT do schema — nunca um erro,
    // nunca um valor inventado.
    expect(legado.email).toBeNull();
    expect(legado.cargo).toBeNull();
    expect(legado.cnpj).toBeNull();
    expect(legado.canaisAtuais).toEqual([]);
    expect(legado.tags).toEqual([]);
    expect(legado.numeroDeUnidades).toBeNull();

    // E os seis campos originais continuam exatamente como foram gravados.
    const relido = await prisma.itemDeProspeccao.findUniqueOrThrow({ where: { id: legado.id } });
    expect(relido).toMatchObject({
      nome: "Contato Legado",
      empresa: "Empresa Legada",
      cidade: "Curitiba",
      estado: "PR",
      tipo: "Pizzaria",
    });
  });
});

describe("Jornada — os vinte campos, importados e elegíveis na hora", () => {
  it("⭐ CSV com os vinte campos entra, fica PENDENTE sem nenhum 'liberar', e os catorze novos são gravados", async () => {
    const csv =
      "nome,cargo,empresa,tipo,telefone,telefone secundario,email,cidade,estado,bairro,endereco,cep,cnpj,instagram,site,maps,unidades,canais,observacoes,tags\n" +
      "Marina Sócia,Sócia-proprietária,Cantina da Marina,Italiana,11955560002,1140028922," +
      "marina@cantina.com.br,Curitiba,PR,Batel,Rua das Flores 123,80420-000,12345678000199," +
      "@cantinadamarina,cantinadamarina.com.br,https://maps.google.com/?q=cantina,3," +
      "\"iFood, Rappi\",Já usa sistema concorrente,\"vip, quente\"\n";

    const leitura = lerPlanilha(csv);
    expect(leitura.linhas).toHaveLength(1);
    const linha = leitura.linhas[0]!;

    // ⭐ O mapeamento automático (por cabeçalho) já reconhece os vinte —
    // achado #4 da entrega: "reconhecer variações de cabeçalho".
    expect(linha).toMatchObject({
      nome: "Marina Sócia",
      cargo: "Sócia-proprietária",
      empresa: "Cantina da Marina",
      tipo: "Italiana",
      telefoneSecundario: "1140028922",
      email: "marina@cantina.com.br",
      bairro: "Batel",
      endereco: "Rua das Flores 123",
      cep: "80420-000",
      cnpj: "12345678000199",
      instagram: "@cantinadamarina",
      site: "cantinadamarina.com.br",
      googleMapsUrl: "https://maps.google.com/?q=cantina",
      numeroDeUnidades: 3,
      canaisAtuais: ["iFood", "Rappi"],
      observacoes: "Já usa sistema concorrente",
      tags: ["vip", "quente"],
    });

    const r = await importarLote(prisma, {
      nome: "Jornada Base Ampliada",
      proveniencia: "Lista sintética da jornada de CI.",
      criadoPor: "jornada-ci",
      linhas: leitura.linhas,
    });
    expect(r.aceitas).toBe(1);

    // ⭐⭐ NENHUMA liberação — nem `liberarLote` (que nem existe mais), nem
    // qualquer clique. `importarLote` já entrega elegível.
    const fila = await montarFilaDeProspeccao(prisma, { canalPronto: true, agora: AGORA });
    const candidato = fila.liberados.find((c) => c.whatsapp === "11955560002");
    expect(candidato, "o contato não apareceu elegível sem nenhuma liberação").toBeTruthy();

    const gravado = await prisma.itemDeProspeccao.findFirst({
      where: { whatsappDigits: "5511955560002" },
    });
    expect(gravado).toMatchObject({
      cargo: "Sócia-proprietária",
      cnpj: "12345678000199",
      instagram: "@cantinadamarina",
      numeroDeUnidades: 3,
      canaisAtuais: ["iFood", "Rappi"],
      tags: ["vip", "quente"],
    });
  });
});

describe("Jornada — materializar transfere os campos com equivalente para o CRM", () => {
  it("⭐ email e tags vão para SiteLead; unidades, canais e observações viram LeadQualificacao", async () => {
    const item = await prisma.itemDeProspeccao.findFirstOrThrow({
      where: { whatsappDigits: "5511955560002" },
    });

    const m = await materializarLead(prisma, item.id);
    expect(m.materializado).toBe(true);
    if (!m.materializado) throw new Error("não materializou");

    const lead = await prisma.siteLead.findUniqueOrThrow({ where: { id: m.leadId } });
    expect(lead.email).toBe("marina@cantina.com.br");
    expect(lead.tags).toEqual(["vip", "quente"]);
    expect(lead.restaurante).toBe("Cantina da Marina");
    // Nunca nasce com consentimento — regra que já existia, intacta.
    expect(lead.consentAt).toBeNull();

    const qualificacao = await prisma.leadQualificacao.findUnique({ where: { leadId: m.leadId } });
    expect(qualificacao).not.toBeNull();
    expect(qualificacao?.unidades).toBe(3);
    expect(qualificacao?.canaisAtuais).toEqual(["iFood", "Rappi"]);
    expect(qualificacao?.observacoes).toBe("Já usa sistema concorrente");
  });

  it("sem nada para qualificar (unidades, canais e observações vazios), NÃO cria LeadQualificacao", async () => {
    const lote = await prisma.loteDeProspeccao.create({
      data: { nome: "Lote sem qualificação", proveniencia: "Lista sintética da jornada." },
    });
    const item = await prisma.itemDeProspeccao.create({
      data: {
        loteId: lote.id,
        nome: "Sem Qualificação",
        whatsapp: "11955560003",
        whatsappDigits: "5511955560003",
      },
    });

    const m = await materializarLead(prisma, item.id);
    expect(m.materializado).toBe(true);
    if (!m.materializado) throw new Error("não materializou");

    const qualificacao = await prisma.leadQualificacao.findUnique({ where: { leadId: m.leadId } });
    expect(qualificacao).toBeNull();
  });
});
