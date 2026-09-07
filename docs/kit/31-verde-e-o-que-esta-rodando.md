<!-- ESPELHO-DO-KIT
origem: docs/31-verde-e-o-que-esta-rodando.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: c5769e59074fea0df795022a6d03e02ec0e44b0d001ebfd5bcb48842dbf86487
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/31-verde-e-o-que-esta-rodando.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 31 — MANDAMENTO: verde é o que está rodando

> **Ordem do CEO, 29/08/2026, e ele a declarou inquestionável:**
>
> > *"Verde, que é entregue, é quando está já rodando, cem por cento
> > funcionando. Isso tem que virar mandamento (…) em todos os produtos a partir
> > de já."*
>
> **Vale para todo produto, todo agente, todo quadro, a partir de hoje.** Não é
> processo, não é sugestão, não admite exceção local: é guardrail de companhia.

---

## O mandamento, em uma frase

> ### ✅ só existe para o que está rodando em produção, funcionando, e conferido lá.

Todo o resto — escrito, testado, aprovado, revisado, juntado ao código, esperando
deploy — **não é verde**. É trabalho em andamento com nome bonito.

---

## O que deixa de ser verde a partir de hoje

Cada linha abaixo já foi marcada ✅ em algum quadro desta companhia:

| O que se dizia | O que é, de verdade |
|---|---|
| "o código está pronto" | 🔄 em andamento |
| "os testes passaram" | 🔄 em andamento |
| "foi aprovado / revisado" | 🔄 em andamento |
| "foi juntado ao código (merge)" | 🔄 em andamento |
| "subiu, deve estar no ar" | 🔄 em andamento — *"deve"* não é conferência |
| "está no ar, mas ninguém usou ainda" | 🔄 em andamento |
| **"está no ar, eu abri e funcionou"** | ✅ **verde** |

**A palavra que separa as duas últimas linhas é `eu abri`.** Ler o relatório de
quem fez não é conferir; é ler a versão do autor sobre o próprio trabalho.

---

## Por que isto virou mandamento, e não recomendação

**A cicatriz:** duas correções de gravidade máxima no Foocci ficaram **42 commits
presas** sem chegar ao ar. No quadro, verdes. No site, o defeito, para o cliente,
por semanas.

E o irmão dela, no mesmo produto: um clique gravava uma aprovação que o relógio
de publicação **nunca lia**. O cliente aprovava o mês inteiro e nada publicava.
Sem erro, sem aviso, sem vermelho em lugar nenhum.

> **É a mentira mais barata desta casa: cabe numa linha e ninguém questiona um
> ✅.** Um item vermelho convoca gente. Um item verde **encerra a
> investigação** — e encerrar a investigação sobre algo que está quebrado é pior
> que nunca tê-la aberto.

Este mandamento existe porque o ✅ é o único símbolo do quadro que **desliga a
atenção de todo mundo ao mesmo tempo**.

---

## Como se prova o verde — a conferência, não a confiança

Verde exige **evidência de fora do repositório**. O código não pode ser a prova
de si mesmo.

| Camada | O que se olha | Exemplo real |
|---|---|---|
| **1. Está no ar?** | a versão que o sistema em produção declara, comparada com a que foi aprovada | `GET /api/health` do Foocci devolvendo o `commitSha` do merge |
| **2. Funciona?** | a jornada percorrida de ponta a ponta, no ambiente de verdade | abrir a tela, mandar a mensagem, ver o lead cair na fila |
| **3. Funciona para quem usa?** | o caminho de erro e o de desistência, não só o feliz | o que aparece quando o dado falta |

**As três, ou não é verde.** A camada 1 sozinha foi o que produziu a aprovação
que não publicava nada: estava no ar, e não funcionava.

> **Regra de bolso, e ela cabe numa pergunta:**
> *eu abri o artefato no ambiente real, ou eu li o que disseram sobre ele?*

---

## O que fazer com o que não é verde

**Não se apaga, não se esconde, e não se inventa um estado novo.** Vai para 🔄
com uma linha dizendo **o que falta e quem tem a chave**:

```
🔄 Cancelamento self-service — pronto e mergeado; falta subir. Depende de: deploy.
```

⚠️ **Não crie 🟦 "pronto para deploy", ⏸️ "aguardando", ou qualquer terceira cor
que pareça verde de longe.** O mandamento existe justamente para o quadro ter
dois estados honestos, não cinco confortáveis. Estado novo é a primeira forma
que a exceção encontra para voltar.

---

## O que este mandamento obriga em cada cargo

- **Especialista:** entrega dizendo `no ar: sim/não` e como conferiu. Sem essa
  linha, o trabalho volta.
- **PM:** não integra como concluído o que não tem a conferência da camada 1.
- **Diretor de projeto:** **o aceite é dele e é no ambiente real.** Aceitar contra
  o resumo do agente é a violação clássica deste cargo — o "virar carimbo" da
  doutrina 29.
- **Diretor Geral:** nenhum ✅ sobe ao CEO sem as três camadas. Quadro que ele
  repassa é quadro pelo qual ele responde.
- **CEO:** não precisa fazer nada. É esse o ponto — **ele é a única pessoa da
  empresa que não deveria estar conferindo**, e era ele quem descobria.

---

## Onde isto muda documento que já existe

- **Doutrina 24 (o quadro do CEO):** ✅ FEITO passa a significar isto e nada
  menos. Quem preenche o quadro lê aqui antes.
- **Doutrina 30, gatilho 4** (*entrega marcada como pronta que não chegou em
  produção*): deixa de ser um gatilho entre cinco e passa a ser **o mecanismo de
  fiscalização deste mandamento**. Ele dispara sempre que alguém violar a regra.
- **Doutrina 19 (pendência zero):** item que voltou de ✅ para 🔄 **é pendência
  aberta**, com o prazo de um dia da doutrina 30. Não é regressão do quadro; é o
  quadro passando a dizer a verdade.

---

## Como saber que este mandamento virou enfeite

- ✅ cresce e ninguém nunca cita a versão que está no ar;
- aparece uma cor, um ícone ou um rótulo novo entre 🔄 e ✅;
- um item volta de ✅ para 🔄 e alguém trata isso como erro de quem corrigiu, em
  vez de como o mandamento funcionando;
- **o CEO descobre que algo verde não estava no ar — uma vez que seja.**

---

## O que ainda NÃO é trava

A camada 1 é **calculável**: perguntar ao sistema no ar qual versão ele roda e
comparar com o que foi aprovado é código, não disciplina. Enquanto essa
comparação não rodar sozinha e aparecer na tela, este documento é aviso — e a
casa já sabe que aviso falha no dia ruim.

As camadas 2 e 3 exigem percorrer a jornada de verdade. **Hoje, na Control Room,
não existe teste ponta a ponta** para fazer isso sozinho; é conferência na mão do
Diretor, declarada como tal.

---

— Ordem do CEO em 29/08/2026, registrada pelo Diretor Geral na mesma sessão.
Palavra dele: **inquestionável.**
