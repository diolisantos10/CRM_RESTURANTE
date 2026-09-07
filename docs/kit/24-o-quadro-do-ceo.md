<!-- ESPELHO-DO-KIT
origem: docs/24-o-quadro-do-ceo.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: 599861a55953f033b0e69c93f96dc18c336a1b341aaa8e14a0c4c8bbfa518bd5
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/24-o-quadro-do-ceo.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 24 — O quadro do CEO: o único formato de relatório

> **Status:** ADOTADO por ordem do CEO em 08/08/2026.
> **Vale para:** todo Diretor, em todo projeto, ao fim de todo ciclo de trabalho.
> **Substitui:** o relatório em prosa. Não convive com ele.

---

## Por que isto existe

Palavras do CEO:

> *"Todos os chats falam muita coisa desnecessária que eu não leio nem cinco por
> cento."*

**Cinco por cento.** É essa a taxa de leitura do que os Diretores vêm escrevendo.
Não é preguiça de quem lê — é defeito de quem escreve.

O mecanismo do dano é o mesmo dos onze e-mails de falha de 07/08/2026: quando o
que importa chega misturado com o que não importa, a pessoa para de abrir tudo. E
aí a linha que valia dinheiro morre junto com o ruído. **Relatório longo não é
generoso; é a transferência do trabalho de filtrar para quem tem menos tempo.**

---

## O formato — obrigatório e literal

Ao final de cada ciclo de trabalho, o Diretor mantém **este quadro** atualizado.
Sem improviso de estrutura. Se um projeto precisar de uma seção nova, isso é
proposta ao Diretor Geral, não decisão local.

```
📋 BACKLOG

✅ FEITO
| Item | Prioridade |
|---|---|
| Descrição curta da entrega | 🔴 Alta / 🟡 Média / 🟢 Baixa |

🔄 EM ANDAMENTO
| Item | Prioridade |
|---|---|
| Descrição curta da tarefa | 🔴 Alta / 🟡 Média / 🟢 Baixa |

⏳ NÃO INICIADO
| Item | Prioridade |
|---|---|
| Descrição curta da tarefa | 🔴 Alta / 🟡 Média / 🟢 Baixa |

───────────────────────────────

👤 CEO — PENDÊNCIAS

1. Assunto: pergunta ou decisão necessária.
2. Assunto: pergunta ou decisão necessária.
```

---

## As regras

- **Uma tarefa por linha.** Uma pendência do CEO por item.
- **Extremamente objetivo.** Nada de contexto desnecessário.
- **Havendo opções claras, apresente-as diretamente** — o CEO escolhe, não deduz.
- Tarefa que muda de estágio **muda de lista**.
- Pendência respondida **sai do quadro**.
- **Decisão do CEO que gera trabalho entra no backlog** na mesma resposta.
- Seção vazia escreve **"Nenhum item."** — nunca some.

---

## ⭐ O que NÃO entra em "CEO — Pendências"

Esta seção é a que estraga primeiro, e o modo de falha tem nome: **encher a lista
dele com o que é do Diretor.**

Só entra o que depende **exclusivamente** de resposta, decisão, aprovação, escolha
ou informação **dele**. Preço, o que o produto promete, gastar dinheiro, risco
irreversível, prioridade entre blocos grandes.

**Não entra:** merge, deploy, teste, migration, achado de segurança, defeito de
tela, divisão de trabalho entre agentes. Isso é do Diretor — ele resolve e informa
**o que foi consertado**, não o que existe de aberto.

**O teste antes de escrever uma linha ali:** *"se eu decidisse isto sozinho e
desse errado, seria erro meu ou uma escolha de negócio que não era minha?"*
Erro meu → não pergunte, resolva. Escolha dele → pergunte.

> Isto nasceu de um erro real, em 08/08: o Diretor do Foocci subiu "quatro portas
> de segurança abertas", "no ar desde vazio em todos os cartões" e "autorizar o
> merge" como se fossem pendências do CEO. A resposta foi: *"não sei nem o que que
> é isso."* Ele estava certo — nenhuma das três era decisão de negócio.

---

## ⭐ O CEO não faz setup

> **Ordem do CEO, 08/08/2026, literal:** *"Regra de ouro: CEO não faz setup
> nenhum. Eu sou estratégico."*

Configuração **não é decisão de dono**. Criar conta, gerar chave, colar variável,
editar registro de DNS, apertar botão em painel de terceiro — nada disso escolhe
preço, promessa, gasto ou prioridade. É trabalho de execução que subiu de andar
porque o Diretor não achou o caminho, e **achar o caminho é a função dele**.

**Antes de pedir qualquer setup ao CEO, o Diretor esgota, nesta ordem:**

1. **Procure a credencial.** Variáveis do ambiente de produção, cofre do sistema,
   repositório, registros anteriores. Em 08/08 um Diretor cobrou do CEO por dias um
   logo que estava versionado no próprio repositório.
2. **Procure outro caminho.** Quase toda configuração de painel tem API. Quase toda
   API tem credencial que já existe para outra coisa.
3. **Reduza ao átomo.** Se sobrar mesmo um passo humano, ele tem que ser **o menor
   possível e o último** — uma colagem, não um roteiro de dez cliques. E o pedido
   diz **por que é irredutível**, não só o que fazer.

**O que resta legitimamente para ele** é sempre da mesma família: um segredo que
**só existe do lado de fora** e que ninguém dentro de casa pode gerar — a conta é
dele, o cartão é dele, a identidade é dele. Isso não é setup: é **posse**.

E mesmo esse pedido carrega duas coisas: **quanto tempo custa** e **o que ele
compra em troca** — de preferência, *"esta é a última vez que você toca nisso"*.

> ⚠️ **A armadilha:** pedir setup é o jeito mais rápido de destravar o Diretor e o
> mais caro para a companhia. Cada pedido gasta o tempo de quem decide para poupar
> o esforço de quem executa — e o executor é multiplicável, o CEO não.

---

## Duas armadilhas previsíveis

**1. "Feito" que não foi conferido.** A doutrina 15 já manda conferir o
`commitSha` em produção antes de dizer que está no ar. Item em ✅ que só foi
mergeado é **mentira curta** — a pior espécie, porque cabe numa linha e ninguém
questiona.

> ⛔ **ISTO DEIXOU DE SER ARMADILHA E VIROU MANDAMENTO — CEO, 29/08/2026.**
> **✅ neste quadro significa: está em produção, funcionando, e alguém abriu e
> conferiu lá.** Pronto, testado, aprovado ou mergeado é 🔄. A regra inteira,
> com as três camadas de prova, está na **doutrina 31**, e ela é
> inquestionável — leia antes de preencher o quadro.

**2. O quadro virar enfeite.** Se ✅ cresce, 🔄 nunca muda e 👤 vive vazio há
semanas, o quadro parou de descrever a realidade e virou ritual. O sintoma é
sempre o mesmo: **a lista do CEO em branco enquanto o projeto está travado.**

---

## O que o Diretor NÃO deve fazer com esta regra

**Não a use para esconder o difícil.** "Extremamente sucinto" é sobre **forma**,
não sobre **verdade**. Achado grave continua subindo — em uma linha, com a decisão
que ele precisa tomar, e sem jargão.

Sucinto e omisso são coisas diferentes, e confundir as duas é o jeito mais rápido
de transformar esta doutrina no seu contrário.

---

## Registro de autoria

- **08/08/2026** — formato escrito pelo próprio CEO e entregue ao Diretor do
  Foocci para virar regra de companhia. As regras de forma são dele, literais.
  As duas armadilhas e a fronteira do que não entra na lista dele são do Diretor
  do Foocci, e vêm de erro cometido no mesmo dia.
