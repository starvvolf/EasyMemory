"use client";
// 지식창: everything the learner has met, did not know and knows, across all materials, kept like files in folders.
// Left: folders (drag items or folders onto a folder to move them). Middle: the folder's items. Right: one item —
// its meaning, names, chains, where it came from and its record — with 확인 문제, 합치기 and the state buttons.
import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { call, errorText, folderPaths, handoff, later, STATE_LABEL, EVENT_LABEL, whenText, type Detail, type Folder, type ItemLite, type KState, type Question, type ReviewStatus, type Tree } from "./api";
import { QuestionRun } from "./QuestionCard";
import { Inline, Rich } from "./Rich";

type Filter = "all" | KState | "graduated";
const FILTERS: Array<[Filter, string]> = [["all", "전체"], ["unknown", "몰랐음"], ["known", "앎"], ["met", "만남"], ["graduated", "졸업"]];
const stateClass: Record<KState, string> = { met: "met", unknown: "bad", known: "good" };
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

  const load = useCallback(async () => { try { setTree(await call<Tree>("/api/knowledge")); } catch (e) { setError(errorText(e)); } }, []);
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
    let list = hits ?? tree.items.filter((i) => folder === "all" ? true : folder === "none" ? !i.folderId : Boolean(i.folderId && subtree(folder).has(i.folderId)));
    if (filter === "graduated") list = list.filter((i) => i.graduated); else if (filter !== "all") list = list.filter((i) => i.state === filter && !i.graduated);
    if (!hits) list = [...list].sort((a, b) => sort === "weak" ? b.weak - a.weak || b.lastAt.localeCompare(a.lastAt) : sort === "name" ? a.title.localeCompare(b.title, "ko") : b.lastAt.localeCompare(a.lastAt));
    return list;
  }, [hits, tree.items, folder, filter, sort, subtree]);

  const dueNow = tree.items.filter((i) => !i.graduated && i.state !== "met" && (!i.dueAt || Date.parse(i.dueAt) <= Date.now())).length;
  const counts = { total: tree.items.length, unknown: tree.items.filter((i) => i.state === "unknown").length, known: tree.items.filter((i) => i.state === "known").length, met: tree.items.filter((i) => i.state === "met").length };
  const folderName = folder === "all" ? "전체" : folder === "none" ? "폴더 없음" : folderPaths(tree.folders).find((f) => f.id === folder)?.path ?? "";

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
    const q = folder !== "all" && folder !== "none" ? `?folderId=${folder}&count=10` : "?count=10";
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
          <p className="small muted num">전체 {counts.total} · 몰랐음 {counts.unknown} · 앎 {counts.known} · 만남 {counts.met}{dueNow ? <> · <b>복습 차례 {dueNow}</b></> : null}</p>
        </div>
        <div className="row">
          <input className="ws-input kw-search" type="search" placeholder="지식 찾기 (이름·설명)" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="지식 찾기" />
          <button className="btn small" onClick={() => { setMaking("item"); setDraft(""); }}>+ 지식</button>
          <button className="btn small" onClick={() => { setMaking("folder"); setDraft(""); }}>+ 폴더</button>
          <button className="btn primary small" onClick={startQuiz}>복습하기</button>
          <details className="ws-menu">
            <summary aria-label="지식 더보기">⋯</summary>
            <div className="ws-menu-card">
              <button className="mm-item" onClick={async (e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; if (!showOverview) { try { setOverview((await call<{ text: string }>("/api/knowledge/memory?level=1")).text); } catch (err) { setError(errorText(err)); } } setShowOverview(!showOverview); }}>
                <span>{showOverview ? "AI가 보는 요약 닫기" : "AI가 보는 요약"}</span><small>메모리 1단계: AI가 매번 보는 내 공부의 큰 그림</small></button>
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
      {error ? <p className="ws-err" onClick={() => setError("")}>{error}</p> : null}
      {notice ? <p className="small muted" onClick={() => setNotice("")}>{notice}</p> : null}
      {showOverview ? <section className="panel"><div className="row" style={{ justifyContent: "space-between" }}><b className="small">AI가 보는 요약 (메모리 1단계)</b><button className="btn ghost small" onClick={() => setShowOverview(false)}>닫기</button></div><pre className="kw-overview">{overview}</pre></section> : null}
      {run ? <QuestionRun title={run.title} questions={run.questions} onClose={() => { setRun(null); void load(); if (sel) void loadDetail(sel); }} /> : null}

      <div className="kw-grid">
        <nav className="kw-tree panel" aria-label="폴더">
          <div className={`kw-folder root${folder === "all" ? " on" : ""}`} {...dropZone(null)}><button className="kw-fname" onClick={() => { setFolder("all"); setQuery(""); }}>전체</button><span className="kw-count num">{counts.total}</span></div>
          <ul>{(children.get(null) ?? []).map((f) => <FolderRow key={f.id} f={f} depth={0} />)}</ul>
          <div className={`kw-folder root${folder === "none" ? " on" : ""}`} {...dropZone(null)}><button className="kw-fname" onClick={() => { setFolder("none"); setQuery(""); }}>폴더 없음</button><span className="kw-count num">{tree.items.filter((i) => !i.folderId).length}</span></div>
          {folder !== "all" && folder !== "none" && tree.folders.some((f) => f.id === folder) ? <details className="ws-fold kw-ftools-fold"><summary>폴더 설정</summary><FolderTools key={folder} folder={tree.folders.find((f) => f.id === folder)!} onAct={act} onGone={() => setFolder("all")} /></details> : null}
          <p className="small muted kw-tip">지식이나 폴더를 끌어다 폴더에 놓으면 옮겨져요.</p>
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
                  <span className="kw-item-top"><StateChip state={i.state} graduated={i.graduated} /><span className="kw-title"><Inline text={i.title} /></span>{i.links ? <span className="small muted" title="이어진 지식">↔ {i.links}</span> : null}</span>
                  {i.line ? <span className="kw-line"><Inline text={i.line} /></span> : null}
                  <span className="kw-meta small muted">{hits && i.folderId ? `${folderPaths(tree.folders).find((f) => f.id === i.folderId)?.path ?? ""} · ` : ""}{ago(i.lastAt)}{i.weak ? ` · 막힘 ${i.weak}` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="kw-detail panel" aria-label="지식 자세히">
          {detail ? <ItemDetail key={detail.item.id} detail={detail} folders={tree.folders} onAct={act} onOpen={setSel} onGone={() => setSel(null)}
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

function ItemDetail({ detail, folders, onAct, onOpen, onGone, onQuiz }: { detail: Detail; folders: Folder[]; onAct: (run: () => Promise<unknown>, after?: () => void) => Promise<void>; onOpen: (id: string) => void; onGone: () => void; onQuiz: (q: Question[]) => void }) {
  const { item } = detail;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [alias, setAlias] = useState("");
  const [linkQuery, setLinkQuery] = useState("");
  const [linkHits, setLinkHits] = useState<ItemLite[]>([]);
  const [relation, setRelation] = useState("그러면");
  const [mode, setMode] = useState<"" | "link" | "merge" | "delete">("");
  useEffect(() => {
    return later(() => { if (!linkQuery.trim()) { setLinkHits([]); return; } call<{ hits: ItemLite[] }>(`/api/knowledge/search?q=${encodeURIComponent(linkQuery)}&limit=8`).then((r) => setLinkHits(r.hits.filter((h) => h.id !== item.id))).catch(() => setLinkHits([])); }, linkQuery.trim() ? 160 : 0);
  }, [linkQuery, item.id]);
  const save = () => onAct(() => call(`/api/knowledge/item/${item.id}`, { title, body }, "PATCH"), () => setEditing(false));
  const setState = (patch: { state?: KState; graduated?: boolean }) => onAct(() => call(`/api/knowledge/item/${item.id}/state`, patch));
  const quiz = async () => { const { questions } = await call<{ questions: Question[] }>(`/api/knowledge/item/${item.id}/questions`); onQuiz(questions); };
  const s = item.stats;
  return (
    <div className="kw-d stack">
      <p className="small muted">{detail.path || "폴더 없음"}</p>
      {editing ? <input className="ws-input kw-d-title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="지식 이름" /> : <h3 className="kw-d-title" onDoubleClick={() => setEditing(true)}><Inline text={item.title} /></h3>}
      <div className="ws-seg" role="radiogroup" aria-label="상태">
        {(["met", "unknown", "known"] as KState[]).map((st) => <button key={st} role="radio" aria-checked={item.state === st && !item.graduated} className={item.state === st && !item.graduated ? "on" : ""} onClick={() => setState({ state: st })}>{STATE_LABEL[st]}</button>)}
        <button role="radio" aria-checked={item.graduated} className={item.graduated ? "on" : ""} onClick={() => setState({ graduated: !item.graduated })} title="복습에서 빼요. 기록은 남아요.">졸업</button>
      </div>
      {editing ? (
        <><textarea className="ws-input" rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="뜻, 핵심, 헷갈리는 점 (- 로 목록, **굵게**)" />
          <div className="row"><button className="btn primary small" onClick={save}>저장</button><button className="btn ghost small" onClick={() => { setEditing(false); setTitle(item.title); setBody(item.body); }}>취소</button></div></>
      ) : (
        <div className="kw-body" onDoubleClick={() => setEditing(true)}>{item.body.trim() ? <Rich text={item.body} /> : <p className="muted small">설명이 아직 없어요.</p>}<button className="btn ghost small" onClick={() => setEditing(true)}>편집</button></div>
      )}
      <div className="row">
        <button className="btn primary small" onClick={() => void quiz()}>확인 문제</button>
        <select className="ws-select" value={item.folderId ?? ""} onChange={(e) => void onAct(() => call(`/api/knowledge/item/${item.id}`, { folderId: e.target.value || null }, "PATCH"))} aria-label="폴더 옮기기">
          <option value="">폴더 없음</option>{folderPaths(folders).map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}
        </select>
      </div>

      <div><p className="eyebrow">다른 이름</p>
        <div className="row">{item.aliases.map((a) => <span key={a} className="chip">{a}<button className="kw-x" aria-label={`${a} 지우기`} onClick={() => void onAct(() => call(`/api/knowledge/item/${item.id}`, { aliases: item.aliases.filter((x) => x !== a) }, "PATCH"))}>×</button></span>)}
          <form onSubmit={(e) => { e.preventDefault(); if (alias.trim()) void onAct(() => call(`/api/knowledge/item/${item.id}`, { aliases: [...item.aliases, alias.trim()] }, "PATCH"), () => setAlias("")); }}>
            <input className="ws-input kw-alias" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="+ 다른 이름" /></form></div></div>

      <div><p className="eyebrow">이어진 지식</p>
        {!detail.links.length && !detail.backlinks.length ? <p className="small muted">아직 이어진 지식이 없어요.</p> : null}
        <ul className="kw-links">
          {detail.backlinks.map((l) => <li key={`b${l.item.id}`}><button className="linkish" onClick={() => onOpen(l.item.id)}>{l.item.title}</button> <span className="muted">—{l.relation}→</span> <b>이것</b></li>)}
          {detail.links.map((l) => <li key={`f${l.item.id}`}><b>이것</b> <span className="muted">—{l.relation}→</span> <button className="linkish" onClick={() => onOpen(l.item.id)}>{l.item.title}</button>
            <button className="kw-x" aria-label="고리 지우기" onClick={() => void onAct(() => call("/api/knowledge/link", { from: item.id, to: l.item.id }, "DELETE"))}>×</button></li>)}
        </ul>
        {mode === "link" || mode === "merge" ? (
          <div className="kw-pick">
            <div className="row">{mode === "link" ? <input className="ws-input kw-rel" value={relation} onChange={(e) => setRelation(e.target.value)} aria-label="관계" /> : null}
              <input className="ws-input" autoFocus value={linkQuery} onChange={(e) => setLinkQuery(e.target.value)} placeholder={mode === "link" ? "이을 지식 찾기" : "이것과 같은 지식 찾기"} />
              <button className="btn ghost small" onClick={() => { setMode(""); setLinkQuery(""); }}>취소</button></div>
            <ul>{linkHits.map((h) => <li key={h.id}><button className="kw-hit" onClick={() => void onAct(() => mode === "link" ? call("/api/knowledge/link", { from: item.id, to: h.id, relation }) : call("/api/knowledge/merge", { keep: item.id, drop: h.id }), () => { setMode(""); setLinkQuery(""); })}>
              <StateChip state={h.state} /> {h.title} <span className="small muted">{h.line.slice(0, 50)}</span></button></li>)}</ul>
            {mode === "merge" ? <p className="small muted">고른 지식의 이름, 출처, 고리, 기록이 이 지식으로 합쳐져요.</p> : null}
          </div>
        ) : <div className="row"><button className="btn ghost small" onClick={() => setMode("link")}>+ 고리 잇기</button><button className="btn ghost small" onClick={() => setMode("merge")}>같은 지식 합치기</button></div>}
      </div>

      <details className="ws-fold"><summary>어디서 만났나 · {item.sources.length}</summary>
        <ul className="kw-sources">{item.sources.slice().reverse().slice(0, 12).map((src, i) => <li key={i} className="small"><span className="chip">{{ pdf: "PDF", web: "웹 글", code: "코드", chat: "대화", manual: "직접" }[src.kind] ?? src.kind}</span>{" "}
          {src.url ? <a href={src.url} target="_blank" rel="noreferrer">{src.title}</a> : src.title}{src.page ? ` p.${src.page}` : ""}{src.quote ? <span className="muted"> · “{src.quote.slice(0, 80)}”</span> : null}</li>)}</ul></details>

      <details className="ws-fold" open={s.wrong + s.hint + s.asked > 0}><summary>내 기록 · 맞힘 {s.correct} · 틀림 {s.wrong} · 힌트 {s.hint} · 물어봄 {s.asked}</summary>
        <p className="small muted num">맞힘 {s.correct} · 틀림 {s.wrong} · 힌트 {s.hint} · 물어봄 {s.asked}{s.correctDays.length ? ` · 연속으로 맞힌 날 ${s.correctDays.length}/3` : ""}</p>
        {item.review && !item.graduated && item.state !== "met" ? <p className="small muted">다음 복습: {whenText(item.review.dueAt)}</p> : null}
        <ol className="kw-events">{detail.events.slice(0, 20).map((e) => <li key={e.id}><span className={`chip ev-${e.kind}`}>{EVENT_LABEL[e.kind]}</span> <span className="small">{e.detail}</span> <span className="small muted">{e.source ? `${e.source.title} · ` : ""}{ago(e.at)}</span></li>)}</ol></details>

      {mode === "delete" ? <div className="row small"><span>이 지식과 기록을 모두 지울까요?</span><button className="btn small danger" onClick={() => void onAct(() => call(`/api/knowledge/item/${item.id}`, undefined, "DELETE"), onGone)}>지우기</button><button className="btn ghost small" onClick={() => setMode("")}>취소</button></div>
        : <button className="btn ghost small kw-del" onClick={() => setMode("delete")}>지식 지우기</button>}
    </div>
  );
}
