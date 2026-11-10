"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import { MdLines } from "./Md";

/* 질문 창 (11/11 바닐라 Chat을 React로). 떠 있는 창(옮기기·크기 바꾸기·접기·크게) 또는 읽기 곁 패널에 붙은 창. 대화 상태는 앱의 Chat. */
export type ExplainV = { page: number; auto: boolean; canAsk: boolean; custom: boolean; loading: boolean; text: string; streaming: boolean; err: string; skipped: boolean };
export type ChatV = {
  docked: boolean; visible: boolean; mode: "normal" | "min" | "max"; page: number; noteTitle: string; quote: string | null; fromNote: string;
  msgs: Array<{ role: "user" | "assistant"; page: number; quote: string; text: string }>; err: string; busy: boolean; input: string; focusTick: number;
  sugs: Array<{ label: string; why: string }>; act: string; explain: ExplainV | null;
};
export type ChatApi = {
  input(v: string): void; send(t?: string): void; stop(): void; reset(): void; close(): void; mode(m: "normal" | "min" | "max"): void; unquote(): void;
  edit(label: string): void; act(): void; explainAuto(on: boolean): void; explainAgain(): void; gear(k: string): void;
};

const BOX_KEY = "dejipgi.chatbox";
type Box = { x: number; y: number; w: number; h: number };
const readBox = (): Box | null => { try { return JSON.parse(localStorage.getItem(BOX_KEY) || "null"); } catch { return null; } };
const saveBox = (el: HTMLElement) => { const r = el.getBoundingClientRect(); try { localStorage.setItem(BOX_KEY, JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height })); } catch { /* 이 브라우저에 못 남겨도 창은 그대로 */ } };

export function ExplainCard({ e, api }: { e: ExplainV; api: ChatApi }) {
  const again = (label: string) => <button className="chip-btn" onClick={api.explainAgain}>{label}</button>;
  let body;
  if (e.text) body = <div className={`ex-body${e.streaming ? " streaming" : ""}`}><MdLines text={e.text} /></div>;
  else if (!e.canAsk) body = <p className="small muted">질문 답변이 연결되면 쪽마다 쉬운 설명이 여기 바로 떠요.</p>;
  else if (e.err) body = <div><p className="check">{e.err}</p>{again("다시 설명 받기")}</div>;
  else if (e.skipped) body = <div><p className="small muted">글자가 거의 없는 쪽이라 자동 설명은 건너뛰었어요.</p>{again("그래도 설명 보기")}</div>;
  else if (!e.auto) body = again("이 쪽 쉬운 설명 보기");
  else body = <p className="small muted ex-wait">{e.loading ? "저장된 설명을 불러오는 중…" : "잠깐 머무르면 쉬운 설명이 떠요…"}</p>;
  return (
    <div className="explain">
      <div className="ex-head">
        <b>쉬운 설명 · p.{e.page}</b><span className="grow" />
        {e.canAsk ? <label className="ex-auto" title="쪽을 넘기고 1.5초 머무르면 자동으로 설명해요. 쪽마다 한 번만 만들고 저장해 둬요.">
          <input type="checkbox" checked={e.auto} onChange={(ev) => api.explainAuto(ev.target.checked)} />자동</label> : null}
        <button className={`ex-gear${e.custom ? " on" : ""}`} title={e.custom ? "설명 방식 바꾸기 (내 요청 사용 중)" : "설명 방식 바꾸기"} aria-label="쉬운 설명 설정" onClick={() => api.gear("explain")}>⚙</button>
      </div>
      {body}
    </div>
  );
}

export default function ChatWindow({ c, api, head }: { c: ChatV; api: ChatApi; head?: boolean }) {
  const el = useRef<HTMLElement | null>(null), log = useRef<HTMLDivElement | null>(null), ta = useRef<HTMLTextAreaElement | null>(null);
  const floating = !c.docked;
  // 떠 있는 창의 자리: 처음엔 저장된 자리, 그다음엔 사람이 옮긴 자리. 크게·접기는 그 위에.
  useLayoutEffect(() => {
    const w = el.current; if (!w || !floating) return;
    const vw = innerWidth, vh = innerHeight;
    if (vw <= 700) { Object.assign(w.style, { left: "", top: "", width: "", height: "" }); return; }
    if (c.mode === "max") { const mw = Math.min(vw - 32, Math.max(560, Math.round(vw * 0.46))); Object.assign(w.style, { left: (vw - mw - 16) + "px", top: "16px", width: mw + "px", height: (vh - 32) + "px" }); return; }
    if (c.mode === "min") { const r = w.getBoundingClientRect(); Object.assign(w.style, { height: "", top: Math.min(r.top, vh - 60) + "px" }); return; }
    const b = readBox();
    const ww = Math.min(Math.max(b?.w || 380, 300), vw - 24), hh = Math.min(Math.max(b?.h || Math.min(480, vh - 220), 260), vh - 24);
    const x = Math.min(Math.max(b?.x ?? vw - ww - 24, 8), vw - ww - 8), y = Math.min(Math.max(b?.y ?? 120, 8), vh - hh - 8);
    Object.assign(w.style, { left: x + "px", top: y + "px", width: ww + "px", height: hh + "px" });
  }, [floating, c.mode]);
  useEffect(() => { if (c.focusTick) ta.current?.focus({ preventScroll: true }); }, [c.focusTick]);
  // 새 글이 오면 맨 아래로 (사람이 위로 올려 읽는 중이면 두기)
  const atEnd = useRef(true);
  useLayoutEffect(() => { const l = log.current; if (l && atEnd.current) l.scrollTop = l.scrollHeight; });

  const drag = (e: React.PointerEvent) => {
    const w = el.current; if (!w || !floating || innerWidth <= 700 || (e.target as HTMLElement).closest("button")) return;
    const r = w.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top, t = e.currentTarget as HTMLElement;
    t.setPointerCapture(e.pointerId); w.classList.add("dragging");
    const move = (ev: PointerEvent) => { const rr = w.getBoundingClientRect(); w.style.left = Math.min(Math.max(ev.clientX - dx, 4), innerWidth - rr.width - 4) + "px"; w.style.top = Math.min(Math.max(ev.clientY - dy, 4), innerHeight - 48) + "px"; };
    const up = () => { t.removeEventListener("pointermove", move); t.removeEventListener("pointerup", up); t.removeEventListener("pointercancel", up); w.classList.remove("dragging"); if (c.mode === "normal") saveBox(w); };
    t.addEventListener("pointermove", move); t.addEventListener("pointerup", up); t.addEventListener("pointercancel", up);
  };
  const resize = (dir: string) => (e: React.PointerEvent) => {
    const w = el.current; if (!w || innerWidth <= 700) return;
    if (c.mode !== "normal") api.mode("normal");
    const r = w.getBoundingClientRect(), st = { x: e.clientX, y: e.clientY, l: r.left, t: r.top, w: r.width, h: r.height }, t = e.currentTarget as HTMLElement;
    t.setPointerCapture(e.pointerId); w.classList.add("dragging"); e.preventDefault();
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - st.x, dy = ev.clientY - st.y, MINW = 300, MINH = 220; let { l, t: top, w: ww, h: hh } = st;
      if (dir.includes("e")) ww = Math.min(Math.max(st.w + dx, MINW), innerWidth - st.l - 4);
      if (dir.includes("s")) hh = Math.min(Math.max(st.h + dy, MINH), innerHeight - st.t - 4);
      if (dir.includes("w")) { ww = Math.min(Math.max(st.w - dx, MINW), st.l + st.w - 4); l = st.l + st.w - ww; }
      if (dir.includes("n")) { hh = Math.min(Math.max(st.h - dy, MINH), st.t + st.h - 4); top = st.t + st.h - hh; }
      Object.assign(w.style, { left: l + "px", top: top + "px", width: ww + "px", height: hh + "px" });
    };
    const up = () => { t.removeEventListener("pointermove", move); t.removeEventListener("pointerup", up); t.removeEventListener("pointercancel", up); w.classList.remove("dragging"); saveBox(w); };
    t.addEventListener("pointermove", move); t.addEventListener("pointerup", up); t.addEventListener("pointercancel", up);
  };

  return (
    <section ref={el} className={`chatwin${c.docked ? " docked" : ""}`} role="dialog" aria-label="질문하기" data-mode={floating ? c.mode : undefined}>
      {floating && head !== false ? (
        <div className="chat-head" onPointerDown={drag} onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("button")) api.mode(c.mode === "max" ? "normal" : "max"); }}>
          <span className="chat-grip" aria-hidden="true" />
          <strong>{c.page ? `질문하기 · p.${c.page}` : "질문하기"}</strong>
          <span className="grow" />
          <button className="qbtn" title="새 대화 시작 (지금 대화는 노트에 남아요)" onClick={api.reset}>새 대화</button>
          <button className="qbtn" aria-label={c.mode === "min" ? "펼치기" : "접기"} title={c.mode === "min" ? "펼치기" : "접기"} onClick={() => api.mode(c.mode === "min" ? "normal" : "min")}>{c.mode === "min" ? "▢" : "—"}</button>
          <button className="qbtn" aria-label={c.mode === "max" ? "원래 크기" : "크게 보기"} title={c.mode === "max" ? "원래 크기" : "크게 보기"} onClick={() => api.mode(c.mode === "max" ? "normal" : "max")}>{c.mode === "max" ? "⤡" : "⤢"}</button>
          <button className="qbtn" aria-label="질문 창 닫기" title="닫기" onClick={api.close}>✕</button>
        </div>
      ) : null}
      {c.noteTitle ? <div className="chat-saved" title={`노트 · ${c.noteTitle}`}>노트 · {c.noteTitle}</div> : null}
      <div className="chat-log" aria-live="polite" ref={log} onScroll={(e) => { const l = e.currentTarget; atEnd.current = l.scrollHeight - l.scrollTop - l.clientHeight < 40; }}>
        {c.fromNote ? <p className="chat-hint" style={{ textAlign: "center" }}>‘{c.fromNote}’ 카드에서 이어진 대화예요. 여기 대화도 그 카드에 저장돼요.</p> : null}
        {c.explain ? <ExplainCard e={c.explain} api={api} /> : null}
        {!c.msgs.length ? <p className="chat-hint">{c.docked ? "더 궁금한 건 바로 물어보거나 아래에서 골라 보세요. 원문을 드래그해 [질문 창에 넣기]로 인용할 수도 있어요." : "지금 보는 쪽을 근거로 답해요. 바로 물어보거나 아래에서 골라 보세요. 원문을 드래그해 [질문 창에 넣기]로 인용할 수도 있어요."}</p> : null}
        {c.msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.page && m.role === "user" ? <span className="bpage">p.{m.page}</span> : null}
            {m.quote ? <div className="qchip">“{m.quote}”</div> : null}
            <div className="btext">{m.role === "assistant" ? <MdLines text={m.text} /> : m.text}</div>
          </div>
        ))}
        {c.err ? <p className="check">{c.err}</p> : null}
        <div className="chat-sugs">
          {c.sugs.map(q => (
            <span key={q.label} className={`sug${q.why === "AI 제안" ? " ai" : ""}`}>
              <button className="chip-btn" title={q.why ? `${q.why} · 누르면 바로 물어봐요` : undefined} onClick={() => api.send(q.label)}>
                {q.why === "AI 제안" ? <span className="sug-ai" aria-label="AI 제안">✦</span> : null}{q.label}
              </button>
              <button className="sug-edit" title="입력창에 넣고 고쳐 쓰기" aria-label="고쳐서 묻기" onClick={() => api.edit(q.label)}>✎</button>
            </span>
          ))}
          {c.act ? <button className="chip-btn act" onClick={api.act}>{c.act}</button> : null}
        </div>
      </div>
      <div className="chat-foot">
        <div className="chat-in">
          <div>{c.quote ? <div className="qchip"><span>“{c.quote}”</span><button className="qbtn" aria-label="인용 빼기" onClick={api.unquote}>✕</button></div> : null}</div>
          <textarea ref={ta} rows={2} value={c.input} placeholder={c.docked ? "물어보기 · Enter 보내기" : "지금 보는 쪽에 대해 물어보세요 (Enter 보내기, Shift+Enter 줄바꿈)"}
            onChange={(e) => api.input(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); api.send(); } }} />
        </div>
        <button className="btn primary small" onClick={() => (c.busy ? api.stop() : api.send())}>{c.busy ? "멈추기" : "보내기"}</button>
      </div>
      {floating ? ["n", "s", "e", "w", "ne", "nw", "se", "sw"].map(dir => <div key={dir} className={`rz rz-${dir}`} aria-hidden="true" onPointerDown={resize(dir)} />) : null}
    </section>
  );
}
