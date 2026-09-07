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
import { exigirAgente } from "@/lib/agente-req";

export const dynamic = "force-dynamic";

/** A capacidade que esta rota exige. Declarada, e conferida contra o alcance. */
const CAPACIDADE = "ler:quem-sou";

export async function GET(req: NextRequest) {
  // ⚠️ O MESMO portão das outras rotas de agente, e não uma cópia dele. Duas
  // conferências iguais divergem no primeiro conserto feito só de um lado — e
  // num portão a divergência aparece como "esta rota deixa passar o que as
  // outras barram", que ninguém procura até vazar.
  const portao = exigirAgente(req, CAPACIDADE);
  if (!portao.ok) return portao.resposta;

  // ⚠️ Nenhum `Set-Cookie`, e isso é a razão de existir da rota. Nada aqui
  // transforma quem chamou num usuário logado: a credencial vale por esta
  // chamada e acaba com ela.
  return NextResponse.json({
    ok: true,
    cracha: portao.acesso.crachaConnect,
    nome: portao.acesso.nome,
    email: portao.acesso.email,
    alcance: portao.acesso.alcance,
    sessao: null,
    aviso:
      "sem sessão e sem cookie: a credencial é apresentada a cada chamada. Para alargar o " +
      "alcance, peça — é um commit em acessosDeclarados.ts, revisável.",
  });
}
