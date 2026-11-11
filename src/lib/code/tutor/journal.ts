// PS 튜터: 학습 관찰일지 (2026-11-08, 사용자 "본인이 어떻게 해서 어떻게 학습을 진행했다, 뭘 몰라서 어떻게 학습을 진행했다").
// 사건 기록(events.jsonl)과 배운 것 카드(lessons.jsonl)에서 코드가 만든다(AI 없음). 한 줄 = 한 일: 무엇을 했고, 어떻게 됐고,
// 몰랐던 게 드러났으면 무엇을 배웠는지. 하루 묶음과 그날의 요약(새로 배운 패턴, 혼자 맞힌 것, 아직 막힌 것)은 화면이 날짜로 나눈다.
import { patternOf } from "./patterns.ts";
import { readLessons, type Lesson } from "./lessons.ts";
import { ABILITY_LABEL, GRADE_LABEL, readEvents, type TutorEvent } from "./state.ts";

export type JournalEntry = { at: string; number: string; title: string; patterns: string[]; what: string; result: "learned" | "alone" | "helped" | "seen" | "other"; text: string; lesson?: Pick<Lesson, "gap" | "fix" | "cue" | "distinguish"> };
const names = (ids: string[]) => ids.map((id) => patternOf(id)?.name ?? id).join(", ");

export function journalOf(events: TutorEvent[], lessons: Lesson[], titles: Record<string, string>, limit = 300): JournalEntry[] {
  const used = new Set<string>();
  // 같은 일에서 나온 카드: 같은 문제·패턴, 사건 직후 2초 안.
  const cardFor = (e: TutorEvent) => lessons.find((l) => !used.has(l.id) && l.number === e.number && e.patterns.includes(l.pattern) && Math.abs(Date.parse(l.at) - Date.parse(e.at)) < 2000 && l.kind !== "hint" && l.kind !== "explain");
  const out: JournalEntry[] = [];
  for (const e of events) {
    const title = titles[e.number] ?? "";
    const base = { at: e.at, number: e.number, title, patterns: e.patterns };
    const card = cardFor(e);
    if (card) used.add(card.id);
    const lesson = card ? { gap: card.gap, fix: card.fix, cue: card.cue, distinguish: card.distinguish } : undefined;
    if (e.kind === "walkthrough") out.push({ ...base, what: "풀이 과정 보기", result: "seen", text: `풀이 과정을 봤어요 (${names(e.patterns)})` });
    else if (e.kind === "skip") out.push({ ...base, what: "풀이 과정 보기", result: "other", text: `이미 안다고 해서 건너뛰었어요 (${names(e.patterns)})` });
    else if (e.kind === "predict") out.push({ ...base, what: "결과 맞히기", result: e.ok ? "alone" : "learned", text: e.ok ? "결과를 맞혔어요" : e.detail === "모르겠어요" ? "결과를 떠올리지 못했어요" : "결과가 생각과 달랐어요", lesson });
    else if (e.kind === "review") out.push({ ...base, what: "다시 보기", result: e.ok ? "alone" : "learned", text: e.ok ? "예전 실수를 다시 보고 맞는 생각을 골랐어요" : "예전 실수를 다시 봤지만 맞는 생각을 고르지 못했어요" });
    else if (e.kind === "contrast") out.push({ ...base, what: "비슷한 문제 구별", result: e.ok ? "alone" : "other", text: e.ok ? "비슷한 두 문제를 맞게 구별했어요" : "비슷한 두 문제를 구별하지 못했어요" });
    else if (e.ability && e.ok !== undefined) {
      const what = { recognize: "방법 알아채기", design: "계획 세우기", execute: "직접 짜기" }[e.ability];
      const result = e.hinted ? (e.ok ? "helped" : "learned") : e.ok ? "alone" : "learned";
      const text = e.hinted ? (e.ok ? "힌트를 보고 맞혔어요" : "힌트를 보고도 틀렸어요") : e.ok ? `${GRADE_LABEL[e.grade]}` : "틀렸어요";
      out.push({ ...base, what, result, text, lesson });
    }
  }
  // AI 힌트·설명으로 배운 것은 사건이 아니라 카드로만 있다.
  const seenAi = new Set<string>();
  for (const l of lessons) if (!used.has(l.id) && (l.kind === "hint" || l.kind === "explain")) {
    const key = `${l.number}:${l.at.slice(0, 19)}`; // 패턴이 여럿이면 카드도 여럿: 일지에는 한 줄
    if (seenAi.has(key)) continue;
    seenAi.add(key);
    out.push({ at: l.at, number: l.number, title: l.title, patterns: [l.pattern], what: l.kind === "hint" ? "AI 힌트" : "AI 설명", result: "learned",
      text: `${l.kind === "hint" ? "AI 힌트" : "AI 설명"}로 배웠어요 (${names([l.pattern])})${l.refined === "raw" ? " · 정리하지 못해 받은 글 그대로" : ""}`, lesson: { gap: l.gap, fix: l.fix, cue: l.cue } });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/* ---------- 풀이 일지 (11/11): 문제마다 한 장 ----------
 * 어디서 막혔나 · 도움을 몇째 칸까지 열었나 · 그때 내 생각 → 이렇게 풀려요 · 혼자 다시 풀었나. 사건과 카드에서 코드가 만든다(AI 없음).
 * 막힌 곳은 가장 앞 단계로: 결과 맞히기 틀림 → 문제 이해, 방법 고르기 틀림·도움 1~2칸 → 방법 떠올리기, 계획 틀림·도움 3칸 → 계획,
 * 직접 짜기 틀림·도움 4칸(뼈대·AI 힌트) → 코드로 옮기기. */
export type Stuck = "understand" | "recognize" | "design" | "execute";
export const STUCK_LABEL: Record<Stuck, string> = { understand: "문제 이해", recognize: "방법 떠올리기", design: "계획 세우기", execute: "코드로 옮기기" };
const STUCK_ORDER: Stuck[] = ["understand", "recognize", "design", "execute"];
export type SolveLog = { number: string; title: string; at: string; patterns: string[]; stuck: Stuck | null; help: number; fill: boolean; solved: boolean; alone: boolean;
  lessonId?: string; gap?: string; fix?: string; cue?: string; confirmed?: boolean; redo: "none" | "waiting" | "due" | "done"; redoAt?: string };
export function solveLogs(events: TutorEvent[], lessons: Lesson[], titles: Record<string, string>, now = new Date(), limit = 60): SolveLog[] {
  const byNumber = new Map<string, TutorEvent[]>();
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) byNumber.set(e.number, [...(byNumber.get(e.number) ?? []), e]);
  const out: SolveLog[] = [];
  for (const [number, es] of byNumber) {
    if (!es.some((e) => e.ability || e.kind === "help")) continue; // 풀이 과정만 본 문제는 일지에 없다
    const stuck = new Set<Stuck>();
    let help = 0;
    for (const e of es) {
      if (e.kind === "predict" && e.ok === false) stuck.add("understand");
      if (e.kind === "help" || (e.kind === "implement" && e.help)) { const h = e.help ?? 0; help = Math.max(help, h); stuck.add(h <= 2 ? "recognize" : h === 3 ? "design" : "execute"); }
      if (e.ability && e.kind !== "implement" && (e.ok === false || e.hinted)) stuck.add(e.ability === "recognize" ? "recognize" : "design");
      if (e.kind === "implement" && e.ok === false) stuck.add("execute");
    }
    const solves = es.filter((e) => e.kind === "implement" && e.ok);
    const helped = solves.filter((e) => e.hinted).at(-1), alone = solves.filter((e) => !e.hinted).at(-1);
    // 혼자 다시: 도움 받고 푼 적이 있으면, 그 뒤 혼자 통과 → 했어요 / 하루 지남 → 지금 풀 차례 / 아직 → 기다리는 중.
    const redo: SolveLog["redo"] = !helped ? "none" : alone && alone.at > helped.at ? "done" : now.getTime() - Date.parse(helped.at) >= 24 * 3600_000 ? "due" : "waiting";
    const cards = lessons.filter((l) => l.number === number && l.gap);
    const card = cards.at(-1);
    out.push({ number, title: titles[number] ?? card?.title ?? "", at: es.at(-1)!.at, patterns: [...new Set(es.flatMap((e) => e.patterns))].map((id) => patternOf(id)?.name ?? id),
      stuck: STUCK_ORDER.find((s) => stuck.has(s)) ?? null, help, fill: es.some((e) => e.fill), solved: solves.length > 0, alone: Boolean(alone) && !helped,
      ...(card ? { lessonId: card.id, gap: card.gap, fix: card.fix, cue: card.cue, confirmed: card.confirmed } : {}), redo, ...(redo === "done" ? { redoAt: alone!.at } : {}) });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
/** 이번 주 한 줄: 몇 문제, 어디서 막혔나(많은 순), 혼자 다시 풀기 몇 개 중 몇 개. */
export function weekLine(logs: SolveLog[], now = new Date()) {
  const week = logs.filter((l) => now.getTime() - Date.parse(l.at) < 7 * 24 * 3600_000);
  const stuck = STUCK_ORDER.map((s) => ({ s, n: week.filter((l) => l.stuck === s).length })).filter((x) => x.n).sort((a, b) => b.n - a.n);
  const redone = week.filter((l) => l.redo === "done").length, redoAll = week.filter((l) => l.redo !== "none").length;
  return { problems: week.length, alone: week.filter((l) => l.alone).length, stuck: stuck.map((x) => ({ label: STUCK_LABEL[x.s], n: x.n })), redone, redoAll,
    text: !week.length ? "" : [`이번 주 ${week.length}문제`, week.some((l) => l.alone) ? `처음부터 혼자 ${week.filter((l) => l.alone).length}` : "", stuck.length ? `막힌 곳: ${stuck.map((x) => `${STUCK_LABEL[x.s]} ${x.n}`).join(", ")}` : "", redoAll ? `혼자 다시 풀기 ${redoAll}개 중 ${redone}개 성공` : ""].filter(Boolean).join(" · ") };
}

export async function journal(titles: Record<string, string>) {
  const [events, lessons] = await Promise.all([readEvents(), readLessons()]);
  return journalOf(events, lessons, titles);
}
export { ABILITY_LABEL };
