// 실습 정리 (11/16 두 번째, 사용자 "어렵게 가지 말고 어떤 거 배웠는지 담백하게 강의식으로 … 앞뒤 없이 코드 블럭만 보면 이해가 안 되니 개념과 원리로만").
// 실습은 상황 재현(빈틈 · 장면)도, 카드도, 코드 조각도 만들지 않는다. 실습 한 판의 기록을 따라가며 그 실습에서 배운 개념을 강의하듯 다시 들려준다(AI 1번).
// 개념마다: 무엇인가 → 원리(왜 · 어떻게 동작하나) → 이 실습에서는 → 기억할 것. 환경 설치 · 오타 같은 곁가지는 넣지 않는다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { askJson } from "../assist/model.ts";
import { course } from "./practice/course.ts";

type Ev = { at: string; kind: "me" | "tutor" | "button" | "cmd" | "save" | "note"; text: string; tools?: string[]; ok?: boolean; diff?: string[]; file?: string; err?: string };
type Chapter = { goal: string; events: Ev[] };
export type Lesson = { title: string; concept: string; why?: string; how?: string; code?: string; codeNote?: string; principle?: string; inPractice: string; remember: string; moments: number[] };
export type Notes = { made: string; intro?: string; lessons: Lesson[]; summary?: { title: string; line: string }[] };
export type NotesAsk = (system: string, user: string, schema: Record<string, unknown>) => Promise<Notes>;

// 11/20 사용자: "실습의 내용을 교과서나 참고서처럼 잘 정리" — 장 도입 · 개념마다(정의 → 왜 필요한가 → 어떻게 동작하나 → 이 실습의 코드 → 이 실습에서는 → 기억할 것) · 끝 정리 표.
// 코드는 이 실습에서 실제로 쓴 핵심 몇 줄만, 앞뒤 설명과 함께(앞뒤 없이 코드만 보이면 알아보기 어렵다는 11/16 의견을 지킨다). 흔한 실수 칸은 두지 않는다(사용자 11/20).
export const NOTES_SYSTEM = `실습(학습자가 직접 무언가를 만들며 튜터와 대화한 기록)을 처음부터 시간 순서대로 따라가며, 그 실습에서 배운 개념을 교과서나 참고서의 한 장처럼 정리한다. 처음 배우는 사람이 이 글만 읽고 개념과 원리를 이해하고, 이 실습에서 무엇을 만들었는지 떠올릴 수 있어야 한다. 쉬운 해요체가 아니라 교과서 문체(~다)로 쓴다.
- 배운 개념만 다룬다: 이 실습의 메인 빌드에 쓰인 개념 · 원리. 개발 환경 설치 · 경로 · 명령 옵션 · 오타 · 괄호 같은 곁가지는 쓰지 않는다(그것 때문에 오래 막혔어도 뺀다).
- made: 이 실습에서 만든 것을 한 줄로(무엇을 하는 프로그램인지).
- intro: 장 도입 2~3문장. 이 장에서 다루는 문제가 무엇이고, 아래 개념들이 어떤 순서로 이어지는지.
- lessons: 배운 순서대로 4~7개. 개념마다
  · title: 개념 이름을 짧게(예: "공유 자원과 잠금").
  · concept: 정의 한두 문장. 처음 듣는 사람도 알아듣게, 일상의 비유가 맞으면 하나.
  · why: 왜 필요한가 2~3문장. 이것이 없으면 어떤 문제가 생기는지.
  · how: 어떻게 동작하나. 단계가 있으면 "1. … 2. …"처럼 줄을 나눠 3~5단계, 아니면 3~5문장. 앞 개념과 이어지게.
  · code: 이 실습에서 학습자가 실제로 쓰거나 고친 코드 중 이 개념의 핵심 로직 3~15줄(기록에 있는 그대로, 언어 그대로). 핵심 로직 = 그 개념이 실제로 일어나는 줄: 상태를 확인하고 바꾸는 줄, 잠그는 줄, 트랜잭션을 거는 메서드, 연결 · 읽기 · 쓰기 같은 동작. 선언 · import · DTO · record · 출력문만 있는 조각은 고르지 않는다. 핵심 줄이 여러 곳에 나뉘어 있으면 필요한 줄만 이어 붙이고 건너뛴 곳은 // … 한 줄로 표시한다. 기록에 맞는 코드가 없거나 코드로 보여 줄 개념이 아니면 빈 문자열.
  · codeNote: code가 있으면 그 코드의 어느 줄이 무엇을 하는지 1~3문장(줄이나 이름을 짚어서). 없으면 빈 문자열.
  · inPractice: 이 실습에서 그 개념을 어디에 어떻게 썼고 무엇을 확인했는지 한두 문장(만든 것의 상황으로).
  · remember: 꼭 기억할 것 한 줄(헷갈렸던 점이 있으면 그것을 바로잡는 말로).
  · moments: 근거가 된 순간 번호들.
- summary: 끝 정리 표. lessons마다 {title: 같은 이름, line: 한 줄 요약}.
- 평가 · 칭찬 · 탓 · 조언 · "다음엔 ~해 보세요"는 쓰지 않는다. 기록에 없는 사실 · 코드는 지어내지 않는다.`;
const str = { type: "string" } as const;
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
export const NOTES_SCHEMA = obj({ made: str, intro: str, lessons: { type: "array", items: obj({ title: str, concept: str, why: str, how: str, code: str, codeNote: str, inPractice: str, remember: str,
  moments: { type: "array", items: { type: "integer" } } }) }, summary: { type: "array", items: obj({ title: str, line: str }) } });

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(11, 16);
/** 실습 기록 → 순간 번호가 붙은 글. 목표가 바뀌면 제목 줄. */
export function notesUser(title: string, chapters: Chapter[], code: { file: string; text: string }[] = []) {
  let n = 0, goal = "";
  const lines: string[] = [];
  for (const c of chapters) {
    if (c.goal && c.goal !== goal) { goal = c.goal; lines.push(`\n[목표] ${goal}`); }
    for (const e of c.events) {
      n++;
      const t = `#${n} ${kst(e.at)}`;
      if (e.kind === "me") lines.push(`${t} 학습자: ${clip(e.text, 600)}`);
      else if (e.kind === "tutor") lines.push(`${t} 튜터: ${clip(e.text, 1500)}${e.tools?.length ? ` (튜터가 한 일: ${e.tools.join(", ")})` : ""}`);
      else if (e.kind === "cmd") lines.push(`${t} 실행: ${clip(e.text, 200)} → ${e.ok === false ? `실패${e.err ? ` (${clip(e.err, 200)})` : ""}` : "성공"}`);
      else if (e.kind === "save") lines.push(`${t} 저장 ${e.file ?? ""}${e.diff?.length ? `\n${e.diff.slice(0, 80).join("\n")}` : ""}`);
      else lines.push(`${t} ${e.kind === "button" ? "버튼" : "알림"}: ${clip(e.text, 200)}`);
    }
  }
  const files = code.map((c) => `[마지막 코드 ${c.file}]\n${c.text}`).join("\n\n");
  return { text: `[실습] ${title}\n${lines.join("\n")}${files ? `\n\n[이 실습에서 저장한 코드 파일의 마지막 모습 — code 칸은 여기와 위 기록에서 고른다]\n${files}` : ""}`, count: n };
}

/** 빈 개념은 빼고, 설명 글에 섞여 온 코드 블록(```)은 걷어낸다(코드는 code 칸에만). 순간 번호는 기록에 있는 것만. */
export function cleanNotes(notes: Notes, count: number): Notes {
  const plain = (x: string | undefined) => (x ?? "").replace(/```[\s\S]*?(```|$)/g, "").trim();
  const code = (x: string | undefined) => (x ?? "").replace(/^```[^\n]*\n?/, "").replace(/\n?```\s*$/, "").replace(/\s+$/, "");
  const lessons = (notes.lessons ?? []).map((x) => ({ title: plain(x.title), concept: plain(x.concept), why: plain(x.why), how: plain(x.how), code: code(x.code), codeNote: plain(x.codeNote),
    ...(x.principle ? { principle: plain(x.principle) } : {}), inPractice: plain(x.inPractice), remember: plain(x.remember), moments: (x.moments ?? []).filter((m) => Number.isInteger(m) && m >= 1 && m <= count) }))
    .filter((x) => x.title && (x.concept || x.how || x.principle));
  const titles = new Set(lessons.map((x) => x.title));
  const summary = (notes.summary ?? []).map((x) => ({ title: plain(x.title), line: plain(x.line) })).filter((x) => x.title && x.line && titles.has(x.title));
  return { made: notes.made ?? "", intro: plain(notes.intro), lessons, summary };
}

const dir = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "practice-notes");
const file = (runId: string) => path.join(dir(), `${runId}.json`);
export async function readNotes(runId: string): Promise<{ at: string; notes: Notes } | null> {
  try { const d = JSON.parse(await readFile(file(runId), "utf8")); return Array.isArray(d?.notes?.lessons) ? d : null; } catch { return null; } // 옛 모양(층 · 카드 · 단계와 코드)은 다시 만든다
}
const defaultAsk: NotesAsk = (system, user, schema) => askJson<Notes>("practice:notes", system, user, schema, { model: "gpt-6.1-terra", effort: "medium" });
/** 실습 한 판을 정리한다(AI 1번). 다시 하면 덮어쓴다. */
export async function makeNotes(runId: string, ask: NotesAsk = defaultAsk, given?: { title?: string; scenes?: Chapter[] }) {
  const lib = given ?? await course<{ online?: boolean; run?: { title?: string }; title?: string; scenes?: Chapter[]; code?: { file: string; text: string }[] }>(`runs/${encodeURIComponent(runId)}/library`, { timeout: 15000 });
  const chapters = lib.scenes ?? [];
  const { text, count } = notesUser(lib.title || "실습", chapters, (lib as { code?: { file: string; text: string }[] }).code ?? []);
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
