/**
 * OS RÓTULOS CURTOS DA SALA DE VENDAS.
 *
 * ── POR QUE ELES EXISTEM, SE JÁ HÁ `ROTULO_ETAPA` NO FUNIL ──────────────────
 *
 * Porque a coluna da ficha tem 256px. "Demonstração agendada" e "Fechado —
 * ganho" quebram em duas linhas dentro de uma etiqueta de 11px; "Demo agendada"
 * e "Ganho" cabem. O texto canônico continua sendo o de `foocciCrmFunnel` — é
 * ele que vai a relatório, a e-mail e ao painel do CEO. Aqui é a versão que cabe
 * na tela estreita, e só isso.
 *
 * ── ⛔ O QUE ESTE ARQUIVO EXISTE PARA IMPEDIR ───────────────────────────────
 *
 * Este mapa vivia SOLTO dentro de `AtendimentoClient.tsx`, e a lista de opções
 * do seletor de etapa era `Object.keys()` dele. Um mapa que se confere sozinho:
 * se uma etapa nova entrasse no funil, o seletor da Sala simplesmente **não a
 * ofereceria**, e ninguém saberia — o vendedor não sente falta de uma opção que
 * nunca viu.
 *
 * É a mesma família do defeito de 07/09/2026 no CRM antigo (`ROTULO_INTERACAO`
 * com oito entradas para um enum de doze). Aqui a lista está fora do componente
 * justamente para poder ser medida contra `TODAS_AS_ETAPAS`, que é fonte
 * externa — ver `rotulosDaSala.test.ts`.
 */

import { TODAS_AS_ETAPAS, ROTULO_ETAPA } from "@/services/foocci-crm/foocciCrmFunnel";
import type { FoocciLeadStage } from "@/services/foocci-crm/foocciCrmFunnel";

/**
 * ⚠️ As palavras aqui são deliberadamente mais curtas que as canônicas. Trocar
 * por gosto muda o que o vendedor lê na tela — mexa com intenção, não por
 * simetria.
 */
export const ROTULO_CURTO: Record<FoocciLeadStage, string> = {
  NOVO: "Novo lead",
  PRIMEIRO_CONTATO: "Primeiro contato",
  EM_QUALIFICACAO: "Em qualificação",
  QUALIFICADO: "Qualificado",
  DEMO_AGENDADA: "Demo agendada",
  DEMO_REALIZADA: "Demo realizada",
  PROPOSTA_ENVIADA: "Proposta enviada",
  EM_NEGOCIACAO: "Em negociação",
  GANHO: "Ganho",
  PERDIDO: "Perdido",
  NUTRICAO: "Nutrição",
};

/**
 * A ordem do seletor de etapa, e ela vem do FUNIL — não das chaves do mapa
 * acima. Se viesse das chaves, o mapa estaria decidindo quais etapas existem, e
 * uma etapa nova ficaria fora do seletor em silêncio.
 */
export const ETAPAS_NA_SALA: readonly FoocciLeadStage[] = TODAS_AS_ETAPAS;

/**
 * O rótulo de uma etapa, com queda controlada.
 *
 * Uma etapa sem rótulo curto aparece com o texto canônico; sem nenhum dos dois,
 * aparece com o próprio código. Feio é aceitável — **invisível não é**, e uma
 * etiqueta vazia na tela foi exatamente o defeito que o CRM antigo carregou.
 */
export function rotuloCurto(etapa: string): string {
  return (
    ROTULO_CURTO[etapa as FoocciLeadStage] ??
    ROTULO_ETAPA[etapa as FoocciLeadStage] ??
    etapa
  );
}
