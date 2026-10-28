// 점검 보고서: a sound store passes every check; a broken link and a same-name pair are caught.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { knowledgeReport } from "./report.ts";
import { createGoal, setGoalSource, sourceKey } from "./goals.ts";
import { linkKnowledge, saveMany, sortItems } from "./store.ts";

test("점검 보고서: summary, checks, items by 주제, goals and 자료", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knowledge-report-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try {
    const src = { kind: "pdf" as const, title: "그래픽스 03", ref: "d:c1" };
    const [a, b] = await saveMany([{ title: "원근 투영", body: "멀수록 작게", source: src }, { title: "투영 행렬", body: "4x4 행렬", source: src }]);
    await sortItems([{ id: a.item.id, topic: "CS/그래픽스/투영", kind: "concept" }, { id: b.item.id, topic: "CS/그래픽스/투영", kind: "formula" }]);
    await linkKnowledge(a.item.id, b.item.id, "포함");
    const g = await createGoal({ name: "컴퓨터그래픽스", date: "2026-11-20" });
    await setGoalSource(g.id, { key: sourceKey(src), kind: "pdf", title: src.title }, true);
    const ok = await knowledgeReport(new Date("2026-10-28T10:00:00Z"));
    assert.equal(ok.fails, 0, ok.markdown);
    assert.match(ok.markdown, /### CS \/ 그래픽스 \/ 투영 \(2\)/);
    assert.match(ok.markdown, /\*\*원근 투영\*\* · 개념·용어 · 만남 — 멀수록 작게 \| 고리: →투영 행렬\(포함\) \| 출처: PDF 그래픽스 03 \| 목표: 컴퓨터그래픽스/);
    assert.match(ok.markdown, /\*\*컴퓨터그래픽스\*\* · 2026-11-20 \(D-23\) · 지식 2/);

    // Break it by hand: a link to nothing, and a second item named like the first.
    const file = path.join(dir, "knowledge", "store.json");
    const store = JSON.parse(await readFile(file, "utf8"));
    store.items[1].links.push({ to: "k_gone", relation: "관련" });
    store.items.push({ ...store.items[0], id: "k_twin", links: [] });
    await writeFile(file, JSON.stringify(store));
    const bad = await knowledgeReport(new Date("2026-10-28T10:00:00Z"));
    assert.equal(bad.fails, 2);
    assert.match(bad.markdown, /✗ 고리가 있는 지식을 가리킨다 — 1개\n  - 투영 행렬 → \(없는 지식 k_gone\)/);
    assert.match(bad.markdown, /✗ 이름\(다른 이름 포함\)이 겹치는 지식이 없다 — 1개\n  - 원근 투영 \(k_\w+\) = 원근 투영 \(k_twin\)/);
  } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
});
