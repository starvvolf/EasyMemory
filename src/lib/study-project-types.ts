import type { PdfAnalysisResult } from "@/lib/types";

export type StudyProject = {
  id: string;
  name: string;
  codexThreadId?: string;
  createdAt: string;
  updatedAt: string;
};

export type StudyProjectSource = {
  id: string;
  projectId: string;
  fileName: string;
  mimeType: string;
  size: number;
  lastModified: number;
  addedAt: string;
  checksum: string;
  analysis?: StudyProjectSourceAnalysis;
  readingAnalysis?: StudyProjectSourceAnalysis;
};

export type StudyProjectSourceAnalysis = {
  sourceChecksum: string;
  generatedAt: string;
  result: PdfAnalysisResult;
};

export type StudyProjectSummary = StudyProject & {
  sourceCount: number;
};

export type StudyCodingSession = {
  id: string;
  projectId: string;
  learningGoal: string;
  currentTask: string;
  workspaceLabel: string;
  status: "active" | "completed";
  startedAt: string;
  updatedAt: string;
};

export type StudyCodingSubmission = {
  id: string;
  sessionId: string;
  projectId: string;
  filePath: string;
  language: string;
  selectedCode: string;
  surroundingCode?: string;
  authoringMode: "direct" | "ai_assisted" | "unspecified";
  submittedAt: string;
};

export type StudyCodingSessionDetail = StudyCodingSession & {
  latestSubmission?: StudyCodingSubmission;
  submissionCount: number;
};

export type StudyProjectDetail = {
  project: StudyProject;
  sources: StudyProjectSource[];
  activeCodingSession?: StudyCodingSessionDetail;
};
