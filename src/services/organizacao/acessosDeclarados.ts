/**
 * ⭐⭐⭐ OS ACESSOS DECLARADOS — quem a companhia concede, escrito no repositório.
 *
 * ── A ORDEM QUE OBRIGOU ISTO ────────────────────────────────────────────────
 *
 * CEO, 06/09/2026: *"Eu já falei que eu não vou fazer nada, quem vai fazer é
 * você que vai entrar lá e fazer e enviar essa mensagem é você, está decidido."*
 *
 * E ele tem razão sobre o problema, ainda que a saída não possa ser a óbvia:
 * conceder acesso **não pode depender de alguém lembrar de abrir uma tela**.
 * Uma casa em que a única forma de criar acesso é um humano clicando é uma casa
 * que trava toda vez que esse humano está ocupado — que é sempre.
 *
 * ── ⛔ E POR QUE NÃO É UMA CREDENCIAL NA MÃO DE UM AGENTE ───────────────────
 *
 * A saída errada seria dar login de administrador a quem constrói. Aqui não há
 * credencial nova: **o acesso é declarado no repositório e aplicado no boot**,
 * pela própria plataforma, com o segredo que já vive no container. É o mesmo
 * molde de `seed-howtos`, `demo-bakery/self-seed` e `sala-de-vendas/seed` —
 * três precedentes desta casa, não uma invenção.
 *
 * O que muda: a concessão passa a ser **revisável e versionada**. Quem ganhou
 * acesso, com que papel e quando, fica no histórico do git em vez de existir só
 * na memória de quem clicou.
 *
 * ── ⚠️ AS DUAS COISAS QUE ELA NUNCA FAZ ────────────────────────────────────
 *
 *   1. **Nunca troca a senha de quem já existe.** Se trocasse, todo deploy
 *      rodaria uma senha nova e mandaria outro recado — a pessoa seria expulsa
 *      da própria conta a cada subida, e a caixa dela viraria um depósito de
 *      senhas mortas. Existe = não toca.
 *   2. **Nunca desliga ninguém.** Tirar uma linha daqui não corta acesso —
 *      cortar é ato deliberado, na tela, com trilha. Um arquivo que revoga por
 *      omissão transforma um `git revert` distraído em demissão em massa.
 */

import type { PrismaClient } from "@prisma/client";
import { criarPessoa } from "./pessoas";
import { avisarAcessoCriado } from "./avisoDeAcesso";
import { ROTA_DA_TROCA } from "@/lib/troca-de-senha";

export interface AcessoDeclarado {
  nome: string;
  email: string;
  /** Um dos `TIPOS_DE_ACESSO`. Recusado se não for. */
  papel: string;
  /** O crachá no Dioli Connect — é para lá que a senha provisória vai. */
  crachaConnect: string;
  /** Por que esta pessoa tem acesso. Fica no repositório, não na memória. */
  porque: string;
}

/**
 * A lista. Curta de propósito: só quem a companhia concedeu por decisão
 * registrada, e cada linha diz o porquê.
 */
export const ACESSOS_DECLARADOS: readonly AcessoDeclarado[] = [
  {
    nome: "Diretor Geral",
    email: "diretor.geral@agentes.foocci.com.br",
    // Decisão do CEO em 06/09/2026, depois de eu recomendar `AUDITOR_QA` e ele
    // recusar: *"Ele vai entrar com a credencial de diretor. Se ele é diretor é
    // diretor."* Fica registrado que é mais poder do que a recomendação — e que
    // a escolha foi dele, com o trade-off dito na frente.
    papel: "DIRETOR_FOOCCI",
    crachaConnect: "dioli.control-room.diretoria.diretor-geral",
    porque:
      "Acompanha a companhia inteira e a coerência entre produtos. Concedido pelo CEO em " +
      "06/09/2026, como Diretor e não como Auditoria, por decisão dele.",
  },
];

export interface ResultadoDaAplicacao {
  criados: Array<{ email: string; avisado: boolean; motivoDoAviso: string | null }>;
  /** Já existiam. Nada foi tocado — nem senha, nem papel. */
  intactos: string[];
  falhas: Array<{ email: string; motivo: string }>;
}

/**
 * Aplica a lista. Idempotente: rodar de novo não muda nada.
 *
 * ⚠️ **Nunca lança.** Roda no boot, atrás do mesmo molde dos outros seeds: um
 * defeito aqui não pode derrubar a subida do produto. Todo problema vira linha
 * no resultado, e o log do deploy mostra.
 */
export async function aplicarAcessosDeclarados(
  db: PrismaClient,
  origem: string,
  lista: readonly AcessoDeclarado[] = ACESSOS_DECLARADOS,
): Promise<ResultadoDaAplicacao> {
  const r: ResultadoDaAplicacao = { criados: [], intactos: [], falhas: [] };

  for (const a of lista) {
    const email = a.email.trim().toLowerCase();
    try {
      // ⛔ A trava da idempotência, e ela é a linha mais importante do arquivo.
      // `criarPessoa` TROCA a senha de quem já existe — é o comportamento certo
      // para "esqueci minha senha" e o errado para uma lista que roda a cada
      // deploy. Sem esta conferência, toda subida expulsaria a pessoa da própria
      // conta e encheria a caixa dela de senhas mortas.
      const existe = await db.internalUser.findUnique({ where: { email }, select: { id: true } });
      if (existe) {
        r.intactos.push(email);
        continue;
      }

      const criada = await criarPessoa(db, {
        nome: a.nome,
        email,
        papel: a.papel,
        crachaConnect: a.crachaConnect,
      });
      if (!criada.ok) {
        r.falhas.push({ email, motivo: criada.erro });
        continue;
      }

      const aviso = await avisarAcessoCriado({
        crachaConnect: a.crachaConnect,
        de: "dioli.foocci.direcao.diretor",
        senha: criada.senha,
        urlDaTroca: `${origem.replace(/\/+$/, "")}${ROTA_DA_TROCA}`,
        expiraEm: criada.expiraEm,
      });

      r.criados.push({
        email,
        avisado: aviso.avisou,
        motivoDoAviso: aviso.avisou ? null : aviso.motivo,
      });
    } catch (e) {
      r.falhas.push({ email, motivo: e instanceof Error ? e.message : String(e) });
    }
  }

  return r;
}
