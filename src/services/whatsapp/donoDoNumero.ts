/**
 * DE QUEM É ESTE NÚMERO? — a pergunta que a casa não sabia responder.
 *
 * ── O DEFEITO QUE ISTO FECHA, MEDIDO EM 06/09/2026 ──────────────────────────
 *
 * `FOOCCI_SALES_PHONE_NUMBER_ID` guardava `1300518453142518`. O webhook comparava
 * o número que chegava com esse valor e, batendo, desviava a mensagem para a
 * caixa de vendas da Foocci. O valor estava errado: era o WhatsApp de um
 * restaurante **cliente**.
 *
 * Resultado: três pessoas escreveram para o restaurante — 27/08, 31/08 e 06/09 —
 * e a mensagem virou "lead" da Foocci em vez de chegar ao dono. Ninguém
 * respondeu nenhuma. Para elas, o restaurante simplesmente não atendeu.
 *
 * ── ⛔ E A PARTE QUE MAIS DOEU: NINGUÉM SABIA DE QUEM ERA O NÚMERO ──────────
 *
 * A resposta estava no banco desta casa o tempo todo — `meta_whatsapp_configs`,
 * uma linha por restaurante, `phoneNumberId` único. Mas **nenhuma tela e nenhuma
 * rota iam nessa direção**: `diag` parte do restaurante e mostra o número
 * (mascarado); ninguém partia do número para chegar ao restaurante.
 *
 * Um dado que existe e não tem por onde ser perguntado é, na prática, um dado
 * que a casa não tem. Este arquivo é a direção que faltava.
 *
 * ── O QUE ELE NÃO FAZ ───────────────────────────────────────────────────────
 *
 * Não devolve token, não devolve o verify token, não devolve nada cifrado. A
 * pergunta é "de quem é", e a resposta é um nome.
 */

import type { PrismaClient } from "@prisma/client";

/**
 * O mínimo de banco que esta leitura precisa.
 *
 * ⚠️ Tirado do próprio `PrismaClient` em vez de escrito à mão. Uma interface
 * caseira aqui declararia o formato do `select` como se fosse o formato da
 * tabela — e o compilador aceitaria uma leitura que o banco não faz. O tipo tem
 * de vir de quem sabe: o cliente gerado.
 */
type BancoDoDono = Pick<PrismaClient, "metaWhatsAppConfig">;

export type DonoDoNumero =
  | {
      achado: true;
      /** `true` quando o id conferido é o que o produto usa como número de vendas. */
      ehONumeroDeVendasConfigurado: boolean;
      restaurante: { id: string; nome: string; ativo: boolean };
      wabaId: string;
      numeroVisivel: string | null;
      estadoDaConexao: string;
      coexistencia: boolean;
    }
  | {
      achado: false;
      ehONumeroDeVendasConfigurado: boolean;
      /**
       * ⚠️ "Não está na nossa base" **não** é "não é de ninguém". Pode ser um
       * número de outra conta do portfólio da Meta que nunca passou por aqui. A
       * frase é escrita assim de propósito: concluir a negação a partir do
       * silêncio do nosso banco foi metade do defeito original.
       */
      observacao: string;
    };

/** Só dígitos, e um tamanho plausível de id da Graph API. */
export function pareceIdDeNumero(v: string): boolean {
  return /^\d{10,20}$/.test(v);
}

export async function deQuemEONumero(
  db: BancoDoDono,
  phoneNumberId: string,
  numeroDeVendasConfigurado: string | null,
): Promise<DonoDoNumero> {
  const ehONumeroDeVendasConfigurado =
    numeroDeVendasConfigurado !== null && numeroDeVendasConfigurado === phoneNumberId;

  const cfg = await db.metaWhatsAppConfig.findUnique({
    where: { phoneNumberId },
    select: {
      restaurantId: true,
      wabaId: true,
      displayPhoneNumber: true,
      connectionStatus: true,
      coexistence: true,
      restaurant: { select: { id: true, name: true, isActive: true } },
    },
  });

  if (!cfg || !cfg.restaurant) {
    return {
      achado: false,
      ehONumeroDeVendasConfigurado,
      observacao:
        "Nenhum restaurante desta base tem este phone_number_id. Isso NÃO prova " +
        "que o número não é de ninguém — pode pertencer a outra conta do " +
        "portfólio da Meta que nunca passou por aqui.",
    };
  }

  return {
    achado: true,
    ehONumeroDeVendasConfigurado,
    restaurante: { id: cfg.restaurant.id, nome: cfg.restaurant.name, ativo: cfg.restaurant.isActive },
    wabaId: cfg.wabaId,
    numeroVisivel: cfg.displayPhoneNumber,
    estadoDaConexao: cfg.connectionStatus,
    coexistencia: cfg.coexistence,
  };
}
