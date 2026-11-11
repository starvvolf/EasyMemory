// 장기 목표를 바꿔 다시 확정해도(11/12 실측) 같은 이름의 끝낸 단계는 끝냄 그대로, 하는 중은 남은 것 맨 앞 하나
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("다시 확정: 끝낸 단계는 그대로", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pc-replan-"));
  process.env.PC_DATA_DIR = dir; process.env.PC_DIARY = "0";
  await mkdir(path.join(dir, "goals"), { recursive: true });
  const R = "rp1";
  const at = "2026-11-12T00:00:00Z";
  await writeFile(path.join(dir, "goals", `${R}.json`), JSON.stringify({ mode: "bottomup", long: { text: "가계부", spec: "", at }, stack: [], support: null, survey: null, stuck: null, log: [],
    map: [{ id: "a", title: "지출 한 건 입력받기", status: "done" }, { id: "b", title: "지출 기록 저장하고 다시 읽기", status: "done" }, { id: "c", title: "이번 달 지출 합계 보여 주기", status: "doing" }],
    current: { id: "x", title: "이번 달 합계", done: "", understood: false, applied: false, at },
    plan: { long: "사용한 곳별 가계부", spec: "", mode: "bottomup", map: ["지출 한 건 입력받기", "지출 기록 저장하고 다시 읽기", "사용한 곳별 지출 합계 보여 주기"], first: { title: "사용한 곳별로 합산하기", done: "" }, at } }));
  const G = await import("../lib/goals.ts");
  await G.goalAction(R, "confirm", {});
  const g = await G.goalsOf(R);
  assert.deepEqual(g.map.map((m) => m.status), ["done", "done", "doing"]);
  assert.equal(g.current?.mapId, g.map[2].id);
});
