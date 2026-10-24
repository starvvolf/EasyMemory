import { test } from "node:test";
import assert from "node:assert/strict";
import { closesLoop, runFlow, stopHolds, type FlowBox, type FlowEdge } from "./flow-run.ts";

// 지시 → 작성 → 검토 ↺ 작성, 검토 → 최종
const boxes: FlowBox[] = [
  { id: "in", name: "지시", order: 0 },
  { id: "w", name: "작성", order: 1 },
  { id: "c", name: "검토", order: 2, stop: { max: 5, when: "json", field: "pass", value: "true" } },
  { id: "f", name: "최종", order: 3 },
];
const edges: FlowEdge[] = [
  { source: "in", target: "w" }, { source: "w", target: "c" }, { source: "c", target: "w", loop: true }, { source: "c", target: "f" },
];

test("a back arrow is a loop arrow, a forward one is not", () => {
  const fwd = edges.filter((e) => !e.loop);
  assert.equal(closesLoop(fwd, "c", "w"), true);
  assert.equal(closesLoop(fwd, "in", "c"), false);
});

test("loop reruns the body with the checker's last output and the box's own draft, stops on pass, then runs what comes after once", async () => {
  const calls: string[] = []; let checks = 0; const seenByWriter: string[][] = [];
  const out = await runFlow({
    boxes, edges, onRun: () => {},
    exec: async (b, parts, round) => {
      calls.push(`${b.id}${round}`);
      if (b.id === "in") return { output: "문제 1개" };
      if (b.id === "w") { seenByWriter.push(parts.map((p) => p.name)); return { output: `초안 ${round}` }; }
      if (b.id === "c") { checks += 1; return { output: JSON.stringify({ pass: checks >= 2 }) }; }
      return { output: "끝: " + parts.map((p) => p.text).join() };
    },
  });
  assert.equal(out.rounds, 2);
  assert.deepEqual(calls, ["in1", "w1", "c1", "w2", "c2", "f2"]); // 지시 is not rerun, 최종 runs once at the end
  assert.deepEqual(seenByWriter[1], ["지시", "검토 · 앞 회차", "작성 · 앞 회차 출력"]);
  assert.equal(out.state.get("c")!.ended, "pass");
  assert.equal(out.state.get("w")!.rounds!.length, 2);
});

test("a loop that never passes stops at max runs of the checker", async () => {
  let checks = 0;
  const out = await runFlow({
    boxes: boxes.map((b) => b.id === "c" ? { ...b, stop: { max: 3, when: "text", word: "통과" } } : b), edges, onRun: () => {},
    exec: async (b) => { if (b.id === "c") checks += 1; return { output: b.id === "c" ? "고칠 것 있음" : "x" }; },
  });
  assert.equal(checks, 3);
  assert.equal(out.state.get("c")!.ended, "max");
});

test("stop rules", () => {
  assert.equal(stopHolds({ max: 3, when: "json", field: "result.ok", value: "yes" }, '{"result":{"ok":"YES"}}'), true);
  assert.equal(stopHolds({ max: 3, when: "json", field: "pass", value: "true" }, "not json"), false);
  assert.equal(stopHolds({ max: 3, when: "none" }, "통과"), false);
});
