<!-- ESPELHO-DO-KIT
origem: docs/07-memoria-de-agente.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: e02389884a4699fe38ab5aebd78bceeb9ee3916c8de3f2397d59a101e1952aa4
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/07-memoria-de-agente.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 07 — Memória de agente: as salas

> **Antes de tudo, uma distinção que evita aplicar a máquina errada na camada
> errada.** A palavra "agente" significa duas coisas neste kit.

## As duas camadas de agente

| | **Agente de produto** | **Agente de desenvolvimento** |
|---|---|---|
| Com quem fala | o **cliente final** | **você** / o PM |
| Exemplos | WhatsApp/Garçom, CRM, suporte | especialista de dados, de UI, de conformidade |
| Onde vive | no runtime do produto | em `.claude/agents/` |
| Custo de errar | cliente vai embora, dinheiro, processo | retrabalho |
| Erro é visível? | **quase nunca** — ninguém olha às 21h de sábado | sim, você lê a saída |
| Precisa de | **o kit inteiro** | filosofia + este arquivo + os invariantes |

**Os princípios são os mesmos. A maquinaria não é.**

Um agente de desenvolvimento não precisa de adaptador de conhecimento, crítico
claim-vs-snapshot nem escada de governança. Precisa de memória disciplinada
(este arquivo), menor privilégio e da regra de que nunca muda as próprias regras.

Um agente de produto precisa disso **e de todo o resto do kit**.

> **O modo de falha a evitar:** concluir que, porque existe um humano revisando o
> trabalho, o agente que fala com o cliente também está coberto. **Não está.** O
> humano revisa o que ele lê. Ninguém lê a conversa das 21h de sábado.

---

## O problema que a memória resolve

Um agente de desenvolvimento **nasce e morre a cada chamada**: recebe a tarefa,
faz, devolve a conclusão, esquece tudo. Chamar de novo é um agente novo, do zero.

Isso é o que torna o modelo escalável — cada agente gasta o próprio contexto e
devolve só a conclusão, sem entupir a sessão principal. Mas tem consequência: sem
memória externa, na semana 8 o PM está re-explicando ao especialista o que o
próprio especialista descobriu na semana 3. E se o PM esquecer de contar, o
agente refaz o mesmo erro.

**Sair de "vários chats" para "um PM que delega" mata a memória de conversa.
Alguma coisa tem que ocupar o lugar dela.**

---

## A estrutura: vitrine e oficina

```
docs/agents/<especialista>/
  ├── vitrine.md          ← curto, curado. Outros leem. O AGENTE NÃO ESCREVE.
  ├── oficina.md          ← append-only. O agente escreve. Corrente.
  └── oficina/
      └── 2026-07.md      ← mês fechado. Perícia, não leitura.
docs/decisoes.md          ← o corredor. Decisão transversal. Só o PM escreve.
```

### A vitrine

O que o especialista quer que o resto do time saiba: decisões firmadas, regras
que não se discutem mais, estado atual. **Duas telas no máximo.** Se não cabe,
não é vitrine — é oficina mal classificada, e ela come justamente o contexto que
a delegação existia para economizar.

Toda entrada carrega **proveniência**:

```markdown
## <O fato ou a regra, em uma linha>
<2–5 linhas. Tem que ser compreensível por um agente que NUNCA viu a
conversa em que isso foi descoberto.>

— promovido em 2026-07-31 por <quem> · origem: oficina/2026-07.md#<âncora> (commit a1b2c3d)
```

Sem proveniência, o "confiantemente errado" volta por outra porta: o fato está na
vitrine, ninguém rastreia de onde veio, ninguém audita se a promoção foi boa. É a
regra do incidente 6 (`06-incidentes.md`) aplicada à memória.

### A oficina

Caderno de rascunho: o que tentou, o que quebrou, o log do dia. O agente escreve
à vontade.

**Rotação:** ao virar o mês, `oficina.md` vira `oficina/AAAA-MM.md` e recomeça
vazio. A assimetria é intencional — **a vitrine tem teto de tamanho; a oficina
tem teto de idade.**

**O arquivo morto é para perícia, não para leitura.** Serve para reconstruir o
raciocínio quando uma decisão der errado. **O agente lê apenas a oficina
corrente.** Sem isso escrito, alguém vai tentar fazer o agente ler oito meses de
diário e reintroduz exatamente o problema de contexto que a rotação resolvia.

### O corredor

Decisão que atravessa domínios não mora em sala nenhuma. Vai para
`docs/decisoes.md`, e **só o PM escreve lá**.

Sem o corredor, uma decisão que afeta três especialistas vira três versões dela —
cada uma na vitrine do seu dono, todas se achando certas, e em um mês elas se
contradizem.

---

## As cinco regras

**1. O agente escreve só na própria sala.** Precisa de algo mudado na sala de
outro especialista? **Pede ao PM.** Nunca entra e edita.

**2. O agente escreve na oficina, nunca na vitrine.** Ele *propõe* a entrada de
vitrine como parte da saída padronizada dele; **quem promove é o PM**. É o
`agentsCanMutateBrain: false` dos invariantes aplicado à memória — sem isso o
agente se envenena com a própria conclusão errada e constrói em cima dela.

**3. A promoção é barata porque já está no fluxo.** Todo bloco de trabalho
termina em commit; quem revisa vê o diff da vitrine no mesmo gesto. Custo quase
zero, proteção alta. Não transforme em ritual separado — ritual separado é pulado.

**4. Hierarquia de conflito, com correção.**

```
guardrails globais  >  corredor  >  camadas de referência  >  vitrine
```

Mas precedência sozinha não basta:

> **Conflito detectado → o item de menor precedência é CORRIGIDO na mesma
> sessão.** Dizer "a vitrine está errada por definição" resolve a discussão e
> deixa uma mentira conhecida num arquivo que os agentes leem como verdade.
>
> A lição geral: **um verificador que dispara e não conserta nada treina a equipe
> a ignorar o verificador** (ver incidente 4).

**5. Sala nasce sob demanda.** Não crie a estrutura de memória de todos os
especialistas no dia 1 — pasta vazia é cerimônia. A primeira nasce quando um
agente acumular aprendizado real entre sessões. *(É o `03-como-plantar.md`
aplicado a si mesmo: não construa governança antes de ter o que governar.)*

---

## Menor privilégio: trava vs. aviso

Vale para as duas camadas, e é a versão geral dos "dois dentes" da filosofia.

> **Para o que causa dano real, prompt é aviso — não trava.**

| Em vez de… | Use… |
|---|---|
| "não invente preço" no prompt | verificador que compara valor contra a verdade |
| "não prometa pedido" no prompt | verbo proibido barrado pelo crítico |
| "não mexa em arquivo" no prompt | **não dar a ferramenta de escrita ao agente** |
| "seja rigoroso ao se autoavaliar" | outro avaliador, ou olho humano no resultado |

A última linha é a mais subestimada: **um modelo avaliando o próprio trabalho é
generoso.** Pedir rigor não conserta isso.

Aplicação direta na camada de desenvolvimento: dar todas as ferramentas a todo
especialista é conforto, não desenho. Um agente de análise que não pode escrever
arquivo não apaga nada por engano — e isso é trava, não pedido.

---

## Checklist de implantação da memória

- [ ] O especialista acumulou aprendizado real entre sessões? Se não, **pare aqui**.
- [ ] `docs/agents/<slug>/vitrine.md` criado, vazio ou com o que já se sabe
- [ ] O prompt do agente manda ler a vitrine antes de qualquer coisa
- [ ] A saída padronizada do agente inclui "registro de oficina" e "proposta de vitrine"
- [ ] `docs/decisoes.md` existe e o PM sabe que só ele escreve lá
- [ ] A hierarquia de conflito está escrita no `CLAUDE.md` do projeto
- [ ] O encerramento de bloco inclui "promover vitrines propostas"
