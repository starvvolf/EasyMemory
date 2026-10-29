// 수업: 수업 계획서(lessons/<단계>.json)를 들고 튜터가 대화로 가르친다.
// - 순서·정답·판정은 계획서와 검사기가 정한다. AI는 학습자의 질문에 답하고 빈틈을 메운다(계획을 바꾸지 않는다).
// - VS Code와는 "이어진 것처럼": 파일 줄 링크(vscode://), 저장하면 튜터가 알아채고 바로 확인한다.
import { watch, type FSWatcher } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ServerResponse } from "node:http";
import { COURSES, loadCourse, stageOf } from "./course.ts";
import { locate, type RunResult } from "./checker.ts";
import { check, devStatus, explain, hint, peekDb, predict, startDev, tryRequest, workspaceOf } from "./learn.ts";
import { AiUnavailable, aiText } from "./ai.ts";
import { DATA, getRun, read, update } from "./store.ts";
import { bridgeContext, bridgeState, connected as bridgeConnected, send as bridgeSend } from "./bridge.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { explainWhat, pocketItems, rememberAi, takeDue } from "./pocket.ts";
import { addEntry, addTour, codeTerms, firstLine, notesContext } from "./notes.ts";
import { runAgent, undoEdit, type DiffCard, type ToolCard } from "./agent.ts";
import { aiMode } from "./ai.ts";

type Try = { method: string; path: string; body?: unknown; raw?: string; as?: string };
/** do: next | try | start_dev,try | observe(검사로 지금 상태 보기) | db(DB 들여다보기) | next_stage …  tries: 요청 여러 개를 차례로 */
type Action = { label: string; do: string; try?: Try; tries?: Try[]; sql?: string };
type Open = { file: string; anchor: string; toAnchor?: string; note?: string };
type Scaffold = { file: string; from: string; to?: string; text: string; note?: string };
type Chunk = { anchor: string; label: string; desc?: string; focus?: boolean };
type Focus = { file: string; chunks: Chunk[] };
type Beat = { id: string; kind: "say" | "predict" | "fix" | "explain" | "map"; text: string; actions?: Action[]; after?: Action[]; predict?: string; open?: Open; scaffold?: Scaffold; focus?: Focus; clearFocus?: boolean };
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
  | ToolCard | DiffCard;
export type LMsg = { id: number; at: string; role: "tutor" | "me" | "note"; text?: string; card?: Card; actions?: Action[] };
type State = { beat: number; waiting: "action" | "choice" | "save" | "explain" | "done"; messages: LMsg[]; hints: number; lastCheck?: RunResult; busy?: boolean; todo?: Todo[]; scaffolded?: boolean; focus?: Focus | null };
type Todo = { open?: Open; focus?: Focus; clear?: boolean };

const now = () => new Date().toISOString();
const file = (runId: string, n: number) => path.join(DATA, "lessons", `${runId}-${n}.json`);
const err = (status: number, message: string) => Object.assign(new Error(message), { status });

export async function loadPlan(courseId: string, n: number): Promise<Plan | null> {
  try { return JSON.parse(await readFile(path.join(COURSES, courseId, "lessons", `${n}.json`), "utf8")); } catch { return null; }
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
  const push = (m: Omit<LMsg, "id" | "at">) => s.messages.push({ id: (s.messages.at(-1)?.id ?? 0) + 1, at: now(), ...m });
  await fn(s, push);
  const todo = s.todo ?? [];
  s.todo = [];
  await update<State>(file(runId, n), s, () => { out = s; return s; });
  notify(runId, "lesson");
  for (const t of todo) {
    if (t.open) await openInEditor(runId, n, t.open).catch(() => {});
    if (t.focus) bridgeSend(runId, { type: "focus", file: t.focus.file, chunks: t.focus.chunks });
    if (t.clear) bridgeSend(runId, { type: "clearFocus" });
  }
  return out;
}

function enter(plan: Plan, s: State, idx: number, push: (m: Omit<LMsg, "id" | "at">) => void, course: Awaited<ReturnType<typeof loadCourse>>) {
  s.beat = idx;
  const b = plan.beats[idx];
  if (!b) { s.waiting = "done"; return; }
  if (b.focus) { s.focus = b.focus; (s.todo ??= []).push({ focus: b.focus }); }
  if (b.clearFocus) { s.focus = null; (s.todo ??= []).push({ clear: true }); }
  if (b.open) (s.todo ??= []).push({ open: b.open });
  if (b.kind === "map") {
    push({ role: "tutor", text: b.text, card: { type: "map", file: b.focus!.file, chunks: b.focus!.chunks }, actions: b.actions ?? [{ label: "다음", do: "next" }] });
    s.waiting = "action";
  } else if (b.kind === "say") {
    push({ role: "tutor", text: b.text, actions: b.actions ?? [{ label: "다음", do: "next" }] });
    s.waiting = "action";
  } else if (b.kind === "predict") {
    const p = stageOf(course, plan.stage).predict.find((x) => x.id === b.predict)!;
    push({ role: "tutor", text: b.text, card: { type: "choice", pid: p.id, options: p.options } });
    s.waiting = "choice";
  } else if (b.kind === "fix") {
    push({ role: "tutor", text: b.text, actions: [...(b.scaffold ? [{ label: "빈칸으로 도와줘", do: "scaffold" }] : []), { label: "지금 확인해 줘", do: "check" }, { label: "힌트 줘", do: "hint" }] });
    s.waiting = "save";
  } else if (b.kind === "explain") {
    push({ role: "tutor", text: b.text, card: { type: "explain" } });
    s.waiting = "explain";
  }
}

/* ---------- 화면에 보낼 수업 ---------- */
export async function lessonView(runId: string, n: number) {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const plan = await loadPlan(course.id, n);
  if (!plan) return null;
  let s = await read<State | null>(file(runId, n), null);
  if (!s) {
    const due = await takeDue(runId, n);
    const first = n === run.plan.start;
    s = await change(runId, n, (st, push) => {
      if (first) push({ role: "tutor", text: "반가워요! 저는 이 코스를 같이 할 튜터예요. 먼저 쓰는 법 세 가지만 알려 드릴게요.\n\n- **왼쪽은 코드, 오른쪽(여기)은 저예요.** 제가 설명하면서 왼쪽에 필요한 줄을 열어 드려요.\n- **모르는 코드**는 드래그한 뒤 **우클릭 → \"이건 뭐예요?\"**를 누르세요. 바로 알려 드려요.\n- **궁금한 건** 아래 칸에 그냥 적으세요. 제가 직접 코드를 열어 보고, 돌려 보고 알려 드려요.\n\n코드를 고친 뒤에는 **Ctrl+S**(저장)를 누르면 제가 바로 확인해요. 그럼 시작해 볼게요." });
      if (due.length) push({ role: "tutor", text: `시작하기 전에, 주머니에 넣어 뒀던 것부터 꺼낼게요. 전에 물어본 ${[...new Set(due.flatMap((d) => d.terms.filter((t) => t.stage === n).map((t) => `**${t.name}**`)))].join(", ")}이(가) 이번 단계에서 나와요. 나올 때 자세히 짚어 드릴게요.` });
      enter(plan, st, 0, push, course);
    });
  }
  const ws = workspaceOf(run, stageOf(course, n).template);
  watchFor(runId, n, ws);
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
  return { stage: n, title: plan.title, teach: plan.teach, beat: s.beat, beats: plan.beats.length, waiting: s.waiting, busy: !!s.busy, messages, workspace: ws, dev: devStatus(runId), bridge, pocket };
}

/* ---------- 학습자가 한 것 ---------- */
export async function act(runId: string, n: number, input: { do: string; choice?: number; text?: string; level?: number; file?: string; line?: number }) {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const plan = await loadPlan(course.id, n);
  if (!plan) throw err(404, "이 단계의 수업 계획서가 없어요.");

  if (input.do === "ask") {
    const t = String(input.text ?? "");
    const mode = input.mode === "explain" ? "explain" : input.mode === "tour" || TOUR_INTENT.test(t) ? "tour" : undefined;
    return ask(runId, n, plan, mode === "tour" ? `${t}\n\n${TOUR_Q}` : t, undefined, typeof input.shown === "string" ? input.shown.slice(0, 200) : mode === "tour" ? t : undefined, mode ? { mode } : {});
  }
  if (input.do === "open") { await openLine(runId, String(input.file ?? ""), Number(input.line) || 1); return null; }
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
  if (input.do === "hint") return giveHint(runId, n, input.level);

  return change(runId, n, async (s, push) => {
    const b = plan.beats[s.beat];
    const lastActions = [...s.messages].reverse().find((m) => m.actions)?.actions ?? [];
    if (["next", "start_dev,try", "try", "next_stage", "observe", "db"].includes(input.do) && s.waiting !== "action") throw err(409, "지금 하던 것을 먼저 마쳐 주세요.");
    if (input.do === "next") {
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
      card.picked = Number(input.choice); card.answer = out.answer;
      push({ role: "me", text: card.options[card.picked] });
      push({ role: "tutor", text: `${out.correct ? "맞아요! " : `아쉬워요. 답은 **${card.options[out.answer]}** 예요. `}${out.why}`, actions: b.after ?? [{ label: "다음", do: "next" }] });
      s.waiting = "action";
    } else if (input.do === "explain") {
      if (s.waiting !== "explain") throw err(409, "지금은 설명을 적을 때가 아니에요.");
      const text = String(input.text ?? "").trim();
      await explain(runId, n, text);
      const card = [...s.messages].reverse().find((m) => m.card?.type === "explain")!.card as Extract<Card, { type: "explain" }>;
      card.done = text;
      push({ role: "tutor", text: "고마워요. 그대로 적어 둘게요. 복습할 때 오늘 쓴 이 문장을 다시 보여 드릴게요." });
      enter(plan, s, s.beat + 1, push, course);
    } else if (input.do === "next_stage") {
      s.waiting = "done";
    } else throw err(400, "모르는 동작이에요.");
  });
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
  await change(runId, n, (s, push) => { s.busy = true; if (why === "저장") push({ role: "note", text: "저장한 걸 봤어요. 바로 확인해 볼게요…" }); else push({ role: "me", text: "지금 확인해 줘" }); });
  let result: Awaited<ReturnType<typeof check>> | null = null;
  let failed = "";
  try { result = await check(runId, n, "check"); } catch (e) { failed = (e as Error).message; }
  return change(runId, n, (s, push) => {
    s.busy = false;
    if (!result) { push({ role: "tutor", text: `확인하지 못했어요: ${failed}` }); return; }
    s.lastCheck = result;
    push({ role: "tutor", card: { type: "check", result } });
    if (result.stageOk) {
      for (const f of stageOf(course, n).fix.files) void addEntry(runId, wsDir, f, { stage: n, kind: "fixed", title: s.hints >= 3 ? "정답 줄 보고 고침" : "직접 고침", summary: `${plan.title}: ${stageOf(course, n).fix.text}`.slice(0, 120) }).catch(() => {});
      push({ role: "tutor", text: s.hints >= 3 ? "통과했어요. 정답 줄을 보고 고친 거라, 이 부분은 다음 복습에서 코드 없이 한 번 더 확인할게요." : `**통과!** 직접 고쳐서 모든 확인을 통과했어요. ${plan.passText ?? ""}`.trim() });
      if (s.waiting === "save") enter(plan, s, s.beat + 1, push, course);
    } else {
      const bad = result.results.filter((r) => !r.ok);
      const first = bad[0];
      const where = first?.where ? ` [[${first.where.file}:${first.where.line ?? 1}]]` : "";
      push({ role: "tutor", text: !result.started
        ? (left.size ? `아직 빈칸 ${[...left].join("")}이(가) 남아 있어서 서버가 켜지지 않아요. 빈칸을 모두 채우고 저장해 주세요. 하나씩 막히면 그 줄을 드래그해서 물어보세요.` : "서버가 아예 켜지지 않았어요. 고치다가 문법이 깨진 것 같아요. 위 카드의 오류 위치를 열어 보세요.")
        : `아직 ${bad.length}개가 기대와 달라요. 먼저 "${first.title}"을 보세요. 기대는 **${first.failure?.expected}** 인데 실제는 **${first.failure?.actual}** 이에요.${where}\n\n다시 고치고 저장하면 또 확인할게요. 막히면 물어보거나 힌트를 눌러 주세요.`,
        actions: [{ label: "힌트 줘", do: "hint" }] });
    }
  });
}

async function giveHint(runId: string, n: number, level?: number) {
  const s = await read<State>(file(runId, n), { beat: 0, waiting: "action", messages: [], hints: 0 });
  const next = Math.min(3, level ?? s.hints + 1) as 1 | 2 | 3;
  const r = await hint(runId, n, next, s.lastCheck);
  return change(runId, n, (st, push) => {
    st.hints = Math.max(st.hints, next);
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
- 걸음마다 file, from, to(5~20줄), anchor(그 덩어리 첫 줄 코드 일부를 파일 그대로), title(짧은 이름, 예: "편지 도착"), text(해요체 2~4문장 마크다운: 여기서 무슨 일이 일어나는지 + 다음에 어느 파일·덩어리로 넘어가는지. 수업의 "편지와 답장" 비유를 잇는다).
- 파일들은 위에 붙어 있으니 다시 읽지 않는다. 아직 없는 파일(뒤 단계)은 넣지 않는다. 앞으로 할 예측 문제의 답은 말하지 않는다.
- 도구를 부른 뒤에는 한두 문장으로만 마무리한다.`;
/** 투어용: 작업 폴더의 코드 파일 전부(작은 프로젝트라 한 번에 붙인다) */
async function allFiles(ws: string) {
  const out: string[] = [];
  let total = 0;
  async function walk(dir: string, rel: string) {
    for (const e of await readdir(path.join(ws, dir), { withFileTypes: true }).catch(() => [])) {
      if ([".recaller", "node_modules", "data", ".git", "public"].includes(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else if (/\.(ts|js|mjs)$/.test(e.name) && total < 1500) {
        const t = await readFile(path.join(ws, dir, e.name), "utf8").catch(() => "");
        const lines = t.split(/\r?\n/); total += lines.length;
        out.push(`[파일 ${r}]\n${lines.map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join("\n")}`);
      }
    }
  }
  await walk("", "");
  return out.join("\n\n");
}

/** 질문·답을 프로젝트 노트에: 어느 파일에 대한 것인지 정해서 그 파일 밑에 */
async function remember(runId: string, n: number, ws: string, s0: State, x: { q: string; shown?: string; quote?: { file: string; from: number; to: number }; mode?: string; answer: string }) {
  if (!x.answer || /^(답을|지금은 AI|생각이 너무)/.test(x.answer) || x.mode === "tour") return; // 투어는 카드에서 따로
  const word = /^"(.+)"는 뭐예요\?$/.exec(x.shown ?? "")?.[1];
  const target = x.quote?.file ?? lastQuoteFile(s0) ?? bridgeState(runId)?.file ?? null;
  if (!target) return;
  if (x.mode === "explain" && x.quote) return; // 덩어리 설명은 explainBlock에서
  await addEntry(runId, ws, target, word
    ? { stage: n, kind: "word", title: word, summary: firstLine(x.answer), terms: [word] }
    : { stage: n, kind: "asked", from: x.quote?.from, to: x.quote?.to, title: (x.shown ?? x.q).replace(/\s+/g, " ").slice(0, 50), summary: firstLine(x.answer), terms: codeTerms(x.answer).slice(0, 8) });
}

/** 최근에 물어본 코드의 파일(설명 속 단어를 눌러 이어 물을 때 같은 파일을 붙이려고) */
function lastQuoteFile(s: State) { return [...s.messages].reverse().find((m) => m.card?.type === "code")?.card?.file as string | undefined; }
/** 파일 내용을 줄 번호와 함께. withImports면 그 파일이 가져오는 이 프로젝트 파일(./x.ts)도 */
async function filesFor(ws: string, file: string | null, withImports: boolean) {
  if (!file || file.includes("..")) return "";
  const num = (t: string, max: number) => t.split(/\r?\n/).slice(0, max).map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join("\n");
  const main = await readFile(path.join(ws, file), "utf8").catch(() => null);
  if (main === null) return "";
  const out = [`[파일 ${file} — 이미 붙여 두었으니 다시 읽지 않아도 된다]\n${num(main, 300)}`];
  if (withImports) {
    const dir = path.posix.dirname(file);
    const deps = [...main.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)].map((m) => path.posix.normalize(path.posix.join(dir, m[1]))).slice(0, 4);
    for (const d of deps) {
      const t = await readFile(path.join(ws, d), "utf8").catch(() => null);
      if (t !== null) out.push(`[이 파일이 가져오는 ${d}]\n${num(t, 150)}`);
    }
  }
  return out.join("\n\n");
}

/** 아직 안 한 순서: 튜터가 학습자가 직접 맞히거나 고칠 것을 미리 말하지 않게 */
function upcoming(plan: Plan, beat: number) {
  const rest = plan.beats.slice(beat + 1).filter((x) => x.kind === "predict" || x.kind === "fix");
  if (!rest.length) return "";
  const lines = rest.map((x) => x.kind === "predict" ? `- 예측 문제: ${x.text.split("\n")[0].slice(0, 120)}` : `- 학습자가 직접 고치는 차례: ${x.text.split("\n")[0].slice(0, 120)}`);
  return `[앞으로 할 순서 — 학습자가 직접 맞히고 고칠 것이라 답을 미리 말하지 않는다]\n${lines.join("\n")}\n이것과 관련된 질문에는 어디를 보면 되는지까지만 말하고, 상태 코드 숫자나 고칠 코드는 "곧 같이 해 볼 거예요"라며 미룬다.`;
}

export async function ask(runId: string, n: number, plan: Plan, text: string, quote?: { file: string; from: number; to: number; code: string }, shown?: string, opts: { mode?: "explain" | "tour"; onAnswer?: (text: string) => Promise<void> } = {}) {
  const q = text.trim().slice(0, 1000) || (quote ? "이 코드가 뭐 하는 거예요?" : "");
  if (!q) throw err(400, "질문을 적어 주세요.");
  const s0 = await change(runId, n, (s, push) => {
    push({ role: "me", text: shown ?? q, card: quote ? { type: "code", ...quote } : undefined });
    s.busy = true;
  });
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const ws = workspaceOf(run, stageOf(course, n).template);
  const b = plan.beats[s0.beat];
  let answer = "";
  // 수업 맥락(계획서·지금 순서·최근 대화·마지막 확인): 에이전트와 단순 답 모두 쓴다
  // 최근 대화는 짧게(긴 설명을 통째로 다시 보내면 매번 수천 토큰) — 10/30 사용자 "컨텍스트 조정"
  const clip = (t: string, k = 300) => (t.length > k ? `${t.slice(0, k)}…` : t);
  const recentText = s0.messages.slice(-8).map((m) => m.role === "me" ? `학습자: ${clip(m.text ?? "", 200)}` : m.text ? `강사: ${clip(m.text)}` : m.card?.type === "reply" ? `(요청 결과: ${m.card.request} → ${m.card.timedOut ? "응답 없음" : m.card.status})` : m.card?.type === "check" ? `(확인 결과: ${m.card.result.passed}개 통과, ${m.card.result.failed}개 실패)` : m.card?.type === "tool" ? `(튜터가 ${m.card.label})` : "").filter(Boolean).join("\n");
  const context = [
    `[수업 계획서] ${plan.stage}단계 ${plan.title}\n가르칠 것: ${plan.teach.join(" / ")}\n강사 메모: ${plan.tutorNotes}\n고칠 곳(학습자가 직접 쓸 핵심): ${stageOf(course, n).fix.text}`,
    `[지금 하는 순서] ${s0.beat + 1}/${plan.beats.length}: ${b?.text ?? "끝"}`,
    // 실사용 확인(10/30): "로그인은 언제?"에 "나중 단계"라고만 답함 → 코스 전체 순서와 학습자 목표를 준다
    `[코스 전체 순서] ${course.stages.map((x) => `${x.transfer ? "전이 과제" : `${x.n}단계`} ${x.title}${x.n === n ? "(지금)" : run.plan.stages.includes(x.n) || x.transfer ? "" : "(건너뜀)"}`).join(" / ")}`,
    (run.profile as { goal?: string } | undefined)?.goal ? `[학습자 목표] ${(run.profile as { goal?: string }).goal}` : "",
    // 실사용 확인(10/30): 막혔다는 말에 뒤에 나올 예측 문제의 답(405)을 먼저 말해 버림 → 앞으로 할 순서를 알리고 미리 말하지 않게
    upcoming(plan, s0.beat),
    s0.lastCheck ? `[마지막 확인] ${s0.lastCheck.results.filter((r) => !r.ok).map((r) => `${r.title}: 기대 ${r.failure?.expected} / 실제 ${r.failure?.actual}`).join("; ") || "모두 통과"}` : "",
    quote ? `[학습자가 VS Code에서 골라 물은 코드] ${quote.file} ${quote.from}~${quote.to}줄:\n${quote.code}` : "",
    `[최근 대화]\n${recentText}`,
    // 학습자 기억(프로젝트 노트): 이 프로젝트에서 이미 본 것
    await notesContext(runId, quote?.file ?? bridgeState(runId)?.file ?? lastQuoteFile(s0) ?? null).catch(() => ""),
    // 튜터가 도구로 다시 읽지 않고 바로 답할 수 있게 지금 보는 파일(설명 때는 그 파일과 가져오는 파일)을 줄 번호와 함께 붙인다
    opts.mode === "tour" ? await allFiles(ws) : await filesFor(ws, quote?.file ?? bridgeState(runId)?.file ?? lastQuoteFile(s0) ?? null, opts.mode === "explain"),
  ].filter(Boolean).join("\n\n");
  if (aiMode() !== "off") {
    // 답을 쓰는 대로 채팅에 흘려 보낸다(같은 key는 같은 말풍선을 고친다)
    const bubbles = new Map<string, number>();
    const io = {
        runId, n, ws, context, mode: opts.mode,
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
          await change(runId, n, (_s, push) => push({ role: "tutor", card })).catch((e) => console.error("[lesson] 기록 저장 실패", e));
          // 프로젝트 노트: 투어 걸음은 파일별로, 파일 사이 넘어간 길은 연결로 / 튜터가 고친 것은 그 파일에
          if (card.type === "tour") await addTour(runId, ws, n, card.title, card.steps).catch(() => {});
          if (card.type === "diff") await addEntry(runId, ws, card.file, { stage: n, kind: "edited", title: "튜터가 고침", summary: card.why || "튜터가 코드를 고쳤어요(직접 통과 아님)" }).catch(() => {});
        },
        say: async (text) => { await change(runId, n, (_s, push) => push({ role: "tutor", text })).catch((e) => console.error("[lesson] 기록 저장 실패", e)); },
        quiet: (ms: number) => { quietUntil.set(`${runId}:${n}`, Date.now() + ms); },
        streamed: false,
      };
    try {
      answer = await runAgent(io as Parameters<typeof runAgent>[0], q);
      await remember(runId, n, ws, s0, { q, shown, quote, mode: opts.mode, answer }).catch((e) => console.error("[notes]", e));
      if (opts.onAnswer) await opts.onAnswer(answer).catch(() => {});
      if (io.streamed) return change(runId, n, (s) => { s.busy = false; });
    } catch (e) {
      answer = e instanceof AiUnavailable
        ? `지금은 AI 튜터에게 물어볼 수 없어요 (${e.message}).\n막히면 **힌트 줘**를 눌러 주세요. 준비된 힌트가 나와요.`
        : `답을 만들지 못했어요: ${(e as Error).message}`;
    }
    return change(runId, n, (s, push) => { s.busy = false; push({ role: "tutor", text: answer }); });
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
      `[수업 계획서] ${plan.stage}단계 ${plan.title}\n가르칠 것: ${plan.teach.join(" / ")}\n강사 메모: ${plan.tutorNotes}`,
      `[지금 하는 순서] ${s0.beat + 1}/${plan.beats.length}: ${b?.text ?? "끝"}`,
    // 실사용 확인(10/30): "로그인은 언제?"에 "나중 단계"라고만 답함 → 코스 전체 순서와 학습자 목표를 준다
    `[코스 전체 순서] ${course.stages.map((x) => `${x.transfer ? "전이 과제" : `${x.n}단계`} ${x.title}${x.n === n ? "(지금)" : run.plan.stages.includes(x.n) || x.transfer ? "" : "(건너뜀)"}`).join(" / ")}`,
    (run.profile as { goal?: string } | undefined)?.goal ? `[학습자 목표] ${(run.profile as { goal?: string }).goal}` : "",
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
  const sc = b.scaffold;
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
  void course;
  return change(runId, n, (st, push) => {
    st.scaffolded = true;
    push({ role: "me", text: "빈칸으로 도와줘" });
    push({ role: "tutor", text: `${how}\n\n빈칸마다 번호가 붙어 있어요. 하나씩 채우고 저장하면 제가 확인할게요. 빈칸을 다 채우기 전에는 서버가 켜지지 않을 수 있어요(아직 문장이 덜 끝난 상태라서요).`,
      actions: [{ label: "지금 확인해 줘", do: "check" }, { label: "힌트 줘", do: "hint" }] });
  });
}

/* ---------- 물음표 주머니: "이건 뭐예요?" ---------- */
export async function what(runId: string, n: number, plan: Plan, quote: { file: string; from: number; to: number; code: string }) {
  const run = await getRun(runId);
  const out = await explainWhat(runId, run.courseId, n, quote);
  if (out.text) {
    const names = (out.item?.terms ?? []).map((t: { name: string }) => t.name.replace(/^\/\/ /, ""));
    await addEntry(runId, await wsOf(runId, n), quote.file, { stage: n, kind: "what", from: quote.from, to: quote.to, title: names.join(", ") || quote.code.trim().slice(0, 30), summary: firstLine(out.text), terms: names.length ? names : [quote.code.trim().slice(0, 30)] }).catch(() => {});
    return change(runId, n, (_s, push) => {
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
    return change(runId, n, (_s, push) => {
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
