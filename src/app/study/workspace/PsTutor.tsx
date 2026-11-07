"use client";
// PS 튜터 (2026-11-08, src/lib/code/tutor/): "다음 할 일" 카드 하나와 "내 PS 패턴" 표. 사용자는 늘 보기·판단하기·설계하기·
// 구현하기 중 하나만 하고, 정답 대조·기록·다음 할 일은 서버의 코드가 정한다. 화면에는 답이 오지 않는다(제출 뒤 피드백으로만).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { call, errorText, later } from "./api";
import { Rich } from "./Rich";

type Ab = "recognize" | "design" | "execute";
type PatternRow = { id: string; name: string; what: string; seen: boolean; solid: boolean; graduated: boolean;
  abilities: Record<Ab, { help: 0 | 1 | 2 | 3; freshWins: number; accuracy: number | null; dueAt: string | null; due: boolean; failStreak: number; n: number }> };
type Base = { id: string; kind: "walkthrough" | "contrast" | "drill" | "design" | "implement"; number: string; pattern: string; mixed: boolean; minutes: number; why: string;
  title: string; url: string; chapter: string | null; patternName: string | null; summary: string; statement: string; inputText: string; outputText: string;
  example: { input: string; output: string } | null; maxN: number | null };
type ActionView = Base & {
  walkthrough?: { observe: string; choose: string; compare: string; verify: string }; signals?: string[]; pitfalls?: string[]; patternNames?: string[];
  predict?: { question: string; input: string } | null; options?: string[]; states?: string[]; complexities?: string[];
  other?: { number: string; title: string; summary: string } | null; patternChoices?: Array<{ id: string; name: string }>;
};
type Overview = { targets: number; ready: number; prep: { running: boolean; total: number; done: number; failed: Array<{ number: string; why: string }> };
  pending: Array<{ number: string }>; patterns: PatternRow[]; actions: ActionView[]; done: number };

const HELP = ["시범", "따라 하기", "힌트", "실전"] as const;
const AB_LABEL: Record<Ab, string> = { recognize: "인식", design: "설계", execute: "실행" };
const KIND_LABEL: Record<Base["kind"], string> = { walkthrough: "보기", contrast: "비교하기", drill: "판단하기", design: "설계하기", implement: "구현하기" };
const VERDICT: Record<string, [string, string]> = { best: ["의도된 풀이", "good"], ok: ["가능하지만 덜 좋음", "help"], slow: ["맞지만 느림", "help"], wrong: ["틀림", "bad"] };

export default function PsTutor({ onOpenProblem }: { onOpenProblem: (id: string) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => { try { setData(await call<Overview>("/api/code/tutor")); setError(""); } catch (e) { setError(errorText(e)); } }, []);
  useEffect(() => later(() => void load()), [load]);
  const running = data?.prep.running;
  useEffect(() => { if (!running) return; const t = setInterval(() => void load(), 3000); return () => clearInterval(t); }, [running, load]);
  // 실패한 것이 있으면(인터넷 아카이브가 막음) 다시 할 때는 하나씩.
  const prepare = async () => { try { await call("/api/code/tutor/prepare", data?.prep.failed.length ? { workers: 1 } : {}); await load(); } catch (e) { setError(errorText(e)); } };

  if (!data) return <section className="panel small muted">{error || "PS 튜터를 여는 중…"}</section>;
  const action = data.actions[0];
  return (
    <div className="stack pt">
      <header className="stack" style={{ gap: 4 }}>
        <h2>PS 튜터</h2>
        <p className="small muted">문제를 오래 붙잡기보다, 고수가 문제를 볼 때의 판단(관찰 → 선택 → 비교 → 검증)을 짧게 여러 번 연습해요. 답을 맞히면 다음 칸으로, 틀리면 필요한 곳만 다시 보여 줘요.</p>
      </header>
      {error ? <p className="ws-err">{error}</p> : null}
      {data.ready < data.targets ? (
        <section className="panel stack pt-prep">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="small"><b>교육용 문제 모델</b> {data.ready}/{data.targets}개 준비됨 <span className="muted">(바킹독 배열~정렬 단원의 연습·기본 문제)</span></span>
            {running ? <span className="small muted">만드는 중 {data.prep.done}/{data.prep.total}…</span>
              : <button className="btn small" onClick={() => void prepare()}>남은 {data.targets - data.ready}개 만들기</button>}
          </div>
          <p className="small muted">문제마다 AI 1번(terra, 약 7원). 원문과 바킹독 풀이를 읽고 시범·드릴 재료를 쓰고, 코드가 검사해요. 한 번 만들면 다시 부르지 않아요.{data.prep.failed.length ? ` 실패 ${data.prep.failed.length}개: ${data.prep.failed.slice(0, 3).map((f) => `${f.number}(${f.why})`).join(", ")}` : ""}</p>
        </section>
      ) : null}
      {action ? <ActionCard key={action.id + data.done} a={action} onDone={() => void load()} onOpenProblem={onOpenProblem} pending={data.pending.some((p) => p.number === action.number)} />
        : data.ready ? <section className="panel small muted">지금 할 일이 없어요. 복습 날짜가 되면 다시 나와요.</section> : null}
      {data.actions.length > 1 ? (
        <section className="stack" style={{ gap: 4 }}>
          <p className="eyebrow">그다음</p>
          <ul className="pt-next">{data.actions.slice(1).map((a) => <li key={a.id} className="small"><span className="chip">{KIND_LABEL[a.kind]}</span> {a.mixed ? "단원 숨김 문제" : `BOJ ${a.number} ${a.title}`} <span className="muted">· {a.why} · 약 {a.minutes}분</span></li>)}</ul>
        </section>
      ) : null}
      <PatternTable rows={data.patterns} />
    </div>
  );
}

function PatternTable({ rows }: { rows: PatternRow[] }) {
  if (!rows.length) return null;
  return (
    <section className="panel stack">
      <div className="row" style={{ justifyContent: "space-between" }}><b>내 PS 패턴</b><span className="small muted">칸마다 지금 도움 수준 · 혼자 맞힌 새 문제 수</span></div>
      <div className="pt-table" role="table">
        <div className="pt-tr pt-th" role="row"><span role="columnheader">패턴</span>{(["recognize", "design", "execute"] as const).map((ab) => <span key={ab} role="columnheader">{AB_LABEL[ab]}</span>)}</div>
        {rows.map((r) => (
          <div key={r.id} className={`pt-tr${r.seen ? "" : " dim"}`} role="row">
            <span role="cell" title={r.what}>{r.name}{r.graduated ? <i className="pt-tag good">졸업</i> : r.solid ? <i className="pt-tag">단단함</i> : null}</span>
            {(["recognize", "design", "execute"] as const).map((ab) => { const a = r.abilities[ab]; const due = a.due;
              return <span key={ab} role="cell" className="pt-cell"><span className={`pt-help h${a.help}`}>{HELP[a.help]}</span>{a.n ? <span className="muted"> {a.freshWins}</span> : null}{due ? <i className="pt-tag help">복습</i> : null}{a.failStreak >= 2 ? <i className="pt-tag bad">막힘</i> : null}</span>; })}
          </div>
        ))}
      </div>
    </section>
  );
}

function Problem({ a, full }: { a: ActionView; full?: boolean }) {
  return (
    <div className="stack pt-problem">
      <div className="row small" style={{ gap: 6 }}>
        <span className="chip">{KIND_LABEL[a.kind]}</span>
        <b>{a.mixed ? "단원을 숨긴 문제" : `BOJ ${a.number} ${a.title}`}</b>
        {!a.mixed && a.patternName ? <span className="muted">· {a.patternName}</span> : null}
        <span className="muted">· 약 {a.minutes}분</span>
      </div>
      <p className="small muted">{a.why}</p>
      <p>{a.summary}</p>
      <details open={full}>
        <summary className="small">원문 보기{a.mixed ? "" : ` (BOJ ${a.number})`}</summary>
        <div className="stack small" style={{ gap: 6 }}>
          <Rich text={a.statement} /><p className="eyebrow">입력</p><Rich text={a.inputText} /><p className="eyebrow">출력</p><Rich text={a.outputText} />
          {a.example ? <div className="cs-io"><pre aria-label="예제 입력">{a.example.input}</pre><pre aria-label="예제 출력">{a.example.output}</pre></div> : null}
        </div>
      </details>
    </div>
  );
}

function useElapsed() { const t0 = useRef(0); useEffect(() => { t0.current = Date.now(); }, []); return () => Date.now() - t0.current; }

function ActionCard({ a, onDone, onOpenProblem, pending }: { a: ActionView; onDone: () => void; onOpenProblem: (id: string) => void; pending: boolean }) {
  const elapsed = useElapsed();
  const [fb, setFb] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  const send = async (body: Record<string, unknown>) => {
    setBusy("보내는 중…"); setErr("");
    try { const r = await call<Record<string, unknown>>("/api/code/tutor/answer", { number: a.number, pattern: a.pattern, ...body }); setFb(r); return r; }
    catch (e) { setErr(errorText(e)); return null; } finally { setBusy(""); }
  };
  const next = <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn" onClick={onDone}>다음 할 일 →</button></div>;

  if (a.kind === "walkthrough" && a.walkthrough) return <Walkthrough a={a} send={send} onDone={onDone} />;

  if (a.kind === "drill") {
    return <DrillCard a={a} elapsed={elapsed} send={send} fb={fb} busy={busy} err={err} next={next} />;
  }
  if (a.kind === "design") return <DesignCard a={a} elapsed={elapsed} send={send} fb={fb} busy={busy} err={err} next={next} />;
  if (a.kind === "contrast") return <ContrastCard a={a} send={send} fb={fb} busy={busy} err={err} next={next} />;
  // implement
  const open = async () => {
    setBusy("문제를 준비하는 중… (처음이면 숨은 테스트를 만드느라 15~50초, AI 4번)"); setErr("");
    try {
      const r = await call<{ problemId: string }>("/api/code/tutor/answer", { kind: "implement", number: a.number, pattern: a.pattern, mixed: a.mixed, action: "start" });
      await call(`/api/code/bakingdog/${a.number}/fill`, {}); // 이미 만들어진 문제면 그대로 돌아온다
      onOpenProblem(r.problemId);
    } catch (e) { setErr(errorText(e)); } finally { setBusy(""); }
  };
  const giveUp = async () => { await send({ kind: "implement", mixed: a.mixed, action: "giveup" }); onDone(); };
  return (
    <section className="panel stack pt-card">
      <Problem a={a} />
      <p className="small">이번에는 혼자 끝까지 구현해요. 문제 화면의 힌트를 쓰면 「도움 받고 맞힘」으로 남아요. 맞히고 이 탭으로 돌아오면 저절로 기록돼요.</p>
      {err ? <p className="ws-err small">{err}</p> : null}
      <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
        {pending ? <button className="btn ghost small" onClick={() => void giveUp()}>그만하기</button> : null}
        <button className="btn" disabled={Boolean(busy)} onClick={() => void open()}>{busy || (pending ? "문제 다시 열기" : "문제 열고 구현하기")}</button>
      </div>
    </section>
  );
}

function Walkthrough({ a, send, onDone }: { a: ActionView; send: (b: Record<string, unknown>) => Promise<Record<string, unknown> | null>; onDone: () => void }) {
  const w = a.walkthrough!;
  const [step, setStep] = useState(0);
  const [guess, setGuess] = useState(""); const [pred, setPred] = useState<{ ok: boolean; answer?: string } | null>(null);
  useEffect(() => { void send({ kind: "walkthrough" }); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 시범을 연 순간 한 번 "봄"으로 남긴다
  const steps: Array<[string, string]> = [["관찰", w.observe], ["선택", w.choose], ["비교", w.compare], ["검증", w.verify]];
  const showPredict = a.predict && step >= 2 && !pred;
  return (
    <section className="panel stack pt-card">
      <Problem a={a} full />
      <p className="eyebrow">고수는 이렇게 봐요{a.patternNames?.length ? ` · ${a.patternNames.join(", ")}` : ""}</p>
      <ol className="pt-steps">
        {steps.slice(0, step + 1).map(([k, v], i) => <li key={k}><b>{k}</b> {v}{i === 1 && a.signals?.length ? <div className="small muted">신호: {a.signals.join(" · ")}</div> : null}</li>)}
      </ol>
      {showPredict ? (
        <div className="stack pt-predict">
          <p className="small"><b>예측해 보기</b> {a.predict!.question}</p>
          <pre className="ws-code">{a.predict!.input}</pre>
          <textarea className="ws-input" rows={2} value={guess} onChange={(e) => setGuess(e.target.value)} placeholder="출력을 적어 보세요" />
          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            <button className="btn ghost small" onClick={() => setPred({ ok: false })}>모르겠어요</button>
            <button className="btn small" disabled={!guess.trim()} onClick={async () => { const r = await send({ kind: "walkthrough", predict: guess }); if (r) setPred({ ok: Boolean(r.ok), answer: r.answer as string }); }}>확인</button>
          </div>
        </div>
      ) : null}
      {pred ? <p className={`small ${pred.ok ? "pt-good" : "pt-bad"}`}>{pred.ok ? "맞았어요." : "다르게 나와요."}{pred.answer !== undefined ? <> 강의 풀이를 실제로 돌린 출력: <code>{pred.answer}</code></> : null}</p> : null}
      {step >= 3 && a.pitfalls?.length ? <p className="small"><b>흔한 실수</b> {a.pitfalls.join(" · ")}</p> : null}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button className="linkish small" onClick={async () => { await send({ kind: "walkthrough", skipped: true }); onDone(); }}>이 패턴은 알아요 (건너뛰기)</button>
        {step < 3 ? <button className="btn" disabled={Boolean(showPredict)} onClick={() => setStep(step + 1)}>{steps[step + 1][0]} 보기</button>
          : <button className="btn" onClick={onDone}>다 봤어요 →</button>}
      </div>
    </section>
  );
}

type CardProps = { a: ActionView; elapsed?: () => number; send: (b: Record<string, unknown>) => Promise<Record<string, unknown> | null>; fb: Record<string, unknown> | null; busy: string; err: string; next: ReactNode };

function DrillCard({ a, elapsed, send, fb, busy, err, next }: CardProps) {
  const [hint, setHint] = useState(false);
  const [pick, setPick] = useState("");
  const approaches = (fb?.approaches ?? []) as Array<{ name: string; verdict: string; why: string }>;
  return (
    <section className="panel stack pt-card">
      <Problem a={a} />
      <p className="small"><b>이 문제는 어떤 접근으로 풀까요?</b> 코드는 짜지 않아요. 30초~1분 안에 골라 보세요.</p>
      <div className="pt-options">{(a.options ?? []).map((o) => {
        const v = approaches.find((x) => x.name === o);
        return <button key={o} className={`pt-opt${pick === o ? " on" : ""}${v ? ` ${VERDICT[v.verdict]?.[1] ?? ""}` : ""}`} disabled={Boolean(fb) || Boolean(busy)} onClick={() => setPick(o)}>
          {o}{v ? <span className="small"> — {VERDICT[v.verdict]?.[0]}. {v.why}</span> : null}</button>; })}</div>
      {!fb && !hint && (a.signals?.length ?? 0) > 0 ? <button className="linkish small" onClick={() => setHint(true)}>신호 보기 (도움 받은 것으로 남아요)</button> : null}
      {hint && !fb ? <p className="small muted">신호: {(a.signals ?? []).join(" · ")}</p> : null}
      {err ? <p className="ws-err small">{err}</p> : null}
      {fb ? <p className={`small ${fb.ok ? "pt-good" : "pt-bad"}`}><b>{fb.ok ? "맞았어요." : "다른 접근이 의도된 풀이예요."}</b> 이 문제의 패턴: {(fb.patternNames as string[]).join(", ")} · 신호: {(fb.signals as string[]).join(" · ")} <span className="muted">({String(fb.grade)})</span></p>
        : <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn" disabled={!pick || Boolean(busy)} onClick={() => void send({ kind: "drill", mixed: a.mixed, choice: pick, hinted: hint, ms: elapsed?.() })}>{busy || "확인"}</button></div>}
      {fb ? next : null}
    </section>
  );
}

function DesignCard({ a, elapsed, send, fb, busy, err, next }: CardProps) {
  const [state, setState] = useState(""); const [cx, setCx] = useState(""); const [update, setUpdate] = useState("");
  const f = fb as null | { ok: boolean; stateOk: boolean; cxOk: boolean; state: { right: string }; update: string; complexity: string; mine: string | null; theirs: string | null; pitfalls: string[]; grade: string };
  return (
    <section className="panel stack pt-card">
      <Problem a={a} />
      <p className="small"><b>풀이를 설계해 보세요.</b> 무엇을 기억해야 하고, 얼마나 걸리는지만 정해요.</p>
      <p className="eyebrow">1. 꼭 기억해야 하는 상태</p>
      <div className="pt-options">{(a.states ?? []).map((s) => <button key={s} className={`pt-opt${state === s ? " on" : ""}${f ? (s === f.state.right ? " good" : state === s ? " bad" : "") : ""}`} disabled={Boolean(f)} onClick={() => setState(s)}>{s}</button>)}</div>
      <p className="eyebrow">2. 그 상태를 언제·어떻게 바꾸나 (한 줄, 채점 안 함)</p>
      <input className="ws-input" value={update} disabled={Boolean(f)} onChange={(e) => setUpdate(e.target.value)} placeholder="예: 큐에 넣을 때 방문 표시" />
      <p className="eyebrow">3. 시간 복잡도{a.maxN ? ` (N ≤ ${a.maxN.toLocaleString()})` : ""}</p>
      <div className="pt-options cx">{(a.complexities ?? []).map((c) => <button key={c} className={`pt-opt${cx === c ? " on" : ""}${f ? (c === f.complexity ? " good" : cx === c ? " bad" : "") : ""}`} disabled={Boolean(f)} onClick={() => setCx(c)}>O({c})</button>)}</div>
      {err ? <p className="ws-err small">{err}</p> : null}
      {f ? (
        <div className={`stack small ${f.ok ? "pt-good" : "pt-bad"}`} style={{ gap: 4 }}>
          <b>{f.ok ? "설계가 맞아요." : `${!f.stateOk ? "상태" : ""}${!f.stateOk && !f.cxOk ? "와 " : ""}${!f.cxOk ? "복잡도" : ""}가 달라요.`}</b>
          <span>상태: {f.state.right} · 바꾸는 법: {f.update}</span>
          <span>복잡도: O({f.complexity}){f.theirs ? ` — ${f.theirs}` : ""}</span>
          {!f.cxOk && f.mine ? <span>고른 O({cx}): {f.mine}</span> : null}
          {f.pitfalls.length ? <span>흔한 실수: {f.pitfalls.join(" · ")}</span> : null}
          <span className="muted">({f.grade})</span>
        </div>
      ) : <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn" disabled={!state || !cx || Boolean(busy)} onClick={() => void send({ kind: "design", mixed: a.mixed, state, complexity: cx, update, ms: elapsed?.() })}>{busy || "확인"}</button></div>}
      {f ? next : null}
    </section>
  );
}

function ContrastCard({ a, send, fb, busy, err, next }: CardProps) {
  const [picks, setPicks] = useState<Record<string, string>>({});
  const items = [{ number: a.number, title: a.title, summary: a.summary }, ...(a.other ? [a.other] : [])];
  const f = fb as null | { ok: boolean; differs: string; mine: string[]; others: string[] };
  return (
    <section className="panel stack pt-card">
      <div className="row small" style={{ gap: 6 }}><span className="chip">비교하기</span><span className="muted">{a.why}</span></div>
      <p className="small"><b>비슷해 보이는 두 문제예요. 각각 어떤 패턴으로 풀까요?</b></p>
      {items.map((it, i) => (
        <div key={it.number} className="stack pt-problem" style={{ gap: 4 }}>
          <b className="small">BOJ {it.number} {it.title}</b><p className="small">{it.summary}</p>
          <div className="pt-options">{(a.patternChoices ?? []).map((p) => <button key={p.id} className={`pt-opt${picks[it.number] === p.id ? " on" : ""}`} disabled={Boolean(f)} onClick={() => setPicks({ ...picks, [it.number]: p.id })}>{p.name}</button>)}</div>
          {f ? <p className="small muted">이 문제의 패턴: {(i === 0 ? f.mine : f.others).join(", ")}</p> : null}
        </div>
      ))}
      {err ? <p className="ws-err small">{err}</p> : null}
      {f ? <p className={`small ${f.ok ? "pt-good" : "pt-bad"}`}><b>{f.ok ? "둘 다 맞았어요." : "다르게 골랐어요."}</b> 차이: {f.differs}</p>
        : <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn" disabled={items.some((it) => !picks[it.number]) || Boolean(busy)} onClick={() => void send({ kind: "contrast", picks })}>{busy || "확인"}</button></div>}
      {f ? next : null}
    </section>
  );
}
