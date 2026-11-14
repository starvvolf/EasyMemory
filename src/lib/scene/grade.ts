// 채점 (설계 6번): 판정 넷 — 통과 · 같은 실수(오답 모양 일치) · 다른 실수 · 원인 미확정. 코드 실행만, AI 없음.
import { isSyntaxShape, programOf, runAll, sameOut, shapeOf } from "./exec.ts";
import type { Gap, Scene, SceneVerdict } from "./types.ts";

export type Graded = { verdict: SceneVerdict; matched?: string; outputs?: string[]; errors?: string[]; firstDiff?: { index: number; stdin: string; expected: string; got: string } };

/** 출력 묶음이 어느 생각의 모양과 맞나: 기본 입력은 모두 맞고, 그 생각이 정답과 다른 입력에서는 모두 그 생각과 같아야 한다. */
function matches(got: string[], expected: string[], shape: string[]) {
  const split = expected.map((e, i) => shape[i] !== e ? i : -1).filter((i) => i >= 0);
  if (!split.length || split.some((i) => isSyntaxShape(shape[i]))) return false;
  const basicOk = expected.every((e, i) => split.includes(i) || got[i] === e);
  const splitOk = split.every((i) => got[i] === shape[i]);
  // 가르는 입력 하나로는 우연히 맞을 수 있다(설계 한계 2): 둘 이상일 때만.
  return basicOk && splitOk && split.length >= 2;
}

export async function gradeScene(scene: Scene, gap: Pick<Gap, "wrongVerified">, answer: string, opts: { gaveUp?: boolean } = {}): Promise<Graded> {
  if (opts.gaveUp) return { verdict: "unclear", matched: "gave-up" };
  const c = scene.computed;
  if (!c) throw new Error("검사하지 않은 장면이에요.");
  if (scene.format === "choice") {
    const pick = scene.choices?.[Number(answer)];
    if (!pick) return { verdict: "unclear" };
    if (pick.thought === "right") return { verdict: "pass" };
    if (pick.thought === "mine") return { verdict: "same", matched: "mine" };
    return scene.wrongs.some((w) => w.id === pick.thought) ? { verdict: "other", matched: pick.thought } : { verdict: "unclear" };
  }
  if (scene.format === "predict") {
    const got = answer.trim();
    if (sameOut(got, c.expected[0] ?? "")) return { verdict: "pass", outputs: [got] };
    for (const [id, shape] of Object.entries(c.shapes)) if (sameOut(got, shape[0] ?? "")) return { verdict: id === "mine" && gap.wrongVerified !== false ? "same" : "other", matched: id, outputs: [got] };
    return { verdict: "unclear", outputs: [got], firstDiff: { index: 0, stdin: scene.inputs[0]?.stdin ?? "", expected: c.expected[0] ?? "", got } };
  }
  const runs = await runAll(scene.lang, programOf(scene, answer), scene.inputs.map((x) => x.stdin));
  const got = runs.map(shapeOf);
  const errors = runs.flatMap((r, i) => (r.ok ? [] : [`입력 ${i + 1}: ${r.error.slice(0, 400)}`]));
  const diffAt = got.findIndex((g, i) => g !== c.expected[i]);
  const firstDiff = diffAt >= 0 ? { index: diffAt, stdin: scene.inputs[diffAt].stdin, expected: c.expected[diffAt], got: runs[diffAt].ok ? got[diffAt] : (runs[diffAt] as { error: string }).error } : undefined;
  if (diffAt < 0) return { verdict: "pass", outputs: got };
  // 오류도 모양: 그때 생각과 같은 예외(예: 숫자를 for에 넣어 TypeError)면 같은 실수. 그 밖의 오류는 원인 미확정.
  if (gap.wrongVerified !== false && c.shapes.mine && matches(got, c.expected, c.shapes.mine)) return { verdict: "same", matched: "mine", outputs: got, ...(errors.length ? { errors } : {}), firstDiff };
  for (const [id, shape] of Object.entries(c.shapes)) if (id !== "mine" && matches(got, c.expected, shape)) return { verdict: "other", matched: id, outputs: got, ...(errors.length ? { errors } : {}), firstDiff };
  return { verdict: "unclear", outputs: got, ...(errors.length ? { errors } : {}), firstDiff };
}
