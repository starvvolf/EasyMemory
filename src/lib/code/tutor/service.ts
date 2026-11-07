// PS 튜터: 화면이 부르는 일 (2026-11-08). 정답 대조·기록·다음 할 일은 모두 코드가 한다. 런타임 AI 호출은 없다
// (교육용 문제 모델은 미리 한 번 만들어 둔 것, 구현 단계의 힌트는 원래 문제 화면의 것).
//   - 화면에 보내는 활동에는 답을 넣지 않는다(드릴의 정답 접근, 설계의 맞는 상태, 예측의 답). 답은 제출한 뒤 피드백으로만.
//   - 기억에는 몰랐던 게 드러나고 그 자리에서 배운 것만 넣는다(아래 "기억 저장소와 잇기").
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { recordEvent, saveMany, type KEventKind } from "../../knowledge/api.ts";
import { patternsOfNumber, readLinks, writeLink } from "./links.ts";
import { problemIdOf } from "../bakingdog.ts";
import { readSubmissions } from "../problems.ts";
import { COMPLEXITIES, complexityVerdict } from "../train.ts";
import { patternOf, PATTERNS } from "./patterns.ts";
import { nextActions, type Action } from "./policy.ts";
import { prepareModels, prepStatus, readModels, tutorTargets, type ProblemModel } from "./problem-model.ts";
import { ABILITY_LABEL, appendEvent, computeState, gradeOf, GRADE_LABEL, readEvents, type Ability, type TutorEvent } from "./state.ts";

const dir = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "code", "tutor");
async function readJson<T>(name: string, fallback: T): Promise<T> { try { return JSON.parse(await readFile(path.join(dir(), name), "utf8")) as T; } catch { return fallback; } }
async function writeJson(name: string, value: unknown) {
  await mkdir(dir(), { recursive: true });
  const f = path.join(dir(), name), tmp = `${f}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(value), "utf8"); await rename(tmp, f);
}

/* ---------- 기억 저장소와 잇기 (11/8 사용자 결정: "풀었다고 땡이 아니라, 몰랐던 게 확실하고 그걸 배운 것을 기억에") ----------
 * 기억이 되는 때(그 패턴의 기억이 없으면 이때 처음 "몰랐음"으로 생긴다):
 *   - 혼자 틀림(드릴·설계·구현) → 틀림, 무엇을 배웠는지(의도된 풀이·신호·맞는 상태·복잡도·흔한 실수)를 함께
 *   - 신호·힌트를 보고서야 맞힘 → 힌트
 *   - 시범의 결과 예측이 틀리거나 "모르겠어요" → 틀림, 실제 출력과 함께
 *   - 문제 화면에서 AI 힌트·드래그 설명으로 배움 → 힌트, AI가 한 말(앞부분)과 함께 (noteAiHelp)
 * 기억이 되지 않는 때: 시범을 보기만 함, 이미 아는 것을 혼자 맞힘(그 패턴의 기억이 없으면 새로 만들지 않는다).
 * 이미 기억이 된 패턴을 나중에 혼자 맞히면 → 맞힘(앎·졸업으로 간다). */
const SOURCE = (pid: string) => ({ kind: "code" as const, title: "PS 튜터", ref: `tutor:pattern:${pid}` });
async function memoryOf(patternId: string, create: boolean): Promise<string | null> {
  const links = await readLinks();
  if (links[patternId] || !create) return links[patternId] ?? null;
  const p = patternOf(patternId);
  if (!p) return null;
  const body = [p.what, `떠올리게 하는 신호: ${p.signals.join(" · ")}`, `흔한 실수: ${p.pitfalls.join(" · ")}`].join("\n");
  const [saved] = await saveMany([{ title: p.name, body, kind: "method", state: "unknown", source: SOURCE(p.id) }]);
  await writeLink(patternId, saved.item.id);
  return saved.item.id;
}
/** 배운 것을 기억에. learned = 몰랐던 게 드러났을 때(만들고 기록), 아니면 이미 기억이 된 패턴만 맞힘으로 갱신. */
async function toMemory(patterns: string[], kind: KEventKind, learned: boolean, detail: string) {
  for (const pid of patterns) {
    const id = await memoryOf(pid, learned).catch(() => null);
    if (id) await recordEvent(id, kind, `[PS 튜터] ${detail}`.slice(0, 600), SOURCE(pid)).catch(() => undefined);
  }
}
async function record(e: Omit<TutorEvent, "id" | "at">, model?: ProblemModel, lesson = "") {
  const event = await appendEvent(e);
  const where = `BOJ ${e.number}${model ? ` ${model.title}` : ""}`;
  if (e.kind === "predict" && e.ok === false) await toMemory(e.patterns, "wrong", true, `${where} 결과 예측이 달랐음. ${lesson}`);
  else if (e.ability && e.ok !== undefined) {
    const what = `${ABILITY_LABEL[e.ability]}`;
    if (e.hinted) await toMemory(e.patterns, e.ok ? "hint" : "wrong", true, `${where} ${what}: 도움을 받고서야 ${e.ok ? "맞힘" : "풀지 못함"}. ${lesson}`);
    else if (!e.ok) await toMemory(e.patterns, "wrong", true, `${where} ${what}에서 몰랐던 것: ${lesson}`);
    else await toMemory(e.patterns, "correct", false, `${where} ${what}: 혼자 맞힘 (${GRADE_LABEL[e.grade]})`);
  }
  return event;
}
/** 문제 화면에서 AI에게 배운 것(힌트·드래그 설명): 튜터 문제(cp_boj_N, 교육용 모델이 있음)일 때만, 그 패턴의 기억에. */
export async function noteAiHelp(problemId: string, what: string, text: string) {
  const n = /^cp_boj_(\d{1,6})$/.exec(problemId)?.[1];
  if (!n) return;
  const patterns = await patternsOfNumber(n);
  if (!patterns.length) return;
  await toMemory(patterns, "hint", true, `BOJ ${n} ${what}로 배운 것: ${text.replace(/\s+/g, " ").trim().slice(0, 300)}`);
}

/* ---------- 혼자 구현: 문제 화면의 제출 기록으로 확인 ---------- */
type Pending = { number: string; pattern: string; mixed: boolean; startedAt: string };
/** 구현하러 간 문제의 제출을 본다: 맞았으면(힌트 없이 → 혼자, 힌트 있으면 → 도움) 기록하고 끝. */
async function syncImplement() {
  const pending = await readJson<Pending[]>("pending.json", []);
  if (!pending.length) return;
  const models = await readModels();
  const left: Pending[] = [];
  for (const p of pending) {
    const subs = (await readSubmissions(problemIdOf(p.number)).catch(() => [])).filter((s) => s.mode === "submit" && s.at >= p.startedAt);
    const ac = subs.find((s) => s.verdict === "AC");
    if (!ac) { left.push(p); continue; }
    const events = await readEvents();
    const hinted = subs.some((s) => s.hints > 0);
    await record({ kind: "implement", number: p.number, patterns: models[p.number]?.patterns ?? [p.pattern], ability: "execute", ok: true, hinted,
      mixed: p.mixed, grade: gradeOf(events, p.number, "execute", { hinted, mixed: p.mixed }), ms: Date.parse(ac.at) - Date.parse(p.startedAt), detail: `제출 ${subs.length}번` }, models[p.number],
      `제출 ${subs.length}번 만에 맞힘(문제 화면의 힌트를 받음)`);
  }
  await writeJson("pending.json", left);
}

/* ---------- 화면 ---------- */
const shuffle = <T,>(xs: T[], seed: string) => { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0; return xs.map((x, i) => ({ x, k: (h ^ (i * 2654435761)) >>> 0 })).sort((a, b) => a.k - b.k).map((v) => v.x); };
/** 화면에 보내는 활동: 답은 빼고, 단원을 숨긴 활동에는 단원·패턴 이름도 뺀다. */
function view(a: Action, m: ProblemModel, models: Record<string, ProblemModel>) {
  const base = { ...a, title: m.title, url: m.url, chapter: a.mixed ? null : m.chapter, patternName: a.mixed ? null : patternOf(a.pattern)?.name ?? null,
    summary: m.summary, statement: m.statement, inputText: m.inputText, outputText: m.outputText, example: m.example ?? null, maxN: m.maxN };
  if (a.kind === "walkthrough") return { ...base, walkthrough: m.walkthrough, signals: m.signals, pitfalls: m.pitfalls, patternNames: m.patterns.map((id) => patternOf(id)?.name ?? id),
    predict: m.predict ? { question: m.predict.question, input: m.predict.input } : null };
  // 신호는 답이 아니라 힌트: 화면은 "신호 보기"를 누를 때만 보여 주고, 누르면 도움 받은 것으로 남긴다.
  if (a.kind === "drill") return { ...base, options: shuffle(m.approaches.map((x) => x.name), a.id), signals: m.signals };
  if (a.kind === "design") return { ...base, states: shuffle([m.state.right, ...m.state.wrong], a.id), complexities: Object.keys(COMPLEXITIES) };
  if (a.kind === "contrast") {
    const other = m.contrast ? models[m.contrast.number] : undefined;
    const names = [...new Set([...m.patterns, ...(other?.patterns ?? [])])].map((id) => ({ id, name: patternOf(id)?.name ?? id }));
    return { ...base, other: other ? { number: other.number, title: other.title, summary: other.summary } : null, patternChoices: shuffle([...names, ...PATTERNS.filter((p) => !names.some((n) => n.id === p.id)).slice(0, 2).map((p) => ({ id: p.id, name: p.name }))], a.id) };
  }
  return base;
}

export async function tutorOverview() {
  await syncImplement().catch(() => undefined);
  const [models, events] = await Promise.all([readModels(), readEvents()]);
  const state = computeState(events);
  const actions = nextActions(state, models).flatMap((a) => (models[a.number] ? [view(a, models[a.number], models)] : []));
  const covered = PATTERNS.filter((p) => Object.values(models).some((m) => m.patterns.includes(p.id)));
  return {
    targets: tutorTargets().length, ready: Object.keys(models).length, prep: prepStatus(), pending: await readJson<Pending[]>("pending.json", []),
    patterns: covered.map((p) => { const s = state.patterns[p.id]; return { id: p.id, name: p.name, ability: p.ability, what: p.what, seen: s.seen, solid: s.solid, graduated: s.graduated,
      abilities: Object.fromEntries((["recognize", "design", "execute"] as const).map((ab) => [ab, { help: s.abilities[ab].help, freshWins: s.abilities[ab].freshWins, accuracy: s.abilities[ab].accuracy, dueAt: s.abilities[ab].dueAt, due: Boolean(s.abilities[ab].dueAt && Date.parse(s.abilities[ab].dueAt!) <= Date.now()), failStreak: s.abilities[ab].failStreak, n: s.abilities[ab].independent.n + s.abilities[ab].assisted.n }])) }; }),
    actions, done: events.filter((e) => e.ability).length,
  };
}
export const startPrepare = (limit?: number, workers?: number) => prepareModels(limit, workers);

export type Answer =
  | { kind: "walkthrough"; number: string; pattern: string; predict?: string; skipped?: boolean }
  | { kind: "drill"; number: string; pattern: string; mixed: boolean; choice: string; hinted?: boolean; ms?: number }
  | { kind: "design"; number: string; pattern: string; mixed: boolean; state: string; complexity: string; update?: string; hinted?: boolean; ms?: number }
  | { kind: "contrast"; number: string; pattern: string; picks: Record<string, string> }
  | { kind: "implement"; number: string; pattern: string; mixed: boolean; action: "start" | "giveup" };

const norm = (s: string) => s.replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/g, "")).join("\n").trim();
/** 학습자의 답을 모델과 대조해 기록하고, 피드백(이제 보여 줘도 되는 답)을 돌려준다. */
export async function answer(a: Answer) {
  const models = await readModels();
  const m = models[a.number];
  if (!m) throw Object.assign(new Error("이 문제의 교육용 모델이 아직 없어요."), { status: 404 });
  const events = await readEvents();
  const patterns = m.patterns.length ? m.patterns : [a.pattern];
  if (a.kind === "walkthrough") {
    if (a.skipped) { await record({ kind: "skip", number: a.number, patterns, grade: 0 }); return { ok: true }; }
    if (!events.some((e) => e.kind === "walkthrough" && e.number === a.number)) await record({ kind: "walkthrough", number: a.number, patterns, grade: 0 }, m);
    if (a.predict === undefined || !m.predict) return { ok: true };
    const ok = Boolean(a.predict.trim()) && norm(a.predict) === norm(m.predict.answer);
    await record({ kind: "predict", number: a.number, patterns, ok, grade: 0, detail: ok ? "예측 맞음" : a.predict.trim() ? "예측 틀림" : "모르겠어요" }, m,
      `${a.predict.trim() ? `예측 「${a.predict.trim().slice(0, 60)}」, ` : ""}실제 출력 「${m.predict.answer.slice(0, 60)}」. ${m.walkthrough.choose}`);
    return { ok, answer: m.predict.answer };
  }
  if (a.kind === "drill") {
    // 맞는 풀이가 여럿일 수 있다(BFS·DFS 둘 다 되는 문제): 의도된 풀이(best)와 "가능하지만 덜 좋음"(ok)은 인식 성공, 느림·틀림은 실패.
    const chosen = m.approaches.find((x) => x.name === a.choice);
    const ok = chosen?.verdict === "best" || chosen?.verdict === "ok";
    const grade = gradeOf(events, a.number, "recognize", { hinted: a.hinted, mixed: a.mixed });
    const best = m.approaches.find((x) => x.verdict === "best");
    const lesson = `고른 「${a.choice}」${chosen ? `(${{ best: "의도된 풀이", ok: "가능하지만 덜 좋음", slow: "맞지만 느림", wrong: "틀림" }[chosen.verdict]}${chosen.why ? `: ${chosen.why}` : ""})` : ""}. 의도된 풀이 「${best?.name ?? "?"}」${best?.why ? ` — ${best.why}` : ""}. 신호: ${m.signals.join(" · ")}`;
    await record({ kind: "drill", number: a.number, patterns, ability: "recognize", ok, hinted: Boolean(a.hinted), mixed: a.mixed, grade, ms: a.ms, detail: `고른 것: ${a.choice}` }, m, lesson);
    return { ok, intended: chosen?.verdict === "best", grade: GRADE_LABEL[grade], approaches: m.approaches, signals: m.signals, patternNames: patterns.map((id) => patternOf(id)?.name ?? id), chapter: m.chapter };
  }
  if (a.kind === "design") {
    const stateOk = a.state === m.state.right, cxOk = a.complexity === m.complexity, ok = stateOk && cxOk;
    const grade = gradeOf(events, a.number, "design", { hinted: a.hinted, mixed: a.mixed });
    await record({ kind: "design", number: a.number, patterns, ability: "design", ok, hinted: Boolean(a.hinted), mixed: a.mixed, grade, ms: a.ms,
      detail: `상태: ${a.state} · 복잡도: ${a.complexity}${a.update ? ` · 갱신: ${a.update.slice(0, 120)}` : ""}` }, m,
      `${stateOk ? "" : `기억할 상태는 「${m.state.right}」(고른 것 「${a.state}」). `}바꾸는 법: ${m.update}. ${cxOk ? "" : `복잡도는 O(${m.complexity})(고른 것 O(${a.complexity})). `}${m.pitfalls.length ? `흔한 실수: ${m.pitfalls.join(" · ")}` : ""}`);
    const verdict = (cx: string) => (m.maxN && cx in COMPLEXITIES ? complexityVerdict(cx, m.maxN, 1000).note : null);
    return { ok, stateOk, cxOk, state: m.state, update: m.update, complexity: m.complexity, mine: verdict(a.complexity), theirs: verdict(m.complexity), pitfalls: m.pitfalls, grade: GRADE_LABEL[grade] };
  }
  if (a.kind === "contrast") {
    const other = m.contrast ? models[m.contrast.number] : undefined;
    const right = (mm?: ProblemModel) => (mm ? mm.patterns : []);
    const okThis = right(m).includes(a.picks[m.number]), okOther = other ? right(other).includes(a.picks[other.number]) : true;
    await record({ kind: "contrast", number: a.number, patterns, ok: okThis && okOther, grade: 0 });
    return { ok: okThis && okOther, differs: m.contrast?.differs ?? "", mine: right(m).map((id) => patternOf(id)?.name ?? id), others: right(other).map((id) => patternOf(id)?.name ?? id) };
  }
  // implement
  const pending = await readJson<Pending[]>("pending.json", []);
  if (a.action === "start") {
    if (!pending.some((p) => p.number === a.number)) pending.push({ number: a.number, pattern: a.pattern, mixed: a.mixed, startedAt: new Date().toISOString() });
    await writeJson("pending.json", pending);
    return { ok: true, problemId: problemIdOf(a.number) };
  }
  // 그만하기: 맞힌 제출이 없으면, 제출한 것이 있을 때만 "혼자 구현 틀림"으로 남긴다(제출이 없으면 기록 없이 닫음).
  await syncImplement();
  const still = (await readJson<Pending[]>("pending.json", [])).find((p) => p.number === a.number);
  if (still) {
    const subs = (await readSubmissions(problemIdOf(a.number)).catch(() => [])).filter((s) => s.mode === "submit" && s.at >= still.startedAt);
    if (subs.length) await record({ kind: "implement", number: a.number, patterns, ability: "execute", ok: false, hinted: subs.some((s) => s.hints > 0), mixed: still.mixed,
      grade: gradeOf(events, a.number, "execute", { mixed: still.mixed }), detail: `제출 ${subs.length}번, 맞히지 못함` }, m,
      `제출 ${subs.length}번 모두 틀림. 바꾸는 법: ${m.update}. ${m.pitfalls.length ? `흔한 실수: ${m.pitfalls.join(" · ")}` : ""}`);
    await writeJson("pending.json", (await readJson<Pending[]>("pending.json", [])).filter((p) => p.number !== a.number));
  }
  return { ok: false };
}
export type { Ability };
