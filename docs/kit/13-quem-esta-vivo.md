<!-- ESPELHO-DO-KIT
origem: docs/13-quem-esta-vivo.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: 69115396192495d5137de531b7f7fe8801162dfbbdfc2cd634144c1faeeea1a2
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/13-quem-esta-vivo.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 13 — Quem está vivo: sessões, colisão e quando montar um Diretor

> Criado em 2026-08-02, fechando três buracos que a estrutura tinha e ninguém via.
> Todos os três nasceram do mesmo erro: **confundir "o projeto tem estrutura" com
> "o projeto tem alguém trabalhando nele agora".**

---

## 1. O erro que gerou este documento

Em 02/08 o Diretor Geral trabalhou o dia inteiro dentro do Foocci — enquanto o
Diretor do Foocci estava numa sessão aberta, no mesmo repositório, na mesma hora.

Nós dois medimos a mesma coisa. Nós dois escrevemos no mesmo arquivo. **O merge
saiu limpo por sorte.**

A tabela em `CLAUDE.md` dizia que o Foocci tinha Diretor. **Dizia que tinha
estrutura, não que tinha alguém acordado.** São coisas diferentes, e a diferença
custou um dia.

---

## 2. O quadro de presença

`docs/presenca.md`, neste kit. Uma linha por sessão que abre.

**Quem escreve:** a própria sessão, ao começar a trabalhar.
**Quem apaga:** a própria sessão, ao encerrar — ou a próxima que perceber que a
linha está velha.

```markdown
| Projeto | Quem | Abriu em | Trabalhando em |
|---|---|---|---|
| Foocci | Diretor do projeto | 02/08 09:10 | site comercial |
```

### Por que um arquivo, e não algo mais esperto

Porque **não existe algo mais esperto que funcione aqui.** Sessões não se veem, não
há processo compartilhado, não há fila. Um arquivo commitado é a única coisa que
duas conversas isoladas conseguem ler.

E ele falha do lado seguro: linha velha faz alguém perguntar; linha ausente faz
alguém assumir que está livre — que é o padrão de hoje, e é o que deu errado.

### A regra de leitura

**Presença é indício, não prova.** Sessão que morre sem apagar a linha deixa fantasma.

- Linha com **mais de 24h** → trate como provavelmente morta, mas **pergunte ao CEO
  antes de assumir o trabalho**. Uma frase custa menos que trabalho duplicado.
- Linha **ausente** → não é prova de que ninguém está lá. Se o trabalho for grande,
  pergunte mesmo assim.

---

## 3. Reivindicação — quando duas sessões querem o mesmo bloco

Presença diz *quem está na casa*. Reivindicação diz *quem está mexendo naquilo*.

**Antes da primeira linha de código de um bloco:**

1. Escreva a reivindicação no `docs/pendencias.md` do projeto: quem, o quê, desde
   quando.
2. **Commite antes de começar.** Reivindicação que só existe na sua cabeça não
   coordena ninguém — foi exatamente o que faltou em 02/08.
3. Já existe reivindicação de outro? **Não duplique.** Some ao que ele faz, ou pegue
   outra coisa.
4. **Ao terminar, apague.** Reivindicação eterna vira ruído que todos aprendem a
   ignorar — e aí a próxima, a de verdade, também é ignorada (guardrail 6).

---

## 4. Quando um projeto adormecido ganha Diretor

Seis projetos dormem hoje. Nenhum tem `CLAUDE.md`, agente ou pendências — **e está
certo assim.** Montar estrutura para projeto parado é cerimônia.

O risco não é o sono. É **acordar sem Diretor** e voltar a virar chat solto — o
problema que este modelo existe para matar.

### O gatilho: qualquer um destes três

| Gatilho | Por que este |
|---|---|
| **O CEO pede duas coisas seguidas no mesmo projeto** | Uma é favor; duas é trabalho. Trabalho precisa de dono |
| **Existe usuário de verdade** — cliente pagante, ou alguém que sente falta se cair | Aí o defeito custa, e custo precisa de responsável |
| **O projeto vai receber mais de uma sessão** | Sem Diretor, duas sessões no mesmo repo é a colisão de 02/08 outra vez |

**O que NÃO é gatilho:** um commit solto, uma ideia, uma exploração. Isso é o CEO
pensando — e exploração pode ser direta, sem estrutura.

### Na dúvida, monte

O custo de montar cedo é um `CLAUDE.md` e meia hora. O custo de montar tarde é
conhecimento que morreu em três chats soltos e ninguém sabe que existiu.

**Assimetria clara → erre para o lado barato.**

---

## 5. O que fazer ao montar

Mínimo viável, na ordem. Nada além disto no primeiro dia:

1. **`CLAUDE.md`** — o que é o projeto, quem é o Diretor, os guardrails da casa
   (aponte para o kit; **não copie** — regra do CEO: cópia espalhada diverge).
2. **`docs/pendencias.md`** — o que está aberto. É o primeiro arquivo que toda
   sessão lê.
3. **`docs/perguntas-ao-diretor-geral.md`** — o canal de escalada.
4. **Especialistas: nenhum.** Eles nascem quando houver domínio real para separar.
   Agente sem trabalho é ficha bonita que ninguém despacha.
