# Raio-X do produto — 06/09/2026

> **Entrega em ondas.** Este documento cresce durante o dia. Cada departamento
> fechado entra aqui e é anunciado no PR. O que ainda não foi medido está
> nomeado como tal — nunca em branco por conveniência.
>
> **Onda 1 (03h20):** pedido e checkout · infra e publicação · duas perguntas respondidas.
> **Onda 2 (05h):** segurança e superfície exposta · esteira de testes e CI.
> **Onda 3 (06h):** WhatsApp, agente e CRM.

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

### Mais três coisas que o dia encontrou

4. **A campanha de aniversário parabeniza no dia errado.** Medido: de 40 mensagens, **6** vão para quem faz aniversário naquele dia. As outras 34 dizem "Feliz aniversário" para quem não está fazendo — e cada uma gasta um cupom. **A mensagem é sua: ou o cartão passa a dizer "no mês do aniversário", ou o sistema passa a mandar só no dia. Recomendo o dia.**
5. **Uma campanha mal criada num restaurante cala o CRM de todos os outros.** Medido: o restaurante saudável mandou zero. E a linha que causa isso pode ser criada pela tela, sem nenhuma checagem.
6. **Existe um botão que dispara uma automação desligada.** A única coisa que impede é o botão estar cinza na tela — no servidor não há trava nenhuma.

### E o mais caro de todos, que acontece toda noite cheia

7. **O adicional que acabou sai de graça.** O lojista marca "acabou o bacon" às 20h. Quem abriu o cardápio às 19h55 pede bacon: **o sistema aceita, manda a cozinha fazer, imprime "Bacon" na comanda — e cobra zero por ele.** Medido: R$ 30 em vez de R$ 42. O lojista nunca vai desconfiar do sistema, porque a comanda está certa e o total parece certinho.
8. **Cupom de uso único usado duas vezes.** Se duas pessoas usam ao mesmo tempo, as duas ganham o desconto. Numa campanha que dispara para 500 pessoas, isso não é exceção.
9. **Promoção com hora marcada dispara três horas antes.** Happy hour de 18h às 20h roda das 15h às 17h.
10. **Quem cancela ou deixa de pagar continua com a loja vendendo.** Medido nas três formas. E não temos como saber que alguém parou de pagar, a não ser que o Mercado Pago nos avise.

### O que precisa da sua decisão

| | O que é | Se ficar parado |
|---|---|---|
| **1** | Autorizar o conserto da comanda (PR #189) | A cozinha segue sem papel, todo dia |
| **2** | Alguém precisa **ver papel sair** numa loja de verdade | Sem isso, "consertado" é só o que o código diz |
| **3** | A mensagem de aniversário: **no dia**, ou **no mês**? | Hoje 85% sai no dia errado, gastando cupom |
| **4** | Saber se algum restaurante já ligou a nota fiscal | Decide se o defeito da numeração é risco ou incêndio |
| **5** | Um segredo que só você alcança (`DIOLI_BRAIN_KIT_TOKEN`) | **Amanhã às 05h56 trava todo trabalho da casa** — inclusive o conserto da comanda |

### E três coisas que o cliente vê, achadas na última onda

11. **Quando o sistema tem qualquer problema, o cliente vê uma tela branca com texto em inglês.** Não existe tela de erro em lugar nenhum do produto — nem na loja, nem no painel, nem no site. E isso também acontece quando publicamos uma versão nova com alguém de página aberta.
12. **Uma tela pública mente para o lojista e o empurra para o botão que apaga tudo.** Com o banco fora, ela afirma *"uma conta de proprietário já existe"* sem ter verificado nada — e logo abaixo oferece *"Recuperação forçada (apaga todos os usuários)"*. Quem está ali é um dono trancado para fora do próprio sistema.
13. **No formulário de contratar, se a checagem do endereço da loja falhar, o botão de pagar continua ligado.** A pessoa pode pagar por um endereço que já é de outro restaurante.

E o cabeçalho de ontem: **o conserto protegeu um botão e deixou os cinco links ao lado quebrarem** em telas de notebook comum.

### Por que ninguém viu, e é a melhor lição do dia

O botão **"testar impressora"** do painel montava um texto simples, **sem os comandos que a impressora de verdade recebe**. Ou seja: o único instrumento que o lojista tinha para conferir se a impressão funcionava era exatamente o único caso que **não passava pelo defeito**. Ele testava a si mesmo.

A mesma coisa aconteceu do lado dos testes automáticos, por outro caminho.

**Instrumento que não percorre o caminho real não aprova nada — ele impede a pergunta.**

### E uma coisa que eu preciso dizer sem enfeite

Nenhum dos seis defeitos deste dia foi encontrado por um teste. **Todos foram encontrados quando alguém foi olhar.** A suíte tem 7.931 verificações verdes; o caminho do dinheiro tem 293 verdes; o CRM tem 1.301 verdes. Os defeitos passaram por baixo de todas elas.

O que muda isso não é escrever mais testes — é escrever testes que toquem o que o cliente toca. Está tudo listado aqui dentro, com nome e endereço.

---

## Placar por departamento

| # | Departamento | Estado | Onda |
|---|---|---|---|
| 1 | Pedido e checkout | 🔴 **VERMELHO** | 1 |
| 2 | Cardápio, cupom e link do cliente | 🔴 **VERMELHO** | 4 |
| 3 | WhatsApp, agente e CRM | 🔴 **VERMELHO** | 3 |
| 4 | SDR e prospecção | 🔴 **VERMELHO** | 4 |
| 5 | Cobrança, assinatura e billing | 🔴 **VERMELHO** | 4 |
| 6 | Site e telas públicas | 🔴 **VERMELHO** | 5 |
| 7 | Painel e autenticação | 🔴 **VERMELHO** | 2 |
| 8 | Banco, migrações e integridade | 🔴 **VERMELHO** | 4 |
| 9 | Infra e publicação | 🔴 **VERMELHO** | 1 |
| 10 | Esteira de testes e CI | 🔴 **VERMELHO** | 2 |

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

---

# Onda 3 (06h UTC) — WhatsApp, agente e CRM

## Departamento 3 · 🔴 VERMELHO

Auditado em cópia isolada de `f633d183`, **contra Postgres real** — o especialista subiu um banco de verdade em vez de aceitar o dublê. `npx vitest run src/services/crm` → **1.301 testes, todos verdes. Nenhum dos seis achados abaixo é pego por um único deles.**

### A parede das 500 está consertada — e mudou de lugar para 32.767

**Medido, não deduzido.** Base de 1.200 clientes, campanha recorrente, duas rodadas:

```
RODADA 1   eligible: 500   sent: 40
RODADA 2   eligible: 500   sent: 40
NOVOS na rodada 2: 40
```

**O PR #183 faz o que promete.** Mas o teste dele (`audiencia-nao-para-nas-mesmas-500.test.ts:23-32`) **mocka o `prisma`**, e o caso que ele chama de *"⭐ prova de negócio"* afirma `expect(segunda.id.notIn).toHaveLength(500)` — isto é, que a lista que o próprio teste passou chegou ao `where`. O dublê devolve `[]` nas duas chamadas. **Nenhuma pessoa diferente é alcançada em lugar nenhum daquele teste.**

E por isso ele não viu o teto que o próprio conserto criou:

| `notIn` | resultado |
|---|---|
| 30.000 | OK, 138 ms |
| 32.700 | OK, 156 ms |
| **32.766** | **ERRO** — `Invalid prisma.customer.findMany()` |

É o limite de parâmetros do protocolo do Postgres. **Não dispara com os 21 mil de hoje**; dispara quando uma base passar de ~33 mil, ou quando o histórico acumular mais que isso. Aí vira campanha muda de novo, 32 mil pessoas adiante.

### 🔴 A campanha de aniversário parabeniza no dia errado — 85% das vezes

Medido, 1.200 clientes com data de nascimento, dia 9 de setembro:

| | |
|---|---|
| fazem aniversário **no mês** | 100 |
| fazem aniversário **hoje** | 15 |
| audiência que a campanha devolve | **40** |
| desses 40, fazem aniversário hoje | **6** |

**34 de 40 mensagens dizem "Feliz aniversário, {nome}! 🎉" no dia errado — e cada uma queima um cupom** do orçamento mensal. E **60 dos 100 aniversariantes do mês são inalcançáveis**, porque o corte de 500 acontece antes do filtro.

Quatro lugares do repositório dizem coisas diferentes sobre a mesma pergunta:

| Onde | Regra | |
|---|---|---|
| `readyMadeCampaigns.ts:127` | *"No dia do aniversário do cliente"* | o que o lojista lê |
| `CRMService.ts:420-433` | hoje + 3 dias | o que o painel conta |
| `AutomationSchedulerService.ts:305-306` | mês **e** dia (±1) | o motor **aposentado** — o único que acerta |
| `CrmCampaignService.ts:445-447` | **o mês inteiro** | **o motor que envia de verdade** |

O código certo está no caminho morto.

> **Isto é decisão do CEO, não minha:** a mensagem que chega ao cliente é dele. Ou o cartão passa a dizer "no mês do aniversário", ou o motor passa a filtrar por dia. **Recomendo filtrar por dia** — o código já existe, no arquivo aposentado.

### 🔴 Uma campanha malformada de UM restaurante cala o CRM de TODOS

Medido, dois restaurantes. O "Mau" com uma campanha `{ mode: "RECURRING" }` sem `weekdays`:

```
runDueCampaigns({})  →  TypeError: Cannot read properties of undefined (reading 'includes')
```

**O restaurante saudável enviou zero.** `ScheduledCampaignRunnerService.ts:297` faz `cfg.weekdays.includes(...)` sem guarda, dentro de um `.filter()` **sem `try/catch`** — antes do `catch` por campanha que existe mais adiante. O cron devolve 500 e o ciclo inteiro morre, em todo tick, até alguém achar a linha.

**E a linha envenenada é criável pela porta da frente:** `api/crm/campaigns/route.ts:182` tipa `scheduleConfig?: Record<string, unknown>` e repassa **sem validação de forma nenhuma**. Com `mode: "RECURRING"`, a campanha nasce já ACTIVE.

Ninguém testa isso porque **o teste do agendador mocka o próprio motor** (`CrmSchedulerBootTick.test.ts:22`). Ele prova que o relógio bate. **Não existe, em toda a bateria, um teste que chame o `runDueCampaigns` de verdade.**

### 🔴 O motor "aposentado" tem porta lateral, e a trava está no botão

A vitrine diz *"se alguém religar o motor legado, o CI cai"*. O teste só chama `runEnabledAutomations`. Mas `AutomationSchedulerService.runSingleAutomation:69` **não foi aposentado** — 380 linhas que enviam de verdade — e tem chamador: `api/crm/automations/run/route.ts:36`, exposto por um botão **"▶ Executar agora"** com `dryRun: false`.

Pior: **`runSingleAutomation` nunca confere `isEnabled`.** A única trava contra disparar uma automação **desligada** é o atributo `disabled` do botão em React. **É o guardrail 4 invertido: o aviso está no cliente e a trava não existe no servidor.**

*O que salva:* cada destinatário ainda passa pelo `ContactSafetyService` (opt-out, cooldown, teto). Ninguém recebe duas vezes.

### As outras duas

**O silêncio continua sem rastro no banco.** O PR #183 consertou a causa; o alarme não existe. O `reason` — horário quieto, teto atingido, sem elegíveis, e agora o estouro do `notIn` — **não é persistido em lugar nenhum**. Vive só no JSON da resposta do cron, que ninguém lê. Uma campanha muda aparece na tela como ACTIVE, sem explicação. *A exceção honrosa:* canal desconectado **grava** uma linha `BLOCKED` com o motivo escrito. É o modelo certo, e existe só nesse caso.

**Mensagem duas vezes.** `ScheduledCampaignRunnerService.ts:1832` grava a execução **depois** do envio retornar sucesso. Se o processo morrer entre os dois — e o próprio código cita os *"Railway proxy timeouts (exit 56)"* — o cliente recebeu e não existe linha. No tick seguinte ele não está em nenhuma lista de proteção e **recebe de novo**. Alcance: ≤40 por lote. Frequência: não medida.

### O que está VERDE, e merece ser dito

- **Mensagem que sai (Meta)** — a peça mais bem feita do domínio: recusa texto livre por provedor que não declare janela, mede as 24h e devolve `BLOCKED`, não `FAILED`.
- **Cupom** — concedido depois do envio bem-sucedido, com orçamento mensal.
- **Isolamento entre inquilinos** — as sete rotas de campanha conferem o dono.

---

## CEGO — acréscimos da onda 3

| # | O que ninguém sabe | O que destravaria |
|---|---|---|
| 19 | ⚠️ **Se os 84 modelos aprovados estão de fato LIGADOS às campanhas.** O vínculo só é escrito por um dropdown manual — nada o preenche sozinho. **Sem ele, a campanha cai em texto livre, é recusada pela janela de 24h, e cada destinatário vira `BLOCKED`: zero entrega, com tudo parecendo saudável.** É a pergunta nº 1 deste departamento | `SELECT status, "mappedCampaignType", COUNT(*) FROM meta_message_templates GROUP BY 1,2` |
| 20 | Quantas linhas `BLOCKED` com `META_TEMPLATE_REQUIRED` existem hoje — responde a de cima num `SELECT` só | leitura do banco |
| 21 | **Se já existe alguma campanha ACTIVE sem `weekdays`** — ou seja, se a bomba que cala o CRM de todos já está armada | `SELECT id FROM campaigns WHERE status IN ('ACTIVE','SCHEDULED') AND "scheduleConfig"->>'mode'='RECURRING' AND "scheduleConfig"->'weekdays' IS NULL` |
| 22 | Fuso de `birthDate`: se as datas vieram como meia-noite UTC e o processo roda em `America/Sao_Paulo`, quem nasceu no dia 1 cai no mês anterior | valor de `TZ` no Railway |
| 23 | ⚠️ **O histórico de migrations não é replayável.** `prisma migrate diff --from-migrations` falha em `20250506000000_saipos_integration`. **Não existe hoje um jeito automático de provar que o `schema.prisma` bate com o Postgres de produção** — que é exatamente a classe do defeito da comanda | um `pg_dump -s` de produção |

---

# Onda 4 (parcial, 04h UTC) — cardápio, cupom e billing

Medido em cópia isolada, contra **Postgres 16 real**, dirigindo as rotas de verdade — sem dublê. Base: `4c254574`, **o mesmo commit que está no ar**.

## Departamento 2 — Cardápio, cupom e link · 🔴 VERMELHO

### 🔴 O adicional que a cozinha faz de graça — e é rotina, não ataque

É o achado mais caro do dia, e ele acontece toda noite de pico:

> O lojista marca *"acabou o bacon"* às 20h. Quem carregou o cardápio às 19h55 adiciona bacon e envia. O servidor procura o adicional **com filtro de disponível**, não acha — e `?? 0` (`finalize/route.ts:366`) transforma R$ 12 em zero. **Sem erro, sem 400, sem log.**
>
> O pedido entra. A comanda imprime "Bacon". A cozinha produz. A conta é **R$ 30 em vez de R$ 42**.

Provado com sondas reais contra Postgres:

| Sonda | Resultado |
|---|---|
| Extra de R$ 12 marcado indisponível | **200** · total R$ 30 em vez de R$ 38 · comanda com `"unitPrice": 0` |
| Opcional de R$ 5 indisponível | **200** · total R$ 30 |
| `extraId` **inexistente**: `"Costela 1kg" ×2` | **200** · gravado na comanda, **cobrado zero** |
| Extra de **OUTRO restaurante** ("Gelo", R$ 0,50) aplicado ao X-Burger | **200** · total R$ 30,50 · comanda diz "Bacon" |

A última é a mais grave e não é só dinheiro: `finalize/route.ts:271-274` busca o adicional **sem `restaurantId` e sem vínculo com o item**. Um id de outro inquilino é aceito e precificado.

**E o lojista nunca vai atribuir a diferença ao sistema** — a comanda está certa e o total parece certinho.

**O padrão, de novo:** todos esses buracos estão "cobertos" por teste, e todos os testes mockam o achado. `finalize/route.test.ts:34-35` dubla `menuItemExtra.findMany`, e o caso da suíte manda o dublê **devolver o extra encontrado**. **O ramo "não encontrou" nunca foi executado por ninguém.** Trocar o dublê por Postgres derrubou os cinco na primeira tentativa.

### 🔴 O cupom de uso único, usado duas vezes

`maxUses: 1`, dois pedidos em paralelo → **os dois com desconto, `usedCount = 2`**. A leitura está na rota (`:591`) e o incremento em outro arquivo (`CheckoutFinalizationService.ts:214`); entre um e outro cabe o mundo. `oneTimePerUser` tem o mesmo furo — sequencialmente barra certo, o que explica por que passa despercebido.

**Numa campanha que dispara para 500 clientes ao mesmo tempo, "cupom de 1 uso" não é 1 uso.**

### 🔴 O cupom com hora marcada que vale o dia inteiro

O lojista cadastra "20% das 15h às 18h". **O campo existe na tela e nenhum dos dois validadores o lê** (`validate-coupon/route.ts:82-105`, `finalize/route.ts:574-578`). Provado: cupom com janela de **um minuto**, aplicado 55 minutos depois. Desconto de 20% em 100% do faturamento em vez de na faixa vazia da tarde.

### 🔴 A promoção que dispara três horas antes

`productPromotionResolver.ts:46` usa `now.getHours()`; o processo roda em UTC e a loja é `America/Sao_Paulo`. Medido: a janela `01:00–02:00` (a hora real da loja) ficou **inativa** e `04:00–05:00` ficou **ativa**. **Happy hour de 18h–20h roda das 15h às 17h.**

É o **único** motor de horário do sistema que não converte para o fuso do restaurante — `business-hours.ts:192,209`, o recepcionista do WhatsApp, o runner de campanha e o cupom impresso todos convertem.

### O que está verde, e merece registro

Os guards de preço do **item base** e da **variante** funcionam: payload com `price:1` foi cobrado a 30. O `waToken` do link é HMAC com validade e comparação em tempo constante. O cupom de carteira, a validade e o cardápio (item indisponível não aparece) estão corretos.

---

## Departamento 5 — Cobrança, assinatura e billing · 🔴 VERMELHO

### 🔴 Quem não paga continua vendendo — e nós só sabemos se o Mercado Pago contar

Três sondas, três vezes o mesmo resultado:

| Estado forçado | Pedido na loja |
|---|---|
| Assinatura `INADIMPLENTE` | **200 OK** |
| Assinatura `CANCELADA` | **200 OK** |
| `Restaurant.isActive = false` | **200 OK** |

`markDelinquent` grava o status e **ninguém lê esse status** — a única outra ocorrência no código o usa para *proteger* o restaurante de ser apagado. E **o único interruptor manual que existe não interrompe nada**: nem `page.tsx` nem `finalize` sequer selecionam `isActive`.

Pior: **não existe cron de cobrança**, e `PlanSubscription` **não tem** data de próxima cobrança. Uma assinatura `ATIVA` que parou de gerar fatura há três meses é, para o sistema, **indistinguível de uma em dia**. Só sabemos de inadimplência se o Mercado Pago avisar.

### 🔴 O cliente que paga metade da mensalidade para sempre

`PlanSubscriptionService.ts:286-323` eleva o valor do 1º mês para o cheio **só quando o webhook da primeira cobrança chega**. Se não chega, fica `fullAmountSyncedAt = null` **e** `priceSyncError = null` — e a sonda do raio-x só olha `priceSyncError not null`. **Erro nenhum em lugar nenhum, e a receita fica pela metade indefinidamente.**

É a lei do domínio violada dentro do próprio billing: todo estado nasce com prazo e com quem o resgata.

### 🔴 O teto de pedidos por plano: confirmado, nada mede, nada barra

As três frases do site — *"até 300 / 1.200 / 4.000 pedidos por mês"* — são **texto solto** em `precos/page.tsx:169,238,313`. **Não existe contador**: nenhum campo no schema, nenhum `orderLimit` no repositório. O único gate de plano do sistema inteiro é o Garçom IA. Sonda: restaurante STARTER, cinco pedidos seguidos, cinco aceitos, nenhum aviso, nenhum registro.

**Promessa publicada sem motor** — e esta linha já estava no `CLAUDE.md` como decisão pendente do CEO desde antes. Continua pendente.

### O que está verde

A tabela de preço tem **fonte única** e a página pública lê a mesma função — código e site não podem divergir. O checkout self-service nunca aceita preço do payload, exige aceite antes do link e tem idempotência no banco. A trava contra cobrança-zumbi funciona.

---

## CEGO — acréscimos da onda 4

| # | O que ninguém sabe | O que destravaria |
|---|---|---|
| 24 | ⚠️ **Se o furo do adicional já custou dinheiro de verdade, e quanto.** Cada linha de `order_items` com `addonsJson->'extras'` contendo `unitPrice = 0` é um adicional entregue e não cobrado | uma consulta no banco de produção |
| 25 | **O fuso do contêiner em produção.** Se for `America/Sao_Paulo`, o defeito da promoção fica invisível para lojas de SP — **e continua errado para Manaus e Noronha**, porque o motor ignora o fuso do restaurante de qualquer jeito | `railway variables` no serviço |
| 26 | Se algum cupom em produção tem janela de horário preenchida — separa "latente" de "descontando fora de hora agora" | `SELECT count(*) FROM promotions WHERE "timeFrom" IS NOT NULL` |
| 27 | Se alguma assinatura viva está com `fullAmountSyncedAt IS NULL` há mais de um ciclo — separa risco de desenho de **receita já perdida** | leitura do banco |
| 28 | Se existe hoje algum lojista inadimplente com a loja no ar | `SELECT status, count(*) FROM plan_subscriptions GROUP BY 1` |
| 29 | **O comportamento real do Mercado Pago na recusa de cartão.** Todo o nosso caminho de inadimplência depende de um aviso dele, e só lemos o nosso lado | painel do MP |
| 30 | O caminho do QR/mesa e do WhatsApp têm **o mesmo `?? 0`** e a mesma falta de escopo — lido no código, **não dirigido contra banco**. Provável, não provado | rodar as sondas naquele caminho |

---

# Onda 4 (fechamento, 05h30 UTC) — SDR, banco e migrações

## ⭐ O achado que explica o dia inteiro

**O botão "testar impressora" testava exatamente o único caso que não passava pelo defeito.**

`api/integracoes/impressao/teste/route.ts:30-38` monta um corpo de **texto puro**, sem nenhum código de controle ESC/POS — **zero bytes nulos**. O único instrumento que o lojista tinha para conferir o cano provava que o cano estava bom, *justamente porque não percorria o defeito*.

Dois instrumentos falharam juntos, e pelo mesmo motivo:

| Instrumento | Por que aprovou |
|---|---|
| A suíte | `prisma` é dublê, e um `vi.fn()` aceita o byte que o Postgres recusa |
| O botão do lojista | monta texto puro, sem os comandos da impressora |

**Instrumento que não percorre o caminho real não aprova nada — ele impede a pergunta.**

E há uma terceira camada: os **cinco** chamadores do enfileiramento (`OrderService.ts:178`, `confirmCardPayment.ts:102`, `orders/manual/route.ts:432`, `finalize/route.ts:916`, `mercadopago/webhook/route.ts:97`) são todos `.catch(e => console…)`. O erro existia, gritava, e caía num log que ninguém lê.

---

## Departamento 8 — Banco, migrações e integridade · 🔴 VERMELHO

Medido contra **PostgreSQL 16.13 real**, com o banco construído pela própria cadeia de migrations.

### 🔴 A cadeia de migrations não reconstrói o banco do zero — e o conserto é uma linha

Banco vazio + `prisma migrate deploy` → **falha** em `20250506000000_saipos_integration` com `relation "orders" does not exist`.

**A data é 2025.** Ela ordena **antes** de `20260314000000_initial_schema`. Renomeando só ela para `20260506000000`, **as 208 migrations aplicam limpas.**

**Consequência hoje:** não existe recuperação de desastre, não existe staging, não existe segunda região. E o CI já desistiu por escrito: `jornadas-p0.yml:74-93` usa `prisma db push --accept-data-loss` e `psql` à mão nas duas últimas migrations, em vez da cadeia.

**Nenhum portão do repositório compara o `schema.prisma` com o banco.** Foi por esse buraco que o `0x00` passou.

### 🔴 Uma migration quebra a atomicidade que o script de deploy ASSUME

`scripts/migrate-deploy.sh:13-16` afirma por escrito que *"ALL our migrations are additive single statements wrapped in a transaction"* — e é essa premissa que autoriza ele a marcar uma migration falha como revertida e tentar de novo, seis vezes.

`20260825180000_sala_de_vendas_e_sdrs` **não é atômica**: abre transação na linha 98, fecha na 174, e ainda traz **540 linhas de DDL depois do `COMMIT`** — fora de qualquer transação. Provado contra Postgres real: após a falha, a tabela criada antes do `COMMIT` **sobreviveu**.

E é a pior migration possível para isso: ela recria o enum do funil. Se morrer depois da linha 174, o enum já foi trocado, o script marca "revertida", roda de novo, o `CASE` não tem ramo para o valor novo, devolve NULL numa coluna `NOT NULL` — e **falha para sempre**. Seis tentativas, `exit 1`, deploy morto.

### 🔴 O servidor sobe mesmo com a migration falhando

`scripts/start-production.sh` tem só `set -u`. O passo do `migrate deploy` não tem `set -e`, nem `||`, nem `if`. **Falhou, segue para o `next start`** e serve tráfego contra um banco em estado de migration incompleta. É o guardrail 2 invertido: o portão aprova por omissão.

### 🔴 A numeração da NFC-e: corrida provada, e sem rede embaixo

Duas sessões concorrentes leram `proximoNumero = 1`; **as duas emitiram a nota nº 1**, e o contador terminou em 2 em vez de 3. E `fiscal_documents` **não tem índice único** em `(restaurantId, serie, numero)` — provado gravando duas notas série 1 nº 77.

Vinte metros ao lado, `order-number.ts:27` faz certo, com `{ increment: 1 }` atômico **e** índice único de guarda. **O molde correto está no mesmo repositório, a trinta linhas de distância.**

### 🔴 Apagar um cliente pode responder ao cliente errado

Dois defeitos que se somam:

1. `conversations.customerId` é `ON DELETE RESTRICT` no banco e `SetNull` no schema. Provado: `customer.delete()` com conversa vinculada **explode**. Dois caminhos contornam à mão; **três engolem o erro**.
2. `MessageService.ts:120` filtra por `customerId: conv.customerId ?? undefined` — e o Prisma **descarta filtro `undefined`**. Com `customerId` nulo, o `findFirst ... orderBy updatedAt desc` devolve **a identidade de outro cliente**.

Junte com a órfã provada em `customer_channel_identities` (sem chave estrangeira, "soft ref") e o resultado é: **resposta manual do Instagram indo para a caixa de entrada de terceiro.**

### ✅ E uma confirmação independente do PR #189

O `cerebro` auditou o conserto da comanda sem eu pedir e concluiu: **é o certo.** Confirmou que `api/print-agent/poll/route.ts` é o **único** leitor de `print_jobs.body` no repositório inteiro, e que a cura não apaga o parâmetro do comando ESC/POS — que era a armadilha da primeira tentativa. **Só falta chegar em produção.**

### O que está verde no banco

A **purga de restaurante passou no teste mais duro possível**: comparada contra o banco real, cobre 82 das 83 tabelas com `restaurantId`, e a 83ª está nomeada e justificada. Nada sobrando. A numeração de pedido e a idempotência do checkout também estão corretas.

---

## Departamento 4 — SDR e prospecção · 🔴 VERMELHO

### 🔴 O robô responde quem mandou parar

Medido contra Postgres real: mandei **"PARE"**. O retorno foi `RECONHECIDO_POR_TELEFONE`, o `optOutAt` continuou **nulo**, e o fluxo seguiu para o agente responder.

O detector aceita quatro palavras — `stop`, `sair`, `parar`, `descadastrar`. **Recusou 24 de 30 frases naturais**, entre elas: *PARE · para · chega · não quero · me tira dessa lista · não me mande mais mensagens · não tenho interesse · me exclui · cancela · não perturbe*.

E o código **justifica** a estreiteza dizendo que *"o rodapé com 'responda SAIR' vai junto em toda campanha"* — **esse rodapé só existe no template do CRM.** O SDR nunca ensina a palavra e não aceita a que a pessoa usa.

Hoje isso é uma linha `PENDENTE`, porque o envio está desligado. **No dia em que ligar, é o número queimando.**

### 🔴 A trava "infalsificável" é falsificada pelo seu único chamador

`FoocciSalesChannel.ts:236-244` explica que a decisão do portão é o primeiro parâmetro *"não uma checagem que alguém pode esquecer de fazer"*, e que quem tentar burlar *"precisa fabricar uma decisão aprovada, e isso é visível em revisão de código"*.

Em `entrega.ts:143-146` a decisão **é fabricada**, à mão, com comentário. Não é má-fé — o autor confere opt-out e telefone logo acima. Mas o que **não** é conferido no instante de sair é janela de horário, teto de tentativas, descanso de 48h e base legal. E `avaliarContatoDeLead`, que confere tudo isso, **tem zero chamadores em produção**.

O teste que guardava a propriedade é **uma regex sobre o texto do arquivo**: fica verde enquanto a assinatura existir, **independentemente do que os chamadores passem**.

### 🔴 A prospecção não existe — existe a tela dela

`materializarLead` **não tem chamador**. A rota não tem ação de abordar. **Não há template de primeira mensagem em lugar nenhum.** O motor de cadência inteiro (`inscreverEmCadencia`, `avancarCadencia`, `passosVencidos`) tem zero chamadores **e zero testes**.

**Ligar `FOOCCI_SDR_SEND_ENABLED` hoje não abordaria ninguém.** O código é claríssimo sobre isso em três cabeçalhos — e ainda assim é o tipo de coisa que sobe como *"prospecção entregue, falta ligar a chave"*.

E o teto que deveria segurar isso **conta pessoas, não mensagens**: medido, 5 mensagens à mesma pessoa consumiram **1 de 3**.

### 🔴 Vinte testes nunca rodaram — e três ficam verdes num banco SEM a trava

`SALA_VENDAS_TEST_DB` **não existe em lugar nenhum do repositório**. O especialista forçou os dois arquivos a rodar:

- `responsavel.corrida` (a corrida entre dois SDRs) **passa** — nunca soubemos.
- `identidadeNoBanco.rls` **reprova 4 de 11** num banco novo, porque conta linhas que ele não cria. **Ninguém conseguiria ligá-lo no CI sem reescrever.**

E o pior: num banco onde `relrowsecurity = 'f'` — **RLS completamente ausente** — três asserções ficaram **verdes**, entre elas *"sem identidade declarada, NADA é visível"*. Bastou **inserir uma linha** para as três virarem vermelhas.

O cabeçalho do próprio arquivo diz que pular calado *"faria a suíte verde afirmar que a autorização de banco foi verificada quando ninguém a verificou"*. **Ele descreve a si mesmo.**

---

## CEGO — fechamento da onda 4

| # | O que ninguém sabe | O que destravaria |
|---|---|---|
| 31 | ⚠️ **Se o Postgres de produção é igual ao que as migrations constroem.** Como a cadeia não roda do zero, o banco de produção nasceu de um `db push` em alguma era e recebeu migrations por cima. **Toda a "deriva" medida é contra o banco-de-migrations; se produção for outra coisa, os números mudam** | um `pg_dump -s` (só esquema, sem dado) |
| 32 | Se `conversations_customerId_fkey` em produção é `RESTRICT` ou `SET NULL` — é a diferença entre "apagar cliente falha" e "funciona" | uma consulta de uma linha |
| 33 | Se produção já tem **duas NFC-e com o mesmo número**, ou identidades de canal órfãs | `SELECT` de contagem |
| 34 | Quantas vezes o `migrate-deploy.sh` já rodou a recuperação automática — diz se o laço de deploy já aconteceu e ninguém contou | `_prisma_migrations` |
| 35 | **Nunca vimos uma mensagem do SDR sair.** Tudo foi medido com o envio desligado | as variáveis do Railway |
| 36 | Se a RLS está de pé em produção. O banco de teste foi criado por `db push`, onde as políticas não entram. **Se a migration não estiver aplicada lá, os 4 testes que reprovaram aqui reprovariam lá — e como o arquivo está pulado, ninguém saberia** | a mesma consulta de esquema |

> **Sobre o `pg_dump`:** o especialista registrou que **não** puxou credencial de produção por conta própria — existe acesso via Railway e o dump é leitura pura, mas ampliar o alcance da sessão é decisão de quem despacha, não dele. **Concordo, e endosso: o pedido sobe, a ação não.**

---

# Onda 5 (07h UTC) — as telas que o cliente vê

## Departamento 6 — Site e telas públicas · 🔴 VERMELHO

76 screenshots medidos **e olhados um a um**, em 375 / 768 / 1024.

### 🔴 P0 · A loja do cliente não tem tela de erro — nenhuma tela tem

Com o banco fora, `/pedido/[slug]` devolve **tela branca com texto em inglês**: *"Application error… see the server logs"*. Sem marca, sem título, sem "tentar de novo", sem saída.

**`find src/app -name "error.tsx"` não devolve nada.** O produto inteiro — painel, loja e site — cai no texto cru do Next.js.

E isso não é só "banco fora": **acontece quando um deploy entra no Railway com o cliente de janela aberta.** Os chunks trocam e a página quebra — o especialista reproduziu isso sem querer, com a página respondendo **HTTP 200**.

### 🔴 P0 · Uma tela pública mente para o lojista e o empurra para o botão que apaga tudo

`/recover` — sem login, aberta na internet.

O servidor faz a coisa certa: devolve `503 {"error":"Could not reach the database"}`. **Quem mente é a tela.** Ela faz `fetch(...).then(r => r.json())` **sem olhar `r.ok`**; o 503 vira um objeto sem o campo esperado, o `if` cai no `else`, e a página anuncia:

> **"Uma conta de proprietário ativa já existe"**

Ela não verificou nada. E logo abaixo desse diagnóstico falso, oferece o remédio para ele:

> **"Recuperação forçada (apaga todos os usuários)"**

Quem está nessa tela é um dono de restaurante trancado para fora do próprio sistema. **O erro de leitura empurra a pessoa para o botão destrutivo.** É o guardrail 1 e o guardrail 5 no mesmo parágrafo.

O estado honesto **existe escrito no código** (`db_error`) e é **inalcançável**: o único caminho até ele é um erro de rede, e um 503 com JSON nunca dispara `.catch`. **Alguém construiu o estado certo e ligou o fio de um jeito que ele nunca acende.**

`/setup` tem o bug idêntico, linha por linha. E o especialista achou **70 chamadas com a mesma forma** espalhadas pelo app.

### 🔴 P0 · O conserto do cabeçalho protegeu um rótulo e deixou cinco

Em **1024px**, no commit que está no ar: *"Atendimento com IA"* quebra e **o "IA" cai colado no logo**. *"Ver funcionando"* e *"Planos e preços"* também quebram. A barra de navegação mede **40px de altura — duas linhas**.

O commit `4c254574` pôs `whitespace-nowrap` em **um** elemento, e o comentário dele diz com todas as letras: *"`whitespace-nowrap` é trava, não enfeite: sem ele o rótulo quebra de novo assim que a janela aperta."* **Os cinco links ao lado não receberam trava nenhuma.**

A janela quebrada é **1024–1099** — notebook comum e janela não maximizada. Em 1100 já sara.

> **Isto corrige um ponto meu.** Eu medi a folga entre os blocos (zero) e não medi se os **rótulos dentro do menu** quebravam. Minha régua no **PR #190** confere linha única só nos três botões. **Vou estendê-la aos links do menu** — é exatamente a lição: trava aplicada a um rótulo não protege a fileira.

### 🔴 P0 · O campo que falha em silêncio, com o pagamento habilitado

Em `/contratar/novo`, quando a checagem do endereço da loja falha, o código volta ao **mesmo estado de "você ainda não digitou nada"**. A tela mostra a dica neutra *"Letras minúsculas, números e hífen."* — e o lojista lê silêncio como "está livre".

Pior: a validação só barra o envio quando o estado é `taken`. Com o estado neutro, **o botão "Aceitar e pagar R$ 89,50" fica habilitado.** Se a verificação falhar num endereço que já é de outro restaurante, **a pessoa paga por um endereço que não vai poder ter.**

Existem quatro estados e **não existe estado de erro**.

### Os outros

| # | Tela | Largura | Defeito | Medida |
|---|---|---|---|---|
| 5 | `/site/como-funciona` — o diagrama do ciclo | **768** | **Dois dos cinco passos estão amputados e não há rolagem para alcançá-los.** Lê-se "**ente**" no lugar de "Cliente" | fileira de 839px em 728px — **111px de excesso** |
| 6 | Qualquer URL desconhecida | todas | `/precos`, `/contato`, `/blog` → **307 para o login**, não 404. O `not-found.tsx` da raiz é **código morto** | — |
| 7 | "Agende uma demonstração" (3 páginas) | **375** | rótulo quebra em duas linhas, seta sozinha | h = 76px |
| 8 | Rodapé | **375** | 11 links com **17px** de altura — o mínimo de toque é 44 | 17px |

### Os três estados obrigatórios do `DESIGN.md`

| Estado | Quantas telas têm |
|---|---|
| **Erro** | **0** |
| **Carregando** | **1** |
| **Vazio** | dois `not-found` — e nenhum trata *"não consegui verificar"* |

### E uma observação de método que vale mais que a lista

> **Uma tela quebrada que renderiza NADA passa em toda régua automática.** O robô do especialista deu "0 defeitos" para três páginas em branco, porque não havia elemento para medir. **Régua nenhuma pega isso; só olhar pega.**

### O que passou limpo, e foi conferido de propósito

A calculadora da home **não mente** (40.000 × 23% = 9.200, menos 429 = 8.771 — bateu nos três). `/contratar/novo` trata o erro de envio direito. O menu do celular tem alvos de 48px. **Nenhuma página rola de lado** em 60 medições. E os preços de primeiro mês pela metade estão rotulados, não contradizem a tabela.

---

## CEGO — onda 5

| # | O que ninguém sabe | O que destravaria |
|---|---|---|
| 37 | ⚠️ **Todo o painel do lojista** — 30+ telas, todas atrás de login. **É lá que moram os enganos que deram origem a este tipo de auditoria**: o filtro que não filtrava, o "Total hoje" que mentia, o "Pausar pedidos" escondido. **Nenhum foi medido hoje** | um banco com dados de demonstração e uma sessão de lojista |
| 38 | **A loja do cliente funcionando.** Só vimos a tela de erro. **O percurso "fazer o primeiro pedido" — o teste mais importante do produto — ficou por fazer** | banco real com a loja semeada |
| 39 | As outras **68 chamadas** com o bug do `res.ok`. Duas provadas, nas telas públicas; as demais atrás de login. *É padrão, e padrão se pega com regra, não com olho* | o mesmo acesso |
| 40 | **Produção de verdade.** Tudo foi medido no build local desta branch, não em `foocci.com.br` | rodar as mesmas medições contra o domínio |

### A recomendação do especialista, que eu endosso

Para as telas que afirmam o que não sabem, dois caminhos: **(a)** corrigir as três uma a uma — barato e **não impede a quarta de nascer amanhã**; **(b)** tratar como mecanismo: um helper único de fetch que trata `!res.ok` como erro por construção, mais `error.tsx` na raiz e em `/pedido` — o que mata a classe inteira, inclusive as 68 não medidas.

**Recomendo (b), e o motivo é o guardrail 4:** (a) depende de alguém lembrar de não fazer, e este repositório já provou que não lembra — **o `/setup` é a cópia carbono do `/recover`.**
