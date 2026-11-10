"use client";
import { useBridge, type Bridge } from "./bridge";

/* 보관함 (11/11 바닐라 renderArchive를 React로). */
type Snap = { off: boolean; loading: boolean; entries: Array<{ id: string; title: string; reason: string }> };
type Api = { snapshot(): Snap; restore(ids: string[]): void; tidy(): void };

export default function ArchiveView({ ui, api }: { ui: Bridge; api: Api }) {
  useBridge(ui);
  const s = api.snapshot();
  if (s.off) return <div className="stack"><div className="panel small muted">보관함은 로컬 실험 모드에서 쓸 수 있어요.</div></div>;
  if (s.loading) return <div className="stack"><p className="small muted">보관함을 읽는 중…</p></div>;
  return (
    <div className="stack">
      <section className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div><p className="eyebrow">보관함</p><h2>치워 둔 문제 세트 {s.entries.length}개</h2></div>
          <div className="row">
            {s.entries.length ? <button className="btn small ghost" onClick={() => api.restore(s.entries.map(e => e.id))}>모두 꺼내기</button> : null}
            <button className="btn small" onClick={api.tidy}>실험용 중복 다시 치우기</button>
          </div>
        </div>
        <p className="small muted">지워지지 않고 데이터 폴더에 그대로 있어요. 꺼내면 풀이 기록도 그대로 돌아와요.</p>
        {s.entries.length ? <ul className="mat-mini">{s.entries.map(e => (
          <li key={e.id} className="row" style={{ justifyContent: "space-between", gap: 8 }}>
            <span><span>{e.title}</span><span className="small muted"> · {e.reason}</span></span>
            <button className="btn small ghost" onClick={() => api.restore([e.id])}>꺼내기</button>
          </li>
        ))}</ul> : <p className="muted">비어 있어요.</p>}
      </section>
    </div>
  );
}
