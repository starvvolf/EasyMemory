// 범위 · 세기 · 사다리 (설계 1 · 2 · 4 · 6번). 코드만.
//   범위(장면 길이)는 빈틈의 종류가 정하고, 세기(간격 · 시작 거리)는 얼마나 막혔는지가 정한다. 틀린 횟수는 범위를 키우지 않는다.
//   사다리: 통과하면 한 칸 멀리(똑같이 → 비슷하게 → 응용), 틀리면 한 칸 가까이. 응용을 통과해야 앎.
import type { Distance, Format, Gap, GapKind, GapState, Scope, SceneVerdict } from "./types.ts";

export type Signals = { wrongTries?: number; asked?: number; helpRung?: number; tutorCode?: boolean; gaveUp?: boolean; repeated?: boolean };

const LINE: GapKind[] = ["문법", "한 줄 읽기", "알고리즘 고르기", "문제 읽기", "실행 · 도구", "오류 읽기"];
export function scopeOf(kind: GapKind, s: Signals): Scope {
  if (LINE.includes(kind)) return "line";
  // 혼자 못 쓴 것(튜터가 코드를 줌 · 뼈대 칸 · 포기)은 빈칸으로는 확인이 안 된다 → 함수
  if ((kind === "알고리즘 구현" || kind === "자료 구현") && (s.tutorCode || (s.helpRung ?? 0) >= 4 || s.gaveUp)) return "function";
  return "piece";
}
export function doseOf(s: Signals): 1 | 2 | 3 {
  if ((s.helpRung ?? 0) >= 3 || s.tutorCode || s.gaveUp) return 3;
  if ((s.wrongTries ?? 0) >= 2 || (s.helpRung ?? 0) >= 1 || s.repeated) return 2;
  return 1;
}
const DAY = 86_400_000;
const at = (days: number, now = Date.now()) => new Date(now + days * DAY).toISOString();
export function firstState(dose: 1 | 2 | 3, now = Date.now()): GapState {
  return { distance: dose === 3 ? "same" : "near", passes: 0, sameMistakes: 0, unclear: 0, otherMistakes: 0, known: false, due: at(dose === 3 ? 1 : dose === 2 ? 1 : 2, now) , streak: { same: 0, unclear: 0 } };
}
const FAR: Record<Distance, Distance> = { same: "near", near: "far", far: "far" };
const NEAR: Record<Distance, Distance> = { same: "same", near: "same", far: "near" };
const GAPS = [1, 3, 7, 14, 30];

/** 판정 하나를 빈틈 상태에 반영. 장면 길이(범위)는 바뀌지 않는다. */
export function reflect(gap: Gap, verdict: SceneVerdict, o: { hinted?: boolean; gaveUp?: boolean } = {}, now = Date.now()): Gap {
  const s: GapState = { ...gap.state, streak: { ...gap.state.streak } };
  let level = gap.dose.level;
  if (verdict === "pass" && !o.hinted) {
    s.streak = { same: 0, unclear: 0 };
    if (s.distance === "far") { s.known = true; s.due = at(30, now); }
    else { s.distance = FAR[s.distance]; s.due = at(level === 3 ? 1 : GAPS[Math.min(s.passes, GAPS.length - 1)], now); }
    s.passes++;
  } else if (verdict === "pass") {
    // 힌트를 보고 통과 = 도움받고 넘어감 = 아직 몰랐음(리뷰 기준과 같음)
    s.due = at(1, now);
  } else if (verdict === "same" || o.gaveUp) {
    if (verdict === "same") { s.sameMistakes++; s.streak.same++; level = Math.min(3, level + 1) as 1 | 2 | 3; }
    s.streak.unclear = 0;
    s.known = false;
    s.distance = s.streak.same >= 2 ? "same" : NEAR[s.distance];
    s.due = at(1, now);
  } else if (verdict === "other") {
    // 이 빈틈이 아니라 다른 것: 기록은 안 깎고 며칠 뒤 한 번 더
    s.otherMistakes++;
    s.due = at(3, now);
  } else {
    s.unclear++; s.streak.unclear++; s.streak.same = 0;
    if (s.streak.unclear >= 2) s.distance = "same";
    s.due = at(2, now);
  }
  return { ...gap, dose: { level }, state: s, ...(s.unclear >= 3 && s.passes === 0 ? { doubtful: true } : {}) };
}

/** 종류 · 범위 · 거리 · 확인할 것 → 형식 (표 한 장, 설계 4번). 똑같이는 그때 틀린 코드가 있으면 고치기. */
export function formatOf(gap: Pick<Gap, "kind" | "scope" | "target" | "state" | "evidence">, hasWrongSubmission: boolean): Format {
  if (gap.state.distance === "same" && hasWrongSubmission) return "fix";
  if (gap.target === "form") return "blank";
  switch (gap.kind) {
    case "한 줄 읽기": case "알고리즘 원리": return "predict";
    case "알고리즘 고르기": case "실행 · 도구": case "오류 읽기": return "choice";
    case "자료 담기": return gap.state.distance === "far" ? "write" : "choice";
    case "문제 읽기": return gap.state.distance === "far" ? "write" : "choice";
    case "알고리즘 구현": case "자료 구현": return gap.scope === "function" ? "write" : "blank";
    default: return "write";
  }
}
/** 하루 분량(설계 4번): 오늘 볼 빈틈, 낮은 층부터. 장면 하나 약 1~4분, 기본 10분까지. */
export const MINUTES: Record<Format, number> = { choice: 1, predict: 1, blank: 2, write: 3, fix: 4 };
export function dueToday(gaps: Gap[], now = Date.now(), budget = 10) {
  const due = gaps.filter((g) => !g.state.known && Date.parse(g.state.due) <= now).sort((a, b) => a.layer - b.layer || Date.parse(a.state.due) - Date.parse(b.state.due));
  const out: Gap[] = []; let used = 0;
  for (const g of due) { const m = g.scope === "function" ? 6 : g.scope === "piece" ? 3 : 1; if (out.length && used + m > budget) break; out.push(g); used += m; }
  return { gaps: out, minutes: used, more: due.length - out.length };
}
