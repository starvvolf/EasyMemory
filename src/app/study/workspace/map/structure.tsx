"use client";
// 자료 지도 조각 (11/12 A 정리, MaterialMap.tsx에서 나눔): [구조] 탭: 기억을 뜻으로 묶은 집합 그림.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { call, errorText } from "../api";
import { RichInline as Rich } from "../Rich";
import { Answer, Body, Card, CardDetails, FigureView, MapState, MatMap, Shape, isFlowCard, keyLine } from "./shape";
import { CompactLite } from "./stem";

// 구조 (11/7 사용자 "목차와 구조 두 탭, 구조는 뜻으로 재배치" → 2차 "위에서 아래로 내리는 느낌, 집합으로 정리되고 가까운 것·먼 것,
// 조건이 발생 조건에서 한 번, 예방에서 한 번 더 나오는 연계까지 — 다이어그램이면 완전 다른 구조도"): src/lib/study/structure.ts가
// AI 한 번(terra)으로 묶은 것을 집합 그림으로 그린다. 큰 묶음은 나란한 큰 상자, 하위 묶음은 그 안의 상자, 카드는 상자 안의 알약.
// 묶음 사이 연결(막음·씀·이어짐·대비·예시)은 늘 보이는 선, 카드끼리 짝(구조의 짝 + 자료 전체 정리의 연결 중 묶음을 넘는 것)은
// 카드·상자에 마우스를 올리면(또는 "카드 연결 모두") 선으로. 흐름 카드는 보이지 않는다(카드 만들 때 쓰는 것, 사용자 11/7).
// 3차 (11/8 사용자 "큰 개념과 작은 개념, 대비, 모두 성립 — 위와 아래를 레이어로"): head는 상자의 대표 카드(상자 머리에 크게),
// members는 안의 것과 대표의 관계(이루는 것·갈래·모두 성립해야·차례로), versus는 나란히 견주는 카드(같은 상자면 A vs B 한 덩어리).
export type StructGroup = { id: string; name: string; parent: string; head?: string; cards: string[]; members?: string; explain: string; link?: string; role?: StructRole };
export type StructVersus = { a: string; b: string; on: string };
// 11/12 사용자 "이루는 것 · 갈래가 뭐냐": 상자 머리(대표)와 안의 것의 관계를 바로 읽히는 말로 — 구성 요소(이걸로 이뤄짐) · 종류(이것의 여러 가지)
export const MEMBER_LABEL: Record<string, string> = { 부분: "구성 요소", 종류: "종류", 모두: "모두 성립해야", 순서: "차례로" };
export const MEMBER_JOIN: Record<string, string> = { 모두: "+", 순서: "→" };
export const sameName = (a: string, b: string) => { const n = (x: string) => x.replace(/\(.*?\)|[\s·]/g, "").toLowerCase(); const x = n(a), y = n(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };
export type StructRole = "메인" | "바탕" | "곁";
export type StructEdge = { a: string; b: string; type: string; why: string };
export type StructPair = { a: string; b: string; why: string };
export type Structure = { at: string; ms: number; model: string; effort: string; unit?: "card" | "memory"; groups: StructGroup[]; edges: StructEdge[]; pairs?: StructPair[]; versus?: StructVersus[]; base?: string[]; fixes: string[] };
export function StructurePane({ genId, cards: cardList, chains: chainList, making, onPage, onPractice }: { genId: string; cards: Card[]; chains: MatMap["chains"]; making: boolean;
  onPage: (page: number) => void; onPractice?: (page: number, cardId: string) => void }) {
  const [data, setData] = useState<{ structure: Structure | null; stale: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [hover, setHover] = useState<{ card?: string; group?: string } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => { let alive = true;
    call<{ structure: Structure | null; stale: boolean }>(`/api/study-map/${genId}/structure-v2`).then((r) => { if (alive) setData(r); }).catch((e) => { if (alive) setError(errorText(e)); });
    return () => { alive = false; }; }, [genId]);
  const make = () => { setBusy(true); setError("");
    call<{ structure: Structure; stale: boolean }>(`/api/study-map/${genId}/structure-v2`, {}).then(setData).catch((e) => setError(errorText(e))).finally(() => setBusy(false)); };
  const s = data?.structure;
  // 줄기 기반 구조 (11/9): 묶은 것이 기억이면 기억을 카드 모양으로 바꿔 같은 그림에 올린다(알약 = 기억, 열면 요지·단계·근거 카드).
  const [compact, setCompact] = useState<CompactLite | null>(null);
  const [srcCard, setSrcCard] = useState<string | null>(null);
  useEffect(() => { if (s?.unit !== "memory") return; let alive = true;
    call<{ compact: CompactLite | null }>(`/api/study-map/${genId}/compact`).then((r) => { if (alive) setCompact(r.compact); }).catch(() => undefined);
    return () => { alive = false; }; }, [genId, s?.unit]);
  const cardById = useMemo(() => new Map(cardList.map((c) => [c.id, c])), [cardList]);
  const memById = useMemo(() => new Map((compact?.memories ?? []).map((m) => [m.id, m])), [compact]);
  const cards = useMemo<Card[]>(() => s?.unit !== "memory" ? cardList : (compact?.memories ?? []).map((m) => {
    // 줄기 모드로 만든 자료(11/10): 기억이 곧 카드 — 그 카드를 그대로(모양·그림까지).
    const own = m.cards.length === 1 && m.cards[0] === m.id ? cardById.get(m.id) : undefined;
    if (own) return { ...own, core: m.role === "메인" };
    const src = m.cards.map((id) => cardById.get(id)).filter((c): c is Card => !!c);
    return { id: m.id, ref: m.id, kind: m.kind, title: m.name, core: m.role === "메인",
      shape: m.steps.length ? { form: "procedure", steps: m.steps.map((x) => ({ action: x, input: "", output: "" })) } as Shape : { form: "concept", claim: m.line, reason: "", limit: "" } as Shape,
      pages: [...new Set(src.flatMap((c) => c.pages))].sort((a, b) => a - b), quotes: [], mistakes: [], takes: [], gives: [], questions: 0, same: [], state: "new" as MapState,
      ...(src.find((c) => c.figure) ? { figure: src.find((c) => c.figure)!.figure } : {}) };
  }), [s?.unit, cardList, compact, cardById]);
  const chains = useMemo(() => (s?.unit === "memory" ? [] : chainList), [s?.unit, chainList]);
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const groupOfCard = useMemo(() => new Map((s?.groups ?? []).flatMap((g) => [...(g.head ? [g.head] : []), ...g.cards].map((id) => [id, g.id] as const))), [s]);
  // Card pairs across groups: the structure's own, then the whole-material pass's links that cross a group.
  const pairs = useMemo(() => {
    const out: StructPair[] = [], seen = new Set<string>();
    const add = (a: string, b: string, why: string) => {
      const ga = groupOfCard.get(a), gb = groupOfCard.get(b);
      if (!ga || !gb || ga === gb || !byId.has(a) || !byId.has(b) || isFlowCard(byId.get(a)!) || isFlowCard(byId.get(b)!)) return;
      const k = [a, b].sort().join(">"); if (seen.has(k)) return; seen.add(k); out.push({ a, b, why });
    };
    for (const p of s?.pairs ?? []) add(p.a, p.b, p.why);
    for (const v of s?.versus ?? []) add(v.a, v.b, `대비${v.on ? ` · ${v.on}` : ""}`); // 다른 상자끼리 견주는 것은 짝 선으로
    for (const c of chains) if (c.by === "meaning" || c.by === "wording") add(c.from, c.to, c.what);
    return out;
  }, [s, chains, groupOfCard, byId]);
  const pairCount = useMemo(() => { const m = new Map<string, number>(); for (const p of pairs) { m.set(p.a, (m.get(p.a) ?? 0) + 1); m.set(p.b, (m.get(p.b) ?? 0) + 1); } return m; }, [pairs]);
  // 연 카드가 아래 칸(내용)에 가리면 그 위로 굴린다.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const el = wrap.current?.querySelector<HTMLElement>(`[data-c="${open}"]`), panel = document.querySelector<HTMLElement>(".mm8-detail");
      if (!el || !panel) return;
      const r = el.getBoundingClientRect(), top = panel.getBoundingClientRect().top;
      if (r.bottom > top - 12) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const again = el.getBoundingClientRect();
      if (again.bottom > top - 12) { let box: HTMLElement | null = el.parentElement; while (box && box.scrollHeight <= box.clientHeight) box = box.parentElement; (box ?? document.scrollingElement as HTMLElement | null)?.scrollBy({ top: again.bottom - top + 40, behavior: "smooth" }); }
    }, 60);
    return () => clearTimeout(t);
  }, [open]);
  // 메인·바탕·곁 (11/9 사용자: 목표 기준 강조는 "이렇게 하면 안 될 것 같음" → "구조 묶을 때 AI가 메인 포인트를 잡게, 기울기·절편 방정식은 메인이
  // 아니라 사전에 알아야 하는 지식"): 구조 AI가 묶음마다 role을 고른다(src/lib/study/structure.ts). 메인은 위에 옅게 강조, 바탕·곁은 흐리게 아래로.
  // 아래 묶음에 role이 없으면(큰 상자 다시 정리로 생긴 것) 위 묶음을 따른다. "풀기"(사용자 "풀기 하나 만들어 봐")는 체크 상자로 끈다.
  // 11/12 사용자 "메인 포인트 보기 빼고": 메인 · 바탕 · 곁 강조와 그 체크 상자를 뺐다(구조는 뜻으로 묶은 그림만).
  const roleOn = false;
  const roleView = useMemo(() => {
    const groups = s?.groups ?? [];
    const byG = new Map(groups.map((g) => [g.id, g]));
    const roleOf = (id: string): StructRole | undefined => { for (let g = byG.get(id); g; g = byG.get(g.parent)) if (g.role) return g.role; return undefined; };
    const has = groups.some((g) => g.role);
    return { has, on: has && roleOn, roleOf, base: new Set(s?.base ?? []) };
  }, [s, roleOn]);
  const makeBtn = (label: string, primary = true) => <button className={`btn small ${primary ? "primary" : "ghost"}`} disabled={busy || making} onClick={make}
    title="기억 카드를 뜻으로 다시 묶어요. AI 1번(terra), 약 15초">{busy ? "구조를 만드는 중… (약 15초)" : label}</button>;
  if (!data && !error) return <p className="small muted mm6-wait">불러오는 중…</p>;
  if (!s) return <div className="mm7-empty"><p className="small muted">목차는 자료가 쪽 순서로 보여 준 차례예요. 구조는 같은 기억들을 뜻으로 다시 묶어, 무엇이 무엇의 부분이고 무엇이 무엇을 막거나 쓰는지 그림으로 보여 줘요.</p>
    <div className="row small">{makeBtn("구조 만들기")}<span className="small muted">AI 1번 (terra) · 약 15초{making ? " · 자료를 다 만든 뒤에 할 수 있어요" : ""}</span></div>
    {error ? <p className="small bad">{error}</p> : null}</div>;
  const kids = (id: string) => s.groups.filter((g) => g.parent === id);
  // 메인 묶음을 위로(차례로 묶인 것은 순서를 지킨다). 같은 등급 안에서는 원래 순서.
  const RANK: Record<StructRole, number> = { 메인: 0, 바탕: 1, 곁: 2 };
  const ranked = (list: StructGroup[]) => roleView.on ? [...list].sort((a, b) => RANK[roleView.roleOf(a.id) ?? "메인"] - RANK[roleView.roleOf(b.id) ?? "메인"]) : list;
  const tierClass = (id: string) => { if (!roleView.on) return ""; const r = roleView.roleOf(id); return r === "메인" ? " main" : r === "바탕" ? " side base" : r === "곁" ? " side" : ""; };
  const openCard = open ? byId.get(open) : undefined;
  const litCards = new Set(hover?.card ? [hover.card, ...pairs.filter((p) => p.a === hover.card || p.b === hover.card).map((p) => (p.a === hover.card ? p.b : p.a))] : []);
  const pill = (c: Card) => <button key={c.id} data-c={c.id} className={`mm8-pill${c.core ? " core" : ""}${roleView.on && roleView.base.has(c.id) && roleView.roleOf(groupOfCard.get(c.id) ?? "") === "메인" ? " basecard" : ""}${open === c.id ? " on" : ""}${litCards.has(c.id) ? " lit" : ""}`}
    onClick={() => setOpen(open === c.id ? null : c.id)} title={`${keyLine(c.shape)}${roleView.on && roleView.base.has(c.id) ? "\n바탕 지식(미리 알아야 할 것을 다시 적은 것)" : ""}`}>
    <Rich text={c.title} />{c.figure?.file ? <span className="mm8-fig" aria-label="그림 있음">▣</span> : null}{pairCount.get(c.id) ? <span className="mm8-n" aria-label={`다른 묶음과 연결 ${pairCount.get(c.id)}`}>↔{pairCount.get(c.id)}</span> : null}</button>;
  const box = (g: StructGroup, depth: number): ReactNode => {
    const ok = (c: Card | undefined): c is Card => !!c && !isFlowCard(c);
    const head = g.head ? byId.get(g.head) : undefined;
    const mine = g.cards.map((id) => byId.get(id)).filter(ok);
    const sub = kids(g.id);
    if (!mine.length && !sub.length && !ok(head)) return null;
    // 같은 상자 안에서 견주는 둘은 한 덩어리(A vs B)로, 나머지는 하나씩.
    const ids = new Set(mine.map((c) => c.id)), used = new Set<string>();
    const items: Array<{ vs?: StructVersus; c?: Card }> = [];
    for (const c of mine) {
      if (used.has(c.id)) continue;
      const v = (s.versus ?? []).find((x) => (x.a === c.id && ids.has(x.b) && !used.has(x.b)) || (x.b === c.id && ids.has(x.a) && !used.has(x.a)));
      if (v) { used.add(v.a); used.add(v.b); items.push({ vs: v }); } else { used.add(c.id); items.push({ c }); }
    }
    const rel = g.members ? MEMBER_LABEL[g.members] : "", join = g.members ? MEMBER_JOIN[g.members] : undefined;
    const merged = ok(head) && sameName(head.title, g.name);
    return (
      <div key={g.id} data-g={g.id} className={`mm8-box d${Math.min(depth, 3)}${tierClass(g.id)}${hover?.group === g.id ? " hov" : ""}`}>
        {merged ? null : <div className="mm8-title" title={g.explain || undefined}><Rich text={g.name} /></div>}
        {roleView.on && g.role && g.role !== "메인" && (!g.parent || roleView.roleOf(g.parent) !== g.role) ? <span className="mm8-role">{g.role === "바탕" ? "바탕 지식" : "곁가지"}</span> : null}
        {ok(head) ? <button data-c={head.id} className={`mm8-head${merged ? " as-title" : ""}${open === head.id ? " on" : ""}${litCards.has(head.id) ? " lit" : ""}`} onClick={() => setOpen(open === head.id ? null : head.id)}>
          <span className="mm8-headname"><Rich text={head.title} />{pairCount.get(head.id) ? <span className="mm8-n">↔{pairCount.get(head.id)}</span> : null}</span>
          <span className="mm8-headline"><Rich text={keyLine(head.shape)} /></span></button> : null}
        {g.explain && depth < 2 && !ok(head) ? <p className="mm8-explain"><Rich text={g.explain} /></p> : null}
        {/* 11/8 사용자: 관계 표시는 한 줄을 온전히, 차례로는 상자처럼 위에서 아래로 ↓ */}
        {items.length && rel ? <div className={`mm8-relrow r-${g.members}`}><span className={`mm8-rel r-${g.members}`}>{rel}</span></div> : null}
        {items.length ? <div className={`mm8-cards${g.members === "순서" ? " seq" : ""}`}>
          {items.map((it, i) => <span key={i} className="mm8-item">
            {i && join ? <span className="mm8-join" aria-hidden>{g.members === "순서" ? "↓" : join}</span> : null}
            {it.vs ? <span className="mm8-vs" title={it.vs.on || undefined}>{pill(byId.get(it.vs.a)!)}<span className="mm8-vsmark">vs{it.vs.on ? <em>{it.vs.on}</em> : null}</span>{pill(byId.get(it.vs.b)!)}</span> : pill(it.c!)}
          </span>)}</div> : null}
        {sub.length ? <>{!items.length && rel ? <div className={`mm8-relrow r-${g.members}`}><span className={`mm8-rel r-${g.members}`}>{rel}</span></div> : null}{g.members === "순서" && !items.length
          ? <div className="mm8-kids seq">{sub.map((k, i) => <Fragment key={k.id}>{i ? <span className="mm8-join seq" aria-hidden>↓{k.link ? <em>{k.link}</em> : null}</span> : null}{box(k, depth + 1)}</Fragment>)}</div>
          : <div className="mm8-kids">{ranked(sub).map((k) => box(k, depth + 1))}</div>}</> : null}
      </div>);
  };
  return (
    <div className={`mm8${openCard ? " has-detail" : ""}`} onClick={(e) => { if (open && !(e.target as HTMLElement).closest("[data-c],button,a,input,label,.mm8-detail")) setOpen(null); }}>
      <div className="row small mm7-bar"><span className="small muted">뜻으로 묶은 그림 · 상자 안은 그 부분 · 카드를 열면 다른 묶음의 짝</span><span className="cs-gap" />
        {data?.stale ? <span className="small bad">{s?.unit === "memory" ? "줄기가 바뀌었어요" : "줄기나 카드가 바뀌었어요"}</span> : null}{makeBtn("다시 만들기", Boolean(data?.stale))}</div>
      {error ? <p className="small bad">{error}</p> : null}
      {/* 11/8 사용자 "눌렀을 때 아래 칸이 덮어서 다시 누를 수 없다": 빈 곳을 누르면 닫히고, 연 카드는 아래 칸 위로 보이게 굴린다. */}
      <div className="mm8-wrap" ref={wrap} onMouseLeave={() => setHover(null)} onMouseOver={(e) => {
        // 가장 안쪽 것 하나만: 카드 위면 그 카드, 아니면 그 상자.
        const t = (e.target as HTMLElement).closest<HTMLElement>("[data-c],[data-g]");
        const next = t?.dataset.c ? { card: t.dataset.c } : t?.dataset.g ? { group: t.dataset.g } : null;
        if (next?.card !== hover?.card || next?.group !== hover?.group) setHover(next);
      }}>
        <div className="mm8-roots">{ranked(kids("")).map((g) => box(g, 0))}</div>
        {/* 11/9 사용자 "자료 지도에서 줄로 연결하는 건 빼자": 상자 사이·카드 짝 선을 그리지 않는다. 짝은 카드를 열면 아래 칸에 나온다. */}
      </div>
      {openCard ? <div className="mm8-detail mm6-card">
        <div className="mm3-dhead"><b><Rich text={openCard.title} /></b><span className="mm3-kind">{openCard.kind}</span>{openCard.core ? <span className="mm3-kind core">핵심</span> : null}<span className="cs-gap" />
          {openCard.pages.map((p) => <button key={p} className="btn ghost small" onClick={() => onPage(p)}>원문 p.{p}</button>)}<button className="btn ghost small" onClick={() => setOpen(null)}>닫기</button></div>
        {/* 질문·답 카드는 원문 답 그대로(표 · 번호 목록), 한 줄 요약을 겹쳐 쓰지 않는다 (11/12) */}
        {openCard.memo?.answer ? <Answer text={openCard.memo.answer} /> : <Body s={openCard.shape} />}
        {memById.get(openCard.id) && cardById.get(openCard.id) ? <>
          {memById.get(openCard.id)!.line && !openCard.memo?.answer ? <p className="small" style={{ margin: 0 }}><Rich text={memById.get(openCard.id)!.line} /></p> : null}
          <CardDetails items={memById.get(openCard.id)!.details} />
          <FigureView genId={genId} c={openCard} onPage={onPage} /></>
          : memById.get(openCard.id) ? <>{memById.get(openCard.id)!.steps.length ? <p className="small" style={{ margin: 0 }}><Rich text={memById.get(openCard.id)!.line} /></p> : null}
          <div className="st-src"><span className="small muted">근거 카드 {memById.get(openCard.id)!.cards.length}</span>{memById.get(openCard.id)!.cards.map((id) => cardById.get(id)).filter((c): c is Card => !!c).map((c) =>
            <button key={c.id} className={`mm3-relchip${srcCard === c.id ? " on" : ""}`} onClick={() => setSrcCard(srcCard === c.id ? null : c.id)}><Rich text={c.title} /></button>)}</div>
          {srcCard && cardById.get(srcCard) && memById.get(openCard.id)!.cards.includes(srcCard) ? <div className="st-card"><Body s={cardById.get(srcCard)!.shape} /><FigureView genId={genId} c={cardById.get(srcCard)!} onPage={onPage} /></div> : null}</>
          : <FigureView genId={genId} c={openCard} onPage={onPage} all={cards} onCard={setOpen} />}
        {pairs.some((p) => p.a === openCard.id || p.b === openCard.id) ? <div className="mm3-rel"><span className="mm3-tag">다른 묶음의 짝</span><div className="mm3-relchips">
          {pairs.filter((p) => p.a === openCard.id || p.b === openCard.id).map((p, i) => { const other = p.a === openCard.id ? p.b : p.a; return <button key={i} className="mm3-relchip" onClick={() => setOpen(other)} title={p.why}>
            <Rich text={byId.get(other)?.title ?? ""} />{p.why && p.why.length <= 24 ? <em>{p.why}</em> : null}</button>; })}</div></div> : null}
        {openCard.questions && onPractice ? <div className="mm3-dfoot"><span className="cs-gap" /><button className="btn small primary" onClick={() => onPractice(openCard.pages[0], openCard.id)}>이 기억 문제 풀기 ({openCard.questions})</button></div> : null}
      </div> : null}
    </div>);
}
