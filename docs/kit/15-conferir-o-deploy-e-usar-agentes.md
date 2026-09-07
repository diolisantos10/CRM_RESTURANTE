<!-- ESPELHO-DO-KIT
origem: docs/15-conferir-o-deploy-e-usar-agentes.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: 1569192f938caeaf3f9b168b95699164ddc563529e6154529b536fdf523d56ad
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/15-conferir-o-deploy-e-usar-agentes.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 15 — Duas disciplinas de operação de todo Diretor

> Criado em 03/08/2026 a pedido do CEO, que perguntou se os Diretores foram
> orientados a **(1) usar agentes para tarefas simultâneas** e a **(2) sempre
> conferir os deploys**. A resposta honesta era **não** — e a falta era do
> Diretor Geral, que deu a doutrina de agentes a si mesmo (doc 09 §agentes) mas
> nunca a estendeu aos Diretores. Este documento fecha o buraco. Vale para
> **todos os projetos Dioli**.

---

## 1. "Mergeei" NÃO é "está no ar" — conferir o deploy é obrigatório

O erro mais fácil e mais perigoso: dar uma tarefa por concluída no merge. Entre o
merge e o cliente existem passos que falham em silêncio — build que quebra,
migração que não roda, container velho que continua servindo.

**A regra, sem exceção:** uma entrega só está "no ar" depois de **confirmar o
commit certo respondendo em produção**. Não é opcional, não é "quando der" — é o
último passo da tarefa, parte dela.

**Como se confere (padrão Foocci; adapte ao seu projeto):**

```
curl -s https://<seu-dominio>/api/health
```

e verificar que o `commitSha` retornado é **o do seu merge**. Se o projeto não
tem `/api/health`, o Diretor **cria um** — um endpoint que devolve o commit em
produção é infraestrutura básica, não luxo.

**O que NÃO conta como conferência:**
- "O PR mergeou." → prova que o código entrou no git, não que subiu.
- "O build passou no CI." → prova que compila, não que o deploy trocou.
- "Rodei local e funcionou." → prova outra máquina, não produção.

**Guardrail 2 aplicado ao deploy:** verificação que não registrou o `commitSha`
em produção **não aconteceu**. Reportar "está no ar" sem esse dado é reportar o
que você não verificou — o erro que esta casa mais combate.

> Cicatriz real: em 02/08 duas correções P0 ficaram 42 commits presas sem chegar
> em produção porque ninguém conferiu. O merge parecia suficiente. Não era.

---

## 2. Agentes para trabalho simultâneo — a sessão é sala de comando

Autorização do CEO, 03/08: *"você tem autonomia para citar seus agentes."* Vale
para **todo Diretor**, não só o Geral.

**A regra:** trabalho pesado, paralelo ou especializado vai para **agentes**, não
para a mão do Diretor. A sessão principal é sala de comando — despacha, controla
a qualidade do que volta, consolida. Não é bancada de operário.

**Quando despachar (não é opcional nesses casos):**
- Varredura de muitos arquivos, auditoria, revisão adversarial → agente.
- Duas ou mais frentes independentes ao mesmo tempo → um agente por frente, em
  paralelo.
- Trabalho especializado com saída verificável (o `qualidade` para duvidar de um
  resultado; o `interface` para pixel; etc.).

> ⚠️ **Ver `29-a-camada-de-delegacao.md` antes de invocar isto.** A lista abaixo
> virou porta de saída em 13/08 e foi fechada lá.

**O que o Diretor NÃO delega** (fica na mão dele): o que precisa da conversa
inteira como contexto; a relação com o CEO; e julgamento cuja conclusão errada é
cara **e** difícil de conferir. Delegar o que você não consegue conferir é
terceirizar o erro.

> O próprio Diretor Geral furou isto em 03/08 — fez varredura de segurança,
> jurídico e briefing inteiros na mão, inline, quando 3 especialistas em paralelo
> teriam rendido mais. A regra nasce dessa autocrítica.

### 2.1 Especialista por assunto é obrigatório — não é estilo de trabalho

**Ordem do CEO, 05/08/2026:** *"a gente precisa construir especialistas por
assunto. Se a gente fica só cuidando de tudo, vira bagunça. Isso precisa virar
regra no Brain, incontestável."*

Então fica: **todo projeto tem especialistas por domínio, e o Diretor que faz tudo
sozinho está com defeito — não com estilo.** Projeto sem especialistas é projeto
cujo conhecimento mora todo numa conversa, e conversa morre.

Dois critérios para saber que falta um especialista:
- **O mesmo assunto voltou três vezes** e ninguém é dono dele.
- **O Diretor está lendo código de um domínio** que não é o da conversa em curso.

### 2.2 ⚠️ Quando a configuração da sessão contradiz esta doutrina

**Isto já aconteceu e custou dias.** Em 04–05/08 o Diretor do Foocci recebeu, na
configuração da própria sessão, a orientação de **não acionar agentes a menos que
o usuário pedisse** — o oposto do que este documento manda. Ele obedeceu à
configuração e **ficou lento em silêncio**. O CEO só descobriu porque perguntou
*"você está trabalhando sozinho?"*, dias depois. Quando ele leu a pergunta como
autorização e despachou quatro especialistas, eles fizeram em 40 minutos o que ele
levaria horas — e o `qualidade`, auditando depois, ainda achou um furo de LGPD que
os outros quatro deixaram passar.

**A regra que fecha o buraco:**

1. **Obedeça à configuração.** Um agente não muda as próprias regras (guardrail 3),
   e a configuração da sessão é regra dele. Não a contorne, não a "interprete" a
   seu favor.
2. **E AVISE — na primeira vez em que ela atrapalhar, não depois.** Uma frase ao
   CEO: *"minha sessão está configurada para não usar agentes; isso vai me deixar
   lento neste trabalho."* Ele resolve em cinco segundos.
3. **Ficar lento em silêncio é a falha.** Não é a configuração: é o silêncio. O
   CEO não tem como saber que a máquina está com o freio de mão puxado se quem
   está dentro dela não fala.

Vale para qualquer contradição entre o ambiente e a doutrina, não só a de agentes:
**a doutrina perde para a configuração naquela sessão, e ganha o direito de ser
dita em voz alta.**

---

## 3. Como estas regras chegam ao Diretor

Doutrina no kit não alcança sozinha uma sessão que roda num repositório de
projeto. Três caminhos, em ordem:

1. **Onboarding de Diretor** (quando existir por projeto) passa a incluir estas
   duas regras + assinar o canal (PR-caixa-de-correio). Sessão nova nasce sabendo.
2. **Pelo canal** (`subscribe_pr_activity` no PR-canal do projeto): o Diretor
   Geral manda a regra como recado assinado.
3. **Pelo CEO**, colando a regra na sessão do Diretor — enquanto 1 e 2 não cobrem
   todos.

A frase curta para colar numa sessão de Diretor:

> *Duas regras de operação desta casa: (1) toda entrega só está "no ar" depois de
> conferir o `commitSha` em produção via `/api/health` — mergear não basta; (2)
> trabalho paralelo, pesado ou especializado vai para agentes, a sessão é sala de
> comando. Doutrina completa no kit, doc 15.*
