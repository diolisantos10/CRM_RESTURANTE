<!-- ESPELHO-DO-KIT
origem: docs/05-laboratorio.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: 5de64dcf3274c2ce00c7ba3896bf1fc900b4348c58ffaa1180b92ca9c998dc81
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/05-laboratorio.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 05 — Laboratório (centro de treinamento)

> Ideia do dono (24/07): um ambiente ISOLADO no Railway para o engenheiro
> testar/treinar skills e agentes novos SEM tocar produção de nenhum produto.
> Registrado aqui para executar **depois do lançamento do FOOCCI (03/08)**.

## Por que existe

- Skill/agente novo às vezes precisa **rodar de verdade** (banco, endpoints,
  cron, chamadas de IA) para dar resultado real — não dá para provar só no papel.
- Rodar isso dentro do FOOCCI/Dioli = risco de mexer na produção dos outros.
- Um campo de provas isolado deixa **quebrar à vontade**, medir, aprovar — e só
  então promover o padrão para o kit e plantar nos produtos.

## O que é (mínimo e barato)

- **Repo:** `dioli-brain-lab` (privado) — o app-cobaia + harness de experimento.
- **Projeto Railway:** `brain-lab` — 1 serviço + 1 Postgres pequeno.
- **Regra de custo:** **pausar o serviço quando ocioso** (não fica queimando
  dinheiro). Ligar só durante um experimento.

## O que roda lá

- Uma instância mínima do molde do kit (portão + motor + 1 adaptador fake).
- Harness de experimento: dá um caso → roda o agente → registra o resultado
  (evidência), tudo em SOMBRA por default (o freio de mão vale aqui também).
- Dados 100% sintéticos/descartáveis — **nunca** dado real de cliente.

## Como montar (quando o dono liberar)

1. Dono cria o repo `dioli-brain-lab` (privado).
2. Com o token geral do workspace, criar o projeto Railway `brain-lab`
   (1 serviço + Postgres), variáveis mínimas (chave de IA de teste).
3. Deploy do harness; rodar o primeiro experimento; **pausar** ao terminar.
4. O que o experimento provar → volta para `templates/` + `casos/`.

## Invariantes

- Isolado: sem acesso a banco/segredos de produção de nenhum produto.
- Descartável: pode ser recriado do zero a qualquer momento.
- Barato: pausado por default; ligado só sob demanda.
- Governado: experimentos nascem em SOMBRA, como todo agente do molde.

## Status

- [ ] Repo `dioli-brain-lab` criado
- [ ] Projeto Railway `brain-lab` provisionado
- [ ] Harness de experimento no ar
- Prioridade: **pós-lançamento FOOCCI**. Não bloqueia nada agora.
