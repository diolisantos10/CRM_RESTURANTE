/**
 * A fileira do topo tem folga de verdade — medida, não lida do className.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 * O convite "Fale com nossos consultores" quebrou o cabeçalho em produção e
 * chegou TRÊS VEZES na mesa do CEO no mesmo dia (05/09/2026). As duas travas
 * que nasceram com o conserto — "tem borda" e "tem whitespace-nowrap" — leem
 * TEXTO DE ARQUIVO. Texto de arquivo não mede largura: com as duas verdes, a
 * fileira ainda encostava.
 *
 * Medido em 06/09, no HTML renderizado, ANTES desta correção:
 *
 *     1024px → folga logo↔menu = 0px · folga menu↔botões = 0px
 *     1280px → 43px / 44px
 *     1440px → 43px / 44px
 *
 * Zero não é "cabe": é o limite exato. Uma palavra a mais em qualquer item do
 * menu, ou um rótulo maior, e o defeito volta — e volta em 1024, que é o
 * notebook comum, não uma tela exótica.
 *
 * ─── O QUE ESTE TESTE MEDE ──────────────────────────────────────────────────
 * `getBoundingClientRect` dos três blocos da fileira, nas três larguras. Ele
 * reprova se qualquer par ficar com menos que o PISO, se algum botão ocupar
 * mais de uma linha, ou se a página passar a rolar de lado.
 *
 * O PISO é 12px: metade do que a correção entregou (23/24px em 1024). Assim ele
 * reprova de verdade quando alguém aperta o topo de novo, sem virar alarme
 * falso a cada ajuste de meio pixel de fonte.
 */

import { test, expect } from "@playwright/test";

const LARGURAS = [1024, 1280, 1440] as const;
/** Folga mínima aceitável entre os blocos da fileira, em pixels. */
const PISO = 12;

for (const largura of LARGURAS) {
  test(`topo em ${largura}px: os blocos não se encostam`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: 900 });
    await page.goto("/site", { waitUntil: "networkidle" });

    const medida = await page.evaluate(() => {
      const header = document.querySelector("header");
      if (!header) throw new Error("header não encontrado");
      const nav = header.querySelector("nav[aria-label]");
      const acoes = [...header.querySelectorAll(":scope > div > div")].pop();
      const logo = header.querySelector("a");
      if (!nav || !acoes || !logo) throw new Error("blocos do topo não encontrados");

      const r = (el: Element) => el.getBoundingClientRect();
      const linhasDe = (el: Element) => {
        const cx = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        return Math.max(1, Math.round((cx.height - padY) / lh));
      };

      // Os LINKS DO MENU, não só os botões. O conserto de 05/09 pôs a trava de
      // linha única em UM elemento e deixou os cinco vizinhos sem nenhuma — e
      // foi lá que "Atendimento com IA" quebrou e o "IA" caiu colado no logo.
      const links = [...nav.querySelectorAll("a")].map((el) => ({
        texto: (el.textContent ?? "").trim(),
        linhas: linhasDe(el),
      }));

      const botoes = [...acoes.querySelectorAll("a,button")].map((el) => {
        const cx = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        return {
          texto: (el.textContent ?? "").trim(),
          linhas: Math.max(1, Math.round((cx.height - padY) / lh)),
        };
      });

      return {
        folgaLogoNav: Math.round(r(nav).x - r(logo).right),
        folgaNavAcoes: Math.round(r(acoes).x - r(nav).right),
        rolaDeLado: document.documentElement.scrollWidth > window.innerWidth,
        alturaNav: Math.round(r(nav).height),
        links,
        botoes,
      };
    });

    expect(
      medida.folgaLogoNav,
      `logo e menu com ${medida.folgaLogoNav}px de folga em ${largura}px — o piso é ${PISO}px`,
    ).toBeGreaterThanOrEqual(PISO);

    expect(
      medida.folgaNavAcoes,
      `menu e botões com ${medida.folgaNavAcoes}px de folga em ${largura}px — o piso é ${PISO}px`,
    ).toBeGreaterThanOrEqual(PISO);

    // O defeito original: o rótulo por extenso quebrando em DUAS LINHAS ao lado
    // do Entrar. Aqui isso é medido pela altura do botão, não pelo className.
    for (const b of medida.botoes) {
      expect(b.linhas, `o botão "${b.texto}" ocupa ${b.linhas} linhas em ${largura}px`).toBe(1);
    }

    // ⭐ E os links do menu. Medir só os botões foi o furo da primeira versão
    // desta régua: a folga entre os blocos dava zero E os rótulos do menu
    // quebravam, e eu só tinha medido a folga.
    for (const l of medida.links) {
      expect(l.linhas, `o link "${l.texto}" ocupa ${l.linhas} linhas em ${largura}px`).toBe(1);
    }

    expect(medida.rolaDeLado, `a página rola de lado em ${largura}px`).toBe(false);

    // A barra inteira numa linha só. Se qualquer rótulo quebrar, a altura sobe —
    // é a trava que pega o caso que nenhuma medida por elemento pegaria.
    expect(
      medida.alturaNav,
      `a barra de navegação tem ${medida.alturaNav}px em ${largura}px — quebrou em mais de uma linha`,
    ).toBeLessThanOrEqual(28);
  });
}
