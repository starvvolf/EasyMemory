"use client";
// 원문 보기 (2026-11-15 리팩토링): 자료 지도 · 기억 탭에서 "p.26"을 누르면 그 PDF 쪽을 겹창으로 보여 준다.
// 예전 앱(dejipgi-app.js SourcePeek)이 하던 일을 React로. 열기: openPeek(genId, page) → recaller:peek 이벤트.
import { useEffect, useRef, useState } from "react";
import { refreshMaterials, runOf } from "./materials";
import { firstTs } from "@/lib/youtube/notes";
import { isYoutubeSource, NotesHTML, useYoutube, videoAt } from "./youtube/YoutubeNotes";

type PdfPage = { getViewport(o: { scale: number }): { width: number; height: number }; render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> } };
type PdfDoc = { numPages: number; getPage(n: number): Promise<PdfPage> };
type Pdfjs = { getDocument(o: { data: Uint8Array; isEvalSupported: boolean }): { promise: Promise<PdfDoc> }; GlobalWorkerOptions: { workerSrc: string } };

const EVENT = "recaller:peek";
export function openPeek(genId: string, page: number) { window.dispatchEvent(new CustomEvent(EVENT, { detail: { genId, page } })); }

let pdfjsP: Promise<Pdfjs> | null = null;
export function loadPdfjs(): Promise<Pdfjs> {
  // The legacy build carries polyfills (e.g. Map.getOrInsertComputed) that the default v6 build expects natively.
  pdfjsP ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
    const lib = m as unknown as Pdfjs;
    lib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
    return lib;
  });
  return pdfjsP;
}
const docs = new Map<string, Promise<PdfDoc>>();
function docOf(sourceId: string): Promise<PdfDoc> {
  let p = docs.get(sourceId);
  if (!p) {
    p = (async () => {
      const res = await fetch(`/api/mcp-runs/sources/${encodeURIComponent(sourceId)}/pdf`, { cache: "no-store" });
      if (!res.ok) throw new Error("원본 PDF를 열지 못했어요.");
      const lib = await loadPdfjs();
      return lib.getDocument({ data: new Uint8Array(await res.arrayBuffer()), isEvalSupported: false }).promise;
    })();
    p.catch(() => docs.delete(sourceId));
    docs.set(sourceId, p);
  }
  return p;
}

export default function SourcePeek() {
  const [cur, setCur] = useState<{ sourceId: string; page: number } | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = async (e: Event) => {
      const { genId, page } = (e as CustomEvent<{ genId: string; page: number }>).detail;
      let run = runOf(genId);
      if (!run?.sourceId) { await refreshMaterials(); run = runOf(genId); }
      if (!run?.sourceId) { setErr("이 자료의 원본 PDF를 찾지 못했어요."); setCur(null); return; }
      setErr(""); setCur({ sourceId: run.sourceId, page: Math.max(1, page || 1) });
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  const yt = useYoutube(cur && isYoutubeSource(cur.sourceId) ? cur.sourceId : null);
  const pagesTotal = yt ? Object.keys(yt.pages).length : total;
  useEffect(() => {
    if (!cur || isYoutubeSource(cur.sourceId)) return;
    let alive = true;
    void (async () => {
      try {
        const doc = await docOf(cur.sourceId);
        if (!alive) return;
        setTotal(doc.numPages);
        const page = await doc.getPage(Math.min(cur.page, doc.numPages));
        const el = canvas.current, wrap = box.current;
        if (!alive || !el || !wrap) return;
        const cssW = Math.max(240, Math.min(980, wrap.clientWidth - 8));
        const base = page.getViewport({ scale: 1 });
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale: (cssW / base.width) * dpr });
        el.width = vp.width; el.height = vp.height;
        el.style.width = `${cssW}px`; el.style.height = `${vp.height / dpr}px`;
        const ctx = el.getContext("2d");
        if (ctx) await page.render({ canvasContext: ctx, viewport: vp }).promise;
      } catch (e) { if (alive) setErr(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { alive = false; };
  }, [cur]);

  useEffect(() => {
    if (!cur) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); setCur(null); }
      else if (e.key === "ArrowLeft") setCur((c) => (c && c.page > 1 ? { ...c, page: c.page - 1 } : c));
      else if (e.key === "ArrowRight") setCur((c) => (c && (!pagesTotal || c.page < pagesTotal) ? { ...c, page: c.page + 1 } : c));
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [cur, pagesTotal]);

  if (!cur) return err ? <div id="toast" role="status" className="toast-msg" onClick={() => setErr("")}>{err}</div> : null;
  const go = (k: number) => setCur((c) => (c ? { ...c, page: Math.max(1, Math.min(pagesTotal || c.page + k, c.page + k)) } : c));
  return (
    <div className="zoomlayer peek" role="dialog" aria-label="원문 보기" onClick={(e) => { if (e.target === e.currentTarget) setCur(null); }}>
      <div className="zoombar">
        <span className="row">
          <button className="qbtn" aria-label="이전 쪽" disabled={cur.page <= 1} onClick={() => go(-1)}>‹</button>
          <span className="num">{yt ? "단원 " : "p."}{cur.page}{pagesTotal ? ` / ${pagesTotal}` : ""}</span>
          <button className="qbtn" aria-label="다음 쪽" disabled={!!pagesTotal && cur.page >= pagesTotal} onClick={() => go(1)}>›</button>
        </span>
        <button className="qbtn" onClick={() => setCur(null)}>닫기 ✕</button>
      </div>
      <div ref={box} className="pagebox" style={{ ...(isYoutubeSource(cur.sourceId) ? { background: "var(--surface)", padding: "16px 20px", borderRadius: 12 } : {}), width: "min(calc(100vw - 32px), 980px)", maxHeight: "calc(100vh - 90px)", overflow: "auto" }}>
        {err ? <p className="small">{err}</p> : isYoutubeSource(cur.sourceId) ? <YoutubePage view={yt} page={cur.page} /> : <canvas ref={canvas} />}
      </div>
    </div>
  );
}

/** 유튜브 자료의 "쪽" = 내용 정리의 단원 하나. 그 단원과, 그 장면부터 영상 보기. */
function YoutubePage({ view, page }: { view: ReturnType<typeof useYoutube>; page: number }) {
  if (view === undefined) return <p className="small muted">불러오는 중…</p>;
  if (!view) return <p className="small">이 영상의 정리를 찾지 못했어요.</p>;
  const text = view.pages[String(page)] ?? "";
  const at = firstTs(text);
  return <div>
    <div className="row small" style={{ marginBottom: 8 }}><a className="btn ghost small" href={at === null ? view.url : videoAt(view.url, at)} target="_blank" rel="noopener noreferrer">▶ 이 장면부터 영상 보기</a></div>
    {text ? <NotesHTML md={text} url={view.url} /> : <p className="small muted">이 단원은 아직 없어요.</p>}
  </div>;
}
