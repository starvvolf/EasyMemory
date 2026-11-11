// PS 기억의 알고리즘 전용 모양 (2026-11-10, 사용자 "다시 봤을 때 어떤 흐름으로 공부했는데 뭐가 부족했구나 딱 볼 수 있나",
// "알고리즘은 알고리즘만의 form을 가져도 좋다"). 사건 기록과 배운 것 카드에서 코드가 만든다(AI 없음).
//   지금 어디서 막혔나 한마디 · 흐름 한 줄 · 잘못 생각한 것 / 이제 기억할 것 / 신호 · 알아보기·설계·구현 ✓✗
import type { Lesson } from "./lessons.ts";
import type { Ability, TutorEvent } from "./state.ts";

export type Mark = "ok" | "help" | "bad" | "none";
export type PsSummary = {
  stage: string; flow: string[]; marks: Record<Ability, Mark>;
  wrong?: string; remember?: string; cue?: string; at?: string; where?: string;
  /** 위의 "그때 내 생각"이 이미 해결된 것인지(아직인 착각이 없어서 지난 것을 보여 줄 때) */ resolved?: boolean;
  /** 아직 해결 안 된 착각 수 */ open: number;
};
/** 카드가 어느 능력의 착각인지: 방법 고르기 → 알아채기, 설계·결과 맞히기 → 계획, 구현·AI 힌트·설명(문제 화면) → 직접 짜기. */
const ABILITY_OF_CARD: Record<Lesson["kind"], Ability> = { drill: "recognize", design: "design", predict: "design", implement: "execute", hint: "execute", explain: "execute" };
/** 해결된 착각(11/10, 사용자 "메모리가 정리가 잘 되어 있어야"): 그 뒤 같은 능력으로 다른 문제를 도움 없이 맞혔으면. 지우지 않고 표시만. */
export function isResolved(card: Lesson, events: TutorEvent[]) {
  const ab = ABILITY_OF_CARD[card.kind];
  // 직접 짜기는 같은 문제를 혼자 다시 풀어도 해결(11/11 "도움 받은 건 혼자 다시"). 알아채기·계획은 답을 이미 봤으니 다른 문제여야 한다.
  return events.some((e) => e.ability === ab && e.ok && !e.hinted && e.at > card.at && (e.number !== card.number || ab === "execute") && e.patterns.includes(card.pattern));
}
// 사람 말로(11/10 사용자 "단어가 딱딱해, 직관적이지 않을 수 있어"): 알아채기 · 계획 세우기 · 직접 짜기.
const LABEL: Record<Ability, string> = { recognize: "방법 알아채기", design: "계획 세우기", execute: "직접 짜기" };

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
  const counted = (name: string) => (n: number, bad: number) => (n === 1 ? `${name} ${bad ? "틀림" : "맞힘"}` : `${name} ${n}번 중 ${n - bad}번 맞힘`);
  // AI 힌트·설명은 사건이 아니라 카드로만 있어서 시간순으로 끼워 넣는다(패턴이 여럿이면 카드도 여럿: 한 번으로).
  const seenAi = new Set<string>();
  const ai = lessons.filter((l) => l.pattern === pattern && (l.kind === "hint" || l.kind === "explain")).filter((l) => { const k = `${l.number}:${l.at.slice(0, 19)}`; if (seenAi.has(k)) return false; seenAi.add(k); return true; });
  const timeline: Array<{ at: string; e?: TutorEvent; ai?: Lesson }> = [...mine.map((e) => ({ at: e.at, e })), ...ai.map((l) => ({ at: l.at, ai: l }))].sort((a, b) => a.at.localeCompare(b.at));
  for (const { e, ai: l } of timeline) {
    if (l) { push("ai", false, (n) => (n === 1 ? `AI에게 ${l.kind === "hint" ? "힌트" : "설명"} 받음` : `AI에게 ${n}번 도움 받음`)); continue; }
    if (!e) continue;
    if (e.kind === "walkthrough") push("w", false, () => "풀이 과정 봄");
    else if (e.kind === "skip") push("s", false, () => "풀이 과정 건너뜀");
    else if (e.kind === "predict") push("p", !e.ok, (_n, bad) => (bad ? "결과 맞히기 틀림" : "결과 맞히기 맞힘"));
    else if (e.kind === "contrast") push("c", !e.ok, counted("비슷한 문제 구별"));
    else if (e.kind === "review") push("r", !e.ok, counted("다시 보기"));
    else if (e.ability) push(`${e.ability}${e.hinted ? "h" : ""}`, !e.ok, counted(`${LABEL[e.ability]}${e.hinted ? "(도움 받고)" : ""}`));
  }
  const flow = steps.map((x) => x.text(x.n, x.bad));
  const order: Ability[] = ["recognize", "design", "execute"];
  const stuck = order.find((ab) => marks[ab] === "bad" || marks[ab] === "help");
  const todo = order.find((ab) => marks[ab] === "none");
  const STAGE: Record<Ability, string> = { recognize: "이 방법을 써야 한다는 걸 알아채는 데서", design: "무엇을 기억하며 풀지 정하는 데서", execute: "직접 코드로 짜는 데서" };
  const stage = stuck ? (marks[stuck] === "help" ? `${STAGE[stuck]} 아직 도움이 필요해요` : `${STAGE[stuck]} 막혔어요`)
    : todo ? (marks.recognize === "ok" ? `${order.filter((ab) => marks[ab] === "ok").map((ab) => LABEL[ab]).join(", ")}까지는 혼자 했어요. ${LABEL[todo]}는 아직이에요` : "아직 혼자 해 본 적이 없어요")
    : "알아채기부터 직접 짜기까지 혼자 다 했어요";
  // 아직 해결 안 된 착각 중 마지막 것(그 카드의 "이렇게 하면 돼요"와 짝으로). 다 해결됐으면 지난 것 하나를 "해결됨"으로.
  const cards = lessons.filter((l) => l.pattern === pattern && (l.gap || l.fix));
  const open = cards.filter((l) => !isResolved(l, events));
  const pick = (xs: Lesson[]) => xs.filter((l) => l.gap).at(-1) ?? xs.at(-1);
  const last = pick(open) ?? pick(cards);
  return { stage, flow, marks, open: open.length, ...(last ? { wrong: last.gap || undefined, remember: last.fix || undefined, cue: last.cue || undefined, at: last.at,
    where: last.title ? `BOJ ${last.number} ${last.title}` : `BOJ ${last.number}`, ...(open.length ? {} : { resolved: true }) } : {}) };
}

/** 기억 저장소의 PS 패턴 기억이면 요약을, 아니면 null. */
export async function psSummaryOf(item: { sources?: Array<{ ref?: string }> }): Promise<PsSummary | null> {
  const pattern = (item.sources ?? []).map((s) => /^tutor:pattern:([a-z0-9-]+)$/.exec(s.ref ?? "")?.[1]).find(Boolean);
  if (!pattern) return null;
  const [{ readEvents }, { readLessons }] = await Promise.all([import("./state.ts"), import("./lessons.ts")]);
  const [events, lessons] = await Promise.all([readEvents(), readLessons()]);
  return summarize(pattern, events, lessons);
}

/** 학습자 모델(알고리즘) → 한눈에 보기: 해 본 패턴마다 한 줄(11/10). */
export async function board() {
  const [{ readEvents }, { readLessons }, { PATTERNS }] = await Promise.all([import("./state.ts"), import("./lessons.ts"), import("./patterns.ts")]);
  const [events, lessons] = await Promise.all([readEvents(), readLessons()]);
  const touched = new Set([...events.flatMap((e) => e.patterns), ...lessons.map((l) => l.pattern)]);
  return PATTERNS.filter((p) => touched.has(p.id)).map((p) => { const s = summarize(p.id, events, lessons); return { id: p.id, name: p.name, stage: s.stage, marks: s.marks, open: s.open, wrong: s.resolved ? undefined : s.wrong }; })
    .sort((a, b) => Number(b.open > 0) - Number(a.open > 0));
}

/** AI 힌트·설명에 넣을 학습자 기록(11/10, 사용자 "통으로 주면 비효율, 유형에 맞춰 골라서"): 이 문제의 패턴만, 아직 해결 안 된 착각만,
 *  많아야 5줄·약 300자. 고르는 건 코드(패턴 id 맞추기)이고 AI를 부르지 않는다. 재료가 없는 문제면 "". */
export async function learnerNoteFor(problemId: string) {
  // 11/11: ③ 학습자 기억(memory.ts)의 이 문제 패턴 줄만. 태그 한 줄씩.
  const [{ numberOfProblem, patternsOfNumber }, { readMemory, memoryText, MEMORY_LEGEND }] = await Promise.all([import("./links.ts"), import("./memory.ts")]);
  const n = await numberOfProblem(problemId);
  const patterns = n ? await patternsOfNumber(n) : [];
  if (!patterns.length) return "";
  const text = memoryText(await readMemory(), { patterns, maxRows: 4 });
  return text ? `[학습자의 지난 기록] ${MEMORY_LEGEND}\n${text}\n착각이 지금 막힌 곳과 같으면 "지난번에도 …"처럼 짧게 짚는다. 상관없으면 말하지 않는다.` : "";
}
