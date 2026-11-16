// 장면 만들기 (설계 5번): 똑같이 = 기록에서 잘라 옴(AI 0번) · 비슷하게 · 응용 = AI 1번 또는 은행. 만든 뒤 코드가 검사하고(check.ts),
// 형식은 표(ladder.ts formatsFor)의 앞에서부터: 첫 형식은 두 번까지, 다음 형식은 한 번. 그래도 안 되면 은행 → 똑같이(고치기)로 물러난다.
// 검사를 통과하지 못한 장면은 안 보인다.
import { judge, normalizeOutput, type TestCase } from "../code/run.ts";
import { checkScene } from "./check.ts";
import { langOf } from "./exec.ts";
import { defaultAsk, recordOf, type Ask, type Record_ } from "./extract.ts";
import { formatsFor } from "./ladder.ts";
import { makePracticeScene, practiceFormats, practiceMaterial } from "./practice/index.ts";
import { PRACTICE_MADE } from "./practice/formats.ts";
import { MIX_NOTE, SCENE_SCHEMA, SCENE_SYSTEM, type SceneReply } from "./prompts.ts";
import { bankScene, newId, readAttempts, readGaps, saveScene } from "./store.ts";
import { DISTANCE_LABEL, FORMAT_LABEL, PRACTICE_FORMATS, STATEMENT_CAP, type Format, type Gap, type Scene } from "./types.ts";

/** 장면 지시문에 넣을 원래 상황(알고리즘 문제 또는 실습 목표) */
export type Material = { title: string; statement: string; lang: string };

const wrongSubOf = (gap: Gap, rec: Record_) => {
  const ids = gap.evidence.flatMap((e) => (e.type === "submission" && e.verdict && e.verdict !== "AC" ? [e.id] : []));
  return rec.subs.filter((s) => ids.includes(s.id) && s.verdict !== "CE").at(-1) ?? null;
};
const now = () => new Date().toISOString();

/** 원래 테스트 중 작은 것에서 그 코드가 맞히는 기본 2개 · 틀리는 가르는 3개 */
async function recordInputs(rec: Record_, code: string, lang: string) {
  const tests: TestCase[] = [...rec.tests].sort((a, b) => a.input.length - b.input.length).slice(0, 80);
  const j = await judge(langOf(lang), code, tests, { timeLimitMs: rec.timeLimitMs });
  const basic = j.results.filter((r) => r.verdict === "AC").slice(0, 2).map((r) => tests[r.index]);
  const split = j.results.filter((r) => r.verdict !== "AC").slice(0, 3).map((r) => tests[r.index]);
  return { basic, split };
}

/** 똑같이(조각 이상): 그때 틀린 제출 코드에서 시작해 고치기. */
export async function sameScene(gap: Gap, rec: Record_): Promise<Scene | null> {
  const sub = wrongSubOf(gap, rec);
  if (!sub) return null;
  const { basic, split } = await recordInputs(rec, sub.code, sub.lang);
  if (!split.length) return null;
  const ac = rec.subs.filter((s) => s.verdict === "AC" && s.lang === sub.lang).at(-1);
  const picked = [...basic, ...split];
  const scene: Scene = { id: newId("sc"), gapId: gap.id, format: "fix", lang: sub.lang, distance: "same", target: gap.target,
    story: `${rec.title}에서 그때 낸 코드예요. 이 코드는 아래 입력에서 틀려요.`, ask: "틀린 곳을 고쳐 보세요.", explain: gap.missed,
    setup: "", after: "", template: sub.code, reference: ac?.code ?? "", alsoRight: [], wrongs: [{ id: "mine", what: gap.wrong || gap.title, code: sub.code }],
    inputs: picked.map((t) => ({ role: "basic" as const, stdin: t.input })), origin: { problemId: rec.problemId, code: sub.code, failIndex: basic.length },
    computed: { expected: picked.map((t) => normalizeOutput(t.output)), shapes: {} },
    createdAt: now(), madeBy: "record" };
  return checkScene(scene);
}

/**
 * 똑같이(한 줄 범위, 설계 4번): 그때 코드에서 그 줄 근처만 보여 주고 그 줄을 다시 쓰게 한다. 빈칸 = 증거가 가리킨 줄(들여쓰기는 남김).
 * 채점은 원래 문제 테스트(그 코드가 맞히는 기본 2개 · 틀리는 가르는 3개).
 */
export async function sameLineScene(gap: Gap, rec: Record_): Promise<Scene | null> {
  const sub = wrongSubOf(gap, rec);
  const ev = gap.evidence.find((e) => e.type === "submission" && e.id === sub?.id && e.lines);
  if (!sub || !ev || ev.type !== "submission" || !ev.lines) return null;
  const lines = sub.code.replace(/\r/g, "").split("\n");
  const [a, b] = [Math.max(1, ev.lines[0]), Math.min(lines.length, ev.lines[1])];
  if (b < a || b - a > 2) return null;
  const old = lines.slice(a - 1, b);
  const template = [...lines.slice(0, a - 1), ...old.map((l) => `${l.match(/^\s*/)![0]}____`), ...lines.slice(b)].join("\n");
  const { basic, split } = await recordInputs(rec, sub.code, sub.lang);
  if (split.length < 2) return null;
  const picked = [...basic, ...split];
  const scene: Scene = { id: newId("sc"), gapId: gap.id, format: "blank", lang: sub.lang, distance: "same", target: gap.target,
    story: `${rec.title}에서 그때 낸 코드의 일부예요. 빈칸 줄이 그때 틀렸던 곳이에요.`, ask: "빈칸 줄을 다시 써 보세요.", explain: gap.missed,
    setup: "", after: "", template, reference: "", alsoRight: [], wrongs: [{ id: "mine", what: gap.wrong || gap.title, code: old.map((l) => l.trim()).join("\n") }],
    inputs: picked.map((t) => ({ role: "basic" as const, stdin: t.input })), origin: { problemId: rec.problemId, code: sub.code, failIndex: basic.length },
    view: { from: Math.max(1, a - 3), to: Math.min(lines.length, b + 3) },
    computed: { expected: picked.map((t) => normalizeOutput(t.output)), shapes: {} }, createdAt: now(), madeBy: "record" };
  return checkScene(scene);
}

export function sceneUser(gap: Gap, format: Format, rec: Pick<Material, "title" | "statement"> & { lang?: string }, extra: { collected?: string[]; mix?: Gap[] } = {}) {
  const one = (g: Gap, i?: number) => [
    `[빈틈${i !== undefined ? ` ${i + 1}` : ""}] ${g.title} (종류 ${g.kind}, 확인할 것 ${g.target === "form" ? "표현(form)" : "능력(ability)"})`,
    `떠올렸어야 할 생각: ${g.missed}`,
    g.wrong ? `그때 생각(mine): ${g.wrong}` : "그때 생각: 아무것도 못 떠올림 (mine은 가장 그럴듯한 빠뜨림으로)",
    g.kernel.code ? `맞는 생각이 담긴 코드:\n${g.kernel.code}${g.kernel.needs.length ? `\n(가정: ${g.kernel.needs.join(", ")})` : ""}` : "",
  ].filter(Boolean).join("\n");
  const gaps = extra.mix?.length ? extra.mix : [gap];
  return [
    gaps.length > 1 ? `${MIX_NOTE}\n\n${gaps.map(one).join("\n\n")}` : one(gap),
    `[원래 ${gap.branch === "practice" ? "실습" : "문제"}] ${rec.title}: ${rec.statement.slice(0, STATEMENT_CAP)}`,
    extra.collected?.length ? `[학습자가 실제로 낸 틀린 답(원인 미확정) — 이 생각들도 wrongs에]\n${extra.collected.map((c, i) => `${i + 1}. ${c.slice(0, 400)}`).join("\n")}` : "",
    `[만들 장면] format=${format} (${FORMAT_LABEL[format]}), distance=${gap.state.distance} (${DISTANCE_LABEL[gap.state.distance]}), scope=${gap.scope}, lang=${rec.lang ?? gap.origin.lang}`,
  ].filter(Boolean).join("\n\n");
}

export function fromReply(gap: Gap, format: Format, r: SceneReply, lang: string, mix?: Gap[]): Scene {
  const id = newId("sc");
  const wrongs = (r.wrongs ?? []).filter((w) => w.id).map((w, i) => {
    if (mix?.length) { const k = Number(/^mine-(\d+)$/.exec(w.id)?.[1] ?? 0); return { ...w, ...(k ? { gapId: mix[k - 1]?.id } : {}) }; }
    return { id: i === 0 ? "mine" : w.id === "mine" ? `w${i}` : w.id, what: w.what, code: w.code };
  });
  const noInputs = format === "choice";
  return { id, gapId: gap.id, format, lang, distance: gap.state.distance, target: gap.target,
    story: r.story, ask: r.ask, explain: r.explain || gap.missed, setup: r.setup ?? "", after: r.after ?? "", ...(r.template ? { template: r.template } : {}),
    reference: r.reference ?? "", alsoRight: gap.target === "form" ? [] : (r.alsoRight ?? []).filter((x) => x.trim()),
    wrongs, inputs: noInputs ? [] : (r.inputs ?? []).map((x) => ({ role: "basic" as const, stdin: x.stdin, ...(x.label ? { label: x.label } : {}) })),
    ...(format === "choice" || format === "error" ? { choices: (r.choices ?? []).map((c) => ({ text: c.text, thought: c.thought })) } : {}),
    ...(r.structure?.length && (format === "write" || format === "function") && gap.target === "form" ? { structure: { must: r.structure.filter((m) => m.pattern) } } : {}),
    ...(r.validator?.trim() ? { validator: r.validator } : {}),
    ...(format === "draw" ? { draw: { mode: r.drawMode === "shape" ? "shape" as const : "value" as const, ...(r.checker ? { checker: r.checker } : {}), ...(r.mineCheck ? { mineCheck: r.mineCheck } : {}) } } : {}),
    ...(mix?.length ? { mix: mix.map((g) => g.id) } : {}),
    topic: gap.topic, createdAt: now(), madeBy: "ai" };
}

/** 원인 미확정으로 끝난 학습자의 답(코드 · 값)을 모아 다음 장면의 wrongs로(설계 한계 3) */
async function collectedOf(gap: Gap) {
  return [...new Set((await readAttempts()).filter((a) => a.gapId === gap.id && a.verdict === "unclear" && !a.gaveUp && a.answer.trim()).map((a) => a.answer.trim()))].slice(-3);
}

/** 장면을 만드는 동안 지금 무엇을 하는지(화면의 "…" 옆 글). 기다림이 길어도 납득할 수 있게(사용자 11/15) */
export type Stage = (text: string) => void;
const noStage: Stage = () => {};

async function aiScene(gap: Gap, format: Format, mat: Material, ask: Ask, tries: number, mix?: Gap[], stage: Stage = noStage): Promise<Scene | null> {
  let problems: string[] = [];
  const collected = await collectedOf(gap).catch(() => []);
  for (let attempt = 1; attempt <= tries; attempt++) {
    const user = sceneUser(gap, format, mat, { collected, ...(mix ? { mix } : {}) }) + (problems.length ? `\n\n[앞 장면 검사에서 걸린 것 — 고쳐서 다시]\n- ${problems.join("\n- ")}` : "");
    stage(attempt === 1 ? `AI가 「${FORMAT_LABEL[format]}」 장면을 쓰는 중` : `검사에서 걸린 곳을 고쳐 다시 쓰는 중 (${attempt}번째)`);
    const reply = await ask<SceneReply>("scene:make", SCENE_SYSTEM, user, SCENE_SCHEMA).catch(() => null);
    if (!reply) continue;
    stage("장면 검사: 모범 답 · 그때 생각을 코드로 돌려 보는 중");
    const scene = await checkScene(fromReply(gap, format, reply, mat.lang, mix));
    if (scene.check?.ok) return scene;
    problems = scene.check?.problems ?? ["검사 실패"];
  }
  return null;
}

/**
 * 변형 문제(형식 10, 알고리즘 고르기의 응용 확인): 같은 함정이 있는 짧은 새 문제. 장면 검사를 통과하면 알고리즘 문제로도 저장해
 * 알고리즘 화면에서 풀 수 있게 한다(저장 조건은 알고리즘과 같게: 다른 풀이(alsoRight)가 모든 테스트에서 같은 답).
 */
async function variantScene(gap: Gap, mat: Material, ask: Ask): Promise<Scene | null> {
  const scene = await aiScene(gap, "variant", { ...mat, lang: "python" }, ask, 2);
  if (!scene) return null;
  if (!scene.alsoRight.length) return null;
  const { saveProblem } = await import("../code/problems.ts");
  const tests = scene.inputs.map((x, i) => ({ input: x.stdin, output: scene.computed!.expected[i] }));
  const title = (scene.story.split("\n")[0] || "변형 문제").replace(/^#+\s*/, "").slice(0, 40);
  const p = await saveProblem({ title: `[상황 재현] ${title}`, statement: scene.story, inputText: "", outputText: "", examples: tests.slice(0, 2), tests: tests.slice(2),
    timeLimitMs: 2000, kind: "full", templates: {}, reference: null, knowledge: [gap.title.slice(0, 40)], folder: "상황 재현",
    source: { kind: "ai", title: `상황 재현 · ${gap.origin.title}` } }).catch(() => null);
  if (!p) return null;
  return { ...scene, variant: { problemId: p.id, title: p.title }, origin: { problemId: p.id, code: "" } };
}

async function materialOf(gap: Gap, rec?: Record_): Promise<{ mat: Material; rec: Record_ | null }> {
  if (gap.branch === "practice") return { mat: await practiceMaterial(gap), rec: null };
  const r = rec ?? await recordOf(gap.origin.problemId);
  return { mat: { title: r.title, statement: r.statement, lang: gap.origin.lang }, rec: r };
}

/** 빈틈의 지금 거리에 맞는 장면 하나. 섞기(mix)가 주어지면 그 빈틈들을 한 장면에(응용). */
export async function makeScene(gap: Gap, opts: { ask?: Ask; rec?: Record_; mix?: Gap[]; /** 시험 · 가상 학습자용: 형식 순서를 정해 줌 */ formats?: Format[]; stage?: Stage } = {}): Promise<Scene | null> {
  const ask = opts.ask ?? defaultAsk;
  const stage = opts.stage ?? noStage;
  stage("그때 기록을 읽는 중");
  const { mat, rec } = await materialOf(gap, opts.rec);
  const keep = async (s: Scene | null) => { if (s?.check?.ok) { await saveScene(s); return s; } return null; };
  if (opts.mix && opts.mix.length > 1) return keep(await aiScene(gap, "function", mat, ask, 2, opts.mix, stage));
  const hasWrong = rec ? Boolean(wrongSubOf(gap, rec)) : gap.state.distance === "same";
  // 실습: 같은 주제의 다른 실습 빈틈(작은 재현 프로젝트 준비 규칙) · 이 빈틈에서 프로젝트를 이미 냈나(한 번만)
  const pctx = gap.branch === "practice" ? {
    siblings: (await readGaps()).filter((g) => g.branch === "practice" && g.topic === gap.topic && g.id !== gap.id),
    projectTried: (await readAttempts()).some((a) => a.gapId === gap.id && a.format === "project"),
  } : null;
  const chain = opts.formats ?? (pctx ? practiceFormats(gap, pctx) : formatsFor(gap, { hasWrongSubmission: hasWrong, lang: gap.origin.lang }));
  for (const [i, f] of chain.entries()) {
    let s: Scene | null = null;
    if (i > 0) stage(`앞 형식이 안 맞아서 「${FORMAT_LABEL[f]}」로 바꿔 보는 중`);
    if (gap.state.distance === "same" && rec && i === 0 && hasWrong && (f === "fix" || f === "blank")) { stage("그때 낸 코드에서 그 자리를 자르고, 원래 테스트로 돌려 보는 중"); s = f === "fix" ? await sameScene(gap, rec) : await sameLineScene(gap, rec); }
    // 실습이 맡는 형식(13~17 · 12, 잠금 한 줄 쓰기 은행). 실습의 한 줄 쓰기는 잠금이 아니면 null → 아래 AI 장면으로
    else if (pctx && (PRACTICE_MADE.includes(f) || f === "write") && (stage(`실습 「${FORMAT_LABEL[f]}」 장면을 준비하는 중`), s = await makePracticeScene(gap, f, { ask, ...pctx }).catch(() => null))) { /* 실습이 만듦 */ }
    else if (PRACTICE_FORMATS.includes(f) || f === "why") s = null;
    else if (f === "variant") { stage("AI가 같은 함정이 있는 새 문제를 쓰는 중(변형 문제, 조금 걸려요)"); s = await variantScene(gap, mat, ask).catch(() => null); }
    else s = await aiScene(gap, f, mat, ask, i === 0 ? 2 : 1, undefined, stage);
    const kept = await keep(s);
    if (kept) return kept;
  }
  // 물러나기: 은행(같은 생각의 안 푼 장면) → 그때 코드로 고치기
  stage("만들어 둔 장면 중에서 찾는 중");
  const banked = await bankScene(gap.topic, gap.state.distance, gap.id);
  if (banked) return banked;
  if (rec && hasWrong) return keep(await sameScene(gap, rec));
  return null;
}
