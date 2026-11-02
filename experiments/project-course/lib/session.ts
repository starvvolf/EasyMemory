// 학습 진행 엔진의 바탕 (2026-11-03, 사용자 설계안 v0.1 11장 · docs/코딩학습에이전트_구현대응.md)
// - 세션: 지금 단계 · 지금 활동(행동 7종) · 임시 학습 스택(질문하러 갔다가 돌아갈 곳) · 레벨(튜터 내부 설정, DECISIONS 11/3)
// - 학습 사건: 진행 중에 바로 한 줄씩 덧붙인다(갑자기 꺼져도 안 사라짐). 누가 했는지(actor)를 꼭 남긴다.
// 상태는 코드가 바꾸고, LLM은 이걸 읽고 문장만 쓴다(설계안 17장 셋째).
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DATA, read, update } from "./store.ts";

/** 설계안 4.1 행동 7종 */
export type Action = "explain" | "demo" | "guide" | "diagnose" | "verify" | "navigate" | "summarize";
export type Detour = { topic: string; reason: string; returnBeat: number; returnLabel: string; at: string };
export type Session = {
  runId: string;
  goal: string;
  currentStep: number;
  activity: { type: Action; target: string; status: "active" | "paused" | "done" };
  detours: Detour[];
  /** 튜터 내부 설정(L0 처음 ~ L6 기능). 학습자에게 점수로 보이지 않는다 */
  level: number;
  status: "active" | "paused" | "completed";
  updatedAt: string;
};
/** 임시 학습은 이보다 깊어지면 "목표를 다시 잡을까요?"를 띄운다(설계안 11.2 끝) */
export const MAX_DETOUR = 3;

export type EventType = "question" | "confusion" | "explanation" | "demo" | "code_edit" | "execution" | "self_report" | "application" | "verify" | "navigate";
export type Actor = "user" | "agent" | "system";
export type LearningEvent = {
  id: string; at: string; runId: string; stage: number; beat?: number;
  type: EventType; actor: Actor;
  /** 코스 개념 id(있을 때) 또는 개념 후보 이름 */
  concepts?: string[];
  detail: string;
  /** 근거: 메시지 id, 파일:줄 */
  evidence?: string[];
};

const sessionFile = (runId: string) => path.join(DATA, "sessions", `${runId}.json`);
export const eventsFile = (runId: string) => path.join(DATA, "events", `${runId}.jsonl`);
const now = () => new Date().toISOString();
const blank = (runId: string, goal = ""): Session => ({ runId, goal, currentStep: 0, activity: { type: "explain", target: "", status: "active" }, detours: [], level: 0, status: "active", updatedAt: now() });

export async function getSession(runId: string) { return read<Session>(sessionFile(runId), blank(runId)); }
export function changeSession(runId: string, fn: (s: Session) => void) {
  return update<Session>(sessionFile(runId), blank(runId), (s) => { fn(s); s.updatedAt = now(); });
}

/** 대본 걸음 종류 → 행동 (구현대응 2.2) */
export function actionOfBeat(b: { kind: string; actions?: { do: string }[]; after?: { do: string }[] } | undefined, last = false): Action {
  if (!b) return "navigate";
  if (b.kind === "predict") return "verify";
  if (b.kind === "fix") return "guide";
  if (b.kind === "explain") return "summarize";
  if (b.kind === "map") return "explain";
  if (last) return "summarize";
  const acts = [...(b.actions ?? []), ...(b.after ?? [])];
  if (acts.some((a) => a.do.includes("try") || a.do === "db" || a.do === "observe")) return "demo";
  return "explain";
}

/** 걸음에 들어감: 지금 활동을 바꾸고, 하던 임시 학습은 끝난 것으로(순서가 넘어갔으니) */
export function enterBeat(runId: string, step: number, beat: number, action: Action, target: string) {
  return changeSession(runId, (s) => {
    s.currentStep = step;
    s.activity = { type: action, target, status: "active" };
    if (s.detours.length) s.detours = [];
    void beat;
  });
}

/** 임시 학습 시작(질문 · 이건 뭐예요 · 덩어리 설명 · 막힘). 깊이를 돌려준다 */
export async function pushDetour(runId: string, d: Omit<Detour, "at">) {
  const s = await changeSession(runId, (st) => {
    st.detours.push({ ...d, topic: d.topic.slice(0, 80), at: now() });
    if (st.detours.length > 6) st.detours = st.detours.slice(-6);
    st.activity = { type: "explain", target: d.topic.slice(0, 80), status: "active" };
  });
  return { depth: s.detours.length, deep: s.detours.length > MAX_DETOUR };
}
/** 하던 거로 돌아가기: 임시 학습을 모두 닫는다(돌아갈 곳은 가장 처음 들어온 곳) */
export async function closeDetours(runId: string, back?: { type: Action; target: string }) {
  let first: Detour | undefined;
  await changeSession(runId, (s) => { first = s.detours[0]; s.detours = []; s.activity = back ? { ...back, status: "active" } : { type: "navigate", target: first?.returnLabel ?? "", status: "done" }; });
  return first;
}

let seq = 0;
/** 학습 사건 한 줄 덧붙이기. 실패해도 수업은 멈추지 않는다 */
export function record(ev: Omit<LearningEvent, "id" | "at">) {
  const line: LearningEvent = { id: `${Date.now().toString(36)}${(seq++ % 1296).toString(36).padStart(2, "0")}`, at: now(), ...ev, detail: ev.detail.slice(0, 600) };
  const file = eventsFile(ev.runId);
  return mkdir(path.dirname(file), { recursive: true }).then(() => appendFile(file, JSON.stringify(line) + "\n")).then(() => line).catch(() => line);
}
export async function events(runId: string): Promise<LearningEvent[]> {
  try { return (await readFile(eventsFile(runId), "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}

/** 화면·튜터 맥락에 줄 세션 요약 */
export async function sessionView(runId: string) {
  const s = await getSession(runId);
  return { activity: s.activity, detours: s.detours.map((d) => ({ topic: d.topic, reason: d.reason, returnLabel: d.returnLabel })), deep: s.detours.length > MAX_DETOUR, level: s.level };
}
