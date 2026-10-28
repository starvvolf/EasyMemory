// 코스 데이터 읽기. 코스 하나 = courses/<id>/course.json + 템플릿 폴더들.
// 새 코스를 더할 때 코드를 고치지 않도록, 단계·활동·검사·지식 연결은 모두 데이터에 둔다.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFiles, type Build, type TemplateSpec } from "./stagegen.ts";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const COURSES = path.join(ROOT, "courses");
/** 저장소 맨 위(앱). 앱 코드는 읽기만 한다. */
export const APP_ROOT = path.resolve(ROOT, "..", "..");

export type Knowledge = { id: string; name: string; essentials: string };
export type Part = { id: string; name: string; files: string[]; role: string; core: string; io: string; links: string[]; without: string; mistake: string; knowledge: string[] };
export type Predict = { id: string; q: string; options: string[]; answer: number; why: string; knowledge: string[] };
export type TryRequest = { label: string; method: string; path: string; body?: unknown; raw?: string; as?: string };
export type Stage = {
  n: number; template: string; transfer?: boolean; title: string; goal: string; parts: string[]; knowledge: string[]; intro: string;
  predict: Predict[]; observe: { text: string; checks: string[] }; fix: { text: string; files: string[] };
  explain: { q: string; knowledge: string[] }; breaks?: string[]; hints: Record<"1" | "2", string>; try: TryRequest[];
};
export type Step = {
  as?: string | null; req?: string; body?: unknown; raw?: string; save?: Record<string, string>;
  db?: string; params?: unknown[]; restart?: boolean; seed?: { count: number; body: unknown };
  expect?: {
    status?: number; header?: Record<string, string>; noHeader?: string[]; has?: string[]; length?: number;
    json?: Record<string, unknown>; some?: Record<string, unknown>; none?: Record<string, unknown>;
    rows?: number; row?: Record<string, unknown>; rowNot?: Record<string, unknown>; rowMatch?: Record<string, string>;
  };
};
export type Check = { id: string; stage: number; template: string; kind: string; target?: boolean; title: string; knowledge: string[]; where?: { file: string; anchor: string }; steps: Step[] };
export type Diagnose = { id: string; stage: number; q: string; options: string[]; answer: number };
export type Course = {
  id: string; title: string; summary: string; stack: string; audience: string;
  templates: Record<string, { dir: string; base?: { template: string; stage: number; drop: string[] } }>;
  auth: Record<string, number>;
  knowledge: Knowledge[]; parts: Part[]; stages: Stage[]; checks: Check[]; intake: { diagnose: Diagnose[] };
};

const cache = new Map<string, Course>();
export async function loadCourse(id: string): Promise<Course> {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("코스 이름이 이상해요.");
  if (!cache.has(id) || process.env.PC_DEV) cache.set(id, JSON.parse(await readFile(path.join(COURSES, id, "course.json"), "utf8")));
  return cache.get(id)!;
}
export async function listCourses() {
  const out: Course[] = [];
  for (const e of await readdir(COURSES, { withFileTypes: true })) {
    if (e.isDirectory()) { try { out.push(await loadCourse(e.name)); } catch { /* 코스가 아님 */ } }
  }
  return out;
}

export function templateSpec(course: Course, name: string): TemplateSpec {
  const t = course.templates[name];
  if (!t) throw new Error(`템플릿 ${name}이 없어요.`);
  const dir = path.join(COURSES, course.id, t.dir);
  if (!t.base) return { dir };
  const base = course.templates[t.base.template];
  return { dir, base: { dir: path.join(COURSES, course.id, base.dir), stage: t.base.stage, drop: t.base.drop } };
}

export function stageOf(course: Course, n: number) {
  const s = course.stages.find((x) => x.n === n);
  if (!s) throw new Error(`${n}단계가 없어요.`);
  return s;
}

export async function stageFiles(course: Course, n: number, build: Partial<Build> = {}) {
  const st = stageOf(course, n);
  return buildFiles(templateSpec(course, st.template), { stage: n, ...build });
}

export const knowledgeName = (course: Course, id: string) => course.knowledge.find((k) => k.id === id)?.name ?? id;

/** 단계의 정답 줄(시작 상태 → 푼 상태 차이). 힌트 3단계와 AI 힌트의 근거로 쓴다. */
export async function solutionDiff(course: Course, n: number) {
  const start = await stageFiles(course, n);
  const solved = await stageFiles(course, n, { solved: true });
  const out: { file: string; diff: string }[] = [];
  for (const [file, text] of solved) {
    const before = start.get(file) ?? "";
    if (before === text) continue;
    out.push({ file, diff: lineDiff(before.split("\n"), text.split("\n")) });
  }
  return out;
}

export function lineDiff(a: string[], b: string[], context = 2) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: { t: " " | "+" | "-"; text: string; line: number }[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { ops.push({ t: " ", text: b[j], line: j + 1 }); i++; j++; }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { ops.push({ t: "+", text: b[j], line: j + 1 }); j++; }
    else { ops.push({ t: "-", text: a[i], line: j + 1 }); i++; }
  }
  const keep = ops.map((_, k) => ops.slice(Math.max(0, k - context), k + context + 1).some((o) => o.t !== " "));
  const out: string[] = [];
  ops.forEach((o, k) => {
    if (!keep[k]) return;
    if (k > 0 && !keep[k - 1]) out.push("  …");
    out.push(`${o.t} ${o.text}`);
  });
  return out.join("\n");
}
