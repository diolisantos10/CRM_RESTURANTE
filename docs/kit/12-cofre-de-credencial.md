<!-- ESPELHO-DO-KIT
origem: docs/12-cofre-de-credencial.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: f749d1705ff31b4b0494266ebe35d6bf18e7c299daf92597f1ae3bf7eafa38e8
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/12-cofre-de-credencial.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 12 — Cofre de credencial: o padrão que todo projeto segue

> Criado em 2026-08-02. **Este documento não existe para o CEO parar de colar
> segredo no chat** — ele autorizou fazer isso e a decisão está registrada em
> `09-como-trabalhar-aqui.md` §2.3.
>
> Existe pelo motivo oposto: **colar em chat é o sintoma de que faltava lugar.**
> Enquanto faltar, o chat continua sendo o cofre por padrão — e chat não tem
> rotação, não tem histórico de quem viu, e some quando a aba fecha.

---

## 1. A evidência de que o problema é fricção, não disciplina

Quatro credenciais passaram por conversa em dois dias. Todas com o mesmo padrão: o
trabalho estava travado e o único caminho rápido era colar.

No dia **02/08**, o Foocci ganhou a tela `/admin/meta`. O CEO colou as credenciais
**lá**, no mesmo dia, sem ninguém pedir.

> **A conclusão que vale para todo agente desta casa:** quando o dono escolhe o
> caminho "errado" repetidamente, o caminho certo está caro demais. Consertar o
> caminho é trabalho; reclamar da escolha não é.

---

## 2. O padrão — o que um cofre precisa ter

Copiado do que o Foocci acertou, e generalizado. Um cofre que não tenha os cinco
não é cofre, é campo de texto.

| # | Requisito | Por quê |
|---|---|---|
| 1 | **Criptografado em repouso** | O banco vaza junto com o backup |
| 2 | **Nunca devolve o valor** | A tela mostra `••••` e "preenchido em 02/08". Ler de volta transforma o cofre em fonte de vazamento |
| 3 | **Testa contra o serviço real** | Botão que chama o provedor e mostra a resposta **dele**. Sem isso o dono não sabe se colou certo, e cola de novo no chat "para conferir" |
| 4 | **Banco primeiro, ambiente depois** | Migração sem downtime: quem já usa variável de ambiente continua funcionando até alguém colar na tela |
| 5 | **Registra quando foi preenchido** | É o que torna a **ausência de rotação visível** — sem cobrar ninguém |

### O que o cofre NÃO faz

- **Não avisa para rotacionar.** Isso virou ruído e foi encerrado por decisão do CEO.
- **Não bloqueia** o funcionamento por credencial velha. Proteção que derruba o
  serviço é mais destrutiva que o problema (guardrail 5).

---

## 3. Onde falta, hoje

| Projeto | Cofre | Falta |
|---|---|---|
| **Foocci** | ✅ `/admin/meta` — Meta | **Acesso do próprio Diretor ao admin.** Sem ele, sessão nova depende do CEO para tudo |
| **Dioli Digital** | ❌ nenhum | DeepSeek, e o que mais o Brain consumir |
| Adormecidos | — | Não precisam. Cofre nasce quando o projeto acorda |

**Estas são ordens de serviço para o Diretor de cada projeto**, escritas no
`docs/pendencias.md` deles. O Diretor Geral não executa dentro de casa com dono —
ver `11-backlog-do-diretor-geral.md`.

---

## 4. A regra que fica

**Toda credencial que um humano precisa colar mais de uma vez merece cofre.**

Se um agente se pegar pedindo a mesma credencial pela segunda vez, isso não é
pedido: é um defeito de produto que ele acabou de encontrar. Abra a pendência.
