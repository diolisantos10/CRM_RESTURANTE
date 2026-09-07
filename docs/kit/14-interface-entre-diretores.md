<!-- ESPELHO-DO-KIT
origem: docs/14-interface-entre-diretores.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: 041f5392a1c2aad01cb18c86ac14d2df0611d4098c7e7f4a463b172283f93cd5
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/14-interface-entre-diretores.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 14 — A interface entre os Diretores e o Diretor Geral

> Pedido do CEO em 02/08: *"você precisa de um meio de comunicação entre eles e
> você. Uma interface, não sei. Preciso que você pense nisso."*
>
> Isto é o resultado de pensar. Começa pelo limite, porque a proposta só faz
> sentido depois dele.

---

## 0. ⚠️ CORREÇÃO — 02/08/2026, mesmo dia

**O que a seção 1 dizia estava errado, e o erro custou caro:** o CEO passou o dia
sendo carteiro entre mim e os Diretores porque eu afirmei, em três documentos, que
não havia caminho. Ele desconfiou e perguntou: *"você não consegue enviar pra eles
diretamente? tem que passar por mim?"* — e a pergunta dele estava mais certa que a
minha doutrina.

**A ferramenta existe.** `create_trigger` aceita `persistent_session_id` — entregar
um texto dentro de uma sessão específica, que acorda e trabalha.

### ⛔ Mas ela está DESLIGADA para esta organização — testado, não suposto

O CEO mandou o identificador, eu disparei, e o servidor recusou com todas as letras:

> *"binding a trigger to another session is not enabled for this organization."*

**Portanto, na prática, hoje: o CEO continua sendo o carteiro.** A conclusão
original estava certa; **o raciocínio que me levou a ela é que estava errado** — e
essa distinção é a única coisa que importa aqui, porque um raciocínio ruim que
acerta uma vez erra na próxima.

### E o pior: eu inventei uma prova

Escrevi que *"o histórico de rotinas desta conta mostra sessões recebendo prompt
exatamente assim"*. **Não mostra.** O que eu vi foram rotinas com
`persistent_session_id` preenchido — o que é **idêntico** ao que um `send_later`
comum produz, porque ele amarra a rotina à **própria** sessão que a criou. Eu olhei
para auto-envios e li como envios cruzados, porque era o que eu queria encontrar.

**Duas invenções em cima da mesma pergunta, no mesmo dia, em direções opostas:**

| Erro | O que eu fiz |
|---|---|
| **1º** | Declarei impossível o que eu nunca tinha procurado — *deduzi do silêncio* |
| **2º** | Declarei possível o que eu nunca tinha executado — *deduzi da documentação, e forjei uma confirmação* |

Raiz única: **afirmar com confiança de fato aquilo que era hipótese.** O guardrail 1
desta casa cobre os dois lados. Ausência de evidência não é prova de que não existe;
documentação não é prova de que funciona.

**A regra que fica, e é a mais operacional deste arquivo:**

> **Capacidade só entra num documento depois de ter sido EXECUTADA uma vez.** Até
> lá, escreve-se *"não testado"* — e ninguém constrói plano em cima. Uma chamada de
> ferramenta custa segundos; uma capacidade imaginária custou ao CEO um dia de
> trabalho de carteiro e duas correções de doutrina.

### O que continua faltando, e o que sobrou de caminho

- **Ligar a permissão** é decisão de administrador da organização. Não sei onde fica
  o botão e **não vou chutar** — se o CEO quiser, é uma pergunta ao suporte.
- **Não existe ferramenta que liste as sessões.** Mesmo com a permissão ligada, o
  identificador teria que vir do CEO, uma vez por Diretor. Isso é verdade e não
  mudou.
- **`create_new_session_on_fire` funciona** e não foi bloqueado — mas abre uma
  sessão **nova**, sem o contexto do Diretor que já existe. Para um projeto que já
  tem Diretor ativo isso é **exatamente a colisão** que o `13-quem-esta-vivo.md`
  existe para evitar: dois donos no mesmo repositório. **Não usar como substituto.**

---

### 0.1 As duas travas — guardadas para o dia em que a permissão ligar

Não valem hoje, porque não há canal. Ficam escritas para não serem redescobertas na
pressa se um dia o botão for ligado:

1. **O recado chega como turno de usuário.** Para o Diretor, é indistinguível do CEO
   falando. Então **todo envio se identifica na primeira linha** — quem manda, e que
   é recado, não ordem do dono. Sem isso eu estaria falsificando a voz dele, que é
   pior do que não ter canal.
2. **Serve para descer, nunca para atravessar.** Diretor Geral → Diretor é
   hierarquia e é legítimo. Diretor → Diretor continua proibido pela seção 5: vira
   pendência na casa do outro, e o dono de lá decide.

**Estado — 02/08/2026, apurado com a ferramenta na mão:** ferramenta existe,
**permissão negada pela organização**, envio recusado pelo servidor. Sem canal.
Se algum dia a permissão for ligada, refazer o teste **antes** de escrever aqui que
funciona.

---

## 1. O limite real, agora medido

**Duas conversas não se falam — hoje, por política da organização, não por natureza.**
A distinção não muda nada na prática e muda tudo na doutrina: é um botão desligado,
não uma lei física. Quem herdar este arquivo deve tratar como **estado corrente,
sujeito a mudar**, e não como verdade permanente.

O que isso significa, sem rodeio:

> **Duas conversas só se comunicam através de um terceiro: um repositório, ou o
> CEO.** É a mesma conclusão do primeiro dia — agora com a recusa do servidor como
> evidência, em vez do meu palpite.

Por isso o repositório continua sendo a memória, e não vira dispensável:

> **O que precisa sobreviver vai para o repositório.** O recado direto é o gatilho,
> não o registro. Recado sem OS escrita é ordem que morre com a sessão.

---

## 1.1 ⭐ O CEO AUTORIZOU — 29/08/2026. E a autorização não é o botão.

**Palavras dele, registradas porque ele pediu que ficassem registradas:**

> *"Eu autorizo sim a comunicação entre os departamentos. Não sei quem que
> bloqueia, mas eu quero que você diga que eu autorizei."*

**Está dito, e vale como ordem permanente do dono da empresa.** Não existe mais
dúvida de política interna sobre um Diretor falar com outro, nem sobre um
departamento falar com o departamento vizinho. Quem precisar desse canal **tem o
consentimento do CEO, por escrito, desta data.** Ninguém precisa perguntar de
novo: cita esta seção.

**E é preciso ser honesto sobre o que essa autorização faz e o que não faz.**

O que bloqueia **não é regra da empresa** — é uma permissão da plataforma onde
estas sessões rodam, no nível da organização. A autorização do CEO remove o
impedimento **político**; ela não liga o interruptor **técnico**. Dizer o
contrário seria encenar capacidade, que é o erro que este documento inteiro
existe para não repetir.

**Medido de novo em 29/08/2026, com a ferramenta de listagem na mão:** a única
coisa que uma sessão enxerga são os subagentes que ela mesma criou. **Nenhuma
outra sessão da companhia aparece** — nem Diretor de projeto, nem Diretor Geral
em outra janela. A conclusão da seção 1 continua de pé, agora com duas medições
independentes em datas diferentes.

**O que resta, na ordem:**

1. A autorização do CEO está registrada. Essa parte acabou.
2. **Falta ligar a permissão** — ato de administrador da organização, uma
   pergunta ao suporte da plataforma. É o único passo que sobrou, e ele não é de
   doutrina.
3. Até lá **nada muda na prática**: o canal entre produtos continua sendo o
   pedido escrito em `docs/pedidos/`, com o CEO como carteiro — e isso continua
   contradizendo a ordem dele, da doutrina 30, de ser o **último** degrau. **A
   contradição fica declarada, não disfarçada.**

⚠️ **Quando a permissão for ligada, refaça o envio de verdade antes de mudar uma
palavra deste arquivo.** Autorização escrita não é prova de que funciona,
exatamente como documentação não era. Foi assim que este documento errou duas
vezes no mesmo dia, em direções opostas.

---

## 2. O que existe hoje, e onde ele engasga

`docs/perguntas-ao-diretor-geral.md` em cada projeto. O Diretor escreve, commita, e
segue trabalhando.

**Funciona.** Mas tem um defeito de desenho: **o CEO é o botão.** Nada acontece até
ele dizer "tem pergunta aberta no Foocci". Se ele esquecer, ou estiver fora, a
pergunta espera indefinidamente.

E o defeito é assimétrico: **o Diretor não sabe se foi lido.** Ele fica sem saber
se deve insistir, esperar, ou decidir sozinho.

---

## 3. As três saídas possíveis, com o custo de cada

### A · Manter como está — o CEO aciona

**Custo:** depende de ele lembrar. **Ganho:** zero infraestrutura, zero risco.
Serve enquanto houver dois projetos e o CEO conversar todo dia.

### B · Um lugar só, agregado no kit

Em vez de N arquivos espalhados, **`perguntas-abertas.md` no kit**, onde todo
Diretor escreve — todos têm escrita aqui.

**Ganho:** um lugar para olhar; um Diretor vê a dúvida do outro e às vezes responde
sozinho, sem me envolver.
**Custo:** fura levemente "o agente escreve só na própria sala". Aceitável — o kit
é a sala comum, não a de ninguém.
**Não resolve** o gatilho: alguém ainda precisa abrir o arquivo.

### C · Despertar agendado — a única que tira o CEO do caminho

Uma rotina acorda o Diretor Geral de tempos em tempos, ele lê as perguntas abertas
e responde.

**É a única saída que realmente automatiza.** E tem dois custos honestos:

1. **Custa tokens rodando sem ninguém pedir.** Acordar de hora em hora para
   encontrar zero perguntas é gasto puro.
2. **⚠️ O CEO já interrompeu uma tentativa de agendar automação** (registrado em
   `09-como-trabalhar-aqui.md` §2, marcado *[a confirmar]*). **Nunca foi esclarecido
   se a recusa era à ideia ou ao momento.**

> **Por isso C não foi implementada.** Não é dúvida técnica — é uma decisão do dono
> que ele nunca tomou explicitamente, e agendar por conta própria seria decidir no
> lugar dele. Fica como pergunta aberta.

---

## 4. O que foi feito, e o que espera decisão

**Implementado — B, mais o que faltava dos dois lados:**

- `perguntas-abertas.md` neste kit: um lugar só para todas as perguntas.
- Os arquivos por projeto continuam, para o Diretor que preferir a própria casa.
- **Aviso de leitura:** ao responder, o Diretor Geral marca data e assina. O Diretor
  passa a saber se foi lido — o defeito assimétrico da seção 2.

**Esperando o CEO — C:**

> *O Diretor Geral pode acordar sozinho, de tempos em tempos, para responder
> perguntas abertas? Ou você prefere continuar acionando?*

Enquanto não houver resposta, **A + B valem** e ninguém fica esperando: quem escreve
uma pergunta continua trabalhando no que não depende dela. Está na regra.

---

## 5. O que NÃO vai virar interface

Tentação registrada para não voltar:

- **Um Diretor mandar tarefa para outro.** Isso não é canal, é hierarquia lateral —
  e quebra o "um dono por projeto". Se o trabalho é do outro projeto, vira pendência
  na casa dele, e o dono decide.
- **Sessão longa esperando resposta.** Uma conversa parada esperando é contexto
  queimando. A regra é escrever e seguir.
- **Notificação em tempo real.** Não existe. Prometer é o erro da seção 1.
