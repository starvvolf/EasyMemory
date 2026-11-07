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

test("다시 확인 문항(실습 부족함)은 저장되고 복습에서 뜻 카드 대신 먼저 나온다", async () => {
  const { questionsFor } = await import("./questions.ts");
  const item = { id: "k1", title: "딕셔너리 키 확인", body: "키가 없을 때 d[k]는 KeyError", aliases: [], folderId: null, links: [], state: "unknown" as const,
    checks: [{ q: "counts = {}; counts['x'] += 1 은 어떻게 될까요?", a: "KeyError. 없는 키를 먼저 읽기 때문", note: "+=가 기존 값을 읽는 걸 몰랐음", at: "2026-11-08" }] };
  const qs = questionsFor(item, [item], "s");
  assert.equal(qs[0].label, "다시 확인"); assert.match(qs[0].prompt, /counts/);
  const known = questionsFor({ ...item, state: "known" as const }, [item], "s");
  assert.notEqual(known[0].label, "다시 확인");
});

test("saveMany check → checks(같은 질문 한 번)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knowledge-check-"));
  process.env.STUDY_FORGE_DATA_DIR = dir; process.env.RECALLER_AFTER_SAVE = "off";
  try {
    const { saveMany, getKnowledge } = await import("./store.ts");
    const check = { q: "빈 dict에 += 1 하면?", a: "KeyError", note: "몰랐음", ref: "project:r1" };
    const [r] = await saveMany([{ title: "dict 키", body: "없는 키는 KeyError", state: "unknown", check }]);
    await saveMany([{ title: "dict 키", check }]);
    const k = await getKnowledge(r.item.id);
    assert.equal(k.item.checks?.length, 1); assert.equal(k.item.checks?.[0].a, "KeyError");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
