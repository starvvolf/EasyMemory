import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { DATA, read, update } from "./store.ts";
import { loadCourse, stageFiles } from "./course.ts";
import { writeWorkspace } from "./stagegen.ts";
import { ready, stopRun } from "./oc-engine.ts";
import { CHAT_SYSTEM, CHAT_TOOLS } from "./agent-chat-policy.ts";
import type { AgentIO } from "./agent.ts";

type Message = { id: number; role: "user" | "assistant" | "tool" | "error"; text: string; at: string; key?: string };
type Support = { id: string; topic: string; returnTo: string; openedAfter: number };
type Observation = { kind: "understood" | "confused" | "misconception"; note: string; evidenceMessageId: number; evidence: string; verified: false; at: string };
export type Chat = { id: string; courseId: string; goal: string; focus: string; support: Support[]; observations: Observation[]; messages: Message[]; at: string };
const active = new Set<string>();
const sent = new Map<string, number>();
const now = () => new Date().toISOString();
const err = (status: number, message: string) => Object.assign(new Error(message), { status });
const valid = (id: string) => { if (!/^[a-f0-9]{16}$/.test(id)) throw err(400, "대화 주소가 올바르지 않아요."); return id; };
const file = (id: string) => path.join(DATA, "agent-chat", `${valid(id)}.json`);
const ws = (id: string) => path.join(DATA, "agent-chat", "workspaces", valid(id));
export const CHAT_PROMPTS = {
  system: CHAT_SYSTEM,
  fixed: "[자유 대화 학습 실험]\n학습 재료: 인사 서버 코스. 순서 강제 없음.",
  turn: "[현재 학습 상태]\n{state}\n이번 학습자 메시지 id: {messageId}",
};
type Prompts = typeof CHAT_PROMPTS;
type Trace = { at: string; userMessageId: number; question: string; prompts: Prompts; parts: AgentIO["parts"]; requests: { at: string; body: Record<string, unknown> }[] };
const promptFile = path.join(DATA, "agent-chat", "prompts.json");
const traceFile = (id: string) => path.join(DATA, "agent-chat", "inputs", `${valid(id)}.json`);
export async function chatPrompts(): Promise<Prompts> { return { ...CHAT_PROMPTS, ...await read<Partial<Prompts>>(promptFile, {}) }; }
export async function saveChatPrompts(input: Record<string, unknown>) {
  const out = {} as Prompts;
  for (const key of Object.keys(CHAT_PROMPTS) as (keyof Prompts)[]) {
    if (typeof input[key] !== "string" || input[key].length > 40000) throw err(400, "프롬프트는 항목마다 40,000자 이하의 글이어야 해요.");
    out[key] = input[key];
  }
  await update<Prompts>(promptFile, CHAT_PROMPTS, () => out);
  return out;
}
const promptRevision = (p: Prompts) => createHash("sha256").update(JSON.stringify(p)).digest("hex").slice(0, 16);
const renderTurn = (p: Prompts, state: string, messageId: number | string) => p.turn.replace(/\{(state|messageId)\}/g, (_m, key: string) => key === "state" ? state : String(messageId));
export async function chatDebug(id: string) {
  const s = await chatOf(id);
  const prompts = await chatPrompts();
  const trace = await read<Trace | null>(traceFile(id), null);
  let previousRequest: Record<string, unknown> | null = null;
  if (!trace) {
    // 기능 추가 전에 이미 대화한 경우에도 기존 호출 기록에서 마지막 실제 본문을 보여 준다.
    const dir = path.join(DATA, "prompts");
    const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith("-tutor-request.json")).sort().reverse().slice(0, 100);
    for (const name of names) {
      const j = await read<Record<string, unknown>>(path.join(dir, name), {});
      if (j._run !== `chat-${id}`) continue;
      previousRequest = Object.fromEntries(Object.entries(j).filter(([key]) => !key.startsWith("_")));
      break;
    }
  }
  return {
    prompts, defaults: CHAT_PROMPTS, trace, previousRequest,
    layout: [
      "1. 고정 지시문(instructions): 편집한 튜터 프롬프트가 들어가요.",
      "2. 도구 목록(tools): 파일 읽기·코드 조각 실행·학습 상태 읽기/조정·코스 자료 읽기예요.",
      "3. 앞 대화: OpenCode가 이전 사용자·튜터 메시지와 도구 호출/결과를 순서대로 유지해요.",
      "4. 이번에 덧붙이는 맥락: 새 세션이면 코스 맥락과 최근 대화, 이어 쓰면 지난번 이후 화면 기록을 붙여요.",
      "5. 매 차례 맥락: 편집한 틀에 현재 학습 상태와 메시지 id를 넣어요.",
      "6. 학습자 질문: 맨 뒤에 이번 메시지를 붙여요. 도구를 쓰면 그 결과를 붙여 모델을 다시 불러요.",
      "프롬프트를 바꾸면 다음 메시지에서 새 모델 세션을 열고 최근 대화를 다시 넣어요. 화면의 대화와 학습 상태는 유지돼요.",
    ],
    preview: { label: "다음 차례 조립 재료 미리 보기 — 실제 전송 본문과 구분", instructions: prompts.system, fixed: prompts.fixed,
      turn: renderTurn(prompts, await chatTool(id, "get_learning_state", {}), "다음 학습자 메시지 id"),
      recent: s.messages.slice(-80), learningTools: CHAT_TOOLS },
  };
}
const push = (s: Chat, role: Message["role"], text: string, key?: string) => {
  const m: Message = { id: (s.messages.at(-1)?.id ?? 0) + 1, role, text, at: now(), ...(key ? { key } : {}) };
  s.messages.push(m); return m;
};
export async function chatOf(id: string): Promise<Chat> {
  const s = await read<Chat | null>(file(id), null);
  if (!s) throw err(404, "대화를 찾지 못했어요. 새 대화를 시작해 주세요.");
  return s;
}
export async function chatView(id: string) { return { ...await chatOf(id), busy: active.has(id), workspace: ws(id) }; }
export async function newChat() {
  const id = randomBytes(8).toString("hex");
  const course = await loadCourse("hello-api");
  await writeWorkspace(ws(id), await stageFiles(course, 1));
  // 11/4 사용자 "프리스타일로, 뭐 여쭤보는 거 없이": 첫 인사·질문 없이 빈 대화로 시작, 목표·초점도 대화에서 정해진다
  const s: Chat = { id, courseId: course.id, goal: "", focus: "", support: [], observations: [], messages: [], at: now() };
  await update<Chat>(file(id), s, () => s);
  return chatView(id);
}
export async function restartChat(id: string) {
  valid(id);
  if (active.has(id)) throw err(409, "답하는 중에는 재시작할 수 없어요. 멈춘 뒤 다시 눌러 주세요.");
  active.add(id);
  try { await chatOf(id); return await newChat(); }
  finally { active.delete(id); }
}
export async function adjustLearning(id: string, input: Record<string, unknown>) {
  const action = String(input.action ?? "");
  const text = String(input.text ?? "").trim().slice(0, 500);
  if (!text) throw err(400, "바꿀 내용이나 관찰을 적어 주세요.");
  const current = await chatOf(id);
  return update<Chat>(file(id), current, (s) => {
    const evidenceId = Number(input.evidenceMessageId);
    const evidence = String(input.evidence ?? "").trim().slice(0, 500);
    const message = s.messages.find((m) => m.id === evidenceId && m.role === "user");
    if (action === "return" || action === "observe") {
      if (!message || !evidence || !message.text.includes(evidence)) throw err(400, "실제 학습자 메시지 id와 그 말에 포함된 인용을 주세요.");
    }
    if (action === "goal") s.goal = text;
    else if (action === "focus") { if (s.support.length) throw err(409, "보충 중이에요. 현재 보충을 마치고 초점을 바꾸세요."); s.focus = text; }
    else if (action === "support") {
      const norm = (v: string) => v.replace(/\s/g, "").toLowerCase();
      if (s.support.length >= 10 || s.support.some((f) => norm(f.topic) === norm(text))) throw err(409, "이미 보는 보충 주제이거나 너무 깊어요. 현재 주제에서 이어서 설명하세요.");
      s.support.push({ id: randomBytes(5).toString("hex"), topic: text, returnTo: s.focus, openedAfter: s.messages.filter((m) => m.role === "user").at(-1)?.id ?? 0 });
      s.focus = text;
    } else if (action === "return") {
      const top = s.support.at(-1);
      if (!top || input.supportId !== top.id) throw err(409, "현재 보충 칸 id가 달라요. 상태를 다시 읽으세요.");
      if (evidenceId <= top.openedAfter) throw err(409, "보충을 연 뒤 받은 학습자 답변이 필요해요.");
      s.support.pop(); s.focus = top.returnTo;
      // 위 칸도 같은 답으로 연속해서 닫지 못하게 복귀 뒤 새 답변을 요구한다.
      const parent = s.support.at(-1); if (parent) parent.openedAfter = Math.max(parent.openedAfter, evidenceId);
    } else if (action === "observe") {
      if (!["understood", "confused", "misconception"].includes(String(input.kind))) throw err(400, "관찰 종류가 올바르지 않아요.");
      s.observations.push({ kind: input.kind as Observation["kind"], note: text, evidenceMessageId: evidenceId, evidence, verified: false, at: now() });
    } else throw err(400, "지원하지 않는 학습 조정이에요.");
    push(s, "tool", `${({ goal: "목표", focus: "초점", support: "보충 시작", return: "보충 마침 · AI 판단", observe: "AI 관찰 · 검증 안 됨" } as Record<string, string>)[action]}: ${text}`);
  });
}
export async function chatTool(id: string, name: string, input: Record<string, unknown>): Promise<string> {
  if (name === "adjust_learning") {
    const s = await adjustLearning(id, input);
    return JSON.stringify({ goal: s.goal, focus: s.focus, support: s.support, observation: s.observations.at(-1) });
  }
  const s = await chatOf(id);
  if (name === "get_learning_state") return JSON.stringify({ goal: s.goal, focus: s.focus, support: s.support, observations: s.observations.slice(-15), learnerMessages: s.messages.filter((m) => m.role === "user").slice(-12).map((m) => ({ id: m.id, text: m.text })) });
  if (name === "get_course_material") {
    const course = await loadCourse(s.courseId);
    return JSON.stringify({ title: course.title, stages: course.stages.map((st) => ({ title: st.title, goal: st.goal })), concepts: course.knowledge, startFiles: Object.fromEntries(await stageFiles(course, 1)) });
  }
  throw err(400, "없는 도구예요.");
}
type Runner = (io: AgentIO, question: string) => Promise<string>;
export async function askChat(id: string, text: string, runner?: Runner) {
  valid(id);
  const q = String(text ?? "").trim();
  if (!q || q.length > 12000) throw err(400, "질문은 1~12,000자로 적어 주세요.");
  if (active.has(id)) throw err(409, "아직 답하는 중이에요.");
  active.add(id);
  try {
    const s = await chatOf(id);
    const prompts = await chatPrompts();
    const sessionKey = `chat-${id}:${promptRevision(prompts)}`;
    // 엔진이 없으면 사용자의 말을 저장하기 전에 명확하게 알린다. 다른 튜터로 조용히 바꾸지 않는다.
    const engine = runner ? { run: runner } : await ready();
    if (!engine) throw err(503, "이 실험은 OpenCode가 필요해요. Node 24와 프로젝트 코스 의존성을 확인해 주세요.");
    const prior = s.messages;
    let userId = 0;
    await update<Chat>(file(id), s, (st) => { userId = push(st, "user", q).id; });
    const history = (ms: Message[]) => ms.map((m) => `[${m.role} #${m.id}] ${m.text}`).join("\n\n");
    const recent = history(prior.slice(-80)).slice(-50000);
    const since = history(prior.filter((m) => m.id > (sent.get(sessionKey) ?? 0)));
    const io: AgentIO = {
      runId: `chat-${id}`, sessKey: sessionKey, n: 1, ws: ws(id), context: recent,
      parts: { fixed: prompts.fixed, recent, since,
        turn: renderTurn(prompts, await chatTool(id, "get_learning_state", {}), userId), files: [] },
      learningChat: { system: prompts.system, execute: (name, input) => chatTool(id, name, input),
        capture: async (body) => { await update<Trace>(traceFile(id), initialTrace, (t) => { t.requests.push({ at: now(), body }); }); } },
      quiet: () => {},
      show: async (card) => { await update<Chat>(file(id), s, (st) => { push(st, "tool", card.type === "snippet" ? `코드 실행\n${card.code}\n→ ${card.output}` : card.type === "tool" ? card.label : JSON.stringify(card)); }); },
      say: async (value) => { await update<Chat>(file(id), s, (st) => { push(st, "assistant", value); }); },
      stream: async (key, value) => { await update<Chat>(file(id), s, (st) => { const m = st.messages.find((m) => m.key === `${userId}:${key}`); if (m) m.text = value; else push(st, "assistant", value, `${userId}:${key}`); }); },
    };
    const initialTrace: Trace = { at: now(), userMessageId: userId, question: q, prompts, parts: io.parts, requests: [] };
    await update<Trace>(traceFile(id), initialTrace, () => initialTrace);
    try {
      const answer = await engine.run(io, q);
      if (!io.streamed && answer) await io.say(answer);
    } catch (error) {
      await update<Chat>(file(id), s, (st) => { push(st, "error", (error as Error).message); });
    }
    sent.set(sessionKey, (await chatOf(id)).messages.at(-1)?.id ?? 0);
  } finally { active.delete(id); }
  return chatView(id);
}
export async function stopChat(id: string) { await chatOf(id); await stopRun(`chat-${id}`, 1); return chatView(id); }
export { CHAT_SYSTEM };
