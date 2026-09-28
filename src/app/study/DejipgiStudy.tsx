"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAuthSession } from "@/components/AuthGate";
import { authenticatedFetch } from "@/lib/firebase-client";
import { toStudyDeck, type StudyArtifactMeta, type StudyDeck } from "@/lib/study/from-authoring";
import { buildRequestBody, defaultPurpose } from "@/lib/study/request-form";
import type { McpSourceCatalogEntry } from "@/lib/mcp-source-catalog";
import type { AuthoringDocument } from "../../../tools/problem-authoring-lab/contract.ts";
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
    const sources = new Map<string, McpSourceCatalogEntry>();
    return mountDejipgi(root, {
      uid: session.uid,
      defaultPurpose,
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
  }, [fetchExperiment, session.uid]);

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
            <button role="tab" data-view="library" aria-selected="false">자료</button>
            <button role="tab" data-view="records" aria-selected="false">기록</button>
          </nav>
        </div>
        <main id="app"></main>
      </div>
    </div>
  );
}
