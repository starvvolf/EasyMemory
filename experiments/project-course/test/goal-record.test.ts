import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.PC_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "grec-"));
process.env.PC_FAKE_AI = "1";
const ai = await import("../lib/ai.ts");
const { wrapFake } = await import("./old-record.ts");
const setFake = wrapFake(ai);
const R = await import("../lib/goal-record.ts");

test("목표 정리(11/5): 그 목표 시작 뒤의 대화만 보내고, 근거 구절은 학습자 말과 대조", async () => {
  let sent = "";
  setFake((purpose: string, user: string) => { sent = user; return { summary: "스택을 리스트로 써 봄", steps: ["설명을 들음", "pop 결과를 예측해 맞힘"], learned: [
    { type: "개념", concept: "스택", meaning: "나중에 넣은 것을 먼저 꺼냄", how: "예측해 맞힘", quote: "3" },
    { type: "규칙", concept: "IndexError", meaning: "빈 리스트 pop은 오류", how: "예측해 맞힘", quote: "오류가 난다고 했잖아" }] }; });
  const msgs = [
    { role: "user", text: "예전 말", at: "2026-11-05T00:00:00Z" },
    { role: "user", text: "3", at: "2026-11-05T01:00:01Z" },
    { role: "assistant", text: "맞아요", at: "2026-11-05T01:00:02Z" },
    { role: "user", text: "오류가나지", at: "2026-11-05T01:00:03Z" },
  ];
  const rec = await R.recordGoal("run1", { title: "push · pop", done: "넣고 꺼낸다", understood: true, applied: false, at: "2026-11-05T01:00:00Z" }, "bottomup", msgs, (m) => `[${m.role}] ${m.text}`);
  assert.ok(rec);
  assert.ok(!sent.includes("예전 말")); // 목표 시작 전 대화는 안 보냄
  assert.match(sent, /건너뜀\(이해 ✓, 적용 –\)/);
  assert.equal(rec!.status, "건너뜀");
  assert.deepEqual(rec!.learned.map((x) => [x.concept, x.verified]), [["스택", true], ["IndexError", false]]); // 지어낸 구절은 근거 없음으로
  assert.equal((await R.recordsOf("run1")).length, 1);
});

test("부족한 점(11/6): 목표 정리의 gaps가 '몰랐음' 지식 + 틀림 사건으로 앱에 가고, 보낸 것은 다시 안 감", async () => {
  setFake(() => ({ summary: "캐시를 딕셔너리로 만들어 봄", steps: ["캐시 위치를 물어봄"], learned: [
    { type: "개념", concept: "캐시", meaning: "계산 결과를 저장해 다시 씀", how: "설명을 들음", quote: "" }],
    gaps: [{ type: "규칙", concept: "= 와 ==", wrong: "조건에 대입 기호 =를 씀", right: "같은지 비교는 ==, =는 대입", quote: "if cache[n]=False:" },
      { type: "개념", concept: "캐시", wrong: "캐시를 함수 안에 만들어 매번 비움", right: "캐시는 함수 밖에 두어야 호출 사이에 남는다", quote: "캐시를 어디에 넣어야하지" }] }));
  const msgs = [{ role: "user", text: "캐시를 어디에 넣어야하지", at: "2026-11-06T01:00:01Z" }, { role: "user", text: "if cache[n]=False: 이렇게?", at: "2026-11-06T01:00:02Z" }];
  const rec = await R.recordGoal("run2", { title: "캐시 만들기", done: "같은 n이면 저장된 값을 돌려준다", understood: true, applied: true, at: "2026-11-06T01:00:00Z" }, "topdown", msgs, (m) => m.text);
  assert.deepEqual(rec!.gaps!.map((x) => [x.concept, x.verified]), [["= 와 ==", true], ["캐시", true]]);
  const S = await import("../lib/sync.ts");
  const run = { id: "run2", codexId: "x" } as never;
  const p = await S.pending("run2", { id: "hello-api", title: "t", knowledge: [] } as never, run);
  assert.equal(p.source.ref, "project:run2");
  const cache = p.items.find((i) => i.title === "캐시")!;
  assert.equal(cache.state, "unknown"); // 배운 것 + 부족한 것 → 한 지식, 몰랐음
  assert.match(cache.body, /^알게 된 것: 캐시는 함수 밖에 두어야 호출 사이에 남는다\n상황: 캐시 만들기\n내가 한 것: 캐시를 함수 안에 만들어 매번 비움 \(틀렸다 고침\)$/); // 실습 기억 카드 꼴(11/10)
  assert.deepEqual(cache.events.map((e) => e.kind), ["note", "wrong"]);
  assert.equal(p.items.find((i) => i.title === "= 와 ==")!.kind, "concept"); // 여섯 칸은 더 안 씀(11/10)
  await S.markSent("run2", p.items.flatMap((i) => [i.key, ...i.events.map((e) => e.key)]));
  assert.equal((await S.pending("run2", { id: "hello-api", title: "t", knowledge: [] } as never, run)).items.length, 0);
});

test("코드 저장(11/6 A안): 목표 동안 저장한 코드의 바뀐 줄이 대화 사이에 들어가고, 코드 줄도 근거가 된다", async () => {
  let sent = "";
  setFake((_p: string, user: string) => { sent = user; return { summary: "s", steps: [], learned: [], gaps: [{ type: "규칙", concept: "= 와 ==", wrong: "비교에 = 씀", right: "==로 비교", quote: "if cache[n]=False:" }] }; });
  const saves = [
    { at: "2026-11-06T00:59:00Z", file: "a.py", text: "cache = {}\n" },
    { at: "2026-11-06T01:00:05Z", file: "a.py", text: "cache = {}\nif cache[n]=False:\n    pass\n" },
    { at: "2026-11-06T03:00:00Z", file: "a.py", text: "나중 것\n" },
  ];
  const msgs = [{ role: "user", text: "이렇게 했어요", at: "2026-11-06T01:00:01Z" }, { role: "user", text: "해 봤어요", at: "2026-11-06T01:00:09Z" }];
  const rec = await R.recordGoal("run3", { title: "캐시", done: "d", understood: true, applied: true, at: "2026-11-06T01:00:00Z" }, null, msgs, (m) => m.text, { to: "2026-11-06T02:00:00Z", index: 99 }, saves);
  assert.match(sent, /이렇게 했어요\n\n\[학습자 코드 저장 S2 a\.py\]\n\+   2\| if cache\[n\]=False:\n\+   3\|     pass\n\n해 봤어요/);
  assert.ok(!sent.includes("cache = {}") && !sent.includes("나중 것")); // 구간 앞 저장본은 기준으로만, 구간 뒤는 안 씀
  assert.equal(rec!.gaps![0].verified, true);
  assert.deepEqual(R.lineDiff("a\nb\nc", "a\nc\nd"), ["- b", "+ d"]);
});

test("틀렸던 코드(11/6): AI가 저장본 번호 · 줄 범위로 짚으면 코드가 원문을 잘라 기억으로 보낸다", async () => {
  const saves = [{ at: "2026-11-06T05:00:05Z", file: "c.py", text: "cache = {}\ndef sq(n):\n    if cache[n]=False:\n        cache[n] = n*n\n    return n*n\n" }];
  setFake(() => ({ summary: "", steps: [], learned: [], gaps: [
    { type: "규칙", concept: "비교 연산", wrong: "조건에 = 씀", right: "==", quote: "", code: { save: "S1", from: 3, to: 3 } },
    { type: "원리", concept: "없는 저장본", wrong: "w", right: "r", quote: "", code: { save: "S9", from: 1, to: 2 } }],
    memory: { add: [], update: [], improved: [] } }));
  const rec = await R.recordGoal("run5", { title: "캐시", done: "d", understood: true, applied: true, at: "2026-11-06T05:00:00Z" }, null, [{ role: "user", text: "해 봤어요", at: "2026-11-06T05:00:09Z" }], (m) => m.text, { to: "2026-11-06T06:00:00Z", index: 99 }, saves);
  assert.deepEqual(rec!.gaps![0].code, { save: "S1", file: "c.py", from: 3, to: 3, code: "    if cache[n]=False:" });
  assert.equal(rec!.gaps![0].verified, true);
  assert.equal(rec!.gaps![1].code, undefined); assert.equal(rec!.gaps![1].verified, false);
  assert.equal(R.cutCode([{ id: "S1", save: saves[0] }], { save: "S1", from: 1, to: 40 })!.to, 6); // 끝 줄 넘으면 잘림
  const S = await import("../lib/sync.ts");
  const p = await S.pending("run5", { id: "hello-api", title: "t", knowledge: [] } as never, { id: "run5", codexId: "x" } as never);
  const it = p.items.find((i) => i.title === "비교 연산")!;
  assert.equal(it.mistake!.code, "    if cache[n]=False:"); assert.equal(it.mistake!.note, "조건에 = 씀");
  await S.markSent("run5", p.items.flatMap((i) => [i.key, ...(i.mistakeKey ? [i.mistakeKey] : []), ...i.events.map((e) => e.key)]));
  assert.equal((await S.pending("run5", { id: "hello-api", title: "t", knowledge: [] } as never, { id: "run5", codexId: "x" } as never)).items.length, 0);
});
