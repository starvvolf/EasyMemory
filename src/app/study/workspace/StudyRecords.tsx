"use client";
import { RichInline } from "./Rich";
import { useBridge, type Bridge } from "./bridge";

/* 학습 기록 (11/11 바닐라 renderRecords를 React로). */
type Row = { id: string; title: string; page: number; format: string; objectiveId: string; status: string; cls: string; trail: Array<{ cls: string; t: string }>; next: string };
type Snap = {
  id: string; decks: Array<{ id: string; title: string }>; deleting: boolean; example: boolean; engine: boolean;
  counts: { good: number; review: number; assisted: number; read: number; fresh: number }; acc: number | null; graded: number; rows: Row[];
  hidden: Array<{ id: string; statement: string; pages: string }>; reported: Array<{ id: string; prompt: string; page: number; reason: string }>;
  fixes: Array<{ id: string; label: string; at: string; prompt: string }>;
} | null;
type Api = { snapshot(): Snap; pick(id: string): void; askReset(on: boolean): void; reset(): void; read(page: number, oid: string): void; unhide(oid: string): void; unreport(iid: string): void; remake(): void; unpatch(fid: string): void };

export default function StudyRecords({ ui, api }: { ui: Bridge; api: Api }) {
  useBridge(ui);
  const s = api.snapshot();
  if (!s) return <div className="panel">아직 자료가 없어요.</div>;
  const c = s.counts;
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row"><label htmlFor="deckSel" className="small muted">자료</label>
          <select id="deckSel" className="btn" style={{ fontWeight: 500 }} value={s.id} onChange={(e) => api.pick(e.target.value)}>{s.decks.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select></div>
        {s.deleting ? (
          <div className="confirm"><span>이 자료의 풀이 기록을 모두 지울까요? 문제는 그대로 남아요.</span>
            <button className="btn small" onClick={api.reset}>지우기</button><button className="btn small ghost" onClick={() => api.askReset(false)}>취소</button></div>
        ) : <button className="btn small ghost" onClick={() => api.askReset(true)}>기록 초기화</button>}
      </div>
      <div className="tiles">
        <div className="tile"><b className="num" style={{ color: "var(--good)" }}>{c.good}</b><span>혼자 맞힘 (최근)</span></div>
        <div className="tile"><b className="num" style={{ color: "var(--bad)" }}>{c.review}</b><span>복습 필요</span></div>
        <div className="tile"><b className="num" style={{ color: "var(--help)" }}>{c.assisted}</b><span>정답 보고만 풂</span></div>
        <div className="tile"><b className="num" style={{ color: "var(--read)" }}>{c.read}</b><span>읽은 직후만 풂</span></div>
        <div className="tile"><b className="num">{c.fresh}</b><span>안 풀어봄</span></div>
        <div className="tile"><b className="num">{s.acc == null ? "–" : s.acc + "%"}</b><span>자동 채점 정답률 ({s.graded}회)</span></div>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>학습목표</th><th>상태</th><th>기록 (최근 14회)</th><th>다음 복습</th></tr></thead>
        <tbody>{s.rows.map(r => (
          <tr key={r.id}>
            <td><div style={{ fontWeight: 600 }}><RichInline text={r.title} /></div>
              <div className="small muted">p.{r.page} · {r.format} · <button className="linkish" onClick={() => api.read(r.page, r.objectiveId)}>원문</button></div></td>
            <td><span className={`chip ${r.cls}`}>{r.status}</span></td>
            <td><div className="trail" title="왼쪽이 오래된 기록">{r.trail.map((e, i) => <i key={i} className={e.cls} title={e.t} />)}</div></td>
            <td className="n small">{r.next}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <div className="legend">
        <span style={{ ["--c" as string]: "var(--good)" }}>자동 채점 정답</span>
        <span style={{ ["--c" as string]: "var(--accent)" }}>자기평가: 떠올림</span>
        <span style={{ ["--c" as string]: "var(--bad)" }}>못 떠올림</span>
        <span style={{ ["--c" as string]: "var(--help)" }}>정답 본 뒤 풂 (셈에서 제외)</span>
        <span style={{ ["--c" as string]: "var(--read)" }}>읽은 직후 맞힘 (셈에서 제외)</span>
      </div>
      {s.hidden.length || s.reported.length ? (
        <section className="panel stack">
          <p className="eyebrow">연습에서 뺀 것</p>
          {s.hidden.length ? <div className="itemlist">{s.hidden.map(o => (
            <div className="item" key={o.id}><div className="meta"><span className="chip">뺀 목표</span><span className="chip page">p.{o.pages}</span></div>
              <p><RichInline text={o.statement} /></p><div><button className="btn small" onClick={() => api.unhide(o.id)}>다시 넣기</button></div></div>
          ))}</div> : null}
          {s.reported.length ? <div className="itemlist">{s.reported.map(it => (
            <div className="item" key={it.id}><div className="meta"><span className="chip help">신고 · {it.reason}</span><span className="chip page">p.{it.page}</span></div>
              <p><RichInline text={it.prompt} /></p><div><button className="btn small" onClick={() => api.unreport(it.id)}>신고 취소</button></div></div>
          ))}</div> : null}
          {s.reported.length && !s.example ? (
            <div className="row"><button className="btn small primary" disabled={!s.engine} onClick={api.remake}>신고한 문제의 목표 다시 만들기</button>
              <span className="small muted">앞의 학습 설계를 그대로 쓰고, 신고한 문제의 목표만 새로 만들어요.</span></div>
          ) : null}
          <p className="small muted">신고한 문제는 품질 근거로 남아요.</p>
        </section>
      ) : null}
      {s.fixes.length ? (
        <section className="panel stack">
          <p className="eyebrow">고친 것 (공부하면서 바로 고친 문제)</p>
          <div className="itemlist">{s.fixes.map(f => (
            <div className="item" key={f.id}><div className="meta"><span className="chip acc">{f.label}</span><span className="small muted">{f.at}</span></div>
              {f.prompt ? <p><RichInline text={f.prompt} /></p> : null}<div><button className="btn small" onClick={() => api.unpatch(f.id)}>되돌리기</button></div></div>
          ))}</div>
        </section>
      ) : null}
      <p className="small muted">‘3일 이상 혼자 맞힘’은 서로 다른 3일에 정답을 보기 전 스스로 맞힌 경우예요. 숙달했다는 판정이 아니라, 지금까지의 근거를 그대로 보여주는 표시입니다.</p>
    </div>
  );
}
