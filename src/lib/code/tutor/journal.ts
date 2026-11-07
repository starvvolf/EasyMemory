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
    if (e.kind === "walkthrough") out.push({ ...base, what: "시범", result: "seen", text: `시범을 봄 (${names(e.patterns)})` });
    else if (e.kind === "skip") out.push({ ...base, what: "시범", result: "other", text: `시범을 건너뜀: 이미 안다고 함 (${names(e.patterns)})` });
    else if (e.kind === "predict") out.push({ ...base, what: "결과 예측", result: e.ok ? "alone" : "learned", text: e.ok ? "결과를 맞게 예측함" : e.detail === "모르겠어요" ? "결과를 예측하지 못함" : "결과 예측이 달랐음", lesson });
    else if (e.kind === "review") out.push({ ...base, what: "기억 복습", result: e.ok ? "alone" : "learned", text: e.ok ? "예전 실수를 다시 보고 바로잡은 생각을 골라냄" : "예전 실수를 다시 봤지만 바로잡은 생각을 고르지 못함" });
    else if (e.kind === "contrast") out.push({ ...base, what: "비교하기", result: e.ok ? "alone" : "other", text: e.ok ? "비슷한 두 문제의 패턴을 맞게 구별함" : "비슷한 두 문제를 구별하지 못함" });
    else if (e.ability && e.ok !== undefined) {
      const what = { recognize: "접근 판단", design: "설계", execute: "혼자 구현" }[e.ability];
      const result = e.hinted ? (e.ok ? "helped" : "learned") : e.ok ? "alone" : "learned";
      const text = e.hinted ? (e.ok ? `${what}: 도움(신호·힌트)을 받고 맞힘` : `${what}: 도움을 받고도 틀림`) : e.ok ? `${what}: 혼자 맞힘 · ${GRADE_LABEL[e.grade]}` : `${what}: 틀림`;
      out.push({ ...base, what, result, text: `${text}${e.mixed ? " (단원 숨김)" : ""}`, lesson });
    }
  }
  // AI 힌트·설명으로 배운 것은 사건이 아니라 카드로만 있다.
  const seenAi = new Set<string>();
  for (const l of lessons) if (!used.has(l.id) && (l.kind === "hint" || l.kind === "explain")) {
    const key = `${l.number}:${l.at.slice(0, 19)}`; // 패턴이 여럿이면 카드도 여럿: 일지에는 한 줄
    if (seenAi.has(key)) continue;
    seenAi.add(key);
    out.push({ at: l.at, number: l.number, title: l.title, patterns: [l.pattern], what: l.kind === "hint" ? "AI 힌트" : "AI 설명", result: "learned",
      text: `${l.kind === "hint" ? "AI 힌트" : "AI 설명"}로 배움 (${names([l.pattern])})${l.refined === "raw" ? " · 정리 못 해서 원문 그대로" : ""}`, lesson: { gap: l.gap, fix: l.fix, cue: l.cue } });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export async function journal(titles: Record<string, string>) {
  const [events, lessons] = await Promise.all([readEvents(), readLessons()]);
  return journalOf(events, lessons, titles);
}
export { ABILITY_LABEL };
