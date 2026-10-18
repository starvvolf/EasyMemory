// 학습 메모: one Markdown file per subject in the data folder (study-memory/<과목>.md), so it travels with RecallerData.
// The study screen rewrites only the auto part; "## 내 메모" (the learner) and "## 에이전트 메모" (agents) stay.
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { mergeMemory } from "./plan.ts";

export const MEMORY_LIMIT = 400_000;
const root = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "study-memory");
export function memoryFileName(subject: string) {
  const name = subject.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "_").trim().slice(0, 60);
  if (!name) throw new Error("과목 이름이 비어 있어요.");
  return `${name}.md`;
}
const fileFor = (subject: string) => path.join(root(), memoryFileName(subject));

export async function readMemory(subject: string): Promise<string | null> {
  try { return await readFile(fileFor(subject), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function listMemories() {
  let names: string[];
  try { names = await readdir(root()); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  return Promise.all(names.filter((name) => name.endsWith(".md")).map(async (name) => ({ subject: name.slice(0, -3), updatedAt: (await stat(path.join(root(), name))).mtime.toISOString() })));
}
async function write(subject: string, text: string) {
  if (Buffer.byteLength(text) > MEMORY_LIMIT) throw new Error("메모 파일이 너무 커요.");
  const file = fileFor(subject);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, file);
}
/** Replaces the auto part (from the study screen), keeping what people and agents wrote. */
export async function saveMemoryAuto(subject: string, auto: string) {
  const merged = mergeMemory(await readMemory(subject), subject, auto);
  await write(subject, merged);
  return merged;
}
/** Adds one dated line under "## 에이전트 메모" (학습규칙/에이전트.md 혼자-2). */
export async function appendAgentNote(subject: string, note: string, now = new Date()) {
  const current = (await readMemory(subject)) ?? mergeMemory(null, subject, "<!-- recaller:auto:start -->\n<!-- recaller:auto:end -->");
  const line = `- ${now.toISOString().slice(0, 10)} ${note.replace(/\s+/g, " ").trim().slice(0, 500)}`;
  const heading = "## 에이전트 메모";
  const at = current.indexOf(heading);
  let next: string;
  if (at < 0) next = `${current.trimEnd()}\n\n${heading}\n\n${line}\n`;
  else {
    const after = current.indexOf("\n## ", at + heading.length);
    const end = after < 0 ? current.length : after;
    next = `${current.slice(0, end).trimEnd()}\n${line}\n${after < 0 ? "" : "\n" + current.slice(end + 1)}`;
  }
  await write(subject, next);
  return next;
}
