/**
 * Comercial → Importações. O histórico dos arquivos, e a resposta a "de onde
 * veio este contato?".
 *
 * Separada da Base fria de propósito: uma responde sobre o ARQUIVO (quem subiu,
 * quantas linhas entraram, quantas foram recusadas e por quê), a outra sobre o
 * CONTATO. Misturar as duas foi o que fez a tela antiga mostrar vinte lotes e
 * parecer que era a base inteira.
 */

import { ImportacoesClient } from "./ImportacoesClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Importações · Sala de Vendas" };

export default function ImportacoesPage() {
  return <ImportacoesClient />;
}
