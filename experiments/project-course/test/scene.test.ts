// 상황 재현 복습의 실습 쪽(11/15): 목표 정리 카드의 종류 · 확인할 것 · 알맹이 → 원장 → 앱으로 내보내기, 작은 재현 프로젝트(16) · 원래 자리로(17).
// 가짜 AI · 임시 데이터 폴더만 쓴다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
process.env.PC_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "pc-scene-"));
process.env.PC_FAKE_AI = "1";
const ai = await import("../lib/ai.ts");
const R = await import("../lib/goal-record.ts");
const G = await import("../lib/gaps.ts");
const SG = await import("../lib/scene-gaps.ts");
const SF = await import("../lib/scene-folders.ts");
const { SCENE_KINDS } = await import("../lib/scene-kinds.ts");
const { toMd } = await import("./old-record.ts");

test("종류 목록이 앱 바닥(src/lib/scene/types.ts)과 같다", async () => {
  const { GAP_KINDS } = await import("../../../src/lib/scene/types.ts");
  assert.deepEqual([...SCENE_KINDS], [...GAP_KINDS]);
});

const TAIL = `# 학습 총평\n총평 글이에요. 이 목표에서 탄약을 줄이는 코드를 여러 클라이언트가 동시에 부르는 상황을 다뤘어요. 잠금을 쓰기 줄에만 걸어서 값이 어긋났고, 튜터와 함께 읽기부터 쓰기까지 감쌌어요. 백오십 자를 넘기려고 한 줄 더 써요.

# 기록용
요약: 탄약 줄이기에 잠금을 걸어 봄
과정: 잠금을 쓰기에만 걸음 / 값이 어긋남 / 읽기부터 감쌈

## 카드: 경쟁 상태
- 어떻게: 틀렸다 고침
- 상황: 여러 클라이언트가 같은 탄약을 줄이다가
- 한 것: lock을 쓰기 줄에만 걸었음
- 인용:
- 알게 된 것: 읽기 → 빼기 → 쓰기를 한 잠금 안에
- 다음엔: 공유 값을 읽고 쓰면 → 읽기부터 쓰기까지 한 번에 잠근다
- 코드: S1 3-5
- 다시 확인: 두 요청이 동시에 오면 어떻게 되나요?
- 모범답: 둘 다 같은 값을 읽어 한 번이 사라져요
- 종류: 순서·동시성
- 확인할 것: 능력
- 주제: concurrency.lock-scope
- 알맹이: javascript
\`\`\`js
# 이 줄은 머리글이 아니에요
- 이 줄도 칸이 아니에요
await gate.run(async () => { const left = ammo; ammo = left - n; });
\`\`\`
- 가정: gate: 잠금, ammo: 공유 탄약

## 메모리
`;

test("목표 정리 카드의 종류 · 확인할 것 · 주제 · 알맹이(코드 블록 안의 # · - 줄은 칸이 아님)", () => {
  const p = R.parseRecordTail(TAIL);
  assert.equal(p.cards.length, 1);
  const c = p.cards[0];
  assert.equal(c.kind, "순서·동시성");
  assert.match(c.kernelCode ?? "", /^# 이 줄은 머리글이 아니에요\n- 이 줄도 칸이 아니에요\nawait gate\.run/);
  assert.equal(c.recheck?.q, "두 요청이 동시에 오면 어떻게 되나요?", "코드 블록 뒤 칸도 그대로 읽힘");
  const s = R.sceneSeed(c, "fire.js")!;
  assert.equal(s.kind, "순서 · 동시성", "띄어쓰기가 달라도 목록 이름으로");
  assert.equal(s.target, "ability"); assert.equal(s.topic, "concurrency.lock-scope"); assert.equal(s.kernel.lang, "javascript");
  assert.deepEqual(s.kernel.needs, ["gate: 잠금", "ammo: 공유 탄약"]);
  // 한 줄로 쓴 알맹이: 언어 칸이 코드
  assert.equal(R.sceneSeed({ kind: "문법", kernelLang: "`lock (gate) { hp -= d; }`" }, "Hp.cs")!.kernel.code, "lock (gate) { hp -= d; }");
  assert.equal(R.sceneSeed({ kind: "아무거나" }), undefined, "종류를 못 맞추면 재료 없음");
});

test("알맹이 검사: 자바스크립트는 돌려 보고, 문법이 틀리면 실패, C#은 괄호 모양", async () => {
  assert.equal((await SG.checkKernel({ lang: "javascript", code: "const a = [1, 2];\nconsole.log(a.length);" })).check, "ran");
  assert.equal((await SG.checkKernel({ lang: "javascript", code: "await gate.run(async () => { ammo -= 1; });" })).check, "syntax", "가정한 변수가 없으면 문법까지만");
  assert.equal((await SG.checkKernel({ lang: "javascript", code: "if (a { b }" })).check, "failed");
  const py = await SG.checkKernel({ lang: "python", code: "with gate:\n    left = ammo\n    ammo = left - n" });
  assert.ok(py.check === "syntax" || py.check === "shape");
  assert.equal((await SG.checkKernel({ lang: "python", code: "def f(:\n  pass" })).check, "failed");
  assert.equal((await SG.checkKernel({ lang: "csharp", code: "lock (gate) { hp -= dmg; }" })).check, "shape");
  assert.equal((await SG.checkKernel({ lang: "csharp", code: "lock (gate) { hp -= dmg; " })).check, "failed");
  assert.equal(SG.shapeProblem("var s = \"}\"; // }\n"), null, "글 · 주석 안의 괄호는 세지 않음");
});

test("목표 정리 → 원장 합치기 → 알맹이 검사 → 앱으로 내보내기(신호 · 그때 생각이 틀렸다는 증거)", async () => {
  const run = "scn01";
  await R.logSave(run, "fire.js", "let ammo = 30;\nasync function fire(n) {\n  const left = ammo;\n  await sleep(1);\n  await gate.run(async () => { ammo = left - n; });\n}\n");
  const opened = (await G.openGap(run, { goal: { id: "g1", title: "탄약 줄이기" }, unit: { id: "g1", title: "탄약 줄이기", done: "동시에 쏴도 탄약이 맞다" }, from: "판정", wrong: "쓰기에만 잠금" }))!;
  ai.setFakeAi((p) => (p === "goal-record" ? TAIL.replace("- 원장:", "").replace("- 코드: S1 3-5", `- 코드: S1 3-5\n- 원장: ${opened.id}`) : ""));
  const msgs = [{ role: "user", text: "lock을 여기 걸면 되죠?", at: "2001-01-01T00:00:01Z" }];
  const rec = await R.recordGoal(run, { title: "탄약 줄이기", done: "동시에 쏴도 탄약이 맞다", understood: true, applied: true, at: "2001-01-01T00:00:00Z" }, null, msgs, (m) => m.text,
    undefined, await R.savesOf(run));
  assert.ok(rec?.gaps?.[0].scene, "부족함에 상황 재현 재료가 붙음");
  assert.equal(rec!.gaps![0].code?.save, "S1");
  await G.mergeRecord(run, { id: "g1", title: "탄약 줄이기", done: "동시에 쏴도 탄약이 맞다" }, rec!.gaps as never, rec!.to);
  assert.equal(await SG.checkKernels(run, "g1"), 1);
  const g = (await G.ledgerOf(run)).find((x) => x.id === opened.id)!;
  assert.equal(g.scene?.kind, "순서 · 동시성"); assert.equal(g.scene?.kernel.check, "failed", "#으로 시작하는 줄은 자바스크립트 문법이 아님 → 실패로 적힘");
  assert.equal(g.code?.save, "S1");
  const { items } = await SG.sceneGaps();
  const it = items.find((x) => x.id === opened.id)!;
  assert.equal(it.kind, "순서 · 동시성"); assert.equal(it.wrongVerified, true, "판정이 틀림이라 한 칸 → 그때 생각이 틀렸다는 증거");
  assert.equal(it.signals.wrongTries, 1); assert.equal(it.lang, "javascript"); assert.equal(it.goal.done, "동시에 쏴도 탄약이 맞다");
  assert.match(it.wrongCode, /ammo = left - n/);
  const mat = await SG.sceneMaterial(run, opened.id);
  assert.match(mat.statement, /fire\.js 3~5줄/); assert.match(mat.statement, /\s5\| {3}await gate\.run/);
  assert.equal(mat.lang, "javascript");
});

/* ---------- 16 작은 재현 프로젝트 ---------- */
const SCORE = `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const board = { score: 0 };
export async function add(n) {
  const cur = board.score;
  await sleep(1);
  board.score = cur + n;
}
`;
const FIXED = `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const board = { score: 0 };
let tail = Promise.resolve();
export function add(n) {
  const job = tail.then(async () => { const cur = board.score; await sleep(1); board.score = cur + n; });
  tail = job.catch(() => {});
  return job;
}
`;
const MINE = `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const board = { score: 0 };
let tail = Promise.resolve();
export async function add(n) {
  const cur = board.score;
  await sleep(1);
  const job = tail.then(() => { board.score = cur + n; });
  tail = job; return job;
}
`;
const CHECK = `import { board, add } from "./score.mjs";
await Promise.all(Array.from({ length: 10 }, () => add(1)));
if (board.score === 10) { console.log("통과: 열 번 더하기"); process.exit(0); }
console.log("실패: 열 번 더하기 — " + board.score); process.exit(1);
`;
const projectReply = (over: Record<string, unknown> = {}) => ({ story: "점수판 서버가 여러 요청의 점수를 더해요.", ask: "검사가 통과하게 고쳐 보세요.", explain: "읽기부터 쓰기까지 한 번에.", run: "node check.mjs",
  files: [{ path: "score.mjs", text: SCORE }], fix: [{ path: "score.mjs", text: FIXED }], mine: [{ path: "score.mjs", text: MINE }], check: CHECK, ...over });

test("작은 재현 프로젝트: 받은 그대로는 늘 실패 · 모범 고침은 늘 통과를 코드가 확인 → 폴더 → 검사로 채점", async () => {
  // 문제가 없는 프로젝트(고친 것을 그대로 줌)는 떨어지고, 걸린 것을 붙여 한 번 더 묻는다
  const asked: string[] = [];
  ai.setFakeAi((p, user) => { asked.push(user); return asked.length === 1 ? projectReply({ files: [{ path: "score.mjs", text: FIXED }] }) : projectReply(); });
  const id = "sc_0000000000a1";
  const made = await SF.makeProject(id, { title: "경쟁 상태", kind: "순서 · 동시성", missed: "읽기부터 쓰기까지 한 잠금", wrong: "쓰기에만 잠금", lang: "javascript", topic: "concurrency.lock-scope" });
  assert.equal(made.ok, true, JSON.stringify(made));
  assert.equal(asked.length, 2); assert.match(asked[1], /받은 그대로인데 검사가 통과해요/);
  const dir = SF.sceneDir(id);
  assert.deepEqual((await readdir(dir)).sort(), ["check.mjs", "score.mjs", "과제.md"]);
  const meta = (await SF.metaOf(id))! as Awaited<ReturnType<typeof SF.metaOf>> & { fails: string[]; mineFails: string[] | null };
  assert.deepEqual(meta.fails, ["열 번 더하기"]); assert.deepEqual(meta.mineFails, ["열 번 더하기"]);
  assert.equal((await SF.gradeScene(id)).matched, "unchanged", "안 바꾸면 미확정");
  await writeFile(path.join(dir, "score.mjs"), MINE);
  assert.equal((await SF.gradeScene(id)).verdict, "same", "그때 생각대로 고치면 같은 실수");
  assert.equal((await SF.gradeScene(id, { wrongVerified: false })).verdict, "unclear", "그때 생각이 틀렸다는 증거가 없으면 같은 실수를 내지 않음");
  // 검사 파일을 고쳐도 원래 검사로 채점
  await writeFile(path.join(dir, "check.mjs"), "process.exit(0)");
  assert.equal((await SF.gradeScene(id)).verdict, "same");
  // Interlocked처럼 다른 맞는 방법(한 번에 더하기)도 통과
  await writeFile(path.join(dir, "score.mjs"), SCORE.replace("const cur = board.score;\n  await sleep(1);\n  board.score = cur + n;", "await sleep(1);\n  board.score += n;"));
  assert.equal((await SF.gradeScene(id)).verdict, "pass");
  assert.equal((await SF.tryScene(id)).ok, true);
  // 줄 수 · 경로 검사
  const bad = await SF.verifyProject({ ...projectReply(), files: [{ path: "../x.mjs", text: "" }] } as never, "javascript");
  assert.equal(bad.ok, false); assert.match(bad.problems.join(" "), /쓸 수 없는 파일 이름/);
});

/* ---------- 17 원래 자리로 ---------- */
test("원래 자리로: 그 시점 저장본을 새 폴더에 되살리고(원래 폴더는 그대로), 그 목표의 검사로 채점", async () => {
  const S = await import("../lib/store.ts");
  const ws = await mkdtemp(path.join(os.tmpdir(), "pc-ws-"));
  await writeFile(path.join(ws, "fire.js"), "// 지금(나중) 모습\nlet ammo = 30;\n");
  await writeFile(path.join(ws, "package.json"), "{\"name\":\"fps\"}");
  await mkdir(path.join(ws, "node_modules", "x"), { recursive: true }); await writeFile(path.join(ws, "node_modules", "x", "i.js"), "");
  const run = "scn02";
  await S.addRun({ id: run, courseId: "chat", createdAt: new Date().toISOString(), plan: { start: 1, stages: [1], quick: [], transfer: false, reasons: [], notes: [], minutes: 0 }, current: 1, workspaces: { chat: ws }, stages: {} });
  const then = "let ammo = 30;\nasync function fire(n) {\n  const left = ammo;\n  await sleep(1);\n  ammo = left - n;\n}\n";
  await R.logSave(run, "util.js", "export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));\n");
  await R.logSave(run, "fire.js", then);
  await R.logSave(run, "fire.js", "// 나중 저장본\n");
  await R.logSave(run, "later.js", "// 그 뒤에 처음 저장한 파일 — 그 시점에는 없었다\n");
  const g = (await G.openGap(run, { goal: { id: "g1", title: "탄약 줄이기" }, unit: { id: "g1", title: "탄약 줄이기", done: "동시에 쏴도 탄약이 맞다" }, from: "판정", wrong: "잠금 없이 읽고 씀" }))!;
  await G.mergeRecord(run, { id: "g1", title: "탄약 줄이기", done: "동시에 쏴도 탄약이 맞다" }, [{ type: "개념", concept: "경쟁 상태", wrong: "잠금 없이 읽고 씀", right: "한 잠금 안에", quote: "", ids: [g.id],
    code: { file: "fire.js", from: 3, to: 5, code: "  const left = ammo;\n  await sleep(1);\n  ammo = left - n;" } }], new Date().toISOString());
  const id = "sc_0000000000b2";
  const made = await SF.makeOrigin(id, { runId: run, gapId: g.id });
  assert.equal(made.ok, true, JSON.stringify(made));
  const dir = SF.sceneDir(id);
  assert.equal(await readFile(path.join(dir, "fire.js"), "utf8"), then, "저장본 번호가 없던 칸도 그 줄이 그대로 있는 저장본 시점으로");
  assert.match(await readFile(path.join(dir, "util.js"), "utf8"), /sleep/);
  assert.equal(await readFile(path.join(dir, "package.json"), "utf8"), "{\"name\":\"fps\"}", "저장한 적 없는 파일은 작업 폴더에서 복사");
  assert.ok(!(await readdir(dir)).includes("node_modules"));
  assert.ok(!(await readdir(dir)).includes("later.js"), "그 뒤에 저장한 파일은 되살리지 않음");
  assert.equal(await readFile(path.join(ws, "fire.js"), "utf8"), "// 지금(나중) 모습\nlet ammo = 30;\n", "원래 실습 폴더는 그대로");
  assert.equal((await SF.gradeScene(id)).matched, "unchanged");
  // 그 목표의 검사([해 봤어요] 판정)를 그대로: 가짜 판정이 받은 글을 본다
  let seen = "";
  ai.setFakeAi((p, user) => { seen = `${p}\n${user}`; return /gate\.run/.test(user) ? { verdict: "correct", right: "한 잠금 안", gap: "" } : { verdict: "incorrect", right: "", gap: "아직 어긋남" }; });
  await writeFile(path.join(dir, "fire.js"), then.replace("  const left = ammo;\n  await sleep(1);\n  ammo = left - n;", "  await gate.run(async () => { const left = ammo; await sleep(1); ammo = left - n; });"));
  assert.equal((await SF.gradeScene(id)).verdict, "pass");
  assert.match(seen, /^judge-apply/); assert.match(seen, /완료 조건: 동시에 쏴도 탄약이 맞다/);
  await writeFile(path.join(dir, "fire.js"), then + "\n// 주석만 더함\n");
  assert.equal((await SF.gradeScene(id)).verdict, "same", "그때 줄이 그대로 남고 판정이 틀림 → 같은 실수");
  await writeFile(path.join(dir, "fire.js"), "let ammo = 30;\n");
  assert.equal((await SF.gradeScene(id)).verdict, "unclear");
});
