// 학습 기록 타임라인(2026-11-08 사용자 "시간 기준은 실제 시간이 아니라 행동이 완수되는 것. 그 단위마다 상태가 어떻게 변하는지,
// AI가 무엇을 묻고 사용자가 어떻게 응답했고, 도구를 무엇무엇 불렀고, 토큰 · 속도도 작게").
// 한 칸 = 행동 하나가 끝난 것: 학습자의 말 · 버튼 · 저장 하나 + 그에 대한 AI의 응답 전체(도구 여러 개는 한 칸에 묶음) + 그 뒤 상태.
// 목표 정리(뒤에서 도는 AI)도 한 칸. 상태 = 학습에 쓰는 상태 전부(장기 목표 · 방식 · 로드맵 · 현재 목표와 단계 · 보충 로드맵 · 띄운 설문/계획 ·
// 어려움 표시 · 학습자 메모리 · 파일 고치기 허용 · 저장 자동 확인 · 끝낸 목표 정리 수). 칸마다 전체 상태와 바로 앞 칸과의 차이를 남긴다.
import path from "node:path";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { DATA } from "./store.ts";

export type Snap = {
  long: string | null; mode: string | null;
  map: { title: string; status: string }[];
  current: { title: string; done: string; phase: string } | null;
  support: { target: string; steps: { title: string; status: string; phase?: string }[]; round: number; back: boolean } | null;
  survey: string[] | null; plan: string | null; stuck: string | null;
  memory: { kind: string; status: string; text: string }[];
  edit: string | null; autoCheck: boolean; records: number;
};
export type Trigger = { kind: "message" | "button" | "save" | "system"; label: string; text?: string };
export type Step = {
  n: number; at: string; endAt: string; trigger: Trigger;
  reply: string; tools: string[]; usage: { input: number; cached: number; output: number; ms: number; calls?: number } | null;
  changes: string[]; state: Snap; extra?: Record<string, unknown>;
};
const file = (runId: string) => path.join(DATA, "goals", `${runId}.timeline.jsonl`);
const pending = new Map<string, { at: string; trigger: Trigger; before: Snap; msgCount: number; usageBefore: unknown }>();

/** 지금 상태를 한 덩어리로 */
export async function snapshot(runId: string): Promise<Snap> {
  const G = await import("./goals.ts"), M = await import("./memory.ts"), R = await import("./goal-record.ts");
  const { getRun } = await import("./store.ts");
  const g = await G.goalsOf(runId), run = await getRun(runId);
  const mem = await M.memoryOf().catch(() => []);
  const edit = run.codexId ? ((await (await import("./codex-chat.ts")).chatOf(run.codexId).catch(() => null))?.edit ?? null)
    : run.chatId ? (((await (await import("./agent-chat.ts")).chatOf(run.chatId).catch(() => null)) as { edit?: string } | null)?.edit ?? null) : null;
  const c = g.current;
  return {
    long: g.long?.text ?? null, mode: g.mode,
    map: g.map.map((m) => ({ title: m.title, status: m.status })),
    current: c ? { title: c.title, done: c.done, phase: !c.understood ? "① 이해" : !c.applied ? "② 적용" : "적용까지 끝" } : null,
    support: g.support ? { target: g.support.target.title, steps: g.support.steps.map((x) => ({ title: x.title, status: x.status, phase: !x.understood ? "① 이해" : !x.applied ? "② 적용" : "적용까지 끝" })), round: g.support.round, back: g.support.back } : null,
    survey: g.survey ? g.survey.questions.map((q) => q.q) : null, plan: g.plan?.long ?? null,
    stuck: g.stuck ? [...g.stuck.reasons, g.stuck.text].filter(Boolean).join(" · ") : null,
    memory: mem.map((i) => ({ kind: i.kind, status: i.status, text: i.text })),
    edit, autoCheck: run.autoCheck !== false, records: (await R.recordsOf(runId)).length,
  };
}

/** 바로 앞 상태와의 차이를 사람이 읽는 줄로(필드마다 같은 규칙, 문항별 처리 없음) */
export function diff(a: Snap | null, b: Snap): string[] {
  const out: string[] = [];
  const st = (s: string) => ({ done: "✓", skipped: "↷", doing: "▶", todo: "·" } as Record<string, string>)[s] ?? s;
  if (!a) return ["기록 시작"];
  if (a.long !== b.long) out.push(b.long ? `장기 목표: ${b.long}` : "장기 목표 없어짐");
  if (a.mode !== b.mode && b.mode) out.push(`진행 방식: ${b.mode === "topdown" ? "탑다운" : "바텀업"}`);
  const am = a.map.map((m) => m.title).join("|"), bm = b.map.map((m) => m.title).join("|");
  if (am !== bm) out.push(`로드맵: ${b.map.map((m) => m.title).join(" → ") || "(없음)"}`);
  else b.map.forEach((m, i) => { if (a.map[i]?.status !== m.status) out.push(`로드맵 ${i + 1} "${m.title}" ${st(a.map[i]?.status ?? "")} → ${st(m.status)}`); });
  if (a.current?.title !== b.current?.title) out.push(b.current ? `현재 목표: ${b.current.title}` : "현재 목표 닫힘");
  else if (a.current && b.current && a.current.phase !== b.current.phase) out.push(`단계: ${a.current.phase} → ${b.current.phase}`);
  if (!a.support && b.support) out.push(`보충 로드맵 생김: ${b.support.steps.map((x) => x.title).join(" → ")} → 🎯 ${b.support.target}`);
  else if (a.support && !b.support) out.push("보충 로드맵 닫힘(원래 로드맵으로)");
  else if (a.support && b.support) {
    if (a.support.round !== b.support.round) out.push(`보충 다시 짬(${b.support.round}번째): ${b.support.steps.filter((x) => x.status !== "done").map((x) => x.title).join(" → ")}`);
    else b.support.steps.forEach((x, i) => { const y = a.support!.steps[i]; if (y?.status !== x.status) out.push(`보충 "${x.title}" ${st(y?.status ?? "")} → ${st(x.status)}`); else if (y?.phase && x.phase && y.phase !== x.phase) out.push(`보충 "${x.title}" 단계: ${y.phase} → ${x.phase}`); });
    if (!a.support.back && b.support.back) out.push(`보충 끝 → 🎯 "${b.support.target}"로 돌아옴`);
  }
  if (!a.survey && b.survey) out.push(`설문 띄움(${b.survey.length}문항)`);
  if (a.survey && !b.survey) out.push("설문 답함");
  if (!a.plan && b.plan) out.push(`계획 제안: ${b.plan}`);
  if (a.plan && !b.plan) out.push("계획 닫힘");
  if (!a.stuck && b.stuck) out.push(`어려움 표시: ${b.stuck}`);
  const key = (m: Snap["memory"][number]) => `${m.kind}|${m.text}`;
  const am2 = new Map(a.memory.map((m) => [key(m), m.status])), bm2 = new Map(b.memory.map((m) => [key(m), m.status]));
  for (const m of b.memory) { const was = am2.get(key(m)); if (was === undefined) out.push(`메모리 + ${m.kind}(${m.status}): ${m.text}`); else if (was !== m.status) out.push(`메모리 ${m.text}: ${was} → ${m.status}`); }
  for (const m of a.memory) if (!bm2.has(key(m))) out.push(`메모리 − ${m.text}`);
  if (a.edit !== b.edit) out.push(`파일 고치기: ${b.edit === "allow" ? "허용" : b.edit === "deny" ? "거절" : "아직 안 물음"}`);
  if (a.autoCheck !== b.autoCheck) out.push(`저장하면 튜터 확인: ${b.autoCheck ? "켬" : "끔"}`);
  if (a.records !== b.records) out.push(`목표 정리 +${b.records - a.records}`);
  return out;
}

async function chatState(runId: string) {
  const { getRun } = await import("./store.ts");
  const run = await getRun(runId);
  if (run.codexId) { const c = await (await import("./codex-chat.ts")).chatOf(run.codexId); return { messages: c.messages as { role: string; text: string; at: string }[], usage: c.usage ?? [], codex: true, chatId: run.codexId }; }
  if (run.chatId) { const c = await (await import("./agent-chat.ts")).chatOf(run.chatId); return { messages: c.messages as { role: string; text: string; at: string }[], usage: [], codex: false, chatId: run.chatId }; }
  return null;
}
async function lastStep(runId: string): Promise<Step | null> { const xs = await stepsOf(runId); return xs.at(-1) ?? null; }
async function append(runId: string, s: Omit<Step, "n" | "changes">) {
  const prev = await lastStep(runId);
  const step: Step = { n: (prev?.n ?? 0) + 1, ...s, changes: diff(prev?.state ?? null, s.state) };
  await mkdir(path.dirname(file(runId)), { recursive: true });
  await appendFile(file(runId), JSON.stringify(step) + "\n");
  return step;
}

/** 행동 시작(학습자 말 · 버튼 · 저장). AI가 답하면 endStep에서 닫는다 */
export async function beginStep(runId: string, trigger: Trigger) {
  try {
    const cs = await chatState(runId);
    if (pending.has(runId)) await endStep(runId); // 앞 행동이 안 닫혔으면 먼저 닫는다
    pending.set(runId, { at: new Date().toISOString(), trigger, before: await snapshot(runId), msgCount: cs?.messages.length ?? 0, usageBefore: cs?.usage.at(-1) ?? null });
  } catch { /* 기록 실패는 학습을 막지 않는다 */ }
}
/** 행동 끝: AI 응답 · 도구 · 토큰 · 상태를 한 칸으로 */
export async function endStep(runId: string) {
  const p = pending.get(runId); if (!p) return null;
  pending.delete(runId);
  try {
    const cs = await chatState(runId);
    const msgs = cs ? cs.messages.slice(p.msgCount) : [];
    const reply = msgs.filter((m) => m.role === "assistant").map((m) => m.text).join("\n\n");
    const tools = msgs.filter((m) => m.role === "tool").map((m) => String(m.text).split("\n")[0].replace(/\s*·\s*(완료|진행 중|실패).*$/, "").replace(/^Recaller 도구\s*/, "").trim().slice(0, 80)).filter(Boolean);
    let usage: Step["usage"] = null;
    if (cs?.codex) {
      // Codex 사용량은 대화(thread)마다 누적 → 앞 값과의 차이. 새 대화면 그대로
      const now = cs.usage.at(-1) as { input: number; cached: number; output: number; ms: number } | undefined, was = p.usageBefore as typeof now | null;
      if (now && now !== was && cs.usage.length) { const d = was && now.input >= was.input ? { input: now.input - was.input, cached: now.cached - was.cached, output: now.output - was.output } : { input: now.input, cached: now.cached, output: now.output }; usage = { ...d, ms: now.ms }; }
    } else if (cs) {
      // 기본 엔진: 호출 기록(prompts/usage.jsonl)에서 이 행동 동안의 튜터 호출
      const rows = (await readFile(path.join(DATA, "prompts", "usage.jsonl"), "utf8").catch(() => "")).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter((r) => r && r.kind === "tutor" && r.runId === `chat-${cs.chatId}` && r.at >= p.at);
      if (rows.length) {
        const t = rows.flatMap((r: { tokens?: { input: number; output: number; cache?: { read: number } }[] }) => r.tokens ?? []);
        usage = { input: t.reduce((n, x) => n + x.input + (x.cache?.read ?? 0), 0), cached: t.reduce((n, x) => n + (x.cache?.read ?? 0), 0), output: t.reduce((n, x) => n + x.output, 0), ms: rows.reduce((n: number, r: { ms: number }) => n + (r.ms ?? 0), 0), calls: rows.reduce((n: number, r: { calls?: number }) => n + (r.calls ?? 1), 0) };
      }
    }
    // 막힌 순간(11/11): 열려 있는 장면에 이 칸의 학습자 말 · 받은 도움을 보탠다
    await (await import("./moments.ts")).onStep(runId, { trigger: p.trigger, reply, tools }).catch(() => {});
    // 보충을 마치고 돌아왔으면 [너무 어려워요]로 연 장면은 풀린 것
    await (async () => { const g = await (await import("./goals.ts")).goalsOf(runId); if (g.support?.back) await (await import("./moments.ts")).onSupportDone(runId); })().catch(() => {});
    (await import("./ongoing.ts")).ongoingLater(runId); // 손 놓고 15분이면 하던 목표를 진행 중으로 정리(11/12)
    return await append(runId, { at: p.at, endAt: new Date().toISOString(), trigger: p.trigger, reply: reply.slice(0, 4000), tools, usage, state: await snapshot(runId) });
  } catch { return null; }
}
/** 뒤에서 돈 일(목표 정리 등)을 한 칸으로 */
export async function systemStep(runId: string, label: string, extra: Record<string, unknown>, ms?: number, kind: Trigger["kind"] = "system") {
  try { const now = new Date().toISOString(); return await append(runId, { at: now, endAt: now, trigger: { kind, label }, reply: "", tools: [], usage: ms ? { input: 0, cached: 0, output: 0, ms } : null, state: await snapshot(runId), extra }); } catch { return null; }
}

export async function stepsOf(runId: string): Promise<Step[]> {
  return (await readFile(file(runId), "utf8").catch(() => "")).split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as Step]; } catch { return []; } });
}
/** 화면용: 칸들 + (타임라인을 남기기 전 대화면) 목표 기록(log)으로 만든 거친 칸 */
export async function timelineView(runId: string) {
  const steps = await stepsOf(runId);
  if (steps.length) return { runId, steps, rough: false };
  const g = await (await import("./goals.ts")).goalsOf(runId);
  return { runId, rough: true, steps: g.log.map((l, i) => ({ n: i + 1, at: l.at, endAt: l.at, trigger: { kind: "system", label: l.kind }, reply: "", tools: [], usage: null, changes: [l.text], state: null })) };
}
