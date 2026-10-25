// Recaller 에이전트 툴 MCP 서버 (stdio). Claude Code·Codex 같은 CLI 에이전트가 Recaller의 툴을 쓰게 한다.
// The tools themselves live in the Recaller app (src/lib/agent/tools.ts, served at /api/agent); this server only lists
// and forwards them, so one app process stays the only writer of the learner's data. Recaller must be running locally.
//
//   claude mcp add recaller -- node --experimental-strip-types tools/recaller-agent-mcp/server.ts
//   (codex) ~/.codex/config.toml: [mcp_servers.recaller] command = "node", args = ["--experimental-strip-types", "<repo>/tools/recaller-agent-mcp/server.ts"]
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const base = (process.env.RECALLER_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
// The app accepts writes from its own origin only; this local process says it is that origin.
const headers = { "Content-Type": "application/json", Origin: base };

async function api(path: string, init: RequestInit = {}) {
  let response: Response;
  try { response = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } }); }
  catch { throw new Error(`Recaller(${base})에 연결하지 못했어요. 'Recaller 시작.cmd'로 앱을 먼저 켜 주세요.`); }
  const data = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(data.message ?? `Recaller가 ${response.status}로 답했어요.`);
  return data;
}

const server = new Server({ name: "recaller-agent", version: "0.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const { tools } = await api("/api/agent") as { tools: Array<{ name: string; title: string; description: string; inputSchema: Record<string, unknown> }> };
  return { tools: tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: { type: "object", ...t.inputSchema } })) };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { result } = await api("/api/agent/call", { method: "POST", body: JSON.stringify({ tool: request.params.name, input: request.params.arguments ?? {} }) }) as { result: unknown };
    return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 1) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
  }
});
await server.connect(new StdioServerTransport());
