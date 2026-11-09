"use client";
// 기억 탭 (11/9 사용자 "기억을 따로 빼서 정리하지 말고 자료별로 자료 지도 보는 걸로", "기억 탭도 자료·알고리즘·실습으로 나누고,
// 자료는 자료 지도, 알고리즘과 실습은 나름의 방식으로"): 갈래 셋.
//   자료: 자료(PDF·웹 글) 한 줄씩 → PDF는 자료 지도(목차·구조·기억)를 열고, 웹 글은 글 지도를 펼친다.
//   알고리즘: 문제마다 그 문제에서 생긴 기억(패턴·실수)을 펼쳐 본다.
//   실습: 맨 위 나의 학습 노트(LearnerNote, 11/10 D [경계]), 실습마다 지나온 목표 길(ProjectPath, 11/9 D [경계]) + 그 실습에서 생긴 기억 전체(접힘).
// 폴더로 기억을 정리하던 예전 기억 창(KnowledgeWindow)은 맨 아래 "기억 전체 정리"로 남긴다.
import { useCallback, useEffect, useMemo, useState } from "react";
import { call, errorText, go, later, type ItemLite, type Tree } from "./api";
import KnowledgeWindow, { MaterialArticle, ProjectStages, StateChip, tidyLine, type MaterialRow } from "./KnowledgeWindow";
import LearnerNote from "./LearnerNote";
import ProjectPath from "./ProjectPath";
import { Inline } from "./Rich";

type Tab = "material" | "code" | "project";
const TABS: Array<[Tab, string]> = [["material", "자료"], ["code", "알고리즘"], ["project", "실습"]];
const KEY = "recaller:kt-tab";
const ago = (iso: string) => { const d = Math.round((Date.now() - Date.parse(iso)) / 86_400_000); return d <= 0 ? "오늘" : d === 1 ? "어제" : `${d}일 전`; };

export default function KnowledgeTabs({ onLegacy, focusId }: { onLegacy?: () => void; focusId?: string }) {
  const [tab, setTab] = useState<Tab>(() => { try { const t = localStorage.getItem(KEY); return t === "code" || t === "project" ? t : "material"; } catch { return "material"; } });
  const [rows, setRows] = useState<MaterialRow[] | null>(null);
  const [items, setItems] = useState<ItemLite[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [full, setFull] = useState<string | true | null>(focusId ?? null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [v, t, g] = await Promise.all([call<{ materials: MaterialRow[] }>("/api/knowledge/material-view"), call<Tree>("/api/knowledge"),
        call<{ runs: Array<{ id: string; createdAt: string; status: string; fileName: string; pages: number[]; sectionCount?: number }> }>("/api/lab/gen?origin=study").catch(() => ({ runs: [] }))]);
      // 자료(PDF)는 실제로 만든 자료(study-gen) 기준: 기억 저장소에 기억이 아직 안 들어간 자료도, 보관한 자료는 빼고(11/9 점검).
      const pdfs: MaterialRow[] = g.runs.filter((r) => r.status === "done" || r.status === "cards").map((r) => ({ key: `gen:${r.id}`, group: "material", kind: "pdf",
        title: r.fileName.replace(/\.pdf$/i, ""), items: r.sectionCount ?? 0, itemIds: [], lastAt: r.createdAt, keys: [], folderId: null, genId: r.id, pages: r.pages.length }) as MaterialRow & { pages: number });
      setRows([...pdfs, ...v.materials.filter((r) => !(r.group === "material" && r.kind === "pdf"))]); setItems(t.items);
    } catch (e) { setError(errorText(e)); }
  }, []);
  useEffect(() => later(() => void load()), [load]);
  const pick = (t: Tab) => { setTab(t); setOpen(null); try { localStorage.setItem(KEY, t); } catch { /* storage off */ } };
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const mine = (r: MaterialRow) => r.itemIds.map((id) => byId.get(id)).filter((i): i is ItemLite => Boolean(i));

  if (full) return (
    <div className="stack">
      <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => { setFull(null); void load(); }}>← 기억 탭으로</button>
      <KnowledgeWindow onLegacy={onLegacy} focusId={typeof full === "string" ? full : undefined} />
    </div>
  );
  const list = (rows ?? []).filter((r) => r.group === tab).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  const itemList = (xs: ItemLite[]) => <ul className="kt-items">{xs.map((i) => <li key={i.id}><button className="kt-item" onClick={() => setFull(i.id)} title="이 기억 자세히">
    <StateChip state={i.state} graduated={i.graduated} /><span className="kt-t"><Inline text={i.title} /></span>{i.line ? <span className="kt-line"><Inline text={tidyLine(i.line)} /></span> : null}</button></li>)}</ul>;
  return (
    <div className="stack kt">
      <div className="seg kt-seg" role="tablist" aria-label="기억 갈래">{TABS.map(([t, label]) => {
        const n = (rows ?? []).filter((r) => r.group === t).length;
        return <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => pick(t)}>{label}{rows ? <small> {n}</small> : null}</button>;
      })}</div>
      {error ? <p className="ws-err">{error}</p> : null}
      {tab === "project" ? <LearnerNote /> : null}
      {!rows ? <p className="small muted">불러오는 중…</p> : !list.length ? <p className="small muted panel">{tab === "material" ? "아직 자료가 없어요. 공부 › 자료에서 PDF나 웹 글로 자료를 만들면 여기 생겨요." : tab === "code" ? "아직 알고리즘 기억이 없어요. 문제를 풀면 패턴·실수가 기억으로 쌓여요." : "아직 실습 기억이 없어요."}</p> : (
        <ul className="kt-rows">{list.map((r) => {
          const on = open === r.key;
          const icon = r.kind === "web" ? "🌐" : tab === "material" ? "📄" : tab === "code" ? "⌨" : "🛠";
          // 자료(PDF): 자료 지도를 바로 연다. 그 밖은 펼친다.
          const click = () => { if (tab === "material" && r.genId) window.dispatchEvent(new CustomEvent("recaller:map-open", { detail: { genId: r.genId } })); else setOpen(on ? null : r.key); };
          return <li key={r.key} className={`kt-row${on ? " on" : ""}`}>
            <button className="kt-head" onClick={click} aria-expanded={tab === "material" && r.genId ? undefined : on}>
              <span className="kt-icon" aria-hidden>{icon}</span>
              <span className="kt-name">{r.title}</span>
              <span className="muted small">{r.key.startsWith("gen:") ? `${(r as MaterialRow & { pages?: number }).pages ?? "?"}쪽 · 주제 ${r.items}` : `기억 ${r.items}`} · {ago(r.lastAt)}</span>
              <span className="kt-go" aria-hidden>{tab === "material" && r.genId ? "자료 지도 ↗" : on ? "▴" : "▾"}</span>
            </button>
            {on ? <div className="kt-body">
              {tab === "material" && r.sourceId ? <MaterialArticle id={r.sourceId} onChanged={() => void load()} />
                : tab === "project" ? <>
                  <ProjectPath runs={r.keys.filter((k) => k.startsWith("code:project:")).map((k) => k.slice("code:project:".length)).join(",")} />
                  {r.stages?.length ? <details className="pp-all"><summary className="small muted">이 실습에서 생긴 기억 전체 {r.items}</summary><ProjectStages stages={r.stages} items={items} sel={null} onPick={(id) => setFull(id)} /></details> : null}
                </>
                : itemList(mine(r))}
              {tab === "code" ? <button className="btn ghost small" onClick={() => go("code")}>알고리즘 탭에서 문제 보기</button> : null}
              {tab === "project" ? <button className="btn ghost small" onClick={() => go("project")}>실습 탭 열기</button> : null}
            </div> : null}
          </li>;
        })}</ul>
      )}
      <button className="linkish small" style={{ alignSelf: "flex-start" }} onClick={() => setFull(true)}>기억 전체 정리(폴더) 열기</button>
    </div>
  );
}
