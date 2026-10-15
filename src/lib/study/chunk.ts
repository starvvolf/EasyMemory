// 의미 단위 (읽기 화면의 네모): which neighbouring words on a PDF line belong together, so pointing at "buffer" boxes
// "frame buffer" and pointing at "가치를" boxes "도덕적 가치". No model calls:
//  1. the material's own terms (designed objectives' recall, unit and heading titles, 용어 answers, phrases asked before),
//  2. otherwise simple rules (English: content words between function words and punctuation; Korean: words up to
//     the one carrying a particle).

const PARTICLE = /(은|는|이|가|을|를|의|에|에서|에게|으로|로|와|과|도|만|까지|부터|이다|이며|으로서|로서|처럼|보다)$/u;
const STOP = new Set(("a an the of in on at to for from by with and or but as is are was were be been being this that these those " +
  "it its into than then so such which who whom whose what when where how why not no also can may must should would will via per").split(" "));
const EDGE = /^[\s"'“”‘’()[\]{}<>.,:;!?·•–—-]+|[\s"'“”‘’()[\]{}<>.,:;!?·•–—-]+$/gu;
const BREAK_AFTER = /[,.;:!?)\]」』]$/u;   // a token ending like this closes a unit
const BREAK_BEFORE = /^[([「『]/u;          // a token starting like this opens a new one

export const keyOf = (text: string) => text.normalize("NFKC").toLowerCase().replace(EDGE, "").replace(/[\s\-‐-―_·]+/g, "");
const bare = (token: string) => token.normalize("NFKC").replace(EDGE, "");
const hangul = (text: string) => /[가-힣]/.test(text);
const stripParticle = (token: string) => {
  const word = bare(token);
  return hangul(word) && word.length > 1 ? word.replace(PARTICLE, "") || word : word;
};

export type Lexicon = { keys: Set<string>; maxWords: number };
type LexiconDeck = {
  objectives?: Array<{ statement?: string }>;
  outline?: Array<{ title: string; objectives: Array<{ id: string; recall?: string; part?: string; kind?: string }> }>;
  items?: Array<{ objectiveId: string; format: string; answer?: unknown }>;
};

/** Short phrases only: a term, a heading, an asked phrase. Sentences and formulas are not units. */
function phrases(text: string): string[] {
  const one = String(text ?? "").replace(/\$[^$]*\$/g, " ").replace(/\s+/g, " ").trim();
  if (!one || one.length > 48 || /[다요]\.?$/.test(one) || one.split(" ").length > 6) return [];
  const out = [one];
  // "통제 위치(Locus of Control)" → also each side alone.
  const paren = /^(.+?)\s*[(（]([^)）]+)[)）]\s*$/.exec(one);
  if (paren) out.push(paren[1].trim(), paren[2].trim());
  // "Raster-scan displays: ..." style headings → the part before a colon.
  if (one.includes(":")) out.push(one.split(":")[0].trim());
  return out.filter((phrase) => keyOf(phrase).length >= 2);
}

export function buildLexicon(deck: LexiconDeck, extra: string[] = []): Lexicon {
  const keys = new Set<string>();
  let maxWords = 1;
  const add = (text: string) => {
    for (const phrase of phrases(text)) {
      const words = phrase.split(/\s+/).length;
      if (words < 2 && !/[-‐]/.test(phrase) && !hangul(phrase)) continue;   // one plain English word adds nothing
      keys.add(keyOf(phrase));
      maxWords = Math.max(maxWords, Math.min(8, words + 1));
    }
  };
  const kinds = new Map<string, string | undefined>();
  for (const section of deck.outline ?? []) {
    add(section.title);
    for (const objective of section.objectives) { if (objective.recall) add(objective.recall); if (objective.part) add(objective.part); kinds.set(objective.id, objective.kind); }
  }
  for (const item of deck.items ?? []) if (item.format === "card" && kinds.get(item.objectiveId) === "용어") add(String(item.answer ?? ""));
  for (const phrase of extra) add(phrase);
  return { keys, maxWords };
}

export type Chunk = { start: number; end: number; kind: "term" | "phrase" | "word" };

/**
 * The unit around word `index` of a line (`words` in reading order, as on the page). `end` is inclusive.
 * A term from the lexicon wins (longest first); otherwise the rule-based phrase; otherwise the word itself.
 */
export function chunkAt(words: string[], index: number, lexicon?: Lexicon): Chunk {
  const chunk = findChunk(words, index, lexicon);
  // Bullets, dashes and lone brackets never start or end a unit ("• Cathode-Ray Tubes" → "Cathode-Ray Tubes").
  while (chunk.start < index && !bare(words[chunk.start])) chunk.start++;
  while (chunk.end > index && !bare(words[chunk.end])) chunk.end--;
  return chunk;
}
function findChunk(words: string[], index: number, lexicon?: Lexicon): Chunk {
  if (index < 0 || index >= words.length) return { start: index, end: index, kind: "word" };
  if (lexicon?.keys.size) {
    let best: Chunk | null = null;
    for (let start = Math.max(0, index - lexicon.maxWords + 1); start <= index; start++) {
      for (let end = index; end < Math.min(words.length, start + lexicon.maxWords); end++) {
        const span = words.slice(start, end + 1);
        const joined = keyOf(span.join(" "));
        const withoutParticle = keyOf([...span.slice(0, -1), stripParticle(span[span.length - 1])].join(" "));
        if (lexicon.keys.has(joined) || lexicon.keys.has(withoutParticle)) {
          if (!best || end - start > best.end - best.start) best = { start, end, kind: "term" };
        }
      }
    }
    if (best && best.end > best.start) return best;
    if (best && hangul(words[index])) return best;
  }
  return ruleChunk(words, index);
}

function ruleChunk(words: string[], index: number): Chunk {
  const word = bare(words[index]);
  if (!word) return { start: index, end: index, kind: "word" };
  if (hangul(word)) {
    // Korean: words without a particle lead into the next one; the word with the particle ends the unit.
    const open = (k: number) => k >= 0 && hangul(words[k]) && !BREAK_AFTER.test(words[k]) && !PARTICLE.test(bare(words[k])) && bare(words[k]).length > 0;
    let start = index, end = index;
    while (start - 1 >= 0 && index - start < 2 && open(start - 1) && !BREAK_BEFORE.test(words[start])) start--;
    while (end + 1 < words.length && end - index < 2 && open(end) && hangul(words[end + 1]) && !BREAK_BEFORE.test(words[end + 1])) end++;
    return { start, end, kind: end > start ? "phrase" : "word" };
  }
  // English (and other Latin script): neighbouring content words, not across function words or punctuation.
  // Verb forms ("produced", "holding") end a noun phrase rather than join it.
  const content = (k: number) => { const w = bare(words[k] ?? ""); return !!w && !hangul(w) && /[\p{L}\p{N}]/u.test(w) && !STOP.has(w.toLowerCase()) && !(/^[a-z]{3,}(ed|ing)$/.test(w)); };
  if (!content(index)) return { start: index, end: index, kind: "word" };
  let start = index, end = index;
  while (start - 1 >= 0 && index - start < 3 && content(start - 1) && !BREAK_AFTER.test(words[start - 1]) && !BREAK_BEFORE.test(words[start])) start--;
  while (end + 1 < words.length && end - start < 3 && content(end + 1) && !BREAK_AFTER.test(words[end]) && !BREAK_BEFORE.test(words[end + 1])) end++;
  return { start, end, kind: end > start ? "phrase" : "word" };
}
