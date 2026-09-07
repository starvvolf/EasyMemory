export type SourceContent = {
  learningUnitId: string;
  objectiveId: string;
  sourceId: string;
  sourcePage: number;
  sourceRange: string;
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

type BlockBase = { id: string; frame: Frame };
export type AuthoringBlock =
  | (BlockBase & { kind: "text"; text: string; style?: "body" | "heading" | "caption" })
  | (BlockBase & { kind: "box"; label?: string; tone?: "plain" | "accent" | "warning" })
  | (BlockBase & { kind: "image"; alt: string; sourceAssetRef: SourceAssetRef })
  | (BlockBase & { kind: "table"; rows: string[][]; headerRows?: number })
  | (BlockBase & { kind: "choice-set"; responseId: string; optionIds: string[]; columns?: number })
  | (BlockBase & { kind: "blank"; responseId: string; promptBefore: string; promptAfter: string })
  | (BlockBase & { kind: "answer-reveal"; responseIds: string[]; title?: string });

export type ResponseContract =
  | {
      id: string;
      kind: "single-choice";
      options: Array<{ id: string; text: string }>;
      correctOptionId: string;
      grading: "exact";
    }
  | {
      id: string;
      kind: "short-text";
      acceptedAnswers: string[];
      grading: "exact-normalized" | "self-check";
    };

export type AuthoredQuestion = {
  id: string;
  source: SourceContent;
  page: { width: number; height: number };
  blocks: AuthoringBlock[];
  responses: ResponseContract[];
};

export type AuthoringDocument = {
  schemaVersion: "problem-authoring-v1";
  id: string;
  title: string;
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
  | { op: "replace-response"; questionId: string; responseId: string; value: ResponseContract };

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

export function validateDocument(document: AuthoringDocument): InspectionIssue[] {
  const issues: InspectionIssue[] = [];
  if (document.schemaVersion !== "problem-authoring-v1") {
    issues.push({ severity: "error", code: "schema-version", message: "지원하지 않는 문서 계약입니다.", questionId: "document" });
  }
  if (!unique(document.questions.map((question) => question.id))) {
    issues.push({ severity: "error", code: "duplicate-question-id", message: "문항 ID가 중복됩니다.", questionId: "document" });
  }
  for (const question of document.questions) {
    const blockIds = question.blocks.map((block) => block.id);
    const responseIds = question.responses.map((response) => response.id);
    if (!unique(blockIds)) issues.push({ severity: "error", code: "duplicate-block-id", message: "블록 ID가 중복됩니다.", questionId: question.id });
    if (!unique(responseIds)) issues.push({ severity: "error", code: "duplicate-response-id", message: "응답 ID가 중복됩니다.", questionId: question.id });
    const responses = new Map(question.responses.map((response) => [response.id, response]));
    for (const block of question.blocks) {
      const { x, y, width, height } = block.frame;
      if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > question.page.width || y + height > question.page.height) {
        issues.push({ severity: "error", code: "out-of-bounds", message: "블록이 문항 페이지 경계를 벗어납니다.", questionId: question.id, blockId: block.id });
      }
      if (block.kind === "choice-set") {
        const response = responses.get(block.responseId);
        if (!response || response.kind !== "single-choice") {
          issues.push({ severity: "error", code: "choice-response", message: "선지 블록이 객관식 응답 계약을 가리키지 않습니다.", questionId: question.id, blockId: block.id });
        } else if (!unique(block.optionIds) || block.optionIds.some((id) => !response.options.some((option) => option.id === id))) {
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
      if (block.kind === "image" && (block.sourceAssetRef.sourceId !== question.source.sourceId || block.sourceAssetRef.page !== question.source.sourcePage)) {
        issues.push({ severity: "error", code: "image-source", message: "그림이 문항 원문 출처와 연결되지 않았습니다.", questionId: question.id, blockId: block.id });
      }
    }
    for (const response of question.responses) {
      if (response.kind === "single-choice") {
        if (response.options.length < 2 || !unique(response.options.map((option) => option.id)) || !response.options.some((option) => option.id === response.correctOptionId)) {
          issues.push({ severity: "error", code: "single-choice-answer", message: "객관식 정답 또는 선지 계약이 유효하지 않습니다.", questionId: question.id });
        }
      } else if (!response.acceptedAnswers.length || response.acceptedAnswers.some((answer) => !answer.trim())) {
        issues.push({ severity: "error", code: "short-text-answer", message: "단답형 정답이 비어 있습니다.", questionId: question.id });
      }
    }
  }
  return issues;
}

export function applyRevision(document: AuthoringDocument, patch: RevisionPatch) {
  const next = structuredClone(document);
  for (const operation of patch.operations) {
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
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
  return response.acceptedAnswers.some((expected) => normalize(expected) === normalize(answer));
}
