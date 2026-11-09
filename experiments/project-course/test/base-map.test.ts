import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.PC_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "base-"));
process.env.PC_FAKE_AI = "1";
process.env.PROJECT_APP_URL = "http://127.0.0.1:9";
const GO = await import("../lib/goals.ts");
const L = await import("../lib/learner-note.ts");

test("먼저 알 것 지도(11/10): 이름 겹침 · 없는 이름 · 자기 자신 · 순환을 빼고 기대는 순서로", () => {
  const b = GO.cleanBase([
    { name: "React 상태", kind: "개념", needs: ["객체 참조", "JS 함수", "없는 것", "React 상태"], for: ["카운터"], check: "?" },
    { name: "객체 참조", kind: "개념", needs: ["값 복사", "React 상태"], for: [], check: "?" },
    { name: "값 복사", kind: "개념", needs: [], for: [], check: "?" },
    { name: "JS  함수", kind: "개념", needs: [], for: [], check: "?" },
    { name: "js 함수", kind: "개념", needs: [], for: [], check: "중복" },
    { name: "Node", kind: "도구", needs: [], for: ["카운터"], check: "node -v" },
  ], ["카운터"]);
  assert.deepEqual(b.map((x) => x.name), ["값 복사", "객체 참조", "JS  함수", "React 상태", "Node"]);
  assert.deepEqual(b.find((x) => x.name === "React 상태")!.needs, ["객체 참조", "JS  함수"]);
  assert.deepEqual(b.find((x) => x.name === "객체 참조")!.needs, ["값 복사"]); // 순환(React 상태) 끊음
  GO.markBase(b, ["값 복사"], [{ tool: "node", fact: "node 없음" }]);
  assert.equal(b[0].result, "됨"); assert.equal(b[0].by, "노트");
  assert.equal(b.at(-1)!.result, "비어 있음"); assert.equal(b.at(-1)!.by, "명령");
});

test("먼저 알 것 지도(11/10): 확정 때 노트 · 환경으로 채움 → 지금 단계 것만 맥락에 → 확인 · 판정이 지도에 적힘", async () => {
  const run = "rb";
  await L.noteEnv("python --version", 0, "Python 3.12.1");
  await GO.runGoalTool(run, "propose_plan", { long: "단어 빈도 프로그램", spec: "", mode: "bottomup", map: ["글 나누기", "세기", "정렬해 보여 주기"],
    first: { title: "글을 단어로 나누기", done: "단어 목록을 출력", prereqs: [] },
    base: [{ name: "Python", kind: "도구", needs: [], for: [], check: "python --version" }, { name: "반복문", kind: "개념", needs: ["리스트"], for: ["글 나누기", "세기"], check: "?" },
      { name: "리스트", kind: "개념", needs: [], for: ["글 나누기"], check: "?" }, { name: "딕셔너리", kind: "개념", needs: [], for: ["세기"], check: "?" }, { name: "함수를 값으로 넘기기", kind: "개념", needs: [], for: ["정렬해 보여 주기"], check: "?" }] }, []);
  await GO.goalAction(run, "confirm", {});
  let g = await GO.goalsOf(run);
  assert.equal(g.base!.find((b) => b.name === "Python")!.result, "됨");
  assert.deepEqual(GO.baseFor(g).map((b) => b.name), ["Python", "리스트", "반복문"]);
  const ctx = await GO.goalContext(run);
  assert.match(ctx, /먼저 알 것 지도\(기대는 순서.*반복문\(확인 전\) ← 리스트/);
  assert.match(ctx, /지금 단계에 쓰이는 먼저 알 것: Python\(됨\) · 리스트\(확인 전\) · 반복문\(확인 전\)/);
  assert.doesNotMatch(ctx.split("지금 단계에 쓰이는")[1] ?? "", /딕셔너리\(/);
  await GO.runGoalTool(run, "check_prereq", { name: "리스트", result: "비어 있음", quote: "리스트가 뭐예요" }, ["리스트가 뭐예요"]);
  await GO.setBaseResult(run, "반복문", "비어 있음", "for를 몰라요");
  g = await GO.goalsOf(run);
  assert.deepEqual(g.base!.filter((b) => b.result === "비어 있음").map((b) => b.name), ["리스트", "반복문"]);
  assert.match(await GO.goalContext(run), /\[깊이\]/);
  await GO.setBaseResult(run, "리스트", "됨");
  await GO.setBaseResult(run, "문자열 메서드", "비어 있음"); // 지도에 없던 것은 끝에 더함
  g = await GO.goalsOf(run);
  assert.equal(g.base!.find((b) => b.name === "리스트")!.result, "됨");
  assert.equal(g.base!.at(-1)!.name, "문자열 메서드");
});
