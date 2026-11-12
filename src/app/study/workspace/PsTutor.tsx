"use client";
// PS 튜터 (2026-11-08, src/lib/code/tutor/): "다음 할 일" 카드 하나와 "내 PS 패턴" 표. 사용자는 늘 보기·판단하기·설계하기·
// 구현하기 중 하나만 하고, 정답 대조·기록·다음 할 일은 서버의 코드가 정한다. 화면에는 답이 오지 않는다(제출 뒤 피드백으로만).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { memo } from "./MemoToast";
import { call, errorText, later } from "./api";
import { Rich } from "./Rich";

type Ab = "recognize" | "design" | "execute";
type PatternRow = { id: string; name: string; what: string; seen: boolean; solid: boolean; graduated: boolean;
  abilities: Record<Ab, { help: 0 | 1 | 2 | 3; freshWins: number; accuracy: number | null; dueAt: string | null; due: boolean; failStreak: number; n: number }> };
type Base = { id: string; kind: "walkthrough" | "contrast" | "drill" | "design" | "implement"; number: string; pattern: string; mixed: boolean; minutes: number; why: string; redo?: boolean; fill?: boolean;
  title: string; url: string; chapter: string | null; patternName: string | null; summary: string; statement: string; inputText: string; outputText: string;
  example: { input: string; output: string } | null; maxN: number | null };
type ActionView = Base & {
  walkthrough?: { observe: string; choose: string; compare: string; verify: string }; signals?: string[]; pitfalls?: string[]; patternNames?: string[];
  predict?: { question: string; input: string } | null; options?: string[]; concept?: boolean; states?: string[]; complexities?: string[];
  other?: { number: string; title: string; summary: string } | null; patternChoices?: Array<{ id: string; name: string }>;
};
type Overview = { targets: number; ready: number; prep: { running: boolean; total: number; done: number; failed: Array<{ number: string; why: string }> };
  pending: Array<{ number: string }>; patterns: PatternRow[]; actions: ActionView[]; done: number;
  board?: Array<{ id: string; name: string; stage: string; marks: Record<Ab, "ok" | "help" | "bad" | "none">; open: number; wrong?: string }>;
  catalog?: Catalog; learning?: { focused: boolean; focus: string[]; next: Array<{ id: string; name: string; ready: boolean }> } };
type Catalog = { patterns: Array<{ id: string; name: string; tier: number; tierName: string; solid: boolean }> };

// 쉬운 말로(11/10 사용자 "항상 인간이 이해하기 쉽게").
const KIND_LABEL: Record<Base["kind"], string> = { walkthrough: "풀이 과정 보기", contrast: "비슷한 문제 구별", drill: "방법 고르기", design: "계획 세우기", implement: "직접 짜기" };
const VERDICT: Record<string, [string, string]> = { best: ["이 문제에 맞는 방법", "good"], ok: ["되긴 하지만 더 좋은 방법이 있어요", "help"], slow: ["답은 맞지만 느려요", "help"], wrong: ["틀려요", "bad"] };

export default function PsTutor({ onOpenProblem }: { onOpenProblem: (id: string) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  // 지금 보고 있는 할 일은 끝낼 때까지 그대로 둔다: 문제 모델을 만드는 동안 3초마다 새로 읽으면서 다음 할 일이 바뀌어
  // 풀던 카드가 다른 문제로 넘어가던 것(11/9 사용자). 끝내면(onDone) 비우고 새 첫 할 일을 잡는다.
  const [pinned, setPinned] = useState<ActionView | null>(null);
  const load = useCallback(async () => {
    try { const d = await call<Overview>("/api/code/tutor"); setData(d); setPinned((p) => p ?? d.actions[0] ?? null); setError(""); } catch (e) { setError(errorText(e)); }
  }, []);
  const next = useCallback(() => { setPinned(null); void load(); }, [load]);
  useEffect(() => later(() => void load()), [load]);
  const running = data?.prep.running;
  useEffect(() => { if (!running) return; const t = setInterval(() => void load(), 3000); return () => clearInterval(t); }, [running, load]);
  // 실패한 것이 있으면(인터넷 아카이브가 막음) 다시 할 때는 하나씩.

  const saveProfile = useCallback(async (body: Record<string, unknown>) => {
    try { const d = await call<Overview>("/api/code/tutor/profile", body); setData(d); setPinned(d.actions[0] ?? null); setError(""); } catch (e) { setError(errorText(e)); }
  }, []);

  if (!data) return <section className="panel small muted">{error || "PS 튜터를 여는 중…"}</section>;
  const action = pinned ?? data.actions[0];
  return (
    <div className="stack pt">
      <header className="stack" style={{ gap: 4 }}>
        <h2>PS 튜터</h2>
        <p className="small muted">문제 하나를 오래 붙잡기보다, 잘하는 사람이 문제를 볼 때 하는 생각(무엇을 보고 → 어떤 방법을 고르고 → 왜 다른 건 아닌지 → 어떻게 확인하는지)을 짧게 여러 번 연습해요. 맞히면 다음으로, 틀리면 필요한 곳만 다시 보여 줘요.</p>
      </header>
      {error ? <p className="ws-err">{error}</p> : null}
      {/* 문제 재료는 필요할 때 조금씩 뒤에서 만든다(11/10). 만드는 동안만 한 줄. */}
      {running ? <p className="small muted pt-prep">다음에 배울 패턴의 문제를 준비하는 중… ({data.prep.done}/{data.prep.total})</p> : null}
      {data.learning?.focused ? <p className="small pt-focus">지금은 고른 분야만 배워요: {data.learning.focus.map((id) => data.catalog?.patterns.find((p) => p.id === id)?.name ?? id).join(", ")} <button className="linkish small" onClick={() => void saveProfile({ op: "unfocus" })}>집중 끝내기</button></p> : null}
      {action ? <ActionCard key={action.id + data.done} a={action} onDone={next} onOpenProblem={onOpenProblem} pending={data.pending.some((p) => p.number === action.number)}
        />
        : data.learning?.next[0] && !data.learning.next[0].ready ? <section className="panel small muted">「{data.learning.next[0].name}」 문제를 준비하고 있어요. 잠시 뒤에 열려요.</section>
        : data.ready ? <section className="panel small muted">지금 할 일이 없어요. 복습 날짜가 되면 다시 나와요.</section> : null}
      {data.learning && data.catalog ? <NextPicker l={data.learning} s={data.catalog} onFocus={(patterns) => void saveProfile({ op: "focus", patterns })} /> : null}
      {data.board?.length ? <Board rows={data.board} /> : null}
      {data.actions.length > 1 ? (
        <section className="stack" style={{ gap: 4 }}>
          <p className="eyebrow">그다음</p>
          <ul className="pt-next">{data.actions.slice(1).map((a) => <li key={a.id} className="small"><span className="chip">{KIND_LABEL[a.kind]}</span> {a.mixed ? "어느 단원인지 안 알려 주는 문제" : `BOJ ${a.number} ${a.title}`} <span className="muted">· {a.why} · 약 {a.minutes}분</span></li>)}</ul>
        </section>
      ) : null}
      <SolveLogs key={`logs${data.done}`} />
      <Journal key={data.done} />
    </div>
  );
}

/** 한눈에 보기(11/10): 해 본 패턴마다 지금 어디서 막혔는지 한 줄. 아직 남은 착각이 있는 것부터. 자세한 건 기억 창. */
function Board({ rows }: { rows: NonNullable<Overview["board"]> }) {
  const [all, setAll] = useState(false);
  const MARK = { ok: "✓", help: "△", bad: "✗", none: "" } as const;
  const shown = all ? rows : rows.slice(0, 5);
  return (
    <section className="panel stack pt-board">
      <div className="row" style={{ justifyContent: "space-between" }}><b>지금 내 상태</b><span className="small muted">✓ 혼자 했어요 · △ 도움 받고 · ✗ 막혔어요</span></div>
      <ul className="pt-board-list">{shown.map((r) => (
        <li key={r.id}>
          <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
            <b className="small">{r.name}</b>
            <span className="small muted">{(["recognize", "design", "execute"] as const).map((ab) => `${{ recognize: "알아채기", design: "계획", execute: "짜기" }[ab]}${MARK[r.marks[ab]] ? ` ${MARK[r.marks[ab]]}` : ""}`).join(" · ")}</span>
          </div>
          <span className="small">{r.stage}</span>
          {r.wrong ? <span className="small muted">그때 내 생각: {r.wrong}</span> : null}
        </li>))}</ul>
      {rows.length > 5 ? <button className="linkish small" onClick={() => setAll(!all)}>{all ? "접기" : `${rows.length - 5}개 더 보기`}</button> : null}
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
    let lang = "python";
    try { lang = localStorage.getItem("code:lang") || "python"; } catch { /* 저장소 꺼짐 */ }
    try {
      const r = await call<{ problemId: string }>("/api/code/tutor/answer", { kind: "implement", number: a.number, pattern: a.pattern, mixed: a.mixed, action: "start", ...(a.fill ? { fill: true } : {}), ...(a.redo ? { redo: true } : {}), lang });
      if (r.problemId.startsWith("cp_boj_")) await call(`/api/code/bakingdog/${a.number}/fill`, {}); // 이미 만들어진 문제면 그대로 돌아온다(유저가 넣은 문제는 이미 있음)
      if (a.fill && !pending) {
        // 뼈대 코드(11/11): 숨은 테스트가 다 만들어져야 검증할 수 있어서, 아직이면 3초마다 다시 물어본다(최대 약 2분).
        setBusy("뼈대 코드를 만드는 중… (처음이면 AI 1번, 10~30초)");
        for (let i = 0; ; i++) {
          try { await call("/api/code/tutor/fill", { number: a.number, lang }); break; }
          catch (e) {
            if (i < 40 && /아직 만드는 중/.test(errorText(e))) { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
            // 뼈대를 못 만들었으면(11/11 시험: 2751 파이썬 뼈대가 검증을 못 넘음) 막히지 않게 뼈대 없이 연다. 풀이도 뼈대 없는 풀이로 다시 시작해 기록이 맞게.
            await call("/api/code/tutor/answer", { kind: "implement", number: a.number, pattern: a.pattern, mixed: a.mixed, action: "start", lang });
            alert0(`${errorText(e)} 뼈대 없이 문제를 열어요. 막히면 오른쪽 AI 튜터의 [힌트]를 눌러요.`);
            break;
          }
        }
      }
      onOpenProblem(r.problemId);
    } catch (e) { setErr(errorText(e)); } finally { setBusy(""); }
  };
  const alert0 = (text: string) => memo({ state: "done", text });
  const giveUp = async () => { await send({ kind: "implement", mixed: a.mixed, action: "giveup" }); onDone(); };
  return (
    <section className="panel stack pt-card">
      <Problem a={a} />
      <p className="small">{a.fill ? "처음 짜 보는 방법이라 뼈대 코드를 드려요. 「여기를 채워요」라고 적힌 핵심 줄만 직접 채워서 제출해 보세요. 다음에는 다른 문제를 혼자 짜요."
        : a.redo ? "빈 코드에서 시작해요. 혼자 통과하면 그때 막혔던 것이 「해결됨」이 돼요. 또 막히면 도움을 열어도 되고, 그러면 며칠 뒤 다시 나와요."
        : "이번에는 혼자 끝까지 구현해요. 막히면 문제 화면의 「막혔을 때」에서 작은 도움부터 열어요. 도움을 받으면 「도움 받고 맞힘」으로 남고, 며칠 뒤 혼자 다시 풀어요."}</p>
      {err ? <p className="ws-err small">{err}</p> : null}
      <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
        {pending ? <button className="btn ghost small" onClick={() => void giveUp()}>그만하기</button> : null}
        <button className="btn" disabled={Boolean(busy)} onClick={() => void open()}>{busy || (pending ? "문제 다시 열기" : a.fill ? "뼈대 코드로 시작하기" : a.redo ? "혼자 다시 풀기" : "문제 열고 구현하기")}</button>
      </div>
    </section>
  );
}

function Walkthrough({ a, send, onDone }: { a: ActionView; send: (b: Record<string, unknown>) => Promise<Record<string, unknown> | null>; onDone: () => void }) {
  const w = a.walkthrough!;
  const [step, setStep] = useState(0);
  const [guess, setGuess] = useState(""); const [pred, setPred] = useState<{ ok: boolean; answer?: string } | null>(null);
  useEffect(() => { void send({ kind: "walkthrough" }); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 시범을 연 순간 한 번 "봄"으로 남긴다
  const steps: Array<[string, string]> = [["먼저 본 것", w.observe], ["고른 방법", w.choose], ["다른 방법이 아닌 이유", w.compare], ["맞는지 확인하는 법", w.verify]];
  const showPredict = a.predict && step >= 2 && !pred;
  return (
    <section className="panel stack pt-card">
      <Problem a={a} full />
      <p className="eyebrow">잘하는 사람은 이렇게 봐요{a.patternNames?.length ? ` · ${a.patternNames.join(", ")}` : ""}</p>
      <ol className="pt-steps">
        {steps.slice(0, step + 1).map(([k, v], i) => <li key={k}><b>{k}</b> {v}{i === 1 && a.signals?.length ? <div className="small muted">이럴 때 떠올려요: {a.signals.join(" · ")}</div> : null}</li>)}
      </ol>
      {showPredict ? (
        <div className="stack pt-predict">
          <p className="small"><b>결과 맞혀 보기</b> {a.predict!.question}</p>
          <pre className="ws-code">{a.predict!.input}</pre>
          <textarea className="ws-input" rows={2} value={guess} onChange={(e) => setGuess(e.target.value)} placeholder="출력을 적어 보세요" />
          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            <button className="btn ghost small" onClick={async () => { const r = await send({ kind: "walkthrough", predict: "" }); setPred({ ok: false, answer: r?.answer as string | undefined }); }}>모르겠어요</button>
            <button className="btn small" disabled={!guess.trim()} onClick={async () => { const r = await send({ kind: "walkthrough", predict: guess }); if (r) setPred({ ok: Boolean(r.ok), answer: r.answer as string }); }}>확인</button>
          </div>
        </div>
      ) : null}
      {pred ? <p className={`small ${pred.ok ? "pt-good" : "pt-bad"}`}>{pred.ok ? "맞았어요." : "다르게 나와요."}{pred.answer !== undefined ? <> 실제로 돌려 본 결과: <code>{pred.answer}</code></> : null}</p> : null}
      {step >= 3 && a.pitfalls?.length ? <p className="small"><b>흔한 실수</b> {a.pitfalls.join(" · ")}</p> : null}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button className="linkish small" onClick={async () => { await send({ kind: "walkthrough", skipped: true }); onDone(); }}>이건 알아요 (건너뛰기)</button>
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
  const [picks, setPicks] = useState<string[]>([]);
  const approaches = (fb?.approaches ?? []) as Array<{ name: string; verdict: string; why: string }>;
  // 개념 보기(11/10): 맞는 것을 모두 고른다(둘 다 되는 문제는 둘 다 골라야 정답). 정답은 초록, 고른 오답은 빨강, 놓친 정답은 점선.
  const c = fb?.concept ? fb as { ok: boolean; answer: string; answers: string[]; wrongPick: string; missed: string[]; why: string; usually: string; what: string; how: string; signals: string[]; grade: string } : null;
  const tone = (o: string) => (c ? (c.answers.includes(o) ? (picks.includes(o) ? " good" : " good missed") : picks.includes(o) ? " bad" : "") : "");
  const toggle = (o: string) => setPicks((xs) => (xs.includes(o) ? xs.filter((x) => x !== o) : [...xs, o]));
  return (
    <section className="panel stack pt-card">
      <Problem a={a} />
      <p className="small"><b>이 문제에서는 무엇을 써야 할까요?</b> {a.concept ? "맞는 것을 모두 고르세요." : ""} 코드는 짜지 않아요. 30초~1분 안에 골라 보세요.</p>
      {a.concept ? (
        <div className="pt-options concept">{(a.options ?? []).map((o) => (
          <button key={o} className={`pt-opt${picks.includes(o) ? " on" : ""}${tone(o)}`} aria-pressed={picks.includes(o)} disabled={Boolean(fb) || Boolean(busy)} onClick={() => toggle(o)}>{picks.includes(o) ? "✓ " : ""}{o}</button>))}</div>
      ) : (
        <div className="pt-options">{(a.options ?? []).map((o) => {
          const v = approaches.find((x) => x.name === o);
          return <button key={o} className={`pt-opt${pick === o ? " on" : ""}${v ? ` ${VERDICT[v.verdict]?.[1] ?? ""}` : ""}`} disabled={Boolean(fb) || Boolean(busy)} onClick={() => setPick(o)}>
            {o}{v ? <span className="small"> — {VERDICT[v.verdict]?.[0]}. {v.why}</span> : null}</button>; })}</div>
      )}
      {!fb && !hint && (a.signals?.length ?? 0) > 0 ? <button className="linkish small" onClick={() => setHint(true)}>힌트: 문제에서 눈여겨볼 곳 (도움 받은 것으로 남아요)</button> : null}
      {hint && !fb ? <p className="small muted">눈여겨볼 곳: {(a.signals ?? []).join(" · ")}</p> : null}
      {err ? <p className="ws-err small">{err}</p> : null}
      {c ? (
        <div className={`stack small ${c.ok ? "pt-good" : "pt-bad"}`} style={{ gap: 4 }}>
          <b>{c.ok ? "맞았어요." : (fb as { dunno?: boolean }).dunno ? `괜찮아요. 정답: ${c.answers.join(", ")}` : `아니에요. 정답: ${c.answers.join(", ")}`}</b>
          {!c.ok && c.wrongPick && c.why ? <span>「{c.wrongPick}」 말고 「{c.answer}」인 까닭: {c.why}</span> : null}
          {!c.ok && !c.wrongPick && c.missed.length && !(fb as { dunno?: boolean }).dunno ? <span>「{c.missed.join(", ")}」도 돼요.</span> : null}
          {c.usually ? <span>{c.usually}</span> : <span>{c.answer}: {c.what}</span>}
          {c.how ? <span>이렇게 풀어요: {c.how}</span> : null}
          {c.signals.length ? <span className="muted">이럴 때 떠올려요: {c.signals.join(" · ")}{c.ok ? ` · (${c.grade})` : ""}</span> : null}
        </div>
      ) : fb ? <p className={`small ${fb.ok ? "pt-good" : "pt-bad"}`}><b>{fb.ok ? (fb.intended ? "맞았어요." : "되는 방법이에요. 다만 이 문제에 더 맞는 방법이 따로 있어요.") : "이 방법으로는 안 돼요."}</b> 이 문제에 쓰는 것: {(fb.patternNames as string[]).join(", ")} · 이럴 때 떠올려요: {(fb.signals as string[]).join(" · ")}{fb.ok ? <span className="muted"> ({String(fb.grade)})</span> : null}</p>
        : <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          {/* 모르겠어요(11/11 시뮬레이션): 찍지 않아도 되게. 틀린 것으로 남고, 답과 까닭을 보여 줘요. */}
          <button className="btn ghost" disabled={Boolean(busy)} onClick={() => void send({ kind: "drill", mixed: a.mixed, choice: "", dunno: true, hinted: hint, ms: elapsed?.() })}>모르겠어요</button>
          <button className="btn" disabled={(a.concept ? !picks.length : !pick) || Boolean(busy)}
          onClick={() => void send(a.concept ? { kind: "drill", mixed: a.mixed, choice: picks.join(", "), choices: picks, hinted: hint, ms: elapsed?.() } : { kind: "drill", mixed: a.mixed, choice: pick, hinted: hint, ms: elapsed?.() })}>{busy || "확인"}</button></div>}
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
      <p className="small"><b>풀기 전에 계획을 세워 보세요.</b> 풀면서 무엇을 기억해 둘지, 얼마나 오래 걸릴지만 정해요.</p>
      <p className="eyebrow">1. 풀면서 꼭 적어 둘 것</p>
      <div className="pt-options">{(a.states ?? []).map((s) => <button key={s} className={`pt-opt${state === s ? " on" : ""}${f ? (s === f.state.right ? " good" : state === s ? " bad" : "") : ""}`} disabled={Boolean(f)} onClick={() => setState(s)}>{s}</button>)}</div>
      <p className="eyebrow">2. 그걸 언제·어떻게 바꾸나 (한 줄, 채점 안 함)</p>
      <input className="ws-input" value={update} disabled={Boolean(f)} onChange={(e) => setUpdate(e.target.value)} placeholder="예: 큐에 넣을 때 방문 표시" />
      <p className="eyebrow">3. 걸리는 시간 (시간 복잡도){a.maxN ? ` · 입력은 최대 ${a.maxN.toLocaleString()}개` : ""}</p>
      <div className="pt-options cx">{(a.complexities ?? []).map((c) => <button key={c} className={`pt-opt${cx === c ? " on" : ""}${f ? (c === f.complexity ? " good" : cx === c ? " bad" : "") : ""}`} disabled={Boolean(f)} onClick={() => setCx(c)}>O({c})</button>)}</div>
      {err ? <p className="ws-err small">{err}</p> : null}
      {f ? (
        <div className={`stack small ${f.ok ? "pt-good" : "pt-bad"}`} style={{ gap: 4 }}>
          <b>{f.ok ? "계획이 맞아요." : `${!f.stateOk ? "적어 둘 것" : ""}${!f.stateOk && !f.cxOk ? "과 " : ""}${!f.cxOk ? "걸리는 시간" : ""}이 달라요.`}</b>
          <span>적어 둘 것: {f.state.right} · 바꾸는 법: {f.update}</span>
          <span>걸리는 시간: O({f.complexity}){f.theirs ? ` — ${f.theirs}` : ""}</span>
          {!f.cxOk && f.mine ? <span>고른 O({cx}): {f.mine}</span> : null}
          {f.pitfalls.length ? <span>흔한 실수: {f.pitfalls.join(" · ")}</span> : null}
          {f.ok ? <span className="muted">({f.grade})</span> : null}
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

/* ---------- 학습 관찰일지 (11/8) ---------- */
type Entry = { at: string; number: string; title: string; patterns: string[]; what: string; result: "learned" | "alone" | "helped" | "seen" | "other"; text: string; lesson?: { gap: string; fix: string; cue: string; distinguish?: string } };
const RESULT: Record<Entry["result"], [string, string]> = { learned: ["배움", "bad"], alone: ["혼자", "good"], helped: ["도움", "help"], seen: ["봄", ""], other: ["", ""] };
function Journal() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [onlyLearned, setOnlyLearned] = useState(false);
  useEffect(() => later(() => { void call<{ entries: Entry[] }>("/api/code/tutor/journal").then((r) => setEntries(r.entries)).catch(() => setEntries([])); }), []);
  if (!entries?.length) return null;
  const shown = onlyLearned ? entries.filter((e) => e.result === "learned") : entries;
  const days = new Map<string, Entry[]>();
  for (const e of shown) { const d = new Date(e.at).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" }); days.set(d, [...(days.get(d) ?? []), e]); }
  return (
    <section className="panel stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>학습 일지</b>
        <label className="small row" style={{ gap: 4 }}><input type="checkbox" checked={onlyLearned} onChange={(e) => setOnlyLearned(e.target.checked)} /> 몰랐다가 배운 것만</label>
      </div>
      <p className="small muted">무엇을 했고, 어디서 몰랐고, 무엇을 배웠는지 시간 순서로 남아요. 몰랐다가 배운 것은 기억에도 들어가요.</p>
      {[...days].slice(0, 7).map(([day, list]) => {
        const learned = list.filter((e) => e.result === "learned").length, alone = list.filter((e) => e.result === "alone").length;
        return (
          <div key={day} className="stack pt-day">
            <p className="eyebrow">{day} · 배움 {learned} · 혼자 {alone}</p>
            <ol className="pt-journal">{list.map((e, i) => (
              <li key={`${e.at}${i}`}>
                <span className="muted num">{new Date(e.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
                {RESULT[e.result][0] ? <span className={`chip ${RESULT[e.result][1]}`}>{RESULT[e.result][0]}</span> : null}
                <span><b>{e.what}</b> · BOJ {e.number} {e.title} — {e.text}
                  {e.lesson && (e.lesson.gap || e.lesson.fix) ? <span className="pt-lesson">{e.lesson.gap ? <>그때 내 생각: {e.lesson.gap}<br /></> : null}{e.lesson.fix ? <>이렇게 하면 돼요: {e.lesson.fix}</> : null}{e.lesson.cue ? <><br /><span className="muted">이럴 때 떠올리기: {e.lesson.cue}</span></> : null}</span> : null}
                </span>
              </li>))}</ol>
          </div>
        );
      })}
    </section>
  );
}

type Log = { number: string; title: string; at: string; patterns: string[]; stuck: string | null; help: number; fill: boolean; solved: boolean; alone: boolean;
  lessonId?: string; gap?: string; fix?: string; cue?: string; confirmed?: boolean; redo: "none" | "waiting" | "due" | "done"; redoAt?: string };
const STUCK: Record<string, string> = { understand: "문제 이해", recognize: "방법 떠올리기", design: "계획 세우기", execute: "코드로 옮기기" };
const RUNG = ["", "눈여겨볼 곳", "방법 이름", "계획", "뼈대 코드"];
/** 풀이 일지(11/11): 문제마다 한 장. 어디서 막혔나 · 그때 내 생각 → 이렇게 풀려요 · 혼자 다시 풀었나. "그때 내 생각"은 사용자가 확인하거나 고친다. */
function SolveLogs() {
  const [data, setData] = useState<{ logs: Log[]; week: { text: string } } | null>(null);
  const [all, setAll] = useState(false);
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const load = useCallback(() => { void call<{ logs: Log[]; week: { text: string } }>("/api/code/tutor/logs").then(setData).catch(() => setData({ logs: [], week: { text: "" } })); }, []);
  useEffect(() => later(load), [load]);
  if (!data?.logs.length) return null;
  const confirm = async (id: string, gap?: string) => { await call("/api/code/tutor/lesson", { id, ...(gap ? { gap } : {}) }).catch(() => undefined); setEdit(null); load(); };
  const day = (at: string) => new Date(at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
  return (
    <section className="panel stack">
      <div className="row" style={{ justifyContent: "space-between" }}><b>풀이 일지</b><span className="small muted">문제마다 한 장: 어디서 막혔고, 무엇이 풀어 줬나</span></div>
      {data.week.text ? <p className="small pt-week">{data.week.text}</p> : null}
      <ul className="pt-logs">{(all ? data.logs : data.logs.slice(0, 4)).map((l) => (
        <li key={l.number} className="pt-log">
          <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
            <b className="small">BOJ {l.number} {l.title} <span className="muted">· {day(l.at)}</span></b>
            <span className="small muted">{l.patterns.slice(0, 2).join(", ")}</span>
          </div>
          <dl>
            <dt>막힌 곳</dt><dd>{l.stuck ? `${STUCK[l.stuck]}${l.fill ? " (뼈대 코드에서 채움)" : l.help ? ` (도움 ${l.help}칸: ${RUNG[l.help]}까지)` : ""}` : l.solved ? "막힌 곳 없이 혼자 풀었어요" : "아직 푸는 중"}</dd>
            {l.gap ? <><dt>그때 내 생각</dt><dd>{edit?.id === l.lessonId ? (
              <span className="row" style={{ gap: 6 }}><input className="ws-input" value={edit!.text} onChange={(e) => setEdit({ id: edit!.id, text: e.target.value })} aria-label="그때 내 생각 고치기" /><button className="btn small" onClick={() => void confirm(edit!.id, edit!.text)}>저장</button></span>
            ) : <>{l.gap} {l.lessonId && !l.confirmed ? <span className="small"><button className="linkish small" onClick={() => void confirm(l.lessonId!)}>맞아요</button> · <button className="linkish small" onClick={() => setEdit({ id: l.lessonId!, text: l.gap ?? "" })}>고칠게요</button></span> : l.lessonId ? <button className="linkish small" onClick={() => setEdit({ id: l.lessonId!, text: l.gap ?? "" })}>고치기</button> : null}</>}</dd></> : null}
            {l.fix ? <><dt>이렇게 풀려요</dt><dd>{l.fix}</dd></> : null}
            {l.cue ? <><dt>이럴 때 떠올리기</dt><dd>{l.cue}</dd></> : null}
            {l.redo !== "none" ? <><dt>다시 풀기</dt><dd>{l.redo === "done" ? `${day(l.redoAt ?? l.at)} 혼자 성공 ✓` : l.redo === "due" ? "지금 혼자 다시 풀 차례예요 (위 「다음 할 일」에 나와요)" : "내일 혼자 다시 풀어요"}</dd></> : null}
          </dl>
        </li>))}</ul>
      {data.logs.length > 4 ? <button className="linkish small" onClick={() => setAll((x) => !x)}>{all ? "접기" : `모두 보기 (${data.logs.length})`}</button> : null}
    </section>
  );
}

function NextPicker({ l, s, onFocus }: { l: NonNullable<Overview["learning"]>; s: Catalog; onFocus: (patterns: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const tiers = [...new Set(s.patterns.map((p) => p.tier))].sort();
  return (
    <section className="stack pt-picker" style={{ gap: 4 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
        <p className="eyebrow">다음에 배울 것</p>
        <span className="small"><button className="linkish small" onClick={() => setOpen((x) => !x)}>{open ? "접기" : "다른 걸 배울래요"}</button></span>
      </div>
      <p className="small">{l.next.slice(0, 3).map((p, i) => <span key={p.id}>{i ? " → " : ""}{i === 0 ? <b>{p.name}</b> : p.name}{p.ready ? "" : " (준비 중)"}</span>)}</p>
      {open ? tiers.map((t) => { const rows = s.patterns.filter((p) => p.tier === t && !p.solid); if (!rows.length) return null; return (
        <div key={t} className="stack" style={{ gap: 2 }}>
          <div className="row" style={{ gap: 8 }}><b className="small">{rows[0].tierName}</b><button className="linkish small" onClick={() => onFocus(rows.map((p) => p.id))}>이 묶음만 배우기</button></div>
          <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>{rows.map((p) => <button key={p.id} className={`chip pt-pick${l.focus.includes(p.id) ? " on" : ""}`} onClick={() => onFocus([p.id])}>{p.name}</button>)}</div>
        </div>); }) : null}
    </section>
  );
}
