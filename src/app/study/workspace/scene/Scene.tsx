"use client";
// 상황 재현 복습 화면 (3번 판, 11/15, 설계 docs/상황재현_설계_v2(+gpt).md 7번):
//   GapList — 한 풀이에서 나온 빈틈과 지금 상태(똑같이 ✓ · 비슷하게 ✓ · 응용 ─), [확인하기]
//   SceneSession — 빈틈 여러 개를 장면 하나씩. 장면 카드의 틀은 형식이 달라도 같다:
//     위(거리에 따라 "그때 그대로예요" · "겪은 일과 비슷해요", 무슨 빈틈인지는 답한 뒤) · 가운데(형식별 몸통) · 아래([실행] [제출] [알맹이 보기] [모르겠어요]) · 답한 뒤(판정 · 맞는 생각 · 알맹이)
//   TodayScenes — 오늘 탭 한 줄: "상황 재현 · 확인 N개 · 약 M분"
import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { call, errorText } from "../api";
import "./scene.css";

export type GapLite = { id: string; title: string; kind: string; target: "ability" | "form"; missed: string; wrong: string; scope: string; dose: number; distance: "same" | "near" | "far";
  known: boolean; due: string; passes: number; sameMistakes: number; unclear: number; origin: { problemId: string; title: string; lang: string }; wrongVerified: boolean; doubtful: boolean };
type SceneLite = { id: string; gapId: string; format: "write" | "blank" | "predict" | "choice" | "fix"; lang: string; distance: GapLite["distance"]; story: string; ask: string;
  setup: string; after: string; template: string; code: string; inputs: string[]; failing: string[]; choices: string[]; minutes: number };
type Result = { verdict: "pass" | "same" | "other" | "unclear"; label: string; gaveUp: boolean; explain: string; kernel: string; wrong: string; other?: string;
  firstDiff?: { index: number; stdin: string; expected: string; got: string }; errors?: string[]; answerKey?: number; expected?: string; reference?: string; origin?: string; gap: GapLite; tutor: boolean };

const DIST: Record<GapLite["distance"], string> = { same: "똑같이", near: "비슷하게", far: "응용" };
const LADDER: GapLite["distance"][] = ["same", "near", "far"];
const SCOPE: Record<string, string> = { line: "한 줄", piece: "조각", function: "함수" };
const FORMAT: Record<SceneLite["format"], string> = { write: "직접 쓰기", blank: "빈칸 채우기", predict: "결과 맞히기", choice: "고르기", fix: "틀린 곳 고치기" };

/** 사다리 점: 지나온 거리는 ✓, 지금 거리는 ●, 남은 것은 ─ */
function Ladder({ g }: { g: Pick<GapLite, "distance" | "known"> }) {
  const at = LADDER.indexOf(g.distance);
  return <span className="sc-ladder" aria-label={`지금 ${DIST[g.distance]}`}>{LADDER.map((d, i) => <span key={d} className={g.known || i < at ? "ok" : i === at ? "now" : ""}>{DIST[d]} {g.known || i < at ? "✓" : i === at ? "●" : "─"}</span>)}</span>;
}

function CodeBox({ value, onChange, rows = 6, readOnly }: { value: string; onChange?: (v: string) => void; rows?: number; readOnly?: boolean }) {
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab" || !onChange) return;
    e.preventDefault();
    const t = e.currentTarget, s = t.selectionStart;
    onChange(`${value.slice(0, s)}    ${value.slice(t.selectionEnd)}`);
    requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 4; });
  };
  return readOnly ? <pre className="sc-code ro">{value}</pre>
    : <textarea className="sc-code" spellCheck={false} rows={Math.max(rows, value.split("\n").length + 1)} value={value} onChange={(e) => onChange?.(e.target.value)} onKeyDown={onKey} />;
}

function SceneCard({ gap, scene, onDone }: { gap: GapLite; scene: SceneLite; onDone: (r: Result) => void }) {
  const blanks = (scene.template.match(/_{3,}/g) ?? []).length;
  const [code, setCode] = useState(scene.format === "fix" ? scene.template : scene.format === "write" ? scene.template : "");
  const [fills, setFills] = useState<string[]>(Array.from({ length: blanks }, () => ""));
  const [text, setText] = useState("");
  const [pick, setPick] = useState<number | null>(null);
  const [hinted, setHinted] = useState(false);
  const [busy, setBusy] = useState("");
  const [runs, setRuns] = useState<Array<{ input: string; out?: string; error?: string }> | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState("");
  const answerText = scene.format === "blank" ? fills.join("\n") : scene.format === "predict" ? text : scene.format === "choice" ? String(pick ?? "") : code;
  const run = async () => { setBusy("run"); setErr(""); try { setRuns((await call<{ runs: typeof runs }>("/api/scene/run", { sceneId: scene.id, answer: answerText })).runs); } catch (e) { setErr(errorText(e)); } finally { setBusy(""); } };
  const submit = async (gaveUp = false) => {
    setBusy("answer"); setErr("");
    try { const r = await call<Result>("/api/scene/answer", { sceneId: scene.id, answer: gaveUp ? "" : answerText, hinted, gaveUp }); setRes(r); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(""); }
  };
  const ready = scene.format === "choice" ? pick !== null : scene.format === "blank" ? fills.every((f) => f.trim()) : scene.format === "predict" ? text.trim() !== "" : code.trim() !== "";
  // 빈칸: 틀 코드를 ____ 자리에서 나눠 입력 칸을 끼운다
  const parts = scene.template.split(/_{3,}/);
  return <article className="sc-card">
    <header className="sc-head">
      <span className="sc-chip">{gap.kind}</span><span className="sc-chip soft">{FORMAT[scene.format]} · {SCOPE[gap.scope] ?? gap.scope} · 약 {scene.minutes}분</span>
      <span className="cs-gap" /><Ladder g={gap} />
    </header>
    {/* 풀기 전에는 상황만(어느 문제의 일인지). 무슨 빈틈 · 그때 생각은 답한 뒤에 — 미리 보이면 그 생각을 스스로 꺼내는지 확인할 수 없다 */}
    {scene.distance !== "far" || res ? <p className="sc-then">{res ? <><b>{gap.title}</b>{gap.wrong ? <span className="muted"> — 그때 생각: {gap.wrong}</span> : null}</>
      : scene.distance === "same" ? `${gap.origin.title}에서 그때 그대로예요.` : `${gap.origin.title}에서 겪은 일과 비슷해요.`}</p> : null}
    {scene.story ? <p className="sc-story">{scene.story}</p> : null}
    {scene.ask ? <p className="sc-ask">{scene.ask}</p> : null}

    {scene.format === "choice" ? <div className="sc-choices">{scene.choices.map((c, i) => <button key={i} className={`sc-choice${pick === i ? " on" : ""}${res && res.answerKey === i ? " right" : ""}${res && pick === i && res.answerKey !== i ? " wrong" : ""}`}
      disabled={Boolean(res)} onClick={() => setPick(i)}><span className="sc-n">{i + 1}</span>{c}</button>)}</div> : null}
    {scene.format === "predict" ? <>
      <CodeBox value={scene.code} readOnly />
      {scene.inputs[0]?.trim() ? <div className="sc-io"><span className="muted small">입력</span><pre>{scene.inputs[0]}</pre></div> : null}
      <label className="sc-field"><span className="small muted">출력</span><textarea rows={2} className="sc-code" value={text} disabled={Boolean(res)} onChange={(e) => setText(e.target.value)} /></label>
    </> : null}
    {scene.format === "write" || scene.format === "blank" ? <div className="sc-prog">
      {scene.setup ? <CodeBox value={scene.setup} readOnly /> : null}
      {scene.format === "write" ? <CodeBox value={code} onChange={setCode} rows={3} />
        : <pre className="sc-code blanks">{parts.map((p, i) => <span key={i}>{p}{i < parts.length - 1 ? <input className="sc-blank" value={fills[i] ?? ""} size={Math.max(6, (fills[i] ?? "").length + 1)} disabled={Boolean(res)}
          onChange={(e) => setFills((f) => f.map((x, k) => (k === i ? e.target.value : x)))} aria-label={`빈칸 ${i + 1}`} /> : null}</span>)}</pre>}
      {scene.after ? <CodeBox value={scene.after} readOnly /> : null}
      {scene.inputs.length ? <details className="sc-io"><summary className="small">보이는 입력 {scene.inputs.length}개 (채점은 숨은 입력까지)</summary>{scene.inputs.map((x, i) => <pre key={i}>{x}</pre>)}</details> : null}
    </div> : null}
    {scene.format === "fix" ? <div className="sc-prog">
      {scene.failing[0] ? <div className="sc-io"><span className="muted small">이 입력에서 틀렸어요</span><pre>{scene.failing[0]}</pre></div> : null}
      <CodeBox value={code} onChange={setCode} rows={10} />
    </div> : null}

    {runs ? <div className="sc-runs">{runs.map((r, i) => <div key={i} className="sc-run"><span className="small muted">입력 {i + 1}의 출력</span><pre className={r.error ? "bad" : ""}>{r.error ?? r.out}</pre></div>)}</div> : null}
    {err ? <p className="small bad">{err}</p> : null}

    {!res ? <footer className="sc-foot">
      {scene.format !== "choice" && scene.format !== "predict" ? <button className="btn small" disabled={!!busy || !ready} onClick={() => void run()}>{busy === "run" ? "실행 중…" : "실행"}</button> : null}
      <button className="btn small primary" disabled={!!busy || !ready} onClick={() => void submit()}>{busy === "answer" ? "채점 중…" : "제출"}</button>
      <span className="cs-gap" />
      <button className="btn ghost small" disabled={hinted} title="맞는 생각 한 문장을 봐요. 보고 맞히면 '도움받고 넘어감'으로 쳐요." onClick={() => setHinted(true)}>힌트</button>
      <button className="btn ghost small" disabled={!!busy} onClick={() => void submit(true)}>모르겠어요</button>
    </footer> : null}
    {hinted && !res ? <p className="sc-hint">💡 {gap.missed}</p> : null}

    {res ? <section className={`sc-res v-${res.verdict}`}>
      <p className="sc-verdict">{res.gaveUp ? "괜찮아요. 이번엔 떠올리지 못한 것으로 남겨요." : res.verdict === "pass" ? (hinted ? "통과! 힌트를 봤으니 한 번 더 볼게요." : "통과!") : res.verdict === "same" ? "그때와 같은 실수예요." : res.verdict === "other" ? "이번엔 다른 데서 틀렸어요." : "틀렸어요. 왜인지는 아직 몰라요."}</p>
      {res.other ? <p className="small">이번 답은 이런 생각과 같아요: {res.other}</p> : null}
      {res.firstDiff && res.verdict !== "pass" ? <div className="sc-diff"><span className="small muted">처음 갈린 입력</span><pre>{res.firstDiff.stdin || "(없음)"}</pre>
        <div className="sc-diff2"><div><span className="small muted">정답</span><pre>{res.firstDiff.expected}</pre></div><div><span className="small muted">내 출력</span><pre className="bad">{res.firstDiff.got}</pre></div></div></div> : null}
      {res.expected !== undefined && res.verdict !== "pass" ? <div className="sc-io"><span className="small muted">실제 출력</span><pre>{res.expected}</pre></div> : null}
      {res.errors?.length && !res.firstDiff ? <pre className="sc-err">{res.errors[0]}</pre> : null}
      <div className="sc-truth"><span className="sc-lab">맞는 생각</span><p>{res.explain}</p>{res.kernel ? <CodeBox value={res.kernel} readOnly /> : null}</div>
      {res.origin ? <p className="sc-origin">{res.origin}</p> : null}
      <footer className="sc-foot"><span className="small muted">다음: {res.gap.known ? "이제 앎 — 가끔 섞어서만 다시 봐요" : `${DIST[res.gap.distance]}부터 · ${new Date(res.gap.due).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}`}{res.tutor ? " · 같은 실수가 두 번이에요. 튜터와 다시 보면 좋아요" : ""}</span>
        <span className="cs-gap" /><button className="btn small primary" onClick={() => onDone(res)}>다음</button></footer>
    </section> : null}
  </article>;
}

/** 빈틈 여러 개를 장면 하나씩. 장면은 필요할 때 만든다(똑같이는 AI 없이, 비슷하게 · 응용은 AI 1번). */
export function SceneSession({ gapIds, onClose }: { gapIds: string[]; onClose: (done: number) => void }) {
  const [at, setAt] = useState(0);
  const [cur, setCur] = useState<{ gap: GapLite; scene: SceneLite } | null>(null);
  const [err, setErr] = useState("");
  const [tally, setTally] = useState<Record<string, number>>({});
  const id = gapIds[at];
  useEffect(() => {
    if (!id) return;
    let alive = true;
    call<{ gap: GapLite; scene: SceneLite }>("/api/scene/next", { gapId: id }).then((r) => { if (alive) { setCur(r); setErr(""); } })
      .catch((e) => { if (alive) setErr(errorText(e)); });
    return () => { alive = false; };
  }, [id]);
  if (!id) return <section className="sc-session done"><p className="sc-verdict">오늘 확인 끝!</p>
    <p className="small muted">{Object.entries(tally).map(([k, n]) => `${({ pass: "통과", same: "같은 실수", other: "다른 실수", unclear: "미확정" } as Record<string, string>)[k]} ${n}`).join(" · ") || "확인한 것이 없어요."}</p>
    <button className="btn small" onClick={() => onClose(at)}>닫기</button></section>;
  return <section className="sc-session">
    <div className="sc-top"><span className="small muted">확인 {at + 1} / {gapIds.length}</span><span className="cs-gap" /><button className="btn ghost small" onClick={() => onClose(at)}>그만</button></div>
    {err ? <div className="sc-card"><p className="small bad">{err}</p><button className="btn small" onClick={() => { setCur(null); setAt((k) => k + 1); }}>건너뛰기</button></div>
      : cur && cur.gap.id === id ? <SceneCard key={cur.scene.id} gap={cur.gap} scene={cur.scene} onDone={(r) => { setTally((t) => ({ ...t, [r.verdict]: (t[r.verdict] ?? 0) + 1 })); setCur(null); setAt((k) => k + 1); }} />
      : <div className="sc-card sc-making"><span className="lc2-caret" /> 장면을 준비하는 중이에요…</div>}
  </section>;
}

/** 한 풀이의 빈틈 목록(풀이 노트 · 맞힌 뒤). 없으면 [놓친 생각 찾기](AI 1번). */
export function GapList({ problemId, auto = false }: { problemId: string; auto?: boolean }) {
  const [gaps, setGaps] = useState<GapLite[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [session, setSession] = useState<string[] | null>(null);
  const load = useCallback(() => call<{ gaps: GapLite[] }>(`/api/scene/gaps?problem=${encodeURIComponent(problemId)}`).then((r) => setGaps(r.gaps)).catch((e) => setErr(errorText(e))), [problemId]);
  const find = useCallback(async (force = false) => {
    setBusy(true); setErr("");
    try { setGaps((await call<{ gaps: GapLite[] }>("/api/scene/extract", { problemId, force })).gaps); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  }, [problemId]);
  useEffect(() => { let alive = true; void call<{ gaps: GapLite[] }>(`/api/scene/gaps?problem=${encodeURIComponent(problemId)}`).then((r) => {
    if (!alive) return; setGaps(r.gaps); if (!r.gaps.length && auto) void find(); }).catch((e) => alive && setErr(errorText(e))); return () => { alive = false; }; }, [problemId, auto, find]);
  if (session) return <SceneSession gapIds={session} onClose={() => { setSession(null); void load(); }} />;
  return <section className="sc-gaps">
    <header className="sc-gapshead"><span className="rv-eyebrow">상황 재현</span><h3 className="rv-title">이 풀이에서 놓친 생각</h3><span className="cs-gap" />
      {gaps?.some((g) => !g.known) ? <button className="btn small primary" onClick={() => setSession(gaps.filter((g) => !g.known).sort((a, b) => a.dose - b.dose).map((g) => g.id))}>모두 확인하기</button> : null}</header>
    {busy ? <p className="small muted"><span className="lc2-caret" /> 풀이 기록에서 놓친 생각을 찾는 중이에요… (AI 1번)</p> : null}
    {err ? <p className="small bad">{err}</p> : null}
    {gaps && !gaps.length && !busy ? <div className="row small"><span className="muted">아직 찾지 않았어요.</span><button className="btn small" onClick={() => void find()}>놓친 생각 찾기</button></div> : null}
    {gaps?.length ? <ol className="sc-gaplist">{gaps.map((g) => <li key={g.id} className={g.known ? "known" : ""}>
      <div className="sc-gapline"><span className="sc-chip">{g.kind}</span><b>{g.title}</b><span className="cs-gap" /><Ladder g={g} /></div>
      <p className="small">{g.missed}{g.wrong ? <span className="muted"> · 그때: {g.wrong}</span> : null}</p>
      <div className="row small"><span className="muted">{SCOPE[g.scope]} · 세기 {g.dose}{g.target === "form" ? " · 표현" : ""}{g.doubtful ? " · 다시 볼 빈틈" : ""}</span><span className="cs-gap" />
        {!g.known ? <button className="btn small" onClick={() => setSession([g.id])}>확인하기</button> : null}</div>
    </li>)}</ol> : null}
    {gaps?.length ? <p className="small muted">맞으면 한 칸 멀리(똑같이 → 비슷하게 → 응용), 틀리면 한 칸 가까이. 응용까지 통과하면 &lsquo;앎&rsquo;이에요. <button className="linkish small" disabled={busy} onClick={() => void find(true)}>다시 찾기</button></p> : null}
  </section>;
}

/** 오늘 탭 한 줄 */
export function TodayScenes() {
  const [t, setT] = useState<{ gaps: GapLite[]; minutes: number; more: number; total: number } | null>(null);
  const [session, setSession] = useState<string[] | null>(null);
  const load = useCallback(() => call<{ gaps: GapLite[]; minutes: number; more: number; total: number }>("/api/scene/today").then(setT).catch(() => setT(null)), []);
  useEffect(() => { void load(); }, [load]);
  if (session) return <SceneSession gapIds={session} onClose={() => { setSession(null); void load(); }} />;
  if (!t || !t.total) return null;
  return <div className="sc-today">
    <div><b>상황 재현</b> <span className="small muted">{t.gaps.length ? `확인 ${t.gaps.length}개 · 약 ${t.minutes}분${t.more ? ` · 내일로 ${t.more}개` : ""}` : `오늘은 없어요 · 남은 빈틈 ${t.total}개`}</span>
      {t.gaps.length ? <p className="small muted">{[...new Set(t.gaps.map((g) => g.origin.title))].slice(0, 3).join(" · ")}에서</p> : null}</div>
    {t.gaps.length ? <button className="btn small primary" onClick={() => setSession(t.gaps.map((g) => g.id))}>시작</button> : null}
  </div>;
}
