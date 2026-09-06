/**
 * PESSOAS E ACESSOS — a porta da área de RH.
 *
 *   GET    → quem existe, ativos e desativados
 *   POST   → cria a pessoa (ou troca a senha de quem já existe)
 *   PATCH  → corta ou devolve o acesso
 *
 * ── ⚠️ QUEM ABRE ESTA PORTA ─────────────────────────────────────────────────
 *
 * **Só o CEO**, e a senha da casa. Ninguém mais — nem o diretor.
 *
 * A regra é do CEO, dita assim: *"só quem é do administrativo, algumas pessoas
 * têm acesso a isso. Você pode colocar, por exemplo, só eu, que tenho acesso ao
 * master."*
 *
 * E a estreiteza tem uma razão que vale registrar: quem cria acesso **escolhe o
 * papel**, e portanto pode criar um CEO. Uma porta que aceitasse "qualquer
 * pessoa do administrativo" seria, na prática, uma porta que qualquer pessoa do
 * administrativo usa para virar dona da casa.
 *
 * A senha da casa continua valendo porque é por ela que o primeiro CEO nasce —
 * sem isso a casa começa trancada por fora.
 */

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { lerSessaoInterna, type SessaoInterna } from "@/lib/internal-auth";
import {
  listarPessoas,
  criarPessoa,
  mudarAtivacao,
  TIPOS_DE_ACESSO,
} from "@/services/organizacao/pessoas";
import { avisarAcessoCriado } from "@/services/organizacao/avisoDeAcesso";
import { ROTA_DA_TROCA } from "@/lib/troca-de-senha";

/**
 * Quem assina o recado na caixa do Connect.
 *
 * ⚠️ É o crachá do Diretor do produto, e não o de quem clicou: o recado é ato
 * DA PLATAFORMA, não da pessoa. Assinar com o crachá de quem criou faria a
 * trilha dizer que o CEO escreveu a senha de alguém na caixa — e não foi ele,
 * foi o sistema.
 */
const CRACHA_QUE_AVISA = "dioli.foocci.direcao.diretor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Porteiro =
  | { ok: true; sessao: SessaoInterna | null }
  | { ok: false; resposta: NextResponse };

function guarda(): Porteiro {
  const sessao = lerSessaoInterna();
  if (isAdminAuthenticated() || sessao?.role === "MASTER_CEO") {
    return { ok: true, sessao };
  }
  return {
    ok: false,
    resposta: NextResponse.json(
      { ok: false, error: "Só o CEO administra acessos." },
      { status: 403 },
    ),
  };
}

/** Toda mudança de acesso vira linha na trilha. Nunca guarda a senha. */
async function registrar(
  sessao: SessaoInterna | null,
  acao: string,
  recurso: string,
  detalhe: Prisma.InputJsonValue,
) {
  try {
    await prisma.internalAuditEvent.create({
      data: {
        actorType: sessao ? "INTERNAL_USER" : "SYSTEM",
        actorLabel: sessao ? `${sessao.nome} (${sessao.userId})` : "porta do ADMIN_SECRET",
        acao,
        recurso,
        resultado: "PERMITIDO",
        detalhe,
      },
    });
  } catch {
    // Trilha fora do ar não desfaz o que já aconteceu no banco.
  }
}

export async function GET() {
  const porta = guarda();
  if (!porta.ok) return porta.resposta;

  const pessoas = await listarPessoas(prisma);

  return NextResponse.json({
    ok: true,
    // Os tipos viajam junto: a tela precisa explicar o que cada um pode, e a
    // explicação tem de vir da MESMA lista que a rota usa para validar. Duas
    // listas discordariam, e a discordância apareceria como "criei e não
    // funciona".
    data: { pessoas, tipos: TIPOS_DE_ACESSO },
  });
}

export async function POST(req: NextRequest) {
  const porta = guarda();
  if (!porta.ok) return porta.resposta;

  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Tipados uma vez, usados em todo lugar. A primeira versão passava
  // `corpo.email` cru para a trilha, e o `unknown` viajava até o banco.
  const nome = typeof corpo.nome === "string" ? corpo.nome : "";
  const email = typeof corpo.email === "string" ? corpo.email : "";
  const papel = typeof corpo.papel === "string" ? corpo.papel : "";
  // Vazio ou ausente = a casa sorteia. O piso da senha escolhida é conferido
  // dentro de `criarPessoa`, e não aqui: a tela também chama esse piso enquanto
  // a pessoa digita, e a regra tem de morar num lugar só.
  const senhaEscolhida = typeof corpo.senha === "string" ? corpo.senha : "";
  const crachaConnect = typeof corpo.crachaConnect === "string" ? corpo.crachaConnect : "";

  const r = await criarPessoa(prisma, {
    nome,
    email,
    papel,
    senhaEscolhida,
    crachaConnect,
    departamentos: Array.isArray(corpo.departamentos)
      ? corpo.departamentos.filter((d): d is string => typeof d === "string")
      : ["vendas"],
  });

  if (!r.ok) return NextResponse.json({ ok: false, error: r.erro }, { status: 400 });

  await registrar(
    porta.sessao,
    r.jaExistia ? "trocar_senha_interna" : "criar_usuario_interno",
    `internal_users/${r.id}`,
    // ⚠️ Sem a senha, aqui e em lugar nenhum. A trilha guarda o que aconteceu,
    // não a credencial que aconteceu.
    // ⚠️ `foiEscolhida` é um booleano, e é isso que a trilha pode guardar: se a
    // senha foi digitada por alguém ou sorteada pela casa. A senha em si não
    // entra aqui em hipótese nenhuma.
    { email, papel, jaExistia: r.jaExistia, senhaEscolhida: r.foiEscolhida },
  );

  // ══════════════════════════════════════════════════════════════════════
  // ⭐⭐ A SENHA VAI PARA A CAIXA DO CRACHÁ, DE MÁQUINA PARA MÁQUINA.
  //
  // Ordem do CEO, 05/09/2026: *"Você vai passar a senha pela caixa de entrada e
  // avisar que essa senha é só para entrar, e fazer a senha dele."*
  //
  // ⛔ E o aviso NUNCA derruba a criação. Quando ele falha, o acesso já existe
  // e a senha está na resposta desta rota — a tela mostra e quem criou entrega
  // como puder. Trocar "não recebeu o recado" por "não tem acesso" seria
  // resolver o problema pequeno criando o grande.
  // ══════════════════════════════════════════════════════════════════════
  const aviso =
    r.crachaConnect === ""
      ? { avisou: false as const, motivo: "sem crachá no Connect" }
      : await avisarAcessoCriado({
          crachaConnect: r.crachaConnect,
          de: CRACHA_QUE_AVISA,
          senha: r.senha,
          urlDaTroca: `${req.nextUrl.origin}${ROTA_DA_TROCA}`,
          expiraEm: r.expiraEm,
        });

  await registrar(
    porta.sessao,
    aviso.avisou ? "aviso_de_acesso_entregue" : "aviso_de_acesso_nao_entregue",
    `internal_users/${r.id}`,
    // ⚠️ Sem a senha, como em toda linha desta trilha. O que se registra é se o
    // recado chegou — não o que ele dizia.
    { crachaConnect: r.crachaConnect, motivo: aviso.avisou ? null : aviso.motivo },
  );

  return NextResponse.json({
    ok: true,
    data: {
      nome,
      email,
      papel,
      senha: r.senha,
      trocouSenha: r.jaExistia,
      foiEscolhida: r.foiEscolhida,
      expiraEm: r.expiraEm.toISOString(),
      // A tela precisa saber se ainda tem de entregar a senha na mão.
      avisoEntregue: aviso.avisou,
      motivoDoAviso: aviso.avisou ? null : aviso.motivo,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const porta = guarda();
  if (!porta.ok) return porta.resposta;

  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof corpo.id === "string" ? corpo.id : "";
  const ativa = corpo.ativa === true;

  if (!id) return NextResponse.json({ ok: false, error: "Pessoa não informada." }, { status: 400 });

  const r = await mudarAtivacao(prisma, { id, ativa });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.erro }, { status: 400 });

  await registrar(
    porta.sessao,
    ativa ? "devolver_acesso_interno" : "cortar_acesso_interno",
    `internal_users/${id}`,
    { nome: r.nome, ativa },
  );

  return NextResponse.json({ ok: true, data: { nome: r.nome, ativa: r.ativa } });
}
