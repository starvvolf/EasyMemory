"use client";

import {
  validateLearningActivities,
  validateLearningActivity
} from "@/lib/learning-activity";
import {
  buildSelectedOutlineSourceText,
  filterOutlineToSelection,
  filterPlanToOutlineSelection,
  getDefaultNodeSelection,
  getDefaultOutlineSelection,
} from "@/lib/learning-outline";
import { validateOutlineSelection } from "@/lib/outline-selection";
import {
  activityRecommendationKey,
  applyActivityDesignSelections,
} from "@/lib/practice-blueprint";
import {
  countDueReviews
} from "@/lib/spaced-repetition";
import {
  listDecks,
  listStudyAttempts,
  listStudySessions,
  saveDeck,
  saveDeckWithPdfSources
} from "@/lib/storage";
import {
  findLatestActiveStudySession
} from "@/lib/study-session";
import type {
  ActivityDesign,
  Card,
  Deck,
  DeckBoardColumn,
  GeneratePipelineResult,
  LearningActivityType,
  PdfAnalysisResponse,
  StudyGuidelineDraft,
  WholeDocumentCorePlan
} from "@/lib/types";
import {
  CalendarDays,
  Cloud,
  Columns3,
  GraduationCap,
  Workflow
} from "lucide-react";
import { useEffect,useMemo,useState } from "react";
import PipelineOperatorModal from "./PipelineOperatorModal";
import TodayHome from "./TodayHome";
import {
  CreateView,
  ProjectLearningCreateView,
  ReviewView,
} from "./generation/GenerationViews";
import {
  emptyGenerateForm as emptyForm,
  useGenerationState,
} from "./generation/useGenerationState";
import { DecksView } from "./library/DecksView";
import { useDeckLibraryController } from "./library/useDeckLibraryController";
import { LearningManagerView } from "./manager/LearningManagerView";
import {
  DebugModal,
  DeckDetailModal,
  LoadingOverlay,
  MobileNavButton,
  NavButton,
  buildActivityDesignRequest,
  buildConfirmedStudyGuideline,
  buildGenerateRequest,
  buildLearningActivityRequest,
  buildLearningPlanGenerationRequest,
  buildProblemDesignInstruction,
  buildWholeDocumentCoreGuideline,
  filterOrganizedMaterial,
  getViewEyebrow,
  getViewTitle,
  importPublishedMcpDecks,
  migrateDeckConceptTreesToProjects,
  normalizeCards,
  parseTags,
  renderClozeText
} from "./study-forge-shared";
import type { View } from "./study-forge-types";
import {
  StudyView
} from "./study/StudyView";
import { useStudySessionController } from "./study/useStudySessionController";

const showAiDebug = process.env.NEXT_PUBLIC_SHOW_AI_DEBUG === "true";
const loadingPhases = [
  "확정한 학습 내용에서 문제 단위를 준비하고 있습니다.",
  "선택한 방식으로 문제를 생성하고 형식을 확인하고 있습니다.",
];

const pdfAnalysisPhases = [
  "업로드한 PDF를 확인하고 있습니다.",
  "문서의 내용과 구조를 읽고 있습니다.",
  "원문 목차와 예비 중요도를 정리하고 있습니다.",
];

export default function Home() {
  const [view, setView] = useState<View>("manager");
  const generation = useGenerationState();
  const {
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
  } = generation;
  const tagInput = "";
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const library = useDeckLibraryController({ setError, setNotice });
  const {
    decks,
    setDecks,
    studySessions,
    setStudySessions,
    studyAttempts,
    setStudyAttempts,
    isLoadingManager,
    setIsLoadingManager,
    detailDeck,
    setDetailDeck,
    renamingDeckId,
    renameValue,
    setRenameValue,
    refreshDecks,
    startRename,
    cancelRename,
  } = library;
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [isPipelineOpen, setIsPipelineOpen] = useState(false);
  const study = useStudySessionController({
    view,
    setView,
    setDecks,
    setStudySessions,
    setStudyAttempts,
    setError,
  });
  const {
    selectedDeck,
    setSelectedDeck,
    studyIndex,
    isAnswerVisible,
    activeStudySession,
    currentStudyCard,
    gradedUserAnswer,
    setGradedUserAnswer,
    gradedResult,
    studySessionCounts,
    studyCompletion,
    isSavingStudyProgress,
    restoreSession,
    openStudyWithMode,
    openStudy,
    startStudy,
    resumeSession,
    closeStudy,
    toggleStudyAnswer,
    markCard,
    submitGradedAnswer,
    advanceAfterGradedAnswer,
  } = study;

  useEffect(() => {
    let cancelled = false;
    async function restoreSavedState() {
      try {
        let existingDecks = await listDecks();
        await migrateDeckConceptTreesToProjects(existingDecks);
        existingDecks = await listDecks();
        const importedMcpDeckCount = await importPublishedMcpDecks(existingDecks);
        const [savedDecks, sessions, attempts] = await Promise.all([
          listDecks(),
          listStudySessions(),
          listStudyAttempts(),
        ]);
        if (cancelled) return;
        setDecks(savedDecks);
        setStudySessions(sessions);
        setStudyAttempts(attempts);
        if (importedMcpDeckCount > 0) {
          setNotice(`MCP에서 발행한 학습자료 ${importedMcpDeckCount}개를 가져왔습니다.`);
        }
        const session = findLatestActiveStudySession(sessions);
        const deck = session
          ? savedDecks.find((item) => item.id === session.deckId)
          : undefined;
        if (!session || !deck) return;

        restoreSession(
          session,
          deck,
          attempts.filter((attempt) => attempt.sessionId === session.id),
        );
        setNotice("진행 중이던 학습을 불러왔습니다.");
      } catch (restoreError) {
        if (!cancelled) {
          setError(
            restoreError instanceof Error
              ? `저장된 학습을 불러오지 못했습니다: ${restoreError.message}`
              : "저장된 학습을 불러오지 못했습니다.",
          );
        }
      }
    }
    void restoreSavedState();
    return () => {
      cancelled = true;
    };
  }, [restoreSession, setDecks, setStudyAttempts, setStudySessions]);

  useEffect(() => {
    if (view !== "manager" && view !== "records" && view !== "decks") return;
    let cancelled = false;
    async function refreshManager() {
      setIsLoadingManager(true);
      try {
        const [sessions, attempts] = await Promise.all([
          listStudySessions(),
          listStudyAttempts(),
        ]);
        if (cancelled) return;
        setStudySessions(sessions);
        setStudyAttempts(attempts);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? `학습 기록을 불러오지 못했습니다: ${loadError.message}`
              : "학습 기록을 불러오지 못했습니다.",
          );
        }
      } finally {
        if (!cancelled) setIsLoadingManager(false);
      }
    }
    void refreshManager();
    return () => {
      cancelled = true;
    };
  }, [view, setIsLoadingManager, setStudyAttempts, setStudySessions]);

  const hasGenerationInProgress =
    isAnalyzingPdfs ||
    isPlanningGuideline ||
    isPlanningWholeDocument ||
    isPreparingMaterial ||
    isDesigningActivities ||
    isGenerating;

  useEffect(() => {
    if (!hasGenerationInProgress) return;

    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasGenerationInProgress]);

  const confirmedStudyGuideline = useMemo(
    () =>
      runMode !== "focused_area" && wholeDocumentCorePlan
        ? buildWholeDocumentCoreGuideline(wholeDocumentCorePlan, runMode)
        : buildConfirmedStudyGuideline(studyGuideline, selectedFocusGroupId),
    [runMode, wholeDocumentCorePlan, studyGuideline, selectedFocusGroupId],
  );
  const isPlanLearningGoalDirty = Boolean(
    wholeDocumentCorePlan &&
      planLearningGoal.trim() !== wholeDocumentCorePlan.learningGoal.trim(),
  );

  async function handlePrepareMaterial() {
    setError("");
    setNotice("");
    setIsPreparingMaterial(true);
    setPreparedResult(null);
    setEditableMaterial(null);

    if (isPlanLearningGoalDirty) {
      setIsPreparingMaterial(false);
      setError("수정한 학습목표로 핵심을 다시 선별한 뒤 진행하세요.");
      return;
    }

    const confirmedGuideline = confirmedStudyGuideline;
    if (!confirmedGuideline) {
      setIsPreparingMaterial(false);
      setError("학습 방향을 먼저 모두 선택해 주세요.");
      return;
    }
    const outline = wholeDocumentCorePlan?.learningOutline;
    if (outline) {
      const selectionErrors = validateOutlineSelection(
        outline.nodes,
        selectedOutlineLeafIds,
      );
      if (selectionErrors.length > 0) {
        setIsPreparingMaterial(false);
        setError(selectionErrors[0]);
        return;
      }
    }

    const selectedSourceText = outline
      ? buildSelectedOutlineSourceText(outline.nodes, selectedOutlineLeafIds)
      : "";
    const userReferenceText = form.sourceText.trim();
    const scopedSourceText = [
      selectedSourceText,
      userReferenceText ? `## 사용자 참고 내용\n${userReferenceText}` : "",
    ].filter(Boolean).join("\n\n");
    const prepareForm = scopedSourceText
      ? { ...form, sourceText: scopedSourceText }
      : form;
    // Plan이 선택 목차마다 보존한 원문 근거를 Prepare에 전달하므로 같은 PDF를 다시 보내지 않습니다.
    // 목차 근거가 없는 옛 흐름은 기존처럼 PDF를 보내 정확성을 유지합니다.
    const prepareFiles = outline && selectedSourceText.trim() ? [] : pdfFiles;
    const prepareGuideline = wholeDocumentCorePlan
      ? {
          ...confirmedGuideline,
          wholeDocumentCore: filterPlanToOutlineSelection(
            wholeDocumentCorePlan,
            selectedOutlineLeafIds,
          ),
        }
      : confirmedGuideline;
    try {
      const response = await fetch(
        "/api/generate",
        buildGenerateRequest(
          prepareForm,
          tagInput,
          prepareFiles,
          pdfAnalysis,
          prepareGuideline,
          "design",
          sourceProjectId,
        ),
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "학습 단위 추출에 실패했습니다.");
      }

      const result = data as GeneratePipelineResult;
      const learningUnits = result.analysis.learningUnits ?? [];
      setPreparedResult(result);
      setEditableMaterial(result.organizedMaterial);
      setExcludedLearningUnitIds([]);
      setActiveLearningUnitId(learningUnits[0]?.id ?? null);
      setIsLearningUnitSelectionConfirmed(false);
      setNotice("학습 목표와 문제 설계를 만들었습니다. 확인한 뒤 문제를 생성하세요.");
    } catch (prepareError) {
      setError(
        prepareError instanceof Error
          ? prepareError.message
          : "학습 단위 추출에 실패했습니다.",
      );
    } finally {
      setIsPreparingMaterial(false);
    }
  }

  function resetAnalysisFlow() {
    setPdfAnalysis(null);
    setStudyGuideline(null);
    setSelectedFocusGroupId(null);
    setRunMode("focused_area");
    setWholeDocumentCorePlan(null);
    setSelectedOutlineLeafIds([]);
    setPlanLearningGoal("");
    setProblemDesignAdvice("");
    resetPreparedFlow();
    setPreparedResult(null);
    setEditableMaterial(null);
    setError("");
    setNotice("");
  }

  function updateCard(id: string, patch: Partial<Card>) {
    setEditableCards((cards) =>
      cards.map((card) => (card.id === id ? { ...card, ...patch } : card)),
    );
  }

  function addCard() {
    const base =
      form.mode === "flashcard"
        ? {
            front: "새 질문",
            back: "새 답변",
          }
        : form.mode === "translation"
          ? {
              front: "한국어 cue",
              back: "New English sentence.",
            }
          : {
              clozeText: "새 빈칸 문장 ____",
              answer: "정답",
              answers: ["정답"],
              hint: "",
            };

    setEditableCards((cards) => [
      ...cards,
      {
        id: crypto.randomUUID(),
        type: form.mode,
        activityType: "flashcard",
        tags: [],
        status: "new",
        basis: "",
        ...base,
      },
    ]);
  }

  function removeCard(id: string) {
    setEditableCards((cards) => cards.filter((card) => card.id !== id));
  }

  async function handleSaveDeck() {
    if (!pipelineResult || editableCards.length === 0) {
      setError("저장할 카드가 없습니다.");
      return;
    }

    const validation = validateLearningActivities(
      editableCards.map((card) =>
        card.type === "cloze"
          ? {
              ...card,
              front: renderClozeText(card.clozeText ?? ""),
              back: card.answer ?? "",
            }
          : card,
      ),
    );
    if (!validation.isValid && validation.firstInvalid) {
      const { index, cardId, issues } = validation.firstInvalid;
      setError(
        `카드 ${index + 1}을 먼저 수정하세요. ${issues.join(" ")} ` +
          `(확인이 필요한 카드 ${validation.invalidCount}개)`,
      );
      window.requestAnimationFrame(() => {
        document
          .getElementById(`review-card-${cardId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }

    const now = new Date().toISOString();
    const deckTitle =
      form.title.trim() ||
      wholeDocumentCorePlan?.learningOutline?.title.trim() ||
      pipelineResult.organizedMaterial.title ||
      pipelineResult.analysis.keyTopics[0] ||
      "새 학습 덱";
    const deck: Deck = {
      id: crypto.randomUUID(),
      projectId: sourceProjectId ?? undefined,
      title: deckTitle,
      boardColumn: "new",
      subject: form.subject.trim(),
      tags: parseTags(tagInput),
      mode: form.mode,
      sourceText: form.sourceText || pipelineResult.analysis.extractedMaterial || "",
      sourceFileName: pdfFiles.map((file) => file.name).join(", ") || undefined,
      instruction: buildProblemDesignInstruction(
        form.instruction,
        problemDesignAdvice,
      ),
      studyGuideline: confirmedStudyGuideline ?? undefined,
      activityDesign: activityDesign ?? undefined,
      learningDesign: pipelineResult.learningDesign,
      codexThreadId: pipelineResult.codexThreadId,
      activitySelectionMode,
      sourceExpressionMode: form.sourceExpressionMode ?? "adapt",
      outlineSelection: wholeDocumentCorePlan?.learningOutline
        ? {
            outline: wholeDocumentCorePlan.learningOutline,
            selectedLeafIds: selectedOutlineLeafIds,
          }
        : undefined,
      analysis: pipelineResult.analysis,
      organizedMaterial: pipelineResult.organizedMaterial,
      cards: normalizeCards(editableCards),
      createdAt: now,
      updatedAt: now,
    };

    const savedDeck = pdfFiles.length > 0
      ? await saveDeckWithPdfSources(deck, pdfFiles)
      : (await saveDeck(deck), deck);
    await refreshDecks();
    setNotice("덱을 저장했습니다.");
    if (isProjectGenerationOpen) {
      setIsProjectGenerationOpen(false);
      setSourceProjectId(null);
      setProjectCachedAnalysis(null);
      setView("decks");
      return;
    }
    void startStudy(savedDeck, "all", undefined, undefined, "decks");
  }

  async function handleAnalyzePdfs() {
    setError("");
    setNotice("");

    if (pdfFiles.length === 0) {
      setError("분석할 PDF 파일을 한 개 이상 선택하세요.");
      return;
    }

    setIsAnalyzingPdfs(true);
    setPdfAnalysis(null);
    setStudyGuideline(null);
    setSelectedFocusGroupId(null);
    resetPreparedFlow();
    setAnalysisPhaseIndex(1);

    try {
      const formData = new FormData();
      pdfFiles.forEach((file) => formData.append("pdfs", file));
      formData.append("learningGoal", learningGoalInput.trim());
      formData.append("instruction", form.instruction);
      if (sourceProjectId) formData.append("projectId", sourceProjectId);
      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "PDF 분석에 실패했습니다.");
      }

      setAnalysisPhaseIndex(2);
      const analysis = data as PdfAnalysisResponse;
      setPdfAnalysis(analysis);
      setSelectedSourceOutlineLeafIds(
        getDefaultNodeSelection(analysis.sourceOutline?.nodes ?? []),
      );
      setShowSourceOutlineSelectionError(false);
      setRunMode("whole_document_core_soft_budget");
      setNotice("PDF의 원문 구조를 정리했습니다. 학습에 사용할 범위를 선택하세요.");
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "PDF 분석에 실패했습니다.",
      );
    } finally {
      setIsAnalyzingPdfs(false);
    }
  }

  function resetPreparedFlow() {
    setPreparedResult(null);
    setEditableMaterial(null);
    setExcludedLearningUnitIds([]);
    setActiveLearningUnitId(null);
    setIsLearningUnitSelectionConfirmed(false);
    setActivityDesign(null);
    setSelectedActivityTypes({});
    setSelectedActivityIncludes({});
  }

  function toggleLearningUnit(id: string) {
    if (!preparedResult) return;

    setExcludedLearningUnitIds((current) => {
      const next = current.includes(id)
        ? current.filter((unitId) => unitId !== id)
        : [...current, id];
      setEditableMaterial(
        filterOrganizedMaterial(preparedResult.organizedMaterial, next),
      );
      return next;
    });
    setIsLearningUnitSelectionConfirmed(false);
    setActivityDesign(null);
    setSelectedActivityTypes({});
    setSelectedActivityIncludes({});
    setNotice("");
  }

  async function confirmLearningUnits() {
    const learningUnits = preparedResult?.analysis.learningUnits ?? [];
    const includedCount = learningUnits.length - excludedLearningUnitIds.length;
    if (includedCount <= 0) {
      setError("최소 한 개의 학습 내용을 포함해야 합니다.");
      return;
    }
    const invalidCardCount = editableCards.filter(
      (card) => validateLearningActivity(card).length > 0,
    ).length;
    if (invalidCardCount > 0) {
      setError(`정답 정보가 불완전한 문제가 ${invalidCardCount}개 있습니다.`);
      return;
    }

    setError("");
    setIsLearningUnitSelectionConfirmed(true);
    setNotice(`${includedCount}개의 학습 내용을 확정했습니다.`);
    if (preparedResult?.learningDesign && preparedResult.codexThreadId) {
      await generateLearningActivities(null);
      return;
    }
    await requestActivityDesign();
  }

  async function requestActivityDesign() {
    if (!preparedResult || !editableMaterial || !confirmedStudyGuideline) return;
    setError("");
    setIsDesigningActivities(true);
    setActivityDesign(null);
    setSelectedActivityTypes({});
    setSelectedActivityIncludes({});
    try {
      const response = await fetch(
        "/api/generate",
        buildActivityDesignRequest(
          form,
          tagInput,
          preparedResult.analysis,
          editableMaterial,
          confirmedStudyGuideline,
          problemDesignAdvice,
          sourceProjectId,
        ),
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message ?? "문제 방식을 추천하지 못했습니다.");
      }
      const design = data.activityDesign as ActivityDesign;
      setActivityDesign(design);
      setSelectedActivityTypes(
        Object.fromEntries(
          design.recommendations
            .flatMap((item) =>
              item.recommendedType
                ? [[activityRecommendationKey(item), item.recommendedType] as const]
                : [],
            ),
        ),
      );
      setSelectedActivityIncludes(
        Object.fromEntries(
          design.recommendations.map((item) => [
            activityRecommendationKey(item),
            item.includeInGeneration,
          ]),
        ),
      );
      if (activitySelectionMode === "automatic") {
        const supportedCount = design.recommendations.filter(
          (item) => item.includeInGeneration,
        ).length;
        if (supportedCount === 0) {
          setActivitySelectionMode("manual");
          setNotice(
            "현재 문제 형식으로 직접 또는 보조 훈련할 수 있는 설계가 없어 자동 생성을 멈췄습니다. 대체 연습을 사용할지 직접 확인해 주세요.",
          );
          return;
        }
        setNotice("AI가 정한 문제 구성을 확인하고 문제 만들기를 시작하세요.");
      } else {
        setNotice("AI 추천을 확인하고 필요한 문제 방식만 바꾼 뒤 생성하세요.");
      }
    } catch (designError) {
      setIsLearningUnitSelectionConfirmed(false);
      setError(
        designError instanceof Error
          ? designError.message
          : "문제 방식을 추천하지 못했습니다.",
      );
    } finally {
      setIsDesigningActivities(false);
    }
  }

  async function generateLearningActivities(design: ActivityDesign | null = activityDesign) {
    const usesLearningPlan = Boolean(
      preparedResult?.learningDesign && preparedResult.codexThreadId,
    );
    if (
      (!design && !usesLearningPlan) ||
      !preparedResult ||
      !editableMaterial ||
      !confirmedStudyGuideline
    ) {
      setError("확정된 문제 방식이 필요합니다.");
      return;
    }
    const effectiveDesign = design
      ? applyActivityDesignSelections({
          design,
          selectedTypes: selectedActivityTypes,
          selectedIncludes: selectedActivityIncludes,
          mode: activitySelectionMode,
        })
      : null;
    setError("");
    setNotice("");
    setIsGenerating(true);
    setLoadingPhaseIndex(1);
    setPipelineResult(null);
    setEditableCards([]);
    try {
      const response = await fetch(
        "/api/generate",
        usesLearningPlan
          ? buildLearningPlanGenerationRequest(
              form,
              tagInput,
              preparedResult,
              editableMaterial,
              confirmedStudyGuideline,
              problemDesignAdvice,
              sourceProjectId,
            )
          : buildLearningActivityRequest(
              form,
              tagInput,
              preparedResult.analysis,
              editableMaterial,
              confirmedStudyGuideline,
              effectiveDesign!,
              activitySelectionMode,
              problemDesignAdvice,
              sourceProjectId,
            ),
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message ?? "문제를 생성하지 못했습니다.");
      }
      const result = data as GeneratePipelineResult;
      setActivityDesign(result.activityDesign ?? effectiveDesign);
      setPipelineResult(result);
      setEditableCards(normalizeCards(result.cards));
      setNotice("문제 생성이 완료되었습니다. 저장 전에 확인하세요.");
      if (!isProjectGenerationOpen) setView("review");
    } catch (generationError) {
      setIsLearningUnitSelectionConfirmed(false);
      setError(
        generationError instanceof Error
          ? generationError.message
          : "문제를 생성하지 못했습니다.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  function selectRecommendedActivityType(
    recommendationKey: string,
    activityType: LearningActivityType,
  ) {
    const nextTypes = {
      ...selectedActivityTypes,
      [recommendationKey]: activityType,
    };
    setSelectedActivityTypes(nextTypes);
    setActivityDesign((current) =>
      current
        ? applyActivityDesignSelections({
            design: current,
            selectedTypes: nextTypes,
            selectedIncludes: selectedActivityIncludes,
            mode: activitySelectionMode,
          })
        : current,
    );
  }

  async function requestStudyGuideline(
    analysis: PdfAnalysisResponse | null = pdfAnalysis,
  ): Promise<boolean> {
    if (!analysis) {
      return false;
    }

    setError("");
    setIsPlanningGuideline(true);
    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis,
          instruction: form.instruction,
          learningGoal: learningGoalInput.trim(),
          projectId: sourceProjectId ?? undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message ?? "학습 방향을 만드는 데 실패했습니다.");
      }

      const draft = data as StudyGuidelineDraft;
      setStudyGuideline(draft);
      setSelectedFocusGroupId(draft.recommendedGroupId);
    setRunMode("focused_area");
    setWholeDocumentCorePlan(null);
    setSelectedSourceOutlineLeafIds([]);
    setShowSourceOutlineSelectionError(false);
    setSelectedOutlineLeafIds([]);
      return true;
    } catch (guidelineError) {
      setError(
        guidelineError instanceof Error
          ? guidelineError.message
          : "학습 방향을 만드는 데 실패했습니다.",
      );
      return false;
    } finally {
      setIsPlanningGuideline(false);
    }
  }

  async function requestWholeDocumentCorePlan(
    experimentRunMode:
      | "whole_document_core"
      | "whole_document_core_soft_budget",
    analysis: PdfAnalysisResponse | null = pdfAnalysis,
    learningGoal: string = learningGoalInput,
    sourceLeafIds: string[] = selectedSourceOutlineLeafIds,
  ): Promise<boolean> {
    if (!analysis?.sourceOutline) {
      setError("원문 목차 근거가 포함된 PDF 분석 결과가 필요합니다.");
      return false;
    }

    setError("");
    setNotice("");
    if (analysis.sourceOutline) {
      const selectionErrors = validateOutlineSelection(
        analysis.sourceOutline.nodes,
        sourceLeafIds,
      );
      if (selectionErrors.length > 0) {
        setShowSourceOutlineSelectionError(true);
        setError(selectionErrors[0]);
        return false;
      }
    }
    setIsPlanningWholeDocument(true);
    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis,
          instruction: form.instruction,
          learningGoal: learningGoal.trim(),
          runMode: "whole_document_core",
          projectId: sourceProjectId ?? undefined,
          selectedSourceOutline: filterOutlineToSelection(
            analysis.sourceOutline,
            sourceLeafIds,
          ),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message ?? "전체 핵심 학습 범위를 결정하지 못했습니다.");
      }

      const plan = data as WholeDocumentCorePlan;
      setWholeDocumentCorePlan(plan);
      setShowSourceOutlineSelectionError(false);
      setSelectedOutlineLeafIds(getDefaultOutlineSelection(plan));
      setPlanLearningGoal(plan.learningGoal);
      setRunMode(experimentRunMode);
      setSelectedFocusGroupId(null);
      resetPreparedFlow();
      setNotice("전체 PDF에서 핵심 학습 범위를 결정했습니다.");
      return true;
    } catch (planningError) {
      setError(
        planningError instanceof Error
          ? planningError.message
          : "전체 핵심 학습 범위를 결정하지 못했습니다.",
      );
      return false;
    } finally {
      setIsPlanningWholeDocument(false);
    }
  }

  async function handleDeleteDeck(id: string) {
    if (await library.removeDeck(id)) {
      if (selectedDeck?.id === id) setSelectedDeck(null);
    }
  }

  async function saveDeckTitle(deck: Deck) {
    const updatedDeck = await library.saveDeckTitle(deck);
    if (updatedDeck && selectedDeck?.id === updatedDeck.id) {
      setSelectedDeck(updatedDeck);
    }
  }

  async function moveDeckToColumn(id: string, boardColumn: DeckBoardColumn) {
    const updatedDeck = await library.moveDeckToColumn(id, boardColumn);
    if (updatedDeck && selectedDeck?.id === updatedDeck.id) {
      setSelectedDeck(updatedDeck);
    }
  }

  function navigateToView(nextView: View) {
    if (nextView !== "decks" && isProjectGenerationOpen) {
      setIsProjectGenerationOpen(false);
      setSourceProjectId(null);
      setProjectCachedAnalysis(null);
      setPdfFiles([]);
      setPipelineResult(null);
      setEditableCards([]);
      resetAnalysisFlow();
    }
    if (nextView === "create") {
      setSourceProjectId(null);
    }
    setView(nextView);
  }

  const createWorkspaceProps: Parameters<typeof CreateView>[0] = {
    form,
    error,
    notice,
    isPreparingMaterial,
    isAnalyzingPdfs,
    analysisPhase: pdfAnalysisPhases[analysisPhaseIndex],
    pdfFiles,
    pdfAnalysis,
    studyGuideline,
    selectedFocusGroupId,
    runMode,
    wholeDocumentCorePlan,
    selectedSourceOutlineLeafIds,
    showSourceOutlineSelectionError,
    learningGoalInput,
    planLearningGoal,
    isPlanLearningGoalDirty,
    hasConfirmedStudyGuideline: Boolean(confirmedStudyGuideline),
    isPlanningGuideline,
    isPlanningWholeDocument,
    preparedResult,
    editableMaterial,
    excludedLearningUnitIds,
    activeLearningUnitId,
    isLearningUnitSelectionConfirmed,
    activitySelectionMode,
    problemDesignAdvice,
    activityDesign,
    selectedActivityTypes,
    selectedActivityIncludes,
    isDesigningActivities,
    isGenerating,
    setForm,
    setLearningGoalInput,
    setPlanLearningGoal,
    setSelectedSourceOutlineLeafIds: (next) => {
      setSelectedSourceOutlineLeafIds(next);
      setShowSourceOutlineSelectionError(false);
      setWholeDocumentCorePlan(null);
      setSelectedOutlineLeafIds([]);
      resetPreparedFlow();
    },
    selectFocusGroup: (id) => {
      setRunMode("focused_area");
      setWholeDocumentCorePlan(null);
      setSelectedOutlineLeafIds([]);
      setSelectedFocusGroupId(id);
      resetPreparedFlow();
    },
    setActiveLearningUnitId,
    toggleLearningUnit,
    confirmLearningUnits: () => void confirmLearningUnits(),
    setActivitySelectionMode,
    setProblemDesignAdvice: (value) => {
      setProblemDesignAdvice(value);
      setIsLearningUnitSelectionConfirmed(false);
      setActivityDesign(null);
      setSelectedActivityTypes({});
      setSelectedActivityIncludes({});
      setPipelineResult(null);
      setEditableCards([]);
      setNotice("");
    },
    selectActivityType: selectRecommendedActivityType,
    selectActivityInclude: (learningUnitId, included) =>
      setSelectedActivityIncludes((current) => ({
        ...current,
        [learningUnitId]: included,
      })),
    generateLearningActivities: (design?: ActivityDesign | null) =>
      void generateLearningActivities(design),
    setPdfFiles,
    clearPdfAnalysis: resetAnalysisFlow,
    clearPreparedResult: () => {
      setPreparedResult(null);
      setEditableMaterial(null);
      setExcludedLearningUnitIds([]);
      setActiveLearningUnitId(null);
      setIsLearningUnitSelectionConfirmed(false);
      setActivityDesign(null);
      setSelectedActivityTypes({});
      setSelectedActivityIncludes({});
      setError("");
      setNotice("");
    },
    handlePrepareMaterial: () => void handlePrepareMaterial(),
    handleAnalyzePdfs,
    requestWholeDocumentCorePlan,
    replanWithLearningGoal: () =>
      void requestWholeDocumentCorePlan(
        "whole_document_core_soft_budget",
        pdfAnalysis,
        planLearningGoal,
      ),
    retryGuideline: () => void requestStudyGuideline(),
  };

  return (
    <main className="sf-app min-h-screen bg-[#161616] text-[#E8E8E8]">
      {isGenerating && !isProjectGenerationOpen ? (
        <LoadingOverlay message={loadingPhases[loadingPhaseIndex]} />
      ) : null}
      {isPreparingMaterial && !isProjectGenerationOpen ? (
        <LoadingOverlay message="선택 영역에서 학습 단위를 추출하고 있습니다." />
      ) : null}
      {showAiDebug && isDebugOpen && pipelineResult ? (
        <DebugModal result={pipelineResult} onClose={() => setIsDebugOpen(false)} />
      ) : null}
      {detailDeck ? (
        <DeckDetailModal deck={detailDeck} onClose={() => setDetailDeck(null)} />
      ) : null}
      {isPipelineOpen ? (
        <PipelineOperatorModal
          completedNodeIds={[
            ...(pdfFiles.length > 0 || form.sourceText.trim() ? ["input"] : []),
            ...(pdfAnalysis ? ["outline"] : []),
            ...(confirmedStudyGuideline ? ["focus"] : []),
            ...(preparedResult ? ["extract", "organize"] : []),
            ...(activityDesign ? ["activity-design"] : []),
            ...(pipelineResult && editableCards.length > 0
              ? ["cards"]
              : []),
            ...(selectedDeck ? ["save"] : []),
          ]}
          onClose={() => setIsPipelineOpen(false)}
        />
      ) : null}

      <div className="min-h-screen md:grid md:grid-cols-[208px_minmax(0,1fr)]">
        <aside className="hidden min-h-screen border-r border-[#2B2B2B] bg-[#1B1B1B] px-4 py-5 text-[#E8E8E8] md:flex md:flex-col">
            <button
              type="button"
              onClick={() => navigateToView("manager")}
              className="flex shrink-0 items-center gap-3 rounded-[10px] text-left"
            >
              <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-[#E7E7E7] text-[11px] font-medium text-[#181818]">
                SF
              </span>
              <span>
                <span className="block text-[13px] font-medium tracking-tight">Study Forge</span>
                <span className="mt-0.5 block text-[9px] uppercase tracking-[0.12em] text-[#777777]">Personal studio</span>
              </span>
            </button>

            <nav className="mt-10 flex flex-col gap-1">
              <NavButton active={view === "manager"} neutral={view === "manager"} onClick={() => navigateToView("manager")}>
                <CalendarDays size={16} />
                오늘
              </NavButton>
              <NavButton active={view === "decks"} neutral={view === "manager"} onClick={() => navigateToView("decks")}>
                <Columns3 size={16} />
                프로젝트
              </NavButton>
              <NavButton active={view === "records"} neutral={view === "manager"} onClick={() => navigateToView("records")}>
                <GraduationCap size={17} />
                기록
              </NavButton>
            </nav>

            <div className="mt-auto border-t border-[#2B2B2B] pt-4">
              <a
                href="/codex"
                className="mb-4 flex items-center gap-2 rounded-[9px] border border-[#393939] bg-[#202020] px-3 py-2.5 text-[11px] text-[#B5B5B5] hover:bg-[#292929]"
              >
                <span className="h-2 w-2 rounded-full bg-[#AEB4AF]" />
                Codex 연결
              </a>
              <span className="flex items-start gap-2 text-[10px] leading-5 text-[#777777]">
                <Cloud size={14} className="mt-0.5 shrink-0" />
                덱과 기록은 이 브라우저에,<br />프로젝트 PDF는 이 PC에 보관됩니다.
              </span>
              {showAiDebug ? (
                <button
                  type="button"
                  onClick={() => setIsPipelineOpen(true)}
                  className="mt-4 inline-flex items-center gap-2 border border-[#4B514D] px-3 py-2 text-xs font-bold text-[#D8DAD6] hover:bg-white/5"
                  title="자료 정제 파이프라인 보기"
                >
                  <Workflow size={16} />
                  <span className="hidden sm:inline">운영자</span>
                </button>
              ) : null}
              {showAiDebug && pipelineResult ? (
                <button
                  type="button"
                  onClick={() => setIsDebugOpen(true)}
                  className="mt-2 border border-[#4B514D] px-3 py-2 text-xs font-bold text-[#D8DAD6] hover:bg-white/5"
                >
                  AI 디버그
                </button>
              ) : null}
            </div>
        </aside>

        <div className="flex min-h-screen min-w-0 flex-col">
          <header className="border-b border-[#2B2B2B] bg-[#1B1B1B] px-5 py-4 md:px-7">
            <div className="mx-auto flex w-full max-w-[1500px] items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.1em] text-[#777777]">
                  {getViewEyebrow(view)}
                </p>
                <h2 className="mt-1 text-xl font-medium tracking-[-0.025em] text-[#E8E8E8] md:text-2xl">
                  {getViewTitle(
                    view,
                    Boolean(pdfAnalysis),
                    Boolean(preparedResult),
                  )}
                </h2>
              </div>
            </div>
          </header>

          <section className="flex-1 px-4 py-5 pb-24 sm:px-5 md:px-7 md:py-6 md:pb-9">
            <div
              className={`mx-auto ${
                view === "create" && pdfFiles.length > 0 && (!pdfAnalysis || preparedResult)
                  ? "max-w-[1800px]"
                  : view === "decks"
                    ? "max-w-[1500px]"
                    : view === "manager" || view === "records"
                      ? "max-w-[1320px]"
                    : "max-w-5xl"
              }`}
            >
              {view === "create" ? <CreateView {...createWorkspaceProps} /> : null}
              {view === "review" ? (
                <ReviewView
                  pipelineResult={pipelineResult}
                  editableCards={editableCards}
                  formMode={form.mode}
                  addCard={addCard}
                  removeCard={removeCard}
                  updateCard={updateCard}
                  handleSaveDeck={handleSaveDeck}
                  goCreate={() => setView("create")}
                  notice={notice}
                  error={error}
                />
              ) : null}
              {view === "decks" ? (
                <DecksView
                  projectsOnly
                  decks={decks}
                  sessions={studySessions}
                  attempts={studyAttempts}
                  isProjectCreationOpen={isProjectGenerationOpen}
                  projectCreationPanel={
                    pipelineResult && editableCards.length > 0 ? (
                      <ReviewView
                        pipelineResult={pipelineResult}
                        editableCards={editableCards}
                        formMode={form.mode}
                        addCard={addCard}
                        removeCard={removeCard}
                        updateCard={updateCard}
                        handleSaveDeck={handleSaveDeck}
                        goCreate={() => {
                          setPipelineResult(null);
                          setEditableCards([]);
                        }}
                        notice={notice}
                        error={error}
                      />
                    ) : (
                      <ProjectLearningCreateView
                        {...createWorkspaceProps}
                        pipelineResult={pipelineResult}
                        cachedAnalysis={projectCachedAnalysis}
                        onUseCachedAnalysis={(analysis) => {
                          setPdfAnalysis(analysis);
                          setSelectedSourceOutlineLeafIds(
                            getDefaultNodeSelection(analysis.sourceOutline?.nodes ?? []),
                          );
                          setShowSourceOutlineSelectionError(false);
                          setRunMode("whole_document_core_soft_budget");
                          setNotice("저장된 PDF 분석에서 목차를 불러왔습니다.");
                          setError("");
                        }}
                      />
                    )
                  }
                  cancelProjectCreation={() => {
                    setIsProjectGenerationOpen(false);
                    setSourceProjectId(null);
                    setProjectCachedAnalysis(null);
                    setPdfFiles([]);
                    setPipelineResult(null);
                    setEditableCards([]);
                    resetAnalysisFlow();
                  }}
                  createFromProjectSources={(files, project, cachedAnalysis) => {
                    resetAnalysisFlow();
                    setPipelineResult(null);
                    setEditableCards([]);
                    setSourceProjectId(project.id);
                    setProjectCachedAnalysis(cachedAnalysis);
                    setPdfFiles(files);
                    setForm({ ...emptyForm, subject: project.name });
                    setLearningGoalInput("");
                    setIsProjectGenerationOpen(true);
                  }}
                  renamingDeckId={renamingDeckId}
                  renameValue={renameValue}
                  setRenameValue={setRenameValue}
                  startRename={startRename}
                  cancelRename={cancelRename}
                  saveRename={saveDeckTitle}
                  startStudy={openStudy}
                  moveDeck={(id, column) => void moveDeckToColumn(id, column)}
                  deleteDeck={handleDeleteDeck}
                  openDetail={setDetailDeck}
                  goCreate={() => setView("create")}
                />
              ) : null}
              {view === "manager" ? (
                <TodayHome
                  decks={decks}
                  sessions={studySessions}
                  attempts={studyAttempts}
                  activeSession={activeStudySession}
                  loading={isLoadingManager}
                  onResume={() => {
                    setNotice("");
                    resumeSession("manager");
                  }}
                  onStartStudy={(deck) =>
                    openStudyWithMode(
                      deck,
                      countDueReviews(deck.cards) > 0 ? "due" : "all",
                    )
                  }
                  onCreate={() => navigateToView("create")}
                />
              ) : null}
              {view === "records" ? (
                <LearningManagerView
                  mode="records"
                  decks={decks}
                  sessions={studySessions}
                  attempts={studyAttempts}
                  loading={isLoadingManager}
                  startStudy={openStudy}
                  goCreate={() => navigateToView("create")}
                />
              ) : null}
              {view === "study" ? (
                <StudyView
                  selectedDeck={selectedDeck}
                  error={error}
                  currentStudyCard={currentStudyCard}
                  studyIndex={studyIndex}
                  plannedItemCount={activeStudySession?.plannedItemCount ?? 0}
                  sessionId={activeStudySession?.id ?? "preview"}
                  sessionCounts={studySessionCounts}
                  completion={studyCompletion}
                  isAnswerVisible={isAnswerVisible}
                  gradedUserAnswer={gradedUserAnswer}
                  gradedResult={gradedResult}
                  isSaving={isSavingStudyProgress}
                  setGradedUserAnswer={setGradedUserAnswer}
                  submitGradedAnswer={() => void submitGradedAnswer()}
                  advanceAfterGradedAnswer={advanceAfterGradedAnswer}
                  toggleAnswer={toggleStudyAnswer}
                  markCard={markCard}
                  closeStudy={closeStudy}
                  startNewSession={(mode, randomCount) => {
                    if (selectedDeck) void startStudy(selectedDeck, mode, randomCount);
                  }}
                  retryReviewed={() => {
                    if (selectedDeck && studyCompletion?.reviewActivityIds.length) {
                      void startStudy(
                        selectedDeck,
                        "review_only",
                        undefined,
                        studyCompletion.reviewActivityIds,
                      );
                    }
                  }}
                />
              ) : null}
            </div>
          </section>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-[#393D3A] bg-[#222523] p-2 md:hidden">
        <MobileNavButton active={view === "manager"} neutral={view === "manager"} onClick={() => navigateToView("manager")}>
          <CalendarDays size={17} /> 오늘
        </MobileNavButton>
        <MobileNavButton active={view === "decks"} neutral={view === "manager"} onClick={() => navigateToView("decks")}>
          <Columns3 size={17} /> 프로젝트
        </MobileNavButton>
        <MobileNavButton active={view === "records"} neutral={view === "manager"} onClick={() => navigateToView("records")}>
          <GraduationCap size={18} /> 기록
        </MobileNavButton>
      </nav>
    </main>
  );
}
