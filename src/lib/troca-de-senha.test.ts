import { describe, expect, it } from "vitest";
import { liberadaMesmoDevendoTroca, ROTA_DA_TROCA } from "./troca-de-senha";

/**
 * ⛔⛔ A LISTA DE ROTAS LIBERADAS É A SUPERFÍCIE DE ESCAPE DA TRAVA.
 *
 * Cada endereço aqui é um lugar onde alguém com senha de terceiro consegue
 * entrar. Ela existe para a troca poder acontecer — e cresce por descuido, não
 * por decisão: alguém libera "só o painel" para destravar um chamado, e a trava
 * vira sugestão. Este arquivo é o que torna esse crescimento visível.
 */

describe("a lista de rotas liberadas durante a troca obrigatória", () => {
  it("libera a própria tela de troca e a rota que troca", () => {
    // Sem estas duas, a exigência seria uma ordem sem caminho: a casa mandaria
    // trocar e não haveria onde.
    expect(liberadaMesmoDevendoTroca(ROTA_DA_TROCA)).toBe(true);
    expect(liberadaMesmoDevendoTroca("/api/interno/senha")).toBe(true);
  });

  it("libera sair e entrar — quem não quer trocar tem de conseguir ir embora", () => {
    expect(liberadaMesmoDevendoTroca("/admin/sair")).toBe(true);
    expect(liberadaMesmoDevendoTroca("/admin/login")).toBe(true);
  });

  it("⛔ NÃO libera nada da operação, e é essa a trava", () => {
    for (const rota of [
      "/comercial",
      "/comercial/funil",
      "/comercial/conversas",
      "/admin/pessoas",
      "/admin/credenciais",
      "/api/admin/pessoas",
      "/api/comercial/leads",
    ]) {
      expect(
        liberadaMesmoDevendoTroca(rota),
        `⛔ "${rota}" ficou aberta para quem ainda está com senha de terceiro`,
      ).toBe(false);
    }
  });

  it("⛔ não se engana com endereço que só COMEÇA parecido", () => {
    // `/admin/loginha` não é `/admin/login`. Um `startsWith` mal posto aqui
    // abriria a casa para qualquer rota que começasse com o prefixo certo.
    expect(liberadaMesmoDevendoTroca("/admin/trocar-senha-de-outro")).toBe(false);
  });
});
