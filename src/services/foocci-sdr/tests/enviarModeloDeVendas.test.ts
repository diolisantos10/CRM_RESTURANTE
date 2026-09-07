/**
 * O envio por modelo — a primeira mensagem para quem nunca escreveu.
 *
 * O que estes casos protegem:
 *
 *   1. **A ordem das recusas é a mesma do envio de texto.** O portão do lead
 *      primeiro, porque é a única recusa que fala do DESTINATÁRIO.
 *   2. **Configuração faltando não vira erro da Meta.** Modelo sem nome ou sem
 *      idioma é problema nosso, e a frase tem de dizer isso — senão o motivo
 *      real chega à tela disfarçado de recusa da plataforma.
 *   3. **Variável vazia não vira espaço no meio da frase.** "Olá , tudo bem?"
 *      parece defeito porque é.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { enviarModeloDeVendas } from "../FoocciSalesChannel";
import type { LeadSafetyDecision } from "../LeadContactSafety";

const APROVADO: LeadSafetyDecision = {
  sendable: true,
  reason: null,
  detail: "teste",
};

const REPROVADO: LeadSafetyDecision = {
  sendable: false,
  reason: "LEAD_OPT_OUT",
  detail: "pediu silêncio",
};

const MODELO = { nome: "foocci_abordagem_inicial", idioma: "pt_BR", parametros: ["Marina"] };

const ambiente = { ...process.env };

function ligarTudo() {
  // Número fictício de propósito: id real de conta é dado de cliente.
  process.env.FOOCCI_SALES_PHONE_NUMBER_ID = "000000000000001";
  process.env.FOOCCI_SALES_ACCESS_TOKEN = "EAAtoken-de-teste";
  process.env.FOOCCI_SDR_SEND_ENABLED = "true";
  process.env.FOOCCI_SALES_PROVIDER = "META_CLOUD_API";
}

beforeEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("FOOCCI_S")) delete process.env[k];
  }
});

afterEach(() => {
  process.env = { ...ambiente };
});

/** Captura o corpo enviado à Meta sem tocar a rede. */
function espionarFetch(resposta: { ok: boolean; body?: unknown } = { ok: true }) {
  const chamadas: Array<{ url: string; corpo: Record<string, unknown> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      chamadas.push({ url, corpo: JSON.parse(init.body) as Record<string, unknown> });
      return {
        ok: resposta.ok,
        status: resposta.ok ? 200 : 400,
        json: async () => resposta.body ?? {},
      } as never;
    }),
  );
  return chamadas;
}

describe("o caminho feliz", () => {
  it("⭐ manda um modelo, e o corpo é de template — não de texto", async () => {
    ligarTudo();
    const chamadas = espionarFetch();

    const r = await enviarModeloDeVendas(APROVADO, "+55 11 99999-8888", MODELO);

    expect(r.ok).toBe(true);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.corpo.type).toBe("template");
    // A sonda que importa: se saísse como texto, a Meta recusaria a abordagem
    // fria e o motivo pareceria da plataforma.
    expect(chamadas[0]!.corpo.text).toBeUndefined();
  });

  it("leva nome, idioma e as variáveis na ordem", async () => {
    ligarTudo();
    const chamadas = espionarFetch();

    await enviarModeloDeVendas(APROVADO, "+55 11 99999-8888", {
      nome: "abordagem_restaurante_f",
      idioma: "pt_BR",
      parametros: ["Marina", "Sushi Cazza"],
    });

    const t = chamadas[0]!.corpo.template as {
      name: string;
      language: { code: string };
      components: Array<{ parameters: Array<{ text: string }> }>;
    };
    expect(t.name).toBe("abordagem_restaurante_f");
    expect(t.language.code).toBe("pt_BR");
    expect(t.components[0]!.parameters.map((p) => p.text)).toEqual(["Marina", "Sushi Cazza"]);
  });
});

describe("⛔ o que nunca sai", () => {
  it("portão reprovado barra ANTES de qualquer outra coisa", async () => {
    // Nem ligo o canal: se a ordem estivesse errada, a recusa seria "canal não
    // configurado" e esconderia que a pessoa pediu silêncio.
    const chamadas = espionarFetch();
    const r = await enviarModeloDeVendas(REPROVADO, "+55 11 99999-8888", MODELO);

    expect(r.ok).toBe(false);
    expect(r.error).toContain("portão do lead reprovou");
    expect(chamadas).toHaveLength(0);
  });

  it("envio desligado não manda modelo — a chave vale para os dois caminhos", async () => {
    ligarTudo();
    delete process.env.FOOCCI_SDR_SEND_ENABLED;
    const chamadas = espionarFetch();

    const r = await enviarModeloDeVendas(APROVADO, "+55 11 99999-8888", MODELO);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("FOOCCI_SDR_SEND_ENABLED");
    expect(chamadas).toHaveLength(0);
  });

  it("⛔ modelo sem nome culpa a NOSSA configuração, não a Meta", async () => {
    ligarTudo();
    const chamadas = espionarFetch();

    const r = await enviarModeloDeVendas(APROVADO, "+55 11 99999-8888", {
      ...MODELO,
      nome: "   ",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("FOOCCI_SDR_MODELO_ABORDAGEM");
    expect(chamadas).toHaveLength(0);
  });

  it("modelo sem idioma também", async () => {
    ligarTudo();
    espionarFetch();
    const r = await enviarModeloDeVendas(APROVADO, "+55 11 99999-8888", { ...MODELO, idioma: "" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("FOOCCI_SDR_MODELO_IDIOMA");
  });

  it("⛔ variável vazia é recusada, e a mensagem diz QUAL", async () => {
    ligarTudo();
    const chamadas = espionarFetch();

    const r = await enviarModeloDeVendas(APROVADO, "+55 11 99999-8888", {
      ...MODELO,
      parametros: ["Marina", "  ", "São Paulo"],
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("{{2}}");
    expect(chamadas).toHaveLength(0);
  });

  it("telefone inválido não vira tentativa cega", async () => {
    ligarTudo();
    const chamadas = espionarFetch();
    const r = await enviarModeloDeVendas(APROVADO, "abc", MODELO);
    expect(r.ok).toBe(false);
    expect(chamadas).toHaveLength(0);
  });

  it("a Meta recusando vira erro com motivo, nunca sucesso silencioso", async () => {
    ligarTudo();
    espionarFetch({ ok: false, body: { error: { message: "Template name does not exist" } } });

    const r = await enviarModeloDeVendas(APROVADO, "+55 11 99999-8888", MODELO);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Template name does not exist");
  });
});

describe("sonda de controle", () => {
  it("modelo SEM variáveis sai igual, e sem componente vazio", async () => {
    // Se a montagem exigisse parâmetros, um modelo simples nunca sairia — e o
    // teste do caminho feliz, que usa um parâmetro, não pegaria isso.
    ligarTudo();
    const chamadas = espionarFetch();

    const r = await enviarModeloDeVendas(APROVADO, "+55 11 99999-8888", {
      nome: "hello_world",
      idioma: "en_US",
      parametros: [],
    });

    expect(r.ok).toBe(true);
    const t = chamadas[0]!.corpo.template as { components?: unknown };
    expect(t.components).toBeUndefined();
  });
});
