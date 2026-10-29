// 앱 지식 저장소로 보낼 것: 개념·어휘 나누기, 보낸 것은 다시 안 보내기
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(tmpdir(), "pc-sync-"));
process.env.PC_DATA_DIR = dir;
const { pending, markSent } = await import("../lib/sync.ts");
const { loadCourse } = await import("../lib/course.ts");

test("개념은 concept, 물어본 문법·도구는 vocab, 나오기만 한 말·프로젝트 이름은 빼고, 보낸 것은 다음에 빠진다", async () => {
  const course = await loadCourse("board-api");
  await mkdir(path.join(dir, "records"), { recursive: true });
  await mkdir(path.join(dir, "notes"), { recursive: true });
  const rec = (kind: string, at: string) => JSON.stringify({ at, runId: "r1", course: "board-api", stage: 1, knowledgeId: "k-status", knowledgeName: "HTTP 상태 코드의 뜻", kind, detail: "예측", evidence: { activity: "predict", independent: true }, source: { kind: "project", title: "x", ref: "y" } });
  await writeFile(path.join(dir, "records", "r1.jsonl"), [rec("met", "2026-10-30T01:00:00Z"), rec("wrong", "2026-10-30T01:01:00Z")].join("\n") + "\n");
  await writeFile(path.join(dir, "notes", "r1.json"), JSON.stringify({ runId: "r1", files: {}, links: [], terms: {
    await: { name: "await", scope: "문법", files: ["src/server.ts"], asked: 2, lastAt: "2026-10-30T01:02:00Z" },
    "JSON.parse": { name: "JSON.parse", scope: "도구", files: ["src/http.ts"], asked: 0, lastAt: "2026-10-30T01:02:00Z" },
    router: { name: "router", scope: "프로젝트", files: ["src/app.ts"], asked: 1, lastAt: "2026-10-30T01:02:00Z" } } }));

  const p = await pending("r1", course);
  assert.equal(p.source.ref, "project:board-api");
  const by = Object.fromEntries(p.items.map((i) => [i.title, i]));
  assert.equal(by["HTTP 상태 코드의 뜻"].kind, "concept");
  assert.ok(by["HTTP 상태 코드의 뜻"].body.includes("2xx"));
  assert.deepEqual(by["HTTP 상태 코드의 뜻"].events.map((e) => e.kind), ["wrong"]); // met은 저장이 대신한다
  assert.equal(by.await.kind, "vocab"); assert.equal(by.await.state, "unknown"); assert.equal(by.await.events.length, 2);
  assert.ok(!by["JSON.parse"]); // 설명에 나오기만 한 말은 안 보낸다
  assert.ok(!by.router);

  await markSent("r1", p.items.flatMap((i) => [i.key, ...i.events.map((e) => e.key)]));
  assert.equal((await pending("r1", course)).items.length, 0);

  // 한 번 더 물어보면 그 사건만 다시 나온다
  await writeFile(path.join(dir, "notes", "r1.json"), JSON.stringify({ runId: "r1", files: {}, links: [], terms: {
    await: { name: "await", scope: "문법", files: ["src/server.ts"], asked: 3, lastAt: "2026-10-30T02:00:00Z" } } }));
  const again = await pending("r1", course);
  assert.equal(again.items.length, 1);
  assert.deepEqual(again.items[0].events.map((e) => e.key), ["t:await:asked:3"]);
});
