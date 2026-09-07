<!-- ESPELHO-DO-KIT
origem: docs/32-o-id-aceito-de-quem-chama.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: 263d36c2fc06a71221fccad346350a21335c53be5962ae14f95f270d832facc4
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `docs/32-o-id-aceito-de-quem-chama.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# 32 — O identificador aceito de quem chama

> **Escrito pelo Diretor Geral em 30/08/2026**, depois de o mesmo defeito ser
> encontrado, reproduzido e consertado nas **quatro** portas corporativas do
> Dioli Connect — construídas em separado, por quatro frentes diferentes, no
> mesmo dia, sem uma copiar a outra.
>
> Defeito que aparece uma vez é incidente. Defeito que quatro pessoas cometem
> sozinhas é **buraco de doutrina**, e tapar buraco de doutrina é o trabalho
> desta pasta.

---

## A regra, em uma linha

> **Um identificador que chega de fora não é uma credencial. Aceitá-lo sem
> conferir de quem ele é entrega ao chamador a chave de tudo que aquele
> identificador alcança.**

E o corolário, que é onde todo mundo escorregou:

> **Conferir que o identificador EXISTE não é conferir que ele é DESTE
> chamador.** Existir é uma pergunta sobre o banco. Ser dele é uma pergunta
> sobre quem está falando — e as duas se parecem tanto no código que a segunda
> some.

---

## O que foi medido, e não é hipótese

Quatro portas, quatro repositórios, quatro frentes. Todas passaram por auditoria
independente com reprodução executada contra banco real. **As quatro tinham o
mesmo defeito**, com nomes diferentes:

| Produto | O campo | O que foi obtido de verdade |
|---|---|---|
| Dioli Digital | `correlationId` | um despacho de homologação **leu e escreveu dentro do fio de um cliente pagante**: o artefato devolvido trouxe id, data e nome de função de execução real alheia, e a linha nova ficou gravada no fio da vítima, com `turno: 2` |
| CityJobs | `correlationId` | duas linhas gravadas no fio da vítima (de 2 para 4 turnos), e o artefato ecoou o histórico lido do banco |
| FOOCCI Manager | `correlationId` | pior: sem conferir **formato, existência nem dono**. Um fio chamado `"a"` foi aceito. E virou **oráculo**: sondar um fio alheio devolvia `turno: 4`, revelando a contagem de uma conversa que não era do chamador |
| Foocci | `fio` | quem abriu a conversa não era quem respondia: um Diretor emendou turno no fio aberto por outro, e o registro gravou |

E a **variante gêmea**, no lugar que existia justamente para impedir isso — a
releitura de prova:

| Produto | O que a releitura conferia | O que ela deixava passar |
|---|---|---|
| Dioli Digital | a linha existe, tem fim e tem resultado | linha de **outra função, outro fio, outro cliente, datada de 2020** saiu como `executado`, HTTP 200, `relido_do_banco: true`, e o artefato devolvido foi o texto alheio |
| CityJobs | idem | linha adulterada devolveu `modelo: "gpt-4o-PAGO"` e `ator: "humano"` dentro do bloco marcado como relido — numa porta que jura não gastar IA |
| FOOCCI Manager | idem | a evidência de acionamento afirmou ter **varrido a loja de um cliente pagante**, nomeando o id dela |

**A Control Room, que julga as quatro, tinha a versão dela do mesmo defeito**: a
chave de idempotência era global na companhia, sem recorte por remetente. Um
produto recebia `jaExistia: true` apontando para o fio de **outro**, e a
mensagem legítima dele **nunca era gravada** — enquanto quem mandou lia
"entregue".

> **A sala que escreveu a regra cometeu a falta que a regra descreve.** Fica
> registrado por isso: não é sermão para os produtos.

---

## Por que quatro frentes independentes erram igual

Não foi descuido. Foi a forma do problema.

1. **O identificador chega junto com trabalho legítimo.** Ele não *parece*
   credencial: parece contexto. Ninguém escreve `senha` num campo chamado
   `correlationId`, então ninguém pensa em autenticá-lo.
2. **A conferência que falta é invisível quando há um chamador só.** Com um
   segredo único, "todo fio pertence a quem chama" é verdade — e o teste passa.
   O furo nasce pronto e fica dormindo até o segundo chamador existir.
3. **A releitura de prova dá sensação de rigor.** Reler do banco é mais
   cuidadoso que confiar no retorno da escrita, e é fácil parar aí achando que
   acabou. Mas reler responde *"isto existe?"*, e a pergunta era *"isto é
   meu?"*.
4. **A trava certa fica longe do dano.** Quem escreve o `SELECT` está a três
   arquivos de quem decidiu o que a resposta devolve.

---

## O que fazer — nesta ordem, e a ordem é a regra

**1. O identificador é emitido por quem guarda o dado, nunca escolhido por quem
chama.** Foi o conserto das quatro. A porta cunha o fio, devolve, e o chamador
reapresenta o mesmo valor. Quem quer conversa nova **omite o campo**.

**2. Emitido não basta: precisa ser inconfundível e, quando couber, assinado.**
Formato reconhecível filtra lixo; ele **não prova posse** — quem conhece o
formato o reproduz. O FOOCCI Manager foi ao ponto certo: fio **assinado** com o
segredo da porta, conferido **antes de qualquer consulta**. Antes importa: o
oráculo funcionava só lendo, e trava depois da leitura não fecha oráculo.

**3. Toda leitura recorta pelo dono, no conjunto inteiro — não na janela.** O
CityJobs achou a variante ao lado: dono conferido só nos 20 turnos lidos deixava
passar fio longo com dono misturado.

**4. A releitura confere identidade, campo a campo, não só existência.** Id,
fio, função, cliente, e **todo campo que a resposta republica como prova**. Se a
resposta afirma `modelo` e `ator`, esses dois entram na conferência — senão a
porta assina um recibo que não leu.

**5. A recusa devolve o NOME do campo, nunca o valor.** Erro detalhado é
vazamento pela porta dos fundos: *"esperava X, veio Y"* entrega o Y, que é o
dado alheio. E a recusa de "fio que não é seu" tem que ser **idêntica** à de
"fio que não existe" — senão a mensagem de erro vira o oráculo que a trava
fechou.

**6. Campo desconhecido é recusado por padrão, não caçado por lista.** Três das
quatro tinham denylist de nomes exatos, e todas vazavam por maiúscula, prefixo,
grafia alternativa ou homóglifo cirílico. Allowlist não tem essa doença.

---

## Como saber que esta doutrina virou enfeite

- Alguém acrescenta um nome à denylist em vez de fechar a entrada;
- a releitura ganha um campo novo na resposta e **não** ganha a conferência
  correspondente — é o caminho mais provável de o defeito voltar;
- um teste prova que o identificador alheio é recusado, e **nenhum** prova que o
  legítimo passa (trava que recusa tudo separa tão pouco quanto trava que aceita
  tudo);
- a conferência de dono existe, mas roda **depois** da consulta;
- aparece um segundo chamador e ninguém revisita as travas que só eram
  verdadeiras porque havia um.

---

## O que esta doutrina NÃO resolve, e é honesto dizer

**Ela não cria identidade.** Recortar por dono só funciona se existir mais de um
dono distinguível. Hoje, em três dos quatro produtos, **a Control Room inteira
apresenta um segredo só** — então "o dono" é sempre o mesmo, e o recorte protege
contra fio forjado, não contra abuso de quem tem a chave.

Separar de verdade — Diretor Geral distinto de Diretor de produto na mesma porta
— exige **segredo por papel**, e isso é decisão do CEO: guardrail 2, chave é
posse dele. Está declarado no código das portas, não só aqui.

> **Enquanto isso não existir, a frase honesta é:** o fio deixou de ser chave ao
> portador, e o portador continua sendo um só.
