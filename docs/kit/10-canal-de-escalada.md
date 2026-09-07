<!-- ESPELHO-DO-KIT
origem: docs/10-canal-de-escalada.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: 8c566564d9565b82124ceac87116f8a384f46573ec86b5e2616ce89107d996e7
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/10-canal-de-escalada.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 10 — Como um Diretor de projeto fala com o Diretor Geral

> **Vale para todos os projetos Dioli.** Criado em 2026-08-02, a pedido do CEO,
> que perguntou: *"os diretores de cada projeto conseguem te consultar caso
> precisem tirar alguma dúvida?"*

---

## 1. A verdade primeiro: conversas não se falam

**Uma sessão de chat não alcança outra.** Não existe mensagem, notificação, fila ou
"chamar o outro agente". Cada conversa é uma ilha: nasce, lê os repositórios que
lhe deram, e morre.

> ⚠️ **Isto foi testado, não suposto — e a apuração vale mais que a conclusão.**
> Em 02/08 eu escrevi esta frase por palpite, depois me convenci de que estava
> errada, e por fim **executei o envio**: o servidor recusou com
> *"binding a trigger to another session is not enabled for this organization"*.
> A frase está certa; meu raciocínio original não estava. Detalhe em
> `14-interface-entre-diretores.md` §0.
>
> **É uma permissão desligada, não uma lei física.** Se um dia ligarem, este
> parágrafo muda — e só muda depois de alguém executar o envio de novo. **Nunca
> reescreva isto com base em documentação.**

Isso não é limitação a contornar com truque. É a razão de existir de toda a
estrutura deste kit: **se o conhecimento não estiver escrito num repositório, ele
não atravessa.**

Qualquer promessa de "eu pergunto pro Diretor Geral e te aviso" é falsa. Um agente
que disser isso está encenando uma capacidade que não tem — o que já tem nome na
casa: *mentir sobre si mesmo é uma categoria de erro separada*.

---

## 2. O que existe de verdade: três caminhos, nesta ordem

### Caminho 1 — Ler, e não perguntar (resolve a maioria)

A doutrina está escrita. Antes de escalar, o Diretor de projeto lê:

| Onde | O que responde |
|---|---|
| `dioli-brain-kit/CLAUDE.md` | o que é regra de companhia |
| `docs/01-filosofia.md` | verdade ancorada, o agente não inventa |
| `docs/09-como-trabalhar-aqui.md` | o ambiente e como o CEO trabalha |
| o `CLAUDE.md` do próprio projeto | os guardrails locais |
| `docs/decisoes.md` do próprio projeto | o que já foi decidido ali |

**Se a resposta está escrita, não é dúvida — é leitura pendente.**

### Caminho 2 — Escrever a pergunta no repositório (assíncrono, e é o normal)

Quando a resposta **não** está escrita, o Diretor **não segura o trabalho e não
inventa**. Ele escreve a pergunta em:

```
docs/perguntas-ao-diretor-geral.md      ← no repositório do próprio projeto
```

E **segue trabalhando em tudo que não depende da resposta**, deixando explícito o
que ficou bloqueado.

O Diretor Geral lê esse arquivo quando o CEO o aciona, responde no mesmo arquivo, e
**promove ao kit** o que valer para mais de um projeto. O Diretor do projeto vê a
resposta na sessão seguinte.

> **Por que no repositório do projeto e não no kit:** o Diretor de projeto só
> escreve na casa dele. É o guardrail "agente escreve só na própria sala" aplicado
> entre repositórios.

### Caminho 3 — O CEO carrega (síncrono, quando é urgente)

O CEO é o único canal em tempo real entre duas conversas. Ele cola a pergunta no
chat do Diretor Geral e leva a resposta de volta.

**Use com parcimônia.** Cada ida e volta custa tempo do CEO, e o modelo inteiro
existe para gastar menos tempo dele, não mais.

---

## 3. O que NUNCA é escalada

- **Decisão de produto, preço, escopo ou identidade** → é do CEO, não do Diretor
  Geral. Escalar para o lugar errado atrasa e confunde.
- **"Está travado, o que eu faço?"** sem ter lido os documentos → volte ao caminho 1.
- **Dúvida técnica dentro do domínio do projeto** → é do especialista do projeto,
  despachado pelo próprio Diretor.

O Diretor Geral decide **doutrina e coerência entre projetos**. Se a pergunta cabe
inteira dentro de um projeto, a resposta também cabe.

---

## 4. Formato da pergunta

Pergunta mal escrita volta como pergunta. O mínimo:

```markdown
## <pergunta em uma linha>

**Aberta em** AAAA-MM-DD · **projeto** <nome> · **bloqueia:** <o que parou, ou "nada">

**O que eu já li e não respondeu:** <arquivos consultados>

**As opções que eu vejo:** <duas ou três, com o custo de cada uma>

**Minha recomendação:** <qual e por quê>

---
**RESPOSTA** — preenchida pelo Diretor Geral
```

O campo **"o que eu já li"** é o que separa uma escalada de uma preguiça.

E **traga uma recomendação.** O Diretor Geral decide melhor entre opções analisadas
por quem está dentro do problema do que no vazio.

---

## 5. A regra que fecha

**Pergunta feita, resposta registrada.** Uma resposta que ficou só no chat vai ser
perguntada de novo em três semanas por outro Diretor — e a segunda resposta pode
não bater com a primeira.

É a regra de ouro da casa aplicada à escalada: *o chat é a sala de reunião; o
repositório é a memória.*
