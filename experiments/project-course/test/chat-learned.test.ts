import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEvents } from "../lib/chat-learned.ts";

test("배운 것: 근거 구절이 실제 학습자 말에 있어야 받는다", () => {
  const learner = new Map([[45, "requestAnimationFrame은 뭐냐"], [53, "게임루프 실행되는동안   계속 확인하는거야?"]]);
  const { ok, bad } = checkEvents([
    { concept: "requestAnimationFrame", meaning: "다음 화면 때 함수 실행 예약", kind: "asked", messageId: 45, quote: "requestAnimationFrame은 뭐냐", context: "점프" },
    { concept: "이벤트 리스너", meaning: "", kind: "confused", messageId: 53, quote: "실행되는동안 계속 확인", context: "" }, // 공백이 달라도 받음
    { concept: "게임 루프", meaning: "", kind: "asked", messageId: 46, quote: "뭐냐", context: "" }, // 튜터 말 id
    { concept: "중력", meaning: "", kind: "asked", messageId: 45, quote: "중력은 뭐야", context: "" }, // 지어낸 구절
    { concept: "x", meaning: "", kind: "guess", messageId: 45, quote: "뭐냐", context: "" }, // 모르는 종류
  ], learner, []);
  assert.deepEqual(ok.map((x) => x.concept), ["requestAnimationFrame", "이벤트 리스너"]);
  assert.deepEqual(bad.map((b) => b.reason), ["학습자 말 id가 아니에요(46)", "근거 구절이 그 학습자 말에 없어요", "모르는 종류"]);
  // 같은 사건은 두 번 받지 않는다
  const again = checkEvents([{ concept: "RequestAnimationFrame", meaning: "", kind: "asked", messageId: 45, quote: "뭐냐", context: "" }], learner, ok);
  assert.equal(again.ok.length, 0);
  assert.equal(again.bad[0].reason, "이미 있는 사건");
});
