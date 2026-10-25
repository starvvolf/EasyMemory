// 화면 연결: what the learner is looking at (the app reports it), and blocks an agent puts on the screen (a question,
// a problem, a knowledge item, a message, or a question to the learner such as "기한이 있나요?").
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type ViewContext = { at: string; view: string; title: string; detail: string; selection: string; ids: Record<string, string> };
export type ScreenBlock = {
  id: string; at: string; kind: "question" | "problem" | "knowledge" | "message" | "ask";
  title: string; body: string; ref: string; choices: string[]; question?: unknown;
  answered: boolean; answer: string; answeredAt: string;
};
const dir = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "agent");
const file = (name: string) => path.join(dir(), name);
async function readJson<T>(name: string, fallback: T): Promise<T> { try { return JSON.parse(await readFile(file(name), "utf8")) as T; } catch { return fallback; } }
async function writeJson(name: string, value: unknown) {
  await mkdir(dir(), { recursive: true });
  const tmp = `${file(name)}.${randomBytes(3).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 1), "utf8");
  await rename(tmp, file(name));
}

export async function setView(view: Omit<ViewContext, "at">) {
  const value: ViewContext = { at: new Date().toISOString(), view: view.view.slice(0, 40), title: view.title.slice(0, 200), detail: view.detail.slice(0, 4000),
    selection: view.selection.slice(0, 2000), ids: Object.fromEntries(Object.entries(view.ids ?? {}).slice(0, 10).map(([k, v]) => [k.slice(0, 30), String(v).slice(0, 80)])) };
  await writeJson("view.json", value);
  return value;
}
export const getView = () => readJson<ViewContext | null>("view.json", null);

export async function showBlock(block: Pick<ScreenBlock, "kind" | "title"> & Partial<Pick<ScreenBlock, "body" | "ref" | "choices" | "question">>) {
  const items = await readJson<ScreenBlock[]>("screen.json", []);
  const item: ScreenBlock = { id: `blk_${randomBytes(5).toString("hex")}`, at: new Date().toISOString(), kind: block.kind, title: block.title.slice(0, 200), body: (block.body ?? "").slice(0, 6000),
    ref: (block.ref ?? "").slice(0, 120), choices: (block.choices ?? []).slice(0, 8).map((c) => c.slice(0, 80)), ...(block.question ? { question: block.question } : {}), answered: false, answer: "", answeredAt: "" };
  await writeJson("screen.json", [...items, item].slice(-50));
  return item;
}
export async function screenBlocks(after = "") { return (await readJson<ScreenBlock[]>("screen.json", [])).filter((b) => !after || b.at > after); }
export async function answerBlock(id: string, answer: string) {
  const items = await readJson<ScreenBlock[]>("screen.json", []);
  const item = items.find((b) => b.id === id);
  if (!item) throw new Error("화면 블록을 찾을 수 없어요.");
  Object.assign(item, { answered: true, answer: answer.slice(0, 2000), answeredAt: new Date().toISOString() });
  await writeJson("screen.json", items);
  return item;
}
export async function dismissBlock(id: string) { await writeJson("screen.json", (await readJson<ScreenBlock[]>("screen.json", [])).filter((b) => b.id !== id)); return { ok: true }; }
