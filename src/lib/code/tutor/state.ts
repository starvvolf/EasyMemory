// PS 튜터: 학습자 상태 (2026-11-08). 사건 기록(code/tutor/events.jsonl, 덧붙이기만)에서 상태를 계산한다. 상태를 바꾸는 것은
// 코드가 확인한 사실뿐이다(드릴·설계의 정답 대조, 예측과 실제 출력 비교, 채점 결과). AI는 여기에 끼지 않는다.
//   - 패턴 × 능력(인식·설계·실행)마다: 혼자 한 것과 도움 받은 것을 따로 센다, 증거 등급(E0~E4), 복습 상자, 도움 수준(H0~H3).
//   - 증거 등급: E0 시범·대조를 봄 / E1 도움 받고 맞힘 / E2 본 문제를 혼자 / E3 새 문제를 혼자(단원 보임) / E4 섞인 새 문제를 혼자(단원 숨김).
//   - 졸업은 E2만으로 안 된다(E3·E4가 있어야). 복습 상자는 기억 저장소와 같은 간격(10분→1→3→7→16→35일).
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { REVIEW_BOXES } from "../../knowledge/api.ts";
import { PATTERNS } from "./patterns.ts";

export const ABILITIES = ["recognize", "design", "execute"] as const;
export type Ability = (typeof ABILITIES)[number];
export const ABILITY_LABEL: Record<Ability, string> = { recognize: "방법 알아채기", design: "계획 세우기", execute: "직접 짜기" };
export type EventKind = "walkthrough" | "predict" | "contrast" | "drill" | "design" | "implement" | "skip" | "review";
export type TutorEvent = {
  id: string; at: string; kind: EventKind; number: string; patterns: string[];
  ability?: Ability; ok?: boolean; grade: 0 | 1 | 2 | 3 | 4; hinted?: boolean; mixed?: boolean; ms?: number; detail?: string;
};
export const GRADE_LABEL = ["풀이를 봄", "도움 받고 맞힘", "본 적 있는 문제를 혼자 맞힘", "처음 보는 문제를 혼자 맞힘", "단원도 모른 채 처음 보는 문제를 혼자 맞힘"] as const;
export const HELP_LABEL = ["시범", "따라 하기", "힌트", "실전"] as const;

const dir = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "code", "tutor");
const file = () => path.join(dir(), "events.jsonl");
export async function readEvents(): Promise<TutorEvent[]> {
  try { return (await readFile(file(), "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as TutorEvent); } catch { return []; }
}
export async function appendEvent(e: Omit<TutorEvent, "id" | "at"> & { at?: string }): Promise<TutorEvent> {
  const event: TutorEvent = { id: `te_${randomBytes(5).toString("hex")}`, at: e.at ?? new Date().toISOString(), ...e };
  await mkdir(dir(), { recursive: true });
  await appendFile(file(), `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

/** 이 문제를 그 능력으로 처음 보는가: 시범으로 본 적도, 같은 능력으로 시도한 적도 없을 때. */
export function isFresh(events: TutorEvent[], number: string, ability: Ability) {
  return !events.some((e) => e.number === number && (e.kind === "walkthrough" || e.ability === ability));
}
/** 시도의 증거 등급(코드가 정함): 도움 → 1, 본 문제 → 2, 새 문제 → 3, 단원 숨긴 새 문제 → 4. */
export function gradeOf(events: TutorEvent[], number: string, ability: Ability, opts: { hinted?: boolean; mixed?: boolean }): TutorEvent["grade"] {
  if (opts.hinted) return 1;
  if (!isFresh(events, number, ability)) return 2;
  return opts.mixed ? 4 : 3;
}

export type AbilityState = {
  independent: { s: number; n: number }; assisted: { s: number; n: number };
  /** (성공+1)/(시도+2): 한 문제만 맞혀서 100%가 되지 않게 */ accuracy: number | null;
  /** 서로 다른 새 문제(E3·E4)에서 혼자 맞힌 문제 수 */ freshWins: number; bestGrade: number;
  failStreak: number; box: number | null; dueAt: string | null; lastAt: string | null; help: 0 | 1 | 2 | 3;
};
export type PatternState = { id: string; name: string; seen: boolean; abilities: Record<Ability, AbilityState>; solid: boolean; graduated: boolean; lastAt: string | null };
export type LearnerState = { patterns: Record<string, PatternState>; events: TutorEvent[]; exposed: Set<string> };

const empty = (): AbilityState => ({ independent: { s: 0, n: 0 }, assisted: { s: 0, n: 0 }, accuracy: null, freshWins: 0, bestGrade: -1, failStreak: 0, box: null, dueAt: null, lastAt: null, help: 0 });

/** 사건 기록 → 상태. 같은 기록이면 늘 같은 상태(시험 가능). */
export function computeState(events: TutorEvent[]): LearnerState {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const patterns: Record<string, PatternState> = {};
  for (const p of PATTERNS) patterns[p.id] = { id: p.id, name: p.name, seen: false, abilities: { recognize: empty(), design: empty(), execute: empty() }, solid: false, graduated: false, lastAt: null };
  const wins: Record<string, Set<string>> = {};
  for (const e of sorted) {
    for (const pid of e.patterns) {
      const ps = patterns[pid];
      if (!ps) continue;
      ps.lastAt = e.at;
      // 시범을 건너뛰어도(skip) 본 것으로 친다: 바로 드릴로 가고, 틀리면 그때 필요한 시범만 나온다.
      if (e.kind === "walkthrough" || e.kind === "contrast" || e.kind === "predict" || e.kind === "skip") { ps.seen = true; continue; }
      if (!e.ability || e.ok === undefined) continue;
      const a = ps.abilities[e.ability];
      a.lastAt = e.at;
      if (e.hinted) { a.assisted.n++; if (e.ok) a.assisted.s++; continue; }
      a.independent.n++;
      if (e.ok) {
        a.independent.s++; a.failStreak = 0;
        a.bestGrade = Math.max(a.bestGrade, e.grade);
        if (e.grade >= 3) (wins[`${pid}:${e.ability}`] ??= new Set()).add(e.number);
        a.box = Math.min((a.box ?? -1) + 1, REVIEW_BOXES.length - 1);
      } else { a.failStreak++; a.box = 0; }
      a.dueAt = new Date(Date.parse(e.at) + REVIEW_BOXES[a.box]).toISOString();
    }
  }
  for (const ps of Object.values(patterns)) {
    for (const ab of ["recognize", "design", "execute"] as const) {
      const a = ps.abilities[ab];
      a.freshWins = wins[`${ps.id}:${ab}`]?.size ?? 0;
      a.accuracy = a.independent.n ? (a.independent.s + 1) / (a.independent.n + 2) : null;
      // 도움 수준: 처음엔 시범, 본 뒤엔 따라 하기, 새 문제를 혼자 2개 맞힐 때마다 한 단계, 2번 연속 틀리면 한 단계 내림(시범 본 뒤로는 따라 하기 아래로 안 감).
      let help = !ps.seen && a.freshWins === 0 ? 0 : Math.min(3, 1 + Math.floor(a.freshWins / 2));
      if (a.failStreak >= 2) help = Math.max(ps.seen ? 1 : 0, help - 1);
      a.help = help as AbilityState["help"];
    }
    const r = ps.abilities.recognize, d = ps.abilities.design, x = ps.abilities.execute;
    ps.solid = r.freshWins >= 2 && d.freshWins >= 1 && x.freshWins >= 1;
    ps.graduated = ps.solid && [r, d, x].some((a) => a.bestGrade >= 4) && [r, d, x].every((a) => (a.box ?? 0) >= 3);
  }
  const exposed = new Set(sorted.filter((e) => e.kind === "walkthrough").map((e) => e.number));
  return { patterns, events: sorted, exposed };
}
