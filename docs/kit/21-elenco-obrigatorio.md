<!-- ESPELHO-DO-KIT
origem: docs/21-elenco-obrigatorio.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: 8c9e3c1a48cfe4c1459deb895d33fd671ec7a45a229eba87f627ac31f611733c
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/21-elenco-obrigatorio.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 21 — Os Essenciais: o elenco obrigatório de um projeto

> **Os cinco se chamam Essenciais** — nome dado pelo CEO em 07/08/2026.
> A constituição de cada um está em `23-constituicao-dos-essenciais.md`.

> **Status:** **ADOTADO por ordem do CEO em 07/08/2026.** Os cinco valem.
> **Autor:** Diretor do Foocci. **Origem:** pergunta direta do CEO.
>
> Palavras dele ao aprovar: *"está aprovado os cinco agentes que são obrigatórios,
> e não vão ser apagados de jeito nenhum, que já vem junto com o projeto."*

---

## A pergunta

CEO, 07/08/2026:

> *"Eu queria que você me ajudasse a elencar os agentes que são fundamentais pra
> qualquer tipo de projeto que a gente for fazer no digital, pra que a gente torne
> uma regra de que eles já venham no kit obrigatoriamente. Quais são os agentes,
> além do Diretor, que precisam ser obrigatórios pra todos os projetos?"*

---

## O critério que usei

Não listei o que soa completo. Listei o que, **quando faltou, produziu dano
verificável** — no Foocci, na Dioli Digital, ou nos incidentes de
`06-incidentes.md`.

Um elenco obrigatório longo demais é cerimônia: sala vazia, agente que ninguém
despacha, e a regra vira folclore. Um elenco curto demais devolve o projeto ao
Diretor que faz tudo sozinho — que a doutrina 15 já classificou como **defeito,
não estilo**.

Três perguntas para cada candidato:

1. **Existe projeto digital em que ele não faria falta?** Se sim, não é obrigatório.
2. **O Diretor consegue fazer o papel dele sozinho?** Se sim, não precisa de agente.
3. **Já custou alguma coisa a ausência dele?** Se não, é palpite meu, não regra.

---

## A proposta: quatro obrigatórios, e um a criar

### 1. `qualidade` — o que duvida

**Por que é o primeiro da lista:** é o único cujo trabalho é **reprovar o
trabalho dos outros**, inclusive o do Diretor. Todo o resto do modelo pressupõe
alguém conferindo, e o conferente não pode ser o autor.

**O que custou a ausência dele:** na esteira da agência, **28 de 31 portões não
rodavam** — eram decoração. No Garçom, o caso `re-02` do golden set carimbava
verde uma resposta que devolvia 10 itens de trigo para quem pediu "sem glúten",
porque conferia existência e preço e nunca segurança. Portão que ninguém audita
vira selo.

**Detalhe que o torna seguro de tornar obrigatório:** ele é **somente leitura, de
propósito**. Não escreve em lugar nenhum. Custa pouco tê-lo e não pode quebrar
nada.

---

### 2. `cerebro` — raciocínio, portões, verdade

**Por que:** este kit **é** o Cérebro. Qualquer projeto que tenha um agente de IA
falando com alguém precisa de um dono para a escada de liberação, a tabela de
verdade e o que o agente pode ou não afirmar.

**O que custou a ausência dele:** o agente afirmando entrega para cidade que o
restaurante não atende — inferida do silêncio da base. É a origem do guardrail 1
da companhia.

**Ressalva honesta:** um projeto **sem nenhuma IA** não precisaria dele. Não
conheço nenhum projeto Dioli nessa situação, então na prática é obrigatório.

---

### 3. `interface` — como a tela fica

**Por que:** todo projeto digital tem tela, e sem um dono do sistema de design a
divergência é questão de semanas, não de meses. É o agente que responde por
tokens, responsivo e pelos três estados obrigatórios (carregando, vazio, erro).

**O que custou a ausência dele:** o `DESIGN.md` do Foocci existe porque a
identidade tinha derivado — cinza cru, roxo como cor de ação, hex solto onde já
havia token. Cada tela nova reabria a discussão do zero.

---

### 4. `experiencia` — se a tela funciona para quem usa

**Por que é um agente separado do `interface`, e não um capricho:** eles olham a
mesma tela e fazem perguntas diferentes. O `interface` pergunta *"está bonita e
funciona em 375, 768 e 1280?"*. O `experiencia` pergunta *"essa tela deveria
existir, e a pessoa consegue fazer o que veio fazer?"*.

**O que custou a ausência dele:** a nota de 0 a 10 do `interface` — hierarquia,
tipografia, espaçamento, consistência — **não pega** o filtro que não filtrava, o
"Total hoje" que mentia, nem o botão de pausar a loja escondido embaixo de outra
barra. **Nenhum desses é feio.** Este agente nasceu em 05/08/2026 exatamente
depois dessa constatação.

**Regra de bolso da fronteira:** correção que é trocar uma classe é do
`interface`; correção que é tirar a tela, mudar a ordem dos passos ou consertar o
que o botão faz é do `experiencia`.

---

### 5. `seguranca` — **APROVADO E CRIADO EM 07/08/2026**

**Este é o buraco da estrutura atual.** A companhia tem doutrina de segurança
(`04-seguranca.md`) e **não tem dono**. Resultado: `qualidade` acha os problemas
mas é somente leitura e não é o mandato dele; cada especialista de domínio
presume que a porta aberta é do vizinho; e o item fica no backlog para sempre.

**O que está aberto e sem dono só no Foocci, em 07/08/2026:**

- webhook de parceiro **sem autenticação nenhuma**, ativo;
- provedor de pagamento **aceitando cobrança forjada** se o segredo não estiver
  configurado;
- rota de cron protegida por `if (secret)` — sem segredo, entra qualquer um;
- rota de recuperação que escolhe **"o primeiro restaurante ativo"**;
- credencial de pagamento colada em chat e **não rotacionada**.

Nenhum desses é ambíguo. Todos estão parados porque **ninguém responde por eles**.

**Mandato que eu proponho:** varredura periódica de superfície exposta (os cinco
padrões nomeados do raio-x, doutrina 16), ciclo de vida de credencial, e o
direito de **abrir P0 e barrar merge**. Somente leitura para diagnosticar; com
escrita para consertar, ao contrário do `qualidade`.

---

### 6. `branding` — **APROVADO PELO CEO EM 09/08/2026**

> *"A gente não constrói sistemas, a gente constrói marcas. E quem cuida das
> marcas é o branding agent."* — CEO, 09/08/2026

**Este é o segundo buraco sem dono, e é do mesmo tipo do primeiro.** A companhia
inteira existe para construir marcas — e a marca não tem agente, não tem endereço
e não tem quem responda por ela. O resultado é o previsível: cada peça é julgada
pelo fato (é verdade?) e nunca pela identidade (isto somos nós?).

**Medido na Dioli Digital em 09/08/2026, contra o banco em produção:**

- o cérebro de marca guarda **11 campos de texto** — nome, cor, tipografia, tom,
  público, posicionamento — e **nenhum campo de proibição**;
- **nenhum campo de referência visual**. *"Nunca escreva o nome em letra
  gigante"* não tem onde ser escrito;
- quem produz a peça recebe **7 linhas** sobre a marca;
- **a reprovação não vira regra**: sem contador de voltas nem histórico por peça,
  a peça 3 repete o erro da peça 1.

A auditoria de 08/08 já havia nomeado isto como **a causa raiz de uma peça
reprovada** — e um dia depois nada tinha mudado. É o mesmo padrão que criou o
`seguranca`: o defeito é conhecido, está escrito, e não anda porque não é o
mandato de ninguém.

**Mandato:** responder pela verdade da marca — o que ela é, o que ela **nunca**
pode fazer, e com o que ela se parece. Guardar proibição e referência visual.
Transformar cada reprovação do cliente em regra que a próxima peça já obedece. E
ser o **segundo portão** antes de a peça chegar ao cliente: aprova ou devolve,
por razão de marca.

**Fronteira com `qualidade`, porque fazem divisa e olham a MESMA peça:**
`qualidade` pergunta *"isto é verdade e é verificável?"*; `branding` pergunta
*"isto somos nós?"*. **Uma peça pode ser inteiramente verdadeira e não ser da
marca** — e hoje ela passa, porque ninguém faz a segunda pergunta.

> ⚠️ **A ressalva entra junto, para não distorcer a ordem de execução.**
> O `branding` é a alavanca da **qualidade**, não a do **desbloqueio**. Em 09/08
> a agência estava travada por formato de arquivo, uma porta de upload fechada e
> uma permissão de plataforma não enviada — **nenhuma das três é questão de
> marca**, e um `branding` perfeito não teria publicado um post sequer. Criar
> este agente antes de a última milha fechar produz peças excelentes que
> continuam não chegando a ninguém.

**Condição para ele não virar enfeite:** os campos precisam existir **e o
produtor precisa recebê-los**. Campo que ninguém lê é decoração — e foi
exatamente assim que um cérebro de marca chegou a 11 campos servindo 7 linhas.

---

## O que eu NÃO tornaria obrigatório — e por quê

| Agente | Por que fica de fora |
|---|---|
| `manual` (guias, onboarding) | Projeto sem usuário externo ainda, ou ferramenta interna, não precisa. **Condicional:** vira obrigatório no dia em que o produto tiver cliente que não seja a casa. |
| Especialistas de domínio (`garcom`, `crm`, `operacao`, `canais`, `meta`, `agencia`…) | São **a definição** do que o projeto faz. Não cabem numa lista universal — a doutrina 15 já dá os dois critérios para saber quando falta um. |
| Um agente de "documentação" separado | O registro é obrigação de **todo** agente, na própria oficina. Terceirizar isso para um agente é como ter alguém que escreve o diário dos outros: ele não estava lá. |

---

## O quadro final

```
CEO
 └── Diretor Geral do Cérebro
      └── Diretor do Projeto              ← sempre existe. É a porta do projeto.
           ├── qualidade      ← OBRIGATÓRIO · o que duvida (só leitura)
           ├── cerebro        ← OBRIGATÓRIO · raciocínio, portões, verdade
           ├── interface      ← OBRIGATÓRIO · como a tela fica
           ├── experiencia    ← OBRIGATÓRIO · se a tela funciona para quem usa
           ├── seguranca      ← OBRIGATÓRIO · a porta que ninguém fecha
           ├── branding       ← OBRIGATÓRIO · a marca: o que é, o que nunca pode
           └── <domínio>      ← por projeto · o que este produto faz
```

**Seis obrigatórios.** Nenhum deles pode ser apagado de um projeto.

> O sexto entrou em 09/08/2026, por decisão do CEO, com o mesmo argumento que
> criou o quinto: existe doutrina, existe defeito medido, e não existe dono.
> A razão dele é a mais estrutural da lista — **a companhia não vende sistema,
> vende marca**, e até 09/08 a marca era a única coisa sem agente.

---

## O que muda em cada projeto se isto virar regra

1. Todo projeto passa a nascer com quatro (ou cinco) perfis em `.claude/agents/`,
   vindos do kit — **apontados, não copiados**, conforme a regra desta casa.
2. Um projeto que hoje não tem os quatro fica com a lacuna **visível na Sala dos
   Agentes** (doutrina 20), em vez de invisível.
3. A pergunta do CEO — *"quem está sendo usado, quem não está"* — passa a ter uma
   linha de base: quem **deveria** estar lá.

---

## Registro de autoria

- **07/08/2026** — proposta escrita pelo Diretor do Foocci em resposta a pergunta
  direta do CEO. Toda evidência citada vem do Foocci e está registrada em
  `docs/agents/*/oficina.md` e nos commits daquela semana. A decisão de qual
  lista vale é do CEO.
