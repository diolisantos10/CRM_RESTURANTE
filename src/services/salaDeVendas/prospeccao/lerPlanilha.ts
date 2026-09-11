/**
 * LER A PLANILHA — o texto colado vira linhas de lista, sem trocar as colunas.
 *
 * ── POR QUE ISTO É UM ARQUIVO PRÓPRIO, E TESTADO ────────────────────────────
 *
 * Este é o ponto onde um erro não aparece: uma coluna trocada não quebra nada,
 * não gera exceção e não pinta nada de vermelho. Ela só faz a Foocci mandar
 * mensagem chamando o restaurante pelo telefone e o telefone pelo nome — e
 * quem descobre é o dono do restaurante, recebendo "Olá 5511988887777".
 *
 * Por isso a leitura é PURA, mora longe da tela, e devolve **o que entendeu de
 * cada coluna** junto com as linhas. A tela é obrigada a mostrar esse mapa
 * antes de importar. Ninguém aperta o botão às cegas.
 *
 * ── ⚠️ O QUE ELE NÃO FAZ ────────────────────────────────────────────────────
 *
 * Não valida telefone de verdade, não deduplica e não fala com banco — quem faz
 * isso é `importarLote`, que já existia e é bom nisso. Aqui é só transformar
 * texto em linhas, dizendo o que entendeu.
 */

export interface LinhaLida {
  nome: string | null;
  whatsapp: string;
  empresa: string | null;
  cidade: string | null;
  estado: string | null;
  tipo: string | null;

  // ── ⭐ AMPLIAÇÃO DA BASE FRIA, 11/09/2026 — ver ItemDeProspeccao no schema ──
  email: string | null;
  cargo: string | null;
  telefoneSecundario: string | null;
  bairro: string | null;
  endereco: string | null;
  cep: string | null;
  cnpj: string | null;
  instagram: string | null;
  site: string | null;
  googleMapsUrl: string | null;
  /** `null` quando a coluna não veio, ou veio e não é um número. */
  numeroDeUnidades: number | null;
  /** Uma célula "iFood, Rappi, WhatsApp" vira três — ver `pegaLista`. */
  canaisAtuais: string[];
  observacoes: string | null;
  tags: string[];
}

/** O que cada coluna do arquivo virou. É isto que a tela mostra ao operador. */
export type CampoConhecido =
  | "nome"
  | "whatsapp"
  | "empresa"
  | "cidade"
  | "estado"
  | "tipo"
  | "email"
  | "cargo"
  | "telefoneSecundario"
  | "bairro"
  | "endereco"
  | "cep"
  | "cnpj"
  | "instagram"
  | "site"
  | "googleMapsUrl"
  | "numeroDeUnidades"
  | "canaisAtuais"
  | "observacoes"
  | "tags";

/**
 * O rótulo que a tela mostra para cada campo — fonte única, para
 * `ReceberLista.tsx` (importação) e a prévia da conferência nunca dizerem
 * coisas diferentes para o mesmo campo.
 */
export const ROTULO_DO_CAMPO: Record<CampoConhecido, string> = {
  nome: "Nome do responsável",
  whatsapp: "WhatsApp principal",
  empresa: "Restaurante / Empresa",
  cidade: "Cidade",
  estado: "Estado (UF)",
  tipo: "Tipo de restaurante",
  email: "E-mail",
  cargo: "Cargo / função",
  telefoneSecundario: "Telefone secundário",
  bairro: "Bairro",
  endereco: "Endereço",
  cep: "CEP",
  cnpj: "CNPJ",
  instagram: "Instagram",
  site: "Site",
  googleMapsUrl: "URL do Google Maps",
  numeroDeUnidades: "Número de unidades",
  canaisAtuais: "Canais atuais / marketplaces",
  observacoes: "Observações",
  tags: "Tags",
};

export interface ColunaLida {
  /** Como veio escrito no arquivo (ou "coluna 3" quando não há cabeçalho). */
  titulo: string;
  /** Para onde vai. `null` = a coluna é ignorada. */
  campo: CampoConhecido | null;
  /** Como a decisão foi tomada — vai para a tela, para ninguém adivinhar. */
  porque: "cabecalho" | "conteudo" | "ignorada";
}

export interface LeituraDaPlanilha {
  linhas: LinhaLida[];
  colunas: ColunaLida[];
  /** Linhas que vieram sem nada parecido com telefone. Não entram. */
  descartadas: number;
  separador: "," | ";" | "\t";
  temCabecalho: boolean;
}

/**
 * Cabeçalhos que a casa reconhece, já sem acento e em minúscula.
 *
 * ── ⭐ AMPLIAÇÃO PARA EXPORTADORES DO GOOGLE MAPS, 11/09/2026 ────────────────
 *
 * Achado do CEO: 751 contatos entraram só com nome e telefone — cidade,
 * endereço e tipo ficaram de fora porque os exportadores de Google Maps
 * (Outscraper, Apify e afins) escrevem em inglês, e o dicionário só
 * reconhecia português. `name` é o NOME DO ESTABELECIMENTO nesses arquivos —
 * não de uma pessoa —, e por isso cai em `empresa`, no mesmo grupo de
 * `title`/`business name`/`company`, exatamente como o telefone secundário já
 * caía em `telefoneSecundario` e não em `whatsapp`.
 */
const CABECALHOS: Readonly<Record<string, CampoConhecido>> = {
  nome: "nome",
  contato: "nome",
  responsavel: "nome",
  proprietario: "nome",

  whatsapp: "whatsapp",
  telefone: "whatsapp",
  celular: "whatsapp",
  fone: "whatsapp",
  zap: "whatsapp",
  numero: "whatsapp",
  // ── Google Maps / exportadores em inglês ──
  phone: "whatsapp",
  phonenumber: "whatsapp",
  mobile: "whatsapp",

  empresa: "empresa",
  restaurante: "empresa",
  estabelecimento: "empresa",
  negocio: "empresa",
  razaosocial: "empresa",
  nomefantasia: "empresa",
  // ── Google Maps / exportadores em inglês — "name" é o nome DO LOCAL ──
  name: "empresa",
  title: "empresa",
  businessname: "empresa",
  company: "empresa",

  cidade: "cidade",
  municipio: "cidade",
  city: "cidade",
  locality: "cidade",

  estado: "estado",
  uf: "estado",
  state: "estado",
  region: "estado",

  tipo: "tipo",
  categoria: "tipo",
  segmento: "tipo",
  category: "tipo",
  categoryname: "tipo",
  primarycategory: "tipo",
  restauranttype: "tipo",

  // ── ⭐ AMPLIAÇÃO DA BASE FRIA, 11/09/2026 ────────────────────────────────
  email: "email",
  correioeletronico: "email",

  cargo: "cargo",
  funcao: "cargo",
  posicao: "cargo",

  telefonesecundario: "telefoneSecundario",
  telefone2: "telefoneSecundario",
  segundotelefone: "telefoneSecundario",
  telefonealternativo: "telefoneSecundario",
  fixo: "telefoneSecundario",

  bairro: "bairro",
  distrito: "bairro",
  neighborhood: "bairro",
  district: "bairro",

  endereco: "endereco",
  logradouro: "endereco",
  rua: "endereco",
  address: "endereco",
  fulladdress: "endereco",
  formattedaddress: "endereco",

  cep: "cep",

  cnpj: "cnpj",

  instagram: "instagram",
  insta: "instagram",

  site: "site",
  website: "site",

  googlemaps: "googleMapsUrl",
  maps: "googleMapsUrl",
  linkdomaps: "googleMapsUrl",
  urlgooglemaps: "googleMapsUrl",
  localizacao: "googleMapsUrl",

  unidades: "numeroDeUnidades",
  numerodeunidades: "numeroDeUnidades",
  qtdunidades: "numeroDeUnidades",
  quantidadedeunidades: "numeroDeUnidades",

  canais: "canaisAtuais",
  canaisatuais: "canaisAtuais",
  marketplaces: "canaisAtuais",

  observacoes: "observacoes",
  obs: "observacoes",
  notas: "observacoes",

  tags: "tags",
  etiquetas: "tags",
};

/** Sem acento, sem espaço, sem pontuação — para `Razão Social` casar com `razaosocial`. */
function normalizar(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Parece telefone brasileiro?
 *
 * Deliberadamente frouxo: 10 a 13 dígitos, a mesma régua de
 * `telefonePlausivel`. Apertar aqui faria a leitura descartar linha boa antes
 * de o operador ver — e o descarte silencioso é pior que a linha ruim, que pelo
 * menos aparece na conferência de `importarLote`.
 */
export function pareceTelefone(v: string): boolean {
  const d = v.replace(/\D/g, "");
  return d.length >= 10 && d.length <= 13;
}

/** Vírgula, ponto-e-vírgula ou tabulação — o que aparecer mais na primeira linha. */
export function detectarSeparador(primeiraLinha: string): "," | ";" | "\t" {
  const contagem = {
    ",": (primeiraLinha.match(/,/g) ?? []).length,
    ";": (primeiraLinha.match(/;/g) ?? []).length,
    "\t": (primeiraLinha.match(/\t/g) ?? []).length,
  };
  // Empate vai para a vírgula, que é o formato mais comum de exportação.
  if (contagem["\t"] > contagem[","] && contagem["\t"] > contagem[";"]) return "\t";
  if (contagem[";"] > contagem[","]) return ";";
  return ",";
}

/**
 * Uma linha de CSV, respeitando aspas.
 *
 * `"Bar do Zé, o melhor",1199...` tem DUAS colunas, não três. Sem isto, todo
 * nome com vírgula empurra o telefone para a coluna seguinte — e o erro só
 * aparece na mensagem que chega ao cliente.
 */
export function quebrarLinha(linha: string, sep: string): string[] {
  const campos: string[] = [];
  let atual = "";
  let dentroDeAspas = false;

  for (let i = 0; i < linha.length; i++) {
    const c = linha[i]!;

    if (c === '"') {
      // Aspas duplicadas dentro de aspas são uma aspa literal.
      if (dentroDeAspas && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else {
        dentroDeAspas = !dentroDeAspas;
      }
      continue;
    }

    if (c === sep && !dentroDeAspas) {
      campos.push(atual.trim());
      atual = "";
      continue;
    }

    atual += c;
  }

  campos.push(atual.trim());
  return campos;
}

/**
 * Lê o texto e diz o que entendeu.
 *
 * A ordem importa: primeiro tenta pelo CABEÇALHO, que é a intenção declarada de
 * quem montou o arquivo. Só quando não há cabeçalho reconhecível é que olha o
 * CONTEÚDO — e conteúdo é palpite, mesmo quando acerta.
 */
export function lerPlanilha(texto: string): LeituraDaPlanilha {
  const cruas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (cruas.length === 0) {
    return { linhas: [], colunas: [], descartadas: 0, separador: ",", temCabecalho: false };
  }

  const separador = detectarSeparador(cruas[0]!);
  const grade = cruas.map((l) => quebrarLinha(l, separador));
  const largura = Math.max(...grade.map((l) => l.length));

  // ── O cabeçalho, se houver ──
  const primeira = grade[0]!;
  const mapaDoCabecalho = primeira.map((t) => CABECALHOS[normalizar(t)] ?? null);
  // Exige que o cabeçalho traga um telefone. Uma linha de dados cujo primeiro
  // campo por acaso se chame "tipo" não pode virar cabeçalho e sumir da lista.
  const temCabecalho = mapaDoCabecalho.includes("whatsapp");

  const corpo = temCabecalho ? grade.slice(1) : grade;

  // ── As colunas ──
  const colunas: ColunaLida[] = [];

  if (temCabecalho) {
    for (let i = 0; i < largura; i++) {
      const titulo = primeira[i]?.trim() || `coluna ${i + 1}`;
      const campo = mapaDoCabecalho[i] ?? null;
      colunas.push({ titulo, campo, porque: campo ? "cabecalho" : "ignorada" });
    }
  } else {
    // Sem cabeçalho: a coluna com mais cara de telefone é o telefone; a
    // primeira coluna de texto que sobra é o nome; a segunda é a empresa.
    const placar = Array.from({ length: largura }, (_, i) =>
      corpo.reduce((n, l) => n + (pareceTelefone(l[i] ?? "") ? 1 : 0), 0),
    );
    const iTelefone = placar.indexOf(Math.max(...placar));
    const temTelefone = placar[iTelefone]! > 0;

    let textoVisto = 0;
    for (let i = 0; i < largura; i++) {
      const titulo = `coluna ${i + 1}`;
      if (temTelefone && i === iTelefone) {
        colunas.push({ titulo, campo: "whatsapp", porque: "conteudo" });
        continue;
      }
      textoVisto += 1;
      if (textoVisto === 1) colunas.push({ titulo, campo: "nome", porque: "conteudo" });
      else if (textoVisto === 2) colunas.push({ titulo, campo: "empresa", porque: "conteudo" });
      else colunas.push({ titulo, campo: null, porque: "ignorada" });
    }
  }

  const onde = (campo: CampoConhecido): number => colunas.findIndex((c) => c.campo === campo);
  const iWhats = onde("whatsapp");

  const linhas: LinhaLida[] = [];
  let descartadas = 0;

  for (const l of corpo) {
    const whatsapp = iWhats >= 0 ? (l[iWhats] ?? "").trim() : "";

    // Sem telefone não há o que abordar. Contado e mostrado, nunca sumido.
    if (!whatsapp || !pareceTelefone(whatsapp)) {
      descartadas += 1;
      continue;
    }

    const pega = (campo: CampoConhecido): string | null => {
      const i = onde(campo);
      const v = i >= 0 ? (l[i] ?? "").trim() : "";
      return v || null;
    };

    const numeroDeUnidades = pega("numeroDeUnidades");
    const canaisAtuais = pega("canaisAtuais");
    const tags = pega("tags");

    linhas.push({
      nome: pega("nome"),
      whatsapp,
      empresa: pega("empresa"),
      cidade: pega("cidade"),
      estado: pega("estado"),
      tipo: pega("tipo"),
      email: pega("email"),
      cargo: pega("cargo"),
      telefoneSecundario: pega("telefoneSecundario"),
      bairro: pega("bairro"),
      endereco: pega("endereco"),
      cep: pega("cep"),
      cnpj: pega("cnpj"),
      instagram: pega("instagram"),
      site: pega("site"),
      googleMapsUrl: pega("googleMapsUrl"),
      numeroDeUnidades: numeroDeUnidades ? paraNumero(numeroDeUnidades) : null,
      canaisAtuais: canaisAtuais ? dividirEmLista(canaisAtuais) : [],
      observacoes: pega("observacoes"),
      tags: tags ? dividirEmLista(tags) : [],
    });
  }

  return { linhas, colunas, descartadas, separador, temCabecalho };
}

/** Divide uma célula de lista: `"iFood, Rappi; WhatsApp"` → três valores. */
export function dividirEmLista(v: string): string[] {
  return v
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Um inteiro positivo lido de uma célula, ou `null` quando não é um número. */
export function paraNumero(v: string): number | null {
  const n = Number(v.replace(/\D/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
