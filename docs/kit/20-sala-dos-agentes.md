<!-- ESPELHO-DO-KIT
origem: docs/20-sala-dos-agentes.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: e606bcfbe70a8d93a13302b1f051e5115cee59c0021480871067b4f3f204e18f
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/20-sala-dos-agentes.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 20 — A Sala dos Agentes

> **Status:** ADOTADO por ordem do CEO em 07/08/2026.
> **Escopo:** obrigatória em **todo projeto que tenha este kit instalado**.
> **Autor:** Diretor do Foocci. **Origem:** pedido direto do CEO.

---

## Por que isto existe (a história, antes da regra)

Em 07/08/2026 o CEO pediu, com urgência:

> *"Criar a agent room no brain… uma sala onde todos os agentes do projeto
> estarão lá… quem é o agente, a função dele, quando ele foi implantado… eu
> queria medir o quanto ele já trabalhou nesse projeto. E um botão de criar um
> agente. Ela é no menu do admin de cada projeto."*

E, ao aprovar o desenho, disse **por que** queria:

> *"Eu quero saber quais os agentes cada projeto tem, quem está sendo usado,
> quem não está usando."*

Essa é a pergunta que a sala responde, e ela **não tinha resposta** em nenhum
projeto. O Foocci tinha uma tela de agentes no admin — em formato de abas, uma
por agente — que dizia *o que cada agente é* e não dizia **se ele trabalha**.
Nos outros projetos não havia nem isso.

O custo de não ter: um agente pode estar desligado, quebrado ou nunca ter sido
chamado, e nada na casa denuncia. Ele continua na lista, continua parecendo
parte do time, e o Diretor continua achando que despachou trabalho para alguém
que não existe mais.

---

## A regra

**Todo projeto com o kit instalado tem uma Sala dos Agentes no menu do admin.**

Não dentro de Configurações. Não dentro de uma tela de outro assunto. **Item
próprio no menu**, porque a pergunta "quem trabalha aqui?" é de primeira ordem.

**A estrutura é a mesma em todos os projetos** — ordem do CEO, 07/08:

> *"A estrutura, a interface é a mesma em todos os projetos. Se mudar a
> identidade visual, tudo bem, não tem problema mudar as cores, mas a interface
> é a mesma."*

Muda: a cor, a lista de agentes, o que o projeto faz.
**Não muda:** as duas abas, o cartão, e a regra de medida honesta abaixo.

---

## As duas abas — e por que são duas

| Aba | O que responde |
|---|---|
| **Agentes** | Quem trabalha neste projeto, o que faz, desde quando, e quanto trabalhou |
| **Configurações** | Quais IAs estão contratadas, quem usa cada uma e quanto custam |

**Elas são separadas por ordem do CEO**, e a ordem tem razão de ser: são duas
perguntas de dono diferentes. "Quem está no time" é gestão de elenco. "Quanto a
OpenAI me custou" é conta a pagar. Numa tela só, a segunda vira rodapé da
primeira e ninguém olha.

### Aba 1 — Agentes

Um **cartão por agente**, em grade. Cada cartão carrega, nesta ordem:

1. **Estado** — um ponto: trabalhando / atenção / desligado
2. **Nome** e **slug** (o slug em fonte mono; é ele que aparece no código)
3. **Área** — uma etiqueta
4. **Função** — uma frase, em linguagem de dono, não de engenheiro
5. **No ar desde** — a data
6. **Quanto trabalhou** — ver "A medida honesta" abaixo

No topo: contadores de resumo e um botão **+ Novo agente**.

### Aba 2 — Configurações

Um **cartão por IA contratada**: se está ligada, para que serve, **quanto custou
nos últimos 30 dias** e **quem usa**.

---

## ⭐ A medida honesta — a regra que faz a sala valer alguma coisa

**O cartão nunca escreve zero quando a resposta é "não sei".**

"Não medido" e "trabalhou zero" são coisas diferentes. Um painel que confunde as
duas ensina o dono a não confiar nele — e a partir daí a tela existe e não serve.
Isto é o guardrail 1 da companhia (ausência de informação não é informação)
aplicado a pixel.

Três estados, sempre distinguíveis na tela:

| Estado | O que significa | Como aparece |
|---|---|---|
| **Número** | o banco prova | o valor, tabular |
| **Não medido** | não existe instrumentação | itálico, cor secundária |
| **—** | existe instrumentação e o valor é zero | traço |

Isto não é preciosismo. No Foocci, três telas diferentes mentiram por confundir
esses estados: o "Total hoje" que somava errado, o filtro da Central que
peneirava 100 conversas no navegador e devolvia vazio, e o painel de Integrações
que escrevia "Conectado" com o token já morto. Nenhuma delas era feia.

### As duas populações de agente — e por que não se medem igual

Todo projeto tem duas, e confundi-las produz número sem sentido:

| População | Quem são | A medida certa |
|---|---|---|
| **Falam com o cliente** | rodam em produção, consomem IA paga | **dinheiro e tokens** — é a conta que chega |
| **Constroem o produto** | os especialistas do kit, em `.claude/agents/` | **bloco entregue e registrado** na oficina |

Token mede quanto o agente **falou**, não quanto ele **entregou**. Para quem
constrói, a medida já existe hoje em `docs/agents/<slug>/oficina.md` e não
precisa de instrumentação nenhuma: conta-se a entrada assinada.

### O que a maioria dos projetos vai descobrir ao construir esta tela

Que **não dá para dizer quanto cada agente gastou** — porque o registro de
interação com IA guarda tokens e custo **por conversa**, e não guarda qual agente
gastou. É o caso do Foocci, medido em 07/08/2026.

O conserto é um campo (`agentSlug` no registro de interação) e ele **só vale para
frente**: da data em que entrar, o número existe; o que passou não volta. Por isso
esta é uma decisão do primeiro dia, não do dia em que a tela ficar pronta.

**Regra derivada:** ao instalar este kit num projeto novo, o registro de
interação com IA nasce com o slug do agente. Instrumentar depois custa o
histórico inteiro.

### E a armadilha do dinheiro

Antes de escrever um valor em reais ou dólares na aba Configurações, **confira a
tabela de preços do projeto**. No Foocci ela conhecia dois modelos da OpenAI e
mais nenhum, com **fallback silencioso para o preço do gpt-4o** — ou seja, toda
chamada de outro provedor era relatada ao preço da OpenAI.

Modelo desconhecido **não pode** cair num preço padrão. Ele fica explicitamente
**não precificado**, e a tela mostra isso. Preço com fallback é a mesma família
de defeito do "aprovado por esquecimento" (guardrail 2): o silêncio vira um
número, e ninguém sabe que ele é chute.

---

## O que NÃO fazer

- **Não pendurar a sala dentro de Configurações.** Ordem explícita do CEO.
- **Não inventar métrica bonita.** Se a única coisa provável é a data de criação,
  o cartão mostra a data de criação e diz "não medido" no resto. Sala com número
  inventado é pior que sala nenhuma.
- **Não misturar as duas populações na mesma grade sem rótulo.** Somar "custo" de
  quem não gasta com "blocos" de quem não fala com cliente produz um total que
  não significa nada.
- **Não criar a sala e parar de olhar.** A pergunta do CEO é recorrente: *quem
  está sendo usado, quem não está*. Um agente que aparece na sala há dois meses
  sem uma linha de trabalho é candidato a ser aposentado — e isso é conversa com
  o CEO, não decisão do Diretor.

---

## Quem já adotou

> Levantar antes de escrever. Linha em branco é "não sei", e não "não fez".

| Projeto | Diretor | Aba Agentes | Aba Configurações | Custo por agente | Observação |
|---|---|---|---|---|---|
| **Foocci** (restaurante) | Diretor do Foocci | em construção (07/08) | em construção (07/08) | instrumentação em construção | autor deste documento |
| **Dioli Digital** | Diretor da Dioli Digital | — | — | — | |
| **Foocci Manager** | Diretor do Foocci Manager | — | — | — | adormecido |
| **CityJobs** | Diretor do CityJobs | — | — | — | sessão pausada por ordem do CEO em 03/08 |
| **Dioli Political** | Diretor da Dioli Political | — | — | — | |

---

## Registro de autoria

- **07/08/2026** — criado pelo Diretor do Foocci, a pedido direto do CEO, a
  partir da maquete aprovada por ele na mesma sessão. As decisões de estrutura
  (duas abas separadas, item próprio no menu, mesma interface em todo projeto)
  são do CEO. A regra da medida honesta é proposta do Diretor do Foocci, nascida
  de três telas que mentiram naquela semana.
