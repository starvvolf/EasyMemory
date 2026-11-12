"use client";
// 자료 지도 조각 (11/12 A 정리, MaterialMap.tsx에서 나눔): [강의] 탭: 영역마다 걸음 글 · 그림 · 확인 질문, 흘러나오는 글.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { call, errorText } from "../api";
import { Rich as RichBlock, RichInline as Rich } from "../Rich";
import { Card, LectureCard } from "./shape";

// 11/10 "카드 단위 말고 더 큰 단위로": 박스 하나 = 영역 하나, 기억은 설명 안 ⟦카드 id⟧ 자리에 붙는다.
// 강의 (11/10 사용자 "카드 단위로 순서 잡고 그 사이에 학생 개입 들어오면 집어넣으면 되잖아", "기본 강의 순서는 가로로, 학생이 개입해서 새로 알려 주는 건
// 그 박스 밑으로 세로로"): src/lib/study/lecture-steps.ts. 카드 하나 = 가로로 넘기는 박스 하나(강사의 설명이 흘러나옴), 박스 밑에 묻고 들은 것이 세로로 쌓인다.
// 다음 카드는 [다음]을 누를 때 부르고, 앞에서 묻고 들은 것을 이어받는다.
export const FIG_MARK = /⟦그림:\s*([^|⟧]+?)\s*\|\s*([^⟧]*?)\s*⟧|⟦카드\s*([^⟧\s]+)\s*⟧|⟦확인⟧\s*([^\n]*)(?:\n+\s*⟦답⟧\s*([^\n]*))?/g;
/** $$…$$(여러 줄)를 한 줄 $…$로: Rich는 줄마다 식을 읽는다. */
export const flatMath = (t: string) => t.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_, x: string) => `\n\n$${x.replace(/\s*\n\s*/g, " ")}$\n\n`);
export function LectureFig({ genId, label, says }: { genId: string; label: string; says: string }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => { let alive = true; call<{ dataUrl: string | null }>(`/api/study-map/${genId}/lecture?v=2&fig=${encodeURIComponent(label)}`).then((r) => { if (alive) setSrc(r.dataUrl); }).catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; }; }, [genId, label]);
  // eslint-disable-next-line @next/next/no-img-element
  const img = src ? <img src={src} alt={says || label} /> : null;
  return <figure className="lc2-fig">{img ?? <div className="small muted">{src === null ? "그림을 불러오지 못했어요" : "그림 불러오는 중…"}</div>}
    <figcaption className="small muted">{says ? <Rich text={says} /> : null}</figcaption></figure>; /* 11/12 사용자 "$E_2$ 왜 못 잡냐": 강의 그림 설명도 수식으로 */
}
/**
 * 흘러나오는 글을 일정한 속도로 보여 준다(11/11 사용자 "스트리밍 오는 거 부드럽게 일정 속도로 나오는 것처럼"). 받은 글보다 늦게, 한 글자씩
 * 같은 빠르기로 따라가고, 밀린 글이 많으면 조금씩 빨라진다. animate가 아니면(이미 본 글) 바로 다 보인다. 쓰다 만 식($)·표시(⟦)는 감춘다.
 */
export function useSmoothText(target: string, animate: boolean, onCaughtUp?: () => void) {
  // 11/12 사용자 "만들어지는 거 받을 때만 부드럽게, 이미 받아 놨으면 다시 만드는 척 안 해도": 화면을 열 때 이미 받은 글은 바로 다 보이고,
  // 그 뒤에 새로 오는 글만 일정한 속도로 따라간다(예전엔 쓰는 중인 장을 다시 열면 처음부터 다시 타자 치듯 보였다).
  const [shown, setShown] = useState(() => target.length);
  const want = useRef(target);
  const done = useRef(onCaughtUp);
  useEffect(() => { want.current = target; done.current = onCaughtUp; });
  useEffect(() => {
    if (!animate) return;
    let raf = 0, last = 0, pos = want.current.length, acc = 0, told = false;
    const tick = (t: number) => {
      const dt = last ? Math.min(100, t - last) : 16; last = t;
      const total = want.current.length;
      if (pos < total) {
        const backlog = total - pos;
        acc += (dt / 1000) * (42 + backlog * 0.6); // 기본 초당 약 42자, 밀리면 빨라짐
        const step = Math.floor(acc);
        if (step > 0) { acc -= step; pos = Math.min(total, pos + step); setShown(pos); }
      } else if (pos > total) { pos = total; setShown(pos); }
      else if (!told && done.current) { told = true; done.current(); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate]);
  let out = animate ? target.slice(0, shown) : target;
  if (animate && shown < target.length) {
    const open = out.lastIndexOf("⟦"); if (open > out.lastIndexOf("⟧")) out = out.slice(0, open);
    if ((out.match(/\$/g) ?? []).length % 2) out = out.slice(0, out.lastIndexOf("$"));
  }
  return { text: out, behind: animate && shown < target.length };
}
export function SmoothLecture({ genId, text, live, animate, byId, onPage, onSeen }: { genId: string; text: string; live: boolean; animate: boolean; byId: Map<string, Card>; onPage: (page: number) => void; onSeen?: () => void }) {
  // 11/11 사용자 "처음 스트리밍 오는 것만 부드럽게, 완성된 걸 여는 건 창 넘기기 애니메이션으로": 열 때 이미 다 쓴 글이면 한 번에 보인다.
  const [typing] = useState(() => animate && live);
  const smooth = useSmoothText(text, typing, live ? undefined : onSeen);
  return <><LectureText genId={genId} text={smooth.text} byId={byId} onPage={onPage} />{live || smooth.behind ? <span className="lc2-caret" /> : null}</>;
}
/** 걸음 끝의 스스로 따져 보기(⟦확인⟧ 질문 / ⟦답⟧ 답): 답은 눌러서 본다. */
export function LectureCheck({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return <div className={`lc3-check${open ? " open" : ""}`}><p className="lc3-checkq"><span className="lc3-checktag">확인</span><Rich text={q} /></p>
    {a ? open ? <p className="lc3-checka"><Rich text={a} /></p> : <button className="lc3-checkbtn" onClick={() => setOpen(true)}>답 보기</button> : null}</div>;
}
// 굵게 = 카드(11/11 사용자 "굵게 쓰는 걸 컨트롤해서 카드로 만들 수 있게" → "굵게 누르면 그 카드"): 강사가 카드의 핵심 말을 ⟦굵게 id | 말⟧로 쓰면
// 그 말을 **굵게** 그리고, 누르면 그 말이 있는 문단 바로 밑에 그 카드가 펼쳐진다(다시 누르면 닫힘). 카드와 상관없는 **강조**는 그냥 굵게.
export const BOLD_CARD = /⟦굵게\s*([^|⟧\s]+)\s*\|\s*([^⟧]+?)\s*⟧/g;
export function LectureText({ genId, text, byId, onPage }: { genId: string; text: string; byId: Map<string, Card>; onPage: (page: number) => void }) {
  const [open, setOpen] = useState<{ part: number; id: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const links = new Map<string, string>(); // 굵은 말 → 카드 id
  const plain = text.replace(BOLD_CARD, (_, id: string, word: string) => { if (byId.has(id)) { links.set(word.trim(), id); return `**${word.trim()}**`; } return `**${word.trim()}**`; });
  // 카드에 이어진 굵은 말만 누를 수 있게 표시(문단은 Rich가 그려서, 그린 뒤 <b>에 표시를 붙인다)
  useEffect(() => { for (const el of box.current?.querySelectorAll("b") ?? []) { const id = links.get((el.textContent ?? "").trim()); el.classList.toggle("lc3-link", Boolean(id)); if (id) el.setAttribute("data-card", id); else el.removeAttribute("data-card"); } });
  const onClick = (e: React.MouseEvent) => {
    const b = (e.target as HTMLElement).closest("b[data-card]") as HTMLElement | null; if (!b) return;
    const part = Number((b.closest("[data-part]") as HTMLElement | null)?.dataset.part ?? -1); const id = b.dataset.card!;
    e.stopPropagation(); setOpen((x) => (x && x.id === id && x.part === part ? null : { part, id }));
  };
  const parts: ReactNode[] = []; let last = 0, k = 0;
  // 문단마다 나눠 그려서, 누른 굵은 말이 있는 그 문단 바로 밑에 카드가 펼쳐지게
  const block = (t: string) => { for (const para of flatMath(t).split(/\n{2,}/)) { if (!para.trim()) continue; const n = k++; parts.push(<div key={n} data-part={n}><RichBlock text={para} /></div>);
    if (open?.part === n) { const c = byId.get(open.id); if (c) parts.push(<div key={`o${n}`} className="lc3-pop"><LectureCard genId={genId} c={c} onPage={onPage} startOpen /></div>); } } };
  for (const m of plain.matchAll(FIG_MARK)) {
    if (m.index! > last) block(plain.slice(last, m.index));
    if (m[3]) { const c = byId.get(m[3]); if (c) parts.push(<LectureCard key={k++} genId={genId} c={c} onPage={onPage} />); }
    else if (m[4] !== undefined) parts.push(<LectureCheck key={k++} q={m[4]} a={m[5] ?? ""} />);
    else parts.push(<LectureFig key={k++} genId={genId} label={m[1]} says={m[2]} />);
    last = m.index! + m[0].length;
  }
  const rest = plain.slice(last).replace(/⟦[^⟧]*$/, "");
  if (rest.trim()) block(rest);
  return <div ref={box} onClick={onClick}>{parts}</div>;
}
// 11/11 사용자 "옆으로 넘어가는 건 좋은데 드래그는 별로. 그냥 넘어가고 이전 건 안 보이게, 앞뒤 <> 버튼으로": 장은 지금 것 하나만, 넘길 때 옆에서 밀려 들어온다.
// 11/11 "강의 탭 새 방식으로 연결": src/lib/study/lecture-areas.ts(?v=3). 영역 하나를 강사가 한 흐름으로 쓰고(걸음으로 나눔), 장 하나 = 걸음 하나.
// 질문은 그 걸음 밑에. 다음 영역은 지금 영역을 다 쓴 뒤 하나만 미리 부른다.
export type L3Ask = { q: string; a: string; status: string };
export type L3Step = { n: number; title: string; text: string; asks: L3Ask[] };
export type L3Area = { id: string; title: string; cards: string[]; status: string | null; steps: L3Step[] };
export type L3Slot = { key: string; ai: number; area: L3Area; step: L3Step | null };
export function LecturePane({ genId, cards, onPage }: { genId: string; cards: Card[]; onPage: (page: number) => void }) {
  const [areas, setAreas] = useState<L3Area[] | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [atKey, setAtKey] = useState<string | null>(null);
  const [starting, setStarting] = useState(false); // 11/12 점검 13번: [강의 시작] 뒤 첫 장이 올 때까지 기다린다는 표시
  const [dir, setDir] = useState<"next" | "prev">("next");
  const [q, setQ] = useState("");
  const [seen, setSeen] = useState<Set<string>>(() => new Set()); // 끝까지 흘려 보여 준 글(다시 오면 바로 다 보임)
  const markSeen = (key: string) => setSeen((x) => (x.has(key) ? x : new Set(x).add(key)));
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const base = `/api/study-map/${genId}/lecture?v=3`;
  const writing = Boolean(areas?.some((a) => a.status === "writing" || a.steps.some((s) => s.asks.some((x) => x.status === "writing"))));
  const load = () => call<{ lecture: { areas: L3Area[] } }>(base).then((r) => { setAreas(r.lecture.areas); return r.lecture.areas; }).catch((e) => { setError(errorText(e)); setAreas(null); return null; });
  const slotsOf = (list: L3Area[]): L3Slot[] => list.flatMap((a, ai): L3Slot[] => a.steps.length ? a.steps.map((s) => ({ key: `${a.id}:${s.n}`, ai, area: a, step: s })) : a.status ? [{ key: `${a.id}:0`, ai, area: a, step: null }] : []);
  // 보던 장을 기억한다(11/12 사용자 "카드 눌렀는데 다음으로 넘어간 것 같다"): 다른 탭에 다녀오거나 문제를 풀고 와서 강의를 다시 열면
  // 마지막으로 쓴 장이 아니라 보던 장으로. 처음 여는 강의만 마지막 장으로.
  const atStore = `recaller:lecture-at:${genId}`;
  useEffect(() => { void load().then((l) => { if (!l) return; setSeen(new Set(l.filter((a) => a.status === "done").flatMap((a) => a.steps.flatMap((s) => [`${a.id}:${s.n}`, ...s.asks.map((_, k) => `${a.id}:${s.n}:${k}`)])))); const sl = slotsOf(l);
    let saved: string | null = null; try { saved = localStorage.getItem(atStore); } catch { /* storage off */ }
    if (saved && sl.some((x) => x.key === saved)) setAtKey(saved); else if (sl.length) setAtKey(sl[sl.length - 1].key); }); }, [genId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (atKey) try { localStorage.setItem(atStore, atKey); } catch { /* storage off */ } }, [atKey, atStore]);
  useEffect(() => { if (!writing) return; const t = setTimeout(() => void load(), 400); return () => clearTimeout(t); }); // 쓰는 동안 0.4초마다
  const post = (body: Record<string, unknown>) => call(base, body).then(() => load()).catch((e) => setError(errorText(e)));
  const slots = areas ? slotsOf(areas) : [];
  // 걸음 0(아직 첫 걸음 표시가 안 온 영역)에 있다가 첫 걸음이 오면 그 영역의 첫 걸음으로
  const found = slots.findIndex((s) => s.key === atKey);
  // 찾는 장이 없으면(아직 안 왔거나 영역을 다시 쓰는 중) 같은 영역에서 그 번호 이하의 마지막 장 — 마지막 장으로 튀지 않게
  const [wantArea, wantN] = atKey ? [atKey.slice(0, atKey.lastIndexOf(":")), Number(atKey.slice(atKey.lastIndexOf(":") + 1))] : ["", 0];
  const sameArea = slots.map((s, i) => [s, i] as const).filter(([s]) => s.area.id === wantArea);
  const near = sameArea.filter(([s]) => (s.step?.n ?? 0) <= Math.max(wantN, 1)).at(-1)?.[1] ?? sameArea[0]?.[1] ?? -1;
  const atIdx = Math.max(0, found >= 0 ? found : near >= 0 ? near : slots.length - 1);
  const cur = slots[atIdx];
  const nextArea = cur && areas ? areas[cur.ai + 1] : undefined;
  // 다음 영역은 지금 영역을 다 쓴 뒤 하나만 미리
  const curArea = cur?.area;
  useEffect(() => { if (curArea?.status === "done" && nextArea && !nextArea.status) void call(base, { action: "area", section: nextArea.id }).then(() => load()).catch(() => undefined); }, [curArea?.id, curArea?.status, nextArea?.id, nextArea?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (i: number) => { const s = slots[i]; if (!s) return; setDir(i < atIdx ? "prev" : "next"); setAtKey(s.key); setQ(""); };
  const liveStep = (s: L3Slot | undefined) => Boolean(s?.area.status === "writing" && s.step && s.area.steps[s.area.steps.length - 1]?.n === s.step.n);
  const curLive = liveStep(cur);
  const canPrev = atIdx > 0;
  const hasNextSlot = atIdx < slots.length - 1;
  const canNext = Boolean(cur && !curLive && cur.step && (hasNextSlot || (cur.area.status === "done" && nextArea)));
  const goNext = () => { if (!canNext) return; if (hasNextSlot) go(atIdx + 1); else if (nextArea) { if (!nextArea.status) void post({ action: "area", section: nextArea.id }); setDir("next"); setAtKey(`${nextArea.id}:0`); } };
  const goPrev = () => { if (canPrev) go(atIdx - 1); };
  // 11/11 사용자 "위에 바 덩어리 눌러서 그쪽 덩어리로 갈 수 있게": 영역 칸을 누르면 그 영역의 첫 장으로(아직 안 쓴 영역이면 쓰기 시작).
  const jumpArea = (i: number) => {
    const a = areas?.[i]; if (!a || !cur || i === cur.ai) return;
    setDir(i < cur.ai ? "prev" : "next"); setQ("");
    const first = slots.findIndex((x) => x.ai === i);
    if (first >= 0) { setAtKey(slots[first].key); return; }
    if (!a.status) void post({ action: "area", section: a.id });
    setAtKey(`${a.id}:0`);
  };
  const keys = useRef({ goNext, goPrev });
  useEffect(() => { keys.current = { goNext, goPrev }; });
  useEffect(() => {
    const on = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight") keys.current.goNext(); else if (e.key === "ArrowLeft") keys.current.goPrev(); };
    window.addEventListener("keydown", on); return () => window.removeEventListener("keydown", on);
  }, []);
  if (areas === undefined) return <p className="small muted mm6-wait">불러오는 중…</p>;
  if (!areas) return <p className="small bad">{error || "강의를 열 수 없어요."}</p>;
  if (!areas.length) return <p className="small muted">강의할 영역이 없어요.</p>;
  const begin = () => { setStarting(true); void post({ action: "area", section: areas[0].id }); setAtKey(`${areas[0].id}:0`); };
  if (!slots.length || !cur) return <div className="lc3-empty">
    <p className="lc3-empty-title">강사와 함께 한 장씩 넘기며 공부해요</p>
    <p className="small muted">영역 {areas.length}개 · 강사가 영역마다 이야기를 이어 설명하고, 설명이 끝난 자리에 기억 카드를 띄워요. 모르는 게 있으면 그 장 밑에 물어보세요.</p>
    {error ? <p className="small bad">{error}</p> : null}
    {starting && !error ? <p className="small muted lc3-starting"><span className="lc2-caret" /> 강사가 첫 장을 쓰고 있어요 (10초쯤)</p> : <button className="btn primary" onClick={begin}>강의 시작</button>}</div>;
  const area = cur.area, step = cur.step;
  const isLastOfArea = Boolean(step && area.status === "done" && area.steps[area.steps.length - 1]?.n === step.n);
  const allText = area.steps.map((s) => s.text).join("\n");
  const leftover = isLastOfArea ? area.cards.filter((cid) => !allText.includes(`⟦카드 ${cid}⟧`) && !new RegExp(`⟦카드\\s*${cid.replace(/\./g, "\\.")}\\s*⟧`).test(allText)) : [];
  const nextSlot = slots[atIdx + 1];
  // 지금 영역을 아직 쓰는 중이면 다음 장 제목을 모른다(다음 영역 이름을 띄우지 않는다)
  const moreHere = area.status === "writing" && !nextSlot;
  const nextLabel = nextSlot?.step ? (nextSlot.ai === cur.ai ? nextSlot.step.title : nextSlot.area.title) : !moreHere && nextArea ? nextArea.title : "";
  const nextKind = nextSlot ? (nextSlot.ai === cur.ai ? "다음 장" : "다음 영역") : moreHere ? "다음 장" : nextArea ? "다음 영역" : "다음 장";
  return (
    <div className="lc3">
      <div className="lc3-bar">
        <button className="lc3-arrow" disabled={!canPrev} onClick={goPrev} aria-label="이전 장">‹</button>
        <div className="lc3-progress">{areas.map((a, i) => <button key={a.id} className={`lc3-segbtn${i === cur.ai ? " on" : ""}`} title={`영역 ${i + 1}. ${a.title}`} aria-label={`영역 ${i + 1}. ${a.title}로 가기`} onClick={() => jumpArea(i)}>
          <span className={`lc3-seglabel${i === 0 ? " first" : i === areas.length - 1 ? " last" : ""}`} aria-hidden><span className="lc3-segnum num">{i + 1}</span>{a.title.replace(/\s*\([^)]*\)\s*$/, "")}
            {i === cur.ai && step ? <span className="lc3-segstep num">{area.steps.findIndex((x) => x.n === step.n) + 1}/{area.steps.length}{area.status === "writing" ? "…" : ""}</span> : null}</span>
          <span className={`lc3-seg${i < cur.ai ? " done" : i === cur.ai ? " on" : ""}`}>
          {i === cur.ai && area.steps.length && step ? <span className="lc3-progress-fill" style={{ width: `${(area.steps.findIndex((s) => s.n === step.n) + 1) / Math.max(area.steps.length, 1) * 100}%` }} /> : null}</span></button>)}</div>
        <span className="lc3-count num">영역 {cur.ai + 1}/{areas.length}</span>
        <button className="lc3-arrow" disabled={!canNext} onClick={goNext} aria-label="다음 장">›</button>
      </div>
      <section key={cur.key} className={`lc3-box lc3-in-${dir}`}>
        <header className="lc3-head">
          <span className="lc3-step num">{step ? step.n : "…"}</span>
          <div className="lc3-headtext"><span className="lc3-area"><Rich text={area.title} /></span><h3 className="lc3-title">{step?.title ? <Rich text={step.title} /> : step ? "" : "강의를 준비하고 있어요"}</h3></div>
          {writing ? <button className="lc3-stop" onClick={() => void post({ action: "stop" })}>멈추기</button> : null}
        </header>
        {step ? <div className="lc3-say">
          <SmoothLecture key={cur.key} genId={genId} text={step.text} live={curLive} animate={!seen.has(cur.key)} byId={byId} onPage={onPage} onSeen={() => markSeen(cur.key)} />
        </div> : <div className="lc3-wait"><span className="lc2-caret" /> 강사가 이 영역의 첫 장을 쓰고 있어요</div>}
        {area.status === "failed" && (curLive || isLastOfArea || !step) ? <p className="small bad">설명을 다 받지 못했어요. <button className="linkish" onClick={() => void post({ action: "again", section: area.id })}>이 영역 다시</button></p> : null}
        {area.status === "stopped" && (isLastOfArea || !step || area.steps[area.steps.length - 1]?.n === step?.n) ? <p className="small muted">멈췄어요. <button className="linkish" onClick={() => void post({ action: "again", section: area.id })}>이 영역 처음부터 다시</button></p> : null}
        {leftover.length ? <div className="lc3-mem"><p className="small muted lc3-memnote">이 영역의 다른 기억 카드</p>
          <div className="lc3-cards">{leftover.map((cid) => byId.get(cid)).filter((x): x is Card => !!x).map((x) => <LectureCard key={x.id} genId={genId} c={x} onPage={onPage} />)}</div></div> : null}
        {step?.asks.length ? <div className="lc3-thread">{step.asks.map((a, k) => <div key={k} className="lc3-qa">
          <p className="lc3-q">{a.q}</p>
          <div className="lc3-a"><SmoothLecture genId={genId} text={a.a} live={a.status === "writing"} animate={!seen.has(`${cur.key}:${k}`)} byId={byId} onPage={onPage} onSeen={() => markSeen(`${cur.key}:${k}`)} /></div></div>)}</div> : null}
        {step ? <form className="lc3-ask" onSubmit={(e) => { e.preventDefault(); if (!q.trim() || curLive) return; void post({ action: "ask", section: area.id, step: step.n, q }); setQ(""); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={curLive ? "이 장 설명이 끝나면 물어볼 수 있어요" : "여기서 모르는 걸 물어보세요"} disabled={curLive} />
          <button className="lc3-send" disabled={!q.trim() || curLive} aria-label="묻기">↑</button></form> : null}
      </section>
      <div className="lc3-foot">
        {canNext || curLive || !step ? <button className="lc3-next" disabled={!canNext} onClick={goNext}><span className="small">{moreHere ? "다음 장 쓰는 중" : nextKind}</span>{nextLabel ? <b><Rich text={nextLabel.replace(/\(.*?\)/g, "").trim()} /></b> : null}<span aria-hidden>›</span></button>
          : <span className="small muted">강의 끝</span>}
      </div>
    </div>);
}
