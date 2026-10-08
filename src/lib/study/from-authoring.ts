import type { AuthoredQuestion, AuthoringBlock, AuthoringDocument, ResponseContract } from "../../../tools/problem-authoring-lab/contract.ts";

// 되짚기 화면이 쓰는 자료 형식. 문제 내용은 Recaller 출제 문서를 그대로 옮기고, 새로 만들거나 고치지 않는다.
export type StudyObjective = { id: string; statement: string; pages: number[]; quote: string };
/** The authored question stem, block by block, in reading order. `prompt` keeps a plain-text copy for lists. */
export type StudyBlock =
  | { kind: "text"; text: string; heading: boolean }
  | { kind: "math"; latex: string }
  | { kind: "table"; rows: string[][]; headerRows: number }
  | { kind: "box"; label: string }
  | { kind: "blank"; before: string; after: string; own: boolean }
  | { kind: "image"; alt: string; page: number }
  | { kind: "generated-image"; alt: string; caption: string; path: string };
export type StudyItem = {
  id: string;
  objectiveId: string;
  format: "choice" | "value" | "card";
  prompt: string;
  blocks: StudyBlock[];
  explanation: string;
  page: number;
  quote: string;
  options?: string[];
  answer?: number | string;
  accepted?: string[];
};
export type StudyDeck = {
  id: string;
  artifactSha256: string;
  sourceCatalogId: string;
  title: string;
  sourceName: string;
  pageCount: number;
  order: number;
  objectives: StudyObjective[];
  items: StudyItem[];
  skipped: Array<{ questionId: string; reason: string }>;
};
export type StudyArtifactMeta = {
  id: string;
  title: string;
  artifactSha256: string;
  sourceFile: string;
  sourceCatalogId: string;
  sourceTotalPages: number;
};

const math = (latex: string) => `$${latex.replace(/\s*\n\s*/g, " ")}$`;

function blockText(block: AuthoringBlock, responseId: string): string | null {
  switch (block.kind) {
    case "text": return block.text;
    case "math": return math(block.latex);
    case "table": return block.rows.map((row) => row.join(" | ")).join("\n");
    case "box": return block.label ?? null;
    case "image":
    case "generated-image": return `[그림: ${block.alt}]`;
    case "blank": return `${block.promptBefore}${block.responseId === responseId ? "＿＿＿" : "(다른 칸)"}${block.promptAfter}`;
    default: return null;
  }
}

function studyBlock(block: AuthoringBlock, responseId: string): StudyBlock | null {
  switch (block.kind) {
    case "text": return block.text.trim() ? { kind: "text", text: block.text, heading: block.style === "heading" } : null;
    case "math": return { kind: "math", latex: block.latex };
    case "table": return { kind: "table", rows: block.rows, headerRows: block.headerRows ?? 0 };
    case "box": return block.label?.trim() ? { kind: "box", label: block.label } : null;
    case "blank": return { kind: "blank", before: block.promptBefore, after: block.promptAfter, own: block.responseId === responseId };
    case "image": return { kind: "image", alt: block.alt, page: block.sourceAssetRef.page };
    case "generated-image": return { kind: "generated-image", alt: block.alt, caption: block.caption ?? "", path: block.generatedAssetRef.path };
    default: return null;
  }
}

function firstQuote(sourceRange: string) {
  return sourceRange.split(/\s+\/\s+/)[0]?.trim() ?? "";
}

const readingOrder = (blocks: AuthoringBlock[]) => [...blocks].sort((a, b) => a.frame.y - b.frame.y || a.frame.x - b.frame.x);

function toItem(question: AuthoredQuestion, response: ResponseContract, shared: AuthoringBlock[], multi: boolean): StudyItem {
  // follow the on-page reading order of the authored layout; a shared passage comes first
  const ordered = [...readingOrder(shared), ...readingOrder(question.blocks)];
  const prompt = ordered.map((block) => blockText(block, response.id))
    .filter((line): line is string => !!line && !!line.trim()).join("\n");
  const base = {
    id: multi ? `${question.id}:${response.id}` : question.id,
    objectiveId: question.source.objectiveId,
    prompt,
    blocks: ordered.map((block) => studyBlock(block, response.id)).filter((block): block is StudyBlock => block !== null),
    explanation: response.explanation ?? "",
    page: question.source.sourcePage,
    quote: question.source.sourceRange,
  };
  if (response.kind === "single-choice") {
    const options = response.options.map((option) => option.text ?? (option.latex ? math(option.latex) : ""));
    const answer = response.options.findIndex((option) => option.id === response.correctOptionId);
    if (answer < 0 || options.some((text) => !text.trim())) throw new Error("보기나 정답 연결이 비어 있습니다.");
    return { ...base, format: "choice", options, answer };
  }
  if (!response.acceptedAnswers.length) throw new Error("인정 답안이 없습니다.");
  // Recaller가 자기확인으로 정한 서술형은 되짚기의 '떠올리고 확인'으로 보여 준다.
  if (response.grading === "self-check") return { ...base, format: "card", answer: response.acceptedAnswers.join("\n") };
  return { ...base, format: "value", accepted: response.acceptedAnswers };
}

/** `excluded`: question ID → reason. Those questions stay out of practice (e.g. failed item-quality checks) and are listed in `skipped`. */
export function toStudyDeck(meta: StudyArtifactMeta, document: AuthoringDocument, order = 0, excluded: ReadonlyMap<string, string> = new Map()): StudyDeck {
  const objectives = new Map<string, StudyObjective>();
  const items: StudyItem[] = [];
  const skipped: StudyDeck["skipped"] = [];
  const shared = new Map((document.sharedSets ?? []).map((set) => [set.id, set]));
  for (const question of document.questions) {
    const source = question.source;
    const pages = source.sourcePages?.length ? source.sourcePages : [source.sourcePage];
    const objective = objectives.get(source.objectiveId);
    if (objective) objective.pages = [...new Set([...objective.pages, ...pages])].sort((a, b) => a - b);
    else objectives.set(source.objectiveId, { id: source.objectiveId, statement: source.target, pages: [...pages], quote: firstQuote(source.sourceRange) });
    const reason = excluded.get(question.id);
    if (reason) { skipped.push({ questionId: question.id, reason }); continue; }
    const set = question.sharedSetId ? shared.get(question.sharedSetId) : undefined;
    const sharedBlocks = set?.blocks ?? [];
    for (const response of question.responses) {
      try { items.push(toItem(question, response, sharedBlocks, question.responses.length > 1)); }
      catch (error) { skipped.push({ questionId: question.id, reason: error instanceof Error ? error.message : "변환하지 못했습니다." }); }
    }
  }
  return {
    id: meta.id,
    artifactSha256: meta.artifactSha256,
    sourceCatalogId: meta.sourceCatalogId,
    title: meta.title,
    sourceName: meta.sourceFile,
    pageCount: meta.sourceTotalPages,
    order,
    objectives: [...objectives.values()],
    items,
    skipped,
  };
}
