// 실습 정리 (11/16 두 번째, 사용자 "어렵게 가지 말고 어떤 거 배웠는지 담백하게 강의식으로 … 앞뒤 없이 코드 블럭만 보면 이해가 안 되니 개념과 원리로만").
// 실습은 상황 재현(빈틈 · 장면)도, 카드도, 코드 조각도 만들지 않는다. 실습 한 판의 기록을 따라가며 그 실습에서 배운 개념을 강의하듯 다시 들려준다(AI 1번).
// 개념마다: 무엇인가 → 원리(왜 · 어떻게 동작하나) → 이 실습에서는 → 기억할 것. 환경 설치 · 오타 같은 곁가지는 넣지 않는다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { askJson } from "../assist/model.ts";
import { course } from "./practice/course.ts";

type Ev = { at: string; kind: "me" | "tutor" | "button" | "cmd" | "save" | "note"; text: string; tools?: string[]; ok?: boolean; diff?: string[]; file?: string; err?: string };
type Chapter = { goal: string; events: Ev[] };
export type Lesson = { title: string; concept: string; principle: string; inPractice: string; remember: string; moments: number[] };
export type Notes = { made: string; lessons: Lesson[] };
export type NotesAsk = (system: string, user: string, schema: Record<string, unknown>) => Promise<Notes>;

export const NOTES_SYSTEM = `실습(학습자가 직접 무언가를 만들며 튜터와 대화한 기록)을 처음부터 시간 순서대로 따라가며, 그 실습에서 배운 개념과 원리를 강의하듯 담백하게 다시 들려주는 복습 글을 쓴다.
- 코드는 보여주지 않는다. 앞뒤 없이 코드 조각만 보면 알아보기 어렵기 때문이다. 함수 · 명령 이름은 필요할 때 이름만 짧게 말한다.
- 배운 개념만 다룬다: 이 실습의 메인 빌드에 쓰인 개념 · 원리. 개발 환경 설치 · 경로 · 명령 옵션 · 오타 · 괄호 같은 곁가지는 쓰지 않는다(그것 때문에 오래 막혔어도 뺀다).
- lessons: 배운 순서대로 3~6개. 개념마다
  · title: 개념 이름을 짧게(예: "소켓과 포트").
  · concept: 그것이 무엇인지 한두 문장. 처음 듣는 사람도 알아듣게 쉬운 말로, 일상의 비유가 맞으면 하나.
  · principle: 왜 필요하고 어떻게 동작하는지 2~4문장. 강의하듯 차분하게, 앞 개념과 이어지게.
  · inPractice: 이 실습에서 그 개념을 어디에 어떻게 썼는지 한두 문장(만든 것의 상황으로).
  · remember: 꼭 기억할 것 한 줄(헷갈렸던 점이 있으면 그것을 바로잡는 말로).
  · moments: 근거가 된 순간 번호들.
- made: 이 실습에서 만든 것을 한 줄로(무엇을 하는 프로그램인지).
- 평가 · 칭찬 · 탓 · 조언 · "다음엔 ~해 보세요"는 쓰지 않는다. 기록에 없는 것은 지어내지 않는다.`;
const str = { type: "string" } as const;
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
export const NOTES_SCHEMA = obj({ made: str, lessons: { type: "array", items: obj({ title: str, concept: str, principle: str, inPractice: str, remember: str,
  moments: { type: "array", items: { type: "integer" } } }) } });

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

/** 빈 개념은 빼고, 글에 섞여 온 코드 블록(```)은 걷어낸다. 순간 번호는 기록에 있는 것만. */
export function cleanNotes(notes: Notes, count: number): Notes {
  const plain = (x: string | undefined) => (x ?? "").replace(/```[\s\S]*?(```|$)/g, "").trim();
  const lessons = (notes.lessons ?? []).map((x) => ({ title: plain(x.title), concept: plain(x.concept), principle: plain(x.principle), inPractice: plain(x.inPractice),
    remember: plain(x.remember), moments: (x.moments ?? []).filter((m) => Number.isInteger(m) && m >= 1 && m <= count) }))
    .filter((x) => x.title && (x.concept || x.principle));
  return { made: notes.made ?? "", lessons };
}

const dir = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "practice-notes");
const file = (runId: string) => path.join(dir(), `${runId}.json`);
export async function readNotes(runId: string): Promise<{ at: string; notes: Notes } | null> {
  try { const d = JSON.parse(await readFile(file(runId), "utf8")); return Array.isArray(d?.notes?.lessons) ? d : null; } catch { return null; } // 옛 모양(층 · 카드 · 단계와 코드)은 다시 만든다
}
const defaultAsk: NotesAsk = (system, user, schema) => askJson<Notes>("practice:notes", system, user, schema, { model: "gpt-6.1-terra", effort: "medium" });
/** 실습 한 판을 정리한다(AI 1번). 다시 하면 덮어쓴다. */
export async function makeNotes(runId: string, ask: NotesAsk = defaultAsk, given?: { title?: string; scenes?: Chapter[] }) {
  const lib = given ?? await course<{ online?: boolean; run?: { title?: string }; title?: string; scenes?: Chapter[] }>(`runs/${encodeURIComponent(runId)}/library`, { timeout: 15000 });
  const chapters = lib.scenes ?? [];
  const { text, count } = notesUser(lib.title || "실습", chapters);
  if (!count) throw Object.assign(new Error("이 실습에는 아직 정리할 기록이 없어요."), { status: 400 });
  const notes = cleanNotes(await ask(NOTES_SYSTEM, text, NOTES_SCHEMA), count);
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
