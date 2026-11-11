// ③ 알고리즘 학습자 기억 (11/11 사용자 "3번을 되게 잘 컴팩트하게… 거의 틀에 맞춰서… 시스템으로 태그처럼 관리되는 부분은 태그처럼").
// 여러 문제에 걸친 것을 코드가 모아 계산한다(AI 없음): 사건 기록(state.ts) · 배운 것 카드(lessons.ts) · 문제 한 장(sheets.ts) · 제출 기록.
// 한 줄 = 한 태그. AI에게 주는 글도, 화면에 보이는 것도 이 줄들이다. 어디에 쓰는지에 따라 고르는 줄만 다르다:
//   채팅·힌트 = 이 문제의 패턴 줄만 · 문제 찾기 = 해 본 패턴 전체 + 틀린 종류 + 최근.
import { readEvents, type TutorEvent } from "./state.ts";
import { readLessons, type Lesson } from "./lessons.ts";
import { readSheets, STUCK_NAME, type Sheet, type Stuck } from "./sheets.ts";
import { isResolved, summarize, type Mark } from "./summary.ts";
import { patternOf } from "./patterns.ts";
import { placeOf } from "./curriculum.ts";
import { readSubmissions, type Submission } from "../problems.ts";

export type PatternRow = {
  tag: string; name: string; step?: string;
  /** 알아채기·계획·짜기 마지막 결과: ok 혼자 맞힘 · help 도움 받고 · bad 틀림 · none 안 해 봄 */ marks: { recognize: Mark; design: Mark; execute: Mark };
  solo: number; helped: number; stuck?: Stuck;
  /** 아직 남은 착각(최근 것부터 둘까지) */ open: Array<{ gap: string; number: string }>;
  lastAt: string;
};
export type AlgoMemory = { rows: PatternRow[]; errors: Partial<Record<"WA" | "TLE" | "MLE" | "RE" | "CE", number>>; recent: string[] };

const MARK: Record<Mark, string> = { ok: "✓", help: "△", bad: "✗", none: "·" };
const ERROR_NAME: Record<string, string> = { WA: "틀린 답", TLE: "시간 초과", MLE: "메모리 초과", RE: "런타임 에러", CE: "컴파일 에러" };
const resultOf = (s: Sheet) => s.end === "paused" ? "하다 나감" : s.end === "gaveup" ? "그만둠" : s.skeleton ? "뼈대로" : s.help ? `도움${s.help}` : Object.keys(s.verdicts).length ? `혼자(${s.submits}번째)` : "혼자";

export function computeMemory(events: TutorEvent[], lessons: Lesson[], sheets: Sheet[], subs: Submission[]): AlgoMemory {
  const touched = new Set<string>([...events.flatMap((e) => e.patterns), ...lessons.map((l) => l.pattern), ...sheets.flatMap((s) => s.tags)]);
  const rows: PatternRow[] = [];
  for (const tag of touched) {
    const p = patternOf(tag);
    if (!p) continue;
    const s = summarize(tag, events, lessons);
    const impl = events.filter((e) => e.kind === "implement" && e.ok && e.patterns.includes(tag));
    const mySheets = sheets.filter((x) => x.tags.includes(tag));
    const stuckCount = new Map<Stuck, number>();
    for (const x of mySheets) if (x.stuck) stuckCount.set(x.stuck, (stuckCount.get(x.stuck) ?? 0) + 1);
    const stuck = [...stuckCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const open = lessons.filter((l) => l.pattern === tag && l.gap && !isResolved(l, events)).slice(-2).reverse().map((l) => ({ gap: l.gap, number: l.number }));
    const lastAt = [...events.filter((e) => e.patterns.includes(tag)).map((e) => e.at), ...mySheets.map((x) => x.at)].sort().at(-1) ?? "";
    rows.push({ tag, name: p.name, ...(placeOf(tag)?.code ? { step: placeOf(tag)!.code } : {}), marks: s.marks,
      solo: impl.filter((e) => !e.hinted).length, helped: impl.filter((e) => e.hinted).length, ...(stuck ? { stuck } : {}), open, lastAt });
  }
  rows.sort((a, b) => b.open.length - a.open.length || b.lastAt.localeCompare(a.lastAt));
  const errors: AlgoMemory["errors"] = {};
  for (const x of subs.filter((s) => s.mode === "submit").slice(-60)) if (ERROR_NAME[x.verdict]) errors[x.verdict as keyof AlgoMemory["errors"]] = (errors[x.verdict as keyof AlgoMemory["errors"]] ?? 0) + 1;
  const recent = sheets.slice(-5).map((x) => `${x.number ?? x.title.slice(0, 16)} ${resultOf(x)}`);
  return { rows, errors, recent };
}

/** 한 줄 = 한 태그. 예: #bfs-distance BFS 거리 [알4] 알✓ 계△ 짜✗ · 혼자1 도움2 · 막힘:경계·예외 · 착각:"…"(2178) */
export function rowLine(r: PatternRow) {
  return [`#${r.tag} ${r.name}${r.step ? ` [${r.step}]` : ""} 알${MARK[r.marks.recognize]} 계${MARK[r.marks.design]} 짜${MARK[r.marks.execute]}`,
    r.solo || r.helped ? `혼자${r.solo} 도움${r.helped}` : "", r.stuck ? `막힘:${STUCK_NAME[r.stuck]}` : "",
    ...r.open.map((o) => `착각:"${o.gap}"(${o.number})`)].filter(Boolean).join(" · ");
}
export function memoryText(m: AlgoMemory, opts: { patterns?: string[]; maxRows?: number; withErrors?: boolean; withRecent?: boolean } = {}) {
  const rows = (opts.patterns ? m.rows.filter((r) => opts.patterns!.includes(r.tag)) : m.rows).slice(0, opts.maxRows ?? 6);
  const errs = Object.entries(m.errors).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${ERROR_NAME[k]} ${n}`);
  const lines = [...rows.map(rowLine), opts.withErrors && errs.length ? `#틀린종류 ${errs.join(" · ")}` : "", opts.withRecent && m.recent.length ? `#최근 ${m.recent.join(" → ")}` : ""].filter(Boolean);
  return lines.join("\n");
}
export const MEMORY_LEGEND = "(알·계·짜 = 방법 알아채기·계획·직접 짜기, ✓ 혼자 맞힘 △ 도움 받고 ✗ 틀림 · 안 해 봄)";

export async function readMemory() {
  const [events, lessons, sheets, subs] = await Promise.all([readEvents(), readLessons(), readSheets(), readSubmissions()]);
  return computeMemory(events, lessons, sheets, subs);
}
