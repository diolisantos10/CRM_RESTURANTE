/**
 * A porta de entrada de cada papel — travada em teste porque já mudou uma vez
 * sem ninguém medir (25/08: o SDR caía numa tela que não podia ver) e mudou de
 * novo em 10/09 por ordem do CEO: ele e o Diretor entram pela Sala de Vendas,
 * não pelo organograma vazio de `/admin/departamentos`.
 */

import { describe, it, expect } from "vitest";
import { destinoDe } from "./destino-por-papel";
import { ROTAS } from "@/lib/sala/rotas";

describe("destinoDe", () => {
  it("o CEO entra pela Sala de Vendas — prioridade única, 10/09/2026", () => {
    expect(destinoDe("MASTER_CEO")).toBe(ROTAS.painel);
  });

  it("o Diretor do Foocci entra pela Sala de Vendas", () => {
    expect(destinoDe("DIRETOR_FOOCCI")).toBe(ROTAS.painel);
  });

  it("o SDR cai direto no atendimento, não na lista de filas", () => {
    expect(destinoDe("AGENTE_HUMANO")).toBe(ROTAS.conversas);
  });

  it("gerente e auditor caem no painel", () => {
    expect(destinoDe("GERENTE_DEPARTAMENTO")).toBe(ROTAS.painel);
    expect(destinoDe("AUDITOR_QA")).toBe(ROTAS.painel);
  });

  it("nenhum destino aponta para o organograma que 'ainda não foi montado'", () => {
    for (const papel of ["MASTER_CEO", "DIRETOR_FOOCCI", "GERENTE_DEPARTAMENTO", "AUDITOR_QA", "AGENTE_HUMANO"] as const) {
      expect(destinoDe(papel)).not.toBe("/admin/departamentos");
    }
  });
});
