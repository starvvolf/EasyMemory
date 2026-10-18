import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ModelError } from "../../ai/model.ts";
import { validateDocument, type AuthoringDocument } from "../../../../tools/problem-authoring-lab/contract.ts";
import { checkClassify, cleanPageText, mergeAcrossSections, normalizeOutline, sectionPageTexts } from "./checks.ts";
import { genFakeReply } from "./fake.ts";
import { byFocus, confirmObjectives, createGen, enqueueGen, forkGen, loadGen, studyDocument, readGenCalls, readSectionDocument, runGen, type RunOptions } from "./runner.ts";
import { authorSchema, classifySchema, designSchema, outlineSchema } from "./schemas.ts";
import type { GenStep, Issue } from "./types.ts";

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

test("기출 선택: 추상 카드 캐시, 검사 통과 문항만 게시, 원문은 출제 입력에서 분리", async () => withData(async () => {
  const card = { version: 1, asking: { recall: .25, explain: .25, apply: .25, discriminate: .25 },
    answer: { choice: .5, short: .25, worked: .25 }, conditions: { plain: .5, scenario: .25, diagram: .25 },
    traps: { none: .25, boundary: .25, signOrOrder: .25, similarConcept: .25 }, size: { minSteps: 1, maxSteps: 3 },
    difficulty: { direct: .5, linked: .25, transfer: .25 }, highWeight: { explanation: .5, calculation: .25, construction: .25 } };
  const secret = "INVENTED_PRIVATE_EXAM_SENTENCE";
  const pastExams = async () => ({ hashes: ["a".repeat(64)], texts: [secret], images: [] });
  let reject = false;
  const fakeReply = (step: GenStep, user: string) => {
    if (user.startsWith("[기출 느낌 분석]")) return JSON.stringify(card);
    if (user.startsWith("[베끼기 검사]")) {
      const questions = JSON.parse(user.split("[새 문항]\n")[1]) as Array<{ objectiveId: string }>;
      return JSON.stringify({ verdicts: questions.map((q) => ({ objectiveId: q.objectiveId, copied: reject, reason: reject ? "scenario" : "none" })) });
    }
    assert.ok(!user.includes(secret), "Exam prose must never reach ordinary author/design prompts");
    return genFakeReply(step, user);
  };
  const input = { ...base, purpose: "core", autoConfirm: true, pastExamSourceIds: ["src_" + "a".repeat(64)] };
  const first = await runGen((await createGen(input)).id, caller, { pages, pastExams, fakeReply });
  assert.equal(first.status, "done");
  assert.ok(first.sections.some((s) => (s.author?.questionCount ?? 0) > 0));
  assert.ok(first.pastExam?.checks.every((check) => check.passed));
  assert.ok((await studyDocument(first.id))?.document.title.includes("기출형"));
  const second = await runGen((await createGen(input)).id, caller, { pages, pastExams, fakeReply });
  assert.equal((await readGenCalls(second.id)).filter((call) => call.user.startsWith("[기출 느낌 분석]")).length, 0);
  const sourceId = "src_" + "b".repeat(64);
  await assert.rejects(createGen({ ...input, sourceId, pastExamSourceIds: [sourceId] }), /강의 PDF 자체/);
  const plain = await runGen((await createGen({ ...base, sourceId, purpose: "core", autoConfirm: true })).id, caller, { pages });
  await assert.rejects(forkGen(plain.id, { from: "author", pastExamSourceIds: [sourceId] }), /강의 PDF 자체/);
  reject = true;
  const third = await runGen((await createGen(input)).id, caller, { pages, pastExams, fakeReply });
  assert.equal(third.status, "done");
  assert.equal(third.sections.reduce((n, s) => n + (s.author?.questionCount ?? 0), 0), 0);
  assert.ok(third.pastExam?.checks.some((check) => check.attempt === 2 && !check.passed));
  const missingVerdicts = await runGen((await createGen(input)).id, caller, { pages, pastExams,
    fakeReply: (step, user) => user.startsWith("[베끼기 검사]") ? JSON.stringify({ verdicts: [] }) : fakeReply(step, user) });
  assert.equal(missingVerdicts.sections.reduce((n, s) => n + (s.author?.questionCount ?? 0), 0), 0);
  assert.ok(missingVerdicts.pastExam?.checks.every(check => !check.passed && check.reason.includes("누락")));
}));

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
  // Design and author calls carry the criteria they used; the criteria text is in the system prompt.
  const calls = await readGenCalls(state.id);
  for (const call of calls.filter((item) => item.step === "design" || item.step === "author")) {
    assert.equal(call.guide?.dir, "출제기준");
    assert.match(call.guide!.version, /^[a-f0-9]{12}$/);
    assert.match(call.system, call.step === "design" ? /\[설계-1\]/ : /\[출제-1\]/);
  }
  assert.ok(calls.filter((item) => item.step === "outline" || item.step === "classify").every((item) => !item.guide));
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

test("출제기준 폴더가 깨져 있으면 실패가 아니라 멈춤이고, 고친 뒤 이어간다", () => withData(async () => {
  const state = await createGen({ ...base, purpose: "core", autoConfirm: true, guideDir: "출제기준-없는폴더" });
  const paused = await runGen(state.id, caller, { pages });
  assert.equal(paused.status, "paused-invalid");
  assert.match(paused.message, /출제기준 파일이 없습니다/);
}));

test("실제 모델 생성은 호출 확인 없이 대기열에 넣지 않는다", () => withData(async () => {
  const state = await createGen({ ...base, provider: "chatgpt", purpose: "core" });
  await assert.rejects(enqueueGen(state.id, caller, { pages }), /실제 모델 호출 확인/);
  assert.equal((await readGenCalls(state.id)).length, 0);
}));

// Two sections share page 1: the second starts mid-page (the Cornell layout from the 10/12 live run).
const SHARED = new Map([
  [1, "Breadth-first search  Visit nodes in order of distance from u. Use a queue instead of a stack.  Reducing the potential maximum size of the queue  Each edge may add a vertex to the queue."],
  [2, "A boolean array records whether each vertex has been in the queue."],
]);
const sharedOutline = JSON.stringify({ sections: [
  { title: "Breadth-first search", startText: "Breadth-first search", pageStart: 1, pageEnd: 1 },
  { title: "Reducing the potential maximum size of the queue", startText: "Reducing the potential maximum size", pageStart: 1, pageEnd: 2 },
] });

test("한 쪽을 두 목차가 나눠 쓰면 시작 글자 위치에서 잘라 각 목차에 자기 부분만 준다", () => {
  const { sections } = normalizeOutline(JSON.parse(sharedOutline), [1, 2]);
  const first = sectionPageTexts(sections[0], sections, SHARED).texts.get(1)!;
  const second = sectionPageTexts(sections[1], sections, SHARED);
  assert.ok(first.includes("Use a queue instead of a stack.") && !first.includes("Reducing"));
  assert.ok(second.texts.get(1)!.startsWith("Reducing the potential") && !second.texts.get(1)!.includes("Use a queue"));
  assert.equal(second.texts.get(2), SHARED.get(2));
  // A quote from the earlier section no longer passes for the later one.
  const checked = checkClassify({ items: [{ kind: "핵심 지식", content: "x", quote: "Use a queue instead of a stack.", page: 1 }] }, sections[1], second.texts);
  assert.equal(checked.items.length, 0);
  // A start that cannot be found keeps the whole page and says so.
  const lost = sectionPageTexts({ ...sections[1], startText: "nowhere to be found", title: "also missing" }, sections, SHARED);
  assert.ok(lost.texts.get(1)!.includes("Use a queue") && lost.warnings.some((warning) => warning.code === "section-start-not-found"));
});

test("실행에서도 뒤 목차의 분류 입력에는 앞 목차 글이 들어가지 않는다", () => withData(async () => {
  const fakeReply = (step: GenStep, user: string) => step === "outline" ? sharedOutline : genFakeReply(step, user);
  const state = await createGen({ ...base, purpose: "core", autoConfirm: true });
  const done = await runGen(state.id, caller, { pages: async () => SHARED, fakeReply });
  assert.equal(done.status, "done", done.message);
  const classify = (await readGenCalls(state.id)).filter((call) => call.step === "classify");
  const second = classify.find((call) => call.sectionId === "s2")!;
  assert.ok(!second.user.includes("Use a queue instead of a stack.") && second.user.includes("Each edge may add"));
  assert.match(second.user, /\[같은 쪽의 다른 목차\(다루지 않음\)\] Breadth-first search/);
}));

test("목차가 달라도 떠올릴 것이 같으면 뒤 목표를 앞 목표에 합친다", () => {
  const objective = (id: string, sectionId: string, recall: string) => ({ id, sectionId, statement: "s", cue: "c", recall, kind: "개념" as const, importance: "core" as const, itemNumbers: [1], materialNumbers: [], pages: [1], quotes: ["q"] });
  const sections = [
    { design: { objectives: [objective("s1-o1", "s1", "Use a queue")], warnings: [] as Issue[] } },
    { design: { objectives: [objective("s2-o1", "s2", "use a  QUEUE"), objective("s2-o2", "s2", "boolean array")], warnings: [] as Issue[] } },
  ];
  mergeAcrossSections(sections);
  assert.deepEqual(sections[1].design.objectives.map((item) => item.id), ["s2-o2"]);
  assert.equal(sections[1].design.warnings[0].ref, "s1-o1");
});

test("보조 목표는 기본으로 고르지 않고(통암기는 전부), 자동 확인도 같은 규칙을 따른다", () => withData(async () => {
  const fakeReply = (step: GenStep, user: string) => {
    if (step !== "design") return genFakeReply(step, user);
    const objective = (recall: string, importance: string) => ({ statement: "떠올릴 수 있다", cue: "실마리", recall, kind: "개념", importance, itemNumbers: [1], materialNumbers: [] });
    return JSON.stringify({ objectives: [objective("queue holds waiting vertices", "core"), objective("boolean array records visits", "support")] });
  };
  for (const [purpose, expected] of [["core", ["s1-o1"]], ["all", ["s1-o1", "s1-o2"]]] as const) {
    const state = await createGen({ ...base, pageNumbers: [1], purpose, autoConfirm: true });
    const done = await runGen(state.id, caller, { pages, fakeReply });
    assert.deepEqual(done.confirmedObjectiveIds, expected, purpose);
  }
}));

test("입력칸의 지시 문구는 지우고 경고로 남기며, 짧은 꼬리표는 둔다", async () => {
  const { inputLabel } = await import("./layout.ts");
  assert.equal(inputLabel("떠올린 뒤 모범 답과 비교하세요. "), "");
  assert.equal(inputLabel("내가 떠올린 조건: "), "");
  assert.equal(inputLabel("답을 쓰세요"), "");
  assert.equal(inputLabel("자료구조: "), "자료구조:");
  assert.equal(inputLabel("단위: ms"), "단위: ms");
  await withData(async () => {
    const fakeReply = (step: GenStep, user: string) => {
      if (step !== "author") return genFakeReply(step, user);
      const reply = JSON.parse(genFakeReply(step, user)) as { questions: Array<{ answer: { before: string } }> };
      for (const question of reply.questions) question.answer.before = "떠올린 뒤 모범 답과 비교하세요.";
      return JSON.stringify(reply);
    };
    const state = await createGen({ ...base, pageNumbers: [1], purpose: "core", autoConfirm: true });
    const done = await runGen(state.id, caller, { pages, fakeReply });
    const document = await readSectionDocument(state.id, "s1") as AuthoringDocument;
    const blank = document.questions[0].blocks.find((block) => block.kind === "blank") as { promptBefore: string };
    assert.equal(blank.promptBefore, "");
    assert.ok(done.sections[0].author!.warnings.some((warning) => warning.code === "meta-label-removed"));
  });
});

test("점수표는 형식·종류·안 쓰인 항목·의심 신호·비용을 숫자로 낸다(모델 호출 없음)", () => withData(async () => {
  const { scorecard } = await import("./scorecard.ts");
  const fakeReply = (step: GenStep, user: string) => {
    if (step === "design") return JSON.stringify({ objectives: [{ statement: "방법을 고를 수 있다", cue: "실마리", recall: `방문 표시와 같은 방법 (${/\[목차\] (.+?) \(/.exec(user)?.[1]})`, kind: "절차", importance: "core", itemNumbers: [1], materialNumbers: [] }] });
    return genFakeReply(step, user);
  };
  const state = await createGen({ ...base, purpose: "core", autoConfirm: true });
  const done = await runGen(state.id, caller, { pages, fakeReply });
  const documents = new Map(await Promise.all(done.sections.map(async (section) => [section.id, await readSectionDocument(state.id, section.id) as AuthoringDocument] as const)));
  const score = scorecard(done, await readGenCalls(state.id), documents);
  assert.equal(score.counts.questions, 2);
  assert.equal(score.formats.selfCheck, 2);
  assert.equal(score.formats.selfCheckRatio, 1);
  assert.deepEqual(score.objectiveKinds, { 절차: 2 });
  assert.equal(score.calls.total, 7);
  assert.deepEqual(score.suspects.map((item) => item.code).sort(), ["recall-pointer", "recall-pointer", "verb-format", "verb-format"]);
  assert.equal(score.judge, null);
}));

test("앞 단계 고정 재실행: 목차·분류(출제만이면 목표까지)를 그대로 쓰고 뒤 단계만 다시 부른다", () => withData(async () => {
  const first = await createGen({ ...base, purpose: "core", autoConfirm: true, models: { design: { model: "gpt-6-luna", effort: "low" } } });
  const done = await runGen(first.id, caller, { pages });
  assert.equal(done.status, "done");

  const design = await forkGen(first.id, { from: "design", models: { design: { model: "gpt-6-sol", effort: "medium" } }, guideDir: "출제기준-테스트없음" });
  assert.deepEqual(design.forkOf, { genId: first.id, from: "design" });
  assert.equal(design.input.models.design?.model, "gpt-6-sol");
  assert.equal(design.input.guideDir, "출제기준-테스트없음");
  assert.ok(design.sections.every((section) => section.classify && !section.design && !section.author));
  // This criteria folder does not exist (an unused name, so the test does not depend on which folders exist), so design pauses; the copied outline/classify are never called again.
  const paused = await runGen(design.id, caller, { pages });
  assert.equal(paused.status, "paused-invalid");
  assert.deepEqual(await steps(design.id), []);

  const again = await forkGen(first.id, { from: "design" });
  const redone = await runGen(again.id, caller, { pages });
  assert.equal(redone.status, "done", redone.message);
  assert.deepEqual((await steps(again.id)).sort(), ["author:s1#1", "author:s2#1", "design:s1#1", "design:s2#1"]);
  assert.deepEqual(redone.sections.map((section) => section.classify!.items), done.sections.map((section) => section.classify!.items));

  const author = await forkGen(first.id, { from: "author" });
  assert.deepEqual(author.confirmedObjectiveIds, done.confirmedObjectiveIds);
  const authored = await runGen(author.id, caller, { pages });
  assert.equal(authored.status, "done");
  assert.deepEqual((await steps(author.id)).sort(), ["author:s1#1", "author:s2#1"]);
  assert.deepEqual(authored.sections.map((section) => section.design!.objectives), done.sections.map((section) => section.design!.objectives));

  const waiting = await createGen({ ...base, purpose: "core" });
  await assert.rejects(forkGen(waiting.id, { from: "design" }), /내용 분류가 끝나지/);
  await assert.rejects(forkGen(first.id, { from: "outline" }));
}));

test("PDF 글자 층의 깨진 하이픈(㎿)을 하이픈으로 고친다", () => {
  assert.equal(cleanPageText("Composite Two㎿Dimensional Rotations"), "Composite Two-Dimensional Rotations");
  assert.equal(cleanPageText("An   𝑥 ㎿direction shear"), "An   𝑥-direction shear");
});

test("공부 화면용: 목차 문서를 하나로 묶고, 공부 화면에서 만든 실행만 따로 고를 수 있다", () => withData(async () => {
  const state = await createGen({ ...base, purpose: "core", autoConfirm: true, origin: "study" });
  assert.equal(state.input.origin, "study");
  assert.equal((await createGen({ ...base, purpose: "core" })).input.origin, "lab");
  assert.equal(await studyDocument(state.id), null, "no questions yet");
  const done = await runGen(state.id, caller, { pages });
  const deck = (await studyDocument(state.id))!;
  assert.equal(deck.document.questions.length, done.sections.reduce((sum, section) => sum + (section.author?.questionCount ?? 0), 0));
  assert.deepEqual(validateDocument(deck.document).filter((issue) => issue.severity === "error"), []);
  assert.equal(deck.meta.id, state.id);
  assert.equal(deck.meta.title, "bfs · p.1–2");
  assert.match(deck.meta.artifactSha256, /^[a-f0-9]{64}$/);
}));

test("그림 쪽 읽기: 글자 적은 쪽을 이미지로 한 번 읽어 원문으로 쓰고, 못 그린 쪽은 글자 층으로 두며, 재실행은 다시 읽지 않는다", () => withData(async () => {
  const state = await createGen({ ...base, purpose: "core", autoConfirm: true, readImages: true });
  const seen: string[] = [];
  const fakeReply = (step: GenStep, user: string) => {
    if (step === "transcribe") { seen.push(user); return "Matrix page: the composite rotation is R(θ1+θ2) and it is read from the picture."; }
    return genFakeReply(step, user);
  };
  // Page 2 cannot be rendered: it keeps its text layer.
  const pageImages = async (_input: unknown, wanted: number[]) => new Map(wanted.filter((page) => page === 1).map((page) => [page, "data:image/jpeg;base64,AAAA"]));
  const done = await runGen(state.id, caller, { pages, fakeReply, pageImages });
  assert.equal(done.status, "done", done.message);
  assert.deepEqual(done.images, { pages: [1, 2], done: [1], failed: [2] });
  assert.match(seen[0], /\[글자 층\]\nBreadth-first search/);
  assert.ok(done.outlineWarnings?.some((warning) => warning.code === "image-read-failed"));
  const calls = await readGenCalls(state.id);
  assert.equal(calls.filter((call) => call.step === "transcribe").length, 1, "page 1 once; page 2 had no image, so no call");
  // Later steps read the page-1 reading instead of its text layer; page 2 keeps its text layer.
  const classify = calls.filter((call) => call.step === "classify").map((call) => call.user).join("\n");
  assert.match(classify, /Matrix page: the composite rotation/);
  assert.match(classify, /boolean array records/);
  assert.ok(!classify.includes("visits vertices in order of distance"));

  const rerun = await forkGen(state.id, { from: "design" });
  const again = await runGen(rerun.id, caller, { pages, fakeReply, pageImages });
  assert.equal(again.status, "done", again.message);
  assert.ok(!(await steps(rerun.id)).some((step) => step.startsWith("transcribe")));
  const imageSection = again.sections.find((section) => section.pages.includes(1));
  assert.ok(imageSection, "the image-backed section is retained");
  const imageDesign = (await readGenCalls(rerun.id)).find((call) => call.step === "design" && call.sectionId === imageSection.id);
  assert.ok(imageDesign, "the image-backed section is redesigned");
  assert.match(imageDesign.user, /Matrix page/);
}));

test("신고한 문제 다시 만들기: 그 목표만 출제하고, 이전 문제를 보여 주며, 공부 화면에서 따로 붙는다", () => withData(async () => {
  const first = await createGen({ ...base, purpose: "core", autoConfirm: true, origin: "study" });
  const done = await runGen(first.id, caller, { pages });
  const target = done.sections[1].design!.objectives[0].id;
  await assert.rejects(forkGen(first.id, { from: "design", objectiveIds: [target] }), /출제만 다시/);
  await assert.rejects(forkGen(first.id, { from: "author", objectiveIds: ["s9-o9"] }), /없습니다/);
  const remake = await forkGen(first.id, { from: "author", objectiveIds: [target] });
  assert.deepEqual(remake.confirmedObjectiveIds, [target]);
  assert.ok(remake.input.remake?.previous[target]?.includes("→ 답:"));
  const redone = await runGen(remake.id, caller, { pages });
  assert.equal(redone.status, "done", redone.message);
  assert.deepEqual(await steps(remake.id), ["author:s2#1"]);
  assert.match((await readGenCalls(remake.id))[0].user, /\[다시 만들기: 학습자가 이상하다고 신고한 이전 문제/);
  const deck = (await studyDocument(remake.id))!;
  assert.match(deck.meta.title, /다시 만든 문제$/);
  assert.equal(deck.document.questions.length, 1);
}));

test("쪽마다 잘린 목차는 코드가 공부 단위(4쪽에 1개 이하)로 묶는다", () => {
  const pages = Array.from({ length: 52 }, (_, index) => index + 1);
  const result = normalizeOutline({ sections: pages.map((page) => ({ title: `슬라이드 ${page}`, pageStart: page, pageEnd: page })) }, pages);
  assert.equal(result.sections.length, 13);
  assert.deepEqual(result.sections.flatMap((section) => section.pages), pages, "every page once, in order");
  assert.deepEqual(result.sections.map((section) => section.id), result.sections.map((_, index) => `s${index + 1}`));
  assert.ok(result.warnings.some((warning) => warning.code === "outline-merged"));
  assert.match(result.sections[0].title, /슬라이드 1/);
  // Small selections keep their sections.
  assert.equal(normalizeOutline({ sections: [{ title: "A", pageStart: 1, pageEnd: 1 }, { title: "B", pageStart: 2, pageEnd: 2 }] }, [1, 2]).sections.length, 2);
});

test("강의 안내(학습목표 목록·수업 순서·평가 비율)만 근거인 목표는 다시 묻지 않고 뺀다", async () => {
  const { checkDesign } = await import("./checks.ts");
  const section = { id: "s1", title: "안내", pages: [5] };
  const items = [{ n: 1, kind: "학습 지시" as const, content: "성적 반영: 시험 70%", quote: "시험(지필고사): 70%", page: 5 },
    { n: 2, kind: "핵심 지식" as const, content: "기업윤리의 정의", quote: "기업윤리란", page: 5 }];
  const draft = (itemNumbers: number[], recall: string) => ({ statement: `${recall}를 말할 수 있다`, cue: "?", recall, kind: "사실" as const, importance: "core" as const, itemNumbers, materialNumbers: [] });
  const checked = checkDesign({ objectives: [draft([1], "시험 70%"), draft([2], "기업윤리의 정의")] }, section, items);
  assert.equal(checked.objectives.length, 1);
  assert.equal(checked.problems.length, 0);
  assert.ok(checked.warnings.some((warning) => warning.code === "course-admin-dropped"));
});

test("같은 PDF를 다시 만들면 앞 실행의 그림 쪽 읽기를 그대로 쓴다", () => withData(async () => {
  const pageImages = async (_input: unknown, wanted: number[]) => new Map(wanted.map((page) => [page, "data:image/jpeg;base64,AAAA"]));
  const first = await createGen({ ...base, purpose: "core", autoConfirm: true, readImages: true });
  await runGen(first.id, caller, { pages, pageImages });
  const second = await createGen({ ...base, purpose: "understand", autoConfirm: true, readImages: true });
  const done = await runGen(second.id, caller, { pages, pageImages });
  assert.equal(done.status, "done", done.message);
  assert.deepEqual(done.images?.done.sort(), [1, 2]);
  assert.ok(!(await steps(second.id)).some((step) => step.startsWith("transcribe")));
}));

test("목차는 두 단계: 단원 아래 세부 항목이 쪽을 나눠 갖고, 단원을 묶어도 세부 항목은 남는다", () => {
  const pages = [1, 2, 3, 4, 5, 6];
  const two = normalizeOutline({ sections: [
    { title: "변환", startText: "", pageStart: 1, pageEnd: 6, parts: [{ title: "이동", pageStart: 1 }, { title: "회전", pageStart: 3 }, { title: "확대", pageStart: 5 }] },
  ] }, pages);
  assert.deepEqual(two.sections[0].parts, [{ title: "이동", pages: [1, 2] }, { title: "회전", pages: [3, 4] }, { title: "확대", pages: [5, 6] }]);
  const many = Array.from({ length: 20 }, (_, index) => index + 1);
  const merged = normalizeOutline({ sections: many.map((page) => ({ title: `슬라이드 ${page}`, startText: "", pageStart: page, pageEnd: page, parts: [] })) }, many);
  assert.equal(merged.sections.length, 5);
  assert.deepEqual(merged.sections.flatMap((section) => section.parts!.map((part) => part.title)), many.map((page) => `슬라이드 ${page}`));
});

test("순서 단답(이름을 화살표로 잇기)은 '한 칸 여러 요소'로 떨어뜨리지 않는다", async () => {
  const { inspectQuestion, isOrderAnswer } = await import("./layout.ts");
  const question = (accepted: string[]) => ({
    id: "q", page: { width: 760, height: 300 },
    source: { learningUnitId: "o", objectiveId: "o", sourceId: "a.pdf", sourcePage: 1, sourceRange: "PDF 1쪽", sourceText: "x축 회전 뒤 y축 회전", target: "t", successCriteria: ["c"] },
    blocks: [{ id: "b1", kind: "text" as const, text: "두 회전을 적용하는 순서는?", frame: { x: 0, y: 0, width: 10, height: 10 } },
      { id: "input", kind: "blank" as const, responseId: "r", promptBefore: "순서(→로 구분):", promptAfter: "", frame: { x: 0, y: 0, width: 10, height: 10 } },
      { id: "reveal", kind: "answer-reveal" as const, responseIds: ["r"], frame: { x: 0, y: 0, width: 10, height: 10 } }],
    responses: [{ id: "r", kind: "short-text" as const, acceptedAnswers: accepted, grading: "exact-normalized" as const, explanation: "e" }],
  });
  assert.equal(isOrderAnswer(question(["x축 → y축"])), true);
  assert.ok(!inspectQuestion(question(["x축 → y축"])).errors.some((issue) => issue.code === "composite-short-answer"));
  assert.ok(inspectQuestion(question(["a; b; c"])).errors.some((issue) => issue.code === "composite-short-answer"));
});

test("내용이 있는데 분류 항목이 없는 쪽은 다시 묻는다", () => {
  const section = { id: "s5", title: "투영", pages: [19, 20] };
  const texts = new Map([[19, "Perspective projection: x_p = x * d / z, y_p = y * d / z. The field of view (FOV) determines the angle of the view volume, and the projection plane distance d follows from the FOV and the window height."],
    [20, "Parallel projection keeps lines parallel and is used for engineering drawings and orthographic views of objects."]]);
  const checked = checkClassify({ items: [{ kind: "핵심 지식", content: "평행 투영", quote: "Parallel projection keeps lines parallel", page: 20 }] }, section, texts);
  assert.equal(checked.items.length, 1);
  assert.match(checked.problems.map((problem) => problem.message).join(), /p\.19에 분류 항목이 하나도 없습니다/);
});

test("공부 화면: 구분자 없이 쓴 LaTeX 정답은 수식으로 감싼다", async () => {
  const { showMath } = await import("../from-authoring.ts");
  assert.equal(showMath("\\begin{bmatrix}1&sh_x\\\\0&1\\end{bmatrix}"), "$\\begin{bmatrix}1&sh_x\\\\0&1\\end{bmatrix}$");
  assert.equal(showMath("x' = x\\cos\\theta - y\\sin\\theta\ny' = x\\sin\\theta + y\\cos\\theta"), "$x' = x\\cos\\theta - y\\sin\\theta$\n$y' = x\\sin\\theta + y\\cos\\theta$");
  assert.equal(showMath("행렬은 \\begin{bmatrix}1&0\\end{bmatrix} 이다"), "행렬은 $\\begin{bmatrix}1&0\\end{bmatrix}$ 이다");
  assert.equal(showMath("큐에 들어간 적 없는 정점"), "큐에 들어간 적 없는 정점");
  assert.equal(showMath("$a^{2}$"), "$a^{2}$");
});

test("v3: 전체 읽기 → 출제 계획 → 출제, 관문이 '꺼낼 것'을 본문에 쓴 문항을 다시 쓰게 한다", async () => withData(async () => {
  const sent: string[] = [];
  const fakeReply = (step: GenStep, user: string, attempt: number) => {
    sent.push(step);
    const reply = genFakeReply(step, user);
    if (step !== "author" || attempt !== 1) return reply;
    // First try writes what must be recalled into the stem and asks for something countable from it, so the answer
    // itself is not in the stem (그래픽스03 q-s6-o5: the bit table is given, "which bit is near?" → 5).
    const parsed = JSON.parse(reply) as { questions: Array<{ stem: Array<{ text: string }>; answer: { kind: string; accepted: string[] } }> };
    parsed.questions[0].stem[0].text = `${parsed.questions[0].answer.accepted[0]} 위 문장의 낱말 수는?`;
    parsed.questions[0].answer = { ...parsed.questions[0].answer, kind: "short", accepted: ["17"] };
    return JSON.stringify(parsed);
  };
  const run = await runGen((await createGen({ ...base, purpose: "core", autoConfirm: true, engine: "v3" })).id, caller,
    { pages, fakeReply, pdf: async () => new Uint8Array([37, 80, 68, 70]) });
  assert.equal(run.status, "done", run.message);
  const order = await steps(run.id);
  // Outline first, then one map call per unit, then the plan.
  const planAt = order.indexOf("plan#1");
  assert.equal(order[0], "read#1");
  assert.ok(planAt > 1 && order.slice(1, planAt).every((step) => step.startsWith("read:s")), order.join(" "));
  // The derivability check sees only the learner's view, never the unit source (first real run: it quoted the source).
  const gateCalls = (await readGenCalls(run.id)).filter((call) => call.step === "gate");
  assert.ok(gateCalls.some((call) => call.system.startsWith("너는 이 과목을 공부하지 않은") && !call.user.includes("[단원 원문]")));
  assert.ok(!order.some((step) => /^(outline|classify|design|transcribe)/.test(step)), "v3 does not run the v2 steps");
  // PDF 1회 통제: only the outline call carries the PDF.
  assert.deepEqual((await readGenCalls(run.id)).filter((call) => call.withPdf).map((call) => `${call.step}#${call.attempt}:${call.sectionId ?? ""}`), ["read#1:"]);
  const gate = run.v3?.gate ?? [];
  const leaked = gate.find((verdict) => verdict.attempt === 1 && !verdict.passed);
  assert.ok(leaked?.reasons.some((reason) => reason.includes("꺼낼 것")), "the code gate catches the recall written into the stem");
  assert.ok(gate.some((verdict) => verdict.objectiveId === leaked!.objectiveId && verdict.attempt === 2 && verdict.passed), "re-authored once and passed");
  const objectives = run.sections.flatMap((section) => section.design?.objectives ?? []);
  assert.equal(run.sections.reduce((sum, section) => sum + (section.author?.questionCount ?? 0), 0), objectives.length);
  assert.ok(objectives.every((objective) => objective.given && objective.qtype));
  assert.ok((await studyDocument(run.id))?.document.questions.length);
}));

test("v3 만들면서 읽기: 두 번 걸린 문항은 보류(공개 안 함), 다시 만들기는 지도를 다시 읽지 않음, 읽는 단원부터", async () => withData(async () => {
  // Always writes the recall into the stem, so the gate fails it both times.
  const fakeReply = (step: GenStep, user: string) => {
    const reply = genFakeReply(step, user);
    if (step !== "author") return reply;
    const parsed = JSON.parse(reply) as { questions: Array<{ stem: Array<{ text: string }>; answer: { kind: string; accepted: string[] } }> };
    parsed.questions[0].stem[0].text = `${parsed.questions[0].answer.accepted[0]} 위 문장의 낱말 수는?`;
    parsed.questions[0].answer = { ...parsed.questions[0].answer, kind: "short", accepted: ["17"] };
    return JSON.stringify(parsed);
  };
  const run = await runGen((await createGen({ ...base, purpose: "core", autoConfirm: true, engine: "v3" })).id, caller,
    { pages, fakeReply, pdf: async () => new Uint8Array([37, 80, 68, 70]) });
  // The flow marks come in the order the reader shows them: outline, goals, then units, then done.
  const events = (run.timeline ?? []).map((mark) => mark.event);
  const at = (event: string) => events.indexOf(event as never);
  assert.ok(at("start") < at("outline") && at("outline") < at("plan") && at("plan") < at("unit-done") && events.at(-1) === "done", events.join(" "));
  const held = run.sections.flatMap((section) => section.author?.dropped ?? []);
  assert.ok(held.some((drop) => drop.reason.startsWith("보류")), "held back after the second failure");
  const shown = (await studyDocument(run.id))?.document.questions ?? [];
  assert.ok(!shown.some((question) => held.some((drop) => question.id.includes(drop.objectiveId))), "held questions are not published");
  const fork = await forkGen(run.id, { from: "author" });
  assert.ok(fork.v3?.map, "the knowledge map is carried over");
  const rerun = await runGen(fork.id, caller, { pages, pdf: async () => new Uint8Array([37, 80, 68, 70]) });
  assert.ok(!(await steps(rerun.id)).some((step) => step.startsWith("read")), "remake does not read the PDF again");
  // Reading order: the unit with the page, then the ones after it, then the ones before.
  const units = [{ id: "a", pages: [1, 2] }, { id: "b", pages: [3, 4] }, { id: "c", pages: [5] }];
  assert.deepEqual(byFocus(units, 3).map((unit) => unit.id), ["b", "c", "a"]);
}));
