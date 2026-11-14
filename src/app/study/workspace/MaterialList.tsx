"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { call, errorText, go, later } from "./api";
import type { MaterialRow } from "./KnowledgeBits";
import { BRANCH_KEY, loadShelfRows, materialEntries, projectOpen, setBranch, shelfSel, type ShelfEntry } from "./shelf";
import { hideMaterial, resumeMaterial, useMaking, type Making } from "./materials";
import { openPeek } from "./SourcePeek";
import "./library.css";
import MaterialMap from "./MaterialMap";

/* 공부 › 자료 (11/12 "같은 틀, 두 얼굴"): 왼쪽은 기억 탭과 같은 자료 목록, 오른쪽은 고른 자료의 자료 지도.
   만드는 중 · 멈춤 · 실패한 자료는 서버 실행 목록(materials.ts)에서 맨 위에. (11/15 리팩토링: 예전 앱의 문제 세트는 뺐다) */
export default function MaterialList() {
  const { making } = useMaking();
  // 왼쪽 목록은 기억 탭과 같은 목록(shelf.ts): 같은 자료 · 같은 순서 · 같은 묶음
  const [rows, setRows] = useState<MaterialRow[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(() => shelfSel.get());
  // 갈래(자료 · 알고리즘 · 실습)는 위 단추 줄이 바꾼다 — 사이드바 목록만 바뀌고, 알고리즘 문제 · 실습을 누르면 그 화면으로 들어간다(11/12 사용자)
  const [branch, setBr] = useState<Branch>(() => { try { const t = localStorage.getItem(BRANCH_KEY); return t === "code" || t === "project" ? t : "material"; } catch { return "material"; } });
  useEffect(() => { const on = (e: Event) => { const b = (e as CustomEvent<Branch>).detail; if (b) setBr(b); }; window.addEventListener("recaller:branch", on); return () => window.removeEventListener("recaller:branch", on); }, []);
  const reloadKey = making.map((m) => `${m.id}:${m.status}`).join(","); // 새 자료가 생기거나 다 만들어지면 목록을 다시
  useEffect(() => { let alive = true; loadShelfRows().then((r) => { if (alive) { setRows(r); setError(""); } }).catch((e) => { if (alive) setError(errorText(e)); }); return () => { alive = false; }; }, [reloadKey]);
  useEffect(() => shelfSel.on((k) => setSel(k)), []);
  const pick = (k: string | null) => { setSel(k); if (k) shelfSel.set(k); };
  const makingOf = (genId: string) => making.find((m) => m.id === genId) ?? null;

  const entries = useMemo<Entry[]>(() => {
    const shelf: Entry[] = materialEntries(rows ?? []);
    const known = new Set(shelf.flatMap((e) => [e.key, ...(e.older ?? []).map((o) => o.key)]));
    // 아직 만드는 중 · 멈춤 · 실패한 자료는 기억 탭에 없지만 공부 탭에는 맨 위에(지도를 보며 기다리거나 이어 만들기)
    const top: Entry[] = making.filter((m) => !known.has(`gen:${m.id}`)).map((m) => ({ key: `gen:${m.id}`, branch: "material", icon: m.status === "failed" ? "⚠" : "⏳",
      title: m.title, sub: m.label, lastAt: new Date().toISOString(), itemIds: [], row: { key: `gen:${m.id}`, group: "material", kind: "pdf", title: m.title, items: 0, itemIds: [], lastAt: "", keys: [], folderId: null, genId: m.id } }));
    return [...top, ...shelf];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, reloadKey]);
  const list = entries.filter((e) => !q.trim() || e.title.toLowerCase().includes(q.trim().toLowerCase()));
  const curTop = entries.find((e) => e.key === sel || e.older?.some((o) => o.key === sel)) ?? null;
  // 처음엔 고른 것이 없으면 가장 최근 자료
  useEffect(() => { if (!sel && entries.length && rows) later(() => setSel(entries[0].key)); }, [sel, entries, rows]);

  // 화면 높이에 맞춰 두 칸이 각자 스크롤(기억 탭과 같은 높이 계산)
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    const fit = () => { const el = box.current; if (!el) return; const top = el.getBoundingClientRect().top; setH(Math.max(420, window.innerHeight - Math.max(0, top) - 14)); };
    fit(); const t = setTimeout(fit, 300);
    window.addEventListener("resize", fit);
    return () => { clearTimeout(t); window.removeEventListener("resize", fit); };
  }, []);

  return (
    <div className="lib study-shelf" ref={box} style={h ? { height: h } : undefined}>
      <aside className="lib-side" aria-label="공부할 자료">
        <input className="lib-find" value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목으로 찾기" aria-label="목록에서 찾기" />
        <nav className="lib-list">
          {branch !== "material" ? <OtherList branch={branch} q={q} /> : list.map((e) => (
            <button key={e.key} className={`lib-row${curTop?.key === e.key ? " on" : ""}`} onClick={() => pick(e.key)} title={e.title}>
              <span className="lib-ic" aria-hidden>{e.icon}</span>
              <span className="lib-rt"><b>{e.title}</b><small>{e.sub}{e.lastAt && !"⏳⚠".includes(e.icon) ? ` · ${ago(e.lastAt)}` : ""}</small></span>
            </button>
          ))}
          {branch === "material" && !rows && !error ? <p className="lib-empty small muted">불러오는 중…</p> : null}
          {branch === "material" && rows && !list.length ? <p className="lib-empty small muted">{q.trim() ? "찾는 제목이 없어요." : "아직 자료가 없어요. 위의 + 새 자료로 PDF를 넣어 보세요."}</p> : null}
        </nav>
      </aside>
      <section className="lib-main">
        <div className="lib-page">
          {error ? <p className="ws-err">{error}</p> : null}
          {branch === "code" ? <CodeLanding /> : branch === "project" ? <ProjectLanding />
            : curTop ? <StudyFace key={curTop.key} top={curTop} pickedKey={sel} onPick={pick} makingOf={makingOf} />
            : <Head icon="📄" title="자료" sub="위의 + 새 자료로 PDF를 넣으면 기억 카드와 자료 지도가 만들어져요." />}
        </div>
      </section>
    </div>
  );
}

type Branch = "material" | "code" | "project";
type Entry = ShelfEntry | (Omit<ShelfEntry, "branch"> & { branch: "material" });
const ago = (iso: string) => { if (!iso) return ""; const d = Math.round((Date.now() - Date.parse(iso)) / 86_400_000); return d <= 0 ? "오늘" : d === 1 ? "어제" : `${d}일 전`; };
const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}/${d.getDate()}`; };
const toMemory = (key: string) => { shelfSel.set(key); setBranch("material"); go("knowledge"); };

function Head({ icon, title, sub, children }: { icon: string; title: string; sub?: string; children?: ReactNode }) {
  return <header className="lib-head"><span className="lib-hic" aria-hidden>{icon}</span><div className="lib-ht"><h2>{title}</h2>{sub ? <p className="small muted">{sub}</p> : null}</div>{children ? <div className="lib-hact">{children}</div> : null}</header>;
}

/* 고른 자료의 공부 얼굴 (11/12 "같은 틀, 두 얼굴"): 기억 탭은 그 자료에 남은 것(기억 카드), 여기는 그 자료로 할 것(지도 · 문제 · 이어 하기). */
function StudyFace({ top, pickedKey, onPick, makingOf }: { top: Entry; pickedKey: string | null; onPick: (k: string) => void; makingOf: (genId: string) => Making | null }) {
  const e = top.older?.find((x) => x.key === pickedKey) ?? top;
  const runs = top.older?.length ? <select className="lib-runs" value={e.key} onChange={(x) => onPick(x.target.value)} aria-label="만든 때 고르기">
    {[top, ...top.older].map((x, i) => <option key={x.key} value={x.key}>{i ? "예전 · " : "최신 · "}{day(x.lastAt)}</option>)}</select> : null;
  // 웹 글: 이어서 읽기
  if (e.row.kind === "web") return <>
    <Head icon="🌐" title={e.title} sub={`${e.sub} · ${day(e.lastAt)}`}><button className="btn small" onClick={() => toMemory(e.key)}>기억 보기 →</button></Head>
    <div className="row"><button className="btn primary" onClick={() => go("web", e.row.sourceId ? { id: e.row.sourceId } : undefined)}>이어서 읽기</button></div>
  </>;
  const genId = e.row.genId ?? "";
  const m = makingOf(genId);
  // 자료 지도를 덮는 화면 대신 오른쪽 칸에 바로 (11/12 사용자 "자료 지도 화면을 버리자"). 줄기 · 구조 · 강의 · 플래시카드 탭은 지도가, 기억 분석은 기억 탭이.
  const extra = <>{runs}
    {e.row.lastAt ? <button className="btn small" onClick={() => toMemory(e.key)}>기억 보기 →</button> : null}</>;
  return <>
    {m && m.status !== "running" ? <MakingNote m={m} /> : null}
    <MaterialMap key={genId} genId={genId} onPage={(p) => openPeek(genId, p)} extra={extra} />
  </>;
}

/* 알고리즘 · 실습 갈래 (11/12 사용자 "실습은 실습으로, 알고리즘은 알고리즘으로 자연스럽게, 들어가면 왼쪽 사이드바가 빠지는 느낌"):
   사이드바에는 그 갈래에서 할 것(문제 · 실습), 누르면 그 화면으로 바로 들어간다(넓은 작업 화면, 위 단추 줄의 ← 목록으로 돌아옴). */
type ProblemLite = { id: string; title: string; status: "new" | "tried" | "wrong" | "solved"; lastAt?: string };
type RunLite = { id: string; title: string; lastAt: string; ended: boolean; goals: number; cards: number };
const P_STATE: Record<ProblemLite["status"], [string, string]> = { solved: ["풂", "good"], wrong: ["틀림", "bad"], tried: ["푸는 중", "help"], new: ["안 풂", ""] };
function useOther<T>(url: string, pick: (r: unknown) => T[]) {
  const [xs, setXs] = useState<T[] | null>(null);
  useEffect(() => { if (!url) return; let alive = true; call<unknown>(url).then((r) => { if (alive) setXs(pick(r)); }).catch(() => { if (alive) setXs([]); }); return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return xs;
}
const problemsOf = (r: unknown) => ((r as { problems?: ProblemLite[] }).problems ?? []).slice().sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
const runsOf = (r: unknown) => ((r as { runs?: RunLite[] }).runs ?? []).slice().sort((a, b) => b.lastAt.localeCompare(a.lastAt));
export const enterCode = (id?: string) => { setBranch("code"); go("code", id ? { id } : {}); };
export const enterProject = (id?: string) => { setBranch("project"); if (id) projectOpen.id = id; go("project"); if (id) window.dispatchEvent(new CustomEvent("recaller:project-open", { detail: id })); };
function OtherList({ branch, q }: { branch: "code" | "project"; q: string }) {
  const probs = useOther<ProblemLite>(branch === "code" ? "/api/code/problems" : "", problemsOf);
  const runs = useOther<RunLite>(branch === "project" ? "/api/project-course/library" : "", runsOf);
  const f = (t: string) => !q.trim() || t.toLowerCase().includes(q.trim().toLowerCase());
  if (branch === "code") {
    if (!probs) return <p className="lib-empty small muted">불러오는 중…</p>;
    const xs = probs.filter((p) => f(p.title));
    return <>{xs.map((p) => <button key={p.id} className="lib-row" onClick={() => enterCode(p.id)} title={`${p.title} — 풀이 화면으로`}>
      <span className="lib-ic" aria-hidden>⌨</span><span className="lib-rt"><b>{p.title.replace(/^BOJ (\d+)번: /, "$1 · ")}</b><small><span className={`sf-st ${P_STATE[p.status][1]}`}>{P_STATE[p.status][0]}</span>{p.lastAt ? ` · ${ago(p.lastAt)}` : ""}</small></span>
      <span className="lib-go" aria-hidden>→</span></button>)}
      {!xs.length ? <p className="lib-empty small muted">{q.trim() ? "찾는 제목이 없어요." : "아직 넣은 문제가 없어요."}</p> : null}</>;
  }
  if (!runs) return <p className="lib-empty small muted">불러오는 중…</p>;
  const xs = runs.filter((r) => f(r.title));
  return <>{xs.map((r) => <button key={r.id} className="lib-row" onClick={() => enterProject(r.id)} title={`${r.title} — 실습 화면으로`}>
    <span className="lib-ic" aria-hidden>🛠</span><span className="lib-rt"><b>{r.title || "(목표를 정하기 전)"}</b><small>{r.ended ? "끝남" : "하는 중"}{r.goals ? ` · 목표 ${r.goals}` : ""} · {ago(r.lastAt)}</small></span>
    <span className="lib-go" aria-hidden>→</span></button>)}
    {!xs.length ? <p className="lib-empty small muted">{q.trim() ? "찾는 제목이 없어요." : "아직 실습 기록이 없어요."}</p> : null}</>;
}
function CodeLanding() {
  const probs = useOther<ProblemLite>("/api/code/problems", problemsOf);
  const n = (st: ProblemLite["status"]) => probs?.filter((p) => p.status === st).length ?? 0;
  const wrong = probs?.filter((p) => p.status === "wrong") ?? [];
  return <>
    <Head icon="⌨" title="알고리즘" sub="왼쪽에서 문제를 누르면 풀이 화면으로 바로 들어가요." />
    {probs ? <div className="counts sf-counts">
      <div><b className="num">{n("solved")}</b><span>푼 문제</span></div><div><b className="num">{n("wrong")}</b><span>틀린 문제</span></div><div><b className="num">{n("new") + n("tried")}</b><span>아직 못 푼 문제</span></div>
    </div> : <p className="small muted">불러오는 중…</p>}
    <div className="row sf-acts">
      <button className="btn primary" onClick={() => enterCode()}>새 문제 고르기 →</button>
      {wrong[0] ? <button className="btn" onClick={() => enterCode(wrong[0].id)}>틀린 문제 다시: {wrong[0].title.replace(/^BOJ /, "")}</button> : null}
    </div>
  </>;
}
function ProjectLanding() {
  const runs = useOther<RunLite>("/api/project-course/library", runsOf);
  const going = runs?.find((r) => !r.ended);
  // 11/13 사용자 "실습 화면 열기 → 새 실습으로 바꿔": 옛 실습 목록 화면을 거치지 않고 빈 실습을 만들어 바로 편집기 · 튜터로
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const startNew = async () => {
    setBusy(true); setErr("");
    try { const out = await call<{ runId: string }>("/api/project-course/free", {}); enterProject(out.runId); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <>
    <Head icon="🛠" title="실습" sub="왼쪽에서 실습을 누르면 그 실습 화면으로 바로 들어가요." />
    <div className="row sf-acts">
      <button className="btn primary" disabled={busy} onClick={() => void startNew()} title="빈 실습을 만들고 편집기 · 튜터로 바로 들어가요. 튜터가 무엇을 만들지부터 물어요">{busy ? "만드는 중…" : "+ 새 실습"}</button>
      {going ? <button className="btn" onClick={() => enterProject(going.id)}>이어 하기: {going.title.slice(0, 30)}</button> : null}
    </div>
    {err ? <p className="small" style={{ color: "var(--bad, #c33)" }}>{err}</p> : null}
  </>;
}

function MakingNote({ m }: { m: Making }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const connect = async () => { try { const { url } = await call<{ url: string }>("/api/auth/chatgpt/start", {}); window.location.assign(url); } catch (x) { setErr(errorText(x)); } };
  const resume = async () => { setBusy(true); setErr(""); try { await resumeMaterial(m.id); } catch (x) { setErr(errorText(x)); } finally { setBusy(false); } };
  return (
    <div className={`note row${m.status === "failed" ? " err" : ""}`} role="status">
      <span style={{ flex: 1, minWidth: 0 }}>{err || m.text}</span>
      {m.login ? <button className="btn small" onClick={() => void connect()}>ChatGPT 연결</button> : null}
      {m.canResume ? <button className="btn small" disabled={busy} onClick={() => void resume()}>{busy ? "시작하는 중…" : "이어 만들기"}</button> : null}
      <button className="btn small ghost" onClick={() => hideMaterial(m.id)} title="목록에서 숨겨요. 만든 기록은 그대로 남아요">목록에서 빼기</button>
    </div>
  );
}
