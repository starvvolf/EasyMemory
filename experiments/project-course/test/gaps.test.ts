import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
process.env.PC_DATA_DIR ??= await mkdtemp(path.join(os.tmpdir(), "pc-gaps-"));
const G = await import("../lib/gaps.ts");
const goal = { id: "g1", title: "set_current_goal 따라가기" }, unit = { id: "g1", title: goal.title, done: "설명한다" };

test("찾기 → 채우기 → 세션 안 확인 → 목표 정리로 이름 · 재확인 문항", async () => {
  const a = await G.openGap("r1", { goal, unit, from: "판정", wrong: "지도 항목을 고르는 순서를 거꾸로 앎", quote: "1번은 done이 되고" });
  const b = await G.openGap("r1", { goal, unit, from: "판정", wrong: "같은 단위 두 번째", quote: "또 틀림" });
  assert.equal(a!.id, b!.id, "같은 단위의 열린 부족함에는 근거만 더한다");
  await G.openGap("r1", { goal, unit, from: "막힘", wrong: "순서가 헷갈림", cause: ["어디서부터 어떤 순서로 할지 모르겠어요"] });
  await G.addRemedy("r1", "g1", "보충", "용어 → 고르는 순서");
  let l = await G.ledgerOf("r1");
  assert.equal(l.length, 2); assert.ok(l.every((g) => g.status === "채우는 중"));
  assert.match(await G.gapsForRecord("r1", "g1"), new RegExp(a!.id));
  assert.deepEqual((await G.fillUnit("r1", "g1", "doing을 먼저 찾아요")).length, 2);
  await G.mergeRecord("r1", { ...goal, done: "설명한다" }, [{ type: "절차", concept: "지도 항목 고르기 순서", wrong: "todo를 먼저 고른다고 앎", right: "doing을 먼저, 없으면 todo", quote: "", ids: [a!.id], recheck: { q: "doing과 todo가 다 있으면 무엇을 고를까요?", a: "doing" } },
    { type: "개념", concept: "mapId", wrong: "새 항목에 연결된다고 앎", right: "고른 항목", quote: "", ids: [] }], new Date().toISOString());
  l = await G.ledgerOf("r1");
  const named = l.find((g) => g.id === a!.id)!;
  assert.equal(named.concept, "지도 항목 고르기 순서"); assert.equal(named.status, "세션에서 채움"); assert.ok(named.recheck && named.dueAt);
  assert.equal(l.length, 3, "원장에 없던 부족함은 목표 정리로 새로 연다");
  // 같은 부족함으로 둘을 묶으면 다시 확인은 하나만
  const second = l.find((g) => g.id !== a!.id && g.evidence.some((e) => e.from === "막힘"))!;
  await G.mergeRecord("r1", { ...goal, done: "설명한다" }, [{ type: "절차", concept: "지도 항목 고르기 순서", wrong: "x", right: "y", quote: "", ids: [a!.id, second.id], recheck: { q: "doing과 todo가 다 있으면 무엇을 고를까요?", a: "doing" } }], new Date().toISOString());
  assert.equal((await G.ledgerOf("r1")).find((g) => g.id === second.id)!.mergedInto, a!.id);
  assert.equal((await G.rechecks()).filter((g) => g.concept === "지도 항목 고르기 순서").length, 1);
});
test("다시 확인: 맞으면 간격을 늘리고 틀리면 다시 열린다", async () => {
  const gid = (await G.ledgerOf("r1")).find((g) => g.recheck)!.id;
  const due = await G.rechecks({ due: true, at: Date.now() + 2 * 86_400_000 });
  assert.ok(due.some((g) => g.id === gid));
  let r = await G.answerRecheck("r1", gid, "todo", async () => ({ verdict: "incorrect", same_mistake: true, note: "예전과 같아요" }));
  assert.equal(r.gap!.status, "다시 틀림"); assert.equal(r.gap!.box, 0);
  assert.match(await G.refailedContext(), /지도 항목 고르기 순서/);
  r = await G.answerRecheck("r1", gid, "doing", async () => ({ verdict: "correct", same_mistake: false, note: "맞아요" }));
  assert.equal(r.gap!.status, "다시 확인 맞음"); assert.equal(r.gap!.box, 1);
  assert.ok(Date.parse(r.gap!.dueAt!) > Date.now() + 2 * 86_400_000);
  r = await G.answerRecheck("r1", gid, "", async () => { throw new Error("빈 답은 채점 안 함"); });
  assert.equal(r.verdict.verdict, "unclear");
});
test("세션 노트: 제목 · 태그 · 부족함 상태 개수", async () => {
  const n = await G.sessionNote("r1");
  assert.equal(n.counts.all, 3); assert.ok(n.tags.includes("지도 항목 고르기 순서"));
});
