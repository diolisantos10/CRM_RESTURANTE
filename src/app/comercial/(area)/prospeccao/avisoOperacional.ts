/**
 * O AVISO OPERACIONAL — traduz causa técnica em frase de gente, e só isso.
 *
 * ── POR QUE ESTA FUNÇÃO É PURA, E MORA FORA DO COMPONENTE ───────────────────
 *
 * `ProspeccaoClient.tsx` decide QUANDO buscar cada dado (canal, pré-voo do
 * modelo, conferência da base). Esta função decide só O QUÊ MOSTRAR, dado o
 * que já foi buscado — nenhuma chamada de rede aqui, nenhuma regra nova: cada
 * `causa`/`motivo` abaixo já existe no backend (`conferirCanalDeVendas`,
 * `preVooDoModelo`/`conferirModeloDeAbordagem`, `conferirElegibilidadeReal`).
 * Ser pura é o que permite testar as SEIS causas sem servidor, sem mock de
 * rede e sem Playwright.
 *
 * ── A ORDEM É A CADEIA REAL DE DEPENDÊNCIA, NÃO UMA LISTA ARBITRÁRIA ────────
 *
 * Canal → autorização de envio → modelo aprovado → saldo do dia → saldo da
 * janela da Meta → contato elegível. Mostrar o primeiro elo quebrado é mais
 * útil que mostrar o último: se o canal não está configurado, dizer "sem
 * saldo" seria verdade sobre um sintoma e mentira sobre a causa.
 */

export interface ConferenciaDoCanalParaAviso {
  ok: boolean;
  causa?: "semPhoneNumberId" | "semToken" | "provedorNaoSuportado" | "aMetaRecusou";
  detalhe?: string;
}

export interface ConferenciaDoModeloParaAviso {
  pronto: boolean;
  causa?:
    | "semNomeConfigurado"
    | "semToken"
    | "naoAchado"
    | "naoAprovado"
    | "naoAutorizado"
    | "variaveisNaoBatem"
    | "metaRecusou";
  detalhe?: string;
}

export interface ConferenciaDaBaseParaAviso {
  elegiveisSeAtivar: number;
  pendentes: number;
  saldoDiario: number;
  saldoDaJanela: number;
  tetoDoDia: number;
}

export interface AvisoOperacionalInput {
  /** `null` enquanto a leitura não voltou — não gera aviso sozinho. */
  canal: ConferenciaDoCanalParaAviso | null;
  /** `null` enquanto a leitura não voltou. */
  envioAutorizado: boolean | null;
  preVoo: ConferenciaDoModeloParaAviso | null;
  conferencia: ConferenciaDaBaseParaAviso | null;
}

export interface AvisoOperacional {
  titulo: string;
  detalhe?: string;
}

export function avaliarAvisoOperacional(input: AvisoOperacionalInput): AvisoOperacional | null {
  const { canal, envioAutorizado, preVoo, conferencia } = input;

  if (canal && !canal.ok) {
    if (canal.causa === "aMetaRecusou") {
      return {
        titulo: "A credencial do canal de envio não está válida.",
        detalhe: "A Meta recusou o acesso ao número de vendas — o token pode ter expirado ou sido revogado.",
      };
    }
    return {
      titulo: "O canal de envio por WhatsApp não está disponível.",
      detalhe: "Faltam as credenciais do número de vendas da Foocci.",
    };
  }

  if (envioAutorizado === false) {
    return {
      titulo: "O envio de mensagens ainda não foi autorizado.",
      detalhe: "A prospecção continua importando e organizando contatos — nenhuma mensagem sai enquanto isso não for liberado.",
    };
  }

  if (preVoo && !preVoo.pronto) {
    switch (preVoo.causa) {
      case "semNomeConfigurado":
        return { titulo: "Nenhum modelo de abordagem está configurado." };
      case "semToken":
        return { titulo: "O canal de envio não tem uma credencial configurada." };
      case "naoAchado":
        return { titulo: "O modelo de abordagem configurado não foi encontrado na Meta.", detalhe: preVoo.detalhe };
      case "naoAprovado":
        return { titulo: "O modelo de abordagem ainda não foi aprovado pela Meta.", detalhe: preVoo.detalhe };
      case "naoAutorizado":
        return {
          titulo: "O modelo de abordagem foi aprovado pela Meta, mas ainda não foi autorizado internamente para uso.",
          detalhe: preVoo.detalhe,
        };
      case "variaveisNaoBatem":
        return {
          titulo: "O modelo de abordagem mudou na Meta e precisa ser sincronizado antes de continuar.",
          detalhe: preVoo.detalhe,
        };
      case "metaRecusou":
        return { titulo: "Não consegui confirmar o modelo de abordagem com a Meta agora.", detalhe: preVoo.detalhe };
      default:
        return { titulo: "O modelo de abordagem não está pronto para enviar.", detalhe: preVoo.detalhe };
    }
  }

  if (conferencia) {
    if (conferencia.tetoDoDia > 0 && conferencia.saldoDiario <= 0) {
      return {
        titulo: "O limite de abordagens de hoje já foi todo usado.",
        detalhe: "Ele libera de novo na virada do dia.",
      };
    }
    if (conferencia.tetoDoDia > 0 && conferencia.saldoDaJanela <= 0) {
      return {
        titulo: "O limite de novas conversas do WhatsApp nas últimas 24 horas já foi usado.",
        detalhe: "É um limite da própria Meta — libera conforme as conversas mais antigas completam 24 horas.",
      };
    }
    if (conferencia.elegiveisSeAtivar === 0) {
      return conferencia.pendentes === 0
        ? { titulo: "Não há contatos na base para abordar.", detalhe: "Importe uma lista para começar." }
        : {
            titulo: "Não há contatos elegíveis para abordar agora.",
            detalhe: "Os contatos pendentes existem, mas estão bloqueados por opt-out, histórico recente ou descanso.",
          };
    }
  }

  return null;
}
