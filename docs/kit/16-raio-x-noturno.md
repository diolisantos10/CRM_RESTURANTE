<!-- ESPELHO-DO-KIT
origem: docs/16-raio-x-noturno.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: f9b8e802462c8f4216d8a4e5313b6ea921198da44aaf78ef8f868f005c56f435
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/16-raio-x-noturno.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 16 — O raio-x noturno: obrigatório em todo projeto

> Criado em 05/08/2026 **a pedido direto do CEO**, no dia seguinte ao primeiro
> raio-x da companhia. Não é sugestão de processo: é **protocolo obrigatório**,
> todo projeto, toda madrugada.

---

## Por que isto existe (a história, antes da regra)

Na madrugada de 04→05/08 o CEO pediu ao Diretor do Dioli Digital um raio-x do
sistema. Não havia incidente, ninguém tinha reclamado, nada estava vermelho. O
raio-x devolveu, entre outras coisas:

- Um post com imagem quebrada gerando **até 1.728 imagens pagas por dia, para
  sempre**.
- Uma rota de geração de imagem **aberta na internet, sem login**, com a chave
  paga da casa atrás — milhares de dólares por dia ao alcance de qualquer um.
- Uma rota que gerava o link de acesso do portal de **qualquer cliente do banco**.
- Um relatório afirmando "qualidade verificada" com as verificações escritas como
  `true` fixo no código.
- Um beco sem saída na aprovação: o clique gravava um estado que o relógio de
  publicação **nunca lia**. O cliente aprovava o mês inteiro e nada publicava —
  sem erro, sem aviso. Ia estourar na manhã seguinte.

Nenhum desses era novo. **Todos estavam lá há tempos, e ninguém tinha
perguntado.** É essa a frase que justifica o documento: sistema em produção
acumula problema silencioso, e problema silencioso não se anuncia — ele espera.

> **A cicatriz, em uma linha:** o dia em que o CEO ia aprovar seis peças e
> nenhuma publicaria, e o sistema não tinha como avisar.

---

## As três ferramentas são diferentes — confundi-las custa caro

Descoberta do mesmo dia, e **a mais importante deste documento** depois dos
padrões: no Dioli Digital, o raio-x e a auditoria adversarial rodaram na mesma
noite e **acharam listas que não se sobrepuseram**.

| Ferramenta | O que ela olha | O que pescou naquele dia |
|---|---|---|
| **Auditoria adversarial** | o que **acabou de mudar** — e tenta quebrar | relatório com crescimento inventado, estilo que a IA jurava ter observado, peça reprovada virando aprovada ao ser refeita |
| **Raio-x** | o que **já estava lá** e ninguém questiona mais | a rota aberta na internet, a chave-mestra do portal, o beco sem saída, as 1.728 imagens |
| **O especialista esbarrando** | o que aparece **enquanto se conserta outra coisa** | a ordenação que embaralhava telas entre carrosséis |

**Consequência prática:** ter portão de qualidade, CI e auditoria de PR **não
dispensa** o raio-x. Eles cobrem o diff; o raio-x cobre o resto do sistema, que é
onde mora a maior parte do código e a totalidade das suposições antigas.

A terceira fonte não se agenda — mas **se registra**. Especialista que esbarrar
num achado fora do seu escopo anota e devolve ao Diretor, sem propagar a correção
para dentro de uma frente que não é a dele.

---

## ⭐ A regra que faz o raio-x funcionar: PADRÃO NOMEADO

Palavras do Diretor que rodou o primeiro:

> *"Eu não pedi 'veja o que dá para melhorar'. Pedi para procurar **padrões
> nomeados** — trabalho que existe e ninguém vê, id aceito sem conferir de quem
> é, promessa que o código não cumpre, estado morto. **Pedido genérico volta com
> opinião de estilo; pedido com padrão volta com a rota aberta na internet.**"*

Este é o pulo do gato, e é o que separa um raio-x útil de uma lista de
preferências. **Quem despacha um raio-x sem a lista de padrões vai receber
sugestão de refatoração.**

### Os padrões, com o que cada um pescou de verdade

| # | Padrão | Como procurar | O que pescou |
|---|---|---|---|
| 1 | **Trabalho que existe e ninguém vê** | processo que roda sozinho e nunca falha em voz alta; laço sem teto; retentativa sem limite — principalmente onde cada volta **custa dinheiro** | 1.728 imagens pagas/dia, para sempre |
| 2 | **Id aceito sem conferir de quem é** | rota que recebe id de cliente/inquilino/assinatura e **não prova** que quem chamou é dono daquele id | link de acesso ao portal de qualquer cliente |
| 3 | **Promessa que o código não cumpre** | selo, badge, relatório ou tela que afirme "verificado / aprovado / ok" cujo valor **não vem de uma verificação que rodou** | "qualidade verificada" com `true` fixo |
| 4 | **Estado morto** | campo que uma tela **escreve** e nenhum leitor consome (o `grep` do campo mostra só escrita) | aprovação que não publicava nada |
| 5 | **Porta aberta para a internet** | rota pública que encoste em motor pago, em dado de outro inquilino, ou em qualquer coisa que gaste por chamada | geração de imagem sem login |

**A lista é viva.** Todo achado que se repetir em um segundo projeto vira padrão
novo aqui — é assim que ela cresce. Padrão que só apareceu uma vez fica no caso
do projeto (`casos/<projeto>.md`), não nesta tabela.

---

## O desenho: duas metades, e separá-las é o ponto

### 1. A coleta — determinística, em código, sem IA

Varre e produz **evidência**: o número, o caso concreto, o identificador.

**Por que sem IA:** raio-x que depende de IA para coletar **erra diferente toda
noite** — e aí *"piorou desde ontem"* deixa de significar alguma coisa.

**A comparação com ontem é metade do valor.** "37 mensagens presas" não diz nada;
"37, contra 4 ontem" diz tudo. Toda execução é persistida com data, ou o raio-x
vira paisagem.

### 2. A leitura — uma sessão do Diretor

Lê a coleta e escreve o relatório de negócio. Conclusão primeiro, linguagem de
CEO, cada item com sua evidência. **É aqui, e só aqui, que entra julgamento.**

---

## As três regras sem as quais o raio-x morre em duas semanas

1. **Todo achado carrega a própria evidência** (guardrail 6). Achado sem o caso
   concreto é ruído — e ruído ensina o CEO a não ler o relatório. Um raio-x que
   ninguém lê já morreu, só não sabe.
2. **Varredura que não rodou devolve "não sei", nunca "está tudo bem"**
   (guardrail 1). O relatório mostra explicitamente o que ficou cego. Silêncio de
   varredura quebrada é indistinguível de silêncio de sistema saudável — e essa é
   a confusão que o guardrail 1 existe para impedir.
3. **Cada varredura nasce com as duas metades de teste**: a que prova que ela
   acha o problema quando ele existe, e a que prova que ela **não inventa**
   problema quando ele não existe. Varredura só vista achando coisa é
   indistinguível de varredura que alarma sempre.

---

## Como o Diretor executa

1. **Toda madrugada**, sem depender de alguém lembrar. Um agendamento no projeto,
   não um hábito do Diretor. Hábito falha na semana em que o Diretor está ocupado
   — que é justamente a semana em que o raio-x mais faria falta.
2. O raio-x é **somente leitura**. Nunca envia mensagem, nunca cria pedido, nunca
   toca em pagamento. Se essa garantia não tiver teste, ela não existe
   (guardrail 4: prompt é aviso, código é trava).
3. **De manhã, o relatório sobe ao CEO** em linguagem de negócio: o que piorou, o
   que está desperdiçando, o que dá para melhorar — cada item com evidência.
4. **Achado que exige conserto vira pendência com dono.** Raio-x que só produz
   lista é diagnóstico sem tratamento.
5. **O que atravessa projetos sobe.** Achado que aparece em dois produtos vira
   item do backlog do Diretor Geral (`docs/11-backlog-do-diretor-geral.md`) e
   candidato a padrão novo na tabela acima. Sem essa regra, o achado que mais
   interessa — o que se repete — é justamente o que não tem casa.

---

## O que NÃO fazer

- ❌ Pedir "veja o que dá para melhorar". Volta opinião de estilo. **Peça os
  padrões pelo nome.**
- ❌ Deixar a IA fazer a coleta. Perde-se a comparação com ontem, que é metade do
  valor.
- ❌ Achar que auditoria de PR ou CI substitui o raio-x. Eles olham o diff; o
  raio-x olha o que ninguém olha há meses.
- ❌ Relatório sem evidência. Em duas semanas ninguém lê.
- ❌ Raio-x que escreve. Ele diagnostica; o conserto é uma frente, com dono e
  verificação.

---

## Quem já adotou — e por que esta tabela existe

O kit **não se propaga sozinho**. Escrever doutrina aqui não instala nada em
projeto nenhum: cada sessão precisa puxar o kit e aplicar. Sem esta tabela,
"está em todos os projetos" é esperança, não fato — e guardrail 2 vale também
para adoção: **o que não foi registrado, não aconteceu**.

**Como sua linha é preenchida, já que você não escreve aqui:** desde 05/08 o kit
tem um autor só (ver "Registro de autoria" no fim). Então o Diretor **avisa o CEO
quando o raio-x dele rodar de verdade uma vez** — não quando ler este documento —
e o autor do kit atualiza a linha.

Não é burocracia: é o mesmo motivo pelo qual o agente propõe na oficina e o
Diretor promove na vitrine (`07-memoria-de-agente.md`). Quem executa não é quem
carimba que executou. E o carimbo aqui vale alguma coisa — é ele que separa
"todos os projetos têm raio-x" de "todos os projetos receberam um documento".

| Projeto | Diretor | Coleta rodando | Primeiro relatório ao CEO | Observação |
|---|---|---|---|---|
| **Foocci** (restaurante) | Diretor do Foocci | em construção (05/08) | — | autor deste documento |
| **Dioli Digital** | Diretor da Dioli Digital | raio-x rodado 04→05/08 **manualmente** | 05/08 | falta a coleta determinística e a comparação com ontem |
| **Foocci Manager** | Diretor do Foocci Manager | — | — | |
| **CityJobs** | Diretor do CityJobs | — | — | sessão pausada por ordem do CEO em 03/08 |
| **Dioli Political** | Diretor da Dioli Political | — | — | |

> ⚠️ **O caso da Dioli Digital é o mais instrutivo da tabela.** O raio-x dele
> achou cinco coisas graves — e mesmo assim a linha está incompleta, porque foi
> um raio-x **pedido à mão**. Sem coleta automática e sem persistência, não há
> "toda madrugada" nem comparação com ontem. Um raio-x que depende de alguém
> lembrar falha exatamente na semana em que o Diretor está ocupado, que é a
> semana em que ele mais faria falta.

**Cada Diretor faz no PRÓPRIO projeto.** Não é um Diretor aplicando nos outros —
e isso não é preciosismo de organograma, são três razões práticas:

1. **O valor está na tradução dos padrões, não no ritual.** "Id aceito sem
   conferir de quem é" é `restaurantId` num produto e outra coisa no seguinte.
   Quem não conhece o código traduz errado e volta com sugestão de refatoração.
2. **Dois Diretores no mesmo repositório já custou um incidente** (02/08 — é a
   razão de `presenca.md` existir).
3. **Diagnóstico sem dono vira lista.** Quem acha precisa ser quem conserta,
   senão o achado envelhece num documento e ninguém responde por ele.

---

## O que o raio-x entrega

Duas coisas, sempre, e nesta ordem:

1. **A coleta** — determinística, em código, versionada (é o que este documento
   trata).
2. **O placar** — a tabela de 0 a 100 por área, no endereço fixo
   `docs/raio-x/placar.md`. É obrigatório e tem documento próprio:
   **`17-placar-diario.md`**.

O relatório em prosa continua existindo, mas quem o CEO abre primeiro é o
placar. Raio-x que roda e não deixa placar está incompleto.

---

## Registro de autoria

Escrito pelo **Diretor do Foocci**, a quem o CEO atribuiu, em 05/08/2026, a
direção e a autoria do BrainKit. O CEO informou na mesma conversa que os demais
Diretores foram orientados a **não escrever neste kit**, para que ele tenha uma
mão só — a contradição entre dois autores no mesmo documento é exatamente o que a
doutrina do corredor (`08-modelo-ceo-pm-agentes.md`) existe para evitar.

Origem material do documento: o primeiro raio-x da companhia, rodado pelo Diretor
do Dioli Digital na madrugada de 04→05/08/2026, e o depoimento dele sobre o que
fez aquele raio-x funcionar.
