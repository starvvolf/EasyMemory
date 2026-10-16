export const generationStages = [
  "analyze",
  "plan",
  "prepare",
  "activity-design",
  "cards",
] as const;

export type GenerationStage = (typeof generationStages)[number];

export type MaterialRecord = {
  id: string;
  title: string;
  description: string;
  learningGoal: string;
  instruction: string;
  mode: "flashcard" | "cloze" | "translation";
  subject?: string;
  tags?: string[];
  sourceExpressionMode?: "preserve" | "adapt";
  activitySelectionMode?: "automatic" | "manual";
  source: {
    fileName: string;
    mimeType: string;
    content: string;
  };
};

export type ProjectGenerationConfig = {
  title?: string;
  description?: string;
  learningGoal: string;
  instruction: string;
  mode: "flashcard" | "cloze" | "translation";
  subject?: string;
  tags?: string[];
  sourceExpressionMode?: "preserve" | "adapt";
  activitySelectionMode?: "automatic" | "manual";
};

export type ArtifactMetadata = {
  id: string;
  stage: GenerationStage;
  checksum: string;
  inputChecksum: string;
  sourceChecksum: string;
  parentArtifactIds: string[];
  createdAt: string;
  fileName: string;
};

export type RunSettings = {
  runMode: "focused_area" | "whole_document_core" | "whole_document_core_soft_budget";
  selectedSourceOutlineLeafIds: string[];
  selectedFocusGroupId?: string;
  selectedOutlineLeafIds: string[];
  excludedLearningUnitIds: string[];
};

export type RunRecord = {
  id: string;
  materialId: string;
  projectId?: string;
  sourceIds?: string[];
  sourceChecksums?: Record<string, string>;
  projectConfig?: ProjectGenerationConfig;
  sourceChecksum: string;
  createdAt: string;
  updatedAt: string;
  artifacts: ArtifactMetadata[];
  attempts?: SubmissionAttempt[];
  settings?: RunSettings;
};

export type StoredArtifact = ArtifactMetadata & {
  runId: string;
  materialId: string;
  result: unknown;
};

export type SubmissionAttempt = {
  id: string;
  stage: GenerationStage;
  inputChecksum: string;
  createdAt: string;
  outcome: "accepted" | "rejected";
  artifactId?: string;
  error?: string;
};

