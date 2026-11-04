// 수업: 수업 계획서(lessons/<단계>.json)를 들고 튜터가 대화로 가르친다.
// - 순서·정답·판정은 계획서와 검사기가 정한다. AI는 학습자의 질문에 답하고 빈틈을 메운다(계획을 바꾸지 않는다).
// - VS Code와는 "이어진 것처럼": 파일 줄 링크(vscode://), 저장하면 튜터가 알아채고 바로 확인한다.
import { watch, type FSWatcher } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ServerResponse } from "node:http";
import { COURSES, courseDir, loadCourse, solutionDiff, stageFiles, stageOf } from "./course.ts";
import { locate, type RunResult } from "./checker.ts";
import { check, confused, devStatus, explain, hint, peekDb, predict, startDev, stopDev, tryRequest, workspaceOf } from "./learn.ts";
import { AiUnavailable, aiText } from "./ai.ts";
import { learnerLine, learnerView } from "./learner.ts";
import { judgeExplain, kindLabel, pathOf, planAfterStage, setStatus, taskPrompt } from "./planner.ts";
import { DATA, getRun, read, saveRun, stageProgress, update } from "./store.ts";
import { bridgeContext, bridgeState, connected as bridgeConnected, send as bridgeSend } from "./bridge.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { explainWhat, pocketItems, rememberAi, takeDue } from "./pocket.ts";
import { addEntry, addTour, codeTerms, firstLine } from "./notes.ts";
import { runAgent, undoEdit, type AskCard, type CtxFile, type DiffCard, type SnippetCard, type ToolCard } from "./agent.ts";
import { aiMode } from "./ai.ts";
import { onStuckChange, CHOICES, countReply, leaveAll, openRoot, openStack, resolveTop, stuckOf, stuckView, labelOf, type Choice, type Frame } from "./stuck.ts";
import { basicsLine, catalogText, langOf } from "./basics.ts";
import { extraBlock } from "./lab.ts";
import { DEFAULT_FIXED, DEFAULT_FREE_FIXED, DEFAULT_FREE_TURN, DEFAULT_TURN, FREE_SYSTEM, promptOf, render } from "./prompts.ts";
import { actionOfBeat, answerBackground, backgroundLine, bgQuestion, closeDetours, enterBeat, events, getSession, knownSkip, pushDetour, recap, recapSeen, record, sessionView, stageOutcome, LEVELS, type Action as SessAction } from "./session.ts";

type Try = { method: string; path: string; body?: unknown; raw?: string; as?: string; restart?: boolean }; // restart: 실습 서버를 껐다 켠다(요청 아님)
/** do: next | try | start_dev,try | observe(검사로 지금 상태 보기) | db(DB 들여다보기) | next_stage …  tries: 요청 여러 개를 차례로 */
type Action = { label: string; do: string; try?: Try; tries?: Try[]; sql?: string };
type Open = { file: string; anchor: string; toAnchor?: string; note?: string };
type Scaffold = { file: string; from: string; to?: string; text: string; note?: string };
type Chunk = { anchor: string; label: string; desc?: string; focus?: boolean };
type Focus = { file: string; chunks: Chunk[] };
// now: 채팅 아래에 늘 보이는 "지금 할 일" 한 줄 · pair: "같이 해요"로 고칠 때 한 조각씩 보여 줄 안내
// talk: 이 걸음은 대본 글 대신 튜터가 이 메모를 보고 대화로 이끈다(생성 코스, 11/3)
type Beat = { id: string; kind: "say" | "predict" | "fix" | "explain" | "map"; text: string; talk?: string; now?: string; actions?: Action[]; after?: Action[]; predict?: string; open?: Open; scaffold?: Scaffold; focus?: Focus; clearFocus?: boolean; pair?: string[] };
export type Plan = { stage: number; title: string; teach: string[]; tutorNotes: string; beats: Beat[]; passText?: string };

type Card =
  | { type: "choice"; pid: string; options: string[]; picked?: number; answer?: number }
  | { type: "reply"; request: string; status: number; timedOut: boolean; error?: string; headers: Record<string, string>; body: string }
  | { type: "check"; result: RunResult }
  | { type: "hint"; level: number; text: string; source: string }
  | { type: "explain"; done?: string }
  | { type: "code"; file: string; from: number; to: number; code: string }
  | { type: "map"; file: string; chunks: Chunk[] }
  | { type: "table"; sql: string; columns: string[]; rows: unknown[][]; note?: string }
  | ToolCard | DiffCard | AskCard | SnippetCard;
// beat: 어느 걸음에서 나온 말인지 · t: 걸음 중에 따로 물어본 대화(튜터 창이 걸음 카드와 나눠 보여 준다, 11/2)
// sf: [막혔어요] 칸 안에서 나온 말(그 칸 id, 11/3) — 코스 대화 맥락에는 넣지 않고 칸 대화에만
export type LMsg = { id: number; at: string; role: "tutor" | "me" | "note"; text?: string; card?: Card; actions?: Action[]; beat?: number; t?: boolean; sf?: string };
// mode: 고치기 방식(직접 / 같이 / 튜터가 만듦) · asked: 지금 순서에 들어온 뒤 자유 질문을 했는지(했으면 [하던 거로 돌아가기])
type Mode = "self" | "pair" | "auto";
type State = { beat: number; waiting: "action" | "choice" | "save" | "explain" | "done"; messages: LMsg[]; hints: number; lastCheck?: RunResult; busy?: boolean; todo?: Todo[]; scaffolded?: boolean; focus?: Focus | null; mode?: Mode; pairStep?: number; asked?: boolean; tutorEdit?: boolean; act?: SessAction; actTarget?: string; failStreak?: number; level?: number; summary?: { upTo: number; text: string } };
type Todo = { open?: Open; focus?: Focus; clear?: boolean; talk?: string };

const now = () => new Date().toISOString();
/** 이어 쓰는 대화에 이미 들어간 화면 메시지(단계별 마지막 id) */
const sentUpTo = new Map<string, number>();
/** "내 말로" 답을 보는 중(계획 제안이 기다린다) */
const judging = new Map<string, Promise<unknown>>();
/** 진행 기록마다 지금 열린 [막혔어요] 칸(맨 아래). 이 동안 나온 말에 sf 표시를 붙인다 */
const stuckTop = new Map<string, string>();
onStuckChange(async (runId) => { await syncTop(runId); });
async function syncTop(runId: string) { const top = openStack(await stuckOf(runId)).at(-1); if (top) stuckTop.set(runId, top.id); else stuckTop.delete(runId); return top; }
const file = (runId: string, n: number) => path.join(DATA, "lessons", `${runId}-${n}.json`);
const err = (status: number, message: string) => Object.assign(new Error(message), { status });

export async function loadPlan(courseId: string, n: number): Promise<Plan | null> {
  try { return JSON.parse(await readFile(path.join(courseDir(courseId), "lessons", `${n}.json`), "utf8")); } catch { return null; }
}

/* ---------- 바뀐 것을 화면에 알리기 (SSE) ---------- */
const subs = new Map<string, Set<ServerResponse>>();
export function subscribe(runId: string, res: ServerResponse) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  res.write("retry: 2000\n\n");
  const set = subs.get(runId) ?? new Set();
  set.add(res); subs.set(runId, set);
  const ping = setInterval(() => res.write(": ping\n\n"), 20000);
  res.on("close", () => { clearInterval(ping); set.delete(res); });
}
export function notifyLesson(runId: string) { notify(runId, "lesson"); }
function notify(runId: string, what: string) {
  for (const res of subs.get(runId) ?? []) res.write(`data: ${what}\n\n`);
}

/* ---------- 답하는 중: 생각 한 줄 · 되묻기 · 멈추기 (10/30, GPT 앱처럼 넓히기 1~3) ---------- */
// 저장하지 않고 메모리에만: 답이 끝나면 사라지는 것들
const thinking = new Map<string, string>();
const askWaiters = new Map<string, { id: string; finish: (answer: string) => void }>();
const inflight = new Set<string>();
const lk = (runId: string, n: number) => `${runId}:${n}`;

/** 튜터가 고르게 물은 것에 학습자가 답한다 */
export async function answerAsk(runId: string, n: number, input: { id?: string; choice?: number; text?: string }) {
  const w = askWaiters.get(lk(runId, n));
  if (!w || w.id !== input.id) throw err(409, "이미 지난 질문이에요.");
  let answer = "";
  await change(runId, n, (s, push) => {
    const m = s.messages.find((x) => x.card?.type === "ask" && x.card.id === input.id);
    const card = m?.card as AskCard | undefined;
    answer = input.text?.trim().slice(0, 300) || (card && input.choice !== undefined ? card.options[input.choice] ?? "" : "");
    if (card) { card.picked = input.choice; card.answer = answer; }
    if (answer) push({ role: "me", text: answer });
  });
  w.finish(answer);
  return lessonView(runId, n);
}

/** [멈추기]: 지금 답하는 질문을 멈춘다 */
export async function stopAsk(runId: string, n: number) {
  askWaiters.get(lk(runId, n))?.finish("");
  const { stopRun } = await import("./oc-engine.ts");
  const stopped = await stopRun(runId, n).catch(() => false);
  thinking.delete(lk(runId, n));
  await change(runId, n, (s, push) => { if (s.busy) push({ role: "note", text: "멈췄어요. 다른 걸 물어보거나, 원하는 쪽을 다시 적어 주세요." }); if (!stopped) s.busy = false; });
  return lessonView(runId, n);
}

/* ---------- 상태 ---------- */
/** 같은 수업 기록은 한 번에 하나씩 고친다(에이전트가 도구 결과를 연달아 쓰고, 화면이 동시에 다른 동작을 보내도 기록이 사라지지 않게). */
const lessonQueues = new Map<string, Promise<unknown>>();
function change(runId: string, n: number, fn: (s: State, push: (m: Omit<LMsg, "id" | "at">) => void) => void | Promise<void>): Promise<State> {
  const key = file(runId, n);
  const job = (lessonQueues.get(key) ?? Promise.resolve()).then(() => changeNow(runId, n, fn));
  lessonQueues.set(key, job.catch(() => undefined));
  return job;
}
async function changeNow(runId: string, n: number, fn: (s: State, push: (m: Omit<LMsg, "id" | "at">) => void) => void | Promise<void>) {
  let out!: State;
  // update()는 동기 함수만 받으므로, 읽고 → 비동기 작업 → 저장을 직접 차례로 한다.
  const s = await read<State>(file(runId, n), { beat: -1, waiting: "action", messages: [], hints: 0 });
  const push = (m: Omit<LMsg, "id" | "at">) => { const sf = stuckTop.get(runId); s.messages.push({ id: (s.messages.at(-1)?.id ?? 0) + 1, at: now(), beat: s.beat, ...(s.asked ? { t: true } : {}), ...(sf ? { sf } : {}), ...m }); };
  const beforeBeat = s.beat;
  await fn(s, push);
  // 걸음이 바뀌면 세션의 지금 활동도 바꾼다(학습 진행 엔진, 11/3)
  if (s.beat !== beforeBeat && s.act) void enterBeat(runId, n, s.beat, s.act, s.actTarget ?? "");
  const todo = s.todo ?? [];
  s.todo = [];
  await update<State>(file(runId, n), s, () => { out = s; return s; });
  notify(runId, "lesson");
  for (const t of todo) {
    if (t.talk) {
      const talk = t.talk, beat = out.beat;
      void (async () => {
        const run = await getRun(runId); const plan = await loadPlan(run.courseId, n); if (!plan) return;
        await ask(runId, n, plan, talk, undefined, undefined, { silent: true, main: true });
        const b = plan.beats[beat];
        await change(runId, n, (st) => { const last = [...st.messages].reverse().find((m) => m.role === "tutor" && m.text && !m.card); if (last && st.beat === beat && !last.actions) last.actions = b?.actions ?? [{ label: "다음", do: "next" }]; });
      })().catch((e) => console.error("[talk]", e));
      continue;
    }
    if (t.open) await openInEditor(runId, n, t.open).catch(() => {});
    if (t.focus) bridgeSend(runId, { type: "focus", file: t.focus.file, chunks: t.focus.chunks });
    if (t.clear) bridgeSend(runId, { type: "clearFocus" });
  }
  return out;
}

function enter(plan: Plan, s: State, idx: number, push: (m: Omit<LMsg, "id" | "at">) => void, course: Awaited<ReturnType<typeof loadCourse>>) {
  s.beat = idx;
  s.act = actionOfBeat(plan.beats[idx], idx === plan.beats.length - 1);
  s.actTarget = plan.beats[idx] ? plan.beats[idx].now ?? firstLine(plan.beats[idx].text) : "";
  s.asked = false;
  const b = plan.beats[idx];
  if (!b) { s.waiting = "done"; return; }
  if (b.focus) { s.focus = b.focus; (s.todo ??= []).push({ focus: b.focus }); }
  if (b.clearFocus) { s.focus = null; (s.todo ??= []).push({ clear: true }); }
  if (b.open) (s.todo ??= []).push({ open: b.open });
  if (b.kind === "map") {
    push({ role: "tutor", text: b.text, card: { type: "map", file: b.focus!.file, chunks: b.focus!.chunks }, actions: b.actions ?? [{ label: "다음", do: "next" }] });
    s.waiting = "action";
  } else if (b.kind === "say" && b.talk) {
    // 튜터가 대화로 시작한다(저장 뒤 todo에서 부름). 버튼은 튜터 첫 말 뒤에
    s.waiting = "action";
    (s.todo ??= []).push({ talk: b.talk });
  } else if (b.kind === "say") {
    push({ role: "tutor", text: b.text, actions: b.actions ?? [{ label: "다음", do: "next" }] });
    s.waiting = "action";
  } else if (b.kind === "predict") {
    const p = stageOf(course, plan.stage).predict.find((x) => x.id === b.predict)!;
    push({ role: "tutor", text: b.text, card: { type: "choice", pid: p.id, options: p.options } });
    s.waiting = "choice";
  } else if (b.kind === "fix") {
    // 고치는 방식 셋: 셋 다 같은 도착점(이 단계 검사 통과). 무엇을 골랐는지는 기록만 하고 진도를 막지 않는다(10/31 사용자 결정 "체험 기준 + 정직한 기록")
    push({ role: "tutor", text: b.text, actions: modeActions(b, s) });
    s.waiting = "save";
  } else if (b.kind === "explain") {
    push({ role: "tutor", text: b.text, card: { type: "explain" } });
    s.waiting = "explain";
  }
}

/** 고치기 순서의 버튼: 방식을 아직 안 골랐으면 셋, 골랐으면 그 방식에서 할 수 있는 것 */
function modeActions(b: Beat, s: State): Action[] {
  // 처음(L0)·줄 읽기(L1)면 "같이 해요"를 먼저 권하고, 그 위면 "제가 해 볼게요"를 먼저(레벨은 내부 설정, DECISIONS 11/3)
  if (!s.mode) return (s.level ?? 0) <= 1 && b.pair?.length
    ? [{ label: "같이 해요", do: "mode_pair" }, { label: "제가 해 볼게요", do: "mode_self" }, { label: "만들어 주세요", do: "mode_auto" }]
    : [{ label: "제가 해 볼게요", do: "mode_self" }, { label: "같이 해요", do: "mode_pair" }, { label: "만들어 주세요", do: "mode_auto" }];
  const more = s.mode === "pair" && b.pair && (s.pairStep ?? 0) < b.pair.length - 1 ? [{ label: "다 했어요, 다음 조각", do: "pair_next" }] : [];
  return [...more, { label: "지금 확인해 줘", do: "check" }, ...(s.mode === "self" ? [{ label: "힌트 줘", do: "hint" }, { label: "같이 해요", do: "mode_pair" }] : []), ...(s.mode !== "auto" ? [{ label: "만들어 주세요", do: "mode_auto" }] : [])];
}

/* ---------- 화면에 보낼 수업 ---------- */
export async function lessonView(runId: string, n: number) {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const plan = await loadPlan(course.id, n);
  if (!plan) return null;
  let s = await read<State | null>(file(runId, n), null);
  if (!s && run.free) s = await change(runId, n, (st) => { st.beat = 0; st.waiting = "action"; });
  if (!s) {
    const due = await takeDue(runId, n);
    const first = n === run.plan.start;
    const bgQ = first ? bgQuestion((await getSession(runId)).background) : null;
    s = await change(runId, n, (st, push) => {
      if (first) push({ role: "tutor", text: "반가워요! 저는 이 코스를 같이 할 튜터예요. 먼저 쓰는 법 세 가지만 알려 드릴게요.\n\n- **왼쪽은 코드, 오른쪽(여기)은 저예요.** 제가 설명하면서 왼쪽에 필요한 줄을 열어 드려요.\n- **모르는 코드**는 드래그한 뒤 **우클릭 → \"이건 뭐예요?\"**를 누르세요. 바로 알려 드려요.\n- **궁금한 건** 아래 칸에 그냥 적으세요. 제가 직접 코드를 열어 보고, 돌려 보고 알려 드려요.\n\n코드를 고친 뒤에는 **Ctrl+S**(저장)를 누르면 제가 바로 확인해요. 그럼 시작해 볼게요." });
      if (due.length) push({ role: "tutor", text: `시작하기 전에, 주머니에 넣어 뒀던 것부터 꺼낼게요. 전에 물어본 ${[...new Set(due.flatMap((d) => d.terms.filter((t) => t.stage === n).map((t) => `**${t.name}**`)))].join(", ")}이(가) 이번 단계에서 나와요. 나올 때 자세히 짚어 드릴게요.` });
      // 처음 단계면 먼저 배경(TS → JS → Python)을 묻고, 다 답하면 첫 걸음으로(act "bg:…")
      if (bgQ) { push({ role: "tutor", ...bgQ }); st.waiting = "action"; return; }
      enter(plan, st, 0, push, course);
    });
  }
  const ws = workspaceOf(run, stageOf(course, n).template);
  watchFor(runId, n, ws);
  // 레벨(내부)을 수업 상태에 맞춰 둔다: 고칠 방식 버튼 순서에 쓴다
  const sess = await getSession(runId);
  if ((s.level ?? 0) !== sess.level) s = await change(runId, n, (st) => { st.level = sess.level; });
  // [[파일#찾을 글]] → [[파일:줄]] (코드가 바뀌어도 줄을 다시 찾는다)
  const lines = new Map<string, string>();
  for (const m of s.messages) for (const hit of (m.text ?? "").matchAll(/\[\[([^\]#]+)#([^\]]+)\]\]/g)) {
    const loc = await locate(ws, { file: hit[1], anchor: hit[2] });
    lines.set(hit[0], `[[${hit[1]}:${loc?.line ?? 1}]]`);
  }
  const messages = s.messages.map((m) => ({ ...m, text: m.text?.replace(/\[\[([^\]#]+)#([^\]]+)\]\]/g, (all) => lines.get(all) ?? all) }));
  const bs = bridgeState(runId);
  const bridge = bridgeConnected(runId) ? { connected: true, file: bs?.file ?? null, line: bs?.line ?? null, dirty: !!bs?.dirty, errors: bs?.errors?.length ?? 0, selection: bs?.selection ? { from: bs.selection.from, to: bs.selection.to } : null } : { connected: false };
  // 지도 카드: 덩어리마다 지금 몇 번째 줄인지(누르면 VS Code가 그 덩어리를 연다)
  for (const m of messages) if (m.card?.type === "map") {
    const card = m.card;
    m.card = { ...card, chunks: await Promise.all(card.chunks.map(async (c) => ({ ...c, line: (await locate(ws, { file: card.file, anchor: c.anchor }))?.line ?? 1 }))) } as Card;
  }
  const pocket = (await pocketItems(runId)).slice(-12).reverse().map((p) => ({ id: p.id, stage: p.stage, file: p.file, from: p.from, code: p.code.trim().slice(0, 60), terms: p.terms.map((t) => t.name), later: p.later, ai: !!p.ai }));
  const cur = plan.beats[s.beat];
  const now = cur ? cur.now ?? firstLine(cur.text) : null;
  // 걸음 목록(튜터 창의 걸음 줄): 이름은 걸음 종류로 코드가 정한다
  const steps = plan.beats.map((b, i) => ({ kind: b.kind, label: stepLabel(b, i === plan.beats.length - 1), now: b.now ?? firstLine(b.text) }));
  return { stage: n, title: plan.title, teach: plan.teach, beat: s.beat, beats: plan.beats.length, steps, waiting: s.waiting, busy: !!s.busy, messages, workspace: ws, dev: devStatus(runId), bridge, pocket,
    session: await sessionView(runId),
    next: course.generated ? await nextInfo(course, n) : null,
    recap: await recap(runId, { stageTitle: (k) => course.stages.find((x) => x.n === k)?.title ?? "", nowLabel: `${n}단계 · ${now ?? plan.title}` }).catch(() => null),
    now, mode: s.mode ?? null, resumable: !!s.asked && !s.busy && (s.waiting === "action" || s.waiting === "save"),
    thinking: s.busy ? thinking.get(lk(runId, n)) ?? null : null, asking: askWaiters.get(lk(runId, n))?.id ?? null,
    stuck: await stuckView(runId), stuckChoices: Object.values(CHOICES).map((c) => c.label), free: !!run.free,
    ...(run.chatId ? await chatPart(run.chatId) : {}) };
}

/* ---------- 11/4 사용자 "GPT가 만든 것까지 그대로 붙여 봐": 프리스타일 대화를 실험판(agent-chat) 엔진이 그대로 맡는다 ----------
 * 지시문 · 도구 · 학습 상태(목표 · 초점 · 보충 · 관찰)는 실험판 것 그대로. 여기서는 그 대화를 제품 화면 모양으로 옮기고, 질문을 넘기기만 한다 */
async function chatPart(chatId: string) {
  const v = await (await import("./agent-chat.ts")).chatView(chatId);
  const messages = v.messages.map((m) => {
    const id = `c${m.id}`;
    if (m.role === "user") return { id, role: "me", text: m.text };
    if (m.role === "assistant") return { id, role: "tutor", text: m.text };
    if (m.role === "tool") return { id, role: "tutor", card: { type: "tool", icon: "🔧", label: m.text.split("\n")[0], ok: !/실패|중단/.test(m.text.split("\n")[0]) } };
    return { id, role: "note", text: m.text };
  });
  const ac = await import("./agent-chat.ts");
  const lr = await (await import("./chat-learned.ts")).learnedOf(chatId);
  const learned = lr.items.map((x) => ({ concept: x.concept, kind: x.kind, meaning: x.meaning, quote: x.quote, messageId: x.messageId }));
  return { messages, busy: v.busy, workspace: v.workspace, learned, chat: { id: v.id, goal: v.goal, focus: v.focus, support: v.support.map((x) => x.topic), observations: v.observations.length, noCourse: v.noCourse,
    model: v.model ?? ac.CHAT_MODELS[0].id, models: ac.CHAT_MODELS, edit: v.edit ?? null } };
}
const chatPolls = new Map<string, ReturnType<typeof setInterval>>();
async function chatAsk(runId: string, chatId: string, text: string) {
  const ac = await import("./agent-chat.ts");
  const job = ac.askChat(chatId, text).catch(() => {}).finally(async () => {
    clearInterval(chatPolls.get(runId)); chatPolls.delete(runId); notifyLesson(runId);
    // 11/4 사용자 "배운 것 갱신": 답이 끝난 뒤 뒤에서 새 대화만 한 번(답 속도에는 영향 없음). 끄기 PC_CHAT_LEARNED=0
    if (process.env.PC_CHAT_LEARNED === "0") return;
    const got = await (await import("./chat-learned.ts")).extractLearned(chatId, (await ac.chatOf(chatId)).messages).catch(() => null);
    if (got?.ok.length) notifyLesson(runId);
  });
  // 실험판은 대화 파일에 바로 쓴다 → 답하는 동안 화면에 0.45초마다 알린다(SSE)
  clearInterval(chatPolls.get(runId));
  chatPolls.set(runId, setInterval(() => notifyLesson(runId), 450));
  // askChat이 사용자 말을 저장하고 busy가 될 때까지만 기다린다(답 전체는 기다리지 않는다)
  for (let i = 0; i < 20 && !(await ac.chatView(chatId)).busy; i++) await new Promise((r) => setTimeout(r, 50));
  void job;
}

/** 생성 코스: 다음 단계가 준비됐는지(뒤에서 만드는 중이면 화면이 기다린다) */
async function nextInfo(course: Awaited<ReturnType<typeof loadCourse>>, n: number) {
  const o = course.generated?.outline.find((x) => x.n === n + 1);
  if (!o) return null;
  const { genStatus } = await import("./generate.ts");
  const g = await genStatus(course.id);
  return { n: o.n, title: o.title, ready: course.stages.some((s) => s.n === o.n), failed: g?.phase === "failed" && g.stage === o.n ? g.message : null };
}

/** 튜터 맥락 한 줄: 지금 학습 진행(설계안 11.1 "학습 진행" 맥락). 임시 학습 중이면 답한 뒤 돌아갈 곳을 알려 준다 */
async function sessionLine(runId: string) {
  const v = await sessionView(runId).catch(() => null);
  if (!v) return "";
  const names: Record<string, string> = { explain: "설명", demo: "작동 예제", guide: "직접 할 일 안내", diagnose: "원인 찾기", verify: "확인", navigate: "이동", summarize: "정리" };
  const dt = v.detours.length ? ` · 임시 학습 ${v.detours.length}겹: ${v.detours.map((d) => `"${d.topic}"`).join(" → ")} (끝나면 "${v.detours[0].returnLabel}"(으)로 돌아감 — 돌아가기는 화면 버튼이 하니 답에 안내하지 않아도 된다)` : "";
  return `[학습 진행] 지금 활동: ${names[v.activity.type] ?? v.activity.type}${v.activity.target ? ` — ${v.activity.target}` : ""}${dt}\n[학습자 수준(내부, 학습자에게 말하지 말 것)] ${LEVELS[v.level] ?? LEVELS[0]} — 이 단위로 설명하고, 처음 나온 개념만 더 작게 풀어 줄 것${v.background ? `\n${backgroundLine(v.background)}` : ""}`.replace(/\n$/, "");
}

function stepLabel(b: Beat, last: boolean) {
  if (b.kind === "predict") return "예측";
  if (b.kind === "fix") return "고치기";
  if (b.kind === "explain") return "내 말로";
  if (b.kind === "map") return "훑어보기";
  if (last) return "정리";
  const acts = [...(b.actions ?? []), ...(b.after ?? [])];
  if (acts.some((a) => a.do.includes("try") || a.do === "db" || a.do === "observe")) return "해 보기";
  return "읽기";
}

/* ---------- 학습자가 한 것 ---------- */
export async function act(runId: string, n: number, input: { do: string; choice?: number; text?: string; level?: number; file?: string; line?: number; index?: number; word?: string; mode?: string; shown?: string }) {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const plan = await loadPlan(course.id, n);
  if (!plan) throw err(404, "이 단계의 수업 계획서가 없어요.");

  if (run.chatId && (input.do === "ask" || input.do === "stop_chat")) {
    if (input.do === "stop_chat") { await (await import("./agent-chat.ts")).stopChat(run.chatId); return; }
    // VS Code에서 고른 줄이 있으면 질문 앞에 붙인다(실험판 엔진에는 고른 줄 칸이 없다)
    const sel = bridgeState(runId)?.selection;
    const pre = sel?.text ? `[VS Code에서 고른 코드 ${bridgeState(runId)?.file ?? ""} ${sel.from}~${sel.to}줄]\n${sel.text}\n\n` : "";
    await chatAsk(runId, run.chatId, pre + String(input.text ?? ""));
    return;
  }
  if (input.do === "ask") {
    const t = String(input.text ?? "");
    // [막혔어요] 칸 안에서는 말투로 투어·설명 모드로 바꾸지 않는다(11/3 재현: "구조"라는 말에 투어 모드가 돼 막힘 도구가 빠짐)
    const inStuck = !!(await stuckView(runId));
    // talk 걸음에서 학습자가 하는 말은 걸음 대화(따로 물어본 질문이 아님)
    const st0 = await read<State>(file(runId, n), { beat: -1, waiting: "action", messages: [], hints: 0 });
    const onTalk = !inStuck && !!plan.beats[st0.beat]?.talk && !st0.asked;
    const mode = inStuck ? undefined : input.mode === "explain" ? "explain" : input.mode === "tour" || TOUR_INTENT.test(t) ? "tour" : undefined;
    const out = await ask(runId, n, plan, mode === "tour" ? `${t}\n\n${TOUR_Q}` : t, undefined, typeof input.shown === "string" ? input.shown.slice(0, 200) : mode === "tour" ? t : undefined, { ...(mode ? { mode } : {}), ...(onTalk ? { main: true } : {}) });
    // talk 걸음: 튜터 말 끝에 [다음] 버튼을 다시 붙인다
    if (onTalk) await change(runId, n, (st) => { const b = plan.beats[st.beat]; const last = [...st.messages].reverse().find((m) => m.role === "tutor" && m.text && !m.card); if (last && b?.talk && !last.actions) last.actions = b.actions ?? [{ label: "다음", do: "next" }]; });
    return out;
  }
  // [막혔어요](11/3): 고른 종류(+단어)로 칸을 열고 튜터가 그 칸 대화를 시작한다
  if (input.do === "stuck") {
    const keys = Object.keys(CHOICES) as Choice[];
    const choice = keys[Number(input.choice)] ?? (keys.includes(input.text as Choice) ? input.text as Choice : null);
    if (!choice) throw err(400, "막힌 종류를 골라 주세요.");
    const word = choice === "word" && typeof input.word === "string" ? input.word.trim().slice(0, 60) : undefined;
    const quote = await stuckQuote(runId, n);
    if (inflight.has(lk(runId, n))) throw err(409, "아직 답하는 중이에요. 기다리거나 [멈추기]를 누른 뒤 눌러 주세요.");
    const deeper = !!(await stuckView(runId));
    await openRoot(runId, { choice, word, quote: deeper ? undefined : quote });
    await syncTop(runId);
    const q = `[막혔어요] ${CHOICES[choice].label}${word ? `: \`${word}\`` : ""}${deeper ? " (이 칸 설명을 듣다가 또 막힘)" : quote ? "" : " (고른 코드 없음 — 어느 코드인지 먼저 물어보세요)"}`;
    return ask(runId, n, plan, q, deeper ? undefined : quote, `막혔어요 — ${CHOICES[choice].label}${word ? ` (${word})` : ""}`);
  }
  if (input.do === "stuck_ok") {
    // 학습자가 [이제 알겠어요]: 지금 칸을 풀림으로(학습자 자기 보고)
    const lang = langOf(course as { language?: string; stack?: string });
    const r = await resolveTop(runId, lang, "learner", "학습자가 [이제 알겠어요]를 누름");
    if (!r.ok || !r.frame) throw err(409, r.text);
    await change(runId, n, (_s, push) => push({ role: "me", text: "이제 알겠어요" }));
    await stuckReturned(runId, n, plan, r.frame);
    return null;
  }
  if (input.do === "stuck_leave") {
    const k = await leaveAll(runId);
    await syncTop(runId);
    void record({ runId, stage: n, beat: -1, type: "navigate", actor: "user", detail: `막혔어요 그만하기(${k}칸 닫음)` });
    return act(runId, n, { do: "resume" });
  }
  if (input.do.startsWith("bg:")) {
    const out = await answerBackground(runId, input.do);
    const q = bgQuestion(out.bg);
    return change(runId, n, (st, push) => {
      if (st.beat !== -1) return;
      if (out.said) push({ role: "me", text: out.said });
      if (q) { push({ role: "tutor", ...q }); st.waiting = "action"; return; }
      if (!out.bg.skipped) push({ role: "note", text: "알려 주신 걸로 설명 눈높이를 맞출게요." });
      enter(plan, st, 0, push, course);
    });
  }
  if (input.do === "open") { await openLine(runId, String(input.file ?? ""), Number(input.line) || 1); return null; }
  // 지도에서 덩어리를 누르면 불을 그 덩어리로 옮긴다(11/2 사용자: 누른 곳이 밝아져야). "오늘 고칠 곳"(계획서의 focus)은 화면에 따로 표시
  if (input.do === "peek") {
    const s = await read<State>(file(runId, n), { beat: 0, waiting: "action", messages: [], hints: 0 });
    const i = Number(input.index);
    if (s.focus && s.focus.file === input.file && s.focus.chunks[i]) bridgeSend(runId, { type: "focus", file: s.focus.file, chunks: s.focus.chunks.map((c, k) => ({ ...c, focus: k === i, today: !!c.focus })) });
    await openLine(runId, String(input.file ?? ""), Number(input.line) || 1);
    return null;
  }
  if (input.do === "scaffold") return scaffold(runId, n, plan, course);
  if (input.do === "tour") {
    // 흐름 투어 걸음: VS Code에서 그 덩어리에 불 켜기(AI 호출 없음)
    const st = await read<State>(file(runId, n), { beat: -1, waiting: "action", messages: [], hints: 0 });
    const card = [...st.messages].reverse().find((m) => m.card?.type === "tour" && (!input.text || m.card.id === input.text))?.card as { steps: { file: string; from: number; to: number; title: string }[] } | undefined;
    const step = card?.steps[Number(input.choice) || 0];
    if (step) bridgeSend(runId, { type: "tour", file: step.file, from: step.from, to: step.to, label: `${(Number(input.choice) || 0) + 1}/${card!.steps.length} ${step.title}` });
    return null;
  }
  if (input.do === "tourEnd") { bridgeSend(runId, { type: "tourEnd" }); return null; }
  if (input.do === "undo") {
    const id = String(input.text ?? "");
    const rec = await undoEdit(runId, await wsOf(runId, n), id);
    quietUntil.set(`${runId}:${n}`, Date.now() + 2500);
    return change(runId, n, (s, push) => {
      for (const m of s.messages) if (m.card?.type === "diff" && m.card.id === id) m.card.undone = true;
      push({ role: "note", text: `튜터가 고친 ${rec.file}을(를) 되돌렸어요.` });
    });
  }
  if (input.do === "check") return runCheck(runId, n, plan, course, "버튼");
  if (input.do === "mode_pair") return pairMode(runId, n, plan);
  // 만들어 주세요: 준비된 정답이 있는 코스는 그 파일로(늘 같음), 생성 코스는 튜터(OpenCode)에게 작업 지시(설계안 5.3)
  if (input.do === "mode_auto") return (course as { generated?: unknown }).generated ? workOrder(runId, n, plan, course) : autoFix(runId, n, plan, course);
  // 끼어들기(설계안 4.2·7.3): 같은 확인이 반복해서 다르면 원인부터 — 정답 대신 다른 가설과 확인 방법
  if (input.do === "diagnose") {
    void record({ runId, stage: n, type: "confusion", actor: "user", detail: "원인부터 같이 찾기" });
    return ask(runId, n, plan, "같은 확인이 여러 번 연속으로 기대와 달랐어요. [마지막 확인]과 지금 코드를 보고, 정답 코드는 주지 말고 세 가지만 짧게 알려 주세요: 1) 지금 코드가 실제로 하는 일 한 줄 2) 지금까지와 다른 원인 가설 하나 3) 그 가설을 확인하는 방법 하나(요청 보내 보기, 값 하나 출력해 보기 등). 필요하면 도구로 직접 확인해도 돼요.", undefined, "원인부터 같이 찾기");
  }
  if (input.do === "recap_ok") { await recapSeen(runId); void record({ runId, stage: n, type: "navigate", actor: "user", detail: "지난번 요약 보고 이어 하기" }); return null; }
  if (input.do === "hint") return giveHint(runId, n, input.level);

  // course-planner(11/3): 제안된 보충·연습·심화를 해 보기 / 건너뛰기
  if (input.do === "plan_go" || input.do === "plan_skip") {
    const item = (await pathOf(runId)).items.find((i) => i.afterStage === n);
    if (!item || item.decision === "next") throw err(409, "제안된 과제가 없어요.");
    if (input.do === "plan_skip") { await setStatus(runId, n, "skipped"); void record({ runId, stage: n, type: "navigate", actor: "user", detail: `${kindLabel(item.decision)} 건너뜀: ${item.task}` }); return change(runId, n, (_s, push) => push({ role: "me", text: "건너뛸게요" })); }
    await setStatus(runId, n, "doing");
    void record({ runId, stage: n, type: "navigate", actor: "user", detail: `${kindLabel(item.decision)} 해 봄: ${item.task}` });
    return ask(runId, n, plan, await taskPrompt(runId, item), undefined, `${kindLabel(item.decision)} 해 볼게요: ${item.task}`);
  }

  const after = await change(runId, n, async (s, push) => {
    const b = plan.beats[s.beat];
    const lastActions = [...s.messages].reverse().find((m) => m.actions)?.actions ?? [];
    if (["next", "known", "start_dev,try", "try", "next_stage", "observe", "db"].includes(input.do) && s.waiting !== "action") throw err(409, "지금 하던 것을 먼저 마쳐 주세요.");
    if (input.do === "next") {
      enter(plan, s, s.beat + 1, push, course);
    } else if (input.do === "known") {
      // "알아요, 넘길게요"(설계안 8.1: 강제하지 않음) — 자기평가로만 남기고 넘어간다
      if (!b || (b.kind !== "say" && b.kind !== "map")) throw err(409, "지금은 넘길 설명이 없어요.");
      void record({ runId, stage: n, beat: s.beat, type: "self_report", actor: "user", detail: `알아요, 넘길게요: ${b.now ?? firstLine(b.text)}` });
      if (await knownSkip(runId)) s.level = Math.max(s.level ?? 0, 1);
      push({ role: "me", text: "알아요, 넘길게요" });
      enter(plan, s, s.beat + 1, push, course);
    } else if (input.do === "mode_self") {
      if (s.waiting !== "save" || b?.kind !== "fix") throw err(409, "지금은 고칠 때가 아니에요.");
      s.mode = "self";
      push({ role: "me", text: "제가 해 볼게요" });
      push({ role: "tutor", text: "좋아요. 고치고 **Ctrl+S**로 저장하면 바로 확인할게요. 막히면 힌트를 받거나, 중간에 [같이 해요]로 바꿔도 돼요.", actions: modeActions(b, s) });
    } else if (input.do === "pair_next") {
      if (s.waiting !== "save" || b?.kind !== "fix" || s.mode !== "pair" || !b.pair) throw err(409, "지금은 다음 조각이 없어요.");
      s.pairStep = Math.min(b.pair.length - 1, (s.pairStep ?? 0) + 1);
      push({ role: "me", text: "다 했어요, 다음 조각" });
      push({ role: "tutor", text: `**${s.pairStep + 1}/${b.pair.length}** ${b.pair[s.pairStep]}`, actions: modeActions(b, s) });
    } else if (input.do === "resume") {
      // 자유 질문을 하다가 하던 순서로: 그 순서의 안내와 버튼을 다시 놓는다
      s.asked = false;
      if (stuckTop.has(runId)) { void leaveAll(runId); stuckTop.delete(runId); }
      void closeDetours(runId, s.act ? { type: s.act, target: s.actTarget ?? "" } : undefined);
      void record({ runId, stage: n, beat: s.beat, type: "navigate", actor: "user", detail: "하던 거로 돌아가기" });
      const acts = s.waiting === "save" && b?.kind === "fix" ? modeActions(b, s) : lastBeatActions(s) ?? b?.actions ?? [{ label: "다음", do: "next" }];
      push({ role: "me", text: "하던 거로 돌아가기" });
      push({ role: "tutor", text: `아까 하던 데로 돌아갈게요. **지금 할 일:** ${b?.now ?? firstLine(b?.text ?? "")}`, actions: acts });
    } else if (input.do === "confused" || input.do === "explain_skip") {
      if (s.waiting !== "explain") throw err(409, "지금은 설명을 적을 때가 아니에요.");
      const card = [...s.messages].reverse().find((m) => m.card?.type === "explain")!.card as Extract<Card, { type: "explain" }>;
      if (input.do === "confused") {
        await confused(runId, n);
        void record({ runId, stage: n, beat: s.beat, type: "confusion", actor: "user", detail: "내 말로 설명: 아직 헷갈려요" });
        card.done = "아직 헷갈려요";
        push({ role: "tutor", text: "괜찮아요. 헷갈린다고 적어 둘게요. 복습할 때 오늘 직접 본 결과와 같이 다시 볼게요." });
      } else card.done = "(건너뜀)";
      enter(plan, s, s.beat + 1, push, course);
    } else if (input.do === "start_dev,try" || input.do === "try") {
      const a = [...(b?.actions ?? []), ...(b?.after ?? [])].find((x) => x.do === input.do) ?? lastActions.find((x) => x.do === input.do);
      const reqs = a?.tries ?? (a?.try ? [a.try] : []);
      if (!a || !reqs.length) throw err(400, "보낼 요청이 없어요.");
      push({ role: "me", text: a.label });
      if (input.do === "start_dev,try" && !devStatus(runId).running) {
        const d = await startDev(runId);
        push({ role: "note", text: d.running ? "서버를 켰어요 (http://127.0.0.1:4101)" : "서버가 켜지지 않았어요. 아래 로그를 보세요." });
        if (!d.running) return;
      }
      if (!devStatus(runId).running) { const d = await startDev(runId); if (!d.running) { push({ role: "tutor", text: "서버가 켜지지 않았어요. 고치다가 문법이 깨진 것 같아요. 저장한 코드를 확인하거나 물어봐 주세요.", actions: [{ label: "다시 보내기", do: "start_dev,try", tries: reqs }] }); return; } }
      for (const q of reqs) {
        if (q.restart) {
          await stopDev(runId);
          const d = await startDev(runId);
          push({ role: "note", text: d.running ? "서버를 껐다가 다시 켰어요." : "서버를 다시 켜지 못했어요." });
          if (!d.running) return;
          continue;
        }
        const r = await tryRequest(runId, q);
        push({ role: "tutor", card: { type: "reply", request: r.request, status: r.status, timedOut: r.timedOut, error: r.error, headers: pick(r.headers), body: r.body } });
      }
      enter(plan, s, s.beat + 1, push, course);
    } else if (input.do === "db") {
      // DB 들여다보기: 응답이 아니라 실제로 저장된 것을 본다
      const a = [...(b?.actions ?? []), ...(b?.after ?? [])].find((x) => x.do === "db") ?? lastActions.find((x) => x.do === "db");
      if (!a?.sql) throw err(400, "볼 표가 없어요.");
      push({ role: "me", text: a.label });
      const t = await peekDb(runId, a.sql);
      push({ role: "tutor", card: { type: "table", ...t } });
      enter(plan, s, s.beat + 1, push, course);
    } else if (input.do === "observe") {
      // 지금 코드로 이번 단계 확인을 돌려 본다(고치기 전: 무엇이 기대와 다른지 보기)
      push({ role: "me", text: (b?.actions ?? []).find((x) => x.do === "observe")?.label ?? "확인해 보기" });
      try {
        const r = await check(runId, n, "observe");
        push({ role: "tutor", card: { type: "check", result: r } });
      } catch (e) { push({ role: "tutor", text: `확인하지 못했어요: ${(e as Error).message}` }); }
      enter(plan, s, s.beat + 1, push, course);
    } else if (input.do === "choice") {
      if (s.waiting !== "choice" || b?.kind !== "predict") throw err(409, "지금은 고를 때가 아니에요.");
      const card = [...s.messages].reverse().find((m) => m.card?.type === "choice")!.card as Extract<Card, { type: "choice" }>;
      const out = await predict(runId, n, b.predict!, Number(input.choice));
      void record({ runId, stage: n, beat: s.beat, type: "verify", actor: "user", concepts: stageOf(course, n).predict.find((p) => p.id === b.predict)?.knowledge, detail: `예측 ${out.correct ? "맞힘" : "틀림"}: ${b.predict}` });
      card.picked = Number(input.choice); card.answer = out.answer;
      push({ role: "me", text: card.options[card.picked] });
      push({ role: "tutor", text: `${out.correct ? "맞아요! " : `아쉬워요. 답은 **${card.options[out.answer]}** 예요. `}${out.why}`, actions: b.after ?? [{ label: "다음", do: "next" }] });
      s.waiting = "action";
    } else if (input.do === "explain") {
      if (s.waiting !== "explain") throw err(409, "지금은 설명을 적을 때가 아니에요.");
      const text = String(input.text ?? "").trim();
      await explain(runId, n, text);
      if (text) void record({ runId, stage: n, beat: s.beat, type: "self_report", actor: "user", concepts: stageOf(course, n).explain.knowledge, detail: `내 말로: ${text}` });
      // 개념 검증(11/3, 구조도 "평가"): AI가 "내 말로" 답을 보고 관찰로만 남긴다(검증 안 됨 · 진도는 그대로). 계획 제안 전에 끝나게 기다리지 않는다
      if (text) judging.set(lk(runId, n), judgeExplain(runId, n, text).catch(() => null));
      const card = [...s.messages].reverse().find((m) => m.card?.type === "explain")!.card as Extract<Card, { type: "explain" }>;
      card.done = text;
      push({ role: "tutor", text: "고마워요. 그대로 적어 둘게요. 복습할 때 오늘 쓴 이 문장을 다시 보여 드릴게요." });
      enter(plan, s, s.beat + 1, push, course);
    } else if (input.do === "next_stage") {
      s.waiting = "done";
      void pathOf(runId).then((f) => { const i = f.items.find((x) => x.afterStage === n); if (i?.status === "doing") return setStatus(runId, n, "done"); if (i?.status === "proposed") return setStatus(runId, n, "skipped"); }).catch(() => {});
    } else throw err(400, "모르는 동작이에요.");
  });
  // 마지막 걸음(정리)에 들어서면 course-planner가 다음 경로를 제안한다(뒤에서, 한 단계에 한 번)
  if (after.beat === plan.beats.length - 1 && ["explain", "explain_skip", "confused", "next", "known"].includes(input.do)) void proposePath(runId, n);
  return after;
}
/** course-planner 제안을 받아 화면에 한 번 띄운다: 다음 단계면 이유만, 보충·연습·심화면 [해 볼게요] / [건너뛰고 다음 단계] */
async function proposePath(runId: string, n: number) {
  await Promise.race([judging.get(lk(runId, n)), new Promise((r) => setTimeout(r, 20000))]); // "내 말로" 판단이 먼저 기록되게
  const item = await planAfterStage(runId, n).catch(() => null);
  if (!item || !item.reason) return;
  await change(runId, n, (s, push) => {
    if (s.messages.some((m) => m.actions?.some((a) => a.do === "plan_go"))) return;
    if (item.decision === "next") { push({ role: "tutor", text: item.reason }); return; }
    push({ role: "tutor", text: `${item.reason}\n\n**${kindLabel(item.decision)} 하나 해 볼까요?** ${item.task}`, actions: [{ label: "해 볼게요", do: "plan_go" }, { label: "건너뛰고 다음 단계", do: "next_stage" }] });
    s.waiting = "action";
  }).catch(() => {});
}
const pick = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).filter(([k]) => ["content-type", "allow", "location", "set-cookie"].includes(k)));

/* ---------- 확인(검사) ---------- */
async function runCheck(runId: string, n: number, plan: Plan, course: Awaited<ReturnType<typeof loadCourse>>, why: string) {
  // 빈칸 뼈대를 넣었다면, 아직 남은 빈칸 번호(①②…)를 찾아 둔다.
  const wsDir = await wsOf(runId, n);
  const left = new Set<string>();
  for (const f of stageOf(course, n).fix.files) {
    const t = await readFile(path.join(wsDir, f), "utf8").catch(() => "");
    for (const m of t.matchAll(/\/\* ([①②③④⑤⑥⑦⑧⑨]) /g)) left.add(m[1]);
  }
  if (why === "저장") void record({ runId, stage: n, type: "code_edit", actor: "user", detail: `학습자가 저장함: ${stageOf(course, n).fix.files.join(", ")}`, evidence: stageOf(course, n).fix.files });
  await change(runId, n, (s, push) => { s.busy = true; if (why === "저장") push({ role: "note", text: "저장한 걸 봤어요. 바로 확인해 볼게요…" }); else if (why === "튜터") push({ role: "note", text: "고친 코드로 확인해 볼게요…" }); else push({ role: "me", text: "지금 확인해 줘" }); });
  let result: Awaited<ReturnType<typeof check>> | null = null;
  let failed = "";
  try { result = await check(runId, n, "check"); } catch (e) { failed = (e as Error).message; }
  return change(runId, n, (s, push) => {
    s.busy = false;
    if (!result) { push({ role: "tutor", text: `확인하지 못했어요: ${failed}` }); return; }
    s.lastCheck = result;
    void record({ runId, stage: n, beat: s.beat, type: "execution", actor: "system", detail: `검사(${why}): ${result.results.filter((r) => r.ok).length}/${result.results.length} 통과${result.started ? "" : " · 서버가 안 켜짐"}` });
    push({ role: "tutor", card: { type: "check", result } });
    if (result.stageOk) {
      // 채팅에서 "고쳐 줘"로 튜터가 고친 것도 "만들어 주세요"와 같게 친다(11/2: 전에는 화면 상태가 안 바뀌어 "직접 고침"으로 찍혔다)
      const byTutor = s.mode === "auto" || !!s.tutorEdit;
      s.failStreak = 0;
      void stageOutcome(runId, { mode: s.mode, hints: s.hints, byTutor }).then((o) => { if (o.to !== o.from) void change(runId, n, (st) => { st.level = o.to; }); });
      // 개발 완료와 학습은 따로(설계안 8장): 통과는 "적용 근거"로만, 누가 고쳤는지 그대로
      void record({ runId, stage: n, beat: s.beat, type: "application", actor: byTutor ? "agent" : "user", concepts: stageOf(course, n).knowledge, detail: `단계 검사 통과 · ${byTutor ? "튜터가 고침" : s.hints >= 3 ? "정답 줄 보고 고침" : s.mode === "pair" ? "같이 고침" : "직접 고침"}` });
      const how = byTutor ? "튜터가 고침" : s.hints >= 3 ? "정답 줄 보고 고침" : s.mode === "pair" ? "같이 고침" : "직접 고침";
      for (const f of stageOf(course, n).fix.files) void addEntry(runId, wsDir, f, { stage: n, kind: "fixed", title: how, summary: `${plan.title}: ${stageOf(course, n).fix.text}`.slice(0, 120) }).catch(() => {});
      push({ role: "tutor", text: (byTutor ? `제가 고친 코드로 모든 확인을 통과했어요. ${plan.passText ?? ""} 이 부분은 나중에 복습에서 직접 써 볼 기회를 드릴게요.`
        : s.hints >= 3 ? "통과했어요. 정답 줄을 보고 고친 거라, 이 부분은 다음 복습에서 코드 없이 한 번 더 확인할게요."
        : s.mode === "pair" ? `**통과!** 같이 고쳐서 모든 확인을 통과했어요. ${plan.passText ?? ""}`
        : `**통과!** 직접 고쳐서 모든 확인을 통과했어요. ${plan.passText ?? ""}`).trim() });
      if (s.waiting === "save") enter(plan, s, s.beat + 1, push, course);
      void stopDev(runId); // 실습 서버는 고치기 전 코드로 떠 있을 수 있다: 다음 요청 때 새 코드로 다시 켠다
    } else {
      const bad = result.results.filter((r) => !r.ok);
      const first = bad[0];
      s.failStreak = (s.failStreak ?? 0) + 1;
      const where = first?.where ? ` [[${first.where.file}:${first.where.line ?? 1}]]` : "";
      push({ role: "tutor", text: !result.started
        ? (left.size ? `아직 빈칸 ${[...left].join("")}이(가) 남아 있어서 서버가 켜지지 않아요. 빈칸을 모두 채우고 저장해 주세요. 하나씩 막히면 그 줄을 드래그해서 물어보세요.` : "서버가 아예 켜지지 않았어요. 고치다가 문법이 깨진 것 같아요. 위 카드의 오류 위치를 열어 보세요.")
        : `아직 ${bad.length}개가 기대와 달라요. 먼저 "${first.title}"을 보세요. 기대는 **${first.failure?.expected}** 인데 실제는 **${first.failure?.actual}** 이에요.${where}\n\n다시 고치고 저장하면 또 확인할게요. 막히면 물어보거나 힌트를 눌러 주세요.`,
        actions: [{ label: "힌트 줘", do: "hint" }] });
      if (s.failStreak === 3) {
        // 끼어들기: 같은 방식으로 계속 두드리지 않게 방법을 바꾸자고 먼저 말한다(한 번만)
        void record({ runId, stage: n, beat: s.beat, type: "confusion", actor: "system", detail: "확인이 3번 연속 기대와 다름" });
        const b = plan.beats[s.beat];
        push({ role: "tutor", text: "같은 확인이 세 번 연속 기대와 달랐어요. 같은 방법으로 계속 고치기보다 방법을 바꿔 볼까요?", actions: [
          { label: "원인부터 같이 찾기", do: "diagnose" },
          ...(s.mode !== "pair" && b?.pair?.length ? [{ label: "같이 해요 (빈칸으로)", do: "mode_pair" }] : []),
          { label: "만들어 주세요", do: "mode_auto" }] });
      }
    }
  });
}

async function giveHint(runId: string, n: number, level?: number) {
  const s = await read<State>(file(runId, n), { beat: 0, waiting: "action", messages: [], hints: 0 });
  const next = Math.min(3, level ?? s.hints + 1) as 1 | 2 | 3;
  const r = await hint(runId, n, next, s.lastCheck);
  return change(runId, n, (st, push) => {
    st.hints = Math.max(st.hints, next);
    void record({ runId, stage: n, beat: st.beat, type: "confusion", actor: "user", detail: `힌트 ${next}단계 요청` });
    push({ role: "me", text: next === 3 ? "정답 줄 보여 줘" : "힌트 줘" });
    push({ role: "tutor", card: { type: "hint", level: next, text: r.text, source: r.source },
      actions: next < 3 ? [{ label: next === 1 ? "조금 더 구체적으로" : "정답 줄 보여 줘", do: "hint" }] : undefined });
  });
}

/* ---------- 자유 질문: AI 튜터 ---------- */
const TUTOR = `너는 웹 서버를 처음 배우는 학습자 옆에 앉은 친절한 강사다. 한국어 해요체로, 채팅하듯 따뜻하고 쉽게 말한다.
- 질문에 먼저 답한다. 2~6문장. 비유는 [수업 계획서]가 쓰는 것을 이어서 쓴다. 어려운 말은 처음 나오면 풀어서 말한다.
- [수업 계획서]의 순서와 정답은 바꾸지 않는다. 지금 하는 순서보다 앞서가는 답(예측 문제의 답)을 미리 말하지 않는다.
- 고친 코드를 통째로 주지 않는다. 줄이나 함수를 짚는 것까지는 된다. 파일 줄을 짚을 때는 [[파일경로:줄번호]] 꼴로 쓴다(화면에서 VS Code 링크가 된다).
- 맞았다/틀렸다를 단정하지 않는다. 그건 확인(검사)이 정한다.
- 답한 뒤 한 문장으로 지금 하던 것으로 자연스럽게 돌아오게 한다.`;

/* ---------- 흐름 투어 ("실제 동작 설명해 주세요", "구조 설명해 주세요") ---------- */
const TOUR_INTENT = /(실제|진짜)\s*(동작|작동)|어떻게\s*(돌아|동작|작동|움직|흘러)|흐름|구조|따라가|투어|순서대로\s*(보여|설명)/;
const TOUR_Q = `[흐름 투어로 답하기] show_tour 도구로 답한다. 이 단계에서 의미 있는 대표 요청 하나(예: GET /health)를 정하고, 그 요청이 들어와 답장이 나갈 때까지 실제로 지나가는 코드 덩어리를 실행 순서대로 4~8걸음.
- 걸음마다 file, from, to(그 일을 하는 줄만 2~15줄. 파일 머리 주석·import 줄은 빼고), anchor(그 덩어리 첫 줄 코드 일부를 파일 그대로), title(짧은 이름, 예: "편지 도착"), text(해요체 2~4문장 마크다운: 여기서 무슨 일이 일어나는지 + 다음에 어느 파일·덩어리로 넘어가는지. 수업의 "편지와 답장" 비유를 잇는다).
- 파일들은 위에 붙어 있으니 다시 읽지 않는다. 아직 없는 파일(뒤 단계)은 넣지 않는다. 앞으로 할 예측 문제의 답은 말하지 않는다.
- 도구를 부른 뒤에는 한두 문장으로만 마무리한다.`;
/** 투어용: 작업 폴더의 코드 파일 전부(작은 프로젝트라 한 번에 붙인다) */
async function allFiles(ws: string): Promise<CtxFile[]> {
  const out: CtxFile[] = [];
  let total = 0;
  async function walk(dir: string, rel: string) {
    for (const e of await readdir(path.join(ws, dir), { withFileTypes: true }).catch(() => [])) {
      if ([".recaller", "node_modules", "data", ".git", "public"].includes(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else if (/\.(ts|js|mjs)$/.test(e.name) && total < 1500) {
        const t = await readFile(path.join(ws, dir, e.name), "utf8").catch(() => "");
        const lines = t.split(/\r?\n/); total += lines.length;
        out.push({ key: r, text: `[파일 ${r}]\n${lines.map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join("\n")}` });
      }
    }
  }
  await walk("", "");
  return out;
}

/** 튜터가 답에 이 단계 정답 줄을 보여 줬으면 "정답 줄을 봤다"(힌트 3단계)로 친다.
 *  실사용 확인(10/30): "그냥 코드 알려 주세요"에 정답 두 줄을 줬는데, 그걸 붙여 넣고 통과하면 "직접 통과"로 기록되던 것. */
const solutionTokens = new Map<string, string[]>();
const solutionLines = new Map<string, string[]>();
async function revealedSolution(runId: string, n: number, answer: string) {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const key = `${course.id}:${n}`;
  if (!solutionLines.has(key)) {
    const lines = (await solutionDiff(course, n)).flatMap((d) => d.diff.split("\n").filter((l) => l.startsWith("+ ")).map((l) => l.slice(2).replace(/\s+/g, "")))
      .filter((l) => l.length >= 18 && !l.startsWith("//"));
    solutionLines.set(key, lines);
  }
  const flat = answer.replace(/\s+/g, "");
  const hit = solutionLines.get(key)!.filter((l) => flat.includes(l));
  // 한 줄 안에서 값 하나만 바꾸는 정답(예: 400 → 200)은 줄째로 안 나온다 → "200으로 바꾸면" 같은 말도 정답 공개로(11/3 품질 확인)
  if (!solutionTokens.has(key)) solutionTokens.set(key, (await solutionDiff(course, n)).flatMap((d) => {
    const minus = d.diff.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
    const plus = d.diff.split("\n").filter((l) => l.startsWith("+ ")).map((l) => l.slice(2));
    return plus.flatMap((pl, i) => { const old = new Set((minus[i] ?? "").match(/[\w가-힣]+/g) ?? []); return (pl.match(/[\w가-힣]+/g) ?? []).filter((t) => !old.has(t)); });
  }));
  const said = solutionTokens.get(key)!.some((t) => new RegExp(`\`?${t.replace(/[$]/g, "\\$")}\`?\\s*(으로|로)\\s*(바꾸|바꿔|고치|고쳐|넣|써|쓰)`).test(answer));
  if (!hit.length && !said) return;
  await saveRun(runId, (r) => { stageProgress(r, n).hints.push({ level: 3, at: new Date().toISOString(), source: "tutor-answer" }); });
  await change(runId, n, (s, push) => {
    if (s.hints < 3) { s.hints = 3; push({ role: "note", text: "튜터가 정답 줄을 보여 줬어요. 이번 단계는 \"정답 보고 고침\"으로 기록하고, 나중 복습에서 코드 없이 한 번 더 확인할게요." }); }
  });
}

/** 질문·답을 프로젝트 노트에: 어느 파일에 대한 것인지 정해서 그 파일 밑에 */
async function remember(runId: string, n: number, ws: string, s0: State, x: { q: string; shown?: string; quote?: { file: string; from: number; to: number }; mode?: string; answer: string }) {
  if (!x.answer || /^(답을|지금은 AI|생각이 너무)/.test(x.answer) || x.mode === "tour") return; // 투어는 카드에서 따로
  const word = /^"(.+)"는 뭐예요\?$/.exec(x.shown ?? "")?.[1];
  // 어느 파일 이야기인지: 고른 코드 → 최근에 물은 코드 → VS Code에서 보던 파일 → 답에 처음 나온 [[파일:줄]]
  const target = x.quote?.file ?? lastQuoteFile(s0) ?? bridgeState(runId)?.file ?? /\[\[([^\]:#]+)[:#]/.exec(x.answer)?.[1] ?? null;
  if (!target) return;
  if (x.mode === "explain" && x.quote) return; // 덩어리 설명은 explainBlock에서
  await addEntry(runId, ws, target, word
    ? { stage: n, kind: "word", title: word, summary: firstLine(x.answer), terms: [word] }
    : { stage: n, kind: "asked", from: x.quote?.from, to: x.quote?.to, title: (x.shown ?? x.q).replace(/\s+/g, " ").slice(0, 50), summary: firstLine(x.answer), terms: codeTerms(x.answer).slice(0, 8) });
}

/** 최근에 물어본 코드의 파일(설명 속 단어를 눌러 이어 물을 때 같은 파일을 붙이려고) */
function lastQuoteFile(s: State) { return [...s.messages].reverse().find((m) => m.card?.type === "code")?.card?.file as string | undefined; }
/** 파일 내용을 줄 번호와 함께. withImports면 그 파일이 가져오는 이 프로젝트 파일(./x.ts)도 */
async function filesFor(ws: string, file: string | null, withImports: boolean): Promise<CtxFile[]> {
  if (!file || file.includes("..")) return [];
  const num = (t: string, max: number) => t.split(/\r?\n/).slice(0, max).map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join("\n");
  const main = await readFile(path.join(ws, file), "utf8").catch(() => null);
  if (main === null) return [];
  const out: CtxFile[] = [{ key: file, text: `[파일 ${file} — 이미 붙여 두었으니 다시 읽지 않아도 된다]\n${num(main, 300)}` }];
  if (withImports) {
    const dir = path.posix.dirname(file);
    const deps = [...main.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)].map((m) => path.posix.normalize(path.posix.join(dir, m[1]))).slice(0, 4);
    for (const d of deps) {
      const t = await readFile(path.join(ws, d), "utf8").catch(() => null);
      if (t !== null) out.push({ key: d, text: `[이 파일이 가져오는 ${d}]\n${num(t, 150)}` });
    }
  }
  return out;
}

/** 튜터 맥락: 지금 화면에서 학습자가 할 수 있는 것(버튼 이름 그대로 · 같이 해요 조각 · 기다리는 입력). 없는 칸을 지어내지 않게 */
function screenLine(s: State, b: Beat | undefined) {
  const acts = [...s.messages].reverse().find((m) => m.actions?.length)?.actions ?? [];
  const wait = s.waiting === "save" ? "VS Code에서 고치고 Ctrl+S로 저장하면 자동으로 확인됨" : s.waiting === "choice" ? "보기 중 하나를 누르기" : s.waiting === "explain" ? "\"내 말로\" 칸에 한 문장 쓰기" : "";
  const pair = s.mode === "pair" && b?.pair?.length ? ` · 같이 해요 조각 ${(s.pairStep ?? 0) + 1}/${b.pair.length}: ${b.pair[s.pairStep ?? 0]}(찾기만 하는 조각이면 쓸 칸은 없다, 찾았으면 [다 했어요, 다음 조각])` : "";
  return `[지금 화면] 버튼: ${acts.length ? acts.map((a) => `[${a.label}]`).join(" ") : "없음"}${wait ? ` · ${wait}` : ""}${pair} · 그 밖의 입력 칸은 아래 질문 칸뿐`;
}

/** 단계 이름 앞의 "1단계:"를 뗀다(생성 코스는 AI가 붙여 오기도 한다 — 맥락에 "1단계 1단계:"가 되던 것, 11/3) */
const bareTitle = (t: string) => String(t ?? "").replace(/^\s*\d+\s*단계\s*[:.·-]?\s*/, "");
/** 튜터 맥락: 코스 전체 순서. 생성 코스는 아직 안 만든 단계까지 목차로(11/3: 만든 1단계만 보이던 것) */
function courseOrder(course: Awaited<ReturnType<typeof loadCourse>>, run: Awaited<ReturnType<typeof getRun>>, n: number) {
  const outline = (course as { generated?: { outline: { n: number; title: string; goal: string }[] } }).generated?.outline;
  if (outline?.length) return `[코스 전체 순서] ${outline.map((o) => `${o.n}단계 ${bareTitle(o.title)}${o.n === n ? "(지금)" : ""} — ${o.goal}`).join(" / ")}`;
  return `[코스 전체 순서] ${course.stages.map((x) => `${x.transfer ? "전이 과제" : `${x.n}단계`} ${bareTitle(x.title)}${x.n === n ? "(지금)" : run.plan.stages.includes(x.n) || x.transfer ? "" : "(건너뜀)"}`).join(" / ")}`;
}
/** 튜터 맥락: 학습자 목표(코스 정하기에서 받은 것, 없으면 생성 코스를 만들 때 적은 것) */
function learnerGoal(course: Awaited<ReturnType<typeof loadCourse>>, run: Awaited<ReturnType<typeof getRun>>) {
  const g = (run.profile as { goal?: string } | undefined)?.goal || (course as { generated?: { goal: string } }).generated?.goal;
  return g ? `[학습자 목표] ${g}` : "";
}

/**
 * 질문에 붙일 파일(11/3 비교: 검색 1번 + 읽기 2번 하느라 느렸다 → 코드가 미리 찾아 붙인다).
 * 지금 보는 파일 + 질문에 나온 이름이 정의된 파일 + (보는 파일이 없으면) 이번 단계 고칠 파일과 app.ts. 4개까지
 */
async function questionFiles(ws: string, q: string, file: string | null, fixFiles: string[], withImports: boolean): Promise<CtxFile[]> {
  const names = [...new Set([...q.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]).filter((w) => w.length >= 3))].slice(0, 12);
  const defined: string[] = [];
  if (names.length) for (const f of await listSrc(ws)) {
    const t = await readFile(path.join(ws, f), "utf8").catch(() => "");
    if (names.some((nm) => new RegExp(`(function|class|const|let|var|type|interface)\\s+${nm.replace(/\$/g, "\\$")}\\b|^\\s+${nm.replace(/\$/g, "\\$")}\\s*\\(`, "m").test(t))) defined.push(f);
  }
  const want = [...new Set([...(file ? [file] : []), ...defined, ...(file ? [] : [...fixFiles, "src/app.ts"])])].filter((f) => !f.includes("..")).slice(0, 4);
  const out: CtxFile[] = [];
  for (const [i, f] of want.entries()) for (const c of await filesFor(ws, f, withImports && i === 0)) if (!out.some((o) => o.key === c.key)) out.push(c);
  return out;
}
async function listSrc(ws: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string) => {
    for (const e of await readdir(path.join(ws, rel), { withFileTypes: true }).catch(() => [])) {
      const r = path.posix.join(rel, e.name);
      if (e.isDirectory() && !/node_modules|^\./.test(e.name)) await walk(r);
      else if (/\.(ts|js)$/.test(e.name)) out.push(r);
    }
  };
  await walk("src");
  return out.slice(0, 40);
}

/* ---------- 컨텍스트 관리자 조각(11/3) ---------- */
export const RECENT_MIN = 12;      // 최근 대화는 적어도 이만큼(지금 걸음은 통째로)
export const RECENT_MAX = 30;
export const OLDER_LIMIT = Number(process.env.PC_OLDER_LIMIT) || 6000; // 앞부분이 이 글자 수를 넘을 때만 요약한다(매번 하지 않는다)
/** 원격 실험용: .data/control/env.json의 PC_OLDER_LIMIT가 있으면 그걸(서버를 다시 켜지 않고 바꿀 수 있게) */
function olderLimit() {
  try { const v = Number(JSON.parse(readFileSync(path.join(DATA, "control", "env.json"), "utf8")).PC_OLDER_LIMIT); if (v > 0) return v; } catch { /* */ }
  return OLDER_LIMIT;
}
/** 최근 대화 자르기: 마지막 12개, 단 지금 걸음의 메시지는 자르지 않는다(30개까지) */
export function splitRecent<T extends { beat?: number }>(ms: T[], beat: number) {
  let cut = Math.max(0, ms.length - RECENT_MIN);
  const beatStart = ms.findIndex((m) => m.beat === beat);
  if (beatStart >= 0) cut = Math.min(cut, beatStart);
  cut = Math.max(cut, ms.length - RECENT_MAX);
  return { older: ms.slice(0, cut), recent: ms.slice(cut) };
}
/** 앞부분: 짧으면 그대로, 길면 요약(넘쳤을 때만 새로 만들고 수업 기록에 남긴다. 요약 뒤에 쌓인 게 짧으면 요약 + 그대로) */
async function olderContext(runId: string, n: number, s0: State, older: LMsg[], talk: (ms: LMsg[]) => string) {
  if (!older.length) return "";
  const all = talk(older);
  const limit = olderLimit();
  if (all.length <= limit) return `[앞부분 대화]\n${all}`;
  const sum = s0.summary;
  const rest = sum ? older.filter((m) => m.id > sum.upTo) : older;
  const restText = talk(rest);
  if (sum && restText.length <= limit / 2) return `[앞부분 대화 요약]\n${sum.text}${restText ? `\n\n[그 뒤 대화]\n${restText}` : ""}`;
  try {
    const text = (await aiText("context-summary", SUMMARY_SYSTEM, [sum ? `[지난 요약]\n${sum.text}` : "", `[대화]\n${restText}`].filter(Boolean).join("\n\n"))).trim().slice(0, 1500);
    await change(runId, n, (st) => { st.summary = { upTo: older.at(-1)!.id, text }; });
    return `[앞부분 대화 요약]\n${text}`;
  } catch {
    return `[앞부분 대화(뒤쪽만)]\n…${all.slice(-limit)}`;
  }
}
const SUMMARY_SYSTEM = `코딩 학습 튜터와 학습자의 지난 대화를 다음 대화에 쓸 메모로 줄인다. 한국어, 600자 이내, 목록으로.
- 학습자가 이미 이해한 것 / 헷갈려한 것 / 물어본 것과 받은 답의 요점 / 튜터가 쓴 비유
- 학습자가 직접 쓴 문장("내 말로" 답, 예측에서 고른 답)은 따옴표로 그대로 옮긴다.
- 사실만. 새로 판단하거나 칭찬하지 않는다.`;

/** 아직 안 한 순서: 튜터가 학습자가 직접 맞히거나 고칠 것을 미리 말하지 않게 */
function upcoming(plan: Plan, beat: number) {
  const rest = plan.beats.slice(beat + 1).filter((x) => x.kind === "predict" || x.kind === "fix");
  if (!rest.length) return "";
  const lines = rest.map((x) => x.kind === "predict" ? `- 예측 문제: ${x.text.split("\n")[0].slice(0, 120)}` : `- 학습자가 직접 고치는 차례: ${x.text.split("\n")[0].slice(0, 120)}`);
  // 11/3 비교(ChatGPT와 같은 맥락): "어디를 보면 되는지까지만"이 원리·원인 설명까지 막았다 → 숨길 것을 좁힌다
  return `[앞으로 할 순서 — 학습자가 직접 맞히고 고칠 차례]\n${lines.join("\n")}\n미리 말하지 않는 것은 두 가지뿐이다: 예측 문제의 정답, 고칠 줄의 완성 코드(바꿔 넣을 값 포함). 왜 그렇게 되는지(원인·원리), 어디를 보면 되는지는 질문에 맞게 충분히 설명한다.`;
}

// main: 걸음 대화(talk 걸음)라 따로 물어본 대화로 치지 않는다
type AskOpts = { mode?: "explain" | "tour"; onAnswer?: (text: string) => Promise<void>; scope?: string[]; silent?: boolean; main?: boolean };
export async function ask(runId: string, n: number, plan: Plan, text: string, quote?: { file: string; from: number; to: number; code: string }, shown?: string, opts: AskOpts = {}) {
  const q = text.trim().slice(0, 1000) || (quote ? "이 코드가 뭐 하는 거예요?" : "");
  if (!q) throw err(400, "질문을 적어 주세요.");
  // 한 번에 하나만: 답하는 중에 또 물으면 대화가 엉킨다(10/30 시험에서 되묻기 카드가 섞임)
  if (inflight.has(lk(runId, n))) throw err(409, "아직 답하는 중이에요. 기다리거나 [멈추기]를 누른 뒤 물어봐 주세요.");
  inflight.add(lk(runId, n));
  const before = (await syncTop(runId))?.id;
  let out: State;
  try { out = await askInner(runId, n, plan, q, text, quote, shown, opts); } finally { inflight.delete(lk(runId, n)); }
  // [막혔어요] 칸이 이번 답에서 바뀌었으면(튜터가 한 칸 내려가거나 풀림) 다음 차례를 이어 준다
  if (before) await afterStuckChange(runId, n, plan, before).catch((e) => console.error("[stuck]", e));
  return out;
}

/* ---------- [막혔어요] 칸 이어 주기(11/3) ---------- */
const DIAG = `짧은 질문으로 층을 짚는다: 1~2초면 답할, 답을 보면 무엇이 비었는지 드러나는 질문 하나(예: "괄호 안에 들어간 게 몇 덩어리예요?", "이 함수는 이 줄을 지날 때 바로 실행돼요, 나중이에요?", "res에는 누가 무엇을 넣어 줘요?", "따옴표 안의 /todos랑 그냥 todos는 같은 거예요?"). "어느 쪽이 낯설어요?", "어디가 모르겠어요?"처럼 학습자가 스스로 진단하게 묻지 않는다. 처음 하는 학습자는 대개 여러 층(남이 만든 이름 · 모양(기호) · 실행 시점 · 값이 오는 곳)이 함께 비어 있다 — 가장 아래 것부터.`;
export const ROOT_RULES = `이 칸은 처음 막힌 줄 자체다(이름을 바꾸지 않는다).
1. ${DIAG}
2. 빈 칸을 찾으면 stuck_name_gap(목록 id 또는 other, 라이브러리·프레임워크 단어는 library-api, why=학습자가 막힌 말) — 그 칸이 아래에 열린다. 도구 결과를 받으면 같은 답에서 바로 그 칸을 [아래 칸 규칙]대로 설명한다.
3. 아래 칸에서 돌아오면 화면이 학습자에게 처음 줄을 한국어로 읽어 보게 한다(코드가 띄움). 학습자가 읽은 말에서 아직 막히는 데가 보이면 그다음 빈 칸을 짚어 또 연다.
4. 학습자가 줄을 자기 말로 맞게 읽으면 stuck_resolved(evidence=학습자가 읽은 말).
막힘 도구(stuck_…)는 부르기 전에 "기록할게요", "짚어 둘게요" 같은 말을 하지 않는다(화면에 따로 보인다).
코스의 다음 걸음·정답 코드는 말하지 않는다.`;
export const CHILD_RULES = `할 일(이 칸 하나만):
1. [위 칸에서 내려온 이유]의 그 막힘에 바로 닿는 아주 작은 예(새로 만든 짧은 코드)로 3~6문장 설명한다(칸 이름의 일반론이 아니라 그 질문의 답 쪽으로, 예: "안쪽 함수가 바깥 이름을 어떻게 쓰나"면 그 방향의 예). 한 번에 하나. 예시는 처음 막힌 코드와 같은 모양으로(막힌 줄이 (req, res) => { … }면 { } 블록 모양) 쓰고, 학습자 배경에 없는 문법(타입 표시 : number 같은 것)은 넣지 않는다.
2. 학습자가 직접 답하거나 한 줄 써 볼 작은 확인 하나로 끝낸다. 확인은 이 칸의 핵심을 써야 풀리는 것으로(이름 짐작처럼 안 배워도 맞히는 것은 안 된다).
3. 답이 맞으면 stuck_resolved(evidence=학습자가 한 것). 틀리면 다르게 한 번 더. 이 칸은 이미 이름이 있으니 stuck_name_gap은 부르지 않는다. 풀림 뒤에는 이 칸과 상관없는 말을 덧붙이지 않는다.
4. 설명하다 그보다 아래가 비어 보이면(짧은 질문으로 확인한 뒤) stuck_go_deeper(그 칸, why) — 열리면 같은 답에서 바로 그 칸을 설명한다. 이미 위에 있는 칸으로는 내려가지 않는다.
막힘 도구(stuck_…)는 부르기 전에 "기록할게요" 같은 말을 하지 않는다(화면에 따로 보인다).
코스의 다음 걸음·정답 코드는 말하지 않는다.`;
/** 칸이 바뀐 뒤: 아래 칸이 열렸으면 그 칸 설명을, 풀렸으면 위 칸으로 돌아가 원래 막힌 것을 다시 해 보게. 맨 위가 풀렸으면 코스로 */
async function afterStuckChange(runId: string, n: number, plan: Plan, beforeId: string) {
  const st = await stuckOf(runId);
  const stack = openStack(st);
  const top = stack.at(-1);
  if (top?.id === beforeId) return;
  const old = st.frames.find((f) => f.id === beforeId);
  // 한 칸 아래가 열림: 같은 답에서 이미 설명했다(대화 하나, 11/3) — 위치만 맞춘다
  if (top && top.parent === beforeId) { await syncTop(runId); return; }
  if (old?.status === "resolved") await stuckReturned(runId, n, plan, old);
}
/** 칸 하나가 풀린 뒤 */
async function stuckReturned(runId: string, n: number, plan: Plan, done: Frame) {
  const parent = await syncTop(runId);
  void record({ runId, stage: n, beat: -1, type: "self_report", actor: done.by === "learner" ? "user" : "agent", detail: `막혔어요 풀림: ${labelOf(done)} — ${done.result ?? ""}`.slice(0, 300) });
  if (parent) {
    // B가 풀리면 그냥 A로(11/3 사용자 "B를 해결하면 그냥 A로 돌아오면 되는 거 아님?"): 튜터를 다시 부르지 않고 코드가 A를 다시 놓는다.
    // A에서 한 대화는 맥락에 그대로 있으니, 학습자가 A에서 다음 말을 하면 튜터가 이어서 본다
    await change(runId, n, (s, push) => {
      push({ role: "note", text: `✔ ${labelOf(done)} — 풀렸어요. ${labelOf(parent)}(으)로 돌아왔어요.` });
      if (parent.depth === 0 && parent.quote) {
        push({ role: "tutor", text: `처음 막힌 줄이에요. 이제 이 줄을 아는 만큼 한국어로 읽어 볼래요? 아직 막히는 데가 있으면 그것도 말해 주세요.\n\n\`\`\`ts ${parent.quote.file}:${parent.quote.from}\n${parent.quote.code.trim()}\n\`\`\`` });
      } else {
        // A에서 튜터가 마지막으로 한 말(대개 A의 확인 질문)을 다시 보여 준다
        const last = [...s.messages].reverse().find((m) => m.sf === parent.id && m.role === "tutor" && m.text && m.text.length > 20);
        push({ role: "tutor", text: last ? `아까 하던 데로 돌아왔어요.\n\n> ${last.text!.split("\n").filter(Boolean).slice(-2).join("\n> ")}` : `"${labelOf(parent)}"로 돌아왔어요. 이어서 해 볼게요.` });
      }
    });
    return;
  }
  // 맨 위 칸이 풀림: 코스로(코스 대화에는 이 한 줄만 들어간다). 프리스타일이면 걸음 안내 없이
  const freeRun = !!(await getRun(runId)).free;
  await change(runId, n, (s, push) => {
    const b = plan.beats[s.beat];
    const acts = s.waiting === "save" && b?.kind === "fix" ? modeActions(b, s) : lastBeatActions(s) ?? b?.actions ?? [{ label: "다음", do: "next" }];
    push({ role: "note", text: `✔ 막혔던 것 풀렸어요: ${labelOf(done)}${done.result ? ` (${done.result})` : ""}` });
    if (b && !freeRun) push({ role: "tutor", text: `원래 하던 데로 돌아갈게요. **지금 할 일:** ${b.now ?? firstLine(b.text)}`, actions: acts });
    s.asked = false;
  });
}

/** [막혔어요]에서 고를 단어: 고른 코드(드래그 → 보는 줄 → 마지막으로 물은 코드)의 이름들 */
async function stuckQuote(runId: string, n: number): Promise<{ file: string; from: number; to: number; code: string } | undefined> {
  const bs = bridgeState(runId);
  if (bs?.file && bs.selection?.text?.trim()) return { file: bs.file, from: bs.selection.from, to: bs.selection.to, code: bs.selection.text.slice(0, 1500) };
  if (bs?.file && bs.line) {
    const text = (bs.dirty && bs.text) ? bs.text : await readFile(path.join(await wsOf(runId, n), bs.file), "utf8").catch(() => "");
    const line = text.split(/\r?\n/)[bs.line - 1];
    if (line?.trim()) return { file: bs.file, from: bs.line, to: bs.line, code: line };
  }
  const s = await read<State>(file(runId, n), { beat: -1, waiting: "action", messages: [], hints: 0 });
  const c = [...s.messages].reverse().find((m) => m.card?.type === "code")?.card as { file: string; from: number; to: number; code: string } | undefined;
  return c ? { file: c.file, from: c.from, to: c.to, code: c.code } : undefined;
}
const KEYWORDS = new Set(["the", "a"]);
export async function stuckWords(runId: string, n: number) {
  const quote = await stuckQuote(runId, n);
  const words = quote ? [...new Set([...quote.code.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, " ").matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]))].filter((w) => !KEYWORDS.has(w)).slice(0, 14) : [];
  return { quote: quote ? { file: quote.file, from: quote.from, to: quote.to, code: quote.code.slice(0, 300) } : null, words };
}
async function askInner(runId: string, n: number, plan: Plan, q: string, text: string, quote: { file: string; from: number; to: number; code: string } | undefined, shown: string | undefined, opts: AskOpts) {
  void text;
  const frame = (await stuckView(runId)) ? openStack(await stuckOf(runId)).at(-1) : undefined;
  if (frame) opts = { ...opts, mode: undefined };
  if (frame && !opts.silent) await countReply(runId);
  const s0 = await change(runId, n, (s, push) => {
    if (!opts.main) s.asked = true;
    if (!opts.silent) push({ role: "me", text: shown ?? q, card: quote ? { type: "code", ...quote } : undefined });
    s.busy = true;
  });
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const ws = workspaceOf(run, stageOf(course, n).template);
  const b = plan.beats[s0.beat];
  // 임시 학습(설계안 3.3): 돌아갈 걸음을 세션에 쌓고, 질문을 학습 사건으로 남긴다
  const where = quote ? `${quote.file}:${quote.from}${quote.to > quote.from ? `-${quote.to}` : ""}` : undefined;
  if (!opts.silent) void record({ runId, stage: n, beat: s0.beat, type: "question", actor: "user", detail: (shown ?? q).slice(0, 300), evidence: where ? [where] : undefined });
  const dt = frame ? null : await pushDetour(runId, { topic: shown ?? q, reason: quote ? "코드 질문" : "질문", returnBeat: s0.beat, returnLabel: b?.now ?? firstLine(b?.text ?? "") });
  void dt; // 질문이 이어진다는 알림은 뺐다(11/3: 대화가 자연스러워진 뒤 잔소리처럼 보임). 깊이는 세션에만 남는다
  let answer = "";
  // 컨텍스트 관리자(11/3 사용자: "대화 기록 저장과 LLM에 주는 컨텍스트를 분리"). AI가 아니라 코드가 매번 조립한다:
  // 지시문(고정) + [코스]·[이번 단계] + 앞부분(길면 요약, 넘쳤을 때만 만든다) + 최근 대화(지금 걸음은 자르지 않음) + [학습자 상태]·[지금 위치] + 필요한 파일(매번 디스크에서).
  // 기록(화면 메시지 · 학습 사건 · 모델 본문)은 따로 다 남고 지우지 않는다. 모델 대화는 질문마다 새로 연다.
  // 11/3 사용자 "채팅은 다 컨텍스트에 넣어 봐, 세션이랑 별개로": [막혔어요] 칸 안의 말도 코스 대화에 그대로 넣고, 칸 표시만 붙인다
  const lineOf = (m: LMsg) => { const t = lineOf0(m); return t && m.sf ? `[막혔어요 칸] ${t}` : t; };
  const lineOf0 = (m: LMsg) => m.role === "me" ? (m.text ? `학습자: ${m.text}` : "") : m.role === "note" ? (m.text ? `(화면 알림: ${m.text})` : "")
    : m.card?.type === "explain" && m.card.done ? `${m.text ? `튜터: ${m.text}\n\n` : ""}학습자(내 말로): ${m.card.done}`
    : m.text ? `튜터: ${m.text}`
    : m.card?.type === "choice" && m.card.picked !== undefined ? `(학습자가 고른 답: ${m.card.options[m.card.picked]})`
    : m.card?.type === "reply" ? `(직접 보낸 요청: ${m.card.request} → ${m.card.timedOut ? "응답 없음" : `${m.card.status} ${m.card.body.slice(0, 200)}`})`
    : m.card?.type === "check" ? `(자동 확인: ${m.card.result.passed}개 통과, ${m.card.result.failed}개 실패)`
    : m.card?.type === "explain" && m.card.done ? `학습자(내 말로): ${m.card.done}` : "";
  const talk = (ms: LMsg[]) => ms.map(lineOf).filter(Boolean).join("\n\n");
  // 방금 넣은 질문은 빼고, 시작 인사·배경 질문(걸음 -1)도 뺀다(배경은 [학습자 상태]에 있다)
  // [막혔어요] 칸 대화는 코스 대화 맥락에 넣지 않는다(칸이 풀린 한 줄만 들어간다)
  const before = (opts.silent ? s0.messages : s0.messages.slice(0, -1)).filter((m) => (m.beat ?? 0) >= 0);
  const { older, recent } = splitRecent(before, s0.beat);
  const olderPart = await olderContext(runId, n, s0, older, talk);
  const stage = stageOf(course, n);
  const predicts = plan.beats.filter((x) => x.kind === "predict").map((x) => x.text.split("\n")[0].slice(0, 120));
  // 첫 차례 맥락(11/4 사용자 "대화 내역만 고정, 나머지는 다 수정 가능"): 값은 코드가 만들고, 틀은 실험방에서 고친다(lib/prompts.ts)
  const order = courseOrder(course, run, n);
  const V: Record<string, string> = {
    코스이름: course.title, 학습자목표: learnerGoal(course, run) ?? "", 코스순서: order,
    단계번호: String(n), 단계이름: bareTitle(plan.title), 단계목표: stage.goal, 가르칠것: plan.teach.join(" / "), 고칠곳: stage.fix.text, 강사메모: plan.tutorNotes ?? "",
    숨길것: [...predicts.map((t) => `예측 문제("${t}")의 정답`), "고칠 곳의 완성 코드(바꿔 넣을 값 포함)"].join(", "),
  };
  const fixed = run.free ? render(promptOf("freeFixed", DEFAULT_FREE_FIXED), V) : render(promptOf("fixedTpl", DEFAULT_FIXED), V);
  // 작업 상태: 코드가 확실한 사실만(배경 · 레벨 · 막힘 · 고친 파일 · 편집기 오류). 의미 판단은 모델이 답할 때
  const sv = await sessionView(runId).catch(() => null);
  const evs = (await events(runId).catch(() => [])).filter((e) => e.stage === n && e.type === "code_edit");
  const edited = [...new Set(evs.flatMap((e) => (e.evidence ?? []).map((f) => `${f}(${e.actor === "user" ? "학습자" : "튜터"})`)))].slice(-4);
  const vsErr = bridgeState(runId)?.errors?.slice(0, 3).map((e) => `${e.line}줄 ${e.message}`) ?? [];
  const stuck = [
    (s0.failStreak ?? 0) >= 2 ? `확인 ${s0.failStreak}번 연속 실패` : "",
    s0.hints ? `힌트 ${s0.hints}단계까지 봄` : "",
    s0.lastCheck && s0.lastCheck.failed ? `마지막 확인 실패: ${s0.lastCheck.results.filter((r) => !r.ok).map((r) => `${r.title}(기대 ${r.failure?.expected} / 실제 ${r.failure?.actual})`).join("; ").slice(0, 300)}` : "",
    edited.length ? `이번 단계에서 고친 파일: ${edited.join(", ")}` : "",
    vsErr.length ? `편집기 빨간 줄: ${vsErr.join("; ")}` : "",
    // 학습자가 이번 단계에 "내 말로" 쓴 문장(코드가 아는 사실): 대화가 요약돼도 그대로 남게
    ...s0.messages.filter((m) => m.card?.type === "explain" && m.card.done).slice(-1).map((m) => `"내 말로"에 쓴 답: "${(m.card as { done: string }).done.slice(0, 300)}"`),
  ].filter(Boolean).join(" · ");
  // 매 차례 맥락: 줄마다 자리표시로(틀은 실험방에서 고친다). {막혔어요}는 아래에서 채운다
  V.학습자상태 = `[학습자 상태] ${sv ? `${LEVELS[sv.level] ?? LEVELS[0]}(내부, 학습자에게 말하지 않음)` : ""}${sv?.background ? ` · ${backgroundLine(sv.background).replace(/^\[학습자 배경\(스스로 답함\)\]\s*/, "배경: ")}` : ""}${stuck ? ` · ${stuck}` : ""}`;
  V.지금위치 = `[지금 위치] ${n}단계 · 걸음 ${s0.beat + 1}/${plan.beats.length}(${b ? stepLabel(b, s0.beat === plan.beats.length - 1) : "끝"}) ${b ? `— ${b.now ?? firstLine(b.text)}` : ""}${plan.beats[s0.beat + 1] ? ` · 다음: ${stepLabel(plan.beats[s0.beat + 1], s0.beat + 1 === plan.beats.length - 1)}` : ""}`;
  // 11/3 초보 흉내 시험: 튜터가 화면에 없는 "답 쓰는 곳"을 지어내거나 버튼 이름을 틀리게 말했다 → 지금 화면에 있는 것을 그대로 알려 준다
  V.지금화면 = screenLine(s0, b);
  V.개념 = learnerLine(await learnerView(runId, course).catch(() => ({ concepts: [], misconceptions: [], observations: [] })));
  V.기초 = await basicsLine(langOf(course as { language?: string; stack?: string })).catch(() => "");
  V.고른코드 = quote ? `[학습자가 VS Code에서 골라 물은 코드] ${quote.file} ${quote.from}~${quote.to}줄:\n${quote.code}` : "";
  // 실험방에서 사용자가 직접 적은 추가 지시(11/3)
  V.추가지시 = await extraBlock().catch(() => "");
  V.막혔어요 = "";
  const turnTpl = () => (run.free ? promptOf("freeTurn", DEFAULT_FREE_TURN) : promptOf("turnTpl", DEFAULT_TURN));
  const state = render(turnTpl(), V);
  // 튜터가 도구로 다시 읽지 않고 바로 답할 수 있게 지금 보는 파일(설명 때는 그 파일과 가져오는 파일)을 줄 번호와 함께 붙인다
  // 11/4 사용자 A안: 프리스타일은 고른 코드가 없으면 과제 파일을 미리 붙이지 않는다(필요하면 튜터가 read로 본다)
  const files = (run.free && !quote) || (promptOf("files", "on").trim() === "off" && opts.mode !== "tour") ? [] : opts.mode === "tour" ? await allFiles(ws) : await questionFiles(ws, q, quote?.file ?? bridgeState(runId)?.file ?? lastQuoteFile(s0) ?? null, stage.fix.files, opts.mode === "explain");
  const recentText = talk(recent);
  const history = [olderPart, recentText ? `[최근 대화]\n${recentText}` : ""].filter(Boolean).join("\n\n");
  // 이어 쓰는 대화에 덧붙일 것: 지난 질문 답 뒤로 화면에 나온 것만(그 앞은 대화에 이미 있다)
  const sent = sentUpTo.get(lk(runId, n)) ?? -1;
  const sinceText = talk(before.filter((m) => m.id > sent));
  let parts = { fixed, turn: state, recent: history, since: sinceText ? `[지난 질문 뒤 화면]\n${sinceText}` : "", files };
  let context = [fixed, history, state, ...files.map((f) => f.text)].filter(Boolean).join("\n\n");
  const lang = langOf(course as { language?: string; stack?: string });
  // [막혔어요] 칸 안: 칸마다 따로 이어 쓰는 대화. 넘겨줄 것(원래 줄 · 막힌 이유 · 수준 · 지금까지 쓴 말)은 칸의 첫 메시지에
  // [막혔어요](11/3 사용자 "세션을 새로 여는 게 아니라 학습자 상태에 따라 학습 코스가 변한다고 보면"): 대화는 코스 하나로 계속 이어 쓰고,
  // 막힘 칸 스택은 [지금 위치]의 일부다. 칸마다 다른 역할(처음 줄: 짚기 / 아래 칸: 작은 예로 설명)은 이번 차례 맥락 끝에 붙인다
  const sessKey: string | undefined = undefined;
  if (frame) {
    const stack = openStack(await stuckOf(runId));
    const root = stack[0];
    const block = [
      `[지금 위치 — 막혔어요] ${n}단계 걸음 중 막혀서 기초 쪽으로 내려와 있다: ${stack.map(labelOf).join(" › ")} (지금 칸: ${labelOf(frame)}, 깊이 ${frame.depth + 1})`,
      root.quote ? `처음 막힌 코드 ${root.quote.file} ${root.quote.from}${root.quote.to > root.quote.from ? `~${root.quote.to}` : ""}줄: ${root.quote.code.trim()}` : "",
      root.choice ? `학습자가 고른 막힘: ${CHOICES[root.choice].label}${root.word ? ` — 단어 \`${root.word}\`` : ""}` : "",
      frame.why ? `이 칸으로 내려온 이유: ${frame.why}` : "",
      `언어: ${lang}. 기초 칸 목록(id=이름):\n${catalogText(lang)}`,
      frame.depth === 0 && root.quote ? `[지금 칸 규칙 — 처음 막힌 줄]\n${promptOf("stuckRoot", ROOT_RULES)}` : `[지금 칸 규칙 — 아래 칸]\n${promptOf("stuckChild", CHILD_RULES)}`,
    ].filter(Boolean).join("\n");
    V.막혔어요 = block;
    parts = { ...parts, turn: render(turnTpl(), V) };
    context = [fixed, history, parts.turn].filter(Boolean).join("\n\n");
  }
  if (aiMode() !== "off") {
    // 답을 쓰는 대로 채팅에 흘려 보낸다(같은 key는 같은 말풍선을 고친다)
    const bubbles = new Map<string, number>();
    const io = {
        runId, n, ws, context, parts, mode: opts.mode, scope: opts.scope,
        ...(frame ? { sessKey, stuck: { frameId: frame.id, lang } } : {}),
        ...(run.free ? { freeSystem: promptOf("freeSystem", FREE_SYSTEM) } : {}),
        stream: async (key: string, text: string) => {
          await change(runId, n, (s, push) => {
            const id = bubbles.get(key);
            const m = id !== undefined ? s.messages.find((x) => x.id === id) : undefined;
            if (m) m.text = text;
            else { push({ role: "tutor", text }); bubbles.set(key, s.messages.at(-1)!.id); }
          }).catch((e) => console.error("[lesson] 기록 저장 실패", e));
        },
        // 채팅 기록 저장이 실패해도 도구 결과는 그대로 쓴다(저장 실패를 도구 실패로 착각하지 않게)
        show: async (card) => {
          await change(runId, n, (st, push) => {
            push({ role: "tutor", card });
            // 튜터가 이번 단계의 고칠 파일을 고쳤으면 화면 상태도 "튜터가 고침"으로(진도 기록은 recordEdit가 힌트 3단계로 남긴다)
            if (card.type === "diff" && stageOf(course, n).fix.files.includes(card.file)) { st.tutorEdit = true; st.hints = Math.max(st.hints, 3); }
            if (card.type === "diff") void record({ runId, stage: n, beat: st.beat, type: "code_edit", actor: "agent", detail: `튜터가 ${card.file}을(를) 고침`, evidence: [card.file] });
          }).catch((e) => console.error("[lesson] 기록 저장 실패", e));
          // 프로젝트 노트: 투어 걸음은 파일별로, 파일 사이 넘어간 길은 연결로 / 튜터가 고친 것은 그 파일에
          if (card.type === "tour") await addTour(runId, ws, n, card.title, card.steps).catch(() => {});
          if (card.type === "diff") await addEntry(runId, ws, card.file, { stage: n, kind: "edited", title: "튜터가 고침", summary: card.why || "튜터가 코드를 고쳤어요(직접 통과 아님)" }).catch(() => {});
        },
        say: async (text) => { await change(runId, n, (_s, push) => push({ role: "tutor", text })).catch((e) => console.error("[lesson] 기록 저장 실패", e)); },
        quiet: (ms: number) => { quietUntil.set(`${runId}:${n}`, Date.now() + ms); },
        streamed: false,
        think: (t: string | null) => { if (t) thinking.set(lk(runId, n), t); else thinking.delete(lk(runId, n)); notify(runId, "lesson"); },
        choose: async (q: { question: string; options: string[] }) => {
          const id = `q${Date.now().toString(36)}`;
          await change(runId, n, (_s, push) => push({ role: "tutor", card: { type: "ask", id, question: q.question, options: q.options } }));
          return new Promise<string>((resolve) => {
            const finish = (a: string) => { clearTimeout(timer); if (askWaiters.get(lk(runId, n))?.id === id) askWaiters.delete(lk(runId, n)); notify(runId, "lesson"); resolve(a); };
            const timer = setTimeout(() => finish(""), 150_000);
            askWaiters.set(lk(runId, n), { id, finish });
            notify(runId, "lesson");
          });
        },
      };
    try {
      answer = await runAgent(io as Parameters<typeof runAgent>[0], q);
      sentUpTo.set(sessKey ?? lk(runId, n), (await read<State>(file(runId, n), s0)).messages.at(-1)?.id ?? 0);
      await remember(runId, n, ws, s0, { q, shown, quote, mode: opts.mode, answer }).catch((e) => console.error("[notes]", e));
      await revealedSolution(runId, n, answer).catch((e) => console.error("[reveal]", e));
      if (opts.onAnswer) await opts.onAnswer(answer).catch(() => {});
      thinking.delete(lk(runId, n));
      if (io.streamed) return change(runId, n, (s) => { s.busy = false; });
    } catch (e) {
      answer = e instanceof AiUnavailable
        ? `지금은 AI 튜터에게 물어볼 수 없어요 (${e.message}).\n막히면 **힌트 줘**를 눌러 주세요. 준비된 힌트가 나와요.`
        : `답을 만들지 못했어요: ${(e as Error).message}`;
    }
    thinking.delete(lk(runId, n));
    return change(runId, n, (s, push) => { s.busy = false; if (answer) push({ role: "tutor", text: answer }); });
  }
  try {
    const live = bridgeState(runId);
    const files = [...new Set([...stageOf(course, n).fix.files, ...(quote ? [quote.file] : []), ...(live?.file ? [live.file] : [])])].slice(0, 4);
    const code = await Promise.all(files.map(async (f) => {
      const unsaved = live?.file === f && live.dirty && live.text ? live.text : null;
      const text = unsaved ?? (await readFile(path.join(ws, f), "utf8").catch(() => "(없음)"));
      return `[학습자 파일 ${f}${unsaved ? " — VS Code에서 고치는 중, 아직 저장 안 함" : ""}]\n${text.split(/\r?\n/).map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join("\n")}`;
    }));
    const recent = s0.messages.slice(-14).map((m) => m.role === "me" ? `학습자: ${m.text}` : m.text ? `강사: ${m.text}` : m.card?.type === "reply" ? `(요청 결과: ${m.card.request} → ${m.card.timedOut ? "응답 없음" : m.card.status})` : m.card?.type === "check" ? `(확인 결과: ${m.card.result.passed}개 통과, ${m.card.result.failed}개 실패)` : "").filter(Boolean).join("\n");
    const user = [
      `[수업 계획서] ${plan.stage}단계 ${bareTitle(plan.title)}\n가르칠 것: ${plan.teach.join(" / ")}\n강사 메모: ${plan.tutorNotes}`,
      `[지금 하는 순서] ${s0.beat + 1}/${plan.beats.length}: ${b?.text ?? "끝"}`,
    // 실사용 확인(10/30): "로그인은 언제?"에 "나중 단계"라고만 답함 → 코스 전체 순서와 학습자 목표를 준다
    courseOrder(course, run, n),
    learnerGoal(course, run),
    // 실사용 확인(10/30): 막혔다는 말에 뒤에 나올 예측 문제의 답(405)을 먼저 말해 버림 → 앞으로 할 순서를 알리고 미리 말하지 않게
    upcoming(plan, s0.beat),
      ...code,
      bridgeContext(runId),
      quote ? `[학습자가 VS Code에서 골라 물은 코드] ${quote.file} ${quote.from}~${quote.to}줄:\n${quote.code}` : "",
      s0.lastCheck ? `[마지막 확인] ${s0.lastCheck.results.filter((r) => !r.ok).map((r) => `${r.title}: 기대 ${r.failure?.expected} / 실제 ${r.failure?.actual}`).join("; ") || "모두 통과"}` : "",
      `[최근 대화]\n${recent}`,
      `[학습자 질문] ${q}`,
    ].filter(Boolean).join("\n\n");
    answer = await aiText("tutor", TUTOR, user);
  } catch (e) {
    answer = e instanceof AiUnavailable
      ? `지금은 AI 튜터에게 물어볼 수 없어요 (${e.message}).\n막히면 **힌트 줘**를 눌러 주세요. 준비된 힌트가 나와요.`
      : `답을 만들지 못했어요: ${(e as Error).message}`;
  }
  return change(runId, n, (s, push) => { s.busy = false; push({ role: "tutor", text: answer }); });
}

/* ---------- 저장 알아채기 ---------- */
const watchers = new Map<string, { w: FSWatcher; ws: string; timer?: NodeJS.Timeout }>();
function watchFor(runId: string, n: number, ws: string) {
  const key = `${runId}:${n}`;
  const cur = watchers.get(key);
  if (cur && cur.ws === ws) return;
  cur?.w.close();
  try {
    const w = watch(path.join(ws, "src"), { recursive: true }, (_e, name) => {
      if (!name || !String(name).endsWith(".ts")) return;
      const entry = watchers.get(key)!;
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => onSave(runId, n).catch((e) => console.error(e)), 600);
    });
    w.on("error", () => watchers.delete(key));
    watchers.set(key, { w, ws });
  } catch { /* 폴더가 아직 없음: 다음 화면 요청 때 다시 */ }
}
const quietUntil = new Map<string, number>();
async function onSave(runId: string, n: number) {
  if ((quietUntil.get(`${runId}:${n}`) ?? 0) > Date.now()) return;
  const s = await read<State | null>(file(runId, n), null);
  notify(runId, "saved");
  if (!s || s.waiting !== "save" || s.busy) return;
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const plan = await loadPlan(course.id, n);
  if (plan) await runCheck(runId, n, plan, course, "저장");
}
export function closeWatchers() { for (const { w } of watchers.values()) w.close(); watchers.clear(); }

/* ---------- VS Code 쪽으로 ---------- */
async function wsOf(runId: string, n: number) {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  return workspaceOf(run, stageOf(course, n).template);
}
async function openInEditor(runId: string, n: number, o: Open) {
  if (!bridgeConnected(runId)) return false;
  const ws = await wsOf(runId, n);
  const a = await locate(ws, { file: o.file, anchor: o.anchor });
  const b = o.toAnchor ? await locate(ws, { file: o.file, anchor: o.toAnchor }) : null;
  return bridgeSend(runId, { type: "open", file: o.file, line: a?.line ?? 1, toLine: b?.line ?? undefined, note: o.note });
}
/** 화면의 파일 줄 링크: 확장이 있으면 그쪽으로 연다(브라우저의 "VS Code 열기" 확인 창 없이). */
export async function openLine(runId: string, file: string, line: number) {
  if (!/^[\w./-]+$/.test(file) || file.includes("..")) throw err(400, "파일 경로가 이상해요.");
  if (!bridgeSend(runId, { type: "open", file, line })) throw err(409, "VS Code가 연결돼 있지 않아요.");
}
/** 빈칸 뼈대: 계획서에 준비된 것만 넣는다. 확장이 있으면 편집기에서(Ctrl+Z 가능), 없으면 파일에 직접 쓴다. */
async function scaffold(runId: string, n: number, plan: Plan, course: Awaited<ReturnType<typeof loadCourse>>) {
  const s = await read<State>(file(runId, n), { beat: 0, waiting: "action", messages: [], hints: 0 });
  const b = plan.beats[s.beat];
  if (s.waiting !== "save" || !b?.scaffold) throw err(409, "지금은 빈칸을 넣을 때가 아니에요.");
  const how = await insertBlanks(runId, n, b.scaffold);
  void course;
  return change(runId, n, (st, push) => {
    st.scaffolded = true;
    push({ role: "me", text: "빈칸으로 도와줘" });
    push({ role: "tutor", text: `${how}\n\n빈칸마다 번호가 붙어 있어요. 하나씩 채우고 저장하면 제가 확인할게요. 빈칸을 다 채우기 전에는 서버가 켜지지 않을 수 있어요(아직 문장이 덜 끝난 상태라서요).`,
      actions: [{ label: "지금 확인해 줘", do: "check" }, { label: "힌트 줘", do: "hint" }] });
  });
}
async function insertBlanks(runId: string, n: number, sc: Scaffold) {
  const ws = await wsOf(runId, n);
  let how = "";
  if (bridgeSend(runId, { type: "blank", file: sc.file, from: sc.from, to: sc.to, text: sc.text, note: sc.note })) how = "VS Code에 빈칸을 넣었어요. 마음에 안 들면 VS Code에서 Ctrl+Z로 되돌릴 수 있어요.";
  else {
    const abs = path.join(ws, sc.file);
    const raw = await readFile(abs, "utf8");
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const lines = raw.split(/\r?\n/);
    const a = lines.findIndex((l) => l.includes(sc.from));
    const z = sc.to ? lines.findIndex((l, i) => i >= a && l.includes(sc.to!)) : a;
    if (a < 0 || z < 0) throw err(409, "빈칸을 넣을 자리를 찾지 못했어요. 이미 고친 것 같아요.");
    const indent = lines[a].match(/^\s*/)![0];
    lines.splice(a, z - a + 1, ...sc.text.split("\n").map((l) => (l ? indent + l : l)));
    await writeFile(abs, lines.join(eol));
    how = "파일에 빈칸을 넣었어요. VS Code에서 그 파일을 열면 보여요.";
  }
  return how;
}

/** "같이 해요": 준비된 빈칸이 있으면 넣고, 계획서의 조각(pair)을 하나씩 보여 준다. 기록은 "같이 고침"(직접 통과로 치지 않음, 정답 줄을 본 것도 아님). */
async function pairMode(runId: string, n: number, plan: Plan) {
  const s = await read<State>(file(runId, n), { beat: 0, waiting: "action", messages: [], hints: 0 });
  const b = plan.beats[s.beat];
  if (s.waiting !== "save" || b?.kind !== "fix") throw err(409, "지금은 고칠 때가 아니에요.");
  let how = "";
  if (b.scaffold && !s.scaffolded) how = await insertBlanks(runId, n, b.scaffold).catch(() => "");
  await saveRun(runId, (r) => { stageProgress(r, n).hints.push({ level: 2, at: now(), source: "pair" }); });
  return change(runId, n, (st, push) => {
    st.mode = "pair";
    st.pairStep = 0;
    if (how) st.scaffolded = true;
    push({ role: "me", text: "같이 해요" });
    const first = b.pair?.length ? `\n\n작은 조각으로 나눠서 하나씩 할게요. **1/${b.pair.length}** ${b.pair[0]}` : "\n\n한 줄씩 같이 해요. 막히는 줄을 드래그해서 물어보세요.";
    push({ role: "tutor", text: `${how ? `${how}\n\n` : ""}좋아요, 같이 해요.${first}\n\n조각을 쓰고 저장하면 제가 확인해요.`.trim(), actions: modeActions(b, st) });
  });
}

/** "만들어 주세요": 고칠 파일을 이 단계 정답으로 바꾸고(지금 파일은 .data/backups에 보관), 바뀐 줄을 보여 준 뒤 바로 확인한다. */
/**
 * 작업 지시(설계안 5.3): 목표 · 범위 · 제외 · 검증 · 반환을 정해 튜터에게 구현을 맡긴다.
 * 범위 밖 파일은 권한 훅이 막고(oc-engine · agent), 끝나면 검사기가 판정한다. 기록은 "튜터가 고침".
 */
export function workOrderText(course: Awaited<ReturnType<typeof loadCourse>>, n: number) {
  const st = stageOf(course, n);
  const later = course.stages.filter((x) => x.n > n).map((x) => x.title);
  return [
    "[작업 지시] 학습자가 이번 단계를 맡겼어요. 아래 범위 안에서만 직접 구현하세요.",
    `목표: ${st.fix.text}`,
    `범위: ${st.fix.files.join(", ")} 만 고친다. 다른 파일은 읽기만.`,
    `제외: ${later.length ? `다음 단계(${later.join(" / ")})의 기능은 만들지 않는다.` : "이번 목표 밖의 기능은 만들지 않는다."} 설치·명령 실행은 하지 않는다.`,
    "검증: 고친 뒤 run_checks로 이번 단계 검사를 돌린다. 실패하면 한 번 더 고치고, 그래도 실패하면 솔직히 말한다.",
    "반환: 바뀐 줄을 짧게 보여 주고, 학습자가 이해해야 할 핵심 한두 가지를 쉬운 말로. 직접 쓴 게 아니라 이번 단계는 '튜터가 고침'으로 남는다는 것도 한 줄.",
  ].join("\n");
}
async function workOrder(runId: string, n: number, plan: Plan, course: Awaited<ReturnType<typeof loadCourse>>) {
  const s = await read<State>(file(runId, n), { beat: 0, waiting: "action", messages: [], hints: 0 });
  const b = plan.beats[s.beat];
  if (s.waiting !== "save" || b?.kind !== "fix" || s.busy) throw err(409, "지금은 고칠 때가 아니에요.");
  await change(runId, n, (st) => { st.mode = "auto"; st.tutorEdit = true; });
  void record({ runId, stage: n, beat: s.beat, type: "code_edit", actor: "agent", detail: "만들어 주세요: 튜터에게 작업 지시", evidence: stageOf(course, n).fix.files });
  await ask(runId, n, plan, workOrderText(course, n), undefined, "만들어 주세요", { scope: stageOf(course, n).fix.files });
  // 튜터가 검사를 안 돌렸거나 통과 처리가 안 됐으면 여기서 확인한다
  const after = await read<State>(file(runId, n), { beat: 0, waiting: "action", messages: [], hints: 0 });
  if (after.waiting === "save") return runCheck(runId, n, plan, course, "튜터");
  return after;
}

async function autoFix(runId: string, n: number, plan: Plan, course: Awaited<ReturnType<typeof loadCourse>>) {
  const s = await read<State>(file(runId, n), { beat: 0, waiting: "action", messages: [], hints: 0 });
  const b = plan.beats[s.beat];
  if (s.waiting !== "save" || b?.kind !== "fix" || s.busy) throw err(409, "지금은 고칠 때가 아니에요.");
  void record({ runId, stage: n, beat: s.beat, type: "code_edit", actor: "agent", detail: "만들어 주세요: 준비된 정답으로 바꿈", evidence: stageOf(course, n).fix.files });
  const st = stageOf(course, n);
  const bs = bridgeState(runId);
  if (bs?.dirty && st.fix.files.some((f) => bs.file === f)) throw err(409, "VS Code에 저장하지 않은 내용이 있어요. 먼저 저장하거나 되돌린 뒤 눌러 주세요.");
  const ws = await wsOf(runId, n);
  const solved = await stageFiles(course, n, { solved: true });
  const keep = path.join(DATA, "backups", `${runId}-${n}-${Date.now()}`);
  quietUntil.set(`${runId}:${n}`, Date.now() + 2500); // 우리가 쓴 저장에 다시 반응하지 않게
  for (const f of st.fix.files) {
    const text = solved.get(f);
    if (text === undefined) continue;
    const abs = path.join(ws, f);
    const before = await readFile(abs, "utf8").catch(() => null);
    if (before !== null) { await mkdir(path.dirname(path.join(keep, f)), { recursive: true }); await writeFile(path.join(keep, f), before); }
    await writeFile(abs, before?.includes("\r\n") ? text.replace(/\r?\n/g, "\r\n") : text);
  }
  await saveRun(runId, (r) => { stageProgress(r, n).hints.push({ level: 3, at: now(), source: "auto" }); });
  const diff = (await solutionDiff(course, n)).map((d) => `▸ ${d.file}\n${d.diff}`).join("\n\n");
  if (b.open) await openInEditor(runId, n, b.open).catch(() => {});
  await change(runId, n, (x, push) => {
    x.mode = "auto";
    push({ role: "me", text: "만들어 주세요" });
    push({ role: "tutor", text: `제가 고쳤어요. 바뀐 줄은 아래와 같아요(+ 넣은 줄, - 뺀 줄). 원래 파일은 따로 보관해 뒀어요.`, card: { type: "hint", level: 3, text: diff, source: "auto" } });
  });
  return runCheck(runId, n, plan, course, "튜터");
}

/** 지금 순서에서 마지막으로 놓았던 버튼(자유 질문으로 밀려 올라간 것) */
function lastBeatActions(s: State) { return [...s.messages].reverse().find((m) => m.role === "tutor" && m.actions?.length)?.actions; }

/* ---------- 물음표 주머니: "이건 뭐예요?" ---------- */
export async function what(runId: string, n: number, plan: Plan, quote: { file: string; from: number; to: number; code: string }) {
  const run = await getRun(runId);
  const out = await explainWhat(runId, run.courseId, n, quote);
  if (out.text) {
    const names = (out.item?.terms ?? []).map((t: { name: string }) => t.name.replace(/^\/\/ /, ""));
    await addEntry(runId, await wsOf(runId, n), quote.file, { stage: n, kind: "what", from: quote.from, to: quote.to, title: names.join(", ") || quote.code.trim().slice(0, 30), summary: firstLine(out.text), terms: names.length ? names : [quote.code.trim().slice(0, 30)] }).catch(() => {});
    return change(runId, n, (s2, push) => {
      s2.asked = true;
      void record({ runId, stage: n, beat: s2.beat, type: "question", actor: "user", detail: `이건 뭐예요? ${quote.code.trim().slice(0, 80)}`, evidence: [`${quote.file}:${quote.from}`] });
      void pushDetour(runId, { topic: quote.code.trim().slice(0, 60), reason: "이건 뭐예요", returnBeat: s2.beat, returnLabel: "" });
      push({ role: "me", text: "이건 뭐예요?", card: { type: "code", ...quote } });
      push({ role: "tutor", text: out.text! + (out.item?.later.length ? "" : "\n\n그럼 하던 것으로 돌아가 볼게요.") });
    });
  }
  // 용어집에 없으면 AI 튜터에게
  await rememberAi(runId, n, quote);
  return ask(runId, n, plan, "이건 뭐예요? 처음 보는 사람에게 이 코드가 하는 일을 쉽게 알려 주세요. 이 단계에서 몰라도 되는 거면 그렇다고 말해 주세요.", quote, "이건 뭐예요?");
}

/* ---------- 덩어리 설명 (VS Code의 [💬 설명] / 드래그 + 우클릭) ----------
 * 학습자가 코드를 복사해 ChatGPT에 "이거 뭐야" 하던 것을 한 번 클릭으로. 확인 질문은 하지 않는다(사용자 10/30).
 * 같은 코스·같은 코드면 한 번 만든 설명을 저장해 두고 바로 보여 준다(AI 호출 없음). */
const BLOCK_Q = `이 코드 덩어리를 문법을 모르는 사람에게 설명해 주세요. ChatGPT에 코드를 붙여 넣고 물었을 때처럼, 마크다운으로 보기 좋게. 파일은 위에 붙어 있으니 도구 없이 바로 답한다. 해요체. 모양:

첫 문단: 이 덩어리가 하는 일을 일상 비유로 한두 문장(제목 없이).

### 하나씩 보기
덩어리를 뜻이 이어지는 3~6조각으로 나눈다. 조각마다:
#### ① 조각 이름 (몇~몇 줄)
\`\`\`ts 파일경로:시작줄
(그 조각의 코드를 파일 그대로, 주석은 빼도 됨)
\`\`\`
- 줄마다 또는 표현마다 "\`조각\` — 우리말 뜻"을 1~4개 목록으로.

### 여기 나온 문법
- "\`기호\` — 쉬운 말" 2~5개.

### 이어지는 곳
- 다른 파일과 이어지면 [[파일:줄]]로 한두 줄(없으면 이 칸은 뺀다).

코드를 고치거나 정답을 알려 주지 않는다. 확인 질문, "배운 점" 같은 마무리는 쓰지 않는다. 앞으로 할 예측 문제의 답은 말하지 않는다.`;
const cacheFile = (courseId: string, code: string) => path.join(DATA, "explain-cache", "v3", courseId, `${createHash("sha1").update(code.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16)}.json`);
export async function explainBlock(runId: string, n: number, plan: Plan, quote: { file: string; from: number; to: number; code: string }) {
  const run = await getRun(runId);
  const cf = cacheFile(run.courseId, `${quote.file}\n${quote.code}`);
  const cached = await read<{ text: string } | null>(cf, null);
  const wsNow = await wsOf(runId, n);
  const note = (text: string) => addEntry(runId, wsNow, quote.file, { stage: n, kind: "block", from: quote.from, to: quote.to, title: `${quote.from}~${quote.to}줄 덩어리`, summary: firstLine(text), terms: codeTerms(text) }).catch(() => {});
  if (cached?.text) {
    await note(cached.text);
    return change(runId, n, (s2, push) => {
      s2.asked = true;
      void record({ runId, stage: n, beat: s2.beat, type: "question", actor: "user", detail: `덩어리 설명 ${quote.file} ${quote.from}~${quote.to}줄`, evidence: [`${quote.file}:${quote.from}-${quote.to}`] });
      void pushDetour(runId, { topic: `${quote.file} ${quote.from}~${quote.to}줄`, reason: "덩어리 설명", returnBeat: s2.beat, returnLabel: "" });
      push({ role: "me", text: "이 덩어리 설명해 주세요", card: { type: "code", ...quote } });
      push({ role: "tutor", text: cached.text });
    });
  }
  return ask(runId, n, plan, BLOCK_Q, quote, "이 덩어리 설명해 주세요", {
    mode: "explain",
    onAnswer: async (text) => {
      if (!text || text.length < 80 || /^답을|^지금은 AI|^생각이 너무/.test(text)) return;
      await note(text);
      await mkdir(path.dirname(cf), { recursive: true });
      await writeFile(cf, JSON.stringify({ at: new Date().toISOString(), file: quote.file, from: quote.from, to: quote.to, text }));
    },
  });
}

/** 확장이 (다시) 연결되면 지금 단계의 지도(밝게·흐리게)를 다시 보낸다. */
export async function refocus(runId: string) {
  const run = await getRun(runId);
  const s = await read<State | null>(file(runId, run.current), null);
  if (s?.focus) bridgeSend(runId, { type: "focus", file: s.focus.file, chunks: s.focus.chunks });
}
