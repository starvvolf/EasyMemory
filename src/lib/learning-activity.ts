import type {
  Card,
  LearningActivityType,
  StructureRecallNode,
  StructureRecallMode,
} from "./types.ts";
import type { StudyAnswer } from "./graded-study.ts";

export function getLearningActivityType(card: Card): LearningActivityType {
  return card.activityType ?? "flashcard";
}

export function isAutomaticallyGradedActivity(card: Card) {
  return getLearningActivityType(card) !== "flashcard";
}

export function getStructureRecallMode(card: Card): StructureRecallMode {
  return card.structureRecallMode ?? "word_bank";
}

export function getCorrectStudyAnswer(card: Card): StudyAnswer {
  switch (getLearningActivityType(card)) {
    case "true_false":
      return card.correctBoolean ?? null;
    case "multiple_choice":
      return card.correctOptionIndex ?? null;
    case "structure_recall":
      return Object.fromEntries(
        (card.structureNodes ?? []).map((node) => [node.id, node.correctLabel]),
      );
    case "flashcard":
      return card.back ?? card.answer ?? "";
  }
}

export function gradeStudyAnswer(card: Card, userAnswer: StudyAnswer) {
  if (!isAutomaticallyGradedActivity(card)) return false;
  if (getLearningActivityType(card) === "structure_recall") {
    return gradeStructureRecallAnswer(
      card.structureNodes ?? [],
      userAnswer,
      getStructureRecallMode(card),
    );
  }
  return answersEqual(userAnswer, getCorrectStudyAnswer(card));
}

export function validateLearningActivity(card: Card): string[] {
  const type = getLearningActivityType(card);
  if (!card.front?.trim()) return ["문제 문장이 필요합니다."];
  if (type === "flashcard") return card.back?.trim() || card.answer?.trim()
    ? []
    : ["플래시카드 정답이 필요합니다."];
  if (type === "true_false") return typeof card.correctBoolean === "boolean"
    ? []
    : ["OX 정답이 필요합니다."];
  if (type === "multiple_choice") {
    const options = card.options ?? [];
    const uniqueOptions = new Set(options.map((option) => option.trim()));
    const hasOnlyNonEmptyOptions = options.every((option) => option.trim().length > 0);
    const validIndex = Number.isInteger(card.correctOptionIndex) &&
      Number(card.correctOptionIndex) >= 0 &&
      Number(card.correctOptionIndex) < options.length;
    return options.length >= 2 &&
        hasOnlyNonEmptyOptions &&
        uniqueOptions.size === options.length &&
        validIndex
      ? []
      : ["객관식은 서로 다른 선택지 2개 이상과 유효한 정답 번호가 필요합니다."];
  }
  const structureIssues = validateStructureNodes(card.structureNodes ?? []);
  if (structureIssues.length > 0) return structureIssues;
  if (
    getStructureRecallMode(card) === "free_input" &&
    (card.structureNodes ?? []).some(
      (node) => node.correctLabel.length > 40 || node.correctLabel.includes("\n"),
    )
  ) {
    return ["답 없는 빈칸형은 짧고 한 가지로 확정되는 정답만 사용할 수 있습니다."];
  }
  return [];
}

export type LearningActivityCollectionValidation = {
  isValid: boolean;
  invalidCount: number;
  firstInvalid: {
    index: number;
    cardId: string;
    issues: string[];
  } | null;
};

export function validateLearningActivities(
  cards: readonly Card[],
): LearningActivityCollectionValidation {
  let invalidCount = 0;
  let firstInvalid: LearningActivityCollectionValidation["firstInvalid"] = null;

  cards.forEach((card, index) => {
    const issues = validateLearningActivity(card);
    if (issues.length === 0) return;

    invalidCount += 1;
    firstInvalid ??= { index, cardId: card.id, issues };
  });

  return {
    isValid: invalidCount === 0,
    invalidCount,
    firstInvalid,
  };
}

export function getStructureRecallChoices(
  nodes: StructureRecallNode[],
  sessionId: string,
  activityId: string,
): string[] {
  const labels = nodes.map((node) => node.correctLabel);
  if (labels.length < 2) return labels;

  const shuffled = [...labels];
  let state = hashSeed(`${sessionId}\u0000${activityId}`);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    state = nextRandomState(state);
    const swapIndex = state % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  if (shuffled.every((label, index) => label === labels[index])) {
    shuffled.push(shuffled.shift() as string);
  }
  return shuffled;
}

export function getAvailableStructureRecallChoices(
  choices: string[],
  answers: Record<string, StudyAnswer>,
  currentNodeId: string,
): string[] {
  const currentAnswer = answers[currentNodeId];
  const usedByOtherNodes = new Set(
    Object.entries(answers)
      .filter(([nodeId]) => nodeId !== currentNodeId)
      .map(([, answer]) => answer)
      .filter((answer): answer is string => typeof answer === "string"),
  );
  return choices.filter(
    (choice) => choice === currentAnswer || !usedByOtherNodes.has(choice),
  );
}

function validateStructureNodes(nodes: StructureRecallNode[]) {
  if (nodes.length < 2) return ["구조복원에는 빈자리 2개 이상이 필요합니다."];
  const ids = new Set(nodes.map((node) => node.id));
  const labels = new Set(nodes.map((node) => node.correctLabel.trim()));
  if (ids.size !== nodes.length || labels.size !== nodes.length || labels.has("")) {
    return ["구조복원의 빈자리 ID와 정답 단어는 서로 달라야 합니다."];
  }
  if (nodes.some((node) => node.parentId !== null && !ids.has(node.parentId))) {
    return ["구조복원의 부모 빈자리가 존재하지 않습니다."];
  }
  const roots = nodes.filter((node) => node.parentId === null);
  if (roots.length === 0) {
    return ["구조복원의 시작 빈자리가 필요합니다."];
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const rootIds = new Set(roots.map((root) => root.id));
  for (const node of nodes) {
    const visited = new Set<string>();
    let current: StructureRecallNode | undefined = node;
    while (current.parentId !== null) {
      if (visited.has(current.id)) {
        return ["구조복원의 부모 관계에 순환이 있습니다."];
      }
      visited.add(current.id);
      current = nodesById.get(current.parentId);
      if (!current) break;
    }
    if (!current || !rootIds.has(current.id)) {
      return ["구조복원의 모든 빈자리는 유효한 시작 빈자리로 연결되어야 합니다."];
    }
  }
  return [];
}

function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextRandomState(state: number) {
  let next = state || 0x9e3779b9;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return next >>> 0;
}

function answersEqual(left: StudyAnswer, right: StudyAnswer): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => answersEqual(value, right[index]));
  }
  if (isAnswerRecord(left) || isAnswerRecord(right)) {
    if (!isAnswerRecord(left) || !isAnswerRecord(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) => key === rightKeys[index] && answersEqual(left[key], right[key]),
      );
  }
  return left === right;
}

function isAnswerRecord(value: StudyAnswer): value is { [key: string]: StudyAnswer } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTypedStructureAnswer(value: StudyAnswer) {
  return String(value)
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

function gradeStructureRecallAnswer(
  nodes: StructureRecallNode[],
  userAnswer: StudyAnswer,
  mode: StructureRecallMode,
) {
  if (!isAnswerRecord(userAnswer)) return false;

  const siblingsByParent = new Map<string | null, StructureRecallNode[]>();
  for (const node of nodes) {
    const siblings = siblingsByParent.get(node.parentId) ?? [];
    siblings.push(node);
    siblingsByParent.set(node.parentId, siblings);
  }

  return [...siblingsByParent.values()].every((siblings) => {
    const expected = siblings
      .map((node) => normalizeStructureAnswer(node.correctLabel, mode))
      .sort();
    const actual = siblings
      .map((node) => userAnswer[node.id])
      .filter((answer): answer is string => typeof answer === "string")
      .map((answer) => normalizeStructureAnswer(answer, mode))
      .sort();
    return expected.length === actual.length &&
      expected.every((answer, index) => answer === actual[index]);
  });
}

function normalizeStructureAnswer(value: StudyAnswer, mode: StructureRecallMode) {
  return mode === "free_input" ? normalizeTypedStructureAnswer(value) : String(value);
}
