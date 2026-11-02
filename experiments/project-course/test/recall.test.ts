// 기존 지식 검색(11/3): 앱이 있으면 관련 지식 한 줄, 없으면 빈 줄
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

test("앱 지식 검색 → 튜터 맥락 한 줄, 앱이 꺼져 있으면 조용히 빈 줄", async () => {
  const srv = createServer((req, res) => {
    const q = new URL(req.url ?? "/", "http://x").searchParams.get("q");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ hits: q?.includes("콜백") ? [{ id: "k1", title: "콜백 함수", state: "unknown", line: "함수를 값으로 넘겨 나중에 부르게 함" }] : [] }));
  });
  await new Promise<void>((r) => srv.listen(4193, "127.0.0.1", () => r()));
  process.env.PROJECT_APP_URL = "http://127.0.0.1:4193";
  const { recallLine } = await import("../lib/recall.ts");
  const line = await recallLine("콜백이 뭐예요?");
  assert.match(line, /콜백 함수\(몰랐음\)/);
  assert.equal(await recallLine("아무거나"), "");
  srv.close();
  process.env.PROJECT_APP_URL = "http://127.0.0.1:4194";
  assert.equal(await recallLine("다른 질문 콜백 아님"), "");
});
