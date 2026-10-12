// Generation engine v2 (docs/DECISIONS.md, 2026-10-12 "생성 엔진 구조"): three steps per table-of-contents section.
// ① 자료 파악 (outline once, then classify per section) → ② 학습 설계 per section → one user confirmation → ③ 출제 per section in order.

export const purposes = ["read", "understand", "core", "all"] as const;
export type Purpose = (typeof purposes)[number];
export const purposeLabel: Record<Purpose, string> = { read: "그냥 읽기", understand: "이해", core: "핵심 암기", all: "통암기" };

/** Model calls, in order. classify and design run per section. */
export const genSteps = ["transcribe", "outline", "classify", "design", "author"] as const;
export type GenStep = (typeof genSteps)[number];
export const genStepLabel: Record<GenStep, string> = { transcribe: "그림 쪽 읽기", outline: "목차", classify: "내용 분류", design: "학습 설계", author: "출제" };

export const itemKinds = ["핵심 지식", "재사용 패턴", "예시", "설명", "학습 지시", "연습문제", "부가 정보"] as const;
export type ItemKind = (typeof itemKinds)[number];
/** Kinds that are material for problems (situations, numbers), never a learning target on their own. */
export const materialKinds: readonly ItemKind[] = ["예시", "연습문제", "부가 정보"];

export const objectiveKinds = ["용어", "사실", "개념", "관계", "절차", "공식", "패턴"] as const;
export type ObjectiveKind = (typeof objectiveKinds)[number];

export type ModelChoice = { model: string; effort: string };

export type GenInput = {
  sourceId: string;
  fileName: string;
  pageNumbers: number[];
  purpose: Purpose;
  /** Free text from the learner (what they want, exam scope). */
  note: string;
  /** Lab runs may skip the one confirmation and author every objective. */
  autoConfirm: boolean;
  provider: "chatgpt" | "codex" | "fake";
  models: Partial<Record<GenStep, ModelChoice>>;
  /** Reserved slot: weak spots from the notes and reported problems. Empty until notes step 2. */
  signals: { weakSpots: string[]; reports: string[] };
  /** Criteria folder name (출제기준 or a candidate copy). Older runs have none and use the default. */
  guideDir?: string;
  /** Who started it: the lab, or a material made on the study screen (/study lists only those). Older runs: lab. */
  origin?: "lab" | "study";
  /** Read pages that are not full text slides from their image once, before the outline (see pages.ts). */
  readImages?: boolean;
  /** A remake of reported questions: the earlier question per objective, so authoring writes a different one. */
  remake?: { genId: string; previous: Record<string, string> };
};

/** `startText` is where the section begins on its first page; a page shared by two sections is split there. */
export type Section = { id: string; title: string; pages: number[]; startText?: string };

export type ClassItem = { n: number; kind: ItemKind; content: string; quote: string; page: number };

export type Objective = {
  id: string;
  sectionId: string;
  statement: string;
  /** What the learner sees. */
  cue: string;
  /** What the learner must bring back from memory. */
  recall: string;
  kind: ObjectiveKind;
  importance: "core" | "support";
  itemNumbers: number[];
  materialNumbers: number[];
  pages: number[];
  quotes: string[];
};

/** Objectives checked by default at the confirmation: everything for 통암기, otherwise only core ones. */
export function defaultChosen(purpose: Purpose, objectives: Array<{ id: string; importance: "core" | "support" }>) {
  return objectives.filter((objective) => purpose === "all" || objective.importance === "core").map((objective) => objective.id);
}

export type Issue = { severity: "error" | "warning"; code: string; message: string; ref?: string };

export type SectionState = {
  id: string;
  title: string;
  pages: number[];
  startText?: string;
  classify?: { items: ClassItem[]; warnings: Issue[] };
  design?: { objectives: Objective[]; warnings: Issue[] };
  author?: { documentPath: string | null; questionCount: number; dropped: Array<{ objectiveId: string; reason: string }>; warnings: Issue[] };
};

export type GenStatus = "queued" | "running" | "awaiting-confirm" | "paused-usage-limit" | "paused-login" | "paused-invalid" | "interrupted" | "failed" | "done";
export type GenPhase = "outline" | "design" | "confirm" | "author" | "done";

export type GenState = {
  id: string;
  createdAt: string;
  updatedAt: string;
  input: GenInput;
  status: GenStatus;
  phase: GenPhase;
  message: string;
  /** Total model calls across restarts. */
  calls: number;
  /** What runs now, for the screen. */
  current?: { step: GenStep; sectionId?: string; page?: number; attempt: number };
  /** Pages read from their image (readImages): chosen once, then done or failed (failed pages keep the text layer). */
  images?: { pages: number[]; done: number[]; failed: number[] };
  outlineWarnings?: Issue[];
  sections: SectionState[];
  confirmedObjectiveIds?: string[];
  /** A rerun that copied the earlier steps of another run and redoes only `from` onward (fair A/B comparison). */
  forkOf?: { genId: string; from: ForkFrom };
};

/** Where a fixed-prefix rerun starts: redo design+authoring, or authoring only (same objectives). */
export const forkFroms = ["design", "author"] as const;
export type ForkFrom = (typeof forkFroms)[number];

export type GenCall = {
  n: number;
  step: GenStep;
  sectionId: string | null;
  attempt: number;
  model: string;
  effort: string;
  format: "json_schema" | "json_object" | "text" | null;
  startedAt: string;
  ms: number;
  ok: boolean;
  system: string;
  user: string;
  reply: string | null;
  error: string | null;
  usage?: { inputTokens?: number; outputTokens?: number };
  /** Which criteria went into this call: folder, content hash, files. */
  guide?: { dir: string; version: string; files: string[] };
};
