import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("튜터 흐름: 화면엔 답이 없고, 드릴·설계·예측은 코드가 대조하고, 기억 저장소에 남는다", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tutor-"));
  const prior = { data: process.env.STUDY_FORGE_DATA_DIR, after: process.env.RECALLER_AFTER_SAVE };
  process.env.STUDY_FORGE_DATA_DIR = dir; process.env.RECALLER_AFTER_SAVE = "off";
  try {
    const m = (number: string, role: "lecture" | "basic") => ({ number, title: `문제 ${number}`, chapter: "0x09", role, url: "u", statement: "s", inputText: "i", outputText: "o", summary: "격자에서 덩어리를 센다",
      maxN: 500, patterns: ["components"], signals: ["연결된 영역"], approaches: [{ name: "BFS로 덩어리 세기", verdict: "best", why: "w" }, { name: "모든 쌍 비교", verdict: "slow", why: "w" }, { name: "정렬", verdict: "wrong", why: "w" }],
      state: { right: "방문 배열", wrong: ["합계", "정렬된 배열"] }, update: "넣을 때 표시", complexity: "n²", pitfalls: ["경계"],
      walkthrough: { observe: "o", choose: "c", compare: "x", verify: "v" }, predict: { question: "q", input: "1 1\n1", answer: "1\n1" }, at: "" });
    await mkdir(path.join(dir, "code", "tutor"), { recursive: true });
    await writeFile(path.join(dir, "code", "tutor", "models.json"), JSON.stringify({ "1926": m("1926", "lecture"), "2667": m("2667", "basic"), "1012": m("1012", "basic") }));
    const { tutorOverview, answer } = await import("./service.ts");
    const { searchKnowledge, getKnowledge } = await import("../../knowledge/api.ts");
    // A first action to get past the diagnosis.
    await answer({ kind: "drill", number: "1012", pattern: "components", mixed: true, choice: "정렬" });
    let o = await tutorOverview();
    const w = o.actions.find((a) => a.kind === "walkthrough")!;
    assert.equal(w.number, "1926");
    assert.ok(!JSON.stringify(w).includes('"answer"'), "the prediction's answer is not sent");
    assert.deepEqual(await answer({ kind: "walkthrough", number: "1926", pattern: "components", predict: "1\n1  \n" }), { ok: true, answer: "1\n1" }, "trailing spaces do not matter");
    o = await tutorOverview();
    const d = o.actions.find((a) => a.kind === "drill")!;
    assert.ok(d && !("approaches" in d), "the drill sends choices, not verdicts");
    const r = await answer({ kind: "drill", number: d.number, pattern: "components", mixed: false, choice: "BFS로 덩어리 세기" }) as { ok: boolean; grade: string };
    assert.equal(r.ok, true); assert.equal(r.grade, "새 문제를 혼자");
    const des = await answer({ kind: "design", number: "2667", pattern: "components", mixed: false, state: "방문 배열", complexity: "n" }) as { ok: boolean; cxOk: boolean; mine: string };
    assert.equal(des.ok, false); assert.equal(des.cxOk, false); assert.match(des.mine, /n = 500/);
    const hits = await searchKnowledge("덩어리 세기");
    const k = (await getKnowledge(hits[0].id)).item;
    assert.equal(k.title, "덩어리 세기");
    assert.ok(k.sources.some((s) => s.ref === "tutor:pattern:components"));
    o = await tutorOverview();
    const row = o.patterns.find((p) => p.id === "components")!;
    assert.equal(row.abilities.recognize.freshWins, 1); assert.equal(row.abilities.design.failStreak, 1);
  } finally {
    for (const [key, v] of [["STUDY_FORGE_DATA_DIR", prior.data], ["RECALLER_AFTER_SAVE", prior.after]] as const) { if (v === undefined) delete process.env[key]; else process.env[key] = v; }
    await rm(dir, { recursive: true, force: true });
  }
});
