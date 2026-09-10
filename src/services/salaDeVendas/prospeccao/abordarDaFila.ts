/**
 * O ÚLTIMO ELO — da fila de prospecção para a mensagem que sai.
 *
 * ── O QUE ESTAVA FALTANDO ───────────────────────────────────────────────────
 *
 * A casa tinha as duas pontas e nenhum fio entre elas:
 *
 *   · `materializarLead` transforma um item da lista em lead — e **não tinha um
 *     único chamador em produção**;
 *   · `abordarLead` manda a mensagem — e só sabia partir de um lead que já
 *     existisse.
 *
 * Este arquivo é o fio. Nada mais.
 *
 * ── ⚠️ POR QUE O FREIO É CONSULTADO AQUI, ANTES DE MATERIALIZAR ────────────
 *
 * `abordarLead` já confere o ritmo — mas ele confere DEPOIS que o lead existe.
 * Materializar primeiro e descobrir o teto depois deixaria um lead criado que
 * ninguém abordou: uma ficha órfã na base, nascida de uma tentativa que não
 * aconteceu. Multiplicado por uma lista grande, isso enche a carteira de gente
 * com quem a empresa nunca falou.
 *
 * A conferência dupla custa uma consulta e evita esse lixo. É repetição com
 * motivo, e está escrito qual é.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { materializarLead } from "./selecao";
import { abordarLead, type ResultadoDaAbordagem } from "../abordar";
import { conferirRitmo } from "../freioDeRitmo";
import { montarFilaDeProspeccao } from "./selecao";
import type { ConferenciaDoModelo, CausaDaConferencia } from "@/services/foocci-sdr/modelosDaMeta";

type Cliente = PrismaClient | Prisma.TransactionClient;

/** Os motivos de `abordarLead`, sem repetir a lista à mão. */
type MotivoDaAbordagem = Extract<ResultadoDaAbordagem, { abordou: false }>["motivo"];

export type ResultadoDaFila =
  | { abordou: true; leadId: string; mensagemId: string }
  | {
      abordou: false;
      /** `naoVirouLead` = o item nem chegou a ser lead (lote não liberado, já usado…). */
      motivo: "naoVirouLead" | MotivoDaAbordagem;
      detalhe: string;
    };

export async function abordarItemDaFila(
  db: Cliente,
  params: { itemId: string; autor: "HUMANO" | "SISTEMA"; autorUserId: string; agora?: Date },
): Promise<ResultadoDaFila> {
  const agora = params.agora ?? new Date();

  // ⚠️ ANTES de materializar. Ver o cabeçalho.
  const ritmo = await conferirRitmo(db, agora);
  if (!ritmo.pode) {
    return { abordou: false, motivo: "ritmo", detalhe: ritmo.detalhe };
  }

  const m = await materializarLead(db, params.itemId);
  if (!m.materializado) {
    return { abordou: false, motivo: "naoVirouLead", detalhe: m.motivo };
  }

  const r = await abordarLead(db, {
    leadId: m.leadId,
    autor: params.autor,
    autorUserId: params.autorUserId,
    agora,
  });

  if (r.abordou) {
    return { abordou: true, leadId: m.leadId, mensagemId: r.mensagemId };
  }

  // O motivo de `abordarLead` sobe inteiro. Traduzir aqui faria a tela mostrar
  // uma explicação que o serviço não deu.
  return { abordou: false, motivo: r.motivo, detalhe: r.detalhe };
}

// ─── A RODADA DO DIA ──────────────────────────────────────────────────────────

/**
 * Aborda a fila inteira de uma vez, e PARA na primeira falha de verdade.
 *
 * ── POR QUE ISTO PRECISOU EXISTIR ───────────────────────────────────────────
 *
 * `abordarItemDaFila` aborda **um** item, e a rota só sabia acioná-lo um por
 * chamada. Medido em 08/09/2026: não existe cron de prospecção — nenhuma das 17
 * pastas de `api/cron` é da Sala. Ou seja, os "250 por dia" que o CEO pediu
 * eram, na prática, **250 acionamentos manuais**.
 *
 * Esta função é o laço, e nada além do laço. Ela não decide quem entra (é a
 * fila), não confere teto (a fila já conta o dia no banco), não fala com a Meta
 * (é `abordarLead`) e não afrouxa portão nenhum: cada item passa exatamente
 * pelas mesmas travas de quando era clicado à mão.
 *
 * ── ⛔ PARAR NA PRIMEIRA FALHA É A REGRA, E ELA É DO DIRETOR GERAL ──────────
 *
 * *"Se o primeiro envio falhar, PARE a rodada e investigue. Não empurre 250 em
 * cima de um defeito — é assim que se queima uma lista de 4.000 num dia."*
 *
 * Por isso a rodada é **sequencial** e não paralela: o resultado do primeiro
 * envio é o que autoriza o segundo. Paralelizar seria trocar o freio por
 * velocidade num lugar onde o erro custa a lista inteira.
 *
 * ── O QUE **NÃO** É FALHA, e a distinção decide a rodada ────────────────────
 *
 * Item barrado por regra — quem pediu silêncio, quem está fora da janela, quem
 * já foi abordado há pouco — **não é defeito**: é o portão fazendo o trabalho
 * dele. Parar a rodada por isso deixaria um opt-out no topo da lista bloqueando
 * os outros 249. Esses são pulados, contados, e a rodada segue.
 *
 * Falha é o que indica que **o caminho está quebrado**: a mensagem não saiu por
 * razão nossa — canal, credencial, modelo, banco. Aí para.
 */

/**
 * O que fazer diante de cada motivo — e a lista é EXAUSTIVA de propósito.
 *
 * ⚠️ A primeira versão desta função trazia um `Set` com nomes que eu escrevi de
 * cabeça — `pediuSilencio`, `foraDaJanela`, `jaAbordado`, `semConsentimento`,
 * `duplicado`. **Nenhum deles existe.** Os motivos reais são os cinco de
 * `ResultadoDaAbordagem` (`abordar.ts:50`) mais o `naoVirouLead` desta camada.
 * Um `Set` com nome inventado não reprova em lugar nenhum: ele simplesmente
 * nunca casa, e toda recusa viraria "falha" — a rodada morreria no primeiro
 * opt-out da lista, para sempre, e pareceria defeito do canal.
 *
 * Por isso aqui é um `switch` exaustivo com `never` no fim: **motivo novo não
 * compila** enquanto ninguém disser o que fazer com ele. É a diferença entre
 * uma lista que envelhece calada e uma que obriga a decisão.
 */
type Reacao = "pula" | "pulaComLimite" | "encerra" | "falha";

/**
 * Quantas recusas SEGUIDAS da Meta a rodada tolera antes de desistir.
 *
 * Três, e o número tem razão: uma recusa é uma linha ruim da lista; três
 * seguidas não são coincidência — é o modelo, o token ou o número. Continuar
 * depois disso não aborda ninguém e gasta a lista contra uma parede.
 *
 * O contador zera a cada envio que dá certo: o que importa é a SEQUÊNCIA, não
 * o total. Uma lista com 20% de contatos ruins espalhados tem de rodar inteira.
 */
export const LIMITE_DE_RECUSAS = 3;

/** Os motivos que a fila pode devolver, sem repetir a lista à mão. */
type MotivoDaFila = Extract<ResultadoDaFila, { abordou: false }>["motivo"];

function reagirA(motivo: MotivoDaFila): Reacao {
  switch (motivo) {
    // O portão fazendo o trabalho dele. Pular um opt-out e seguir é o certo —
    // parar aqui deixaria um silêncio no topo da lista bloqueando os outros 249.
    case "naoVirouLead":
    case "portaoRecusou":
      return "pula";

    // ⭐ Um `{{n}}` do mapa sem valor neste contato (sem cidade, sem nome de
    // restaurante). É uma linha da lista, não a máquina: pula com o motivo
    // `campoVazio:{{n}}` e segue — regra do Diretor Geral, 10/09/2026.
    case "campoVazio":
      return "pula";

    // O freio do dia/hora. Não é defeito, e não adianta tentar o próximo: ele
    // vai bater no mesmo teto. A rodada termina, satisfeita.
    case "ritmo":
      return "encerra";

    /**
     * ⭐ A META RECUSANDO NÃO MATA MAIS A RODADA NO PRIMEIRO — ordem do
     * Diretor Geral, 08/09: *"se o parâmetro faltar, pule o contato e siga em
     * vez de parar a rodada inteira. Um contato pulado custa um contato; uma
     * rodada travada custa o dia."*
     *
     * O caso concreto que ele previu: o modelo aprovado tem `{{1}}`, o contato
     * veio da lista sem nome, o código manda zero parâmetros e a Meta recusa.
     * Com a regra antiga, **o primeiro contato sem nome derrubava os outros
     * 249** — e o dia inteiro daria zero por causa de uma linha da planilha.
     *
     * ⚠️ Mas "pula sempre" seria o outro extremo, e pior: modelo com nome
     * errado, token vencido ou número bloqueado fazem a Meta recusar TODOS —
     * e a rodada gastaria a lista inteira batendo na mesma parede, em silêncio.
     * Por isso a recusa da Meta é `pulaComLimite`: pula, conta, e para quando
     * as recusas viram padrão em vez de exceção. Ver `LIMITE_DE_RECUSAS`.
     */
    case "aMetaRecusou":
      return "pulaComLimite";

    // O caminho está quebrado por razão NOSSA — banco, lead que sumiu. Não é
    // uma linha ruim da lista: é a máquina. Para na primeira, e grita.
    case "leadNaoExiste":
    case "naoConseguiuGravar":
    // Modelo configurado sem mapa de variáveis: TODO item falharia igual. O
    // pré-voo já barra isso antes do primeiro contato; se chegou aqui, é a
    // máquina — para na primeira.
    case "semMapa":
      return "falha";

    default: {
      const naoTratado: never = motivo;
      return naoTratado;
    }
  }
}

/**
 * ⭐ O PRÉ-VOO: a conferência do modelo ANTES do primeiro contato.
 *
 * ── POR QUE ELA EXISTE, E POR QUE NÃO BASTAVA O #216 ────────────────────────
 *
 * O #216 ensinou a rodada a pular a recusa da Meta e parar depois de três
 * seguidas. Isso protege a lista, mas **paga o aprendizado em contatos**: se o
 * modelo aprovado espera duas variáveis e o envio manda uma, TODOS os envios
 * seriam recusados — e a rodada descobriria isso queimando três nomes de uma
 * lista de 4.000 para aprender o que uma consulta à Graph responde de graça.
 *
 * Recusar aqui custa uma consulta. Descobrir lá custa três contatos e o dia.
 *
 * ── ⚠️ A REGRA: MODELO NÃO CONFERIDO, RODADA NÃO SAI ───────────────────────
 *
 * **Só sai quando a conferência diz `pronto`.** Qualquer outro veredito aborta,
 * inclusive *"não consegui ler"*.
 *
 * ── COMO ESTA REGRA CHEGOU AQUI, porque ela já foi outra ────────────────────
 *
 * Ela nasceu com uma exceção que eu defendi: `metaRecusou` (a Graph não
 * respondeu) **seguia**, porque *"não sei não é o mesmo que está errado"*, e
 * aterrar o dia por uma leitura instável seria a proteção mais destrutiva que o
 * problema.
 *
 * O argumento era bom **e a premissa dele caiu**. Naquele momento, disparar a
 * rodada era a única forma de aprender qualquer coisa sobre o modelo: seguir
 * comprava informação. Desde o #226 existe a conferência isolada
 * (`api/cron/prospeccao/pre-voo`), que responde a mesma pergunta **de graça**.
 * Seguir às cegas parou de comprar informação e passou a só pagar em contato.
 *
 * E os custos nunca foram simétricos: **rodada abortada roda de novo; contato
 * queimado não volta.** Em 08/09/2026 a exceção custou seis nomes de uma lista
 * de 4.000, gastos para reaprender uma frase que a consulta grátis já dizia.
 *
 * ── E POR QUE NÃO EXISTE MAIS UMA TABELA DE CAUSAS ─────────────────────────
 *
 * Existia — `reagirAoPreVoo`, com um `switch` exaustivo classificando cada
 * veredito. Ela desapareceu quando **todas** as causas passaram a abortar:
 * tabela cuja resposta é sempre a mesma não classifica nada, só dá aparência de
 * critério a uma linha só. No dia em que um veredito merecer seguir, ela volta
 * — com o caso que a justifica ao lado.
 */
export interface ResultadoDaRodada {
  /** Quantas mensagens saíram. */
  abordados: number;
  /** Quantos itens o portão barrou por regra — não é defeito. */
  pulados: number;
  /** Por que a rodada terminou. `filaAcabou` e `freio` são fins normais. */
  parouPor: "filaAcabou" | "tetoDaRodada" | "freio" | "falha" | "preVoo";
  /**
   * Preenchido quando `parouPor` é `falha` ou `preVoo`.
   *
   * `itemId` é `null` no pré-voo — e o `null` é informação, não buraco: quer
   * dizer que a rodada parou **antes de tentar qualquer contato**. Inventar um
   * item aqui mandaria quem investiga procurar um culpado que não existe.
   */
  falha: { itemId: string | null; motivo: string; detalhe: string } | null;
  /**
   * Uma linha por item tentado, na ordem. É o extrato da rodada.
   *
   * ⚠️ `detalhe` existe porque `motivo` é a CLASSE, não a regra. Medido em
   * 08/09/2026: a rodada devolveu `portaoRecusou: 10` — verdadeiro, e inútil.
   * Existem sete regras dentro desse portão (opt-out, telefone, canal,
   * histórico, consentimento, teto, descanso, horário) e a linha não dizia
   * qual. O `detalhe` do portão já trazia a frase pronta, com o caso concreto;
   * era esta camada que a descartava.
   */
  extrato: Array<{ itemId: string; ok: boolean; motivo?: string; detalhe?: string }>;
}

export async function abordarARodadaDoDia(
  db: Cliente,
  params: {
    /**
     * Quem responde pela rodada. `HUMANO` é alguém apertando o botão;
     * `SISTEMA` é o gatilho das 9h.
     *
     * ⚠️ `SISTEMA` **não é anônimo**, e isto é o coração do desenho. O
     * cabeçalho de `abordarLead` promete que *"toda mensagem que sai em nome da
     * empresa tem um responsável, e 'o sistema mandou' não é resposta"*. A
     * rodada automática honra a promessa: o responsável de cada item é **quem
     * liberou o lote dele** (`loteDeProspeccao.liberadoPor`) — uma pessoa, com
     * nome, que autorizou a casa a falar com aquela lista.
     *
     * Lote sem `liberadoPor` não é abordado. Ninguém autorizou.
     */
    autor: "HUMANO" | "SISTEMA";
    /** Obrigatório quando `autor` é HUMANO; ignorado quando é SISTEMA. */
    autorUserId?: string;
    /** Teto DESTA rodada, além do teto do dia que a fila já aplica. */
    teto?: number;
    agora?: Date;
    canalPronto: boolean;
    /**
     * ⭐ A conferência do modelo, **obrigatória e injetada**.
     *
     * Ela é parâmetro em vez de chamada interna por uma razão só, e ela é a
     * doença crônica desta casa: *peça pronta, ninguém chamando*. Com o tipo
     * exigindo, **um chamador novo não compila** sem dizer o que faz o pré-voo
     * dele — em vez de nascer mudo e ninguém perceber por semanas.
     *
     * Em produção vale `preVooDoModelo` (`foocci-sdr/modelosDaMeta`). Nos
     * testes, uma função que devolve o veredito que o caso quer provar — e é
     * por isso que ela é injetável: conferir o modelo não pode exigir rede.
     */
    preVoo: () => Promise<ConferenciaDoModelo>;
  },
): Promise<ResultadoDaRodada> {
  const agora = params.agora ?? new Date();

  // ⚠️ ANTES de montar a fila. Não por custo — montar a fila é uma leitura —
  // mas porque a ordem é a mensagem: nada desta rodada começa antes de o modelo
  // estar conferido.
  const conferencia = await params.preVoo();
  if (!conferencia.pronto) {
    console.error("[prospeccao] rodada NÃO COMEÇOU — o modelo de abordagem reprovou no pré-voo", {
      causa: conferencia.causa,
      detalhe: conferencia.detalhe,
    });
    return {
      abordados: 0,
      pulados: 0,
      parouPor: "preVoo",
      falha: { itemId: null, motivo: conferencia.causa, detalhe: conferencia.detalhe },
      extrato: [],
    };
  }


  const fila = await montarFilaDeProspeccao(db, {
    canalPronto: params.canalPronto,
    agora,
    // A fila já corta pelo teto do dia contado no banco; o teto da rodada é uma
    // segunda cinta, para quem quer mandar dez de um lote que permite duzentos.
    ...(params.teto !== undefined ? { limite: params.teto } : {}),
  });

  /**
   * Quem autorizou cada lote — uma consulta só, e não uma por item.
   *
   * ⚠️ `liberadoPorUserId`, e NÃO `liberadoPor`. Este foi o defeito que derrubou
   * a primeira rodada real em que o portão liberou, 08/09/2026:
   * `liberadoPor` guarda o RÓTULO DE TELA (`Nome (userId)`), montado para
   * aparecer em "Liberado por …". Ele era entregue a `autorUserId`, que tem
   * chave estrangeira para `users`, e o Postgres recusou — HTTP 500, levando
   * junto os outros nove contatos da rodada.
   *
   * ⭐ E o id é CONFERIDO contra `internal_users` antes de valer — a tabela da
   * chave estrangeira, medida no schema (`LeadMensagem.autorUser` é relação com
   * `InternalUser`). A primeira versão conferia contra `users` e não casava
   * nada: a gente da Sala de Vendas não mora lá. Confiar na coluna
   * porque ela "deveria" ter um id é o mesmo erro uma camada adiante: id órfão
   * (usuário removido, preenchimento retroativo que não casou) voltaria a
   * estourar chave estrangeira na hora de gravar. Aqui ele vira
   * `semResponsavel`, que é um item pulado com motivo — não uma rodada morta.
   */
  const responsavelDoLote = new Map<string, string | null>();
  if (params.autor === "SISTEMA" && fila.liberados.length > 0) {
    const lotes = await db.loteDeProspeccao.findMany({
      where: { id: { in: [...new Set(fila.liberados.map((c) => c.loteId))] } },
      // `liberadoPor` (o rótulo) entra SÓ para o diagnóstico abaixo. Ele nunca
      // vira `autorUserId` — foi assim que a rodada morreu em 08/09.
      select: { id: true, liberadoPorUserId: true, liberadoPor: true },
    });

    const ids = [...new Set(lotes.map((l) => l.liberadoPorUserId).filter((v): v is string => !!v))];
    const existem = new Set(
      ids.length === 0
        ? []
        : (
            await db.internalUser.findMany({ where: { id: { in: ids } }, select: { id: true } })
          ).map((u) => u.id),
    );

    for (const l of lotes) {
      const id = l.liberadoPorUserId;
      const vale = !!id && existem.has(id);
      responsavelDoLote.set(l.id, vale ? id : null);

      /**
       * ⚠️ O ALERTA CARREGA A PRÓPRIA EVIDÊNCIA — guardrail 6, terceira vez hoje.
       *
       * Em 08/09/2026 a rodada devolveu `semResponsavel: 10` e **não havia como
       * saber por quê**: o preenchimento retroativo tinha lido `liberadoPor` e
       * não casado, e o log não mostrava o rótulo que ele tentou ler. Sem isso,
       * a investigação exige acesso ao banco de produção — que quem lê o log
       * não tem.
       *
       * As duas causas possíveis produzem consertos opostos, e a linha abaixo
       * distingue as duas: **rótulo em formato inesperado** (o `substring` da
       * migração não achou parênteses) versus **id que não existe em `users`**
       * (usuário removido). Uma pede outra extração; a outra pede outra pessoa.
       */
      if (!vale) {
        console.error("[prospeccao] lote sem responsável que o banco reconheça", {
          loteId: l.id,
          liberadoPorUserId: id ?? null,
          idExisteEmUsers: id ? existem.has(id) : false,
          // O rótulo cru, para ver o FORMATO. É nome + id, o mesmo que a tela
          // já mostra em "Liberado por …".
          rotuloLiberadoPor: l.liberadoPor ?? null,
        });
      }
    }
  }

  const extrato: ResultadoDaRodada["extrato"] = [];
  let abordados = 0;
  let pulados = 0;
  /** Recusas da Meta em sequência. Zera a cada envio que dá certo. */
  let recusasSeguidas = 0;

  for (const candidato of fila.liberados) {
    const responsavel =
      params.autor === "SISTEMA"
        ? responsavelDoLote.get(candidato.loteId) ?? null
        : params.autorUserId ?? null;

    if (!responsavel) {
      // Sem quem responda, não sai. É o portão, não um defeito: um lote sem
      // `liberadoPor` é um lote que ninguém autorizou.
      pulados += 1;
      extrato.push({
        itemId: candidato.itemId, ok: false, motivo: "semResponsavel",
        detalhe:
          `o lote ${candidato.loteId} não tem um responsável que o banco reconheça` +
          ` (liberadoPorUserId ausente ou apontando para usuário inexistente)`,
      });
      continue;
    }

    if (params.teto !== undefined && abordados >= params.teto) {
      return { abordados, pulados, parouPor: "tetoDaRodada", falha: null, extrato };
    }

    const r = await abordarItemDaFila(db, {
      itemId: candidato.itemId,
      autor: params.autor,
      autorUserId: responsavel,
      agora,
    });

    if (r.abordou) {
      abordados += 1;
      recusasSeguidas = 0;
      extrato.push({ itemId: candidato.itemId, ok: true });
      continue;
    }

    const reacao = reagirA(r.motivo);
    extrato.push({ itemId: candidato.itemId, ok: false, motivo: r.motivo, detalhe: r.detalhe });

    if (reacao === "pula") {
      pulados += 1;
      continue;
    }

    if (reacao === "encerra") {
      return { abordados, pulados, parouPor: "freio", falha: null, extrato };
    }

    if (reacao === "pulaComLimite") {
      pulados += 1;
      recusasSeguidas += 1;
      if (recusasSeguidas < LIMITE_DE_RECUSAS) continue;

      console.error("[prospeccao] rodada INTERROMPIDA — a Meta recusou seguidas vezes", {
        recusasSeguidas,
        ultimoItem: candidato.itemId,
        motivo: r.motivo,
        detalhe: r.detalhe,
        jaAbordadosNestaRodada: abordados,
      });
      return {
        abordados,
        pulados,
        parouPor: "falha",
        falha: { itemId: candidato.itemId, motivo: r.motivo, detalhe: r.detalhe },
        extrato,
      };
    }

    // ⛔ Falha de verdade: o caminho está quebrado. A rodada morre aqui, e o
    // motivo sobe inteiro — quem investiga precisa do item e da razão, não de
    // "a rodada falhou".
    console.error("[prospeccao] rodada INTERROMPIDA na primeira falha", {
      itemId: candidato.itemId,
      motivo: r.motivo,
      detalhe: r.detalhe,
      jaAbordadosNestaRodada: abordados,
    });
    return {
      abordados,
      pulados,
      parouPor: "falha",
      falha: { itemId: candidato.itemId, motivo: r.motivo, detalhe: r.detalhe },
      extrato,
    };
  }

  return { abordados, pulados, parouPor: "filaAcabou", falha: null, extrato };
}
