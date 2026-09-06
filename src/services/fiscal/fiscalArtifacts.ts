/**
 * Efeitos colaterais quando a NFC-e é AUTORIZADA:
 *   1. imprime a DANFCE na impressora do caixa (via PrintJob, mesmo canal da
 *      comanda — o agente Carteiro imprime o `body` verbatim);
 *   2. espelha o XML + PDF do gateway no S3 (retenção legal), trocando as URLs
 *      transitórias do gateway pelas URLs duráveis do bucket.
 *
 * Tudo best-effort: se não há impressora de caixa, ou o S3 não está configurado,
 * a emissão segue normal — só não imprime/arquiva.
 */

import { prisma } from "@/lib/prisma";
import { escapeNulForPg } from "@/lib/pg-text";
import { uploadToS3 } from "@/lib/s3";
import type { FiscalDocument } from "@prisma/client";

// Mesmo perfil universal das comandas: negrito (escurece) + corte função A (universal).
const INIT = "\x1b\x40";
const EMPHASIS_ON = "\x1b\x45\x01\x1b\x47\x01";
const EMPHASIS_OFF = "\x1b\x45\x00\x1b\x47\x00";
const CUT = "\n\n\n\n\n\n\x1d\x56\x00"; // avanço + corte total (função A)
const RULE = "-".repeat(48);

/** Corpo (texto/ESC-POS) da DANFCE para a térmica de 48 colunas. Pure. */
export function renderDanfceBody(doc: FiscalDocument): string {
  const L: string[] = [];
  L.push("DOCUMENTO AUXILIAR DA NFC-e");
  L.push(RULE);
  if (doc.numero) L.push(`Numero: ${doc.numero}   Serie: ${doc.serie ?? "-"}`);
  L.push(`Emissao: ${(doc.emitidaAt ?? doc.createdAt).toLocaleString("pt-BR")}`);
  if (doc.valorTotal != null) L.push(`Valor total: R$ ${Number(doc.valorTotal).toFixed(2)}`);
  L.push(RULE);
  if (doc.chave) {
    L.push("Chave de acesso:");
    L.push(doc.chave.replace(/(.{4})/g, "$1 ").trim());
  }
  if (doc.protocolo) L.push(`Protocolo: ${doc.protocolo}`);
  L.push(RULE);
  L.push("Consulte a NFC-e pela chave em:");
  L.push(doc.urlConsulta ?? doc.qrCodeData ?? "portal da SEFAZ do seu estado");
  L.push(RULE);
  L.push("Consumidor: leia o QR da NFC-e no");
  L.push("app da SEFAZ usando a chave acima.");
  L.push("");
  return INIT + EMPHASIS_ON + L.join("\n") + EMPHASIS_OFF + CUT;
}

/** Enfileira a impressão da DANFCE no caixa (CAIXA/CUPOM). No-op sem impressora. */
export async function enqueueDanfcePrint(restaurantId: string, doc: FiscalDocument): Promise<void> {
  const station = await prisma.printStation.findFirst({
    where: { restaurantId, key: { in: ["CAIXA", "CUPOM"] }, enabled: true, printerName: { not: null } },
    orderBy: { position: "asc" },
  });
  if (!station?.printerName) return;
  await prisma.printJob.create({
    data: {
      restaurantId,
      orderId: doc.orderId,
      stationKey: station.key,
      printerName: station.printerName,
      title: `NFC-e ${doc.numero ?? ""}`.trim(),
      // Mesmo defeito da comanda, mesma cura: o corpo é ESC/POS e carrega 0x00,
      // que o Postgres recusa em texto. Guardado escapado; a rota do Carteiro
      // (api/print-agent/poll) desfaz. Ver src/lib/pg-text.ts.
      body: escapeNulForPg(renderDanfceBody(doc)),
    },
  });
}

async function fetchToBuffer(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

const isS3 = (u: string | null): boolean => !!u && u.includes("amazonaws.com");

/** Baixa XML+DANFCE do gateway e espelha no S3. Best-effort; devolve as URLs novas. */
export async function mirrorFiscalArtifacts(doc: FiscalDocument): Promise<{ xmlUrl?: string; danfceUrl?: string }> {
  const out: { xmlUrl?: string; danfceUrl?: string } = {};
  const base = `restaurants/${doc.restaurantId}/fiscal/${doc.chave ?? doc.id}`;
  if (doc.xmlUrl && !isS3(doc.xmlUrl)) {
    const buf = await fetchToBuffer(doc.xmlUrl);
    if (buf) {
      try {
        out.xmlUrl = await uploadToS3(buf, `${base}.xml`, "application/xml");
      } catch {
        /* S3 não configurado — mantém a URL do gateway */
      }
    }
  }
  if (doc.danfceUrl && !isS3(doc.danfceUrl)) {
    const buf = await fetchToBuffer(doc.danfceUrl);
    if (buf) {
      try {
        out.danfceUrl = await uploadToS3(buf, `${base}.pdf`, "application/pdf");
      } catch {
        /* idem */
      }
    }
  }
  return out;
}
