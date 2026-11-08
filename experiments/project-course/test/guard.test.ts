import { test } from "node:test";
import assert from "node:assert/strict";
const { blockedRequest } = await import("../lib/guard.ts");
test("이 컴퓨터 · Recaller 출처만", () => {
  assert.equal(blockedRequest("GET", { host: "127.0.0.1:4100" }), null);
  assert.equal(blockedRequest("POST", { host: "127.0.0.1:4100" }), null, "확장 · 앱 서버는 Origin 없이");
  assert.equal(blockedRequest("POST", { host: "127.0.0.1:4100", origin: "http://127.0.0.1:4100" }), null);
  assert.equal(blockedRequest("POST", { host: "localhost:4100", origin: "http://localhost:3000" }), null);
  assert.ok(blockedRequest("POST", { host: "127.0.0.1:4100", origin: "https://evil.example" }));
  assert.ok(blockedRequest("POST", { host: "127.0.0.1:4100", origin: "null" }));
  assert.ok(blockedRequest("POST", { host: "127.0.0.1:4100", "sec-fetch-site": "cross-site" }));
  assert.ok(blockedRequest("GET", { host: "evil.example:4100" }), "주소 돌리기(리바인딩)");
});
