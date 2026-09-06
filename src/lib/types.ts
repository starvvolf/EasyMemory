export type StudyMode = "flashcard" | "cloze" | "translation";

export type BaselineRunMode =
  | "focused_area"
  | "whole_document_core"
  | "whole_document_core_soft_budget";

export type LearningUnitSoftBudget = {
  max: number;
};

export type WholeDocumentCoreArea = {
  id: string;
  title: string;
  description: string;
  learningValue: string;
  sourceScope: string[];
};

export type LearningOutlineSourceRef = {
  /** 프로젝트 자료함에서 같은 이름의 PDF를 구분하기 위한 ID. 기존 결과에는 없을 수 있다. */
  sourceId?: string;
  fileName: string;
  pageNumbers: number[];
};

export type LearningStructureTag =
  | "절차"
  | "목록"
  | "관계"
  | "비교"
  | "수치"
  | "공식"
  | "예외"
  | "틀";

export type LearningOutlineNode = {
  id: string;
  parentId: string | null;
  order: number;
  title: string;
  summary: string;
  sourceRefs: LearningOutlineSourceRef[];
  sourceEvidence: string;
  selectedByDefault: boolean;
  /** 문제 설계에 특별한 구조 정보를 주는 경우에만 붙인다. */
  structureTags?: LearningStructureTag[];
  /** AI가 판단한 학습 중요도. 0=제외, 1=참고, 2=중요, 3=핵심. */
  importance?: 0 | 1 | 2 | 3;
};

export type LearningOutline = {
  title: string;
  summary: string;
  nodes: LearningOutlineNode[];
};

export type LearningConceptTreeSourceRef = {
  fileName: string;
  pageNumbers: number[];
};

export type LearningConceptTreeNode = {
  id: string;
  parentId: string | null;
  order: number;
  depth: number;
  title: string;
  relation: string;
  description: string;
  sourceRefs: LearningConceptTreeSourceRef[];
};

export type LearningConceptTree = {
  id: string;
  title: string;
  sourceFileNames: string[];
  nodes: LearningConceptTreeNode[];
};

export type WholeDocumentCorePlan = {
  summary: string;
  learningGoal: string;
  selectionRationale: string;
  areas: WholeDocumentCoreArea[];
  exclusions: string[];
  maxLearningUnitCount: number;
  learningOutline?: LearningOutline;
};

export type StudyFocusGroup = {
  id: string;
  title: string;
  description: string;
  itemCount: number;
  itemLabel: string;
  selectionInstruction: string;
};

export type StudyGuidelineDraft = {
  summary: string;
  question: string;
  groups: StudyFocusGroup[];
  recommendedGroupId: string;
};

export type ConfirmedStudyGuideline = {
  summary: string;
  selectedGroup: StudyFocusGroup;
  wholeDocumentCore?: WholeDocumentCorePlan;
  countPolicy?: "soft_budget";
  learningUnitSoftBudget?: LearningUnitSoftBudget;
};

export type RecallTrainingOption = {
  id: string;
  title: string;
  cue: string;
  target: string;
  unit: string;
  instruction: string;
  mode: StudyMode;
  variants: RecallSampleVariant[];
};

export type SlotMode = "template" | "filled_example";

export type ExampleSource = "source" | "generated";

export type RecallSampleVariant = {
  id: string;
  label: string;
  description: string;
  slotMode: SlotMode;
  exampleSource: ExampleSource;
  preservePlaceholders: boolean;
  sample: LearningUnitSample;
};

export type RecallDesignDraft = {
  question: string;
  options: RecallTrainingOption[];
  recommendedOptionId: string;
};

export type ConfirmedRecallDesign = {
  selectedOption: RecallTrainingOption;
  selectedVariant: RecallSampleVariant;
};

export type LearningUnitSample = {
  title: string;
  cue: string;
  target: string;
  supportingInfo: string;
};

export type CardStatus = "new" | "known" | "review";

export type DeckBoardColumn = "new" | "learning" | "completed";

export type LearningActivityType =
  | "flashcard"
  | "cloze"
  | "true_false"
  | "multiple_choice"
  | "structure_recall";

export type ActivitySelectionMode = "automatic" | "manual";
export type SourceExpressionMode = "preserve" | "adapt";

export type LearningSupportLevel = "supported" | "partial" | "unsupported";

export type BlueprintRelation = "direct" | "scaffold" | "proxy";

export type BlueprintResponseKind =
  | "short_text"
  | "structured_text"
  | "single_choice"
  | "multiple_choice"
  | "ordered_structure"
  | "unordered_structure"
  | "numeric"
  | "code"
  | "graph_annotation"
  | "audio"
  | "checklist";

export type SupportAssessmentLevel =
  | "exact"
  | "scaffold"
  | "proxy"
  | "unsupported";

export type LearningOperation =
  | "recall"
  | "reconstruct"
  | "discriminate"
  | "apply";

export type LearningObjective = {
  id: string;
  outlineNodeId: string;
  learningUnitId: string;
  target: string;
  terminalOperation: LearningOperation;
  successCriteria: Array<{
    id: string;
    description: string;
    required: boolean;
  }>;
  importance: 0 | 1 | 2 | 3;
};

export type PracticeBlueprint = {
  id: string;
  objectiveId: string;
  learningUnitId: string;
  relationToObjective: BlueprintRelation;
  elicitedOperation: LearningOperation;
  coverageCriterionIds: string[];
  given: Array<{
    type: "instruction" | "context" | "data" | "diagram" | "example";
    description: string;
  }>;
  hidden: Array<{
    description: string;
    reason: "target_answer" | "required_inference" | "intermediate_step";
  }>;
  expectedResponse: {
    kind: BlueprintResponseKind;
    description: string;
  };
  scoringRubric: Array<{
    criterionId: string;
    description: string;
    weight: number;
    gradingMode: "exact" | "semantic" | "rule" | "self";
  }>;
  difficulty: {
    cueLevel: "high" | "medium" | "low";
    responseComplexity: "atomic" | "multi_part" | "multi_step";
    transferDistance: "same_context" | "near_transfer" | "far_transfer";
  };
  requiredCapabilities: string[];
  /** 이 문제 설계가 실제로 확인하는 개념트리 노드. */
  conceptNodeIds?: string[];
  recommendedType: LearningActivityType;
};

/**
 * 사용자가 고른 원문 목차에 연결되는 학습 목표입니다.
 * 기존 1:1 카드 설계 타입과 분리해 목표 하나가 여러 지식 단위를 가질 수 있습니다.
 */
export type LearningDesignObjective = {
  id: string;
  outlineNodeIds: string[];
  target: string;
  terminalOperation: LearningOperation;
  successCriteria: Array<{
    id: string;
    description: string;
    required: boolean;
  }>;
  importance: 0 | 1 | 2 | 3;
};

export type KnowledgeUnit = {
  id: string;
  objectiveId: string;
  outlineNodeIds: string[];
  content: string;
  sourceId: string;
  sourcePage: number;
  sourceRange: string;
  sourceText: string;
  knowledgeType: KnowledgeType;
  rationale: string;
  /** Learning Design에서 묶거나 나눈 개념트리 노드 범위. */
  conceptNodeIds?: string[];
};

export type AssessmentBlueprint = Omit<
  PracticeBlueprint,
  "learningUnitId" | "recommendedType"
> & {
  knowledgeUnitId: string;
};

export type LearningDesignPlan = {
  objectives: LearningDesignObjective[];
  knowledgeUnits: KnowledgeUnit[];
  assessmentBlueprints: AssessmentBlueprint[];
};

export type SupportAssessment = {
  blueprintId: string;
  rendererType: LearningActivityType;
  level: SupportAssessmentLevel;
  preservesOperation: boolean;
  capturesRequiredResponse: boolean;
  supportsRequiredInput: boolean;
  supportsScoring: boolean;
  missingCapabilities: string[];
  rationale: string;
};

export type GenerationPolicy = {
  includeExact: true;
  includeScaffold: boolean;
  includeProxy: boolean;
  includeUnsupported: false;
};

export type ActivityRecommendation = {
  learningUnitId: string;
  objectiveId?: string;
  blueprintId?: string;
  assessmentLevel?: SupportAssessmentLevel;
  supportLevel: LearningSupportLevel;
  recommendedType: LearningActivityType | null;
  reason: string;
  limitation: string;
  includeInGeneration: boolean;
};

export type ActivityDesign = {
  recommendations: ActivityRecommendation[];
  objectives?: LearningObjective[];
  blueprints?: PracticeBlueprint[];
  supportAssessments?: SupportAssessment[];
  policy?: GenerationPolicy;
};

export type StructureRecallNode = {
  id: string;
  parentId: string | null;
  correctLabel: string;
};

export type StructureRecallKind = "sequence" | "hierarchy";

export type StructureRecallMode = "word_bank" | "free_input";

export type StudyActivityType = "flashcard" | "graded_problem";

export type StudyAnswer =
  | string
  | number
  | boolean
  | null
  | StudyAnswer[]
  | { [key: string]: StudyAnswer };

export type StudySessionStatus = "active" | "completed" | "abandoned";

export type StudySelfRating = "known" | "review";

export type StudySelectionMode =
  | "all"
  | "random"
  | "due"
  | "review_only"
  | "new_only";

export type FsrsCardState = "new" | "learning" | "review" | "relearning";

export type SpacedRepetitionSchedule = {
  algorithm: "fsrs";
  dueAt: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  repetitions: number;
  lapses: number;
  state: FsrsCardState;
  lastReviewAt?: string;
};

export type PdfMaskActivity = {
  id: string;
  learningUnitId: string;
  sourceId: string;
  sourcePage: number;
  importance: 1 | 2 | 3;
  status: CardStatus;
  reviewSchedule?: SpacedRepetitionSchedule;
};

export type StoredPdfSource = {
  id: string;
  deckId: string;
  fileName: string;
  mimeType: string;
  lastModified: number;
  blob: Blob;
};

export type StudySession = {
  id: string;
  deckId: string;
  activityType: StudyActivityType;
  startedAt: string;
  endedAt: string | null;
  status: StudySessionStatus;
  selectionMode: StudySelectionMode;
  plannedActivityIds: string[];
  plannedItemCount: number;
  completedItemCount: number;
  currentIndex: number;
};

export type FlashcardStudyAttempt = {
  id: string;
  sessionId: string;
  activityType: "flashcard";
  activityId: string;
  learningUnitId?: string;
  startedAt: string;
  answerRevealedAt: string | null;
  completedAt: string;
  selfRating: StudySelfRating;
  wasNew: boolean;
};

export type GradedStudyAttempt = {
  id: string;
  sessionId: string;
  activityType: "graded_problem";
  activityId: string;
  learningUnitId?: string;
  startedAt: string;
  completedAt: string;
  isCorrect: boolean;
  userAnswer: StudyAnswer;
  correctAnswer: StudyAnswer;
};

export type StudyAttempt = FlashcardStudyAttempt | GradedStudyAttempt;

export type SourceType =
  | "concept"
  | "comparison"
  | "script"
  | "definition"
  | "mixed";

export type KnowledgeType =
  | "vocabulary"
  | "fact"
  | "concept"
  | "relationship"
  | "procedure"
  | "formula"
  | "speaking_pattern"
  | "writing_pattern"
  | "problem_solving_pattern"
  | "example"
  | "other";

export type CardStrategy =
  | "production"
  | "recognition"
  | "concept"
  | "contrast"
  | "procedure"
  | "application";

export type LearningUnit = {
  id: string;
  sourceId: string;
  sourcePage: number;
  sourceRange: string;
  sourceText: string;
  knowledgeType: KnowledgeType;
  fixedPart: string;
  variableSlots: Array<{
    name: string;
    example: string;
  }>;
  generalizedForm: string;
  target?: string;
  operation?: LearningOperation;
  successCriterion?: string;
  /** @deprecated 과거 덱과 실험 결과를 읽기 위한 필드. 새 결과는 target을 사용한다. */
  intent?: string;
  rationale: string;
  reviewedText?: string;
};

export type Card = {
  id: string;
  type: StudyMode;
  activityType?: LearningActivityType;
  front?: string;
  back?: string;
  clozeText?: string;
  answer?: string;
  answers?: string[];
  options?: string[];
  correctOptionIndex?: number;
  correctBoolean?: boolean;
  structureNodes?: StructureRecallNode[];
  structureRecallKind?: StructureRecallKind;
  supportedStructureRecallModes?: StructureRecallMode[];
  structureRecallMode?: StructureRecallMode;
  recommendationReason?: string;
  hint?: string;
  tags: string[];
  status: CardStatus;
  basis?: string;
  learningUnitId?: string;
  objectiveId?: string;
  blueprintId?: string;
  /** 연결된 문제 설계에서 상속한 개념트리 노드. */
  conceptNodeIds?: string[];
  strategy?: CardStrategy;
  sourceId?: string;
  sourcePage?: number;
  sourceRange?: string;
  rationale?: string;
  difficulty?: 1 | 2 | 3 | 4 | 5;
  qualityPassed?: boolean;
  qualityNotes?: string[];
  qualityStatus?: "not_run" | "passed" | "failed" | "waived";
  explanation?: string;
  reviewSchedule?: SpacedRepetitionSchedule;
};

export type AnalysisResult = {
  detectedGoal: string;
  sourceType: SourceType;
  keyTopics: string[];
  recommendedStrategy: string;
  extractedMaterial?: string;
  primaryKnowledgeType?: KnowledgeType;
  learningUnits?: LearningUnit[];
};

export type OrganizedMaterial = {
  title: string;
  sections: Array<{
    heading: string;
    content: string;
    learningUnitIds?: string[];
  }>;
};

export type GeneratePipelineResult = {
  analysis: AnalysisResult;
  organizedMaterial: OrganizedMaterial;
  cards: Card[];
  learningDesign?: LearningDesignPlan;
  activityDesign?: ActivityDesign;
  codexThreadId?: string;
};

export type Deck = GeneratePipelineResult & {
  id: string;
  projectId?: string;
  title: string;
  boardColumn: DeckBoardColumn;
  subject: string;
  tags: string[];
  mode: StudyMode;
  sourceText: string;
  sourceFileName?: string;
  instruction: string;
  studyGuideline?: ConfirmedStudyGuideline;
  recallDesign?: ConfirmedRecallDesign;
  activityDesign?: ActivityDesign;
  activitySelectionMode?: ActivitySelectionMode;
  sourceExpressionMode?: SourceExpressionMode;
  outlineSelection?: {
    outline: LearningOutline;
    selectedLeafIds: string[];
  };
  conceptTree?: LearningConceptTree;
  conceptTreeIds?: string[];
  pdfSourceIds?: string[];
  pdfMaskActivities?: PdfMaskActivity[];
  createdAt: string;
  updatedAt: string;
};

export type GenerateRequest = {
  title: string;
  subject: string;
  tags: string[];
  sourceText: string;
  instruction: string;
  mode: StudyMode;
  sourceExpressionMode?: SourceExpressionMode;
};

export type PdfOutlineSection = {
  heading: string;
  points: string[];
};

export type PdfAnalysisResult = {
  fileName: string;
  documentType: string;
  summary: string;
  keyTopics: string[];
  outline: PdfOutlineSection[];
  /** PDF에 실제로 나타난 장·절·항목 관계를 보존한 원문 목차. */
  sourceOutline?: LearningOutline;
  suggestedRole: string;
};

export type PdfAnalysisResponse = {
  files: PdfAnalysisResult[];
  /** 여러 PDF의 원문 목차를 한 화면에서 선택하기 위해 합친 구조. */
  sourceOutline?: LearningOutline;
};
