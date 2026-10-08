// End-to-end run of the auto-executor with the fake model: no network, no cost.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, mock } from "node:test";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const root = await mkdtemp(path.join(tmpdir(), "study-executor-"));
process.env.STUDY_FORGE_DATA_DIR = root;
process.env.STUDY_FORGE_MODEL_PROVIDER = "fake";

const { ModelError, setFakeModelResponder } = await import("../ai/model.ts");
const { registerMcpSource } = await import("../mcp-source-registry.ts");
const { createExperimentRequest, getExperimentRequest } = await import("../mcp-experiment-requests.ts");
const { getMcpRunView } = await import("../mcp-run-view.ts");
const { runStudyRequest, executorView } = await import("./auto-executor.ts");
const { buildRemakeBody } = await import("./request-form.ts");
const { authoringRunsRoot } = await import("../../../tools/study-forge-mcp/authoring-packet.ts");

after(() => rm(root, { recursive: true, force: true }));

test("실험실은 단계마다 멈추고 설정 변경을 다음 단계에 쓰며 호출 기록을 보존한다", async () => {
  const { configureLab, readExecutorCalls } = await import("./auto-executor.ts");
  const source = await registerMcpSource("cornell-bfs-2pages.pdf",new Uint8Array(await readFile("eval/corpus/user-test-pdfs/cornell-bfs-2pages.pdf")));
  const settings = {model:"gpt-6-luna" as const,effort:"low" as const};
  const request = await createExperimentRequest({sourceId:source.id,scope:{pageNumbers:[1],outlineLeafIds:[]},purpose:"BFS 연습",requestedStages:Object.fromEntries(["analyze","concept-tree","learning-design","activity-design","cards"].map(s=>[s,settings])),stopAfterStage:"cards"});
  process.env.STUDY_FORGE_LOCAL_EXPERIMENT="1";
  const previousNodeEnv=process.env.NODE_ENV;
  Object.assign(process.env,{NODE_ENV:"test"});
  const config = {provider:"fake" as const,stepMode:true,stages:{analyze:settings,"concept-tree":{model:"gpt-6-sol" as const,effort:"high" as const}},note:"fake",scenario:"retry" as const};
  try {
    await configureLab(request.id,config);
    for (let i=0;i<5;i++) {
      const state = await runStudyRequest(request.id,{uid:"local-experiment"});
      assert.equal(state.status,"paused-step",state.message);
      assert.equal((await getExperimentRequest(request.id)).stages.length,i+1);
      if(i===0) await configureLab(request.id,{...config,note:"changed"});
    }
    const done = await runStudyRequest(request.id,{uid:"local-experiment"});
    assert.equal(done.status,"done",done.message);
    const calls=await readExecutorCalls(request.id);
    assert.equal(calls.length,7);
    const retries=calls.filter(c=>c.purpose==="stage:concept-tree");
    assert.equal(retries.length,2);assert.equal(retries[0].ok,false);assert.equal(retries[1].ok,true);
    assert.equal(retries[1].model,"gpt-6-sol");assert.equal(retries[1].effort,"high");
    assert.match(retries[1].user,/이전 답/);assert.ok(calls[0].input.pagesSent.includes(1));
    assert.equal(done.lab?.note,"changed");
    assert.doesNotMatch(JSON.stringify(calls),/claimToken|access_token|refresh_token|cookie/);
    await rm(path.join(authoringRunsRoot(),done.runId!),{recursive:true,force:true});
  } finally {delete process.env.STUDY_FORGE_LOCAL_EXPERIMENT;if(previousNodeEnv)Object.assign(process.env,{NODE_ENV:previousNodeEnv});else Reflect.deleteProperty(process.env,"NODE_ENV");}
});

test("단계별 요청 모델과 원문 잘림, 비밀값 제거를 확인한다", async () => {
  const { executorSettings, pageBlock } = await import("./auto-executor.ts");
  const { redactCallText } = await import("./lab-contract.ts");
  const source = await registerMcpSource("cornell-bfs-2pages.pdf",new Uint8Array(await readFile("eval/corpus/user-test-pdfs/cornell-bfs-2pages.pdf")));
  const request = await createExperimentRequest({sourceId:source.id,scope:{pageNumbers:[1],outlineLeafIds:[]},purpose:"모델 선택",requestedStages:{analyze:{model:"gpt-6-luna",effort:"low"},"concept-tree":{model:"gpt-6-astra",effort:"high"}},stopAfterStage:"concept-tree"});
  assert.equal(executorSettings("analyze",request).model,"gpt-6-luna");
  assert.equal(executorSettings("concept-tree",request).model,"gpt-6-astra");
  const block=pageBlock(new Map(Array.from({length:25},(_,i)=>[i+1,"x".repeat(4000)])));
  assert.equal(block.input.charsSent,60000);assert.ok(block.input.pagesCut.includes(25));assert.match(block.text,/길이 제한/);
  const redacted=redactCallText('Authorization: Bearer abc.def\n{"access_token":"secret","cookie":"session"}');
  assert.doesNotMatch(redacted,/abc.def|secret|session/);
  assert.doesNotMatch(redactCallText('Cookie: a=first; b=second\n{"cookie":"a=first; b=second"}'), /first|second/);
});

test("실제 모델은 확인 전 요청 생성과 대기열 진입을 거부한다", async () => {
  const { createLabRun } = await import("./lab-store.ts");
  const { enqueueStudyRequest, configureLab } = await import("./auto-executor.ts");
  await assert.rejects(createLabRun({sourceId:"not-needed",startPage:1,endPage:1,purpose:"확인 테스트",lab:{provider:"chatgpt",stepMode:true,stages:{}}}),/확인/);
  const source = await registerMcpSource("cornell-bfs-2pages.pdf",new Uint8Array(await readFile("eval/corpus/user-test-pdfs/cornell-bfs-2pages.pdf")));
  const request = await createExperimentRequest({sourceId:source.id,scope:{pageNumbers:[1],outlineLeafIds:[]},purpose:"미확인 실행",requestedStages:{analyze:{model:"gpt-6-luna",effort:"low"}},stopAfterStage:"analyze"});
  await configureLab(request.id,{provider:"chatgpt",stepMode:true,stages:{}});
  await assert.rejects(enqueueStudyRequest(request.id,{uid:"local-experiment"}),/확인/);
  assert.equal((await executorView(request.id))?.calls,0);
});

test("실험실 화면은 모르는 단계와 축소 목록을 다루고 JSON 차이를 줄 단위로 표시한다", async () => {
  const { resultNodes, lineDiff, stageGridColumns } = await import("../../app/lab/lab-view.ts");
  const { labStageList } = await import("./lab-contract.ts");
  assert.match(stageGridColumns(labStageList.slice(0,-1)), /repeat\(5,/);
  assert.match(stageGridColumns([...labStageList,{key:"unknown-stage"}]), /repeat\(7,/);
  assert.match(stageGridColumns([]), /repeat\(1,/);
  assert.deepEqual(resultNodes("unknown-stage",{items:[1]}),[]);
  assert.equal(resultNodes("concept-tree",{nodes:[{id:"n"}]}).length,1);
  const diff=lineDiff('{"a":1,"b":2}','{"a":1,"b":3}');
  assert.ok(diff.some(d=>d.kind==="same" && d.text.includes('"a"')));
  assert.ok(diff.some(d=>d.kind==="add" && d.text.includes('3')));
});

const PDF = "cornell-bfs-2pages.pdf";

test("상태 저장은 Windows 일시 잠금을 재시도하고 동시 저장에서도 완전한 JSON을 유지한다", async () => {
  const { configureLab } = await import("./auto-executor.ts");
  const id = `req_${"b".repeat(32)}`;
  const originalRename = fsPromises.rename;
  let blocked = 2;
  const replacement = mock.method(fsPromises, "rename", async (...args: Parameters<typeof fsPromises.rename>) => {
    if (String(args[1]).endsWith(`${id}.json`) && blocked-- > 0) {
      throw Object.assign(new Error("EPERM: local-path-hidden"), { code: "EPERM" });
    }
    return originalRename(...args);
  });
  syncBuiltinESMExports();
  try {
    await configureLab(id, { provider: "fake", stepMode: true, stages: {}, note: "saved" });
    assert.equal((await executorView(id))?.lab?.note, "saved");
    assert.equal(replacement.mock.calls.length, 3, "두 번 잠긴 뒤 원본을 삭제하지 않고 교체한다");
    await Promise.all(Array.from({ length: 20 }, (_, index) => configureLab(id,
      { provider: "fake", stepMode: true, stages: {}, note: `parallel-${index}` })));
    assert.match((await executorView(id))?.lab?.note ?? "", /^parallel-\d+$/);
    const { readdir } = await import("node:fs/promises");
    assert.equal((await readdir(path.join(root, "study-executor"))).filter((file) => file.startsWith(id) && file.endsWith(".tmp")).length, 0);
  } finally { replacement.mock.restore(); syncBuiltinESMExports(); }
});

test("상태 저장 잠금이 계속되면 원본을 보존하고 화면에 파일 경로를 노출하지 않는다", async () => {
  const { configureLab } = await import("./auto-executor.ts");
  const id = `req_${"c".repeat(32)}`;
  await configureLab(id, { provider: "fake", stepMode: true, stages: {}, note: "original" });
  const originalRename = fsPromises.rename;
  const replacement = mock.method(fsPromises, "rename", async (...args: Parameters<typeof fsPromises.rename>) => {
    if (String(args[1]).endsWith(`${id}.json`)) throw Object.assign(new Error(`EPERM rename ${args[0]} -> ${args[1]}`), { code: "EPERM" });
    return originalRename(...args);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(configureLab(id, { provider: "fake", stepMode: true, stages: {}, note: "changed" }), (error: unknown) => {
      assert.match((error as Error).message, /생성 기록을 저장하지 못했어요/);
      assert.doesNotMatch((error as Error).message, /EPERM|\.json|Temp|Users/);
      return true;
    });
    assert.equal(replacement.mock.calls.length, 6, "재시도는 무한히 반복하지 않는다");
    assert.equal((await executorView(id))?.lab?.note, "original");
  } finally { replacement.mock.restore(); syncBuiltinESMExports(); }
});
// Evidence must be real text from the selected page (source-evidence check).
const QUOTE = "Then all nodes that are 1 edge from u.";
const stageReplies: Record<string, unknown> = {
  analyze: { outlineText: `@file ${PDF}\n# 너비 우선 탐색 [1]` },
  "concept-tree": { treeText: [
    "데드락",
    "- [필요조건] 상호 배제 — 하나의 자원을 동시에 공유할 수 없음 (p.1)",
    "- [필요조건] 점유와 대기 — 자원을 가진 채 다른 자원을 기다림 (p.1)",
    "- [필요조건] 비선점 — 자원을 강제로 회수할 수 없음 (p.1)",
    "- [필요조건] 순환 대기 — 프로세스들이 원형으로 자원을 기다림 (p.1)",
  ].join("\n") },
  "learning-design": { learningDesignText: [
    "--- LEARNING 1 ---", "개념: 2, 3, 4, 5", "학습내용: 데드락의 네 필요조건과 동시 성립 관계",
    "학습목표: 네 필요조건과 동시 성립 관계를 설명할 수 있다.", "성공기준: 네 조건과 동시 성립 관계를 빠짐없이 말한다.",
    `근거: ${QUOTE}`, "종류: 관계",
    "이유: 네 조건은 개별 사실보다 동시 성립 관계가 핵심이다.", "중요도: 3",
  ].join("\n") },
  "activity-design": { activityDesignText: [
    "--- DESIGN 1 ---", "학습대상: 1", "관련개념: 전체", "관계: 직접",
    "보여줄 것: 데드락은 네 가지 필요조건이 어떻게 성립할 때 발생하는가", "감출 것: 동시에",
    "응답: 짧은답", "채점: 정확", "단서: 보통", "문제방식: 빈칸", "풀이방식: 해당없음",
    "이유: 핵심 관계어를 문맥에서 직접 회상한다.", "제한:",
  ].join("\n") },
  cards: { cardsText: [
    "--- CARD 1 ---", "유형: 빈칸", "질문: 데드락은 네 가지 필요조건이 ____ 성립할 때 발생할 수 있다.",
    "정답: 동시에", "해설: 네 조건은 개별 존재가 아니라 동시 성립해야 한다.",
    `근거: ${QUOTE}`,
  ].join("\n") },
};

/** One short-answer question per packet item, with the source copied verbatim. */
function authoringReply(user: string, leak: boolean) {
  const packetText = /\[출제 패킷\]\n([\s\S]*?)\n\[\/출제 패킷\]/.exec(user)?.[1];
  assert.ok(packetText, "출제 요청에 패킷이 들어 있어야 한다");
  const packet = JSON.parse(packetText) as { items: Array<Record<string, unknown>> };
  return {
    schemaVersion: "problem-authoring-v1", id: "fake-doc", title: "가짜 출제",
    questions: packet.items.map((source, index) => ({
      id: `question-${index + 1}`, source, page: { width: 760, height: 260 },
      blocks: [
        { id: `prompt-${index + 1}`, kind: "text", frame: { x: 40, y: 30, width: 680, height: 50 },
          text: leak ? "데드락은 네 조건이 동시에 성립할 때 생긴다. 빈칸을 채우시오." : "데드락이 생기려면 네 필요조건이 어떻게 성립해야 하는가?" },
        { id: `blank-${index + 1}`, kind: "blank", frame: { x: 40, y: 95, width: 680, height: 50 }, responseId: `r${index + 1}`, promptBefore: "답:", promptAfter: "" },
        { id: `reveal-${index + 1}`, kind: "answer-reveal", frame: { x: 40, y: 160, width: 680, height: 60 }, responseIds: [`r${index + 1}`] },
      ],
      responses: [{ id: `r${index + 1}`, kind: "short-text", acceptedAnswers: ["동시에"], grading: "exact-normalized", explanation: "네 조건이 동시에 성립해야 한다." }],
    })),
  };
}

test("가짜 모델로 요청 하나를 5단계부터 출제 기록까지 자동 실행하고, 사용량 한도면 멈췄다가 이어간다", async (t) => {
  const createdRuns: string[] = [];
  t.after(async () => {
    setFakeModelResponder(null);
    await Promise.all(createdRuns.map((id) => rm(path.join(authoringRunsRoot(), id), { recursive: true, force: true })));
  });
  const bytes = await readFile(path.join(process.cwd(), "eval/corpus/user-test-pdfs", PDF));
  const source = await registerMcpSource(PDF, bytes);
  const settings = { model: "gpt-6-sol" as const, effort: "medium" as const };
  const request = await createExperimentRequest({
    sourceId: source.id, scope: { pageNumbers: [1], outlineLeafIds: [] }, purpose: "데드락 조건을 설명한다.",
    abilities: ["말로 설명하기"],
    requestedStages: { analyze: settings, "concept-tree": settings, "learning-design": settings, "activity-design": settings, cards: settings },
    stopAfterStage: "cards",
  });

  const purposes: string[] = [];
  let limitOnce = true;
  let leakOnce = true;
  setFakeModelResponder((call) => {
    purposes.push(call.purpose);
    if (call.purpose === "stage:learning-design" && limitOnce) {
      limitOnce = false;
      throw new ModelError("usage_limit", "limit");
    }
    if (call.purpose.startsWith("stage:")) {
      const stage = call.purpose.slice(6);
      if (stage === "analyze") assert.match(call.user, /\[원문: 선택 쪽 추출 글자\]\n\[p\.1\]/);
      if (stage === "concept-tree") assert.match(call.user, /\[원문: 선택 쪽 추출 글자\]\n\[p\.1\]/, "개념 구조도 원문을 받는다");
      if (stage === "activity-design") assert.doesNotMatch(call.user, /\[원문: 선택 쪽 추출 글자\]/);
      if (stage === "cards") assert.doesNotMatch(call.user, /\[원문: 선택 쪽 추출 글자\]/, "카드는 학습 단위 근거만 본다");
      return JSON.stringify(stageReplies[stage]);
    }
    const leak = call.purpose === "authoring" && leakOnce;
    if (leak) leakOnce = false;
    if (call.purpose === "authoring:revise") assert.match(call.user, /answer-leak-before-reveal/);
    return "```json\n" + JSON.stringify(authoringReply(call.user, leak)) + "\n```";
  });

  const caller = { uid: "local" };
  const paused = await runStudyRequest(request.id, caller);
  assert.equal(paused.status, "paused-usage-limit");
  assert.equal(paused.phase, "stages");
  assert.equal("claimToken" in paused, false);
  assert.equal((await getExperimentRequest(request.id)).status, "running", "한도에 닿아도 요청을 실패로 돌리지 않는다");

  const done = await runStudyRequest(request.id, caller);
  assert.equal(done.status, "done", done.message);
  assert.deepEqual(purposes, [
    "stage:analyze", "stage:concept-tree", "stage:learning-design",
    "stage:learning-design", "stage:activity-design", "stage:cards", "authoring", "authoring:revise",
  ]);

  const finished = await getExperimentRequest(request.id);
  assert.equal(finished.status, "completed");
  assert.ok(finished.runId);
  createdRuns.push(finished.runId);
  const view = await getMcpRunView(`mcp:${finished.runId}`);
  assert.equal(view?.executionRequestStatus, "completed", "요청 기록과 실행 저장본이 검증을 통과해야 한다");

  const runDir = path.join(authoringRunsRoot(), finished.runId);
  const first = JSON.parse(await readFile(path.join(runDir, "iteration-0", "inspection.json"), "utf8")) as Array<{ code: string }>;
  assert.ok(first.some((issue) => issue.code === "answer-leak-before-reveal"));
  const second = JSON.parse(await readFile(path.join(runDir, "iteration-1", "inspection.json"), "utf8")) as Array<{ severity: string }>;
  assert.equal(second.filter((issue) => issue.severity === "error").length, 0);
  const execution = JSON.parse(await readFile(path.join(runDir, "iteration-1", "execution.json"), "utf8")) as { toolCalls: string[] };
  assert.ok(execution.toolCalls.includes("record_problem_iteration"));

  // A finished request is not run again.
  assert.equal((await runStudyRequest(request.id, caller)).status, "done");
  assert.equal(purposes.length, 8);
  assert.equal((await executorView(request.id))?.calls, 8);
  await stat(path.join(root, "study-executor", `${request.id}.json`));

  // 다시 만들기: the learning-design prefix is copied (no model call), then activity-design → cards → authoring.
  const design = finished.stages.find((entry) => entry.stage === "learning-design")?.output as { learningDesign: { objectives: Array<{ id: string }> } };
  const objectiveId = design.learningDesign.objectives[0]!.id;
  const built = buildRemakeBody({ id: source.id, pageCount: source.pageCount, outline: { status: "missing" } }, finished as Parameters<typeof buildRemakeBody>[1], [objectiveId]);
  assert.ok(!("error" in built), JSON.stringify(built));
  const remake = await createExperimentRequest(built.body);
  purposes.length = 0;
  const remade = await runStudyRequest(remake.id, caller);
  assert.equal(remade.status, "done", remade.message);
  assert.deepEqual(purposes, ["stage:activity-design", "stage:cards", "authoring"]);
  const remadeRequest = await getExperimentRequest(remake.id);
  assert.equal(remadeRequest.status, "completed");
  assert.ok(remadeRequest.runId && remadeRequest.runId !== finished.runId);
  createdRuns.push(remadeRequest.runId);
  assert.deepEqual(remadeRequest.stages.map((entry) => entry.actual.reusedFrom ? "reused" : "model"), ["reused", "reused", "reused", "model", "model"]);
  assert.equal((await getMcpRunView(`mcp:${remadeRequest.runId}`))?.executionRequestStatus, "completed");
  await stat(path.join(authoringRunsRoot(), remadeRequest.runId, "iteration-0", "document.json"));
});

test("대기열 없이 running으로 남은 기록은 멈춤(interrupted)으로 보이고 토큰은 노출하지 않는다", async () => {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const id = `req_${"a".repeat(32)}`;
  await mkdir(path.join(root, "study-executor"), { recursive: true });
  await writeFile(path.join(root, "study-executor", `${id}.json`), JSON.stringify({
    requestId: id, status: "running", phase: "stages", message: "", calls: 2, claimToken: "f".repeat(64), updatedAt: new Date().toISOString(),
  }));
  const view = await executorView(id);
  assert.equal(view?.status, "interrupted");
  assert.equal(JSON.stringify(view).includes("f".repeat(64)), false);
});

test("단계 검사를 3번 못 넘으면 실패가 아니라 멈춤이 되고, 고칠 때는 이전 답을 보여 주며, 다시 시작하면 그 단계부터 잇는다", async () => {
  const bytes = await readFile(path.join(process.cwd(), "eval/corpus/user-test-pdfs", PDF));
  const source = await registerMcpSource(PDF, bytes);
  const settings = { model: "gpt-6-sol" as const, effort: "medium" as const };
  const request = await createExperimentRequest({
    sourceId: source.id, scope: { pageNumbers: [1], outlineLeafIds: [] }, purpose: "개념 구조만 확인한다.",
    requestedStages: { analyze: settings, "concept-tree": settings }, stopAfterStage: "concept-tree",
  });
  // A child concept without (p.N), like "Overview of 3D Viewing Concepts" in the real run.
  const missingPage = { treeText: "데드락\n- 개요\n- [필요조건] 상호 배제 — 동시에 공유할 수 없음 (p.1)" };
  const users: string[] = [];
  let fixed = false;
  setFakeModelResponder((call) => {
    if (call.purpose === "stage:analyze") return JSON.stringify(stageReplies.analyze);
    users.push(call.user);
    return JSON.stringify(fixed ? stageReplies["concept-tree"] : missingPage);
  });
  try {
    const caller = { uid: "local" };
    const paused = await runStudyRequest(request.id, caller);
    assert.equal(paused.status, "paused-invalid");
    assert.match(paused.message, /개념 구조 단계가 검사를 3번/);
    assert.equal(paused.stage, "concept-tree");
    assert.equal(users.length, 3);
    assert.doesNotMatch(users[0]!, /\[이전 답\]/);
    assert.match(users[1]!, /\[이전 답\][\s\S]*개요[\s\S]*\[검사 오류\][\s\S]*PDF 페이지 근거/);
    assert.equal((await getExperimentRequest(request.id)).status, "running", "검사 실패는 요청을 실패로 돌리지 않는다");

    fixed = true;
    const done = await runStudyRequest(request.id, caller);
    assert.equal(done.status, "done", done.message);
    assert.equal(users.length, 4, "다시 시작은 analyze를 다시 부르지 않고 개념 구조부터 잇는다");
    assert.equal((await getExperimentRequest(request.id)).status, "completed");
  } finally { setFakeModelResponder(null); }
});

test("모델 덮어쓰기 설정과 호출 시간이 기록되고, JSON이 아닌 답은 한 번의 시도로 센다", async () => {
  const bytes = await readFile(path.join(process.cwd(), "eval/corpus/user-test-pdfs", PDF));
  const source = await registerMcpSource(PDF, bytes);
  const settings = { model: "gpt-6-sol" as const, effort: "medium" as const };
  const request = await createExperimentRequest({
    sourceId: source.id, scope: { pageNumbers: [1], outlineLeafIds: [] }, purpose: "분석만 확인한다.",
    requestedStages: { analyze: settings }, stopAfterStage: "analyze",
  });
  const seen: Array<{ model?: string; effort?: string }> = [];
  let first = true;
  setFakeModelResponder((call) => {
    seen.push({ model: call.model, effort: call.effort });
    if (first) { first = false; return "죄송하지만 목차는 다음과 같습니다"; }
    return JSON.stringify(stageReplies.analyze);
  });
  process.env.STUDY_FORGE_EXECUTOR_MODEL = "gpt-6-luna";
  process.env.STUDY_FORGE_EXECUTOR_EFFORT = "low";
  try {
    const done = await runStudyRequest(request.id, { uid: "local" });
    assert.equal(done.status, "done", done.message);
    assert.deepEqual(seen, [{ model: "gpt-6-luna", effort: "low" }, { model: "gpt-6-luna", effort: "low" }]);
    assert.deepEqual(done.timings?.map((entry) => [entry.purpose, entry.effort, entry.ok]), [["stage:analyze", "low", false], ["stage:analyze", "low", true]]);
  } finally {
    setFakeModelResponder(null);
    delete process.env.STUDY_FORGE_EXECUTOR_MODEL;
    delete process.env.STUDY_FORGE_EXECUTOR_EFFORT;
  }
});

test("실제 공급자에게 JSON 응답을 요청하고, 잘못 쓴 추론 강도 환경변수는 무시한다", async () => {
  const bytes = await readFile(path.join(process.cwd(), "eval/corpus/user-test-pdfs", PDF));
  const source = await registerMcpSource(PDF, bytes);
  const settings = { model: "gpt-6-sol" as const, effort: "high" as const };
  const request = await createExperimentRequest({
    sourceId: source.id, scope: { pageNumbers: [1], outlineLeafIds: [] }, purpose: "JSON 요청 확인",
    requestedStages: { analyze: settings }, stopAfterStage: "analyze",
  });
  const seen: Array<{ json?: boolean; effort?: string }> = [];
  setFakeModelResponder((call) => { seen.push({ json: call.json, effort: call.effort }); return JSON.stringify(stageReplies.analyze); });
  process.env.STUDY_FORGE_EXECUTOR_EFFORT = "hgih";
  try {
    const done = await runStudyRequest(request.id, { uid: "local" });
    assert.equal(done.status, "done", done.message);
    assert.deepEqual(seen, [{ json: true, effort: "high" }]);
  } finally {
    setFakeModelResponder(null);
    delete process.env.STUDY_FORGE_EXECUTOR_EFFORT;
  }
});

test("한도·로그인·일시 오류·JSON 아닌 답에서 이어갈 때 성공한 단계는 다시 호출하지 않는다", async (t) => {
  const source = await registerMcpSource(PDF, await readFile(path.join("eval/corpus/user-test-pdfs", PDF)));
  const cases = [
    { code: "usage_limit", status: "paused-usage-limit", failures: 1 },
    { code: "login_required", status: "paused-login", failures: 1 },
    { code: "transient", status: "paused-invalid", failures: 3 },
    { code: "invalid_output", status: "paused-invalid", failures: 3 },
  ] as const;
  for (const scenario of cases) await t.test(scenario.code, async () => {
    const settings = { model: "gpt-6-sol" as const, effort: "medium" as const };
    const request = await createExperimentRequest({
      sourceId: source.id, scope: { pageNumbers: [1], outlineLeafIds: [] }, purpose: `고장 복구 ${scenario.code}`,
      requestedStages: { analyze: settings, "concept-tree": settings }, stopAfterStage: "concept-tree",
    });
    const purposes: string[] = [];
    let recovered = false;
    setFakeModelResponder((call) => {
      purposes.push(call.purpose);
      if (call.purpose === "stage:concept-tree" && !recovered) {
        if (scenario.code === "invalid_output") return "목차를 읽었지만 JSON은 쓰지 않은 응답";
        throw new ModelError(scenario.code, "검증용 고장");
      }
      return JSON.stringify(stageReplies[call.purpose.slice(6)]);
    });
    try {
      const paused = await runStudyRequest(request.id, { uid: "local" });
      assert.equal(paused.status, scenario.status, paused.message);
      assert.equal((await getExperimentRequest(request.id)).stages.length, 1);
      const failedCalls = paused.timings ?? [];
      assert.equal(failedCalls.filter((call) => call.ok).length, 1);
      assert.equal(failedCalls.filter((call) => !call.ok).length, scenario.failures);
      recovered = true;
      const done = await runStudyRequest(request.id, { uid: "local" });
      assert.equal(done.status, "done", done.message);
      assert.equal(purposes.filter((purpose) => purpose === "stage:analyze").length, 1, "성공한 분석은 재호출하지 않는다");
      const calls = done.timings ?? [];
      assert.equal(calls.filter((call) => call.ok).length, 2);
      assert.equal(calls.filter((call) => !call.ok).length, scenario.failures);
      assert.equal(done.calls, 2 + scenario.failures, "실패 호출도 총 호출 수에 포함된다");
      await runStudyRequest(request.id, { uid: "local" });
      assert.equal(purposes.length, 2 + scenario.failures, "완료된 요청은 다시 호출하지 않는다");
    } finally { setFakeModelResponder(null); }
  });
});

test("서버 프로세스가 사라져도 저장된 성공 단계와 호출 기록을 읽어 새 프로세스에서 이어간다", async () => {
  const source = await registerMcpSource(PDF, await readFile(path.join("eval/corpus/user-test-pdfs", PDF)));
  const settings = { model: "gpt-6-sol" as const, effort: "medium" as const };
  const request = await createExperimentRequest({
    sourceId: source.id, scope: { pageNumbers: [1], outlineLeafIds: [] }, purpose: "서버 재시작 복구",
    requestedStages: { analyze: settings, "concept-tree": settings }, stopAfterStage: "concept-tree",
  });
  const execute = promisify(execFile);
  const moduleUrl = pathToFileURL(path.join(process.cwd(), "src/lib/study/auto-executor.ts")).href;
  const modelUrl = pathToFileURL(path.join(process.cwd(), "src/lib/ai/model.ts")).href;
  const program = (crash: boolean) => `
    const {setFakeModelResponder}=await import(${JSON.stringify(modelUrl)});
    const {runStudyRequest}=await import(${JSON.stringify(moduleUrl)});
    const replies=${JSON.stringify(stageReplies)};
    setFakeModelResponder(call=>{
      if (${crash} && call.purpose === "stage:concept-tree") process.exit(75);
      return JSON.stringify(replies[call.purpose.slice(6)]);
    });
    const result=await runStudyRequest(${JSON.stringify(request.id)},{uid:"local"});
    console.log(JSON.stringify({status:result.status,calls:result.calls,message:result.message}));`;
  await assert.rejects(execute(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--input-type=module", "-e", program(true)], {
    cwd: process.cwd(), env: { ...process.env, STUDY_FORGE_DATA_DIR: root, STUDY_FORGE_MODEL_PROVIDER: "fake" },
  }), (error: unknown) => (error as { code?: number }).code === 75);
  assert.equal((await executorView(request.id))?.status, "interrupted");
  assert.deepEqual((await getExperimentRequest(request.id)).stages.map((stage) => stage.stage), ["analyze"]);
  const resumed = await execute(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--input-type=module", "-e", program(false)], {
    cwd: process.cwd(), env: { ...process.env, STUDY_FORGE_DATA_DIR: root, STUDY_FORGE_MODEL_PROVIDER: "fake" },
  });
  const result = JSON.parse(resumed.stdout.trim()) as { status: string; calls: number; message: string };
  assert.equal(result.status, "done", result.message);
  assert.equal(result.calls, 3);
  const calls = (await executorView(request.id))?.timings ?? [];
  assert.equal(calls.filter((call) => call.purpose === "stage:analyze").length, 1);
  assert.equal(calls.filter((call) => call.ok).length, 2);
  assert.equal(result.calls - calls.length, 1, "끝나기 전에 끊긴 호출도 총 호출 수에 보존된다");
});
