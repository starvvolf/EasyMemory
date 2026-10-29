"use client";
// 지식창: everything the learner has met, did not know and knows, across all materials, kept like files in folders.
// Left: folders (drag items or folders onto a folder to move them). Middle: the folder's items. Right: one item —
// its meaning, names, chains, where it came from and its record — with 확인 문제, 합치기 and the state buttons.
import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { call, dday, errorText, folderPaths, go, handoff, later, KIND_LABEL, SOURCE_LABEL, STATE_LABEL, EVENT_LABEL, whenText, type Detail, type Folder, type GoalView, type ItemLite, type KKind, type KState,
  type Material, type Question, type ReviewStatus, type Tree } from "./api";
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
  // 4개 축 (2026-10-28): the left column shows 주제 (the folder tree), 목표 or 자료; the list follows what is picked there.
  const [view, setView] = useState<"topic" | "goal" | "material">("topic");
  const [goals, setGoals] = useState<GoalView[]>([]);
  const [itemGoals, setItemGoals] = useState<Record<string, string[]>>({});
  const [materials, setMaterials] = useState<Material[]>([]);
  const [goalSel, setGoalSel] = useState<string | null>(null);
  const [matSel, setMatSel] = useState<string | null>(null);
  const [sorting, setSorting] = useState(false);

  const load = useCallback(async () => {
    try { setTree(await call<Tree>("/api/knowledge")); } catch (e) { setError(errorText(e)); }
    call<{ pairs: Dup[] }>("/api/knowledge/dupes").then((r) => setDupes(r.pairs)).catch(() => undefined);
    call<{ goals: GoalView[]; itemGoals: Record<string, string[]> }>("/api/knowledge/goals").then((r) => { setGoals(r.goals); setItemGoals(r.itemGoals); }).catch(() => undefined);
    call<{ materials: Material[] }>("/api/knowledge/materials").then((r) => setMaterials(r.materials)).catch(() => undefined);
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

  // 자료 보기는 출처로 묶는다 (2026-10-30 사용자: "웹/PDF는 자료 출처로 묶고, 프로젝트는 프로젝트로 묶어"). 같은 프로젝트 코스를
  // 여러 번 진행해도 프로젝트 하나로 보인다.
  const navMaterials = useMemo(() => groupMaterials(materials), [materials]);
  const shown = useMemo(() => {
    const inMaterial = view === "material" && matSel ? new Set(navMaterials.find((m) => m.key === matSel)?.itemIds ?? []) : null;
    let list = hits ?? tree.items.filter((i) => view === "goal" && goalSel ? (itemGoals[i.id] ?? []).includes(goalSel) : inMaterial ? inMaterial.has(i.id)
      : view !== "topic" || folder === "all" ? true : folder === "none" ? !i.folderId : Boolean(i.folderId && subtree(folder).has(i.folderId)));
    if (filter === "graduated") list = list.filter((i) => i.graduated); else if (filter !== "all") list = list.filter((i) => i.state === filter && !i.graduated);
    if (!hits) list = [...list].sort((a, b) => sort === "weak" ? b.weak - a.weak || b.lastAt.localeCompare(a.lastAt) : sort === "name" ? a.title.localeCompare(b.title, "ko") : b.lastAt.localeCompare(a.lastAt));
    return list;
  }, [hits, tree.items, folder, filter, sort, subtree, view, goalSel, matSel, itemGoals, navMaterials]);

  const dueNow = tree.items.filter((i) => !i.graduated && i.state !== "met" && (!i.dueAt || Date.parse(i.dueAt) <= Date.now())).length;
  const counts = { total: tree.items.length, unknown: tree.items.filter((i) => i.state === "unknown").length, known: tree.items.filter((i) => i.state === "known").length, met: tree.items.filter((i) => i.state === "met").length };
  const goal = goals.find((g) => g.id === goalSel) ?? null;
  const material = navMaterials.find((m) => m.key === matSel) ?? null;
  const folderName = view === "goal" && goal ? goal.name : view === "material" && material ? material.title
    : view !== "topic" || folder === "all" ? "전체" : folder === "none" ? "주제 없음" : folderPaths(tree.folders).find((f) => f.id === folder)?.path ?? "";
  const unsorted = tree.items.filter((i) => !i.kind).length;
  const toPlace = materials.filter((m) => !m.goals.length && !m.ignored);
  // 정리할 것: things that need the learner now and then (같은 지식 의심, 목표 없는 자료, 빈 뜻) — one quiet tray, not banners.
  const emptyMeaning = tree.items.filter((i) => !i.line).length;
  const chores = (dupes.length ? 1 : 0) + (toPlace.length ? 1 : 0) + (emptyMeaning ? 1 : 0) + (unsorted ? 1 : 0);

  const drop = (target: string | null) => (e: DragEvent) => {
    e.preventDefault(); (e.currentTarget as HTMLElement).classList.remove("drop");
    const kind = e.dataTransfer.getData("text/x-kind"), id = e.dataTransfer.getData("text/x-id");
    if (!id) return;
    if (kind === "item") void act(() => call(`/api/knowledge/item/${id}`, { folderId: target }, "PATCH"));
    if (kind === "folder" && id !== target) void act(() => call(`/api/knowledge/folder/${id}`, { parentId: target }, "PATCH"));
  };
  const dropZone = (target: string | null) => ({ onDragOver: (e: DragEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add("drop"); },
    onDragLeave: (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove("drop"), onDrop: drop(target) });
  const dragOf = (kind: "item" | "folder", id: string) => ({ draggable: true, onDragStart: (e: DragEvent) => { e.dataTransfer.setData("text/x-kind", kind); e.dataTransfer.setData("text/x-id", id); e.dataTransfer.effectAllowed = "move"; } });

  const startQuiz = async () => {
    const q = view === "goal" && goalSel ? `?goalId=${goalSel}&count=10` : view === "topic" && folder !== "all" && folder !== "none" ? `?folderId=${folder}&count=10` : "?count=10";
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
        <div className={`kw-folder${folder === f.id ? " on" : ""}`} style={{ paddingLeft: 8 + depth * 14 }} {...dragOf("folder", f.id)} {...dropZone(f.id)}>
          <button className="kw-twist" aria-label={isOpen ? "접기" : "펴기"} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })} style={{ visibility: kids.length ? "visible" : "hidden" }}>{isOpen ? "▾" : "▸"}</button>
          <button className="kw-fname" onClick={() => { setFolder(f.id); setQuery(""); }}>{f.name}</button>
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
              <button className="mm-item" onClick={() => window.open("/api/knowledge/report", "_blank", "noopener")}><span>점검 보고서</span><small>저장소 전체를 글로: 요약·점검·주제별 지식·목표 (.md)</small></button>
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
      {goals.some((g) => !g.closed) ? <GoalStrip goals={goals.filter((g) => !g.closed)} onOpen={(id) => { setView("goal"); setGoalSel(id); setQuery(""); }}
        onReview={async (id) => { setView("goal"); setGoalSel(id); setQuery(""); setNotice("");
          try { const r = await call<{ questions: Question[] } & ReviewStatus>(`/api/knowledge/quiz?goalId=${id}&count=10`);
            if (r.questions.length) setRun({ title: `복습 · ${goals.find((g) => g.id === id)?.name ?? ""}`, questions: r.questions });
            else setNotice(r.next ? `지금 복습할 지식이 없어요. 다음 복습은 ${whenText(r.next)}이에요.` : "이 목표에는 아직 복습할 지식이 없어요."); } catch (e) { setError(errorText(e)); } }} /> : null}
      {chores ? (
        <details className="kw-chores">
          <summary><i className="dot bad" /><b>정리할 것</b><span className="small muted kw-chores-what">{[dupes.length ? `같은 지식 의심 ${dupes.length}` : "", toPlace.length ? `목표 없는 자료 ${toPlace.length}` : "",
            emptyMeaning ? `뜻 빈 지식 ${emptyMeaning}` : "", unsorted ? `정리 중 ${unsorted}` : ""].filter(Boolean).join(" · ")}</span></summary>
          <div className="stack kw-chores-body">
            {toPlace.length ? <PlaceMaterials materials={toPlace} goals={goals} onAct={act} /> : null}
            {unsorted ? <p className="kw-fill row small"><span className="muted">주제·종류를 정리하는 중인 지식 {unsorted}개 (새로 들어오면 몇 초 뒤 저절로 정리돼요)</span>
        <button className="btn ghost small" disabled={sorting} onClick={() => { setSorting(true); void act(async () => { const r = await call<{ sorted: number; suggested: number }>("/api/knowledge/classify", {});
          setNotice(`${r.sorted}개를 주제·종류로 정리했어요.${r.suggested ? ` 목표를 정할 자료 ${r.suggested}개가 있어요.` : ""}`); }).finally(() => setSorting(false)); }}>{sorting ? "정리하는 중…" : "지금 정리"}</button></p> : null}
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
          <div className="ws-seg kw-view" role="tablist" aria-label="보기">
            {([["topic", "주제"], ["goal", "목표"], ["material", "자료"]] as const).map(([k, label]) => <button key={k} role="tab" aria-selected={view === k} className={view === k ? "on" : ""}
              onClick={() => { setView(k); setQuery(""); }}>{label}{k === "material" && toPlace.length ? <i className="dot bad" /> : null}</button>)}
          </div>
          {view === "goal" ? <GoalNav goals={goals} sel={goalSel} onPick={(id) => { setGoalSel(id); setQuery(""); }} onAct={act} /> : null}
          {view === "material" ? <MaterialNav materials={navMaterials} goals={goals} sel={matSel} onPick={(k) => { setMatSel(k); setQuery(""); }} onAct={act} /> : null}
          {view === "topic" ? <>
          <div className={`kw-folder root${folder === "all" ? " on" : ""}`} {...dropZone(null)}><button className="kw-fname" onClick={() => { setFolder("all"); setQuery(""); }}>전체</button><span className="kw-count num">{counts.total}</span></div>
          <ul>{(children.get(null) ?? []).map((f) => <FolderRow key={f.id} f={f} depth={0} />)}</ul>
          <div className={`kw-folder root${folder === "none" ? " on" : ""}`} {...dropZone(null)}><button className="kw-fname" onClick={() => { setFolder("none"); setQuery(""); }}>주제 없음</button><span className="kw-count num">{tree.items.filter((i) => !i.folderId).length}</span></div>
          {folder !== "all" && folder !== "none" && tree.folders.some((f) => f.id === folder) ? <details className="ws-fold kw-ftools-fold"><summary>폴더 설정</summary><FolderTools key={folder} folder={tree.folders.find((f) => f.id === folder)!} onAct={act} onGone={() => setFolder("all")} /></details> : null}
          </> : null}
        </nav>

        <section className="kw-list panel" aria-label="지식 목록">
          <div className="row kw-list-head">
            <b>{hits ? `"${query}" 찾은 것 ${hits.length}` : `${folderName} · ${shown.length}`}</b>
            {!hits ? <select className="ws-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="정렬"><option value="recent">최근 순</option><option value="weak">약한 순</option><option value="name">이름 순</option></select> : null}
          </div>
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
        </section>

        <section className="kw-detail panel" aria-label="지식 자세히">
          {detail ? <ItemDetail key={detail.item.id} detail={detail} folders={tree.folders} goals={goals} mine={itemGoals[detail.item.id] ?? []} quizzing={Boolean(run)} onAct={act} onOpen={setSel} onGone={() => setSel(null)}
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

function ItemDetail({ detail, folders, goals, mine, quizzing, onAct, onOpen, onGone, onQuiz }: { detail: Detail; folders: Folder[]; goals: GoalView[]; mine: string[]; quizzing: boolean; onAct: (run: () => Promise<unknown>, after?: () => void) => Promise<void>; onOpen: (id: string) => void; onGone: () => void; onQuiz: (q: Question[]) => void }) {
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
  const myGoals = goals.filter((g) => mine.includes(g.id));
  // 틀렸을 때 먼저 볼 것(먼저 알 것·조건·상위)이 위로.
  const order = (w: string | null) => ["먼저 알 것", "조건", "상위", "씀", "하위", "쓰임", "다음 단계", "조건이 됨"].indexOf(w ?? "") >>> 0;
  const links = [...detail.links.map((l) => ({ ...l, out: true })), ...detail.backlinks.map((l) => ({ ...l, out: false }))].sort((a, b) => order(relWord(a.relation, a.out)) - order(relWord(b.relation, b.out)));
  const next = item.review && !item.graduated && item.state !== "met" ? item.review : null;
  return (
    <div className="kw-d stack">
      {/* 보이는 것: 무엇인지(이름·상태·뜻), 바로 할 일(확인 문제·다음 복습), 이어진 지식, 목표. 나머지는 아래 접힌 칸에. */}
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

      {myGoals.length ? <div className="kw-d-goals"><span className="eyebrow">목표</span>{myGoals.map((g) => <span key={g.id} className="chip">{g.name}{g.date ? ` · ${dday(g.daysLeft)}` : ""}
        {g.itemIds.includes(item.id) ? <button className="kw-x" aria-label={`${g.name}에서 빼기`} onClick={() => void onAct(() => call(`/api/knowledge/goals/${g.id}/item`, { itemId: item.id, on: false }))}>×</button> : null}</span>)}</div> : null}

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
            {goals.some((g) => !g.closed && !mine.includes(g.id)) ? <div><p className="eyebrow">목표에 넣기</p>
              <select className="ws-select" value="" aria-label="목표에 넣기" onChange={(e) => { if (e.target.value) void onAct(() => call(`/api/knowledge/goals/${e.target.value}/item`, { itemId: item.id, on: true })); }}>
                <option value="">이 지식만 따로 넣기…</option>{goals.filter((g) => !g.closed && !mine.includes(g.id)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <p className="small muted">자료가 목표에 들어 있으면 그 자료의 지식은 저절로 따라가요.</p></div> : null}
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

type Act = (run: () => Promise<unknown>, after?: () => void) => Promise<void>;
/** Open goals as cards: D-day, what is due, 복습 for just that goal. */
function GoalStrip({ goals, onOpen, onReview }: { goals: GoalView[]; onOpen: (id: string) => void; onReview: (id: string) => void }) {
  return (
    <section className="kw-goals" aria-label="목표">
      {goals.map((g) => <article key={g.id} className={`panel kw-goal${g.daysLeft !== null && g.daysLeft <= 3 && g.daysLeft >= 0 ? " soon" : ""}`}>
        <button className="linkish kw-goal-name" onClick={() => onOpen(g.id)}><b>{g.name}</b>{g.date ? <span className="chip">{dday(g.daysLeft)}</span> : null}</button>
        <p className="small muted num">지식 {g.counts.total} · 몰랐음 {g.counts.unknown} · 앎 {g.counts.known}{g.counts.due ? <> · <b>복습 차례 {g.counts.due}</b></> : null}</p>
        <button className="btn small" onClick={() => onReview(g.id)}>이 목표 복습</button>
      </article>)}
    </section>
  );
}
/** 목표 보기 (left column): the goals, a new one, and the picked one's settings and 자료. */
function GoalNav({ goals, sel, onPick, onAct }: { goals: GoalView[]; sel: string | null; onPick: (id: string | null) => void; onAct: Act }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const g = goals.find((x) => x.id === sel);
  return (
    <div className="stack">
      <ul>{goals.map((x) => <li key={x.id}><div className={`kw-folder${sel === x.id ? " on" : ""}`}><button className="kw-fname" onClick={() => onPick(x.id)}>{x.closed ? "✓ " : ""}{x.name}</button>
        <span className="kw-count num">{x.date ? `${dday(x.daysLeft)} · ` : ""}{x.counts.total}</span></div></li>)}</ul>
      {!goals.length ? <p className="small muted">아직 목표가 없어요. 수업·시험, 코테 준비처럼 왜 공부하는지를 하나 만들고 자료를 넣으면, 그 자료의 지식이 따라와요.</p> : null}
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void onAct(async () => { const r = await call<{ goal: { id: string } }>("/api/knowledge/goals", { name, date: date || null }); onPick(r.goal.id); }, () => { setName(""); setDate(""); }); }}>
        <input className="ws-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="+ 새 목표 (예: 그래픽스 중간)" maxLength={60} />
        {name.trim() ? <div className="row"><input className="ws-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="기한 (없어도 돼요)" /><button className="btn small primary">만들기</button></div> : null}
      </form>
      {g ? <GoalTools key={g.id} goal={g} onAct={onAct} onGone={() => onPick(null)} /> : null}
    </div>
  );
}
function GoalTools({ goal, onAct, onGone }: { goal: GoalView; onAct: Act; onGone: () => void }) {
  const [name, setName] = useState(goal.name);
  const [sure, setSure] = useState(false);
  return (
    <details className="ws-fold" open><summary>이 목표</summary>
      <div className="stack">
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (name.trim() && name !== goal.name) void onAct(() => call(`/api/knowledge/goals/${goal.id}`, { name }, "PATCH")); }}>
          <input className="ws-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="목표 이름" /><button className="btn small" disabled={!name.trim() || name === goal.name}>이름 바꾸기</button></form>
        <label className="row small">기한 <input className="ws-input" type="date" value={goal.date ?? ""} onChange={(e) => void onAct(() => call(`/api/knowledge/goals/${goal.id}`, { date: e.target.value || null }, "PATCH"))} /></label>
        <p className="eyebrow">자료 {goal.sources.length}</p>
        <ul className="kw-links">{goal.sources.map((s) => <li key={s.key} className="small"><span className="chip">{SOURCE_LABEL[s.kind] ?? s.kind}</span> {s.title}
          <button className="kw-x" aria-label="목표에서 빼기" onClick={() => void onAct(() => call(`/api/knowledge/goals/${goal.id}/source`, { ...s, on: false }))}>×</button></li>)}</ul>
        {!goal.sources.length ? <p className="small muted">자료 보기에서 자료를 이 목표에 넣어요.</p> : null}
        <div className="row">
          <button className="btn ghost small" onClick={() => void onAct(() => call(`/api/knowledge/goals/${goal.id}`, { closed: !goal.closed }, "PATCH"))}>{goal.closed ? "다시 열기" : "끝냄 (시험이 끝났어요)"}</button>
          {!sure ? <button className="btn ghost small" onClick={() => setSure(true)}>목표 지우기</button>
            : <><span className="small">지식과 기록은 남아요.</span><button className="btn small danger" onClick={() => void onAct(() => call(`/api/knowledge/goals/${goal.id}`, undefined, "DELETE"), onGone)}>지우기</button></>}
        </div>
      </div>
    </details>
  );
}
/** A row of the 자료 view: one 자료, or one project course made of every run of it (keys: the sources underneath). */
type NavMaterial = Material & { group: "material" | "project" | "code"; keys: string[] };
const PROJECT_PREFIX = "프로젝트 코스: ";
/** PDF·웹 글 = 자료, 프로젝트 코스(ref project:…) = 프로젝트 (같은 코스는 하나로), 나머지 코드 = 코드 문제. */
function groupMaterials(materials: Material[]): NavMaterial[] {
  const out: NavMaterial[] = [];
  const projects = new Map<string, NavMaterial>();
  for (const m of materials) {
    if (m.kind === "code" && m.key.startsWith("code:project:")) {
      const title = m.title.startsWith(PROJECT_PREFIX) ? m.title.slice(PROJECT_PREFIX.length) : m.title;
      const p = projects.get(title);
      if (!p) { const row: NavMaterial = { ...m, title, key: `project:${title}`, group: "project", keys: [m.key] }; projects.set(title, row); out.push(row); continue; }
      p.keys.push(m.key);
      p.itemIds = [...new Set([...p.itemIds, ...m.itemIds])]; p.items = p.itemIds.length;
      p.goals = [...new Set([...p.goals, ...m.goals])];
      if (m.lastAt > p.lastAt) p.lastAt = m.lastAt;
      continue;
    }
    out.push({ ...m, group: m.kind === "pdf" || m.kind === "web" ? "material" : "code", keys: [m.key] });
  }
  return out;
}
const MAT_GROUPS = [["material", "자료", "PDF · 웹 글"], ["project", "프로젝트", ""], ["code", "코드 문제", ""]] as const;
/** 자료 보기: 출처 묶음(자료 · 프로젝트 · 코드 문제)마다 접히는 폴더; pick one to see its items, or put it in a goal. */
function MaterialNav({ materials, goals, sel, onPick, onAct }: { materials: NavMaterial[]; goals: GoalView[]; sel: string | null; onPick: (key: string | null) => void; onAct: Act }) {
  const open = goals.filter((g) => !g.closed);
  const row = (m: NavMaterial) => <li key={m.key}><div className={`kw-folder kw-mat${sel === m.key ? " on" : ""}`}>
    <button className="kw-fname" onClick={() => onPick(m.key)} title={m.title}>{m.group === "material" ? <><span className="chip">{SOURCE_LABEL[m.kind] ?? m.kind}</span> </> : null}{m.title}</button><span className="kw-count num">{m.items}</span></div>
    <div className="row small kw-mat-goals">{m.goals.map((id) => goals.find((g) => g.id === id)).filter(Boolean).map((g) => <span key={g!.id} className="chip">{g!.name}</span>)}
      {open.some((g) => !m.goals.includes(g.id)) ? <select className="ws-select" value="" aria-label="목표에 넣기" onChange={(e) => { const gid = e.target.value; if (gid) void onAct(async () => { for (const key of m.keys) await call(`/api/knowledge/goals/${gid}/source`, { key, kind: m.kind, title: m.group === "project" ? `${PROJECT_PREFIX}${m.title}` : m.title, on: true }); }); }}>
        <option value="">+ 목표</option>{open.filter((g) => !m.goals.includes(g.id)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select> : null}</div></li>;
  if (!materials.length) return <ul><li className="small muted">아직 자료가 없어요.</li></ul>;
  return (
    <div className="kw-mgroups">{MAT_GROUPS.map(([g, label, hint]) => {
      const list = materials.filter((m) => m.group === g);
      if (!list.length) return null;
      return <details key={g} className="kw-mgroup" open={g !== "code" || list.some((m) => m.key === sel)}>
        <summary><b>{label}</b>{hint ? <span className="small muted"> {hint}</span> : null}<span className="kw-count num">{list.length}</span></summary>
        <ul>{list.map(row)}</ul>
      </details>;
    })}</div>
  );
}
/**
 * 자료 that no goal holds, grouped by the goal sorting suggested (15 code problems → one "코테 준비에 넣기"); one click puts
 * the whole group in, or each can go elsewhere or stay without a goal.
 */
function PlaceMaterials({ materials, goals, onAct }: { materials: Material[]; goals: GoalView[]; onAct: Act }) {
  const [open, setOpen] = useState(true);
  const [each, setEach] = useState<string | null>(null);
  const live = goals.filter((g) => !g.closed);
  const groups = new Map<string, Material[]>();
  // "|" = not asked yet (sorting asks a few at a time), "-|" = asked, no goal fits.
  for (const m of materials) { const k = m.suggestion?.name ? `${m.suggestion.goalId}|${m.suggestion.name}` : m.suggestion ? "-|" : "|"; groups.set(k, [...(groups.get(k) ?? []), m]); }
  const put = (m: Material, goalId: string) => call(`/api/knowledge/goals/${goalId}/source`, { key: m.key, kind: m.kind, title: m.title, on: true });
  const acceptAll = (list: Material[]) => onAct(async () => { for (const m of list) await call("/api/knowledge/materials/accept", { key: m.key, kind: m.kind, title: m.title }); });
  const row = (m: Material) => <li key={m.key} className="row small"><span className="chip">{SOURCE_LABEL[m.kind] ?? m.kind}</span> {m.title} <span className="muted">· 지식 {m.items}</span>
    {live.length ? <select className="ws-select" value="" aria-label="다른 목표에 넣기" onChange={(e) => { if (e.target.value) void onAct(() => put(m, e.target.value)); }}>
      <option value="">다른 목표에</option>{live.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select> : null}
    <button className="btn ghost small" onClick={() => void onAct(() => call("/api/knowledge/materials/ignore", { key: m.key }))}>목표 없이 두기</button></li>;
  return (
    <section className="panel kw-dupes">
      <button className="linkish" onClick={() => setOpen((x) => !x)}><b>목표를 정할 자료 · {materials.length}</b> <span className="small muted">{open ? "접기" : "보기"}</span></button>
      {open ? <ul className="kw-links">{[...groups.entries()].map(([k, list]) => {
        const [goalId, name] = k.split("|");
        const target = goals.find((g) => g.id === goalId)?.name ?? name;
        return <li key={k} className="stack">
          <span className="row">{name ? <button className="btn small" onClick={() => void acceptAll(list)}>“{target}”{goalId ? "에" : " 목표를 만들어"} 넣기 · 자료 {list.length}</button>
            : <b className="small">{goalId === "-" ? `맞는 목표를 못 찾은 자료 ${list.length}` : `추천을 기다리는 자료 ${list.length}`}</b>}
            <span className="small muted">{list.slice(0, 3).map((m) => m.title).join(", ")}{list.length > 3 ? " …" : ""}</span>
            <button className="btn ghost small" onClick={() => setEach(each === k ? null : k)}>{each === k ? "접기" : "하나씩"}</button></span>
          {each === k ? <ul className="kw-links">{list.map(row)}</ul> : null}
        </li>;
      })}</ul> : null}
    </section>
  );
}
