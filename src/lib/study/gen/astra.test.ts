import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { astraFakeReply } from "./astra.ts";
import { confirmObjectives, createGen, readGenCalls, readSectionDocument, runGen } from "./runner.ts";
import type { GenStep } from "./types.ts";

// Public invented fixture, not the private graphics question. This checks fail-closed orchestration,
// NOT whether an AI can detect a defect: the fake solver explicitly reports the known relation leak.
test("astra: 확인 후 전체 흐름, 반복된 관계 노출은 독립 풀이 경고가 해소되기 전 공개하지 않는다", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "astra-flow-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try {
    const fakeReply = (step: GenStep, user: string, attempt: number) => {
      const result = JSON.parse(astraFakeReply(step, user));
      if (step === "astra-plan") result.practice[0].questionCount = 2;
      if (step === "astra-author") {
        for (const q of result.questions) if (q.objectiveId === "s1-o1") q.stem[0].text = "청색은 대기 상태다. 대기 상태의 색은 무엇인가?";
      }
      if (step === "astra-solve") {
        assert.ok(!user.includes('"accepted"') && !user.includes('"recall"') && !user.includes('"requiredPoints"') && !user.includes('"correctIndex"'), "독립 풀이에 정답·계획을 전달하지 않는다");
        for (const item of result.items) if (item.objectiveId === "s1-o1") item.exposedRelation = "질문이 대기와 청색의 대응을 그대로 준다.";
      }
      if (step === "astra-review" && attempt === 1) {
        for (const item of result.items) if (item.objectiveId === "s1-o1") { item.status = "revise"; item.reasons = ["알아낼 대응이 이미 제공됨"]; }
      }
      // Second editor carelessly returns ready with no rebuttal. Publication must still refuse it.
      return JSON.stringify(result);
    };
    const start = await createGen({ sourceId: "src_astra_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "astra", provider: "fake", autoConfirm: false });
    const waiting = await runGen(start.id, { uid: "local-experiment" }, { fakeReply });
    assert.equal(waiting.status, "awaiting-confirm");
    assert.equal(await readSectionDocument(start.id, "s1"), null, "검수 전에 초안을 게시하지 않는다");
    await confirmObjectives(start.id, waiting.sections[0].design!.objectives.map(o => o.id));
    const done = await runGen(start.id, { uid: "local-experiment" }, { fakeReply });
    assert.equal(done.status, "done");
    assert.equal(done.sections[0].author?.questionCount, 1, JSON.stringify(done.sections[0].author));
    assert.equal(done.sections[0].author?.dropped[0].objectiveId, "s1-o1");
    assert.match(done.sections[0].author!.dropped[0].reason, /독립 풀이/);
    const document = await readSectionDocument(start.id, "s1") as { questions: Array<{ id: string }> };
    assert.deepEqual(document.questions.map(q => q.id), ["q-s1-o2"]);
    const calls = await readGenCalls(start.id);
    assert.deepEqual(calls.map(c => c.step), ["astra-plan", "astra-author", "astra-solve", "astra-review", "astra-author", "astra-solve", "astra-review"]);
  } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
});
