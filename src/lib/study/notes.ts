// "모르는 것 노트" (docs/DECISIONS.md 2026-09-30): what the reader asked about while reading, kept per material
// so the same thing is never paid for twice. Re-views are the weak-point signal.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { callModel, ModelError, type ModelCaller } from "../ai/model.ts";

export type NoteKind = "term" | "procedure" | "concept" | "talk";
export type NoteAnswer = {
  lead: string;
  steps?: Array<{ step: string; why: string }>;
  quote?: string | null;
  extra?: string | null;
  outsideSource?: string | null;
};
export type NoteTurn = { role: "user" | "assistant"; text: string; quote?: string | null; page?: number };
export type StudyNote = {
  id: string;
  sourceId: string;
  page: number;
  kind: NoteKind;
  status: "answered" | "marked";
  /** The chosen phrase; for a question-window conversation, its short title. */
  quote: string;
  sentence: string | null;
  answer: NoteAnswer | null;
  thread: NoteTurn[];
  askedAt: string;
  seen: number;
  lastSeenAt: string | null;
  usage: { calls: number; inputTokens: number; outputTokens: number };
};

/** Seen this many times means it did not stick: it becomes a weak point and goes to practice. */
export const WEAK_AFTER = 3;
const MAX_NOTES = 2000;
const MAX_PAGE_TEXT = 8000;

const root = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "study-notes");
const fileFor = (sourceId: string) => {
  if (!/^[\w.-]{1,120}$/.test(sourceId)) throw new NoteError(400, "자료 ID가 올바르지 않아요.");
  return path.join(root(), `${sourceId}.json`);
};
export class NoteError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Same material, same phrase: spacing and case do not matter. */
export function phraseKey(text: string) {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("ko-KR");
}

async function load(sourceId: string): Promise<StudyNote[]> {
  try { return (JSON.parse(await readFile(fileFor(sourceId), "utf8")) as { notes: StudyNote[] }).notes; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
async function save(sourceId: string, notes: StudyNote[]) {
  await mkdir(root(), { recursive: true });
  const target = fileFor(sourceId);
  const temporary = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify({ notes }, null, 2), { mode: 0o600 });
  await rename(temporary, target);
}
// One writer at a time per process; a note file is small and local.
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

export async function listNotes(sourceId: string) { return load(sourceId); }

const clip = (text: string | undefined | null, max: number) => String(text ?? "").slice(0, max);
function newNote(input: { sourceId: string; page: number; kind: NoteKind; status: StudyNote["status"]; quote: string; sentence?: string | null }): StudyNote {
  return {
    id: `note_${randomBytes(8).toString("hex")}`, sourceId: input.sourceId, page: input.page, kind: input.kind, status: input.status,
    quote: clip(input.quote, 400), sentence: input.sentence ? clip(input.sentence, 800) : null, answer: null, thread: [],
    askedAt: new Date().toISOString(), seen: 0, lastSeenAt: null, usage: { calls: 0, inputTokens: 0, outputTokens: 0 },
  };
}
function addUsage(note: StudyNote, usage?: { inputTokens?: number; outputTokens?: number }) {
  note.usage.calls += 1;
  note.usage.inputTokens += usage?.inputTokens ?? 0;
  note.usage.outputTokens += usage?.outputTokens ?? 0;
}
function modelSettings() {
  return {
    model: process.env.STUDY_FORGE_NOTE_MODEL?.trim() || process.env.STUDY_FORGE_EXECUTOR_MODEL?.trim() || "gpt-6-sol",
    effort: process.env.STUDY_FORGE_NOTE_EFFORT?.trim() || "low",
  };
}

export type AskInput = {
  sourceId: string; page: number; quote: string; sentence?: string | null;
  pageText?: string | null; title?: string | null; purpose?: string | null;
};

const ASK_SYSTEM = [
  "너는 학습자가 읽고 있는 자료 옆에서 모르는 말을 짧게 풀어 주는 튜터다.",
  "학습자가 [고른 글]을 모른다. [이 쪽 원문]을 근거로, 일반 사전 뜻이 아니라 이 자료에서의 뜻으로 답한다.",
  "원문에 없는 사실(번역어, 일반 지식, 다른 예)은 outsideSource에만 쓴다. lead와 steps에는 원문으로 확인되는 내용만 쓴다.",
  "한국어로 쓴다. 원어 용어와 기호는 바꾸지 않는다. 식은 $...$ 안에 LaTeX로 쓴다. 마크다운 기호는 쓰지 않는다.",
  "응답은 JSON 객체 하나만 쓴다:",
  '{"kind":"term|procedure|concept","lead":"한두 문장 핵심 답","steps":[{"step":"단계","why":"왜 필요한지 한 줄"}],"quote":"원문에서 이 말이 쓰인 문장 그대로 또는 null","extra":"덧붙일 한 줄 또는 null","outsideSource":"원문 밖 설명 또는 null"}',
  "kind는 고른 글이 낱말·용어면 term, 순서가 있는 과정이면 procedure, 원리·관계면 concept. steps는 procedure일 때만 3~7개, 아니면 빈 배열.",
].join("\n");

function askUser(input: AskInput) {
  return [
    `[자료] ${clip(input.title, 200) || "(제목 없음)"}`,
    input.purpose ? `[학습 목적] ${clip(input.purpose, 400)}` : "",
    `[고른 글] ${clip(input.quote, 400)}`,
    input.sentence ? `[고른 글이 든 문장] ${clip(input.sentence, 800)}` : "",
    `[이 쪽 원문 p.${input.page}]\n${clip(input.pageText, MAX_PAGE_TEXT) || "(이 쪽은 추출된 글자가 없다.)"}`,
  ].filter(Boolean).join("\n\n");
}

export function readAnswer(data: unknown): { kind: Exclude<NoteKind, "talk">; answer: NoteAnswer } {
  const value = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const text = (key: string) => typeof value[key] === "string" && (value[key] as string).trim() ? (value[key] as string).trim() : null;
  const lead = text("lead");
  if (!lead) throw new ModelError("invalid_output", "답에 핵심 설명(lead)이 없어요.");
  const kind = value.kind === "procedure" || value.kind === "concept" ? value.kind : "term";
  const steps = Array.isArray(value.steps)
    ? value.steps.flatMap((item) => {
      const step = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return typeof step.step === "string" && step.step.trim() ? [{ step: step.step.trim(), why: typeof step.why === "string" ? step.why.trim() : "" }] : [];
    }).slice(0, 10)
    : [];
  return { kind, answer: { lead, ...(steps.length ? { steps } : {}), quote: text("quote"), extra: text("extra"), outsideSource: text("outsideSource") } };
}

/**
 * Ask about a chosen phrase. The same phrase in the same material is answered from the note, with no model call,
 * and counts as one more re-view.
 */
export async function askNote(caller: ModelCaller, input: AskInput): Promise<{ note: StudyNote; reused: boolean }> {
  const quote = input.quote.trim();
  if (!quote) throw new NoteError(400, "고른 글이 없어요.");
  const key = phraseKey(quote);
  const existing = (await load(input.sourceId)).find((note) => note.kind !== "talk" && phraseKey(note.quote) === key);
  if (existing?.status === "answered") return { note: await markSeen(input.sourceId, existing.id), reused: true };

  const { model, effort } = modelSettings();
  let reply;
  let wasted = 0;   // a reply that was not JSON still used the plan
  try { reply = await callModel({ purpose: "note:ask", system: ASK_SYSTEM, user: askUser(input), json: true, model, effort, caller }); }
  catch (error) {
    if (!(error instanceof ModelError) || error.code !== "invalid_output") throw error;
    wasted = 1;
    reply = await callModel({ purpose: "note:ask", system: ASK_SYSTEM, user: `${askUser(input)}\n\n앞선 응답이 JSON 객체가 아니었다. 설명 없이 JSON 객체 하나만 쓴다.`, json: true, model, effort, caller });
  }
  const { kind, answer } = readAnswer(reply.data);
  return locked(async () => {
    const notes = await load(input.sourceId);
    let note = existing ? notes.find((item) => item.id === existing.id) : undefined;
    if (!note) {
      if (notes.length >= MAX_NOTES) throw new NoteError(409, "이 자료의 노트가 너무 많아요.");
      note = newNote({ sourceId: input.sourceId, page: input.page, kind, status: "answered", quote, sentence: input.sentence });
      notes.push(note);
    }
    Object.assign(note, { kind, status: "answered", answer, page: input.page, sentence: input.sentence ? clip(input.sentence, 800) : note.sentence });
    if (wasted) note.usage.calls += wasted;
    addUsage(note, reply.usage);
    await save(input.sourceId, notes);
    return { note, reused: false };
  });
}

/** "모름 표시": remember the phrase without asking yet. */
export async function markNote(input: { sourceId: string; page: number; quote: string; sentence?: string | null }) {
  const quote = input.quote.trim();
  if (!quote) throw new NoteError(400, "고른 글이 없어요.");
  return locked(async () => {
    const notes = await load(input.sourceId);
    const same = notes.find((note) => note.kind !== "talk" && phraseKey(note.quote) === phraseKey(quote));
    if (same) return same;
    if (notes.length >= MAX_NOTES) throw new NoteError(409, "이 자료의 노트가 너무 많아요.");
    const note = newNote({ sourceId: input.sourceId, page: input.page, kind: "term", status: "marked", quote, sentence: input.sentence });
    notes.push(note);
    await save(input.sourceId, notes);
    return note;
  });
}

export async function markSeen(sourceId: string, noteId: string) {
  return locked(async () => {
    const notes = await load(sourceId);
    const note = notes.find((item) => item.id === noteId);
    if (!note) throw new NoteError(404, "노트 항목을 찾지 못했어요.");
    note.seen += 1;
    note.lastSeenAt = new Date().toISOString();
    await save(sourceId, notes);
    return note;
  });
}

export async function removeNote(sourceId: string, noteId: string) {
  return locked(async () => {
    const notes = await load(sourceId);
    const next = notes.filter((item) => item.id !== noteId);
    if (next.length === notes.length) throw new NoteError(404, "노트 항목을 찾지 못했어요.");
    await save(sourceId, next);
  });
}

const FOLLOW_SYSTEM = [
  "너는 학습자가 읽고 있는 자료 옆에서 돕는 튜터다. 학습자는 [고른 글]에 대한 앞선 답을 보고 이어서 묻는다.",
  "[이 쪽 원문]을 근거로 짧게(보통 2~4문장) 한국어로 답한다. 원문에 없는 내용은 그 문장 앞에 \"원문 밖 설명:\"이라고 밝힌다.",
  "마크다운 기호는 쓰지 않는다. 식은 $...$ 안에 LaTeX로 쓴다.",
].join("\n");

/** A follow-up question on a card; the turn is stored with the note. */
export async function followUp(caller: ModelCaller, input: { sourceId: string; noteId: string; question: string; pageText?: string | null; title?: string | null }) {
  const question = input.question.trim();
  if (!question) throw new NoteError(400, "질문이 비어 있어요.");
  const note = (await load(input.sourceId)).find((item) => item.id === input.noteId);
  if (!note || !note.answer) throw new NoteError(404, "이어서 물을 답이 없어요.");
  const history = note.thread.slice(-10).map((turn) => `${turn.role === "user" ? "학습자" : "튜터"}: ${turn.text}`).join("\n");
  const user = [
    `[자료] ${clip(input.title, 200) || "(제목 없음)"}`,
    `[고른 글] ${note.quote}`,
    `[앞선 답] ${note.answer.lead}${note.answer.extra ? ` ${note.answer.extra}` : ""}`,
    history ? `[이어진 대화]\n${history}` : "",
    `[이 쪽 원문 p.${note.page}]\n${clip(input.pageText, MAX_PAGE_TEXT) || "(없음)"}`,
    `[새 질문] ${clip(question, 1000)}`,
  ].filter(Boolean).join("\n\n");
  const { model, effort } = modelSettings();
  const reply = await callModel({ purpose: "note:follow", system: FOLLOW_SYSTEM, user, model, effort, caller });
  return locked(async () => {
    const notes = await load(input.sourceId);
    const current = notes.find((item) => item.id === input.noteId)!;
    current.thread.push({ role: "user", text: clip(question, 1000) }, { role: "assistant", text: reply.text.trim() });
    addUsage(current, reply.usage);
    await save(input.sourceId, notes);
    return current;
  });
}

/** The question window. `turns` are the window's own prompt and history; the reply text is returned as is. */
export async function chatReply(caller: ModelCaller, turns: Array<{ role: string; content: string }>) {
  const [first, ...rest] = turns;
  if (!first?.content) throw new NoteError(400, "질문이 비어 있어요.");
  const { model, effort } = modelSettings();
  const user = rest.slice(-12).map((turn) => `${turn.role === "user" ? "학습자" : "튜터"}: ${clip(turn.content, 4000)}`).join("\n\n");
  const reply = await callModel({ purpose: "note:chat", system: clip(first.content, 16000), user, model, effort, caller });
  return { text: reply.text.trim(), usage: reply.usage };
}

const TITLE_SYSTEM = "학습자와 튜터의 대화를 보고, 무엇을 물었는지 드러나는 한국어 제목을 20자 안팎으로 하나만 쓴다. 따옴표나 마침표 없이 제목만 쓴다.";

/**
 * Save a question-window conversation: one conversation is one note item. The first save asks for a short title;
 * later saves update the turns. A conversation continued from a card (noteId of a phrase note) extends that card.
 */
export async function saveTalk(caller: ModelCaller, input: { sourceId: string; page: number; noteId?: string | null; turns: NoteTurn[]; usage?: { inputTokens?: number; outputTokens?: number } }) {
  const turns = input.turns.filter((turn) => turn.text?.trim()).slice(-60).map((turn) => ({
    role: turn.role === "assistant" ? "assistant" as const : "user" as const, text: clip(turn.text, 6000), quote: turn.quote ? clip(turn.quote, 400) : null, page: turn.page,
  }));
  if (!turns.length) throw new NoteError(400, "저장할 대화가 없어요.");
  const existing = input.noteId ? (await load(input.sourceId)).find((item) => item.id === input.noteId) : undefined;
  let title: string | null = null;
  let titleUsage: { inputTokens?: number; outputTokens?: number } | undefined;
  if (!existing) {
    const { model } = modelSettings();
    const talk = turns.slice(0, 6).map((turn) => `${turn.role === "user" ? "학습자" : "튜터"}: ${turn.quote ? `“${turn.quote}” ` : ""}${clip(turn.text, 600)}`).join("\n");
    try {
      const reply = await callModel({ purpose: "note:title", system: TITLE_SYSTEM, user: talk, model, effort: "low", caller });
      title = reply.text.replace(/["“”'.\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || null;
      titleUsage = reply.usage;
    } catch (error) {
      if (!(error instanceof ModelError)) throw error;
    }
    title ??= clip(turns.find((turn) => turn.role === "user")?.text ?? "질문", 30);
  }
  return locked(async () => {
    const notes = await load(input.sourceId);
    let note = existing ? notes.find((item) => item.id === existing.id) : undefined;
    if (!note) {
      if (notes.length >= MAX_NOTES) throw new NoteError(409, "이 자료의 노트가 너무 많아요.");
      note = newNote({ sourceId: input.sourceId, page: input.page, kind: "talk", status: "answered", quote: title! });
      notes.push(note);
      if (titleUsage) addUsage(note, titleUsage);
    }
    if (note.kind === "talk") {
      note.thread = turns;
      note.answer = { lead: turns.find((turn) => turn.role === "user")?.text ?? "" };
    } else {
      // Continued from a card: keep the card's turns and append the window's new ones.
      const known = new Set(note.thread.map((turn) => `${turn.role}:${turn.text}`));
      note.thread.push(...turns.filter((turn) => !known.has(`${turn.role}:${turn.text}`)));
    }
    if (input.usage) addUsage(note, input.usage);
    await save(input.sourceId, notes);
    return note;
  });
}
