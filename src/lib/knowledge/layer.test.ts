// 카드의 층: 뜻에서 만난 곳의 사연을 예로 옮기고(옛 뜻은 bodyBefore), 헷갈림을 지키고, 잘 모르겠어요는 설명을 남기고 물어봄으로.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setFakeModelResponder, type ModelRequest } from "../ai/model.ts";
import { explainKnowledge, runLayer } from "./layer.ts";
import { getKnowledge, saveMany, sortItems } from "./store.ts";

test("층 나누기와 잘 모르겠어요", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knowledge-layer-"));
  const prior = { data: process.env.STUDY_FORGE_DATA_DIR, provider: process.env.STUDY_FORGE_MODEL_PROVIDER };
  process.env.STUDY_FORGE_DATA_DIR = dir; process.env.STUDY_FORGE_MODEL_PROVIDER = "fake";
  const calls: ModelRequest[] = [];
  setFakeModelResponder((r) => {
    calls.push(r);
    if (r.system.includes("이해가 안 된다고")) return JSON.stringify({ plain: "키로 자리를 계산해 바로 찾는다. 처음부터 훑지 않아도 된다.",
      extras: [{ label: "비유", text: "사물함 번호를 이름에서 계산해 바로 찾아가는 것." }, { label: "아무 칸", text: "목록에 없는 칸은 버린다" }, { label: "다른 데서", text: "사용자 ID로 계정 찾기" }], see: ["배열", "없는 개념"] });
    const lines = r.user.split("\n").filter((l) => /^\d+\. /.test(l));
    const n = (t: string) => lines.findIndex((l) => l.includes(`. ${t} `) || l.includes(`. ${t}|`));
    return JSON.stringify({ items: [{ n: n("해시"), meaning: "키를 해시 함수로 자리 번호로 바꿔 바로 저장하고 찾는 방법.", example: "이 문제에선 이름을 키로 누적 포인트를 O(1)에 찾는다.", confusion: "충돌: 다른 키가 같은 자리로 갈 수 있다" },
      { n: n("배열"), meaning: "", example: "", confusion: "" }] });
  });
  try {
    const [hash, arr] = await saveMany([{ title: "해시", body: "키에 해시 함수를 적용해 저장 위치를 정한다. 이름을 키로 사용하면 누적 포인트를 O(1)에 조회한다.", source: { kind: "code", title: "이름별 누적 포인트", ref: "code:p1" } },
      { title: "배열", body: "같은 크기 칸이 이어진 자료구조\n헷갈림: 길이는 못 바꾼다", source: { kind: "manual", title: "직접" } }]);
    await sortItems([{ id: hash.item.id, topic: "CS/자료구조/해시", kind: "concept" }, { id: arr.item.id, topic: "CS/자료구조/배열", kind: "concept" }]);
    const r = await runLayer();
    assert.equal(calls.length, 1);
    assert.equal(r.done, 2);
    const h = (await getKnowledge(hash.item.id)).item;
    assert.equal(h.body, "키를 해시 함수로 자리 번호로 바꿔 바로 저장하고 찾는 방법.\n헷갈림: 충돌: 다른 키가 같은 자리로 갈 수 있다");
    assert.match(h.bodyBefore!, /누적 포인트/);
    assert.match(h.example!, /이 문제에선/);
    const a = (await getKnowledge(arr.item.id)).item;
    assert.ok(a.layered && h.layered);
    assert.equal(a.body, "같은 크기 칸이 이어진 자료구조\n헷갈림: 길이는 못 바꾼다", "an empty answer changes nothing; 헷갈림 stays");
    assert.deepEqual(await runLayer(), { done: 0, changed: [], left: 0, calls: 0 }, "once each");

    const e = await explainKnowledge(hash.item.id);
    assert.match(e.explain, /비유: 사물함/);
    assert.deepEqual(e.see, [{ title: "배열", id: arr.item.id, sure: false }, { title: "없는 개념", id: null, sure: false }], "not linked yet: 함께 알아보기");
    const after = await getKnowledge(hash.item.id);
    assert.deepEqual(after.item.explainParts!.extras.map((x) => x.label), ["비유", "다른 데서"]);
    assert.equal(after.item.explainSee!.length, 2);
    assert.equal(after.item.state, "met", "설명을 본 것은 기억 실패가 아니다: 복습 단계 그대로");
    assert.equal(after.events[0].kind, "note");
    await explainKnowledge(hash.item.id, "", "review");
    assert.equal((await getKnowledge(hash.item.id)).item.state, "unknown", "복습 중 답 전에 누른 것은 물어봄");
  } finally {
    setFakeModelResponder(null);
    for (const [key, value] of [["STUDY_FORGE_DATA_DIR", prior.data], ["STUDY_FORGE_MODEL_PROVIDER", prior.provider]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(dir, { recursive: true, force: true });
  }
});
