// 보관함: study materials put away from the study screen (experiment duplicates and the like), kept on disk and
// restorable. One JSON list in the data folder, so it travels with RecallerData to the other computer.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type ArchiveEntry = { id: string; title: string; at: string; reason: string };
const file = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "study-archive.json");

export async function readArchive(): Promise<ArchiveEntry[]> {
  try {
    const data = JSON.parse(await readFile(file(), "utf8")) as { entries?: ArchiveEntry[] };
    return Array.isArray(data.entries) ? data.entries : [];
  } catch { return []; }
}
async function save(entries: ArchiveEntry[]) {
  await mkdir(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.tmp`;
  await writeFile(tmp, JSON.stringify({ entries }, null, 2) + "\n", "utf8");
  await rename(tmp, file());
}
export async function archiveDecks(items: Array<{ id: string; title: string; reason: string }>) {
  const entries = await readArchive();
  const known = new Set(entries.map((entry) => entry.id));
  const at = new Date().toISOString();
  for (const item of items) if (!known.has(item.id)) { entries.push({ ...item, at }); known.add(item.id); }
  await save(entries);
  return entries;
}
export async function restoreDecks(ids: string[]) {
  const drop = new Set(ids);
  const entries = (await readArchive()).filter((entry) => !drop.has(entry.id));
  await save(entries);
  return entries;
}
