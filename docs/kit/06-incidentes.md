<!-- ESPELHO-DO-KIT
origem: docs/06-incidentes.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: ee0adab49306b454e4e1a9ec0ba54bf118d71e0df6352814c991867c6468f364
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/06-incidentes.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 06 — Incidentes: as histórias que viraram regra

> Este arquivo existe para uma coisa só: **impedir que alguém remova uma regra
> por achar que ela é exagero.**
>
> Regra sem história parece arbitrária, e a primeira coisa que um engenheiro
> competente faz com uma regra arbitrária é simplificá-la. Cada regra abaixo
> custou um cliente real tendo uma experiência ruim. Leia a história antes de
> decidir que a regra é demais.

Se você é a sessão que está plantando o cérebro num projeto novo: leia isto
depois do `01-filosofia.md` e antes de escrever a primeira linha de código.

---

## 1. O rodízio — ausência de informação NÃO é informação

**O que aconteceu.** Um cliente perguntou no WhatsApp se o restaurante tinha
rodízio. A informação não estava na base de conhecimento. O agente respondeu:

> *"Não temos rodízio, infelizmente."*

O restaurante tinha rodízio.

**Por que é diferente de alucinação.** Ele não inventou um fato. Ele **inferiu
uma negação a partir de um silêncio** — e a resposta até *parece* responsável
("não vou inventar que temos"). Esse modo de falha passa despercebido justamente
porque parece prudência.

**A assimetria que a gente aprendeu:** afirmar o que não se sabe é ruim; **negar
o que não se sabe é pior**, porque soa autoritativo e o cliente vai embora sem
perguntar de novo. Ninguém reclama de uma negação — o cliente só some.

> **REGRA.** Negação de serviço/produto nunca passa direto. Sem fato explícito na
> verdade, a resposta é "preciso confirmar" + escalada, nunca "não temos".
> O crítico determinístico detecta padrão de negação e força `NEEDS_REVIEW`.

**Implementação:** regex de negação no crítico claim-vs-snapshot + caso de
regressão obrigatório no conjunto dourado. É o primeiro teste a escrever num
projeto novo.

---

## 2. "Não temos VOCES no cardápio" — conserte na raiz, não no rótulo

**O que aconteceu.** Cliente escreveu *"vocês têm pizza?"*. O agente respondeu:

> *"Não temos **voces** no cardápio."*

A busca de cardápio filtrava palavras sem significado, e o pronome no plural não
estava na lista. Ele virou termo de busca e, pior, virou o produto na frase. O
mesmo com *"vende açaí?"* → "Não encontrei **vende**" e *"vocês servem almoço?"*
→ "Não encontrei **voces**".

**Três lições:**

1. **Conserte na raiz.** A correção óbvia trata o texto exibido. A correção certa
   foi tirar as palavras-de-pergunta da busca inteira — isso arrumou o rótulo *e*
   parou de gerar negação falsa para mensagens que nem nomeavam produto.
2. **O rótulo lê a mensagem CRUA.** O texto normalizado tira acento; devolver
   "hamburguer" para quem escreveu "hambúrguer" faz a resposta parecer defeito.
3. **Ficou escondido por sorteio** — ver incidente 5.

> **REGRA.** Quando o sintoma é um texto errado na tela, pergunte de onde o dado
> veio. Consertar a apresentação esconde o defeito e ele reaparece em outro lugar.

---

## 3. A Nicole — o incidente mais importante do kit

Conversa real, cliente real, 20 minutos. Duas falhas empilhadas.

### 3a. O agente prometeu o que não podia cumprir

O caminho de conversa não tinha carrinho. Nenhuma capacidade de criar pedido.
Mesmo assim ele escreveu:

- *"Vou adicionar tare ao seu pedido"* — não adicionou em lugar nenhum
- *"Posso confirmar o seu pedido?"* — não havia pedido

A cliente respondeu **"Sim"** duas vezes. As duas caíram no vazio. Ela ainda
mandou endereço e forma de pagamento, que ninguém leu.

> **REGRA.** A capacidade que o agente NÃO tem precisa de **trava**, não de
> prompt. Verbo de transação ("adicionar", "confirmar o pedido") em agente que só
> conversa é violação barrada pelo crítico e listada em `forbiddenActions` —
> nunca só um pedido no system prompt.

### 3b. A queda apagava a conversa

O runtime tinha cinco portões de proteção. **Todo portão que reprovava delegava
ao caminho determinístico** — que, sem intenção que casasse, respondia com a
**mensagem de boas-vindas**.

No meio de um pedido, cinco vezes, a cliente recebeu *"Olá! Tudo bem? 😊 O que
você deseja?"*. Do ponto de vista dela, o robô teve amnésia cinco vezes.

A arquitetura estava certa — nunca deixar o modelo inventar. **O modo de falha é
que estava errado.**

> **REGRA.** Proteção que dispara não pode ser mais destrutiva que o problema que
> ela evita. A queda **preserva o contexto**: *"desculpa, não peguei essa — pode
> repetir?"* é queda. A tela de entrada não é queda: é apagar a memória na frente
> do cliente.

**Corolário que quase nos pegou de novo:** havia um plano de deixar a saudação
mais calorosa e variada. Se tivesse entrado antes do conserto da queda, a cliente
teria recebido cinco saudações *diferentes e lindas* no meio do pedido — o que é
**pior**, porque parece amnésia *mais* fingimento. **Conserte o modo de falha
antes de melhorar a mensagem que o modo de falha emite.**

---

## 4. O checador que reprovava o acerto

**O que aconteceu.** Um verificador marcava como CRÍTICO *qualquer* alternativa
oferecida quando o item pedido não existia no cardápio. Mas o comportamento
esperado daquele cenário era literalmente *"negar e oferecer alternativa real"*.

**O agente fazia a coisa certa e era reprovado por isso.** A rodada noturna
falhava todo dia por um acerto.

> **REGRA.** Verificador com régua curta demais pune a resposta certa — e isso é
> pior que não ter verificador, porque alarme falso recorrente treina a equipe a
> ignorar alarme.

**Como se protege:** ao escrever um verificador, **metade dos testes prova que o
legítimo passa**. Sem essa metade, o conserto vira carimbo e o verificador vira
enfeite.

---

## 5. Os testes verdes que não viram nada

**Um dia real:** 6 quality gates verdes com P0 = 0; simulador noturno 30 rodadas,
30 verdes; auditoria automática 30 de 30. E uma cliente real quebrou o sistema em
20 minutos (incidente 3).

**Por quê:** todos os testes eram **herméticos** — cada motor isolado, cenários
fixos e bem-comportados. Ninguém testava a **costura entre os motores** com
conversa real: bagunçada, com erro de digitação, mudança de ideia no meio,
mensagens fora de ordem.

> **REGRA.** Teste hermético prova que a lógica está certa. **Não prova que o
> sistema funciona.** São necessários os dois: hermético por peça (rápido, no CI)
> e **de costura**, com conversas reais inteiras atravessando todas as camadas.

**Corolário sobre amostragem.** Se a rodada noturna sorteia N cenários de um
conjunto, o espaço não amostrado é o ponto cego — foi por isso que o incidente 2
ficou semanas escondido. Quando o espaço é pequeno e fechado, **varra ele inteiro
no CI**, em milissegundos; deixe o sorteio para o que é grande demais para varrer.

---

## 6. O alerta que não dizia por quê

Durante semanas, o alerta noturno dizia:

```
p0Count=1 — encontrou um problema crítico
```

E nada mais. Nem o cenário, nem a frase do cliente, nem o que o agente respondeu.
Cada disparo custava uma investigação inteira: abrir o admin, caçar a rodada,
reconstruir o caso.

Depois que o alerta passou a carregar **o que o cliente pediu, o que o agente
respondeu e a violação exata**, o mesmo problema passou a ser diagnosticado em
minutos.

> **REGRA.** O alerta carrega a própria evidência. Vale para alerta, log, retorno
> de subagente e memória de agente (ver `07-memoria-de-agente.md`).

---

## 7. Dinheiro em ponto flutuante

`32.90 + 32.90 + 32.90` dá `98.69999999999999`.

Um verificador de preço que compara float **reprova um total correto**.

> **REGRA.** Converta para centavos inteiros na fronteira e compare inteiros.
> Tolerância de 1 centavo para arredondamento de exibição — um centavo é
> formatação, não mentira.

---

## 8. O gate que passaria por não existir

Não é um incidente — é o incidente que **não** aconteceu, porque o default estava
certo. Fica aqui como aviso, porque o caminho errado é o mais natural de escrever.

```ts
// ERRADO — transforma "esqueci de escrever o gate" em "liberado pra produção"
if (!runner) return { passed: true };

// CERTO — o esquecimento vira bloqueio, que é o lado seguro de errar
if (!runner) return { passed: false, p0Count: -1, reason: `Sem gate para "${agentId}".` };
```

> **REGRA.** Verificação não registrada = REPROVADO por construção. Nunca "passa
> por não existir". Vale para quality gate, para manual de domínio, para qualquer
> checagem plugável por registry.

---

## 9. O parecer que avisava não ser um parecer — e dois Diretores usaram assim

**08/08/2026 · Dioli Digital · custou um dia inteiro do CEO**

O CEO desenhou o material de marca entrando pelo Google Drive: a agência abre a
pasta do cliente e pega o que precisa. Ele criou o projeto no Google Console,
publicou o app, gerou chave e organizou as pastas — **a pedido do Diretor**.

Nada disso funcionava. O escopo `drive.file` do Google entrega **arquivo por
arquivo, escolhido na mão**; marcar uma pasta não libera o que está dentro. Ler
pasta exige escopo restrito, com auditoria de semanas a meses.

Nas palavras do próprio Diretor, e é o melhor diagnóstico deste arquivo:

> *"Comecei pela memória, não pela fonte. Assumi que escolher uma pasta liberaria
> o que está dentro dela — parece óbvio, e está errado. Só fui checar depois de
> você já ter criado projeto, publicado app, gerado chave e organizado pastas."*

**O agravante, e é o que vira regra.** Quando o parecer finalmente foi pedido, ele
voltou **escrito pelo `pm`, não pelo especialista `google`** — a ferramenta de
despacho estava indisponível. O documento trazia isso declarado, em destaque, no
cabeçalho: *"não substitui a revisão do `google`."*

**Dois Diretores leram esse aviso e usaram o documento como veredito assim
mesmo.** Um agiu por ele; o outro, auditando de fora, citou a recomendação ao CEO
como se fosse a do especialista. Quando o `google` de verdade olhou, **derrubou o
caminho, com fonte.**

### Por que é sutil

Rascunho honesto é mais perigoso que rascunho desonesto. Ele **parece** parecer:
tem estrutura, fontes, tabela, veredito. A ressalva de procedência é uma linha no
topo — e uma linha no topo perde para dez páginas com aparência de rigor.

E a pressa tinha causa legítima: o CEO estava travado, com fila de clientes. **A
urgência é exatamente o momento em que se pula a conferência da assinatura** — e
exatamente o momento em que o caminho errado custa mais caro.

> **REGRA 1.** Parecer de plataforma vem do **especialista daquela plataforma**.
> Quem for agir **confere a assinatura antes** — e citar um parecer ao CEO é agir.
>
> **REGRA 2.** Parecer com ressalva de procedência **não é parecer, é rascunho.**
> Não autoriza construir, não autoriza pedir nada ao CEO, e não se cita como
> fonte. Tratá-lo como veredito é o guardrail 2 ao contrário: a verificação que
> não aconteceu virando "aprovado".
>
> **REGRA 3.** A trava de plataforma serve **antes de pedir qualquer coisa ao
> CEO**, não depois de construir. Tempo do dono gasto num caminho impossível não
> volta.

### Como se protege

- O parecer carrega **assinatura de quem o produziu**, e quem consome verifica.
  Prompt é aviso; o mecanismo é parecer sem assinatura de especialista **não
  contar** como parecer no fluxo que o consome.
- Antes de pedir ação ao CEO que dependa de plataforma externa, o Diretor declara
  **qual parecer assinado sustenta o pedido**. Sem isso, não pede.
- **A casa não aposta em comportamento não documentado.** Ausência de fonte
  oficial dizendo "sim" é um **não**, não um "vamos tentar". É o guardrail 1
  aplicado a plataforma de terceiro.

---

## Como usar este arquivo

- **Ao plantar num projeto novo:** cada regra acima vira um teste antes de virar
  código. Comece pelos incidentes 1, 3 e 8 — são os que custam cliente.
- **Ao revisar uma simplificação:** se alguém propõe remover uma regra, ache o
  incidente correspondente. Se não existe, a regra pode mesmo ser exagero.
- **Ao aprender algo novo em um plantio:** escreva aqui, no mesmo formato
  (o que aconteceu → por que é sutil → REGRA → como se protege). É o juro
  composto do princípio 7 da filosofia.
