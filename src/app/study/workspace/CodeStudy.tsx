"use client";
// 코드 학습: 문제 설명 + 코드 편집기 + 실행 결과 + 코드 옆 AI. 예제 실행은 예제만 돌려 모두 보여 주고, 제출은 숨은 테스트까지
// 돌려 처음 틀린 하나만 보여 준다. Whether the code is right is the judge's call; the AI next to the code explains,
// hints in three steps, checks an approach before submitting and looks for a counterexample.
import { useCallback, useEffect, useRef, useState } from "react";
import { call, errorText, later, shareContext } from "./api";
import { CodeEditor, type EditorHandle } from "./CodeEditor";
import { Rich } from "./Rich";

type Lang = "python" | "javascript" | "cpp" | "csharp";
type LangInfo = { lang: Lang; label: string; ready: boolean; version: string; help: string };
type ProblemLite = { id: string; title: string; kind: "full" | "blank"; knowledge: string[]; folder: string; source: string; status: "new" | "tried" | "wrong" | "solved"; tries: number; lastAt: string; createdAt: string };
type TestCase = { input: string; output: string };
type Problem = { id: string; title: string; statement: string; inputText: string; outputText: string; examples: TestCase[]; hiddenTests: number; kind: "full" | "blank"; knowledge: string[]; knowledgeIds: string[];
  folder: string; source: { kind: string; title: string; url?: string }; starters: Record<Lang, string>; hasReference: boolean; timeLimitMs: number };
type Result = { index: number; verdict: string; ms: number; input: string; expected: string; got: string; stderr: string };
type Judged = { verdict: string; passed: number; total: number; shown: Result[]; compile: string; ms: number };
type SubLite = { id: string; at: string; lang: Lang; mode: "example" | "submit"; verdict: string; passed: number; total: number; hints: number; lines: number };
type Msg = { who: "me" | "ai"; text: string; tag?: string };

const VERDICT: Record<string, [string, string]> = { AC: ["맞았습니다", "good"], WA: ["틀렸습니다", "bad"], TLE: ["시간 초과", "help"], RE: ["런타임 에러", "bad"], CE: ["컴파일 에러", "bad"], MISSING: ["실행기 없음", "help"] };
const STATUS: Record<ProblemLite["status"], [string, string]> = { new: ["새 문제", ""], tried: ["풀어 봄", "help"], wrong: ["틀림", "bad"], solved: ["맞음", "good"] };
const storedLang = (): Lang => { try { return (localStorage.getItem("code:lang") as Lang) || "python"; } catch { return "python"; } };

export default function CodeStudy({ openId }: { openId?: string }) {
  const [list, setList] = useState<ProblemLite[]>([]);
  const [langs, setLangs] = useState<LangInfo[]>([]);
  const [current, setCurrent] = useState<string | null>(openId ?? null);
  const [filter, setFilter] = useState<"all" | ProblemLite["status"]>("all");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { const [p, l] = await Promise.all([call<{ problems: ProblemLite[] }>("/api/code/problems"), call<{ langs: LangInfo[] }>("/api/code/langs")]); setList(p.problems); setLangs(l.langs); }
    catch (e) { setError(errorText(e)); }
  }, []);
  useEffect(() => later(() => void load()), [load]);
  useEffect(() => {
    const on = (e: Event) => { const id = (e as CustomEvent<{ id?: string }>).detail?.id; if (id) setCurrent(id); };
    window.addEventListener("recaller:code-open", on);
    return () => window.removeEventListener("recaller:code-open", on);
  }, []);
  if (current) return <Solve key={current} id={current} langs={langs} onBack={() => { setCurrent(null); void load(); }} />;
  const shown = list.filter((p) => filter === "all" || p.status === filter);
  return (
    <div className="cs stack">
      <header className="row" style={{ justifyContent: "space-between" }}>
        <div><h2>코드</h2><p className="small muted">문제를 풀면 결과가 그 문제의 지식 기록에 남아요.</p></div>
        <div className="row small">{langs.map((l) => <span key={l.lang} className={`chip ${l.ready ? "good" : ""}`} title={l.ready ? l.version : l.help}>{l.label} {l.ready ? "✓" : "설치 안 됨"}</span>)}</div>
      </header>
      {error ? <p className="ws-err">{error}</p> : null}
      <MakeProblem langs={langs} onMade={(id) => { void load(); setCurrent(id); }} />
      <section className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <b>문제 {list.length}</b>
          <div className="kw-filters">{([["all", "전체"], ["new", "새 문제"], ["wrong", "틀린 것"], ["solved", "푼 것"]] as const).map(([k, label]) => <button key={k} className="chip-btn" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}{k !== "all" ? ` ${list.filter((p) => p.status === k).length}` : ""}</button>)}</div>
        </div>
        {filter === "wrong" && shown.length ? <p className="small muted">틀린 문제예요. 다시 풀어서 맞히면 목록에서 빠져요.</p> : null}
        <ul className="cs-list">
          {shown.map((p) => (
            <li key={p.id}><button className="cs-row" onClick={() => setCurrent(p.id)}>
              <span className={`chip ${STATUS[p.status][1]}`}>{STATUS[p.status][0]}</span>
              <span className="cs-title">{p.title}</span>
              {p.kind === "blank" ? <span className="chip">빈칸</span> : null}
              <span className="small muted">{p.knowledge.join(" · ")}</span>
              <span className="small muted num">{p.tries ? `제출 ${p.tries}` : ""}</span>
            </button></li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function MakeProblem({ langs, onMade }: { langs: LangInfo[]; onMade: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [lesson, setLesson] = useState("");
  const [blank, setBlank] = useState(false);
  const [lang, setLang] = useState<Lang>(storedLang());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!open) return <div className="row"><button className="btn" onClick={() => setOpen(true)}>+ 문제 만들기 (AI)</button></div>;
  const make = async () => {
    setBusy(true); setError("");
    try {
      const { problem } = await call<{ problem: { id: string } }>("/api/code/make", { ...(topic.trim() ? { topic } : {}), ...(lesson.trim() ? { lesson } : {}), kind: blank ? "blank" : "full", lang });
      setOpen(false); setTopic(""); setLesson(""); onMade(problem.id);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <section className="panel stack">
      <b>문제 만들기</b>
      <p className="small muted">주제만 적거나, 공부한 강의 글(바킹독 블로그 같은)을 붙여 넣어요. 테스트는 AI가 쓴 모범 풀이로 먼저 확인한 것만 남겨요.</p>
      <input className="ws-input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="주제 (예: 이분 탐색으로 경계 찾기)" />
      <textarea className="ws-input" rows={5} value={lesson} onChange={(e) => setLesson(e.target.value)} placeholder="강의 글 붙여 넣기 (선택)" />
      <div className="row">
        <label className="row small"><input type="checkbox" checked={blank} onChange={(e) => setBlank(e.target.checked)} /> 빈칸 코드 문제로</label>
        {blank ? <select className="ws-select" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>{langs.filter((l) => l.ready).map((l) => <option key={l.lang} value={l.lang}>{l.label}</option>)}</select> : null}
        <button className="btn primary small" disabled={busy || !(topic.trim() || lesson.trim())} onClick={() => void make()}>{busy ? "만드는 중… (30초쯤)" : "만들기"}</button>
        <button className="btn ghost small" onClick={() => setOpen(false)}>닫기</button>
      </div>
      {error ? <p className="ws-err">{error}</p> : null}
    </section>
  );
}

function Solve({ id, langs, onBack }: { id: string; langs: LangInfo[]; onBack: () => void }) {
  const [problem, setProblem] = useState<Problem | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<Lang, string>>>({});
  const [subs, setSubs] = useState<SubLite[]>([]);
  const [lang, setLang] = useState<Lang>(storedLang());
  const [code, setCode] = useState("");
  const [result, setResult] = useState<(Judged & { mode: "example" | "submit" }) | null>(null);
  const [custom, setCustom] = useState<{ open: boolean; input: string; out: string }>({ open: false, input: "", out: "" });
  const [running, setRunning] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [hints, setHints] = useState(0);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const editor = useRef<EditorHandle | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    call<{ problem: Problem; drafts: Partial<Record<Lang, string>>; submissions: SubLite[] }>(`/api/code/problem/${id}`).then((r) => {
      setProblem(r.problem); setDrafts(r.drafts); setSubs(r.submissions);
      const l = storedLang();
      setCode(r.drafts[l] ?? r.problem.starters[l]);
      shareContext({ view: "code", title: r.problem.title, refs: [`code:${id}`], knowledgeIds: r.problem.knowledgeIds, problemId: id, text: r.problem.statement });
    }).catch((e) => setError(errorText(e)));
  }, [id]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs]);
  const onCode = useCallback((v: string) => {
    setCode(v);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void call(`/api/code/problem/${id}/draft`, { lang, code: v }).catch(() => undefined); setDrafts((d) => ({ ...d, [lang]: v })); }, 800);
  }, [id, lang]);
  const switchLang = (next: Lang) => {
    void call(`/api/code/problem/${id}/draft`, { lang, code }).catch(() => undefined);
    const d = { ...drafts, [lang]: code };
    setDrafts(d); setLang(next); setCode(d[next] ?? problem!.starters[next]);
    try { localStorage.setItem("code:lang", next); } catch { /* storage off */ }
  };
  // The editor is the source of truth at the moment of a click (state may lag a keystroke behind).
  const now = () => editor.current?.value() ?? code;
  const judge = async (mode: "example" | "submit") => {
    setRunning(mode); setError("");
    try {
      const r = await call<Judged>(`/api/code/problem/${id}/submit`, { lang, code: now(), mode, hints });
      setResult({ ...r, mode });
      if (mode === "submit") {
        setSubs((await call<{ submissions: SubLite[] }>(`/api/code/problem/${id}`)).submissions);
        if (r.verdict === "AC") { setMsgs((m) => [...m, { who: "ai", tag: "채점", text: hints ? `맞았습니다! 힌트 ${hints}번을 받고 풀었어요. 며칠 뒤 힌트 없이 다시 풀어 보면 지식이 '앎'이 돼요.` : "맞았습니다! 힌트 없이 풀어서 이 문제의 지식이 '앎'이 됐어요." }]); setHints(0); }
        window.dispatchEvent(new Event("recaller:knowledge-changed-sidebar"));
      }
    } catch (e) { setError(errorText(e)); } finally { setRunning(""); }
  };
  const runCustom = async () => {
    setRunning("custom");
    try { const r = await call<{ ok: boolean; stdout?: string; stderr?: string; error?: string; timedOut?: boolean; ms?: number }>("/api/code/run", { lang, code: now(), input: custom.input });
      setCustom((c) => ({ ...c, out: r.ok ? `${r.stdout ?? ""}${r.stderr ? `\n[에러]\n${r.stderr}` : ""}${r.timedOut ? "\n[5초 안에 끝나지 않아 멈췄어요]" : ""}` : r.error ?? "" })); }
    catch (e) { setError(errorText(e)); } finally { setRunning(""); }
  };
  const failed = result?.shown.find((s) => s.verdict !== "AC") ?? result?.shown[0];
  const last = result ? (result.compile ? { verdict: result.verdict, compile: result.compile } : failed ? { verdict: failed.verdict, input: failed.input, expected: failed.expected, got: failed.got, stderr: failed.stderr } : { verdict: result.verdict }) : undefined;
  const assist = async (tag: string, me: string, run: () => Promise<{ text?: string; found?: boolean; case?: Result; tried?: number; compile?: string }>) => {
    if (asking) return;
    setAsking(true); setMsgs((m) => [...m, { who: "me", text: me, tag }]);
    try {
      const r = await run();
      const text = r.text ?? (r.found && r.case ? `반례를 찾았어요 (${r.tried}개 입력 중).\n\n입력:\n\`\`\`\n${r.case.input}\n\`\`\`\n기대 출력:\n\`\`\`\n${r.case.expected}\n\`\`\`\n내 출력:\n\`\`\`\n${r.case.got || "(없음)"}\n\`\`\`${r.case.stderr ? `\n에러: ${r.case.stderr.slice(0, 300)}` : ""}`
        : r.compile ? "컴파일이 안 돼서 반례를 돌려 보지 못했어요." : `작은 입력 ${r.tried ?? 0}개로는 틀리는 경우를 못 찾았어요. 큰 입력에서 시간이나 자료형 범위를 확인해 보세요.`);
      setMsgs((m) => [...m, { who: "ai", text, tag }]);
    } catch (e) { setMsgs((m) => [...m, { who: "ai", text: `답을 받지 못했어요: ${errorText(e)}`, tag }]); }
    finally { setAsking(false); }
  };
  const hint = (level: 1 | 2 | 3) => { setHints((h) => h + 1); void assist(`힌트 ${level}`, ["", "방향만 알려 줘", "어느 줄이 문제인지 짚어 줘", "고친 코드를 보여 줘"][level], () => call(`/api/code/problem/${id}/hint`, { lang, code: now(), level, last })); };
  const explainSel = () => {
    const sel = editor.current?.selection() ?? "";
    if (!sel.trim()) { setMsgs((m) => [...m, { who: "ai", text: "편집기에서 설명을 듣고 싶은 부분을 드래그한 다음 눌러 주세요." }]); return; }
    void assist("설명", `이 부분 설명해 줘:\n\`\`\`\n${sel.slice(0, 600)}\n\`\`\``, () => call("/api/code/explain", { problemId: id, lang, code: now(), selection: sel }));
  };
  const ask = () => {
    if (!question.trim()) return;
    const sel = editor.current?.selection() ?? "";
    const q = question; setQuestion("");
    void assist("질문", q, () => call("/api/code/explain", { problemId: id, lang, code: now(), selection: sel.trim() ? sel : now().slice(0, 6000), question: q }));
  };
  const startTimer = async () => { try { await call("/api/schedule/timer/start", { label: problem?.title ?? "코드" }); window.dispatchEvent(new Event("recaller:timer-changed")); } catch (e) { setError(errorText(e)); } };
  const openSubmission = async (sid: string) => {
    try { const { submission } = await call<{ submission: { code: string; lang: Lang } }>(`/api/code/problem/${id}/submission/${sid}`); setLang(submission.lang); setCode(submission.code); } catch (e) { setError(errorText(e)); }
  };

  if (!problem) return <div className="panel small muted">{error || "문제를 여는 중…"} <button className="btn ghost small" onClick={onBack}>목록</button></div>;
  const info = langs.find((l) => l.lang === lang);
  return (
    <div className="cs-solve">
      <section className="cs-statement panel">
        <div className="row" style={{ justifyContent: "space-between" }}><button className="btn ghost small" onClick={onBack}>← 문제 목록</button><button className="btn ghost small" onClick={() => void startTimer()}>⏱ 타이머 켜고 풀기</button></div>
        <div className="row"><span className="chip">{problem.kind === "blank" ? "빈칸" : "코드"}</span><span className="small muted">{problem.folder}</span></div>
        <h2>{problem.title}</h2>
        <Rich text={problem.statement} />
        <p className="eyebrow">입력</p><Rich text={problem.inputText} className="small" />
        <p className="eyebrow">출력</p><Rich text={problem.outputText} className="small" />
        {problem.examples.map((ex, i) => (
          <div key={i} className="cs-example"><p className="eyebrow">예제 {i + 1}</p><div className="cs-io"><pre aria-label="예제 입력">{ex.input}</pre><pre aria-label="예제 출력">{ex.output}</pre></div></div>
        ))}
        <p className="small muted">숨은 테스트 {problem.hiddenTests}개 · 시간 제한 {problem.timeLimitMs / 1000}초</p>
        <div className="row small"><span className="muted">확인하는 지식</span>{problem.knowledge.map((k) => <span key={k} className="chip">{k}</span>)}</div>
        {subs.length ? <><p className="eyebrow">내 제출</p><ul className="cs-subs">{subs.filter((s) => s.mode === "submit").slice(0, 8).map((s) => <li key={s.id}><button className="linkish small" onClick={() => void openSubmission(s.id)}>
          <span className={`chip ${VERDICT[s.verdict]?.[1] ?? ""}`}>{VERDICT[s.verdict]?.[0] ?? s.verdict}</span> {s.lang} · {new Date(s.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}{s.hints ? ` · 힌트 ${s.hints}` : ""}</button></li>)}</ul></> : null}
      </section>

      <section className="cs-work">
        <div className="cs-bar">
          <select className="ws-select" value={lang} onChange={(e) => switchLang(e.target.value as Lang)} aria-label="언어">
            {langs.map((l) => <option key={l.lang} value={l.lang} disabled={!l.ready}>{l.label}{l.ready ? "" : " (설치 안 됨)"}</option>)}
          </select>
          <button className="btn ghost small" onClick={() => { if (problem) onCode(problem.starters[lang]); }} title="처음 코드로 되돌려요">처음 코드</button>
          <span className="cs-gap" />
          <button className="btn small" onClick={() => setCustom((c) => ({ ...c, open: !c.open }))}>직접 입력</button>
          <button className="btn small" disabled={Boolean(running) || !info?.ready} onClick={() => void judge("example")}>{running === "example" ? "도는 중…" : "예제 실행"}</button>
          <button className="btn primary small" disabled={Boolean(running) || !info?.ready} onClick={() => void judge("submit")}>{running === "submit" ? "채점 중…" : "제출"}</button>
        </div>
        {info && !info.ready ? <p className="ws-err">{info.label} 실행기가 없어요. {info.help}</p> : null}
        <CodeEditor value={code} lang={lang} onChange={onCode} handle={(h) => { editor.current = h; }} />
        {custom.open ? (
          <div className="cs-custom"><div><p className="eyebrow">입력</p><textarea className="ws-input mono" rows={4} value={custom.input} onChange={(e) => setCustom((c) => ({ ...c, input: e.target.value }))} /></div>
            <div><p className="eyebrow">출력 <button className="btn small" disabled={Boolean(running)} onClick={() => void runCustom()}>{running === "custom" ? "도는 중…" : "실행"}</button></p><pre className="cs-out">{custom.out}</pre></div></div>
        ) : null}
        {error ? <p className="ws-err">{error}</p> : null}
        {result ? (
          <div className={`cs-result ${VERDICT[result.verdict]?.[1] ?? ""}`}>
            <div className="row"><b>{VERDICT[result.verdict]?.[0] ?? result.verdict}</b><span className="small muted num">{result.mode === "example" ? "예제" : "제출"} · {result.passed}/{result.total} 통과 · {(result.ms / 1000).toFixed(1)}초</span>
              {result.compile || failed?.stderr ? <button className="btn ghost small" disabled={asking} onClick={() => void assist("에러", "이 에러가 무슨 뜻이야?", () => call("/api/code/error", { problemId: id, lang, code: now(), error: result.compile || failed?.stderr || "" }))}>에러 설명</button> : null}</div>
            {result.compile ? <pre className="cs-out">{result.compile}</pre> : null}
            {result.shown.map((r) => (
              <details key={r.index} open={r.verdict !== "AC"} className="cs-case">
                <summary><span className={`chip ${VERDICT[r.verdict]?.[1] ?? ""}`}>{VERDICT[r.verdict]?.[0]}</span> {result.mode === "example" ? `예제 ${r.index + 1}` : "처음 틀린 테스트"} · {r.ms}ms</summary>
                <div className="cs-io three"><div><p className="eyebrow">입력</p><pre>{r.input}</pre></div><div><p className="eyebrow">기대 출력</p><pre>{r.expected}</pre></div><div><p className="eyebrow">내 출력</p><pre>{r.got}</pre></div></div>
                {r.stderr ? <pre className="cs-out bad">{r.stderr}</pre> : null}
              </details>
            ))}
          </div>
        ) : null}
      </section>

      <aside className="cs-ai panel" aria-label="코드 옆 AI">
        <b>AI</b>
        <p className="small muted">통과 여부는 채점기가 정해요. AI는 설명과 힌트만 줘요. 힌트를 받으면 지식 기록에 남아요.</p>
        <div className="cs-hints">
          <button className="btn small" disabled={asking} onClick={() => hint(1)}>힌트 1 · 방향</button>
          <button className="btn small" disabled={asking} onClick={() => hint(2)}>힌트 2 · 줄 짚기</button>
          <button className="btn small" disabled={asking} onClick={() => hint(3)}>힌트 3 · 고친 코드</button>
        </div>
        <div className="cs-hints">
          <button className="btn ghost small" disabled={asking} onClick={() => void assist("확인", "제출 전에 접근이 맞는지 봐 줘", () => call(`/api/code/problem/${id}/review`, { lang, code: now() }))}>맞는지 봐 줘</button>
          <button className="btn ghost small" disabled={asking} onClick={explainSel}>드래그한 부분 설명</button>
          {problem.hasReference ? <button className="btn ghost small" disabled={asking} onClick={() => void assist("반례", "내 코드가 틀리는 입력 찾아 줘", () => call(`/api/code/problem/${id}/counter`, { lang, code: now() }))}>반례 찾기</button> : null}
        </div>
        <div className="cs-chat">
          {!msgs.length ? <p className="small muted">막히면 힌트 1부터 받아 보세요. 편집기에서 코드를 드래그하고 질문하면 그 부분을 설명해요.</p> : null}
          {msgs.map((m, i) => <div key={i} className={`cs-msg ${m.who}`}>{m.tag ? <span className="chip">{m.tag}</span> : null}<Rich text={m.text} className="small" /></div>)}
          {asking ? <div className="cs-msg ai"><span className="small muted">생각하는 중…</span></div> : null}
          <div ref={chatEnd} />
        </div>
        <form className="cs-ask" onSubmit={(e) => { e.preventDefault(); ask(); }}>
          <textarea className="ws-input" rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="질문 (드래그한 코드가 있으면 그 부분에 대해)"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(); } }} />
          <button className="btn primary small" disabled={asking || !question.trim()}>묻기</button>
        </form>
      </aside>
    </div>
  );
}
