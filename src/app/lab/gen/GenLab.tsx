"use client";
// Lab screen for the v2 engine (docs/DECISIONS.md 2026-10-12): start a run, watch each call,
// confirm objectives once, and open the problems of each section as they are authored.
import { useCallback, useEffect, useState } from "react";
import type { GenCall, GenInput, GenMark, GenState, GenStep, Purpose } from "@/lib/study/gen/types";
import type { Scorecard } from "@/lib/study/gen/scorecard";
import type { JudgeRun } from "@/lib/study/gen/judge";
import type { VisionProbe } from "@/lib/study/gen/vision";
import type { getAstraReadingView } from "@/lib/study/gen/astra";
import { DEFAULT_GEN_MODELS, astraFamily, defaultChosen, genStepLabel, purposeLabel } from "@/lib/study/gen/types";
import "./gen.css";

type Source = { id: string; fileName: string; pageCount: number; available: boolean };
type RunSummary = { id: string; createdAt: string; status: string; phase: string; fileName: string; pages: number[]; purpose: Purpose; provider: string; calls: number; forkOf: GenState["forkOf"] | null };
type CallSummary = Omit<GenCall, "system" | "user" | "reply">;
type Detail = { gen: GenState; label: string; calls: CallSummary[] };

const STEPS: GenStep[] = ["transcribe", "outline", "classify", "design", "author"];
/** v3 (협업/설계_생성엔진v3_Claude_20261019.md): whole-PDF read → plan → author per unit → gate. */
const STEPS_V3: GenStep[] = ["read", "plan", "author", "gate"];
const STEPS_ASTRA: GenStep[] = ["astra-plan", "astra-author", "astra-solve", "astra-review"];
const MODELS = ["gpt-6-sol", "gpt-6-astra", "gpt-6-luna"];
const EFFORTS = ["low", "medium", "high", "xhigh"];
const STATUS: Record<string, string> = {
  queued: "대기", running: "진행 중", "awaiting-confirm": "목표 확인 대기", "paused-usage-limit": "멈춤(한도)", "paused-login": "멈춤(로그인)",
  "paused-invalid": "멈춤(검사)", interrupted: "멈춤(서버)", failed: "실패", done: "완료",
};
const tone = (status: string) => status === "done" ? "ok" : status === "failed" ? "bad" : status === "awaiting-confirm" ? "ask" : status.startsWith("paused") || status === "interrupted" ? "warn" : "run";
const FORK_LABEL: Record<string, string> = { design: "설계부터", author: "출제만" };
const seconds = (ms: number) => ms >= 60000 ? `${Math.floor(ms / 60000)}분 ${Math.round((ms % 60000) / 1000)}초` : `${(ms / 1000).toFixed(1)}초`;

async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "요청에 실패했어요.");
  return data as T;
}

export default function GenLab() {
  const [sources, setSources] = useState<Source[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadLists = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([api<{ sources: Source[] }>("/api/mcp-runs/sources"), api<{ runs: RunSummary[] }>("/api/lab/gen")]);
      setSources(s.sources.filter((source) => source.available));
      setRuns(r.runs);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { const initial = setTimeout(() => { void loadLists(); }, 0); return () => clearTimeout(initial); }, [loadLists]);
  // Keep the list in step with the open run while anything is still moving.
  const moving = runs.some((run) => run.status === "queued" || run.status === "running");
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => { void loadLists(); }, 3000);
    return () => clearInterval(timer);
  }, [moving, loadLists]);

  return (
    <main className="gen">
      <header className="gen-head">
        <h1>생성 실험실 · 새 엔진</h1>
        <p>목차 → 내용 분류·학습 설계(목차별) → 목표 확인 → 출제(목차별). <a href="/lab">옛 실험실</a></p>
      </header>
      {error && <p className="gen-error" role="alert">{error}</p>}
      <div className="gen-layout">
        <aside>
          <NewRun sources={sources} onSources={loadLists} onStarted={(id) => { setOpenId(id); void loadLists(); }} onError={setError} />
          <VisionPanel sources={sources} onError={setError} />
          <h2>실행</h2>
          <ul className="gen-runs">
            {runs.map((run) => (
              <li key={run.id}>
                <button className={openId === run.id ? "on" : ""} onClick={() => setOpenId(run.id)}>
                  <span className={`tag ${tone(run.status)}`}>{STATUS[run.status] ?? run.status}</span>
                  <b>{run.fileName}</b>
                  <small>p.{run.pages[0]}–{run.pages.at(-1)} · {purposeLabel[run.purpose]} · {run.provider === "fake" ? "가짜" : "실제"} · 호출 {run.calls}{run.forkOf ? ` · 고정 재실행(${FORK_LABEL[run.forkOf.from]})` : ""}</small>
                </button>
              </li>
            ))}
            {!runs.length && <li className="muted">아직 실행이 없어요.</li>}
          </ul>
        </aside>
        <section>{openId ? <RunView key={openId} id={openId} runs={runs} onChange={loadLists} onOpen={(id) => { setOpenId(id); void loadLists(); }} onError={setError} /> : <p className="muted">왼쪽에서 새로 시작하거나 실행을 고르세요.</p>}</section>
      </div>
    </main>
  );
}

function NewRun({ sources, onSources, onStarted, onError }: { sources: Source[]; onSources: () => void; onStarted: (id: string) => void; onError: (message: string) => void }) {
  const [sourceId, setSourceId] = useState("");
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(2);
  const [purpose, setPurpose] = useState<Purpose>("core");
  const [note, setNote] = useState("");
  const [provider, setProvider] = useState<"chatgpt" | "fake">("chatgpt");
  const [models, setModels] = useState<Record<GenStep, { model: string; effort: string }>>(
    () => Object.fromEntries([...STEPS, ...STEPS_V3, ...STEPS_ASTRA].map((step) => [step, { ...DEFAULT_GEN_MODELS[step] }])) as Record<GenStep, { model: string; effort: string }>);
  const [engine, setEngine] = useState<GenInput["engine"]>("v2");
  const shown = astraFamily(engine) ? STEPS_ASTRA : engine === "v3" ? STEPS_V3 : STEPS;
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [guideDir, setGuideDir] = useState("출제기준");
  const [readImages, setReadImages] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const source = sources.find((candidate) => candidate.id === sourceId) ?? sources[0];
  const pages = source ? Array.from({ length: Math.max(0, Math.min(to, source.pageCount) - from + 1) }, (_, index) => from + index) : [];
  const setAll = (key: "model" | "effort", value: string) => setModels((current) => ({ ...current, ...Object.fromEntries(shown.map((step) => [step, { ...current[step], [key]: value }])) }) as typeof current);

  const start = async () => {
    if (!source || !pages.length) return;
    setBusy(true); onError("");
    try {
      const { gen } = await api<{ gen: GenState }>("/api/lab/gen", "POST", {
        sourceId: source.id, fileName: source.fileName, pageNumbers: pages, purpose, note, provider, autoConfirm, guideDir, engine, confirmed: provider === "chatgpt" ? confirmed : undefined,
        models: Object.fromEntries(shown.map((step) => [step, models[step]])), readImages: engine === "v2" ? readImages : false,
      });
      setConfirmed(false);
      onStarted(gen.id);
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const fixture = async () => { try { await api("/api/lab/fixture", "POST"); onSources(); } catch (e) { onError(e instanceof Error ? e.message : String(e)); } };

  return (
    <form className="gen-new" onSubmit={(event) => { event.preventDefault(); void start(); }}>
      <h2>새로 시작</h2>
      <label>자료
        <select value={source?.id ?? ""} onChange={(event) => setSourceId(event.target.value)}>
          {sources.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.fileName} ({candidate.pageCount}쪽)</option>)}
        </select>
      </label>
      {!sources.length && <button type="button" onClick={fixture}>예제 PDF(Cornell BFS 2쪽) 등록</button>}
      <div className="row">
        <label>시작 쪽<input type="number" min={1} value={from} onChange={(event) => setFrom(Number(event.target.value))} /></label>
        <label>끝 쪽<input type="number" min={from} value={to} onChange={(event) => setTo(Number(event.target.value))} /></label>
      </div>
      <fieldset><legend>엔진</legend>
        <label className="chip"><input type="radio" name="engine" checked={engine === "v2"} onChange={() => setEngine("v2")} />v2 (기본)</label>
        <label className="chip" title="PDF 통째 읽기 → 출제 계획 → 단원별 출제 → 관문 검사"><input type="radio" name="engine" checked={engine === "v3"} onChange={() => setEngine("v3")} />v3 (Claude 안, 실험)</label>
        <label className="chip" title="전체 PDF → 학습 계획 → 묶음 출제 → 정답 없는 풀이 → 원문 검수"><input type="radio" name="engine" checked={engine === "astra"} onChange={() => setEngine("astra")} />astra (GPT 안, 실험)</label>
        <label className="chip" title="astra 구조 그대로 + 답 모양에 맞는 형식, 한 문항 한 과제, 슬롯 차별, 검수 입력 축소, 공개 후 지적 1회 수정"><input type="radio" name="engine" checked={engine === "v4"} onChange={() => setEngine("v4")} />v4 (Claude의 astra 조정안, 실험)</label>
      </fieldset>
      {astraFamily(engine) && <p className="muted">{engine === "v4" ? "v4는 astra와 같은 단계(계획·출제·풀이·검수)를 쓰되, 계획을 단원별로 스트리밍해 목차·목표를 도중에 보이고 끝난 단원부터 바로 출제합니다(공개는 계획 검사 뒤). 목표는 짧은 한 문장으로 남깁니다. " : ""}astra는 엔진 이름입니다. 기본 모델은 모든 단계 Sol·medium이며 아래에서 바꿀 수 있어요. 별도 출제기준 폴더 대신 astra 전용 지시문을 사용합니다.</p>}
      <fieldset><legend>목적</legend>
        {(Object.keys(purposeLabel) as Purpose[]).map((key) => (
          <label key={key} className="chip"><input type="radio" name="purpose" checked={purpose === key} onChange={() => setPurpose(key)} />{purposeLabel[key]}</label>
        ))}
      </fieldset>
      <label>메모(선택)<textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="예: 중간고사 범위, 정의 위주로" /></label>
      <fieldset><legend>모델</legend>
        <div className="row">
          <label className="chip"><input type="radio" checked={provider === "chatgpt"} onChange={() => setProvider("chatgpt")} />실제(ChatGPT)</label>
          <label className="chip"><input type="radio" checked={provider === "fake"} onChange={() => setProvider("fake")} />가짜(비용 없음)</label>
        </div>
        {provider === "chatgpt" && <>
          <div className="row">
            <label>전체 모델<select onChange={(event) => setAll("model", event.target.value)} defaultValue="">{["", ...MODELS].map((m) => <option key={m} value={m}>{m || "단계별"}</option>)}</select></label>
            <label>전체 강도<select onChange={(event) => setAll("effort", event.target.value)} defaultValue="">{["", ...EFFORTS].map((e) => <option key={e} value={e}>{e || "단계별"}</option>)}</select></label>
          </div>
          <table className="models"><tbody>{shown.map((step) => (
            <tr key={step}><th>{genStepLabel[step]}</th>
              <td><select value={models[step].model} onChange={(event) => setModels({ ...models, [step]: { ...models[step], model: event.target.value } })}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></td>
              <td><select value={models[step].effort} onChange={(event) => setModels({ ...models, [step]: { ...models[step], effort: event.target.value } })}>{EFFORTS.map((e) => <option key={e}>{e}</option>)}</select></td></tr>
          ))}</tbody></table>
        </>}
      </fieldset>
      {!astraFamily(engine) && <label>출제기준 폴더<input value={guideDir} onChange={(event) => setGuideDir(event.target.value.trim())} placeholder="출제기준" title="비교할 때는 출제기준-후보처럼 복사본 이름" /></label>}
      {engine === "v2" && <label className="check" title="글자가 적은 쪽(600자 미만)을 이미지로 한 번 읽어 원문으로 씁니다. 쪽당 호출 1번."><input type="checkbox" checked={readImages} onChange={(event) => setReadImages(event.target.checked)} />그림·수식 쪽 읽기</label>}
      <label className="check"><input type="checkbox" checked={autoConfirm} onChange={(event) => setAutoConfirm(event.target.checked)} />목표 확인 없이 끝까지</label>
      {provider === "chatgpt" && <label className="check warn"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />실제 모델을 호출합니다(ChatGPT 사용량이 나갑니다)</label>}
      <p className="muted">쪽 {pages.length}개 · 예상 호출: {astraFamily(engine) ? "계획 1 + 묶음 수 × 3(출제·독립 풀이·묶음 검수) + 전체 검수 1 (+수정·재검수). 첫 묶음 3문항, 이후 8문항씩 최대 2묶음 동시 진행. PDF는 계획 호출에만 첨부." : engine === "v3" ? "전체 읽기 1(PDF 통째, 그림 포함) + 출제 계획 1 + 단원 수 × 2(출제·관문) (+재출제)" : `목차 1 + 목차 수 × ${purpose === "read" ? "1" : "3"} (+재시도)`}</p>
      <button className="primary" disabled={busy || !source || !pages.length || (provider === "chatgpt" && !confirmed)}>{busy ? "시작하는 중…" : "시작"}</button>
    </form>
  );
}

/** Image reading probe: one page, one call. Shows the page, the PDF text layer and what the model read side by side. */
function VisionPanel({ sources, onError }: { sources: Source[]; onError: (message: string) => void }) {
  const [sourceId, setSourceId] = useState("");
  const [page, setPage] = useState(1);
  const [model, setModel] = useState({ model: "gpt-6-sol", effort: "medium" });
  const [mode, setMode] = useState<"image" | "pdf">("image");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [probes, setProbes] = useState<VisionProbe[]>([]);
  const [shown, setShown] = useState<(VisionProbe & { image?: string }) | null>(null);
  const source = sources.find((candidate) => candidate.id === sourceId) ?? sources[0];
  const loadList = useCallback(async () => {
    try { setProbes((await api<{ probes: VisionProbe[] }>("/api/lab/gen/vision")).probes); } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  }, [onError]);
  useEffect(() => { const initial = setTimeout(() => { void loadList(); }, 0); return () => clearTimeout(initial); }, [loadList]);
  const run = async () => {
    if (!source) return;
    setBusy(true); onError("");
    try {
      const { probe } = await api<{ probe: VisionProbe & { image: string } }>("/api/lab/gen/vision", "POST", { sourceId: source.id, page, mode, ...model, confirmed });
      setShown(probe); setConfirmed(false); void loadList();
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const open = async (probe: VisionProbe) => {
    try { setShown({ ...probe, image: (await api<{ image: string }>(`/api/lab/gen/vision/${probe.id}/image`)).image }); } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <details className="gen-new vision">
      <summary><b>이미지 읽기 시험</b> <small className="muted">쪽 하나를 그려서 모델이 읽게 함(호출 1번)</small></summary>
      <label>자료<select value={source?.id ?? ""} onChange={(event) => setSourceId(event.target.value)}>
        {sources.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.fileName} ({candidate.pageCount}쪽)</option>)}</select></label>
      <div className="row">
        <label>쪽<input type="number" min={1} max={source?.pageCount} value={page} onChange={(event) => setPage(Number(event.target.value))} /></label>
        <label>모델<select value={model.model} onChange={(event) => setModel({ ...model, model: event.target.value })}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>강도<select value={model.effort} onChange={(event) => setModel({ ...model, effort: event.target.value })}>{EFFORTS.map((e) => <option key={e}>{e}</option>)}</select></label>
      </div>
      <div className="row">
        <label className="chip"><input type="radio" checked={mode === "image"} onChange={() => setMode("image")} />쪽 이미지</label>
        <label className="chip" title="PDF 파일 전체를 보내고 그 쪽만 옮기게 합니다. 쪽 수만큼 토큰이 들 수 있어요."><input type="radio" checked={mode === "pdf"} onChange={() => setMode("pdf")} />PDF 통째</label>
      </div>
      <label className="check warn"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />실제 모델을 호출합니다</label>
      <button className="primary" disabled={busy || !source || !confirmed} onClick={() => void run()}>{busy ? "읽는 중…" : "이 쪽 읽기"}</button>
      {probes.length > 0 && <ul className="gen-runs">{probes.slice(0, 8).map((probe) => (
        <li key={probe.id}><button className={shown?.id === probe.id ? "on" : ""} onClick={() => void open(probe)}>
          <span className={`tag ${probe.ok ? "ok" : "bad"}`}>{probe.ok ? "읽음" : "실패"}</span>
          <small>{probe.fileName} p.{probe.page} · {probe.mode === "pdf" ? "PDF" : "이미지"} · {probe.model}·{probe.effort} · {seconds(probe.ms)}</small></button></li>))}</ul>}
      {shown && (
        <div className="vision-result">
          {/* A data URL from the probe; next/image adds nothing here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {shown.image && <img src={shown.image} alt={`${shown.fileName} ${shown.page}쪽`} />}
          {shown.error && <p className="gen-error">{shown.error}</p>}
          <p className="muted">토큰 입력 {shown.usage?.inputTokens?.toLocaleString() ?? "—"} / 출력 {shown.usage?.outputTokens?.toLocaleString() ?? "—"} · 이미지 {Math.round(shown.imageBytes / 1024)}KB</p>
          <h4>PDF 글자 층</h4><pre>{shown.textLayer || "(없음)"}</pre>
          <h4>모델이 읽은 것</h4><pre>{shown.reply ?? "—"}</pre>
        </div>
      )}
    </details>
  );
}

function RunView({ id, runs, onChange, onOpen, onError }: { id: string; runs: RunSummary[]; onChange: () => void; onOpen: (id: string) => void; onError: (message: string) => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [doc, setDoc] = useState<{ sectionId: string; html: string } | null>(null);
  const [call, setCall] = useState<GenCall | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api<Detail>(`/api/lab/gen/${id}`);
      // When the run stops (done, paused, waiting for confirmation), refresh the list too so both sides agree.
      setDetail((previous) => {
        if (previous && previous.gen.status !== next.gen.status) setTimeout(onChange, 0);
        return next;
      });
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  }, [id, onChange, onError]);
  // The parent keys this view by run id, so switching runs starts from fresh state.
  useEffect(() => { const initial = setTimeout(() => { void load(); }, 0); return () => clearTimeout(initial); }, [load]);
  const status = detail?.gen.status;
  useEffect(() => {
    if (status !== "queued" && status !== "running") return;
    const timer = setInterval(() => { void load(); }, 2000);
    return () => clearInterval(timer);
  }, [status, load]);

  if (!detail) return <p className="muted">불러오는 중…</p>;
  const { gen, label, calls } = detail;
  const real = gen.input.provider !== "fake";
  const objectives = gen.sections.flatMap((section) => section.design?.objectives ?? []);
  // 보조 목표는 보이되 기본으로 체크하지 않는다(통암기는 전부).
  const selected = chosen ?? new Set(defaultChosen(gen.input.purpose, objectives));
  const toggle = (objectiveId: string) => { const next = new Set(selected); if (next.has(objectiveId)) next.delete(objectiveId); else next.add(objectiveId); setChosen(next); };
  const totalMs = calls.reduce((sum, item) => sum + item.ms, 0);
  const tokens = calls.reduce((sum, item) => ({ input: sum.input + (item.usage?.inputTokens ?? 0), output: sum.output + (item.usage?.outputTokens ?? 0), cached: sum.cached + (item.usage?.cachedInputTokens ?? 0) }), { input: 0, output: 0, cached: 0 });
  const formats = [...new Set(calls.map((item) => item.format).filter(Boolean))];

  const confirm = async () => {
    try { await api(`/api/lab/gen/${id}/confirm`, "POST", { objectiveIds: [...selected], confirmed: real ? confirmed : undefined }); setConfirmed(false); await load(); onChange(); }
    catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  const resume = async () => {
    try { await api(`/api/lab/gen/${id}/continue`, "POST", { confirmed: real ? confirmed : undefined }); setConfirmed(false); await load(); onChange(); }
    catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  const openDoc = async (sectionId: string) => {
    try { const result = await api<{ html: string }>(`/api/lab/gen/${id}/sections/${sectionId}`); setDoc({ sectionId, html: result.html }); }
    catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  const openCall = async (n: number) => {
    try { setCall(await api<GenCall>(`/api/lab/gen/${id}/calls/${n}`)); } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  const canResume = ["paused-usage-limit", "paused-login", "paused-invalid", "interrupted"].includes(gen.status);

  return (
    <div className="gen-run">
      <div className="gen-status">
        <span className={`tag ${tone(gen.status)}`}>{STATUS[gen.status] ?? gen.status}</span>
        <b>{gen.input.fileName}</b> p.{gen.input.pageNumbers[0]}–{gen.input.pageNumbers.at(-1)} · {purposeLabel[gen.input.purpose]} · {gen.input.engine === "v4" ? "엔진 v4" : astraFamily(gen.input.engine) ? "엔진 astra" : gen.input.engine === "v3" ? "엔진 v3" : gen.input.guideDir ?? "출제기준"}
        {label && <span className="muted"> · {label}</span>}
        {gen.images && <div className="muted">그림 쪽 읽기: {gen.images.done.length}/{gen.images.pages.length}쪽{gen.images.failed.length ? ` · 실패 p.${gen.images.failed.join(", ")}` : ""}</div>}
        {gen.forkOf && <div className="muted">고정 재실행({FORK_LABEL[gen.forkOf.from]}) · 기준 실행 {gen.forkOf.genId.slice(0, 12)}… {astraFamily(gen.input.engine) ? (gen.forkOf.from === "author" ? "의 학습 계획·목표를 그대로 썼어요." : "의 자료 지도를 참고해 학습 계획부터 다시 만들어요.") : `의 목차·분류${gen.forkOf.from === "author" ? "·목표" : ""}를 그대로 썼어요.`} 호출·시간·토큰은 다시 돈 단계만 셉니다.</div>}
        <div className="muted">호출 {gen.calls}번 (PDF 첨부 {calls.filter((item) => item.withPdf).length}번) · 모델 시간 {seconds(totalMs)} · 토큰 입력 {tokens.input.toLocaleString()}{tokens.cached ? ` (캐시 ${tokens.cached.toLocaleString()})` : ""} / 출력 {tokens.output.toLocaleString()}{formats.length ? ` · 응답 형식 ${formats.join(", ")}` : ""}</div>
        {astraFamily(gen.input.engine) && <AstraLive gen={gen} />}
        {gen.message && <p className={gen.status === "failed" ? "gen-error" : ""}>{gen.message}</p>}
        {(canResume || gen.status === "awaiting-confirm") && real && (
          <label className="check warn"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />실제 모델을 호출합니다</label>
        )}
        {canResume && <button className="primary" disabled={real && !confirmed} onClick={resume}>멈춘 곳부터 다시 시작</button>}
      </div>

      <FlowPanel gen={gen} onChange={onChange} onError={onError} />
      {gen.outlineWarnings?.map((warning, index) => <p key={index} className="warnline">{warning.message}</p>)}
      {astraFamily(gen.input.engine) && <AstraReader gen={gen} onOpenDoc={openDoc} />}
      {astraFamily(gen.input.engine) && <AstraPanel gen={gen} />}
      {gen.v3?.map && (() => {
        const map = gen.v3.map, gate = gen.v3.gate ?? [];
        const firstFail = gate.filter((verdict) => verdict.attempt === 1 && !verdict.passed);
        const stillFail = gate.filter((verdict) => verdict.attempt === 2 && !verdict.passed);
        return (
          <details className="muted">
            <summary>v3 지식 지도: 개념 {map.concepts.length} · 관계 {map.relations.length} · 그림 쪽 옮김 {map.pageNotes.length} · PDF {map.pdfSent ? "보냄" : "안 보냄"} · 관문 1차 걸림 {firstFail.length} · 재출제 후에도 걸림 {stillFail.length}</summary>
            {gen.v3.warnings?.filter((warning) => !gen.outlineWarnings?.includes(warning)).map((warning, index) => <p key={index} className="warnline">{warning.message}</p>)}
            <ul>{map.relations.map((relation) => <li key={relation.id}>[{relation.kind}] {relation.statement}</li>)}</ul>
            {gate.filter((verdict) => !verdict.passed).map((verdict, index) => <p key={index}>관문 {verdict.attempt}차 · {verdict.objectiveId}: {verdict.reasons.join(" / ")}</p>)}
          </details>
        );
      })()}

      {["done", "awaiting-confirm"].includes(gen.status) && <ScorePanel id={id} status={gen.status} real={real} runs={runs} onError={onError} />}

      {["done", "awaiting-confirm"].includes(gen.status) && (gen.input.purpose !== "read" || (astraFamily(gen.input.engine) && gen.astra?.plan)) && <ForkPanel gen={gen} onOpen={onOpen} onError={onError} />}

      {gen.status === "awaiting-confirm" && (
        <div className="confirmbar">
          목표 {selected.size}/{objectives.length}개를 출제합니다.
          <button className="primary" disabled={real && !confirmed} onClick={confirm}>이 목표로 문제 만들기</button>
        </div>
      )}

      {gen.sections.map((section) => (
        <article key={section.id} className="gen-section">
          <h3>{section.title} <small>p.{section.pages.join(", ")}</small></h3>
          {section.parts?.length ? <p className="muted parts">{section.parts.map((part) => `${part.title} (p.${part.pages[0]}${part.pages.length > 1 ? `–${part.pages.at(-1)}` : ""})`).join(" · ")}</p> : null}
          {section.classify && (
            <details><summary>{astraFamily(gen.input.engine) ? "개념 근거" : "내용 분류"} {section.classify.items.length}개</summary>
              <ol className="items">{section.classify.items.map((item) => <li key={item.n}><span className="kind">{item.kind}</span> {item.content} <small>p.{item.page}</small><q>{item.quote}</q></li>)}</ol>
            </details>
          )}
          {[...(section.classify?.warnings ?? []), ...(section.design?.warnings ?? [])].map((warning, index) => <p key={index} className="warnline">{warning.message}</p>)}
          {section.design && (
            <ul className="objectives">{section.design.objectives.map((objective) => {
              const dropped = section.author?.dropped.find((drop) => drop.objectiveId === objective.id);
              return (
                <li key={objective.id} className={dropped ? "dropped" : ""}>
                  {gen.status === "awaiting-confirm" && <input type="checkbox" checked={selected.has(objective.id)} onChange={() => toggle(objective.id)} aria-label={`${objective.statement} 출제`} />}
                  <div>
                    <b>{objective.statement}</b> <span className="kind">{objective.kind}</span>{objective.importance === "support" && <span className="kind">보조</span>}
                    <div className="cue">{objective.cue} → <i>{objective.recall}</i></div>
                    {objective.qtype && <div className="muted">[{objective.qtype}]{objective.conditions?.length ? ` 조건: ${objective.conditions.join(" / ")}` : ""}</div>}
                    <small>p.{objective.pages.join(", ")} · 근거 {objective.quotes.length}개</small>
                    {dropped && <div className="warnline">문제 없음: {dropped.reason}</div>}
                  </div>
                </li>
              );
            })}</ul>
          )}
          {section.author && (
            <div className="authored">
              문항 {section.author.questionCount}개{section.author.dropped.length ? ` · 뺀 목표 ${section.author.dropped.length}개` : ""}
              {section.author.documentPath && <button onClick={() => void openDoc(section.id)}>{astraFamily(gen.input.engine) && doc?.sectionId === section.id ? "문제 다시 불러오기" : "문제 보기"}</button>}
              {section.author.warnings.map((warning, index) => <p key={index} className="warnline">경고({warning.ref}): {warning.message}</p>)}
            </div>
          )}
          {doc?.sectionId === section.id && <iframe className="docframe" title={`${section.title} 문제`} srcDoc={doc.html} sandbox="allow-scripts" />}
        </article>
      ))}

      <h3>호출 기록</h3>
      <table className="calls"><thead><tr><th>#</th><th>단계</th><th>목차</th><th>시도</th><th>모델</th><th>형식</th><th>기준</th><th>시간</th><th>토큰</th><th>결과</th></tr></thead>
        <tbody>{calls.map((item) => (
          <tr key={item.n} onClick={() => void openCall(item.n)} className={item.ok ? "" : "bad"}>
            <td>{item.n}</td><td>{genStepLabel[item.step]}{item.withPdf && <small> · PDF</small>}</td><td>{item.sectionId ?? ""}</td><td>{item.attempt}</td><td>{item.model} {item.effort}</td>
            <td>{item.format ?? ""}</td><td title={item.guide ? `${item.guide.dir} · ${item.guide.files.join(", ")}` : ""}>{item.guide ? `${item.guide.dir === "출제기준" ? "" : `${item.guide.dir} `}${item.guide.version.slice(0, 7)}` : ""}</td><td>{seconds(item.ms)}{item.firstTextMs !== undefined && <small> · 첫 응답 {seconds(item.firstTextMs)}</small>}</td><td>{item.usage ? `${item.usage.inputTokens ?? "?"}${item.usage.cachedInputTokens ? `(캐시 ${item.usage.cachedInputTokens})` : ""}/${item.usage.outputTokens ?? "?"}` : ""}</td><td>{item.ok ? "응답" : item.error}</td>
          </tr>
        ))}</tbody>
      </table>
      {call && (
        <div className="calldetail">
          <h4>호출 {call.n} · {genStepLabel[call.step]} {call.sectionId ?? ""} <button onClick={() => setCall(null)}>닫기</button></h4>
          <details><summary>지시문(system)</summary><pre>{call.system}</pre></details>
          <details><summary>입력(user)</summary><pre>{call.user}</pre></details>
          <details open><summary>응답</summary><pre>{call.reply ?? call.error}</pre></details>
        </div>
      )}
    </div>
  );
}

function AstraReader({ gen, onOpenDoc }: { gen: GenState; onOpenDoc: (sectionId: string) => Promise<void> }) {
  const [page, setPage] = useState(gen.input.pageNumbers[0]);
  const [draft, setDraft] = useState(String(gen.input.pageNumbers[0]));
  const [reading, setReading] = useState<ReturnType<typeof getAstraReadingView> | null>(null);
  const [error, setError] = useState("");
  const pages = gen.input.pageNumbers;
  const position = pages.indexOf(page);
  const pdfUrl = `/api/mcp-runs/sources/${encodeURIComponent(gen.input.sourceId)}/pdf#page=${page}`;
  useEffect(() => {
    let cancelled = false;
    void api<{ reading: ReturnType<typeof getAstraReadingView> }>(`/api/lab/gen/${gen.id}/reading?page=${page}`).then((result) => {
      if (!cancelled) setReading(result.reading);
    }, (reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [gen.id, gen.updatedAt, page]);
  const move = async (next: number) => {
    if (!pages.includes(next)) { setError("선택한 범위 안의 쪽 번호를 입력하세요."); return; }
    setPage(next); setDraft(String(next)); setError("");
    try { await api(`/api/lab/gen/${gen.id}/reading`, "POST", { page: next }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const current = reading?.outline.filter((section) => section.pages.includes(page)) ?? [];
  const statusLabels = { pending: "준비 전", generating: "생성 중", ready: "문제 준비됨", partial: "일부 문제 준비됨", held: "보류" };
  return (
    <details className="score" open>
      <summary>읽으면서 생성 · 실험용 원본 보기</summary>
      <form className="row" onSubmit={(event) => { event.preventDefault(); void move(Number(draft)); }}>
        <button type="button" disabled={position <= 0} onClick={() => void move(pages[position - 1])}>이전</button>
        <label>현재 쪽 <input aria-label="읽기 실험 현재 쪽" type="number" min={pages[0]} max={pages.at(-1)} value={draft} onChange={(event) => setDraft(event.target.value)} style={{ width: 80 }} /></label>
        <button type="submit">이 쪽 읽기</button>
        <button type="button" disabled={position >= pages.length - 1} onClick={() => void move(pages[position + 1])}>다음</button>
        <a href={pdfUrl} target="_blank" rel="noreferrer">원본 따로 열기</a>
      </form>
      <p className="muted">기본은 선택 범위 첫 쪽부터 현재 단원 → 다음 단원을 원문 순서대로 준비합니다. 위 쪽 이동으로 읽는 위치를 알려주면 아직 시작하지 않은 묶음에 우선순위를 줍니다. PDF 안에서 직접 스크롤한 위치는 추적하지 못합니다. 상태가 갱신돼도 PDF는 다시 열지 않습니다.</p>
      {error && <p className="gen-error" role="alert">{error}</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <iframe className="docframe" title={`${gen.input.fileName} 원본 읽기`} src={pdfUrl} style={{ flex: "2 1 360px", minWidth: 0 }} />
        <aside style={{ flex: "1 1 200px", minWidth: 0 }}>
          <h4>현재 p.{page}</h4>
          {reading && <p className="muted">전체 검수: {reading.globalReviewState === "completed" ? "완료" : reading.globalReviewState === "running" ? "진행 중" : "대기"}</p>}
          {!current.length && <p className="muted">원본은 지금 읽을 수 있어요. 학습 계획이 생기면 이 쪽의 단원·목표가 붙습니다.</p>}
          {current.map((section) => <div key={section.id}>
            <b>{section.title}</b> <small>{statusLabels[section.generationStatus]}</small>
            <details><summary>학습 목표 {section.objectives.length}개</summary><ul>{section.objectives.map((objective) => <li key={objective.id}>{objective.statement}</li>)}</ul></details>
            {!!section.publishedObjectiveIds.length && <button onClick={() => void onOpenDoc(section.id)}>이 단원 문제 보기 ({section.publishedObjectiveIds.length})</button>}
            {section.held.map((item) => <p key={item.objectiveId} className="warnline">q-{item.objectiveId}: {item.reason}</p>)}
          </div>)}
          <details><summary>학습 목차</summary><ul>{reading?.outline.map((section) => <li key={section.id}><button onClick={() => void move(section.pages[0])}>{section.title}</button> · {statusLabels[section.generationStatus]}</li>)}</ul></details>
          <details><summary>이 쪽의 개념</summary><ul>{reading?.terms.filter((term) => term.evidence.some((evidence) => evidence.page === page)).map((term) => <li key={term.id}><b>{term.title}</b><div>{term.essentials.join(" / ")}</div></li>)}</ul></details>
          <p className="muted">문제 보기는 이 쪽만이 아니라 해당 단원 전체 문제를 아래에서 엽니다. 쉬운 설명·번역·질문·복습 화면은 이 실험 패널에 새로 만들지 않습니다.</p>
        </aside>
      </div>
    </details>
  );
}

function AstraLive({ gen }: { gen: GenState }) {
  const [now, setNow] = useState(() => Date.now());
  const moving = gen.status === "running" || gen.status === "queued";
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [moving]);
  const timing = gen.astra?.timing;
  const start = timing?.startedAt;
  const end = timing?.completedAt ?? (moving ? now : gen.updatedAt);
  const elapsed = (from: string, to: string | number) => seconds(Math.max(0, new Date(to).getTime() - new Date(from).getTime()));
  return (
    <div className="muted">
      {start && <div>실제 경과 {elapsed(start, end)} · 첫 공개까지 {timing?.firstPublishedAt ? elapsed(start, timing.firstPublishedAt) : "아직 공개 전"} <small>(확인 대기·중단 시간 포함, 위 모델 시간은 완료된 호출의 누적 합)</small></div>}
      {moving && gen.liveCalls?.map((call) => <div key={call.n}>호출 #{call.n} · {genStepLabel[call.step]} · {elapsed(call.startedAt, now)} 경과 · {call.firstTextAt ? `응답 수신 중 ${call.receivedChars.toLocaleString()}자` : "응답 대기 중(아직 받은 글자 없음)"}</div>)}
      {moving && !!gen.liveCalls?.length && <small>수신량은 약 2초마다 갱신됩니다. 글자 수는 진행률이나 남은 시간을 뜻하지 않습니다.</small>}
    </div>
  );
}

function AstraPanel({ gen }: { gen: GenState }) {
  const data = gen.astra;
  if (!data?.plan) return <p className="muted">astra: 저장된 학습 계획이 아직 없습니다.</p>;
  const plan = data.plan;
  const review = data.repair?.review ?? data.review;
  const candidates = data.batches.flatMap((batch) => batch.questions ?? []);
  const solutions = data.batches.flatMap((batch) => batch.solutions?.items ?? []);
  const flagged = solutions.filter((item) => item.missingConditions.length || item.exposedRelation || item.uncertain);
  const dropped = gen.sections.flatMap((section) => section.author?.dropped ?? []);
  const published = gen.sections.reduce((sum, section) => sum + (section.author?.questionCount ?? 0), 0);
  const batchReviews = data.batches.filter((batch) => batch.review).length;
  const publishedIds = new Set(data.publishedQuestions?.map((question) => question.objectiveId) ?? []);
  const lateWarnings = new Map<string, string[]>();
  for (const item of review?.items ?? []) if (publishedIds.has(item.objectiveId) && item.status !== "ready") lateWarnings.set(item.objectiveId, item.reasons.length ? item.reasons : ["검수 사유 없음"]);
  for (const item of data.warnings) if (item.code === "published-review-concern" && item.ref) lateWarnings.set(item.ref, [...new Set([...(lateWarnings.get(item.ref) ?? []), item.message])]);
  const reviewing = gen.liveCalls?.some((call) => call.step === "astra-review") && batchReviews === data.batches.length;
  const coverageLabels = { covered: "출제됨", partial: "일부만 출제", missing: "미출제" };
  const verdictLabels = { ready: "공개 가능", revise: "수정 필요", uncertain: "불확실" };
  return (
    <section className="score" aria-label="astra 중간 결과">
      <h3>astra · 무엇을 만들고 걸렀는가</h3>
      <p className="muted">개념 {plan.concepts.length} · 연습 묶음 {plan.practice.length} · 생성 초안 {candidates.length} · 지금 볼 수 있는 문제 {published} · {gen.status === "done" ? "최종 보류" : "현재 보류"} {dropped.length}</p>
      <p className="muted">묶음 검수 {batchReviews}/{data.batches.length} 완료 · 전체 검수: {review ? (data.repair?.review ? "수정 후 완료" : data.repair ? "1차 완료 · 수정 진행" : "완료") : reviewing ? "진행 중" : "아직 완료되지 않음"}. 묶음 검수를 마친 문제부터 아래 ‘문제 보기’로 열 수 있습니다.</p>
      <p className="muted">초안 독립 풀이 {solutions.length}개 중 조건·노출·불확실 신호 {flagged.length}개 · 수정 대상 {data.repair?.ids.length ?? 0}개 · 수정 후 독립 풀이 {data.repair?.solutions?.items.length ?? 0}개. 공개된 문제는 이후 검수에서 경고가 생겨도 자동으로 바꾸거나 지우지 않습니다.</p>
      {lateWarnings.size > 0 && <div role="status"><b>공개 후 발견된 경고 {lateWarnings.size}개</b><ul>{[...lateWarnings].map(([id, reasons]) => <li className="warnline" key={id}>문항 {id.startsWith("q-") ? id : `q-${id}`}: {reasons.join(" / ")}</li>)}</ul></div>}
      <details>
        <summary>학습 계획 · 필수 {plan.practice.filter((item) => item.priority === "essential").length} / 추가 {plan.practice.filter((item) => item.priority === "extra").length}</summary>
        <ul>{plan.practice.map((item) => <li key={item.id}>{item.priority === "essential" ? "필수" : "추가"} · {item.task} <small>예정 {item.questionCount}문제</small></li>)}</ul>
        {plan.uncertain.map((item, index) => <p key={index} className="warnline">자료 불확실 · p.{item.pages.join(", ")}: {item.reason}</p>)}
      </details>
      {review && <details>
        <summary>검수 · 공개 가능 {review.items.filter((item) => item.status === "ready").length} / 수정 필요 {review.items.filter((item) => item.status === "revise").length} / 불확실 {review.items.filter((item) => item.status === "uncertain").length}</summary>
        <ul>{review.items.filter((item) => item.status !== "ready").map((item, index) => <li key={`${item.objectiveId}-${index}`} className="warnline">{item.objectiveId} · {verdictLabels[item.status]}: {item.reasons.join(" / ") || "사유 없음"}</li>)}</ul>
        <ul>{review.coverage.map((item, index) => <li key={`${item.practiceId}-${index}`}>{plan.practice.find((practice) => practice.id === item.practiceId)?.task ?? item.practiceId} · {coverageLabels[item.status]}{item.reason ? `: ${item.reason}` : ""}</li>)}</ul>
        {review.missedContent.map((item, index) => <p key={index} className="warnline">계획 밖 누락 · p.{item.pages.join(", ")}: {item.reason}</p>)}
        <p className="muted">모델 검수 결과이며 정확성이나 학습 효과를 보장하지 않습니다. 코드 검사에서 보류된 문항은 아래 목표별 사유를 확인하세요.</p>
      </details>}
      {data.warnings.filter((item) => item.code !== "published-review-concern" || !item.ref).map((item, index) => <p key={index} className="warnline">{item.ref ? `${item.ref}: ` : ""}{item.message}</p>)}
    </section>
  );
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const kinds = (record: Record<string, number>) => Object.entries(record).sort((a, b) => b[1] - a[1]).map(([key, n]) => `${key} ${n}`).join(" · ") || "—";

/** Scorecard v0 (numbers only) with an optional second run beside it, e.g. the same PDF on another model or criteria. */
function ScorePanel({ id, status, real, runs, onError }: { id: string; status: string; real: boolean; runs: RunSummary[]; onError: (message: string) => void }) {
  const [own, setOwn] = useState<Scorecard | null>(null);
  const [judgeTick, setJudgeTick] = useState(0);
  const [otherId, setOtherId] = useState("");
  const [other, setOther] = useState<Scorecard | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => { api<{ score: Scorecard }>(`/api/lab/gen/${id}/score`).then((r) => setOwn(r.score), (e) => onError(e instanceof Error ? e.message : String(e))); }, 0);
    return () => clearTimeout(timer);
  }, [id, status, judgeTick, onError]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!otherId) { setOther(null); return; }
      api<{ score: Scorecard }>(`/api/lab/gen/${otherId}/score`).then((r) => setOther(r.score), (e) => onError(e instanceof Error ? e.message : String(e)));
    }, 0);
    return () => clearTimeout(timer);
  }, [otherId, onError]);
  if (!own) return null;
  const rows: Array<[string, (score: Scorecard) => string]> = [
    ["모델", (s) => s.run.models.replace(/(outline|classify|design|author):/g, (m) => ({ "outline:": "목차 ", "classify:": "분류 ", "design:": "설계 ", "author:": "출제 " } as Record<string, string>)[m])],
    ["앞 단계", (s) => s.run.forkOf ? `${s.run.forkOf.genId.slice(4, 12)}에서 고정(${FORK_LABEL[s.run.forkOf.from]})` : "직접 실행"],
    ["기준", (s) => `${s.run.guideDir} ${s.calls.guideVersions.map((v) => v.split(":")[1].slice(0, 7)).filter((v, i, a) => a.indexOf(v) === i).join("/")}`],
    ["목차 · 분류 항목", (s) => `${s.counts.sections} · ${s.counts.items}`],
    ["목표(보조) · 고름", (s) => `${s.counts.objectives}(${s.counts.supportObjectives}) · ${s.counts.chosen}`],
    ["문제 · 빠짐", (s) => `${s.counts.questions} · ${s.counts.dropped}`],
    ["형식 객관식/단답/자기확인", (s) => `${s.formats.choice} / ${s.formats.short} / ${s.formats.selfCheck} (자기확인 ${percent(s.formats.selfCheckRatio)})`],
    ["목표 종류", (s) => kinds(s.objectiveKinds)],
    ["분류 성격", (s) => kinds(s.itemKinds)],
    ["목표로 안 쓰인 핵심·패턴·설명", (s) => `${s.unusedTargets.length}`],
    ["의심 신호", (s) => `${s.suspects.length}`],
    ["기출 검사: 검사 시도 · 거절", (s) => s.pastExam ? `${s.pastExam.checked} · ${s.pastExam.rejected}` : "—"],
    ["기출 검사: 게시 통과 / 게시 문항", (s) => s.pastExam ? `${s.pastExam.publishedPassed} / ${s.pastExam.published}` : "—"],
    ["경고", (s) => kinds(s.warnings)],
    ["판정 통과/의심/실패", (s) => s.judge?.summary ? `${s.judge.summary.pass} / ${s.judge.summary.suspect} / ${s.judge.summary.fail}` : "—"],
    ["판정: 노출·모호·정답오류·인정답안누락", (s) => s.judge?.summary ? `${s.judge.summary.exposed} · ${s.judge.summary.ambiguous} · ${s.judge.summary.answerWrong} · ${s.judge.summary.acceptedGap ?? "—"}` : "—"],
    ["판정: 맨손 정답(참고)", (s) => s.judge?.summary?.blindSolved !== undefined ? `${s.judge.summary.blindSolved}` : "—"],
    ["판정: 조건불일치·목표불일치·다른답·티나는오답", (s) => s.judge?.summary ? `${s.judge.summary.conditionMismatch} · ${s.judge.summary.objectiveMismatch} · ${s.judge.summary.nonUnique} · ${s.judge.summary.weakDistractors}` : "—"],
    ["판정: 깊이", (s) => s.judge?.summary ? kinds(s.judge.summary.depth) : "—"],
    ["판정단 시험: 검출 · 원본 비통과", (s) => s.judge?.trial ? `${s.judge.trial.caught}/${s.judge.trial.planted} · ${s.judge.trial.falseAlarms}/${s.judge.trial.originals}` : "—"],
    ["호출 · 실패 · 재시도", (s) => `${s.calls.total} · ${s.calls.failed} · ${s.calls.retries}`],
    ["모델 작업 시간", (s) => seconds(s.calls.elapsedMs)],
    ["토큰 입력/출력", (s) => `${s.calls.inputTokens.toLocaleString()} / ${s.calls.outputTokens.toLocaleString()}`],
  ];
  const candidates = runs.filter((run) => run.id !== id && run.status === "done");
  return (
    <section className="score">
      <h3>점수표 <small>숫자만 셉니다. 뜻·깊이 판정은 판정단(예정)</small></h3>
      <label>비교할 실행
        <select value={otherId} onChange={(event) => setOtherId(event.target.value)}>
          <option value="">없음</option>
          {candidates.map((run) => <option key={run.id} value={run.id}>{run.fileName} p.{run.pages[0]}–{run.pages.at(-1)} · {purposeLabel[run.purpose]} · {run.createdAt.slice(5, 16).replace("T", " ")}</option>)}
        </select>
      </label>
      <table className="calls"><thead><tr><th></th><th>이 실행</th>{other && <th>비교 실행</th>}</tr></thead>
        <tbody>{rows.map(([label, value]) => <tr key={label}><th>{label}</th><td>{value(own)}</td>{other && <td>{value(other)}</td>}</tr>)}</tbody>
      </table>
      {[own, other].filter((s): s is Scorecard => Boolean(s)).map((s, index) => (s.unusedTargets.length || s.suspects.length) ? (
        <details key={s.run.id}><summary>{index ? "비교 실행" : "이 실행"}: 안 쓰인 항목 {s.unusedTargets.length} · 의심 {s.suspects.length}</summary>
          <ul>{s.unusedTargets.map((item) => <li key={`${item.sectionId}-${item.n}`}>{item.sectionId} #{item.n} [{item.kind}] {item.content}</li>)}
            {s.suspects.map((item) => <li key={`${item.code}-${item.ref}`} className="warnline">{item.ref}: {item.message}</li>)}</ul>
        </details>) : null)}
      {status === "done" && <JudgePanel id={id} real={real} onDone={() => setJudgeTick((n) => n + 1)} onError={onError} />}
    </section>
  );
}

/**
 * Fixed-prefix rerun: keep this run's outline and classification (and objectives, for "출제만") and redo the rest
 * with other models or another criteria folder, so the comparison is not muddied by a different classification.
 */
function ForkPanel({ gen, onOpen, onError }: { gen: GenState; onOpen: (id: string) => void; onError: (message: string) => void }) {
  const real = gen.input.provider !== "fake";
  const astra = astraFamily(gen.input.engine);
  const designed = gen.sections.every((section) => section.design);
  const [from, setFrom] = useState<"design" | "author">("design");
  const [purpose, setPurpose] = useState<Purpose>(gen.input.purpose);
  const [note, setNote] = useState(gen.input.note);
  const [models, setModels] = useState<Record<GenStep, { model: string; effort: string }>>(() =>
    Object.fromEntries([...STEPS, ...STEPS_V3, ...STEPS_ASTRA].map((step) => [step, gen.input.models[step] ?? { ...DEFAULT_GEN_MODELS[step] }])) as Record<GenStep, { model: string; effort: string }>);
  const [guideDir, setGuideDir] = useState(gen.input.guideDir ?? "출제기준");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const steps: GenStep[] = astra ? (from === "design" ? STEPS_ASTRA : STEPS_ASTRA.slice(1)) : from === "design" ? ["design", "author"] : ["author"];
  const start = async () => {
    setBusy(true); onError("");
    try {
      const { gen: next } = await api<{ gen: GenState }>(`/api/lab/gen/${gen.id}/fork`, "POST", {
        from, guideDir, ...(astra && from === "design" ? { purpose, note } : {}), models: Object.fromEntries(steps.map((step) => [step, models[step]])), confirmed: real ? confirmed : undefined });
      setConfirmed(false);
      onOpen(next.id);
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <details className="score">
      <summary>앞 단계 고정 재실행 <small>{astra ? "자료 지도를 재사용해 계획부터, 또는 같은 목표로 출제·풀이·검수부터" : "목차·분류를 그대로 두고 뒤 단계만 다른 모델·기준으로"}</small></summary>
      <div className="row">
        <label className="chip"><input type="radio" checked={from === "design"} onChange={() => setFrom("design")} />설계부터 다시</label>
        <label className="chip"><input type="radio" checked={from === "author"} disabled={!designed || (astra && gen.input.purpose === "read")} onChange={() => setFrom("author")} />출제만 다시(같은 목표)</label>
      </div>
      {astra && from === "design" && <>
        <label>바꿀 학습 목적<select value={purpose} onChange={(event) => setPurpose(event.target.value as Purpose)}>{(Object.keys(purposeLabel) as Purpose[]).map((value) => <option key={value} value={value}>{purposeLabel[value]}</option>)}</select></label>
        <label>학습 메모<textarea rows={2} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      </>}
      {real && <table className="models"><tbody>{steps.map((step) => (
        <tr key={step}><th>{genStepLabel[step]}</th>
          <td><select value={models[step].model} onChange={(event) => setModels({ ...models, [step]: { ...models[step], model: event.target.value } })}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></td>
          <td><select value={models[step].effort} onChange={(event) => setModels({ ...models, [step]: { ...models[step], effort: event.target.value } })}>{EFFORTS.map((e) => <option key={e}>{e}</option>)}</select></td></tr>
      ))}</tbody></table>}
      {!astra && <label>출제기준 폴더<input value={guideDir} onChange={(event) => setGuideDir(event.target.value.trim())} placeholder="출제기준" /></label>}
      {astra && <p className="muted">astra 전용 지시문을 사용합니다. 설계부터 다시 할 때는 목적·메모를 바꾸고, 출제만 다시 할 때는 같은 목표로 모델을 비교할 수 있어요. 기출형은 아직 지원하지 않습니다.</p>}
      <p className="muted">목표 확인 없이 끝까지 돌아요. {astra ? `예상 호출: ${from === "design" ? "계획 1 + " : ""}묶음 수 × 3 + 전체 검수 1 (+수정·재검수). 첫 묶음 3문항, 이후 8문항씩 최대 2묶음 동시 진행. 전체 PDF를 다시 사용합니다.` : `예상 호출: 목차 수 × ${steps.length} (+재시도), 목차·분류 호출은 없음.`}</p>
      {real && <label className="check warn"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />실제 모델을 호출합니다</label>}
      <button className="primary" disabled={busy || (real && !confirmed)} onClick={() => void start()}>{busy ? "시작하는 중…" : "고정 재실행 시작"}</button>
    </details>
  );
}

type JudgeListItem = Omit<JudgeRun, "results"> & { questions: number };
const VERDICT_TONE: Record<string, string> = { 통과: "ok", 의심: "warn", 실패: "bad" };

/** Starts judge runs (평가 실행 / 판정단 시험) and shows per-question verdicts of the latest one. */
function JudgePanel({ id, real, onDone, onError }: { id: string; real: boolean; onDone: () => void; onError: (message: string) => void }) {
  const [list, setList] = useState<JudgeListItem[]>([]);
  const [detail, setDetail] = useState<JudgeRun | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const { runs } = await api<{ runs: JudgeListItem[] }>(`/api/lab/gen/${id}/judge`);
      setList((previous) => {
        if (previous.some((run) => ["queued", "running"].includes(run.status)) && !runs.some((run) => ["queued", "running"].includes(run.status))) setTimeout(onDone, 0);
        return runs;
      });
      const latest = runs[0];
      if (latest) setDetail((await api<{ run: JudgeRun }>(`/api/lab/gen/${id}/judge/${latest.id}`)).run);
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  }, [id, onDone, onError]);
  useEffect(() => { const initial = setTimeout(() => { void refresh(); }, 0); return () => clearTimeout(initial); }, [refresh]);
  const busy = list.some((run) => ["queued", "running"].includes(run.status));
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => { void refresh(); }, 3000);
    return () => clearInterval(timer);
  }, [busy, refresh]);
  const start = async (kind: "judge" | "trial") => {
    try { await api(`/api/lab/gen/${id}/judge`, "POST", { kind, confirmed: real ? confirmed : undefined }); setConfirmed(false); await refresh(); }
    catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  const shown = detail?.results.filter((result) => result.verdict !== "통과" || result.mutation) ?? [];
  return (
    <div className="judge">
      <h4>판정단 <small>전문가 sol·medium, 학습자 luna·low · 목차마다 호출 5번(시험은 두 배)</small></h4>
      {real && <label className="check warn"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />실제 모델을 호출합니다</label>}
      <div className="row">
        <button disabled={busy || (real && !confirmed)} onClick={() => void start("judge")}>평가 실행</button>
        <button disabled={busy || (real && !confirmed)} onClick={() => void start("trial")} title="통과한 문제에 결함을 심어 판정단이 잡는지 봅니다">판정단 시험</button>
        {busy && <span className="muted">판정 중…</span>}
      </div>
      {detail && (
        <>
          <p className="muted">최근 {detail.kind === "trial" ? "판정단 시험" : "평가"} · {STATUS[detail.status] ?? detail.status} · 호출 {detail.calls}번{detail.message ? ` · ${detail.message}` : ""}</p>
          {detail.trial && <p>심은 결함 {detail.trial.planted}개 중 {detail.trial.caught}개 검출 ({Object.entries(detail.trial.byKind).map(([kind, v]) => `${kind} ${v.caught}/${v.planted}`).join(", ")}) · 원본 비통과 {detail.trial.falseAlarms}/{detail.trial.originals}(실제 결함 포함, 오탐률 아님)</p>}
          <ul className="verdicts">{shown.map((result) => (
            <li key={result.questionId}>
              <span className={`tag ${VERDICT_TONE[result.verdict]}`}>{result.verdict}</span> {result.questionId}{result.mutation ? ` (심은 결함: ${result.mutation})` : ""}
              {result.reasons.length > 0 && <div className="warnline">{result.reasons.join(" · ")}</div>}
              {result.problems && <div>{result.problems}</div>}
              <small>맨손: {result.blind.answer || "—"} ({result.blind.grade}, 확신 {result.blind.confidence}) · 원문 학습자: {result.readers.map((reader) => `${reader.answer || "—"}(${reader.grade})`).join(" / ")} · 깊이 {result.checks.depth}</small>
            </li>
          ))}{!shown.length && detail.status === "done" && <li className="muted">모든 문항 통과</li>}</ul>
        </>
      )}
    </div>
  );
}

/**
 * 사용 흐름 점검 (만들면서 바로 읽기): when each thing the study screen shows became available, from the run's own
 * marks. The study screen polls every 5 s, so on screen each line can appear up to 5 s later than written here.
 * "읽는 쪽 알리기" does what the reader does on a page change, so the "reading unit first" order can be checked here.
 */
function FlowPanel({ gen, onChange, onError }: { gen: GenState; onChange: () => void; onError: (message: string) => void }) {
  const [page, setPage] = useState(gen.input.pageNumbers[0]);
  const marks = gen.timeline ?? [];
  const start = marks.find((mark) => mark.event === "start");
  const title = (sectionId?: string) => gen.sections.find((section) => section.id === sectionId)?.title ?? sectionId ?? "";
  const pagesOf = (sectionId?: string) => gen.sections.find((section) => section.id === sectionId)?.pages ?? [];
  const running = gen.status === "running" || gen.status === "queued";
  // Lab runs assume reading front to back (engine comparison); the reading position steers only study-screen runs.
  const steer = gen.input.origin === "study";
  const say = (mark: GenMark) => {
    switch (mark.event) {
      case "start": return mark.note && mark.note !== "outline" ? `다시 시작 (${mark.note}부터)` : "시작 — 읽기 화면·PDF·쉬운 설명·번역·물어보기는 이때부터";
      case "outline": return `목차 보임 · 단원 ${gen.sections.length}개`;
      case "plan": return `목표 보임 (쪽별 익힐 것) · ${gen.sections.reduce((sum, section) => sum + (section.design?.objectives.length ?? 0), 0)}개`;
      case "confirm": return "목표 확인을 기다림 (학습자 차례)";
      case "confirmed": return "목표 확인함";
      case "focus": return `읽는 쪽 → p.${mark.page}`;
      case "unit-start": return `${title(mark.sectionId)} 만들기 시작${mark.page ? ` (그때 읽는 쪽 p.${mark.page})` : ""}`;
      case "unit-done": return mark.questions ? `${title(mark.sectionId)} 문제 열림 · ${mark.questions}개${mark.held ? ` · 보류 ${mark.held}` : ""} → "이 쪽 문제 풀기"` : `${title(mark.sectionId)} 문제 없음${mark.held ? ` · 전부 보류 ${mark.held}` : ""}`;
      case "done": return "검수 끝 — 전체 완료";
      case "stopped": return `멈춤 (${mark.note ?? ""})`;
    }
  };
  // Was the unit holding the reading page (or the next one after it) the next unit started after each focus change?
  const followed = !steer ? [] : marks.flatMap((mark, index) => {
    if (mark.event !== "focus" || !mark.page) return [];
    const next = marks.slice(index + 1).find((later) => later.event === "unit-start");
    if (!next) return [];
    const open = gen.sections.filter((section) => {
      const done = marks.slice(0, marks.indexOf(next)).some((earlier) => earlier.event === "unit-start" && earlier.sectionId === section.id);
      return !done || section.id === next.sectionId;
    });
    const want = open.find((section) => section.pages.includes(mark.page!) || section.pages[0] > mark.page!) ?? open[0];
    return [{ page: mark.page, got: next.sectionId, want: want?.id, ok: !want || want.id === next.sectionId }];
  });
  const tell = async () => {
    try { await api(`/api/lab/gen/${gen.id}/focus`, "POST", { page }); onChange(); } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  if (!marks.length) return null;
  const t0 = start ? Date.parse(start.at) : Date.parse(marks[0].at);
  return (
    <details className="gen-v3" open>
      <summary>사용 흐름 점검 · 시작부터 각 화면 요소가 뜬 시각 (공부 화면은 5초마다 확인해 최대 5초 늦게 보임)</summary>
      <table className="calls"><thead><tr><th>경과</th><th>화면에 생기는 것</th><th>쪽</th></tr></thead>
        <tbody>{marks.map((mark, index) => (
          <tr key={index}><td>{seconds(Math.max(0, Date.parse(mark.at) - t0))}</td><td>{say(mark)}</td>
            <td>{mark.sectionId ? (() => { const pages = pagesOf(mark.sectionId); return pages.length ? `p.${pages[0]}–${pages.at(-1)}` : ""; })() : ""}</td></tr>
        ))}</tbody>
      </table>
      {followed.map((check, index) => (
        <p key={index} className={check.ok ? "muted" : "warnline"}>{check.ok ? "✓" : "✗"} p.{check.page}로 옮긴 뒤 다음 단원: {title(check.got)}{check.ok ? "" : ` (기대: ${title(check.want)})`}</p>
      ))}
      {!steer && <p className="muted">실험실 실행은 앞에서부터 순서대로 읽는다고 보고 모든 엔진이 원문 순서로 만들어요(읽는 쪽 우선은 공부 화면에서 만든 자료에만).</p>}
      {running && steer && (
        <div className="row">
          <span className="muted">읽는 쪽 알리기(읽기 화면이 쪽을 넘길 때 하는 일)</span>
          <input type="number" min={gen.input.pageNumbers[0]} max={gen.input.pageNumbers.at(-1)} value={page} onChange={(event) => setPage(Number(event.target.value))} style={{ width: 70 }} />
          <button onClick={tell}>알리기</button>
        </div>
      )}
    </details>
  );
}
