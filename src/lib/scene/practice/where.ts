// 13 어디에 넣을까 (설계 3번 실습 전용, 8번 FPS "탄약을 줄이는 코드에서 잠글 줄 범위 고르기. Interlocked로 바꾸는 답도 맞으면 통과(능력 확인)").
// 학습자가 줄 범위를 고르면 코드가 그 자리에 잠금 · 트랜잭션 · await · 검사를 넣어 실제로 돌린다(채점기는 알고리즘과 같은 것, ../exec.ts runAll).
// 정답 · 오답 모양은 돌려서 만든다: 모범 범위의 출력 = 정답, 그때 학습자가 건 범위의 출력 = 그때 생각의 모양. 준비 코드는 읽기와 쓰기 사이에 일부러 쉬어서
// 잠금이 없으면 늘 어긋난다(두 번씩 돌려 같은지 본다). 같은 실수 = 고른 범위가 그때 범위와 같은 모양(앞뒤의 빈 줄 · 괄호 줄은 빼고 비교).
import { runAll, shapeOf, type RunOut } from "../exec.ts";
import type { Graded } from "../grade.ts";
import type { Gap, Scene } from "../types.ts";

export type Range = { from: number; to: number };
export type WhereMaterial = {
  guard: "lock" | "transaction" | "await" | "check"; wrap: { before: string; after: string };
  /** 돌릴 프로그램 전체(표준 입력을 읽음) · 고를 수 있는 줄 · 모범 범위 · 그때 범위 · 다른 틀린 범위 */
  code: string; region: Range; answer: Range; mine: Range & { what: string }; others: Array<Range & { id: string; what: string }>;
  /** 다른 맞는 방법(능력 확인일 때): 고를 수 있는 줄 전체를 바꾸는 코드(예: Interlocked) */
  alsoRight: Array<{ what: string; code: string }>;
  inputs: string[];
  /** 학습자가 고를 수 있는 줄(모범 범위보다 넓어야 답이 드러나지 않는다). 없으면 region 앞뒤로 한 줄씩 넓힌 것 */
  pick?: Range;
};
const lines = (code: string) => code.replace(/\r/g, "").split("\n");
const indentOf = (l: string) => /^\s*/.exec(l)?.[0] ?? "";
/** 그 범위를 잠금 등으로 감싼 프로그램. 범위의 줄은 한 칸(4칸) 더 들여 쓴다(파이썬은 들여쓰기가 뜻이라) */
export function insertGuard(code: string, wrap: WhereMaterial["wrap"], r: Range) {
  const ls = lines(code);
  const from = Math.max(1, r.from), to = Math.min(ls.length, r.to);
  const pad = indentOf(ls[from - 1] ?? "");
  const body = ls.slice(from - 1, to).map((l) => (l.trim() ? `    ${l}` : l));
  const before = wrap.before.split("\n").map((l) => pad + l), after = wrap.after ? wrap.after.split("\n").map((l) => pad + l) : [];
  return [...ls.slice(0, from - 1), ...before, ...body, ...after, ...ls.slice(to)].join("\n");
}
/** 고를 수 있는 줄 전체를 다른 코드로(다른 맞는 방법). 들여쓰기는 그 줄의 것에 맞춘다 */
export function replaceRegion(code: string, region: Range, text: string) {
  const ls = lines(code);
  const t = lines(text.replace(/\s+$/, ""));
  // 들여쓰기: 바꿀 줄들의 가장 얕은 들여쓰기에 새 글의 가장 얕은 들여쓰기를 맞춘다(글을 통째로 옮겨 써도, 들여쓰기 없이 써도 된다)
  const minIndent = (xs: string[]) => Math.min(...xs.filter((l) => l.trim()).map((l) => indentOf(l).length), 99);
  const want = minIndent(ls.slice(region.from - 1, region.to)), base = minIndent(t);
  const shift = (l: string) => (want === 99 || base === 99 ? l : want >= base ? " ".repeat(want - base) + l : l.slice(base - want));
  return [...ls.slice(0, region.from - 1), ...t.map((l) => (l.trim() ? shift(l) : l)), ...ls.slice(region.to)].join("\n");
}
/** 범위의 "모양": 앞뒤의 빈 줄 · 괄호만 있는 줄 · 주석 줄은 빼고 남은 줄 */
export function normRange(code: string, r: Range): Range {
  const ls = lines(code);
  const empty = (n: number) => { const t = (ls[n - 1] ?? "").trim(); return !t || /^[{}()[\];,]+$/.test(t) || /^(\/\/|#)/.test(t); };
  let { from, to } = r;
  while (from < to && empty(from)) from++;
  while (to > from && empty(to)) to--;
  return { from, to };
}
const sameRange = (a: Range, b: Range) => a.from === b.from && a.to === b.to;
/** 고를 수 있는 줄: 모범 범위 = 고를 수 있는 줄 전체이면 답이 드러나므로(11/15 통합 시험) 앞뒤로 넓힌다 */
export const pickOf = (m: WhereMaterial): Range => m.pick ?? { from: Math.max(1, m.region.from - 1), to: Math.min(lines(m.code).length, m.region.to + 1) };
const inRegion = (m: WhereMaterial, r: Range) => { const k = pickOf(m); return Number.isInteger(r.from) && Number.isInteger(r.to) && r.from >= k.from && r.to <= k.to && r.from <= r.to; };
const shapes = (rs: RunOut[]) => rs.map(shapeOf);
async function stable(lang: string, program: string, stdins: string[]) {
  const a = shapes(await runAll(lang, program, stdins, 6000)), b = shapes(await runAll(lang, program, stdins, 6000));
  return { out: a, stable: a.every((x, i) => x === b[i]) };
}
const matOf = (s: Scene) => (s.practice as { where?: WhereMaterial } | undefined)?.where;

/** 검사: 모범 범위는 늘 정답 · 안 넣으면 늘 어긋남 · 그때 범위는 가르는 입력 둘 이상에서 어긋남 · 다른 맞는 방법도 통과(능력) · 범위가 고를 수 있는 줄 안 */
export async function checkWhere(scene: Scene): Promise<Scene> {
  const m = matOf(scene);
  if (!m) return { ...scene, check: { ok: false, problems: ["재료가 없어요."] } };
  const problems: string[] = [];
  const n = lines(m.code).length;
  if (m.region.from < 1 || m.region.to > n || m.region.from > m.region.to) problems.push("고를 수 있는 줄 범위가 코드 밖이에요.");
  for (const [k, r] of [["모범", m.answer], ["그때", m.mine], ...m.others.map((o) => [o.id, o] as const)] as const) if (!inRegion(m, r)) problems.push(`${k} 범위가 고를 수 있는 줄 밖이에요.`);
  if (sameRange(normRange(m.code, m.answer), normRange(m.code, m.mine))) problems.push("그때 범위가 모범 범위와 같은 모양이에요.");
  if (sameRange(pickOf(m), m.answer)) problems.push("고를 수 있는 줄이 모범 범위와 같아요(답이 드러나요).");
  if (!m.inputs.length) problems.push("입력이 없어요.");
  if (problems.length) return { ...scene, check: { ok: false, problems } };
  const ref = await stable(scene.lang, insertGuard(m.code, m.wrap, m.answer), m.inputs);
  if (!ref.stable) problems.push("모범 범위로 두 번 돌렸는데 결과가 달라요(매번 같아야 해요).");
  if (ref.out.some((o) => o.startsWith("\u0000"))) problems.push(`모범 범위로 돌지 않아요: ${ref.out.find((o) => o.startsWith("\u0000"))}`);
  const none = await stable(scene.lang, m.code, m.inputs);
  const mine = await stable(scene.lang, insertGuard(m.code, m.wrap, m.mine), m.inputs);
  if (!none.stable || !mine.stable) problems.push("안 넣거나 그때처럼 넣었을 때 결과가 매번 달라요. 읽기와 쓰기 사이에 일부러 쉬게 해 늘 어긋나게 해요.");
  const splits = mine.out.filter((o, i) => o !== ref.out[i]).length;
  if (splits < 2) problems.push("그때처럼 넣었을 때 어긋나는 입력이 둘보다 적어요.");
  if (mine.out.some((o) => /^\u0000(CE|MISSING)/.test(o))) problems.push("그때처럼 넣으면 컴파일부터 안 돼요(어떤 생각인지 드러나지 않아요).");
  if (none.out.every((o, i) => o === ref.out[i])) problems.push("아무것도 안 넣어도 정답이에요.");
  const others: Record<string, string[]> = {};
  for (const o of m.others) others[o.id] = (await stable(scene.lang, insertGuard(m.code, m.wrap, o), m.inputs)).out;
  if (scene.target === "ability") for (const [k, alt] of m.alsoRight.entries()) {
    const got = (await stable(scene.lang, replaceRegion(m.code, m.region, alt.code), m.inputs)).out;
    if (got.some((g, i) => g !== ref.out[i])) problems.push(`다른 맞는 방법 ${k + 1}(${alt.what})이 통과하지 못해요.`);
  }
  const inputs = m.inputs.map((stdin, i) => ({ role: mine.out[i] !== ref.out[i] ? "split" as const : "basic" as const, stdin }));
  return { ...scene, inputs, check: { ok: !problems.length, problems }, computed: { expected: ref.out, shapes: { mine: mine.out, none: none.out, ...others } } };
}

export type WhereAnswer = { from?: number; to?: number; code?: string };
export function parseWhereAnswer(answer: string): WhereAnswer {
  try { const a = JSON.parse(answer) as WhereAnswer; return { ...(typeof a.from === "number" ? { from: a.from, to: Number(a.to ?? a.from) } : {}), ...(typeof a.code === "string" ? { code: a.code } : {}) }; } catch { return {}; }
}
/** 학습자 답 → 돌릴 프로그램(범위면 넣고, 코드면 바꾼다). 못 쓰는 답이면 그 까닭 */
export function programOfWhere(scene: Scene, a: WhereAnswer): { program: string; range?: Range } | { error: string } {
  const m = matOf(scene)!;
  if (a.code !== undefined) {
    if (scene.target === "form") return { error: "이 장면은 그 표현(넣을 자리)을 고르는 장면이에요. 줄 범위를 골라 주세요." };
    if (!a.code.trim()) return { error: "코드가 비어 있어요." };
    // 학습자는 고를 수 있는 줄 전체를 바꿔 쓴다(모범 범위를 화면에 보이지 않으려고)
    return { program: replaceRegion(m.code, pickOf(m), a.code) };
  }
  if (a.from === undefined || a.to === undefined) return { error: "줄 범위를 골라 주세요." };
  const r = { from: Math.min(a.from, a.to), to: Math.max(a.from, a.to) };
  if (!inRegion(m, r)) return { error: `${pickOf(m).from}~${pickOf(m).to}줄 안에서 골라 주세요.` };
  return { program: insertGuard(m.code, m.wrap, r), range: r };
}
/** 채점: 돌려서 모두 정답이면 통과. 범위가 그때 범위와 같은 모양이면 같은 실수, 다른 틀린 범위와 같으면 다른 실수, 그 밖은 미확정 */
export async function gradeWhere(scene: Scene, gap: Pick<Gap, "wrongVerified">, answer: string): Promise<Graded> {
  const m = matOf(scene)!, c = scene.computed!;
  const p = programOfWhere(scene, parseWhereAnswer(answer));
  if ("error" in p) return { verdict: "unclear", errors: [p.error] };
  const runs = await runAll(scene.lang, p.program, m.inputs, 6000);
  const got = runs.map(shapeOf);
  const diffAt = got.findIndex((g, i) => g !== c.expected[i]);
  const errors = runs.flatMap((r, i) => (r.ok ? [] : [`입력 ${i + 1}: ${r.error.slice(0, 300)}`]));
  if (diffAt < 0) return { verdict: "pass", outputs: got };
  const firstDiff = { index: diffAt, stdin: m.inputs[diffAt], expected: c.expected[diffAt], got: runs[diffAt].ok ? got[diffAt] : (runs[diffAt] as { error: string }).error };
  const extra = { outputs: got, firstDiff, ...(errors.length ? { errors } : {}) };
  if (p.range) {
    const r = normRange(m.code, p.range);
    if (sameRange(r, normRange(m.code, m.mine)) && gap.wrongVerified !== false) return { verdict: "same", matched: "mine", ...extra };
    const o = m.others.find((x) => sameRange(r, normRange(m.code, x)));
    if (o) return { verdict: "other", matched: o.id, ...extra };
  }
  return { verdict: "unclear", ...extra };
}
/** 미리 실행(보이는 기본 입력만, 채점 없음) */
export async function previewWhere(scene: Scene, answer: string) {
  const m = matOf(scene)!;
  const p = programOfWhere(scene, parseWhereAnswer(answer));
  if ("error" in p) throw new Error(p.error);
  const shown = scene.inputs.filter((x) => x.role === "basic").slice(0, 2);
  const use = shown.length ? shown : scene.inputs.slice(0, 1);
  const runs = await runAll(scene.lang, p.program, use.map((x) => x.stdin), 6000);
  return { program: p.program, runs: runs.map((r, i) => ({ input: use[i].stdin, ...(r.ok ? { out: r.out } : { error: r.error }) })), region: m.region };
}
export function wherePublic(scene: Scene) {
  const m = matOf(scene)!;
  return { kind: "where", guard: m.guard, code: m.code, region: pickOf(m), wrap: m.wrap, allowCode: scene.target === "ability",
    inputs: scene.inputs.filter((x) => x.role === "basic").map((x) => x.stdin).slice(0, 2) };
}

/* ---------- 은행: FPS 탄약(설계 8번), AI 0번 ---------- */
// 출력은 ok / lost 한 단어(언어마다 같은 모양, 콘솔 글자 인코딩과 무관). 입력 = 동시에 쏘는 요청 수.
const BANK: Record<string, Omit<WhereMaterial, "inputs">> = {
  javascript: {
    guard: "lock", wrap: { before: "await gate.run(async () => {", after: "});" },
    code: [
      "const sleep = (ms) => new Promise((r) => setTimeout(r, ms));",
      "class Gate { constructor() { this.tail = Promise.resolve(); } run(fn) { const p = this.tail.then(fn); this.tail = p.catch(() => {}); return p; } }",
      "const gate = new Gate();",
      "let ammo = 30;",
      "async function fire(n) {",
      "  const left = ammo;",
      "  await sleep(2);",
      "  ammo = left - n;",
      "}",
      "async function main() {",
      "  const k = Number(require(\"fs\").readFileSync(0, \"utf8\").trim());",
      "  await Promise.all(Array.from({ length: k }, () => fire(1)));",
      "  console.log(ammo === 30 - k ? \"ok\" : \"lost\");",
      "}",
      "main();",
    ].join("\n"),
    region: { from: 6, to: 8 }, answer: { from: 6, to: 8 }, mine: { from: 8, to: 8, what: "잠금을 쓰기 줄에만 걸었다" },
    others: [{ id: "read-only", from: 6, to: 6, what: "읽기 줄에만 걸었다" }],
    alsoRight: [{ what: "한 번에 빼기(읽고 쓰는 사이에 멈추지 않음)", code: "await sleep(2);\nammo -= n;" }],
  },
  python: {
    guard: "lock", wrap: { before: "with gate:", after: "" },
    code: [
      "import sys, threading, time",
      "gate = threading.Lock()",
      "ammo = 30",
      "def fire(n):",
      "    global ammo",
      "    left = ammo",
      "    time.sleep(0.02)",
      "    ammo = left - n",
      "k = int(sys.stdin.readline())",
      "ts = [threading.Thread(target=fire, args=(1,)) for _ in range(k)]",
      "for t in ts: t.start()",
      "for t in ts: t.join()",
      "print(\"ok\" if ammo == 30 - k else \"lost\")",
    ].join("\n"),
    region: { from: 6, to: 8 }, answer: { from: 6, to: 8 }, mine: { from: 8, to: 8, what: "잠금을 쓰기 줄에만 걸었다" },
    others: [{ id: "read-only", from: 6, to: 6, what: "읽기 줄에만 걸었다" }],
    alsoRight: [{ what: "acquire · release로 직접 잠금", code: "gate.acquire()\ntry:\n    left = ammo\n    time.sleep(0.02)\n    ammo = left - n\nfinally:\n    gate.release()" }],
  },
  csharp: {
    guard: "lock", wrap: { before: "lock (gate) {", after: "}" },
    code: [
      "using System;",
      "using System.Threading;",
      "class Program {",
      "    static int ammo = 30;",
      "    static readonly object gate = new object();",
      "    static void Fire(int n) {",
      "        int left = ammo;",
      "        Thread.Sleep(20);",
      "        ammo = left - n;",
      "    }",
      "    static void Main() {",
      "        int k = int.Parse(Console.ReadLine());",
      "        var ts = new Thread[k];",
      "        for (int i = 0; i < k; i++) ts[i] = new Thread(() => Fire(1));",
      "        foreach (var t in ts) t.Start();",
      "        foreach (var t in ts) t.Join();",
      "        Console.WriteLine(ammo == 30 - k ? \"ok\" : \"lost\");",
      "    }",
      "}",
    ].join("\n"),
    region: { from: 7, to: 9 }, answer: { from: 7, to: 9 }, mine: { from: 9, to: 9, what: "잠금을 쓰기 줄에만 걸었다" },
    others: [{ id: "read-only", from: 7, to: 7, what: "읽기 줄에만 걸었다" }],
    alsoRight: [{ what: "Interlocked로 한 번에 빼기", code: "Thread.Sleep(20);\nInterlocked.Add(ref ammo, -n);" }],
  },
};
export const whereBankLangs = Object.keys(BANK);
export function whereBankScene(gap: Gap, id: string): Scene | null {
  const b = BANK[gap.origin.lang];
  if (!b) return null;
  const m: WhereMaterial = { ...b, inputs: ["1", "2", "3", "5"] };
  return { id, gapId: gap.id, format: "where", lang: gap.origin.lang, distance: gap.state.distance, target: gap.target,
    story: "여러 요청이 같은 총의 탄약 ammo를 동시에 줄여요. 입력은 동시에 쏘는 요청 수, 출력 ok는 탄약이 맞게 줄었다는 뜻이에요.",
    ask: `잠금을 걸 줄 범위를 ${pickOf(m).from}~${pickOf(m).to}줄 안에서 골라 보세요.${gap.target === "ability" ? " 다른 방법으로 고쳐도 돼요." : ""}`,
    explain: "읽기부터 쓰기까지를 한 잠금 안에 넣어야, 다른 요청이 그 사이에 끼어들지 못해요.",
    setup: "", after: "", reference: JSON.stringify(m.answer), alsoRight: m.alsoRight.map((x) => x.code),
    wrongs: [{ id: "mine", what: m.mine.what, code: JSON.stringify({ from: m.mine.from, to: m.mine.to }) }, ...m.others.map((o) => ({ id: o.id, what: o.what, code: JSON.stringify({ from: o.from, to: o.to }) }))],
    inputs: m.inputs.map((stdin) => ({ role: "basic" as const, stdin })), practice: { kind: "where", where: m }, createdAt: new Date().toISOString(), madeBy: "bank" };
}
/** AI 답 → 장면 */
export function whereFromReply(gap: Gap, id: string, r: WhereReply): Scene {
  const m: WhereMaterial = { guard: (["lock", "transaction", "await", "check"] as const).find((g) => g === r.guard) ?? "lock", wrap: { before: r.before, after: r.after }, code: r.code.replace(/\r/g, ""),
    region: { from: r.regionFrom, to: r.regionTo }, answer: { from: r.answerFrom, to: r.answerTo }, mine: { from: r.mineFrom, to: r.mineTo, what: r.mineWhat },
    others: (r.others ?? []).map((o, i) => ({ id: o.id && o.id !== "mine" ? o.id : `w${i + 1}`, from: o.from, to: o.to, what: o.what })),
    alsoRight: gap.target === "form" ? [] : (r.alsoRight ?? []).filter((x) => x.code.trim()), inputs: (r.inputs ?? []).map(String).slice(0, 6) };
  return { id, gapId: gap.id, format: "where", lang: gap.origin.lang, distance: gap.state.distance, target: gap.target, story: r.story, ask: r.ask, explain: r.explain || gap.missed,
    setup: "", after: "", reference: JSON.stringify(m.answer), alsoRight: m.alsoRight.map((x) => x.code),
    wrongs: [{ id: "mine", what: m.mine.what, code: JSON.stringify({ from: m.mine.from, to: m.mine.to }) }, ...m.others.map((o) => ({ id: o.id, what: o.what, code: JSON.stringify({ from: o.from, to: o.to }) }))],
    inputs: m.inputs.map((stdin) => ({ role: "basic" as const, stdin })), practice: { kind: "where", where: m }, createdAt: new Date().toISOString(), madeBy: "ai" };
}
export type WhereReply = { story: string; ask: string; explain: string; guard: string; before: string; after: string; code: string; regionFrom: number; regionTo: number; answerFrom: number; answerTo: number;
  mineFrom: number; mineTo: number; mineWhat: string; others: Array<{ id: string; from: number; to: number; what: string }>; alsoRight: Array<{ what: string; code: string }>; inputs: string[] };
