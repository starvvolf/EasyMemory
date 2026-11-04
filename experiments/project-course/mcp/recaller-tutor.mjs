#!/usr/bin/env node
// Recaller 튜터 MCP 서버(11/4 사용자 "MCP에는 튜터로서 필요한 기능만"). Codex가 대화마다 이 파일을 띄운다(stdio, 줄마다 JSON-RPC).
// 도구 둘: 학습자 기록 보기 · 진행 방식 기억하기. 실제 일은 코스 서버(4100)가 한다 — 여기서는 넘기기만.
// 환경: RECALLER_URL(코스 서버 주소), RECALLER_CHAT(이 대화 id)
import { createInterface } from "node:readline";

const BASE = process.env.RECALLER_URL || "http://127.0.0.1:4100";
const CHAT = process.env.RECALLER_CHAT || "";

const TOOLS = [
  {
    name: "learner_profile",
    description: "학습자가 정해 둔 진행 방식(예: 완성 코드를 한 번에 주지 않기)과, 지난 대화들에서 배운 것 · 헷갈린 것을 본다. 대화를 시작할 때나 설명 수준을 정할 때 쓴다.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "학습자 기록 보기", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "remember_preference",
    description: "학습자가 앞으로의 진행 방식을 말하면 기억한다(다음 대화에도 이어짐). quote는 학습자가 한 말에서 글자 그대로 옮긴 구절.",
    inputSchema: { type: "object", properties: { text: { type: "string", description: "기억할 진행 방식 한 문장" }, quote: { type: "string", description: "근거가 된 학습자 말 그대로" } }, required: ["text", "quote"], additionalProperties: false },
    annotations: { title: "진행 방식 기억", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

// 학습 목표 도구(11/4)는 코스 서버가 알려 준다(정의는 lib/goals.ts 한 곳). 제품 대화가 아니면 빈 목록
let goalTools = [];
async function listTools() {
  try { const r = await fetch(`${BASE}/api/codex-chat/${CHAT}/tools`); const j = await r.json(); goalTools = Array.isArray(j.goals) ? j.goals : []; } catch { goalTools = []; }
  return [...TOOLS, ...goalTools];
}
async function call(name, args) {
  if (goalTools.some((t) => t.name === name)) {
    const r = await fetch(`${BASE}/api/codex-chat/${CHAT}/goal-tool`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, args: args ?? {} }) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { content: [{ type: "text", text: String(j.text ?? "") }] } : { content: [{ type: "text", text: `학습 조정 실패: ${j.error || r.status}` }], isError: true };
  }
  const url = name === "learner_profile" ? `${BASE}/api/codex-chat/${CHAT}/learner` : `${BASE}/api/codex-chat/${CHAT}/preference`;
  const r = await fetch(url, name === "learner_profile" ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args ?? {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { content: [{ type: "text", text: j.error || `실패(${r.status})` }], isError: true };
  return { content: [{ type: "text", text: String(j.text ?? "") }] };
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return; // 알림(notifications/*)은 답하지 않는다
  try {
    if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "recaller", version: "0.1.0" } } });
    else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: await listTools() } });
    else if (m.method === "tools/call") {
      const name = m.params?.name;
      if (!TOOLS.some((t) => t.name === name) && !goalTools.some((t) => t.name === name)) send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "없는 도구예요." }], isError: true } });
      else send({ jsonrpc: "2.0", id: m.id, result: await call(name, m.params?.arguments) });
    } else if (m.method === "ping") send({ jsonrpc: "2.0", id: m.id, result: {} });
    else send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `모르는 요청: ${m.method}` } });
  } catch (e) {
    send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: `Recaller 코스 서버에 닿지 못했어요: ${e.message}` }], isError: true } });
  }
});
