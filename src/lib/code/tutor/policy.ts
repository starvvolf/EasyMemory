// PS 튜터: 다음에 할 일 고르기 (2026-11-08). AI 없이 규칙으로 정한다. 추천 단위는 문제가 아니라
// (문제, 활동, 목표 능력, 단원 숨김, 예상 시간)이다: 같은 문제도 "판단 드릴"과 "혼자 구현"은 다른 활동.
//   순서: ① 날짜가 된 복습(최대 2개, 단원 숨김) ② 처음이면 진단(단원이 다른 문제 6개를 단원 숨김으로)
//         ③ 지금 배우는 패턴의 다음 단계 ④ 섞기(최근 활동 넷 중 섞인 것이 없으면 배운 패턴에서 하나)
//   지금 배우는 패턴 = 목록 순서에서 아직 단단하지 않은(solid 아님) 첫 패턴. 그 패턴의 다음 단계:
//     처음(도움 수준 0) → 시범(강의 연습 문제 우선) → 인식 드릴(새 문제 2개 맞힐 때까지)
//     → 설계(새 문제 1개) → 혼자 구현(새 문제 1개). 인식에서 2번 연속 틀리면 대조 예시,
//     어느 능력이든 3번 연속 틀리면 다른 문제로 다시 시범, 구현을 2번 연속 틀리면 설계로 한 칸 물러남.
//   11/11 사용자 시뮬레이션: ② 진단(6문제)은 설문으로 바꿈. 설문(profile.ts)이 있으면
//     ②' 알아요·잘해요라고 한 패턴을 쉬운 것부터 한 문제씩 확인(확인이 남아 있으면 배우기보다 먼저)
//     ③ 배우는 순서 = 분야 집중(고른 것)이 있으면 그것, 없으면 쉬운 순서. 잘해요+확인 통과는 건너뛰고 섞어 풀기에만.
//        알아요+확인 통과는 시범 없이, 알아채기는 1번만 더 맞히면 계획 세우기로.
//   11/11 "도움 받은 건 혼자 다시": 도움을 받고 통과한 문제는 하루 뒤 같은 문제를 혼자 다시 푸는 할 일로 돌아온다(맨 앞, 한 번에 하나).
//     처음 짜 보는 패턴은 뼈대에서 핵심 줄만 채우기(fill)부터: 계획 3분 → 혼자 25분 사이가 너무 멀어서.
//   거르는 규칙: 그 능력으로 이미 본 문제는 새 문제 평가로 쓰지 않는다(없으면 가장 오래된 것, 등급은 E2로 기록됨).
import type { ProblemModel } from "./problem-model.ts";
import { PATTERNS } from "./patterns.ts";
import { isFresh, type Ability, type LearnerState } from "./state.ts";
import { levelOf, ORDERED, type Profile } from "./profile.ts";

/** 잘해요라고 했고 확인도 맞혔으면 배우기에서 건너뛴다(섞어 풀기에만 나온다). */
const skipKnown = (profile: Profile | undefined, id: string) => Boolean(profile && levelOf(profile, id) === "good" && profile.checked[id] === "pass");
/** 배울 순서(11/11): 분야 집중이 남아 있으면 그 패턴만, 설문을 했으면 쉬운 순서, 아니면 목록 순서. 단단해진 것·건너뛴 것은 뺀다. */
export function learningOrder(state: LearnerState, profile?: Profile) {
  const base = profile?.surveyed ? ORDERED : PATTERNS;
  const focus = (profile?.focus ?? []).filter((id) => !state.patterns[id]?.solid);
  return { focused: focus.length > 0, list: (focus.length ? base.filter((p) => focus.includes(p.id)) : base).filter((p) => !state.patterns[p.id]?.solid && !skipKnown(profile, p.id)) };
}
/** 아직 확인 안 한 알아요·잘해요 패턴(쉬운 것부터). 이미 그 패턴을 풀어 봤으면 확인할 필요가 없다. */
export function pendingChecks(state: LearnerState, profile?: Profile) {
  if (!profile?.surveyed) return [];
  return ORDERED.filter((p) => (profile.levels[p.id] === "know" || profile.levels[p.id] === "good") && !profile.checked[p.id] && !state.events.some((e) => e.ability && e.patterns.includes(p.id)));
}

export type ActionKind = "walkthrough" | "contrast" | "drill" | "design" | "implement";
export type Action = { id: string; kind: ActionKind; number: string; pattern: string; ability?: Ability; mixed: boolean; minutes: number; why: string; /** 설문의 빠른 확인(11/11) */ check?: boolean;
  /** 도움 받고 푼 문제를 혼자 다시(11/11) */ redo?: boolean; /** 뼈대에서 핵심 줄만 채우기(11/11) */ fill?: boolean };
const MINUTES: Record<ActionKind, number> = { walkthrough: 5, contrast: 3, drill: 1, design: 3, implement: 25 };
const ABILITY_OF: Partial<Record<ActionKind, Ability>> = { drill: "recognize", design: "design", implement: "execute" };
const KIND_OF: Record<Ability, ActionKind> = { recognize: "drill", design: "design", execute: "implement" };

const actionId = (a: Omit<Action, "id">) => `${a.kind}:${a.number}:${a.pattern}:${a.mixed ? "m" : "c"}`;
const make = (a: Omit<Action, "id" | "minutes" | "ability">): Action => ({ ...a, id: actionId({ ...a, minutes: 0 }), minutes: MINUTES[a.kind], ...(ABILITY_OF[a.kind] ? { ability: ABILITY_OF[a.kind] } : {}) });

/** 이 패턴의 문제 중 그 능력으로 처음 보는 것(강의 문제를 원하면 먼저). 없으면 가장 오래전에 본 것. */
function pick(models: ProblemModel[], state: LearnerState, pattern: string, ability: Ability | "walkthrough", prefer: "lecture" | "basic", avoid: Set<string>): ProblemModel | null {
  const pool = models.filter((m) => m.patterns.includes(pattern) && !avoid.has(m.number) && (ability === "walkthrough" ? m.walkthrough.choose : ability === "recognize" ? m.approaches.length : ability === "design" ? m.state.wrong.length && m.complexity : true));
  if (!pool.length) return null;
  const freshFor = (m: ProblemModel) => ability === "walkthrough" ? !state.exposed.has(m.number) : isFresh(state.events, m.number, ability);
  const lastSeen = (m: ProblemModel) => state.events.filter((e) => e.number === m.number).at(-1)?.at ?? "";
  const ordered = [...pool].sort((a, b) => Number(freshFor(b)) - Number(freshFor(a)) || Number(b.role === prefer) - Number(a.role === prefer) || lastSeen(a).localeCompare(lastSeen(b)) || a.number.localeCompare(b.number));
  return ordered[0];
}

export const REDO_AFTER_MS = 24 * 3600_000;
/** 혼자 다시 풀 문제(11/11): 도움을 받고(힌트·도움 칸·뼈대) 통과했고, 그 뒤 같은 문제를 혼자 통과한 적이 없는 것. 오래된 것부터.
 *  due = 하루가 지나 지금 풀 차례인지. */
export function redoList(state: LearnerState, now = new Date()) {
  const last = new Map<string, { at: string; pattern: string; alone: boolean }>();
  for (const e of state.events) if (e.kind === "implement" && e.ok) last.set(e.number, { at: e.at, pattern: e.patterns[0], alone: !e.hinted });
  return [...last].filter(([, v]) => !v.alone).map(([number, v]) => ({ number, pattern: v.pattern, since: v.at, due: now.getTime() - Date.parse(v.at) >= REDO_AFTER_MS })).sort((a, b) => a.since.localeCompare(b.since));
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
    const m = pick(models, state, d.p.id, d.ab, "basic", used);
    if (m) push(make({ kind: KIND_OF[d.ab], number: m.number, pattern: d.p.id, mixed: true, why: `${d.p.name}: 다시 볼 날이에요` }));
  }

  // ②' 설문의 빠른 확인: 쉬운 것부터, 재료가 있는 것 중 둘까지. 남아 있으면 배우기보다 먼저.
  if (profile?.surveyed) {
    let n = 0;
    const checks = pendingChecks(state, profile);
    for (const p of checks) {
      const m = pick(models, state, p.id, "recognize", "basic", used);
      if (!m) continue;
      push(make({ kind: "drill", number: m.number, pattern: p.id, mixed: true, why: `「${profile.levels[p.id] === "good" ? "잘해요" : "알아요"}」라고 하셔서 한 문제만 확인해요: ${p.name}`, check: true }));
      if (++n >= 2) break;
    }
    // 확인할 것이 남았으면 재료가 아직 없어도 기다린다(뒤 패턴으로 건너뛰지 않게).
    if (n || checks.length) return out;
  }
  // ② (설문 전에 쓰던 것) 처음이면 진단: 단원이 다른 문제 6개, 단원 숨김. 설문이 있으면 하지 않는다.
  if (!state.events.length && !profile) {
    const seenChapters = new Set<string>();
    for (const m of [...models].sort((a, b) => a.number.localeCompare(b.number))) {
      if (seenChapters.has(m.chapter) || !m.approaches.length || m.role !== "basic") continue;
      seenChapters.add(m.chapter);
      push(make({ kind: "drill", number: m.number, pattern: m.patterns[0], mixed: true, why: "처음이라 무엇이 익숙한지 먼저 봐요" }));
      if (seenChapters.size >= 6) break;
    }
    return out;
  }

  // ③ 지금 배우는 패턴의 다음 단계.
  // 분야 집중이면 고른 것 안에서만(재료가 아직 없으면 오면 그때). 아니면 재료가 있는 것 중 순서대로.
  // 설문을 했으면 순서를 지킨다: 맨 앞 것의 재료가 아직 없으면 기다린다(쉬운 걸 건너뛰고 BFS부터 나오지 않게).
  const current = profile?.surveyed || order.focused ? (order.list[0] && covered.includes(order.list[0]) ? order.list[0] : undefined) : order.list.find((p) => covered.includes(p));
  const knownBefore = current && profile && levelOf(profile, current.id) === "know" && profile.checked[current.id] === "pass";
  if (current) {
    const ps = state.patterns[current.id];
    const r = ps.abilities.recognize, d = ps.abilities.design, x = ps.abilities.execute;
    const stuck = (["recognize", "design", "execute"] as const).find((ab) => ps.abilities[ab].failStreak >= 3);
    if (r.help === 0 && !ps.seen) {
      const m = pick(models, state, current.id, "walkthrough", "lecture", used);
      if (m) push(make({ kind: "walkthrough", number: m.number, pattern: current.id, mixed: false, why: `새로 배울 것: ${current.name}` }));
    } else if (stuck) {
      const m = pick(models, state, current.id, "walkthrough", "lecture", used);
      if (m) push(make({ kind: "walkthrough", number: m.number, pattern: current.id, mixed: false, why: `${current.name}: 3번 연달아 틀려서 다른 문제로 풀이 과정을 다시 봐요` }));
    } else if (r.failStreak >= 2) {
      const m = models.find((mm) => mm.patterns.includes(current.id) && mm.contrast && !used.has(mm.number));
      if (m) push(make({ kind: "contrast", number: m.number, pattern: current.id, mixed: false, why: `${current.name}: 언제 쓰는지 헷갈려서 비슷한 문제와 비교해 봐요` }));
    }
    const needR = knownBefore ? 1 : 2; // 알아요+확인 통과: 확인한 1번을 쳐서 계획 세우기로
    const step: Ability = r.freshWins < needR ? "recognize" : d.freshWins < 1 ? "design" : x.freshWins < 1 && x.failStreak < 2 ? "execute" : x.freshWins < 1 ? "design" : "recognize";
    const m = pick(models, state, current.id, step, "basic", used);
    const why = step === "recognize" ? `${current.name}: 문제를 보고 이 방법을 떠올려 봐요` : step === "design" ? (x.failStreak >= 2 ? `${current.name}: 짜기를 2번 틀려서 계획부터 다시 세워 봐요` : `${current.name}: 풀면서 적어 둘 것과 걸리는 시간을 정해 봐요`) : `${current.name}: 혼자 직접 짜 봐요`;
    // 이 패턴을 처음 짜 보는 거면 뼈대에서 핵심 줄만 채우기부터(도움 받은 것으로 남고, 다음엔 다른 문제를 혼자).
    const first = step === "execute" && x.independent.n + x.assisted.n === 0;
    if (m) push(make({ kind: KIND_OF[step], number: m.number, pattern: current.id, mixed: false, why: first ? `${current.name}: 처음 짜 보는 거라, 뼈대 코드에서 핵심 줄만 채워 봐요` : why, ...(first ? { fill: true } : {}) }));
  }

  // ④ 섞기: 최근 활동 넷 중 단원을 숨긴 것이 없으면, 배운 패턴 중 오래된 것에서 하나.
  const recent = state.events.filter((e) => e.ability).slice(-4);
  if (recent.length >= 4 && !recent.some((e) => e.mixed)) {
    const learned = covered.filter((p) => p.id !== current?.id && (state.patterns[p.id].seen || skipKnown(profile, p.id))).sort((a, b) => (state.patterns[a.id].lastAt ?? "").localeCompare(state.patterns[b.id].lastAt ?? ""));
    for (const p of learned) {
      const m = pick(models, state, p.id, "recognize", "basic", used);
      if (m) { push(make({ kind: "drill", number: m.number, pattern: p.id, mixed: true, why: `섞어 풀기: 어느 단원인지 모른 채 ${p.name}을 알아채는지 봐요` })); break; }
    }
  }
  return out;
}
