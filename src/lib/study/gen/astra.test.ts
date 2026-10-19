import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { answerInPlace, astraFakeReply, candidateHints, valueAsShort, astraJsonSchema, astraResponseSchema, getAstraReadingView, runAstra, scopePlan, type AstraAsk } from "./astra.ts";
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
  assert.ok(schema.includes("정답은 여기에만 쓴다") && schema.includes("입력칸 바로 뒤에 붙는 짧은 꾸밈 글"));
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
