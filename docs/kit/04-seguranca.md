<!-- ESPELHO-DO-KIT
origem: docs/04-seguranca.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: b200ea7f1f87c656496c34611fdb5e6a187bc1cec4a771aba4f80754453492f5
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/04-seguranca.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 04 — Segurança: a escada e os invariantes

## A escada de governança

```
SHADOW_ONLY ──evidência──▶ ALLOWLIST ──evidência──▶ WIDE
   (nasce aqui)              (catálogo)               (geral)
```

- **SHADOW_ONLY** — o agente raciocina, propõe e registra evidência. NÃO age.
  Todo agente nasce aqui, sem exceção.
- **ALLOWLIST** — executa SOMENTE ações de um catálogo fechado, habilitadas uma
  a uma por decisão humana.
- **WIDE** — opera o escopo geral do produto. Só com prova acumulada.
- A subida é **decisão humana com evidência**; a descida (pânico) é um clique.

## Invariantes de execução (quando a escada permite agir)

1. **Catálogo fechado** — o raciocínio ESCOLHE entre ações pré-declaradas;
   nunca gera ação nova. Texto livre de usuário jamais vira comando.
2. **Reversível + idempotente** — pré-requisito para uma ação existir no
   catálogo. Sem isso, é ação de humano.
3. **Limite de tentativas** — `maxAttempts` por ação; estourou → escala.
4. **Auditoria** — toda execução logada: o quê, por quê, resultado.
5. **Dado de cliente** — nenhuma ação destrutiva sobre dado de cliente, nunca.
6. **Segredos** — probes reportam PRESENÇA (booleano), jamais o valor. Troca de
   segredo é sempre humano.
7. **`executed: false` invariante** — o reasoner NUNCA executa; quem executa é
   a máquina da escada, separada, auditada.

## Interruptores humanos obrigatórios

- **Master switch** por produto (desligar toda a IA — operar na mão).
- **Interruptor por unidade** (por campanha / por ação / por agente).
- **Botão de pânico** — voltar tudo ao seguro em um clique (`panicDisableAll`).

## Gates externos como aliados

Quando o domínio tem um gate externo natural (ex.: aprovação de templates da
Meta no WhatsApp), desenhe o agente para trabalhar ATRAVÉS dele: o agente pode
ter autonomia total de PROPOSTA porque o gate externo segura a EXECUÇÃO.

## Higiene operacional

- Tokens/chaves que passarem por canal inseguro (chat) → **rotacionar** depois.
- Chaves por ambiente nas Variables da plataforma, nunca no código/repo.
- Repos do kit e dos produtos: **privados**.
- Senhas de seed: exigir env var; se cair no default, gritar no log (e trocar).
- CI verde é pré-condição de deploy; contrato de teste muda JUNTO com o
  comportamento, nunca depois.
