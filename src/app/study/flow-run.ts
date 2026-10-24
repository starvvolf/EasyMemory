// 작업대 · 흐름 실행 (2026-10-24). Pure scheduling, no React: FlowBench hands in boxes, arrows and a way to run one box.
//
// Arrows are either forward (they never close a cycle, so the forward arrows form a DAG) or loop arrows ("다시"),
// which go back from a checking box to an earlier box. A run goes:
//   1. everything that is not waiting on a loop runs once along the forward arrows (round 1; loop arrows bring nothing yet);
//   2. while some loop is still open, the boxes inside it (from the box the loop arrow lands on through to the box it
//      leaves) run again. A loop arrow brings its source's previous output, and the box it lands on also gets its own
//      previous output so it can revise rather than start over;
//   3. a loop closes when its source box's stop rule holds (a word in the output / a JSON field value) or that box has
//      run its maximum number of times;
//   4. boxes after a loop (fed by it but not part of it) run once, at the end, on the final outputs.

export type FlowEdge = { id?: string; source: string; target: string; loop?: boolean };
/** Stop rule on a box that a loop arrow leaves. `max` counts that box's runs, the first one included. */
export type StopRule = { max: number; when: "none" | "text" | "json"; word?: string; field?: string; value?: string };
export type FlowBox = { id: string; name: string; order: number; stop?: StopRule };
export type FlowPart = { name: string; text: string; from: string; loop?: boolean; self?: boolean };
export type Round = { round: number; output: string; input?: string; ms: number };
export type BoxRun = {
  status: "idle" | "running" | "done" | "error";
  output?: string; input?: string; error?: string; ms?: number;
  rounds?: Round[];
  /** Why this box's loop ended: "pass" (stop rule held) or "max" (ran out of tries). */
  ended?: "pass" | "max";
  round?: number;
};
export type Exec = (box: FlowBox, parts: FlowPart[], round: number) => Promise<{ output: string; input?: string }>;

export const DEFAULT_STOP: StopRule = { max: 3, when: "json", field: "pass", value: "true" };
const HARD_CAP = 20;

function reach(edges: FlowEdge[], start: string, dir: "down" | "up") {
  const seen = new Set<string>(); const stack = [start];
  while (stack.length) {
    const id = stack.pop()!; if (seen.has(id)) continue; seen.add(id);
    for (const e of edges) {
      if (dir === "down" && e.source === id) stack.push(e.target);
      if (dir === "up" && e.target === id) stack.push(e.source);
    }
  }
  return seen;
}

/** Would an arrow source → target close a cycle among the forward arrows? Then it is a loop arrow. */
export function closesLoop(edges: FlowEdge[], source: string, target: string) {
  return reach(edges.filter((e) => !e.loop), target, "down").has(source);
}

/** The boxes a loop arrow runs again: downstream of where it lands and upstream of where it leaves. */
export function loopBody(edges: FlowEdge[], loop: FlowEdge) {
  const fwd = edges.filter((e) => !e.loop);
  const down = reach(fwd, loop.target, "down"), up = reach(fwd, loop.source, "up");
  return new Set([...down].filter((id) => up.has(id)));
}

function getPath(v: unknown, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), v);
}

export function stopHolds(rule: StopRule, output: string) {
  if (rule.when === "text") { const w = (rule.word ?? "").trim(); return !!w && output.includes(w); }
  if (rule.when === "json") {
    let v: unknown;
    try { v = JSON.parse(output); } catch { return false; }
    const got = getPath(v, (rule.field ?? "").trim() || "pass");
    if (got === undefined || got === null) return false;
    return String(got).trim().toLowerCase() === (rule.value ?? "true").trim().toLowerCase();
  }
  return false;
}

export async function runFlow(o: {
  boxes: FlowBox[]; edges: FlowEdge[]; exec: Exec;
  onRun: (id: string, run: BoxRun) => void;
  onRound?: (round: number) => void;
  stopped?: () => boolean;
}) {
  const { boxes, edges, exec, onRun } = o;
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const fwd = edges.filter((e) => !e.loop && byId.has(e.source) && byId.has(e.target));
  const loops = edges.filter((e) => e.loop && byId.has(e.source) && byId.has(e.target));
  // A loop arrow whose forward path was since cut has nothing to run again; it is ignored.
  const bodies = new Map(loops.map((l) => [l, loopBody(edges, l)] as const).filter(([l, b]) => b.has(l.source) && b.has(l.target)));
  const live = loops.filter((l) => bodies.has(l));
  const inLoop = new Set([...bodies.values()].flatMap((s) => [...s]));
  // Fed by a loop but not part of one: wait until all loops are closed.
  const after = new Set<string>();
  for (const id of inLoop) for (const d of reach(fwd, id, "down")) if (!inLoop.has(d)) after.add(d);

  const state = new Map<string, BoxRun>();
  const put = (id: string, r: BoxRun) => { state.set(id, r); onRun(id, r); };
  const latest = new Map<string, string>(); // last finished output per box
  const runs = new Map<string, number>();   // how many times each box has run

  const runRound = async (ids: Set<string>, round: number) => {
    const memo = new Map<string, Promise<string>>();
    const get = (id: string): Promise<string> => {
      if (!ids.has(id)) {
        const s = state.get(id);
        if (latest.has(id)) return Promise.resolve(latest.get(id)!);
        return Promise.reject(new Error(s?.status === "error" ? `앞 박스 '${byId.get(id)?.name}'에서 실패했어요` : "앞 박스가 아직 안 돌았어요"));
      }
      if (memo.has(id)) return memo.get(id)!;
      const p = (async () => {
        const box = byId.get(id)!; const prev = state.get(id); const t0 = Date.now();
        put(id, { ...prev, status: "running", error: undefined, round });
        try {
          const ins = fwd.filter((e) => e.target === id).map((e) => byId.get(e.source)!).sort((a, b) => a.order - b.order);
          const texts = await Promise.all(ins.map((b) => get(b.id)));
          if (o.stopped?.()) throw new Error("멈췄어요");
          const parts: FlowPart[] = ins.map((b, i) => ({ name: b.name, text: texts[i], from: b.id }));
          if (round > 1) {
            for (const l of live.filter((x) => x.target === id)) {
              const t = latest.get(l.source);
              if (t !== undefined) parts.push({ name: `${byId.get(l.source)!.name} · 앞 회차`, text: t, from: l.source, loop: true });
            }
            if (live.some((x) => x.target === id) && latest.has(id)) parts.push({ name: `${box.name} · 앞 회차 출력`, text: latest.get(id)!, from: id, self: true });
          }
          const { output, input } = await exec(box, parts, round);
          const ms = Date.now() - t0;
          latest.set(id, output); runs.set(id, (runs.get(id) ?? 0) + 1);
          const rounds = [...(prev?.rounds ?? []), { round, output, input, ms }];
          put(id, { status: "done", output, input, ms, rounds, round, ended: prev?.ended });
          return output;
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          put(id, { ...state.get(id), status: "error", error, round });
          throw e;
        }
      })();
      memo.set(id, p);
      return p;
    };
    const results = await Promise.allSettled([...ids].map((id) => get(id)));
    return results.every((r) => r.status === "fulfilled");
  };

  for (const b of boxes) put(b.id, { status: "idle" });
  let round = 1;
  o.onRound?.(round);
  let ok = await runRound(new Set(boxes.map((b) => b.id).filter((id) => !after.has(id))), round);

  const open = new Set(live);
  while (ok && open.size && !o.stopped?.()) {
    for (const l of [...open]) {
      const src = byId.get(l.source)!; const rule = src.stop ?? DEFAULT_STOP;
      const out = latest.get(l.source) ?? "";
      const ended = stopHolds(rule, out) ? "pass" : (runs.get(l.source) ?? 0) >= Math.max(1, rule.max) ? "max" : null;
      if (ended) { open.delete(l); put(l.source, { ...state.get(l.source)!, ended }); }
    }
    if (!open.size || round >= HARD_CAP) break;
    round += 1;
    o.onRound?.(round);
    const ids = new Set([...open].flatMap((l) => [...bodies.get(l)!]));
    ok = await runRound(ids, round);
  }

  // After a failure or a stop, boxes past the loop would only run on stale outputs (and cost a call), so they don't.
  if (ok && !o.stopped?.()) { if (after.size) await runRound(after, round); }
  else for (const id of after) put(id, { status: "error", error: o.stopped?.() ? "멈췄어요" : "앞 반복이 실패해서 돌리지 않았어요" });
  return { rounds: round, state };
}
