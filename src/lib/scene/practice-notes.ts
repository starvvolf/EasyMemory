// 실습 정리 (11/16, 사용자 "실습에서 배운 메인 빌드만, 뭘 위해서 어떻게 한다는 식의 친절한 설명으로 실습 내용 복습하는 느낌").
// 실습은 상황 재현(빈틈 · 장면)도, 카드도 만들지 않는다. 실습 한 판의 기록을 처음부터 따라가며 메인 빌드를 단계로 다시 들려준다(AI 1번).
// 단계마다: 무엇을 위해 → 어떻게 했나 → 핵심 코드(기록에 있는 것만, 코드가 확인) → 기억할 것. 환경 설치 · 오타 같은 곁가지는 넣지 않는다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { askJson } from "../assist/model.ts";
import { course } from "./practice/course.ts";

type Ev = { at: string; kind: "me" | "tutor" | "button" | "cmd" | "save" | "note"; text: string; tools?: string[]; ok?: boolean; diff?: string[]; file?: string; err?: string };
type Chapter = { goal: string; events: Ev[] };
export type Step = { title: string; why: string; how: string; code: Array<{ file: string; code: string }>; remember: string; moments: number[] };
export type Notes = { made: string; steps: Step[] };
export type NotesAsk = (system: string, user: string, schema: Record<string, unknown>) => Promise<Notes>;

export const NOTES_SYSTEM = `실습(학습자가 직접 무언가를 만들며 튜터와 대화한 기록)을 처음부터 시간 순서대로 따라가며, 그 실습에서 만든 메인 빌드를 학습자에게 다시 들려주는 복습 글을 쓴다.
- 메인 빌드만 다룬다: 만든 것이 어떤 단계를 거쳐 완성됐는지. 개발 환경 설치 · 경로 · 명령 옵션 · 오타 · 괄호 같은 곁가지는 쓰지 않는다(그것 때문에 오래 막혔어도 빌드의 단계가 아니면 뺀다).
- steps: 만든 순서대로 3~7단계. 단계마다
  · title: 그 단계에서 만든 것을 짧게(예: "두 연결을 동시에 받기").
  · why: 이 단계가 무엇을 위해 필요했는지 한두 문장. 앞 단계에서 무엇이 모자라서 이걸 했는지 이어지게.
  · how: 어떻게 했는지 2~4문장. 친절하게, 쉬운 말로, 상황으로 풀어서(용어는 처음 나올 때 한 번 풀어 준다). 학습자가 실제로 한 순서대로.
  · code: 그 단계의 핵심 코드 한두 조각(파일 이름과, 기록의 저장 내용에 그대로 있는 줄 몇 개, 앞의 + 표시는 뺌). 없으면 빈 배열.
  · remember: 이 단계에서 꼭 기억할 것 한 줄(헷갈렸던 점이 있으면 그것을 바로잡는 말로).
  · moments: 근거가 된 순간 번호들.
- made: 이 실습에서 만든 것을 한 줄로(무엇을 하는 프로그램인지).
- 평가 · 칭찬 · 탓 · 조언 · "다음엔 ~해 보세요"는 쓰지 않는다. 기록에 없는 것은 지어내지 않는다.`;
const str = { type: "string" } as const;
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
export const NOTES_SCHEMA = obj({ made: str, steps: { type: "array", items: obj({ title: str, why: str, how: str,
  code: { type: "array", items: obj({ file: str, code: str }) }, remember: str, moments: { type: "array", items: { type: "integer" } } }) } });

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

/** 코드가 확인: 코드 조각은 기록에 실제로 있어야 남긴다(저장 내용의 줄 앞 +/- 표시는 떼고 비교). 빈 단계는 뺀다. */
export function cleanNotes(notes: Notes, recordText: string): Notes {
  const squash = (x: string) => x.replace(/\s+/g, "");
  const unmark = (c: string) => c.split("\n").map((l) => l.replace(/^[+-] ?/, "")).join("\n");
  const hay = squash(unmark(recordText));
  const steps = (notes.steps ?? []).filter((x) => x.title?.trim() && (x.how?.trim() || x.why?.trim()))
    .map((x) => ({ ...x, code: (x.code ?? []).map((c) => ({ file: c.file ?? "", code: unmark(c.code ?? "").trim() })).filter((c) => c.code && hay.includes(squash(c.code))) }));
  return { made: notes.made ?? "", steps };
}

const dir = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "practice-notes");
const file = (runId: string) => path.join(dir(), `${runId}.json`);
export async function readNotes(runId: string): Promise<{ at: string; notes: Notes } | null> {
  try { const d = JSON.parse(await readFile(file(runId), "utf8")); return Array.isArray(d?.notes?.steps) ? d : null; } catch { return null; } // 옛 모양(층 · 카드)은 다시 만든다
}
const defaultAsk: NotesAsk = (system, user, schema) => askJson<Notes>("practice:notes", system, user, schema, { model: "gpt-6.1-terra", effort: "medium" });
/** 실습 한 판을 정리한다(AI 1번). 다시 하면 덮어쓴다. */
export async function makeNotes(runId: string, ask: NotesAsk = defaultAsk, given?: { title?: string; scenes?: Chapter[] }) {
  const lib = given ?? await course<{ online?: boolean; run?: { title?: string }; title?: string; scenes?: Chapter[] }>(`runs/${encodeURIComponent(runId)}/library`, { timeout: 15000 });
  const chapters = lib.scenes ?? [];
  const { text, count } = notesUser(lib.title || "실습", chapters);
  if (!count) throw Object.assign(new Error("이 실습에는 아직 정리할 기록이 없어요."), { status: 400 });
  const notes = cleanNotes(await ask(NOTES_SYSTEM, text, NOTES_SCHEMA), text);
  const out = { at: new Date().toISOString(), notes };
  await mkdir(dir(), { recursive: true });
  await writeFile(file(runId), JSON.stringify(out, null, 1), "utf8");
  return out;
}

/** 같은 실습을 두 번 만들지 않게(11/16): 만드는 중이면 그 작업을 같이 기다린다. 화면을 떠났다 돌아와도 이어서 보인다. */
const inflight = new Map<string, ReturnType<typeof makeNotes>>();
export function makeNotesOnce(runId: string) {
  const had = inflight.get(runId);
  if (had) return had;
  const p = makeNotes(runId).finally(() => inflight.delete(runId));
  inflight.set(runId, p);
  return p;
}
export const notesPending = (runId: string) => inflight.has(runId);
