<!-- ESPELHO-DO-KIT
origem: docs/01-filosofia.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: 088d428d246ea979739f07a3a048422d578167876e4fac6db80c256cc9fa4a46
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/01-filosofia.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 01 — Filosofia: a Regra de Ouro

## A Regra de Ouro

**Todo agente raciocina através de UM portão único.** Nenhum código fala com a
IA-piloto (OpenAI/Anthropic/qualquer) por fora do motor do cérebro.

No FOOCCI isso é `reasonAsAgent()` — uma função por onde TODOS os agentes passam.
O portão é o que torna possível governar: um lugar só para injetar verdade,
medir coerência, aplicar gates e trocar de piloto sem reescrever o produto.

### Por que isso é inegociável

- **Sem portão único, não há governança** — cada chamada solta é um agente
  clandestino que ninguém audita.
- **Verdade ancorada**: o portão injeta a fonte de verdade (adaptador de
  conhecimento) em toda chamada. O agente não "sabe" — ele **consulta**.
- **Troca de piloto barata**: o dia em que mudar de modelo/fornecedor, muda-se o
  motor, não o produto.

### Como se blinda (dois dentes)

1. **Regra de lint** proibindo importar o SDK da IA fora do motor
   (`no-restricted-imports` com exceção só para `engines/`).
2. **Teste arquitetural** que varre o código e falha o CI se alguém importar a
   IA por fora (lista de exceções CONGELADA — só pode diminuir).

## Princípios que acompanham a regra

### 1. Verdade ancorada — o agente nunca inventa
Todo fato que o agente afirma vem de um **truthSource** (dado real do banco,
serializado pelo adaptador de conhecimento). Sem dado → o agente diz que não
sabe e pergunta. Guardrails explícitos no prompt para os pontos onde LLM tende a
inventar (cobertura de entrega, superlativos, preço, promoção).

**A metade que quase todo mundo esquece: ausência de informação NÃO é
informação.** O agente nunca infere uma **negação** a partir do silêncio da base.
Afirmar o que não se sabe é ruim; **negar o que não se sabe é pior**, porque soa
autoritativo e o cliente vai embora sem perguntar de novo — ninguém reclama de
uma negação, o cliente só some. Sem fato explícito, a resposta é "preciso
confirmar", nunca "não temos". *(Incidente 1 — o mais caro que já tivemos.)*

### 2. O freio de mão — autonomia é conquistada
Todo agente nasce em **SOMBRA** (observa, propõe, não executa). Sobe a escada
(`SHADOW_ONLY → ALLOWLIST → RESTAURANT_WIDE`/`WIDE`) por decisão humana apoiada
em evidência coletada na sombra. Ações executáveis vivem num **catálogo
fechado** — o raciocínio escolhe entre ações pré-declaradas; texto livre de
usuário JAMAIS vira comando.

### 3. Paciência — não agir com dado fino
Um agente que otimiza com amostra pequena é um agente que erra com confiança.
Limiares explícitos (ex.: CRM só otimiza frases com ≥100 envios na campanha e
≥30 por frase). Esperar É a estratégia.

### 4. Quality gate por agente — P0 = zero
Cada agente tem um diagnóstico próprio registrado no cérebro
(`registerQualityGate(agentId, gate)`) que barra as falhas graves do SEU domínio
(inventar desconto, expor segredo, prometer o que não pode). O gate é
determinístico e roda em toda resposta.

### 5. Silêncio honesto — só falar quando há o que dizer
Um agente que fala sempre vira ruído; um painel mudo parece quebrado. Regra
dupla: **resumo-base sempre presente** (mesmo que seja "sem atividade, e tudo
bem") + **destaques só quando notáveis** (com limiar explícito).

### 6. Falha honesta — nunca fingir
IA indisponível → resposta determinística de segurança dizendo o que se sabe
pelos sinais, nunca silêncio nem invenção. Teste falhou → reportar com o output.
Não sabe → escala para humano com o diagnóstico pronto.

### 7. O molde melhora com cada projeto
O que um plantio ensinar (um bug de ancoragem, um gate novo, um limiar melhor)
volta para o kit. Juro composto de engenharia.

### 8. Trava vs. aviso — para dano real, prompt não basta
Escrever "não faça X" no prompt é sugestão forte, não garantia. Se o custo de
fazer X é alto, exija **mecanismo**: verificador, verbo proibido barrado pelo
crítico, ferramenta não concedida. É a generalização dos "dois dentes" da Regra
de Ouro — a blindagem do portão não é o comentário no código, é o lint mais o
teste arquitetural.

O caso mais subestimado: **um modelo que avalia o próprio trabalho é generoso.**
Pedir rigor no prompt não conserta; o que conserta é outro avaliador ou olho
humano no resultado.

### 9. A queda preserva o contexto
Proteção que dispara **não pode ser mais destrutiva que o problema que ela
evita**. Quando um gate reprova e o agente cai para o caminho determinístico, o
cliente recebe *"desculpa, não peguei essa — pode repetir?"*, com o contexto
intacto. Devolver a tela de entrada no meio de um atendimento não é queda: é
apagar a memória na frente do cliente. *(Incidente 3 — cinco vezes na mesma
conversa.)*

### 10. Verificação não registrada = reprovado
`if (!gate) return { passed: true }` transforma "esqueci de escrever o gate" em
"liberado pra produção". O default seguro é o inverso: **sem gate registrado, o
agente é REPROVADO por construção**. Vale para quality gate, manual de domínio e
qualquer checagem plugável por registry. *(Incidente 8.)*

---

## Leitura obrigatória junto com este arquivo

- **`06-incidentes.md`** — as histórias que produziram estas regras. Regra sem
  história parece exagero, e exagero é a primeira coisa que alguém simplifica.
- **`07-memoria-de-agente.md`** — a distinção entre agente de produto e agente de
  desenvolvimento, e como cada um guarda o que aprende.
