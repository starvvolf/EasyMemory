// 학습 목표 구조(11/4 사용자 설계: "장기 목표 / 현재 목표 두 가지"):
// - 장기 목표: 처음에 "뭘 만들고 싶어"를 문답(plan 모드처럼, 설문지)으로 좁혀서 확정. 사용자가 크게 틀지 않으면 유지
// - 방식: 탑다운(구조부터 보고 시작 → 지도) / 바텀업(작은 것 하나부터 확장 → 지도 없음). 처음에 고르게, 도중에 바꿀 수 있게
// - 지도: 탑다운이면 큰 단계 제목만 먼저, 그 단계에 닿으면 자세히(현재 목표). 남은 제목은 고칠 수 있음
// - 현재 목표: 지금 할 것 + 완료 조건. 넘어가기 = 이해(읽고 이해했다, 학습자 표시) + 적용(확인할 수 있으면 실행으로, 아니면 학습자 표시) 뒤 학습자 [다음으로].
//   둘이 다 안 차도 넘어갈 수 있고 그건 "건너뜀"으로 남긴다
// - 보충: 막히면 [막혔어요]로 이유를 체크해 받고, 그걸로 바로 보충 목표를 연다(현재 목표는 미뤄 둠). 보충은 이해만 표시하면 돌아온다
// 상태 변경은 코드가 하고, 모델은 도구로 제안 · 기록만 한다. 학습자 버튼은 AI를 부르지 않거나(이해 · 적용 · 보충 끝) 한 번만 부른다(다음으로 · 확정 · 막혔어요 · 설문 답)
import path from "node:path";
import { randomBytes } from "node:crypto";
import { DATA, read, update } from "./store.ts";
import { CHOICES } from "./stuck.ts";

type Item = { id: string; title: string; status: "todo" | "doing" | "done" | "skipped" };
type Current = { id: string; title: string; done: string; understood: boolean; applied: boolean; mapId?: string; at: string };
type Support = { id: string; title: string; done: string; why: string; from: string; understood?: boolean; at: string };
type Question = { q: string; options: string[]; multi?: boolean };
export type Goals = {
  mode: "topdown" | "bottomup" | null;
  long: { text: string; spec: string; at: string } | null;
  map: Item[];
  current: Current | null;
  stack: Support[];
  survey: { id: string; intro: string; questions: Question[]; at: string } | null;
  plan: { long: string; spec: string; mode: "topdown" | "bottomup"; map: string[]; first: { title: string; done: string }; at: string } | null;
  stuck: { reasons: string[]; text: string; at: string } | null;
  log: { at: string; kind: string; text: string }[];
};
const empty = (): Goals => ({ mode: null, long: null, map: [], current: null, stack: [], survey: null, plan: null, stuck: null, log: [] });
const file = (runId: string) => path.join(DATA, "goals", `${runId}.json`);
const now = () => new Date().toISOString();
const nid = () => randomBytes(4).toString("hex");
const err = (message: string) => Object.assign(new Error(message), { status: 400 });
const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
export const goalsOf = (runId: string) => read<Goals>(file(runId), empty());
const save = (runId: string, fn: (g: Goals) => void) => update<Goals>(file(runId), empty(), (g) => { fn(g); });
const logIt = (g: Goals, kind: string, text: string) => { g.log.push({ at: now(), kind, text }); if (g.log.length > 200) g.log.splice(0, g.log.length - 200); };

/* ---------- 모델 도구(두 엔진 공통 정의: OpenCode는 그대로, Codex는 MCP inputSchema로) ---------- */
const str = { type: "string" } as const;
export const GOAL_TOOLS = [
  { name: "ask_questions", description: "학습자에게 고르기형 질문을 화면에 띄운다(설문지). 만들 것을 어느 수준으로 할지 좁힐 때, 진행 방식(topdown: 구조부터 / bottomup: 작은 것부터)을 물을 때 쓴다. 앞에서 학습자가 한 말을 바탕으로 3~5개. 띄운 뒤에는 답을 기다린다.",
    properties: { intro: str, questions: { type: "array", items: { type: "object", additionalProperties: false, properties: { q: str, options: { type: "array", items: str }, multi: { type: "boolean" } }, required: ["q", "options", "multi"] } } }, required: ["intro", "questions"] },
  { name: "propose_plan", description: "좁혀진 내용으로 장기 목표를 제안한다. 학습자가 [확정]을 누르면 장기 목표 · 방식 · 지도 · 첫 현재 목표가 정해진다. map은 topdown이면 큰 단계 제목 3~6개, bottomup이면 빈 목록. first는 첫 현재 목표와 완료 조건(학습자가 확인할 수 있는 한 문장).",
    properties: { long: str, spec: str, mode: { type: "string", enum: ["topdown", "bottomup"] }, map: { type: "array", items: str }, first: { type: "object", additionalProperties: false, properties: { title: str, done: str }, required: ["title", "done"] } }, required: ["long", "spec", "mode", "map", "first"] },
  { name: "set_current_goal", description: "다음 현재 목표와 완료 조건을 정한다. 학습자가 [다음으로]를 눌러 앞 목표가 끝났을 때 쓴다. 탑다운이면 지도의 다음 단계를 지금 할 만큼 구체적으로.",
    properties: { title: str, done: str }, required: ["title", "done"] },
  { name: "open_support", description: "막힌 곳을 메우는 보충 목표를 연다(현재 목표는 미뤄 둠). 학습자가 [막혔어요]로 이유를 보냈을 때, 또는 학습자 말에서 막힘이 분명할 때(why_quote에 그 말을 글자 그대로). 보충은 작게, 원래 목표로 돌아가는 데 필요한 만큼.",
    properties: { title: str, done: str, why_quote: str }, required: ["title", "done", "why_quote"] },
  { name: "update_map", description: "탑다운 지도의 남은 단계 제목을 고친다(끝난 · 하는 중 단계는 그대로). 진행하다 계획이 달라졌을 때.",
    properties: { titles: { type: "array", items: str } }, required: ["titles"] },
] as const;
export const GOAL_NAMES = new Set<string>(GOAL_TOOLS.map((t) => t.name));
/** MCP(Codex)용: inputSchema 꼴로 */
export const goalToolsMcp = () => GOAL_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: { type: "object", additionalProperties: false, properties: t.properties, required: [...t.required] } }));

/** 모델이 부른 도구를 처리한다. learner: 이 대화의 학습자 말들(근거 대조용) */
export async function runGoalTool(runId: string, name: string, input: Record<string, unknown>, learner: string[]): Promise<string> {
  const s = (v: unknown, n = 300) => String(v ?? "").trim().slice(0, n);
  let out = "";
  await save(runId, (g) => {
    if (name === "ask_questions") {
      const qs = (Array.isArray(input.questions) ? input.questions : []).slice(0, 6).map((q: any) => ({ q: s(q?.q, 200), options: (Array.isArray(q?.options) ? q.options : []).map((o: unknown) => s(o, 80)).filter(Boolean).slice(0, 8), multi: !!q?.multi })).filter((q) => q.q && q.options.length >= 2);
      if (!qs.length) throw err("질문은 q와 고를 것 2개 이상이 있어야 해요.");
      g.survey = { id: nid(), intro: s(input.intro, 300), questions: qs, at: now() };
      logIt(g, "survey", qs.map((q) => q.q).join(" / "));
      out = "질문을 화면에 띄웠어요. 학습자가 고르고 보내면 답이 다음 메시지로 와요. 이번 답은 짧게 마치세요.";
    } else if (name === "propose_plan") {
      const mode = input.mode === "bottomup" ? "bottomup" : "topdown";
      const map = mode === "topdown" ? (Array.isArray(input.map) ? input.map : []).map((t: unknown) => s(t, 80)).filter(Boolean).slice(0, 8) : [];
      const first = input.first as { title?: unknown; done?: unknown } | undefined;
      if (!s(input.long) || !s(first?.title) || !s(first?.done)) throw err("long, first.title, first.done가 필요해요.");
      if (mode === "topdown" && map.length < 2) throw err("탑다운이면 지도(map)에 큰 단계 제목이 2개 이상 있어야 해요.");
      g.plan = { long: s(input.long, 200), spec: s(input.spec, 800), mode, map, first: { title: s(first!.title, 120), done: s(first!.done, 200) }, at: now() };
      g.survey = null;
      logIt(g, "plan", g.plan.long);
      out = "계획을 화면에 띄웠어요. 학습자가 [확정]을 누르면 시작해요. 이번 답은 짧게 마치세요.";
    } else if (name === "set_current_goal") {
      if (!g.long) throw err("아직 장기 목표가 없어요. 먼저 propose_plan으로 제안하세요.");
      // 바꿀 수 있는 때: 현재 목표가 없을 때 · 학습자가 [다음으로]를 누른 직후 · [확정] 직후(첫 목표를 다듬기). 그 밖엔 학습자 버튼으로만
      const last = [...g.log].reverse().find((l) => !["survey", "answer", "map"].includes(l.kind))?.kind;
      if (g.current && last !== "next" && last !== "confirm") throw err("현재 목표가 진행 중이에요. 학습자가 [다음으로]를 누르면 바꿀 수 있어요.");
      const item = g.map.find((m) => m.status === "doing") ?? g.map.find((m) => m.status === "todo");
      if (item) item.status = "doing";
      g.current = { id: nid(), title: s(input.title, 120), done: s(input.done, 200), understood: false, applied: false, mapId: item?.id, at: now() };
      logIt(g, "current", g.current.title);
      out = `현재 목표를 정했어요: ${g.current.title}`;
    } else if (name === "open_support") {
      const q = s(input.why_quote, 300);
      const ok = !!g.stuck || (q.length >= 2 && learner.slice(-6).some((t) => norm(t).includes(norm(q))));
      if (!ok) throw err("why_quote는 학습자가 한 말을 글자 그대로 옮겨야 해요(또는 학습자가 [막혔어요]를 보낸 뒤).");
      if (g.stack.length >= 5) throw err("보충이 5겹이에요. 지금 보충부터 마치세요.");
      const from = g.stack.at(-1)?.title ?? g.current?.title ?? "(목표 정하기)";
      const why = g.stuck ? [...g.stuck.reasons, g.stuck.text].filter(Boolean).join(" · ") : q;
      g.stack.push({ id: nid(), title: s(input.title, 120), done: s(input.done, 200), why, from, at: now() });
      g.stuck = null;
      logIt(g, "support", g.stack.at(-1)!.title);
      out = `보충을 열었어요: ${g.stack.at(-1)!.title}. 이제 바로 설명을 시작하세요. 학습자가 이해했다고 누르면 '${from}'로 돌아가요.`;
    } else if (name === "update_map") {
      if (g.mode !== "topdown") throw err("지도는 탑다운일 때만 있어요.");
      const titles = (Array.isArray(input.titles) ? input.titles : []).map((t: unknown) => s(t, 80)).filter(Boolean).slice(0, 8);
      const kept = g.map.filter((m) => m.status !== "todo");
      g.map = [...kept, ...titles.map((t) => ({ id: nid(), title: t, status: "todo" as const }))];
      logIt(g, "map", titles.join(" / "));
      out = `남은 단계를 고쳤어요: ${titles.join(" → ")}`;
    } else throw err("없는 도구예요.");
  });
  return out;
}

/* ---------- 학습자 버튼(코드) ---------- */
export const STUCK_REASONS = Object.values(CHOICES).map((c) => c.label);
/** 버튼 하나를 처리하고, 튜터에게 보낼 말이 있으면 돌려준다(없으면 null = AI 안 부름) */
export async function goalAction(runId: string, op: string, b: Record<string, unknown>): Promise<string | null> {
  let say: string | null = null;
  await save(runId, (g) => {
    if (op === "answer") {
      if (!g.survey) throw err("답할 질문이 없어요.");
      const ans = Array.isArray(b.answers) ? b.answers as { picks?: string[]; text?: string }[] : [];
      const lines = g.survey.questions.map((q, i) => { const a = ans[i] ?? {}; const picks = (a.picks ?? []).filter(Boolean); const extra = String(a.text ?? "").trim(); return `${i + 1}. ${q.q} — ${picks.length ? picks.join(", ") : "알아서"}${extra ? ` (덧붙임: ${extra})` : ""}`; });
      logIt(g, "answer", lines.join(" / "));
      g.survey = null;
      say = `[질문 답]\n${lines.join("\n")}`;
    } else if (op === "dismiss_survey") { g.survey = null; }
    else if (op === "confirm") {
      if (!g.plan) throw err("확정할 계획이 없어요.");
      const p = g.plan;
      g.long = { text: p.long, spec: p.spec, at: now() }; g.mode = p.mode;
      g.map = p.map.map((t, i) => ({ id: nid(), title: t, status: i === 0 ? "doing" : "todo" }));
      g.current = { id: nid(), title: p.first.title, done: p.first.done, understood: false, applied: false, mapId: g.map[0]?.id, at: now() };
      g.plan = null; g.stack = [];
      logIt(g, "confirm", p.long);
      say = `[확정] 계획을 확정했어요. 첫 현재 목표 "${p.first.title}"부터 시작해 주세요.`;
    } else if (op === "dismiss_plan") { g.plan = null; logIt(g, "plan-dismiss", ""); say = "[계획 다시 얘기하기] 제안한 계획은 아직 확정하지 않을게요. 어디를 바꾸면 좋을지 짧게 물어봐 주세요."; }
    else if (op === "understood" || op === "applied") {
      const top = g.stack.at(-1);
      if (top && op === "understood") { // 보충은 이해만 하면 돌아간다
        g.stack.pop(); logIt(g, "support-done", top.title);
        say = null;
      } else if (g.current) { g.current[op] = !g.current[op]; logIt(g, op, `${g.current.title}: ${g.current[op]}`); }
    } else if (op === "next") {
      if (!g.current) throw err("현재 목표가 없어요.");
      const c = g.current; const full = c.understood && c.applied;
      const item = g.map.find((m) => m.id === c.mapId);
      if (item) item.status = full ? "done" : "skipped";
      logIt(g, "next", `${c.title}: ${full ? "마침" : `건너뜀(이해 ${c.understood ? "✓" : "–"}, 적용 ${c.applied ? "✓" : "–"})`}`);
      g.stack = [];
      const nextItem = g.map.find((m) => m.status === "todo");
      say = g.mode === "topdown"
        ? nextItem ? `[다음으로] "${c.title}"을(를) ${full ? "마쳤어요" : "여기까지 하고 넘어갈게요"}. 지도의 다음 단계는 "${nextItem.title}"이에요. set_current_goal로 지금 할 만큼 구체적인 현재 목표와 완료 조건을 정하고 바로 시작해 주세요.`
          : `[다음으로] "${c.title}"을(를) ${full ? "마쳤어요" : "여기까지 하고 넘어갈게요"}. 지도의 단계를 다 지났어요. 장기 목표가 다 됐는지 같이 보고, 더 할 게 있으면 update_map으로 단계를 더한 뒤 set_current_goal로 정해 주세요.`
        : `[다음으로] "${c.title}"을(를) ${full ? "마쳤어요" : "여기까지 하고 넘어갈게요"}. 여기서 넓혀 볼 다음 작은 것을 하나 정해 set_current_goal로 정하고 바로 시작해 주세요.`;
    } else if (op === "stuck") {
      const reasons = (Array.isArray(b.reasons) ? b.reasons : []).map((r) => String(r)).filter((r) => STUCK_REASONS.includes(r));
      const text = String(b.text ?? "").trim().slice(0, 500);
      if (!reasons.length && !text) throw err("막힌 이유를 하나 이상 고르거나 적어 주세요.");
      g.stuck = { reasons, text, at: now() };
      logIt(g, "stuck", [...reasons, text].join(" · "));
      const at = g.stack.at(-1)?.title ?? g.current?.title ?? "지금 하던 것";
      say = `[막혔어요] 지금: "${at}". 막힌 이유(학습자가 고름): ${[...reasons, text ? `덧붙임: ${text}` : ""].filter(Boolean).join(" · ")}\n학습자는 뭘 모르는지 정확히 모를 수 있어요. 이유를 보고 먼저 알아야 할 것을 open_support로 작은 보충 목표로 열고, 바로 설명을 시작해 주세요.`;
    } else if (op === "mode") {
      if (b.mode !== "topdown" && b.mode !== "bottomup") throw err("mode는 topdown 또는 bottomup이에요.");
      g.mode = b.mode; logIt(g, "mode", b.mode);
      say = `[진행 방식 변경] 이제부터 ${b.mode === "topdown" ? "탑다운(구조부터 보고, 지도를 따라)" : "바텀업(작은 것 하나부터 넓혀 가기)"}으로 가요.${b.mode === "topdown" && !g.map.length ? " 장기 목표를 큰 단계로 나눠 update_map으로 지도를 만들어 주세요." : ""}`;
    } else throw err("모르는 동작이에요.");
  });
  return say;
}

/* ---------- 매 차례 맥락(두 엔진 공통) ---------- */
export async function goalContext(runId: string) {
  const g = await goalsOf(runId);
  if (!g.long) {
    const wait = g.survey ? "\n지금 화면에 질문을 띄워 두었다 — 학습자 답이 오면 이어 간다." : g.plan ? "\n지금 화면에 계획을 띄워 두었다 — 학습자가 확정하거나 고칠 곳을 말한다." : "";
    return `[목표 정하기 — 아직 장기 목표 없음]
학습자가 만들거나 배우고 싶은 것을 말하면, plan 모드처럼 무엇을 어느 수준으로 만들지 좁힌다. 앞에서 한 말을 바탕으로 ask_questions로 고르기형 질문 3~5개를 띄우고, 진행 방식(topdown: 구조부터 보고 시작 / bottomup: 작은 것 하나부터 넓혀 가기)도 함께 묻는다. 좁혀지면 propose_plan으로 제안한다. 인사나 가벼운 질문에는 그냥 답한다.${wait}`;
  }
  const mark = (m: Item) => ({ done: "✓", skipped: "↷", doing: "▶", todo: "·" })[m.status];
  const c = g.current, top = g.stack.at(-1);
  return [
    "[학습 목표 — Recaller가 관리하고 화면 위에 보인다]",
    `장기 목표: ${g.long.text} (${g.mode === "topdown" ? "탑다운" : "바텀업"})`,
    g.long.spec ? `범위: ${g.long.spec}` : "",
    g.map.length ? `지도: ${g.map.map((m, i) => `${i + 1}.${mark(m)} ${m.title}`).join(" · ")}` : "",
    c ? `현재 목표: ${c.title} — 완료 조건: ${c.done} (이해 ${c.understood ? "✓" : "–"} · 적용 ${c.applied ? "✓" : "–"})` : "현재 목표: 없음 — set_current_goal로 정한다",
    top ? `보충 중(${g.stack.length}겹): ${top.title} — ${top.done} (막힌 이유: ${top.why}). 학습자가 이해했다고 누르면 '${top.from}'로 돌아간다. 지금은 보충에 집중한다.` : "",
    g.survey ? "지금 화면에 질문을 띄워 두었다 — 학습자 답을 기다린다." : "",
    "이해 · 적용 · 다음으로는 학습자가 화면 버튼으로 정한다. 적용은 실행해서 확인할 수 있으면 확인을 도와준다.",
  ].filter(Boolean).join("\n");
}

/** 화면용 */
export async function goalsView(runId: string) {
  const g = await goalsOf(runId);
  const doneN = g.map.filter((m) => m.status === "done" || m.status === "skipped").length;
  return { ...g, log: g.log.slice(-8), progress: g.map.length ? { done: doneN, total: g.map.length } : { done: g.log.filter((l) => l.kind === "next").length, total: 0 }, stuckReasons: STUCK_REASONS };
}
