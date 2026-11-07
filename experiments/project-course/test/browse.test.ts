import { test } from "node:test";
import assert from "node:assert/strict";
const { allowedUrl } = await import("../lib/browse.ts");
test("내 컴퓨터 안 학습자 페이지만", () => {
  for (const u of ["http://localhost:5173/", "http://127.0.0.1:4101/posts", "http://[::1]:8080"]) assert.equal(allowedUrl(u).ok, true, u);
  for (const u of ["https://example.com", "http://192.168.0.2:8080", "http://localhost:3000/", "http://127.0.0.1:4100/", "file:///C:/a.html", "localhost:5173", "http://evil.localhost.com/"]) assert.equal(allowedUrl(u).ok, false, u);
});
