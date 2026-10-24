// 용어 목록 (recaller 전처리, 2026-10-24): the names a material uses for its concepts and symbols, pulled by code from the
// prepared page text, so every page's organizing calls them the same way (pages are organized apart, for speed) and
// cards about the same thing can be told apart from cards that only look alike.

export type Term = { name: string; symbol: string; pages: number[] };

const HEADS = "vector|point|plane|axis|axes|parameter|normal|origin|matrix|frame|buffer|coordinates?|system|direction|position|transformation|projection|method|algorithm|test|surface|polygon|value";
const LEAD = /^(?:a|an|the|this|that|additional|some|each|any|our)\s+/i;
// Words that start a phrase before the term itself ("Specify a view-up vector", "with a view-plane normal vector").
const STOP = new Set(["a", "an", "the", "this", "that", "additional", "some", "each", "any", "our", "specify", "select", "define", "defined", "with", "to", "from", "for", "of", "by", "using", "set", "or", "and", "is", "are", "use", "uses", "getting", "into", "onto", "at", "in", "on", "as", "be", "can", "should", "we", "need", "it"]);
const clean = (s: string) => s.replace(/\*+/g, "").replace(/\s+/g, " ").trim();
const keyOf = (name: string) => clean(name).toLowerCase().replace(LEAD, "").replace(/[^\p{L}\p{N}]+/gu, "");

/** Term candidates from page texts (structured lines, page readings, and the [색 강조] line). */
export function extractTerms(texts: Map<number, string> | Record<string, string>, limit = 40): Term[] {
  const entries = texts instanceof Map ? [...texts] : Object.entries(texts).map(([k, v]) => [Number(k), v] as [number, string]);
  const found = new Map<string, Term & { hits: number }>();
  const add = (rawName: string, rawSymbol: string, page: number) => {
    let symbol = rawSymbol;
    const words = clean(rawName).split(" ");
    let from = 0;
    for (let i = 0; i < words.length; i++) if (STOP.has(words[i].toLowerCase())) from = i + 1;
    const name = words.slice(from).slice(-4).join(" ");
    if (name.length < 3 || name.length > 60 || !/\p{L}/u.test(name)) return;
    // A symbol is a name like V, N, P_0, z_{vp}; an expression ("P_0=(x_0,…)", "a=,\quad b=") is not.
    symbol = symbol.split("=")[0].trim();
    if (!/^[A-Za-z](?:_\{?[A-Za-z0-9]+\}?|[A-Za-z0-9]{0,2})?$/.test(symbol)) symbol = "";
    const key = keyOf(name);
    if (!key) return;
    const t = found.get(key) ?? { name, symbol: "", pages: [], hits: 0 };
    if (symbol && !t.symbol) t.symbol = symbol;
    if (!t.pages.includes(page)) t.pages.push(page);
    t.hits++;
    found.set(key, t);
  };
  for (const [page, text] of entries) {
    // "a view-up vector $V$", "a reference (look-at) point $P_{ref}$"
    const bare = text.replace(/\s*\([^()$]{1,30}\)/g, "");
    for (const m of bare.matchAll(new RegExp(`((?:[A-Za-z][\\w-]*\\s+){0,5}(?:${HEADS}))\\s+\\$([^$]{1,14})\\$`, "gi"))) add(m[1], m[2], page);
    // "$P_0=(x_0,y_0,z_0)$ for the viewing origin"
    for (const m of text.matchAll(/\$([A-Za-z][^$=]{0,10})(?:=[^$]*)?\$\s+for the ([a-z][\w-]*(?:\s[a-z][\w-]*){0,3})/g)) add(m[2], m[1], page);
    for (const line of text.split("\n")) {
      // A short title-case bullet with no verb is a heading inside the slide: "- The View-Up Vector".
      const head = /^\s*-\s+(?:The\s+)?\*?([A-Z][\w*-]*(?:\s+[A-Z*][\w*-]*){0,4})\*?\s*$/.exec(line);
      if (head) add(head[1], "", page);
      // Korean name with its English one: "투영 변환(Projection Transformation)"
      // Only the one word right before the bracket ("크게 휘발성(Volatile)" → 휘발성), particles left out.
      for (const m of line.matchAll(/([가-힣]{2,10})\s*\(([A-Za-z][A-Za-z\s-]{2,40})\)/g)) add(`${m[2].trim()} (${m[1]})`, "", page);
      const emph = /^\[색 강조\]\s*(.+)$/.exec(line);
      if (emph) for (const part of emph[1].split(" · ")) { const t = part.replace(/^[^:]+:\s*/, ""); if (t.length <= 40) add(t, "", page); }
    }
    const title = /^#\s+(.+)$/m.exec(text)?.[1];
    if (title) add(title, "", page);
  }
  return [...found.values()].sort((a, b) => b.hits - a.hits || a.pages[0] - b.pages[0]).slice(0, limit).map(({ name, symbol, pages }) => ({ name, symbol, pages: pages.sort((x, y) => x - y) }));
}

export function termLines(terms: Term[]) {
  return terms.map((t) => `${t.name}${t.symbol ? ` (${t.symbol})` : ""}`);
}

const bigrams = (s: string) => { const t = s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ""); const out = new Set<string>(); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; };
export function similarity(a: string, b: string) {
  const x = bigrams(a), y = bigrams(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const g of x) if (y.has(g)) both++;
  return both / (x.size + y.size - both);
}

/**
 * Whether two cards are about the same thing: the same title (written apart only by spacing or case), or the same
 * mistake nearly word for word. Close is not enough: "n-type Extrinsic" and "p-type Extrinsic" differ in one letter
 * and are different knowledge (반도체 3주차 p.4).
 */
export function sameKnowledge(a: { title: string; mistakes: string[] }, b: { title: string; mistakes: string[] }) {
  const t = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
  if (t(a.title) && t(a.title) === t(b.title)) return true;
  return a.mistakes.some((m) => b.mistakes.some((n) => similarity(m, n) >= 0.85));
}
