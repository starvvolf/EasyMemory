"use client";
// 지시문 상자 · 조각 고치기 · 이전 버전 (2026-11-07 사용자): 지시문 요약을 누르면 큰 상자에 지시문이 담기고, 색칠된 지시문 조각마다
// 이름 줄에 작은 [수정]·📁. [수정]은 상자를 하나 더 열어 고치고(타자 치는 동안 바뀐 곳에 형광), [완료]로 끝낸다. 📁은 그 조각의
// 이전 버전들. 고친 것은 "이 호출만 다시"의 초안으로 들어가고, 제품 지시문은 바꾸지 않는다(버전은 <data>/lab/prompt-versions/).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CallView, Facts, Readable, colorMap, splitByPrompt, type Entry, type NamedPrompt } from "./view";
import { TrialPanel, type Original, type TrialBase } from "./trials";

export type DSeg = { where: "system" | "user"; tag: string | null; label: string; key: string; editable: boolean; orig: string; text: string };

/** 원래 글을 조각으로(이어 붙이면 원래 글과 똑같다). 열쇠: 이름 붙은 지시문은 그 이름, 이름 없는 지시문(system)은 단계:sys번호. */
export function makeSegs(system: string, user: string, prompts: NamedPrompt[], step: string): DSeg[] {
  const out: DSeg[] = [];
  const seen = new Map<string, number>();
  for (const where of ["system", "user"] as const) {
    let plain = 0;
    for (const s of splitByPrompt(where === "system" ? system : user, prompts, true)) {
      const text = s.lines.join("\n");
      const base = s.tag ?? (where === "system" ? `${step}:sys${plain++}` : `${step}:data`);
      const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
      const key = n > 1 ? `${base}#${n}` : base;
      const editable = Boolean(s.tag) || (where === "system" && Boolean(text.trim()));
      out.push({ where, tag: s.tag, label: s.tag ? s.label : where === "system" ? "코드가 붙인 지시문" : "자료 · 앞 단계 결과", key, editable, orig: text, text });
    }
  }
  return out;
}
export const joinSegs = (segs: DSeg[], where: "system" | "user") => segs.filter((s) => s.where === where).map((s) => s.text).join("\n");

/* ── 줄 차이(모든 줄, 같은 줄 포함) ── */
type Op = { t: " " | "-" | "+"; s: string };
export function diffOps(a: string, b: string): Op[] {
  const A = a.split("\n"), B = b.split("\n");
  if (A.length * B.length > 400_000) return [...A.map((s) => ({ t: "-" as const, s })), ...B.map((s) => ({ t: "+" as const, s }))];
  const L = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: Op[] = []; let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { out.push({ t: " ", s: A[i] }); i++; j++; }
    // 지운 줄을 먼저 내서(같으면) 바로 뒤의 더한 줄과 짝지을 수 있게
    else if (i < A.length && (j >= B.length || L[i + 1][j] >= L[i][j + 1])) out.push({ t: "-", s: A[i++] });
    else out.push({ t: "+", s: B[j++] });
  }
  return out;
}

/** 고치는 칸: 투명한 textarea 뒤에 같은 글을 깔고, 열 때 글과 달라진 줄·글자에 형광. 지운 줄은 줄 사이에 붉은 표시. */
function HighlightArea({ base, value, onChange }: { base: string; value: string; onChange: (v: string) => void }) {
  const back = useRef<HTMLDivElement>(null);
  const ops = useMemo(() => diffOps(base, value), [base, value]);
  const rendered: ReactNode[] = [];
  let pendingDel: string[] = [];
  ops.forEach((o, k) => {
    if (o.t === "-") { pendingDel.push(o.s); return; }
    const del = pendingDel; pendingDel = [];
    if (o.t === " ") { rendered.push(<span key={k}>{del.length ? <i className="hl-cut" title={`지운 줄 ${del.length}`} /> : null}{o.s}{"\n"}</span>); return; }
    // 바뀐 줄: 바로 앞에서 지운 줄과 짝지어 가운데만 진하게
    const old = del.shift();
    if (old !== undefined) {
      let a = 0; while (a < old.length && a < o.s.length && old[a] === o.s[a]) a++;
      let b = 0; while (b < old.length - a && b < o.s.length - a && old[old.length - 1 - b] === o.s[o.s.length - 1 - b]) b++;
      rendered.push(<span key={k} className="hl-line">{del.length ? <i className="hl-cut" /> : null}{o.s.slice(0, a)}<mark>{o.s.slice(a, o.s.length - b) || "​"}</mark>{o.s.slice(o.s.length - b)}{"\n"}</span>);
    } else rendered.push(<span key={k} className="hl-line"><mark>{o.s || "​"}</mark>{"\n"}</span>);
  });
  if (pendingDel.length) rendered.push(<i key="end" className="hl-cut" />);
  return <div className="hl-wrap">
    <div ref={back} className="hl-back" aria-hidden="true">{rendered}{"\n"}</div>
    <textarea className="hl-front" value={value} spellCheck={false} autoFocus onChange={(e) => onChange(e.target.value)}
      onScroll={(e) => { if (back.current) { back.current.scrollTop = e.currentTarget.scrollTop; back.current.scrollLeft = e.currentTarget.scrollLeft; } }} />
  </div>;
}

type Version = { id: string; at: string; key: string; step: string; label: string; text: string; note: string };
const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
function changedLines(a: string, b: string) { const d = diffOps(a, b); return { add: d.filter((x) => x.t === "+").length, del: d.filter((x) => x.t === "-").length }; }

function Modal({ title, sub, onClose, children, foot, level = 1, wide }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode; level?: number; wide?: boolean }) {
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }; document.addEventListener("keydown", esc, true); return () => document.removeEventListener("keydown", esc, true); }, [onClose]);
  return <div className={`ai-modal-scrim l${level}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={`ai-modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true">
      <div className="ai-modal-head"><div><b>{title}</b>{sub ? <small className="muted"> {sub}</small> : null}</div><button className="btn small" onClick={onClose} aria-label="닫기">닫기</button></div>
      <div className="ai-modal-body">{children}</div>
      {foot ? <div className="ai-modal-foot">{foot}</div> : null}
    </div>
  </div>;
}

/** 📁 이전 버전: 원래(코드) + 저장한 버전들(새것부터). [이 버전 쓰기]. */
function VersionsBox({ seg, onUse, onClose, level }: { seg: DSeg; onUse: (text: string) => void; onClose: () => void; level: number }) {
  const [list, setList] = useState<Version[] | null>(null);
  const [look, setLook] = useState<string | null>(null);
  useEffect(() => { fetch(`/api/lab/ai/prompt-versions?key=${encodeURIComponent(seg.key)}`, { cache: "no-store" }).then((r) => r.json()).then((d: { versions?: Version[] }) => setList([...(d.versions ?? [])].reverse())).catch(() => setList([])); }, [seg.key]);
  const rows: Array<{ id: string; title: string; note: string; text: string }> = [{ id: "orig", title: "원래 (코드에 있는 지시문)", note: "", text: seg.orig }, ...(list ?? []).map((v, i) => ({ id: v.id, title: `버전 ${(list?.length ?? 0) - i} · ${when(v.at)}`, note: v.note, text: v.text }))];
  return <Modal level={level} title={<>📁 이전 버전 · {seg.label}</>} sub={<code>{seg.key}</code>} onClose={onClose}>
    {list === null ? <p className="muted">읽는 중…</p> : <ul className="ai-versions">{rows.map((r) => { const c = changedLines(seg.orig, r.text); const now = r.text === seg.text; return <li key={r.id} className={now ? "now" : ""}>
      <div className="ai-ver-head"><b>{r.title}</b>{r.note ? <span className="muted"> · {r.note}</span> : null}<span className="sp" />
        {r.id !== "orig" ? <small className="num">원래보다 −{c.del} +{c.add}줄</small> : null}{now ? <span className="ai-badge">지금 쓰는 중</span> : null}
        <button className="btn small ghost" onClick={() => setLook(look === r.id ? null : r.id)}>{look === r.id ? "접기" : "보기"}</button>
        <button className="btn small" disabled={now} onClick={() => onUse(r.text)}>이 버전 쓰기</button></div>
      {look === r.id ? <pre className="ai-ver-text">{r.text}</pre> : null}
    </li>; })}</ul>}
    {list && !list.length ? <p className="muted">아직 저장한 버전이 없어요. [수정] → [완료]를 누를 때마다 여기에 쌓여요.</p> : null}
  </Modal>;
}

/** [수정] 상자: 고치고 [완료]. 열 때 글과 달라진 곳은 형광. */
function EditBox({ seg, onDone, onClose, level }: { seg: DSeg; onDone: (text: string, note: string) => Promise<void>; onClose: () => void; level: number }) {
  const [start] = useState(seg.text);
  const [text, setText] = useState(seg.text);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [ver, setVer] = useState(false);
  const c = changedLines(start, text), fromOrig = changedLines(seg.orig, text);
  return <>
    <Modal level={level} wide title={<>수정 · {seg.label}</>} sub={<code>{seg.key}</code>} onClose={onClose}
      foot={<>
        <button className="btn small ghost" onClick={() => setVer(true)}>📁 이전 버전</button>
        <button className="btn small ghost" disabled={text === start} onClick={() => setText(start)}>열 때 글로</button>
        <button className="btn small ghost" disabled={text === seg.orig} onClick={() => setText(seg.orig)}>원래(코드)로</button>
        <small className="muted num">이번에 −{c.del} +{c.add}줄 · 원래보다 −{fromOrig.del} +{fromOrig.add}줄 · {text.length.toLocaleString()}자</small>
        <span className="sp" />
        <input className="ai-note" placeholder="메모 (무엇을 바꿨나, 버전 목록에 남음)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn primary" disabled={busy || text === start} onClick={() => { setBusy(true); void onDone(text, note).finally(() => setBusy(false)); }}>{busy ? "저장 중…" : "완료"}</button>
      </>}>
      <p className="muted small" style={{ margin: "0 0 8px" }}>형광 = 열 때보다 바뀐 곳, 붉은 줄 = 지운 줄이 있던 자리. 제품 지시문은 그대로이고, 이 고친 글은 아래 &ldquo;이 호출만 다시&rdquo;에 들어가요.</p>
      <HighlightArea base={start} value={text} onChange={setText} />
    </Modal>
    {ver ? <VersionsBox level={level + 1} seg={{ ...seg, text }} onUse={(t) => { setText(t); setVer(false); }} onClose={() => setVer(false)} /> : null}
  </>;
}

/** 지시문 상자: system · user를 나란히, 지시문 조각마다 이름 줄에 [수정]·📁. */
function PromptBox({ title, segs, colors, step, onEdit, onVersions, onReset, onTry, onClose }: { title: string; segs: DSeg[]; colors: Record<string, string>; step: string;
  onEdit: (i: number) => void; onVersions: (i: number) => void; onReset: () => void; onTry: () => void; onClose: () => void }) {
  const edited = segs.filter((s) => s.text !== s.orig);
  const col = (where: "system" | "user") => segs.map((s, i) => ({ s, i })).filter(({ s }) => s.where === where && s.text.trim()).map(({ s, i }) =>
    <div key={i} className={`ai-seg ${s.tag ? colors[s.tag] ?? "p0" : s.where === "system" ? "plain" : "data"} ${s.text !== s.orig ? "edited" : ""}`}>
      <div className="ai-seg-tag"><span>{s.tag || s.where === "system" ? "지시문 · " : ""}{s.label}</span>{s.tag ? <code>{s.tag}</code> : null}{s.text !== s.orig ? <span className="ai-badge">고침</span> : null}
        <span className="sp" />{s.editable ? <><button className="ai-mini" onClick={() => onEdit(i)}>수정</button><button className="ai-mini" title="이전 버전" onClick={() => onVersions(i)}>📁</button></> : null}</div>
      {s.editable ? <div className="ai-text">{s.text.trim()}</div> : <Readable text={s.text.trim()} />}
    </div>);
  return <Modal level={1} wide title={<>지시문 · {title}</>} sub={step} onClose={onClose}
    foot={<><small className="muted">{edited.length ? `고친 조각 ${edited.length}개: ${edited.map((s) => s.label).join(", ")}` : "고친 조각 없음 — 색칠된 조각의 [수정]으로 고쳐요"}</small><span className="sp" />
      {edited.length ? <button className="btn small ghost" onClick={onReset}>모두 원래대로</button> : null}
      <button className="btn primary" disabled={!edited.length} onClick={onTry}>이 지시문으로 다시 돌려 보기 ›</button></>}>
    <div className="ai-box-cols">
      <section><h3>지시문 (system) <small className="num">{joinSegs(segs, "system").length.toLocaleString()}자</small></h3>{col("system")}</section>
      <section><h3>넣은 것 (user) <small className="num">{joinSegs(segs, "user").length.toLocaleString()}자</small></h3>{col("user")}</section>
    </div>
  </Modal>;
}

/** 호출 하나 + 지시문 상자 + 이 호출만 다시. 지시문 초안(조각)은 여기서 갖고 있다. */
export function CallBlock({ entry, label, facts, system, user, reply, error, extra, prompts, step, trial }: {
  entry: Entry | null; label: string; facts: Parameters<typeof Facts>[0]; system: string; user: string; reply: string; error?: string | null; extra?: ReactNode;
  prompts: NamedPrompt[]; step: string; trial?: { base: TrialBase; orig: Original; models: string[]; efforts: string[]; images?: boolean } }) {
  const [segs, setSegs] = useState(() => makeSegs(system, user, prompts, step));
  const [box, setBox] = useState(false);
  const [edit, setEdit] = useState<number | null>(null);
  const [vers, setVers] = useState<number | null>(null);
  const [openSignal, setOpenSignal] = useState(0);
  const colors = useMemo(() => colorMap([system, user], prompts), [system, user, prompts]);
  const draft = { system: joinSegs(segs, "system"), user: joinSegs(segs, "user") };
  const setRaw = (s: string, u: string) => {
    // 시도 칸에서 글 전체를 고친 경우: 다시 조각으로 나누고, 같은 열쇠의 원래 글은 지킨다.
    const origByKey = new Map(makeSegs(system, user, prompts, step).map((x) => [x.key, x.orig]));
    setSegs(makeSegs(s, u, prompts, step).map((x) => ({ ...x, orig: origByKey.get(x.key) ?? x.orig })));
  };
  const apply = (i: number, text: string) => setSegs((xs) => xs.map((x, k) => (k === i ? { ...x, text: text.replace(/\s+$/, "") + (x.orig.match(/\s*$/)?.[0] ?? "") } : x)));
  const done = async (i: number, text: string, note: string) => {
    const s = segs[i];
    await fetch("/api/lab/ai/prompt-versions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: s.key, step, label: s.label, text, note }) }).catch(() => undefined);
    apply(i, text); setEdit(null);
  };
  return <>
    <CallView entry={entry} label={label} facts={facts} system={system} user={user} reply={reply} error={error} extra={extra} prompts={prompts} onPrompts={() => setBox(true)} />
    {box ? <PromptBox title={entry?.title ?? label} segs={segs} colors={colors} step={step} onEdit={setEdit} onVersions={setVers} onClose={() => setBox(false)}
      onReset={() => setSegs((xs) => xs.map((x) => ({ ...x, text: x.orig })))} onTry={() => { setBox(false); setOpenSignal((n) => n + 1); }} /> : null}
    {edit !== null ? <EditBox level={2} seg={segs[edit]} onDone={(t, n) => done(edit, t, n)} onClose={() => setEdit(null)} /> : null}
    {vers !== null ? <VersionsBox level={2} seg={segs[vers]} onUse={(t) => { apply(vers, t); setVers(null); }} onClose={() => setVers(null)} /> : null}
    {trial ? <TrialPanel base={trial.base} step={step} orig={trial.orig} models={trial.models} efforts={trial.efforts} images={trial.images} prompts={prompts}
      draft={{ ...draft, set: setRaw }} openSignal={openSignal} onOpenPrompts={() => setBox(true)} /> : null}
  </>;
}
