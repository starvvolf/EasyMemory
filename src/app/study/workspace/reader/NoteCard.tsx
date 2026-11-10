"use client";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { RichInline } from "../Rich";
import { MdLines } from "./Md";

/* 모르는 것 답 카드 (11/11 바닐라 renderNoteCard·placeNoteCard를 React로).
   넓은 화면 세로 쪽: 쪽 오른쪽에 그 글 높이로 붙고 선으로 잇는다. 슬라이드(곁 패널): 패널 위에 덮는다. 좁은 화면: 아래에서 올라온다. */
export type NoteV = {
  id: string; quote: string; kind: string; kindCls: string; weak: boolean; loading: boolean;
  answer: { lead: string; steps?: Array<{ step: string; why?: string }>; quote?: string; extra?: string; outsideSource?: string } | null;
  thread: Array<{ role: string; text: string }>; err: { text: string; login?: boolean; retry?: boolean } | null; busy: boolean; again: boolean; seen: number;
  page: number; ago: string; long: boolean; anchorY: number | null; placeTick: number;
};
export type NoteApi = { noteClose(): void; noteFollow(q: string): void; noteRetry(): void; noteContinue(): void; connect(): void };

export default function NoteCard({ n, api, grid, floating }: { n: NoteV; api: NoteApi; grid: RefObject<HTMLDivElement | null>; floating: boolean }) {
  const card = useRef<HTMLElement | null>(null);
  const [q, setQ] = useState("");
  // 쪽의 글과 카드를 잇는 선: 재어 본 자리를 바로 그린다(그림만 바뀌므로 React 상태로 두지 않는다).
  const svg = useRef<SVGSVGElement | null>(null), path = useRef<SVGPathElement | null>(null), dot = useRef<SVGCircleElement | null>(null), tick = useRef<HTMLElement | null>(null);
  const [resized, setResized] = useState(0);
  useLayoutEffect(() => {
    const c = card.current, g = grid.current, sv = svg.current, tk = tick.current; if (!c || !g || !sv || !tk) return;
    const hideLink = () => { sv.style.display = "none"; tk.style.display = "none"; };
    const side = document.querySelector(".rside");
    if (floating) {
      c.classList.toggle("onside", !!side);
      if (side) { const r = side.getBoundingClientRect(); Object.assign(c.style, { left: r.left + "px", top: Math.max(8, r.top) + "px", width: r.width + "px", height: Math.min(r.height, innerHeight - Math.max(8, r.top) - 8) + "px", right: "auto", bottom: "auto" }); }
      else for (const k of ["left", "top", "width", "height", "right", "bottom"] as const) c.style[k] = "";
      hideLink(); return;
    }
    const box = document.getElementById("pagebox");
    if (!box || getComputedStyle(c).position === "fixed") { hideLink(); return; }
    const gr = g.getBoundingClientRect(), br = box.getBoundingClientRect();
    let y: number | null = null;
    const mark = n.id ? box.querySelector(`.nu[data-note="${n.id}"]`) : null;
    if (mark) { const r = mark.getBoundingClientRect(); y = r.top + r.height / 2 - br.top; }
    else if (n.anchorY != null) y = n.anchorY * br.height;
    if (y == null) { c.style.marginTop = "0px"; hideLink(); return; }
    c.style.marginTop = Math.max(0, Math.min(br.top - gr.top + y - 24, br.bottom - gr.top - 120)) + "px";
    const cr = c.getBoundingClientRect();
    const x1 = br.right - gr.left, y1 = br.top - gr.top + y, x2 = cr.left - gr.left, y2 = cr.top - gr.top + 22, mx = (x1 + x2) / 2;
    Object.assign(sv.style, { display: "", left: "0px", top: "0px", width: gr.width + "px", height: (Math.max(y1, y2) + 4) + "px" });
    path.current?.setAttribute("d", `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
    dot.current?.setAttribute("cx", String(x1)); dot.current?.setAttribute("cy", String(y1));
    Object.assign(tk.style, { display: "", left: (x1 - 2) + "px", top: (y1 - 9) + "px" });
  }, [n.id, n.anchorY, n.placeTick, floating, grid, n.loading, n.thread.length, resized]);
  useLayoutEffect(() => {
    const onResize = () => setResized((k) => k + 1);
    addEventListener("resize", onResize); return () => removeEventListener("resize", onResize);
  }, []);
  const a = n.answer;
  return (
    <>
      <aside ref={card} className={`notecard${n.weak ? " weak" : ""}`} role="dialog" aria-label={`${n.quote} 노트`}>
        <div className="nhd">
          <span className={`nk ${n.kindCls}`}>{n.kind}</span><span className="nq" title={n.quote}>{n.quote}</span>
          {n.weak ? <span className="nk k-weak">약점</span> : null}
          <button className="qbtn" aria-label="닫기" onClick={api.noteClose}>✕</button>
        </div>
        {n.again ? <div className="nagain">{n.weak ? `${n.seen}번째 다시 봄 · 약점으로 표시했어요` : `${n.seen}번째 다시 봄 · 저장된 답이에요 (AI 호출 없음)`}</div> : null}
        <div className="nbody">
          {n.loading ? (n.err ? null : <div className="nskel"><i style={{ width: "88%" }} /><i style={{ width: "62%" }} /><i style={{ width: "74%" }} /></div>) : a ? (
            <>
              <p className="nlead"><RichInline text={a.lead} /></p>
              {a.steps && a.steps.length ? <ol className="nsteps">{a.steps.map((s, i) => <li key={i}><b><RichInline text={s.step} /></b>{s.why ? <span className="why"> — <RichInline text={s.why} /></span> : null}</li>)}</ol> : null}
              {a.quote ? <div className="nquote">“{a.quote}”</div> : null}
              {a.extra ? <p className="nextra"><RichInline text={a.extra} /></p> : null}
              {a.outsideSource ? <div className="nout"><b>원문 밖 설명</b> · <RichInline text={a.outsideSource} /></div> : null}
            </>
          ) : null}
          {n.thread.length ? <div className="nthread">{n.thread.map((t, i) => <div key={i} className={`bubble ${t.role === "user" ? "user" : "assistant"}`}><div className="btext">{t.role === "user" ? t.text : <MdLines text={t.text} />}</div></div>)}</div> : null}
          {n.err ? (
            <div className="nerr" role="alert"><span>{n.err.text}</span>
              {n.err.login ? <button className="btn small" onClick={api.connect}>ChatGPT 연결</button> : null}
              {n.err.retry && !n.id ? <button className="btn small" onClick={api.noteRetry}>다시 시도</button> : null}
            </div>
          ) : null}
        </div>
        {n.id && a ? (
          <form className="nfollow" onSubmit={(e) => { e.preventDefault(); const v = q.trim(); if (v && !n.busy) { api.noteFollow(v); setQ(""); } }}>
            <input name="q" placeholder="이어서 물어보기" aria-label="이어서 물어보기" autoComplete="off" disabled={n.busy} value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn small" disabled={n.busy}>{n.busy ? "답 기다리는 중…" : "보내기"}</button>
          </form>
        ) : null}
        {n.long ? <div className="ncont"><span>대화가 길어졌어요.</span><button className="btn small" onClick={api.noteContinue}>질문 창에서 계속</button></div> : null}
        {n.id ? <div className="nft"><span>p.{n.page} · {n.ago} 물어봄</span><span className="grow" /><span>다시 본 횟수 {n.seen}</span></div> : null}
      </aside>
      <svg ref={svg} className="nlink" aria-hidden="true" style={{ display: "none" }}><path ref={path} /><circle ref={dot} r={3} /></svg>
      <i ref={tick as React.RefObject<HTMLElement>} className="ntick" style={{ display: "none" }} />
    </>
  );
}
