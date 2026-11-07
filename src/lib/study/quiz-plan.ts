// 구조 단위 출제 (11/8 새벽 사용자: "브레젠험·중점 원은 묶어서 처리가 가능하다, 여섯 개를 굳이 다 물을 필요가 없어" — 문제설계 메모
// "구조가 그대로 문제 재료가 된다"). 시험용 길: 지금 제품의 문제 만들기(recaller.ts, 카드마다 한 문제)는 그대로 두고 옆에서 비교한다.
//
// 1) 계획(코드, AI 없음): 구조(structure.json)와 카드에서 문제 단위를 고른다.
//    차례 상자(members 순서) → 한 문제로 여러 단계를 쓰게(계산·적용) · 대비 쌍 → 구별 · 갈래 상자(종류·모두·부분) → "아닌 것"
//    · 대표 카드 → 뜻 확인 · 남은 핵심 낱장 → 카드 종류대로. 주제마다 하나는 꼭(빠짐없이). 용어 카드는 플래시카드(코드)로 따로.
//    처음 묶음은 쉽고 넓게: 카드 수의 1/4쯤(8~20).
// 2) 만들기(AI): 단위마다 한 번(sol low, 문제 만들기의 기본 모델), 동시에. 따로 풀기(sol low)로 답이 하나인지 확인한다.
// 결과는 study-gen/<id>/quiz-plan.json에만 둔다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { askJson, S } from "../assist/model.ts";
import { withTrace } from "../ai/trace.ts";
import { cardLine, type Card } from "./gen/cards.ts";
import type { MapCard, MaterialMap } from "./material-map.ts";
import type { Structure } from "./structure.ts";

export const UNITS = ["차례", "대비", "갈래", "대표", "낱장"] as const;
export type Unit = (typeof UNITS)[number];
export const FORMS = ["ox", "choice", "order", "short"] as const;
export type Form = (typeof FORMS)[number];
/** 1 떠올리기 2 알아보기 3 구별하기 4 적용하기(상황·계산) 5 잇기 */
export type PlanItem = { n: number; unit: Unit; name: string; cards: string[]; form: Form; level: number; ask: string; topic: string; why: string };
export type Flashcard = { cardId: string; front: string; back: string };
export type QuizPlan = { cards: number; first: number; items: PlanItem[]; later: PlanItem[]; flashcards: Flashcard[]; coveredTopics: number; topics: number };

const isFlow = (c: MapCard) => c.title.startsWith("흐름: ");
const topicOf = (id: string) => id.split(".")[0];
const shapeOf = (c: MapCard) => c.shape as { form?: string; name?: string; symbol?: string; definition?: string };

// 단위마다 묻는 방식(코드 규칙). 자료 성격(계산 강의 ↔ 개념 강의)은 카드 종류가 이미 말한다(공식·절차가 많으면 계산).
const ASK: Record<Unit, string> = {
  차례: "여러 단계를 차례로 써야 풀리는 문제 하나(작은 수치 예를 주고 결과를 묻거나, 단계 순서를 묻는다). 단계 하나만 알아서는 못 풀게.",
  대비: "두 카드를 가르는 기준으로 묻는다: 상황·설명 하나를 주고 둘 중 어느 쪽인지.",
  갈래: "갈래들 가운데 하나만 다른 것(아닌 것) 또는 빠진 것을 고르게.",
  대표: "이 묶음이 가리키는 개념의 뜻을 확인한다(정의의 핵심을 살짝 바꾼 보기와 가르게).",
  낱장: "카드 하나의 핵심을 묻는다.",
};
function formFor(unit: Unit, cards: MapCard[]): { form: Form; level: number } {
  const calc = cards.some((c) => c.kind === "공식" || c.kind === "절차");
  if (unit === "차례") return calc ? { form: "short", level: 4 } : { form: "order", level: 3 };
  if (unit === "대비") return { form: "choice", level: 3 };
  if (unit === "갈래") return { form: "choice", level: 2 };
  if (unit === "대표") return { form: "choice", level: 2 };
  const k = cards[0]?.kind;
  if (k === "공식") return { form: "short", level: 4 };
  if (k === "절차" || k === "조건") return { form: "choice", level: 4 };
  if (k === "비교") return { form: "choice", level: 3 };
  return { form: "ox", level: 2 };
}

export function planQuiz(map: MaterialMap, structure: Structure): QuizPlan {
  const all = map.sections.flatMap((s) => s.cards).filter((c) => !isFlow(c));
  const byId = new Map(all.map((c) => [c.id, c]));
  const title = (id: string) => byId.get(id)?.title ?? id;
  const used = new Set<string>();
  const items: Omit<PlanItem, "n" | "topic">[] = [];
  const add = (unit: Unit, name: string, ids: string[], why: string) => {
    const cards = ids.map((id) => byId.get(id)).filter((c): c is MapCard => Boolean(c));
    if (!cards.length) return;
    items.push({ unit, name, cards: cards.map((c) => c.id), ...formFor(unit, cards), ask: ASK[unit], why });
    for (const c of cards) used.add(c.id);
  };
  const kids = (g: Structure["groups"][number]) => structure.groups.filter((x) => x.parent === g.id);
  // 차례 상자: 머리 + 안의 카드(하위 묶음 카드까지)를 한 문제로
  for (const g of structure.groups) {
    if (g.members !== "순서") continue;
    const ids = [...(g.head ? [g.head] : []), ...g.cards, ...kids(g).flatMap((k) => [...(k.head ? [k.head] : []), ...k.cards])].filter((id) => byId.has(id));
    if (ids.length >= 2) add("차례", g.name, ids, `차례 상자 ${ids.length}장을 문제 하나로`);
  }
  // 대비 쌍
  for (const v of structure.versus ?? []) if (byId.has(v.a) && byId.has(v.b)) add("대비", `${title(v.a)} ↔ ${title(v.b)}`, [v.a, v.b], `견주는 기준: ${v.on}`);
  // 갈래 상자(종류·모두·부분, 3장 이상, 차례로 이미 묶인 카드는 빼고)
  for (const g of structure.groups) {
    if (!g.members || !["종류", "모두", "부분"].includes(g.members)) continue;
    const ids = [...g.cards, ...kids(g).map((k) => k.head).filter((x): x is string => Boolean(x))].filter((id) => byId.has(id));
    if (ids.length >= 3) add("갈래", g.name, [...(g.head ? [g.head] : []), ...ids], `${g.members} ${ids.length}개`);
  }
  // 대표 카드(아직 안 쓰인 것)
  for (const g of structure.groups) if (g.head && byId.has(g.head) && !used.has(g.head)) add("대표", title(g.head), [g.head], `묶음 "${g.name}"의 대표`);
  // 남은 핵심 낱장
  for (const c of all) if (c.core && !used.has(c.id)) add("낱장", c.title, [c.id], "핵심 카드");
  // 주제마다 하나는(빠짐없이)
  const topics = [...new Set(all.map((c) => topicOf(c.id)))];
  for (const t of topics) {
    if (items.some((it) => it.cards.some((id) => topicOf(id) === t))) continue;
    const c = all.find((x) => topicOf(x.id) === t && !used.has(x.id));
    if (c) add("낱장", c.title, [c.id], "이 주제에 문제가 없어서");
  }
  // 순서: 주제마다 첫 문제(넓게) → 단위 무게(차례·대비 > 대표 > 갈래 > 낱장) → 핵심 카드가 많은 것
  const weight: Record<Unit, number> = { 차례: 5, 대비: 4, 대표: 3, 갈래: 2, 낱장: 1 };
  const score = (it: Omit<PlanItem, "n" | "topic">) => weight[it.unit] * 10 + it.cards.filter((id) => byId.get(id)?.core).length;
  const sorted = [...items].sort((a, b) => score(b) - score(a));
  const firstSize = Math.max(8, Math.min(20, Math.round(all.length / 4)));
  const first: typeof items = [], seenTopic = new Set<string>();
  const mainTopic = (it: Omit<PlanItem, "n" | "topic">) => { const counts = new Map<string, number>(); for (const id of it.cards) counts.set(topicOf(id), (counts.get(topicOf(id)) ?? 0) + 1); return [...counts].sort((a, b) => b[1] - a[1])[0][0]; };
  for (const it of sorted) if (!seenTopic.has(mainTopic(it))) { first.push(it); seenTopic.add(mainTopic(it)); }
  for (const it of sorted) if (first.length < firstSize && !first.includes(it)) first.push(it);
  const firstSet = new Set(first.slice(0, firstSize));
  const number = (list: typeof items, from: number) => list.map((it, i) => ({ ...it, n: from + i, topic: mainTopic(it) }));
  const firstItems = number(sorted.filter((it) => firstSet.has(it)), 1);
  const flashcards: Flashcard[] = all.filter((c) => c.kind === "용어" && shapeOf(c).definition).map((c) => ({ cardId: c.id, front: `${shapeOf(c).name || c.title}${shapeOf(c).symbol ? ` (${shapeOf(c).symbol})` : ""}`, back: shapeOf(c).definition! }));
  return { cards: all.length, first: firstItems.length, items: firstItems, later: number(sorted.filter((it) => !firstSet.has(it)), firstItems.length + 1), flashcards,
    coveredTopics: new Set(firstItems.map((it) => it.topic)).size, topics: topics.length };
}

export const QUIZ_SYSTEM = `너는 대학 강의 자료로 복습 문제를 만든다. 문제 하나를 만든다.
- 받은 카드(지식)와 원문(source)에 있는 것만 묻는다. 원문에 없는 사실·수치를 지어내지 않는다(예제 수치는 새로 정해도 되지만 원문의 방법으로 풀려야 한다).
- unit이 차례면 카드 여러 장의 단계를 다 써야 풀리게 하나로 묶는다. 대비면 두 카드를 가르는 기준으로, 갈래면 갈래들 사이에서 고르게.
- form: ox(맞다/틀리다 명제 하나), choice(보기 4개, 정답 하나), order(단계 3~6개를 뒤섞어 주고 바른 순서), short(짧은 답: 수, 좌표, 낱말).
- level: 2 알아보기 · 3 구별하기 · 4 적용하기(상황·계산). 받은 level에 맞춘다.
- 오답 보기는 카드의 mistakes(헷갈리기 쉬운 점)에서 가져온다. 정답이 문장 길이나 말투로 드러나지 않게.
- 한국어로 쓴다. 용어는 처음에 "한국어(영어 원어)". 수식·기호·변수는 원문 그대로.
- answer: ox는 "O" 또는 "X", choice는 정답 보기 번호(1부터), order는 바른 순서의 번호를 쉼표로(예: "3,1,2,4"), short는 답.
- explain: 왜 그 답인지 두세 문장. 차례면 단계별 값을 짧게.
- uses: 이 문제가 실제로 쓰는 카드 번호들.`;
const QUIZ_SCHEMA = S.obj({ form: S.oneOf(...FORMS), level: S.int, stem: S.str, options: S.arr(S.str), answer: S.str, explain: S.str, uses: S.arr(S.int) });
type QuizReply = { form: Form; level: number; stem: string; options: string[]; answer: string; explain: string; uses: number[] };

export const SOLVE_SYSTEM = `정답을 모르는 상태에서 문제 하나를 원문(source)만 보고 푼다.
answer: ox는 "O"/"X", choice는 보기 번호(1부터), order는 바른 순서 번호를 쉼표로, short는 답.
원문으로 답이 하나로 정해지지 않으면(보기 둘이 맞음, 원문에 없음, 조건이 모자람) unique=false와 doubt 한 줄.`;
const SOLVE_SCHEMA = S.obj({ answer: S.str, unique: { type: "boolean" }, doubt: S.str });
type SolveReply = { answer: string; unique: boolean; doubt: string };

export type MadeQuestion = PlanItem & { ok: boolean; held?: string; q?: QuizReply; solved?: SolveReply; ms: number };
export type QuizRun = { at: string; ms: number; plan: QuizPlan; made: MadeQuestion[] };
export const QUIZ_MODEL = { model: "gpt-6-sol", effort: "low" };

const dataDir = () => process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data");
const fileOf = (id: string) => { if (!/^gen_[a-z0-9]{8,64}$/.test(id)) throw Object.assign(new Error("자료 id가 올바르지 않아요."), { status: 400 }); return path.join(dataDir(), "study-gen", id, "quiz-plan.json"); };
export async function loadQuizRun(id: string): Promise<QuizRun | null> { try { return JSON.parse(await readFile(fileOf(id), "utf8")) as QuizRun; } catch { return null; } }

const norm = (s: string) => s.replace(/\s+/g, "").replace(/[()（）]/g, "").toLowerCase();
export function sameAnswer(form: Form, a: string, b: string) {
  if (form === "ox") return norm(a).startsWith(norm(b).slice(0, 1)) && norm(a).slice(0, 1) === norm(b).slice(0, 1);
  if (form === "choice" || form === "order") return (a.match(/\d+/g) ?? []).join(",") === (b.match(/\d+/g) ?? []).join(",");
  return norm(a) === norm(b) || norm(a).includes(norm(b)) || norm(b).includes(norm(a));
}

/** 계획 + (make면) 단위마다 문제 하나를 만들고 따로 풀어 확인한다. texts: 쪽 번호 → 원문 글. */
export async function makeQuiz(id: string, map: MaterialMap, structure: Structure, texts: Record<string, string>, options: { make?: boolean; only?: number } = {}): Promise<QuizRun> {
  const t0 = Date.now();
  const plan = planQuiz(map, structure);
  const byId = new Map(map.sections.flatMap((s) => s.cards).map((c) => [c.id, c]));
  const made: MadeQuestion[] = [];
  if (options.make) {
    const list = options.only ? plan.items.slice(0, options.only) : plan.items;
    made.push(...await Promise.all(list.map(async (it): Promise<MadeQuestion> => {
      const t = Date.now();
      const cards = it.cards.map((x) => byId.get(x)!);
      const pages = [...new Set(cards.flatMap((c) => c.pages))].sort((a, b) => a - b);
      const source = pages.map((p) => `[원문 p.${p}]\n${texts[p] ?? ""}`).join("\n\n").slice(0, 14000);
      const lines = cards.map((c, i) => `${i + 1}|${c.kind}|${cardLine({ kind: c.kind, title: c.title, shape: c.shape, takes: c.takes, gives: c.gives } as Card).replace(/\s+/g, " ").slice(0, 400)}${c.mistakes.length ? `\n  헷갈리기 쉬운 점: ${c.mistakes.slice(0, 3).join(" / ")}` : ""}${c.figure?.says ? `\n  그림: ${c.figure.says}` : ""}`);
      const user = `자료: ${map.title}\nunit: ${it.unit} (${it.name}) — ${it.ask}\nform: ${it.form} · level: ${it.level}\n\n카드 (번호|종류|내용)\n${lines.join("\n")}\n\nsource\n${source}`;
      try {
        const q = await withTrace({ area: "pdf", action: "quiz-unit", ref: id }, () => askJson<QuizReply>("map:quiz-unit", QUIZ_SYSTEM, user, QUIZ_SCHEMA, QUIZ_MODEL));
        const view = `form: ${q.form}\n${q.stem}${q.options.length ? `\n${q.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}` : ""}`;
        const solved = await withTrace({ area: "pdf", action: "quiz-solve", ref: id }, () => askJson<SolveReply>("map:quiz-solve", SOLVE_SYSTEM, `${view}\n\nsource\n${source}`, SOLVE_SCHEMA, QUIZ_MODEL));
        const agree = sameAnswer(q.form, q.answer, solved.answer);
        const held = !solved.unique ? `답이 하나가 아님: ${solved.doubt}` : !agree ? `따로 푼 답이 다름(${solved.answer} ≠ ${q.answer})` : (q.form === "choice" && q.options.length < 3) ? "보기가 모자람" : undefined;
        return { ...it, ok: !held, ...(held ? { held } : {}), q, solved, ms: Date.now() - t };
      } catch (error) { return { ...it, ok: false, held: `실패: ${(error as Error).message}`.slice(0, 200), ms: Date.now() - t }; }
    })));
  }
  const run: QuizRun = { at: new Date().toISOString(), ms: Date.now() - t0, plan, made };
  if (options.make) { await mkdir(path.dirname(fileOf(id)), { recursive: true }); await writeFile(fileOf(id), JSON.stringify(run, null, 1)); }
  return run;
}
