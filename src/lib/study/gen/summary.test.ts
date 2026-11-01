import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGen, genLive, loadSummary, questionsGen, readGenCalls, runGen } from "./runner.ts";
import { citedPages, pagesOutside, summaryUser } from "./summary.ts";

// Invented public pages (not lecture material).
const pages = new Map([
  [1, "# Back-Face Detection\n- A polygon is a back face if its normal points away from the viewer"],
  [2, "# Depth-Buffer Method\n- A surface is drawn only where its depth is smaller than the stored depth"],
]);

async function withData<T>(run: () => Promise<T>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "recaller-summary-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try { return await run(); } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
}
async function settled(id: string) {
  for (let i = 0; i < 100; i++) {
    const s = await loadSummary(id);
    if (s && s.status !== "writing") return s;
    await new Promise((r) => setTimeout(r, 20));
  }
  return loadSummary(id);
}

test("정리 글: every cited page is read, in all the ways a page is written", () => {
  assert.deepEqual(citedPages("가 (p.3). 나 (p.3, 5). 다 (p.7–9). 라 (p.10-11, p.14). 마 (p. 2)."), [3, 3, 5, 7, 8, 9, 10, 11, 14, 2]);
  assert.deepEqual(pagesOutside("가 (p.3). 나 (p.15). 다 (p.14–16).", [1, 2, 3, 14]), [15, 16]);
  assert.deepEqual(citedPages("그림 3(a)와 (p.)는 쪽이 아니다"), []);
  assert.equal(summaryUser("a.pdf", [{ page: 2, text: "본문" }, { page: 3, text: "" }]), "[자료] a.pdf\n\n[p.2]\n본문\n\n[p.3]\n(글자 없음)");
});

test("정리 글: written beside the cards from 전처리, page-checked, kept by a later start, off unless lab.summary", () => withData(async () => {
  const io = { pdf: async () => null, pages: async () => pages };
  const start = await createGen({ sourceId: "src_summary_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake", questionsLater: true, lab: { summary: true } });
  const first = await runGen(start.id, { uid: "local-experiment" }, io);
  assert.equal(first.status, "done", first.message);
  const summary = await settled(first.id);
  assert.equal(summary?.status, "done", summary?.error);
  assert.match(summary!.text, /\(p\.1\)/);
  assert.match(summary!.text, /## 핵심 정리/);
  assert.deepEqual(summary!.outside, []);
  assert.equal(summary!.model, "gpt-6.1-sol");
  // Not one of the run's counted calls, so the call cap and the call list are as before.
  assert.ok(!(await readGenCalls(first.id)).some((c) => c.step === "rc-summary"));
  assert.equal((await genLive(first.id)).summary?.status, "done");
  // 문제 만들기 goes on in the same run and leaves the summary as written.
  await questionsGen(first.id);
  const second = await runGen(first.id, { uid: "local-experiment" }, io);
  assert.equal(second.status, "done", second.message);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await loadSummary(first.id))?.startedAt, summary!.startedAt);

  const off = await createGen({ sourceId: "src_summary_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "recaller", provider: "fake", lab: { skimOnly: true } });
  assert.equal((await runGen(off.id, { uid: "local-experiment" }, io)).status, "done");
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await loadSummary(off.id), null);
}));
