import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDistill, needsDistill, sheetFacts, type Sheet } from "./sheets.ts";
import { computeMemory, memoryText, rowLine } from "./memory.ts";
import type { Submission } from "../problems.ts";
import type { TutorEvent } from "./state.ts";
import type { Lesson } from "./lessons.ts";

const sub = (at: string, verdict: string, mode: "submit" | "example" = "submit", hints = 0): Submission =>
  ({ id: at, at, problemId: "cp_a", lang: "python", mode, verdict, passed: 0, total: 1, hints, code: "x", ms: 1 });

test("문제 한 장: 결과·도움·틀린 종류·횟수·시간은 코드가 채운다", () => {
  const f = sheetFacts({ problemId: "cp_a", title: "BOJ 2178번: 미로", number: "2178", patterns: ["bfs-distance"], end: "solved", since: "2026-11-11T10:00:00.000Z", now: new Date("2026-11-11T10:20:00.000Z"),
    attempt: { startedAt: "2026-11-11T10:00:00.000Z", lastAt: "x", events: [{ at: "a", kind: "asked", detail: "왜 틀려요?", answer: "방문 표시를" }, { at: "b", kind: "wrong", detail: "틀린 답" }] },
    subs: [sub("2026-11-11T09:00:00.000Z", "WA"), sub("2026-11-11T10:05:00.000Z", "AC", "example"), sub("2026-11-11T10:06:00.000Z", "WA"), sub("2026-11-11T10:07:00.000Z", "TLE"), sub("2026-11-11T10:15:00.000Z", "AC")],
    helpRungs: [1, 2] });
  assert.equal(f.submits, 3, "앞 풀이의 제출은 세지 않는다");
  assert.deepEqual(f.verdicts, { WA: 1, TLE: 1 });
  assert.equal(f.examples, 1); assert.equal(f.help, 2); assert.equal(f.asked, 1); assert.equal(f.minutes, 20);
  assert.equal(f.step, "알4"); assert.deepEqual(f.tags, ["bfs-distance"]);
  assert.ok(needsDistill(f, undefined));
});

test("AI 칸 확인: 다섯 중 하나만, 코드 조각은 빼고, 혼자 한 번에 맞히면 비움", () => {
  const base = { help: 1, verdicts: {}, end: "solved", tags: ["bfs-distance"] } as unknown as Omit<Sheet, "distill">;
  assert.deepEqual(checkDistill({ stuck: "edge", gap: "  꺼낼 때 방문 표시하면 될 줄 알았어요 ", fix: "넣을 때 표시해요", learned: "", pattern: "bfs-distance" }, base),
    { stuck: "edge", gap: "꺼낼 때 방문 표시하면 될 줄 알았어요", fix: "넣을 때 표시해요", pattern: "bfs-distance" });
  assert.deepEqual(checkDistill({ stuck: "weird", gap: "for (i=0;;) {", fix: "x", pattern: "nope" }, base), { fix: "x" });
  assert.deepEqual(checkDistill({ stuck: "edge", gap: "g", fix: "f" }, { ...base, help: 0 }), {}, "혼자 한 번에 맞힘");
});

test("학습자 기억: 태그 한 줄씩, 고른 패턴만, 틀린 종류·최근", () => {
  const ev = (o: Partial<TutorEvent>): TutorEvent => ({ id: "e", at: "2026-11-10T00:00:00.000Z", kind: "implement", number: "2178", patterns: ["bfs-distance"], ability: "execute", ok: true, grade: 1, ...o });
  const events = [ev({ hinted: true, help: 3 }), ev({ number: "2606", at: "2026-11-11T00:00:00.000Z", patterns: ["components"], grade: 3 })];
  const lessons = [{ id: "l", at: "2026-11-10T00:00:01.000Z", pattern: "bfs-distance", number: "2178", title: "미로", kind: "implement", situation: "s", gap: "꺼낼 때 표시하면 될 줄", fix: "넣을 때", cue: "" }] as Lesson[];
  const sheets = [{ id: "s1", at: "2026-11-10T00:00:02.000Z", problemId: "cp_a", number: "2178", title: "미로", tags: ["bfs-distance"], end: "solved", help: 3, aiHints: 0, asked: 1, submits: 2, verdicts: { WA: 1 }, examples: 0, minutes: 9, stuck: "edge", distill: "done" }] as Sheet[];
  const m = computeMemory(events, lessons, sheets, [sub("a", "WA"), sub("b", "TLE"), sub("c", "WA"), sub("d", "AC")]);
  const bfs = m.rows.find((r) => r.tag === "bfs-distance")!;
  assert.equal(rowLine(bfs), '#bfs-distance 거리 배열 BFS [알4] 알· 계· 짜△ · 혼자0 도움1 · 막힘:경계·예외 · 착각:"꺼낼 때 표시하면 될 줄"(2178)');
  assert.deepEqual(m.errors, { WA: 2, TLE: 1 });
  assert.deepEqual(m.recent, ["2178 도움3"]);
  const t = memoryText(m, { patterns: ["components"], withErrors: true, withRecent: true });
  assert.match(t, /^#components/); assert.doesNotMatch(t, /bfs-distance/); assert.match(t, /#틀린종류 틀린 답 2 · 시간 초과 1/); assert.match(t, /#최근 2178 도움3/);
});

test("총정리 확인(이야기): 상황·풀리는 법이 없으면 버리고, 마디는 한 일·빈틈이 있어야 하고 여섯까지, 공부 상자의 예는 줄을 살린다", async () => {
  const { checkReview } = await import("./sheets.ts");
  assert.equal(checkReview({ situation: "s", solve: "" }), null);
  const beat = (gap: string, did = "힌트를 열어 봤어요") => ({ kind: "core", did, truth: "사실은 이래요", gap, box: { title: "시작점 여러 개 BFS", points: ["a", "", "b"], example: "```\n1 0 0\n0 0 1   \n```" } });
  const r = checkReview({ situation: " 상자 ", solve: "한 번에", story: [beat("g1"), beat("g2", ""), beat("혼자 했는지 확인되지 않았어요"), beat("g3"), beat("g4"), beat("g5"), beat("g6"), beat("g7"), ...Array.from({ length: 8 }, (_, i) => beat(`h${i}`))], next: "n" })!;
  assert.equal(r.v, 12);
  assert.equal(r.story.length, 14); assert.equal(r.story[0].kind, "idea"); assert.deepEqual(r.story.slice(0, 6).map((x) => x.gap), ["g1", "g3", "g4", "g5", "g6", "g7"]);
  assert.equal(r.story[0].truth, "이래요");
  assert.deepEqual(r.story[0].box.points, ["a", "b"]);
  assert.equal(r.story[0].box.example, "1 0 0\n0 0 1");
});
