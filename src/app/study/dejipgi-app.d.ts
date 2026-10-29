import type { StudyDeck, StudyOutlineSection } from "@/lib/study/from-authoring";
import type { NoteTurn, StudyNote } from "@/lib/study/notes";
import type { TodayPlan } from "@/lib/study/plan";
import type { LedgerEntry, PatchMap } from "@/lib/study/quality";
import type { CoachCard } from "@/lib/study/coach";
import type { Chunk, Lexicon } from "@/lib/study/chunk";

/** An objective shown at the one confirmation before authoring (engine v2). Support objectives start unchecked. */
export type DejipgiObjective = { id: string; section: string; part?: string; statement: string; recall: string; importance: "core" | "support" };
export type DejipgiMaterialStatus = {
  status: "waiting" | "running" | "confirm" | "paused" | "authoring" | "cards" | "ready" | "failed"; message: string; artifactId?: string;
  /** With "confirm": the designed objectives and the ones checked by default. */
  objectives?: DejipgiObjective[]; chosen?: string[];
  /** While it is being made: the outline with each unit's planned goals and where the unit is (만드는 중, 보류 …). */
  outline?: Array<StudyOutlineSection & { state: "waiting" | "making" | "ready" | "held"; held: number }>;
  /** v3 knowledge map as text (용어 지도 starts from it). */
  knowledge?: string;
};
export type DejipgiBuilderEngine = {
  /** `purpose`: core | understand | all (engine v2 purposes); `note`: the learner's free memo. */
  start(input: { file: File; from: number; to: number; purpose: string; note: string; readImages: boolean; pastExamSourceIds?: string[]; engine?: "v2" | "v3" | "v5" | "alpha" | "recaller"; deep?: boolean; deepDrafts?: 1 | 2;
    survey?: { style?: "recall" | "understand"; difficulty?: "easy" | "normal" | "hard"; exam?: "choice" | "mixed" | "written"; depth?: "core" | "all"; time?: "short" | "normal" | "long"; known?: string } }): Promise<{ requestId: string; sourceId: string }>;
  /** Where the learner is reading while the material is made: that unit is authored next. */
  focus?(requestId: string, page: number): Promise<void>;
  pastExamSources?(): Promise<Array<{ id: string; fileName: string }>>;
  /** Registers an exam PDF without making questions from it. */
  registerPastExam?(file: File): Promise<{ id: string; fileName: string }>;
  restart(input: { requestId: string; sourceId: string; from: number; to: number; purpose: string; note?: string }): Promise<{ requestId: string }>;
  check(requestId: string): Promise<DejipgiMaterialStatus>;
  /** The one confirmation: author these objectives. */
  confirm?(requestId: string, objectiveIds: string[]): Promise<void>;
  /** 문제 만들기: a material whose knowledge is organized ("cards") goes on to its questions. */
  questions?(requestId: string): Promise<void>;
  /** Remake only these objectives of a recorded document (e.g. after "이 문제 이상해요" reports). */
  remake(input: { artifactId: string; objectiveIds: string[] }): Promise<{ requestId: string; sourceId: string; from: number; to: number; purpose: string }>;
  /** Continue a request the in-app executor paused (usage limit reached, or ChatGPT login needed). */
  resume?(requestId: string): Promise<void>;
};

/** A deck as the screen holds it: the study deck plus this learner's record. */
export type PlannerDeck = StudyDeck & { events?: Array<{ t: number; item: string; kind: string; correct?: boolean; rating?: string; assisted?: boolean; afterReading?: boolean }>;
  sched?: Record<string, { box: number; due: number; seen: boolean }>; hidden?: string[]; reported?: Record<string, unknown> };
type PlannerNotes = Record<string, Array<{ page: number; quote: string; askedAt: string; kind?: string }>>;

export type DejipgiEnv = {
  /** 보관함: materials put away from the study screen (kept on disk, restorable). */
  archive?: {
    list(): Promise<Array<{ id: string; title: string; at: string; reason: string }>>;
    put(items: Array<{ id: string; title: string; reason: string }>): Promise<void>;
    restore(ids: string[]): Promise<void>;
  };
  /** 오늘 할 것, 물어본 목표, 학습 메모 (src/lib/study/plan.ts). */
  planner?: {
    today(input: { decks: PlannerDeck[]; settings: unknown; notes: PlannerNotes; rules?: unknown; now: number }): TodayPlan;
    asked(deck: PlannerDeck, notes: PlannerNotes[string]): string[];
    memoryAuto(input: { subject: string; decks: PlannerDeck[]; settings: unknown; notes: PlannerNotes; now: number }): string;
    diagnoseBox(intervals: number[], days: number): number;
  };
  /** 빠른 고리: fixes over the learner's own questions and the quality ledger (no model calls). */
  quality?: {
    similar(hidden: { id: string; statement: string }, candidates: Array<{ id: string; statement: string }>, threshold?: number): string[];
    tooEasy(events: NonNullable<PlannerDeck["events"]>, itemId: string, streak: number): boolean;
    /** A 용어 flashcard as four options from the material's other terms, or null. */
    termChoice(deck: { items: Array<{ id: string; objectiveId: string; format: string; answer?: number | string }>; outline?: Array<{ title: string; objectives: Array<{ id: string; kind?: string }> }> }, itemId: string, seed: string): { options: string[]; answer: number } | null;
    list?(): Promise<{ patches: PatchMap; counts: Record<string, number> }>;
    patch?(deckId: string, patch: { kind: "accept"; itemId: string; answer: string } | { kind: "card"; itemId: string }, entry?: LedgerEntry): Promise<void>;
    unpatch?(deckId: string, patchId: string, entry?: LedgerEntry): Promise<void>;
    log?(entries: LedgerEntry[]): Promise<void>;
  };
  /** 앱 안의 코치: cards from the day plan and the quality ledger (src/lib/study/coach.ts). */
  /** 태블릿 모드 (computer only): pairing code and addresses for the paired-device gate. */
  tablet?: {
    info(): Promise<{ urls: string[]; devices: Array<{ name: string; at: string }> }>;
    code(): Promise<{ code: string; expires: number; urls: string[] }>;
    revoke(): Promise<void>;
  };
  coach?: (input: { plan: TodayPlan; rules: unknown; prefs: unknown; counts: Record<string, number>; waiting: number; unassigned: number; subjectsWithoutDate: string[] }) => CoachCard[];
  /** Meaning units for the reader's hover box: a lexicon from the material, and the unit around a word of a line. */
  chunk?: { lexicon(deck: PlannerDeck, asked: string[]): Lexicon; at(words: string[], index: number, lexicon: Lexicon | null): Chunk;
    /** Terms of core 용어·개념 objectives, and where they are written on a line (reader highlight). */
    important?(deck: PlannerDeck): Lexicon; find?(words: string[], terms: Lexicon): Array<{ start: number; end: number }> };
  /** 학습규칙/오늘할것.md, parsed on the server. */
  rules?: () => Promise<{ rules: unknown; warnings: string[] }>;
  /** 학습 메모 (study-memory/<과목>.md): the screen rewrites the auto part after studying. */
  memory?: { save(subject: string, auto: string): Promise<void> };
  uid: string;
  defaultPurpose: string;
  loadDecks(): Promise<StudyDeck[]>;
  loadPdf(sourceCatalogId: string): Promise<ArrayBuffer>;
  loadPdfjs(): Promise<unknown>;
  loadKatex(): Promise<unknown>;
  /** 작업대 흐름 canvas (FlowBench.tsx); returns an unmount function. */
  mountFlow?(host: HTMLElement, api: import("./FlowBench").FlowApi): () => void;
  /** 지식창 · 코드 · 일정 (workspace/*.tsx) mounted into a host the app keeps across re-renders. */
  mountView?(name: "knowledge" | "code" | "plan" | "web" | "start" | "today" | "map", host: HTMLElement, props: Record<string, unknown>): () => void;
  /** A practice result passed on to the knowledge store (outcome: correct / wrong / assisted / unsure). */
  onPractice?(deck: { id: string; title?: string; sourceName?: string; points?: import("@/lib/study/knowledge").KnowledgeLayer }, item: { objectiveId?: string; id: string }, outcome: string): void;
  /** 과목·시험일 → 지식 저장소의 목표 (2026-10-28 "4개 축"), whenever subjects or a material's subject change. */
  onSubjects?(subjects: Array<{ name: string; exam: string }>, materials: Array<{ subject: string; title: string }>, renamed?: { from: string; to: string }): void;
  /** URL of a generated SVG figure recorded with an authored document. */
  assetUrl?: (artifactId: string, assetPath: string) => string;
  /** Queues one generation request per material and reports its progress (the assigned AI runs it through MCP). */
  builder?: DejipgiBuilderEngine;
  /** 모르는 것 노트: asked phrases and question-window talks, kept per registered PDF (sourceCatalogId). */
  notes?: {
    list(sourceId: string): Promise<StudyNote[]>;
    ask(input: { sourceId: string; page: number; quote: string; sentence: string | null; pageText: string; title: string; purpose: string | null; style?: string | null }): Promise<{ note: StudyNote; reused: boolean }>;
    mark(input: { sourceId: string; page: number; quote: string; sentence: string | null }): Promise<StudyNote>;
    seen(sourceId: string, noteId: string): Promise<StudyNote>;
    follow(input: { sourceId: string; noteId: string; question: string; pageText: string; title: string; style?: string | null }): Promise<StudyNote>;
    /** Fixed server instructions for the 프롬프트 설정 screen (read-only). */
    prompts?(): Promise<{ ask: string; follow: string }>;
    talk(input: { sourceId: string; page: number; noteId: string | null; turns: Array<Omit<NoteTurn, "page"> & { page?: number }> }): Promise<StudyNote>;
    /** 쪽마다 쉬운 설명 (곁 패널) and 목표 설명 (`goal` = objective id), made once and kept. */
    explanations?(sourceId: string): Promise<Array<{ page: number; goal?: string; text: string; at: string }>>;
    saveExplanation?(sourceId: string, page: number, text: string, goal?: string): Promise<void>;
    /** One long model request (용어 지도·번역). With `kind`, the reply follows that fixed shape (structured output) and comes back as JSON text. */
    compose?(input: { system: string; user: string; kind?: "terms" | "translate"; model?: string; effort?: string; json?: boolean; schema?: Record<string, unknown> }): Promise<string>;
  };
  /** ChatGPT account for in-app generation; `show` is false when the host does not generate with ChatGPT. */
  account?: {
    status(): Promise<{ show: boolean; ready: boolean; message: string }>;
    /** Leaves the page for the ChatGPT sign-in; it comes back to /study?chatgpt=… */
    connect(): Promise<void>;
    disconnect(): Promise<void>;
  };
  /** Study records mirrored in the data folder (one history across computers sharing it). */
  records?: { load(): Promise<{ records: Record<string, unknown>; pending: unknown[]; updatedAt: number } | null>; save(value: { records: Record<string, unknown>; pending: unknown[]; updatedAt: number }): Promise<void> };
  ask?: (turns: Array<{ role: string; content: string }>, options: { signal: AbortSignal; onText: (chunk: { text: string }) => void }) => Promise<void>;
};

export function mountDejipgi(root: HTMLElement, env: DejipgiEnv): () => void;
export function deckDisplayTitle(deck: { id: string; title: string }, peers: Array<{ id: string; title: string }>): string;
