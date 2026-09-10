/**
 * O WHATSAPP DA SALA, DESCOBERTO POR API — número, conta, teto e modelos.
 *
 * ── POR QUE ESTA ROTA EXISTE ────────────────────────────────────────────────
 *
 * Até aqui, três dos dados que mais decidem o dia da operação viviam fora do
 * sistema: a conta (WABA) dependia de alguém colar um id numa variável, o teto
 * de conversas que a Meta concede não aparecia em lugar nenhum, e a quantidade
 * de variáveis do modelo era **digitada à mão** — um número que a API da Meta
 * responde de graça, pedido a uma pessoa.
 *
 * Todo dado que depende de alguém lembrar de atualizar envelhece. Este aqui
 * envelhece caro: teto errado corta a rodada no meio da lista, e contagem de
 * variáveis errada faz a Meta recusar 100% dos envios, contato a contato.
 *
 * ── AS DUAS OPERAÇÕES, E POR QUE SÃO VERBOS DIFERENTES ──────────────────────
 *
 * `GET` só LÊ: pergunta o cadastro do número à Meta e devolve os modelos já
 * gravados. É barato e pode ser aberto sempre que alguém abrir a tela.
 *
 * `POST` VARRE a conta e ESCREVE no banco. É a operação cara — dez páginas de
 * consulta, um upsert por modelo — e por isso é um clique, não um efeito
 * colateral de abrir a página. Uma sincronização disparada por render vira
 * varredura em laço no dia em que a tela ficar aberta num monitor.
 *
 * ── QUEM PODE ───────────────────────────────────────────────────────────────
 *
 * Só quem enxerga a operação inteira, como na conferência do canal. Não é
 * segredo o que ela devolve, mas é chamada externa em nome da empresa: aberta
 * ao vendedor, daria a qualquer sessão um jeito de bater na Meta em laço.
 *
 * 🔒 Nada do token entra na resposta. O que sai é o que a META devolve sobre o
 * número — e é justamente isso que prova que a chave certa está no lugar certo.
 */

import { NextRequest, NextResponse } from "next/server";
import { guardarSalaDeVendas, vePelaOperacaoToda, somenteLeitura } from "../_guarda";
import { prisma } from "@/lib/prisma";
import { comOTokenDeVendas } from "@/services/foocci-sdr/FoocciSalesChannel";
import { detalhesDoNumeroDeVendas, type DetalhesDoNumero } from "@/services/foocci-sdr/modelosDaMeta";
import { modeloConfigurado } from "@/services/salaDeVendas/abordar";
import {
  sincronizarModelosDeVendas,
  modelosSincronizadosDaSala,
} from "@/services/foocci-sdr/sincronizarModelos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A ausência do token vira uma resposta declarada, nunca campos mudos. */
const SEM_TOKEN: DetalhesDoNumero = {
  phoneNumberId: "",
  wabaId: null,
  numero: null,
  nomeVerificado: null,
  qualidade: null,
  tier: null,
  erro: "FOOCCI_SALES_ACCESS_TOKEN não está no ambiente",
};

export async function GET(req: NextRequest) {
  const portao = await guardarSalaDeVendas(req, "ver_whatsapp_da_sala");
  if (!portao.ok) return portao.resposta;

  if (!vePelaOperacaoToda(portao.sessao)) {
    return NextResponse.json(
      { ok: false, error: "Só quem enxerga a operação inteira vê o canal da Sala." },
      { status: 403 },
    );
  }

  // As duas leituras são independentes e vão juntas: a Meta responde pelo
  // número, o banco responde pelos modelos. Encadear uma na outra faria a lista
  // de modelos sumir da tela sempre que a Graph estivesse lenta — e a lista é
  // exatamente o que quem opera precisa ver quando a Meta está fora do ar.
  const [numero, modelos] = await Promise.all([
    comOTokenDeVendas<DetalhesDoNumero>(detalhesDoNumeroDeVendas, () => SEM_TOKEN),
    modelosSincronizadosDaSala(prisma),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      numero,
      modelos,
      // Qual modelo está escolhido para a abordagem. Sem isto a tabela mostra
      // cinco modelos aprovados e nenhuma indicação de qual deles o lead recebe.
      selecionado: modeloConfigurado(),
    },
  });
}

export async function POST(req: NextRequest) {
  const portao = await guardarSalaDeVendas(req, "sincronizar_modelos_da_sala");
  if (!portao.ok) return portao.resposta;

  if (!vePelaOperacaoToda(portao.sessao)) {
    return NextResponse.json(
      { ok: false, error: "Só quem enxerga a operação inteira sincroniza os modelos." },
      { status: 403 },
    );
  }

  // Quem audita não mexe no que auditou — e sincronizar ESCREVE no banco.
  if (somenteLeitura(portao.sessao)) {
    return NextResponse.json(
      { ok: false, error: "O auditor lê e não escreve." },
      { status: 403 },
    );
  }

  const r = await sincronizarModelosDeVendas(prisma);

  // ⚠️ Falha vira 502 com o motivo, e não 200 com `sincronizados: 0`. Os dois
  // estados são diferentes: zero modelos manda criar modelo na Meta; "não
  // consegui perguntar" manda olhar a credencial ou a conta.
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.erro ?? "Falha ao sincronizar." }, { status: 502 });
  }

  const modelos = await modelosSincronizadosDaSala(prisma);
  return NextResponse.json({ ok: true, data: { resultado: r, modelos } });
}
