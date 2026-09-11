/**
 * A JORNADA DA RETENTATIVA, PONTA A PONTA, CONTRA POSTGRES DE VERDADE.
 *
 * ── O INCIDENTE QUE ESTA JORNADA REPRODUZ ───────────────────────────────────
 *
 * Uma rodada real materializou 20 `SiteLead` (de `ItemDeProspeccao` da Base
 * fria) e não criou UMA `LeadMensagem`, nenhum `wamid` — HTTP 200 em ~3,6s. A
 * interface mostrava os 20 como "Sem resposta", indistinguível de "mensagem
 * enviada e ainda sem retorno". `abordarDaFila.ts` explica o formato do
 * silêncio: `portaoRecusou` e `semDadoParaOModelo` são pulados sem teto, e a
 * rodada termina normal.
 *
 * Esta jornada monta a MESMA cena — materializa sem passar pelo envio — e
 * prova o mecanismo de recuperação: achar esses leads
 * (`leadsMaterializadosSemMensagem`) e recuperá-los de forma protegida e
 * idempotente (`retentarLeadsMaterializadosSemMensagem`), reaproveitando
 * `abordarLead` de verdade — a MESMA função de produção, contra o MESMO
 * banco.
 *
 * ── ⚠️ NADA AQUI FALA COM A META ─────────────────────────────────────────────
 *
 * O transporte HTTP (`enviarModeloDeVendas`, `canalDeVendasPronto`) é
 * substituído por um duplo — a mesma doutrina de `abordar.test.ts`. Banco,
 * roteamento e regra de negócio são reais, contra Postgres de verdade;
 * nenhuma rede é aberta.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { importarLote } from "@/services/salaDeVendas/prospeccao/lote";
import { materializarLead, montarFilaDeProspeccao } from "@/services/salaDeVendas/prospeccao/selecao";
import {
  leadsMaterializadosSemMensagem,
  retentarLeadsMaterializadosSemMensagem,
} from "@/services/salaDeVendas/prospeccao/retentativa";

const enviarModelo = vi.hoisted(() => vi.fn());
const canalPronto = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/services/foocci-sdr/FoocciSalesChannel", async (original) => {
  const real = await original<typeof import("@/services/foocci-sdr/FoocciSalesChannel")>();
  return { ...real, enviarModeloDeVendas: enviarModelo, canalDeVendasPronto: canalPronto };
});

const prisma = new PrismaClient();

/** Quarta-feira, 14h em São Paulo: dentro da janela, para não misturar causas. */
const AGORA = new Date("2026-09-09T17:00:00Z");

const EMAIL_DO_TESTE = "jornada-retentativa@teste.foocci";
const ambiente = { ...process.env };

let usuarioId = "";
let leadSemMensagem1 = "";
let leadSemMensagem2 = "";
let leadOutraFonteId = "";
/** O `wamid` que o passo 2 de fato gravou — o passo 5 confere contra ELE, não um valor fixo. */
let wamidDoEnvioReal = "";

beforeAll(async () => {
  await prisma.itemDeProspeccao.deleteMany({});
  await prisma.loteDeProspeccao.deleteMany({});
  await prisma.prospeccaoConfig.deleteMany({});
  await prisma.leadMensagem.deleteMany({});
  await prisma.siteLead.deleteMany({});
  await prisma.internalUser.deleteMany({ where: { email: EMAIL_DO_TESTE } });

  const usuario = await prisma.internalUser.create({
    data: { email: EMAIL_DO_TESTE, nome: "Jornada CI — retentativa", role: "GERENTE_DEPARTAMENTO" },
  });
  usuarioId = usuario.id;

  await prisma.prospeccaoConfig.create({
    data: { id: "singleton", outboundLigado: true, limiteDiario: 10, atualizadoPor: "jornada-ci" },
  });

  const lote = await importarLote(prisma, {
    nome: "Retentativa — teste sintético",
    proveniencia: "Lista sintética criada pela jornada de CI. Nenhum contato real.",
    criadoPor: "jornada-ci",
    limiteDiario: 10,
    linhas: [
      { whatsapp: "11955501111", nome: "Cantina Sintética Um", cidade: "Curitiba" },
      { whatsapp: "11955502222", nome: "Cantina Sintética Dois", cidade: "Curitiba" },
    ],
  });

  const itens = await prisma.itemDeProspeccao.findMany({
    where: { loteId: lote.loteId },
    orderBy: { criadoEm: "asc" },
  });
  expect(itens).toHaveLength(2);

  // ⭐⭐ A CENA DO INCIDENTE: materializa SEM passar por `abordarItemDaFila` —
  // exatamente o estado medido em produção em 11/09/2026. O `SiteLead` nasce;
  // nenhuma `LeadMensagem` nasce com ele.
  const m1 = await materializarLead(prisma, itens[0]!.id);
  const m2 = await materializarLead(prisma, itens[1]!.id);
  if (!m1.materializado || !m2.materializado) throw new Error("setup da jornada falhou ao materializar");
  leadSemMensagem1 = m1.leadId;
  leadSemMensagem2 = m2.leadId;

  // Um lead de OUTRA fonte, também sem mensagem nenhuma — a armadilha do
  // escopo: ele NUNCA pode ser tocado por uma retentativa de prospecção fria.
  const outraFonte = await prisma.siteLead.create({
    data: {
      nome: "Lead do site institucional",
      whatsapp: "11955503333",
      fonte: "FORMULARIO_DEMONSTRACAO",
    },
  });
  leadOutraFonteId = outraFonte.id;
});

afterAll(async () => {
  await prisma.internalUser.deleteMany({ where: { email: EMAIL_DO_TESTE } });
  await prisma.$disconnect();
});

// Fora do `beforeEach` DE PROPÓSITO: `waMessageId` é único no banco de
// verdade, e a jornada manda mais de uma mensagem confirmada ao longo dos
// passos. Zerar o contador a cada teste faria o passo 8 colidir com o `wamid`
// que o passo 2 já gravou (defeito do teste, não da produção real).
let contadorDeWamid = 0;

beforeEach(() => {
  enviarModelo.mockReset();
  // Um `wamid` DIFERENTE a cada chamada.
  enviarModelo.mockImplementation(async () => ({
    ok: true,
    providerMessageId: `wamid.JORNADA.RETENTATIVA.${++contadorDeWamid}`,
  }));
  canalPronto.mockReturnValue(true);
  process.env.FOOCCI_SDR_MODELO_ABORDAGEM = "foocci_abordagem_inicial";
  process.env.FOOCCI_SDR_MODELO_IDIOMA = "pt_BR";
  process.env.FOOCCI_SDR_MODELO_VARIAVEIS = "1";
});

afterEach(() => {
  process.env = { ...ambiente };
});

describe("Jornada — recuperar leads materializados sem mensagem", () => {
  it("1. ⭐ os dois leads da cena aparecem em leadsMaterializadosSemMensagem, e só eles", async () => {
    const escopados = await leadsMaterializadosSemMensagem(prisma, {
      ids: [leadSemMensagem1, leadSemMensagem2],
    });
    expect(escopados.map((l) => l.id).sort()).toEqual([leadSemMensagem1, leadSemMensagem2].sort());

    const semFiltro = await leadsMaterializadosSemMensagem(prisma);
    const idsSemFiltro = semFiltro.map((l) => l.id);
    expect(idsSemFiltro).toEqual(expect.arrayContaining([leadSemMensagem1, leadSemMensagem2]));
    // O lead de outra fonte, mesmo sem mensagem, não é "prospecção travada":
    // a consulta é só de LISTA_PROSPECCAO.
    expect(idsSemFiltro).not.toContain(leadOutraFonteId);
  });

  it("2. ⭐⭐ a retentativa manda exatamente UMA mensagem para o lead recuperável", async () => {
    const r = await retentarLeadsMaterializadosSemMensagem(prisma, {
      leadIds: [leadSemMensagem1],
      autor: "HUMANO",
      autorUserId: usuarioId,
      agora: AGORA,
    });

    expect(r.parouPor).toBe("listaAcabou");
    expect(r.resultados[0]).toMatchObject({ leadId: leadSemMensagem1, enviado: true });
    expect(enviarModelo).toHaveBeenCalledTimes(1);

    const mensagens = await prisma.leadMensagem.findMany({ where: { leadId: leadSemMensagem1 } });
    expect(mensagens).toHaveLength(1);
    expect(mensagens[0]!.status).toBe("ENVIADA");
    expect(mensagens[0]!.waMessageId).toEqual(expect.stringContaining("wamid.JORNADA.RETENTATIVA"));
    wamidDoEnvioReal = mensagens[0]!.waMessageId!;
    expect(mensagens[0]!.autorUserId).toBe(usuarioId);
  });

  it("3. ⭐⭐ o lead recuperado SAI de leadsMaterializadosSemMensagem — o outro continua", async () => {
    const achados = await leadsMaterializadosSemMensagem(prisma, {
      ids: [leadSemMensagem1, leadSemMensagem2],
    });
    expect(achados.map((l) => l.id)).toEqual([leadSemMensagem2]);
  });

  it("4. ⭐ sucesso não faz o lead voltar para nenhuma fila", async () => {
    const fila = await montarFilaDeProspeccao(prisma, { canalPronto: true, agora: AGORA });
    expect(fila.liberados.some((c) => c.leadId === leadSemMensagem1)).toBe(false);
    expect(fila.barrados.some((c) => c.leadId === leadSemMensagem1)).toBe(false);
  });

  it("5. ⭐⭐⭐ rodar a retentativa DE NOVO no mesmo lead não duplica nem reenvia — a prova de idempotência", async () => {
    const r = await retentarLeadsMaterializadosSemMensagem(prisma, {
      leadIds: [leadSemMensagem1],
      autor: "HUMANO",
      autorUserId: usuarioId,
      agora: AGORA,
    });

    // Nem tentou: a checagem de idempotência barra ANTES de chamar `abordarLead`.
    expect(enviarModelo).not.toHaveBeenCalled();
    expect(r.resultados[0]).toMatchObject({
      leadId: leadSemMensagem1,
      enviado: true,
      wamid: wamidDoEnvioReal,
    });

    const mensagens = await prisma.leadMensagem.findMany({ where: { leadId: leadSemMensagem1 } });
    expect(mensagens, "replay duplicou a mensagem").toHaveLength(1);
  });

  it("6. ⛔ lead de OUTRA fonte é recusado, nunca processado — o hard-scope", async () => {
    const r = await retentarLeadsMaterializadosSemMensagem(prisma, {
      leadIds: [leadOutraFonteId],
      autor: "HUMANO",
      autorUserId: usuarioId,
      agora: AGORA,
    });

    expect(r.resultados[0]).toMatchObject({
      leadId: leadOutraFonteId,
      enviado: false,
      motivo: "fonteInvalida",
    });
    expect(enviarModelo).not.toHaveBeenCalled();
    expect(await prisma.leadMensagem.count({ where: { leadId: leadOutraFonteId } })).toBe(0);
  });

  it("7. ⛔ o teto diário da prospecção continua valendo — igual valeria em abordarLead puro", async () => {
    await prisma.prospeccaoConfig.update({ where: { id: "singleton" }, data: { limiteDiario: 0 } });

    const r = await retentarLeadsMaterializadosSemMensagem(prisma, {
      leadIds: [leadSemMensagem2],
      autor: "HUMANO",
      autorUserId: usuarioId,
      agora: AGORA,
    });

    expect(r.resultados[0]!.enviado).toBe(false);
    expect(r.resultados[0]!.enviado === false && r.resultados[0]!.motivo).toBe("portaoRecusou");
    expect(r.resultados[0]!.enviado === false && r.resultados[0]!.detalhe).toContain("PROSPECCAO_DESLIGADA");
    expect(enviarModelo).not.toHaveBeenCalled();

    // O lead segue recuperável — o teto do dia não é falha, é o freio fazendo
    // o trabalho dele; o lead continua listado, pronto para a próxima rodada.
    const aindaTravado = await leadsMaterializadosSemMensagem(prisma, { ids: [leadSemMensagem2] });
    expect(aindaTravado.map((l) => l.id)).toEqual([leadSemMensagem2]);

    await prisma.prospeccaoConfig.update({ where: { id: "singleton" }, data: { limiteDiario: 10 } });
  });

  it("8. ⭐⭐ acima do teto, o mesmo lead sai normalmente — prova que o motivo 7 foi o teto, e nada mais", async () => {
    const r = await retentarLeadsMaterializadosSemMensagem(prisma, {
      leadIds: [leadSemMensagem2],
      autor: "HUMANO",
      autorUserId: usuarioId,
      agora: AGORA,
    });

    expect(r.resultados[0]).toMatchObject({ leadId: leadSemMensagem2, enviado: true });
    expect(enviarModelo).toHaveBeenCalledTimes(1);

    const restantes = await leadsMaterializadosSemMensagem(prisma, {
      ids: [leadSemMensagem1, leadSemMensagem2],
    });
    expect(restantes, "os dois leads da cena original já foram recuperados").toHaveLength(0);
  });
});
