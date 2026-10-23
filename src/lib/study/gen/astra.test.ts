import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { answerInPlace, astraFakeReply, candidateHints, shuffleChoice, valueAsShort, astraJsonSchema, astraResponseSchema, getAstraReadingView, runAstra, scopePlan, type AstraAsk } from "./astra.ts";
import { confirmObjectives, createGen, readGenCalls, readSectionDocument, runGen } from "./runner.ts";
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
    // PDF 1회 통제: only the plan call carries the PDF; authoring, solving and review read the pages as text.
    const made = await readGenCalls(start.id);
    assert.deepEqual(made.filter((call) => call.withPdf).map((call) => call.step), ["astra-plan"]);
    assert.ok(made.some((call) => call.step === "astra-author" && call.user.includes("[원문 p.")));
    // Same flow marks as v3, so the lab's 사용 흐름 점검 compares the engines on one scale.
    const events = (done.timeline ?? []).map((mark) => mark.event);
    for (const event of ["outline", "plan", "confirm", "confirmed", "unit-start", "unit-done", "done"]) assert.ok(events.includes(event as never), `${event}: ${events.join(" ")}`);
    assert.equal(done.sections[0].author?.questionCount, 1, JSON.stringify(done.sections[0].author));
    assert.equal(done.sections[0].author?.dropped[0].objectiveId, "s1-o1");
    assert.match(done.sections[0].author!.dropped[0].reason, /독립 풀이/);
    const document = await readSectionDocument(start.id, "s1") as { questions: Array<{ id: string }> };
    assert.deepEqual(document.questions.map(q => q.id), ["q-s1-o2"]);
    const calls = await readGenCalls(start.id);
    assert.deepEqual(calls.map(c => c.step), ["astra-plan", "astra-author", "astra-solve", "astra-review", "astra-review", "astra-author", "astra-solve", "astra-review"]);
  } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
});

// astra keeps a published question as is after a later global concern; v4 rewrites it once and swaps it only if the rewrite passes.
for (const engine of ["astra", "v4"] as const) test(`${engine}: 첫 묶음 조기 공개, 병렬 중단·재개, 후발 결함 처리`, async () => {
  const state: GenState = { id: "gen_" + "0".repeat(32), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), input: { sourceId: "fixture", fileName: "fixture.pdf", pageNumbers: [1, 2], purpose: "core", note: "", provider: "fake", engine, models: {}, signals: { weakSpots: [], reports: [] }, autoConfirm: true }, status: "running", phase: "outline", message: "", calls: 0, sections: [] };
  let priority = 2;
  let active = 0, peak = 0, stopped = false, failOnce = true;
  const calls: string[] = [], documents = new Map<string, string>();
  const ask: AstraAsk = async (step, attempt, _system, user, parser) => {
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
        result.units = result.outline.map((sec: { id: string }) => ({ sectionId: sec.id, pageNotes: [], concepts: result.concepts.filter((c: { outlineIds: string[] }) => c.outlineIds[0] === sec.id), practice: result.practice.filter((x: { sectionId: string }) => x.sectionId === sec.id) }));
      }
      if (step === "astra-review") {
        result.coverage = input.selectedPracticeIds.map((id: string) => ({ practiceId: id, questionIds: input.candidates.filter((q: { practiceIds: string[] }) => q.practiceIds.includes(id)).map((q: { objectiveId: string }) => q.objectiveId), status: "covered", reason: "fixture" }));
        if (input.scope === "global" && (engine === "astra" || attempt === 1)) {
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
  if (engine === "astra") {
    assert.deepEqual(JSON.parse(documents.get("s2")!)[0], first, "astra: 전역 검수 후에도 공개 문항은 불변이다");
    assert.ok(!state.astra!.repair?.ids.includes("s2-o1"));
  } else {
    assert.ok(state.astra!.repair!.ids.includes("s2-o1"), "v4: 전역 검수가 돌려보낸 공개 문항도 한 번 고쳐 쓴다");
    assert.ok(state.astra!.warnings.some(w => w.ref === "s2-o1" && w.code === "published-revised" && w.message.includes("후발")), "v4: 고친 문항이 통과해 바꿨고, 바꾼 사실을 남긴다");
  }
  assert.equal(state.sections.flatMap(s => s.design!.objectives).length, 12, "신고 재생성은 미계획 과제를 덧붙이지 않는다");
  assert.deepEqual(JSON.parse(documents.get("s1")!).map((q: { id: string }) => q.id), Array.from({ length: 9 }, (_, i) => `q-s1-o${i + 1}`));
  const view = getAstraReadingView(state, 2);
  assert.deepEqual(view.currentSectionIds, ["s2"]);
  assert.equal(view.outline[1].generationStatus, "ready");
  assert.ok(state.astra!.timing?.firstPublishedAt && state.astra!.timing.completedAt);
});

test("astra 계획: 고른 쪽 밖 목차·개념·연습은 빼고 단원 번호를 다시 매긴다 (그래픽스03 1~24쪽에 44쪽 전체 목차)", () => {
  const ev = (page: number) => [{ page, kind: "text" as const, quote: "", supports: "근거" }];
  const { plan, dropped } = scopePlan({
    outline: [{ id: "s1", title: "앞", pages: [1, 2] }, { id: "s2", title: "걸침", pages: [2, 3] }, { id: "s3", title: "밖", pages: [4] }],
    concepts: [{ id: "c1", outlineIds: ["s1"], title: "가", essentials: ["가"], conditions: [], evidence: ev(1) },
      { id: "c2", outlineIds: ["s2"], title: "나", essentials: ["나"], conditions: [], evidence: [...ev(2), ...ev(3)] },
      { id: "c3", outlineIds: ["s3"], title: "다", essentials: ["다"], conditions: [], evidence: ev(4) }],
    practice: [{ id: "p1", sectionId: "s2", conceptIds: ["c2"], task: "나 쓰기", cue: "", recall: "나", kind: "개념", priority: "essential", questionCount: 1 },
      { id: "p2", sectionId: "s3", conceptIds: ["c3"], task: "다 쓰기", cue: "", recall: "다", kind: "개념", priority: "essential", questionCount: 1 }],
    uncertain: [], pageNotes: [{ page: 4, text: "밖" }, { page: 2, text: "그림" }],
  } as Parameters<typeof scopePlan>[0], [1, 2]);
  assert.deepEqual(plan.outline.map((s) => [s.id, s.pages]), [["s1", [1, 2]], ["s2", [2]]]);
  assert.deepEqual(plan.concepts.map((c) => [c.id, c.evidence.map((e) => e.page)]), [["c1", [1]], ["c2", [2]]]);
  assert.deepEqual(plan.practice.map((p) => p.id), ["p1"]);
  assert.equal(dropped.length, 3);
  assert.deepEqual(plan.pageNotes.map((note) => note.page), [2]);
});

test("astra 답 칸: 응답 형식에 칸 설명이 실리고, self-check 모범 답이 after에 들어오면 accepted로 옮긴다 (비교 실행 11/16 보류)", () => {
  const schema = JSON.stringify(astraJsonSchema(astraResponseSchema));
  assert.ok(schema.includes("정답은 여기에만 쓴다") && schema.includes("입력칸 바로 뒤에 붙는 글"));
  const base = { objectiveId: "s1-o1", stem: [{ kind: "text" as const, text: "행렬을 쓰시오", latex: null, rows: null }], practiceIds: ["p1"], conceptIds: ["c1"], checkedSkill: "k", requiredPoints: ["r"],
    evidence: [{ page: 1, kind: "text" as const, quote: "q", supports: "s" }] };
  const warnings: Parameters<typeof answerInPlace>[1] = [];
  const moved = answerInPlace({ ...base, answer: { kind: "self-check", options: null, correctIndex: null, accepted: null, before: null, after: "M = [[1,0,0,-1],[0,0,-1,-1]]", explanation: "e" } }, warnings);
  assert.deepEqual([moved.answer.accepted, moved.answer.after, warnings.length], [["M = [[1,0,0,-1],[0,0,-1,-1]]"], null, 1]);
  const unit = { ...base, answer: { kind: "short" as const, options: null, correctIndex: null, accepted: null, before: null, after: "cm", explanation: "e" } };
  assert.equal(answerInPlace(unit, warnings), unit);
});

test("astra 형식: 값 하나인 자기확인은 단답으로, 정답 보기만 긴 것·여러 요구를 묶은 것은 검수에 힌트로", () => {
  const base = { objectiveId: "s1-o1", practiceIds: ["p1"], conceptIds: ["c1"], checkedSkill: "k", requiredPoints: ["r"], evidence: [{ page: 1, kind: "text" as const, quote: "q", supports: "s" }] };
  const stem = (text: string) => [{ kind: "text" as const, text, latex: null, rows: null }];
  const value = valueAsShort({ ...base, stem: stem("보기 좌표를 구하라."), answer: { kind: "self-check", options: null, correctIndex: null, accepted: ["(5, −3, 4)"], before: null, after: null, explanation: "e" } });
  assert.equal(value.answer.kind, "short");
  assert.ok(value.answer.accepted!.includes("(5,-3,4)"));
  const prose = { ...base, stem: stem("왜 그런지 설명하라."), answer: { kind: "self-check" as const, options: null, correctIndex: null, accepted: ["깊이 판별에 z가 필요하기 때문이다."], before: null, after: null, explanation: "e" } };
  assert.equal(valueAsShort(prose), prose);
  const long = { text: "평행 투영은 투영선이 평행해 상대적 비율을 보존하므로 도면에 맞다", latex: null };
  const hints = candidateHints({ ...base, stem: stem("u를 구하고, 좌표를 구하고, 순서를 쓰시오."), answer: { kind: "choice", options: [long, { text: "원근", latex: null }, { text: "둘 다", latex: null }, { text: "없음", latex: null }], correctIndex: 0, accepted: null, before: null, after: null, explanation: "e" } });
  assert.equal(hints.length, 2);
});

test("v4는 astra와 같은 단계를 쓰고 규칙만 더한다 (astra 지시문은 그대로)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "v4-flow-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try {
    const systems = new Map<string, string[]>();
    for (const engine of ["astra", "v4"] as const) {
      const start = await createGen({ sourceId: "src_astra_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine, provider: "fake", autoConfirm: true });
      const done = await runGen(start.id, { uid: "local-experiment" }, {});
      assert.equal(done.status, "done", done.message);
      systems.set(engine, (await readGenCalls(start.id)).map(call => `${call.step}:${call.system.includes("[v4]")}`));
    }
    assert.ok(systems.get("astra")!.every(entry => entry.endsWith(":false")));
    assert.deepEqual(systems.get("v4")!.map(entry => entry.split(":")[0]), systems.get("astra")!.map(entry => entry.split(":")[0]), "같은 단계 순서");
    assert.ok(["astra-plan:true", "astra-author:true", "astra-review:true"].every(entry => systems.get("v4")!.includes(entry)));
  } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
});

test("v4 스트리밍: 목차·목표가 계획 도중에 보이고, 첫 단원 출제가 계획이 끝나기 전에 시작하며, 공개는 계획 검사 뒤", async () => {
  const state: GenState = { id: "gen_" + "1".repeat(32), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), input: { sourceId: "fixture", fileName: "fixture.pdf", pageNumbers: [1, 2], purpose: "core", note: "", provider: "fake", engine: "v4", models: {}, signals: { weakSpots: [], reports: [] }, autoConfirm: true }, status: "running", phase: "outline", message: "", calls: 0, sections: [] };
  const seen = { outlineDuringPlan: false, goalsDuringPlan: false, authorBeforePlanEnd: false, publishedBeforePlanEnd: false };
  let planDone = false, authorStarted: () => void = () => {};
  const authorSeen = new Promise<void>(resolve => { authorStarted = resolve; });
  const documents = new Map<string, string>();
  const ask: AstraAsk = async (step, _attempt, _system, user, parser, _files, onPartial) => {
    const result = JSON.parse(astraFakeReply(step, user));
    if (step === "astra-plan") {
      const ev = (page: number) => [{ page, kind: "text", quote: "q", supports: "s" }];
      result.outline = [{ id: "s1", title: "첫 단원", pages: [1] }, { id: "s2", title: "둘째 단원", pages: [2] }];
      result.units = [1, 2].map(n => ({ sectionId: `s${n}`, pageNotes: [], concepts: [{ id: `c${n}`, outlineIds: [`s${n}`], title: `개념${n}`, essentials: ["e"], conditions: [], evidence: ev(n) }],
        practice: [{ id: `p${n}`, sectionId: `s${n}`, conceptIds: [`c${n}`], task: `개념${n}을 구별할 수 있다`, cue: "c", recall: "청색", kind: "관계", priority: "essential", questionCount: 1 }] }));
      const text = JSON.stringify({ result });
      for (let at = 50; at < text.length + 50; at += 50) onPartial?.(text.slice(0, at));
      seen.outlineDuringPlan = state.sections.length === 2;
      seen.goalsDuringPlan = state.sections[0].design?.objectives[0]?.statement === "개념1을 구별할 수 있다";
      await Promise.race([authorSeen, new Promise(resolve => setTimeout(resolve, 500))]);
      seen.publishedBeforePlanEnd = documents.size > 0;
      planDone = true;
      return parser.parse(result);
    }
    if (step === "astra-author") { if (!planDone) seen.authorBeforePlanEnd = true; authorStarted(); }
    return parser.parse(result);
  };
  await runAstra({ state, pdf: Buffer.from("%PDF-fixture"), ask, save: async () => {}, pause: (message: string): never => { throw new Error(message); },
    publish: async (section: { id: string }, questions: unknown[]) => { documents.set(section.id, JSON.stringify(questions)); return `sections/${section.id}/document.json`; } });
  assert.deepEqual(seen, { outlineDuringPlan: true, goalsDuringPlan: true, authorBeforePlanEnd: true, publishedBeforePlanEnd: false });
  assert.equal(state.status, "done", state.message);
  assert.deepEqual([...documents.keys()].sort(), ["s1", "s2"]);
  // The learner-facing goal stays the planned one-verb sentence, not the question's checked skill.
  assert.equal(state.sections[0].design!.objectives[0].statement, "개념1을 구별할 수 있다");
});

test("v4 스트리밍: 끝난 계획이 검사에 걸려 다시 요청되면 먼저 만든 문제는 버리고 공개하지 않는다", async () => {
  const state: GenState = { id: "gen_" + "2".repeat(32), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), input: { sourceId: "fixture", fileName: "fixture.pdf", pageNumbers: [1, 2], purpose: "core", note: "", provider: "fake", engine: "v4", models: {}, signals: { weakSpots: [], reports: [] }, autoConfirm: true }, status: "running", phase: "outline", message: "", calls: 0, sections: [] };
  const documents = new Map<string, string>();
  const ask: AstraAsk = async (step, attempt, _system, user, parser, _files, onPartial) => {
    const result = JSON.parse(astraFakeReply(step, user));
    if (step === "astra-plan") {
      // Attempt 1 leaves page 2 out of every unit (fails the plan check); attempt 2 covers both pages.
      result.outline = [{ id: "s1", title: attempt === 1 ? "앞 계획" : "다시 짠 계획", pages: attempt === 1 ? [1] : [1, 2] }];
      result.units[0].practice[0].task = attempt === 1 ? "버려질 목표" : "다시 짠 목표를 구별할 수 있다";
      const text = JSON.stringify({ result });
      for (let at = 50; at < text.length + 50; at += 50) onPartial?.(text.slice(0, at));
      if (attempt === 1) await new Promise(resolve => setTimeout(resolve, 20));
      return parser.parse(result);
    }
    return parser.parse(result);
  };
  await runAstra({ state, pdf: Buffer.from("%PDF-fixture"), ask, save: async () => {}, pause: (message: string): never => { throw new Error(message); },
    publish: async (section: { id: string }, questions: unknown[]) => { documents.set(section.id, JSON.stringify(questions)); return `sections/${section.id}/document.json`; } });
  assert.equal(state.status, "done", state.message);
  assert.equal(state.sections[0].title, "다시 짠 계획");
  assert.ok(!documents.get("s1")!.includes("버려질 목표"), "앞 계획으로 만든 문제는 공개하지 않는다");
});

test("v5: 목표의 형식대로 출제(OX·객관식), 오답 근거 없는 객관식은 보류, 그림 근거 목표는 풀이·검수에 그 쪽 그림, 단원이 통과하면 계획이 끝나기 전에도 공개", async () => {
  const state: GenState = { id: "gen_" + "3".repeat(32), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), input: { sourceId: "fixture", fileName: "fixture.pdf", pageNumbers: [1, 2], purpose: "core", note: "", provider: "fake", engine: "v5", models: {}, signals: { weakSpots: [], reports: [] }, autoConfirm: true }, status: "running", phase: "outline", message: "", calls: 0, sections: [] };
  const documents = new Map<string, Array<{ responses: Array<{ kind: string; options?: unknown[] }> }>>();
  let planDone = false, publishedBeforePlanEnd = false, solveImages = 0, planInput = "";
  let released: () => void = () => {};
  const firstPublished = new Promise<void>(resolve => { released = resolve; });
  const ask: AstraAsk = async (step, _attempt, _system, user, parser, files, onPartial, images) => {
    const input = JSON.parse(user);
    if (input.lightCheck) return parser.parse({ duplicates: [], gaps: [] });
    if (step === "astra-plan") {
      planInput = `파일${files.length} 이미지${images?.length ?? 0} 글자${input.pageTexts?.length ?? 0}`;
      const ev = (page: number, kind: string) => [{ page, kind, quote: kind === "text" ? "q" : "", supports: "s" }];
      const result = {
        outline: [{ id: "s1", title: "구별 단원", pages: [1] }, { id: "s2", title: "그림 단원", pages: [2] }],
        diagnosis: { mode: "알잘딱", materialType: "개념 비교", approach: "구별 위주" },
        units: [
          { sectionId: "s1", pageNotes: [], misconceptions: [{ conceptIds: ["c1"], wrongIdea: "청색=진행", whyWrong: "원문은 청색=대기", page: 1 }],
            concepts: [{ id: "c1", outlineIds: ["s1"], title: "신호", essentials: ["청색 대기"], conditions: [], evidence: ev(1, "text") }],
            practice: [{ id: "p1", sectionId: "s1", conceptIds: ["c1"], task: "신호 색을 구별할 수 있다", cue: "c", recall: "청색", kind: "관계", priority: "essential", questionCount: 1, level: "구별", format: "ox", formatWhy: "참거짓 판별" },
              { id: "p2", sectionId: "s1", conceptIds: ["c1"], task: "대기 신호를 고를 수 있다", cue: "c", recall: "청색", kind: "관계", priority: "essential", questionCount: 1, level: "구별", format: "choice", formatWhy: "오개념 구별" }] },
          { sectionId: "s2", pageNotes: [], misconceptions: [],
            concepts: [{ id: "c2", outlineIds: ["s2"], title: "그림", essentials: ["e"], conditions: [], evidence: ev(2, "figure") }],
            practice: [{ id: "p3", sectionId: "s2", conceptIds: ["c2"], task: "그림의 대응을 설명할 수 있다", cue: "c", recall: "r", kind: "관계", priority: "essential", questionCount: 1, level: "설명", format: "flashcard", formatWhy: "" }] },
        ],
        uncertain: [],
      };
      const text = JSON.stringify({ result });
      for (let at = 50; at < text.length + 50; at += 50) onPartial?.(text.slice(0, at));
      await Promise.race([firstPublished, new Promise(resolve => setTimeout(resolve, 500))]);
      publishedBeforePlanEnd = documents.size > 0;
      planDone = true;
      return parser.parse(result);
    }
    const result = JSON.parse(astraFakeReply(step, user));
    if (step === "astra-author") {
      for (const q of result.questions) {
        const slot = input.slots.find((o: { id: string }) => o.id === q.objectiveId);
        if (slot.astra.format === "ox") Object.assign(q.answer, { kind: "ox", accepted: null, correctIndex: 1 }, q.distractors = [{ option: 1, misconception: "청색=진행", whyWrong: "원문은 대기" }]);
        if (slot.astra.format === "choice") Object.assign(q.answer, { kind: "choice", accepted: null, correctIndex: 0, options: ["청색", "녹색", "적색", "황색"].map(text => ({ text, latex: null })) });
      }
    }
    if (step === "astra-solve") solveImages += images?.length ?? 0;
    if (step === "astra-review") {
      result.coverage = input.selectedPracticeIds.map((id: string) => ({ practiceId: id, questionIds: input.candidates.filter((q: { practiceIds: string[] }) => q.practiceIds.includes(id)).map((q: { objectiveId: string }) => q.objectiveId), status: "covered", reason: "fixture" }));
    }
    return parser.parse(result);
  };
  await runAstra({ state, pdf: Buffer.from("%PDF-fixture"), ask, save: async () => {}, pause: (message: string): never => { throw new Error(message); },
    pageImages: async (pages) => new Map(pages.map(p => [p, `data:image/jpeg;base64,p${p}`])),
    publish: async (section: { id: string }, questions: unknown[]) => { documents.set(section.id, questions as never); if (!planDone) released(); return `sections/${section.id}/document.json`; } });
  assert.equal(state.status, "done", state.message);
  assert.ok(publishedBeforePlanEnd, "단원 검사를 통과한 문제는 계획이 끝나기 전에 공개된다");
  const s1 = documents.get("s1")!;
  assert.deepEqual(s1.map(q => [q.responses[0].kind, q.responses[0].options?.length]), [["single-choice", 2]], "OX는 보기 2개, 오답 근거 없는 객관식은 보류");
  assert.ok(state.sections[0].author!.dropped.some(d => d.reason.includes("오답마다")));
  assert.ok(solveImages >= 1, "그림 근거 목표의 풀이에 그 쪽 그림을 보낸다");
  assert.equal((state.astra!.plan as { diagnosis?: { materialType: string } }).diagnosis?.materialType, "개념 비교");
  assert.equal(planInput, "파일0 이미지2 글자2", "v5 계획은 PDF 대신 고른 쪽 글자와 쪽 이미지");
});

test("v4 보기 섞기: 정답 위치가 한 칸에 몰리지 않는다 (하위 비트만 쓰던 섞기는 160개 모두 ④)", () => {
  const at = new Set<number>();
  for (let n = 0; n < 40; n++) {
    const q = { objectiveId: `s${n % 7}-o${n}`, answer: { kind: "choice", options: ["a", "b", "c", "d"].map(text => ({ text, latex: null })), correctIndex: 0 } };
    at.add((shuffleChoice(q as never).answer as { correctIndex: number }).correctIndex);
  }
  assert.equal(at.size, 4);
  // v5 오답 근거는 보기와 함께 움직인다 (안 움직이면 정답 자리를 가리켜 객관식이 '오답 근거 부족'으로 보류: v5 실측 9개 중 7개)
  const v5 = shuffleChoice({ objectiveId: "s1-o2", answer: { kind: "choice", options: ["a", "b", "c", "d"].map(text => ({ text, latex: null })), correctIndex: 0 }, distractors: [1, 2, 3].map(option => ({ option, misconception: "m", whyWrong: "w" })) } as never) as unknown as { answer: { correctIndex: number; options: Array<{ text: string }> }; distractors: Array<{ option: number }> };
  assert.deepEqual(v5.distractors.map(d => v5.answer.options[d.option].text).sort(), ["b", "c", "d"]);
});

test("v4 끝없는 응답: 예상 길이를 넘은 출제는 끊고 한 번 짧게 다시, 또 넘으면 보류하고 실행은 이어간다 (astrav3 6.6만 자)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "v4-runaway-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try {
    const start = await createGen({ sourceId: "src_astra_fixture", fileName: "invented.pdf", pageNumbers: [1, 2], purpose: "core", engine: "v4", provider: "fake", autoConfirm: true });
    const loop = (step: GenStep, user: string) => {
      const reply = astraFakeReply(step, user);
      return step === "astra-author" ? reply.replace("청색은 대기 상태다.", "청색은 대기 상태다. ".repeat(20000)) : reply;
    };
    const done = await runGen(start.id, { uid: "local-experiment" }, { fakeReply: loop });
    assert.equal(done.status, "done", done.message);
    assert.ok((done.astra?.warnings ?? []).filter(w => w.code === "astra-runaway").length >= 2);
    const cut = (await readGenCalls(start.id)).filter(call => call.step === "astra-author" && call.error?.includes("끊었어요"));
    assert.ok(cut.length >= 2 && cut.every(call => (call.reply ?? "").length > 10000), "끊을 때까지 받은 글을 호출 기록에 남긴다");
    assert.equal(done.astra?.publishedQuestions?.length, 0);
  } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
});

for (const cacheMode of [undefined, "shared"] as const) test(`v5 확인 강도·고쳐 쓰기${cacheMode ? " (공통 앞부분)" : ""}: 원문 그대로의 암기 답은 코드로, 객관식은 검수만, 걸린 문항은 묶음 안에서 한 번 고쳐 공개, 무거운 전체 검수 없음`, async () => {
  const state: GenState = { id: "gen_" + "5".repeat(32), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), input: { sourceId: "fixture", fileName: "fixture.pdf", pageNumbers: [1], purpose: "core", note: "", provider: "fake", engine: "v5", planInput: "pdf", ...(cacheMode ? { cacheMode } : {}), models: {}, signals: { weakSpots: [], reports: [] }, autoConfirm: true }, status: "running", phase: "outline", message: "", calls: 0, sections: [] };
  const calls: string[] = [];
  const shares = new Set<string>();
  let authored = 0;
  const ask: AstraAsk = async (step, _attempt, _system, user, parser, _files, _onPartial, _images, _maxChars, shared) => {
    calls.push(step);
    if (step !== "astra-plan" && !user.includes("lightCheck")) shares.add(shared ?? "(없음)");
    const input = JSON.parse(user);
    if (input.lightCheck) return parser.parse({ duplicates: [], gaps: [] });
    if (step === "astra-plan") {
      const ev = [{ page: 1, kind: "text", quote: "q", supports: "s" }];
      const practice = (id: string, level: string, format: string) => ({ id, sectionId: "s1", conceptIds: ["c1"], task: `${id} 목표`, cue: "c", recall: "청색", kind: "관계", priority: "essential", questionCount: 3, level, format, formatWhy: "" });
      return parser.parse({ outline: [{ id: "s1", title: "신호", pages: [1] }], diagnosis: { mode: "알잘딱", materialType: "분류·암기", approach: "a" },
        units: [{ sectionId: "s1", pageNotes: [], misconceptions: [], concepts: [{ id: "c1", outlineIds: ["s1"], title: "신호", essentials: ["e"], conditions: [], evidence: ev }],
          practice: [practice("p1", "떠올리기", "short"), practice("p2", "구별", "choice")] }], uncertain: [] });
    }
    const result = JSON.parse(astraFakeReply(step, user));
    if (step === "astra-author") {
      authored++;
      for (const q of result.questions) {
        if (q.objectiveId === "s1-o1") Object.assign(q.answer, { kind: "short", accepted: ["청색"] });
        // First try: a choice without distractor notes (held by code); the rewrite brings them.
        if (q.objectiveId === "s1-o2") { Object.assign(q.answer, { kind: "choice", accepted: null, correctIndex: 0, options: ["청색", "녹색", "적색", "황색"].map(text => ({ text, latex: null })) }); if (authored > 1) q.distractors = [1, 2, 3].map(option => ({ option, misconception: "m", whyWrong: "원문은 청색" })); }
      }
    }
    if (step === "astra-review") result.coverage = input.selectedPracticeIds.map((id: string) => ({ practiceId: id, questionIds: input.candidates.filter((q: { practiceIds: string[] }) => q.practiceIds.includes(id)).map((q: { objectiveId: string }) => q.objectiveId), status: "covered", reason: "fixture" }));
    return parser.parse(result);
  };
  await runAstra({ state, pdf: Buffer.from("%PDF-fixture"), ask, pageTexts: new Map([[1, "대기 상태를 나타내는 색은 청색이다."]]), save: async () => {}, pause: (message: string): never => { throw new Error(message); },
    publish: async (section: { id: string }) => `sections/${section.id}/document.json` });
  assert.equal(state.status, "done", state.message);
  assert.equal(state.sections[0].design!.objectives.length, 2, "목표당 문항 하나 (questionCount 3이어도)");
  assert.deepEqual(state.astra!.publishedQuestions!.map(q => q.objectiveId).sort(), ["s1-o1", "s1-o2"], "걸린 객관식은 묶음 안에서 고쳐 공개");
  assert.ok(!calls.includes("astra-solve"), "암기(코드)·객관식(검수만)은 독립 풀이 없음");
  assert.deepEqual(calls, ["astra-plan", "astra-author", "astra-review", "astra-author", "astra-review", "astra-review"], "원문 없는 가벼운 전체 확인 1번뿐, 끝 고치기 없음");
  if (cacheMode) assert.ok(shares.size === 1 && [...shares][0].includes("청색이다"), "출제·검수 호출이 모두 같은 공통 자료로 시작한다");
  else assert.deepEqual([...shares], ["(없음)"]);
});

test("alpha: 계획의 평가 설계(assessment)가 출제 슬롯까지 가고, 난이도·짧은 다른 목표·근거 쪽만 출제에 들어간다", async () => {
  const state: GenState = { id: "gen_" + "6".repeat(32), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), input: { sourceId: "fixture", fileName: "fixture.pdf", pageNumbers: [1, 2, 3], purpose: "core", note: "", provider: "fake", engine: "alpha", planInput: "pdf", survey: { difficulty: "hard" }, models: {}, signals: { weakSpots: [], reports: [] }, autoConfirm: true }, status: "running", phase: "outline", message: "", calls: 0, sections: [] };
  const seen: { plan?: string; author?: string; authorUser?: Record<string, unknown> } = {};
  const assessment = { focus: "원근 나눗셈은 투영 변환 뒤, 뷰포트 변환 전에 한다", operation: "순서판단", decisive: "투영 변환과 뷰포트 변환 사이의 위치" };
  const ask: AstraAsk = async (step, _attempt, system, user, parser) => {
    const input = JSON.parse(user);
    if (input.lightCheck) return parser.parse({ duplicates: [], gaps: [] });
    if (step === "astra-plan") {
      seen.plan = system;
      const ev = (page: number) => [{ page, kind: "text", quote: "q", supports: "s" }];
      return parser.parse({ outline: [{ id: "s1", title: "투영", pages: [1, 2, 3] }], diagnosis: { mode: "설문", materialType: "절차", approach: "순서 구별" },
        units: [{ sectionId: "s1", pageNotes: [], misconceptions: [{ conceptIds: ["c1"], wrongIdea: "뷰포트 뒤에 나눈다", whyWrong: "원문 순서", page: 3 }],
          concepts: [{ id: "c1", outlineIds: ["s1"], title: "원근 나눗셈", essentials: ["w로 나눈다"], conditions: [], evidence: ev(3) }, { id: "c2", outlineIds: ["s1"], title: "뷰포트", essentials: ["화면 좌표"], conditions: [], evidence: ev(1) }],
          practice: [{ id: "p1", sectionId: "s1", conceptIds: ["c1"], task: "원근 나눗셈의 위치를 고를 수 있다", cue: "c", recall: "w", kind: "절차", priority: "essential", questionCount: 1, level: "순서", format: "choice", formatWhy: "단계 선택", assessment },
            { id: "p2", sectionId: "s1", conceptIds: ["c2"], task: "뷰포트 변환을 떠올릴 수 있다", cue: "c", recall: "뷰포트", kind: "용어", priority: "extra", questionCount: 1, level: "떠올리기", format: "short", formatWhy: "",
              assessment: { focus: "뷰포트 변환은 정규화 좌표를 화면 좌표로 바꾼다", operation: "식별", decisive: "정규화 좌표 → 화면 좌표" } }] }],
        uncertain: [] });
    }
    const result = JSON.parse(astraFakeReply(step, user));
    if (step === "astra-author" && input.slots.some((o: { id: string }) => o.id === "s1-o1")) {
      seen.author = system; seen.authorUser = input;
      for (const q of result.questions.filter((q: { objectiveId: string }) => q.objectiveId === "s1-o1")) {
        Object.assign(q.answer, { kind: "choice", accepted: null, correctIndex: 1, options: ["투영 변환 이전", "투영 변환 이후, 뷰포트 변환 이전", "뷰포트 변환 이후", "뷰잉 변환 이전"].map(text => ({ text, latex: null })) });
        q.distractors = [0, 2, 3].map(option => ({ option, misconception: "순서 혼동", whyWrong: "원문 p.3 순서" }));
      }
    }
    if (step === "astra-review") result.coverage = input.selectedPracticeIds.map((id: string) => ({ practiceId: id, questionIds: [], status: "covered", reason: "fixture" }));
    return parser.parse(result);
  };
  await runAstra({ state, pdf: Buffer.from("%PDF-fixture"), ask, save: async () => {}, pause: (message: string): never => { throw new Error(message); },
    pageTexts: new Map([[1, "뷰포트 쪽"], [2, "관련 없는 쪽"], [3, "원근 나눗셈 쪽"]]), publish: async () => "sections/s1/document.json" });
  assert.equal(state.status, "done", state.message);
  assert.ok(seen.plan!.includes("[alpha]") && !seen.plan!.includes("[v5]") && !seen.plan!.includes("정해진 비율"), "계획은 alpha 지시(형식 비율·과제 섞기 없음)");
  assert.ok(seen.author!.includes("[alpha]") && !seen.author!.includes("[v5]"), "출제는 alpha 지시");
  const user = seen.authorUser!;
  const slot = (user.slots as Array<{ id: string; astra: { assessment?: unknown } }>).find(o => o.id === "s1-o1")!;
  assert.deepEqual(slot.astra.assessment, assessment, "평가 설계가 출제 슬롯에 그대로 간다");
  assert.equal((user.context as { difficulty: string }).difficulty, "hard");
  const others = (user.plan as { otherTasks: Array<Record<string, string>> }).otherTasks;
  assert.ok(others.every(o => Object.keys(o).sort().join() === "focus,id"), "다른 목표는 id + focus만");
  assert.equal(state.sections[0].design!.objectives.find(o => o.id === "s1-o1")!.astra!.assessment?.operation, "순서판단");
  const source = String(user.source);
  assert.ok(source.includes("[원문 p.3]") && !source.includes("[원문 p.2]"), "출제 원문은 단원 전체가 아니라 목표 근거 쪽만");
});
