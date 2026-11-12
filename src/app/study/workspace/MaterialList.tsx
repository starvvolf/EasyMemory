"use client";
import { RichInline } from "./Rich";
import { useBridge, type Bridge } from "./bridge";

/* 공부 › 자료: PDF 자료 목록 (11/11 바닐라 renderHome을 React로). 값과 동작은 앱(dejipgi-app.js)의 materialsApi가 준다. */
type Goal = { id: string; section: string; part: string; statement: string; support: boolean; recall: string };
type Note = {
  goals: { chosen: string[]; confirming: boolean; objectives: Goal[] } | null; headline: string; text: string; failed: boolean; making: boolean;
  canQuestions: boolean; canConnect: boolean; canResume: boolean; canRestart: boolean; canRemove: boolean;
};
export type Pending = { id: string; title: string; sourceName: string; status: string; label: string; map: boolean; readPage: number; lastPage: number; note: Note };
type Counts = { due: number; fresh: number; good: number; review: number; help: number; read: number; total: number };
type DeckV = { id: string; title: string; pastExam: boolean; objectives: number; items: number; counts: Counts; skipped: string[]; map: boolean; lastPage: number; firstPage: number; growing: Pending | null };
type Mat = { key: string; name: string; open: boolean; count: number; due: number; fresh: number; extra: Pending[]; decks: DeckV[] };
type LooseGroup = { key: string; open: boolean; first: Pending; more: Pending[] };
type Snap = { todayLeft: number; due: number; fresh: number; chunk: number; pendings: number; decks: number; loose: Pending[]; looseGroups?: LooseGroup[]; mats: Mat[]; lib: { status: string; error: string } };
type Api = {
  snapshot(): Snap; startToday(): void; startAll(): void; practice(id: string): void; records(id: string): void; map(id: string): void; read(id: string, page: number): void;
  fold(key: string): void; toggleGoal(id: string, gid: string): void; confirmGoals(id: string): void; makeQuestions(id: string): void; connect(): void;
  resume(id: string): void; restart(id: string): void; remove(id: string): void;
};

export default function MaterialList({ ui, api }: { ui: Bridge; api: Api }) {
  useBridge(ui);
  const s = api.snapshot();
  const head = s.due ? "복습할 문제가 기다리고 있어요" : s.fresh ? "새 문제로 시작해 볼까요" : s.pendings ? "기억을 정리하는 동안 자료 지도가 채워져요" : s.decks ? "오늘 할 문제를 모두 마쳤어요" : "새 자료로 시작해 볼까요";
  return (
    <div className="stack">
      <section className="panel today">
        <div>
          <p className="eyebrow">PDF 자료 연습</p>
          <h2>{head}</h2>
          <p className="small muted" style={{ margin: "4px 0 10px" }}>새 자료는 자료 지도부터 열려요. 문제는 지도에서 원할 때 만들어요.</p>
          <div className="counts">
            {/* 11/12 점검 6번: 오늘 화면의 "복습 차례"(기억 + PDF 문제)와 헷갈리지 않게 PDF 문제 숫자라고 밝힌다 */}
            <div><b className="num">{s.todayLeft}</b><span>오늘 풀 PDF 문제</span></div>
            <div><b className="num">{s.due}</b><span>다시 풀 차례</span></div>
            <div><b className="num">{s.fresh}</b><span>아직 안 푼 문제 (자료당 10개까지)</span></div>
          </div>
        </div>
        <div className="row">
          {s.todayLeft ? <button className="btn primary" onClick={api.startToday}>오늘 할 것<span className="btn-sub num">{Math.min(s.todayLeft, s.chunk)}문제</span></button> : null}
          <button className={s.todayLeft ? "btn" : "btn primary"} disabled={!(s.due || s.fresh)} onClick={api.startAll}>전체 연습</button>
        </div>
      </section>
      {(s.looseGroups ?? s.loose.map((p) => ({ key: p.id, open: false, first: p, more: [] }))).map((g) => (
        <div key={g.key} className="loose-group">
          <LooseCard p={g.first} api={api} />
          {g.more.length ? <>
            <button className="fold-btn loose-more" aria-expanded={g.open} onClick={() => api.fold(g.key)}>
              <span className="fold-caret" aria-hidden="true">{g.open ? "▾" : "▸"}</span><span className="small muted">같은 자료로 만든 것 {g.more.length}개 더</span></button>
            {g.open ? g.more.map((p) => <LooseCard key={p.id} p={p} api={api} />) : null}
          </> : null}
        </div>
      ))}
      <section className="subj-group">
        <div className="decks">
          {s.mats.map(m => m.decks.length === 1 && !m.extra.length ? <DeckCard key={m.key} d={m.decks[0]} api={api} /> : (
            <MatGroup key={m.key} m={m} api={api} />
          ))}
        </div>
      </section>
      <div className="legend">
        <span style={{ ["--c" as string]: "var(--good)" }}>혼자 맞힘</span>
        <span style={{ ["--c" as string]: "var(--bad)" }}>복습 필요</span>
        <span style={{ ["--c" as string]: "var(--help)" }}>도움 받고 풂 (정답·원문을 보고)</span>
        <span style={{ ["--c" as string]: "var(--line)" }}>안 풀어봄</span>
      </div>
      {s.lib.status === "loading" ? <p className="small muted">Recaller 문제를 불러오는 중…</p> : s.lib.status === "error" ? <div className="note err">{s.lib.error}</div> : null}
      <p className="small muted">정답을 보기 전에 스스로 떠올려 맞힌 것만 ‘혼자 맞힘’으로 셉니다. 한 번 맞혔다고 끝내지 않고, 간격을 늘려 가며 다시 물어봅니다.</p>
    </div>
  );
}

/* 기억만 정리한 자료 한 칸 (11/12 점검 15번): 다 된 것은 안내 글 없이 [자료 지도] [문제 만들기]만, 도는 중·멈춤·실패만 안내 글을 보인다. */
function LooseCard({ p, api }: { p: Pending; api: Api }) {
  const done = p.status === "cards" && p.note.canQuestions && !p.note.goals;
  return (
    <article className={`deck${done ? " deck-done" : ""}`}>
      <div><h3>{p.title}</h3><div className="meta"><span>{p.sourceName}</span><span className={`chip ${p.status === "failed" ? "bad" : "acc"}`}>{p.label}</span></div></div>
      <div className="row">
        {done ? <button className="btn small ghost" disabled={p.note.making} onClick={() => api.makeQuestions(p.id)}>{p.note.making ? "시작하는 중…" : "문제 만들기"}</button> : null}
        {p.map ? <button className="btn small primary" onClick={() => api.map(p.id)}>자료 지도</button>
          : <button className="btn small primary" onClick={() => api.read(p.id, p.readPage)}>{p.lastPage ? `이어 읽기 p.${p.lastPage}` : "읽기"}</button>}
      </div>
      {done ? null : <div style={{ gridColumn: "1/-1" }}><PendingNote p={p} api={api} /></div>}
    </article>
  );
}

function MatGroup({ m, api }: { m: Mat; api: Api }) {
  return (
    <>
      <div className="mat-head">
        <button className="fold-btn" aria-expanded={m.open} onClick={() => api.fold(m.key)}>
          <span className="fold-caret" aria-hidden="true">{m.open ? "▾" : "▸"}</span><span className="mat-name">{m.name}</span>
        </button>
        <span className="meta">
          <span className="num muted">같은 자료로 {m.count}번 만듦</span>
          {m.due ? <span className="chip bad num">복습 {m.due}</span> : null}
          {m.fresh ? <span className="chip num">새 문제 {m.fresh}</span> : null}
        </span>
      </div>
      {m.open ? (
        <div className="decks mat-body">
          {m.extra.map(p => (
            <article className="deck" key={p.id}>
              <div><h3>{p.title}</h3><div className="meta"><span>기억만 정리한 것 · 문제 없음</span><span className="chip acc">{p.label}</span></div></div>
              <div className="row">{p.map ? <button className="btn small primary" onClick={() => api.map(p.id)}>자료 지도</button> : null}</div>
              <div style={{ gridColumn: "1/-1" }}><PendingNote p={p} api={api} /></div>
            </article>
          ))}
          {m.decks.map(d => <DeckCard key={d.id} d={d} api={api} />)}
        </div>
      ) : null}
    </>
  );
}

function DeckCard({ d, api }: { d: DeckV; api: Api }) {
  const c = d.counts, pct = (n: number) => (c.total ? (n / c.total * 100) : 0) + "%";
  return (
    <article className="deck">
      <div>
        <h3>{d.pastExam ? <span className="chip exam" style={{ marginRight: 6, verticalAlign: 2 }}>기출형</span> : null}{d.title}</h3>
        <div className="meta">
          <span className="num">기억 {d.objectives} · 문제 {d.items}</span>
          {c.due ? <span className="chip bad num">복습 {c.due}</span> : null}
          {c.fresh ? <span className="chip num">새 문제 {c.fresh}</span> : null}
          {d.skipped.length ? <span className="chip help num" title={d.skipped.join("\n")}>빠진 문항 {d.skipped.length}</span> : null}
        </div>
      </div>
      <div className="row">
        <button className="btn small ghost" onClick={() => api.records(d.id)}>기록</button>
        {d.map ? <button className="btn small ghost" onClick={() => api.map(d.id)}>자료 지도</button>
          : <button className="btn small ghost" onClick={() => api.read(d.id, d.lastPage || d.firstPage)}>{d.lastPage ? `이어 읽기 p.${d.lastPage}` : "읽기"}</button>}
        <button className="btn small primary" onClick={() => api.practice(d.id)}>{c.due || c.fresh ? "연습" : "더 풀기"}</button>
      </div>
      <div className="bar" aria-hidden="true">
        <i className="g" style={{ width: pct(c.good) }} /><i className="r" style={{ width: pct(c.review) }} /><i className="h" style={{ width: pct(c.help + c.read) }} />
      </div>
      {d.growing ? <div style={{ gridColumn: "1/-1" }}><PendingNote p={d.growing} api={api} /></div> : null}
    </article>
  );
}

export function PendingNote({ p, api }: { p: Pending; api: Pick<Api, "toggleGoal" | "confirmGoals" | "makeQuestions" | "connect" | "resume" | "restart" | "remove"> }) {
  const n = p.note;
  if (n.goals) {
    const chosen = new Set(n.goals.chosen);
    const groups: Array<{ title: string; list: Goal[] }> = [];
    for (const o of n.goals.objectives) { let g = groups.find(x => x.title === o.section); if (!g) { g = { title: o.section, list: [] }; groups.push(g); } g.list.push(o); }
    return (
      <div className="note row" role="status">
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>{n.headline}</strong>
          <div className="goals">
            <p className="small muted">이 목표들로 문제를 만들어요. 필요 없는 건 빼고, 보조 목표 중 필요한 건 더하세요.</p>
            {groups.map(g => (
              <section key={g.title}><h4>{g.title}</h4>
                <ul>{g.list.map(o => (
                  <li key={o.id}><label>
                    <input type="checkbox" checked={chosen.has(o.id)} onChange={() => api.toggleGoal(p.id, o.id)} />
                    <span>{o.part ? <small className="muted part">{o.part}</small> : null}<span><RichInline text={o.statement} /></span>
                      {o.support ? <span className="chip">보조</span> : null}<small className="muted">떠올릴 것: {o.recall}</small></span>
                  </label></li>
                ))}</ul>
              </section>
            ))}
            <div className="row">
              <button className="btn primary" disabled={n.goals.confirming} onClick={() => api.confirmGoals(p.id)}>{n.goals.confirming ? "확정하는 중…" : `이 목표 ${chosen.size}개로 문제 만들기`}</button>
              <span className="small muted">전체 {n.goals.objectives.length}개 중</span>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={`note row${n.failed ? " err" : ""}`} role="status">
      <span style={{ flex: 1, minWidth: 0 }}>{n.text}</span>
      {n.canQuestions ? <button className="btn small" disabled={n.making} onClick={() => api.makeQuestions(p.id)}>{n.making ? "시작하는 중…" : "문제 만들기"}</button> : null}
      {n.canConnect ? <button className="btn small" onClick={api.connect}>ChatGPT 연결</button> : null}
      {n.canResume ? <button className="btn small" onClick={() => api.resume(p.id)}>이어 만들기</button> : null}
      {n.canRestart ? <button className="btn small" onClick={() => api.restart(p.id)}>다시 요청</button> : null}
      {n.canRemove ? <button className="btn small ghost" onClick={() => api.remove(p.id)}>지우기</button> : null}
    </div>
  );
}
