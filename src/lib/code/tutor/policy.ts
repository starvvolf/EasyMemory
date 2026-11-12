// PS 튜터: 다음에 할 일 고르기 (2026-11-08). AI 없이 규칙으로 정한다. 추천 단위는 문제가 아니라
// (문제, 활동, 목표 능력, 단원 숨김, 예상 시간)이다: 같은 문제도 "판단 드릴"과 "혼자 구현"은 다른 활동.
//   순서: ① 날짜가 된 복습(최대 2개, 단원 숨김) ② 처음이면 진단(단원이 다른 문제 6개를 단원 숨김으로)
//         ③ 지금 배우는 패턴의 다음 단계 ④ 섞기(최근 활동 넷 중 섞인 것이 없으면 배운 패턴에서 하나)
//   지금 배우는 패턴 = 목록 순서에서 아직 단단하지 않은(solid 아님) 첫 패턴. 그 패턴의 다음 단계:
//     처음(도움 수준 0) → 시범(강의 연습 문제 우선) → 인식 드릴(새 문제 2개 맞힐 때까지)
//     → 설계(새 문제 1개) → 혼자 구현(새 문제 1개). 인식에서 2번 연속 틀리면 대조 예시,
//     어느 능력이든 3번 연속 틀리면 다른 문제로 다시 시범, 구현을 2번 연속 틀리면 설계로 한 칸 물러남.
//   11/12 사용자 "시작하기 전에 점검 필요 없지 않냐… 걍 빼고 다 없애고": 처음 진단(6문제)·설문·빠른 확인을 없앴다.
//     ③ 배우는 순서 = 분야 집중(고른 것)이 있으면 그것, 없으면 커리큘럼 순서. 처음이어도 바로 맨 앞 패턴의 시범부터.
//   11/11 "도움 받은 건 혼자 다시": 도움을 받고 통과한 문제는 하루 뒤 같은 문제를 혼자 다시 푸는 할 일로 돌아온다(맨 앞, 한 번에 하나).
//     처음 짜 보는 패턴은 뼈대에서 핵심 줄만 채우기(fill)부터: 계획 3분 → 혼자 25분 사이가 너무 멀어서.
//   거르는 규칙: 그 능력으로 이미 본 문제는 새 문제 평가로 쓰지 않는다(없으면 가장 오래된 것, 등급은 E2로 기록됨).
import type { ProblemModel } from "./problem-model.ts";
import { PATTERNS } from "./patterns.ts";
import { isFresh, type Ability, type LearnerState } from "./state.ts";
import { ORDERED, type Profile } from "./profile.ts";

/** 배울 순서(11/11): 분야 집중이 남아 있으면 그 패턴만, 아니면 커리큘럼 순서(curriculum.ts). 단단해진 것·건너뛴 것은 뺀다. */
export function learningOrder(state: LearnerState, profile?: Profile) {
  // 커리큘럼 순서 하나로(11/11).
  const base = ORDERED;
  const focus = (profile?.focus ?? []).filter((id) => !state.patterns[id]?.solid);
  return { focused: focus.length > 0, list: (focus.length ? base.filter((p) => focus.includes(p.id)) : base).filter((p) => !state.patterns[p.id]?.solid) };
}

export type ActionKind = "walkthrough" | "contrast" | "drill" | "design" | "implement";
export type Action = { id: string; kind: ActionKind; number: string; pattern: string; ability?: Ability; mixed: boolean; minutes: number; why: string;
  /** 도움 받고 푼 문제를 혼자 다시(11/11) */ redo?: boolean; /** 뼈대에서 핵심 줄만 채우기(11/11) */ fill?: boolean };
const MINUTES: Record<ActionKind, number> = { walkthrough: 5, contrast: 3, drill: 1, design: 3, implement: 25 };
const ABILITY_OF: Partial<Record<ActionKind, Ability>> = { drill: "recognize", design: "design", implement: "execute" };
const KIND_OF: Record<Ability, ActionKind> = { recognize: "drill", design: "design", execute: "implement" };

const actionId = (a: Omit<Action, "id">) => `${a.kind}:${a.number}:${a.pattern}:${a.mixed ? "m" : "c"}`;
const make = (a: Omit<Action, "id" | "minutes" | "ability">): Action => ({ ...a, id: actionId({ ...a, minutes: 0 }), minutes: MINUTES[a.kind], ...(ABILITY_OF[a.kind] ? { ability: ABILITY_OF[a.kind] } : {}) });

/** 이 패턴의 문제 중 그 능력으로 처음 보는 것(강의 문제를 원하면 먼저). 없으면 가장 오래전에 본 것. */
function pick(models: ProblemModel[], state: LearnerState, pattern: string, ability: Ability | "walkthrough", prefer: "lecture" | "basic", avoid: Set<string>, now = Date.now()): ProblemModel | null {
  const pool = models.filter((m) => m.patterns.includes(pattern) && !avoid.has(m.number) && (ability === "walkthrough" ? m.walkthrough.choose : ability === "recognize" ? m.approaches.length : ability === "design" ? m.state.wrong.length && m.complexity : true));
  if (!pool.length) return null;
  const freshFor = (m: ProblemModel) => ability === "walkthrough" ? !state.exposed.has(m.number) : isFresh(state.events, m.number, ability);
  const lastSeen = (m: ProblemModel) => state.events.filter((e) => e.number === m.number).at(-1)?.at ?? "";
  const ordered = [...pool].sort((a, b) => Number(freshFor(b)) - Number(freshFor(a)) || Number(b.role === prefer) - Number(a.role === prefer) || lastSeen(a).localeCompare(lastSeen(b)) || a.number.localeCompare(b.number));
  // 11/11 시험(못하는 학습자로 3000에서): 방금 답을 본 문제를 바로 또 묻지 않는다. 알아채기·계획은 답을 이미 봤으니, 30분 안에 답한 문제뿐이면
  // 재료가 더 올 때까지 기다린다(같은 문제를 맞힐 때까지 되풀이하던 것). 짜기는 같은 문제를 다시 내도 된다.
  const best = ordered[0];
  if ((ability === "recognize" || ability === "design") && !freshFor(best) && now - Date.parse(lastSeen(best) || "1970-01-01") < 30 * 60_000) return null;
  return best;
}

export const REDO_AFTER_MS = 24 * 3600_000;
/** 혼자 다시 풀 문제(11/11): 도움을 받고(힌트·도움 칸·뼈대) 통과했고, 그 뒤 같은 문제를 혼자 통과한 적이 없는 것. 오래된 것부터.
 *  due = 하루가 지나 지금 풀 차례인지. */
export function redoList(state: LearnerState, now = new Date()) {
  const last = new Map<string, { at: string; pattern: string; alone: boolean }>();
  for (const e of state.events) if (e.kind === "implement" && e.ok) last.set(e.number, { at: e.at, pattern: e.patterns[0], alone: !e.hinted });
  return [...last].filter(([, v]) => !v.alone).map(([number, v]) => ({ number, pattern: v.pattern, since: v.at, due: now.getTime() - Date.parse(v.at) >= REDO_AFTER_MS })).sort((a, b) => a.since.localeCompare(b.since));
}

/** 마지막으로 알아채기를 틀린 뒤 이미 비교를 한 번 했나(11/11 시험: 비교를 맞혀도 알아채기 연속 틀림은 그대로라 비교만 끝없이 이어졌다).
 *  비교는 연속 틀림 한 번에 한 번만. 그다음은 다시 알아채기 문제로. */
function comparedSinceMiss(state: LearnerState, pattern: string) {
  const mine = state.events.filter((e) => e.patterns.includes(pattern));
  const lastMiss = mine.filter((e) => e.ability === "recognize" && e.ok === false).at(-1)?.at ?? "";
  return mine.some((e) => e.kind === "contrast" && e.at >= lastMiss);
}
export function nextActions(state: LearnerState, modelMap: Record<string, ProblemModel>, now = new Date(), limit = 5, profile?: Profile): Action[] {
  const models = Object.values(modelMap);
  if (!models.length) return [];
  const out: Action[] = [];
  const used = new Set<string>();
  const push = (a: Action | null) => { if (a && !out.some((x) => x.id === a.id) && out.length < limit) { out.push(a); used.add(a.number); } };
  const covered = PATTERNS.filter((p) => models.some((m) => m.patterns.includes(p.id)));
  const order = learningOrder(state, profile);

  // ⓪ 도움 받고 푼 문제를 혼자 다시(하루 뒤, 한 번에 하나).
  const redo = redoList(state, now).find((r) => r.due && modelMap[r.number]);
  if (redo) push(make({ kind: "implement", number: redo.number, pattern: redo.pattern, mixed: false, why: "지난번에 도움을 받고 푼 문제예요. 이번엔 혼자 다시 풀어 봐요", redo: true }));

  // ① 날짜가 된 복습: 단원을 숨기고 묻는다.
  const due = covered.flatMap((p) => (["recognize", "design", "execute"] as const).map((ab) => ({ p, ab, a: state.patterns[p.id].abilities[ab] })))
    .filter((x) => x.a.dueAt && Date.parse(x.a.dueAt) <= now.getTime()).sort((x, y) => (x.a.dueAt ?? "").localeCompare(y.a.dueAt ?? "")).slice(0, order.focused ? 1 : 2); // 분야 집중 중엔 복습을 하나만(나머지는 미뤄짐)
  for (const d of due) {
    const m = pick(models, state, d.p.id, d.ab, "basic", used, now.getTime());
    if (m) push(make({ kind: KIND_OF[d.ab], number: m.number, pattern: d.p.id, mixed: true, why: `${d.p.name}: 다시 볼 날이에요` }));
  }

  // 시작 전 점검(설문 · 빠른 확인 · 처음 진단 6문제)은 없앴다(11/12 사용자 "시작하기 전에 점검하는 거 필요 없지 않냐… 걍 빼고 다 없애고"):
  // 실력은 실제로 푼 기록(사건 · 문제 한 장 · 총정리)이 정한다. 처음이면 바로 ③으로 커리큘럼 맨 앞 패턴부터.

  // ③ 지금 배우는 패턴의 다음 단계.
  // 분야 집중이면 고른 것 안에서만(재료가 아직 없으면 오면 그때). 아니면 재료가 있는 것 중 순서대로.
  const current = order.focused ? (order.list[0] && covered.includes(order.list[0]) ? order.list[0] : undefined) : order.list.find((p) => covered.includes(p));
  if (current) {
    const ps = state.patterns[current.id];
    const r = ps.abilities.recognize, d = ps.abilities.design, x = ps.abilities.execute;
    const stuck = (["recognize", "design", "execute"] as const).find((ab) => ps.abilities[ab].failStreak >= 3);
    if (r.help === 0 && !ps.seen) {
      const m = pick(models, state, current.id, "walkthrough", "lecture", used, now.getTime());
      if (m) push(make({ kind: "walkthrough", number: m.number, pattern: current.id, mixed: false, why: `새로 배울 것: ${current.name}` }));
    } else if (stuck) {
      const m = pick(models, state, current.id, "walkthrough", "lecture", used, now.getTime());
      if (m) push(make({ kind: "walkthrough", number: m.number, pattern: current.id, mixed: false, why: `${current.name}: 3번 연달아 틀려서 다른 문제로 풀이 과정을 다시 봐요` }));
    } else if (r.failStreak >= 2 && !comparedSinceMiss(state, current.id)) {
      // 방금(30분 안) 비교한 문제는 다시 내지 않는다(11/11 시험: 비교를 맞혀도 알아채기 연속 틀림이 그대로라 같은 비교가 되풀이됐다).
      const comparedJustNow = (n: string) => state.events.some((e) => e.kind === "contrast" && e.number === n && now.getTime() - Date.parse(e.at) < 30 * 60_000);
      const m = models.find((mm) => mm.patterns.includes(current.id) && mm.contrast && !used.has(mm.number) && !comparedJustNow(mm.number));
      if (m) push(make({ kind: "contrast", number: m.number, pattern: current.id, mixed: false, why: `${current.name}: 언제 쓰는지 헷갈려서 비슷한 문제와 비교해 봐요` }));
    }
    const needR = 2;
    const step: Ability = r.freshWins < needR ? "recognize" : d.freshWins < 1 ? "design" : x.freshWins < 1 && x.failStreak < 2 ? "execute" : x.freshWins < 1 ? "design" : "recognize";
    const m = pick(models, state, current.id, step, "basic", used, now.getTime());
    const why = step === "recognize" ? `${current.name}: 문제를 보고 이 방법을 떠올려 봐요` : step === "design" ? (x.failStreak >= 2 ? `${current.name}: 짜기를 2번 틀려서 계획부터 다시 세워 봐요` : `${current.name}: 풀면서 적어 둘 것과 걸리는 시간을 정해 봐요`) : `${current.name}: 혼자 직접 짜 봐요`;
    // 이 패턴을 처음 짜 보는 거면 뼈대에서 핵심 줄만 채우기부터(도움 받은 것으로 남고, 다음엔 다른 문제를 혼자).
    const first = step === "execute" && x.independent.n + x.assisted.n === 0;
    if (m) push(make({ kind: KIND_OF[step], number: m.number, pattern: current.id, mixed: false, why: first ? `${current.name}: 처음 짜 보는 거라, 뼈대 코드에서 핵심 줄만 채워 봐요` : why, ...(first ? { fill: true } : {}) }));
  }

  // ④ 섞기: 최근 활동 넷 중 단원을 숨긴 것이 없으면, 배운 패턴 중 오래된 것에서 하나.
  const recent = state.events.filter((e) => e.ability).slice(-4);
  if (recent.length >= 4 && !recent.some((e) => e.mixed)) {
    const learned = covered.filter((p) => p.id !== current?.id && state.patterns[p.id].seen).sort((a, b) => (state.patterns[a.id].lastAt ?? "").localeCompare(state.patterns[b.id].lastAt ?? ""));
    for (const p of learned) {
      const m = pick(models, state, p.id, "recognize", "basic", used, now.getTime());
      if (m) { push(make({ kind: "drill", number: m.number, pattern: p.id, mixed: true, why: `섞어 풀기: 어느 단원인지 모른 채 ${p.name}을 알아채는지 봐요` })); break; }
    }
  }
  return out;
}
