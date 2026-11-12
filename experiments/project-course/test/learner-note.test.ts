import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.PC_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "lnote-"));
process.env.PC_FAKE_AI = "1";
process.env.PROJECT_APP_URL = "http://127.0.0.1:9"; // 앱 없음 → 이 컴퓨터 것만
const G = await import("../lib/gaps.ts");
const GO = await import("../lib/goals.ts");
const L = await import("../lib/learner-note.ts");

test("목표 정리 카드(11/10): 도움 받고 됨 · 틀렸다 고침은 세션에서 채움, 아직 모름은 열림 — 모두 다시 확인 날짜", async () => {
  const goal = { id: "gC", title: "단어 세기", done: "d" };
  await G.mergeRecord("r3", goal, [
    { type: "개념", concept: "딕셔너리 기본값", wrong: "없는 키에 +=", right: "get(w, 0)", quote: "", card: { situation: "세다가", next: "없을 수 있는 키는 get으로", how: "도움 받고 됨" } },
    { type: "개념", concept: "정렬 key", wrong: "sorted에 key를 못 씀", right: "key=lambda", quote: "", card: { situation: "", next: "", how: "아직 모름" } },
  ], "2026-11-10T00:00:00.000Z");
  const l = await G.ledgerOf("r3");
  assert.deepEqual(l.map((x) => [x.concept, x.status, !!x.dueAt]), [["딕셔너리 기본값", "세션에서 채움", true], ["정렬 key", "열림", true]]);
  assert.equal(l[0].card!.next, "없을 수 있는 키는 get으로");
});

test("나의 학습 노트(11/10): 실습들의 원장을 이름별로 묶고 가장 최근 상태 · 여러 곳 · 다른 컴퓨터와 합치기 · 환경", async () => {
  const n = await L.learnerNote();
  const names = n.unknown.map((i) => [i.name, i.status]);
  assert.ok(names.some(([a, b]) => a === "딕셔너리 기본값" && b === "채움, 다시 확인 전"));
  assert.ok(names.some(([a, b]) => a === "정렬 key" && b === "아직 모름"));
  // 다른 컴퓨터에서 같은 이름이 더 최근에 다시 확인 맞음 → 이제 됨, 두 곳
  const local = await L.localNote();
  const other = { machine: "laptop", at: "", env: [{ tool: "docker", fact: "docker 없음", at: "2026-11-09T00:00:00Z" }], items: [{ ...local.items.find((i) => i.name === "딕셔너리 기본값")!, status: "이제 됨" as const, at: "2099-01-01T00:00:00Z", places: ["노트북 실습 › 단어 세기2"] }] };
  const c = L.combine([local, other]);
  const d = c.known.find((i) => i.name === "딕셔너리 기본값")!;
  assert.equal(d.places.length, 2); assert.ok(!c.unknown.some((i) => i.name === "딕셔너리 기본값"));
  assert.deepEqual(c.env.map((e) => e.fact), ["docker 없음"]);
  // 환경: 명령 결과에서 코드가
  assert.equal(L.envFact("docker --version", 1, "'docker' is not recognized as an internal or external command,")!.fact, "docker 없음");
  assert.equal(L.envFact("node -v", 0, "v22.13.0\n")!.fact, "node 22.13.0");
  assert.equal(L.envFact("python a.py", 1, "Traceback"), null);
  await L.noteEnv("python --version", 0, "Python 3.12.1");
  assert.match(await L.noteText(), /확인된 환경: python 3\.12\.1/);
  assert.match(await L.noteText(), /- 정렬 key — 아직 모름/);
});
