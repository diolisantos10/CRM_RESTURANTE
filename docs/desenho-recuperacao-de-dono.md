# Recuperação de dono — o desenho, antes do código

> **Estado:** proposta. Nada disto foi escrito ainda.
> **Autor:** Diretor do Foocci · 07/09/2026
> **Decide:** o Diretor Geral (a parte técnica) e o CEO (uma linha, marcada abaixo).

---

## Por que este documento existe

A varredura de 05/08 listou `/api/recover` como *"o primeiro restaurante ativo
que o banco devolver: se ele ficar sem OWNER, qualquer pessoa cria conta de dono
nele"*, marcado **LATENTE**. Ao medir para consertar, ele cresceu — e cresceu de
um jeito que muda a resposta certa.

**Não é sobra de bootstrap. É o "Esqueci minha senha" do produto.**
`src/app/login/page.tsx:233` traz `<a href="/recover">Esqueci minha senha</a>`
para todo lojista que abre a tela de entrada.

**E não existe outro.** Medido: `grep -niE "resetToken|passwordReset|
VerificationToken" prisma/schema.prisma` devolve **zero linhas**. Não há modelo
de token de recuperação, não há envio de e-mail de senha. Esta casa não tem
recuperação de senha — tem esta rota.

Por isso o conserto não é "apagar a rota". Apagar a rota fecha o furo e cria
outro: **cliente pagante trancado para fora da própria loja, sem ninguém — nem a
Foocci — conseguindo abrir.** É o guardrail 5: a proteção não pode ser mais
destrutiva que o problema que ela evita.

---

## O que a rota faz hoje, medido

| | |
|---|---|
| `GET /api/recover` | público, sem autenticação. Devolve `recoveryAllowed`, `reason` e **o nome do restaurante** que o `findFirst` sorteou |
| `POST /api/recover` | público, sem autenticação. Se o restaurante sorteado não tiver OWNER ativo, **cria um OWNER** com o nome, e-mail e senha do corpo |
| Qual restaurante? | `prisma.restaurant.findFirst({ where: { isActive: true } })` — **sem ordenação**. Quem o Postgres devolver primeiro |
| `/recover?force=true` | oferece, a anônimos, um botão *"apaga todos os usuários"*. Ele chama `POST /api/admin/reset-owner` **sem o cabeçalho de segredo**, então **nunca funciona** |

Três defeitos distintos, e vale separá-los porque o conserto de cada um é outro:

1. **Porta pública que cria dono.** É o furo de segurança.
2. **`findFirst` sem alvo nomeado.** O mesmo erro aparece em
   `src/app/api/admin/reset-owner/route.ts:38`, numa rota **destrutiva**: quem
   tem o `ADMIN_SECRET` e quer destravar o cliente X apaga os usuários de quem o
   banco devolver primeiro.
3. **Um controle que mente.** O botão vermelho de destruição total não funciona,
   e é a única ação que sobra para o lojista real que clicou em "Esqueci minha
   senha" e leu *"uma conta de proprietário ativa já existe"*.

> **O gatilho já foi fechado**, em PR separado: `UserService` passou a recusar
> tirar o **último dono ativo** de um restaurante. Sem isso, qualquer MANAGER
> abria a janela do `/recover` com um PATCH. Aquele PR é pré-requisito deste.

---

## As duas saídas

### Saída A — Apagar a rota, a tela e o modo `force`

Remove `api/recover/route.ts` e `app/recover/page.tsx`; tira o desvio do
`middleware.ts`; troca o link do login por um contato de suporte.

- **Custa:** cerca de uma hora, cinco arquivos, nenhuma lógica nova.
- **Arrisca:** o lojista que perde o único dono passa a depender da Foocci —
  **e hoje a Foocci não tem por onde trazê-lo de volta.** Medi todos os seis
  caminhos que criam usuário de restaurante: nenhum liga um dono novo a um
  restaurante que já existe. Fechar A sem substituto troca "porta aberta" por
  "ninguém entra".
- **Destrava:** mata os três defeitos de uma vez, sem superfície para manter.

### Saída B — Segredo de operador, restaurante nomeado, e a porta pública some

O manipulador vira `POST /api/admin/recuperar-dono`, abre com
`checkAdminRequest` — a guarda de operador desta casa, **fail-closed por
construção** (`src/lib/admin-auth.ts:63`: sem segredo, reprova; comparação em
tempo constante) — e **exige `restaurantId` no corpo**. `findFirst` sai,
`findUnique` entra. A tela vira `/admin/recuperar-dono`, dentro da área já
autenticada, com seletor de restaurante. O desvio do `/recover` no middleware é
removido inteiro; o `GET` público some; o link do login vira suporte.

- **Custa:** cerca de três horas, mais os testes (as duas metades, sempre): sem
  credencial → 401; **com `ADMIN_SECRET` ausente do ambiente → 401**, que é o
  caso que prova o fail-closed; restaurante inexistente → 404; restaurante que
  **tem** dono ativo → 403; alvo certo → 201.
- **Arrisca:** continua existindo, no repositório, código que cria um OWNER.
  Fica atrás de duas travas, mas uma regressão futura no `middleware.ts` o
  reabre — e esta casa já registrou três incidentes de rota morta ou aberta por
  uma linha de middleware.
- **Destrava:** fecha as mesmas três frentes que a A **e** entrega, pela
  primeira vez, um jeito legítimo de a Foocci destravar um cliente sem abrir o
  terminal do banco. Conserta o `findFirst` do `reset-owner` de quebra, que é a
  mesma linha errada. E como o arquivo passa a morar sob `api/admin/**`, o portão
  que já existe — `src/security/routeGuards.test.ts:195`, *"every /api/admin/**
  route references a known admin guard"* — passa a vigiá-lo sozinho, de graça.

> ⭐ **É por isso que hoje ele escapa dos dois portões da casa:** `/api/recover`
> não mora em `api/admin/**` e não usa auxiliar de inquilino. Mudar de endereço
> **é** metade do conserto.

## Recomendo a Saída B

A A é mais limpa, e eu a preferiria se o `/recover` fosse mesmo sobra de
bootstrap. Não é: é a única saída de emergência que a casa tem. Apagá-lo sem
substituto cria a situação em que um cliente pagante fica trancado para fora e
ninguém consegue abrir — trocar um risco latente por um risco operacional certo.

A B fecha exatamente as mesmas frentes (a superfície pública some por inteiro nas
duas) e ainda entrega o mecanismo que hoje não existe. As duas horas a mais
compram um portão automático que o repositório já sabe cobrar.

---

## ⭐ A linha que é do CEO, e só ela

> **O que o lojista vê quando esquece a senha?**

Hoje ele vê uma tela que diz *"já existe um dono ativo"* e oferece um botão
vermelho que não funciona. Nas duas saídas esse link muda. As opções:

1. **Falar com o suporte** — o link do login vira WhatsApp/e-mail da Foocci, e a
   Foocci destrava por dentro (na saída B, com a tela de operador). Custa zero de
   código a mais. Custa atendimento humano a cada esquecimento.
2. **Recuperação por e-mail de verdade** — o produto ganha token de reset e
   envio, como qualquer sistema. Custa mais desenvolvimento e é a resposta certa
   a médio prazo. **Não bloqueia** o conserto de segurança: entra depois.

**Recomendo a 1 agora e a 2 na fila**, porque a 1 fecha o furo esta semana e a 2
é produto, não emergência. Mas **qual mensagem o lojista lê** é decisão de dono
da marca, não minha.

---

## O que eu não medi

- **Se alguma loja em produção está agora ativa e sem dono ativo.** Exige o
  banco. Não infiro que não está.
- **Se essa porta já foi usada.** Não há registro histórico deste endereço para
  conferir.
- **Quando o link entrou na tela de login.** O histórico deste clone está
  achatado; `git log --follow` devolve os mesmos dois commits para qualquer
  arquivo. Não invento data.
