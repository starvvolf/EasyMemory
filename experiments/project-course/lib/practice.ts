// 실습(자유 대화) — 2026-11-11 사용자 "예전에 정해진 코스용 기능도 빼도 될 듯": 단계 수업(lesson.ts)을 걷어 내고 대화로 배우는 실습만 남긴 것.
// 대화는 실험판 엔진(agent-chat) 또는 Codex 엔진(codex-chat)이 맡고, 여기서는 화면 모양으로 옮기기 · 질문 넘기기 · 버튼(목표) · 판정 · 부족함 원장 · 막힌 순간 · 저장 확인 · 학습 종료를 잇는다.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ServerResponse } from "node:http";
import { getRun, saveRun } from "./store.ts";
import { bridgeState, connected as bridgeConnected } from "./bridge.ts";

const err = (status: number, message: string) => Object.assign(new Error(message), { status });

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


/* ---------- 11/4 사용자 "GPT가 만든 것까지 그대로 붙여 봐": 프리스타일 대화를 실험판(agent-chat) 엔진이 그대로 맡는다 ----------
 * 지시문 · 도구 · 학습 상태(목표 · 초점 · 보충 · 관찰)는 실험판 것 그대로. 여기서는 그 대화를 제품 화면 모양으로 옮기고, 질문을 넘기기만 한다 */
async function chatPart(chatId: string) {
  const v = await (await import("./agent-chat.ts")).chatView(chatId);
  await markOnce(v.workspace);
  const messages = v.messages.map((m) => {
    const id = `c${m.id}`;
    if (m.role === "user") return { id, role: "me", text: shownUser(m.text) };
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
/* 11/4 사용자 "기존 UI에 붙여 봐(Codex 버전)": Codex 엔진 대화를 제품 화면 모양으로 옮긴다 */
/** 예전에 만든 대화 폴더에도 VS Code 연결 표시를 둔다(한 번만, 11/5) */
const marked = new Set<string>();
async function markOnce(ws: string) { if (marked.has(ws)) return; marked.add(ws); await (await import("./learn.ts")).markChatFolder(ws); }
/** 버튼이 튜터에게 보낸 말(지시가 섞인 것)은 화면에선 짧게(11/4) */
/**
 * 버튼이 학습자 대신 튜터에게 보내는 글(11/9 실습 시험: "[해 봤어요 — 판정 …] '맞아요'로 시작하지 말고…"가 학습자 말풍선으로 보이고,
 * 판정은 "["로 시작하는 학습자 답("[기존 글, 글 B]…")을 버튼 글로 보고 버려 예전 답을 채점함) → 글 모양 대신 보이지 않는 표시로 구분한다.
 * 모양: SYS + 화면 이름 + SYS + 튜터에게 가는 글
 */
const SYS = "\u2063";
export const sysSay = (label: string, body: string) => `${SYS}${label}${SYS}${body}`;
const LEGACY_SYS = /^\[(확정|다음으로|막혔어요|너무 어려워요|너무 쉬워요|이해했어요|해 봤어요|진행 방식 변경|계획 다시 얘기하기|저장함|명령 실행함|보충|설문)[\]\s—]/;
export const isSys = (t: string) => t.startsWith(SYS) || LEGACY_SYS.test(t.trim());
/** 버튼 글의 화면 이름(해 봤어요는 판정까지) */
function sysLabel(t: string) {
  if (!t.startsWith(SYS)) return null;
  const end = t.indexOf(SYS, 1);
  const label = t.slice(1, end < 0 ? undefined : end), body = end < 0 ? "" : t.slice(end + 1);
  const verdict = /판정: ([^·\]\n]+)/.exec(body)?.[1]?.trim();
  const why = /(?:막힌|어려운) 점\(학습자가 고름\): ([^\n]*)/.exec(body)?.[1];
  return `${label}${verdict ? ` → ${verdict}` : ""}${why ? ` — ${why.split(" · ").slice(0, 2).join(", ")}` : ""}`;
}
function shownUser(t: string) {
  const sl = sysLabel(t);
  if (sl !== null) return sl;
  const m = /^\[(확정|다음으로|막혔어요|너무 어려워요|너무 쉬워요|이해했어요|해 봤어요|진행 방식 변경|계획 다시 얘기하기)\]/.exec(t);
  if (!m) return t;
  if (m[1] === "너무 쉬워요" || m[1] === "해 봤어요") return m[1];
  if (m[1] === "이해했어요") return "이해했어요 → 적용하기";
  if (m[1] === "막혔어요" || m[1] === "너무 어려워요") { const why = /(?:막힌|어려운) 이유\(학습자가 고름\): ([^\n]*)/.exec(t)?.[1]; return `너무 어려워요${why ? ` — ${why}` : ""}`; }
  return ({ 확정: "✓ 계획 확정", 다음으로: "다음으로 →", "진행 방식 변경": `진행 방식 바꾸기 — ${/이제부터 ([^(]+)/.exec(t)?.[1]?.trim() ?? ""}`, "계획 다시 얘기하기": "계획 다시 얘기하기" } as Record<string, string>)[m[1]];
}
async function codexPart(codexId: string) {
  const v = await (await import("./codex-chat.ts")).view(codexId);
  await markOnce(v.workspace);
  const messages = v.messages.map((m) => {
    const id = `x${m.id}`;
    if (m.role === "user") return { id, role: "me", text: shownUser(m.text) };
    if (m.role === "assistant") return { id, role: "tutor", text: m.text };
    if (m.role === "tool") { const first = m.text.split("\n")[0]; return { id, role: "tutor", card: { type: "tool", icon: m.item === "file_change" ? "✏️" : m.item === "command_execution" ? "▶" : m.item === "mcp_tool_call" ? "🧠" : "🔧", label: m.text.split("\n").slice(0, 2).join(" · ").slice(0, 160), ok: !/실패|중단/.test(first) } }; }
    return { id, role: "note", text: m.text };
  });
  return { messages, busy: v.busy, workspace: v.workspace, learned: v.learned,
    chat: { id: v.id, engine: "codex", goal: "", focus: "", support: [], observations: 0, noCourse: true, model: v.model, models: v.models, edit: v.edit, codexLogin: v.status.loggedIn } };
}
/**
 * 저장하면 튜터가 확인 (2026-11-06 사용자 "ctrl s 누르면 자동으로 확인 해주면 좋겠음"): 대화로 배우는 실습(Codex·실험판)에서
 * VS Code가 파일을 저장하면, 튜터가 답하는 중이 아니고 학습자가 자동 확인을 끄지 않았을 때 그 파일을 확인하라고 한 번 묻는다.
 * 정해진 코스(단계 수업)는 원래 저장하면 검사가 돈다(onSave). 같은 파일은 20초 안에 다시 묻지 않는다.
 */
const savedAt = new Map<string, number>();
export async function checkOnSave(runId: string, saved: string) {
  const run = await getRun(runId).catch(() => null);
  if (!run || !(run.codexId || run.chatId)) return;
  if (!/\.(m?[jt]sx?|py|java|c|cc|cpp|h|go|rs|rb|kt|cs|html|css|json|sql)$/i.test(saved)) return;
  // 목표 정리가 학습자 코드를 볼 수 있게 저장본을 남긴다(11/6 사용자 A안). 자동 확인을 꺼도 남긴다
  await logSaved(runId, run, saved).catch((e) => console.error("저장본 기록:", e));
  if (run.autoCheck === false) return;
  const key = `${runId}:${saved}`;
  if (Date.now() - (savedAt.get(key) ?? 0) < 20_000) return;
  const busy = run.codexId ? (await (await import("./codex-chat.ts")).view(run.codexId)).busy : (await (await import("./agent-chat.ts")).chatView(run.chatId!)).busy;
  if (busy) return;
  savedAt.set(key, Date.now());
  await (await import("./timeline.ts")).beginStep(runId, { kind: "save", label: `저장: ${saved}` });
  const say = `[저장함] ${saved}을(를) 저장했어요. 작업 폴더에서 이 파일을 읽고, 지금 목표 기준으로 맞게 했는지 짧게 확인해 주세요. 틀린 곳은 답을 바로 주지 말고 어디를 보면 되는지 알려 주세요.`;
  if (run.codexId) await codexAsk(runId, run.codexId, sysSay("저장함", say)); else await chatAsk(runId, run.chatId!, sysSay("저장함", say));
}
async function logSaved(runId: string, run: { codexId?: string; workspaces: Record<string, string> }, saved: string) {
  const ws = run.codexId ? (await (await import("./codex-chat.ts")).view(run.codexId)).workspace : Object.values(run.workspaces)[0];
  if (!ws) return;
  const root = path.resolve(ws), abs = path.resolve(root, saved);
  if (abs !== root && !abs.startsWith(root + path.sep)) return; // 작업 폴더 밖 파일은 안 남긴다
  const text = await readFile(abs, "utf8").catch(() => null);
  if (text === null) return;
  await (await import("./goal-record.ts")).logSave(runId, path.relative(root, abs).split(path.sep).join("/"), text);
}
async function codexAsk(runId: string, codexId: string, text: string) {
  const cx = await import("./codex-chat.ts");
  await cx.ask(codexId, text, { context: async () => (await import("./goals.ts")).goalContext(runId), noLearned: true });
  // Codex 대화는 파일에 바로 쓴다 → 답하는 동안 0.45초마다 화면에 알리고, 끝나면 한 번 더(배운 것 뽑기 뒤에도 한 번)
  clearInterval(chatPolls.get(runId));
  chatPolls.set(runId, setInterval(async () => {
    notifyLesson(runId);
    if (!(await cx.view(codexId)).busy) { clearInterval(chatPolls.get(runId)); chatPolls.delete(runId); void (await import("./timeline.ts")).endStep(runId).then(() => notifyLesson(runId)); setTimeout(() => notifyLesson(runId), 15000); }
  }, 450));
}
const chatPolls = new Map<string, ReturnType<typeof setInterval>>();
/** 끝난 목표를 정리한다(그 목표가 시작된 뒤의 대화 전체, 버튼 말은 짧게, 도구는 한 줄) */
async function chatMessages(run: { codexId?: string; chatId?: string }): Promise<{ role: string; text: string; at: string }[]> {
  return run.codexId ? (await (await import("./codex-chat.ts")).chatOf(run.codexId)).messages : (await (await import("./agent-chat.ts")).chatOf(run.chatId!)).messages;
}
export const recordShow = (m: { role: string; text: string }) => m.role === "user" ? (isSys(m.text) ? `[버튼 — 학습자가 한 말이 아님] ${shownUser(m.text)}` : `[학습자] ${shownUser(m.text)}`) : m.role === "assistant" ? `[튜터] ${m.text.slice(0, 2500)}` : m.role === "tool" ? `[도구] ${m.text.split("\n")[0].slice(0, 120)}` : "";
async function recordFinished(runId: string, run: { codexId?: string; chatId?: string }, goal: { id?: string; title: string; done: string; understood: boolean; applied: boolean; at: string }, mode: string | null) {
  const R = await import("./goal-record.ts");
  const t0 = Date.now();
  // 부족함 원장(11/8): 이 목표 동안 잡힌 부족함을 정리에 같이 보내고, 정리 결과(이름 · 재확인 문항)를 원장에 합친다
  const GP = await import("./gaps.ts");
  const gid = (goal as { id?: string }).id ?? "";
  const rec = await R.recordGoal(runId, goal, mode, await chatMessages(run), recordShow, undefined, await R.savesOf(runId), gid ? await GP.gapsForRecord(runId, gid, await verdictLines(runId, goal.at)) : "").catch(() => null);
  if (rec && gid) await GP.mergeRecord(runId, { id: gid, title: goal.title, done: goal.done }, (rec.gaps ?? []) as never, rec.to).catch((e) => console.error("부족함 원장 합치기:", e));
  if (rec) { await (await import("./timeline.ts")).systemStep(runId, `목표 정리: ${goal.title}`, { learned: rec.learned.map((x) => `${x.type} · ${x.concept}`), gaps: (rec.gaps ?? []).map((x) => `${x.type} · ${x.concept}${x.code ? ` (코드 ${x.code.file} ${x.code.from}~${x.code.to}줄)` : ""}`) }, Date.now() - t0); notifyLesson(runId); }
  return rec;
}
/** 시험용(11/8): 원장에 있는 목표를 원장과 함께 다시 정리한다(학습 종료가 원장을 건너뛰던 때의 실습을 다시 보기). 정리 기록이 하나 더 생긴다 */
export async function rerecordWithLedger(runId: string) {
  const run = await getRun(runId);
  const recs = await (await import("./goal-record.ts")).recordsOf(runId);
  const gaps = await (await import("./gaps.ts")).ledgerOf(runId);
  const out: string[] = [];
  for (const gid of [...new Set(gaps.map((g) => g.goal.id))]) {
    const title = gaps.find((g) => g.goal.id === gid)!.goal.title;
    const r = [...recs].reverse().find((x) => x.goal === title);
    if (!r) continue;
    const rec = await recordFinished(runId, run, { id: gid, title, done: r.done, understood: true, applied: r.status === "마침", at: r.from }, r.mode);
    if (rec) out.push(title);
  }
  return { rerecorded: out };
}
/**
 * 학습 종료(11/6 사용자 "도중에 학습 종료 버튼. 끄면서 알아서 처리할 거 정리하면서 로딩 살짝 걸리고 종료"):
 * 하던 목표를 지금까지로 닫고 → 그 목표 정리(+ 학습자 메모리 갱신, AI 1번, 목표가 있을 때만) → 앱 지식으로 넣기(앱이 켜져 있으면, 앱의 sync가 넣는다).
 */
/** 튜터 말에 나온 작업 폴더 파일(과 줄)을 줄 번호와 함께 — 판정의 기준이 되는 실제 코드. 파일 3개 · 파일마다 120줄까지.
 *  데이터 파일(.json)은 붙이지 않는다(11/9 시험: "파일에 [기존 글]이 있다고 하자"는 과제를 실제 posts.json의 [] 와 비교해 정답을 두 번 거절) */
export async function referencedCode(runId: string, text: string) {
  const ws = await (await import("./goals.ts")).runWorkspace(runId);
  if (!ws) return "";
  const root = path.resolve(ws);
  const seen = new Map<string, { from: number; to: number }[]>();
  const re = /([\w.\-/]+\.(?:m?[jt]sx?|py|java|c|cc|cpp|h|go|rs|rb|kt|cs|html|css|sql))\b(?:[^\n\d]{0,12}(\d+)(?:\s*[~\-–]\s*(\d+))?\s*(?:줄|행|번째 줄|line))?/g;
  // 폴더 없이 이름만 말한 파일("goals.ts")은 작업 폴더 안에서 이름이 하나뿐일 때 그 파일로(검토 11/8)
  const { existsSync } = await import("node:fs");
  let names: Map<string, string[]> | null = null;
  const byName = async (base: string) => {
    if (!names) {
      names = new Map();
      const walk = async (d: string, depth: number) => { if (depth > 4) return; for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) { if (e.name.startsWith(".") || e.name === "node_modules") continue; const f = path.join(d, e.name); if (e.isDirectory()) await walk(f, depth + 1); else names!.set(e.name, [...(names!.get(e.name) ?? []), f]); } };
      await walk(root, 0);
    }
    const hits = names.get(base) ?? [];
    return hits.length === 1 ? hits[0] : null;
  };
  for (const m of text.matchAll(re)) {
    const rel = m[1].replace(/^\.\//, "");
    let abs = path.resolve(root, rel);
    if (!existsSync(abs) && !rel.includes("/")) abs = (await byName(rel)) ?? abs;
    if (!existsSync(abs)) continue; // 없는 파일은 자리(3개)를 차지하지 않는다
    if (abs !== root && !abs.startsWith(root + path.sep)) continue;
    const list = seen.get(abs) ?? []; seen.set(abs, list);
    if (m[2]) list.push({ from: Number(m[2]), to: Number(m[3] ?? m[2]) });
  }
  // 줄만 따로 말한 경우("119줄부터")도 그 파일의 범위로 본다(파일이 하나일 때)
  if (seen.size === 1) { const [only] = seen.values(); for (const m of text.matchAll(/(\d+)(?:\s*[~\-–]\s*(\d+))?\s*(?:줄|행)/g)) only.push({ from: Number(m[1]), to: Number(m[2] ?? m[1]) }); }
  const out: string[] = [];
  for (const [abs, ranges] of [...seen].slice(0, 3)) {
    const lines = (await readFile(abs, "utf8").catch(() => null))?.split(/\r?\n/);
    if (!lines) continue;
    const keep = new Set<number>();
    if (ranges.length) for (const r of ranges) for (let i = Math.max(1, Math.min(r.from, r.to) - 8); i <= Math.min(lines.length, Math.max(r.from, r.to) + 8); i++) keep.add(i);
    else for (let i = 1; i <= Math.min(lines.length, 120); i++) keep.add(i);
    const nums = [...keep].sort((a, b) => a - b).slice(0, 120);
    out.push(`[과제가 가리키는 코드 ${path.relative(root, abs).split(path.sep).join("/")} — 판정 기준]\n${nums.map((i) => `${String(i).padStart(4)}| ${lines[i - 1]}`).join("\n")}`);
  }
  return out.join("\n\n");
}
/** 이 목표 동안의 [해 봤어요] 판정(타임라인 버튼 칸의 판정 글) — 시각 · 단위 · 판정 */
async function verdictLines(runId: string, since: string) {
  const g = await (await import("./goals.ts")).goalsOf(runId);
  return g.log.filter((l) => l.kind === "apply-check" && l.at >= since).map((l) => `${l.at.slice(11, 19)} ${l.text}`).slice(-10);
}
/** 버튼 하나가 부족함 원장에 남기는 것(코드가 정함): 판정 결과 · 막힌 이유 */
async function noteGap(runId: string, op: string, b: Record<string, unknown>) {
  const g = await (await import("./goals.ts")).goalsOf(runId);
  const sp = g.support && !g.support.back ? g.support.steps.find((x) => x.status === "doing") : null;
  const c = g.current;
  if (!c) return;
  const unit = sp ? { id: sp.id, title: `보충: ${sp.title}`, done: sp.done, support: true } : { id: c.id, title: c.title, done: c.done };
  const goal = { id: c.id, title: c.title };
  const GP = await import("./gaps.ts");
  const v = b.verdict as { verdict: string; right: string; gap: string; prereq?: string; quote?: string } | undefined;
  // 학습 기록(11/11, lib/history.ts): 판정 · 새 이름을 직접 씀 · 막힘을 이름 단위로 한 줄씩
  const H = await import("./history.ts");
  if (op === "applied" && v) {
    const KIND: Record<string, "맞음" | "일부" | "틀림"> = { correct: "맞음", partial: "일부", incorrect: "틀림" };
    const k = KIND[v.verdict];
    if (k) await H.add({ run: runId, goal: c.title, kind: k, name: v.prereq || unit.title, result: k === "맞음" ? "" : v.gap, quote: v.quote });
    // 과제의 새 이름을 답 · 최근 명령에서 직접 썼으면 "씀"(펼쳐 본 뒤면 "본 뒤에", 아니면 "혼자")
    const typed = (await (await import("./shell.ts")).shellOf(runId)).history.filter((r) => r.by === "learner").slice(-10).map((r) => r.command).join("\n");
    const said = `${v.quote ?? ""}\n${typed}`.toLowerCase();
    const used = (c.names ?? []).filter((n) => n.name.length >= 2 && said.includes(n.name.toLowerCase()));
    if (used.length) await H.add(...used.map((n) => ({ run: runId, goal: c.title, kind: "씀" as const, name: n.name, result: n.seen ? "본 뒤에" : "혼자", quote: v.quote })));
    // 선행이 빈 것(11/10): 단위를 그 선행으로 연다 → 같은 선행을 또 틀리면 같은 칸, 목표가 맞으면 함께 채움
    if (v.verdict === "partial" || v.verdict === "incorrect") {
      await GP.openGap(runId, { goal, unit: v.prereq ? GP.prereqUnit(c.id, v.prereq) : unit, from: "판정", wrong: v.gap, right: "", quote: v.quote, prereq: v.prereq });
      // 선행 덩어리에도(지금 목표의 선행에 같은 이름이 있으면)
      if (v.prereq) await (await import("./goals.ts")).setPrereqResult(runId, v.prereq, "비어 있음", v.quote ?? "");
    }
    else if (v.verdict === "correct") {
      await GP.fillUnit(runId, unit.id, v.quote || v.right);
      // 보충을 거쳐 돌아온 종착지가 맞으면, 그 목표에서 막혔던 것(선행 포함)도 채운 것으로
      if (!sp) {
        await GP.fillUnit(runId, c.id, v.quote || v.right);
        const filled = await GP.fillPrereqs(runId, c.id, v.quote || v.right);
        // 채운 선행은 됨으로(다시 확인은 원장이 따로 잡는다)
        const names = (await GP.ledgerOf(runId)).filter((x) => filled.includes(x.id) && x.prereq).map((x) => x.prereq!);
        for (const n of names) await (await import("./goals.ts")).setPrereqResult(runId, n, "됨");
      }
    }
  } else if (op === "hard" || op === "stuck") {
    const { STUCK_REASONS } = await import("./goals.ts");
    const reasons = (Array.isArray(b.reasons) ? b.reasons : []).map(String).filter((r) => STUCK_REASONS.includes(r));
    const text = String(b.text ?? "").trim();
    if (op === "stuck" && !reasons.length && !text) return; // goalAction이 거절할 요청(검토 11/8)
    await GP.openGap(runId, { goal, unit, from: "막힘", wrong: text || "어려움(이유를 고름)", cause: reasons, quote: text });
    await H.add({ run: runId, goal: c.title, kind: "막힘", name: unit.title, result: reasons.join(" · "), quote: text });
  }
}
/** [해 봤어요] 판정: 지금 단위(보충 단계 또는 현재 목표)가 이해된 뒤 튜터가 낸 과제와 학습자가 한 것만 본다 */
async function applyVerdict(runId: string, run: { codexId?: string; chatId?: string }) {
  const G = await import("./goals.ts"), R = await import("./goal-record.ts"), J = await import("./judge.ts");
  const g = await G.goalsOf(runId);
  const sp = g.support && !g.support.back ? g.support.steps.find((x) => x.status === "doing") : null;
  const unit = sp ?? g.current;
  if (!unit) return undefined;
  const label = sp ? `보충 ${sp.title}` : g.current!.title;
  const since = [...g.log].reverse().find((l) => l.kind === "understood" && l.text === label)?.at ?? (g.current?.at ?? "");
  const msgs = (await chatMessages(run)).filter((m) => m.at >= since);
  const firstUser = msgs.findIndex((m) => m.role === "user" && !isSys(m.text));
  const task = msgs.slice(0, firstUser < 0 ? msgs.length : firstUser).filter((m) => m.role === "assistant").map((m) => m.text).join("\n\n");
  // 판정은 마지막 시도만(11/8 실측: 앞의 틀린 답까지 보고 다시 맞게 한 답을 '일부만'으로 봄). 과제는 그 시도 바로 앞 튜터 말까지 포함
  const users = msgs.filter((m) => m.role === "user" && !isSys(m.text));
  const lastU = users.at(-1);
  const said = lastU ? [lastU.text.trim()] : [];
  const lastTutor = lastU ? msgs.filter((m) => m.role === "assistant" && m.at < lastU.at).at(-1)?.text ?? "" : "";
  // 저장한 코드: 과제 이후 파일마다 마지막 저장본과 과제 전 저장본의 차이(바뀐 줄)
  const saves = await R.savesOf(runId);
  const lastBy = new Map<string, string>(), beforeBy = new Map<string, string>();
  for (const sv of saves) (sv.at >= since ? lastBy : beforeBy).set(sv.file, sv.text);
  // 판정에는 과제 뒤 저장한 파일의 최신본 전체(줄 번호, 200줄까지) — 바뀐 줄만 주면 안 바뀐 줄을 "없다"고 봄(11/8 실측)
  const code = [...lastBy].filter(([f, t]) => (beforeBy.get(f) ?? "") !== t).map(([f, t]) => `[저장한 코드 ${f} — 최신본]\n${t.split(/\r?\n/).slice(0, 200).map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join("\n")}`);
  // 학습자가 과제 뒤 VS Code 터미널에서 친 명령과 결과(마지막 5개)도 한 것으로 본다(11/8)
  const typed = (await (await import("./shell.ts")).learnerRunsSince(runId, since)).slice(-5).map((r) => `[학습자가 터미널에서 친 명령] ${r.command}\n종료 코드 ${r.code ?? "모름"}\n${r.out.slice(-1500)}`);
  // 과제가 가리키는 코드(11/8 실측: "goals.ts 119줄을 따라가 보라"는 과제에서 판정이 코드를 못 봐 틀린 답을 맞은 부분으로 봄)
  const taskText = lastTutor && lastTutor !== task ? `${task}\n\n(이어서 튜터: ${lastTutor})` : task;
  const refs = await referencedCode(runId, taskText).catch(() => "");
  const v = await J.judgeApply(unit, refs ? `${taskText}\n\n${refs}` : taskText, [...said, ...code, ...typed].join("\n\n"));
  const prereq = v.verdict === "partial" || v.verdict === "incorrect" ? String(v.prereq ?? "").trim().slice(0, 60) : "";
  return { verdict: v.verdict, right: v.right, gap: v.gap, ...(prereq ? { prereq } : {}), quote: lastU?.text.trim().slice(0, 400) ?? "" };
}
const recordJobs = new Map<string, Promise<unknown>[]>();
export async function endLearning(runId: string) {
  const run = await getRun(runId);
  (await import("./shell.ts")).stopBackground(runId); // 튜터가 뒤에서 켜 둔 서버 끄기
  if (!run.codexId && !run.chatId) throw err(400, "대화로 하는 실습이 아니에요.");
  const G = await import("./goals.ts");
  const before = await G.goalsOf(runId);
  await G.goalAction(runId, "end", {});
  let recorded: { goal: string; learned: number; gaps: number; memory: number } | null = null;
  if (before.current) {
    // 목표 정리는 한 길로(11/8 실측: 학습 종료가 정리를 따로 불러 부족함 원장 합치기 · 타임라인을 건너뜀)
    const rec = await recordFinished(runId, run, before.current, before.mode);
    if (rec) recorded = { goal: rec.goal, learned: rec.learned.length, gaps: rec.gaps?.length ?? 0, memory: rec.memory?.done.length ?? 0 };
  }
  await Promise.all(recordJobs.get(runId) ?? []); recordJobs.delete(runId);
  await saveRun(runId, (r) => { (r as { endedAt?: string }).endedAt = new Date().toISOString(); });
  // 앱 지식 넣기: 코스 서버는 앱 데이터에 직접 쓰지 않는다 → 앱의 sync 주소를 불러 앱이 넣게 한다.
  // 앱은 POST에 같은 출처(origin)를 요구한다(local-experiment-mode isSameOriginExperimentMutation) → 앱 주소를 origin으로(11/6 한 바퀴 점검에서 synced null)
  const app = (process.env.PROJECT_APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
  const synced = await fetch(`${app}/api/project-course/sync`, { method: "POST", headers: { "content-type": "application/json", origin: app }, body: JSON.stringify({ runId }), signal: AbortSignal.timeout(30000) })
    .then(async (r) => (r.ok ? ((await r.json()) as { runs?: { items: number; created: number }[] }).runs?.[0] ?? null : null)).catch(() => null);
  await (await import("./timeline.ts")).systemStep(runId, "학습 종료", { recorded, synced }, undefined, "button");
  notifyLesson(runId);
  return { recorded, synced };
}
/** 끝난 목표 정리를 다시 한다(AI 호출 = 목표 수). */
/** 하다가 나간 목표를 그때까지로 정리(11/12, lib/goal-record.ts Ongoing). 손 놓고 15분 · 다른 실습으로 옮김 · 새 실습에서 부른다(lib/ongoing.ts) */
export async function recordOngoing(runId: string) {
  const run = await getRun(runId).catch(() => null);
  if (!run || (!run.codexId && !run.chatId) || (run as { endedAt?: string }).endedAt) return null;
  const g = await (await import("./goals.ts")).goalsOf(runId);
  if (!g.current) return null;
  const R = await import("./goal-record.ts"), GP = await import("./gaps.ts");
  const gid = g.current.id ?? "";
  await R.recordGoal(runId, g.current, g.mode, await chatMessages(run), recordShow, undefined, await R.savesOf(runId), gid ? await GP.gapsForRecord(runId, gid, await verdictLines(runId, g.current.at)) : "", true);
  return R.ongoingOf(runId);
}
export async function redoGoalRecords(runId: string) {
  const run = await getRun(runId);
  if (!run.codexId && !run.chatId) throw new Error("대화로 하는 실습이 아니에요.");
  const out = await (await import("./goal-record.ts")).redoRecords(runId, await chatMessages(run), recordShow);
  notifyLesson(runId);
  return { redone: out.filter(Boolean).length, total: out.length };
}
async function chatAsk(runId: string, chatId: string, text: string) {
  const ac = await import("./agent-chat.ts");
  const G = await import("./goals.ts");
  // 학습 목표(11/4): 매 차례 맥락 + 목표 도구. 실험판의 목표 · 초점 도구(adjust_learning · get_learning_state)는 숨겨 두 체계가 섞이지 않게
  const ext = { context: () => G.goalContext(runId), hide: ["adjust_learning", "get_learning_state", "get_course_material", "record_observation"], tool: (name: string, input: Record<string, unknown>, learner: string[]) => G.runGoalTool(runId, name, input, learner), onTool: () => notifyLesson(runId) };
  const job = ac.askChat(chatId, text, undefined, ext).catch(() => {}).finally(async () => {
    clearInterval(chatPolls.get(runId)); chatPolls.delete(runId);
    await (await import("./timeline.ts")).endStep(runId); notifyLesson(runId);
    // 11/5 사용자 "질문 단위가 아니라 목표가 끝나면 정리": 질문마다 뽑던 것(chat-learned)은 제품 대화에서 끔 → 목표 정리(goal-record)
  });
  // 실험판은 대화 파일에 바로 쓴다 → 답하는 동안 화면에 0.45초마다 알린다(SSE)
  clearInterval(chatPolls.get(runId));
  chatPolls.set(runId, setInterval(() => notifyLesson(runId), 450));
  // askChat이 사용자 말을 저장하고 busy가 될 때까지만 기다린다(답 전체는 기다리지 않는다)
  for (let i = 0; i < 20 && !(await ac.chatView(chatId)).busy; i++) await new Promise((r) => setTimeout(r, 50));
  void job;
}

/* ---------- 화면에 보낼 것 ---------- */
export async function practiceView(runId: string) {
  const run = await getRun(runId);
  if (!run.codexId && !run.chatId) throw err(410, "예전 정해진 코스 실습은 11/11에 뺐어요. 새 실습으로 시작해 주세요(예전 기록은 데이터 폴더에 남아 있어요).");
  const bs = bridgeState(runId);
  const bridge = bridgeConnected(runId) ? { connected: true, file: bs?.file ?? null, line: bs?.line ?? null, dirty: !!bs?.dirty, errors: bs?.errors?.length ?? 0, selection: bs?.selection ? { from: bs.selection.from, to: bs.selection.to } : null } : { connected: false };
  const part = run.codexId ? await codexPart(run.codexId) : await chatPart(run.chatId!);
  return { free: true, stage: 1, title: "", bridge, autoCheck: run.autoCheck !== false, stuck: null, ...part,
    records: await (await import("./goal-record.ts")).recordsOf(runId),
    goals: await (await import("./goals.ts")).goalsView(runId) };
}

/* ---------- 학습자가 한 것: 말 · 멈추기 · 목표 버튼 ---------- */
export async function practiceAct(runId: string, input: { do: string; text?: string; op?: string; [k: string]: unknown }) {
  const run = await getRun(runId);
  if (!run.codexId && !run.chatId) throw err(410, "예전 정해진 코스 실습은 11/11에 뺐어요. 새 실습으로 시작해 주세요.");

  // 학습 목표 버튼(11/4): 이해 · 적용 · 보충 끝은 AI 안 부름. 다음으로 · 확정 · 막혔어요 · 설문 답은 튜터에게 한 번
  // 답하는 중에 온 버튼 · 말은 거절한다(11/9 시험: 엔진이 "답하는 중"으로 거절한 것을 삼키고 200을 돌려 버튼 · 말이 조용히 사라짐)
  // 새 이름 펼쳐 보기(11/11)는 AI를 안 부르니 답하는 중에도 된다
  if ((run.codexId || run.chatId) && (input.do === "goal" || input.do === "ask") && !["names_seen", "help"].includes(String((input as { op?: string }).op))) {
    const busyNow = run.codexId ? (await (await import("./codex-chat.ts")).view(run.codexId)).busy : (await (await import("./agent-chat.ts")).chatView(run.chatId!)).busy;
    if (busyNow) throw err(409, "튜터가 아직 답하는 중이에요. 답이 끝난 뒤 다시 해 주세요.");
  }
  if ((run.codexId || run.chatId) && input.do === "goal") {
    const op = String((input as { op?: string }).op ?? "");
    // 목표 정리는 현재 목표가 끝날 때만: [다음으로] 또는 보충 중이 아닐 때의 [너무 쉬워요 → 다음으로].
    // 11/8 실측: 보충 단계에서 [너무 쉬워요 → 넘어가기]마다 끝나지 않은 목표를 "건너뜀"으로 정리해 같은 목표 정리가 3번, 지식이 이름만 다르게 7개
    const g0 = op === "next" || op === "easy_next" ? await (await import("./goals.ts")).goalsOf(runId) : null;
    const inSupport = !!(g0?.support && !g0.support.back && g0.support.steps.some((x) => x.status === "doing"));
    // 계획을 다시 확정해 하던 현재 목표가 바뀌는 것도 그 목표의 끝(11/12: 바꾸기 전 목표가 정리 없이 사라짐) → 건너뜀으로 정리
    const g1 = op === "confirm" ? await (await import("./goals.ts")).goalsOf(runId) : null;
    const before = op === "next" || (op === "easy_next" && !inSupport) ? g0 : g1?.current && g1.long ? g1 : null;
    // [해 봤어요](11/8 사용자 결정 "적용 과제의 답이 맞을 때만 적용 ✓"): 판정 호출 한 번(완료 조건 · 튜터가 낸 과제 · 학습자 답과 저장한 코드)
    if (op === "applied") (input as Record<string, unknown>).verdict = await applyVerdict(runId, run).catch((e) => { console.error("적용 판정:", e); return undefined; });
    // 부족함 원장(11/8): 판정이 일부만 · 틀림이면 열고, 맞음이면 그 단위에 열린 것을 채움으로. [너무 어려워요]도 연다
    await noteGap(runId, op, input as Record<string, unknown>).catch((e) => console.error("부족함 원장:", e));
    // 막힌 순간(11/11, lib/moments.ts): 틀림 · 일부 · [너무 어려워요]면 열고, 맞음이면 닫고(보충 단계의 맞음은 어려워요 장면을 닫지 않는다), 넘어가면 안 푼 채로 닫는다
    await (async () => {
      const M = await import("./moments.ts"); const b = input as Record<string, unknown>;
      const v = b.verdict as { verdict?: string; gap?: string } | undefined;
      if (op === "applied" && v?.verdict) { if (v.verdict === "correct" && inSupport) return; await M.onVerdict(runId, v.verdict, v.gap ?? ""); }
      else if (op === "hard" || op === "stuck") await M.onHard(runId, [...((b.reasons as string[]) ?? []), String(b.text ?? "")].filter(Boolean).join(" · "));
      else if (op === "next" || (op === "easy_next" && !inSupport) || op === "end") await M.onLeave(runId);
    })().catch((e) => console.error("막힌 순간:", e));
    const TL = await import("./timeline.ts");
    // 튜터가 묻고 돌리려는 명령(11/8 결정 8): [실행]이면 돌리고 결과를 튜터에게 한 번, [안 함]이면 AI 안 부름(다음 차례 맥락에 한 줄)
    if (op === "cmd") {
      const ci = input as { id?: string; ok?: boolean };
      const d = await (await import("./shell.ts")).decide(runId, await (await import("./goals.ts")).runWorkspace(runId), String(ci.id ?? ""), ci.ok === true);
      await TL.beginStep(runId, { kind: "button", label: d.label, text: d.text });
      notifyLesson(runId);
      if (d.say) { const t = sysSay(d.label, d.say); if (run.codexId) await codexAsk(runId, run.codexId, t); else await chatAsk(runId, run.chatId!, t); } else await TL.endStep(runId);
      return;
    }
    const OPS: Record<string, string> = { help: "도움 정도 바꾸기", names_seen: "새 이름 펼쳐 봄", understood: "이해했어요", applied: "해 봤어요", next: "다음으로", easy_next: "너무 쉬워요 → 다음으로", easy: "너무 쉬워요 → 더 어렵게", hard: "너무 어려워요", stuck: "너무 어려워요", answer: "설문 답", confirm: "확정", dismiss_plan: "계획 다시 얘기하기", dismiss_survey: "설문 닫기", mode: "진행 방식 바꾸기", end: "학습 종료" };
    const b = input as Record<string, unknown>;
    const detail = op === "answer" ? (Array.isArray(b.answers) ? (b.answers as { picks?: string[]; text?: string }[]).map((a) => [...(a.picks ?? []), a.text].filter(Boolean).join(", ") || "알아서").join(" / ") : "")
      : op === "hard" || op === "stuck" ? [...((b.reasons as string[]) ?? []), String(b.text ?? "")].filter(Boolean).join(" · ") : op === "mode" ? String(b.mode ?? "") : op === "help" ? ({ self: "스스로", together: "같이", fast: "빨리 만들기" } as Record<string, string>)[String(b.help)] ?? ""
      : op === "applied" && b.verdict ? (() => { const v = b.verdict as { verdict: string; right: string; gap: string }; return `판정: ${({ correct: "맞음", partial: "일부만 맞음", incorrect: "틀림", unclear: "판단 근거 부족", not_answer: "판단 근거 부족" } as Record<string, string>)[v.verdict] ?? v.verdict}${v.right ? ` · 맞은 부분: ${v.right}` : ""}${v.gap ? ` · 빠진 곳: ${v.gap}` : ""}`; })() : "";
    await TL.beginStep(runId, { kind: "button", label: OPS[op] ?? op, ...(detail ? { text: detail } : {}) });
    const say = await (await import("./goals.ts")).goalAction(runId, op, input as Record<string, unknown>);
    if (!say) await TL.endStep(runId);
    // 11/5 사용자 "각 목표가 끝나면 쭉 대화 기록 받아서 정리(학습자가 어떤 절차를 거쳐서 뭘 배웠는지)": 뒤에서 한 번
    // 학습 종료가 이 정리를 기다렸다가 앱에 넣도록 붙잡아 둔다(11/8 타임라인에서 정리 전에 넣기가 돌아 0개)
    if (before?.current) { const job = recordFinished(runId, run, before.current, before.mode).catch(() => {}); recordJobs.set(runId, [...(recordJobs.get(runId) ?? []), job]); }
    notifyLesson(runId);
    if (say) { const t = sysSay(OPS[op] ?? op, say); if (run.codexId) await codexAsk(runId, run.codexId, t); else await chatAsk(runId, run.chatId!, t); }
    return;
  }
  if (run.codexId && (input.do === "ask" || input.do === "stop_chat")) {
    if (input.do === "stop_chat") { await (await import("./codex-chat.ts")).stop(run.codexId); notifyLesson(runId); return; }
    const sel = bridgeState(runId)?.selection;
    const pre = sel?.text ? `[VS Code에서 고른 코드 ${bridgeState(runId)?.file ?? ""} ${sel.from}~${sel.to}줄]\n${sel.text}\n\n` : "";
    await (await import("./timeline.ts")).beginStep(runId, { kind: "message", label: "학습자", text: String(input.text ?? "").slice(0, 600) });
    await codexAsk(runId, run.codexId, pre + String(input.text ?? ""));
    return;
  }
  if (run.chatId && (input.do === "ask" || input.do === "stop_chat")) {
    if (input.do === "stop_chat") { await (await import("./agent-chat.ts")).stopChat(run.chatId); return; }
    // VS Code에서 고른 줄이 있으면 질문 앞에 붙인다(실험판 엔진에는 고른 줄 칸이 없다)
    const sel = bridgeState(runId)?.selection;
    const pre = sel?.text ? `[VS Code에서 고른 코드 ${bridgeState(runId)?.file ?? ""} ${sel.from}~${sel.to}줄]\n${sel.text}\n\n` : "";
    await (await import("./timeline.ts")).beginStep(runId, { kind: "message", label: "학습자", text: String(input.text ?? "").slice(0, 600) });
    await chatAsk(runId, run.chatId, pre + String(input.text ?? ""));
    return;
  }
  throw err(400, `모르는 동작이에요: ${input.do}`);
}
/** VS Code에서 고른 코드로 묻기(물어보기 · 이건 뭐예요? · 덩어리 설명) — 대화에 그 코드를 붙여 넘긴다 */
export async function askAbout(runId: string, b: { mode?: string; file?: string; from?: number; to?: number; code?: string; question?: string }) {
  const where = `[VS Code에서 고른 코드 ${b.file ?? ""} ${b.from ?? ""}~${b.to ?? ""}줄]\n${String(b.code ?? "").slice(0, 6000)}\n\n`;
  const q = b.mode === "what" ? "이 코드가 뭐예요? 처음 보는 사람에게 이 코드에서의 뜻으로 쉽게 알려 주세요."
    : b.mode === "block" ? "이 덩어리가 무엇을 하는지, 한 줄씩 쉽게 설명해 주세요."
    : String(b.question ?? "").trim() || "이 코드에 대해 알려 주세요.";
  const run = await getRun(runId);
  await (await import("./timeline.ts")).beginStep(runId, { kind: "message", label: "학습자", text: q.slice(0, 600) });
  if (run.codexId) await codexAsk(runId, run.codexId, where + q); else if (run.chatId) await chatAsk(runId, run.chatId, where + q);
}
