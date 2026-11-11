// 실습 일지(2026-11-12 사용자 "사람이 봤을 때 메리트가 있으려면 AI의 손길이 한번 닿아서 요약이 딱 돼야 돼 … 처음에 목표를 뭐로 설정했어요,
// 근데 뭐가 막혀서 뭐로 바꿨어요 … 저장할 때 AI가 한번 돌리고, 여기(도서관)서는 그냥 보여주기만", "말투는 나랑 비슷하게").
// 실습 하나에 한 장. 장면 기록(library.ts scenesOf: 내 말 · 튜터 답 · 버튼 · 터미널 · 저장 · 큰 바뀜)을 AI가 한 번 읽고
// 한 줄 · 흐름(4~10개, 각 항목이 근거 기록 번호를 가리킴) · 남은 것을 쓴다. 쓰는 때: 목표 정리 뒤 · 학습 종료 · 손 놓고 15분 · 다른 실습으로 옮김.
// 새 기록이 없으면 다시 쓰지 않는다(같은 기록에 AI 두 번 없음). 근거 번호 · 꼬리표는 코드가 검사한다.
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { DATA, read, writeAtomic } from "./store.ts";
import { aiJson, S } from "./ai.ts";

export const TAGS = ["목표", "바꿈", "막힘", "알게 됨", "해냄", "도움", "넘어감"] as const;
export type Tag = (typeof TAGS)[number];
export type DiaryItem = { g: number | null; tag: Tag; text: string };
export type Diary = { at: string; upto: number; why: string; line: string; story: DiaryItem[]; left: string[] };
const file = (runId: string) => path.join(DATA, "goals", `${runId}.diary.json`);
export const diaryOf = (runId: string) => read<Diary | null>(file(runId), null);

export const DIARY_SYSTEM = `실습 기록(학습자와 튜터의 대화 · 누른 버튼 · 터미널 명령 · 저장 · 목표가 바뀐 것)을 읽고, 학습자가 나중에 다시 볼 "실습 일지"를 쓴다.
말투: 학습자가 자기 노트에 쓰듯 짧은 반말 음슴체. 예) "처음엔 REST API 요청 · 응답 이해하는 걸 목표로 잡음", "split에 괄호 안 붙여서 TypeError 남", "메서드는 괄호를 붙여야 실행된다는 거 알게 됨", "기초 확인은 너무 쉬워서 넘기고 예시 코드부터 보기로 바꿈".
line: 이번 실습 전체를 한 줄로(40자 안팎). 무엇을 하려다 어디까지 갔는지.
story: 일어난 순서대로 4~10개. 각 항목 { g, tag, text }.
- g: 근거가 되는 기록 번호(기록 줄 앞의 [숫자]). 꼭 기록에 있는 번호.
- tag: 목표(목표를 처음 잡음) · 바꿈(목표 · 방향을 바꿈) · 막힘(어디서 막혔나) · 알게 됨(몰랐다가 알게 됨) · 해냄(직접 해서 됨) · 도움(튜터가 코드를 써 주거나 고쳐 줌) · 넘어감(안 하고 넘어감) 중 하나.
- text: 60자 안. 바꿈은 왜 바꿨는지 같이("…가 막혀서 …로 바꿈"). 알게 됨은 "X 헷갈렸음 → Y" 꼴로.
- 목표를 잡거나 바꾼 일은 빠뜨리지 않는다. 학습자가 헷갈린 말 · 틀린 판정 · 오류는 중요하다.
- 튜터가 말만 하고 학습자가 반응 없이 지나간 것은 알게 됨으로 쓰지 않는다. 튜터가 대신 한 것을 학습자가 한 것처럼 쓰지 않는다(도움).
- 기록에 없는 것은 지어내지 않는다. 같은 일을 두 번 쓰지 않는다.
left: 아직 안 된 것 · 다음에 볼 것 0~3개(기록에 근거한 것만, 각 40자 안). 없으면 빈 배열.`;
const SCHEMA = S.obj({ line: S.str, story: S.arr(S.obj({ g: S.int, tag: S.oneOf(...TAGS), text: S.str })), left: S.arr(S.str) });

const clip = (s: string, n: number) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
/** 장면 기록 → AI에게 줄 글. 튜터 답은 앞부분만(길면 전체를 줄여서 3만 자 안으로) */
export function diaryInput(long: string, chapters: Array<{ goal: string; events: Array<{ g?: number; kind: string; text: string; ok?: boolean; err?: string; file?: string; diff?: string[]; tools?: string[] }> }>, records: Array<{ goal: string; status: string; summary: string }>) {
  const build = (tutorMax: number) => {
    const lines: string[] = [`[장기 목표] ${long || "(아직 없음)"}`, "[기록]"];
    for (const c of chapters) {
      const rec = records.find((r) => r.goal === c.goal);
      lines.push(`== 현재 목표: ${c.goal || "(정하기 전)"}${rec ? ` — ${rec.status}` : ""} ==`);
      for (const e of c.events) {
        const n = `[${e.g}]`;
        if (e.kind === "me") lines.push(`${n} 나: ${clip(e.text, 500)}`);
        else if (e.kind === "tutor") lines.push(`${n} 튜터: ${clip(e.text.replace(/```[\s\S]*?```/g, " [코드] "), tutorMax)}${e.tools?.length ? ` (도구: ${[...new Set(e.tools)].slice(0, 4).join(", ")})` : ""}`);
        else if (e.kind === "button") lines.push(`${n} 버튼: ${clip(e.text, 300)}`);
        else if (e.kind === "cmd") lines.push(`${n} 터미널: ${clip(e.text, 120)} → ${e.ok === false ? `오류 ${clip(e.err ?? "", 160)}` : e.ok ? "성공" : "?"}`);
        else if (e.kind === "save") lines.push(`${n} 저장: ${e.file ?? ""} (바뀐 줄 ${e.diff?.length ?? 0})`);
        else lines.push(`${n} 바뀜: ${clip(e.text, 200)}`);
      }
    }
    return lines.join("\n");
  };
  let max = 600, out = build(max);
  while (out.length > 30000 && max > 80) { max = Math.floor(max * 0.6); out = build(max); }
  return out.slice(-30000);
}

/** AI 답 검사: 근거 번호는 기록에 있는 것만, 꼬리표는 일곱 중 하나(아니면 버림), 글 길이 */
export function cleanDiary(raw: { line?: unknown; story?: unknown; left?: unknown }, valid: Set<number>): Omit<Diary, "at" | "upto" | "why"> {
  const story = (Array.isArray(raw.story) ? raw.story : []).flatMap((x) => {
    const o = x as { g?: unknown; tag?: unknown; text?: unknown };
    const tag = String(o.tag ?? "").trim() as Tag, text = clip(String(o.text ?? ""), 90);
    if (!TAGS.includes(tag) || !text) return [];
    const g = typeof o.g === "number" && valid.has(o.g) ? o.g : null;
    return [{ g, tag, text }];
  }).slice(0, 12);
  return { line: clip(String(raw.line ?? ""), 80), story, left: (Array.isArray(raw.left) ? raw.left : []).map((x) => clip(String(x), 60)).filter(Boolean).slice(0, 3) };
}

const writing = new Map<string, Promise<Diary | null>>();
/** 새 기록이 있으면 일지를 (다시) 쓴다. force면 새 기록이 없어도 */
export function writeDiary(runId: string, why: string, force = false): Promise<Diary | null> {
  const busy = writing.get(runId);
  if (busy) return busy;
  const job = (async () => {
    const L = await import("./library.ts"), GR = await import("./goal-record.ts"), G = await import("./goals.ts");
    const [recs, g] = await Promise.all([GR.recordsOf(runId).catch(() => []), G.goalsOf(runId)]);
    const chapters = await L.scenesOf(runId, recs.map((x) => ({ goal: x.goal, from: x.from, to: x.to })));
    const events = chapters.flatMap((c) => c.events);
    const mine = events.filter((e) => e.kind === "me").length;
    if (mine < 2) return null; // 말 한두 마디로는 쓸 게 없다
    const before = await diaryOf(runId);
    if (!force && before && before.upto >= events.length) return before;
    const raw = await aiJson<{ line: string; story: unknown[]; left: string[] }>("diary", DIARY_SYSTEM, diaryInput(g.long?.text ?? "", chapters, recs), SCHEMA);
    const d: Diary = { at: new Date().toISOString(), upto: events.length, why, ...cleanDiary(raw, new Set(events.map((e) => e.g!).filter((x) => x !== undefined))) };
    if (!d.story.length) return before;
    await mkdir(path.dirname(file(runId)), { recursive: true });
    await writeAtomic(file(runId), JSON.stringify(d, null, 1));
    return d;
  })().catch(() => null).finally(() => writing.delete(runId));
  writing.set(runId, job);
  return job;
}

// 손 놓고 15분: 마지막 행동 뒤 아무 일이 없으면 그때까지로 쓴다(도중에 나간 실습도 일지가 남게)
const IDLE_MS = Number(process.env.PC_DIARY_IDLE_MS ?? 15 * 60_000);
const timers = new Map<string, ReturnType<typeof setTimeout>>();
export function diaryLater(runId: string) {
  if (process.env.PC_DIARY === "0") return;
  clearTimeout(timers.get(runId));
  const t = setTimeout(() => { timers.delete(runId); void writeDiary(runId, "손 놓고 15분"); }, IDLE_MS);
  t.unref?.();
  timers.set(runId, t);
}
/** 지금 바로(목표 정리 뒤 · 학습 종료 · 다른 실습으로 옮김) */
export function diaryNow(runId: string, why: string) {
  if (process.env.PC_DIARY === "0") return;
  clearTimeout(timers.get(runId)); timers.delete(runId);
  void writeDiary(runId, why);
}
