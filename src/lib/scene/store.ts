// 저장: <데이터>/scene/gaps.json(빈틈 전부) · scenes/<id>.json(장면) · attempts.jsonl(푼 기록, 한 줄씩).
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Attempt, Gap, Scene } from "./types.ts";

const root = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "scene");
export const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString("hex")}`;
async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 1), "utf8");
  await rename(tmp, file);
}
let chain: Promise<unknown> = Promise.resolve();
/** gaps.json을 한 번에 하나씩 고친다 */
export function changeGaps<T>(fn: (gaps: Gap[]) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => { const gaps = await readGaps(); const out = await fn(gaps); await writeJson(path.join(root(), "gaps.json"), gaps); return out; });
  chain = run.catch(() => undefined);
  return run;
}
export async function readGaps(): Promise<Gap[]> {
  try { return JSON.parse(await readFile(path.join(root(), "gaps.json"), "utf8")) as Gap[]; } catch { return []; }
}
export const sceneFile = (id: string) => { if (!/^sc_[a-f0-9]{12}$/.test(id)) throw new Error("장면 id가 올바르지 않아요."); return path.join(root(), "scenes", `${id}.json`); };
export async function saveScene(scene: Scene) { await writeJson(sceneFile(scene.id), scene); }
export async function readScene(id: string): Promise<Scene | null> { try { return JSON.parse(await readFile(sceneFile(id), "utf8")) as Scene; } catch { return null; } }
export async function addAttempt(a: Attempt) { await mkdir(root(), { recursive: true }); await appendFile(path.join(root(), "attempts.jsonl"), `${JSON.stringify(a)}\n`, "utf8"); }
export async function readAttempts(): Promise<Attempt[]> {
  try { return (await readFile(path.join(root(), "attempts.jsonl"), "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Attempt); } catch { return []; }
}
/** 이 빈틈 · 거리의 장면 중 검사를 통과했고 아직 안 푼 것(가장 최근). 서버를 다시 켜도 만든 장면을 다시 만들지 않으려고(AI 0번). */
export async function unusedScene(gapId: string, distance: string): Promise<Scene | null> {
  let names: string[] = [];
  try { names = (await readdir(path.join(root(), "scenes"))).filter((n) => /^sc_[a-f0-9]{12}\.json$/.test(n)); } catch { return null; }
  const done = new Set((await readAttempts()).map((a) => a.sceneId));
  const all = await Promise.all(names.map((n) => readScene(n.slice(0, -5))));
  return all.filter((x): x is Scene => Boolean(x && x.gapId === gapId && x.distance === distance && x.check?.ok && !done.has(x.id)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}
