#!/usr/bin/env node
// Recaller 튜터 MCP 서버(11/4 사용자 "MCP에는 튜터로서 필요한 기능만"). Codex가 대화마다 이 파일을 띄운다(stdio, 줄마다 JSON-RPC).
// 도구 둘: 학습자 기록 보기 · 진행 방식 기억하기. 실제 일은 코스 서버(4100)가 한다 — 여기서는 넘기기만.
// 환경: RECALLER_URL(코스 서버 주소), RECALLER_CHAT(이 대화 id)
import { createInterface } from "node:readline";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const BASE = process.env.RECALLER_URL || "http://127.0.0.1:4100";
const CHAT = process.env.RECALLER_CHAT || "";
// 작업 폴더 읽기 (2026-11-05 A 실습 점검, [경계]): Windows에서는 Codex의 명령 실행(셸로 파일 읽기)이 샌드박스에 막혀
// "파일 읽기가 차단되어 loop.js를 확인하지 못했어요"가 됐다. 읽기만 하는 도구 둘을 여기서 직접 준다(작업 폴더 밖은 거절).
const WS = process.env.RECALLER_WS ? path.resolve(process.env.RECALLER_WS) : "";
const inWs = (rel) => { const p = path.resolve(WS, String(rel || ".")); return WS && (p === WS || p.startsWith(WS + path.sep)) ? p : null; };
function wsList() {
  const out = [];
  const walk = (dir, depth) => { for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const p = path.join(dir, e.name), rel = path.relative(WS, p).split(path.sep).join("/");
    if (e.isDirectory()) { if (depth < 3) walk(p, depth + 1); } else out.push(`${rel} (${statSync(p).size}B)`);
    if (out.length >= 200) return;
  } };
  walk(WS, 0);
  return out.length ? out.join("\n") : "(작업 폴더가 비어 있어요)";
}
function wsRead(rel) {
  const p = inWs(rel); if (!p) throw new Error("작업 폴더 밖은 읽지 않아요.");
  const text = readFileSync(p, "utf8");
  return text.length > 20000 ? `${text.slice(0, 20000)}\n…(20000자 이후 생략)` : text;
}

const TOOLS = [
  {
    name: "learner_profile",
    description: "학습자가 정해 둔 진행 방식(예: 완성 코드를 한 번에 주지 않기)과, 지난 대화들에서 배운 것 · 헷갈린 것을 본다. 대화를 시작할 때나 설명 수준을 정할 때 쓴다.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "학습자 기록 보기", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "list_workspace_files",
    description: "학습자 작업 폴더의 파일 목록(크기 포함). 학습자가 코드를 썼다고 하면 먼저 이걸로 어느 파일인지 본다.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "작업 폴더 목록", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "read_workspace_file",
    description: "학습자 작업 폴더의 파일 하나를 읽는다(작업 폴더 기준 경로, 예: loop.js). 학습자가 쓴 코드를 확인할 때 쓴다.",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "작업 폴더 기준 경로" } }, required: ["path"], additionalProperties: false },
    annotations: { title: "작업 폴더 파일 읽기", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
  if (name === "list_workspace_files" || name === "read_workspace_file") {
    try { return { content: [{ type: "text", text: name === "list_workspace_files" ? wsList() : wsRead(args?.path) }] }; }
    catch (e) { return { content: [{ type: "text", text: `읽지 못했어요: ${e.message}` }], isError: true }; }
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
