// 튜터 엔진: OpenCode(@opencode/sdk)를 이 프로세스 안에 띄워 쓴다 (2026-10-30 사용자 결정 "튜터엔진 opencode로 바꾸고").
// - 파일 찾기·읽기·고치기와 도구 반복은 OpenCode가 하고, 우리는 교육 정책·VS Code·기록을 플러그인으로 붙인다.
// - 정책: 읽기(read/glob/grep)와 우리 도구만 허용. 고치기(edit/write)는 허용하되 기록하고 "직접 통과 아님"으로 친다.
//   VS Code에서 저장 안 한 파일은 고치지 않는다. 명령 실행·웹·하위 에이전트 등은 막고 AI에게 보이지도 않게 한다.
// - AI: 앱과 같은 ChatGPT 로그인 토큰(요청마다 새로 붙임). 가짜 AI 모드(PC_FAKE_AI=1)에서는 안에 둔 가짜 서버.
// - Node 24 이상 + experiments/project-course/node_modules/@opencode/sdk 가 있어야 켜진다. 없으면 기존 작은 루프로.
import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { lineDiff, ROOT } from "./course.ts";
import { aiBudget, aiMode, AiUnavailable, chatGptBearer, countCalls } from "./ai.ts";
import { bridgeContext, bridgeState, send as bridgeSend } from "./bridge.ts";
import { editsDir, runTool, safePath, type AgentIO, type EditRecord, type ToolName } from "./agent.ts";
import { DATA, saveRun, stageProgress } from "./store.ts";

export const OC_VERSION = "2.2.1";
const MODEL = process.env.RECALLER_ASSIST_MODEL?.trim() || "gpt-6-sol";
const MAX_STEPS = 8;
const READ = new Set(["read", "glob", "grep"]);
const OURS = ["open_in_editor", "start_server", "send_request", "run_checks"] as const;
const EDITS = new Set(["edit", "write", "patch"]); // GPT 모델에서는 patch(apply_patch)로 고친다
const SHOWN = new Set([...READ, ...EDITS, ...OURS]);
/** 고치기 도구 입력에서 파일 경로들 */
const editPaths = (tool: string, input: any): string[] => tool === "patch"
  ? [...String(input?.patchText ?? "").matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map((m) => m[1].trim())
  : [String(input?.path ?? input?.filePath ?? "")].filter(Boolean);

const SYSTEM = `너는 웹 서버를 처음 배우는 학습자 옆에 앉은 친절한 강사이자, 학습자의 프로젝트 폴더를 직접 다룰 수 있는 개발자다.
목표는 대신 개발해 주는 게 아니라, 개발자가 어떻게 확인하고 고치는지 보여 주며 가르치는 것이다.

말투
- 한국어 해요체로만 쓴다("~합니다" 금지). 보통은 짧게(5~8문장). 학습자가 덩어리 설명을 부탁하면 넉넉하게. 어려운 말은 일상 비유로 풀고, 줄 번호를 짚는다.
- 코드에 나오는 이름·기호는 꼭 \`백틱\`으로 감싼다(학습자가 눌러서 다시 물어볼 수 있다). 파일·줄은 [[src/router.ts:21]]처럼 쓰면 눌러서 VS Code에서 열린다.
- 도구를 쓰기 전에 무엇을 왜 보는지 한 문장으로 말한다("직접 보내서 확인해 볼게요").

도구
- read/glob/grep으로 먼저 보고, 추측으로 단정하지 않는다. [VS Code]에 학습자가 보는 파일·줄이 있으면 그것부터 본다.
- 학습자에게 보여 줄 곳은 open_in_editor로 VS Code에서 연다.
- 동작을 확인할 때는 send_request(실제 요청)나 run_checks(자동 검사)를 쓴다. 명령 실행은 못 한다.

가르치는 순서(힌트는 한 번에 한 단계씩)
1. 어디를 보면 되는지(파일·줄)와 무엇을 확인할지
2. 무엇이 빠졌거나 틀렸는지
3. 어떻게 쓰면 되는지(코드 모양)
학습자가 "정답", "고쳐 줘"처럼 분명히 부탁하기 전에는 3단계(완성 코드)를 먼저 주지 않는다. 한 질문에 한 단계 위로만 올린다.
- 이번 단계에서 학습자가 직접 써야 할 핵심 줄([수업 계획서]의 고칠 곳)은 학습자가 분명히 부탁할 때만 edit로 고친다. 핵심이 아닌 곳(오타, 학습자가 망가뜨린 다른 줄)은 고쳐도 된다. 고친 뒤에는 run_checks나 send_request로 확인한다.
- 수업 계획서의 순서와 정답을 바꾸지 않는다. 예측 문제의 답을 미리 말하지 않는다.
- 마지막에는 배운 점 한 줄과 학습자가 지금 할 일을 말한다.`;

type Live = { io: AgentIO; before: Map<string, string>; steps: number; texts: string[]; cur: string; sid: string; lastFlush: number; chain: Promise<void> };
const live = new Map<string, Live>(); // sessionID → 지금 답하는 질문
const sessions = new Map<string, string>(); // runId:n → sessionID (대화를 이어 간다)

type Host = { oc: any; events: any[]; waiters: Set<() => void>; mockUrl?: string };
let host: Promise<Host | null> | null = null;

export function ready(): Promise<{ run: (io: AgentIO, q: string) => Promise<string> } | null> {
  if (process.env.PC_ENGINE === "classic" || aiMode() === "off") return Promise.resolve(null);
  if (Number(process.versions.node.split(".")[0]) < 24) return Promise.resolve(null);
  host ??= start().catch((e) => { startError = (e as Error).message; console.error("[튜터 엔진] OpenCode를 켜지 못해 기존 엔진을 써요:", startError); return null; });
  return host.then((h) => (h ? { run: (io: AgentIO, q: string) => run(h, io, q) } : null));
}
let startError = "";
export async function engineName() { return (await ready()) ? `OpenCode ${OC_VERSION}` : `기본${startError ? ` (OpenCode 실패: ${startError.slice(0, 160)})` : ""}`; }

async function start(): Promise<Host> {
  // Windows에서는 절대 경로를 그대로 import하면 안 되고 file:// 주소로 바꿔야 한다
  const { OpenCode } = await import(pathToFileURL(path.join(ROOT, "node_modules", "@opencode", "sdk", "dist", "index.js")).href);
  const fake = aiMode() === "fake";
  const mockUrl = fake ? await startMock() : undefined;
  const dir = path.join(DATA, "opencode");
  await mkdir(path.join(dir, "config"), { recursive: true });
  const config = {
    model: `rc/${MODEL}`, default_agent: "tutor", update: "disable", share: "disabled",
    providers: { rc: { name: "Recaller ChatGPT", package: fake ? "@opencode/ai/providers/openai/chat" : "@opencode/ai/providers/openai/responses",
      settings: { baseURL: mockUrl ?? "https://api.openai.com/v1", apiKey: "set-per-request" }, models: { [MODEL]: { capabilities: { tools: true } } } } },
    agents: { tutor: { mode: "primary", description: "Recaller 튜터", system: SYSTEM, steps: MAX_STEPS } },
  };
  const oc = await OpenCode.create({
    config: { directory: path.join(dir, "config"), project: false, content: JSON.stringify(config) },
    database: { path: path.join(dir, "sessions.db") },
    plugins: [policyPlugin(fake)],
  });
  const h: Host = { oc, events: [], waiters: new Set(), mockUrl };
  (async () => {
    for await (const e of oc.events.subscribe()) {
      onEvent(e);
      h.events.push(e); if (h.events.length > 4000) h.events.splice(0, 2000);
      for (const w of h.waiters) w();
    }
  })().catch((e) => console.error("[튜터 엔진] 이벤트가 끊겼어요:", (e as Error).message));
  console.log(`튜터 엔진: OpenCode ${OC_VERSION} (${fake ? "가짜 AI" : MODEL})`);
  return h;
}

/* ---------- 교육 정책·기록 플러그인 ---------- */
function policyPlugin(fake: boolean) {
  return {
    id: "recaller-tutor",
    setup: async (ctx: any) => {
      // 요청마다 지금 유효한 ChatGPT 토큰을 붙인다(한 시간마다 바뀜)
      if (!fake) await ctx.session.hook("http.request", async (ev: any) => {
        const token = await chatGptBearer();
        const hd = new Headers(ev.request.headers); hd.set("authorization", `Bearer ${token}`);
        ev.request = new Request(ev.request, { headers: hd });
      });
      await ctx.session.hook("title", (ev: any) => { ev.result = "튜터 대화"; }); // 제목 만들기 호출 생략
      await ctx.session.hook("context", (ev: any) => {
        const l = live.get(ev.sessionID);
        for (const k of Object.keys(ev.tools)) if (!SHOWN.has(k) || (l?.io.mode === "explain" && EDITS.has(k))) delete ev.tools[k];
      });
      await ctx.permission.hook("evaluate", (ev: any) => {
        if (process.env.OC_DEBUG) console.log("[oc perm]", ev.action, JSON.stringify(ev.resources), ev.effect);
        const l = live.get(ev.sessionID);
        if (READ.has(ev.action) || (OURS as readonly string[]).includes(ev.action)) { ev.effect = "allow"; return; }
        if (EDITS.has(ev.action)) {
          if (l?.io.mode === "explain") { ev.effect = "deny"; ev.message = "지금은 설명만 하는 시간이에요."; return; }
          const files: string[] = (ev.resources ?? []).map((r: string) => String(r).replace(/\\/g, "/"));
          if (files.some((f) => /(^|\/)(\.recaller|node_modules)(\/|$)/.test(f))) { ev.effect = "deny"; ev.message = "이 파일은 고칠 수 없어요."; return; }
          const st = l ? bridgeState(l.io.runId) : null;
          if (st?.dirty && st.file && files.some((f) => f === "*" || f.endsWith(st.file!))) { ev.effect = "deny"; ev.message = `${st.file}은 학습자가 VS Code에서 고치는 중(저장 안 함)이라 고치지 않아요. 먼저 저장해 달라고 말하세요.`; return; }
          ev.effect = "allow"; return;
        }
        ev.effect = "deny"; ev.message = "이 튜터는 그 도구를 쓸 수 없어요.";
      });
      await ctx.tool.hook("execute.before", async (ev: any) => {
        const l = live.get(ev.sessionID); if (!l) return;
        if (EDITS.has(ev.tool)) {
          for (const p of editPaths(ev.tool, ev.input)) {
            try { const { rel, abs } = safePath(l.io.ws, p.startsWith(l.io.ws) ? path.relative(l.io.ws, p) : p); l.before.set(rel, await readFile(abs, "utf8").catch(() => "")); } catch { /* */ }
          }
          l.io.quiet(4000); // 튜터가 쓴 저장을 "학습자가 저장했다"로 착각하지 않게
        }
      });
      await ctx.tool.hook("execute.after", async (ev: any) => {
        if (process.env.OC_DEBUG) console.log("[oc after]", ev.tool, ev.status, JSON.stringify(ev.input).slice(0, 200), ev.status === "error" ? String(ev.error?.message) : "");
        const l = live.get(ev.sessionID); if (!l) return;
        const ok = ev.status === "completed";
        const p = String(ev.input?.path ?? ev.input?.filePath ?? ev.input?.pattern ?? "");
        const relOf = (x: string) => (x.startsWith(l.io.ws) ? path.relative(l.io.ws, x) : x).replace(/\\/g, "/");
        if (ev.tool === "read") await l.io.show({ type: "tool", icon: "📄", label: ok ? `파일을 읽었어요: ${relOf(p)}` : `파일을 읽지 못했어요: ${relOf(p)}`, ok });
        else if (ev.tool === "glob" || ev.tool === "grep") await l.io.show({ type: "tool", icon: "🔎", label: `${ev.tool === "grep" ? "코드에서" : "파일을"} 찾아봤어요: ${String(ev.input?.pattern ?? "")}`, ok });
        else if (EDITS.has(ev.tool) && ok) { for (const f of editPaths(ev.tool, ev.input)) await recordEdit(l, relOf(f)); }
        else if (EDITS.has(ev.tool) && !ok) await l.io.show({ type: "tool", icon: "✋", label: `고치지 않았어요: ${String(ev.error?.message ?? "").slice(0, 120)}`, ok: false });
      });
      // 우리 도구: 기존 도구 코드를 그대로 쓴다(채팅 카드도 거기서 나온다)
      const desc: Record<(typeof OURS)[number], [string, Record<string, unknown>, string[]]> = {
        open_in_editor: ["학습자의 VS Code에서 그 파일·줄을 열고 강조한다. 학습자에게 보여 줄 곳은 꼭 이걸로 연다.", { path: { type: "string" }, line: { type: "number" }, toLine: { type: "number" }, note: { type: "string" } }, ["path", "line"]],
        start_server: ["학습자의 실습 서버(4101)를 켠다.", {}, []],
        send_request: ["실습 서버에 실제 HTTP 요청을 보내고 답장을 본다. as는 로그인한 사람(A/B) 또는 비움.", { method: { type: "string" }, path: { type: "string" }, body: {}, as: { type: "string" } }, ["method", "path"]],
        run_checks: ["이번 단계 자동 검사를 돌린다(통과 판정은 검사기가 한다).", {}, []],
      };
      await ctx.tool.transform((ed: any) => {
        for (const name of OURS) {
          const [description, properties, required] = desc[name];
          ed.add({ name, description, options: { codemode: false }, input: { type: "object", properties, required },
            execute: async (input: Record<string, unknown>, c: any) => {
              const l = live.get(c.sessionID);
              if (!l) return { content: "지금은 쓸 수 없어요." };
              try { return { content: (await runTool(l.io, name as ToolName, input ?? {})).slice(0, 6000) }; }
              catch (e) { await l.io.show({ type: "tool", icon: "⚠", label: `${name} 실패: ${(e as Error).message}`, ok: false }); return { content: `실패: ${(e as Error).message}` }; }
            } });
        }
      });
    },
  };
}

async function recordEdit(l: Live, rel: string) {
  const { io } = l;
  let abs: string; try { abs = safePath(io.ws, rel).abs; } catch { return; }
  const before = l.before.get(rel) ?? "";
  const after = await readFile(abs, "utf8").catch(() => "");
  if (before === after) return;
  const id = `e${Date.now().toString(36)}`;
  await mkdir(editsDir(io.runId), { recursive: true });
  await writeFile(path.join(editsDir(io.runId), `${id}.json`), JSON.stringify({ id, file: rel, before, after, at: new Date().toISOString() } satisfies EditRecord));
  // 튜터가 고친 단계는 "직접 통과"가 아니다(정답 줄을 본 것과 같게 친다)
  await saveRun(io.runId, (r) => { stageProgress(r, io.n).hints.push({ level: 3, at: new Date().toISOString(), source: "agent-edit" }); });
  const a = before.replace(/\r\n/g, "\n").split("\n"), b = after.replace(/\r\n/g, "\n").split("\n");
  await io.show({ type: "diff", id, file: rel, why: "", diff: lineDiff(a, b) });
  const first = b.findIndex((x, i) => x !== a[i]);
  bridgeSend(io.runId, { type: "open", file: rel, line: first + 1, note: "튜터가 고친 곳" });
}

/* ---------- 이벤트: 도구 앞의 한마디를 채팅에 ---------- */
function onEvent(e: any) {
  if (process.env.OC_DEBUG && /tool\.failed|execution\.failed/.test(e?.type)) console.log("[oc ev]", e.type, JSON.stringify(e.data).slice(0, 300));
  const l = live.get(e?.data?.sessionID); if (!l) return;
  const key = () => `${l.sid}:${l.steps}`;
  if (e.type === "session.step.started") { l.steps++; l.cur = ""; }
  else if (e.type === "session.tool.input.started") { const said = l.cur.trim(); l.cur = ""; if (said) emit(l, key(), said, true); } // 도구 앞의 한마디를 도구 결과보다 먼저
  else if (e.type === "session.text.delta") { l.cur += String(e.data.delta ?? ""); if (l.io.stream && Date.now() - l.lastFlush > 450) emit(l, key(), l.cur.trim(), false); }
  else if (e.type === "session.step.ended") {
    const said = l.cur.trim(); l.cur = "";
    if (e.data.finish === "tool-calls") { if (said) emit(l, key(), said, true); }
    else if (said) { l.texts.push(said); if (l.io.stream) emit(l, key(), said, true); }
  }
}

/** 말한 것을 채팅에: 흘려 보내기가 되면 같은 말풍선을 계속 고치고, 아니면 끝난 말만 한 번 */
function emit(l: Live, key: string, text: string, final: boolean) {
  if (!text) return;
  if (l.io.stream) {
    l.lastFlush = Date.now(); l.io.streamed = true;
    const stream = l.io.stream;
    l.chain = l.chain.then(() => stream(key, text)).catch(() => {});
  } else if (final) void l.io.say(text);
}

/* ---------- 질문 하나 ---------- */
async function run(h: Host, io: AgentIO, question: string): Promise<string> {
  await aiBudget("agent"); // 한도를 넘었으면 여기서 멈춘다
  const key = `${io.runId}:${io.n}`;
  let sid = sessions.get(key);
  if (!sid) { sid = (await h.oc.sessions.create({ location: { directory: io.ws } })).id as string; sessions.set(key, sid); }
  const l: Live = { io, before: new Map(), steps: 0, texts: [], cur: "", sid, lastFlush: 0, chain: Promise.resolve() };
  live.set(sid, l);
  const from = h.events.length;
  const text = [io.context, bridgeContext(io.runId), `[학습자 질문] ${question}`].filter(Boolean).join("\n\n");
  if (process.env.OC_DEBUG) console.log("[oc prompt]\n" + text);
  try {
    await h.oc.sessions.prompt({ sessionID: sid, text });
    const end = await new Promise<any>((resolve) => {
      const check = () => {
        const hit = h.events.slice(from).find((e) => e?.data?.sessionID === sid && /^session\.execution\.(succeeded|failed|interrupted)$/.test(e.type));
        if (hit) { h.waiters.delete(check); clearTimeout(timer); resolve(hit); }
      };
      const timer = setTimeout(() => { h.waiters.delete(check); resolve({ type: "timeout" }); }, 180_000);
      h.waiters.add(check); check();
    });
    await l.chain; // 흘려 보내던 글을 다 쓴 뒤에 끝낸다
    await countCalls(io.mode === "explain" ? "explain" : "agent", l.steps, end.type === "session.execution.succeeded");
    if (end.type === "timeout") { await h.oc.sessions.interrupt?.({ sessionID: sid }).catch(() => {}); return "생각이 너무 길어져서 멈췄어요. 질문을 조금 나눠서 다시 물어봐 주세요."; }
    if (end.type !== "session.execution.succeeded") {
      const msg = JSON.stringify(end.data?.error ?? end.data ?? "").slice(0, 300);
      if (/login|401|unauthorized/i.test(msg)) throw new AiUnavailable("login_required", "ChatGPT 로그인이 필요해요. Recaller 앱(3000)에서 로그인한 뒤 다시 해 주세요.");
      if (/usage|429|rate/i.test(msg)) throw new AiUnavailable("usage_limit", "ChatGPT 사용량 한도에 닿았어요.");
      return `답을 끝까지 만들지 못했어요. (${msg})`;
    }
    return l.texts.join("\n\n") || "확인한 내용은 위에 있어요.";
  } finally { live.delete(sid); }
}

/* ---------- 가짜 AI (시험용: 지금 보는 파일을 읽고 짧게 답한다) ---------- */
async function startMock(): Promise<string> {
  const srv = http.createServer(async (req, res) => {
    let b = ""; for await (const c of req) b += c;
    const j = JSON.parse(b || "{}");
    const tools: string[] = (j.tools || []).map((t: any) => t.function?.name).filter(Boolean);
    if (process.env.OC_DEBUG) console.log("[oc mock] tools", tools.join(","));
    const msgs: any[] = j.messages || [];
    const userText = String([...msgs].reverse().find((m) => m.role === "user")?.content ?? "");
    const toolDone = msgs.filter((m) => m.role === "tool").length;
    const lastUser = msgs.map((m) => m.role).lastIndexOf("user");
    const sinceUser = msgs.slice(lastUser + 1).filter((m) => m.role === "tool").length;
    res.writeHead(200, { "content-type": "text/event-stream" });
    const base = { id: "c", object: "chat.completion.chunk", created: 0, model: "fake" };
    const send = (o: unknown) => res.write(`data: ${JSON.stringify({ ...base, ...(o as object) })}\n\n`);
    const file = /src\/[\w./-]+\.ts/.exec(userText)?.[0] ?? "src/server.ts";
    const wantFix = /고쳐 주|정답 알려/.test(userText.split("[학습자 질문]").pop() ?? "");
    let call: { name: string; args: unknown; say: string } | null = null;
    if (tools.length && sinceUser === 0) call = { name: "read", args: { path: file }, say: `${file}부터 볼게요.` };
    else if (tools.length && sinceUser === 1 && wantFix) call = tools.includes("patch")
      ? { name: "patch", args: { patchText: "*** Begin Patch\n*** Update File: src/server.ts\n@@\n-    const found = router.match(method, url.pathname);\n+    const found = router.match(method, url.pathname); // 튜터가 고침\n*** End Patch" }, say: "부탁하셔서 고쳐 볼게요." }
      : { name: "edit", args: { path: "src/server.ts", oldString: "const found = router.match(method, url.pathname);", newString: "const found = router.match(method, url.pathname); // 튜터가 고침" }, say: "부탁하셔서 고쳐 볼게요." };
    else if (tools.length && sinceUser === 1) call = { name: "open_in_editor", args: { path: file, line: 18, note: "여기를 보세요" }, say: "VS Code에서 열어 드릴게요." };
    void toolDone;
    if (call) {
      send({ choices: [{ index: 0, delta: { role: "assistant", content: call.say, tool_calls: [{ index: 0, id: `c${Date.now()}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: null }] });
      send({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
    } else {
      send({ choices: [{ index: 0, delta: { role: "assistant", content: `(가짜 AI) **한 줄 요약**: ${file}의 이 덩어리는 편지를 받아 담당자를 찾아 주는 안내 데스크예요.\n- \`createServer\` → 서버를 만들어요\n- \`req\` → 받은 편지, \`res\` → 보낼 답장\n18번째 줄은 요청에 맞는 처리 함수를 찾는 줄이에요. [[src/router.ts:22]]에 이어져요.` }, finish_reason: null }] });
      send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return `http://127.0.0.1:${(srv.address() as { port: number }).port}/v1`;
}
