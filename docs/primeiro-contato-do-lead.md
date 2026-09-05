# O primeiro contato do lead (05/09/2026)

> A casa passa a poder **falar primeiro** com quem preencheu o formulário e nunca
> escreveu. Nasce desligado, em três chaves, e hoje **nenhuma mensagem sai**.

## O buraco, medido

`avaliarContatoDeLead` — o portão da primeira abordagem, com opt-out, teto de
duas tentativas, descanso de 48 h, consentimento de menos de 90 dias e janela de
9 h às 20 h em dia útil — estava **construído, testado e sem um único chamador no
produto**. Varredura em 05/09/2026: só os testes o importavam. Trava sem
fechadura.

Do outro lado, `docs/site-fala-com-agente.md` registrava o efeito: quem preenche
o formulário e não aperta enviar no WhatsApp vira lead sem conversa. A ficha
existe, e ninguém fala com ele — para sempre.

`atenderComOTA` é reativo por desenho e continua sendo. Ele responde; não vai
atrás de ninguém. O comentário dele explicando por que **não** chama o portão da
abordagem está certo e não foi tocado.

## O que foi construído

| Arquivo | O que faz |
|---|---|
| `foocci-sdr/ModeloAprovado.ts` | Lê do ambiente o modelo aprovado pela Meta. Sem ele, `null` — e a fila inteira barra. |
| `foocci-sdr/FoocciSalesChannel.ts` | Ganhou `enviarModeloDeVendas` — envio de **template**, irmão do envio de texto livre. |
| `salaDeVendas/primeiroContato/config.ts` | A chave própria e o teto do dia. Nasce desligado, teto zero. |
| `salaDeVendas/primeiroContato/fila.ts` | Quem SERIA abordado agora, e por que os outros não. **Somente leitura.** |
| `salaDeVendas/primeiroContato/disparo.ts` | O único que fala com alguém. Reserva por comparar-e-trocar, grava, envia. |
| `salaDeVendas/primeiroContato/rodada.ts` | Monta a fila e aborda quem ela liberou, um por um. |
| `api/cron/sala-de-vendas/primeiro-contato` | O gatilho. GET lê; POST roda. Fail-closed no `CRON_SECRET`. |
| `.github/workflows/primeiro-contato-lead.yml` | Aciona à mão. **Sem `schedule`** — agendar é ato do CEO. |

## ⚠️ O que FALTA para isto funcionar, e é um fato, não um detalhe

**Não existe modelo aprovado pela Meta declarado neste repositório.** Varredura
feita: as únicas variáveis do canal de vendas são `FOOCCI_SALES_PROVIDER`,
`FOOCCI_SALES_PHONE_NUMBER_ID`, `FOOCCI_SALES_ACCESS_TOKEN` e
`FOOCCI_SALES_WHATSAPP_ATIVO`. Nenhum nome de modelo em lugar nenhum.

**E isso não é contornável.** Quem preencheu o formulário e não escreveu **nunca
abriu a janela de 24 h** da Meta. Para essa pessoa, texto livre não é uma
mensagem pior — é uma mensagem **recusada pela Graph API**. A política já estava
escrita em `whatsapp/metaSendPolicy.ts` e agora é obedecida por construção.

**O que eu NÃO consegui medir daqui:** o que está aprovado *dentro* da conta da
Meta. Conferir isso exige o token de vendas, que não é meu. O que está escrito
acima é o estado do **código**: nenhum modelo declarado. O estado do lado da Meta
é pergunta para o `meta`, com o token na mão.

## As três chaves, e a ordem em que elas travam

1. **`FOOCCI_SDR_SEND_ENABLED`** — do CEO. Desligada, o portão barra todo mundo
   com `CANAL_INDISPONIVEL` e nada chega nem a ser reservado. *(Continua
   desligada. Este bloco não a toca.)*
2. **`FOOCCI_PRIMEIRO_CONTATO_LIGADO`** + **`FOOCCI_PRIMEIRO_CONTATO_TETO_DIARIO`**
   — a chave própria desta obra. Ausência = desligado; teto ausente ou não
   numérico = zero = nada sai. Teto máximo de 200/dia, por construção.
3. **`FOOCCI_SALES_TEMPLATE_ABERTURA`** (e `_LEMBRETE`) — o modelo aprovado. Sem
   ele, `SEM_MODELO_APROVADO` em toda a fila.

Cada uma é lida por requisição, no servidor. Nenhuma tem `NEXT_PUBLIC_`, então
nenhuma congela no build: trocar no Railway vale na chamada seguinte, **sem
deploy**.

### As variáveis do modelo, em detalhe

| Variável | Para que |
|---|---|
| `FOOCCI_SALES_TEMPLATE_ABERTURA` | o `name` do modelo dentro da Meta |
| `FOOCCI_SALES_TEMPLATE_ABERTURA_IDIOMA` | `language.code`. Padrão `pt_BR` |
| `FOOCCI_SALES_TEMPLATE_ABERTURA_PARAMS` | campos que preenchem `{{1}}`, `{{2}}`… na ordem. Lista fechada: `nome`, `restaurante`, `cidade` |
| `FOOCCI_SALES_TEMPLATE_ABERTURA_CORPO` | o corpo aprovado, com `{{1}}`, para a Sala mostrar o que foi dito |

As mesmas quatro existem com `_LEMBRETE`. Campo fora da lista fechada **invalida
o modelo inteiro** — de propósito: um `{{1}}` que a Meta rejeita descoberto no
primeiro lead real é caro; descoberto na fila, é uma linha de configuração.

## As travas, e o que cada uma evita

- **Uma abertura e um lembrete. Nunca uma terceira.** `REGRA.maxTentativas = 2` e
  48 h de descanso, do portão que já existia.
- **Montar a fila é leitura.** Nenhuma escrita ao abrir a fila — a lição que a
  prospecção pagou caro (a tela de conferência que queimava cem contatos a cada
  cinco recarregamentos).
- **Reserva por comparar-e-trocar.** Duas rodadas simultâneas: só uma aborda. Sem
  isso, a mesma pessoa receberia duas aberturas.
- **A reserva volta se a gravação falhar.** Sem isso o lead sairia da fila por
  48 h e voltaria como "lembrete" de uma abertura que nunca aconteceu.
- **O teto conta EVENTO, não lead.** `SiteLeadInteraction` com
  `actor = "primeiro-contato"`, gravada no mesmo ato do envio. É o conserto que
  `docs/pendencias.md` pede para a prospecção — aqui já nasce feito.
- **Quem já escreveu não entra.** `mensagens: { none: { direcao: "ENTRADA" } }` é
  a linha que separa "a casa começou a conversa" de "a casa respondeu".
- **Lista de prospecção não entra.** Só `FORMULARIO_DEMONSTRACAO` e `AGENDAMENTO`
  — as portas em que a própria pessoa entregou os dados. É delas, e só delas, que
  sai o consentimento que o portão exige.
- **Nenhuma chamada de modelo de IA, por lead nem por rodada.** O texto da
  primeira mensagem **é o do modelo aprovado**, palavra por palavra: a Meta
  aprova o texto, não a intenção. Redigir na hora produziria texto recusado, e
  custaria conta de IA para chegar em nada.

## O que ficou de fora, e por quê

- **Sem tabela nova, sem migration.** A configuração é ambiente. O que se perde é
  a trilha de quem pausou e por quê; o que **não** se perde é a pausa imediata
  sem deploy. No dia em que houver tela de comando, isto vira tabela.
- **Sem tela.** A fila se lê pelo gatilho (`GET`, com `?simular=1` para ver quem
  passaria com a chave ligada). Tela é trabalho do `interface`, e só faz sentido
  depois que houver modelo aprovado para mostrar.
- **Sem agendamento.** O workflow é manual. Pôr um `schedule` é o ato que
  transforma isto num robô que aborda gente sozinho — e esse ato é do CEO.

## Verificação

`npx tsc --noEmit` limpo · `npx vitest run` verde (8.000 testes, 580 arquivos),
dos quais **33 novos** em `primeiroContato.test.ts`, cobrindo cada trava acima.
Nenhum teste toca a rede: o envio à Meta é conferido pelo corpo do pedido
(`type: "template"`, nome, idioma e parâmetros).
