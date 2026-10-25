"use client";
// 크롬 확장 사이드 패널: 칼럼을 읽는 동안 옆에서 — 글에서 지식 잡기(예전에 배운 것은 "다시 만남"으로), 드래그해서 묻기(몰랐음으로
// 저장), 그리고 목표 넷(용어 / 주장 / 고리 / 다른 글에서 알아보기)을 문제로 확인하기. The page in the tab is read by the
// extension (content.js) and passed here with postMessage; this page only talks to its own server.
import { useCallback, useEffect, useRef, useState } from "react";
import "../study/dejipgi.css";
import "../study/workspace/workspace.css";
import { call, errorText, folderPaths, later, type Tree } from "../study/workspace/api";
import { ArticleGoals, ArticleKnowledge, type SourceView } from "../study/workspace/ArticleStudy";
import { Rich } from "../study/workspace/Rich";

type Article = { title: string; url: string; text: string; selection?: string; error?: string };
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
        setError(""); setChanged(false); setArticle({ title: msg.title ?? "", url: msg.url ?? "", text: msg.text ?? "" }); setExplained(null);
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

        {source ? <section className="panel stack"><p className="eyebrow">이 글의 지식</p><ArticleKnowledge source={source} /></section> : null}

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

        {source ? <section className="panel"><ArticleGoals source={source} onChanged={setSource} /></section> : null}
      </div>
    </div>
  );
}
