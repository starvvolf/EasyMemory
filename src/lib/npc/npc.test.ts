// 가상 학습자(NPC): 명세 · 지도 재기 · 연출가(첫 실험 다섯 명) · 검사 · 가짜 AI · 채점 · 심기 · 앱 드라이버 한 판(가짜 AI). 파이썬을 실제로 돌린다, AI 0번.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dice, weighted } from "./dice.ts";
import { play } from "./director.ts";
import { dryTutorAnswer, emptyOf } from "./dry-ai.ts";
import { FIRST_EXPERIMENT } from "./experiment.ts";
import { PACK_2606 } from "./fixtures/p2606.ts";
import { allLearnedCheck, suspicion, syntaxLeaks, verdictOf } from "./guard.ts";
import { checkMapReply, measure, program, reviewTable, rightPicks, routeFor, picksFor, type MapReply } from "./map.ts";
import { MAP_2606 } from "./map2606.ts";
import { checkOption, dropNear } from "./maker.ts";
import { plants } from "./plant.ts";
import { buildSpec, conflicts, holdings, loadOptions, loadSpec, overlay, validated } from "./profile.ts";
import { fixAnswer, fragmentsIn, scoreGaps } from "./score.ts";
import type { OptionPatch, Played } from "./types.ts";
import { codeUser, dryVoice, keywordLearned } from "./voice.ts";
import { offlineDriver } from "./algo-driver.ts";
import { ALLOWED_COMMAND, inside } from "./practice-driver.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const TESTS = [...PACK_2606.examples, ...PACK_2606.tests];
const MAP = await measure(MAP_2606, TESTS, PACK_2606.timeLimitMs);
const BASE = await loadSpec(path.join(ROOT, "tools", "npc", "default.json"));
const OPTIONS = await loadOptions(path.join(ROOT, "tools", "npc", "options"));

test("명세: 뒤에 쓴 조각이 이기고, 숫자는 0~1로 자르고, 부딪침을 알려 준다", () => {
  const a: OptionPatch = { id: "a", label: "a", patch: { traits: { askEarly: 0.9 } } };
  const b: OptionPatch = { id: "b", label: "b", patch: { traits: { askEarly: 0.2, guess: 3 } } };
  const notes: string[] = [];
  const s = overlay(BASE, [a, b], notes);
  assert.equal(s.traits.askEarly, 0.2);
  assert.equal(s.traits.guess, 1, "범위 밖 숫자는 자름");
  assert.ok(notes.some((n) => n.includes("3 → 1")));
  assert.ok(conflicts([a, b]).some((c) => c.includes("traits.askEarly")));
  const built = buildSpec(BASE, OPTIONS, ["고수", "문법약함-py", "없는조각"]);
  assert.deepEqual(built.unknown, ["없는조각"]);
  assert.ok(built.conflicts.some((c) => c.includes("부딪쳐요")), "고수 + 문법약함은 실행 전에 알림");
  assert.ok(Object.keys(OPTIONS).length >= 15, "옵션 조각 15개쯤");
});

test("명세: 항목 이름은 지도 조각과 맞아야 하고, 잘못 앎은 믿음으로 틀린 조각을 찾고, 애매는 씨앗으로 정한다", () => {
  const s = overlay(BASE, [{ id: "x", label: "x", patch: { knows: { base: { 1: "애매" }, items: { "idea.mark-visited": { state: "잘못 앎", belief: "표시하지 않아도 언젠가 끝난다" }, "tool.qeue": { state: "모름" }, "frame.*": { state: "모름" } } } } }]);
  const v = validated(s, MAP);
  assert.deepEqual(v.dropped, ["tool.qeue"]);
  const h = holdings(v.spec, MAP, dice(7, "2606"));
  assert.equal(h.wrongs.get("idea.mark-visited"), "wrong.no-visited");
  assert.ok(h.holds.has("wrong.no-visited") && !h.holds.has("idea.mark-visited"));
  assert.ok(!h.holds.has("frame.bfs") && !h.holds.has("frame.dfs"), "무늬(frame.*)");
  assert.ok(h.vague.has("syntax.py.2d-list"));
  const again = holdings(v.spec, MAP, dice(7, "2606"));
  assert.deepEqual([...again.holds].sort(), [...h.holds].sort(), "같은 씨앗이면 같은 결과");
  assert.equal(weighted(0.99, [["a", 1], ["b", 0], ["c", 1]]), "c");
});

test("지도: 길의 판정을 채점기로 잰다 — A · B · C 맞음, D 틀림, E 시간 초과, 자리의 틀린 조각도 따로", () => {
  const v = Object.fromEntries(MAP.routes.map((r) => [r.id, r.measured!.verdict]));
  assert.deepEqual(v, { A: "AC", B: "AC", C: "AC", D: "WA", E: "TLE" });
  const a = MAP.routes.find((r) => r.id === "A")!;
  assert.equal(a.measured!.variants["init=wrong.alias-list"], "WA");
  assert.equal(a.measured!.variants["link=wrong.one-way"], "WA");
  assert.equal(a.measured!.variants["init=?"], "RE", "몰라서 지어 쓴 문법은 오류");
  assert.equal(allLearnedCheck(MAP).ok, true, "다 배운 뒤에는 맞아야 함(설계 5번의 4)");
  assert.match(reviewTable(MAP), /\| A\. BFS \|/);
});

test("지도: AI 답은 코드가 모양 검사(없는 조각 · 정의 안 된 자리는 버림)", () => {
  const raw: MapReply = { fragments: [
    { id: "idea.a", layer: 5, what: "생각 A", example: "x = 1", wrong: false, right: "", keys: ["A"], leak: [] },
    { id: "wrong.b", layer: 5, what: "틀린 B", example: "x = 2", wrong: true, right: "idea.a", keys: [], leak: [] },
    { id: "Bad Id", layer: 2, what: "?", example: "", wrong: false, right: "", keys: [], leak: [] }],
  routes: [{ id: "A", name: "좋은 길", needs: ["idea.a", "idea.zzz"], frame: "", prior: 0.5, expect: "AC", steps: [{ text: "출력", uses: ["idea.a"], code: "print({{v}})", guess: "" }],
    slots: [{ name: "v", right: "idea.a", unaware: "", alts: [{ fragment: "idea.a", code: "1" }, { fragment: "wrong.b", code: "2" }] }] },
  { id: "B", name: "자리 빠짐", needs: [], frame: "", prior: 0.1, expect: "WA", steps: [{ text: "x", uses: [], code: "print({{nope}})", guess: "" }], slots: [] }] };
  const m = checkMapReply("t", "시험", raw);
  assert.deepEqual(m.fragments.map((f) => f.id), ["idea.a", "wrong.b"]);
  assert.deepEqual(m.routes.map((r) => r.id), ["A"]);
  assert.deepEqual(m.routes[0].needs, ["idea.a"]);
  assert.equal(program(m.routes[0], { v: "wrong.b" }).trim(), "print(2)");
});

test("첫 실험(설계 8번, 가짜 AI): 다섯 명이 예상한 길로 가서 빠진 조각 자리에서 막히고, 배우고 맞힌다", async () => {
  const got: Record<string, Played> = {};
  for (const n of FIRST_EXPERIMENT) {
    const { spec } = buildSpec(BASE, OPTIONS, n.options, { id: n.id, name: n.name });
    got[n.id] = await play({ spec, map: MAP, problem: PACK_2606, voice: dryVoice(MAP), driver: offlineDriver(MAP, PACK_2606) });
  }
  const firstRoute = (p: Played) => (p.key.filter((k) => "route" in k && "why" in k).map((k) => (k as { route: string }).route).find((r) => r !== "-"));
  assert.equal(firstRoute(got.n1), "A"); assert.equal(got.n1.counts.submits, 1); assert.deepEqual(got.n1.missed, []);
  assert.equal(firstRoute(got.n2), "B"); assert.deepEqual(got.n2.missed, []);
  assert.equal(firstRoute(got.n3), "C", "돌아가는 길");
  assert.equal(firstRoute(got.n4), "E");
  assert.ok(got.n4.codes.some((c) => c.verdict === "TLE"), "표시 없이 → 시간 초과");
  assert.deepEqual(got.n4.missed, ["idea.mark-visited"]);
  assert.ok(got.n4.key.some((k) => "switched" in k && k.switched === "E→A"), "배우면 다시 계획");
  assert.equal(firstRoute(got.n5), "A");
  const stuck5 = got.n5.key.find((k) => "stuck" in k) as { stuck: string; layer: number };
  assert.equal(stuck5.stuck, "syntax.py.2d-list"); assert.equal(stuck5.layer, 1, "문법 자리에서 막힘");
  for (const p of Object.values(got)) assert.equal(p.end.verdict, "AC", `${p.spec.name}: 배우고 결국 맞힘`);
  // 같은 명세 + 같은 씨앗이면 같은 길 · 같은 막힘
  const { spec } = buildSpec(BASE, OPTIONS, FIRST_EXPERIMENT[3].options, { id: "n4", name: "④" });
  const again = await play({ spec, map: MAP, problem: PACK_2606, voice: dryVoice(MAP), driver: offlineDriver(MAP, PACK_2606) });
  assert.deepEqual(again.key, got.n4.key);
});

test("검사: 모르는 문법의 모양 · 의심(길보다 많이 김) · 문법 누수는 문법에만", () => {
  const unknown = MAP.fragments.filter((f) => f.id === "syntax.py.2d-list");
  assert.deepEqual(syntaxLeaks("adj = [[] for _ in range(n + 1)]", unknown), ["syntax.py.2d-list"]);
  assert.deepEqual(syntaxLeaks("# [[] for _ in range(n)]\nadj = []", unknown), [], "주석은 안 봄");
  const a = MAP.routes.find((r) => r.id === "A")!;
  assert.equal(suspicion(program(a, rightPicks(a)), a, rightPicks(a)), null);
  assert.match(suspicion(program(a, rightPicks(a)) + "for i in range(3):\n  for j in range(3):\n    pass\n", a, rightPicks(a)) ?? "", /반복/);
});

test("입과 손: 허용된 조각만 보내고 모범 풀이는 안 보낸다 · 가짜 배움 판정 · 가짜 튜터", () => {
  const a = MAP.routes.find((r) => r.id === "A")!;
  const allowed = MAP.fragments.filter((f) => ["shape.adj-list", "tool.queue"].includes(f.id));
  const u = codeUser({ problem: PACK_2606, mode: "strict", route: a, picks: rightPicks(a), allowed, previous: "", upto: 2 });
  assert.ok(u.includes("tool.queue") && !u.includes("idea.mark-visited"), "허용 안 된 조각은 안 감");
  assert.ok(!u.includes(PACK_2606.referenceJs.slice(0, 40)), "모범 풀이는 안 감");
  assert.match(u, /여기까지만/);
  assert.deepEqual(keywordLearned("방문한 곳은 표시해 두세요. deque로 꺼내요.", MAP.fragments).sort(), ["idea.mark-visited", "tool.queue"]);
  const e = MAP.routes.find((r) => r.id === "E")!;
  assert.match(dryTutorAnswer(MAP, "시간 초과가 나요", program(e, rightPicks(e))), /표시/);
  assert.deepEqual(emptyOf({ type: "object", properties: { a: { type: "array" }, b: { type: "string", enum: ["x", "y"] } } }), { a: [], b: "x" });
});

test("채점: 글 → 조각 맞추기 · 빈틈 놓침/헛짚음 · 고치기 장면 답(아는 자리만 고침)", async () => {
  assert.equal(fragmentsIn(MAP, "방문 표시로 다시 넣지 않기")[0].id, "idea.mark-visited");
  assert.equal(fragmentsIn(MAP, "빈 리스트를 따로 n+1개 만들기")[0].id, "syntax.py.2d-list");
  const played = { missed: ["idea.mark-visited"], used: ["tool.queue", "shape.adj-list"], slipCodes: ["SLIP"], codes: [], key: [] } as unknown as Played;
  const gap = (title: string, sub: string) => ({ id: title, title, missed: title, wrong: "", topic: "", kind: "알고리즘 원리", scope: "piece", evidence: [{ type: "submission", id: sub }] });
  const s = scoreGaps(MAP, played, [gap("방문 표시", "s1"), gap("deque 쓰기", "s2"), gap("오타", "s3")] as never, [{ id: "s3", code: "SLIP" }], "ai");
  assert.deepEqual(s.hits, ["idea.mark-visited"]); assert.deepEqual(s.falseAlarms, ["tool.queue"]); assert.deepEqual(s.slipAsUnknown, ["오타"]);
  const a = MAP.routes.find((r) => r.id === "A")!;
  const wrongCode = program(a, { ...rightPicks(a), init: "wrong.alias-list" });
  const before = new Set(["shape.adj-list", "idea.undirected", "tool.queue", "idea.mark-visited", "frame.bfs", "idea.reach-all", "syntax.py.read-input"]);
  assert.equal(fixAnswer(MAP, wrongCode, before), wrongCode, "모르면 못 고침");
  assert.equal((await verdictOf(fixAnswer(MAP, wrongCode, new Set([...before, "syntax.py.2d-list"])), TESTS, 1000)).verdict, "AC", "배우면 그 자리만 고침");
  const r = routeFor(MAP, new Set([...before, "syntax.py.2d-list"]), "A")!;
  assert.equal(r.id, "A"); assert.equal(picksFor(r, new Set(before)).init, "?");
});

test("심기 모드: 맞는 길마다 자리의 틀린 조각 하나씩 + 틀린 길", () => {
  const ps = plants(MAP);
  assert.ok(ps.some((p) => p.id === "A.init=wrong.alias-list"));
  assert.ok(ps.some((p) => p.wrong === "wrong.no-visited"));
  assert.ok(ps.every((p) => p.planted !== p.fixed));
});

test("옵션 만들기: 모르는 이름은 버리고 숫자는 자르고, 너무 비슷한 것은 거른다", () => {
  const r = checkOption({ id: "복붙 2학년", label: "x", group: "성격", base: [{ layer: "1", state: "모름" }, { layer: "9", state: "앎" }], items: [{ name: "tool.qeue", state: "모름", belief: "" }, { name: "tool.queue", state: "모름", belief: "" }],
    traits: [{ name: "copyTutor", value: 1.4 }, { name: "patience", value: 300 }], learning: [] }, MAP);
  assert.equal(r.option.id, "복붙2학년");
  assert.deepEqual(r.option.patch.knows, { base: { 1: "모름" }, items: { "tool.queue": { state: "모름" } } });
  assert.deepEqual(r.option.patch.traits, { copyTutor: 1, patience: 100 });
  const near = dropNear([{ id: "a", label: "", patch: { traits: { askEarly: 0.9 } } }, { id: "b", label: "", patch: { traits: { askEarly: 0.85 } } }, { id: "c", label: "", patch: { traits: { askEarly: 0.1 }, knows: { base: { 1: "모름" } } } }]);
  assert.deepEqual(near.kept.map((k) => k.id), ["a", "c"]);
});

test("실습 손: 작업 폴더 밖 · 숨은 폴더 · 다른 명령은 막는다", () => {
  const root = path.resolve("/tmp/npc-ws");
  assert.throws(() => inside(root, "../x.js"));
  assert.throws(() => inside(root, ".git/config"));
  assert.equal(inside(root, "a/b.js"), path.join(root, "a", "b.js"));
  assert.ok(ALLOWED_COMMAND.test("node test.js") && !ALLOWED_COMMAND.test("rm -rf /") && !ALLOWED_COMMAND.test("node test.js; rm x"));
});

test("앱 드라이버 한 판(가짜 AI): 진짜 제출 · 튜터 대화 · 도움 칸 · 문제 한 장 · 빈틈 뽑기까지 NPC 데이터 폴더 안에서", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "npc-test-"));
  const prior = { data: process.env.STUDY_FORGE_DATA_DIR, provider: process.env.STUDY_FORGE_MODEL_PROVIDER, after: process.env.RECALLER_AFTER_SAVE };
  process.env.STUDY_FORGE_MODEL_PROVIDER = "fake";
  try {
    const { runNpc } = await import("./run-npc.ts");
    const { writeFile } = await import("node:fs/promises");
    const mapFile = path.join(dir, "map.json");
    await writeFile(mapFile, JSON.stringify(MAP));
    // ⑤(틀린 답 WA로 끝나는 길)로 본다: ④는 시간 초과 코드라 장면 검사 · 채점이 몇 분 걸린다(상황 재현 쪽 실행 시간)
    const { spec } = buildSpec(BASE, OPTIONS, ["2차원문법없음"], { id: "n5", name: "⑤" });
    const s = await runNpc({ name: "⑤", spec, mapFile, packModule: path.join(import.meta.dirname, "fixtures", "p2606.ts"), dataDir: path.join(dir, "npc-data"), outDir: path.join(dir, "out"), dry: true, mode: "strict" });
    assert.equal(s.played.end.verdict, "AC");
    const subs = (await readFile(path.join(dir, "npc-data", "code", "submissions.jsonl"), "utf8")).trim().split("\n");
    assert.ok(subs.length >= 2, "제출이 앱 기록에 남음");
    const talk = (await readFile(path.join(dir, "npc-data", "code", "tutor", "talk.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(talk.some((t) => t.kind === "질문" && /빈 목록/.test(t.a)), "가짜 튜터가 빈 목록 문법을 짚음");
    assert.ok(s.scenes.some((x) => x.made && x.before?.verdict === "same" && x.after?.verdict === "pass"), "장면: 배우기 전엔 같은 실수, 뒤엔 통과");
    assert.match(await readFile(path.join(dir, "out", "report.md"), "utf8"), /### 정답지/);
  } finally {
    for (const [k, v] of Object.entries({ STUDY_FORGE_DATA_DIR: prior.data, STUDY_FORGE_MODEL_PROVIDER: prior.provider, RECALLER_AFTER_SAVE: prior.after })) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await rm(dir, { recursive: true, force: true });
  }
});
