/**
 * PESSOAS E ACESSOS — a área de RH do Admin.
 *
 * ── O MODELO ANTERIOR ESTAVA ERRADO, E O CEO NOMEOU O ERRO ──────────────────
 *
 * A primeira versão pôs a criação de acesso **dentro da área comercial**, numa
 * tela onde quem chegava escolhia o próprio papel — inclusive "CEO". O CEO leu
 * e desmontou em uma frase:
 *
 *   *"Geralmente nas empresas é o RH que tem essa função. Eles têm uma área
 *   dentro do admin que cria logins e senhas pros funcionários novos e cancela
 *   os antigos. Esse modelo que você fez, em que a pessoa própria escolhe, não
 *   existe."*
 *
 * Ele está certo, e o erro não é de lugar — é de **quem decide**. Acesso não é
 * coisa que a pessoa pega; é coisa que a empresa concede. Uma tela em que quem
 * chega escolhe ser CEO não é um formulário mal colocado, é a ausência de uma
 * decisão que alguém deveria estar tomando.
 *
 * ── ⚠️ CANCELAR NÃO É APAGAR ────────────────────────────────────────────────
 *
 * Quem sai da empresa é **desativado**, nunca removido. O motivo é duro e
 * simples: o nome dessa pessoa está preso a cada conversa que ela atendeu e a
 * cada lead que ela moveu. Apagar o registro transformaria meses de histórico em
 * "atendido por ninguém" — e a trilha existe justamente para responder quem fez
 * o quê, inclusive sobre gente que já saiu.
 *
 * Desativado, o acesso morre na hora (`autenticarInterno` exige `isActive`) e o
 * histórico continua de pé.
 */

import type { InternalRole, Prisma, PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";
import { hash } from "bcryptjs";
// A regra da senha escolhida mora num módulo SEM import de servidor, porque a
// tela também a usa enquanto a pessoa digita. Duas cópias discordariam.
import { problemaComASenha } from "./senhaEscolhida";

type Cliente = PrismaClient | Prisma.TransactionClient;

/**
 * Os tipos de acesso, com o que cada um pode — em português de gente.
 *
 * A lista vive aqui e não na tela porque a **rota** também precisa dela para
 * recusar um papel inventado. Duas listas discordariam no primeiro mês, e a
 * discordância apareceria como "criei e não funciona".
 *
 * `AGENTE_IA` fica de fora de propósito: agente não faz login, e o papel é
 * recusado por `autenticarInterno` mesmo com senha gravada. Oferecê-lo aqui
 * criaria uma ficha que parece acesso e nunca entra.
 */
export const TIPOS_DE_ACESSO = [
  {
    papel: "AGENTE_HUMANO" as const,
    rotulo: "Vendedor (SDR)",
    resumo: "Atende os leads da carteira dele.",
    pode: [
      "abrir a área comercial e falar com o cliente",
      "assumir e devolver lead",
      "mover o cliente no funil",
      "ver os próprios números",
    ],
    naoPode: [
      "ver os clientes dos colegas",
      "ver o painel do time",
      "entrar no resto do Admin",
      "criar acesso para ninguém",
    ],
  },
  {
    papel: "GERENTE_DEPARTAMENTO" as const,
    rotulo: "Gerente comercial",
    resumo: "Responde pela fila e pelo time inteiro.",
    pode: [
      "tudo o que o vendedor faz",
      "ver TODOS os clientes da operação",
      "ver o painel com a carga de cada pessoa",
      "distribuir a fila",
    ],
    naoPode: ["criar acesso", "ver os outros departamentos da empresa"],
  },
  {
    papel: "DIRETOR_FOOCCI" as const,
    rotulo: "Diretor",
    resumo: "Enxerga a Foocci inteira.",
    pode: ["tudo o que o gerente faz", "ver todos os departamentos", "abrir o Admin inteiro"],
    naoPode: ["nada dentro da operação — é acesso amplo"],
  },
  {
    papel: "MASTER_CEO" as const,
    rotulo: "CEO",
    resumo: "Acesso total, inclusive a esta tela.",
    pode: ["tudo", "criar e cancelar acesso de qualquer pessoa"],
    naoPode: [],
  },
  {
    papel: "AUDITOR_QA" as const,
    rotulo: "Auditoria",
    resumo: "Lê, avalia e registra. Não mexe no que auditou.",
    pode: ["ver a operação inteira", "ver o painel", "registrar não conformidade"],
    naoPode: ["assumir cliente", "responder no lugar de ninguém", "criar acesso"],
  },
] as const;

const PAPEIS_VALIDOS = new Set<string>(TIPOS_DE_ACESSO.map((t) => t.papel));

export function tipoValido(papel: string): papel is InternalRole {
  return PAPEIS_VALIDOS.has(papel);
}

export interface PessoaNaLista {
  id: string;
  nome: string;
  email: string;
  papel: InternalRole;
  ativa: boolean;
  /** `null` = criada e nunca entrou. É diferente de "entrou há muito tempo". */
  ultimoAcesso: Date | null;
  criadaEm: Date;
}

/**
 * Todo mundo, ativos e desativados juntos.
 *
 * Esconder os desativados seria a escolha errada: quem abre esta tela em geral
 * está procurando **exatamente** alguém que saiu, para conferir se o acesso foi
 * mesmo cortado. Uma lista que some com eles responde "não achei" a quem
 * pergunta "cortaram?".
 *
 * Ordem: ativos primeiro, depois por nome. Quem trabalha hoje vem antes de quem
 * saiu no ano passado.
 */
export async function listarPessoas(db: Cliente): Promise<PessoaNaLista[]> {
  const linhas = await db.internalUser.findMany({
    select: {
      id: true,
      nome: true,
      email: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: [{ isActive: "desc" }, { nome: "asc" }],
  });

  return linhas.map((l) => ({
    id: l.id,
    nome: l.nome,
    email: l.email,
    papel: l.role,
    ativa: l.isActive,
    ultimoAcesso: l.lastLoginAt,
    criadaEm: l.createdAt,
  }));
}

export type ResultadoDeCriacao =
  | { ok: true; senha: string; jaExistia: boolean; id: string; foiEscolhida: boolean }
  | { ok: false; erro: string };

/**
 * Cria a pessoa, ou troca a senha de quem já existe.
 *
 * ⚠️ **O mesmo e-mail não cria duas pessoas — troca a senha da primeira.** É
 * comportamento útil (é assim que se recupera acesso perdido) e é uma armadilha
 * se ninguém avisar: quem digita o e-mail de um colega por engano derruba o
 * acesso dele sem receber erro nenhum.
 *
 * Por isso `jaExistia` volta na resposta, e a tela é obrigada a dizer "senha
 * trocada" em vez de "pessoa criada".
 */
export async function criarPessoa(
  db: Cliente,
  dados: {
    nome: string;
    email: string;
    papel: string;
    departamentos?: string[];
    /**
     * A senha escolhida à mão. Vazio ou ausente = a casa sorteia uma.
     *
     * Os dois caminhos continuam existindo de propósito: quem cria o acesso de
     * um vendedor na frente dele prefere escolher e falar em voz alta; quem cria
     * dez de uma vez prefere sortear. Tirar o sorteio para atender ao pedido
     * seria trocar um problema por outro.
     */
    senhaEscolhida?: string;
  },
): Promise<ResultadoDeCriacao> {
  const nome = dados.nome.trim();
  const email = dados.email.trim().toLowerCase();

  if (!nome) return { ok: false, erro: "Escreva o nome da pessoa." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { ok: false, erro: "E-mail inválido." };
  }
  if (!tipoValido(dados.papel)) {
    return { ok: false, erro: `Tipo de acesso desconhecido: ${dados.papel}` };
  }

  // ── A senha: escolhida ou sorteada ────────────────────────────────────────
  //
  // ⚠️ A conferência acontece AQUI, no servidor, mesmo a tela já tendo conferido
  // enquanto a pessoa digitava. A do navegador é conveniência: qualquer um
  // consegue chamar esta rota por fora dela, e uma trava que só existe na tela
  // não é trava — é decoração.
  const escolhida = (dados.senhaEscolhida ?? "").trim() ? dados.senhaEscolhida! : null;

  if (escolhida !== null) {
    const problema = problemaComASenha(escolhida, { nome, email });
    if (problema) return { ok: false, erro: problema };
  }

  const senha = escolhida ?? randomBytes(9).toString("base64url");
  const passwordHash = await hash(senha, 10);

  const jaExistia = await db.internalUser.findUnique({
    where: { email },
    select: { id: true },
  });

  const user = await db.internalUser.upsert({
    where: { email },
    // `isActive: true` no update é deliberado: recriar o acesso de alguém que
    // tinha sido desligado é como se readmite uma pessoa. Deixar `false` daria
    // uma senha nova que não entra — e o sintoma seria "criei e não funciona".
    //
    // ⛔⛔ `deveTrocarSenha: true` NOS DOIS CAMINHOS, e isso é o ponto.
    //
    // Ordem do CEO em 05/09/2026: *"deveria haver uma forma de a pessoa receber
    // uma senha provisória e já trocar. Esse é o procedimento padrão em qualquer
    // empresa."* Até aqui a casa sorteava, mostrava uma vez na tela de quem
    // criava — e a senha valia PARA SEMPRE. Quem criou o acesso ficava sabendo a
    // senha de quem entra, indefinidamente.
    //
    // ⚠️ Vale também quando a senha foi DIGITADA por quem cria. O que torna uma
    // senha provisória não é ela ter sido sorteada: é ela ter passado por um
    // terceiro. Marcar só o caminho do sorteio deixaria de fora exatamente o
    // caso em que uma pessoa fala a senha da outra em voz alta.
    update: { nome, role: dados.papel, isActive: true, passwordHash, deveTrocarSenha: true },
    create: { email, nome, role: dados.papel, passwordHash, deveTrocarSenha: true },
  });

  for (const slug of dados.departamentos ?? []) {
    const dep = await db.department.findUnique({ where: { slug }, select: { id: true } });
    if (!dep) continue; // departamento inexistente não derruba a criação da pessoa
    await db.departmentMembership.upsert({
      where: { internalUserId_departmentId: { internalUserId: user.id, departmentId: dep.id } },
      update: {},
      create: { internalUserId: user.id, departmentId: dep.id, isManager: false },
    });
  }

  return {
    ok: true,
    senha,
    jaExistia: Boolean(jaExistia),
    id: user.id,
    foiEscolhida: escolhida !== null,
  };
}

export type ResultadoDeCorte =
  | { ok: true; nome: string; ativa: boolean }
  | { ok: false; erro: string };

/**
 * Corta ou devolve o acesso de alguém.
 *
 * Não apaga (ver o cabeçalho). E não deixa cortar o último CEO: uma casa sem
 * ninguém que possa criar acesso é uma casa trancada por fora, e o conserto
 * seria um comando de terminal em produção — exatamente o que esta tela existe
 * para eliminar.
 */
export async function mudarAtivacao(
  db: Cliente,
  params: { id: string; ativa: boolean },
): Promise<ResultadoDeCorte> {
  const pessoa = await db.internalUser.findUnique({
    where: { id: params.id },
    select: { id: true, nome: true, role: true, isActive: true },
  });

  if (!pessoa) return { ok: false, erro: "Pessoa não encontrada." };

  if (!params.ativa && pessoa.role === "MASTER_CEO") {
    const outros = await db.internalUser.count({
      where: { role: "MASTER_CEO", isActive: true, id: { not: pessoa.id } },
    });
    if (outros === 0) {
      return {
        ok: false,
        erro: "Este é o último CEO ativo. Cortar o acesso dele tranca a casa por fora.",
      };
    }
  }

  await db.internalUser.update({
    where: { id: params.id },
    data: { isActive: params.ativa },
  });

  return { ok: true, nome: pessoa.nome, ativa: params.ativa };
}
