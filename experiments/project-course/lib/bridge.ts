// VS Code 확장(vscode-bridge)과 주고받기. 확장은 학습자 작업 폴더에서만 켜지고, 그 폴더로 진행 기록(run)을 찾는다.
// - 받는 것: 보는 파일·줄, 드래그한 부분, 저장 안 한 내용, 빨간 줄 (AI를 부르지 않고 저장만 해 둔다)
// - 보내는 것: open(줄 열고 강조), blank(빈칸 뼈대), note(줄 옆 안내), clear, toast
import path from "node:path";
import type { ServerResponse } from "node:http";
import { runs } from "./store.ts";

export type BridgeState = {
  at: string; file: string | null; line?: number;
  selection?: { from: number; to: number; text: string } | null;
  dirty?: boolean; text?: string | null; errors?: { line: number; message: string }[];
};
export type BridgeCommand =
  | { type: "open"; file: string; line: number; toLine?: number; note?: string; highlight?: boolean }
  | { type: "note"; file: string; line: number; note: string }
  | { type: "blank"; file: string; from: string; to?: string; text: string; note?: string }
  | { type: "clear" }
  | { type: "toast"; text: string };

const norm = (p: string) => { const r = path.resolve(p).replace(/\\/g, "/").replace(/\/$/, ""); return process.platform === "win32" ? r.toLowerCase() : r; };
const states = new Map<string, BridgeState>();
const streams = new Map<string, Set<ServerResponse>>();
let onChange: (runId: string) => void = () => {};
export function onBridgeChange(fn: (runId: string) => void) { onChange = fn; }

export async function hello(root: string) {
  const want = norm(root);
  const f = await runs();
  const run = [...f.runs].reverse().find((r) => Object.values(r.workspaces).some((w) => norm(w) === want));
  if (!run) throw Object.assign(new Error("이 폴더는 Recaller 코스의 작업 폴더가 아니에요."), { status: 404 });
  return { runId: run.id, stage: run.current };
}

export function events(runId: string, res: ServerResponse) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  res.write("retry: 3000\n\n");
  const set = streams.get(runId) ?? new Set();
  set.add(res); streams.set(runId, set);
  onChange(runId);
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  res.on("close", () => { clearInterval(ping); set.delete(res); if (!set.size) states.delete(runId); onChange(runId); });
}

export function setState(runId: string, s: Omit<BridgeState, "at">) {
  states.set(runId, { ...s, at: new Date().toISOString() });
  onChange(runId);
}
export const connected = (runId: string) => (streams.get(runId)?.size ?? 0) > 0;
export const bridgeState = (runId: string) => (connected(runId) ? states.get(runId) ?? null : null);

/** 확장에 명령을 보낸다. 연결돼 있지 않으면 false. */
export function send(runId: string, cmd: BridgeCommand) {
  const set = streams.get(runId);
  if (!set?.size) return false;
  for (const res of set) res.write(`data: ${JSON.stringify(cmd)}\n\n`);
  return true;
}

/** AI에게 줄 "지금 VS Code" 한 덩어리. */
export function bridgeContext(runId: string) {
  const s = bridgeState(runId);
  if (!s) return "";
  if (!s.file) return "[VS Code] 작업 폴더 밖의 파일을 보고 있음";
  const parts = [`[VS Code] 지금 ${s.file} ${s.line}번째 줄을 보고 있음${s.dirty ? " (저장 안 한 변경 있음)" : ""}`];
  if (s.selection) parts.push(`드래그한 부분 (${s.selection.from}~${s.selection.to}줄):\n${s.selection.text}`);
  if (s.errors?.length) parts.push(`빨간 줄(편집기 오류):\n${s.errors.map((e) => `- ${e.line}줄: ${e.message}`).join("\n")}`);
  return parts.join("\n");
}
