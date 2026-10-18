// 쪽마다 쉬운 설명 (읽기 화면 곁 패널): made once per page, kept beside the notes (study-notes/<source>.explain.json)
// so reopening a page, or the other computer, shows it without another model call. Not a note: it is not 모르는 것.
// 목표 설명 entries live in the same file with `goal` (the objective id); one per goal. `__terms:<from>-<to>` holds a 용어 지도 (JSON).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

export type PageExplanation = { page: number; goal?: string; text: string; at: string };
const root = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "study-notes");
const fileFor = (sourceId: string) => {
  if (!/^[\w.-]{1,120}$/.test(sourceId)) throw new Error("자료 ID가 올바르지 않아요.");
  return path.join(root(), `${sourceId}.explain.json`);
};
export async function listExplanations(sourceId: string): Promise<PageExplanation[]> {
  try { return (JSON.parse(await readFile(fileFor(sourceId), "utf8")) as { pages: PageExplanation[] }).pages ?? []; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
let chain: Promise<unknown> = Promise.resolve();
export function saveExplanation(sourceId: string, page: number, text: string, goal?: string | null) {
  const work = async () => {
    const pages = (await listExplanations(sourceId)).filter((entry) => goal ? entry.goal !== goal : entry.goal || entry.page !== page);
    const entry: PageExplanation = { page, ...(goal ? { goal } : {}), text: text.slice(0, goal?.startsWith("__") ? 60000 : 8000), at: new Date().toISOString() };
    pages.push(entry); pages.sort((a, b) => a.page - b.page);
    await mkdir(root(), { recursive: true });
    const target = fileFor(sourceId), temporary = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(temporary, JSON.stringify({ pages }, null, 1), "utf8");
    await rename(temporary, target);
    return entry;
  };
  const next = chain.then(work, work); chain = next.catch(() => undefined); return next;
}
