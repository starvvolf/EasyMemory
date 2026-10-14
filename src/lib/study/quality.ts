// 빠른 고리 (docs/품질_자동화.md): fixes to the learner's own questions made while studying, at no model cost.
// A fix is a patch laid over the authored document (the document itself never changes), so question IDs and study
// records stay, and every fix can be undone. Each signal and fix is also one line in the quality ledger (장부),
// which the slow loop reads to propose changes to 출제기준·학습규칙.

/* ---------------------------------------------------------------- patches */
export type StudyPatch =
  | { id: string; at: string; kind: "accept"; itemId: string; answer: string }
  | { id: string; at: string; kind: "card"; itemId: string };
export type PatchMap = Record<string, StudyPatch[]>;
type PatchableItem = { id: string; format: string; accepted?: string[]; answer?: number | string };

/**
 * Lays a deck's patches over its items (in place order): "accept" adds an accepted answer to a value question,
 * "card" turns a value question into a flashcard whose back is the accepted answers. Unknown items are skipped.
 */
export function applyPatches<T extends { items: PatchableItem[] }>(deck: T, patches: StudyPatch[] | undefined, show: (text: string) => string = (text) => text): T {
  if (!patches?.length) return deck;
  const byId = new Map(deck.items.map((item) => [item.id, item]));
  for (const patch of patches) {
    const item = byId.get(patch.itemId);
    if (!item) continue;
    if (patch.kind === "accept" && item.format === "value") {
      const answer = patch.answer.trim();
      if (answer && !(item.accepted ?? []).includes(answer)) item.accepted = [...(item.accepted ?? []), answer];
    } else if (patch.kind === "card" && item.format === "value") {
      item.format = "card";
      item.answer = show((item.accepted ?? []).join("\n"));
    }
  }
  return deck;
}

/* ---------------------------------------------------------------- similar objectives (hide suggestions) */
/** Course-running material (출제기준 설계-3): grading, attendance, schedule, office hours, textbook. */
const ADMIN = /(성적|평가\s*비율|출석|중간\s*고사|기말\s*고사|과제\s*(제출|비율)|수업\s*(진행|방식|계획|일정)|강의\s*(계획|일정|소개|목표)|교재|연락처|면담|시험\s*(범위|일정))/;
const tokens = (text: string) => new Set(text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)
  .map((word) => word.replace(/(을|를|이|가|은|는|의|에|와|과|로|으로|한다|할|수|있다|말할|설명할)$/u, "")).filter((word) => word.length >= 2));
export function similarity(a: string, b: string) {
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const word of x) if (y.has(word)) both++;
  return both / (x.size + y.size - both);
}
/**
 * Objectives to offer hiding after the learner hid one: course-admin ones when the hidden one was course admin,
 * otherwise those whose wording overlaps at least `threshold` (Jaccard over words).
 */
export function similarObjectives(hidden: { id: string; statement: string }, candidates: Array<{ id: string; statement: string }>, threshold = 0.5) {
  const admin = ADMIN.test(hidden.statement);
  return candidates.filter((objective) => objective.id !== hidden.id
    && ((admin && ADMIN.test(objective.statement)) || similarity(hidden.statement, objective.statement) >= threshold)).map((objective) => objective.id);
}

/* ---------------------------------------------------------------- ledger (study-quality/장부.md) */
/** Why a signal happened, in the words the slow loop groups by. The tag points at the criterion it would change. */
export const CAUSES = {
  "인정답안누락": "단답-1",
  "형식선택": "단답-1",
  "목표설계": "설계-3",
  "너무쉬움": "학습규칙",
  "지엽": "설계-지엽",
  "빠뜨림": "설계-범위",
  "분량": "학습규칙",
  "간격": "학습규칙",
  "정답오류": "출제-정답",
  "애매함": "출제-명확",
  "원문불일치": "출제-근거",
  "기타": "-",
} as const;
export type Cause = keyof typeof CAUSES;
export type LedgerEntry = { at: string; deck: string; item?: string; objective?: string; signal: string; action: string; cause: Cause; detail?: string };
const flat = (text: string, size = 160) => { const one = text.replace(/\s+/g, " ").replace(/\|/g, "/").trim(); return one.length > size ? one.slice(0, size - 1) + "…" : one; };

export function ledgerLine(entry: LedgerEntry) {
  const where = [entry.deck, entry.item ?? entry.objective].filter(Boolean).map((part) => flat(part!, 80)).join(" · ");
  return `- ${entry.at.slice(0, 16).replace("T", " ")} | ${where} | ${flat(entry.signal, 60)} → ${flat(entry.action, 80)} | 원인: ${entry.cause} [${CAUSES[entry.cause]}]${entry.detail ? ` | ${flat(entry.detail)}` : ""}`;
}
export const LEDGER_HEAD = `# 품질 장부

공부하면서 생긴 품질 신호와 그 자리에서 한 처리(빠른 고리). 한 줄이 사건 하나다.
느린 고리(docs/품질_자동화.md)는 '원인'별로 세어 문턱(학습규칙/품질.md [후보-문턱])을 넘으면 출제기준·학습규칙 후보를 만든다.
앱이 줄을 덧붙이기만 하고 고치지 않는다. 사람 메모는 맨 아래 메모 절에 적는다.

## 사건
`;
/** Counts per cause from a ledger file (only well-formed event lines). */
export function ledgerCounts(markdown: string) {
  const counts: Partial<Record<Cause, number>> = {};
  for (const line of markdown.split(/\r?\n/)) {
    const match = /\| 원인: (\S+) \[/.exec(line);
    if (match && match[1] in CAUSES) counts[match[1] as Cause] = (counts[match[1] as Cause] ?? 0) + 1;
  }
  return counts;
}
/** Adds event lines under "## 사건" (before "## 메모" when present). */
export function appendLedger(existing: string | null, lines: string[]) {
  const base = existing && existing.includes("## 사건") ? existing : LEDGER_HEAD + (existing ? `\n## 메모\n\n${existing.trim()}\n` : "");
  const memo = base.indexOf("\n## 메모");
  const block = lines.join("\n") + "\n";
  if (memo < 0) return base.trimEnd() + "\n" + block;
  return base.slice(0, memo).trimEnd() + "\n" + block + base.slice(memo);
}

/* ---------------------------------------------------------------- too easy */
/** Solved alone on the last `streak` tries, on as many different days: the review interval can jump to the longest. */
export function tooEasy(events: Array<{ t: number; item: string; kind: string; correct?: boolean; rating?: string; assisted?: boolean; afterReading?: boolean }>, itemId: string, streak: number) {
  const tries = events.filter((event) => event.item === itemId && (event.kind === "submit" || event.kind === "rate" || event.kind === "reveal"));
  if (tries.length < streak) return false;
  const last = tries.slice(-streak);
  const alone = last.every((event) => !event.assisted && !event.afterReading && (event.kind === "submit" ? event.correct === true : event.kind === "rate" && event.rating === "remembered"));
  return alone && new Set(last.map((event) => new Date(event.t).toDateString())).size >= streak;
}
