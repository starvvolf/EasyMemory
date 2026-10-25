"use client";
// 에이전트가 띄운 블록: an agent (Claude Code, Codex via the Recaller MCP tools) can put a message, a question, a
// knowledge item, a code problem or a question to the learner ("기한이 있나요?") on the screen. They stack at the
// bottom left; answers go back to the agent through screen_answers.
import { useEffect, useState } from "react";
import { call, go, type Question, type ScreenContext } from "./api";
import { QuestionCard } from "./QuestionCard";
import { Rich } from "./Rich";

type Block = { id: string; at: string; kind: "question" | "problem" | "knowledge" | "message" | "ask"; title: string; body: string; ref: string; choices: string[]; question?: Question; answered: boolean; answer: string };

export default function AgentScreen() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [text, setText] = useState<Record<string, string>>({});
  useEffect(() => {
    let gone = false;
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    const poll = async () => {
      try { const r = await call<{ blocks: Block[] }>(`/api/agent/screen?after=${encodeURIComponent(since)}`); if (!gone) setBlocks(r.blocks.filter((b) => !b.answered)); } catch { /* local only */ }
    };
    void poll();
    const i = setInterval(() => void poll(), 4000);
    return () => { gone = true; clearInterval(i); };
  }, []);
  // What is on screen goes to the agent's current_view tool (at most every 3 seconds).
  useEffect(() => {
    let last = 0, pending: ReturnType<typeof setTimeout> | null = null, latest: ScreenContext | null = null;
    const send = () => { pending = null; last = Date.now(); const c = latest; if (!c) return;
      void call("/api/agent/view", { view: c.view, title: c.title, detail: (c.text ?? "").slice(0, 4000), selection: (c.selection ?? "").slice(0, 2000),
        ids: { ...(c.problemId ? { problemId: c.problemId } : {}), ...(c.refs[0] ? { ref: c.refs[0] } : {}), ...(c.knowledgeIds[0] ? { knowledgeId: c.knowledgeIds[0] } : {}) } }).catch(() => undefined); };
    const on = (e: Event) => { latest = (e as CustomEvent<ScreenContext>).detail; if (!pending) pending = setTimeout(send, Math.max(0, 3000 - (Date.now() - last))); };
    window.addEventListener("recaller:context", on);
    return () => { window.removeEventListener("recaller:context", on); if (pending) clearTimeout(pending); };
  }, []);
  const close = async (id: string) => { setBlocks((b) => b.filter((x) => x.id !== id)); await call(`/api/agent/screen/${id}`, undefined, "DELETE").catch(() => undefined); };
  const answer = async (id: string, value: string) => { setBlocks((b) => b.filter((x) => x.id !== id)); await call(`/api/agent/screen/${id}/answer`, { answer: value }).catch(() => undefined); };
  if (!blocks.length) return null;
  return (
    <div className="ag" aria-live="polite">
      {blocks.slice(-3).map((b) => (
        <section key={b.id} className="ag-card">
          <div className="row" style={{ justifyContent: "space-between" }}><span className="chip ask">에이전트</span><button className="kw-x" aria-label="닫기" onClick={() => void close(b.id)}>×</button></div>
          <b>{b.title}</b>
          {b.body ? <Rich text={b.body} className="small" /> : null}
          {b.kind === "question" && b.question ? <QuestionCard question={b.question} compact onDone={(g) => void answer(b.id, g.correct ? "맞힘" : "틀림")} /> : null}
          {b.kind === "knowledge" && b.ref ? <button className="btn small" onClick={() => { go("knowledge"); setTimeout(() => window.dispatchEvent(new CustomEvent("recaller:knowledge-focus", { detail: { id: b.ref } })), 50); void close(b.id); }}>지식창에서 보기</button> : null}
          {b.kind === "problem" && b.ref ? <button className="btn small" onClick={() => { go("code"); setTimeout(() => window.dispatchEvent(new CustomEvent("recaller:code-open", { detail: { id: b.ref } })), 50); void close(b.id); }}>문제 풀기</button> : null}
          {b.kind === "ask" ? (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); if (text[b.id]?.trim()) void answer(b.id, text[b.id]); }}>
              {b.choices.length ? <div className="row">{b.choices.map((c) => <button type="button" key={c} className="btn small" onClick={() => void answer(b.id, c)}>{c}</button>)}</div> : null}
              <div className="row"><input className="ws-input" value={text[b.id] ?? ""} onChange={(e) => setText({ ...text, [b.id]: e.target.value })} placeholder="답 적기" /><button className="btn primary small">보내기</button></div>
            </form>
          ) : null}
        </section>
      ))}
    </div>
  );
}
