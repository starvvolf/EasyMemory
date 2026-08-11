export type StudyMode = "flashcard" | "cloze" | "translation";

export type BaselineRunMode =
  | "focused_area"
  | "whole_document_core"
  | "whole_document_core_soft_budget";

export type LearningUnitSoftBudget = {
  target: number;
  min: number;
  max: number;
  areas: Array<{
    areaId: string;
    target: number;
    min: number;
    max: number;
  }>;
};

export type WholeDocumentCoreArea = {
  id: string;
  title: string;
  description: string;
  learningValue: string;
  sourceScope: string[];
  estimatedLearningUnitCount: number;
};

export type WholeDocumentCorePlan = {
  summary: string;
  learningGoal: string;
  selectionRationale: string;
  areas: WholeDocumentCoreArea[];
  exclusions: string[];
  estimatedLearningUnitCount: number;
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
  intent: string;
  rationale: string;
  reviewedText?: string;
};

export type Card = {
  id: string;
  type: StudyMode;
  front?: string;
  back?: string;
  clozeText?: string;
  answer?: string;
  answers?: string[];
  hint?: string;
  tags: string[];
  status: CardStatus;
  basis?: string;
  learningUnitId?: string;
  strategy?: CardStrategy;
  sourceId?: string;
  sourcePage?: number;
  sourceRange?: string;
  rationale?: string;
  difficulty?: 1 | 2 | 3 | 4 | 5;
  qualityPassed?: boolean;
  qualityNotes?: string[];
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
};

export type Deck = GeneratePipelineResult & {
  id: string;
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
  suggestedRole: string;
};

export type PdfAnalysisResponse = {
  files: PdfAnalysisResult[];
};
