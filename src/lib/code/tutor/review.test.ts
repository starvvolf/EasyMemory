import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { journalOf } from "./journal.ts";
import { parsePsId, psId } from "./review.ts";
import type { Lesson } from "./lessons.ts";
import type { TutorEvent } from "./state.ts";

const model = (number: string, predict = "3") => ({ number, title: `문제 ${number}`, chapter: "0x09", role: "basic", url: "u", statement: "s", inputText: "i", outputText: "o", summary: `요약 ${number}`,
  maxN: 100, patterns: ["multi-source"], signals: ["여러 곳에서 번진다"], approaches: [{ name: "큐에 모두 넣고 BFS", verdict: "best", why: "w" }, { name: "시작점마다 BFS", verdict: "slow", why: "느림" }],
  state: { right: "거리 배열", wrong: ["합계", "포인터"] }, update: "꺼낸 칸의 거리 + 1", complexity: "n", pitfalls: ["익지 않은 칸 확인"],
  walkthrough: { observe: "o", choose: "c", compare: "x", verify: "v" }, predict: { question: "출력은?", input: "2 2", answer: predict }, at: "" });

test("질문 id는 채점 때 튜터 기록으로 되돌아갈 수 있다", () => {
  assert.deepEqual(parsePsId(psId("recognize", "7576", "multi-source", "abc")), { kind: "recognize", number: "7576", pattern: "multi-source" });
  assert.equal(parsePsId("q:abc"), null);
});

test("PS 기억 복습: 배운 직후엔 내 실수, 다음엔 처음 보는 문제 알아보기, 출력 예측은 한 토큰 답만", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tutor-review-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try {
    const t = path.join(dir, "code", "tutor");
    await mkdir(t, { recursive: true });
    await writeFile(path.join(t, "models.json"), JSON.stringify({ "7576": model("7576", "8\n-1"), "7569": model("7569", "4"), "4179": model("4179", "2 3") }));
    const ev = (at: string, number: string, detail?: string): TutorEvent => ({ id: at, at, kind: "drill", number, patterns: ["multi-source"], ability: "recognize", ok: false, grade: 3, detail });
    await writeFile(path.join(t, "events.jsonl"), [ev("2026-11-08T01:00:00Z", "7576"), ev("2026-11-08T01:01:00Z", "7569")].map((e) => JSON.stringify(e)).join("\n") + "\n");
    const lesson: Lesson = { id: "l1", at: "2026-11-08T01:00:00Z", pattern: "multi-source", number: "7576", title: "토마토", kind: "drill", situation: "BOJ 7576 토마토에서 「시작점마다 BFS」를 고름",
      gap: "시작점마다 따로 돌리면 느림", fix: "시작점을 처음에 모두 큐에 넣는다", cue: "여러 곳에서 번진다", refined: "code" };
    await writeFile(path.join(t, "lessons.jsonl"), JSON.stringify(lesson) + "\n");
    const { psQuestions } = await import("./review.ts");
    const item = { id: "k1", title: "시작점 여러 개 BFS", sources: [{ ref: "tutor:pattern:multi-source" }], review: { repetitions: 5 } };
    let qs = await psQuestions(item, "s");
    assert.equal(qs[0].label, "내 실수 다시 보기", "right after learning: my own mistake first, whatever the store's repetition count");
    assert.ok(qs[0].prompt.includes(lesson.situation) && qs[0].options!.includes(lesson.fix) && qs[0].answer === lesson.fix);
    const rec = qs.find((q) => q.label === "알아보기")!;
    assert.equal(parsePsId(rec.id)!.number, "4179", "recognize asks about the problem seen least recently (never seen)");
    assert.ok(!rec.options!.includes("시작점 여러 개 BFS") || rec.answer === "시작점 여러 개 BFS");
    assert.equal(rec.options!.length, 4); assert.equal(new Set(rec.options).size, 4);
    const pred = qs.find((q) => q.label === "출력 예측")!;
    assert.equal(pred.answer, "4", "only a one-token answer is asked as a short answer");
    assert.ok(!qs.some((q) => q.answer.includes("\n")));

    await writeFile(path.join(t, "events.jsonl"), JSON.stringify(ev("2026-11-08T02:00:00Z", "7576", "기억 복습(내 실수 다시 보기): x")) + "\n", { flag: "a" });
    qs = await psQuestions(item, "s");
    assert.equal(qs[0].label, "알아보기", "the second review moves to a new problem (transfer)");

    const { recordPsReview } = await import("./service.ts");
    const { readEvents } = await import("./state.ts");
    await recordPsReview(rec.id, true, "시작점 여러 개 BFS");
    await recordPsReview(psId("mistake", "7576", "multi-source", "s"), false, "x");
    const last = (await readEvents()).slice(-2);
    assert.deepEqual(last.map((e) => [e.kind, e.ability, e.ok, e.mixed]), [["drill", "recognize", true, true], ["review", undefined, false, undefined]]);
    assert.equal(last[0].grade, 4, "a new problem with the chapter hidden, solved alone");
  } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
});

test("학습 관찰일지: 사건에 그 순간의 카드가 붙고, AI 힌트는 패턴이 여럿이어도 한 줄", () => {
  const e = (at: string, kind: TutorEvent["kind"], extra: Partial<TutorEvent> = {}): TutorEvent => ({ id: at, at, kind, number: "7576", patterns: ["multi-source", "bfs-distance"], grade: 0, ...extra });
  const l = (at: string, kind: Lesson["kind"], pattern: string): Lesson => ({ id: `${at}${pattern}`, at, pattern, number: "7576", title: "토마토", kind, situation: "s", gap: "g", fix: "f", cue: "c", distinguish: "d", refined: kind === "hint" ? "ai" : "code" });
  const events = [e("2026-11-08T01:00:00.000Z", "walkthrough"), e("2026-11-08T01:01:00.000Z", "drill", { ability: "recognize", ok: false, grade: 3 }), e("2026-11-08T01:02:00.000Z", "drill", { ability: "recognize", ok: true, grade: 4, mixed: true })];
  const lessons = [l("2026-11-08T01:01:00.500Z", "drill", "multi-source"), l("2026-11-08T01:01:00.600Z", "drill", "bfs-distance"), l("2026-11-08T01:05:00.100Z", "hint", "multi-source"), l("2026-11-08T01:05:00.200Z", "hint", "bfs-distance")];
  const j = journalOf(events, lessons, { "7576": "토마토" });
  assert.deepEqual(j.map((x) => x.result), ["learned", "alone", "learned", "seen"]);
  assert.equal(j[0].what, "AI 힌트");
  assert.equal(j[2].lesson?.distinguish, "d");
  assert.equal(j[1].lesson, undefined, "solved alone: no card");
  assert.match(j[1].text, /섞인 새 문제를 혼자 \(단원 숨김\)/);
});

test("기억 요약(11/10): 어디서 막혔나 한마디, 흐름 한 줄, 마지막으로 잘못 생각한 것과 이제 기억할 것", async () => {
  const { summarize } = await import("./summary.ts");
  const e = (at: string, kind: TutorEvent["kind"], extra: Partial<TutorEvent> = {}): TutorEvent => ({ id: at, at, kind, number: "7576", patterns: ["multi-source"], grade: 3, ...extra });
  const events = [e("2026-11-10T01:00:00Z", "walkthrough"), e("2026-11-10T01:01:00Z", "predict", { ok: false }),
    e("2026-11-10T01:02:00Z", "drill", { ability: "recognize", ok: false }), e("2026-11-10T01:03:00Z", "drill", { ability: "recognize", ok: true }),
    e("2026-11-10T01:04:00Z", "design", { ability: "design", ok: false })];
  const lessons: Lesson[] = [{ id: "l", at: "2026-11-10T01:04:00.5Z", pattern: "multi-source", number: "7576", title: "토마토", kind: "design", situation: "s",
    gap: "기억할 상태를 「합계」로 생각함", fix: "꺼낸 칸의 날짜 + 1", cue: "여러 곳에서 동시에", refined: "code" },
    { id: "h", at: "2026-11-10T01:05:00Z", pattern: "multi-source", number: "7576", title: "토마토", kind: "hint", situation: "s", gap: "", fix: "f", cue: "", refined: "ai" }];
  const s = summarize("multi-source", events, lessons);
  assert.equal(s.stage, "무엇을 기억하며 풀지 정하는 데서 막혔어요");
  assert.deepEqual(s.flow, ["풀이 과정 봄", "결과 맞히기 틀림", "방법 알아채기 2번 중 1번 맞힘", "계획 세우기 틀림", "AI에게 힌트 받음"]);
  assert.deepEqual(s.marks, { recognize: "ok", design: "bad", execute: "none" });
  assert.equal(s.wrong, "기억할 상태를 「합계」로 생각함"); assert.equal(s.remember, "꺼낸 칸의 날짜 + 1"); assert.equal(s.where, "BOJ 7576 토마토");
});

test("해결된 착각(11/10): 그 뒤 같은 능력으로 다른 문제를 혼자 맞히면 해결됨, 지우지 않고 표시만", async () => {
  const { summarize, isResolved } = await import("./summary.ts");
  const card: Lesson = { id: "c", at: "2026-11-10T01:00:00Z", pattern: "multi-source", number: "7576", title: "토마토", kind: "design", situation: "s", gap: "「합계」만 기억하면 될 줄 알았어요", fix: "날짜 배열", cue: "", refined: "code" };
  const e = (at: string, number: string, extra: Partial<TutorEvent>): TutorEvent => ({ id: at, at, kind: "design", number, patterns: ["multi-source"], ability: "design", grade: 3, ...extra });
  assert.equal(isResolved(card, [e("2026-11-10T02:00:00Z", "7576", { ok: true })]), false, "the same problem again is not enough");
  assert.equal(isResolved(card, [e("2026-11-10T02:00:00Z", "7569", { ok: true, hinted: true })]), false, "with help is not enough");
  assert.equal(isResolved(card, [e("2026-11-10T02:00:00Z", "7569", { kind: "drill", ability: "recognize", ok: true })]), false, "another ability is not enough");
  const later = [e("2026-11-10T00:59:00Z", "7576", { ok: false }), e("2026-11-10T02:00:00Z", "7569", { ok: true })];
  assert.equal(isResolved(card, later), true);
  const s = summarize("multi-source", later, [card]);
  assert.equal(s.open, 0); assert.equal(s.resolved, true); assert.equal(s.wrong, card.gap, "kept, shown as resolved");
});
