/**
 * O TOPO DO SITE: OS BOTÕES, E O DE ASSINAR PRECISA ASSINAR DE VERDADE.
 *
 * Ordem do CEO (24/08/2026): *"O botão laranja lá em cima (…) tem que ser banido
 * do site. No lugar disso, colocar pro cliente já assinar. (…) E o contato com
 * dúvida (…) é WhatsApp."*
 *
 * Contra o código anterior estes testes reprovam: o cabeçalho carregava o CTA de
 * conversa (`chamada.href`/`chamada.label`) e não existia `ASSINAR_URL`.
 *
 * O teste que mais importa aqui é o do DESTINO. "Assinar" caindo num formulário
 * de contato seria exatamente a doença que acabamos de arrancar do site — texto
 * prometendo o que o destino não entrega —, só que com a palavra mais séria que
 * um site pode usar. Por isso ele não confere só o link: confere que a página do
 * outro lado monta o checkout que cobra.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ASSINAR_URL, ASSINAR_CTA_LABEL } from "../config";

const RAIZ = process.cwd();
const ler = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), "utf8");

function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

const HEADER = "src/components/marketing/MarketingHeader.tsx";

/**
 * O trecho do BOTAO do convite, e nada mais.
 *
 * ⚠️ A primeira versao disto recortava de `indexOf("DEMO_URL")` ate
 * `indexOf("LOGIN_URL")` — e devolvia string VAZIA, porque `LOGIN_URL` aparece
 * antes, la no `import` do topo do arquivo. Os dois testes passaram a afirmar
 * coisas sobre o vazio e reprovaram o codigo certo. Ancorar no `href={...}`, que
 * so existe no botao, e nao no nome da constante, que existe tambem no import.
 */
function blocoDoConvite(codigo: string): string {
  const inicio = codigo.indexOf("href={DEMO_URL}");
  expect(inicio, "o botao do convite sumiu do cabecalho").toBeGreaterThan(-1);
  const fim = codigo.indexOf("href={LOGIN_URL}", inicio);
  return codigo.slice(inicio, fim > inicio ? fim : inicio + 600);
}

describe("o cabeçalho: Entrar, Assinar e o convite de conversa", () => {
  it("Entrar e Assinar — os dois presentes", () => {
    const codigo = semComentarios(ler(HEADER));
    expect(codigo).toContain("LOGIN_URL");
    expect(codigo).toContain("ASSINAR_URL");
    expect(codigo).toContain("ASSINAR_CTA_LABEL");
  });

  /**
   * ── A REGRA DE 24/08 MUDOU EM 05/09, E O REGISTRO FICA ────────────────────
   *
   * Estes dois casos travavam a ordem do CEO de 24/08: nada de convite para
   * conversar no topo, porque isso ensina o visitante DECIDIDO a pedir reunião
   * em vez de assinar. A trava estava certa e fez o trabalho dela — reprovou na
   * primeira tentativa de acrescentar o botão.
   *
   * O que mudou não foi a opinião: foi o PÚBLICO. Em 05/09 o SDR começou a
   * abordar restaurantes um a um e convidá-los ao site. Quem chega assim não é
   * visitante decidido — é alguém que recebeu uma mensagem e veio olhar. A regra
   * antiga protegia contra desviar quem já ia assinar; ela não previa gente que
   * ainda não sabe o que o Foocci é.
   *
   * O que NÃO afrouxou, e é o que estes casos passam a guardar:
   *   · o convite continua fora do WhatsApp direto — vai para a página de leads;
   *   · "Assinar" continua sendo o único botão de destaque no topo.
   */
  it("o convite de conversa voltou ao topo — e aponta para a PÁGINA DE LEADS", () => {
    // `DEMO_URL` é o formulário. O topo aponta para ELE, e não para
    // `AGENTE_URL` — que desde 05/09 leva direto ao WhatsApp e é a porta do
    // botão verde. As duas portas servem estados diferentes: quem quer ser
    // ATENDIDO escreve; quem quer ser ENTENDIDO preenche.
    const codigo = semComentarios(ler(HEADER));
    expect(codigo).toContain("DEMO_URL");
  });

  it("⛔ e o topo NUNCA manda direto para o WhatsApp", () => {
    // A razão de 27/08, que não mudou: número anônimo chega sem nome, sem
    // restaurante e sem cidade, e o agente gasta as três primeiras mensagens
    // descobrindo com quem fala. `AGENTE_URL` é um desvio no servidor, e é ele
    // que decide o destino — o topo não escolhe.
    const codigo = semComentarios(ler(HEADER));
    expect(codigo).not.toMatch(/wa\.me|api\.whatsapp\.com/);
    // E não usa `AGENTE_URL`, que hoje É o atalho direto para o WhatsApp.
    expect(codigo).not.toContain("AGENTE_URL");
    expect(codigo).not.toContain("chamada.href");
  });

  it("⭐ o convite não pode competir com Assinar", () => {
    // O medo de 24/08 continua legítimo: se o convite virar botão laranja do
    // mesmo peso, ele rouba quem já tinha decidido. Só `Assinar` usa a cor da
    // marca no topo.
    const codigo = semComentarios(ler(HEADER));
    const linhasComMarca = codigo.split("\n").filter((l) => /bg-brand-500/.test(l));
    for (const linha of linhasComMarca) {
      expect(linha, "outro botão do topo ganhou o mesmo destaque de Assinar")
        .not.toMatch(/DEMO_URL/);
    }
  });

  /**
   * ── A TRAVA QUE FALTAVA EM 05/09 ──────────────────────────────────────────
   *
   * O convite subiu duas vezes errado no mesmo dia, e nenhum teste barrou:
   * primeiro como TEXTO SOLTO sem borda, depois com o rótulo quebrando em DUAS
   * LINHAS ao lado do Entrar, empurrando a fileira contra o logo. Portão que não
   * pega o defeito que já aconteceu não é portão. Estes dois fecham o buraco.
   */
  it("é BOTÃO, com a mesma borda do Entrar — não texto solto", () => {
    const codigo = semComentarios(ler(HEADER));
    // a fileira do topo tem TRÊS botões; o convite é um deles, com moldura.
    const bloco = blocoDoConvite(codigo);
    expect(bloco, "o convite do topo perdeu a borda e virou texto solto")
      .toMatch(/border border-line2/);
  });

  it("⛔ e o rótulo do convite NUNCA quebra em duas linhas", () => {
    const codigo = semComentarios(ler(HEADER));
    const bloco = blocoDoConvite(codigo);
    expect(bloco, "sem whitespace-nowrap o rótulo quebra e colide com o logo")
      .toContain("whitespace-nowrap");
  });

  it("o rótulo é uma palavra de compromisso, não de conversa", () => {
    expect(ASSINAR_CTA_LABEL).toBe("Assinar");
  });
});

describe("o destino de 'Assinar' assina de verdade", () => {
  const arquivoDaPagina = path.join(RAIZ, "src/app", `${ASSINAR_URL}/page.tsx`);

  it("a página existe", () => {
    expect(fs.existsSync(arquivoDaPagina), `${ASSINAR_URL} não existe como página`).toBe(true);
  });

  it("monta o CHECKOUT, não um formulário de contato", () => {
    const fonte = fs.readFileSync(arquivoDaPagina, "utf8");
    expect(fonte).toContain("<CheckoutClient");
    expect(fonte).not.toContain("<DemoForm");
  });

  it("o checkout chama a rota que cobra de verdade", () => {
    const cliente = ler("src/app/contratar/novo/CheckoutClient.tsx");
    expect(cliente).toContain('"/api/billing/checkout"');
  });

  it("o preço vem da fonte única do servidor — a página não inventa cifra", () => {
    const fonte = fs.readFileSync(arquivoDaPagina, "utf8");
    expect(fonte).toContain("@/lib/billing/pricing");
    // nenhum valor em reais escrito à mão na página do checkout
    expect(semComentarios(fonte)).not.toMatch(/R\$\s?\d/);
  });

  it("e o aceite do Termo acontece antes do pagamento", () => {
    const rota = ler("src/app/api/billing/checkout/route.ts");
    expect(rota).toContain("aceiteTermos");
    expect(rota).toContain("recordAcceptance");
  });
});

describe("quem tem dúvida não fica sem porta", () => {
  it("a barra fixa do celular carrega o mesmo convite do topo", () => {
    const sticky = semComentarios(ler("src/components/marketing/StickyMobileCta.tsx"));
    expect(sticky).toContain("ASSINAR_URL");
  });

  it("o botão do agente aparece TAMBÉM no celular — a dúvida não pode ficar sem saída", () => {
    const botao = ler("src/components/marketing/BotaoAgenteFlutuante.tsx");
    // lê a constante, não escreve o caminho à mão — mesma regra do resto do site
    expect(botao).toContain("AGENTE_URL");
    // era `hidden … lg:inline-flex` (só desktop); agora existe em toda tela
    expect(botao).not.toMatch(/className="group fixed[^"]*\bhidden\b/);
  });
});
