// A Baekjoon problem's original from the Internet Archive (BOJ itself is closed, docs/DECISIONS.md 2026-10-26): the
// archived page parsed by its element ids, so the statement and examples are the page's own text, not a model's copy.
import type { TestCase } from "./run.ts";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export type Original = { url: string; title: string; statement: string; inputText: string; outputText: string; examples: TestCase[] };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", le: "≤", ge: "≥", ne: "≠", times: "×", middot: "·", hellip: "…", rarr: "→", larr: "←" };
export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name: string) => {
    if (name[0] === "#") { const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10); return Number.isFinite(code) ? String.fromCodePoint(code) : all; }
    return ENTITIES[name.toLowerCase()] ?? all;
  });
}
/** HTML → plain text that keeps lines and exponents (10<sup>6</sup> → 10^6). */
export function htmlToText(html: string) {
  return decodeEntities(html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<sup>\s*([^<]*?)\s*<\/sup>/gi, "^$1").replace(/<sub>\s*([^<]*?)\s*<\/sub>/gi, "_$1")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h[1-6]|pre|section|table|blockquote)>/gi, "\n").replace(/<(td|th)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, ""))
    .replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The Internet Archive copy of a page, when one exists (raw page, no archive toolbar). The "closest copy" lookup
 * sometimes answers empty for pages that are there, so the list of copies (CDX) is asked next — it also covers the
 * address with and without "www.".
 */
export async function archivedUrl(url: string, fetcher: Fetcher = fetch) {
  try {
    const response = await fetcher(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(20_000) });
    if (response.ok) {
      const data = await response.json() as { archived_snapshots?: { closest?: { available?: boolean; status?: string; timestamp?: string } } };
      const closest = data.archived_snapshots?.closest;
      if (closest?.available && closest.status === "200" && closest.timestamp) return `https://web.archive.org/web/${closest.timestamp}id_/${url}`;
    }
  } catch { /* try the list */ }
  const bare = url.replace(/^https?:\/\/(www\.)?/i, "");
  try {
    const response = await fetcher(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(bare)}&output=json&filter=statuscode:200&limit=-3&fl=timestamp,original`, { signal: AbortSignal.timeout(25_000) });
    if (!response.ok) return null;
    const rows = (await response.json().catch(() => [])) as string[][];
    const last = rows.filter((r) => /^\d{14}$/.test(r[0] ?? "")).at(-1);
    return last ? `https://web.archive.org/web/${last[0]}id_/${last[1]}` : null;
  } catch { return null; }
}

const section = (html: string, id: string) => new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</(?:div|section|pre)>`).exec(html)?.[1] ?? "";
/** Reads statement, input, output and examples out of a Baekjoon problem page. Null when the page has no statement or example. */
export function parseBojPage(html: string, url: string): Original | null {
  const examples: TestCase[] = [];
  for (let k = 1; k <= 10; k++) {
    const input = section(html, `sample-input-${k}`), output = section(html, `sample-output-${k}`);
    if (!input && !output) break;
    examples.push({ input: decodeEntities(input.replace(/<[^>]+>/g, "")), output: decodeEntities(output.replace(/<[^>]+>/g, "")) });
  }
  const statement = htmlToText(section(html, "problem_description"));
  if (!statement || !examples.length) return null;
  const title = htmlToText(/id="problem_title"[^>]*>([\s\S]*?)</.exec(html)?.[1] ?? "") || htmlToText(/<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? "").replace(/^\d+번:\s*/, "");
  return { url, title, statement, inputText: htmlToText(section(html, "problem_input")), outputText: htmlToText(section(html, "problem_output")), examples };
}

export async function archivedBojProblem(number: string, fetcher: Fetcher = fetch): Promise<Original | null> {
  const url = await archivedUrl(`https://www.acmicpc.net/problem/${number}`, fetcher);
  if (!url) return null;
  const response = await fetcher(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) return null;
  return parseBojPage(await response.text(), url);
}
