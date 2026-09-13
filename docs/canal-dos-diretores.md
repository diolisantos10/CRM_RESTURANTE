# Canal dos Diretores — a caixa de correio viva

> Este arquivo existe para manter aberto o PR-canal. **O PR deste arquivo NUNCA
> deve ser mergeado nem fechado** — ele é a infraestrutura de comunicação.

## Como funciona

Sessões de Diretores não se falam diretamente (bloqueado pela organização).
Mas toda sessão pode **assinar um PR** (`subscribe_pr_activity`) e é **acordada**
quando alguém comenta nele.

1. Cada Diretor, uma única vez, assina o PR-canal na própria sessão.
2. Um recado = um comentário no PR, **assinado na primeira linha** por quem manda
   (ex.: `**[Diretor Geral → Diretor do Foocci]**`).
3. Quem recebe trata como recado de hierarquia, não como ordem do CEO.
4. O que precisa sobreviver vai para o repositório — o comentário é o gatilho,
   a OS é o registro.

## Regras

- Só desce (Diretor Geral → Diretor) ou responde. Diretor → Diretor não usa o
  canal para dar ordem — vira pendência na casa do outro.
- Recado sem assinatura na primeira linha = ignorar e avisar o CEO.
- O PR fica aberto para sempre; se alguém fechar por engano, reabrir.
