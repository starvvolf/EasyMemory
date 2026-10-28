// 코스 정하기: 채팅과 문답으로 학습자를 알고, 준비된 코스 중에서 계획을 세운다.
// - AI는 대화를 이끌고 질문을 고른다. 코스는 준비된 목록(courses/) 안에서만 고른다(GPT 평가 8장: 임의 프로젝트 자동 코스화는 하지 않음).
// - 진단 문제의 정답 판정과 계획(어느 단계부터, 어느 단계를 빠르게)은 코드가 한다.
// - AI가 없거나 한도를 넘으면 같은 질문을 대본으로 묻는다. 결과 모양은 같다.
import { randomBytes } from "node:crypto";
import path from "node:path";
import { listCourses, loadCourse, type Course } from "./course.ts";
import { AiUnavailable, aiJson, aiMode, S } from "./ai.ts";
import { DATA, read, update, type Plan } from "./store.ts";

export type Ask =
  | { kind: "text"; id: string; question: string; placeholder?: string }
  | { kind: "choice"; id: string; question: string; options: string[]; multi: boolean }
  | { kind: "diagnose"; id: "diagnose"; question: string; items: { id: string; q: string; options: string[] }[] }
  | { kind: "proposal"; id: "proposal"; courseId: string; plan: Plan };
export type Msg = { role: "assistant" | "user" | "note"; text: string; at: string; ask?: Ask };
export type Profile = { goal?: string; level?: number; levelText?: string; languages?: string[]; time?: string; aiShare?: string; wish?: string; extra?: string[] };
export type Intake = {
  id: string; createdAt: string; mode: "ai" | "script"; courseId: string; turns: number;
  messages: Msg[]; profile: Profile; diag?: { answers: Record<string, number>; right: string[]; wrong: string[] };
  plan?: Plan; requests: string[]; confirmedRun?: string; aiError?: string;
};

const FILE = (id: string) => path.join(DATA, "intake", `${id}.json`);
export const getIntake = async (id: string) => {
  if (!/^[a-z0-9]+$/.test(id)) throw Object.assign(new Error("대화를 찾지 못했어요."), { status: 404 });
  const it = await read<Intake | null>(FILE(id), null);
  if (!it) throw Object.assign(new Error("대화를 찾지 못했어요."), { status: 404 });
  return it;
};
const save = (it: Intake) => update<Intake>(FILE(it.id), it, () => it);
const now = () => new Date().toISOString();

/* ---------- 대본 질문 (AI가 없을 때, 그리고 AI가 고를 수 있는 질문 목록) ---------- */
export const LEVELS = ["언어 문법만 배웠다", "작은 프로그램은 혼자 만들어 봤다", "웹 서버를 따라 만들어 봤다", "웹 서버를 혼자 만들어 봤다"];
const LANGS = ["JavaScript / TypeScript", "Python", "Java", "C / C++", "그 밖의 언어"];
const TIMES = ["하루 30분 정도", "하루 1시간 정도", "하루 2시간 이상", "주말에 몰아서"];
const SHARES = ["AI가 대부분 짜고 나는 핵심만", "반반", "내가 대부분 짜고 AI는 도움만"];
const SCRIPT: Ask[] = [
  { kind: "text", id: "goal", question: "무엇을 만들거나 배우고 싶은지 편하게 적어 주세요. (예: 로그인 있는 웹 서비스의 서버 쪽을 제대로 이해하고 싶다)", placeholder: "하고 싶은 것" },
  { kind: "choice", id: "level", question: "지금 어느 정도인가요?", options: LEVELS, multi: false },
  { kind: "choice", id: "languages", question: "써 본 언어를 모두 골라 주세요.", options: LANGS, multi: true },
  { kind: "choice", id: "time", question: "공부에 쓸 수 있는 시간은?", options: TIMES, multi: false },
  { kind: "choice", id: "aiShare", question: "코드를 짤 때 AI와 어떻게 나누고 싶나요?", options: SHARES, multi: false },
];

async function diagnoseAsk(course: Course): Promise<Ask> {
  return { kind: "diagnose", id: "diagnose", question: "짧은 확인 문제예요. 모르면 '잘 모르겠어요'를 골라 주세요. 찍지 않는 게 계획에 도움이 돼요.",
    items: course.intake.diagnose.map((d) => ({ id: d.id, q: d.q, options: d.options })) };
}

export async function startIntake(mode?: "ai" | "script") {
  const courses = await listCourses();
  const course = courses.find((c) => c.id === "board-api") ?? courses[0];
  const useAi = (mode ?? (aiMode() === "off" ? "script" : "ai")) === "ai" && aiMode() !== "off";
  const it: Intake = { id: randomBytes(6).toString("hex"), createdAt: now(), mode: useAi ? "ai" : "script", courseId: course.id, turns: 0, messages: [], profile: {}, requests: [] };
  it.messages.push({ role: "assistant", at: now(), text:
    `안녕하세요. 직접 만들면서 머리에 남게 공부하는 코스를 같이 정해 볼게요.\n지금 준비된 코스는 "${course.title}"(${course.stack})예요. 몇 가지 묻고, 짧은 확인 문제를 푼 뒤 어디서부터 어떻게 할지 계획을 제안할게요.`,
    ask: SCRIPT[0] });
  await save(it);
  return it;
}

/** 대본 답을 프로필에 넣는다. */
function applyAnswer(p: Profile, ask: Ask, text?: string, choice?: number[]) {
  if (ask.kind === "text") {
    if (ask.id === "goal") p.goal = text;
    else (p.extra ??= []).push(`${ask.question} → ${text}`);
    return text ?? "";
  }
  if (ask.kind !== "choice") return "";
  const picked = (choice ?? []).filter((i) => i >= 0 && i < ask.options.length).map((i) => ask.options[i]);
  const said = [picked.join(", "), text].filter(Boolean).join(" / ");
  if (ask.id === "level") { p.level = choice?.[0]; p.levelText = picked[0]; }
  else if (ask.id === "languages") p.languages = picked;
  else if (ask.id === "time") p.time = picked[0];
  else if (ask.id === "aiShare") p.aiShare = picked[0];
  else (p.extra ??= []).push(`${ask.question} → ${said}`);
  return said;
}

const lastAsk = (it: Intake) => [...it.messages].reverse().find((m) => m.role === "assistant" && m.ask)?.ask;

export async function answer(id: string, input: { text?: string; choice?: number[] }) {
  const it = await getIntake(id);
  if (it.confirmedRun) throw Object.assign(new Error("이미 코스를 시작했어요."), { status: 409 });
  const ask = lastAsk(it);
  if (!ask || ask.kind === "diagnose" || ask.kind === "proposal") {
    // 진단·제안 단계에서 쓴 자유 글: 요청으로 남기고 AI가 받아 준다.
    if (input.text?.trim()) {
      it.messages.push({ role: "user", at: now(), text: input.text.trim() });
      it.requests.push(input.text.trim());
      it.messages.push({ role: "assistant", at: now(), text: "적어 둘게요. 계획 카드에서 시작 단계와 빠르게 갈 단계를 직접 바꿀 수도 있어요.", ask });
      await save(it);
    }
    return it;
  }
  const said = applyAnswer(it.profile, ask, input.text?.trim(), input.choice);
  it.messages.push({ role: "user", at: now(), text: said || "(건너뜀)" });
  it.turns += 1;
  const course = await loadCourse(it.courseId);

  if (it.mode === "ai") {
    try {
      const next = await aiTurn(it, course);
      it.messages.push(next);
      await save(it);
      return it;
    } catch (error) {
      it.mode = "script";
      it.aiError = error instanceof AiUnavailable ? error.message : (error as Error).message;
      it.messages.push({ role: "note", at: now(), text: `AI 대화를 쓸 수 없어 정해진 질문으로 이어 갈게요. (${it.aiError})` });
    }
  }
  const asked = new Set(it.messages.filter((m) => m.role === "assistant" && m.ask).map((m) => m.ask!.id));
  const nextAsk = SCRIPT.find((q) => !asked.has(q.id));
  if (nextAsk) it.messages.push({ role: "assistant", at: now(), text: scriptLead(nextAsk, it.profile), ask: nextAsk });
  else it.messages.push({ role: "assistant", at: now(), text: "고마워요. 이제 확인 문제 6개만 볼게요.", ask: await diagnoseAsk(course) });
  await save(it);
  return it;
}
function scriptLead(ask: Ask, p: Profile) {
  if (ask.id === "level" && p.goal) return "좋아요.";
  return "";
}

/* ---------- AI 대화 한 턴 ---------- */
const CHAT_SYSTEM = `너는 Recaller의 '코스 정하기' 상담자다. 학습자와 짧게 대화해서, 준비된 코스를 어떻게 진행할지 정하는 데 필요한 것을 알아낸다.
원칙
- 한국어 존댓말, 한 번에 질문 하나, 2~3문장 이내.
- 코스는 [준비된 코스]에 있는 것만 진행할 수 있다. 학습자가 다른 것(예: 프론트엔드, 앱, 게임)을 원하면 솔직히 지금은 준비되지 않았다고 말하고, request에 그 바람을 적고, 준비된 코스에서 얻을 수 있는 것과 이어 준다. 없는 코스를 약속하지 않는다.
- 알아야 할 것: 목표(goal), 수준(level: 0~3, [수준] 목록 번호), 써 본 언어, 쓸 수 있는 시간, AI와 코드를 나누는 방식. 이미 답한 것은 다시 묻지 않는다. 학습자의 말에서 알 수 있으면 묻지 않고 profile에 채운다.
- 고를 수 있는 질문이면 options에 보기를 2~5개 준다(자유 답도 가능). 자유롭게 답할 질문이면 options를 비운다.
- 다섯 가지를 알았거나 대화가 5턴을 넘으면 next를 "diagnose"로 한다. 진단 문제는 시스템이 낸다(너는 문제를 내거나 채점하지 않는다).
- 실력을 칭찬하거나 판정하지 않는다. 계획은 진단 뒤에 코드가 세운다.`;

const CHAT_SCHEMA = S.obj({
  reply: S.str,
  next: S.oneOf("ask", "diagnose"),
  question: S.obj({ id: S.str, text: S.str, options: S.arr(S.str), multi: S.bool }),
  profile: S.obj({ goal: S.str, level: S.int, languages: S.arr(S.str), time: S.str, aiShare: S.str }),
  request: S.str,
});
type ChatOut = { reply: string; next: "ask" | "diagnose"; question: { id: string; text: string; options: string[]; multi: boolean }; profile: { goal: string; level: number; languages: string[]; time: string; aiShare: string }; request: string };

export function catalogText(course: Course) {
  return `[준비된 코스]\n- ${course.id}: ${course.title} — ${course.summary}\n  기술: ${course.stack}\n  대상: ${course.audience}\n  단계: ${course.stages.map((s) => `${s.n}. ${s.title}${s.transfer ? "(전이 과제)" : ""}`).join(" / ")}`;
}

async function aiTurn(it: Intake, course: Course): Promise<Msg> {
  const convo = it.messages.filter((m) => m.role !== "note").map((m) => `${m.role === "user" ? "학습자" : "상담자"}: ${m.text}${m.ask?.kind === "choice" ? ` [보기: ${m.ask.options.join(" | ")}]` : ""}`).join("\n");
  const user = [catalogText(course), `[수준]\n${LEVELS.map((l, i) => `${i}. ${l}`).join("\n")}`, `[지금까지 안 것]\n${JSON.stringify(it.profile)}`, `[대화]\n${convo}`, `[턴] ${it.turns}`].join("\n\n");
  const out = await aiJson<ChatOut>("intake", CHAT_SYSTEM, user, CHAT_SCHEMA);
  const p = it.profile;
  if (out.profile.goal) p.goal ||= out.profile.goal;
  if (out.profile.level >= 0 && out.profile.level <= 3 && p.level === undefined) { p.level = out.profile.level; p.levelText = LEVELS[out.profile.level]; }
  if (out.profile.languages?.length && !p.languages?.length) p.languages = out.profile.languages;
  if (out.profile.time) p.time ||= out.profile.time;
  if (out.profile.aiShare) p.aiShare ||= out.profile.aiShare;
  if (out.request?.trim()) it.requests.push(out.request.trim());
  const known = [p.goal, p.level !== undefined, p.languages?.length, p.time, p.aiShare].filter(Boolean).length;
  if (out.next === "diagnose" || it.turns >= 6 || (known >= 5 && it.turns >= 3)) {
    return { role: "assistant", at: now(), text: `${out.reply}\n\n이제 확인 문제 6개만 볼게요.`.trim(), ask: await diagnoseAsk(course) };
  }
  const q = out.question;
  const qid = /^[a-z][a-zA-Z]*$/.test(q.id) && !["diagnose", "proposal"].includes(q.id) ? q.id : `q${it.turns}`;
  const ask: Ask = q.options?.length >= 2
    ? { kind: "choice", id: qid, question: q.text, options: q.options.slice(0, 6), multi: !!q.multi }
    : { kind: "text", id: qid, question: q.text };
  return { role: "assistant", at: now(), text: out.reply, ask };
}

/* ---------- 진단과 계획 (코드가 정한다) ---------- */
export function makePlan(course: Course, profile: Profile, diag: { right: string[]; wrong: string[] }): Plan {
  const main = course.stages.filter((s) => !s.transfer).map((s) => s.n);
  const level = profile.level ?? 0;
  const knows = (n: number) => course.intake.diagnose.filter((d) => d.stage === n).every((d) => diag.right.includes(d.id));
  // 빠르게: 진단을 맞혔고 혼자 작은 프로그램 이상은 만들어 본 사람. 예측 문제만 맞히면 정답 코드로 넘어갈 수 있다.
  let quick = main.filter((n) => knows(n) && level >= 1);
  // 직접 하는 단계가 둘보다 적으면 핵심 단계(권한 검사, 버그 수정)는 직접 한다.
  if (main.length - quick.length < 2) quick = quick.filter((n) => n !== 5 && n !== 6);
  const firstFull = main.find((n) => !quick.includes(n)) ?? main[0];
  // 첫 직접 단계 앞의 빠른 단계는 건너뛰고(코드는 정답으로 채워져 시작한다), 뒤의 빠른 단계는 남긴다.
  const stages = main.filter((n) => n >= firstFull);
  quick = quick.filter((n) => n > firstFull);
  const transfer = course.stages.some((s) => s.transfer);
  const reasons: string[] = [];
  const skipped = main.filter((n) => n < firstFull);
  if (skipped.length) reasons.push(`${skipped.join("·")}단계는 확인 문제를 맞혀서 건너뛰어요. 그 단계 코드는 완성된 상태로 받아요.`);
  else reasons.push("처음부터 차례로 가요. 앞 단계 코드는 다음 단계의 바탕이 돼요.");
  const wrongStages = [...new Set(course.intake.diagnose.filter((d) => diag.wrong.includes(d.id)).map((d) => d.stage))];
  if (wrongStages.length) reasons.push(`확인 문제에서 놓친 ${wrongStages.join("·")}단계는 직접 고치는 단계로 넣었어요.`);
  if (quick.length) reasons.push(`${quick.join("·")}단계는 '빠르게': 예측만 맞히면 정답 코드로 넘어갈 수 있어요.`);
  if (transfer) reasons.push("마지막에 구조가 다른 전이 과제(메모 API)로 원리를 옮길 수 있는지 봐요.");
  const notes: string[] = [];
  if (profile.languages && !profile.languages.some((l) => l.startsWith("JavaScript"))) notes.push("TypeScript가 처음이면, 각 단계의 부품 카드부터 읽어요. 학습자가 고칠 줄은 몇 줄이라 문법보다 흐름이 중요해요.");
  if (profile.aiShare?.startsWith("내가 대부분")) notes.push("직접 짜기를 원하면, 각 단계에서 정답 줄(힌트 3단계)을 열기 전에 검사 결과만 보고 끝까지 가 보세요.");
  if (profile.time?.startsWith("하루 30분")) notes.push("한 번에 한 단계(30~40분)씩이면 충분해요. 진도는 저장돼요.");
  const minutes = stages.reduce((sum, n) => sum + (quick.includes(n) ? 10 : 35), 0) + (transfer ? 25 : 0);
  return { start: firstFull, stages, quick, transfer, reasons, notes, minutes };
}

export async function diagnose(id: string, answers: Record<string, number>) {
  const it = await getIntake(id);
  if (it.confirmedRun) throw Object.assign(new Error("이미 코스를 시작했어요."), { status: 409 });
  const course = await loadCourse(it.courseId);
  const right: string[] = [], wrong: string[] = [];
  for (const d of course.intake.diagnose) (answers[d.id] === d.answer ? right : wrong).push(d.id);
  it.diag = { answers, right, wrong };
  it.messages.push({ role: "user", at: now(), text: `확인 문제 ${course.intake.diagnose.length}개 중 ${right.length}개 맞힘` });
  it.plan = makePlan(course, it.profile, it.diag);
  const wish = it.requests.length ? `\n말씀하신 "${it.requests.at(-1)}"은(는) 지금 준비된 코스가 아니라 적어 두었어요.` : "";
  it.messages.push({ role: "assistant", at: now(), text: `이렇게 해 보면 어떨까요? 고치고 싶은 곳은 카드에서 바꿀 수 있어요.${wish}`, ask: { kind: "proposal", id: "proposal", courseId: course.id, plan: it.plan } });
  await save(it);
  return it;
}

/** 학습자가 카드에서 바꾼 계획을 받아 범위 안으로 정리한다. */
export function normalizePlan(course: Course, given: Partial<Plan>, base: Plan): Plan {
  const main = course.stages.filter((s) => !s.transfer).map((s) => s.n);
  const start = main.includes(Number(given.start)) ? Number(given.start) : base.start;
  const stages = main.filter((n) => n >= start);
  const quick = (given.quick ?? base.quick).map(Number).filter((n) => stages.includes(n) && n !== start);
  const transfer = given.transfer ?? base.transfer;
  const minutes = stages.reduce((s, n) => s + (quick.includes(n) ? 10 : 35), 0) + (transfer ? 25 : 0);
  return { ...base, start, stages, quick, transfer, minutes };
}
export async function markConfirmed(id: string, runId: string, plan: Plan) {
  const it = await getIntake(id);
  it.confirmedRun = runId;
  it.plan = plan;
  it.messages.push({ role: "note", at: now(), text: `코스를 시작했어요: ${plan.start}단계부터` });
  await save(it);
  return it;
}
