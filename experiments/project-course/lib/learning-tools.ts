// 튜터의 학습 도구(11/3, 구조도 "학습 도구" · 설계 글 6절): 튜터가 필요할 때 불러 코스·진도·과제·기록을 본다.
// 읽기 넷 + 관찰 남기기. 단계를 끝내거나 진도를 바꾸는 도구는 주지 않는다(통과 판정은 검사기 = run_checks).
import { loadCourse, stageOf, knowledgeName } from "./course.ts";
import { getRun } from "./store.ts";
import { events } from "./session.ts";
import { addObservation, learnerView, type Observation } from "./learner.ts";

const LABEL = { new: "처음", learning: "배우는 중", understood: "이해", weak: "약함" } as const;

export async function getCourse(runId: string) {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const outline = (course as { generated?: { goal: string; outline: { n: number; title: string; goal: string }[] } }).generated;
  const stages = outline?.outline ?? course.stages.filter((s) => !s.transfer).map((s) => ({ n: s.n, title: s.title, goal: s.goal }));
  return [`코스: ${course.title}`, outline?.goal ? `학습자 목표: ${outline.goal}` : "", `지금: ${run.current}단계`,
    ...stages.map((s) => `${s.n}. ${s.title} — ${s.goal}${s.n === run.current ? " (지금)" : run.stages[String(s.n)]?.doneAt ? " (끝냄)" : ""}`)].filter(Boolean).join("\n");
}

export async function getProgress(runId: string) {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const v = await learnerView(runId, course);
  const done = Object.entries(run.stages).filter(([, p]) => p.doneAt).map(([n, p]) => `${n}단계(${p.independent ? "직접" : "도움받음"})`);
  const lines = v.concepts.filter((c) => c.status !== "new").map((c) => `- ${c.name}: ${LABEL[c.status]}${c.verified ? ", 검사로 확인" : ""}${c.explained ? ", 내 말로 설명함" : ""} — 근거: ${c.facts.slice(-3).join(", ") || "없음"}${c.observations.length ? ` / 튜터 관찰: ${c.observations.slice(-2).map((o) => o.note).join("; ")}` : ""}`);
  return [`끝낸 단계: ${done.join(", ") || "없음"}`, `지금 단계: ${run.current}`, "개념(사실은 코드가, 관찰은 튜터가 남긴 것 · 관찰은 검증 안 됨):", ...(lines.length ? lines : ["- 아직 근거 없음"]),
    v.misconceptions.length ? `오개념 관찰: ${v.misconceptions.map((m) => m.note).join(" / ")}` : ""].filter(Boolean).join("\n");
}

export async function getStep(runId: string, n: number) {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const st = stageOf(course, n);
  const p = run.stages[String(n)];
  const checks = course.checks.filter((c) => c.stage === n && c.target !== false).map((c) => `- ${c.title}`);
  const last = p?.runs.at(-1);
  return [`${n}단계 ${st.title}`, `목표: ${st.goal}`, `학습자가 직접 고칠 곳: ${st.fix.text} (파일: ${st.fix.files.join(", ")})`,
    `통과 기준(자동 검사):`, ...(checks.length ? checks : ["- (검사 목록 없음)"]),
    `이 단계 개념: ${st.knowledge.map((k) => knowledgeName(course, k)).join(", ")}`,
    last ? `마지막 검사: ${last.passed}개 통과, ${last.failed}개 실패` : "아직 검사 안 함",
    p?.hints.length ? `본 힌트: ${p.hints.map((h) => h.level).join(", ")}단계` : "",
    "완성 코드는 학습자가 분명히 부탁할 때만 보여 준다."].filter(Boolean).join("\n");
}

export async function getLearningHistory(runId: string) {
  const evs = (await events(runId)).slice(-20);
  if (!evs.length) return "아직 기록이 없어요.";
  return evs.map((e) => `${e.at.slice(11, 16)} ${e.stage}단계 ${e.type}(${e.actor === "user" ? "학습자" : e.actor === "agent" ? "튜터" : "시스템"}): ${e.detail.slice(0, 120)}`).join("\n");
}

export async function recordObservation(runId: string, n: number, input: { concept?: unknown; kind?: unknown; note?: unknown }) {
  const run = await getRun(runId);
  const course = await loadCourse(run.courseId);
  const kind = ["understood", "confused", "misconception"].includes(String(input.kind)) ? String(input.kind) as Observation["kind"] : null;
  if (!kind) return { ok: false, text: "kind는 understood · confused · misconception 중 하나예요." };
  const note = String(input.note ?? "").trim();
  if (note.length < 4) return { ok: false, text: "무엇을 봤는지 한 문장으로 적어 주세요." };
  const c = String(input.concept ?? "");
  const concept = course.knowledge.find((k) => k.id === c || k.name === c)?.id;
  const o = await addObservation(runId, { concept, kind, note, stage: n });
  return { ok: true, text: `남겼어요(${kind}${concept ? `, ${knowledgeName(course, concept)}` : ""}). 관찰은 검증 안 됨으로 남고 진도를 바꾸지 않아요.`, obs: o };
}
