/**
 * A CHAVE E O TETO DO PRIMEIRO CONTATO.
 *
 * ── POR QUE ISTO É AMBIENTE E NÃO BANCO ─────────────────────────────────────
 *
 * A prospecção guarda a configuração dela numa linha de `prospeccao_config`
 * porque existe uma TELA onde alguém liga, pausa e ajusta o teto. Aqui não
 * existe tela — e criar uma tabela para um botão que ninguém aperta seria
 * cerimônia com custo de migration.
 *
 * O que se perde e o que não se perde:
 *
 *   · **não se perde a pausa imediata.** `FOOCCI_PRIMEIRO_CONTATO_LIGADO` é lida
 *     a cada rodada, no servidor. Trocar no Railway vale na chamada seguinte,
 *     **sem build** — o mesmo mecanismo de `FOOCCI_SALES_WHATSAPP_ATIVO`, e pela
 *     mesma razão: não tem `NEXT_PUBLIC_`, então não congela em bundle nenhum;
 *   · **perde-se quem pausou e por quê.** Variável de ambiente não guarda autor
 *     nem motivo. Está registrado como limitação, não como descuido: no dia em
 *     que existir tela de comando, isto vira tabela e a trilha aparece.
 *
 * ── NASCE DESLIGADO, E DUAS VEZES ───────────────────────────────────────────
 *
 * Ausência de variável = desligado, e teto ausente = zero = nada sai. Silêncio
 * nunca é permissão. E acima destas duas ainda está `FOOCCI_SDR_SEND_ENABLED`,
 * que é do CEO e não se mexe daqui: ligar tudo aqui e deixar aquela desligada
 * produz uma fila cheia e nenhuma mensagem — que é o estado correto de hoje.
 */

/** Teto de segurança do teto: nem que alguém digite 5000 no Railway. */
export const TETO_MAXIMO_POR_DIA = 200;

export interface ConfigDoPrimeiroContato {
  ligado: boolean;
  /** Quantas abordagens (abertura + lembrete) cabem hoje. Zero = nada sai. */
  tetoDiario: number;
}

export function configDoPrimeiroContato(): ConfigDoPrimeiroContato {
  return {
    ligado: (process.env.FOOCCI_PRIMEIRO_CONTATO_LIGADO ?? "").trim().toLowerCase() === "true",
    tetoDiario: lerTeto(process.env.FOOCCI_PRIMEIRO_CONTATO_TETO_DIARIO),
  };
}

/**
 * Lê o teto do ambiente. Texto que não é número vira **zero**, nunca o padrão
 * generoso: um `FOOCCI_PRIMEIRO_CONTATO_TETO_DIARIO=vinte` digitado com pressa
 * não pode abrir a torneira porque o `parseInt` falhou.
 */
export function lerTeto(cru: string | undefined): number {
  const n = Number.parseInt((cru ?? "").trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, TETO_MAXIMO_POR_DIA);
}

/** Quem assina a abordagem na trilha do lead. É por ele que o teto conta. */
export const ATOR_DO_PRIMEIRO_CONTATO = "primeiro-contato";
