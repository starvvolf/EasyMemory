import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { listExplanations, saveExplanation } from "./explain.ts";

test("쉬운 설명은 쪽마다 하나로 저장되고 다시 읽힌다", async () => {
  process.env.STUDY_FORGE_DATA_DIR = await mkdtemp(path.join(tmpdir(), "explain-"));
  assert.deepEqual(await listExplanations("src-1"), []);
  await Promise.all([saveExplanation("src-1", 3, "처음"), saveExplanation("src-1", 1, "첫 쪽")]);
  await saveExplanation("src-1", 3, "고친 설명");
  const pages = await listExplanations("src-1");
  assert.deepEqual(pages.map((p) => [p.page, p.text]), [[1, "첫 쪽"], [3, "고친 설명"]]);
  await assert.rejects(() => listExplanations("../x"));
});
