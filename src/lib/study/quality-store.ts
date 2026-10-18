// Patches (study-quality/patches.json) and the quality ledger (study-quality/장부.md) in the data folder, so both
// travel with RecallerData. Writes go through a temporary file; the ledger only grows.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { appendLedger, ledgerCounts, ledgerLine, type LedgerEntry, type PatchMap, type StudyPatch } from "./quality.ts";

const root = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "study-quality");
const patchFile = () => path.join(root(), "patches.json");
const ledgerFile = () => path.join(root(), "장부.md");
async function readText(file: string) {
  try { return await readFile(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function writeText(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, file);
}
// One writer at a time inside this server (the screen may log and patch together).
let chain: Promise<unknown> = Promise.resolve();
const serial = <T,>(task: () => Promise<T>) => { const next = chain.then(task, task); chain = next.catch(() => undefined); return next; };

export async function readPatches(): Promise<PatchMap> {
  const text = await readText(patchFile());
  if (!text) return {};
  try { const value = JSON.parse(text) as PatchMap; return value && typeof value === "object" ? value : {}; } catch { return {}; }
}
export async function readLedger() { return readText(ledgerFile()); }
export async function qualitySummary() {
  const [patches, ledger] = await Promise.all([readPatches(), readLedger()]);
  return { patches, ledger, counts: ledger ? ledgerCounts(ledger) : {} };
}
export function logQuality(entries: LedgerEntry[]) {
  if (!entries.length) return Promise.resolve();
  return serial(async () => { await writeText(ledgerFile(), appendLedger(await readLedger(), entries.map(ledgerLine))); });
}
type NewPatch = { kind: "accept"; itemId: string; answer: string } | { kind: "card"; itemId: string };
export function addPatch(deckId: string, patch: NewPatch, entry?: LedgerEntry) {
  return serial(async () => {
    const all = await readPatches();
    const list = all[deckId] ?? [];
    const duplicate = list.find((existing) => existing.kind === patch.kind && existing.itemId === patch.itemId
      && (patch.kind !== "accept" || (existing.kind === "accept" && existing.answer === patch.answer)));
    const saved: StudyPatch = duplicate ?? { ...patch, id: randomUUID().slice(0, 8), at: new Date().toISOString() } as StudyPatch;
    if (!duplicate) { all[deckId] = [...list, saved]; await writeText(patchFile(), JSON.stringify(all, null, 1)); }
    if (entry && !duplicate) await writeText(ledgerFile(), appendLedger(await readLedger(), [ledgerLine(entry)]));
    return saved;
  });
}
export function removePatch(deckId: string, patchId: string, entry?: LedgerEntry) {
  return serial(async () => {
    const all = await readPatches();
    const list = all[deckId] ?? [];
    if (!list.some((patch) => patch.id === patchId)) return false;
    all[deckId] = list.filter((patch) => patch.id !== patchId);
    if (!all[deckId].length) delete all[deckId];
    await writeText(patchFile(), JSON.stringify(all, null, 1));
    if (entry) await writeText(ledgerFile(), appendLedger(await readLedger(), [ledgerLine(entry)]));
    return true;
  });
}
