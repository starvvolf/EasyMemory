// 실습 서버: http://127.0.0.1:4100 — 대화로 배우는 실습(자유 대화 · Codex)의 튜터 화면 · 목표 · 기록 · VS Code 연결 · 앱 안 편집기.
// 2026-11-11 사용자 "예전에 정해진 코스용 기능도 빼도 될 듯": 코스 정하기 · 단계 수업 · 맛보기 · 코스 생성 · 실험방 · [막혔어요] 칸 등을 뺐다(git 기록에 있다).
// 앱(3000)과 따로 돈다. 튜터가 켜는 학습자 서버는 4101, 앱 안 편집기는 4103.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "../lib/course.ts";
import { PORTS, openAtStartup, updateBridgeIfOld, openEditor } from "../lib/learn.ts";
import { DATA, addRun, getRun, runs, saveRun, setActive, type Run } from "../lib/store.ts";
import { aiStatus } from "../lib/ai.ts";
import { markSent, pending } from "../lib/sync.ts";
import { killAll, nodeSupport, portFree } from "../lib/proc.ts";
import { installFakeAi } from "../lib/fake-ai.ts";
import { blockedRequest } from "../lib/guard.ts";
import { runSnippet } from "../lib/tutor-tools.ts";
import { floatInUse, openFloat, poll as floatPoll, setFloat, typing as floatTyping } from "../lib/float.ts";
import { askAbout, notifyLesson, practiceAct, practiceView, subscribe } from "../lib/practice.ts";
import { events as bridgeEvents, hello as bridgeHello, onBridgeChange, onBridgeSaved, setState as bridgeSetState } from "../lib/bridge.ts";

/** 대화 실습의 이름: Codex 대화(codex-chat) 또는 실험판 대화(agent-chat)의 학습자 첫 말, 60자. 못 읽으면 null. */
async function chatTitle(r: Run): Promise<string | null> {
  const id = r.codexId ?? r.chatId; if (!id || !/^[a-f0-9]{16}$/.test(id)) return null;
  const file = path.join(DATA, r.codexId ? "codex-chat" : "agent-chat", `${id}.json`);
  try {
    const c = JSON.parse(await readFile(file, "utf8")) as { messages?: Array<{ role?: string; text?: string }> };
    const first = c.messages?.find((m) => m.role === "user")?.text?.replace(/\s+/g, " ").trim();
    return first ? first.slice(0, 60) : null;
  } catch { return null; }
}
if (process.env.PC_FAKE_AI === "1") installFakeAi();

const PORT = Number(process.env.PC_PORT || PORTS.app);
const WEB = path.join(ROOT, "web");
const BOOT = Date.now().toString(36);
const isChat = (r: Run) => !!(r.chatId || r.codexId);

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw Object.assign(new Error("JSON이 아니에요."), { status: 400 }); }
}

type Handler = (req: IncomingMessage, m: RegExpExecArray, url: URL) => Promise<unknown>;
const routes: [string, RegExp, Handler][] = [
  // 실습 목록(앱의 실습 탭 · 튜터 화면 홈). 예전 정해진 코스 실습은 보이지 않는다(데이터는 남아 있다)
  ["GET", /^\/api\/status$/, async () => {
    const f = await runs();
    return { node: nodeSupport(), ai: await aiStatus(), engine: await import("../lib/oc-engine.ts").then((m) => m.engineName()).catch((e) => `기본 (엔진 파일 오류: ${(e as Error).message.slice(0, 120)})`), active: f.active ?? null, ports: PORTS,
      runs: await Promise.all(f.runs.filter(isChat).slice(-10).reverse().map(async (r) => ({ id: r.id, course: "chat", courseTitle: (await chatTitle(r)) ?? "새 실습", stageTitle: "대화로 배우기", createdAt: r.createdAt,
        current: 1, start: 1, done: 0, workspace: await (await import("../lib/goals.ts")).runWorkspace(r.id).catch(() => null), chat: true }))) };
  }],
  // 새 실습: 대화(기본 엔진 또는 Codex) + 빈 작업 폴더
  ["POST", /^\/api\/free$/, async (req) => {
    const b = await body(req);
    // 새 실습을 열면 하던 실습의 현재 목표는 진행 중으로 정리(11/12)
    { const was = (await runs()).active; if (was) (await import("../lib/ongoing.ts")).ongoingNow(was); }
    const plan = { start: 1, stages: [1], quick: [], transfer: false, reasons: ["대화로 배우기"], notes: [], minutes: 0 };
    const run: Run = { id: randomBytes(5).toString("hex"), courseId: "chat", createdAt: new Date().toISOString(), plan, current: 1, workspaces: {}, stages: {}, free: true };
    if (b.engine === "codex") { const cx = await (await import("../lib/codex-chat.ts")).create(); run.codexId = cx.id; run.workspaces = { chat: cx.workspace }; }
    else { const chat = await (await import("../lib/agent-chat.ts")).newChat({ course: null }); run.chatId = chat.id; run.workspaces = { chat: chat.workspace }; }
    await addRun(run);
    await (await import("../lib/learn.ts")).markChatFolder(run.workspaces.chat);
    await setActive(run.id);
    let editor: unknown = null;
    // 웹 화면에서 시작하면 VS Code만 열고 튜터 창은 띄우지 않는다(float: false)
    if (b.open !== false) { editor = await openEditor(run.id).catch((e) => ({ ok: false, message: (e as Error).message })); if (b.float !== false) openFloat(run.id, PORT); }
    return { runId: run.id, workspace: run.workspaces.chat, editor };
  }],
  ["GET", /^\/api\/runs\/(\w+)$/, async (_q, m) => {
    const r = await getRun(m[1]);
    if (!isChat(r)) throw Object.assign(new Error("예전 정해진 코스 실습은 11/11에 뺐어요. 새 실습으로 시작해 주세요."), { status: 410 });
    return { id: r.id, current: 1, chat: true, free: true, workspace: await (await import("../lib/goals.ts")).runWorkspace(r.id), dev: { running: false } };
  }],
  ["GET", /^\/api\/runs\/(\w+)\/lesson\/(\d+)$/, async (_q, m) => practiceView(m[1])],
  ["POST", /^\/api\/runs\/(\w+)\/lesson\/(\d+)\/act$/, async (req, m) => { await practiceAct(m[1], (await body(req)) as never); return practiceView(m[1]); }],
  // VS Code에서 고른 코드로 묻기(물어보기 · 이건 뭐예요? · 덩어리 설명): 대화에 그 코드를 붙여 넘긴다
  ["POST", /^\/api\/bridge\/ask$/, async (req) => { const b = await body(req); const run = await getRun(String(b.runId)); await askAbout(run.id, b as never); notifyLesson(run.id); return { ok: true }; }],
  ["POST", /^\/api\/codex-chat\/login$/, async () => (await import("../lib/codex-chat.ts")).login()],
  ["GET", /^\/api\/codex-chat\/([a-f0-9]{16})\/tools$/, async (_q, m) => {
    const run = (await runs()).runs.find((r) => r.codexId === m[1]);
    return { goals: run ? (await import("../lib/goals.ts")).goalToolsMcp() : [] };
  }],
  ["POST", /^\/api\/codex-chat\/([a-f0-9]{16})\/goal-tool$/, async (req, m) => {
    const b = await body(req);
    const run = (await runs()).runs.find((r) => r.codexId === m[1]);
    if (!run) throw Object.assign(new Error("이 대화에는 학습 목표 기능이 없어요."), { status: 400 });
    const learner = (await (await import("../lib/codex-chat.ts")).chatOf(m[1])).messages.filter((x) => x.role === "user").map((x) => x.text);
    const text = await (await import("../lib/goals.ts")).runGoalTool(run.id, String(b.name ?? ""), (b.args ?? {}) as Record<string, unknown>, learner);
    notifyLesson(run.id);
    return { text };
  }],
  ["GET", /^\/api\/codex-chat\/([a-f0-9]{16})\/learner$/, async (_q, m) => ({ text: await (await import("../lib/codex-chat.ts")).learnerProfile(m[1]) })],
  ["GET", /^\/api\/chats$/, async () => {
    const ac = await import("../lib/agent-chat.ts");
    const cx = await import("../lib/codex-chat.ts");
    const list = (await runs()).runs.filter((r) => r.chatId || r.codexId);
    const out = await Promise.all(list.map(async (r) => {
      try {
        const c = r.codexId ? await cx.view(r.codexId) : await ac.chatView(r.chatId!);
        const first = c.messages.find((m) => m.role === "user")?.text ?? "";
        return { runId: r.id, engine: r.codexId ? "codex" : "basic", title: first.replace(/\s+/g, " ").slice(0, 60) || "새 대화", at: c.messages.at(-1)?.at ?? r.createdAt, count: c.messages.filter((m) => m.role === "user").length, busy: c.busy, workspace: c.workspace };
      } catch { return null; }
    }));
    return out.filter((x) => x && x.count > 0).sort((a, b) => String(b!.at).localeCompare(String(a!.at)));
  }],
  ["GET", /^\/api\/lab\/practice\/(\w{4,40})$/, async (_q, m) => {
    const run = (await runs()).runs.find((r) => r.id === m[1]);
    if (!run || (!run.codexId && !run.chatId)) throw Object.assign(new Error("대화 실습이 아니에요."), { status: 404 });
    if (run.codexId) {
      const cx = await import("../lib/codex-chat.ts");
      const c = await cx.view(run.codexId);
      const { turns, busy } = await cx.turns(run.codexId);
      const { CHAT_MODELS } = await import("../lib/agent-chat.ts");
      return { runId: run.id, engine: "codex", chatId: run.codexId, model: (c as { model?: string }).model ?? CHAT_MODELS[0].id, models: CHAT_MODELS, busy, turns,
        live: busy ? c.messages.slice(-12) : [] };
    }
    const ac = await import("../lib/agent-chat.ts");
    const c = await ac.chatView(run.chatId!);
    return { runId: run.id, engine: "basic", chatId: run.chatId, model: (c as { model?: string }).model ?? ac.CHAT_MODELS[0].id, models: ac.CHAT_MODELS, busy: c.busy, turns: [],
      live: c.messages.slice(-30) };
  }],
  ["POST", /^\/api\/runs\/(\w+)\/activate$/, async (_q, m) => { await getRun(m[1]); const was = (await runs()).active; await setActive(m[1]); if (was && was !== m[1]) (await import("../lib/ongoing.ts")).ongoingNow(was); return { ok: true }; }],
  ["POST", /^\/api\/runs\/(\w+)\/snippet$/, async (req, m) => { await getRun(m[1]); const b = await body(req); return runSnippet(String(b.code ?? "")); }],
  ["POST", /^\/api\/bridge\/hello$/, async (req) => {
    const b = await body(req);
    const out = await bridgeHello(String(b.root ?? ""));
    // 옛 확장이 붙으면 새 것을 깔아 두고 "다시 불러오기"를 띄우게 한다(초보가 Reload Window를 몰라도 되게)
    const update = typeof b.version === "string" ? await updateBridgeIfOld(b.version).catch(() => false) : false;
    // 앱 안 편집기(11/11 사용자 "내 VS Code에서 열기 안 해도 그 UI 열린다"): 튜터가 이미 옆 칸에 있으니 떠 있는 튜터 창을 띄우지 않는다
    if (b.embedded === true) return { ...out, update, float: false };
    // 튜터 창을 쓸 수 있으면 그쪽으로 열고, 확장은 VS Code 탭을 저절로 열지 않는다
    if (out.runId) openFloat(out.runId, PORT);
    return { ...out, update, float: floatInUse() };
  }],
  ["POST", /^\/api\/bridge\/terminal$/, async (req) => { const b = await body(req); const id = String(b.runId ?? ""); await getRun(id); const r = await (await import("../lib/shell.ts")).learnerRan(id, b); if (r.running) return r; await (await import("../lib/moments.ts")).onCommand(id, String(b.command ?? ""), typeof b.exitCode === "number" ? b.exitCode : null, String(b.output ?? "")).catch(() => {}); await (await import("../lib/timeline.ts")).systemStep(id, `터미널: ${String(b.command ?? "").slice(0, 80)}`, { exitCode: b.exitCode ?? null }, 0, "system").catch(() => {}); return r; }],
  ["POST", /^\/api\/dev\/bridge\/(\w+)$/, async (req, m) => { const b = await body(req); const op = String(b.op ?? ""); const nav = await import("../lib/codenav.ts"); return { text: op === "debug" ? await nav.debugPeekTool(m[1], b) : await nav.codeNavTool(m[1], b) }; }],
  ["GET", /^\/api\/rechecks$/, async (req) => { const G = await import("../lib/gaps.ts"); const all = req.url?.includes("all=1"); const list = await G.rechecks({ due: !all }); return { items: list.slice(0, 30).map(G.recheckView), total: (await G.rechecks()).length }; }],
  ["POST", /^\/api\/rechecks\/(\w+)\/(G\d+-[0-9a-f]{4})$/, async (req, m) => {
    const b = await body(req); const G = await import("../lib/gaps.ts");
    const r = await G.answerRecheck(m[1], m[2], String(b.answer ?? ""), (g) => G.gradeRecheck(g, String(b.answer ?? "")));
    return { verdict: r.verdict.verdict, sameMistake: r.verdict.same_mistake, note: r.verdict.note, answer: r.gap?.recheck?.a ?? "", right: r.gap?.right ?? "", status: r.gap?.status, dueAt: r.gap?.dueAt ?? null };
  }],
  ["GET", /^\/api\/learner-note$/, async (q) => { const L = await import("../lib/learner-note.ts"); return new URL(q.url ?? "/", "http://x").searchParams.get("local") ? L.localNote() : L.learnerNote(); }],
  ["GET", /^\/api\/runs\/(\w+)\/goals-brief$/, async (_q, m) => {
    await getRun(m[1]);
    const g = await (await import("../lib/goals.ts")).goalsOf(m[1]);
    const sp = g.support && !g.support.back ? g.support.steps.find((x) => x.status === "doing") : null;
    return { long: g.long?.text ?? null, mode: g.mode, current: g.current ? { title: g.current.title, done: g.current.done, understood: g.current.understood, applied: g.current.applied } : null,
      support: sp ? { title: sp.title, target: g.support!.target.title } : null, map: g.map.filter((x) => !x.support).map((x) => ({ title: x.title, status: x.status })) };
  }],
  // 기억 도서관(11/11): 앱 기억 화면 › 실습의 목록 · 실습 한 판 정리
  ["GET", /^\/api\/library$/, async () => (await import("../lib/library.ts")).libraryList()],
  ["GET", /^\/api\/runs\/(\w+)\/library$/, async (_q, m) => { await getRun(m[1]); return (await import("../lib/library.ts")).libraryRun(m[1]); }],
  ["GET", /^\/api\/runs\/(\w+)\/moments$/, async (_q, m) => { await getRun(m[1]); return (await import("../lib/moments.ts")).momentsView(m[1]); }],
  ["GET", /^\/api\/runs\/(\w+)\/note$/, async (_q, m) => { await getRun(m[1]); return (await import("../lib/gaps.ts")).sessionNote(m[1]); }],
  ["POST", /^\/api\/bridge\/answer$/, async (req) => { const b = await body(req); return (await import("../lib/bridge.ts")).bridgeAnswer(String(b.id ?? ""), b.result ?? null); }],
  ["POST", /^\/api\/bridge\/state$/, async (req) => { const b = await body(req) as Record<string, never>; await getRun(String(b.runId)); const { runId, ...state } = b; bridgeSetState(runId, state); return { ok: true }; }],
  ["GET", /^\/api\/editor-web$/, async () => (await import("../lib/editor-web.ts")).status()],
  ["POST", /^\/api\/editor-web\/install$/, async () => (await import("../lib/editor-web.ts")).install()],
  ["POST", /^\/api\/runs\/(\w+)\/editor-web$/, async (_req, m) => {
    const folder = await (await import("../lib/goals.ts")).runWorkspace(m[1]);
    if (!folder) throw Object.assign(new Error("이 실습의 작업 폴더가 없어요."), { status: 409 });
    await (await import("../lib/learn.ts")).markChatFolder(folder);
    return { folder, url: await (await import("../lib/editor-web.ts")).urlFor(folder) };
  }],
  ["POST", /^\/api\/runs\/(\w+)\/editor$/, async (req, m) => { const b = await body(req).catch(() => ({} as Record<string, unknown>)); const out = await openEditor(m[1]); if (b.float !== false) openFloat(m[1], PORT); return out; }],
  ["POST", /^\/api\/runs\/(\w+)\/chat-options$/, async (req, m) => {
    const run = await getRun(m[1]);
    if (!run.chatId && !run.codexId) throw Object.assign(new Error("대화가 아닌 진행이에요."), { status: 400 });
    if (run.codexId) { const b = await body(req); await (await import("../lib/codex-chat.ts")).setOptions(run.codexId, { ...(b.model !== undefined ? { model: b.model } : {}), ...(b.edit !== undefined ? { edit: b.edit } : {}) }); }
    else await (await import("../lib/agent-chat.ts")).setChatOptions(run.chatId!, await body(req));
    notifyLesson(run.id);
    return practiceView(run.id);
  }],
  ["POST", /^\/api\/runs\/(\w+)\/learned$/, async (_q, m) => {
    const run = await getRun(m[1]);
    if (!run.chatId && !run.codexId) throw Object.assign(new Error("대화가 아닌 진행이에요."), { status: 400 });
    const cl = await import("../lib/chat-learned.ts");
    const key = run.codexId ? `codex-${run.codexId}` : run.chatId!;
    const msgs = run.codexId ? (await (await import("../lib/codex-chat.ts")).chatOf(run.codexId)).messages.filter((x) => x.role === "user" || x.role === "assistant") : (await (await import("../lib/agent-chat.ts")).chatOf(run.chatId!)).messages;
    const got = await cl.extractLearned(key, msgs);
    notifyLesson(run.id);
    return { accepted: got?.ok.length ?? 0, rejected: got?.bad ?? [], ...(await cl.learnedOf(key)) };
  }],
  ["POST", /^\/api\/runs\/(\w+)\/auto-check$/, async (req, m) => { const b = await body(req); await saveRun(m[1], (r) => { r.autoCheck = b.on !== false; }); notifyLesson(m[1]); return { autoCheck: b.on !== false }; }],
  ["POST", /^\/api\/runs\/(\w+)\/workspace$/, async (req, m) => {
    const b = await body(req);
    const run = await getRun(m[1]);
    if (!run.chatId && !run.codexId) throw Object.assign(new Error("대화가 아닌 진행이에요."), { status: 400 });
    const v = run.codexId ? await (await import("../lib/codex-chat.ts")).setOptions(run.codexId, { workspace: String(b.path ?? "") }) : await (await import("../lib/agent-chat.ts")).setChatWorkspace(run.chatId!, String(b.path ?? ""));
    await saveRun(run.id, (r) => { r.workspaces = { chat: v.workspace }; });
    await (await import("../lib/learn.ts")).markChatFolder(v.workspace);
    notifyLesson(run.id);
    return { workspace: v.workspace };
  }],
  ["POST", /^\/api\/debug\/cache-probe$/, async (req) => { const b = await body(req); const { cacheProbe } = await import("../lib/cacheprobe.ts"); return cacheProbe(Array.isArray(b.only) ? b.only.map(String) : undefined, Math.min(120000, Number(b.waitMs) || 0), b.apiKey === true, (b.headers && typeof b.headers === "object" ? b.headers : {}) as Record<string, string>); }],
  ["GET", /^\/api\/float$/, async (_q, _m, url) => { const p = floatPoll(url.searchParams.has("w")); let workspace: string | null = null;
    if (p.runId) workspace = (await (await import("../lib/goals.ts")).runWorkspace(p.runId).catch(() => null)) ?? null;
    return { ...p, workspace }; }],
  ["POST", /^\/api\/float$/, async (req) => setFloat(await body(req), PORT)],
  ["POST", /^\/api\/bridge\/typing$/, async () => { floatTyping(); return { ok: true }; }],
  ["GET", /^\/api\/runs\/(\w+)\/sync$/, async (_q, m) => { const run = await getRun(m[1]); return pending(run.id, run); }],
  ["POST", /^\/api\/dev\/eval\/judge$/, async (req) => { const b = await body(req) as { conds?: unknown; ids?: string[]; repeat?: number; set?: string }; return (await import("../lib/evals.ts")).startJudgeEval(Array.isArray(b.conds) ? b.conds as never : [{ name: "base-low", effort: "low" }], { ids: b.ids, repeat: b.repeat, set: b.set }); }],
  ["POST", /^\/api\/dev\/eval\/record$/, async (req) => { const b = await body(req) as { archive?: string; runIds?: string[]; efforts?: string[]; repeat?: number }; const { DATA } = await import("../lib/store.ts");
    // archive: .data/보관/<이름> (없으면 지금 데이터)
    const dir = b.archive ? path.join(DATA, "보관", path.basename(String(b.archive))) : DATA;
    return (await import("../lib/evals.ts")).startRecordEval({ dataDir: dir, runIds: (b.runIds ?? []).map(String), efforts: (b.efforts ?? ["low", "medium"]).map(String), repeat: b.repeat }); }],
  ["GET", /^\/api\/dev\/evals$/, async () => { const { DATA } = await import("../lib/store.ts"); const { readdir } = await import("node:fs/promises"); const xs = (await readdir(path.join(DATA, "evals")).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort().reverse(); return { items: xs.map((f) => f.replace(/\.json$/, "")) }; }],
  ["GET", /^\/api\/dev\/evals\/([\w-]+)$/, async (_q, m) => { const { DATA } = await import("../lib/store.ts"); const { readFile } = await import("node:fs/promises"); const r = JSON.parse(await readFile(path.join(DATA, "evals", `${m[1]}.json`), "utf8"));
    if (String(m[1]).startsWith("judge")) { const { loadCases } = await import("../lib/evals.ts"); const all = [...await loadCases("main"), ...await loadCases("holdout")]; r.cases = Object.fromEntries(all.map((c) => [c.id, c])); }
    return r; }],
  ["GET", /^\/api\/dev\/eval\/([\w-]+)$/, async (_q, m) => (await import("../lib/evals.ts")).jobOf(m[1]) ?? { status: "none" }],
  // 시연 준비(11/13, lib/demo.ts): 실습 한 판을 틀로 떠 두고, 시연용 실습을 그 틀로 되돌린다
  ["GET", /^\/api\/dev\/demo$/, async () => (await import("../lib/demo.ts")).demoList()],
  ["POST", /^\/api\/dev\/demo\/save$/, async (req) => { const b = await body(req); return (await import("../lib/demo.ts")).demoSave(String(b.name ?? ""), String(b.run ?? "")); }],
  ["POST", /^\/api\/dev\/demo\/reset$/, async (req) => { const b = await body(req); const r = await (await import("../lib/demo.ts")).demoReset(String(b.name ?? "")); notifyLesson(r.runId); return r; }],
  ["POST", /^\/api\/dev\/reset$/, async () => { const { archivePractice } = await import("../tools/reset-data.mjs"); const { DATA, PRACTICE } = await import("../lib/store.ts"); return archivePractice(DATA, "실험", PRACTICE) ?? { label: null, count: 0 }; }],
  ["GET", /^\/api\/memory$/, async () => ({ items: await (await import("../lib/memory.ts")).memoryOf() })],
  ["POST", /^\/api\/memory\/(m[a-f0-9]{6})$/, async (req, m) => (await import("../lib/memory.ts")).editMemory(m[1], await body(req))],
  ["GET", /^\/api\/runs\/(\w+)\/timeline$/, async (_q, m) => (await import("../lib/timeline.ts")).timelineView(m[1])],
  ["POST", /^\/api\/runs\/(\w+)\/end$/, async (_q, m) => (await import("../lib/practice.ts")).endLearning(m[1])],
  ["POST", /^\/api\/runs\/(\w+)\/redo-records$/, async (_q, m) => (await import("../lib/practice.ts")).redoGoalRecords(m[1])],
  ["POST", /^\/api\/runs\/(\w+)\/sync$/, async (req, m) => { await getRun(m[1]); const b = await body(req); return markSent(m[1], Array.isArray(b.keys) ? b.keys.map(String) : []); }],
  ["POST", /^\/api\/dev\/rerecord\/(\w+)$/, async (_q, m) => (await import("../lib/practice.ts")).rerecordWithLedger(m[1])],
];

const TYPES: Record<string, string> = { ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const blocked = blockedRequest(req.method ?? "GET", req.headers);
  if (blocked) { res.writeHead(403, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: blocked })); return; }
  try {
    const ev = /^\/api\/runs\/(\w+)\/events$/.exec(url.pathname);
    if (ev) { subscribe(ev[1], res); return; }
    if (url.pathname === "/api/bridge/events") {
      const id = url.searchParams.get("run") ?? "";
      await getRun(id);
      bridgeEvents(id, res);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      for (const [method, re, fn] of routes) {
        const m = re.exec(url.pathname);
        if (m && req.method === method) { json(res, 200, await fn(req, m, url)); return; }
      }
      json(res, 404, { error: "없는 주소예요." });
      return;
    }
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!/^[\w.-]+$/.test(file)) { res.writeHead(404); res.end(); return; }
    let data: Buffer | string = await readFile(path.join(WEB, file));
    // 새로 올린 화면 파일이 옛 것(캐시)으로 보이지 않게 주소에 켠 시각을 붙인다
    if (file === "index.html") data = data.toString("utf8").replace(/(app\.js|style\.css)(["'])/g, `$1?v=${BOOT}$2`);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  } catch (error) {
    const status = (error as { status?: number }).status ?? ((error as { code?: string }).code === "ENOENT" ? 404 : 500);
    if (status === 500) console.error(error);
    json(res, status, { error: (error as Error).message });
  }
});

onBridgeChange((id) => notifyLesson(id));
onBridgeSaved((id, file) => { import("../lib/practice.ts").then((m) => m.checkOnSave(id, file)).catch((e) => console.error("저장 확인:", e)); });
const shutdown = () => { killAll(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGHUP", shutdown);
process.on("exit", () => killAll());

if (!(await portFree(PORT))) {
  console.error(`${PORT}번 포트를 이미 쓰고 있어요. 코스 서버가 이미 켜져 있으면 http://127.0.0.1:${PORT} 을 여세요.`);
  process.exit(1);
}
// 학습자 작업 폴더는 이 폴더(.data) 아래에 있다 → Node · npm이 위로 올라가 실습 코스의 package.json("type": "module", 의존성)을 따르지 않게
// 데이터 폴더 맨 위에 빈 package.json을 둔다(11/8 실측: 학습자 require가 막히고, npm이 실습 코스 package.json에 설치함)
await (async () => { const { writeFile, access } = await import("node:fs/promises"); const { DATA } = await import("../lib/store.ts"); const f = (await import("node:path")).join(DATA, "package.json"); await access(f).catch(() => writeFile(f, JSON.stringify({ name: "recaller-practice-data", private: true, description: "학습자 작업 폴더가 위쪽(실습 코스) 설정을 따르지 않게 막는 빈 파일" }, null, 2) + "\n").catch(() => {})); })();
server.listen(PORT, "127.0.0.1", () => {
  const n = nodeSupport();
  console.log(`프로젝트 코스 실험: http://127.0.0.1:${PORT}  (창을 닫으면 실습 서버도 같이 꺼져요)`);
  if (!n.ok) console.log(n.message);
  if (process.env.PC_OPEN === "1") openAtStartup(PORT).catch((e) => console.error("VS Code 열기 실패:", e.message));
});
