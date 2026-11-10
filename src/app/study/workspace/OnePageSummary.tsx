"use client";
import { Rich, RichInline } from "./Rich";
import { useBridge, type Bridge } from "./bridge";

/* 한 장 정리 (11/11 바닐라 renderSummary를 React로). */
type Obj = { id: string; part: string; statement: string; recall: string; quote: string; state: string; asked: string[] | null; support: boolean; pages: number[]; covered: boolean };
type Deck = { id: string; title: string; count: number; weak: number; supportN: number; coreOnly: boolean; gaps: Array<{ n: number; marked: boolean }>; readPage: number; secs: Array<{ title: string; pages: string; objectives: Obj[] }> };
type Snap = { any: boolean; deckId: string; mats: Array<{ id: string; title: string }>; total: number; weak: number; fresh: number; weakQs: number; weakOnly: boolean; hide: boolean; decks: Deck[]; states: Record<string, [string, string]> };
type Api = { snapshot(): Snap; pickDeck(id: string): void; toggle(key: "weakOnly" | "hide"): void; weak(): void; print(): void; coreOnly(id: string): void; read(id: string, page: number, oid?: string): void; gap(id: string, n: number): void; reveal(id: string, oid: string): void };

export default function OnePageSummary({ ui, api }: { ui: Bridge; api: Api }) {
  useBridge(ui);
  const s = api.snapshot();
  if (!s.any) return <div className="panel">아직 자료가 없어요.</div>;
  return (
    <div className="stack summary">
      <section className="panel sum-tools stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row"><label htmlFor="sumSel" className="small muted">자료</label>
            <select className="btn" id="sumSel" style={{ fontWeight: 600 }} value={s.deckId} onChange={(e) => api.pickDeck(e.target.value)}>
              <option value="">모든 자료 · {s.mats.length}</option>{s.mats.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select></div>
          <div className="row">
            {s.weakQs ? <button className="btn small primary" onClick={api.weak}>약점 다시 풀기 {s.weakQs}</button> : null}
            <button className="btn small ghost" onClick={api.print}>인쇄</button>
          </div>
        </div>
        <div className="row">
          <button className="chip-btn" aria-pressed={s.weakOnly} onClick={() => api.toggle("weakOnly")}>약점·물어본 것만</button>
          <button className="chip-btn" aria-pressed={s.hide} onClick={() => api.toggle("hide")}>떠올릴 것 가리기</button>
          <span className="small muted num">기억 {s.total} · 약점 {s.weak} · 안 풀어봄 {s.fresh}</span>
        </div>
        {s.hide ? <p className="small muted">기억 이름만 보고 떠올린 뒤 눌러서 확인하세요. 여기서 확인한 것은 풀이 기록에 들어가지 않아요.</p> : null}
      </section>
      {!s.decks.length ? <div className="panel small muted">이 과목에 묶인 자료가 없어요. 연습 탭의 자료 카드에서 과목을 골라 주세요.</div> : null}
      {s.decks.map(d => (
        <section className="sum-deck" key={d.id}>
          <header className="row" style={{ justifyContent: "space-between" }}>
            <div><h3>{d.title}</h3><p className="small muted num">기억 {d.count}{d.weak ? ` · 약점 ${d.weak}` : ""}{d.coreOnly ? ` · 핵심만 (보조 ${d.supportN}개 뺌)` : ""}</p></div>
            <div className="row">
              {d.supportN ? <button className="chip-btn" aria-pressed={d.coreOnly} title="보조 목표를 연습·오늘 할 것에서 빼거나 다시 넣어요" onClick={() => api.coreOnly(d.id)}>핵심만</button> : null}
              <button className="btn small ghost" onClick={() => api.read(d.id, d.readPage)}>원문 읽기</button>
            </div>
          </header>
          {d.gaps.length ? (
            <div className="gaps">
              <span className="small muted">문제가 없는 쪽 {d.gaps.length}개 · 표지·목차가 아닌데 내용이 있으면 눌러 주세요</span>
              <div className="row">{d.gaps.map(g => <button key={g.n} className="chip-btn" aria-pressed={g.marked} title={g.marked ? "빠진 내용으로 기록했어요" : "빠진 내용이 있다고 기록"} onClick={() => api.gap(d.id, g.n)}>p.{g.n}</button>)}</div>
            </div>
          ) : null}
          {d.secs.map(sec => {
            let lastPart = "";
            return (
              <div className="sum-sec" key={sec.title}>
                <h4><span>{sec.title}</span>{sec.pages ? <small className="muted num">{sec.pages}</small> : null}</h4>
                <ol className="sum-list">
                  {sec.objectives.flatMap(o => {
                    const out = [];
                    if (o.part && o.part !== lastPart) out.push(<li key={`p-${o.id}`} className="sum-part">{o.part}</li>);
                    lastPart = o.part || lastPart;
                    const st = s.states[o.state] ?? ["", ""];
                    const cover = <button className="sum-cover" onClick={() => api.reveal(d.id, o.id)}>떠올린 뒤 눌러서 확인</button>;
                    out.push(
                      <li key={o.id} className="sum-obj" data-st={o.state}>
                        <span className="sum-dot" title={st[0]} aria-label={st[0]} />
                        <div className="sum-body">
                          <p className="sum-stmt"><RichInline text={o.statement} /></p>
                          {o.recall ? (o.covered ? cover : <div className="sum-recall"><Rich text={o.recall} /></div>)
                            : o.quote ? (o.covered ? cover : <div className="sum-recall quote"><mark className="quote">{o.quote}</mark></div>) : null}
                          <div className="sum-meta">
                            {o.state === "weak" ? <span className="chip bad">약점</span> : null}
                            {o.asked ? <span className="chip ask" title={`읽다가 물어본 것: ${o.asked.join(" / ")}`}>물어봄</span> : null}
                            {o.support ? <span className="chip">보조</span> : null}
                            {o.pages.length ? <button className="linkish small" onClick={() => api.read(d.id, o.pages[0], o.id)}>원문 p.{o.pages.join(",")}</button> : null}
                          </div>
                        </div>
                      </li>,
                    );
                    return out;
                  })}
                </ol>
              </div>
            );
          })}
          {!d.secs.length ? <p className="small muted">{s.weakOnly ? "이 자료에는 약점이 없어요." : "정리할 목표가 없어요."}</p> : null}
        </section>
      ))}
      <div className="legend">
        <span style={{ ["--c" as string]: "var(--bad)" }}>약점 (마지막에 틀림·잘 모름·정답 보고 풂)</span>
        <span style={{ ["--c" as string]: "var(--help)" }}>푸는 중</span>
        <span style={{ ["--c" as string]: "var(--good)" }}>혼자 맞힘</span>
        <span style={{ ["--c" as string]: "var(--line-strong)" }}>안 풀어봄</span>
      </div>
    </div>
  );
}
