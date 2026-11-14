"use client";
// 상황 재현 · 실습 형식의 몸통 (설계 3번 13~17 · 12, 7번 화면). 장면 카드의 틀(위 · 아래 단추 · 답한 뒤)은 Scene.tsx가, 여기서는 가운데 몸통만.
//   13 어디에 넣을까: 코드 보기에서 줄 범위 고르기(처음 누른 줄 ~ 다음 누른 줄). 능력 확인이면 [다른 방법으로 고치기]로 그 줄들을 직접 바꿔도 된다.
//   14 시간 순서 표: ① 보여 준 순서의 마지막 값 ② 걸음을 눌러 한 번이 사라지는 순서 만들기(요청 안의 순서는 지켜야 함).
//   15 명령 한 줄: 작은 터미널 칸.  16 · 17: [편집기 열기] → 실습 서버가 장면 폴더(<데이터>/scenes/<id>/)를 앱 안 편집기로 연다(원래 실습 폴더는 안 건드림).
//   12 왜인지 한 줄: 실습 "다시 확인" 문항.
// 답은 글 하나로 onAnswer에 넘긴다(바뀔 때마다, 아직 덜 됐으면 ""). where · timeline · project · origin은 JSON 글.
import { useState } from "react";
import { call, errorText } from "../api";
import "./practice-scene.css";

type Step = { id: string; who: "A" | "B"; text: string };
type Range = { from: number; to: number };
export type PracticeSceneLite = { id: string; format: string; story?: string; ask?: string; practice?: Record<string, unknown> } & Record<string, unknown>;

/** 바닥이 practicePublic의 칸을 scene에 펼쳐 주든 scene.practice에 담아 주든 같게 읽는다 */
const fieldsOf = (scene: PracticeSceneLite) => ({ ...scene, ...((scene.practice ?? {}) as Record<string, unknown>) }) as Record<string, unknown>;

export function PracticeBody({ scene, disabled, onAnswer }: { scene: PracticeSceneLite; disabled: boolean; onAnswer: (answer: string) => void }) {
  const f = fieldsOf(scene);
  switch (scene.format) {
    case "where": return <WhereBody id={scene.id} code={String(f.code ?? "")} region={f.region as Range} wrap={f.wrap as { before: string; after: string }} allowCode={Boolean(f.allowCode)}
      inputs={(f.inputs as string[] | undefined) ?? []} disabled={disabled} onAnswer={onAnswer} />;
    case "timeline": return <TimelineBody name={String(f.name ?? "")} unit={String(f.unit ?? "")} init={Number(f.init ?? 0)} shown={(f.shown as Step[]) ?? []} steps={(f.steps as Step[]) ?? []} disabled={disabled} onAnswer={onAnswer} />;
    case "command": return <CommandBody task={String(f.task ?? "")} files={(f.files as string[]) ?? []} disabled={disabled} onAnswer={onAnswer} />;
    case "project": case "origin": return <EditorBody id={scene.id} kind={scene.format} files={(f.files as string[]) ?? []} run={String(f.run ?? "")} file={String(f.file ?? "")} from={Number(f.from ?? 0)} to={Number(f.to ?? 0)} disabled={disabled} onAnswer={onAnswer} />;
    case "why": return <WhyBody question={String(f.question ?? scene.ask ?? "")} disabled={disabled} onAnswer={onAnswer} />;
    default: return null;
  }
}

/* ---------- 13 어디에 넣을까 ---------- */
function WhereBody({ code, region, wrap, allowCode, inputs, disabled, onAnswer }: { id: string; code: string; region: Range; wrap: { before: string; after: string }; allowCode: boolean; inputs: string[]; disabled: boolean; onAnswer: (a: string) => void }) {
  const lines = code.split("\n");
  const [start, setStart] = useState<number | null>(null);
  const [pick, setPick] = useState<Range | null>(null);
  const [mode, setMode] = useState<"range" | "code">("range");
  const [alt, setAlt] = useState(() => lines.slice(region.from - 1, region.to).join("\n"));
  const inRegion = (n: number) => n >= region.from && n <= region.to;
  const click = (n: number) => {
    if (disabled || !inRegion(n) || mode !== "range") return;
    if (start === null) { setStart(n); setPick({ from: n, to: n }); onAnswer(JSON.stringify({ from: n, to: n })); return; }
    const r = { from: Math.min(start, n), to: Math.max(start, n) };
    setPick(r); setStart(null); onAnswer(JSON.stringify(r));
  };
  const on = (n: number) => !!pick && n >= pick.from && n <= pick.to;
  return <div className="sc-prog">
    <p className="small muted">{region.from}~{region.to}줄 안에서 넣을 범위의 첫 줄과 끝 줄을 차례로 눌러요. 고른 줄은 <code>{wrap.before}</code>{wrap.after ? <> … <code>{wrap.after}</code></> : null} 안으로 들어가요.</p>
    <div className="ps-code" role="listbox" aria-label="줄 고르기">
      {lines.map((l, i) => {
        const n = i + 1;
        return <div key={n}>
          {pick && n === pick.from && mode === "range" ? <div className="ps-line wrap"><span className="ps-no" />{wrap.before}</div> : null}
          <div className={`ps-line${inRegion(n) && mode === "range" ? " pick" : " out"}${on(n) && mode === "range" ? " on" : ""}`} onClick={() => click(n)} role="option" aria-selected={on(n)}>
            <span className="ps-no">{n}</span>{l || " "}</div>
          {pick && n === pick.to && wrap.after && mode === "range" ? <div className="ps-line wrap"><span className="ps-no" />{wrap.after}</div> : null}
        </div>;
      })}
    </div>
    <div className="ps-row small">
      {pick && mode === "range" ? <span>고른 범위: {pick.from}~{pick.to}줄{start !== null ? " (끝 줄을 누르면 넓어져요)" : ""}</span> : <span className="muted">아직 안 골랐어요.</span>}
      <span className="cs-gap" />
      {allowCode ? <button className="btn ghost small" disabled={disabled} onClick={() => { const m = mode === "range" ? "code" : "range"; setMode(m); onAnswer(m === "code" ? JSON.stringify({ code: alt }) : pick ? JSON.stringify(pick) : ""); }}>
        {mode === "range" ? "다른 방법으로 고치기" : "줄 범위로 고르기"}</button> : null}
    </div>
    {mode === "code" ? <label className="sc-field"><span className="small muted">{region.from}~{region.to}줄을 이렇게 바꿔요</span>
      <textarea className="sc-code" spellCheck={false} rows={Math.max(4, alt.split("\n").length + 1)} value={alt} disabled={disabled}
        onChange={(e) => { setAlt(e.target.value); onAnswer(e.target.value.trim() ? JSON.stringify({ code: e.target.value }) : ""); }} /></label> : null}
    {inputs.length ? <p className="small muted">보이는 입력: {inputs.join(" · ")} (채점은 숨은 입력까지)</p> : null}
  </div>;
}

/* ---------- 14 시간 순서 표 ---------- */
/** 걸음 표: 위에서 아래로 시간, 왼쪽 A · 오른쪽 B */
function Table({ ids }: { ids: Step[] }) {
  return <div className="ps-tl"><span className="ps-h">때</span><span className="ps-h">요청 A</span><span className="ps-h">요청 B</span>
    {ids.map((s, i) => <span key={s.id} style={{ display: "contents" }}><span className="ps-t">{i + 1}</span>{s.who === "A" ? <><span className="ps-step A">{s.text}</span><span /></> : <><span /><span className="ps-step B">{s.text}</span></>}</span>)}</div>;
}
function TimelineBody({ name, unit, init, shown, steps, disabled, onAnswer }: { name: string; unit: string; init: number; shown: Step[]; steps: Step[]; disabled: boolean; onAnswer: (a: string) => void }) {
  const [final, setFinal] = useState("");
  const [order, setOrder] = useState<string[]>([]);
  const emit = (fv: string, o: string[]) => onAnswer(fv.trim() && o.length === steps.length ? JSON.stringify({ final: fv.trim(), order: o }) : "");
  const byId = new Map(steps.map((s) => [s.id, s]));
  const setO = (o: string[]) => { setOrder(o); emit(final, o); };
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= order.length) return; const o = [...order]; [o[i], o[j]] = [o[j], o[i]]; setO(o); };
  return <div className="sc-prog">
    <p className="small muted">처음 {name} = {init}{unit}. 걸음은 위에서 아래로 일어나요.</p>
    <div className="ps-box"><b className="small">① 이 순서대로 돌면 마지막 {name}는?</b><Table ids={shown} />
      <label className="ps-row small">마지막 {name} = <input className="sc-blank" inputMode="numeric" size={8} value={final} disabled={disabled} onChange={(e) => { setFinal(e.target.value); emit(e.target.value, order); }} aria-label="마지막 값" />{unit}</label></div>
    <div className="ps-box"><b className="small">② 한 요청의 변화가 사라지는 순서를 만들어 보세요</b>
      <p className="small muted">걸음을 누르면 아래 순서 끝에 붙어요. 같은 요청의 걸음은 번호 순서대로여야 해요.</p>
      <div className="ps-pool">{steps.map((s) => <button key={s.id} className={`ps-step ${s.who}`} disabled={disabled || order.includes(s.id)} onClick={() => setO([...order, s.id])}>{s.text}</button>)}</div>
      {order.length ? <ol className="ps-order">{order.map((id, i) => { const s = byId.get(id)!; return <li key={id}><span className="ps-t small">{i + 1}</span>
        {s.who === "A" ? <><span className="ps-step A">{s.text}</span><span /></> : <><span /><span className="ps-step B">{s.text}</span></>}
        <span className="ps-row"><button className="btn ghost small" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label="위로">↑</button>
          <button className="btn ghost small" disabled={disabled || i === order.length - 1} onClick={() => move(i, 1)} aria-label="아래로">↓</button>
          <button className="btn ghost small" disabled={disabled} onClick={() => setO(order.filter((x) => x !== id))} aria-label="빼기">×</button></span></li>; })}</ol> : null}
      {order.length ? <button className="btn ghost small" disabled={disabled} onClick={() => setO([])}>처음부터</button> : null}
    </div>
  </div>;
}

/* ---------- 15 명령 한 줄 ---------- */
function CommandBody({ task, files, disabled, onAnswer }: { task: string; files: string[]; disabled: boolean; onAnswer: (a: string) => void }) {
  const [cmd, setCmd] = useState("");
  return <div className="sc-prog">
    {task ? <p className="small muted">할 일: {task}</p> : null}
    {files.length ? <p className="ps-files">예제 폴더: {files.join(" · ")}</p> : null}
    <label className="ps-term"><span aria-hidden>$</span><input spellCheck={false} autoComplete="off" value={cmd} disabled={disabled} placeholder="명령 한 줄" aria-label="명령"
      onChange={(e) => { setCmd(e.target.value); onAnswer(e.target.value.trim()); }} /></label>
  </div>;
}

/* ---------- 16 작은 재현 프로젝트 · 17 원래 자리로 ---------- */
function EditorBody({ id, kind, files, run, file, from, to, disabled, onAnswer }: { id: string; kind: string; files: string[]; run: string; file: string; from: number; to: number; disabled: boolean; onAnswer: (a: string) => void }) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [opened, setOpened] = useState(false);
  const [tried, setTried] = useState<{ ok: boolean | null; out: string } | null>(null);
  const open = async () => {
    setBusy("open"); setMsg("");
    try {
      const r = await call<{ studio: string; folder: string }>(`/api/project-course/scene/${id}/open`, {});
      const w = window.open(r.studio, `recaller-scene-${id}`);
      setOpened(true);
      setMsg(w ? `편집기를 새 창으로 열었어요. 폴더: ${r.folder}` : `창이 막혔어요. 이 주소를 여세요: ${r.studio}`);
    } catch (e) { setMsg(errorText(e)); } finally { setBusy(""); }
  };
  const tryIt = async () => {
    setBusy("try");
    try { setTried(await call<{ ok: boolean | null; out: string }>(`/api/project-course/scene/${id}/try`, {})); } catch (e) { setTried({ ok: false, out: errorText(e) }); } finally { setBusy(""); }
  };
  return <div className="sc-prog">
    <div className="ps-box">
      <p className="small">{kind === "project" ? "작은 프로젝트를 앱 안 편집기에서 열어 고치고, 검사가 통과하면 [제출]을 눌러요." : `그때 파일을 새 폴더에 되살렸어요. ${file} ${from}~${to}줄 근처를 고친 뒤 [제출]을 눌러요.`}</p>
      {files.length ? <p className="ps-files">{files.slice(0, 8).join(" · ")}{files.length > 8 ? ` 외 ${files.length - 8}개` : ""}</p> : null}
      {kind === "project" && run ? <p className="small muted">실행: <code>{run}</code> · 검사: <code>node check.mjs</code></p> : null}
      <div className="ps-row">
        <button className="btn small primary" disabled={disabled || !!busy} onClick={() => void open()}>{busy === "open" ? "여는 중…" : opened ? "편집기 다시 열기" : "편집기 열기"}</button>
        {kind === "project" ? <button className="btn small" disabled={disabled || !!busy} onClick={() => void tryIt()}>{busy === "try" ? "검사 중…" : "검사 돌려 보기"}</button> : null}
        <label className="ps-row small"><input type="checkbox" disabled={disabled} onChange={(e) => onAnswer(e.target.checked ? JSON.stringify({ done: true }) : "")} /> 다 고쳤어요</label>
      </div>
      {msg ? <p className="small muted" style={{ wordBreak: "break-all" }}>{msg}</p> : null}
      {tried ? <pre className={`sc-err${tried.ok ? "" : " bad"}`} style={tried.ok ? { color: "var(--good)" } : undefined}>{tried.ok === true ? "✓ 통과\n" : tried.ok === false ? "✗ 아직 실패\n" : ""}{tried.out}</pre> : null}
    </div>
  </div>;
}

/* ---------- 12 왜인지 한 줄 ---------- */
function WhyBody({ question, disabled, onAnswer }: { question: string; disabled: boolean; onAnswer: (a: string) => void }) {
  const [text, setText] = useState("");
  return <div className="sc-prog">
    {question ? <p className="sc-story">{question}</p> : null}
    <textarea className="sc-code" rows={3} style={{ whiteSpace: "pre-wrap" }} value={text} disabled={disabled} placeholder="한두 문장으로" onChange={(e) => { setText(e.target.value); onAnswer(e.target.value.trim()); }} />
  </div>;
}
