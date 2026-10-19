import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { astraFakeReply, getAstraReadingView, runAstra, type AstraAsk } from "./astra.ts";
import * as astrav2 from "./astrav2.ts";
import * as astrav3 from "./astrav3.ts";
import { responseRequest, sendWithFallback } from "../../ai/chatgpt-provider.ts";
import { confirmObjectives, createGen, forkGen, readGenCalls, readSectionDocument, runGen } from "./runner.ts";
import type { GenState, GenStep } from "./types.ts";

// Public invented fixture, not the private graphics question. This checks fail-closed orchestration,
// NOT whether an AI can detect a defect: the fake solver explicitly reports the known relation leak.
test("astra: 확인 후 전체 흐름, 반복된 관계 노출은 독립 풀이 경고가 해소되기 전 공개하지 않는다", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "astra-flow-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try {
    const fakeReply = (step: GenStep, user: string, attempt: number) => {
      const result = JSON.parse(astraFakeReply(step, user));
      if (step === "astra-plan") result.practice[0].questionCount = 2;
      if (step === "astra-author") {
        for (const q of result.questions) if (q.objectiveId === "s1-o1") q.stem[0].text = "청색은 대기 상태다. 대기 상태의 색은 무엇인가?";
      }
      if (step === "astra-solve") {
        assert.ok(!user.includes('"accepted"') && !user.includes('"recall"') && !user.includes('"requiredPoints"') && !user.includes('"correctIndex"'), "독립 풀이에 정답·계획을 전달하지 않는다");
        for (const item of result.items) if (item.objectiveId === "s1-o1") item.exposedRelation = "질문이 대기와 청색의 대응을 그대로 준다.";
      }
      if (step === "astra-review" && attempt === 1) {
        for (const item of result.items) if (item.objectiveId === "s1-o1") { item.status = "revise"; item.reasons = ["알아낼 대응이 이미 제공됨"]; }
      }
      // Second editor carelessly returns ready with no rebuttal. Publication must still refuse it.
      return JSON.stringify(result);
    };
    const start = await createGen({ sourceId: "src_astra_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "astra", provider: "fake", autoConfirm: false });
    const waiting = await runGen(start.id, { uid: "local-experiment" }, { fakeReply });
    assert.equal(waiting.status, "awaiting-confirm");
    assert.equal(await readSectionDocument(start.id, "s1"), null, "검수 전에 초안을 게시하지 않는다");
    await confirmObjectives(start.id, waiting.sections[0].design!.objectives.map(o => o.id));
    const done = await runGen(start.id, { uid: "local-experiment" }, { fakeReply });
    assert.equal(done.status, "done");
    assert.equal(done.sections[0].author?.questionCount, 1, JSON.stringify(done.sections[0].author));
    assert.equal(done.sections[0].author?.dropped[0].objectiveId, "s1-o1");
    assert.match(done.sections[0].author!.dropped[0].reason, /독립 풀이/);
    const document = await readSectionDocument(start.id, "s1") as { questions: Array<{ id: string }> };
    assert.deepEqual(document.questions.map(q => q.id), ["q-s1-o2"]);
    const calls = await readGenCalls(start.id);
    assert.deepEqual(calls.map(c => c.step), ["astra-plan", "astra-author", "astra-solve", "astra-review", "astra-review", "astra-author", "astra-solve", "astra-review"]);
    // Same invented regression: distinguish a legitimate choice from stem leakage and a scope gap.
    const newer = await createGen({ sourceId: "src_astra_fixture", fileName: "invented.pdf", pageNumbers: [1], purpose: "core", engine: "astrav2", provider: "fake", autoConfirm: true });
    let pdfCalls = 0;
    await astrav2.runAstrav2({ state: newer, pdf: Buffer.from("%PDF-fixture"), pageTexts: new Map([[1, "청색은 대기, 녹색은 진행"]]), save: async () => {}, pause: (message): never => { throw new Error(message); }, publish: async () => "fixture-document",
      ask: async (step, _attempt, system, user, parser, files) => {
        if (files.length) { pdfCalls++; assert.equal(step, "astra-plan"); }
        else {
          assert.ok(user.includes("[원문 p.1]"));
          const request = responseRequest({ purpose: "fixture", system, user, caller: { uid: "fixture" }, files, cachePrefix: astrav2.ASTRA_CACHE_PREFIX, schema: astrav2.astraJsonSchema(astrav2.astraResponseSchema) });
          assert.ok(!JSON.stringify(request).includes("input_file"));
        }
        const input = JSON.parse(user);
        const result = JSON.parse(astrav2.astraFakeReply(step, user));
        if (step === "astra-plan") {
          result.outline.push({ id: "s2", title: "선택하지 않은 쪽", pages: [2] });
          result.pageNotes = [{ page: 2, text: "범위 밖 비공개 원문" }];
        }
        if (step === "astra-author") {
          for (const q of result.questions) q.answer = { kind: "choice", options: ["청색", "녹색", "적색", "황색"].map(text => ({ text, latex: null })), correctIndex: 0, accepted: null, before: null, after: null, explanation: "청색은 대기 상태다." };
        }
        if (step === "astra-solve") {
          assert.ok(!user.includes('"correctIndex"'));
          for (const item of result.items) item.exposedRelation = "보기 안에 청색이 있다";
        }
        if (step === "astra-review") {
          assert.ok(system.includes("객관식 보기에 정답이 있는 것은 정상"));
          result.items.forEach((item: { reasons: string[] }) => { item.reasons = ["보기의 청색은 선택 대상일 뿐 본문의 정답 지시가 아니다."]; });
          result.coverage.forEach((item: { status: string; reason: string }) => { item.status = "partial"; item.reason = "동일 과제의 다른 범위는 아직 충분하지 않음"; });
          assert.equal(input.candidates.length, 1);
        }
        assert.ok(!user.includes("범위 밖 비공개 원문"));
        return parser.parse(result);
      },
    });
    assert.equal(pdfCalls, 1);
    assert.equal(newer.status, "done");
    assert.equal(newer.sections.length, 1);
    assert.equal(newer.sections[0].author?.questionCount, 1, "개별 정상 문항은 coverage partial만으로 보류하지 않는다");
    assert.ok(newer.astra!.warnings.some(w => w.code === "published-review-concern"));
    const viaRunner = await runGen((await createGen({ sourceId: "fixture", fileName: "fixture.pdf", pageNumbers: [1], purpose: "core", engine: "astrav2", provider: "fake", autoConfirm: true })).id, { uid: "local-experiment" });
    assert.equal(viaRunner.status, "done", viaRunner.message);
    assert.equal(viaRunner.sections[0].author?.questionCount, 1);
  } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
});

test("astra: 첫 묶음 조기 공개, 병렬 중단·재개, 후발 결함은 공개 문항을 바꾸지 않는다", async () => {
  const state: GenState = { id: "gen_" + "0".repeat(32), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), input: { sourceId: "fixture", fileName: "fixture.pdf", pageNumbers: [1, 2], purpose: "core", note: "", provider: "fake", engine: "astra", models: {}, signals: { weakSpots: [], reports: [] }, autoConfirm: true }, status: "running", phase: "outline", message: "", calls: 0, sections: [] };
  let priority = 2;
  let active = 0, peak = 0, stopped = false, failOnce = true;
  const calls: string[] = [], documents = new Map<string, string>();
  const ask: AstraAsk = async (step, _attempt, _system, user, parser) => {
    assert.equal(stopped, false, "실패 후 새 요청을 시작하지 않는다");
    active++; peak = Math.max(peak, active); calls.push(step);
    try {
      const input = JSON.parse(user);
      if (step === "astra-author" && input.slots[0].id !== "s2-o1") {
        assert.ok(documents.has("s2"), "현재 읽는 두 번째 단원이 먼저 공개된다");
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      if (step === "astra-solve" && input.questions[0].objectiveId === "s1-o1" && failOnce) {
        failOnce = false; stopped = true; throw new Error("simulated usage stop");
      }
      const result = JSON.parse(astraFakeReply(step, user));
      if (step === "astra-plan") {
        result.outline = [{ id: "s1", title: "앞 단원", pages: [1] }, { id: "s2", title: "읽는 단원", pages: [2] }];
        result.concepts.push({ ...result.concepts[0], id: "c2", outlineIds: ["s2"], evidence: [{ ...result.concepts[0].evidence[0], page: 2 }] });
        result.practice = Array.from({ length: 4 }, (_, i) => ({ ...result.practice[0], id: `p${i + 1}`, sectionId: i === 3 ? "s2" : "s1", conceptIds: [i === 3 ? "c2" : "c1"], questionCount: 3 }));
      }
      if (step === "astra-review") {
        result.coverage = input.selectedPracticeIds.map((id: string) => ({ practiceId: id, questionIds: input.candidates.filter((q: { practiceIds: string[] }) => q.practiceIds.includes(id)).map((q: { objectiveId: string }) => q.objectiveId), status: "covered", reason: "fixture" }));
        if (input.scope === "global") {
          for (const item of result.items) if (item.objectiveId === "s2-o1") { item.status = "revise"; item.reasons = ["후발 조건 누락 발견"]; }
          result.missedContent = [{ pages: [1], reason: "신고 범위 밖의 추가 과제" }];
        }
      }
      return parser.parse(result);
    } finally { active--; }
  };
  const context = { state, pdf: Buffer.from("%PDF-fixture"), ask, save: async () => {}, getPriorityPage: async () => priority, pause: (message: string): never => { throw new Error(message); }, publish: async (section: { id: string }, questions: unknown[]) => { documents.set(section.id, JSON.stringify(questions)); priority = 1; return `sections/${section.id}/document.json`; } };
  await assert.rejects(runAstra(context), /simulated usage stop/);
  assert.equal(active, 0, "실패한 실행은 진행 중 작업을 정리한 뒤 반환한다");
  assert.equal(peak, 2);
  const first = JSON.parse(documents.get("s2")!)[0];
  assert.equal(state.astra!.batches[0].ids[0], "s2-o1");
  const planCalls = calls.filter(s => s === "astra-plan").length;
  stopped = false;
  state.input.remake = { genId: "previous", previous: {}, reasons: { "s2-o1": "조건 부족" } };
  await runAstra(context);
  assert.equal(calls.filter(s => s === "astra-plan").length, planCalls, "계획 재호출 없이 재개한다");
  assert.equal(state.status, "done");
  assert.deepEqual(JSON.parse(documents.get("s2")!)[0], first, "전역 검수 후에도 공개 문항은 불변이다");
  assert.ok(state.astra!.warnings.some(w => w.ref === "s2-o1" && w.message.includes("후발")));
  assert.equal(state.sections.flatMap(s => s.design!.objectives).length, 12, "신고 재생성은 미계획 과제를 덧붙이지 않는다");
  assert.deepEqual(JSON.parse(documents.get("s1")!).map((q: { id: string }) => q.id), Array.from({ length: 9 }, (_, i) => `q-s1-o${i + 1}`));
  const view = getAstraReadingView(state, 2);
  assert.deepEqual(view.currentSectionIds, ["s2"]);
  assert.equal(view.outline[1].generationStatus, "ready");
  assert.ok(state.astra!.timing?.firstPublishedAt && state.astra!.timing.completedAt);
});

test("Astrav3: 실제 델타 단원 경계, 조기 공개, 불완전·중복 중단과 PDF 재전송 금지", async () => {
  // Deterministic transport/orchestration only, not evidence of model reading or question quality.
  let http = 0;
  await assert.rejects(sendWithFallback(async () => { http++; return new Response(JSON.stringify({ error: { message: "text.format json_schema rejected" } }), { status: 400 }); }, true, true));
  assert.equal(http, 1);
  for (const mode of ["complete", "truncated", "duplicate"] as const) {
    const state: GenState = { id: "gen_" + "1".repeat(32), createdAt: "fixture", updatedAt: "fixture", input: { sourceId: "fixture", fileName: "fixture.pdf", pageNumbers: [1, 2], purpose: "core", note: "", provider: "fake", engine: "astrav3", models: {}, signals: { weakSpots: [], reports: [] }, autoConfirm: true }, status: "running", phase: "outline", message: "", calls: 0, sections: [] };
    let reads = 0, readingFinished = false, published = false;
    let unblock: () => void = () => {};
    const firstPublication = new Promise<void>(resolve => { unblock = resolve; });
    const context = { state, pdf: Buffer.from("%PDF-fixture"), pageTexts: new Map([[1, "청색은 대기, 녹색은 진행"], [2, "청색은 대기, 녹색은 진행"]]), save: async () => {}, pause: (message: string): never => { throw new Error(message); },
      publish: async () => { if (!published) assert.equal(readingFinished, false, "PDF 응답 완료 전에 첫 단원이 공개된다"); published = true; unblock(); return "fixture-document"; },
      read: async (_system: string, user: string, _schema: Record<string, unknown>, files: unknown[], delta: (text: string) => void) => {
        reads++; assert.equal(files.length, 1);
        const result = JSON.parse(astrav3.astraFakeReply("astra-plan", user));
        result.records[0].outline = [{ id: "s1", title: '앞 {단원} "인용"', pages: [1] }, { id: "s2", title: "뒤 단원", pages: [2] }];
        const a = result.records[1];
        const b = structuredClone(a); b.section.sectionId = "s2";
        b.section.concepts[0].id = "c2"; b.section.concepts[0].outlineIds = ["s2"]; b.section.concepts[0].evidence[0].page = 2;
        b.section.practice[0].id = "p2"; b.section.practice[0].sectionId = "s2"; b.section.practice[0].conceptIds = ["c2"];
        const prefix = '{"result":{"records":[' + JSON.stringify(result.records[0]) + ',' + JSON.stringify(a);
        for (const character of prefix) delta(character);
        await Promise.race([firstPublication, new Promise((_, reject) => setTimeout(() => reject(new Error("first publication timeout")), 1500))]);
        if (mode === "truncated") throw new Error("stream incomplete");
        result.records.push(mode === "duplicate" ? a : b);
        delta(',' + JSON.stringify(result.records[2]) + ']}}'); readingFinished = true;
        return { result };
      },
      ask: (async (step, _attempt, _system, user, parser, files) => {
        assert.equal(files.length, 0);
        const input = JSON.parse(user), result = JSON.parse(astrav3.astraFakeReply(step, user));
        if (step === "astra-author") for (const q of result.questions) q.answer = { kind: "choice", options: [{ text: "O", latex: null }, { text: "X", latex: null }], correctIndex: 0, accepted: null, before: null, after: null, explanation: "원문과 같다." };
        if (step === "astra-review") result.coverage = input.selectedPracticeIds.map((id: string) => ({ practiceId: id, questionIds: input.candidates.filter((q: { practiceIds: string[] }) => q.practiceIds.includes(id)).map((q: { objectiveId: string }) => q.objectiveId), status: "covered", reason: "fixture" }));
        return parser.parse(result);
      }) as AstraAsk,
    };
    if (mode === "complete") { await astrav3.runAstrav3(context); assert.equal(state.status, "done"); assert.equal(state.sections.reduce((n, s) => n + (s.author?.questionCount ?? 0), 0), 2); }
    else {
      await assert.rejects(astrav3.runAstrav3(context), /incomplete|중복/);
      assert.notEqual(state.status, "done");
      await assert.rejects(astrav3.runAstrav3(context), /자동 재전송하지/);
    }
    assert.equal(reads, 1);
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "astrav3-flow-")), prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try {
    const start = await createGen({ sourceId: "fixture", fileName: "fixture.pdf", pageNumbers: [1], purpose: "core", engine: "astrav3", provider: "fake", autoConfirm: true, maxCalls: 15 });
    const done = await runGen(start.id, { uid: "fixture" });
    assert.equal(done.status, "done", done.message);
    const calls = await readGenCalls(start.id);
    assert.equal(calls.filter(c => c.withPdf).length, 1);
    assert.ok(calls.every(c => c.model === "gpt-6.1-sol" && c.effort === "medium"));
    const fork = await forkGen(start.id, { from: "author" });
    const rerun = await runGen(fork.id, { uid: "fixture" });
    assert.equal(rerun.status, "done", rerun.message);
    assert.equal((await readGenCalls(fork.id)).filter(c => c.withPdf).length, 0);
  } finally { if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior; await rm(dir, { recursive: true, force: true }); }
});
