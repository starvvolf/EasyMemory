import type { StudyDeck } from "@/lib/study/from-authoring";
import type { NoteTurn, StudyNote } from "@/lib/study/notes";

/** An objective shown at the one confirmation before authoring (engine v2). Support objectives start unchecked. */
export type DejipgiObjective = { id: string; section: string; part?: string; statement: string; recall: string; importance: "core" | "support" };
export type DejipgiMaterialStatus = {
  status: "waiting" | "running" | "confirm" | "paused" | "authoring" | "ready" | "failed"; message: string; artifactId?: string;
  /** With "confirm": the designed objectives and the ones checked by default. */
  objectives?: DejipgiObjective[]; chosen?: string[];
};
export type DejipgiBuilderEngine = {
  /** `purpose`: core | understand | all (engine v2 purposes); `note`: the learner's free memo. */
  start(input: { file: File; from: number; to: number; purpose: string; note: string; readImages: boolean }): Promise<{ requestId: string; sourceId: string }>;
  restart(input: { requestId: string; sourceId: string; from: number; to: number; purpose: string; note?: string }): Promise<{ requestId: string }>;
  check(requestId: string): Promise<DejipgiMaterialStatus>;
  /** The one confirmation: author these objectives. */
  confirm?(requestId: string, objectiveIds: string[]): Promise<void>;
  /** Remake only these objectives of a recorded document (e.g. after "이 문제 이상해요" reports). */
  remake(input: { artifactId: string; objectiveIds: string[] }): Promise<{ requestId: string; sourceId: string; from: number; to: number; purpose: string }>;
  /** Continue a request the in-app executor paused (usage limit reached, or ChatGPT login needed). */
  resume?(requestId: string): Promise<void>;
};

export type DejipgiEnv = {
  uid: string;
  defaultPurpose: string;
  loadDecks(): Promise<StudyDeck[]>;
  loadPdf(sourceCatalogId: string): Promise<ArrayBuffer>;
  loadPdfjs(): Promise<unknown>;
  loadKatex(): Promise<unknown>;
  /** URL of a generated SVG figure recorded with an authored document. */
  assetUrl?: (artifactId: string, assetPath: string) => string;
  /** Queues one generation request per material and reports its progress (the assigned AI runs it through MCP). */
  builder?: DejipgiBuilderEngine;
  /** 모르는 것 노트: asked phrases and question-window talks, kept per registered PDF (sourceCatalogId). */
  notes?: {
    list(sourceId: string): Promise<StudyNote[]>;
    ask(input: { sourceId: string; page: number; quote: string; sentence: string | null; pageText: string; title: string; purpose: string | null }): Promise<{ note: StudyNote; reused: boolean }>;
    mark(input: { sourceId: string; page: number; quote: string; sentence: string | null }): Promise<StudyNote>;
    seen(sourceId: string, noteId: string): Promise<StudyNote>;
    follow(input: { sourceId: string; noteId: string; question: string; pageText: string; title: string }): Promise<StudyNote>;
    talk(input: { sourceId: string; page: number; noteId: string | null; turns: Array<Omit<NoteTurn, "page"> & { page?: number }> }): Promise<StudyNote>;
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
