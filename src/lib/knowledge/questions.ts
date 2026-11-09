// 지식에서 바로 만드는 문제 (no model call): flashcards, 객관식, OX, 고리 빈칸, 알아보기. Every question names the
// knowledge it checks, so its result goes straight back into that item's record.
import { normalize, similarity, type Knowledge } from "./store.ts";

export type QuestionKind = "flashcard" | "choice" | "ox" | "blank" | "short" | "recognize";
/** One family of names for every question block, in the app, the extension and the agent tools. */
export const QUESTION_LABEL: Record<QuestionKind, string> = { flashcard: "플래시카드", choice: "객관식", ox: "OX", blank: "빈칸", short: "주관식", recognize: "알아보기" };
export type Question = {
  id: string; kind: QuestionKind; label: string; knowledgeId: string; prompt: string; context?: string;
  options?: string[]; answer: string; accept?: string[]; explain: string;
};
export type Graded = { correct: boolean; expected: string; note: string };

type Pool = Array<Pick<Knowledge, "id" | "title" | "body" | "aliases" | "folderId" | "links"> & { sources?: Knowledge["sources"]; kind?: Knowledge["kind"]; vocab?: boolean; ask?: string; checks?: Knowledge["checks"]; state?: Knowledge["state"] }>;
function rng(seed: string) { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 2 ** 32; }; }
function shuffle<T>(items: T[], r: () => number) { const a = [...items]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
// ⟨받음: … / 냄: …⟩ is the engine's wiring between knowledge points; it names other items, so it never goes into a question.
// "헷갈림: …"은 줄 앞에도, 한 줄 안 " / 헷갈림: …"으로도 붙는다(11/9 사용자 "플래시카드에서 헷갈림은 숨겨야지": 문제·보기·답에 새지 않게).
const MISTAKE = /\s*(?:\/\s*)?헷갈림\s*:\s*/;
const line = (body: string) => body.split("\n").map((l) => l.replace(/⟨[^⟩]*⟩/g, "").split(MISTAKE)[0].trim()).filter(Boolean).join(" ").slice(0, 220);
/** 헷갈리기 쉬운 점(이 지식에서 틀리기 쉬운 생각): OX의 틀린 문장 재료. */
export function mistakesOf(body: string) {
  return body.split("\n").flatMap((l) => l.split(MISTAKE).slice(1)).map((x) => x.replace(/⟨[^⟩]*⟩/g, "").trim()).filter((x) => x.length >= 6);
}
/** The meaning without the name in front ("z_vp — 뷰 평면의 위치…" → "뷰 평면의 위치…"), so an option does not give away whose it is. */
export function meaningOf(item: Pick<Knowledge, "title" | "body">) {
  const m = line(item.body), t = item.title.trim();
  for (const sep of [" — ", " – ", " - ", ": ", "："]) if (t && m.startsWith(t + sep)) return m.slice(t.length + sep.length).trim();
  return m;
}
/**
 * The meaning as it may stand among options: without a leading "[맥락]" (it names the topic, so it gives the answer
 * away). A numbered procedure ("1) … 2) …") is never an option — its shape alone tells which one it is.
 */
const optionText = (item: Pick<Knowledge, "title" | "body">) => meaningOf(item).replace(/^\[[^\]]{1,80}\]\s*/, "").trim();
const isSteps = (text: string) => /(^|\s)1\)\s.*\s2\)\s/.test(text);
const materials = (x: Pool[number]) => new Set((x.sources ?? []).map((s) => s.title.replace(/\.pdf$/i, "")).filter(Boolean));
/**
 * Others to pick wrong options from: the same folder first, then the same material. Never knowledge from another
 * subject — a 3D viewing item with an algorithm's meaning as an option is no question at all.
 */
// 11/9 사용자 "ㅈㄴ 어색하게 나온다": 폴더가 없는 지식은 모두 같은 "폴더 없음"이라, 교착 상태 문제에 SQL·앱 코드 보기가 섞였다.
// 같은 자료가 먼저, 그다음은 (진짜 폴더가 있을 때만) 같은 폴더 + 같은 출처 종류(PDF·웹 글끼리, 코드끼리).
const kinds = (x: Pool[number]) => new Set((x.sources ?? []).map((s) => (s.kind === "web" ? "pdf" : s.kind)));
const others = (item: Pool[number], pool: Pool) => {
  const mine = materials(item), myKinds = kinds(item);
  const usable = pool.filter((x) => x.id !== item.id && optionText(x) && !isSteps(optionText(x)) && normalize(optionText(x)) !== normalize(optionText(item)) && similarity(x.title, item.title) < 0.8);
  const sameMaterial = usable.filter((x) => [...materials(x)].some((m) => mine.has(m)));
  const sameFolder = item.folderId ? usable.filter((x) => !sameMaterial.includes(x) && x.folderId === item.folderId && ([...kinds(x)].some((k) => myKinds.has(k)) || (!myKinds.size && !kinds(x).size))) : [];
  return [...sameMaterial, ...sameFolder];
};

/** Questions for one item: the 뜻 카드(플래시카드), or its 다시 확인 문항. (11/9: 코드가 만드는 객관식·OX·빈칸은 뺐다.) */
export function questionsFor(item: Pool[number], _pool: Pool, seed = ""): Question[] {
  const meaning = meaningOf(item);
  const out: Question[] = [];
  const id = (kind: string) => `${item.id}:${kind}:${seed}`;
  // 다시 확인(2026-11-08 D [경계]): 실습에서 부족했던 바로 그 지점을 겨냥한 문항이 있으면 뜻 카드 대신 그걸 먼저(가장 최근 것).
  // 스스로 채점(플래시카드처럼). 맞히면 앎으로, 틀리면 몰랐음 — 상태 · 날짜는 다른 문제와 같은 기록으로 정해진다
  const check = item.checks?.length && item.state !== "known" ? item.checks[item.checks.length - 1] : null;
  if (check) out.push({ id: id("flashcard"), kind: "flashcard", label: "다시 확인", knowledgeId: item.id, prompt: check.q, answer: check.a,
    explain: check.note ? `예전 실습에서: ${check.note}` : item.title });
  else out.push({ id: id("flashcard"), kind: "flashcard", label: QUESTION_LABEL.flashcard, knowledgeId: item.id, prompt: item.ask || item.title, answer: meaning || "(설명이 아직 없어요. 지식창에서 적어 주세요.)", explain: item.ask ? item.title : "" });
  // 11/9 사용자 "코드가 바로 문제 만들기 X": 지식에서 코드로 객관식·OX·고리 빈칸을 만들지 않는다(다른 지식 설명을 오답으로
  // 갖다 붙여 어색했다). 복습은 뜻 카드(헷갈림은 숨김)와, 따로 만들어 둔 문제(PS 질문·다시 확인)만.
  return out;
}

/** 알아보기: a passage from a new article and the learner's earlier knowledge — which one is this the same idea as? */
export function recognizeQuestion(item: Pool[number], passage: string, pool: Pool, seed = ""): Question {
  const r = rng(`${item.id}:recognize:${seed}`);
  const options = shuffle([item.title, ...shuffle(others(item, pool), r).slice(0, 3).map((x) => x.title)], r);
  return { id: `${item.id}:recognize:${seed}`, kind: "recognize", label: QUESTION_LABEL.recognize, knowledgeId: item.id, prompt: "이 문단은 예전에 배운 어떤 지식과 같은 이야기인가요?",
    context: passage.slice(0, 600), options, answer: item.title, explain: `예전에 "${item.title}"(으)로 배운 내용이에요.` };
}

/** Grading without a model. 플래시카드 is graded by the learner ("알았어요" / "몰랐어요"), passed in as the answer. */
export function grade(question: Question, answer: string): Graded {
  const a = answer.trim();
  if (question.kind === "flashcard") return { correct: a === "knew" || a === "알았어요", expected: question.answer, note: "" };
  if (question.kind === "blank" || question.kind === "short") {
    const names = [question.answer, ...(question.accept ?? [])];
    const exact = names.some((n) => normalize(n) === normalize(a));
    const close = !exact && names.some((n) => normalize(n).length >= 3 && similarity(n, a) >= 0.8);
    return { correct: exact || close, expected: question.answer, note: close ? "표기가 조금 달라도 맞은 것으로 봤어요." : "" };
  }
  // 보기 문제도 "이것도 맞아요"(accept)를 받는다(11/10, PS 개념 보기: BFS·DFS 둘 다 되는 문제).
  const ok = [question.answer, ...(question.accept ?? [])].some((n) => normalize(n) === normalize(a));
  return { correct: ok, expected: question.answer, note: ok && normalize(a) !== normalize(question.answer) ? `${question.answer}도 돼요.` : "" };
}
