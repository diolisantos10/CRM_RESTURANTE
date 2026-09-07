/**
 * A ENTREGA — e a chave que continua sendo do dono.
 *
 * ── O DEFEITO QUE ESTE CÓDIGO FECHOU ────────────────────────────────────────
 *
 * Procurando quem chamava `enviarTextoDeVendas`, a resposta era **ninguém**. A
 * função existia, testada, e nenhuma linha do produto a chamava. Tudo parecia
 * funcionar: a mensagem chegava, o TA compunha, a resposta aparecia na tela — e
 * o cliente nunca recebia nada.
 *
 * ── O QUE ESTES CASOS GUARDAM ───────────────────────────────────────────────
 *
 * Metade prova que a mensagem SAI quando deve. A outra metade prova as três
 * coisas que nunca podem sair: com a entrega desligada, para quem pediu
 * silêncio, e duas vezes a mesma mensagem.
 *
 * O último é o mais fácil de subestimar: uma entrega não idempotente manda a
 * mesma frase duas vezes para o cliente na primeira reentrega da Meta.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { entregarMensagem } from "./entrega";

const enviar = vi.hoisted(() => vi.fn());
vi.mock("@/services/foocci-sdr/FoocciSalesChannel", async (original) => {
  const real = await original<typeof import("@/services/foocci-sdr/FoocciSalesChannel")>();
  return { ...real, enviarTextoDeVendas: enviar };
});

const ambiente = { ...process.env };

/**
 * Liga as três chaves — as duas da Meta e a da entrega.
 *
 * ⚠️ **NÃO liga `FOOCCI_SDR_IA_RESPONDE_SOZINHA`**, e é de propósito: todo caso
 * deste arquivo manda como `"pessoa"`, que é o caminho que o CEO autorizou em
 * 07/09/2026. A máquina falando sozinha tem arquivo próprio
 * (`entrega.quem-manda.test.ts`) justamente para a diferença entre as duas
 * portas não voltar a se perder dentro de um "ligarTudo".
 *
 * ⚠️ O número abaixo é FICTÍCIO. Era `1300518453142518` — que se descobriu ser
 * o WhatsApp de um restaurante CLIENTE, e não da Foocci. Deixar o id real de um
 * cliente como fixture convida a próxima cópia do erro.
 */
function ligarTudo() {
  process.env.FOOCCI_SALES_PHONE_NUMBER_ID = "000000000000001";
  process.env.FOOCCI_SALES_ACCESS_TOKEN = "EAAtoken-de-teste";
  process.env.FOOCCI_SDR_SEND_ENABLED = "true";
}

function banco(over: { mensagem?: Record<string, unknown> | null } = {}) {
  const mensagem =
    over.mensagem === null
      ? null
      : {
          id: "m1",
          status: "PENDENTE",
          direcao: "SAIDA",
          texto: "Oi! O Foocci monta o pedido junto com o cliente.",
          lead: { whatsapp: "5511999990000", optOutAt: null },
          ...over.mensagem,
        };

  return {
    leadMensagem: {
      findUnique: vi.fn().mockResolvedValue(mensagem),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

beforeEach(() => {
  enviar.mockReset();
  enviar.mockResolvedValue({ ok: true });
  process.env = { ...ambiente };
});

afterEach(() => {
  process.env = { ...ambiente };
});

describe("⭐ nada sai enquanto o dono não ligar", () => {
  it("com a entrega desligada, não envia e não toca no banco", async () => {
    // O caso que carrega o arquivo. Este é o estado de HOJE, e ele tem que
    // continuar sendo o padrão depois desta mudança.
    ligarTudo();
    delete process.env.FOOCCI_SDR_SEND_ENABLED;

    const db = banco();
    const r = await entregarMensagem(db as never, "m1", "pessoa");

    expect(r).toMatchObject({ entregue: false, motivo: "envioDesligado" });
    expect(enviar, "tentou enviar com a chave desligada").not.toHaveBeenCalled();
    // Nem lê a mensagem: com a entrega desligada não há motivo para ir ao banco.
    expect(db.leadMensagem.findUnique).not.toHaveBeenCalled();
  });

  it("sem as chaves da Meta também não sai, e o motivo diz qual é o caso", async () => {
    process.env.FOOCCI_SDR_SEND_ENABLED = "true";
    delete process.env.FOOCCI_SALES_ACCESS_TOKEN;

    const r = await entregarMensagem(banco() as never, "m1", "pessoa");

    expect(r).toMatchObject({ entregue: false, motivo: "envioDesligado" });
    if (r.entregue) return;
    expect(r.detalhe).toContain("chaves da Meta");
  });
});

describe("com tudo ligado, a mensagem sai", () => {
  beforeEach(ligarTudo);

  it("⭐ envia o texto para o telefone do lead e marca como ENVIADA", async () => {
    // A metade que passa, e ela é a razão de o arquivo existir: sem ela, uma
    // função que recusasse SEMPRE passaria em todos os casos de bloqueio.
    const db = banco();
    const r = await entregarMensagem(db as never, "m1", "pessoa");

    expect(r).toEqual({ entregue: true, mensagemId: "m1" });

    const [, telefone, texto] = enviar.mock.calls[0]!;
    expect(telefone).toBe("5511999990000");
    expect(texto).toContain("Foocci");

    expect(db.leadMensagem.update.mock.calls[0]![0]!.data.status).toBe("ENVIADA");
  });

  it("a Meta recusando vira FALHOU com o motivo, nunca sucesso silencioso", async () => {
    enviar.mockResolvedValue({ ok: false, error: "(#131030) recipient not in allowed list" });

    const db = banco();
    const r = await entregarMensagem(db as never, "m1", "pessoa");

    expect(r).toMatchObject({ entregue: false, motivo: "aMetaRecusou" });

    const dados = db.leadMensagem.update.mock.calls[0]![0]!.data;
    expect(dados.status).toBe("FALHOU");
    expect(dados.erro).toContain("131030");
  });

  it("exceção no meio não derruba quem chamou", async () => {
    // É chamada logo depois de gravar, no webhook e na tela. Uma exceção aqui
    // derrubaria os dois — e a mensagem já estava salva.
    enviar.mockRejectedValue(new Error("ECONNRESET"));

    const r = await entregarMensagem(banco() as never, "m1", "pessoa");
    expect(r).toMatchObject({ entregue: false });
  });
});

describe("⭐ o que nunca sai, mesmo com tudo ligado", () => {
  beforeEach(ligarTudo);

  it("quem pediu silêncio DEPOIS de a mensagem ser escrita não recebe", async () => {
    // A razão de o portão ser reavaliado na entrega, e não só na composição.
    // Entre escrever e entregar pode ter passado tempo — e quem pediu para parar
    // não recebe o que já estava na fila.
    const db = banco({ mensagem: { lead: { whatsapp: "5511999990000", optOutAt: new Date() } } });
    const r = await entregarMensagem(db as never, "m1", "pessoa");

    expect(r).toMatchObject({ entregue: false, motivo: "leadPediuSilencio" });
    expect(enviar).not.toHaveBeenCalled();
    // E fica registrado na própria mensagem, para a tela poder explicar.
    expect(db.leadMensagem.update.mock.calls[0]![0]!.data.status).toBe("FALHOU");
  });

  it("⭐ mensagem que já foi enviada NÃO é enviada de novo", async () => {
    // Uma entrega não idempotente manda a mesma frase duas vezes ao cliente na
    // primeira reentrega da Meta — e o cliente conclui que é robô.
    const db = banco({ mensagem: { status: "ENVIADA" } });
    const r = await entregarMensagem(db as never, "m1", "pessoa");

    expect(r).toMatchObject({ entregue: false, motivo: "naoEraParaEnviar" });
    expect(enviar).not.toHaveBeenCalled();
  });

  it("mensagem de ENTRADA nunca é enviada", async () => {
    // O que o cliente escreveu não pode voltar para ele.
    const db = banco({ mensagem: { direcao: "ENTRADA", status: "PENDENTE" } });
    const r = await entregarMensagem(db as never, "m1", "pessoa");

    expect(r).toMatchObject({ entregue: false, motivo: "naoEraParaEnviar" });
    expect(enviar).not.toHaveBeenCalled();
  });

  it("lead sem telefone vira FALHOU nomeado, e não uma tentativa cega", async () => {
    const db = banco({ mensagem: { lead: { whatsapp: null, optOutAt: null } } });
    const r = await entregarMensagem(db as never, "m1", "pessoa");

    expect(r).toMatchObject({ entregue: false, motivo: "semTelefone" });
    expect(enviar).not.toHaveBeenCalled();
  });

  it("mensagem que não existe é recusa nomeada, não exceção", async () => {
    const r = await entregarMensagem(banco({ mensagem: null }) as never, "sumiu", "pessoa");
    expect(r).toMatchObject({ entregue: false, motivo: "mensagemNaoExiste" });
  });
});
