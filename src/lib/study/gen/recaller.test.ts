// 엔진 끝까지 (가짜 모델): 줄기 계획 → 기억 채우기 → 학습 목표. PDF 자료와 글 자료(유튜브 자막 같은 것) 둘 다.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGen, readGenCalls, runGen, studyLab } from "./runner.ts";
import { saveTextSource, splitPages } from "../text-sources.ts";

const pages = new Map([
  [1, "# Back-Face Detection\n- A polygon is a back face if its normal points away from the viewer"],
  [2, "# Depth-Buffer Method\n- Initialize the depth buffer to 1.0 for every pixel"],
  [3, "# Painter's Algorithm\n- Draw surfaces from back to front"],
]);
async function withData<T>(fn: () => Promise<T>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rc-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try { return await fn(); }
  finally { if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior; await rm(dir, { recursive: true, force: true }); }
}

test("자료 한 편: 줄기 계획 → 영역마다 기억 채우기 → 학습 목표, 카드는 기억마다 한 장", () => withData(async () => {
  const start = await createGen({ sourceId: "src_fixture", fileName: "invented.pdf", pageNumbers: [1, 2, 3], provider: "fake" });
  assert.deepEqual(start.input.lab, studyLab(), "앱 기본 손잡이");
  const done = await runGen(start.id, { uid: "local-experiment" }, { pdf: async () => null, pages: async () => pages });
  assert.equal(done.status, "done", done.message);
  const steps = (await readGenCalls(done.id)).map((c) => c.step);
  assert.deepEqual([...new Set(steps)].sort(), ["rc-q-goals", "rc-stem-fill", "rc-stem-plan"]);
  const cards = done.sections.flatMap((s) => done.recaller!.units[s.id].cards ?? []);
  assert.equal(cards.length, 3);
  assert.ok(cards.every((c) => /^t\d+\.m\d+$/.test(c.id) && c.memo));
  assert.ok(done.recaller!.digest!.objectives?.length, "학습 목표");
  // 다시 돌려도 이미 한 것은 다시 부르지 않는다
  const again = await runGen(done.id, { uid: "local-experiment" });
  assert.equal((await readGenCalls(again.id)).length, steps.length);
}));

test("글 자료(PDF 없음): 쪽으로 나눠 저장하고 같은 길로 카드를 만든다", () => withData(async () => {
  const text = Array.from({ length: 6 }, (_, i) => `[${i}:00] 문단 ${i + 1}. ${"설명 ".repeat(120)}`).join("\n\n");
  assert.ok(splitPages(text).length >= 2, "긴 글은 여러 쪽");
  const source = await saveTextSource({ title: "자막 시험", kind: "youtube", url: "https://www.youtube.com/watch?v=abc", text });
  assert.equal((await saveTextSource({ title: "다시", kind: "youtube", url: "https://www.youtube.com/watch?v=abc", text })).id, source.id, "같은 글은 같은 id");
  const n = Object.keys(source.pages).length;
  const start = await createGen({ sourceId: source.id, fileName: source.title, pageNumbers: Array.from({ length: n }, (_, i) => i + 1), provider: "fake" });
  const done = await runGen(start.id, { uid: "local-experiment" });
  assert.equal(done.status, "done", done.message);
  assert.equal(done.sections.flatMap((s) => done.recaller!.units[s.id].cards ?? []).length, n);
}));
