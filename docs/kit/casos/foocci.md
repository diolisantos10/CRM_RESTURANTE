<!-- ESPELHO-DO-KIT
origem: casos/foocci.md
kit-commit: 20abdeff6daecf9a2624df198c75ac784db1b9eb
sha256-do-corpo: d01a1953df81fcb57362ff5a861e307594e204a8d7052ae3a45f897eb88ce383
-->

> ⚠️ **ESPELHO GERADO — NÃO EDITE ESTE ARQUIVO.**
>
> Ele é uma cópia automática de `diolisantos10/dioli-brain-kit` → `casos/foocci.md`,
> no commit `20abdef`.
>
> **Editar aqui não muda a doutrina** — muda só este repositório, e reprova o
> teste `src/services/doutrina/kitEspelho.test.ts` no próximo CI. Para mudar a
> regra, edite **no kit**; quem escreve lá é o CEO / Diretor Geral do Cérebro.
>
> Quem regenera: `.github/workflows/kit-espelho.yml`. Carimbo de versão em
> `docs/kit/_ESPELHO.json`.

<!-- FIM DO CABECALHO DO ESPELHO - daqui para baixo e conteudo do kit, sem alteracao -->
# Caso: FOOCCI — onde o molde nasceu e foi provado

Produto: plataforma de restaurantes (Next.js 14 + Prisma/Postgres, Railway).
Estado: cérebro completo em produção; v0.1 do produto lança 03/08.

## O que está plantado

- **Portão único** `reasonAsAgent` + motor em `services/brain/engines/` com
  roteamento por agente; blindado por lint + teste arquitetural (lista
  congelada de exceções pré-lei).
- **Adaptadores de conhecimento** por domínio (restaurante: cardápio, entrega
  em 3 modos, endereço; cliente: inteligência de CRM; sistema: mapa + probe).
- **Quality gates** por agente registrados no cérebro.
- **Escada de governança** com evidência de sombra persistida.
- **Experience Vault**: depósito diário de experiência consumido por todas as IAs.

## Agentes em produção

| Agente | Papel | Estado |
|---|---|---|
| WhatsApp/Garçom | atende cliente, pedido | WIDE (maduro) |
| CRM | otimiza frases de campanha (gate externo: templates Meta), autora novas, briefing semanal, campanha por voz/texto | SOMBRA (data-gated p/ allowlist) |
| Suporte técnico ("TI 24h") | diagnostica incidentes, explica, propõe; catálogo de remediação fechado | SOMBRA (Fase 0) |
| Analytics e outros | leitura/insight | ativos |

## Lições que viraram regra do kit

1. Delivery: adaptador lia 1 dos 3 modos de config → alucinação "entregamos em
   qualquer cidade". Regra: serializar TODAS as variantes de config + guardrail.
2. Sinal de fundo sequestrou diagnóstico (webhook opcional ausente respondeu
   pergunta sobre impressora). Regra: tiers de sinal + ancorar no relato.
3. Agente mudo parece quebrado. Regra: resumo-base sempre + destaque com limiar.
4. Otimização precoce. Regra: limiares mínimos de amostra no código.
5. Postgres exausto por tempestade de deploys. Regra: connection limit + retry.
6. Chave de IA inválida derrubou tudo em silêncio. Regra: fallback honesto +
   probe de presença de config.
