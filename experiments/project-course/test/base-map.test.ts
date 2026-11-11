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

test("현재 목표의 선행(11/11): 비면 맥락이 set_prereqs를 시키고, 적으면 지도 결과를 옮기고, 학습자가 알아요 · 몰라요로 표시 · 지움", async () => {
  const run = "rp";
  await GO.runGoalTool(run, "propose_plan", { long: "REST API 요청 · 응답 이해", spec: "", mode: "topdown", map: ["요청 · 응답", "HTTP 메서드", "작은 API"],
    first: { title: "요청 · 응답 이해하기", done: "주소를 치면 무슨 일이 일어나는지 말한다", prereqs: [] },
    base: [{ name: "URL", kind: "개념", needs: [], for: ["작은 API"], check: "?" }] }, []);
  await GO.goalAction(run, "confirm", {});
  assert.match(await GO.goalContext(run), /\[선행 비어 있음\]/);
  await GO.setBaseSelf(run, "URL", "됨");
  await GO.runGoalTool(run, "set_prereqs", { prereqs: [{ name: "클라이언트와 서버", check: "브라우저와 서버는 각각 무슨 일을 하나요?" }, { name: "URL", check: "주소의 각 부분은?" }] }, []);
  let g = await GO.goalsOf(run);
  assert.deepEqual(g.current!.prereqs!.map((p) => [p.name, p.result ?? null, p.by ?? null]), [["클라이언트와 서버", null, null], ["URL", "됨", "학습자"]]);
  assert.doesNotMatch(await GO.goalContext(run), /\[선행 비어 있음\]/);
  const r = await GO.setBaseSelf(run, "클라이언트와 서버", "비어 있음");
  assert.equal(r.prereqs[0].result, "비어 있음"); assert.equal(r.prereqs[0].by, "학습자");
  assert.match(await GO.goalContext(run), /클라이언트와 서버\(몰라요·스스로 표시\)/);
  await GO.setBaseSelf(run, "클라이언트와 서버", null);
  g = await GO.goalsOf(run);
  assert.equal(g.current!.prereqs![0].result, undefined);
});

test("[다음으로] 뒤(11/11 실제로 꼬인 것): 선행 적기가 끼어도 새 목표를 정할 수 있고, 기다리는 중엔 set_prereqs를 막고 [선행 비어 있음]도 안 띄운다", async () => {
  const run = "rn";
  await GO.runGoalTool(run, "propose_plan", { long: "REST API", spec: "", mode: "topdown", map: ["요청 · 응답", "HTTP 메서드"], first: { title: "요청 · 응답", done: "말한다", prereqs: [] } }, []);
  await GO.goalAction(run, "confirm", {});
  await GO.goalAction(run, "next", {});
  assert.doesNotMatch(await GO.goalContext(run), /\[선행 비어 있음\]/);
  await assert.rejects(GO.runGoalTool(run, "set_prereqs", { prereqs: [{ name: "a", check: "?" }, { name: "b", check: "?" }] }, []), /set_current_goal/);
  // 예전 기록처럼 선행 적기가 끼어 있어도
  const g0 = await GO.goalsOf(run); g0.log.push({ at: new Date().toISOString(), kind: "prereqs", text: "a, b" } as never);
  await (await import("../lib/store.ts")).writeAtomic(path.join(process.env.PC_DATA_DIR!, "goals", `${run}.json`), JSON.stringify(g0));
  await GO.runGoalTool(run, "set_current_goal", { title: "GET과 주소", done: "GET /weather/seoul의 뜻을 말한다", prereqs: [{ name: "URL", check: "?" }, { name: "요청과 응답", check: "?" }] }, []);
  const g = await GO.goalsOf(run);
  assert.equal(g.current!.title, "GET과 주소");
  assert.equal(g.current!.prereqs!.length, 2);
});

test("도움 다이얼 · 받아 쓴 것(11/11): 다이얼은 AI 없이 바뀌어 맥락에 붙고, 선행 덩어리에서 받아 쓴 이름이 3개 쌓이면 정리를 한 번만 제안", async () => {
  const run = "rh";
  await GO.runGoalTool(run, "propose_plan", { long: "React 할 일 앱", spec: "", mode: "topdown", map: ["화면 띄우기", "목록"],
    first: { title: "화면 띄우기", done: "브라우저에 제목이 보인다", prereqs: [{ name: "JavaScript 기본", check: "함수와 배열을 써 봤나요?" }, { name: "Node와 npm", check: "npm install을 해 봤나요?" }] } }, []);
  await GO.goalAction(run, "confirm", {});
  assert.match(await GO.goalContext(run), /\[도움 정도: 같이\]/);
  assert.match(await GO.goalContext(run), /\[선행 — 미리 묻지 않는다\]/);
  const r = await GO.goalAction(run, "help", { help: "fast" });
  assert.equal(r, null); // 튜터를 부르지 않는다
  assert.match(await GO.goalContext(run), /\[도움 정도: 빨리 만들기\]/);
  await GO.runGoalTool(run, "new_names", { names: [{ name: "const", what: "값에 이름 붙이기", example: "const a = 1", from: "JavaScript 기본" }, { name: "=>", what: "짧은 함수", example: "(x) => x + 1", from: "javascript  기본" }] }, []);
  assert.doesNotMatch(await GO.goalContext(run), /\[자꾸 걸림\]/);
  await GO.runGoalTool(run, "new_names", { names: [{ name: "map", what: "배열을 바꿔 새 배열로", example: "xs.map(f)", from: "JavaScript 기본" }, { name: "useState", what: "화면이 기억할 값", example: "useState(0)" }] }, []);
  const g = await GO.goalsOf(run);
  assert.deepEqual(g.current!.prereqs![0].debts, ["const", "=>", "map"]);
  assert.match(await GO.goalContext(run), /\[자꾸 걸림\] "JavaScript 기본"에서 받아 쓴 것이 3개/);
  assert.doesNotMatch(await GO.goalContext(run), /\[자꾸 걸림\]/); // 한 번만
  assert.deepEqual(GO.prereqBrief(await GO.goalsOf(run))[0].debts, ["const", "=>", "map"]);
});
