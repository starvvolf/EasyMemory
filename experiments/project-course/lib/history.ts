// 학습 기록(사람 단위, 2026-11-11 사용자 "콘솔로그를 쓰면 어쨌음 저쨌음 … 타임라인대로 기록을 한 다음에 AI가 그 기록을 다시 볼 때 통으로 주지 말고 검색할 수 있게"):
// 11/8 학습 기록 타임라인(lib/timeline.ts, 실습 하나 · 행동 한 칸 · 사람이 보는 점검용) 위에, 이름 · 개념 하나에 무슨 일이 있었나를 한 줄씩 쌓는다.
// 한 사람의 모든 실습이 한 파일(.data/history.jsonl)에 시간순으로. 줄은 코드가 쓴다(버튼 · 판정 · 저장한 코드 · 터미널 명령 · 선행 확인 · 다시 확인) — AI는 쓰지 않는다.
// 튜터는 search_history 도구로 필요할 때만 찾아본다(매 차례 맥락에는 학습 노트 요약만). 새 이름 접힘/펼침도 이 기록을 본다.
// 컴퓨터끼리: 학습 노트와 같은 길(learner-note.ts localNote에 실어 앱이 RecallerData에 둔다).
import path from "node:path";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { DATA } from "./store.ts";

/** 종류: 확인(선행 확인 됨/비어 있음) · 봤음(새 이름 펼쳐 봄) · 씀(학습자가 직접 씀) · 맞음 · 틀림 · 일부(판정) · 막힘 · 다시 확인 · 오류(학습자 명령) · 알려 줌 */
export type Kind = "확인" | "봤음" | "씀" | "맞음" | "틀림" | "일부" | "막힘" | "다시 확인" | "오류" | "알려 줌";
export type Entry = { at: string; run: string; goal: string; kind: Kind; name: string; result?: string; quote?: string; where?: string };

const file = () => path.join(DATA, "history.jsonl");
const clean = (s: unknown, n = 200) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
export const keyOf = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

/** 한 줄(여러 줄) 덧붙이기. 실패해도 학습은 멈추지 않는다 */
export async function add(...es: Omit<Entry, "at">[]) {
  const at = new Date().toISOString();
  const lines = es.filter((e) => e.name?.trim()).map((e) => JSON.stringify({ at, ...e, name: clean(e.name, 80), goal: clean(e.goal, 120), quote: e.quote ? clean(e.quote, 240) : undefined, where: e.where ? clean(e.where, 120) : undefined, result: e.result ? clean(e.result, 200) : undefined }));
  if (!lines.length) return;
  try { await mkdir(DATA, { recursive: true }); await appendFile(file(), lines.join("\n") + "\n"); } catch (e) { console.error("학습 기록:", e); }
}

/** 이 컴퓨터의 기록 전부(오래된 순) */
export async function localEntries(): Promise<Entry[]> {
  const t = await readFile(file(), "utf8").catch(() => "");
  return t.split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as Entry]; } catch { return []; } });
}
/** 다른 컴퓨터 것까지(앱에 모인 노트에 실려 온 것). 같은 줄은 한 번만 */
export async function allEntries(): Promise<Entry[]> {
  const L = await import("./learner-note.ts");
  const remote = await L.remoteNotes().catch(() => []);
  const seen = new Set<string>(), out: Entry[] = [];
  for (const e of [...(await localEntries()), ...remote.flatMap((n) => n.history ?? [])]) {
    const k = `${e.at}|${e.kind}|${e.name}|${e.run}`;
    if (!seen.has(k)) { seen.add(k); out.push(e); }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** 찾기(코드): 이름(띄어쓰기 · 대소문자 무시, 부분 일치) · 종류 · 최근 며칠 · 글. 최신 순 최대 limit줄 */
export async function search(q: { name?: string; kind?: string; days?: number; text?: string; limit?: number }, entries?: Entry[]) {
  const all = entries ?? (await allEntries());
  const since = q.days ? Date.now() - q.days * 86_400_000 : 0;
  const nk = q.name ? keyOf(q.name) : "", tk = q.text ? keyOf(q.text) : "";
  const hit = all.filter((e) => (!nk || keyOf(e.name).includes(nk) || nk.includes(keyOf(e.name))) && (!q.kind || e.kind === q.kind) && (!since || Date.parse(e.at) >= since)
    && (!tk || keyOf([e.name, e.goal, e.quote ?? "", e.result ?? "", e.where ?? ""].join(" ")).includes(tk)));
  return hit.reverse().slice(0, Math.min(Math.max(q.limit ?? 10, 1), 20));
}
const day = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
export const lineOf = (e: Entry) => `${day(e.at)} · ${e.kind} · ${e.name}${e.result ? ` → ${e.result}` : ""}${e.quote ? ` · "${e.quote}"` : ""}${e.where ? ` · ${e.where}` : ""} (목표: ${e.goal})`;

/** 튜터 도구 */
export const HISTORY_TOOL = {
  name: "search_history",
  description: "이 학습자의 학습 기록(모든 실습, 시간순)에서 찾는다. 새 이름이나 막힌 곳을 다루기 전에 전에 다룬 적 있는지 볼 때 쓴다. name(이름 · 개념, 부분 일치), kind(확인 · 봤음 · 씀 · 맞음 · 틀림 · 일부 · 막힘 · 다시 확인 · 오류 · 알려 줌), days(최근 며칠), text(글 안에서) 중 필요한 것만. 최신 순 최대 10줄.",
  properties: { name: { type: "string" }, kind: { type: "string" }, days: { type: "number" }, text: { type: "string" } },
  required: [] as string[],
};
export async function historyTool(input: Record<string, unknown>) {
  const rows = await search({ name: input.name ? String(input.name) : undefined, kind: input.kind ? String(input.kind) : undefined, days: Number(input.days) || undefined, text: input.text ? String(input.text) : undefined });
  return rows.length ? rows.map(lineOf).join("\n") : "찾은 기록이 없어요(처음 다루는 것으로 보면 돼요).";
}

/**
 * 새 이름을 펼쳐 보일지(코드, 11/11 사용자 "처음인지 써 본 사람인지 어떻게 판단해?" → 이름마다):
 * 1) 기록에 혼자 쓴 적 · 다시 확인 맞음 · 확인 됨이 있으면 접음  2) 이번 실습에서 학습자가 그 이름을 직접 쓴 적이 있으면 접음
 * 3) 본 적만 있으면 펼침  4) 기록이 없으면 처음 설문 답을 따름(처음 · 모르겠 → 펼침)
 */
export function shouldOpen(name: string, entries: Entry[], learnerText: string, beginner: boolean) {
  const k = keyOf(name);
  const mine = entries.filter((e) => keyOf(e.name) === k);
  if (mine.some((e) => (e.kind === "씀" && e.result !== "본 뒤에") || (e.kind === "다시 확인" && e.result === "맞음") || (e.kind === "확인" && e.result === "됨"))) return false;
  if (k.length >= 2 && keyOf(learnerText).includes(k)) return false;
  if (mine.some((e) => e.kind === "봤음" || e.kind === "알려 줌")) return true;
  return beginner;
}
