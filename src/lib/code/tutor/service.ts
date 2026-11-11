// PS 튜터: 화면이 부르는 일 (2026-11-08). 정답 대조·기록·다음 할 일은 모두 코드가 한다. 런타임 AI 호출은 없다
// (교육용 문제 모델은 미리 한 번 만들어 둔 것, 구현 단계의 힌트는 원래 문제 화면의 것).
//   - 화면에 보내는 활동에는 답을 넣지 않는다(드릴의 정답 접근, 설계의 맞는 상태, 예측의 답). 답은 제출한 뒤 피드백으로만.
//   - 기억에는 몰랐던 게 드러나고 그 자리에서 배운 것만 넣는다(아래 "기억 저장소와 잇기").
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { recordEvent, saveMany, type KEventKind } from "../../knowledge/api.ts";
import { patternsOfNumber, readLinks, writeLink } from "./links.ts";
import { appendLesson, lessonLine, refineAiHelp, type LessonKind } from "./lessons.ts";
import { parsePsId } from "./review.ts";
import { fillProblem, problemIdOf } from "../bakingdog.ts";
import { clearDraft, listProblems, readProblem, readProblemMeta, readSubmissions, saveDraft } from "../problems.ts";
import type { Lang } from "../run.ts";
import { RUNG_LABEL, skeletonFor, skeletonText } from "./help.ts";
import { COMPLEXITIES, complexityVerdict } from "../train.ts";
import { patternOf, PATTERNS } from "./patterns.ts";
import { learningOrder, nextActions, pendingChecks, type Action } from "./policy.ts";
import { levelOf, ORDERED, readProfile, updateProfile, type Level, type Profile } from "./profile.ts";
import { OPTIONAL_STEP, placeOf, STEPS } from "./curriculum.ts";
import { board } from "./summary.ts";
import { answerOf, conceptIdOf, conceptOf, conceptOptions, diffOf, USUALLY } from "./concepts.ts";
import { ensurePool, modelForProblem, prepareModels, prepStatus, readModels, tutorNumberOf, tutorTargets, type ProblemModel } from "./problem-model.ts";
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
  // 뜻은 한 줄만(11/10 사용자 "흔한 실수 이런 거 빼, 문제 출제 느낌 아님"). 내가 무엇을 몰랐는지는 기록·요약(summary.ts)이 보여 준다.
  const body = p.what;
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
type Card = { situation: string; gap: string; fix: string; cue: string; distinguish?: string };
/** 구별할 조건(11/8 GPT 점검): 대조 문제가 있으면 그 차이, 없으면 그럴듯하지만 아닌 접근이 왜 아닌지 하나. */
const distinguishOf = (m: ProblemModel) => {
  if (m.contrast?.differs) return m.contrast.differs;
  const w = m.approaches.find((a) => a.verdict !== "best" && a.why);
  return w ? `「${w.name}」이 아닌 이유: ${w.why}` : "";
};
/** 사건을 남기고, 몰랐던 게 드러났으면 배운 것 카드를 만들어 기억에 한 줄로 넣는다. */
async function record(e: Omit<TutorEvent, "id" | "at">, model?: ProblemModel, card?: Card) {
  const event = await appendEvent(e);
  const where = `BOJ ${e.number}${model ? ` ${model.title}` : ""}`;
  const learn = async (kind: KEventKind, lk: LessonKind) => {
    if (!card) return toMemory(e.patterns, kind, true, `${where}: ${ABILITY_LABEL[e.ability ?? "recognize"]}`);
    for (const pid of e.patterns) await appendLesson({ pattern: pid, number: e.number, title: model?.title ?? "", kind: lk, refined: "code", ...card }).catch(() => undefined);
    await toMemory(e.patterns, kind, true, lessonLine(card));
  };
  if (e.kind === "predict" && e.ok === false) await learn("wrong", "predict");
  else if (e.ability && e.ok !== undefined) {
    const lk: LessonKind = e.kind === "design" ? "design" : e.kind === "implement" ? "implement" : "drill";
    if (e.hinted || !e.ok) await learn(e.hinted && e.ok ? "hint" : "wrong", lk);
    else await toMemory(e.patterns, "correct", false, `${where} ${ABILITY_LABEL[e.ability]}: 혼자 맞힘 (${GRADE_LABEL[e.grade]})`);
  }
  return event;
}
/** 문제 화면에서 AI에게 배운 것(힌트·드래그 설명): 튜터 문제(cp_boj_N, 교육용 모델이 있음)일 때만. AI 1번으로 카드로 정리하고
 *  (실패하면 원문 앞부분), 그 패턴의 기억에 "힌트"로. 화면을 기다리게 하지 않게 경로에서는 끝나기를 기다리지 않는다. */
export async function noteAiHelp(problemId: string, what: string, text: string) {
  const n = await tutorNumberOf(problemId);
  if (!n) return;
  const patterns = await patternsOfNumber(n);
  if (!patterns.length) return;
  const model = (await readModels())[n];
  const names = patterns.map((id) => patternOf(id)?.name ?? id).join(", ");
  const refined = await refineAiHelp({ what, text, problem: model ? `BOJ ${n} ${model.title}: ${model.summary}` : `BOJ ${n}`, pattern: names,
    choices: patterns.map((id) => ({ id, name: patternOf(id)?.name ?? id })) });
  if (refined === "empty") return; // 격려·되묻기뿐: 배운 것이 없다
  const raw = text.replace(/\s+/g, " ").trim();
  // 어느 패턴 이야기인지(11/10): AI가 고른 하나에만. 정리에 실패하면 이 문제의 첫 패턴에만.
  const target = refined?.pattern && patterns.includes(refined.pattern) ? [refined.pattern] : patterns.slice(0, 1);
  const { pattern: _chosen, ...fields } = refined ?? { pattern: undefined };
  void _chosen;
  const card: Card = refined ? { situation: `BOJ ${n}${model ? ` ${model.title}` : ""}를 풀다 ${what}`, ...(fields as { gap: string; fix: string; cue: string }) }
    : { situation: `BOJ ${n}${model ? ` ${model.title}` : ""}를 풀다 ${what}`, gap: "", fix: raw.slice(0, 200), cue: "" };
  for (const pid of target) await appendLesson({ pattern: pid, number: n, title: model?.title ?? "", kind: what.includes("설명") ? "explain" : "hint", refined: refined ? "ai" : "raw", raw: raw.slice(0, 1200), ...card }).catch(() => undefined);
  await toMemory(target, "hint", true, lessonLine(card));
}

/* ---------- 혼자 구현: 문제 화면의 제출 기록으로 확인 ---------- */
type Pending = { number: string; pattern: string; mixed: boolean; startedAt: string; /** 뼈대에서 채우기 */ fill?: boolean; /** 혼자 다시 풀기 */ redo?: boolean };
/** 튜터를 거치지 않고 문제 화면에서 바로 푼 문제도(유저가 넣은 백준 문제) 재료가 있으면 풀이로 남긴다(11/11): 첫 제출 때 한 번. */
export async function notePlainSolve(problemId: string) {
  const n = await tutorNumberOf(problemId);
  const m = n ? (await readModels())[n] : undefined;
  if (!n || !m?.patterns.length) return;
  const pending = await readJson<Pending[]>("pending.json", []);
  if (pending.some((p) => p.number === n)) return;
  // 이번 풀이의 시작: 이 문제를 마지막으로 맞힌 뒤(없으면 12시간 전)부터. 그 사이에 연 도움 칸·틀린 제출이 이번 풀이에 들어간다.
  const lastOk = (await readEvents()).filter((e) => e.number === n && e.kind === "implement" && e.ok).at(-1)?.at ?? "";
  const since = new Date(Date.now() - 12 * 3600_000).toISOString();
  await writeJson("pending.json", [...pending, { number: n, pattern: m.patterns[0], mixed: false, startedAt: lastOk > since ? lastOk : since }]);
}
/** 구현하러 간 문제의 제출을 본다: 맞았으면(힌트 없이 → 혼자, 힌트 있으면 → 도움) 기록하고 끝. */
export const syncTutorImplement = () => syncImplement();
// 제출 직후와 튜터 화면 열기가 겹쳐도 한 번만 기록되게 차례로.
let syncing: Promise<unknown> = Promise.resolve();
function syncImplement(): Promise<void> {
  const run = syncing.then(() => syncImplementOnce());
  syncing = run.catch(() => undefined);
  return run;
}
async function syncImplementOnce() {
  const pending = await readJson<Pending[]>("pending.json", []);
  if (!pending.length) return;
  const models = await readModels();
  const left: Pending[] = [];
  for (const p of pending) {
    const subs = (await readSubmissions(models[p.number]?.problemId ?? problemIdOf(p.number)).catch(() => [])).filter((s) => s.mode === "submit" && s.at >= p.startedAt);
    const ac = subs.find((s) => s.verdict === "AC");
    if (!ac) { left.push(p); continue; }
    const events = await readEvents();
    // 도움(11/11): 문제 화면의 AI 힌트(제출에 남음) + 연 도움 칸(help 사건). 가장 큰 칸을 그 풀이에 남긴다. AI 힌트만 받았으면 코드까지 본 것이라 4.
    const rungs = events.filter((e) => e.kind === "help" && e.number === p.number && e.at >= p.startedAt).map((e) => e.help ?? 0);
    const aiHints = subs.some((s) => s.hints > 0);
    const help = Math.max(p.fill ? 4 : 0, aiHints ? 4 : 0, ...rungs) as 0 | 1 | 2 | 3 | 4;
    const hinted = help > 0;
    const m = models[p.number], where = `BOJ ${p.number}${m ? ` ${m.title}` : ""}`;
    // 어느 칸에서 풀렸는지가 곧 "어디서 막혔나"다: 1·2칸 → 방법을 못 떠올림, 3칸 → 계획, 4칸·AI 힌트·뼈대 → 코드로 옮기기.
    const gap = p.fill ? "뼈대가 있어야 짤 수 있었어요(핵심 줄만 직접 채움)" : help <= 2 ? "어떤 방법을 쓸지 혼자서는 떠올리지 못했어요" : help === 3 ? "방법은 알았지만 무엇을 적어 두고 어떻게 바꿀지 몰랐어요" : "계획은 섰지만 코드로 옮기다 막혔어요";
    const fix = !m ? "" : help <= 2 ? `${m.patterns.map((id) => patternOf(id)?.name ?? id).join(", ")} — ${m.approaches.find((x) => x.verdict === "best")?.name ?? m.walkthrough.choose}` : m.update || m.state.right;
    await record({ kind: "implement", number: p.number, patterns: [p.pattern], ability: "execute", ok: true, hinted, ...(hinted ? { help } : {}), ...(p.fill ? { fill: true } : {}), ...(p.redo ? { redo: true } : {}),
      mixed: p.mixed, grade: gradeOf(events, p.number, "execute", { hinted, mixed: p.mixed }), ms: Date.parse(ac.at) - Date.parse(p.startedAt), detail: `제출 ${subs.length}번${hinted ? ` · 도움 ${help}칸(${RUNG_LABEL[help]})` : ""}` }, m,
      hinted ? { situation: `${where}를 ${p.fill ? "뼈대 코드에서 핵심 줄만 채워" : `도움 ${help}칸(${RUNG_LABEL[help]})까지 받고`} 제출 ${subs.length}번 만에 맞힘`, gap, fix, cue: m?.signals[0] ?? "" } : undefined);
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
  // 보기는 개념 이름(11/10, concepts.ts): 정답 + 이어진(헷갈리는) 개념 둘 + 섞은 것 하나. 요령 패턴만 있는 문제는 예전처럼 접근 문장.
  if (a.kind === "drill") {
    const co = conceptOptions([a.pattern, ...m.patterns], a.id, { withAlso: true });
    return { ...base, options: co ? co.options : shuffle(m.approaches.map((x) => x.name), a.id), concept: Boolean(co), signals: m.signals };
  }
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
  const [models, events, profile] = await Promise.all([readModels(), readEvents(), readProfile()]);
  const state = computeState(events);
  // 설문(11/11): 처음이면 설문부터(할 일 없음). 이미 풀어 온 사람은 설문 없이도 그대로, 원하면 언제든.
  const needSurvey = !profile.surveyed && !events.length;
  const planned = needSurvey ? [] : nextActions(state, models, new Date(), 5, profile.surveyed || profile.focus.length ? profile : undefined);
  const actions = planned.flatMap((a) => (models[a.number] ? [view(a, models[a.number], models)] : []));
  prefetchImplement(planned, events, models);
  void fillAsNeeded(state, planned, models, profile).catch(() => undefined);
  const order = learningOrder(state, profile.surveyed || profile.focus.length ? profile : undefined);
  const covered = PATTERNS.filter((p) => Object.values(models).some((m) => m.patterns.includes(p.id)));
  return {
    targets: tutorTargets().length, ready: Object.keys(models).length, prep: prepStatus(), pending: await readJson<Pending[]>("pending.json", []),
    patterns: covered.map((p) => { const s = state.patterns[p.id]; return { id: p.id, name: p.name, ability: p.ability, what: p.what, seen: s.seen, solid: s.solid, graduated: s.graduated,
      abilities: Object.fromEntries((["recognize", "design", "execute"] as const).map((ab) => [ab, { help: s.abilities[ab].help, freshWins: s.abilities[ab].freshWins, accuracy: s.abilities[ab].accuracy, dueAt: s.abilities[ab].dueAt, due: Boolean(s.abilities[ab].dueAt && Date.parse(s.abilities[ab].dueAt!) <= Date.now()), failStreak: s.abilities[ab].failStreak, n: s.abilities[ab].independent.n + s.abilities[ab].assisted.n }])) }; }),
    actions, done: events.filter((e) => e.ability).length,
    // 한눈에 보기(11/10): 해 본 패턴마다 "지금 어디서 막혔나" 한 줄, 아직 남은 착각이 있는 것부터.
    board: await board().catch(() => []),
    survey: surveyView(profile, needSurvey, state),
    // 다음에 배울 것(11/11): 추천은 순서에서 맨 앞. 사용자가 고르면 분야 집중이 된다.
    learning: { focused: order.focused, focus: profile.focus, next: order.list.slice(0, 6).map((p) => ({ id: p.id, name: p.name, ready: Object.values(models).some((m) => m.patterns.includes(p.id)) })),
      checks: pendingChecks(state, profile).length },
  };
}
/** 미리 만들기(11/9, 사용자 "느리다"): 구현 차례가 오기 전에 그 문제의 숨은 테스트를 뒤에서 만든다. 지금 할 일이 설계면 설계를
 *  맞혔다고 치고 다음 구현 문제를 고른다(정책이 같은 문제를 고르게). 한 번에 하나만, 앱 서버 안에서만(시험에서는 안 함). */
const prefetching = new Set<string>();
function prefetchImplement(planned: ReturnType<typeof nextActions>, events: TutorEvent[], models: Record<string, ProblemModel>) {
  if (!process.env.NEXT_RUNTIME || process.env.RECALLER_TUTOR_PREFETCH === "off" || prefetching.size) return;
  let target = planned.find((a) => a.kind === "implement");
  const first = planned[0];
  if (!target && first?.kind === "design") {
    const ifRight: TutorEvent = { id: "te_if", at: new Date().toISOString(), kind: "design", number: first.number, patterns: models[first.number]?.patterns ?? [first.pattern], ability: "design", ok: true, grade: 3 };
    target = nextActions(computeState([...events, ifRight]), models).find((a) => a.kind === "implement" && a.pattern === first.pattern);
  }
  if (!target || models[target.number]?.problemId) return; // 유저가 넣은 문제는 이미 숨은 테스트가 있다
  const n = target.number;
  prefetching.add(n);
  void (async () => {
    try {
      if (await readProblemMeta(problemIdOf(n)).catch(() => null)) return;
      await fillProblem(n, undefined, { avoid: await mistakesToCatch(n) });
    } catch { /* 실패는 문제집 상태에 남고, 구현을 시작할 때 다시 시도된다 */ } finally { prefetching.delete(n); }
  })();
}
/** 필요할 때 조금씩(11/10): 지금 배우는 패턴과 그다음 패턴은 문제 재료 3개, 복습·할 일에 나온 패턴은 2개가 되게 뒤에서 만든다.
 *  유저가 넣은 백준 문제 중 아직 재료가 없는 것도 하나씩(문제를 만든 직후에 이미 만들지만, 그때 실패했거나 앱이 꺼졌을 때). */
async function fillAsNeeded(state: ReturnType<typeof computeState>, planned: ReturnType<typeof nextActions>, models: Record<string, ProblemModel>, profile?: Profile) {
  if (!process.env.NEXT_RUNTIME) return;
  const chaptersWithTargets = new Set(tutorTargets().map((t) => t.chapter));
  const has = (p: { chapters: string[] }) => p.chapters.some((c) => chaptersWithTargets.has(c));
  const use = profile && (profile.surveyed || profile.focus.length) ? profile : undefined;
  // 확인할 것 둘은 1개씩, 배울 순서(분야 집중이면 그 안)의 앞 둘은 3개씩.
  for (const p of pendingChecks(state, use).filter(has).slice(0, 2)) await ensurePool(p.id, 1);
  const upcoming = learningOrder(state, use).list.filter(has).slice(0, 2);
  for (const p of upcoming) await ensurePool(p.id, 3);
  for (const id of new Set(planned.map((a) => a.pattern))) await ensurePool(id, 2);
  const mine = (await listProblems()).filter((x) => !x.preparing && /^BOJ\s*\d+/.test(x.title) && !Object.values(models).some((m) => m.problemId === x.id || x.title.startsWith(`BOJ ${m.number}번`)));
  if (mine[0]) await modelForProblem(await readProblem(mine[0].id));
}
export const startPrepare = (limit?: number, workers?: number) => prepareModels(limit, workers);

export type Answer =
  | { kind: "walkthrough"; number: string; pattern: string; predict?: string; skipped?: boolean }
  | { kind: "drill"; number: string; pattern: string; mixed: boolean; choice: string; choices?: string[]; hinted?: boolean; ms?: number; /** [모르겠어요] 11/11 */ dunno?: boolean }
  | { kind: "design"; number: string; pattern: string; mixed: boolean; state: string; complexity: string; update?: string; hinted?: boolean; ms?: number }
  | { kind: "contrast"; number: string; pattern: string; picks: Record<string, string> }
  | { kind: "implement"; number: string; pattern: string; mixed: boolean; action: "start" | "giveup"; fill?: boolean; redo?: boolean; lang?: Lang };

const norm = (s: string) => s.replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/g, "")).join("\n").trim();
/** 학습자의 답을 모델과 대조해 기록하고, 피드백(이제 보여 줘도 되는 답)을 돌려준다. */
export async function answer(a: Answer) {
  const models = await readModels();
  const m = models[a.number];
  if (!m) throw Object.assign(new Error("이 문제의 교육용 모델이 아직 없어요."), { status: 404 });
  const events = await readEvents();
  const patterns = m.patterns.length ? m.patterns : [a.pattern];
  // 맞고 틀림은 지금 묻는 패턴에만(11/10, 사용자 "메모리가 정리가 잘 되어 있어야"): 토마토(시작점 여러 개 BFS + 격자 사방 탐색)에서
  // 접근을 틀렸다고 격자 탐색까지 "막힘"이 되지 않게. 시범·대조처럼 본 것은 문제의 모든 패턴에 남긴다.
  const focus = m.patterns.includes(a.pattern) ? [a.pattern] : patterns.slice(0, 1);
  if (a.kind === "walkthrough") {
    if (a.skipped) { await record({ kind: "skip", number: a.number, patterns, grade: 0 }); return { ok: true }; }
    if (!events.some((e) => e.kind === "walkthrough" && e.number === a.number)) await record({ kind: "walkthrough", number: a.number, patterns, grade: 0 }, m);
    if (a.predict === undefined || !m.predict) return { ok: true };
    const ok = Boolean(a.predict.trim()) && norm(a.predict) === norm(m.predict.answer);
    await record({ kind: "predict", number: a.number, patterns: focus, ok, grade: 0, detail: ok ? "예측 맞음" : a.predict.trim() ? "예측 틀림" : "모르겠어요" }, m,
      { situation: `BOJ ${a.number} ${m.title} 시범에서 입력 「${m.predict.input.replace(/\n/g, " / ").slice(0, 40)}」의 출력을 ${a.predict.trim() ? `「${a.predict.trim().replace(/\n/g, " / ").slice(0, 40)}」로 예측` : "예측하지 못함"}`,
        gap: a.predict.trim() ? `결과가 「${a.predict.trim().replace(/\n/g, " / ").slice(0, 40)}」일 줄 알았는데 「${m.predict.answer.replace(/\n/g, " / ").slice(0, 40)}」였어요` : `결과를 떠올리지 못했어요(답은 「${m.predict.answer.replace(/\n/g, " / ").slice(0, 40)}」)`,
        fix: m.walkthrough.choose, cue: m.signals[0] ?? "", distinguish: distinguishOf(m) });
    return { ok, answer: m.predict.answer };
  }
  const dunno = a.kind === "drill" && Boolean(a.dunno);
  const picks = a.kind === "drill" && !dunno ? (a.choices?.length ? a.choices : [a.choice]) : [];
  if (a.kind === "drill" && (dunno ? Boolean(answerOf([a.pattern, ...m.patterns]).main) : picks.every((c) => conceptIdOf(c)))) {
    // 개념 보기(11/10): 보기에 나온 정답을 모두 골라야 맞음(둘 다 되는 문제는 둘 다). 틀리면 그 짝의 "언제 이쪽, 언제 저쪽"이 설명이자 카드.
    const { main } = answerOf([a.pattern, ...m.patterns]);
    const shown = conceptOptions([a.pattern, ...m.patterns], `drill:${a.number}:${a.pattern}:${a.mixed ? "m" : "c"}`, { withAlso: true });
    const answers = new Set((shown?.answers ?? []).map((n) => conceptIdOf(n)!));
    const chosen = picks.map((n) => conceptIdOf(n)!);
    const wrongPick = chosen.find((c) => !answers.has(c));
    const missed = [...answers].filter((c) => !chosen.includes(c));
    const ok = !wrongPick && !missed.length;
    const okSet = answers;
    const grade = gradeOf(events, a.number, "recognize", { hinted: a.hinted, mixed: a.mixed });
    const mainC = main ? conceptOf(main) : undefined;
    const best = m.approaches.find((x) => x.verdict === "best");
    const why = dunno && mainC ? `${mainC.name}: ${mainC.what}` : !ok && main ? (wrongPick ? diffOf(main, wrongPick) : undefined) ?? (missed.length ? missed.map((c) => `${conceptOf(c)?.name}도 돼요: ${conceptOf(c)?.what}`).join(" ") : `${mainC?.name}: ${mainC?.what}`) : undefined;
    const card: Card = { situation: dunno ? `BOJ ${a.number} ${m.title}에서 어떤 방법을 쓸지 모르겠다고 했어요` : `BOJ ${a.number} ${m.title}에서 「${picks.join(", ")}」를 골랐어요${a.hinted ? "(눈여겨볼 곳을 보고)" : ""}`,
      gap: dunno ? "이 문제에 어떤 방법을 써야 할지 떠올리지 못했어요" : ok ? "힌트를 보기 전에는 이 방법이 떠오르지 않았어요" : wrongPick ? `「${conceptOf(wrongPick)?.name}」 쓰면 될 줄 알았어요` : `「${missed.map((c) => conceptOf(c)?.name).join(", ")}」도 된다는 걸 몰랐어요`,
      fix: (() => { const usual = answers.size > 1 ? [a.pattern, ...m.patterns].map((p) => USUALLY[p]).find(Boolean) : undefined;
        return ok ? (usual ?? `${mainC?.name ?? ""}: ${mainC?.what ?? ""}`) : `정답은 「${[...answers].map((c) => conceptOf(c)?.name).join("」·「")}」 — ${[why, usual].filter(Boolean).join(" ")}`.trim(); })(), cue: m.signals[0] ?? "" };
    await record({ kind: "drill", number: a.number, patterns: focus, ability: "recognize", ok, hinted: Boolean(a.hinted), mixed: a.mixed, grade, ms: a.ms, detail: dunno ? "모르겠어요" : `고른 것: ${picks.join(", ")}` }, m, card);
    await noteCheck(a.pattern, ok);
    return { ok, concept: true, dunno, intended: ok, answer: mainC?.name ?? "", answers: [...okSet].map((c) => conceptOf(c)?.name ?? c), alsoOk: [...okSet].filter((c) => c !== main).map((c) => conceptOf(c)?.name ?? c),
      wrongPick: wrongPick ? conceptOf(wrongPick)?.name ?? "" : "", missed: missed.map((c) => conceptOf(c)?.name ?? c), why: why ?? "",
      usually: okSet.size > 1 ? [a.pattern, ...m.patterns].map((p) => USUALLY[p]).find(Boolean) ?? "" : "",
      what: mainC?.what ?? "", how: best ? `${best.name}${best.why ? ` — ${best.why}` : ""}` : "", grade: GRADE_LABEL[grade], signals: m.signals,
      patternNames: patterns.map((id) => patternOf(id)?.name ?? id), chapter: m.chapter };
  }
  if (a.kind === "drill") {
    // 맞는 풀이가 여럿일 수 있다(BFS·DFS 둘 다 되는 문제): 의도된 풀이(best)와 "가능하지만 덜 좋음"(ok)은 인식 성공, 느림·틀림은 실패.
    const chosen = dunno ? undefined : m.approaches.find((x) => x.name === a.choice);
    const ok = chosen?.verdict === "best" || chosen?.verdict === "ok";
    const grade = gradeOf(events, a.number, "recognize", { hinted: a.hinted, mixed: a.mixed });
    const best = m.approaches.find((x) => x.verdict === "best");
    const card: Card = { situation: dunno ? `BOJ ${a.number} ${m.title}에서 어떤 방법을 쓸지 모르겠다고 했어요` : `BOJ ${a.number} ${m.title}에서 접근으로 「${a.choice}」를 고름${a.hinted ? "(신호를 보고)" : ""}`,
      gap: dunno ? "이 문제에 어떤 방법을 써야 할지 떠올리지 못했어요" : ok ? "힌트를 보기 전에는 이 방법이 떠오르지 않았어요" : `「${a.choice}」로 풀면 될 줄 알았어요${chosen ? ` (그러면 ${{ slow: "느려요", wrong: "틀려요", ok: "되긴 하지만 더 좋은 방법이 있어요", best: "" }[chosen.verdict]}${chosen.why ? ` — ${chosen.why}` : ""})` : ""}`,
      fix: `「${best?.name ?? "?"}」${best?.why ? ` — ${best.why}` : ""}`, cue: m.signals.join(" · "), distinguish: distinguishOf(m) };
    await record({ kind: "drill", number: a.number, patterns: focus, ability: "recognize", ok, hinted: Boolean(a.hinted), mixed: a.mixed, grade, ms: a.ms, detail: dunno ? "모르겠어요" : `고른 것: ${a.choice}` }, m, card);
    await noteCheck(a.pattern, ok);
    return { ok, dunno, intended: chosen?.verdict === "best", grade: GRADE_LABEL[grade], approaches: m.approaches, signals: m.signals, patternNames: patterns.map((id) => patternOf(id)?.name ?? id), chapter: m.chapter };
  }
  if (a.kind === "design") {
    const stateOk = a.state === m.state.right, cxOk = a.complexity === m.complexity, ok = stateOk && cxOk;
    const grade = gradeOf(events, a.number, "design", { hinted: a.hinted, mixed: a.mixed });
    await record({ kind: "design", number: a.number, patterns: focus, ability: "design", ok, hinted: Boolean(a.hinted), mixed: a.mixed, grade, ms: a.ms,
      detail: `상태: ${a.state} · 복잡도: ${a.complexity}${a.update ? ` · 갱신: ${a.update.slice(0, 120)}` : ""}` }, m,
      { situation: `BOJ ${a.number} ${m.title} 설계에서 상태 「${a.state}」, 복잡도 O(${a.complexity})를 고름`,
        gap: [stateOk ? "" : `「${a.state}」만 기억하면 될 줄 알았어요 (실제로는 「${m.state.right}」이 필요해요)`, cxOk ? "" : `시간이 O(${a.complexity})쯤 걸린다고 봤어요 (실제로는 O(${m.complexity})${m.maxN ? `, N이 최대 ${m.maxN.toLocaleString()}` : ""})`].filter(Boolean).join(" · ") || "도움을 받고서야 맞혔어요",
        fix: m.update, cue: m.signals[0] ?? "", distinguish: distinguishOf(m) });
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
    // 다시 시작하면(뼈대·혼자 다시 포함) 지금부터의 제출·도움만 이번 풀이로 친다.
    const problemId = m.problemId ?? problemIdOf(a.number);
    const had = pending.find((p) => p.number === a.number);
    // 같은 풀이를 다시 여는 것이면 그대로 둔다(그동안의 제출·도움이 이번 풀이). 종류가 바뀌면(뼈대·혼자 다시) 지금부터 새 풀이.
    if (!had || Boolean(had.fill) !== Boolean(a.fill) || Boolean(had.redo) !== Boolean(a.redo)) {
      const rest = pending.filter((p) => p.number !== a.number);
      rest.push({ number: a.number, pattern: a.pattern, mixed: a.mixed, startedAt: new Date().toISOString(), ...(a.fill ? { fill: true } : {}), ...(a.redo ? { redo: true } : {}) });
      await writeJson("pending.json", rest);
      // 혼자 다시: 지난번 코드가 남아 있으면 다시 푸는 게 아니라서, 쓰던 코드를 비운다(제출 기록에는 그대로 남아 있다).
      if (a.redo && a.lang) await clearDraft(problemId, a.lang).catch(() => undefined);
    }
    return { ok: true, problemId };
  }
  // 그만하기: 맞힌 제출이 없으면, 제출한 것이 있을 때만 "혼자 구현 틀림"으로 남긴다(제출이 없으면 기록 없이 닫음).
  await syncImplement();
  const still = (await readJson<Pending[]>("pending.json", [])).find((p) => p.number === a.number);
  if (still) {
    const subs = (await readSubmissions(m.problemId ?? problemIdOf(a.number)).catch(() => [])).filter((s) => s.mode === "submit" && s.at >= still.startedAt);
    // 그만둘 때도 도움을 셈한다(11/11 점검): 뼈대에서 시작했거나 도움 칸·AI 힌트를 썼으면 "도움 받고 틀림"이지 "혼자 틀림"이 아니다.
    const rungs = events.filter((e) => e.kind === "help" && e.number === a.number && e.at >= still.startedAt).map((e) => e.help ?? 0);
    const help = Math.max(still.fill ? 4 : 0, subs.some((s) => s.hints > 0) ? 4 : 0, ...rungs) as 0 | 1 | 2 | 3 | 4;
    if (subs.length) await record({ kind: "implement", number: a.number, patterns: [still.pattern], ability: "execute", ok: false, hinted: help > 0, ...(help ? { help } : {}), ...(still.fill ? { fill: true } : {}), ...(still.redo ? { redo: true } : {}), mixed: still.mixed,
      grade: gradeOf(events, a.number, "execute", { hinted: help > 0, mixed: still.mixed }), detail: `제출 ${subs.length}번, 맞히지 못함${help ? ` · 도움 ${help}칸` : ""}` }, m,
      { situation: `BOJ ${a.number} ${m.title}를 ${still.fill ? "뼈대 코드에서 채우다" : help ? `도움 ${help}칸까지 받고도` : "혼자 구현하다"} 제출 ${subs.length}번 모두 틀리고 그만둠`, gap: "끝까지 짜지 못했어요", fix: m.update, cue: m.signals[0] ?? "", distinguish: distinguishOf(m) });
    await writeJson("pending.json", (await readJson<Pending[]>("pending.json", [])).filter((p) => p.number !== a.number));
  }
  return { ok: false };
}
/** 기억 복습에서 PS 질문(review.ts)을 채점한 뒤: 튜터 사건으로 남긴다. 알아보기 → 인식, 설계 → 설계(둘 다 단원 숨김),
 *  출력 예측 → 예측, 내 실수 다시 보기 → 복습. 기억 기록은 기억 경로가 이미 남겼으므로 여기서는 쓰지 않는다. */
/** 뼈대에서 채우기(11/11): 뼈대를 만들어(AI 1번 + 채점, 이미 있으면 그대로) 문제 화면의 쓰던 코드로 넣는다. */
export async function startFill(number: string, lang: Lang) {
  const m = (await readModels())[number];
  if (!m) throw Object.assign(new Error("이 문제의 교육용 모델이 아직 없어요."), { status: 404 });
  const problemId = m.problemId ?? problemIdOf(number);
  const sk = await skeletonFor(problemId, number, lang);
  await saveDraft(problemId, lang, skeletonText(sk));
  return { ok: true, problemId, blanks: sk.blanks.length };
}

/* ---------- 설문·빠른 확인·분야 집중 (11/11) ---------- */
/** 알아요·잘해요라고 한 패턴의 첫 알아채기 결과를 확인 결과로 남긴다: 틀리면(모르겠어요 포함) 한 칸 내림. */
async function noteCheck(pattern: string, ok: boolean) {
  const p = await readProfile();
  if (!p.surveyed || p.checked[pattern] || (p.levels[pattern] !== "know" && p.levels[pattern] !== "good")) return;
  await updateProfile((x) => ({ ...x, checked: { ...x.checked, [pattern]: ok ? "pass" : "fail" } }));
}
function surveyView(p: Profile, needed: boolean, state: ReturnType<typeof computeState>) {
  return { needed, surveyed: p.surveyed,
    // 묶음 = 커리큘럼 칸(11/11). tier는 칸 번호, tierName은 "자3 줄 서는 것"처럼. 커리큘럼에만 있는 것은 planned로 알려 준다(아직 고를 수 없음).
    steps: [...STEPS, OPTIONAL_STEP].map((s) => ({ n: s.n, part: s.part, code: s.code, name: s.name, planned: s.planned })),
    patterns: ORDERED.map((x) => ({ id: x.id, name: x.name, tier: placeOf(x.id)?.step ?? 13, tierName: `${placeOf(x.id)?.code ?? ""} ${placeOf(x.id)?.stepName ?? ""}`.trim(), example: x.signals.slice(0, 2).join(" · "),
      level: p.levels[x.id] ?? "none", now: levelOf(p, x.id), checked: p.checked[x.id] ?? null, solid: Boolean(state.patterns[x.id]?.solid) })) };
}
export type ProfileOp =
  | { op: "survey"; levels: Record<string, Level> }
  | { op: "later"; pattern: string }
  | { op: "focus"; patterns: string[] }
  | { op: "unfocus" };
/** 설문 저장 · 확인 미루기 · 분야 집중 시작/끝. 패턴 id는 목록에 있는 것만 받는다. */
export async function setProfile(o: ProfileOp) {
  const known = new Set(PATTERNS.map((x) => x.id));
  if (o.op === "survey") {
    const levels = Object.fromEntries(Object.entries(o.levels).filter(([k]) => known.has(k))) as Record<string, Level>;
    // 다시 하면: 수준을 바꾼 패턴만 확인을 다시 한다.
    return updateProfile((x) => ({ ...x, surveyed: true, levels, checked: Object.fromEntries(Object.entries(x.checked).filter(([k]) => x.levels[k] === levels[k])) }));
  }
  if (o.op === "later") return updateProfile((x) => (known.has(o.pattern) ? { ...x, checked: { ...x.checked, [o.pattern]: "skip" } } : x));
  if (o.op === "focus") return updateProfile((x) => ({ ...x, focus: o.patterns.filter((id) => known.has(id)).slice(0, 12) }));
  return updateProfile((x) => ({ ...x, focus: [] }));
}

export async function recordPsReview(questionId: string, correct: boolean, answerText: string) {
  const q = parsePsId(questionId);
  if (!q) return;
  const models = await readModels();
  const patterns = models[q.number]?.patterns.includes(q.pattern) ? models[q.number].patterns : [q.pattern];
  const events = await readEvents();
  const base = { number: q.number, patterns, ok: correct, detail: `기억 복습(${{ mistake: "내 실수 다시 보기", recognize: "알아보기", design: "설계", predict: "출력 예측" }[q.kind]}): ${answerText.slice(0, 80)}` };
  if (q.kind === "recognize") await appendEvent({ ...base, kind: "drill", ability: "recognize", mixed: true, grade: gradeOf(events, q.number, "recognize", { mixed: true }) });
  else if (q.kind === "design") await appendEvent({ ...base, kind: "design", ability: "design", mixed: true, grade: gradeOf(events, q.number, "design", { mixed: true }) });
  else if (q.kind === "predict") await appendEvent({ ...base, kind: "predict", grade: 0 });
  else await appendEvent({ ...base, kind: "review", grade: 0 });
}
/** 숨은 테스트의 틀린 풀이에 꼭 넣을 실수(11/9): 교육용 모델의 느림·틀림 접근과 흔한 실수. 학습자가 실제로 빠질 함정을 테스트가 잡게. */
export async function mistakesToCatch(number: string) {
  const m = (await readModels())[number];
  if (!m) return [];
  return [...m.approaches.filter((a) => a.verdict === "slow" || a.verdict === "wrong").map((a) => `${a.name}${a.why ? ` (${a.why})` : ""}`), ...m.pitfalls].slice(0, 5);
}
export type { Ability };
