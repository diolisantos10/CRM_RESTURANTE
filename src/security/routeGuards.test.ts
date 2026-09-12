/**
 * Structural security gates (guardrail 4: "código é trava, não prompt").
 *
 * A disciplina de multi-tenant e de auth de admin era mantida por HÁBITO. Estes
 * dois gates falham o build e impedem que a classe inteira de furo reentre — é a
 * raiz da rota-fantasma `/api/admin/delivery-quote` (CR de segurança 03/08/2026,
 * item A2), que estava em PUBLIC_PATHS e confiava nos headers de tenant, que num
 * caminho público são INPUT DO ATACANTE.
 *
 * GATE (a) — Nenhuma rota sob um prefixo de PUBLIC_PATHS pode usar os helpers de
 * tenant (`getTenantContext`/`getTenantId`/`assertTenant`/`getTenantIdFromRequest`
 * de `@/lib/tenant`). Em caminho público o middleware NÃO injeta/sobrescreve
 * `x-restaurant-id`/`x-user-role`, então confiar neles é bypass de autenticação
 * por spoof de header.
 *
 * GATE (b) — Toda rota sob `src/app/api/admin/**` precisa referenciar uma guarda
 * de admin conhecida (`guardAdmin`/`checkAdminRequest`), OU estar no allowlist
 * abaixo com justificativa (rotas que fazem auth inline de raw-secret ou que
 * EMITEM a credencial e por isso não podem exigi-la).
 *
 * A fonte da verdade das rotas públicas é `src/middleware.ts` — os regexes são
 * EXTRAÍDOS de lá, nunca duplicados, para que este teste acompanhe o middleware.
 * A mensagem de falha carrega o arquivo culpado (guardrail 6).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it, expect } from "vitest";

const API_DIR = join(process.cwd(), "src/app/api");
const MIDDLEWARE = join(process.cwd(), "src/middleware.ts");

// ── Extract PUBLIC_PATHS regexes straight from the middleware source ───────────
// The block runs from the `PUBLIC_PATHS` declaration to `function isPublicPath`.
// Every entry is a single-line regex literal `/^…$/`; comments never contain the
// `$/` terminator, so a non-greedy scan lifts each pattern cleanly.
const middlewareSrc = readFileSync(MIDDLEWARE, "utf8");
const publicBlock = middlewareSrc.slice(
  middlewareSrc.indexOf("PUBLIC_PATHS"),
  middlewareSrc.indexOf("function isPublicPath"),
);
const PUBLIC_REGEXES: RegExp[] = [...publicBlock.matchAll(/\/\^.*?\$\//g)].map(
  (m) => new RegExp(m[0].slice(1, -1)),
);

// ── Map a route.ts file to the URL path the middleware would see ───────────────
// Strip the trailing `/route.ts`, turn dynamic `[seg]`/`[...seg]` into a literal
// stand-in (public subtrees use `(/.*)?`, so any value matches), and drop Next
// route groups `(group)` which don't appear in the URL.
function routeUrl(file: string): string {
  const rel = relative(API_DIR, file).split(sep);
  rel.pop(); // drop "route.ts"
  const segments = rel
    .filter((s) => !(s.startsWith("(") && s.endsWith(")"))) // route groups
    .map((s) => (/^\[.*\]$/.test(s) ? "x" : s)); // dynamic params
  return "/api/" + segments.join("/");
}

function isPublicUrl(url: string): boolean {
  return PUBLIC_REGEXES.some((re) => re.test(url));
}

// ── Collect every route handler under src/app/api ──────────────────────────────
function collectRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectRoutes(full));
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

const ROUTES = collectRoutes(API_DIR);

// Tenant helpers that read the spoofable middleware headers. Barred in any route
// that lives under a public prefix.
const TENANT_HELPER =
  /\b(getTenantContext|getTenantId|assertTenant|getTenantIdFromRequest)\b/;

// Known admin guards. A route under /api/admin/** must reference one of these…
//
// `autorizarInterno` entrou na lista em 24/08/2026, com a identidade interna
// (`src/lib/internal-auth.ts`). Ele NÃO é uma exceção que "faz auth própria": é
// uma guarda de verdade, e mais forte que a senha compartilhada — exige sessão
// assinada, papel e escopo departamental, e escreve toda negativa na trilha.
//
// ADR-003 manda que rota NOVA nasça exigindo sessão interna e não aceite
// `ADMIN_SECRET`. Sem esta entrada, cumprir o ADR reprovaria neste portão, e o
// caminho de menor esforço para o próximo engenheiro seria voltar a usar a senha
// velha — que é exatamente o que o ADR existe para impedir.
//
// `guardarSalaDeVendas` entrou em 25/08/2026. Ele NÃO é uma guarda paralela: é
// um invólucro fino em cima de `autorizarInterno` que já traz a lista de papéis
// da Sala de Vendas e escreve a negativa na trilha. Rotas que o usam não
// mencionam `autorizarInterno` diretamente, e sem esta entrada o portão as
// acusaria de estarem sem guarda — empurrando o próximo engenheiro a duplicar a
// checagem em cada rota, que é como uma delas acaba ficando de fora.
//
// `guardarPainelDaSupervisora` entrou em 12/09/2026, pelo mesmo motivo de
// `guardarSalaDeVendas`: é o mesmo invólucro fino em cima de `autorizarInterno`
// (`_guardaDoPainel.ts`), só que com a lista de papéis do painel da Supervisora
// (gestão + auditor, sem o SDR) em vez da lista da Sala inteira.
const ADMIN_GUARD = /\b(guardAdmin|checkAdminRequest|autorizarInterno|guardarSalaDeVendas|guardarPainelDaSupervisora)\b/;

// …unless it is one of these vetted exceptions. Each does its OWN auth and cannot
// use the shared helper. Adding to this list is a conscious, reviewed act — a NEW
// admin route that merely "forgets" the guard still fails the build.
const ADMIN_GUARD_EXEMPT = new Map<string, string>([
  [
    "admin/pessoas/route.ts",
    "a área de RH: cria, lista e CORTA acesso de gente. Faz autorização própria e " +
      "MAIS ESTREITA que a guarda comum: exige `ADMIN_SECRET` ou sessão de " +
      "MASTER_CEO — nem o diretor entra. " +
      "A estreiteza é a decisão: quem cria acesso ESCOLHE O PAPEL, e portanto pode " +
      "criar outro CEO. A guarda genérica aceitaria qualquer sessão de admin, e " +
      "isso transformaria esta rota na porta pela qual qualquer pessoa do " +
      "administrativo vira dona da casa. " +
      "O `ADMIN_SECRET` continua valendo porque é por ele que o primeiro CEO nasce; " +
      "sem isso a casa começa trancada por fora. Não abre superfície nova: quem tem " +
      "o segredo já abre a empresa inteira. " +
      "O PATCH desativa (`isActive: false`) e nunca apaga — o nome de quem atendeu " +
      "cada cliente tem de sobreviver à saída da pessoa — e recusa cortar o último " +
      "CEO ativo, que seria trancar a casa por fora com todo mundo lá dentro.",
  ],
  [
    "admin/session/route.ts",
    "login de admin: valida o ADMIN_SECRET cru e EMITE o cookie; não pode exigir a sessão que ela mesma cria.",
  ],
  [
    "admin/session/interna/route.ts",
    "login por e-mail e senha: valida a credencial com bcrypt e EMITE o cookie de " +
      "sessão interna; não pode exigir a sessão que ela mesma cria. Recusa com uma " +
      "mensagem única para e-mail inexistente, senha errada e conta desativada.",
  ],
  [
    "admin/sala-de-vendas/primeiro-acesso/route.ts",
    "criação da PRIMEIRA pessoa da Foocci, sem terminal. Faz autorização própria e " +
      "MAIS ESTREITA que a guarda comum: exige `ADMIN_SECRET` ou sessão de " +
      "MASTER_CEO/DIRETOR_FOOCCI. A guarda genérica aceitaria qualquer sessão de " +
      "admin — e aqui isso seria escalada de privilégio pela porta dos fundos: um " +
      "AGENTE_HUMANO criaria um MASTER_CEO e viraria dono da casa. " +
      "Não abre superfície nova: quem tem o `ADMIN_SECRET` já abre a empresa inteira; " +
      "o que muda é trocar 'abrir um terminal em produção' por preencher um formulário.",
  ],
  [
    "admin/sala-de-vendas/time-de-agentes/route.ts",
    "põe um agente do time no sistema. Mesma autorização própria e MAIS ESTREITA " +
      "que a irmã `primeiro-acesso`: exige `ADMIN_SECRET` ou sessão de " +
      "MASTER_CEO/DIRETOR_FOOCCI, e não a guarda genérica, que aceitaria qualquer " +
      "sessão de admin. " +
      "É deliberadamente uma rota SEPARADA da de gente, e não um `if` dentro dela: " +
      "esta aqui não cria credencial nenhuma. Não importa `bcryptjs`, não sorteia " +
      "senha, não escreve `passwordHash`, e fixa o papel `AGENTE_IA` — que " +
      "`autenticarInterno` recusa mesmo com hash gravado. Um `if` compartilhado " +
      "devolveria senha ao agente no dia em que alguém o invertesse, e nada na tela " +
      "mostraria isso. " +
      "Nome e e-mail vêm da lista fixa em `timeDeAgentes.ts`, nunca do corpo do " +
      "pedido: aceitá-los deixaria uma chamada inventar um agente com o e-mail de " +
      "uma pessoa real, e o `upsert` cairia em cima do registro dela.",
  ],
  [
    "admin/reset-owner/route.ts",
    "recuperação de emergência (isento no early-exit do middleware); auth inline por x-admin-secret === ADMIN_SECRET.",
  ],
  [
    "admin/force-deploy/route.ts",
    "fallback de deploy operacional; auth inline por x-admin-secret === ADMIN_SECRET.",
  ],
]);

function apiRel(file: string): string {
  return relative(API_DIR, file).split(sep).join("/");
}

describe("security gates — route invariants", () => {
  it("finds the API route tree (sanity: the scan actually ran)", () => {
    expect(ROUTES.length).toBeGreaterThan(100);
    expect(PUBLIC_REGEXES.length).toBeGreaterThan(10);
  });

  // ── GATE (a) ────────────────────────────────────────────────────────────────
  it("no route under a PUBLIC_PATHS prefix uses a tenant helper (spoofable headers)", () => {
    const offenders: string[] = [];
    for (const file of ROUTES) {
      if (!isPublicUrl(routeUrl(file))) continue;
      if (TENANT_HELPER.test(readFileSync(file, "utf8"))) {
        offenders.push(`${apiRel(file)}  (url ${routeUrl(file)})`);
      }
    }
    expect(
      offenders,
      `Rotas PÚBLICAS usando helper de tenant (header = input do atacante). ` +
        `Reescreva o escopo sem confiar em x-restaurant-id/x-user-role:\n  - ` +
        offenders.join("\n  - "),
    ).toEqual([]);
  });

  // ── GATE (b) ────────────────────────────────────────────────────────────────
  it("every /api/admin/** route references a known admin guard (or is a vetted exception)", () => {
    const offenders: string[] = [];
    for (const file of ROUTES) {
      const rel = apiRel(file);
      if (!rel.startsWith("admin/")) continue;
      if (ADMIN_GUARD_EXEMPT.has(rel)) continue;
      if (!ADMIN_GUARD.test(readFileSync(file, "utf8"))) {
        offenders.push(rel);
      }
    }
    expect(
      offenders,
      `Rotas admin SEM guarda conhecida (guardAdmin/checkAdminRequest). ` +
        `Adicione a guarda — ou, se fizer auth própria de propósito, entre no ` +
        `ADMIN_GUARD_EXEMPT com justificativa:\n  - ` +
        offenders.join("\n  - "),
    ).toEqual([]);
  });

  // Keep the exemption list honest: a stale entry (route renamed/removed) must be
  // caught so the allowlist can't silently authorize a path that no longer exists.
  it("every ADMIN_GUARD_EXEMPT entry still points at a real route", () => {
    const missing = [...ADMIN_GUARD_EXEMPT.keys()].filter(
      (rel) => !ROUTES.some((f) => apiRel(f) === rel),
    );
    expect(
      missing,
      `Entradas obsoletas em ADMIN_GUARD_EXEMPT (remova):\n  - ${missing.join("\n  - ")}`,
    ).toEqual([]);
  });
});
