// Generation engine v2 (docs/DECISIONS.md, 2026-10-12 "생성 엔진 구조"): three steps per table-of-contents section.
// ① 자료 파악 (outline once, then classify per section) → ② 학습 설계 per section → one user confirmation → ③ 출제 per section in order.

export const purposes = ["read", "understand", "core", "all"] as const;
export type Purpose = (typeof purposes)[number];
export const purposeLabel: Record<Purpose, string> = { read: "그냥 읽기", understand: "이해", core: "핵심 암기", all: "통암기" };

/** Model calls, in order. classify and design run per section. */
/** v3 (lab engine choice) adds read (whole PDF → outline + knowledge map), plan and gate; it does not use classify/design. */
export const genSteps = ["transcribe", "outline", "classify", "design", "author", "read", "plan", "gate"] as const;
export type GenStep = (typeof genSteps)[number];
export const genStepLabel: Record<GenStep, string> = { transcribe: "그림 쪽 읽기", outline: "목차", classify: "내용 분류", design: "학습 설계", author: "출제",
  read: "전체 읽기(v3)", plan: "출제 계획(v3)", gate: "관문 검사(v3)" };

export const engines = ["v2", "v3"] as const;
export type Engine = (typeof engines)[number];

export const itemKinds = ["핵심 지식", "재사용 패턴", "예시", "설명", "학습 지시", "연습문제", "부가 정보"] as const;
export type ItemKind = (typeof itemKinds)[number];
/** Kinds that are never a learning target on their own: material for problems (situations, numbers), or course
 * administration (학습 지시: objectives lists, class procedure, grading — 리허설 2026-10-12 s5·s6·s8). */
export const materialKinds: readonly ItemKind[] = ["예시", "연습문제", "부가 정보", "학습 지시"];

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
  /** Optional registered exams: absent means the original generation path, unchanged. */
  pastExamSourceIds?: string[];
  /** A remake of reported questions: the earlier question per objective, so authoring writes a different one. */
  remake?: { genId: string; previous: Record<string, string> };
  /** Engine: v2 (default, outline → classify → design → author) or v3 (협업/설계_생성엔진v3_Claude_20261019.md). */
  engine?: Engine;
};

/** `startText` is where the section begins on its first page; a page shared by two sections is split there. */
/** A study unit (one call chain); `parts` are the finer headings inside it, kept for showing where an objective comes from. */
export type SectionPart = { title: string; pages: number[] };
export type Section = { id: string; title: string; pages: number[]; startText?: string; parts?: SectionPart[] };

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
  /** v3 only: what the question shows, the conditions it must keep, the planned question type and its map refs. */
  given?: string;
  conditions?: string[];
  qtype?: string;
  conceptIds?: string[];
  relationIds?: string[];
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
  parts?: SectionPart[];
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
  current?: { step: GenStep; sectionId?: string; page?: number; attempt: number; progress?: string };
  /** Units being authored right now (v3 makes several at once). */
  making?: string[];
  /** Pages read from their image (readImages): chosen once, then done or failed (failed pages keep the text layer). */
  images?: { pages: number[]; done: number[]; failed: number[] };
  outlineWarnings?: Issue[];
  sections: SectionState[];
  confirmedObjectiveIds?: string[];
  /** A rerun that copied the earlier steps of another run and redoes only `from` onward (fair A/B comparison). */
  forkOf?: { genId: string; from: ForkFrom };
  /** v3: the knowledge map (① 전체 읽기), plan warnings and the gate's verdicts per question. */
  v3?: { map?: import("./v3.ts").KnowledgeMap; warnings?: Issue[]; gate?: Array<{ objectiveId: string; attempt: number; passed: boolean; reasons: string[] }> };
  pastExam?: { cacheKey: string; card: import("./pastexam.ts").VibeCard; checks: Array<{ objectiveId: string; attempt: number; passed: boolean; reason: string }> };
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
  /** cachedTokens: input tokens served from the prompt cache (when the API reports them). */
  usage?: { inputTokens?: number; outputTokens?: number; cachedTokens?: number };
  /** Which criteria went into this call: folder, content hash, files. */
  guide?: { dir: string; version: string; files: string[] };
};

/**
 * Default model per step for study materials (and the lab's starting values). Evidence, 2026-10-12:
 * design/author on sol·medium removed the meaning errors seen on luna·low (B 실측); page reading on sol·medium read
 * 6/6 slides correctly; the outline and classification on luna·low split 52 slides into 52 units and took course
 * objectives for core knowledge (리허설), and every later step inherits those mistakes, so they move up too.
 */
export const DEFAULT_GEN_MODELS: Record<GenStep, ModelChoice> = {
  // sol·low read the same 6 slides with 0 math or number errors and no missing body text, in about half the time
  // (작업지시 13: 54 s vs 120 s); luna·low dropped equations and labels.
  transcribe: { model: "gpt-6-sol", effort: "low" },
  outline: { model: "gpt-6-sol", effort: "medium" },
  classify: { model: "gpt-6-sol", effort: "low" },
  design: { model: "gpt-6-sol", effort: "medium" },
  author: { model: "gpt-6-sol", effort: "medium" },
  // v3: one big read of the whole PDF, a plan over the map, and a light gate per unit.
  read: { model: "gpt-6-sol", effort: "medium" },
  plan: { model: "gpt-6-sol", effort: "medium" },
  gate: { model: "gpt-6-sol", effort: "low" },
};

/**
 * What the reader shows while a material is being made (만들면서 바로 읽기): the outline with each unit's goals as
 * soon as they are planned, and where each unit is — waiting, being made, ready, or held back (보류) by the gate.
 */
export type GenUnitState = "waiting" | "making" | "ready" | "held";
export function genOutline(state: GenState) {
  const confirmed = state.confirmedObjectiveIds ? new Set(state.confirmedObjectiveIds) : null;
  return state.sections.map((section) => {
    const objectives = (section.design?.objectives ?? []).filter((objective) => !confirmed || confirmed.has(objective.id));
    const held = section.author?.dropped?.length ?? 0;
    const unit: GenUnitState = section.author ? ((section.author.questionCount ?? 0) > 0 ? "ready" : "held")
      : state.making?.includes(section.id) || state.current?.sectionId === section.id ? "making" : "waiting";
    return { title: section.title, pages: section.pages, state: unit, held,
      objectives: objectives.map((objective) => ({ id: objective.id, statement: objective.statement, cue: objective.cue, recall: objective.recall,
        importance: objective.importance, kind: objective.kind, pages: objective.pages,
        part: section.parts?.find((part) => part.pages.includes(objective.pages[0]))?.title })) };
  });
}

/** The v3 knowledge map as plain text, for reader features that would otherwise read the pages again (용어 지도). */
export function mapDigest(state: GenState, limit = 30000) {
  const map = state.v3?.map;
  if (!map?.concepts?.length) return "";
  const lines = ["[지식 지도 — 자료를 통째로 읽고 뽑은 개념·관계]"];
  for (const concept of map.concepts) {
    lines.push(`- ${concept.name} (${concept.kind}, p.${concept.pages.join(",")}): ${concept.content}${concept.conditions.length ? ` / 조건: ${concept.conditions.join("; ")}` : ""}`);
  }
  for (const relation of map.relations ?? []) lines.push(`- [${relation.kind}] ${relation.statement}`);
  return lines.join("\n").slice(0, limit);
}
