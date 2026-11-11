// 학습 목표 구조(11/4 사용자 설계: "장기 목표 / 현재 목표 두 가지"):
// - 장기 목표: 처음에 "뭘 만들고 싶어"를 문답(plan 모드처럼, 설문지)으로 좁혀서 확정. 사용자가 크게 틀지 않으면 유지
// - 방식: 탑다운(구조부터 보고 시작 → 지도) / 바텀업(작은 것 하나부터 확장 → 지도 없음). 처음에 고르게, 도중에 바꿀 수 있게
// - 지도: 탑다운이면 큰 단계 제목만 먼저, 그 단계에 닿으면 자세히(현재 목표). 남은 제목은 고칠 수 있음
// - 현재 목표: 지금 할 것 + 완료 조건. 넘어가기 = 이해(읽고 이해했다, 학습자 표시) + 적용(확인할 수 있으면 실행으로, 아니면 학습자 표시) 뒤 학습자 [다음으로].
//   둘이 다 안 차도 넘어갈 수 있고 그건 "건너뜀"으로 남긴다
// - 보충: 막히면 [막혔어요]로 이유를 체크해 받고, 그걸로 바로 보충 목표를 연다(현재 목표는 미뤄 둠). 보충은 이해만 표시하면 돌아온다
// - 보충 로드맵(11/7 사용자 설계): [너무 어려워요] → 짧은 설문(큰 원인 고르기 + 직접 쓰기) → 튜터가 보충 로드맵을 짠다. 원래 로드맵은 잠시 보관(숨김)하고,
//   보충 로드맵의 맨 끝(종착지)은 막힌 단계 A. 보충을 다 하면 A로 돌아가고, A를 해내면(이해) 원래 로드맵으로. 또 어려우면 A는 그대로 종착지, 보충만 다시 짠다
// 상태 변경은 코드가 하고, 모델은 도구로 제안 · 기록만 한다. 학습자 버튼은 AI를 부르지 않거나(이해 · 적용 · 보충 끝) 한 번만 부른다(다음으로 · 확정 · 막혔어요 · 설문 답)
import path from "node:path";
import { randomBytes } from "node:crypto";
import { DATA, read, update } from "./store.ts";
import { CHOICES } from "./stuck.ts";
import { RESPOND_RULE } from "./judge.ts";
import { SHELL_TOOL } from "./shell.ts";
import { CODE_TOOL, DEBUG_TOOL } from "./codenav.ts";
import { CAUSE_PLAN } from "./gaps.ts";
import { BROWSE_TOOL } from "./browse.ts";
import { HISTORY_TOOL } from "./history.ts";

/** support: [너무 어려워요]로 끼워 넣은 보충 단계(11/6 사용자 "중간에 보충 단계를 만들어서 넣어 줘야") — 원래 단계 바로 앞에 들어간다 */
type Item = { id: string; title: string; status: "todo" | "doing" | "done" | "skipped"; support?: boolean };
/** 선행(11/10 사용자 "개념 간의 선행관계랑 의존성"): 이 목표를 받치는 먼저 알아야 할 것 3~6개와 1분 확인 문항, 확인 결과 */
/** debts(11/11 "걸린 만큼만 받아 쓰고 빚으로"): 이 덩어리에서 온 것 중 튜터가 그냥 알려 준 이름 · 문법. asked = 정리하자고 이미 한 번 제안함 */
export type Prereq = { name: string; check: string; result?: "됨" | "비어 있음"; quote?: string; at?: string; by?: "확인" | "학습자" | "노트"; debts?: string[]; asked?: boolean };
/** 도움 다이얼(11/11 사용자 "다이얼 하나 + 기록은 정직하게"): 막혔을 때 튜터가 어디까지 해 주나 */
export type Help = "self" | "together" | "fast";
export const HELP_LABEL: Record<Help, string> = { self: "스스로", together: "같이", fast: "빨리 만들기" };
const HELP_RULE: Record<Help, string> = {
  self: "[도움 정도: 스스로] 학습자가 직접 하고 싶어 한다. 방향과 생각할 거리만 주고 코드 · 답은 쓰지 않는다(달라고 하면 그 순간만 준다). 정해진 이름 · 문법은 이름만 알려 준다.",
  together: "[도움 정도: 같이] 틀(빈칸 · 뼈대 · 순서)은 주고 핵심은 학습자가 채우게 한다. 두 번 해도 안 되면 그 부분을 보여 주고 왜 그런지 한 줄로 설명한다.",
  fast: "[도움 정도: 빨리 만들기 — 아래 [학습자가 물을 때]의 '고치는 법은 묻기 전까지 말하지 않는다'보다 이것이 우선] 학습자는 빨리 만들면서 설명을 듣고 싶어 한다. 되묻지 말고 필요한 코드를 바로 파일에 쓰고(고치기 허용일 때, 아니면 채팅에) 줄마다 무엇을 하는지 짧게 설명한다. 확인 문항 · 적용 과제를 강요하지 않는다(학습자가 원하면 한다).",
};
/** 새 이름(11/11 사용자 "문법 같이 머릿속으로 생각하기 힘든 거는 그냥 알려 주는 게 맞는"): 과제에 쓰는 정해진 이름(함수 · 명령 · 문법 · 파일 이름). seen = 학습자가 펼쳐 봄 */
export type NewName = { name: string; what: string; example: string; seen?: boolean; from?: string };
type Current = { id: string; title: string; done: string; understood: boolean; applied: boolean; mapId?: string; at: string; prereqs?: Prereq[]; names?: NewName[] };
/**
 * 먼저 알 것 지도(11/10 사용자 "장기목표 잡으면서 선행개념이랑 의존성을 다 정리해"): 장기 목표 전체를 하려면 그 전에 알아야 할 개념과
 * 있어야 할 도구. needs = 이것을 알려면 먼저 알아야 할 다른 항목(이 지도 안에서만, 순환은 코드가 끊음), for = 이것이 쓰이는 지도 단계.
 * 확인 결과는 check_prereq(학습자 답) · 학습 노트(다시 확인까지 맞은 것) · 명령 결과(도구)에서 코드가 적는다.
 */
export type Base = { name: string; kind: "개념" | "도구"; needs: string[]; for: string[]; check: string; result?: "됨" | "비어 있음"; by?: "확인" | "노트" | "명령" | "학습자"; quote?: string; at?: string };
type Support = { id: string; title: string; done: string; why: string; from: string; understood?: boolean; at: string; mapId?: string };
/** 보충 로드맵(11/7). target = 막힌 단계 A(종착지), steps = 보충 단계, back = 보충을 다 하고 A로 돌아와 있는 중, round = 몇 번째로 짠 보충인지 */
/** 보충 단계도 현재 목표와 같이 ① 이해 → ② 적용(11/8 사용자 "보충 단계도 현재 단계랑 똑같이. 쉬우면 너무 쉬워요로 넘어감") */
type SupStep = { id: string; title: string; done: string; status: "todo" | "doing" | "done"; understood?: boolean; applied?: boolean };
export type SupportPlan = { target: { title: string; done: string; mapId?: string }; steps: SupStep[]; why: string; round: number; back: boolean; at: string };
type Question = { q: string; options: string[]; multi?: boolean };
export type Goals = {
  mode: "topdown" | "bottomup" | null;
  /** 도움 다이얼. 없으면 같이 */
  help?: Help;
  long: { text: string; spec: string; at: string } | null;
  map: Item[];
  current: Current | null;
  /** 예전(11/6까지) 한 칸짜리 보충. 읽을 때 support로 옮긴다 */
  stack: Support[];
  support: SupportPlan | null;
  survey: { id: string; intro: string; questions: Question[]; at: string } | null;
  plan: { long: string; spec: string; mode: "topdown" | "bottomup"; map: string[]; first: { title: string; done: string; prereqs?: Prereq[] }; base?: Base[]; at: string } | null;
  /** 장기 목표의 먼저 알 것 지도(확정 때 plan.base에서) */
  base?: Base[];
  stuck: { reasons: string[]; text: string; at: string } | null;
  log: { at: string; kind: string; text: string }[];
};
const empty = (): Goals => ({ mode: null, long: null, map: [], current: null, stack: [], support: null, survey: null, plan: null, stuck: null, log: [] });
const file = (runId: string) => path.join(DATA, "goals", `${runId}.json`);
const now = () => new Date().toISOString();
const nid = () => randomBytes(4).toString("hex");
const err = (message: string) => Object.assign(new Error(message), { status: 400 });
const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
/** 예전 한 칸 보충(stack) → 보충 로드맵, 지도에 끼워 둔 보충 칸은 뺀다 */
function migrate(g: Goals) {
  g.support ??= null;
  if (g.stack?.length && !g.support && g.current) {
    g.support = { target: { title: g.current.title, done: g.current.done, mapId: g.current.mapId }, steps: g.stack.map((x, i) => ({ id: x.id, title: x.title, done: x.done, status: i === g.stack.length - 1 ? "doing" : "done" })), why: g.stack.at(-1)!.why, round: 1, back: false, at: g.stack[0].at };
  }
  g.stack = [];
  g.map = g.map.filter((m) => !m.support);
  return g;
}
export const goalsOf = async (runId: string) => migrate(await read<Goals>(file(runId), empty()));
const save = (runId: string, fn: (g: Goals) => void) => update<Goals>(file(runId), empty(), (g) => { migrate(g); fn(g); });
const supNow = (g: Goals) => g.support && !g.support.back ? g.support.steps.find((x) => x.status === "doing") ?? null : null;
const logIt = (g: Goals, kind: string, text: string) => { g.log.push({ at: now(), kind, text }); if (g.log.length > 200) g.log.splice(0, g.log.length - 200); };

/* ---------- 모델 도구(두 엔진 공통 정의: OpenCode는 그대로, Codex는 MCP inputSchema로) ---------- */
const str = { type: "string" } as const;
/** 현재 목표의 선행을 구체적으로(11/11 사용자 "구체적이지 않은 느낌 · 현재 목표의 선행 개념을 적게 해") */
const PREREQ_SPEC = "선행은 큰 덩어리로 3~5개만 적는다(11/11 사용자 \"리액트를 하려면 자바스크립트를 알아야 되고, 그런 것\"): 이 목표를 하려면 먼저 알고 있어야 하는 과목 · 기술 · 도구 단위(예: React 목표면 JavaScript 기본 · HTML/CSS · Node와 npm, REST API 서버 목표면 Python 기본 · HTTP가 무엇인지 · JSON). 누가 들어도 \"그건 알아야지\" 싶은 것만. 괄호 · 변수 하나 같은 잔 문법으로 쪼개지 않는다. check는 그 덩어리를 써 봤는지 스스로 가늠할 한 줄(예: \"함수와 배열을 써서 짧은 JavaScript 코드를 짜 본 적이 있나요?\").";
export const GOAL_TOOLS = [
  { name: "ask_questions", description: "학습자에게 고르기형 질문을 화면에 띄운다(설문지). 만들 것을 어느 수준으로 할지 좁힐 때, 진행 방식(topdown: 구조부터 / bottomup: 작은 것부터)을 물을 때 쓴다. 앞에서 학습자가 한 말을 바탕으로 3~5개. 띄운 뒤에는 답을 기다린다.",
    properties: { intro: str, questions: { type: "array", items: { type: "object", additionalProperties: false, properties: { q: str, options: { type: "array", items: str }, multi: { type: "boolean" } }, required: ["q", "options", "multi"] } } }, required: ["intro", "questions"] },
  { name: "propose_plan", description: "좁혀진 내용으로 장기 목표를 제안한다(이미 장기 목표가 있어도 학습자가 방향 · 목표를 바꾸자고 하면 바로 쓴다). 학습자가 [확정]을 누르면 장기 목표 · 방식 · 지도 · 첫 현재 목표가 정해진다. map은 큰 단계 제목: topdown이면 3~6개, bottomup이면 지금 보이는 첫 몇 단계만(넓혀 가며 update_map으로 더한다). first는 첫 현재 목표와 완료 조건(학습자가 확인할 수 있는 한 문장), 그 목표 전에 이미 알고 있어야 할 선행 prereqs(set_current_goal과 같은 꼴, 목표 자체는 넣지 않는다, 꼭 3~5개). " + PREREQ_SPEC + "  base는 먼저 알 것 지도: 장기 목표 전체를 하려면 그 전에 알고 있어야 할 개념(문법 · 원리 포함)과 있어야 할 도구(설치 · 실행 환경)를 5~12개로 정리한다. 지도 단계에서 새로 배울 것(장기 목표 자체)은 넣지 않는다. name은 다른 곳에서도 통하는 짧은 이름, kind는 개념 · 도구, needs는 이것을 알려면 먼저 알아야 할 다른 base 항목 이름(이 목록 안에서만, 없으면 빈 목록), for는 이것이 쓰이는 지도 단계 제목(map 글자 그대로), check는 개념이면 1분 안에 답할 확인 문항(정답을 넣지 않는다), 도구면 있는지 확인할 명령(예: python --version).",
    properties: { long: str, spec: str, mode: { type: "string", enum: ["topdown", "bottomup"] }, map: { type: "array", items: str }, first: { type: "object", additionalProperties: false, properties: { title: str, done: str, prereqs: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: str, check: str }, required: ["name", "check"] } } }, required: ["title", "done", "prereqs"] },
      base: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: str, kind: { type: "string", enum: ["개념", "도구"] }, needs: { type: "array", items: str }, for: { type: "array", items: str }, check: str }, required: ["name", "kind", "needs", "for", "check"] } } }, required: ["long", "spec", "mode", "map", "first", "base"] },
  { name: "set_current_goal", description: "다음 현재 목표와 완료 조건을 정한다. 학습자가 [다음으로]를 눌러 앞 목표가 끝났을 때 쓴다. 탑다운이면 지도의 다음 단계를 지금 할 만큼 구체적으로. prereqs는 이 목표를 하려면 그 전에 이미 알고 있어야 할 것 — 이 목표에서 새로 배울 것(목표 자체)은 넣지 않는다, 각각 다른 곳에서도 통하는 짧은 이름(name)과 1분 안에 답할 확인 문항(check, 정답을 넣지 않는다). " + PREREQ_SPEC,
    properties: { title: str, done: str, prereqs: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: str, check: str }, required: ["name", "check"] } } }, required: ["title", "done", "prereqs"] },
  { name: "new_names", description: "적용 과제(또는 설명)에 학습자가 처음 쓸 수 있는 정해진 이름(함수 · 명령 · 문법 키워드 · 옵션 · 파일 이름처럼 생각으로 알아낼 수 없고 찾아봐야 아는 것)을 넘긴다. 화면의 과제 아래 '새로 쓰는 이름' 칸에 뜬다(처음인 이름은 펼쳐서, 전에 써 본 이름은 접어서 — Recaller가 기록으로 정한다). 과제를 낼 때 같이 부른다. name은 그 이름 그대로(예: console.log), what은 하는 일 한 구절, example은 짧은 쓰는 꼴(과제의 답 줄은 그대로 쓰지 않는다), from은 그 이름이 이 목표의 선행 덩어리에서 온 것이면 그 덩어리 이름(선행 목록 글자 그대로, 아니면 뺀다).",
    properties: { names: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: str, what: str, example: str, from: str }, required: ["name", "what", "example"] } } }, required: ["names"] },
  { name: "set_prereqs", description: "현재 목표의 선행 목록을 새로 적는다(지금 목표에 선행이 비어 있을 때, 또는 목표를 다듬어 선행이 달라졌을 때). 이미 확인한 결과는 같은 이름이면 남는다. " + PREREQ_SPEC,
    properties: { prereqs: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: str, check: str }, required: ["name", "check"] } } }, required: ["prereqs"] },
  { name: "check_prereq", description: "선행 덩어리 하나가 됐는지 · 비었는지 드러난 결과를 적는다. 미리 묻지 않고, 학습자가 막히거나 틀렸을 때 그 원인이 선행 덩어리로 드러났거나 학습자가 스스로 말했을 때 쓴다. result는 됨 · 비어 있음, quote는 그 판단의 근거가 된 학습자 말을 글자 그대로. 비어 있으면 Recaller가 부족함으로 잡고, 튜터는 그 선행을 지금 목표의 코드 · 상황으로 짧게 채우거나(plan_support) 이어 간다.",
    properties: { name: str, result: { type: "string", enum: ["됨", "비어 있음"] }, quote: str }, required: ["name", "result", "quote"] },
  { name: "plan_support", description: "보충 로드맵을 짠다. 학습자가 [너무 어려워요]로 어려운 점을 보냈을 때, 또는 학습자 말에서 막힘이 분명할 때(why_quote에 그 말을 글자 그대로). 원래 로드맵은 잠시 보관되고, 보충 로드맵의 종착지는 막힌 지금 단계다(따로 넣지 않는다). steps는 거기 닿는 데 필요한 작은 보충 단계 1~4개(각각 title과 완료 조건 done). 먼저 알 것 지도에 비어 있는 항목이 있으면 그것부터, 기대는 순서(아래 항목 먼저)로 지금 목표에 필요한 만큼만 채운다. 보충 중에 다시 부르면 끝낸 보충은 두고 남은 보충을 이 steps로 바꾼다.",
    properties: { steps: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: str, done: str }, required: ["title", "done"] } }, why_quote: str }, required: ["steps", "why_quote"] },
  { name: "update_map", description: "지도의 남은 단계 제목을 고친다(끝난 · 하는 중 단계는 그대로 두고 titles에는 남은 단계만). 진행하다 계획이 달라졌거나, 바텀업에서 넓혀 갈 방향이 보일 때.",
    properties: { titles: { type: "array", items: str } }, required: ["titles"] },
  // 터미널 명령(11/8 결정 8). 학습 목표 도구와 같은 길(두 엔진 공통)로 내보낸다. 처리는 lib/shell.ts
  SHELL_TOOL,
  // 코드 이해(언어 서버) · 디버거(11/8, 확장 0.9.0). 처리는 lib/codenav.ts
  CODE_TOOL, DEBUG_TOOL,
  // 브라우저(11/8): 학습자 컴퓨터 안 페이지만. 처리는 lib/browse.ts
  BROWSE_TOOL,
  // 학습 기록 찾기(11/11): 통째로 주지 않고 필요할 때 찾아본다. 처리는 lib/history.ts
  HISTORY_TOOL,
] as const;
export const GOAL_NAMES = new Set<string>(GOAL_TOOLS.map((t) => t.name));
/** MCP(Codex)용: inputSchema 꼴로 */
export const goalToolsMcp = () => GOAL_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: { type: "object", additionalProperties: false, properties: t.properties, required: [...t.required] } }));

/** 먼저 알 것 지도 다듬기(코드): 이름 겹침 · 없는 이름 · 자기 자신 · 순환을 뺀다. 기대는 순서(needs 먼저)로 늘어놓는다 */
export function cleanBase(v: unknown, map: string[]): Base[] {
  const key = (t: string) => norm(t);
  const raw = (Array.isArray(v) ? v : []).map((x: any) => ({ name: String(x?.name ?? "").trim().slice(0, 60), kind: (x?.kind === "도구" ? "도구" : "개념") as Base["kind"],
    needs: (Array.isArray(x?.needs) ? x.needs : []).map((n: unknown) => String(n ?? "").trim()).filter(Boolean), for: (Array.isArray(x?.for) ? x.for : []).map((n: unknown) => String(n ?? "").trim().slice(0, 80)).filter(Boolean), check: String(x?.check ?? "").trim().slice(0, 300) }))
    .filter((x) => x.name);
  const seen = new Map<string, Base>();
  for (const x of raw) if (!seen.has(key(x.name)) && seen.size < 14) seen.set(key(x.name), x);
  const names = new Map([...seen.values()].map((x) => [key(x.name), x.name]));
  const mapKeys = new Map(map.map((t) => [key(t), t]));
  for (const x of seen.values()) {
    x.needs = [...new Set(x.needs.map((n) => names.get(key(n))).filter((n): n is string => !!n && key(n) !== key(x.name)))];
    x.for = [...new Set(x.for.map((f) => mapKeys.get(key(f)) ?? f))].slice(0, 8);
  }
  // 순환 끊기 + 기대는 순서: 깊이 우선으로 needs를 먼저 놓고, 지금 걷는 중인 것으로 돌아오는 줄은 버린다
  const out: Base[] = [], state = new Map<string, 1 | 2>();
  const visit = (x: Base) => {
    state.set(key(x.name), 1);
    x.needs = x.needs.filter((n) => { const y = seen.get(key(n))!; const st = state.get(key(n)); if (st === 1) return false; if (!st) visit(y); return true; });
    state.set(key(x.name), 2); out.push(x);
  };
  for (const x of seen.values()) if (!state.has(key(x.name))) visit(x);
  return out;
}
/** 판정 · 채움이 먼저 알 것을 짚으면 지도에도 적는다(같은 이름일 때만). 없던 이름이면 지도 끝에 더해 다음 목표도 안다 */
export async function setBaseResult(runId: string, name: string, result: "됨" | "비어 있음", quote = "") {
  const g = await goalsOf(runId);
  if (!g.long || !name.trim()) return;
  await save(runId, (x) => {
    x.base ??= [];
    let b = x.base.find((y) => norm(y.name) === norm(name));
    if (!b) { if (result === "됨" || x.base.length >= 20) return; b = { name: name.trim().slice(0, 60), kind: "개념", needs: [], for: [], check: "" }; x.base.push(b); }
    Object.assign(b, { result, by: "확인", at: now(), ...(quote ? { quote: quote.slice(0, 200) } : {}) });
  });
}
/** 학습자가 직접 표시(11/11 사용자 "선행 개념 … 사용자가 안다 모른다 체크"): 됨 · 비어 있음 · 지우기(null). 튜터 맥락에 ·학습자로 보인다 */
export async function setBaseSelf(runId: string, name: string, result: "됨" | "비어 있음" | null) {
  const g = await goalsOf(runId);
  if (!g.long) throw Object.assign(new Error("장기 목표를 정한 뒤에 쓸 수 있어요."), { status: 409 });
  let found = false;
  await save(runId, (x) => {
    for (const b of [...(x.base ?? []), ...(x.current?.prereqs ?? [])].filter((y) => norm(y.name) === norm(name))) {
      found = true;
      if (result) Object.assign(b, { result, by: "학습자", at: now() }); else { delete b.result; delete b.by; delete b.quote; delete b.at; }
    }
  });
  if (!found) throw Object.assign(new Error("그 항목을 찾지 못했어요."), { status: 404 });
  if (result) await (await import("./history.ts")).add({ run: runId, goal: g.current?.title ?? g.long.text, kind: "확인", name, result: result === "됨" ? "됨(스스로 표시)" : "비어 있음(스스로 표시)" });
  const g2 = await goalsOf(runId);
  return { base: baseBrief(g2), prereqs: prereqBrief(g2) };
}
/** 현재 목표의 선행(미니 창 맨 위) */
export function prereqBrief(g: Goals) {
  return (g.current?.prereqs ?? []).map((p) => ({ name: p.name, check: p.check, result: p.result ?? null, by: p.by ?? (p.result ? "확인" : null), quote: p.quote ?? "", debts: p.debts ?? [] }));
}
/** 위 띠 · 미니 창용: 지도 전체(기대는 순서) + 지금 단계에 쓰이는 것 표시 */
export function baseBrief(g: Goals) {
  const now = new Set(baseFor(g).map((b) => norm(b.name)));
  return (g.base ?? []).map((b) => ({ name: b.name, kind: b.kind, needs: b.needs, check: b.check, result: b.result ?? null, by: b.by ?? null, quote: b.quote ?? "", now: !!g.current && now.has(norm(b.name)) }));
}
/** 명령을 돌린 뒤: 확인된 환경으로 먼저 알 것 지도의 도구 칸을 채운다 */
export async function baseFromEnv(runId: string) {
  const env = (await (await import("./learner-note.ts")).localNote()).env;
  if (!env.length) return;
  const g = await goalsOf(runId);
  if (!g.base?.some((b) => b.kind === "도구" && !b.result)) return;
  await save(runId, (x) => { markBase(x.base ?? [], [], env); });
}
/** 학습 노트(다시 확인까지 맞은 것) · 확인된 환경으로 미리 채운다 */
export function markBase(base: Base[], known: string[], env: { tool: string; fact: string }[]) {
  const K = new Set(known.map(norm));
  for (const b of base) {
    if (b.result) continue;
    if (b.kind === "개념" && K.has(norm(b.name))) Object.assign(b, { result: "됨", by: "노트" });
    if (b.kind === "도구") {
      const e = env.find((x) => norm(b.name).includes(x.tool) || norm(b.check).split(/\s+/)[0] === x.tool);
      if (e) Object.assign(b, { result: e.fact.endsWith("없음") ? "비어 있음" : "됨", by: "명령", quote: e.fact });
    }
  }
  return base;
}
const prereqsOf = (v: unknown): Prereq[] => (Array.isArray(v) ? v : []).map((x: any) => ({ name: String(x?.name ?? "").trim().slice(0, 60), check: String(x?.check ?? "").trim().slice(0, 300) })).filter((x) => x.name).slice(0, 6);

/** 모델이 부른 도구를 처리한다. learner: 이 대화의 학습자 말들(근거 대조용) */
export async function runGoalTool(runId: string, name: string, input: Record<string, unknown>, learner: string[]): Promise<string> {
  if (name === BROWSE_TOOL.name) return (await import("./browse.ts")).lookPageTool(runId, input);
  if (name === HISTORY_TOOL.name) return (await import("./history.ts")).historyTool(input);
  if (name === CODE_TOOL.name) return (await import("./codenav.ts")).codeNavTool(runId, input);
  if (name === DEBUG_TOOL.name) return (await import("./codenav.ts")).debugPeekTool(runId, input);
  if (name === SHELL_TOOL.name) { const sh = await import("./shell.ts"); const r = await sh.runCommandTool(runId, await runWorkspace(runId), input); await baseFromEnv(runId).catch(() => {}); return r; }
  const s = (v: unknown, n = 300) => String(v ?? "").trim().slice(0, n);
  let out = "";
  let prereqGap: { goal: { id: string; title: string }; name: string; quote: string } | null = null;
  let checked: { goal: string; name: string; result: string; quote: string } | null = null;
  let newNames: string[] = [];
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
      g.plan = { long: s(input.long, 200), spec: s(input.spec, 800), mode, map, first: { title: s(first!.title, 120), done: s(first!.done, 200), prereqs: prereqsOf((first as { prereqs?: unknown }).prereqs) }, base: cleanBase(input.base, map), at: now() };
      g.survey = null;
      logIt(g, "plan", g.plan.long);
      out = "계획을 화면에 띄웠어요. 학습자가 [확정]을 누르면 시작해요. 이번 답은 짧게 마치세요." + (g.plan.first.prereqs!.length < 2 ? " (첫 목표의 선행이 비었어요. 확정 뒤 첫 답에서 set_prereqs로 적으세요.)" : "");
    } else if (name === "set_current_goal") {
      if (!g.long) throw err("아직 장기 목표가 없어요. 먼저 propose_plan으로 제안하세요.");
      // 바꿀 수 있는 때: 현재 목표가 없을 때 · 학습자가 [다음으로]를 누른 직후 · [확정] 직후(첫 목표를 다듬기). 그 밖엔 학습자 버튼으로만
      const last = lastKind(g);
      if (g.support) throw err("보충 로드맵을 진행 중이에요. 보충은 plan_support로 고쳐요.");
      if (g.current && last !== "next" && last !== "confirm" && last !== "easy") throw err("현재 목표가 진행 중이에요. 학습자가 [다음으로]를 누르면 바꿀 수 있어요.");
      let item = g.map.find((m) => m.status === "doing" && !m.support) ?? g.map.find((m) => m.status === "todo" && !m.support);
      // 지도에 남은 단계가 없으면(바텀업으로 넓혀 가는 중 등) 이 목표를 지도 끝에 더한다 → 지도는 늘 지나온 길 + 남은 길
      if (!item) { item = { id: nid(), title: s(input.title, 80), status: "doing" }; g.map.push(item); }
      // 같은 단계에서 목표를 다시 정하면(너무 쉬워요 등, 11/6 "목표 수준 올렸을 때 맵에 반영이 안 됨") 바텀업은 단계 = 목표라 지도 제목도 바꾼다.
      // 탑다운 단계는 목표보다 큰 묶음이라 제목을 그대로 둔다(남은 단계는 튜터가 update_map으로)
      else if (item.status === "doing" && g.mode !== "topdown") item.title = s(input.title, 80);
      item.status = "doing";
      g.current = { id: nid(), title: s(input.title, 120), done: s(input.done, 200), understood: false, applied: false, mapId: item?.id, at: now(), prereqs: prereqsOf(input.prereqs) };
      markPrereqs(g, g.current);
      logIt(g, "current", g.current.title);
      out = `현재 목표를 정했어요: ${g.current.title}` + ((g.current.prereqs?.length ?? 0) < 2 ? `. 이 목표의 선행이 비었어요. 이어서 set_prereqs로 적으세요. ${PREREQ_SPEC}` : "");
    } else if (name === "new_names") {
      const c = g.current;
      if (!c) throw err("현재 목표가 없어요.");
      const list = (Array.isArray(input.names) ? input.names : []).map((x: any) => ({ name: s(x?.name, 60), what: s(x?.what, 120), example: s(x?.example, 200), ...(s(x?.from, 60) ? { from: s(x?.from, 60) } : {}) })).filter((x) => x.name).slice(0, 8);
      c.names ??= [];
      for (const n of list) { const have = c.names.find((y) => norm(y.name) === norm(n.name)); if (have) Object.assign(have, { what: n.what, example: n.example, ...(n.from ? { from: n.from } : {}) }); else c.names.push(n); }
      // 선행 덩어리에서 받아 쓴 것(빚)으로 쌓는다
      for (const n of list) {
        const p = n.from ? (c.prereqs ?? []).find((y) => norm(y.name) === norm(n.from!)) : null;
        if (p && !(p.debts ?? []).some((d) => norm(d) === norm(n.name))) p.debts = [...(p.debts ?? []), n.name].slice(-12);
      }
      newNames = list.map((n) => n.name);
      out = `새 이름 ${list.length}개를 과제 아래 칸에 넣었어요. 처음 보는 이름은 펼쳐 보이니 채팅에서 다시 되묻지 말고 과제를 이어 가세요.`;
    } else if (name === "set_prereqs") {
      const c = g.current;
      if (!c) throw err("현재 목표가 없어요.");
      if (awaitingNext(g)) throw err("학습자가 [다음으로]를 눌러 새 목표를 기다리는 중이에요. set_current_goal로 다음 목표를 정하고, 선행은 거기 prereqs로 적으세요.");
      const list = prereqsOf(input.prereqs);
      if (list.length < 2) throw err("prereqs를 3~5개 적어 주세요. " + PREREQ_SPEC);
      c.prereqs = list.map((p) => ({ ...p, ...(() => { const o = (c.prereqs ?? []).find((y) => norm(y.name) === norm(p.name)); return { ...(o?.result ? { result: o.result, quote: o.quote, at: o.at, by: o.by } : {}), ...(o?.debts?.length ? { debts: o.debts } : {}), ...(o?.asked ? { asked: true } : {}) }; })() }));
      markPrereqs(g, c);
      logIt(g, "prereqs", list.map((p) => p.name).join(", "));
      out = `이 목표의 선행 ${list.length}개를 적었어요. 학습자가 위 띠 [먼저 알 것]에서 안다 · 모른다를 표시할 수 있어요.`;
    } else if (name === "check_prereq") {
      const c = g.current;
      if (!c) throw err("현재 목표가 없어요.");
      const nm = s(input.name, 60), q = s(input.quote, 300), result = input.result === "됨" ? "됨" : "비어 있음";
      if (!nm) throw err("name이 필요해요.");
      if (!(q.length >= 1 && learner.slice(-6).some((t) => norm(t).includes(norm(q))))) throw err("quote는 확인 문항에 학습자가 답한 말을 글자 그대로 옮겨야 해요.");
      c.prereqs ??= [];
      let p = c.prereqs.find((x) => norm(x.name) === norm(nm));
      if (!p) { p = { name: nm, check: "" }; c.prereqs.push(p); }
      Object.assign(p, { result, quote: q, at: now(), by: "확인" });
      // 먼저 알 것 지도에 같은 이름이 있으면 거기에도(다음 목표에서 다시 묻지 않게)
      const bn = (g.base ?? []).find((x) => norm(x.name) === norm(nm));
      if (bn) Object.assign(bn, { result, by: "확인", quote: q, at: now() });
      logIt(g, "prereq", `${nm}: ${result}`);
      checked = { goal: c.title, name: nm, result, quote: q };
      if (result === "비어 있음") prereqGap = { goal: { id: c.id, title: c.title }, name: nm, quote: q };
      const empties = Math.max(c.prereqs.filter((x) => x.result === "비어 있음" && x.by !== "학습자").length, baseFor(g).filter((x) => x.result === "비어 있음" && x.by !== "학습자").length);
      out = result === "됨" ? `선행 "${nm}" 됨으로 적었어요.` : `선행 "${nm}"이(가) 비어 있다고 적었어요(부족함으로 잡힘). 지금 목표의 코드 · 상황으로 짧게 채우거나 plan_support로 보충을 짜세요.${empties >= 2 ? " 이 목표에서 비어 있는 선행이 2개 이상이에요. 계속 내려가기보다 목표를 낮추거나 기초부터 깔고 올라가는 지도로 바꾸자고 학습자에게 제안하세요." : ""}`;
    } else if (name === "plan_support") {
      const q = s(input.why_quote, 300);
      const ok = !!g.stuck || (q.length >= 2 && learner.slice(-6).some((t) => norm(t).includes(norm(q))));
      if (!ok) throw err("why_quote는 학습자가 한 말을 글자 그대로 옮겨야 해요(또는 학습자가 [너무 어려워요]를 보낸 뒤).");
      if (!g.current) throw err("현재 목표가 없어요. 보충은 지금 단계에서 막혔을 때 짜요.");
      const steps = (Array.isArray(input.steps) ? input.steps : []).map((x: any) => ({ title: s(x?.title, 120), done: s(x?.done, 200) })).filter((x) => x.title && x.done).slice(0, 4);
      if (!steps.length) throw err("보충 단계(title · done)가 하나 이상 있어야 해요.");
      const why = g.stuck ? [...g.stuck.reasons, g.stuck.text].filter(Boolean).join(" · ") : q;
      const fresh = steps.map((x, i) => ({ id: nid(), ...x, status: (i === 0 ? "doing" : "todo") as SupStep["status"] }));
      if (!g.support) g.support = { target: { title: g.current.title, done: g.current.done, mapId: g.current.mapId }, steps: fresh, why, round: 1, back: false, at: now() };
      else {
        // 보충 중 또는 A로 돌아와서 또 어려움: 끝낸 보충은 남기고 나머지를 새로 — 종착지 A는 그대로
        g.support.steps = [...g.support.steps.filter((x) => x.status === "done"), ...fresh];
        g.support.round += 1; g.support.back = false; g.support.why = why;
      }
      g.stuck = null;
      logIt(g, "support", fresh.map((x) => x.title).join(" / "));
      out = `보충 로드맵을 짰어요: ${fresh.map((x) => x.title).join(" → ")} → (종착지) ${g.support.target.title}. 첫 보충 "${fresh[0].title}"부터 바로 설명을 시작하세요(보충도 ① 이해 → ② 적용).`;
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
  // 학습 기록(11/11): 선행 확인 결과. 새 이름은 넘긴 것만으로는 안 적고, 학습자가 펼쳐 봤을 때(봤음) · 직접 썼을 때(씀) 적는다
  const ck = checked as { goal: string; name: string; result: string; quote: string } | null;
  if (ck) await (await import("./history.ts")).add({ run: runId, goal: ck.goal, kind: "확인", name: ck.name, result: ck.result, quote: ck.quote });
  void newNames;
  // 선행 확인에서 비어 있음(11/10) → 그 선행 이름으로 부족함을 연다
  const pg = prereqGap as { goal: { id: string; title: string }; name: string; quote: string } | null;
  if (pg) { const GP = await import("./gaps.ts"); await GP.openGap(runId, { goal: pg.goal, unit: GP.prereqUnit(pg.goal.id, pg.name), from: "선행 확인", wrong: `선행 "${pg.name}" 확인 문항에 답하지 못함`, quote: pg.quote, prereq: pg.name }); }
  // 부족함 원장(11/8): 보충 로드맵 = 그 목표에서 열린 부족함의 처방
  if (name === "plan_support" && out.startsWith("보충 로드맵을 짰어요")) { const g = await goalsOf(runId); if (g.current && g.support) await (await import("./gaps.ts")).addRemedy(runId, g.current.id, "보충", `${g.support.steps.filter((x) => x.status !== "done").map((x) => x.title).join(" → ")} (막힌 이유: ${g.support.why})`).catch(() => {}); }
  return out;
}

/* ---------- 학습자 버튼(코드) ---------- */
/** [너무 어려워요] 짧은 설문(11/7 사용자 "아주 큰 문제들을 빠르게 걸러낼 수 있는 설문지, 안 걸리는 건 직접 쓰게"): 큰 원인 여섯. 고르지 않아도 된다 */
export const STUCK_REASONS = [
  "무엇을 하라는 건지(과제 · 완료 조건)를 모르겠어요",
  "설명에 나온 개념 · 용어를 몰라요",
  "알겠는데 코드(문법)로 못 옮기겠어요",
  "어디서부터 어떤 순서로 할지 모르겠어요",
  "코드를 썼는데 오류가 나거나 결과가 달라요",
  "앞에서 배운 게 기억이 안 나요",
];
void CHOICES; // 예전 [막혔어요] 칸 목록(lib/stuck.ts)은 옛 코스 흐름이 쓴다
// 너무 어려워요(11/5)는 이유를 안 골라도 된다
/** 버튼 하나를 처리하고, 튜터에게 보낼 말이 있으면 돌려준다(없으면 null = AI 안 부름) */
export async function goalAction(runId: string, op: string, b: Record<string, unknown>): Promise<string | null> {
  let say: string | null = null;
  // 확정 때 먼저 알 것 지도를 학습 노트 · 환경으로 미리 채운다(앱이 꺼져 있어도 이 컴퓨터 것으로)
  const note = op === "confirm" ? await (await import("./learner-note.ts")).learnerNote().catch(() => null) : null;
  const seenNames: string[] = [];
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
      g.current = { id: nid(), title: p.first.title, done: p.first.done, understood: false, applied: false, mapId: g.map[0]?.id, at: now(), prereqs: p.first.prereqs ?? [] };
      markPrereqs(g, g.current);
      g.base = markBase((p.base ?? []).map((x) => ({ ...x })), (note?.known ?? []).map((i) => i.name), note?.env ?? []);
      g.plan = null; g.support = null;
      logIt(g, "confirm", p.long);
      say = `[확정] 계획을 확정했어요. 첫 현재 목표 "${p.first.title}"부터 시작해 주세요.`;
    } else if (op === "dismiss_plan") { g.plan = null; logIt(g, "plan-dismiss", ""); say = "[계획 다시 얘기하기] 제안한 계획은 아직 확정하지 않을게요. 어디를 바꾸면 좋을지 짧게 물어봐 주세요."; }
    else if (op === "help") {
      // 도움 다이얼(11/11): AI를 부르지 않는다. 다음 답부터 맥락에 붙는다
      if (b.help !== "self" && b.help !== "together" && b.help !== "fast") throw err("help는 self · together · fast 중 하나예요.");
      g.help = b.help; logIt(g, "help", HELP_LABEL[g.help]);
      say = null;
    } else if (op === "names_seen") {
      // 새 이름 칸을 펼쳐 봄(11/11): AI를 부르지 않는다. 기록에 "봤음"
      const c = g.current;
      const want = new Set((Array.isArray(b.names) ? b.names : []).map((x) => norm(String(x))));
      for (const n of c?.names ?? []) if (want.has(norm(n.name)) && !n.seen) { n.seen = true; seenNames.push(n.name); }
      say = null;
    } else if (op === "understood" || op === "applied" || (op === "easy_next" && supNow(g))) {
      // 지금 하는 단위 = 보충 단계(보충 중이면) 또는 현재 목표. 둘 다 ① 이해 → ② 적용으로 같다(11/8)
      const sp = supNow(g), c = g.current;
      const u = sp ?? c;
      if (!u) throw err("지금 하는 목표가 없어요.");
      const what = sp ? `보충 "${sp.title}"` : `"${c!.title}"`;
      const task = (x: { done: string }) => `완료 조건("${x.done}")을 학습자가 직접 해 볼 수 있는 작은 과제 하나를 내 주세요. 완성 코드는 주지 말고, 막히면 힌트만 주세요. 과제에 학습자가 처음 쓸 수 있는 정해진 이름(함수 · 명령 · 문법 · 파일 이름)이 있으면 new_names로 같이 넘기세요(화면 과제 아래에 뜹니다). 그런 이름은 숨기거나 되묻지 않아요.`;
      // 단위 하나가 끝났을 때(보충이면 다음 보충 · 종착지로)
      const finishSupport = (how: string) => {
        sp!.status = "done"; logIt(g, "support-done", `${sp!.title}: ${how}`);
        const nx = g.support!.steps.find((x) => x.status === "todo");
        if (nx) { nx.status = "doing"; return `다음 보충 "${nx.title}"(완료 조건: ${nx.done})을 바로 시작해 주세요.`; }
        // 종착지로: 막혔던 그 단계(이해 또는 적용)에서 이어 간다 — 단계 표시는 그대로 둔다
        g.support!.back = true; logIt(g, "support-back", g.support!.target.title);
        return `보충을 다 했어요. 이제 막혔던 "${g.support!.target.title}"(완료 조건: ${g.support!.target.done})로 돌아가요. 막혔던 ${c && c.understood ? "② 적용" : "① 이해"} 단계부터, 보충에서 익힌 것과 이어서 짧게 다시 짚고 이어 가 주세요.`;
      };
      // 종착지(막혔던 단계)가 한 걸음 나아가면 보충 로드맵을 닫는다
      const closeIfBack = () => { if (!sp && g.support?.back) { logIt(g, "support-close", g.support.target.title); g.support = null; return " 보충을 거쳐 원래 로드맵으로 돌아왔어요."; } return ""; };
      if (op === "easy_next") { say = `[너무 쉬워요 → 다음으로] ${what}은(는) 이미 알아요. ${finishSupport("너무 쉬워서 넘어감")}`; }
      else if (op === "understood") {
        if (u.understood) { say = null; }
        else {
          u.understood = true; logIt(g, "understood", sp ? `보충 ${sp.title}` : c!.title);
          say = `[이해했어요] ${what}을(를) 이해했어요.${closeIfBack()} 이제 적용 단계예요. ${task(u)}`;
        }
      } else {
        // [해 봤어요]: 판정(lesson.ts가 한 번 부름)이 "맞음"일 때만 적용 ✓
        const v = b.verdict as { verdict: string; right: string; gap: string; prereq?: string } | undefined;
        const ko = ({ correct: "맞음", partial: "일부만 맞음", incorrect: "틀림", unclear: "판단 근거 부족", not_answer: "판단 근거 부족" } as Record<string, string>)[v?.verdict ?? ""] ?? "";
        const line = v ? `판정: ${ko}${v.right ? ` · 맞은 부분: ${v.right}` : ""}${v.gap ? ` · 빠지거나 틀린 부분: ${v.gap}` : ""}${v.prereq ? ` · 원인은 선행 "${v.prereq}"이(가) 비어 있는 것으로 보임` : ""}` : "";
        const vq = String((v as { quote?: string } | undefined)?.quote ?? "").slice(0, 200);
        logIt(g, "apply-check", `${sp ? `보충 ${sp.title}` : c!.title}: ${ko || "판정 없음"}${v?.gap ? ` · 빠진 곳: ${v.gap}` : ""}${v?.prereq ? ` · 선행: ${v.prereq}` : ""}${vq ? ` · 학습자 답: "${vq}"` : ""}`);
        if (!v || v.verdict === "correct") {
          u.applied = true; u.understood = true; logIt(g, "applied", sp ? `보충 ${sp.title}` : c!.title);
          say = sp ? `[해 봤어요 — ${line}] ${what} 적용을 확인했어요. ${finishSupport("적용까지 함")}`
            : `[해 봤어요${line ? ` — ${line}` : ""}] ${what} 적용을 확인했어요.${closeIfBack()} 맞은 점을 짧게 확인해 주세요.`;
        } else if (v.verdict === "partial" || v.verdict === "incorrect") {
          say = v.prereq
            ? `[해 봤어요 — ${line}] 아직 적용 단계예요. '맞아요'로 시작하지 말고, 맞은 부분은 인정해 주세요. 막힌 곳이 지금 목표보다 아래의 "${v.prereq}"에서 온 것으로 보여요. 그 선행을 지금 목표의 코드 · 상황으로 짧게 확인하고, 비어 있으면 plan_support로 그 선행부터 채운 뒤 돌아오게 해 주세요(정답은 통째로 주지 않아요).`
            : `[해 봤어요 — ${line}] 아직 적용 단계예요. '맞아요'로 시작하지 말고, 맞은 부분은 인정하고 빠지거나 틀린 곳은 정답을 통째로 주지 말고 질문이나 힌트로 짚어 주세요.`;
        } else {
          say = `[해 봤어요 — ${line}] 학습자가 무엇을 했는지 아직 판단할 근거가 부족해요. 해 본 결과(답 · 코드 · 실행 결과)를 짧게 보여 달라고 해 주세요.`;
        }
      }
    } else if (op === "next" || op === "easy_next") {
      // easy_next(11/6 사용자 "너무 쉬워요 → 엎거나 다음으로 넘어간다"): 이미 아는 것 → 이 단계는 끝남으로 보고 다음으로
      if (!g.current) throw err("현재 목표가 없어요.");
      const c = g.current; const easy = op === "easy_next"; const full = easy || (c.understood && c.applied);
      const item = g.map.find((m) => m.id === c.mapId);
      if (item) item.status = full ? "done" : "skipped";
      logIt(g, "next", `${c.title}: ${easy ? "너무 쉬워서 넘어감" : full ? "마침" : `건너뜀(이해 ${c.understood ? "✓" : "–"}, 적용 ${c.applied ? "✓" : "–"})`}`);
      if (g.support) logIt(g, "support-close", `${g.support.target.title}(다음으로)`);
      g.support = null;
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
      g.current = null; g.support = null; g.stuck = null;
      say = null;
    } else if (op === "easy") {
      // 11/5 사용자 "너무 쉬워 / 너무 어려워 두 개가 막혔어요보다 낫다": 쉬우면 수준을 올리고, 필요하면 현재 목표를 더 어렵게 다듬게 한다
      const sp = supNow(g);
      logIt(g, "easy", sp?.title ?? g.current?.title ?? "");
      const at = sp?.title ?? g.current?.title ?? "지금 하던 것";
      say = `[너무 쉬워요 → 더 어렵게] 지금 "${at}"이(가) 너무 쉬워요. 이미 아는 부분은 건너뛰고 수준을 올려 주세요.${g.current && !g.support ? " 현재 목표가 너무 쉬우면 set_current_goal로 더 어려운 목표와 완료 조건으로 다듬어도 돼요." : ""}${g.map.some((m) => m.status === "todo") ? " 지도의 남은 단계도 이 학습자에게 쉬워 보이면 update_map으로 수준에 맞게 고쳐 주세요." : ""}`;
    } else if (op === "stuck" || op === "hard") {
      const reasons = (Array.isArray(b.reasons) ? b.reasons : []).map((r) => String(r)).filter((r) => STUCK_REASONS.includes(r));
      const text = String(b.text ?? "").trim().slice(0, 500);
      if (op === "stuck" && !reasons.length && !text) throw err("막힌 이유를 하나 이상 고르거나 적어 주세요.");
      if (!reasons.length && !text) reasons.push("너무 어려워요(어디가 어려운지는 모르겠어요)");
      g.stuck = { reasons, text, at: now() };
      logIt(g, "stuck", [...reasons, text].join(" · "));
      const sp = supNow(g);
      const at = sp?.title ?? g.current?.title ?? "지금 하던 것";
      const why = [...reasons, text ? `덧붙임: ${text}` : ""].filter(Boolean).join(" · ");
      // 원인 → 채우는 방법(11/8 lib/gaps.ts CAUSE_PLAN): 고른 이유마다 보충을 어떻게 짤지 한 줄씩 붙인다
      const fills = CAUSE_PLAN.filter((p) => reasons.includes(p.cause)).map((p) => `${p.cause} → ${p.fill}`);
      const whyFill = fills.length ? `${why}\n이유별로 채우는 방법: ${fills.join(" / ")}` : why;
      say = sp
        ? `[너무 어려워요] 보충 "${sp.title}"도 어려워요. 어려운 점(학습자가 고름): ${whyFill}\n종착지 "${g.support!.target.title}"는 그대로 두고, plan_support로 남은 보충을 더 쉬운 단계부터 다시 짜고 바로 설명을 시작해 주세요.`
        : g.support?.back
          ? `[너무 어려워요] 보충을 하고 돌아왔는데 "${at}"이(가) 아직 어려워요. 어려운 점(학습자가 고름): ${whyFill}\n이 단계는 종착지로 그대로 두고, plan_support로 보충을 한 번 더 짜고 바로 설명을 시작해 주세요.`
          : `[너무 어려워요] 지금: "${at}". 어려운 점(학습자가 고름): ${whyFill}\n학습자는 뭘 모르는지 정확히 모를 수 있어요. 이걸 보고 plan_support로 보충 로드맵(이 단계까지 닿는 작은 단계 1~4개)을 짜고, 첫 보충부터 바로 설명을 시작해 주세요.`;
    } else if (op === "mode") {
      if (b.mode !== "topdown" && b.mode !== "bottomup") throw err("mode는 topdown 또는 bottomup이에요.");
      g.mode = b.mode; logIt(g, "mode", b.mode);
      // 바텀업에서 하던 목표가 지도에 안 붙어 있으면(예전 진행) 지금 붙인다 — 탑다운 지도가 1단계부터 다시 돌지 않게(11/6 찐빠)
      if (g.current && !g.map.some((m) => m.id === g.current!.mapId)) { const it = { id: nid(), title: g.current.title.slice(0, 80), status: "doing" as const }; g.map.push(it); g.current.mapId = it.id; }
      const left = g.map.some((m) => m.status === "todo");
      say = `[진행 방식 변경] 이제부터 ${b.mode === "topdown" ? "탑다운(구조부터 보고, 지도를 따라)" : "바텀업(작은 것 하나부터 넓혀 가기)"}으로 가요.${b.mode === "topdown" && !left ? " 지도의 지나온 단계는 그대로 두고, 장기 목표까지 남은 큰 단계를 update_map으로 정해 주세요. 지금 하던 목표는 이어서 해요." : ""}`;
    } else throw err("모르는 동작이에요.");
  });
  if (seenNames.length) { const g2 = await goalsOf(runId); await (await import("./history.ts")).add(...seenNames.map((n) => ({ run: runId, goal: g2.current?.title ?? "", kind: "봤음" as const, name: n }))); }
  return say;
}

/* ---------- 매 차례 맥락(두 엔진 공통) ---------- */
// 선행 찔러 보기(11/10 사용자 "선행관계도 안 돼 있고 의존성도 안 돼 있을 때 어떻게 가르칠 것인가, 어떻게 파악할 것인가")
/** 지금 지도 단계에 쓰이는 먼저 알 것(for가 비면 장기 목표 전체에 쓰이는 것으로 본다) */
/** 목표를 바꿀 수 있는지 볼 때의 마지막 일(설문 · 지도 · 선행 적기/확인 같은 곁일은 건너뜀 — 11/11 [다음으로] 뒤 set_prereqs가 끼어 목표 바꾸기가 막혔던 것) */
const lastKind = (g: Goals) => [...g.log].reverse().find((l) => !["survey", "answer", "map", "support-close", "prereq", "prereqs", "help"].includes(l.kind))?.kind;
/** [다음으로]를 눌러 새 목표를 기다리는 중(현재 목표 칸에는 아직 앞 목표가 남아 있다) */
const awaitingNext = (g: Goals) => !!g.current && lastKind(g) === "next";
/** 선행에 먼저 알 것 지도의 같은 이름 결과를 옮긴다(이미 확인된 건 다시 묻지 않게) */
function markPrereqs(g: Goals, c: Current) {
  for (const p of c.prereqs ?? []) {
    if (p.result) continue;
    const b = (g.base ?? []).find((x) => norm(x.name) === norm(p.name) && x.result);
    if (b) Object.assign(p, { result: b.result, by: b.by === "학습자" ? "학습자" : b.by === "노트" ? "노트" : "확인", at: b.at ?? now() });
  }
}
export function baseFor(g: Goals): Base[] {
  const step = g.map.find((m) => m.id === g.current?.mapId)?.title ?? "";
  return (g.base ?? []).filter((b) => !b.for.length || b.for.some((f) => norm(f) === norm(step)));
}
export const PREREQ_RULE = "[선행 — 미리 묻지 않는다] 선행(큰 덩어리)은 학습자가 화면의 [먼저 알 것]에서 스스로 알아요 · 몰라요로 표시한다. 튜터는 목표를 시작하기 전에 선행을 확인하는 문항을 내지 않는다. 대신 이렇게 쓴다: (1) 학습자가 틀리거나 막혔을 때 그것이 지금 목표 탓인지 어느 선행 덩어리 탓인지 가려 한 줄로 짚는다(예: \"이건 React가 아니라 JavaScript 배열 쪽이에요\"). 선행 탓으로 드러났고 학습자가 답한 말이 있으면 check_prereq로 적는다. (2) 모른다고 표시했거나 처음인 덩어리에서 온 문법 · 이름은 그 덩어리를 처음부터 가르치지 말고, 지금 줄이 풀릴 만큼만 바로 알려 준다 — new_names에 from(그 덩어리 이름)을 붙여 넘긴다(받아 쓴 것으로 쌓인다). (3) 도구 · 환경은 묻지 말고 명령으로 확인한다. 목표는 학습자의 것이다: 선행이 비었다고 목표를 미루지 않는다.";

export async function goalContext(runId: string) {
  // 학습자 메모리(11/6): 진행 방식 · 경향을 매 차례 맨 앞에(두 엔진 같게)
  const mem = await (await import("./memory.ts")).memoryText().catch(() => "");
  const body = await goalContextBody(runId);
  // [자꾸 걸림] 제안은 덩어리마다 한 번만: 맥락에 실어 보낸 뒤 표시
  if (body.includes("[자꾸 걸림]")) await save(runId, (x) => { const p = (x.current?.prereqs ?? []).find((y) => (y.debts?.length ?? 0) >= 3 && !y.asked); if (p) p.asked = true; });
  const sh = await (await import("./shell.ts")).shellContext(runId).catch(() => "");
  // 학습자가 물을 때(11/8): 장기 목표가 없을 때도 붙는다
  const J = await import("./judge.ts");
  const refail = await (await import("./gaps.ts")).refailedContext().catch(() => "");
  // 나의 학습 노트(11/10): 여러 실습에 걸친 아직 모르는 것 · 이제 되는 것 · 확인된 환경
  const note = await (await import("./learner-note.ts")).noteText().catch(() => "");
  return [mem, note, body, refail, sh, `${J.QUESTION_RULE} ${J.ON_REQUEST_RULE} ${J.EXPLAIN_RULE} ${J.NAME_RULE} ${J.TOOL_RULE} ${J.ACT_RULE}`].filter(Boolean).join("\n\n");
}
/** 진행 기록의 작업 폴더(Codex는 그 대화의 폴더, 기본 엔진은 실험판 대화의 폴더) */
export async function runWorkspace(runId: string): Promise<string | undefined> {
  const run = await (await import("./store.ts")).getRun(runId).catch(() => null);
  if (!run) return undefined;
  if (run.codexId) return (await (await import("./codex-chat.ts")).view(run.codexId)).workspace;
  if (run.chatId) return (await (await import("./agent-chat.ts")).chatView(run.chatId)).workspace ?? Object.values(run.workspaces)[0];
  return Object.values(run.workspaces)[0];
}
async function goalContextBody(runId: string) {
  const g = await goalsOf(runId);
  if (!g.long) {
    const wait = g.survey ? "\n지금 화면에 질문을 띄워 두었다 — 학습자 답이 오면 이어 간다." : g.plan ? "\n지금 화면에 계획을 띄워 두었다 — 학습자가 확정하거나 고칠 곳을 말한다." : "";
    return `[목표 정하기 — 아직 장기 목표 없음]
학습자가 만들거나 배우고 싶은 것을 말하면, plan 모드처럼 무엇을 어느 수준으로 만들지 좁힌다. 앞에서 한 말을 바탕으로 ask_questions로 고르기형 질문 3~5개를 띄우고, 진행 방식(topdown: 구조부터 보고 시작 / bottomup: 작은 것 하나부터 넓혀 가기)도 함께 묻는다. 좁혀지면 propose_plan으로 제안한다. 인사나 가벼운 질문에는 그냥 답한다.${wait}`;
  }
  const mark = (m: Item) => ({ done: "✓", skipped: "↷", doing: "▶", todo: "·" })[m.status];
  const c = g.current, sp = supNow(g), S = g.support;
  return [
    "[학습 목표 — Recaller가 관리하고 화면 위에 보인다]",
    `장기 목표: ${g.long.text} (${g.mode === "topdown" ? "탑다운" : "바텀업"})`,
    g.long.spec ? `범위: ${g.long.spec}` : "",
    g.map.length ? `${S ? "원래 로드맵(보충 중이라 잠시 보관)" : "지도"}: ${g.map.map((m, i) => `${i + 1}.${mark(m)} ${m.title}`).join(" · ")}` : "",
    S ? `보충 로드맵(${S.round}번째, 막힌 이유: ${S.why}): ${S.steps.map((x) => `${({ done: "✓", doing: "▶", todo: "·" })[x.status]} ${x.title}`).join(" → ")} → 🎯 ${S.target.title}${S.back ? " (보충을 다 하고 지금 여기로 돌아와 있음)" : ""}` : "",
    c ? `현재 목표: ${c.title} — 완료 조건: ${c.done} · 단계: ${!c.understood ? "① 이해 중" : !c.applied ? "② 적용 중(학습자가 직접 해 보는 중)" : "적용까지 끝(학습자가 다음으로 넘어갈 수 있음)"}` : "현재 목표: 없음 — set_current_goal로 정한다",
    g.base?.length ? `먼저 알 것 지도(기대는 순서, ← 는 그 전에 알아야 할 것): ${g.base.map((b) => `${b.name}${b.kind === "도구" ? "[도구]" : ""}(${b.result ? `${b.result}${b.by === "노트" ? "·노트" : b.by === "명령" ? "·명령" : b.by === "학습자" ? "·학습자가 스스로 표시" : ""}` : "확인 전"})${b.needs.length ? ` ← ${b.needs.join(", ")}` : ""}`).join(" · ")}` : "",
    c && baseFor(g).length ? `지금 단계에 쓰이는 먼저 알 것: ${baseFor(g).map((b) => `${b.name}(${b.result ?? "확인 전"})`).join(" · ")}` : "",
    HELP_RULE[g.help ?? "together"],
    c?.prereqs?.length ? `이 목표의 선행(큰 덩어리): ${c.prereqs.map((p) => `${p.name}(${p.result ? `${p.result === "됨" ? "알아요" : "몰라요"}${p.by === "학습자" ? "·스스로 표시" : p.by === "노트" ? "·노트" : ""}` : "표시 전"}${p.debts?.length ? ` · 받아 쓴 것 ${p.debts.length}: ${p.debts.slice(-5).join(", ")}` : ""})`).join(" · ")}` : "",
    (() => { const p = (c?.prereqs ?? []).find((x) => (x.debts?.length ?? 0) >= 3 && !x.asked); return p ? `[자꾸 걸림] "${p.name}"에서 받아 쓴 것이 ${p.debts!.length}개(${p.debts!.join(", ")})다. 이번 답 끝에 한 번만 제안한다: 지금까지 걸린 이것들만 짧게 정리하고 갈지(덩어리 전체를 가르치자는 게 아니다). 고르는 것은 학습자다. 싫다고 하면 그대로 목표를 이어 간다.` : ""; })(),
    awaitingNext(g) ? `[다음으로 뒤] 학습자가 "${c!.title}"을(를) 넘겼고 새 목표를 기다린다. 다른 것보다 먼저 set_current_goal로 다음 목표(선행 prereqs 포함)를 정하고 바로 시작한다.` : "",
    c && !c.prereqs?.length && !S && !awaitingNext(g) ? "[선행 비어 있음] 이 목표의 선행이 아직 없다. 이번 답에서 다른 것보다 먼저 set_prereqs로 이 목표의 선행을 적는다." : "",
    c ? PREREQ_RULE : "",
    // 너무 깊이 내려감(11/10): 코드가 조건을 보고 그때만 한 줄
    c && ((S?.round ?? 0) >= 3 || (c.prereqs ?? []).filter((p) => p.result === "비어 있음" && p.by !== "학습자").length >= 2 || baseFor(g).filter((b) => b.result === "비어 있음" && b.by !== "학습자").length >= 2) ? "[깊이] 이 목표에서 보충을 여러 번 짰거나 비어 있는 선행이 2개 이상이다. 계속 아래로 내려가기보다, 목표를 낮추거나 기초부터 깔고 올라가는 지도(update_map)로 바꾸자고 학습자에게 한 번 제안한다." : "",
    sp ? `지금 보충: ${sp.title} — 완료 조건: ${sp.done} · 단계: ${!sp.understood ? "① 이해 중" : !sp.applied ? "② 적용 중" : "적용까지 끝"}. 끝나면 다음 보충(없으면 종착지)으로 간다. 지금은 보충에 집중한다.` : "",
    g.survey ? "지금 화면에 질문을 띄워 두었다 — 학습자 답을 기다린다." : "",
    (() => { const r = g.log.slice(-12); const e = r.filter((l) => l.kind === "easy").length, h = r.filter((l) => l.kind === "stuck").length; return e || h ? `최근 학습자 표시: 너무 쉬움 ${e}번 · 너무 어려움 ${h}번 — 설명 수준을 여기에 맞춘다.` : ""; })(),
    // 11/8 사용자 결정: 버튼 안내 끄기("버튼을 잘 다듬으면 사용자가 누르겠지"), 적용은 Recaller가 판정
    "목표와 보충 모두 ① 이해 → ② 적용 순서로 간다. 이해 단계에서는 설명과 예시로 이해를 돕고, 학습자가 이해했다고 하면 적용 과제를 낸다. 적용은 학습자가 해 봤다고 하면 Recaller가 완료 조건에 비추어 판정해 알려 준다. 단계를 넘기는 건 학습자가 화면 버튼으로 한다. 답에서 버튼을 누르라고 안내하지 않는다.",
    RESPOND_RULE,
  ].filter(Boolean).join("\n");
}

/** 화면용 */
export async function goalsView(runId: string) {
  const g = await goalsOf(runId);
  const doneN = g.map.filter((m) => m.status === "done" || m.status === "skipped").length;
  const sh = await (await import("./shell.ts")).shellOf(runId);
  const shell = sh.pending;
  // 새 이름: 이름마다 펼쳐 보일지(코드, 기록 · 이번 실습에서 친 명령 · 처음 설문 답)
  let current = g.current;
  if (current?.names?.length) {
    const H = await import("./history.ts");
    const entries = await H.allEntries().catch(() => []);
    const typed = sh.history.filter((r) => r.by === "learner").map((r) => r.command).join("\n");
    const beginner = g.log.some((l) => l.kind === "answer" && /처음|모르겠|없어요|안 해 봤/.test(l.text));
    current = { ...current, names: current.names.map((n) => ({ ...n, open: H.shouldOpen(n.name, entries, typed, beginner) })) as NewName[] };
  }
  return { ...g, current, shell, log: g.log.slice(-8), progress: g.map.length ? { done: doneN, total: g.map.length } : { done: g.log.filter((l) => l.kind === "next").length, total: 0 }, stuckReasons: STUCK_REASONS };
}
