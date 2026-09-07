<!-- ESPELHO-DO-KIT
origem: docs/22-briefing-ao-conselho.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: 0d8cfe45f7d13daf8c6096ca6cadf4d9dfb0ab17768487f786fc0063a7b3d7a3
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/22-briefing-ao-conselho.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 22 — Briefing ao Conselho: a constituição dos cinco obrigatórios

> **Status:** briefing pronto para ser levado ao Conselho pelo CEO.
> **Origem:** proposta do CEO em 07/08/2026.
> **Autor do briefing:** Diretor do Foocci.

---

## A ideia do CEO, e por que ela resolve um problema que eu não tinha resolvido

Palavras dele:

> *"Se a gente tiver o desenho, o melhor desenho possível desses agentes, não
> seria melhor a gente bloqueá-los? E quando eu falo desenho, estou falando de
> descrição de cargo, das coisas que independem do tipo de negócio. É como se eu
> dissesse: esse agente vai ser um agente proativo. Não estou falando que ele vai
> ser proativo num cardápio ou proativo vendendo roupa."*

Isto separa duas coisas que eu estava tratando como uma só, e a separação é o
ponto inteiro:

| Camada | O que é | Depende do negócio? |
|---|---|---|
| **Constituição** | quem este papel é, como ele se comporta, o que nunca faz | **Não** |
| **Domínio** | o que ele sabe: cardápio, peça de mídia, apólice, vaga | **Sim** |

Eu havia argumentado contra congelar os cinco, com o argumento de que um agente
que não aprende o projeto vira enfeite. **O argumento estava certo e mirava a
camada errada.** É o *domínio* que precisa ficar aberto. A *constituição* não só
pode como **deve** ser congelada — é justamente ela que não muda entre vender
comida e vender roupa.

**A regra que sai daqui:**

- **Constituição — TRAVADA.** Igual em todo projeto, não editável pelo Diretor.
  Mudança só pelo Diretor Geral com aval do CEO.
- **Domínio — ABERTO,** com assimetria: **ampliar é livre; reduzir precisa de
  aval.** Acrescentar caso, portão e exemplo é obrigação do Diretor. Apagar o
  agente, desligá-lo, estreitar o que ele audita ou afrouxar uma trava sobe.

---

## O que o Conselho tem que produzir

**Cinco constituições.** Uma para cada: `qualidade`, `cerebro`, `interface`,
`experiencia`, `seguranca`.

E o mais importante: **não é texto livre.** O Conselho preenche uma estrutura
fixa — a mesma anatomia que a ficha do agente usa na tela. Se cada IA escrever do
seu jeito, o resultado não entra em campo nenhum e vira prosa bonita que ninguém
usa.

### A estrutura a preencher, campo por campo

| # | Campo | O que se espera | Exemplo do formato certo |
|---|---|---|---|
| 1 | **Missão** | uma frase. Para que este papel existe | *"Duvidar do resultado antes que o cliente duvide."* |
| 2 | **Postura** | proativo / reativo / adversarial — e em que situação muda | *"Adversarial por padrão; colaborativo só depois de reprovar."* |
| 3 | **Nível de iniciativa** | o que ele faz sem pedir, o que pede, o que nunca faz | três listas |
| 4 | **Como decide quando não sabe** | o comportamento exato diante de informação faltando | *"Declara a lacuna e bloqueia; nunca preenche por inferência."* |
| 5 | **Sinais de que deve intervir** | os gatilhos que o acordam | lista de condições observáveis |
| 6 | **Como ele fala** | tom, tamanho, o que sempre inclui | *"Toda reprovação vem com o caso concreto anexo."* |
| 7 | **Como mede o próprio sucesso** | e como saber que ele está falhando | par: métrica boa / sintoma de falha |
| 8 | **Quando escala, e para quem** | condição e destinatário | |
| 9 | **O que ele NUNCA faz** | as travas do papel | lista curta e absoluta |
| 10 | **Como colabora com os outros quatro** | a fronteira com cada um | *"Se a correção é trocar uma classe, é do interface."* |
| 11 | **Os dois erros clássicos deste papel** | como este cargo falha no mundo real | |
| 12 | **Como saber que ele virou enfeite** | o sintoma de agente que existe e não trabalha | |

### As cinco regras que fazem a diferença entre material útil e prosa

Coloque isto **dentro** do pedido ao Conselho:

1. **Comportamento verificável, não adjetivo.** "Seja proativo" não muda nada.
   "Ao detectar X, faz Y sem esperar pedido" muda. Todo campo tem que descrever
   algo que alguém consegue observar acontecendo ou não acontecendo.

2. **Zero vocabulário de domínio.** Nada de cardápio, prato, restaurante, peça,
   campanha. Se a frase só faz sentido num tipo de negócio, ela pertence à outra
   camada e tem que sair.

3. **Diga o que o papel NÃO é.** Cada constituição termina dizendo de quem é o
   trabalho vizinho. Fronteira mal desenhada é a causa número um de dois agentes
   fazendo o mesmo e nenhum fazendo o que faltava.

4. **Nomeie os erros clássicos do cargo.** Um bom desenho de papel carrega as
   armadilhas conhecidas dele. Sem isso a constituição descreve o dia bom e é
   inútil no dia ruim.

5. **Corte o que for cerimônia.** Se um campo não muda nenhuma decisão do agente,
   ele não deveria existir. Prefira cinco linhas afiadas a trinta genéricas.

### O que já está decidido e não se discute

Passe isto ao Conselho como **restrição**, não como sugestão:

- **`qualidade` é somente leitura.** Não é preferência: é restrição de
  ferramenta. Ele diagnostica e nunca conserta.
- **`seguranca` tem escrita**, porque diagnosticar sem poder consertar foi o que
  travou a lista de furos por semanas. Em troca, conserto que mexe em pagamento
  ou em integração de parceiro passa por humano.
- **`interface` é UI; `experiencia` é UX.** São dois porque a nota alta de
  aparência convive com uma tela que não funciona.
- **`cerebro` responde pela verdade**: o que o sistema pode afirmar e com que
  lastro.
- **Ausência de informação nunca vira informação.** Vale para os cinco.
- **Aviso escrito não protege nada.** Onde o dano é real, o desenho tem que pedir
  mecanismo — trava, validação, restrição de ferramenta.

---

## O texto para colar no Conselho

> Vocês vão escrever a **constituição** de cinco papéis de agente de IA que
> existirão em todo projeto digital de uma empresa — hoje software para
> restaurantes e uma operação de marketing, amanhã qualquer outro ramo.
>
> Os cinco papéis:
> 1. **Qualidade** — o que duvida do trabalho dos outros, inclusive do chefe.
>    Somente leitura: diagnostica, nunca conserta.
> 2. **Cérebro** — responde pela verdade: o que o sistema pode afirmar, com que
>    lastro, e quanta autonomia cada agente tem.
> 3. **Interface** — como a tela fica: consistência visual, hierarquia, os
>    estados de carregando, vazio e erro.
> 4. **Experiência** — se a pessoa consegue fazer o que veio fazer: percurso,
>    ordem dos passos, controle que promete e não cumpre.
> 5. **Segurança** — quem consegue entrar sem ser convidado: superfície exposta,
>    autenticação, ciclo de vida de credencial.
>
> **Escrevam a descrição de cargo em nível máximo de expertise, e independente do
> ramo.** "Proativo" é traço do papel; "proativo num cardápio" não entra.
>
> Para cada um dos cinco, preencham exatamente estes doze campos: missão;
> postura; nível de iniciativa (o que faz sozinho / o que pede / o que nunca
> faz); como decide quando falta informação; sinais de que deve intervir; como
> fala; como mede o próprio sucesso e como saber que está falhando; quando escala
> e para quem; o que nunca faz; como colabora com os outros quatro e onde fica a
> fronteira; os dois erros clássicos deste cargo no mundo real; e como perceber
> que ele virou enfeite.
>
> **Cinco exigências:**
> (a) comportamento observável, nunca adjetivo — "seja rigoroso" é lixo, "ao
> detectar X faz Y sem esperar pedido" serve;
> (b) nenhuma palavra de um ramo específico;
> (c) toda constituição diz de quem é o trabalho vizinho;
> (d) nomeiem as armadilhas conhecidas do cargo, não só o dia bom;
> (e) cortem o que não muda nenhuma decisão — cinco linhas afiadas valem mais que
> trinta genéricas.
>
> **Restrições que não se discutem:** qualidade é somente leitura; segurança tem
> escrita mas conserto sensível passa por humano; interface e experiência são
> papéis separados de propósito, porque tela bonita e tela que funciona não são a
> mesma coisa; ausência de informação nunca pode virar informação; e onde o dano
> é real, o desenho tem que pedir mecanismo, não aviso escrito.
>
> **Se os membros divergirem, entreguem a divergência nomeada em vez de uma média
> conciliadora.** Média de opiniões apaga justamente a parte afiada, que é a que
> vale.

---

## O que acontece quando o material voltar

1. O Diretor do Foocci recebe o material e **preenche as cinco constituições**
   nos perfis de `.claude/agents/`.
2. **Nada entra cru.** Cada campo é conferido contra o que este repositório já
   aprendeu — a doutrina dos incidentes tem precedência sobre a opinião do
   Conselho, porque ela custou incidente e a outra não.
3. Onde o Conselho contradisser a doutrina, a contradição **vai escrita** para o
   CEO, não é resolvida em silêncio.
4. Depois de preenchidas e aprovadas, as constituições **travam**: passam a valer
   igual em todo projeto, e o Diretor só mexe na camada de domínio.
5. A trava não é só documento. É **teste que reprova o CI** se um dos cinco
   sumir, for desligado, ou tiver a constituição alterada localmente.

---

## Registro de autoria

- **07/08/2026** — briefing escrito pelo Diretor do Foocci a pedido do CEO. A
  ideia de separar constituição (universal) de domínio (local), e de travar a
  primeira, é do CEO. Ela corrigiu uma recomendação minha anterior que mirava a
  camada errada.
