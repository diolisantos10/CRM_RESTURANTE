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
 * ⛔ TETO DURO — LEVANTADO EM 10/09/2026, PELO CAMINHO QUE ESTE ARQUIVO EXIGE
 *
 * Era 30/hora e 200/dia. O Diretor Geral fixou a capacidade da operação em
 * **2.000 contatos por dia, configurável**. Os dois números não podiam coexistir:
 * um teto configurável de 2.000 contra um teto duro de 200 não é um teto
 * configurável — é um número de tela que morre calado no nono por cento.
 *
 * Este arquivo já dizia como se faz: *"Quem precisar de mais que o teto duro
 * muda o código, em revisão, com o motivo escrito."* É exatamente isto.
 *
 * ⚠️ **O TETO DA HORA SUBIU JUNTO, E ELE NÃO É DETALHE.** A 30/hora, 2.000/dia é
 * inalcançável: 30 × 24 = 720. O teto do dia teria subido para 2.000 e a
 * operação continuaria parando em 720 — um segundo teto silencioso, no lugar
 * exato de onde o primeiro saiu. Com 200/hora, 2.000 cabe na janela autorizada
 * de atendimento (≈11 horas) sem precisar de rajada.
 *
 * ── O QUE NÃO MUDOU, E É O PONTO ────────────────────────────────────────────
 *
 * O ambiente continua só APERTANDO. E o teto duro continua sendo o menor entre
 * o que a casa decidiu e **o que a Meta permite** — ver `tetosEmVigor`, que
 * aceita o tier medido. Capacidade autorizada pela Meta não é autorização para
 * abordar: opt-out, horário, proveniência e descanso continuam valendo por cima,
 * e nenhum deles mora aqui.
 */
export const TETO_DURO_POR_HORA = 200;
export const TETO_DURO_POR_DIA = 2000;

export interface Tetos {
  hora: number;
  dia: number;
}

/**
 * Os tetos em vigor.
 *
 * `FOOCCI_SDR_TETO_HORA` e `FOOCCI_SDR_TETO_DIA` só APERTAM. Valor maior que o
 * teto duro é ignorado — silenciosamente não, o chamador vê o valor aplicado.
 * Valor inválido (letra, negativo, zero) cai no teto duro.
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
    hora: aperta(env.FOOCCI_SDR_TETO_HORA, TETO_DURO_POR_HORA),
    dia: tier === null ? dia : Math.min(dia, tier),
  };
}

function aperta(bruto: string | undefined, duro: number): number {
  const n = Number((bruto ?? "").trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return duro;
  return Math.min(n, duro);
}

export interface JanelasDoRitmo {
  /** Abordagens que saíram na última hora. */
  naUltimaHora: number;
  /** Abordagens que saíram nas últimas 24 horas. */
  nasUltimas24h: number;
}

export type VeredictoDoRitmo =
  | ({ pode: true } & JanelasDoRitmo)
  | ({
      pode: false;
      motivo: "tetoDaHora" | "tetoDoDia";
      /** Frase de gente, para a tela de quem apertou o botão. */
      detalhe: string;
    } & JanelasDoRitmo);

/**
 * A decisão, pura e sem banco.
 *
 * ⚠️ A comparação é `>=`, e não `>`. Com `>`, o teto de 30 deixaria passar a
 * trigésima primeira: o contador diria 30, `30 > 30` seria falso, e a mensagem
 * sairia. Erro de um, na direção de mandar a mais.
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

  if (j.naUltimaHora >= tetos.hora) {
    return {
      pode: false,
      motivo: "tetoDaHora",
      detalhe: `teto de ${tetos.hora} abordagens por hora já alcançado (${j.naUltimaHora})`,
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
 * para impedir é a diferença entre 30 e 3.000, não entre 30 e 31.
 */
export async function conferirRitmo(
  db: BancoDoFreio,
  agora: Date = new Date(),
  tetos: Tetos = tetosEmVigor(),
): Promise<VeredictoDoRitmo> {
  const saiu = { in: ["ENVIADA", "ENTREGUE", "LIDA"] };

  const [naUltimaHora, nasUltimas24h] = await Promise.all([
    db.leadMensagem.count({
      where: {
        direcao: "SAIDA",
        tipo: "TEMPLATE",
        status: saiu,
        ocorreuEm: { gte: new Date(agora.getTime() - UMA_HORA) },
      },
    }),
    db.leadMensagem.count({
      where: {
        direcao: "SAIDA",
        tipo: "TEMPLATE",
        status: saiu,
        ocorreuEm: { gte: new Date(agora.getTime() - UM_DIA) },
      },
    }),
  ]);

  return decidirPeloRitmo({ naUltimaHora, nasUltimas24h }, tetos);
}
