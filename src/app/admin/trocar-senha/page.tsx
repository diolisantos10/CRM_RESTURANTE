/**
 * A TELA DE DEFINIR A PRÓPRIA SENHA.
 *
 * ⚠️ Ela vive FORA do grupo `(area)` de propósito. Dentro, o layout mandaria
 * quem deve trocar para cá — e cá é dentro dele. O laço seria infinito, e o
 * sintoma para a pessoa seria a página piscando sem nunca abrir.
 */

import { redirect } from "next/navigation";
import { lerSessaoInterna } from "@/lib/internal-auth";
import { TrocarSenhaClient } from "./TrocarSenhaClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "Definir sua senha · Foocci" };

export default function TrocarSenhaPage() {
  const sessao = lerSessaoInterna();
  if (!sessao) redirect("/admin/login");

  return <TrocarSenhaClient nome={sessao.nome} />;
}
