"use client";

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useAuthSession } from "@/components/AuthGate";
import { authenticatedFetch } from "@/lib/firebase-client";
import { showMath, studyQualityIssues, toStudyDeck, type StudyArtifactMeta, type StudyDeck, type StudyOutlineSection } from "@/lib/study/from-authoring";
import { buildRemakeBody, buildRequestBody, defaultPurpose, findReusableRequest } from "@/lib/study/request-form";
import type { McpSourceCatalogEntry } from "@/lib/mcp-source-catalog";
import type { ExperimentRequest } from "@/lib/mcp-experiment-requests";
import type { AuthoringDocument } from "../../../tools/problem-authoring-lab/contract.ts";
import { mountDejipgi, type DejipgiEnv, type DejipgiMaterialStatus, type PlannerDeck } from "./dejipgi-app.js";
import { DEFAULT_GEN_MODELS, defaultChosen, genOutline, mapDigest, type Engine, type GenState, type GenSurvey } from "@/lib/study/gen/types";
import type { StudyNote } from "@/lib/study/notes";
import type { KnowledgeLayer } from "@/lib/study/knowledge";
import { coachCards, type CoachInput } from "@/lib/study/coach";
import { buildLexicon, chunkAt, findTerms, importantTerms } from "@/lib/study/chunk";
import { applyPatches, similarObjectives, termChoice, tooEasy, type LedgerEntry, type PatchMap } from "@/lib/study/quality";
import { askedObjectives, diagnoseBox, planDeckFrom, planSettingsFrom, planToday, renderMemoryAuto, type PlanNote, type PlanRecord, type StudyRules } from "@/lib/study/plan";
import "katex/dist/katex.min.css";
import "./dejipgi.css";
import "./workspace/workspace.css";
import TimerChip from "./workspace/TimerChip";
import KnowledgeSidebar from "./workspace/KnowledgeSidebar";
import AgentScreen from "./workspace/AgentScreen";

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => null);
  const reply = data as { message?: string; error?: string } | null;
  if (!response.ok) throw new Error(reply?.message ?? reply?.error ?? fallback);
  return data as T;
}

export default function DejipgiStudy() {
  const session = useAuthSession();
  const rootRef = useRef<HTMLDivElement>(null);
  // 지식 사이드바: open by default on wide screens; the choice is remembered in this browser.
  const [side, setSide] = useState(false);
  useEffect(() => {
    let open = window.matchMedia("(min-width: 1300px)").matches;
    try { const saved = localStorage.getItem("recaller:side"); if (saved) open = saved === "1"; } catch { /* storage off */ }
    const t = setTimeout(() => setSide(open), 0);
    return () => clearTimeout(t);
  }, []);
  const toggleSide = (open: boolean) => { setSide(open); try { localStorage.setItem("recaller:side", open ? "1" : "0"); } catch { /* storage off */ } };
  const fetchExperiment = useCallback((url: string, init: RequestInit = {}) => session.mode === "local-experiment"
    ? fetch(url, { cache: "no-store", ...init })
    : authenticatedFetch(url, { cache: "no-store", ...init }), [session.mode]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const findSource = async (id: string) => {
      const { sources: catalog } = await readJson<{ sources: McpSourceCatalogEntry[] }>(
        await fetchExperiment("/api/mcp-runs/sources"), "원본 자료를 확인하지 못했어요.");
      const source = catalog.find((item) => item.id === id);
      if (!source) throw new Error("등록한 원본 PDF를 자료 목록에서 찾지 못했어요.");
      return source;
    };
    const loadArtifacts = async () => readJson<{ artifacts: Array<StudyArtifactMeta & { originRunId: string }> }>(
      await fetchExperiment("/api/personalization-lab"), "출제 문서 목록을 불러오지 못했어요.");
    const createQueuedRequest = async (source: McpSourceCatalogEntry, pageText: string, purpose: string,
      options: Parameters<typeof buildRequestBody>[3]) => {
      const built = buildRequestBody(source, pageText, purpose, options);
      if ("error" in built) throw new Error(built.error);
      // After "멈추기" the earlier request stays queued; wait on it again instead of queuing a second paid run.
      const { requests } = await readJson<{ requests: ExperimentRequest[] }>(
        await fetchExperiment("/api/mcp-experiment-requests"), "요청 목록을 확인하지 못했어요.");
      const existing = findReusableRequest(requests, built.body);
      if (existing) return existing;
      const { request } = await readJson<{ request: ExperimentRequest }>(await fetchExperiment("/api/mcp-experiment-requests", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(built.body),
      }), "생성 요청을 저장하지 못했어요.");
      return request;
    };
    // Model errors keep their code so the card can offer "ChatGPT 연결" or "다시 시도".
    const noteCall = async <T,>(body: Record<string, unknown>): Promise<T> => {
      const response = await fetchExperiment("/api/study-notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => null) as (T & { message?: string; code?: string }) | null;
      if (!response.ok) throw Object.assign(new Error(data?.message ?? "노트 요청을 처리하지 못했어요."), { code: data?.code });
      return data as T;
    };
    // In-app executor (docs/DECISIONS.md 2026-09-30 "ChatGPT 계정으로 생성"). When it is off, requests wait for the MCP chat executor.
    type ExecutorInfo = { enabled: boolean; provider: string; model: { ready: boolean; message: string }; executor: null | { status: string; phase: string; message: string; stage?: string; attempt?: number } };
    const executorInfo = async (requestId?: string) => readJson<ExecutorInfo>(await fetchExperiment(
      `/api/study-executor${requestId ? `?id=${encodeURIComponent(requestId)}` : ""}`), "자동 생성 상태를 읽지 못했어요.");
    const kickExecutor = async (requestId: string) => {
      const response = await fetchExperiment("/api/study-executor", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId }),
      });
      if (response.status === 409) return;
      await readJson(response, "자동 생성을 시작하지 못했어요.");
    };
    // ---- engine v2 (/api/lab/gen) ----
    const isGen = (id: string) => /^gen_[a-f0-9]{32}$/.test(id);
    const genState = async (id: string) => (await readJson<{ gen: GenState; label: string }>(await fetchExperiment(`/api/lab/gen/${id}`), "만드는 상태를 읽지 못했어요."));
    const startGen = async (source: McpSourceCatalogEntry, from: number, to: number, purpose: string, note: string, readImages: boolean, pastExamSourceIds?: string[], engine?: Engine, survey?: GenSurvey, deep?: boolean, deepDrafts?: 1 | 2) => {
      const pageNumbers = Array.from({ length: Math.max(1, to - from + 1) }, (_, index) => from + index);
      const { gen } = await readJson<{ gen: GenState }>(await fetchExperiment("/api/lab/gen", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: source.id, fileName: source.fileName, pageNumbers, purpose, note: note.slice(0, 2000), provider: "chatgpt",
          models: DEFAULT_GEN_MODELS, origin: "study", readImages, ...(engine === "recaller" && deep ? { deep: true, ...(deepDrafts === 2 ? { deepDrafts } : {}) } : {}), ...(pastExamSourceIds?.length ? { pastExamSourceIds } : {}), ...(engine && !pastExamSourceIds?.length ? { engine } : {}),
          // v5 streams goals and authors right away; a goal the learner does not want is hidden from practice (목표 빼기).
          ...((engine === "v5" || engine === "alpha") && !pastExamSourceIds?.length ? { autoConfirm: true, ...(survey ? { survey } : {}) } : {}), confirmed: true }),
      }), "문제 만들기를 시작하지 못했어요.");
      return gen;
    };
    const genStatus = async (id: string): Promise<DejipgiMaterialStatus> => {
      const { gen, label } = await genState(id);
      const done = gen.sections.filter((section) => section.author).length;
      const calls = gen.calls ? ` · 호출 ${gen.calls}번` : "";
      // 만들면서 바로 읽기: the outline and planned goals show as soon as they exist, with each unit's state.
      const shown = { ...(gen.sections.length ? { outline: genOutline(gen) } : {}), ...(gen.v3?.map ? { knowledge: mapDigest(gen) } : {}) };
      if (gen.status === "awaiting-confirm") {
        const objectives = gen.sections.flatMap((section) => (section.design?.objectives ?? []).map((objective) => ({
          id: objective.id, section: section.title, part: section.parts?.find((part) => part.pages.includes(objective.pages[0]))?.title,
          statement: objective.statement, recall: objective.recall, importance: objective.importance })));
        return { ...shown, status: "confirm", message: `목표 ${objectives.length}개를 확인해 주세요`, objectives, chosen: defaultChosen(gen.input.purpose, objectives) };
      }
      // Authored sections are a deck already (artifactId), so the learner can start before the rest is made.
      const partial = { ...shown, ...(gen.sections.some((section) => (section.author?.questionCount ?? 0) > 0) ? { artifactId: id } : {}) };
      if (gen.status === "paused-login") return { status: "paused", message: `ChatGPT 로그인이 필요해요 · ${gen.message}`, ...partial };
      if (gen.status.startsWith("paused") || gen.status === "interrupted") return { status: "paused", message: gen.message, ...partial };
      if (gen.status === "failed") return { status: "failed", message: gen.message || "문제 만들기가 실패했어요." };
      if (gen.status === "done") {
        const questions = gen.sections.reduce((sum, section) => sum + (section.author?.questionCount ?? 0), 0);
        return questions ? { ...shown, status: "ready", message: "", artifactId: id } : { status: "failed", message: gen.message || "만들어진 문제가 없어요." };
      }
      // recaller: pages read from their image, sections whose basic questions are out, deep questions ready.
      if (gen.recaller) {
        const r = gen.recaller;
        const units = Object.values(r.units);
        const ready = units.filter((unit) => unit.status === "ready").length;
        const reading = r.read.pages.length && r.read.done.length + r.read.failed.length < r.read.pages.length ? `그림·수식 쪽 읽는 중 ${r.read.done.length}/${r.read.pages.length} · ` : "";
        const deep = Object.values(r.deep);
        const deepPart = ready === units.length && deep.length ? ` · 심화 ${deep.filter((d) => d.status === "ready").length}/${deep.length}` : "";
        return { ...partial, status: ready ? "authoring" : "running", message: `${reading}정리·기본 문제 ${ready}/${units.length}구역${deepPart}${calls}` };
      }
      if (gen.current?.step === "transcribe" && gen.images) return { ...shown, status: "running", message: `그림·수식 쪽 읽는 중 · ${gen.images.done.length}/${gen.images.pages.length}쪽${calls}` };
      if (gen.phase === "author") return { ...partial, status: "authoring", message: `문제 만드는 중 · 목차 ${done}/${gen.sections.length}${label ? ` · ${label}` : ""}${calls}` };
      const where = gen.phase === "outline" ? "목차 나누는 중" : `자료 파악·학습 설계 중${gen.sections.length ? ` · 목차 ${gen.sections.length}개` : ""}`;
      return { ...shown, status: gen.status === "queued" ? "waiting" : "running", message: `${where}${label ? ` · ${label}` : ""}${calls}` };
    };
    // 보관함: materials put away (experiment duplicates) are not loaded at all; they stay on disk and can be restored.
    const archivedIds = async () => session.mode !== "local-experiment" ? new Set<string>()
      : new Set((await readJson<{ entries: Array<{ id: string }> }>(await fetchExperiment("/api/study-archive"), "보관함을 읽지 못했어요.").catch(() => ({ entries: [] }))).entries.map((entry) => entry.id));
    const loadGenDecks = async (archived: Set<string>) => {
      const { runs } = await readJson<{ runs: Array<{ id: string; status: string; sectionsDone: number; pastExam?: boolean; createdAt?: string }> }>(await fetchExperiment("/api/lab/gen?origin=study"), "새 엔진 자료 목록을 불러오지 못했어요.");
      // Finished runs, and runs still being made whose first sections are authored.
      return Promise.all(runs.filter((run) => !archived.has(run.id) && (run.status === "done" || (run.status !== "failed" && run.sectionsDone > 0))).map(async (run) => readJson<{ meta: StudyArtifactMeta; document: AuthoringDocument; outline?: StudyOutlineSection[]; knowledge?: string; points?: KnowledgeLayer }>(
        await fetchExperiment(`/api/lab/gen/${run.id}/study`), "새 엔진 자료를 불러오지 못했어요.").then((deck) => ({ ...deck, pastExam: run.pastExam === true, madeAt: run.createdAt })).catch(() => null)));
    };
    const loadQuality = async () => readJson<{ patches: PatchMap; counts: Record<string, number> }>(await fetchExperiment("/api/study-quality"), "고친 문제 목록을 읽지 못했어요.");
    const loadPatches = async () => (await loadQuality()).patches;
    const qualityPost = async (body: Record<string, unknown>) => readJson<{ patch?: unknown; removed?: boolean }>(await fetchExperiment("/api/study-quality", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), "품질 기록을 저장하지 못했어요.");
    // The screen's decks carry their record (events, sched, hidden, reported) on the deck object itself.
    const recordOf = (deck: PlannerDeck): PlanRecord => ({ events: deck.events ?? [], sched: deck.sched ?? {}, hidden: deck.hidden, reported: deck.reported });
    const recordsOf = (decks: PlannerDeck[]) => Object.fromEntries(decks.map((deck) => [deck.id, recordOf(deck)]));
    return mountDejipgi(root, {
      uid: session.uid,
      defaultPurpose,
      // One queued request per material (docs/DECISIONS.md 2026-09-29 앱 전체 흐름). The assigned AI runs it
      // through MCP and records the authored document; the screen only queues and polls.
      // Materials go through the v2 engine (docs/DECISIONS.md 2026-10-12): outline → design per section → one
      // confirmation of objectives → authoring. Decks made by the old request flow still load and can be remade.
      builder: {
        // 기출 PDF: register only (no questions are made from an exam).
        async registerPastExam(file: File) {
          if (session.mode !== "local-experiment") throw new Error("기출 등록은 로컬 실험 모드에서만 할 수 있어요.");
          const form = new FormData();
          form.append("pdf", file);
          const { source: registered } = await readJson<{ source: { id: string } }>(await fetchExperiment("/api/mcp-runs/sources", { method: "POST", body: form }), "기출 PDF를 등록하지 못했어요.");
          const source = await findSource(registered.id);
          return { id: source.id, fileName: source.fileName };
        },
        async pastExamSources() {
          const { sources } = await readJson<{ sources: McpSourceCatalogEntry[] }>(await fetchExperiment("/api/mcp-runs/sources"), "등록한 PDF를 읽지 못했어요.");
          return sources.filter((source) => /^src_[a-f0-9]{64}$/.test(source.id));
        },
        async start({ file, from, to, purpose, note, readImages, pastExamSourceIds, engine, survey, deep, deepDrafts }) {
          if (session.mode !== "local-experiment") throw new Error("자료 등록과 문제 만들기는 로컬 실험 모드에서만 할 수 있어요.");
          const form = new FormData();
          form.append("pdf", file);
          const { source: registered } = await readJson<{ source: { id: string } }>(await fetchExperiment("/api/mcp-runs/sources", {
            method: "POST", body: form,
          }), "PDF를 등록하지 못했어요.");
          const source = await findSource(registered.id);
          const gen = await startGen(source, from, to, purpose, note, readImages, pastExamSourceIds, engine, survey, deep, deepDrafts);
          return { requestId: gen.id, sourceId: source.id };
        },
        async focus(requestId, page) {
          if (!isGen(requestId)) return;
          await readJson(await fetchExperiment(`/api/lab/gen/${requestId}/focus`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page }) }), "읽는 위치를 알리지 못했어요.");
        },
        async restart({ requestId, sourceId, from, to, purpose, note }) {
          if (!isGen(requestId)) {
            const previous = await readJson<{ request: ExperimentRequest }>(
              await fetchExperiment(`/api/mcp-experiment-requests/${encodeURIComponent(requestId)}`), "이전 요청을 확인하지 못했어요.");
            const request = await createQueuedRequest(await findSource(sourceId), `${from}-${to}`, purpose, { abilities: previous.request.input.abilities });
            await kickExecutor(request.id);
            return { requestId: request.id };
          }
          const previous = await genState(requestId).catch(() => null);
          const gen = await startGen(await findSource(sourceId), from, to, previous?.gen.input.purpose ?? purpose, previous?.gen.input.note ?? note ?? "", previous?.gen.input.readImages ?? true, previous?.gen.input.pastExamSourceIds, previous?.gen.input.engine, undefined, previous?.gen.input.deep, previous?.gen.input.deepDrafts);
          return { requestId: gen.id };
        },
        async remake({ artifactId, objectiveIds }) {
          if (isGen(artifactId)) {
            // Same objectives, authoring only, with the reported questions shown so the new ones differ.
            const { gen: base } = await genState(artifactId);
            const { gen } = await readJson<{ gen: GenState }>(await fetchExperiment(`/api/lab/gen/${artifactId}/fork`, {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: "author", objectiveIds, confirmed: true }),
            }), "다시 만들기를 시작하지 못했어요.");
            const pages = base.input.pageNumbers;
            return { requestId: gen.id, sourceId: base.input.sourceId, from: Math.min(...pages), to: Math.max(...pages), purpose: base.input.purpose };
          }
          const { artifacts } = await loadArtifacts();
          const meta = artifacts.find((item) => item.id === artifactId);
          const { requests } = await readJson<{ requests: ExperimentRequest[] }>(
            await fetchExperiment("/api/mcp-experiment-requests"), "요청 목록을 확인하지 못했어요.");
          const origin = meta && requests.find((request) => request.runId === meta.originRunId && request.status === "completed");
          if (!origin) throw new Error("이 자료는 원래 요청 기록이 없어 다시 만들 수 없어요.");
          const source = await findSource(origin.input.sourceId);
          const built = buildRemakeBody(source, origin, objectiveIds);
          if ("error" in built) throw new Error(built.error);
          const existing = findReusableRequest(requests, built.body);
          const request = existing ?? (await readJson<{ request: ExperimentRequest }>(await fetchExperiment("/api/mcp-experiment-requests", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(built.body),
          }), "다시 만들기 요청을 저장하지 못했어요.")).request;
          await kickExecutor(request.id);
          const pages = origin.input.scope.pageNumbers;
          return { requestId: request.id, sourceId: source.id, from: Math.min(...pages), to: Math.max(...pages), purpose: origin.input.purpose };
        },
        async resume(requestId) {
          if (!isGen(requestId)) { await kickExecutor(requestId); return; }
          await readJson(await fetchExperiment(`/api/lab/gen/${requestId}/continue`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }),
          }), "다시 시작하지 못했어요.");
        },
        async confirm(requestId, objectiveIds) {
          await readJson(await fetchExperiment(`/api/lab/gen/${requestId}/confirm`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objectiveIds, confirmed: true }),
          }), "목표를 확정하지 못했어요.");
        },
        async check(requestId) {
          if (isGen(requestId)) return genStatus(requestId);
          const { request } = await readJson<{ request: ExperimentRequest }>(
            await fetchExperiment(`/api/mcp-experiment-requests/${encodeURIComponent(requestId)}`), "생성 요청 상태를 읽지 못했어요.");
          if (request.status === "failed") return { status: "failed", message: request.failure || "담당 AI의 실행이 실패했어요." };
          const auto = await executorInfo(requestId).catch(() => null);
          const run = auto?.enabled ? auto.executor : null;
          if (run?.status === "paused-usage-limit") return { status: "paused", message: run.message };
          if (run?.status === "interrupted" || run?.status === "paused-invalid") return { status: "paused", message: run.message };
          if (run?.status === "paused-login") return { status: "paused", message: `ChatGPT 로그인이 필요해요 · ${run.message}` };
          if (run?.status === "failed") return { status: "failed", message: run.message || "자동 생성이 실패했어요." };
          if (request.status === "waiting-for-executor") {
            if (!auto?.enabled) return { status: "waiting", message: "AI 실행 대기 중 · 담당 AI 대화에서 ‘대기 중인 요청 처리해’라고 해 주세요" };
            if (!run) await kickExecutor(requestId).catch(() => undefined);
            return { status: "waiting", message: auto.model.ready ? "자동 생성 대기 중" : `자동 생성 대기 중 · ${auto.model.message}` };
          }
          const label: Record<string, string> = { analyze: "자료 구조", "concept-tree": "개념 구조", "learning-design": "학습 설계", "activity-design": "활동 설계", cards: "카드" };
          const retry = run?.attempt && run.attempt > 1 ? ` · 고쳐서 다시 시도 ${run.attempt - 1}번째` : "";
          if (request.status !== "completed") {
            const where = run?.stage && label[run.stage] ? `${label[run.stage]} ` : "";
            return { status: "running", message: `AI가 만드는 중 · ${where}${request.stages.length + 1}/6단계${retry}` };
          }
          if (run && run.status !== "done") return { status: "authoring", message: `문제 만들고 검사하는 중 · 6/6단계${retry}` };
          const { artifacts } = await loadArtifacts();
          const meta = artifacts.find((item) => item.originRunId === request.runId);
          return meta
            ? { status: "ready", message: "", artifactId: meta.id }
            : { status: "authoring", message: "문제 검사·기록 중 · 6/6단계 · 담당 AI가 출제 편집틀에 기록하면 붙어요" };
        },
      },
      // Question window answers and 모르는 것 노트 go through /api/study-notes (the signed-in ChatGPT account).
      ...(session.mode === "local-experiment" ? {
        async ask(turns: Array<{ role: string; content: string }>, options: { signal: AbortSignal; onText: (chunk: { text: string }) => void; pageImage?: { sourceId: string; page: number } }) {
          const response = await fetchExperiment("/api/study-notes", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "chat", turns, ...(options.pageImage ? { pageImage: options.pageImage } : {}) }), signal: options.signal,
          });
          const data = await response.json().catch(() => null) as { text?: string; message?: string; code?: string } | null;
          if (!response.ok) throw Object.assign(new Error(data?.message ?? "답을 받지 못했어요."), { code: data?.code === "usage_limit" ? "rate_limited" : data?.code });
          options.onText({ text: data?.text ?? "" });
        },
        notes: {
          async list(sourceId: string) {
            return (await readJson<{ notes: StudyNote[] }>(await fetchExperiment(`/api/study-notes?sourceId=${encodeURIComponent(sourceId)}`), "노트를 불러오지 못했어요.")).notes;
          },
          ask: (input) => noteCall<{ note: StudyNote; reused: boolean }>({ action: "ask", ...input }),
          mark: async (input) => (await noteCall<{ note: StudyNote }>({ action: "mark", ...input })).note,
          seen: async (sourceId, noteId) => (await noteCall<{ note: StudyNote }>({ action: "seen", sourceId, noteId })).note,
          follow: async (input) => (await noteCall<{ note: StudyNote }>({ action: "follow", ...input })).note,
          prompts: async () => readJson<{ ask: string; follow: string }>(await fetchExperiment("/api/study-notes?prompts=1"), "기본 지시를 읽지 못했어요."),
          talk: async (input) => (await noteCall<{ note: StudyNote }>({ action: "talk", ...input })).note,
          async explanations(sourceId: string) {
            return (await readJson<{ pages: Array<{ page: number; goal?: string; text: string; at: string }> }>(await fetchExperiment(`/api/study-notes?sourceId=${encodeURIComponent(sourceId)}&explain=1`), "쉬운 설명을 불러오지 못했어요.")).pages;
          },
          compose: async (input: { system: string; user: string; kind?: "terms" | "translate"; model?: string; effort?: string; json?: boolean; schema?: Record<string, unknown> }) => {
            const reply = await noteCall<{ text: string; data?: unknown }>({ action: "compose", ...input });
            return reply.data !== undefined ? JSON.stringify(reply.data) : reply.text;
          },
          saveExplanation: async (sourceId: string, page: number, text: string, goal?: string) => { await noteCall({ action: "explain-save", sourceId, page, text, ...(goal ? { goal } : {}) }); },
        } satisfies NonNullable<DejipgiEnv["notes"]>,
      } : {}),
      ...(session.mode === "local-experiment" ? {
        records: {
          async load() {
            return (await readJson<{ data: { records: Record<string, unknown>; pending: unknown[]; updatedAt: number } | null }>(
              await fetchExperiment("/api/study-records"), "풀이 기록을 불러오지 못했어요.")).data;
          },
          async save(value: { records: Record<string, unknown>; pending: unknown[]; updatedAt: number }) {
            await readJson(await fetchExperiment("/api/study-records", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
              "풀이 기록을 저장하지 못했어요.");
          },
        },
      } : {}),
      // 오늘 할 것 (src/lib/study/plan.ts): the same code /api/study-plan runs for agents.
      planner: {
        today({ decks, settings, notes, rules, now }) {
          return planToday({ decks: decks.map(planDeckFrom), records: recordsOf(decks), settings: planSettingsFrom(settings), notes: notes as Record<string, PlanNote[]>, rules: rules as StudyRules | undefined, now });
        },
        asked(deck, notes) {
          return [...askedObjectives(planDeckFrom(deck), recordOf(deck), notes as PlanNote[]).keys()];
        },
        memoryAuto({ subject, decks, settings, notes, now }) {
          return renderMemoryAuto({ subject, decks: decks.map(planDeckFrom), records: recordsOf(decks), settings: planSettingsFrom(settings), notes: notes as Record<string, PlanNote[]>, now });
        },
        diagnoseBox,
      },
      // 빠른 고리 (docs/품질_자동화.md): patches over the learner's own questions and the quality ledger, no model calls.
      quality: {
        similar: (hidden, candidates, threshold) => similarObjectives(hidden, candidates, threshold),
        tooEasy: (events, itemId, streak) => tooEasy(events, itemId, streak),
        termChoice: (deck, itemId, seed) => termChoice(deck, itemId, seed),
        ...(session.mode === "local-experiment" ? {
          list: loadQuality,
          async patch(deckId: string, patch: { kind: "accept"; itemId: string; answer: string } | { kind: "card"; itemId: string }, entry?: LedgerEntry) { await qualityPost({ action: "patch", deckId, patch, entry }); },
          async unpatch(deckId: string, patchId: string, entry?: LedgerEntry) { await qualityPost({ action: "unpatch", deckId, patchId, entry }); },
          async log(entries: LedgerEntry[]) { await qualityPost({ action: "log", entries }); },
        } : {}),
      },
      coach: (input) => coachCards(input as CoachInput),
      // 태블릿 모드: only on the computer itself (the tablet reaches the app through the paired gate on port 3001).
      ...(session.mode === "local-experiment" && /^(127\.0\.0\.1|localhost)$/.test(window.location.hostname) ? { tablet: {
        info: async () => readJson<{ urls: string[]; devices: Array<{ name: string; at: string }> }>(await fetchExperiment("/api/tablet"), "태블릿 연결 정보를 읽지 못했어요."),
        code: async () => readJson<{ code: string; expires: number; urls: string[] }>(await fetchExperiment("/api/tablet", { method: "POST" }), "연결 코드를 만들지 못했어요."),
        revoke: async () => { await readJson(await fetchExperiment("/api/tablet", { method: "DELETE" }), "연결을 끊지 못했어요."); },
      } } : {}),
      // 읽기 화면의 네모를 의미 단위로 (src/lib/study/chunk.ts): the material's terms, then phrase rules.
      chunk: { lexicon: (deck, asked) => buildLexicon(deck, asked), at: (words, index, lexicon) => chunkAt(words, index, lexicon ?? undefined),
        important: (deck) => importantTerms(deck), find: (words, terms) => findTerms(words, terms) },
      async rules() {
        return (await readJson<{ today: { rules: unknown; warnings: string[] } }>(await fetchExperiment("/api/study-rules"), "학습규칙을 읽지 못했어요.")).today;
      },
      ...(session.mode === "local-experiment" ? {
        memory: {
          async save(subject: string, auto: string) {
            await readJson(await fetchExperiment("/api/study-memory", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, auto }) }),
              "학습 메모를 저장하지 못했어요.");
          },
        },
      } : {}),
      account: {
        async status() {
          const info = await executorInfo();
          return { show: info.enabled && info.provider === "chatgpt", ready: info.model.ready, message: info.model.message };
        },
        async connect() {
          const { url } = await readJson<{ url: string }>(await fetchExperiment("/api/auth/chatgpt/start", { method: "POST" }), "ChatGPT 연결을 시작하지 못했어요.");
          window.location.assign(url);
        },
        async disconnect() {
          await readJson(await fetchExperiment("/api/auth/chatgpt/logout", { method: "POST" }), "ChatGPT 연결을 해제하지 못했어요.");
        },
      },
      async loadDecks(): Promise<StudyDeck[]> {
        // New-engine materials first (newest first), then documents from the old request flow.
        // Fixes made while studying (빠른 고리) are laid over each material; patchSig makes the screen reload a patched deck.
        const patches = session.mode === "local-experiment" ? await loadPatches().catch(() => ({} as PatchMap)) : {};
        const archived = await archivedIds();
        const [fresh, { artifacts: allArtifacts }] = await Promise.all([
          loadGenDecks(archived).catch(() => []),
          readJson<{ artifacts: StudyArtifactMeta[] }>(await fetchExperiment("/api/personalization-lab"), "Recaller 출제 문서 목록을 불러오지 못했어요."),
        ]);
        const artifacts = allArtifacts.filter((meta) => !archived.has(meta.id));
        const sources: Array<{ meta: StudyArtifactMeta; document?: AuthoringDocument; outline?: StudyOutlineSection[]; knowledge?: string; points?: KnowledgeLayer; pastExam?: boolean; madeAt?: string }> = [
          ...fresh.flatMap((deck) => deck ? [deck] : []), ...artifacts.map((meta) => ({ meta }))];
        const loaded = await Promise.allSettled(sources.map(async ({ meta, document: given, outline, knowledge, points, pastExam, madeAt }, order) => {
          const document = given ?? (await readJson<{ document: AuthoringDocument }>(
            await fetchExperiment(`/api/personalization-lab?id=${encodeURIComponent(meta.id)}`), `${meta.title}을 불러오지 못했어요.`)).document;
          // Questions that fail the item-quality checks stay out of practice; the rest of the document is still usable.
          const excluded = new Map(studyQualityIssues(document, pastExam).filter((issue) => issue.severity === "error")
            .map((issue) => [issue.questionId, `검사 제외: ${issue.message}`] as const));
          const own = patches[meta.id];
          const deck = { ...applyPatches(toStudyDeck(meta, document, order, excluded), own, showMath), patchSig: (own ?? []).map((patch) => patch.id).join(","),
            ...(pastExam ? { pastExam: true } : {}), ...(knowledge ? { knowledge } : {}), ...(points ? { points } : {}), ...(madeAt && Date.parse(madeAt) ? { madeAt: Date.parse(madeAt) } : {}) };
          // What to recall shows on the one-page summary; bare LaTeX there renders like answers do.
          return outline ? { ...deck, outline: outline.map((section) => ({ ...section,
            objectives: section.objectives.map((objective) => ({ ...objective, recall: showMath(objective.recall) })) })) } : deck;
        }));
        const decks = loaded.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
        // 지식창: each material's knowledge points come in once as 만남, under 자료 이름 / 구역 (src/lib/knowledge/store.ts importPoints).
        if (session.mode === "local-experiment") {
          const points = decks.flatMap((deck) => {
            const layer = (deck as { points?: KnowledgeLayer }).points;
            const material = String(deck.sourceName || deck.title).replace(/\.pdf$/i, "");
            return (layer?.points ?? []).map((point) => ({ ref: `${deck.id}:${point.id}`, title: point.title.slice(0, 120), essentials: point.essentials.slice(0, 6).map((e) => e.slice(0, 600)),
              folder: `${material.slice(0, 60)}${point.section ? `/${point.section.slice(0, 60)}` : ""}`, material: material.slice(0, 200), ...(point.pages[0] ? { page: point.pages[0] } : {}) }));
          });
          if (points.length) void fetchExperiment("/api/knowledge/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points: points.slice(0, 2000) }) }).catch(() => undefined);
        }
        if (!decks.length && loaded.some((result) => result.status === "rejected")) {
          throw new Error("Recaller 출제 문서를 불러오지 못했어요. 로컬 서버와 로그인 상태를 확인해 주세요.");
        }
        return decks;
      },
      archive: {
        async list() { return (await readJson<{ entries: Array<{ id: string; title: string; at: string; reason: string }> }>(await fetchExperiment("/api/study-archive"), "보관함을 읽지 못했어요.")).entries; },
        async put(items: Array<{ id: string; title: string; reason: string }>) {
          await readJson(await fetchExperiment("/api/study-archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "archive", items }) }), "보관함에 넣지 못했어요.");
        },
        async restore(ids: string[]) {
          await readJson(await fetchExperiment("/api/study-archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", ids }) }), "보관함에서 꺼내지 못했어요.");
        },
      },
      async loadPdf(sourceCatalogId: string) {
        const response = await fetchExperiment(`/api/mcp-runs/sources/${encodeURIComponent(sourceCatalogId)}/pdf`);
        if (!response.ok) throw new Error("원본 PDF를 열지 못했어요.");
        return response.arrayBuffer();
      },
      async loadPdfjs() {
        // The legacy build carries polyfills (e.g. Map.getOrInsertComputed) that the default v6 build expects natively.
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
        return pdfjs;
      },
      assetUrl: (artifactId: string, assetPath: string) =>
        `/api/personalization-lab/run-asset?id=${encodeURIComponent(artifactId)}&path=${encodeURIComponent(assetPath)}`,
      async loadKatex() {
        return (await import("katex")).default;
      },
      // 지식창 · 코드 · 일정: React screens mounted into hosts the vanilla app keeps across re-renders, like the flow canvas.
      mountView(name: "knowledge" | "code" | "plan", host: HTMLElement, props: Record<string, unknown>) {
        let root: import("react-dom/client").Root | null = null, gone = false;
        const load = name === "knowledge" ? import("./workspace/KnowledgeWindow") : name === "code" ? import("./workspace/CodeStudy") : import("./workspace/PlanView");
        void Promise.all([import("react-dom/client"), load]).then(([{ createRoot }, mod]) => {
          if (gone) return;
          root = createRoot(host);
          const View = mod.default as unknown as (p: Record<string, unknown>) => ReactElement;
          root.render(<View {...props} />);
        });
        return () => { gone = true; root?.unmount(); };
      },
      // A practice result on a PDF question goes to the knowledge its objective covers (맞힘 / 틀림 / 정답 보고).
      onPractice(deck: { id: string; title?: string; sourceName?: string; points?: KnowledgeLayer }, item: { objectiveId?: string; id: string }, outcome: string) {
        if (session.mode !== "local-experiment" || !deck.points || !item.objectiveId) return;
        const ids = deck.points.byObjective[item.objectiveId] ?? [];
        if (!ids.length) return;
        const kind = outcome === "correct" ? "correct" : outcome === "wrong" ? "wrong" : outcome === "assisted" ? "hint" : null;
        if (!kind) return;
        const detail = outcome === "assisted" ? "정답 보고 풂" : outcome === "wrong" ? "PDF 문제를 틀림" : "PDF 문제를 맞힘";
        void fetchExperiment("/api/knowledge/ref-event", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refs: ids.slice(0, 20).map((pid) => `${deck.id}:${pid}`), kind, detail, material: String(deck.sourceName || deck.title || "").slice(0, 200) }) })
          .then(() => window.dispatchEvent(new Event("recaller:knowledge-changed-sidebar"))).catch(() => undefined);
      },
      // 작업대 흐름: a React Flow canvas mounted into a host element the vanilla app keeps across re-renders.
      mountFlow(host, api) {
        let root: import("react-dom/client").Root | null = null, gone = false;
        void Promise.all([import("react-dom/client"), import("./FlowBench")]).then(([{ createRoot }, { default: FlowBench }]) => {
          if (gone) return;
          root = createRoot(host);
          root.render(<FlowBench api={api} />);
        });
        return () => { gone = true; root?.unmount(); };
      },
    });
  }, [fetchExperiment, session.mode, session.uid]);

  return (
    <div className={`dejipgi${side ? " with-side" : ""}`} ref={rootRef} data-view="home">
      {/* Plain link (no precedence) so a blocked font request never suspends or errors the page. */}
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600&display=swap" />
      <div className="wrap">
        <div className="masthead">
          <header className="top">
            <div className="brand">
              <h1>Recaller</h1>
            </div>
            {session.mode === "local-experiment" ? <div className="row ws-tools" style={{ marginLeft: "auto", gap: 6 }}>
              <TimerChip />
              <button className={`tablet-btn sb-toggle${side ? " on" : ""}`} style={{ margin: 0 }} aria-pressed={side} onClick={() => toggleSide(!side)} title="오른쪽 지식 사이드바">지식 사이드바</button>
            </div> : null}
            <span className="store" id="store" data-mode="memory"><i></i><span id="storeText">저장 준비 중</span></span>
          </header>
          <nav className="tabs" role="tablist" id="tabs">
            <button role="tab" data-view="home" aria-selected="true">홈</button>
            <button role="tab" data-view="knowledge" aria-selected="false">지식</button>
            <button role="tab" data-view="read" aria-selected="false">읽기</button>
            <button role="tab" data-view="practice" aria-selected="false">연습</button>
            <button role="tab" data-view="code" aria-selected="false">코드</button>
            <button role="tab" data-view="plan" aria-selected="false">일정</button>
            <button role="tab" data-view="create" aria-selected="false">자료</button>
            <button role="tab" data-view="records" aria-selected="false">기록</button>
            <button role="tab" data-view="bench" aria-selected="false">작업대</button>
          </nav>
        </div>
        <main id="app"></main>
      </div>
      {session.mode === "local-experiment" ? <KnowledgeSidebar open={side} onClose={() => toggleSide(false)} /> : null}
      {session.mode === "local-experiment" ? <AgentScreen /> : null}
    </div>
  );
}
