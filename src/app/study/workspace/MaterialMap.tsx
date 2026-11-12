"use client";
// 자료 지도 (2026-10-29): one material on one screen — the outline, under each section its knowledge in its own shape,
// and the learner's state on each. Page reading is for the first pass; this is for the second pass and the night before.
// Data: GET /api/study-map/<material> (src/lib/study/material-map.ts). Opened from the PDF reader's bar.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { call, errorText } from "./api";
import { RichInline as Rich } from "./Rich";
import { FlashCards } from "./map/flash";
import { LecturePane } from "./map/lecture";
import { DigestLite, LiveBoard, LiveData, Step, Steps, Summary, SummaryPane } from "./map/live";
import { Answer, Body, Card, CardDetails, FigureView, MatMap, OldMore, RoleChip, STATE, isFlowCard, range, roleClass, roleOfCard, rowLine } from "./map/shape";
import { OutlinePane, StemPane } from "./map/stem";
import { StructurePane } from "./map/structure";


// 사용자 10/30: the map is where a material is studied (no reading screen): 원문 opens one page over it, 문제 풀기 starts that
// page's questions, and a material made without questions gets them here (문제 만들기).
export default function MaterialMap({ genId, onPage, onPractice, onPracticeAll, practiceLeft, onMakeQuestions, onClose, embedded, extra }: { genId: string; onPage: (page: number) => void;
  /** 공부 탭 오른쪽에 바로 (11/12 사용자 "자료 지도 화면을 버리자"): 덮는 화면이 아니라 칸 안에. 닫기 없음, 기억 카드 목록은 기억 탭에서(만드는 중일 때만 보임) */
  embedded?: boolean;
  /** 머리 오른쪽에 더 붙일 단추(공부 탭: 만든 때 고르기 · 푼 기록 · 기억 보기) */
  extra?: ReactNode;
  /** 누르면 실제로 풀 문제 수 (11/12 점검 7번: 지도가 센 문제 수와 연습에 붙은 수가 달랐다) */
  practiceLeft?: () => number;
  onPractice?: (page: number, cardId: string) => void;
  /** 만든 문제부터 풀기 (11/6): the questions made so far, even while the material is still being made. */
  onPracticeAll?: () => void;
  onMakeQuestions?: () => Promise<boolean>; onClose: () => void }) {
  const [map, setMap] = useState<MatMap | null>(null);
  const [asking, setAsking] = useState(false);
  const [reload, setReload] = useState(0);
  const [live, setLive] = useState<LiveData | null>(null);
  const [board, setBoard] = useState<"live" | "leaving" | "off">("off");
  const [error, setError] = useState("");
  const [only, setOnly] = useState<"all" | "unknown" | "new">("all");
  // 11/6 사용자: 목차별·개념별을 빼고 위에 [요약 | 지식] 두 탭. 지식은 목차(자료의 순서)로만 보인다.
  const view = "outline" as const;
  // 11/9 사용자 "기존 목록형 탭으로 돌아가지 않게": 고른 탭을 기억하고(원문을 보고 돌아와도, 다시 열어도), 불러오는 동안 [기억] 목록으로 떨어지지 않는다.
  type Tab = "summary" | "structure" | "knowledge" | "lecture";
  const [tab, setTabState] = useState<Tab | null>(() => { try { const t = localStorage.getItem("recaller:map-tab"); return t === "summary" || t === "structure" || t === "knowledge" || t === "lecture" ? t : null; } catch { return null; } });
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem("recaller:map-tab", t); } catch { /* storage off */ } };
  const [summary, setSummary] = useState<Summary | null | undefined>(undefined);
  const [digest, setDigest] = useState<DigestLite | null | undefined>(undefined);
  const [coreOnly, setCoreOnly] = useState(false);
  const [flash, setFlash] = useState<Card[] | null>(null); // 플래시카드로 풀기(11/11)
  // 뒤로 한 칸(11/11): 앱이 recaller:back을 보내면 지도 안에서 열린 것 하나만 닫는다(없으면 앱이 지도를 닫는다).
  const back = useRef<() => boolean>(() => false);
  useEffect(() => { const on = (e: Event) => { if (back.current()) e.preventDefault(); }; window.addEventListener("recaller:back", on); return () => window.removeEventListener("recaller:back", on); }, []);
  // 첫 화면은 목차만 (사용자 10/30): every group starts folded; a group opens to one line per piece of knowledge, a line to its card.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [openCard, setOpenCard] = useState<string | null>(null);
  useEffect(() => { back.current = () => { if (flash) { setFlash(null); setReload((k) => k + 1); return true; } if (openCard) { setOpenCard(null); return true; } return false; }; });
  // While the material is still being made, the map refills every few seconds (cards, then 핵심·주제·연결).
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined, misses = 0;
    // Right after the start there are no cards yet (the server answers 422/404 until the first page is organized): keep
    // trying quietly for about two minutes before showing why.
    const load = () => call<{ map: MatMap }>(`/api/study-map/${genId}`)
      .then((r) => { if (!alive) return; setMap(r.map); setError(""); if (["queued", "running"].includes(r.map.status)) timer = setTimeout(load, 3000); }) // 11/5: 멈춘(이어 만들기) 실행은 다시 묻지 않음
      .catch((e) => { if (!alive) return; if (++misses > 40) setError(errorText(e)); else timer = setTimeout(load, 3000); });
    load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [genId, reload]);
  // 실시간 카드: the board shows while pages are still being written; when the last page is in, it gives way to the map.
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined, since = 0, misses = 0;
    let acc: LiveData | null = null;
    const poll = () => call<LiveData>(`/api/study-map/${genId}/live?since=${since}`).then((r) => {
      if (!alive) return;
      const pages = new Map((acc?.pages ?? []).map((p) => [p.page, p]));
      for (const p of r.pages) pages.set(p.page, p);
      acc = { ...r, outline: r.outline.length ? r.outline : acc?.outline ?? [], pages: [...pages.values()] };
      since = r.now - 1500; // a little overlap: a page written between the read and the answer is not missed
      // Every page in (or the run stopped, or pages it had made before a restart are not streamed again): the map takes over.
      const all = (acc.outline.length > 0 && acc.outline.every((o) => pages.get(o.page)?.done)) || !["queued", "running"].includes(r.status);
      setLive(acc);
      if (r.summary !== undefined) setSummary(r.summary);
      // Nothing written yet: a run still reading its pages is waited for; a finished or stopped one has no board.
      if (!r.live && !pages.size) { if (!["queued", "running"].includes(r.status) || ++misses > 120) { setBoard("off"); return; } timer = setTimeout(poll, 800); return; }
      else if (all) { setBoard((b) => (b === "live" ? "leaving" : b)); setTimeout(() => { if (alive) setBoard("off"); }, 900); return; }
      else setBoard("live");
      timer = setTimeout(poll, 350);
    }).catch(() => { if (alive) timer = setTimeout(poll, 1500); });
    poll();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [genId]);
  // 요약은 카드가 다 써진 뒤에도 이어 쓰일 수 있어, 끝날 때까지 따로 받는다.
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined, idle = 0;
    const poll = () => call<LiveData>(`/api/study-map/${genId}/live?since=${Date.now() + 60_000}`).then((r) => {
      if (!alive) return;
      setSummary(r.summary ?? null);
      setDigest(r.digest ?? null);
      const running = ["queued", "running"].includes(r.status);
      // 목차 (11/6): the outline streams and cards attach to it, so the live state is read while the run goes on.
      if (r.summary?.status === "writing" || (running && ++idle < 600)) timer = setTimeout(poll, r.summary?.status === "writing" ? 600 : 1200);
    }).catch(() => { if (alive) timer = setTimeout(poll, 2000); });
    poll();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [genId]);
  // Esc는 앱의 뒤로 한 칸(backOne → recaller:back)이 맡는다: 지도 안에서 열린 것이 있으면 그것만 닫고, 없으면 앱이 지도를 닫는다(11/11).
  const titles = useMemo(() => new Map(map?.sections.flatMap((s) => s.cards.map((c) => [c.id, c.title] as const)) ?? []), [map]);
  const everyCard = useMemo(() => map?.sections.flatMap((s) => s.cards) ?? [], [map]);
  // Where a card leads (→) and what leads to it (←), once each.
  const next = useMemo(() => { const m = new Map<string, Array<{ to: string; what: string; back: boolean }>>();
    for (const c of map?.chains ?? []) { m.set(c.from, [...(m.get(c.from) ?? []), { to: c.to, what: c.what, back: false }]); if (c.by === "meaning") m.set(c.to, [...(m.get(c.to) ?? []), { to: c.from, what: c.what, back: true }]); }
    return m; }, [map]);
  // 개념별: the whole-material pass's larger ideas, across sections (cards without one stay under 기타).
  const groups = useMemo(() => {
    if (!map) return [];
    // 목차별: a section the engine cut only for size (same title, next pages) shows as one with the one before.
    if (view === "outline" || !map.topics?.length) {
      const base = (t: string) => t.replace(/\s*\(이어서\)$/, "").trim().toLowerCase();
      const merged: Array<{ key: string; title: string; pages: number[]; cards: Card[] }> = [];
      for (const s of map.sections) {
        const last = merged.at(-1);
        if (last && base(last.title) === base(s.title)) { last.pages = [...last.pages, ...s.pages]; last.cards = [...last.cards, ...s.cards]; }
        else merged.push({ key: s.id, title: s.title.replace(/\s*\(이어서\)$/, ""), pages: [...s.pages], cards: [...s.cards] });
      }
      return merged;
    }
    const all = map.sections.flatMap((s) => s.cards);
    const named = [...map.topics, ...(all.some((c) => !c.topic) ? ["기타"] : [])];
    return named.map((t) => { const cards = all.filter((c) => (c.topic ?? "기타") === t); return { key: `t:${t}`, title: t, pages: [...new Set(cards.flatMap((c) => c.pages))].sort((a, b) => a - b), cards }; });
  }, [map, view]);
  const groupOf = (id: string) => groups.find((g) => g.cards.some((c) => c.id === id))?.key;
  const toggleGroup = (key: string) => setOpenGroups((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const jump = (id: string) => {
    const g = groupOf(id);
    if (g) setOpenGroups((prev) => new Set(prev).add(g));
    setOpenCard(id);
    setTimeout(() => { const el = document.getElementById(`mm3-${id}`); if (!el) return; el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1200); }, 60);
  };
  // 단계: 자료 읽기 → 요약 → 지식 카드 → 핵심·연결 정리 → (문제). 있는 정보로만 판단한다(엔진이 따로 알려 주지 않아도).
  const running = map ? map.status !== "done" : true;
  const pagesIn = live ? live.outline.filter((o) => live.pages.find((p) => p.page === o.page)?.done).length : 0;
  const cardsN = map?.counts.cards ?? 0;
  const steps: Step[] = [
    { label: "자료 읽기", state: live?.outline.length || cardsN || summary?.text ? "done" : "now" },
    ...(summary ? [{ label: "요약", state: (summary.status === "done" || summary.status === "failed" ? "done" : summary.status === "writing" ? "now" : running ? "wait" : "done") as Step["state"],
      note: summary.status === "failed" ? "못 씀" : summary.ms ? `${Math.round(summary.ms / 1000)}초` : undefined }]
      : [{ label: digest?.skeleton ? "줄기" : "목차", state: (digest?.skeleton?.status === "done" ? "done" : digest?.skeleton?.text ? "now" : running ? "now" : "done") as Step["state"],
        note: digest?.skeleton?.topics.length ? `주제 ${digest.skeleton.topics.length}` : undefined }]),
    { label: "기억 카드", state: !running || map?.topics?.length ? "done" : cardsN || board === "live" ? "now" : "wait",
      note: cardsN ? `${cardsN}개` : board === "live" && live?.outline.length ? `${pagesIn}/${live.outline.length}쪽` : undefined },
    // 줄기 모드(목차가 있는 실행)는 자료 전체 정리 단계가 없다 (11/12 점검 9번: 없는 단계가 보였다)
    ...(digest?.skeleton ? [] : [{ label: "핵심·연결 정리", state: (map?.topics?.length || !running ? "done" : cardsN && board === "off" ? "now" : "wait") as Step["state"] }]),
    ...(map && !map.questionsLater ? [{ label: "문제", state: (!running ? "done" : map.topics?.length ? "now" : "wait") as Step["state"], note: map.counts.questions ? `${map.counts.questions}개` : undefined }] : []),
  ];
  // 목차가 있으면(엔진의 목차 → 카드) 첫 탭은 목차, 예전 실행의 정리 글은 요약으로 그대로 보인다.
  const hasOutline = Boolean(digest?.skeleton && (digest.skeleton.topics.length || digest.skeleton.text));
  const firstLabel = summary && !hasOutline ? "요약" : "줄기";
  const noFirst = digest !== undefined && summary !== undefined && !hasOutline && !(summary && (summary.text || summary.status === "writing"));
  const picked = (tab === "structure" && !(hasOutline || !summary)) || (tab === "lecture" && running) ? null : tab;
  const knowTab = !embedded || running || noFirst;
  const shownTab: Tab = (picked === "knowledge" && !knowTab ? null : picked) ?? (noFirst ? "knowledge" : "summary");
  const tabs = <div className="ws-seg mm5-tabs" role="group" aria-label="자료 지도 보기">{([["summary", firstLabel], ...(hasOutline || !summary ? [["structure", "구조"] as const] : []), ...(knowTab ? [["knowledge", "기억"] as const] : []), ...(running ? [] : [["lecture", "강의"] as const])] as const).map(([k, label]) =>
    <button key={k} className={shownTab === k ? "on" : ""} aria-pressed={shownTab === k} onClick={() => setTab(k)}>{label}{k === "knowledge" && running ? <span className="mm5-badge">만드는 중</span> : null}</button>)}</div>;
  // 11/12 점검 11번: 다 만든 지도를 여는 몇 초 동안 "목차가 나오는 중"이 떠서 다시 만드는 것처럼 보였다 — 만드는 중일 때만 단계를 보인다.
  if (!map && !error && (!live || !["queued", "running"].includes(live.status))) return <div className="mm2 mm3"><div className="mm2-head"><div>{embedded ? null : <p className="eyebrow">자료 지도</p>}<b>불러오는 중…</b></div>{embedded ? extra : <button className="btn ghost small" onClick={onClose}>닫기</button>}</div></div>;
  if (!map) return <div className="mm2 mm3"><div className="mm2-head"><div>{embedded ? null : <p className="eyebrow">자료 지도</p>}<b>{hasOutline ? "목차가 나오는 중…" : "자료를 읽는 중…"}</b></div>{embedded ? extra : <button className="btn ghost small" onClick={onClose}>닫기</button>}</div>
    <Steps steps={steps} />{tabs}
    {shownTab === "summary" ? (hasOutline || !summary ? <OutlinePane genId={genId} digest={digest} cards={[]} making onPage={onPage} onPractice={onPractice} /> : <SummaryPane summary={summary} making />)
      : shownTab === "structure" ? <p className="small muted">기억 카드가 다 만들어지면 구조를 만들 수 있어요.</p>
      : board !== "off" && live ? <LiveBoard data={live} />
      : <p className="small muted">{error || "목차 항목마다 기억을 만드는 중이에요. 다 되면 여기에 목차별로 보여요."}</p>}</div>;
  const shown = (c: Card) => !isFlowCard(c) && (!coreOnly || c.core) && (only === "all" || (only === "unknown" ? c.state === "unknown" : c.state === "new" || c.state === "met"));
  const n = map.counts;
  const making = map.status !== "done";
  const visible = groups.map((g) => ({ ...g, list: g.cards.filter(shown) })).filter((g) => g.list.length);
  const allOpen = visible.length > 0 && visible.every((g) => openGroups.has(g.key));
  // State dots say something only once the learner has answered (all 만남 at first is one colour, noise).
  const marked = Boolean(n.unknown || n.known || n.graduated);
  return (
    <div className={`mm2 mm3${shownTab === "structure" && !embedded ? " mm3-wide" : ""}${embedded ? " mm3-embed" : ""}`} role={embedded ? undefined : "dialog"} aria-label="자료 지도">
      <div className="mm2-head">
        <div>{embedded ? null : <p className="eyebrow">자료 지도</p>}<b>{map.title.replace(/\.pdf$/i, "")}</b>
          <span className="small muted"> · {map.pages}쪽 · 기억 {n.cards}{n.core !== undefined && map.topics?.length ? ` · 핵심 ${n.core}` : ""}{map.questionsLater ? "" : ` · 문제 ${n.questions}`}</span>
          {making ? <span className="small mm3-making"> · {board !== "off" ? "카드 쓰는 중" : map.questionsLater ? (n.cards ? "기억 정리 중" : "자료 읽는 중") : map.topics?.length ? "문제 만드는 중" : n.cards ? "기억 정리 중" : "자료 읽는 중"}…</span> : null}</div>
        <span className="row small">
          {map.questionsLater && !making && n.cards && onMakeQuestions ? <button className="btn small primary" disabled={asking} title="기억마다 확인 문제를 만들어 연습·복습에 붙여요"
            onClick={() => { setAsking(true); void onMakeQuestions().then((ok) => { if (ok) setReload((k) => k + 1); }).finally(() => setAsking(false)); }}>{asking ? "시작하는 중…" : "문제 만들기"}</button> : null}
          {!map.questionsLater && n.questions && onPracticeAll ? <button className="btn small primary" title={making ? "지금까지 만들어진 문제부터 풀어요. 나머지는 계속 만들어져요." : "이 자료의 문제를 풀어요."}
            onClick={onPracticeAll}>{making ? `만든 문제부터 풀기 (${practiceLeft?.() ?? n.questions})` : `문제 풀기 (${practiceLeft?.() ?? n.questions})`}</button> : null}
          {embedded ? extra : <button className="btn ghost small" onClick={onClose}>닫기</button>}
        </span>
      </div>
      {making ? <Steps steps={steps} /> : null}
      {tabs}
      {shownTab === "summary" ? (hasOutline || !summary ? <StemPane genId={genId} digest={digest} cards={map.sections.flatMap((x) => x.cards)} making={making} onPage={onPage} onPractice={onPractice} />
        : <SummaryPane summary={summary} making={making} />)
      : shownTab === "structure" ? <StructurePane genId={genId} cards={map.sections.flatMap((x) => x.cards)} chains={map.chains} making={making} onPage={onPage} onPractice={onPractice} />
      : shownTab === "lecture" ? <LecturePane genId={genId} cards={map.sections.flatMap((x) => x.cards)} onPage={onPage} /> : <>
      {making ? <p className="small mm5-note-line">기억은 목차 항목마다 조금씩 만들어져요. 다 되기 전에도 지금까지 된 것을 볼 수 있어요.</p> : null}
      <div className="row small mm3-tools">
        {map.topics?.length ? <label className="row small"><input type="checkbox" checked={coreOnly} onChange={(e) => setCoreOnly(e.target.checked)} /> 핵심만</label> : null}
        {n.unknown || n.known || n.graduated ? <div className="ws-seg">{([["all", "전체"], ["unknown", "다시 볼 것"], ["new", "아직 확인 안 한 것"]] as const).map(([k, label]) =>
          <button key={k} aria-pressed={only === k} onClick={() => setOnly(k)}>{label}</button>)}</div> : null}
        <span className="cs-gap" />
        {visible.length && !flash ? <button className="linkish small" onClick={() => setOpenGroups(allOpen ? new Set() : new Set(visible.map((g) => g.key)))}>{allOpen ? "모두 접기" : "모두 펼치기"}</button> : null}
        {visible.length && !making && !flash ? <button className="btn small primary" onClick={() => setFlash(visible.flatMap((g) => g.list))} title="지금 보이는 기억을 카드 한 장씩 떠올려 보고, 안다/모른다를 기억에 남겨요">플래시카드로 풀기 ({visible.reduce((a, g) => a + g.list.length, 0)})</button> : null}
      </div>
      {flash ? <FlashCards genId={genId} title={map.title} cards={flash} onPage={onPage} onClose={() => { setFlash(null); setReload((k) => k + 1); }} /> : null}
      {flash ? null : board !== "off" && live ? <div className={board === "leaving" ? "mm4-leaving" : undefined}><LiveBoard data={live} /></div> : <div className="mm4-arrive">
      {map.principles?.length ? <section className="mm3-principles" aria-label="이 자료를 꿰는 원리">
        <p className="mm3-label">이 자료를 꿰는 원리</p>
        {map.principles.map((p, i) => <div key={i} className="mm3-principle">
          <b><Rich text={p.title} /></b> <span><Rich text={p.line} /></span>
          <div className="row small mm3-uses">{p.cardIds.filter((id) => titles.has(id)).map((id) => <button key={id} className="chip" onClick={() => jump(id)}><Rich text={titles.get(id)!} /></button>)}</div>
        </div>)}
      </section> : null}
      <ol className="mm3-toc">
        {visible.map((g, gi) => {
          const open = openGroups.has(g.key);
          const core = g.list.filter((c) => c.core).length;
          return (
            <li key={g.key} className={`mm3-group${open ? " open" : ""}`}>
              <button className="mm3-ghead" aria-expanded={open} onClick={() => toggleGroup(g.key)}>
                <span className="mm3-caret" aria-hidden>{open ? "▾" : "▸"}</span>
                <span className="mm3-num">{gi + 1}</span>
                <span className="mm3-gtext"><b className="mm3-gtitle"><Rich text={g.title} /></b>
                  {map.topicNotes?.[g.title] ? <span className="mm3-gist"><Rich text={map.topicNotes[g.title]} /></span> : null}</span>
                <span className="small muted">{range(g.pages)}</span>
                <span className="cs-gap" />
                <span className="small muted">{map.topics?.length && core ? `★${core} · ` : ""}{g.list.length}개</span>
                {marked ? <span className="mm2-dots" aria-hidden>{g.list.map((c) => <span key={c.id} className={`dot ${STATE[c.state][1]}`} />)}</span> : null}
              </button>
              {open ? <ul className="mm3-items">
                {g.list.map((c) => {
                  const isOpen = openCard === c.id;
                  const links = (next.get(c.id) ?? []).filter((x) => titles.has(x.to)).slice(0, 4);
                  return (
                    <li key={c.id} id={`mm3-${c.id}`} className={`mm3-item st-${c.state}${c.core ? " core" : ""}${isOpen ? " open" : ""}${roleClass(roleOfCard(c))}`}>
                      <button className="mm3-line" aria-expanded={isOpen} onClick={() => setOpenCard(isOpen ? null : c.id)}>
                        <span className="mm3-star" aria-label={c.core ? "핵심" : undefined}>{map.topics?.length && c.core ? "★" : ""}</span>
                        <span className="mm3-name">{c.memo?.role ? <RoleChip role={roleOfCard(c)} /> : null}<Rich text={c.title} /></span>
                        {/* 11/11 사용자 "공식만 박은 느낌": 기억 카드(줄기 모드)는 줄에 식 대신 답 한 줄을 */}
                        {/* 펼치면 아래 A에 같은 글이 나오니 줄의 한 줄은 숨긴다(11/12) */}
                        <span className="mm3-key">{isOpen ? null : <Rich text={rowLine(c)} />}</span>
                        {marked ? <span className={`dot ${STATE[c.state][1]}`} title={STATE[c.state][0]} /> : <span />}
                      </button>
                      {isOpen ? <div className="mm3-detail">
                        <div className="mm3-dhead">
                          <span className="mm3-kind">{c.kind}</span>
                          {c.core ? <span className="mm3-kind core">핵심</span> : null}
                          {/* [경계] 2026-11-02 A (점검_UIUX화면연결 4번): 지도에서 이 지식의 내 상태와 지식창으로 가는 길 */}
                          {c.state !== "new" && c.state !== "met" && c.state !== "unknown" ? <span className={`chip ${STATE[c.state][1]}`}>{STATE[c.state][0]}</span> : null}
                          <span className="cs-gap" />
                          {c.pages.map((p) => <button key={p} className="btn ghost small" onClick={() => onPage(p)} title="이 쪽 원문으로">원문 p.{p}</button>)}
                        </div>
                        {/* 11/11 사용자 "눌렀을 때 제목이 안 뜨고 …으로 잘림, 카드만 봐서는 이해가 안 됨": 펼치면 제목 전체 → 질문 → 답 한 줄 → 핵심(모양·덧붙임) → 자세히 */}
                        {/* 11/11 사용자 "질문과 답이 세트로 안 보임": 질문·답을 한 상자에(Q·A), 풀이는 상자 밖에 이름을 달아 따로 */}
                        {c.memo ? <div className="mm3-front"><p className="mm3-ftitle"><Rich text={c.title} /></p>
                          {c.memo.question || c.memo.line ? <div className="mm3-qa">
                            {c.memo.question ? <p className="lc3-cq"><span className="lc3-qtag">Q</span><Rich text={c.memo.question} /></p> : null}
                            {c.memo.answer ? <Answer text={c.memo.answer} /> : c.memo.line ? <p className="lc3-ca mm3-a"><span className="lc3-qtag a">A</span><Rich text={c.memo.line} /></p> : null}</div> : null}
                          </div> : null}
                        {c.memo?.answer ? <CardDetails items={c.memo.details} /> : c.memo?.line ? <OldMore idea={c.memo.idea} shape={c.shape} details={c.memo.details} /> : <Body s={c.shape} />}
                        <FigureView genId={genId} c={c} onPage={onPage} all={everyCard} onCard={jump} />
                        {links.length ? <div className="mm3-rel"><span className="mm3-tag">이어지는 기억</span>
                          <div className="mm3-relchips">{links.map((x, i) =>
                            <button key={i} className="mm3-relchip" onClick={() => jump(x.to)} title={x.what || undefined}>
                              <span className="mm3-arrow">{x.back ? "←" : "→"}</span><Rich text={titles.get(x.to) ?? ""} />{x.what && x.what.length <= 20 ? <em>{x.what}</em> : null}</button>)}</div></div> : null}
                        {c.same.length || c.questions ? <div className="mm3-dfoot">
                          {c.same.length ? <span className="small muted">같은 내용: {c.same.map((x) => range(x.pages)).join(", ")}</span> : null}
                          <span className="cs-gap" />
                          {c.questions ? <button className="btn small primary" onClick={() => onPractice ? onPractice(c.pages[0], c.id) : onPage(c.pages[0])}>이 기억 문제 풀기 ({c.questions})</button> : null}
                        </div> : null}
                      </div> : null}
                    </li>
                  );
                })}
              </ul> : null}
            </li>
          );
        })}
      </ol>
      {!visible.length ? <p className="small muted">{making ? "기억을 정리하는 중… 첫 카드까지 5~10초쯤 걸려요." : "고른 조건에 맞는 기억이 없어요."}</p> : null}
      </div>}
      </>}
    </div>
  );
}

/* ---------- 기억 도서관의 자료 한 편 (11/11 사용자 "옛 기억 시스템 말고 최신 기억으로") ----------
 * 자료 지도와 같은 데이터(/api/study-map/<id>)를 읽는다: 줄기 영역 순서의 기억 카드(질문·답·풀이·모양) + 카드마다 기억 저장소의 내 상태·다음 복습.
 * 기억 저장소 항목(옛 지식 줄: 같은 이름이면 다른 실행끼리 합쳐짐)을 그대로 늘어놓던 목록을 대신한다. 기록·복습 날짜는 그대로 저장소가 맡는다. */
const known = (c: Card) => c.state === "known" || c.state === "graduated";
const dueNow = (c: Card) => Boolean(c.dueAt && Date.parse(c.dueAt) <= Date.now());
function ShelfCard({ genId, c, onPage, all, onCard }: { genId: string; c: Card; onPage: (page: number) => void; all: Card[]; onCard: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const m = c.memo;
  const role = roleOfCard(c);
  return <>
    <button className={`shelf-row${open ? " on" : ""}${roleClass(role)}`} onClick={() => setOpen(!open)} aria-expanded={open}>
      <span className={`dot ${STATE[c.state][1]}`} title={STATE[c.state][0]} /><b className="shelf-t"><RoleChip role={role} /><Rich text={c.title} /></b>
      <span className="shelf-l">{open ? null : <Rich text={rowLine(c)} />}</span>
      {dueNow(c) ? <span className="shelf-due">복습 차례</span> : null}
    </button>
    {open ? <div className="shelf-card">
      {m?.question || m?.line ? <div className="mm3-qa">
        {m?.question ? <p className="lc3-cq"><span className="lc3-qtag">Q</span><Rich text={m.question} /></p> : null}
        {m?.answer ? <Answer text={m.answer} /> : m?.line ? <p className="lc3-ca mm3-a"><span className="lc3-qtag a">A</span><Rich text={m.line} /></p> : null}</div> : null}
      {m?.answer ? <CardDetails items={m.details} /> : m?.line ? <OldMore idea={m.idea} shape={c.shape} details={m.details} /> : <Body s={c.shape} />}
      <FigureView genId={genId} c={c} onPage={onPage} all={all} onCard={onCard} />
      {/* 출처(11/12 사용자 "만남 말고 출처"): 원문 구절과 쪽 — 상태는 줄 앞 점이 보여 준다 */}
      {c.quotes.length ? <p className="shelf-src small"><span className="shelf-srck">출처</span>{c.quotes.slice(0, 2).map((q, k) => <span key={k}>“{q}”</span>)}</p> : null}
      <div className="shelf-foot">{c.dueAt ? <span className="small muted">다음 복습 {new Date(c.dueAt).getMonth() + 1}/{new Date(c.dueAt).getDate()}</span> : null}<span className="cs-gap" />
        {c.pages.slice(0, 4).map((p) => <button key={p} className="btn ghost small" onClick={() => onPage(p)}>원문 p.{p}</button>)}</div>
    </div> : null}
  </>;
}
/** 기억 하나의 질문 · 답 (11/12 점검 10번): 오른쪽 기억 패널처럼 지도 밖에서도 지도·기억 탭과 같은 Q · A로 보인다. ref = `<자료 id>:<카드 id>`. */
const mapOnce = new Map<string, Promise<MatMap>>();
export function CardQA({ cardRef, fallback }: { cardRef: string; fallback?: ReactNode }) {
  const [c, setC] = useState<Card | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const genId = cardRef.split(":")[0];
    if (!mapOnce.has(genId)) mapOnce.set(genId, call<{ map: MatMap }>(`/api/study-map/${genId}`).then((r) => r.map));
    mapOnce.get(genId)!.then((m) => { if (alive) setC(m.sections.flatMap((x) => x.cards).find((x) => x.ref === cardRef) ?? null); })
      .catch(() => { mapOnce.delete(genId); if (alive) setC(null); });
    return () => { alive = false; };
  }, [cardRef]);
  const m = c?.memo;
  if (c === undefined) return null;
  if (!m?.question && !m?.answer) return <>{fallback ?? null}</>;
  return <div className="mm3-qa">
    {m.question ? <p className="lc3-cq"><span className="lc3-qtag">Q</span><Rich text={m.question} /></p> : null}
    {m.answer ? <Answer text={m.answer} /> : m.line ? <p className="lc3-ca mm3-a"><span className="lc3-qtag a">A</span><Rich text={m.line} /></p> : null}</div>;
}

export function MemoryShelf({ genId, title }: { genId: string; title: string }) {
  const [map, setMap] = useState<MatMap | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState<Card[] | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    call<{ map: MatMap }>(`/api/study-map/${genId}`).then((r) => { if (alive) { setMap(r.map); setError(""); } }).catch((e) => { if (alive) setError(errorText(e)); });
    return () => { alive = false; };
  }, [genId, reload]);
  // 원문 쪽은 자료 지도와 같은 길(그 쪽을 띄운 지도)로
  const onPage = (page: number) => window.dispatchEvent(new CustomEvent("recaller:map-open", { detail: { genId, page } }));
  if (error) return <p className="ws-err">{error}</p>;
  if (!map) return <p className="small muted">기억을 불러오는 중…</p>;
  const sections = map.sections.map((s) => ({ ...s, cards: s.cards.filter((c) => !isFlowCard(c)) })).filter((s) => s.cards.length);
  const all = sections.flatMap((s) => s.cards);
  if (flash) return <FlashCards genId={genId} title={title} cards={flash} onPage={onPage} onClose={() => { setFlash(null); setReload((k) => k + 1); }} />;
  const weak = all.filter((c) => c.state === "unknown" || dueNow(c));
  const jump = (id: string) => document.getElementById(`shelf-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  if (!all.length) return <p className="small muted">이 자료에는 아직 기억이 없어요.</p>;
  return <div className="shelf">
    <div className="shelf-sum">
      {/* 11/12 사용자 "필요 없는 건 다 빼": 아직(만남) 수는 빼고, 플래시카드를 푼 뒤에만 앎 · 몰랐음 */}
      <span><b>{all.length}</b>기억</span>{all.some(known) ? <span className="good"><b>{all.filter(known).length}</b>앎</span> : null}{all.some((c) => c.state === "unknown") ? <span className="bad"><b>{all.filter((c) => c.state === "unknown").length}</b>몰랐음</span> : null}
      {all.some(dueNow) ? <span className="now"><b>{all.filter(dueNow).length}</b>복습 차례</span> : null}
      <span className="cs-gap" />
      {weak.length && weak.length < all.length ? <button className="btn small" onClick={() => setFlash(weak)}>몰랐던 · 차례 {weak.length}장</button> : null}
      <button className="btn small primary" onClick={() => setFlash(all)}>플래시카드로 풀기 ({all.length})</button>
    </div>
    {sections.map((s, i) => <section key={s.id} className="shelf-area">
      <header className="shelf-ah"><span className="mm3-num">{i + 1}</span><b><Rich text={s.title} /></b><span className="small muted">{range(s.pages)}</span><span className="cs-gap" />
        <span className="shelf-bar" title={`${s.cards.filter(known).length}/${s.cards.length} 앎`}>{s.cards.map((c) => <i key={c.id} className={STATE[c.state][1]} />)}</span></header>
      <ul className="shelf-list">{s.cards.map((c) => <li key={c.id} id={`shelf-${c.id}`}><ShelfCard genId={genId} c={c} onPage={onPage} all={all} onCard={jump} /></li>)}</ul>
    </section>)}
  </div>;
}
