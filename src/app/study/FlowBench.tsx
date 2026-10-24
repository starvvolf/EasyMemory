"use client";

// 작업대 · 흐름 (2026-10-24): boxes on a canvas. An input box holds text (and optionally 1–3 pages of a material);
// a model box has a name, model, effort and its own instruction, and takes whatever arrows bring in. Running goes
// along the arrows, boxes whose inputs are ready run at the same time. An arrow drawn back to an earlier box is a loop
// arrow ("다시"): the boxes in between run again until the box it leaves says stop (see flow-run.ts). Flows and the last
// results are kept in this browser.
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
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { closesLoop, DEFAULT_STOP, runFlow, type BoxRun, type FlowEdge, type StopRule } from "./flow-run";

export type FlowApi = {
  compose: (input: { system: string; user: string; model?: string; effort?: string; json?: boolean; schema?: Record<string, unknown> }) => Promise<string>;
  decks: () => Array<{ id: string; title: string; pages: number }>;
  pageText: (deckId: string, from: number, to: number) => Promise<{ title: string; text: string }>;
};

type InputData = { kind: "input"; name: string; text: string; deckId?: string; from?: number; to?: number };
/** format: "text" plain reply; "json" a JSON reply, held to `schema` (JSON Schema text) when one is given. */
/** stop: used when a loop arrow leaves this box (how many times it may run, and what output ends the loop). */
type ModelData = { kind: "model"; name: string; model: string; effort: string; system: string; format?: "text" | "json"; schema?: string; stop?: StopRule };
type BoxData = InputData | ModelData;
type Box = Node<BoxData>;
type RunState = BoxRun;
type Saved = { name: string; nodes: Box[]; edges: Edge[] };

const MODELS = ["gpt-6-sol", "gpt-6-luna", "gpt-6-astra", "gpt-6.1-sol", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra"];
const EFFORTS: Array<[string, string]> = [["low", "낮음"], ["medium", "보통"], ["high", "높음"], ["xhigh", "최고"]];
const effortLabel = (e: string) => EFFORTS.find(([v]) => v === e)?.[1] ?? e;
const KEY_DRAFT = "recaller:flow:draft:v1";
const KEY_SAVED = "recaller:flow:saved:v1";
const uid = () => "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const edgeStyle = { markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 }, style: { strokeWidth: 1.6 } };
// Loop arrows go back from right to left, so they take a stepped path around the boxes and are dashed.
const loopStyle = {
  type: "smoothstep", animated: true, label: "↺ 다시", data: { loop: true }, className: "fb-loop-edge",
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 }, style: { strokeWidth: 1.6, strokeDasharray: "6 4" },
  pathOptions: { offset: 36, borderRadius: 14 },
};
const isLoop = (e: Edge) => !!(e.data as { loop?: boolean } | undefined)?.loop;
const asFlowEdges = (es: Edge[]): FlowEdge[] => es.map((e) => ({ id: e.id, source: e.source, target: e.target, loop: isLoop(e) }));
const stopOf = (d: ModelData): StopRule => ({ ...DEFAULT_STOP, ...d.stop });
const stopLabel = (r: StopRule) => r.when === "json" ? `${r.field || "pass"} = ${r.value ?? "true"}이면 멈춤` : r.when === "text" ? `'${r.word ?? ""}' 나오면 멈춤` : "횟수만큼";

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

const WRITE = `[역할] 받은 지시대로 결과물을 쓴다.
[원칙] 자료가 붙어 있으면 자료에 근거하고, 자료에 없는 내용은 지어내지 않는다.
[검토 · 앞 회차]가 있으면 거기 적힌 지적을 모두 고친다. [작성 · 앞 회차 출력]이 있으면 그것을 고쳐 쓰고, 지적받지 않은 부분은 그대로 둔다.
[출력] 결과물 본문만. 수식은 $…$로 쓴다.`;
const CHECK = `[역할] 결과물이 지시와 자료를 지켰는지 검토한다.
[원칙] 틀린 내용, 자료에 없는 내용, 빠진 조건, 답이 둘 이상 되는 보기처럼 실제로 고쳐야 하는 것만 짚는다. 말투나 취향은 짚지 않는다.
고칠 것이 없으면 pass를 true로, 있으면 false로 하고 problems에 하나씩 적는다.
[출력] JSON.`;
const CHECK_SCHEMA = `{
  "type": "object",
  "properties": {
    "pass": { "type": "boolean" },
    "problems": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["pass", "problems"],
  "additionalProperties": false
}`;

function presetLoop(): Saved {
  const n = (id: string, x: number, y: number, data: BoxData): Box => ({ id, type: typeOf(data), position: { x, y }, data });
  return {
    name: "쓰고 검토해서 고치기 (반복)",
    nodes: [
      n("in1", 0, 20, { kind: "input", name: "지시", text: "자료 내용으로 개념을 묻는 4지선다 문제 1개 (정답, 해설 포함)" }),
      n("in2", 0, 240, { kind: "input", name: "자료", text: "", from: 1, to: 1 }),
      n("m1", 320, 40, { kind: "model", name: "작성", model: "gpt-6-sol", effort: "low", system: WRITE }),
      n("m2", 640, 140, { kind: "model", name: "검토", model: "gpt-6-sol", effort: "low", system: CHECK, format: "json", schema: CHECK_SCHEMA,
        stop: { max: 3, when: "json", field: "pass", value: "true" } }),
    ],
    edges: [
      { id: "e1", source: "in1", target: "m1", ...edgeStyle },
      { id: "e2", source: "in2", target: "m1", ...edgeStyle },
      { id: "e3", source: "m1", target: "m2", ...edgeStyle },
      { id: "e4", source: "in1", target: "m2", ...edgeStyle },
      { id: "e5", source: "in2", target: "m2", ...edgeStyle },
      { id: "e6", source: "m2", target: "m1", ...loopStyle },
    ],
  };
}

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; }
}
function save(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full or blocked */ } }

const RunCtx = createContext<{ runs: Record<string, RunState>; loopFrom: Set<string> }>({ runs: {}, loopFrom: new Set() });

function BoxView({ id, data, selected }: NodeProps<Box>) {
  const { runs, loopFrom } = useContext(RunCtx);
  const run = runs[id];
  const status = run?.status ?? "idle";
  const meta = data.kind === "model"
    ? `${data.model} · ${effortLabel(data.effort)}${data.format === "json" ? " · JSON" : ""}`
    : [data.text.trim() ? "글" : "", data.deckId ? `자료 p.${data.from ?? 1}${(data.to ?? 1) > (data.from ?? 1) ? "–" + data.to : ""}` : ""].filter(Boolean).join(" + ") || "비어 있음";
  const preview = run?.status === "error" ? run.error : data.kind === "input" && status === "idle" ? data.text : run?.output;
  const n = run?.rounds?.length ?? 0;
  const loopRule = data.kind === "model" && loopFrom.has(id) ? stopOf(data) : null;
  return (
    <div className={`fb-box fb-${data.kind}${selected ? " sel" : ""}`} data-status={status}>
      {data.kind === "model" ? <Handle type="target" position={Position.Left} /> : null}
      <div className="fb-head">
        <span className="fb-kind">{data.kind === "model" ? "모델" : "입력"}</span>
        <strong>{data.name || "이름 없음"}</strong>
        <i className="fb-dot" title={status} />
      </div>
      <div className="fb-meta">{meta}{run?.ms ? ` · ${(run.ms / 1000).toFixed(1)}초` : ""}{n > 1 ? ` · ${n}회` : ""}</div>
      {loopRule ? (
        <div className="fb-loop" data-ended={run?.ended ?? ""}>
          ↺ {run?.ended === "pass" ? `통과 (${n}회째)` : run?.ended === "max" ? `${n}회 다 돌고 멈춤` : `최대 ${loopRule.max}회 · ${stopLabel(loopRule)}`}
        </div>
      ) : null}
      {preview ? <div className="fb-preview">{preview}</div> : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
// "input" is a React Flow built-in type with its own frame, so input boxes use the type name "inbox".
const nodeTypes = { inbox: BoxView, model: BoxView };
const typeOf = (d: BoxData) => d.kind === "input" ? "inbox" : "model";
const fixTypes = (ns: Box[]) => ns.map((n) => ({ ...n, type: typeOf(n.data) }));

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

  // An arrow back to an earlier box becomes a loop arrow. A box can't loop onto itself (nothing to check it with).
  const isValidConnection = useCallback((c: Connection | Edge) =>
    c.source !== c.target && nodes.find((n) => n.id === c.target)?.data.kind === "model"
    && !edges.some((e) => e.source === c.source && e.target === c.target), [edges, nodes]);
  const onConnect = useCallback((c: Connection) => {
    const loop = closesLoop(asFlowEdges(edges), c.source, c.target);
    setEdges((es) => addEdge({ ...c, ...(loop ? loopStyle : edgeStyle) }, es));
    if (loop) setMsg("↺ 되돌아가는 화살표예요. 화살표가 나가는 박스에서 멈춤 조건을 정해요");
  }, [edges, setEdges]);
  const loopFrom = useMemo(() => new Set(edges.filter(isLoop).map((e) => e.source)), [edges]);
  const ctx = useMemo(() => ({ runs, loopFrom }), [runs, loopFrom]);
  const stopRef = useRef(false);
  const [round, setRound] = useState(0);

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
    setBusy(true); stopRef.current = false;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    try {
      await runFlow({
        boxes: nodes.map((n) => ({ id: n.id, name: n.data.name, order: n.position.y, stop: n.data.kind === "model" ? stopOf(n.data) : undefined })),
        edges: asFlowEdges(edges),
        stopped: () => stopRef.current,
        onRound: setRound,
        onRun: (id, r) => setRuns((all) => ({ ...all, [id]: r })),
        exec: async (box, ins) => {
          const d = byId.get(box.id)!.data;
          if (d.kind === "input") {
            let out = d.text.trim();
            if (d.deckId) {
              const from = Math.max(1, Math.min(d.from ?? 1, d.to ?? 1)), to = Math.min(Math.max(d.from ?? 1, d.to ?? 1), from + 2);
              const m = await api.pageText(d.deckId, from, to);
              out = `${out}${out ? "\n\n" : ""}[자료: ${m.title} p.${from}${to > from ? "–" + to : ""}]\n${m.text}`;
            }
            return { output: out };
          }
          // Empty inputs (an input box left blank) drop out; one input goes as is, several get their box names.
          const parts = ins.map((x) => ({ name: x.name, text: x.text.trim() })).filter((x) => x.text);
          const user = parts.length === 1 ? parts[0].text : parts.map((x) => `[${x.name}]\n${x.text}`).join("\n\n");
          let schema: Record<string, unknown> | undefined;
          if (d.format === "json" && d.schema?.trim()) {
            try { schema = JSON.parse(d.schema); } catch { throw new Error("JSON 스키마를 읽지 못했어요. 형식을 확인해 주세요."); }
          }
          const raw = await api.compose({ system: d.system.trim() || "받은 입력에 답한다.", user: user.trim() || "시작", model: d.model, effort: d.effort,
            ...(d.format === "json" ? { json: true, ...(schema ? { schema } : {}) } : {}) });
          let out = raw;
          if (d.format === "json") { try { out = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* keep as sent */ } }
          return { output: out, input: user };
        },
      });
    } finally {
      setBusy(false); setRound(0);
    }
  };

  const keep = () => {
    const nm = name.trim() || "이름 없는 흐름";
    const next = [{ name: nm, nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data })), edges }, ...saved.filter((s) => s.name !== nm)].slice(0, 40);
    setSaved(next); save(KEY_SAVED, next); setMsg(`'${nm}' 저장했어요`);
  };
  const open = (value: string) => {
    const f = value === "__preset" ? preset() : value === "__loop" ? presetLoop() : value === "__empty" ? { name: "새 흐름", nodes: [], edges: [] } : saved.find((s) => s.name === value);
    if (!f) return;
    setNodes(fixTypes(f.nodes)); setEdges(f.edges); setName(f.name); setRuns({}); setSelId(null);
  };
  const removeSaved = () => { const next = saved.filter((s) => s.name !== name); setSaved(next); save(KEY_SAVED, next); setMsg("저장 목록에서 지웠어요"); };
  const removeSel = () => { if (!sel) return; setNodes((ns) => ns.filter((n) => n.id !== sel.id)); setEdges((es) => es.filter((e) => e.source !== sel.id && e.target !== sel.id)); setSelId(null); };

  const run = sel ? runs[sel.id] : undefined;
  const [pick, setPick] = useState<{ id: string; i: number } | null>(null);
  const [cmp, setCmp] = useState(false);
  return (
    <div className="fb">
      <div className="fb-bar">
        <input className="fb-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="흐름 이름" />
        <button className="btn" onClick={keep}>저장</button>
        <select className="fb-open" value="" onChange={(e) => open(e.target.value)} aria-label="불러오기">
          <option value="">불러오기…</option>
          <option value="__preset">예시: 다듬고 실행 (원본 비교)</option>
          <option value="__loop">예시: 쓰고 검토해서 고치기 (반복)</option>
          <option value="__empty">빈 흐름</option>
          {saved.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
        {saved.some((s) => s.name === name) ? <button className="btn fb-ghost" onClick={removeSaved}>저장본 지우기</button> : null}
        <span className="fb-msg">{msg}</span>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => add("input")}>+ 입력 박스</button>
        <button className="btn" onClick={() => add("model")}>+ 모델 박스</button>
        {busy ? (
          <button className="btn" onClick={() => { stopRef.current = true; setMsg("지금 도는 박스까지만 하고 멈춰요"); }}>
            ■ 멈추기{round > 1 ? ` (${round}회차)` : ""}
          </button>
        ) : <button className="btn primary" disabled={!nodes.length} onClick={runAll}>▶ 실행</button>}
      </div>
      <div className="fb-main">
        <div className="fb-canvas">
          <RunCtx.Provider value={ctx}>
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
              <p>뒤 박스에서 앞 박스로 되돌아가는 화살표를 그으면 점선 <b>↺ 다시</b> 화살표가 돼요. 그 사이 박스들이 다시 돌고, 화살표가 나가는 박스(보통 검토 박스)의 멈춤 조건이 맞거나 최대 횟수가 되면 멈춰요.</p>
              <p>다시 도는 박스는 검토 결과와 자기 앞 회차 출력을 함께 받아요. 회차별 출력은 박스를 눌러 비교해요.</p>
              <p>화살표나 박스를 고르고 Delete 키로 지워요.</p>
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
                  {loopFrom.has(sel.id) ? (() => {
                    const r = stopOf(sel.data); const setStop = (p: Partial<StopRule>) => patch(sel.id, { stop: { ...r, ...p } });
                    return (
                      <fieldset className="fb-stop">
                        <legend>↺ 반복 · 이 박스에서 되돌아가요</legend>
                        <div className="fb-row">
                          <label>최대 횟수<input type="number" min={1} max={10} value={r.max} onChange={(e) => setStop({ max: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })} /></label>
                          <label>멈춤 조건<select value={r.when} onChange={(e) => setStop({ when: e.target.value as StopRule["when"] })}>
                            <option value="json">JSON 필드가 이 값이면</option>
                            <option value="text">출력에 이 말이 있으면</option>
                            <option value="none">횟수만큼 다 돌기</option>
                          </select></label>
                        </div>
                        {r.when === "json" ? (
                          <div className="fb-row">
                            <label>필드<input value={r.field ?? ""} placeholder="pass" onChange={(e) => setStop({ field: e.target.value })} /></label>
                            <label>값<input value={r.value ?? ""} placeholder="true" onChange={(e) => setStop({ value: e.target.value })} /></label>
                          </div>
                        ) : r.when === "text" ? (
                          <label>이 말<input value={r.word ?? ""} placeholder="통과" onChange={(e) => setStop({ word: e.target.value })} /></label>
                        ) : null}
                        <span className="fb-note">
                          {r.when === "json" && sel.data.format !== "json" ? "출력 형식을 JSON으로 해야 이 조건을 읽을 수 있어요. " : ""}
                          최대 횟수는 이 박스가 도는 횟수예요(첫 회 포함). 한 회차마다 사이 박스들이 한 번씩 더 호출돼요.
                        </span>
                      </fieldset>
                    );
                  })() : null}
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
              {run?.output ? (() => {
                const rs = run.rounds ?? [];
                const i = pick?.id === sel.id && pick.i < rs.length ? pick.i : rs.length - 1;
                const cur = rs[i] ?? { round: 1, output: run.output, input: run.input, ms: run.ms ?? 0 };
                const prev = cmp && i > 0 ? rs[i - 1] : null;
                return (
                  <>
                    <div className="fb-out">
                      <div className="fb-out-head"><strong>출력</strong>
                        <button className="btn fb-ghost" onClick={() => { void navigator.clipboard?.writeText(cur.output); setMsg("출력을 복사했어요"); }}>복사</button></div>
                      {rs.length > 1 ? (
                        <div className="fb-rounds">
                          {rs.map((x, k) => <button key={k} className={k === i ? "on" : ""} onClick={() => setPick({ id: sel.id, i: k })}>{k + 1}회</button>)}
                          <label className="fb-cmp"><input type="checkbox" checked={cmp} onChange={(e) => setCmp(e.target.checked)} />앞 회차와 비교</label>
                        </div>
                      ) : null}
                      {prev ? <><div className="fb-note">{i}회</div><pre className="fb-prev">{prev.output}</pre><div className="fb-note">{i + 1}회</div></> : null}
                      <pre>{cur.output}</pre>
                    </div>
                    {cur.input ? <details className="fb-in"><summary>{rs.length > 1 ? `${i + 1}회에 ` : "이 박스에 "}들어간 입력</summary><pre>{cur.input}</pre></details> : null}
                  </>
                );
              })() : null}
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
