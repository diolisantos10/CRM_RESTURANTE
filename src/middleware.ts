/**
 * Next.js Edge Middleware – Auth + Multi-tenant context injection.
 *
 * Runs before every matching request. Responsibilities:
 *   1. Allow public routes through without a token.
 *   2. Reject unauthenticated requests to protected routes with 401.
 *   3. Inject tenant headers (x-restaurant-id, x-user-id, x-user-role)
 *      so route handlers and server components never need to decode JWT.
 *
 * IMPORTANT: This runs on the Edge runtime – no Node.js APIs.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { TENANT_HEADER, USER_HEADER, ROLE_HEADER } from "@/lib/tenant";
import {
  destinoCanonicoSemWww,
  raizVaiParaVitrine,
  origemPublica,
  DESTINO_DA_RAIZ,
  ehHostDaComercial,
  DESTINO_DA_COMERCIAL,
} from "@/lib/canonicalHost";

// Routes that do NOT require authentication
/**
 * Caminho reservado da prova de posse do domínio (ACME / Let's Encrypt).
 * Fica fora de PUBLIC_PATHS de propósito: não é rota da aplicação — é servido
 * pela borda do Railway, e o que precisamos é apenas NÃO atrapalhar.
 */
const ACME_CHALLENGE_PREFIX = "/.well-known/acme-challenge/";

const PUBLIC_PATHS: RegExp[] = [
  /^\/$/,                              // landing page
  /^\/privacidade$/,                   // PUBLIC privacy policy (required by Meta/Google app review)
  /^\/termos$/,                        // PUBLIC terms of use (required by Meta/Google app review)
  /^\/site(\/.*)?$/,                   // public marketing website (no auth)
  /^\/login(\/.*)?$/,                  // login + sub-pages
  /^\/api\/auth(\/.*)?$/,              // NextAuth endpoints
  /^\/api\/restaurants\/register$/,    // self-service registration
  /^\/api\/site\/leads$/,              // public demo-request form (rate-limited per IP)
  /^\/robots\.txt$/,                   // crawler rules — must never redirect to /login
  /^\/sitemap\.xml$/,                  // marketing sitemap
  /^\/api\/webhooks\/meta\/whatsapp$/, // Meta WhatsApp Cloud API webhook (GET verify token + POST X-Hub-Signature-256)
  /^\/api\/webhooks\/instagram$/,      // Instagram Direct (Meta) webhook (GET verify token + POST X-Hub-Signature-256)
  /^\/setup$/,                         // First-time browser setup (blocked after first restaurant exists)
  /^\/api\/setup$/,                    // Setup API
  /^\/qr(\/.*)?$/,                     // Public QR dine-in menu pages
  /^\/api\/qr(\/.*)?$/,                // Public QR dine-in menu API
  /^\/pedido(\/.*)?$/,                 // Public AI ordering experience pages
  /^\/api\/pedido(\/.*)?$/,            // Public AI ordering experience API
  /^\/r(\/.*)?$/,                      // Public short redirects (WhatsApp menu link, cart recovery) — resolve a bearer code, then 302 to /pedido
  /^\/l(\/.*)?$/,                      // Public tracking short links — 302 to /pedido or /qr with UTM params
  /^\/api\/payments\/stone\/webhook$/, // Stone webhook (public, verified by HMAC)
  /^\/api\/payments\/mercadopago\/webhook$/, // Mercado Pago webhook (public — MP servers have no JWT)
  /^\/contratar(\/.*)?$/,                // Public plan-contract acceptance page (token-gated by construction)
  /^\/api\/billing\/accept$/,           // Terms acceptance (rate-limited; requires unguessable token)
  /^\/api\/billing\/checkout$/,         // Self-service checkout (rate-limited per IP + idempotency key)
  /^\/api\/billing\/slug-check$/,       // Store-address availability while typing (rate-limited; answers only free/taken)
  /^\/api\/billing\/mp-webhook$/,       // MP PLATFORM billing webhook (verified by refetch with our token)
  /^\/api\/payments\/sumup\/webhook$/, // SumUp webhook (public — re-verified via SumUp API before confirming)
  /^\/api\/integrations\/saipos\/webhook$/, // Saipos webhook (public — Saipos servers have no JWT)
  /^\/api\/v1(\/.*)?$/,                // Public external API — auth handled per-route via Bearer API key (ApiKeyService)
  /^\/api\/print-agent(\/.*)?$/,      // Local print agent (Carteiro) — auth handled per-route via agent token
  /^\/api\/media(\/.*)?$/,             // Public media (product images stored in DB)
  /^\/api\/health$/,                   // Health check (post-deploy validation)
  /^\/api\/cron(\/.*)?$/,              // CRM cron endpoints — auth handled per-route via CRON_SECRET bearer token
  // Diário do SDR — SOMENTE LEITURA, e a guarda é da própria rota: sem
  // `SDR_DIARIO_SECRET` configurado ela devolve 401 a TODO mundo (fail-closed),
  // e o segredo do admin não abre. Público aqui só quer dizer "não exige sessão
  // de lojista": é um instrumento de auditoria, e auditoria que só funciona de
  // dentro de um login de restaurante não é auditoria. Mesmo molde do /api/cron.
  // Só o caminho exato: /api/sdr/entrevista e /api/sdr/plano continuam exigindo
  // tenant ou admin, como sempre exigiram.
  /^\/api\/sdr\/diario$/,             // Diário do SDR (GET) — fail-closed via SDR_DIARIO_SECRET
  // ── DIOLI CONNECT — a porta corporativa por onde a Control Room fala com o
  // agente deste produto. "Público" aqui significa exatamente o que significa
  // para /api/cron e para o diário do SDR: **não exige sessão de LOJISTA**. Quem
  // chama é máquina, não navegador — não tem cookie, e nunca terá.
  //
  // ⚠️ SEM ESTAS DUAS LINHAS AS ROTAS FICAM MORTAS, E DE UM JEITO TRAIÇOEIRO.
  // O middleware derruba no NextAuth tudo que não está nesta lista. Para um
  // caminho `/api/`, o que ele devolve é o 401 genérico dele
  // (`{"success":false,"error":"Unauthorized"}`) — que PARECE a recusa da porta,
  // mas é o contrário: o handler nunca rodou, e portanto nenhuma trava dele
  // rodou. Sem segredo configurado a porta deveria responder 503; com pedido
  // malformado, 400; com acionamento não comprovado, 502. Nada disso chega a
  // existir. O portão da porta é o segredo próprio dela (`DIOLI_CONNECT_SECRET`,
  // fail-closed, ADMIN_SECRET proibido pela ADR-003) — e ele só pode barrar o
  // que chega até ele.
  //
  // O caminho é EXATO nas três: `/api/connect/qualquer-outra-coisa` continua
  // exigindo sessão, como sempre exigiu.
  /^\/api\/connect\/despacho$/,       // Dioli Connect — despacho (POST), fail-closed via DIOLI_CONNECT_SECRET
  /^\/api\/connect\/cadastro$/,       // Dioli Connect — cadastro do produto (GET, somente leitura), mesmo segredo
  // ⭐ O caminho de VOLTA. Sem esta linha a resposta do gerente nunca entra na
  // conversa do cliente: o núcleo recebe o 401 genérico do middleware, lê como
  // "segredo errado", e o lead espera para sempre — que é exatamente o defeito
  // de quatro dias que este conector existe para matar.
  /^\/api\/connect\/retorno$/,        // Dioli Connect — a resposta do gerente voltando (POST), mesmo segredo
  // Área de ATENDIMENTO — a sala saiu de dentro do /admin em 26/08/2026.
  // "Público" aqui significa exatamente o mesmo que significa para o /admin: não
  // exige sessão de LOJISTA. O portão é o layout de `/comercial/(area)`, que
  // redireciona quem não tem sessão interna nem a senha da casa — e cada rota de
  // API decide o resto no servidor. Sem esta linha o middleware do produto
  // mandaria o vendedor para o login de restaurante, que não é dele.
  /^\/comercial(\/.*)?$/,            // Área de atendimento (portão no layout)
  // Global admin area — auth handled by admin cookie + layout, NOT by NextAuth
  /^\/admin(\/.*)?$/,                  // Admin UI pages
  /^\/api\/admin(\/.*)?$/,             // Admin API routes (each verifies x-admin-secret or admin cookie)
  // ⛔⛔ AS ROTAS DA PESSOA DA CASA — e esta linha faltou, com dano medido.
  //
  // "Público" aqui significa o mesmo que significa duas linhas acima: **não
  // exige sessão de LOJISTA**. Cada rota decide o resto sozinha — `/senha`
  // exige a sessão interna E a senha atual; `/sessao-de-agente` exige crachá
  // declarado E credencial de agente. Nenhuma das duas é aberta.
  //
  // ── O QUE ACONTECEU SEM ELA, MEDIDO EM PRODUÇÃO EM 06/09/2026 ────────────
  //
  // A troca obrigatória de senha subiu no #188 e foi reportada como pronta.
  // Estava morta: `/admin/trocar-senha` (que É público aqui) carregava, a
  // pessoa preenchia, e o POST para `/api/interno/senha` levava o 401 genérico
  // do middleware — sem uma linha do handler chegar a rodar.
  //
  // ⚠️ É a MESMA armadilha que a porta do Connect documentou logo acima, e é a
  // terceira vez nesta casa. O disfarce é o que a torna cruel: para um caminho
  // `/api/`, o middleware responde `{"success":false,"error":"Unauthorized"}`
  // — um 401 que PARECE a recusa da rota. Quem depura troca cabeçalho o dia
  // inteiro enquanto o problema é que a rota nunca executou.
  /^\/api\/interno(\/.*)?$/,           // Rotas da pessoa da casa (cada uma verifica a própria credencial)
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((pattern) => pattern.test(pathname));
}

// ── Marketing site (/site) is PUBLIC since the launch on 2026-08-03 ────────────
// Until then these pages sat behind a shared password. The gate lived in TWO
// places at once — here AND in `site/(gated)/layout.tsx` — because middleware is
// the only layer that can block a page BEFORE it renders or streams. Both were
// removed together; removing only one leaves the site shut with no error to
// explain it. `/site` is now matched by PUBLIC_PATHS like any other public route.

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Canônica: www.foocci.com.br → foocci.com.br (308, preservando caminho e
  // query). A apex é a URL registrada nos callbacks de Google/Meta/SumUp e em
  // todo link gerado — o www é só porta de entrada. Inerte enquanto o DNS do
  // www não existir; passa a valer no momento em que Railway + Hostinger
  // registrarem o subdomínio (docs/dominio-www-diagnostico.md).
  //
  // ⚠️ A EXCEÇÃO DO ACME NÃO É DETALHE — ELA É O QUE PERMITE O `www` EXISTIR.
  // Para emitir o certificado TLS do `www`, a autoridade certificadora busca um
  // arquivo de prova em `http://www.<dominio>/.well-known/acme-challenge/<token>`.
  // Sem esta exceção, o redirecionamento acima responde 308 para a apex — e a
  // apex não tem o token, porque ele é emitido por domínio. A validação nunca
  // completa, o Railway fica preso em `TYPE_VALIDATING_OWNERSHIP` para sempre, e
  // o navegador mostra `ERR_CERT_COMMON_NAME_INVALID` a quem digita com `www`.
  //
  // Foi exatamente o que aconteceu em 04–05/08/2026: DNS certo, CNAME propagado,
  // domínio cadastrado — e 18 horas presas nesse estado. O diagnóstico anterior
  // apontava "Railway travado, apagar e recriar o domínio", o que **não teria
  // resolvido**: o domínio recriado cairia na mesma armadilha, e ainda custaria
  // uma edição de DNS na Hostinger (recriar sorteia um CNAME novo).
  //
  // Regra geral, para quem for mexer aqui: **redirecionamento de domínio nunca
  // pode engolir `/.well-known/`.** É o caminho reservado para provas de posse e
  // metadados de protocolo — ele pertence ao domínio pedido, não ao canônico.
  //
  // ⚠️ E O DESTINO É MONTADO, NUNCA HERDADO DO `nextUrl` (defeito de 23/08/2026).
  // Clonar `req.nextUrl` e trocar só o `host` mantém a porta interna do contêiner
  // no destino — `https://foocci.com.br:8080/`, um endereço que não existe lá
  // fora. O porquê exato está em `lib/canonicalHost.ts`, junto do teste.
  const host = req.headers.get("host") ?? "";
  if (host.startsWith("www.") && !pathname.startsWith(ACME_CHALLENGE_PREFIX)) {
    return NextResponse.redirect(
      destinoCanonicoSemWww(host, pathname, req.nextUrl.search),
      308,
    );
  }

  // A raiz é a vitrine — para visitante anônimo E para quem está logado. Fica no
  // middleware, e não na página, porque a página vira artefato estático e perde o
  // `Location`; o porquê inteiro está em `lib/canonicalHost.ts`.
  //
  // O destino é ABSOLUTO porque o Next recusa `Location` relativo (`new URL()`
  // no cabeçalho → `ERR_INVALID_URL`, 500) — e é montado por `origemPublica`,
  // que descarta a porta interna do contêiner sem quebrar o `localhost` do
  // desenvolvimento. Foi assim que o `:8080` entrou na primeira vez.
  // ── A ENTRADA CANÔNICA DA COMERCIAL ──────────────────────────────────────
  //
  // Vem ANTES da vitrine porque as duas disputam a mesma raiz: quem chega em
  // `vendas.foocci.com.br/` quer a sala de vendas, não a página de marketing do
  // produto. Depois desta linha, `raizVaiParaVitrine` continua valendo para
  // todos os outros hosts, sem mudança nenhuma.
  if (raizVaiParaVitrine(pathname) && ehHostDaComercial(host)) {
    const origem = origemPublica(
      req.headers.get("x-forwarded-host") ?? host ?? req.nextUrl.host,
      req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol,
    );
    // A query vai junto: quem chega com `?erro=sessao` ou com marcação de
    // campanha perderia o contexto exatamente na porta de entrada.
    return NextResponse.redirect(
      new URL(`${DESTINO_DA_COMERCIAL}${req.nextUrl.search}`, origem),
      307,
    );
  }

  if (raizVaiParaVitrine(pathname)) {
    const origem = origemPublica(
      req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host,
      req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol,
    );
    return NextResponse.redirect(new URL(`${DESTINO_DA_RAIZ}${req.nextUrl.search}`, origem), 307);
  }

  // Always allow Next.js internals and static assets
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.match(/\.(ico|png|jpg|jpeg|webp|svg|css|js|woff|woff2)$/)
  ) {
    return NextResponse.next();
  }

  // Legacy private-preview entry point. /preview (and /preview/*) still forwards
  // to /site — the destination is simply public now. Kept so links shared during
  // the preview period do not 404.
  if (pathname === "/preview" || pathname.startsWith("/preview/")) {
    const dest = req.nextUrl.clone();
    dest.pathname = pathname.replace(/^\/preview/, "/site");
    dest.search = "";
    return NextResponse.redirect(dest);
  }

  // Explicit early exit for setup/recover — must never require auth, even behind proxies
  if (
    pathname === "/setup" ||
    pathname.startsWith("/api/setup") ||
    pathname === "/recover" ||
    pathname.startsWith("/api/recover") ||
    pathname.startsWith("/api/admin/reset-owner")
  ) {
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Decode the JWT (reads from the cookie or Authorization header)
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (!token) {
    // API routes return JSON 401; page routes redirect to /login
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Use NEXTAUTH_URL (public domain) to build the redirect so that
    // Railway's internal hostname (localhost:8080) never leaks into callbackUrl.
    const publicBase =
      process.env.NEXTAUTH_URL?.replace(/\/$/, "") ??
      `${req.nextUrl.protocol}//${req.nextUrl.host}`;

    const loginUrl = new URL("/login", publicBase);
    loginUrl.searchParams.set("callbackUrl", `${publicBase}${pathname}`);
    return NextResponse.redirect(loginUrl);
  }

  // Inject tenant context as request headers so handlers don't parse JWT.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(TENANT_HEADER, token.restaurantId as string);
  requestHeaders.set(USER_HEADER, token.id as string);
  requestHeaders.set(ROLE_HEADER, token.role as string);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  // Match all routes except Next.js internals
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
