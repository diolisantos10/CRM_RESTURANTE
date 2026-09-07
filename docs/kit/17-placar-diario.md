<!-- ESPELHO-DO-KIT
origem: docs/17-placar-diario.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: b26be0a5c5b4faada5ebeb664a922d5bac8c28c4c448cf9af750b636ae17d712
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/17-placar-diario.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 17 — O placar diário

> **Obrigatório.** Todo sistema da companhia entrega, **logo depois do raio-x**,
> uma tabela com o mesmo formato. Decisão do CEO, 06/08/2026.
>
> Pré-requisito: `16-raio-x-noturno.md`. O placar **não substitui** o relatório
> da manhã — ele é a capa dele.

---

## Por que existe

O CEO abre quatro sistemas de manhã. Relatório em prosa, mesmo curto, exige que
ele leia quatro textos e monte o quadro na cabeça. O placar entrega o quadro
pronto: **uma linha por área, uma nota, e a de ontem ao lado**.

E há uma razão mais dura. Antes do placar, um sistema saudável e um sistema
cuja varredura quebrou produziam a mesma coisa: silêncio. O placar torna isso
impossível — área sem medida aparece dizendo que não tem medida.

---

## As três regras do desenho

Não são estilo. Cada uma existe porque a alternativa já falhou em algum lugar.

### 1. A nota é conta, não opinião

A nota começa em **100** e só cai por **fato objetivo**:

| Fato | Efeito |
|---|---|
| Achado **novo** (não existia na execução anterior) | −20 por achado |
| Teste reprovando | zera a área |
| Produção fora de sincronia com o commit | zera a área |
| Varredura quebrada | zera a área, com o motivo à vista |

Nota que sai de julgamento muda de humor todo dia e deixa de ser comparável — é
a mesma doença de deixar a IA fazer a coleta (`16`, regra 2). Se um Diretor não
consegue explicar a nota em uma linha auditável, a nota está errada.

### 2. Achado conhecido não derruba a nota todo dia

Um sistema com treze achados aceitos — busca por credencial, chave que **é** a
identidade — ficaria vermelho para sempre. **Placar sempre vermelho é placar que
ninguém olha**, e um placar que ninguém olha é pior que nenhum, porque dá a
sensação de vigilância sem a vigilância.

O que a nota mostra é **o que mudou**. O número absoluto de achados continua na
tabela, na coluna que explica a nota — visível, só não punitivo.

### 3. "Sem medida" nunca vira número

Área sem varredura **não é 0% e não é 100%**: é `sem medida`, e aparece
destacada acima da tabela.

Isto não é escrúpulo. Em 06/08/2026 os **três** raio-x noturnos da companhia
dispararam e nenhum entregou nada — e ninguém percebeu até alguém ir conferir à
mão, porque a ausência de relatório era indistinguível de uma noite tranquila.
Branco que parece saúde é o defeito mais caro deste protocolo.

**Distinção que a tabela precisa manter:** buraco declarado (`sem medida`, nunca
houve varredura) e promessa quebrada (`0%`, havia varredura e ela falhou) não
são a mesma coisa.

---

## A nota do sistema é a PIOR área, nunca a média

Cinco áreas em 100 e uma em 0 dão média 83 e parecem saúde. Mas é o zero que
para a operação. Média consola; placar não existe para consolar.

---

## As áreas — os nomes são os mesmos em todo sistema

O CEO compara linha com linha entre os quatro sistemas. **Os nomes não mudam.**
O que muda é o que alimenta cada área em cada produto.

| Área | O que protege |
|---|---|
| **Dinheiro** | o dinheiro não se perder pelo caminho |
| **Isolamento** | um cliente não encostar no dado de outro |
| **Portas** | nada aberto na internet sem tranca |
| **Provas** | as travas continuarem provadas, não prometidas |
| **Entrega** | o que está em produção ser o que a gente escreveu |
| **Dados** | fila parada, importação travada, registro preso |

Um sistema que ainda não mede uma área **mantém a linha** com `sem medida`.
Apagar a linha esconde o buraco — que é justamente o que a regra 3 proíbe.

Área nova só entra no kit passando pelo Diretor do Foocci, senão os placares
deixam de ser comparáveis, que é a única coisa que os torna úteis.

---

## Onde fica

**Endereço fixo, em todo sistema:** `docs/raio-x/placar.md`

Sempre o mesmo caminho, sobrescrito a cada noite. O CEO abre quatro links de
manhã — nome que muda a cada dia obriga a procurar, e o que obriga a procurar
deixa de ser aberto.

O histórico não se perde: ele vive nas coletas em JSON, que já são versionadas
pelo `16`.

---

## O formato

```markdown
# Placar — <Sistema>

Raio-x de **AAAA-MM-DD** · commit `abc1234`

**100% — nada piorou desde ontem.**

> **Sem medida:** Dados. Não é 0% nem 100% — é buraco declarado.

| Área | Hoje | Ontem | Como a nota saiu | O que protege |
|---|---|---|---|---|
| Dinheiro | **100%** | 100% = | 3 achado(s) conhecido(s), nenhum novo | … |
| Entrega | **0%** | — | produção está em 4f897aa, o branch está em ba8bc33 | … |
| Dados | **sem medida** | — | nenhuma varredura existe ainda | … |
```

A coluna **"Como a nota saiu"** é obrigatória. Nota sem a conta ao lado é nota
que ninguém confere, e nota que ninguém confere apodrece.

---

## Implementação de referência

Foocci Manager: `src/server/raiox/placar.ts` (puro, 22 testes) +
`scripts/raio-x.ts`. O cálculo é função pura sobre a coleta — mesma coleta,
mesma nota, duas vezes.

Na primeira execução, o placar pegou uma divergência real entre produção e o
branch. Uma tabela que nasce verde não provou nada; essa nasceu vermelha e
provou.

---

## O que nunca fazer

- **Arredondar para cima para o placar ficar bonito.** O placar é para o CEO
  decidir, não para o Diretor se apresentar.
- **Apagar a linha da área que não é medida.** Vira exatamente o silêncio que a
  regra 3 existe para impedir.
- **Trocar a fórmula sem trocar no kit.** Placares com contas diferentes não se
  comparam, e comparar é o motivo de eles existirem.
- **Entregar o placar sem o raio-x ter rodado.** Placar é consequência da
  coleta. Sem coleta, não há nota — há chute com aparência de medida.
