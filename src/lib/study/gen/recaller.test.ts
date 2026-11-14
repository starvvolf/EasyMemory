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
  const source = await saveTextSource({ title: "글 시험", kind: "text", text });
  assert.equal((await saveTextSource({ title: "다시", kind: "text", text })).id, source.id, "같은 글은 같은 id");
  const n = Object.keys(source.pages).length;
  const start = await createGen({ sourceId: source.id, fileName: source.title, pageNumbers: Array.from({ length: n }, (_, i) => i + 1), provider: "fake" });
  const done = await runGen(start.id, { uid: "local-experiment" });
  assert.equal(done.status, "done", done.message);
  assert.equal(done.sections.flatMap((s) => done.recaller!.units[s.id].cards ?? []).length, n);
}));

test("유튜브: 자막만 오면 내용 정리(yt-notes)부터 쓰고, 정리의 대단원(복습 질문 빼고)이 쪽이 되어 카드가 된다", () => withData(async () => {
  const { saveYoutubeSource, youtubeView } = await import("../../youtube/ingest.ts");
  const transcript = Array.from({ length: 6 }, (_, i) => `[${i}:00] 자막 줄 ${i + 1}: 깊이 버퍼는 가까운 면을 남긴다`).join("\n");
  const source = await saveYoutubeSource({ url: "https://www.youtube.com/watch?v=abc123", title: "깊이 버퍼 강의", transcript });
  assert.equal(source.notes?.status, "waiting");
  const start = await createGen({ sourceId: source.id, fileName: source.title, pageNumbers: [1], provider: "fake" });
  const done = await runGen(start.id, { uid: "local-experiment" });
  assert.equal(done.status, "done", done.message);
  assert.deepEqual(done.input.pageNumbers, [1, 2], "자막 6줄 → 대단원 2개, 복습 질문은 쪽이 아니다");
  const view = (await youtubeView(source.id))!;
  assert.equal(view.notes?.status, "done");
  assert.ok(view.pages["1"].startsWith("[영상 한 줄]") && view.pages["1"].includes("# 단원 1 [0:00]"));
  assert.equal((await readGenCalls(done.id))[0].step, "yt-notes");
  assert.equal(done.sections.flatMap((s) => done.recaller!.units[s.id].cards ?? []).length, 2);
}));

test("유튜브: 패널에서 이미 정리한 영상은 그 정리를 그대로 쓰고 정리 호출을 하지 않는다", () => withData(async () => {
  const { saveYoutubeSource } = await import("../../youtube/ingest.ts");
  const notes = "@유형: 강의·설명\n@한줄: 한 줄\n\n## 첫 주제 [0:10]\n- 가\n\n## 둘째 주제 [3:00]\n- 나\n\n## 셋째 주제 [6:00]\n- 다";
  const source = await saveYoutubeSource({ url: "https://youtu.be/xyz98765432", title: "패널 정리", notes });
  assert.deepEqual(Object.keys(source.pages), ["1", "2", "3"], "# 없이 ## 셋이면 ## 마다");
  const start = await createGen({ sourceId: source.id, fileName: source.title, pageNumbers: [1, 2, 3], provider: "fake" });
  const done = await runGen(start.id, { uid: "local-experiment" });
  assert.equal(done.status, "done", done.message);
  assert.ok(!(await readGenCalls(done.id)).some((c) => c.step === "yt-notes"));
}));
