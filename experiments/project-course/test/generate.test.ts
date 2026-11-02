// 코스 생성(11/3): 목표 → 목차 → 1단계(관문) → 2단계는 뒤에서. 느슨한 검사는 관문이 잡아 다시 만든다. 가짜 AI로.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.PC_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "pc-gen-"));
const { installFakeAi } = await import("../lib/fake-ai.ts");
process.env.PC_FAKE_AI = "1";
installFakeAi();
const { startGeneration, genStatus, prepareNext, isRunning } = await import("../lib/generate.ts");
const { loadCourse, stageFiles } = await import("../lib/course.ts");

const until = async (fn: () => Promise<boolean>, ms = 60000) => { const t = Date.now(); while (!(await fn())) { if (Date.now() - t > ms) throw new Error("시간 초과"); await new Promise((r) => setTimeout(r, 200)); } };

test("목표 → 목차 → 1단계 관문 통과(느슨한 검사는 한 번 걸러짐) → 2단계는 뒤에서", { timeout: 120000 }, async () => {
  const id = await startGeneration("인사하는 서버 느슨");
  await until(async () => { const s = await genStatus(id); return s?.phase === "ready" || s?.phase === "failed"; });
  const s = await genStatus(id);
  assert.equal(s?.phase, "ready", s?.message);
  assert.ok((s?.attempts ?? 0) >= 2, "느슨한 검사 첫 시도는 관문에서 걸러져야 해요");
  const c = await loadCourse(id);
  assert.equal(c.generated?.outline.length, 2);
  assert.deepEqual(c.stages.map((x) => x.n), [1]);
  assert.match((await stageFiles(c, 1)).get("src/routes/hello.ts")!, /TODO\(1단계\)/);
  prepareNext(id, 1);
  await until(async () => !isRunning(id, 2));
  const c2 = await loadCourse(id);
  assert.deepEqual(c2.stages.map((x) => x.n), [1, 2], (await genStatus(id))?.message);
  assert.ok(c2.checks.some((x) => x.stage === 2));
});
