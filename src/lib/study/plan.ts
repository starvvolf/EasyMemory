// 오늘 할 것: one day's study, computed from the learner's own records, subjects and exam dates, and the editable
// rules in 학습규칙/오늘할것.md. Pure functions only: the study screen runs them in the browser, and /api/study-plan
// runs the same code on the server so an agent sees exactly what the learner sees (docs/학습흐름_자동화.md).

/* ---------------------------------------------------------------- shapes */
export type PlanFormat = "choice" | "value" | "card" | "order";
export type PlanItem = { id: string; objectiveId: string; format: PlanFormat; page: number };
export type PlanObjective = { id: string; statement: string; pages: number[]; recall?: string; importance?: "core" | "support"; section?: string };
export type PlanDeck = { id: string; title: string; sourceCatalogId: string; items: PlanItem[]; objectives: PlanObjective[] };
export type PlanEvent = { t: number; item: string; kind: string; correct?: boolean; rating?: string; assisted?: boolean; afterReading?: boolean; gaveUp?: boolean };
export type PlanSched = { box: number; due: number; seen: boolean };
export type PlanRecord = { events: PlanEvent[]; sched: Record<string, PlanSched>; hidden?: string[]; reported?: Record<string, unknown> };
export type PlanSubject = { name: string; exam: string };
export type PlanSettings = { subjects: PlanSubject[]; of: Record<string, string> };
/** A phrase asked or marked while reading (모르는 것 노트), per registered PDF. */
export type PlanNote = { page: number; quote: string; askedAt: string; kind?: string };

/* ---------------------------------------------------------------- rules (학습규칙/오늘할것.md) */
export type StudyRules = {
  dailyMinutes: number;
  seconds: Record<PlanFormat, number>;
  newPerDayMax: number;
  newPerDayNoExam: number;
  finalDays: number;
  urgentDays: number;
  diagnose: boolean;
  diagnoseKnownDays: number;
  weakMax: number;
  chunk: number;
};
export const DEFAULT_RULES: StudyRules = {
  dailyMinutes: 90,
  seconds: { choice: 40, value: 60, card: 35, order: 60 },
  newPerDayMax: 60,
  newPerDayNoExam: 20,
  finalDays: 1,
  urgentDays: 7,
  diagnose: true,
  diagnoseKnownDays: 7,
  weakMax: 40,
  chunk: 20,
};
type NumberKey = Exclude<keyof StudyRules, "seconds" | "diagnose">;
const NUMBER_KEYS: Record<string, NumberKey> = {
  "하루-시간": "dailyMinutes", "새문제-최대": "newPerDayMax", "시험없음-새문제": "newPerDayNoExam", "마지막-복습일": "finalDays",
  "시험-임박": "urgentDays", "첫훑기-앎-간격": "diagnoseKnownDays", "약점-최대": "weakMax", "한번에": "chunk",
};
const SECOND_KEYS: Record<string, PlanFormat> = { "시간-고르기": "choice", "시간-값쓰기": "value", "시간-떠올리기": "card", "시간-순서": "order" };
const LIMITS: Record<NumberKey, [number, number]> = {
  dailyMinutes: [10, 600], newPerDayMax: [0, 500], newPerDayNoExam: [0, 500], finalDays: [0, 7], urgentDays: [0, 60],
  diagnoseKnownDays: [1, 60], weakMax: [0, 300], chunk: [5, 100],
};

/** Reads `- [키] 값` lines; anything else in the file is for people. Unknown keys and bad values are reported, not fatal. */
export function parseRules(markdown: string): { rules: StudyRules; warnings: string[] } {
  const rules: StudyRules = { ...DEFAULT_RULES, seconds: { ...DEFAULT_RULES.seconds } };
  const warnings: string[] = [];
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const match = /^- \[([^\]]+)\]\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, key, raw] = match;
    if (key === "첫훑기") {
      if (/^(예|켜기|on|true)/i.test(raw)) rules.diagnose = true;
      else if (/^(아니오|아니요|끄기|off|false)/i.test(raw)) rules.diagnose = false;
      else warnings.push(`[${key}] 값은 '예' 또는 '아니오'여야 해요: ${raw}`);
      continue;
    }
    const value = Number(/-?\d+(\.\d+)?/.exec(raw)?.[0]);
    if (!Number.isFinite(value)) { if (NUMBER_KEYS[key] || SECOND_KEYS[key]) warnings.push(`[${key}] 숫자를 찾지 못했어요: ${raw}`); else warnings.push(`모르는 규칙 [${key}]`); continue; }
    if (SECOND_KEYS[key]) { rules.seconds[SECOND_KEYS[key]] = Math.min(600, Math.max(5, value)); continue; }
    const name = NUMBER_KEYS[key];
    if (!name) { warnings.push(`모르는 규칙 [${key}]`); continue; }
    const [lo, hi] = LIMITS[name];
    if (value < lo || value > hi) warnings.push(`[${key}] ${value}은 범위(${lo}~${hi}) 밖이라 잘라 썼어요.`);
    rules[name] = Math.round(Math.min(hi, Math.max(lo, value)));
  }
  return { rules, warnings };
}

/* ---------------------------------------------------------------- record reading (same rules as the study screen) */
const DAY = 864e5;
const TRY_KINDS = new Set(["submit", "rate", "reveal"]);
export function startOfDay(now: number) { const day = new Date(now); day.setHours(0, 0, 0, 0); return day.getTime(); }
export function daysLeft(exam: string, now: number): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(exam || "");
  if (!match) return null;
  return Math.round((new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime() - startOfDay(now)) / DAY);
}
function triesOf(record: PlanRecord, itemId: string) { return record.events.filter((event) => event.item === itemId && TRY_KINDS.has(event.kind)); }
/** Weak: the last try was missed, "잘 모름", given up, or done after seeing the answer. Solving it alone clears it. */
export function isWeak(record: PlanRecord, itemId: string) {
  const tries = triesOf(record, itemId);
  const last = tries.at(-1);
  if (!last) return false;
  if (last.kind === "reveal" || last.assisted) return true;
  return last.kind === "submit" ? last.correct !== true : last.rating !== "remembered";
}
export function missCount(record: PlanRecord, itemId: string) {
  return triesOf(record, itemId).filter((event) => event.kind === "reveal" || (event.kind === "submit" && !event.correct) || (event.kind === "rate" && event.rating !== "remembered")).length;
}
function solvedAloneAt(record: PlanRecord, itemId: string) {
  const hit = triesOf(record, itemId).filter((event) => !event.assisted && !event.afterReading && (event.kind === "submit" ? event.correct === true : event.kind === "rate" && event.rating === "remembered")).at(-1);
  return hit ? hit.t : 0;
}
const triedSince = (record: PlanRecord, itemId: string, since: number) => record.events.some((event) => event.item === itemId && TRY_KINDS.has(event.kind) && event.t >= since);
const seen = (record: PlanRecord, itemId: string) => Boolean(record.sched[itemId]?.seen);
const usable = (deck: PlanDeck, record: PlanRecord) => {
  const hidden = new Set(record.hidden ?? []);
  return deck.items.filter((item) => !hidden.has(item.objectiveId) && !(record.reported && record.reported[item.id]));
};
export const emptyRecord = (): PlanRecord => ({ events: [], sched: {} });

/** Objectives asked about while reading (a note on one of their pages) and not solved alone since. */
export function askedObjectives(deck: PlanDeck, record: PlanRecord, notes: PlanNote[]) {
  const asked = new Map<string, PlanNote[]>();
  if (!notes.length) return asked;
  for (const objective of deck.objectives) {
    const hits = notes.filter((note) => objective.pages.includes(note.page));
    if (!hits.length) continue;
    const latest = Math.max(...hits.map((note) => Date.parse(note.askedAt) || 0));
    const items = deck.items.filter((item) => item.objectiveId === objective.id);
    if (items.some((item) => solvedAloneAt(record, item.id) > latest)) continue;
    asked.set(objective.id, hits);
  }
  return asked;
}

/* ---------------------------------------------------------------- today */
export type PlanReason = "weak" | "asked" | "due" | "diagnose" | "new";
export type PlanRef = { deckId: string; itemId: string; reason: PlanReason; subject: string };
export type SubjectPlan = {
  name: string;               // "" = materials without a subject
  exam: string;
  daysLeft: number | null;
  /** learn: new questions paced to the exam; final: the last days, weak spots and review only; over: exam passed. */
  phase: "learn" | "final" | "over";
  counts: { items: number; solid: number; weak: number; asked: number; due: number; fresh: number; diagnose: number };
  picked: Record<PlanReason, number>;
  /** New questions per day so every question is seen once before the final days. */
  quota: number;
  /** Last day for new questions (YYYY-MM-DD), when there is an exam. */
  learnUntil: string | null;
  minutes: number;
  doneToday: number;
};
export type TodayPlan = {
  date: string;
  budgetMinutes: number;
  plannedMinutes: number;
  /** Everything the rules would ask for today, budget aside. */
  needMinutes: number;
  doneToday: number;
  subjects: SubjectPlan[];
  queue: PlanRef[];
  notes: string[];
};
const REASON_ORDER: PlanReason[] = ["weak", "asked", "due", "diagnose", "new"];
const iso = (time: number) => { const day = new Date(time); return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`; };

export type PlanInput = {
  decks: PlanDeck[];
  records: Record<string, PlanRecord | undefined>;
  settings: PlanSettings;
  rules?: StudyRules;
  notes?: Record<string, PlanNote[] | undefined>;
  now: number;
};

export function subjectOfDeck(settings: PlanSettings, deck: Pick<PlanDeck, "id" | "sourceCatalogId">) {
  const name = settings.of[deck.sourceCatalogId || deck.id];
  return name && settings.subjects.some((subject) => subject.name === name) ? name : "";
}

export function planToday(input: PlanInput): TodayPlan {
  const rules = input.rules ?? DEFAULT_RULES;
  const { now } = input;
  const today = startOfDay(now);
  const recordOf = (deck: PlanDeck) => input.records[deck.id] ?? emptyRecord();
  const seconds = (item: PlanItem) => rules.seconds[item.format] ?? 45;
  const groups = new Map<string, PlanDeck[]>();
  for (const deck of input.decks) {
    const name = subjectOfDeck(input.settings, deck);
    groups.set(name, [...(groups.get(name) ?? []), deck]);
  }
  const subjects: SubjectPlan[] = [];
  type Candidate = { ref: PlanRef; seconds: number; must: boolean; urgency: number };
  const candidates: Candidate[] = [];
  const notes: string[] = [];
  let doneToday = 0;

  for (const [name, decks] of groups) {
    const exam = name ? input.settings.subjects.find((subject) => subject.name === name)?.exam ?? "" : "";
    const left = daysLeft(exam, now);
    const phase: SubjectPlan["phase"] = left == null ? "learn" : left < 0 ? "over" : left <= rules.finalDays ? "final" : "learn";
    const urgency = left == null ? 0 : 1 / (Math.max(left, 0) + 1);
    const counts = { items: 0, solid: 0, weak: 0, asked: 0, due: 0, fresh: 0, diagnose: 0 };
    const pools: Record<PlanReason, Array<{ deck: PlanDeck; item: PlanItem; sortKey: number }>> = { weak: [], asked: [], due: [], diagnose: [], new: [] };
    let subjectDone = 0;
    let firstSeenToday = 0;
    decks.forEach((deck, deckIndex) => {
      const record = recordOf(deck);
      const asked = askedObjectives(deck, record, input.notes?.[deck.sourceCatalogId] ?? []);
      const importance = new Map(deck.objectives.map((objective) => [objective.id, objective.importance ?? "core"]));
      const firstItem = new Map<string, string>();
      for (const item of deck.items) if (!firstItem.has(item.objectiveId)) firstItem.set(item.objectiveId, item.id);
      usable(deck, record).forEach((item, index) => {
        const order = deckIndex * 1e5 + index;
        counts.items++;
        const weak = isWeak(record, item.id);
        const isSeen = seen(record, item.id);
        if (triedSince(record, item.id, today)) {
          subjectDone++;
          if ((triesOf(record, item.id)[0]?.t ?? 0) >= today) firstSeenToday++;
          if (isSeen && !weak) counts.solid++; if (weak) counts.weak++; return; }
        if (weak) { counts.weak++; pools.weak.push({ deck, item, sortKey: -missCount(record, item.id) }); return; }
        if (asked.has(item.objectiveId)) { counts.asked++; pools.asked.push({ deck, item, sortKey: order }); return; }
        if (!isSeen) {
          counts.fresh++;
          const first = rules.diagnose && firstItem.get(item.objectiveId) === item.id && importance.get(item.objectiveId) !== "support";
          if (first) { counts.diagnose++; pools.diagnose.push({ deck, item, sortKey: order }); } else pools.new.push({ deck, item, sortKey: order });
          return;
        }
        counts.solid++;
        const due = record.sched[item.id]?.due ?? 0;
        if (due <= now) { counts.due++; pools.due.push({ deck, item, sortKey: due }); }
      });
    });
    doneToday += subjectDone;
    for (const reason of REASON_ORDER) pools[reason].sort((a, b) => a.sortKey - b.sortKey);
    // Materials keep their own order for new questions; decks were given in study order.
    const learnDays = left == null ? null : Math.max(1, left - rules.finalDays);
    // Today's share is fixed from the morning: questions first seen earlier today count toward it.
    const freshTotal = counts.fresh + firstSeenToday;
    const share = phase !== "learn" ? 0 : Math.min(rules.newPerDayMax, learnDays == null ? rules.newPerDayNoExam : Math.ceil(freshTotal / learnDays));
    const remainingToday = Math.max(0, share - firstSeenToday);
    const learnUntil = left == null || phase !== "learn" ? null : iso(startOfDay(now) + Math.max(0, left - rules.finalDays - 1) * DAY);
    const picked: Record<PlanReason, number> = { weak: 0, asked: 0, due: 0, diagnose: 0, new: 0 };
    const plan: SubjectPlan = { name, exam, daysLeft: left, phase, counts, picked, quota: share, learnUntil, minutes: 0, doneToday: subjectDone };
    subjects.push(plan);
    if (phase === "over") continue;
    const urgent = left != null && left <= rules.urgentDays;
    const push = (reason: PlanReason, list: Array<{ deck: PlanDeck; item: PlanItem }>, must: boolean) => {
      for (const { deck, item } of list) candidates.push({ ref: { deckId: deck.id, itemId: item.id, reason, subject: name }, seconds: seconds(item), must, urgency });
    };
    push("weak", pools.weak.slice(0, rules.weakMax), urgent);
    push("asked", pools.asked, urgent);
    push("due", pools.due, urgent);
    const freshList = [...pools.diagnose.map((entry) => ({ ...entry, reason: "diagnose" as const })), ...pools.new.map((entry) => ({ ...entry, reason: "new" as const }))].slice(0, remainingToday);
    for (const entry of freshList) candidates.push({ ref: { deckId: entry.deck.id, itemId: entry.item.id, reason: entry.reason, subject: name }, seconds: seconds(entry.item), must: false, urgency });
    if (phase === "final") notes.push(`${name || "과목 미지정"}: 시험 직전이라 새 문제 없이 약점·복습과 한 장 정리만 해요.`);
    else if (left != null && freshTotal && share >= rules.newPerDayMax && Math.ceil(freshTotal / (learnDays ?? 1)) > rules.newPerDayMax) {
      notes.push(`${name}: 안 풀어본 문제 ${freshTotal}개를 시험 전에 다 보려면 하루 ${Math.ceil(freshTotal / (learnDays ?? 1))}개가 필요해요(규칙 상한 ${rules.newPerDayMax}).`);
    }
  }

  // Must-dos first (weak spots and reviews of exams within the urgent window), then the rest by exam urgency, within the budget.
  const budget = rules.dailyMinutes * 60;
  const ordered = [...candidates].sort((a, b) => Number(b.must) - Number(a.must) || b.urgency - a.urgency || REASON_ORDER.indexOf(a.ref.reason) - REASON_ORDER.indexOf(b.ref.reason));
  const chosen: Candidate[] = [];
  let used = 0;
  for (const candidate of ordered) {
    if (!candidate.must && used + candidate.seconds > budget) continue;
    chosen.push(candidate); used += candidate.seconds;
  }
  const need = candidates.reduce((sum, candidate) => sum + candidate.seconds, 0);
  // Study one subject at a time: nearest exam first, and inside it weak → asked → review → first pass → new.
  const subjectRank = new Map(subjects.map((subject) => [subject.name, subject.daysLeft == null ? 1e6 : subject.daysLeft < 0 ? 2e6 : subject.daysLeft]));
  chosen.sort((a, b) => (subjectRank.get(a.ref.subject)! - subjectRank.get(b.ref.subject)!) || a.ref.subject.localeCompare(b.ref.subject, "ko")
    || REASON_ORDER.indexOf(a.ref.reason) - REASON_ORDER.indexOf(b.ref.reason));
  for (const candidate of chosen) {
    const subject = subjects.find((entry) => entry.name === candidate.ref.subject)!;
    subject.picked[candidate.ref.reason]++;
    subject.minutes += candidate.seconds / 60;
  }
  for (const subject of subjects) subject.minutes = Math.round(subject.minutes);
  subjects.sort((a, b) => (subjectRank.get(a.name)! - subjectRank.get(b.name)!) || a.name.localeCompare(b.name, "ko"));
  if (need > budget * 1.05) notes.push(`오늘 규칙대로 하려면 약 ${Math.round(need / 60)}분이 필요해요. 하루 ${rules.dailyMinutes}분에 맞춰 시험이 먼 과목의 새 문제를 줄였어요.`);
  return {
    date: iso(now), budgetMinutes: rules.dailyMinutes, plannedMinutes: Math.round(used / 60), needMinutes: Math.round(need / 60), doneToday,
    subjects, queue: chosen.map((candidate) => candidate.ref), notes,
  };
}

/* ---------------------------------------------------------------- first pass (첫 훑기) */
/** Box to jump to when a first-pass question is solved alone: the first review interval at or beyond `days`. */
export function diagnoseBox(intervals: number[], days: number) {
  const index = intervals.findIndex((interval) => interval >= days * DAY);
  return index < 0 ? intervals.length - 1 : index;
}

/* ---------------------------------------------------------------- memory (study-memory/<과목>.md) */
export const MEMORY_AUTO_START = "<!-- recaller:auto:start -->";
export const MEMORY_AUTO_END = "<!-- recaller:auto:end -->";
const clip = (text: string, size: number) => { const flat = text.replace(/\s+/g, " ").trim(); return flat.length > size ? flat.slice(0, size - 1) + "…" : flat; };
const md = (text: string) => text; // kept as written: recall may hold LaTeX the reader (or an agent) should see unchanged

/**
 * The machine-written part of a subject's memory file: where the learner stands, weak objectives with what to recall,
 * and what they asked while reading. People and agents write below it (## 내 메모, ## 에이전트 메모); saving keeps those.
 */
export function renderMemoryAuto(input: { subject: string; decks: PlanDeck[]; records: Record<string, PlanRecord | undefined>; settings: PlanSettings; notes?: Record<string, PlanNote[] | undefined>; now: number }) {
  const { subject, now } = input;
  const exam = input.settings.subjects.find((entry) => entry.name === subject)?.exam ?? "";
  const left = daysLeft(exam, now);
  const lines: string[] = [MEMORY_AUTO_START, `## 자동 요약 (${iso(now)} ${new Date(now).toTimeString().slice(0, 5)})`, ""];
  lines.push(`- 시험: ${exam ? `${exam}${left == null ? "" : left > 0 ? ` (D-${left})` : left === 0 ? " (D-day)" : " (끝)"}` : "날짜 없음"}`);
  let items = 0, weakCount = 0, fresh = 0, solid = 0;
  const weakRows: string[] = [];
  const askedRows: string[] = [];
  for (const deck of input.decks) {
    const record = input.records[deck.id] ?? emptyRecord();
    const list = usable(deck, record);
    const objectives = new Map(deck.objectives.map((objective) => [objective.id, objective]));
    const weakByObjective = new Map<string, { misses: number; last: number }>();
    for (const item of list) {
      items++;
      if (!seen(record, item.id)) { fresh++; continue; }
      if (!isWeak(record, item.id)) { solid++; continue; }
      weakCount++;
      const tries = triesOf(record, item.id);
      const entry = weakByObjective.get(item.objectiveId) ?? { misses: 0, last: 0 };
      entry.misses += missCount(record, item.id); entry.last = Math.max(entry.last, tries.at(-1)?.t ?? 0);
      weakByObjective.set(item.objectiveId, entry);
    }
    for (const [objectiveId, entry] of [...weakByObjective].sort((a, b) => b[1].misses - a[1].misses)) {
      const objective = objectives.get(objectiveId);
      if (!objective) continue;
      weakRows.push(`- [${md(deck.title)} · ${objectiveId}] ${md(clip(objective.statement, 120))}${objective.recall ? ` — 떠올릴 것: ${md(clip(objective.recall, 160))}` : ""} (놓침 ${entry.misses}번, 마지막 ${iso(entry.last).slice(5)}, p.${objective.pages.join(",")})`);
    }
    for (const note of input.notes?.[deck.sourceCatalogId] ?? []) {
      askedRows.push(`- [${md(deck.title)}] p.${note.page} "${md(clip(note.quote, 80))}" (${note.askedAt.slice(5, 10)}${note.kind === "talk" ? ", 질문 창" : ""})`);
    }
  }
  lines.push(`- 진행: 문제 ${items}개 중 혼자 맞힘·복습 중 ${solid} · 약점 ${weakCount} · 안 풀어봄 ${fresh}`, "");
  lines.push("## 약점 목표", "", ...(weakRows.length ? weakRows.slice(0, 60) : ["- 없음"]), "");
  lines.push("## 읽다가 물어본 것", "", ...(askedRows.length ? [...new Set(askedRows)].slice(-40) : ["- 없음"]), "");
  lines.push(MEMORY_AUTO_END);
  return lines.join("\n");
}

/** Puts a fresh auto part into a memory file, keeping everything people and agents wrote outside it. */
export function mergeMemory(existing: string | null, subject: string, auto: string) {
  const tail = "\n## 내 메모\n\n(공부하면서 직접 적는 곳. Recaller는 이 아래를 고치지 않아요.)\n\n## 에이전트 메모\n\n(에이전트가 관찰과 다음 할 일을 적는 곳. 학습규칙/에이전트.md를 따른다.)\n";
  if (!existing || !existing.includes(MEMORY_AUTO_START) || !existing.includes(MEMORY_AUTO_END)) {
    const head = `# ${subject} 학습 메모\n\n`;
    const rest = existing ? `\n## 예전 내용\n\n${existing.trim()}\n` : tail;
    return head + auto + "\n" + rest;
  }
  const start = existing.indexOf(MEMORY_AUTO_START);
  const end = existing.indexOf(MEMORY_AUTO_END) + MEMORY_AUTO_END.length;
  return existing.slice(0, start) + auto + existing.slice(end);
}

/* ---------------------------------------------------------------- from a study deck */
type DeckLike = {
  id: string; title: string; sourceCatalogId: string;
  items: Array<{ id: string; objectiveId: string; format: string; page: number }>;
  objectives: Array<{ id: string; statement: string; pages: number[] }>;
  outline?: Array<{ title: string; objectives: Array<{ id: string; recall: string; importance: "core" | "support" }> }>;
};
/** The planner's view of a study deck: the designed objectives' recall and importance join the deck's own objectives. */
export function planDeckFrom(deck: DeckLike): PlanDeck {
  const designed = new Map((deck.outline ?? []).flatMap((section) => section.objectives.map((objective) => [objective.id, { ...objective, section: section.title }] as const)));
  return {
    id: deck.id, title: deck.title, sourceCatalogId: deck.sourceCatalogId,
    items: deck.items.map((item) => ({ id: item.id, objectiveId: item.objectiveId, format: (["choice", "value", "card", "order"].includes(item.format) ? item.format : "card") as PlanFormat, page: item.page })),
    objectives: deck.objectives.map((objective) => {
      const extra = designed.get(objective.id);
      return { id: objective.id, statement: objective.statement, pages: objective.pages, recall: extra?.recall, importance: extra?.importance, section: extra?.section };
    }),
  };
}
/** Settings stored with the records (`__plan`, see the study screen's Store.plan). */
export function planSettingsFrom(value: unknown): PlanSettings {
  const raw = value as { subjects?: unknown; of?: unknown } | null | undefined;
  const subjects = Array.isArray(raw?.subjects) ? raw.subjects.filter((entry): entry is PlanSubject => Boolean(entry) && typeof (entry as PlanSubject).name === "string").map((entry) => ({ name: entry.name, exam: typeof entry.exam === "string" ? entry.exam : "" })) : [];
  const of = raw?.of && typeof raw.of === "object" ? Object.fromEntries(Object.entries(raw.of as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
  return { subjects, of };
}
/** A deck's record in the mirrored records map: `<id>@live` for new-engine materials, else `<id>@<sha>` (newest save wins). */
export function recordFor(records: Record<string, unknown>, deckId: string, sha?: string): PlanRecord {
  const direct = records[`${deckId}@live`] ?? (sha ? records[`${deckId}@${sha}`] : undefined);
  const value = (direct ?? Object.entries(records).filter(([key]) => key.startsWith(deckId + "@")).map(([, entry]) => entry as { savedAt?: number })
    .sort((a, b) => (b?.savedAt ?? 0) - (a?.savedAt ?? 0))[0]) as Partial<PlanRecord> | undefined;
  return { events: Array.isArray(value?.events) ? value.events : [], sched: value?.sched && typeof value.sched === "object" ? value.sched : {}, hidden: value?.hidden, reported: value?.reported };
}
