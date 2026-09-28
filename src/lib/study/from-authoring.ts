import type { AuthoredQuestion, AuthoringBlock, AuthoringDocument, ResponseContract } from "../../../tools/problem-authoring-lab/contract.ts";

// 되짚기 화면이 쓰는 자료 형식. 문제 내용은 Recaller 출제 문서를 그대로 옮기고, 새로 만들거나 고치지 않는다.
export type StudyObjective = { id: string; statement: string; pages: number[]; quote: string };
export type StudyItem = {
  id: string;
  objectiveId: string;
  format: "choice" | "value" | "card";
  prompt: string;
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

function firstQuote(sourceRange: string) {
  return sourceRange.split(/\s+\/\s+/)[0]?.trim() ?? "";
}

function toItem(question: AuthoredQuestion, response: ResponseContract, prefix: string[], multi: boolean): StudyItem {
  // follow the on-page reading order of the authored layout
  const blocks = [...question.blocks].sort((a, b) => a.frame.y - b.frame.y || a.frame.x - b.frame.x);
  const prompt = [...prefix, ...blocks.map((block) => blockText(block, response.id))]
    .filter((line): line is string => !!line && !!line.trim()).join("\n");
  const base = {
    id: multi ? `${question.id}:${response.id}` : question.id,
    objectiveId: question.source.objectiveId,
    prompt,
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

export function toStudyDeck(meta: StudyArtifactMeta, document: AuthoringDocument, order = 0): StudyDeck {
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
    const set = question.sharedSetId ? shared.get(question.sharedSetId) : undefined;
    const prefix = set ? set.blocks.map((block) => blockText(block, "")).filter((line): line is string => !!line) : [];
    for (const response of question.responses) {
      try { items.push(toItem(question, response, prefix, question.responses.length > 1)); }
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
