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

/** Whether a verbatim quote appears in a page's extracted text (spacing, hyphen breaks, dashes, case and quote marks ignored). */
export function containsQuote(text: string, quote: string) {
  const strip = (value: string) => normalized(value).replace(/[“”‘’"'`]/g, "");
  const needle = strip(quote);
  return needle.length >= 4 && strip(text).includes(needle);
}

/**
 * A card quotes its learning unit's evidence, which may hold several ||-separated excerpts with page labels.
 * Each excerpt of the card's basis must sit inside one of the unit's excerpts. Same splitting and
 * normalisation as the learning-design check, so a quote that passed there is not rejected here.
 * Returns the first excerpt that is not found, or null when every excerpt is found.
 */
export function unmatchedEvidenceExcerpt(unitSourceText: string, basis: string): string | null {
  const strip = (value: string) => normalized(value).replace(/[“”‘’"'`]/g, "");
  const allowed = evidenceQuotes(unitSourceText).map(strip);
  const parts = evidenceQuotes(basis);
  if (!parts.length) return basis.trim() || "(빈 근거)";
  for (const part of parts) {
    const value = strip(part);
    if (value.length < 4 || !allowed.some((quote) => quote.includes(value))) return part;
  }
  return null;
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
