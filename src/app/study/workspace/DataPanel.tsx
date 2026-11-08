"use client";
// 데이터 관리 (11/9 사용자 "데이터 관리할 수 있게 간단하게, 조그만 탭에, 비울 건 내가 비울 수 있게"; src/lib/data-admin.ts).
// ⋯ 메뉴에서 연다. 보관은 지우지 않고 데이터 폴더의 보관/로 옮긴다(이 컴퓨터에만 남고 동기화하지 않음).
import { useCallback, useEffect, useState } from "react";

type Item = { path: string; title: string; detail: string; bytes: number; at?: string };
type View = { dir: string; total: number; files: number; sync: { repo: boolean; on: boolean; last?: string; changes?: number };
  groups: Array<{ key: string; label: string; bytes: number; items: Item[]; note?: string }>; archives: Array<{ name: string; bytes: number; files: number }> };

const mb = (n: number) => n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
const day = (s?: string) => s ? new Date(s).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }) : "";

/** 보관한 자료가 목록에 '만드는 중'으로 남지 않게: 이 브라우저와 서버의 대기 목록에서 그 자료를 뺀다. */
async function dropPending(genIds: string[]) {
  if (!genIds.length) return;
  const gone = new Set(genIds);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("recaller:study:v1:") || !k.endsWith(":pending")) continue;
      const list = JSON.parse(localStorage.getItem(k) || "[]") as Array<{ requestId?: string; artifactId?: string }>;
      localStorage.setItem(k, JSON.stringify(list.filter((p) => !gone.has(p.requestId ?? "") && !gone.has(p.artifactId ?? ""))));
    }
  } catch { /* storage off */ }
  try {
    const r = await fetch("/api/study-records", { cache: "no-store" }).then((x) => x.json()) as { data?: { pending?: Array<{ requestId?: string; artifactId?: string }>; updatedAt?: number } };
    if (r.data?.pending) {
      const data = { ...r.data, pending: r.data.pending.filter((p) => !gone.has(p.requestId ?? "") && !gone.has(p.artifactId ?? "")), updatedAt: Date.now() };
      await fetch("/api/study-records", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    }
  } catch { /* the list just shows it as missing */ }
}

export default function DataPanel({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    setError("");
    try { const r = await fetch("/api/data-admin", { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.message || "불러오지 못했어요."); setView(j as View); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; document.addEventListener("keydown", esc); return () => document.removeEventListener("keydown", esc); }, [onClose]);
  const act = async (label: string, body: Record<string, unknown>, after?: (j: Record<string, unknown>) => Promise<void> | void) => {
    setBusy(label); setMsg(""); setError("");
    try {
      const r = await fetch("/api/data-admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json() as Record<string, unknown>; if (!r.ok) throw new Error(String(j.message || "하지 못했어요."));
      await after?.(j); await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  };
  const toggle = (p: string) => setPicked((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const archivePicked = () => {
    const paths = [...picked];
    if (!paths.length || !confirm(`고른 ${paths.length}개를 보관할까요?\n지우지 않고 데이터 폴더의 보관/로 옮겨요. 이 컴퓨터에만 남고, 다른 컴퓨터에서는 다음에 받을 때 사라져요.`)) return;
    void act("archive", { action: "archive", paths }, async (j) => {
      const moved = (j.moved as string[]) ?? [];
      await dropPending(moved.filter((p) => p.startsWith("study-gen/")).map((p) => p.split("/")[1]));
      setPicked(new Set()); setMsg(`${moved.length}개를 보관했어요(보관/${String(j.label)}). 목록은 화면을 새로 고치면 바뀌어요.`);
    });
  };
  const archiveAll = () => {
    if (!confirm("지금 데이터를 전부 보관하고 비울까요?\n지우지 않고 보관/로 옮겨요. 다음에 앱을 켤 때 이 창의 공부 기록도 한 번 비워요.")) return;
    void act("all", { action: "archiveAll" }, (j) => { setMsg(`전부 보관했어요(보관/${String(j.label)}). 앱을 껐다 켜면 빈 상태로 시작해요.`); });
  };
  const s = view?.sync;
  return (
    <div className="dp-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dp-card" role="dialog" aria-label="데이터 관리">
        <header className="dp-head"><b>데이터 관리</b><button className="dp-x" onClick={onClose} aria-label="닫기">✕</button></header>
        {error ? <p className="dp-err">{error}</p> : null}
        {msg ? <p className="dp-msg">{msg}</p> : null}
        {!view ? <p className="small muted">불러오는 중…</p> : <>
          <section className="dp-sync">
            <div><b>{mb(view.total)}</b> <span className="muted small">· 파일 {view.files}개 · {view.dir}</span></div>
            {s?.repo ? <div className="small">
              동기화 {s.on ? <b>켜짐</b> : <b>꺼짐</b>} <span className="muted">· 앱을 끌 때 올리고 켤 때 받아요 · 마지막 {s.last ?? "?"}{s.changes ? ` · 안 올린 변경 ${s.changes}개` : ""}</span>
              <div className="dp-row">
                <button className="btn small" disabled={!!busy} onClick={() => void act("sync", { action: "sync", on: !s.on })}>{s.on ? "동기화 끄기" : "동기화 켜기"}</button>
                {s.on ? <button className="btn small" disabled={!!busy} onClick={() => void act("push", { action: "push" }, (j) => { setMsg(j.ok ? "올렸어요." : `못 올렸어요: ${String(j.out ?? "").slice(-200)}`); })}>{busy === "push" ? "올리는 중…" : "지금 올리기"}</button> : null}
              </div>
            </div> : <p className="small muted">이 데이터 폴더는 RecallerData 저장소가 아니라서 다른 컴퓨터와 공유되지 않아요.</p>}
          </section>
          {view.groups.map((g) => (
            <details key={g.key} className="dp-group" open={g.key === "gens"}>
              <summary><span>{g.label}</span><span className="muted small">{g.items.length}개 · {mb(g.bytes)}</span></summary>
              {g.note ? <p className="small muted">{g.note}</p> : null}
              {g.items.length ? <ul className="dp-list">{g.items.map((it) => {
                const can = g.key !== "others";
                return <li key={it.path}>
                  {can ? <input type="checkbox" checked={picked.has(it.path)} onChange={() => toggle(it.path)} aria-label={`${it.title} 고르기`} /> : <span className="dp-dot" />}
                  <span className="dp-t" title={it.path}>{it.title}</span>
                  <span className="muted small">{[it.detail, day(it.at), mb(it.bytes)].filter(Boolean).join(" · ")}</span>
                </li>;
              })}</ul> : <p className="small muted">없어요.</p>}
            </details>
          ))}
          <div className="dp-row">
            <button className="btn small" disabled={!!busy || !picked.size} onClick={archivePicked}>고른 {picked.size}개 보관</button>
            <button className="btn small ghost" disabled={!!busy} onClick={archiveAll}>전부 보관하고 비우기</button>
          </div>
          <details className="dp-group">
            <summary><span>보관본 (이 컴퓨터에만)</span><span className="muted small">{view.archives.length}개 · {mb(view.archives.reduce((n, a) => n + a.bytes, 0))}</span></summary>
            {view.archives.length ? <ul className="dp-list">{view.archives.map((a) => <li key={a.name}>
              <span className="dp-t">{a.name}</span><span className="muted small">{a.files}개 · {mb(a.bytes)}</span>
              <button className="btn small ghost" disabled={!!busy} onClick={() => { if (confirm(`보관본 ‘${a.name}’을 지울까요? 되돌릴 수 없어요.`)) void act("del", { action: "deleteArchive", name: a.name }, () => setMsg("지웠어요.")); }}>지우기</button>
            </li>)}</ul> : <p className="small muted">없어요.</p>}
          </details>
        </>}
      </div>
    </div>
  );
}
