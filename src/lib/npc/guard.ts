// 검사 (설계 5번). 코드 + 채점기, AI는 의심될 때만 싼 판정 1번.
//   1 길의 판정과 맞는지: NPC 코드를 진짜 채점기로 돌려 그 길 · 그 자리 조각의 잰 판정과 같은지(다르면 한 번 다시 → 또 다르면 "재현 못 함").
//   2 문법 누수: 모르는 문법 조각의 모양(leak 정규식)이 코드에 나오면 다시 쓴다. 문법에만.
//   3 조각 밖 지식(의심): 코드가 걸음 수 · 지도 코드보다 훨씬 길거나, 길에 없는 반복 구조가 보이면 의심 → (켜면) AI 1번.
//   4 다 배운 뒤: 조각을 다 가진 NPC의 코드는 맞아야 한다(아니면 하네스 버그).
import { judge, type TestCase } from "../code/run.ts";
import { expectedVerdict, linesOf, program } from "./map.ts";
import type { Fragment, ProblemMap, Route } from "./types.ts";

export type Verdicted = { verdict: string; passed: number; total: number; first?: { input: string; expected: string; got: string; stderr: string; verdict: string }; compile: string };
export async function verdictOf(code: string, tests: TestCase[], timeLimitMs: number): Promise<Verdicted> {
  const j = await judge("python", code, tests, { timeLimitMs, stopAtFirstFail: true });
  const r = j.results.find((x) => x.verdict !== "AC");
  return { verdict: j.verdict, passed: j.passed, total: tests.length, compile: j.compile, ...(r ? { first: { input: r.input, expected: r.expected, got: r.got, stderr: r.stderr, verdict: r.verdict } } : {}) };
}
const measuredCache = new Map<string, string>();
/** 이 길 · 이 자리 조각의 판정: 잰 값, 없으면(자리 둘 이상이 틀림) 지금 재서 기억한다. */
export async function routeVerdict(route: Route, picks: Record<string, string>, tests: TestCase[], timeLimitMs: number) {
  const known = expectedVerdict(route, picks);
  if (known) return known;
  const k = `${route.id}|${JSON.stringify(picks)}|${tests.length}`;
  if (!measuredCache.has(k)) measuredCache.set(k, (await verdictOf(program(route, picks), tests, timeLimitMs)).verdict);
  return measuredCache.get(k)!;
}

/** 2 문법 누수: 모르는 문법 조각들의 모양이 나왔나(나온 조각 id들) */
export function syntaxLeaks(code: string, unknownSyntax: Fragment[]) {
  const body = code.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  return unknownSyntax.filter((f) => f.layer === 1 && (f.leak ?? []).some((p) => { try { return new RegExp(p).test(body); } catch { return false; } })).map((f) => f.id);
}

const LOOPS = /^\s*(for|while)\b/gm;
/** 3 의심: 지도 코드보다 2배 넘게 길거나(최소 8줄 차이), 반복이 2개 넘게 많음 */
export function suspicion(code: string, route: Route, picks: Record<string, string>): string | null {
  const ref = program(route, picks);
  const a = linesOf(code), b = linesOf(ref);
  const la = (code.match(LOOPS) ?? []).length, lb = (ref.match(LOOPS) ?? []).length;
  if (a > b * 2 && a - b >= 8) return `코드가 지도 코드보다 많이 김(${a}줄 대 ${b}줄)`;
  if (la > lb + 1) return `길에 없는 반복 구조(반복 ${la}개 대 ${lb}개)`;
  return null;
}

export type GuardResult = { verdict: Verdicted; expected: string; match: boolean; leaks: string[]; suspect: string | null };
/** 1 · 2 · 3을 한 번에 */
export async function guardCode(input: { code: string; route: Route; picks: Record<string, string>; unknownSyntax: Fragment[]; tests: TestCase[]; timeLimitMs: number }): Promise<GuardResult> {
  const [verdict, expected] = await Promise.all([verdictOf(input.code, input.tests, input.timeLimitMs), routeVerdict(input.route, input.picks, input.tests, input.timeLimitMs)]);
  return { verdict, expected, match: verdict.verdict === expected, leaks: syntaxLeaks(input.code, input.unknownSyntax), suspect: suspicion(input.code, input.route, input.picks) };
}

/** 4 다 배운 뒤: 맞는 조각을 다 가진 사람이 갈 맞는 길이 하나라도 AC여야 한다. 잰 지도로 코드 확인(하네스 점검). */
export function allLearnedCheck(map: ProblemMap): { ok: boolean; why: string } {
  const right = map.routes.filter((r) => !r.needs.some((n) => map.fragments.find((f) => f.id === n)?.wrong));
  const ac = right.filter((r) => r.measured?.verdict === "AC");
  if (!right.length) return { ok: false, why: "틀린 조각이 없는 길이 하나도 없어요." };
  if (!ac.length) return { ok: false, why: `맞는 조각만 쓴 길(${right.map((r) => r.id).join(", ")})이 모두 AC가 아니에요: 지도 코드가 틀렸어요.` };
  const bad = right.filter((r) => r.measured && r.measured.verdict !== "AC");
  return { ok: !bad.length, why: bad.length ? `맞는 조각만 쓴 길 ${bad.map((r) => `${r.id}(${r.measured!.verdict})`).join(", ")}가 AC가 아니에요.` : `맞는 길 ${ac.map((r) => r.id).join(", ")} 모두 AC` };
}
