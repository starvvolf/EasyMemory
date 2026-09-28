"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAuthSession } from "@/components/AuthGate";
import { authenticatedFetch } from "@/lib/firebase-client";
import { toStudyDeck, type StudyArtifactMeta, type StudyDeck } from "@/lib/study/from-authoring";
import { buildRequestBody, defaultPurpose, findReusableRequest } from "@/lib/study/request-form";
import type { McpSourceCatalogEntry } from "@/lib/mcp-source-catalog";
import type { ExperimentRequest } from "@/lib/mcp-experiment-requests";
import type { AuthoringDocument } from "../../../tools/problem-authoring-lab/contract.ts";
import { inspectQuality } from "../../../tools/problem-authoring-lab/quality.ts";
import { mountDejipgi } from "./dejipgi-app.js";
import "katex/dist/katex.min.css";
import "./dejipgi.css";

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error((data as { message?: string } | null)?.message ?? fallback);
  return data as T;
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
    return mountDejipgi(root, {
      uid: session.uid,
      defaultPurpose,
      // One queued request per material (docs/DECISIONS.md 2026-09-29 앱 전체 흐름). The assigned AI runs it
      // through MCP and records the authored document; the screen only queues and polls.
      builder: {
        async start({ file, from, to, purpose }) {
          if (session.mode !== "local-experiment") throw new Error("자료 등록과 생성 요청은 로컬 실험 모드에서만 할 수 있어요.");
          const form = new FormData();
          form.append("pdf", file);
          const { source: registered } = await readJson<{ source: { id: string } }>(await fetchExperiment("/api/mcp-runs/sources", {
            method: "POST", body: form,
          }), "PDF를 등록하지 못했어요.");
          const source = await findSource(registered.id);
          const request = await createQueuedRequest(source, `${from}-${to}`, purpose, {});
          return { requestId: request.id, sourceId: source.id };
        },
        async restart({ sourceId, from, to, purpose }) {
          const request = await createQueuedRequest(await findSource(sourceId), `${from}-${to}`, purpose, {});
          return { requestId: request.id };
        },
        async check(requestId) {
          const { request } = await readJson<{ request: ExperimentRequest }>(
            await fetchExperiment(`/api/mcp-experiment-requests/${encodeURIComponent(requestId)}`), "생성 요청 상태를 읽지 못했어요.");
          if (request.status === "failed") return { status: "failed", message: request.failure || "담당 AI의 실행이 실패했어요." };
          if (request.status === "waiting-for-executor") return { status: "waiting", message: "AI 실행 대기 중 · 담당 AI 대화에서 ‘대기 중인 요청 처리해’라고 해 주세요" };
          if (request.status !== "completed") return { status: "running", message: `AI가 만드는 중 · ${request.stages.length}/6단계` };
          const { artifacts } = await loadArtifacts();
          const meta = artifacts.find((item) => item.originRunId === request.runId);
          return meta
            ? { status: "ready", message: "", artifactId: meta.id }
            : { status: "authoring", message: "문제 검사·기록 중 · 6/6단계 · 담당 AI가 출제 편집틀에 기록하면 붙어요" };
        },
      },
      async loadDecks(): Promise<StudyDeck[]> {
        const { artifacts } = await readJson<{ artifacts: StudyArtifactMeta[] }>(
          await fetchExperiment("/api/personalization-lab"), "Recaller 출제 문서 목록을 불러오지 못했어요.");
        const loaded = await Promise.allSettled(artifacts.map(async (meta, order) => {
          const { document } = await readJson<{ document: AuthoringDocument }>(
            await fetchExperiment(`/api/personalization-lab?id=${encodeURIComponent(meta.id)}`), `${meta.title}을 불러오지 못했어요.`);
          // Questions that fail the item-quality checks stay out of practice; the rest of the document is still usable.
          const excluded = new Map(inspectQuality(document).filter((issue) => issue.severity === "error")
            .map((issue) => [issue.questionId, `검사 제외: ${issue.message}`] as const));
          return toStudyDeck(meta, document, order, excluded);
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
