// Study records (풀이 기록·복습 일정·신고·읽던 쪽) kept beside the generated materials, so a learner who switches
// between computers that share the data folder (STUDY_FORGE_DATA_DIR on a synced drive) keeps one history.
// The browser still keeps its own copy; the screen merges the two by each material's last save time.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const RECORDS_LIMIT = 8_000_000;
export type StudyRecords = { records: Record<string, unknown>; pending: unknown[]; updatedAt: number };

const root = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "study-records");
const fileFor = (uid: string) => path.join(root(), `${createHash("sha256").update(uid).digest("hex").slice(0, 32)}.json`);

export async function loadRecords(uid: string): Promise<StudyRecords | null> {
  try { return JSON.parse(await readFile(fileFor(uid), "utf8")) as StudyRecords; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export async function saveRecords(uid: string, value: StudyRecords) {
  const file = fileFor(uid);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, file);
}
