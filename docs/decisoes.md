# O corredor — decisões que atravessam domínios

> Decisão que afeta mais de um especialista não mora na sala de nenhum deles.
> Mora aqui. **Só o Diretor escreve neste arquivo.**
>
> Sem o corredor, uma decisão que toca três domínios vira três versões dela — cada
> uma na vitrine do seu dono, todas se achando certas, e em um mês elas se
> contradizem.
>
> Formato: o que ficou decidido, por quê, quem decidiu, quando, e o que muda.

---

## 2026-09-08 — Antes de gastar contato, a rodada confere o modelo na Meta

**Decisão do Diretor**, com autorização do Diretor Geral (é conserto e
prevenção, não escolha de negócio).

A prospecção manda **um** parâmetro na mensagem: a saudação. Se o modelo aprovado
na Meta esperar dois, **100% dos envios são recusados** — e a rodada só
descobriria isso queimando três nomes da lista até bater o freio do #216.

**Fica decidido:** a rodada faz um **pré-voo** — uma consulta à Graph, antes do
primeiro contato — e a regra de reação é um princípio, não uma lista:

> **Aborta quando 100% dos envios falhariam. Segue quando a perda é parcial ou
> desconhecida.**

Aborta em: modelo sem nome configurado, sem token, inexistente na conta, não
aprovado, ou esperando 2+ variáveis. **Segue** quando a Graph não respondeu — não
saber não é o mesmo que estar errado, e aterrar o dia por uma *leitura* que caiu
seria a proteção mais destrutiva que o problema (guardrail 5). O freio de três
recusas seguidas continua por baixo.

**O pré-voo é parâmetro obrigatório no tipo**, e isso é a trava: chamador novo
não compila sem dizer qual é o pré-voo dele. É a doença crônica da casa — *peça
pronta, ninguém chamando* — virando erro de compilação.

**Atravessa três domínios:** `meta` (a credencial e o modelo aprovado), `canais`
(a mensagem que sai) e `crm`/Sala de Vendas (a lista que se gasta).

**Provou o próprio valor no primeiro uso:** na estreia, foi o pré-voo que trouxe
a frase da Meta dizendo que o token estava vencido havia catorze dias. Sem ele, a
rodada teria dito "fila acabou".

---

## 2026-09-08 — Vigia de credencial que olha para o lado errado não é vigia

**Decisão do Diretor** (conserto de defeito).

A varredura diária de credenciais lê `metaWhatsAppConfig` — a tabela dos
**restaurantes**. O número da Foocci mora no ambiente
(`FOOCCI_SALES_ACCESS_TOKEN`), não em tabela. Ela perguntava à Meta sobre todos
os tokens **menos o único de que a operação comercial depende**, e ficou verde
durante os catorze dias em que a Sala esteve morta.

**Fica decidido:** toda credencial que a empresa usa para falar com alguém entra
na **mesma** varredura diária — não num job novo que alguém esqueceria de
agendar. A da Sala entra em campo próprio (`salaDeVendas`), porque ela não é
restaurante e enfiá-la em `results` faria `totalConfigs` mentir.

**E o alerta diz o que a falha CAUSA, não só que ela existe:** *"a prospecção NÃO
envia nada, e a rodada termina verde com zero abordados"*. Guardrail 6.

**A regra geral, para a próxima vez:** quando um vigia existir e mesmo assim algo
morrer calado, a primeira pergunta é **para onde ele olha** — não se ele roda.
Vigia verde é evidência de que ele rodou, nunca de que ele viu.

---

## 2026-08-29 — O CRM não fala por cima de um pedido em andamento

**Decisão do Diretor** (conserto de defeito visto pelo CEO em cliente real —
não era escolha de negócio). Detalhe em `docs/campanha-nao-atropela-pedido.md`.

Um cliente confirmou R$ 74,00 às 18:51 e às 18:52 recebeu campanha de captação
com 10% de desconto; às 18:57 perguntou sobre o pedido e ficou sem resposta.

**Fica decidido:** cliente com **pedido em voo** (CONFIRMED / PREPARING / READY /
OUT_FOR_DELIVERY) não recebe mensagem de CRM nenhuma, e cliente que pediu nas
últimas **6 horas** não recebe abordagem. A regra mora num módulo só
(`src/services/crm/activeOrderGuard.ts`) e é aplicada em três portas: público
(`resolveAudience`), envio (`ContactSafetyService`) e conversa
(`markConversationCrmContext`).

**Atravessa três domínios**, e é por isso que está aqui: `crm` (público e
campanha), `operacao` (o que conta como pedido vivo) e `canais`/`garcom` (a
conversa que ficou muda quando o carimbo de campanha entrou nela).

**O bloqueio por pedido em voo é incondicional** — aniversário e override de teto
semanal não o furam. **A janela de 6h vale só para abordagem**: recuperação de
carrinho é resposta a um ato do cliente e segue isenta dela (guardrail 5), mas não
do pedido em voo.

**O que este bloco NÃO resolveu, de propósito:** `ORDER_SUPPORT` continua sendo um
`contextType` que ninguém escreve. A trava nova parou de depender dele — passou a
olhar o fato (tem pedido?) em vez do rótulo —, mas o crachá "Pós-venda" da Central
de Conversas segue sem acender nunca.

## 2026-08-23 — A porta do administrador para o teto de contatos

**Decisão do CEO:** *"pode criar a porta"*, com o motivo dito por ele — *"eu não
faço nada manual"*. Ele não opera o produto por tela.

Existe agora `PATCH /api/admin/crm/contact-budget`, autenticada pelo segredo de
administrador, que ajusta **um** número: o teto de contatos do CRM
(`contactBudgetTotal`) de **um** restaurante nomeado.

**Por que uma rota nova e não estender `PATCH /api/admin/restaurants/[id]`** — foi
a alternativa considerada, e mais estreita à primeira vista, porque não criaria
superfície nova. Descartada: aquela rota escreve `plan` e `isActive`, ou seja,
cobrança e o restaurante estar no ar. Enfiar um campo de CRM ali coloca uma
mudança de configuração no mesmo lugar onde um erro derruba a loja de um cliente
ou troca o plano dele. Superfície nova e estreita custa menos que risco em cima de
superfície crítica.

**As quatro travas que definem a porta:**

1. **Lista branca de um campo só.** Campo de fora é **recusado com erro que o
   nomeia**, nunca ignorado. Ignorar em silêncio devolveria 200 para quem tentou
   desligar o horário de silêncio — e a pessoa iria embora achando que conseguiu.
   E a recusa é da requisição INTEIRA: ninguém leva metade do que pediu sem saber
   qual metade.
2. **Regras anti-banimento não passam.** Limite diário, intervalo por cliente,
   horário de silêncio, delay, fim de semana. Elas protegem o número de WhatsApp
   do lojista e são recalculadas no servidor a cada envio. Mudá-las é decisão do
   dono, não extensão desta porta.
3. **Restaurante sempre explícito.** Sem `restaurantId` ou `slug` válido, recusa.
   Porta administrativa que escolhe sozinha em quem mexer é porta que um dia mexe
   em todos.
4. **Escrita cirúrgica.** A gravação é um merge que troca UMA chave do JSON
   guardado — não normaliza, não preenche padrão, não reescreve o resto. Há teste
   provando que até uma chave que este código não conhece sobrevive intacta. É a
   diferença entre *"mexi no teto"* e *"salvei a configuração inteira e por acaso
   o resto continuou igual"*.

**A régua mora num lugar só.** `@/lib/crm-contact-budget` é módulo puro (sem
Prisma, de propósito) usado pela rota **e** pela tela do lojista. Antes eram
números soltos nos dois lados; regra repetida é regra que um dia diverge — foi
o defeito-raiz desta rodada inteira.

**Trilha obrigatória.** Toda alteração e toda recusa geram `auditLog` com
restaurante, campo, valor antes e depois. Mudança de dinheiro sem rastro é
mudança que ninguém consegue explicar depois.

---

## 2026-08-23 — Resposta não é abordagem: a recuperação de carrinho não tem horário de silêncio

**Correção do CEO, no mesmo dia, sobre erro meu.** Palavras dele:

> *"O carrinho abandonado tem que ser executado dois minutos depois que o cliente
> fecha. Por que você está preocupado com a madrugada?"*

Horas antes, eu havia trazido a recuperação de carrinho para o portão do CRM com
**as regras de abordagem ligadas** — janela de silêncio 21h–8h, intervalo de 24 h,
teto semanal. O opt-out estava certo; o resto era régua errada no lugar errado.

**A distinção que faltava, e que agora é doutrina desta casa:**

| | Campanha | Recuperação de carrinho |
|---|---|---|
| O que é | **Abordagem** — a casa decide falar | **Resposta** a um ato do cliente |
| Quando | Quando a casa quiser | 2 min depois de ELE mexer no carrinho |
| Validade | Volta amanhã | 30 min, e morre — não há fila |
| Trava de horário certa | Janela de silêncio (21h–8h) | **Loja aberta no instante do abandono** |

Silenciar das 21h às 8h **mata a função na hora em que ela serve**: casa de sushi
vende à noite, carrinho é abandonado à noite, e quem abandonou há dois minutos não
está dormindo — estava no site agora.

**O que saiu:** janela de silêncio, intervalo de 24 h e teto semanal.
**O que ficou, e não se discute:** **opt-out** e não-contactável — quem pediu para
não receber mais nada não recebe, nem campanha nem recuperação. Esse era o defeito
real. Ficaram também telefone válido, canal de pé e o teto de contatos (é gasto).

**O intervalo de 24 h era, na parte que protegia, duplicata.** A regra 5 do próprio
fluxo — *uma recuperação por cliente a cada 24 h*, lida do `lastRecoveryAt` do
rascunho e global entre restaurantes — já limitava repetição, e com mais precisão. O
que o intervalo do CRM acrescentava era só deixar **uma campanha da manhã matar a
recuperação da noite**: perda de venda sem proteger ninguém.

**Regra geral que fica:** antes de aplicar uma trava de frequência ou de horário,
pergunte **quem começou a conversa**. Se foi o cliente, a régua de abordagem não se
aplica — e a trava certa é a que responde *"a loja pode atender isso agora?"*.

**Como isso não volta:** o `ContactSafetyService` ganhou `enforceFrequency`, um
interruptor explícito e obrigatório, e a regra 11 da recuperação carrega um bilhete
longo dizendo **por que** o silêncio não vale ali. Sem o bilhete, alguém "unifica" de
novo em três meses achando que corrige uma inconsistência.

---

## 2026-08-23 — "Pode tudo, teto 3000" — e os dois cadeados se separam

**Decisão do CEO**, nas palavras dele: *"pode tudo, teto 3000"*.

**1. O teto de contatos do Sushi Cazza é 3000.** Não é chute: a base já tem 2115
pessoas abordadas, então 3000 deixa **885 vagas** para crescer e continua acusando
se algo começar a disparar sozinho. **Não é "sem limite"** — o alarme continua
existindo, que é o ponto inteiro desta rodada.

> ⚠️ O **padrão de produto** para restaurante NOVO continua **0 (sem teto)** e
> **não foi mexido** — a decisão foi sobre o Sushi Cazza. Está travado em teste
> (`CrmSafetyConfig.test.ts`) para não mudar por descuido.

**2. Os dois cadeados se separam.** O teto de contatos é limite de **gasto**; o
"Assumir controle manual" existe para as regras **anti-banimento** (limite diário,
intervalo por cliente, horário de silêncio, delay). Estavam na mesma chave: para
mexer num risco de dinheiro, o lojista era obrigado a destravar um risco de perder
o WhatsApp — e saía com os dois soltos.

O teto sai de trás do controle manual. **As regras anti-banimento continuam
trancadas exatamente como estão** — aquele cadeado é trava de servidor
(`applyEffectiveSafety` recalcula os valores seguros na hora de enviar,
independentemente do que estiver gravado) e não se mexe.

**O servidor já estava certo:** `applyEffectiveSafety` nunca tocou no teto de
contatos e a rota PATCH sempre o aceitou. Quem divergia era a **tela**, que
desabilitava o campo. Fica a lição, que é a mesma da rodada inteira: **tela que
diz uma coisa e código que faz outra é defeito dos dois, e o que se corrige é o
que está mentindo** — aqui, a tela.

---

## 2026-08-23 — Limite que a tela anuncia é limite que o código trava

**Decisão do Diretor** (guardrail 4 aplicado, não escolha de negócio).

A tela de Regras de Segurança dizia *"Limite de contatos atingido"* e *"Travado no
modo seguro"* enquanto o código de envio **não olhava o número**: teto de 200, 2115
pessoas abordadas. A trava tinha existido, derrubava a campanha inteira, foi
desligada — e o desligamento virou permanente, com a tela e o guia do lojista
seguindo prometendo o que não acontecia.

**O que fica decidido, e vale para todo limite do produto:**

1. **Número que a tela anuncia como limite é travado no servidor, no caminho de
   envio.** Se não dá para travar, a tela não anuncia como limite — anuncia como
   indicador, com outras palavras. Confiança falsa é pior que limite nenhum.
2. **A trava mora no portão por destinatário, não no portão de lote.** Portão de
   lote não distingue quem custa vaga de quem não custa, e por isso a versão
   anterior era mais destrutiva que o problema que evitava (guardrail 5). O teto de
   contatos barra **só contato novo**; quem já está na conta continua recebendo.
3. **Etiqueta é afirmação, e afirmação precisa de prova com data.** "Resposta CRM"
   passou a exigir log de envio real **mais** a última mensagem do cliente dentro da
   janela de resposta. Campo de estado que nunca expira (`Conversation.contextType`)
   não serve de prova para nada que o lojista lê como fato do dia.
4. **Régua repetida se aponta, não se copia.** A janela de resposta da etiqueta é a
   MESMA de `markCrmReplyIfApplicable` (7 dias). Duas réguas para a mesma pergunta é
   a mesma família do "duas fontes para o mesmo número".

**O que NÃO foi decidido aqui e continua com o CEO:** quanto vale o teto de contatos
de cada restaurante, e se esse campo — que é limite de **custo**, não regra
anti-banimento — deve continuar travado atrás do "Assumir controle manual".

**Adendo de 23/08, autorizado pelo CEO — a recuperação de carrinho entrou no portão.**
Ela era o caminho que provava a regra pela exceção: o rodapé da tela prometia quatro
"proteções sempre ativas" e ali três não valiam. Ficam duas lições nomeadas:

5. **Proteção que vale "sempre" vale em TODO caminho de envio, e isso se prova
   caminho por caminho.** Um portão unificado só é unificado se todos os caminhos
   passarem por ele; basta um por fora para a promessa da tela virar mentira.
6. **Somar trava não é trocar trava.** As guardas próprias da recuperação (uma por
   rascunho, uma por cliente/dia, loja aberta no abandono) continuam de pé. E a
   isenção do teto diário continua valendo, porque é decisão registrada — entrar no
   portão não é motivo para revogar em silêncio o que já tinha sido decidido.

**Proposta ao Diretor Geral (dioli-brain-kit):** os itens 1, 3 e 5 não são do Foocci,
são doutrina de agente — *"limite anunciado é limite travado"*, *"etiqueta carrega a
data que a prova"* e *"proteção 'sempre ativa' se prova caminho por caminho"*. Fica
registrado como proposta, não escrito no kit (guardrail 3).

---

## 2026-08-08 — O SDR passa o valor dos planos na hora

**Decisão do CEO:** *"Ele passa o valor dos planos."*

Encerra a última pergunta que travava o SDR do Foocci. Quando um lead perguntar
"quanto custa?", ele **responde o valor**, sem puxar para reunião antes.

**A trava de engenharia que vai junto, e não é opcional:** o SDR lê o preço da
**mesma fonte que o site publica** — nunca de uma cópia no texto dele. Preço
copiado envelhece calado: no dia em que a tabela mudar, o site mostra um valor e
o SDR vende outro, e ninguém percebe até um cliente cobrar a diferença.

É a mesma família do "regra não se copia, se aponta" e do fallback de preço de
IA que consertamos em 07/08 — **duas fontes para o mesmo número é o defeito, não
o descuido.**

**O que muda:** o desconto de 50% no primeiro mês faz parte da resposta. Ele é o
argumento mais forte da tabela e já está no site; omitir na conversa seria vender
pior do que a página.

**O que continua fora do alcance dele:** negociar desconto que não existe na
tabela, prometer prazo de implantação, ou afirmar que um recurso existe sem
lastro. Preço é fato publicado; o resto é conversa que sobe para o humano.

---

## 2026-08-08 — Todos os repositórios da companhia viram privados

**Decisão do CEO:** *"Todos privados, senão vão roubar nossas ideias."*

**Como apareceu:** ao construir o espelho da doutrina dentro do projeto, o
especialista mediu antes de ligar e achou o que mudava tudo — o
`dioli-brain-kit` era privado e o **`FOOCCI` era público**. Espelhar teria
publicado a doutrina inteira da companhia num repositório aberto: a escada de
governança, o processo do cofre de credencial, o histórico de incidentes (que
cita uma cliente pelo nome) e a lista de quem está vivo. Ele montou a máquina
toda, provou contra o espelho real, **removeu os arquivos e não ligou.**
Entregar com aquilo na árvore seria plantar a armadilha e chamar de entrega.

**O que estava exposto, e é erro do Diretor:** em 07-08/08 eu escrevi, no perfil
do agente `seguranca` e em `docs/pendencias.md`, **a lista nominal das portas de
segurança abertas do Foocci** — qual webhook não tem autenticação, qual provedor
de pagamento aceita cobrança forjada. Escrevi para o agente novo saber o que
consertar. Num repositório público, isso é mapa de ataque pronto. Eu sabia que o
log do Actions era público e tratei disso; **não conferi a visibilidade do
próprio repositório**. Presumi.

**Estado antes → depois** (medido pelo campo `private` da API, não por
impressão):

| Repositório | Antes | Depois |
|---|---|---|
| `FOOCCI` | público | **privado** |
| `cityjobs` | público | **privado** |
| `diolidigital` | público | **privado** |
| `Foocci_Manager` | público | **privado** |
| `control_room` | público | **privado** |
| `dioli-brain-kit` | privado | privado |

Conferido depois: `foocci.com.br/api/health` continua respondendo, com o
`commitSha` do merge — fechar não derrubou produção.

**A regra que fica:** repositório de produto e de doutrina nasce **privado**. Já
estava escrito em `dioli-brain-kit/docs/04-seguranca.md` e ninguém tinha
conferido se a realidade batia com o papel. **Regra escrita que ninguém mede é
regra que não existe** — e essa é a mesma família do "sem portão = reprovado".

**Aprendizado do Diretor, para não repetir:** antes de escrever num arquivo
versionado *qualquer coisa que ajude um atacante*, a pergunta é **"quem consegue
ler este repositório?"** — e a resposta tem que ser medida, não presumida. A
lista de vulnerabilidades continua no histórico do git; fechar o repositório
resolve o acesso, não apaga o passado.

---

## 2026-08-08 — O que sobe para o CEO, e o que o Diretor resolve sozinho

**Decisão do CEO, nas palavras dele:** *"Eu sou do marketing, eu não entendo de
sistema. Só decisões mais sensíveis é que me pergunta, por favor. Tudo que for do
sistema você resolve."*

**Contexto:** o Diretor subiu como "pendências do CEO" três itens que não eram
decisão de negócio — autorizar um merge, quatro achados de segurança, e um campo
vazio numa tela. A resposta foi *"não sei nem o que que é isso"*. Estava certo.

**A regra, com o teste:** antes de perguntar, o Diretor responde *"se eu
decidisse isto sozinho e desse errado, seria erro meu ou uma escolha de negócio
que não era minha?"*. Erro meu → resolve. Escolha dele → pergunta.

Sobe: preço e plano · o que o produto promete ao cliente · gastar dinheiro ·
risco irreversível (dado de cliente, pagamento em produção, exposição da marca) ·
prioridade entre blocos grandes.

Não sobe: merge, deploy, teste, migration · achado de segurança (conserta e
informa o que foi consertado) · defeito de tela · divisão de trabalho entre
agentes.

**Consequência no formato do relatório:** o CEO recebe o que foi feito e o que
ele precisa decidir. A lista do que está aberto por dentro vive em
`docs/pendencias.md` e **não** vai para o relatório dele — pendência técnica que
ele não tem como resolver é ruído, e ruído treina a não ler o relatório inteiro.

Detalhe operacional em `CLAUDE.md`.

---

## 2026-08-08 — SDR: só Meta oficial. Evolution está fora

**Decisão do CEO:** *"SDR jamais Evolution, a gente só vai usar Meta oficial."*

Encerra a escolha de chip que estava aberta desde 07/08. O SDR do Foocci fala
pelo WhatsApp **Cloud API da Meta**, e a Evolution não é alternativa para este
caso — nem como plano B.

**Consequência que precisa ser respeitada:** existe **um único aplicativo** da
Foocci dentro da Meta, e ele serve WhatsApp *e* Instagram. Permissão negada,
revisão reprovada ou segredo rotacionado sem atualizar o Railway **derrubam os
dois canais juntos**. Qualquer mexida no SDR passa pelo especialista `meta`.

---

## 2026-08-08 — Cartão na Meta: não perguntar antes de 24/09

**Decisão do CEO:** *"Cartão na conta da Meta — se em outubro para de perguntar
isso, você só vai me perguntar faltando uma semana."*

A cobrança de conversa de serviço no WhatsApp começa em **01/10/2026**. O assunto
sai da pauta até **24/09/2026**, quando volta uma vez, com o valor estimado do
mês já calculado.

**A regra por trás, que vale além deste item:** prazo distante não é pendência —
é lembrete com data. Item que reaparece toda semana sem poder ser resolvido vira
ruído, e ruído faz o CEO parar de ler a lista inteira. É o guardrail 6 aplicado à
pauta: o aviso só chega quando carrega a ação possível.

---

## O custo de WhatsApp entra na mensalidade — não vira item cobrado à parte

**Decidido em** 2026-08-06 · **por** CEO · **origem:** ele viu no site a linha
*"WhatsApp oficial da Meta — R$ 149/mês, a Meta cobra por conversa; o repasse é
transparente"*, não reconheceu, e mandou pesquisar como a Meta cobra de verdade.

Palavras dele: *"então vamos transferir esse custo para mensalidade que usa o CRM.
Simples."*

**O que muda:** o item "WhatsApp oficial da Meta" **sai** da tabela "Cobrado à
parte". O custo de mensagem passa a estar **embutido no preço do plano**. O
lojista não vê linha de WhatsApp na fatura dele.

### O que a pesquisa em fonte oficial da Meta estabeleceu

A cobrança é **por mensagem entregue pela empresa**, e quem manda no preço é a
**categoria**, não o volume:

| Categoria | Quem começa | Brasil, hoje |
|---|---|---|
| Serviço — resposta livre dentro da janela de 24h | o cliente | **R$ 0, ilimitado** |
| Utilidade dentro da janela — confirmação, status | o cliente | **R$ 0** |
| Utilidade fora da janela | a empresa | R$ 0,035 |
| **Marketing** — campanha, reativação, carrinho | a empresa | **R$ 0,3217, sempre** |
| Autenticação | a empresa | R$ 0,035 |
| Janela de 72h por anúncio Click-to-WhatsApp | o cliente, via anúncio | **R$ 0, inclusive marketing** |
| Mensagem que o cliente envia | o cliente | nunca cobrada |

**Não existe cota gratuita mensal.** O que é grátis é grátis por categoria e
janela — a antiga cota de 1.000 conversas acabou em 01/11/2024, quando toda
conversa de serviço virou grátis e ilimitada.

Fonte: `developers.facebook.com/documentation/business-messaging/whatsapp/pricing`
e a calculadora oficial em `whatsappbusiness.com/products/platform-pricing/`
(tarifas do Brasil vigentes desde 01/07/2026).

### 🔴 A data que muda tudo, e ela não é opcional

**1º de outubro de 2026:** a Meta passa a cobrar **mensagem de serviço** e
**template de utilidade dentro da janela**. É exatamente o que o Foocci faz o dia
inteiro. A parte que hoje é grátis — e é a maior — vira paga de uma vez.

A Meta se comprometeu a publicar as tarifas definitivas **até 01/09/2026**.
Antes disso, qualquer número é estimativa e não entra em preço de plano.

Fonte: `.../whatsapp/pricing/non-template-messages`

### O que esta decisão NÃO resolve, e precisa ser dito

**O custo é variável e a mensalidade é fixa.** Um restaurante com 3.000 conversas
por mês custa muitas vezes mais que um com 200 — e no mesmo plano. Embutir custo
variável em preço fixo tem dois resultados possíveis: o pequeno paga pelo grande,
ou o grande dá prejuízo. Hoje isso não dói porque o custo é ~zero; **em outubro
passa a doer.**

A decisão do CEO está tomada e vale. O que ela exige junto é **medição**: quantas
mensagens o agente entrega por conversa, por restaurante. Sem esse número, o preço
do plano é um chute — e é o mesmo número que destrava a decisão de faixas de preço
parada em `docs/pendencias.md`.

**O que fica registrado como pendência técnica:** instrumentar contagem de
mensagens entregues **por restaurante e por categoria**, antes de 01/09/2026.

---

## Carrinho abandonado: manda em 2 minutos, e loja fechada não manda nunca

**Decidido em** 2026-08-05 · **por** CEO · **origem:** o diagnóstico que mostrou
**4 mensagens de recuperação em 2 meses e meio**

Palavras dele: *"a mensagem tem que ser enviada quando o cliente fecha o Foocci,
e 2 min depois mandar. Se o cliente abre de madrugada não precisa enviar nada,
porque ele queria comer de madrugada e não quando o restaurante abrir."*

**O que muda:** carrinho não finalizado + 2 minutos sem atividade → manda, **se a
loja estiver aberta naquele momento**. Loja fechada: **não manda, e não guarda
para depois**. O carrinho morre em silêncio.

**Por que a segunda metade é a mais importante:** antes o motor *adiava* o envio
para quando a loja abrisse — e o carrinho expirava em 6h, antes disso. Ou seja,
ele prometia um envio que nunca acontecia. Agora a recusa é honesta e imediata.

**O que muda para todos:**

1. **A regra é avaliada no MOMENTO do abandono, não depois.** É essa escolha —
   e não uma trava de data — que impede enxurrada: os ~51 carrinhos represados
   que o diagnóstico encontrou **nunca** viram mensagem, por construção. Provado
   por três caminhos independentes, inclusive um teste que injeta os 51 com a
   validade afrouxada de propósito e exige zero envio.
2. **"Fechou o app" não existe como sinal.** O navegador não avisa isso de forma
   confiável; o que existe é **inatividade**. Quem for "melhorar" isso depois vai
   tentar detectar fechamento de aba e vai falhar em silêncio — está escrito no
   código para não tentar.
3. **Lembrete tardio é pior que lembrete nenhum.** Vontade de madrugada não
   sobrevive até o restaurante abrir; a mensagem de manhã chega como cobrança de
   um desejo que já passou. Vale como princípio para qualquer recuperação futura,
   não só a de carrinho.

---

## O concorrente não abre o site — a comparação só vale onde tem lastro

**Decidido em** 2026-08-05 · **por** CEO · **origem:** revisão do site ao vivo,
olhando a home no celular

O hero da home abria com *"Quanto o {marketplace} leva do seu faturamento?"*.
Convertia como conta, e queimava o primeiro impacto: **a primeira imagem que o
dono forma do Foocci não pode ser a de alguém apontando para o vizinho.** A
pergunta não foi descartada — desceu para o topo da calculadora.

**Por que a linha passa aí:** na calculadora a comparação tem lastro — os números
são do próprio dono e a taxa é um campo editável. No hero seria afirmação nossa
sobre a casa dos outros, que é justamente o que a trava jurídica de 04/08 evita.

**O que muda para todos:**

1. **A regra é de LUGAR, não de proibição.** Nomear o marketplace é permitido
   onde o visitante informa os próprios números; não é, em peça de primeiro
   contato.
2. **O gancho de abertura é a dor de fundo, não o sintoma.** Comissão dói todo
   mês, mas a causa é o cliente não ser do restaurante. Quem escrever peça nova
   de topo — página, anúncio, e-mail — parte daí.
3. Vale para qualquer superfície de aquisição, não só a home.

---

## Imagem do site é o produto fotografado, nunca banco de imagens

**Decidido em** 2026-08-05 · **por** Diretor, sob autorização do CEO ·
**origem:** *"o site está só com texto, botão e detalhes gráficos"*

Toda página de `/site` abre com um elemento visual. Onde o argumento é o produto,
a imagem é **captura da tela real** do Foocci rodando na padaria de demonstração
(`foocci-bakery`) — a mesma que o visitante pode experimentar em
`/site/experimente`. Fotografia de estilo de vida fica para o que é ambiente
(hospitalidade, salão, cliente), nunca para representar tela.

**Por que:** guardrail 7 aplicado à imagem. Mockup bonito de tela que não existe é
a versão visual de vender piloto como pronto — e é mais difícil de auditar que
texto, porque ninguém relê uma imagem.

**O que muda para todos:**

1. **Captura de produto é reproduzível ou não entra.**
   `scripts/site/capturar-produto.mjs` refaz as cinco; quem criar slot novo cria o
   passo no roteiro junto.
2. **Slot vazio degrada, nunca quebra.** `hasAsset()` decide em tempo de request;
   página sem a imagem cai no visual anterior em vez de abrir um buraco.
3. **Peso é requisito, não detalhe.** O público abre no 4G: cada captura fica
   abaixo de 400 KB.

---

## Diagnóstico de credencial é leitura pura — nunca uma cobrança de teste

**Decidido em** 2026-08-05 · **por** Diretor · **origem:** o CEO colocou o
`MP_PLATFORM_ACCESS_TOKEN` no Railway e a pergunta virou "entrou certo?"

Para saber se uma credencial de terceiro funciona, o sistema **pergunta pela via
mais barata que o provedor oferece** (no Mercado Pago, `GET /users/me`). Nunca
executa a operação real — nada de contratação de mentira em produção para
descobrir se o gateway responde.

**Por que:** a operação real deixa rastro que não se apaga: contrato falso na
carteira, objeto de recorrência no gateway, e-mail para um cliente que não existe.
E "presença de variável" **não é** a mesma pergunta que "a chave funciona" — token
vencido devolve `true` do mesmo jeito, e quem descobre a diferença é o cliente.

**O que muda para todos:**

1. Toda integração externa que sustenta dinheiro deve expor um diagnóstico
   **verificável de fora**, com veredito e a razão que o provedor deu.
2. **"Não deu para conferir" nunca vira "está tudo bem"** (guardrail 1). A tela
   diz que não sabe.
3. **O segredo nunca sai no veredito.** Isto é trava em código (`semSegredo`),
   não combinado — o teste que exigia isso reprovou a primeira versão, que ecoava
   um campo do gateway direto para o admin.

---

## Identificação por telefone: obrigatória onde nasce pedido, pulável só na mesa

**Decidido em** 2026-08-04 · **por** CEO · **origem:** conferência da Loja do
sushi-cazza em produção (a Loja oferecia "Identificar-se" como convite opcional)

O cliente **precisa** informar o WhatsApp para usar a **Loja** e o **chat com
IA**. No **QR da mesa**, continua podendo pular.

**Por que a linha passa aí:** a mesa é consumo presencial — o cliente já está
sentado, o pedido é do garçom, e barrar quem quer só ver o cardápio é atrito puro.
Loja e chat são o oposto: ali nasce pedido, cupom, endereço e histórico. Cliente
anônimo nesses dois quebra a atribuição de receita do CRM, impede recuperação de
carrinho e deixa o pedido sem dono verificável.

**O que muda para todos:**

1. A pergunta que decide se uma superfície nova exige identificação é **"aqui
   nasce pedido?"** — não "aqui tem checkout?" nem "aqui tem IA?".
2. **A marca de "já perguntei" não pode ser compartilhada entre superfícies de
   regras diferentes.** O `sessionStorage` `qr-welcome-seen-<slug>` é gravado
   pelo QR da mesa, onde pular vale; se a Loja consultar essa marca para decidir
   se pede identificação, quem pulou no salão entra na Loja anônimo. Portão que
   uma tela anterior desliga não é portão. Travado em
   `src/components/menu/identificacaoObrigatoria.test.ts`.
3. Tela sem saída **diz o porquê** e some com o que promete saída (o rótulo
   "pular", a alcinha de arrastar). Obrigatoriedade sem explicação lê como
   cobrança de dado.

---

## Toda proteção decide pelo estado, não por reflexo

**Decidido em** 2026-07-31 · **por** CEO + Diretor · **origem:** incidente da Nicole
(commit `3ec378b3`)

Um portão que reprova precisa escolher a resposta olhando o **estado da
conversa**. O comportamento antigo — cair sempre na saudação — fez uma cliente
receber a tela de entrada cinco vezes no meio de um pedido.

**O que muda para todos:** proteção que dispara não pode ser mais destrutiva que
o problema que ela evita. Vale para o Cérebro, para os canais e para qualquer
verificador futuro. Quando duas peças usam a mesma janela de tempo (aqui, 30 min),
**elas leem a mesma constante** — se divergirem, uma acha que a conversa começou e
a outra acha que não.

---

## Mentir sobre si mesmo é uma categoria de erro separada

**Decidido em** 2026-07-31 · **por** Diretor · **origem:** mesmo incidente

Verificador de fato (preço, cardápio, entrega) **não pega** agente que encena uma
capacidade que não tem. O agente não mentiu sobre o restaurante — mentiu sobre si
mesmo.

**O que muda para todos:** ao auditar comportamento de agente, as duas perguntas
são feitas separadamente. Todo canal declara o que ele **não** consegue fazer, e
isso vira trava em código, não linha de perfil.

---

## Prompt é aviso; código é trava

**Decidido em** 2026-07-31 · **por** Diretor · **origem:** "não prometa pedido" estava
no perfil do agente e não segurou

Para o que causa dano real, exija o mecanismo — gate, validação, restrição de
ferramenta. O aviso continua existindo **em paralelo** com a trava, nunca no lugar
dela.

**O que muda para todos:** vale inclusive na configuração dos próprios
especialistas: `tools:` restrito é trava; "não faça X" no prompt é aviso. Por isso
o agente `qualidade` não tem permissão de escrita.

---

## Um estado sem prazo é um vazamento

**Decidido em** 2026-07 · **por** Diretor · **origem:** comanda parada em `CLAIMED`
para sempre; carrinho abandonado eterno; falha permanente retentada sem fim

Todo estado intermediário — "em processamento", "reservado", "aguardando" — nasce
com prazo e com quem o resgata quando vence.

**O que muda para todos:** vale em impressão, pedido, envio de mensagem e fila de
campanha. Estado novo sem prazo não passa em revisão.

---

## O repositório é a memória; o chat é a sala de reunião

**Decidido em** 2026-08-01 · **por** CEO · **origem:** a reestruturação
CEO → Diretor → especialistas

Cada projeto passa a ter **um Diretor**, que é a ponte única do CEO. Assuntos deixam de
virar chats separados: viram despacho para especialista, e o resultado vira
registro no repositório **na mesma sessão**.

**O que muda para todos:** nenhum aprendizado durável pode existir só na conversa.
Sentiu que "isso é importante e está só no chat"? Pare e escreva agora — na
oficina do agente, se for do domínio; aqui, se atravessar domínios.

---

## O aplicativo Meta é chave mestra, e chave mestra tem dono só dela

**Decidido em** 2026-08-01 · **por** CEO · **origem:** conversa com o Diretor, com o
painel do app à vista (`Foocci Whats`, App ID `893641126399955`)

Existe **um único aplicativo** da Foocci dentro da Meta, e ele serve **WhatsApp e
Instagram ao mesmo tempo**. Não são dois. Uma permissão negada, uma revisão
reprovada, um cadastro de empresa incompleto ou um segredo rotacionado sem
atualizar o Railway **derruba os dois canais de uma vez, para todos os clientes**.

O Diretor recomendou manter isso dentro de `canais` e **o CEO decidiu o
contrário** — com o argumento que venceu: `META_APP_SECRET` é **chave mestra**.
Quem a tem faz qualquer coisa dentro da Meta em nome da Foocci. Isso é **custódia
de credencial e governança**, não tráfego de mensagem.

**A fronteira: `meta` cuida da CHAVE; `canais` usa a PORTA.**

| É do `meta` | É do `canais` |
|---|---|
| o app não tem a permissão | a mensagem não chegou |
| o token morreu / nasceu curto | a DM caiu no filtro errado |
| o número não registra | o número corre risco de bloqueio |
| a assinatura do webhook não confere | o webhook chegou e roteou errado |
| rotacionar segredo | escolher provedor (Evolution × Meta) |

Seis entradas de vitrine migraram de `canais` para `meta`, com proveniência
preservada.

**O que muda para todos:** o teste de fronteira é uma pergunta só — *"isso quebra
WhatsApp e Instagram juntos?"*. Se sim, é do `meta`. E **segredo do app nunca
aparece em chat, log, documento ou commit** — esta casa já vazou dois (o PIN de 2FA
do WhatsApp e o client secret do Google), e nenhum dos dois tem rotação confirmada.

---

## Sala sem dono é memória que ninguém mantém — o `manual` virou o 9º especialista

**Decidido em** 2026-08-01 · **por** CEO (*"pode seguir com todos os fixes"*) ·
**origem:** auditoria de coerência na primeira sessão do Diretor

`docs/agents/manual/vitrine.md` existia com seis entradas curadas, e
`docs/pendencias.md` tinha uma seção inteira de manual e treinamentos — mas **não
existia agente `manual`** em `.claude/agents/`. Eram oito, e ele não estava entre
eles.

Uma sala sem dono quebra duas regras ao mesmo tempo: o agente só escreve na
**própria** sala (então ninguém podia escrever naquela), e a área não tinha quem
respondesse por ela quando uma pendência aparecesse.

**Corrigido criando `.claude/agents/manual.md`** — guias, assistente do widget,
robô noturno de sync e onboarding do lojista.

**O que muda para todos:** vitrine e agente nascem **juntos**. Antes de promover a
primeira entrada de uma sala nova, confirme que existe agente com aquele nome — e
antes de criar um agente, confirme que a área não é de um dos que já existem.
Sala órfã é o sintoma barato de um problema caro: área sem responsável.

---

## Documentação não é evidência

**Decidido em** 2026-07 · **por** Diretor · **origem:** o comentário do Carteiro
descrevia re-tentativa que o servidor nunca implementou

Verificação se faz contra o código em execução. Comentário, README e documento
descrevem intenção — e intenção diverge silenciosamente do que roda.

**O que muda para todos:** toda afirmação em entrega de especialista vem com
**arquivo:linha**. Alerta e relatório carregam a própria evidência.

---

## A branch padrão deste repositório não é `main` — e os crons dependem disso

**Registrado em** 2026-08-01 · **origem:** `HANDOFF-canais-meta.md` §e (commit `18a5ed7`)

A branch padrão é `claude/remove-legacy-runner-q8iXa`. O gatilho `on: schedule` do
GitHub Actions **só dispara a partir da branch padrão**.

**O que muda para todos:** trocar a branch padrão sem migrar os workflows **quebra
todos os crons em silêncio** — nenhum erro, nenhum aviso, as tarefas noturnas
simplesmente param de rodar e ninguém percebe até faltar o resultado delas.

Vale para o robô do manual, os simuladores, o refresh de token do Instagram e as
varreduras de qualidade.

---

## Só uma branch chega em produção — as outras dezenas são blocos de trabalho

**Registrado em** 2026-08-01 · **origem:** `HANDOFF-painel-e-evolution.md` §f
(commit `cfc346c`) · **corrigido em** 2026-08-01 pelo Diretor

O remoto tem **mais de trinta** branches. Isso é normal — é o fluxo de branch por
bloco, não bagunça. Só uma delas importa para produção:

| Branch | O que é de verdade |
|---|---|
| `claude/remove-legacy-runner-q8iXa` | **A que auto-deploya no Railway** → `foocci.com.br`. É a padrão do repositório |
| `claude/pm-*`, `cmv-*`, e as demais | branches de bloco. Verifique se já entraram antes de tratar como trabalho perdido |
| `claude/foocci-brain-vaamrx` | ⚠️ **esgotada.** Era citada como "a" branch de trabalho no `CLAUDE.md`; hoje está 39 commits atrás da padrão e **zero à frente**. Não use — abra uma nova |
| `claude/inspiring-bardeen-hsx9wk` | já foi registrada aqui como "branch misteriosa". **Não é:** é uma branch de bloco e o trabalho dela **já está na padrão** (`d4eac6f`, o CEP na nota do caixa) |

**O que muda para todos:** o que chega em produção é o que entra em
`claude/remove-legacy-runner-q8iXa`. O padrão que funciona é branch de bloco →
PR → `merge --no-ff` na de deploy → push → **conferir o `commitSha` no
`/api/health`**.

**Antes de chamar uma branch de órfã, misteriosa ou perdida**, rode o teste de uma
linha — ele desarmou os dois falsos alarmes acima:

```
git merge-base --is-ancestor origin/<branch> origin/claude/remove-legacy-runner-q8iXa
```

---

## `/api/health` é o oráculo de deploy — e diz mais que "ok"

**Registrado em** 2026-08-01 · **origem:** `HANDOFF-painel-e-evolution.md` §f
(commit `cfc346c`)

Ele devolve `commitSha`, `branch`, `db` e um bloco `checks` com
`mpWebhookSecret`, `encryptionKey`, `nextauthSecret`, `openaiKey`, `databaseUrl`.

**O que muda para todos:** é o jeito mais rápido de saber **o que falta de variável
de ambiente em produção sem abrir o Railway**. Hoje o único `false` ali é
`mpWebhookSecret`.

Use-o para confirmar que um merge chegou no ar — não confie no verde do deploy.

---

## Push na branch padrão é rejeitado na primeira tentativa — e isso é normal

**Registrado em** 2026-08-01 · **origem:** `HANDOFF-manual.md` §6 (commit `5b1c885c`)

Várias sessões commitam na mesma branch ao mesmo tempo. O padrão obrigatório é o
loop: **`push → fetch → rebase → push`**.

E **403 ao empurrar fora da própria branch é comportamento esperado**, não erro de
rede: a credencial git de uma sessão web é escopada à branch dela. Não insista.

**O que muda para todos:** apagar branch alheia daqui **nunca funciona** — nem por
`git push --delete`, nem pelas ferramentas do GitHub. O único caminho é a UI do
GitHub, pelo dono.

E **o nome de branch exibido na interface do chat é etiqueta da sessão** — só vira
branch de verdade se aquela sessão fizer push. Isso já causou dois falsos alarmes
de "branch misteriosa".

---

## O fluxo é branch por bloco → PR → padrão — e esta entrada dizia o contrário

**Registrado em** 2026-08-01 · **corrigido em** 2026-08-01 pelo Diretor
**Origem:** `HANDOFF-cmv-precificacao.md` §5.1 e §7 (commits `36a36597`,
`e8f01e90`) · **corrigido contra** a API do GitHub e o histórico da branch padrão

Esta entrada afirmava *"o projeto é trunk-based, não usa PR, não crie branch de
feature sem pedido expresso"*. **É falso** — e estava no arquivo de maior
precedência que os agentes leem como verdade.

O que a verificação mostra: os PRs **#44 a #53** foram abertos em 01/08, **todos**
com base em `claude/remove-legacy-runner-q8iXa`, cada um saindo da **sua própria
branch de bloco** — `claude/pm-canais`, `claude/pm-crm`, `claude/pm-cmv`,
`claude/pm-manual`, `claude/pm-google`, `claude/pm-categorias`,
`claude/pm-painel`, `claude/pm-consolidacao`. Branch por bloco não é exceção
pedida: é o padrão da casa.

**O que muda para todos:** abra uma branch para o seu bloco, faça PR para a
padrão, e **nunca empilhe trabalho novo em branch já mergeada** — reinicie a
partir da padrão.

### As travas de escrita concorrente continuam valendo

Elas vieram de um incidente real, não da premissa errada acima. **Várias sessões
escrevem na mesma linha ao mesmo tempo**, e em 01/08 um `--force-with-lease`, com
a falha do `rebase` **mascarada por um pipe**, descartou o merge de outra sessão
por alguns minutos. Foi detectado na verificação e restaurado.

- Nunca `--force-with-lease` na branch padrão. O padrão é `push → fetch → rebase →
  push`, em loop.
- **Nunca canalize um `rebase` por pipe.** O código de saída passa a ser o do
  `tail`, e uma falha vira "sucesso" silencioso — que foi exatamente o que
  aconteceu.
- Depois de qualquer operação de escrita concorrente, **confirme com
  `git merge-base --is-ancestor`** que o trabalho alheio continua no remoto.

> **A lição de segunda ordem, e ela é a mais cara:** esta entrada esteve errada por
> um dia inteiro e ninguém pegou, porque o corredor é lido como **verdade** e não
> como afirmação verificável. Entrada de corredor que descreve **processo** — fluxo
> de branch, quem aprova o quê, como se publica — envelhece muito mais rápido que
> entrada que descreve **comportamento de código**. Carimbe a origem e reverifique
> antes de obedecer.

---

## A Regra de Ouro do Brain é travada por teste, não por combinado

**Registrado em** 2026-08-01 · **origem:** `HANDOFF-cmv-precificacao.md` §5.5
(commit `36a36597`)

**Nenhum arquivo fora de `src/services/brain/engines/**` pode importar
`@/lib/openai` ou SDK de IA.** O caminho certo é `selectEngine(agentId)` +
`callStructuredJson()`.

`architecture.test.ts` varre os imports e **derruba o CI**. Não é convenção — é
mecanismo. É o guardrail "prompt é aviso, código é trava" aplicado ao próprio
repositório.

**Junto:** `next build` roda `tsc` strict **e** ESLint com
`react/no-unescaped-entities` e `no-restricted-imports` como **erro**. Lint quebra o
build, não só o CI.

---

## Commit ausente da branch padrão **não** prova que o trabalho não chegou

**Registrado em** 2026-08-01 · **origem:** mineração do
`HANDOFF-railway-build-e-ui-promocoes.md` (commit `4712538`)

Os **seis** commits daquela sessão não são ancestrais da branch padrão. Pela
verificação usual (`git merge-base --is-ancestor`), o trabalho nunca chegou em
produção.

**E no entanto está tudo lá:** o `nixpacks.toml` é byte a byte idêntico, os quatro
pacotes estão em `dependencies`, o drawer com `lg:left-56` e a aba
*🤖 Automações WhatsApp* rodam em produção hoje. O conteúdo entrou por outro
caminho — outra sessão reaplicou, ou um rebase reescreveu os commits (é o mesmo
efeito já registrado em *"`git log` numa branch compartilhada não é linha do
tempo"*).

**O que muda para todos:** a pergunta certa nunca é *"o commit está na branch?"* —
é **"o comportamento está no código que roda?"**. Verifique por conteúdo:
`git show <branch>:<arquivo>`, `git grep <padrão> <branch>`, `/api/health`.

O erro simétrico é igualmente caro. Já aconteceu dos dois lados no mesmo dia:

| Achado | Conclusão errada | Verdade |
|---|---|---|
| commit **não** é ancestral | "o trabalho se perdeu, vou refazer" | já estava em produção — refazer criaria conflito |
| branch existe e parece pronta | "é só mergear" | reprovava no `tsc` (a `fresh-debug-session-C3qhF`) |

---

## O deploy roda com `NODE_ENV=production` — e isso apaga metade do `package.json`

**Registrado em** 2026-08-01 · **origem:** mesmo handoff, §1 e §3

O nixpacks instala com `NODE_ENV=production`, e nesse modo o `npm ci` **omite as
`devDependencies`**. Um pacote que só existe ali simplesmente não chega no
contêiner — e o build quebra com `Cannot find module`, apontando para um arquivo
que está no git e compila perfeitamente na máquina.

Duas travas estão na branch padrão e resolvem o caso:

1. `nixpacks.toml` → `[phases.install] cmds = ["npm ci --include=dev"]`
2. `tailwindcss`, `postcss`, `autoprefixer` e o **CLI** do `prisma` movidos para
   `dependencies` (o CLI é usado em produção duas vezes: `prisma generate` no
   build e `prisma migrate deploy` no start)

**O que muda para todos:** *"passa localmente"* não é evidência de que o deploy
passa — o ambiente local instala tudo. Antes de culpar o código por um
`Module not found` no Railway, confira **em que lista do `package.json`** o pacote
está.

⚠️ **Não remova o bloco `[start]` do `nixpacks.toml`.** Ele é recuperação de
emergência de um P3009 e não pertence à mesma mudança — só sai depois de
confirmar que a migração `20260518000001_add_distance_min_fee_km` está estável em
produção. O comentário *"remove after confirmed stable"* vale **só** para esse
bloco.

---

## Ler o arquivo inteiro antes de afirmar o que ele contém

**Registrado em** 2026-08-01 · **origem:** `HANDOFF-site-comercial.md` §4
(commit `79943f5`)

Duas afirmações erradas na mesma sessão, pelo mesmo motivo — **leitura parcial
tratada como leitura completa**:

1. Uma primeira leitura do `tailwind.config.ts` devolveu só as cores `brand` e a
   fonte. O arquivo tem 44 linhas e **também** define os sete tokens semânticos e a
   filosofia da marca. A conclusão que ia sair era "laranja protagonista" — o
   oposto do que o arquivo diz.
2. Uma busca ampla por "PREMIUM" encontrou a palavra e concluiu que era nome de
   plano. É de **outro** enum (`CRMMessageStyle`). O enum `Plan` real é
   `{ STARTER, GROWTH, PRO }` — `prisma/schema.prisma:155-159`.

**O que muda para todos:** busca **localiza**; ela não **conclui**. Achou a palavra?
Abra o arquivo, leia o bloco inteiro e confirme a que estrutura ela pertence antes
de afirmar qualquer coisa.

O sinal de alerta é o que salvou os dois casos: **duas leituras do mesmo arquivo
discordando entre si**. Quando isso acontecer, pare e releia — nunca escolha a que
confirma o que você já ia escrever.

É o guardrail "documentação não é evidência" um nível abaixo: **nem a sua própria
leitura anterior é evidência.**

---

## O WhatsApp da Foocci passa a ser SÓ a Meta — a Evolution sai

**Decidido em** 2026-08-02 · **por** CEO · **origem:** conversa com o Diretor
durante o preparo do lançamento

Direção fechada: **o único provedor de WhatsApp é a Meta Cloud API.** Tudo que for
Evolution deve ser eliminado.

**O que isso NÃO significa:** apagar hoje. A eliminação é migração, e apagar sem
migrar derruba WhatsApp de quem está no ar. Os números medidos em 02/08:

| Fato | Número |
|---|---|
| Arquivos que citam Evolution | **239** |
| Provedor padrão no banco (`Restaurant.whatsappProvider`) | **`EVOLUTION`** |
| Provedor de reserva (`fallbackProvider`) | **`EVOLUTION`** |

Ou seja: **todo restaurante existente está na Evolution** até ser trocado
explicitamente. O default nasceu assim de propósito, para a adoção da Meta ser
aditiva.

**O que quebra se alguém apagar a Evolution antes de portar** (confirmado por
leitura, registrado em `docs/pendencias.md`): pedido por texto, opt-out,
recuperação de carrinho, atribuição de receita do CRM e os comandos do BuildOS.
Os dois webhooks **não são simétricos** — o da Meta chama só o Cérebro; o da
Evolution carrega todo o resto.

**O que muda para todos, a partir de agora:**

1. **Nada novo nasce na Evolution.** Recurso novo de WhatsApp se constrói na Meta.
   Se só der para fazer na Evolution, é sinal de que falta paridade — reporte,
   não contorne.
2. **Mexeu em algo da Evolution? Só para conserto de segurança, correção de
   mentira em tela, ou para portar para a Meta.** Não invista em melhoria ali.
3. **A ordem da eliminação é fixa:** (a) portar a paridade de entrada para o
   webhook da Meta — aditivo, não mexe em produção; (b) trocar o default e migrar
   restaurante por restaurante, com confirmação; (c) só então apagar código.
   Pular (a) é derrubar cliente.
4. **O painel de QR/código de pareamento é da Evolution.** A Meta não usa QR. Ele
   é transitório e morre no fim da migração — corrigi a mentira dele em 02/08 para
   que ninguém se perca durante a transição, não para investir nele.

**RESPONDIDO pelo CEO em 04/08:** perguntado quantos restaurantes ainda dependiam
da Evolution, respondeu **"NENHUM"**. Some a etapa (b) — não há migração a fazer,
só remoção. E veio a ordem, repetida três vezes: *"EXTRAÇÃO TOTAL, NÃO QUERO UM
CÓDIGO DESSA EVOLUTION DENTRO DO FOOCCI"*.

**Executado em 04/08** por quatro frentes em paralelo (meta, crm, operação,
canais), com o Diretor consolidando:

- O roteamento virou Meta e só Meta. O buraco mais grave estava aqui: em falha de
  banco o código **caía na Evolution como reserva** — uma falha momentânea mandava
  mensagem pelo canal não homologado, exatamente o risco que a homologação existe
  para eliminar. Não há mais caminho alternativo, nem em erro.
- `WhatsAppProviderId` e `CRMProviderMode` viraram tipos de **um valor só**:
  reintroduzir um segundo canal é erro de compilação, não decisão de configuração.
  É o guardrail 4 aplicado — prompt é aviso, código é trava.
- A **rampa de aquecimento** (20→250 msgs/dia por idade do número) saiu junto: ela
  protegia uma sessão Web não oficial de banimento e, no aplicativo homologado, só
  segurava venda sem reduzir risco.

**A armadilha desta remoção, registrada para quem vier depois:** o normalizador e
o validador de telefone do projeto inteiro se chamam `normalizePhoneForEvolution`
e `isValidEvolutionPhone` (`src/lib/crm/normalizePhone.ts`) — e hoje estão no
caminho de envio da **Meta**. Quem varrer o repositório por "evolution" e apagar
sem ler derruba a validação de telefone de **todo** envio. Renomear é passo
separado, depois da extração, exatamente para não virar incidente.

## Cards do Garçom: categoria mostra tudo; fim de funil mostra 100% da categoria

**Data:** 2026-08-03 · **Decidido por:** CEO (em teste real no sushi-cazza) ·
**Registrado por:** Diretor do Foocci

Duas regras de produto, ditas pelo CEO como regra ("Isso é regra"):

1. **Pergunta de categoria mostra tudo — e só o que é da categoria.** "Tem
   sushi?" apresenta TODOS os itens de sushi, sem limite de quantidade. E nada
   que não seja sushi: métricas de venda (best-seller, prioridade, popularidade)
   **nunca qualificam** um item sem relação textual com a pergunta — elas só
   desempatam a ordem entre itens que já são relevantes. O bug que motivou a
   regra: os bônus de venda somavam pontos ANTES do filtro de relevância, então
   um best-seller de outra categoria entrava na resposta só por ser best-seller.

2. **Upsell de fim de funil mostra 100% da categoria.** Ao finalizar o pedido,
   as etapas de bebidas, sobremesas e extras apresentam TODOS os cards da
   categoria — o antigo teto de 6 cards foi aposentado. Upsell consultivo no
   meio do fluxo continua conciso; a regra vale para o funil de fechamento.

**Onde vive:** `src/services/ai/WaiterBrainV2.ts` (busca `searchMenuByQuery`,
funil `handleCheckoutStarted`, teto `capForCardScope`). **Travado por teste:**
`src/services/ai/tests/WaiterBrainV2.card-policy.test.ts` ("Regra CEO ①/②").
O teto técnico de segurança da categoria subiu de 50 para 200 cards — é proteção
contra catálogo patológico, não limite de produto.

## O Cardápio sem IA é o cardápio da mesa que compra — e esse é o nome

**Data:** 2026-08-04 · **Decidido por:** CEO ·
**Registrado por:** Diretor do Foocci

Correção de direção do CEO sobre o produto do plano básico, nas palavras dele:
o cardápio sem IA *"era pra ser igual ao cardápio da mesa (…) A única diferença
é que esse o cliente pode comprar, escolher produtos, e ter o checkout. É só
pegar o mesmo cardápio, replicar, e colocar os itens à venda e o processo de
checkout."*

Três consequências, todas executadas em 04/08:

1. **Igualdade por construção.** O visual do `/qr/[slug]` vive em
   `src/components/menu/*` e as duas superfícies (mesa e Cardápio sem IA)
   compõem os mesmos componentes. Divergir passou a ser impossível sem mexer no
   módulo comum — não é mais uma questão de disciplina de quem edita.
2. **A única diferença é a compra.** ProductModal em modo `commerce` (variantes
   selecionáveis, opções, adicionais, observação, quantidade), barra de carrinho
   integrada à nav de categorias, e o checkout provado de `/api/pedido/*`
   intocado por baixo. Preço no canal DELIVERY; a mesa segue DINE_IN, vitrine.
3. **O nome do produto é "Cardápio sem IA"** — não "Loja", não "Cardápio Loja".
   É assim que o cartão de QR do painel o chama e é assim que ele será vendido
   no plano básico. (`LojaClient`/`?modo=loja` sobrevivem como nomes internos de
   código e parâmetro; o que o lojista lê usa o nome oficial.)

**Contexto de corredor:** é a segunda correção de rota no mesmo produto em dois
dias (03/08: "não é a tela do /pedido sem IA"; 04/08: "é a réplica exata da
mesa"). O padrão a aprender: quando o CEO descreve uma superfície POR REFERÊNCIA
a outra ("igual à da mesa"), a entrega é a referência replicada — não uma
interpretação nova do mesmo requisito funcional.

## Cobra-se o que a tela mostrou — retirada precifica pelo canal de exibição

**Data:** 2026-08-04 · **Decidido por:** CEO (opção recomendada pelo Diretor) ·
**Registrado por:** Diretor do Foocci

Contexto: produtos podem ter dois preços (entrega × salão). As superfícies de
pedido exibem tudo no canal DELIVERY, mas a cobrança de **retirada** usava a
tabela DINE_IN — cliente podia ver um valor e pagar outro.

**A regra:** quando o cliente pede por uma superfície online, vale **o preço que
a tela mostrou**. Nunca surpresa de valor — a regra dos marketplaces.

Aplicação (04/08, mesmo dia):
- `/api/pedido/[slug]/finalize`: pickup precifica e promociona como DELIVERY
  (canal que o `/pedido` exibe). Taxa de entrega continua só para delivery.
- `WhatsAppCheckoutAdapter`: idem — a conversa exibe tudo em DELIVERY
  (extensão da mesma decisão pelo Diretor, com a evidência no código).
- Corolário para todo caminho novo de checkout: **canal de cobrança = canal de
  exibição.** A pergunta a responder antes de precificar é "que canal a tela
  usou?". Promovido à vitrine do `operacao`.

## O fecho da home passa a pedir — e a home é a única página com dois CTAs

**Data:** 2026-08-05 · **Decidido por:** Diretor do Foocci ·
**Origem:** varredura de percurso do `experiencia`, feita em produção no celular

Contexto: o último bloco da home ainda era a faixa de pré-lançamento — *"uma nova
forma de vender, relacionar e fidelizar **está chegando**"*, com dois botões
institucionais. Enquanto isso `/contratar/novo` já cobrava cartão e prometia loja
e acesso prontos na hora. O visitante que chega de anúncio lia o site inteiro
sendo convencido e, na última linha, era informado de que ainda não era hora.

**A regra que muda:** de manhã eu escrevi em `config.ts` "no máximo UM CTA
comercial por página", e a home gastava o dela na calculadora. A varredura da
tarde mostrou o custo: quem rola a home inteira chega ao fecho e sai de mãos
vazias — justamente quem leu tudo. **A home passa a ter dois**, o da calculadora
(pico emocional, logo depois de ver a economia dele) e o do fecho (depois do
argumento inteiro), separados por várias telas. A regra continua valendo para
todas as outras páginas, e esta é a única exceção.

**O que ficou travado no código, não no aviso:** um teste varre `/site/**` e
`components/marketing` procurando linguagem de pré-lançamento no texto visível
(`semPreLancamento.test.ts`). A faxina dos "em breve" já tinha sido dada como
concluída uma vez e esta frase sobreviveu — faxina conserta o que alguém lembrou
de olhar; varredura conserta o que ninguém lembrou.

**Corolário, e ele vale para todo produto Dioli:** o guardrail 7 tem duas
direções. Proibimos vender como pronto o que está em piloto, e pelo mesmo motivo
proibimos anunciar como futuro o que já está à venda. Mentira em qualquer direção
custa a mesma confiança. Candidato a subir ao Diretor Geral.

## Convite sem porta: "fale com a gente" só existe se houver com quem falar

**Data:** 2026-08-05 · **Decidido por:** Diretor do Foocci ·
**Origem:** mesma varredura

A frase "Fale com a gente e veja o Foocci no seu restaurante" aparecia em quatro
páginas, sempre como **texto morto, sem link** — e não há telefone, WhatsApp nem
e-mail em lugar nenhum do site (`WHATSAPP_SALES_NUMBER` está desligado em
produção). O visitante que já tinha decidido falar não tinha com quem.

**A regra:** microcopy de contato **descreve o que acontece depois do clique**, e
não convida para um canal que não existe. Quando o número de vendas for ligado, o
convite direto volta — com link de verdade.

## Existe é diferente de vendível — o canal governa o carrinho, não a conversa

**Data:** 2026-08-05 · **Decidido por:** CEO · **Registrado por:** Diretor do Foocci
**Origem:** P0 com cliente real no Sushi Cazza

Uma cliente perguntou duas vezes "vocês tem rodízio" e o agente respondeu "não
encontrei rodízios no nosso cardápio". O restaurante **tem** rodízio: R$ 119 por
pessoa, ativo, marcado como serviço de salão. O catálogo do Garçom só enxerga o
que é delivery.

**A decisão do CEO, nas palavras dele:** *"o rodízio não deve aparecer no cardápio
delivery, mas tem que ter a mesma informação que o agente de WhatsApp tem — o
preço, como funciona, mas é só pessoalmente."*

**A regra que fica, e vale para todo produto:** o recorte de canal governa **o que
pode ir ao carrinho**; não governa **o que o agente pode contar**. Item que a casa
vende só no salão existe para ser CONTADO, nunca para ser VENDIDO no delivery.
Vale para couvert, buffet, self-service, chopp na torneira.

**Dois corolários que custaram caro para descobrir:**

1. **Busca vazia não é negação.** É fato sobre o recorte, não sobre o restaurante.
   Negar um PRATO é permitido; negar que a casa OFERECE, não. A trava mora num
   validador de saída — a frase que a cliente leu estava escrita no código, e a
   instrução equivalente no prompt MANDAVA o modelo negar.
2. **A lista que vira pedido se valida no servidor.** O `finalize` conferia
   `isActive` e `isAvailable` e não olhava o canal: um id de item de salão no
   carrinho viraria pedido de entrega.

**Candidato a subir ao Diretor Geral:** o guardrail 1 tem uma segunda metade que
não estava escrita. "Ausência de informação não é informação" já proibia inferir
negação do silêncio. Falta dizer que **o agente também não pode calar o que a base
SABE** — mandar para um humano uma pergunta que o sistema responde é atendimento
pior, não mais seguro.

## Calar o que se entrega custa igual a prometer o que não se entrega

**Data:** 2026-08-05 · **Decidido por:** CEO · **Registrado por:** Diretor do Foocci

O desconto de 50% do primeiro mês existia, estava cobrado certo e com teste — e o
site **não contava para ninguém**. O mesmo com "funciona no navegador, não é
aplicativo para baixar".

**A regra:** o guardrail 7 tem duas direções. Ele proíbe vender como pronto o que
está em piloto, e pelo mesmo motivo proíbe esconder o que já está entregue.
Mentira em qualquer direção custa a mesma confiança, e o silêncio custa venda.

**Como isso não volta a divergir:** o percentual que aparece no site é DERIVADO da
mesma função que cobra o cartão. Não existe estado em que o site anuncie 50% e o
checkout cobre outra coisa.

## Problema nunca sobe sozinho: no mínimo duas saídas, sempre

**Data:** 2026-08-14 · **Decidido por:** CEO · **Registrado por:** Diretor do Foocci

Ordem literal: *"Sempre que me trouxer um problema, traga junto, no mínimo, duas
soluções. Regra de ouro."*

**A regra:** todo problema apresentado ao CEO carrega no mínimo duas saídas, cada
uma com o que custa, o que arrisca e o que destrava, mais a recomendação do
Diretor dita por extenso. Sem exceção por urgência — se não deu tempo de pensar
em duas, o que subiu não era relatório, era desabafo.

**As duas cláusulas que evitam o teatro:** "consertar ou não consertar" não são
duas saídas, é uma opção e a ausência dela; e quando só há um caminho, isso se
diz com as descartadas nomeadas. A regra obriga a mostrar o percurso, não a
inventar alternativa falsa.

**Por quê:** problema apresentado sozinho transfere ao CEO o trabalho de inventar
a saída — e ele é quem tem menos contexto para isso. Escolher entre duas custa
segundos; inventar a terceira do zero custa a reunião.

Está em `CLAUDE.md` e proposto ao Diretor Geral em
`docs/perguntas-ao-diretor-geral.md` para virar doutrina de todos os projetos.

## Os cargos de Diretor e de PM viram agente despachável

**Data:** 2026-08-14 · **Decidido por:** CEO · **Registrado por:** Diretor do Foocci

Ordem do CEO: *"quero você apenas delegando para os Diretores. Preciso da linha
de produção funcionando hoje."*

Existem agora `.claude/agents/diretor.md` e `.claude/agents/pm.md`, transcritos da
doutrina 29 do kit. **A pasta passou de 12 para 14 arquivos, e dois deles não são
especialistas** — a tabela do `CLAUDE.md` diz isso, porque a Sala dos Agentes
conta a pasta por descoberta automática e já anunciou número errado uma vez.

**O achado que veio junto:** o `CLAUDE.md` mandava o Diretor entregar o pedido ao
PM desde sempre, e **o PM não existia em disco**. A hierarquia estava escrita e
não era executável. Quem achou foi o `cerebro`, ao construir o Diretor.

**A fronteira entre os dois, para não se sobreporem:** o Diretor aplica os seis
campos da ficha ao pedido inteiro, uma vez; o PM aplica os seis a cada tarefa,
com dono, prazo e dependência em cima. Enquadrar é do Diretor; decompor é do PM.

---

## 23/08/2026 — O menu inicial não é do Cérebro, e ninguém tinha percebido

**Achado.** A tela "Menu inicial" (`welcomeMessage` + `menuOptions`) só existe
dentro de `WhatsAppReceptionistService`. Desde 05/08 (`16cf3b5`, o porte da
paridade da Evolution para o webhook da Meta), `InboundAgentDispatch` manda **todo
texto** para o Cérebro salvo em `MENU_ONLY` — e o Cérebro não lê essa configuração.
Ou seja: o modo padrão, chamado `RECEPTIONIST_ONLY`, não chama o recepcionista.

**Regra que fica.** Quando um caminho de entrada é substituído, a pergunta de
aceite não é "o novo caminho responde?" — é **"quais configurações do painel o
caminho antigo lia e o novo não lê?"**. Aqui a paridade foi medida em serviços
acionados (opt-out, carrinho, atribuição, Build OS) e nenhuma linha mediu
*configuração de lojista lida*. Uma tela inteira do produto virou letra morta em
silêncio, e o rótulo dela na interface continuou prometendo o que ela não fazia.

**Segunda regra.** Toda ferramenta de diagnóstico de roteamento tem que conhecer o
conjunto **completo** de handlers. `hostRoutingDiagnostic` só conhece
`TEXT_ORDER | RECEPTIONIST | HUMAN_BLOCKED | IGNORED`; `BRAIN` não existe nela.
Diagnóstico com vocabulário desatualizado não é neutro — ele responde errado com
confiança.

**Não corrigido nesta sessão, e por quê.** O conserto de código muda a porta de
entrada de todos os restaurantes e não há como validá-lo ponta a ponta sem
disparar mensagem no número oficial do Sushi Cazza, ao vivo. O que "Recepcionista"
promete é decisão de dono do produto. Subiu ao CEO com duas saídas e recomendação
(`docs/pendencias.md`, bloco de 23/08).

---

## 23/08/2026 — A tela de configurar o menu passa a dizer quando o menu não é enviado

**Decisão.** A seção "Menu inicial" (`/agente-ia` → WhatsApp Host) exibe uma faixa
de aviso, com botão de troca de modo, sempre que `agentMode !== "MENU_ONLY"`. E as
descrições dos três modos passam a dizer, com todas as letras, qual deles envia o
menu — só o `MENU_ONLY`.

**Por quê.** O CEO relatou que o modo "Menu fixo (sem IA)" *"não aparece"*. A
leitura do código mostrou que ele **aparece** — é o primeiro dos três cartões em
"Status do agente", no commit que roda em produção. O defeito não era ausência de
controle: era **ausência de placa**. A tela aceitava, calada, a configuração de um
menu que naquele modo nunca sai — e ainda descrevia o modo "Recepcionista" como
quem *"exibe opções"*, coisa que ele deixou de fazer em 05/08/2026 (`16cf3b5`).
Tela que aceita configuração inerte sem avisar é a versão de interface do defeito
que esta casa persegue: a caixa certa sem a seta.

**O que não se decidiu aqui.** A Saída 2 (fazer a saudação cair no recepcionista e
o Cérebro assumir do 2º turno) segue aberta — mexe na porta de entrada de todos os
restaurantes e não há caminho de teste que não use o número vivo do sushi.

**Exceção de régua declarada:** `SEM_AGENTE` + `URGENCIA`. O Diretor editou `src/`
sem poder acionar o especialista `interface` nesta execução.
