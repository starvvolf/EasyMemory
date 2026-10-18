import assert from "node:assert/strict";
import test from "node:test";
import {
  CodexRuntimeError,
  isReplaceableProjectThreadError,
  toCodexHttpError,
} from "../src/lib/ai/codex-errors.ts";

test("Codex 오류를 사용자 메시지와 HTTP 상태로 구분한다", () => {
  assert.deepEqual(
    toCodexHttpError(
      new CodexRuntimeError("turn_timeout", "timed out"),
      "fallback",
    ),
    {
      code: "turn_timeout",
      message: "Codex 응답 시간이 초과되어 진행 중인 작업을 취소했습니다. 다시 시도해 주세요.",
      status: 504,
    },
  );

  const wrapped = new Error("pipeline failed", {
    cause: new CodexRuntimeError("login_required", "not logged in"),
  });
  assert.equal(toCodexHttpError(wrapped, "fallback").status, 401);
  assert.equal(toCodexHttpError(new Error("plain failure"), "fallback").message, "fallback");
});

test("복구 가능한 프로젝트 스레드 오류만 교체 대상으로 분류한다", () => {
  assert.equal(
    isReplaceableProjectThreadError(
      new Error("thread 123 already has an active writer"),
    ),
    true,
  );
  assert.equal(
    isReplaceableProjectThreadError(new Error("thread 123 not found")),
    true,
  );
  assert.equal(
    isReplaceableProjectThreadError(new Error("invalid session id")),
    true,
  );
  assert.equal(
    isReplaceableProjectThreadError(
      new CodexRuntimeError("turn_timeout", "timed out"),
    ),
    false,
  );
});
