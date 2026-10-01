// Auto-executor for 되짚기 generation requests (docs/DECISIONS.md, 2026-09-30 "ChatGPT 계정으로 생성").
// It does, in code, what the MCP chat executor does by hand: claim → five stages (submit + request record)
// → authoring packet → author → check → at most one revision → record. Model calls go through callModel().
// A usage limit or missing login pauses the request; it resumes from the stage it stopped at.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { callModel, ModelError, type ModelCaller } from "../ai/model.ts";
import { labConfigSchema, redactCallText, type LabConfig, type CallRecord } from "./lab-contract.ts";
import { labFakeReply } from "./lab-fake.ts";
import {
  claimExperimentRequest,
  experimentStages,
  failExperimentRequest,
  getExperimentRequest,
  recordExperimentProgress,
  ExperimentRequestError,
} from "../mcp-experiment-requests.ts";
import { getMcpRunView } from "../mcp-run-view.ts";
import { readRegisteredMcpSourcePdf } from "../mcp-source-registry.ts";
import { ChatGptParityService } from "../../../tools/study-forge-mcp/chatgpt-parity.ts";
import { prepareAuthoringPacket, authoringRunsRoot } from "../../../tools/study-forge-mcp/authoring-packet.ts";
import { extractPdfPageTexts } from "../../../tools/study-forge-mcp/source-evidence.ts";
import { blockingIssues, readAuthoringInstructions, recordProblemIteration } from "../../../tools/problem-authoring-lab/authoring-io.ts";
import type { AuthoringDocument } from "../../../tools/problem-authoring-lab/contract.ts";

type Stage = (typeof experimentStages)[number];
export type ExecutorStatus = "queued" | "running" | "paused-step" | "paused-usage-limit" | "paused-login" | "paused-invalid" | "interrupted" | "failed" | "done";
type ExecutorState = {
  requestId: string;
  status: ExecutorStatus;
  phase: "stages" | "authoring" | "done";
  message: string;
  calls: number;
  /** What the executor is on now, for the screen: a stage name or "authoring", and the try number. */
  stage?: string;
  attempt?: number;
  /** Every model call of this request: what it was for, which model, and how long it took. */
  timings?: Array<{ purpose: string; model: string; effort: string; ms: number; ok: boolean }>;
  claimToken?: string;
  runId?: string;
  updatedAt: string;
  lab?: LabConfig;
};
/** What the screen may see; the claim token never leaves the server. */
export type ExecutorView = Omit<ExecutorState, "claimToken">;

const queueState = globalThis as typeof globalThis & {
  __studyForgeExecutorQueue?: Promise<unknown>;
  __studyForgeExecutorQueued?: Set<string>;
  __studyForgeExecutorWrites?: Map<string, Promise<void>>;
};

/** Calls allowed per start or "다시 시작"; the total across restarts is kept in `calls`. */
export const MAX_MODEL_CALLS = 14;
const efforts = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;
type Effort = (typeof efforts)[number];
/** A mistyped STUDY_FORGE_EXECUTOR_EFFORT is ignored; it would otherwise fail the request record after the call was paid for. */
const envEffort = () => { const value = process.env.STUDY_FORGE_EXECUTOR_EFFORT?.trim(); return value && (efforts as readonly string[]).includes(value) ? value : undefined; };
/** Tries per stage: the first answer plus two corrections that see the previous answer and the check error. */
export const STAGE_ATTEMPTS = 3;
const STAGE_LABEL: Record<string, string> = {
  analyze: "자료 구조", "concept-tree": "개념 구조", "learning-design": "학습 설계", "activity-design": "활동 설계", cards: "카드", authoring: "문제 만들기",
};
const PAGE_TEXT_LIMIT = 3500;
const TOTAL_TEXT_LIMIT = 60_000;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const dataRoot = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "study-executor");
const labDir = () => path.dirname(authoringRunsRoot());
const stateFile = (id: string) => {
  if (!/^req_[a-f0-9]{32}$/.test(id)) throw new Error("요청 ID 형식이 올바르지 않습니다.");
  return path.join(dataRoot(), `${id}.json`);
};

async function loadState(id: string): Promise<ExecutorState | null> {
  try { return JSON.parse(await readFile(stateFile(id), "utf8")) as ExecutorState; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function saveState(state: ExecutorState) {
  state.updatedAt = new Date().toISOString();
  await saveExecutorJson(stateFile(state.requestId), JSON.stringify(state, null, 2));
}
async function saveExecutorJson(file: string, text: string) {
  const writes = (queueState.__studyForgeExecutorWrites ??= new Map());
  const pending = (writes.get(file) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(temporary, text, { mode: 0o600 });
      for (let attempt = 0; ; attempt += 1) {
        try { await rename(temporary, file); break; }
        catch (error) {
          // Windows readers/virus scanners can briefly hold the destination open.
          const code = (error as NodeJS.ErrnoException).code;
          if (!["EPERM", "EACCES", "EBUSY"].includes(code ?? "") || attempt >= 5) throw error;
          await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
        }
      }
    } catch {
      throw new Error("생성 기록을 저장하지 못했어요. 잠시 기다렸다가 다시 시작해 주세요.");
    } finally { await rm(temporary, { force: true }).catch(() => undefined); }
  });
  writes.set(file, pending);
  try { await pending; }
  finally { if (writes.get(file) === pending) writes.delete(file); }
}
export async function configureLab(id: string, config: unknown) {
  const state = await loadState(id);
  if (queueState.__studyForgeExecutorQueued?.has(id) || state?.status === "done" || state?.status === "failed") throw new ExperimentRequestError(409, "멈춘 실행만 변경할 수 있습니다.");
  const lab = labConfigSchema.parse(config);
  if (state?.lab && lab.provider !== state.lab.provider) throw new ExperimentRequestError(409, "실행 중 공급자는 바꿀 수 없습니다.");
  await saveState({ requestId: id, status: "paused-step", phase: "stages", message: "", calls: 0, updatedAt: "", ...state, lab });
}
export async function isLabRequest(id: string) { return Boolean((await loadState(id))?.lab); }
const callsRoot = (id: string) => path.join(path.dirname(stateFile(id)), id, "calls");
export async function readExecutorCalls(id: string): Promise<CallRecord[]> {
  const { readdir } = await import("node:fs/promises");
  let files: string[];
  try { files = await readdir(callsRoot(id)); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
  return Promise.all(files.filter((f) => /^\d+\.json$/.test(f)).sort((a,b) => parseInt(a)-parseInt(b)).map(async (f) => JSON.parse(await readFile(path.join(callsRoot(id), f), "utf8")) as CallRecord));
}
async function writeCall(id: string, call: CallRecord) {
  if (!await isLabRequest(id)) return;
  const file = path.join(callsRoot(id), `${call.n}.json`);
  await saveExecutorJson(file, JSON.stringify(call));
}
export function executorSettings(stage: string, request: Awaited<ReturnType<typeof getExperimentRequest>>, lab?: LabConfig, options: {model?:string;effort?:string} = {}) {
  const requested = request.input.requestedStages[stage === "authoring" ? "cards" : stage as Stage];
  return { model: lab?.stages[stage as keyof LabConfig["stages"]]?.model ?? options.model ?? (process.env.STUDY_FORGE_EXECUTOR_MODEL?.trim() || undefined) ?? requested?.model ?? "gpt-6-sol",
    effort: (lab?.stages[stage as keyof LabConfig["stages"]]?.effort ?? options.effort ?? envEffort() ?? requested?.effort ?? "medium") as Effort };
}
export async function executorView(id: string): Promise<ExecutorView | null> {
  const state = await loadState(id);
  if (!state) return null;
  const { claimToken: _claimToken, ...view } = state;
  void _claimToken;
  // Saved as queued/running but not in this process's queue: the server stopped mid-run.
  if ((view.status === "queued" || view.status === "running") && !queueState.__studyForgeExecutorQueued?.has(id)) {
    return { ...view, status: "interrupted", message: "서버가 다시 시작돼 생성이 멈췄어요. 다시 시작하면 멈춘 단계부터 이어가요." };
  }
  return view;
}

class StopRun extends Error {
  readonly status: "paused-step" | "paused-usage-limit" | "paused-login" | "paused-invalid" | "failed";
  constructor(status: "paused-step" | "paused-usage-limit" | "paused-login" | "paused-invalid" | "failed", message: string) { super(message); this.status = status; }
}

export function pageBlock(texts: Map<number, string>) {
  let budget = TOTAL_TEXT_LIMIT;
  const lines: string[] = [];
  const pagesSent: number[] = [], pagesCut: number[] = [];
  for (const [page, text] of [...texts.entries()].sort((a, b) => a[0] - b[0])) {
    const clipped = (text || "(이 쪽은 추출된 글자가 없음)").slice(0, Math.min(PAGE_TEXT_LIMIT, Math.max(0, budget)));
    budget -= clipped.length;
    if (clipped.length) { lines.push(`[p.${page}]\n${clipped}`); pagesSent.push(page); }
    if (clipped.length < text.length) pagesCut.push(page);
  }
  if (pagesCut.length) lines.push(`[길이 제한] p.${pagesCut.join(", ")}는 길이 제한으로 일부 또는 전체가 빠졌음`);
  return { text: lines.join("\n\n"), input: { pagesSent, pagesCut, charsSent: TOTAL_TEXT_LIMIT-budget } };
}

const STAGE_SYSTEM = [
  "너는 Recaller 학습 설계 엔진의 한 단계를 작성한다.",
  "아래 [단계 계약과 입력]의 instructions와 outputContract(또는 format)를 그대로 따른다.",
  "원문에 없는 사실을 만들지 않는다. 원문의 기호·용어·표기를 바꾸지 않는다.",
  "응답은 계약이 요구하는 키를 가진 JSON 객체 하나만 쓴다. 설명 문장이나 코드 울타리를 덧붙이지 않는다.",
  // The stage instructions were written for the MCP chat executor, which reads pages with a tool. Here there is no tool.
  "instructions가 원문 읽기 도구(get_study_generation_source_pages 등)나 첨부 PDF를 말하면, 그 대신 아래 [원문: 선택 쪽 추출 글자]를 읽은 결과로 여긴다. 도구는 없다.",
  "근거·인용 칸에는 [원문: 선택 쪽 추출 글자]의 문구를 글자 그대로 복사한다. 요약하거나 번역하거나 고쳐 쓰지 않는다.",
  "개념 구조는 맨 위 항목 하나로 끝내지 않는다. 원문에 실제로 있는 하위 개념마다 (p.쪽번호)를 붙여 나눈다.",
].join("\n");

const AUTHORING_FORMAT = `문제 문서(JSON) 형식 — problem-authoring-v1
{ "schemaVersion": "problem-authoring-v1", "id": "<문서 id>", "title": "<제목>",
  "questions": [ {
    "id": "question-1",
    "source": <패킷 items의 항목에서 learningUnitId, objectiveId, sourceId, sourcePage, sourcePages, sourceRange, sourceText, target, successCriteria, knowledgeContent를 글자 하나 바꾸지 않고 그대로 복사>,
    "page": { "width": 760, "height": 600 },
    "blocks": [ 각 블록은 { "id", "kind", "frame": {"x","y","width","height"} (페이지 안, 위에서 아래로 빈틈 없이) } +
      text {text, style?: "heading"|"body"} | math {latex} | table {rows, headerRows?} | box {label} |
      choice-set {responseId, optionIds} | blank {responseId, promptBefore, promptAfter} | answer-reveal {responseIds} ],
    "responses": [ {"id","kind":"single-choice","options":[{"id","text"}],"correctOptionId","grading":"exact","explanation"}
                 | {"id","kind":"short-text","acceptedAnswers":["..."],"grading":"exact-normalized"|"self-check","explanation"} ]
  } ] }
규칙: 응답마다 choice-set 또는 blank 하나, 문항마다 answer-reveal 하나. 공개 전에 보이는 글에 정답을 쓰지 않는다.
exact-normalized는 짧은 값 하나에만 쓴다(여러 요소면 self-check). 오답은 흔한 오개념으로, 정답과 길이·문체를 맞춘다.`;

function authoringMethods(abilities: readonly string[] = []) {
  const methods: Array<"selection" | "recall-blank" | "relationship-structure" | "graph-geometry"> = ["selection", "recall-blank"];
  if (abilities.includes("식·절차 쓰기")) methods.push("relationship-structure");
  if (abilities.includes("계산·적용하기")) methods.push("graph-geometry");
  return methods;
}

export async function runStudyRequest(requestId: string, caller: ModelCaller, options: { model?: string; effort?: string } = {}): Promise<ExecutorView> {
  const state: ExecutorState = (await loadState(requestId)) ?? {
    requestId, status: "queued", phase: "stages", message: "", calls: 0, updatedAt: new Date().toISOString(),
  };
  if (state.status === "done" || state.status === "failed") return (await executorView(requestId))!;
  let request = await getExperimentRequest(requestId);
  // STUDY_FORGE_EXECUTOR_MODEL / _EFFORT switch every call to one model for trying faster setups without new requests.
  let inputInfo = { pagesSent: [] as number[], pagesCut: [] as number[], charsSent: 0 };
  let lastCall: CallRecord | null = null;
  const checked = async (error: string | null) => {
    if (lastCall) { lastCall.ok = !error; lastCall.error = error ? redactCallText(error) : null; await writeCall(requestId, lastCall); }
    if (state.timings?.length) { state.timings[state.timings.length-1].ok = !error; await saveState(state); }
  };
  let callsThisRun = 0;
  const ask = async (purpose: string, system: string, user: string) => {
    const { model, effort } = executorSettings(state.stage ?? "authoring", request, state.lab, options);
    if (callsThisRun >= MAX_MODEL_CALLS) throw new StopRun("paused-invalid", `한 번에 쓸 수 있는 호출 수(${MAX_MODEL_CALLS})를 다 썼어요. 다시 시작하면 멈춘 단계부터 이어가요.`);
    callsThisRun += 1;
    state.calls += 1;
    await saveState(state);
    const started = Date.now();
    lastCall = { n: state.calls, purpose, attempt: state.attempt ?? 1, model, effort, startedAt: new Date(started).toISOString(), ms: 0, ok: false, system: redactCallText(system), user: redactCallText(user), reply: null, error: null, input: inputInfo };
    await writeCall(requestId, lastCall);
    const timed = async (ok: boolean, served = model) => {
      state.timings = [...(state.timings ?? []), { purpose, model: served, effort, ms: Date.now() - started, ok }];
      await saveState(state);
    };
    try {
      if (state.lab?.provider === "fake" && (process.env.NODE_ENV === "production" || process.env.STUDY_FORGE_LOCAL_EXPERIMENT !== "1")) throw new ModelError("not_configured", "가짜 실험은 로컬 모드에서만 가능합니다.");
      const fakeReply = state.lab?.provider === "fake" ? await labFakeReply(state.stage ?? "authoring", user, request.sourceSnapshot!.fileName, state.lab.scenario, state.attempt ?? 1) : undefined;
      // json: true asks the real backend for a JSON object reply (structured output) and parses it.
      const reply = await callModel({ purpose, system, user, json: true, model, effort, caller, provider: state.lab?.provider, fakeReply });
      lastCall.reply = redactCallText(reply.text); lastCall.usage = reply.usage; lastCall.ms = Date.now()-started; lastCall.model = reply.model;
      await writeCall(requestId, lastCall);
      lastCall.ok = true; await writeCall(requestId, lastCall);
      await timed(true, reply.model);
      return reply;
    } catch (error) {
      // A reply that was not JSON is still kept in the call record.
      const rawText = (error as { rawText?: string }).rawText;
      if (rawText !== undefined) lastCall.reply = redactCallText(rawText);
      lastCall.ms = Date.now()-started; lastCall.error = redactCallText(error instanceof Error ? error.message : String(error)); await writeCall(requestId,lastCall);
      await timed(false);
      if (error instanceof ModelError && error.code === "usage_limit") throw new StopRun("paused-usage-limit", "ChatGPT 사용량 한도에 닿았어요. 한도가 풀리면 다시 시작해 주세요.");
      if (error instanceof ModelError && (error.code === "login_required" || error.code === "not_configured")) throw new StopRun("paused-login", error.message);
      throw error;
    }
  };

  try {
    if (!state.claimToken) {
      if (request.status !== "waiting-for-executor") throw new StopRun("failed", "이미 다른 실행자가 가져간 요청이에요.");
      const claimed = await claimExperimentRequest(requestId);
      state.claimToken = claimed.claimToken;
    }
    state.status = "running"; state.message = "";
    await saveState(state);

    if (state.phase === "stages") {
      const source = request.sourceSnapshot;
      if (!source) throw new StopRun("failed", "등록 PDF 정보가 없는 요청은 자동 실행할 수 없어요.");
      const bytes = await readRegisteredMcpSourcePdf(source.id);
      if (!bytes) throw new StopRun("failed", "등록된 원본 PDF를 읽을 수 없어요.");
      const pages = request.input.scope.pageNumbers;
      const texts = await extractPdfPageTexts(bytes, pages);
      const block = pageBlock(texts);
      const service = new ChatGptParityService();
      const started = await service.startRun({
        clientRequestId: request.id,
        title: source.fileName.replace(/\.pdf$/i, ""),
        files: [{ fileName: source.fileName, pageCount: source.pageCount, sourceId: source.id, sha256: source.sha256 }],
        learningGoal: request.input.purpose,
        ...(request.input.abilities?.length ? { abilities: [...request.input.abilities] } : {}),
        ...(request.input.selectedObjectiveIds?.length ? { selectedObjectiveIds: [...request.input.selectedObjectiveIds] } : {}),
        stopAfterStage: request.input.stopAfterStage,
      });
      const runId = started.runId;
      state.runId = runId;
      await saveState(state);

      const reuse = request.input.reuse;
      const recordStage = async (stage: Stage, inputSha256: string, modelName: string) => {
        const stored = await service.stageRecord(runId, stage);
        const outputSha256 = sha256(JSON.stringify(stored.artifact));
        const inPrefix = reuse?.kind === "output" && experimentStages.indexOf(stage) <= experimentStages.indexOf(reuse.stage);
        const now = new Date().toISOString();
        request = await recordExperimentProgress(requestId, {
          claimToken: state.claimToken!, stage, runId,
          actual: {
            model: inPrefix ? "reused-output" : modelName, effort: executorSettings(stage, request, state.lab, options).effort,
            // A copied stage keeps the source run's timestamps, so it is reported at the time of reuse.
            startedAt: inPrefix ? now : stored.startedAt ?? now,
            finishedAt: inPrefix ? now : [stored.completedAt ?? now, stored.startedAt ?? now].sort().at(-1)!,
            inputSha256, outputSha256,
            ...(inPrefix ? { reusedFrom: { kind: "output" as const, runId: reuse!.runId, stage, sha256: outputSha256 } } : {}),
          },
          output: stored.artifact,
        }, stage === request.input.stopAfterStage);
      };

      // Re-generation: copy the verified learning-design prefix; no model call for those stages.
      if (reuse?.kind === "output" && request.stages.length === 0) {
        const sourceRunId = reuse.runId.replace(/^mcp:/, "");
        const view = await getMcpRunView(`mcp:${sourceRunId}`);
        if (!view) throw new StopRun("failed", "재사용할 원래 실행 기록을 찾지 못했어요.");
        const next = await service.getNextStage(runId);
        if (next.nextStage === "analyze") {
          await service.reuseStagePrefix({
            runId, sourceRunId, stage: reuse.stage, sourceRunSha256: view.source.fileSha256,
            sourceArtifactSha256: reuse.sha256, sourcePdfSha256: source.sha256, selectedPageNumbers: pages,
            ...(view.selectedOutlineLeafIds.status === "recorded" ? { selectedOutlineLeafIds: view.selectedOutlineLeafIds.value } : {}),
          });
        }
        for (const stage of experimentStages.slice(0, experimentStages.indexOf(reuse.stage) + 1)) {
          await recordStage(stage, reuse.sha256, "reused-output");
        }
      }

      // Resume safety: a stage stored in the run but not yet in the request record is recorded first.
      const catchUp = async () => {
        for (const stage of experimentStages) {
          if (request.stages.some((entry) => entry.stage === stage)) continue;
          try { await service.stageRecord(runId, stage); } catch { break; }
          await recordStage(stage, sha256(`resumed:${stage}`), executorSettings(stage, request, state.lab, options).model);
          if (stage === request.input.stopAfterStage) break;
        }
      };
      await catchUp();

      let next = await service.getNextStage(runId);
      while (next.nextStage) {
        const stage = next.nextStage as Stage;
        const contract = JSON.stringify(next.stageInput);
        // Every stage that judges content sees the source; concept-tree without it produced a one-line tree in live runs.
        const needsText = stage !== "activity-design";
        inputInfo = needsText ? block.input : { pagesSent: [], pagesCut: [], charsSent: 0 };
        const user = [
          `[단계] ${stage}`,
          `[자료] ${source.fileName}`,
          `[쪽] ${pages.join(",")}`,
          `[학습 목적] ${request.input.purpose}`,
          request.input.abilities?.length ? `[할 수 있어야 할 것] ${request.input.abilities.join(", ")}` : "",
          `[단계 계약과 입력]\n${contract}`,
          needsText ? `[원문: 선택 쪽 추출 글자]\n${block.text}` : "",
        ].filter(Boolean).join("\n\n");
        let feedback = "";
        let previous = "";
        let submitted: Awaited<ReturnType<ChatGptParityService["submitStage"]>> | null = null;
        let reply: Awaited<ReturnType<typeof ask>> | null = null;
        for (let attempt = 1; attempt <= STAGE_ATTEMPTS && !submitted; attempt += 1) {
          state.stage = stage; state.attempt = attempt;
          // A correction sees its own previous answer; without it the model rewrites from scratch and trips again.
          try {
            reply = await ask(`stage:${stage}`, STAGE_SYSTEM, feedback
              ? `${user}\n\n[이전 답]\n${previous || "(읽을 수 있는 JSON이 아니었음)"}\n\n[검사 오류]\n${feedback}\n\n이전 답에서 검사 오류가 가리킨 부분만 고치고 나머지는 그대로 둔 채, 같은 형식의 JSON 전체를 다시 쓴다.`
              : user);
            submitted = await service.submitStage({ runId, stage, result: reply.data as Record<string, unknown> });
            await checked(null);
          } catch (error) {
            // Stops (usage limit, login, call cap) end the run; unreadable JSON or a dropped call counts as one try.
            if (error instanceof StopRun) throw error;
            feedback = error instanceof ModelError && error.code === "invalid_output"
              ? "응답이 JSON 객체 하나가 아니었습니다. 설명 없이 계약의 키를 가진 JSON 객체만 씁니다."
              : error instanceof Error ? error.message : String(error);
            await checked(feedback);
            previous = reply && !(error instanceof ModelError) ? JSON.stringify(reply.data) : "";
            if (attempt === STAGE_ATTEMPTS) {
              throw new StopRun("paused-invalid", `${STAGE_LABEL[stage]} 단계가 검사를 ${STAGE_ATTEMPTS}번 통과하지 못했어요: ${feedback} · 다시 시작하면 이 단계부터 다시 시도해요.`);
            }
          }
        }
        await recordStage(stage, sha256(contract), reply!.model);
        next = submitted!;
        if (state.lab?.stepMode) {
          if (!next.nextStage) state.phase = request.input.stopAfterStage === "cards" ? "authoring" : "done";
          throw new StopRun("paused-step", "단계가 끝났어요. 결과를 확인하고 다음 단계를 실행하세요.");
        }
      }
      if (request.input.stopAfterStage !== "cards") {
        state.phase = "done"; state.status = "done"; state.message = "";
        await saveState(state);
        return (await executorView(requestId))!;
      }
      state.phase = "authoring";
      await saveState(state);
    }

    if (state.phase === "authoring") {
      inputInfo = {pagesSent:[],pagesCut:[],charsSent:0};
      // Unreadable JSON or a dropped call pauses here; "다시 시작" redoes only the missing iteration.
      const askAuthoring = async (purpose: string, systemText: string, userText: string) => {
        try { return await ask(purpose, systemText, userText); }
        catch (error) {
          if (error instanceof ModelError && (error.code === "invalid_output" || error.code === "transient")) {
            throw new StopRun("paused-invalid", `문제 만들기 응답을 읽지 못했어요: ${error.message} · 다시 시작하면 이 단계부터 다시 시도해요.`);
          }
          throw error;
        }
      };
      state.stage = "authoring"; state.attempt = 1;
      await saveState(state);
      const prepared = await prepareAuthoringPacket(requestId);
      const lab = labDir();
      const runDir = path.join(lab, "runs", prepared.authoringRunId);
      const exists = async (file: string) => readFile(path.join(runDir, file), "utf8").then(() => true, () => false);
      const instructions = await readAuthoringInstructions(lab, authoringMethods(request.input.abilities));
      const system = [instructions.skill, ...Object.values(instructions.references), AUTHORING_FORMAT,
        "응답은 문제 문서 JSON 하나만 쓴다."].join("\n\n");
      const packetText = JSON.stringify(prepared.packet, null, 2);
      const baseUser = `[출제 패킷]\n${packetText}\n[/출제 패킷]\n\n패킷의 items마다 문항을 하나 이상 만든다.`;
      const execution = (modelName: string) => ({
        model: modelName, sessionId: `auto-executor:${requestId}`, usage: { calls: state.calls },
        toolCalls: ["prepare_authoring_packet", "load_source_packet", "get_authoring_instructions", "validate_problem_document", "render_problem_preview", "record_problem_iteration"],
      });

      let document: AuthoringDocument;
      let errors: Awaited<ReturnType<typeof blockingIssues>>;
      if (await exists("iteration-0/document.json")) {
        document = JSON.parse(await readFile(path.join(runDir, "iteration-0", "document.json"), "utf8")) as AuthoringDocument;
        errors = (await blockingIssues(lab, document, prepared.packetPath)).filter((issue) => issue.severity === "error");
      } else {
        const first = await askAuthoring("authoring", system, baseUser);
        document = first.data as AuthoringDocument;
        const issues = await blockingIssues(lab, document, prepared.packetPath);
        errors = issues.filter((issue) => issue.severity === "error");
        await checked(errors.length ? JSON.stringify(errors) : null);
        await recordProblemIteration(lab, { runId: prepared.authoringRunId, iteration: 0, packetPath: prepared.packetPath, document, issues, execution: execution(first.model) });
      }
      if (errors.length && !(await exists("iteration-1/document.json"))) {
        state.attempt = 2;
        const revision = await askAuthoring("authoring:revise", system, `${baseUser}\n\n[검사에 걸린 문제]\n${JSON.stringify(errors, null, 2)}\n\n[이전 문서]\n${JSON.stringify(document)}\n\n걸린 부분만 고친 문서 전체를 다시 쓴다. id는 바꾸지 않는다.`);
        const revised = revision.data as AuthoringDocument;
        const issues = await blockingIssues(lab, revised, prepared.packetPath);
        errors = issues.filter((issue) => issue.severity === "error");
        await checked(errors.length ? JSON.stringify(errors) : null);
        await recordProblemIteration(lab, { runId: prepared.authoringRunId, iteration: 1, packetPath: prepared.packetPath, document: revised, issues,
          patch: { instruction: "검사에 걸린 부분 수정", operations: [] }, execution: execution(revision.model) });
      }
      if (errors.length) throw new StopRun("failed", `문제 문서가 검사를 통과하지 못했어요(${errors.length}건). 기록은 남겼어요.`);
      state.phase = "done"; state.status = "done"; state.message = "";
      await saveState(state);
    }
  } catch (error) {
    const stop = error instanceof StopRun ? error : new StopRun("failed", error instanceof Error ? error.message : String(error));
    state.status = stop.status; state.message = stop.message;
    if (stop.status === "failed" && state.phase === "stages" && state.claimToken) {
      const current = await getExperimentRequest(requestId).catch(() => null);
      if (current && (current.status === "claimed" || current.status === "running")) {
        await failExperimentRequest(requestId, { claimToken: state.claimToken, message: stop.message.slice(0, 2000) }).catch(() => undefined);
      }
    }
    await saveState(state);
  }
  return (await executorView(requestId))!;
}

/* One request at a time in this server process. */
export async function enqueueStudyRequest(requestId: string, caller: ModelCaller, confirmed = false) {
  const queued = (queueState.__studyForgeExecutorQueued ??= new Set());
  if (queued.has(requestId)) return;
  const state = await loadState(requestId);
  if (state?.lab?.provider === "chatgpt" && !confirmed) throw new Error("실험실의 실제 모델 실행 확인이 필요합니다.");
  if (state && (state.status === "done" || state.status === "failed")) return;
  queued.add(requestId);
  if (state) { state.status = "queued"; state.message = ""; await saveState(state); }
  else await saveState({ requestId, status: "queued", phase: "stages", message: "", calls: 0, updatedAt: "" });
  queueState.__studyForgeExecutorQueue = (queueState.__studyForgeExecutorQueue ?? Promise.resolve())
    .then(() => runStudyRequest(requestId, caller))
    .catch(() => undefined)
    .finally(() => queued.delete(requestId));
}
