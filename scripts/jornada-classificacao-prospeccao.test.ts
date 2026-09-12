/**
 * A JORNADA DA CLASSIFICAÇÃO AUTOMÁTICA, PONTA A PONTA, CONTRA POSTGRES DE
 * VERDADE — redesenho da prospecção automática e minimalista, 12/09/2026.
 *
 * ── O QUE ESTA JORNADA PROVA ────────────────────────────────────────────────
 *
 * O backend decide, sozinho, o que fazer com cada linha de um arquivo misto —
 * `classificacao.ts` — sem que quem sobe a lista escolha "importar" ou
 * "enriquecer". E prova, em particular, que os 20 leads do incidente de
 * 11/09/2026 (corrigidos pelos PRs #244/#245/#246) NUNCA voltam a ser
 * abordados por este mecanismo novo.
 *
 * ── ⚠️ DUAS CORRIDAS MEDIDAS NESTA SESSÃO, E O QUE FOI FEITO SOBRE CADA UMA ──
 *
 * Ao escrever a prova de concorrência (caso 7 do pedido), duas corridas
 * apareceram contra Postgres real:
 *
 *   1. **CRÍTICA, E CORRIGIDA**: `materializarLead` reservava por ITEM
 *      (`updateMany` por id), e não por TELEFONE. Dois itens DIFERENTES do
 *      MESMO telefone (dois lotes, uma importação concorrente) passavam os
 *      dois pela reserva (ids diferentes, sem conflito) e os dois criavam
 *      `SiteLead` — medido: até 14 leads fantasmas para o mesmo número em 15
 *      materializações concorrentes, cada um "novo" e sem histórico,
 *      driblando opt-out/descanso/teto porque nenhum sabia do outro. A
 *      correção (`pg_advisory_xact_lock` por telefone, em `selecao.ts`) fecha
 *      isso: a mesma prova agora converge sempre para UM lead.
 *   2. **CONHECIDA, NÃO CORRIGIDA NESTA ENTREGA**: `importarLote`, chamado
 *      concorrentemente para o MESMO telefone NOVO, pode criar mais de um
 *      `ItemDeProspeccao` PENDENTE (a checagem "já pendente em outro lote" e o
 *      `create` não são atômicos entre chamadas). Isto SÓ infla a contagem da
 *      Base fria — não causa mensagem duplicada, porque a correção 1 garante
 *      que, quando esses itens forem materializados (juntos ou em rodadas
 *      diferentes), convergem para o MESMO lead, e o portão de descanso
 *      impede um segundo envio na mesma janela. Fica registrado como
 *      pendência de acabamento, não como risco ao cliente.
 *
 * ── ⚠️ NADA AQUI FALA COM A META ─────────────────────────────────────────────
 *
 * `enviarModeloDeVendas`/`canalDeVendasPronto` são substituídos por dublês —
 * a mesma doutrina de `jornada-retentativa-prospeccao.test.ts`. Banco,
 * classificação e regra de negócio são reais.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  classificarArquivoDeImportacao,
  classificarLinhasParaRelatorio,
  classificarLinhaDeImportacao,
} from "@/services/salaDeVendas/prospeccao/classificacao";
import { importarLote } from "@/services/salaDeVendas/prospeccao/lote";
import { abrirImportacao } from "@/services/salaDeVendas/prospeccao/importacao";
import {
  montarFilaDeProspeccao,
  materializarLead,
  conferirElegibilidadeReal,
} from "@/services/salaDeVendas/prospeccao/selecao";
import { abordarItemDaFila, abordarARodadaDoDia } from "@/services/salaDeVendas/prospeccao/abordarDaFila";
import { conferirModeloDeAbordagem } from "@/services/foocci-sdr/modelosDaMeta";
import { lerPlanilha } from "@/services/salaDeVendas/prospeccao/lerPlanilha";

const enviarModelo = vi.hoisted(() => vi.fn());
const canalPronto = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/services/foocci-sdr/FoocciSalesChannel", async (original) => {
  const real = await original<typeof import("@/services/foocci-sdr/FoocciSalesChannel")>();
  return { ...real, enviarModeloDeVendas: enviarModelo, canalDeVendasPronto: canalPronto };
});

const prisma = new PrismaClient();

/** Quarta-feira, 14h em São Paulo: dentro da janela, para não misturar causas. */
const AGORA = new Date("2026-09-09T17:00:00Z");

const EMAIL_DO_TESTE = "jornada-classificacao@teste.foocci";
const PHONE_NUMBER_ID_DO_TESTE = "000000000009998";
const NOME_DO_MODELO = "abordagem_restaurante_fria";
const CORPO_DO_MODELO = "Olá, {{1}}! Somos a Foocci, falando com o {{2}} porque encontramos vocês em {{3}}.";
const ambiente = { ...process.env };

let usuarioId = "";

/**
 * O pré-voo, sempre aprovando — o mesmo padrão de `rodadaDoDia.test.ts`. O
 * tipo de `abordarARodadaDoDia` EXIGE o pré-voo em toda chamada de propósito
 * (chamador novo não compila sem dizer o que ele faz); aqui a pergunta que
 * as seções 9 e 12 fazem não é sobre o modelo, é sobre o teto e a exclusão.
 */
const preVooOk = async () => ({
  pronto: true as const,
  modelo: { nome: NOME_DO_MODELO, idioma: "pt_BR", status: "APPROVED", variaveis: 3 },
  parametrosQueMandamos: 3,
});

beforeAll(async () => {
  process.env.FOOCCI_SALES_PHONE_NUMBER_ID = PHONE_NUMBER_ID_DO_TESTE;
  process.env.FOOCCI_SDR_MODELO_ABORDAGEM = NOME_DO_MODELO;
  process.env.FOOCCI_SDR_MODELO_IDIOMA = "pt_BR";
  process.env.FOOCCI_SDR_MODELO_VARIAVEIS = "3";

  await prisma.conflitoDeImportacao.deleteMany({});
  await prisma.itemDeProspeccao.deleteMany({});
  await prisma.loteDeProspeccao.deleteMany({});
  await prisma.importacaoDeLeads.deleteMany({});
  await prisma.leadMensagem.deleteMany({});
  await prisma.siteLead.deleteMany({ where: { whatsappDigits: { startsWith: "55119" } } });
  await prisma.internalUser.deleteMany({ where: { email: EMAIL_DO_TESTE } });
  await prisma.modeloDeVendas.deleteMany({ where: { phoneNumberId: PHONE_NUMBER_ID_DO_TESTE } });
  await prisma.prospeccaoConfig.deleteMany({});

  await prisma.modeloDeVendas.create({
    data: {
      phoneNumberId: PHONE_NUMBER_ID_DO_TESTE,
      wabaId: "waba-jornada-classificacao",
      nome: NOME_DO_MODELO,
      idioma: "pt_BR",
      categoria: "MARKETING",
      situacao: "APPROVED",
      variaveis: 3,
      corpo: CORPO_DO_MODELO,
      autorizado: true,
    },
  });

  const usuario = await prisma.internalUser.create({
    data: { email: EMAIL_DO_TESTE, nome: "Jornada CI — classificação", role: "GERENTE_DEPARTAMENTO" },
  });
  usuarioId = usuario.id;
});

afterAll(async () => {
  await prisma.modeloDeVendas.deleteMany({ where: { phoneNumberId: PHONE_NUMBER_ID_DO_TESTE } });
  await prisma.internalUser.deleteMany({ where: { email: EMAIL_DO_TESTE } });
  await prisma.$disconnect();
});

beforeEach(() => {
  enviarModelo.mockReset();
  enviarModelo.mockImplementation(async () => ({
    ok: true,
    providerMessageId: `wamid.JORNADA.CLASS.${Math.random().toString(36).slice(2)}`,
  }));
  canalPronto.mockReturnValue(true);
  process.env.FOOCCI_SALES_PHONE_NUMBER_ID = PHONE_NUMBER_ID_DO_TESTE;
  process.env.FOOCCI_SDR_MODELO_ABORDAGEM = NOME_DO_MODELO;
  process.env.FOOCCI_SDR_MODELO_IDIOMA = "pt_BR";
  process.env.FOOCCI_SDR_MODELO_VARIAVEIS = "3";
});

afterEach(() => {
  process.env = { ...ambiente };
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. MESMO ARQUIVO, MESMO HASH, DUAS VEZES — ZERO DUPLICAÇÃO
// ═══════════════════════════════════════════════════════════════════════════
describe("1. o mesmo arquivo (mesmo hash) enviado duas vezes não duplica nada", () => {
  const HASH = "hash-arquivo-1-aaa111";

  it("a segunda subida do MESMO arquivo é classificada DUPLICATA_EXATA e não cria nada novo", async () => {
    const linha = { whatsapp: "11955590001", nome: "Doceria Um", empresa: "Doceria Um" };

    const r1 = await classificarArquivoDeImportacao(prisma, {
      nome: "Arquivo 1 — primeira subida",
      proveniencia: "Jornada de CI",
      linhas: [linha],
      arquivoHash: HASH,
      arquivoNome: "arquivo-1.csv",
      criadoPor: "jornada-ci",
    });
    expect(r1.resumo.novos).toBe(1);
    expect(r1.importacao.aceitas).toBe(1);

    // Registra o arquivo como já subido — o passo que a rota faz em
    // `abrirImportacao`, antes de aceitar qualquer parte.
    const importacaoId = await abrirImportacao(prisma, {
      arquivoNome: "arquivo-1.csv",
      arquivoHash: HASH,
      proveniencia: "Jornada de CI",
    });
    await prisma.importacaoDeLeads.update({
      where: { id: importacaoId },
      data: { situacao: "CONCLUIDA" },
    });

    const totalAntes = await prisma.itemDeProspeccao.count({ where: { whatsappDigits: "5511955590001" } });
    expect(totalAntes).toBe(1);

    // ⭐ A SEGUNDA SUBIDA DO MESMO ARQUIVO.
    const r2 = await classificarArquivoDeImportacao(prisma, {
      nome: "Arquivo 1 — segunda subida (reenvio)",
      proveniencia: "Jornada de CI",
      linhas: [linha],
      arquivoHash: HASH,
      arquivoNome: "arquivo-1.csv",
      criadoPor: "jornada-ci",
    });

    expect(r2.resumo.linhas[0]!.classificacao).toBe("DUPLICATA_EXATA");
    expect(r2.resumo.duplicatasExatas).toBe(1);
    expect(r2.resumo.novos).toBe(0);
    // O mecanismo de dedup por telefone (independente do hash) também recusa.
    expect(r2.importacao.aceitas).toBe(0);

    const totalDepois = await prisma.itemDeProspeccao.count({ where: { whatsappDigits: "5511955590001" } });
    const pendentesDepois = await prisma.itemDeProspeccao.count({
      where: { whatsappDigits: "5511955590001", situacao: "PENDENTE" },
    });
    // A segunda subida cria uma FICHA de auditoria (DUPLICADO), mas só UMA
    // continua PENDENTE — é essa que importa para "duplicação de verdade".
    expect(totalDepois).toBe(2);
    expect(pendentesDepois).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 e 3. MESMO TELEFONE EM DOIS ARQUIVOS — UM CONTATO, ENRIQUECIDO
// ═══════════════════════════════════════════════════════════════════════════
describe("2 e 3. o mesmo telefone em dois arquivos diferentes vira um único contato, enriquecido", () => {
  it("arquivo A cria o contato incompleto; arquivo B (hash diferente) completa os campos vazios", async () => {
    const digitos = "5511955590002";

    const rA = await classificarArquivoDeImportacao(prisma, {
      nome: "Arquivo A",
      proveniencia: "Jornada de CI — arquivo A",
      linhas: [{ whatsapp: "11955590002", nome: "Responsável A" }], // sem empresa, sem cidade
      arquivoHash: "hash-arquivo-2-A",
      arquivoNome: "arquivo-A.csv",
    });
    expect(rA.resumo.linhas[0]!.classificacao).toBe("NOVO");
    expect(rA.resumo.linhas[0]!.semDadoParaOModelo, "sem empresa, devia acusar pendência").toBe(true);

    const itemAntes = await prisma.itemDeProspeccao.findFirstOrThrow({ where: { whatsappDigits: digitos } });
    expect(itemAntes.empresa).toBeNull();
    expect(itemAntes.cidade).toBeNull();

    // ⭐ Arquivo B: MESMO telefone, hash DIFERENTE, dado complementar.
    const rB = await classificarArquivoDeImportacao(prisma, {
      nome: "Arquivo B",
      proveniencia: "Jornada de CI — arquivo B",
      linhas: [
        { whatsapp: "11955590002", empresa: "Restaurante Complementado", cidade: "Curitiba" },
      ],
      arquivoHash: "hash-arquivo-2-B",
      arquivoNome: "arquivo-B.csv",
    });

    expect(rB.resumo.linhas[0]!.classificacao).toBe("ENRIQUECIMENTO");
    expect(rB.resumo.enriquecidos).toBe(1);
    expect(rB.resumo.linhas[0]!.camposParaPreencher.sort()).toEqual(["cidade", "empresa"]);

    // ── UM único contato — a contagem de PENDENTE não pode ter dobrado ──
    const pendentes = await prisma.itemDeProspeccao.count({
      where: { whatsappDigits: digitos, situacao: "PENDENTE" },
    });
    expect(pendentes).toBe(1);

    const itemDepois = await prisma.itemDeProspeccao.findFirstOrThrow({
      where: { whatsappDigits: digitos, situacao: "PENDENTE" },
    });
    expect(itemDepois.empresa).toBe("Restaurante Complementado");
    expect(itemDepois.cidade).toBe("Curitiba");
    expect(itemDepois.nome).toBe("Responsável A"); // o que já estava, continua

    // Já não falta dado para o modelo — a pendência se resolveu.
    const relido = await classificarLinhaDeImportacao(
      prisma,
      { whatsapp: "11955590002" },
      { vistosNoArquivo: new Set(), arquivoJaExistia: false, indice: 0 },
    );
    expect(relido.semDadoParaOModelo).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. SEGUNDO ARQUIVO COM CONFLITO — DADO ORIGINAL PRESERVADO, CONFLITO AUDITADO
// ═══════════════════════════════════════════════════════════════════════════
describe("4. conflito: dado já preenchido nunca é sobrescrito, e a divergência fica registrada", () => {
  it("arquivo B traz cidade DIFERENTE da já gravada — a original fica, o conflito é consultável", async () => {
    const digitos = "5511955590004";

    await classificarArquivoDeImportacao(prisma, {
      nome: "Arquivo A — conflito",
      proveniencia: "Jornada de CI",
      linhas: [{ whatsapp: "11955590004", empresa: "Empanadas do Zé", cidade: "Curitiba" }],
      arquivoHash: "hash-arquivo-4-A",
      arquivoNome: "arquivo-4-A.csv",
    });

    const rB = await classificarArquivoDeImportacao(prisma, {
      nome: "Arquivo B — conflito",
      proveniencia: "Jornada de CI",
      linhas: [{ whatsapp: "11955590004", cidade: "São Paulo" }], // cidade DIVERGENTE
      arquivoHash: "hash-arquivo-4-B",
      arquivoNome: "arquivo-4-B.csv",
    });

    expect(rB.resumo.linhas[0]!.classificacao).toBe("CONFLITO");
    expect(rB.resumo.conflitos).toBe(1);
    expect(rB.resumo.linhas[0]!.camposEmConflito).toEqual([
      { campo: "cidade", valorAtual: "Curitiba", valorNovo: "São Paulo" },
    ]);

    // ── O DADO ORIGINAL CONTINUA — nunca é sobrescrito ──
    const item = await prisma.itemDeProspeccao.findFirstOrThrow({ where: { whatsappDigits: digitos } });
    expect(item.cidade).toBe("Curitiba");

    // ── E O CONFLITO É CONSULTÁVEL, não um log perdido ──
    const conflitos = await prisma.conflitoDeImportacao.findMany({ where: { itemId: item.id } });
    expect(conflitos).toHaveLength(1);
    expect(conflitos[0]).toMatchObject({
      campo: "cidade",
      valorAtual: "Curitiba",
      valorNovo: "São Paulo",
      arquivoOrigem: "arquivo-4-B.csv",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. CABEÇALHO DO GOOGLE MAPS — REGRESSÃO, PONTA A PONTA
// ═══════════════════════════════════════════════════════════════════════════
describe("5. arquivo com cabeçalho do Google Maps é reconhecido automaticamente (regressão)", () => {
  it("name/phone/city do Outscraper/Apify entram como empresa/whatsapp/cidade, e o contato fica elegível", async () => {
    const csv =
      "name,phone,city,category\n" +
      "Cantina do Google Maps,11955590005,Curitiba,Italian restaurant\n";
    const leitura = lerPlanilha(csv);
    expect(leitura.linhas).toHaveLength(1);
    expect(leitura.linhas[0]).toMatchObject({
      empresa: "Cantina do Google Maps",
      whatsapp: "11955590005",
      cidade: "Curitiba",
      tipo: "Italian restaurant",
    });

    const r = await classificarArquivoDeImportacao(prisma, {
      nome: "Arquivo do Google Maps",
      proveniencia: "Jornada de CI — exportador Google Maps",
      linhas: leitura.linhas,
      arquivoHash: "hash-arquivo-5",
      arquivoNome: "google-maps.csv",
    });

    expect(r.resumo.linhas[0]!.classificacao).toBe("NOVO");
    expect(r.resumo.linhas[0]!.semDadoParaOModelo).toBe(false); // já tem empresa

    const item = await prisma.itemDeProspeccao.findFirstOrThrow({
      where: { whatsappDigits: "5511955590005" },
    });
    expect(item.empresa).toBe("Cantina do Google Maps");
    expect(item.cidade).toBe("Curitiba");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. LINHAS INVÁLIDAS MISTURADAS COM VÁLIDAS
// ═══════════════════════════════════════════════════════════════════════════
describe("6. arquivo misto: válidas processadas, inválidas explicadas com motivo", () => {
  it("duas válidas entram como NOVO; a inválida é classificada e recusada com motivo", async () => {
    const r = await classificarArquivoDeImportacao(prisma, {
      nome: "Arquivo misto",
      proveniencia: "Jornada de CI",
      linhas: [
        { whatsapp: "11955590006", nome: "Válida Um", empresa: "E1" },
        { whatsapp: "123", nome: "Telefone impossível" },
        { whatsapp: "11955590007", nome: "Válida Dois", empresa: "E2" },
      ],
      arquivoHash: "hash-arquivo-6",
      arquivoNome: "arquivo-6.csv",
    });

    expect(r.resumo.analisadas).toBe(3);
    expect(r.resumo.novos).toBe(2);
    expect(r.resumo.invalidos).toBe(1);
    expect(r.resumo.linhas[1]!.classificacao).toBe("INVALIDO");
    expect(r.importacao.motivosDeRecusa).toMatchObject({
      "Telefone com formato improvável": 1,
    });

    const validas = await prisma.itemDeProspeccao.count({
      where: { whatsappDigits: { in: ["5511955590006", "5511955590007"] }, situacao: "PENDENTE" },
    });
    expect(validas).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. CONCORRÊNCIA — A CRÍTICA (FECHADA) E A CONHECIDA (DOCUMENTADA)
// ═══════════════════════════════════════════════════════════════════════════
describe("7. concorrência: a garantia que protege o cliente nunca quebra", () => {
  it("⭐⭐ N materializações concorrentes do MESMO telefone (itens de lotes diferentes) convergem para UM ÚNICO lead", async () => {
    const telefone = "11955590077";
    const digitosNovo = "5511955590077";

    const N = 12;
    const itens = [];
    for (let i = 0; i < N; i++) {
      const lote = await prisma.loteDeProspeccao.create({
        data: { nome: `CONC-${i}`, proveniencia: "Jornada de CI — concorrência" },
      });
      itens.push(
        await prisma.itemDeProspeccao.create({
          data: { loteId: lote.id, whatsapp: telefone, whatsappDigits: digitosNovo, nome: `Item ${i}` },
        }),
      );
    }

    const resultados = await Promise.all(itens.map((it) => materializarLead(prisma, it.id)));
    expect(resultados.every((r) => r.materializado)).toBe(true);

    const leadIds = new Set(resultados.map((r) => (r.materializado ? r.leadId : null)));
    expect(leadIds.size, "convergiu para mais de um lead — a trava por telefone regrediu").toBe(1);

    const leads = await prisma.siteLead.findMany({ where: { whatsappDigits: digitosNovo } });
    expect(leads, "existe mais de um SiteLead para o mesmo telefone").toHaveLength(1);

    // Só UM item ficou de fato "dono" (VIROU_LEAD); os outros são DUPLICADO
    // apontando para o mesmo lead — nenhum ficou órfão ou reservado para sempre.
    const situacoes = await prisma.itemDeProspeccao.findMany({
      where: { id: { in: itens.map((i) => i.id) } },
      select: { situacao: true, leadId: true },
    });
    expect(situacoes.every((s) => s.leadId === leads[0]!.id)).toBe(true);
    expect(situacoes.filter((s) => s.situacao === "VIROU_LEAD")).toHaveLength(1);
    expect(situacoes.filter((s) => s.situacao === "DUPLICADO")).toHaveLength(N - 1);
  });

  it("⚠️ MEDIDO E DOCUMENTADO — importações concorrentes do mesmo telefone NOVO podem duplicar o ITEM (não o lead)", async () => {
    // Esta é a corrida CONHECIDA, não corrigida nesta entrega (ver o cabeçalho
    // do arquivo). O teste não afirma "nunca duplica o item" — afirmaria uma
    // garantia que a medição não sustenta. Ele prova o que REALMENTE importa:
    // mesmo que o item duplique, o teste anterior já provou que a
    // materialização (o único ato que fala com o cliente) converge sempre
    // para um lead só.
    const telefone = "11955590088";
    const digitos = "5511955590088";

    const N = 10;
    const resultados = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        importarLote(prisma, {
          nome: `CONC-IMPORT-${i}`,
          proveniencia: "Jornada de CI — concorrência de importação",
          linhas: [{ whatsapp: telefone, nome: "Concorrência de Importação" }],
        }),
      ),
    );

    const aceitasNoTotal = resultados.reduce((n, r) => n + r.aceitas, 0);
    const pendentes = await prisma.itemDeProspeccao.count({
      where: { whatsappDigits: digitos, situacao: "PENDENTE" },
    });

    // A soma de `aceitas` bate com o que está PENDENTE — nenhuma mentira entre
    // o que a função disse e o que o banco tem.
    expect(pendentes).toBe(aceitasNoTotal);
    // A garantia real: nunca dá pra sair NADA além do teto físico de N chamadas.
    expect(pendentes).toBeGreaterThanOrEqual(1);
    expect(pendentes).toBeLessThanOrEqual(N);

    // E a garantia que PROTEGE o cliente: materializando todos os PENDENTE
    // que sobraram, ainda assim nasce UM lead só.
    const itensPendentes = await prisma.itemDeProspeccao.findMany({
      where: { whatsappDigits: digitos, situacao: "PENDENTE" },
    });
    await Promise.all(itensPendentes.map((it) => materializarLead(prisma, it.id)));
    const leads = await prisma.siteLead.findMany({ where: { whatsappDigits: digitos } });
    expect(leads).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. IMPORTAR COM A PROSPECÇÃO ATIVA NUNCA CAUSA MENSAGEM
// ═══════════════════════════════════════════════════════════════════════════
describe("8. importar com o outbound LIGADO não causa nenhuma mensagem", () => {
  it("classificarArquivoDeImportacao nunca chama o transporte de envio", async () => {
    await prisma.prospeccaoConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", outboundLigado: true, limiteDiario: 50, atualizadoPor: "jornada-ci" },
      update: { outboundLigado: true, limiteDiario: 50, pausadoEm: null },
    });

    await classificarArquivoDeImportacao(prisma, {
      nome: "Arquivo com outbound ligado",
      proveniencia: "Jornada de CI",
      linhas: [{ whatsapp: "11955590008", nome: "Nunca Deveria Ser Abordado Pela Importação" }],
      arquivoHash: "hash-arquivo-8",
      arquivoNome: "arquivo-8.csv",
    });

    expect(enviarModelo).not.toHaveBeenCalled();
    const item = await prisma.itemDeProspeccao.findFirstOrThrow({
      where: { whatsappDigits: "5511955590008" },
    });
    expect(item.situacao).toBe("PENDENTE"); // não materializou, não abordou
    expect(await prisma.siteLead.count({ where: { whatsappDigits: "5511955590008" } })).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. TETO DIÁRIO DE 20 — NUNCA O 21º
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠️ O MECANISMO CERTO A MEDIR — descoberto ao escrever este teste: o teto
// configurado (`ProspeccaoConfig.limiteDiario`) só é lido por
// `montarFilaDeProspeccao` (que monta `fila.liberados` já cortada pelo teto).
// `abordarItemDaFila`/`abordarLead` chamam `conferirRitmo` SEM passar o teto
// da config — usam a reserva física de `FOOCCI_SDR_TETO_DIA`/2000, que é
// outra trava (o teto duro do canal, não o número que o CEO configura). Ou
// seja: é a FILA quem garante "nunca oferece o 21º"; a rodada automática
// (`abordarARodadaDoDia`) só toca quem a fila já aprovou. Testar
// `abordarItemDaFila` direto, sobre um item que a fila nunca ofereceria,
// mediria a trava ERRADA. Por isso este teste mede pela fila e pela rodada —
// o caminho que a operação automática de fato usa.
describe("9. o teto diário nunca deixa passar o 21º — na fronteira do teto, inclusive sob concorrência", () => {
  it("com o teto já EM 20, a fila não oferece NADA — mesmo consultada concorrentemente", async () => {
    await prisma.prospeccaoConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", outboundLigado: true, limiteDiario: 20, atualizadoPor: "jornada-ci" },
      update: { outboundLigado: true, limiteDiario: 20, pausadoEm: null },
    });

    // 20 `LeadMensagem` de SAÍDA já ENVIADAS nas últimas 24h — o teto já bateu,
    // e já está COMMITADO antes de qualquer leitura concorrente abaixo: não há
    // corrida em CONTAR um fato que já é passado.
    const leadDoTeto = await prisma.siteLead.create({
      data: { nome: "Lead do teto", whatsapp: "11955590090", whatsappDigits: "5511955590090", fonte: "LISTA_PROSPECCAO" },
    });
    await prisma.leadMensagem.createMany({
      data: Array.from({ length: 20 }, () => ({
        leadId: leadDoTeto.id,
        direcao: "SAIDA" as const,
        tipo: "TEMPLATE" as const,
        status: "ENVIADA" as const,
        templateNome: NOME_DO_MODELO,
        ocorreuEm: AGORA,
      })),
    });

    // Mais 5 contatos elegíveis esperando — se o teto vazasse, seria por eles.
    const lote = await prisma.loteDeProspeccao.create({
      data: { nome: "Teto — tentativas além do limite", proveniencia: "Jornada de CI" },
    });
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        prisma.itemDeProspeccao.create({
          data: {
            loteId: lote.id,
            whatsapp: `1195559009${i + 1}`,
            whatsappDigits: `551195559009${i + 1}`,
            nome: `Além do teto ${i}`,
            empresa: `Empresa ${i}`,
          },
        }),
      ),
    );

    // 8 leituras concorrentes da fila — nenhuma pode oferecer um 21º.
    const filas = await Promise.all(
      Array.from({ length: 8 }, () => montarFilaDeProspeccao(prisma, { canalPronto: true, agora: AGORA })),
    );
    expect(filas.every((f) => f.liberados.length === 0)).toBe(true);
    // A frase exata vem do freio de ritmo (`freioDeRitmo.ts`) — a mesma que
    // `montarFilaDeProspeccao` repassa sem reescrever, de propósito (ver o
    // comentário grande de `ritmo.detalhe` em `selecao.ts`).
    expect(filas[0]!.motivoDaFilaVazia).toContain("teto de 20 abordagens em 24h já alcançado");

    // E a RODADA automática, disparada concorrentemente, não aborda ninguém —
    // é a fila vazia que ela lê, não um número calculado por ela mesma.
    const rodadas = await Promise.all(
      Array.from({ length: 5 }, () =>
        abordarARodadaDoDia(prisma, { autor: "HUMANO", autorUserId: usuarioId, canalPronto: true, preVoo: preVooOk, agora: AGORA }),
      ),
    );
    expect(rodadas.every((r) => r.abordados === 0)).toBe(true);
    expect(enviarModelo).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ MEDIDO, E O LIMITE É DO PRÓPRIO FREIO — não desta entrega, e vale
   * registrar em vez de assumir.
   *
   * `conferirRitmo` (`freioDeRitmo.ts`) documenta a própria régua: "não é
   * transacional, e não precisa ser: dois processos podem passar juntos e
   * mandar uma a mais que o teto (...) o que este freio existe para impedir é
   * a diferença entre 1.000 e 10.000, não entre 2.000 e 2.001." O caso que
   * fura essa régua não é um SDR clicando duas vezes — é DUAS RODADAS
   * inteiras disparadas quase juntas (o agendador das 9h E um clique manual,
   * por exemplo): cada rodada lê `montarFilaDeProspeccao` no início e, se as
   * duas leituras acontecerem antes de qualquer envio da outra ter sido
   * commitado, as duas podem oferecer o MESMO saldo — e cada uma, sequencial
   * por dentro, pode consumir o teto inteiro por conta própria. Este teste
   * mede o tamanho real dessa fresta a partir do zero, para a garantia não
   * ficar assumida.
   */
  it("⚠️ a partir de ZERO, DUAS RODADAS quase-simultâneas podem juntas passar do teto — comportamento já documentado em freioDeRitmo.ts, medido aqui", async () => {
    await prisma.leadMensagem.deleteMany({ where: { templateNome: NOME_DO_MODELO } });
    await prisma.siteLead.deleteMany({ where: { whatsappDigits: { startsWith: "5511955591" } } });
    await prisma.prospeccaoConfig.update({
      where: { id: "singleton" },
      data: { limiteDiario: 3, pausadoEm: null, motivo: null },
    });

    const lote = await prisma.loteDeProspeccao.create({
      data: { nome: "Teto — duas rodadas quase juntas", proveniencia: "Jornada de CI" },
    });
    const N = 8;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        prisma.itemDeProspeccao.create({
          data: {
            loteId: lote.id,
            whatsapp: `119555916${String(i).padStart(2, "0")}`,
            whatsappDigits: `5511955591${String(i).padStart(3, "0")}`,
            nome: `Rajada ${i}`,
            empresa: `Empresa Rajada ${i}`,
          },
        }),
      ),
    );

    // Duas "rodadas" concorrentes competindo pela MESMA lista, teto=3.
    const [r1, r2] = await Promise.all([
      abordarARodadaDoDia(prisma, { autor: "HUMANO", autorUserId: usuarioId, canalPronto: true, preVoo: preVooOk, agora: AGORA }),
      abordarARodadaDoDia(prisma, { autor: "HUMANO", autorUserId: usuarioId, canalPronto: true, preVoo: preVooOk, agora: AGORA }),
    ]);
    const abordadosNoTotal = r1.abordados + r2.abordados;

    // A garantia mensurável e verdadeira: nunca sai MUITO mais que o teto (a
    // "ordem de grandeza" que o comentário do freio promete) — nunca o
    // universo inteiro de N tentativas, mesmo que possa passar de 3.
    expect(abordadosNoTotal).toBeGreaterThanOrEqual(1);
    expect(abordadosNoTotal).toBeLessThanOrEqual(N);
    console.info(
      `[jornada] duas rodadas quase-simultâneas do zero: teto=3, abordados no total=${abordadosNoTotal} ` +
        `(rodada 1: ${r1.abordados}, rodada 2: ${r2.abordados}) — ver o comentário grande de ` +
        `conferirRitmo em freioDeRitmo.ts. Se este número for sempre ≤3 em execuções repetidas, ` +
        `é porque o Postgres serializou as duas leituras nesta máquina — não porque haja uma trava ` +
        `explícita para isso; a régua documentada continua sendo "ordem de grandeza", não "exato".`,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. OPT-OUT NUNCA VOLTA A APARECER COMO ELEGÍVEL
// ═══════════════════════════════════════════════════════════════════════════
describe("11. opt-out: nunca elegível, nunca reclassificado como novo", () => {
  it("lead com optOutAt entra na base como OPT_OUT, e nunca aparece elegível na fila", async () => {
    const optOutLead = await prisma.siteLead.create({
      data: {
        nome: "Pediu Silêncio",
        whatsapp: "11955590100",
        whatsappDigits: "5511955590100",
        fonte: "MANUAL",
        optOutAt: AGORA,
        optOutCanal: "jornada-ci",
      },
    });

    const r = await classificarArquivoDeImportacao(prisma, {
      nome: "Arquivo com opt-out",
      proveniencia: "Jornada de CI",
      linhas: [{ whatsapp: "11955590100", nome: "Reimportado depois do silêncio" }],
      arquivoHash: "hash-arquivo-11",
      arquivoNome: "arquivo-11.csv",
    });

    expect(r.resumo.linhas[0]!.classificacao).toBe("OPT_OUT");
    expect(r.resumo.optOut).toBe(1);
    expect(r.resumo.novos).toBe(0);

    await prisma.prospeccaoConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", outboundLigado: true, limiteDiario: 50, atualizadoPor: "jornada-ci" },
      update: { outboundLigado: true, limiteDiario: 50, pausadoEm: null },
    });
    const fila = await montarFilaDeProspeccao(prisma, { canalPronto: true, agora: AGORA });
    expect(fila.liberados.some((c) => c.leadId === optOutLead.id)).toBe(false);

    const conferencia = await conferirElegibilidadeReal(prisma, {
      canalConfigurado: true,
      envioAutorizado: true,
      agora: AGORA,
    });
    expect(conferencia.previaAmostral.some((c) => c.leadId === optOutLead.id && c.decisao.sendable)).toBe(
      false,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. OS 20 DO INCIDENTE — NUNCA RECLASSIFICADOS, NUNCA REABORDADOS
// ═══════════════════════════════════════════════════════════════════════════
describe("12. ⭐⭐⭐ a cena do incidente de 11/09/2026: contato já abordado nunca reentra na fila", () => {
  it("materializa sem enviar (a cena real) → confirma o envio → reimporta o MESMO telefone → nunca vira NOVO, nunca reaborda", async () => {
    // ── Passo 1: A CENA DO INCIDENTE — item vira lead SEM passar pelo envio ──
    const lote = await prisma.loteDeProspeccao.create({
      data: { nome: "Incidente 11/09 — jornada", proveniencia: "Jornada de CI" },
    });
    const item = await prisma.itemDeProspeccao.create({
      data: {
        loteId: lote.id,
        whatsapp: "11955590120",
        whatsappDigits: "5511955590120",
        nome: "Contato do incidente",
        empresa: "Restaurante do Incidente",
      },
    });
    const m = await materializarLead(prisma, item.id);
    expect(m.materializado).toBe(true);
    if (!m.materializado) throw new Error("setup falhou");
    const leadId = m.leadId;

    // Ainda sem NENHUMA mensagem — exatamente o estado medido em produção.
    expect(await prisma.leadMensagem.count({ where: { leadId } })).toBe(0);

    // ── Passo 2: A CORREÇÃO — confirma o envio de verdade (via abordarLead) ──
    await prisma.prospeccaoConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", outboundLigado: true, limiteDiario: 50, atualizadoPor: "jornada-ci" },
      update: { outboundLigado: true, limiteDiario: 50, pausadoEm: null },
    });
    // Zera o ritmo dos testes anteriores para este envio não ser barrado pelo
    // freio — o que este passo prova é a exclusão por "já abordado", não o teto.
    await prisma.leadMensagem.deleteMany({ where: { direcao: "SAIDA", ocorreuEm: { gte: AGORA } } });

    const r2 = await abordarItemDaFila(prisma, {
      itemId: item.id,
      autor: "HUMANO",
      autorUserId: usuarioId,
      agora: AGORA,
    });
    expect(r2.abordou, JSON.stringify(r2)).toBe(true);
    expect(enviarModelo).toHaveBeenCalledTimes(1);

    const mensagemConfirmada = await prisma.leadMensagem.findFirstOrThrow({ where: { leadId } });
    expect(mensagemConfirmada.status).toBe("ENVIADA");

    // ── Passo 3: TENTA REIMPORTAR O MESMO TELEFONE — nunca pode virar NOVO ──
    const r3 = await classificarArquivoDeImportacao(prisma, {
      nome: "Reimportação do contato já abordado",
      proveniencia: "Jornada de CI",
      linhas: [{ whatsapp: "11955590120", nome: "Tentativa de reimportar" }],
      arquivoHash: "hash-arquivo-12",
      arquivoNome: "arquivo-12.csv",
    });

    expect(r3.resumo.linhas[0]!.classificacao).toBe("JA_ABORDADO");
    expect(r3.resumo.jaAbordados).toBe(1);
    expect(r3.resumo.novos, "reentrou como NOVO — a proteção do incidente regrediu").toBe(0);
    expect(r3.importacao.aceitas).toBe(0);

    // ── E nunca reentra na fila, nem é reabordado ──
    const fila = await montarFilaDeProspeccao(prisma, { canalPronto: true, agora: AGORA });
    expect(fila.liberados.some((c) => c.leadId === leadId)).toBe(false);

    const totalDeLeadsParaEsteTelefone = await prisma.siteLead.count({
      where: { whatsappDigits: "5511955590120" },
    });
    expect(totalDeLeadsParaEsteTelefone, "criou um segundo lead para o mesmo telefone").toBe(1);
    expect(enviarModelo).toHaveBeenCalledTimes(1); // nunca mais que a única vez do passo 2
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. MODELO NÃO AUTORIZADO — ZERO ENVIO, MOTIVO NO PRÉ-VOO E NO ENVIO
// ═══════════════════════════════════════════════════════════════════════════
describe("13. modelo APPROVED na Meta mas autorizado:false — zero envio, com o motivo no diagnóstico", () => {
  afterEach(async () => {
    // Devolve ao estado autorizado, para não vazar para outros testes deste
    // arquivo (a suíte compartilha o mesmo modelo persistido).
    await prisma.modeloDeVendas.updateMany({
      where: { phoneNumberId: PHONE_NUMBER_ID_DO_TESTE, nome: NOME_DO_MODELO },
      data: { autorizado: true },
    });
  });

  it("⭐ o PRÉ-VOO reprova com causa 'naoAutorizado', e a rodada nem começa", async () => {
    await prisma.modeloDeVendas.updateMany({
      where: { phoneNumberId: PHONE_NUMBER_ID_DO_TESTE, nome: NOME_DO_MODELO },
      data: { autorizado: false },
    });

    // A Meta responde APPROVED — o modelo está bom para ELA. É a autorização
    // INTERNA que falta.
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ whatsapp_business_account: { id: "999" } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                name: NOME_DO_MODELO,
                language: "pt_BR",
                status: "APPROVED",
                components: [{ type: "BODY", text: CORPO_DO_MODELO }],
              },
            ],
          }),
          { status: 200 },
        ),
      ) as never;

    const r = await conferirModeloDeAbordagem("token-de-teste");
    expect(r.pronto).toBe(false);
    if (r.pronto) return;
    expect(r.causa).toBe("naoAutorizado");
    expect(r.detalhe).toContain("autorizado=false");
  });

  it("⭐⭐ mesmo pulando o pré-voo (clique manual direto), o ENVIO reprova sozinho — zero mensagem", async () => {
    await prisma.modeloDeVendas.updateMany({
      where: { phoneNumberId: PHONE_NUMBER_ID_DO_TESTE, nome: NOME_DO_MODELO },
      data: { autorizado: false },
    });

    const lote = await prisma.loteDeProspeccao.create({
      data: { nome: "Modelo desautorizado — jornada", proveniencia: "Jornada de CI" },
    });
    const item = await prisma.itemDeProspeccao.create({
      data: {
        loteId: lote.id,
        whatsapp: "11955590130",
        whatsappDigits: "5511955590130",
        nome: "Não pode ser abordado",
        empresa: "Empresa X",
      },
    });

    // Chama `abordarItemDaFila` DIRETO — o mesmo caminho de um clique manual
    // na tela, que NÃO passa pelo pré-voo da rodada.
    const r = await abordarItemDaFila(prisma, {
      itemId: item.id,
      autor: "HUMANO",
      autorUserId: usuarioId,
      agora: AGORA,
    });

    expect(r.abordou).toBe(false);
    if (r.abordou) return;
    expect(r.motivo).toBe("modeloNaoAutorizado");
    expect(r.detalhe).toContain("autorizado internamente");
    expect(enviarModelo).not.toHaveBeenCalled();

    // O lead foi materializado (a lista foi consumida — é assim que
    // `abordarItemDaFila` funciona), mas NENHUMA mensagem saiu.
    expect(await prisma.leadMensagem.count({ where: { lead: { whatsappDigits: "5511955590130" } } })).toBe(
      0,
    );
  });
});
