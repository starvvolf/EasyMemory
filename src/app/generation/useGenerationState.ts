"use client";

import type {
  ActivityDesign,
  ActivitySelectionMode,
  BaselineRunMode,
  Card,
  GeneratePipelineResult,
  GenerateRequest,
  LearningActivityType,
  OrganizedMaterial,
  PdfAnalysisResponse,
  StudyGuidelineDraft,
  WholeDocumentCorePlan,
} from "@/lib/types";
import { useState } from "react";

export const emptyGenerateForm: GenerateRequest = {
  title: "",
  subject: "",
  tags: [],
  sourceText: "",
  instruction: "",
  mode: "flashcard",
  sourceExpressionMode: "adapt",
};

export function useGenerationState() {
  const [sourceProjectId, setSourceProjectId] = useState<string | null>(null);
  const [isProjectGenerationOpen, setIsProjectGenerationOpen] = useState(false);
  const [projectCachedAnalysis, setProjectCachedAnalysis] =
    useState<PdfAnalysisResponse | null>(null);
  const [form, setForm] = useState<GenerateRequest>(emptyGenerateForm);
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [pdfAnalysis, setPdfAnalysis] = useState<PdfAnalysisResponse | null>(null);
  const [studyGuideline, setStudyGuideline] =
    useState<StudyGuidelineDraft | null>(null);
  const [selectedFocusGroupId, setSelectedFocusGroupId] = useState<string | null>(null);
  const [runMode, setRunMode] = useState<BaselineRunMode>("focused_area");
  const [wholeDocumentCorePlan, setWholeDocumentCorePlan] =
    useState<WholeDocumentCorePlan | null>(null);
  const [selectedSourceOutlineLeafIds, setSelectedSourceOutlineLeafIds] =
    useState<string[]>([]);
  const [showSourceOutlineSelectionError, setShowSourceOutlineSelectionError] =
    useState(false);
  const [selectedOutlineLeafIds, setSelectedOutlineLeafIds] = useState<string[]>([]);
  const [learningGoalInput, setLearningGoalInput] = useState("");
  const [planLearningGoal, setPlanLearningGoal] = useState("");
  const [isPlanningGuideline, setIsPlanningGuideline] = useState(false);
  const [isPlanningWholeDocument, setIsPlanningWholeDocument] = useState(false);
  const [preparedResult, setPreparedResult] =
    useState<GeneratePipelineResult | null>(null);
  const [editableMaterial, setEditableMaterial] =
    useState<OrganizedMaterial | null>(null);
  const [excludedLearningUnitIds, setExcludedLearningUnitIds] = useState<string[]>([]);
  const [activeLearningUnitId, setActiveLearningUnitId] = useState<string | null>(null);
  const [isLearningUnitSelectionConfirmed, setIsLearningUnitSelectionConfirmed] =
    useState(false);
  const [activitySelectionMode, setActivitySelectionMode] =
    useState<ActivitySelectionMode>("automatic");
  const [problemDesignAdvice, setProblemDesignAdvice] = useState("");
  const [activityDesign, setActivityDesign] = useState<ActivityDesign | null>(null);
  const [selectedActivityTypes, setSelectedActivityTypes] = useState<
    Record<string, LearningActivityType>
  >({});
  const [selectedActivityIncludes, setSelectedActivityIncludes] = useState<
    Record<string, boolean>
  >({});
  const [isDesigningActivities, setIsDesigningActivities] = useState(false);
  const [isAnalyzingPdfs, setIsAnalyzingPdfs] = useState(false);
  const [isPreparingMaterial, setIsPreparingMaterial] = useState(false);
  const [analysisPhaseIndex, setAnalysisPhaseIndex] = useState(0);
  const [pipelineResult, setPipelineResult] =
    useState<GeneratePipelineResult | null>(null);
  const [editableCards, setEditableCards] = useState<Card[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingPhaseIndex, setLoadingPhaseIndex] = useState(0);

  return {
    sourceProjectId, setSourceProjectId,
    isProjectGenerationOpen, setIsProjectGenerationOpen,
    projectCachedAnalysis, setProjectCachedAnalysis,
    form, setForm,
    pdfFiles, setPdfFiles,
    pdfAnalysis, setPdfAnalysis,
    studyGuideline, setStudyGuideline,
    selectedFocusGroupId, setSelectedFocusGroupId,
    runMode, setRunMode,
    wholeDocumentCorePlan, setWholeDocumentCorePlan,
    selectedSourceOutlineLeafIds, setSelectedSourceOutlineLeafIds,
    showSourceOutlineSelectionError, setShowSourceOutlineSelectionError,
    selectedOutlineLeafIds, setSelectedOutlineLeafIds,
    learningGoalInput, setLearningGoalInput,
    planLearningGoal, setPlanLearningGoal,
    isPlanningGuideline, setIsPlanningGuideline,
    isPlanningWholeDocument, setIsPlanningWholeDocument,
    preparedResult, setPreparedResult,
    editableMaterial, setEditableMaterial,
    excludedLearningUnitIds, setExcludedLearningUnitIds,
    activeLearningUnitId, setActiveLearningUnitId,
    isLearningUnitSelectionConfirmed, setIsLearningUnitSelectionConfirmed,
    activitySelectionMode, setActivitySelectionMode,
    problemDesignAdvice, setProblemDesignAdvice,
    activityDesign, setActivityDesign,
    selectedActivityTypes, setSelectedActivityTypes,
    selectedActivityIncludes, setSelectedActivityIncludes,
    isDesigningActivities, setIsDesigningActivities,
    isAnalyzingPdfs, setIsAnalyzingPdfs,
    isPreparingMaterial, setIsPreparingMaterial,
    analysisPhaseIndex, setAnalysisPhaseIndex,
    pipelineResult, setPipelineResult,
    editableCards, setEditableCards,
    isGenerating, setIsGenerating,
    loadingPhaseIndex, setLoadingPhaseIndex,
  };
}
