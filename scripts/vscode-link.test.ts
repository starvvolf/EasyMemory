import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  consumeVscodeLinkCode,
  createVscodeLinkCode,
} from "../src/lib/firebase-vscode-link-store.ts";
import {
  sha256Base64Url,
  VSCODE_LINK_TTL_MS,
} from "../src/lib/vscode-link-contract.ts";

class MemoryDocument {
  readonly path: string;
  readonly store: MemoryFirestore;
  constructor(path: string, store: MemoryFirestore) {
    this.path = path;
    this.store = store;
  }
  async create(value: unknown) {
    if (this.store.documents.has(this.path)) throw new Error("already exists");
    this.store.documents.set(this.path, structuredClone(value));
  }
}

class MemoryFirestore {
  documents = new Map<string, unknown>();
  failNextCommit = false;
  collection(name: string) {
    return { doc: (id: string) => new MemoryDocument(`${name}/${id}`, this) };
  }
  async runTransaction<T>(run: (transaction: {
    get: (reference: MemoryDocument) => Promise<{ exists: boolean; data: () => unknown }>;
    delete: (reference: MemoryDocument) => void;
  }) => Promise<T>) {
    const deletes: string[] = [];
    const result = await run({
      get: async (reference) => ({
        exists: this.documents.has(reference.path),
        data: () => structuredClone(this.documents.get(reference.path)),
      }),
      delete: (reference) => deletes.push(reference.path),
    });
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw new Error("mock commit failed");
    }
    deletes.forEach((path) => this.documents.delete(path));
    return result;
  }
}

function request() {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(24).toString("base64url");
  return {
    verifier,
    state,
    challenge: sha256Base64Url(verifier),
    callbackUri: "vscode://study-forge-local.study-forge-vscode/firebase-auth",
  };
}

async function issue(store: MemoryFirestore, now = 1_000) {
  const values = request();
  const created = await createVscodeLinkCode(
    store as never,
    { uid: "alice", email: "alice@example.com" },
    values,
    now,
  );
  const callback = new URL(created.callbackUri);
  return { ...values, code: callback.searchParams.get("code")!, now };
}

test("연결 문서는 토큰과 원문 state를 저장하지 않고 등록 callback만 반환한다", async () => {
  const store = new MemoryFirestore();
  const link = await issue(store);
  const stored = [...store.documents.values()][0] as Record<string, unknown>;
  assert.equal(stored.ownerUid, "alice");
  assert.equal(stored.state, undefined);
  assert.equal(stored.idToken, undefined);
  assert.equal(stored.refreshToken, undefined);
  assert.notEqual(stored.stateHash, link.state);
});

test("올바른 코드는 저장된 UID로 한 번만 교환된다", async () => {
  const store = new MemoryFirestore();
  const link = await issue(store);
  const input = { code: link.code, state: link.state, verifier: link.verifier };
  assert.deepEqual(await consumeVscodeLinkCode(store as never, input, link.now + 1), {
    uid: "alice",
    email: "alice@example.com",
  });
  await assert.rejects(() => consumeVscodeLinkCode(store as never, input, link.now + 2), /이미 사용/);
});

test("잘못된 verifier와 만료 요청은 거부하며 실패한 검증은 코드를 소비하지 않는다", async () => {
  const store = new MemoryFirestore();
  const link = await issue(store);
  await assert.rejects(
    () => consumeVscodeLinkCode(store as never, { code: link.code, state: link.state, verifier: randomBytes(32).toString("base64url") }, link.now + 1),
    /verifier/,
  );
  assert.equal(store.documents.size, 1);
  await assert.rejects(
    () => consumeVscodeLinkCode(store as never, { code: link.code, state: link.state, verifier: link.verifier }, link.now + VSCODE_LINK_TTL_MS),
    /만료/,
  );
  assert.equal(store.documents.size, 1);
});

test("교환 입력으로 UID를 바꿀 수 없고 트랜잭션 실패 시 코드 삭제도 커밋되지 않는다", async () => {
  const store = new MemoryFirestore();
  const link = await issue(store);
  store.failNextCommit = true;
  const input = { code: link.code, state: link.state, verifier: link.verifier, uid: "mallory" };
  await assert.rejects(() => consumeVscodeLinkCode(store as never, input, link.now + 1), /commit failed/);
  assert.equal(store.documents.size, 1);
  const linked = await consumeVscodeLinkCode(store as never, input, link.now + 2);
  assert.equal(linked.uid, "alice");
});

test("callback은 정확히 등록된 VS Code extension URI만 허용한다", async () => {
  const store = new MemoryFirestore();
  const values = request();
  await assert.rejects(
    () => createVscodeLinkCode(store as never, { uid: "alice", email: "a@b.c" }, { ...values, callbackUri: "https://evil.example/callback" }),
    /등록된/,
  );
});
