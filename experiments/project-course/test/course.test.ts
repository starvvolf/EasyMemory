// 코스 데이터가 스스로 맞는지: 각 단계의 시작 상태는 그 단계의 "없애 보기" 검사에서 실패하고
// 이전 단계 검사(회귀)는 통과해야 한다. 푼 상태는 그 단계까지의 검사를 모두 통과해야 한다.
// 실제 서버를 띄우고 실제 HTTP 요청을 보낸다(포트 4190).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadCourse, solutionDiff, stageFiles } from "../lib/course.ts";
import { renderSource } from "../lib/stagegen.ts";
import { writeWorkspace } from "../lib/stagegen.ts";
import { runChecks } from "../lib/checker.ts";

const PORT = 4190;

test("표식: from/until/swap", () => {
  const src = ["a", "// <from 2>", "b", "// </from>", "// <until 1>", "c", "// </until>", "// <swap 2>", "fin", "// <start>", "beg", "// </swap>"].join("\n");
  assert.equal(renderSource(src, { stage: 1 }), "a\nc\nbeg");
  assert.equal(renderSource(src, { stage: 2 }), "a\nb\nbeg");
  assert.equal(renderSource(src, { stage: 2, solved: true }), "a\nb\nfin");
  assert.equal(renderSource(src, { stage: 3 }), "a\nb\nfin");
  assert.equal(renderSource("// @from 3\nx", { stage: 2 }), null);
  assert.throws(() => renderSource("// <from 2>\nx", { stage: 1 }));
});

test("코스 데이터: 단계의 검사·지식·부품 이름이 모두 있다", async () => {
  const c = await loadCourse("board-api");
  const kids = new Set(c.knowledge.map((k) => k.id));
  const checkIds = new Set(c.checks.map((x) => x.id));
  for (const s of c.stages) {
    for (const k of [...s.knowledge, ...s.explain.knowledge, ...s.predict.flatMap((p) => p.knowledge)]) assert.ok(kids.has(k), `${s.n}단계 지식 ${k}`);
    for (const id of s.observe.checks) assert.ok(checkIds.has(id), `${s.n}단계 검사 ${id}`);
    for (const p of s.parts) assert.ok(c.parts.some((x) => x.id === p), `${s.n}단계 부품 ${p}`);
    for (const p of s.predict) assert.ok(p.answer >= 0 && p.answer < p.options.length);
  }
  for (const ch of c.checks) for (const k of ch.knowledge) assert.ok(kids.has(k), `${ch.id} 지식 ${k}`);
  for (const d of c.intake.diagnose) assert.ok(d.answer < d.options.length);
});

const course = await loadCourse("board-api");
for (const stage of course.stages) {
  test(`${stage.n}단계: 시작 상태는 없애 보기 검사에서 실패, 이전 단계는 통과 / 푼 상태는 모두 통과`, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), `pc-${stage.n}-`));
    try {
      await writeWorkspace(dir, await stageFiles(course, stage.n));
      const start = await runChecks({ course, stage: stage.n, ws: dir, port: PORT });
      assert.ok(start.started, start.startError);
      for (const r of start.results) {
        if (r.regression && !(stage.breaks ?? []).includes(r.id)) assert.ok(r.ok, `시작 상태에서 이전 단계 검사 ${r.id} 실패: ${JSON.stringify(r.failure)}`);
        if (stage.observe.checks.includes(r.id)) assert.ok(!r.ok, `시작 상태인데 ${r.id}가 통과함`);
        if (!r.ok) assert.ok(r.where?.line, `${r.id}의 파일:줄 후보가 없음`);
      }
      await writeWorkspace(dir, await stageFiles(course, stage.n, { solved: true }));
      const solved = await runChecks({ course, stage: stage.n, ws: dir, port: PORT });
      const bad = solved.results.filter((r) => !r.ok);
      assert.equal(bad.length, 0, `푼 상태에서 실패: ${JSON.stringify(bad.map((b) => [b.id, b.failure]), null, 1)}\n${solved.logs.slice(-10).join("\n")}`);
      assert.ok((await solutionDiff(course, stage.n)).length > 0, "정답 줄이 없음");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
