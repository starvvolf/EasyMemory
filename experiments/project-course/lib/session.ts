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
  /** 레벨 판정용 연속 횟수(해냄 / 버거움)와 이 단계에서 "알아요"를 누른 수 */
  streak?: { up: number; down: number };
  knownSkips?: number;
  /** 재개 요약을 본 시각(이 뒤에 쌓인 사건이 없으면 다시 안 보여 준다) */
  recapSeenAt?: string;
  /** 학습자 배경(11/3 사용자 "TS 알아요? → JS는? → Python은?"): 스스로 답한 것. 처음 레벨과 튜터 맥락에 쓴다 */
  background?: Background;
  status: "active" | "paused" | "completed";
  updatedAt: string;
};
/** 레벨 이름(내부). 설명 단위·과제 크기를 정하는 데만 쓴다 */
export const LEVELS = ["L0 처음 · 조각 단위로 풀어 줌, 빈칸 하나", "L1 줄 읽기 · 줄 단위, 새 함수만 짚기", "L2 줄 쓰기 · 덩어리 안 줄 순서, 의사코드 보고 몇 줄", "L3 함수 · 함수 단위(받음 → 처리 → 돌려줌)", "L4 부품 · 파일마다 한 줄 약속, 고칠 곳은 스스로", "L5 흐름 · 요청이 지나는 길만, 실패에서 원인 추적", "L6 기능 · 리뷰만"];
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

/**
 * 단계를 통과했을 때 레벨 판정(DECISIONS 11/3: 내부 설정. 숫자는 제안 단계).
 * 해냄 = 직접 고침 + 힌트 1 이하 · 버거움 = 정답 줄 봄 · 튜터가 고침 · 만들어 주세요. 연속 2번이면 한 단계 오르내림.
 */
export async function stageOutcome(runId: string, o: { mode?: string; hints: number; byTutor: boolean }) {
  const did = !o.byTutor && o.mode === "self" && o.hints <= 1;
  const hard = o.byTutor || o.mode === "auto" || o.hints >= 3;
  let from = 0, to = 0;
  await changeSession(runId, (s) => {
    s.streak ??= { up: 0, down: 0 };
    from = s.level;
    if (did) { s.streak.up++; s.streak.down = 0; } else if (hard) { s.streak.down++; s.streak.up = 0; } else { s.streak.up = 0; s.streak.down = 0; }
    if (s.streak.up >= 2) { s.level = Math.min(6, s.level + 1); s.streak.up = 0; }
    if (s.streak.down >= 2) { s.level = Math.max(0, s.level - 1); s.streak.down = 0; }
    s.knownSkips = 0;
    to = s.level;
  });
  if (from !== to) await record({ runId, stage: 0, type: "navigate", actor: "system", detail: `레벨(내부) ${from} → ${to}` });
  return { from, to, did, hard };
}
/** "알아요, 넘길게요": 처음(L0)인데 세 번 넘기면 줄 읽기(L1)로 */
export async function knownSkip(runId: string) {
  let up = false;
  await changeSession(runId, (s) => { s.knownSkips = (s.knownSkips ?? 0) + 1; if (s.level === 0 && s.knownSkips >= 3) { s.level = 1; up = true; } });
  return up;
}

/**
 * 재개 요약(설계안 13장): 마지막 사건에서 20분 넘게 지났으면 사건에서 사실만 골라 "지난번에는…"을 만든다(AI 0번).
 */
export const RECAP_GAP_MS = 20 * 60 * 1000;
export async function recap(runId: string, names: { stageTitle: (n: number) => string; nowLabel: string }, at = Date.now()) {
  const ev = await events(runId);
  const s = await getSession(runId);
  const last = ev.at(-1);
  if (!last || at - Date.parse(last.at) < RECAP_GAP_MS) return null;
  if (s.recapSeenAt && Date.parse(s.recapSeenAt) >= Date.parse(last.at)) return null;
  const lines: string[] = [];
  const passed = [...new Set(ev.filter((e) => e.type === "application").map((e) => e.stage))];
  const lastStage = last.stage || s.currentStep;
  lines.push(`지난번에는 ${lastStage}단계 "${names.stageTitle(lastStage)}"까지 했어요.${passed.length ? ` 통과한 단계: ${passed.map((n) => `${n}단계`).join(", ")}.` : ""}`);
  const qs = ev.filter((e) => e.type === "question").slice(-3).map((e) => `"${e.detail.slice(0, 40)}"`);
  if (qs.length) lines.push(`물어본 것: ${qs.join(", ")}`);
  const fails = ev.filter((e) => { if (e.type !== "execution") return false; const m = /(\d+)\/(\d+) 통과/.exec(e.detail); return /안 켜짐/.test(e.detail) || (!!m && Number(m[1]) < Number(m[2])); }).length;
  if (fails) lines.push(`검사가 기대와 달랐던 적: ${fails}번`);
  const tutor = ev.filter((e) => e.actor === "agent" && e.type === "code_edit").length;
  if (tutor) lines.push(`튜터가 고친 적: ${tutor}번(직접 쓴 경험으로 치지 않았어요)`);
  lines.push(`오늘은 여기서 이어 가요: ${names.nowLabel}`);
  return { text: lines.join("\n"), lastAt: last.at };
}
export function recapSeen(runId: string) { return changeSession(runId, (s) => { s.recapSeenAt = now(); }); }

/** 화면·튜터 맥락에 줄 세션 요약 */
export async function sessionView(runId: string) {
  const s = await getSession(runId);
  return { background: s.background ?? null, activity: s.activity, detours: s.detours.map((d) => ({ topic: d.topic, reason: d.reason, returnLabel: d.returnLabel })), deep: s.detours.length > MAX_DETOUR, level: s.level };
}

/* ---------- 학습자 배경(11/3 사용자): TS → JS → Python 순서로 좁혀 묻기 ---------- */
export type Familiar = "yes" | "some" | "no";
export type Background = { ts?: Familiar; js?: Familiar; py?: Familiar; other?: boolean; none?: boolean; skipped?: boolean; done?: boolean };
const BG_NAME = { ts: "TypeScript", js: "JavaScript", py: "Python" } as const;
const FAM_LABEL: Record<Familiar, string> = { yes: "써 봤어요", some: "조금 봤어요", no: "처음이에요" };

/** 다음에 물을 것. 다 물었으면 null. 하나라도 "써 봤어요"면 거기서 멈춘다 */
export function bgQuestion(bg: Background | undefined): { text: string; actions: { label: string; do: string }[] } | null {
  const b = bg ?? {};
  if (b.done) return null;
  const opts = (k: "ts" | "js" | "py") => (["yes", "some", "no"] as Familiar[]).map((v) => ({ label: FAM_LABEL[v], do: `bg:${k}:${v}` }));
  if (!b.ts) return { text: "시작 전에 하나만 여쭤볼게요. 설명 눈높이를 맞추려고요.\n\n**TypeScript**를 써 본 적 있어요?", actions: [...opts("ts"), { label: "넘길게요", do: "bg:skip" }] };
  if (!b.js) return { text: "그럼 **JavaScript**는요?", actions: opts("js") };
  if (!b.py) return { text: "**Python**은요? 아니면 다른 언어는요?", actions: [{ label: "Python 써 봤어요", do: "bg:py:yes" }, { label: "Python 조금", do: "bg:py:some" }, { label: "다른 언어만 써 봤어요", do: "bg:other" }, { label: "코딩 자체가 처음이에요", do: "bg:none" }] };
  return null;
}
/** 답 하나를 반영. 돌려주는 것: 학습자 쪽에 찍을 말 */
export function applyBackground(bg: Background | undefined, ans: string): { bg: Background; said: string } {
  const b: Background = { ...(bg ?? {}) };
  const [, k, v] = ans.split(":");
  let said = "";
  if (k === "skip") { b.skipped = true; b.done = true; said = "넘길게요"; }
  else if (k === "other") { b.py = "no"; b.other = true; b.done = true; said = "다른 언어만 써 봤어요"; }
  else if (k === "none") { b.py = "no"; b.none = true; b.done = true; said = "코딩 자체가 처음이에요"; }
  else if ((k === "ts" || k === "js" || k === "py") && (v === "yes" || v === "some" || v === "no")) {
    b[k] = v as Familiar; said = `${BG_NAME[k]} ${FAM_LABEL[v as Familiar]}`;
    if (v === "yes" || k === "py") b.done = true;
    if (k === "ts" && v === "yes") b.js = "yes";
  }
  return { bg: b, said };
}
/** 배경으로 정하는 처음 레벨(내부). TS 써 봄 → L2, JS 써 봄·다른 언어 경험 → L1, 그 밖 L0 */
export function levelFromBackground(b: Background) {
  if (b.ts === "yes") return 2;
  if (b.js === "yes" || b.js === "some" || b.ts === "some" || b.py === "yes" || b.py === "some" || b.other) return 1;
  return 0;
}
export async function answerBackground(runId: string, ans: string) {
  let out = { bg: {} as Background, said: "" };
  await changeSession(runId, (s) => {
    out = applyBackground(s.background, ans);
    s.background = out.bg;
    if (out.bg.done) s.level = Math.max(s.level, levelFromBackground(out.bg));
  });
  if (out.said) await record({ runId, stage: 0, type: "self_report", actor: "user", detail: `배경: ${out.said}` });
  return out;
}
/** 튜터 맥락 한 줄: 스스로 답한 배경과 설명 방법 */
export function backgroundLine(b: Background | undefined) {
  if (!b?.done || b.skipped) return "";
  const known = (["ts", "js", "py"] as const).filter((k) => b[k]).map((k) => `${BG_NAME[k]} ${FAM_LABEL[b[k]!]}`);
  if (b.other) known.push("다른 언어 써 봄");
  if (b.none) known.push("코딩 자체가 처음");
  const how = b.ts === "yes" ? "TS 문법 설명은 빼고 HTTP·프로젝트 구조 위주로"
    : b.js === "yes" ? "JS는 안다고 보고, TS 타입 표기(: string 같은 것)만 처음 나올 때 짚기"
    : b.py === "yes" || b.py === "some" ? "JS·TS 문법은 처음 나올 때 짧게 짚고, 필요하면 Python의 같은 개념에 빗대어 설명(객체 ↔ dict, 배열 ↔ list, 화살표 함수 ↔ lambda, import ↔ import)"
    : b.other ? "변수·함수·조건문은 안다고 보고 JS·TS 문법 차이만 짚기"
    : b.js === "some" || b.ts === "some" ? "JS 문법은 본 적만 있다고 보고, 줄마다 뜻을 짧게 붙이기"
    : "코딩 자체가 처음: 변수·함수·문자열 같은 기본 말도 처음 나올 때 풀어 주기";
  return `[학습자 배경(스스로 답함)] ${known.join(" · ")} → ${how}`;
}
