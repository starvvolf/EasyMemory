// 의미 단위 (읽기 화면의 네모): which neighbouring words on a PDF line belong together, so pointing at "buffer" boxes
// "frame buffer" and pointing at "가치를" boxes "도덕적 가치". No model calls:
//  1. the material's own terms (designed objectives' recall, unit and heading titles, 용어 answers, phrases asked before),
//  2. otherwise simple rules (English: content words between function words and punctuation; Korean: words up to
//     the one carrying a particle).

const PARTICLE = /(은|는|이|가|을|를|의|에|에서|에게|으로|로|와|과|도|만|까지|부터|이다|이며|으로서|로서|처럼|보다)$/u;
const STOP = new Set(("a an the of in on at to for from by with and or but as is are was were be been being this that these those " +
  "it its into than then so such which who whom whose what when where how why not no also can may must should would will via per " +
  "along across through throughout without within between over under about after before during onto upon toward towards against among around " +
  "behind beyond like near off out up down all each every any some both their his her our your my they them we you he she").split(" "));
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

/** Phrase key → rank: 2 for terms (recall, answers, asked phrases, the core of a heading), 1 for whole headings. */
export type Lexicon = { keys: Map<string, number>; maxWords: number };
type LexiconDeck = {
  objectives?: Array<{ statement?: string }>;
  outline?: Array<{ title: string; objectives: Array<{ id: string; recall?: string; part?: string; kind?: string }> }>;
  items?: Array<{ objectiveId: string; format: string; answer?: unknown }>;
};

/** Short phrases only: a term, a heading, an asked phrase. Sentences and formulas are not units. */
function phrases(text: string, heading = false): Array<{ text: string; rank: number }> {
  const one = String(text ?? "").replace(/\$[^$]*\$/g, " ").replace(/\s+/g, " ").trim();
  // A sentence ("…한다", "…이에요", "…함.") is not a unit; a noun ending in 요 ("개요") is.
  if (!one || one.length > 48 || /(다|니다|어요|아요|에요|세요|해요|됨|함)\.?$/.test(one) || one.split(" ").length > 6) return [];
  const out = [{ text: one, rank: heading ? 1 : 2 }];
  // Headings carry the core term inside: "Kohlberg의 인지적 도덕 발달 이론 개요" → "인지적 도덕 발달 이론" too.
  const core = one.replace(/^\S+의\s+/u, "").replace(/\s*(의\s*)?(개요|한계점|한계|종류|정의|특징|방법|구성|구조|예시|예|비교|요약|정리|소개)$/u, "").replace(/^\d+[.)]?\s*/, "").trim();
  if (core && core !== one && core.split(" ").length >= 2) out.push({ text: core, rank: 2 });
  const noOwner = one.replace(/\s*(의\s*)?(개요|한계점|한계|종류|정의|특징|방법|구성|예시|요약|정리|소개)$/u, "").trim();
  if (noOwner && noOwner !== one && noOwner !== core) out.push({ text: noOwner, rank: 1 });
  // "통제 위치(Locus of Control)" → also each side alone.
  const paren = /^(.+?)\s*[(（]([^)）]+)[)）]\s*$/.exec(one);
  if (paren) out.push({ text: paren[1].trim(), rank: out[0].rank }, { text: paren[2].trim(), rank: out[0].rank });
  // "Raster-scan displays: ..." style headings → the part before a colon.
  if (one.includes(":")) out.push({ text: one.split(":")[0].trim(), rank: out[0].rank });
  return out.filter((phrase) => keyOf(phrase.text).length >= 2);
}

export function buildLexicon(deck: LexiconDeck, extra: string[] = []): Lexicon {
  const keys = new Map<string, number>();
  let maxWords = 1;
  const add = (text: string, heading = false) => {
    for (const phrase of phrases(text, heading)) {
      const words = phrase.text.split(/\s+/).length;
      if (words < 2 && !/[-‐]/.test(phrase.text) && !hangul(phrase.text)) continue;   // one plain English word adds nothing
      const key = keyOf(phrase.text);
      keys.set(key, Math.max(keys.get(key) ?? 0, phrase.rank));
      maxWords = Math.max(maxWords, Math.min(8, words + 1));
    }
  };
  const kinds = new Map<string, string | undefined>();
  for (const section of deck.outline ?? []) {
    add(section.title, true);
    for (const objective of section.objectives) { if (objective.recall) add(objective.recall); if (objective.part) add(objective.part, true); kinds.set(objective.id, objective.kind); }
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
    let best: Chunk | null = null, bestRank = 0;
    for (let start = Math.max(0, index - lexicon.maxWords + 1); start <= index; start++) {
      for (let end = index; end < Math.min(words.length, start + lexicon.maxWords); end++) {
        const span = words.slice(start, end + 1);
        const joined = keyOf(span.join(" "));
        const withoutParticle = keyOf([...span.slice(0, -1), stripParticle(span[span.length - 1])].join(" "));
        const rank = Math.max(lexicon.keys.get(joined) ?? 0, lexicon.keys.get(withoutParticle) ?? 0);
        // A term beats a whole heading; among equals, the longer one.
        if (rank && (!best || rank > bestRank || (rank === bestRank && end - start > best.end - best.start))) { best = { start, end, kind: "term" }; bestRank = rank; }
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
