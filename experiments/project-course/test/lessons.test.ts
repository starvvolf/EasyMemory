// 수업 계획서 검사: 계획서가 가리키는 코드 위치(앵커)가 그 단계 시작 코드에 실제로 있는지, 예측 문제·동작이 맞는지.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { COURSES, loadCourse, stageOf } from "../lib/course.ts";
import { buildFiles } from "../lib/stagegen.ts";

const DOS = new Set(["next", "try", "start_dev,try", "observe", "db", "next_stage", "scaffold", "check", "hint"]);

test("수업 계획서: 앵커·예측·동작이 그 단계 시작 코드와 맞는다", async () => {
  const course = await loadCourse("board-api");
  const dir = path.join(COURSES, "board-api", "lessons");
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".json"))) {
    const plan = JSON.parse(await readFile(path.join(dir, f), "utf8"));
    const st = stageOf(course, plan.stage);
    const files = await buildFiles({ dir: path.join(COURSES, "board-api", st.template === "board" ? "template" : st.template) }, { stage: plan.stage });
    const has = (file: string, anchor: string) => {
      const t = files.get(file);
      assert.ok(t !== undefined, `${f}: 파일 없음 ${file}`);
      assert.ok(t!.includes(anchor), `${f}: ${file}에 "${anchor}" 없음`);
    };
    const pids = new Set(st.predict.map((p) => p.id));
    for (const b of plan.beats) {
      for (const m of String(b.text).matchAll(/\[\[([^\]#]+)#([^\]]+)\]\]/g)) has(m[1], m[2]);
      if (b.open) { has(b.open.file, b.open.anchor); if (b.open.toAnchor) has(b.open.file, b.open.toAnchor); }
      if (b.focus) for (const c of b.focus.chunks) has(b.focus.file, c.anchor);
      if (b.scaffold) { has(b.scaffold.file, b.scaffold.from); if (b.scaffold.to) has(b.scaffold.file, b.scaffold.to); }
      if (b.kind === "predict") assert.ok(pids.has(b.predict), `${f}: 예측 ${b.predict} 없음`);
      for (const a of [...(b.actions ?? []), ...(b.after ?? [])]) {
        assert.ok(DOS.has(a.do), `${f}: 모르는 동작 ${a.do}`);
        if (a.do === "db") assert.match(a.sql, /^select/i);
        if (a.do.includes("try")) assert.ok(a.try || a.tries?.length, `${f}: ${b.id} 보낼 요청 없음`);
      }
    }
    assert.ok(plan.beats.some((b: { kind: string }) => b.kind === "fix"), `${f}: 고치기 순서 없음`);
  }
});
