import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ModelError } from "../../ai/model.ts";
import { validateDocument, type AuthoringDocument } from "../../../../tools/problem-authoring-lab/contract.ts";
import { normalizeOutline } from "./checks.ts";
import { genFakeReply } from "./fake.ts";
import { confirmObjectives, createGen, enqueueGen, loadGen, readGenCalls, readSectionDocument, runGen, type RunOptions } from "./runner.ts";
import { authorSchema, classifySchema, designSchema, outlineSchema } from "./schemas.ts";
import type { GenStep } from "./types.ts";

const PAGES = new Map([
  [1, "Breadth-first search visits vertices in order of distance from the start. A queue holds the vertices that are waiting to be visited."],
  [2, "Adding a vertex that was already in the queue has no effect on the result. A boolean array records whether each vertex has been in the queue."],
]);
const caller = { uid: "local-experiment" };
const pages: RunOptions["pages"] = async () => PAGES;

async function withData<T>(fn: () => Promise<T>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "study-gen-"));
  const previous = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try { return await fn(); }
  finally {
    if (previous === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}
const base = { sourceId: "src_test", fileName: "bfs.pdf", pageNumbers: [1, 2], provider: "fake" as const };
const steps = async (id: string) => (await readGenCalls(id)).map((call) => `${call.step}${call.sectionId ? `:${call.sectionId}` : ""}#${call.attempt}`);

test("모든 응답 스키마는 strict 구조화 출력 규칙을 지킨다(모든 칸 required, 추가 칸 금지)", () => {
  const visit = (node: unknown, where: string) => {
    if (!node || typeof node !== "object") return;
    const schema = node as { type?: unknown; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: unknown; items?: unknown };
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (types.includes("object")) {
      assert.deepEqual([...(schema.required ?? [])].sort(), Object.keys(schema.properties ?? {}).sort(), where);
      assert.equal(schema.additionalProperties, false, where);
      for (const [key, value] of Object.entries(schema.properties ?? {})) visit(value, `${where}.${key}`);
    }
    if (schema.items) visit(schema.items, `${where}[]`);
  };
  for (const [name, schema] of Object.entries({ outlineSchema, classifySchema, designSchema, authorSchema })) visit(schema, name);
});

test("목차가 고른 쪽을 덮지 않으면 코드가 앞 항목에 붙이고, 범위 밖 항목은 뺀다", () => {
  const result = normalizeOutline({ sections: [
    { title: "B", pageStart: 4, pageEnd: 5 }, { title: "A", pageStart: 1, pageEnd: 2 }, { title: "밖", pageStart: 9, pageEnd: 9 },
  ] }, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(result.sections.map((section) => [section.id, section.title, section.pages]), [["s1", "A", [1, 2, 3]], ["s2", "B", [4, 5, 6]]]);
  assert.deepEqual(result.warnings.map((warning) => warning.code).sort(), ["outline-gap", "outline-out-of-range"]);
  assert.equal(normalizeOutline({ sections: [{ title: "밖", pageStart: 9, pageEnd: 9 }] }, [1]).sections.length, 0);
});

test("가짜 모델로 목차 → 분류·설계(목차별) → 출제(목차별)를 끝까지 돌고, 문서는 계약 검사를 통과한다", () => withData(async () => {
  const state = await createGen({ ...base, purpose: "core", autoConfirm: true });
  const done = await runGen(state.id, caller, { pages });
  assert.equal(done.status, "done", done.message);
  assert.deepEqual(done.sections.map((section) => section.pages), [[1], [2]]);
  assert.deepEqual((await steps(state.id)).sort(), ["author:s1#1", "author:s2#1", "classify:s1#1", "classify:s2#1", "design:s1#1", "design:s2#1", "outline#1"]);
  for (const section of done.sections) {
    assert.ok(section.design!.objectives.length >= 1);
    const document = await readSectionDocument(state.id, section.id) as AuthoringDocument;
    assert.deepEqual(validateDocument(document).filter((issue) => issue.severity === "error"), []);
    const question = document.questions[0];
    // The source comes from the classified quote, not from the model's authoring reply.
    assert.ok(PAGES.get(question.source.sourcePage)!.includes(question.source.sourceText));
    assert.equal(question.source.objectiveId, section.design!.objectives[0].id);
  }
}));

test("확인 단계에서 멈추고, 고른 목표만 출제한다", () => withData(async () => {
  const state = await createGen({ ...base, purpose: "core" });
  const waiting = await runGen(state.id, caller, { pages });
  assert.equal(waiting.status, "awaiting-confirm");
  assert.ok(!(await steps(state.id)).some((step) => step.startsWith("author")));
  const keep = waiting.sections[1].design!.objectives[0].id;
  await assert.rejects(confirmObjectives(state.id, ["s9-o1"]), /설계에 없는 목표/);
  await confirmObjectives(state.id, [keep]);
  await (await enqueueGen(state.id, caller, { pages }))?.finished;
  const done = (await loadGen(state.id))!;
  assert.equal(done.status, "done");
  assert.equal(done.sections[0].author!.questionCount, 0);
  assert.equal(done.sections[1].author!.questionCount, 1);
  assert.deepEqual((await steps(state.id)).filter((step) => step.startsWith("author")), ["author:s2#1"]);
}));

test("그냥 읽기는 자료 파악까지만 하고 문제를 만들지 않는다", () => withData(async () => {
  const state = await createGen({ ...base, purpose: "read" });
  const done = await runGen(state.id, caller, { pages });
  assert.equal(done.status, "done");
  assert.ok(done.sections.every((section) => section.classify && !section.design && !section.author));
  assert.deepEqual((await steps(state.id)).filter((step) => !step.startsWith("classify")), ["outline#1"]);
}));

test("원문에 없는 인용은 그 목차만 다시 시키고, 또 틀리면 그 항목만 빼고 진행한다", () => withData(async () => {
  const fakeReply = (step: GenStep, user: string, attempt: number) => {
    if (step !== "classify" || !user.includes("[p.1]")) return genFakeReply(step, user);
    const good = JSON.parse(genFakeReply(step, user)) as { items: unknown[] };
    const invented = { kind: "핵심 지식", content: "지어낸 내용", quote: `A stack is used instead (try ${attempt})`, page: 1 };
    return JSON.stringify({ items: [...good.items, invented] });
  };
  const state = await createGen({ ...base, purpose: "core", autoConfirm: true });
  const done = await runGen(state.id, caller, { pages, fakeReply });
  assert.equal(done.status, "done", done.message);
  const calls = await readGenCalls(state.id);
  assert.deepEqual(calls.filter((call) => call.step === "classify").map((call) => `${call.sectionId}#${call.attempt}`).sort(), ["s1#1", "s1#2", "s2#1"]);
  const retry = calls.find((call) => call.step === "classify" && call.attempt === 2)!;
  assert.match(retry.user, /\[이전 답\][\s\S]*\[검사에서 걸린 것\][\s\S]*A stack is used instead \(try 1\)/);
  const section = done.sections[0];
  assert.ok(section.classify!.items.every((item) => !item.quote.startsWith("A stack")));
  assert.ok(section.classify!.warnings.some((warning) => warning.code === "quote-not-found"));
}));

test("출제에서 정답이 보이는 문항만 다시 시키고, 또 걸리면 그 문항만 빼고 나머지는 남긴다", () => withData(async () => {
  const fakeReply = (step: GenStep, user: string) => {
    if (step === "design") {
      const objective = (n: number, recall: string) => ({ statement: `p.${n} 내용을 떠올릴 수 있다`, cue: `${n}번 내용`, recall, kind: "개념", importance: "core", itemNumbers: [1], materialNumbers: [] });
      return JSON.stringify({ objectives: [objective(1, "queue holds waiting vertices"), objective(2, "boolean array records visits")] });
    }
    if (step === "author") {
      const ids = [...user.matchAll(/^- id: (\S+)/gm)].map((match) => match[1]);
      return JSON.stringify({ questions: ids.map((objectiveId) => ({
        objectiveId,
        // The second objective always shows its answer in the stem.
        stem: [{ kind: "text", text: objectiveId.endsWith("o2") ? "Answer: boolean array records visits" : "무엇을 떠올려야 하나요?", latex: null, rows: null }],
        answer: { kind: "self-check", options: null, correctIndex: null, accepted: [objectiveId.endsWith("o2") ? "boolean array records visits" : "queue holds waiting vertices"], before: "", after: "", explanation: "원문 참고" },
      })) });
    }
    return genFakeReply(step, user);
  };
  const state = await createGen({ ...base, pageNumbers: [1], purpose: "core", autoConfirm: true });
  const done = await runGen(state.id, caller, { pages, fakeReply });
  assert.equal(done.status, "done", done.message);
  const author = done.sections[0].author!;
  assert.equal(author.questionCount, 1);
  assert.deepEqual(author.dropped.map((drop) => drop.objectiveId), ["s1-o2"]);
  const calls = (await readGenCalls(state.id)).filter((call) => call.step === "author");
  assert.equal(calls.length, 2);
  assert.ok(!/- id: s1-o1/.test(calls[1].user.split("[이전 답]")[0]), "the retry asks only for the failing objective");
  const document = await readSectionDocument(state.id, "s1") as AuthoringDocument;
  assert.deepEqual(document.questions.map((question) => question.source.objectiveId), ["s1-o1"]);
}));

test("사용량 한도면 멈추고, 다시 시작하면 끝난 단계는 다시 부르지 않는다", () => withData(async () => {
  let limited = true;
  const fakeReply = (step: GenStep, user: string) => {
    if (step === "author" && limited) throw new ModelError("usage_limit", "limit");
    return genFakeReply(step, user);
  };
  const state = await createGen({ ...base, purpose: "core", autoConfirm: true });
  const paused = await runGen(state.id, caller, { pages, fakeReply });
  assert.equal(paused.status, "paused-usage-limit");
  const before = (await readGenCalls(state.id)).length;
  limited = false;
  const done = await runGen(state.id, caller, { pages, fakeReply });
  assert.equal(done.status, "done", done.message);
  const after = await readGenCalls(state.id);
  assert.deepEqual(after.slice(before).map((call) => call.step), ["author", "author"]);
}));

test("실제 모델 생성은 호출 확인 없이 대기열에 넣지 않는다", () => withData(async () => {
  const state = await createGen({ ...base, provider: "chatgpt", purpose: "core" });
  await assert.rejects(enqueueGen(state.id, caller, { pages }), /실제 모델 호출 확인/);
  assert.equal((await readGenCalls(state.id)).length, 0);
}));
