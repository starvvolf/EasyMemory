"use client";
// 새 공부 시작: "무엇을 공부할까요?" → 자료 종류 (PDF·강의 자료 / 웹 글 / 코드) → 만들기 → "시험이나 기한이 있나요?" → 공부하러 가기.
// PDF goes to the existing material builder (자료 넣기); 웹 글 and 코드 are made here.
import { useEffect, useState } from "react";
import { call, errorText, folderPaths, go, handoff, later, type Tree } from "./api";
import type { SourceView } from "./ArticleStudy";

type Kind = "pdf" | "web" | "code";
type Made = { kind: "web"; id: string; title: string; folderId: string | null; count: number; again: number } | { kind: "code"; id: string; title: string; folderId: string | null };
const KINDS: Array<{ kind: Kind; title: string; text: string; eg: string }> = [
  { kind: "pdf", title: "PDF · 강의 자료", text: "외울 것을 뽑아 문제로 만들고, 시험일까지 복습을 잡아요.", eg: "전공 PPT, 암기 과목, 교재 PDF" },
  { kind: "web", title: "웹 글 · 칼럼", text: "글에서 알아야 할 지식과 고리를 잡고, 다음 글에서 다시 만나면 알려 줘요.", eg: "주식 칼럼, 기술 블로그, 뉴스 해설" },
  { kind: "code", title: "코드 · 알고리즘", text: "배운 개념으로 문제를 만들고, 직접 짜서 실행·채점해요.", eg: "바킹독 강의, 백준 대비, 언어 문법" },
];

export default function NewStudy() {
  const [kind, setKind] = useState<Kind | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  useEffect(() => later(() => { if (handoff.start) { setKind(handoff.start); handoff.start = undefined; } }), []);
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<{ view?: string; kind?: Kind }>).detail; if (d?.view === "start") { setKind(d.kind ?? null); setMade(null); } };
    window.addEventListener("recaller:go", on);
    return () => window.removeEventListener("recaller:go", on);
  }, []);
  if (made) return <Deadline made={made} onAgain={() => { setMade(null); setKind(null); }} />;
  return (
    <div className="stack ws-narrow">
      <header><h2 className="ws-title">무엇을 공부할까요?</h2><p className="muted">자료를 넣으면 알아야 할 지식을 뽑고, 문제로 확인하고, 잊을 때쯤 다시 물어봐요.</p></header>
      <div className="ns-kinds">
        {KINDS.map((k) => (
          <button key={k.kind} className={`ns-kind${kind === k.kind ? " on" : ""}`} onClick={() => { if (k.kind === "pdf") go("create"); else setKind(k.kind); }}>
            <b>{k.title}</b><span>{k.text}</span><small>{k.eg}</small>
          </button>
        ))}
      </div>
      {kind === "web" ? <WebForm onMade={setMade} /> : kind === "code" ? <CodeForm onMade={setMade} /> : null}
    </div>
  );
}

async function folderIdOf(path: string) {
  const tree = await call<Tree>("/api/knowledge");
  return folderPaths(tree.folders).find((f) => f.path.replace(/ \/ /g, "/") === path)?.id ?? null;
}

function WebForm({ onMade }: { onMade: (m: Made) => void }) {
  const [v, setV] = useState({ title: "", url: "", text: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const make = async () => {
    setBusy(true); setError("");
    try {
      const r = await call<{ source: SourceView }>("/api/knowledge/extract", { kind: "web", title: v.title.trim() || v.text.trim().split("\n")[0].slice(0, 80) || "웹 글", ...(v.url.trim() ? { url: v.url.trim() } : {}), text: v.text });
      const first = r.source.items[0];
      const folderId = first ? (await call<{ item: { folderId: string | null } }>(`/api/knowledge/item/${first.id}`)).item.folderId : null;
      onMade({ kind: "web", id: r.source.id, title: r.source.title, folderId, count: r.source.items.length, again: r.source.againIds.length });
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <section className="panel stack">
      <p className="small muted">웹에서 읽는 중이라면 크롬 확장(Recaller 사이드바)을 켜면 더 편해요. 여기서는 글을 붙여 넣어 시작해요.</p>
      <input className="ws-input" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="제목 (비워 두면 첫 줄)" />
      <input className="ws-input" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} placeholder="주소 (선택)" />
      <textarea className="ws-input" rows={8} value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} placeholder="글 본문을 붙여 넣어요" />
      <div className="row"><button className="btn primary" disabled={busy || v.text.trim().length < 80} onClick={() => void make()}>{busy ? "지식 잡는 중… (30초쯤)" : "지식 잡기"}</button>
        {v.text.trim() && v.text.trim().length < 80 ? <span className="small muted">본문이 조금 더 필요해요.</span> : null}</div>
      {error ? <p className="ws-err">{error}</p> : null}
    </section>
  );
}

function CodeForm({ onMade }: { onMade: (m: Made) => void }) {
  const [topic, setTopic] = useState("");
  const [lesson, setLesson] = useState("");
  const [blank, setBlank] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const make = async () => {
    setBusy(true); setError("");
    try {
      const { problem } = await call<{ problem: { id: string; title: string; folder: string } }>("/api/code/make", { ...(topic.trim() ? { topic } : {}), ...(lesson.trim() ? { lesson } : {}), kind: blank ? "blank" : "full", lang: "python" });
      onMade({ kind: "code", id: problem.id, title: problem.title, folderId: await folderIdOf(problem.folder) });
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <section className="panel stack">
      <input className="ws-input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="무엇을 연습할까요? (예: 이분 탐색으로 경계 찾기)" />
      <textarea className="ws-input" rows={6} value={lesson} onChange={(e) => setLesson(e.target.value)} placeholder="공부한 강의 글을 붙여 넣으면 그 내용으로 만들어요 (선택)" />
      <label className="row small"><input type="checkbox" checked={blank} onChange={(e) => setBlank(e.target.checked)} /> 빈칸 코드 문제로 (Python)</label>
      <div className="row"><button className="btn primary" disabled={busy || !(topic.trim() || lesson.trim())} onClick={() => void make()}>{busy ? "문제 만드는 중… (30초쯤)" : "문제 만들기"}</button>
        <button className="btn ghost small" onClick={() => go("code")}>있는 문제 풀기</button></div>
      <p className="small muted">테스트는 AI가 쓴 모범 풀이로 먼저 확인한 것만 남겨요.</p>
      {error ? <p className="ws-err">{error}</p> : null}
    </section>
  );
}

function Deadline({ made, onAgain }: { made: Made; onAgain: () => void }) {
  const [step, setStep] = useState<"ask" | "date" | "none" | "done">("ask");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const open = () => made.kind === "web" ? go("web", { id: made.id }) : go("code", { id: made.id });
  const plan = async () => {
    try {
      const r = await call<{ schedule?: { todos: unknown[] } }>("/api/schedule/deadlines", { title: made.title.slice(0, 80), date, folderId: made.folderId, ...(made.folderId ? {} : { amount: 1, unit: "번" }), plan: true });
      setNote(`${date}까지 할 일 ${r.schedule?.todos.length ?? 0}개를 일정에 넣었어요.`); setStep("done");
    } catch (e) { setError(errorText(e)); }
  };
  return (
    <div className="stack ws-narrow">
      <section className="panel stack">
        <p className="eyebrow">만들었어요</p>
        <h2 className="ws-title">{made.title}</h2>
        {made.kind === "web" ? <p className="muted">지식 {made.count}개를 잡았어요{made.again ? ` · 그중 ${made.again}개는 예전에 배운 것이에요` : ""}.</p> : <p className="muted">문제를 만들고 테스트를 확인했어요.</p>}
      </section>
      <section className="panel stack">
        {step === "ask" ? <><b>시험이나 기한이 있나요?</b><div className="row"><button className="btn primary small" onClick={() => setStep("date")}>있어요</button><button className="btn small" onClick={() => setStep("none")}>없어요</button></div></> : null}
        {step === "date" ? <form className="row" onSubmit={(e) => { e.preventDefault(); if (date) void plan(); }}><span>언제까지인가요?</span><input className="ws-input pl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /><button className="btn primary small" disabled={!date}>날짜별로 나누기</button></form> : null}
        {step === "none" ? <p className="small">기한 없이 복습 간격대로 다시 물어볼게요.</p> : null}
        {step === "done" ? <p className="small">{note}</p> : null}
        {error ? <p className="ws-err">{error}</p> : null}
        {step !== "ask" && step !== "date" ? <div className="row"><button className="btn primary" onClick={open}>{made.kind === "web" ? "확인 문제 풀러 가기" : "문제 풀러 가기"}</button><button className="btn ghost small" onClick={onAgain}>다른 공부 시작</button></div> : null}
      </section>
    </div>
  );
}
