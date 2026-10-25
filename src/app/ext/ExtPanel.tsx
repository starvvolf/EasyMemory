"use client";
// 크롬 확장 사이드 패널: 칼럼을 읽는 동안 옆에서 — 글에서 지식 잡기(예전에 배운 것은 "다시 만남"으로), 드래그해서 묻기(몰랐음으로
// 저장), 그리고 목표 넷(용어 / 주장 / 고리 / 다른 글에서 알아보기)을 문제로 확인하기. The page in the tab is read by the
// extension (content.js) and passed here with postMessage; this page only talks to its own server.
import { useCallback, useEffect, useRef, useState } from "react";
import "../study/dejipgi.css";
import "../study/workspace/workspace.css";
import { call, errorText, folderPaths, later, type Question, type Tree } from "../study/workspace/api";
import { QuestionRun } from "../study/workspace/QuestionCard";
import { StateChip } from "../study/workspace/KnowledgeWindow";
import { Rich } from "../study/workspace/Rich";

type Article = { title: string; url: string; text: string; selection?: string; error?: string };
type GoalId = "terms" | "claim" | "chains" | "recognize";
type SourceView = {
  id: string; title: string; url: string; claim: { text: string; basis: string[] }; chains: Array<{ from: string; relation: string; to: string }>;
  againIds: string[]; knowledgeIds: string[]; goals: Record<GoalId, { done: boolean; note?: string }>; goalText: Record<GoalId, string>;
  items: Array<{ id: string; title: string; state: "met" | "unknown" | "known"; graduated: boolean; again: boolean; quote: string }>;
};
type Explained = { answer: string; otherView: string; knowledge: { id: string; title: string; created: boolean } | null };
const fromExtension = (e: MessageEvent) => e.source === window.parent && /^chrome-extension:\/\//.test(e.origin);

export default function ExtPanel() {
  const [article, setArticle] = useState<Article | null>(null);
  const [source, setSource] = useState<SourceView | null>(null);
  const [tree, setTree] = useState<Tree>({ folders: [], items: [] });
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [selection, setSelection] = useState("");
  const [question, setQuestion] = useState("");
  const [explained, setExplained] = useState<Explained | null>(null);
  const [run, setRun] = useState<{ title: string; questions: Question[] } | null>(null);
  const [claim, setClaim] = useState("");
  const [claimResult, setClaimResult] = useState<{ verdict: string; feedback: string; claim: { text: string } } | null>(null);
  const [changed, setChanged] = useState(false);
  const parentOrigin = useRef("*");

  const askArticle = useCallback(() => { window.parent.postMessage({ type: "recaller:need-article" }, parentOrigin.current); }, []);
  const openSourceFor = useCallback(async (url: string) => {
    try {
      const { sources } = await call<{ sources: Array<{ id: string; url: string }> }>("/api/knowledge/sources");
      const hit = sources.find((s) => s.url && s.url === url);
      setSource(hit ? (await call<{ source: SourceView }>(`/api/knowledge/source/${hit.id}`)).source : null);
    } catch { setSource(null); }
  }, []);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (!fromExtension(e)) return;
      parentOrigin.current = e.origin;
      const msg = e.data as { type?: string } & Partial<Article> & { ask?: boolean };
      if (msg.type === "recaller:article") {
        if (msg.error) { setError(msg.error); return; }
        setError(""); setChanged(false); setArticle({ title: msg.title ?? "", url: msg.url ?? "", text: msg.text ?? "" }); setExplained(null); setClaimResult(null);
        void openSourceFor(msg.url ?? "");
      }
      if (msg.type === "recaller:selection" && msg.text) { setSelection(msg.text); setExplained(null); }
      if (msg.type === "recaller:tab-changed") setChanged(true);
    };
    window.addEventListener("message", on);
    const first = later(() => { window.parent.postMessage({ type: "recaller:need-article" }, "*"); call<Tree>("/api/knowledge").then(setTree).catch(() => undefined); }, 50);
    return () => { window.removeEventListener("message", on); first(); };
  }, [openSourceFor]);

  const extract = async () => {
    if (!article) return;
    setBusy("extract"); setError("");
    try {
      const r = await call<{ source: SourceView }>("/api/knowledge/extract", { kind: "web", title: article.title || "웹 글", url: article.url, text: article.text, ...(folder ? { folder } : {}) });
      setSource(r.source); setTree(await call<Tree>("/api/knowledge"));
    } catch (e) { setError(errorText(e)); } finally { setBusy(""); }
  };
  const explain = async () => {
    if (!selection.trim()) return;
    setBusy("explain"); setError("");
    try { setExplained(await call<Explained>("/api/knowledge/explain", { title: article?.title || "웹 글", url: article?.url, text: article?.text ?? "", selection, ...(question.trim() ? { question } : {}), ...(folder ? { folder } : {}) })); setQuestion(""); }
    catch (e) { setError(errorText(e)); } finally { setBusy(""); }
  };
  const refresh = async () => { if (source) setSource((await call<{ source: SourceView }>(`/api/knowledge/source/${source.id}`)).source); };
  const quiz = async (goal: GoalId) => {
    if (!source) return;
    setError("");
    try {
      if (goal === "recognize") { const { questions } = await call<{ questions: Question[] }>(`/api/knowledge/source/${source.id}/recognize`); setRun({ title: "다른 글에서 알아보기", questions }); return; }
      const chainTitles = new Set(source.chains.flatMap((c) => [c.from, c.to]));
      const pick = source.items.filter((i) => goal === "chains" ? chainTitles.has(i.title) : !chainTitles.has(i.title) || source.items.every((x) => chainTitles.has(x.title)));
      const questions: Question[] = [];
      for (const item of pick.slice(0, 10)) {
        const qs = (await call<{ questions: Question[] }>(`/api/knowledge/item/${item.id}/questions`)).questions;
        const want = goal === "chains" ? qs.find((q) => q.kind === "blank") : qs.find((q) => q.kind === "choice") ?? qs[0];
        if (want) questions.push(want);
      }
      setRun({ title: goal === "chains" ? "고리 빈칸" : "용어 확인", questions });
    } catch (e) { setError(errorText(e)); }
  };
  const checkClaim = async () => {
    if (!source || !claim.trim()) return;
    setBusy("claim");
    try { setClaimResult(await call("/api/knowledge/claim", { sourceId: source.id, answer: claim })); await refresh(); } catch (e) { setError(errorText(e)); } finally { setBusy(""); }
  };

  const again = source?.items.filter((i) => i.again) ?? [];
  const fresh = source?.items.filter((i) => !i.again) ?? [];
  return (
    <div className="dejipgi ext" data-view="ext">
      <div className="ext-wrap stack">
        <header className="row" style={{ justifyContent: "space-between" }}><b>Recaller</b>
          <a className="small" href="/study" target="_blank" rel="noreferrer">앱 열기</a></header>
        {error ? <p className="ws-err" onClick={() => setError("")}>{error}</p> : null}
        {changed ? <div className="row small"><span className="muted">다른 탭이나 새 글이 열렸어요.</span><button className="btn small" onClick={askArticle}>이 글 읽기</button></div> : null}

        <section className="panel stack">
          <p className="eyebrow">읽는 글</p>
          {article ? <><b>{article.title || "(제목 없음)"}</b><p className="small muted num">{article.text.length.toLocaleString()}자 · {article.url.replace(/^https?:\/\//, "").slice(0, 60)}</p></> : <p className="small muted">글을 읽는 중… 안 되면 아래 버튼을 눌러 주세요.</p>}
          <div className="row">
            <button className="btn ghost small" onClick={askArticle}>다시 읽기</button>
            <select className="ws-select" value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="넣을 폴더">
              <option value="">폴더: 알아서</option>{folderPaths(tree.folders).map((f) => <option key={f.id} value={f.path.replace(/ \/ /g, "/")}>{f.path}</option>)}
            </select>
            <button className="btn primary small" disabled={!article?.text || busy === "extract"} onClick={() => void extract()}>{busy === "extract" ? "지식 잡는 중…" : source ? "지식 다시 잡기" : "지식 잡기"}</button>
          </div>
        </section>

        {source ? (
          <section className="panel stack">
            <p className="eyebrow">이 글의 지식</p>
            {again.length ? <div className="ext-again"><b className="small">예전에 배운 것 {again.length}</b>
              <ul className="sb-list">{again.map((i) => <li key={i.id} className="sb-item"><StateChip state={i.state} graduated={i.graduated} /><span>{i.title}</span></li>)}</ul></div> : null}
            <b className="small">새로 만난 것 {fresh.length}</b>
            <ul className="sb-list">{fresh.map((i) => <li key={i.id} className="sb-item"><StateChip state={i.state} graduated={i.graduated} /><span>{i.title}</span></li>)}</ul>
            {source.chains.length ? <><b className="small">고리</b><ul className="kw-links small">{source.chains.map((c, k) => <li key={k}>{c.from} <span className="muted">—{c.relation}→</span> {c.to}</li>)}</ul></> : null}
          </section>
        ) : null}

        <section className="panel stack">
          <p className="eyebrow">드래그해서 묻기</p>
          {selection ? <blockquote className="ws-q-context">{selection.slice(0, 400)}</blockquote> : <p className="small muted">글에서 모르는 말이나 문장을 드래그하면 여기로 와요.</p>}
          {selection ? <form className="stack" onSubmit={(e) => { e.preventDefault(); void explain(); }}>
            <input className="ws-input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="질문 (비워 두면 뜻을 설명해요)" />
            <button className="btn primary small" disabled={busy === "explain"}>{busy === "explain" ? "생각하는 중…" : "설명 듣기"}</button></form> : null}
          {explained ? <div className="sb-answer"><Rich text={explained.answer} className="small" />
            {explained.otherView ? <p className="small"><b>다르게 보면:</b> {explained.otherView}</p> : null}
            {explained.knowledge ? <p className="small muted">“{explained.knowledge.title}”을(를) 몰랐음으로 {explained.knowledge.created ? "저장" : "표시"}했어요. 나중에 확인 문제로 나와요.</p> : null}</div> : null}
        </section>

        {source ? (
          <section className="panel stack">
            <p className="eyebrow">잘 읽었는지 확인</p>
            {(["terms", "claim", "chains", "recognize"] as GoalId[]).map((g) => (
              <div key={g} className="ext-goal">
                <span className={`chip ${source.goals[g].done ? "good" : ""}`}>{source.goals[g].done ? "✓ 달성" : "아직"}</span>
                <span className="ext-goal-text">{source.goalText[g]}</span>
                {g === "claim" ? null : g === "recognize" && !source.againIds.length ? <span className="small muted">예전에 배운 지식이 나오면 열려요</span>
                  : <button className="btn small" onClick={() => void quiz(g)}>풀기</button>}
              </div>
            ))}
            <form className="stack" onSubmit={(e) => { e.preventDefault(); void checkClaim(); }}>
              <label className="small muted" htmlFor="claim">글을 덮고, 이 글의 주장을 한 줄로 써 보세요.</label>
              <textarea id="claim" className="ws-input" rows={2} value={claim} onChange={(e) => setClaim(e.target.value)} />
              <button className="btn small" disabled={!claim.trim() || busy === "claim"}>{busy === "claim" ? "확인 중…" : "주장 확인"}</button>
            </form>
            {claimResult ? <div className={`ws-q-result ${claimResult.verdict === "맞음" ? "good" : "bad"}`}><b>{claimResult.verdict}</b> · {claimResult.feedback}
              <div className="small muted">글의 주장: {claimResult.claim.text}</div></div> : null}
            {run ? <QuestionRun title={run.title} questions={run.questions} sourceId={source.id} onClose={() => { setRun(null); void refresh(); }} /> : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
