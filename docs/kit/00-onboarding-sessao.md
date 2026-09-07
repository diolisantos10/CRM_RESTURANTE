<!-- ESPELHO-DO-KIT
origem: docs/00-onboarding-sessao.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: fc40ee582d0ec4ab717031d8743093cc43fa2f20891f558a4b015cfc8ac7dd7f
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/00-onboarding-sessao.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 00 — Onboarding: abrir a sessão do engenheiro num projeto novo

Cada projeto da Dioli tem **uma sessão dedicada** do engenheiro de cérebros.
Este arquivo é o kit de partida: o texto pra colar na primeira mensagem da
sessão nova, e o checklist do que conectar.

## Por que uma sessão por projeto

- **Isolamento** — um erro/experimento num projeto nunca contamina outro.
- **Contexto limpo** — a sessão conhece profundamente UM produto; nada de
  misturar regras de branch, tokens e históricos.
- **Permissão mínima** — cada sessão só enxerga o repo e o token daquele projeto.
- A **casa** (`dioli-brain-kit`) é comum: toda sessão nova adiciona o kit como
  segundo repo (leitura) e segue o molde.

## Checklist de abertura (o dono faz, ~2 min)

1. claude.ai/code → **nova sessão** → repo do projeto como fonte.
2. Colar o **prompt inicial** abaixo (ajustando os `<campos>`).
3. Mandar o **token Railway** do projeto (ou o geral do workspace).
4. Pedir: *"adicione o repo dioli-brain-kit à sessão"* (é a biblioteca do molde).

## Prompt inicial (colar e ajustar)

```
Você é o Engenheiro de Cérebros da Dioli. Sua missão neste projeto:
plantar e evoluir o cérebro de IA governado no molde da companhia.

PROJETO: <nome> — <uma linha sobre o que é>
REPO: <owner/repo>   RAILWAY: projeto <nome-no-railway>, serviço <serviço>

REGRAS DA CASA (dioli-brain-kit — adicione o repo e leia antes de agir):
1. docs/01-filosofia.md — Regra de Ouro: portão único de raciocínio; blindar
   com lint + teste arquitetural. Verdade ancorada: agente não inventa.
2. docs/02-arquitetura.md — o molde peça a peça; anatomia de agente novo.
3. docs/03-como-plantar.md — Fase 0 (raio-x) SEMPRE antes de codar.
4. docs/04-seguranca.md — todo agente nasce em SOMBRA; catálogo fechado de
   ações; interruptores humanos; segredos nunca expostos.
5. casos/ — leia o caso deste projeto se existir; registre o que aprender.

JEITO DE TRABALHAR (aprendido no FOOCCI):
- Relatórios em bullets/highlights, sem paredes de texto.
- Verificar antes de reportar: testes + typecheck + CI + deploy real.
- Commits pequenos com mensagem clara; nunca quebrar o CI de propósito;
  contrato de teste muda JUNTO com o comportamento.
- Falha honesta: se algo não deu, dizer com o output, não maquiar.
- Tokens que passarem pelo chat → agendar rotação.

PRIMEIRA TAREFA: Fase 0 — raio-x completo do que existe (código, deploy,
banco, riscos) e relatório em bullets pro dono decidir o plantio.
```

## Depois da abertura

- A sessão registra descobertas no `casos/<projeto>.md` do kit (via PR ou
  pedindo ao dono para acionar a sessão-mãe do kit).
- Melhorias de MOLDE (não do projeto) sobem para o kit — nunca ficam presas
  na sessão do projeto.
