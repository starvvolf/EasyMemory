import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.PC_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "mom-"));
process.env.PC_FAKE_AI = "1";
process.env.PROJECT_APP_URL = "http://127.0.0.1:9";
const M = await import("../lib/moments.ts");
const GR = await import("../lib/goal-record.ts");

test("막힌 순간(11/11): 오류로 열리고 → 말 · 도움이 쌓이고 → 같은 명령이 성공하면 닫힌다. 어떻게 풀렸나 · 바뀐 줄은 기록에서", async () => {
  const run = "m1";
  assert.equal(M.errorLine("Traceback (most recent call last):\n  File \"a.py\", line 1\nModuleNotFoundError: No module named 'requests'\n"), "ModuleNotFoundError: No module named 'requests'");
  await GR.logSave(run, "api.py", "import requests\nprint(requests.get(url))\n");
  await M.onCommand(run, "python api.py", 0, "ok"); // 성공은 안 연다
  assert.equal((await M.momentsOf(run)).length, 0);
  await M.onCommand(run, "python api.py", 1, "Traceback (most recent call last):\nNameError: name 'url' is not defined");
  await M.onCommand(run, "python  api.py", 1, "NameError: name 'url' is not defined"); // 또 실패: 같은 장면
  await M.onStep(run, { trigger: { kind: "message", text: "왜 안 돼?" }, reply: "url이라는 이름을 어디서 만들었는지 볼까요?", tools: [] });
  let ms = await M.momentsOf(run);
  assert.equal(ms.length, 1); assert.equal(ms[0].tries, 2); assert.deepEqual(ms[0].said, ["왜 안 돼?"]); assert.equal(ms[0].help.replies, 1);
  await M.onCommand(run, "pip list", 0, ""); // 다른 명령의 성공은 안 닫는다
  assert.equal((await M.momentsOf(run))[0].closedAt, undefined);
  await new Promise((r) => setTimeout(r, 5));
  await GR.logSave(run, "api.py", "import requests\nurl = \"http://localhost:8000\"\nprint(requests.get(url))\n");
  await M.onCommand(run, "python api.py", 0, "<Response [200]>");
  ms = await M.momentsOf(run);
  assert.equal(ms[0].how, "힌트 받고 풂"); assert.ok(ms[0].closedAt);
  const v = await M.momentsView(run);
  assert.deepEqual(v.moments[0].changed, [{ file: "api.py", diff: ["+ url = \"http://localhost:8000\""] }]);
});

test("막힌 순간: 판정 틀림 → 튜터가 고쳐 줌 / 어려워요 → 넘어감", async () => {
  const run = "m2";
  await M.onVerdict(run, "incorrect", "상태 코드를 안 봤다");
  await M.onStep(run, { trigger: { kind: "message", text: "그냥 고쳐 줘" }, reply: "고쳤어요.\n```python\nprint(r.status_code)\n```", tools: ["patch", "파일을 고쳤어요: api.py"] });
  await M.onVerdict(run, "correct", "");
  await M.onHard(run, "용어가 어려워요");
  await M.onLeave(run);
  const ms = await M.momentsOf(run);
  assert.deepEqual(ms.map((m) => [m.by, m.how]), [["판정", "튜터가 고쳐 줌"], ["어려워요", "안 풀고 넘어감"]]);
  assert.deepEqual(ms[0].help.edits, ["api.py"]);
});

test("오류 줄(11/12): 터미널 프롬프트는 건너뛰고, Gradle은 What went wrong 다음 줄", () => {
  assert.equal(M.errorLine("> Task :bootRun FAILED\n\nFAILURE: Build failed with an exception.\n\n* What went wrong:\nExecution failed for task ':bootRun'.\n> Process 'command 'java'' finished with non-zero exit value 1\n\nBUILD FAILED in 6s\n(base) PS C:\\work\\pay> "), "Execution failed for task ':bootRun'.");
  assert.equal(M.errorLine("Caused by: java.net.BindException: Address already in use\nPS C:\\work> "), "Caused by: java.net.BindException: Address already in use");
  assert.equal(M.errorLine("뭔가 이상함\nC:\\work>"), "뭔가 이상함");
  assert.equal(M.errorLine("oops\nuser@host:~/w$ "), "oops");
  assert.equal(M.errorLine("The command could not be loaded, possibly because:\n  * You intended to execute a .NET SDK command:\n      No .NET SDKs were found.\n\nDownload a .NET SDK:\nhttps://aka.ms/dotnet-download\n(base)\nPS C:\\w> "), "No .NET SDKs were found.");
});
