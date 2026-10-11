"use client";
// Lab screen for the v2 engine (docs/DECISIONS.md 2026-10-12): start a run, watch each call,
// confirm objectives once, and open the problems of each section as they are authored.
import { useCallback, useEffect, useState } from "react";
import type { GenCall, GenState, GenStep, Purpose } from "@/lib/study/gen/types";
import { defaultChosen, genStepLabel, purposeLabel } from "@/lib/study/gen/types";
import "./gen.css";

type Source = { id: string; fileName: string; pageCount: number; available: boolean };
type RunSummary = { id: string; createdAt: string; status: string; phase: string; fileName: string; pages: number[]; purpose: Purpose; provider: string; calls: number };
type CallSummary = Omit<GenCall, "system" | "user" | "reply">;
type Detail = { gen: GenState; label: string; calls: CallSummary[] };

const STEPS: GenStep[] = ["outline", "classify", "design", "author"];
const MODELS = ["gpt-6-sol", "gpt-6-astra", "gpt-6-luna"];
const EFFORTS = ["low", "medium", "high", "xhigh"];
const STATUS: Record<string, string> = {
  queued: "대기", running: "진행 중", "awaiting-confirm": "목표 확인 대기", "paused-usage-limit": "멈춤(한도)", "paused-login": "멈춤(로그인)",
  "paused-invalid": "멈춤(검사)", interrupted: "멈춤(서버)", failed: "실패", done: "완료",
};
const tone = (status: string) => status === "done" ? "ok" : status === "failed" ? "bad" : status === "awaiting-confirm" ? "ask" : status.startsWith("paused") || status === "interrupted" ? "warn" : "run";
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
          <h2>실행</h2>
          <ul className="gen-runs">
            {runs.map((run) => (
              <li key={run.id}>
                <button className={openId === run.id ? "on" : ""} onClick={() => setOpenId(run.id)}>
                  <span className={`tag ${tone(run.status)}`}>{STATUS[run.status] ?? run.status}</span>
                  <b>{run.fileName}</b>
                  <small>p.{run.pages[0]}–{run.pages.at(-1)} · {purposeLabel[run.purpose]} · {run.provider === "fake" ? "가짜" : "실제"} · 호출 {run.calls}</small>
                </button>
              </li>
            ))}
            {!runs.length && <li className="muted">아직 실행이 없어요.</li>}
          </ul>
        </aside>
        <section>{openId ? <RunView key={openId} id={openId} onChange={loadLists} onError={setError} /> : <p className="muted">왼쪽에서 새로 시작하거나 실행을 고르세요.</p>}</section>
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
    () => Object.fromEntries(STEPS.map((step) => [step, { model: "gpt-6-luna", effort: "low" }])) as Record<GenStep, { model: string; effort: string }>);
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const source = sources.find((candidate) => candidate.id === sourceId) ?? sources[0];
  const pages = source ? Array.from({ length: Math.max(0, Math.min(to, source.pageCount) - from + 1) }, (_, index) => from + index) : [];
  const setAll = (key: "model" | "effort", value: string) => setModels((current) => Object.fromEntries(STEPS.map((step) => [step, { ...current[step], [key]: value }])) as typeof current);

  const start = async () => {
    if (!source || !pages.length) return;
    setBusy(true); onError("");
    try {
      const { gen } = await api<{ gen: GenState }>("/api/lab/gen", "POST", {
        sourceId: source.id, fileName: source.fileName, pageNumbers: pages, purpose, note, provider, autoConfirm, models, confirmed: provider === "chatgpt" ? confirmed : undefined,
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
          <table className="models"><tbody>{STEPS.map((step) => (
            <tr key={step}><th>{genStepLabel[step]}</th>
              <td><select value={models[step].model} onChange={(event) => setModels({ ...models, [step]: { ...models[step], model: event.target.value } })}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></td>
              <td><select value={models[step].effort} onChange={(event) => setModels({ ...models, [step]: { ...models[step], effort: event.target.value } })}>{EFFORTS.map((e) => <option key={e}>{e}</option>)}</select></td></tr>
          ))}</tbody></table>
        </>}
      </fieldset>
      <label className="check"><input type="checkbox" checked={autoConfirm} onChange={(event) => setAutoConfirm(event.target.checked)} />목표 확인 없이 끝까지</label>
      {provider === "chatgpt" && <label className="check warn"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />실제 모델을 호출합니다(ChatGPT 사용량이 나갑니다)</label>}
      <p className="muted">쪽 {pages.length}개 · 예상 호출: 목차 1 + 목차 수 × {purpose === "read" ? "1" : "3"} (+재시도)</p>
      <button className="primary" disabled={busy || !source || !pages.length || (provider === "chatgpt" && !confirmed)}>{busy ? "시작하는 중…" : "시작"}</button>
    </form>
  );
}

function RunView({ id, onChange, onError }: { id: string; onChange: () => void; onError: (message: string) => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [doc, setDoc] = useState<{ sectionId: string; html: string } | null>(null);
  const [call, setCall] = useState<GenCall | null>(null);

  const load = useCallback(async () => {
    try { setDetail(await api<Detail>(`/api/lab/gen/${id}`)); } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  }, [id, onError]);
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
  const tokens = calls.reduce((sum, item) => ({ input: sum.input + (item.usage?.inputTokens ?? 0), output: sum.output + (item.usage?.outputTokens ?? 0) }), { input: 0, output: 0 });
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
        <b>{gen.input.fileName}</b> p.{gen.input.pageNumbers[0]}–{gen.input.pageNumbers.at(-1)} · {purposeLabel[gen.input.purpose]}
        {label && <span className="muted"> · {label}</span>}
        <div className="muted">호출 {gen.calls}번 · 모델 시간 {seconds(totalMs)} · 토큰 입력 {tokens.input.toLocaleString()} / 출력 {tokens.output.toLocaleString()}{formats.length ? ` · 응답 형식 ${formats.join(", ")}` : ""}</div>
        {gen.message && <p className={gen.status === "failed" ? "gen-error" : ""}>{gen.message}</p>}
        {(canResume || gen.status === "awaiting-confirm") && real && (
          <label className="check warn"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />실제 모델을 호출합니다</label>
        )}
        {canResume && <button className="primary" disabled={real && !confirmed} onClick={resume}>멈춘 곳부터 다시 시작</button>}
      </div>

      {gen.outlineWarnings?.map((warning, index) => <p key={index} className="warnline">{warning.message}</p>)}

      {gen.status === "awaiting-confirm" && (
        <div className="confirmbar">
          목표 {selected.size}/{objectives.length}개를 출제합니다.
          <button className="primary" disabled={real && !confirmed} onClick={confirm}>이 목표로 문제 만들기</button>
        </div>
      )}

      {gen.sections.map((section) => (
        <article key={section.id} className="gen-section">
          <h3>{section.title} <small>p.{section.pages.join(", ")}</small></h3>
          {section.classify && (
            <details><summary>내용 분류 {section.classify.items.length}개</summary>
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
              {section.author.documentPath && <button onClick={() => void openDoc(section.id)}>문제 보기</button>}
              {section.author.warnings.map((warning, index) => <p key={index} className="warnline">경고({warning.ref}): {warning.message}</p>)}
            </div>
          )}
          {doc?.sectionId === section.id && <iframe className="docframe" title={`${section.title} 문제`} srcDoc={doc.html} sandbox="allow-scripts" />}
        </article>
      ))}

      <h3>호출 기록</h3>
      <table className="calls"><thead><tr><th>#</th><th>단계</th><th>목차</th><th>시도</th><th>모델</th><th>형식</th><th>시간</th><th>토큰</th><th>결과</th></tr></thead>
        <tbody>{calls.map((item) => (
          <tr key={item.n} onClick={() => void openCall(item.n)} className={item.ok ? "" : "bad"}>
            <td>{item.n}</td><td>{genStepLabel[item.step]}</td><td>{item.sectionId ?? ""}</td><td>{item.attempt}</td><td>{item.model} {item.effort}</td>
            <td>{item.format ?? ""}</td><td>{seconds(item.ms)}</td><td>{item.usage ? `${item.usage.inputTokens ?? "?"}/${item.usage.outputTokens ?? "?"}` : ""}</td><td>{item.ok ? "응답" : item.error}</td>
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
