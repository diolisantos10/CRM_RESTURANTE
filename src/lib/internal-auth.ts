/**
 * IDENTIDADE INTERNA DA FOOCCI.
 *
 * Até aqui o `/admin` inteiro era uma senha compartilhada (`src/lib/admin-auth.ts`,
 * `ADMIN_SECRET`). Isso funciona para uma pessoa e falha para uma empresa: sem
 * identidade não existe responsável por tarefa, autor de decisão, nem "quem
 * assumiu a conversa" — e o documento 02 exige que assumir seja atômico, o que
 * pressupõe saber quem assumiu.
 *
 * O model `User` não serve: pertence ao RESTAURANTE (`restaurantId` obrigatório,
 * `@@unique([email, restaurantId])`). É o funcionário do cliente.
 *
 * ── POR QUE NÃO ENTROU NO NextAuth ──
 *
 * O provider de credenciais da casa exige `restaurantSlug` para resolver o
 * tenant antes de achar o usuário. Enfiar o pessoal da Foocci ali obrigaria a
 * inventar um restaurante fictício para a própria empresa — e um tenant falso é
 * o tipo de atalho que volta como vazamento entre contas. A sessão interna vive
 * ao lado, com cookie próprio, sem tocar no caminho de autenticação do produto.
 *
 * ── CONVIVÊNCIA COM `ADMIN_SECRET` (ADR-003) ──
 *
 * A senha antiga continua abrindo o que já abria, com prazo e rastro. Duas
 * regras que valem sem exceção:
 *
 *   1. rota NOVA nasce exigindo sessão interna — `ADMIN_SECRET` não abre o novo;
 *   2. todo acesso por `ADMIN_SECRET` entra na trilha como `LEGACY_ADMIN_SECRET`.
 *
 * A segunda é o que transforma "ainda usamos a senha velha" de suposição em
 * número medido — e é esse número que sustenta a decisão de desligá-la.
 */

import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { checkAdminRequest } from "@/lib/admin-auth";
import type { InternalRole } from "@prisma/client";

export const INTERNAL_COOKIE = "foocci-internal-session";
const DURACAO_HORAS = 12;

/**
 * Segredo de assinatura.
 *
 * Nunca há valor padrão embutido: um segredo que está no repositório é
 * conhecido por qualquer pessoa que leia o repositório — não é segredo, é
 * decoração.
 *
 * ── POR QUE ISSO É TRAVA, E NÃO AVISO ──
 *
 * Em desenvolvimento, sortear um segredo por processo é aceitável: as sessões
 * morrem quando o servidor reinicia, e é só logar de novo.
 *
 * Em produção o mesmo comportamento é uma armadilha silenciosa. Cada instância
 * sortearia um segredo diferente, então a sessão feita numa instância seria
 * recusada pela vizinha — o usuário cairia para fora de forma intermitente, sem
 * erro nenhum no log, e alguém passaria uma semana caçando "bug de login".
 *
 * Por isso, em produção, a falta da variável não vira aviso: vira recusa. O
 * erro é lançado no uso, e não no import, para não derrubar `next build` em
 * máquina que legitimamente não tem o segredo (o build não assina sessão).
 */
const SEGREDO_DEV = randomBytes(32).toString("hex");

function segredo(): string {
  const configurado = process.env.INTERNAL_SESSION_SECRET;
  if (configurado && configurado.length >= 32) return configurado;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "INTERNAL_SESSION_SECRET ausente ou curta demais (mínimo 32 caracteres). " +
        "A sessão interna não é assinada com segredo sorteado em produção: " +
        "instâncias diferentes derrubariam o login umas das outras.",
    );
  }

  if (configurado) {
    // eslint-disable-next-line no-console
    console.warn(
      "[internal-auth] INTERNAL_SESSION_SECRET tem menos de 32 caracteres; " +
        "usando segredo sorteado. Em produção isso seria erro.",
    );
  }
  return SEGREDO_DEV;
}

function assinar(carga: string): string {
  return createHmac("sha256", segredo()).update(carga).digest("base64url");
}

function comparaSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export interface SessaoInterna {
  userId: string;
  nome: string;
  role: InternalRole;
  /** Departamentos a que a pessoa pertence. Vazio = nenhum. */
  departamentos: string[];
  /** Departamentos que a pessoa GERENCIA. Subconjunto do anterior. */
  gerencia: string[];
}

/** Serializa a sessão no cookie. Nunca carrega senha nem hash. */
export function criarCookieInterno(s: SessaoInterna): string {
  const expira = Date.now() + DURACAO_HORAS * 3_600_000;
  const carga = Buffer.from(
    JSON.stringify({ ...s, expira }),
    "utf8",
  ).toString("base64url");
  const valor = `${carga}.${assinar(carga)}`;

  return (
    `${INTERNAL_COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Strict; ` +
    `Max-Age=${DURACAO_HORAS * 3600}` +
    (process.env.NODE_ENV === "production" ? "; Secure" : "")
  );
}

export function cookieInternoDeSaida(): string {
  return `${INTERNAL_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

function decodificar(valor: string | undefined): SessaoInterna | null {
  if (!valor) return null;

  const ponto = valor.lastIndexOf(".");
  if (ponto <= 0) return null;

  const carga = valor.slice(0, ponto);
  const assinatura = valor.slice(ponto + 1);
  if (!comparaSeguro(assinar(carga), assinatura)) return null;

  try {
    const dados = JSON.parse(Buffer.from(carga, "base64url").toString("utf8"));
    if (typeof dados.expira !== "number" || dados.expira < Date.now()) return null;
    if (!dados.userId || !dados.role) return null;

    return {
      userId: String(dados.userId),
      nome: String(dados.nome ?? ""),
      role: dados.role as InternalRole,
      departamentos: Array.isArray(dados.departamentos) ? dados.departamentos : [],
      gerencia: Array.isArray(dados.gerencia) ? dados.gerencia : [],
    };
  } catch {
    return null;
  }
}

/** Lê a sessão em Server Component. */
export function lerSessaoInterna(): SessaoInterna | null {
  try {
    return decodificar(cookies().get(INTERNAL_COOKIE)?.value);
  } catch {
    return null;
  }
}

/** Lê a sessão em Route Handler. */
export function lerSessaoInternaDaRequest(req: NextRequest): SessaoInterna | null {
  return decodificar(req.cookies.get(INTERNAL_COOKIE)?.value);
}

/**
 * Autentica e monta a sessão.
 *
 * Devolve `null` para senha errada, usuário inativo e usuário inexistente — as
 * três com a MESMA resposta. Distinguir "esse email não existe" de "a senha
 * está errada" entrega a lista de quem trabalha aqui a quem estiver testando.
 *
 * `AGENTE_IA` nunca entra por aqui, mesmo com hash gravado: é ator técnico, e
 * ator técnico que faz login vira credencial de gente.
 */
export async function autenticarInterno(
  email: string,
  senha: string,
): Promise<SessaoInterna | null> {
  const alvo = email.trim().toLowerCase();
  if (!alvo || !senha) return null;

  const user = await prisma.internalUser.findUnique({
    where: { email: alvo },
    include: { memberships: { include: { department: true } } },
  });

  if (!user || !user.isActive || !user.passwordHash) return null;
  if (user.role === "AGENTE_IA") return null;
  if (!(await compare(senha, user.passwordHash))) return null;

  // ⛔⛔ A SENHA PROVISÓRIA VENCE — e esta é a segunda metade da trava.
  //
  // A primeira é de PODER: quem deve trocar só abre a tela de trocar (o portão
  // dos layouts). Esta é de TEMPO, e ela existe porque o aviso com a senha
  // viaja pela caixa do Connect, que é **append-only**: o texto fica lá para
  // sempre. Um segredo que fica escrito para sempre tem de deixar de valer
  // sozinho — senão "provisória" é só um adjetivo.
  //
  // ⚠️ A recusa é a MESMA de senha errada: `null`. Dizer "sua provisória
  // venceu" confirmaria, a quem estivesse testando senhas, que aquela senha um
  // dia foi boa — e que aquele e-mail existe.
  const venceu =
    user.deveTrocarSenha &&
    user.senhaProvisoriaExpiraEm !== null &&
    user.senhaProvisoriaExpiraEm.getTime() < Date.now();
  if (venceu) return null;

  return {
    userId: user.id,
    nome: user.nome,
    role: user.role,
    departamentos: user.memberships.map((m) => m.department.slug),
    gerencia: user.memberships.filter((m) => m.isManager).map((m) => m.department.slug),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RBAC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quem enxerga a empresa inteira.
 *
 * Lista fechada de propósito: crescer o alcance passa a ser uma linha de código
 * revisável, não um efeito colateral de alguém ganhar um papel novo.
 */
const PAPEIS_GLOBAIS: ReadonlySet<InternalRole> = new Set<InternalRole>([
  "MASTER_CEO",
  "DIRETOR_FOOCCI",
]);

export function enxergaTudo(s: SessaoInterna): boolean {
  return PAPEIS_GLOBAIS.has(s.role);
}

/** A sessão pode LER este departamento? */
export function podeLerDepartamento(s: SessaoInterna, slug: string): boolean {
  return enxergaTudo(s) || s.departamentos.includes(slug);
}

/**
 * A sessão pode ADMINISTRAR este departamento?
 *
 * Pertencer não basta. Gerente de Vendas administra Vendas; quem só é membro
 * de Vendas, não — senão "escopo departamental" viraria "todo mundo do
 * departamento manda no departamento".
 */
export function podeAdministrarDepartamento(s: SessaoInterna, slug: string): boolean {
  return enxergaTudo(s) || s.gerencia.includes(slug);
}

/**
 * Quem pode circular pelo Admin fora do próprio escopo.
 *
 * ── POR QUE ISTO É UMA FUNÇÃO E NÃO UM `if` espalhado por rota ──
 *
 * O critério 6 do CEO é curto e duro: *"SDR humano visualiza somente a Sala de
 * Vendas autorizada"*. A tentação é resolver escondendo item de menu — e menu
 * escondido não é autorização: basta digitar a URL.
 *
 * Uma lista fechada, num lugar só, faz o alcance crescer por linha de código
 * revisável em vez de por descuido. Se amanhã alguém quiser dar Admin geral ao
 * `AGENTE_HUMANO`, tem que vir aqui e explicar por quê no diff.
 *
 * `AUDITOR_QA` fica de fora de propósito: ele lê muito, mas o que ele lê é a
 * trilha e as conversas que audita — não o Admin inteiro.
 */
const PAPEIS_DE_ADMIN_GERAL: ReadonlySet<InternalRole> = new Set<InternalRole>([
  "MASTER_CEO",
  "DIRETOR_FOOCCI",
]);

export function podeVerAdminGeral(s: SessaoInterna): boolean {
  return PAPEIS_DE_ADMIN_GERAL.has(s.role);
}

/**
 * O escopo de departamentos de uma sessão, pronto para virar filtro de consulta.
 *
 * `"tudo"` para quem enxerga a empresa inteira; a lista de departamentos para os
 * demais.
 *
 * Existe para que o filtro entre na CONSULTA ao banco, e não só na rota. A rota
 * protege o endereço; a consulta protege o dado. Basta um parâmetro esquecido
 * para a consulta devolver a base inteira e a tela mostrar tudo — que é o
 * defeito clássico de RBAC que só vive na porta.
 */
export function escopoDeDepartamentos(s: SessaoInterna): "tudo" | string[] {
  return enxergaTudo(s) ? "tudo" : [...s.departamentos];
}

export type ResultadoDeAutorizacao =
  | { ok: true; sessao: SessaoInterna }
  | { ok: false; status: 401 | 403; motivo: string; sessao: SessaoInterna | null };

export interface ExigenciaInterna {
  /** Papéis aceitos. Vazio ou ausente = qualquer sessão válida serve. */
  papeis?: readonly InternalRole[];
  /** Slug do departamento em jogo. */
  departamento?: string;
  /** `true` exige gerência do departamento, não só pertencimento. */
  administrar?: boolean;
}

/**
 * O portão. Roda no SERVIDOR — esconder botão não é autorização, e o documento
 * 02 diz isso com todas as letras.
 *
 * Rota nova NÃO aceita `ADMIN_SECRET` (ADR-003): a porta velha não abre o que
 * é novo.
 */
export function autorizarInterno(
  req: NextRequest,
  exigencia: ExigenciaInterna = {},
): ResultadoDeAutorizacao {
  const sessao = lerSessaoInternaDaRequest(req);

  if (!sessao) {
    return { ok: false, status: 401, motivo: "sem sessão interna", sessao: null };
  }

  if (exigencia.papeis?.length && !exigencia.papeis.includes(sessao.role)) {
    return {
      ok: false,
      status: 403,
      motivo: `papel ${sessao.role} não atende; exige ${exigencia.papeis.join(" ou ")}`,
      sessao,
    };
  }

  if (exigencia.departamento) {
    const permitido = exigencia.administrar
      ? podeAdministrarDepartamento(sessao, exigencia.departamento)
      : podeLerDepartamento(sessao, exigencia.departamento);

    if (!permitido) {
      return {
        ok: false,
        status: 403,
        motivo: exigencia.administrar
          ? `não gerencia o departamento ${exigencia.departamento}`
          : `não pertence ao departamento ${exigencia.departamento}`,
        sessao,
      };
    }
  }

  return { ok: true, sessao };
}

/**
 * Quem está agindo, para a trilha.
 *
 * Uma requisição com sessão interna é a pessoa. Sem sessão, mas com a senha
 * antiga válida, é `LEGACY_ADMIN_SECRET` — e é assim que a convivência do
 * ADR-003 fica medida em vez de suposta. Sem nenhuma das duas, é anônimo.
 */
export function identificarAtor(req: NextRequest): {
  actorType: "INTERNAL_USER" | "LEGACY_ADMIN_SECRET" | "ANONIMO";
  actorId: string | null;
  actorLabel: string;
} {
  const sessao = lerSessaoInternaDaRequest(req);
  if (sessao) {
    return { actorType: "INTERNAL_USER", actorId: sessao.userId, actorLabel: sessao.nome };
  }
  if (checkAdminRequest(req)) {
    return {
      actorType: "LEGACY_ADMIN_SECRET",
      actorId: null,
      actorLabel: "senha compartilhada (ADMIN_SECRET)",
    };
  }
  return { actorType: "ANONIMO", actorId: null, actorLabel: "anônimo" };
}
