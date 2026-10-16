import type { LearningUnit } from "@/lib/types";

export function normalizePdfEvidenceText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

export function matchesPdfEvidence(
  visibleText: string,
  sourceText: string,
  sourceRange: string,
) {
  const visible = normalizePdfEvidenceText(visibleText);
  const evidence = normalizePdfEvidenceText(sourceText || sourceRange);
  if (visible.length < 6 || evidence.length < 6) return false;
  if (evidence.includes(visible) || visible.includes(evidence)) return true;

  const visibleTokens = meaningfulTokens(visibleText);
  const evidenceTokens = meaningfulTokens(sourceText || sourceRange);
  if (visibleTokens.size < 3 || evidenceTokens.size < 3) return false;

  let sharedCount = 0;
  for (const token of visibleTokens) {
    if (evidenceTokens.has(token)) sharedCount += 1;
  }
  return sharedCount >= 3 && sharedCount / Math.min(
    visibleTokens.size,
    evidenceTokens.size,
  ) >= 0.7;
}

function meaningfulTokens(value: string) {
  return new Set(
    (value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter((token) => token.length >= 2),
  );
}

export function findPdfMaskTarget(
  visibleText: string,
  learningUnits: LearningUnit[],
) {
  return learningUnits.find((unit) =>
    matchesPdfEvidence(visibleText, unit.sourceText, unit.sourceRange),
  );
}
