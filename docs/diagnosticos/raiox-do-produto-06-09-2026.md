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
