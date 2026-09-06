import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryHttpHandlers } from "./http.ts";
import { applyMemorySummary, createMemoryState, editMemoryEntry } from "./index.ts";
import type { MemoryState } from "./index.ts";

const now = "2026-09-07T00:00:00Z";
const target = { domain: "algorithm" as const, topic: "binary search" };
function recordFor(uid: string) {
  return { recordId: `${uid}-record`, summary: { throughMessageId: "m1", updatedAt: now, automatic: false,
    sections: [{ text: "경계 조건 설명", messageIds: ["m1"], codeIds: [] }],
    learnerMemoryCandidates: [{ ...target, confirmed: ["경계 조건 설명"], uncertain: [], evidenceIds: ["m1"], basis: "observation" }],
  }, evidenceIndex: [{ id: "m1", kind: "message", contentHash: "a".repeat(64) }] };
}
function request(method = "GET", payload?: unknown, uid = "alice", path = "") {
  return new Request(`https://study.example/api/learner-memory${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${uid}` }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
}
function fixture() {
  const states = new Map<string, MemoryState>();
  let failWrite = false; let reads = 0;
  const load = async (uid: string) => { reads++; return structuredClone(states.get(uid) ?? createMemoryState(uid)); };
  const save = (uid: string, state: MemoryState) => {
    if (failWrite) throw new Error("private backend detail");
    states.set(uid, structuredClone(state));
    return { state };
  };
  const handlers = createMemoryHttpHandlers({
    authenticate: async (req) => {
      const uid = req.headers.get("authorization")?.slice(7);
      if (!uid || uid === "missing") throw Object.assign(new Error("로그인이 필요합니다."), { status: 401 });
      return { uid };
    },
    load,
    apply: async (uid, record, opts) => {
      const recordId = record.recordId;
      if (recordId !== `${uid}-record`) throw Object.assign(new Error("기록을 찾지 못했습니다."), { status: 404 });
      const state = await load(uid);
      if (opts.expectedRevision !== state.revision) throw Object.assign(new Error("충돌"), { status: 409, currentRevision: state.revision });
      return save(uid, applyMemorySummary(state, uid, opts.expectedRevision, { ownerUid: uid, recordId, throughSequence: record.evidenceIndex.length - 1, events: record.evidenceIndex.map((item, sequence) => ({ id: item.id, sequence })) }, record.summary.learnerMemoryCandidates, now));
    },
    edit: async (uid, input, opts) => {
      const state = await load(uid);
      if (opts.expectedRevision !== state.revision) throw Object.assign(new Error("충돌"), { status: 409, currentRevision: state.revision });
      return save(uid, editMemoryEntry(state, uid, opts.expectedRevision, input.target, input.change, now));
    },
    mapError: (error) => ({ status: (error as { status?: number }).status ?? 500, message: (error as Error).message, currentRevision: (error as { currentRevision?: number }).currentRevision }),
  });
  return { handlers, states, failNextWrite: () => { failWrite = true; }, reads: () => reads };
}

test("HTTP summary apply -> next question -> edit/delete -> reconnect with account isolation", async () => {
  const { handlers } = fixture();
  assert.equal((await handlers.POST(request("POST", { record: recordFor("alice"), expectedRevision: 0, operationId: "one" }))).status, 200);
  const related = await handlers.CONTEXT(request("GET", undefined, "alice", "/context?domain=algorithm&topic=binary%20search"));
  assert.equal((await related.json()).entries.length, 1);
  assert.equal(related.headers.get("cache-control"), "private, no-store");
  const unrelated = await handlers.CONTEXT(request("GET", undefined, "alice", "/context?domain=cs&topic=binary%20search"));
  assert.equal((await unrelated.json()).entries.length, 0);
  const corrected = await handlers.PATCH(request("PATCH", { target, change: { confirmed: [], uncertain: ["사용자 정정"] }, expectedRevision: 1, operationId: "two" }));
  assert.equal(corrected.status, 200);
  const reconnected = await handlers.GET(request());
  assert.deepEqual((await reconnected.json()).state.entries[0].uncertain, ["사용자 정정"]);
  const bob = await handlers.GET(request("GET", undefined, "bob"));
  assert.equal((await bob.json()).state.entries.length, 0);
  assert.equal((await handlers.POST(request("POST", { record: recordFor("alice"), expectedRevision: 0, operationId: "steal" }, "bob"))).status, 404);
  assert.equal((await handlers.PATCH(request("PATCH", { target, change: "delete", expectedRevision: 2, operationId: "three" }))).status, 200);
  await handlers.POST(request("POST", { record: recordFor("alice"), expectedRevision: 3, operationId: "replay" }));
  assert.equal((await (await handlers.CONTEXT(request("GET", undefined, "alice", "/context?domain=algorithm&topic=binary%20search"))).json()).entries.length, 0);
});

test("write failure retains stored state and does not expose backend details", async () => {
  const fx = fixture();
  await fx.handlers.POST(request("POST", { record: recordFor("alice"), expectedRevision: 0, operationId: "one" }));
  const before = JSON.stringify(fx.states.get("alice"));
  fx.failNextWrite();
  const failure = await fx.handlers.PATCH(request("PATCH", { target, change: "delete", expectedRevision: 1, operationId: "two" }));
  assert.equal(failure.status, 500);
  assert.ok(!(await failure.text()).includes("private backend"));
  assert.equal(JSON.stringify(fx.states.get("alice")), before);
});

test("authentication precedes body parsing or storage; spoofed source and uid are rejected", async () => {
  const fx = fixture();
  assert.equal((await fx.handlers.GET(request("GET", undefined, "missing"))).status, 401);
  assert.equal(fx.reads(), 0);
  for (const extra of [{ ownerUid: "bob" }, { source: { ownerUid: "alice" } }, { candidates: [] }, { throughSequence: 100 }]) {
    assert.equal((await fx.handlers.POST(request("POST", { record: recordFor("alice"), expectedRevision: 0, operationId: "one", ...extra }))).status, 400);
  }
  assert.equal(fx.states.size, 0);
});

test("invalid payloads fail as 400 and concurrent stale revision returns 409", async () => {
  const { handlers } = fixture();
  for (const payload of [null, [], { recordId: "alice-record", operationId: "one" }, { record: recordFor("alice"), expectedRevision: -1, operationId: "one" }]) {
    assert.equal((await handlers.POST(request("POST", payload))).status, 400);
  }
  const huge = request("POST", { record: { ...recordFor("alice"), summary: { text: "x".repeat(900 * 1024) } }, expectedRevision: 0, operationId: "huge" });
  assert.equal((await handlers.POST(huge)).status, 400);
  assert.equal((await handlers.CONTEXT(request("GET", undefined, "alice", "/context?domain=invalid"))).status, 400);
  await handlers.POST(request("POST", { record: recordFor("alice"), expectedRevision: 0, operationId: "one" }));
  const stale = await handlers.PATCH(request("PATCH", { target, change: "confirm", expectedRevision: 0, operationId: "two" }));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).currentRevision, 1);
});


