import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { avisarAcessoCriado, corpoDoAviso } from "./avisoDeAcesso";

/**
 * ⛔⛔ A SENHA VIAJANDO PELA CAIXA POSTAL — e o que torna isso aceitável.
 *
 * Mandar senha por uma trilha append-only só não é defeito por duas travas que
 * vivem do outro lado: a provisória não abre nada (portão dos layouts) e ela
 * vence (`senhaProvisoriaExpiraEm`). Este arquivo cuida da terceira parte —
 * que o recado DIGA as duas coisas, e que a senha não escorra por nenhum outro
 * caminho no meio do envio.
 */

const AMANHA = new Date(Date.now() + 48 * 3_600_000);

beforeEach(() => {
  process.env.DIOLI_CONNECT_URL = "https://nucleo.exemplo";
  process.env.DIOLI_CONNECT_SECRET = "segredo-de-prova-bem-longo-mesmo";
});

afterEach(() => {
  delete process.env.DIOLI_CONNECT_URL;
  delete process.env.DIOLI_CONNECT_SECRET;
});

describe("o texto do recado", () => {
  it("diz o que a senha NÃO faz antes de mostrar a senha", () => {
    const t = corpoDoAviso({ senha: "abc123", urlDaTroca: "https://x/trocar", expiraEm: AMANHA });
    // Quem recebe uma senha assume que ela abre o sistema. Descobrir depois que
    // não abre parece defeito; dizer antes transforma numa etapa esperada.
    expect(t.indexOf("não abre mais nada")).toBeLessThan(t.indexOf("abc123"));
  });

  it("mostra o prazo — senão 'provisória' é só um adjetivo", () => {
    const t = corpoDoAviso({ senha: "abc123", urlDaTroca: "https://x/trocar", expiraEm: AMANHA });
    expect(t).toContain(AMANHA.toISOString());
  });
});

describe("o envio", () => {
  it("manda para o crachá certo, com o segredo no cabeçalho", async () => {
    const buscar = vi.fn(async () =>
      new Response(JSON.stringify({ mensagemId: "m1" }), { status: 201 }),
    ) as unknown as typeof fetch;

    const r = await avisarAcessoCriado(
      {
        crachaConnect: "Dioli.Control-Room.Diretoria.Diretor-Geral",
        de: "dioli.foocci.direcao.diretor",
        senha: "abc123",
        urlDaTroca: "https://x/trocar",
        expiraEm: AMANHA,
      },
      buscar,
    );

    expect(r.avisou).toBe(true);
    const [url, init] = (buscar as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe("https://nucleo.exemplo/api/connect/mensagem");
    expect((init.headers as Record<string, string>)["x-dioli-connect-secret"]).toBe(
      "segredo-de-prova-bem-longo-mesmo",
    );

    const enviado = JSON.parse(String(init.body)) as Record<string, unknown>;
    // Endereço normalizado: "Diretor-Geral" e "diretor-geral" não podem virar
    // duas caixas, e a segunda nunca receberia nada.
    expect(enviado.para).toBe("dioli.control-room.diretoria.diretor-geral");
    // ⛔ `restrito` é o que impede este corpo de ser lido por um motor de IA do
    // outro lado: o egresso de lá recusa tudo que não é público ou interno.
    expect(enviado.classificacao).toBe("restrito");
  });

  it("⛔ a senha NUNCA aparece no motivo de uma recusa", async () => {
    const buscar = vi.fn(async () =>
      new Response(JSON.stringify({ codigo: "cracha_ausente" }), { status: 422 }),
    ) as unknown as typeof fetch;

    const r = await avisarAcessoCriado(
      {
        crachaConnect: "dioli.control-room.diretoria.diretor-geral",
        de: "dioli.foocci.direcao.diretor",
        senha: "senha-secreta-que-nao-pode-vazar",
        urlDaTroca: "https://x/trocar",
        expiraEm: AMANHA,
      },
      buscar,
    );

    expect(r.avisou).toBe(false);
    if (r.avisou) return;
    // O caminho preguiçoso seria ecoar o corpo enviado no erro "para ajudar a
    // depurar" — e o corpo enviado contém a senha.
    expect(r.motivo).not.toContain("senha-secreta-que-nao-pode-vazar");
    expect(r.motivo).toContain("cracha_ausente");
  });

  it("⛔ sem canal configurado, não tenta e não lança", async () => {
    delete process.env.DIOLI_CONNECT_URL;
    const buscar = vi.fn() as unknown as typeof fetch;

    const r = await avisarAcessoCriado(
      {
        crachaConnect: "dioli.control-room.diretoria.diretor-geral",
        de: "dioli.foocci.direcao.diretor",
        senha: "abc",
        urlDaTroca: "https://x/trocar",
        expiraEm: AMANHA,
      },
      buscar,
    );

    expect(r.avisou).toBe(false);
    // Fail-closed: sem canal não há para onde mandar, e isso não derruba a
    // criação do acesso — a senha volta na resposta da rota, como antes.
    expect((buscar as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("⛔ sem crachá, não inventa destino", async () => {
    const buscar = vi.fn() as unknown as typeof fetch;
    const r = await avisarAcessoCriado(
      {
        crachaConnect: "   ",
        de: "dioli.foocci.direcao.diretor",
        senha: "abc",
        urlDaTroca: "https://x/trocar",
        expiraEm: AMANHA,
      },
      buscar,
    );
    expect(r.avisou).toBe(false);
    expect((buscar as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});
