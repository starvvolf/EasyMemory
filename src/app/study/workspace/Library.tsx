"use client";
// 기억 도서관 (2026-11-11 사용자 "기억 탭을 없애자 … 왼쪽에는 뭐 했는지 있는 목록, 메인 화면은 그 목록 누르면 보여줘야 되는 것들, 밑에다가 채팅창 하나.
// 기억을 다시 보는 도서관 같은 걸"): 예전 기억 탭(KnowledgeTabs · 폴더 기억 창)을 통째로 바꾼다(사용자 "완전히 바꿈").
//   위: 갈래 셋(자료 · 알고리즘 · 실습) / 왼쪽: 그 갈래에서 한 것 목록 / 가운데: 고른 것의 내용 / 아래: 이 내용을 두고 AI에게 묻는 채팅.
//   실습은 "실습 한 판 정리"(지나온 목표 · 기억 카드 · 막힌 순간 · 받아 쓴 것, 실습 서버 lib/library.ts) — 사용자 고름.
//   채팅은 기존 /api/knowledge/ask(내 기억 전체 요약 + 지금 화면 글 + 관련 기억)를 쓴다. 묻는 만큼 AI 사용량이 든다.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { call, errorText, go, handoff, later, type ItemLite, type Tree } from "./api";
import { MaterialArticle, StateChip, tidyLine, type MaterialRow } from "./KnowledgeWindow";
import LearnerNote from "./LearnerNote";
import { MemoryShelf } from "./MaterialMap";
import { Inline, Rich } from "./Rich";
import "./library.css";

type Branch = "material" | "code" | "project";
const BRANCHES: Array<[Branch, string]> = [["material", "자료"], ["code", "알고리즘"], ["project", "실습"]];
const KEY = "recaller:lib-branch";
type Entry = { key: string; branch: Branch; icon: string; title: string; sub: string; lastAt: string; itemIds: string[]; row?: MaterialRow; runId?: string; pages?: number; log?: SolveLog;
  /** 같은 PDF를 다시 만든 예전 실행(11/11): 목록에는 최신 하나만, 예전 것은 내용 머리에서 고른다 */ older?: Entry[] };
type RunRow = { id: string; title: string; createdAt: string; lastAt: string; ended: boolean; goals: number; cards: number; moments: number; gaps: number };
type Msg = { role: "me" | "ai"; text: string };

const ago = (iso: string) => { if (!iso) return ""; const d = Math.round((Date.now() - Date.parse(iso)) / 86_400_000); return d <= 0 ? "오늘" : d === 1 ? "어제" : `${d}일 전`; };
const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}/${d.getDate()}`; };

export default function Library() {
  const [branch, setBranch] = useState<Branch>(() => { try { const t = localStorage.getItem(KEY); return t === "code" || t === "project" ? t : "material"; } catch { return "material"; } });
  const [rows, setRows] = useState<MaterialRow[] | null>(null);
  const [items, setItems] = useState<ItemLite[]>([]);
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [runsOnline, setRunsOnline] = useState(true);
  const [logs, setLogs] = useState<SolveLog[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [v, t, g, lib] = await Promise.all([call<{ materials: MaterialRow[] }>("/api/knowledge/material-view"), call<Tree>("/api/knowledge"),
        call<{ runs: Array<{ id: string; createdAt: string; status: string; fileName: string; pages: number[]; sectionCount?: number }> }>("/api/lab/gen?origin=study").catch(() => ({ runs: [] })),
        call<{ online: boolean; runs: RunRow[] }>("/api/project-course/library").catch(() => ({ online: false, runs: [] as RunRow[] }))]);
      // 알고리즘: 기억 줄이 아니라 문제마다 풀이 일지(PS 튜터, B의 /api/code/tutor/logs)
      void call<{ logs: SolveLog[] }>("/api/code/tutor/logs").then((r) => setLogs(r.logs)).catch(() => setLogs([]));
      // 자료(PDF)는 실제로 만든 자료(study-gen) 기준, 기억은 같은 자료 줄(genId)에서 가져온다
      const pdfRows = v.materials.filter((r) => r.group === "material" && r.kind === "pdf");
      const pdfs: MaterialRow[] = g.runs.filter((r) => r.status === "done" || r.status === "cards").map((r) => {
        const same = pdfRows.find((x) => x.genId === r.id);
        return { key: `gen:${r.id}`, group: "material", kind: "pdf", title: r.fileName.replace(/\.pdf$/i, ""), items: same?.items ?? r.sectionCount ?? 0, itemIds: same?.itemIds ?? [],
          lastAt: same?.lastAt && same.lastAt > r.createdAt ? same.lastAt : r.createdAt, keys: same?.keys ?? [], folderId: null, genId: r.id, pages: r.pages.length } as MaterialRow & { pages: number };
      });
      setRows([...pdfs, ...v.materials.filter((r) => !(r.group === "material" && r.kind === "pdf"))]); setItems(t.items);
      setRuns(lib.runs); setRunsOnline(lib.online);
    } catch (e) { setError(errorText(e)); }
  }, []);
  useEffect(() => later(() => void load()), [load]);
  // 다른 화면에서 "이 기억 보기"로 왔을 때(go("knowledge", { id }))
  useEffect(() => {
    const open = (id?: string) => { if (id) { setItemId(id); handoff.knowledgeId = undefined; } };
    open(handoff.knowledgeId);
    const on = (e: Event) => open((e as CustomEvent<{ id?: string }>).detail?.id);
    window.addEventListener("recaller:knowledge-focus", on);
    return () => window.removeEventListener("recaller:knowledge-focus", on);
  }, []);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const entries = useMemo<Entry[]>(() => {
    const allMat: Entry[] = (rows ?? []).filter((r) => r.group === "material").map((r) => ({ key: r.key, branch: r.group as Branch, row: r, itemIds: r.itemIds, lastAt: r.lastAt, title: r.title,
      icon: r.kind === "web" ? "🌐" : r.group === "code" ? "⌨" : "📄", pages: (r as MaterialRow & { pages?: number }).pages,
      // PDF 기억 수는 자료 지도의 카드 수(펼치면 보임) — 저장소 항목 수는 합쳐진 수라 다르다(11/11 지도 32 · 도서관 27)
      sub: r.key.startsWith("gen:") ? `${(r as MaterialRow & { pages?: number }).pages ?? "?"}쪽` : `기억 ${r.items}` }));
    // 같은 PDF(같은 제목 · 같은 쪽 수)를 여러 번 만들었으면 최신 하나만 목록에(11/11 — 기억 저장소가 같은 이름을 합쳐 예전 실행 글이 섞여 보였다)
    const latest = new Map<string, Entry>();
    for (const e of [...allMat].sort((a, b) => b.lastAt.localeCompare(a.lastAt))) {
      const k = e.key.startsWith("gen:") ? `${e.title}|${e.pages ?? ""}` : e.key;
      const top = latest.get(k);
      if (top) (top.older ??= []).push(e); else latest.set(k, e);
    }
    const mat = [...latest.values()].map((e) => e.older?.length ? { ...e, sub: `${e.sub} · ${e.older.length + 1}번 만듦` } : e);
    // 실습: 실습 서버의 대화 실습 한 줄씩 + 그 실습에서 앱 기억으로 넘어간 것(ref project:<runId>)
    const projRows = (rows ?? []).filter((r) => r.group === "project");
    const proj: Entry[] = (runs ?? []).map((r) => {
      const mine = projRows.filter((x) => x.keys.includes(`code:project:${r.id}`)).flatMap((x) => x.itemIds);
      return { key: `run:${r.id}`, branch: "project", runId: r.id, icon: "🛠", title: r.title || "(목표를 정하기 전)", lastAt: r.lastAt, itemIds: mine,
        sub: [r.goals ? `목표 ${r.goals}` : "", r.cards ? `카드 ${r.cards}` : "", r.moments ? `막힘 ${r.moments}` : ""].filter(Boolean).join(" · ") || "기록 없음" };
    });
    // 알고리즘: 문제 하나에 한 줄(그 문제에서 생긴 기억 id는 채팅에 붙이려고 같은 문제 번호의 기억 줄에서)
    const codeRows = (rows ?? []).filter((r) => r.group === "code");
    const code: Entry[] = (logs ?? []).map((l) => ({ key: `ps:${l.number}`, branch: "code", icon: "⌨", title: `${l.number}${l.title ? ` · ${l.title}` : ""}`, lastAt: l.at, log: l,
      itemIds: codeRows.filter((r) => r.keys.some((k) => k.includes(l.number)) || r.title.includes(l.number)).flatMap((r) => r.itemIds),
      sub: [l.alone ? "혼자 풂" : l.solved ? "도움 받고 풂" : "아직 못 풂", l.stuck ? `막힌 곳 ${STUCK[l.stuck] ?? l.stuck}` : ""].filter(Boolean).join(" · ") }));
    return [...mat, ...code, ...proj].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }, [rows, runs, logs]);
  const list = entries.filter((e) => e.branch === branch && (!q.trim() || e.title.toLowerCase().includes(q.trim().toLowerCase())));
  const cur = entries.find((e) => e.key === sel) ?? null;
  const pick = (b: Branch) => { setBranch(b); setSel(null); setItemId(null); try { localStorage.setItem(KEY, b); } catch { /* storage off */ } };
  const choose = (k: string | null) => { setSel(k); setItemId(null); };

  // 화면 높이에 맞춰 세 칸이 각자 스크롤되게(앱 머리 아래부터 창 끝까지)
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    const fit = () => { const el = box.current; if (!el) return; const top = el.getBoundingClientRect().top + window.scrollY; setH(Math.max(420, window.innerHeight - Math.max(0, top - window.scrollY) - 14)); };
    fit(); const t = setTimeout(fit, 300);
    window.addEventListener("resize", fit);
    return () => { clearTimeout(t); window.removeEventListener("resize", fit); };
  }, []);

  const main = useRef<HTMLDivElement>(null);
  const counts = (b: Branch) => entries.filter((e) => e.branch === b).length;
  const empty = !rows ? "불러오는 중…" : branch === "material" ? "아직 자료가 없어요. 공부 › 자료에서 PDF나 웹 글로 자료를 만들면 여기 꽂혀요."
    : branch === "code" ? "아직 푼 문제가 없어요. 알고리즘 문제를 풀면 풀이 노트가 여기 꽂혀요." : !runsOnline ? "실습 서버가 꺼져 있어 실습 목록을 못 불러왔어요. 실습 탭을 열면 켜져요." : "아직 실습 기록이 없어요.";

  return (
    <div className="lib" ref={box} style={h ? { height: h } : undefined}>
      <aside className="lib-side" aria-label="기억 목록">
        <div className="lib-seg" role="tablist" aria-label="기억 갈래">{BRANCHES.map(([b, label]) => (
          <button key={b} role="tab" aria-selected={branch === b} className={branch === b ? "on" : ""} onClick={() => pick(b)}>{label}{rows ? <small>{counts(b)}</small> : null}</button>
        ))}</div>
        <input className="lib-find" value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목으로 찾기" aria-label="목록에서 찾기" />
        <nav className="lib-list">
          {branch === "project" ? <button className={`lib-row pin${sel === "note" ? " on" : ""}`} onClick={() => choose("note")}>
            <span className="lib-ic" aria-hidden>📒</span><span className="lib-rt"><b>나의 학습 노트</b><small>모든 실습을 모은 한 장</small></span></button> : null}
          {list.map((e) => (
            <button key={e.key} className={`lib-row${sel === e.key ? " on" : ""}`} onClick={() => choose(e.key)} title={e.title}>
              <span className="lib-ic" aria-hidden>{e.icon}</span>
              <span className="lib-rt"><b>{e.title}</b><small>{e.sub}{e.lastAt ? ` · ${ago(e.lastAt)}` : ""}</small></span>
            </button>
          ))}
          {!list.length ? <p className="lib-empty small muted">{q.trim() ? "찾는 제목이 없어요." : empty}</p> : null}
        </nav>
      </aside>
      <section className="lib-main">
        <div className="lib-page" ref={main}>
          {error ? <p className="ws-err">{error}</p> : null}
          {itemId ? <ItemView id={itemId} onBack={() => setItemId(null)} backLabel={cur ? `← ${cur.title}` : "← 목록으로"} onPick={setItemId} />
            : sel === "note" ? <><Head icon="📒" title="나의 학습 노트" sub="여러 실습에서 드러난 아직 모르는 것 · 자꾸 틀리는 것 · 이제 되는 것 · 내 환경" /><LearnerNote /></>
            : cur ? <EntryView key={cur.key} e={cur} byId={byId} onItem={setItemId} />
            : <Welcome branch={branch} n={list.length} />}
        </div>
        <Chat key={sel ?? branch} pageRef={main} focusIds={itemId ? [itemId] : (cur?.itemIds ?? []).slice(0, 6)}
          where={itemId ? `기억 하나: ${byId.get(itemId)?.title ?? ""}` : sel === "note" ? "나의 학습 노트" : cur ? `${BRANCHES.find((b) => b[0] === cur.branch)?.[1]} · ${cur.title}` : `${BRANCHES.find((b) => b[0] === branch)?.[1]} 목록`} />
      </section>
    </div>
  );
}

function Head({ icon, title, sub, children }: { icon: string; title: string; sub?: string; children?: ReactNode }) {
  return <header className="lib-head"><span className="lib-hic" aria-hidden>{icon}</span><div className="lib-ht"><h2>{title}</h2>{sub ? <p className="small muted">{sub}</p> : null}</div>{children ? <div className="lib-hact">{children}</div> : null}</header>;
}
function Welcome({ branch, n }: { branch: Branch; n: number }) {
  const what = branch === "material" ? "읽은 자료" : branch === "code" ? "푼 문제" : "해 본 실습";
  return <div className="lib-welcome"><p className="lib-big">📚</p><h2>기억 도서관</h2><p className="muted">왼쪽에서 {what}{n ? ` ${n}개` : ""} 중 하나를 고르면, 그때 남은 기억이 여기 펼쳐져요.<br />아래 채팅에 물으면 내 기억을 보고 답해요.</p></div>;
}

function ItemList({ ids, byId, onItem }: { ids: string[]; byId: Map<string, ItemLite>; onItem: (id: string) => void }) {
  const xs = ids.map((id) => byId.get(id)).filter((i): i is ItemLite => Boolean(i));
  if (!xs.length) return <p className="small muted">아직 여기서 넘어온 기억이 없어요.</p>;
  return <ul className="lib-items">{xs.map((i) => <li key={i.id}><button className="lib-item" onClick={() => onItem(i.id)}>
    <span className="lib-it"><StateChip state={i.state} graduated={i.graduated} /><b><Inline text={i.title} /></b></span>
    {i.line ? <span className="lib-il"><Inline text={tidyLine(i.line)} /></span> : null}</button></li>)}</ul>;
}

function EntryView({ e: top, byId, onItem }: { e: Entry; byId: Map<string, ItemLite>; onItem: (id: string) => void }) {
  // 같은 PDF의 예전 실행을 고르면 그 실행의 기억으로(목록 줄은 최신 하나)
  const [pickKey, setPickKey] = useState(top.key);
  const e = top.older?.find((x) => x.key === pickKey) ?? top;
  if (e.branch === "project" && e.runId) return <RunView e={e} />;
  if (e.branch === "code" && e.log) return <SolveView log={e.log} />;
  if (e.branch === "material" && e.row?.kind === "web" && e.row.sourceId) return <><Head icon="🌐" title={e.title} sub={`${e.sub} · ${day(e.lastAt)}`} /><MaterialArticle id={e.row.sourceId} onChanged={() => {}} /></>;
  // PDF: 자료 지도와 같은 최신 기억 카드(영역 순서 + 내 상태), 11/11
  if (e.branch === "material" && e.row?.genId) return <>
    <Head icon={e.icon} title={e.title} sub={`${e.pages ?? "?"}쪽 · ${day(e.lastAt)}`}>
      {top.older?.length ? <select className="lib-runs" value={e.key} onChange={(x) => setPickKey(x.target.value)} aria-label="만든 때 고르기">
        {[top, ...top.older].map((x, i) => <option key={x.key} value={x.key}>{i ? "예전 · " : "최신 · "}{day(x.lastAt)} {x.title === top.title ? "" : x.title}</option>)}</select> : null}
      <button className="btn small" onClick={() => window.dispatchEvent(new CustomEvent("recaller:map-open", { detail: { genId: e.row!.genId } }))}>자료 지도 열기 ↗</button>
    </Head>
    <MemoryShelf genId={e.row.genId} title={e.title} onHistory={onItem} />
  </>;
  return <>
    <Head icon={e.icon} title={e.title} sub={`${e.sub} · ${day(e.lastAt)}`}>
      {e.row?.genId ? <button className="btn small" onClick={() => window.dispatchEvent(new CustomEvent("recaller:map-open", { detail: { genId: e.row!.genId } }))}>자료 지도 열기 ↗</button> : null}
      {e.branch === "code" ? <button className="btn ghost small" onClick={() => go("code")}>알고리즘 탭에서 보기</button> : null}
    </Head>
    <p className="eyebrow">여기서 생긴 기억</p>
    <ItemList ids={e.itemIds} byId={byId} onItem={onItem} />
  </>;
}

/* ---------- 실습 한 판 정리 ---------- */
type Card = { name: string; situation: string; did: string; quote: string; learned: string; next: string; how: string; recheck: string };
type GoalRec = { goal: string; status: string; summary: string; steps: string[]; from: string; to: string; cards: Card[] };
type PGoal = { title: string; at: string; endAt: string | null; result: string; gaps: Array<{ id: string; name: string; wrong: string; status: string }> };
type Moment = { id: string; goal: string; by: string; command?: string; error?: string; gap?: string; reasons?: string; said: string[]; tries: number; how?: string; seconds: number; changed: Array<{ file: string; diff: string[] }> };
type SceneEv = { g?: number; at: string; kind: "me" | "tutor" | "button" | "cmd" | "save" | "note"; text: string; tools?: string[]; ok?: boolean; diff?: string[]; file?: string; err?: string };
type Chapter = { goal: string; from: string; to: string; events: SceneEv[] };
type RunLib = { online: boolean; title?: string; map?: string[]; current?: string | null; goals?: GoalRec[]; path?: PGoal[]; moments?: Moment[]; scenes?: Chapter[]; diary?: Diary | null; chunks?: Array<{ name: string; result: string | null; debts: string[] }> };
const RES: Record<string, string> = { 마침: "ok", "너무 쉬움": "ok", 건너뜀: "skip", 멈춤: "skip", "진행 중": "now" };
const mins = (a: string, b: string | null) => { if (!b) return ""; const m = Math.round((Date.parse(b) - Date.parse(a)) / 60000); return m < 1 ? "1분 안" : m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60}분`; };
const hm = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

/** 여러 줄 글: 줄마다 Inline(코드 · 굵게), 길면 접기 */
function Para({ text, clamp = 520 }: { text: string; clamp?: number }) {
  const [open, setOpen] = useState(false);
  const long = text.length > clamp;
  let shown = (long && !open ? `${text.slice(0, clamp).trimEnd()}…` : text).replace(/\*\*([^*\n]+)\*\*/g, "$1");
  if ((shown.match(/```/g) ?? []).length % 2) shown += "\n```"; // 접다가 코드 칸 중간에서 끊기면 닫아 준다
  return <><Rich text={shown} className="rp-rich" />{long ? <button className="linkish small" onClick={() => setOpen(!open)}>{open ? "접기" : "더 보기"}</button> : null}</>;
}
// 튜터 도구 이름 → 쉬운 말(모르는 이름은 그대로)
const TOOL: Record<string, string> = { check_prereq: "선행 확인", set_prereqs: "선행 적기", new_names: "새 이름 알려 줌", set_current_goal: "현재 목표 정함", propose_plan: "계획 세우기", set_long_goal: "장기 목표 정함",
  read: "파일 읽기", glob: "파일 찾기", grep: "코드 찾기", run_snippet: "코드 조각 실행", edit: "파일 고침", write: "파일 씀", patch: "파일 고침", search_history: "지난 기록 찾기", learner_profile: "학습자 메모리 보기" };
function Scene({ ev }: { ev: SceneEv }) {
  if (ev.kind === "me") return <div className="rp-row me"><div className="rp-b me"><Para text={ev.text} /></div><span className="rp-t">{hm(ev.at)}</span></div>;
  if (ev.kind === "tutor") return <div className="rp-row"><span className="rp-who" aria-hidden>🧑‍🏫</span><div className="rp-b tutor">{ev.text ? <Para text={ev.text} /> : null}
    {ev.tools?.length ? <p className="rp-tools">{[...new Set(ev.tools.map((t) => TOOL[t] ?? t))].map((t) => <span key={t}>{t}</span>)}</p> : null}</div></div>;
  if (ev.kind === "cmd") return <div className={`rp-cmd ${ev.ok === false ? "bad" : ev.ok ? "ok" : ""}`}><code>$ {ev.text}</code><span>{ev.ok === false ? "오류" : ev.ok ? "성공" : ""}</span>{ev.err ? <pre>{ev.err}</pre> : null}</div>;
  if (ev.kind === "save") return <div className="rp-save"><span className="small muted">💾 {ev.file} 저장 · {hm(ev.at)}</span>{ev.diff?.length ? <pre className="lib-diff">{ev.diff.join("\n")}</pre> : null}</div>;
  // 버튼: 판정이면 색으로(맞음 초록 · 일부 · 틀림 빨강)
  const verdict = /판정: 맞음/.test(ev.text) ? "ok" : /판정: (일부|틀림)/.test(ev.text) ? "bad" : "";
  const [head, ...rest] = ev.text.split(" · ");
  return <div className={`rp-btn ${verdict}`}><span className="rp-pill">{head}</span>{rest.length ? <span className="rp-bt">{rest.join(" · ")}</span> : null}</div>;
}

/* ---------- 실습 일지(11/12 사용자 "AI의 손길이 한번 닿아서 요약이 딱 … 저장할 때 AI가 돌리고 여기서는 보여주기만"): 실습 서버 lib/diary.ts가 쓴 것.
 * 줄마다 근거 기록 번호(g)가 있어서, 올리면 그때 장면 앞부분, 누르면 아래 '장면 전체'의 그 자리로. */
type Diary = { at: string; upto: number; why: string; intro?: string; line: string; story: Array<{ g: number | null; tag: string; doing?: string; text: string }>; left: string[] };
// 판이 바뀐 것(목표 · 목표 바꿈 · 보충)은 점 없이 둥근 상자로, 배운 일은 점이 찍힌 줄로(11/12 사용자 "시스템이 바뀌는 거는 구분")
const SYS_TAGS = new Set(["목표", "목표 바꿈", "바꿈", "보충"]);
const TAG: Record<string, [string, string]> = { 목표: ["🎯", "goal"], "목표 바꿈": ["🔀", "turn"], 바꿈: ["🔀", "turn"], 보충: ["🧩", "sup"], 막힘: ["🧱", "bad"], "알게 됨": ["💡", "ok"], 해냄: ["✅", "ok"], 도움: ["🛠", "help"], 넘어감: ["⏭", ""] };
const clipT = (s: string, n: number) => { const t = s.replace(/```[\s\S]*?```/g, " [코드] ").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
/** 근거 장면 앞부분(올렸을 때): 그 기록과 바로 뒤 튜터 답 */
function tipOf(evs: SceneEv[], i: number) {
  const e = evs[i]; if (!e) return "";
  const who = e.kind === "me" ? "나" : e.kind === "tutor" ? "튜터" : e.kind === "cmd" ? "터미널" : e.kind === "button" ? "버튼" : e.kind === "save" ? "저장" : "바뀜";
  const next = e.kind === "me" ? evs.slice(i + 1).find((x) => x.kind === "tutor") : undefined;
  return `${hm(e.at)} ${who}: ${clipT(e.kind === "cmd" ? `${e.text}${e.err ? ` → ${e.err}` : ""}` : e.text, 360)}${next ? `\n\n튜터: ${clipT(next.text, 420)}` : ""}`;
}

function RunView({ e }: { e: Entry }) {
  const [d, setD] = useState<RunLib | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [hl, setHl] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [wErr, setWErr] = useState("");
  const writeNow = async () => {
    setWriting(true); setWErr("");
    try { const r = await call<{ diary: Diary | null }>(`/api/project-course/runs/${encodeURIComponent(e.runId!)}/diary`, { force: Boolean(d?.diary) }); if (r.diary) setD((x) => (x ? { ...x, diary: r.diary } : x)); else setWErr("쓸 만한 기록이 아직 적어요."); }
    catch (x) { setWErr(errorText(x)); } finally { setWriting(false); }
  };
  useEffect(() => later(() => { setD(null); setOpen(new Set()); call<RunLib>(`/api/project-course/runs/${encodeURIComponent(e.runId!)}/library`).then(setD).catch((x) => setError(errorText(x))); }), [e.runId]);
  // 한눈에 보기의 줄을 누르면: 그 장을 펼치고 그 자리로 스크롤 + 잠깐 밝게
  const jump = (ci: number, k: number) => {
    setOpen((s) => new Set(s).add(ci)); const id = `rp-ev-${ci}-${k}`; setHl(id);
    setTimeout(() => { // 가운데 칸만 움직인다(창 전체가 밀리지 않게)
      const el = document.getElementById(id), box = el?.closest(".lib-page") as HTMLElement | null;
      if (el && box) box.scrollTo({ top: box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 3, behavior: "smooth" });
    }, 60);
    setTimeout(() => setHl((x) => (x === id ? null : x)), 2600);
  };
  const head = <Head icon="🛠" title={e.title} sub={`${day(e.lastAt)} · ${e.sub}`}><button className="btn ghost small" onClick={() => go("project")}>실습 탭 열기</button></Head>;
  if (error) return <>{head}<p className="ws-err">{error}</p></>;
  if (!d) return <>{head}<p className="small muted">실습 기록을 불러오는 중…</p></>;
  if (!d.online) return <>{head}<p className="small muted">실습 서버가 꺼져 있어요. 실습 탭을 열면 켜져요.</p></>;
  const recs = d.goals ?? [], ms = d.moments ?? [], chunks = d.chunks ?? [], scenes = d.scenes ?? [];
  const path = d.path ?? [];
  const done = recs.filter((r) => r.status === "마침").length;
  const cards = recs.reduce((n, r) => n + r.cards.length, 0);
  const resultOf = (c: Chapter) => recs.find((r) => r.goal === c.goal)?.status ?? path.find((g) => g.title === c.goal)?.result ?? "";
  const numOf = (i: number) => (scenes[i].goal ? scenes.slice(0, i + 1).filter((x) => x.goal).length : 0);
  // 기록 번호 → (장, 칸)
  const where = new Map<number, [number, number]>(); scenes.forEach((c, ci) => c.events.forEach((x, k) => { if (x.g !== undefined) where.set(x.g, [ci, k]); }));
  const total = scenes.reduce((n, c) => n + c.events.length, 0);
  const stale = Boolean(d.diary && d.diary.upto < total);
  return <>
    {head}
    <div className="lib-stats">
      <span><b>{scenes.filter((c) => c.goal).length || path.length}</b>목표</span><span><b>{done}</b>마침</span><span><b>{ms.length}</b>막힌 순간</span><span><b>{cards}</b>남은 것</span>
    </div>
    <section className="lib-sec dy"><h3>실습 일지 {d.diary ? <span className="small muted">— {day(d.diary.at)} {hm(d.diary.at)} · {d.diary.why}</span> : null}</h3>
      {d.diary ? <>
        {d.diary.intro ? <p className="dy-intro">{d.diary.intro}</p> : null}
        <p className="dy-line">{d.diary.line}</p>
        <ol className="dy-story">{d.diary.story.map((it, i) => {
          const at = it.g === null ? null : where.get(it.g) ?? null;
          const [ic, cls] = TAG[it.tag] ?? ["•", ""];
          const sys = SYS_TAGS.has(it.tag);
          const tip = at ? <span className="fl-tip" role="tooltip">{tipOf(scenes[at[0]].events, at[1])}</span> : null;
          const inner = sys
            ? <><span className="dy-sys"><b>{ic} {it.tag === "바꿈" ? "목표 바꿈" : it.tag}</b><span>{it.text}</span></span>{tip}</>
            : <><span className="dy-tag">{ic} {it.tag}</span><span className="dy-body">{it.doing ? <small className="dy-doing">{it.doing}</small> : null}<span className="dy-text">{it.text}</span></span>{tip}</>;
          return <li key={i} className={`${cls}${sys ? " sys" : ""}`}>{at ? <button className="dy-b" onClick={() => jump(at[0], at[1])}>{inner}</button> : <span className="dy-b static">{inner}</span>}</li>;
        })}</ol>
        {d.diary.left.length ? <p className="dy-left">아직 남은 것 {d.diary.left.map((x, i) => <span key={i}>{x}</span>)}</p> : null}
        {stale ? <p className="small muted">일지 뒤로 기록이 더 있어요. <button className="linkish small" disabled={writing} onClick={() => void writeNow()}>{writing ? "쓰는 중…" : "이어서 다시 쓰기 (AI 1번)"}</button></p> : null}
      </> : <p className="small muted">{scenes.length ? <>아직 일지가 없어요. 목표를 끝내거나 학습을 끝내면, 아니면 손 놓고 15분 지나면 저절로 써져요. <button className="linkish small" disabled={writing} onClick={() => void writeNow()}>{writing ? "쓰는 중…" : "지금 쓰기 (AI 1번)"}</button></> : "남은 장면이 없어서 일지를 쓸 게 없어요."}</p>}
      {wErr ? <p className="ws-err">{wErr}</p> : null}
    </section>
    {scenes.length ? <section className="lib-sec"><h3>장면 전체 <span className="small muted">— 위의 줄을 누르면 그 자리로 와요</span></h3>
      {scenes.map((c, ci) => {
        const on = open.has(ci), result = resultOf(c), n = numOf(ci);
        return <section key={ci} className="rp-ch">
          <button className="rp-chh rp-tog" onClick={() => setOpen((s) => { const x = new Set(s); if (x.has(ci)) x.delete(ci); else x.add(ci); return x; })} aria-expanded={on}>
            <span className="lib-dot">{n || "·"}</span><b>{c.goal || "시작 · 무엇을 만들지 정하기"}</b>{result ? <span className={`lib-res ${RES[result] ?? ""}`}>{result}</span> : null}
            <span className="small muted">{hm(c.from)} · {mins(c.from, c.to)} · 말 {c.events.filter((x) => x.kind === "me").length} {on ? "▴" : "▾"}</span></button>
          {on ? <div className="rp-feed">{c.events.map((ev, k) => <div key={k} id={`rp-ev-${ci}-${k}`} className={hl === `rp-ev-${ci}-${k}` ? "rp-hl" : undefined}><Scene ev={ev} /></div>)}</div> : null}
        </section>;
      })}</section> : null}
    {chunks.length ? <section className="lib-sec"><h3>먼저 알아야 했던 것</h3><ul className="lib-chunks">{chunks.map((c) => (
      <li key={c.name}><b>{c.name}</b>{c.result ? <span className={`lib-res ${c.result === "됨" ? "ok" : "bad"}`}>{c.result === "됨" ? "알아요" : "몰라요"}</span> : null}
        {c.debts.length ? <span className="small muted"> 받아 쓴 것: {c.debts.join(", ")}</span> : null}</li>))}</ul></section> : null}
    {!scenes.length ? <p className="small muted">이 실습은 장면 기록(타임라인)을 남기기 전에 한 것이라 다시 볼 장면이 없어요.</p> : null}
  </>;
}

/* ---------- 알고리즘: 문제 하나의 풀이 노트(PS 튜터의 풀이 일지 · 관찰일지, B) ---------- */
type SolveLog = { number: string; title: string; at: string; patterns: string[]; stuck: string | null; help: number; fill: boolean; solved: boolean; alone: boolean; gap?: string; fix?: string; cue?: string; redo: "none" | "waiting" | "due" | "done"; redoAt?: string };
type JEntry = { at: string; number: string; title: string; what: string; result: string; text: string; lesson?: { gap?: string; fix?: string; cue?: string } };
const STUCK: Record<string, string> = { understand: "문제 이해", recognize: "방법 떠올리기", design: "계획 세우기", execute: "코드로 옮기기" };
const REDO: Record<string, string> = { none: "", waiting: "혼자 다시 풀기 · 기다리는 중", due: "혼자 다시 풀 차례", done: "혼자 다시 풀었어요" };
const JRES: Record<string, string> = { alone: "ok", helped: "", learned: "bad", seen: "", other: "" };
type PubProblem = { id?: string; title: string; statement: string; inputText: string; outputText: string; examples: Array<{ input: string; output: string }>; timeLimitMs?: number; memoryLimitMb?: number };
type SubLite = { id: string; at: string; lang: string; mode: "example" | "submit"; verdict: string; passed: number; total: number; hints: number; lines: number };
const VERDICT: Record<string, string> = { AC: "맞았습니다", WA: "틀렸습니다", TLE: "시간 초과", MLE: "메모리 초과", RE: "런타임 에러", CE: "컴파일 에러", MISSING: "실행기 없음" };
/** 문제 원문: 접어 두고 펼치면 본문 · 입력 · 출력 · 예제 */
function Statement({ p }: { p: PubProblem }) {
  return <details className="rp-src"><summary>문제 원문{p.timeLimitMs ? <span className="small muted"> · 시간 {p.timeLimitMs / 1000}초{p.memoryLimitMb ? ` · 메모리 ${p.memoryLimitMb}MB` : ""}</span> : null}</summary>
    <div className="rp-srcb"><Rich text={p.statement} />{p.inputText ? <><p className="eyebrow">입력</p><Rich text={p.inputText} /></> : null}{p.outputText ? <><p className="eyebrow">출력</p><Rich text={p.outputText} /></> : null}
      {p.examples.map((x, i) => <div key={i} className="rp-ex"><div><p className="eyebrow">예제 입력 {i + 1}</p><pre className="lib-diff">{x.input}</pre></div><div><p className="eyebrow">예제 출력 {i + 1}</p><pre className="lib-diff">{x.output}</pre></div></div>)}</div></details>;
}
/** 제출 하나: 누르면 그때 낸 코드 */
function SubRow({ pid, s }: { pid: string; s: SubLite }) {
  const [code, setCode] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const toggle = () => { setOpen(!open); if (code === null) call<{ submission: { code: string } }>(`/api/code/problem/${pid}/submission/${s.id}`).then((r) => setCode(r.submission.code)).catch(() => setCode("(코드를 못 불러왔어요)")); };
  const ok = s.verdict === "AC";
  return <li className={ok ? "ok" : "bad"}><button className="rp-sub" onClick={toggle} aria-expanded={open}><span className="rp-t">{day(s.at)} {hm(s.at)}</span><b>{s.mode === "example" ? "예제 실행" : "제출"}</b>
    <span className={`lib-res ${ok ? "ok" : "bad"}`}>{VERDICT[s.verdict] ?? s.verdict}</span><span className="small muted">{s.passed}/{s.total} · {s.lang} · {s.lines}줄{s.hints ? ` · 힌트 ${s.hints}` : ""}</span><span className="small muted">{open ? "▴" : "▾"}</span></button>
    {open ? <pre className="lib-diff">{code ?? "불러오는 중…"}</pre> : null}</li>;
}
/** 대화 장부 한 줄(B, /api/code/tutor/talk — 원문 + note: 두 줄 요약) */
type Talk = { id: string; at: string; problemId: string; number?: string; kind: string; q: string; a: string; selection?: string; code?: string; verdict?: string; note?: { need: string; gave: string } };
/** AI와 주고받은 한 번(11/12 사용자 "채팅창이 통으로 나오면 안 돼… 사용자가 뭐를 몰라서 AI가 뭐를 제공했다 이런 식으로"):
 *  푼 과정의 다른 줄과 같은 모양으로 두 줄 요약(몰랐던 것 · 알려 준 것). 대화 원문은 접어 둔다. */
function TalkScene({ t }: { t: Talk }) {
  const kindLabel = t.kind === "힌트" && /단계/.test(t.q) ? t.q.split(/\s*[·:]\s*/)[0] : t.kind === "질문" ? "AI에게 물음" : t.kind === "도움 칸" ? t.q.replace(/^도움 (\d)칸: /, "힌트 $1 · ") : t.kind;
  const first = (x: string) => (x.replace(/\s+/g, " ").split(/(?<=[.!?요])\s/)[0] ?? x).slice(0, 120);
  const need = t.note?.need ?? first(t.q), gave = t.note?.gave ?? first(t.a);
  return <div className="rp-step talk">
    <span className="rp-t">{hm(t.at)}</span><b>{kindLabel}</b>{t.verdict ? <span className="small muted">그때 {VERDICT[t.verdict] ?? t.verdict}</span> : null}
    {t.kind === "도움 칸" ? <p className="small"><span className="lib-k">본 것</span>{gave}</p>
      : <p className="small"><span className="lib-k bad">몰랐던 것</span>{need}<br /><span className="lib-k ok">알려 준 것</span>{gave}</p>}
    <details className="rp-code"><summary className="small muted">대화 원문 보기</summary>
      <div className="rp-talk">
        {t.q ? <div className="rp-row me"><div className="rp-b me"><Para text={t.q} /></div></div> : null}
        {t.selection ? <details className="rp-code"><summary className="small muted">드래그한 코드</summary><pre className="lib-diff">{t.selection}</pre></details> : null}
        <div className="rp-row"><span className="rp-who" aria-hidden>🧑‍🏫</span><div className="rp-b tutor"><Para text={t.a} /></div></div>
        {t.code ? <details className="rp-code"><summary className="small muted">그때 코드</summary><pre className="lib-diff">{t.code}</pre></details> : null}
      </div>
    </details>
  </div>;
}
function SolveView({ log }: { log: SolveLog }) {
  const [js, setJs] = useState<JEntry[] | null>(null);
  const [talk, setTalk] = useState<Talk[] | null>(null);
  const [prob, setProb] = useState<{ problem: PubProblem; submissions: SubLite[] } | null | false>(null);
  const pid = /^\d+$/.test(log.number) ? `cp_boj_${log.number}` : "";
  useEffect(() => later(() => { call<{ entries: JEntry[] }>("/api/code/tutor/journal").then((r) => setJs(r.entries.filter((x) => x.number === log.number).sort((a, b) => a.at.localeCompare(b.at)))).catch(() => setJs([])); }), [log.number]);
  // 대화 장부(11/11 사용자 "AI한테 물어본 것도 푼 과정에"): 이 문제에서 AI와 주고받은 원문
  useEffect(() => later(() => { setTalk(null); call<{ items: Talk[] }>(`/api/code/tutor/talk?${/^\d+$/.test(log.number) ? `number=${log.number}` : `problem=${encodeURIComponent(pid || log.number)}`}`).then((r) => setTalk(r.items)).catch(() => setTalk([])); }), [log.number, pid]);
  // 유저가 넣은 백준 문제는 cp_boj_N이 아니다(11/12 B): 그때는 대화 장부에 적힌 문제 id로 원문·제출을 찾는다.
  const talkPid = talk?.find((t) => t.problemId)?.problemId ?? "";
  useEffect(() => later(() => { setProb(null); if (!pid && !talkPid) { setProb(false); return; }
    const get = (id: string) => call<{ problem: PubProblem; submissions: SubLite[] }>(`/api/code/problem/${id}`);
    (pid ? get(pid).catch(() => (talkPid && talkPid !== pid ? get(talkPid) : Promise.reject(new Error("없음")))) : get(talkPid)).then(setProb).catch(() => setProb(false)); }), [pid, talkPid]);
  // 총정리(11/12 B, 사용자 "이 문제는 뭐를 알고 있는지 보는 문제… 사용자는 뭐를 모르는 모습… 그래서 어떻게 해서 풀었다… 쉽게"):
  // 풀이가 끝날 때 AI가 한 번 쓴 것을 보여 준다(없으면 그때 만든다, 4~6초). 없으면 예전 오답 노트.
  type Review = { tests: string; missed: string[]; how: string; next: string };
  const [review, setReview] = useState<Review | null | "loading">("loading");
  const reviewPid = pid || talkPid;
  useEffect(() => later(() => { setReview("loading"); if (!reviewPid) { setReview(null); return; }
    call<{ review: Review | null }>(`/api/code/problem/${reviewPid}/review`).then((r) => setReview(r.review)).catch(() => setReview(null)); }), [reviewPid]);
  const verdict = log.alone ? ["처음부터 혼자 풂", "ok"] : log.solved ? ["도움 받고 풂", ""] : ["아직 못 풂", "bad"];
  return <>
    <Head icon="⌨" title={`${log.number}${log.title ? ` · ${log.title}` : ""}`} sub={[day(log.at), log.patterns.join(", ")].filter(Boolean).join(" · ")}><button className="btn ghost small" onClick={() => go("code", { id: log.number })}>문제 다시 열기</button></Head>
    <div className="rp-tags"><span className={`lib-res ${verdict[1]}`}>{verdict[0]}</span>{log.stuck ? <span className="lib-res bad">막힌 곳 · {STUCK[log.stuck] ?? log.stuck}</span> : null}
      {log.help ? <span className="lib-res">도움 {log.help}칸까지 열어 봄</span> : null}{log.fill ? <span className="lib-res">뼈대에서 채우기</span> : null}
      {REDO[log.redo] ? <span className={`lib-res ${log.redo === "done" ? "ok" : log.redo === "due" ? "now" : ""}`}>{REDO[log.redo]}</span> : null}</div>
    {review && review !== "loading" ? <section className="rp-wrong"><p className="eyebrow">총정리</p>
      <p>{review.tests}</p>
      {review.missed.length ? <div><span className="lib-k bad">풀면서 헷갈린 것</span><ul className="rp-miss">{review.missed.map((m, i) => <li key={i}>{m}</li>)}</ul></div> : null}
      <p><span className="lib-k ok">이렇게 풀어 냈어요</span>{review.how}</p>
      {review.next ? <p className="small muted"><span className="lib-k">다음에 떠올릴 것</span>{review.next}</p> : null}</section>
    : review === "loading" && reviewPid ? <section className="rp-wrong"><p className="eyebrow">총정리</p><p className="small muted">이 풀이를 정리하는 중이에요…</p></section>
    : log.gap || log.fix ? <section className="rp-wrong"><p className="eyebrow">오답 노트</p>
      {log.gap ? <p><span className="lib-k bad">그때 내 생각</span>{log.gap}</p> : null}
      {log.fix ? <p><span className="lib-k ok">이렇게 풀려요</span>{log.fix}</p> : null}
      {log.cue ? <p className="small muted"><span className="lib-k">다음에 알아챌 신호</span>{log.cue}</p> : null}</section> : null}
    {prob ? <Statement p={prob.problem} /> : null}
    {/* 푼 과정 한 줄기(11/11): 한 일(관찰일지) · AI와 주고받은 것(대화 장부) · 낸 코드(제출)를 시간순으로 섞는다 */}
    <section className="lib-sec"><h3>푼 과정</h3>
      {!js || !talk || prob === null ? <p className="small muted">불러오는 중…</p> : (() => {
        const subs = prob ? prob.submissions : [];
        const flow = [...js.map((j) => ({ at: j.at, j })), ...talk.map((t) => ({ at: t.at, t })), ...subs.map((x) => ({ at: x.at, x }))].sort((a, b) => a.at.localeCompare(b.at));
        if (!flow.length) return <p className="small muted">한 일 기록이 없어요.</p>;
        return <div className="rp-flow">{flow.map((f, i) => "j" in f ? <div key={i} className={`rp-step ${JRES[f.j.result] ?? ""}`}><span className="rp-t">{hm(f.j.at)}</span><b>{f.j.what}</b><span>{f.j.text}</span>
            {f.j.lesson?.gap ? <p className="small"><span className="lib-k bad">그때 생각</span>{f.j.lesson.gap}{f.j.lesson.fix ? <><br /><span className="lib-k ok">고친 생각</span>{f.j.lesson.fix}</> : null}</p> : null}</div>
          : "t" in f ? <TalkScene key={i} t={f.t} />
          : <ul key={i} className="rp-subs">{<SubRow pid={prob ? prob.problem.id ?? pid : pid} s={f.x} />}</ul>)}</div>;
      })()}
    </section>
  </>;
}

/* ---------- 기억 하나 ---------- */
type ItemFull = { item: { id: string; title: string; body: string; state: ItemLite["state"]; graduated: boolean; example?: string; explain?: string; aliases: string[];
  sources: Array<{ kind: string; title: string; page?: number; quote?: string; at: string }>; mistakes?: Array<{ file: string; from: number; to: number; code: string; note: string }>;
  checks?: Array<{ q: string; a: string }>; review?: { dueAt?: string } }; path: string; links: Array<{ to: string; relation: string; item: { title: string } }>; backlinks: Array<{ relation: string; item: { id: string; title: string } }>;
  events: Array<{ id: string; at: string; kind: string; detail: string }>; ps?: { flow: string[]; wrong?: string; remember?: string; where?: string } };
const EV: Record<string, string> = { met: "만남", asked: "물어봄", wrong: "틀림", hint: "힌트", correct: "맞힘", note: "메모" };
function ItemView({ id, onBack, backLabel, onPick }: { id: string; onBack: () => void; backLabel: string; onPick: (id: string) => void }) {
  const [d, setD] = useState<ItemFull | null>(null);
  const [error, setError] = useState("");
  useEffect(() => later(() => { setD(null); setError(""); call<ItemFull>(`/api/knowledge/item/${id}`).then(setD).catch((x) => setError(errorText(x))); }), [id]);
  const back = <button className="linkish small lib-back" onClick={onBack}>{backLabel}</button>;
  if (error) return <>{back}<p className="ws-err">{error}</p></>;
  if (!d) return <>{back}<p className="small muted">불러오는 중…</p></>;
  const it = d.item;
  return <>
    {back}
    <Head icon="🔖" title={it.title} sub={[d.path, it.aliases.length ? `다른 이름 ${it.aliases.join(", ")}` : "", it.review?.dueAt ? `다음 복습 ${day(it.review.dueAt)}` : ""].filter(Boolean).join(" · ")}><StateChip state={it.state} graduated={it.graduated} /></Head>
    {it.body ? <section className="lib-sec"><h3>뜻</h3><p className="lib-body"><Inline text={it.body} /></p></section> : null}
    {it.example ? <section className="lib-sec"><h3>만난 곳에서는</h3><p><Inline text={it.example} /></p></section> : null}
    {d.ps ? <section className="lib-sec"><h3>문제 풀 때</h3>{d.ps.where ? <p className="small muted">{d.ps.where}</p> : null}
      {d.ps.flow.length ? <ol className="lib-steps">{d.ps.flow.map((f, i) => <li key={i}>{f}</li>)}</ol> : null}
      {d.ps.wrong ? <p><span className="lib-k">그때 내 생각</span>{d.ps.wrong}</p> : null}{d.ps.remember ? <p><span className="lib-k">기억할 것</span>{d.ps.remember}</p> : null}</section> : null}
    {it.mistakes?.length ? <section className="lib-sec"><h3>틀렸던 코드</h3>{it.mistakes.map((m, i) => <div key={i}><p className="small muted">{m.file} {m.from}~{m.to}줄 · {m.note}</p><pre className="lib-diff">{m.code}</pre></div>)}</section> : null}
    {it.checks?.length ? <section className="lib-sec"><h3>다시 물을 것</h3><ul className="lib-plain">{it.checks.map((c, i) => <li key={i}>{c.q}</li>)}</ul></section> : null}
    {d.links.length || d.backlinks.length ? <section className="lib-sec"><h3>이어진 기억</h3><p>{d.links.map((l) => <button key={`o${l.to}`} className="lib-tag link" onClick={() => onPick(l.to)}>{l.relation} → {l.item.title}</button>)}{d.backlinks.map((l) => <button key={`i${l.item.id}`} className="lib-tag link" onClick={() => onPick(l.item.id)}>{l.item.title} → {l.relation}</button>)}</p></section> : null}
    {it.sources.length ? <section className="lib-sec"><h3>어디서 만났나</h3><ul className="lib-plain">{it.sources.slice(-6).reverse().map((s, i) => <li key={i}>{s.title}{s.page ? ` ${s.page}쪽` : ""} <span className="small muted">{day(s.at)}</span>{s.quote ? <span className="small muted"> — “{s.quote}”</span> : null}</li>)}</ul></section> : null}
    {d.events.length ? <section className="lib-sec"><h3>지나온 일</h3><ul className="lib-plain">{d.events.slice(0, 10).map((ev) => <li key={ev.id}><span className={`lib-tag ${ev.kind === "wrong" ? "bad" : ev.kind === "correct" ? "ok" : ""}`}>{EV[ev.kind] ?? ev.kind}</span> {ev.detail} <span className="small muted">{day(ev.at)}</span></li>)}</ul></section> : null}
  </>;
}

/* ---------- 아래 채팅: 지금 펼친 것을 두고 묻기 ---------- */
function Chat({ pageRef, focusIds, where }: { pageRef: React.RefObject<HTMLDivElement | null>; focusIds: string[]; where: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [msgs, busy]);
  const send = async () => {
    const question = text.trim(); if (!question || busy) return;
    setText(""); setMsgs((m) => [...m, { role: "me", text: question }]); setBusy(true);
    const page = (pageRef.current?.innerText ?? "").replace(/\n{3,}/g, "\n\n").slice(0, 3800);
    const before = msgs.slice(-6).map((m) => `${m.role === "me" ? "학습자" : "답"}: ${m.text}`).join("\n").slice(0, 1600);
    try {
      const r = await call<{ answer: string }>("/api/knowledge/ask", { question, focusIds, context: `기억 도서관 · ${where}\n${page}${before ? `\n[앞서 나눈 말]\n${before}` : ""}`.slice(0, 5900) });
      setMsgs((m) => [...m, { role: "ai", text: r.answer || "답을 못 받았어요." }]);
    } catch (e) { setMsgs((m) => [...m, { role: "ai", text: `못 물어봤어요: ${errorText(e)}` }]); }
    finally { setBusy(false); }
  };
  return (
    <div className={`lib-chat${msgs.length || busy ? " has" : ""}`}>
      {msgs.length || busy ? <div className="lib-log" ref={log}>{msgs.map((m, i) => <div key={i} className={`lib-msg ${m.role}`}>{m.role === "ai" ? <Inline text={m.text} /> : m.text}</div>)}
        {busy ? <div className="lib-msg ai wait"><span className="lib-dots"><i /><i /><i /></span></div> : null}</div> : null}
      <form className="lib-in" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea value={text} rows={1} onChange={(e) => setText(e.target.value)} placeholder={`${where} — 내 기억에 대해 물어보세요`} aria-label="기억에 대해 묻기"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        <button className="lib-send" type="submit" disabled={busy || !text.trim()} aria-label="보내기">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M8 13V3M4 7l4-4 4 4" /></svg>
        </button>
      </form>
    </div>
  );
}
