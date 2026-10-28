// 읽은 글 (웹 칼럼, 강의 글): what was read, what it claims, its chains and its goals. Kept so the agent can read the
// material again and so each goal (용어 / 주장 / 고리 / 알아보기) can be checked off. Private: STUDY_FORGE_DATA_DIR/knowledge/sources.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type GoalId = "terms" | "claim" | "chains" | "recognize";
export const GOAL_TEXT: Record<GoalId, string> = { terms: "용어를 안다", claim: "주장을 말할 수 있다", chains: "고리를 설명할 수 있다", recognize: "다른 글에서 알아본다" };
export type ReadSource = {
  id: string; kind: "web" | "lesson"; title: string; url: string; text: string; readAt: string;
  claim: { text: string; basis: string[] }; chains: Array<{ from: string; relation: string; to: string }>;
  knowledgeIds: string[]; againIds: string[]; quotes: Record<string, string>;
  goals: Record<GoalId, { done: boolean; at?: string; note?: string }>;
  /** 글 지도 (2026-10-29): 읽기 전에 보는 질문·흐름·핵심 아이디어·개념어. ideaIds는 지식이 된 핵심, termIds는 학습자가 모른다고 고른 개념어. */
  map?: ArticleMapSaved;
};
export type ArticleMapSaved = {
  genre: string; question: string; flow: string[]; consider: string[];
  ideas: Array<{ title: string; body: string; ask?: string; id: string }>;
  terms: Array<{ name: string; line: string; have: "new" | "met" | "known"; id?: string }>;
  termIds: string[];
};
const dir = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "knowledge", "sources");
export const sourceIdOf = (url: string, title: string) => `src_${createHash("sha256").update(url || title).digest("hex").slice(0, 16)}`;
const fileOf = (id: string) => { if (!/^src_[a-f0-9]{16}$/.test(id)) throw new Error("글 ID가 올바르지 않아요."); return path.join(dir(), `${id}.json`); };

export async function saveSource(source: ReadSource) {
  await mkdir(dir(), { recursive: true });
  const tmp = `${fileOf(source.id)}.tmp`;
  await writeFile(tmp, JSON.stringify(source, null, 1), "utf8");
  await rename(tmp, fileOf(source.id));
  return source;
}
export async function getSource(id: string): Promise<ReadSource | null> {
  try { return JSON.parse(await readFile(fileOf(id), "utf8")) as ReadSource; } catch { return null; }
}
export async function listSources() {
  let names: string[] = [];
  try { names = (await readdir(dir())).filter((n) => /^src_[a-f0-9]{16}\.json$/.test(n)); } catch { return []; }
  const out: Array<Omit<ReadSource, "text">> = [];
  for (const name of names) { try { const { text: _text, ...rest } = JSON.parse(await readFile(path.join(dir(), name), "utf8")) as ReadSource; void _text; out.push(rest); } catch { /* skip */ } }
  return out.sort((a, b) => b.readAt.localeCompare(a.readAt));
}
export async function markGoal(id: string, goal: GoalId, done: boolean, note = "") {
  const source = await getSource(id);
  if (!source) throw new Error("읽은 글을 찾을 수 없어요.");
  source.goals[goal] = { done, at: new Date().toISOString(), ...(note ? { note: note.slice(0, 400) } : {}) };
  return saveSource(source);
}
