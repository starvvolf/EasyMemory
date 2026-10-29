// 도구를 쓰는 튜터(에이전트). 학습자의 질문에 답하려고 직접 보고, 돌려 보고, 필요하면 고친다.
// 초점은 "AI가 대신 개발"이 아니라 "개발 과정을 보여 주며 가르치기": 쓴 도구는 채팅에 한 줄씩 보인다.
// - 한 질문에 도구는 최대 MAX_STEPS번(호출 1번 = 한 걸음)
// - 고친 코드는 차이와 [되돌리기]를 남기고, 튜터가 고친 단계는 "직접 통과"로 치지 않는다
// - 학습자가 VS Code에서 저장하지 않은 파일은 고치지 않는다
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { lineDiff } from "./course.ts";
import { check, devStatus, peekDb, startDev, tryRequest } from "./learn.ts";
import { AiUnavailable, aiJson, S } from "./ai.ts";
import { bridgeContext, bridgeState, send as bridgeSend } from "./bridge.ts";
import { DATA, read, saveRun, stageProgress } from "./store.ts";

export const MAX_STEPS = 5;

export type ToolCard = { type: "tool"; icon: string; label: string; detail?: string; ok: boolean };
export type TourStep = { file: string; from: number; to: number; title: string; text: string; code: string };
export type TourCard = { type: "tour"; id: string; title: string; steps: TourStep[] };
export type DiffCard = { type: "diff"; id: string; file: string; why: string; diff: string; undone?: boolean };
export type AgentIO = {
  runId: string; n: number; ws: string;
  /** 지금까지의 수업 맥락(계획서·지금 순서·최근 대화·마지막 확인) */
  context: string;
  /** 채팅에 바로 보이게 */
  show: (card: ToolCard | DiffCard | TourCard) => Promise<void>;
  /** 도구를 쓰기 전 튜터의 한마디 */
  say: (text: string) => Promise<void>;
  /** 튜터가 고친 파일 때문에 저장 감지가 다시 확인하지 않게 */
  quiet: (ms: number) => void;
  /** explain: 설명만(고치기 도구를 주지 않음) */
  mode?: "normal" | "explain" | "tour";
  /** 답을 쓰는 대로 채팅에 흘려 보낸다(같은 key는 같은 말풍선). 엔진이 썼으면 streamed=true */
  stream?: (key: string, text: string) => Promise<void>;
  streamed?: boolean;
};

export const TOOLS = ["list_files", "read_file", "open_in_editor", "start_server", "send_request", "run_checks", "edit_file", "look_db", "none"] as const;
export type ToolName = (typeof TOOLS)[number];

const SYSTEM = `너는 웹 서버를 처음 배우는 학습자 옆에 앉은 친절한 강사이자, 학습자의 프로젝트 폴더를 직접 다룰 수 있는 개발자다.
목표는 대신 개발해 주는 게 아니라, 개발자가 어떻게 확인하고 고치는지 보여 주며 가르치는 것이다.

도구 (한 번에 하나씩, 결과를 보고 다음을 정한다)
- list_files {}: 작업 폴더의 파일 목록
- read_file {"path":"src/server.ts","from":1,"to":80}: 파일 읽기(줄 번호 포함)
- open_in_editor {"path":"src/server.ts","line":18,"toLine":24,"note":"여기를 보세요"}: 학습자의 VS Code에서 그 줄을 열고 강조. 학습자에게 보여 줄 곳은 꼭 이걸로 연다.
- start_server {}: 실습 서버 켜기(4101)
- send_request {"method":"GET","path":"/nothing","body":null,"as":null}: 실습 서버에 실제 요청(as는 "A"/"B"/null)
- run_checks {}: 이번 단계 자동 검사(판정은 검사기가 한다)
- look_db {"sql":"SELECT * FROM posts"}: 실습 서버의 DB를 읽기만(SELECT)
- edit_file {"path":"src/server.ts","find":"바꿀 원래 글(파일 안에 딱 한 번 나와야 함)","replace":"새 글","why":"왜 바꾸는지 한 줄"}: 코드 고치기
- none: 도구 없이 답을 마친다

원칙
- 한국어 해요체, 짧게. say에는 지금 무엇을 왜 하는지 한두 문장으로 말한다("직접 보내서 확인해 볼게요"). 마지막(none)에는 배운 점을 정리하고 학습자가 할 일을 말한다.
- 먼저 보고(읽기·요청 보내기), 그다음 설명한다. 추측으로 단정하지 않는다.
- 이번 단계에서 학습자가 직접 써야 할 핵심 줄([수업 계획서]의 고칠 곳)은 학습자가 "고쳐 줘", "정답 알려 줘"처럼 분명히 부탁할 때만 edit_file로 고친다. 그 외에는 줄을 열어 보여 주고 직접 써 보게 한다. 핵심이 아닌 곳(오타, 학습자가 망가뜨린 다른 줄, 학습자가 부탁한 실험)은 고쳐도 된다.
- 고칠 때는 why에 이유를 쓰고, 고친 뒤에는 run_checks나 send_request로 확인한다.
- 수업 계획서의 순서와 정답을 바꾸지 않는다. 예측 문제의 답을 미리 말하지 않는다.
- 도구는 최대 ${MAX_STEPS}번. 필요 없는 도구는 쓰지 않는다. 질문이 단순하면 바로 none.`;

const SCHEMA = S.obj({ say: S.str, tool: S.oneOf(...TOOLS), args: S.str });
type Step = { say: string; tool: ToolName; args: string };

export const safePath = (ws: string, p: string) => {
  const rel = String(p || "").replace(/\\/g, "/").replace(/^\.?\//, "");
  if (!rel || rel.includes("..") || path.isAbsolute(rel) || rel.startsWith(".recaller") || rel.startsWith("node_modules")) throw new Error(`이 경로는 다룰 수 없어요: ${p}`);
  return { rel, abs: path.join(ws, ...rel.split("/")) };
};

async function listFiles(ws: string) {
  const out: string[] = [];
  async function walk(dir: string, rel: string) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if ([".recaller", "node_modules", "data", ".git"].includes(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else {
        const lines = (await readFile(path.join(dir, e.name), "utf8").catch(() => "")).split(/\r?\n/).length;
        out.push(`${r} (${lines}줄)`);
      }
    }
  }
  await walk(ws, "");
  return out.sort();
}

/* ---------- 고친 것 되돌리기 ---------- */
export const editsDir = (runId: string) => path.join(DATA, "agent-edits", runId);
export type EditRecord = { id: string; file: string; before: string; after: string; at: string };

export async function undoEdit(runId: string, ws: string, id: string) {
  const rec = await read<EditRecord | null>(path.join(editsDir(runId), `${id}.json`), null);
  if (!rec) throw Object.assign(new Error("되돌릴 기록이 없어요."), { status: 404 });
  const { abs } = safePath(ws, rec.file);
  const now = await readFile(abs, "utf8");
  if (now.replace(/\r\n/g, "\n") !== rec.after.replace(/\r\n/g, "\n")) throw Object.assign(new Error("그 뒤에 파일이 또 바뀌어서 자동으로 되돌릴 수 없어요. VS Code에서 Ctrl+Z나 직접 고쳐 주세요."), { status: 409 });
  await writeFile(abs, rec.before);
  return rec;
}

/* ---------- 도구 실행 ---------- */
export async function runTool(io: AgentIO, tool: ToolName, args: Record<string, unknown>): Promise<string> {
  const { runId, n, ws } = io;
  if (tool === "list_files") {
    const files = await listFiles(ws);
    await io.show({ type: "tool", icon: "📂", label: "파일 목록을 봤어요", detail: files.join("\n"), ok: true });
    return files.join("\n");
  }
  if (tool === "read_file") {
    const { rel, abs } = safePath(ws, String(args.path));
    const live = bridgeState(runId);
    const unsaved = live?.file === rel && live.dirty && live.text ? live.text : null;
    const lines = (unsaved ?? (await readFile(abs, "utf8"))).split(/\r?\n/);
    const from = Math.max(1, Number(args.from) || 1);
    const to = Math.min(lines.length, Number(args.to) || Math.min(lines.length, from + 199));
    await io.show({ type: "tool", icon: "📄", label: `${rel} ${from}~${to}줄을 읽었어요${unsaved ? " (VS Code에서 고치는 중인 내용)" : ""}`, ok: true });
    return lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(3)}| ${l}`).join("\n");
  }
  if (tool === "open_in_editor") {
    const { rel } = safePath(ws, String(args.path));
    const line = Number(args.line) || 1;
    const sent = bridgeSend(runId, { type: "open", file: rel, line, toLine: Number(args.toLine) || undefined, note: args.note ? String(args.note) : undefined });
    await io.show({ type: "tool", icon: "👀", label: `VS Code에서 ${rel} ${line}번째 줄을 열었어요`, detail: args.note ? String(args.note) : undefined, ok: sent });
    return sent ? "열었음" : "VS Code가 연결돼 있지 않아 열지 못함(채팅에 [[파일:줄]]로 알려 줄 것)";
  }
  if (tool === "start_server") {
    const d = devStatus(runId).running ? devStatus(runId) : await startDev(runId);
    const ok = !!d.running;
    await io.show({ type: "tool", icon: "⏻", label: ok ? "실습 서버를 켰어요 (4101)" : "서버가 켜지지 않았어요", detail: ok ? undefined : (d.logs ?? []).slice(-8).join("\n"), ok });
    return ok ? "켜짐" : `켜지지 않음:\n${(d.logs ?? []).slice(-12).join("\n")}`;
  }
  if (tool === "send_request") {
    if (!devStatus(runId).running) await startDev(runId);
    const body = args.body === null || args.body === undefined || args.body === "" ? undefined : args.body;
    const r = await tryRequest(runId, { method: String(args.method || "GET"), path: String(args.path || "/"), body, as: args.as ? String(args.as) : undefined });
    const head = r.timedOut ? "답장 없음 (3초)" : r.error ? `연결 실패: ${r.error}` : String(r.status);
    await io.show({ type: "tool", icon: "▶", label: `${r.request} → ${head}`, detail: r.body ? r.body.slice(0, 400) : undefined, ok: !r.timedOut && !r.error });
    return `${r.request} → ${head}\n${JSON.stringify(Object.fromEntries(Object.entries(r.headers).filter(([k]) => ["content-type", "allow", "location"].includes(k))))}\n${r.body.slice(0, 1500)}`;
  }
  if (tool === "run_checks") {
    const res = await check(runId, n, "check");
    const bad = res.results.filter((x) => !x.ok);
    await io.show({ type: "tool", icon: "✓", label: `검사를 돌렸어요: ${res.passed}개 통과 · ${res.failed}개 실패`, detail: bad.slice(0, 4).map((x) => `✗ ${x.title}: 기대 ${x.failure?.expected} / 실제 ${x.failure?.actual}`).join("\n") || undefined, ok: res.failed === 0 });
    return !res.started ? `서버가 켜지지 않음: ${res.startError}` : bad.length ? bad.map((x) => `✗ ${x.title}: ${x.failure?.request ?? ""} 기대 ${x.failure?.expected} / 실제 ${x.failure?.actual} (위치 ${x.where?.file}:${x.where?.line})`).join("\n") : "모두 통과";
  }
  if (tool === "look_db") {
    const t = await peekDb(runId, String(args.sql ?? ""));
    await io.show({ type: "tool", icon: "🗄", label: `DB를 봤어요: ${t.sql.slice(0, 60)}`, detail: t.columns.length ? [t.columns.join(" | "), ...t.rows.slice(0, 8).map((r) => r.map((v) => String(v)).join(" | "))].join("\n") : t.note, ok: !t.note.startsWith("읽지") });
    return t.columns.length ? [t.columns.join(" | "), ...t.rows.map((r) => r.map((v) => String(v)).join(" | "))].join("\n") : t.note;
  }
  if (tool === "edit_file") {
    const { rel, abs } = safePath(ws, String(args.path));
    const live = bridgeState(runId);
    if (live?.file === rel && live.dirty) {
      await io.show({ type: "tool", icon: "✋", label: `${rel}은 VS Code에서 저장 안 한 변경이 있어서 고치지 않았어요`, ok: false });
      return "학습자가 저장하지 않은 변경이 있어 고치지 않음. 먼저 저장해 달라고 말할 것.";
    }
    const raw = await readFile(abs, "utf8");
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const text = raw.replace(/\r\n/g, "\n");
    const find = String(args.find ?? "").replace(/\r\n/g, "\n");
    const count = find ? text.split(find).length - 1 : 0;
    if (count !== 1) return `고치지 못함: 바꿀 글이 파일에 ${count}번 나옴(정확히 한 번이어야 함). read_file로 다시 보고 정확히 적을 것.`;
    const next = text.replace(find, String(args.replace ?? "").replace(/\r\n/g, "\n"));
    const after = next.replace(/\n/g, eol);
    const id = `e${Date.now().toString(36)}`;
    await mkdir(editsDir(runId), { recursive: true });
    await writeFile(path.join(editsDir(runId), `${id}.json`), JSON.stringify({ id, file: rel, before: raw, after, at: new Date().toISOString() } satisfies EditRecord));
    io.quiet(2500);
    await writeFile(abs, after);
    // 튜터가 고친 단계는 "직접 통과"가 아니다(정답 줄을 본 것과 같게 친다)
    await saveRun(runId, (r) => { stageProgress(r, n).hints.push({ level: 3, at: new Date().toISOString(), source: "agent-edit" }); });
    const diff = lineDiff(text.split("\n"), next.split("\n"));
    await io.show({ type: "diff", id, file: rel, why: String(args.why ?? ""), diff });
    const firstChanged = next.split("\n").findIndex((l, i) => l !== text.split("\n")[i]);
    bridgeSend(runId, { type: "open", file: rel, line: firstChanged + 1, note: "튜터가 고친 곳" });
    return `고쳤음:\n${diff}`;
  }
  return "";
}

/** 질문 하나에 대한 에이전트 실행. 마지막 답(문장)을 돌려준다.
 *  엔진: OpenCode(Node 24 이상 + 설치돼 있을 때, 2026-10-30 사용자 결정) → 없으면 아래의 작은 자체 루프. */
let loggedOcError = false;
export async function runAgent(io: AgentIO, question: string): Promise<string> {
  const oc = await import("./oc-engine.ts").then((m) => m.ready()).catch((e) => { if (!loggedOcError) { loggedOcError = true; console.error("[튜터 엔진] OpenCode 엔진 파일을 읽지 못해 기본 엔진을 써요:", (e as Error).message); } return null; });
  if (oc) return oc.run(io, question);
  return runAgentClassic(io, question);
}
export async function runAgentClassic(io: AgentIO, question: string): Promise<string> {
  let files = "";
  try { files = (await listFiles(io.ws)).join(", "); } catch { /* */ }
  const transcript: string[] = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    const user = [
      io.context,
      bridgeContext(io.runId),
      `[작업 폴더 파일] ${files}`,
      `[학습자 질문] ${question}`,
      transcript.length ? `[지금까지 한 일]\n${transcript.join("\n\n")}` : "",
      `[남은 도구 횟수] ${MAX_STEPS - step}${MAX_STEPS - step === 1 ? " — 이번엔 none으로 답을 마칠 것" : ""}`,
      'args는 JSON 글자로(예: "{\\"path\\":\\"src/server.ts\\"}", 도구가 없으면 "{}").',
    ].filter(Boolean).join("\n\n");
    const out = await aiJson<Step>(`agent${step}`, SYSTEM, user, SCHEMA, step > 0);
    const tool = TOOLS.includes(out.tool) ? out.tool : "none";
    if (tool === "none" || step === MAX_STEPS - 1) return out.say || "확인한 내용은 위에 있어요.";
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(out.args || "{}"); } catch { args = {}; }
    if (out.say?.trim()) { transcript.push(`(말함) ${out.say.trim()}`); await io.say(out.say.trim()); }
    let result = "";
    try { result = await runTool(io, tool, args); }
    catch (e) { result = `도구 실패: ${(e as Error).message}`; await io.show({ type: "tool", icon: "⚠", label: `${tool} 실패: ${(e as Error).message}`, ok: false }); }
    transcript.push(`[${tool} ${JSON.stringify(args)}]\n${result.slice(0, 4000)}`);
  }
  return "여기까지 확인했어요.";
}

export { AiUnavailable };
export const exists = (p: string) => stat(p).then(() => true, () => false);
