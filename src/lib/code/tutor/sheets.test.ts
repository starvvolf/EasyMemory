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

test("총정리 확인(이야기 + 약점 상자): 상황·풀리는 법이 없으면 버리고, 약점이 없는 문단은 상자 없이, 설명은 문단·코드 블록을 살린다", async () => {
  const { checkReview } = await import("./sheets.ts");
  assert.equal(checkReview({ situation: "s", solve: "" }), null);
  const none = { kind: "none", title: "", state: "", lesson: "" };
  const weak = { kind: "syntax", title: " for 반복 ", state: "횟수를 안 정했어요", lesson: "for는 이래요.   \n\n\n```\nfor _ in range(3):\n    print(1)\n```" };
  const r = checkReview({ situation: " 상자 ", solve: "한 번에", story: [{ text: "처음엔", weak: none }, { text: "그다음", weak }, { text: "", weak }, ...Array.from({ length: 16 }, () => ({ text: "t", weak: none }))], next: "n" })!;
  assert.equal(r.v, 18);
  assert.equal(r.story[1].weak?.size, "small");
  assert.equal(r.story.length, 14);
  assert.equal(r.story[0].weak, undefined);
  assert.equal(r.story[1].weak?.title, "for 반복");
  assert.equal(r.story[1].weak?.lesson, "for는 이래요.\n\n```\nfor _ in range(3):\n    print(1)\n```");
});

test("총정리 글 출력: 표시로 잘라 같은 모양으로, 코드 블록 안의 # 줄은 표시로 안 봄, 약점 없는 문단은 상자 없음", async () => {
  const { parseReviewText, checkReview } = await import("./sheets.ts");
  const t = "# 문제 상황\n상황이에요.\n\n# 이렇게 해야 풀려요\n풀려요.\n\n# 이야기\n## 1\n처음엔 입력을 물었어요.\n[작은 약점] 입력받기\n상태: 문법을 몰랐어요.\n설명:\n이렇게 써요.\n```python\n# 주석\nn = int(input())\n```\n\n## 2\n그다음 BFS.\n\n# 다음에 떠올릴 것\n다음.";
  const r = checkReview(parseReviewText(t))!;
  assert.equal(r.situation, "상황이에요."); assert.equal(r.story.length, 2);
  assert.equal(r.story[0].weak?.title, "입력받기"); assert.equal(r.story[0].weak?.size, "small");
  assert.match(r.story[0].weak!.lesson, /# 주석\nn = int/); assert.equal(r.story[1].weak, undefined); assert.equal(r.next, "다음.");
});

test("총정리 글(v19) 확인: 머리글 둘이 있어야 하고 앞 군말·울타리는 뗀다", async () => {
  const { checkReviewText } = await import("./sheets.ts");
  const body = "# 학습 총평\n" + "가".repeat(120) + "\n\n# 핵심 학습 리뷰\n## 1. 대기줄 [핵심]\n" + "나".repeat(100);
  assert.equal(checkReviewText("```markdown\n" + body + "\n```"), body);
  assert.equal(checkReviewText("다음은 리뷰예요.\n\n" + body), body);
  assert.equal(checkReviewText("# 학습 총평\n짧음"), null);
});

test("리뷰에 넣는 제출 코드: 같은 코드는 빼고, 많으면 첫·판정 바뀐·마지막", async () => {
  const { pickSubmits } = await import("./sheets.ts");
  const sub = (i: number, verdict: string, code: string) => ({ id: `s${i}`, at: `2026-11-13T00:0${i}:00Z`, problemId: "p", lang: "python" as const, mode: "submit" as const, verdict, passed: 0, total: 1, hints: 0, code, ms: 1 });
  assert.deepEqual(pickSubmits([sub(1, "WA", "a"), sub(2, "WA", "a"), sub(3, "AC", "b")]).map((x) => x.id), ["s1", "s3"]);
  const many = [sub(1, "WA", "1"), sub(2, "WA", "2"), sub(3, "WA", "3"), sub(4, "TLE", "4"), sub(5, "TLE", "5"), sub(6, "TLE", "6"), sub(7, "WA", "7"), sub(8, "AC", "8")];
  assert.deepEqual(pickSubmits(many).map((x) => x.id), ["s1", "s4", "s7", "s8"]);
});
