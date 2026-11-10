// 나의 학습 노트(2026-11-10 사용자 "학습자 모델을 만든다는 느낌으로 … 인간이 봤을 때 한눈에 이해가 되는 시스템 … 제일 중요한 거는 뭘 모르는가를 잘 후벼 파야"):
// 실습 하나하나가 아니라 사람 하나에 한 장. 여러 실습의 부족함 원장 · 학습자 메모리 · 확인된 환경을 모아 네 칸으로 본다.
//   아직 모르는 것(열림 · 채우는 중 · 다시 틀림 · 채웠지만 다시 확인 전) · 자꾸 틀리는 것(다른 실습 · 목표 2곳 이상) · 이제 되는 것(다시 확인까지 맞음) · 내 환경
// 상태는 전부 코드가 원장에서 계산한다(AI 없음). 이름이 같으면(띄어쓰기 · 대소문자 무시) 같은 것으로 묶고, 가장 최근 일의 상태를 쓴다.
// 컴퓨터끼리: 이 서버는 앱 데이터에 쓰지 않는다. 앱이 GET /api/learner-note?local=1을 받아 앱 데이터(RecallerData)에 컴퓨터 이름별로 두고,
// 이 서버는 앱의 GET /api/project-course/learner로 다른 컴퓨터 것을 받아 합친다(앱이 꺼져 있으면 이 컴퓨터 것만).
import os from "node:os";
import path from "node:path";
import { readdir } from "node:fs/promises";
import { DATA, read, update } from "./store.ts";
import type { Gap } from "./gaps.ts";

export type NoteStatus = "아직 모름" | "다시 틀림" | "채움, 다시 확인 전" | "이제 됨";
export type NoteItem = { key: string; name: string; status: NoteStatus; prereq: boolean; wrong: string; next: string; goal: string; runId: string; gapId: string; at: string; dueAt: string | null; places: string[] };
export type EnvFact = { tool: string; fact: string; at: string };
export type LocalNote = { machine: string; at: string; items: NoteItem[]; env: EnvFact[]; history?: import("./history.ts").Entry[] };
export type LearnerNote = { at: string; unknown: NoteItem[]; repeated: NoteItem[]; known: NoteItem[]; env: EnvFact[]; tendencies: { text: string; status: string }[]; machines: string[] };

const APP = () => (process.env.PROJECT_APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const ENV_FILE = () => path.join(DATA, "env.json");
const keyOf = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
const STATUS: Record<string, NoteStatus> = { 열림: "아직 모름", "채우는 중": "아직 모름", "다시 틀림": "다시 틀림", "세션에서 채움": "채움, 다시 확인 전", "다시 확인 맞음": "이제 됨" };
/** 그 부족함에 마지막으로 일어난 일의 시각 */
const lastAt = (g: Gap) => [g.at, g.filledAt ?? "", ...g.checks.map((c) => c.at), ...g.evidence.map((e) => e.at)].sort().at(-1)!;
/** 이름: 목표 정리가 붙인 이름, 아직이면 단위 이름("선행: 객체 참조" → "객체 참조") */
const nameOf = (g: Gap) => (g.type ? g.concept : g.prereq ?? g.unit.title.replace(/^(보충|선행|먼저 알 것): /, ""));

/** 이 컴퓨터의 모든 실습 원장 → 이름별 한 줄 */
export async function localNote(): Promise<LocalNote> {
  const dir = path.join(DATA, "gaps");
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".json"));
  const long = new Map<string, string>();
  const all: Gap[] = [];
  for (const f of files) {
    const runId = f.replace(/\.json$/, "");
    const gs = (await read<{ gaps: Gap[] }>(path.join(dir, f), { gaps: [] })).gaps.filter((g) => !g.mergedInto);
    if (!gs.length) continue;
    all.push(...gs);
    long.set(runId, (await read<{ long?: { text: string } | null }>(path.join(DATA, "goals", `${runId}.json`), {})).long?.text ?? "");
  }
  const by = new Map<string, NoteItem>();
  for (const g of all.sort((a, b) => lastAt(a).localeCompare(lastAt(b)))) {
    const name = nameOf(g), key = keyOf(name);
    if (!key) continue;
    const place = `${long.get(g.runId) || "실습"} › ${g.goal.title}`;
    const have = by.get(key);
    const it: NoteItem = { key, name, status: STATUS[g.status] ?? "아직 모름", prereq: !!g.prereq, wrong: g.wrong, next: g.card?.next ?? "", goal: g.goal.title, runId: g.runId, gapId: g.id, at: lastAt(g), dueAt: g.dueAt ?? null,
      places: [...new Set([...(have?.places ?? []), place])].slice(-6) };
    by.set(key, it); // 오래된 것부터 덮어써 가장 최근 일의 상태가 남는다
  }
  const env = Object.values(await read<Record<string, EnvFact>>(ENV_FILE(), {}));
  // 학습 기록(11/11)도 같은 길로 컴퓨터끼리 — 최근 3000줄
  const history = (await (await import("./history.ts")).localEntries()).slice(-3000);
  return { machine: os.hostname(), at: new Date().toISOString(), items: [...by.values()], env, history };
}

/** 앱에 모인 다른 컴퓨터의 노트(앱이 꺼져 있거나 없으면 빈 목록) */
export async function remoteNotes(): Promise<LocalNote[]> {
  try {
    const r = await fetch(`${APP()}/api/project-course/learner`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return [];
    const d = (await r.json()) as { machines?: Record<string, LocalNote> };
    return Object.values(d.machines ?? {}).filter((n) => n && n.machine !== os.hostname() && Array.isArray(n.items));
  } catch { return []; }
}

/** 컴퓨터마다의 노트를 합쳐 네 칸으로 */
export function combine(notes: LocalNote[], tendencies: { text: string; status: string }[] = []): LearnerNote {
  const by = new Map<string, NoteItem>();
  for (const n of notes) for (const it of n.items) {
    const have = by.get(it.key);
    const places = [...new Set([...(have?.places ?? []), ...it.places])];
    by.set(it.key, !have || it.at >= have.at ? { ...it, places } : { ...have, places });
  }
  const env = new Map<string, EnvFact>();
  for (const n of notes) for (const e of n.env ?? []) if (!env.has(e.tool) || e.at > env.get(e.tool)!.at) env.set(e.tool, e);
  const items = [...by.values()].sort((a, b) => b.at.localeCompare(a.at));
  const known = items.filter((i) => i.status === "이제 됨");
  return { at: new Date().toISOString(), unknown: items.filter((i) => i.status !== "이제 됨"), repeated: items.filter((i) => i.places.length >= 2 && i.status !== "이제 됨"), known,
    env: [...env.values()].sort((a, b) => a.tool.localeCompare(b.tool)), tendencies, machines: [...new Set(notes.map((n) => n.machine))] };
}

/** 이 컴퓨터 + 앱에 모인 다른 컴퓨터 */
export async function learnerNote(): Promise<LearnerNote> {
  const [local, remote] = await Promise.all([localNote(), remoteNotes()]);
  const tend = (await (await import("./memory.ts")).memoryOf().catch(() => [])).filter((i) => i.kind === "경향" && i.status !== "나아짐").map((i) => ({ text: i.text, status: i.status }));
  return combine([local, ...remote], tend);
}

/** 목표 정리가 이름을 맞추는 데 쓰는 다른 실습의 이름 */
export async function knownNames() {
  const n = await learnerNote();
  return [...n.unknown, ...n.known].map((i) => i.name).slice(0, 80);
}

/** 튜터 매 차례 맥락. 비면 빈 글 */
export async function noteText() {
  const n = await learnerNote().catch(() => null);
  if (!n || (!n.unknown.length && !n.known.length && !n.env.length)) return "";
  const cut = (s: string, k: number) => (s.length > k ? `${s.slice(0, k - 1)}…` : s);
  const un = n.unknown.slice(0, 10).map((i) => `- ${i.prereq ? "(선행) " : ""}${i.name} — ${i.status}${i.places.length >= 2 ? ` · ${i.places.length}곳에서` : ""}${i.wrong ? `: ${cut(i.wrong, 80)}` : ""}`);
  return [
    "[학습 노트 — 여러 실습에 걸친 이 학습자, Recaller가 원장에서 계산]",
    un.length ? `아직 모르는 것(최근 순):\n${un.join("\n")}` : "",
    n.known.length ? `이제 되는 것(다시 확인까지 맞음 — 선행 확인에서 건너뛴다): ${n.known.slice(0, 20).map((i) => i.name).join(" · ")}` : "",
    n.env.length ? `확인된 환경: ${n.env.map((e) => e.fact).join(" · ")}` : "",
    un.length ? "지금 목표와 관련된 아직 모르는 것이 있으면, 목표를 설명하기 전에 그것부터 짧게 확인한다(관련 없으면 꺼내지 않는다)." : "",
  ].filter(Boolean).join("\n");
}

/* ---------- 환경(명령 결과에서 코드가 알아냄) ---------- */
const TOOLS = ["node", "npm", "npx", "python", "python3", "py", "pip", "pip3", "docker", "git", "java", "javac", "go", "cargo", "dotnet", "psql", "mysql", "sqlite3", "code"];
/** 명령과 결과를 보고 "docker 없음" · "node v22.13.0" 같은 사실을 남긴다. 알아낸 게 있으면 그 사실 */
export function envFact(command: string, code: number | null, out: string): EnvFact | null {
  const at = new Date().toISOString();
  const head = command.trim().split(/\s+/)[0]?.toLowerCase().replace(/\.(exe|cmd)$/, "") ?? "";
  const missing = /'([\w.-]+)' is not recognized as an internal or external command|The term '([\w.-]+)' is not recognized|(?:^|\n)(?:bash: )?([\w.-]+): (?:command )?not found/i.exec(out);
  const miss = (missing?.[1] ?? missing?.[2] ?? missing?.[3] ?? "").toLowerCase().replace(/\.(exe|cmd)$/, "");
  if (miss && TOOLS.includes(miss)) return { tool: miss, fact: `${miss} 없음`, at };
  if (code === 0 && TOOLS.includes(head) && /^\S+\s+(-v|--version|-V|version)\s*$/i.test(command.trim())) {
    const v = /\d+\.\d+(\.\d+)?/.exec(out)?.[0];
    if (v) return { tool: head, fact: `${head} ${v}`, at };
  }
  return null;
}
export async function noteEnv(command: string, code: number | null, out: string) {
  const f = envFact(command, code, out);
  if (f) await update<Record<string, EnvFact>>(ENV_FILE(), {}, (m) => { m[f.tool] = f; });
  return f;
}
