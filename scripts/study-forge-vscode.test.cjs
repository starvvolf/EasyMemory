/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");
const { createStudyForgeClient } = require("../tools/study-forge-vscode/client");

test("VS Code client가 프로젝트 조회, 현재 세션 조회, 코드 제출 경로를 연결한다", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/study-projects")) return response({ projects: [{ id: "project-1", name: "React" }] });
    if (url.endsWith("/coding-session")) return response({ session: { id: "session-1" } });
    return response({ submission: { id: "submission-1" } }, 201);
  };
  const client = createStudyForgeClient("http://127.0.0.1:3000/", fetchImpl);
  assert.equal((await client.listProjects())[0].id, "project-1");
  assert.equal((await client.getActiveSession("project-1")).id, "session-1");
  assert.equal((await client.submitCode("session-1", {
    filePath: "src/a.ts",
    language: "typescript",
    selectedCode: "const a = 1",
  })).id, "submission-1");
  assert.deepEqual(calls.map((call) => call.url), [
    "http://127.0.0.1:3000/api/study-projects",
    "http://127.0.0.1:3000/api/study-projects/project-1/coding-session",
    "http://127.0.0.1:3000/api/coding-sessions/session-1/submissions",
  ]);
  assert.equal(calls[2].options.method, "POST");
});

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; },
  };
}
