# Raio-X do produto — 06/09/2026

> **Entrega em ondas.** Este documento cresce durante o dia. Cada departamento
> fechado entra aqui e é anunciado no PR. O que ainda não foi medido está
> nomeado como tal — nunca em branco por conveniência.
>
> **Onda 1 (03h20 UTC):** pedido e checkout · infra e publicação · as duas
> perguntas do CEO que já têm resposta.

---

## PARA O CEO — uma página

**A pergunta que gerou este raio-X já tem resposta, e ela é pior do que a suspeita.**

Os pedidos sem comanda não foram 26. São **33 pelo menos**, e o defeito não é de uma noite: **a impressão da comanda nunca funcionou.** Todo pedido, de todo restaurante, desde que o perfil de impressão entrou. O sistema mandava para o banco um caractere que o banco recusa — e o caractere vem da própria impressora, não do cliente.

**O conserto está pronto e esperando autorização** (PR #189). Não subiu porque nada sobe sem aval.

### O que mais foi encontrado no caminho do dinheiro

Três coisas que ainda não machucaram, e vão machucar:

1. **Quatro caminhos confirmam o pedido e nunca mandam imprimir.** O pior deles é justamente o botão que o lojista aperta quando o pagamento não confirmou sozinho: ele confirma o pedido e a cozinha continua sem saber.
2. **A numeração da nota fiscal repete.** Medido: em vinte notas tiradas ao mesmo tempo, o mesmo número saiu nove vezes. Nota com número repetido é rejeitada pelo governo. **Só machuca quando um restaurante ligar a emissão de nota** — hoje não sei se algum já ligou.
3. **O painel tem duas receitas diferentes.** Uma tela conta como venda o Pix que o cliente ainda não pagou; outra não conta. Os dois números aparecem para o lojista.

### E por que nada disso apareceu antes

Esta é a parte que interessa mais que os defeitos: **as réguas estavam verdes**.

- 293 testes verdes no caminho do dinheiro, com a comanda 100% quebrada.
- **Três testes exigiam exatamente o caractere que quebra o banco** — a régua protegia o defeito.
- **O monitor da fila de impressão ficava verde porque a fila estava vazia.** Ele perguntava "tem trabalho preso?" — e não havia, porque nada entrava. Quanto mais quebrado, mais verde.

Foi por isso que seis dias passaram sem ninguém ver.

### O que precisa da sua decisão

| | O que é | Se ficar parado |
|---|---|---|
| **1** | Autorizar o conserto da comanda (PR #189) | A cozinha segue sem papel, todo dia |
| **2** | Alguém precisa **ver papel sair** numa loja de verdade | Sem isso, "consertado" é só o que o código diz |
| **3** | Saber se algum restaurante já ligou a nota fiscal | Decide se o defeito da numeração é risco ou incêndio |

---

## Placar por departamento

| # | Departamento | Estado | Onda |
|---|---|---|---|
| 1 | Pedido e checkout | 🔴 **VERMELHO** | 1 |
| 2 | Cardápio, cupom e link do cliente | — | 2 |
| 3 | WhatsApp, agente e CRM | — | 2 |
| 4 | SDR e prospecção | — | 3 |
| 5 | Cobrança, assinatura e billing | — | 3 |
| 6 | Site institucional e as portas de contato | 🟡 **AMARELO** | 1 (parcial) |
| 7 | Painel e autenticação | — | 2 |
| 8 | Banco, migrações e integridade | — | 3 |
| 9 | Infra e publicação | 🔴 **VERMELHO** | 1 |
| 10 | Esteira de testes e CI | — | 2 |

---

## As cinco perguntas do dia

### 1 · Os pedidos perdidos — **RESPONDIDA, e a suspeita estava errada**

**Não é o `middleware.ts` do #180.** As falhas começam em **31/08**; o #180 entrou em **05/09**. Os dois itens foram juntados na leitura do meu relatório — eu reportei o middleware como *não auditado*, não como causa.

**Também não é caractere digitado pelo cliente**, que foi o que eu subi por cinco dias e estava errado. Um pedido sem nada de estranho já produz **seis bytes nulos**.

A causa são os **códigos de controle da própria impressora térmica**, emitidos de propósito por `src/services/print/ticketText.ts`:

| Constante | Bytes | O que faz |
|---|---|---|
| `BIG_OFF` (`:143`) | `GS ! 0x00` | volta a fonte ao tamanho normal |
| `EMPHASIS_OFF` (`:155`) | `ESC E 0x00 …` | desliga negrito |
| `CUT` (`:157`) | `GS V 0x00` | **corta o papel** |

O `0x00` é **parâmetro do comando**. Toda comanda termina com o corte, logo toda comanda carrega pelo menos um — e o Postgres recusa `0x00` em coluna de texto (`22021`).

**Números medidos:** em seis dias e três deploys, **33 falhas e ZERO enfileiramentos bem-sucedidos**. O `operacao` reproduziu contra Postgres real, pela rota `finalize` completa: pedido `CONFIRMED`, `PRINT JOBS: 0`.

**Conserto: PR #189**, aguardando aval. ⚠️ **Ele NÃO apaga o byte** — apagar transforma `GS V 0` em `GS V` e a impressora passa a engolir o próximo byte. Ele troca o `0x00` por uma sentinela ao gravar e desfaz no único ponto que entrega ao Carteiro, então o agente na loja recebe exatamente os mesmos bytes de hoje.

### 2 · Bombas-relógio nos testes — em medição (onda 2)

Uma confirmada: `DiarioDoSdr.test.ts` cravava 23/08 e explodiu sozinha em 06/09. Já desarmada no #187.

### 3 · Réguas verdes no lugar errado — **três já provadas**, varredura completa na onda 2

1. `src/services/print/PrintQueueService.test.ts:11-19` — o `prisma` inteiro é `vi.fn()`. Um dublê aceita o byte que o Postgres recusa: o teste chegava ao **objeto**, nunca ao banco, e portanto nunca ao papel.
2. `src/services/print/ticketText.test.ts:77` e `:120`, `src/services/fiscal/tests/fiscalArtifacts.test.ts:30` — **exigem** que o corpo termine em `GS V 0x00`. **A régua trava o byte que mata a gravação.**
3. `src/services/order/tests/PixPaymentP0.test.ts:47-52` — `const excludedFromDashboard = "AWAITING_PAYMENT"; expect(excludedFromDashboard).toBe("AWAITING_PAYMENT")`. Um arquivo chamado "P0" cujo caso central é uma tautologia.

**E o pior de todos, que não é teste — é monitor.** `src/services/raiox/probes/runtimeProbes.ts:223-243`: a sonda "alguma comanda deixou de sair?" conta linhas de `print_jobs` e devolve `PASS: "Fila de impressão limpa"` quando não há trabalho preso. **Fila vazia porque nada entra dá o mesmo verde de fila saudável.** Quanto mais quebrado, mais verde.

### 4 · O que mais está no ar sem ninguém olhar — em medição (onda 2)

Um já medido, e ele contradiz o "está resolvido": **o cabeçalho subiu ao ar ainda apertado.** Medi o HTML renderizado do commit que está em produção (`4c254574`): em **1024px a folga entre logo↔menu e menu↔botões é ZERO**. Não quebra hoje; quebra na próxima palavra. **PR #190** leva de 0 para 23px e traz a régua que mede largura de verdade — a primeira do repositório, porque **o CI nunca executou Playwright**.

### 5 · A publicação que empacou — **RESPONDIDA, com hora**

O deploy `c1edd2fa` (commit `4c254574`, o #187):

| Momento | O que aconteceu |
|---|---|
| **02:30:20** | deploy criado |
| **02:34:01** | **build termina com sucesso** — última linha `image push` |
| 02:34:01 → 03:01:57 | **nada. 28 minutos de ar parado. Nenhuma linha, nenhum erro.** |
| **02:58:22** | alguém dispara um **redeploy manual** (`bf34becd`, mesmo commit) |
| **03:01:57** | o contêiner sobe: `✓ Ready in 408ms` |

**A imagem foi construída e publicada; a plataforma não a iniciou.** Não é o nosso código — o build passou e o runtime subiu em 408 ms assim que teve chance. É uma parada do lado do Railway.

**O defeito nosso é outro, e é o que importa:** *nada vigia isso.* Já existe `/api/health` devolvendo `commitSha`; **ninguém compara esse `commitSha` com a ponta da branch.** Uma publicação que trava em silêncio é pior que uma que falha alto — a que falha alto se conserta; esta deixa todo mundo achando que subiu.

---

## Departamento 1 — Pedido e checkout · 🔴 VERMELHO

Levantado pelo `operacao` contra **Postgres real** (schema aplicado em banco local), não contra dublê.

### Estado por etapa

| Etapa | Estado | Evidência |
|---|---|---|
| Carrinho → validação de preço no servidor | 🟢 | `api/pedido/[slug]/finalize/route.ts:329-402` recalcula tudo do banco |
| Idempotência do checkout | 🔴 | `finalize/route.ts:129-143` |
| Taxa de entrega | 🟡 | `finalize/route.ts:470-471` |
| Pagamento — Pix | 🟡 | `finalize/route.ts:806-826` |
| Pagamento — cartão SumUp | 🟡 | `services/payment/confirmCardPayment.ts:36-149` |
| Pagamento — cartão MP | 🔴 código morto | `PaymentRouter.ts:53-61` |
| Pagamento — na entrega / retirada | 🟢 com ressalva | provado em Postgres real |
| Webhook MP → confirmação | 🟡 | `payments/mercadopago/webhook/route.ts:52-133` |
| Resgate do Pix perdido | 🔴 | `payments/mercadopago/reconcile/route.ts` é **botão**, não cron |
| Pedido preso em `AWAITING_PAYMENT` | 🔴 | `services/order/OrderService.ts:58-60` |
| Tela do cliente esperando o Pix | 🔴 | `api/pedido/payment-status/route.ts:27-37` |
| **Confirmação → comanda** | 🔴 **P0** | `PrintQueueService.ts:248` + `ticketText.ts:155,157` |
| Régua da comanda | 🔴 régua que mente | `PrintQueueService.test.ts:11-19`, `ticketText.test.ts:77,120` |
| Monitor da comanda | 🔴 verde no lugar errado | `raiox/probes/runtimeProbes.ts:223-243` |
| Disparo nos caminhos manuais | 🔴 | quatro rotas, abaixo |
| Fila → Carteiro | 🟡 | `PrintJobLease.ts:67-212` — correta e **nunca recebeu uma linha** |
| Nota fiscal — numeração | 🔴 | `FiscalEmissionService.ts:138-144` |
| Nota fiscal — número queimado no erro | 🔴 | `FiscalEmissionService.ts:172-179` |
| Nota fiscal — `PROCESSANDO` eterno | 🔴 | `FiscalEmissionService.ts:97,190-199` |
| Nota fiscal — DANFCE impressa | 🔴 | `fiscal/fiscalArtifacts.ts:19-20,54-63` — mesmo byte |
| Nota fiscal — classificação (NCM) | 🟡 | `nfceBuilder.ts:91-92,232-255` |
| Estados do pedido no painel | 🔴 duas verdades | `DashboardCockpitService.ts:273` × `api/dashboard/route.ts:28` |
| Suíte do domínio | 🔴 **como sinal** | 31 arquivos, **293 testes, 100% verdes** com a comanda quebrada |

### Os achados que mais custam

**A · Quatro caminhos confirmam o pedido e nunca mandam imprimir nem emitir nota.**
Webhook Stone, `mark-paid` Stone, `mark-paid` MP e `confirm-manual-payment` — nenhum chama `maybeEnqueueOrder`. **O mais grave é o último:** é a alavanca que o lojista puxa exatamente quando o pagamento não confirmou sozinho. Ele confirma o pedido, e a cozinha continua sem saber. **Mesmo com o byte corrigido, um restaurante em Stone nunca imprime.**

**B · A numeração da NFC-e colide, e o comentário jura que não.**
`FiscalEmissionService.ts:138-144` lê-depois-escreve sem trava de linha. O comentário do próprio bloco diz *"Reserve a número atomically so concurrent orders never collide"*. **Reproduzido:** 20 reservas concorrentes em Postgres real devolveram `100,101,101,101,101,102,102,102,102,103,103,104,104,104,104,104,104,104,104,104` — o número **104 saiu nove vezes**. Nota duplicada é rejeitada pela SEFAZ, e cada rejeição ainda queima um número, o que exige inutilização.

**C · Pagou, e o pedido pode não avançar — por três portas.**
`card/charge/route.ts:87-91` responde "aprovado" ao cliente com a confirmação em `.catch(log)` — cartão cobrado, pedido parado, só um log. `payment-status/route.ts:27-37` expira o Pix pelo relógio local **sem perguntar ao Mercado Pago**, e depois de `EXPIRED` o resgate nunca mais o encontra (`reconcile/route.ts:81` filtra `LINK_SENT`). E o resgate é botão, não rotina.

**D · Três estados que prendem trabalho para sempre.**
`AWAITING_PAYMENT` (nada expira, nada cancela, e a lista do painel nem o mostra), `FiscalDocument.PROCESSANDO` (`:97` bloqueia retentativa e `:190` só roda se um humano abrir a tela) e o pagamento `EXPIRED` fora do alcance do resgate. **Nenhum dos três nasceu com prazo e com resgatador.**

**E · O painel tem duas receitas.** `DashboardCockpitService.ts:273` soma `AWAITING_PAYMENT` no faturamento; `api/dashboard/route.ts:28` e `RevenueAttributionService.ts:30` não. O Cockpit conta como venda o Pix que ninguém pagou — e é o número que mais infla, porque nada expira esse estado.

**F · Idempotência do checkout com dois furos de dinheiro.** Janela em balde e não deslizante (`:139`): dois cliques na virada dos 30 s viram dois pedidos. E a chave ignora forma de pagamento e método de entrega (`:134-142`): quem gera o Pix, desiste e escolhe "pago na entrega" em menos de 30 s recebe **o pedido antigo, com o QR**.

**G · Credencial que não descriptografa vira "não configurado", em silêncio.** Quatro `catch` devolvendo `null` sem log (`paymentCredentials.ts:33,70`, `webhook/route.ts:46`, `finalize/route.ts:777-779`). Rotação de chave = pagamento online desligado em todo lugar, com **zero rastro** do porquê.

**H · Duas rotas públicas de cartão sem limite de tentativas nem autenticação** — `/api/pedido/[slug]/card/charge` e `/card/confirm`, enquanto `finalize` tem (`:153`). **Encaminhado ao `seguranca`** (onda 2).

**I · Frete R$ 0 silencioso.** `finalize/route.ts:470-471`: entrega sem configuração cobra zero e segue com um `console.warn`. Perda direta do lojista, invisível.

### ⚠️ Divergência que eu registro em vez de esconder

O `operacao` recomendou, como saída rápida, **remover o `0x00`** — e ele mesmo apontou o custo: `GS V 0` vira `GS V`, o papel para de cortar. **Eu discordo e não vou por esse caminho.** O PR #189 escapa o byte na gravação e o repõe na entrega ao Carteiro; a impressora recebe os bytes originais e o corte continua funcionando. Escrevi a versão que apaga primeiro, e foi a mutação que a matou antes do commit.

---

## Departamento 9 — Infra e publicação · 🔴 VERMELHO

| Item | Estado | Evidência |
|---|---|---|
| Build | 🟢 | `c1edd2fa`, build completo em 3m41s |
| Início do contêiner | 🔴 | 28 min de ar parado entre `image push` e o contêiner subir, sem uma linha de erro |
| Destravamento | 🔴 manual | só saiu com redeploy humano (`bf34becd`) |
| Vigia de publicação | 🔴 **não existe** | `/api/health` devolve `commitSha`; ninguém compara com a ponta da branch |
| CI executa navegador | 🔴 **nunca executou** | `grep playwright .github/workflows/` não devolvia nada até o PR #190 |

---

## CEGO — o que ninguém sabe, e o que destravaria

Esta seção é a mais importante do documento. É onde os defeitos de hoje estavam morando.

| # | O que ninguém sabe | O que destravaria |
|---|---|---|
| 1 | **Se algum papel já saiu de alguma impressora, alguma vez.** A máquina de fila está correta no código e **nunca recebeu uma linha**. Não sei se o Carteiro instalado nas lojas imprime ESC/POS RAW, nem se a serrilha corta. | Uma loja real, o Carteiro aberto, um trabalho inserido à mão, e **uma pessoa olhando a impressora**. Nada menos vale. |
| 2 | Quantos pedidos morreram sem comanda, e em quantas lojas | Leitura do banco de produção |
| 3 | Quantos pedidos estão presos em `AWAITING_PAYMENT` hoje, e quanto dinheiro isso é | A mesma leitura |
| 4 | **Se algum restaurante ligou a emissão fiscal** — decide se a numeração duplicada é risco ou incêndio | `SELECT restaurantId, enabled FROM fiscal_configs` em produção |
| 5 | Se algum restaurante usa Stone — decide se o achado A já machuca | Variáveis do Railway + configs de produção |
| 6 | Se `MERCADO_PAGO_WEBHOOK_SECRET` está configurado. Sem ele o webhook **aceita sem verificar** e só loga | Ler as variáveis do serviço no Railway |
| 7 | Se o webhook do MP realmente chega, e com que atraso | Painel do Mercado Pago do lojista + logs do mesmo período |
| 8 | Quantos clientes ficaram sem resposta no WhatsApp — **oitavo dia sem saber** | Leitura do banco, ou uma rota de contagem agregada |
| 9 | Departamentos 2, 3, 4, 5, 7, 8 e 10 | Ondas 2 e 3, hoje |

---

## Um achado sobre o nosso próprio processo

Rodei os especialistas em paralelo **no mesmo diretório de trabalho**, e dois deles se atropelaram: um `npm run build` meu falhou com `ENOENT: .next/server/pages-manifest.json` porque outro agente reconstruía ao mesmo tempo.

Não é anedota — é a mesma classe de defeito que o raio-X está caçando: **duas coisas escrevendo no mesmo lugar sem ninguém medir a colisão.** A partir da onda 2, cada especialista trabalha em cópia isolada.

---

# Onda 2 (05h UTC) — segurança e esteira de testes

## ⏰ URGENTE E COM HORA: uma bomba explode às 05:56 UTC de amanhã

`src/services/doutrina/kitEspelho.test.ts:545` confere se `docs/kit/_ESPELHO.json` foi carimbado há menos de **14 dias**. O carimbo atual é de **24/08 05:56** — hoje já são 12,9 dias. **Amanhã, 07/09 às 05:56 UTC, todo PR da casa passa a reprovar** com uma mensagem sobre doutrina, sem relação nenhuma com o que a pessoa mudou.

Provado, não deduzido: o `qualidade` rodou a suíte com o relógio deslocado em onze pontos (+1 a +900 dias). Em `+2` já sai `FAIL … ESPELHO_VELHO — não é conferido há 14.9 dias (limite: 14)`.

**É o mesmo defeito do diário do SDR, três dias depois.** O portão não acusa um defeito: **inventa um**, no dia em que ninguém espera.

**E a raiz é pior que a bomba:** o carimbo está parado porque `.github/workflows/kit-espelho.yml` (cron diário) **não conclui há 13 dias** — ele faz `exit 1` sem o segredo `DIOLI_BRAIN_KIT_TOKEN` (`:95,106`). Treze dias de vermelho diário, todo dia, e ninguém viu.

**Duas saídas, e eu preciso da sua palavra antes das 05:56:**
- **(a)** repor o segredo `DIOLI_BRAIN_KIT_TOKEN` no repositório e deixar o cron carimbar sozinho. Conserta a causa. **Só você ou o CEO alcançam esse segredo — eu não.**
- **(b)** eu afrouxo o prazo de 14 dias enquanto (a) não acontece. Destrava a casa em cinco minutos e **esconde** o cron morto.

**Recomendo (a), com (b) como ponte se (a) não couber nas próximas duas horas** — porque amanhã de manhã isso trava inclusive o merge do conserto da comanda.

> ⚠️ Não fiz nem um nem outro. A ordem é "só conserte o que for P0", e isto não é dinheiro nem porta aberta — é um freio de mão que vai travar a casa inteira. Estou pedindo a palavra, não a autorização genérica.

---

## Departamento 7 — Painel, autenticação e superfície exposta · 🔴 VERMELHO

**Antes dos achados, o que mais importa:** `docs/pendencias.md:1195-1210` já lista **quatro destes vermelhos** desde **05/08**, sob o título *"Dívida de segurança ainda aberta"*, com a frase escrita **"nenhuma foi corrigida"**. Um mês depois, nenhuma foi corrigida — e duas obras grandes (#177 e #180) passaram por cima da lista sem tocá-la.

**As portas novas estão boas. O buraco é o estoque antigo.** Medido de fora, em produção:
- Dioli Connect (#177): `GET /api/connect/cadastro` sem cabeçalho → **401**, não 503 — fail-closed e com o segredo configurado.
- Prospecção (#180): `GET` sem sessão → **401**.
- `/comercial` e `/admin`: as seis páginas → **307** para a tela de entrada.
- `src/middleware.ts` (#180): só desvia a raiz quando o host é o da Comercial. **Não deixa passar nada que antes não passasse.**

### Os quatro vermelhos antigos

| # | O quê | Evidência | P0? |
|---|---|---|---|
| 1 | **Webhook Saipos sem autenticação nenhuma** | `api/integrations/saipos/webhook/route.ts:37-61`. **Medido em produção:** POST anônimo → `{"ok":true,"handled":false,"detail":"cod_store not found: …"}` `[200]` | **P0 condicional** |
| 2 | **`/api/recover` — "o primeiro restaurante ativo"** | `api/recover/route.ts:30-33`, `findFirst` sem `orderBy`. **Medido:** `GET` anônimo devolve `{"recoveryAllowed":false,"reason":"owner_exists","restaurantName":"Sushi Cazza"}` | vaza nome de cliente **hoje** |
| 3 | **Stone: segredo ausente = passe livre** | `api/payments/stone/webhook/route.ts:27-40` segue sem o segredo, e `:83-90` grava `Payment=PAID` + `Order=CONFIRMED` | latente |
| 4 | **`repeat-order` aceita telefone sem prova de posse** | `api/pedido/[slug]/repeat-order/route.ts:36-38,58` — sem `rateLimit`, sem identidade | não |

**Sobre o Saipos, e por que "condicional".** O handler roda para qualquer chamador. A resposta é um **oráculo**: `cod_store not found` e `Order not found` são frases diferentes e não há limite de tentativas, então o código de qualquer loja integrada é enumerável. Com um código válido e um `order_id`, o mapa de transições (`:930-940`) permite `AWAITING_PAYMENT → CONFIRMED` — **o pedido não pago vira confirmado, imprime na cozinha e entra no faturamento. E o cliente tem o próprio `order_id` na mão.** Comida de graça, em auto-serviço. Também permite cancelar pedido alheio.

O dano exige que exista ao menos um restaurante com Saipos ativa. **Isso é uma linha do banco que eu não li, e não vou enumerar códigos de loja para descobrir — enumerar é o ataque.** Se a resposta for "sim, tem", isto vira P0 imediato. **É a primeira pergunta que eu levaria ao banco.**

**Sobre a Stone**, uma diferença que importa: Mercado Pago, SumUp e o billing **reconsultam o provedor** antes de confirmar — é a reconsulta, não a assinatura, que os sustenta. A Stone confia no corpo do POST. **É o único caminho de pagamento do repositório em que o corpo de uma requisição, sozinho, vira dinheiro reconhecido.**

**Sobre o `/api/recover`**, o detalhe que o torna pior que "latente": o `GET` **anuncia o estado publicamente**, sem credencial. Um atacante consulta em laço e toma a loja no minuto em que o estado virar. E o caminho para virar existe no par ao lado: `/api/admin/reset-owner` apaga **todos** os usuários do "primeiro restaurante ativo" — o mesmo seletor errado. Um operador que rodar isso mirando a loja X pode zerar a loja Y e, no mesmo ato, abrir a porta da frente dela.

### E uma régua que exige o defeito

`src/services/instagram/tests/InstagramChannel.test.ts:96` **exige** que `verifyInstagramSignature(raw, null, null)` devolva `true` — ou seja, **a suíte exige o fail-open**. E `webhooks/instagram/route.test.ts:24` mocka a função para `true`. **A verificação de assinatura do Instagram não tem uma linha de cobertura real.** Quem amanhã mexer no filtro abre o webhook para o mundo, e o CI fica verde confirmando o novo comportamento.

---

## Departamento 10 — Esteira de testes e CI · 🔴 VERMELHO

Suíte medida em árvore limpa: **584 arquivos, 7.969 testes, 7.931 passam, 38 pulados, 0 falham.**

### O CI barra duas coisas. Só.

`.github/workflows/ci.yml` tem **um job e quatro passos**: instalar → gerar Prisma → `type-check` → `test:unit`.

**Deixa passar:** tela quebrada, checkout quebrado, Pix quebrado, comanda não enfileirada, erro de tipo em teste, erro de tipo em script, `next build` quebrado, lint, e qualquer regressão de cobertura — **porque cobertura nunca foi medida.**

| Portão | Estado |
|---|---|
| Type-check de produção | 🟡 exclui testes, `scripts/`, `secretario` |
| Type-check de testes (`type-check:tests`) | 🔴 **existe e o CI não chama** — o próprio `tsconfig.tests.json` admite ~750 erros |
| Playwright | ⚫ **8 specs existem, zero rodam** — `checkout-flow`, `pix-payment-flow`, `cart-behavior`, `finalize-upsell`, `incomplete-address`… **o caminho do dinheiro inteiro** |
| Cobertura | ⚫ **nunca foi medida** |
| `next build` | ⚫ não roda no CI |
| 38 testes pulados | 🔴 **verde por ausência** |
| `quality-audit-cron.yml` | 🟡 lê só o status HTTP e **descarta o `globalStatus`** — auditoria noturna com P0 devolve 200 e pinta ✅ |
| `kit-espelho.yml` | 🔴 **morto há 13 dias** |
| Os outros 16 workflows agendados | ⚫ **cegos, por decisão escrita** |

### Os 38 pulados são a violação mais grave

Todos condicionados a variáveis de banco que **não existem em lugar nenhum** — nem no CI, nem no `package.json`. **Nunca rodaram**, e nada avisa que foram pulados:

- **11** — `identidadeNoBanco.rls.test.ts`: *"sem identidade declarada, NADA é visível"*, *"dois SDRs veem conjuntos diferentes"*, *"recusa id com aspas — o caminho da injeção"*. **O isolamento entre inquilinos no nível do banco é 100% não verificado.**
- **9 + 6** — corridas de dono de lead e de handoff (*"a trava é do banco, não do código"*).
- **6** — login interno: senha errada, conta desativada, *"AGENTE_IA não faz login nem com hash gravado"*.
- **4** — atomicidade de ordem de serviço.

**Trinta e seis dos 38 são segurança, autenticação e concorrência.** Esquecer o portão está significando "aprovado" — o guardrail 2 desta casa, violado 38 vezes por execução.

### Réguas verdes no lugar errado — a lista, por estrago

| # | Onde | Afirma provar | De fato prova |
|---|---|---|---|
| 1 | `raiox/collect/RaioXCollector.ts:262-296` | que a impressão está saudável | que **entre as comandas que existem** nenhuma travou. Zero comandas = saúde perfeita. **É o mecanismo do incidente** |
| 2 | `marketing/tests/topoEntrarEAssinar.test.ts:124,131` | que o convite "é botão" e "não quebra em duas linhas" | que duas substrings existem no `.tsx`. **Verdes enquanto a fileira encostava** |
| 3 | `simulation/automation.test.ts:16-48` | que o simulador do Garçom derruba o job | que o **YAML contém as strings das mensagens de erro**. Nunca executa uma linha do shell |
| 4 | `security/tests/alertasQueNaoMentem.test.ts:98-100` | que o simulador do Garçom continua existindo | **lê o arquivo errado.** Apagar `waiter-simulation-run.yml` amanhã não deixa este teste vermelho |
| 5 | `security/routeGuards.test.ts:200-209` | que toda rota de admin tem guarda | que um regex casa **em algum ponto do texto** — inclusive num comentário. *(O `seguranca` tentou refutar: auditou os 10 candidatos e os 10 são falsos positivos. Frágil por construção, sem violador vivo.)* |
| 7 | **64 arquivos** usam `readFileSync` para assertar sobre texto de código | comportamento | presença de substring |

**Nota justa:** vários desses 64 declaram no cabeçalho *por que* são teste de texto (o vitest roda sem DOM) e trazem as duas metades. Não é desleixo. **Continua sendo texto** — e o item 2 é a prova de que a metade "reprova quando deve" pode estar escrita e ainda assim medir a coisa errada.

---

## CEGO — acréscimos da onda 2

| # | O que ninguém sabe | O que destravaria |
|---|---|---|
| 10 | **Se existe algum restaurante com Saipos ativa.** Decide se o webhook aberto é P0 hoje ou risco amanhã | `SELECT * FROM integration_configs WHERE provider='saipos' AND "isActive"=true` |
| 11 | Se `STONE_WEBHOOK_SECRET` existe em produção. **Com ou sem segredo a rota responde 200** — é o pior formato de defeito, invisível dos dois lados | Ler as variáveis do serviço no Railway |
| 12 | Quantos restaurantes existem e quantos têm dono ativo — decide o tamanho do `/api/recover` | Leitura do banco |
| 13 | Se `ADMIN_SECRET` e `INTERNAL_SESSION_SECRET` já rotacionaram alguma vez | Não há registro de rotação em lugar nenhum do repositório |
| 14 | Se o token do Carteiro de alguma loja já vazou. É durável, em texto puro no banco, **nunca expira**, e não há trilha de uso | Nenhum sinal existe. Precisa ser construído |
| 15 | Se o `rateLimit` tem efeito em produção — `lib/rate-limit.ts:16` é um `Map` de processo, morre a cada deploy e não atravessa réplica | Saber quantas réplicas o Railway roda |
| 16 | **A borda do Railway é hoje quem impede um open redirect** (medido). Essa proteção não está no repositório, não tem teste, e ninguém foi avisado de que dependemos dela | Trocar de proxy devolve o furo, e nada no código sinaliza |
| 17 | Se os 8 specs de Playwright ainda passam | Nunca foram executados por máquina nenhuma |
| 18 | Que fração das 7.931 asserções toca código que um cliente executa | Cobertura nunca foi medida |
