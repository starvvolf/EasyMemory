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

type Pool = Array<Pick<Knowledge, "id" | "title" | "body" | "aliases" | "folderId" | "links"> & { sources?: Knowledge["sources"]; kind?: Knowledge["kind"]; ask?: string }>;
function rng(seed: string) { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 2 ** 32; }; }
function shuffle<T>(items: T[], r: () => number) { const a = [...items]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
// ⟨받음: … / 냄: …⟩ is the engine's wiring between knowledge points; it names other items, so it never goes into a question.
const line = (body: string) => body.split("\n").map((l) => l.replace(/⟨[^⟩]*⟩/g, "").trim()).filter(Boolean).filter((l) => !/^헷갈림:/.test(l)).join(" ").slice(0, 220);
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
const others = (item: Pool[number], pool: Pool) => {
  const mine = materials(item);
  const usable = pool.filter((x) => x.id !== item.id && optionText(x) && !isSteps(optionText(x)) && normalize(optionText(x)) !== normalize(optionText(item)));
  const sameFolder = usable.filter((x) => x.folderId === item.folderId);
  const sameMaterial = usable.filter((x) => !sameFolder.includes(x) && [...materials(x)].some((m) => mine.has(m)));
  return [...sameFolder, ...sameMaterial];
};

/**
 * Questions for one item, the kinds its content allows: a flashcard always; 객관식 and OX when it has a meaning and
 * there are others to mix in; 빈칸 when it sits in a chain (A → ? → C, or A → ?).
 */
export function questionsFor(item: Pool[number], pool: Pool, seed = ""): Question[] {
  const r = rng(`${item.id}:${seed}`);
  const meaning = meaningOf(item);
  const out: Question[] = [];
  const id = (kind: string) => `${item.id}:${kind}:${seed}`;
  out.push({ id: id("flashcard"), kind: "flashcard", label: QUESTION_LABEL.flashcard, knowledgeId: item.id, prompt: item.ask || item.title, answer: meaning || "(설명이 아직 없어요. 지식창에서 적어 주세요.)", explain: item.ask ? item.title : "" });
  // 어휘 (종류 vocab): a word is learned both ways — the word from its meaning (주관식), and which word fits (객관식).
  if (item.kind === "vocab" && meaning) {
    out.push({ id: id("short"), kind: "short", label: QUESTION_LABEL.short, knowledgeId: item.id, prompt: `뜻에 맞는 단어를 쓰세요.\n${meaning}`, answer: item.title, accept: item.aliases,
      explain: `${item.title}: ${meaning}` });
    const words = shuffle(pool.filter((x) => x.id !== item.id && x.kind === "vocab" && x.folderId === item.folderId && normalize(x.title) !== normalize(item.title)), r).slice(0, 3).map((x) => x.title);
    if (words.length >= 2) out.push({ id: id("choice"), kind: "choice", label: QUESTION_LABEL.choice, knowledgeId: item.id, prompt: `뜻에 맞는 단어는?\n${meaning}`, options: shuffle([item.title, ...words], r),
      answer: item.title, explain: `${item.title}: ${meaning}` });
    return out;
  }
  const wrong = others(item, pool);
  const own = optionText(item);
  if (own && wrong.length >= 1) {
    // Wrong options close to the answer in length (from a few random ones), so the longest option is not the answer.
    const picks = shuffle(wrong, r).slice(0, 6).map((x) => optionText(x))
      .sort((a, b) => Math.abs(a.length - own.length) - Math.abs(b.length - own.length)).slice(0, 3);
    const options = shuffle([own, ...picks], r);
    // 객관식 needs at least three options to be worth asking; with one other, only OX. A procedure is asked as a card.
    if (picks.length >= 2 && !isSteps(own)) out.push({ id: id("choice"), kind: "choice", label: QUESTION_LABEL.choice, knowledgeId: item.id, prompt: item.ask ? `${item.ask} 맞는 것은?` : `"${item.title}"의 뜻으로 맞는 것은?`, options, answer: own, explain: `${item.title}: ${meaning}` });
    const truth = r() < 0.5;
    const shown = truth ? own : picks[0];
    out.push({ id: id("ox"), kind: "ox", label: QUESTION_LABEL.ox, knowledgeId: item.id, prompt: `${item.title}: ${shown}`, options: ["O", "X"], answer: truth ? "O" : "X",
      explain: truth ? "맞는 설명이에요." : `${item.title}의 뜻은 "${meaning}"이에요. 보기의 설명은 다른 지식의 것이에요.` });
  }
  const byId = new Map(pool.map((x) => [x.id, x]));
  const before = pool.filter((x) => x.links.some((l) => l.to === item.id));
  const after = item.links.map((l) => byId.get(l.to)).filter(Boolean) as Pool;
  if (before.length || after.length) {
    const a = before[0], c = after[0];
    const rel = (from: Pool[number] | undefined, to: string) => from?.links.find((l) => l.to === to)?.relation ?? "→";
    const prompt = [a ? `${a.title} —${rel(a, item.id)}→` : "", "( ? )", c ? `—${rel(item, c.id)}→ ${c.title}` : ""].filter(Boolean).join(" ");
    out.push({ id: id("blank"), kind: "blank", label: QUESTION_LABEL.blank, knowledgeId: item.id, prompt: `고리의 빈칸에 들어갈 지식은?\n${prompt}`, answer: item.title, accept: item.aliases,
      explain: meaning ? `${item.title}: ${meaning}` : item.title });
  }
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
  return { correct: normalize(a) === normalize(question.answer), expected: question.answer, note: "" };
}
