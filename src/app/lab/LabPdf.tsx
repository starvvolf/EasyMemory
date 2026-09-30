"use client";
import { useEffect, useRef, useState } from "react";
import type { RenderTask } from "pdfjs-dist/types/src/display/api";

export default function LabPdf({ sourceId, page }: { sourceId: string; page: number }) {
    const container = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
    const [error, setError] = useState(""), [loading, setLoading] = useState(true);
    useEffect(() => {
        let active = true;
        let task: ReturnType<typeof import("pdfjs-dist").getDocument> | undefined;
        let render: RenderTask | undefined;
        const abort = new AbortController();
        async function load() {
            setLoading(true); setError("");
            try {
                const response = await fetch(`/api/mcp-runs/sources/${encodeURIComponent(sourceId)}/pdf`, { signal: abort.signal });
                if (!response.ok) throw new Error("원문 PDF를 열지 못했어요.");
                const bytes = await response.arrayBuffer();
                const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
                pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
                if (!active) return;
                task = pdfjs.getDocument({ data: bytes });
                const document = await task.promise, pdfPage = await document.getPage(page);
                if (!active || !canvas.current) return;
                const scale = Math.max(0.1, ((container.current?.clientWidth || 420) - 24) / pdfPage.getViewport({ scale: 1 }).width);
                const viewport = pdfPage.getViewport({ scale: scale * window.devicePixelRatio });
                canvas.current.width = viewport.width; canvas.current.height = viewport.height;
                canvas.current.style.width = `${viewport.width / window.devicePixelRatio}px`;
                canvas.current.style.height = `${viewport.height / window.devicePixelRatio}px`;
                render = pdfPage.render({ canvas: canvas.current, viewport });
                await render.promise;
            } catch (e) { if (active) setError(e instanceof Error ? e.message : String(e)); }
            finally { if (active) setLoading(false); }
        }
        void load();
        return () => { active = false; abort.abort(); render?.cancel(); void task?.destroy(); };
    }, [sourceId, page]);
    return <div ref={container} className="pdf-canvas">{loading && <p>원문 여는 중</p>}{error && <p role="alert">{error}</p>}<canvas ref={canvas} aria-label={`원문 ${page}쪽`} /></div>;
}
