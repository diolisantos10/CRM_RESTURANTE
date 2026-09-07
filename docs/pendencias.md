# Pendências — o que está aberto

> Última atualização: 07/09/2026.

## ⚠️ 07/09/2026 — Os cinco caminhos voltaram a imprimir; a NFC-e deles ainda não sai

**Consertado hoje** (PR dos cinco caminhos): stone/webhook, stone/mark-paid,
mercadopago/mark-paid, confirm-manual-payment e o pedido por texto no WhatsApp
confirmavam o pedido e nunca enfileiravam a comanda. Agora enfileiram, e um
censo no código (`CensoDosCaminhosQueConfirmam.test.ts`) reprova quem criar o
sexto caminho mudo.

**O que ficou aberto, e por escolha:** esses mesmos cinco caminhos também não
chamam `FiscalEmissionService.maybeEmitForOrder`. É o mesmo defeito — pedido
confirmado sem a nota — e não foi consertado junto **porque a numeração da NFC-e
colide sob concorrência**: no raio-x de 06/09, o número 104 saiu nove vezes em 20
reservas simultâneas, e não existe índice único no banco.

**Por que esperar é o certo aqui:** ligar a emissão em cinco portas novas antes
de consertar a numeração cria um problema fiscal — nota duplicada, difícil de
desfazer — para resolver um problema fiscal. É o guardrail 5 (proteção que
dispara não pode ser mais destrutiva que o problema que evita).

**A ordem, então:** consertar a numeração (índice único + reserva atômica) e, no
mesmo PR ou logo depois, ligar a emissão nos cinco. Enquanto isso não acontece,
restaurante com NFC-e ligada que receba pagamento por esses cinco caminhos fica
sem nota emitida automaticamente — a emissão manual por
`api/orders/[id]/fiscal` continua funcionando.


## ⛔ 05/09/2026 — A cadeia de migrations NÃO reconstrói o banco do zero

**Achado medido, não suposto**, durante a jornada de CI do Comercial P0: rodar
`prisma migrate deploy` contra um Postgres 16 vazio **reprova** na migration
`20250506000000_saipos_integration`, com `relation "orders" does not exist`. Ela
faz `ALTER TABLE "orders"` antes de qualquer migration criar essa tabela.

**O que isso significa, em uma frase:** hoje a empresa **não consegue recriar
este banco a partir do código**.

**Por que ninguém tinha percebido:** em produção o defeito é invisível. As
tabelas já existem, o histórico está marcado como aplicado, e `migrate deploy`
só roda as migrations novas. O defeito dorme até o único dia em que ele importa —
o dia de restaurar, montar um ambiente de homologação, ou recriar do zero. O pior
dia possível é exatamente quando ele acorda.

**⚠️ E ele conversa com um risco já conhecido da casa:** o backup nunca foi
provado por restauração. Um backup que só se restaura para um banco que não pode
ser reconstruído a partir do código é meio backup.

**O que NÃO está em risco:** o deploy normal, e as migrations do Comercial P0 —
elas aplicam sobre banco existente, e isso é provado a cada PR pelo workflow
`jornada-prospeccao.yml`.

**Frente separada, fora do escopo do P0 comercial:** consertar 208 migrations
herdadas não é trabalho de uma noite, e não é o que destrava receita. O caminho
provável é uma migration de linha de base (`baseline`) que descreva o estado
atual, aposentando a cadeia antiga para efeito de reconstrução.

## ⚠️ 05/09/2026 — O teto da prospecção conta lead, não abordagem

Pré-condição para ligar `FOOCCI_SDR_SEND_ENABLED` na prospecção. Hoje o contador
lê leads com `fonte: LISTA_PROSPECCAO` contatados no dia, e não eventos de
abordagem. Enquanto nada envia, é teórico. Ligado, vaza dos dois lados: contato
que já existia na base tem outra `fonte` e não consome teto (a fatia mais
delicada, gente que já nos conhece), e conversa de CRM com lead dessa fonte
consome teto sem ninguém ter prospectado.

Conserto: o caminho de envio registra a abordagem, e o contador lê o evento.
Achado por revisão adversarial antes da estreia; está anotado no próprio código
(`selecao.ts`, `contarAbordagensDeHoje`).

---

> Última atualização anterior: 23/08/2026.


> ⚠️ **Duas numerações de rodada convivem abaixo, e não é engano.** Em 23/08/2026
> dois Diretores trabalharam em paralelo neste repositório e cada um contou as
> próprias rodadas — por isso existem duas "4ª rodada" com assuntos diferentes
> (registro do número na Cloud API × teto de contatos e etiqueta do CRM). Nada
> foi perdido e nenhuma rodada está faltando: o que vale é o assunto de cada
> bloco, não o número.

## 🟢 29/08 — O CRM não fala por cima de um pedido (P0, cliente real)

Bloco `claude/crm-pedido-ativo`. Detalhe em `docs/campanha-nao-atropela-pedido.md`.

Cliente confirmou R$ 74,00 às 18:51 e recebeu campanha de captação com 10% às
18:52; às 18:57 perguntou sobre o pedido e ninguém respondeu. **Não havia regra
errada — não havia regra:** nem `resolveAudience` nem o `ContactSafetyService`
olhavam para os pedidos do cliente.

Consertado com uma regra em três portas (público, envio, conversa). O silêncio era
o pior dos três e tinha causa própria: `markConversationCrmContext` prometia
proteger a conversa de um pedido em andamento por um `contextType` —
`ORDER_SUPPORT` — que **nada no repositório escreve**. A campanha carimbou a
conversa do pedido como `CRM_CAMPAIGN` e `shouldAiRespond` calou a IA.

**Aberto:**
- **`ORDER_SUPPORT` continua órfão.** A trava nova não depende mais dele (olha o
  fato, não o rótulo), mas o crachá "Pós-venda" da Central de Conversas nunca
  acende, e qualquer código futuro que confie nesse rótulo herda a mesma
  armadilha. Duas saídas: (a) escrever `ORDER_SUPPORT` no fluxo do Garçom quando o
  pedido é confirmado; (b) aposentar a constante e o crachá. Recomendação: (a) — o
  crachá é informação útil para o lojista e o custo é uma linha no fluxo de
  confirmação.

## 📚 24/08 — Doutrina registrada: `docs/licoes-o-que-deriva.md`

Do caso da marca: (1) existe defeito que não quebra, **deriva** — e some do radar
por não gerar erro; (2) régua que só cobre a tela conhecida não impede a próxima,
por isso o teste varre o repositório inteiro, **inclusive o arquivo que ainda não
existe**; (3) imitação anda em bando — procure as irmãs, e comece onde tem
dinheiro do outro lado; (4) quando o relato disser que algo *mudou*, **confirme
que mudou** antes de procurar culpado.

As três primeiras servem a mais de um produto (a casa irmã teve caso da mesma
família) — **propostas ao Diretor Geral** em `docs/perguntas-ao-diretor-geral.md`,
não escritas no kit por conta própria.

## 🟢 24/08 (3) — A marca oficial no checkout, e o link para comparar planos

Bloco `claude/checkout-marca-e-link`. Detalhe em `docs/marca-no-checkout.md`.

O CEO viu "mudaram a logomarca" no checkout. **Ninguém mudou:** as três telas de
contratação nasceram com a marca desenhada com texto e CSS (commit `16cf3b5`,
05/08) e nunca passaram pelo arquivo oficial. Consertado com um componente único
(`FoocciWordmark`) e teste de texto impedindo a volta do padrão.

E entrou o link "Ainda em dúvida entre os planos? Compare os três aqui" acima da
escolha do plano — em nova aba, para não apagar o cadastro já digitado.

## 🟢 24/08 (2) — O topo vira Entrar + Assinar (ordem do CEO)

Bloco `claude/topo-entrar-e-assinar`. Detalhe em `docs/topo-entrar-e-assinar.md`.

O botão laranja de conversa saiu do topo; entraram **Entrar** e **Assinar**, este
apontando para `/contratar/novo` — checkout self-service que **cobra de verdade**
(conferido no código e medido de fora antes de escrever o botão). A dúvida foi
para o botão verde do canto, que **passou a aparecer também no celular**, porque a
barra fixa de baixo virou "Assinar".

**Aberto:**
- O painel de WhatsApp do formulário segue dormente — leitura e duas saídas no
  documento do bloco. Recomendação: acender só depois da sala de vendas.

## 🟢 24/08 — O site manda falar com o agente (ordem do CEO)

Bloco `claude/site-fala-com-agente`. Detalhe em `docs/site-fala-com-agente.md`.

Feito: todo botão comercial passa pela porta única `/site/falar-com-agente`, com
interruptor no servidor (`FOOCCI_SALES_WHATSAPP_ATIVO`) — acender o WhatsApp deixa
de exigir build novo. Botãozinho flutuante no canto (desktop, só com o canal no ar).
E a promessa de demonstração personalizada — *"mostra o sistema rodando com o
cardápio do seu restaurante"*, que aparecia no fim de sete páginas e que ninguém
executa — saiu de nove lugares, com teste de texto impedindo a volta.

**Aberto:**
- Ativar quando a Meta verificar o número: `FOOCCI_SALES_WHATSAPP_ATIVO=true`.
- O painel de WhatsApp do formulário segue dormente (lê a variável antiga).
- A contradição do preço (tabela publicada × FAQ) segue com o CEO.

## 🟠 23/08 — SDR do Foocci: diário, cegueiras e o lead chegando à conversa

Bloco `claude/sdr-foocci-liga`. Detalhe inteiro em `docs/sdr-foocci-liga.md`.
**Nenhuma mensagem sai:** `FOOCCI_SDR_SEND_ENABLED` continua desligado.

Feito: diário do SDR (`DiarioDoSdr.ts` + `GET /api/sdr/diario`, fail-closed com
`SDR_DIARIO_SECRET`, sem conteúdo de cliente); motivo nomeado para toda falha de
IA (`FalhaDeMotor.ts`, incluindo `finish_reason: "length"`); origem `motor` × `ia`
em cada campo entendido; e o lead do site virando entrevista (`LeadParaSondagem.ts`).

**Aberto:**
- ~~`/api/sdr/diario` fechado pelo middleware~~ — resolvido: entrou na lista de
  caminhos públicos (só o caminho exato) agora que #137/#138 subiram.
- ~~Diário zerava a cada deploy~~ — resolvido: foi para o banco
  (`sdr_diario_turnos`), retenção de 90 dias.
- **WhatsApp de vendas:** WABA do Sushi Cazza é do cliente (confirmado) — está
  descartada. Passo a passo para o CEO em `docs/whatsapp-vendas-passo-a-passo.md`;
  texto da primeira mensagem em `docs/sdr-primeira-mensagem.md`, **não submetido**.
- Leads antigos não foram semeados — precisa de um script de uma passada.
- Ninguém chama `/api/sdr/entrevista`: o motor segue desligado do mundo.
- Sete perguntas comerciais para o CEO (preço, alçada de fechamento, desconto,
  fidelidade, prazo de implantação, formas de pagamento, prova citável).
- Falta o CEO executar o cadastro do número **+55 11 94372-3316** na Meta e me
  devolver `FOOCCI_SALES_PHONE_NUMBER_ID`, `FOOCCI_SALES_ACCESS_TOKEN` e
  `SDR_DIARIO_SECRET`. **`NEXT_PUBLIC_WHATSAPP_SALES_NUMBER` saiu da lista em
  25/08/2026:** o número foi fixado no código, o site já leva a pessoa ao WhatsApp,
  e a variável só volta a ser necessária para TROCAR de número.
  ⚠️ O que ainda NÃO existe é a **recepção**: hoje o "oi" chega num aparelho e quem
  responde é gente. Sem as duas chaves da Meta, ele não vira registro na Sala de
  Vendas sozinho.

## 🟢 23/08 (8ª rodada) — (A) SUBIU. E duas lições que custaram deploy.

**O CEO autorizou (A) — "pode tudo".** Selo de modelo + trava da janela de 24 h
subiram JUNTOS, como ele decidiu. Consequência que ele já conhecia e aceitou: a
campanha fria para de sair até haver modelo aprovado pela Meta.

### ⚠️ O achado que só apareceu DEPOIS do deploy: a submissão estava sem motor

Lendo o log de boot da produção nova, vi que o `ScheduledCampaignScheduler` — que
virou o **caminho primário** do CRM — chamava apenas `runDueCampaigns`. A submissão
automática de modelo à Meta vivia **só** na rota de cron do GitHub Actions, e nesse
mesmo dia aquele agendamento foi **desligado** porque o Actions está bloqueado por
cobrança.

**Resultado: a submissão ficou sem NENHUM motor.** As 80 frases nunca seriam
enviadas para revisão, e sem modelo aprovado a campanha fria fica bloqueada para
sempre. O buraco era invisível — nada falhava, nada aparecia no log; **só não
acontecia**. É o parente do defeito do dia: ausência sendo lida como normalidade.

Consertado: o tick agora varre os restaurantes `CONNECTED` e submete, como a rota
de cron fazia. Falha na submissão **não derruba** o envio das campanhas (guardrail
5). 4 testes novos, 3 dos quais reprovam contra o código antigo.

**Só encontrei isso porque fui ler o log depois de subir.** A segunda leitura não
serviu para confirmar o que eu já achava — serviu para achar o que eu não sabia.

### ✅ O RESULTADO, medido na própria Meta

Depois do conserto do motor, as duas primeiras passadas do agendador:

```
18:53:20  modelos à Meta: 30 submetido(s), 0 falha(s)
19:05:39  modelos à Meta: 54 submetido(s), 0 falha(s)
```

**84 modelos, 0 falhas** — e a Meta confirma exatamente 84 (`{"PENDING": 84}`,
`templatesRead: true`, `templatesError: null`). **Eram ZERO.** Os textos foram
submetidos como estão, sem uma vírgula mudada.

São 84 e não 80 porque a varredura inclui também as **frases personalizadas** que o
lojista acrescentou, não só as 5 do catálogo de cada campanha — o que é correto: é
o texto que ele de fato usa.

**Por que 30 na primeira passada e 54 na segunda, e não 84 de uma vez:** de
propósito. O sync só rebaixa o modelo fantasma **depois** de ler a Meta por
inteiro, e a lista de trabalho já foi montada antes disso — então as campanhas
restantes entram na passada seguinte. É a ordem segura do guardrail 1: nunca
rebaixar sem ter lido tudo. O sistema se conserta sozinho em dois turnos.

### ✅ E o disparo parou de bater na parede

| erro | antes | depois |
|---|---|---|
| `META_133010` | morria todo envio | **sumiu** (registro do número, 4ª rodada) |
| `META_132001` | morria todo envio | **sumiu** (selo consertado — não escolhe mais modelo fantasma) |

Tick das 18:59–19:00: `CampaignRunner` rodou e **nenhum colapso de canal**. Os
únicos registros de erro na janela são decisões do Cérebro atendendo **cliente
real** (18:55 e 18:59 chegaram mensagens de gente de verdade e o robô respondeu).

⚠️ **Isto NÃO é "a campanha voltou a sair".** A Meta ainda precisa APROVAR os 84
modelos — dias, não minutos. Até lá a campanha fria não sai, e é isso que o CEO
aceitou ao escolher (A). Recusa de texto volta a ele; não vira reescrita nossa.

### O critério das campanhas: a TELA, e fui ler a tela

Ordem do CEO: *"todas as campanhas que estão na tela de campanhas do Foocci estão
todas autorizadas. Ligadas ou não."* Em vez de deduzir da tabela, li:

- `ReadyMadeCampaignService.getStates` faz `READY_MADE_CAMPAIGNS.map(...)`, **sem
  filtro por campanha existente**;
- `ReadyMadeCampaignsSection` renderiza `items.map(...)`, **sem `slice` e sem `filter`**.

**A tela lista as 16 predefinidas sempre**, com `campaignId: null` enquanto ninguém
ligou. As 4 que eu tinha deixado de fora **aparecem** → estão autorizadas →
**80 frases, não 60.**

**Criar campanha foi autorizado, e eu NÃO criei — não era preciso.** A varredura
passou a submeter o modelo direto do catálogo para a predefinida sem campanha:
nenhuma campanha criada, nenhum mapeamento escrito, e portanto **nada que possa
disparar por engano**. Campanha que não existe é a única que não dispara. Quando o
lojista ligar o card, o modelo já está aprovado e a varredura normal só amarra o
mapeamento — zero espera, que é a promessa escrita no topo daquele bloco.

### Os dois "24 horas" no mesmo arquivo — não unificar, nunca

`OrderDraftRecoverySendService.ts` agora tem dois, com significados **opostos**:

| | o quê | onde |
|---|---|---|
| do outro Diretor | intervalo de 24 h entre mensagens de CRM ao mesmo cliente — regra de **frequência**, decide **se** a pessoa pode ser abordada | **antes** do envio, regra 11 da elegibilidade |
| meu | janela de 24 h de atendimento da Meta — decide **como** a mensagem sai (texto livre × modelo aprovado) | **dentro** do envio |

Parecem duplicados e não são. **Unificar mata um dos dois em silêncio** — exatamente
o defeito que passamos o dia caçando. Conferido linha a linha depois de cada um dos
três merges; os dois seguem vivos e separados.

### ⚠️ Lição 1 — o diretório de trabalho é COMPARTILHADO entre sessões

No meio do bloco, outra sessão trocou a branch do `/home/user/foocci` debaixo de
mim: o reflog mostra `checkout: moving from claude/registrar-numero-cloud-api to
claude/raiz-site-comercial`. Editei por alguns minutos **na branch do outro
Diretor** sem perceber — o sintoma foi um arquivo de teste que "perdeu" 12 testes.

O que salvou: meu trabalho estava **commitado e empurrado**, então nada se perdeu.
Devolvi a árvore dele ao estado limpo e passei a trabalhar num **`git worktree`
separado** (`/home/user/foocci-diretor`), que é o jeito certo de duas sessões
dividirem um repositório.

**Regra para quem vier depois: confira `git branch --show-current` antes de editar,
e trabalhe em worktree próprio quando houver outra sessão viva no repositório.**

### ⚠️ Lição 2 — o symlink do worktree derrubou o build (erro meu)

Liguei `node_modules` do worktree ao do checkout principal por symlink. O
`.gitignore` tinha `node_modules/` **com barra**, que casa apenas **diretório**;
symlink é **arquivo**, escapou do padrão e o `git add -A` o commitou. O build do
Railway morreu com:

```
Build Failed: cannot replace to directory /app/node_modules with file
```

**Produção não caiu em momento algum** — o deploy falhou no *build*, então o serviço
seguiu servindo o deploy anterior. O que não subiu foi a minha mudança. Corrigido
nos dois lados em paralelo (o outro Diretor chegou junto); ficou a versão da branch
de deploy, que cobre `node_modules` **e** `node_modules/`.

**A lição é do `.gitignore`, não do symlink:** a prática de symlinkar node_modules
em worktree é boa; o que faltava era o padrão segurá-la.

## 🟢 23/08 (7ª rodada) — (A) autorizada pelo CEO. Pacote PRONTO e PARADO antes do merge.

**Decisão do CEO: opção (A) — selo + trava da janela de 24h JUNTOS.** Consequência
aceita por ele: a campanha fria para de sair até haver modelo aprovado pela Meta.
É o que a regra da Meta já manda.

**⛔ NADA FOI MERGEADO.** Há outro Diretor subindo antes, com o pacote de CRM que
mexe no MESMO caminho de envio (teto de contatos em 3000, etiqueta "Resposta CRM",
recuperação de carrinho, cadeado do modo seguro). O combinado é esperar o aviso,
trazer a branch de deploy para dentro desta, resolver colisão, **rodar a suíte
inteira de novo** (verde de antes do rebase não vale) e só então subir.

### Cobertura da submissão — ampliada, e o limite honesto dela

A varredura olhava só `status: ACTIVE`, o que brigava com a promessa escrita no
próprio bloco ("submeter o catálogo de antemão para que a frase ligada depois JÁ
esteja aprovada"): campanha pausada ou concluída ficava sem modelo, e no dia da
reativação o lojista esperaria dias com a campanha ligada e nada saindo. Agora
varre tudo que **não** é `CANCELLED`.

Efeito medido contra a produção (51 campanhas lidas por `admin/diagnostics/crm-campaigns`):

| | frases |
|---|---|
| catálogo completo (16 campanhas × 5) | 80 |
| **serão submetidas** — 12 predefinidas com campanha nesta loja | **60** |
| não submetíveis — 4 predefinidas **sem campanha criada** | 20 |

As 4 de fora (`pedido-avaliacao`, `subiu-de-nivel`, `quase-no-proximo-nivel`,
`mimo-mensal-nivel`) **não têm linha de campanha nesta loja** — não há o que varrer.
Criar campanha no lugar do lojista não é decisão de Diretor. **Fica para o CEO.**

### Bug achado ANTES de disparar 60 de uma vez — e é o mesmo erro de novo

O mapa `audienceConfig.metaTemplates` era preenchido **antes** da tentativa e
gravado no fim **mesmo para a frase cujo `createOnMeta` FALHOU**. Como é esse mapa
que o `work` consulta para decidir "já submeti", **a frase falhada era dada como
pronta e nunca mais tentada** — intenção registrada como realização, o mesmo erro do
selo um andar abaixo.

Passava despercebido com 5 frases por vez. Com **60 de uma vez**, esbarrar no limite
de criação da Meta deixa de ser exceção — e cada falha viraria uma frase morta em
silêncio. Agora só entra no mapa a frase que **de fato chegou** na Meta; a que falhou
volta na passada seguinte do cron. 2 testes travam isso.

### Limites da Meta: continuam SEM confirmação

Não consigo verificar os tetos de modelo por conta nem o limite de criação por hora:
não tenho token do Graph aqui e o repositório não documenta nenhum dos dois.
**Preciso confirmar.** A mitigação é o conserto acima: se bater no limite, a fila
continua e o cron termina o serviço nas passadas seguintes, em vez de perder frases.

## 🟠 23/08 (6ª rodada) — a resubmissão automática estava CONGELADA em três camadas. E não dá para submeter daqui.

### O catálogo, medido na fonte canônica

`READY_MADE_CAMPAIGNS` + `READY_MADE_MESSAGE_VARIANTS` (`src/services/crm/readyMadeCampaigns.ts`):

| | |
|---|---|
| campanhas predefinidas | **16** |
| frases por campanha | **5** (todas as 16) |
| **total de frases no catálogo** | **80** |
| campanhas com modelo configurado (`TEMPLATE_CONFIG`) | **16 de 16** |

Nenhuma órfã nos dois sentidos: não há chave de `TEMPLATE_CONFIG` sem campanha, nem
variante sem campanha. A linha do cupom **não dobra** a conta — `listPoolCandidates`
devolve uma versão por frase, com ou sem cupom conforme a campanha.

### ⛔ NÃO CONSEGUI SUBMETER. Três bloqueios independentes, todos verificados

1. **Nenhuma rota de admin cria modelo na Meta.** Varri `src/app/api/admin/` inteiro:
   nada chama `createOnMeta`, `provisionPoolTemplates`, `provisionDefaultTemplates`
   nem `syncFromMeta`. O `ADMIN_SECRET` não abre este caminho porque ele não existe.
2. **As rotas que submetem não são alcançáveis daqui.** `crm/campaigns/[id]` e
   `integracoes/whatsapp/meta/templates` são de inquilino — exigem os cabeçalhos que
   o middleware injeta a partir do JWT do NextAuth, que não dá para forjar.
   `cron/run-scheduled-campaigns` e `cron/crm/create-custom-campaign` exigem
   `CRON_SECRET`, e o Railway devolve **valores redigidos** para esta conexão.
3. **O GitHub Actions — o jeito da casa de ler segredo do Railway dentro do runner —
   continua caído.** Última execução de `CI`: 16:24, `failure`. Todas falham em ~3s
   sem runner desde ~09:32.

**Honestidade sobre capacidade (guardrail 2): nenhuma frase foi submetida nesta
rodada. Nem as 5, nem as 80.** Não há duplicata a evitar porque não houve envio
nenhum.

### O que DESTRAVEI — a máquina que faz isso sozinha existia e estava congelada

`provisionPoolTemplates` roda **a cada passada do cron** e submete as frases de toda
campanha ativa. Mesmo assim nada era submetido há tempos, por **três camadas do mesmo
erro** — tratar estado local como prova do estado da Meta:

1. **`work` vazio.** O mapa `audienceConfig.metaTemplates` estava completo, e mapa
   completo era tratado como prova de que os modelos existem. Mapa só prova que um
   dia foram submetidos. → agora frase cujo modelo está `MISSING` volta para a fila.
2. **Releitura só com `PENDING`.** Com tudo (falsamente) `APPROVED`, o galho devolvia
   "nada a fazer" e **nunca falava com a Meta** — não havia gatilho capaz de
   descongelar o espelho. → agora relê também quando a última leitura passou de
   **12 horas** (`updatedAt` como "quando li pela última vez"; custo: 2 leituras por
   loja por dia).
3. **`existingNames` da tabela local** contava linha `MISSING` como "já existe" e
   pulava justamente o modelo a recriar (corrigido na 5ª rodada).

**6 testes novos** cobrem as três camadas, incluindo os dois casos em que NÃO se deve
gerar tráfego. Conferido: **3 reprovam contra o código antigo**.

### O que a máquina vai submeter quando subir — e o que fica de fora

Lido da produção agora (`admin/diagnostics/crm-campaigns`, 51 campanhas):

- **11 ACTIVE**, das quais **10 são campanhas predefinidas** → **50 frases** seriam
  submetidas na primeira passada do cron depois do merge.
- **Ficam de fora 6 campanhas (30 frases)**, porque a varredura só olha `status:
  ACTIVE`: `clientes-vip` (PAUSED), `carrinho-abandonado` (COMPLETED),
  `pedido-avaliacao`, `subiu-de-nivel`, `quase-no-proximo-nivel`,
  `mimo-mensal-nivel` (sem campanha criada).

**Não estendi a varredura para o catálogo inteiro** — é decisão de quota, não de
código: 80 submissões de uma vez contra limites da Meta que **não consigo verificar
daqui** (não tenho token do Graph, e o repositório não documenta os tetos).
**Preciso confirmar** os limites antes de disparar tudo.

### Trava da janela de 24h — escrita, testada, NÃO mergeada

⚠️ **E aqui eu preciso corrigir o que reportei na 5ª rodada.** Eu disse que o disparo
de CRM não consultava a janela de 24h. **Estava errado, e a correção importa:**
`ScheduledCampaignRunnerService` e `CrmCampaignService` passam o
`WhatsAppMessagingService`, que **aplica** a janela dentro do próprio `sendText`.

O buraco era **outro, e mais estreito**: a **recuperação de carrinho**
(`OrderDraftRecoverySendService:795`) passava o provedor **CRU**
(`new MetaWhatsAppCloudProvider()`). Sem modelo aprovado, o texto livre saía direto
para a Meta **sem checar janela nenhuma** — e o comentário logo acima jurava que
"fora dela ele volta BLOCKED e isso é contado", promessa que só valia para o outro
galho. Guardrail 4 na veia.

Consertado em dois níveis:
- o chamador passa o provedor que checa a janela, e trata `BLOCKED` como política
  (contado e registrado), não como exceção genérica que viraria retentativa;
- **a trava mora no ponto de estrangulamento**: `metaCrmSend` agora **recusa** texto
  livre por provedor que não declare `enforcesCustomerWindow`. A segurança deixou de
  depender de cada chamador lembrar de passar o objeto certo — que foi exatamente o
  jeito como esse buraco nasceu. Nenhum 4º chamador consegue repetir o erro.

3 testes novos; **1 reprova contra o código antigo**.

## 🔴 23/08 (5ª rodada) — o selo "✓ META APROVADA" estava MENTINDO. Achei o mecanismo exato.

O CEO mostrou a tela de campanha com **cinco frases, todas com selo verde
"✓ Meta aprovada"** — enquanto a Meta recusava todo envio. Dois instrumentos, uma
mentira. Era o selo.

### O que provei, lendo — não deduzindo

**1. O selo lê UMA fonte só, e ela é local.**
`CRMClient.tsx:2160` desenha o selo a partir de `phraseMeta.status`, que vem de
`GET /api/crm/campaigns/[id]/phrase-stats`. Essa rota (linha 60) lê a tabela
**`metaMessageTemplate` do nosso banco** — não a Meta.

**2. Ninguém escreve `APPROVED` à mão.** Varri todos os escritores: o
provisionamento (`MetaTemplateProvisionService:193,306,419`) e a criação de
campanha custom (`cron/crm/create-custom-campaign:53`) gravam **sempre `PENDING`**.
O único código que escreve `APPROVED` é `MetaTemplateService.syncFromMeta()`, que
copia a resposta da própria Meta. **Ou seja: o selo não foi forjado — ele foi
verdadeiro um dia.**

**3. O defeito era o sync só saber SOMAR.** `syncFromMeta` fazia `upsert` de tudo
que a Meta devolvia e **nada** com o resto. Modelo que a Meta parava de listar
— conta trocada, ou apagado lá — **ficava `APPROVED` no banco para sempre**.
Nenhuma rotina reconferia: `syncFromMeta` só roda no provisionamento e quando o
lojista abre a tela de modelos. **Não existe cron de sincronização.**

**4. A prova de que a linha local ainda dizia `APPROVED` hoje** — vinda da Meta,
não do nosso banco: o disparo morreu com **`META_132001`**, e não com
`META_TEMPLATE_REQUIRED`. Isso é decisivo:
- `META_132001` é a Meta respondendo *"esse modelo não existe"* a um envio de
  modelo (`MetaWhatsAppCloudProvider:82` monta `META_${code}` da resposta crua).
- Para chegar lá, `findApproved()` (que exige `status: "APPROVED"`) **encontrou**
  uma linha aprovada e mandou o modelo.
- Se a tabela não tivesse linha aprovada, o disparo teria caído em texto livre e
  o bloqueio seria local, sem nunca falar com a Meta.

> **Veredito: é o (b) — selo local que ninguém reconfere.** O (a) — modelos
> aprovados terem ficado na WABA antiga — é a causa mais provável da defasagem,
> e casa com o número ter mudado de conta. Mas **não consegui ler a WABA antiga**
> (as variáveis do Railway vêm redigidas para esta conexão e não há rota que liste
> as WABAs do portfólio): **preciso confirmar**.

### Consertado nesta rodada

1. **`syncFromMeta` agora também APAGA** (`MetaTemplateService`): o que a Meta não
   listou numa varredura completa deixa de valer como aprovado — vira `MISSING`.
   Duas travas em cima disso:
   - **só reconcilia em varredura COMPLETA e bem-sucedida** — erro no meio da
     paginação, ou paginação truncada no teto de 10 páginas, **não rebaixa
     ninguém** (guardrail 1: meia-leitura não é veredito);
   - **só rebaixa linha `APPROVED`** — o único status que destrava envio e que faz
     o produto afirmar algo ao lojista. `PENDING`/`REJECTED` já são honestos.
2. **`MISSING` não é "rejeitado".** A Meta não reprovou nada; ela não conhece o
   modelo naquela conta. O selo novo diz **"✗ Não existe na Meta"**, com explicação
   ao passar o mouse. Chamar de reprovação mandaria o lojista consertar um texto
   sem defeito.
3. **Beco sem saída fechado:** `provisionDefaultTemplates` montava a lista de "já
   existe na Meta" a partir da tabela local. Uma linha `MISSING` seria contada como
   existente e o modelo **nunca** seria recriado. Agora `MISSING` é filtrado — é
   exatamente o que precisa voltar a ser submetido.
4. **O diagnóstico parou de confundir "zero" com "não consegui ler".**
   `admin/meta/diag` fazia `?? []` em cima da resposta de modelos: erro da Meta
   virava **"0 templates"**. Isso me custou meia investigação hoje. Agora sobem
   `templatesRead` e `templatesError` separados, e o `meta-raiox` imprime
   "NÃO DEU PARA LER" em vez de zero.
5. **8 testes novos** travam tudo isso, incluindo os quatro casos em que rebaixar
   seria errado. **Conferi que eles reprovam contra o código antigo** (5 de 8
   falham) — teste que passa nos dois lados não prova nada.

### Resto pequeno, anotado para não virar mentira nova

- **`DISABLED` ainda cai no selo cinza "Meta: na fila".** É a mesma classe de
  defeito (o selo afirma algo que não conferiu): `DISABLED` quer dizer que a Meta
  **pausou** o modelo por qualidade, não que ele está na fila. Não consertei junto
  porque `metaBadge` é um fechamento dentro do componente e **não tem como ser
  testado sem refatorar** — e regra da casa é "sem portão = reprovado". Conserto
  de verdade = extrair a função e travar com teste.
- **O selo não diz QUANDO foi conferido.** Mesmo correto, ele é uma foto do último
  sync, que só roda quando alguém abre a tela de modelos. Um `checkedAt` ao lado
  do selo resolveria — não está feito.

### ⛔ ANTES DE MERGEAR: este conserto MUDA o comportamento do disparo

Hoje o disparo tenta modelo e morre em `META_132001` — **nada sai**. Com o selo
corrigido, não haverá modelo aprovado, e `sendMetaCrmMessage`
(`metaCrmSend.ts:138`) **cai em texto livre** — que a Meta entrega para quem está
dentro da janela de 24h e recusa para o resto.

**E aqui está o achado que ninguém tinha visto:** o caminho de CRM **não consulta
a janela de 24h**. `decideMetaSend` — a função que existe justamente para isso —
é usada **só** em `WhatsAppMessagingService`, **nunca** no disparo de campanha.
O comentário do código diz "valid only inside the 24h window"; **nada trava**.
É o guardrail 4 da casa ("prompt é aviso; código é trava") aberto no caminho que
fala com cliente. **Não consertei por conta própria** — barrar envio que hoje
funciona é decisão de dono, não de Diretor. Item para o CEO.

## ✅ 23/08 (4ª rodada) — o `META_133010` foi curado na raiz: o número está REGISTRADO na Cloud API

A rodada anterior nomeou o defeito; esta fechou. O número oficial do Sushi Cazza
estava na WABA e o painel dizia "conectado", mas ele **nunca tinha sido registrado
no runtime da Cloud API**. A Meta respondeu ao CEO com todas as letras: *"A conta
não existe na API de Nuvem. Use /register API para criar uma conta primeiro."*

**A prova, lida da própria Meta, antes e depois** (`GET /api/admin/meta/diag`,
restaurante `cmp30upkp000198i4r8wpxdl1`, número `••••0131`):

| campo | antes | depois |
|---|---|---|
| `platform_type` | `NOT_APPLICABLE` | **`CLOUD_API`** |
| `status` | `PENDING` | **`CONNECTED`** |

O `POST /api/admin/meta/register` devolveu `registered: true` e `resubscribed: true`
(nosso app reassinado na WABA na mesma chamada).

**Não havia risco para o aparelho do restaurante.** O diagnóstico de antes trouxe
`coexistence: false` e `is_on_biz_app: false` — o número **não** estava vivo num
celular. Ainda assim, `force: true` **não foi enviado** e o caminho não expõe opção
para enviá-lo: a rota recusa registrar número em coexistência de propósito
(`src/app/api/admin/meta/register/route.ts:86-91`), porque o `/register` arrancaria
o número do aparelho. Ordem do CEO: *"não posso prejudicar o sushi"*.

### A prova de que a cura pegou no CRM — o erro MUDOU

O `CampaignRunner` roda de ~10 em ~10 minutos e vinha morrendo sempre igual:

- **16:38:43** — `channel collapse … lastError: 'META_133010'`
- **16:48:43** — `channel collapse … lastError: 'META_133010'`
- *(registro do número, ~16:50)*
- **16:58:46** — `channel collapse … lastError: **'META_132001'**`

`META_133010` **não aparece mais**. O canal agora **chega na Meta** e leva um erro
diferente. Isso é progresso real: era "a conta não existe na API de Nuvem", agora é
outra coisa.

### ⚠️ A parede seguinte, já identificada: a WABA não tem NENHUM template

`META_132001` é "template não existe / não aprovado". E o diagnóstico confirma o
porquê, sem palpite:

```
platform_type: CLOUD_API | status: CONNECTED | quality: GREEN
messaging_limit_tier: TIER_250 | account_mode: LIVE
templates por status: {}   ← vazio
aprovados: 0
```

**Zero templates — nem aprovado, nem pendente, nem reprovado.** Nunca foi submetido
template nesta WABA. Campanha de CRM que fala com quem está fora da janela de 24h é
mensagem iniciada pelo negócio, e a Meta **exige** template aprovado. Sem template,
nenhuma campanha sai — por mais registrado que o número esteja.

**Isso é bloco novo, não resíduo deste.** Criar e submeter template é ato que passa
pela revisão da Meta (dias, não minutos) e o TEXTO que vai ao cliente é decisão do
CEO, não do Diretor.

### A ferramenta, para a próxima vez

- `scripts/registrar-numero-cloud-api.mjs` + `.github/workflows/registrar-numero-cloud-api.yml`
  (branch `claude/registrar-numero-cloud-api`, commit `8b601d1`).
- Lê o `ADMIN_SECRET` do Railway **dentro do runner** — mesma mecânica de
  `meta-raiox.mjs` e `acompanhar-assistente.mjs` — e nunca o imprime.
- **O PIN de 6 dígitos é derivado**, não digitado: `sha256(ADMIN_SECRET + ":foocci-waba-pin-v1")`,
  primeiros 6 dígitos decimais. Não é input do workflow e não é impresso — o log do
  Actions deste repositório é **público**. Reproduz-se rodando a mesma derivação, se
  a Meta pedir o PIN depois.
  > ⚠️ Rotacionar o `ADMIN_SECRET` **muda o PIN derivado, mas não muda o PIN gravado
  > na Meta**. Depois de uma troca, o PIN antigo só se recupera derivando do segredo
  > ANTIGO. Está escrito no cabeçalho do script.
- Lê o `diag` **antes e depois**: sem a segunda leitura não há prova. `registered: true`
  é o que a rota disse; `platform_type` é o que a Meta mostra.

### ⛔ O que ficou aberto nesta rodada, e é grande

**O GitHub Actions deste repositório está caído — TODOS os workflows, não só o novo.**
Toda execução desde pelo menos 12:54 de 23/08 termina em `failure` em ~3 segundos,
**sem runner alocado** (`runner_id: 0`), sem passos e sem log para baixar. Caem igual
`CI`, `CRM Cron`, `Agent Library Deep Extraction Processor` e o workflow novo. A
assinatura — nenhum runner, falha imediata, log inexistente — é de **bloqueio de
conta/cobrança do Actions**, não de defeito de workflow. **Preciso confirmar** na
tela de billing do GitHub; não dá para ler isso pela API.

Por isso o registro desta rodada foi feito **por chamada direta à produção**, não
pelo workflow. O workflow fica publicado e correto para quando o Actions voltar.

**Consequência que passa despercebida:** com o Actions parado, todo cron deste
repositório está parado junto.
## 🔴 23/08 (4ª rodada) — o teto de contatos era enfeite, e a etiqueta "Resposta CRM" mentia

Dois prints do CEO, dois defeitos, **raízes diferentes** (a hipótese de que fossem
um só foi verificada e **descartada** — as duas contas não usam a mesma definição).

### (1) "As informações divergem": teto de 200, 2115 pessoas já abordadas

**Não era rótulo errado — era trava ausente, e ela estava desligada de propósito.**
Os dois números medem a MESMA coisa: pessoas diferentes com envio de CRM
bem-sucedido em `campaign_executions` (SENT/DELIVERED/READ), na vida toda. Nenhuma
rota de importação escreve nessa tabela, então base importada **não** infla a conta.

O que faltava: `contactBudgetTotal` era lido pela tela, pela API de configurações e
pelo previsor de capacidade — **e por mais ninguém**. `getContactBudgetStatus()` em
`src/lib/crm-safety.ts` não tinha **um único chamador**. E o runner carregava a
confissão escrita (`ScheduledCampaignRunnerService`, antes do `slice(0, batchCap)`):
*"Contact limit — INFORMATIONAL ONLY (not enforced in the runner)"*. O portão antigo
existiu, derrubava a **campanha inteira** (calava também quem já era da casa), foi
desligado por isso — e o desligamento virou permanente enquanto a tela **e o guia do
lojista** seguiam prometendo *"o CRM para de abordar gente nova"*.

**Consertado:** a trava voltou no lugar certo — `ContactSafetyService`, **por
destinatário**, motivo `CONTACT_BUDGET_EXHAUSTED`. Ela barra **só quem é contato
novo** (quem consome vaga); quem já está na conta continua recebendo. Vale para
aniversário também: aniversário é isento de frequência, não de custo. Teste:
`src/services/crm/tests/CrmTetoDeContatos.test.ts`.

**⚠️ Efeito imediato em produção:** com o teto em 200 e 2115 já abordados, o CRM do
Sushi Cazza **para de abordar pessoas novas** assim que isto subir. É o alarme
funcionando, não um defeito novo — mas **quanto vale o teto é decisão do CEO** e não
foi mexido (não subi para 2115 nem zerei).

### (2) "Resposta CRM" em 10 de 10 conversas

**Duas metades erradas, nenhuma delas compartilhada com o contador acima:**
- *"foi abordada?"* respondia `Conversation.contextType` — campo **único**, gravado
  no envio, que **nunca expira** (só some quando o cliente compra). Abordado em
  julho = etiquetado para sempre. Na aba "CRM enviado" era pior: `crmSent` saía
  `Boolean(crm)`, verdadeiro **por construção** para toda linha da aba;
- *"respondeu?"* respondia "existe QUALQUER mensagem de entrada" — sem olhar data,
  então até mensagem **anterior** ao envio contava.
- de quebra, `getCrmSentCustomerIds` contava linhas `REVIEW_REQUEST_FAILED` e
  `REVIEW_REQUEST_SKIPPED` como "CRM enviado" — registros de que **nada saiu**.

**Consertado:** regra pura em `src/services/conversation/crmReplyBadge.ts` — a
etiqueta exige log de envio REAL **e** que a **última** mensagem do cliente tenha
vindo depois dele, dentro de **7 dias** (a mesma janela que `markCrmReplyIfApplicable`
já usa; não inventei régua nova). Apurado no servidor (`crmRepliedAt`,
`lastCrmSentAt`), consumido pela tela. Teste com o caso Larissia:
`src/services/conversation/crmReplyBadge.test.ts`.

### Decidido pelo CEO em 23/08 — *"pode tudo, teto 3000"*

- **Teto do Sushi Cazza = 3000** (2115 abordadas → **885 vagas**). Não é "sem
  limite": o alarme continua de pé. ⚠️ **O valor se aplica na tela** (CRM → Regras
  de Segurança → *Máximo de pessoas* → 3000 → Salvar). **Eu não apliquei**: não
  tenho acesso ao banco de produção e não vou escrever num JSON de configuração de
  cliente por fora do produto.
- **Padrão de produto para restaurante NOVO continua 0 (sem teto)** — não mexido, a
  decisão foi sobre o Sushi Cazza. Travado em teste para não mudar por descuido.
  **Recomendação registrada:** o padrão deveria deixar de ser 0. Restaurante novo
  nasce sem alarme nenhum, e o alarme só serve se estiver ligado antes de o
  problema acontecer. Decisão de produto — não tomei.
- **Cadeado separado.** O teto saiu de trás do *"Assumir controle manual"*: é limite
  de gasto, não regra anti-banimento. As regras anti-banimento **continuam trancadas
  exatamente como estavam**. O servidor já estava certo; quem mentia era a tela.
- **Recontagem/limpeza de histórico:** não fiz e não proponho fazer sem ordem — dado
  de cliente é irreversível. O diagnóstico
  `GET /api/admin/diagnostics/crm-etiqueta-resposta` (somente leitura) devolve os
  números reais: etiquetas pela regra antiga × nova, e teto × pessoas abordadas.

### (3) A recuperação de carrinho estava fora do portão — CONSERTADA (CEO autorizou)

`OrderDraftRecoverySendService` nunca passou pelo `ContactSafetyService`. Tinha só
as guardas próprias (1 por rascunho, 1 por cliente/dia, carimbo atômico, loja aberta
no abandono) — e por isso **três das quatro "proteções sempre ativas" não valiam ali**:
quem pediu para sair **recebia** (LGPD), a janela de silêncio 21h–8h era ignorada
(loja aberta às 23h = mensagem às 23h) e o intervalo de 24 h entre mensagens de CRM
não era consultado (campanha de manhã + recuperação à tarde).

**Consertado:** regra 11 no laço por destinatário — o portão unificado passou a ser
chamado com `enforceTimeWindows: true`, `enforceDailyCap: false` (a isenção do teto
diário é decisão registrada: *"medir não pode custar envio"*) e
`enforceRestaurantOpen: false` (a regra 9 já responde melhor, perguntando pelo
instante do abandono). `campaignId: null` **de propósito**: passar o id da campanha
do carrinho ligaria o dedup vitalício "já recebeu ESTA campanha" e transformaria
"uma por cliente por dia" em "uma por cliente para sempre".

As guardas próprias continuam valendo — **somou, não trocou**. Rascunho bloqueado
**não é carimbado**: ele não é queimado por um bloqueio que pode passar no próximo
tick. Bloqueio não grava linha em `campaign_executions` (o cron roda a cada minuto;
seriam dezenas de linhas idênticas do mesmo carrinho). Contador próprio no resultado:
`skippedSafety`.

> ⚠️ **CORRIGIDO NO MESMO DIA — eu tinha exagerado.** Junto com o opt-out entraram
> as regras de ABORDAGEM (silêncio 21h–8h, intervalo de 24 h, teto semanal) e isso
> foi erro: recuperação de carrinho é **resposta** a um ato do cliente, não
> abordagem. Saíram as três; **o opt-out ficou**. Ver a decisão de 23/08 "Resposta
> não é abordagem" em `docs/decisoes.md`, e o bilhete longo na regra 11 do
> `OrderDraftRecoverySendService`.

**Os números reais do disparo, lidos no código** (o CEO perguntou; o diagnóstico
falava só em 30 min e parecia contradizer os "2 minutos" dele — não contradiz):

| O quê | Valor | Onde |
|---|---|---|
| Dispara depois de | **2 min** sem atividade no carrinho | `INACTIVITY_MINUTES` / `inactivityMinutes = 2` |
| Cadência do robô | a cada **1 min** | `TICK_INTERVAL_MS = 60_000` |
| Janela para sair | **30 min** a contar do abandono | `JANELA_DE_ENTREGA_MINUTOS = 30` |
| Idade máxima na busca | **6 h** | `MAX_AGE_HOURS = 6` |

Os dois números são verdadeiros e não brigam: **2 min é quando o carrinho fica
elegível; 30 min é por quanto tempo ele continua elegível.** Passou dos 30, não sai
nunca mais — não há fila.

**O intervalo de 24 h do CRM era duplicata?** Na parte que protegia, sim: a regra 5
do próprio fluxo (`lastRecoveryAt`, uma por cliente a cada 24 h, global entre
restaurantes) já limitava repetição, e melhor. O que ele acrescentava era só deixar
uma campanha da manhã matar a recuperação da noite.

**Teste:** `src/services/order/tests/CartRecoveryTravasDoCrm.test.ts`, 13 casos, cada
proteção nas duas metades. **Conferido que reprova contra o código antigo:** com o
portão desligado, as **7** metades "NÃO MANDA" falham e as 6 metades "MANDA"
continuam passando.

**Preço do conserto:** `GET /api/admin/diagnostics/carrinho-travas` (somente leitura)
recalcula o passado e diz quantas recuperações por semana deixam de sair, e por qual
trava. Sem banco de produção eu **não posso** dar o número — e não vou estimar.

---

## 🟢 23/08 (3ª rodada) — "por que o Foocci cita a Evolution?" É texto velho. Mas achei o que estava por baixo.

O CEO mandou o print de **Gerenciar campanha → Diagnóstico** ("Bem-vindo / 2ª compra"):
*"A maioria são erros temporários da **Evolution**/conexão"* e *"Falhas temporárias
(**Evolution 5xx**, timeout)"*. **Fui ao código, não deduzi.** Veredito: **(A) texto velho.**

**A Evolution NÃO está viva.** Prova, em três camadas:
- `src/services/whatsapp/providers/types.ts:22` — `WhatsAppProviderId = "META_CLOUD_API"`,
  **um valor só**: reintroduzir segundo canal é erro de compilação, não configuração.
- `src/services/whatsapp/activeProvider.ts:25-27` — devolve `MetaWhatsAppCloudProvider`
  incondicionalmente. Não há ramo, fallback nem consulta a banco.
- `src/services/evolution/` **não existe**; não há `EvolutionClient` em `src/`.
- **Railway** (projeto Foocci, serviço `FOOCCI`, `production`): **zero** variáveis da
  Evolution entre as 39 configuradas. Confirmado hoje, na fonte.

### O que estava por baixo do texto velho — e vale mais que ele

A **gaveta de erro** era o ponto cego: `crmExecutionClassification.ts` nomeava só
`META_190`, `META_NOT_CONNECTED` e `META_TEMPLATE_REQUIRED`. Todo o resto caía no
`default` (`linha 163`, `startsWith("META_")`) → `FAILED_PROVIDER`, cujo rótulo era
literalmente **"Erro temporário do WhatsApp"**.

**E o erro que está saindo AGORA é o `META_133010`** (mesmo dia, mesmo log do item
abaixo: `channel collapse … lastError: 'META_133010'`, 15:19 de 23/08). Ele **não é
temporário**: é o número não registrado no runtime da Cloud API — só o `/register`
com PIN resolve. Os **78 "erro temporário do WhatsApp"** do print são quase certamente
ele. A tela dava ao CEO um culpado que não existe (Evolution) e uma natureza errada
(temporário) para o defeito que está de pé.

**O teste dessa gaveta exercitava SÓ códigos `EVOLUTION_HTTP_*`** — códigos que o
sistema não produz mais. A classificação dos códigos reais da Meta não tinha **uma
única trava**.

### Consertado nesta sessão

1. **Rótulos honestos** (`crmExecutionClassification.ts`): "Erro temporário do
   WhatsApp" → **"Erro do WhatsApp (Meta)"**; "Instância desconectada" → **"Canal do
   WhatsApp fora do ar"**; "Bad request (400)" → **"Número recusado pela Meta (400)"**;
   "Rate limit" → **"Limite de envio da Meta"**.
2. **`META_133010` nomeado** → `EVOLUTION_INSTANCE_DISCONNECTED` (falha de CANAL).
   ⚠️ **De propósito continua `RETRYABLE_LATER`**: virar "Precisa corrigir" faria
   `saiDaFilaParaSempre()` **queimar a audiência inteira** de toda campanha que rodou
   durante a queda — eles nunca mais receberiam depois do registro. Comportamento
   idêntico ao de antes; o que mudou é o que a tela diz.
3. **Textos da tela** (`CRMClient.tsx`): as duas frases do print, mais "Modo seguro
   WhatsApp Web" (vocabulário de sessão Web, que saiu com a Evolution) em
   `CRMClient.tsx` e `settings/marketing/page.tsx`, e "sem Evolution" no simulador admin.
4. **Rótulos crus** `META_133010 / META_NOT_CONNECTED / META_190 / META_TEMPLATE_REQUIRED`
   ganharam texto em português em `FAILURE_REASON_LABELS`.
5. **4 testes novos** travam: código da Meta cai na gaveta certa, código não nomeado
   **nunca** vai para a exclusão automática de cliente, e **nenhum rótulo diz "Evolution"**.

### Os números do print NÃO se contradizem — a tela é que não avisava direito

**176 público total** vs **501 telefone inválido** vs **149 já receberam**: são **dois
universos**.
- 176 / 149 / 27 vêm de **`debug.audience`** — consulta **ao vivo** do segmento agora.
- 501 / 78 / 16 / 1 vêm de **`campaign.executions`** — **acumulado de toda a vida da
  campanha**, sem recorte de data (`api/crm/campaigns/[id]/route.ts:52-67`).

O aviso existia, mas era rodapé de 10px, cinza-claro, **só para campanha recorrente**,
e não dizia que o "Público total" é de agora. Agora é permanente, em vermelho, e diz
as duas coisas. *Instrumento que mente é pior que instrumento nenhum.*

### O que NÃO consertei, e por quê

**Um código da Meta ainda não nomeado é retentado para sempre como "temporário"** —
ex.: `META_131026` (número não recebe). O `default` faz isso **de propósito**
(`linha 158-162`): mapear código desconhecido para "número morto" jogaria o cliente na
exclusão automática, que **apaga o cadastro** quando não há pedido
(`ScheduledCampaignRunnerService.ts:1903,1930-1966`). É irreversível. Nomear código a
código é conserto de verdade, mas **exige leitura da tabela de erros da Meta contra o
log de produção** — não palpite. **Fica aberto.**

**A raiz do problema é de desenho:** a classificação tem **um eixo** (o destinatário
pode ser retentado?) e os erros têm **duas naturezas** (falha do CANAL × falha do
DESTINATÁRIO). `META_133010` é do canal, precisa de conserto humano, mas o destinatário
tem de continuar na fila — e o modelo atual **não sabe dizer isso**. Hoje sai certo por
acaso (`RETRYABLE_LATER` + disjuntor de 5 falhas seguidas). Separar os dois eixos é
mudança estrutural, não conserto de sessão.

Portão: `npx tsc --noEmit` **limpo**; `npx vitest run` **488/488 arquivos, 6382 testes,
2 skipped**. GitHub Actions segue vermelho desde 15/08 **por faturamento** — a validação
acima é local e não dependeu dele.

**Exceção declarada:** `SEM_AGENTE` + `URGENCIA` — o Diretor editou `src/` por não ter,
nesta execução, ferramenta para acionar o `crm`/`canais`/`interface`. Conta contra a régua.

---

## 🟢 23/08 (2ª rodada) — o modo APARECIA; o que faltava era a placa. Consertado.

O CEO disse *"esse menu no agente não aparece pra mim"*. **Fui ao código antes de
responder, e o achado contraria a hipótese:** o modo **existe e está exposto** no
commit que roda em produção (`/api/health` → `536d0cd`, o mesmo da árvore).

- `AgentePage.tsx:150-160` — `AGENT_MODE_OPTIONS` traz três cartões, e
  **"Menu fixo (sem IA)" é o primeiro deles**.
- Renderizado em `AgentePage.tsx:~995` sem flag, sem permissão, sem cargo: dentro
  de `/agente-ia` → cartão **WhatsApp Host** → seção **"Status do agente"** →
  **"Modo de operação"**. Fica **logo acima** da seção "Menu inicial" do print dele.
- Não há segunda tela com esse controle. `/aprendizado-whatsapp:800-805` mostra o
  modo **só para leitura** — se ele esteve ali, viu o modo e nenhum botão. É o
  candidato mais provável do "não aparece".

**O defeito real, esse sim confirmado, é outro e é pior:** a seção "Menu inicial"
aceitava a configuração **calada** em um modo que nunca envia esse menu. Caixa
certa, seta faltando — só que a seta faltava na hora de configurar, não na de
escolher o modo.

**Consertado nesta sessão** (`src/app/(dashboard)/agente-ia/AgentePage.tsx`):

1. **A tela parou de mentir.** "Recepcionista" descrevia-se como *"Responde, exibe
   opções e direciona o cliente"* — não exibe opção nenhuma desde 05/08. Agora é
   **"Recepcionista (IA)"**, *"A IA responde em texto livre. NÃO envia o menu
   configurado abaixo"*. O mesmo aviso entrou em "Com suporte humano".
2. **"Menu fixo (sem IA)"** ganhou o rótulo honesto do que ele é: *"ÚNICO modo que
   envia o menu abaixo"*.
3. **Faixa de aviso dentro de "Menu inicial"**, visível sempre que o modo não for
   `MENU_ONLY`: diz que o menu **não está sendo enviado hoje**, diz o modo atual,
   e traz um botão **"Usar 'Menu fixo (sem IA)' neste número"** que troca o modo
   ali mesmo — com o custo escrito ao lado (*a IA deixa de responder neste número*)
   e o lembrete de salvar.

Portão: `npx tsc --noEmit` **limpo** e `npx vitest run` **6378/6380** (2 skipped),
com `node_modules` reinstalado do zero (a árvore chegou sem dependências — sem
`npm ci` o `tsc` cospe 38.403 erros falsos, e isso já enganou leitura antes).
O GitHub Actions segue vermelho desde 15/08 por faturamento; a validação acima é
local e não dependeu dele.

**Exceção declarada:** `SEM_AGENTE` + `URGENCIA` — o Diretor editou `src/` por não
ter, nesta execução, ferramenta para acionar o `interface`. Conta contra a régua.

---

## 🔴 23/08 — o número: por que a tela da Meta e o log do Railway não se contradizem

O CEO mandou o print do painel: **+55 11 97244-0131 ("Sushi cazza", WABA
`1045616451725086`), Classificação de qualidade = Pendente**. O log segue com
`META_133010`. **Não é contradição — são duas camadas.**

O painel mostra o número **ligado à WABA** (camada de conta); o `META_133010` diz
que ele **não foi registrado no runtime da Cloud API** (camada de execução) — é
exatamente o `platform_type: NOT_APPLICABLE` que o próprio código descreve em
`MetaOnboardingService.ts:111-116`. "Qualidade: Pendente" é a confirmação disso: a
nota de qualidade só existe depois que o número **passa a trafegar** mensagem, e
ele não trafega nenhuma.

### O comando do ato 1, com a trava de coexistência já resolvida

O CEO confirmou que **o chip não está em celular nenhum** → o risco que segurava
este passo (o `/register` expulsar o número do aparelho) **caiu**.

⚠️ Detalhe operacional que muda a execução: o `route.ts:88-91` não olha o celular,
olha a **flag `coexistence` gravada no banco**. Se a flag estiver ligada de um
cadastro antigo, o registro é **pulado** com a mensagem `skipped: "coexistence…"`.
Nesse caso — e **só** nesse caso — repetir com `"force": true` é seguro **hoje**,
porque a premissa da trava (número vivo num aparelho) não vale mais.

**Confirmado por mim, hoje, na fonte** (Railway, projeto Foocci, deploy
`ffc533b8`): às **15:19:57 de 23/08** ainda saía
`[CampaignRunner] channel collapse … lastError: 'META_133010'`. O número segue
fora do ar neste minuto — não é log velho.

Eu **não disparei** o registro: não tenho o `ADMIN_SECRET` nem o PIN, e os dois
são posse do CEO. O comando pronto está em
`docs/pedidos/registrar-numero-cloud-api.md`.

---

## 🔴 23/08 — "Menu inicial" parou: são DUAS quebras empilhadas, não uma

O CEO mandou o print da tela **Menu inicial** (`/agente-ia`) e disse *"preciso disso
funcionando de novo"*. Leitura do caminho inteiro — não dedução — achou duas causas
independentes. Consertar só uma **não** faz o menu voltar.

### Causa A — HOJE (23/08): o número não está registrado na Cloud API

Ao religar o número oficial do Sushi Cazza, faltou a etapa `/register`. Evidência
de produção (Railway, serviço `FOOCCI`, ambiente `production`), 23/08 às 00:04,
00:12, 00:13 e de 14:07 a 14:57 de 10 em 10 minutos:

```
[CampaignRunner] channel collapse — aborting batch after 5 consecutive failures
  { campaignId: 'cmq79xjmu000a3mr3l86yzrxm', lastError: 'META_133010' }
```

`META_133010` = número **não registrado** na Cloud API. E o próprio código já
avisa o que isso custa — `src/services/whatsapp/MetaOnboardingService.ts:111-116`:
um número migrado/verificado fica `platform_type: NOT_APPLICABLE` (ligado à WABA,
**não** ativado no runtime) *"até isto rodar, e a Meta não entrega webhook de
entrada"*. Ou seja: hoje **nada entra e nada sai** nesse número. Nenhum menu
sobreviveria a isso.

Não houve **nenhuma** linha `[webhook/meta/whatsapp]` no log do dia — coerente com
"não chega webhook", mas a retenção do log tem buraco (00:13 → 14:07), então isto
é indício, não prova.

### Causa B — desde 05/08: o modo "Recepcionista" nunca mostra o menu

O menu inicial (`welcomeMessage` + `menuOptions`, `prisma/schema.prisma:1684-1704`,
chaveado por `restaurantId` — **não** por número, então a troca de chip não o
orfanou) é renderizado por **um único** serviço:
`src/services/ai/WhatsAppReceptionistService.ts:1448-1470` (saudação + menu numerado).

Quem escolhe o agente é `src/services/whatsapp/inbound/InboundAgentDispatch.ts:224`:

```ts
} else if (agentMode !== "MENU_ONLY" && isBrainEnabled() && input.isTextMessage && text) {
  handler = "BRAIN";
```

Isto é: **todo texto** vai para o Cérebro, exceto no modo `MENU_ONLY`. E o Cérebro
(`src/services/whatsapp/brain/`) **não lê `welcomeMessage` nem `menuOptions` em
lugar nenhum** (grep sem um único acerto). Resultado: no modo padrão
`RECEPTIONIST_ONLY` — o modo cujo nome é "recepcionista" — o recepcionista **não é
chamado** e o menu da tela é letra morta.

Confirmado que o Cérebro está ligado em produção: `WHATSAPP_BRAIN_ENABLED` **não
existe** entre as variáveis do serviço no Railway, e o default é ligado
(`InboundAgentDispatch.ts:67`).

**Quando começou:** commit `16cf3b5` (05/08/2026), o mesmo que criou
`InboundAgentDispatch` ao portar a paridade da Evolution para o webhook da Meta.
Antes disso o caminho vivo era o webhook da Evolution, que roteava por `agentMode`
e caía no recepcionista. Casa com `docs/decisoes.md:763` ("o da Meta chama só o
Cérebro").

**A tela mente hoje.** `src/app/(dashboard)/agente-ia/AgentePage.tsx:152` descreve
`RECEPTIONIST_ONLY` como *"Responde, exibe opções e direciona o cliente"*. Ele não
exibe opção nenhuma.

**Dano colateral:** o diagnóstico de roteamento
(`src/services/whatsapp/ordering/hostRoutingDiagnostic.ts:28`) só conhece
`TEXT_ORDER | RECEPTIONIST | HUMAN_BLOCKED | IGNORED` — o `BRAIN` não existe no
vocabulário dele. Quem usar essa ferramenta para depurar isto recebe resposta errada.

### 👤 O que depende do CEO — dois atos, nesta ordem

1. **Registrar o número na Cloud API.** `POST /api/admin/meta/register` com
   `{ restaurantId, pin }` (PIN de 6 dígitos da verificação em duas etapas do
   número) — `src/app/api/admin/meta/register/route.ts:61-99`. O PIN é posse dele;
   eu não tenho e não devo ter.
   ⚠️ **Trava de segurança que ele precisa saber antes de apertar:** se o número
   estiver em **coexistência** (rodando também no app WhatsApp Business do celular
   — que é justamente o cenário de hoje, CRM e atendimento no mesmo chip), o
   `/register` **expulsa o número do aparelho**. O código recusa por padrão e só
   obedece com `force: true` (`route.ts:88-91`). Não passar `force` sem decisão
   explícita dele.
   Se o reconnect trocou o número por engano (ex.: pegou o número de teste +1), a
   mesma rota reaponta o `phoneNumberId` dentro da mesma WABA antes de registrar
   (`route.ts:64-77`).

2. **Decidir o que "Recepcionista" significa** — é escolha de dono do produto, não
   minha:
   - **Saída 1 (zero código, reversível num clique):** trocar o modo do Sushi Cazza
     para **"Menu fixo (sem IA)"** (`MENU_ONLY`) na própria tela. O menu do print
     volta exatamente como está configurado. **Custo:** perde a IA nesse número.
   - **Saída 2 (código):** fazer a primeira mensagem da conversa (saudação) cair no
     recepcionista com o menu, e o Cérebro assumir do segundo turno em diante.
     **Custo:** mexe na porta de entrada de **todos** os restaurantes e não há como
     validar ponta a ponta sem disparar mensagem — e o número é o do sushi ao vivo.
   - **Recomendo a Saída 1 hoje** e a Saída 2 como obra agendada, depois que o
     número estiver de pé e com um caminho de teste que não use cliente real.

### O que eu NÃO consegui verificar

- Se o `phoneNumberId` gravado no banco é o do chip religado — não leio dado de
  produção e não altero.
- Se o número está ou não em coexistência — isso muda a resposta do ato 1.
- Fluxo ponta a ponta: não disparei nenhuma mensagem. O número é o oficial do
  Sushi Cazza e a ordem é não arriscar.
- O GitHub Actions está 100% vermelho desde 15/08 (faturamento, não código); não
  precisei dele — nenhuma linha de `src/` foi alterada neste bloco.

---


## 🏛️ 07/08 — A Sala dos Agentes, e o custo de IA que era chute

### O que está esperando UMA PALAVRA do CEO

| # | O que | Por que só ele decide |
|---|---|---|
| 1 | **Elenco obrigatório do kit** — `qualidade`, `cerebro`, `interface`, `experiencia` | Vira regra de todos os projetos. Escrito como **proposta** em `dioli-brain-kit/docs/21-elenco-obrigatorio.md` |
| 2 | **Criar o especialista `seguranca`** | Recomendação minha. Hoje **ninguém responde** pelas portas abertas listadas abaixo |
| 3 | **Construir a Sala dos Agentes** no `/admin` | Maquete aprovada. Falta autorizar a obra |
| 4 | **Escolha de modelo por agente** | Hoje o modelo é **por restaurante** e só aceita 2 da OpenAI. Virar "um por agente" é obra de verdade, não botão |

### O que foi entregue e está no ar

- **Kit oficial** — duas doutrinas com push feito em `dioli-brain-kit`:
  `20-sala-dos-agentes.md` (obrigatória em todo projeto) e `21-elenco-obrigatorio.md`.
  ⚠️ **Não consigo avisar os outros Diretores** — cada conversa é uma ilha. Quem
  aciona é o CEO ou o Diretor Geral. Na prática são só Foocci e Dioli Digital
  acordados.
- **Branch `claude/canais-central-canal-morto`** — 3 commits, `tsc` limpo,
  **6128/6128** testes. **Sem PR aberto ainda.**
  1. A Central passa a dizer quando o canal está morto (Instagram)
  2. Custo de IA deixa de ser chute: preço por modelo + `agentSlug` no registro
  3. O raio-x para de converter "não sei o preço" em "custou zero"

### 🟡 O que se descobriu sobre medir custo

- **Por IA:** dá, e **vale para trás** — o custo é recalculado a partir dos tokens gravados.
- **Por agente:** só **para frente**. Linha antiga não tem slug e fica em "não atribuído". Backfill seria adivinhação.
- **A armadilha consertada:** a tabela de preços conhecia 2 modelos da OpenAI e cobrava
  **todo o resto ao preço deles**. Não custou nada ainda porque uma trava acima só
  deixa passar esses dois — mas o roteador já tem Claude e Gemini prontos, e o
  primeiro desvio de tráfego erraria até **8x**, calado.
- **O projeto NÃO usa DeepSeek.** O nome só aparece em scanner e lista de import proibido.

---

## 🌇 O bloco da tarde de 06/08 — quatro PRs abertos, e um P0 no portão da escada

O CEO autorizou o lote inteiro ("faz tudo"). Três especialistas rodaram em
paralelo e voltaram; o trabalho está em revisão.

| PR | O que é | Estado |
|---|---|---|
| #113 | P0: `"não "` deixa de ser fim de conversa | **mergeado** |
| #114 | 🔴 **P0 do portão da escada** + a tabela de verdade vira uma só | aberto |
| #115 | `/site/demonstracao` morre, o formulário vai para `/site/precos#demonstracao` | aberto |
| #116 | Inventário dos restaurantes + máquina de exclusão desligada | aberto |

### 🔴 O achado que muda a resposta sobre ligar o raciocínio livre

O CEO disse *"pode ligar o raciocínio"*. **Não dá para ligar hoje — e o motivo
não é falta de amostra, é que a régua estava contando errado.**

`runFreeFormGates` pedia "20 amostras com 70% de acerto" e chamava
`getShadowStats` **sem** o parâmetro de origem. Sem ele não há filtro: o portão
somava produção, replay, treino e — pior — as linhas gravadas **antes de o campo
de origem existir** (migração de 05/08), cuja procedência é indeterminável. Como
o gate lê uma janela de 7 dias, quase toda a evidência dentro dela era desse
balde.

Enquanto isso valer em produção, qualquer número que a escada devolver **não é
evidência**. Corrigido no PR #114. A leitura só passa a valer depois do deploy.

Segundo defeito, mesma causa: a tabela de rótulos da verdade era **copiada** em
dois arquivos. O PR #111 acrescentou `loja`/`entrega`/`local` e atualizou só uma.
No juiz, as três caíam atrás do cardápio e o corte de 15.000 caracteres as
apagava — o agente sabia que a loja estava fechada e dizia isso, e o juiz julgava
a frase **sem a linha que a sustenta**.

### 🔴 Apagar restaurante não cancela a cobrança

Levantado ao construir o #116, e é o motivo de nada ter sido apagado:
`PlanSubscription.restaurantId` é `onDelete: SetNull`, e a linha guarda o
`mpPreapprovalId` — recorrência viva no Mercado Pago. **O cartão do lojista
continuaria sendo debitado depois do restaurante deixar de existir.** Virou
bloqueio duro no serviço de purga.

Junto: não existia `DELETE` de restaurante em lugar nenhum do sistema; a cascata
do Prisma bate em 6 arestas `ON DELETE RESTRICT` e provavelmente falharia no
meio; e 23 tabelas carregam `restaurantId` **sem chave estrangeira** — ficariam
órfãs apontando para nada.

**O inventário ainda não saiu.** Depende do #116 estar no ar para o workflow
conseguir ler produção. Nada foi apagado, e a lista sobe ao CEO restaurante por
restaurante antes de qualquer exclusão.

### ⚪ Aberto, para decisão do CEO

- **O SDR que aborda o lead do site não existe** — e o bloqueio é que a Foocci
  **não tem número de WhatsApp para vender** (conferido: `/site/demonstracao` não
  tem nenhum `wa.me` no HTML de produção). Duas perguntas travam tudo: chip Meta
  oficial ou Evolution, e o que o agente responde quando perguntarem preço.
  Desenho completo em `docs/sdr-foocci-desenho.md`.
- **Os vídeos de `/admin/demo-videos` ficaram órfãos** com a morte da
  `/site/demonstracao`. Eram exibidos só naquela página; publicar um vídeo hoje
  não aparece em lugar nenhum. Não há vídeo publicado, então nada quebrou — é
  falha silenciosa esperando alguém gravar. Sugestão: `/site/experimente`.
- **O livro de assinaturas do kit** — proposta aberta em
  `docs/perguntas-ao-diretor-geral.md`. A pergunta do CEO *"eles já estão com o
  brain atualizado?"* não tem resposta hoje. Do lado do Foocci já está assinado
  em `docs/kit-versao-lida.md`; o registro central depende do Diretor Geral.

---

## 🌅 Onde parou o dia 05/08 — leia isto primeiro

Dia longo, com o CEO ao vivo até tarde. **Sete blocos subiram para produção** e
estão confirmados no ar (`/api/health` → `2a12b93d`). O que ficou aberto está
listado logo abaixo, e o que depende dele está marcado.

### O que entrou em produção

| # | Bloco | Por que importava |
|---|---|---|
| #102 | Esteira de treino do CRM + **P0 do simulador** | A tela de teste do painel apagava **cliente e histórico de pedidos reais** por id cru, sem escopo de restaurante e sem checar cargo — contornando as três proteções que já existiam |
| #103 | **P0 do rodízio** + botões mudos do site | O agente negou um produto que o Sushi Cazza vende (R$ 119, salão) porque o catálogo do Garçom só enxerga delivery |
| #104 | Item de salão: contar sim, vender não | O agente do cardápio **não lia a base de conhecimento**; só o do WhatsApp lia. E o `finalize` não conferia o canal |
| #105 | Copies do site | Hero com as duas dores, "olha quanto você paga de comissão", os 50% do 1º mês, "não é aplicativo" |
| #106 | **P0 do suporte** | O Safari do iPhone grava MPEG-4 e o código carimbava `.webm` em tudo; o Whisper decide pela extensão do nome. Mais anexo de print/PDF |
| #107 | Cartões de plano | Vantagem grande primeiro, ordenada pela dor; recurso desce |
| #108 | A ferramenta de olhar o site | Ela mentia sobre o que conseguia ver |

### ⏳ Em curso quando a sessão fechou

- **As quatro negações do WhatsApp** (`garcom`, worktree próprio). Mesmo padrão
  do rodízio, no outro canal. A pior: *"não aceitamos vale-refeição/voucher"*
  **fixa no código, igual para todo restaurante**, sem ler `paymentSettings` —
  mente nas duas direções, para toda a base. As outras três: "não temos
  bebidas/sobremesas" a partir de filtro por palavra, "não encontrei {assunto}",
  e um prompt que MANDA o modelo negar.

### 🔴 Decisões que esperam o CEO

1. **O rodízio deve aparecer no cardápio de delivery?** Hoje está certo como
   salão e o agente encaminha para a equipe. Se for para vender ali, é mudança
   de **cadastro**, não de código.
2. **Cadastrar o "como funciona" do rodízio** na base de conhecimento do Sushi
   Cazza (horário, o que inclui, tempo limite). Hoje o agente diz preço + "é só
   no salão" + oferece a equipe, porque o resto não existe no sistema — e não
   inventa. Cadastrou, ele passa a falar sozinho.
3. **Teto da calculadora em R$ 5.000.000/mês** — palpite de interface, não regra
   comercial. Se o número certo for outro, é uma constante.
4. **Com prejuízo no cenário conservador**, a calculadora mostra o ponto de
   equilíbrio em vez de "você economiza". Reversível numa condição.
5. **A página `/site/demonstracao` deve ser eliminada?** O CEO pediu, reagindo ao
   rótulo antigo do botão ("Ver no meu restaurante") que prometia testar no
   restaurante dele. O rótulo já morreu no site inteiro; a página é o formulário
   que alimenta o SDR. **Não eliminei** — está esperando ele confirmar.
6. **A aba Diagnóstico não ganhou anexo** (herdou só a correção do microfone):
   ela não tem conversa própria para segurar o arquivo.

### ⚠️ Dívida de segurança ainda aberta (varredura de 05/08)

Nenhuma é P0, e nenhuma foi corrigida:

- **Webhook da Saipos sem autenticação alguma** — quem souber o `cod_store` e um
  id de pedido cancela o pedido. Atinge só restaurante com Saipos ativo. **ATIVO**.
- **Stone aceita qualquer chamada se o segredo faltar** (`if (!secret)` segue em
  frente) e, diferente do Mercado Pago, **não reconsulta o provedor** — confia no
  corpo. **LATENTE**: não deu para conferir se a variável existe em produção.
- **`cron/expire-wa-ordering-sessions`** com o mesmo `if (secret)`; é a única das
  44 rotas de cron nesse formato. **LATENTE**.
- **`/api/recover`** pega "o primeiro restaurante ativo que o banco devolver": se
  ele ficar sem OWNER, qualquer pessoa cria conta de dono nele. **LATENTE**.
- **Verificador do Instagram é fail-open na função** e a rota só escapa porque
  `[].some()` é `false`. Pior: **o teste congela o fail-open como esperado**.

## 🖼️ Site com imagem em toda página — FEITO na madrugada de 05/08

O CEO olhou o site e disse: *"está só com texto, botão e detalhes gráficos"*.
Estava certo — seis das oito páginas abriam sem nenhuma imagem própria.

Duas frentes, em paralelo, cada uma na própria árvore:
1. **O produto foi fotografado**, não comprado: cinco capturas da tela real do
   Foocci rodando na padaria de demonstração (`scripts/site/capturar-produto.mjs`
   refaz quando a tela mudar). 696 KB no total — o site já carregava um PNG de
   3 MB sozinho.
2. **Um sistema de abertura visual** (`HeroShot`), um cartão com três conteúdos
   possíveis (celular, navegador, fotografia). Não são oito soluções: os oito
   cabeçalhos medem a mesma altura no desktop sem ajuste manual.

Termos e Privacidade seguem sem imagem, **por decisão**: são documento, e foto
ali é peso sem argumento. Reversível em meia hora se o CEO discordar.

## ✅ Dois defeitos do painel de pedidos — FECHADOS na mesma noite (05/08)

Encontrados por quem foi fotografar as telas para o site, corrigidos por
`operacao` logo em seguida.

**O primeiro era pior que o relato.** O "Total hoje" não contava o dia *nem* a
página: contava **quantos pedidos recentes couberam no limite de 100, misturando
dias**. Numa loja de 30 pedidos/dia ele mostraria 100 — a soma de quatro dias — e
só acertava por coincidência. Agora lista e KPI saem da **mesma consulta**, então
não existe estado em que um diga uma coisa e o outro diga outra: é fonte única, e
não um comentário pedindo cuidado.

**O botão "Filtrar" de fato não tinha ação** — as datas alimentavam só os próprios
campos. Decisão: **fazer funcionar, não remover.** O dono que procura o
faturamento de ontem procura na tela de Pedidos (o Analytics responde outra
pergunta: agregado, não a lista de comandas), e o servidor já aceitava o período e
já devolvia a contagem certa — era o painel que jogava fora.

Vieram junto: período inválido vira **erro visível** (lista vazia se lê como "não
teve pedido"), faixa avisando que o filtro está ativo com volta em um clique, e o
total passa a aparecer **no celular**, onde o dono mais olha.

19 testes, cada um com as duas metades — a que prova o acerto e a que reproduz o
erro antigo.

> ⚠️ **Não foi visto em loja real.** A prova foi na padaria de demonstração.

## 🕐 Dívida nomeada: o "hoje" do painel é o fuso de Brasília, fixo

Achado ao corrigir o KPI acima. Vale para o produto inteiro, não só para essa
tela: **loja fora do fuso de Brasília vê o dia virar na hora errada.** Não foi
corrigido junto de propósito — é decisão de produto (fuso por restaurante) e não
conserto de tela. Dono: `operacao`.

## ✅ Domínio `www` — FECHADO pelo Diretor em 04/08, ponta a ponta

O `www.foocci.com.br` não abria: erro de certificado no navegador. Estava travado
havia dias porque parecia depender do CEO abrir dois painéis. **Não depende mais
— nenhuma das duas pontas.**

| Ponta | Como ficou |
|---|---|
| **Registro no Railway** | Feito por API, via GitHub Actions, usando o `RAILWAY_TOKEN` que já existia nos segredos do repositório. `scripts/railway-custom-domain.mjs` + `.github/workflows/railway-custom-domain.yml`. |
| **Correção do DNS** | Feita por API na Hostinger, com token do CEO. `CNAME www` → `9gfe3aaa.up.railway.app`, TTL 300. Confirmado nos dois servidores autoritativos (`pixel` e `byte.dns-parking.com`). |

**A causa raiz, que ficou escondida por dias:** o `CNAME` do `www` apontava para
`o8p24ufo.up.railway.app` — a borda do serviço/apex — enquanto o Railway emite o
certificado do `www` numa borda exclusiva, `9gfe3aaa.up.railway.app`. Servidores
diferentes (`69.46.46.119` × `69.46.46.53`). O DNS **resolvia**, então todo
diagnóstico de fora dizia "está tudo certo, é só esperar". Não era espera: era
valor trocado, e ficaria assim para sempre.

> **Aprendizado que vale além deste domínio:** *DNS resolvendo* ≠ *DNS correto*.
> Um portão que só checa NXDOMAIN aprova este erro. O que prova é comparar
> `requiredValue` × `currentValue` na API do provedor — o script agora grita
> quando divergem, e reporta o `certificateStatus`.

**Detalhe operacional:** o TTL antigo era de 4 horas, então resolvedores públicos
(Google, Cloudflare) ainda serviram o valor velho por um tempo depois da troca.
Autoritativo correto = problema resolvido; o resto é expiração de cache.

**Pendente de decisão do CEO:** o token da Hostinger passou pelo chat e **deve ser
rotacionado**. Se ele quiser que DNS continue na mão do Diretor depois disso,
guardar o token novo como segredo `HOSTINGER_API_TOKEN` no repositório — é o
mesmo mecanismo que já resolveu o lado do Railway.

## ⚠️ Portão de qualidade estourando o tempo — 3 arquivos de teste

`src/services/quality/noSideEffects.test.ts`, `QualityControlService.test.ts` e
`dashboardModel.test.ts` falham por **timeout de 5s**, não por asserção. Verificado
em 04/08 que falham **igual na base**, sem relação com a mudança da identificação
— o varredor de auditores simplesmente não cabe mais em 5 segundos.

**Por que não é detalhe:** é o guardrail 2 ao contrário. Um portão que não termina
não reprova nem aprova — ele fica vermelho por motivo errado e, com o tempo, todo
mundo aprende a ignorar aquele vermelho. Ou o tempo sobe para um valor honesto, ou
o varredor é fatiado. Não deixar como está.

## 📱 Cupons/endereços na Loja para quem DIGITA o telefone — depende de OTP (canais)

> **Atualização 04/08 (tarde):** o CEO pediu a opção de cupom **dentro do
> checkout** — feito: bloco na etapa "Confira seu pedido", com escolha, troca e
> remoção, e o total/botão já descontando. Isso **aumenta a urgência do OTP**:
> agora existe um lugar visível onde o cliente que só digitou o telefone lê
> "seus cupons aparecem quando você abre pelo link do WhatsApp". Antes o limite
> ficava escondido no drawer; hoje ele está no caminho da compra.

Nota do topo marketplace (04/08): o drawer "Minha conta" da Loja mostra cupons
e endereços reais via rotas gated por prova de posse do telefone (waToken) —
quem chega pelo **link do WhatsApp** tem a experiência completa; quem só digita
o telefone no WelcomeModal vê nota honesta ("aparecem quando você abre pelo
link do WhatsApp"), porque telefone digitado não é prova (LGPD — seria expor
cupons/endereços de terceiros). Destravar para todos = OTP por WhatsApp
cunhando o mesmo token, domínio do `canais`. O drawer já está pronto para isso
sem mudança.

## ✅ Cobrança — os dois achados de 04/08 FECHADOS no mesmo dia (aguardando merge)

1. **Variante no WhatsApp:** `WhatsAppCheckoutAdapter.validateAndPriceItems`
   tinha o mesmo furo do finalize (cobrava variante pelo item base). Corrigido
   com a mesma resolução: variante do banco, validada (pertence ao item,
   disponível), `resolveVariantPrice`, falha fechada COM resposta ao cliente
   (`replyText` pelo `blockedReply` — antes, falha de validação virava "pedido
   anotado" falso sem pedido criado; fechado também para item indisponível).
   9+3 testes novos em `tests/WhatsAppCheckoutAdapterVariantPrice.test.ts`.
2. **Canal de exibição × cobrança no pickup:** DECIDIDO pelo CEO em 04/08 —
   **cobra-se o que a tela mostrou** (registro em `docs/decisoes.md`). Aplicado
   no finalize e no WhatsApp: pickup precifica e promociona como DELIVERY, o
   canal que as duas superfícies exibem. E2E real provou (priceDineIn plantado
   diferente → pickup cobrou o DELIVERY da tela). Taxa de entrega segue só para
   delivery; cupom já era consistente entre preview e cobrança.

## ✅ P1 · Finalize ignorava o preço da variante — CORRIGIDO em 04/08 (aguardando merge)

Achado do `interface` no E2E do retrabalho da Loja, **confirmado pelo Diretor no
código**: `/api/pedido/[slug]/finalize` recalcula o preço no servidor a partir do
preço **base** do item (`channelPrice` + opções + extras) e só grava
`variantName` — o preço da variante nunca entra na conta. Prova: Quatro Queijos
Grande (R$ 64,90 na tela) → cliente viu R$ 190,70 na revisão, pedido gravado com
R$ 166,70. **Pré-existente** — afeta o cardápio com IA (PedidoClient) desde
antes, mesma rota, mesmo payload. Toda venda de variante mais cara que o base sai
mais barata para o cliente e o restaurante não vê. Correção: resolver `variantId`
→ `resolveVariantPrice` dentro do guard server-side do finalize (o guard
anti-adulteração continua; ele só precisa conhecer variantes). Guardrail 6: a
evidência acima é o caso concreto.

**Corrigido em 04/08 pelo `operacao`, revisado pelo Diretor:** o guard resolve a
variante no banco (`variantId` explícito no schema — antes o zod o descartava em
silêncio — com fallback pela convenção do id de linha), falha fechado com 400
para variante inválida/indisponível/de outro item, cobra `resolveVariantPrice`
no canal do pedido e grava na comanda o nome da variante do banco. Regra
promoção×variante: espelha os clientes (promoção nunca se aplica a linha de
variante). Travado por 12 testes novos em
`src/app/api/pedido/[slug]/finalize/route.test.ts` + E2E real na pizzaria-demo
(64,90 cobrado como 64,90). De carona revelou os DOIS achados no topo desta
fila (WhatsApp com o mesmo furo; canal de exibição × cobrança no pickup).

---

## 💳 FLUXO DE COMPRA DO PLANO — estrutura levantada, OS aberta (03/08)

Ordem do CEO. **Hoje um cliente que quer pagar não tem onde**: sem botão, sem
contrato de assinatura (os termos atuais não citam plano pago — zero ocorrências),
sem cobrança recorrente, sem registro de assinante, sem NFS-e, sem pós-compra.
**A OS completa, com as 6 peças, a ordem e as dependências, está em
`docs/OS-fluxo-de-compra-do-plano.md`.** Recomendação: V1 assistido (CEO fecha
1:1 → aceite de termos → link de assinatura Mercado Pago → NFS-e via a conta
Focus NFe que JÁ existe). Duas dependências do CEO: revisão jurídica do termo e
os 4 dados fiscais (CNPJ/inscrição municipal/código de serviço/ISS).

## 🛡️ SEGURANÇA — varredura feita, crítico corrigido (03/08)

Relatório completo em `docs/seguranca-varredura-2026-08.md`. Resumo: base boa
(negação por padrão, HMAC nos webhooks, multi-tenant, rate limit). Corrigido
hoje: **next-auth com vulnerabilidade crítica** (4.24.7→4.24.15), comparação de
admin em tempo constante, HSTS. Na fila do Diretor: trocar `xlsx` (vuln sem fix,
mitigada por auth), cookie de admin com expiração, CSP com nonce, e o check de
`npm audit` crítico no CI.

---

# 🚨 A FILA COMEÇA AQUI — ordem direta do CEO, 03/08

> **Diretor do Foocci: largue o que estiver fazendo e leia este bloco antes de
> qualquer outro.** Se você já estiver no meio de outra coisa, termine a fatia que
> está aberta, commite, e venha para cá.

## 🤖 P0 do canal (03/08, noite) · Agente de CRM — casa PRONTA, ligação PREPARADA e travada no CEO

`docs/OS-crm-agente-ligar-e-dar-casa.md`, chegada pelo canal dos Diretores (PR #69).

- **Tarefa B (casa na interface): executada.** Casa única em `/admin/agentes/crm`
  (rota antiga `/admin/crm-agente` redireciona) com os 5 blocos: degrau, últimas
  decisões (`agent:crm`), prova A/B honesta, controles (confirm digitado + botão
  de pânico) e próximo passo. De carona, dois bugs reais: a tela antiga estava
  morta para admin (middleware barrava antes da rota — agora rotas `/api/admin/*`)
  e o shell do admin não tinha mobile (drawer novo; a 375px sobravam 167px úteis).
  tsc limpo, 4698 testes verdes, screenshots 375/768/1280 + vazios + drawer.
- **Tarefa A (ALLOWLIST): preparada, NÃO promovida.** Rollback provado em local
  (banco real, 6ms, sorteio intacto), roteiro executável na sala do `crm`
  (`docs/agents/crm/oficina.md`), normalização do 9º dígito provada nos 2 sentidos.
  **Pré-cheques que condicionam o 1º envio:** provider do alvo não pode ser Meta
  oficial (o agente não compõe ali, por desenho); `CRM_BRAIN_SHADOW_ENABLED=true`
  no Railway; telefones do time precisam existir na audiência.
- **Aguardando o CEO:** lista de telefones do time + restaurante alvo (provável
  Sushi Cazza, a confirmar). Sem isso, nada é promovido — trava intencional.
- Varredura rápida das demais páginas do admin no drawer mobile novo: na fila do
  `qualidade` (o shell mudou para todas; só a casa foi conferida página a página).

## ✅ 0º-C · Site — bloco do Garçom com telas reais + argumento "zero app" (03/08)

Entregue no mesmo dia, no ar em `/site/como-funciona`:

1. **"O Garçom na prática"**: os 5 prints REAIS que o CEO capturou no celular
   (chegada reconhecida → sugestão → upsell de fechamento → pagamento →
   confirmação) publicados como imagem em `/public/site/waiter/`, editados sob
   autorização expressa do CEO — restaurante virou "Sushi da Vila", telefone
   virou "Diego"; barra do navegador com foocci.com.br mantida de propósito.
   Edição via script Pillow; varredura confirma zero vazamento do nome/telefone
   reais.
2. **"Ninguém quer baixar mais um app"**: o diferencial zero-app como bloco de
   destaque dentro da seção (sem baixar, sem ocupar memória, sem criar conta).

## ✅ 0º-B · Site — agendamento real + página de demonstração em vídeo (03/08)

Ordem do CEO: os botões do site eram nebulosos ("ver demonstração" que não
mostrava nada; "agendar" sem agenda). Entregue na mesma sessão, no ar:

1. **Agenda virtual** (`/site/agendar` + `/admin/agenda`): o CEO abre horários
   em lote (data + horas, duração 15–45min) no admin; o site mostra só os
   livres; o visitante escolhe dia/hora e deixa nome + WhatsApp. Reserva é
   atômica (dois disputando → um vence, o outro recebe aviso honesto). Aviso
   por e-mail via Resend (mesmo contrato do lead: **gravar antes, avisar
   depois** — o painel é o cofre). Sem horário livre → aponta o formulário.
2. **Demonstração em vídeo** (`/site/demonstracao` + `/admin/demo-videos`): o
   CEO grava (tela do sistema, celular pedindo no Garçom), sobe no YouTube e
   cola o link no admin. Publicado aparece na página, na ordem; embed via
   youtube-nocookie. **Sem vídeo publicado a seção não existe** — a página
   segue como era. Rascunho nunca vaza (verificado).
3. CTAs religados: nav ganhou "Agendar conversa"; hero da demonstração aponta
   assistir (quando houver vídeo) e agendar.

**Depende do CEO:** ① abrir os primeiros horários em `/admin/agenda`;
② gravar os vídeos e colar os links em `/admin/demo-videos` (podem ficar "não
listados" no YouTube). Sem isso as duas páginas ficam nos estados de fallback
(honestos, mas vazios).

## ✅ 0º-A · Garçom — os 4 problemas do teste do CEO no sushi-cazza (03/08)

O CEO testou e achou 4 problemas. Diagnóstico e correção na mesma sessão:

1. **"Tem sushi?" mostrou coisa que não é sushi.** Causa: bônus de venda
   (best-seller/prioridade/popularidade) somavam pontos ANTES do filtro de
   relevância na busca — item de outra categoria entrava só por ser best-seller.
   Corrigido: métrica de venda agora só desempata a ordem, nunca qualifica.
2. **Só 5 bebidas no fim do pedido.** Causa: teto de 6 cards do escopo "upsell".
   Regra nova do CEO ("Isso é regra"): bebidas/sobremesas/extras no fechamento
   mostram **100% dos cards da categoria**. Teto de 6 aposentado; teto técnico
   da categoria subiu de 50→200. Registrado em `docs/decisoes.md` + vitrine do
   garcom, travado por teste.
3. **Número reconhecido, mas sem o nome.** 4. **"Comprar novamente" sumiu.**
   Causa comum provável (investigação do especialista garcom): os 5 lookups de
   cliente por telefone eram `findFirst` **sem orderBy** — quando o bug histórico
   do 9º dígito deixou cadastro duplicado (um rico, um vazio), a busca era
   loteria e podia resolver o vazio (sem nome, sem histórico). Corrigido:
   `CUSTOMER_LOOKUP_ORDER` (totalOrders desc) nos 5 pontos + nome-fantasma
   (nome = telefone) tratado como ausência de nome + quando o cliente informa o
   nome real, o cadastro fantasma é corrigido na hora.

**Fica aberto:** as duplicatas antigas continuam no banco (o fix faz a rica
vencer sempre; mesclar duplicatas é migração de dados — decisão à parte). Se o
CEO testar de novo e o nome ainda não aparecer, o cadastro rico dele pode também
estar sem nome — aí o app vai **pedir o nome uma vez** e corrigir para sempre.

## ✅ 0º · Loja QR com checkout — EXECUTADA em 03/08, no ar

A interface corrigida está em produção: plano de entrada abre o **catálogo puro
com carrinho e checkout** (retirada E entrega confirmadas em teste, zero
conversa, zero IA); planos com Garçom seguem no chat, intocados. Um link só —
a mesma flag do gate decide. `/qr` da mesa continua vitrine. Evidência completa
dentro da OS.

**Complemento de 03/08 (pedido do CEO):** a loja sem IA ganhou **link próprio** —
`/pedido/[slug]?modo=loja` força o catálogo em **qualquer** plano (o parâmetro só
remove a IA, nunca a liga; trava por plano intocada) — e a tela Cardápio agora
mostra **três cartões de QR**: Salão (vitrine) → Loja (pedido sem conversa) →
Delivery (pedido com Garçom). Verificado: tsc + vitest (4690 testes) verdes,
screenshots 375/768/1280, e a rota provada em tela (chat vs. catálogo no mesmo
restaurante PRO). De carona: o QRCard cortava conteúdo em grid desde antes
(breakpoint de viewport × largura de coluna) — corrigido; aprendizado promovido à
vitrine do `interface`. Na branch `claude/foocci-director-onboarding-lhindy`,
aguardando merge para a padrão.

**Correção de rota do CEO, 04/08 — executada no mesmo dia:** a casca que saiu em
03/08 ainda era um e-commerce genérico, não o que o CEO pediu. Palavras dele: *"é
só você pegar o mesmo cardápio [da mesa], replicar, e colocar os itens à venda e o
checkout"*. Refeito: o visual do `/qr` foi extraído para `src/components/menu/*` e
as duas superfícies compõem os MESMOS componentes — igualdade por construção, não
por disciplina. O `/qr` foi provado pixel-idêntico ao que era (baseline via stash
+ diff). Nome oficial do produto: **"Cardápio sem IA"** (cartão de QR renomeado;
"Loja" não é nome de cliente). Decisão registrada em `docs/decisoes.md`. E2E real
com variante + opções + extras confirmado no banco local — que revelou o P1 de
preço de variante no topo desta fila.

## (original) 0º · CORREÇÃO DO CEO — a interface era OUTRA

**Seu trabalho de hoje estava certo contra a OS — a OS é que traduziu errado o
CEO** (erro do Diretor Geral, assumido lá dentro). O CEO corrigiu em 03/08 à
noite: a loja do plano de entrada é **a interface do QR (catálogo puro, zero
chat) ganhando carrinho e checkout de delivery/retirada** — não a tela do
`/pedido` sem IA. A parte cara do que você fez hoje **sobrevive inteira**: o
funil provado sem IA, o conserto do Finalizar, a trava por plano e o override
são exatamente a máquina que a UI nova vai chamar. O que muda é a casca visual.
Especificação completa e critérios de pronto na OS nova. **Ela passa na frente
de tudo.**

## ✅ 1º · O cardápio sem IA — FECHADO em 03/08, com evidência (⚠️ superado pelo item 0º acima na parte VISUAL; a mecânica vale)

Os três passos da OS fechados: funil provado sem IA (pedido local CONFIRMED e
**#O2VKA1 Aceito** por clique, zero chamadas de IA em 375/768/1280), loja
falando por si (saudação nova, sem botão de sugestão, sem composer), e a trava
por plano **em código e provada em produção**: STARTER sem override → 403;
o cliente vivo (avô) → 200 com a IA intacta. Detalhe e evidência dentro da OS.

Sobras registradas: `draft` do carrinho devolvendo 400 `invalid_payload` em
alguns payloads (recuperação de carrinho pode estar perdendo rascunhos) e um
aviso de hidratação dev-only na abertura da loja.

## (original) 1º · O cardápio sem IA do plano de entrada

**Ordem do CEO, 03/08, palavras dele:**

> *"Urgentemente a gente precisa desse cardápio. Já pede pra ele fazer e colocar na
> fila dele."*

**A ordem de serviço completa está em
`docs/OS-cardapio-sem-ia-plano-de-entrada.md`.** Leia inteira antes de abrir o
editor — ela tem uma medição que muda o tamanho do trabalho e uma armadilha que
custa caro se ignorada.

### O resumo, para você decidir se vale ler tudo (vale)

O plano de entrada **não inclui o Garçom de IA**. Sem ele, o restaurante desse plano
**não tem hoje nenhuma tela capaz de receber um pedido** — `/qr/[slug]` é vitrine
por desenho (o cabeçalho do próprio arquivo diz *read-only*, e são 949 linhas com
zero carrinho).

**Mas o checkout não precisa ser construído.** `/pedido/[slug]` já abre em `BROWSE`,
suas 39 transições de etapa estão todas em handler de clique ou retorno de
pagamento, e das ~25 chamadas de rede da tela **apenas 2 vão à IA** — `finalize`,
PIX, cartão, cupom e frete têm rota própria. **O dinheiro não passa pelo Garçom.**

**Decisão do CEO já tomada e registrada dentro da OS: é a opção A — loja sem IA,
pelo link.** Não é o pedido na mesa. Não reabra essa escolha.

### ⚠️ O passo 1 não se pula

Antes de escrever uma linha: rodar `/pedido/[slug]` com a camada de IA neutralizada
e **tentar comprar de verdade**, ponta a ponta, até a confirmação.

A medição acima é **indício forte, não prova** — ninguém executou com a IA
desligada. Se o funil não completar, **pare e escreva o que encontrou**. Não saia
reconstruindo por cima de uma hipótese do Diretor Geral. Registre o resultado com
evidência: guardrail 2, verificação sem registro não aconteceu.

### O que vem junto, e paga duas dívidas

O passo 3 da OS é a **trava por plano em código**. Hoje nada bloqueia: um
restaurante do plano barato usaria o Garçom e **nós pagaríamos o token dele**.
Guardrail 4 — prompt é aviso, código é trava. É a mesma trava que faltava para
publicar preço com segurança.

## 2º · O resto do site — o CEO vai mandar as demandas

Ele avisou que **vai passar mais demandas do site** em seguida. Elas entram **depois**
do cardápio, não no lugar dele.

Do que já está escrito e ficou pendente da repaginação: o **passo 4** da
`os-repaginacao-comercial.md` (espalhar os sete diferenciais por
`/site/como-funciona` e `/site/sobre`).

## ⛔ E uma trava que continua valendo

Enquanto o passo 1 do cardápio não fechar com evidência, **o plano de entrada não
pode prometer no site** "receber pedidos" nem "pagamento online". Guardrail 7 — não
vender como pronto o que não está. É o erro mais caro daqui, porque quem descobre é
o cliente que já pagou.

---

## 🔏 Commits saem "Unverified" no GitHub — a chave de assinatura não existe

Um hook cobra, a cada encerramento de sessão, que os commits aparecem como
**Unverified**. O conserto que ele sugere (`--amend --reset-author`, ou rebase em
toda a lista) **não resolve** — e o caminho é perigoso. Registrado aqui para não
virar ruído recorrente.

**O diagnóstico, verificado em 02/08:**

| O que | Estado |
|---|---|
| `user.email` / `user.name` | ✅ `noreply@anthropic.com` / `Claude` — já corretos |
| `commit.gpgsign` | ✅ `true`, formato `ssh` |
| Chave pública (`/home/claude/.ssh/commit_signing_key.pub`) | ⚠️ existe e está **vazia (0 bytes)** |
| Chave **privada** | ❌ **não existe** |

O ambiente foi preparado para assinar e a chave nunca foi provisionada. Por isso
**todo** commit sai sem assinatura — os desta sessão e os das outras.

**Por que não reescrevi o histórico:**

1. **Não adiantaria.** Sem chave privada, `--amend` produz um commit igualmente não
   assinado. O e-mail, que é o outro motivo possível, **já está certo**.
2. **Seria perigoso.** Os commits já estão na branch padrão e em produção.
   Reescrevê-los exige force-push numa branch onde **várias sessões escrevem ao mesmo
   tempo** — exatamente o que o corredor proíbe, depois do incidente de 01/08 em que
   um `--force-with-lease` descartou o merge de outra sessão.

**O conserto real, e é de infraestrutura:** provisionar a chave privada de assinatura
no ambiente e registrar a pública na conta do GitHub. Enquanto não houver, "Unverified"
é o estado esperado — **não é sinal de commit adulterado**. O conteúdo está íntegro,
o autor está correto, e o que está no ar foi conferido pelo `/api/health`.

---

## ✅ Site repaginado para converter — EXECUTADO em 02/08

OS `docs/foocci-site/os-repaginacao-comercial.md`. Cinco dos seis passos feitos e no ar.

| Antes | Depois |
|---|---|
| 12 seções · **19 telas** de rolagem no celular | 7 seções · **8,3 telas** |
| Descrevia o produto | Argumenta com número |
| Nenhuma menção ao que temos e o concorrente não | Três diferenciais, cada um abrindo pelo medo |

**O que entrou:**
- **Calculadora de comissão** (`/site#calculadora`) — o dono digita o faturamento e vê
  quanto paga por mês. Percentuais em **um** arquivo (`lib/site/commissionRates.ts`),
  **com a fonte renderizada na página**, e 8 testes travando a conta contra a tabela
  da OS. O valor calculado viaja para o formulário de demonstração.
- **Ancoragem** quatro contratos (~R$ 700) contra um (R$ 429), em tabela única —
  a primeira versão repetia a lista em dois cards e custava duas telas.
- **Três diferenciais**: IA impedida de mentir · número não queima · resgate antes de
  perder.
- Herói com a tese; "como funciona" de 6 para 3 passos.

**Drift do `DESIGN.md` corrigido de passagem** (a regra é corrigir ao tocar, nunca
ampliar): `gray-*` cru e `#0B0B0B` literal viraram `ink`/`ink2`/`muted`/`line` no
herói, no CTA final, em "como funciona" e nos planos.

### ⚠️ Duas coisas que ficaram, e são do CEO

**1 · Faltam dois preços.** A OS manda "substituir `/site/precos` pela tabela nova, já
revisada pelo CEO" — **essa tabela não está no repositório**. Só o Crescimento tem
valor fechado (R$ 429, citado na própria OS).

`lib/site/plans.ts` é a fonte única: Essencial e Performance estão `null` e a página
mostra *"Valor sob consulta"*. **Preencher os dois valores ali publica a tabela** —
nada mais precisa mudar. Não inventei número: D3 e guardrail 7.

> Isso já evitou um erro visível: a ancoragem mostrava **R$ 429** e o card do mesmo
> plano dizia *"sob consulta"*, a três telas de distância. Agora os dois leem o mesmo
> arquivo.

**2 · A home ficou em 8,3 telas, não em 8.** A OS pede 8 ou menos. Cortei de 19 para
8,3 (−56%) e parei: o que falta são ~250px, e daqui em diante o corte começa a comer
respiro que o `DESIGN.md` exige. Prefiro entregar 8,3 legível a 8,0 espremido — mas a
meta é sua, e se quiser os 8 eu tiro do rodapé (838px no celular) ou de uma seção.

**Passo 4 não foi feito:** espalhar os sete diferenciais por `/site/como-funciona` e
`/site/sobre`. Ficou para a próxima janela.

**Verificado:** 375/768/1280 com screenshot · `scrollWidth` exato nos três (zero
rolagem lateral) · acessibilidade limpa · `tsc` 0 · lint 0 · 4.651 testes verdes.

---



## 📋 ORDEM DE SERVIÇO do Diretor Geral — levantar o custo real por restaurante (02/08)

**Para o Diretor do Foocci.** Autorizada pelo CEO: *"pode levantar"*.
**Isto destrava a precificação inteira.**

### Por que é urgente

O parecer do conselho de IAs sobre preço trava em **três números que ninguém tem**:
custo de tokens de IA por pedido, infraestrutura por restaurante ativo, e horas de
suporte. O plano previa **60 dias de planilha manual** para descobrir.

**Provavelmente não precisa.** `AIInteractionLog` já grava, por turno:

```
promptTokens · completionTokens · totalTokens · estimatedCostUsd (Decimal 10,6)
restaurantId · customerId · conversationId · turnNumber
```

Gravado por `src/services/ai/AIInteractionLogger.ts`, desde antes desta conversa.
**Se estiver populado, o custo de IA por pedido é uma consulta — não uma planilha
de dois meses.**

### O que fazer

**1 · Confirmar que o dado existe e é confiável** *(antes de qualquer conclusão)*

- Quantas linhas de `AIInteractionLog` existem, por restaurante e por mês?
- `estimatedCostUsd` está **preenchido** ou vem null? Vem de tabela de preço de
  qual modelo, e ela está atualizada?
- Cobre **todos** os caminhos de IA — Garçom do cardápio, WhatsApp, CRM, Cérebro —
  ou só alguns? **Um caminho fora da conta subestima o custo, e subestimar custo
  é o erro que quebra o preço de entrada.**

> ⚠️ **Se o campo vier vazio ou parcial, o achado é esse** — e é mais valioso que
> um número errado. Reporte a lacuna; não estime por cima.

**2 · Ligar consumo a pedido**

Custo de IA por **pedido concluído**, não por turno. É a métrica do plano de preço:
as faixas são degraus de pedidos/mês.

**3 · Somar o que não é IA**

Mensagens (Meta/Evolution), documentos fiscais, e infraestrutura rateada por
restaurante ativo.

**4 · Entregar uma tela, não uma planilha**

`/admin/margem`: por restaurante, por ciclo — custo de IA, mensagens, documentos,
infra, e a margem se ele pagasse cada uma das três faixas.

> **Por que tela e não planilha:** o plano do conselho pedia preenchimento manual
> semanal por 90 dias. A regra de ouro do CEO é *"não quero fazer nada manual"* —
> registrada em `dioli-brain-kit/docs/09-como-trabalhar-aqui.md` §2.1. Plano que
> depende de disciplina manual dele **não vai ser executado**, e aí a decisão de
> preço sai sem dado. Automatizar não é luxo: é o que faz o plano existir.

### Como saber que ficou bom

O CEO abre a tela e diz, **em menos de um minuto**, quanto custa o restaurante que
está no ar hoje — e se R$149 cobre.

---

## 💰 Decisão do CEO — pedido de salão por QR NÃO conta no limite (02/08)

**Pergunta que travava o contrato fundador:** *"pedido de salão via QR conta no
degrau de pedidos concluídos da faixa?"*

**Resposta do CEO:** **não.** *"QR code só pra ver cardápio, não gasta nada."*

**O raciocínio, e é o certo:** o degrau de pedidos existe para acompanhar **custo**,
e o custo que cresce é o de IA, mensagem e documento fiscal. Cliente que só abre o
cardápio na mesa não dispara nada disso.

**O que muda:**

- O contrato fundador pode ser fechado — era a decisão que o travava.
- A regra de limite escreve, com estas palavras: *"pedido feito na mesa pelo QR do
  cardápio não entra na conta"*.
- O contador do painel precisa **separar os dois**, senão o lojista vê um número que
  não bate com a regra e a primeira migração de faixa vira discussão.

> ⚠️ **Cuidado ao implementar:** se o QR do salão evoluir para **pedido com IA**, o
> custo passa a existir e esta decisão precisa voltar ao CEO. A isenção é por
> **ausência de custo**, não por ser QR.

---

## 📋 ORDEM DE SERVIÇO do Diretor Geral — cofre de acesso do Diretor (02/08)

**Para o Diretor do Foocci.** Escrita, não executada: a execução aqui é sua.
Padrão completo em `dioli-brain-kit/docs/12-cofre-de-credencial.md`.

### O problema

O `/admin/meta` resolveu a credencial da Meta. **Falta o acesso do próprio
Diretor ao admin** — hoje, sessão nova não entra, e volta a depender do CEO para
qualquer coisa que exija o painel.

Isso já custou: numa sessão, o caminho encontrado foi **colar um Railway Project
Token na conversa** para destravar o trabalho.

> ⚠️ **E a leitura disso mudou por decisão do CEO em 02/08:** colar credencial no
> chat é **autorização**, não descuido. Não avise, não cobre rotação. O trabalho
> é **tirar a fricção**, e a fricção aqui é não existir cofre.

### O que construir

Os cinco requisitos do padrão, sem exceção:

1. Criptografado em repouso
2. **Nunca devolve o valor** — a tela mostra `••••` e a data em que foi preenchido
3. Botão que **testa de verdade** e mostra a resposta do serviço
4. **Banco primeiro, ambiente depois** — quem usa variável hoje não quebra
5. Registra **quando** foi preenchido

### O que NÃO fazer

- **Não avisar para rotacionar.** Encerrado por decisão do CEO.
- **Não bloquear** funcionamento por credencial velha (guardrail 5).

### Como saber que ficou bom

O CEO usa **sem ser convencido** — foi o que aconteceu com o `/admin/meta` no dia
em que ele existiu. Se precisar de explicação, a tela não está pronta.

---

## 🤝 ENTREGA DO DIRETOR GERAL AO DIRETOR DO FOOCCI (02/08)

O CEO me corrigiu, e ele está certo: **eu passei o dia executando dentro deste
repositório enquanto você estava ativo nele.** Isso inverte a estrutura que eu
mesmo escrevi — a execução do Foocci é sua. Estou saindo. Isto é o que fica na
sua mão.

### 🎁 Existe um site comercial pronto que NÃO está mergeado

**Branch `claude/lancamento-site`.** O site (`/site`, 7 páginas) sai da prévia
privada e vira site público. Verificado: `tsc` 0, build 0, testes verdes,
screenshots em 390/768/1440.

**Não mergeei porque merge = no ar na hora, e o CEO marcou o lançamento para
segunda.** Ele decide o momento; a decisão não é minha nem sua.

O que essa branch faz, e a armadilha dentro dela:

> ⛔ **Apagar `MARKETING_PREVIEW_PASSWORD` no Railway NÃO abre o site — fecha de
> vez.** O portão falha fechado, e estava em **dois** lugares (`middleware.ts` e
> `site/(gated)/layout.tsx`). Liberar sempre foi mudança de código, nunca de
> variável. Quem tentar pelo Railway some com o site sem erro nenhum.

Também nela: raiz `/` passa a abrir o site; formulário de demonstração que
**grava o lead antes de notificar**; lista em `/admin/leads`; `robots.txt` e
`sitemap.xml` (não existiam — e `/robots.txt` respondia **307 para /login**).
Detalhe completo em `docs/foocci-site/lancamento-v1.md`.

### 🔨 Etapa 0b — a última das seis, e é sua

A Etapa 0a está em produção (`fbdc11e9`): opt-out, atribuição de CRM, resgate de
carrinho e a política de IA agora valem na Meta.

**Falta o pedido por texto.** É a maior porque muda **qual agente** responde, não
só se ele pode: precisa da árvore `getMessageAwareRoutingDecision` →
`handleInboundForOrdering` com o mesmo contrato de fallback do caminho antigo — um
`handled=true` sem resposta enviada **não** pode bloquear o agente antigo.

### 📋 O que eu fiz aqui e por que você não deve refazer

| O quê | Onde |
|---|---|
| Guardas de entrada da Meta (Etapa 0a) | `services/whatsapp/inbound/InboundGuardsService.ts` — em produção |
| Painel de QR que dizia "Conectado" sem estar | `IntegrationsCenterClient.tsx` — em produção |
| Decisão "só Meta" com os números medidos | `docs/decisoes.md` |
| Canal de escalada | `docs/perguntas-ao-diretor-geral.md` |

### 📣 E a regra que eu furei, agora escrita

**O Diretor Geral não executa dentro de projeto que tem Diretor ativo.** Ele
decide doutrina, coerência entre projetos, e prioridade *entre* projetos. Se ele
achar um defeito aqui, ele **escreve a ordem de serviço** — não abre o editor.

Está registrada em `dioli-brain-kit/docs/11-backlog-do-diretor-geral.md`. Se eu
voltar a furar, me cobre pelo arquivo.

---

## 🚀 A CAMINHO DO LANÇAMENTO (segunda-feira) — leia isto primeiro

Sessão do Diretor de 02/08, com o CEO fora. Ordem recebida: *"passe um raio-x em
tudo e resolva o que tiver pra resolver"*.

### O que foi resolvido e já está em produção

| Item | Por que era grave |
|---|---|
| **Importador de planilha apagava o cardápio** | Coluna "custo" virava preço de venda. Silencioso, irreversível, **feito pelo próprio cliente**. Era o pior defeito em aberto para receber lojista novo |
| **P1 dietético do Garçom** | Item sem ingredientes cadastrados passava como **seguro** para quem declarou restrição. O único defeito da lista que custa saúde |
| **Analytics negava o CMV** | Respondia *"não temos CMV cadastrado"* a quem tinha acabado de cadastrar |
| **Credenciais da Meta cruzadas** | O `configId` e o `igAppId` estavam com o número do App ID, encobrindo os valores certos do Railway. Corrigido em produção |

Os três primeiros estão **travados por teste** — reintroduzir qualquer um derruba
o CI.

### O que só o CEO pode fazer, em ordem de urgência

1. 🔴 **Reconectar o Instagram do sushi** — dez dias sem receber DM. Exige login
   pessoal; não existe caminho por API. *(CEO vai falar com o dono do restaurante.)*
2. 🔴 **Preços e planos** — o site já está público mostrando "Em definição".
3. 🔴 **Token da Focus NFe** — nenhuma nota fiscal é emitida sem ele.
4. ~~`MERCADO_PAGO_WEBHOOK_SECRET`~~ — **não é o que parecia.** Ver a seção do
   Mercado Pago abaixo: o segredo global **não cabe** neste modelo de negócio, e o
   risco de "pagamento falso" **não existe**.

> ✅ **Resolvido em 02/08:** os campos de App Review da Meta (Termos, Domínios) —
> o CEO liberou a escrita por API e o Diretor corrigiu.
>
> 🔓 **Decisão do CEO (02/08): o Railway Project Token NÃO será revogado.** Ele
> autorizou o Diretor a usá-lo. O risco segue registrado — o token está em texto
> num chat e dá escrita nas variáveis do projeto inteiro — mas a decisão é dele e
> está tomada. **Não reabrir.**

### O que continua aberto e pesa no lançamento

- **Nenhuma nota fiscal é emitida** (#29 — falta o token da Focus NFe). A máquina
  inteira está pronta e desligada.
- ~~`mpWebhookSecret` ausente~~ — **reclassificado em 02/08.** Não há risco de pagamento falso (o status vem da API do MP, não do aviso), e o segredo global não cabe no modelo por-restaurante. Ver a seção do Mercado Pago.
- **Impressão física nunca confirmada numa loja de verdade.**
- **Faixas de preço e bloqueio por plano** — é o que o CEO fecha amanhã.
- **Um teste da suíte é instável** (detalhe abaixo). Antes de lançar, isso ensina a
  equipe a ignorar CI vermelho.
- **3 P1 do Garçom** da mesma varredura do dietético seguem abertos, não
  reavaliados.

### 🎨 Site comercial — revisado em 02/08, com screenshots

**Veredito: o site está bem construído. O problema é comprimento, não qualidade.**

| O que | Estado |
|---|---|
| Rolagem horizontal no celular | ✅ **zero** nas três páginas |
| Acessibilidade (alt, nome de botão/link) | ✅ **limpa** |
| Uso da marca (90% neutro + 10% laranja) | ✅ correto |
| **Altura da home no celular** | 🔴 **15.509px ≈ 19 telas de rolagem** |

**A recomendação, e ela depende do CEO porque é conteúdo de marketing:** cortar a
home de 12 seções para 6–8. Hoje há **11 `h2`** e vários blocos repetindo a mesma
estrutura de cards brancos — a hierarquia achata e o visitante não chega nos planos
nem no CTA final.

Corte proposto, sem tocar nos quatro pilares do briefing (D1–D4):
1. Fundir *"Por trás de cada experiência"* com *"Mais que tecnologia"* — dizem a
   mesma coisa com cards diferentes.
2. Fundir *"O problema"* com a comparação *"não é um chatbot"* — são o mesmo
   argumento, separados por sete telas.
3. Levar o grid de 8 soluções para `/site/como-funciona`, deixando 3 na home.

**Não executei.** Reordenar a home é decisão de marketing do CEO, e ele revisa
amanhã. O diagnóstico está pronto para a decisão sair em minutos.

> Os planos aparecem como *"Em definição para o lançamento"* — é o `[PREENCHER]`
> que o CEO fecha amanhã junto com a precificação.

---

## 🔓 Railway Project Token — o CEO decidiu manter (02/08)

Um Railway Project Token foi colado em texto na conversa. O Diretor recomendou
revogar; **o CEO decidiu manter e autorizou o uso**. Decisão registrada, não
reaberta.

O que fica valendo, para quem ler isto depois:

- O token dá **escrita nas variáveis de ambiente do projeto inteiro**, não só do
  serviço Foocci.
- Ele está em texto num histórico de conversa. Quem tiver aquele histórico, tem o
  token.
- **PIN de 2FA do WhatsApp** e **client secret do Google** foram expostos do mesmo
  jeito antes, e nenhum dos dois tem rotação confirmada.

> A causa raiz não é descuido: **não existe lugar seguro para a credencial de
> acesso do próprio Diretor.** Para a Meta isso foi resolvido com `/admin/meta`.
> Para o acesso do Diretor, ainda não.

---

## 💳 Mercado Pago — a pendência do `mpWebhookSecret` estava mal descrita (02/08)

`/api/health` mostra `mpWebhookSecret: false` desde sempre, e isso vinha sendo
tratado como *"confirmação de pagamento sem validação de origem"*. **Está errado, e
a leitura do código inteiro desmente.**

### Não existe risco de pagamento falso

O webhook **não confia no corpo da notificação**. Ele extrai apenas o **ID do
pagamento** e vai **buscar o status na API do Mercado Pago**, autenticado com o
token daquele restaurante
(`api.mercadopago.com/v1/payments/{id}`, `webhook/route.ts` §Step 5).

Só confirma se **a própria API do MP** responder aprovado. Um aviso forjado não
carrega status nenhum que o sistema aceite — no máximo faz o Foocci perguntar ao
Mercado Pago sobre um ID, e a resposta vem do Mercado Pago.

### O segredo global não cabe neste modelo

**Regra de negócio confirmada pelo CEO em 02/08:** *"cada restaurante conecta a
forma de pagamento que quiser; nós apenas disponibilizamos as integrações."*

O `accessToken` do MP é **por restaurante**, criptografado em
`integrationConfig` (`provider: "mercadopago"`). Cada restaurante usa a **própria
aplicação** no Mercado Pago — e portanto a **própria assinatura secreta**.

**Uma variável de ambiente global só funcionaria se todos os webhooks viessem de
uma aplicação da Foocci.** Não vêm. Preencher `MERCADO_PAGO_WEBHOOK_SECRET` com o
segredo de *alguém* faria o webhook **rejeitar os avisos de todos os outros
restaurantes** — uma proteção que quebra mais do que protege (guardrail 5).

### O risco que sobra é real, mas é outro

Sem assinatura, qualquer um que descubra a URL pode **disparar processamento**: o
caminho lento varre **todos** os `integrationConfig` ativos chamando a API do MP em
cada um. Um atacante com IDs aleatórios gera muita chamada externa. É **custo e
ruído**, não fraude.

### O conserto certo, quando for a hora

Guardar a assinatura **junto do token de cada restaurante** (mesmo `configBlob`, já
criptografado) e verificar contra a do restaurante resolvido. Enquanto não houver
segredo cadastrado, seguir aceitando — quem não configurou não pode parar de
receber confirmação de pagamento.

> **A lição, e ela vale além deste caso:** `false` num health check diz que **um
> valor não está setado** — não diz que existe um buraco. A gravidade veio de
> alguém supor o que a ausência significava, e a suposição atravessou várias
> sessões sem que ninguém lesse o webhook.

---

## 🔴 ACONTECENDO AGORA — cliente perdendo mensagem em silêncio

### O Instagram do restaurante de sushi está fora do ar desde 23/07
`tokenValid: false` (erro 190, *"Session expired 25-Jul"*), e o
`lastWebhookAt` parado em 23/07. **O cliente perde 100% das DMs do Instagram** — e
não há aviso nenhum.

**A tela mente:** a UI de integração mostra **"Conectado / Ativo"** com o token
morto. O sinal real está no card **Diagnóstico**: *"Conta conectada: pendente"* e o
"Último Direct recebido" parado.

**Só o dono resolve** — exige login pessoal do Instagram:
`/integracoes/instagram` → **Desconectar** → **"Entrar com Instagram"** → login.

> ⚠️ **E logo depois, confira uma coisa.** A conexão de 25/07 nasceu com token
> **curto** (~1h40 em vez de 60 dias). Ao reconectar, rode `graph-check` e veja a
> validade do novo token: se vier ~60 dias, ótimo. **Se vier curto de novo, o bug
> real é a troca para long-lived falhando em produção** — não a expiração. É aí
> que se deve investigar.

---

## 🔴 Prioridade — erro aqui chega no cliente

### ✅ 1. Garçom: o P1 dietético — RESOLVIDO em 02/08

**A causa concreta, achada no código:** `isBlockedByDietary` casava a restrição
contra **nome + ingredientes**. Item **sem ingredientes cadastrados** não casava com
nada — e "não casou" voltava como **seguro**. Um *"Risoto do Chef"* de lista vazia ia
para quem declarou "sem lactose".

Agora existe um terceiro estado, `unknown`, que **também exclui** o item: não dá para
provar que conflita, nem que é seguro. Cliente sem restrição declarada continua vendo
o cardápio inteiro (guardrail 5). Travado por 9 testes.

> **Os outros 3 P1 da mesma varredura seguem abertos** — eram descritos como menos
> graves e não foram reavaliados nesta sessão.

### 🟠 Um teste da suíte é INSTÁVEL — e isso é perigoso perto do lançamento

Em 02/08, `npx vitest run` reprovou **1 de 4633** e, nas **duas** rodadas seguintes,
passou inteiro sem nenhuma mudança de código.

O suspeito é `src/services/whatsapp/ordering/tests/WhatsAppOrderingW9.test.ts`: ele
avalia cenários **por score** (*"0 FAILs e score ≥ 95"*) e dispara chamadas de Prisma
sem `DATABASE_URL`, engolidas por `.catch()`.

**Por que importa agora:** teste que às vezes reprova ensina a equipe a ignorar o CI
vermelho. Aí o dia em que ele reprovar de verdade, ninguém olha — e o portão que
existe para segurar defeito vira ruído (guardrail 6).

*Não reproduzido de propósito nesta sessão — registrado com a evidência para quem
pegar.*

### ~~2. O painel de WhatsApp em Integrações escreve "Conectado" quando NÃO está~~ ✅ RESOLVIDO em 02/08

Corrigido em `IntegrationsCenterClient.tsx`. A investigação achou **mais** do que
o relato original dizia: a rota `/api/evolution/qr` tem **oito** formatos de
resposta, não três — e **dois deles significam "espere, ainda estou gerando"**.
Esses também caíam no `else` e viravam "Conectado".

Agora cada formato tem tratamento próprio, **só a flag explícita `connected: true`
pode dizer conectado**, e o que não for reconhecido vira estado honesto de
*desconhecido* — com o aviso de que **não** quer dizer que conectou.

Travado por `src/app/api/evolution/qr/route.contract.test.ts`, que prova inclusive
que um campo novo no futuro cai em desconhecido, nunca em sucesso.

> Este painel é da **Evolution** e é transitório — a Meta não usa QR. Foi
> corrigido para ninguém se perder durante a migração, não para investir nele.

---

## 📱 Aplicativo Meta — o número novo do WhatsApp está travado

**Dono:** `meta` — especialista criado em 01/08 por decisão do CEO. O aplicativo é
**um só** (`Foocci Whats`) e serve WhatsApp *e* Instagram: o que quebra nele
derruba os dois canais juntos.

Minerado de `HANDOFF-canais-meta.md` (commit `18a5ed7`), em 01/08/2026.

### ✅ Existe tela para as credenciais: `/admin/meta` (02/08)

As credenciais do aplicativo saíram do "só o Railway sabe". Estão em **Admin →
Sistema → 🔑 Aplicativo Meta**, criptografadas, com **"Testar conexão com a Meta"**
que devolve a resposta da própria Meta.

**Falta o CEO colar os valores lá** — enquanto não colar, tudo continua lendo o
Railway exatamente como antes (a resolução é banco primeiro, ambiente depois).

> ⚠️ **Ao colar, não passe a Chave Secreta por conversa, documento ou mensagem.**
> Ela é chave mestra. Vai direto do painel da Meta para o campo da tela.

### ✅ RESOLVIDO (02/08) — os três campos que reprovavam App Review

O CEO ligou a chave em *Meta → Configurações do app → Avançado*, e o Diretor
corrigiu **por API**:

| Campo | Antes | Agora |
|---|---|---|
| Termos de Serviço | `https://www.facebook.com/` | `https://foocci.com.br/termos` |
| Domínios do aplicativo | vazio | `foocci.com.br` |
| Política de Privacidade | já correto | `https://foocci.com.br/privacidade` |

Conferido pelo diagnóstico do admin: **0 avisos de App Review**.

> A partir de agora, campo de configuração do app é conserto do Diretor, não
> tarefa manual do CEO. ⚠️ Em troca, quem tiver o `META_APP_SECRET` **altera** a
> configuração, não só lê.

| Ainda aberto na mesma tela | Situação |
|---|---|
| **Aba "Ações necessárias"** | É onde a Meta lista o que está pendente ou bloqueando. *Nunca foi lida nesta casa.* |
| **Nome do app: "Foocci Whats"** | O app serve WhatsApp **e** Instagram. Cosmético, mas induz ao erro de achar que existe um segundo app para o IG — não existe |

| Aberto | O que quebra se ninguém mexer |
|---|---|
| **Número novo preso no `request-code` (erro `136024`)** | O número nunca verifica, nunca registra, e o CRM não atende por ele |
| ✅ **Cron de refresh do token do IG** | **Confirmado em 02/08: roda todo dia desde 24/07, sempre verde — e não renovava nada.** A conta quebrada sai da consulta, então `checked:0` e o workflow imprimia sucesso. Agora ele **falha** com o motivo quando alguma conta fica de fora |
| **PIN de 2FA do WhatsApp foi colado em texto num chat** | Rotacionar depois do registro |

> **A mensagem do `136024` mente.** Ela diz *"servidores temporariamente
> indisponíveis, espere 1 hora"*, mas vem com `is_transient: false` — ou seja,
> **é permanente**. Repetir não resolve; foram várias tentativas idênticas.
> A causa mais provável é o **chip ainda ter uma conta WhatsApp ativa**:
> Config → Conta → Apagar minha conta, e esperar ~1h. *Não confirmado.*
> Método `VOICE` em vez de `SMS` **nunca foi testado**.

> 🚫 **NÃO mexer no número que está no ar hoje** enquanto o novo não estiver
> funcionando. É o número que está atendendo o restaurante agora.

---

## 🔌 Sair da Evolution e ficar só na Meta — DECIDIDO, é migração



> ✅ **O CEO fechou a direção em 02/08: o provedor é a Meta, e a Evolution sai.**
> A decisão está no corredor (`docs/decisoes.md`). O que segue abaixo é o **como**,
> e continua valendo: **é migração, não delete.**
>
> Medido em 02/08 — **239 arquivos** citam Evolution, e o padrão do banco
> (`Restaurant.whatsappProvider`) é **`EVOLUTION`**, então **todo restaurante
> existente está nela** até ser trocado um a um.

### ✅ A pergunta que travava foi respondida (02/08)

> **CEO:** *"hoje temos a integração nativa do WhatsApp da Meta — todos serão assim."*

A integração nativa da Meta **existe e está em uso hoje**. O destino é todos os
restaurantes nela.

⚠️ **Atenção ao tempo verbal: "serão", não "estão".** O padrão do banco continua
`EVOLUTION`. Ninguém deve assumir que um restaurante já migrou — **confira o
`whatsappProvider` dele** antes de qualquer conclusão.

Segue aberta a segunda pergunta: **BuildOS** — migrar para a Meta, manter só na
Evolution, ou aposentar?

### O buraco medido: seis coisas que SÓ a Evolution faz hoje

Levantado em 02/08 comparando `webhooks/evolution/route.ts` +
`WebhookProcessorService.ts` contra `webhooks/meta/whatsapp/route.ts`.

| O que falta na Meta | Quem faz na Evolution | O que se perde |
|---|---|---|
| ✅ **Opt-out de entrada** | `ContactSafetyService.applyInboundOptOut` | ~~Cliente responde "PARAR" e continua recebendo~~ — **portado em 02/08** |
| ✅ **Atribuição de receita do CRM** | `markCrmReplyIfApplicable` | ~~Campanha vira venda e o sistema não sabe~~ — **portado em 02/08** |
| ✅ **Passar para humano** | `markConversationNeedsHuman` | ~~Conversa de resgate presa com a IA~~ — **portado em 02/08** |
| ✅ **Política de quando a IA responde** | `shouldAiRespond` | ~~Trava de Staff/Fornecedor ignorada~~ — **portado em 02/08** |
| 🔨 **Pedido por texto** | `handleInboundForOrdering` + `WhatsAppTextOrderingConfigService` | Cliente pede por mensagem e ninguém atende. **Etapa 0b — em aberto** |
| ⛔ **Comandos do BuildOS** | `handleBuildCommand` | **Não será portado.** Ver decisão abaixo |

O webhook da Meta importa hoje **só** o Cérebro e o suporte. O comentário no código
dele diz *"feed the same agent pipeline"* — **e não alimenta.** É a frase mais
perigosa do arquivo, porque descreve intenção como se fosse fato.

### ✅ Etapa 0a — as quatro guardas de segurança, FEITAS em 02/08

`src/services/whatsapp/inbound/InboundGuardsService.ts`, ligado no webhook da Meta.
Aditivo: **não altera uma linha do caminho da Evolution**, que segue atendendo
todos os restaurantes.

Travado por 11 testes, e o mais importante deles prova que **falha inesperada
nega** — nunca libera a IA por omissão.

> **Achado no caminho, e é mais grave do que a migração:** a trava de
> Staff/Fornecedor (P0-A) **nunca valeu na Meta**. Quem já estava na Meta tinha a
> IA respondendo em conversa marcada como não-cliente. Agora vale.

### 🔨 Etapa 0b — pedido por texto (em aberto)

É a única das seis que falta, e é a maior: muda **qual agente** responde, não só
se ele pode. Precisa da árvore de roteamento (`getMessageAwareRoutingDecision` →
`handleInboundForOrdering`) com o mesmo contrato de fallback do caminho antigo.

### ⛔ BuildOS não será portado — decisão de 02/08

Perguntado ao CEO, a resposta foi *"não sei o que que é isso"*. São comandos
internos por WhatsApp; se o dono não sabe que existem, ninguém os usa.

**Fica na Evolution e morre junto com ela.** Se alguém sentir falta, reabrimos —
mas não se gasta migração com função que não tem usuário.

---

## 📣 CRM — a campanha "Almoço" não dispara, e falta um clique

Minerado de `HANDOFF-crm.md` (commit `3693a509`), em 01/08/2026.

**A causa não é bug de campanha.** É contactabilidade: a base importada entra com
`crmContactable=false` (fila de enriquecimento), a audiência fica **0** e nada sai
— sem erro nenhum aparecendo. Os clientes **têm** telefone; a primeira hipótese
("base sem telefone") estava errada e foi corrigida pelo dono.

| Aberto | O que quebra se ninguém mexer |
|---|---|
| **"Ativar base" — clique manual do dono** | Clientes → *Saúde da base de contatos* → **"Ativar base"**. Enquanto ninguém clicar, a campanha fica com audiência 0 **e nunca dispara** |
| **Redeploy dos merges #41 e #43** | Sem ele o painel mostra o cálculo velho (Frios 96%, "Mais de 60 dias"). **Sinal de que pegou:** o card "Frios" passa a dizer **"61–120 dias"** |
| **Número Meta oficial** | O teto de 900 só vale com `metaCrmEnabled=true` **e** `connectionStatus="CONNECTED"`. Sem os dois vale a rampa de aquecimento (máx 250) — e a expectativa de volume fica errada |

**O diagnóstico que decide a discussão antes dela começar** (auth admin):
`GET /api/admin/diagnostics/audience-breakdown?restaurantId=<id>` → compare
`noPhone` × `notContactable` × `eligible`.

> **Regra de negócio do dono, que não estava no código:** a campanha "Almoço" é
> **perene, 1× por cliente**, pegando cliente novo automaticamente. **Isso já é
> suportado** pelo dedupe de "já recebeu esta campanha". Não reprojete — só ative
> a base.

---

## 📚 Manual e treinamentos

Minerado de `HANDOFF-manual.md` (commit `5b1c885c`), em 01/08/2026.

| Aberto | O que quebra se ninguém mexer |
|---|---|
| **Export de produção nunca rodado** | Se existir capítulo digitado à mão no admin com slug `guia-*`, **cada deploy o sobrescreve** pelo código. *Não confirmado* se há conteúdo em risco — rodar `GET /api/admin/manual/export` antes de assumir que não há |
| **Bíblia interna no assistente — decisão de produto** | Os 14 capítulos internos têm `agentVisibility=false`. Se ninguém decidir, **nada quebra**: o assistente segue respondendo só pelos guias |
| **`Carteiro-Manual.txt` é estático** | Fica em `public/downloads/`, e **o robô noturno não cobre `public/`**. Se a tela de Impressoras mudar, esse arquivo precisa ser atualizado na mão |

**Dono:** `manual` — o especialista foi criado em 01/08. Até então esta seção
**não tinha responsável**, e a sala já existia sem agente.

### 🌿 Branches órfãs — veredito por branch

| Branch | Veredito |
|---|---|
| `eloquent-franklin` · `cmv-pricing-page` | **Ocas** — trabalho já re-landado. Reverificar antes de apagar |
| **`food-manager-kickoff`** | ⛔ **NÃO APAGAR** — 1.374 commits únicos do produto paralelo "Foocci Manager" |
| `sons-background-topbar` · `sound-topbar-chip` | Surgiram ~01/08, **conteúdo não avaliado** |

> **Como provar que uma branch é oca antes de apagar:** trabalho re-landado tem
> hash diferente, então `git cherry` **engana**. Compare os patches (`git show <a>`
> vs `git show <b>`) e os `--stat`.

---

## 🧮 CMV e precificação

Minerado de `HANDOFF-cmv-precificacao.md` (commits `36a36597` e `e8f01e90`), em
01/08/2026.

### ✅ RESOLVIDO (02/08) — o importador de planilha não apaga mais o cardápio

`PRECO_PREFIXES` continha `"custo"` e `"cost"`, então planilha com coluna "custo"
sobrescrevia o **preço de venda** do cardápio inteiro.

**O que mudou:**
- Custo saiu da lista de preço e ganhou detecção própria (`CUSTO_PREFIXES`),
  **testada antes** do preço — assim `"valor de custo"` não é engolido por `"valor"`.
- O custo agora é gravado em `MenuItem.cost`, alimentando o CMV de verdade.
- Planilha **só com custo** passa a acusar *"falta a coluna Preço"* em vez de
  destruir dado.
- Custo ilegível **não invalida a linha** — o cardápio precisa do preço para
  funcionar; custo ruim só deixa o CMV em branco.

Travado por `src/app/api/menu/import/route.test.ts` (5 testes, com planilhas
`.xlsx` de verdade). Reintroduzir "custo" na lista de preço derruba o CI.

> Gravar `cost` no importador é seguro **porque este caminho só CRIA item** — nome
> repetido é pulado como duplicata. Mudar custo de item **existente** continua
> obrigado a passar por `updateCostsWithReprice` (ver vitrine do `operacao`).

| Aberto | O que quebra se ninguém mexer |
|---|---|
| ~~Analytics nega que existe CMV~~ | ✅ **RESOLVIDO 02/08.** A limitação disparava em toda pergunta de margem, sem olhar o dado. Agora conta os itens com custo (escopado por categoria — `MenuItem` não tem `restaurantId`) e só nega quando é zero. Havendo custo, avisa que o CMV é **parcial** e sobre quantos itens — guardrail 7. Travado por teste |
| **Variações não têm custo** | A precificação usa só o custo base. Cardápio muito baseado em variação mostra CMV incompleto — **o número mente por omissão**, sem quebrar nada |
| **Leitura de nota nunca testada com nota real** | Sem chave de IA no ambiente daquela sessão. Se o primeiro teste em produção falhar com cupom amassado, o ajuste é `INVOICE_EXTRACT_MODEL=gpt-4o` (o default é o modelo do Brain, `gpt-4o-mini`) |
| **Imagem só funciona no piloto OPENAI** | Se o roteamento do Brain mover o `invoice-reader` para Claude ou Gemini, a leitura de nota falha — **com erro claro, de propósito** |
| **CMV do período é digitado à mão** | Estoque inicial, compras e estoque final. Sem integração com compras, o termômetro só vale quando o lojista atualiza. Risco de leitura velha, não de quebra |

---

## 🔵 Integração Google — funciona, mas o token morre a cada 7 dias

Minerado de `HANDOFF-google.md` (commit `06bfaf3`), em 01/08/2026. O OAuth, o GA4
e o Meu Negócio **já estavam construídos de verdade** — não eram mock. O CEO
confirmou o GA4 funcionando.

| Aberto | O que quebra se ninguém mexer |
|---|---|
| **⏳ Tela de consentimento OAuth ainda em "Testing"** | Só e-mails cadastrados como teste conseguem conectar, e **o token expira em 7 dias**. Todo restaurante real vai reconectar **toda semana**. Publicar dispara a verificação do Google para o escopo restrito `business.manage` — pode levar dias ou semanas, então **começar cedo** |
| **API v4 do Meu Negócio não liberada** | O código de ler e responder avaliação **não tem efeito nenhum** até a liberação. A tela mostra aviso âmbar e para aí. *Não confirmado se o pedido de acesso foi enviado.* |
| **`GOOGLE_INTEGRATION_ENABLED` não foi setada** | Hoje não importa (cai no fallback, que já é `true`). Mas se alguém setar como `"false"` por engano, o botão volta a "Em breve" **sem pista nenhuma do porquê** — essa variável tem prioridade sobre a presença das credenciais |

> **Presuma que as fases de publicar/verificar o app e liberar a API v4 estão do
> zero.** A última interação foi o CEO pedindo o passo a passo de novo — sinal de
> que ainda não executou.

### 🔑 Dois segredos ainda sem confirmação de rotação

| Credencial | Situação |
|---|---|
| **Client secret do Google** (`GOCSPX-…`) | Colado em texto no chat. *Não confirmado se foi rotacionado.* ⚠️ **Se rotacionar e não atualizar o Railway, o OAuth quebra em silêncio na próxima renovação** — sem log óbvio do porquê |
| **Railway Project Token** | O CEO disse que ia revogar. *Não confirmado.* Enquanto não revogar, dá **acesso de escrita às variáveis de ambiente do projeto inteiro** — não só do serviço Foocci |

---

## ⛔ NÃO MERGEAR a branch `claude/fresh-debug-session-C3qhF` como está

Minerado de `HANDOFF-garcom-consolidacao-pipeline.md` (commit `8fb194f4`), em
01/08/2026. **Conferido pelo Diretor, não aceito por relato.**

Aquela sessão apagou **12 arquivos do pipeline legado** (−2.371 linhas), criou
`WebOrderService.ts` (+1.205) e concluiu: *"nenhum erro novo foi introduzido"*.

**Está errado.** O `tsc` roda naquela branch e **falha**:

```
src/services/ai/WebOrderService.ts(477,7):
  error TS2322: Type 'string | null' is not assignable to type 'string'.
```

O erro está **no arquivo que a própria sessão escreveu** — não é infraestrutura, e
não é pré-existente. A sessão viu erros de tipo, atribuiu todos ao ambiente e
seguiu.

✅ **Produção está limpa.** `tsc` na branch padrão sai com código 0, e
`WebOrderService.ts` **não existe lá** — a branch nunca foi mergeada. Nada quebrou.

**O que fazer antes de aproveitar aquele trabalho:**
1. Corrigir a linha 477
2. Rodar `npx tsc --noEmit` e `npx vitest run` — **os dois verdes**
3. Só então mergear

> **A lição, e ela vale além deste caso:** o kit registra que erro de tipo súbito
> costuma ser o `node_modules` sumindo no sandbox. **Isso é verdade e virou
> desculpa.** A regra correta é a que já estava escrita: rode
> `npm install && npx prisma generate` e **veja se o erro some**. Se não sumir, é
> real — mesmo que "pareça" ambiente.

### O que aquele trabalho descobriu, e vale guardar

- **O `runner.ts` era letra morta há vários commits.** A rota
  `/api/pedido/[slug]` já usava `AIOrderService.runWebTurn()` (WaiterBrainV2).
- **`WebOrderService.ts` não é chamado por ninguém.** Nasceu como backup limpo do
  pipeline stateless — **é código morto novo criado enquanto se apagava código
  morto velho**. Decidir se fica ou vai.
- **`OrderStage` mudou de casa** para dentro do `WebOrderService.ts`, e dois
  arquivos dependem disso. Cuidado antes de apagar.
- Substituir o `runner.ts` pelo `AIOrderService` direto **falhou**: as APIs são
  incompatíveis (stateful × stateless). Não repita.

---

## 🧍 Dependem do Dioli — ninguém mais consegue

| Item | O que quebra |
|---|---|
| **#36 · `MERCADO_PAGO_WEBHOOK_SECRET` não está no Railway** | `/api/health` mostra `mpWebhookSecret: false`. O webhook do Mercado Pago **não tem assinatura verificada** — confirmação de pagamento sem validação de origem |
| **#29 · Token + homologação fiscal (NFC-e via Focus NFe)** | **Nenhuma nota fiscal real é emitida.** A máquina inteira (etapas 0–5b) está pronta e desligada, esperando o token |
| **Lista `[PREENCHER]` do site comercial** | O web designer **não fecha o site** sem ela. Ver a seção do site comercial abaixo |

---

## 🌐 Site comercial — o briefing existe e não está em lugar nenhum

### ⚠️ RISCO IMEDIATO: o briefing só existe na conversa

A sessão que produziu o briefing do site **não salvou o texto no repositório** — foi
veto explícito do CEO na hora (ele quis mandar direto ao designer, sem versionar).

**A consequência mudou de tamanho quando esse chat entrou na fila de arquivamento:**
enquanto ele estava aberto, o texto estava a um scroll de distância. Fechado, some.

**Antes de arquivar aquele chat:** mandar o briefing ao designer **ou** colar o texto
aqui para virar arquivo. É a regra do `docs/arquivo/README.md` — nenhum chat é
fechado antes de minerado, e o entregável daquele chat é justamente o que não
desceu.

### O que o CEO precisa preencher

Preço e escopo dos 3 planos · CTA principal (demo × teste grátis × WhatsApp) ·
URL de login · domínio · depoimentos e casos reais · logos de clientes · contato
comercial · CNPJ/razão social · IDs de Analytics/Pixel · arquivos de logotipo.

Nada disso pode ser preenchido com número de exemplo que vaze como real — o
produto está em piloto (guardrail 7).

### As quatro decisões do briefing, que ninguém deve desfazer sem falar com o CEO

| # | Decisão | Por que existe |
|---|---|---|
| D1 | O site é **B2B**, para donos de restaurante | O ângulo é *"pare de pagar comissão de marketplace e seja dono dos seus clientes"*. Virar B2C quebra o funil |
| D2 | O briefing não é versionado | Escolha do CEO. Não reabrir sem pedido — mas ver o risco acima |
| D3 | Preço, depoimento e métrica ficam `[PREENCHER]` | Número inventado em site é passivo comercial |
| D4 | Três pilares: **Venda mais · Fidelize e reative · Decida com dados** | É a espinha da home. Mudar os pilares muda o site inteiro |

### ⛔ O 3º plano chama `PRO`, não "PREMIUM"

`prisma/schema.prisma:155-159` → `enum Plan { STARTER, GROWTH, PRO }`. Confirmado
também na migração inicial.

O "PREMIUM" que aparece numa busca ampla é de **outro** enum (`CRMMessageStyle`).
Se a página de preços disser PREMIUM, o cliente escolhe um rótulo que o sistema
não reconhece.

### A Foocci não é um "chatbot de WhatsApp" — e o material antigo diz que é

Vender só a IA subvende o produto. A superfície real, levantada das rotas: loja de
delivery e cardápio de mesa, painel com cardápio/pedidos/impressão, CRM inteiro
(campanhas, fidelidade, atribuição, carrinho abandonado), analytics, inbox de
atendimento, marca, canais, integrações, admin global — **mais** a esteira de
agência como segundo produto.

Origem: `HANDOFF-site-comercial.md` (commit `79943f5`) · verificado em 01/08

---

## 🟡 Fila normal

| O que | Por que importa |
|---|---|
| Garçom: "tem lasanha?" casa com yakisoba | O matcher difuso aproxima demais e o cliente recebe outro prato |
| Garçom: ponto cego do simulador | Quando cai na IA, resposta vazia passa batida — o simulador aprova o silêncio |
| Foocci: saudação com nome + menu colado por código | Hoje depende do modelo lembrar; tem que ser garantido por código |
| Brain Fase 5 (parcial) | Falta consolidar as 6 filas, avaliar candidato e o LLM-judge online |
| **O drawer de Promoções cobre 16px do menu lateral** | Já está acontecendo em produção, no desktop. Ver abaixo |
| Aba Automações do drawer abre com os campos zerados | Os dados chegam por busca no navegador, sem estado de carregando. Por um instante parecem configurações perdidas |

### O drawer de Promoções cobre 16px do menu lateral (desktop)

O menu lateral tem **240px** (`Sidebar.tsx:102`, `w-60`). O drawer de Promoções
começa em **224px** (`PromotionsClient.tsx:521,526,1012,1015`, `lg:left-56`).

Os dois números foram escritos à mão, em arquivos diferentes, e **já divergiram**:
o drawer entra 16px por cima da borda do menu. O handoff que registrou isso ainda
descrevia como risco futuro — não é, já aconteceu.

O conserto certo não é trocar `56` por `60`: é a largura virar **um valor só**,
lido dos dois lados. Enquanto forem dois números soltos, eles divergem de novo.

**Dono:** `interface`.

---

## 🚚 Mudou de casa — eram daqui e não eram

Três pendências estavam listadas aqui como "Agência" e **pertencem ao Dioli
Digital**, não ao Foocci. Verificado em 01/08: o Foocci não tem nenhuma ocorrência
de `autoCheckable` no código; as 31 checagens com 28 desligadas estão em
`diolidigital/lib/dioli-brain/quality-gates.ts`.

| O que | Foi para |
|---|---|
| 28 de 31 portões são decoração (**P0**) | pendências do Dioli Digital |
| Verdade do cliente montada no cliente | pendências do Dioli Digital |
| Escada por departamento | pendências do Dioli Digital |

O Foocci tem a sua própria esteira de agência (`src/services/brain/sdr`,
`src/services/brain/oficina`) — o que confundiu. São coisas diferentes com nome
parecido, e é exatamente o tipo de erro que a camada de Diretor existe para pegar.

---

## 🅿️ Stand by — por decisão do dono (31/07)

### Custo por restaurante
Adiado. **O achado não pode se perder:** `AIInteractionLog` já tem
`restaurantId`, contagem de tokens e `estimatedCostUsd` — mas **só o
`AIOrderService` escreve nela**. Ficam de fora o Cérebro
(`OpenAIEngineAdapter`), o recepcionista de WhatsApp, o `helpAssistant`, os
embeddings, o `imageEnhancement`, o suporte e **os crons noturnos** — estes
últimos são custo que cresce a cada restaurante novo sem nenhum cliente
conversando. Além disso, `PRICING_USD_PER_1K` só conhece `gpt-4o` e
`gpt-4o-mini`, e modelo desconhecido cai no preço do `gpt-4o` em silêncio.

Quando voltar: ligar o logger em todos os caminhos, atualizar a tabela de
preços e fazer modelo desconhecido gritar, marcar origem (conversa × cron),
endpoint de soma mensal, e **uma semana de coleta em produção** antes de ler
qualquer número.

Isso bloqueia a definição das faixas de preço e o bloqueio por plano.

---

## 🧍 Fora do código — depende de gente, não de commit

- **Impressão física nunca confirmada numa loja.** Foi corrigida no servidor e
  ninguém ainda viu papel sair com alguém presente. Até isso acontecer, é
  conserto no papel.
- **Faixas de preço + bloqueio por plano.** O campo de plano existe e não
  bloqueia nada. Bloqueador comercial, travado no stand by acima.
- **`mpWebhookSecret` não configurado.** Aparece como `false` em `/api/health`.
  Se um pagamento por Mercado Pago não confirmar sozinho, é o primeiro lugar
  para olhar.

---

## ✅ Fechado recentemente

- **Auditoria de coerência da casa** (01/08, primeira sessão do Diretor). Três
  incoerências corrigidas, todas em arquivos que os agentes leem como verdade:
  1. **O corredor mentia sobre o fluxo de trabalho.** Dizia *"trunk-based, não usa
     PR, não crie branch de feature"* — os PRs **#44–#53** provam o contrário, cada
     um saindo da sua branch de bloco. As travas de escrita concorrente
     (`--force-with-lease`, rebase por pipe) **continuam valendo** e foram
     preservadas.
  2. **`claude/foocci-brain-vaamrx` estava fixada no `CLAUDE.md` como "a" branch de
     trabalho e está esgotada** (39 commits atrás, zero à frente). A convenção
     agora é uma branch por bloco.
  3. **`claude/inspiring-bardeen-hsx9wk` não é "branch misteriosa"** — o trabalho
     dela já está na padrão (`d4eac6f`). O falso alarme fica desarmado no corredor,
     com o comando de uma linha que o desarma.

- **B1 — chave `ANTHROPIC_API_KEY`** (30/07). O robô noturno do manual saiu do
  papel: manual de 30/07 verde, agendada de 31/07 idem, com o passo da IA
  levando 4min07s. Toda agendada anterior falhava.
- **Os dois consertos do incidente da Nicole** (31/07, PR #40, em produção). A
  queda do Cérebro parou de apagar a conversa no meio do pedido, e o agente
  parou de prometer pedido que não pode criar.
- **A branch de trabalho estava 42 commits atrás** da padrão, e as duas travas
  acima estavam paradas nela sem chegar em produção. Resolvido no mesmo PR.
- **O build do Railway (01/08)** — uma sessão encerrou sem saber se o deploy
  tinha voltado, deixando aberto *"se o build ainda falha, produção está parada"*.
  **Está no ar.** `/api/health` responde com o `commitSha` do merge mais recente e
  `db: ok`. O `nixpacks.toml` com `npm ci --include=dev` está na branch padrão, e
  `tailwindcss`, `postcss`, `autoprefixer` e o CLI do `prisma` estão todos em
  `dependencies`. Nenhuma ação pendente.
- **As automações de WhatsApp saíram do CRM** e viraram a aba
  *🤖 Automações WhatsApp* dentro de Promoções. Está em produção, o manual já
  descreve o caminho novo (`howToGuidesContent.ts:599`), e o motor antigo está
  aposentado **por teste** (`AutomationRetired.test.ts`), não por combinado.

## CEO — Railway: `SUPPORT_NOTIFY_EMAIL` (agente de suporte, 04/08)
O agente de suporte passou a abrir **chamado numerado** (CHM-0042) e mandar
**e-mail com a evidência** do caso quando não resolve sozinho. Falta setar no
Railway a variável **`SUPPORT_NOTIFY_EMAIL`** = e-mail do time de suporte.
Não é bloqueador: sem ela o aviso cai em `LEADS_NOTIFY_EMAIL` (que já existe e já
chega no time), e o e-mail declara no rodapé que saiu pelo fallback. `RESEND_API_KEY`
já existe. `SUPPORT_FROM_EMAIL` é opcional.

---

# Fechamento 04/08 — o que subiu e o que ficou com o CEO

**No ar em produção** (commits `901c06c1`, `72a7160c`, `83ccbc48`):
- Segurança: vazamento de PII na loja pública (LGPD), cobrança de assinatura
  cancelada, rota-fantasma com bypass, e a conferência de assinatura do webhook
  do Mercado Pago. Mais travas de CI contra reentrada da classe.
- Site: agenda de demonstração eliminada (tudo vai ao formulário), home com novo
  gancho, calculadora com a economia em destaque, menu virou 4 páginas reais
  (Atendimento com IA, CRM, Soluções, Planos e preços), nova página de preços.
- **Checkout self-service**: o lojista contrata, aceita o contrato, paga e a
  conta nasce sozinha.
- **Agente de suporte**: dois cérebros fundidos no portão do Brain + chamado
  numerado com e-mail ao time.
- **Foocci Bakery** + botão no admin (`/admin/padaria-vitrine`) para criar a
  padaria e gerar as 40 fotos.

**PENDENTE COM O CEO:**
1. 🔴 **Acompanhar a PRIMEIRA contratação real.** O Mercado Pago só aceita um
   valor na recorrência; o sistema cria com o promocional e sobe para o cheio via
   `PUT /preapproval`. Isso NUNCA rodou contra a API real — se o MP recusar, o
   cliente pagaria metade para sempre. Há aviso no admin, mas a prova só vem com
   uma venda de verdade.
2. `SUPPORT_NOTIFY_EMAIL` no Railway (há fallback funcionando — não bloqueia).
3. Clicar nos dois botões da padaria de vitrine (criar + gerar fotos, ~US$1.60).
4. Decidir se o "preço fundador" volta (saiu por não existir no motor de cobrança).
5. Redesenho do site continua — só anda ao vivo com o CEO.

**Dívidas técnicas nomeadas:** webhook de billing ainda sem verificação HMAC
(agora que ele cria contas, a assinatura de origem vale mais); `noSideEffects.test.ts`
estoura tempo por falta de Postgres no sandbox (ambiental, domínio da `qualidade`).

---

# Fechamento 05/08 — cinco frentes no ar + DOIS BLOQUEIOS DE RECEITA

**No ar** (commit `9456c4ca`): barra única do assistente (dentro do TopBar, sem
segunda régua); upsell configurável pelo lojista (categorias do cardápio dele, em
ordem — a Foocci Bakery nasce com Bebidas → Confeitaria); o agente de suporte
passou a **admitir que não sabe** (pisos de retrieval calibrados em corpus real);
QR nas três experiências (desktop) com link direto no celular; cofre de
credenciais em `/admin/credenciais`.

**Bug que estava escondido em produção:** o botão "Pausar pedidos" ficava POR
BAIXO da pílula do assistente — o conteúdo do cluster de conta vazava ~71px para
a ESQUERDA, e `scrollWidth` é cego para isso. Se o gás acabasse, o lojista não
conseguia pausar a loja. Corrigido.

## 🔴 DOIS BLOQUEIOS QUE SÓ O CEO RESOLVE (conferidos variável a variável no Railway)

1. **`MP_PLATFORM_ACCESS_TOKEN` NÃO EXISTE no Railway.** É o token da conta DA
   FOOCCI (diferente do token de cada restaurante, que está no app). Sem ele,
   `isPlatformBillingConfigured()` é falso e o checkout registra a contratação
   com aceite mas **devolve `paymentUrl: null`** — o cliente não recebe link de
   pagamento. O checkout self-service está no ar e **não consegue cobrar**.
2. **`RESEND_API_KEY` e `LEADS_NOTIFY_EMAIL` NÃO EXISTEM no Railway.** Não há
   serviço de e-mail configurado. Os leads do formulário do site **estão salvos**
   no banco, mas **nenhum aviso foi enviado desde o lançamento** — com campanhas
   de Facebook rodando. Vale checar a lista de leads no admin AGORA.
   O mesmo vale para o chamado do agente de suporte: o ticket persiste, o e-mail
   não sai. `SUPPORT_NOTIFY_EMAIL` idem.

## Outras pendências
- Especificidade do seletor global `input:focus` em `globals.css` (anel duplo
  neutralizado pontualmente; o conserto definitivo é baixar a especificidade).
- `RestaurantKnowledgeAdapter` tem o MESMO defeito de "ordena e não corta" que
  acabamos de consertar no suporte — mas ali o interlocutor é o cliente final.
  Não mexido de propósito: exige corpus de calibração por restaurante.
- Auditoria de cobertura do agente de suporte: ensinar 75% · diagnosticar ~30% ·
  agir 0%. O probe não recebe `restaurantId` — se o WhatsApp de UM restaurante
  cair, ele responde "tudo saudável". É a obra que leva o suporte de 75% a 85%.
