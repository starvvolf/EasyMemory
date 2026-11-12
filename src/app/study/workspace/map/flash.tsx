"use client";
// 자료 지도 조각 (11/12 A 정리, MaterialMap.tsx에서 나눔): 플래시카드: 앞면 질문 → 답 보기.
import { useState } from "react";
import { call, errorText } from "../api";
import { RichInline as Rich } from "../Rich";
import { Answer, Body, Card, FigureView, OldMore } from "./shape";

// 플래시카드(11/11 사용자 "기억 카드가 사실상 플래시카드 역할" → "일단 플래시카드는 바로 풀 수 있게, 기억에서 바로 연동되니까"):
// 앞면 = 질문(없으면 이름) → [답 보기] → 답 · 풀이 · 모양 · 핵심 → [알았어요]/[몰랐어요]를 기억 저장소에 남긴다(맞힘/틀림 → 복습 날짜는 저장소가 정함).
export function FlashCards({ genId, title, cards, onPage, onClose }: { genId: string; title: string; cards: Card[]; onPage: (page: number) => void; onClose: () => void }) {
  const [list, setList] = useState(cards);
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const [marks, setMarks] = useState<Record<string, "known" | "unknown">>({});
  const [error, setError] = useState("");
  const [missed, setMissed] = useState(0); // 저장소에 남지 않은 수
  // 그림 미리 보기(11/12 사용자 "그림을 미리 보기 할지 말지"): 켜면 질문과 함께 그림부터, 끄면 그림은 답을 볼 때. 고른 것은 다음에도(이 브라우저).
  const [pics, setPics] = useState(() => { try { return localStorage.getItem("recaller:fc-pics") === "1"; } catch { return false; } });
  const togglePics = () => setPics((v) => { try { localStorage.setItem("recaller:fc-pics", v ? "0" : "1"); } catch { /* storage off */ } return !v; });
  const c = list[i];
  const mark = (v: "known" | "unknown") => {
    if (!c) return;
    setMarks((m) => ({ ...m, [c.id]: v }));
    // 카드 ref로 남긴다: 아직 기억 저장소에 안 들어간(기다리는) 카드면 이때 들어간다(ref-event → recordByRef).
    void call<{ recorded: number }>("/api/knowledge/ref-event", { refs: [c.ref], kind: v === "known" ? "correct" : "wrong", detail: v === "known" ? "플래시카드: 알았어요" : "플래시카드: 몰랐어요", material: title })
      .then((r) => { if (!r.recorded) setMissed((n) => n + 1); }).catch((e) => setError(errorText(e)));
    setShown(false); setI((x) => x + 1);
  };
  const known = list.filter((x) => marks[x.id] === "known").length, unknown = list.filter((x) => marks[x.id] === "unknown").length;
  if (!c) return <div className="fc-wrap"><div className="fc-done">
    <p className="fc-donetitle">다 봤어요</p>
    <p className="small muted">알았어요 {known} · 몰랐어요 {unknown}{missed ? ` · ${missed}장은 기억 저장소에 남기지 못했어요` : " · 기억에 남겼어요"}</p>
    {error ? <p className="small bad">{error}</p> : null}
    <div className="row small">{unknown ? <button className="btn small primary" onClick={() => { setList(list.filter((x) => marks[x.id] === "unknown")); setMarks({}); setI(0); }}>몰랐던 {unknown}장 다시</button> : null}
      <button className="btn ghost small" onClick={onClose}>닫기</button></div></div></div>;
  const m = c.memo;
  return <div className="fc-wrap">
    <div className="fc-top"><span className="small muted num">{i + 1} / {list.length}</span><div className="fc-bar"><span style={{ width: `${(i / list.length) * 100}%` }} /></div>
      <button className={`fc-pics${pics ? " on" : ""}`} role="switch" aria-checked={pics} onClick={togglePics} title="켜면 질문과 함께 그림을 먼저 보여 줘요. 끄면 답을 볼 때 보여 줘요.">그림 미리 보기 {pics ? "켬" : "끔"}</button>
      <button className="btn ghost small" onClick={onClose}>그만</button></div>
    <section key={c.id} className="fc-card lc3-in-next">
      <p className="fc-name"><Rich text={c.title} /></p>
      <p className="fc-q">{m?.question ? <Rich text={m.question} /> : <>이 기억을 떠올려 보세요</>}</p>
      {pics ? <FigureView genId={genId} c={c} onPage={onPage} /> : null}
      {shown ? <div className="fc-back">
        {m?.answer ? <Answer text={m.answer} /> : m?.line ? <>
        <p className="lc3-ca mm3-a"><span className="lc3-qtag a">A</span><Rich text={m.line} /></p>
        <OldMore idea={m.idea} shape={c.shape} details={m.details} /></> : <Body s={c.shape} />}
        {pics ? null : <FigureView genId={genId} c={c} onPage={onPage} />}
        <div className="lc3-pages">{c.pages.slice(0, 4).map((p) => <button key={p} className="lc3-pagechip" onClick={() => onPage(p)}>원문 p.{p}</button>)}</div>
      </div> : null}
    </section>
    {error ? <p className="small bad">{error}</p> : null}
    <div className="fc-actions">{shown ? <><button className="fc-btn no" onClick={() => mark("unknown")}>몰랐어요</button><button className="fc-btn yes" onClick={() => mark("known")}>알았어요</button></>
      : <button className="fc-btn show" onClick={() => setShown(true)}>답 보기</button>}</div>
  </div>;
}
