// 장면 검사 (설계 5번): 장면이 진짜 그 생각을 확인하나. 정답 · 오답 모양은 AI가 쓴 값이 아니라 코드가 돌려서 만든다.
//   1 모범 답이 통과  2 다른 맞는 방법도 통과(능력)  3 그때 생각은 가르는 입력에서 틀림  4 틀린 생각끼리 · 정답과 구별됨
//   5 그때 생각은 문법이 맞는 코드(오류도 모양으로 비교, 예외 이름까지)  6 아무것도 안 쓰면 안 풀림
//   7 결과 맞히기 · 담기 그리기의 정답은 실제로 돌린 값, 고르기 · 오류 읽기는 보기 검사, 반례 만들기는 반례가 정말 있나 · 입력 검사기가 맞나
// 입력의 역할(기본 / 가르는)은 AI가 붙인 것을 믿지 않고 코드가 결과로 다시 정한다: 틀린 생각이 하나라도 다른 답을 내면 가르는 입력.
import { cleanError, isSyntaxShape, literalOk, programOf, runAll, sameLiteral, sameOut, shapeOf, shuffledPieces, strippedLines, structureOk, validInput, type RunOut } from "./exec.ts";
import { checkPracticeScene } from "./practice/index.ts";
import { PRACTICE_FORMATS, type Scene } from "./types.ts";

const outs = (r: RunOut[]) => r.map(shapeOf);
const done = (scene: Scene, problems: string[], extra: Partial<Scene> = {}): Scene => ({ ...scene, ...extra, check: { ok: !problems.length, problems } });

function checkChoices(scene: Scene, problems: string[]) {
  const ch = scene.choices ?? [];
  if (ch.length < 2 || ch.length > 5) problems.push("보기는 2~5개여야 해요.");
  if (ch.filter((c) => c.thought === "right").length !== 1) problems.push("맞는 보기가 정확히 하나여야 해요.");
  if (new Set(ch.map((c) => c.text.trim())).size !== ch.length) problems.push("같은 보기가 둘 있어요.");
  if (!ch.some((c) => c.thought === "mine")) problems.push("그때 생각(mine)에 해당하는 보기가 없어요.");
  const lens = ch.map((c) => c.text.length);
  if (lens.length && Math.max(...lens) > 3 * Math.max(8, Math.min(...lens))) problems.push("보기 길이가 너무 달라요(긴 보기가 답이라는 게 드러나요).");
}

export async function checkScene(scene: Scene): Promise<Scene> {
  if (PRACTICE_FORMATS.includes(scene.format)) return checkPracticeScene(scene);
  const problems: string[] = [];
  switch (scene.format) {
    case "choice": {
      checkChoices(scene, problems);
      return done(scene, problems, { computed: { expected: [], shapes: {} } });
    }
    case "error": {
      // 오류 문구는 실제로 돌려서 얻는다. 오류가 안 나면 오류 읽기 장면이 아니다.
      checkChoices(scene, problems);
      const stdin = scene.inputs[0]?.stdin ?? "";
      const [r] = await runAll(scene.lang, scene.reference, [stdin]);
      if (!r || r.ok) problems.push("보여 줄 코드가 오류 없이 끝나요(오류 읽기 장면이 아니에요).");
      const errorText = r && !r.ok ? cleanError(r.error) : "";
      return done(scene, problems, { errorText, computed: { expected: [], shapes: {} } });
    }
    case "counter": return checkCounter(scene, problems);
    case "draw": return checkDraw(scene, problems);
    case "order": {
      const ref = strippedLines(scene.reference);
      if (ref.length < 3 || ref.length > 10) problems.push("순서 맞추기 줄은 4~8줄쯤이어야 해요.");
      const same = (code: string) => strippedLines(code).slice().sort().join("\n") === ref.slice().sort().join("\n");
      const wrongs = scene.wrongs.filter((w) => same(w.code));
      if (!wrongs.some((w) => w.id === "mine")) problems.push("그때 생각(mine)이 같은 줄들의 다른 순서가 아니에요.");
      const pieces = shuffledPieces(scene.reference, scene.id);
      return checkRun({ ...scene, wrongs, pieces }, problems);
    }
    default: return checkRun(scene, problems);
  }
}

/** 실행해서 출력으로 가르는 형식: write · function · order · blank · fix · predict · variant */
async function checkRun(scene: Scene, problems: string[]): Promise<Scene> {
  const stdins = scene.inputs.map((x) => x.stdin);
  if (!stdins.length) problems.push("입력이 없어요.");
  // 기록에서 잘라 온 장면(고치기 · 한 줄 다시 쓰기)과 변형 문제는 원래 문제 테스트의 정답 출력을 그대로 쓴다(만들 때 넣어 둠).
  const preset = scene.origin && scene.computed?.expected.length === stdins.length ? scene.computed.expected : null;
  const ref = preset ? null : await runAll(scene.lang, programOf(scene, scene.reference), stdins);
  ref?.forEach((r, i) => { if (!r.ok) problems.push(`모범 답이 입력 ${i + 1}에서 돌지 않아요: ${r.error.slice(0, 200)}`); });
  const expected = preset ?? outs(ref!);
  const shapes: Record<string, string[]> = {};
  // 결과 맞히기의 틀린 생각은 전체 프로그램(그 생각대로 머릿속에서 계산한 것) · 변형 문제 · 고치기도 전체 프로그램
  const progOf = (code: string) => (scene.format === "predict" ? code : programOf(scene, code));
  for (const w of scene.wrongs) shapes[w.id] = outs(await runAll(scene.lang, progOf(w.code), stdins));
  // 1 · 2
  if (scene.target === "ability") for (const [k, alt] of scene.alsoRight.entries()) {
    const got = outs(await runAll(scene.lang, programOf(scene, alt), stdins));
    if (got.some((g, i) => g !== expected[i])) problems.push(`다른 맞는 방법 ${k + 1}이 통과하지 못해요(한 가지 표현만 강요하는 장면).`);
  }
  // 표현 확인: 모범 답은 그 표현을 쓴다
  if (scene.structure?.must.length) {
    if (!structureOk(scene.structure, scene.reference).ok) problems.push("모범 답이 표현 검사(정규식)를 통과하지 못해요.");
    for (const m of scene.structure.must) { try { new RegExp(m.pattern, "m"); } catch { problems.push(`표현 검사 정규식이 틀렸어요: ${m.pattern}`); } }
  }
  // 역할 다시 정하기
  const inputs = scene.inputs.map((x, i) => ({ ...x, role: scene.wrongs.some((w) => shapes[w.id][i] !== expected[i]) ? "split" as const : "basic" as const }));
  const mines = scene.wrongs.filter((w) => w.id === "mine" || w.id.startsWith("mine-"));
  if (scene.format !== "predict") {
    // 3 · 5
    if (!mines.length) problems.push("그때 생각(mine)이 없어요.");
    for (const mine of mines) {
      const splits = inputs.filter((_, i) => shapes[mine.id][i] !== expected[i]).length;
      const tag = mines.length > 1 ? `(${mine.id}) ` : "";
      if (!splits) problems.push(`${tag}그때 생각대로 해도 모든 입력에서 맞아요(이 장면으로는 그 빈틈을 확인할 수 없어요).`);
      // 같은 실수는 가르는 입력 둘 이상에서 오답 모양이 맞아야 판정한다(하나면 우연일 수 있음)
      else if (splits < 2) problems.push(`${tag}그때 생각이 틀리는 입력이 하나뿐이에요. 그때 생각대로 하면 다른 답이 나오는 입력을 하나 더 넣어요.`);
      // 그때 생각이 모든 입력에서 틀리는 빈틈(반복 횟수 · 출력 자리 등)은 기본 입력이 있을 수 없다 → 가르는 입력을 셋 이상으로 더 엄하게
      else if (splits === stdins.length && splits < 3) problems.push(`${tag}그때 생각이 모든 입력에서 틀려요. 그렇다면 가르는 입력이 셋 이상 있어야 해요.`);
      if (shapes[mine.id].some(isSyntaxShape)) problems.push(`${tag}그때 생각 코드가 문법부터 틀려요(어떤 생각인지 드러나지 않아요). 문법 빈틈은 고르기 · 결과 맞히기로 내요.`);
    }
    // 6
    const blankAnswer = scene.format === "fix" || scene.format === "variant" || scene.format === "blank" ? "" : scene.format === "function" || scene.format === "order" ? "" : "pass";
    const empty = outs(await runAll(scene.lang, programOf(scene, blankAnswer), stdins));
    if (empty.every((e, i) => e === expected[i])) problems.push("아무것도 안 써도 통과해요.");
    if (scene.format === "variant" && scene.validator) for (const [i, s] of stdins.entries()) { const v = await validInput(scene.validator, s); if (!v.ok) problems.push(`테스트 ${i + 1}이 입력 검사기를 통과하지 못해요: ${v.why}`); }
  } else {
    // 결과 맞히기: 그때 생각대로 계산한 값이 정답과 달라야 같은 실수를 가를 수 있다
    for (const mine of mines) if (shapes[mine.id].every((s, i) => s === expected[i])) problems.push("그때 생각대로 계산해도 정답과 같아요.");
    if (expected.some((e) => e.length > 400)) problems.push("맞힐 출력이 너무 길어요.");
    if (expected.some((e) => e.startsWith("\u0000"))) problems.push("보여 줄 코드가 오류로 끝나요(결과 맞히기는 출력이 있어야 해요).");
  }
  // 4: 틀린 생각 둘이 모든 입력에서 같으면 구별 못 함 → 뒤의 것을 뺀다(묶음으로만)
  const wrongs = scene.wrongs.filter((w, k) => !scene.wrongs.slice(0, k).some((v) => shapes[v.id].every((s, i) => s === shapes[w.id][i])));
  return done(scene, problems, { inputs, wrongs, computed: { expected, shapes: Object.fromEntries(wrongs.map((w) => [w.id, shapes[w.id]])) } });
}

/** 반례 만들기: 보여 주는 틀린 코드가 정말 틀리는 입력이 있나 · 입력 검사기가 예시 입력을 받아들이나 · 모범 답이 도나 */
async function checkCounter(scene: Scene, problems: string[]): Promise<Scene> {
  const mine = scene.wrongs.find((w) => w.id === "mine");
  if (!mine?.code.trim()) problems.push("보여 줄 틀린 코드(mine)가 없어요.");
  const stdins = scene.inputs.map((x) => x.stdin);
  if (stdins.length < 2) problems.push("예시 입력이 둘 이상 있어야 해요.");
  for (const [i, s] of stdins.entries()) { const v = await validInput(scene.validator, s); if (!v.ok) problems.push(`예시 입력 ${i + 1}이 입력 검사기를 통과하지 못해요: ${v.why}`); }
  const ref = await runAll(scene.lang, scene.reference, stdins);
  ref.forEach((r, i) => { if (!r.ok) problems.push(`모범 답이 입력 ${i + 1}에서 돌지 않아요: ${r.error.slice(0, 200)}`); });
  const expected = outs(ref);
  const shape = mine ? outs(await runAll(scene.lang, mine.code, stdins)) : [];
  if (shape.some(isSyntaxShape)) problems.push("보여 줄 틀린 코드가 문법부터 틀려요.");
  const splits = shape.filter((s, i) => s !== expected[i]).length;
  if (!splits) problems.push("보여 줄 코드가 예시 입력에서 모두 맞아요(반례가 있는지 확인되지 않아요).");
  // 입력 검사기가 아무 입력이나 받으면(빈 입력 · 엉뚱한 글) 반례 판정이 흔들린다
  if (scene.validator?.trim()) { const junk = await validInput(scene.validator, "hello world\n"); if (junk.ok) problems.push("입력 검사기가 엉뚱한 입력(hello world)도 받아들여요."); }
  else problems.push("입력 검사기(validator)가 없어요.");
  const inputs = scene.inputs.map((x, i) => ({ ...x, role: shape[i] !== expected[i] ? "split" as const : "basic" as const }));
  return done(scene, problems, { inputs, computed: { expected, shapes: { mine: shape } } });
}

/** 담기 그리기: 값(실제로 만든 값과 같아야) 또는 모양(판정 함수가 받아들이면) */
async function checkDraw(scene: Scene, problems: string[]): Promise<Scene> {
  const stdin = scene.inputs[0]?.stdin ?? "";
  const lit = async (code: string) => { const [r] = await runAll("python", code, [stdin]); return r?.ok ? r.out : null; };
  const expected = await lit(scene.reference);
  if (expected === null) problems.push("모범 답(값을 출력하는 프로그램)이 돌지 않아요.");
  const mine = scene.wrongs.find((w) => w.id === "mine");
  const mineLit = mine ? await lit(mine.code) : null;
  if (mineLit === null) problems.push("그때 생각의 값을 출력하는 프로그램이 돌지 않아요.");
  const mode = scene.draw?.mode ?? "value";
  if (expected !== null && mineLit !== null) {
    if (mode === "value") {
      const same = await sameLiteral(expected, mineLit);
      if (same === null) problems.push("출력이 파이썬 값(리터럴)으로 읽히지 않아요.");
      else if (same) problems.push("그때 생각대로 해도 같은 값이 나와요.");
    } else {
      const fn = scene.draw?.checker ?? ""; const mfn = scene.draw?.mineCheck ?? "";
      if (!/def ok\(/.test(fn) || !/def ok\(/.test(mfn)) problems.push("판정 함수(checker · mineCheck)가 def ok(v): 모양이 아니에요.");
      else {
        if (await literalOk(fn, expected) !== true) problems.push("판정 함수가 모범 답의 값을 받아들이지 않아요.");
        if (await literalOk(fn, mineLit) !== false) problems.push("판정 함수가 그때 생각의 값도 받아들여요.");
        if (await literalOk(mfn, mineLit) !== true) problems.push("그때 생각 판정 함수가 그때 생각의 값을 알아보지 못해요.");
        if (await literalOk(mfn, expected) !== false) problems.push("그때 생각 판정 함수가 맞는 값도 그때 생각으로 봐요.");
        for (const [k, alt] of scene.alsoRight.entries()) { const v = await lit(alt); if (v === null || await literalOk(fn, v) !== true) problems.push(`다른 맞는 모양 ${k + 1}을 판정 함수가 받아들이지 않아요.`); }
      }
    }
  }
  const shapes: Record<string, string[]> = {};
  for (const w of scene.wrongs) { const v = await lit(w.code); if (v !== null) shapes[w.id] = [v]; }
  return done(scene, problems, { computed: { expected: expected === null ? [] : [expected], shapes } });
}

export { sameOut };
