/**
 * ⛔ A FONTE DO CONTRATO MUDOU — O BANCO ANTES DO AMBIENTE. E A REGRA NÃO.
 *
 * Até 10/09/2026, quantas variáveis o envio monta vinha SÓ de
 * `FOOCCI_SDR_MODELO_VARIAVEIS`: pedia-se a uma pessoa que digitasse um número
 * que a API da Meta responde de graça. Número digitado envelhece no dia em que
 * outra pessoa aprova um modelo novo e não avisa — e o preço deste envelhecer
 * é 100% de recusa na rodada seguinte, descoberta contato a contato.
 *
 * O que estes casos protegem:
 *
 *   1. **O banco vem primeiro**, e o ambiente é reserva de verdade — não
 *      decoração: sem linha no banco, ele ainda decide.
 *   2. **⛔ SONDA DE CONTROLE:** o pré-voo continua REPROVANDO contrato
 *      incompatível. Uma régua que só sabe aprovar é régua nenhuma: se o caso
 *      que deve falhar passar, todos os casos verdes acima não provam nada.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/services/whatsapp/metaFlag", () => ({
  metaGraphUrl: (c: string) => `https://graph.facebook.com/v21.0/${c}`,
}));

const credenciais = vi.hoisted(() => ({ getResolved: vi.fn() }));
vi.mock("@/services/meta/MetaAppCredentialsService", () => ({
  MetaAppCredentialsService: credenciais,
}));

/** O modelo persistido, controlado caso a caso. `null` = o banco não sabe. */
const persistido = vi.hoisted(() => ({ modeloAprovadoDaSala: vi.fn() }));
vi.mock("../sincronizarModelos", async (original) => {
  const real = await original<typeof import("../sincronizarModelos")>();
  return { ...real, modeloAprovadoDaSala: persistido.modeloAprovadoDaSala };
});

import {
  parametrosQueOEnvioMonta,
  parametrosDoEnvioAgora,
  conferirModeloDeAbordagem,
} from "../modelosDaMeta";

const TOKEN = "token-de-teste";
const guardado = { ...process.env };
const corpo = (texto: string) => [{ type: "BODY", text: texto }];

function metaResponde(modelos: unknown[]) {
  globalThis.fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ whatsapp_business_account: { id: "999" } }), { status: 200 }),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: modelos }), { status: 200 })) as never;
}

beforeEach(() => {
  vi.restoreAllMocks();
  persistido.modeloAprovadoDaSala.mockReset();
  persistido.modeloAprovadoDaSala.mockResolvedValue(null);
  process.env.FOOCCI_SALES_PHONE_NUMBER_ID = "000000000000001";
  process.env.FOOCCI_SDR_MODELO_ABORDAGEM = "foocci_abordagem_v1";
  process.env.FOOCCI_SDR_MODELO_IDIOMA = "pt_BR";
  delete process.env.FOOCCI_SDR_MODELO_VARIAVEIS;
  credenciais.getResolved.mockResolvedValue({ appId: "app1", appSecret: "segredo" });
});
afterEach(() => {
  process.env = { ...guardado };
});

describe("a ordem das fontes: banco → ambiente → padrão", () => {
  it("⭐ o banco GANHA do ambiente", () => {
    // O ambiente diz 1; a Meta respondeu 2 e nós gravamos 2. Quem manda no
    // número é a Meta — a variável é o palpite de alguém.
    expect(parametrosQueOEnvioMonta({ FOOCCI_SDR_MODELO_VARIAVEIS: "1" }, 2)).toBe(2);
  });

  it("banco dizendo ZERO é uma resposta, não uma ausência", () => {
    // ⚠️ Zero gravado é um modelo sem variável de verdade. Cair no ambiente
    // aqui faria o envio mandar uma saudação para um modelo que não a espera —
    // e a Meta recusa 100%.
    expect(parametrosQueOEnvioMonta({ FOOCCI_SDR_MODELO_VARIAVEIS: "1" }, 0)).toBe(0);
  });

  it("⭐ sem o banco, o ambiente decide — a reserva é reserva de verdade", () => {
    expect(parametrosQueOEnvioMonta({ FOOCCI_SDR_MODELO_VARIAVEIS: "2" }, null)).toBe(2);
  });

  it("sem banco e sem ambiente, o padrão continua sendo 1 (a saudação)", () => {
    expect(parametrosQueOEnvioMonta({}, null)).toBe(1);
  });

  it("valor absurdo vindo do banco cai na fonte seguinte, e não vira contrato", () => {
    // Dado corrompido não é contrato. Seguir com ele faria o pré-voo comparar
    // lixo com lixo e aprovar.
    expect(parametrosQueOEnvioMonta({ FOOCCI_SDR_MODELO_VARIAVEIS: "2" }, 99)).toBe(2);
  });
});

describe("`parametrosDoEnvioAgora` consulta o banco antes de responder", () => {
  it("⭐ usa o que foi sincronizado do modelo configurado", async () => {
    persistido.modeloAprovadoDaSala.mockResolvedValue({
      nome: "foocci_abordagem_v1",
      idioma: "pt_BR",
      categoria: "MARKETING",
      situacao: "APPROVED",
      variaveis: 2,
      corpo: "Olá {{1}}, aqui é a Foocci — atendemos em {{2}}",
    });
    process.env.FOOCCI_SDR_MODELO_VARIAVEIS = "1";

    expect(await parametrosDoEnvioAgora()).toBe(2);
    expect(persistido.modeloAprovadoDaSala).toHaveBeenCalledWith(
      undefined,
      "foocci_abordagem_v1",
      "pt_BR",
    );
  });

  it("banco fora do ar cai na reserva em vez de derrubar a rodada", async () => {
    // Recusar o dia inteiro de abordagem porque o Postgres piscou seria trocar
    // um defeito por outro maior.
    persistido.modeloAprovadoDaSala.mockRejectedValue(new Error("conexão recusada"));
    process.env.FOOCCI_SDR_MODELO_VARIAVEIS = "2";

    expect(await parametrosDoEnvioAgora()).toBe(2);
  });
});

describe("⛔ o pré-voo continua sendo uma régua, e não um carimbo", () => {
  it("⭐ SONDA DE CONTROLE: modelo de 2 variáveis contra envio de 1 REPROVA", async () => {
    // Este é o caso que DEVE falhar. Se ele passar, nenhum verde deste arquivo
    // significa coisa alguma: régua verde sobre o componente errado é pior que
    // régua nenhuma — a régua nenhuma deixa a dúvida viva.
    persistido.modeloAprovadoDaSala.mockResolvedValue({
      nome: "foocci_abordagem_v1",
      idioma: "pt_BR",
      categoria: "MARKETING",
      situacao: "APPROVED",
      variaveis: 1,
      corpo: "Olá {{1}}",
    });
    // A Meta, consultada AGORA, diz 2: alguém editou o modelo e ninguém
    // sincronizou. O envio montaria pelo retrato velho.
    metaResponde([
      {
        name: "foocci_abordagem_v1",
        language: "pt_BR",
        status: "APPROVED",
        components: corpo("Olá {{1}}, aqui é a Foocci — atendemos em {{2}}"),
      },
    ]);

    const r = await conferirModeloDeAbordagem(TOKEN);

    expect(r.pronto).toBe(false);
    if (r.pronto) return;
    expect(r.causa).toBe("variaveisNaoBatem");
    // ⚠️ A frase tem de dizer o número que a META respondeu. "Não bate" sozinho
    // manda quem lê abrir o painel da Meta para descobrir o que já está escrito.
    expect(r.detalhe).toContain("espera 2");
    expect(r.detalhe).toContain("monta 1");
  });

  it("⭐ sincronizado e igual: aprova, e diz quantos parâmetros vão", async () => {
    persistido.modeloAprovadoDaSala.mockResolvedValue({
      nome: "foocci_abordagem_v1",
      idioma: "pt_BR",
      categoria: "MARKETING",
      situacao: "APPROVED",
      variaveis: 1,
      corpo: "Olá {{1}}",
    });
    metaResponde([
      { name: "foocci_abordagem_v1", language: "pt_BR", status: "APPROVED", components: corpo("Olá {{1}}") },
    ]);

    const r = await conferirModeloDeAbordagem(TOKEN);

    expect(r.pronto).toBe(true);
    expect(r.pronto && r.parametrosQueMandamos).toBe(1);
  });

  it("sem nada no banco, o ambiente ainda pode reprovar — a trava não some", async () => {
    persistido.modeloAprovadoDaSala.mockResolvedValue(null);
    process.env.FOOCCI_SDR_MODELO_VARIAVEIS = "1";
    metaResponde([
      {
        name: "foocci_abordagem_v1",
        language: "pt_BR",
        status: "APPROVED",
        components: corpo("Olá {{1}}, aqui é a Foocci — atendemos em {{2}}"),
      },
    ]);

    const r = await conferirModeloDeAbordagem(TOKEN);

    expect(r.pronto).toBe(false);
    expect(!r.pronto && r.causa).toBe("variaveisNaoBatem");
  });
});
