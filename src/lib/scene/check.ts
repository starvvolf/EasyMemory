// 장면 검사 (설계 5번): 장면이 진짜 그 생각을 확인하나. 정답 · 오답 모양은 AI가 쓴 값이 아니라 코드가 돌려서 만든다.
//   1 모범 답이 통과  2 다른 맞는 방법도 통과(능력)  3 그때 생각은 가르는 입력에서 틀림  4 틀린 생각끼리 · 정답과 구별됨
//   5 그때 생각은 문법이 맞는 코드(오류도 모양으로 비교, 예외 이름까지)  6 아무것도 안 쓰면 안 풀림
// 입력의 역할(기본 / 가르는)은 AI가 붙인 것을 믿지 않고 코드가 결과로 다시 정한다: 틀린 생각이 하나라도 다른 답을 내면 가르는 입력.
import { isSyntaxShape, programOf, runAll, sameOut, shapeOf, type RunOut } from "./exec.ts";
import type { Scene } from "./types.ts";

const outs = (r: RunOut[]) => r.map(shapeOf);

export async function checkScene(scene: Scene): Promise<Scene> {
  const problems: string[] = [];
  if (scene.format === "choice") {
    const ch = scene.choices ?? [];
    if (ch.length < 2 || ch.length > 5) problems.push("보기는 2~5개여야 해요.");
    if (ch.filter((c) => c.thought === "right").length !== 1) problems.push("맞는 보기가 정확히 하나여야 해요.");
    if (new Set(ch.map((c) => c.text.trim())).size !== ch.length) problems.push("같은 보기가 둘 있어요.");
    if (!ch.some((c) => c.thought === "mine")) problems.push("그때 생각(mine)에 해당하는 보기가 없어요.");
    return { ...scene, check: { ok: !problems.length, problems }, computed: { expected: [], shapes: {} } };
  }
  const stdins = scene.inputs.map((x) => x.stdin);
  if (!stdins.length) problems.push("입력이 없어요.");
  // 고치기(똑같이)는 원래 문제 테스트의 정답 출력을 그대로 쓴다(make.ts가 넣어 둠).
  const preset = scene.format === "fix" && scene.computed?.expected.length === stdins.length ? scene.computed.expected : null;
  const ref = preset ? null : await runAll(scene.lang, programOf(scene, scene.reference), stdins);
  ref?.forEach((r, i) => { if (!r.ok) problems.push(`모범 답이 입력 ${i + 1}에서 돌지 않아요: ${r.error.slice(0, 200)}`); });
  const expected = preset ?? outs(ref!);
  const shapes: Record<string, string[]> = {};
  // 결과 맞히기의 틀린 생각은 전체 프로그램(그 생각대로 머릿속에서 계산한 것)
  const progOf = (code: string) => (scene.format === "predict" ? code : programOf(scene, code));
  for (const w of scene.wrongs) shapes[w.id] = outs(await runAll(scene.lang, progOf(w.code), stdins));
  // 1 · 2
  if (scene.target === "ability") for (const [k, alt] of scene.alsoRight.entries()) {
    const got = outs(await runAll(scene.lang, programOf(scene, alt), stdins));
    if (got.some((g, i) => g !== expected[i])) problems.push(`다른 맞는 방법 ${k + 1}이 통과하지 못해요(한 가지 표현만 강요하는 장면).`);
  }
  // 역할 다시 정하기
  const inputs = scene.inputs.map((x, i) => ({ ...x, role: scene.wrongs.some((w) => shapes[w.id][i] !== expected[i]) ? "split" as const : "basic" as const }));
  const mine = scene.wrongs.find((w) => w.id === "mine");
  if (scene.format !== "predict") {
    // 3 · 5
    if (!mine) problems.push("그때 생각(mine)이 없어요.");
    else {
      const splits = inputs.filter((_, i) => shapes.mine[i] !== expected[i]).length;
      if (!splits) problems.push("그때 생각대로 해도 모든 입력에서 맞아요(이 장면으로는 그 빈틈을 확인할 수 없어요).");
      // 같은 실수는 가르는 입력 둘 이상에서 오답 모양이 맞아야 판정한다(하나면 우연일 수 있음)
      else if (splits < 2) problems.push("그때 생각이 틀리는 입력이 하나뿐이에요. 그때 생각대로 하면 다른 답이 나오는 입력을 하나 더 넣어요.");
      // 그때 생각이 모든 입력에서 틀리는 빈틈(반복 횟수 · 출력 자리 등)은 기본 입력이 있을 수 없다 → 가르는 입력을 셋 이상으로 더 엄하게
      else if (splits === stdins.length && splits < 3) problems.push("그때 생각이 모든 입력에서 틀려요. 그렇다면 가르는 입력이 셋 이상 있어야 해요.");
      if (shapes.mine.some(isSyntaxShape)) problems.push("그때 생각 코드가 문법부터 틀려요(어떤 생각인지 드러나지 않아요). 문법 빈틈은 고르기 · 결과 맞히기로 내요.");
    }
    // 6
    const empty = outs(await runAll(scene.lang, programOf(scene, scene.format === "fix" ? "" : scene.format === "blank" ? "" : "pass"), stdins));
    if (empty.every((e, i) => e === expected[i])) problems.push("아무것도 안 써도 통과해요.");
  } else {
    // 결과 맞히기: 그때 생각대로 계산한 값이 정답과 달라야 같은 실수를 가를 수 있다
    if (mine && shapes.mine.every((s, i) => s === expected[i])) problems.push("그때 생각대로 계산해도 정답과 같아요.");
    if (expected.some((e) => e.length > 400)) problems.push("맞힐 출력이 너무 길어요.");
  }
  // 4: 틀린 생각 둘이 모든 입력에서 같으면 구별 못 함 → 뒤의 것을 뺀다(묶음으로만)
  const wrongs = scene.wrongs.filter((w, k) => !scene.wrongs.slice(0, k).some((v) => shapes[v.id].every((s, i) => s === shapes[w.id][i])));
  const ok = !problems.length;
  return { ...scene, inputs, wrongs, check: { ok, problems }, computed: { expected, shapes: Object.fromEntries(wrongs.map((w) => [w.id, shapes[w.id]])) } };
}
export { sameOut };
