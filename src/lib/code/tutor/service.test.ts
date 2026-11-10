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
    assert.equal(r.ok, true); assert.equal(r.grade, "처음 보는 문제를 혼자 맞힘");
    const slow = await answer({ kind: "drill", number: "2667", pattern: "components", mixed: true, choice: "모든 쌍 비교" }) as { ok: boolean };
    assert.equal(slow.ok, false, "a slow approach is not a recognition");
    const des = await answer({ kind: "design", number: "2667", pattern: "components", mixed: false, state: "방문 배열", complexity: "n" }) as { ok: boolean; cxOk: boolean; mine: string };
    assert.equal(des.ok, false); assert.equal(des.cxOk, false); assert.match(des.mine, /n = 500/);
    const hits = await searchKnowledge("덩어리 세기");
    const k = (await getKnowledge(hits[0].id)).item;
    assert.equal(k.title, "덩어리 세기");
    assert.ok(k.sources.some((s) => s.ref === "tutor:pattern:components"));
    o = await tutorOverview();
    const row = o.patterns.find((p) => p.id === "components")!;
    assert.equal(row.abilities.recognize.freshWins, 1); assert.equal(row.abilities.recognize.failStreak, 1); assert.equal(row.abilities.design.failStreak, 1);
  } finally {
    for (const [key, v] of [["STUDY_FORGE_DATA_DIR", prior.data], ["RECALLER_AFTER_SAVE", prior.after]] as const) { if (v === undefined) delete process.env[key]; else process.env[key] = v; }
    await rm(dir, { recursive: true, force: true });
  }
});

test("기억 규칙: 혼자 맞힘·시범 보기만으로는 기억이 생기지 않고, 몰랐던 게 드러나 배운 것만 몰랐음으로 생긴다", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tutor-mem-"));
  const prior = { data: process.env.STUDY_FORGE_DATA_DIR, after: process.env.RECALLER_AFTER_SAVE };
  process.env.STUDY_FORGE_DATA_DIR = dir; process.env.RECALLER_AFTER_SAVE = "off";
  try {
    const m = (number: string, patterns: string[]) => ({ number, title: `문제 ${number}`, chapter: "0x09", role: "basic", url: "u", statement: "s", inputText: "i", outputText: "o", summary: "요약",
      maxN: null, patterns, signals: ["같은 칸에 여러 길"], approaches: [{ name: "방문 표시하며 BFS", verdict: "best", why: "중복 방지" }, { name: "표시 없이 BFS", verdict: "wrong", why: "무한히 돈다" }, { name: "정렬", verdict: "wrong", why: "" }],
      state: { right: "방문 배열", wrong: ["합계", "포인터"] }, update: "넣을 때 표시", complexity: "n", pitfalls: ["꺼낼 때 표시"], walkthrough: { observe: "o", choose: "넣을 때 표시한다", compare: "x", verify: "v" },
      predict: { question: "q", input: "1", answer: "3" }, at: "" });
    await mkdir(path.join(dir, "code", "tutor"), { recursive: true });
    await writeFile(path.join(dir, "code", "tutor", "models.json"), JSON.stringify({ "7562": m("7562", ["visited"]), "2178": m("2178", ["bfs-distance"]), "1697": m("1697", ["multi-source"]) }));
    const { answer, noteAiHelp } = await import("./service.ts");
    const { searchKnowledge, getKnowledge, memoryEvents } = await import("../../knowledge/api.ts");
    const find = async (title: string) => (await searchKnowledge(title)).find((h) => h.title === title);

    await answer({ kind: "drill", number: "7562", pattern: "visited", mixed: false, choice: "방문 표시하며 BFS" });
    await answer({ kind: "walkthrough", number: "2178", pattern: "bfs-distance" });
    assert.equal(await find("방문 표시"), undefined, "solved alone: nothing new to remember");
    assert.equal(await find("거리 배열 BFS"), undefined, "only watched: not a memory");

    await answer({ kind: "walkthrough", number: "2178", pattern: "bfs-distance", predict: "" });
    const dist = (await getKnowledge((await find("거리 배열 BFS"))!.id)).item;
    assert.equal(dist.state, "unknown");
    const e = (await memoryEvents({ knowledgeId: dist.id })).events.find((x) => x.kind === "wrong")!;
    assert.match(e.detail, /답은 「3」/, "what was learned is written down");

    // AI가 한 말은 AI 1번(가짜 모델)으로 카드가 되고, 원문은 카드에 함께 남는다.
    const { setFakeModelResponder } = await import("../../ai/model.ts");
    process.env.STUDY_FORGE_MODEL_PROVIDER = "fake";
    setFakeModelResponder(() => JSON.stringify({ gap: "시작점이 여럿이면 따로 돌려야 한다고 생각했다", fix: "시작점을 처음에 모두 큐에 넣고 한 번에 퍼뜨린다", cue: "여러 곳에서 동시에 번진다" }));
    try {
      await noteAiHelp("cp_boj_1697", "AI 힌트 2단계", "시작점을 모두 큐에 먼저 넣고 동시에 퍼뜨려 보세요.");
      setFakeModelResponder(() => JSON.stringify({ gap: "", fix: "", cue: "" }));
      await noteAiHelp("cp_boj_7562", "AI 힌트 1단계", "좋아요, 거의 다 왔어요!");
    } finally { setFakeModelResponder(null); delete process.env.STUDY_FORGE_MODEL_PROVIDER; }
    assert.equal(await find("방문 표시"), undefined, "a hint with nothing to learn (cheering only) is not a memory");
    const multi = (await getKnowledge((await find("시작점 여러 개 BFS"))!.id)).item;
    assert.equal(multi.stats.hint, 1);
    assert.match((await memoryEvents({ knowledgeId: multi.id, kinds: ["hint"] })).events[0].detail, /그때 내 생각: 시작점이 여럿이면 .* 이렇게 하면 돼요: 시작점을 처음에 모두/);
    const { readLessons } = await import("./lessons.ts");
    const card = (await readLessons()).find((l) => l.kind === "hint")!;
    assert.equal(card.refined, "ai"); assert.match(card.raw!, /동시에 퍼뜨려/);
    await noteAiHelp("cp_seed_pair_sum", "AI 힌트 1단계", "x");
    assert.equal(await find("투 포인터"), undefined, "a problem outside the tutor leaves memory alone");

    // A pattern already a memory: solving it alone later moves it on.
    await answer({ kind: "drill", number: "2178", pattern: "bfs-distance", mixed: true, choice: "방문 표시하며 BFS" });
    assert.equal((await getKnowledge(dist.id)).item.stats.correct, 1);
  } finally {
    for (const [key, v] of [["STUDY_FORGE_DATA_DIR", prior.data], ["RECALLER_AFTER_SAVE", prior.after]] as const) { if (v === undefined) delete process.env[key]; else process.env[key] = v; }
    await rm(dir, { recursive: true, force: true });
  }
});

test("방법 고르기 개념 보기(11/10): 보기는 개념 이름, 틀리면 그 짝의 설명이 카드가 되고, 둘 다 되는 개념은 맞음", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tutor-concept-"));
  const prior = { data: process.env.STUDY_FORGE_DATA_DIR, after: process.env.RECALLER_AFTER_SAVE };
  process.env.STUDY_FORGE_DATA_DIR = dir; process.env.RECALLER_AFTER_SAVE = "off";
  try {
    const m = (number: string, patterns: string[]) => ({ number, title: `문제 ${number}`, chapter: "0x09", role: "basic", url: "u", statement: "s", inputText: "i", outputText: "o", summary: "요약",
      maxN: 100, patterns, signals: ["가장 짧은"], approaches: [{ name: "BFS로 거리 적기", verdict: "best", why: "w" }, { name: "DFS", verdict: "slow", why: "w" }, { name: "정렬", verdict: "wrong", why: "w" }],
      state: { right: "거리", wrong: ["합", "칸"] }, update: "u", complexity: "n", pitfalls: [], walkthrough: { observe: "o", choose: "c", compare: "x", verify: "v" }, at: "" });
    await mkdir(path.join(dir, "code", "tutor"), { recursive: true });
    await writeFile(path.join(dir, "code", "tutor", "models.json"), JSON.stringify({ "2178": m("2178", ["bfs-distance", "grid-dxdy"]), "1012": m("1012", ["components"]) }));
    const { answer } = await import("./service.ts");
    const { readLessons } = await import("./lessons.ts");
    const wrong = await answer({ kind: "drill", number: "2178", pattern: "bfs-distance", mixed: false, choice: "DFS" }) as { ok: boolean; answer: string; why: string };
    assert.equal(wrong.ok, false); assert.equal(wrong.answer, "BFS"); assert.match(wrong.why, /가장 짧은 거리를 물으면 BFS/);
    const card = (await readLessons()).at(-1)!;
    assert.equal(card.pattern, "bfs-distance", "only the pattern being asked, not 격자 사방 탐색");
    assert.match(card.gap, /「DFS」 쓰면 될 줄 알았어요/); assert.match(card.fix, /정답은 「BFS」/);
    // 둘 다 되는 문제(덩어리 세기)는 보기에 둘 다 나오고, 둘 다 골라야 맞음(11/10 사용자). 보통은 무엇인지도 짚는다.
    const { conceptOptions } = await import("./concepts.ts");
    const shown = conceptOptions(["components", "components"], "drill:1012:components:c", { withAlso: true })!;
    assert.equal(shown.answers.length, 2); assert.equal(shown.options.length, 5);
    const half = await answer({ kind: "drill", number: "1012", pattern: "components", mixed: false, choice: "BFS", choices: ["BFS"] }) as { ok: boolean; missed: string[] };
    assert.equal(half.ok, false, "only one of the two: not yet"); assert.deepEqual(half.missed, shown.answers.filter((n) => n !== "BFS"));
    const both = await answer({ kind: "drill", number: "1012", pattern: "components", mixed: false, choice: shown.answers.join(", "), choices: shown.answers }) as { ok: boolean; usually: string };
    assert.equal(both.ok, true); assert.match(both.usually, /보통은 BFS/);
  } finally {
    for (const [key, v] of [["STUDY_FORGE_DATA_DIR", prior.data], ["RECALLER_AFTER_SAVE", prior.after]] as const) { if (v === undefined) delete process.env[key]; else process.env[key] = v; }
    await rm(dir, { recursive: true, force: true });
  }
});

test("설문(11/11): 처음엔 설문부터, 저장하면 알아요는 확인 문제로, 모르겠어요는 틀림으로 남고 한 칸 내림, 분야 집중", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tutor-survey-"));
  const prior = { data: process.env.STUDY_FORGE_DATA_DIR, after: process.env.RECALLER_AFTER_SAVE };
  process.env.STUDY_FORGE_DATA_DIR = dir; process.env.RECALLER_AFTER_SAVE = "off";
  try {
    const m = (number: string, patterns: string[]) => ({ number, title: `문제 ${number}`, chapter: "0x05", role: "basic", url: "u", statement: "s", inputText: "i", outputText: "o", summary: "괄호 짝",
      maxN: 500, patterns, signals: ["괄호"], approaches: [{ name: "스택", verdict: "best", why: "w" }, { name: "정렬", verdict: "wrong", why: "w" }, { name: "모든 쌍", verdict: "slow", why: "w" }],
      state: { right: "스택", wrong: ["합계", "정렬된 배열"] }, update: "u", complexity: "n", pitfalls: [], walkthrough: { observe: "o", choose: "c", compare: "x", verify: "v" }, at: "" });
    await mkdir(path.join(dir, "code", "tutor"), { recursive: true });
    await writeFile(path.join(dir, "code", "tutor", "models.json"), JSON.stringify({ "9012": m("9012", ["stack-match"]), "4949": m("4949", ["stack-match"]), "10845": m("10845", ["queue-sim"]), "2164": m("2164", ["queue-sim"]) }));
    const { tutorOverview, answer, setProfile } = await import("./service.ts");
    let o = await tutorOverview();
    assert.equal(o.survey.needed, true); assert.equal(o.actions.length, 0, "no diagnosis drills before the survey");
    assert.equal(o.survey.patterns.length, 44);
    await setProfile({ op: "survey", levels: { "stack-match": "know", "없는패턴": "good" } });
    o = await tutorOverview();
    const c = o.actions[0];
    assert.ok(c.check && c.pattern === "stack-match" && c.kind === "drill");
    const r = await answer({ kind: "drill", number: c.number, pattern: "stack-match", mixed: true, choice: "", dunno: true }) as { ok: boolean; dunno: boolean };
    assert.equal(r.ok, false); assert.equal(r.dunno, true);
    o = await tutorOverview();
    const row = o.survey.patterns.find((p) => p.id === "stack-match")!;
    assert.equal(row.checked, "fail"); assert.equal(row.now, "none", "알아요 + 모르겠어요 → 모름");
    assert.ok(!o.survey.patterns.some((p) => p.id === "없는패턴"));
    const { readLessons } = await import("./lessons.ts");
    assert.ok((await readLessons()).some((l) => l.gap.includes("떠올리지 못했어요")), "모르겠어요 leaves a card");
    await setProfile({ op: "focus", patterns: ["queue-sim"] });
    o = await tutorOverview();
    assert.equal(o.learning.focused, true);
    assert.ok(o.actions.filter((a) => !a.why.includes("다시 볼 날")).every((a) => a.pattern === "queue-sim"));
    await setProfile({ op: "unfocus" });
    assert.equal((await tutorOverview()).learning.focused, false);
  } finally {
    process.env.STUDY_FORGE_DATA_DIR = prior.data; process.env.RECALLER_AFTER_SAVE = prior.after;
    await rm(dir, { recursive: true, force: true });
  }
});
