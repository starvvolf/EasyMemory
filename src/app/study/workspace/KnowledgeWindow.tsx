"use client";
// 지식창: everything the learner has met, did not know and knows, across all materials, kept like files in folders.
// Left: folders (drag items or folders onto a folder to move them). Middle: the folder's items. Right: one item —
// its meaning, names, chains, where it came from and its record — with 확인 문제, 합치기 and the state buttons.
import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { call, errorText, folderPaths, go, handoff, later, KIND_LABEL, STATE_LABEL, EVENT_LABEL, whenText, type Detail, type Folder, type ItemLite, type KKind, type KState,
  type Question, type ReviewStatus, type Tree } from "./api";
import { ArticleMap, type SourceView } from "./ArticleStudy";
import { QuestionRun } from "./QuestionCard";
import { Inline, Rich } from "./Rich";

type Filter = "all" | KState | "graduated";
const FILTERS: Array<[Filter, string]> = [["all", "전체"], ["unknown", "몰랐음"], ["known", "앎"], ["met", "만남"], ["graduated", "졸업"]];
const stateClass: Record<KState, string> = { met: "met", unknown: "bad", known: "good" };
/**
 * 고리를 이 지식 쪽에서 읽는 말: "이것 —씀→ X"는 X 앞에 "씀", "X —씀→ 이것"은 "쓰임". 모르는 관계(직접 적은 것)는 화살표로.
 */
const REL_WORDS: Record<string, [string, string]> = { 포함: ["하위", "상위"], 씀: ["씀", "쓰임"], 조건: ["조건이 됨", "조건"], 먼저: ["다음 단계", "먼저 알 것"], "먼저 알기": ["다음 단계", "먼저 알 것"],
  "입력으로 씀": ["입력이 됨", "입력"], "비슷한 말": ["비슷한 말", "비슷한 말"] };
const relWord = (relation: string, out: boolean) => REL_WORDS[relation]?.[out ? 0 : 1] ?? null;
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? "방금" : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };

export function StateChip({ state, graduated }: { state: KState; graduated?: boolean }) {
  return <span className={`chip ws-st ${stateClass[state]}`}>{graduated ? "졸업" : STATE_LABEL[state]}</span>;
}

export default function KnowledgeWindow({ onLegacy, focusId }: { onLegacy?: () => void; focusId?: string }) {
  const [tree, setTree] = useState<Tree>({ folders: [], items: [] });
  const [folder, setFolder] = useState<string | "all" | "none">("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<"recent" | "weak" | "name">("recent");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ItemLite[] | null>(null);
  const [sel, setSel] = useState<string | null>(() => { const id = focusId ?? handoff.knowledgeId ?? null; handoff.knowledgeId = undefined; return id; });
  const [detail, setDetail] = useState<Detail | null>(null);
  const [run, setRun] = useState<{ title: string; questions: Question[] } | null>(null);
  const [overview, setOverview] = useState("");
  const [showOverview, setShowOverview] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [making, setMaking] = useState<"" | "item" | "folder">("");
  const [draft, setDraft] = useState("");
  const [filling, setFilling] = useState(false);
  const [dupes, setDupes] = useState<Dup[]>([]);
  // 왼쪽 (2026-10-30 사용자 "자료가 먼저, 누르면 그 자료의 지도", "자료 폴더 정리"): 전체 → 자료(학습자 폴더 + PDF·웹 글) →
  // 프로젝트 → 코드 문제 → 주제별로 보기(접힘). 목록은 거기서 고른 것을 따른다. 목표는 없앴다.
  const [view, setView] = useState<"topic" | "material">("topic");
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [matFolders, setMatFolders] = useState<MaterialFolder[]>([]);
  const [matSel, setMatSel] = useState<string | null>(null);
  const [matMode, setMatMode] = useState<"map" | "list">("map");
  const [sorting, setSorting] = useState(false);

  const load = useCallback(async () => {
    try { setTree(await call<Tree>("/api/knowledge")); } catch (e) { setError(errorText(e)); }
    call<{ pairs: Dup[] }>("/api/knowledge/dupes").then((r) => setDupes(r.pairs)).catch(() => undefined);
    call<{ materials: MaterialRow[]; folders: MaterialFolder[] }>("/api/knowledge/material-view").then((r) => { setMaterials(r.materials); setMatFolders(r.folders); }).catch(() => undefined);
  }, []);
  const loadDetail = useCallback(async (id: string) => { try { setDetail(await call<Detail>(`/api/knowledge/item/${id}`)); } catch (e) { setError(errorText(e)); setDetail(null); } }, []);
  useEffect(() => later(() => void load()), [load]);
  useEffect(() => later(() => { if (sel) void loadDetail(sel); else setDetail(null); }), [sel, loadDetail]);
  // One column (narrow screens): the detail is below the list, so bring it into view when an item is chosen.
  useEffect(() => later(() => { if (sel && detail?.item.id === sel && window.innerWidth < 1100) document.querySelector(".kw-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 50), [sel, detail?.item.id]);
  useEffect(() => {
    const onFocus = (e: Event) => { const id = (e as CustomEvent<{ id?: string }>).detail?.id; if (id) setSel(id); };
    const onChanged = () => { void load(); if (sel) void loadDetail(sel); };
    window.addEventListener("recaller:knowledge-focus", onFocus);
    window.addEventListener("recaller:knowledge-changed", onChanged);
    return () => { window.removeEventListener("recaller:knowledge-focus", onFocus); window.removeEventListener("recaller:knowledge-changed", onChanged); };
  }, [load, loadDetail, sel]);
  useEffect(() => {
    return later(() => { if (!query.trim()) { setHits(null); return; } call<{ hits: ItemLite[] }>(`/api/knowledge/search?q=${encodeURIComponent(query)}&limit=30`).then((r) => setHits(r.hits)).catch(() => setHits([])); }, query.trim() ? 180 : 0);
  }, [query]);

  const act = async (run: () => Promise<unknown>, after?: () => void) => {
    setError("");
    try { await run(); await load(); if (sel) await loadDetail(sel); after?.(); window.dispatchEvent(new Event("recaller:knowledge-changed-sidebar")); } catch (e) { setError(errorText(e)); }
  };

  const children = useMemo(() => {
    const map = new Map<string | null, Folder[]>();
    for (const f of tree.folders) map.set(f.parentId, [...(map.get(f.parentId) ?? []), f]);
    for (const list of map.values()) list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ko"));
    return map;
  }, [tree.folders]);
  const subtree = useCallback((id: string) => { const ids = new Set([id]); let grew = true; while (grew) { grew = false; for (const f of tree.folders) if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); grew = true; } } return ids; }, [tree.folders]);
  const countIn = useCallback((id: string) => { const ids = subtree(id); const list = tree.items.filter((i) => i.folderId && ids.has(i.folderId)); return { total: list.length, unknown: list.filter((i) => i.state === "unknown").length, known: list.filter((i) => i.state === "known").length }; }, [subtree, tree.items]);

  const shown = useMemo(() => {
    const inMaterial = view === "material" && matSel ? new Set(materials.find((m) => m.key === matSel)?.itemIds ?? []) : null;
    let list = hits ?? tree.items.filter((i) => inMaterial ? inMaterial.has(i.id)
      : view !== "topic" || folder === "all" ? true : folder === "none" ? !i.folderId : Boolean(i.folderId && subtree(folder).has(i.folderId)));
    if (filter === "graduated") list = list.filter((i) => i.graduated); else if (filter !== "all") list = list.filter((i) => i.state === filter && !i.graduated);
    if (!hits) list = [...list].sort((a, b) => sort === "weak" ? b.weak - a.weak || b.lastAt.localeCompare(a.lastAt) : sort === "name" ? a.title.localeCompare(b.title, "ko") : b.lastAt.localeCompare(a.lastAt));
    return list;
  }, [hits, tree.items, folder, filter, sort, subtree, view, matSel, materials]);

  const dueNow = tree.items.filter((i) => !i.graduated && i.state !== "met" && (!i.dueAt || Date.parse(i.dueAt) <= Date.now())).length;
  const counts = { total: tree.items.length, unknown: tree.items.filter((i) => i.state === "unknown").length, known: tree.items.filter((i) => i.state === "known").length, met: tree.items.filter((i) => i.state === "met").length };
  const material = materials.find((m) => m.key === matSel) ?? null;
  const folderName = view === "material" && material ? material.title
    : view !== "topic" || folder === "all" ? "전체" : folder === "none" ? "주제 없음" : folderPaths(tree.folders).find((f) => f.id === folder)?.path ?? "";
  const unsorted = tree.items.filter((i) => !i.kind).length;
  // 정리할 것: things that need the learner now and then (같은 지식 의심, 빈 뜻) — one quiet tray, not banners.
  const emptyMeaning = tree.items.filter((i) => !i.line).length;
  const chores = (dupes.length ? 1 : 0) + (emptyMeaning ? 1 : 0) + (unsorted ? 1 : 0);

  const drop = (target: string | null) => (e: DragEvent) => {
    e.preventDefault(); (e.currentTarget as HTMLElement).classList.remove("drop");
    const kind = e.dataTransfer.getData("text/x-kind"), id = e.dataTransfer.getData("text/x-id");
    if (!id || kind === "material") return;
    if (kind === "item") void act(() => call(`/api/knowledge/item/${id}`, { folderId: target }, "PATCH"));
    if (kind === "folder" && id !== target) void act(() => call(`/api/knowledge/folder/${id}`, { parentId: target }, "PATCH"));
  };
  const dropZone = (target: string | null) => ({ onDragOver: (e: DragEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add("drop"); },
    onDragLeave: (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove("drop"), onDrop: drop(target) });
  const dragOf = (kind: "item" | "folder" | "material", id: string) => ({ draggable: true, onDragStart: (e: DragEvent) => { e.dataTransfer.setData("text/x-kind", kind); e.dataTransfer.setData("text/x-id", id); e.dataTransfer.effectAllowed = "move"; } });

  // 자료를 누르면 그 자료의 지도가 먼저: PDF는 자료 지도(공부 화면의 지도 창), 웹 글은 글 지도, 프로젝트는 단계별. 코드 문제는 목록.
  const pickMaterial = (m: MaterialRow) => {
    setView("material"); setMatSel(m.key); setQuery(""); setSel(null);
    // 프로젝트는 단계를 아는 지식이 절반은 넘어야 단계별로 먼저 (단계는 물어봄·힌트·검사 기록에서만 알 수 있다).
    const staged = (m.stages ?? []).filter((x) => x.name !== "단계 모름").reduce((n, x) => n + x.itemIds.length, 0);
    setMatMode(m.genId || m.sourceId || (m.stages && staged * 2 >= m.items) ? "map" : "list");
  };
  const placeMaterial = (key: string, folderId: string | null) => void act(() => call("/api/knowledge/material-place", { keys: [key], folderId }));
  const matDrop = (folderId: string | null) => ({ onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes("text/x-mat")) { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add("drop"); } },
    onDragLeave: (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove("drop"),
    onDrop: (e: DragEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.remove("drop"); const key = e.dataTransfer.getData("text/x-mat"); if (key) placeMaterial(key, folderId); } });
  const barOf = (ids: string[]) => { const mine = tree.items.filter((i) => ids.includes(i.id)); const n = mine.length || 1;
    return { unknown: mine.filter((i) => i.state === "unknown").length / n * 100, known: mine.filter((i) => i.state === "known").length / n * 100 }; };
  const MatRow = ({ m }: { m: MaterialRow }) => { const b = barOf(m.itemIds); return (
    <li><div className={`kw-folder kw-mat${view === "material" && matSel === m.key ? " on" : ""}`} draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/x-mat", m.key); e.dataTransfer.effectAllowed = "move"; }} title={`${m.title} · 끌어다 자료 폴더에 넣을 수 있어요`}>
      <span className="kw-mat-ic" aria-hidden>{MAT_ICON[m.group === "material" ? m.kind : m.group] ?? "•"}</span>
      <button className="kw-fname" onClick={() => pickMaterial(m)}>{m.title}</button>
      <span className="kw-count num">{m.items}</span>
      <span className="kw-mbar" aria-label={`몰랐음 ${Math.round(b.unknown)}% · 앎 ${Math.round(b.known)}%`}><i className="bad" style={{ width: `${b.unknown}%` }} /><i className="good" style={{ width: `${b.known}%` }} /></span>
    </div></li>); };
  const unfiled = (g: MaterialRow["group"]) => materials.filter((m) => m.group === g && !m.folderId);

  const startQuiz = async () => {
    const q = view === "topic" && folder !== "all" && folder !== "none" ? `?folderId=${folder}&count=10` : "?count=10";
    setNotice("");
    try {
      const { questions, next } = await call<{ questions: Question[] } & ReviewStatus>(`/api/knowledge/quiz${q}`);
      if (questions.length) setRun({ title: `복습 · ${folderName}`, questions });
      else setNotice(next ? `지금 복습할 지식이 없어요. 다음 복습은 ${whenText(next)}이에요.` : "복습할 지식이 아직 없어요. 문제를 풀다 틀리거나 물어본 지식이 여기로 와요.");
    } catch (e) { setError(errorText(e)); }
  };
  const create = async () => {
    const name = draft.trim(); if (!name) return;
    const parentId = folder !== "all" && folder !== "none" ? folder : null;
    if (making === "folder") await act(() => call("/api/knowledge/folder", { name, parentId }), () => { setMaking(""); setDraft(""); if (parentId) setOpen(new Set([...open, parentId])); });
    else await act(async () => { const r = await call<{ item: { id: string } }>("/api/knowledge/item", { title: name, folderId: parentId, source: { kind: "manual", title: "직접 추가" } }); setSel(r.item.id); }, () => { setMaking(""); setDraft(""); });
  };

  const FolderRow = ({ f, depth }: { f: Folder; depth: number }) => {
    const kids = children.get(f.id) ?? [];
    const c = countIn(f.id);
    const isOpen = open.has(f.id);
    return (
      <li>
        <div className={`kw-folder${view === "topic" && folder === f.id ? " on" : ""}`} style={{ paddingLeft: 8 + depth * 14 }} {...dragOf("folder", f.id)} {...dropZone(f.id)}>
          <button className="kw-twist" aria-label={isOpen ? "접기" : "펴기"} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })} style={{ visibility: kids.length ? "visible" : "hidden" }}>{isOpen ? "▾" : "▸"}</button>
          <button className="kw-fname" onClick={() => { setView("topic"); setFolder(f.id); setQuery(""); }}>{f.name}</button>
          <span className="kw-count num" title={`몰랐음 ${c.unknown} · 앎 ${c.known}`}>{c.unknown ? <i className="dot bad" /> : null}{c.total}</span>
        </div>
        {isOpen && kids.length ? <ul>{kids.map((k) => <FolderRow key={k.id} f={k} depth={depth + 1} />)}</ul> : null}
      </li>
    );
  };

  return (
    <div className="kw">
      <header className="kw-top">
        <div>
          <h2>지식</h2>
          <p className="small muted num kw-sum"><span>{counts.total}개</span><span><i className="dot bad" />몰랐음 {counts.unknown}</span><span><i className="dot good" />앎 {counts.known}</span><span>만남 {counts.met}</span></p>
        </div>
        <div className="row kw-actions">
          <input className="ws-input kw-search" type="search" placeholder="지식 찾기" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="지식 찾기 (이름·설명)" />
          <button className="btn primary small kw-review" onClick={startQuiz}>복습하기{dueNow ? <span className="kw-badge">{dueNow}</span> : null}</button>
          <details className="ws-menu">
            <summary aria-label="만들기" title="새 지식 · 새 폴더">＋</summary>
            <div className="ws-menu-card">
              <button className="mm-item" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; setMaking("item"); setDraft(""); }}><span>새 지식</span><small>직접 적어 넣기 (보통은 공부하면 저절로 쌓여요)</small></button>
              <button className="mm-item" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; setMaking("folder"); setDraft(""); }}><span>새 폴더</span><small>{folder !== "all" && folder !== "none" ? `${folderName} 안에` : "맨 위에"} 주제 폴더 만들기</small></button>
            </div>
          </details>
          <details className="ws-menu">
            <summary aria-label="지식 더보기">⋯</summary>
            <div className="ws-menu-card">
              <button className="mm-item" onClick={async (e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; if (!showOverview) { try { setOverview((await call<{ text: string }>("/api/knowledge/memory?level=1")).text); } catch (err) { setError(errorText(err)); } } setShowOverview(!showOverview); }}>
                <span>{showOverview ? "AI가 보는 요약 닫기" : "AI가 보는 요약"}</span><small>메모리 1단계: AI가 매번 보는 내 공부의 큰 그림</small></button>
              <button className="mm-item" onClick={() => window.open("/api/knowledge/report", "_blank", "noopener")}><span>점검 보고서</span><small>저장소 전체를 글로: 요약·점검·주제별 지식 (.md)</small></button>
              <button className="mm-item" onClick={() => { window.location.href = "/api/knowledge/report?download=1"; }}><span>점검 보고서 받기</span><small>.md 파일로 저장</small></button>
              {onLegacy ? <button className="mm-item" onClick={onLegacy}><span>자료별 지식 포인트</span><small>예전 화면 (PDF 자료마다)</small></button> : null}
            </div>
          </details>
        </div>
      </header>
      {making ? (
        <form className="kw-make row" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <span className="small muted">{making === "folder" ? `새 폴더 (${folder !== "all" && folder !== "none" ? `${folderName} 안에` : "맨 위에"})` : `새 지식 (${folder !== "all" && folder !== "none" ? folderName : "폴더 없음"})`}</span>
          <input className="ws-input" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={making === "folder" ? "폴더 이름" : "지식 이름 (예: 기준금리)"} maxLength={making === "folder" ? 60 : 120} />
          <button className="btn primary small" disabled={!draft.trim()}>만들기</button><button type="button" className="btn ghost small" onClick={() => setMaking("")}>취소</button>
        </form>
      ) : null}
      {chores ? (
        <details className="kw-chores">
          <summary><i className="dot bad" /><b>정리할 것</b><span className="small muted kw-chores-what">{[dupes.length ? `같은 지식 의심 ${dupes.length}` : "",
            emptyMeaning ? `뜻 빈 지식 ${emptyMeaning}` : "", unsorted ? `정리 중 ${unsorted}` : ""].filter(Boolean).join(" · ")}</span></summary>
          <div className="stack kw-chores-body">
            {unsorted ? <p className="kw-fill row small"><span className="muted">주제·종류를 정리하는 중인 지식 {unsorted}개 (새로 들어오면 몇 초 뒤 저절로 정리돼요)</span>
        <button className="btn ghost small" disabled={sorting} onClick={() => { setSorting(true); void act(async () => { const r = await call<{ sorted: number }>("/api/knowledge/classify", {});
          setNotice(`${r.sorted}개를 주제·종류로 정리했어요.`); }).finally(() => setSorting(false)); }}>{sorting ? "정리하는 중…" : "지금 정리"}</button></p> : null}
            {dupes.length ? <Duplicates pairs={dupes} onOpen={setSel} onAct={act} /> : null}
            {tree.items.some((i) => !i.line) ? (
        <p className="kw-fill row small"><span className="muted">뜻이 빈 지식 {emptyMeaning}개 — 복습 문제가 플래시카드만 나와요.</span>
          <button className="btn small" disabled={filling} onClick={() => { setFilling(true); void act(async () => {
            const r = await call<{ done: number; changed: string[]; left: number }>("/api/knowledge/layer", { ids: tree.items.filter((i) => !i.line).map((i) => i.id) });
            setNotice(`AI가 ${r.done}개를 보고 ${r.changed.length}개의 뜻을 채웠어요. 틀린 데가 있으면 편집으로 고쳐 주세요.`);
          }, () => setFilling(false)).finally(() => setFilling(false)); }}>{filling ? "채우는 중…" : "AI로 뜻 채우기"}</button></p>
      ) : null}
          </div>
        </details>
      ) : null}
      {error ? <p className="ws-err" onClick={() => setError("")}>{error}</p> : null}
      {notice ? <p className="small muted" onClick={() => setNotice("")}>{notice}</p> : null}
      {showOverview ? <section className="panel"><div className="row" style={{ justifyContent: "space-between" }}><b className="small">AI가 보는 요약 (메모리 1단계)</b><button className="btn ghost small" onClick={() => setShowOverview(false)}>닫기</button></div><pre className="kw-overview">{overview}</pre></section> : null}
      {run ? <QuestionRun title={run.title} questions={run.questions} onClose={() => { setRun(null); void load(); if (sel) void loadDetail(sel); }} /> : null}

      <div className="kw-grid">
        <nav className="kw-tree panel" aria-label="폴더" title="지식이나 폴더를 끌어다 폴더에 놓으면 옮겨져요. 손으로 옮긴 지식은 주제 정리가 다시 옮기지 않아요.">
          <div className={`kw-folder root${view === "topic" && folder === "all" ? " on" : ""}`}><button className="kw-fname" onClick={() => { setView("topic"); setFolder("all"); setQuery(""); }}>전체</button><span className="kw-count num">{counts.total}</span></div>
          <div className="kw-sec" {...matDrop(null)}><span>자료</span><MatFolderNew onAct={act} /></div>
          {matFolders.map((f) => <MatFolderBox key={f.id} folder={f} rows={materials.filter((m) => m.folderId === f.id)} drop={matDrop(f.id)} onAct={act}>{(m) => <MatRow key={m.key} m={m} />}</MatFolderBox>)}
          <ul>{unfiled("material").map((m) => <MatRow key={m.key} m={m} />)}</ul>
          {!materials.some((m) => m.group === "material") ? <p className="small muted kw-empty-sec">PDF나 웹 글로 공부하면 여기에 생겨요.</p> : null}
          {unfiled("project").length ? <><div className="kw-sec" {...matDrop(null)}><span>프로젝트</span></div><ul>{unfiled("project").map((m) => <MatRow key={m.key} m={m} />)}</ul></> : null}
          {unfiled("code").length ? <details className="kw-mgroup" open={unfiled("code").some((m) => m.key === matSel)}><summary className="kw-sec"><span>코드 문제</span><span className="kw-count num">{unfiled("code").length}</span></summary>
            <ul>{unfiled("code").map((m) => <MatRow key={m.key} m={m} />)}</ul></details> : null}
          <details className="kw-mgroup" open={view === "topic" && folder !== "all"}>
            <summary className="kw-sec"><span>주제별로 보기</span><span className="small muted kw-sec-hint">{(children.get(null) ?? []).slice(0, 3).map((f) => f.name).join(" · ")}</span></summary>
            <ul>{(children.get(null) ?? []).map((f) => <FolderRow key={f.id} f={f} depth={0} />)}</ul>
            <div className={`kw-folder root${view === "topic" && folder === "none" ? " on" : ""}`} {...dropZone(null)}><button className="kw-fname" onClick={() => { setView("topic"); setFolder("none"); setQuery(""); }}>주제 없음</button><span className="kw-count num">{tree.items.filter((i) => !i.folderId).length}</span></div>
            {view === "topic" && folder !== "all" && folder !== "none" && tree.folders.some((f) => f.id === folder) ? <details className="ws-fold kw-ftools-fold"><summary>폴더 설정</summary><FolderTools key={folder} folder={tree.folders.find((f) => f.id === folder)!} onAct={act} onGone={() => setFolder("all")} /></details> : null}
          </details>
        </nav>

        <section className="kw-list panel" aria-label="지식 목록">
          <div className="row kw-list-head">
            <b>{hits ? `"${query}" 찾은 것 ${hits.length}` : `${folderName} · ${shown.length}`}</b>
            {!hits && !(view === "material" && material && matMode === "map" && (material.genId || material.sourceId || material.stages)) ? <select className="ws-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="정렬"><option value="recent">최근 순</option><option value="weak">약한 순</option><option value="name">이름 순</option></select> : null}
          </div>
          {view === "material" && material && !hits ? <MaterialHead m={material} folders={matFolders} mode={matMode} onMode={setMatMode} onPlace={(f) => placeMaterial(material.key, f)} /> : null}
          {view === "material" && material && !hits && matMode === "map" && material.genId ? <MaterialOutline key={material.genId} genId={material.genId} items={tree.items} sel={sel} onPick={setSel} />
          : view === "material" && material && !hits && matMode === "map" && material.sourceId ? <MaterialArticle key={material.sourceId} id={material.sourceId} onChanged={() => void load()} />
          : view === "material" && material && !hits && matMode === "map" && material.stages ? <ProjectStages stages={material.stages} items={tree.items} sel={sel} onPick={setSel} />
          : <>
          <div className="kw-filters">{FILTERS.map(([key, label]) => <button key={key} className="chip-btn" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>
          {!shown.length ? <p className="small muted">{tree.items.length ? "여기에 맞는 지식이 없어요." : "아직 지식이 없어요. 자료를 읽거나 문제를 풀면 저절로 쌓이고, + 지식으로 직접 넣을 수도 있어요."}</p> : null}
          <ul className="kw-items">
            {shown.slice(0, 400).map((i) => (
              <li key={i.id}>
                <button className={`kw-item${sel === i.id ? " on" : ""}`} onClick={() => setSel(i.id)} {...dragOf("item", i.id)}>
                  <span className="kw-item-top"><StateChip state={i.state} graduated={i.graduated} /><span className="kw-title"><Inline text={i.title} /></span>
                    <span className="kw-item-side">{i.weak ? <span className="kw-weak" title="틀림·힌트·물어봄을 합친 수">막힘 {i.weak}회</span> : null}{i.links ? <span title="이어진 지식">고리 {i.links}</span> : null}</span></span>
                  {i.line ? <span className="kw-line"><Inline text={i.line} /></span> : <span className="kw-line kw-empty">뜻이 아직 없어요</span>}
                  <span className="kw-meta">{hits && i.folderId ? `${folderPaths(tree.folders).find((f) => f.id === i.folderId)?.path ?? ""} · ` : ""}{i.kind ? `${KIND_LABEL[i.kind]} · ` : ""}{ago(i.lastAt)}</span>
                </button>
              </li>
            ))}
          </ul>
          </>}
        </section>

        <section className="kw-detail panel" aria-label="지식 자세히">
          {detail ? <ItemDetail key={detail.item.id} detail={detail} folders={tree.folders} quizzing={Boolean(run)} onAct={act} onOpen={setSel} onGone={() => setSel(null)}
            onQuiz={(questions) => setRun({ title: `확인 문제 · ${detail.item.title}`, questions })} /> : <p className="muted small">왼쪽에서 지식을 고르면 뜻, 이어진 지식, 내 기록이 여기 보여요.</p>}
        </section>
      </div>
    </div>
  );
}

function FolderTools({ folder, onAct, onGone }: { folder: Folder; onAct: (run: () => Promise<unknown>, after?: () => void) => Promise<void>; onGone: () => void }) {
  const [name, setName] = useState(folder.name);
  const [note, setNote] = useState(folder.note ?? "");
  const [sure, setSure] = useState(false);
  return (
    <div className="kw-ftools">
      <p className="eyebrow">이 폴더</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (name.trim() && name !== folder.name) void onAct(() => call(`/api/knowledge/folder/${folder.id}`, { name }, "PATCH")); }}>
        <input className="ws-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="폴더 이름" /><button className="btn small" disabled={!name.trim() || name === folder.name}>이름 바꾸기</button>
      </form>
      <textarea className="ws-input" rows={2} value={note} placeholder="폴더 메모 (AI 요약에 같이 들어가요)" onChange={(e) => setNote(e.target.value)} onBlur={() => { if (note !== (folder.note ?? "")) void onAct(() => call(`/api/knowledge/folder/${folder.id}`, { note }, "PATCH")); }} />
      {!sure ? <button className="btn ghost small" onClick={() => setSure(true)}>폴더 지우기</button> : (
        <div className="row small"><span>안의 지식은 위 폴더로 올라가요.</span><button className="btn small danger" onClick={() => void onAct(() => call(`/api/knowledge/folder/${folder.id}`, undefined, "DELETE"), onGone)}>지우기</button><button className="btn ghost small" onClick={() => setSure(false)}>취소</button></div>
      )}
    </div>
  );
}

function ItemDetail({ detail, folders, quizzing, onAct, onOpen, onGone, onQuiz }: { detail: Detail; folders: Folder[]; quizzing: boolean; onAct: (run: () => Promise<unknown>, after?: () => void) => Promise<void>; onOpen: (id: string) => void; onGone: () => void; onQuiz: (q: Question[]) => void }) {
  const { item } = detail;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [alias, setAlias] = useState("");
  const [linkQuery, setLinkQuery] = useState("");
  const [linkHits, setLinkHits] = useState<ItemLite[]>([]);
  const [relation, setRelation] = useState("그러면");
  const [mode, setMode] = useState<"" | "link" | "merge" | "delete">("");
  const [example, setExample] = useState(item.example ?? "");
  // 잘 모르겠어요 → 풀어 쓴 설명 (AI, saved on the item) and what to know first.
  const [explaining, setExplaining] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [why, setWhy] = useState("");
  const [asking, setAsking] = useState(false);
  const explain = (question = "") => { setExplaining(true); setExplainOpen(true); setMore(false); void onAct(async () => { await call(`/api/knowledge/item/${item.id}/explain`, { question });
    setAsking(false); setWhy(""); }).finally(() => setExplaining(false)); };
  // 쉽게 풀어 보기: 요약과 왜 필요한지를 먼저, 비유·작은 예·다른 데서는 한 번 더 펼쳐서. 예전 글로만 된 설명은 문단 그대로.
  // 쉽게 풀어 보기: 쉬운 말 + 칸(비유·작은 예·따라가 보기 …). 칸 형식이 아닌 예전 설명은 문단 그대로.
  const ex = item.explainParts?.plain !== undefined ? item.explainParts : undefined;
  const oldParts = !ex ? (item.explain ?? "").split(/\n\s*\n/).map((t) => t.replace(/^한 줄로:\s*/, "").trim()).filter(Boolean) : [];
  const extra = ex?.extras ?? [];
  const see = item.explainSee ?? [];
  // 뜻 박스: 뜻 줄과 "헷갈림:" 줄을 나눠, 헷갈림은 머리말 대신 "주의" 칸으로.
  const meaningText = item.body.split("\n").filter((l) => !/^\s*헷갈림\s*:/.test(l)).join("\n").trim();
  const traps = item.body.split("\n").filter((l) => /^\s*헷갈림\s*:/.test(l)).map((l) => l.replace(/^\s*헷갈림\s*:\s*/, "").trim()).filter(Boolean);
  // 예와 만난 곳을 한 줄로: "코드 문제 「이름별 누적 포인트 조회」에서 이름을 키로 … 문제 보기 →"
  const srcs = [...new Map(item.sources.map((src) => [src.title, src])).values()];
  const main = srcs[0];
  const KIND_NAME: Record<string, string> = { pdf: "PDF", web: "웹 글", code: "코드 문제", chat: "대화", manual: "직접 적은 것" };
  const where = main && main.kind !== "manual" ? `${KIND_NAME[main.kind] ?? main.kind} 「${main.title}」${main.page ? ` ${main.page}쪽` : ""}` : "";
  const exampleText = (item.example ?? "").replace(/^(이|그|해당)\s*(문제|글|자료|강의|코드)\s*(에서는|에선|에서)\s*/, "").replace(/^「[^」]{1,80}」\s*(에서는|에선|에서)\s*/, "");
  const codeId = main?.kind === "code" && main.ref?.startsWith("code:") ? main.ref.slice(5) : null;
  const openSource = main?.url ? <a className="kw-ex-go" href={main.url} target="_blank" rel="noreferrer">원문 ↗</a>
    : codeId ? <button className="linkish kw-ex-go" onClick={() => go("code", { id: codeId })}>문제 보기 →</button> : null;
  useEffect(() => {
    return later(() => { if (!linkQuery.trim()) { setLinkHits([]); return; } call<{ hits: ItemLite[] }>(`/api/knowledge/search?q=${encodeURIComponent(linkQuery)}&limit=8`).then((r) => setLinkHits(r.hits.filter((h) => h.id !== item.id))).catch(() => setLinkHits([])); }, linkQuery.trim() ? 160 : 0);
  }, [linkQuery, item.id]);
  const save = () => onAct(() => call(`/api/knowledge/item/${item.id}`, { title, body, example }, "PATCH"), () => setEditing(false));
  const setState = (patch: { state?: KState; graduated?: boolean }) => onAct(() => call(`/api/knowledge/item/${item.id}/state`, patch));
  const quiz = async () => { const { questions } = await call<{ questions: Question[] }>(`/api/knowledge/item/${item.id}/questions`); onQuiz(questions); };
  const s = item.stats;
  // 틀렸을 때 먼저 볼 것(먼저 알 것·조건·상위)이 위로.
  const order = (w: string | null) => ["먼저 알 것", "조건", "상위", "씀", "하위", "쓰임", "다음 단계", "조건이 됨"].indexOf(w ?? "") >>> 0;
  const links = [...detail.links.map((l) => ({ ...l, out: true })), ...detail.backlinks.map((l) => ({ ...l, out: false }))].sort((a, b) => order(relWord(a.relation, a.out)) - order(relWord(b.relation, b.out)));
  const next = item.review && !item.graduated && item.state !== "met" ? item.review : null;
  return (
    <div className="kw-d stack">
      {/* 보이는 것: 무엇인지(이름·상태·뜻), 바로 할 일(확인 문제·다음 복습), 이어진 지식. 나머지는 아래 접힌 칸에. */}
      <header className="kw-d-head">
        <p className="kw-crumb">{detail.path ? detail.path.split(" / ").join(" › ") : "주제 없음"}</p>
        {editing ? <input className="ws-input kw-d-title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="지식 이름" /> : <h3 className="kw-d-title" onDoubleClick={() => setEditing(true)}><Inline text={item.title} /></h3>}
        <div className="kw-d-meta"><StateChip state={item.state} graduated={item.graduated} />{item.kind ? <span>{KIND_LABEL[item.kind]}</span> : null}
          {item.aliases.length ? <span className="kw-aka" title="다른 이름">{item.aliases.slice(0, 4).join(" · ")}{item.aliases.length > 4 ? " …" : ""}</span> : null}</div>
      </header>
      {editing ? (
        <><label className="stack small"><span className="eyebrow">뜻 (복습 때 떠올릴 답)</span>
          <textarea className="ws-input" rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="일반적인 뜻 1~2문장. 헷갈리는 점은 '헷갈림: …' 줄로 (- 로 목록, **굵게**)" /></label>
          <label className="stack small"><span className="eyebrow">예 (만난 곳에서 어떻게 쓰였나)</span>
          <textarea className="ws-input" rows={2} value={example} onChange={(e) => setExample(e.target.value)} placeholder="예: 이 문제에선 이름을 키로 누적 포인트를 O(1)에 찾는다" /></label>
          <div className="row"><button className="btn primary small" onClick={save}>저장</button><button className="btn ghost small" onClick={() => { setEditing(false); setTitle(item.title); setBody(item.body); setExample(item.example ?? ""); }}>취소</button></div></>
      ) : quizzing ? <p className="kw-hide">확인 문제를 푸는 동안 뜻과 예를 가려 뒀어요.</p> : (
        <>
          <div className="kw-body" onDoubleClick={() => setEditing(true)}>{meaningText ? <Rich text={meaningText} /> : <p className="muted small">뜻이 아직 없어요. 편집으로 적거나, 위 “정리할 것”에서 AI로 채울 수 있어요.</p>}
            {traps.map((t, n) => <p key={n} className="kw-trap"><span className="kw-trap-tag">주의</span><span><Inline text={t} /></span></p>)}
            <button className="btn ghost small kw-edit" onClick={() => setEditing(true)} aria-label="이름·뜻 편집">편집</button></div>
          {where || item.example ? <p className="kw-ex">
            <span className={`kw-ex-tag${item.example ? "" : " soft"}`}>{item.example ? "예" : "만난 곳"}</span>
            <span>{where ? <span className="kw-ex-where">{where}{item.example ? "에서 " : ""}</span> : null}{item.example ? <Inline text={exampleText} /> : null}
              {openSource}{srcs.length > 1 ? <span className="kw-ex-more"> · 외 {srcs.length - 1}곳</span> : null}</span></p> : null}
          {item.explain || explaining ? <details className="kw-explain" open={explainOpen} onToggle={(e) => setExplainOpen((e.currentTarget as HTMLDetailsElement).open)}>
            <summary>쉽게 풀어 보기</summary>
            <div className="kw-explain-body">{explaining && !item.explain ? <p className="small muted">설명을 만드는 중이에요… (10초쯤)</p> : null}
              {ex ? <>
                {ex.plain ? <Rich text={ex.plain} /> : null}
                {extra.slice(0, more ? 3 : 1).map((x) => <div key={x.label} className="kw-part"><span className="kw-part-tag">{x.label}</span> <div className="kw-part-text"><Rich text={x.text} /></div></div>)}
                {ex.differs ? <p className="kw-differs"><span className="kw-differs-tag">다른 관점</span><span><Inline text={ex.differs} /> <span className="kw-differs-note">시험·과제는 배운 자료 기준으로</span></span></p> : null}
                {extra.length > 1 && !more ? <button className="linkish small kw-more-btn" onClick={() => setMore(true)}>{extra.slice(1).map((x) => x.label).join(" · ")} 더 보기</button> : null}
              </> : oldParts.map((t, n) => <Rich key={n} text={t} />)}
              {see.length ? <p className="small kw-see">{see.some((q) => q.sure) ? <span className="muted">먼저 알 것 </span> : null}{see.filter((q) => q.sure).map((q) => <button key={q.title} className="chip" onClick={() => onOpen(q.id!)}>{q.title}</button>)}
                {see.some((q) => !q.sure) ? <span className="muted">함께 알아보기 </span> : null}{see.filter((q) => !q.sure).map((q) => q.id ? <button key={q.title} className="chip soft" onClick={() => onOpen(q.id!)}>{q.title}</button> : <span key={q.title} className="chip soft">{q.title}</span>)}</p> : null}
              {asking ? <form className="row" onSubmit={(e) => { e.preventDefault(); if (why.trim()) explain(why); }}><input className="ws-input" autoFocus value={why} onChange={(e) => setWhy(e.target.value)} placeholder="어디가 막히나요? (예: 해시 함수가 뭔지 모르겠어요)" maxLength={300} />
                <button className="btn small" disabled={explaining || !why.trim()}>{explaining ? "만드는 중…" : "물어보기"}</button></form>
                : item.explain ? <button className="btn ghost small" onClick={() => setAsking(true)}>그래도 모르겠어요</button> : null}</div></details>
            : <button className="linkish small kw-hard" onClick={() => explain()} title="AI가 쉬운 말·비유·작은 예로 풀어 줘요. 복습 단계는 그대로예요.">설명이 어려워요</button>}
        </>
      )}
      <div className="kw-d-act">
        <button className="btn primary kw-quiz" disabled={quizzing} onClick={() => void quiz()}>확인 문제</button>
        <span className="small muted">{item.graduated ? "졸업했어요 · 복습에서 빠져요" : next ? `다음 복습 ${whenText(next.dueAt)}` : item.state === "met" ? "아직 물어본 적 없어요" : ""}</span>
      </div>

      {links.length ? <section><p className="eyebrow">이어진 지식 · {links.length}</p>
        <ul className="kw-rels">{links.map((l) => <li key={`${l.out ? "f" : "b"}${l.item.id}`}>
          <span className="kw-rel-head">{relWord(l.relation, l.out) ? <span className="kw-rel" title={l.out ? `이것 —${l.relation}→ ${l.item.title}` : `${l.item.title} —${l.relation}→ 이것`}>{relWord(l.relation, l.out)}</span>
              : <><span className="kw-rel">{l.relation}</span><span className="kw-dir" aria-hidden>{l.out ? "→" : "←"}</span></>}
            <button className="linkish" onClick={() => onOpen(l.item.id)}><Inline text={l.item.title} /></button>
            {l.out ? <button className="kw-x" aria-label="고리 지우기" onClick={() => void onAct(() => call("/api/knowledge/link", { from: item.id, to: l.item.id }, "DELETE"))}>×</button> : null}</span>
          {l.note ? <span className="kw-note">{l.note}</span> : null}</li>)}</ul></section> : null}


      {detail.near?.length ? <p className="kw-near small"><span className="muted" title="뜻이 겹치거나 같이 나오지만, 어느 쪽이 먼저인지·무엇을 쓰는지 분명하지 않아 고리로 잇지 않았어요.">가까운 지식</span>
        {detail.near.map((n) => <button key={n.id} className="linkish" onClick={() => onOpen(n.id)}>{n.title}</button>)}</p> : null}

      <div className="kw-folds">
        <details className="ws-fold"><summary>내 기록 <span className="muted num">맞힘 {s.correct} · 틀림 {s.wrong} · 힌트 {s.hint}{s.asked ? ` · 물어봄 ${s.asked}` : ""}</span></summary>
          {s.correctDays.length ? <p className="small muted">서로 다른 날 맞힘 {s.correctDays.length}/3 (3이면 졸업)</p> : null}
          {detail.events.length ? <ol className="kw-events">{detail.events.slice(0, 20).map((e) => <li key={e.id}><span className={`chip ev-${e.kind}`}>{EVENT_LABEL[e.kind]}</span> <span className="small">{e.detail}</span> <span className="small muted">{e.source ? `${e.source.title} · ` : ""}{ago(e.at)}</span></li>)}</ol> : <p className="small muted">아직 기록이 없어요.</p>}</details>
        <details className="ws-fold"><summary>어디서 만났나 <span className="muted num">{item.sources.length}</span></summary>
          <ul className="kw-sources">{item.sources.slice().reverse().slice(0, 12).map((src, i) => <li key={i} className="small"><span className="chip">{{ pdf: "PDF", web: "웹 글", code: "코드", chat: "대화", manual: "직접" }[src.kind] ?? src.kind}</span>{" "}
            {src.url ? <a href={src.url} target="_blank" rel="noreferrer">{src.title}</a> : src.title}{src.page ? ` p.${src.page}` : ""}{src.quote ? <span className="muted"> · “{src.quote.slice(0, 80)}”</span> : null}</li>)}</ul></details>
        <details className="ws-fold kw-manage"><summary>고치기·정리</summary>
          <div className="stack">
            <div><p className="eyebrow">상태 직접 바꾸기</p>
              <div className="ws-seg" role="radiogroup" aria-label="상태">
                {(["met", "unknown", "known"] as KState[]).map((st) => <button key={st} role="radio" aria-checked={item.state === st && !item.graduated} className={item.state === st && !item.graduated ? "on" : ""} onClick={() => setState({ state: st })}>{STATE_LABEL[st]}</button>)}
                <button role="radio" aria-checked={item.graduated} className={item.graduated ? "on" : ""} onClick={() => setState({ graduated: !item.graduated })} title="복습에서 빼요. 기록은 남아요.">졸업</button>
              </div></div>
            <div><p className="eyebrow">주제 · 종류</p>
              <div className="row">
                <select className="ws-select" value={item.folderId ?? ""} onChange={(e) => void onAct(() => call(`/api/knowledge/item/${item.id}`, { folderId: e.target.value || null }, "PATCH"))} aria-label="주제 옮기기">
                  <option value="">주제 없음</option>{folderPaths(folders).map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}
                </select>
                <select className="ws-select" value={item.kind ?? ""} onChange={(e) => void onAct(() => call(`/api/knowledge/item/${item.id}`, { kind: e.target.value }, "PATCH"))} aria-label="종류">
                  {!item.kind ? <option value="">종류 정리 중</option> : null}{(Object.keys(KIND_LABEL) as KKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select></div></div>
            <div><p className="eyebrow">다른 이름</p>
              <div className="row">{item.aliases.map((a) => <span key={a} className="chip">{a}<button className="kw-x" aria-label={`${a} 지우기`} onClick={() => void onAct(() => call(`/api/knowledge/item/${item.id}`, { aliases: item.aliases.filter((x) => x !== a) }, "PATCH"))}>×</button></span>)}
                <form onSubmit={(e) => { e.preventDefault(); if (alias.trim()) void onAct(() => call(`/api/knowledge/item/${item.id}`, { aliases: [...item.aliases, alias.trim()] }, "PATCH"), () => setAlias("")); }}>
                  <input className="ws-input kw-alias" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="+ 다른 이름" /></form></div></div>

            <div><p className="eyebrow">고리 · 합치기</p>
              {mode === "link" || mode === "merge" ? (
                <div className="kw-pick">
                  <div className="row">{mode === "link" ? <input className="ws-input kw-rel-in" value={relation} onChange={(e) => setRelation(e.target.value)} aria-label="관계" /> : null}
                    <input className="ws-input" autoFocus value={linkQuery} onChange={(e) => setLinkQuery(e.target.value)} placeholder={mode === "link" ? "이을 지식 찾기" : "이것과 같은 지식 찾기"} />
                    <button className="btn ghost small" onClick={() => { setMode(""); setLinkQuery(""); }}>취소</button></div>
                  <ul>{linkHits.map((h) => <li key={h.id}><button className="kw-hit" onClick={() => void onAct(() => mode === "link" ? call("/api/knowledge/link", { from: item.id, to: h.id, relation }) : call("/api/knowledge/merge", { keep: item.id, drop: h.id }), () => { setMode(""); setLinkQuery(""); })}>
                    <StateChip state={h.state} /> {h.title} <span className="small muted">{h.line.slice(0, 50)}</span></button></li>)}</ul>
                  {mode === "merge" ? <p className="small muted">고른 지식의 이름, 출처, 고리, 기록이 이 지식으로 합쳐져요.</p> : null}
                </div>
              ) : <div className="row"><button className="btn ghost small" onClick={() => setMode("link")}>+ 고리 잇기</button><button className="btn ghost small" onClick={() => setMode("merge")}>같은 지식 합치기</button></div>}</div>
            <Similar itemId={item.id} onOpen={onOpen} onAct={onAct} />
            {mode === "delete" ? <div className="row small"><span>이 지식과 기록을 모두 지울까요?</span><button className="btn small danger" onClick={() => void onAct(() => call(`/api/knowledge/item/${item.id}`, undefined, "DELETE"), onGone)}>지우기</button><button className="btn ghost small" onClick={() => setMode("")}>취소</button></div>
              : <button className="btn ghost small kw-del" onClick={() => setMode("delete")}>지식 지우기</button>}
          </div>
        </details>
      </div>
    </div>
  );
}

type SimilarHit = ItemLite & { score: number; linked: boolean };
/**
 * 비슷한 지식: candidates by meaning (EmbeddingGemma on the app server). Close is not the same — the learner decides
 * whether to merge, link, or leave it. The first search downloads the model once (about 300 MB).
 */
function Similar({ itemId, onOpen, onAct }: { itemId: string; onOpen: (id: string) => void; onAct: (run: () => Promise<unknown>, after?: () => void) => Promise<void> }) {
  const [hits, setHits] = useState<SimilarHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => later(() => { setHits(null); setErr(""); }), [itemId]);
  const find = async () => {
    setBusy(true); setErr("");
    try { setHits((await call<{ hits: SimilarHit[] }>(`/api/knowledge/item/${itemId}/similar?limit=5`)).hits); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div><p className="eyebrow">비슷한 지식</p>
      {hits === null ? <div className="row"><button className="btn ghost small" disabled={busy} onClick={() => void find()}>{busy ? "찾는 중… (처음 한 번은 모델을 내려받아 1~2분)" : "뜻이 비슷한 지식 찾기"}</button></div> : null}
      {err ? <p className="ws-err small">{err}</p> : null}
      {hits?.length === 0 ? <p className="small muted">비슷한 지식이 없어요.</p> : null}
      {hits?.length ? <><ul className="kw-links">{hits.map((h) => <li key={h.id}>
        <button className="linkish" onClick={() => onOpen(h.id)}>{h.title}</button> <span className="small muted num">{Math.round(h.score * 100)}%{h.linked ? " · 이어짐" : ""}</span>{" "}
        <button className="btn ghost small" onClick={() => { if (window.confirm(`"${h.title}"을(를) 이 지식으로 합칠까요? 이름·출처·고리·기록이 이쪽으로 옵니다.`)) void onAct(() => call("/api/knowledge/merge", { keep: itemId, drop: h.id }), () => setHits(null)); }}>같은 것 · 합치기</button>
        {!h.linked ? <button className="btn ghost small" onClick={() => void onAct(() => call("/api/knowledge/link", { from: itemId, to: h.id, relation: "관련" }), () => setHits((x) => x?.map((y) => y.id === h.id ? { ...y, linked: true } : y) ?? null))}>관련 · 잇기</button> : null}
      </li>)}</ul><p className="small muted">뜻이 가까운 순서예요. 가깝다고 같은 지식은 아니에요(깊이·너비 우선 탐색처럼 반대 개념도 가깝게 나와요).</p></> : null}
    </div>
  );
}

type Dup = { id: string; newId: string; otherId: string; verdict: string; reason: string; score: number; newTitle: string; newLine: string; otherTitle: string; otherLine: string };
/**
 * 중복 의심: pairs the duplicate check (이름 → 뜻이 가까운 후보 → AI 판정) found to be the same knowledge. Nothing is
 * merged without the learner: 합치기 keeps the older one (its record and name stay; the other name becomes 다른 이름).
 */
function Duplicates({ pairs, onOpen, onAct }: { pairs: Dup[]; onOpen: (id: string) => void; onAct: (run: () => Promise<unknown>, after?: () => void) => Promise<void> }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="panel kw-dupes">
      <button className="linkish" onClick={() => setOpen((x) => !x)}><b>같은 지식일 수 있어요 · {pairs.length}</b> <span className="small muted">{open ? "접기" : "확인하기"}</span></button>
      {open ? <ul className="kw-links">{pairs.map((p) => <li key={p.id} className="stack">
        <span><button className="linkish" onClick={() => onOpen(p.otherId)}>{p.otherTitle}</button> <span className="muted">↔</span> <button className="linkish" onClick={() => onOpen(p.newId)}>{p.newTitle}</button>
          <span className="small muted"> · {p.reason}</span></span>
        <span className="row">
          <button className="btn small" onClick={() => void onAct(() => call(`/api/knowledge/dupes/${p.id}`, { action: "merge", keep: p.otherId }))}>“{p.otherTitle}”으로 합치기</button>
          <button className="btn ghost small" onClick={() => void onAct(() => call(`/api/knowledge/dupes/${p.id}`, { action: "dismiss" }))}>다른 지식이에요</button>
        </span></li>)}</ul> : null}
    </section>
  );
}

type MaterialRow = { key: string; group: "material" | "project" | "code"; kind: string; title: string; items: number; itemIds: string[]; lastAt: string; keys: string[];
  folderId: string | null; genId?: string; sourceId?: string; stages?: Array<{ name: string; itemIds: string[] }> };
type MaterialFolder = { id: string; name: string; order: number };
const MAT_ICON: Record<string, string> = { pdf: "📄", web: "🌐", project: "🛠", code: "⌨" };
type Act = (run: () => Promise<unknown>, after?: () => void) => Promise<void>;

/** + 폴더 (자료): a name, and the folder is there to drag 자료 into. */
function MatFolderNew({ onAct }: { onAct: Act }) {
  const [on, setOn] = useState(false);
  const [name, setName] = useState("");
  if (!on) return <button className="kw-sec-add" onClick={() => { setOn(true); setName(""); }} title="자료 폴더 만들기 (수업·주제별로 자료 묶기)">+ 폴더</button>;
  return <form className="row kw-sec-form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void onAct(() => call("/api/knowledge/material-folder", { name: name.trim() }), () => setOn(false)); }}>
    <input className="ws-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="폴더 이름 (예: 그래픽스 수업)" maxLength={60} onKeyDown={(e) => { if (e.key === "Escape") setOn(false); }} />
    <button className="btn small" disabled={!name.trim()}>만들기</button></form>;
}
/** A learner's 자료 folder: folds, takes dropped 자료, can be renamed or removed (its 자료 go back outside). */
function MatFolderBox({ folder, rows, drop, onAct, children }: { folder: MaterialFolder; rows: MaterialRow[]; drop: Record<string, unknown>; onAct: Act; children: (m: MaterialRow) => React.ReactNode }) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(folder.name);
  return (
    <details className="kw-mgroup kw-mfolder" open>
      <summary className="kw-folder" {...drop}>
        {edit ? <form className="row" onSubmit={(e) => { e.preventDefault(); void onAct(() => call(`/api/knowledge/material-folder/${folder.id}`, { name }, "PATCH"), () => setEdit(false)); }}>
          <input className="ws-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} onKeyDown={(e) => { if (e.key === "Escape") setEdit(false); }} /></form>
          : <span className="kw-fname">📁 {folder.name}</span>}
        <span className="kw-count num">{rows.length}</span>
        <details className="ws-menu kw-mf-menu" onClick={(e) => e.stopPropagation()}><summary aria-label="폴더 설정">⋯</summary>
          <div className="ws-menu-card">
            <button className="mm-item" onClick={(e) => { (e.currentTarget.closest(".kw-mf-menu") as HTMLDetailsElement).open = false; setEdit(true); }}><span>이름 바꾸기</span></button>
            <button className="mm-item" onClick={() => void onAct(() => call(`/api/knowledge/material-folder/${folder.id}`, undefined, "DELETE"))}><span>폴더 지우기</span><small>안의 자료는 폴더 밖으로 나와요</small></button>
          </div></details>
      </summary>
      <ul>{rows.map(children)}{!rows.length ? <li className="small muted kw-empty-sec">자료를 끌어다 놓아요</li> : null}</ul>
    </details>
  );
}
/** Over a picked 자료: its map or its list, and which 자료 folder it is in. */
function MaterialHead({ m, folders, mode, onMode, onPlace }: { m: MaterialRow; folders: MaterialFolder[]; mode: "map" | "list"; onMode: (x: "map" | "list") => void; onPlace: (folderId: string | null) => void }) {
  const hasMap = Boolean(m.genId || m.sourceId || m.stages);
  return (
    <div className="row kw-mhead">
      {hasMap ? <div className="ws-seg" role="tablist" aria-label="보기">{([["map", m.genId ? "목차" : m.stages ? "단계별" : "글 지도"], ["list", "지식 목록"]] as const).map(([k, label]) =>
        <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? "on" : ""} onClick={() => onMode(k)}>{label}</button>)}</div> : null}
      {m.genId ? <button className="btn small ghost" title="원문 쪽 보기·문제 풀기는 공부 화면의 자료 지도에서" onClick={() => window.dispatchEvent(new CustomEvent("recaller:map-open", { detail: { genId: m.genId } }))}>원문·문제</button> : null}
      {m.group === "project" ? <button className="btn small" onClick={() => go("project")}>프로젝트 화면</button> : null}
      {m.group === "code" && m.keys[0]?.startsWith("code:cp_") ? <button className="btn small" onClick={() => go("code", { id: m.keys[m.keys.length - 1].slice(5) })}>문제 열기</button> : null}
      <label className="row small kw-mplace">폴더 <select className="ws-select" value={m.folderId ?? ""} onChange={(e) => onPlace(e.target.value || null)}>
        <option value="">없음</option>{folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
    </div>
  );
}
type OutlineCard = { id: string; title: string; core: boolean; pages: number[]; state: "new" | "met" | "unknown" | "known" | "graduated"; knowledgeId?: string; mistakes: string[] };
type Outline = { title: string; pages: number; sections: Array<{ id: string; title: string; pages: number[]; cards: OutlineCard[] }>; counts: Record<string, number> };
const OUT_STATE: Record<OutlineCard["state"], [string, string]> = { unknown: ["몰랐음", "bad"], met: ["만남", "read"], known: ["앎", "good"], graduated: ["졸업", "good"], new: ["아직", "none"] };
const pageRange = (pages: number[]) => !pages.length ? "" : pages.length === 1 ? `p.${pages[0]}` : `p.${Math.min(...pages)}–${Math.max(...pages)}`;
/**
 * PDF 자료: 목차만 깔끔하게, 누르면 그 구역의 지식 (2026-10-30 사용자 "자료 지도로 넘어가는 게 아니라 목차만 딱 깔끔하게 보이고 누르면
 * 세부 내역"). 자료 지도 서버(/api/study-map, 읽기만)의 목차·카드·내 상태를 그대로 쓴다. 지식을 누르면 오른쪽에 자세히.
 */
function MaterialOutline({ genId, items, sel, onPick }: { genId: string; items: ItemLite[]; sel: string | null; onPick: (id: string) => void }) {
  const [map, setMap] = useState<Outline | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => later(() => void call<{ map: Outline }>(`/api/study-map/${genId}`).then((r) => setMap(r.map)).catch((e) => setError(errorText(e)))), [genId]);
  if (error) return <p className="ws-err">{error}</p>;
  if (!map) return <p className="small muted">목차를 불러오는 중…</p>;
  const line = (id?: string) => (id ? items.find((i) => i.id === id)?.line : "") ?? "";
  const tally = (cards: OutlineCard[]) => (["unknown", "met", "known", "new"] as const).map((k) => [k, cards.filter((c) => (k === "known" ? c.state === "known" || c.state === "graduated" : c.state === k)).length] as const);
  return (
    <div className="ko">
      <p className="small muted ko-legend"><span><i className="dot bad" />몰랐음 {map.counts.unknown}</span><span><i className="dot read" />만남 {map.counts.met}</span>
        <span><i className="dot good" />앎 {map.counts.known + map.counts.graduated}</span>{map.counts.new ? <span><i className="dot none" />아직 {map.counts.new}</span> : null}<span>· {map.pages}쪽</span></p>
      <ol className="ko-list">{map.sections.map((sec, n) => {
        const on = open === sec.id, t = tally(sec.cards), total = sec.cards.length || 1;
        return <li key={sec.id} className={on ? "on" : ""}>
          <button className="ko-row" aria-expanded={on} onClick={() => setOpen(on ? null : sec.id)}>
            <span className="ko-n num">{n + 1}</span>
            <span className="ko-title">{sec.title}</span>
            <span className="ko-pages small muted">{pageRange(sec.pages)}</span>
            <span className="ko-bar" aria-label={t.map(([k, v]) => `${OUT_STATE[k][0]} ${v}`).join(" · ")}>{t.map(([k, v]) => v ? <i key={k} className={OUT_STATE[k][1]} style={{ width: `${(v / total) * 100}%` }} /> : null)}</span>
            <span className="ko-count num small muted">{sec.cards.length}</span>
          </button>
          {on ? <ul className="ko-cards">{sec.cards.map((c) => <li key={c.id}>
            <button className={`ko-card${c.knowledgeId && sel === c.knowledgeId ? " sel" : ""}`} disabled={!c.knowledgeId} onClick={() => c.knowledgeId && onPick(c.knowledgeId)}>
              <span className={`ko-st ${OUT_STATE[c.state][1]}`}>{OUT_STATE[c.state][0]}</span>
              <span className="ko-ctext"><b><Inline text={c.title} />{c.core ? <span className="ko-core" title="핵심">★</span> : null}</b>
                {line(c.knowledgeId) ? <span className="ko-line"><Inline text={line(c.knowledgeId)} /></span> : null}</span>
              <span className="small muted ko-cp">{pageRange(c.pages)}</span>
            </button></li>)}</ul> : null}
        </li>;
      })}</ol>
    </div>
  );
}
/** 웹 글 자료: its 글 지도 (질문·흐름·핵심·개념어), the same one the 웹 글 screen shows. */
function MaterialArticle({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [source, setSource] = useState<SourceView | null>(null);
  const [error, setError] = useState("");
  useEffect(() => later(() => void call<{ source: SourceView }>(`/api/knowledge/source/${id}`).then((r) => setSource(r.source)).catch((e) => setError(errorText(e)))), [id]);
  if (error) return <p className="ws-err">{error}</p>;
  if (!source) return <p className="small muted">글 지도를 불러오는 중…</p>;
  if (!source.map) return <div className="stack"><p className="small muted">이 글은 글 지도 전에 읽은 글이에요.</p><button className="btn small" onClick={() => go("web", { id })}>웹 글 화면에서 열기</button></div>;
  return <div className="stack"><ArticleMap source={source} onChanged={(s) => { setSource(s); onChanged(); }} /><button className="linkish small" onClick={() => go("web", { id })}>웹 글 화면에서 열기 (확인 문제·원문)</button></div>;
}
/** 프로젝트 자료: the knowledge by the course stage it first came up in. */
function ProjectStages({ stages, items, sel, onPick }: { stages: Array<{ name: string; itemIds: string[] }>; items: ItemLite[]; sel: string | null; onPick: (id: string) => void }) {
  return (
    <div className="stack kw-stages">{stages.map((st) => {
      const mine = st.itemIds.map((id) => items.find((i) => i.id === id)).filter((i): i is ItemLite => Boolean(i));
      return <section key={st.name}><p className="eyebrow">{st.name} · {mine.length}</p>
        <ul className="kw-items">{mine.map((i) => <li key={i.id}><button className={`kw-item${sel === i.id ? " on" : ""}`} onClick={() => onPick(i.id)}>
          <span className="kw-item-top"><StateChip state={i.state} graduated={i.graduated} /><span className="kw-title"><Inline text={i.title} /></span></span>
          {i.line ? <span className="kw-line"><Inline text={i.line} /></span> : null}</button></li>)}</ul></section>;
    })}</div>
  );
}
