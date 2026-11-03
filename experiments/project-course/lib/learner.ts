// 학습 상태 모델(11/3, 구조도 "학습 상태"): 개념별 상태 · 오개념 · 검증 여부.
// 사실(예측 맞힘/틀림, 검사 통과, 누가 고쳤나, 힌트, 내 말로)은 학습 사건에서 코드가 뽑는다 → verified 근거.
// AI가 본 것(이해한 듯 · 헷갈림 · 오개념)은 관찰로 따로 남기고 "검증 안 됨"으로 둔다. 관찰만으로 상태를 올리지 않는다.
import path from "node:path";
import { DATA, read, update } from "./store.ts";
import { events, type LearningEvent } from "./session.ts";

export type ConceptStatus = "new" | "learning" | "understood" | "weak";
export type Observation = { at: string; concept?: string; kind: "understood" | "confused" | "misconception"; note: string; stage?: number };
export type ConceptState = {
  id: string; name: string; status: ConceptStatus;
  /** 코드가 확인한 근거가 있는가(검사 통과를 학습자가 직접) */
  verified: boolean;
  explained: boolean;
  facts: string[];
  observations: Observation[];
};
export type LearnerView = { concepts: ConceptState[]; misconceptions: Observation[]; observations: Observation[] };

const file = (runId: string) => path.join(DATA, "learner", `${runId}.json`);
type Store = { observations: Observation[] };

export async function addObservation(runId: string, o: Omit<Observation, "at">) {
  const obs: Observation = { at: new Date().toISOString(), ...o, note: String(o.note).slice(0, 300) };
  await update<Store>(file(runId), { observations: [] }, (s) => { s.observations.push(obs); s.observations = s.observations.slice(-200); });
  return obs;
}

/** 사건 하나가 개념에 주는 사실(코드 판정). 없으면 null */
export function factOf(e: LearningEvent): { kind: "right" | "wrong" | "passSelf" | "passHelped" | "explained" | "hint"; text: string } | null {
  const d = e.detail ?? "";
  if (e.type === "verify" && /^예측 맞힘/.test(d)) return { kind: "right", text: "예측 맞힘" };
  if (e.type === "verify" && /^예측 틀림/.test(d)) return { kind: "wrong", text: "예측 틀림" };
  if (e.type === "application") {
    if (e.actor !== "user" || /정답 줄 보고|튜터가 고침/.test(d)) return { kind: "passHelped", text: d.replace(/^단계 검사 통과 · /, "통과(") + ")" };
    return { kind: "passSelf", text: d.replace(/^단계 검사 통과 · /, "통과(") + ")" };
  }
  if (e.type === "self_report" && /^내 말로:/.test(d)) return { kind: "explained", text: "내 말로 설명함" };
  return null;
}

/** 개념별 상태: 사실만으로 정한다(마지막 사실이 이긴다). 통과(직접) → 이해·검증, 틀림·도움받아 통과 → 약함, 그 밖에 근거가 있으면 학습 중 */
export function deriveLearner(course: { knowledge: { id: string; name: string }[] }, evs: LearningEvent[], obs: Observation[]): LearnerView {
  const concepts: ConceptState[] = course.knowledge.map((k) => ({ id: k.id, name: k.name, status: "new", verified: false, explained: false, facts: [], observations: [] }));
  const byId = new Map(concepts.map((c) => [c.id, c]));
  for (const e of evs) {
    const f = factOf(e);
    if (!f || !e.concepts?.length) continue;
    for (const id of e.concepts) {
      const c = byId.get(id); if (!c) continue;
      c.facts.push(`${e.stage}단계 ${f.text}`);
      if (f.kind === "explained") { c.explained = true; if (c.status === "new") c.status = "learning"; continue; }
      if (f.kind === "passSelf") { c.status = "understood"; c.verified = true; }
      else if (f.kind === "wrong" || f.kind === "passHelped") { c.status = "weak"; if (f.kind === "passHelped") c.verified = false; }
      else if (f.kind === "right" && c.status !== "understood") c.status = "learning";
    }
  }
  for (const o of obs) { const c = o.concept ? byId.get(o.concept) : undefined; if (c) c.observations.push(o); }
  return { concepts, misconceptions: obs.filter((o) => o.kind === "misconception").slice(-5), observations: obs.slice(-10) };
}

export async function learnerView(runId: string, course: { knowledge: { id: string; name: string }[] }) {
  const [evs, st] = await Promise.all([events(runId), read<Store>(file(runId), { observations: [] })]);
  return deriveLearner(course, evs, st.observations);
}

const LABEL: Record<ConceptStatus, string> = { new: "처음", learning: "배우는 중", understood: "이해", weak: "약함" };
/** 튜터 맥락 한 줄: 근거 있는 개념만, 그리고 오개념(관찰) */
export function learnerLine(v: LearnerView) {
  const seen = v.concepts.filter((c) => c.status !== "new");
  const parts = seen.map((c) => `${c.name} ${LABEL[c.status]}${c.verified ? "(검사로 확인)" : ""}${c.explained ? "·내 말로 함" : ""}`);
  const mis = v.misconceptions.map((m) => m.note);
  if (!parts.length && !mis.length) return "";
  return `[개념] ${parts.join(" · ") || "아직 근거 없음"}${mis.length ? `\n[오개념(튜터 관찰, 검증 안 됨)] ${mis.join(" / ")}` : ""}`;
}
