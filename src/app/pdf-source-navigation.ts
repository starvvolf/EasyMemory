export type PdfSourceIdentity = {
  id?: string;
  fileName: string;
};

export function normalizePdfFileName(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\\/g, "/")
    .split("/")
    .at(-1)
    ?.toLocaleLowerCase() ?? "";
}

export function matchesPdfSource(
  source: PdfSourceIdentity,
  requestedSourceId: string,
) {
  if (!requestedSourceId) return false;
  if (source.id === requestedSourceId) return true;
  return normalizePdfFileName(source.fileName) === normalizePdfFileName(requestedSourceId);
}

export function findExactPdfSourceIndex(
  sources: PdfSourceIdentity[],
  requestedSourceId: string,
) {
  const idIndex = sources.findIndex((source) => source.id === requestedSourceId);
  if (idIndex >= 0) return idIndex;

  const normalizedRequest = normalizePdfFileName(requestedSourceId);
  const fileNameMatches = sources
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => normalizePdfFileName(source.fileName) === normalizedRequest);
  return fileNameMatches.length === 1 ? fileNameMatches[0].index : -1;
}

export function clampPdfPage(page: number, pageCount: number) {
  const normalizedPage = Number.isFinite(page) ? Math.trunc(page) : 1;
  return Math.max(1, Math.min(Math.max(1, pageCount), normalizedPage));
}
