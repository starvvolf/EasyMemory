import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { createMemoryHttpHandlers } from "./http.ts";

// Node's test runner has no Next alias resolver. Only the server-only marker is
// bypassed; the real adapter runs, with its explicit Firestore injection seam.
type ResolveResult = { url: string; shortCircuit?: boolean };
type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => ResolveResult) => ResolveResult;
// Runtime is Node 24; the repository intentionally keeps its existing Node 20 declarations.
const { registerHooks } = createRequire(import.meta.url)("node:module") as { registerHooks(hooks: { resolve: ResolveHook }): void };
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
  if (specifier.startsWith("@/lib/")) {
    const base = new URL(`../${specifier.slice(6)}`, import.meta.url);
    for (const suffix of [".ts", "/index.ts"]) {
      const url = `${base.href}${suffix}`;
      if (existsSync(fileURLToPath(url))) return { url, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
} });
const adapter = await import("../firebase-learner-memory-store.ts");
const { toUserDataError } = await import("../server-user.ts");
const consumerRoot = process.env.LEARNER_MEMORY_CONSUMER_ROOT ?? fileURLToPath(new URL("../../../tools/study-forge-vscode", import.meta.url));
const consumerPath = resolve(consumerRoot, "memory-client.js");
const consumer = existsSync(consumerPath) ? createRequire(import.meta.url)(fileURLToPath(pathToFileURL(consumerPath))) : null;
const summarizer = consumer ? createRequire(import.meta.url)(resolve(consumerRoot, "summary.js")) : null;

class MemoryFirestore {
  documents = new Map<string, unknown>();
  failNextCommit = false;
  queue: Promise<unknown> = Promise.resolve();
  collection(name: string) { return { doc: (id: string) => this.reference(`${name}/${id}`) }; }
  reference(path: string) {
    return { path, collection: (name: string) => ({ doc: (id: string) => this.reference(`${path}/${name}/${id}`) }), get: async () => this.snapshot(this.documents, path) };
  }
  snapshot(values: Map<string, unknown>, path: string) {
    const value = values.get(path);
    return { exists: values.has(path), data: () => structuredClone(value), get: (field: string) => (value as Record<string, unknown> | undefined)?.[field] };
  }
  runTransaction<T>(run: (transaction: { get: (ref: { path: string }) => Promise<ReturnType<MemoryFirestore["snapshot"]>>; set: (ref: { path: string }, value: unknown) => void; create: (ref: { path: string }, value: unknown) => void }) => Promise<T>) {
    const work = this.queue.catch(() => undefined).then(async () => {
      const next = structuredClone(this.documents);
      const result = await run({ get: async (ref) => this.snapshot(next, ref.path), set: (ref, value) => { next.set(ref.path, structuredClone(value)); },
        create: (ref, value) => { if (next.has(ref.path)) throw new Error("exists"); next.set(ref.path, structuredClone(value)); } });
      if (this.failNextCommit) { this.failNextCommit = false; throw new Error("mock transaction failed"); }
      this.documents = next;
      return result;
    });
    this.queue = work;
    return work;
  }
}
function fixture() {
  const store = new MemoryFirestore();
  const api = createMemoryHttpHandlers({
    authenticate: async (request) => ({ uid: request.headers.get("Authorization")!.slice(7) }),
    load: (uid) => adapter.loadLearnerMemory(uid, store as never),
    apply: (uid, record, options) => adapter.applyLearnerMemorySummary(uid, record, options, store as never),
    edit: async (uid, input, options) => ({ state: await adapter.editLearnerMemory(uid, input.target, input.change, options, store as never) }),
    mapError: (error) => toUserDataError(error, "failed"),
  });
  const account = {
    identity: { uid: "alice", serverUrl: "https://study.example" }, generation: 0,
    assertCurrent(generation: number, uid?: string) { if (generation !== this.generation || uid && uid !== this.identity.uid) throw new Error("account changed"); },
    async request(path: string, options: RequestInit = {}) {
      const request = new Request(this.identity.serverUrl + path, { ...options, headers: { ...options.headers, Authorization: `Bearer ${this.identity.uid}` } });
      const handler = path.includes("/context?") ? api.CONTEXT : request.method === "POST" ? api.POST : request.method === "PATCH" ? api.PATCH : api.GET;
      const response = await handler(request);
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.message), { status: response.status });
      return result;
    },
  };
  return { store, account, client: consumer ? new consumer.MemoryClient(account) : null };
}
function session() {
  const item = { text: "경계 조건 설명", messageIds: ["m1"], codeIds: [] };
  return { id: "session-1", problem: { title: "이진 탐색", text: "배열에서 목표값 찾기" }, accountLink: { uid: "alice", serverUrl: "https://study.example" }, messages: [{ id: "m1", role: "user", text: "이진 탐색 경계 조건", status: "completed" }], codeSnapshots: [],
    summary: { throughMessageId: "m1", updatedAt: "2026-09-07T00:00:00Z", automatic: false,
      sections: { concepts: [item], difficulties: [], observedActions: [], unverifiedUnderstanding: [], reviewItems: [] },
      learnerMemoryCandidates: [{ domain: "algorithm", topic: "binary search", confirmed: [item.text], uncertain: [], evidenceIds: ["m1"], basis: "observation" }],
    },
  };
}

test("real VS Code snapshot -> HTTP -> Firebase adapter -> next question, edit/delete and reconnect", { skip: !consumer && "VS Code consumer commit is not integrated" }, async () => {
  const { client, account, store } = fixture();
  const record = session();
  const previousSummary = record.summary; let modelCalls = 0;
  await summarizer.updateSummary(record, async () => {
    modelCalls++;
    return { text: JSON.stringify({ ...previousSummary.sections, learnerMemoryCandidates: previousSummary.learnerMemoryCandidates }) };
  });
  await client.apply(record);
  assert.equal(modelCalls, 1);
  assert.equal((await client.context("algorithm", ["binary search"])).entries.length, 1);
  assert.equal((await client.context("cs", ["binary search"])).entries.length, 0);
  await client.edit({ domain: "algorithm", topic: "binary search" }, { confirmed: [], uncertain: ["현재 사용자 정정"] });
  const reconnected = new consumer.MemoryClient(account);
  await reconnected.load();
  assert.deepEqual(reconnected.snapshot().entries[0].uncertain, ["현재 사용자 정정"]);
  const before = structuredClone(store.documents);
  store.failNextCommit = true;
  await assert.rejects(() => reconnected.edit({ domain: "algorithm", topic: "binary search" }, "delete"));
  assert.deepEqual(store.documents, before);
  await reconnected.edit({ domain: "algorithm", topic: "binary search" }, "delete");
  await reconnected.apply(record);
  assert.equal((await reconnected.context("algorithm", ["binary search"])).entries.length, 0);
  account.identity = { uid: "bob", serverUrl: account.identity.serverUrl }; account.generation++;
  assert.equal(reconnected.snapshot(), null);
  await reconnected.load();
  assert.equal(reconnected.snapshot().ownerUid, "bob");
  assert.equal(reconnected.snapshot().entries.length, 0);
});

test("adapter validates summary reference kinds and omits unrequested raw content", { skip: !consumer && "VS Code consumer commit is not integrated" }, async () => {
  const { store } = fixture();
  const record = consumer.recordSnapshot(session());
  const bad = structuredClone(record); bad.summary.sections[0].codeIds = ["m1"];
  await assert.rejects(() => adapter.applyLearnerMemorySummary("alice", bad, { expectedRevision: 0, operationId: "wrong-kind" }, store as never));
  assert.equal(store.documents.size, 0);
  record.rawMessages = ["RAW-SHOULD-NOT-BE-STORED"];
  record.summary.rawImage = "RAW-SHOULD-NOT-BE-STORED";
  await adapter.applyLearnerMemorySummary("alice", record, { expectedRevision: 0, operationId: "valid" }, store as never);
  const persisted = store.documents.get("users/alice/learnerMemoryRecords/session-1");
  assert.ok(!JSON.stringify(persisted).includes("RAW-SHOULD-NOT-BE-STORED"));
});

test("adapter keeps newest summary on cursor regression and arbitrates stale concurrent writes", { skip: !consumer && "VS Code consumer commit is not integrated" }, async () => {
  const { store } = fixture();
  const older = consumer.recordSnapshot(session());
  const newer = structuredClone(older);
  newer.evidenceIndex.push({ id: "m2", kind: "message", contentHash: "c".repeat(64) });
  newer.summary.throughMessageId = "m2";
  await adapter.applyLearnerMemorySummary("alice", newer, { expectedRevision: 0, operationId: "newer" }, store as never);
  const before = structuredClone(store.documents);
  const regression = structuredClone(newer); regression.summary.throughMessageId = "m1";
  await assert.rejects(() => adapter.applyLearnerMemorySummary("alice", regression, { expectedRevision: 1, operationId: "regress" }, store as never), /이전 위치/);
  assert.deepEqual(store.documents, before);
  const edits = await Promise.allSettled([
    adapter.editLearnerMemory("alice", { domain: "algorithm", topic: "binary search" }, "confirm", { expectedRevision: 1, operationId: "edit-a" }, store as never),
    adapter.editLearnerMemory("alice", { domain: "algorithm", topic: "binary search" }, "delete", { expectedRevision: 1, operationId: "edit-b" }, store as never),
  ]);
  assert.equal(edits.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(edits.filter((result) => result.status === "rejected").length, 1);
});

test("real adapter retries once, rejects stale CAS and changed original evidence", { skip: !consumer && "VS Code consumer commit is not integrated" }, async () => {
  const { store } = fixture();
  const record = consumer.recordSnapshot(session());
  const options = { expectedRevision: 0, operationId: "first" };
  await adapter.applyLearnerMemorySummary("alice", record, options, store as never);
  const retried = await adapter.applyLearnerMemorySummary("alice", record, options, store as never);
  assert.equal(retried.status, "duplicate");
  assert.equal(retried.state.revision, 1);
  await assert.rejects(() => adapter.applyLearnerMemorySummary("alice", record, { ...options, operationId: "stale" }, store as never), /먼저 변경/);
  const changed = structuredClone(record); changed.evidenceIndex[0].contentHash = "b".repeat(64);
  await assert.rejects(() => adapter.applyLearnerMemorySummary("alice", changed, { expectedRevision: 1, operationId: "changed" }, store as never), /수정하거나 재정렬/);
});
