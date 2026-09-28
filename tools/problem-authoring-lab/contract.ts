import katex from "katex";
import { normalizeExactAnswer } from "./grading.ts";

export type SourceContent = {
  learningUnitId: string;
  objectiveId: string;
  sourceId: string;
  sourcePage: number;
  sourcePages?: number[];
  sourceRange: string;
  knowledgeContent?: string;
  sourceText: string;
  target: string;
  successCriteria: string[];
};

export type Frame = { x: number; y: number; width: number; height: number };
export type SourceAssetRef = {
  sourceId: string;
  page: number;
  assetId: string;
  crop?: { x: number; y: number; width: number; height: number };
};
export type GeneratedAssetRef = {
  assetId: string;
  path: string;
  mimeType: "image/svg+xml";
  sha256: string;
  generator: "python-matplotlib";
  generatorVersion: string;
  scriptPath: string;
  specPath: string;
  specSha256: string;
};

type BlockBase = { id: string; frame: Frame };
export type AuthoringBlock =
  | (BlockBase & { kind: "text"; text: string; style?: "body" | "heading" | "caption" })
  | (BlockBase & { kind: "math"; latex: string; displayMode?: boolean })
  | (BlockBase & { kind: "box"; label?: string; tone?: "plain" | "accent" | "warning" })
  | (BlockBase & { kind: "image"; alt: string; sourceAssetRef: SourceAssetRef })
  | (BlockBase & { kind: "generated-image"; alt: string; caption?: string; generatedAssetRef: GeneratedAssetRef })
  | (BlockBase & { kind: "table"; rows: string[][]; headerRows?: number })
  | (BlockBase & { kind: "choice-set"; responseId: string; optionIds: string[]; columns?: number })
  | (BlockBase & { kind: "blank"; responseId: string; promptBefore: string; promptAfter: string })
  | (BlockBase & { kind: "answer-reveal"; responseIds: string[]; title?: string });

export type ResponseContract =
  | {
      id: string;
      kind: "single-choice";
      options: Array<{ id: string; text?: string; latex?: string }>;
      correctOptionId: string;
      grading: "exact";
      explanation?: string;
    }
  | {
      id: string;
      kind: "short-text";
      acceptedAnswers: string[];
      grading: "exact-normalized" | "self-check";
      explanation?: string;
    };

export type AuthoredQuestion = {
  id: string;
  source: SourceContent;
  sharedSetId?: string;
  page: { width: number; height: number };
  blocks: AuthoringBlock[];
  responses: ResponseContract[];
};

export type SharedQuestionSet = {
  id: string;
  source: SourceContent;
  page: { width: number; height: number };
  blocks: AuthoringBlock[];
};

export type AuthoringDocument = {
  schemaVersion: "problem-authoring-v1";
  id: string;
  title: string;
  sharedSets?: SharedQuestionSet[];
  questions: AuthoredQuestion[];
};

export type InspectionIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  questionId: string;
  blockId?: string;
};

export type PatchOperation =
  | { op: "replace-block"; questionId: string; blockId: string; value: AuthoringBlock }
  | { op: "replace-response"; questionId: string; responseId: string; value: ResponseContract }
  | { op: "replace-shared-block"; sharedSetId: string; blockId: string; value: AuthoringBlock };

export type RevisionPatch = {
  instruction: string;
  operations: PatchOperation[];
};

export type ModelUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
};

function unique(values: string[]) {
  return new Set(values).size === values.length;
}

function isSafeRelativePath(value: string) {
  if (!value || value.includes("\\") || /^[a-z]+:/i.test(value) || value.startsWith("/")) return false;
  return value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

function validGeneratedImage(block: Extract<AuthoringBlock, { kind: "generated-image" }>) {
  const asset = block.generatedAssetRef;
  return Boolean(block.alt.trim())
    && asset.mimeType === "image/svg+xml"
    && asset.generator === "python-matplotlib"
    && /^assets\/[a-z0-9][a-z0-9._-]*\.svg$/i.test(asset.path)
    && isSafeRelativePath(asset.path)
    && isSafeRelativePath(asset.scriptPath)
    && isSafeRelativePath(asset.specPath)
    && /^[a-f0-9]{64}$/i.test(asset.sha256)
    && /^[a-f0-9]{64}$/i.test(asset.specSha256)
    && Boolean(asset.assetId.trim())
    && Boolean(asset.generatorVersion.trim());
}

function validLatex(value: string | undefined) {
  if (!value?.trim()) return false;
  try {
    katex.renderToString(value, { throwOnError: true, trust: false });
    return true;
  } catch {
    return false;
  }
}

function hasPlainMatrixRows(value: string | undefined) {
  if (!value) return false;
  return [...value.matchAll(/\[([^\]\n]+)\]/g)].some((match) => {
    const rows = (match[1] ?? "").split(";").map((row) => row.trim().split(/\s+/));
    return rows.length >= 2 && rows.every((row) => row.length >= 2);
  });
}

export function validateDocument(document: AuthoringDocument): InspectionIssue[] {
  const issues: InspectionIssue[] = [];
  if (document.schemaVersion !== "problem-authoring-v1") {
    issues.push({ severity: "error", code: "schema-version", message: "지원하지 않는 문서 계약입니다.", questionId: "document" });
  }
  if (!unique(document.questions.map((question) => question.id))) {
    issues.push({ severity: "error", code: "duplicate-question-id", message: "문항 ID가 중복됩니다.", questionId: "document" });
  }
  const sets = document.sharedSets ?? [];
  if (!unique(sets.map((set) => set.id))) issues.push({ severity: "error", code: "duplicate-shared-set-id", message: "공통 자료 세트 ID가 중복됩니다.", questionId: "document" });
  const setById = new Map(sets.map((set) => [set.id, set]));
  const allResponseIds = document.questions.flatMap((question) => question.responses.map((response) => response.id));
  if (!unique(allResponseIds)) issues.push({ severity: "error", code: "duplicate-document-response-id", message: "문서 전체에서 응답 ID가 중복됩니다.", questionId: "document" });
  for (const set of sets) {
    if (!set.id.trim() || !document.questions.some((question) => question.sharedSetId === set.id)) issues.push({ severity: "error", code: "unused-shared-set", message: "공통 자료 세트에 연결된 문항이 없습니다.", questionId: set.id });
    if (!set.source.sourceId.trim() || !Number.isInteger(set.source.sourcePage) || set.source.sourcePage < 1 || !set.source.sourceText.trim()) issues.push({ severity: "error", code: "shared-source-contract", message: "공통 자료의 원문 출처가 불완전합니다.", questionId: set.id });
    const blockIds = set.blocks.map((block) => block.id);
    if (!unique(blockIds)) issues.push({ severity: "error", code: "duplicate-shared-block-id", message: "공통 자료 블록 ID가 중복됩니다.", questionId: set.id });
    for (const block of set.blocks) {
      const { x, y, width, height } = block.frame;
      if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > set.page.width || y + height > set.page.height) issues.push({ severity: "error", code: "shared-out-of-bounds", message: "공통 자료 블록이 페이지 경계를 벗어납니다.", questionId: set.id, blockId: block.id });
      if (["choice-set", "blank", "answer-reveal"].includes(block.kind)) issues.push({ severity: "error", code: "shared-response-block", message: "응답 블록은 개별 문항에 있어야 합니다.", questionId: set.id, blockId: block.id });
      if (block.kind === "image" && (block.sourceAssetRef.sourceId !== set.source.sourceId || !(set.source.sourcePages ?? [set.source.sourcePage]).includes(block.sourceAssetRef.page))) issues.push({ severity: "error", code: "shared-image-source", message: "공통 그림의 출처가 다릅니다.", questionId: set.id, blockId: block.id });
      if (block.kind === "generated-image" && !validGeneratedImage(block)) issues.push({ severity: "error", code: "generated-asset-contract", message: "공통 생성 그림의 재현 정보가 유효하지 않습니다.", questionId: set.id, blockId: block.id });
      if (block.kind === "math" && !validLatex(block.latex)) issues.push({ severity: "error", code: "math-syntax", message: "공통 수식의 LaTeX가 유효하지 않습니다.", questionId: set.id, blockId: block.id });
      if (hasPlainMatrixRows(block.kind === "text" ? block.text : block.kind === "box" ? block.label : undefined)) issues.push({ severity: "warning", code: "plain-matrix", message: "세미콜론으로 구분한 행렬을 math 블록으로 조판하세요.", questionId: set.id, blockId: block.id });
    }
  }
  for (const question of document.questions) {
    if (!question.source.sourceId.trim() || !Number.isInteger(question.source.sourcePage) || question.source.sourcePage < 1 || !question.source.sourceText.trim() || !question.source.target.trim() || !question.source.successCriteria.length) issues.push({ severity: "error", code: "source-contract", message: "문항의 학습 목표 또는 원문 출처가 불완전합니다.", questionId: question.id });
    const set = question.sharedSetId ? setById.get(question.sharedSetId) : undefined;
    if (question.sharedSetId && !set) issues.push({ severity: "error", code: "missing-shared-set", message: "문항의 공통 자료 세트가 없습니다.", questionId: question.id });
    if (set && set.source.sourceId !== question.source.sourceId) issues.push({ severity: "error", code: "shared-source", message: "문항과 공통 자료의 원문 출처가 다릅니다.", questionId: question.id });
    const blockIds = question.blocks.map((block) => block.id);
    const responseIds = question.responses.map((response) => response.id);
    if (!unique(blockIds)) issues.push({ severity: "error", code: "duplicate-block-id", message: "블록 ID가 중복됩니다.", questionId: question.id });
    if (!unique(responseIds)) issues.push({ severity: "error", code: "duplicate-response-id", message: "응답 ID가 중복됩니다.", questionId: question.id });
    const responses = new Map(question.responses.map((response) => [response.id, response]));
    for (const block of question.blocks) {
      const { x, y, width, height } = block.frame;
      if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > question.page.width || y + height > question.page.height) {
        issues.push({ severity: "error", code: "out-of-bounds", message: "블록이 문항 페이지 경계를 벗어납니다.", questionId: question.id, blockId: block.id });
      }
      if (block.kind === "choice-set") {
        const response = responses.get(block.responseId);
        if (!response || response.kind !== "single-choice") {
          issues.push({ severity: "error", code: "choice-response", message: "선지 블록이 객관식 응답 계약을 가리키지 않습니다.", questionId: question.id, blockId: block.id });
        } else if (!unique(block.optionIds) || block.optionIds.length !== response.options.length || block.optionIds.some((id) => !response.options.some((option) => option.id === id))) {
          issues.push({ severity: "error", code: "choice-option-link", message: "선지 블록의 optionId 연결이 잘못되었습니다.", questionId: question.id, blockId: block.id });
        }
      }
      if (block.kind === "blank") {
        const response = responses.get(block.responseId);
        if (!response || response.kind !== "short-text") {
          issues.push({ severity: "error", code: "blank-response", message: "빈칸 블록이 단답 응답 계약을 가리키지 않습니다.", questionId: question.id, blockId: block.id });
        }
      }
      if (block.kind === "answer-reveal" && block.responseIds.some((id) => !responses.has(id))) {
        issues.push({ severity: "error", code: "reveal-response", message: "답 공개 블록이 없는 응답을 참조합니다.", questionId: question.id, blockId: block.id });
      }
      if (block.kind === "image" && (block.sourceAssetRef.sourceId !== question.source.sourceId || !(question.source.sourcePages ?? [question.source.sourcePage]).includes(block.sourceAssetRef.page))) {
        issues.push({ severity: "error", code: "image-source", message: "그림이 문항 원문 출처와 연결되지 않았습니다.", questionId: question.id, blockId: block.id });
      }
      if (block.kind === "generated-image") {
        if (!validGeneratedImage(block)) {
          issues.push({ severity: "error", code: "generated-asset-contract", message: "생성 그림의 로컬 SVG 경로 또는 재현 정보가 유효하지 않습니다.", questionId: question.id, blockId: block.id });
        }
      }
      if (block.kind === "math" && !validLatex(block.latex)) issues.push({ severity: "error", code: "math-syntax", message: "수식의 LaTeX가 유효하지 않습니다.", questionId: question.id, blockId: block.id });
      if (hasPlainMatrixRows(block.kind === "text" ? block.text : block.kind === "box" ? block.label : undefined)) issues.push({ severity: "warning", code: "plain-matrix", message: "세미콜론으로 구분한 행렬을 math 블록으로 조판하세요.", questionId: question.id, blockId: block.id });
    }
    for (const response of question.responses) {
      const inputBlocks = question.blocks.filter((block) => (block.kind === "choice-set" || block.kind === "blank") && block.responseId === response.id);
      if (inputBlocks.length !== 1) issues.push({ severity: "error", code: "response-input-count", message: "응답마다 선택지 또는 빈칸 입력 블록 하나가 필요합니다.", questionId: question.id });
      if (response.kind === "single-choice") {
        if (response.options.length < 2 || !unique(response.options.map((option) => option.id)) || !response.options.some((option) => option.id === response.correctOptionId) || response.options.some((option) => Boolean(option.text?.trim()) === Boolean(option.latex?.trim()))) {
          issues.push({ severity: "error", code: "single-choice-answer", message: "객관식 정답 또는 선지 계약이 유효하지 않습니다.", questionId: question.id });
        }
        if (response.options.some((option) => option.latex !== undefined && !validLatex(option.latex))) issues.push({ severity: "error", code: "math-syntax", message: "선지 수식의 LaTeX가 유효하지 않습니다.", questionId: question.id });
        if (response.options.some((option) => hasPlainMatrixRows(option.text))) issues.push({ severity: "warning", code: "plain-matrix", message: "세미콜론으로 구분한 선지 행렬을 LaTeX로 조판하세요.", questionId: question.id });
      } else if (!response.acceptedAnswers.length || response.acceptedAnswers.some((answer) => !answer.trim())) {
        issues.push({ severity: "error", code: "short-text-answer", message: "단답형 정답이 비어 있습니다.", questionId: question.id });
      }
    }
  }
  return issues;
}

export function validateDocumentAgainstPacket(document: AuthoringDocument, packet: { items: SourceContent[] }): InspectionIssue[] {
  const byUnit = new Map(packet.items.map((item) => [item.learningUnitId, item]));
  const entries = [
    ...document.questions.map((question) => ({ id: question.id, source: question.source })),
    ...(document.sharedSets ?? []).map((set) => ({ id: set.id, source: set.source })),
  ];
  return entries.flatMap(({ id, source }) => {
    const fixed = byUnit.get(source.learningUnitId);
    if (fixed && fixed.objectiveId === source.objectiveId && fixed.sourceId === source.sourceId && fixed.sourcePage === source.sourcePage && JSON.stringify(fixed.sourcePages ?? []) === JSON.stringify(source.sourcePages ?? []) && fixed.sourceText === source.sourceText && fixed.target === source.target && JSON.stringify(fixed.successCriteria) === JSON.stringify(source.successCriteria)) return [];
    return [{ severity: "error" as const, code: "packet-source-mismatch", message: "확정된 학습 목표와 원문 출처가 입력 패킷과 다릅니다.", questionId: id }];
  });
}

export function validateFormatOverride(document: AuthoringDocument, override: Record<string, "single-choice" | "short-text">): InspectionIssue[] {
  return Object.entries(override).flatMap(([questionId, kind]) => {
    const question = document.questions.find((item) => item.id === questionId);
    if (question?.responses.length === 1 && question.responses[0]?.kind === kind) return [];
    return [{ severity: "error" as const, code: "format-override", message: "지정된 문항 응답 형식을 따르지 않았습니다.", questionId }];
  });
}

export function applyRevision(document: AuthoringDocument, patch: RevisionPatch) {
  const next = structuredClone(document);
  for (const operation of patch.operations) {
    if (operation.op === "replace-shared-block") {
      const set = next.sharedSets?.find((item) => item.id === operation.sharedSetId);
      const index = set?.blocks.findIndex((block) => block.id === operation.blockId) ?? -1;
      if (!set || index < 0 || operation.value.id !== operation.blockId) throw new Error(`공통 블록 ID를 바꿀 수 없습니다: ${operation.blockId}`);
      set.blocks[index] = operation.value;
      continue;
    }
    const question = next.questions.find((item) => item.id === operation.questionId);
    if (!question) throw new Error(`없는 문항입니다: ${operation.questionId}`);
    if (operation.op === "replace-block") {
      const index = question.blocks.findIndex((block) => block.id === operation.blockId);
      if (index < 0 || operation.value.id !== operation.blockId) throw new Error(`블록 ID를 바꿀 수 없습니다: ${operation.blockId}`);
      question.blocks[index] = operation.value;
    } else {
      const index = question.responses.findIndex((response) => response.id === operation.responseId);
      if (index < 0 || operation.value.id !== operation.responseId) throw new Error(`응답 ID를 바꿀 수 없습니다: ${operation.responseId}`);
      question.responses[index] = operation.value;
    }
  }
  const errors = validateDocument(next).filter((issue) => issue.severity === "error");
  if (errors.length) throw new Error(errors.map((issue) => `${issue.questionId}/${issue.code}`).join(", "));
  return next;
}

export function gradeResponse(response: ResponseContract, answer: string) {
  if (response.kind === "single-choice") return answer === response.correctOptionId;
  if (response.grading === "self-check") return null;
  return response.acceptedAnswers.some((expected) => normalizeExactAnswer(expected) === normalizeExactAnswer(answer));
}
