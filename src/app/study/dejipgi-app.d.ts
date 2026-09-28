import type { StudyDeck } from "@/lib/study/from-authoring";

export type DejipgiSource = { id: string; title: string; fileName: string; pageCount: number; available: boolean };

export type DejipgiEnv = {
  uid: string;
  defaultPurpose: string;
  loadDecks(): Promise<StudyDeck[]>;
  loadPdf(sourceCatalogId: string): Promise<ArrayBuffer>;
  loadPdfjs(): Promise<unknown>;
  loadKatex(): Promise<unknown>;
  listSources(): Promise<DejipgiSource[]>;
  uploadPdf(file: File): Promise<{ id: string; fileName: string; pageCount: number }>;
  listRequests(): Promise<unknown[]>;
  createRequest(sourceId: string, pageText: string, purpose: string): Promise<{ error?: string }>;
  ask?: (turns: Array<{ role: string; content: string }>, options: { signal: AbortSignal; onText: (chunk: { text: string }) => void }) => Promise<void>;
};

export function mountDejipgi(root: HTMLElement, env: DejipgiEnv): () => void;
