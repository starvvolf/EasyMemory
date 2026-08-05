export type StudyMode = "flashcard" | "cloze" | "translation";

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
};

export type RecallTrainingOption = {
  id: string;
  title: string;
  cue: string;
  target: string;
  unit: string;
  instruction: string;
};

export type RecallDesignDraft = {
  question: string;
  options: RecallTrainingOption[];
  recommendedOptionId: string;
};

export type ConfirmedRecallDesign = {
  selectedOption: RecallTrainingOption;
};

export type LearningUnitSample = {
  title: string;
  cue: string;
  target: string;
  supportingInfo: string;
};

export type CardStatus = "new" | "known" | "review";

export type SourceType =
  | "concept"
  | "comparison"
  | "script"
  | "definition"
  | "mixed";

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
};

export type AnalysisResult = {
  detectedGoal: string;
  sourceType: SourceType;
  keyTopics: string[];
  recommendedStrategy: string;
  extractedMaterial?: string;
};

export type OrganizedMaterial = {
  title: string;
  sections: Array<{
    heading: string;
    content: string;
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
