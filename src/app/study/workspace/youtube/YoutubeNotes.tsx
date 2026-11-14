"use client";
// 유튜브 자료의 [정리] 탭 (11/15): 정리 패널과 같은 모양(목차 → 대단원 · 중단원 · 상자 · 표)으로 내용 정리를 보여 준다.
// 쓰는 중이면 1초마다 다시 읽어 흘러나오게. [분:초]를 누르면 영상의 그 장면(새 창).
import { useEffect, useMemo, useRef, useState } from "react";
import { renderNotes } from "@/lib/youtube/notes";
import { call } from "../api";
import "./notes.css";

export type YoutubeView = { id: string; title: string; url: string; video: { id: string; channel?: string; duration?: string } | null;
  notes: { status: "waiting" | "writing" | "done" | "failed"; text: string; from: string; ms?: number; error?: string } | null; pages: Record<string, string> };

export const isYoutubeSource = (sourceId?: string | null) => Boolean(sourceId?.startsWith("txt_"));
export const videoAt = (url: string, sec: number) => `${url}${url.includes("?") ? "&" : "?"}t=${Math.max(0, Math.floor(sec))}s`;

export function useYoutube(sourceId: string | null | undefined) {
  const [got, setGot] = useState<{ id: string; view: YoutubeView | null } | null>(null);
  const want = isYoutubeSource(sourceId) ? sourceId! : null;
  useEffect(() => {
    if (!want) return;
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => call<YoutubeView>(`/api/youtube/${want}`).then((v) => {
      if (!alive) return;
      setGot({ id: want, view: v });
      if (v.notes && (v.notes.status === "waiting" || v.notes.status === "writing")) timer = setTimeout(load, 1000);
    }).catch(() => { if (alive) setGot({ id: want, view: null }); });
    load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [want]);
  // undefined: 불러오는 중, null: 유튜브 자료가 아님(또는 못 찾음)
  if (!want) return null;
  return got?.id === want ? got.view : undefined;
}

/** 정리 글 HTML(이스케이프된 것만)을 그리고, 시각 · 목차 누르기를 받는다. */
export function NotesHTML({ md, url, writing, wide }: { md: string; url: string; writing?: boolean; wide?: boolean }) {
  const r = useMemo(() => renderNotes(md), [md]);
  const box = useRef<HTMLDivElement>(null);
  const onClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    const ts = el.closest<HTMLElement>(".ys-ts");
    if (ts) { e.preventDefault(); window.open(videoAt(url, Number(ts.dataset.t) || 0), "_blank", "noopener"); return; }
    const jump = el.closest<HTMLElement>("[data-jump]");
    if (jump) { box.current?.querySelector(`#${jump.dataset.jump}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  };
  return (
    <div ref={box} className={`ytn${wide && r.tocHTML ? " ytn-wide" : ""}`} onClick={onClick}>
      {wide && r.tocHTML ? <aside className="ytn-side" dangerouslySetInnerHTML={{ __html: r.tocHTML }} /> : null}
      <div>
        <div dangerouslySetInnerHTML={{ __html: r.metaHTML + (wide ? "" : r.tocHTML) }} />
        <div className="ytn-body" dangerouslySetInnerHTML={{ __html: r.bodyHTML }} />
        {writing ? <span className="ytn-caret" aria-hidden /> : null}
      </div>
    </div>
  );
}

export default function YoutubeNotes({ view }: { view: YoutubeView }) {
  const n = view.notes;
  const writing = n?.status === "writing" || n?.status === "waiting";
  return (
    <div>
      <div className="ytn-head">
        <a className="btn ghost small" href={view.url} target="_blank" rel="noopener noreferrer">▶ 영상 열기</a>
        <span className="ytn-video">{[view.video?.channel, view.video?.duration].filter(Boolean).join(" · ")}{n?.from === "panel" ? " · 정리 패널에서 쓴 정리" : ""}</span>
      </div>
      {n?.status === "waiting" ? <p className="ytn-status">자막을 받았어요. 곧 내용 정리를 쓰기 시작해요…</p> : null}
      {n?.status === "writing" ? <p className="ytn-status">내용 정리를 쓰는 중이에요. 다 쓰면 단원마다 기억 카드를 만들어요.</p> : null}
      {n?.status === "failed" ? <p className="ytn-status bad">내용 정리를 쓰지 못했어요: {n.error}</p> : null}
      {n?.text ? <NotesHTML md={n.text} url={view.url} writing={writing} wide /> : null}
    </div>
  );
}
