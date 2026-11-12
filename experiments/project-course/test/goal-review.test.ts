// 목표 한 칸 총정리(11/12): 목표 정리가 review를 같이 받아 저장, 진행 중 정리는 따로(기록 · 메모리에 안 넣음), 끝나면 지움
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("목표 정리 총정리(11/13 리뷰어 3차 글) · 진행 중 정리", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pc-review-"));
  process.env.PC_DATA_DIR = dir; process.env.PC_FAKE_AI = "1";
  await mkdir(path.join(dir, "goals"), { recursive: true });
  const { setFakeAi } = await import("../lib/ai.ts");
  let calls = 0, sent = "";
  const md = "# 학습 총평\n파일에 지출을 덧붙이는 목표였어요. write에 값을 셋 넣다가 오류가 났고 튜터 설명 뒤 문자열 하나로 묶었어요. 판정 기록으로는 맞았어요.\n\n# 끝났을 때 상태\n- 스스로 한 것: 없음\n- 도움 받아 한 것: 문자열 묶기\n- 아직 확인 안 된 것: 줄바꿈\n\n# 핵심 학습 리뷰\n## 1. 파일에 쓰는 값은 글 하나 [핵심]\n**어려웠던 것** `write(a, b, c)`\n**제대로 알기**\n```\n# 기록용 (코드 안이라 머리글 아님)\nf.write(\"a\")\n```\n**정리**\n- write는 글 하나";
  setFakeAi((purpose: string, user: string) => { if (purpose !== "goal-record") return ""; calls++; sent = user;
    return `${md}\n\n# 기록용\n요약: 지출을 파일에 덧붙였어요.\n과정: TypeError / 설명 / 고침\n\n## 카드: write는 문자열 하나\n- 어떻게: 도움 받고 됨\n- 상황: 지출을 쌓다가\n- 한 것: write에 세 값을 넣음\n- 인용: write에 세 개 넣으면 안 돼?\n- 알게 된 것: 글 하나만 받아요\n- 다음엔: 여러 값 → 먼저 묶는다\n- 다시 확인: f.write(1, 2)는?\n- 모범답: 오류, 글 하나\n\n## 메모리\n- 추가: 함수가 받는 값을 짐작으로 넣는다 ← write는 문자열 하나`; });
  const R = await import("../lib/goal-record.ts");
  const goal = { title: "파일에 덧붙이기", done: "", understood: false, applied: false, at: "2026-11-01T00:00:00Z" };
  const msgs = [{ role: "user", text: "write에 세 개 넣으면 안 돼?", at: "2026-11-01T00:01:00Z" }, { role: "assistant", text: "문자열 하나만 받아요", at: "2026-11-01T00:01:10Z" }];
  const show = (m: { role: string; text: string }) => m.role === "user" ? `[학습자] ${m.text}` : `[튜터] ${m.text}`;
  await R.recordGoal("r1", goal, null, msgs, show, undefined, [], "", true);
  const o = await R.ongoingOf("r1");
  assert.equal(o?.goal, "파일에 덧붙이기");
  assert.equal(o?.review?.v, 3); assert.ok(!(o?.review as { md: string }).md.includes("요약:"), "기록용은 리뷰 글에서 뺌");
  assert.match((o?.review as { md: string }).md, /# 기록용 \(코드 안이라/, "코드 블록 안의 # 줄은 자르지 않음");
  assert.match(sent, /\[결과\] 아직 하는 중\(손 놓음\) · \[해 봤어요\] 판정 없음 · 튜터에게 한 말 1번 · 터미널 명령 없음 · 1분/);
  assert.equal((await R.recordsOf("r1")).length, 0, "진행 중은 기록에 안 들어감");
  await R.recordGoal("r1", goal, null, msgs, show, undefined, [], "", true);
  assert.equal(calls, 1, "새 말이 없으면 진행 중 정리를 다시 안 부름");
  const rec = await R.recordGoal("r1", { ...goal, understood: true, applied: true }, null, msgs, show);
  assert.equal(rec?.review?.v, 3); assert.equal(rec?.summary, "지출을 파일에 덧붙였어요."); assert.deepEqual(rec?.steps, ["TypeError", "설명", "고침"]);
  assert.equal(rec?.cards?.[0].how, "도움 받고 됨"); assert.equal(rec?.cards?.[0].quote, "write에 세 개 넣으면 안 돼?"); assert.equal(rec?.cards?.[0].verified, true);
  assert.deepEqual(rec?.cards?.[0].recheck, { q: "f.write(1, 2)는?", a: "오류, 글 하나" });
  assert.deepEqual(rec?.memory?.done.length, 1, "메모리 추가가 카드 이름 근거로 들어감");
  assert.equal(await R.ongoingOf("r1"), null, "끝나 정리되면 진행 중 정리는 지움");
});

test("기록용 읽기: 머리글 없으면 리뷰 없음, 원장 id · 메모리 유지 · 나아짐", async () => {
  const R = await import("../lib/goal-record.ts");
  const p = R.parseRecordTail("짧은 글\n# 기록용\n## 카드: 반복문\n- 어떻게: 혼자 해냄\n- 원장: G1-ab12, G2-cd34\n## 메모리\n- 유지 [m3]: 그대로 ← 반복문\n- 나아짐 [m2] ← 반복문");
  assert.equal(p.review, undefined);
  assert.deepEqual(p.cards[0].ids, ["G1-ab12", "G2-cd34"]);
  assert.deepEqual(p.memory.update, [{ id: "m3", text: "그대로", evidence: ["반복문"] }]); assert.deepEqual(p.memory.improved, [{ id: "m2", evidence: ["반복문"] }]);
});

test("총정리 문단 코드: 기록에 있는 코드 · 결과만 남김", async () => {
  const R = await import("../lib/goal-record.ts");
  const corpus = "a = input()\nprint(a + b)\nTypeError: x".replace(/\s+/g, "");
  const r = R.cleanReview({ aim: "x", why: "", story: [
    { text: "t1", code: "a = input()\nprint(a + b)  # 이어 붙음", result: "TypeError: x", weak: { size: "none", title: "", state: "", lesson: "" } },
    { text: "t2", code: "print(int('5') + 3)", result: "지어낸 결과", weak: { size: "none", title: "", state: "", lesson: "" } }] }, corpus)!;
  assert.equal(r.story[0].code, "a = input()\nprint(a + b)  # 이어 붙음"); assert.equal(r.story[0].result, "TypeError: x");
  assert.equal(r.story[1].code, undefined, "기록에 없는 코드는 버림"); assert.equal(r.story[1].result, undefined, "기록에 없는 결과는 버림");
});

test("목표 구간(11/13): 기록의 to는 정리를 부른 때, 다시 정리할 때는 다음 목표 시작에서 자름", async () => {
  const { setFakeAi } = await import("../lib/ai.ts");
  const R = await import("../lib/goal-record.ts");
  const { toMd } = await import("./old-record.ts");
  const seen: string[] = [];
  setFakeAi((p: string, u: string) => { if (p !== "goal-record") return ""; seen.push(u); return toMd({ summary: "s", steps: [], cards: [] }); });
  const show = (m: { role: string; text: string }) => `[학습자] ${m.text}`;
  const msgs = [{ role: "user", text: "첫 목표 말", at: "2026-11-02T00:01:00Z" }, { role: "user", text: "둘째 목표 말", at: "2026-11-02T00:06:00Z" }];
  const g1 = { title: "g1", done: "", understood: true, applied: true, at: "2026-11-02T00:00:00Z" };
  const r1 = await R.recordGoal("r9", g1, null, msgs, show, { to: "2026-11-02T00:07:00Z", index: 0 }, []);
  assert.equal(r1?.to, "2026-11-02T00:07:00Z");
  await R.recordGoal("r9", { ...g1, title: "g2", at: "2026-11-02T00:05:00Z" }, null, msgs, show, { to: "2026-11-02T00:08:00Z", index: 1 }, []);
  seen.length = 0;
  await R.redoRecords("r9", msgs, show);
  assert.doesNotMatch(seen[0], /둘째 목표 말/, "앞 목표는 다음 목표 시작에서 잘림");
  assert.match(seen[1], /둘째 목표 말/);
});
