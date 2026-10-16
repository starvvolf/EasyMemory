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
export type Lexicon = { keys: Map<string, number>; maxWords: number; /** key → the phrase as written, for showing the list */ labels: Map<string, string> };
type LexiconDeck = {
  objectives?: Array<{ statement?: string }>;
  outline?: Array<{ title: string; objectives: Array<{ id: string; recall?: string; part?: string; kind?: string }> }>;
  items?: Array<{ objectiveId: string; format: string; answer?: unknown }>;
};

/** Short phrases only: a term, a heading, an asked phrase. Sentences and formulas are not units. */
function phrases(text: string, heading = false): Array<{ text: string; rank: number }> {
  const raw = String(text ?? "");
  if (/\$|\\\(|\\\[/.test(raw)) return [];   // a formula is not a phrase (removing it left "D Composite …")
  const one = raw.replace(/\s+/g, " ").trim().replace(/\?$/, "");
  // A sentence ("…한다", "…이에요", "…함.") is not a unit; a noun ending in 요 ("개요") is.
  if (!one || one.length > 48 || /(다|니다|어요|아요|에요|세요|해요|됨|함)\.?$/.test(one) || one.split(" ").length > 6) return [];
  // A term (not a heading) is a short noun phrase: no list, no quote, no subject/object particle in the middle
  // ("윤리적 판단이 필수적", "고객, 협력업체, 지역사회" and the like are answers, not terms).
  if (!heading) {
    const words = one.split(" ");
    if (words.length > 4 || /[,'"‘’“”?]/.test(one)) return [];
    if (words.slice(0, -1).some((word) => hangul(word) && /(이|가|을|를|은|는|에|에서|으로|로|하는|되는|한|된)$/.test(word))) return [];
  }
  const out = [{ text: one, rank: heading ? 1 : 2 }];
  // Headings carry the core term inside: "Kohlberg의 인지적 도덕 발달 이론 개요" → "인지적 도덕 발달 이론" too.
  const core = one.replace(/^\S+의\s+/u, "").replace(/\s*(의\s*)?(개요|한계점|한계|종류|정의|특징|방법|구성|구조|예시|예|비교|요약|정리|소개)$/u, "").replace(/^\d+[.)]\s*/, "").trim();   // "02. 개인의 …" numbering only, not "2D …" or "3대 …"
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
  const labels = new Map<string, string>();
  let maxWords = 1;
  const add = (text: string, heading = false) => {
    for (const phrase of phrases(text, heading)) {
      const words = phrase.text.split(/\s+/).length;
      if (words < 2 && !/[-‐]/.test(phrase.text) && !hangul(phrase.text)) continue;   // one plain English word adds nothing
      const key = keyOf(phrase.text);
      keys.set(key, Math.max(keys.get(key) ?? 0, phrase.rank));
      if (!labels.has(key)) labels.set(key, phrase.text);
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
  return { keys, maxWords, labels };
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

/* ---------------------------------------------------------------- important terms (reader highlight) */
type ImportanceDeck = {
  outline?: Array<{ title: string; objectives: Array<{ id: string; cue?: string; recall?: string; kind?: string; importance?: "core" | "support" }> }>;
  items?: Array<{ objectiveId: string; format: string; answer?: unknown }>;
};
const TERM_KINDS = new Set(["용어", "개념"]);
/** `text` reads as a description next to `other`: a Korean phrase with 의/당/하는/되는, or Korean against an English name. */
const describes = (text: string, other: string) => /(의|당|하는|되는|한|된)\s/.test(text + " ") || (hangul(text) && !hangul(other) && /[A-Za-z]/.test(other));
/**
 * The term names inside an objective's cue or recall: the text itself when it is a term ("Scan line", "앵커링 효과"),
 * the part before a colon ("준법 경영 (Compliance): …"), X of "X의 정의/범위/…", and English names inside Korean
 * sentences ("Shadow-mask methods가 이용하는 …" → "Shadow-mask methods").
 */
export function termCandidates(text: string, whole = true): string[] {
  const plain = String(text ?? "").replace(/\$[^$]*\$/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return [];
  const out = whole ? [plain] : [];
  const colon = /^([^:：]{2,40})[:：]/.exec(plain); if (colon) out.push(colon[1].trim());
  const aspect = /^(.{2,30}?)의\s*(정의|범위|개념|종류|특징|의미|역할|목적|원칙|유형|구성 요소|요소|조건|기능|장점|단점|한계)$/u.exec(plain); if (aspect) out.push(aspect[1].trim());
  // English names inside Korean text; digits stay attached ("3D viewer"), a leading article goes, and a lone
  // lowercase word ("red", "pixels") is too common to mark.
  if (hangul(plain)) for (const m of plain.matchAll(/(?<![A-Za-z0-9])[0-9]*[A-Za-z][A-Za-z0-9\-]*(?:\s+[A-Za-z][A-Za-z0-9\-]*){0,3}/g)) {
    const name = m[0].trim().replace(/^(a|an|the)\s+/i, "");
    const single = !/\s/.test(name);
    if (name.length >= 3 && !STOP.has(name.toLowerCase()) && !(single && /^[a-z]/.test(name))) out.push(name);
  }
  return out;
}
/**
 * Terms worth seeing at a glance: what core objectives of kind 용어·개념 ask to recall, and the answers of their
 * flashcards, when those are short noun phrases (the same filter as the lexicon). One word counts here
 * ("윤리경영", "Intensity"); support objectives and headings do not.
 */
export function importantTerms(deck: ImportanceDeck): Lexicon {
  const keys = new Map<string, number>(), labels = new Map<string, string>();
  let maxWords = 1;
  const core = new Map<string, boolean>();
  const definitionSide = new Map<string, boolean>();
  const add = (text: string) => {
    for (const phrase of phrases(text)) {
      const key = keyOf(phrase.text);
      if (key.length < 2 || (!hangul(phrase.text) && key.length < 3)) continue;
      keys.set(key, 2); if (!labels.has(key)) labels.set(key, phrase.text);
      maxWords = Math.max(maxWords, Math.min(6, phrase.text.split(/\s+/).length));
    }
  };
  for (const section of deck.outline ?? []) for (const objective of section.objectives) {
    const important = objective.importance !== "support" && TERM_KINDS.has(objective.kind ?? "");
    core.set(objective.id, important);
    // A 용어 objective goes one of two ways: name → definition ("Scan line" → "각 행") or definition → name
    // ("빛 에너지의 물리적 측정값" → "Intensity"). Only the name side is a term to mark. A Korean term with an
    // English gloss ("도덕적 지각(Moral Awareness)") is a term in any cue.
    if (important) {
      const cue = objective.cue ?? "", recall = objective.recall ?? "";
      let cueTerm = phrases(cue).length > 0 && (objective.kind === "용어" || /^[^()（）]+[(（][A-Za-z][^)）]*[)）]$/.test(cue.trim()));
      let recallTerm = true;
      if (objective.kind === "용어" && cueTerm){
        const dc = describes(cue, recall), dr = describes(recall, cue);
        if (dc && !dr) cueTerm = false; else if (dr && !dc) recallTerm = false;
      }
      definitionSide.set(objective.id, !recallTerm);
      for (const candidate of termCandidates(cue, cueTerm)) add(candidate);
      for (const candidate of termCandidates(recall, recallTerm)) add(candidate);
    }
  }
  // Flashcard backs repeat the recall: only when the recall side is the name.
  for (const item of deck.items ?? []) if (item.format === "card" && core.get(item.objectiveId) && !definitionSide.get(item.objectiveId)) add(String(item.answer ?? ""));
  return { keys, maxWords, labels };
}
/** Every place on a line where an important term is written (longest first, no overlaps). */
export function findTerms(words: string[], terms: Lexicon): Array<{ start: number; end: number }> {
  const found: Array<{ start: number; end: number }> = [];
  if (!terms.keys.size) return found;
  for (let start = 0; start < words.length; start++) {
    if (!bare(words[start])) continue;
    for (let end = Math.min(words.length - 1, start + terms.maxWords - 1); end >= start; end--) {
      const span = words.slice(start, end + 1);
      const hit = terms.keys.has(keyOf(span.join(" "))) || terms.keys.has(keyOf([...span.slice(0, -1), stripParticle(span[span.length - 1])].join(" ")));
      if (hit) { found.push({ start, end }); start = end; break; }
    }
  }
  return found;
}
