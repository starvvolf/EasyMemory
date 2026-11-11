"use client";
// 코드 학습: 문제 설명 + 코드 편집기 + 실행 결과 + 코드 옆 AI. 예제 실행은 예제만 돌려 모두 보여 주고, 제출은 숨은 테스트까지
// 돌려 처음 틀린 하나만 보여 준다. Whether the code is right is the judge's call; the AI next to the code explains,
// hints in three steps, checks an approach before submitting and looks for a counterexample.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { call, errorText, handoff, later, shareContext } from "./api";
import { CodeEditor, type EditorHandle } from "./CodeEditor";
import { Rich } from "./Rich";
import PsTutor from "./PsTutor";
import { LevelBox, LevelChip, NeedsPanel, type Level, type Needs, type SelfLevel } from "./CodeGrade";
import { COACH_ASKS, ModeSwitch, STEP_LABEL, TrainPanel, useLab, useTrain, useWatch, WatchStrip } from "./CodeTrain";

type Lang = "python" | "javascript" | "cpp" | "csharp";
type LangInfo = { lang: Lang; label: string; ready: boolean; version: string; help: string };
type ProblemLite = { id: string; title: string; kind: "full" | "blank"; knowledge: string[]; folder: string; source: string; status: "new" | "tried" | "wrong" | "solved"; tries: number; lastAt: string; createdAt: string; preparing?: boolean;
  level?: { self: SelfLevel; known?: { site: string; rating: string } } };
type TestCase = { input: string; output: string };
type Problem = { id: string; title: string; statement: string; inputText: string; outputText: string; examples: TestCase[]; hiddenTests: number; kind: "full" | "blank"; knowledge: string[]; knowledgeIds: string[];
  folder: string; source: { kind: string; title: string; url?: string }; starters: Record<Lang, string>; hasReference: boolean; timeLimitMs: number; memoryLimitMb?: number;
  examplesFrom?: "source" | "made"; constraints?: string;
  /** 바로 열기: the hidden tests are still being made (or failed) */ preparing?: { since: string; error?: string };
  check?: { by: "source" | "cross"; cases: number; tries: number; human?: "match" | "skipped"; tests?: number; maxTests?: number; compared?: number;
    mutation?: { killed: number; total: number; survived: string[]; added: number };
    second?: { model: string; status: string; agreed: number; total: number; unchecked: number } } };
type Result = { index: number; verdict: string; ms: number; input: string; expected: string; got: string; stderr: string; diff?: string; cpuMs?: number; peakKb?: number; near?: "time" | "memory" };
type Judged = { verdict: string; passed: number; total: number; shown: Result[]; compile: string; ms: number };
type SubLite = { id: string; at: string; lang: Lang; mode: "example" | "submit"; verdict: string; passed: number; total: number; hints: number; lines: number };
type Msg = { who: "me" | "ai"; text: string; tag?: string; step?: string; /** 답이 아직 오는 중(스트리밍, 11/11) */ live?: boolean };

const VERDICT: Record<string, [string, string]> = { AC: ["맞았습니다", "good"], WA: ["틀렸습니다", "bad"], TLE: ["시간 초과", "help"], MLE: ["메모리 초과", "help"], RE: ["런타임 에러", "bad"], CE: ["컴파일 에러", "bad"], MISSING: ["실행기 없음", "help"] };
const STATUS: Record<ProblemLite["status"], [string, string]> = { new: ["새 문제", ""], tried: ["풀어 봄", "help"], wrong: ["틀림", "bad"], solved: ["맞음", "good"] };
const storedLang = (): Lang => { try { return (localStorage.getItem("code:lang") as Lang) || "python"; } catch { return "python"; } };

export default function CodeStudy({ openId }: { openId?: string }) {
  const [list, setList] = useState<ProblemLite[]>([]);
  const [langs, setLangs] = useState<LangInfo[]>([]);
  const [current, setCurrent] = useState<string | null>(() => { const id = openId ?? handoff.codeId ?? null; handoff.codeId = undefined; return id; });
  const [filter, setFilter] = useState<"all" | ProblemLite["status"]>("all");
  const [error, setError] = useState("");
  // PS 튜터(11/8) | 문제 목록: 마지막에 본 쪽을 기억한다.
  const [tab, setTab] = useState<"tutor" | "list">("tutor");
  useEffect(() => later(() => { try { if (localStorage.getItem("code:tab") === "list") setTab("list"); } catch { /* 없음 */ } }), []);
  const pickTab = (t: "tutor" | "list") => { setTab(t); try { localStorage.setItem("code:tab", t); } catch { /* 없음 */ } };
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
  const tabs = <div className="ws-seg" role="tablist" style={{ alignSelf: "flex-start" }}>{([["tutor", "PS 튜터"], ["list", "문제 목록"]] as const).map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => pickTab(k)}>{label}</button>)}</div>;
  if (tab === "tutor") return <div className="cs stack">{tabs}<PsTutor onOpenProblem={(id) => { void load(); setCurrent(id); }} /></div>;
  return (
    <div className="cs stack">
      {tabs}
      <header className="row" style={{ justifyContent: "space-between" }}>
        <div><h2>알고리즘 문제</h2><p className="small muted">직접 짜서 실행하고 채점해요. 기억에는 PS 튜터에서 몰랐다가 배운 것만 남아요.</p></div>
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
              <span className={`chip ${p.preparing ? "help" : STATUS[p.status][1]}`}>{p.preparing ? "준비 중" : STATUS[p.status][0]}</span>
              {p.level ? <LevelChip level={p.level.self} /> : null}
              <span className="cs-title">{p.title}</span>
              {p.kind === "blank" ? <span className="chip">빈칸</span> : null}
              <span className="small muted">{p.level?.known?.site ? `${p.level.known.site} ${p.level.known.rating} · ` : ""}{p.knowledge.join(" · ")}</span>
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
        <button className="btn primary small" disabled={busy || !(topic.trim() || lesson.trim() || from.trim())} onClick={() => void make()}>{busy ? (from.trim() ? "가져오는 중… (백준 문제는 몇 초면 열려요)" : "만드는 중… (30초~1분: 모범 풀이와 숨은 테스트를 확인해요)") : "만들기"}</button>
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
  const [grade, setGrade] = useState<{ level: Level; needs: Needs | null; busy: { self: boolean; known: boolean }; error: string; loaded: boolean }>({ level: {}, needs: null, busy: { self: false, known: false }, error: "", loaded: false });
  const [lang, setLang] = useState<Lang>(storedLang());
  const [code, setCode] = useState("");
  const [result, setResult] = useState<(Judged & { mode: "example" | "submit" }) | null>(null);
  const [custom, setCustom] = useState<{ open: boolean; input: string; out: string }>({ open: false, input: "", out: "" });
  const [running, setRunning] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [hints, setHints] = useState(0);
  // 도움 네 칸(11/11): 작은 도움부터 차례로. 재료(교육용 문제 모델)가 있는 문제에서만 나온다. 연 칸은 서버가 튜터 기록에 남긴다.
  const [help, setHelp] = useState<HelpInfo | null>(null);
  // 뼈대 코드(4칸)는 누르면 편집기에 바로 들어간다(11/11 사용자 "자동으로 덮어 써주면"). 그 전 코드는 [내 코드로 되돌리기]로.
  const [before, setBefore] = useState<string | null>(null);
  useEffect(() => { setHelp(null); setBefore(null); void call<{ help: HelpInfo | null }>(`/api/code/problem/${id}/help`).then((r) => setHelp(r.help)).catch(() => undefined); }, [id]);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const editor = useRef<EditorHandle | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  // 훈련 모드 · 지켜보기: only where the server switched them on (PS 실험 서버, CodeTrain.tsx).
  const lab = useLab();
  const train = useTrain(id, lab.train);
  const training = lab.train && train.state?.mode === "train";
  // 훈련 모드에서 구현 단계 전에는 AI 칸이 코드 힌트 대신 지금 단계를 돕는 코치가 돼요 (답·코드는 주지 않음).
  const [trainStep, setTrainStep] = useState("");
  const coaching = training && ["understand", "model", "approach", "correct", "complexity"].includes(trainStep);
  // 훈련 모드에서는 단계마다 채팅이 따로예요: 다음 단계로 가면 빈 채팅, 앞 단계로 돌아가면 그 단계 대화가 다시 보여요.
  const stepNow = training ? trainStep : "";
  const watch = useWatch({ id, lang, code, enabled: lab.watch && Boolean(problem), examples: problem?.examples ?? [] });

  useEffect(() => {
    call<{ problem: Problem; drafts: Partial<Record<Lang, string>>; submissions: SubLite[]; level: Level | null; needs: Needs }>(`/api/code/problem/${id}`).then((r) => {
      setProblem(r.problem); setDrafts(r.drafts); setSubs(r.submissions); setGrade({ level: r.level ?? {}, needs: r.needs, busy: { self: false, known: false }, error: "", loaded: true });
      const l = storedLang();
      setCode(r.drafts[l] ?? r.problem.starters[l]);
      shareContext({ view: "code", title: r.problem.title, refs: [`code:${id}`], knowledgeIds: r.problem.knowledgeIds, problemId: id, text: r.problem.statement });
    }).catch((e) => setError(errorText(e)));
  }, [id]);
  // 바로 열기: while the hidden tests are made in the background, look again every 2 seconds (the code typed so far stays).
  const preparing = problem?.preparing && !problem.preparing.error ? problem.preparing.since : "";
  useEffect(() => {
    if (!preparing) return;
    const timer = setInterval(() => {
      void call<{ problem: Problem; level: Level | null; needs: Needs }>(`/api/code/problem/${id}`).then((r) => {
        if (r.problem.preparing && !r.problem.preparing.error) return;
        setProblem(r.problem);
        shareContext({ view: "code", title: r.problem.title, refs: [`code:${id}`], knowledgeIds: r.problem.knowledgeIds, problemId: id, text: r.problem.statement });
      }).catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [id, preparing]);
  // 난이도·필요한 능력: 받아 둔 판단이 없으면 한 번 묻는다(AI 1번). 숨은 테스트를 만드는 중이면 끝난 뒤에(모범 풀이를 같이 보려고).
  // 먼저 검색 없는 호출(자체 판단 + AI가 아는 등급, 약 3초). 그 뒤에도 등급이 비었을 때만 웹 검색(약 9초).
  const needSelf = grade.loaded && !grade.level.self && !preparing;
  const needKnown = grade.loaded && Boolean(grade.level.self) && (!grade.level.known || grade.level.known.failed) && !preparing;
  useEffect(() => {
    if (!needSelf) return;
    let alive = true;
    setGrade((g) => ({ ...g, busy: { ...g.busy, self: true }, error: "" }));
    call<{ self: NonNullable<Level["self"]>; known: Level["known"] | null; needs: Needs }>(`/api/code/problem/${id}/level/self`, {})
      .then((r) => { if (alive) setGrade((g) => ({ ...g, level: { ...g.level, self: r.self, ...(r.known ? { known: r.known } : {}) }, needs: r.needs, busy: { ...g.busy, self: false } })); })
      .catch((e) => { if (alive) setGrade((g) => ({ ...g, busy: { ...g.busy, self: false }, error: `수준을 받지 못했어요: ${errorText(e)}` })); });
    return () => { alive = false; };
  }, [id, needSelf]);
  useEffect(() => {
    if (!needKnown) return;
    let alive = true;
    setGrade((g) => ({ ...g, busy: { ...g.busy, known: true } }));
    call<{ known: NonNullable<Level["known"]> }>(`/api/code/problem/${id}/level/known`, {})
      .then((r) => { if (alive) setGrade((g) => ({ ...g, level: { ...g.level, known: r.known }, busy: { ...g.busy, known: false } })); })
      .catch(() => { if (alive) setGrade((g) => ({ ...g, level: { ...g.level, known: { site: "", rating: "", from: "", failed: true } }, busy: { ...g.busy, known: false } })); });
    return () => { alive = false; };
  }, [id, needKnown]);
  const retryPrepare = async () => {
    setError("");
    try { await call(`/api/code/problem/${id}/prepare`, {}); setProblem((p) => p ? { ...p, preparing: { since: new Date().toISOString() } } : p); }
    catch (e) { setError(errorText(e)); }
  };
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
      const r = await call<Judged>(`/api/code/problem/${id}/submit`, { lang, code: now(), mode, hints, ...(watch.advice ? { advice: watch.advice } : {}) });
      setResult({ ...r, mode });
      watch.noteRun(mode, r.verdict);
      if (mode === "submit") {
        setSubs((await call<{ submissions: SubLite[] }>(`/api/code/problem/${id}`)).submissions);
        if (r.verdict === "AC" && (training || watch.advice)) { setMsgs((m) => [...m, { step: stepNow, who: "ai", tag: "채점", text: training ? "맞았습니다! 훈련 모드로 푼 문제는 기록에 '훈련 모드로 통과'로 남아요. 왼쪽 7단계 복기에서 배운 것을 남기고, 며칠 뒤 기본 모드로 혼자 풀면 '앎'이 돼요." : `맞았습니다! 지켜보기 조언을 ${watch.advice}번 받고 풀었어요. 며칠 뒤 혼자 다시 풀면 '앎'이 돼요.` }]); setHints(0); watch.resetAdvice(); }
        else if (r.verdict === "AC") { setMsgs((m) => [...m, { step: stepNow, who: "ai", tag: "채점", text: hints ? `맞았습니다! 힌트 ${hints}번을 받고 풀었어요. 며칠 뒤 힌트 없이 다시 풀어 보면 기억이 '앎'이 돼요.` : "맞았습니다! 힌트 없이 풀어서 이 문제의 기억이 '앎'이 됐어요." }]); setHints(0); }
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
  // What the tutor sees of the last run. A max-size test is megabytes; the server takes 4,000 characters a field.
  const clip = (text?: string) => text && text.length > 3900 ? `${text.slice(0, 3900)}\n… (${(text.length - 3900).toLocaleString()}자 더)` : text;
  const last = result ? (result.compile ? { verdict: result.verdict, compile: clip(result.compile) } : failed ? { verdict: failed.verdict, input: clip(failed.input), expected: clip(failed.expected), got: clip(failed.got), stderr: clip(failed.stderr) } : { verdict: result.verdict }) : undefined;
  const assist = async (tag: string, me: string, run: () => Promise<{ text?: string; found?: boolean; case?: Result; tried?: number; compile?: string }>) => {
    if (asking) return;
    setAsking(true); setMsgs((m) => [...m, { step: stepNow, who: "me", text: me, tag }]);
    try {
      const r = await run();
      const text = r.text ?? (r.found && r.case ? `반례를 찾았어요 (${r.tried}개 입력 중).\n\n입력:\n\`\`\`\n${r.case.input}\n\`\`\`\n기대 출력:\n\`\`\`\n${r.case.expected}\n\`\`\`\n내 출력:\n\`\`\`\n${r.case.got || "(없음)"}\n\`\`\`${r.case.stderr ? `\n에러: ${r.case.stderr.slice(0, 300)}` : ""}`
        : r.compile ? "컴파일이 안 돼서 반례를 돌려 보지 못했어요." : `작은 입력 ${r.tried ?? 0}개로는 틀리는 경우를 못 찾았어요. 큰 입력에서 시간이나 자료형 범위를 확인해 보세요.`);
      setMsgs((m) => [...m, { step: stepNow, who: "ai", text, tag }]);
    } catch (e) { setMsgs((m) => [...m, { step: stepNow, who: "ai", text: `답을 받지 못했어요: ${errorText(e)}`, tag }]); }
    finally { setAsking(false); }
  };
  const hint = (level: 1 | 2 | 3) => { setHints((h) => h + 1); void assist(`힌트 ${level}`, ["", "방향만 알려 줘", "어느 줄이 문제인지 짚어 줘", "고친 코드를 보여 줘"][level], () => call(`/api/code/problem/${id}/hint`, { lang, code: now(), level, last })); };
  // 도움 칸(11/11 사용자 "강의 탭처럼 넘기는 느낌"): 한 장에 한 칸, 위에 게이지, 오른쪽으로 가면 다음 칸. 이미 연 칸은 다시 봐도 기록이 안 늘어난다.
  const [deck, setDeck] = useState<{ at: number; dir: "next" | "prev"; texts: Record<number, string>; busy: boolean; err: string }>({ at: 0, dir: "next", texts: {}, busy: false, err: "" });
  useEffect(() => { setDeck({ at: help?.opened ?? 0, dir: "next", texts: {}, busy: false, err: "" }); }, [id, help === null]); // eslint-disable-line react-hooks/exhaustive-deps -- 문제가 바뀌거나 도움 칸 정보가 처음 올 때만
  const openHelp = async (rung: number) => {
    if (!help || deck.busy || rung < 1 || rung > Math.min(4, help.opened + 1)) return;
    const fresh = rung > help.opened;
    setDeck((d) => ({ ...d, at: rung, dir: rung < d.at ? "prev" : "next", err: "" }));
    if (deck.texts[rung] && !fresh) return;
    setDeck((d) => ({ ...d, busy: true }));
    try {
      const r = await call<{ text: string; skeleton?: string; opened: number }>(`/api/code/problem/${id}/help`, { rung, lang });
      setHelp((h) => (h ? { ...h, opened: r.opened } : h));
      // 뼈대 코드는 처음 열 때만 편집기에 넣는다(다시 보기로는 덮어쓰지 않음). 그 전 코드는 되돌릴 수 있게.
      if (r.skeleton && fresh) { setBefore(now()); onCode(r.skeleton); }
      setDeck((d) => ({ ...d, busy: false, texts: { ...d.texts, [rung]: r.skeleton ? (fresh ? "뼈대 코드를 편집기에 넣었어요. 「여기를 채워요」라고 적힌 줄만 직접 채워서 제출해 보세요." : "편집기에 넣었던 뼈대 코드예요. 「여기를 채워요」 줄만 채우면 돼요.") : r.text } }));
    } catch (e) { setDeck((d) => ({ ...d, busy: false, err: errorText(e) })); }
  };
  // 스트리밍(11/11 사용자 "질문하는 거, 답 오는 거 스트리밍으로, 부드럽지 않으면 부드럽게"): 글이 오는 대로 마지막 AI 말풍선에 붙이고, 화면은 SmoothText가 고르게 풀어 보여 준다.
  const streamAsk = async (q: string, payload: Record<string, unknown>) => {
    if (asking) return;
    setAsking(true);
    setMsgs((m) => [...m, { step: stepNow, who: "me", text: q }, { step: stepNow, who: "ai", text: "", live: true }]);
    const patch = (f: (last: Msg) => Msg) => setMsgs((m) => { const i = m.length - 1; return i >= 0 && m[i].who === "ai" ? [...m.slice(0, i), f(m[i])] : m; });
    try {
      const res = await fetch("/api/code/explain?stream=1", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message || `답을 받지 못했어요 (${res.status})`);
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const o = JSON.parse(line) as { delta?: string; done?: boolean; text?: string; error?: string };
          if (o.delta) patch((l) => ({ ...l, text: l.text + o.delta }));
          if (o.done) patch((l) => ({ ...l, text: o.text ?? l.text, live: false }));
          if (o.error) patch((l) => ({ ...l, text: `${l.text ? `${l.text}\n\n` : ""}답을 다 받지 못했어요: ${o.error}`, live: false }));
        }
      }
      patch((l) => ({ ...l, live: false }));
    } catch (e) { patch((l) => ({ ...l, text: `답을 받지 못했어요: ${errorText(e)}`, live: false })); }
    finally { setAsking(false); }
  };
  const coach = (q: string) => void assist("훈련", q, () => call(`/api/code/problem/${id}/train/ask`, { step: trainStep, question: q }));
  const ask = () => {
    if (!question.trim()) return;
    if (coaching) { const q = question; setQuestion(""); coach(q); return; }
    const sel = editor.current?.selection() ?? "";
    const q = question; setQuestion("");
    setHints((h) => h + 1); // AI에게 물어본 것도 도움 받은 풀이로 남긴다(11/11: 힌트 버튼을 빼고 채팅 하나로)
    void streamAsk(q, { problemId: id, lang, code: now(), selection: sel.trim() ? sel : now().slice(0, 6000), question: q });
  };
  const openSubmission = async (sid: string) => {
    try { const { submission } = await call<{ submission: { code: string; lang: Lang } }>(`/api/code/problem/${id}/submission/${sid}`); setLang(submission.lang); setCode(submission.code); } catch (e) { setError(errorText(e)); }
  };

  if (!problem) return <div className="panel small muted">{error || "문제를 여는 중…"} <button className="btn ghost small" onClick={onBack}>목록</button></div>;
  const info = langs.find((l) => l.lang === lang);
  const shownMsgs = training ? msgs.filter((m) => m.step === trainStep) : msgs;
  return (
    <div className="cs-solve">
      <section className="cs-statement panel">
        <div className="row" style={{ justifyContent: "space-between" }}><button className="btn ghost small" onClick={onBack}>← 문제 목록</button></div>
        {lab.train ? <ModeSwitch mode={training ? "train" : "base"} onMode={(m) => void train.setMode(m)} /> : null}
        <div className="row"><span className="chip">{problem.kind === "blank" ? "빈칸" : "코드"}</span><span className="small muted">{problem.folder}</span></div>
        <h2>{problem.title}</h2>
        <LevelBox source={problem.source} level={grade.level} busy={grade.busy} error={grade.error} />
        {problem.preparing ? (problem.preparing.error
          ? <div className="ws-err small">숨은 테스트를 만들지 못했어요: {problem.preparing.error} <button className="btn small" onClick={() => void retryPrepare()}>다시 시도</button></div>
          : <p className="small muted">숨은 테스트를 만드는 중이에요(보통 15~20초). 그동안 문제를 읽고 코드를 짜고, 예제 실행을 해 볼 수 있어요. 제출은 준비가 끝나면 열려요.</p>) : null}
        <Rich text={problem.statement} />
        <p className="eyebrow">입력</p><Rich text={problem.inputText} className="small" />
        <p className="eyebrow">출력</p><Rich text={problem.outputText} className="small" />
        {problem.examples.map((ex, i) => (
          <div key={i} className="cs-example"><p className="eyebrow">예제 {i + 1}</p><div className="cs-io"><pre aria-label="예제 입력">{ex.input}</pre><pre aria-label="예제 출력">{ex.output}</pre></div></div>
        ))}
        {problem.constraints ? <p className="small muted">제약: {problem.constraints.split("\n").join(" · ")}</p> : null}
        {problem.preparing ? null : <p className="small muted">숨은 테스트 {problem.hiddenTests}개{problem.check?.maxTests ? ` (최대 크기 ${problem.check.maxTests}개)` : ""} · 시간 제한 {problem.timeLimitMs / 1000}초 · 메모리 제한 {problem.memoryLimitMb ?? 256}MB
          {problem.check ? ` · 모범 풀이 확인: ${problem.check.by === "source" ? `원문 예제 ${problem.check.cases}개 일치` : `단순 풀이와 작은 입력 ${problem.check.cases}개 일치`}${problem.check.by === "source" && problem.check.compared ? `, 단순 풀이와 작은 입력 ${problem.check.compared}개 일치` : ""}${problem.check.human === "match" ? " · 사람이 쓴 정답 코드와 일치" : ""}` : ""}
          {problem.check?.mutation?.total ? ` · 흔한 실수 풀이 ${problem.check.mutation.total}개 중 ${problem.check.mutation.killed}개를 테스트가 잡음${problem.check.mutation.survived.length ? ` (못 잡음: ${problem.check.mutation.survived.join(", ")})` : ""}` : ""}
          {problem.check?.second && problem.check.second.status !== "skipped" ? ` · ${problem.check.second.status === "agreed" ? `다른 호출의 독립 풀이(${problem.check.second.model})와 테스트 ${problem.check.second.agreed}/${problem.check.second.total}개 일치` : problem.check.second.status === "second-wrong" ? "독립 풀이가 틀려서 큰 입력 대조는 못 함" : "독립 풀이로 대조하지 못함"}` : ""}</p>}
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
          <button className="btn primary small" disabled={Boolean(running) || !info?.ready || Boolean(problem.preparing)} title={problem.preparing ? "숨은 테스트를 만드는 중이에요" : undefined} onClick={() => void judge("submit")}>{running === "submit" ? "채점 중…" : problem.preparing && !problem.preparing.error ? "테스트 준비 중…" : "제출"}</button>
        </div>
        {info && !info.ready ? <p className="ws-err">{info.label} 실행기가 없어요. {info.help}</p> : null}
        {lab.watch ? <WatchStrip watch={watch} onHint={() => hint(1)} /> : null}
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

      {/* 오른쪽 열: AI 채팅 아래에 필요한 능력 사다리와 다루는 개념(11/9 사용자) */}
      <div className="cs-side">
      <aside className={`cs-ai panel${training ? " training" : ""}`} aria-label="코드 옆 AI">
        {training ? <div className="cs-ai-train"><b>훈련</b><TrainPanel id={id} train={train} onStep={setTrainStep} timeLimitMs={problem.timeLimitMs} lang={lang} code={now} solved={subs.some((s) => s.mode === "submit" && s.verdict === "AC")} /></div> : null}
        {coaching || !help ? <b>AI</b> : null}{coaching ? <span className="small muted"> · 훈련 코치 ({STEP_LABEL[trainStep]} 단계)</span> : null}
        {coaching ? <>
        <p className="small muted">코드를 쓰기 전이라 AI는 답이나 코드를 주지 않고, 지금 단계를 스스로 생각하도록 도와요. 구현 단계부터는 힌트·반례 버튼이 다시 나와요.</p>
        </> : <>
        {help ? <HelpDeck key={id} help={help} deck={deck} onOpen={(r) => void openHelp(r)} before={before} onUndo={() => { if (before !== null) { onCode(before); setBefore(null); } }} needs={<PlaceCard place={help.place} basics={(grade.needs?.steps ?? []).filter((x) => x.step <= 2).flatMap((x) => x.needs.map((n) => n.name))} knowledge={problem.knowledge} />} /> : null}
        </>}
        <div className="cs-chat">
          {!shownMsgs.length ? coaching ? <p className="small muted">막히면 아래 예시 질문을 누르거나, 지금 단계에 대해 직접 물어보세요. 쓴 답을 보고 대답해요.</p> : <p className="small muted">AI에게 무엇이든 물어보세요. 코드를 드래그하고 물으면 그 부분을 봐요. 물어본 풀이는 「도움 받고 맞힘」으로 남아요.</p> : null}
          {shownMsgs.map((m, i) => <div key={i} className={`cs-msg ${m.who}`}>{m.tag ? <span className="chip">{m.tag}</span> : null}{m.who === "ai" && (m.live || i === shownMsgs.length - 1) ? <SmoothText text={m.text} live={Boolean(m.live)} onGrow={() => chatEnd.current?.scrollIntoView({ block: "end" })} /> : <Rich text={m.text} className="small" />}</div>)}
          {asking && shownMsgs.at(-1)?.live !== true ? <div className="cs-msg ai"><span className="small muted">생각하는 중…</span></div> : null}
          <div ref={chatEnd} />
        </div>
        {coaching ? <div className="cs-hints">
          {COACH_ASKS.map((q) => <button key={q} className="btn ghost small" disabled={asking} onClick={() => coach(q)}>{q}</button>)}
        </div> : null}
        <form className="cs-ask" onSubmit={(e) => { e.preventDefault(); ask(); }}>
          <textarea className="ws-input" rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={coaching ? "지금 단계에 대해 질문" : "질문 (드래그한 코드가 있으면 그 부분에 대해)"}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(); } }} />
          <button className="btn primary small" disabled={asking || !question.trim()}>묻기</button>
        </form>
      </aside>
      {/* 도움 칸이 있는 문제는 필요한 능력이 AI 튜터 3번 장으로 들어간다(11/11 사용자). */}
      {!help && (grade.needs || problem.knowledge.length) ? <section className="cs-needs panel" aria-label="이 문제에 필요한 능력">
        {grade.needs ? <NeedsPanel needs={grade.needs} /> : null}
        {problem.knowledge.length ? <div className="row small"><span className="muted">다루는 개념</span>{problem.knowledge.map((k) => <span key={k} className="chip">{k}</span>)}</div> : null}
      </section> : null}
      </div>
    </div>
  );
}

/** 스트리밍 글을 고르게 풀어 보여 준다(11/11): 받은 글보다 늦게, 남은 양에 맞춰 한 번에 몇 글자씩. 다 오면 남은 것을 빨리 따라잡는다. */
function SmoothText({ text, live, onGrow }: { text: string; live: boolean; onGrow?: () => void }) {
  const [shown, setShown] = useState(live ? 0 : text.length);
  const grow = useRef(onGrow);
  useEffect(() => { grow.current = onGrow; });
  useEffect(() => {
    if (shown >= text.length) return;
    const id = requestAnimationFrame(() => {
      const left = text.length - shown;
      setShown((n) => Math.min(text.length, n + Math.max(1, Math.ceil(left / (live ? 18 : 6)))));
      grow.current?.();
    });
    return () => cancelAnimationFrame(id);
  }, [shown, text, live]);
  const behind = shown < text.length;
  if (!text && live) return <span className="small muted">생각하는 중…</span>;
  return <div className="cs-smooth"><Rich text={text.slice(0, shown)} className="small" />{live || behind ? <span className="lc2-caret" /> : null}</div>;
}

// AI 튜터(11/11 사용자): 다섯 장을 강의 탭처럼 넘긴다. 1 눈여겨볼 곳 · 2 방법 이름 · 3 필요한 능력 · 4 계획 · 5 뼈대 코드.
// 필요한 능력은 방법 이름 뒤에 둔다(앞에 두면 방법이 먼저 보인다). 이 장은 화면 안의 것이라 기록하지 않는다. 나머지 장은 서버의 도움 칸 1~4.
type HelpInfo = { opened: number; labels: string[]; place: Array<{ code: string; trackName: string; stepName: string; name: string; optional: boolean; mergedInto?: string; prereqs: Array<{ id: string; name: string; solid: boolean }> }> };
/** AI 튜터 3번 장(11/11 "커리큘럼 하나로"): 능력 사다리 대신 커리큘럼 말로. 이 문제가 있는 곳 · 먼저 알 것 · 기본 문법 · 다루는 개념. */
function PlaceCard({ place, basics, knowledge }: { place: HelpInfo["place"]; basics: string[]; knowledge: string[] }) {
  const pre = [...new Map(place.flatMap((p) => p.prereqs).map((r) => [r.id, r])).values()];
  return (
    <dl className="hd-place">
      <dt>이 문제가 있는 곳</dt>
      <dd>{place.length ? place.map((p) => <span key={p.name} className="hd-path"><span className="chip">{p.code}</span> {p.trackName} › {p.stepName} › <b>{p.mergedInto ?? p.name}</b>{p.optional ? <span className="muted"> (선택)</span> : null}</span>) : <span className="muted">커리큘럼에서 아직 자리를 못 찾았어요</span>}</dd>
      {pre.length ? <><dt>먼저 알 것</dt><dd>{pre.map((r) => <span key={r.id} className={`chip${r.solid ? " good" : ""}`}>{r.solid ? "✓ " : ""}{r.name}</span>)}</dd></> : null}
      {basics.length ? <><dt>기본 문법</dt><dd className="small">{basics.join(" · ")}</dd></> : null}
      {knowledge.length ? <><dt>다루는 개념</dt><dd>{knowledge.map((k) => <span key={k} className="chip">{k}</span>)}</dd></> : null}
    </dl>
  );
}
const CARDS: Array<{ label: string; note: string; rung: 0 | 1 | 2 | 3 | 4 }> = [
  { label: "", note: "", rung: 0 },
  { label: "눈여겨볼 곳", note: "문제에서 무엇을 보면 되는지만", rung: 1 },
  { label: "방법 이름", note: "어떤 방법을 쓰는지까지", rung: 2 },
  { label: "필요한 능력", note: "커리큘럼에서 이 문제가 있는 곳과 먼저 알 것", rung: 0 },
  { label: "계획", note: "무엇을 적어 두고 어떻게 바꾸는지까지", rung: 3 },
  { label: "뼈대 코드", note: "핵심 줄만 비운 코드 (편집기에 바로 들어가요)", rung: 4 },
];
type Deck = { at: number; dir: "next" | "prev"; texts: Record<number, string>; busy: boolean; err: string };
function HelpDeck({ help, deck, onOpen, before, onUndo, needs }: { help: HelpInfo; deck: Deck; onOpen: (rung: number) => void; before: string | null; onUndo: () => void; needs: ReactNode }) {
  const s = help.opened;
  const [needsSeen, setNeedsSeen] = useState(s >= 3);
  const opened = s >= 3 ? s + 1 : s === 2 && needsSeen ? 3 : s; // 연 장 수(0~5)
  const [view, setView] = useState(opened);
  const [dir, setDir] = useState<"next" | "prev">("next");
  const max = Math.min(5, opened + 1);
  const go = (u: number) => {
    if (u < 1 || u > max || deck.busy) return;
    setDir(u < view ? "prev" : "next"); setView(u);
    const c = CARDS[u];
    if (c.rung) onOpen(c.rung); else setNeedsSeen(true);
  };
  const card = CARDS[view];
  return (
    <div className="hd">
      <div className="hd-top">
        <b>AI 튜터</b>
        <button className="hd-hint" disabled={opened >= 5 || deck.busy} onClick={() => go(opened + 1)} title={opened >= 5 ? "힌트를 다 열었어요" : `다음 힌트: ${CARDS[opened + 1].label}`}>힌트</button>
        <span className="hd-nav">
          <button disabled={view <= 1 || deck.busy} onClick={() => go(view - 1)} aria-label="이전 장">‹</button>
          <button disabled={view >= max || deck.busy} onClick={() => go(view + 1)} aria-label="다음 장">›</button>
        </span>
      </div>
      <div className="hd-gauge" role="group" aria-label="힌트 단계">{[1, 2, 3, 4, 5].map((u) => (
        <span key={u} role="button" tabIndex={u <= max ? 0 : -1} aria-disabled={u > max} aria-label={`${u}. ${CARDS[u].label}${u <= opened ? " (열었음)" : ""}`} data-tip={`${u}. ${CARDS[u].label}`}
          className={`hd-seg${u <= opened ? " done" : ""}${u === view ? " on" : ""}${u > max ? " locked" : ""}`} onClick={() => go(u)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(u); } }} />))}</div>
      {view === 0 ? (
        <div className="hd-box hd-empty">
          <p className="small">혼자 먼저 해 보고, 막히면 [힌트]를 눌러 한 장씩 열어요.</p>
          <p className="small muted">연 힌트는 기록에 남고, 힌트 받고 푼 문제는 하루 뒤 혼자 다시 풀어요.</p>
        </div>
      ) : (
        <section key={view} className={`hd-box lc3-in-${dir}`}>
          <header className="hd-head"><span className="lc3-step num">{view}</span><div className="hd-headtext"><b>{card.label}</b><span className="small muted">{card.note}</span></div></header>
          {card.rung === 0 ? (needs ?? <p className="small muted">이 문제는 필요한 능력을 아직 정리하지 못했어요.</p>)
            : deck.busy && !deck.texts[card.rung] ? <p className="small muted">{card.rung === 4 ? "뼈대 코드를 만드는 중… (처음이면 10~30초)" : "여는 중…"}</p>
            : deck.err && deck.at === card.rung ? <p className="small bad">{deck.err}</p>
            : <Rich text={deck.texts[card.rung] ?? ""} className="hd-say" />}
          {card.rung === 4 && before !== null ? <button className="linkish small" onClick={onUndo}>내 코드로 되돌리기</button> : null}
        </section>
      )}
    </div>
  );
}
