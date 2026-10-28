// 수업: 수업 계획서(lessons/<단계>.json)를 들고 튜터가 대화로 가르친다.
// - 순서·정답·판정은 계획서와 검사기가 정한다. AI는 학습자의 질문에 답하고 빈틈을 메운다(계획을 바꾸지 않는다).
// - VS Code와는 "이어진 것처럼": 파일 줄 링크(vscode://), 저장하면 튜터가 알아채고 바로 확인한다.
import { watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ServerResponse } from "node:http";
import { COURSES, loadCourse, stageOf } from "./course.ts";
import { locate, type RunResult } from "./checker.ts";
import { check, devStatus, explain, hint, predict, startDev, tryRequest, workspaceOf } from "./learn.ts";
import { AiUnavailable, aiText } from "./ai.ts";
import { DATA, getRun, read, update } from "./store.ts";
import { bridgeContext, bridgeState, connected as bridgeConnected, send as bridgeSend } from "./bridge.ts";
import { writeFile } from "node:fs/promises";

type Action = { label: string; do: string; try?: { method: string; path: string; body?: unknown; as?: string } };
type Open = { file: string; anchor: string; toAnchor?: string; note?: string };
type Scaffold = { file: string; from: string; to?: string; text: string; note?: string };
type Beat = { id: string; kind: "say" | "predict" | "fix" | "explain"; text: string; actions?: Action[]; after?: Action[]; predict?: string; open?: Open; scaffold?: Scaffold };
export type Plan = { stage: number; title: string; teach: string[]; tutorNotes: string; beats: Beat[] };

type Card =
  | { type: "choice"; pid: string; options: string[]; picked?: number; answer?: number }
  | { type: "reply"; request: string; status: number; timedOut: boolean; error?: string; headers: Record<string, string>; body: string }
  | { type: "check"; result: RunResult }
  | { type: "hint"; level: number; text: string; source: string }
  | { type: "explain"; done?: string }
  | { type: "code"; file: string; from: number; to: number; code: string };
export type LMsg = { id: number; at: string; role: "tutor" | "me" | "note"; text?: string; card?: Card; actions?: Action[] };
type State = { beat: number; waiting: "action" | "choice" | "save" | "explain" | "done"; messages: LMsg[]; hints: number; lastCheck?: RunResult; busy?: boolean; todo?: Open[]; scaffolded?: boolean };

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
async function change(runId: string, n: number, fn: (s: State, push: (m: Omit<LMsg, "id" | "at">) => void) => void | Promise<void>) {
  let out!: State;
  // update()는 동기 함수만 받으므로, 읽고 → 비동기 작업 → 저장을 직접 차례로 한다.
  const s = await read<State>(file(runId, n), { beat: -1, waiting: "action", messages: [], hints: 0 });
  const push = (m: Omit<LMsg, "id" | "at">) => s.messages.push({ id: (s.messages.at(-1)?.id ?? 0) + 1, at: now(), ...m });
  await fn(s, push);
  const todo = s.todo ?? [];
  s.todo = [];
  await update<State>(file(runId, n), s, () => { out = s; return s; });
  notify(runId, "lesson");
  for (const o of todo) await openInEditor(runId, n, o).catch(() => {});
  return out;
}

function enter(plan: Plan, s: State, idx: number, push: (m: Omit<LMsg, "id" | "at">) => void, course: Awaited<ReturnType<typeof loadCourse>>) {
  s.beat = idx;
  const b = plan.beats[idx];
  if (!b) { s.waiting = "done"; return; }
  if (b.open) (s.todo ??= []).push(b.open);
  if (b.kind === "say") {
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
  if (!s) s = await change(runId, n, (st, push) => enter(plan, st, 0, push, course));
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
  return { stage: n, title: plan.title, teach: plan.teach, beat: s.beat, beats: plan.beats.length, waiting: s.waiting, busy: !!s.busy, messages, workspace: ws, dev: devStatus(runId), bridge };
}

/* ---------- 학습자가 한 것 ---------- */
export async function act(runId: string, n: number, input: { do: string; choice?: number; text?: string; level?: number; file?: string; line?: number }) {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const plan = await loadPlan(course.id, n);
  if (!plan) throw err(404, "이 단계의 수업 계획서가 없어요.");

  if (input.do === "ask") return ask(runId, n, plan, String(input.text ?? ""));
  if (input.do === "open") { await openLine(runId, String(input.file ?? ""), Number(input.line) || 1); return null; }
  if (input.do === "scaffold") return scaffold(runId, n, plan, course);
  if (input.do === "check") return runCheck(runId, n, plan, course, "버튼");
  if (input.do === "hint") return giveHint(runId, n, input.level);

  return change(runId, n, async (s, push) => {
    const b = plan.beats[s.beat];
    const lastActions = [...s.messages].reverse().find((m) => m.actions)?.actions ?? [];
    if ((input.do === "next" || input.do === "start_dev,try" || input.do === "try" || input.do === "next_stage") && s.waiting !== "action") throw err(409, "지금 하던 것을 먼저 마쳐 주세요.");
    if (input.do === "next") {
      enter(plan, s, s.beat + 1, push, course);
    } else if (input.do === "start_dev,try" || input.do === "try") {
      const a = [...(b?.actions ?? []), ...(b?.after ?? [])].find((x) => x.do === input.do) ?? lastActions.find((x) => x.do === input.do);
      if (!a?.try) throw err(400, "보낼 요청이 없어요.");
      push({ role: "me", text: a.label });
      if (input.do === "start_dev,try" && !devStatus(runId).running) {
        const d = await startDev(runId);
        push({ role: "note", text: d.running ? "서버를 켰어요 (http://127.0.0.1:4101)" : "서버가 켜지지 않았어요. 아래 로그를 보세요." });
        if (!d.running) return;
      }
      if (!devStatus(runId).running) { push({ role: "tutor", text: "서버가 꺼져 있어요. 위의 [서버 켜기]를 누른 뒤 다시 보내 주세요.", actions: [{ label: "서버 켜고 다시 보내기", do: "start_dev,try", try: a.try }] }); return; }
      const r = await tryRequest(runId, a.try);
      push({ role: "tutor", card: { type: "reply", request: r.request, status: r.status, timedOut: r.timedOut, error: r.error, headers: pick(r.headers), body: r.body } });
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
      push({ role: "tutor", text: s.hints >= 3 ? "통과했어요. 정답 줄을 보고 고친 거라, 이 부분은 다음 복습에서 코드 없이 한 번 더 확인할게요." : "**통과!** 직접 고쳐서 모든 확인을 통과했어요. 이제 없는 주소에도, 틀린 방식에도 서버가 제대로 답장해요." });
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

export async function ask(runId: string, n: number, plan: Plan, text: string, quote?: { file: string; from: number; to: number; code: string }) {
  const q = text.trim().slice(0, 1000) || (quote ? "이 코드가 뭐 하는 거예요?" : "");
  if (!q) throw err(400, "질문을 적어 주세요.");
  const s0 = await change(runId, n, (s, push) => {
    push({ role: "me", text: q, card: quote ? { type: "code", ...quote } : undefined });
    s.busy = true;
  });
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const ws = workspaceOf(run, stageOf(course, n).template);
  const b = plan.beats[s0.beat];
  let answer = "";
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
async function onSave(runId: string, n: number) {
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
