// 채점 (설계 7번): 정답지로 앱이 만든 것을 잰다. 코드만(AI 0번), 장면 답하기만 AI(가짜 모드는 고치기 장면만 코드로).
//   (가) 상황 재현 빈틈: 없던 조각이 빈틈으로 나왔나(놓침) · 가진 조각을 빈틈이라 했나(헛짚음) · 실수를 "모름"으로 잡았나 · 복붙을 "아직 모름"으로 잡았나
//   (나) 기억: 없던 조각만 기억(배운 것 카드 · 지식)이 됐나
//   (다) 튜터: 빠진 조각을 가르쳤나 · 아래층부터 짚었나 · 답을 통째로 줬나(튜터 답의 코드가 채점에서 맞으면 통째)
//   (라) 장면 다시 풀기: 빈틈마다 장면을 만들고, 같은 NPC가 배우기 전(처음 조각)과 뒤(배운 조각, 하루 잊음)로 풀어 통과 · 같은 실수가 맞게 갈리나
// 빈틈 · 기억 글과 조각을 맞추는 건 조각의 keys(낱말 · 정규식)로 한다. 완전하지 않으니 보고서에 맞춘 근거를 같이 적고 사람이 본다.
import type { Gap } from "../scene/types.ts";
import { dice } from "./dice.ts";
import { verdictOf } from "./guard.ts";
import { allTests, fragmentOf, picksFor, program, routeFor, type ProblemPack } from "./map.ts";
import { scrubExamples, type Voice } from "./voice.ts";
import type { Fragment, KeyEvent, Played, ProblemMap } from "./types.ts";

/* ---------- 글 → 조각 ---------- */
const hit = (text: string, f: Fragment) => (f.keys ?? []).filter((k) => { try { return new RegExp(k, "i").test(text); } catch { return text.includes(k); } });
/** 글에 나온 조각(맞는 조각 id로). 틀린 조각의 낱말이면 그 맞는 짝. 근거 낱말도 같이. */
export function fragmentsIn(map: ProblemMap, text: string): Array<{ id: string; by: string[] }> {
  const out = new Map<string, string[]>();
  for (const f of map.fragments) {
    const h = hit(text, f);
    if (!h.length) continue;
    const id = f.wrong ? f.right ?? f.id : f.id;
    out.set(id, [...(out.get(id) ?? []), ...h]);
  }
  return [...out].map(([id, by]) => ({ id, by })).sort((a, b) => b.by.length - a.by.length);
}
const gapText = (g: Pick<Gap, "title" | "missed" | "wrong" | "topic">) => `${g.title}\n${g.missed}\n${g.wrong}\n${g.topic}`;

/* ---------- (가) 빈틈 ---------- */
export type GapScore = {
  from: "ai" | "key" | "none"; expected: string[]; found: Array<{ gapId: string; title: string; kind: string; scope: string; fragments: string[]; by: string[]; slip: boolean; copied: boolean }>;
  hits: string[]; missed: string[]; falseAlarms: string[]; slipAsUnknown: string[]; outside: string[]; copiedCaught: boolean | null;
};
export function scoreGaps(map: ProblemMap, played: Played, gaps: Gap[], subs: Array<{ id: string; code: string }>, from: GapScore["from"]): GapScore {
  const slipSubs = new Set(subs.filter((s) => played.slipCodes.includes(s.code)).map((s) => s.id));
  const copiedSubs = new Set(subs.filter((s) => played.codes.some((c) => c.kind === "submit" && c.code === s.code) && played.key.some((k) => "copied" in k && k.copied)).map((s) => s.id));
  const expected = [...new Set(played.missed)];
  const found = gaps.map((g) => {
    const fs = fragmentsIn(map, gapText(g));
    const ev = g.evidence.flatMap((e) => (e.type === "submission" ? [e.id] : []));
    return { gapId: g.id, title: g.title, kind: g.kind, scope: g.scope, fragments: fs.map((x) => x.id), by: fs.flatMap((x) => x.by).slice(0, 6),
      slip: ev.length > 0 && ev.every((id) => slipSubs.has(id)), copied: ev.some((id) => copiedSubs.has(id)) };
  });
  const flagged = new Set(found.flatMap((g) => g.fragments));
  const copied = played.key.some((k) => "copied" in k && k.copied);
  return { from, expected, found,
    hits: expected.filter((e) => flagged.has(e)), missed: expected.filter((e) => !flagged.has(e)),
    falseAlarms: [...flagged].filter((f) => played.used.includes(f) && !expected.includes(f)),
    slipAsUnknown: found.filter((g) => g.slip && !g.fragments.some((f) => expected.includes(f))).map((g) => g.title),
    outside: found.filter((g) => !g.fragments.length).map((g) => g.title),
    copiedCaught: copied ? found.length > 0 : null };
}

/* ---------- (나) 기억 ---------- */
export type MemoryScore = { items: Array<{ title: string; fragments: string[]; ok: boolean | null }>; good: number; bad: number; unmatched: number };
export function scoreMemory(map: ProblemMap, played: Played, rec: { lessons: Array<Record<string, unknown>>; knowledge: Array<Record<string, unknown>> }): MemoryScore {
  const rows = [
    ...rec.lessons.map((l) => ({ title: `카드: ${String(l.gap || l.fix || l.situation || "").slice(0, 80)}`, text: [l.situation, l.gap, l.fix, l.cue, l.raw].join("\n") })),
    ...rec.knowledge.map((k) => ({ title: `기억: ${String(k.title ?? "").slice(0, 80)}`, text: JSON.stringify(k) })),
  ];
  const items = rows.map((r) => {
    const fs = fragmentsIn(map, r.text).map((x) => x.id);
    const ok = fs.length ? fs.some((f) => played.missed.includes(f)) && !fs.every((f) => played.used.includes(f)) : null;
    return { title: r.title, fragments: fs, ok };
  });
  return { items, good: items.filter((i) => i.ok === true).length, bad: items.filter((i) => i.ok === false).length, unmatched: items.filter((i) => i.ok === null).length };
}

/* ---------- (다) 튜터 ---------- */
export type TutorScore = { answers: Array<{ t: number; stuck: string; taught: string[]; taughtMissing: boolean; lowerFirst: boolean; wholeAnswer: boolean; codeLines: number }>; wholeAnswers: number };
export async function scoreTutor(map: ProblemMap, played: Played, talk: Array<{ kind: string; q: string; a: string }>, pack: ProblemPack): Promise<TutorScore> {
  const asks = played.key.filter((k): k is Extract<KeyEvent, { asked: true }> => "asked" in k);
  const answers: TutorScore["answers"] = [];
  const tutorTalk = talk.filter((x) => x.kind === "질문" || x.kind === "힌트");
  for (const [i, a] of asks.entries()) {
    const stuckEv = [...played.key].reverse().find((k): k is Extract<KeyEvent, { stuck: string }> => "stuck" in k && k.t <= a.t);
    const stuck = stuckEv?.stuck ?? "-";
    const right = fragmentOf(map, stuck)?.wrong ? fragmentOf(map, stuck)!.right ?? stuck : stuck;
    const layer = fragmentOf(map, right)?.layer ?? stuckEv?.layer ?? 0;
    const text = tutorTalk[i]?.a ?? "";
    const blocks = [...text.matchAll(/```(?:python|py)?\n([\s\S]*?)```/g)].map((m) => m[1]);
    let whole = false;
    for (const b of blocks) if (b.split("\n").length >= 6 && (await verdictOf(b, allTests(pack), pack.timeLimitMs)).verdict === "AC") whole = true;
    answers.push({ t: a.t, stuck: right, taught: a.taught, taughtMissing: a.taught.includes(right), lowerFirst: a.taught.includes(right) || a.taught.every((x) => (fragmentOf(map, x)?.layer ?? 0) <= layer),
      wholeAnswer: whole, codeLines: Math.max(0, ...blocks.map((b) => b.split("\n").length)) });
  }
  return { answers, wholeAnswers: answers.filter((x) => x.wholeAnswer).length };
}

/* ---------- (라) 장면 다시 풀기 ---------- */
export type SceneRun = { gapId: string; title: string; fragments: string[]; made: boolean; format?: string; why?: string;
  before?: { verdict: string; answer: string }; after?: { verdict: string; answer: string }; expectBefore: string; ok: boolean | null };
const layerKind: Record<number, Gap["kind"]> = { 1: "문법", 2: "자료 담기", 3: "한 줄 읽기", 4: "알고리즘 구현", 5: "알고리즘 원리", 6: "알고리즘 고르기" };
/** 가짜 모드용: 정답지로 만든 빈틈(틀리게 낸 제출이 있는 없던 조각마다 하나). 상황 재현의 장면 · 채점 기계를 AI 없이 돌려 보려고. */
export async function keyGaps(map: ProblemMap, played: Played, pack: ProblemPack, subs: Array<{ id: string; code: string; verdict: string; at: string }>): Promise<Gap[]> {
  const { newId } = await import("../scene/store.ts");
  const { firstState } = await import("../scene/ladder.ts");
  const out: Gap[] = [];
  for (const m of played.missed) {
    const f = fragmentOf(map, m);
    if (!f) continue;
    // 이 조각이 빠져서 틀린 제출: 그 조각 대신 틀린 조각 · "?"를 쓴 코드
    const wrongIds = map.fragments.filter((x) => x.wrong && x.right === m).map((x) => x.id);
    const n = (x: string) => x.replace(/\s+/g, " ").trim();
    const has = (code: string, piece?: string) => Boolean(piece && n(piece).length >= 6 && n(code).includes(n(piece)));
    const sub = [...subs].reverse().find((s) => s.verdict !== "AC" && s.verdict !== "CE" && !played.slipCodes.includes(s.code) && map.routes.some((r) =>
      Object.values(r.slots).some((sl) => sl.right === m && [...wrongIds, "?"].some((w) => has(s.code, sl.alts[w]) && !has(s.code, sl.alts[sl.right]))) ||
      r.steps.some((st) => (st.uses.some((u) => wrongIds.includes(u)) && has(s.code, st.code)) || (st.uses.includes(m) && has(s.code, st.guess)))));
    out.push({ id: newId("gap"), branch: "algo", kind: layerKind[f.layer] ?? "알고리즘 구현", layer: f.layer, title: `(정답지) ${f.what.slice(0, 40)}`, target: f.layer === 1 ? "form" : "ability",
      missed: f.what, wrong: map.fragments.find((x) => wrongIds.includes(x.id))?.what ?? "", ...(sub ? { wrongCode: sub.code } : {}), wrongVerified: Boolean(sub), ...(sub ? { wrongVerdict: sub.verdict } : {}),
      kernel: { lang: "python", code: f.example, needs: [] }, evidence: sub ? [{ type: "submission", id: sub.id, verdict: sub.verdict }] : [{ type: "talk", at: subs.at(-1)?.at ?? new Date().toISOString() }],
      origin: { problemId: pack.id, title: pack.title, lang: "python" }, topic: `npc.${m}`, scope: f.layer === 1 ? "line" : "piece", dose: { level: 3 }, state: firstState(3), createdAt: new Date().toISOString() });
  }
  return out;
}
const squash = (x: string) => x.replace(/\s+/g, " ").trim();
/** 고치기 장면(그때 코드에서 시작)을 이 조각들을 가진 NPC가 고친 답: 아는 자리만 고친다.
 *  - 그 코드에 틀린 자리 코드가 있고 맞는 조각을 가졌으면 그 자리만 맞는 코드로.
 *  - 그 코드가 틀린 조각의 걸음(길 자체가 틀림)인데 이제 그 틀린 조각을 안 믿으면 아는 길로 다시 씀.
 *  - 아무것도 모르면 그대로 낸다(못 고침 → 같은 실수). */
export function fixAnswer(map: ProblemMap, old: string, holds: Set<string>, prefer?: string): string {
  let code = old;
  for (const r of map.routes) for (const s of Object.values(r.slots)) {
    const right = s.alts[s.right];
    if (!right || !holds.has(s.right) || code.includes(right)) continue;
    const wrongAlt = Object.entries(s.alts).filter(([id]) => id !== s.right).map(([, c]) => c).filter((c) => c.trim() && code.includes(c)).sort((a, b) => b.length - a.length)[0];
    if (wrongAlt) code = code.replace(wrongAlt, right);
  }
  const wrongRoute = map.routes.some((r) => r.steps.some((st) => st.uses.some((u) => fragmentOf(map, u)?.wrong && !holds.has(u)) && squash(st.code).length >= 8 && squash(old).includes(squash(st.code))));
  if (wrongRoute) { const r = routeFor(map, holds, prefer); if (r) return program(r, picksFor(r, holds)); }
  return code;
}
/** 빈틈마다 장면을 만들고(make.ts makeScene) NPC가 배우기 전 · 뒤로 푼다(grade.ts gradeScene). */
export async function sceneStage(input: { map: ProblemMap; played: Played; pack: ProblemPack; gaps: Gap[]; voice: Voice; days?: number }): Promise<SceneRun[]> {
  const { makeScene } = await import("../scene/make.ts");
  const { recordOf } = await import("../scene/extract.ts");
  const { gradeScene } = await import("../scene/grade.ts");
  const { publicScene } = await import("../scene/service.ts");
  const { map, played } = input;
  const rec = await recordOf(input.pack.id).catch(() => null);
  if (!rec) return input.gaps.map((g) => ({ gapId: g.id, title: g.title, fragments: [], made: false, why: "기록을 읽지 못함", expectBefore: "-", ok: null }));
  const roll = dice(played.spec.seed, map.problem, "scene");
  const before = new Set([...played.start.holds, ...played.start.wrongs]);
  // 뒤: 끝에 가진 조각, 이번에 배운 것은 하루(days)에 forgetPerDay만큼 잊을 수 있음
  const days = input.days ?? 1;
  const after = new Set(played.end.holds.filter((h) => !played.end.learned.includes(h) || roll(`forget:${h}`) >= 1 - (1 - played.spec.learning.forgetPerDay) ** days));
  const frags = (s: Set<string>) => [...s].map((id) => fragmentOf(map, id)).filter((f): f is Fragment => Boolean(f));
  const out: SceneRun[] = [];
  for (const g of input.gaps) {
    const fs = fragmentsIn(map, gapText(g)).map((x) => x.id);
    const lackedBefore = fs.some((f) => played.missed.includes(f));
    const run: SceneRun = { gapId: g.id, title: g.title, fragments: fs, made: false, expectBefore: lackedBefore && g.wrongVerified ? "same" : lackedBefore ? "같은 실수 · 미확정 · 다른 실수(통과는 아님)" : "pass", ok: null };
    const scene = await makeScene(g, { rec }).catch((e) => { run.why = `장면 만들기 실패: ${(e as Error).message.slice(0, 120)}`; return null; });
    if (!scene) { run.why ??= input.voice.name === "dry" ? "AI 필요(가짜 AI로는 고치기 장면만 만들 수 있음)" : "장면을 만들지 못함(검사 통과 못 함)"; out.push(run); continue; }
    run.made = true; run.format = scene.format;
    const answerFor = async (holds: Set<string>) => {
      if (scene.format === "fix") return fixAnswer(map, scene.origin?.code ?? scene.template ?? "", holds, played.end.route);
      const unknown = map.fragments.filter((f) => f.layer === 1 && !f.wrong && !holds.has(f.id));
      const known = scrubExamples(frags(holds), unknown);
      const a = await input.voice.sceneAnswer(publicScene(scene) as unknown as Record<string, unknown>, known.filter((f) => !f.wrong), known.filter((f) => f.wrong)).catch(() => null);
      return a;
    };
    for (const [side, holds] of [["before", before], ["after", after]] as const) {
      const ans = await answerFor(holds);
      if (ans === null) { run[side] = { verdict: "AI 필요", answer: "" }; continue; }
      const gr = await gradeScene(scene, g, ans).catch((e) => ({ verdict: `채점 실패: ${(e as Error).message.slice(0, 60)}` }));
      run[side] = { verdict: gr.verdict, answer: ans.slice(0, 1500) };
    }
    const b = run.before?.verdict, a = run.after?.verdict;
    if (b && a && b !== "AI 필요" && a !== "AI 필요") run.ok = (lackedBefore ? b !== "pass" : b === "pass") && a === "pass";
    out.push(run);
  }
  return out;
}

/* ---------- 검사 5: 진짜 사람과 맞춰 보기 ---------- */
/** 막힌 곳 · 물은 것의 층 분포(1~6층). 사람 기록(예: 2606 말 34개의 층 표)과 "나 닮은 NPC"를 나란히 본다. */
export function layerDistribution(p: Played): Record<string, number> {
  const out: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const k of p.key) if ("stuck" in k && k.layer >= 1 && k.layer <= 6) out[k.layer]++;
  return out;
}
export function compareLayers(human: Record<string, number>, npc: Record<string, number>) {
  const sum = (x: Record<string, number>) => Object.values(x).reduce((a, b) => a + b, 0) || 1;
  const hs = sum(human), ns = sum(npc);
  const rows = ["1", "2", "3", "4", "5", "6"].map((l) => ({ layer: l, human: (human[l] ?? 0) / hs, npc: (npc[l] ?? 0) / ns }));
  // 두 분포의 차이(전체 변동 거리, 0 = 같음 · 1 = 전혀 다름)
  const tv = rows.reduce((s, r) => s + Math.abs(r.human - r.npc), 0) / 2;
  return { rows, tv, md: ["| 층 | 사람 | NPC |", "|---|---|---|", ...rows.map((r) => `| ${r.layer} | ${(r.human * 100).toFixed(0)}% | ${(r.npc * 100).toFixed(0)}% |`), "", `차이(전체 변동 거리) ${tv.toFixed(2)} — 0이면 같고 1이면 전혀 달라요.`].join("\n") };
}

/* ---------- 보고서 ---------- */
export type NpcScore = { name: string; played: Played; gaps: GapScore; memory: MemoryScore; tutor: TutorScore; scenes: SceneRun[];
  expect?: { route: string; see: string }; checks: Array<{ what: string; ok: boolean | null; note: string }>; usage?: { calls: number; tokens: number; measured: boolean; by: Record<string, { calls: number; tokens: number }> };
  review?: string | null; errors?: string[] };
const yes = (b: boolean | null) => (b === null ? "–" : b ? "예" : "아니오");
/** 자동 확인(설계 8번 판정 기준 중 코드로 볼 수 있는 것) */
export function autoChecks(map: ProblemMap, p: Played, expect?: { route: string }) {
  const firstRoute = (p.key.find((k) => "route" in k && "why" in k) as { route?: string } | undefined)?.route ?? "-";
  const routes = [...new Set(p.key.flatMap((k) => ("route" in k && "why" in k ? [String(k.route)] : "submit" in k ? [k.route] : [])))].filter((r) => r !== "-");
  const lacking = new Set([...map.fragments.filter((f) => !f.wrong && !p.start.holds.includes(f.id)).map((f) => f.id), ...p.start.wrongs]);
  const stucks = p.key.filter((k): k is Extract<KeyEvent, { stuck: string }> => "stuck" in k && k.stuck !== "방법");
  const badStuck = stucks.filter((s) => !lacking.has(s.stuck) && !map.fragments.some((f) => f.wrong && f.id === s.stuck) && !map.routes.some((r) => r.id === s.stuck));
  const unrep = p.key.filter((k) => "unreproduced" in k).length;
  return [
    { what: "예상한 첫 길로 갔나", ok: expect ? firstRoute === expect.route || routes.includes(expect.route) : null, note: `처음 ${firstRoute}, 거친 길 ${routes.join(" → ") || "-"}${expect ? `, 예상 ${expect.route}` : ""}` },
    { what: "막힌 자리가 빠진(또는 틀린) 조각 자리인가", ok: badStuck.length === 0, note: badStuck.length ? `가진 조각에서 막힘: ${badStuck.map((s) => s.stuck).join(", ")}` : `막힘 ${stucks.length}번 모두 빠진 · 틀린 조각` },
    { what: "길의 판정을 재현했나(재현 못 함 0)", ok: unrep === 0, note: unrep ? `재현 못 함 ${unrep}번` : "모두 재현" },
    { what: "배운 뒤 맞혔나(다 배우면 맞아야 함)", ok: p.end.verdict === "AC" ? true : p.key.some((k) => "end" in k && k.end !== "solved") ? null : false, note: `마지막 판정 ${p.end.verdict}${p.end.copied ? "(튜터 코드 붙여 넣음)" : ""}` },
  ];
}
export function npcReport(s: NpcScore): string {
  const p = s.played;
  const lines = [`## ${s.name}`, "",
    `- 명세: \`${p.spec.id}\` 씨앗 ${p.spec.seed} · 옵션 ${p.spec.options?.join(", ") || "없음"} · ${p.dry ? "가짜 AI(--dry)" : "AI"} · ${p.mode === "strict" ? "엄격" : "느슨"}`,
    `- 처음 가진 조각에서 빠진 것: ${p.missed.length ? p.missed.map((m) => `\`${m}\``).join(", ") : "없음"} · 잘못 앎: ${p.start.wrongs.join(", ") || "없음"} · 애매: ${p.start.vague.join(", ") || "없음"}`,
    `- 끝: ${p.end.verdict} · 길 ${p.end.route} · 배운 것 ${p.end.learned.join(", ") || "없음"} · 질문 ${p.counts.asked} · 제출 ${p.counts.submits} · 도움 ${p.counts.help} · 행동 ${p.counts.actions} · 실수 ${p.slips}`,
    ...(s.expect ? [`- 예상: 길 ${s.expect.route} — 볼 것: ${s.expect.see}`] : []),
    ...(s.usage && p.dry ? [`- 가짜 AI 호출 ${s.usage.calls}번(토큰 0) · ${Object.entries(s.usage.by).map(([k, v]) => `${k} ${v.calls}`).join(", ")}`] : []),
    ...(s.usage && !p.dry ? [`- AI 호출 ${s.usage.calls}번 · 토큰 ${s.usage.tokens.toLocaleString()}${s.usage.measured ? "" : "(일부는 글자 수로 어림)"} · ${Object.entries(s.usage.by).map(([k, v]) => `${k} ${v.calls}`).join(", ")}`] : []),
    "", "### 자동 확인", "", "| 확인 | 결과 | 근거 |", "|---|---|---|", ...s.checks.map((c) => `| ${c.what} | ${yes(c.ok)} | ${c.note} |`),
    "", "### 정답지", "", "```jsonl", ...p.key.map((k) => JSON.stringify(k)), "```",
    "", `### (가) 상황 재현 빈틈 (${s.gaps.from === "ai" ? "앱이 AI로 뽑음" : s.gaps.from === "key" ? "정답지로 만든 빈틈 — 뽑기 품질은 못 잼" : "AI 필요: 가짜 AI는 빈틈을 뽑지 않음(장면 단계는 정답지로 만든 빈틈으로 돌림)"})`, "",
    `- 있어야 할 빈틈(없던 조각): ${s.gaps.expected.join(", ") || "없음"} → 맞음 ${s.gaps.hits.length} · 놓침 ${s.gaps.missed.join(", ") || "0"} · 헛짚음 ${s.gaps.falseAlarms.join(", ") || "0"} · 실수를 모름으로 ${s.gaps.slipAsUnknown.length} · 지도 밖 ${s.gaps.outside.length}${s.gaps.copiedCaught !== null ? ` · 복붙을 아직 모름으로 잡음 ${yes(s.gaps.copiedCaught)}` : ""}`,
    ...(s.gaps.found.length ? ["", "| 빈틈 | 종류 · 범위 | 맞춘 조각(근거) | 실수 제출 |", "|---|---|---|---|", ...s.gaps.found.map((g) => `| ${g.title} | ${g.kind} · ${g.scope} | ${g.fragments.join(", ") || "-"} (${g.by.join(", ")}) | ${g.slip ? "예" : ""} |`)] : []),
    "", "### (나) 기억", "", `- 좋음(없던 조각) ${s.memory.good} · 나쁨(가진 조각) ${s.memory.bad} · 못 맞춤 ${s.memory.unmatched}`, ...s.memory.items.slice(0, 12).map((i) => `  - ${i.title} → ${i.fragments.join(", ") || "-"} ${i.ok === null ? "" : i.ok ? "✓" : "✗"}`),
    "", "### (다) 튜터", "", ...(s.tutor.answers.length ? ["| t | 막힌 조각 | 가르친 조각 | 빠진 것 가르침 | 아래층부터 | 통째로 줌 | 코드 줄 |", "|---|---|---|---|---|---|---|",
      ...s.tutor.answers.map((a) => `| ${a.t} | ${a.stuck} | ${a.taught.join(", ") || "-"} | ${yes(a.taughtMissing)} | ${yes(a.lowerFirst)} | ${yes(a.wholeAnswer)} | ${a.codeLines} |`)] : ["- 물은 것 없음"]),
    "", "### (라) 장면 다시 풀기 (배우기 전 → 뒤)", "", ...(s.scenes.length ? ["| 빈틈 | 조각 | 장면 | 전 | 뒤 | 기대(전) | 맞게 갈림 |", "|---|---|---|---|---|---|---|",
      ...s.scenes.map((r) => `| ${r.title} | ${r.fragments.join(", ") || "-"} | ${r.made ? r.format : r.why ?? "못 만듦"} | ${r.before?.verdict ?? "-"} | ${r.after?.verdict ?? "-"} | ${r.expectBefore} | ${yes(r.ok)} |`)] : ["- 빈틈 없음"]),
    "", "### 마지막 코드(사람이 길을 확인)", "", "```python", (p.codes.filter((c) => c.kind === "submit").at(-1)?.code ?? p.codes.at(-1)?.code ?? "").trimEnd(), "```",
    ...(s.errors?.length ? ["", "### 실패한 단계", "", ...s.errors.map((e) => `- ${e}`)] : []), ""];
  return lines.join("\n");
}
export function summaryTable(rows: NpcScore[]) {
  return ["| NPC | 예상 길 | 거친 길 | 막힌 조각 | 판정 흐름 | 질문 · 제출 · 행동 | 빈틈 맞음/놓침/헛짚음 | 기억 좋음/나쁨 | 튜터가 빠진 것 가르침 | 장면 맞게 갈림 |", "|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((s) => {
      const p = s.played;
      const routes = [...new Set(p.key.flatMap((k) => ("route" in k && "why" in k ? [String(k.route)] : "submit" in k ? [k.route] : [])))].join("→");
      const stucks = [...new Set(p.key.flatMap((k) => ("stuck" in k ? [`${k.stuck}(${k.reaction})`] : [])))].slice(0, 4).join(", ");
      const flow = p.codes.filter((c) => c.kind !== "draft").map((c) => c.verdict).join(" ");
      const tm = s.tutor.answers.length ? `${s.tutor.answers.filter((a) => a.taughtMissing).length}/${s.tutor.answers.length}` : "-";
      const sc = s.scenes.filter((x) => x.ok !== null);
      return `| ${s.name} | ${s.expect?.route ?? "-"} | ${routes} | ${stucks || "-"} | ${flow} | ${p.counts.asked} · ${p.counts.submits} · ${p.counts.actions} | ${s.gaps.hits.length}/${s.gaps.missed.length}/${s.gaps.falseAlarms.length}${s.gaps.from === "none" ? " (AI 필요)" : ""} | ${s.memory.good}/${s.memory.bad} | ${tm} | ${sc.length ? `${sc.filter((x) => x.ok).length}/${sc.length}` : "–"} |`;
    })].join("\n");
}
