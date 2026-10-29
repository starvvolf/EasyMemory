// 프로젝트 노트(학습자 기억): 말 나누기·요약 뽑기
import { test } from "node:test";
import assert from "node:assert/strict";
import { codeTerms, firstLine, isTerm, scopeOf } from "../lib/notes.ts";

test("말 나누기: 문법 / 도구 / 프로젝트 이름", () => {
  const sym = new Map([["router", "src/app.ts"], ["requireUser", "src/auth.ts"], ["findPost", "src/routes/posts.ts"]]);
  assert.equal(scopeOf("=>", sym).scope, "문법");
  assert.equal(scopeOf("await", sym).scope, "문법");
  assert.equal(scopeOf("??", sym).scope, "문법");
  assert.equal(scopeOf("JSON.parse", sym).scope, "도구");
  assert.equal(scopeOf("scryptSync", sym).scope, "도구");
  assert.deepEqual(scopeOf("router.match", sym), { scope: "프로젝트", home: "src/app.ts" });
  assert.deepEqual(scopeOf("requireUser", sym), { scope: "프로젝트", home: "src/auth.ts" });
});
test("코드 말만 뽑기, 첫 문단 요약", () => {
  assert.deepEqual(codeTerms("`req` — 받은 편지, `💬 설명`, `/health`, `req.method ?? \"GET\"`, `??`\n```ts\n`x`\n```"), ["req", "??"]);
  assert.ok(isTerm("found.handler")); assert.ok(!isTerm("주소 읽기"));
  assert.equal(firstLine("### 제목\n\n이 덩어리는 **편지**를 받는 곳이에요. [[src/server.ts:9]] 참고.\n\n- 목록"), "이 덩어리는 편지를 받는 곳이에요. src/server.ts 9줄 참고.");
});
