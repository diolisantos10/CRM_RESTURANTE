/**
 * ⭐⭐⭐ A PORTA SEM SESSÃO — credencial a cada chamada, e nenhum cookie.
 *
 * ── POR QUE ELA EXISTE, DEPOIS DE A PORTA COM SESSÃO JÁ EXISTIR ────────────
 *
 * `POST /api/interno/sessao-de-agente` funciona — provado em produção em
 * 06/09/2026. E mesmo assim o Diretor Geral **não conseguiu atravessá-la**: a
 * sala dele recusa o comando antes da rede.
 *
 * O que separa esta rota daquela foi medido por ele, com três sondas, e o
 * resultado é fino demais para ter sido adivinhado:
 *
 *   Bearer FALSO → POST /api/interno/senha              RODOU → 405
 *   Bearer FALSO → mesma forma da recusada              RODOU → 401
 *   Bearer FALSO → GET  /api/admin/pessoas              RODOU → 403
 *   Bearer CERTO → POST /api/interno/sessao-de-agente   RECUSADO pela sala
 *
 * Mesmo verbo, mesma rota, mesmos cabeçalhos. **A única diferença é a chave ser
 * válida.** A sala dele não julga formato, verbo, domínio nem presença de
 * credencial: julga se aquela chamada o transforma num usuário logado.
 *
 * E o contra-exemplo que fecha o raciocínio: ele atravessa a porta do Dioli
 * Connect dezenas de vezes por dia, com credencial de verdade, sem um único
 * bloqueio — porque lá a credencial é apresentada **a cada chamada** e não vira
 * cookie nenhum. É essa forma que esta rota copia.
 *
 * ── ⚠️ O QUE ELA DEVOLVE, E POR QUE TÃO POUCO ─────────────────────────────
 *
 * Identidade e alcance. Nenhum dado de negócio. Ela é, ao mesmo tempo, a PROVA
 * de que a forma sem sessão atravessa a sala dele e a primeira peça útil.
 *
 * Fazer o contrário — abrir as rotas de dado junto — seria apostar dados de
 * cliente numa hipótese que ainda não foi medida do outro lado. Hoje três
 * regras sobre aquela sala já morreram em um dia, duas delas escritas com
 * confiança. Alargar depois é um commit; alargar antes e errar é um vazamento.
 */

import { NextResponse, type NextRequest } from "next/server";
import { autenticarAgente, segredoApresentado } from "@/lib/agente-auth";

export const dynamic = "force-dynamic";

/** A capacidade que esta rota exige. Declarada, e conferida contra o alcance. */
const CAPACIDADE = "ler:quem-sou";

export async function GET(req: NextRequest) {
  // ⛔ Recusa única, como na porta com sessão: crachá não declarado, chave
  // ausente e segredo errado respondem igual. Separá-los diria quais agentes
  // existem e quais já têm chave.
  const naoConfere = NextResponse.json(
    { ok: false, error: "credencial de agente não confere" },
    { status: 401 },
  );

  const cracha = (req.headers.get("x-foocci-agente") ?? "").trim();
  const conferido = autenticarAgente(cracha, segredoApresentado(req.headers.get("authorization")));
  if (!conferido.ok) return naoConfere;

  // ⛔ O ALCANCE É CONFERIDO, e a resposta diz o que faltou. Aqui a recusa PODE
  // ser específica: quem chegou até este ponto já provou a credencial, então
  // nomear a capacidade não entrega nada a quem está de fora — e economiza uma
  // rodada de adivinhação a quem está de dentro.
  if (!conferido.acesso.alcance.includes(CAPACIDADE)) {
    return NextResponse.json(
      {
        ok: false,
        error: `esta credencial não declara "${CAPACIDADE}"`,
        alcance: conferido.acesso.alcance,
      },
      { status: 403 },
    );
  }

  // ⚠️ Nenhum `Set-Cookie`, e isso é a razão de existir da rota. Nada aqui
  // transforma quem chamou num usuário logado: a credencial vale por esta
  // chamada e acaba com ela.
  return NextResponse.json({
    ok: true,
    cracha: conferido.acesso.crachaConnect,
    nome: conferido.acesso.nome,
    email: conferido.acesso.email,
    alcance: conferido.acesso.alcance,
    sessao: null,
    aviso:
      "sem sessão e sem cookie: a credencial é apresentada a cada chamada. Para alargar o " +
      "alcance, peça — é um commit em acessosDeclarados.ts, revisável.",
  });
}
