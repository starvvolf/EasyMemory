import type { KnowledgeUnit } from "../../src/lib/types.ts";

export type EvidenceCheck = { learningUnitId: string; status: "원문 확인" | "원문 글자 없음" | "원문 PDF 없음"; quotes: string[] };

function normalized(value: string) {
  return value.normalize("NFKC")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/(\p{L})-\s+(\p{L})/gu, "$1$2")
    .replace(/\s+/g, "")
    .toLocaleLowerCase("ko-KR");
}

/** Multiple verbatim excerpts use ||; page labels are location metadata, not part of the quote. */
export function evidenceQuotes(sourceText: string) {
  return sourceText.split(/\s*\|\|\s*/).map((part) => part.trim()
    .replace(/\s*\(PDF\s+[\d, ]+쪽\)\.?\s*$/i, "")
    .replace(/^「|」$/g, "").trim()).filter(Boolean);
}

export function inspectSourceEvidence(
  units: readonly KnowledgeUnit[],
  pageTexts: ReadonlyMap<string, ReadonlyMap<number, string>>,
  sourcePages: ReadonlyMap<string, ReadonlyMap<string, number[]>>,
): EvidenceCheck[] {
  return units.map((unit) => {
    const quotes = evidenceQuotes(unit.sourceText);
    const pages = pageTexts.get(unit.sourceId);
    if (!pages) return { learningUnitId: unit.id, status: "원문 PDF 없음", quotes };
    const candidates = sourcePages.get(unit.sourceId)?.get(unit.id) ?? [unit.sourcePage];
    const texts = candidates.map((page) => pages.get(page) ?? "").filter((value) => normalized(value));
    if (!texts.length) return { learningUnitId: unit.id, status: "원문 글자 없음", quotes };
    if (!quotes.length) throw new Error(`${unit.id}의 근거에 PDF 실제 문구가 없습니다.`);
    for (const quote of quotes) {
      if (!texts.some((value) => normalized(value).includes(normalized(quote)))) {
        throw new Error(`${unit.id}의 근거가 해당 PDF 쪽의 실제 문구와 일치하지 않습니다: ${quote.slice(0, 90)}`);
      }
    }
    return { learningUnitId: unit.id, status: "원문 확인", quotes };
  });
}

export async function extractPdfPageTexts(bytes: Uint8Array, requestedPages: readonly number[]) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data: Uint8Array.from(bytes) }).promise;
  const result = new Map<number, string>();
  try {
    for (const pageNumber of [...new Set(requestedPages)]) {
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.numPages) continue;
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      result.set(pageNumber, content.items.map((item) => "str" in item ? item.str : "").join(" "));
      page.cleanup();
    }
  } finally { await document.cleanup(); }
  return result;
}
