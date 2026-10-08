"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Circle, LoaderCircle, TriangleAlert, X, Plus, Copy, ChevronLeft, ChevronRight, FlaskConical, RefreshCw } from "lucide-react";
import type { LabRun, LabRunSummary } from "@/lib/study/lab-store";
import type { LabConfig, CallRecord } from "@/lib/study/lab-contract";
import { arr, obj, str, refs, resultNodes, lineDiff, stageGridColumns } from "./lab-view";
import "./lab.css";
import LabPdf from "./LabPdf";
type Stage = {
    key: string;
    label: string;
};
type Source = {
    id: string;
    fileName: string;
    pageCount: number;
    available: boolean;
};
const MODELS = ["gpt-6-sol", "gpt-6-astra", "gpt-6-luna"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"];
const ABILITIES = ["용어·정의 말하기", "식·절차 쓰기", "계산·적용하기", "비슷한 것 구별하기", "말로 설명하기"];
const STATUS: Record<string, string> = { queued: "진행 중", running: "진행 중", "paused-step": "멈춤(단계 확인)", "paused-usage-limit": "멈춤(한도)", "paused-login": "멈춤(로그인)", "paused-invalid": "멈춤(검사)", interrupted: "멈춤(서버)", done: "완료", failed: "실패" };
const fmt = (ms: number) => ms >= 60000 ? `${Math.floor(ms / 60000)}분 ${Math.round(ms % 60000 / 1000)}초` : `${Math.round(ms / 1000)}초`;
const color = (status: string) => status === "done" ? "ok" : status === "failed" ? "bad" : status.startsWith("paused") || status === "interrupted" ? "warn" : "run";
async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
    const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    const data = await r.json();
    if (!r.ok)
        throw new Error(data.message || data.error || "요청에 실패했어요.");
    return data as T;
}
function Json({ value, label = "산출물" }: {
    value: unknown;
    label?: string;
}) {
    const text = JSON.stringify(value, null, 2);
    return <details className="block"><summary>{label}<button className="icon" title="복사" aria-label="JSON 복사" onClick={e => { e.preventDefault(); void navigator.clipboard.writeText(text); }}><Copy size={14}/></button></summary><pre>{text}</pre></details>;
}
function PageBadge({ pages, open }: {
    pages: number[];
    open: (n: number) => void;
}) {
    return pages.length ? <button className="pg" onClick={() => open(pages[0])}>p.{pages.join(", ")}</button> : <span className="badge b-warn">쪽 없음</span>;
}
function StageResult({ stage, output, run, open }: {
    stage: string;
    output: unknown;
    run: LabRun;
    open: (n: number) => void;
}) {
    const o = obj(output), nodes = resultNodes(stage, output);
    if (stage === "analyze" || stage === "concept-tree")
        return <ul className="tree">{nodes.map((n, i) => {
                const depth = (id: unknown, seen = new Set<unknown>()): number => { if (!id || seen.has(id))
                    return 0; seen.add(id); const parent = nodes.find(v => v.id === id); return parent ? 1 + depth(parent.parentId, seen) : 0; };
                return <li key={str(n.id) || i} style={{ paddingLeft: depth(n.parentId) * 18 }}><span><b>{str(n.title || n.label || n.name)}</b>{Boolean(n.outlineNodeIds) && <small> 목차 {str(n.outlineNodeIds)}</small>}</span><PageBadge pages={refs(n)} open={open}/></li>;
            })}</ul>;
    if (stage === "learning-design") {
        const design = obj(o.learningDesign), units = arr(design.knowledgeUnits), objectives = arr(design.objectives);
        return <>{objectives.map((goal, i) => <article className="obj" key={str(goal.id)}><h4><span className="muted">목표 {i + 1}</span>{str(goal.target)}</h4>{units.filter(u => u.objectiveId === goal.id).map(unit => {
                    const page = Number(unit.sourcePage), checks = arr(o.sourceEvidenceChecks).filter(c => c.knowledgeUnitId === unit.id || c.learningUnitId === unit.id);
                    return <dl className="kv" key={str(unit.id)}><dt>학습내용</dt><dd>{str(unit.content)}</dd><dt>성공기준</dt><dd>{arr(goal.successCriteria).map(c => str(c.description)).join(" / ")}</dd><dt>근거</dt><dd><blockquote>{str(unit.sourceText)}{page > 0 && <button className="pg" onClick={() => open(page)}>p.{page}에서 보기</button>}</blockquote></dd><dt>쪽</dt><dd><PageBadge pages={page > 0 ? [page] : []} open={open}/> · 개념 {str(unit.conceptNodeIds)}</dd><dt>원문 확인</dt><dd>{checks.length ? checks.map((c, j) => <span key={j} className={`badge b-${str(c.status) === "원문 확인" ? "ok" : "warn"}`}>{str(c.status || c.message)}</span>) : <span className="muted">검사 기록 없음</span>}</dd><dt>종류·중요도</dt><dd>{str(unit.kind || unit.knowledgeType)} · {str(goal.importance)}</dd></dl>;
                })}</article>)}</>;
    }
    if (stage === "activity-design") {
        const design = obj(o.learningDesign), activities = arr(o.activities);
        return <div className="table-scroll"><table><thead><tr>{["목표", "보여줄 것", "감출 것", "응답", "채점", "문제방식", "이유"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{arr(design.assessmentBlueprints).map(b => <tr key={str(b.id)}><td>{str(arr(design.objectives).find(v => v.id === b.objectiveId)?.target || b.objectiveId)}</td><td>{arr(b.given).map(v => str(v.description)).join(" / ")}</td><td>{arr(b.hidden).map(v => str(v.description)).join(" / ")}</td><td>{str(obj(b.expectedResponse).kind)}</td><td>{arr(b.scoringRubric).map(v => str(v.gradingMode)).join(", ")}</td><td>{str(activities.find(v => v.blueprintId === b.id)?.recommendedType)}</td><td>{str(activities.find(v => v.blueprintId === b.id)?.reason)}</td></tr>)}</tbody></table></div>;
    }
    if (stage === "cards")
        return <>{arr(o.cards).map((c, i) => <article className="card" key={str(c.id) || i}><span className="badge b-gray">{str(c.type)}</span><p>{str(c.front || c.clozeText)}</p><div className="answer">정답 · {str(c.back || c.answer)}</div><small>{str(c.explanation)}</small></article>)}</>;
    if (stage === "authoring")
        return run.authoring ? <><iframe title="출제 문서" sandbox="allow-scripts" srcDoc={run.authoring.html} className="document"/>{arr(run.authoring.issues).map((issue, i) => <div className={`warnline ${issue.severity === "error" ? "errline" : ""}`} key={i}>{str(issue.questionId)} · {str(issue.message || issue.code)}</div>)}</> : <p className="muted">아직 출제 문서가 없어요.</p>;
    return <Json value={output}/>;
}
export default function Lab() {
    const [runs, setRuns] = useState<LabRunSummary[]>([]), [selected, setSelected] = useState(""), [run, setRun] = useState<LabRun | null>(null);
    const [stages, setStages] = useState<Stage[]>([]), [stage, setStage] = useState("analyze"), [tab, setTab] = useState("result");
    const [sources, setSources] = useState<Source[]>([]), [real, setReal] = useState(false), [modal, setModal] = useState(false), [error, setError] = useState("");
    const [busy, setBusy] = useState(false), [now, setNow] = useState(0), [pdf, setPdf] = useState<number | null>(null);
    const [call, setCall] = useState<CallRecord | null>(null), [callList, setCallList] = useState<CallRecord[]>([]), [confirm, setConfirm] = useState<(() => Promise<void>) | null>(null);
    const [connected, setConnected] = useState(false), [purpose, setPurpose] = useState("BFS의 개념과 방문 순서를 떠올릴 수 있게"), [sourceId, setSourceId] = useState("");
    const [start, setStart] = useState(1), [end, setEnd] = useState(1), [abilities, setAbilities] = useState(["말로 설명하기"]), [note, setNote] = useState("");
    const [stepMode, setStepMode] = useState(true), [scenario, setScenario] = useState("success"), [models, setModels] = useState<LabConfig["stages"]>({});
    const [allModel, setAllModel] = useState("gpt-6-luna"), [allEffort, setAllEffort] = useState("low");
    const fileInput = useRef<HTMLInputElement>(null);
    const refresh = useCallback(async () => {
        try {
            const data = await api<{
                runs: LabRunSummary[];
            }>("/api/lab/runs");
            setRuns(data.runs);
            if (selected)
                setRun(await api<LabRun>(`/api/lab/runs/${selected}`));
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    }, [selected]);
    useEffect(() => { const initial = setTimeout(() => { void refresh(); }, 0); const t = setInterval(() => { void refresh(); }, 2000); return () => { clearTimeout(initial); clearInterval(t); }; }, [refresh]);
    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
    useEffect(() => {
        void Promise.all([api<{
                stages: Stage[];
            }>("/api/lab/stages"), api<{
                sources: Source[];
            }>("/api/mcp-runs/sources"), api<{
                model: {
                    ready: boolean;
                };
            }>("/api/study-executor")]).then(([s, f, c]) => {
            setStages(s.stages);
            setSources(f.sources.filter(v => v.available));
            setConnected(c.model.ready);
            setSourceId((f.sources.find(v => v.available && v.fileName === "cornell-bfs-2pages.pdf") || f.sources.find(v => v.available))?.id || "");
            setModels(Object.fromEntries(s.stages.map(v => [v.key, { model: "gpt-6-luna", effort: "low" }])));
        }).catch(e => setError(e.message));
    }, []);
    useEffect(() => {
        if (!run || tab === "result" || tab === "json")
            return;
        let active = true;
        const list = run.calls.filter(c => c.purpose.split(":")[0] === "authoring" ? stage === "authoring" : c.purpose === `stage:${stage}`);
        void Promise.all(list.map(c => api<CallRecord>(`/api/lab/runs/${run.request.id}/calls/${c.n}`))).then(c => { if (active) {
            setCallList(c);
            setCall(current => c.find(v => v.n === current?.n) || c.at(-1) || null);
        } }).catch(e => setError(e.message));
        return () => { active = false; };
    }, [run, stage, tab]);
    async function action(fn: () => Promise<void>) { setBusy(true); setError(""); try {
        await fn();
        await refresh();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : String(e));
    }
    finally {
        setBusy(false);
    } }
    function paid(fn: () => Promise<void>, provider: string) { if (provider === "chatgpt")
        setConfirm(() => fn);
    else
        void action(fn); }
    function setSetting(key: string, field: "model" | "effort", value: string) { setModels(m => ({ ...m, [key]: { ...(m[key as keyof typeof m] || { model: "gpt-6-luna", effort: "low" }), [field]: value } } as LabConfig["stages"])); }
    async function create() {
        const b = { sourceId, startPage: start, endPage: end, purpose, abilities, confirmed: true, lab: { provider: real ? "chatgpt" : "fake", stepMode, stages: models, note, scenario } };
        const result = await api<{
            request: {
                id: string;
            };
        }>("/api/lab/runs", "POST", b);
        setSelected(result.request.id);
        setStage(stages[0]?.key || "analyze");
        setRun(null);
        setModal(false);
    }
    async function login() { const b = await api<{
        url: string;
    }>("/api/auth/chatgpt/start", "POST", {}); window.location.assign(b.url); }
    const visibleStages = run?.stages || stages;
    const output = run?.request.stages.find(v => v.stage === stage)?.output;
    const calls = run?.calls.filter(c => stage === "authoring" ? c.purpose.startsWith("authoring") : c.purpose === `stage:${stage}`) || [];
    const nodes = resultNodes(stage, output), design = obj(obj(output).learningDesign), goals = arr(design.objectives), units = arr(design.knowledgeUnits);
    const pageCount = run?.request.input.scope.pageNumbers.length || 0;
    const warnings: string[] = [];
    if (goals.length && pageCount / goals.length > 8)
        warnings.push(`쪽 수 ÷ 목표 수 = ${(pageCount / goals.length).toFixed(1)} (기준 8)`);
    if (nodes.length) {
        const missing = nodes.filter(n => !refs(n).length).length;
        if (missing)
            warnings.push(`쪽 근거 없음 ${missing}`);
        if (stage === "analyze") {
            const covered = new Set(nodes.flatMap(refs));
            const gaps = run?.request.input.scope.pageNumbers.filter(p => !covered.has(p)) || [];
            if (gaps.length)
                warnings.push(`목차에 없는 쪽 p.${gaps.join(", ")}`);
        }
    }
    if (units.some(u => Number(u.sourcePage) <= 0))
        warnings.push(`쪽 근거 없음 ${units.filter(u => Number(u.sourcePage) <= 0).length}`);
    const cuts = [...new Set(calls.flatMap(c => c.input.pagesCut))];
    if (cuts.length)
        warnings.push(`원문 잘림 p.${cuts.join(", ")}`);
    if (calls.length > 1)
        warnings.push(`재시도 ${calls.length - 1}`);
    if (calls.some(c => c.error))
        warnings.push("검사·형식 오류 기록 있음");
    if (calls.some(c => /실제 문구와 일치하지/.test(c.error || ""))) warnings.push("원문 인용 불일치");
    if (stage === "authoring") {
      const issues=arr(run?.authoring?.issues);
      if(issues.length) warnings.push(`출제 검사 오류 ${issues.filter(i=>i.severity==="error").length} · 경고 ${issues.filter(i=>i.severity==="warning").length}`);
    }
    const total = run?.calls.reduce((n, c) => n + c.ms, 0) || 0;
    const nextStage = visibleStages.find(s => s.key === "authoring" ? run?.executor.phase === "authoring" : !run?.request.stages.some(v => v.stage === s.key));
    const paused = run && !['running', 'queued', 'done', 'failed'].includes(run.executor.status);
    return <div className={`lab ${pdf ? "with-pdf" : ""}`}><header className="top"><FlaskConical size={18}/><h1>생성 실험실</h1><span className="sp"/><button className="connection" onClick={() => void action(login)}><span className={`dot ${connected ? "" : "off"}`}/>{connected ? "ChatGPT 연결됨" : "ChatGPT 연결"}</button><div className="seg"><button aria-pressed={!real} onClick={() => setReal(false)}>가짜 모델</button><button aria-pressed={real} onClick={() => setReal(true)}>실제 모델</button></div></header>
    {error && <div role="alert" className="warnline errline">{error}<button className="icon" aria-label="오류 닫기" onClick={() => setError("")}><X size={16}/></button></div>}
    {!real && !sources.some(s => s.fileName === "cornell-bfs-2pages.pdf") && <div className="fixture"><button className="btn small" disabled={busy} onClick={() => void action(async () => { const d = await api<{
        source: Source;
    }>("/api/lab/fixture", "POST", {}); setSources(s => [...s, { ...d.source, available: true }]); setSourceId(d.source.id); setStart(1); setEnd(1); })}>가짜 모델용 예제 PDF 등록</button></div>}
    <div className="layout"><aside className="side"><button className="btn block" onClick={() => setModal(true)}><Plus size={16}/>새 실행</button><div className="runs">{runs.map(r => <button className="run" key={r.request.id} aria-current={selected === r.request.id} onClick={() => { setSelected(r.request.id); setRun(null); setPdf(null); }}><b>{r.request.sourceSnapshot?.fileName}</b><span className="m">p.{r.request.input.scope.pageNumbers[0]}–{r.request.input.scope.pageNumbers.at(-1)} <span className={`badge b-${color(r.executor.status)}`}>{STATUS[r.executor.status]}</span>{r.executor.lab?.provider === "fake" && <span className="fake">가짜</span>}</span><small>{[...new Set(r.executor.timings?.map(t => `${t.model.replace("gpt-6-", "")}·${t.effort}`))].join(" / ") || "대기"} · {fmt(r.executor.timings?.reduce((n, t) => n + t.ms, 0) || 0)}</small><small>{new Date(r.request.createdAt).toLocaleString("ko-KR")}</small><span className="memo">{r.executor.lab?.note}</span></button>)}</div></aside>
      <main className="main">{!run ? <div className="empty"><FlaskConical size={32}/><h2>{selected ? "실행 기록 불러오는 중" : "실행을 골라 주세요"}</h2><button className="btn primary" onClick={() => setModal(true)}>새 실행</button></div> : <>
        <div className="head"><h2>{run.request.sourceSnapshot?.fileName}</h2><div className="facts"><span>p.{run.request.input.scope.pageNumbers[0]}–{run.request.input.scope.pageNumbers.at(-1)}</span><span className="num">{fmt(total)} · 호출 {run.executor.calls}회</span><span className={`badge b-${color(run.executor.status)}`}>{STATUS[run.executor.status]}</span></div></div><p className="purpose">{run.request.input.purpose}</p>
        <div className="memoline"><label htmlFor="memo">메모</label><input id="memo" key={run.request.id} defaultValue={run.executor.lab?.note} disabled={!paused} onBlur={e => { if (paused && e.target.value !== run.executor.lab?.note)
            void action(async () => { await api(`/api/lab/runs/${selected}`, "PATCH", { ...run.executor.lab, note: e.target.value }); }); }}/>{paused && <label><input type="checkbox" checked={run.executor.lab!.stepMode} onChange={e => void action(async () => { await api(`/api/lab/runs/${selected}`, "PATCH", { ...run.executor.lab, stepMode: e.target.checked }); })}/> 한 단계씩</label>}</div>
        {run.executor.message && <p className={`warnline ${run.executor.status === "failed" ? "errline" : ""}`}>{run.executor.message}</p>}
        <section className="pipe"><div className="stages" style={{ gridTemplateColumns: stageGridColumns(visibleStages) }}>{visibleStages.map((s, i) => {
                const cs = run.calls.filter(c => s.key === "authoring" ? c.purpose.startsWith("authoring") : c.purpose === `stage:${s.key}`), done = run.request.stages.some(v => v.stage === s.key) || (s.key === "authoring" && run.executor.status === "done"), active = run.executor.stage === s.key;
                const status = done ? cs.some(c => !c.ok) ? "warn" : "ok" : active ? color(run.executor.status) : "gray", ms = cs.reduce((n, c) => n + c.ms, 0) + (active && run.executor.status === "running" && cs.at(-1)?.ms === 0 ? Math.max(0, now - Date.parse(cs.at(-1)!.startedAt)) : 0);
                const Icon = done ? status === "warn" ? TriangleAlert : Check : active && run.executor.status === "running" ? LoaderCircle : active && paused ? TriangleAlert : Circle;
                return <div className={`stage s-${status}`} key={s.key}><button className="stage-button" aria-pressed={stage === s.key} onClick={() => { setStage(s.key); setCall(null); setCallList([]); }}><span className="name"><Icon size={15}/>{i + 1} {s.label}</span><span className="time num">{cs.length ? fmt(ms) : "대기"}</span><span className="model">{cs.at(-1)?.model || run.executor.lab?.stages[s.key as keyof LabConfig["stages"]]?.model || "—"} · {cs.at(-1)?.effort || ""}</span>{cs.length > 1 && <span className="retry"><RefreshCw size={11}/>{cs.length - 1}</span>}</button>
            {paused && nextStage?.key === s.key && <div className="next"><select aria-label={`${s.label} 다음 모델`} value={run.executor.lab!.stages[s.key as keyof LabConfig["stages"]]?.model || "gpt-6-sol"} onChange={e => void action(async () => { await api(`/api/lab/runs/${selected}`, "PATCH", { ...run.executor.lab, stages: { ...run.executor.lab!.stages, [s.key]: { ...run.executor.lab!.stages[s.key as keyof LabConfig["stages"]], model: e.target.value } } }); })}>{MODELS.map(m => <option key={m}>{m}</option>)}</select><select aria-label={`${s.label} 다음 추론 강도`} value={run.executor.lab!.stages[s.key as keyof LabConfig["stages"]]?.effort || "low"} onChange={e => void action(async () => { await api(`/api/lab/runs/${selected}`, "PATCH", { ...run.executor.lab, stages: { ...run.executor.lab!.stages, [s.key]: { ...run.executor.lab!.stages[s.key as keyof LabConfig["stages"]], effort: e.target.value } } }); })}>{EFFORTS.map(e => <option key={e}>{e}</option>)}</select><button className="btn primary small" disabled={busy} onClick={() => paid(async () => { await api(`/api/lab/runs/${selected}/continue`, "POST", { confirmed: true }); }, run.executor.lab!.provider)}>다음 단계 실행</button></div>}
          </div>;
            })}</div><div className="bar">{visibleStages.map(s => <i key={s.key} style={{ flex: run.calls.filter(c => c.purpose === `stage:${s.key}` || s.key === "authoring" && c.purpose.startsWith("authoring")).reduce((n, c) => n + c.ms, 0) || 0, background: s.key === stage ? "var(--accent)" : "var(--good)" }}/>)}</div><div className="barlegend">단계별 시간 비중 <span>{fmt(total)}</span></div></section>
        <section className="detail"><div className="dhead"><h3>{visibleStages.find(s => s.key === stage)?.label || stage}</h3><div className="tabs" role="tablist">{[["result", "결과"], ["input", "보낸 입력"], ["retry", "검사·재시도"], ["json", "원본 JSON"]].map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>)}</div></div><div className="summary">{goals.length > 0 && <span className="badge b-gray">목표 {goals.length}개 · 범위 {pageCount}쪽</span>}{warnings.map(w => <span className="badge b-warn" key={w}>{w}</span>)}{warnings.length === 0 && <span className="badge b-gray">{output || run.authoring ? "기록된 경고 없음" : "아직 결과 없음"}</span>}</div>
          <div className="pane">{tab === "result" ? (output || stage === "authoring" ? <StageResult stage={stage} output={output} run={run} open={setPdf}/> : <p className="muted">아직 이 단계의 결과가 없어요.</p>) : tab === "json" ? <Json value={stage === "authoring" ? run.authoring?.document : output}/> : tab === "input" ? <><div className="calls">{callList.map(c => <button key={c.n} aria-pressed={call?.n === c.n} onClick={() => setCall(c)}>시도 {c.attempt} · {fmt(c.ms)} <span className={`badge b-${c.ok ? "ok" : "warn"}`}>{c.ok ? "통과" : "검사 걸림"}</span></button>)}</div>{call ? <><div className="facts4">{[["보낸 쪽", call.input.pagesSent.join(", ") || "없음"], ["잘린 쪽", call.input.pagesCut.join(", ") || "없음"], ["글자 수", call.input.charsSent], ["입력·출력 토큰", `${call.usage?.inputTokens ?? "미기록"} / ${call.usage?.outputTokens ?? "미기록"}`]].map(([k, v]) => <div key={k} className="fact"><small>{k}</small><div className="num">{v}</div></div>)}</div>{[["지시문", call.system], ["단계 계약과 입력 · 원문", call.user], ["받은 답", call.reply || "응답 없음"]].map(([k, v]) => <details key={k} className="block"><summary>{k} · {v.length}자</summary><pre>{v}</pre></details>)}</> : <p>호출 기록 없음</p>}</> : <>{callList.map((c, i) => <article className="attempt" key={c.n}><b>시도 {c.attempt} · {c.ok ? "통과" : "검사 걸림"}</b><span className="num"> {fmt(c.ms)}</span>{c.error && <p className="warnline">{c.error}</p>}{i > 0 && <details className="block"><summary>이전 답 → 고친 답</summary><div className="diff">{lineDiff(callList[i - 1].reply || "", c.reply || "").map((l, j) => <div className={l.kind} key={j}>{l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  "}{l.text}</div>)}</div></details>}</article>)}{callList.length === 0 && <p>검사·재시도 기록 없음</p>}</>}</div>
        </section>
      </>}</main></div>
    {pdf && run && <aside className="pdf"><div className="ph"><b>원문</b><span className="num">p.{pdf} / {run.request.sourceSnapshot?.pageCount}</span><span className="sp"/><button className="icon" title="이전 쪽" onClick={() => setPdf(Math.max(1, pdf - 1))}><ChevronLeft size={18}/></button><button className="icon" title="다음 쪽" onClick={() => setPdf(Math.min(run.request.sourceSnapshot?.pageCount || pdf, pdf + 1))}><ChevronRight size={18}/></button><button className="icon" aria-label="PDF 닫기" onClick={() => setPdf(null)}><X size={18}/></button></div><LabPdf sourceId={run.request.input.sourceId} page={pdf}/></aside>}
    {modal && <div className="scrim"><section className="dialog" role="dialog" aria-modal="true" aria-label="새 실행"><div className="dh"><h3>새 실행</h3><button className="icon" aria-label="새 실행 닫기" onClick={() => setModal(false)}><X size={18}/></button></div><div className="db"><div className="field"><label htmlFor="source">자료</label><div className="row"><select id="source" value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="">PDF를 골라 주세요</option>{sources.map(s => <option key={s.id} value={s.id}>{s.fileName} · {s.pageCount}쪽</option>)}</select><button className="btn" onClick={() => fileInput.current?.click()}>PDF 올리기</button><input ref={fileInput} type="file" accept="application/pdf" hidden onChange={e => { const file = e.target.files?.[0]; if (!file)
        return; void action(async () => { const f = new FormData(); f.append("pdf", file); const r = await fetch("/api/mcp-runs/sources", { method: "POST", body: f }); const d = await r.json(); if (!r.ok)
        throw new Error(d.message); setSources(s => [...s.filter(v => v.id !== d.source.id), { ...d.source, available: true }]); setSourceId(d.source.id); }); }}/></div></div><div className="row"><label className="field">시작 쪽<input type="number" min={1} value={start} onChange={e => setStart(Number(e.target.value))}/></label><label className="field">끝 쪽<input type="number" min={start} max={sources.find(s => s.id === sourceId)?.pageCount} value={end} onChange={e => setEnd(Number(e.target.value))}/></label></div><label className="field">목적<input value={purpose} onChange={e => setPurpose(e.target.value)}/></label><div className="field"><label>할 수 있어야 할 것</label><div className="chips">{ABILITIES.map(a => <label className="chip" key={a}><input type="checkbox" checked={abilities.includes(a)} onChange={e => setAbilities(v => e.target.checked ? [...v, a] : v.filter(x => x !== a))}/>{a}</label>)}</div></div><div className="field"><label>단계별 모델</label><table className="models"><thead><tr><th>단계</th><th>모델</th><th>추론 강도</th></tr></thead><tbody><tr className="all"><td>모두 같게</td><td><select aria-label="모두 같게 모델" value={allModel} onChange={e => { setAllModel(e.target.value); setModels(v => Object.fromEntries(stages.map(s => [s.key, { ...v[s.key as keyof typeof v], model: e.target.value }])) as LabConfig["stages"]); }}>{MODELS.map(m => <option key={m}>{m}</option>)}</select></td><td><select aria-label="모두 같게 추론 강도" value={allEffort} onChange={e => { setAllEffort(e.target.value); setModels(v => Object.fromEntries(stages.map(s => [s.key, { ...v[s.key as keyof typeof v], effort: e.target.value }])) as LabConfig["stages"]); }}>{EFFORTS.map(v => <option key={v}>{v}</option>)}</select></td></tr>{stages.map((s, i) => <tr key={s.key}><td>{i + 1} {s.label}</td><td><select aria-label={`${s.label} 모델`} value={models[s.key as keyof typeof models]?.model || "gpt-6-luna"} onChange={e => setSetting(s.key, "model", e.target.value)}>{MODELS.map(m => <option key={m}>{m}</option>)}</select></td><td><select aria-label={`${s.label} 추론 강도`} value={models[s.key as keyof typeof models]?.effort || "low"} onChange={e => setSetting(s.key, "effort", e.target.value)}>{EFFORTS.map(v => <option key={v}>{v}</option>)}</select></td></tr>)}</tbody></table></div><div className="row"><label><input type="checkbox" checked={stepMode} onChange={e => setStepMode(e.target.checked)}/> 한 단계씩</label><label><input type="checkbox" checked={!real} onChange={e => setReal(!e.target.checked)}/> 가짜 모델</label></div>{!real && <label className="field">가짜 시나리오<select value={scenario} onChange={e => setScenario(e.target.value)}><option value="success">정상 완료</option><option value="retry">개념 구조 근거 누락 → 수정</option><option value="warning">학습 설계 형식 오류 → 수정</option></select></label>}<label className="field">메모<input value={note} onChange={e => setNote(e.target.value)}/></label></div><div className="df"><small className="muted">{real ? "실제 모델 · ChatGPT 플랜 사용량이 나가요" : "가짜 모델 · 비용 없음 · Cornell BFS 1쪽 전용"}</small><button className="btn" onClick={() => setModal(false)}>취소</button><button className="btn primary" disabled={busy || !sourceId || !purpose} onClick={() => paid(create, real ? "chatgpt" : "fake")}>시작</button></div></section></div>}
    {confirm && <div className="scrim"><section className="dialog sm" role="alertdialog" aria-modal="true" aria-label="실제 모델 실행 확인"><div className="dh"><h3>실제 모델로 실행할까요?</h3></div><div className="db">AI 호출 최소 6번, 최대 약 20번(재시도 포함). ChatGPT 플랜 사용량이 나가요.</div><div className="df"><button className="btn" onClick={() => setConfirm(null)}>취소</button><button className="btn primary" onClick={() => { const fn = confirm; setConfirm(null); void action(fn); }}>시작</button></div></section></div>}
  </div>;
}
