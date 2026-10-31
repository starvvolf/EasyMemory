// Generation engine v2 (docs/DECISIONS.md, 2026-10-12 "생성 엔진 구조"): three steps per table-of-contents section.
// ① 자료 파악 (outline once, then classify per section) → ② 학습 설계 per section → one user confirmation → ③ 출제 per section in order.

export const purposes = ["read", "understand", "core", "all"] as const;
export type Purpose = (typeof purposes)[number];
export const purposeLabel: Record<Purpose, string> = { read: "그냥 읽기", understand: "이해", core: "핵심 암기", all: "통암기" };

/** Model calls, in order. classify and design run per section. */
/** v3 (lab engine choice) adds read (whole PDF → outline + knowledge map), plan and gate; it does not use classify/design. */
export const genSteps = ["transcribe", "outline", "classify", "design", "author", "read", "plan", "gate", "astra-plan", "astra-author", "astra-solve", "astra-review",
  "rc-organize", "rc-link", "rc-author", "rc-deep", "rc-solve", "rc-check", "rc-merge", "rc-intent"] as const;
export type GenStep = (typeof genSteps)[number];
export const genStepLabel: Record<GenStep, string> = { transcribe: "그림 쪽 읽기", outline: "목차", classify: "내용 분류", design: "학습 설계", author: "출제",
  read: "전체 읽기(v3)", plan: "출제 계획(v3)", gate: "관문 검사(v3)", "astra-plan": "전체 학습 계획(astra·v4)", "astra-author": "묶음 출제(astra·v4)", "astra-solve": "정답 없는 풀이(astra·v4)", "astra-review": "검수(astra·v4)",
  "rc-organize": "정리", "rc-link": "연결 묶기", "rc-author": "기본 문제", "rc-deep": "심화 문제", "rc-solve": "따로 풀기", "rc-check": "묶음 검토", "rc-merge": "자료 전체 정리", "rc-intent": "쪽 의도" };

export const engines = ["v2", "v3", "astra", "v4", "v5", "alpha", "recaller"] as const;
export type Engine = (typeof engines)[number];
/** astra and v4 (Claude's tuning of astra) share the astra pipeline, steps and state; v4 only adds rules. */
export const astraFamily = (engine: Engine | undefined) => engine === "astra" || engine === "v4" || engine === "v5" || engine === "alpha";
/** v5 and its successor alpha (GPT의 v5 개선안: 계획이 문항 설계 assessment까지 정하고 출제가 그대로 구현) share the v5 pipeline. */
export const v5Family = (engine: Engine | undefined) => engine === "v5" || engine === "alpha";
/** v5 learning formats (보관/협업/설계와논의/설계_생성엔진v5_Claude_20261019.md); each maps to one of the study screen's response kinds. */
export const studyFormats = ["choice", "ox", "short", "cloze", "flashcard"] as const;
export type StudyFormat = (typeof studyFormats)[number];
/** v5: a short survey before generation (설문). Absent and no note: the engine decides (알잘딱). */
/** alpha: the plan's item design per goal (internal; never shown to the learner). */
export const assessmentOperations = ["식별", "구별", "조건판단", "순서판단", "적용", "산출", "이유판단"] as const;
export type Assessment = { focus: string; operation: (typeof assessmentOperations)[number]; decisive: string };
export type GenSurvey = { style?: "recall" | "understand"; difficulty?: "easy" | "normal" | "hard"; exam?: "choice" | "mixed" | "written"; depth?: "core" | "all"; time?: "short" | "normal" | "long"; known?: string };

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
  /** astra lab: prioritize the page the learner is currently reading. */
  priorityPage?: number;
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
  /** recaller: deep questions too (off unless asked; light materials have little to tie together). */
  deep?: boolean;
  /** 공부 화면: cards and 자료 전체 정리 only; the questions are made when the learner asks (questionsGen clears it). */
  questionsLater?: boolean;
  /** recaller: drafts of each deep question written at once (1 by default; 2 is faster and uses twice as much). */
  deepDrafts?: 1 | 2;
  /** recaller 검증 실험: the plain one-call baseline (no cards, no checks). */
  baseline?: boolean;
  /** recaller 종합 문제: the earlier recaller runs whose cards are tied together. */
  combine?: string[];
  /** Optional registered exams: absent means the original generation path, unchanged. */
  pastExamSourceIds?: string[];
  /** A remake of reported questions: the earlier question per objective, so authoring writes a different one. */
  remake?: { genId: string; previous: Record<string, string>; reasons?: Record<string, string> };
  /** Engine: v2 (default, outline → classify → design → author) or v3 (보관/협업/설계와논의/설계_생성엔진v3_Claude_20261019.md). */
  engine?: Engine;
  /** v5: survey answers (설문 mode). */
  survey?: GenSurvey;
  /** v4/v5 plan input: the PDF file, the chosen pages' text plus one image per page, or the text plus only the cropped picture regions (v5 default). */
  planInput?: "pdf" | "pages" | "figures";
  /** v5 실험: every author/solve/review call starts with the same source block so the prompt cache can reuse it. */
  cacheMode?: "shared";
  /** recaller 실험 손잡이 (연구 1, 2026-10-28: 큰 PDF의 첫 훑기). Absent means today's pipeline, unchanged. */
  lab?: RecallerLab;
};
export type RecallerLab = {
  /** prep-2: math-alphabet letters no longer send a page to the model; only garbled math fonts, pictures and bare pages do. */
  router?: "prep-1" | "prep-2";
  /** Stop after 정리 (cards only): measures the first pass over the material without questions. */
  skimOnly?: boolean;
  /** Pages read+organized at once, across sections (default: 2 sections at a time, every page of a section at once). */
  pageParallel?: number;
  /** Page readings at once (default 4). */
  readParallel?: number;
  /** Long side of a page image in pixels (default 1600). */
  imageWidth?: number;
  /** Pages that need the picture: 정리 looks at the page image itself, no separate reading call. */
  inlineRead?: boolean;
  /** 3번(가): every 정리 call also gets the whole material's page titles and the neighbouring pages' first lines (no extra call). */
  outline?: boolean;
  /** 3번(나): after the first pass, one text-only call over all cards names each specifically, marks duplicates, gives a topic,
   *  a material-wide weight and links (자료 지도). On by default since 2026-10-29, beside the questions and never failing the run;
   *  true makes it blocking and its failure fatal (the old 실험), false turns it off. */
  consolidate?: boolean;
  /** 빠른 전처리: read and draw pages in this many worker processes in one pass (a drawing crash ends a worker, not the server). */
  fastPrep?: number;
  /** Pages per 정리 call within a section (default 1). */
  chunk?: number;
  /** A 정리 reply still out after this many ms gets a second, identical request; the first to finish wins. */
  hedgeMs?: number;
  /** A shorter 정리 reply: no links/takes/gives, one mistake and one piece of evidence per card. */
  lean?: boolean;
  /** A quote not found in the text layer becomes picture evidence instead of sending the page back. */
  lenientQuotes?: boolean;
  /** 쪽 의도 먼저 (10/29): each page's intent before its cards; cover/preview/guide pages make none, a continuing page only what is new. */
  intent?: boolean;
  /** 쪽 의도를 먼저 한 번에 (10/29 실험): one fast call gives every page's intent and a one-line gist; 정리 gets them instead of deciding. */
  intentPass?: boolean;
  /** with intentPass: intents only, no one-line gist (shorter reply, sooner cards). */
  intentLean?: boolean;
  /** with intentPass: 정리 starts at once (deciding intents itself) and the pass runs beside it; preview pages' cards are dropped when it ends. */
  intentParallel?: boolean;
  /** each page's 정리 also reads its outline section's other pages (text) and makes only the cards its page owns (10/29 실험). */
  sectionContext?: boolean;
  /** Calls allowed per start (other than page readings); default grows with the sections. */
  callCap?: number;
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
  astra?: { practiceIds: string[]; conceptIds: string[]; checkedSkill: string; requiredPoints: string[]; evidence: import("./astra.ts").AstraEvidence[]; keepGoal?: boolean;
    /** v5: what the learner must be able to do, the format chosen for it, and whether a figure is the evidence. */
    level?: string; format?: StudyFormat; figurePages?: number[];
    /** alpha: how the goal is assessed — the knowledge to check, the operation, and what separates the answer from plausible wrong ones. */
    assessment?: Assessment };
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
  /** Times the run went on by itself after a connection hiccup (recaller). */
  autoResumes?: number;
  /** What runs now, for the screen. */
  current?: { step: GenStep; sectionId?: string; page?: number; attempt: number; progress?: string };
  /** Units being authored right now (v3 makes several at once). */
  making?: string[];
  /** When each thing the reader shows became available (사용 흐름 점검): wall-clock marks, appended across restarts. */
  timeline?: GenMark[];
  /** astra concurrent calls; counts only, no unfinished question/answer content. */
  liveCalls?: Array<{ n: number; step: GenStep; startedAt: string; receivedChars: number; firstTextAt?: string }>;
  /** Pages read from their image (readImages): chosen once, then done or failed (failed pages keep the text layer). */
  images?: { pages: number[]; done: number[]; failed: number[] };
  outlineWarnings?: Issue[];
  sections: SectionState[];
  confirmedObjectiveIds?: string[];
  /** A rerun that copied the earlier steps of another run and redoes only `from` onward (fair A/B comparison). */
  forkOf?: { genId: string; from: ForkFrom };
  /** 실험: made from this run's cards, with only the 자료 전체 정리 done again (runner.remergeGen). */
  remergeOf?: string;
  /** v3: the knowledge map (① 전체 읽기), plan warnings and the gate's verdicts per question. */
  v3?: { map?: import("./v3.ts").KnowledgeMap; warnings?: Issue[]; gate?: Array<{ objectiveId: string; attempt: number; passed: boolean; reasons: string[] }> };
  astra?: import("./astra.ts").AstraState;
  recaller?: import("./recaller.ts").RecallerState;
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
  firstTextMs?: number;
  /** Whether the whole PDF went with this call (PDF 1회 통제: one per run on the normal path). */
  withPdf?: boolean;
  /** v5 cache mode: length of the shared source block this call started with (the block itself is in state.astra.shared). */
  sharedChars?: number;
  ok: boolean;
  system: string;
  user: string;
  reply: string | null;
  error: string | null;
  usage?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number };
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
  "astra-plan": { model: "gpt-6-sol", effort: "medium" },
  "astra-author": { model: "gpt-6-sol", effort: "medium" },
  "astra-solve": { model: "gpt-6-sol", effort: "medium" },
  "astra-review": { model: "gpt-6-sol", effort: "medium" },
  // recaller: organizing is the one step everything else stands on; basic questions are made from its cards and kept fast.
  // sol·low wrote half as much as sol·medium with no loss seen (3D Viewing p.8–11, 2026-10-24); luna and terra were not faster.
  // 2026-10-28 (C, 사용자 "6.1 terra 써"): with the fast first pass, terra·low judged as well as sol (24·17·1 vs 18·20·0) and
  // the first question came 4 s sooner.
  "rc-organize": { model: "gpt-6.1-terra", effort: "low" },
  "rc-link": { model: "gpt-6-sol", effort: "low" },
  "rc-author": { model: "gpt-6-sol", effort: "low" },
  "rc-deep": { model: "gpt-6-sol", effort: "low" },
  "rc-solve": { model: "gpt-6-sol", effort: "high" },
  "rc-check": { model: "gpt-6-sol", effort: "low" },
  // 연구 1 3번 (실험): one text-only pass over every card of the material.
  // 자료 지도의 자료 전체 정리 (10/29 C, 44쪽 같은 카드로 비교): terra·low 19–22초·주제 8–9개·핵심 고르기가 기준표와 가장 가까움,
  // sol·low 28–38초·주제가 5–7개로 뭉치고 이름 충돌을 덜 고침, medium은 생각만 40초.
  "rc-merge": { model: "gpt-6.1-terra", effort: "low" },
  // 쪽 의도 먼저 (실험, 10/29): one short pass over every page's title and text before 정리.
  "rc-intent": { model: "gpt-6.1-terra", effort: "low" },
};

/**
 * What the reader shows while a material is being made (만들면서 바로 읽기): the outline with each unit's goals as
 * soon as they are planned, and where each unit is — waiting, being made, ready, or held back (보류) by the gate.
 */
export type GenMark = { at: string; event: "start" | "outline" | "plan" | "confirm" | "confirmed" | "unit-start" | "unit-done" | "focus" | "done" | "stopped";
  sectionId?: string; page?: number; questions?: number; held?: number; note?: string };
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
