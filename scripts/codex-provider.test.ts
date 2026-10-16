import assert from "node:assert/strict";
import test from "node:test";

import { selectCodexJsonThreadId } from "../src/lib/ai/codex-provider.ts";

test("프로젝트 호출은 저장된 공용 스레드를 우선한다", () => {
  assert.equal(
    selectCodexJsonThreadId({
      scope: "project",
      projectThreadId: "project-thread",
      requestedThreadId: "requested-thread",
    }),
    "project-thread",
  );
});

test("학습 생성 호출은 공용 스레드를 무시하고 작업 스레드만 이어간다", () => {
  assert.equal(
    selectCodexJsonThreadId({
      scope: "job",
      projectThreadId: "project-thread",
      requestedThreadId: "generation-thread",
    }),
    "generation-thread",
  );
  assert.equal(
    selectCodexJsonThreadId({
      scope: "job",
      projectThreadId: "project-thread",
    }),
    undefined,
  );
});
