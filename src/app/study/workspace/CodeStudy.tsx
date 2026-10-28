"use client";
// 코드 학습: 문제 설명 + 코드 편집기 + 실행 결과 + 코드 옆 AI. 예제 실행은 예제만 돌려 모두 보여 주고, 제출은 숨은 테스트까지
// 돌려 처음 틀린 하나만 보여 준다. Whether the code is right is the judge's call; the AI next to the code explains,
// hints in three steps, checks an approach before submitting and looks for a counterexample.
import { useCallback, useEffect, useRef, useState } from "react";
import { call, errorText, handoff, later, shareContext } from "./api";
import { CodeEditor, type EditorHandle } from "./CodeEditor";
import { Rich } from "./Rich";

type Lang = "python" | "javascript" | "cpp" | "csharp";
type LangInfo = { lang: Lang; label: string; ready: boolean; version: string; help: string };
type ProblemLite = { id: string; title: string; kind: "full" | "blank"; knowledge: string[]; folder: string; source: string; status: "new" | "tried" | "wrong" | "solved"; tries: number; lastAt: string; createdAt: string };
type TestCase = { input: string; output: string };
type Problem = { id: string; title: string; statement: string; inputText: string; outputText: string; examples: TestCase[]; hiddenTests: number; kind: "full" | "blank"; knowledge: string[]; knowledgeIds: string[];
  folder: string; source: { kind: string; title: string; url?: string }; starters: Record<Lang, string>; hasReference: boolean; timeLimitMs: number; memoryLimitMb?: number;
  examplesFrom?: "source" | "made"; constraints?: string;
  check?: { by: "source" | "cross"; cases: number; tries: number; human?: "match" | "skipped"; tests?: number; maxTests?: number; compared?: number;
    mutation?: { killed: number; total: number; survived: string[]; added: number };
    second?: { model: string; status: string; agreed: number; total: number; unchecked: number } } };
type Result = { index: number; verdict: string; ms: number; input: string; expected: string; got: string; stderr: string; diff?: string; cpuMs?: number; peakKb?: number; near?: "time" | "memory" };
type Judged = { verdict: string; passed: number; total: number; shown: Result[]; compile: string; ms: number };
type SubLite = { id: string; at: string; lang: Lang; mode: "example" | "submit"; verdict: string; passed: number; total: number; hints: number; lines: number };
type Msg = { who: "me" | "ai"; text: string; tag?: string };

const VERDICT: Record<string, [string, string]> = { AC: ["맞았습니다", "good"], WA: ["틀렸습니다", "bad"], TLE: ["시간 초과", "help"], MLE: ["메모리 초과", "help"], RE: ["런타임 에러", "bad"], CE: ["컴파일 에러", "bad"], MISSING: ["실행기 없음", "help"] };
const STATUS: Record<ProblemLite["status"], [string, string]> = { new: ["새 문제", ""], tried: ["풀어 봄", "help"], wrong: ["틀림", "bad"], solved: ["맞음", "good"] };
const storedLang = (): Lang => { try { return (localStorage.getItem("code:lang") as Lang) || "python"; } catch { return "python"; } };

export default function CodeStudy({ openId }: { openId?: string }) {
  const [list, setList] = useState<ProblemLite[]>([]);
  const [langs, setLangs] = useState<LangInfo[]>([]);
  const [current, setCurrent] = useState<string | null>(() => { const id = openId ?? handoff.codeId ?? null; handoff.codeId = undefined; return id; });
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
        <div><h2>코드 문제</h2><p className="small muted">직접 짜서 실행하고 채점해요. 결과는 그 문제의 지식 기록에 남아요.</p></div>
        {langs.some((l) => !l.ready) ? <div className="row small">{langs.filter((l) => !l.ready).map((l) => <span key={l.lang} className="chip help" title={l.help}>{l.label} 설치 안 됨</span>)}</div> : null}
      </header>
      <Calibrated />
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

type Cal = { speed: number; at: string; via: string; base: Partial<Record<Lang, { cpuMs: number; peakKb: number }>>; ratios: Record<string, number> };
const LANG_SHORT: Record<Lang, string> = { python: "Python", javascript: "JS", cpp: "C++", csharp: "C#" };
/** 채점 보정: this PC's speed against the reference PC and each language's empty-program cost, taken off every run. */
function Calibrated() {
  const [cal, setCal] = useState<Cal | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const get = useCallback(async (again: boolean) => {
    setBusy(true);
    try { setCal((await call<{ calibration: Cal | null }>("/api/code/calibration", again ? {} : undefined)).calibration); } catch { setCal(null); } finally { setBusy(false); }
  }, []);
  useEffect(() => later(() => void get(false)), [get]);
  if (cal === null && !busy) return null; // this PC can't measure (not Windows): judged by the wall clock
  const speed = cal ? (cal.speed >= 1 ? `기준 PC보다 ${cal.speed.toFixed(2)}배 느림` : `기준 PC보다 ${(1 / cal.speed).toFixed(2)}배 빠름`) : "";
  return (
    <details className="small muted">
      <summary>{busy || !cal ? "채점 보정: 이 PC를 재는 중… (처음 한 번, 10~20초)" : `채점 보정: ${Math.abs(cal.speed - 1) < 0.05 ? "기준 PC와 같은 속도" : speed}`}</summary>
      {cal ? <p>시간은 이 PC 속도로 나눠 기준 PC 기준으로 재고, 언어마다 빈 프로그램이 쓰는 양을 빼요: {(Object.keys(LANG_SHORT) as Lang[]).filter((l) => cal.base[l]).map((l) => `${LANG_SHORT[l]} ${(cal.base[l]!.peakKb / 1024).toFixed(1)}MB·${cal.base[l]!.cpuMs}ms`).join(", ")}.
        {" "}벤치마크({cal.via === "cpp" ? "C++" : "JS"}) 계산 {cal.ratios.arith?.toFixed(2)} · 메모리 읽기 {cal.ratios.memory?.toFixed(2)} · 정렬 {cal.ratios.sort?.toFixed(2)}배. {new Date(cal.at).toLocaleDateString("ko-KR")}에 잼.
        {" "}<button className="btn ghost small" disabled={busy} onClick={() => void get(true)}>{busy ? "재는 중…" : "다시 재기"}</button></p> : null}
    </details>
  );
}

function MakeProblem({ langs, onMade }: { langs: LangInfo[]; onMade: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [from, setFrom] = useState("");
  const [lesson, setLesson] = useState("");
  const [blank, setBlank] = useState(false);
  const [lang, setLang] = useState<Lang>(storedLang());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** A problem made before from the same address: open it, or make a new one anyway. */
  const [existing, setExisting] = useState<{ id: string; title: string; createdAt: string; count: number } | null>(null);
  if (!open) return <div className="row"><button className="btn" onClick={() => setOpen(true)}>+ 문제 만들기 (AI)</button></div>;
  const done = (id: string) => { setOpen(false); setTopic(""); setFrom(""); setLesson(""); setExisting(null); onMade(id); };
  const make = async (again = false) => {
    setBusy(true); setError(""); setExisting(null);
    try {
      const made = await call<{ problem?: { id: string }; existing?: { id: string; title: string; createdAt: string; count: number } }>("/api/code/make", { ...(topic.trim() ? { topic } : {}), ...(from.trim() ? { from: from.trim() } : {}), ...(lesson.trim() ? { lesson } : {}), kind: blank ? "blank" : "full", lang, ...(again ? { again: true } : {}) });
      if (made.existing) setExisting(made.existing); else if (made.problem) done(made.problem.id);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <section className="panel stack">
      <b>문제 만들기</b>
      <p className="small muted">주제만 적거나, 문제·풀이 블로그 주소나 백준 번호를 넣거나, 강의 글이나 문제 글을 붙여 넣어요. 모범 풀이가 원문 예제(없으면 단순 풀이)와 맞아야 저장해요.</p>
      <input className="ws-input" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="주소나 백준 번호 (예: https://…/123, 7785)" />
      <input className="ws-input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="주제 (예: 이분 탐색으로 경계 찾기)" />
      <textarea className="ws-input" rows={5} value={lesson} onChange={(e) => setLesson(e.target.value)} placeholder="강의 글이나 문제 글 붙여 넣기 (선택)" />
      <div className="row">
        <label className="row small"><input type="checkbox" checked={blank} onChange={(e) => setBlank(e.target.checked)} /> 빈칸 코드 문제로</label>
        {blank ? <select className="ws-select" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>{langs.filter((l) => l.ready).map((l) => <option key={l.lang} value={l.lang}>{l.label}</option>)}</select> : null}
        <button className="btn primary small" disabled={busy || !(topic.trim() || lesson.trim() || from.trim())} onClick={() => void make()}>{busy ? (from.trim() ? "글을 가져와 만드는 중… (2~5분쯤)" : "만드는 중… (2~5분쯤: 모범 풀이와 숨은 테스트를 확인해요)") : "만들기"}</button>
        <button className="btn ghost small" onClick={() => setOpen(false)}>닫기</button>
      </div>
      {existing ? (
        <div className="row small">
          <span>이 주소로 만든 문제가 이미 있어요: <b>{existing.title}</b> ({existing.createdAt.slice(5, 10).replace("-", "/")}{existing.count > 1 ? ` 외 ${existing.count - 1}개` : ""})</span>
          <button className="btn primary small" onClick={() => done(existing.id)}>열기</button>
          <button className="btn ghost small" disabled={busy} onClick={() => void make(true)}>새로 만들기</button>
        </div>
      ) : null}
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
  // Leaving the problem ends this attempt: its 틀림 · 힌트 · 물어봄 go into the knowledge record (src/lib/code/service.ts).
  useEffect(() => () => { void call(`/api/code/problem/${id}/end`, {}).catch(() => undefined); }, [id]);
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
        {problem.constraints ? <p className="small muted">제약: {problem.constraints.split("\n").join(" · ")}</p> : null}
        <p className="small muted">숨은 테스트 {problem.hiddenTests}개{problem.check?.maxTests ? ` (최대 크기 ${problem.check.maxTests}개)` : ""} · 시간 제한 {problem.timeLimitMs / 1000}초 · 메모리 제한 {problem.memoryLimitMb ?? 256}MB
          {problem.check ? ` · 모범 풀이 확인: ${problem.check.by === "source" ? `원문 예제 ${problem.check.cases}개 일치` : `단순 풀이와 작은 입력 ${problem.check.cases}개 일치`}${problem.check.by === "source" && problem.check.compared ? `, 단순 풀이와 작은 입력 ${problem.check.compared}개 일치` : ""}${problem.check.human === "match" ? " · 사람이 쓴 정답 코드와 일치" : ""}` : ""}
          {problem.check?.mutation?.total ? ` · 흔한 실수 풀이 ${problem.check.mutation.total}개 중 ${problem.check.mutation.killed}개를 테스트가 잡음${problem.check.mutation.survived.length ? ` (못 잡음: ${problem.check.mutation.survived.join(", ")})` : ""}` : ""}
          {problem.check?.second && problem.check.second.status !== "skipped" ? ` · ${problem.check.second.status === "agreed" ? `다른 호출의 독립 풀이(${problem.check.second.model})와 테스트 ${problem.check.second.agreed}/${problem.check.second.total}개 일치` : problem.check.second.status === "second-wrong" ? "독립 풀이가 틀려서 큰 입력 대조는 못 함" : "독립 풀이로 대조하지 못함"}` : ""}</p>
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
                <summary><span className={`chip ${VERDICT[r.verdict]?.[1] ?? ""}`}>{VERDICT[r.verdict]?.[0]}</span> {result.mode === "example" ? `예제 ${r.index + 1}` : "처음 틀린 테스트"} · {r.cpuMs !== undefined ? `CPU ${r.cpuMs}ms · 메모리 ${(r.peakKb! / 1024).toFixed(1)}MB` : `${r.ms}ms`}</summary>
                {r.near ? <p className="muted small">{r.near === "time" ? "시간 제한을 조금 넘었지만 이 PC와 채점 서버의 차이로 보고 봐줬어요. 실제 저지에서는 시간 초과일 수 있어요." : "메모리 제한을 조금 넘었지만 봐줬어요. 실제 저지에서는 메모리 초과일 수 있어요."}</p> : null}
                <div className="cs-io three"><div><p className="eyebrow">입력</p><pre>{r.input}</pre></div><div><p className="eyebrow">기대 출력</p><pre>{r.expected}</pre></div><div><p className="eyebrow">내 출력</p><pre>{r.got}</pre></div></div>
                {r.diff ? <p className="muted small">{r.diff}</p> : null}
                {r.stderr ? <pre className="cs-out bad">{r.stderr}</pre> : null}
              </details>
            ))}
          </div>
        ) : null}
      </section>

      <aside className="cs-ai panel" aria-label="코드 옆 AI">
        <b>AI</b>
        <p className="small muted">통과 여부는 채점기가 정해요. AI는 설명과 힌트만 줘요. 힌트·틀린 제출은 이번 풀이에 모아 두었다가, 맞히거나 문제를 나가면 지식 기록에 남아요.</p>
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
