import type { StudyDeck } from "@/lib/study/from-authoring";

export type DejipgiMaterialStatus = { status: "waiting" | "running" | "authoring" | "ready" | "failed"; message: string; artifactId?: string };
export type DejipgiBuilderEngine = {
  start(input: { file: File; from: number; to: number; purpose: string; answers: { purpose: string; abilities: string[] } }): Promise<{ requestId: string; sourceId: string }>;
  restart(input: { sourceId: string; from: number; to: number; purpose: string }): Promise<{ requestId: string }>;
  check(requestId: string): Promise<DejipgiMaterialStatus>;
  /** Remake only these objectives of a recorded document (e.g. after "이 문제 이상해요" reports). */
  remake(input: { artifactId: string; objectiveIds: string[] }): Promise<{ requestId: string; sourceId: string; from: number; to: number; purpose: string }>;
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
  ask?: (turns: Array<{ role: string; content: string }>, options: { signal: AbortSignal; onText: (chunk: { text: string }) => void }) => Promise<void>;
};

export function mountDejipgi(root: HTMLElement, env: DejipgiEnv): () => void;
