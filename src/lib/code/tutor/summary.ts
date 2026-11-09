// PS 기억의 알고리즘 전용 모양 (2026-11-10, 사용자 "다시 봤을 때 어떤 흐름으로 공부했는데 뭐가 부족했구나 딱 볼 수 있나",
// "알고리즘은 알고리즘만의 form을 가져도 좋다"). 사건 기록과 배운 것 카드에서 코드가 만든다(AI 없음).
//   지금 어디서 막혔나 한마디 · 흐름 한 줄 · 잘못 생각한 것 / 이제 기억할 것 / 신호 · 알아보기·설계·구현 ✓✗
import type { Lesson } from "./lessons.ts";
import type { Ability, TutorEvent } from "./state.ts";

export type Mark = "ok" | "help" | "bad" | "none";
export type PsSummary = {
  stage: string; flow: string[]; marks: Record<Ability, Mark>;
  wrong?: string; remember?: string; cue?: string; at?: string; where?: string;
};
const LABEL: Record<Ability, string> = { recognize: "알아보기", design: "설계", execute: "구현" };

/** 한 패턴의 요약. 사건은 시간순으로 받는다. */
export function summarize(pattern: string, events: TutorEvent[], lessons: Lesson[]): PsSummary {
  const mine = events.filter((e) => e.patterns.includes(pattern)).sort((a, b) => a.at.localeCompare(b.at));
  // 능력마다 마지막 혼자 한 결과(도움 받고 맞힌 것은 ✓로 치지 않는다).
  const marks = { recognize: "none", design: "none", execute: "none" } as Record<Ability, Mark>;
  for (const e of mine) {
    if (!e.ability || e.ok === undefined) continue;
    if (e.hinted) { if (marks[e.ability] !== "ok") marks[e.ability] = e.ok ? "help" : "bad"; continue; }
    marks[e.ability] = e.ok ? "ok" : "bad";
  }
  // 흐름: 같은 종류가 이어지면 묶는다. "알아보기 2번(1번 틀림)".
  const steps: Array<{ key: string; n: number; bad: number; text: (n: number, bad: number) => string }> = [];
  const push = (key: string, bad: boolean, text: (n: number, bad: number) => string) => {
    const last = steps.at(-1);
    if (last?.key === key) { last.n++; if (bad) last.bad++; } else steps.push({ key, n: 1, bad: bad ? 1 : 0, text });
  };
  const counted = (name: string) => (n: number, bad: number) => (n === 1 ? `${name} ${bad ? "틀림" : "맞힘"}` : `${name} ${n}번${bad ? `(${bad}번 틀림)` : ""}`);
  // AI 힌트·설명은 사건이 아니라 카드로만 있어서 시간순으로 끼워 넣는다(패턴이 여럿이면 카드도 여럿: 한 번으로).
  const seenAi = new Set<string>();
  const ai = lessons.filter((l) => l.pattern === pattern && (l.kind === "hint" || l.kind === "explain")).filter((l) => { const k = `${l.number}:${l.at.slice(0, 19)}`; if (seenAi.has(k)) return false; seenAi.add(k); return true; });
  const timeline: Array<{ at: string; e?: TutorEvent; ai?: Lesson }> = [...mine.map((e) => ({ at: e.at, e })), ...ai.map((l) => ({ at: l.at, ai: l }))].sort((a, b) => a.at.localeCompare(b.at));
  for (const { e, ai: l } of timeline) {
    if (l) { push("ai", false, (n) => (n === 1 ? `AI ${l.kind === "hint" ? "힌트" : "설명"}` : `AI 도움 ${n}번`)); continue; }
    if (!e) continue;
    if (e.kind === "walkthrough") push("w", false, () => "시범");
    else if (e.kind === "skip") push("s", false, () => "시범 건너뜀");
    else if (e.kind === "predict") push("p", !e.ok, (_n, bad) => (bad ? "예측 틀림" : "예측 맞힘"));
    else if (e.kind === "contrast") push("c", !e.ok, counted("비교"));
    else if (e.kind === "review") push("r", !e.ok, counted("복습"));
    else if (e.ability) push(`${e.ability}${e.hinted ? "h" : ""}`, !e.ok, counted(`${LABEL[e.ability]}${e.hinted ? "(도움)" : ""}`));
  }
  const flow = steps.map((x) => x.text(x.n, x.bad));
  const order: Ability[] = ["recognize", "design", "execute"];
  const stuck = order.find((ab) => marks[ab] === "bad" || marks[ab] === "help");
  const todo = order.find((ab) => marks[ab] === "none");
  const stage = stuck ? (marks[stuck] === "help" ? `${LABEL[stuck]}은 아직 도움을 받아야 됨` : `아직 ${LABEL[stuck]}에서 막힘`) : todo ? (marks.recognize === "ok" ? `${order.filter((ab) => marks[ab] === "ok").map((ab) => LABEL[ab]).join("·")}까지 혼자 됨, ${LABEL[todo]}은 아직` : "아직 혼자 해 본 적 없음") : "알아보기·설계·구현 모두 혼자 됨";
  // 잘못 생각한 것이 적힌 마지막 카드(그 카드의 고친 생각과 짝으로). 없으면 고친 생각만 있는 마지막 카드.
  const last = lessons.filter((l) => l.pattern === pattern && l.gap).at(-1) ?? lessons.filter((l) => l.pattern === pattern && l.fix).at(-1);
  return { stage, flow, marks, ...(last ? { wrong: last.gap || undefined, remember: last.fix || undefined, cue: last.cue || undefined, at: last.at, where: last.title ? `BOJ ${last.number} ${last.title}` : `BOJ ${last.number}` } : {}) };
}

/** 기억 저장소의 PS 패턴 기억이면 요약을, 아니면 null. */
export async function psSummaryOf(item: { sources?: Array<{ ref?: string }> }): Promise<PsSummary | null> {
  const pattern = (item.sources ?? []).map((s) => /^tutor:pattern:([a-z0-9-]+)$/.exec(s.ref ?? "")?.[1]).find(Boolean);
  if (!pattern) return null;
  const [{ readEvents }, { readLessons }] = await Promise.all([import("./state.ts"), import("./lessons.ts")]);
  const [events, lessons] = await Promise.all([readEvents(), readLessons()]);
  return summarize(pattern, events, lessons);
}
