// Reads 학습규칙/ at run time (edits apply on reload, like 출제기준/).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_RULES, parseRules, type StudyRules } from "./plan.ts";

const root = () => process.env.STUDY_FORGE_GUIDE_ROOT?.trim() || process.cwd();
async function read(file: string) {
  try { return await readFile(/* turbopackIgnore: true */ path.join(root(), "학습규칙", file), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function loadStudyRules(): Promise<{ rules: StudyRules; warnings: string[] }> {
  // 오늘할것.md (day plan) and 품질.md (fast quality loop) share one key space.
  const [today, quality] = await Promise.all([read("오늘할것.md"), read("품질.md")]);
  if (today == null && quality == null) return { rules: DEFAULT_RULES, warnings: ["학습규칙/오늘할것.md가 없어 기본값을 써요."] };
  return parseRules(`${today ?? ""}\n${quality ?? ""}`);
}
/** Rule lines of 학습규칙/에이전트.md, for an agent's prompt. */
export async function loadAgentRules(): Promise<string[]> {
  const text = await read("에이전트.md");
  return text ? text.replace(/\r\n?/g, "\n").split("\n").filter((line) => /^- \[[^\]]+\]/.test(line)) : [];
}
