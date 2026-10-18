import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CodexAppServer } from "../src/lib/codex-app-server.ts";
import { CodexRuntimeError } from "../src/lib/ai/codex-errors.ts";

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "fake-codex-app-server.cjs",
);

test("응답 시간이 초과되면 실행 중인 turn을 취소한다", async () => {
  const server = new CodexAppServer({
    command: process.execPath,
    args: [fixture, "timeout"],
    turnTimeoutMs: 25,
  });
  try {
    await assert.rejects(
      server.chat({ message: "timeout" }),
      (error) =>
        error instanceof CodexRuntimeError && error.code === "turn_timeout",
    );
  } finally {
    server.close();
  }
});

test("App Server가 종료되면 turn 대기를 즉시 해제한다", async () => {
  const server = new CodexAppServer({
    command: process.execPath,
    args: [fixture, "exit"],
    turnTimeoutMs: 5_000,
  });
  const startedAt = Date.now();
  try {
    await assert.rejects(
      server.chat({ message: "exit" }),
      (error) =>
        error instanceof CodexRuntimeError && error.code === "connection_lost",
    );
    assert.ok(Date.now() - startedAt < 1_000);
  } finally {
    server.close();
  }
});
