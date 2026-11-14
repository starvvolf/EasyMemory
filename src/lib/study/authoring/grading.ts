// Keep this function self-contained: the renderer embeds its source in the preview.
export function normalizeExactAnswer(value: string) {
  return value.replace(/[\u0027\u0060\u00b4]/g, "\u2032").replace(/\u207b\u00b9/g, "^-1").normalize("NFKC")
    .replace(/[\u2212\u2010-\u2015]/g, "-")
    .replace(/\^\{-1\}/g, "^-1")
    .replace(/\s+/g, "")
    .toLocaleLowerCase("ko-KR");
}
