"use client";

// 작업대 · 흐름 (2026-10-24): boxes on a canvas. An input box holds text (and optionally 1–3 pages of a material);
// a model box has a name, model, effort and its own instruction, and takes whatever arrows bring in. Running goes
// along the arrows (one direction only for now; an arrow that would close a loop is refused), boxes whose inputs are
// ready run at the same time. Flows and the last results are kept in this browser.
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type FlowApi = {
  compose: (input: { system: string; user: string; model?: string; effort?: string; json?: boolean; schema?: Record<string, unknown> }) => Promise<string>;
  decks: () => Array<{ id: string; title: string; pages: number }>;
  pageText: (deckId: string, from: number, to: number) => Promise<{ title: string; text: string }>;
};

type InputData = { kind: "input"; name: string; text: string; deckId?: string; from?: number; to?: number };
/** format: "text" plain reply; "json" a JSON reply, held to `schema` (JSON Schema text) when one is given. */
type ModelData = { kind: "model"; name: string; model: string; effort: string; system: string; format?: "text" | "json"; schema?: string };
type BoxData = InputData | ModelData;
type Box = Node<BoxData>;
type RunState = { status: "idle" | "running" | "done" | "error"; output?: string; input?: string; error?: string; ms?: number };
type Saved = { name: string; nodes: Box[]; edges: Edge[] };

const MODELS = ["gpt-6-sol", "gpt-6-luna", "gpt-6-astra", "gpt-6.1-sol", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra"];
const EFFORTS: Array<[string, string]> = [["low", "낮음"], ["medium", "보통"], ["high", "높음"], ["xhigh", "최고"]];
const effortLabel = (e: string) => EFFORTS.find(([v]) => v === e)?.[1] ?? e;
const KEY_DRAFT = "recaller:flow:draft:v1";
const KEY_SAVED = "recaller:flow:saved:v1";
const uid = () => "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const edgeStyle = { markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 }, style: { strokeWidth: 1.6 } };

const REFINE = `너는 '프롬프트 다듬기' 담당이다. 학습자가 AI에게 보낼 지시를 받아, 의도는 바꾸지 않고 AI가 한 번에 잘 수행하도록 고쳐 쓴다.
- 학습자가 말한 것(대상, 개수, 형식, 난이도, 말투)은 빠짐없이 지킨다. 말하지 않은 조건을 새로 정하지 않는다.
- 자료가 함께 간다고 하면 자료에 근거하라고 적고, 자료 밖 내용은 따로 표시하게 한다.
- 결과의 모양(목록, 문제·보기·정답·해설 순서 같은)을 구체적으로 정한다.
- 목표 → 할 일 → 조건 → 출력 형식 순으로 짧게 쓴다. 이미 충분하면 거의 그대로 둔다.
다듬은 지시 본문만 출력한다.`;
// New model boxes start from this (Responses API shape: instructions = 역할·원칙·출력, input = arrows, plain text out).
// "이 박스를 기본값으로" replaces it in this browser.
const KEY_DEFAULT = "recaller:flow:default-model:v1";
const BUILTIN_MODEL: ModelData = {
  kind: "model", name: "새 모델", model: "gpt-6-sol", effort: "low", format: "text", schema: "",
  system: `[역할] 너는 ○○를 하는 AI다.
[원칙] 받은 입력에만 근거한다. 입력에 없는 내용은 그렇다고 밝힌다. 말하지 않은 조건을 지어내지 않는다.
[출력] (모양을 구체적으로: 예) 번호 붙인 5줄, 각 줄 한 문장. 수식은 $…$로 쓴다.)`,
};
const defaultModel = (): ModelData => ({ ...BUILTIN_MODEL, ...load<Partial<ModelData>>(KEY_DEFAULT, {}), kind: "model" });
const SCHEMA_EXAMPLE = `{
  "type": "object",
  "properties": {
    "items": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["items"],
  "additionalProperties": false
}`;
const RUN = "받은 지시를 그대로 수행한다. 자료가 붙어 있으면 자료에 근거하고, 자료에 없는 내용은 그렇다고 밝힌다. 수식은 $…$로 쓴다.";

function preset(): Saved {
  const n = (id: string, x: number, y: number, data: BoxData): Box => ({ id, type: typeOf(data), position: { x, y }, data });
  return {
    name: "다듬고 실행 (원본 비교)",
    nodes: [
      n("in1", 0, 40, { kind: "input", name: "내 지시", text: "핵심만 5줄로 정리" }),
      n("in2", 0, 260, { kind: "input", name: "자료", text: "", from: 1, to: 1 }),
      n("m1", 300, 0, { kind: "model", name: "다듬기", model: "gpt-6-sol", effort: "low", system: REFINE }),
      n("m2", 620, 60, { kind: "model", name: "실행 · 다듬은 지시", model: "gpt-6-sol", effort: "low", system: RUN }),
      n("m3", 620, 280, { kind: "model", name: "실행 · 원본 그대로", model: "gpt-6-sol", effort: "low", system: RUN }),
    ],
    edges: [
      { id: "e1", source: "in1", target: "m1", ...edgeStyle },
      { id: "e2", source: "m1", target: "m2", ...edgeStyle },
      { id: "e3", source: "in2", target: "m2", ...edgeStyle },
      { id: "e4", source: "in1", target: "m3", ...edgeStyle },
      { id: "e5", source: "in2", target: "m3", ...edgeStyle },
    ],
  };
}

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; }
}
function save(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full or blocked */ } }

const RunCtx = createContext<Record<string, RunState>>({});

function BoxView({ id, data, selected }: NodeProps<Box>) {
  const run = useContext(RunCtx)[id];
  const status = run?.status ?? "idle";
  const meta = data.kind === "model"
    ? `${data.model} · ${effortLabel(data.effort)}${data.format === "json" ? " · JSON" : ""}`
    : [data.text.trim() ? "글" : "", data.deckId ? `자료 p.${data.from ?? 1}${(data.to ?? 1) > (data.from ?? 1) ? "–" + data.to : ""}` : ""].filter(Boolean).join(" + ") || "비어 있음";
  const preview = run?.status === "error" ? run.error : data.kind === "input" && status === "idle" ? data.text : run?.output;
  return (
    <div className={`fb-box fb-${data.kind}${selected ? " sel" : ""}`} data-status={status}>
      {data.kind === "model" ? <Handle type="target" position={Position.Left} /> : null}
      <div className="fb-head">
        <span className="fb-kind">{data.kind === "model" ? "모델" : "입력"}</span>
        <strong>{data.name || "이름 없음"}</strong>
        <i className="fb-dot" title={status} />
      </div>
      <div className="fb-meta">{meta}{run?.ms ? ` · ${(run.ms / 1000).toFixed(1)}초` : ""}</div>
      {preview ? <div className="fb-preview">{preview}</div> : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
// "input" is a React Flow built-in type with its own frame, so input boxes use the type name "inbox".
const nodeTypes = { inbox: BoxView, model: BoxView };
const typeOf = (d: BoxData) => d.kind === "input" ? "inbox" : "model";
const fixTypes = (ns: Box[]) => ns.map((n) => ({ ...n, type: typeOf(n.data) }));

function reaches(edges: Edge[], from: string, to: string) {
  const seen = new Set<string>(); const stack = [from];
  while (stack.length) {
    const id = stack.pop()!; if (id === to) return true; if (seen.has(id)) continue; seen.add(id);
    for (const e of edges) if (e.source === id) stack.push(e.target);
  }
  return false;
}

function Flow({ api }: { api: FlowApi }) {
  const draft = useMemo(() => load<(Saved & { runs?: Record<string, RunState> }) | null>(KEY_DRAFT, null), []);
  const start = draft ?? preset();
  const [nodes, setNodes, onNodesChange] = useNodesState<Box>(fixTypes(start.nodes));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(start.edges);
  const [name, setName] = useState(start.name);
  const [runs, setRuns] = useState<Record<string, RunState>>(draft?.runs ?? {});
  const [busy, setBusy] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved[]>(() => load<Saved[]>(KEY_SAVED, []));
  const [msg, setMsg] = useState("");
  const decks = useMemo(() => api.decks(), [api]);

  useEffect(() => { save(KEY_DRAFT, { name, nodes, edges, runs }); }, [name, nodes, edges, runs]);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(""), 2500); return () => clearTimeout(t); }, [msg]);

  const sel = nodes.find((n) => n.id === selId) ?? null;
  const patch = (id: string, p: Partial<InputData> | Partial<ModelData>) =>
    setNodes((ns) => ns.map((n) => n.id === id ? { ...n, data: { ...n.data, ...p } as BoxData } : n));

  const isValidConnection = useCallback((c: Connection | Edge) =>
    c.source !== c.target && !reaches(edges, c.target, c.source) && nodes.find((n) => n.id === c.target)?.data.kind === "model"
    && !edges.some((e) => e.source === c.source && e.target === c.target), [edges, nodes]);
  const onConnect = useCallback((c: Connection) => setEdges((es) => addEdge({ ...c, ...edgeStyle }, es)), [setEdges]);

  const add = (kind: "input" | "model") => {
    const id = uid();
    const right = nodes.reduce((m, n) => Math.max(m, n.position.x), 0);
    const data: BoxData = kind === "model"
      ? defaultModel()
      : { kind, name: "새 입력", text: "", from: 1, to: 1 };
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type: typeOf(data), position: { x: kind === "model" ? right + 320 : 0, y: 80 + (ns.length % 4) * 70 }, data, selected: true }]);
    setSelId(id);
  };

  const runAll = async () => {
    if (busy) return;
    setBusy(true);
    const fresh: Record<string, RunState> = Object.fromEntries(nodes.map((n) => [n.id, { status: "idle" as const }]));
    setRuns(fresh);
    const set = (id: string, s: RunState) => setRuns((r) => ({ ...r, [id]: s }));
    const memo = new Map<string, Promise<string>>();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const get = (id: string): Promise<string> => {
      if (memo.has(id)) return memo.get(id)!;
      const p = (async () => {
        const n = byId.get(id)!; const d = n.data; const t0 = Date.now();
        set(id, { status: "running" });
        try {
          if (d.kind === "input") {
            let out = d.text.trim();
            if (d.deckId) {
              const from = Math.max(1, Math.min(d.from ?? 1, d.to ?? 1)), to = Math.min(Math.max(d.from ?? 1, d.to ?? 1), from + 2);
              const m = await api.pageText(d.deckId, from, to);
              out = `${out}${out ? "\n\n" : ""}[자료: ${m.title} p.${from}${to > from ? "–" + to : ""}]\n${m.text}`;
            }
            set(id, { status: "done", output: out, ms: Date.now() - t0 });
            return out;
          }
          const ins = edges.filter((e) => e.target === id).map((e) => byId.get(e.source)).filter((x): x is Box => !!x)
            .sort((a, b) => a.position.y - b.position.y);
          const texts = await Promise.all(ins.map((s) => get(s.id)));
          // Empty inputs (an input box left blank) drop out; one input goes as is, several get their box names.
          const parts = ins.map((s, i) => ({ name: s.data.name, text: texts[i].trim() })).filter((x) => x.text);
          const user = parts.length === 1 ? parts[0].text : parts.map((x) => `[${x.name}]\n${x.text}`).join("\n\n");
          let schema: Record<string, unknown> | undefined;
          if (d.format === "json" && d.schema?.trim()) {
            try { schema = JSON.parse(d.schema); } catch { throw new Error("JSON 스키마를 읽지 못했어요. 형식을 확인해 주세요."); }
          }
          const raw = await api.compose({ system: d.system.trim() || "받은 입력에 답한다.", user: user.trim() || "시작", model: d.model, effort: d.effort,
            ...(d.format === "json" ? { json: true, ...(schema ? { schema } : {}) } : {}) });
          let out = raw;
          if (d.format === "json") { try { out = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* keep as sent */ } }
          set(id, { status: "done", output: out, input: user, ms: Date.now() - t0 });
          return out;
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          set(id, { status: "error", error });
          throw e;
        }
      })();
      memo.set(id, p);
      return p;
    };
    await Promise.allSettled(nodes.map((n) => get(n.id)));
    setBusy(false);
  };

  const keep = () => {
    const nm = name.trim() || "이름 없는 흐름";
    const next = [{ name: nm, nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data })), edges }, ...saved.filter((s) => s.name !== nm)].slice(0, 40);
    setSaved(next); save(KEY_SAVED, next); setMsg(`'${nm}' 저장했어요`);
  };
  const open = (value: string) => {
    const f = value === "__preset" ? preset() : value === "__empty" ? { name: "새 흐름", nodes: [], edges: [] } : saved.find((s) => s.name === value);
    if (!f) return;
    setNodes(fixTypes(f.nodes)); setEdges(f.edges); setName(f.name); setRuns({}); setSelId(null);
  };
  const removeSaved = () => { const next = saved.filter((s) => s.name !== name); setSaved(next); save(KEY_SAVED, next); setMsg("저장 목록에서 지웠어요"); };
  const removeSel = () => { if (!sel) return; setNodes((ns) => ns.filter((n) => n.id !== sel.id)); setEdges((es) => es.filter((e) => e.source !== sel.id && e.target !== sel.id)); setSelId(null); };

  const run = sel ? runs[sel.id] : undefined;
  return (
    <div className="fb">
      <div className="fb-bar">
        <input className="fb-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="흐름 이름" />
        <button className="btn" onClick={keep}>저장</button>
        <select className="fb-open" value="" onChange={(e) => open(e.target.value)} aria-label="불러오기">
          <option value="">불러오기…</option>
          <option value="__preset">예시: 다듬고 실행 (원본 비교)</option>
          <option value="__empty">빈 흐름</option>
          {saved.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
        {saved.some((s) => s.name === name) ? <button className="btn fb-ghost" onClick={removeSaved}>저장본 지우기</button> : null}
        <span className="fb-msg">{msg}</span>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => add("input")}>+ 입력 박스</button>
        <button className="btn" onClick={() => add("model")}>+ 모델 박스</button>
        <button className="btn primary" disabled={busy || !nodes.length} onClick={runAll}>{busy ? "실행 중…" : "▶ 실행"}</button>
      </div>
      <div className="fb-main">
        <div className="fb-canvas">
          <RunCtx.Provider value={runs}>
            <ReactFlow
              nodes={nodes} edges={edges} nodeTypes={nodeTypes}
              onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} isValidConnection={isValidConnection}
              onSelectionChange={({ nodes: s }) => setSelId(s.length === 1 ? s[0].id : null)}
              fitView fitViewOptions={{ padding: 0.2 }} colorMode="system" deleteKeyCode={["Delete"]} proOptions={{ hideAttribution: true }}
            >
              <Background gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </RunCtx.Provider>
        </div>
        <aside className="fb-side">
          {!sel ? (
            <div className="fb-help">
              <strong>박스를 누르면 여기서 고쳐요</strong>
              <p>박스 오른쪽 점을 끌어 다른 모델 박스에 놓으면 화살표가 생겨요. 앞 박스의 출력이 뒤 박스의 입력으로 들어가요.</p>
              <p>화살표가 여러 개 들어오면 박스 이름표를 붙여 위에서부터 합쳐요.</p>
              <p>화살표나 박스를 고르고 Delete 키로 지워요. 되돌아가는 화살표(루프)는 아직 막혀 있어요.</p>
            </div>
          ) : (
            <div className="fb-form">
              <label>이름<input value={sel.data.name} onChange={(e) => patch(sel.id, { name: e.target.value })} /></label>
              {sel.data.kind === "model" ? (
                <>
                  <div className="fb-row">
                    <label>모델<input list="fb-models" value={sel.data.model} onChange={(e) => patch(sel.id, { model: e.target.value.trim() })} /></label>
                    <label>추론 강도<select value={sel.data.effort} onChange={(e) => patch(sel.id, { effort: e.target.value })}>
                      {EFFORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select></label>
                  </div>
                  <label>이 박스가 받는 지시 (instructions)<textarea rows={8} value={sel.data.system} onChange={(e) => patch(sel.id, { system: e.target.value })} /></label>
                  <label>출력 형식<select value={sel.data.format ?? "text"} onChange={(e) => patch(sel.id, { format: e.target.value as "text" | "json" })}>
                    <option value="text">글</option>
                    <option value="json">JSON</option>
                  </select></label>
                  {sel.data.format === "json" ? (
                    <label>JSON 스키마 (비우면 아무 JSON 객체)
                      <textarea rows={7} value={sel.data.schema ?? ""} placeholder={SCHEMA_EXAMPLE} onChange={(e) => patch(sel.id, { schema: e.target.value })} />
                      <span className="fb-note">스키마를 주면 그 모양을 지켜서 나와요(Structured Outputs). 모든 객체에 required와 {'"additionalProperties": false'}가 필요해요.</span>
                    </label>
                  ) : null}
                  <div className="fb-row fb-defaults">
                    <button className="btn" onClick={() => { const { kind: _k, name: _n, ...rest } = sel.data as ModelData; void _k; void _n; save(KEY_DEFAULT, rest); setMsg("새 모델 박스 기본값으로 저장했어요"); }}>이 박스를 기본값으로</button>
                    <button className="btn fb-ghost" onClick={() => { try { localStorage.removeItem(KEY_DEFAULT); } catch { /* blocked */ } setMsg("기본값을 처음대로 돌렸어요"); }}>기본값 처음대로</button>
                  </div>
                </>
              ) : (
                <>
                  <label>글<textarea rows={6} value={sel.data.text} onChange={(e) => patch(sel.id, { text: e.target.value })} /></label>
                  <label>자료 붙이기<select value={sel.data.deckId ?? ""} onChange={(e) => patch(sel.id, { deckId: e.target.value || undefined, from: 1, to: 1 })}>
                    <option value="">붙이지 않음</option>
                    {decks.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                  </select></label>
                  {sel.data.deckId ? (
                    <div className="fb-row fb-pages">
                      <label>시작 쪽<input type="number" min={1} value={sel.data.from ?? 1} onChange={(e) => patch(sel.id, { from: Math.max(1, Number(e.target.value) || 1) })} /></label>
                      <label>끝 쪽<input type="number" min={1} value={sel.data.to ?? 1} onChange={(e) => patch(sel.id, { to: Math.max(1, Number(e.target.value) || 1) })} /></label>
                      <span className="fb-note">최대 3쪽</span>
                    </div>
                  ) : null}
                </>
              )}
              {run?.status === "error" ? <p className="fb-err">{run.error}</p> : null}
              {run?.output ? (
                <div className="fb-out">
                  <div className="fb-out-head"><strong>출력</strong>
                    <button className="btn fb-ghost" onClick={() => { void navigator.clipboard?.writeText(run.output ?? ""); setMsg("출력을 복사했어요"); }}>복사</button></div>
                  <pre>{run.output}</pre>
                </div>
              ) : null}
              {run?.input ? <details className="fb-in"><summary>이 박스에 들어간 입력</summary><pre>{run.input}</pre></details> : null}
              <button className="btn fb-ghost fb-del" onClick={removeSel}>이 박스 지우기</button>
            </div>
          )}
        </aside>
      </div>
      <datalist id="fb-models">{MODELS.map((m) => <option key={m} value={m} />)}</datalist>
    </div>
  );
}

export default function FlowBench({ api }: { api: FlowApi }) {
  return <ReactFlowProvider><Flow api={api} /></ReactFlowProvider>;
}
