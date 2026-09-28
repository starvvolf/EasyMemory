import type { StudyDeck, StudyItem } from "@/lib/study/from-authoring";

export type DejipgiSource = { id: string; title: string; fileName: string; pageCount: number; available: boolean };

export type DejipgiObjective = { id: string; statement: string; kind: string; importance: "core" | "support"; pages: number[]; quote: string };
export type DejipgiBuiltItem = StudyItem & { checks?: string[]; warnings?: string[]; quoteVerified?: boolean };
type Progress = { signal: AbortSignal; onStatus(message: string): void };
export type DejipgiBuilderEngine = {
  design(input: Progress & { file: File | null; sourceName: string; pages: Array<{ n: number; text: string }>; from: number; to: number; goal: string }):
    Promise<{ title: string; objectives: DejipgiObjective[] }>;
  author(input: Progress & { objectives: DejipgiObjective[]; sourceName: string; pages: Array<{ n: number; text: string }>; goal: string }):
    Promise<{ items: DejipgiBuiltItem[]; report: { made: number; repaired: number; converted: number; dropped: number; dup: number; warned: number }; log?: string[] }>;
  save(input: { title: string; sourceName: string; objectives: DejipgiObjective[]; items: DejipgiBuiltItem[] }): Promise<{ deckId?: string }>;
};

export type DejipgiEnv = {
  uid: string;
  defaultPurpose: string;
  loadDecks(): Promise<StudyDeck[]>;
  loadPdf(sourceCatalogId: string): Promise<ArrayBuffer>;
  loadPdfjs(): Promise<unknown>;
  loadKatex(): Promise<unknown>;
  /** Recaller generation engine behind the three "자료 만들기" steps. Left unset for now; see 협업/작업지시_05_되짚기_엔진연결.md. */
  builder?: DejipgiBuilderEngine;
  /** Building blocks for wiring `builder` to the existing request queue (/mcp-runs flow). Not used by the screen yet. */
  listSources(): Promise<DejipgiSource[]>;
  uploadPdf(file: File): Promise<{ id: string; fileName: string; pageCount: number }>;
  listRequests(): Promise<unknown[]>;
  createRequest(sourceId: string, pageText: string, purpose: string): Promise<{ error?: string }>;
  ask?: (turns: Array<{ role: string; content: string }>, options: { signal: AbortSignal; onText: (chunk: { text: string }) => void }) => Promise<void>;
};

export function mountDejipgi(root: HTMLElement, env: DejipgiEnv): () => void;
