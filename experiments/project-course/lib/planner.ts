// course-planner 최소판(11/3, 구조도 "학습 경로 · course-planner"): 단계를 마칠 때 AI가 학습 상태를 보고 다음 경로를 제안한다.
// AI: 다음 / 보충 / 연습 / 심화 중 무엇을, 왜, 어떤 작은 과제로. 코드: 개념이 이 코스 것인지, 최종 목표·범위를 넘지 않는지 검사하고 경로에 기록한다.
// 작은 보충·연습·심화는 바로 제안하고(학습자가 건너뛸 수 있음), 목표·범위를 바꾸는 제안은 받지 않는다(그런 건 학습자에게 따로 묻는다 — 이번 판에는 없음).
import path from "node:path";
import { aiJson, S } from "./ai.ts";
import { loadCourse, stageOf, knowledgeName } from "./course.ts";
import { DATA, getRun, read, update } from "./store.ts";
import { addObservation, learnerView } from "./learner.ts";
import { events } from "./session.ts";

export type Decision = "next" | "remedial" | "practice" | "extend";
export type PathItem = { at: string; afterStage: number; decision: Decision; concept?: string; reason: string; task: string; status: "proposed" | "doing" | "done" | "skipped" };
type PathFile = { items: PathItem[] };
const file = (runId: string) => path.join(DATA, "path", `${runId}.json`);
export const pathOf = (runId: string) => read<PathFile>(file(runId), { items: [] });

const SYSTEM = `너는 코딩 학습 코스의 진행 담당(course-planner)이다. 학습자가 한 단계를 마쳤다. 학습 상태를 보고 다음 경로를 하나 고른다.
- next: 다음 단계로(기본값). 이해가 충분하면.
- remedial: 이번 단계 개념 중 약하거나 오개념이 보이는 것 하나를 짧게 보충.
- practice: 도움을 많이 받았거나 반복해서 막힌 개념 하나로 아주 작은 연습 과제.
- extend: 직접 빠르게 풀었으면 이번 단계를 조금 넓히는 작은 도전.
규칙: 최종 목표와 코스 범위는 바꾸지 않는다. concept는 [이 코스 개념]의 id 중 하나(next면 비움). reason은 학습자에게 보일 해요체 한 문장(칭찬·점수 없이 사실로). task는 학습자가 5분 안에 할 수 있는 한 가지(next면 비움). 근거가 약하면 next.`;
const SCHEMA = S.obj({ decision: S.oneOf("next", "remedial", "practice", "extend"), concept: S.str, reason: S.str, task: S.str });

/** 단계를 마칠 때 한 번: 제안을 만들고 검사해 경로에 남긴다. 같은 단계에 이미 제안이 있으면 그걸 돌려준다 */
export async function planAfterStage(runId: string, n: number): Promise<PathItem> {
  const existing = (await pathOf(runId)).items.find((i) => i.afterStage === n);
  if (existing) return existing;
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const st = stageOf(course, n);
  const v = await learnerView(runId, course);
  const p = run.stages[String(n)];
  const evs = (await events(runId)).filter((e) => e.stage === n).slice(-15);
  const outline = (course as { generated?: { goal: string; outline: { n: number; title: string }[] } }).generated;
  const user = [
    `[코스] ${course.title}${outline?.goal ? ` · 학습자 목표: ${outline.goal}` : ""}`,
    `[마친 단계] ${n}단계 ${st.title} — ${st.goal}`,
    `[다음 단계] ${(outline?.outline ?? course.stages).find((s) => s.n === n + 1)?.title ?? "없음(마지막)"}`,
    `[이 코스 개념] ${course.knowledge.map((k) => `${k.id}=${k.name}`).join(", ")}`,
    `[개념 상태] ${v.concepts.filter((c) => c.status !== "new").map((c) => `${c.id}: ${c.status}${c.verified ? "(검사로 확인)" : ""}${c.explained ? "(내 말로 함)" : ""} 근거 ${c.facts.slice(-3).join("/")}`).join("; ") || "근거 없음"}`,
    v.misconceptions.length ? `[오개념 관찰] ${v.misconceptions.map((m) => `${m.concept ?? "?"}: ${m.note}`).join(" / ")}` : "",
    `[이번 단계 사실] 힌트 ${p?.hints.length ? Math.max(...p.hints.map((h) => h.level)) : 0}단계까지 · 검사 ${p?.runs.length ?? 0}번 · ${p?.independent ? "직접 통과" : "도움받아 통과"}`,
    `[최근 기록] ${evs.map((e) => `${e.type}:${e.detail.slice(0, 60)}`).join(" | ")}`,
  ].filter(Boolean).join("\n");
  let out: { decision: Decision; concept: string; reason: string; task: string };
  try { out = await aiJson("course-planner", SYSTEM, user, SCHEMA); }
  catch { out = { decision: "next", concept: "", reason: "", task: "" }; }
  const item = validate(course, n, out);
  await update<PathFile>(file(runId), { items: [] }, (f) => { if (!f.items.some((i) => i.afterStage === n)) f.items.push(item); });
  return item;
}

/** 코드가 지키는 것: 개념은 이 코스 것, 과제가 비면 다음으로, 글 길이 제한 */
export function validate(course: { knowledge: { id: string; name: string }[] }, n: number, out: { decision: string; concept?: string; reason?: string; task?: string }): PathItem {
  const decision = (["next", "remedial", "practice", "extend"].includes(out.decision) ? out.decision : "next") as Decision;
  const concept = course.knowledge.find((k) => k.id === out.concept || k.name === out.concept)?.id;
  const task = String(out.task ?? "").trim().slice(0, 160);
  const ok = decision === "next" || (task.length >= 4 && (decision === "extend" || concept));
  return { at: new Date().toISOString(), afterStage: n, decision: ok ? decision : "next", concept: ok && decision !== "next" ? concept : undefined,
    reason: String(out.reason ?? "").trim().slice(0, 200), task: ok && decision !== "next" ? task : "", status: ok && decision !== "next" ? "proposed" : "done" };
}

export async function setStatus(runId: string, n: number, status: PathItem["status"]) {
  await update<PathFile>(file(runId), { items: [] }, (f) => { const i = f.items.find((x) => x.afterStage === n); if (i) i.status = status; });
}

const KIND = { remedial: "보충", practice: "연습", extend: "심화" } as const;
/** 튜터에게 넘길 지시(학습자가 [해 볼게요]를 누르면): 짧은 설명 + 학습자가 직접 하는 작은 과제 하나, 정답은 바로 주지 않기 */
export async function taskPrompt(runId: string, item: PathItem) {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const name = item.concept ? knowledgeName(course, item.concept) : "";
  const kind = item.decision === "next" ? "" : KIND[item.decision];
  return `[${kind} 과제 — course-planner 제안] ${item.task}${name ? ` (개념: ${name})` : ""}\n필요하면 한두 문장으로 짚고, 학습자가 직접 해 볼 아주 작은 과제 하나를 내 주세요. 정답은 바로 주지 말고, 학습자가 답하면 run_snippet이나 send_request로 같이 확인해요. 끝나면 학습자가 [다음 단계]를 누르면 된다고 알려 주세요.`;
}
export const kindLabel = (d: Decision) => (d === "next" ? "다음 단계" : KIND[d]);

/* ---------- 개념 검증: "내 말로" 답 보기(11/3) ---------- */
const JUDGE = `학습자가 코딩 개념을 자기 말로 설명했다. 맞는지 본다. 채점하지 않고 관찰만 한다.
- verdict: understood(핵심이 맞음) · confused(빠지거나 흐림) · misconception(틀린 생각이 들어 있음)
- concept: [이 단계 개념] id 중 가장 관련된 하나
- note: 무엇을 봤는지 한 문장(해요체 말고 관찰문, 예: "라우터가 메서드와 주소로 함수를 찾는다고 정확히 설명함")`;
const JUDGE_SCHEMA = S.obj({ verdict: S.oneOf("understood", "confused", "misconception"), concept: S.str, note: S.str });
export async function judgeExplain(runId: string, n: number, text: string) {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const st = stageOf(course, n);
  const out = await aiJson<{ verdict: "understood" | "confused" | "misconception"; concept: string; note: string }>("explain-judge", JUDGE,
    [`[질문] ${st.explain.q}`, `[이 단계 개념] ${st.knowledge.map((k) => `${k}=${knowledgeName(course, k)}`).join(", ")}`, `[학습자 답] ${text.slice(0, 600)}`].join("\n"), JUDGE_SCHEMA);
  const concept = course.knowledge.find((k) => k.id === out.concept)?.id;
  if (!out.note?.trim()) return null;
  return addObservation(runId, { concept, kind: out.verdict, note: `내 말로: ${out.note.trim().slice(0, 200)}`, stage: n });
}
