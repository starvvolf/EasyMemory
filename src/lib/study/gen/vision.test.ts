import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listVisionProbes, readVisionImage, runVisionProbe } from "./vision.ts";

test("이미지 읽기 시험: 확인 없이는 실제 호출을 안 하고, 결과·이미지·글자 층(하이픈 고침)을 남긴다", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vision-"));
  const previous = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try {
    const options = {
      pdf: async () => ({ bytes: new Uint8Array([1]), fileName: "02_Geometric Transformations.pdf" }),
      render: async () => "data:image/jpeg;base64,/9j/AAAA",
      texts: async () => "Composite Two㎿Dimensional Rotations",
    };
    await assert.rejects(runVisionProbe({ sourceId: "s", page: 10 }, { uid: "u" }, options), /확인이 필요/);
    const probe = await runVisionProbe({ sourceId: "s", page: 10, provider: "fake" }, { uid: "u" }, options);
    assert.equal(probe.ok, true, probe.error ?? "");
    assert.equal(probe.textLayer, "Composite Two-Dimensional Rotations");
    assert.match(probe.reply ?? "", /p\.10/);
    assert.equal((await listVisionProbes())[0].id, probe.id);
    assert.equal(await readVisionImage(probe.id), "data:image/jpeg;base64,/9j/AAAA");
  } finally {
    if (previous === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
