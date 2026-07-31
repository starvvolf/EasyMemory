export type StudyMode = "flashcard" | "cloze" | "translation";

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
