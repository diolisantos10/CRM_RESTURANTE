/**
 * SEMEIA A ACADEMIA COMERCIAL — lê o conteúdo pesquisado e escreve no banco.
 *
 *   npx tsx scripts/semear-academia-comercial.ts
 *
 * ── O QUE ISTO FAZ, E O QUE NÃO FAZ ──────────────────────────────────────────
 *
 * Lê `docs/academia-comercial/academia-comercial-v1.json` — pesquisa já feita
 * e citada, com fonte pública e data de consulta em cada princípio — e cria
 * UMA `AcademiaComercialVersao` (`numero: 1`, `situacao: RASCUNHO`) com os
 * `AcademiaComercialItem` correspondentes a cada seção do documento.
 *
 * ⛔ NUNCA PUBLICA. Uma versão nasce `RASCUNHO` sempre — publicar é ato humano
 * separado (rota administrativa, `supervisora/academiaInterruptor.ts`), porque
 * decidir que a Supervisora passa a JULGAR com este material é decisão de
 * gente, não efeito colateral de rodar um script.
 *
 * Não toca no CONTEÚDO do JSON: copia campo a campo. Mudar o texto sem nova
 * pesquisa quebraria a rastreabilidade fonte→princípio que o documento existe
 * para garantir.
 *
 * ── IDEMPOTENTE POR RECUSA ────────────────────────────────────────────────────
 *
 * Já existe uma versão `numero: 1`? O script recusa rodar de novo e não toca
 * em nada — rodar duas vezes não duplica porque a segunda vez nem tenta
 * escrever. Uma nova pesquisa vira `numero: 2`, escrita por outra ferramenta;
 * este script é só a porta de entrada da v1.
 */

import { readFileSync } from "fs";
import path from "path";
import { PrismaClient, type CategoriaDaAcademia, type EtapaComercial } from "@prisma/client";

const CAMINHO_DO_JSON = path.join(__dirname, "..", "docs", "academia-comercial", "academia-comercial-v1.json");

// ── O FORMATO DO JSON DE ORIGEM (ver o arquivo para os valores reais) ───────

interface Fonte {
  id: string;
  titulo: string;
  url: string;
  consultadoEm: string;
}

interface ItemComFonte {
  id: string;
  etapa?: string;
  titulo?: string;
  conteudo?: string;
  tags?: string[];
  fonte: string;
  fonteData: string;
}

interface ItemDeExemplo {
  id: string;
  etapa: string;
  ruim: string;
  corrigido: string;
  porque: string;
  fonte: string;
  fonteData: string;
}

interface ItemDeSinal {
  id: string;
  gravidade: string;
  titulo: string;
  conteudo: string;
  tags?: string[];
  fonte: string;
  fonteData: string;
}

interface AcademiaJson {
  versao: number;
  nome: string;
  criadaEm: string;
  metodologia: string;
  fontes: Fonte[];
  regrasObrigatorias: ItemComFonte[];
  comportamentosProibidos: ItemComFonte[];
  exemplos: ItemDeExemplo[];
  sinaisDeRisco: ItemDeSinal[];
  criteriosDeVeredito: Record<string, string>;
  orientacaoPorEtapa: Record<string, string>;
}

const ETAPAS_VALIDAS = new Set<EtapaComercial>([
  "PROSPECCAO",
  "QUALIFICACAO",
  "DEMONSTRACAO",
  "OBJECAO",
  "FECHAMENTO",
  "GERAL",
]);

function comoEtapa(bruta: string, contexto: string): EtapaComercial {
  if (!ETAPAS_VALIDAS.has(bruta as EtapaComercial)) {
    throw new Error(`etapa desconhecida "${bruta}" em ${contexto} — schema.prisma precisa ser atualizado antes`);
  }
  return bruta as EtapaComercial;
}

/** kebab-case → frase legível, só para dar um `titulo` a itens que no JSON
 *  não têm um (os `exemplos`, que só têm `ruim`/`corrigido`/`porque`). */
function legivel(chave: string): string {
  return chave
    .split("-")
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join(" ");
}

interface ItemPreparado {
  categoria: CategoriaDaAcademia;
  etapa: EtapaComercial | null;
  chaveOriginal: string;
  titulo: string;
  conteudo: string;
  ruim?: string | null;
  corrigido?: string | null;
  tags: string[];
  fonteUrl: string | null;
  fonteData: string | null;
}

function prepararItens(json: AcademiaJson): ItemPreparado[] {
  const fontesPorId = new Map(json.fontes.map((f) => [f.id, f]));

  function resolverFonte(fonteId: string, contexto: string): string {
    const f = fontesPorId.get(fonteId);
    if (!f) throw new Error(`fonte "${fonteId}" referenciada em ${contexto} não existe em \`fontes\``);
    return f.url;
  }

  const itens: ItemPreparado[] = [];

  for (const r of json.regrasObrigatorias) {
    itens.push({
      categoria: "REGRA_OBRIGATORIA",
      etapa: comoEtapa(r.etapa ?? "GERAL", `regrasObrigatorias/${r.id}`),
      chaveOriginal: r.id,
      titulo: r.titulo ?? legivel(r.id),
      conteudo: r.conteudo ?? "",
      tags: r.tags ?? [],
      fonteUrl: resolverFonte(r.fonte, `regrasObrigatorias/${r.id}`),
      fonteData: r.fonteData,
    });
  }

  for (const p of json.comportamentosProibidos) {
    itens.push({
      categoria: "COMPORTAMENTO_PROIBIDO",
      etapa: comoEtapa(p.etapa ?? "GERAL", `comportamentosProibidos/${p.id}`),
      chaveOriginal: p.id,
      titulo: p.titulo ?? legivel(p.id),
      conteudo: p.conteudo ?? "",
      tags: p.tags ?? [],
      fonteUrl: resolverFonte(p.fonte, `comportamentosProibidos/${p.id}`),
      fonteData: p.fonteData,
    });
  }

  for (const e of json.exemplos) {
    itens.push({
      categoria: "EXEMPLO",
      etapa: comoEtapa(e.etapa, `exemplos/${e.id}`),
      chaveOriginal: e.id,
      titulo: legivel(e.id),
      // O "conteúdo" de um exemplo é a explicação — o par ruim/corrigido vive
      // em campos próprios, não duplicado aqui dentro do texto.
      conteudo: e.porque,
      ruim: e.ruim,
      corrigido: e.corrigido,
      tags: [],
      fonteUrl: resolverFonte(e.fonte, `exemplos/${e.id}`),
      fonteData: e.fonteData,
    });
  }

  for (const s of json.sinaisDeRisco) {
    itens.push({
      categoria: "SINAL_DE_RISCO",
      etapa: null, // sinal de risco vale em qualquer etapa da conversa
      chaveOriginal: s.id,
      titulo: s.titulo,
      conteudo: s.conteudo,
      // A gravidade (AMARELO/VERMELHO) não tem coluna própria — carregada como
      // tag para não abrir uma coluna só para uma categoria.
      tags: [...(s.tags ?? []), `gravidade:${s.gravidade.toLowerCase()}`],
      fonteUrl: resolverFonte(s.fonte, `sinaisDeRisco/${s.id}`),
      fonteData: s.fonteData,
    });
  }

  for (const [veredito, texto] of Object.entries(json.criteriosDeVeredito)) {
    itens.push({
      categoria: "CRITERIO_VEREDITO",
      etapa: null, // um critério de veredito julga a mensagem inteira, não uma etapa
      chaveOriginal: `criterio-${veredito.toLowerCase()}`,
      titulo: veredito,
      conteudo: texto,
      tags: [`veredito:${veredito.toLowerCase()}`],
      // Síntese editorial do documento inteiro — sem uma fonte única por item
      // (ver o comentário em `schema.prisma`, campo `fonteUrl`).
      fonteUrl: null,
      fonteData: null,
    });
  }

  for (const [etapaBruta, texto] of Object.entries(json.orientacaoPorEtapa)) {
    itens.push({
      categoria: "ORIENTACAO_DE_ETAPA",
      etapa: comoEtapa(etapaBruta, `orientacaoPorEtapa/${etapaBruta}`),
      chaveOriginal: `orientacao-${etapaBruta.toLowerCase()}`,
      titulo: `Orientação — ${etapaBruta}`,
      conteudo: texto,
      tags: [],
      fonteUrl: null,
      fonteData: null,
    });
  }

  return itens;
}

function p(t = "") {
  console.log(t);
}

export type ResultadoDoSeed =
  | { ok: true; jaExistia: false; versaoId: string; totalDeItens: number; porCategoria: Record<string, number> }
  | { ok: true; jaExistia: true; versaoId: string; situacao: string };

/**
 * O CORAÇÃO DO SCRIPT, exportado à parte do `main()` (CLI) para o teste
 * (`scripts/jornada-academia-comercial.test.ts`) poder chamar diretamente
 * contra a MESMA conexão de banco da jornada — sem `require.main === module`
 * este arquivo rodaria a semeadura no simples ato de importar, o que o teste
 * não pode controlar. `main()`, abaixo, é só a casca de linha de comando.
 */
export async function semearAcademiaComercial(
  db: PrismaClient,
  opts: { caminhoDoJson?: string } = {},
): Promise<ResultadoDoSeed> {
  const bruto = readFileSync(opts.caminhoDoJson ?? CAMINHO_DO_JSON, "utf-8");
  const json = JSON.parse(bruto) as AcademiaJson;

  if (json.versao !== 1) {
    throw new Error(`este script semeia a v1; o JSON declara versao=${json.versao} — use a ferramenta certa para essa versão`);
  }

  const existente = await db.academiaComercialVersao.findFirst({ where: { numero: 1 } });
  if (existente) {
    return { ok: true, jaExistia: true, versaoId: existente.id, situacao: existente.situacao };
  }

  const itens = prepararItens(json);

  const versao = await db.$transaction(async (tx) => {
    const v = await tx.academiaComercialVersao.create({
      data: {
        numero: 1,
        situacao: "RASCUNHO",
        notaDaVersao: `${json.nome} — criada em ${json.criadaEm}. Metodologia: ${json.metodologia}`,
      },
    });

    await tx.academiaComercialItem.createMany({
      data: itens.map((i) => ({
        versaoId: v.id,
        categoria: i.categoria,
        etapa: i.etapa,
        chaveOriginal: i.chaveOriginal,
        titulo: i.titulo,
        conteudo: i.conteudo,
        ruim: i.ruim ?? null,
        corrigido: i.corrigido ?? null,
        tags: i.tags,
        fonteUrl: i.fonteUrl,
        fonteData: i.fonteData,
      })),
    });

    return v;
  });

  const porCategoria = itens.reduce<Record<string, number>>((acc, i) => {
    acc[i.categoria] = (acc[i.categoria] ?? 0) + 1;
    return acc;
  }, {});

  return { ok: true, jaExistia: false, versaoId: versao.id, totalDeItens: itens.length, porCategoria };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const r = await semearAcademiaComercial(prisma);

    if (r.jaExistia) {
      p(`⛔ Já existe a versão numero=1 (id=${r.versaoId}, situacao=${r.situacao}). Nada foi escrito.`);
      p("   Rodar este script de novo não duplica — ele recusa e para aqui.");
      return;
    }

    p(`═══ SEMEANDO A ACADEMIA COMERCIAL v1 — ${r.totalDeItens} item(ns) ═══`);
    p(`\n✅ Versão criada: id=${r.versaoId}, numero=1, situacao=RASCUNHO`);
    for (const [cat, n] of Object.entries(r.porCategoria)) p(`   ${cat}: ${n}`);
    p(`\n⚠️ RASCUNHO — nada muda no comportamento da Supervisora até alguém publicar esta versão explicitamente.`);
  } finally {
    await prisma.$disconnect();
  }
}

// ⛔ Só roda sozinho quando EXECUTADO (`npx tsx scripts/semear-academia-comercial.ts`),
// nunca quando IMPORTADO — é isto que permite ao teste importar
// `semearAcademiaComercial` sem disparar uma segunda semeadura de brinde.
if (require.main === module) {
  main().catch((e) => {
    console.error("❌", e instanceof Error ? (e.stack ?? e.message) : e);
    process.exitCode = 1;
  });
}
