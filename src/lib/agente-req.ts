/**
 * ⭐⭐ O PORTÃO DAS ROTAS DE AGENTE — escrito UMA vez.
 *
 * Toda rota de agente faz a mesma sequência: lê os dois cabeçalhos, confere a
 * credencial, confere o alcance declarado. Repetir isso em cinco arquivos é
 * garantir que um deles vai divergir — e a divergência num portão não aparece
 * como erro: aparece como uma rota que deixa passar o que as outras barram.
 *
 * ⚠️ **A recusa de credencial é cega; a de alcance não é.** Quem ainda não
 * provou quem é leva sempre a mesma frase, para não descobrir pelo texto quais
 * crachás existem. Quem já provou pode saber qual capacidade faltou: ele está
 * do lado de dentro, e adivinhar capacidade é desperdício de rodada.
 */

import { NextResponse, type NextRequest } from "next/server";
import { autenticarAgente, segredoApresentado } from "./agente-auth";
import type { AcessoDeclarado } from "@/services/organizacao/acessosDeclarados";

export type Portao =
  | { ok: true; acesso: AcessoDeclarado }
  | { ok: false; resposta: NextResponse };

export function exigirAgente(req: NextRequest, capacidade: string): Portao {
  const conferido = autenticarAgente(
    (req.headers.get("x-foocci-agente") ?? "").trim(),
    segredoApresentado(req.headers.get("authorization")),
  );
  if (!conferido.ok) {
    return {
      ok: false,
      resposta: NextResponse.json(
        { ok: false, error: "credencial de agente não confere" },
        { status: 401 },
      ),
    };
  }

  if (!conferido.acesso.alcance.includes(capacidade)) {
    return {
      ok: false,
      resposta: NextResponse.json(
        {
          ok: false,
          error: `esta credencial não declara "${capacidade}"`,
          alcance: conferido.acesso.alcance,
        },
        { status: 403 },
      ),
    };
  }

  return { ok: true, acesso: conferido.acesso };
}

/**
 * ⛔⛔ O TELEFONE SAI MASCARADO. **Decisão minha, e o Diretor Geral pediu que eu
 * a tomasse** — no fio do Connect de 06/09/2026: *"se você achar que ele deve
 * vir mascarado por padrão e inteiro só sob pedido item a item, eu aceito."*
 *
 * A régua que usei: ele precisa do telefone para **saber quem é** e enxergar a
 * fila, não para discar — discar é ato de contato, e ele excluiu escrita do
 * próprio pedido. Os quatro últimos dígitos bastam para reconhecer, casar com
 * um registro e conversar sobre o lead com um Diretor.
 *
 * O número inteiro é dado pessoal de uma pessoa real que preencheu um
 * formulário. Se um dia ele for necessário, entra como capacidade própria, num
 * commit, com data e autor — que é exatamente a diferença entre um acesso
 * concedido e um acesso herdado sem ninguém lembrar.
 */
export function telefoneMascarado(bruto: string | null): string | null {
  if (bruto === null) return null;
  const digitos = bruto.replace(/\D/g, "");
  if (digitos.length < 4) return "••••";
  return `••••${digitos.slice(-4)}`;
}
