<!-- ESPELHO-DO-KIT
origem: docs/02-arquitetura.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: f5b8842fa7ac4a3953b67234895352944934fa4df26827737ae459cf63926301
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/02-arquitetura.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 02 — Arquitetura: o molde peça a peça

O cérebro é um conjunto pequeno de peças com papéis claros. Os nomes abaixo são
os do FOOCCI (a referência provada); em cada produto adapte o nome, nunca o papel.

```
pedido do usuário / evento do sistema
        │
        ▼
┌───────────────────────────────────────────────┐
│ PORTÃO ÚNICO — reasonAsAgent({agentId, ...})  │
│  1. resolve a FICHA do agente (DB-first)      │
│  2. injeta a VERDADE (adaptador de conhec.)   │
│  3. injeta memória/aprendizados aprovados     │
│  4. chama o MOTOR (engine roteado por agente) │
│  5. roda crítico de coerência + QUALITY GATE  │
│  6. devolve resultado + evidência (shadow log)│
└───────────────────────────────────────────────┘
        │
        ▼
 ESCADA DE AÇÃO decide o que pode EXECUTAR
 (sombra: nada · allowlist: catálogo · wide: geral)
```

## As peças

### 1. Motor (engines/)
Único lugar que importa o SDK da IA. Dispatcher central (ex.:
`callStructuredJson`) + roteamento por agente (`selectEngineRouted(agentId)`),
persistível por produto/agente. Adapters específicos (ex.: transcrição Whisper)
também moram aqui — e SÓ aqui.

### 2. Portão (reasoning/)
`reasonAsAgent(request)` — agnóstico de agente. Monta o prompt de escopo com as
regras universais (verdade, guardrails anti-invenção), injeta o bloco de
conhecimento e devolve resultado estruturado com `reasoningMode`
(LLM/FALLBACK), `confidence` e veredito de coerência.

### 3. Fichas de agente (profiles)
Cada agente tem uma ficha padrão: persona, tom, o que pode/não pode, área.
Resolução **DB-first** (a ficha pode evoluir sem deploy) com default no código.
Um agente novo = uma ficha nova + registro. Nada mais.

### 4. Adaptadores de conhecimento (knowledge/)
A fonte de verdade POR DOMÍNIO, registrada num registry
(`KnowledgeAdapterRegistry`). Serializa fatos reais do banco em `truthSources`
(ex.: cardápio, entrega, endereço) + `missingContext` (o que falta — para o
agente saber o que não sabe). O agente técnico usa a variação "mapa do sistema
+ sinais read-only" (probe que nunca expõe valor de segredo).

### 5. Quality gates (quality/)
Registry por agente: `registerQualityGate(agentId, gate)`. O gate é
**determinístico** (regex/regras, não LLM), barra P0 do domínio e roda em toda
resposta. Exemplos provados: CRM (desconto inventado, spam, repetição),
suporte (instruir a apagar dado, expor segredo).

**O default do registry é REPROVAR.** Agente sem gate registrado não "passa por
não existir" — ele é barrado por construção. O caminho natural
(`if (!gate) return { passed: true }`) transforma esquecimento em liberação;
invertido, o esquecimento vira bloqueio, que é o lado seguro de errar. O mesmo
vale para manual de domínio e qualquer checagem plugável.

### 6. Escada de governança (a MESMA máquina para tudo)
`SHADOW_ONLY → ALLOWLIST → WIDE`, com evidência persistida na sombra e
promoção por decisão humana. Para agentes que EXECUTAM (remediação, envio), a
escada governa a execução e o catálogo de ações é fechado, reversível e
idempotente, com máximo de tentativas e trilha de auditoria.

### 7. Crítico de coerência
Verificador determinístico claim-vs-snapshot: a resposta afirma algo que o
snapshot de verdade não sustenta? → reprova antes de sair.

Duas classes obrigatórias: **valor inventado** (todo número de dinheiro citado
tem que existir na verdade — compare em **centavos inteiros**, nunca em float:
`32.90 × 3` dá `98.69999999999999`) e **negação sem respaldo** (o incidente do
rodízio — vira `NEEDS_REVIEW`, nunca passa direto).

Ao escrever um verificador, **metade dos testes prova que o legítimo passa**. Sem
essa metade ele vira carimbo, ou pior: reprova o acerto e treina a equipe a
ignorar alarme *(incidente 4)*.

**A queda importa tanto quanto a reprovação.** Gate reprovou → o cliente recebe
uma resposta que **preserva o contexto**, nunca a tela de entrada *(incidente 3)*.

### 8. Interruptores humanos
Sempre: **master switch** por produto (desligar toda a IA e operar na mão),
interruptor **por unidade de trabalho** (por campanha, por ação) e **botão de
pânico** (voltar tudo ao seguro em um clique).

## Anatomia de um agente novo (o checklist)

1. `XAgentProfile` — ficha/constituição + diretiva de prompt.
2. `XKnowledgeAdapter` (ou mapa+probe) — a verdade do domínio.
3. `XReasoner` — `reasonX()` via `reasonAsAgent({agentId:"x"})`, shadow-safe
   (`executed:false`/`sent:false` invariante).
4. `XQualityGate` — o P0 do domínio, registrado no registry.
5. Escada/ativação — em que degrau nasce (sempre SOMBRA) e quem liga.
6. Endpoint (auth de tenant) + UI no padrão do produto.
7. Testes: casamento determinístico, gate, invariantes da escada, regressões.
