// 학습 목표 ↔ 기억 카드 잇기 (11/9 사용자 "학습목표에 기반해서 문제 만드는 거로, 학습목표랑 기억 연결은 너가 짚어봐",
// "구조 묶고 나서 학습목표랑 관련 있는 부분은 강조하고 위쪽에").
// 목표는 주제까지만 가리킨다. 코드가 후보(목표의 주제 안 카드)와 이름 맞추기(카드 제목이 목표 글에 그대로 나옴)를 먼저 하고,
// AI 한 번(terra low, 자료 전체)이 목표마다 꼭 필요한 카드(need)와 오답 거리가 될 카드(confuse)를 후보 안에서만 고른다.
// 결과는 study-gen/<id>/goal-links.json (GenState는 그대로). 문제 만들기·구조 강조·기록이 이것을 쓴다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { askJson } from "../assist/model.ts";
import { cardLine } from "./gen/cards.ts";
import { loadGen } from "./gen/runner.ts";
import type { DigestObjective } from "./gen/digest.ts";
import { materialMap, type MapCard } from "./material-map.ts";

export type GoalLink = { goal: string; need: string[]; confuse: string[]; byName: string[] };
export type GoalLinks = { at: string; ms: number; model: string; effort: string; cards: number;
  goals: Array<Pick<DigestObjective, "id" | "verb" | "text" | "core" | "topics">>; links: GoalLink[];
  /** 어느 목표에도 필요하지 않은 핵심 카드 */
  outside: string[]; fixes: string[] };

const dataDir = () => process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data");
const fileOf = (id: string) => { if (!/^gen_[a-z0-9]{8,64}$/.test(id)) throw Object.assign(new Error("자료 id가 올바르지 않아요."), { status: 400 }); return path.join(dataDir(), "study-gen", id, "goal-links.json"); };
export async function loadGoalLinks(id: string): Promise<GoalLinks | null> {
  try { return JSON.parse(await readFile(fileOf(id), "utf8")) as GoalLinks; } catch { return null; }
}

const isFlow = (c: { title: string }) => c.title.startsWith("흐름: ");
const topicOf = (c: { id: string }) => c.id.split(".")[0];
const bare = (s: string) => s.replace(/\([^)]*\)/g, "").replace(/[\s·・,/]/g, "").toLowerCase();

/** 후보: 목표의 주제 안 카드(흐름 카드 빼고). 주제를 못 맞추면 모든 카드. */
export function candidatesOf(goal: Pick<DigestObjective, "topics">, cards: MapCard[]) {
  const inTopics = cards.filter((c) => !isFlow(c) && goal.topics.includes(topicOf(c)));
  return inTopics.length ? inTopics : cards.filter((c) => !isFlow(c));
}
/** 이름 맞추기: 카드 제목(괄호 뺀 것, 3자 이상)이 목표 글·주는 것·내는 것에 그대로 나오면. 괄호 안 원어도 본다. */
export function nameHits(goal: Pick<DigestObjective, "text"> & { given?: string; output?: string }, cards: MapCard[]) {
  const hay = bare(`${goal.text} ${goal.given ?? ""} ${goal.output ?? ""}`);
  const rawHay = `${goal.text} ${goal.given ?? ""} ${goal.output ?? ""}`.toLowerCase();
  return cards.filter((c) => {
    const b = bare(c.title);
    if (b.length >= 3 && hay.includes(b)) return true;
    const en = /\(([^)]{4,})\)/.exec(c.title)?.[1]?.toLowerCase();
    return Boolean(en && rawHay.includes(en));
  }).map((c) => c.id);
}

const SYSTEM = `강의 자료의 학습 목표와, 그 자료에서 만든 기억 카드 목록을 받는다. 목표마다 후보 카드(cand) 안에서만 고른다.
- need: 이 목표를 확인하는 문제를 풀려면 꼭 알아야 하는 카드. 목표가 직접 쓰는 개념·조건·규칙·절차. 보통 1~5장, 많아도 7장. 이름만 비슷하고 풀이에 안 쓰이는 것은 넣지 않는다.
- confuse: 이 목표의 문제에서 헷갈리게 할 오답 거리가 될 카드(비슷하지만 다른 것, 짝이 되는 반대 개념). 0~3장, need와 겹치지 않는다.
- named는 이름이 목표 글에 그대로 나온 카드다. 풀이에 쓰이면 need에 넣고, 아니면 빼도 된다.
- 카드 id는 받은 것 그대로 쓴다. 설명은 쓰지 않는다.`;
const SCHEMA = { type: "object", additionalProperties: false, required: ["links"], properties: { links: { type: "array", items: { type: "object", additionalProperties: false,
  required: ["goal", "need", "confuse"], properties: { goal: { type: "string" }, need: { type: "array", items: { type: "string" } }, confuse: { type: "array", items: { type: "string" } } } } } } };
export const GOAL_LINK_MODEL = { model: "gpt-6.1-terra", effort: "low" };

/** 코드가 거른다: 후보 밖 id·없는 id는 버리고, need가 비면 이름 맞춘 카드로 채운다. */
export function settleLinks(goals: Array<DigestObjective>, cards: MapCard[], raw: Array<{ goal: string; need: string[]; confuse: string[] }>) {
  const fixes: string[] = [];
  const links: GoalLink[] = goals.map((g) => {
    const cand = new Set(candidatesOf(g, cards).map((c) => c.id));
    const byName = nameHits(g, cards.filter((c) => cand.has(c.id)));
    const r = raw.find((x) => x.goal === g.id);
    if (!r) fixes.push(`${g.id}: 답에 없음 → 이름 맞춘 카드만`);
    const keep = (ids: string[] | undefined, what: string) => [...new Set(ids ?? [])].filter((id) => { const ok = cand.has(id); if (!ok) fixes.push(`${g.id} ${what}: ${id}는 후보 밖이라 뺌`); return ok; });
    let need = keep(r?.need, "need").slice(0, 7);
    if (!need.length && byName.length) { need = byName.slice(0, 5); fixes.push(`${g.id}: need가 비어 이름 맞춘 카드로`); }
    const confuse = keep(r?.confuse, "confuse").filter((id) => !need.includes(id)).slice(0, 3);
    return { goal: g.id, need, confuse, byName };
  });
  const needed = new Set(links.flatMap((l) => l.need));
  const outside = cards.filter((c) => c.core && !isFlow(c) && !needed.has(c.id)).map((c) => c.id);
  return { links, outside, fixes };
}

async function inputs(id: string) {
  const state = await loadGen(id);
  const map = state ? materialMap(state, {}) : null;
  const goals = (state as unknown as { recaller?: { digest?: { objectives?: DigestObjective[] } } } | null)?.recaller?.digest?.objectives ?? [];
  if (!map) throw Object.assign(new Error("자료를 찾을 수 없어요."), { status: 404 });
  if (!goals.length) throw Object.assign(new Error("이 자료에는 학습 목표가 없어요."), { status: 422 });
  const cards = map.sections.flatMap((s) => s.cards).filter((c) => !isFlow(c));
  if (!cards.length) throw Object.assign(new Error("기억 카드가 다 만들어진 뒤에 이을 수 있어요."), { status: 422 });
  return { goals, cards };
}

/** AI 한 번으로 잇는다(저장 없이, 엔진의 문제 만들기도 쓴다). */
export async function linkGoalsFor(goals: DigestObjective[], cards: MapCard[]) {
  const user = JSON.stringify({
    cards: cards.map((c) => ({ id: c.id, kind: c.kind, title: c.title, line: cardLine({ kind: c.kind, title: c.title, shape: c.shape } as never).slice(0, 120), ...(c.core ? { core: true } : {}) })),
    goals: goals.map((g) => { const cand = candidatesOf(g, cards); return { id: g.id, verb: g.verb, text: g.text, ...(g.given ? { given: g.given, output: g.output ?? "" } : {}),
      cand: cand.map((c) => c.id), named: nameHits(g, cand) }; }),
  });
  const r = await askJson<{ links: Array<{ goal: string; need: string[]; confuse: string[] }> }>("map:goal-links", SYSTEM, user, SCHEMA, GOAL_LINK_MODEL);
  return settleLinks(goals, cards, r.links ?? []);
}
/** AI 한 번으로 잇고 저장한다. */
export async function makeGoalLinks(id: string): Promise<GoalLinks> {
  const { goals, cards } = await inputs(id);
  const t0 = Date.now();
  const settled = await linkGoalsFor(goals, cards);
  const out: GoalLinks = { at: new Date().toISOString(), ms: Date.now() - t0, ...GOAL_LINK_MODEL, cards: cards.length,
    goals: goals.map((g) => ({ id: g.id, verb: g.verb, text: g.text, core: g.core, topics: g.topics })), ...settled };
  await mkdir(path.dirname(fileOf(id)), { recursive: true });
  await writeFile(fileOf(id), JSON.stringify(out, null, 1));
  return out;
}

/** /api/study-map/<id>/goal-links: GET 저장된 것, POST 새로 잇기(AI 1번). */
export async function goalLinksApi(request: Request, id: string) {
  const { NextResponse } = await import("next/server");
  if (request.method === "GET") return NextResponse.json({ links: await loadGoalLinks(id) });
  return NextResponse.json({ links: await makeGoalLinks(id) });
}
