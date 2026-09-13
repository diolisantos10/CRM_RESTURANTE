# A Supervisora — o que é, e o plano de ligar

A Supervisora é uma camada de revisão que acompanha **todo agente que fala com
um lead** pelo WhatsApp comercial — a IA (TA) e o humano digitando. Ela entra
num ponto só (`entregarMensagem`), então cobre os dois com uma implementação
só: lê a mensagem antes de sair, avalia tom, insistência, pitch, promessa e
pressão comercial, e decide o que fazer — sempre registrando o veredito, nunca
agindo às escondidas. Quando erra ou quebra, ela **retém** em vez de deixar
passar (falha fechada).

## Os quatro modos

| Modo | O que acontece |
|---|---|
| **OFF** | Nenhuma chamada. Comportamento de hoje — custo e latência zero. |
| **SHADOW** *(nasce aqui)* | Avalia e grava todo veredito, mas **nunca muda** o que sai. Serve para medir sem risco: quantas mensagens teriam sido corrigidas ou bloqueadas, se ela estivesse agindo. |
| **GUARD** | VERDE libera; AMARELO reescreve antes de enviar; VERMELHO retém; CRÍTICO retém e escala para gente. |
| **INTERVENTION** | Tudo de GUARD, mais a capacidade de pausar/assumir uma conversa em andamento, fora do fluxo de uma mensagem específica. |

Subir de modo nunca é automático — o código nunca promove SHADOW → GUARD
sozinho. É sempre um clique de gestão, na tela `/comercial/supervisora`, com
confirmação explícita para GUARD e INTERVENTION.

## O plano de ativação

1. **Nasce em SHADOW**, no ar, observando toda conversa real sem mudar nada.
2. **Observação por N dias** — o CEO decide o número. Ao fim da janela, a
   Visão Geral do painel responde sozinha: quantas mensagens teriam sido
   corrigidas, quantas retidas, com que frequência, e sobre quais agentes.
3. **Decisão explícita para GUARD**, só depois de o CEO revisar esses números
   e concordar que a taxa de correção/bloqueio é a que ele esperava — nunca
   por tempo decorrido sozinho.
4. **INTERVENTION só depois de GUARD provado** — com o mesmo tipo de janela
   de observação em GUARD antes de estender a ela a capacidade de pausar
   conversa em andamento.

Cada troca de modo fica registrada (quem, quando, por quê) em
`SupervisoraModoHistorico`, visível no painel.

## Pendência que o CEO precisa decidir

- **O número de dias em SHADOW antes de considerar GUARD.** Este documento
  não arbitra um número — é decisão de negócio, não de engenharia.
