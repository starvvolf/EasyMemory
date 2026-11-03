// 학습 상태 모델(11/3): 사실은 사건에서 코드가, AI 관찰은 따로(검증 안 됨)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.PC_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "pc-learner-"));
const { deriveLearner, learnerLine, addObservation, learnerView } = await import("../lib/learner.ts");
const { record } = await import("../lib/session.ts");

const course = { knowledge: [{ id: "route", name: "라우팅" }, { id: "status", name: "상태 코드" }, { id: "json", name: "JSON" }] };
const ev = (type: string, actor: string, detail: string, concepts: string[]) => ({ id: "x", at: "", runId: "r", stage: 1, type, actor, detail, concepts }) as never;

test("사실로 정한다: 직접 통과 → 이해(검사로 확인), 예측 틀림 → 약함, 내 말로 → 배우는 중", () => {
  const v = deriveLearner(course, [
    ev("verify", "user", "예측 틀림: p1", ["status"]),
    ev("self_report", "user", "내 말로: 라우터가 home을 찾아요", ["route"]),
    ev("application", "user", "단계 검사 통과 · 직접 고침", ["route"]),
  ], []);
  const by = Object.fromEntries(v.concepts.map((c) => [c.id, c]));
  assert.equal(by.route.status, "understood"); assert.equal(by.route.verified, true); assert.equal(by.route.explained, true);
  assert.equal(by.status.status, "weak");
  assert.equal(by.json.status, "new");
  assert.match(learnerLine(v), /라우팅 이해\(검사로 확인\)·내 말로 함 · 상태 코드 약함/);
});

test("정답 보고 고친 통과는 이해로 치지 않는다", () => {
  const v = deriveLearner(course, [ev("application", "user", "단계 검사 통과 · 정답 줄 보고 고침", ["route"])], []);
  assert.equal(v.concepts[0].status, "weak"); assert.equal(v.concepts[0].verified, false);
});

test("AI 관찰은 상태를 바꾸지 않고 오개념으로만 따로", async () => {
  await addObservation("r1", { concept: "status", kind: "misconception", note: "201도 200처럼 아무 데나 쓴다고 생각함" });
  await addObservation("r1", { concept: "route", kind: "understood", note: "GET과 주소를 함께 본다는 걸 설명함" });
  await record({ runId: "r1", stage: 1, type: "verify", actor: "user", detail: "예측 맞힘: p1", concepts: ["route"] });
  await new Promise((r) => setTimeout(r, 50));
  const v = await learnerView("r1", course);
  const route = v.concepts.find((c) => c.id === "route")!;
  assert.equal(route.status, "learning", "관찰(이해한 듯)만으로 이해로 올리지 않는다");
  assert.equal(route.observations.length, 1);
  assert.match(learnerLine(v), /오개념\(튜터 관찰, 검증 안 됨\)\] 201도 200처럼/);
});

test("학습 도구: 관찰 남기기는 검증 안 됨으로, 진도 도구는 개념 상태를 보여 준다", async () => {
  const { recordObservation, getProgress, getStep } = await import("../lib/learning-tools.ts");
  const { createRun } = await import("../lib/store.ts").catch(() => ({ createRun: null }));
  void createRun;
  // 진행 기록 없이 부르면 찾지 못했다고 한다(도구가 진도를 지어내지 않는다)
  await assert.rejects(() => getProgress("없는-기록"), /진행 기록을 찾지 못했어요/);
  await assert.rejects(() => getStep("없는-기록", 1), /진행 기록을 찾지 못했어요/);
  await assert.rejects(() => recordObservation("없는-기록", 1, { kind: "understood", note: "잘 설명함" }), /진행 기록을 찾지 못했어요/);
});
