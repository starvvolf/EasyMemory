// 강의 (11/10 사용자 "강의 기능 새로 만들어 봐. 카드 쥐어 주고 나름의 합리적이거나 이해하기 쉬운 스토리라인을 짜서 카드를 보여 주면서
// 자연스러운 설명 진행"). 자료 지도의 [강의] 탭.
//   ① 이야기 줄기 (자료당 AI 1번, terra low): 기억 목록 → 이 강의가 풀려는 문제 + 장(chapter)마다 왜·걸음(보여 줄 기억, 이 걸음의 요점)·다음으로 넘기는 말.
//      코드가 없는 기억 id를 빼고, 어느 걸음에도 안 나온 메인 기억은 그 영역의 장 끝 걸음으로 붙인다.
//   ② 장 설명 (장마다 AI 1번, 동시, terra low): 그 장의 걸음 + 기억 내용 + 그 쪽들의 원문 글자 → 걸음마다 강사가 하는 말, 장 중간의 따져 보기 하나.
//      쪽 그림은 다시 보내지 않고, 잘라 둔 그림이 있는 기억을 화면이 같이 보여 준다.
// 결과는 study-gen/<id>/lecture.json에 장이 끝날 때마다 저장(화면은 GET으로 따라 읽음). 한 번 만들면 다시 부르지 않는다.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { withTrace } from "../ai/trace.ts";
import { askJson, S } from "../assist/model.ts";
import { loadGen } from "./gen/runner.ts";
import { materialMap, type MapCard, type MaterialMap } from "./material-map.ts";

export type LectureStep = { cards: string[]; point: string; say?: string };
export type LectureChapter = { title: string; why: string; bridge: string; steps: LectureStep[]; status: "waiting" | "writing" | "done" | "failed"; ms?: number;
  check?: { after: number; question: string; answer: string; why: string } };
export type Lecture = { at: string; status: "writing" | "done" | "failed"; problem: string; chapters: LectureChapter[]; ms: number; storyMs?: number; error?: string; fixes: string[] };

export const LECTURE_MODEL = { model: "gpt-6.1-terra", effort: "low" };
const dataDir = () => process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data");
const fileOf = (id: string) => { if (!/^gen_[a-z0-9]{8,64}$/.test(id)) throw Object.assign(new Error("자료를 찾을 수 없어요."), { status: 404 }); return path.join(dataDir(), "study-gen", id, "lecture.json"); };
export async function loadLecture(id: string): Promise<Lecture | null> { try { return JSON.parse(await readFile(fileOf(id), "utf8")) as Lecture; } catch { return null; } }
async function save(id: string, l: Lecture) { const f = fileOf(id); await mkdir(path.dirname(f), { recursive: true }); await writeFile(`${f}.tmp`, JSON.stringify(l, null, 1)); await rename(`${f}.tmp`, f); }

const isFlow = (c: MapCard) => c.title.startsWith("흐름: ");
const roleOf = (c: MapCard) => c.memo?.role ?? (c.core ? "메인" : "바탕");

export const STORY_SYSTEM = `너는 이 강의를 맡은 강사다. 학생에게 이 자료를 처음부터 끝까지 강의할 이야기 줄기를 짠다.
받는 것: 강의의 영역(자료 순서)과 영역마다의 기억(외울 단위: id·이름·역할 메인/바탕/곁·요지).
- problem: 이 강의가 풀려는 문제를 학생이 궁금해지게 한두 문장으로.
- chapters: 장을 차례로. 장은 보통 영역 하나지만, 이해하기 쉬운 순서가 자료 순서와 다르면 바꾸거나 합치거나 나눠도 된다.
  - why: 앞 장에서 무엇이 모자랐기에 이 장이 필요한지(첫 장은 problem에서 출발).
  - steps: 화면에 기억 카드를 띄우며 설명할 걸음들. 걸음마다 cards(보여 줄 기억 id, 함께 봐야 하면 둘 이상), point(이 걸음에서 학생이 알게 될 것 한 줄).
    한 걸음에서 앞 걸음의 기억을 다시 띄워 견주어도 된다. 메인 기억은 빠짐없이 어느 걸음엔가 나와야 한다. 바탕 기억은 필요한 걸음에 곁들이고, 곁 기억은 빼도 된다.
  - bridge: 이 장으로도 남는 문제나 다음 장으로 넘어가는 까닭(마지막 장은 강의 전체를 묶는 한마디).
- 기억 id는 받은 그대로. 자료에 없는 내용을 지어내지 않는다. 쉬운 말, "~해요" 체.`;
const STORY_SCHEMA = S.obj({ problem: S.str, chapters: S.arr(S.obj({ title: S.str, why: S.str, steps: S.arr(S.obj({ cards: S.arr(S.str), point: S.str })), bridge: S.str })) });

export const CHAPTER_SYSTEM = `너는 이 강의를 맡은 강사다. 화면에 기억 카드를 한 장씩 띄우며 학생에게 장 하나를 설명한다. 학생은 앞 장들을 들었다.
받는 것: 이 장의 자리(why·bridge), 걸음 목록(걸음마다 띄울 카드와 요점), 카드 내용, 이 카드들이 나온 쪽의 원문 글자.
- says: 걸음마다 강사가 하는 말, 걸음 순서 그대로 걸음 수만큼. 학생은 카드를 보고 있으니 카드를 소리 내어 읽지 말고, 카드가 왜 그렇게 되는지·무엇을 보라는지·앞 걸음과 어떻게 이어지는지를 말한다.
  상황이나 질문으로 열고, 앞 걸음에서 자연스럽게 이어 간다. 식은 무엇이 커지면 무엇이 어떻게 되는지 말로 풀고, 원문에 예나 값이 있으면 그것으로 보여 준다. 기호는 처음 나올 때 뜻을 말한다.
  학생이 실제로 자주 틀리는 곳이 있으면 그 걸음에서 짚되, 매 걸음 같은 말투로 되풀이하지 않는다.
  첫 걸음은 why에서 출발하고, 마지막 걸음은 이 장을 한 문장으로 묶고 bridge로 넘긴다.
- check: 핵심을 막 배운 걸음 뒤(after: 그 걸음 번호, 1부터)에 학생이 스스로 따져 볼 상황 하나. 답(answer)과 까닭(why)은 카드와 원문으로 정해지는 것.
- 자료에 없는 사실을 지어내지 않는다. 쉬운 말, "~해요" 체, 용어는 "한국어(영어 원어)".`;
const CHAPTER_SCHEMA = S.obj({ says: S.arr(S.str), check: S.obj({ after: S.int, question: S.str, answer: S.str, why: S.str }) });

const brief = (c: MapCard) => `[${c.id}] ${c.title} (${roleOf(c)})${c.memo?.line ? ` — ${c.memo.line}` : ""}`;
const full = (c: MapCard) => [`[${c.id}] ${c.title} (${c.kind}, ${roleOf(c)})`, c.memo?.line ? `요지: ${c.memo.line}` : "", c.shape ? `카드: ${JSON.stringify(c.shape)}` : "",
  ...(c.memo?.facts ?? []).map((f) => `식·조건: ${f}`), ...c.mistakes.map((m) => `헷갈림: ${m}`), c.figure ? `그림(카드에 함께 보임, p.${c.figure.page}): ${c.figure.says}` : ""].filter(Boolean).join("\n");

/** 코드 검사: 없는 id 빼기, 빈 걸음 빼기, 빠진 메인 기억은 그 영역이 가장 많이 나온 장 끝에. */
export function settleStory(raw: { problem: string; chapters: Array<{ title: string; why: string; steps: Array<{ cards: string[]; point: string }>; bridge: string }> }, map: MaterialMap) {
  const fixes: string[] = [];
  const byId = new Map(map.sections.flatMap((s) => s.cards.filter((c) => !isFlow(c)).map((c) => [c.id, { c, section: s.id }] as const)));
  const chapters: LectureChapter[] = (raw.chapters ?? []).map((ch) => ({ title: ch.title, why: ch.why, bridge: ch.bridge, status: "waiting" as const,
    steps: (ch.steps ?? []).map((st) => {
      const cards = [...new Set(st.cards ?? [])].filter((id) => { const ok = byId.has(id); if (!ok) fixes.push(`없는 기억 ${id} 뺌`); return ok; });
      return { cards, point: st.point };
    }).filter((st) => st.cards.length) })).filter((ch) => ch.steps.length);
  const shown = new Set(chapters.flatMap((ch) => ch.steps.flatMap((st) => st.cards)));
  for (const [id, { c, section }] of byId) {
    if (roleOf(c) !== "메인" || shown.has(id)) continue;
    const home = chapters.map((ch, i) => ({ i, n: ch.steps.flatMap((st) => st.cards).filter((x) => byId.get(x)?.section === section).length })).sort((a, b) => b.n - a.n)[0];
    if (!home) continue;
    const steps = chapters[home.i].steps;
    steps.splice(Math.max(0, steps.length - 1), 0, { cards: [id], point: c.memo?.line ?? c.title });
    fixes.push(`빠진 메인 기억 ${id}를 ${home.i + 1}장에`);
  }
  return { problem: raw.problem ?? "", chapters, fixes };
}

const running = new Map<string, Promise<void>>();
export async function makeLecture(id: string) {
  const state = await loadGen(id);
  const map = state ? materialMap(state, {}) : null;
  if (!state || !map) throw Object.assign(new Error("자료를 찾을 수 없어요."), { status: 404 });
  if (state.status !== "done") throw Object.assign(new Error("자료를 다 만든 뒤에 강의를 만들 수 있어요."), { status: 409 });
  const texts = (state as unknown as { recaller?: { texts?: Record<string, string> } }).recaller?.texts ?? {};
  const areas = map.sections.map((s) => ({ title: s.title, cards: s.cards.filter((c) => !isFlow(c)) })).filter((a) => a.cards.length);
  if (!areas.length) throw Object.assign(new Error("기억 카드가 있어야 강의를 만들 수 있어요."), { status: 422 });
  const byId = new Map(areas.flatMap((a) => a.cards.map((c) => [c.id, c] as const)));
  const t0 = Date.now();
  const lecture: Lecture = { at: new Date().toISOString(), status: "writing", problem: "", chapters: [], ms: 0, fixes: [] };
  await save(id, lecture);
  try {
    const raw = await withTrace({ area: "pdf", action: "lecture-story", ref: id }, () => askJson<Parameters<typeof settleStory>[0]>("map:lecture-story", STORY_SYSTEM,
      `자료: ${map.title}\n\n${areas.map((a, i) => `## 영역 ${i + 1}. ${a.title}\n${a.cards.map(brief).join("\n")}`).join("\n\n")}`, STORY_SCHEMA, LECTURE_MODEL));
    const story = settleStory(raw, map);
    Object.assign(lecture, { problem: story.problem, chapters: story.chapters, fixes: story.fixes, storyMs: Date.now() - t0 });
    await save(id, lecture);
    let writing = Promise.resolve();
    const put = (fn: () => void) => { writing = writing.then(() => { fn(); lecture.ms = Date.now() - t0; return save(id, lecture); }); return writing; };
    await Promise.all(lecture.chapters.map(async (ch, ci) => {
      const t = Date.now();
      await put(() => { ch.status = "writing"; });
      const used = [...new Set(ch.steps.flatMap((st) => st.cards))].map((x) => byId.get(x)!).filter(Boolean);
      const pages = [...new Set(used.flatMap((c) => c.pages))].sort((a, b) => a - b);
      const user = `강의가 풀려는 문제: ${lecture.problem}\n\n${ci + 1}장. ${ch.title}\nwhy: ${ch.why}\nbridge: ${ch.bridge}\n\n[걸음]\n${ch.steps.map((st, k) => `${k + 1}. 띄울 카드 ${st.cards.join(", ")} — ${st.point}`).join("\n")}\n\n[카드]\n${used.map(full).join("\n\n")}\n\n[원문]\n${pages.map((p) => `[p.${p}]\n${texts[p] ?? ""}`).join("\n\n")}`;
      try {
        const r = await withTrace({ area: "pdf", action: "lecture-chapter", ref: id }, () => askJson<{ says: string[]; check: NonNullable<LectureChapter["check"]> }>("map:lecture-chapter", CHAPTER_SYSTEM, user, CHAPTER_SCHEMA, LECTURE_MODEL));
        await put(() => {
          ch.steps.forEach((st, k) => { st.say = r.says?.[k] ?? ""; });
          if (r.check?.question) ch.check = { ...r.check, after: Math.min(Math.max(1, r.check.after || 1), ch.steps.length) };
          ch.status = "done"; ch.ms = Date.now() - t;
        });
      } catch { await put(() => { ch.status = "failed"; ch.ms = Date.now() - t; }); }
    }));
    await writing;
    lecture.status = lecture.chapters.some((c) => c.status === "done") ? "done" : "failed";
  } catch (e) {
    lecture.status = "failed"; lecture.error = e instanceof Error ? e.message : String(e);
  }
  lecture.ms = Date.now() - t0;
  await save(id, lecture);
}

/** /api/study-map/<id>/lecture: GET 저장된 강의(만드는 중이면 된 데까지), POST 만들기 시작(뒤에서, 곧바로 답함). */
export async function lectureApi(request: Request, id: string) {
  const { NextResponse } = await import("next/server");
  if (request.method === "GET") return NextResponse.json({ lecture: await loadLecture(id) });
  const prev = await loadLecture(id);
  if (!running.has(id) && !(prev?.status === "writing" && Date.now() - Date.parse(prev.at) < 5 * 60_000)) {
    const state = await loadGen(id);
    if (!state) return NextResponse.json({ message: "자료를 찾을 수 없어요." }, { status: 404 });
    if (state.status !== "done") return NextResponse.json({ message: "자료를 다 만든 뒤에 강의를 만들 수 있어요." }, { status: 409 });
    const job = makeLecture(id).catch(() => undefined).finally(() => running.delete(id));
    running.set(id, job);
  }
  await new Promise((r) => setTimeout(r, 300));
  return NextResponse.json({ lecture: await loadLecture(id) });
}
