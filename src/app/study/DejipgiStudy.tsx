"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAuthSession } from "@/components/AuthGate";
import { authenticatedFetch } from "@/lib/firebase-client";
import { toStudyDeck, type StudyArtifactMeta, type StudyDeck } from "@/lib/study/from-authoring";
import { buildRequestBody, defaultPurpose, findReusableRequest, objectivesFromCompletedRequest } from "@/lib/study/request-form";
import type { McpSourceCatalogEntry } from "@/lib/mcp-source-catalog";
import type { ExperimentRequest } from "@/lib/mcp-experiment-requests";
import type { AuthoringDocument } from "../../../tools/problem-authoring-lab/contract.ts";
import { mountDejipgi } from "./dejipgi-app.js";
import "katex/dist/katex.min.css";
import "./dejipgi.css";

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error((data as { message?: string } | null)?.message ?? fallback);
  return data as T;
}

async function waitForRequest(
  id: string,
  signal: AbortSignal,
  onStatus: (message: string) => void,
  fetchRequest: (url: string) => Promise<Response>,
): Promise<ExperimentRequest> {
  while (true) {
    if (signal.aborted) throw new DOMException("기다리기를 멈췄어요. 요청은 대기 목록에 남아 있습니다.", "AbortError");
    const { request } = await readJson<{ request: ExperimentRequest }>(
      await fetchRequest(`/api/mcp-experiment-requests/${encodeURIComponent(id)}`), "생성 요청 상태를 읽지 못했어요.");
    if (request.status === "failed") throw new Error(request.failure || "담당 AI의 실행이 실패했습니다.");
    if (request.status === "completed") return request;
    onStatus(request.status === "waiting-for-executor"
      ? "AI 실행 대기 중 · 담당 AI 대화에서 요청을 처리해 주세요"
      : `AI 실행 중 · ${request.stages.length}/${request.input.stopAfterStage === "learning-design" ? 3 : 5}단계 완료`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 2000);
      const abort = () => { clearTimeout(timer); reject(new DOMException("기다리기를 멈췄어요. 요청은 대기 목록에 남아 있습니다.", "AbortError")); };
      signal.addEventListener("abort", abort, { once: true });
    });
  }
}

export default function DejipgiStudy() {
  const session = useAuthSession();
  const rootRef = useRef<HTMLDivElement>(null);
  const fetchExperiment = useCallback((url: string, init: RequestInit = {}) => session.mode === "local-experiment"
    ? fetch(url, { cache: "no-store", ...init })
    : authenticatedFetch(url, { cache: "no-store", ...init }), [session.mode]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const sources = new Map<string, McpSourceCatalogEntry>();
    let designRun: { sourceId: string; pageText: string; purpose: string; runId: string; hash: string; objectiveIds: string[] } | null = null;
    let authoredArtifactId: string | null = null;
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
    return mountDejipgi(root, {
      uid: session.uid,
      defaultPurpose,
      builder: {
        async design({ file, sourceName, from, to, goal, signal, onStatus }) {
          if (!file) throw new Error("현재 엔진 연결은 PDF만 지원합니다. 붙여 넣은 글은 아직 요청할 수 없어요.");
          if (session.mode !== "local-experiment") throw new Error("자료 등록과 MCP 요청은 로컬 실험 모드에서만 사용할 수 있어요.");
          onStatus("PDF를 등록하는 중…");
          const form = new FormData();
          form.append("pdf", file);
          const { source: registered } = await readJson<{ source: { id: string } }>(await fetchExperiment("/api/mcp-runs/sources", {
            method: "POST", body: form,
          }), "PDF를 등록하지 못했어요.");
          if (signal.aborted) throw new DOMException("기다리기를 멈췄어요. 등록된 PDF는 남아 있습니다.", "AbortError");
          const { sources: catalog } = await readJson<{ sources: McpSourceCatalogEntry[] }>(
            await fetchExperiment("/api/mcp-runs/sources"), "등록한 PDF를 확인하지 못했어요.");
          const source = catalog.find((item) => item.id === registered.id);
          if (!source) throw new Error("등록한 PDF를 자료 목록에서 찾지 못했어요.");
          const pageText = `${from}-${to}`;
          const purpose = goal.trim() || defaultPurpose;
          if (signal.aborted) throw new DOMException("기다리기를 멈췄어요. 등록된 PDF는 남아 있습니다.", "AbortError");
          onStatus("학습목표 설계 요청을 저장하는 중…");
          const queued = await createQueuedRequest(source, pageText, purpose, { stopAfterStage: "learning-design" });
          const complete = await waitForRequest(queued.id, signal, onStatus, (url) => fetchExperiment(url));
          const result = objectivesFromCompletedRequest(complete);
          if (!complete.runId) throw new Error("완료된 요청에 실행 ID가 없습니다.");
          designRun = { sourceId: source.id, pageText, purpose, runId: complete.runId,
            hash: result.hash, objectiveIds: result.objectives.map((item) => item.id) };
          authoredArtifactId = null;
          return { title: sourceName.replace(/\.pdf$/i, ""), objectives: result.objectives };
        },
        async author({ objectives, signal, onStatus }) {
          if (!designRun) throw new Error("학습목표 설계부터 진행해 주세요.");
          if (!objectives.length || objectives.some((item) => !designRun!.objectiveIds.includes(item.id)))
            throw new Error("선택한 학습목표를 확인하지 못했어요. 학습목표 설계부터 다시 진행해 주세요.");
          const source = (await readJson<{ sources: McpSourceCatalogEntry[] }>(
            await fetchExperiment("/api/mcp-runs/sources"), "원본 자료를 확인하지 못했어요.")).sources
            .find((item) => item.id === designRun!.sourceId);
          if (!source) throw new Error("등록한 원본 PDF를 찾지 못했어요.");
          if (signal.aborted) throw new DOMException("기다리기를 멈췄어요. 앞 단계 결과는 남아 있습니다.", "AbortError");
          onStatus("앞의 학습목표를 재사용해 문제 생성을 요청하는 중…");
          const queued = await createQueuedRequest(source, designRun.pageText, designRun.purpose, {
            stopAfterStage: "cards", reuse: { kind: "output", runId: designRun.runId, stage: "learning-design", sha256: designRun.hash },
            selectedObjectiveIds: objectives.map((item) => item.id),
          });
          const complete = await waitForRequest(queued.id, signal, onStatus, (url) => fetchExperiment(url));
          if (!complete.runId) throw new Error("완료된 문제 요청에 실행 ID가 없습니다.");
          onStatus("담당 AI의 문제 검사·기록을 기다리는 중…");
          while (true) {
            if (signal.aborted) throw new DOMException("기다리기를 멈췄어요. 요청과 생성 결과는 남아 있습니다.", "AbortError");
            const { artifacts } = await loadArtifacts();
            const meta = artifacts.find((item) => item.originRunId === complete.runId);
            if (meta) {
              const { document } = await readJson<{ document: AuthoringDocument }>(
                await fetchExperiment(`/api/personalization-lab?id=${encodeURIComponent(meta.id)}`), "기록된 문제를 읽지 못했어요.");
              const deck = toStudyDeck(meta, document);
              if (!deck.items.length) throw new Error("기록된 문서에 풀 수 있는 문제가 없습니다.");
              authoredArtifactId = meta.id;
              return { items: deck.items, report: { made: deck.items.length, repaired: 0, converted: 0,
                dropped: deck.skipped.length, dup: 0, warned: 0 },
                log: deck.skipped.map((item) => `${item.questionId}: ${item.reason}`) };
            }
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 2000);
              const abort = () => { clearTimeout(timer); reject(new DOMException("기다리기를 멈췄어요. 요청과 생성 결과는 남아 있습니다.", "AbortError")); };
              signal.addEventListener("abort", abort, { once: true });
            });
          }
        },
        async save() {
          if (!authoredArtifactId) throw new Error("검사·기록된 문제를 찾지 못했어요.");
          const { artifacts } = await loadArtifacts();
          if (!artifacts.some((item) => item.id === authoredArtifactId)) throw new Error("기록된 문제 문서를 다시 확인하지 못했어요.");
          return { deckId: authoredArtifactId };
        },
      },
      async loadDecks(): Promise<StudyDeck[]> {
        const { artifacts } = await readJson<{ artifacts: StudyArtifactMeta[] }>(
          await fetchExperiment("/api/personalization-lab"), "Recaller 출제 문서 목록을 불러오지 못했어요.");
        const loaded = await Promise.allSettled(artifacts.map(async (meta, order) => {
          const { document } = await readJson<{ document: AuthoringDocument }>(
            await fetchExperiment(`/api/personalization-lab?id=${encodeURIComponent(meta.id)}`), `${meta.title}을 불러오지 못했어요.`);
          return toStudyDeck(meta, document, order);
        }));
        const decks = loaded.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
        if (!decks.length && loaded.some((result) => result.status === "rejected")) {
          throw new Error("Recaller 출제 문서를 불러오지 못했어요. 로컬 서버와 로그인 상태를 확인해 주세요.");
        }
        return decks;
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
      async loadKatex() {
        return (await import("katex")).default;
      },
      async listSources() {
        const result = await readJson<{ sources: McpSourceCatalogEntry[] }>(
          await fetchExperiment("/api/mcp-runs/sources"), "자료 목록을 불러오지 못했어요.");
        sources.clear();
        result.sources.forEach((source) => sources.set(source.id, source));
        return result.sources.map(({ id, title, fileName, pageCount, available }) => ({ id, title, fileName, pageCount, available }));
      },
      async uploadPdf(file: File) {
        const form = new FormData();
        form.append("pdf", file);
        const { source } = await readJson<{ source: { id: string; fileName: string; pageCount: number } }>(
          await fetchExperiment("/api/mcp-runs/sources", { method: "POST", body: form }), "PDF를 등록하지 못했어요.");
        return source;
      },
      async listRequests() {
        const { requests } = await readJson<{ requests: unknown[] }>(
          await fetchExperiment("/api/mcp-experiment-requests"), "요청 목록을 불러오지 못했어요.");
        return requests;
      },
      async createRequest(sourceId: string, pageText: string, purpose: string) {
        const source = sources.get(sourceId);
        if (!source) return { error: "자료를 다시 골라 주세요." };
        const built = buildRequestBody(source, pageText, purpose);
        if ("error" in built) return { error: built.error };
        await readJson(await fetchExperiment("/api/mcp-experiment-requests", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(built.body),
        }), "요청을 저장하지 못했어요.");
        return {};
      },
    });
  }, [fetchExperiment, session.mode, session.uid]);

  return (
    <div className="dejipgi" ref={rootRef} data-view="practice">
      {/* Plain link (no precedence) so a blocked font request never suspends or errors the page. */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hahmlet:wght@600;700&family=Noto+Serif+KR:wght@400;600&family=IBM+Plex+Mono:wght@500&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap" />
      <div className="wrap">
        <div className="masthead">
          <header className="top">
            <div className="brand">
              <h1>되짚기</h1>
              <p>내 자료에서 뽑은 목표를, 보지 않고 떠올리는 연습</p>
            </div>
            <span className="store" id="store" data-mode="memory"><i></i><span id="storeText">저장 준비 중</span></span>
          </header>
          <nav className="tabs" role="tablist" id="tabs">
            <button role="tab" data-view="practice" aria-selected="true">연습</button>
            <button role="tab" data-view="read" aria-selected="false">읽기</button>
            <button role="tab" data-view="create" aria-selected="false">자료 만들기</button>
            <button role="tab" data-view="records" aria-selected="false">기록</button>
          </nav>
        </div>
        <main id="app"></main>
      </div>
    </div>
  );
}
