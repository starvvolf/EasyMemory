// 틀렸던 코드(2026-11-06 D [경계]): 실습이 saveMany에 mistake를 주면 지식의 mistakes에 쌓인다(같은 코드는 한 번, 최근 3개).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("saveMany mistake → mistakes(같은 코드 한 번, 최근 3개)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knowledge-mistake-"));
  process.env.STUDY_FORGE_DATA_DIR = dir; process.env.RECALLER_AFTER_SAVE = "off";
  try {
    const { saveMany } = await import("./store.ts");
    const src = { kind: "code" as const, title: "실습: 캐시", ref: "project:r1" };
    const m = (code: string) => ({ file: "c.py", from: 3, to: 3, code, note: "조건에 = 씀", ref: "project:r1" });
    const [a] = await saveMany([{ title: "비교 연산", state: "unknown", mistake: m("if cache[n]=False:"), source: src }]);
    assert.equal(a.item.mistakes?.length, 1);
    await saveMany([{ title: "비교 연산", mistake: m("if cache[n]=False:"), source: src }]);
    for (const c of ["a", "b", "c"]) await saveMany([{ title: "비교 연산", mistake: m(c), source: src }]);
    const [z] = await saveMany([{ title: "비교 연산", source: src }]);
    assert.deepEqual(z.item.mistakes!.map((x) => x.code), ["a", "b", "c"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
