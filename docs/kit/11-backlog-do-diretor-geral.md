<!-- ESPELHO-DO-KIT
origem: docs/11-backlog-do-diretor-geral.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: 1faf3f6c44343bce6a4e3a956690d8331cb0abfd0b9096a31371d4dc0debbca8
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/11-backlog-do-diretor-geral.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 11 — Backlog do Diretor Geral

> Aberto em 2026-08-02 a pedido do CEO: *"faça seu backlog… e construa, estamos
> atrasados, não espere por mim."*
>
> **O que entra aqui:** trabalho que é do Diretor Geral — doutrina, coerência entre
> projetos, e prioridade *entre* projetos.
> **O que NÃO entra:** execução dentro de um projeto. Isso é do Diretor dele.

---

## ⛔ A regra que já foi furada — leia antes de abrir qualquer editor

**O Diretor Geral NÃO executa dentro de projeto que tem Diretor ativo.**

Furada em 02/08/2026, por mim, o dia inteiro. Corrigi bugs, escrevi serviço novo,
mergeei PR — tudo dentro do Foocci, **com o Diretor do Foocci trabalhando no mesmo
repositório na mesma hora**. Quem viu foi o CEO: *"você precisa sair de dentro do
Foocci."*

**Por que é errado, e não é questão de etiqueta:**

1. **Inverte a estrutura.** Um Diretor que vê o chefe codar na casa dele aprende que
   a fronteira é decorativa. A regra seguinte que ele furar, furou porque eu
   ensinei.
2. **Duplica trabalho.** Nós dois medimos a mesma coisa e escrevemos no mesmo
   arquivo. O merge saiu limpo por sorte.
3. **Some com contexto.** O que eu construí ficou só na minha cabeça até eu
   escrever uma entrega às pressas. Se a sessão morresse antes, morria comigo.

**O que fazer no lugar:** achou um defeito num projeto? **Escreva a ordem de
serviço** no `docs/pendencias.md` dele — o quê, por que importa, e o que quebra se
ninguém mexer. Depois avise o CEO que há trabalho descrito esperando. **Não abra o
editor.**

**A exceção, e é só uma:** projeto **sem** Diretor ativo. Aí não há de quem ser a
execução, e você faz — deixando registrado o que fez, para quando o Diretor nascer.

> Como saber se há Diretor ativo? Pergunte ao CEO. É uma frase, e é mais barata que
> um dia inteiro de trabalho duplicado.

---

## Como este backlog funciona

O CEO não é fila de aprovação. **Item que não precisa de decisão de dono, executa.**
Item que precisa, vai para a seção "Depende do CEO" com a pergunta pronta — e o
resto do trabalho continua.

Todo item fechado vira registro: doutrina no kit, execução no repositório do
projeto.

---

## 🔨 Em execução

### ~~E1 · Etapa 0 da saída da Evolution~~ — **ENTREGUE ao Diretor do Foocci**
**Projeto:** Foocci · 02/08

A Etapa 0a foi feita e está em produção (`fbdc11e9`) — quatro guardas de entrada
passando a valer na Meta, incluindo a trava de Staff/Fornecedor que **nunca tinha
valido lá**.

**E foi exatamente aqui que a regra acima foi furada.** A 0b (pedido por texto)
ficou escrita no `docs/pendencias.md` do Foocci e é do Diretor dele. Eu não pego.

O CEO decidiu: só Meta. Medido — 239 arquivos citam Evolution e o padrão do banco
é `EVOLUTION`, então todo restaurante existente está nela. Seis comportamentos só
existem no webhook da Evolution; portá-los é **aditivo** e é pré-requisito de
qualquer migração.

> ⚠️ **Reivindicado explicitamente** porque o Diretor do Foocci está ativo no mesmo
> repositório. Ver "Protocolo de reivindicação" abaixo.

---

## 📋 Fila

*Vazia.* Os cinco itens abertos em 02/08 foram executados no mesmo dia, por ordem
do CEO: *"pode executar todos"*.

---

## 🧍 Depende do CEO (não bloqueia o resto)

| Pergunta | Onde |
|---|---|
| **Preço dos 3 planos** | 🔴 **é o assunto agora.** O site está no ar mostrando "em definição" |
| **Despertar agendado do Diretor Geral** | `perguntas-abertas.md` — a primeira pergunta do canal novo |
| Revisão jurídica das páginas legais | ele assumiu |
| Liberar o site comercial (segunda) | `claude/lancamento-site`, pronto e verificado |

---

## ✅ Fechados

| # | O que | Quando |
|---|---|---|
| — | Mineração dos 9 chats antigos do Foocci | 01–02/08 |
| — | PM → Diretor em toda a estrutura | 01/08 |
| — | Canal de escalada no Foocci | 02/08 |
| — | Decisão "só Meta" registrada com números medidos | 02/08 |
| — | Painel que dizia "Conectado" sem estar, travado por teste | 02/08 |
| — | Site comercial pronto | 02/08 · **lançado pelo Diretor do Foocci** |
| E7 | Padrão de cofre de credencial + ordens de serviço nos dois projetos ativos | 02/08 |
| E2 | A interface entre Diretores — limite, proposta e o lugar único | 02/08 |
| E3 | Canal de escalada no Dioli Digital (+ rename PM → Diretor lá) | 02/08 |
| E4 | Protocolo de reivindicação | 02/08 |
| E5 | Gatilho de quando montar Diretor num projeto que acorda | 02/08 |
| E6 | Quadro de presença — quem está trabalhando agora | 02/08 |

---

## Protocolo de reivindicação — como dois Diretores não se atropelam

Descoberto na marra em 02/08: o Diretor do Foocci e o Diretor Geral escreveram no
mesmo arquivo na mesma hora. O merge foi limpo **por sorte**, não por desenho.

**Antes de começar um bloco de trabalho num repositório que tem Diretor ativo:**

1. **Reivindique por escrito**, no `docs/pendencias.md` do projeto: quem está
   executando, o quê, desde quando.
2. **Commite a reivindicação antes de escrever a primeira linha de código.** Uma
   reivindicação que só existe na sua cabeça não coordena ninguém.
3. **Se já houver reivindicação de outro**, não duplique — some ao que ele faz, ou
   pegue outra coisa.
4. **Ao terminar, apague a reivindicação.** Reivindicação eterna é pior que
   nenhuma: vira ruído que todos aprendem a ignorar.

É o guardrail "um estado sem prazo é um vazamento" aplicado à coordenação.
