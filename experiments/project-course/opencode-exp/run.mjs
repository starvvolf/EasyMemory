// OpenCode를 튜터 엔진으로 쓸 수 있는지 시험한다 (2026-10-29, D 스레드 실험).
// - OpenCode를 이 프로세스 안에 띄우고(@opencode/sdk), 교육 정책·행동 기록을 플러그인으로 붙인다.
// - 실제 코스 폴더는 건드리지 않는다: 진행 중인 코스의 작업 폴더를 .data/oc-exp/ws-*로 복사해서 쓴다.
// - AI: 앱과 같은 ChatGPT 로그인(api.openai.com/v1 Responses). OC_MOCK=1이면 가짜 AI(호출 없음).
// 결과: .data/oc-exp/result.json (토큰은 저장하지 않음)
import http from "node:http";
import { cp, mkdir, readFile, readdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { OpenCode } from "@opencode/sdk";

const HERE = import.meta.dirname;
const COURSE = path.resolve(HERE, "..");
const DATA = process.env.PC_DATA_DIR ? path.resolve(process.env.PC_DATA_DIR) : path.join(COURSE, ".data");
const OUT = path.join(DATA, "oc-exp");
const MOCK = process.env.OC_MOCK === "1";
const MODEL = process.env.OC_MODEL || "gpt-6-sol";
const say = (...a) => console.log(...a);

/* ---------- 작업 폴더: 진행 중인 코스의 이번 단계 폴더를 복사 ---------- */
async function sourceWorkspace() {
  if (process.env.OC_WS) return process.env.OC_WS;
  const runs = JSON.parse(await readFile(path.join(DATA, "runs.json"), "utf8"));
  const run = runs.runs.find((r) => r.id === runs.active) ?? runs.runs.at(-1);
  const dir = path.join(DATA, "workspaces");
  const name = (await readdir(dir)).find((n) => n.startsWith(`${run.id}-board`));
  if (!name) throw new Error("게시판 코스 작업 폴더를 찾지 못했어요.");
  return path.join(dir, name);
}

/* ---------- 가짜 AI (Responses API, 스트리밍) ---------- */
async function startMock() {
  let n = 0;
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const j = JSON.parse(body || "{}");
    const tools = (j.tools || []).map((t) => t.name).filter(Boolean);
    const lastTool = [...(j.input || [])].reverse().find((x) => x.type === "function_call_output");
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (o) => res.write(`event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`);
    const id = `resp_${++n}`;
    send({ type: "response.created", response: { id } });
    let item;
    const userText = JSON.stringify(j.input || "");
    if (tools.length && !lastTool) {
      const wantsFix = userText.includes("고쳐");
      item = wantsFix
        ? { type: "function_call", id: `fc_${n}`, call_id: `call_${n}`, name: "edit", arguments: JSON.stringify({ path: "src/server.ts", oldString: "const found", newString: "const found2" }) }
        : { type: "function_call", id: `fc_${n}`, call_id: `call_${n}`, name: "read", arguments: JSON.stringify({ path: "src/server.ts" }) };
    } else {
      item = { type: "message", id: `msg_${n}`, role: "assistant", content: [{ type: "output_text", text: tools.length ? "(가짜) 18번째 줄은 요청 주소에 맞는 처리 함수를 찾는 줄이에요." : "질문" }] };
    }
    send({ type: "response.output_item.added", output_index: 0, item });
    if (item.type === "message") send({ type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: item.content[0].text });
    send({ type: "response.output_item.done", output_index: 0, item });
    send({ type: "response.completed", response: { id, output: [item], usage: { input_tokens: 10, output_tokens: 5 } } });
    res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { srv, url: `http://127.0.0.1:${srv.address().port}/v1` };
}

/* ---------- 교육 정책 + 행동 기록 ---------- */
const state = { policy: "explain", trail: [] };
const WRITES = new Set(["edit", "write", "patch", "shell", "bash"]);
const recaller = {
  id: "recaller-tutor-policy",
  setup: async (ctx) => {
    await ctx.permission.hook("evaluate", (ev) => {
      const before = ev.effect;
      // 정책: explain = 읽기만 / edit = 파일 고치기만 허용(명령 실행은 막음). 그 밖의 처음 보는 동작은 막는다.
      if (WRITES.has(ev.action)) {
        if (state.policy === "edit" && ev.action === "edit") ev.effect = "allow";
        else { ev.effect = "deny"; ev.message = "지금은 설명하는 시간이에요. 코드는 학습자가 직접 고쳐요. 무엇을 어떻게 고치면 되는지 설명해 주세요."; }
      } else if (ev.action === "read" || ev.action === "glob" || ev.action === "grep") ev.effect = "allow";
      else if (ev.effect === "ask") ev.effect = "deny";
      state.trail.push({ at: Date.now(), kind: "permission", action: ev.action, resources: ev.resources, before, after: ev.effect });
    });
    await ctx.tool.hook("execute.before", (ev) => { state.trail.push({ at: Date.now(), kind: "tool.before", tool: ev.tool, input: ev.input }); });
    await ctx.tool.hook("execute.after", (ev) => {
      state.trail.push({ at: Date.now(), kind: "tool.after", tool: ev.tool, status: ev.status,
        error: ev.status === "error" ? String(ev.error?.message ?? ev.error).slice(0, 300) : undefined,
        result: ev.status === "completed" ? JSON.stringify(ev.result?.output ?? ev.result).slice(0, 400) : undefined });
    });
  },
};

const SYSTEM = `너는 Recaller의 개발 튜터다. 학습자는 프로그래밍을 처음 배우는 사람이다.
- 한국어 존댓말로, 짧고 쉽게. 어려운 말은 일상 비유로 풀어 준다.
- 설명하기 전에 필요한 파일을 직접 열어 보고, 몇 번째 줄인지 짚어서 말한다.
- 학습자 대신 코드를 고치지 않는다. 고칠 곳을 물으면 어디를 왜 바꾸면 되는지 단계로 알려 준다.
- 한 번에 너무 많이 말하지 않는다(5~8문장).`;

/* ---------- 실행 ---------- */
await mkdir(OUT, { recursive: true });
const result = { at: new Date().toISOString(), mock: MOCK, model: MODEL, node: process.version, steps: [], errors: [] };
const t0 = Date.now();
let token = "x", baseURL = "https://api.openai.com/v1", mock = null;
if (MOCK) { mock = await startMock(); baseURL = mock.url; }
else {
  const { chatGptToken } = await import("./token.ts");
  token = await chatGptToken();
  say("ChatGPT 로그인 확인됨");
}
const src = await sourceWorkspace();
const ws = path.join(OUT, `ws-${Date.now()}`);
await cp(src, ws, { recursive: true, filter: (p) => !p.includes(`${path.sep}.recaller${path.sep}check`) && !p.endsWith(".db") });
const before = await readFile(path.join(ws, "src", "server.ts"), "utf8");
const cfgDir = path.join(OUT, "config"); await mkdir(cfgDir, { recursive: true });

const config = {
  model: `rc/${MODEL}`,
  default_agent: "tutor",
  update: "disable",
  share: "disabled",
  providers: { rc: { name: "Recaller ChatGPT", package: "@opencode/ai/providers/openai/responses", settings: { baseURL, apiKey: token }, models: { [MODEL]: { capabilities: { tools: true } } } } },
  agents: { tutor: { mode: "primary", description: "Recaller 튜터", system: SYSTEM, steps: 6 } },
};
const oc = await OpenCode.create({ config: { directory: cfgDir, project: false, content: JSON.stringify(config) }, plugins: [recaller] });
const events = [];
const ctl = new AbortController();
(async () => { try { for await (const e of oc.events.subscribe({ signal: ctl.signal })) events.push({ t: Date.now(), type: e.type, e }); } catch {} })();

async function scenario(name, policy, text) {
  state.policy = policy;
  const from = state.trail.length, evFrom = events.length;
  const s0 = Date.now();
  say(`\n[${name}] 정책=${policy} 질문: ${text}`);
  const session = await oc.sessions.create({ location: { directory: ws } });
  try { await oc.sessions.prompt({ sessionID: session.id, text }); } catch (e) { result.errors.push(`${name}: ${e?.message ?? e}`); }
  // 끝날 때까지(성공/실패 이벤트) 기다림, 최대 3분
  let done = null;
  for (let i = 0; i < 720 && !done; i++) {
    done = events.slice(evFrom).find((x) => /session\.execution\.(succeeded|failed|interrupted)/.test(x.type) && JSON.stringify(x.e).includes(session.id));
    if (!done) await new Promise((r) => setTimeout(r, 250));
  }
  const mine = events.slice(evFrom).filter((x) => JSON.stringify(x.e).includes(session.id));
  const deltas = mine.filter((x) => x.type === "session.text.delta");
  const answer = deltas.map((x) => x.e?.data?.delta ?? x.e?.properties?.delta ?? x.e?.payload?.delta ?? "").join("");
  const firstText = deltas[0] ? deltas[0].t - s0 : null;
  const failed = mine.filter((x) => /failed/.test(x.type)).map((x) => JSON.stringify(x.e.data?.error ?? x.e).slice(0, 400));
  const step = {
    name, policy, question: text, ms: Date.now() - s0, firstTextMs: firstText, end: done?.type ?? "timeout",
    modelCalls: mine.filter((x) => x.type === "session.step.started").length,
    trail: state.trail.slice(from).map((x) => ({ ...x, at: x.at - s0 })),
    answer: answer || "(답 글을 이벤트에서 못 찾음)",
    failed,
    eventTypes: [...new Set(mine.map((x) => x.type))],
  };
  if (!answer) step.sampleEvents = mine.filter((x) => /text|message/.test(x.type)).slice(0, 3).map((x) => JSON.stringify(x.e).slice(0, 600));
  result.steps.push(step);
  say(`  → ${step.end}, ${(step.ms / 1000).toFixed(1)}초, AI 호출 ${step.modelCalls}번`);
  for (const t of step.trail.filter((x) => x.kind !== "tool.before")) say(`  · ${t.kind} ${t.tool ?? t.action} ${t.status ?? `${t.before}→${t.after}`}${t.error ? ` (${t.error.slice(0, 80)})` : ""}`);
  say(`  답: ${step.answer.slice(0, 600)}`);
}

try {
  await scenario("설명", "explain", "src/server.ts에서 `const found = router.match` 줄이 뭘 하는 건지 처음 배우는 사람에게 설명해 주세요.");
  await scenario("대신 고쳐 달라고 할 때", "explain", "src/server.ts에 잘못된 곳이 있으면 대신 고쳐 주세요.");
} catch (e) { result.errors.push(String(e?.stack ?? e)); }

const after = await readFile(path.join(ws, "src", "server.ts"), "utf8");
result.fileChanged = before !== after;
result.totalMs = Date.now() - t0;
result.workspace = ws;
ctl.abort();
await oc.close().catch(() => {});
mock?.srv.close();
// 이 실험의 AI 호출도 D 한도(.data/ai-usage.json)에 센다
if (!MOCK) {
  const file = path.join(DATA, "ai-usage.json");
  let u = { count: 0, calls: [] }; try { u = JSON.parse(await readFile(file, "utf8")); } catch {}
  const calls = result.steps.reduce((a, s) => a + s.modelCalls, 0) + result.steps.length; // + 제목 만들기
  u.count += calls; u.calls.push({ at: new Date().toISOString(), purpose: "opencode-exp", ok: !result.errors.length, note: `${calls}회(추정)` });
  await writeFile(file, JSON.stringify(u, null, 1));
  result.aiCallsCounted = calls;
}
await writeFile(path.join(OUT, "result.json"), JSON.stringify(result, null, 1));
say(`\n파일이 바뀌었나요? ${result.fileChanged ? "예 (문제!)" : "아니요 (정책대로)"}`);
say(`결과 파일: ${path.join(OUT, "result.json")}`);
if (result.errors.length) say("오류:", result.errors.join("\n"));
process.exit(0);
