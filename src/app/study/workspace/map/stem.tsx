"use client";
// 자료 지도 조각 (11/12 A 정리, MaterialMap.tsx에서 나눔): [줄기] 탭: 영역 · 기억 목록(줄기)과 예전 목차.
import { useEffect, useMemo, useState } from "react";
import { call, errorText } from "../api";
import { RichInline as Rich } from "../Rich";
import { DigestLite, OutlineItem } from "./live";
import { Answer, Body, Card, CardDetails, FigureView, RoleChip, isFlowCard, range, roleClass, rowLine } from "./shape";

/** Items as the plan call writes them ("t3-c1|이름|쪽"), so they show while the outline is still streaming. */
export function streamedItems(text: string): Map<string, OutlineItem[]> {
  const out = new Map<string, OutlineItem[]>();
  for (const m of text.matchAll(/^(t\d+)-c(\d+)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]*)/gm)) {
    const pages = [...m[4].matchAll(/\d+/g)].map((x) => Number(x[0]));
    out.set(m[1], [...(out.get(m[1]) ?? []), { key: `${m[1]}-c${m[2]}`, name: m[3].trim(), pages }]);
  }
  return out;
}
export function OutlinePane({ genId, digest, cards, making, onPage, onPractice }: { genId: string; digest: DigestLite | null | undefined; cards: Card[]; making: boolean;
  onPage: (page: number) => void; onPractice?: (page: number, cardId: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const sk = digest?.skeleton;
  if (!sk || (!sk.topics.length && !sk.text)) return making ? <ThinkingOrbs /> : <p className="small muted mm6-wait">이 자료에는 목차가 없어요. [기억] 탭에서 보세요.</p>;
  const streamed = streamedItems(sk.text ?? "");
  const byTopic = new Map<string, Card[]>();
  for (const c of cards) { const t = c.id.split(".")[0]; byTopic.set(t, [...(byTopic.get(t) ?? []), c]); }
  // 11/9 사용자 "목차에서 개념 누르면 뜨는 거 새 미니 화면에서, 구조처럼": 구조 탭과 같은 아래 칸(떠 있는 카드)에 연다.
  const detail = (c: Card) => (
    <div className="mm8-detail mm6-card">
      <div className="mm3-dhead"><b><Rich text={c.title} /></b><span className="mm3-kind">{c.kind}</span>{c.core ? <span className="mm3-kind core">핵심</span> : null}<span className="cs-gap" />
        {c.pages.map((p) => <button key={p} className="btn ghost small" onClick={() => onPage(p)}>원문 p.{p}</button>)}<button className="btn ghost small" onClick={() => setOpen(null)}>닫기</button></div>
      <Body s={c.shape} />
      <FigureView genId={genId} c={c} onPage={onPage} all={cards} onCard={setOpen} />
      {c.questions && onPractice ? <div className="mm3-dfoot"><span className="cs-gap" /><button className="btn small primary" onClick={() => onPractice(c.pages[0], c.id)}>이 기억 문제 풀기 ({c.questions})</button></div> : null}
    </div>);
  const chip = (c: Card) => <button key={c.id} className={`chip mm6-chip${open === c.id ? " on" : ""}${c.core ? " core" : ""}`} aria-expanded={open === c.id}
    onClick={() => setOpen(open === c.id ? null : c.id)}><Rich text={isFlowCard(c) ? "흐름 보기" : c.title} /></button>;
  const openCard = open ? cards.find((c) => c.id === open) : undefined;
  return (
    <div className={`mm6${openCard ? " has-detail" : ""}`} onClick={(e) => { if (open && !(e.target as HTMLElement).closest("button,a,input,label,.mm8-detail")) setOpen(null); }}>
      {digest?.objectives?.length ? <section className="mm6-goals"><p className="mm3-label">학습 목표</p>
        <ol>{digest.objectives.map((o) => <li key={o.id}><span className="mm6-verb">{o.verb}</span> <Rich text={o.text} /></li>)}</ol></section> : null}
      <ol className="mm6-topics">
        {sk.topics.map((t, i) => {
          const body = digest?.topics?.[t.id]?.body ?? [];
          const items: OutlineItem[] = body.length ? body.map((l) => ({ key: l.id, name: l.name, pages: l.pages })) : streamed.get(t.id) ?? [];
          const mine = byTopic.get(t.id) ?? [];
          const under = (it: OutlineItem) => mine.filter((c) => !isFlowCard(c) && (digest?.notes?.[c.id]?.covers ?? []).includes(it.key));
          const placed = new Set(items.flatMap((it) => under(it).map((c) => c.id)));
          const loose = mine.filter((c) => !isFlowCard(c) && !placed.has(c.id));
          return (
            <li key={t.id} className="mm6-topic">
              <div className="mm6-thead"><span className="mm3-num">{i + 1}</span><b><Rich text={t.title} /></b><span className="small muted">{range(t.pages)}</span>
                </div>
              {items.length ? <p className="mm6-learn small muted"><Rich text={`${items.map((it) => it.name).join(", ")}을(를) 배워요.`} /></p> : null}
              <ul className="mm6-items">
                {items.map((it) => { const got = under(it); return (
                  <li key={it.key} className="mm6-item"><span className="mm6-iname"><Rich text={it.name} /></span>
                    <span className="mm6-chips">{got.length ? got.map(chip) : <span className="small muted">{making ? "기억 만드는 중…" : "—"}</span>}</span></li>); })}
                {loose.length ? <li className="mm6-item"><span className="mm6-iname muted">그 밖</span><span className="mm6-chips">{loose.map(chip)}</span></li> : null}
              </ul>
            </li>);
        })}
      </ol>
      {sk.status === "writing" ? <p className="small muted">목차를 이어 쓰는 중…</p> : null}
      {openCard ? detail(openCard) : null}
    </div>);
}

// 줄기 (11/9 사용자 "목차를 없애야 하나, 줄기로 바꾸려면" → "바꿔서 테스트 후 보고"): 기억 합치기(src/lib/study/compact.ts)가 묶은 영역 → 기억.
// 영역은 자료 순서라 목차를 겸한다(쪽 범위). 메인 기억은 한 줄씩, 바탕·곁은 영역 끝에 접어 둔다. 누르면 아래 떠 있는 칸에 요지·단계·근거 카드.
// 아직 합치지 않은 자료는 예전 목차를 보이고 위에 [줄기 만들기].
export type MemoryLite = { id: string; name: string; kind: string; role: "메인" | "바탕" | "곁"; area: number; question: string; line: string; steps: string[]; cards: string[]; facts?: string[]; details?: string[] };
export type CompactLite = { at: string; ms: number; model?: string; cards: number; areas: Array<{ name: string; question: string }>; memories: MemoryLite[] };
// 줄기 잡는 동안(11/11 사용자 "줄기 만들 때는 뭐 대단한 거 하는 척하면서 큰 동그라미 세 개 움직이는 애니메이션"): 자료 전체를 한 번에 보는 호출이라
// 글이 흘러나오지 않는다. 큰 동그라미 셋이 돌고, 하는 일을 몇 초마다 바꿔 보여 준다(자료와 상관없는 말만).
export const ORB_LINES = ["자료 전체를 한꺼번에 펼쳐 보는 중", "쪽들 사이의 흐름을 잇는 중", "큰 영역으로 나누는 중", "외울 단위를 고르는 중", "빠진 쪽이 없는지 맞춰 보는 중", "기억마다 근거 쪽을 다는 중"];
export function ThinkingOrbs({ lines = ORB_LINES }: { lines?: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % lines.length), 2600); return () => clearInterval(t); }, [lines.length]);
  return <div className="orbs-wrap" role="status" aria-live="polite">
    <div className="orbs" aria-hidden><span /><span /><span /></div>
    <p className="orbs-title">줄기를 잡고 있어요</p>
    <p key={i} className="orbs-line">{lines[i]}…</p>
  </div>;
}
export function StemPane(props: { genId: string; digest: DigestLite | null | undefined; cards: Card[]; making: boolean; onPage: (page: number) => void; onPractice?: (page: number, cardId: string) => void }) {
  const { genId, cards, making, onPage } = props;
  const [data, setData] = useState<CompactLite | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [card, setCard] = useState<string | null>(null);
  useEffect(() => { let alive = true;
    call<{ compact: CompactLite | null }>(`/api/study-map/${genId}/compact`).then((r) => { if (alive) setData(r.compact); }).catch(() => { if (alive) setData(null); });
    return () => { alive = false; }; }, [genId]);
  const make = () => { setBusy(true); setError("");
    call<{ compact: CompactLite }>(`/api/study-map/${genId}/compact`, {}).then((r) => setData(r.compact)).catch((e) => setError(errorText(e))).finally(() => setBusy(false)); };
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const btn = (label: string, primary: boolean) => <button className={`btn small ${primary ? "primary" : "ghost"}`} disabled={busy || making} onClick={make} title="카드를 영역·기억으로 묶어요. AI 영역 1번 + 영역마다 1번(동시), 약 30초">{busy ? "줄기를 만드는 중… (약 30초)" : label}</button>;
  if (data === undefined) return <p className="small muted mm6-wait">불러오는 중…</p>;
  if (busy) return <ThinkingOrbs />;
  if (!data) return <>
    <div className="row small mm8-goalbar"><span className="muted">카드 {cards.filter((c) => !isFlowCard(c)).length}장을 외울 단위(알고리즘은 한 장)로 묶어 줄기로 볼 수 있어요.</span><span className="cs-gap" />{btn("줄기 만들기", true)}</div>
    {error ? <p className="small bad">{error}</p> : null}
    <OutlinePane {...props} /></>;
  const pagesOf = (m: MemoryLite) => [...new Set(m.cards.flatMap((id) => byId.get(id)?.pages ?? []))].sort((a, b) => a - b);
  const mem = data.memories.find((m) => m.id === open);
  const self = mem && mem.cards.length === 1 && mem.cards[0] === mem.id ? byId.get(mem.id) : undefined;
  const openCard = card ? byId.get(card) : undefined;
  const range = (ps: number[]) => ps.length ? (ps[0] === ps.at(-1) ? `p.${ps[0]}` : `p.${ps[0]}–${ps.at(-1)}`) : "";
  const main = data.memories.filter((m) => m.role === "메인").length;
  return (
    <div className={`mm6 st${mem ? " has-detail" : ""}`} onClick={(e) => { if (open && !(e.target as HTMLElement).closest("button,a,input,label,summary,.mm8-detail")) { setOpen(null); setCard(null); } }}>
      <div className="row small mm8-goalbar"><span className="muted">{data.model === "stem" ? `기억 ${data.memories.length}개` : `카드 ${data.cards}장 → 기억 ${data.memories.length}개`} (이 강의에서 새로 배우는 것 {main}개)</span><span className="cs-gap" />{btn("다시 만들기", false)}</div>
      {error ? <p className="small bad">{error}</p> : null}
      <ol className="mm6-topics">{data.areas.map((a, i) => {
        const list = data.memories.filter((m) => m.area === i + 1);
        const mains = list.filter((m) => m.role === "메인"), rest = list.filter((m) => m.role !== "메인");
        const ps = [...new Set(list.flatMap(pagesOf))].sort((x, y) => x - y);
        const row = (m: MemoryLite) => <li key={m.id}><button className={`st-row${open === m.id ? " on" : ""}${m.role !== "메인" ? " side" : ""}${roleClass(m.role === "바탕" || m.role === "곁" ? m.role : "메인")}`} onClick={() => { setOpen(open === m.id ? null : m.id); setCard(null); }}>
          <span className="st-name"><RoleChip role={m.role === "바탕" || m.role === "곁" ? m.role : "메인"} /><Rich text={m.name} /></span>{m.kind === "알고리즘" ? <span className="st-kind">알고리즘 · {m.steps.length}단계</span> : <span className="st-kind">{m.kind}</span>}
          <span className="st-line"><Rich text={byId.get(m.id)?.memo?.answer ? rowLine(byId.get(m.id)!) : m.line} /></span></button></li>;
        return <li key={i} className="mm6-topic">
          <div className="mm6-thead"><span className="mm3-num">{i + 1}</span><b><Rich text={a.name} /></b><span className="small muted">{range(ps)}</span></div>
          {a.question ? <p className="st-q small muted"><Rich text={a.question} /></p> : null}
          <ul className="st-list">{mains.map(row)}</ul>
          {rest.length ? <details className="st-more"><summary className="small muted">바탕·곁 {rest.length}개 · {rest.map((m) => m.name).join(", ")}</summary><ul className="st-list">{rest.map(row)}</ul></details> : null}
        </li>;
      })}
      {data.memories.some((m) => !m.area) ? <li className="mm6-topic"><div className="mm6-thead"><b>그 밖</b></div><ul className="st-list">{data.memories.filter((m) => !m.area).map((m) =>
        <li key={m.id}><button className="st-row side" onClick={() => setOpen(m.id)}><span className="st-name"><Rich text={m.name} /></span></button></li>)}</ul></li> : null}
      </ol>
      {mem ? <div className="mm8-detail mm6-card">
        <div className="mm3-dhead"><b><Rich text={mem.name} /></b><span className="mm3-kind">{mem.kind}</span>{mem.role !== "메인" ? <span className="mm3-kind">{mem.role === "바탕" ? "바탕 지식" : "곁가지"}</span> : null}<span className="cs-gap" />
          {pagesOf(mem).slice(0, 6).map((p) => <button key={p} className="btn ghost small" onClick={() => onPage(p)}>원문 p.{p}</button>)}<button className="btn ghost small" onClick={() => { setOpen(null); setCard(null); }}>닫기</button></div>
        {mem.question ? <p className="lc3-cq"><span className="lc3-qtag">Q</span><Rich text={mem.question} /></p> : null}
        {/* 질문·답 카드(11/12 사용자 "표가 왜 안 되냐 · 절차 번호가 왜 이어붙냐"): 답은 한 줄로 줄인 글이 아니라 원문 답 그대로(표 · 번호 목록 · 식) */}
        {self?.memo?.answer ? <Answer text={self.memo.answer} /> : <p className="lc3-ca"><Rich text={mem.line} /></p>}
        {self ? <>
          {/* 줄기 모드(11/10): 기억 하나가 곧 카드 한 장 — 모양(단계·기준…), 모양에 없는 식·조건, 근거, 그림을 바로. 질문·답 카드는 모양 = 답이라 다시 안 그린다 */}
          {self.memo?.answer ? null : <Body s={self.shape} />}
          <CardDetails items={mem.details} />
          {self.quotes.length ? <div className="st-quotes small muted">{self.quotes.map((q, k) => <span key={k}>“{q}”</span>)}</div> : null}
          <FigureView genId={genId} c={self} onPage={onPage} />
        </> : <>
        {mem.steps.length ? <ol className="st-steps">{mem.steps.map((x, k) => <li key={k}><Rich text={x} /></li>)}</ol> : null}
        <div className="st-src"><span className="small muted">근거 카드 {mem.cards.length}</span>{mem.cards.map((id) => byId.get(id)).filter((c): c is Card => !!c).map((c) =>
          <button key={c.id} className={`mm3-relchip${card === c.id ? " on" : ""}`} onClick={() => setCard(card === c.id ? null : c.id)}><Rich text={c.title} /></button>)}</div>
        {openCard && mem.cards.includes(openCard.id) ? <div className="st-card"><Body s={openCard.shape} /><FigureView genId={genId} c={openCard} onPage={onPage} /></div> : null}
        </>}
      </div> : null}
    </div>);
}
