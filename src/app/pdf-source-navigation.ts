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
  return sources.findIndex((source) => matchesPdfSource(source, requestedSourceId));
}

export function clampPdfPage(page: number, pageCount: number) {
  const normalizedPage = Number.isFinite(page) ? Math.trunc(page) : 1;
  return Math.max(1, Math.min(Math.max(1, pageCount), normalizedPage));
}
