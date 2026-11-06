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

/** support: [너무 어려워요]로 끼워 넣은 보충 단계(11/6 사용자 "중간에 보충 단계를 만들어서 넣어 줘야") — 원래 단계 바로 앞에 들어간다 */
type Item = { id: string; title: string; status: "todo" | "doing" | "done" | "skipped"; support?: boolean };
type Current = { id: string; title: string; done: string; understood: boolean; applied: boolean; mapId?: string; at: string };
type Support = { id: string; title: string; done: string; why: string; from: string; understood?: boolean; at: string; mapId?: string };
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
  { name: "propose_plan", description: "좁혀진 내용으로 장기 목표를 제안한다. 학습자가 [확정]을 누르면 장기 목표 · 방식 · 지도 · 첫 현재 목표가 정해진다. map은 큰 단계 제목: topdown이면 3~6개, bottomup이면 지금 보이는 첫 몇 단계만(넓혀 가며 update_map으로 더한다). first는 첫 현재 목표와 완료 조건(학습자가 확인할 수 있는 한 문장).",
    properties: { long: str, spec: str, mode: { type: "string", enum: ["topdown", "bottomup"] }, map: { type: "array", items: str }, first: { type: "object", additionalProperties: false, properties: { title: str, done: str }, required: ["title", "done"] } }, required: ["long", "spec", "mode", "map", "first"] },
  { name: "set_current_goal", description: "다음 현재 목표와 완료 조건을 정한다. 학습자가 [다음으로]를 눌러 앞 목표가 끝났을 때 쓴다. 탑다운이면 지도의 다음 단계를 지금 할 만큼 구체적으로.",
    properties: { title: str, done: str }, required: ["title", "done"] },
  { name: "open_support", description: "막힌 곳을 메우는 보충 목표를 연다(현재 목표는 미뤄 둠). 학습자가 [막혔어요]로 이유를 보냈을 때, 또는 학습자 말에서 막힘이 분명할 때(why_quote에 그 말을 글자 그대로). 보충은 작게, 원래 목표로 돌아가는 데 필요한 만큼.",
    properties: { title: str, done: str, why_quote: str }, required: ["title", "done", "why_quote"] },
  { name: "update_map", description: "지도의 남은 단계 제목을 고친다(끝난 · 하는 중 단계는 그대로 두고 titles에는 남은 단계만). 진행하다 계획이 달라졌거나, 바텀업에서 넓혀 갈 방향이 보일 때.",
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
      // 11/6 사용자 "지도는 어떤 상황에서도 있는 게 좋겠다, 가끔 갱신": 바텀업도 지도를 둔다(비면 첫 목표로 시작)
      const map = (Array.isArray(input.map) ? input.map : []).map((t: unknown) => s(t, 80)).filter(Boolean).slice(0, 8);
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
      if (g.current && last !== "next" && last !== "confirm" && last !== "easy") throw err("현재 목표가 진행 중이에요. 학습자가 [다음으로]를 누르면 바꿀 수 있어요.");
      let item = g.map.find((m) => m.status === "doing" && !m.support) ?? g.map.find((m) => m.status === "todo" && !m.support);
      // 지도에 남은 단계가 없으면(바텀업으로 넓혀 가는 중 등) 이 목표를 지도 끝에 더한다 → 지도는 늘 지나온 길 + 남은 길
      if (!item) { item = { id: nid(), title: s(input.title, 80), status: "doing" }; g.map.push(item); }
      // 같은 단계에서 목표를 다시 정하면(너무 쉬워요 등, 11/6 "목표 수준 올렸을 때 맵에 반영이 안 됨") 바텀업은 단계 = 목표라 지도 제목도 바꾼다.
      // 탑다운 단계는 목표보다 큰 묶음이라 제목을 그대로 둔다(남은 단계는 튜터가 update_map으로)
      else if (item.status === "doing" && g.mode !== "topdown") item.title = s(input.title, 80);
      item.status = "doing";
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
      // 지도에도 보충 단계로 끼운다: 돌아갈 단계(위 보충 또는 현재 목표의 단계) 바로 앞
      const parent = g.stack.at(-1)?.mapId ?? g.current?.mapId;
      const sup: Item = { id: nid(), title: s(input.title, 80), status: "doing", support: true };
      const at = g.map.findIndex((m) => m.id === parent);
      if (at >= 0) g.map.splice(at, 0, sup); else g.map.push(sup);
      g.stack.push({ id: nid(), title: s(input.title, 120), done: s(input.done, 200), why, from, at: now(), mapId: sup.id });
      g.stuck = null;
      logIt(g, "support", g.stack.at(-1)!.title);
      out = `보충을 열었어요: ${g.stack.at(-1)!.title}. 이제 바로 설명을 시작하세요. 학습자가 이해했다고 누르면 '${from}'로 돌아가요.`;
    } else if (name === "update_map") {
      const kept = g.map.filter((m) => m.status !== "todo");
      // 끝난 · 하는 중 단계와 같은 제목을 또 보내면 뺀다(처음부터 다시 도는 것 막기)
      const keptT = new Set(kept.map((m) => norm(m.title)));
      const titles = (Array.isArray(input.titles) ? input.titles : []).map((t: unknown) => s(t, 80)).filter((t: string) => t && !keptT.has(norm(t))).slice(0, 8);
      g.map = [...kept, ...titles.map((t) => ({ id: nid(), title: t, status: "todo" as const }))];
      logIt(g, "map", titles.join(" / "));
      out = `남은 단계를 고쳤어요: ${titles.join(" → ")}`;
    } else throw err("없는 도구예요.");
  });
  return out;
}

/* ---------- 학습자 버튼(코드) ---------- */
export const STUCK_REASONS = Object.values(CHOICES).map((c) => c.label);
// 너무 어려워요(11/5)는 이유를 안 골라도 된다
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
      g.map = (p.map.length ? p.map : [p.first.title]).map((t, i) => ({ id: nid(), title: t, status: i === 0 ? "doing" : "todo" }));
      g.current = { id: nid(), title: p.first.title, done: p.first.done, understood: false, applied: false, mapId: g.map[0]?.id, at: now() };
      g.plan = null; g.stack = [];
      logIt(g, "confirm", p.long);
      say = `[확정] 계획을 확정했어요. 첫 현재 목표 "${p.first.title}"부터 시작해 주세요.`;
    } else if (op === "dismiss_plan") { g.plan = null; logIt(g, "plan-dismiss", ""); say = "[계획 다시 얘기하기] 제안한 계획은 아직 확정하지 않을게요. 어디를 바꾸면 좋을지 짧게 물어봐 주세요."; }
    else if (op === "understood" || op === "applied") {
      const top = g.stack.at(-1);
      if (top && op === "understood") { // 보충은 이해만 하면 돌아간다
        g.stack.pop(); logIt(g, "support-done", top.title);
        const sm = g.map.find((m) => m.id === top.mapId); if (sm) sm.status = "done";
        say = null;
      } else if (g.current && op === "understood" && !g.current.understood) {
        // 11/5 사용자 "목표마다 이해 → 적용 흐름이 있으면 좋겠다": 이해했어요 → 적용 단계로, 튜터가 직접 해 볼 과제를 낸다
        g.current.understood = true; logIt(g, "understood", g.current.title);
        say = `[이해했어요] "${g.current.title}"을(를) 이해했어요. 이제 적용 단계예요. 완료 조건("${g.current.done}")을 학습자가 직접 해 볼 수 있는 작은 과제 하나를 내 주세요. 완성 코드는 주지 말고, 막히면 힌트만 주세요.`;
      } else if (g.current && op === "applied" && !g.current.applied) {
        g.current.applied = true; if (!g.current.understood) g.current.understood = true; logIt(g, "applied", g.current.title);
        say = b.codeSaved === false ? null : `[해 봤어요] 학습자가 "${g.current.title}" 적용 과제를 해 봤어요. 작업 폴더의 파일을 읽거나 실행해서 확인할 수 있으면 확인하고, 됐으면 짧게 알려 주세요. 안 됐으면 어디가 문제인지 짚어 주세요.`;
      }
    } else if (op === "next" || op === "easy_next") {
      // easy_next(11/6 사용자 "너무 쉬워요 → 엎거나 다음으로 넘어간다"): 이미 아는 것 → 이 단계는 끝남으로 보고 다음으로
      if (!g.current) throw err("현재 목표가 없어요.");
      const c = g.current; const easy = op === "easy_next"; const full = easy || (c.understood && c.applied);
      const item = g.map.find((m) => m.id === c.mapId);
      if (item) item.status = full ? "done" : "skipped";
      logIt(g, "next", `${c.title}: ${easy ? "너무 쉬워서 넘어감" : full ? "마침" : `건너뜀(이해 ${c.understood ? "✓" : "–"}, 적용 ${c.applied ? "✓" : "–"})`}`);
      for (const m of g.map) if (m.support && m.status === "doing") m.status = "skipped";
      g.stack = [];
      const nextItem = g.map.find((m) => m.status === "todo" && !m.support);
      const head = easy ? `[너무 쉬워요 → 다음으로] "${c.title}"은(는) 이미 알아요. 다음은 이보다 한 단계 높여 주세요.` : "";
      say = head ? `${head} ${nextItem ? `지도의 다음 단계는 "${nextItem.title}"이에요. ` : ""}set_current_goal로 지금 할 만큼 구체적인 현재 목표와 완료 조건을 정하고 바로 시작해 주세요.` : g.mode === "topdown"
        ? nextItem ? `[다음으로] "${c.title}"을(를) ${full ? "마쳤어요" : "여기까지 하고 넘어갈게요"}. 지도의 다음 단계는 "${nextItem.title}"이에요. set_current_goal로 지금 할 만큼 구체적인 현재 목표와 완료 조건을 정하고 바로 시작해 주세요.`
          : `[다음으로] "${c.title}"을(를) ${full ? "마쳤어요" : "여기까지 하고 넘어갈게요"}. 지도의 단계를 다 지났어요. 장기 목표가 다 됐는지 같이 보고, 더 할 게 있으면 update_map으로 단계를 더한 뒤 set_current_goal로 정해 주세요.`
        : `[다음으로] "${c.title}"을(를) ${full ? "마쳤어요" : "여기까지 하고 넘어갈게요"}. 여기서 넓혀 볼 다음 작은 것을 하나 정해 set_current_goal로 정하고 바로 시작해 주세요.`;
    } else if (op === "end") {
      // 학습 종료(11/6): 하던 목표는 지금까지로 닫고(정리는 lesson.ts가), 튜터는 안 부른다
      const c = g.current;
      if (c) { const item = g.map.find((m) => m.id === c.mapId); if (item) item.status = c.understood && c.applied ? "done" : "skipped"; }
      logIt(g, "end", c ? `${c.title}: ${c.understood && c.applied ? "마침" : `건너뜀(이해 ${c.understood ? "✓" : "–"}, 적용 ${c.applied ? "✓" : "–"})`}` : "");
      for (const m of g.map) if (m.support && m.status === "doing") m.status = "skipped";
      g.current = null; g.stack = []; g.stuck = null;
      say = null;
    } else if (op === "easy") {
      // 11/5 사용자 "너무 쉬워 / 너무 어려워 두 개가 막혔어요보다 낫다": 쉬우면 수준을 올리고, 필요하면 현재 목표를 더 어렵게 다듬게 한다
      logIt(g, "easy", g.stack.at(-1)?.title ?? g.current?.title ?? "");
      const at = g.stack.at(-1)?.title ?? g.current?.title ?? "지금 하던 것";
      say = `[너무 쉬워요 → 더 어렵게] 지금 "${at}"이(가) 너무 쉬워요. 이미 아는 부분은 건너뛰고 수준을 올려 주세요.${g.current && !g.stack.length ? " 현재 목표가 너무 쉬우면 set_current_goal로 더 어려운 목표와 완료 조건으로 다듬어도 돼요." : ""}${g.map.some((m) => m.status === "todo") ? " 지도의 남은 단계도 이 학습자에게 쉬워 보이면 update_map으로 수준에 맞게 고쳐 주세요." : ""}`;
    } else if (op === "stuck" || op === "hard") {
      const reasons = (Array.isArray(b.reasons) ? b.reasons : []).map((r) => String(r)).filter((r) => STUCK_REASONS.includes(r));
      const text = String(b.text ?? "").trim().slice(0, 500);
      if (op === "stuck" && !reasons.length && !text) throw err("막힌 이유를 하나 이상 고르거나 적어 주세요.");
      if (!reasons.length && !text) reasons.push("너무 어려워요(어디가 어려운지는 모르겠어요)");
      g.stuck = { reasons, text, at: now() };
      logIt(g, "stuck", [...reasons, text].join(" · "));
      const at = g.stack.at(-1)?.title ?? g.current?.title ?? "지금 하던 것";
      say = `[너무 어려워요] 지금: "${at}". 어려운 이유(학습자가 고름): ${[...reasons, text ? `덧붙임: ${text}` : ""].filter(Boolean).join(" · ")}\n학습자는 뭘 모르는지 정확히 모를 수 있어요. 이유를 보고 먼저 알아야 할 것을 open_support로 작은 보충 목표로 열고, 바로 설명을 시작해 주세요.`;
    } else if (op === "mode") {
      if (b.mode !== "topdown" && b.mode !== "bottomup") throw err("mode는 topdown 또는 bottomup이에요.");
      g.mode = b.mode; logIt(g, "mode", b.mode);
      // 바텀업에서 하던 목표가 지도에 안 붙어 있으면(예전 진행) 지금 붙인다 — 탑다운 지도가 1단계부터 다시 돌지 않게(11/6 찐빠)
      if (g.current && !g.map.some((m) => m.id === g.current!.mapId)) { const it = { id: nid(), title: g.current.title.slice(0, 80), status: "doing" as const }; g.map.push(it); g.current.mapId = it.id; }
      const left = g.map.some((m) => m.status === "todo");
      say = `[진행 방식 변경] 이제부터 ${b.mode === "topdown" ? "탑다운(구조부터 보고, 지도를 따라)" : "바텀업(작은 것 하나부터 넓혀 가기)"}으로 가요.${b.mode === "topdown" && !left ? " 지도의 지나온 단계는 그대로 두고, 장기 목표까지 남은 큰 단계를 update_map으로 정해 주세요. 지금 하던 목표는 이어서 해요." : ""}`;
    } else throw err("모르는 동작이에요.");
  });
  return say;
}

/* ---------- 매 차례 맥락(두 엔진 공통) ---------- */
export async function goalContext(runId: string) {
  // 학습자 메모리(11/6): 진행 방식 · 경향을 매 차례 맨 앞에(두 엔진 같게)
  const mem = await (await import("./memory.ts")).memoryText().catch(() => "");
  const body = await goalContextBody(runId);
  return mem ? `${mem}\n\n${body}` : body;
}
async function goalContextBody(runId: string) {
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
    g.map.length ? `지도: ${g.map.map((m, i) => `${i + 1}.${mark(m)} ${m.support ? "(보충) " : ""}${m.title}`).join(" · ")}` : "",
    c ? `현재 목표: ${c.title} — 완료 조건: ${c.done} · 단계: ${!c.understood ? "① 이해 중" : !c.applied ? "② 적용 중(학습자가 직접 해 보는 중)" : "적용까지 끝(학습자가 다음으로 넘어갈 수 있음)"}` : "현재 목표: 없음 — set_current_goal로 정한다",
    top ? `보충 중(${g.stack.length}겹): ${top.title} — ${top.done} (막힌 이유: ${top.why}). 학습자가 이해했다고 누르면 '${top.from}'로 돌아간다. 지금은 보충에 집중한다.` : "",
    g.survey ? "지금 화면에 질문을 띄워 두었다 — 학습자 답을 기다린다." : "",
    (() => { const r = g.log.slice(-12); const e = r.filter((l) => l.kind === "easy").length, h = r.filter((l) => l.kind === "stuck").length; return e || h ? `최근 학습자 표시: 너무 쉬움 ${e}번 · 너무 어려움 ${h}번 — 설명 수준을 여기에 맞춘다.` : ""; })(),
    "목표마다 ① 이해 → ② 적용 순서로 간다. 이해 단계에서는 설명과 예시로 이해를 돕고, 학습자가 [이해했어요]를 누르면 적용 과제를 낸다. [해 봤어요]가 오면 실행 · 파일로 확인을 돕는다. 단계를 넘기는 건 학습자가 화면 버튼으로 하므로, 버튼 안내는 그 단계가 끝날 무렵 한 번이면 충분하다.",
  ].filter(Boolean).join("\n");
}

/** 화면용 */
export async function goalsView(runId: string) {
  const g = await goalsOf(runId);
  const doneN = g.map.filter((m) => m.status === "done" || m.status === "skipped").length;
  return { ...g, log: g.log.slice(-8), progress: g.map.length ? { done: doneN, total: g.map.length } : { done: g.log.filter((l) => l.kind === "next").length, total: 0 }, stuckReasons: STUCK_REASONS };
}
