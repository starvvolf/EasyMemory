// 풀이 조각 지도 (설계 2번): 문제마다 한 번, 모든 NPC가 같이 쓴다.
//   만들기: AI 1번(terra low)이 문제 · 교육용 문제 모델 · 모범 풀이를 보고 조각과 길(걸음 · 걸음 코드 · 자리별 코드)을 낸다 → 코드가 모양 검사.
//   재기: 길마다 그 길대로 엮은 코드를 **실제 채점기**(code/run.ts judge)로 돌려 판정을 적는다. 자리의 틀린 조각마다도 따로 잰다.
//   조각 예시 코드는 최소한 문법으로 돌아가는지(파이썬 ast) 본다. 결과는 NPC 결과 폴더에 문제마다 캐시한다.
//   처음 몇 문제의 지도는 사람이 눈으로 확인한다: reviewTable()이 표로 뽑는다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { askJson, S } from "../assist/model.ts";
import { judge, runOnce, type TestCase } from "../code/run.ts";
import type { ProblemModel } from "../code/tutor/problem-model.ts";
import type { Fragment, ProblemMap, Route, Slot, Step } from "./types.ts";

/* ---------- 코드 엮기 ---------- */
const SLOT = /\{\{([a-z0-9_-]+)\}\}/gi;
/** 자리마다 쓸 조각 → 프로그램. upto = 이 걸음 앞까지만(막힌 자리), guessAt = 이 걸음은 지어 쓴 코드로. */
export function program(route: Route, picks: Record<string, string>, opts: { upto?: number; guessAt?: number } = {}) {
  const steps = route.steps.slice(0, opts.upto ?? route.steps.length);
  return steps.map((s, i) => {
    if (opts.guessAt === i) return s.guess ?? "";
    return s.code.replace(SLOT, (_, name: string) => {
      const slot = route.slots[name];
      if (!slot) return "";
      const pick = picks[name] ?? slot.right;
      return slot.alts[pick] ?? slot.alts["?"] ?? slot.alts[slot.right] ?? "";
    });
  }).filter((x) => x.trim()).join("\n") + "\n";
}
export const rightPicks = (route: Route) => Object.fromEntries(Object.entries(route.slots).map(([k, s]) => [k, s.right]));
export const slotsOfStep = (step: Step) => [...step.code.matchAll(SLOT)].map((m) => m[1]);
/** 길에 나오는 틀린 조각(길 자체 · 자리의 틀린 조각) */
export const wrongsIn = (map: ProblemMap, route: Route) => route.needs.filter((n) => map.fragments.find((f) => f.id === n)?.wrong);
export const fragmentOf = (map: ProblemMap, id: string) => map.fragments.find((f) => f.id === id);
export const isWrong = (map: ProblemMap, id: string) => Boolean(fragmentOf(map, id)?.wrong);
export const linesOf = (code: string) => code.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length;

/** 이 조각들을 가진 사람이 이 길에서 자리마다 쓸 조각(연출가와 같은 규칙: 맞는 것 → 쥔 틀린 것 → 모르고 쓰는 것 → "?") */
export function picksFor(route: Route, holds: Set<string>) {
  return Object.fromEntries(Object.entries(route.slots).map(([k, s]) => [k, holds.has(s.right) ? s.right : Object.keys(s.alts).find((a) => a !== "?" && a !== s.right && holds.has(a)) ?? s.unaware ?? "?"]));
}
/** 이 조각들로 끝까지 갈 수 있는 길(앞의 것 = 원하는 길). 없으면 null. 상황 재현 장면을 NPC가 풀 때 쓴다(채점 7번). */
export function routeFor(map: ProblemMap, holds: Set<string>, prefer?: string): Route | null {
  const ok = (r: Route) => r.needs.every((n) => {
    const f = fragmentOf(map, n);
    if (!f) return true;
    if (holds.has(n)) return true;
    if (f.wrong) return false;
    return Object.values(r.slots).some((s) => s.right === n && (Object.keys(s.alts).some((a) => a !== "?" && a !== s.right && holds.has(a)) || s.unaware));
  });
  const list = [...map.routes].sort((a, b) => Number(b.id === prefer) - Number(a.id === prefer) || Number(wrongsIn(map, b).some((w) => holds.has(w))) - Number(wrongsIn(map, a).some((w) => holds.has(w))) || (b.prior ?? 0) - (a.prior ?? 0));
  return list.find(ok) ?? null;
}

/* ---------- 재기 ---------- */
export type ProblemPack = { id: string; number: string; title: string; statement: string; inputText: string; outputText: string; examples: TestCase[]; tests: TestCase[]; timeLimitMs: number;
  referenceJs: string; model?: ProblemModel };
export const allTests = (p: Pick<ProblemPack, "examples" | "tests">) => [...p.examples, ...p.tests];
/** 길마다 판정을 잰다(맞는 자리 · 자리마다 틀린 조각 하나씩). AI 0번. */
export async function measure(map: ProblemMap, tests: TestCase[], timeLimitMs: number): Promise<ProblemMap> {
  const at = new Date().toISOString();
  const routes = await Promise.all(map.routes.map(async (r) => {
    const v = async (picks: Record<string, string>) => (await judge("python", program(r, picks), tests, { timeLimitMs, stopAtFirstFail: true })).verdict;
    const variants: Record<string, string> = {};
    for (const [name, slot] of Object.entries(r.slots)) for (const alt of Object.keys(slot.alts).filter((a) => a !== slot.right)) variants[`${name}=${alt}`] = await v({ ...rightPicks(r), [name]: alt });
    return { ...r, measured: { verdict: await v(rightPicks(r)), variants, at } };
  }));
  return { ...map, routes };
}
/** 그 길 · 그 자리 조각으로 쓴 코드가 내야 할 판정(잰 값). 자리가 둘 이상 틀렸으면 null(재지 않은 조합 → 그때 잰다). */
export function expectedVerdict(route: Route, picks: Record<string, string>): string | null {
  if (!route.measured) return null;
  const off = Object.entries(picks).filter(([k, v]) => route.slots[k] && v !== route.slots[k].right);
  if (!off.length) return route.measured.verdict;
  if (off.length === 1) return route.measured.variants[`${off[0][0]}=${off[0][1]}`] ?? null;
  return null;
}
const AST_CHECK = "import ast, sys\ntry:\n    ast.parse(sys.stdin.read())\n    print('ok')\nexcept SyntaxError as e:\n    print('문법 오류: ' + str(e))\n";
/** 조각 예시 코드가 문법으로 돌아가나(변수는 없어도 됨). */
export async function checkExamples(map: ProblemMap): Promise<ProblemMap> {
  const exampleChecks: Record<string, string> = {};
  for (const f of map.fragments) {
    const out = await runOnce("python", AST_CHECK, f.example.endsWith("\n") ? f.example : `${f.example}\n`, 5000).catch((e) => ({ ok: false as const, error: String(e) }));
    exampleChecks[f.id] = out.ok ? (out.stdout.trim() === "ok" ? "ok" : out.stdout.trim().slice(0, 200) || out.stderr.slice(0, 200)) : String((out as { error?: string }).error ?? "실행 못 함").slice(0, 200);
  }
  return { ...map, exampleChecks };
}

/* ---------- 캐시 ---------- */
export const defaultOutDir = () => process.env.NPC_OUT_DIR?.trim() || path.join(process.cwd(), "tools", "npc", "out");
export const mapFile = (outDir: string, problem: string) => path.join(outDir, "maps", `${problem.replace(/[^\w-]/g, "_")}.json`);
export async function readMap(outDir: string, problem: string): Promise<ProblemMap | null> {
  try { return JSON.parse(await readFile(mapFile(outDir, problem), "utf8")) as ProblemMap; } catch { return null; }
}
export async function saveMap(outDir: string, map: ProblemMap) {
  await mkdir(path.dirname(mapFile(outDir, map.problem)), { recursive: true });
  await writeFile(mapFile(outDir, map.problem), JSON.stringify(map, null, 1), "utf8");
}

/* ---------- AI로 만들기 (문제마다 1번) ---------- */
export const MAP_SYSTEM = `너는 알고리즘 문제 하나를 "풀이 조각"과 "풀이 길"로 나누는 분석가다. 결과는 가상 학습자(NPC) 시험에 쓴다: NPC는 아는 조각만 가지고, 가진 조각으로 갈 수 있는 길을 간다.

## 조각 (fragments)
- 조각 = 풀이를 이루는 생각이나 도구 하나. id는 "종류.이름"(영어 소문자 · 숫자 · 점 · 붙임표). 종류: syntax(문법, 언어마다 syntax.py.*) · shape(무엇을 어떤 모양에 담나) · tool(자료구조 · 도구) · idea(원리 · 생각) · frame(알려진 풀이 틀의 순서, 예: frame.bfs) · wrong(틀린 조각).
- layer: 1 문법 · 2 담기 · 3 한 줄 읽기 · 4 잇기(아는 것을 코드 순서로) · 5 원리 · 6 방법 고르기.
- what: 한 문장(쉬운 한국어). example: 이 조각만 보여 주는 3~8줄 파이썬(이 문제의 변수 이름은 써도 됨, 문법은 맞게).
- 틀린 조각(wrong=true): 그럴듯하지만 틀린 생각. 교육용 문제 모델의 틀린 접근 · 틀린 상태 · 함정에서 가져온다. right = 그 틀린 생각이 대신하는 맞는 조각 id. 틀린 조각이 아니면 wrong=false, right="".
- keys: 그 조각을 말하거나 쓴 흔적을 찾을 낱말 · 짧은 정규식 2~5개(한국어 낱말 · 코드 모양).
- leak: 문법 조각(syntax.*)만, 그 문법을 모르는 사람의 코드에 나오면 안 되는 모양의 정규식 1~2개. 다른 종류는 빈 목록.
- 크기: 층 하나에 조각 하나쯤. 너무 잘게 쪼개지 않는다. 맞는 조각 8~14개, 틀린 조각 2~5개.

## 길 (routes)
- 길 = 조각을 엮은 풀이 방법 하나. 맞는 길 2~4개(정석 · 다른 정석 · 느리지만 이 크기면 통과하는 돌아가는 길) + 틀린 조각이 든 길 1~3개(틀린 답 · 시간 초과).
- needs: 이 길에 필요한 조각 id 전부(틀린 길이면 그 틀린 조각 포함). frame: 이 길의 틀 조각 id(없으면 ""). prior: 흔한 정도 0~1. expect: 이 길대로 쓴 코드의 판정 짐작(AC · WA · TLE · RE).
- steps: 걸음 순서. 각 걸음 = text(한 줄) · uses(이 걸음에 쓰는 조각 id) · code(이 걸음의 파이썬 코드, 들여쓰기 포함) · guess(이 걸음의 조각을 모르는 사람이 지어 쓸 법한 코드, 없으면 "").
  - 걸음 코드를 순서대로 이으면 완전한 프로그램이 되어야 한다(표준 입력을 읽고 답을 출력).
  - 같은 걸음에 맞는 조각 대신 틀린 조각을 쓸 수 있으면 그 줄을 {{자리이름}}으로 비우고 slots에 적는다.
- slots: name(자리이름) · right(맞는 조각 id) · unaware(맞는 조각을 모르면 모르는 줄도 모르고 쓰게 되는 틀린 조각 id, 없으면 "") · alts(fragment = 조각 id 또는 "?"(몰라서 지어 씀), code = 그 자리 코드).
- 모범 풀이를 그대로 베끼지 않아도 된다. 길마다 그 길의 생각대로 쓴 코드여야 한다(틀린 길은 그 틀린 생각대로 정말 틀리게).

## 지킬 것
- 판정은 네가 정하지 않는다. 코드가 실제 채점기로 잰다(expect는 짐작일 뿐). 그러니 코드는 실제로 돌아가는 파이썬이어야 한다.
- 문제 원문을 길게 옮기지 않는다.`;
const SLOT_SCHEMA = S.obj({ name: S.str, right: S.str, unaware: S.str, alts: S.arr(S.obj({ fragment: S.str, code: S.str })) });
export const MAP_SCHEMA = S.obj({
  fragments: S.arr(S.obj({ id: S.str, layer: S.int, what: S.str, example: S.str, wrong: { type: "boolean" }, right: S.str, keys: S.arr(S.str), leak: S.arr(S.str) })),
  routes: S.arr(S.obj({ id: S.str, name: S.str, needs: S.arr(S.str), frame: S.str, prior: { type: "number" }, expect: S.str,
    steps: S.arr(S.obj({ text: S.str, uses: S.arr(S.str), code: S.str, guess: S.str })), slots: S.arr(SLOT_SCHEMA) })),
});
export type MapReply = { fragments: Array<{ id: string; layer: number; what: string; example: string; wrong: boolean; right: string; keys: string[]; leak: string[] }>;
  routes: Array<{ id: string; name: string; needs: string[]; frame: string; prior: number; expect: string; steps: Array<{ text: string; uses: string[]; code: string; guess: string }>;
    slots: Array<{ name: string; right: string; unaware: string; alts: Array<{ fragment: string; code: string }> }> }> };

export function mapUser(p: ProblemPack) {
  const m = p.model;
  return [
    `[문제] ${p.title}\n${p.statement}\n[입력] ${p.inputText}\n[출력] ${p.outputText}\n[시간 제한] ${p.timeLimitMs}ms`,
    `[예제]\n${p.examples.slice(0, 2).map((e) => `입력:\n${e.input}출력: ${e.output}`).join("\n")}`,
    m ? `[교육용 문제 모델]\n패턴: ${m.patterns.join(", ")}\n신호: ${m.signals.join(" · ")}\n접근: ${m.approaches.map((a) => `${a.name}(${a.verdict}: ${a.why})`).join(" / ")}\n상태: 맞음 ${m.state.right} · 틀림 ${m.state.wrong.join(", ")}\n함정: ${m.pitfalls.join(" · ")}` : "",
    `[모범 풀이(JavaScript, 채점 확인용 — 길 코드는 파이썬으로)]\n${p.referenceJs.slice(0, 6000)}`,
  ].filter(Boolean).join("\n\n");
}
const ID = /^(syntax|shape|tool|idea|frame|wrong)\.[a-z0-9.-]{1,40}$/;
const reOk = (s: string) => { try { new RegExp(s); return true; } catch { return false; } };
/** AI 답 → 지도. 모양이 틀린 것은 버리고 notes에 적는다. */
export function checkMapReply(problem: string, title: string, raw: MapReply): ProblemMap {
  const notes: string[] = [];
  const fragments: Fragment[] = [];
  for (const f of raw.fragments ?? []) {
    if (!ID.test(f.id ?? "") || fragments.some((x) => x.id === f.id)) { notes.push(`조각 id "${f.id}" 버림(모양 · 겹침)`); continue; }
    const layer = Math.min(6, Math.max(1, Math.round(Number(f.layer) || 0)));
    if (!f.what?.trim()) { notes.push(`${f.id}: 설명 없음, 버림`); continue; }
    const wrong = Boolean(f.wrong) || f.id.startsWith("wrong.");
    fragments.push({ id: f.id, layer, what: f.what.trim().slice(0, 200), example: (f.example ?? "").slice(0, 800), ...(wrong ? { wrong: true, right: f.right } : {}),
      keys: (f.keys ?? []).filter(reOk).slice(0, 6), ...(f.id.startsWith("syntax.") ? { leak: (f.leak ?? []).filter(reOk).slice(0, 2) } : {}) });
  }
  const ids = new Set(fragments.map((f) => f.id));
  for (const f of fragments.filter((x) => x.wrong)) if (!f.right || !ids.has(f.right) || fragments.find((x) => x.id === f.right)?.wrong) { notes.push(`${f.id}: 맞는 짝(right) "${f.right}"이 없어요`); delete f.right; }
  const routes: Route[] = [];
  for (const r of raw.routes ?? []) {
    const id = String(r.id ?? "").trim().slice(0, 8) || String.fromCharCode(65 + routes.length);
    if (routes.some((x) => x.id === id)) { notes.push(`길 ${id} 겹침, 버림`); continue; }
    const badNeeds = (r.needs ?? []).filter((n) => !ids.has(n));
    if (badNeeds.length) notes.push(`길 ${id}: 없는 조각 ${badNeeds.join(", ")} 뺌`);
    const slots: Record<string, Slot> = {};
    for (const s of r.slots ?? []) {
      if (!/^[a-z0-9_-]{1,20}$/i.test(s.name ?? "") || !ids.has(s.right)) { notes.push(`길 ${id}: 자리 "${s.name}" 버림`); continue; }
      const alts = Object.fromEntries((s.alts ?? []).filter((a) => a.fragment === "?" || ids.has(a.fragment)).map((a) => [a.fragment, a.code ?? ""]));
      if (!(s.right in alts)) { notes.push(`길 ${id}: 자리 ${s.name}에 맞는 조각 코드가 없어 버림`); continue; }
      slots[s.name] = { right: s.right, alts, ...(s.unaware && ids.has(s.unaware) ? { unaware: s.unaware } : {}) };
    }
    const steps: Step[] = (r.steps ?? []).map((s) => ({ text: (s.text ?? "").slice(0, 120), uses: (s.uses ?? []).filter((u) => ids.has(u)), code: s.code ?? "", ...(s.guess?.trim() ? { guess: s.guess } : {}) }));
    const missingSlots = steps.flatMap(slotsOfStep).filter((n) => !slots[n]);
    if (missingSlots.length) { notes.push(`길 ${id}: 자리 ${missingSlots.join(", ")}가 정의되지 않아 길을 버림`); continue; }
    if (!steps.length) { notes.push(`길 ${id}: 걸음 없음, 버림`); continue; }
    routes.push({ id, name: (r.name ?? id).slice(0, 40), needs: (r.needs ?? []).filter((n) => ids.has(n)), ...(r.frame && ids.has(r.frame) ? { frame: r.frame } : {}),
      prior: Math.min(1, Math.max(0, Number(r.prior) || 0.2)), ...(r.expect ? { expect: r.expect.slice(0, 10) } : {}), steps, slots });
  }
  return { problem, title, lang: "python", source: "ai", madeAt: new Date().toISOString(), fragments, routes, notes };
}
type AskJson = <T>(purpose: string, system: string, user: string, schema: Record<string, unknown>) => Promise<T>;
const defaultAsk: AskJson = (purpose, system, user, schema) => askJson(purpose, system, user, schema, { model: "gpt-6.1-terra", effort: "low" });
/** 지도 만들기: AI 1번 → 모양 검사 → 길 판정 재기 → 예시 검사 → 캐시. */
export async function generateMap(p: ProblemPack, opts: { ask?: AskJson; outDir?: string } = {}): Promise<ProblemMap> {
  const raw = await (opts.ask ?? defaultAsk)<MapReply>("npc:map", MAP_SYSTEM, mapUser(p), MAP_SCHEMA);
  let map = checkMapReply(p.number, p.title, raw);
  map = await checkExamples(await measure(map, allTests(p), p.timeLimitMs));
  for (const r of map.routes) if (r.expect && r.measured && r.expect !== r.measured.verdict) map.notes!.push(`길 ${r.id}: AI 짐작 ${r.expect}, 잰 판정 ${r.measured.verdict}`);
  if (opts.outDir) await saveMap(opts.outDir, map);
  return map;
}
/** 지도를 가져온다: 캐시 → (없거나 force) 손 지도가 있으면 그것을 재서 → 아니면 AI로 만든다. */
export async function ensureMap(p: ProblemPack, opts: { outDir: string; hand?: ProblemMap; regenerate?: boolean; ask?: AskJson }) {
  if (!opts.regenerate) { const got = await readMap(opts.outDir, p.number); if (got?.routes.every((r) => r.measured)) return got; }
  if (opts.hand && !opts.regenerate) { const m = await checkExamples(await measure(opts.hand, allTests(p), p.timeLimitMs)); await saveMap(opts.outDir, m); return m; }
  return generateMap(p, { outDir: opts.outDir, ...(opts.ask ? { ask: opts.ask } : {}) });
}

/* ---------- 사람이 확인할 표 ---------- */
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
export function reviewTable(map: ProblemMap) {
  const out = [`# 풀이 조각 지도 — ${map.problem} ${map.title} (${map.source === "hand" ? "손으로 씀" : "AI가 만듦"}, ${map.madeAt.slice(0, 10)})`, "",
    "사람이 눈으로 확인해 주세요: 조각 크기가 맞나 · 길마다 필요한 조각이 맞나 · 잰 판정이 그 길의 생각과 맞나.", "",
    "| 조각 | 층 | 무엇 | 예시 문법 |", "|---|---|---|---|",
    ...map.fragments.map((f) => `| ${f.wrong ? "✗ " : ""}\`${f.id}\`${f.right ? ` (대신: \`${f.right}\`)` : ""} | ${f.layer} | ${cell(f.what)} | ${map.exampleChecks?.[f.id] ?? "-"} |`), "",
    "| 길 | 필요한 조각 | 틀 | 잰 판정 | 자리별(틀린 조각) 판정 | AI 짐작 |", "|---|---|---|---|---|---|",
    ...map.routes.map((r) => `| ${r.id}. ${cell(r.name)} | ${r.needs.map((n) => `\`${n}\``).join(" · ")} | ${r.frame ?? "-"} | **${r.measured?.verdict ?? "안 잼"}** | ${Object.entries(r.measured?.variants ?? {}).map(([k, v]) => `${k} → ${v}`).join("<br>") || "-"} | ${r.expect ?? "-"} |`), "",
    ...map.routes.flatMap((r) => [`## 길 ${r.id}. ${r.name}`, "", ...r.steps.map((s, i) => `${i + 1}. ${s.text} — ${s.uses.map((u) => `\`${u}\``).join(", ") || "(조각 없음)"}`), "", "```python", program(r, rightPicks(r)).trimEnd(), "```", ""]),
    ...(map.notes?.length ? ["## 메모", "", ...map.notes.map((n) => `- ${n}`)] : [])];
  return out.join("\n");
}
