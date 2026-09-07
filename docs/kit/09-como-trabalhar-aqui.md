<!-- ESPELHO-DO-KIT
origem: docs/09-como-trabalhar-aqui.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: 9fce3b6c4e3e106034b2f58c604619e765dd3281e93c4bdc22f458f5bed53bb8
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/09-como-trabalhar-aqui.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 09 — Como trabalhar aqui: o ambiente e o CEO

> **Vale para TODOS os projetos Dioli.** Não é regra de produto — é o chão em que
> toda sessão pisa. Uma armadilha de ambiente descoberta num projeto custa horas
> em todos os outros até alguém escrever.
>
> Promovido pelo Diretor Geral em 2026-08-01 · origem: `HANDOFF.md` §10 e §11 da
> sessão de design do Dioli Digital (commit `9eb3904`), minerado a pedido do CEO.

---

## 1. O ambiente de execução engana — e sempre da mesma forma

As sessões do Claude Code rodam num **sandbox com proxy de saída**. Três coisas
parecem quebradas e não estão:

### 1.1 O proxy intercepta TLS. Erro de certificado local não prova nada.

O certificado que você observa tem issuer **"Anthropic Egress Gateway"** — é o
proxy, não o servidor real. O erro
`SSL: no alternative certificate subject name matches target host name` que aparece
aqui **NÃO significa** que o site está sem certificado.

**O sinal confiável é a comparação.** Se um domínio responde 200 pelo mesmo proxy e
outro falha, a diferença é real. Confirme por headers do provedor
(`x-railway`, etc.) e por DNS-over-HTTPS — nunca pelo cadeado local.

**Validação de certificado só vale fora daqui:** navegador do dono, ou máquina sem
o proxy.

### 1.2 O `origin` do git **não é o GitHub**. Não troque.

O remoto é um proxy local do sandbox:

```
origin  http://local_proxy@127.0.0.1:41729/git/<owner>/<repo>
```

Se o repositório foi **renomeado**, o caminho do proxy pode conter o **nome
antigo** — e está tudo certo: o GitHub redireciona sozinho, o push funciona, e o
aviso de "repository moved" é esperado.

**Trocar o `origin` para a URL do GitHub quebra o push aqui**, porque o tráfego
precisa passar por `127.0.0.1`. E não persistiria: o container é efêmero.

> Se o remote canônico precisa mudar de verdade, o comando é para o **dono rodar na
> máquina dele**:
> `git remote set-url origin https://github.com/<owner>/<repo>.git`

### 1.3 Ferramentas que faltam, e o que usar no lugar

| Não existe | Use |
|---|---|
| `dig` | `curl "https://cloudflare-dns.com/dns-query?name=<dom>&type=<tipo>" -H "accept: application/dns-json"` |
| `git diff main...HEAD` (não há `main` local; clone raso) | `git show --stat --oneline HEAD` para reconstruir os arquivos tocados |
| `gh` CLI | as ferramentas MCP do GitHub |

**Clone raso engana na contagem.** `git rev-list --count HEAD` devolve **1** num
clone `--depth 1`, independentemente do histórico real. Um projeto com 368 commits
parece ter um. Rode `git fetch --unshallow` antes de tirar qualquer conclusão sobre
maturidade de um repositório.

### 1.4 O `tsc` local mente — o `node_modules` some sozinho

O sandbox **perde o `node_modules`** (e o `@prisma/client` gerado) entre turnos,
sem ninguém ter feito nada errado. Erro de tipo que aparece do nada quase sempre é
isso.

**Antes de "corrigir" um erro de tipo súbito:** `npm install && npx prisma
generate`, e veja se some. Se não sumir **e** o build de produção também falhar,
aí sim é real.

### 1.5 `git log` numa branch compartilhada não é linha do tempo

Quando várias sessões empurram na mesma branch, há merges e rebases que
**reescrevem commits**. Já aconteceu de uma sessão não achar os próprios commits
pela mensagem: o conteúdo estava lá, espremido dentro de um commit com mensagem e
data de outra pessoa.

**Não confie na data de um commit para saber quando algo foi escrito.**

E quando o push falhar com *non-fast-forward* mesmo com o HEAD local certo, o que
funciona é **`git push origin HEAD:<branch>`** — empurra o commit atual, não a
branch pelo nome (que pode ter ficado para trás).

---

---

## 2. Como trabalhar com o CEO

Observado diretamente em sessões de mais de um projeto. **[confirmado]** = visto
acontecer; **[a confirmar]** = padrão inferido, valide antes de construir em cima.

- **[confirmado] Português do Brasil, mensagens curtas e diretas**, frequentemente
  por voz-para-texto — o que produz frases truncadas ou palavras trocadas. Leia a
  intenção, não a transcrição literal. Responda objetivo e acionável.

- **[confirmado] Ele não lê código.** Resultado sobe em linguagem de negócio,
  conclusão primeiro. Saída bruta de agente nunca sobe.

- **[confirmado] Ele tem forte preocupação em não perder contexto.** Pediu o
  histórico completo de conversa várias vezes, e pediu handoff para "outra
  instância continuar sem eu explicar nada".
  **Implicação prática, e é a mais importante deste documento:** ele **não quer
  reexplicar**. Documente proativamente, registre decisão no repositório na mesma
  sessão, e prefira sempre deixar rastro versionado a deixar conhecimento no chat.

- **[confirmado] Mobile é prioridade, não sobra.** A maioria dos usuários dos
  produtos acessa pelo celular. 375px é o primeiro tamanho, não o último.

- **[confirmado] Ele decide; o agente propõe.** Preço, escopo, nome, identidade
  visual e promoção de agente são dele. O erro mais comum de um assistente
  diligente é resolver em silêncio o que não era dele.

- **[a confirmar] Automações agendadas.** Uma tentativa de agendar lembrete
  automático foi interrompida por ele. Pode ser recusa geral a rotinas rodando
  sozinhas, ou só timing. **Na dúvida, pergunte antes de criar trigger ou cron.**

### 2.1 A regra de ouro dele: "não quero fazer nada manual"

**[confirmado]** É explícito, e pesa mais que a diferença de esforço entre as
opções: ele escolheu o caminho "o agente resolve a infra" mesmo quando clicar
sozinho levaria dois minutos.

**Na prática:** quando uma tarefa exigir configuração de infraestrutura (Railway,
Google Cloud, DNS), **procure primeiro o caminho automatizável** — API, CLI,
Actions — antes de pedir para ele clicar. Descubra qual fatia é **realmente
inevitável** (criar credencial nova, por exemplo, só ele pode) e devolva só essa.

**E ao oferecer escolhas, lidere com a opção de zero clique dele** — não com a
"mais simples tecnicamente".

### 2.2 Ele trava em ONDE clicar, não no conceito

**[confirmado]** Ele configurou sozinho um OAuth Client com as duas redirect URIs
corretas, sem passo a passo. Mas colou um escopo na barra de busca errada do
console porque o campo certo estava dentro de um painel lateral.

**Conclusão prática:** não microgerencie o conceito — ele entende. **Seja
cirúrgico na navegação:** o caminho exato de cliques, com o nome literal de cada
menu. Telas com muito texto são onde ele perde tempo.

### 2.3 Ele cola segredo no chat, e isso é AUTORIZAÇÃO — não descuido

> ## ⚠️ REGRA DO CEO — 2026-08-02. Vale para todo agente, todo projeto.
>
> **"Se eu estou colocando no chat, isso quer dizer que eu estou autorizando.
> Não quero ser mais questionado em relação a isso."**
>
> E o complemento, que é a parte que muda o comportamento:
> **"Se eu divulgo para determinado Diretor, é porque eu estou confiando nele.
> Ponto."**
>
> **O que isso encerra:** o aviso de rotação a cada credencial colada. Ele foi dado
> quatro vezes, virou ruído, e ruído que se repete ensina a ignorar o aviso que
> importa — o guardrail 6 contra quem o inventou.
>
> **O que NÃO muda:**
> - Segredo **nunca** entra em commit, log, documento versionado ou saída de agente.
>   A autorização é para a conversa com ele, não para o repositório.
> - Se uma credencial for **comprometida de verdade** (vazou para fora, apareceu num
>   repositório público, um serviço acusa uso indevido), isso é **incidente** e se
>   reporta. É outra coisa.
> - **Quando o segredo for supersensível, a resposta é construir a interface** — o
>   próprio CEO disse. Foi o que aconteceu com `/admin/meta`: no dia em que a tela
>   existiu, ele usou, sem ninguém precisar convencê-lo.
>
> **A leitura correta do padrão:** ele não é descuidado. Ele escolhe velocidade
> quando a alternativa é fricção. Reclamar da escolha dele é trabalho do agente mal
> feito; **eliminar a fricção** é o trabalho bem feito.

#### O histórico (mantido como contexto, não como cobrança)

**[confirmado]** Aconteceu **cinco vezes em um único dia**: App Secret da Meta,
token do Railway (duas vezes), token do WhatsApp, PIN de 2FA, client secret do
Google — mais uma chave da Anthropic que apareceu inteira num print.

Não é descuido grave — é velocidade. **Mas trate qualquer credencial que apareça
numa conversa como exposta**, sugira rotação na hora, e **sem fazer drama**: um
aviso curto, o caminho exato para trocar, e siga.

⚠️ **E avise do efeito colateral:** rotacionar sem atualizar o serviço que consome
quebra a integração **em silêncio**, na próxima renovação, sem log óbvio. A troca
tem duas metades.

---

---

## 3. Uma regra que já estava provada, e agora tem nome

A sessão de design registrou como *"não confirmado"* se **"nunca inventar número"**
era pedido do CEO ou decisão do próprio modelo.

**O Diretor confirma: é regra de companhia, e é anterior àquela sessão.** Ela
aparece de forma independente em três lugares construídos antes:

- `01-filosofia.md` deste kit — verdade ancorada, o agente não inventa
- `CLAUDE.md` do Foocci, guardrail 1 — *ausência de informação não é informação*
- ficha do agente `agencia` do Foocci — *nunca prometer número*

A formulação de interface que a sessão de design produziu — **"dado real ou estado
honesto"** — é a melhor que a companhia tem até agora, e passa a valer como a
versão canônica para tela:

> Campo ausente vira estado honesto na UI (*"não informado"*, *"conecte"*), nunca
> preenchimento. O motivo é assimétrico: **ausência o dono vê e corrige; número
> inventado ele usa.**

---

## 3.1 A marca — dúvida fechada pelo CEO

A sessão de design registrou como *"não confirmado"* se `dioli.studio` (o domínio
do login-seed, `master@dioli.studio`) seria um **estúdio interno** distinto da
marca pública `diolidigital.com.br`.

**O CEO respondeu em 2026-08-01: não são coisas diferentes.** O nome é **Dioli
Digital Studio**, e às vezes aparece só como **Dioli Digital**, dependendo da
ocasião. Mesma marca, registros diferentes — não há backstage versus fachada.

Nenhum produto deve tratar `dioli.studio` como entidade separada.

---

## 4. O que um handoff precisa ter

Aprendido ao processar o primeiro. As seções que ninguém escreve e que mais valem:

1. **O que foi tentado e NÃO funcionou.** Impede o próximo de repetir o beco.
2. **O que eu sei e não está escrito em lugar nenhum.** Preferências do dono, o que
   ele recusou, contexto de negócio, o porquê por trás de um pedido.
3. **Marcação de confiança item a item** — `[confirmado]` versus `[não confirmado]`.
   Handoff com fato errado é pior que handoff curto, porque o próximo constrói em
   cima.

**Limitação a declarar sempre:** uma sessão longa tem o começo compactado. O
handoff é **reconstrução, não transcrição** — e deve dizer isso, para que o CEO
saiba que pode faltar coisa do início da conversa.

## Autorização permanente: agentes (03/08/2026)

O CEO, com todas as letras: *"Você tem autonomia para citar seus agentes pra te
ajudar."* Vale como regra de operação: **trabalho pesado, paralelo ou
especializado vai para agentes por padrão** — a sessão principal é sala de
comando, não bancada de operário. A autocrítica que gerou isto: em 03/08 o
Diretor Geral fez varredura de segurança, jurídico e briefing inteiros na mão,
inline. Funcionou, mas rendeu menos do que 3 especialistas em paralelo teriam
rendido. Não repetir.
