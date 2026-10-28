// 물음표 주머니: 학습자가 VS Code에서 "이건 뭐예요?"를 누른 코드를 받아
// 1) 용어집(courses/<id>/glossary.json)으로 먼저 답한다(AI 호출 없음)
// 2) 지금 단계 것은 바로 설명, 나중 단계 것은 짧게 말하고 주머니에 넣었다가 그 단계에서 다시 꺼낸다
// 3) 용어집에 없으면 AI 튜터에게 넘긴다(호출 1회)
import { readFile } from "node:fs/promises";
import path from "node:path";
import { COURSES } from "./course.ts";
import { DATA, addCandidates, read, update } from "./store.ts";

type Term = { id: string; name: string; match: string; stage: number | null; short: string };
export type PocketItem = {
  id: string; at: string; stage: number; file: string; from: number; to: number; code: string;
  terms: { id: string; name: string; stage: number | null }[];
  later: number[]; surfaced?: boolean; ai?: boolean;
};
type Pocket = { items: PocketItem[] };

const file = (runId: string) => path.join(DATA, "pocket", `${runId}.json`);
const glossaries = new Map<string, Term[]>();
async function glossary(courseId: string) {
  if (!glossaries.has(courseId) || process.env.PC_DEV) {
    try { glossaries.set(courseId, JSON.parse(await readFile(path.join(COURSES, courseId, "glossary.json"), "utf8")).terms); }
    catch { glossaries.set(courseId, []); }
  }
  return glossaries.get(courseId)!;
}

const rank = (t: Term, stage: number) => (t.stage === null ? 3 : t.stage === 0 ? 1 : t.stage <= stage ? 0 : 2);
export const pocketItems = async (runId: string) => (await read<Pocket>(file(runId), { items: [] })).items;

/** 고른 코드를 용어집으로 풀어 본다. 답할 거리가 없으면 text가 null(AI로 넘김). */
export async function explainWhat(runId: string, courseId: string, stage: number, quote: { file: string; from: number; to: number; code: string }) {
  const terms = await glossary(courseId);
  const code = quote.code;
  const hits = terms
    .map((t) => ({ t, at: code.search(new RegExp(t.match)) }))
    .filter((x) => x.at >= 0)
    // 이번 단계 것 → 기초 문법 → 나중 단계 것 → 몰라도 되는 것 순서로, 같으면 코드에 나온 순서
    .sort((a, b) => rank(a.t, stage) - rank(b.t, stage) || a.at - b.at)
    .map((x) => x.t);
  if (!hits.length) return { text: null as string | null, item: null };
  const shown = hits.slice(0, 4);
  const lines: string[] = [];
  const later: number[] = [];
  for (const t of shown) {
    if (t.stage === null) lines.push(`- **${t.name}**: ${t.short} (이 코스에서는 몰라도 돼요)`);
    else if (t.stage > stage) { lines.push(`- **${t.name}**: ${t.short} 자세한 건 **${t.stage}단계**에서 해요. 주머니에 넣어 둘게요.`); later.push(t.stage); }
    else lines.push(`- **${t.name}**: ${t.short}`);
  }
  if (hits.length > shown.length) lines.push(`\n그 밖에 ${hits.slice(shown.length).map((t) => t.name).join(", ")}도 들어 있어요. 궁금하면 그 부분만 골라서 다시 물어보세요.`);
  const item: PocketItem = {
    id: `${Date.now().toString(36)}`, at: new Date().toISOString(), stage, ...quote,
    terms: shown.map((t) => ({ id: t.id, name: t.name, stage: t.stage })), later: [...new Set(later)],
  };
  await update<Pocket>(file(runId), { items: [] }, (p) => { p.items.push(item); });
  await addCandidates(shown.map((t) => ({
    at: item.at, runId, course: courseId, stage, knowledgeId: t.id, knowledgeName: t.name, kind: "asked" as const,
    detail: `"이건 뭐예요?" ${quote.file} ${quote.from}줄: ${code.trim().slice(0, 80)}`,
    evidence: { activity: "hint" as const, independent: false },
    source: { kind: "project" as const, title: `코드 읽기 ${stage}단계`, ref: `${courseId}:${t.id}` },
  })));
  return { text: lines.join("\n"), item };
}

/** 용어집에 없어서 AI가 답한 질문도 주머니에 남긴다. */
export async function rememberAi(runId: string, stage: number, quote: { file: string; from: number; to: number; code: string }) {
  await update<Pocket>(file(runId), { items: [] }, (p) => {
    p.items.push({ id: Date.now().toString(36), at: new Date().toISOString(), stage, ...quote, terms: [], later: [], ai: true });
  });
}

/** 이 단계에서 다시 꺼낼 것(전에 "N단계에서 해요"라고 미뤄 둔 것). 한 번만 꺼낸다. */
export async function takeDue(runId: string, stage: number) {
  const due: PocketItem[] = [];
  await update<Pocket>(file(runId), { items: [] }, (p) => {
    for (const it of p.items) if (!it.surfaced && it.later.includes(stage)) { it.surfaced = true; due.push(it); }
  });
  return due;
}
