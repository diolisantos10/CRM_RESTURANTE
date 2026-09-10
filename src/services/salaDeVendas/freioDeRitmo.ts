/**
 * O FREIO DE RITMO — o que impede a lista inteira de sair de uma vez.
 *
 * ── O BURACO, MEDIDO EM 07/09/2026 ──────────────────────────────────────────
 *
 * Entre `entregarMensagem` e `enviarTextoDeVendas` **não havia contador, nem
 * janela de tempo, nem fila, nem espera**. Uma varredura por uma lista de
 * prospecção chamando a entrega dispararia tudo na velocidade da rede.
 *
 * O teto que existia (`ProspeccaoConfig.limiteDiario`) só rodava dentro de
 * `montarFilaDeProspeccao`, que **não envia**. Era um número de tela.
 *
 * ── POR QUE ISTO É O PIOR RISCO DA CASA, E NÃO SÓ DA PROSPECÇÃO ────────────
 *
 * O número de vendas queimado por excesso não derruba só a prospecção: **é o
 * mesmo número por onde a Foocci atende quem já é cliente.** A conta paga o
 * preço de um `for` mal escrito, e a Meta não devolve reputação.
 *
 * ── ⚠️ O QUE ESTE FREIO CONTA, E O QUE ELE DELIBERADAMENTE NÃO CONTA ───────
 *
 * Conta **só mensagem de modelo** (`tipo: TEMPLATE`) — que é a mensagem
 * iniciada pela empresa, a abordagem. **Não** conta resposta livre dentro da
 * janela de 24h: quem escreveu para a gente merece resposta, e um teto ali
 * silenciaria cliente esperando atendimento. Essa distinção é o coração deste
 * arquivo; misturar as duas transformaria um freio de prospecção em mordaça de
 * atendimento.
 *
 * ── ⛔ E POR QUE O AMBIENTE SÓ CONSEGUE APERTAR, NUNCA AFROUXAR ────────────
 *
 * Os tetos aceitam ajuste por variável de ambiente, mas **limitado ao teto
 * duro** deste arquivo. Uma trava que uma variável desliga não é trava — é
 * sugestão. Quem precisar de mais que o teto duro muda o código, em revisão,
 * com o motivo escrito.
 */

/**
 * ⛔ TETO DURO — 2.000 CONTATOS POR DIA, DECISÃO DO CEO
 *
 * O Diretor Geral fixou a capacidade da operação em **2.000 contatos por dia**.
 * O teto da hora (200) foi removido em 10/09/2026 — não foi autorizado e não foi
 * apresentado pela Meta. A fila escoa continuamente na maior velocidade aceita.
 *
 * Controle técnico de concorrência, retentativa e resposta de rate limit continua
 * sendo aplicado; não é teto comercial por hora, é tratamento de limite da Meta.
 *
 * O ambiente continua só APERTANDO. E o teto duro continua sendo o menor entre
 * o que a casa decidiu e **o que a Meta permite** — ver `tetosEmVigor`, que
 * aceita o tier medido. Capacidade autorizada pela Meta não é autorização para
 * abordar: opt-out, horário, proveniência e descanso continuam valendo por cima.
 */
export const TETO_DURO_POR_DIA = 2000;

export interface Tetos {
  dia: number;
}

/**
 * O teto em vigor.
 *
 * `FOOCCI_SDR_TETO_DIA` só APERTA. Valor maior que o teto duro é ignorado —
 * silenciosamente não, o chamador vê o valor aplicado. Valor inválido (letra,
 * negativo, zero) cai no teto duro.
 *
 * ⭐ `tierDaMeta` é o teto de conversas iniciadas pela empresa que a **Meta**
 * concede a este número (250, 1.000, 10.000, ilimitado). Ele aperta o dia como
 * qualquer outro limite, e por um motivo diferente dos demais: estourá-lo não
 * produz uma recusa isolada, produz recusa em série — e recusa em série é como
 * a nota de qualidade do número cai. `null` (não medido) não afrouxa nada:
 * ausência de informação não é informação, então o teto da casa continua valendo
 * sozinho.
 */
export function tetosEmVigor(
  env: NodeJS.ProcessEnv = process.env,
  tierDaMeta?: number | null,
): Tetos {
  const dia = aperta(env.FOOCCI_SDR_TETO_DIA, TETO_DURO_POR_DIA);
  const tier =
    typeof tierDaMeta === "number" && Number.isInteger(tierDaMeta) && tierDaMeta > 0
      ? tierDaMeta
      : null;

  return {
    dia: tier === null ? dia : Math.min(dia, tier),
  };
}

function aperta(bruto: string | undefined, duro: number): number {
  const n = Number((bruto ?? "").trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return duro;
  return Math.min(n, duro);
}

export interface JanelasDoRitmo {
  /** Abordagens que saíram nas últimas 24 horas. */
  nasUltimas24h: number;
}

export type VeredictoDoRitmo =
  | ({ pode: true } & JanelasDoRitmo)
  | ({
      pode: false;
      motivo: "tetoDoDia";
      /** Frase de gente, para a tela de quem apertou o botão. */
      detalhe: string;
    } & JanelasDoRitmo);

/**
 * A decisão, pura e sem banco.
 *
 * ⚠️ A comparação é `>=`, e não `>`. Com `>`, o teto deixaria passar um além:
 * o contador diria N, `N > N` seria falso, e a mensagem sairia. Erro de um,
 * na direção de mandar a mais.
 */
export function decidirPeloRitmo(j: JanelasDoRitmo, tetos: Tetos): VeredictoDoRitmo {
  if (j.nasUltimas24h >= tetos.dia) {
    return {
      pode: false,
      motivo: "tetoDoDia",
      detalhe: `teto de ${tetos.dia} abordagens em 24h já alcançado (${j.nasUltimas24h})`,
      ...j,
    };
  }

  return { pode: true, ...j };
}

/** O mínimo de banco que a contagem precisa. */
interface BancoDoFreio {
  leadMensagem: {
    count(args: unknown): Promise<number>;
  };
}

const UMA_HORA = 60 * 60 * 1000;
const UM_DIA = 24 * UMA_HORA;

/**
 * Conta o que REALMENTE saiu e decide.
 *
 * ⚠️ Conta `ENVIADA | ENTREGUE | LIDA`, e não `PENDENTE`. Pendente é mensagem
 * que ainda não saiu — contá-la faria uma fila represada por queda da Meta
 * bloquear o envio no minuto em que ela voltasse, que é exatamente quando se
 * precisa mandar.
 *
 * ⚠️ Não é transacional, e não precisa ser: dois processos podem passar juntos
 * e mandar uma a mais que o teto. Isso é aceitável — o que este freio existe
 * para impedir é a diferença entre 1.000 e 10.000, não entre 2.000 e 2.001.
 */
export async function conferirRitmo(
  db: BancoDoFreio,
  agora: Date = new Date(),
  tetos: Tetos = tetosEmVigor(),
): Promise<VeredictoDoRitmo> {
  const saiu = { in: ["ENVIADA", "ENTREGUE", "LIDA"] };

  const nasUltimas24h = await db.leadMensagem.count({
    where: {
      direcao: "SAIDA",
      tipo: "TEMPLATE",
      status: saiu,
      ocorreuEm: { gte: new Date(agora.getTime() - UM_DIA) },
    },
  });

  return decidirPeloRitmo({ nasUltimas24h }, tetos);
}
