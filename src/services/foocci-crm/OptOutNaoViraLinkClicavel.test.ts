/**
 * Quem pediu silêncio não vira link clicável no CRM da Foocci.
 *
 * ─── O FURO, medido em 07/09/2026 ───────────────────────────────────────────
 * `FoocciCrmService.ts` montava `whatsappLink` para TODO lead — na lista e no
 * dossiê — e a string `optOut` **não aparecia uma única vez no arquivo**. A tela
 * renderizava o link como âncora clicável.
 *
 * O estrago não é automático, e é por isso que ninguém tinha visto: um vendedor
 * abre o dossiê de quem mandou "PARE", vê o número em laranja, clica, e o
 * WhatsApp abre a conversa. Nenhum robô enviou nada. **O produto convidou a
 * violação**, sem trava e sem aviso.
 *
 * ─── O QUE PROVA QUE É OMISSÃO, E NÃO DECISÃO ───────────────────────────────
 * A Sala de Vendas trabalha a MESMA tabela `SiteLead` e faz o certo:
 * `podeEscrever: !somenteLeitura(...) && !lead.optOutAt`
 * (`api/admin/sala-de-vendas/conversa/route.ts:122`), com bloqueio na rota de
 * escrita e "pediu silêncio" na tela. Duas telas, um dado, um freio só.
 *
 * ─── A LIÇÃO, e ela é maior que este arquivo ────────────────────────────────
 * **Opt-out não é propriedade do caminho de envio; é propriedade do dado.** O
 * gate sumiu justamente onde ninguém procurou, porque "isso aí não envia" — e
 * link clicável é caminho de envio com gente no meio.
 *
 * Por isso a trava é o `null` no servidor, e não o `if` na tela: a tela já sabia
 * tratar `whatsappLink: null`, e nenhuma tela futura consegue oferecer o clique
 * nem por esquecimento. Guardrail 4 — prompt é aviso, código é trava.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const db = vi.hoisted(() => ({
  siteLead: { findMany: vi.fn(), findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { listarContatos, getDossie } from "./FoocciCrmService";

const BASE = {
  id: "lead_1",
  nome: "Dona Ana",
  codigo: "AB12CD",
  whatsapp: "+55 11 94372-3316",
  whatsappDigits: "5511943723316",
  restaurante: "Marmitaria Divino Sabor",
  cidade: "Poá",
  tipo: "marmitaria",
  desafio: "poucos pedidos no delivery",
  stage: "NOVO",
  stageChangedAt: new Date("2026-08-16T12:00:00Z"),
  stageChangedBy: null,
  createdAt: new Date("2026-08-16T12:00:00Z"),
  lastContactedAt: null,
  notifiedAt: new Date("2026-08-16T12:01:00Z"),
  optOutAt: null as Date | null,
  origem: null,
  interactions: [],
  _count: { interactions: 0 },
};

const PEDIU_SILENCIO = { ...BASE, optOutAt: new Date("2026-09-01T10:00:00Z") };

beforeEach(() => {
  vi.clearAllMocks();
  db.siteLead.findMany.mockResolvedValue([BASE]);
  db.siteLead.findUnique.mockResolvedValue(BASE);
});

describe("na LISTA", () => {
  it("⭐ quem pediu silêncio não recebe link clicável", async () => {
    db.siteLead.findMany.mockResolvedValue([PEDIU_SILENCIO]);

    const [c] = await listarContatos();

    expect(c.whatsappLink, "a lista entregou o link de quem pediu silêncio").toBeNull();
    expect(c.pediuSilencio).toBe(true);
  });

  it("⭐ A METADE LEGÍTIMA: quem não pediu nada continua com o link", async () => {
    const [c] = await listarContatos();

    expect(c.whatsappLink, "sumiu com o link de quem podia ser contatado").toBeTruthy();
    expect(c.pediuSilencio).toBe(false);
  });

  it("o número continua VISÍVEL — a trava é o clique, não o dado", async () => {
    db.siteLead.findMany.mockResolvedValue([PEDIU_SILENCIO]);
    const [c] = await listarContatos();
    // Esconder o telefone quebraria quem precisa reconhecer o contato e honrar
    // o silêncio. O que se tira é o convite, não a informação.
    expect(c.whatsapp).toBe(PEDIU_SILENCIO.whatsapp);
  });
});

describe("no DOSSIÊ — a tela onde o furo aparecia", () => {
  it("⭐ quem pediu silêncio não recebe link clicável", async () => {
    db.siteLead.findUnique.mockResolvedValue(PEDIU_SILENCIO);

    const d = await getDossie("lead_1");

    expect(d?.whatsappLink, "o dossiê entregou o link de quem pediu silêncio").toBeNull();
    expect(d?.pediuSilencio).toBe(true);
  });

  it("⭐ A METADE LEGÍTIMA: quem não pediu nada continua com o link", async () => {
    const d = await getDossie("lead_1");

    expect(d?.whatsappLink).toBeTruthy();
    expect(d?.pediuSilencio).toBe(false);
  });
});

describe("⭐ O CENSO — nenhuma superfície nova monta link sem olhar o silêncio", () => {
  /**
   * Esta é a trava contra a TERCEIRA superfície. Duas telas já escreveram sobre
   * a mesma `SiteLead` e só uma tinha o freio; a lição não é "conserte esta", é
   * "a próxima nasce com ele".
   *
   * Lê texto, e isso é o limite honesto: prova que todo `linkWhatsapp(` deste
   * arquivo está condicionado ao silêncio, não que a condição esteja certa.
   * Quem prova a condição são os quatro casos acima.
   */
  const fonte = readFileSync(
    path.resolve(__dirname, "FoocciCrmService.ts"),
    "utf8",
  );

  it("todo linkWhatsapp( do serviço passa por pediuSilencio", () => {
    const chamadas = fonte.split("\n").filter((l) => l.includes("linkWhatsapp("));
    // Ignora a linha do import.
    const montagens = chamadas.filter((l) => !l.trim().startsWith("import"));

    expect(montagens.length, "ninguém monta link — o regex quebrou").toBeGreaterThan(0);
    for (const linha of montagens) {
      expect(
        linha.includes("pediuSilencio"),
        `esta linha monta link sem olhar o silêncio: ${linha.trim()}`,
      ).toBe(true);
    }
  });

  it("o serviço conhece a palavra optOut — ele passou anos sem conhecer", () => {
    expect(fonte).toContain("pediuSilencio");
  });
});
