// 실습 정리 (11/16 사용자 "실습은 배운 거 담백하게 정리해서 알려주는 식", "알고리즘이랑 비슷하게 = 기본기 → A → B 층").
// 실습은 상황 재현(빈틈 · 장면)을 만들지 않는다. 실습 한 판의 기록을 처음부터 따라가며 배운 것을 목차처럼 층으로 정리한다(AI 1번).
// 첫 층은 기본기, 그다음은 만든 것을 이루는 단위들을 만든 순서대로. 코드 조각은 기록에 실제로 있는 것만 남긴다(코드가 확인).
// 복습은 알고리즘(상황 재현 장면)과 다르게: 어렵거나 애매했던 개념만 플래시카드로 만들어 기억 저장소에 넣는다(카드 복습 · 라이트너 상자가 맡음).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { askJson } from "../assist/model.ts";
import { course } from "./practice/course.ts";

type Ev = { at: string; kind: "me" | "tutor" | "button" | "cmd" | "save" | "note"; text: string; tools?: string[]; ok?: boolean; diff?: string[]; file?: string; err?: string };
type Chapter = { goal: string; events: Ev[] };
export type NoteCard = { q: string; a: string; knowledgeId?: string };
export type Trace = { title: string; blocks: Array<{ file: string; code: string }>; cases: Array<{ situation: string; result: string }>; why: string; moments: number[]; knowledgeId?: string };
export type Notes = { made: string; traces?: Trace[]; layers: Array<{ name: string; items: Array<{ name: string; learned: string; code: string; state: "확실" | "애매"; moments: number[]; card: NoteCard }> }> };
export type NotesAsk = (system: string, user: string, schema: Record<string, unknown>) => Promise<Notes>;

export const NOTES_SYSTEM = `실습(학습자가 직접 무언가를 만들며 튜터와 대화한 기록)을 처음부터 시간 순서대로 따라가며, 학습자가 배운 것을 담백하게 정리한다.
목차처럼 층으로 나눈다:
- 첫 층은 "기본기": 이 실습이 아니어도 쓰는 언어 문법 · 도구 · 명령 사용법.
- 그다음 층은 만든 것을 이루는 단위들을, 만든 순서대로(예: 기본기 → 파일 읽기 → 단어 세기 → 결과 정렬). 층 이름은 짧게.
층마다 배운 것(items):
- name: 짧은 이름.
- learned: 무엇을 어떻게 하는지 한두 문장. 쉬운 말로, 상황으로. 사실만.
- code: 학습자가 실제로 쓰거나 돌린 코드 · 명령 한두 줄(기록에 그대로 있는 것만). 없으면 빈 문자열.
- state: 확실(학습자가 스스로 해냄) / 애매(튜터가 고쳐 주거나 코드를 줘서 했거나, 해 놓고 다시 헷갈려 함).
- moments: 근거가 된 순간 번호들.
- card: 나중에 다시 물을 플래시카드. 어렵거나 애매했던 개념(state가 애매이거나, 이 실습의 핵심이라 잊기 쉬운 것)에만 만든다. q는 상황으로 묻는 질문 한 줄(예: "파일을 다 읽은 뒤 저절로 닫히게 하려면 어떻게 여나요?"), a는 짧은 답(필요하면 코드 한 줄). 쉬운 것 · 문법 한 줄짜리는 q · a를 빈 문자열로.
평가 · 칭찬 · 탓 · 버릇 단정 · 조언은 쓰지 않는다. 배운 것이 없는 층은 만들지 않는다. 같은 것은 한 번만.
made: 이 실습에서 만든 것을 한 줄로.
traces: 따라가 보기 문제 0~3개. 학습자가 실제로 저장한 코드에서 서로 이어지는 블록 두세 개(예: 서버의 처리 함수와 그것을 부르는 클라이언트 코드, 함수와 그 호출부)를 골라, 상황에 따라 무엇이 나오는지 추적하게 한다.
- blocks: 파일 이름과 코드(기록의 저장 내용에 그대로 있는 줄 몇 개씩, 앞의 + 표시는 뺌).
- cases: 상황 두셋과 그때 나오는 결과(출력 · 응답 · 오류). 기록에서 실제로 나온 결과가 있으면 그것을 쓴다. 예: "이름 없이 요청하면" → "400과 '이름이 필요해요'".
- why: 왜 그렇게 나오는지 한두 문장. title: 무엇을 따라가는지 짧게.
이어지는 코드가 기록에 없으면 빈 배열.`;
const str = { type: "string" } as const;
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
export const NOTES_SCHEMA = obj({ made: str,
  traces: { type: "array", items: obj({ title: str, blocks: { type: "array", items: obj({ file: str, code: str }) }, cases: { type: "array", items: obj({ situation: str, result: str }) }, why: str, moments: { type: "array", items: { type: "integer" } } }) },
  layers: { type: "array", items: obj({ name: str, items: { type: "array", items: obj({ name: str, learned: str, code: str, state: { type: "string", enum: ["확실", "애매"] }, moments: { type: "array", items: { type: "integer" } }, card: obj({ q: str, a: str }) }) } }) } });

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(11, 16);
/** 실습 기록 → 순간 번호가 붙은 글. 목표가 바뀌면 제목 줄. */
export function notesUser(title: string, chapters: Chapter[]) {
  let n = 0, goal = "";
  const lines: string[] = [];
  for (const c of chapters) {
    if (c.goal && c.goal !== goal) { goal = c.goal; lines.push(`\n[목표] ${goal}`); }
    for (const e of c.events) {
      n++;
      const t = `#${n} ${kst(e.at)}`;
      if (e.kind === "me") lines.push(`${t} 학습자: ${clip(e.text, 600)}`);
      else if (e.kind === "tutor") lines.push(`${t} 튜터: ${clip(e.text, 600)}${e.tools?.length ? ` (튜터가 한 일: ${e.tools.join(", ")})` : ""}`);
      else if (e.kind === "cmd") lines.push(`${t} 실행: ${clip(e.text, 200)} → ${e.ok === false ? `실패${e.err ? ` (${clip(e.err, 200)})` : ""}` : "성공"}`);
      else if (e.kind === "save") lines.push(`${t} 저장 ${e.file ?? ""}${e.diff?.length ? `\n${e.diff.slice(0, 30).join("\n")}` : ""}`);
      else lines.push(`${t} ${e.kind === "button" ? "버튼" : "알림"}: ${clip(e.text, 200)}`);
    }
  }
  return { text: `[실습] ${title}\n${lines.join("\n")}`, count: n };
}

/** 코드가 확인: code는 기록 글에 실제로 있어야 남긴다. 기본기 층은 맨 앞으로. 빈 층은 뺀다. */
export function cleanNotes(notes: Notes, recordText: string): Notes {
  const squash = (s: string) => s.replace(/\s+/g, "");
  // 저장 내용의 줄 앞 +/- 표시는 떼고 비교한다(코드 조각이 여러 줄이어도 맞게)
  const unmark = (c: string) => c.split("\n").map((l) => l.replace(/^[+-] ?/, "")).join("\n");
  const hay = squash(unmark(recordText));
  const layers = (notes.layers ?? []).map((l) => ({ ...l, items: (l.items ?? []).filter((x) => x.name?.trim() && x.learned?.trim())
    .map((x) => ({ ...x, code: x.code?.trim() && hay.includes(squash(x.code)) ? x.code.trim() : "", card: { q: x.card?.q?.trim() ?? "", a: x.card?.a?.trim() ?? "" } })) })).filter((l) => l.items.length);
  const basic = layers.findIndex((l) => /기본기/.test(l.name));
  if (basic > 0) layers.unshift(...layers.splice(basic, 1));
  // 따라가 보기: 코드 블록은 기록에 있는 것만(앞의 +/- 표시를 뗀 줄들이 기록에 있어야), 블록이나 상황이 없으면 뺀다
  const traces = (notes.traces ?? []).slice(0, 3).map((t) => ({ ...t, blocks: (t.blocks ?? []).map((b) => ({ file: b.file ?? "", code: unmark(b.code ?? "").trim() }))
    .filter((b) => b.code && hay.includes(squash(b.code))), cases: (t.cases ?? []).filter((c) => c.situation?.trim() && c.result?.trim()) }))
    .filter((t) => t.blocks.length && t.cases.length);
  return { made: notes.made ?? "", traces, layers };
}

/** 카드가 있는 항목만 기억 저장소에(같은 이름이면 저장소가 합침). 실패해도 정리는 남긴다. */
async function rememberCards(notes: Notes, title: string, runId: string) {
  const withCard = notes.layers.flatMap((l) => l.items.filter((x) => x.card?.q?.trim() && x.card?.a?.trim()).map((x) => ({ l, x })));
  const traces = notes.traces ?? [];
  if (!withCard.length && !traces.length) return;
  try {
    const { saveMany } = await import("../knowledge/api.ts");
    const saved = await saveMany(withCard.map(({ l, x }) => ({ title: x.name, body: `${x.card.a}${x.code ? `\n${x.code}` : ""}\n(${l.name} · ${x.learned})`, state: x.state === "애매" ? "unknown" as const : "met" as const,
      source: { kind: "chat" as const, title, ref: runId }, ask: x.card.q, topicHint: l.name })));
    withCard.forEach(({ x }, i) => { if (saved[i]) x.card.knowledgeId = saved[i].item.id; });
    // 따라가 보기도 카드로: 앞면 = 코드 + 상황들, 뒷면 = 상황별 결과 + 왜
    const tr = await saveMany(traces.map((t) => ({ title: `따라가 보기: ${t.title}`, state: "unknown" as const, source: { kind: "chat" as const, title, ref: runId }, topicHint: "따라가 보기",
      ask: `${t.blocks.map((b) => `[${b.file}]\n${b.code}`).join("\n\n")}\n\n${t.cases.map((c) => `· ${c.situation} → ?`).join("\n")}`,
      body: `${t.cases.map((c) => `· ${c.situation} → ${c.result}`).join("\n")}\n왜: ${t.why}` })));
    traces.forEach((t, i) => { if (tr[i]) t.knowledgeId = tr[i].item.id; });
  } catch (e) { console.warn(`[practice-notes] 기억 저장소에 카드를 넣지 못했어요: ${(e as Error).message}`); }
}

const dir = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "practice-notes");
const file = (runId: string) => path.join(dir(), `${runId}.json`);
export async function readNotes(runId: string): Promise<{ at: string; notes: Notes } | null> {
  try { return JSON.parse(await readFile(file(runId), "utf8")); } catch { return null; }
}
const defaultAsk: NotesAsk = (system, user, schema) => askJson<Notes>("practice:notes", system, user, schema, { model: "gpt-6.1-terra", effort: "medium" });
/** 실습 한 판을 정리한다(AI 1번). 다시 하면 덮어쓴다. */
export async function makeNotes(runId: string, ask: NotesAsk = defaultAsk) {
  const lib = await course<{ online?: boolean; run?: { title?: string }; title?: string; scenes?: Chapter[] }>(`runs/${encodeURIComponent(runId)}/library`, { timeout: 15000 });
  const chapters = lib.scenes ?? [];
  const { text, count } = notesUser(lib.run?.title ?? lib.title ?? "실습", chapters);
  if (!count) throw Object.assign(new Error("이 실습에는 아직 정리할 기록이 없어요."), { status: 400 });
  const notes = cleanNotes(await ask(NOTES_SYSTEM, text, NOTES_SCHEMA), text);
  await rememberCards(notes, lib.title || "실습", runId);
  const out = { at: new Date().toISOString(), notes };
  await mkdir(dir(), { recursive: true });
  await writeFile(file(runId), JSON.stringify(out, null, 1), "utf8");
  return out;
}
