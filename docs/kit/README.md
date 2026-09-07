# Espelho da doutrina — `dioli-brain-kit` dentro do Foocci

> ⚠️ **PASTA GERADA. NÃO EDITE NADA AQUI.** Toda mudança de doutrina é feita no
> kit (`diolisantos10/dioli-brain-kit`) pelo CEO / Diretor Geral do Cérebro. Editar um arquivo
> desta pasta reprova o CI e some no próximo espelhamento.

---

## Por que esta pasta existe

Uma sessão de Diretor só enxerga os repositórios anexados **na abertura**. Em
08/08/2026 o Diretor do CityJobs abriu sem o kit anexado, tentou API, git e raw —
todos negados — e trabalhou sem a doutrina. Anexar depois não entra em sessão que
já está rodando.

Com o espelho, a doutrina chega como **atualização do sistema**: ela já está no
repositório quando a sessão abre.

## Carimbo de versão

| Campo | Valor |
|---|---|
| Kit | `diolisantos10/dioli-brain-kit` (branch `main`) |
| Commit espelhado | `20abdeff6daecf9a2624df198c75ac784db1b9eb` |
| Data do commit do kit | 2026-08-30T14:31:46+00:00 |
| Última conferência | 2026-09-07T11:00:38.630Z |
| Documentos espelhados | 38 |
| Gerado por | `.github/workflows/kit-espelho.yml → scripts/espelhar-kit.ts` |

Versão de máquina: [`_ESPELHO.json`](./_ESPELHO.json).

## O portão que impede este espelho de apodrecer calado

`src/services/doutrina/kitEspelho.test.ts` roda no CI de todo PR e **reprova**
quando:

- a última conferência passou de **14 dias** (avisa em 7);
- algum arquivo desta pasta foi **editado à mão** (o hash do corpo não bate);
- algum arquivo do manifesto **sumiu**, ou apareceu arquivo **intruso** aqui;
- o manifesto sumiu, ficou ilegível ou o espelho encolheu abaixo do piso.

## O que NÃO é espelhado, e por quê

- `templates/` do kit — é código de referência, não doutrina; espelhar `.ts` dentro
  de `docs/` confundiria o type-check e o lint deste repositório.
- `casos/` de outros projetos — o Foocci espelha o caso dele.
- `README.md` do kit — este arquivo ocupa o lugar e explica o espelho.

## Como forçar uma atualização

Rode o workflow **Espelho da doutrina** (`.github/workflows/kit-espelho.yml`) pelo
botão *Run workflow*, ou localmente:

```bash
git clone --depth 1 https://github.com/diolisantos10/dioli-brain-kit.git /tmp/kit
KIT_DIR=/tmp/kit npx ts-node --project tsconfig.scripts.json scripts/espelhar-kit.ts
```

---

## Índice do que está espelhado

| Arquivo aqui | Origem no kit |
|---|---|
| [`casos/foocci.md`](./casos/foocci.md) | `casos/foocci.md` |
| [`CLAUDE.md`](./CLAUDE.md) | `CLAUDE.md` |
| [`00-onboarding-sessao.md`](./00-onboarding-sessao.md) | `docs/00-onboarding-sessao.md` |
| [`01-filosofia.md`](./01-filosofia.md) | `docs/01-filosofia.md` |
| [`02-arquitetura.md`](./02-arquitetura.md) | `docs/02-arquitetura.md` |
| [`03-como-plantar.md`](./03-como-plantar.md) | `docs/03-como-plantar.md` |
| [`04-seguranca.md`](./04-seguranca.md) | `docs/04-seguranca.md` |
| [`05-laboratorio.md`](./05-laboratorio.md) | `docs/05-laboratorio.md` |
| [`06-incidentes.md`](./06-incidentes.md) | `docs/06-incidentes.md` |
| [`07-memoria-de-agente.md`](./07-memoria-de-agente.md) | `docs/07-memoria-de-agente.md` |
| [`08-modelo-ceo-pm-agentes.md`](./08-modelo-ceo-pm-agentes.md) | `docs/08-modelo-ceo-pm-agentes.md` |
| [`09-como-trabalhar-aqui.md`](./09-como-trabalhar-aqui.md) | `docs/09-como-trabalhar-aqui.md` |
| [`10-canal-de-escalada.md`](./10-canal-de-escalada.md) | `docs/10-canal-de-escalada.md` |
| [`11-backlog-do-diretor-geral.md`](./11-backlog-do-diretor-geral.md) | `docs/11-backlog-do-diretor-geral.md` |
| [`12-cofre-de-credencial.md`](./12-cofre-de-credencial.md) | `docs/12-cofre-de-credencial.md` |
| [`13-quem-esta-vivo.md`](./13-quem-esta-vivo.md) | `docs/13-quem-esta-vivo.md` |
| [`14-interface-entre-diretores.md`](./14-interface-entre-diretores.md) | `docs/14-interface-entre-diretores.md` |
| [`15-conferir-o-deploy-e-usar-agentes.md`](./15-conferir-o-deploy-e-usar-agentes.md) | `docs/15-conferir-o-deploy-e-usar-agentes.md` |
| [`16-raio-x-noturno.md`](./16-raio-x-noturno.md) | `docs/16-raio-x-noturno.md` |
| [`17-placar-diario.md`](./17-placar-diario.md) | `docs/17-placar-diario.md` |
| [`18-o-despacho.md`](./18-o-despacho.md) | `docs/18-o-despacho.md` |
| [`19-pendencia-zero.md`](./19-pendencia-zero.md) | `docs/19-pendencia-zero.md` |
| [`20-sala-dos-agentes.md`](./20-sala-dos-agentes.md) | `docs/20-sala-dos-agentes.md` |
| [`21-elenco-obrigatorio.md`](./21-elenco-obrigatorio.md) | `docs/21-elenco-obrigatorio.md` |
| [`22-briefing-ao-conselho.md`](./22-briefing-ao-conselho.md) | `docs/22-briefing-ao-conselho.md` |
| [`23-constituicao-dos-essenciais.md`](./23-constituicao-dos-essenciais.md) | `docs/23-constituicao-dos-essenciais.md` |
| [`24-o-quadro-do-ceo.md`](./24-o-quadro-do-ceo.md) | `docs/24-o-quadro-do-ceo.md` |
| [`25-obra-em-espera.md`](./25-obra-em-espera.md) | `docs/25-obra-em-espera.md` |
| [`26-briefing-ao-conselho-branding.md`](./26-briefing-ao-conselho-branding.md) | `docs/26-briefing-ao-conselho-branding.md` |
| [`26a-pedido-pronto-branding.md`](./26a-pedido-pronto-branding.md) | `docs/26a-pedido-pronto-branding.md` |
| [`27-ordem-subir-o-branding.md`](./27-ordem-subir-o-branding.md) | `docs/27-ordem-subir-o-branding.md` |
| [`28-nao-se-para-no-meio.md`](./28-nao-se-para-no-meio.md) | `docs/28-nao-se-para-no-meio.md` |
| [`29-a-camada-de-delegacao.md`](./29-a-camada-de-delegacao.md) | `docs/29-a-camada-de-delegacao.md` |
| [`30-os-gatilhos-do-diretor.md`](./30-os-gatilhos-do-diretor.md) | `docs/30-os-gatilhos-do-diretor.md` |
| [`31-verde-e-o-que-esta-rodando.md`](./31-verde-e-o-que-esta-rodando.md) | `docs/31-verde-e-o-que-esta-rodando.md` |
| [`32-o-id-aceito-de-quem-chama.md`](./32-o-id-aceito-de-quem-chama.md) | `docs/32-o-id-aceito-de-quem-chama.md` |
| [`perguntas-abertas.md`](./perguntas-abertas.md) | `docs/perguntas-abertas.md` |
| [`presenca.md`](./presenca.md) | `docs/presenca.md` |
