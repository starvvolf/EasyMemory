// 상황 재현 입구 (API · 화면이 부르는 것): 빈틈 뽑기 · 오늘 볼 것 · 다음 장면 · 미리 실행 · 답 내기.
import { programOf, runAll } from "./exec.ts";
import { extractGaps, type Ask } from "./extract.ts";
import { gradeScene } from "./grade.ts";
import { dueToday, reflect, MINUTES } from "./ladder.ts";
import { makeScene } from "./make.ts";
import { addAttempt, changeGaps, newId, readAttempts, readGaps, readScene, unusedScene } from "./store.ts";
import { VERDICT_LABEL, type Gap, type Scene } from "./types.ts";

/** 보여 줄 입력: 기본 입력. 그때 생각이 모든 입력에서 틀리는 장면이면 첫 입력 하나. */
const shownInputs = (s: Scene) => { const b = s.inputs.filter((x) => x.role === "basic"); return b.length ? b : s.inputs.slice(0, 1); };
/** 화면에 보낼 장면: 정답 · 오답 모양 · 모범 답은 빼고(풀기 전) */
export function publicScene(s: Scene) {
  return { id: s.id, gapId: s.gapId, format: s.format, lang: s.lang, distance: s.distance, story: s.story, ask: s.ask, setup: s.setup, after: s.after,
    template: s.format === "fix" ? s.origin?.code ?? s.template : s.template ?? "", code: s.format === "predict" ? s.reference : "",
    inputs: s.format === "predict" ? s.inputs.map((x) => x.stdin) : shownInputs(s).map((x) => x.stdin),
    failing: s.format === "fix" ? s.inputs.filter((x) => x.role === "split").slice(0, 1).map((x) => x.stdin) : [],
    choices: s.choices?.map((c) => c.text) ?? [], minutes: MINUTES[s.format] };
}
export const gapView = (g: Gap) => ({ id: g.id, title: g.title, kind: g.kind, target: g.target, missed: g.missed, wrong: g.wrong, scope: g.scope, dose: g.dose.level,
  distance: g.state.distance, known: g.state.known, due: g.state.due, passes: g.state.passes, sameMistakes: g.state.sameMistakes, unclear: g.state.unclear,
  origin: g.origin, wrongVerified: g.wrongVerified, doubtful: Boolean(g.doubtful) });

export async function today() {
  const gaps = await readGaps();
  const d = dueToday(gaps);
  return { gaps: d.gaps.map(gapView), minutes: d.minutes, more: d.more, total: gaps.filter((g) => !g.state.known).length };
}
export async function gapsOf(problemId: string) {
  return (await readGaps()).filter((g) => g.origin.problemId === problemId).map(gapView);
}
export async function extract(problemId: string, opts: { ask?: Ask; force?: boolean } = {}) {
  return (await extractGaps(problemId, opts)).map(gapView);
}

/** 빈틈의 다음 장면: 지금 거리 · 아직 안 푼 장면이 있으면 그것, 없으면 새로 만든다. */
const pending = new Map<string, string>();
export async function next(gapId: string, opts: { ask?: Ask } = {}) {
  const gap = (await readGaps()).find((g) => g.id === gapId);
  if (!gap) throw new Error("빈틈을 찾을 수 없어요.");
  const had = pending.get(gapId);
  const old = (had ? await readScene(had) : null) ?? await unusedScene(gapId, gap.state.distance);
  if (old && old.distance === gap.state.distance) { pending.set(gapId, old.id); return { gap: gapView(gap), scene: publicScene(old) }; }
  const scene = await makeScene(gap, opts);
  if (!scene) throw new Error("이 빈틈의 장면을 만들지 못했어요. 나중에 다시 해 볼게요.");
  pending.set(gapId, scene.id);
  return { gap: gapView(gap), scene: publicScene(scene) };
}

/** 미리 실행: 보이는 입력(기본)에서만 돌려 출력을 보여 준다. 채점은 안 함. */
export async function preview(sceneId: string, answer: string) {
  const s = await readScene(sceneId);
  if (!s || s.format === "choice" || s.format === "predict") throw new Error("실행할 수 없는 장면이에요.");
  const shown = s.format === "fix" ? s.inputs.filter((x) => x.role === "split").slice(0, 1) : shownInputs(s);
  const runs = await runAll(s.lang, programOf(s, answer), shown.map((x) => x.stdin));
  return { runs: runs.map((r, i) => ({ input: shown[i].stdin, ...(r.ok ? { out: r.out } : { error: r.error }) })) };
}

export async function answer(sceneId: string, input: { answer: string; hinted?: boolean; gaveUp?: boolean }) {
  const s = await readScene(sceneId);
  if (!s) throw new Error("장면을 찾을 수 없어요.");
  const gap0 = (await readGaps()).find((g) => g.id === s.gapId);
  if (!gap0) throw new Error("빈틈을 찾을 수 없어요.");
  const graded = await gradeScene(s, gap0, input.answer, { gaveUp: input.gaveUp });
  await addAttempt({ id: newId("at"), at: new Date().toISOString(), sceneId, gapId: s.gapId, distance: s.distance, format: s.format, answer: input.answer.slice(0, 4000), verdict: graded.verdict,
    hinted: Boolean(input.hinted), gaveUp: Boolean(input.gaveUp), ...(graded.outputs ? { outputs: graded.outputs.map((o) => o.slice(0, 300)) } : {}),
    ...(graded.matched ? { matched: graded.matched } : {}), ...(graded.firstDiff ? { firstDiff: { index: graded.firstDiff.index, expected: graded.firstDiff.expected.slice(0, 300), got: graded.firstDiff.got.slice(0, 300) } } : {}) });
  const gap = await changeGaps((gaps) => {
    const i = gaps.findIndex((g) => g.id === s.gapId);
    gaps[i] = reflect(gaps[i], graded.verdict, { hinted: input.hinted, gaveUp: input.gaveUp });
    return gaps[i];
  });
  pending.delete(s.gapId);
  const other = graded.matched && graded.matched !== "mine" && graded.matched !== "gave-up" ? s.wrongs.find((w) => w.id === graded.matched)?.what : undefined;
  return {
    verdict: graded.verdict, label: VERDICT_LABEL[graded.verdict], gaveUp: Boolean(input.gaveUp),
    // 무엇을 말해 줄지: 맞는 생각 한 문장 · 알맹이 · 그때 생각 · (미확정이면) 처음 갈린 입력
    explain: s.explain, kernel: gap.kernel.code, wrong: gap.wrong, other, firstDiff: graded.firstDiff, errors: graded.errors?.slice(0, 2),
    answerKey: s.format === "choice" ? s.choices?.findIndex((c) => c.thought === "right") : undefined,
    expected: s.format === "predict" ? s.computed?.expected[0] : undefined,
    reference: s.format === "fix" ? undefined : s.format === "blank" || s.format === "write" ? s.reference : undefined,
    origin: s.distance === "far" ? `이건 ${gap.origin.title}에서 막혔던 그 생각이었어요: ${gap.title}` : undefined,
    gap: gapView(gap), tutor: gap.state.streak.same >= 2,
  };
}
export async function history(gapId: string) { return (await readAttempts()).filter((a) => a.gapId === gapId); }
