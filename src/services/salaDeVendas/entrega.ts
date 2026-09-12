/**
 * A ENTREGA — a última perna, e a que não existia.
 *
 * ── O BURACO, MEDIDO ────────────────────────────────────────────────────────
 *
 * Em 26/08/2026, procurando quem chamava `enviarTextoDeVendas`, a resposta foi:
 * **ninguém**. A função de envio existia, testada, e nenhuma linha do produto a
 * chamava.
 *
 * O efeito é o pior tipo de defeito, porque tudo parece funcionar: a mensagem do
 * cliente chega, é reconhecida, o TA compõe uma resposta boa, a resposta aparece
 * na tela da Sala com status PENDENTE — e o cliente nunca recebe nada. Ninguém
 * olhando o sistema por dentro percebe; quem percebe é o lead, pelo silêncio.
 *
 * Valia igual para a pessoa: um vendedor humano digitando na tela de atendimento
 * também só gravava PENDENTE. A Sala inteira era um rascunho.
 *
 * ── ⚠️ A CHAVE CONTINUA SENDO DO DONO ───────────────────────────────────────
 *
 * Este arquivo não liga nada. `canalDeVendasPronto()` exige as duas chaves da
 * Meta **e** `FOOCCI_SDR_SEND_ENABLED` — e sem elas esta função devolve
 * "desligado" e a mensagem fica PENDENTE, exatamente como hoje.
 *
 * O que muda é que, no dia em que o dono ligar, a mensagem sai. Antes disto,
 * ligar a chave não faria nada — e essa é a pior forma de uma trava falhar:
 * a que faz o dono achar que decidiu algo que não aconteceu.
 *
 * ── E POR QUE O PORTÃO DO LEAD É CHAMADO DE NOVO AQUI ───────────────────────
 *
 * `enviarTextoDeVendas` exige uma decisão aprovada do portão como PRIMEIRO
 * parâmetro — não dá para enviar sem ter avaliado. Reavaliar na hora da entrega
 * não é redundância: entre compor e entregar pode ter passado tempo, e a pessoa
 * pode ter pedido silêncio nesse intervalo. Quem pediu para parar não recebe uma
 * mensagem que já estava na fila.
 *
 * ── ⭐ E A SUPERVISORA, DESDE 12/09/2026 ─────────────────────────────────────
 *
 * Esta é a ÚNICA função por onde passa toda fala LIVRE que a empresa manda a um
 * lead — IA, humano digitando, e o conector do handoff. Por isso é aqui, e só
 * aqui, que `supervisora/revisao.ts` entra: uma implementação cobre "todos os
 * agentes" (a ordem do CEO), sem dois caminhos de revisão que podem divergir.
 * Em modo `OFF` ela nem roda; em `SHADOW` ela grava e não muda nada; em
 * `GUARD`/`INTERVENTION` ela pode reescrever o texto ou impedir esta função de
 * chegar até `enviarTextoDeVendas`.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { confirmarEnvio, registrarFalhaDeEnvio } from "./conversa";
import {
  canalDeVendasPronto,
  enviarTextoDeVendas,
  describeFoocciSalesChannel,
  iaRespondeSozinha,
  maquinaPodeFalar,
  type QuemMandou,
} from "@/services/foocci-sdr/FoocciSalesChannel";
import { pediuSilencio } from "@/services/foocci-sdr/LeadContactSafety";
import { revisarAntesDeEntregar } from "./supervisora/revisao";

type Cliente = PrismaClient | Prisma.TransactionClient;

export type ResultadoDaEntrega =
  | { entregue: true; mensagemId: string }
  | {
      entregue: false;
      motivo:
        /** O dono não ligou a entrega. Estado normal, não é falha. */
        | "envioDesligado"
        /**
         * A entrega está ligada, mas quem quis mandar foi a MÁQUINA e a segunda
         * chave está desligada. Também é estado normal: o dono ligou o envio da
         * equipe sem ligar a IA respondendo sozinha.
         */
        | "maquinaNaoFalaSozinha"
        | "mensagemNaoExiste"
        | "naoEraParaEnviar"
        | "semTexto"
        | "leadPediuSilencio"
        | "semTelefone"
        | "aMetaRecusou"
        /** A Supervisora reteve — ver `supervisora/revisao.ts`. Só acontece em
         *  modo GUARD/INTERVENTION; em SHADOW/OFF esta mensagem nunca sai por
         *  este motivo. */
        | "retidaPelaSupervisora";
      detalhe: string;
    };

/**
 * Tenta entregar UMA mensagem que está esperando.
 *
 * **Nunca lança.** É chamada logo depois de gravar — no caminho do webhook e no
 * da tela de atendimento. Uma exceção aqui derrubaria os dois, e a mensagem já
 * estava salva: perder a entrega é ruim, perder o registro é pior.
 *
 * Idempotente pelo status: só toca em mensagem PENDENTE. Chamada duas vezes na
 * mesma mensagem, a segunda vez recusa com `naoEraParaEnviar` em vez de mandar
 * a mesma coisa de novo para o cliente.
 */
export async function entregarMensagem(
  db: Cliente,
  mensagemId: string,
  quemMandou: QuemMandou,
): Promise<ResultadoDaEntrega> {
  try {
    // A chave primeiro, e sem tocar no banco: com a entrega desligada não há
    // motivo para ler nada. É o caminho mais percorrido enquanto o dono não
    // decidir, e ele custa zero.
    if (!canalDeVendasPronto()) {
      const c = describeFoocciSalesChannel();
      return {
        entregue: false,
        motivo: "envioDesligado",
        detalhe: c.configurado
          ? "o canal está configurado e a entrega não foi ligada"
          : "as chaves da Meta não estão completas",
      };
    }

    // ⛔ A SEGUNDA TRAVA, e ela é a razão de `quemMandou` ser obrigatório.
    //
    // Uma pessoa digitando na tela já decidiu: leu, pensou, escreveu, apertou.
    // A máquina respondendo no caminho do webhook não passou por ninguém — e
    // ligar as duas coisas com a mesma chave foi o defeito de 07/09/2026.
    //
    // O parâmetro não tem valor padrão de propósito: um padrão faria a chamada
    // nova herdar "pessoa" por omissão, e a trava voltaria a depender de quem
    // escreve o código lembrar dela.
    if (!maquinaPodeFalar(quemMandou, iaRespondeSozinha())) {
      return {
        entregue: false,
        motivo: "maquinaNaoFalaSozinha",
        detalhe: "a entrega está ligada, mas a IA responder sozinha não está",
      };
    }

    const m = await db.leadMensagem.findUnique({
      where: { id: mensagemId },
      select: {
        id: true,
        status: true,
        direcao: true,
        texto: true,
        leadId: true,
        autor: true,
        autorUserId: true,
        papelDoAgente: true,
        lead: { select: { whatsapp: true, optOutAt: true } },
      },
    });

    if (!m) {
      return { entregue: false, motivo: "mensagemNaoExiste", detalhe: `mensagem ${mensagemId}` };
    }
    if (m.direcao !== "SAIDA" || m.status !== "PENDENTE") {
      return {
        entregue: false,
        motivo: "naoEraParaEnviar",
        detalhe: `mensagem está ${m.direcao}/${m.status}`,
      };
    }
    const texto = m.texto?.trim();
    if (!texto) {
      return { entregue: false, motivo: "semTexto", detalhe: "mensagem sem texto" };
    }

    // ⚠️ Reavaliado AGORA, e não quando a mensagem foi composta. Entre uma coisa
    // e outra a pessoa pode ter pedido silêncio — e quem pediu para parar não
    // recebe o que já estava na fila.
    if (pediuSilencio(m.lead.optOutAt)) {
      await registrarFalhaDeEnvio(db, {
        mensagemId,
        erro: "não entregue: a pessoa pediu para não receber mensagens",
      });
      return {
        entregue: false,
        motivo: "leadPediuSilencio",
        detalhe: "a pessoa pediu silêncio depois de a mensagem ser escrita",
      };
    }

    const telefone = m.lead.whatsapp?.trim();
    if (!telefone) {
      await registrarFalhaDeEnvio(db, { mensagemId, erro: "não entregue: lead sem telefone" });
      return { entregue: false, motivo: "semTelefone", detalhe: "o lead não tem WhatsApp" };
    }

    // ── ⭐ A SUPERVISORA — ÚNICO ponto de encaixe, ver `supervisora/revisao.ts` ──
    //
    // Depois de opt-out e telefone (não vale a pena revisar tom de uma mensagem
    // que já não sairia por outro motivo), e ANTES de `enviarTextoDeVendas` —
    // que é a linha que de fato bate na Meta. Cobre IA, humano e o conector do
    // handoff porque os três chegam AQUI; nenhum precisa saber que ela existe.
    const revisao = await revisarAntesDeEntregar(db, {
      mensagemId,
      leadId: m.leadId,
      texto,
      autorMensagem: m.autor,
      autorUserId: m.autorUserId,
      papelDoAgente: m.papelDoAgente,
    });

    if (!revisao.prosseguir) {
      // ⛔ NUNCA `registrarFalhaDeEnvio` aqui: FALHOU é para quando a Meta ou a
      // rede recusaram — estado técnico, corrigível por retentativa. Retido pela
      // Supervisora é uma decisão de qualidade, e um retry automático mandaria a
      // mesma mensagem ruim de novo. A mensagem fica PENDENTE, visível, e o
      // motivo mora em `SupervisoraAvaliacao` (ligada por `mensagemId`) — nunca
      // escondido dentro do campo `erro`, que é vocabulário da Meta.
      return {
        entregue: false,
        motivo: "retidaPelaSupervisora",
        detalhe: revisao.motivoDeRetencao ?? "retida pela Supervisora",
      };
    }

    const textoParaEnviar = revisao.textoParaEnviar;

    const r = await enviarTextoDeVendas(
      // A decisão do portão: opt-out e telefone já foram conferidos acima, com o
      // dado FRESCO do banco. Montá-la aqui é declarar que a checagem aconteceu —
      // e a assinatura de `enviarTextoDeVendas` não deixa fingir que aconteceu.
      { sendable: true, reason: null, detail: "conferido na entrega: sem opt-out, com telefone" },
      telefone,
      // ⚠️ `textoParaEnviar`, não `texto`: em modo GUARD/INTERVENTION com
      // veredito AMARELO, a Supervisora já reescreveu — e o que sai para o
      // cliente é a versão corrigida, nunca a original. Nos demais casos os
      // dois são o mesmo valor.
      textoParaEnviar,
    );

    if (!r.ok) {
      await registrarFalhaDeEnvio(db, { mensagemId, erro: r.error ?? "erro sem motivo" });
      return { entregue: false, motivo: "aMetaRecusou", detalhe: r.error ?? "erro sem motivo" };
    }

    // ── O id do provedor ──────────────────────────────────────────────────
    //
    // `enviarTextoDeVendas` não devolve o `wamid` hoje. Marcar como ENVIADA sem
    // ele é melhor que deixar PENDENTE: PENDENTE significa "ainda não saiu", e
    // depois de a Meta aceitar isso passou a ser falso — e é o que faria uma
    // retentativa mandar a mesma mensagem de novo para o cliente.
    //
    // O `waMessageId` real chega pelo callback de status da Meta, que já sabe
    // casar pela conversa. Até lá, a marca provisória diz de onde ela veio.
    await confirmarEnvio(db, { mensagemId, waMessageId: `local:${mensagemId}` });

    return { entregue: true, mensagemId };
  } catch (e) {
    return {
      entregue: false,
      motivo: "aMetaRecusou",
      detalhe: e instanceof Error ? e.message.slice(0, 200) : "erro desconhecido",
    };
  }
}
