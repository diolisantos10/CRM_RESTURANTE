/**
 * Comercial → Carteira. Todos os leads numa tabela só.
 *
 * A tela que faltava: as filas respondem perguntas ("o que é meu?"), a ficha
 * mostra um lead. Nenhuma das duas mostra a base inteira — e é na base inteira
 * que se vê quem sumiu depois da primeira mensagem.
 */

import { CarteiraClient } from "./CarteiraClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Carteira · Sala de Vendas" };

export default function CarteiraPage() {
  return <CarteiraClient />;
}
