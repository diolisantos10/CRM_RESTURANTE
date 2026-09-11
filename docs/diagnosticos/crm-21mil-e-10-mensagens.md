# "21 mil de audiência e só 10 mensagens" — o que realmente acontece

> **Pergunta do CEO, 28/08/2026:** *"Qual o problema do CRM do Foocci? 21 mil
> pessoas de audiência e só 10 mensagens enviadas?"*
>
> Diagnóstico somente leitura. Nenhum arquivo do produto foi alterado, nenhuma
> consulta rodada em produção, nenhuma mensagem enviada. Todo número aponta
> arquivo e linha; o que não deu para medir está nomeado como **não medido**.

---

## A resposta curta

**Os dois números não se comparam — e a hipótese que circulava sobre eles estava
errada.**

A hipótese era que "21 mil" fosse audiência de rede social e "10" fosse conversa
ativa. **Não é isso.** Varri o domínio do CRM: **nada ali lê seguidor, alcance ou
"quem viu"**. Os dois números saem do **mesmo lugar** — o painel de CRM — e são
incomparáveis por outro motivo, mais simples e mais bobo:

| | O que é | Recorte |
|---|---|---|
| **21 mil** | `Clientes na base` — `customer.count` | **desde sempre** |
| **10** | `Mensagens enviadas` — `campaignExecution.count` | **só o período selecionado** |

E **a tela abre sozinha em "Hoje"** — `CRMClient.tsx:6120-6123`, com o comentário
do próprio código: *"Default view is HOJE — the server-rendered stats are
all-time"*. O card de clientes traz na tela: *"não dependem do período"*
(`OverviewTab.tsx:583`).

**Ou seja: 21 mil é o estoque de uma vida; 10 é a venda da manhã.** Lado a lado,
na mesma tela, sem nada avisando que um é vitalício e o outro é de hoje.

**Isso explica o susto. Não explica o volume.** Ao medir, apareceram três causas
reais — e uma delas é defeito nosso, grave e silencioso.

---

## As três causas, em ordem de tamanho

### 1 · 🚪 Não existe porta. A audiência nunca teve como virar conversa.

**Este é o achado maior, e ninguém tinha perguntado por ele.**

Não há, em lugar nenhum do produto, um caminho que leve seguidor de Instagram a
virar conversa de WhatsApp. Conferi por varredura:

- **Zero** `wa.me` em `src/services/instagram/`.
- **Zero** leitura de `referral` / `ctwa_clid` no webhook do WhatsApp — é o campo
  que a Meta manda quando alguém chega por anúncio "clique para conversar". O
  produto do restaurante não o lê.
- **Comentário de Instagram vira cliente que o CRM não pode contatar:**
  `InstagramChannelService.ts:240-250` cria com `phone: null`,
  `crmContactable: false`, `contactStatus: "SEM_TELEFONE"`.
- **DM de Instagram entra por lista de teste** por padrão (`schema.prisma:4517-4518`).
- **Nenhum QR do produto abre conversa** — os que existem abrem cardápio, Pix ou nota.

**E a única porta que existe pode não dar em lugar nenhum.** O ícone "Falar no
WhatsApp" do cardápio (`MenuHero.tsx:69-81`) aponta para
`storeProfile.whatsappPhone` — **um campo de texto que o lojista digita à mão**.
Procurei quem confere esse número contra o número homologado na Meta
(`MetaWhatsAppConfig.displayPhoneNumber`): **ninguém confere**. Se divergirem, o
cliente conversa num número que **nunca chega na Central** — nada é gravado, e a
janela de 24h nunca abre para aquela pessoa.

> **Antes de investigar por que o CRM manda pouco, vale perguntar se alguém tinha
> por onde entrar.** Volume baixo com audiência grande costuma ser ausência de
> porta, não defeito de disparo.

**Natureza: ausência.** Não é defeito (nada quebrou) nem regra da Meta. É que
ninguém construiu.

### 2 · ⏳ A Meta ainda não aprovou os modelos — e sem eles a campanha fria não sai

**Regra da plataforma, não defeito nosso.** Fora das 24h desde a última mensagem
**do cliente**, o restaurante só pode falar por **modelo aprovado pela Meta**
(`metaSendPolicy.ts:37-57`). Campanha de reativação fala com gente fria, que por
definição está fora da janela.

Em **23/08** foram submetidos **84 modelos, todos `PENDING`**
(`docs/pendencias.md:139-146`). O código nunca escreve `APPROVED` por conta
própria — só copia o veredito da Meta (`MetaTemplateService.ts:296-307`) — e o
disparo exige `APPROVED` literal (`:363`).

⚠️ **Não sei se já foram aprovados.** Isso é de hoje, e só a Meta responde. É a
consulta mais barata e mais decisiva deste diagnóstico:
`GET /api/admin/meta/diag` devolve a soma por status.

**Um detalhe que muda o raciocínio sobre "audiência":** a janela de 24h é medida
**só sobre mensagens de WhatsApp** (`WhatsAppMessagingService.ts:50`). **Uma DM
de Instagram não abre a janela do WhatsApp.** Audiência de Instagram nunca vira
"posso mandar texto livre", nem em teoria.

### 3 · 🔴 Defeito nosso: toda campanha para em 500 pessoas, para sempre, em silêncio

Este é o que eu conserto.

`CrmCampaignService.ts:110` — `const MAX_AUDIENCE = 500; // safety cap`.

A audiência é resolvida com `take: 500` **ordenada por `lastOrderAt asc`** — ou
seja, **os 500 clientes mais antigos** (`:175-182`). E a exclusão de quem já foi
contatado acontece **depois**, em memória, no runner
(`ScheduledCampaignRunnerService.ts:560-566`).

**A consequência, em uma frase:** como o segmento FRIO não tem limite inferior de
data, **as mesmas 500 pessoas mais antigas ocupam a lista para sempre**. Contatadas
todas, o runner devolve *"No new eligible recipients this run"* e a campanha
**fica ACTIVE, muda, para sempre** — com **20.500 pessoas nunca alcançadas**.

**E é silencioso:** conferi — esse motivo não vira alerta em lugar nenhum. Só
aparece se alguém abrir o painel de depuração daquela campanha específica
(`CRMClient.tsx:3424-3432`). Nenhum raio-x, nenhum aviso, nenhuma tela de saúde
menciona campanha travada. Uma campanha morta é indistinguível de uma campanha
viva com pouca gente elegível.

**Como reconhecer em produção:** se `COUNT(DISTINCT customerId)` das execuções de
uma campanha bater em **exatamente 500**, é isto — e nenhum ajuste de teto diário
vai resolver.

### Mais três defeitos menores, achados de passagem

| Defeito | Efeito | Onde |
|---|---|---|
| A coluna **"Audiência"** da tabela ignora opt-out | a tela promete mais gente do que o envio aceita | `CrmAudienceService.ts:91-96` × `CrmCampaignService.ts:126-133` |
| O KPI escrito **"Audiência"** mostra tentativas acumuladas (`sent+failed+blocked+skipped`) | se o CEO leu "Audiência" ali, **o rótulo mentiu para ele** | `CRMClient.tsx:2452` × `ScheduledCampaignRunnerService.ts:2014` |
| Teto diário de **900** aplicado sem olhar o tier real do número (medido `TIER_250` em 23/08) | o sistema se autoriza 900/dia contra um teto de 250; as recusas voltam como falha de envio, não como "acabou a cota" | `crm-safety.ts:122` |

---

## O que NÃO é a causa — descartado com evidência

- **O runner está vivo, e com dois motores.** O agendador em processo
  (`instrumentation.ts:21-24`, tique de 10 min, **só em produção**) e o cron de
  reserva do GitHub Actions (`crm-cron.yml`, a cada 15 min). **Não é mecanismo
  órfão** — pela primeira vez nesta casa, a resposta a *"quem chama isto?"* é
  "dois, e os dois estão ligados".
- **Não existe flag global de "CRM desligado".**
- **Modo sombra não barra envio** — ele escolhe quem redige a frase, não se ela sai.
- **Horário de silêncio (21h–08h) e teto de 900/dia não explicam 10** — nenhuma
  campanha sozinha chega perto do teto global, porque o limite por card é 20–30/dia.

---

## A solução escolhida — uma, com custo e prazo

**Não é cardápio. É o que eu faço, na ordem, e o que precisa de decisão.**

### Eu faço — a partir de segunda

**Consertar o teto de 500 movendo a exclusão para dentro da consulta.** O erro não
é o número 500: é que os já-contatados são removidos **depois** do `take`. Subir
para 5.000 só move a parede. O conserto é o banco já devolver quem ainda não foi
contatado.

- **Custo:** um bloco de engenharia. Nenhum serviço novo, nenhum gasto.
- **Prazo:** segunda-feira, com teste que prova que a segunda rodada alcança
  gente diferente da primeira — e mutação que reprova se a exclusão voltar para
  depois do `take`.
- **Junto, porque é o mesmo arquivo:** alinhar a régua da tela com a do envio
  (opt-out) e corrigir o rótulo "Audiência" que mostra tentativas.

**Antes disso, hoje, custo zero:** rodar `GET /api/admin/meta/diag` e saber
quantos dos 84 modelos a Meta aprovou. **Se ainda estiverem pendentes, a causa
dominante é essa e nenhum conserto meu muda o número esta semana.**

### Precisa de você — a decisão de negócio

**Construir a porta de entrada.** Hoje a audiência do Instagram não tem como
virar conversa. As duas peças concretas seriam: ler o `referral` do
clique-para-WhatsApp no webhook, e conferir o número do botão do cardápio contra
o número homologado.

**Recomendo fazer**, e a razão é a ordem de grandeza: **consertar o disparo
melhora o alcance dentro de quem já é cliente; construir a porta é o que traz
gente nova.** Sem ela, o CRM continua sendo bom em falar com quem já comprou —
que é uma coisa útil, mas não é o que 21 mil sugere.

---

## ⛔ O que NÃO consegui medir — nomeado, sem estimativa

| Pergunta | O que falta |
|---|---|
| **Quantos dos 84 modelos estão aprovados hoje** — decide tudo | `GET /api/admin/meta/diag` |
| **De onde sai exatamente o "21.000" que o CEO viu** | não achei a tela com certeza; o candidato é `Clientes na base`, mas pode ser outra |
| **Qual período estava selecionado quando ele viu "10"** | é estado de tela, não é dado |
| **Por que os envios não saíram — o motivo já está gravado** | `SELECT status, "errorMessage", COUNT(*) FROM campaign_executions WHERE "restaurantId"=$1 AND "createdAt" >= now()-interval '7 days' GROUP BY 1,2;` — a consulta mais barata e decisiva |
| **Se alguma campanha já bateu nos 500** | `SELECT "campaignId", COUNT(DISTINCT "customerId") FROM campaign_executions GROUP BY 1;` |
| **Quantos contatos são contactáveis de verdade** | consulta no diagnóstico do especialista, seção 2 |
| **O tier atual do número** (medido `TIER_250` em 23/08) | mesmo diagnóstico da Meta |

**Nenhum número acima foi estimado.** Este documento vai para a mesa do CEO, e um
número inventado ali custa mais caro que uma lacuna declarada.
