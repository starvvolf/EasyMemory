// 채점 (설계 6번): 판정 넷 — 통과 · 같은 실수(오답 모양 일치) · 다른 실수 · 원인 미확정. 코드 실행만, AI 없음(왜인지 한 줄만 AI, why.ts).
import { cleanError, isSyntaxShape, literalOk, programOf, runAll, sameLiteral, sameOut, shapeOf, structureOk, validInput } from "./exec.ts";
import { gradePracticeScene } from "./practice/index.ts";
import { PRACTICE_FORMATS, type Gap, type Scene, type SceneVerdict } from "./types.ts";

export type Graded = { verdict: SceneVerdict; matched?: string; outputs?: string[]; errors?: string[]; firstDiff?: { index: number; stdin: string; expected: string; got: string };
  /** 학습자에게 보여 줄 한 줄(왜 이 판정인가) */ note?: string;
  /** 반례 만들기 · 담기 그리기: 입력 · 값이 읽히지 않음 — 기록하지 않고 다시 내게 한다 */ invalid?: string;
  /** 섞은 장면: 같은 실수가 난 빈틈 */ gapId?: string };

/** 출력 묶음이 어느 생각의 모양과 맞나: 기본 입력은 모두 맞고, 그 생각이 정답과 다른 입력에서는 모두 그 생각과 같아야 한다. */
function matches(got: string[], expected: string[], shape: string[]) {
  const split = expected.map((e, i) => shape[i] !== e ? i : -1).filter((i) => i >= 0);
  if (!split.length || split.some((i) => isSyntaxShape(shape[i]))) return false;
  const basicOk = expected.every((e, i) => split.includes(i) || got[i] === e);
  const splitOk = split.every((i) => got[i] === shape[i]);
  // 가르는 입력 하나로는 우연히 맞을 수 있다(설계 한계 2): 둘 이상일 때만.
  return basicOk && splitOk && split.length >= 2;
}
const isMine = (id: string) => id === "mine" || id.startsWith("mine-");

export async function gradeScene(scene: Scene, gap: Pick<Gap, "wrongVerified">, answer: string, opts: { gaveUp?: boolean } = {}): Promise<Graded> {
  if (opts.gaveUp) return { verdict: "unclear", matched: "gave-up" };
  if (PRACTICE_FORMATS.includes(scene.format)) return gradePracticeScene(scene, gap, answer);
  const c = scene.computed;
  if (!c) throw new Error("검사하지 않은 장면이에요.");
  const sameOk = gap.wrongVerified !== false;
  switch (scene.format) {
    case "choice": case "error": {
      const pick = scene.choices?.[Number(answer)];
      if (!pick) return { verdict: "unclear" };
      if (pick.thought === "right") return { verdict: "pass" };
      // 그때 생각이 정말 틀렸다는 확인이 없는 빈틈(아예 못 떠올림)은 같은 실수를 내지 않는다: 통과 / 미확정만(설계 1번)
      if (pick.thought === "mine") return sameOk ? { verdict: "same", matched: "mine" } : { verdict: "unclear", matched: "mine" };
      return scene.wrongs.some((w) => w.id === pick.thought) ? { verdict: "other", matched: pick.thought } : { verdict: "unclear" };
    }
    case "predict": {
      const got = answer.trim();
      if (sameOut(got, c.expected[0] ?? "")) return { verdict: "pass", outputs: [got] };
      for (const [id, shape] of Object.entries(c.shapes)) if (sameOut(got, shape[0] ?? "")) return { verdict: isMine(id) ? (sameOk ? "same" : "unclear") : "other", matched: id, outputs: [got] };
      return { verdict: "unclear", outputs: [got], firstDiff: { index: 0, stdin: scene.inputs[0]?.stdin ?? "", expected: c.expected[0] ?? "", got } };
    }
    case "counter": return gradeCounter(scene, answer);
    case "draw": return gradeDraw(scene, sameOk, answer);
    default: return gradeRun(scene, sameOk, answer);
  }
}

async function gradeRun(scene: Scene, sameOk: boolean, answer: string): Promise<Graded> {
  const c = scene.computed!;
  const runs = await runAll(scene.lang, programOf(scene, answer), scene.inputs.map((x) => x.stdin));
  const got = runs.map(shapeOf);
  const errors = runs.flatMap((r, i) => (r.ok ? [] : [`입력 ${i + 1}: ${cleanError(r.error).slice(0, 400)}`]));
  const diffAt = got.findIndex((g, i) => g !== c.expected[i]);
  const firstDiff = diffAt >= 0 ? { index: diffAt, stdin: scene.inputs[diffAt].stdin, expected: c.expected[diffAt], got: runs[diffAt].ok ? got[diffAt] : cleanError((runs[diffAt] as { error: string }).error) } : undefined;
  const err = errors.length ? { errors } : {};
  if (diffAt < 0) {
    // 표현 확인: 출력은 맞았지만 그 표현을 쓰지 않음 → 이번엔 그 표현을 확인하는 장면이라 통과로 치지 않는다
    const st = structureOk(scene.structure, answer);
    if (!st.ok) return { verdict: "unclear", matched: "structure", outputs: got, note: `답은 맞아요. 이번에는 ${scene.structure!.must.map((m) => m.why).join(" · ")}을(를) 써서 해 보세요.` };
    return { verdict: "pass", outputs: got };
  }
  // 오류도 모양: 그때 생각과 같은 예외(예: 숫자를 for에 넣어 TypeError)면 같은 실수. 그 밖의 오류는 원인 미확정.
  for (const w of scene.wrongs.filter((x) => isMine(x.id))) {
    const shape = c.shapes[w.id];
    if (shape && matches(got, c.expected, shape)) return { verdict: sameOk ? "same" : "unclear", matched: w.id, outputs: got, ...err, firstDiff, ...(w.gapId ? { gapId: w.gapId } : {}) };
  }
  for (const [id, shape] of Object.entries(c.shapes)) if (!isMine(id) && matches(got, c.expected, shape)) return { verdict: "other", matched: id, outputs: got, ...err, firstDiff };
  return { verdict: "unclear", outputs: got, ...err, firstDiff };
}

/** 반례 만들기: 학습자가 쓴 입력에서 틀린 코드와 모범 코드의 출력이 다르면 통과 */
async function gradeCounter(scene: Scene, stdin: string): Promise<Graded> {
  const v = await validInput(scene.validator, stdin);
  if (!v.ok) return { verdict: "unclear", invalid: `문제 조건에 맞지 않는 입력이에요: ${v.why}` };
  const mine = scene.wrongs.find((w) => w.id === "mine")!;
  const [ref] = await runAll(scene.lang, scene.reference, [stdin]);
  if (!ref.ok) return { verdict: "unclear", invalid: "이 입력은 문제 조건에 맞지 않는 것 같아요(맞는 풀이도 돌지 않아요)." };
  const [wr] = await runAll(scene.lang, mine.code, [stdin]);
  const a = shapeOf(ref); const b = shapeOf(wr);
  if (a !== b) return { verdict: "pass", outputs: [b], firstDiff: { index: 0, stdin, expected: a, got: wr.ok ? b : cleanError(wr.error) } };
  // 반례를 못 찾음: 그 코드가 맞다고 믿어서인지, 그냥 못 찾아서인지는 모른다 → 원인 미확정
  return { verdict: "unclear", outputs: [b], note: "이 입력에서는 두 코드가 같은 답을 내요. 그 코드가 틀리는 경우를 다시 찾아보세요.", firstDiff: { index: 0, stdin, expected: a, got: b } };
}

/** 담기 그리기 */
async function gradeDraw(scene: Scene, sameOk: boolean, literal: string): Promise<Graded> {
  const c = scene.computed!;
  if (scene.draw?.mode === "shape") {
    const ok = await literalOk(scene.draw.checker ?? "", literal);
    if (ok === null) return { verdict: "unclear", invalid: "파이썬 값으로 읽히지 않아요. 예: [[2, 3], [1], [1]] 또는 [(1, 2), (1, 3)]" };
    if (ok) return { verdict: "pass", outputs: [literal] };
    if (await literalOk(scene.draw.mineCheck ?? "", literal)) return { verdict: sameOk ? "same" : "unclear", matched: "mine", outputs: [literal] };
    return { verdict: "unclear", outputs: [literal], firstDiff: { index: 0, stdin: scene.inputs[0]?.stdin ?? "", expected: c.expected[0] ?? "", got: literal } };
  }
  const same = await sameLiteral(literal, c.expected[0] ?? "");
  if (same === null) return { verdict: "unclear", invalid: "파이썬 값으로 읽히지 않아요. 예: [[], [2, 3], [1]]" };
  if (same) return { verdict: "pass", outputs: [literal] };
  for (const [id, shape] of Object.entries(c.shapes)) if (await sameLiteral(literal, shape[0] ?? "")) return { verdict: isMine(id) ? (sameOk ? "same" : "unclear") : "other", matched: id, outputs: [literal] };
  return { verdict: "unclear", outputs: [literal], firstDiff: { index: 0, stdin: scene.inputs[0]?.stdin ?? "", expected: c.expected[0] ?? "", got: literal } };
}
