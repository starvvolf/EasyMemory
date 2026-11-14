"use client";
// 상황 재현 복습 화면 (설계 docs/상황재현_설계_v2(+gpt).md 7번):
//   GapList — 한 풀이 · 한 실습에서 나온 빈틈과 지금 상태(똑같이 ✓ · 비슷하게 ✓ · 응용 ─), [확인하기] · [이건 아는 거였어요]
//   SceneSession — 빈틈 여러 개를 장면 하나씩. 장면 카드의 틀은 형식이 달라도 같다:
//     위(거리에 따라 "그때 그대로예요" · "겪은 일과 비슷해요", 무슨 빈틈인지는 답한 뒤) · 가운데(형식별 몸통) · 아래([실행] [제출] [힌트] [모르겠어요])
//     · 답한 뒤(판정 · 맞는 생각 · 알맹이 · [그때 내 코드 보기] · [튜터와 다시 보기] · [왜인지 한 줄])
//   TodayScenes — 오늘 탭: "알고리즘 · 확인 N개 · 약 M분", "실습 · 확인 N개 · 약 M분"
import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { call, errorText } from "../api";
import { PracticeBody } from "./PracticeScene";
import "./scene.css";

export type GapLite = { id: string; branch: "algo" | "practice"; title: string; kind: string; layer: number; target: "ability" | "form"; missed: string; wrong: string; scope: string; dose: number;
  distance: "same" | "near" | "far"; known: boolean; due: string; passes: number; sameMistakes: number; unclear: number;
  origin: { problemId: string; title: string; lang: string; runId?: string }; wrongVerified: boolean; doubtful: boolean; dismissed: boolean; topic: string; evidence: number; hasCode: boolean };
type Format = "write" | "blank" | "predict" | "fix" | "choice" | "order" | "function" | "counter" | "draw" | "variant" | "error" | "why" | "where" | "timeline" | "command" | "project" | "origin";
export type SceneLite = { id: string; gapId: string; format: Format; lang: string; distance: GapLite["distance"]; story: string; ask: string;
  setup: string; after: string; template: string; code: string; inputs: string[]; failing: string[]; choices: string[]; minutes: number;
  view?: { from: number; to: number }; pieces?: string[]; errorText?: string; drawMode?: "value" | "shape"; variant?: { problemId: string; title: string }; structure?: string[]; mix?: string[];
  practice?: Record<string, unknown> };
type Result = { verdict: "pass" | "same" | "other" | "unclear"; label: string; gaveUp: boolean; note?: string; explain: string; kernel: string; wrong: string; other?: string;
  firstDiff?: { index: number; stdin: string; expected: string; got: string }; errors?: string[]; answerKey?: number; expected?: string; reference?: string; origin?: string;
  mixed?: GapLite[]; gap: GapLite; tutor: boolean; canWhy: boolean };

const DIST: Record<GapLite["distance"], string> = { same: "똑같이", near: "비슷하게", far: "응용" };
const LADDER: GapLite["distance"][] = ["same", "near", "far"];
const SCOPE: Record<string, string> = { line: "한 줄", piece: "조각", function: "함수", project: "프로젝트" };
const FORMAT: Record<Format, string> = { write: "한 줄 쓰기", blank: "빈칸 채우기", predict: "결과 맞히기", fix: "틀린 곳 고치기", choice: "고르기", order: "순서 맞추기", function: "작은 함수 쓰기",
  counter: "반례 만들기", draw: "담기 그리기", variant: "변형 문제", error: "오류 읽기", why: "왜인지 한 줄", where: "어디에 넣을까", timeline: "시간 순서 표", command: "명령 한 줄",
  project: "작은 재현 프로젝트", origin: "원래 자리로" };
const PRACTICE: Format[] = ["where", "timeline", "command", "project", "origin"];

/** 사다리 점: 지나온 거리는 ✓, 지금 거리는 ●, 남은 것은 ─ */
function Ladder({ g }: { g: Pick<GapLite, "distance" | "known"> }) {
  const at = LADDER.indexOf(g.distance);
  return <span className="sc-ladder" aria-label={`지금 ${DIST[g.distance]}`}>{LADDER.map((d, i) => <span key={d} className={g.known || i < at ? "ok" : i === at ? "now" : ""}>{DIST[d]} {g.known || i < at ? "✓" : i === at ? "●" : "─"}</span>)}</span>;
}

function CodeBox({ value, onChange, rows = 6, readOnly, mark }: { value: string; onChange?: (v: string) => void; rows?: number; readOnly?: boolean; mark?: [number, number] | null }) {
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab" || !onChange) return;
    e.preventDefault();
    const t = e.currentTarget, s = t.selectionStart;
    onChange(`${value.slice(0, s)}    ${value.slice(t.selectionEnd)}`);
    requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 4; });
  };
  if (readOnly && mark) return <pre className="sc-code ro">{value.split("\n").map((l, i) => <span key={i} className={i + 1 >= mark[0] && i + 1 <= mark[1] ? "sc-mark" : ""}>{`${String(i + 1).padStart(3)}  ${l}\n`}</span>)}</pre>;
  return readOnly ? <pre className="sc-code ro">{value}</pre>
    : <textarea className="sc-code" spellCheck={false} rows={Math.max(rows, value.split("\n").length + 1)} value={value} onChange={(e) => onChange?.(e.target.value)} onKeyDown={onKey} />;
}

/** 빈칸 코드: ____ 자리에 입력 칸. 똑같이(한 줄)는 그 줄 근처만 펼치고 나머지는 접는다(view). */
function BlankCode({ template, fills, setFills, disabled, view }: { template: string; fills: string[]; setFills: (f: (x: string[]) => string[]) => void; disabled: boolean; view?: { from: number; to: number } }) {
  let k = 0;
  const lines = template.split("\n");
  const line = (l: string, i: number) => {
    const parts = l.split(/_{3,}/);
    return <span key={i}>{parts.map((p, j) => { const idx = k; if (j < parts.length - 1) k++; return <span key={j}>{p}{j < parts.length - 1 ? <input className="sc-blank" value={fills[idx] ?? ""}
      size={Math.max(6, (fills[idx] ?? "").length + 1)} disabled={disabled} onChange={(e) => setFills((f) => f.map((x, q) => (q === idx ? e.target.value : x)))} aria-label={`빈칸 ${idx + 1}`} /> : null}</span>; })}{"\n"}</span>;
  };
  if (!view) return <pre className="sc-code blanks">{lines.map(line)}</pre>;
  const before = lines.slice(0, view.from - 1), mid = lines.slice(view.from - 1, view.to), after = lines.slice(view.to);
  // 접힌 줄에도 빈칸이 없다(빈칸은 view 안에만 있음)
  return <div>
    {before.length ? <details className="sc-fold"><summary className="small muted">위 {before.length}줄</summary><pre className="sc-code ro">{before.join("\n")}</pre></details> : null}
    <pre className="sc-code blanks">{mid.map((l, i) => line(l, i))}</pre>
    {after.length ? <details className="sc-fold"><summary className="small muted">아래 {after.length}줄</summary><pre className="sc-code ro">{after.join("\n")}</pre></details> : null}
  </div>;
}

/** 순서 맞추기: 줄을 끌어 놓거나 단추로 옮기고, 들여쓰기를 맞춘다(키보드로도 된다) */
function OrderBox({ pieces, value, setValue, disabled }: { pieces: string[]; value: Array<{ i: number; d: number }>; setValue: (v: Array<{ i: number; d: number }>) => void; disabled: boolean }) {
  const move = (k: number, by: number) => { const v = [...value]; const j = k + by; if (j < 0 || j >= v.length) return; [v[k], v[j]] = [v[j], v[k]]; setValue(v); };
  const indent = (k: number, by: number) => setValue(value.map((x, q) => (q === k ? { ...x, d: Math.max(0, Math.min(4, x.d + by)) } : x)));
  const drop = (k: number, from: number) => { if (from === k || Number.isNaN(from)) return; const v = [...value]; const [it] = v.splice(from, 1); v.splice(k, 0, it); setValue(v); };
  return <ol className="sc-order">{value.map((x, k) => <li key={x.i} draggable={!disabled} onDragStart={(e) => e.dataTransfer.setData("text/plain", String(k))}
    onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); drop(k, Number(e.dataTransfer.getData("text/plain"))); }}>
    <code style={{ paddingLeft: `${x.d * 2}ch` }}>{pieces[x.i]}</code><span className="cs-gap" />
    <button className="btn ghost small" disabled={disabled} aria-label="내어 쓰기" onClick={() => indent(k, -1)}>⇤</button>
    <button className="btn ghost small" disabled={disabled} aria-label="들여 쓰기" onClick={() => indent(k, 1)}>⇥</button>
    <button className="btn ghost small" disabled={disabled || k === 0} aria-label="위로" onClick={() => move(k, -1)}>▲</button>
    <button className="btn ghost small" disabled={disabled || k === value.length - 1} aria-label="아래로" onClick={() => move(k, 1)}>▼</button>
  </li>)}</ol>;
}

/** [그때 내 코드 보기] */
function ThenView({ gapId }: { gapId: string }) {
  const [v, setV] = useState<{ title: string; subs: Array<{ id: string; at: string; verdict: string; code: string; lines: [number, number] | null }>; talk: Array<{ at: string; quote: string }>; file?: string } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { void call<NonNullable<typeof v>>(`/api/scene/then?gap=${gapId}`).then(setV).catch((e) => setErr(errorText(e))); }, [gapId]);
  if (err) return <p className="small bad">{err}</p>;
  if (!v) return <p className="small muted"><span className="lc2-caret" /> 불러오는 중…</p>;
  return <div className="sc-then-view">
    {v.subs.map((s) => <div key={s.id}><span className="small muted">{new Date(s.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 제출 · {s.verdict}</span><CodeBox value={s.code} readOnly mark={s.lines} /></div>)}
    {v.talk.map((t, i) => <p key={i} className="small">💬 {t.quote}</p>)}
    {!v.subs.length && !v.talk.length ? <p className="small muted">{v.file ? `그때 파일: ${v.file}` : "남은 코드가 없어요."}</p> : null}
  </div>;
}

/** [왜인지 한 줄] (형식 12): 통과한 뒤 선택 질문. 채점은 AI 1번. */
function WhyBox({ sceneId }: { sceneId: string }) {
  const [q, setQ] = useState(""); const [text, setText] = useState(""); const [busy, setBusy] = useState(false);
  const [r, setR] = useState<{ label: string; note: string; verdict: string } | null>(null); const [err, setErr] = useState("");
  useEffect(() => { void call<{ question: string }>("/api/scene/why", { sceneId }).then((x) => setQ(x.question)).catch((e) => setErr(errorText(e))); }, [sceneId]);
  const send = async () => { setBusy(true); setErr(""); try { setR(await call("/api/scene/why", { sceneId, text })); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  return <div className="sc-why"><p className="small">{q}</p>
    {!r ? <><textarea className="sc-code" rows={2} value={text} onChange={(e) => setText(e.target.value)} /><button className="btn small" disabled={busy || !text.trim()} onClick={() => void send()}>{busy ? "보는 중… (AI 1번)" : "보내기"}</button></>
      : <p className={`small ${r.verdict === "pass" ? "" : "bad"}`}>{r.label} · {r.note}</p>}
    {err ? <p className="small bad">{err}</p> : null}</div>;
}

function SceneCard({ gap, scene, onDone }: { gap: GapLite; scene: SceneLite; onDone: (r: Result) => void }) {
  const blanks = (scene.template.match(/_{3,}/g) ?? []).length;
  const [code, setCode] = useState(scene.format === "fix" || scene.format === "write" || scene.format === "function" ? scene.template : "");
  const [fills, setFills] = useState<string[]>(Array.from({ length: blanks }, () => ""));
  const [text, setText] = useState("");
  const [order, setOrder] = useState<Array<{ i: number; d: number }>>(() => (scene.pieces ?? []).map((_, i) => ({ i, d: 0 })));
  const [pick, setPick] = useState<number | null>(null);
  const [prac, setPrac] = useState("");
  const [hinted, setHinted] = useState(false);
  const [busy, setBusy] = useState("");
  const [runs, setRuns] = useState<Array<{ input: string; out?: string; error?: string }> | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [invalid, setInvalid] = useState("");
  const [err, setErr] = useState("");
  const [then, setThen] = useState(false);
  const f = scene.format;
  const orderCode = order.map((x) => `${" ".repeat(x.d * 4)}${scene.pieces?.[x.i] ?? ""}`).join("\n");
  const answerText = f === "blank" ? fills.join("\n") : f === "predict" || f === "counter" || f === "draw" ? text : f === "choice" || f === "error" ? String(pick ?? "")
    : f === "order" ? orderCode : PRACTICE.includes(f) ? prac : code;
  const run = async () => { setBusy("run"); setErr(""); try { setRuns((await call<{ runs: typeof runs }>("/api/scene/run", { sceneId: scene.id, answer: answerText })).runs); } catch (e) { setErr(errorText(e)); } finally { setBusy(""); } };
  const submit = async (gaveUp = false) => {
    setBusy("answer"); setErr(""); setInvalid("");
    try {
      const r = await call<Result | { invalid: string }>("/api/scene/answer", { sceneId: scene.id, answer: gaveUp ? "" : answerText, hinted, gaveUp });
      if ("invalid" in r) setInvalid(r.invalid); else setRes(r);
    } catch (e) { setErr(errorText(e)); } finally { setBusy(""); }
  };
  const tutor = async () => {
    try {
      const t = await call<{ kind: "algo" | "practice"; problemId?: string; runId?: string; ask: string }>(`/api/scene/tutor?gap=${gap.id}`);
      if (t.kind === "algo" && t.problemId) {
        try { sessionStorage.setItem(`code:ask:${t.problemId}`, t.ask); } catch { /* 없음 */ }
        window.dispatchEvent(new CustomEvent("recaller:go", { detail: { view: "code" } }));
        setTimeout(() => window.dispatchEvent(new CustomEvent("recaller:code-open", { detail: { id: t.problemId } })), 0);
      } else if (t.runId) {
        try { await navigator.clipboard.writeText(t.ask); } catch { /* 없음 */ }
        window.dispatchEvent(new CustomEvent("recaller:go", { detail: { view: "project" } }));
        setTimeout(() => window.dispatchEvent(new CustomEvent("recaller:project-open", { detail: t.runId })), 0);
      }
    } catch (e) { setErr(errorText(e)); }
  };
  const openVariant = () => { if (!scene.variant) return; window.dispatchEvent(new CustomEvent("recaller:go", { detail: { view: "code" } })); setTimeout(() => window.dispatchEvent(new CustomEvent("recaller:code-open", { detail: { id: scene.variant!.problemId } })), 0); };
  const ready = f === "choice" || f === "error" ? pick !== null : f === "blank" ? fills.every((x) => x.trim()) : f === "predict" || f === "counter" || f === "draw" ? text.trim() !== ""
    : f === "order" ? order.length > 0 : PRACTICE.includes(f) ? prac.trim() !== "" : code.trim() !== "";
  const canRun = ["write", "function", "blank", "fix", "order", "variant", "counter"].includes(f);
  return <article className="sc-card">
    <header className="sc-head">
      <span className="sc-chip">{gap.kind}</span><span className="sc-chip soft">{FORMAT[f]} · {scene.mix && scene.mix.length > 1 ? "함수" : SCOPE[gap.scope] ?? gap.scope} · 약 {scene.minutes}분</span>
      {scene.mix && scene.mix.length > 1 ? <span className="sc-chip soft">빈틈 {scene.mix.length}개를 한 번에</span> : null}
      <span className="cs-gap" /><Ladder g={gap} />
    </header>
    {/* 풀기 전에는 상황만(어느 문제의 일인지). 무슨 빈틈 · 그때 생각은 답한 뒤에 — 미리 보이면 그 생각을 스스로 꺼내는지 확인할 수 없다 */}
    {scene.distance !== "far" || res ? <p className="sc-then">{res ? <><b>{gap.title}</b>{gap.wrong ? <span className="muted"> — 그때 생각: {gap.wrong}</span> : null}</>
      : scene.distance === "same" ? `${gap.origin.title}에서 그때 그대로예요.` : `${gap.origin.title}에서 겪은 일과 비슷해요.`}</p> : null}
    {scene.story ? <p className="sc-story">{scene.story}</p> : null}
    {scene.ask ? <p className="sc-ask">{scene.ask}</p> : null}
    {scene.structure?.length ? <p className="small muted">이번에 확인하는 표현: {scene.structure.join(" · ")}</p> : null}

    {f === "choice" || f === "error" ? <>
      {f === "error" ? <><CodeBox value={scene.code} readOnly />{scene.inputs[0]?.trim() ? <div className="sc-io"><span className="muted small">입력</span><pre>{scene.inputs[0]}</pre></div> : null}
        <div className="sc-io"><span className="muted small">이런 오류가 났어요</span><pre className="sc-err">{scene.errorText}</pre></div></> : null}
      <div className="sc-choices">{scene.choices.map((c, i) => <button key={i} className={`sc-choice${pick === i ? " on" : ""}${res && res.answerKey === i ? " right" : ""}${res && pick === i && res.answerKey !== i ? " wrong" : ""}`}
        disabled={Boolean(res)} onClick={() => setPick(i)}><span className="sc-n">{i + 1}</span>{c}</button>)}</div>
    </> : null}
    {f === "predict" || f === "draw" ? <>
      <CodeBox value={scene.code} readOnly />
      {scene.inputs[0]?.trim() ? <div className="sc-io"><span className="muted small">입력</span><pre>{scene.inputs[0]}</pre></div> : null}
      <label className="sc-field"><span className="small muted">{f === "draw" ? (scene.drawMode === "shape" ? "내가 고른 모양으로 담은 값 (파이썬 값으로)" : "만들어진 값 (파이썬 값으로)") : "출력"}</span>
        <textarea rows={f === "draw" ? 3 : 2} className="sc-code" value={text} disabled={Boolean(res)} onChange={(e) => setText(e.target.value)} /></label>
    </> : null}
    {f === "counter" ? <>
      <CodeBox value={scene.code} readOnly />
      <label className="sc-field"><span className="small muted">이 코드가 틀리는 입력</span><textarea rows={4} className="sc-code" value={text} disabled={Boolean(res)} onChange={(e) => setText(e.target.value)} /></label>
    </> : null}
    {f === "write" || f === "function" || f === "blank" || f === "order" ? <div className="sc-prog">
      {scene.setup ? <CodeBox value={scene.setup} readOnly /> : null}
      {f === "write" || f === "function" ? <CodeBox value={code} onChange={setCode} rows={f === "function" ? 10 : 3} />
        : f === "order" ? <OrderBox pieces={scene.pieces ?? []} value={order} setValue={setOrder} disabled={Boolean(res)} />
        : <BlankCode template={scene.template} fills={fills} setFills={setFills} disabled={Boolean(res)} view={scene.view} />}
      {scene.after ? <CodeBox value={scene.after} readOnly /> : null}
      {scene.inputs.length ? <details className="sc-io"><summary className="small">보이는 입력 {scene.inputs.length}개 (채점은 숨은 입력까지)</summary>{scene.inputs.map((x, i) => <pre key={i}>{x}</pre>)}</details> : null}
    </div> : null}
    {f === "fix" ? <div className="sc-prog">
      {scene.failing[0] ? <div className="sc-io"><span className="muted small">이 입력에서 틀렸어요</span><pre>{scene.failing[0]}</pre></div> : null}
      <CodeBox value={code} onChange={setCode} rows={10} />
    </div> : null}
    {f === "variant" ? <div className="sc-prog">
      {scene.inputs.map((x, i) => <div key={i} className="sc-io"><span className="muted small">예제 입력 {i + 1}</span><pre>{x}</pre></div>)}
      {scene.variant ? <p className="small"><button className="linkish" onClick={openVariant}>알고리즘 화면에서 풀기</button> <span className="muted">(튜터 · 채점기를 그대로 써요. 다 풀면 여기에 코드를 붙여 제출하세요)</span></p> : null}
      <CodeBox value={code} onChange={setCode} rows={12} />
    </div> : null}
    {PRACTICE.includes(f) ? <PracticeBody scene={scene} disabled={Boolean(res)} onAnswer={setPrac} /> : null}

    {runs ? <div className="sc-runs">{runs.map((r, i) => <div key={i} className="sc-run"><span className="small muted">{f === "counter" ? "입력 검사" : `입력 ${i + 1}의 출력`}</span><pre className={r.error ? "bad" : ""}>{r.error ?? r.out}</pre></div>)}</div> : null}
    {invalid ? <p className="small bad">{invalid}</p> : null}
    {err ? <p className="small bad">{err}</p> : null}

    {!res ? <footer className="sc-foot">
      {canRun ? <button className="btn small" disabled={!!busy || !ready} onClick={() => void run()}>{busy === "run" ? "실행 중…" : f === "counter" ? "입력 검사" : "실행"}</button> : null}
      <button className="btn small primary" disabled={!!busy || !ready} onClick={() => void submit()}>{busy === "answer" ? "채점 중…" : "제출"}</button>
      <span className="cs-gap" />
      <button className="btn ghost small" disabled={hinted} title="맞는 생각 한 문장을 봐요. 보고 맞히면 '도움받고 넘어감'으로 쳐요." onClick={() => setHinted(true)}>힌트</button>
      <button className="btn ghost small" disabled={!!busy} onClick={() => void submit(true)}>모르겠어요</button>
    </footer> : null}
    {hinted && !res ? <p className="sc-hint">💡 {gap.missed}</p> : null}

    {res ? <section className={`sc-res v-${res.verdict}`}>
      <p className="sc-verdict">{res.gaveUp ? "괜찮아요. 이번엔 떠올리지 못한 것으로 남겨요." : res.verdict === "pass" ? (hinted ? "통과! 힌트를 봤으니 한 번 더 볼게요." : "통과!") : res.verdict === "same" ? "그때와 같은 실수예요." : res.verdict === "other" ? "이번엔 다른 데서 틀렸어요." : "틀렸어요. 왜인지는 아직 몰라요."}</p>
      {res.note ? <p className="small">{res.note}</p> : null}
      {res.other ? <p className="small">이번 답은 이런 생각과 같아요: {res.other}</p> : null}
      {res.firstDiff && res.verdict !== "pass" ? <div className="sc-diff"><span className="small muted">{f === "counter" ? "내가 쓴 입력" : "처음 갈린 입력"}</span><pre>{res.firstDiff.stdin || "(없음)"}</pre>
        <div className="sc-diff2"><div><span className="small muted">{f === "counter" ? "맞는 풀이의 출력" : "정답"}</span><pre>{res.firstDiff.expected}</pre></div><div><span className="small muted">{f === "counter" ? "보여 준 코드의 출력" : "내 출력"}</span><pre className="bad">{res.firstDiff.got}</pre></div></div></div> : null}
      {res.expected !== undefined && res.verdict !== "pass" ? <div className="sc-io"><span className="small muted">{f === "draw" ? "실제로 만들어진 값" : "실제 출력"}</span><pre>{res.expected}</pre></div> : null}
      {res.reference && res.verdict !== "pass" ? <div className="sc-io"><span className="small muted">{f === "counter" ? "이 코드가 틀리는 입력의 예" : "모범 답"}</span><pre>{res.reference}</pre></div> : null}
      {res.errors?.length && !res.firstDiff ? <pre className="sc-err">{res.errors[0]}</pre> : null}
      <div className="sc-truth"><span className="sc-lab">맞는 생각</span><p>{res.explain}</p>{res.kernel ? <CodeBox value={res.kernel} readOnly /> : null}</div>
      {res.origin ? <p className="sc-origin">{res.origin}</p> : null}
      {res.mixed?.length ? <p className="small muted">이번 장면에 섞인 빈틈: {res.mixed.map((g) => `${g.title}(${DIST[g.distance]}${g.known ? " · 앎" : ""})`).join(" · ")}</p> : null}
      <div className="row small">
        {gap.hasCode || gap.evidence ? <button className="linkish small" onClick={() => setThen((x) => !x)}>{then ? "그때 내 코드 접기" : "그때 내 코드 보기"}</button> : null}
        {res.verdict !== "pass" ? <button className="linkish small" onClick={() => void tutor()}>튜터와 다시 보기</button> : null}
      </div>
      {then ? <ThenView gapId={gap.id} /> : null}
      {res.canWhy ? <details className="sc-whywrap"><summary className="small">왜인지 한 줄로 말해 보기 (선택)</summary><WhyBox sceneId={scene.id} /></details> : null}
      <footer className="sc-foot"><span className="small muted">다음: {res.gap.known ? "이제 앎 — 가끔 섞어서만 다시 봐요" : `${DIST[res.gap.distance]}부터 · ${new Date(res.gap.due).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}`}{res.tutor ? " · 같은 실수가 두 번이에요. 튜터와 다시 보면 좋아요" : ""}</span>
        <span className="cs-gap" /><button className="btn small primary" onClick={() => onDone(res)}>다음</button></footer>
    </section> : null}
  </article>;
}

/** 빈틈 여러 개를 장면 하나씩. 장면은 필요할 때 만든다(똑같이는 AI 없이, 비슷하게 · 응용은 AI 1번 또는 은행). 섞은 장면이면 섞인 빈틈은 건너뛴다. */
export function SceneSession({ gapIds, onClose }: { gapIds: string[]; onClose: (done: number) => void }) {
  const [at, setAt] = useState(0);
  const [skip, setSkip] = useState<string[]>([]);
  const [cur, setCur] = useState<{ gap: GapLite; scene: SceneLite } | null>(null);
  const [err, setErr] = useState("");
  const [tally, setTally] = useState<Record<string, number>>({});
  const id = gapIds[at];
  useEffect(() => {
    if (!id) return;
    if (skip.includes(id)) { const t = setTimeout(() => setAt((k) => k + 1), 0); return () => clearTimeout(t); }
    let alive = true;
    call<{ gap: GapLite; scene: SceneLite }>("/api/scene/next", { gapId: id }).then((r) => { if (alive) { setCur(r); setErr(""); } })
      .catch((e) => { if (alive) setErr(errorText(e)); });
    return () => { alive = false; };
  }, [id, skip]);
  if (!id) return <section className="sc-session done"><p className="sc-verdict">오늘 확인 끝!</p>
    <p className="small muted">{Object.entries(tally).map(([k, n]) => `${({ pass: "통과", same: "같은 실수", other: "다른 실수", unclear: "미확정" } as Record<string, string>)[k]} ${n}`).join(" · ") || "확인한 것이 없어요."}</p>
    <button className="btn small" onClick={() => onClose(at)}>닫기</button></section>;
  return <section className="sc-session">
    <div className="sc-top"><span className="small muted">확인 {at + 1} / {gapIds.length}</span><span className="cs-gap" /><button className="btn ghost small" onClick={() => onClose(at)}>그만</button></div>
    {err ? <div className="sc-card"><p className="small bad">{err}</p><button className="btn small" onClick={() => { setCur(null); setAt((k) => k + 1); }}>건너뛰기</button></div>
      : cur && cur.gap.id === id ? <SceneCard key={cur.scene.id} gap={cur.gap} scene={cur.scene} onDone={(r) => {
        setTally((t) => ({ ...t, [r.verdict]: (t[r.verdict] ?? 0) + 1 }));
        if (cur.scene.mix?.length) setSkip((s) => [...s, ...cur.scene.mix!.filter((g) => g !== id)]);
        setCur(null); setAt((k) => k + 1); }} />
      : <div className="sc-card sc-making"><span className="lc2-caret" /> 장면을 준비하는 중이에요…</div>}
  </section>;
}

/** 한 풀이(problemId) · 한 실습(runId)의 빈틈 목록(풀이 노트 · 맞힌 뒤 · 실습 정리). 알고리즘은 없으면 [놓친 생각 찾기](AI 1번). */
export function GapList({ problemId, runId, auto = false }: { problemId?: string; runId?: string; auto?: boolean }) {
  const [gaps, setGaps] = useState<GapLite[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [session, setSession] = useState<string[] | null>(null);
  const url = runId ? `/api/scene/gaps?run=${encodeURIComponent(runId)}` : `/api/scene/gaps?problem=${encodeURIComponent(problemId ?? "")}`;
  const load = useCallback(() => call<{ gaps: GapLite[] }>(url).then((r) => setGaps(r.gaps)).catch((e) => setErr(errorText(e))), [url]);
  const find = useCallback(async (force = false) => {
    if (!problemId) return;
    setBusy(true); setErr("");
    try { setGaps((await call<{ gaps: GapLite[] }>("/api/scene/extract", { problemId, force })).gaps); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  }, [problemId]);
  useEffect(() => { let alive = true; void call<{ gaps: GapLite[] }>(url).then((r) => {
    if (!alive) return; setGaps(r.gaps); if (!r.gaps.length && auto && problemId) void find(); }).catch((e) => alive && setErr(errorText(e))); return () => { alive = false; }; }, [url, auto, find, problemId]);
  const markGap = async (g: GapLite, kind: "known" | "undo") => { try { const r = await call<{ gap: GapLite }>("/api/scene/mark", { gapId: g.id, kind }); setGaps((xs) => xs?.map((x) => (x.id === g.id ? r.gap : x)) ?? null); } catch (e) { setErr(errorText(e)); } };
  if (session) return <SceneSession gapIds={session} onClose={() => { setSession(null); void load(); }} />;
  const open = gaps?.filter((g) => !g.known && !g.dismissed) ?? [];
  return <section className="sc-gaps">
    <header className="sc-gapshead"><span className="rv-eyebrow">상황 재현</span><h3 className="rv-title">{runId ? "이 실습에서 놓친 생각" : "이 풀이에서 놓친 생각"}</h3><span className="cs-gap" />
      {open.length ? <button className="btn small primary" onClick={() => setSession(open.sort((a, b) => a.layer - b.layer || a.dose - b.dose).map((g) => g.id))}>모두 확인하기</button> : null}</header>
    {busy ? <p className="small muted"><span className="lc2-caret" /> 풀이 기록에서 놓친 생각을 찾는 중이에요… (AI 1번)</p> : null}
    {err ? <p className="small bad">{err}</p> : null}
    {gaps && !gaps.length && !busy ? <div className="row small"><span className="muted">{runId ? "아직 없어요. 목표를 마치면 실습 정리에서 생겨요." : "아직 찾지 않았어요."}</span>{problemId ? <button className="btn small" onClick={() => void find()}>놓친 생각 찾기</button> : null}</div> : null}
    {gaps?.length ? <ol className="sc-gaplist">{gaps.map((g) => <li key={g.id} className={g.known || g.dismissed ? "known" : ""}>
      <div className="sc-gapline"><span className="sc-chip">{g.kind}</span><b>{g.title}</b><span className="cs-gap" /><Ladder g={g} /></div>
      <p className="small">{g.missed}{g.wrong ? <span className="muted"> · 그때: {g.wrong}</span> : null}</p>
      <div className="row small"><span className="muted">{SCOPE[g.scope]} · 세기 {g.dose}{g.target === "form" ? " · 표현" : ""}{g.doubtful ? " · 다시 볼 빈틈" : ""}{g.dismissed ? " · 아는 거라고 뺌" : ""}</span><span className="cs-gap" />
        {g.dismissed ? <button className="linkish small" onClick={() => void markGap(g, "undo")}>되돌리기</button>
          : !g.known ? <><button className="linkish small" title="뽑기가 틀렸어요: 이건 원래 알던 거예요. 복습에서 뺄게요." onClick={() => void markGap(g, "known")}>이건 아는 거였어요</button>
            <button className="btn small" onClick={() => setSession([g.id])}>확인하기</button></> : null}</div>
    </li>)}</ol> : null}
    {gaps?.length ? <p className="small muted">맞으면 한 칸 멀리(똑같이 → 비슷하게 → 응용), 틀리면 한 칸 가까이. 응용까지 통과하면 &lsquo;앎&rsquo;이에요. {problemId ? <button className="linkish small" disabled={busy} onClick={() => void find(true)}>다시 찾기</button> : null}</p> : null}
  </section>;
}

/** 오늘 탭: 갈래마다 한 줄 */
export function TodayScenes() {
  type Today = { gaps: GapLite[]; minutes: number; more: number; waiting: number; total: number; byBranch: Record<"algo" | "practice", { count: number; minutes: number }> };
  const [t, setT] = useState<Today | null>(null);
  const [session, setSession] = useState<string[] | null>(null);
  const load = useCallback(() => call<Today>("/api/scene/today").then(setT).catch(() => setT(null)), []);
  useEffect(() => { void load(); }, [load]);
  if (session) return <SceneSession gapIds={session} onClose={() => { setSession(null); void load(); }} />;
  if (!t || !t.total) return null;
  const line = (b: "algo" | "practice", label: string) => {
    const p = t.byBranch?.[b]; if (!p?.count) return null;
    const ids = t.gaps.filter((g) => g.branch === b).map((g) => g.id);
    return <div className="sc-today" key={b}>
      <div><b>{label}</b> <span className="small muted">확인 {p.count}개 · 약 {p.minutes}분</span>
        <p className="small muted">{[...new Set(t.gaps.filter((g) => g.branch === b).map((g) => g.origin.title))].slice(0, 3).join(" · ")}에서</p></div>
      <button className="btn small primary" onClick={() => setSession(ids)}>시작</button>
    </div>;
  };
  return <div className="sc-todays">
    {t.gaps.length ? <>{line("algo", "알고리즘")}{line("practice", "실습")}</> : <div className="sc-today"><div><b>상황 재현</b> <span className="small muted">오늘은 없어요 · 남은 빈틈 {t.total}개</span></div></div>}
    {t.more || t.waiting ? <p className="small muted">{t.more ? `내일로 ${t.more}개` : ""}{t.more && t.waiting ? " · " : ""}{t.waiting ? `아래층 빈틈을 먼저 통과하면 열리는 것 ${t.waiting}개` : ""}</p> : null}
  </div>;
}
