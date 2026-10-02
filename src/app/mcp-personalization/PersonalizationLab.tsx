"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuthSession } from "@/components/AuthGate";
import { authenticatedFetch } from "@/lib/firebase-client";
import type { ArtifactMeta } from "@/lib/personalization-lab/artifacts";
import type { ObjectiveCycle, ObjectiveCycleSummary } from "@/lib/personalization-lab/cycles";
import { deriveObjectiveChecklist, type ObjectiveChecklistStatus } from "@/lib/personalization-lab/objective-checklist";
import { correctEvent, isAssisted, outcome, recommend, scopeKey, type ArtifactScope, type ExperimentEvent } from "@/lib/personalization-lab/rule";
import { clearExperimentEvents, loadExperimentEvents, loadExperimentProgress, loadExperimentProgressFor, saveExperimentEvents, saveExperimentProgress, type ExperimentProgress } from "@/lib/personalization-lab/storage";
import type { AuthoringDocument } from "../../../tools/problem-authoring-lab/contract.ts";

type LoadedArtifact = { meta: ArtifactMeta; document: AuthoringDocument; html: string };
type RendererEvent = {
  type: "study-forge:problem-event" | "study-forge:question-view";
  version: 1;
  channel: string;
  runId: string;
  documentHash: string;
  questionId: string;
  responseId?: string;
  action?: "select" | "input" | "submit" | "reveal";
  occurredAt: string;
  correct?: boolean | null;
};

function SourcePagePreview({ bytes, pageNumber }: { bytes: ArrayBuffer; pageNumber: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [message, setMessage] = useState("PDF 페이지를 그리는 중입니다.");

  useEffect(() => {
    let active = true;
    let loadingTask: { destroy: () => Promise<void> } | null = null;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
        loadingTask = task;
        const document = await task.promise;
        if (!active) return;
        const page = await document.getPage(pageNumber);
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) throw new Error("PDF 화면을 준비하지 못했습니다.");
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(1.5, Math.max(0.5, (window.innerWidth - 75) / base.width)) });
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        renderTask = page.render({ canvas, canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
        await renderTask.promise;
        if (active) setMessage("");
      } catch (cause) {
        if (active) setMessage(cause instanceof Error ? cause.message : "PDF 페이지를 표시하지 못했습니다.");
      }
    })();
    return () => { active = false; renderTask?.cancel(); void loadingTask?.destroy(); };
  }, [bytes, pageNumber]);

  return <div className="min-h-0 flex-1 overflow-auto rounded-b-lg bg-[#777] p-3 text-center">
    {message ? <p className="mb-3 text-sm text-white">{message}</p> : null}
    <canvas ref={canvasRef} className="mx-auto bg-white shadow-lg" aria-label={`원본 PDF ${pageNumber}쪽 화면`} />
  </div>;
}

function scopeFor(meta: ArtifactMeta, question: AuthoringDocument["questions"][number]): ArtifactScope {
  return {
    authoringRunId: meta.authoringRunId,
    stage: "authoring-lab",
    artifactVersion: meta.artifactVersion,
    artifactSha256: meta.artifactSha256,
    originRunId: meta.originRunId,
    questionId: question.id,
    learningUnitId: question.source.learningUnitId,
    sourceId: question.source.sourceId,
    sourceRange: question.source.sourceRange,
  };
}

function ratingLabel(rating: "remembered" | "unsure" | "forgot") {
  return { remembered: "바로 떠올림", unsure: "헷갈림", forgot: "못 떠올림" }[rating];
}

function pageLabel(values: number[]) {
  const pages = [...values].sort((a, b) => a - b);
  if (!pages.length) return "범위 미기록";
  const contiguous = pages.length > 1 && pages.every((page, index) => index === 0 || page === pages[index - 1] + 1);
  return contiguous ? `${pages[0]}–${pages.at(-1)}쪽` : `${pages.join(", ")}쪽`;
}

function cycleLabel(item: ObjectiveCycleSummary) {
  const date = item.updatedAt ? new Date(item.updatedAt).toLocaleDateString("ko-KR") : "날짜 미기록";
  return `${item.sourceFileName} · ${pageLabel(item.selectedPages)} · ${date} · ${item.objectiveCount}개 목표`;
}

function eventLabel(event: ExperimentEvent, events: ExperimentEvent[]) {
  if (event.kind === "started") return "입력 시작";
  if (event.kind === "reveal") return "정답 공개";
  if (event.kind === "rating") return `자기평가: ${ratingLabel(event.correction?.rating ?? event.rating)}${isAssisted(event, events) ? " · 정답 공개 후 사용자 보고" : " · 공개 전 인출"}`;
  return `답 제출: ${outcome(event) === "success" ? "정답" : outcome(event) === "difficulty" ? "오답" : "직접 확인"}${isAssisted(event, events) ? " · 정답 공개 후" : " · 공개 전"}`;
}

const checklistLabels: Record<ObjectiveChecklistStatus, string> = {
  "no-question": "연결 문항 없음",
  unattempted: "문항 미풀이",
  "needs-review": "복습 필요",
  "self-check": "자기확인만 기록",
  "partial-evidence": "부분 근거",
  "recent-independent-success": "최근 독립 성공 · 숙달 미확정",
};

export default function PersonalizationLab() {
  const session = useAuthSession();
  const fetchExperiment = useCallback((url: string) => session.mode === "local-experiment"
    ? fetch(url, { cache: "no-store" })
    : authenticatedFetch(url, { cache: "no-store" }), [session.mode]);
  const [artifacts, setArtifacts] = useState<ArtifactMeta[]>([]);
  const [artifactListReady, setArtifactListReady] = useState(false);
  const [cycles, setCycles] = useState<ObjectiveCycleSummary[]>([]);
  const [cycleListReady, setCycleListReady] = useState(false);
  const [selectedCycleId, setSelectedCycleId] = useState("");
  const [cycle, setCycle] = useState<ObjectiveCycle | null>(null);
  const [cycleError, setCycleError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [legacyMode, setLegacyMode] = useState(false);
  const [view, setView] = useState<"home" | "study" | "goals" | "records">("home");
  const [hydrated, setHydrated] = useState(false);
  const [progress, setProgress] = useState<ExperimentProgress | null>(null);
  const [loaded, setLoaded] = useState<LoadedArtifact | null>(null);
  const [events, setEvents] = useState<ExperimentEvent[]>([]);
  const [error, setError] = useState("");
  const [channel, setChannel] = useState("");
  const [frameReady, setFrameReady] = useState(false);
  const [activeQuestionId, setActiveQuestionId] = useState("");
  const [sourcePreview, setSourcePreview] = useState<{ bytes: ArrayBuffer; page: number } | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const started = useRef(new Set<string>());
  const attemptSession = useRef("");
  const ignoredInitialView = useRef(false);
  const pendingQuestion = useRef<{ artifactId: string; questionId: string } | null>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setEvents(loadExperimentEvents(session.uid));
      const saved = loadExperimentProgress(session.uid);
      setProgress(saved);
      setHydrated(true);
    });
    return () => { active = false; };
  }, [session.uid]);

  useEffect(() => {
    if (!hydrated) return;
    let active = true;
    void fetchExperiment("/api/personalization-lab")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? "실험 문서 목록을 불러오지 못했습니다.");
        if (active) { setArtifacts(data.artifacts); setArtifactListReady(true); }
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "목록을 불러오지 못했습니다."); });
    return () => { active = false; };
  }, [fetchExperiment, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    let active = true;
    void fetchExperiment("/api/personalization-lab/cycles")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? "학습설계 목록을 불러오지 못했습니다.");
        if (!active) return;
        const items = data.cycles as ObjectiveCycleSummary[];
        setCycles(items);
        setCycleListReady(true);
      })
      .catch((cause) => { if (active) setCycleError(cause instanceof Error ? cause.message : "학습설계 목록을 불러오지 못했습니다."); });
    return () => { active = false; };
  }, [fetchExperiment, hydrated, session.uid]);

  useEffect(() => {
    if (!artifactListReady || !cycleListReady || selectedCycleId) return;
    let active = true;
    const savedProgress = loadExperimentProgress(session.uid);
    const hasAttempt = !!savedProgress && (!!savedProgress.lastQuestionId || events.some((event) =>
      event.scope.artifactSha256 === savedProgress.artifactSha256 && !event.excluded));
    const savedArtifact = hasAttempt ? artifacts.find((item) => item.id === savedProgress?.artifactId && item.artifactSha256 === savedProgress.artifactSha256) : undefined;
    const savedCycle = savedArtifact && cycles.find((item) => item.id === `mcp:${savedArtifact.originRunId}`);
    const priorCycleId = localStorage.getItem(`recaller:mcp-personalization:cycle:v1:${session.uid}`);
    const selected = cycles.find((item) => item.id === priorCycleId) ?? savedCycle ?? cycles.find((item) => item.sourceVerified) ?? cycles[0];
    const matching = selected ? artifacts.filter((item) => item.originRunId === selected.id.slice(4)) : [];
    const nextId = selected && savedArtifact?.originRunId === selected.id.slice(4)
      ? savedArtifact.id : matching[0]?.id ?? (!selected ? artifacts[0]?.id : "") ?? "";
    if (!selected && !nextId) return;
    queueMicrotask(() => {
      if (!active) return;
      if (selected) setSelectedCycleId(selected.id);
      setSelectedId(nextId);
      setLegacyMode(Boolean(nextId && (!selected || artifacts.find((item) => item.id === nextId)?.originRunId !== selected.id.slice(4))));
    });
    return () => { active = false; };
  }, [artifactListReady, cycleListReady, selectedCycleId, artifacts, cycles, events, session.uid]);

  useEffect(() => {
    if (!selectedCycleId) return;
    let active = true;
    void fetchExperiment(`/api/personalization-lab/cycles?id=${encodeURIComponent(selectedCycleId)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? "학습설계를 불러오지 못했습니다.");
        if (active) { setCycle(data.cycle as ObjectiveCycle); setCycleError(""); }
      })
      .catch((cause) => { if (active) setCycleError(cause instanceof Error ? cause.message : "학습설계를 불러오지 못했습니다."); });
    return () => { active = false; };
  }, [selectedCycleId, fetchExperiment]);

  useEffect(() => {
    if (!hydrated || !selectedId) return;
    let active = true;
    void fetchExperiment(`/api/personalization-lab?id=${encodeURIComponent(selectedId)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? "실험 문서를 불러오지 못했습니다.");
        if (active) {
          const artifact = data as LoadedArtifact;
          const saved = loadExperimentProgressFor(session.uid, artifact.meta.id, artifact.meta.artifactSha256);
          const priorEvents = loadExperimentEvents(session.uid).filter((event) => event.scope.artifactSha256 === artifact.meta.artifactSha256 && event.scope.authoringRunId === artifact.meta.authoringRunId && event.scope.artifactVersion === artifact.meta.artifactVersion);
          const recentEvent = [...priorEvents].reverse().find((event) => !saved || event.sessionId === saved.sessionId);
          const candidateQuestionId = saved?.lastQuestionId ?? recentEvent?.scope.questionId ?? null;
          const next: ExperimentProgress = {
            artifactId: artifact.meta.id,
            artifactSha256: artifact.meta.artifactSha256,
            sessionId: saved?.sessionId ?? recentEvent?.sessionId ?? crypto.randomUUID(),
            lastQuestionId: candidateQuestionId && artifact.document.questions.some((question) => question.id === candidateQuestionId) ? candidateQuestionId : null,
          };
          attemptSession.current = next.sessionId;
          ignoredInitialView.current = false;
          setProgress(next);
          if (saved || priorEvents.length) saveExperimentProgress(session.uid, next);
          setFrameReady(false);
          setActiveQuestionId(artifact.document.questions[0]?.id ?? "");
          setLoaded(artifact);
          setChannel(crypto.randomUUID());
        }
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "실험 문서를 불러오지 못했습니다."); });
    return () => { active = false; };
  }, [selectedId, fetchExperiment, hydrated, session.uid]);

  const append = useCallback((event: ExperimentEvent) => {
    if (loaded) {
      const nextProgress: ExperimentProgress = { artifactId: loaded.meta.id, artifactSha256: loaded.meta.artifactSha256, sessionId: attemptSession.current, lastQuestionId: event.scope.questionId };
      try { saveExperimentProgress(session.uid, nextProgress); setProgress(nextProgress); }
      catch { setError("진행 위치를 저장하지 못했습니다."); }
    }
    setEvents((prior) => {
      const next = [...prior, event];
      try { saveExperimentEvents(session.uid, next); setError(""); }
      catch { setError("브라우저에 실험 기록을 저장하지 못했습니다."); return prior; }
      return next;
    });
  }, [session.uid, loaded]);

  useEffect(() => {
    if (!loaded || !channel) return;
    const questionById = new Map(loaded.document.questions.map((question) => [question.id, question]));
    const receive = (message: MessageEvent) => {
      if (message.source !== frame.current?.contentWindow || message.origin !== "null") return;
      const data = message.data as Partial<RendererEvent>;
      if (!data || !["study-forge:problem-event", "study-forge:question-view"].includes(data.type ?? "") || data.version !== 1 || data.channel !== channel || data.runId !== loaded.meta.authoringRunId || data.documentHash !== loaded.meta.artifactSha256) return;
      if (!data.questionId || !data.occurredAt || !Number.isFinite(Date.parse(data.occurredAt))) return;
      const question = questionById.get(data.questionId);
      if (!question) return;
      if (data.type === "study-forge:question-view") {
        setActiveQuestionId(question.id);
        if (!ignoredInitialView.current) { ignoredInitialView.current = true; return; }
        const next: ExperimentProgress = { artifactId: loaded.meta.id, artifactSha256: loaded.meta.artifactSha256, sessionId: attemptSession.current, lastQuestionId: question.id };
        setProgress(next);
        try { saveExperimentProgress(session.uid, next); } catch { setError("진행 위치를 저장하지 못했습니다."); }
        return;
      }
      if (!data.action || !["select", "input", "submit", "reveal"].includes(data.action)) return;
      if (data.responseId && !question.responses.some((response) => response.id === data.responseId)) return;
      const scope = scopeFor(loaded.meta, question);
      if (data.action === "select" || data.action === "input") {
        const key = scopeKey(scope);
        if (started.current.has(key)) return;
        started.current.add(key);
        append({ id: crypto.randomUUID(), sessionId: attemptSession.current, scope, kind: "started", occurredAt: data.occurredAt });
        return;
      }
      if (data.action === "reveal") {
        append({ id: crypto.randomUUID(), sessionId: attemptSession.current, scope, kind: "reveal", occurredAt: data.occurredAt });
        return;
      }
      if (!data.responseId || (data.correct !== null && typeof data.correct !== "boolean")) return;
      append({ id: crypto.randomUUID(), sessionId: attemptSession.current, scope, kind: "submit", responseId: data.responseId, correct: data.correct, occurredAt: data.occurredAt });
      started.current.delete(scopeKey(scope));
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [loaded, channel, append, session.uid]);

  const scopes = useMemo(() => loaded?.document.questions.map((question) => scopeFor(loaded.meta, question)) ?? [], [loaded]);
  const currentEvents = useMemo(() => events.filter((event) => loaded && event.scope.authoringRunId === loaded.meta.authoringRunId && event.scope.artifactVersion === loaded.meta.artifactVersion && event.scope.artifactSha256 === loaded.meta.artifactSha256), [events, loaded]);
  const currentSessionEvents = useMemo(() => currentEvents.filter((event) => event.sessionId === progress?.sessionId), [currentEvents, progress]);
  const resume = useMemo(() => {
    if (!loaded || progress?.artifactId !== loaded.meta.id || progress.artifactSha256 !== loaded.meta.artifactSha256) return null;
    const questions = loaded.document.questions;
    const completed = new Set(currentSessionEvents.filter((event) => (event.kind === "submit" || event.kind === "rating") && !event.excluded).map((event) => event.scope.questionId));
    const lastIndex = questions.findIndex((question) => question.id === progress.lastQuestionId);
    const pending = questions.find((question, index) => index >= Math.max(0, lastIndex) && !completed.has(question.id)) ?? questions.find((question) => !completed.has(question.id));
    return { lastIndex, next: pending, complete: !pending, completedCount: completed.size };
  }, [loaded, progress, currentSessionEvents]);
  const otherCount = events.length - currentEvents.length;
  const hasCurrentAttempt = currentSessionEvents.length > 0 || Boolean(progress?.lastQuestionId);
  const review = useMemo(() => recommend(scopes, events, new Date().toISOString()), [scopes, events]);
  const reviewCandidates = review.filter((item) => item.status === "review");
  const sourceGroups = useMemo(() => {
    const groups = new Map<string, ArtifactMeta[]>();
    for (const item of artifacts) groups.set(item.sourceFile, [...(groups.get(item.sourceFile) ?? []), item]);
    return [...groups.values()].map((items) => items.sort((a, b) => b.questionCount - a.questionCount));
  }, [artifacts]);
  const checklist = useMemo(() => cycle ? deriveObjectiveChecklist({
    sourceSha256: cycle.sourceSha256, runId: cycle.id.slice(4), learningDesignSha256: cycle.learningDesignSha256,
    objectives: cycle.objectives, knowledgeUnits: cycle.knowledgeUnits, questionLinks: cycle.questionLinks,
    events, now: new Date().toISOString(),
  }) : [], [cycle, events]);
  const revealedQuestionKeys = useMemo(() => new Set(currentSessionEvents
    .filter((event) => event.kind === "reveal")
    .map((event) => scopeKey(event.scope))), [currentSessionEvents]);
  const isRevealed = (scope: ArtifactScope) => revealedQuestionKeys.has(scopeKey(scope));
  const activeQuestion = loaded?.document.questions.find((question) => question.id === activeQuestionId);
  const activeScope = loaded && activeQuestion ? scopeFor(loaded.meta, activeQuestion) : null;
  const activeAnswered = activeScope ? currentSessionEvents.some((event) =>
    !event.excluded && (event.kind === "submit" || event.kind === "reveal") && scopeKey(event.scope) === scopeKey(activeScope)) : false;
  const activeRating = activeScope ? [...currentSessionEvents].reverse().find((event) =>
    !event.excluded && event.kind === "rating" && scopeKey(event.scope) === scopeKey(activeScope)) : null;

  function recordRating(scope: ArtifactScope, rating: "remembered" | "unsure" | "forgot") {
    append({ id: crypto.randomUUID(), sessionId: attemptSession.current, scope, kind: "rating", rating, occurredAt: new Date().toISOString() });
  }

  function updateEvent(id: string, change: (event: ExperimentEvent) => ExperimentEvent) {
    setEvents((prior) => {
      const next = prior.map((event) => event.id === id ? change(event) : event);
      try { saveExperimentEvents(session.uid, next); setError(""); }
      catch { setError("정정한 기록을 저장하지 못했습니다."); return prior; }
      return next;
    });
  }

  function reset() {
    if (!confirm("이 브라우저의 개인화 실험 기록을 모두 지울까요? 되돌릴 수 없습니다.")) return;
    clearExperimentEvents(session.uid); setEvents([]);
    if (loaded) {
      const next: ExperimentProgress = { artifactId: loaded.meta.id, artifactSha256: loaded.meta.artifactSha256, sessionId: crypto.randomUUID(), lastQuestionId: null };
      attemptSession.current = next.sessionId;
      setProgress(next);
      saveExperimentProgress(session.uid, next);
      setChannel(crypto.randomUUID());
    }
  }

  function selectArtifact(id: string) {
    const selected = artifacts.find((item) => item.id === id);
    const relatedCycle = selected && cycles.find((item) => item.id === `mcp:${selected.originRunId}`);
    if (relatedCycle && relatedCycle.id !== selectedCycleId) {
      setSelectedCycleId(relatedCycle.id);
      setCycle(null);
      localStorage.setItem(`recaller:mcp-personalization:cycle:v1:${session.uid}`, relatedCycle.id);
    }
    setLegacyMode(!relatedCycle);
    setSelectedId(id); setLoaded(null); setError("");
    started.current.clear();
    ignoredInitialView.current = false;
  }

  function selectCycle(id: string) {
    setSelectedCycleId(id);
    setCycle(null);
    setCycleError("");
    setLegacyMode(false);
    const matching = artifacts.filter((item) => item.originRunId === id.slice(4));
    const nextId = matching.some((item) => item.id === selectedId) ? selectedId : matching[0]?.id ?? "";
    if (nextId) selectArtifact(nextId);
    else { setSelectedId(""); setLoaded(null); setProgress(null); setFrameReady(false); }
    localStorage.setItem(`recaller:mcp-personalization:cycle:v1:${session.uid}`, id);
  }

  function retry() {
    attemptSession.current = crypto.randomUUID();
    started.current.clear();
    ignoredInitialView.current = false;
    if (loaded) {
      const next: ExperimentProgress = { artifactId: loaded.meta.id, artifactSha256: loaded.meta.artifactSha256, sessionId: attemptSession.current, lastQuestionId: null };
      setProgress(next);
      saveExperimentProgress(session.uid, next);
    }
    setFrameReady(false);
    setChannel(crypto.randomUUID());
  }

  function continueAt(questionId: string) {
    if (!loaded || !channel || !frameReady || !frame.current?.contentWindow) return;
    setActiveQuestionId(questionId);
    const next: ExperimentProgress = { artifactId: loaded.meta.id, artifactSha256: loaded.meta.artifactSha256, sessionId: attemptSession.current, lastQuestionId: questionId };
    setProgress(next);
    saveExperimentProgress(session.uid, next);
    frame.current.contentWindow.postMessage({ type: "study-forge:navigate-question", version: 1, channel, runId: loaded.meta.authoringRunId, documentHash: loaded.meta.artifactSha256, questionId, parentOrigin: window.location.origin }, "*");
  }

  function startStudy(questionId?: string) {
    if (!loaded) return;
    if (view === "study" && frameReady) { if (questionId) continueAt(questionId); return; }
    if (questionId) pendingQuestion.current = { artifactId: loaded.meta.id, questionId };
    setFrameReady(false);
    setView("study");
  }

  function startReview(questionId: string) {
    if (!loaded) return;
    retry();
    pendingQuestion.current = { artifactId: loaded.meta.id, questionId };
    setView("study");
  }

  function openLinkedQuestion(artifactId: string, questionId: string) {
    if (loaded?.meta.id === artifactId) { startStudy(questionId); return; }
    pendingQuestion.current = { artifactId, questionId };
    setView("study");
    setFrameReady(false);
    if (selectedId !== artifactId) selectArtifact(artifactId);
  }

  useEffect(() => {
    const pending = pendingQuestion.current;
    if (!pending || !loaded || loaded.meta.id !== pending.artifactId || !channel || !frameReady || !frame.current?.contentWindow) return;
    if (!loaded.document.questions.some((question) => question.id === pending.questionId)) return;
    pendingQuestion.current = null;
    const next: ExperimentProgress = {
      artifactId: loaded.meta.id, artifactSha256: loaded.meta.artifactSha256,
      sessionId: attemptSession.current, lastQuestionId: pending.questionId,
    };
    setProgress(next);
    saveExperimentProgress(session.uid, next);
    frame.current.contentWindow.postMessage({
      type: "study-forge:navigate-question", version: 1, channel,
      runId: loaded.meta.authoringRunId, documentHash: loaded.meta.artifactSha256,
      questionId: pending.questionId, parentOrigin: window.location.origin,
    }, "*");
  }, [loaded, channel, frameReady, session.uid]);

  async function openSource(page: number, sourceId = loaded?.meta.sourceCatalogId) {
    if (!sourceId) return;
    try {
      const response = await fetchExperiment(`/api/mcp-runs/sources/${encodeURIComponent(sourceId)}/pdf`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message ?? "원본 PDF를 열지 못했습니다.");
      }
      setSourcePreview({ bytes: await response.arrayBuffer(), page });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "원본 PDF를 열지 못했습니다.");
    }
  }

  function closeSource() {
    setSourcePreview(null);
  }

  const frameName = loaded && channel ? JSON.stringify({
    type: "study-forge:personalization-channel", channel,
    parentOrigin: typeof window === "undefined" ? "" : window.location.origin,
    runId: loaded.meta.authoringRunId, documentHash: loaded.meta.artifactSha256,
  }) : "";

  return (
    <main className="min-h-screen bg-[#f3f4f1] px-4 pb-16 text-[#202924] md:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="flex items-center justify-between gap-4 border-b border-[#dce1dc] py-5">
          <button type="button" onClick={() => setView("home")} className="text-xl font-black tracking-tight">Recaller<span className="ml-2 text-xs font-medium text-[#718077]">읽은 것을 내 것으로</span></button>
          <div className="flex items-center gap-2 text-sm">
            {view !== "home" ? <button type="button" onClick={() => setView("home")} className="rounded-lg px-3 py-2 font-semibold text-[#456356]">자료 선택</button> : null}
            {loaded ? <button type="button" onClick={() => setView("records")} className="rounded-lg border border-[#d5dfd7] bg-white px-3 py-2 font-semibold">다시 공부하기{reviewCandidates.length ? ` · ${reviewCandidates.length}` : ""}</button> : null}
          </div>
        </header>
        {view === "home" ? <>
          <div className="py-8 md:py-11">
            <p className="text-xs font-bold tracking-[.14em] text-[#638271]">내 학습자료</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">무엇을 공부할까요?</h1>
            <p className="mt-2 text-sm text-[#69786e]">자료를 고르고 바로 풀어보세요. 풀이 위치와 기록은 이 브라우저에 저장됩니다.</p>
          </div>
          <section className="grid gap-3 md:grid-cols-2" aria-label="학습자료 선택">
            {sourceGroups.map((items) => {
              const primary = items[0];
              const selected = items.some((item) => item.id === selectedId);
              return <button key={primary.sourceFile} type="button" onClick={() => selectArtifact(primary.id)} aria-pressed={selected} className={`min-h-36 rounded-2xl border p-5 text-left transition-colors ${selected ? "border-[#2a6e51] bg-[#e8f2e9]" : "border-[#dce3dc] bg-white hover:border-[#89ae94]"}`}>
                <span className="text-xs font-bold text-[#578269]">{primary.sourcePages.length ? pageLabel(primary.sourcePages) : "학습자료"}</span>
                <strong className="mt-3 block break-words text-lg leading-snug">{primary.sourceFile}</strong>
                <span className="mt-2 block text-sm text-[#607469]">{primary.questionCount}문항 · {selected ? "선택됨" : "공부하기"}</span>
              </button>;
            })}
          </section>
          {!artifactListReady || !cycleListReady ? <p className="mt-5 text-sm text-[#69786e]">자료를 불러오는 중입니다.</p> : !sourceGroups.length ? <div className="rounded-xl border bg-white p-5 text-sm">아직 공부할 문제가 없습니다. <Link href="/mcp-runs" className="font-bold text-[#236b4c] underline">자료 생성 화면 열기</Link></div> : null}
          {loaded ? <section className="mt-6 rounded-2xl border border-[#dce3dc] bg-white p-5 md:p-7" aria-label="선택한 자료">
            <p className="text-xs font-bold text-[#638271]">선택한 문제</p>
            <h2 className="mt-2 text-xl font-black">{loaded.meta.title}</h2>
            <p className="mt-2 text-sm text-[#65746b]">이번 풀이 {resume?.completedCount ?? 0}/{loaded.document.questions.length}문항 · {resume?.complete ? "완료" : hasCurrentAttempt ? "이어서 공부할 수 있어요" : "아직 시작 전"}{currentEvents.some((event) => event.kind === "submit" || event.kind === "rating") ? " · 이전 풀이 기록 있음" : ""}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" onClick={() => { if (resume?.complete) { retry(); setView("study"); } else startStudy(hasCurrentAttempt ? resume?.next?.id : undefined); }} className="rounded-xl bg-[#176b4b] px-6 py-3 font-bold text-white">{resume?.complete ? "처음부터 다시 풀기" : hasCurrentAttempt ? "이어서 풀기" : "문제 풀기"}</button>
              {currentEvents.length ? <button type="button" onClick={() => setView("records")} className="rounded-xl border border-[#c9d9cd] px-5 py-3 font-bold text-[#205f44]">복습하기</button> : null}
            </div>
            {sourceGroups.find((group) => group.some((item) => item.id === selectedId))?.length && sourceGroups.find((group) => group.some((item) => item.id === selectedId))!.length > 1 ? <details className="mt-6 border-t border-[#e6ebe5] pt-4 text-sm"><summary className="cursor-pointer font-semibold text-[#51675a]">이 자료의 다른 문제 묶음</summary><div className="mt-3 flex flex-wrap gap-2">{sourceGroups.find((group) => group.some((item) => item.id === selectedId))!.map((item) => <button key={item.id} type="button" onClick={() => selectArtifact(item.id)} className={`rounded-lg border px-3 py-2 text-left ${item.id === selectedId ? "border-[#176b4b] bg-[#e8f2e9]" : "border-[#d8e2d9]"}`}>{item.title} · {item.questionCount}문항</button>)}</div></details> : null}
            <details className="mt-4 text-xs text-[#60746a]"><summary className="cursor-pointer">자료 정보</summary><p className="mt-2">{loaded.meta.sourceFile} · {pageLabel(loaded.meta.sourcePages)}</p>{cycle ? <button type="button" onClick={() => setView("goals")} className="mt-2 font-bold text-[#176b4b] underline">학습 목표 보기</button> : null}<p className="mt-2 break-all">출제 기록 {loaded.meta.authoringRunId} · {loaded.meta.artifactVersion} · {loaded.meta.artifactSha256}</p></details>
          </section> : selectedId ? <p className="mt-5 text-sm text-[#69786e]">문제를 불러오는 중입니다.</p> : null}
          {cycleError ? <p role="alert" className="mt-5 text-sm text-red-700">{cycleError}</p> : null}
        </> : null}
        {view === "goals" ? legacyMode ? <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm">
          <p className="font-bold">이전 실험 문서를 별도로 보고 있습니다.</p>
          <button type="button" onClick={() => selectCycle(selectedCycleId)} className="mt-2 rounded-md border border-amber-400 px-3 py-1 font-semibold">자료별 학습목표로 돌아가기</button>
        </section> : <section className="mt-5 rounded-xl border border-[#d6e5dc] bg-white p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-black">자료별 학습목표</h2>
            <label className="text-sm font-semibold" htmlFor="cycle-select">학습설계 실행</label>
            <select id="cycle-select" className="max-w-full rounded-lg border border-[#abcbb9] bg-white px-3 py-2 text-sm" value={selectedCycleId} onChange={(event) => selectCycle(event.target.value)}>
              {cycles.length ? cycles.map((item) => <option key={item.id} value={item.id}>{cycleLabel(item)}</option>) : <option value="">기록된 학습설계 없음</option>}
            </select>
          </div>
          {cycleError ? <p role="alert" className="mt-3 text-sm text-red-700">{cycleError}</p> : null}
          {cycle ? <>
            <p className="mt-3 text-xs leading-5 text-[#60796f]">원본 {cycle.sourceFileName} · 전체 {cycle.sourcePageCount}쪽 · 이번 실행의 선택 범위 {pageLabel(cycle.selectedPages)} · {cycle.verificationNote}</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {checklist.map((row, index) => {
                const pages = [...new Set(row.knowledgeUnits.map((unit) => unit.sourcePage))].sort((a, b) => a - b);
                const linkedQuestions = cycle.questionLinks.filter((link) => link.objectiveId === row.objective.id && link.verification === "verified");
                const canShowCriteria = linkedQuestions.length > 0 && linkedQuestions.every((link) => isRevealed(link.scope));
                return <article key={row.objective.id} className="rounded-lg border border-[#dce9e0] p-3 text-sm">
                  <p className="font-bold">{index + 1}. {row.objective.target}</p>
                  <p className="mt-1 text-xs font-semibold text-[#087363]">{row.status === "no-question" && row.unverifiedQuestionIds.length ? "문항 연결 미확인" : checklistLabels[row.status]} · 검증된 연결 문항 {row.questionLinks.length}개</p>
                  {row.evidence.assistedAssessmentCount > 0 && row.evidence.independentCorrectCount === 0 ? <p className="mt-1 text-xs text-amber-800">정답 공개 후 확인한 기록은 독립 정답으로 계산하지 않았습니다.</p> : null}
                  <p className="mt-1 text-xs text-[#60796f]">원문 {pages.length ? `${pages.join(", ")}쪽` : "쪽 미연결"} · 목차 {row.objective.outlineNodeIds.map((id) => cycle.outlineTitles[id] || id).join(" / ")}</p>
                  {canShowCriteria ? <ul className="mt-2 list-inside list-disc text-xs leading-5 text-[#49665c]">{row.objective.successCriteria.map((criterion) => <li key={criterion.id}>{criterion.description}</li>)}</ul>
                    : <p className="mt-2 text-xs text-[#60796f]">성공 기준은 연결 문제의 정답 공개 후 표시됩니다.</p>}
                  {row.partialEvidence ? <p className="mt-2 text-xs text-amber-800">부분 근거: 학습내용 {row.coveredLearningUnitIds.length}/{row.knowledgeUnits.length} · 성공 기준 {row.coveredCriterionIds.length}/{row.objective.successCriteria.length}</p> : null}
                  {row.unverifiedQuestionIds.length ? <p className="mt-2 text-xs text-amber-800">출처 계보를 확인하지 못한 문항 {row.unverifiedQuestionIds.length}개는 상태 계산에서 제외했습니다.</p> : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {pages.map((page) => <button key={page} type="button" onClick={() => void openSource(page, cycle.sourceId)} className="rounded-md border border-[#bdd6c5] px-2 py-1 text-xs font-bold text-[#087363]">원본 {page}쪽</button>)}
                    {row.questionLinks.map((questionLink) => questionLink.artifactId ? <button key={`${questionLink.artifactId}:${questionLink.scope.questionId}`} type="button" onClick={() => openLinkedQuestion(questionLink.artifactId!, questionLink.scope.questionId)} className="rounded-md bg-[#e6f5ec] px-2 py-1 text-xs font-bold text-[#126e57]">연결 문제 열기</button> : null)}
                  </div>
                </article>;
              })}
            </div>
            <details className="mt-4 rounded-lg border border-[#dce9e0] p-3 text-xs">
              <summary className="cursor-pointer font-bold">원문 전체 목차 범위 확인 · {cycle.outlineLeaves.length}개 하위 항목</summary>
              <div className="mt-3 max-h-80 space-y-2 overflow-auto">
                {cycle.outlineLeaves.map((leaf) => <p key={leaf.id} className="border-t border-[#e7eee9] pt-2">
                  <span className="font-semibold">{leaf.title}</span> · {leaf.pages.length ? `${leaf.pages.join(", ")}쪽` : "쪽 미기록"} · {leaf.selected ? "이번 실행 선택" : "이번 실행 미선택"} · {leaf.objectiveIds.length ? `학습목표 ${leaf.objectiveIds.length}개 연결` : leaf.excludedReason ? `제외: ${leaf.excludedReason}` : "목표 미연결"}
                </p>)}
              </div>
              <p className="mt-2 text-[#60796f]">여러 목차에 걸친 목표는 각 항목의 완료로 환산하지 않습니다.</p>
            </details>
          </> : <p className="mt-3 text-sm text-[#627d70]">학습설계 실행을 불러오는 중입니다.</p>}
        </section> : null}
        {error ? <p role="alert" className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
        {view === "study" && loaded && (legacyMode || loaded.meta.originRunId === selectedCycleId.slice(4)) ? <section className="fixed inset-0 z-40 flex min-h-0 flex-col bg-[#f5f7f6]" aria-label="문제 풀이">
          <div className="flex flex-wrap items-center gap-2 border-b border-[#d6e5dc] bg-white px-3 py-2 text-sm md:px-6">
            <button type="button" onClick={() => { setFrameReady(false); setView("home"); }} className="rounded-lg border border-[#9ac5aa] px-3 py-1.5 text-xs font-bold text-[#087363]">자료 선택으로</button>
            <strong className="min-w-0 flex-1 truncate">{loaded.meta.title}</strong>
            <span className="text-xs text-[#526d63]">{resume?.completedCount ?? 0}/{loaded.document.questions.length}문항 제출</span>
            {resume?.next ? <button type="button" disabled={!frameReady} onClick={() => continueAt(resume.next!.id)} className="rounded-md bg-[#087363] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">다음 미완료</button> : null}
          </div>
          {activeScope && activeAnswered ? <div className="flex flex-wrap items-center gap-2 border-b border-[#d6e5dc] bg-[#eef7f0] px-3 py-2 text-xs md:px-6" aria-label="현재 문항 자기평가">
            <span className="font-bold">현재 문항 자기평가</span>
            <button type="button" onClick={() => recordRating(activeScope, "remembered")} className="rounded-md border border-[#b7d9c5] bg-white px-2 py-1 font-bold text-[#126e57]">바로 떠올림</button>
            <button type="button" onClick={() => recordRating(activeScope, "unsure")} className="rounded-md border border-amber-200 bg-white px-2 py-1 font-bold text-amber-800">헷갈림</button>
            <button type="button" onClick={() => recordRating(activeScope, "forgot")} className="rounded-md border border-red-200 bg-white px-2 py-1 font-bold text-red-800">못 떠올림</button>
            {activeRating?.kind === "rating" ? <span role="status" className="font-semibold text-[#34594b]">기록됨: {ratingLabel(activeRating.rating)}</span> : null}
          </div> : null}
          <iframe key={channel} ref={frame} onLoad={() => setFrameReady(true)} title={`${loaded.meta.title} 풀이`} name={frameName} srcDoc={loaded.html} sandbox="allow-scripts" className="min-h-0 w-full flex-1 border-0 bg-white" />
        </section> : view === "study" ? <p className="mt-5 text-sm text-[#627d70]">{selectedId ? "문제 묶음을 불러오는 중입니다." : "문제 준비 전입니다. 자료 선택에서 문제 묶음을 고르세요."}</p> : null}
        {view === "records" && loaded ? <section className="mt-8 space-y-5">
            <div className="rounded-xl border border-[#d6e5dc] bg-white p-5">
              <p className="text-xs font-bold tracking-[.14em] text-[#638271]">{loaded.meta.sourceFile}</p>
              <h1 className="mt-2 text-2xl font-black">다시 공부하기</h1>
              <p className="mt-2 text-sm text-[#60746a]">틀렸거나 시간이 지난 문제부터 다시 풀어보세요. 정답을 보고 푼 기록은 독립 정답으로 세지 않습니다.</p>
              <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => startReview(reviewCandidates[0]?.scope.questionId ?? loaded.document.questions[0]?.id)} className="rounded-lg bg-[#176b4b] px-4 py-2 font-bold text-white">{reviewCandidates.length ? `복습 시작 · ${reviewCandidates.length}문항` : "전체 문제 다시 보기"}</button><button type="button" onClick={() => setView("home")} className="rounded-lg border border-[#c9d9cd] px-4 py-2 font-semibold">다른 자료 선택</button></div>
              {reviewCandidates.length ? <div className="mt-6 space-y-3" aria-live="polite">
                {reviewCandidates.map((item, index) => {
                  const question = loaded.document.questions.find((entry) => entry.id === item.scope.questionId);
                  return <div key={scopeKey(item.scope)} className="flex items-start justify-between gap-3 border-t border-[#e3ece5] pt-3 text-sm">
                    <div><p className="font-bold">{index + 1}. {question?.source.target}</p><p className="mt-1 text-xs text-[#527268]">{item.reason}</p></div>
                    {question ? <button type="button" onClick={() => startReview(question.id)} className="shrink-0 rounded-md border border-[#c9d9cd] px-3 py-2 text-xs font-bold text-[#176b4b]">풀기</button> : null}
                  </div>;
                })}
              </div> : <p className="mt-5 text-sm text-[#526d63]">지금 우선 복습할 문제는 없습니다. 전체 문제는 언제든 다시 열 수 있습니다.</p>}
            </div>
            <details className="rounded-xl border border-[#d6e5dc] bg-white p-5">
              <summary className="cursor-pointer text-base font-bold">모든 문제와 풀이 기록</summary>
              <div className="mt-3 max-h-[420px] space-y-3 overflow-auto">
                {loaded.document.questions.map((question, index) => {
                  const scope = scopes[index];
                  const history = currentEvents.filter((event) => !event.excluded && scopeKey(event.scope) === scopeKey(scope));
                  const submits = history.filter((event) => event.kind === "submit").length;
                  const ratings = history.filter((event) => event.kind === "rating").length;
                  return <article key={scopeKey(scope)} className="rounded-lg border border-[#e0ebe3] p-3 text-sm">
                    <p className="font-bold">{index + 1}. {question.source.target}</p>
                    <p className="mt-1 text-xs text-[#60796f]">원문 {question.source.sourcePage}쪽</p>
                    <p className="mt-2 text-xs">{submits || ratings ? `직접 제출 ${submits}건 · 자기평가 ${ratings}건` : "미학습/기록 부족 · 아직 확인하지 않음"}</p>
                    {isRevealed(scope) ? <details className="mt-2 text-xs text-[#526d63]"><summary className="cursor-pointer font-semibold">원문 근거 보기</summary><p className="mt-1 whitespace-pre-line">{question.source.sourceRange} · {question.source.sourceText}</p></details> : null}
                    <div className="mt-2 flex flex-wrap gap-1.5">{(question.source.sourcePages?.length ? question.source.sourcePages : [question.source.sourcePage]).map((page) => <button key={page} type="button" onClick={() => void openSource(page)} className="rounded-md border border-[#bdd6c5] px-2 py-1 text-xs font-bold text-[#087363]">원본 PDF {page}쪽 열기</button>)}</div>
                    <button type="button" onClick={() => startReview(question.id)} className="mt-3 rounded-md bg-[#e6f5ec] px-3 py-2 text-xs font-bold text-[#126e57]">다시 풀기</button>
                  </article>;
                })}
              </div>
            </details>
        </section> : null}
        {view === "records" ? <details className="mt-5 rounded-xl border border-[#d6e5dc] bg-white p-5">
          <summary className="cursor-pointer text-lg font-black">상세 풀이 기록 · 현재 문서 {currentEvents.length}건</summary>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-[#687d73]">현재 문서 {currentEvents.length}건 · 다른 문서 {otherCount}건</p><button type="button" onClick={reset} className="rounded-md border border-red-200 px-3 py-2 text-xs font-bold text-red-700">기록 초기화</button></div>
          <div className="mt-4 max-h-[500px] space-y-2 overflow-auto">
            {!currentEvents.length ? <p className="text-sm text-[#768b80]">아직 이 문서의 기록이 없습니다.</p> : [...currentEvents].reverse().map((event) => {
              const questionIndex = loaded?.document.questions.findIndex((question) => question.id === event.scope.questionId) ?? -1;
              const question = questionIndex >= 0 ? loaded?.document.questions[questionIndex] : null;
              return <div key={event.id} className={`rounded-lg border p-3 text-xs ${event.excluded ? "border-gray-200 bg-gray-50 text-gray-400" : "border-[#e0ebe3]"}`}>
              <p className="font-bold">{questionIndex >= 0 ? `${questionIndex + 1}번` : "문항"} · {question ? `원문 ${question.source.sourcePage}쪽` : "원문 위치 미확인"} · {eventLabel(event, events)}</p>
              <p className="mt-1 text-[#71857b]">{new Date(event.occurredAt).toLocaleString("ko-KR")}{event.kind === "submit" || event.kind === "rating" ? event.correction ? " · 정정됨" : "" : ""}</p>
              <details className="mt-2 text-[#71857b]"><summary className="cursor-pointer">기록 출처 상세</summary><div className="mt-1 space-y-1 break-all"><p>문항 ID: {event.scope.questionId} · 학습내용 ID: {event.scope.learningUnitId}</p><p>출제 실행: {event.scope.authoringRunId} · 버전: {event.scope.artifactVersion}</p><p>문서 SHA-256: {event.scope.artifactSha256}</p></div></details>
              <div className="mt-2 flex flex-wrap gap-2">
                {event.kind === "submit" ? <select aria-label="제출 판정 정정" value={event.correction ? String(event.correction.correct) : String(event.correct)} onChange={(choice) => updateEvent(event.id, (current) => correctEvent(current, choice.target.value === "null" ? null : choice.target.value === "true", new Date().toISOString()))} className="rounded border px-2 py-1"><option value="true">정답으로 정정</option><option value="false">오답으로 정정</option><option value="null">판정 보류</option></select> : null}
                {event.kind === "rating" ? <select aria-label="자기평가 정정" value={event.correction?.rating ?? event.rating} onChange={(choice) => updateEvent(event.id, (current) => correctEvent(current, choice.target.value as "remembered" | "unsure" | "forgot", new Date().toISOString()))} className="rounded border px-2 py-1"><option value="remembered">바로 떠올림</option><option value="unsure">헷갈림</option><option value="forgot">못 떠올림</option></select> : null}
              {event.kind !== "reveal" ? <button type="button" onClick={() => updateEvent(event.id, (current) => ({ ...current, excluded: !current.excluded }))} className="rounded border px-2 py-1">{event.excluded ? "제외 취소" : "추천에서 제외"}</button> : null}
              </div>
            </div>;})}
          </div>
        </details> : null}
        {sourcePreview ? <div className="fixed inset-0 z-50 flex flex-col bg-black/70 p-3 md:p-7" role="dialog" aria-modal="true" aria-label={`원본 PDF ${sourcePreview.page}쪽`}>
          <div className="flex items-center justify-between rounded-t-lg bg-white px-4 py-2"><strong className="text-sm">원본 PDF · {sourcePreview.page}쪽</strong><button type="button" onClick={closeSource} className="rounded border px-3 py-1 text-sm">닫기</button></div>
          <SourcePagePreview bytes={sourcePreview.bytes} pageNumber={sourcePreview.page} />
        </div> : null}
      </div>
    </main>
  );
}
