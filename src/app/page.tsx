"use client";

import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  BookOpen,
  CalendarDays,
  Cloud,
  Columns3,
  GraduationCap,
  GripVertical,
  Info,
  Sparkles,
  Pencil,
  Plus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Settings2,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteDeck,
  listDecks,
  listStudyAttempts,
  listStudySessions,
  saveDeck,
  saveDeckWithPdfSources,
  saveStudyProgress,
  saveStudySession,
  startStudySession,
} from "@/lib/storage";
import {
  abandonStudySession,
  advanceStudySession,
  createStudyAttempt,
  createStudySession,
  findLatestActiveStudySession,
  restoreStudySessionState,
} from "@/lib/study-session";
import { selectStudyActivityIds } from "@/lib/study-selection";
import {
  countDueReviews,
  scheduleNextReview,
} from "@/lib/spaced-repetition";
import {
  buildLearningCalendar,
  buildLearningHistory,
  buildLearningManagerSnapshot,
} from "@/lib/learning-manager";
import { recordAutomaticallyGradedResult } from "@/lib/graded-study";
import { selectNewPublishedMcpDecks } from "@/lib/mcp-deck-import";
import {
  getCorrectStudyAnswer,
  getLearningActivityType,
  getStructureRecallKind,
  getStructureRecallMode,
  getStructureRecallChoices,
  getStudyStructureRecallMode,
  getSupportedStructureRecallModes,
  gradeStudyAnswer,
  isAutomaticallyGradedActivity,
  validateLearningActivities,
  validateLearningActivity,
} from "@/lib/learning-activity";
import PdfReviewViewer from "./PdfReviewViewer";
import {
  CompactChoiceRows,
  CompactLearningOutlineSelector,
  GenerationProgressFocus,
} from "./GenerationFocusUI";
import { validateOutlineSelection } from "@/lib/outline-selection";
import {
  activityRecommendationKey,
  applyActivityDesignSelections,
} from "@/lib/practice-blueprint";
import {
  buildSelectedOutlineSourceText,
  filterOutlineToSelection,
  filterPlanToOutlineSelection,
  getDefaultNodeSelection,
  getDefaultOutlineSelection,
} from "@/lib/learning-outline";
import PipelineOperatorModal from "./PipelineOperatorModal";
import LearningPlanner from "./LearningPlanner";
import {
  CollapsibleSessionLog,
  CompactDeckList,
} from "./CompactLearningLists";
import StudyProjectLibrary from "./StudyProjectLibrary";
import TodayHome from "./TodayHome";
import type { StudyProject } from "@/lib/study-project-types";
import type {
  ActivityDesign,
  ActivitySelectionMode,
  BaselineRunMode,
  Card,
  ConfirmedStudyGuideline,
  Deck,
  DeckBoardColumn,
  PdfAnalysisResponse,
  GeneratePipelineResult,
  GenerateRequest,
  LearningActivityType,
  OrganizedMaterial,
  StudyGuidelineDraft,
  StudyAnswer,
  StudyAttempt,
  StudySession,
  StudySelectionMode,
  StudyMode,
  SourceExpressionMode,
  WholeDocumentCorePlan,
} from "@/lib/types";

const showAiDebug = process.env.NEXT_PUBLIC_SHOW_AI_DEBUG === "true";
type View =
  | "create"
  | "review"
  | "manager"
  | "records"
  | "decks"
  | "study";

type StudyCompletionSummary = {
  completedItemCount: number;
  knownCount: number;
  reviewCount: number;
  reviewActivityIds: string[];
};

const emptyForm: GenerateRequest = {
  title: "",
  subject: "",
  tags: [],
  sourceText: "",
  instruction: "",
  mode: "flashcard",
  sourceExpressionMode: "adapt",
};

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
  const [sourceProjectId, setSourceProjectId] = useState<string | null>(null);
  const [isProjectGenerationOpen, setIsProjectGenerationOpen] = useState(false);
  const [projectCachedAnalysis, setProjectCachedAnalysis] =
    useState<PdfAnalysisResponse | null>(null);
  const [form, setForm] = useState<GenerateRequest>(emptyForm);
  const tagInput = "";
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [pdfAnalysis, setPdfAnalysis] = useState<PdfAnalysisResponse | null>(null);
  const [studyGuideline, setStudyGuideline] =
    useState<StudyGuidelineDraft | null>(null);
  const [selectedFocusGroupId, setSelectedFocusGroupId] = useState<string | null>(
    null,
  );
  const [runMode, setRunMode] =
    useState<BaselineRunMode>("focused_area");
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
  const [decks, setDecks] = useState<Deck[]>([]);
  const [studySessions, setStudySessions] = useState<StudySession[]>([]);
  const [studyAttempts, setStudyAttempts] = useState<StudyAttempt[]>([]);
  const [isLoadingManager, setIsLoadingManager] = useState(false);
  const [selectedDeck, setSelectedDeck] = useState<Deck | null>(null);
  const [detailDeck, setDetailDeck] = useState<Deck | null>(null);
  const [renamingDeckId, setRenamingDeckId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [studyIndex, setStudyIndex] = useState(0);
  const [isAnswerVisible, setIsAnswerVisible] = useState(false);
  const [activeStudySession, setActiveStudySession] =
    useState<StudySession | null>(null);
  const [currentAttemptStartedAt, setCurrentAttemptStartedAt] = useState<
    string | null
  >(null);
  const [answerRevealedAt, setAnswerRevealedAt] = useState<string | null>(null);
  const [gradedUserAnswer, setGradedUserAnswer] = useState<StudyAnswer>(null);
  const [gradedResult, setGradedResult] = useState<boolean | null>(null);
  const [studySessionCounts, setStudySessionCounts] = useState({
    known: 0,
    review: 0,
  });
  const [studySessionReviewIds, setStudySessionReviewIds] = useState<string[]>(
    [],
  );
  const [studyCompletion, setStudyCompletion] =
    useState<StudyCompletionSummary | null>(null);
  const [isSavingStudyProgress, setIsSavingStudyProgress] = useState(false);
  const studyReturnViewRef = useRef<View>("decks");
  const isRecordingStudyAttempt = useRef(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingPhaseIndex, setLoadingPhaseIndex] = useState(0);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [isPipelineOpen, setIsPipelineOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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

        const restored = restoreStudySessionState(
          session,
          attempts.filter((attempt) => attempt.sessionId === session.id),
        );
        setSelectedDeck(deck);
        setActiveStudySession(session);
        setStudyIndex(restored.studyIndex);
        setStudySessionCounts({
          known: restored.knownCount,
          review: restored.reviewCount,
        });
        setStudySessionReviewIds(restored.reviewActivityIds);
        setCurrentAttemptStartedAt(new Date().toISOString());
        setIsAnswerVisible(false);
        setGradedUserAnswer(null);
        setGradedResult(null);
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
  }, []);

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
  }, [view]);

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

  const studySessionCards = useMemo(() => {
    if (!selectedDeck || !activeStudySession) return [];
    const cardsById = new Map(selectedDeck.cards.map((card) => [card.id, card]));
    return activeStudySession.plannedActivityIds
      .map((id) => cardsById.get(id))
      .filter((card): card is Card => Boolean(card));
  }, [activeStudySession, selectedDeck]);

  const currentStudyCard = studySessionCards[studyIndex];

  async function refreshDecks() {
    setDecks(await listDecks());
  }

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
    studyReturnViewRef.current = "decks";
    void startStudy(savedDeck, "all");
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
    const deck = decks.find((item) => item.id === id);
    const confirmed = window.confirm(
      `"${deck?.title ?? "이 덱"}"을 정말 삭제하시겠습니까?`,
    );

    if (!confirmed) {
      return;
    }

    await deleteDeck(id);
    if (selectedDeck?.id === id) {
      setSelectedDeck(null);
    }
    if (detailDeck?.id === id) {
      setDetailDeck(null);
    }
    await refreshDecks();
  }

  async function saveDeckTitle(deck: Deck) {
    const title = renameValue.trim();
    if (!title) {
      setError("덱 이름은 비워둘 수 없습니다.");
      return;
    }

    const updatedDeck: Deck = {
      ...deck,
      title,
      updatedAt: new Date().toISOString(),
    };

    await saveDeck(updatedDeck);
    setDecks((items) =>
      items.map((item) => (item.id === updatedDeck.id ? updatedDeck : item)),
    );
    if (selectedDeck?.id === updatedDeck.id) {
      setSelectedDeck(updatedDeck);
    }
    if (detailDeck?.id === updatedDeck.id) {
      setDetailDeck(updatedDeck);
    }
    setRenamingDeckId(null);
    setRenameValue("");
    setNotice("덱 이름을 수정했습니다.");
  }

  function openStudyWithMode(deck: Deck, mode: StudySelectionMode) {
    studyReturnViewRef.current =
      view === "manager" || view === "records" || view === "decks"
        ? view
        : "decks";
    void startStudy(deck, mode);
  }

  function openStudy(deck: Deck) {
    openStudyWithMode(deck, "all");
  }

  async function startStudy(
    deck: Deck,
    selectionMode: StudySelectionMode,
    randomCount?: number,
    fixedActivityIds?: string[],
  ) {
    const plannedActivityIds = fixedActivityIds
      ? [...fixedActivityIds]
      : selectStudyActivityIds(deck.cards, selectionMode, randomCount);
    if (plannedActivityIds.length === 0) {
      setError("학습할 카드가 없습니다.");
      return;
    }

    setIsSavingStudyProgress(true);
    try {
      if (activeStudySession?.status === "active") {
        await saveStudySession(
          abandonStudySession(activeStudySession, new Date().toISOString()),
        );
      }

    const startedAt = new Date().toISOString();
    const session = createStudySession(
      deck.id,
      selectionMode,
      plannedActivityIds,
      startedAt,
      crypto.randomUUID(),
    );
    const studyDeck =
      deck.boardColumn === "new"
        ? {
            ...deck,
            boardColumn: "learning" as const,
            updatedAt: new Date().toISOString(),
          }
        : deck;

    await startStudySession(studyDeck, session);
    setStudySessions((items) => [
      ...items.filter((item) => item.id !== session.id),
      session,
    ]);
    setDecks((items) =>
      items.map((item) => (item.id === studyDeck.id ? studyDeck : item)),
    );
    setSelectedDeck(studyDeck);
    setActiveStudySession(session);
    setStudyIndex(0);
    setIsAnswerVisible(false);
    setCurrentAttemptStartedAt(startedAt);
    setAnswerRevealedAt(null);
    setGradedUserAnswer(null);
    setGradedResult(null);
    setStudySessionCounts({ known: 0, review: 0 });
    setStudySessionReviewIds([]);
    setStudyCompletion(null);
    setError("");
      setView("study");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? `학습을 시작하지 못했습니다: ${saveError.message}`
          : "학습을 시작하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setIsSavingStudyProgress(false);
    }
  }

  function closeStudy() {
    setIsAnswerVisible(false);
    setAnswerRevealedAt(null);
    setGradedUserAnswer(null);
    setGradedResult(null);
    setView(studyReturnViewRef.current);
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

  function toggleStudyAnswer() {
    setIsAnswerVisible((visible) => {
      if (!visible && !answerRevealedAt) {
        setAnswerRevealedAt(new Date().toISOString());
      }
      return !visible;
    });
  }

  async function moveDeckToColumn(id: string, boardColumn: DeckBoardColumn) {
    const deck = decks.find((item) => item.id === id);
    if (!deck || deck.boardColumn === boardColumn) return;

    const updatedDeck: Deck = {
      ...deck,
      boardColumn,
      updatedAt: new Date().toISOString(),
    };
    await saveDeck(updatedDeck);
    setDecks((items) =>
      items.map((item) => (item.id === updatedDeck.id ? updatedDeck : item)),
    );
    if (selectedDeck?.id === updatedDeck.id) setSelectedDeck(updatedDeck);
    if (detailDeck?.id === updatedDeck.id) setDetailDeck(updatedDeck);
  }

  async function markCard(status: "known" | "review") {
    if (
      !selectedDeck ||
      !currentStudyCard ||
      !activeStudySession ||
      !currentAttemptStartedAt ||
      !answerRevealedAt ||
      isRecordingStudyAttempt.current
    ) {
      return;
    }

    isRecordingStudyAttempt.current = true;
    setIsSavingStudyProgress(true);
    setError("");
    try {
      const completedAt = new Date().toISOString();
      const attempt = createStudyAttempt({
        id: crypto.randomUUID(),
        sessionId: activeStudySession.id,
        activityId: currentStudyCard.id,
        learningUnitId: currentStudyCard.learningUnitId,
        startedAt: currentAttemptStartedAt,
        answerRevealedAt,
        completedAt,
        selfRating: status,
        wasNew: currentStudyCard.status === "new",
      });
      const updatedCards = selectedDeck.cards.map((card) =>
        card.id === currentStudyCard.id
          ? {
              ...card,
              status,
              reviewSchedule: scheduleNextReview(
                card.reviewSchedule,
                status === "known",
                new Date(completedAt),
              ),
            }
          : card,
      );
      const updatedDeck: Deck = {
        ...selectedDeck,
        boardColumn:
          updatedCards.length > 0 &&
          updatedCards.every((card) => card.status === "known")
            ? "completed"
            : "learning",
        cards: updatedCards,
        updatedAt: completedAt,
      };
      const updatedSession = advanceStudySession(
        activeStudySession,
        completedAt,
      );
      const updatedCounts = {
        known: studySessionCounts.known + (status === "known" ? 1 : 0),
        review: studySessionCounts.review + (status === "review" ? 1 : 0),
      };
      const updatedReviewIds =
        status === "review"
          ? [...studySessionReviewIds, currentStudyCard.id]
          : studySessionReviewIds;

      await saveStudyProgress({
        deck: updatedDeck,
        session: updatedSession,
        attempt,
      });
      setStudySessions((items) => [
        ...items.filter((item) => item.id !== updatedSession.id),
        updatedSession,
      ]);
      setStudyAttempts((items) => [...items, attempt]);
      setSelectedDeck(updatedDeck);
      setDecks((items) =>
        items.map((deck) => (deck.id === updatedDeck.id ? updatedDeck : deck)),
      );
      setStudySessionCounts(updatedCounts);
      setStudySessionReviewIds(updatedReviewIds);
      setIsAnswerVisible(false);
      setAnswerRevealedAt(null);
      setGradedUserAnswer(null);
      setGradedResult(null);

      if (updatedSession.status === "completed") {
        setActiveStudySession(null);
        setCurrentAttemptStartedAt(null);
        setStudyCompletion({
          completedItemCount: updatedSession.completedItemCount,
          knownCount: updatedCounts.known,
          reviewCount: updatedCounts.review,
          reviewActivityIds: updatedReviewIds,
        });
        return;
      }

      setActiveStudySession(updatedSession);
      setCurrentAttemptStartedAt(completedAt);
      setStudyIndex(updatedSession.currentIndex);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? `학습 결과를 저장하지 못했습니다: ${saveError.message}`
          : "학습 결과를 저장하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      isRecordingStudyAttempt.current = false;
      setIsSavingStudyProgress(false);
    }
  }

  async function submitGradedAnswer() {
    if (
      !selectedDeck ||
      !currentStudyCard ||
      !activeStudySession ||
      !currentAttemptStartedAt ||
      gradedResult !== null ||
      !isCompleteGradedAnswer(currentStudyCard, gradedUserAnswer) ||
      isRecordingStudyAttempt.current
    ) {
      return;
    }
    isRecordingStudyAttempt.current = true;
    setIsSavingStudyProgress(true);
    setError("");
    try {
      const completedAt = new Date().toISOString();
      const isCorrect = gradeStudyAnswer(currentStudyCard, gradedUserAnswer);
      const correctAnswer = getCorrectStudyAnswer(currentStudyCard);
      const recorded = recordAutomaticallyGradedResult(activeStudySession, {
        attemptId: crypto.randomUUID(),
        activityId: currentStudyCard.id,
        learningUnitId: currentStudyCard.learningUnitId,
        startedAt: currentAttemptStartedAt,
        completedAt,
        isCorrect,
        userAnswer: gradedUserAnswer,
        correctAnswer,
      });
      const status = isCorrect ? ("known" as const) : ("review" as const);
      const updatedCards = selectedDeck.cards.map((card) =>
        card.id === currentStudyCard.id
          ? {
              ...card,
              status,
              reviewSchedule: scheduleNextReview(
                card.reviewSchedule,
                isCorrect,
                new Date(completedAt),
              ),
            }
          : card,
      );
      const updatedDeck: Deck = {
        ...selectedDeck,
        boardColumn:
          updatedCards.length > 0 && updatedCards.every((card) => card.status === "known")
            ? "completed"
            : "learning",
        cards: updatedCards,
        updatedAt: completedAt,
      };
      const updatedCounts = {
        known: studySessionCounts.known + (isCorrect ? 1 : 0),
        review: studySessionCounts.review + (isCorrect ? 0 : 1),
      };
      const updatedReviewIds = isCorrect
        ? studySessionReviewIds
        : [...studySessionReviewIds, currentStudyCard.id];

      await saveStudyProgress({
        deck: updatedDeck,
        session: recorded.session,
        attempt: recorded.attempt,
      });
      setStudySessions((items) => [
        ...items.filter((item) => item.id !== recorded.session.id),
        recorded.session,
      ]);
      setStudyAttempts((items) => [...items, recorded.attempt]);
      setSelectedDeck(updatedDeck);
      setDecks((items) =>
        items.map((deck) => (deck.id === updatedDeck.id ? updatedDeck : deck)),
      );
      setActiveStudySession(recorded.session);
      setStudySessionCounts(updatedCounts);
      setStudySessionReviewIds(updatedReviewIds);
      setAnswerRevealedAt(completedAt);
      setIsAnswerVisible(true);
      setGradedResult(isCorrect);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? `학습 결과를 저장하지 못했습니다: ${saveError.message}`
          : "학습 결과를 저장하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      isRecordingStudyAttempt.current = false;
      setIsSavingStudyProgress(false);
    }
  }

  function advanceAfterGradedAnswer() {
    if (!activeStudySession || gradedResult === null) return;
    if (activeStudySession.status === "completed") {
      setStudyCompletion({
        completedItemCount: activeStudySession.completedItemCount,
        knownCount: studySessionCounts.known,
        reviewCount: studySessionCounts.review,
        reviewActivityIds: studySessionReviewIds,
      });
      setActiveStudySession(null);
      setCurrentAttemptStartedAt(null);
    } else {
      const startedAt = new Date().toISOString();
      setStudyIndex(activeStudySession.currentIndex);
      setCurrentAttemptStartedAt(startedAt);
    }
    setIsAnswerVisible(false);
    setAnswerRevealedAt(null);
    setGradedUserAnswer(null);
    setGradedResult(null);
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
                  startRename={(deck) => {
                    setRenamingDeckId(deck.id);
                    setRenameValue(deck.title);
                  }}
                  cancelRename={() => {
                    setRenamingDeckId(null);
                    setRenameValue("");
                  }}
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
                    if (!activeStudySession || !selectedDeck) return;
                    studyReturnViewRef.current = "manager";
                    setCurrentAttemptStartedAt(new Date().toISOString());
                    setNotice("");
                    setView("study");
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

function ProjectLearningCreateView(
  props: Parameters<typeof CreateView>[0] & {
    cachedAnalysis: PdfAnalysisResponse | null;
    pipelineResult: GeneratePipelineResult | null;
    onUseCachedAnalysis: (analysis: PdfAnalysisResponse) => void;
  },
) {
  const {
    error,
    notice,
    pdfFiles,
    pdfAnalysis,
    learningGoalInput,
    setLearningGoalInput,
    selectedSourceOutlineLeafIds,
    setSelectedSourceOutlineLeafIds,
    showSourceOutlineSelectionError,
    wholeDocumentCorePlan,
    isPlanningWholeDocument,
    isPlanLearningGoalDirty,
    preparedResult,
    editableMaterial,
    activityDesign,
    isAnalyzingPdfs,
    isPreparingMaterial,
    isDesigningActivities,
    isGenerating,
    handleAnalyzePdfs,
    requestWholeDocumentCorePlan,
    handlePrepareMaterial,
    confirmLearningUnits,
    generateLearningActivities,
    cachedAnalysis,
    onUseCachedAnalysis,
  } = props;

  const autoPlanStartedRef = useRef(false);

  useEffect(() => {
    if (
      !pdfAnalysis ||
      wholeDocumentCorePlan ||
      isPlanningWholeDocument ||
      selectedSourceOutlineLeafIds.length === 0 ||
      autoPlanStartedRef.current
    ) {
      return;
    }
    autoPlanStartedRef.current = true;
    void requestWholeDocumentCorePlan("whole_document_core_soft_budget");
  }, [
    isPlanningWholeDocument,
    pdfAnalysis,
    requestWholeDocumentCorePlan,
    selectedSourceOutlineLeafIds.length,
    wholeDocumentCorePlan,
  ]);

  const step = !pdfAnalysis ? 1 : !preparedResult || !editableMaterial ? 2 : 3;
  const busyLabel = isAnalyzingPdfs
    ? "자료에서 목차를 찾고 있습니다"
    : isPlanningWholeDocument
      ? "학습할 구조를 정리하고 있습니다"
      : isPreparingMaterial
        ? "문제로 바꿀 내용을 추출하고 있습니다"
        : isDesigningActivities
          ? "내용별 문제 방식을 정하고 있습니다"
          : isGenerating
            ? "문제를 생성하고 있습니다"
            : "";
  const learningUnits = preparedResult?.analysis.learningUnits ?? [];
  const learningDesign = preparedResult?.learningDesign;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="grid grid-cols-3 border-b border-[#393D3A] pb-3">
        {[
          [1, "학습목표"],
          [2, "목차"],
          [3, "문제 구성"],
        ].map(([number, label]) => {
          const active = number === step;
          const complete = Number(number) < step;
          return (
            <div
              key={number}
              className={`flex items-center gap-2 text-[10px] font-bold ${
                active || complete ? "text-[#F0F2EF]" : "text-[#777C77]"
              }`}
            >
              <span
                className={`grid h-5 w-5 place-items-center rounded-full border ${
                  active
                    ? "border-[#ECEEEB] bg-[#ECEEEB] text-[#202321]"
                    : complete
                      ? "border-[#686D68] bg-[#464A46] text-[#F0F2EF]"
                      : "border-[#464A46]"
                }`}
              >
                {number}
              </span>
              <span>{label}</span>
            </div>
          );
        })}
      </div>

      {busyLabel ? (
        <div className="grid min-h-72 place-items-center px-6 text-center">
          <div>
            <span className="mx-auto block h-6 w-6 animate-spin rounded-full border-2 border-[#4B4F4B] border-t-[#ECEEEB]" />
            <p className="mt-4 text-sm font-black text-[#F0F2EF]">{busyLabel}</p>
            <p className="mt-1 text-xs text-[#A6AAA5]">완료되면 다음 단계가 열립니다.</p>
          </div>
        </div>
      ) : null}

      {!busyLabel && step === 1 ? (
        <form
          className="pt-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (cachedAnalysis) onUseCachedAnalysis(cachedAnalysis);
            else handleAnalyzePdfs();
          }}
        >
          <p className="text-xs font-black text-[#F0F2EF]">선택한 소스</p>
          <div className="mt-2 divide-y divide-[#353936] border-y border-[#353936]">
            {pdfFiles.map((file) => (
              <div key={`${file.name}-${file.size}`} className="flex h-9 items-center gap-2 px-1 text-[11px] text-[#B2B6B1]">
                <FileText size={13} className="shrink-0" />
                <span className="truncate">{file.name}</span>
              </div>
            ))}
          </div>

          <label className="mt-6 block">
            <span className="text-xs font-black text-[#F0F2EF]">무엇을 공부할까요?</span>
            <textarea
              value={learningGoalInput}
              onChange={(event) => setLearningGoalInput(event.target.value)}
              rows={4}
              placeholder="비워 두면 AI가 자료를 보고 자동으로 정합니다."
              className={`${inputClassName} mt-2 resize-none rounded-xl text-sm leading-6`}
            />
          </label>
          <p className="mt-2 text-[10px] leading-5 text-[#898E89]">
            목표를 적지 않아도 자료의 핵심과 학습 가치에 맞춰 진행합니다.
          </p>
          <PrimaryButton type="submit" className="mt-5 w-full rounded-xl">
            AI로 목차 잡기
          </PrimaryButton>
          <Feedback error={error} notice={notice} />
        </form>
      ) : null}

      {!busyLabel && step === 2 ? (
        <div className="space-y-4 pt-5">
          {!wholeDocumentCorePlan ? (
            <>
              {pdfAnalysis?.sourceOutline ? (
                <CompactLearningOutlineSelector
                  title="AI가 찾은 자료 구조"
                  description="이번 학습에서 제외할 부분만 체크를 해제하세요."
                  nodes={pdfAnalysis.sourceOutline.nodes}
                  selectedLeafIds={selectedSourceOutlineLeafIds}
                  showMinimumSelectionError={showSourceOutlineSelectionError}
                  onSelectionChange={setSelectedSourceOutlineLeafIds}
                />
              ) : (
                <p className="border border-[#393D3A] p-4 text-xs text-[#A6AAA5]">
                  목차를 찾지 못했습니다. 자료를 다시 확인해 주세요.
                </p>
              )}
              <PrimaryButton
                type="button"
                className="w-full rounded-xl"
                disabled={!pdfAnalysis?.sourceOutline || selectedSourceOutlineLeafIds.length === 0}
                onClick={() =>
                  void requestWholeDocumentCorePlan(
                    "whole_document_core_soft_budget",
                  )
                }
              >
                이 범위로 학습 구조 만들기
              </PrimaryButton>
            </>
          ) : (
            <>
              <div>
                <h5 className="text-sm font-black text-[#F0F2EF]">AI가 정리한 학습 목차</h5>
                <p className="mt-1 text-[10px] leading-5 text-[#A6AAA5]">
                  원문 목차를 그대로 복사하지 않고 실제로 익힐 단위로 정리했습니다.
                </p>
              </div>
              <div className="border-y border-[#353936]">
                {(wholeDocumentCorePlan.learningOutline?.nodes ?? []).map((node, index) => (
                  <div
                    key={node.id}
                    className={`border-b border-[#353936] py-2.5 last:border-b-0 ${node.parentId ? "pl-7 pr-2" : "px-2"}`}
                  >
                    <p className="text-[11px] font-bold text-[#F0F2EF]">
                      {index + 1}. {node.title}
                    </p>
                    {node.summary ? (
                      <p className="mt-1 line-clamp-2 text-[9px] leading-4 text-[#898E89]">{node.summary}</p>
                    ) : null}
                  </div>
                ))}
              </div>
              <PrimaryButton
                type="button"
                className="w-full rounded-xl"
                disabled={isPlanLearningGoalDirty}
                onClick={handlePrepareMaterial}
              >
                이대로 만들기
              </PrimaryButton>
            </>
          )}
          <Feedback error={error} notice={notice} />
        </div>
      ) : null}

      {!busyLabel && step === 3 ? (
        <div className="space-y-4 pt-5">
          <div>
            <h5 className="text-sm font-black text-[#F0F2EF]">AI 문제 구성</h5>
            <p className="mt-1 text-[10px] leading-5 text-[#A6AAA5]">
              {activityDesign
                ? "생성 전에 어떤 내용을 어떤 방식으로 물을지 확인하세요."
                : learningDesign
                  ? `${learningDesign.knowledgeUnits.length}개 학습 내용과 ${learningDesign.assessmentBlueprints.length}개 확인 행동을 설계했습니다.`
                  : `${learningUnits.length}개 학습 내용에 맞는 문제 방식을 정합니다.`}
            </p>
          </div>

          <div className="border-y border-[#353936]">
            {activityDesign
              ? activityDesign.recommendations.map((recommendation, index) => {
                  const unit = learningUnits.find(
                    (item) => item.id === recommendation.learningUnitId,
                  );
                  return (
                    <div key={activityRecommendationKey(recommendation)} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-[#353936] px-2 py-3 last:border-b-0">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-bold text-[#F0F2EF]">
                          {index + 1}. {unit?.target ?? unit?.intent ?? recommendation.learningUnitId}
                        </p>
                        <p className="mt-1 line-clamp-2 text-[9px] leading-4 text-[#898E89]">
                          {recommendation.reason}
                        </p>
                      </div>
                      <span className="shrink-0 text-[9px] font-bold text-[#B2B6B1]">
                        {recommendation.recommendedType
                          ? getLearningActivityLabel(recommendation.recommendedType)
                          : "제외"}
                      </span>
                    </div>
                  );
                })
              : learningDesign
                ? learningDesign.assessmentBlueprints.map((blueprint, index) => {
                    const unit = learningDesign.knowledgeUnits.find(
                      (item) => item.id === blueprint.knowledgeUnitId,
                    );
                    return (
                      <div key={blueprint.id} className="border-b border-[#353936] px-2 py-3 last:border-b-0">
                        <p className="text-[11px] font-bold text-[#F0F2EF]">
                          {index + 1}. {unit?.content ?? blueprint.knowledgeUnitId}
                        </p>
                        <p className="mt-1 text-[9px] leading-4 text-[#898E89]">
                          {blueprint.expectedResponse.description}
                        </p>
                      </div>
                    );
                  })
                : learningUnits.map((unit, index) => (
                    <div key={unit.id} className="border-b border-[#353936] px-2 py-3 text-[11px] font-bold text-[#F0F2EF] last:border-b-0">
                      {index + 1}. {unit.target ?? unit.intent}
                    </div>
                  ))}
          </div>

          {activityDesign ? (
            <PrimaryButton type="button" className="w-full rounded-xl" onClick={() => generateLearningActivities()}>
              이 구성으로 문제 만들기
            </PrimaryButton>
          ) : (
            <PrimaryButton type="button" className="w-full rounded-xl" onClick={confirmLearningUnits}>
              {learningDesign ? "이 설계로 문제 만들기" : "AI 문제 구성 만들기"}
            </PrimaryButton>
          )}
          <Feedback error={error} notice={notice} />
        </div>
      ) : null}
    </div>
  );
}

function CreateView({
  form,
  error,
  notice,
  isPreparingMaterial,
  isAnalyzingPdfs,
  analysisPhase,
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
  hasConfirmedStudyGuideline,
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
  setSelectedSourceOutlineLeafIds,
  setPdfFiles,
  selectFocusGroup,
  setActiveLearningUnitId,
  toggleLearningUnit,
  confirmLearningUnits,
  setActivitySelectionMode,
  setProblemDesignAdvice,
  selectActivityType,
  selectActivityInclude,
  generateLearningActivities,
  clearPdfAnalysis,
  clearPreparedResult,
  handlePrepareMaterial,
  handleAnalyzePdfs,
  requestWholeDocumentCorePlan,
  replanWithLearningGoal,
  retryGuideline,
  projectEmbedded = false,
}: {
  form: GenerateRequest;
  error: string;
  notice: string;
  isPreparingMaterial: boolean;
  isAnalyzingPdfs: boolean;
  analysisPhase: string;
  pdfFiles: File[];
  pdfAnalysis: PdfAnalysisResponse | null;
  studyGuideline: StudyGuidelineDraft | null;
  selectedFocusGroupId: string | null;
  runMode: BaselineRunMode;
  wholeDocumentCorePlan: WholeDocumentCorePlan | null;
  selectedSourceOutlineLeafIds: string[];
  showSourceOutlineSelectionError: boolean;
  learningGoalInput: string;
  planLearningGoal: string;
  isPlanLearningGoalDirty: boolean;
  hasConfirmedStudyGuideline: boolean;
  isPlanningGuideline: boolean;
  isPlanningWholeDocument: boolean;
  preparedResult: GeneratePipelineResult | null;
  editableMaterial: OrganizedMaterial | null;
  excludedLearningUnitIds: string[];
  activeLearningUnitId: string | null;
  isLearningUnitSelectionConfirmed: boolean;
  activitySelectionMode: ActivitySelectionMode;
  problemDesignAdvice: string;
  activityDesign: ActivityDesign | null;
  selectedActivityTypes: Record<string, LearningActivityType>;
  selectedActivityIncludes: Record<string, boolean>;
  isDesigningActivities: boolean;
  isGenerating: boolean;
  setForm: React.Dispatch<React.SetStateAction<GenerateRequest>>;
  setLearningGoalInput: (value: string) => void;
  setPlanLearningGoal: (value: string) => void;
  setSelectedSourceOutlineLeafIds: (value: string[]) => void;
  setPdfFiles: (files: File[]) => void;
  selectFocusGroup: (id: string) => void;
  setActiveLearningUnitId: (id: string) => void;
  toggleLearningUnit: (id: string) => void;
  confirmLearningUnits: () => void;
  setActivitySelectionMode: (mode: ActivitySelectionMode) => void;
  setProblemDesignAdvice: (value: string) => void;
  selectActivityType: (
    learningUnitId: string,
    activityType: LearningActivityType,
  ) => void;
  selectActivityInclude: (learningUnitId: string, included: boolean) => void;
  generateLearningActivities: (design?: ActivityDesign | null) => void;
  clearPdfAnalysis: () => void;
  clearPreparedResult: () => void;
  handlePrepareMaterial: () => void;
  handleAnalyzePdfs: () => void;
  requestWholeDocumentCorePlan: (
    mode: "whole_document_core" | "whole_document_core_soft_budget",
  ) => Promise<boolean>;
  replanWithLearningGoal: () => void;
  retryGuideline: () => void;
  projectEmbedded?: boolean;
}) {
  const [surveyPage, setSurveyPage] = useState<"analysis" | "source" | "focus">(
    "analysis",
  );
  const [preparedPage, setPreparedPage] = useState<"evidence" | "method">(
    "evidence",
  );

  if (isAnalyzingPdfs) {
    return (
      <GenerationProgressFocus
        eyebrow="PDF 분석 중"
        stage={analysisPhase}
        description="자료의 구조와 핵심 흐름을 읽고, 공부할 범위를 정리하고 있습니다."
        detail="완료되면 분석 결과 화면으로 자동 이동합니다."
      />
    );
  }

  if (isPreparingMaterial) {
    return (
      <GenerationProgressFocus
        eyebrow="학습 내용 추출 중"
        stage="선택한 목차를 학습 단위로 바꾸고 있습니다"
        description="원문 근거를 유지하면서 문제를 만들 수 있는 크기로 내용을 정리합니다."
      />
    );
  }

  if (isDesigningActivities) {
    return (
      <GenerationProgressFocus
        eyebrow="문제 구성 중"
        stage="각 내용에 맞는 문제 방식을 고르고 있습니다"
        description="플래시카드, 빈칸, OX, 객관식, 구조복원 중 현재 앱에서 가장 알맞은 방식을 판단합니다."
      />
    );
  }

  if (isGenerating) {
    return (
      <GenerationProgressFocus
        eyebrow="문제 생성 중"
        stage="실제로 풀 문제를 만들고 있습니다"
        description="정답과 출처를 확인할 수 있는 형태로 마무리하고 있습니다."
      />
    );
  }

  if (!pdfAnalysis) {
    return (
      <form className="space-y-5">
        <Panel>
          {projectEmbedded ? (
            <div className="border border-[#3B3F3C] bg-[#222523] px-4 py-3">
              <p className="text-xs font-black text-[#F0F2EF]">선택한 소스</p>
              <p className="mt-1 text-xs leading-5 text-[#A6AAA5]">
                {pdfFiles.map((file) => file.name).join(" · ")}
              </p>
            </div>
          ) : (
          <div className="border border-dashed border-[#5A5F5A] bg-[#222523] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <FieldLabel>PDF 학습 자료</FieldLabel>
                <p className="mt-1 text-xs leading-5 text-[#B2B6B1]">
                  한 번에 최대 20개, 전체 50MB까지 분석할 수 있습니다.
                </p>
              </div>
              {pdfFiles.length > 0 ? (
                <SecondaryButton onClick={() => setPdfFiles([])}>
                  전체 제거
                </SecondaryButton>
              ) : null}
            </div>
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              disabled={isAnalyzingPdfs}
              onChange={(event) => {
                setPdfFiles(Array.from(event.target.files ?? []));
                clearPdfAnalysis();
              }}
              className="mt-3 block w-full text-sm text-[#B2B6B1] file:mr-3 file:border-0 file:bg-[#ECEEEB] file:px-4 file:py-2.5 file:font-black file:text-[#202321] hover:file:bg-[#D5D8D4] disabled:cursor-not-allowed disabled:opacity-50"
            />
            {pdfFiles.length > 0 ? (
              <div className="mt-3 space-y-1 text-xs text-[#F0F2EF]">
                {pdfFiles.map((file) => (
                  <p key={`${file.name}-${file.size}`}>
                    {file.name} ({formatFileSize(file.size)})
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          )}

          <label className="mt-5 block space-y-2">
            <FieldLabel>학습목표 (선택)</FieldLabel>
            <textarea
              value={learningGoalInput}
              disabled={isAnalyzingPdfs}
              onChange={(event) => setLearningGoalInput(event.target.value)}
              className={`${inputClassName} min-h-24 resize-y text-sm leading-6 disabled:cursor-not-allowed disabled:opacity-50`}
              placeholder="공란이면 자료를 바탕으로 AI가 학습목표를 제안합니다."
            />
          </label>

          <PrimaryButton
            type="button"
            onClick={handleAnalyzePdfs}
            disabled={isAnalyzingPdfs || pdfFiles.length === 0}
            className="mt-5 w-full sm:w-auto"
          >
            {isAnalyzingPdfs ? "자료 분석 중" : "자료 분석"}
          </PrimaryButton>

          <details className="mt-5 border border-[#3B3F3C] bg-[#222523] p-4">
            <summary className="cursor-pointer text-sm font-black text-[#B2B6B1]">
              참고 자료와 추가 지시
            </summary>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block space-y-2">
                <FieldLabel>PDF에 덧붙일 참고 텍스트 (선택)</FieldLabel>
                <textarea
                  value={form.sourceText}
                  disabled={isAnalyzingPdfs}
                  onChange={(event) =>
                    setForm((value) => ({
                      ...value,
                      sourceText: event.target.value,
                    }))
                  }
                  className={`${inputClassName} min-h-28 resize-y text-sm leading-6 disabled:cursor-not-allowed disabled:opacity-50`}
                  placeholder="PDF에 없는 참고 내용이 있을 때만 입력하세요."
                />
              </label>
              <label className="block space-y-2">
                <FieldLabel>추가 지시사항 (선택)</FieldLabel>
                <textarea
                  value={form.instruction}
                  disabled={isAnalyzingPdfs}
                  onChange={(event) =>
                    setForm((value) => ({
                      ...value,
                      instruction: event.target.value,
                    }))
                  }
                  className={`${inputClassName} min-h-28 resize-y text-sm leading-6 disabled:cursor-not-allowed disabled:opacity-50`}
                  placeholder="자료 처리 방식에 추가로 반영할 요청을 입력하세요."
                />
              </label>
            </div>
          </details>

          {pdfFiles.length > 0 ? (
            <details className="mt-3 border border-[#3B3F3C] bg-[#242725] p-4">
              <summary className="cursor-pointer text-sm font-black text-[#B2B6B1]">
                선택한 PDF 미리보기
              </summary>
              <div className="mt-4">
                <PdfReviewViewer files={pdfFiles} />
              </div>
            </details>
          ) : null}
        </Panel>

        <Feedback error={error} notice={notice} />
      </form>
    );
  }

  if (!preparedResult || !editableMaterial) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <SecondaryButton
            onClick={() => {
              setSurveyPage("analysis");
              clearPdfAnalysis();
            }}
          >
            자료 다시 선택
          </SecondaryButton>
          <p className="text-sm text-[#B2B6B1]">
            {pdfFiles.length}개 PDF 분석 완료
          </p>
        </div>

        <SurveyPager currentPage={surveyPage} />

        {surveyPage === "analysis" ? (
          <>
            <PdfAnalysisPanel analysis={pdfAnalysis} />
            <div className="flex justify-end">
              <PrimaryButton
                type="button"
                onClick={() => setSurveyPage("source")}
                className="inline-flex items-center gap-2"
              >
                원문 목차 선택 <ChevronRight size={16} />
              </PrimaryButton>
            </div>
          </>
        ) : null}

        {surveyPage === "source" ? (
          <>
            {pdfAnalysis.sourceOutline ? (
              <CompactLearningOutlineSelector
                title="PDF 원문 목차 선택"
                description="AI가 문제 크기로 바꾸기 전의 원문 구조입니다. 이번 학습에 사용할 부분만 고르세요."
                nodes={pdfAnalysis.sourceOutline.nodes}
                selectedLeafIds={selectedSourceOutlineLeafIds}
                showMinimumSelectionError={showSourceOutlineSelectionError}
                disabled={isPlanningWholeDocument}
                onSelectionChange={setSelectedSourceOutlineLeafIds}
              />
            ) : (
              <Panel>
                <p className="text-sm text-[#B2B6B1]">
                  이 분석 결과에는 원문 목차가 없습니다. 자료를 다시 분석해 주세요.
                </p>
              </Panel>
            )}
            <div className="flex items-center justify-between gap-3">
              <SecondaryButton
                onClick={() => setSurveyPage("analysis")}
                className="inline-flex items-center gap-2"
              >
                <ChevronLeft size={16} /> 이전
              </SecondaryButton>
              <PrimaryButton
                type="button"
                onClick={async () => {
                  const planned = await requestWholeDocumentCorePlan(
                    "whole_document_core_soft_budget",
                  );
                  if (planned) setSurveyPage("focus");
                }}
                className="inline-flex items-center gap-2"
                disabled={
                  !pdfAnalysis.sourceOutline ||
                  selectedSourceOutlineLeafIds.length === 0 ||
                  isPlanningWholeDocument
                }
              >
                {isPlanningWholeDocument ? "학습 목차 만드는 중" : "선택 범위로 학습 목차 만들기"}
                <ChevronRight size={16} />
              </PrimaryButton>
            </div>
          </>
        ) : null}

        {surveyPage === "focus" ? (
          <>
            {runMode === "focused_area" && studyGuideline ? (
              <StudyGuidelinePanel
                guideline={studyGuideline}
                selectedGroupId={selectedFocusGroupId}
                onSelect={selectFocusGroup}
              />
            ) : runMode === "focused_area" ? (
              <Panel>
                <h3 className="text-base font-black text-[#F0F2EF]">학습 방향 준비</h3>
                <p className="mt-2 text-sm leading-6 text-[#B2B6B1]">
                  {isPlanningGuideline
                    ? "자료에 맞는 학습 목표와 카드 구성을 정하고 있습니다."
                    : "학습 방향을 아직 만들지 못했습니다. 다시 시도해 주세요."}
                </p>
                {!isPlanningGuideline ? (
                  <SecondaryButton className="mt-4" onClick={retryGuideline}>
                    학습 방향 다시 만들기
                  </SecondaryButton>
                ) : null}
              </Panel>
            ) : null}
            <WholeDocumentCoreExperimentPanel
              runMode={runMode}
              plan={wholeDocumentCorePlan}
              learningGoal={planLearningGoal}
              isLearningGoalDirty={isPlanLearningGoalDirty}
              isPlanning={isPlanningWholeDocument}
              onLearningGoalChange={setPlanLearningGoal}
              onPlan={requestWholeDocumentCorePlan}
              onReplan={replanWithLearningGoal}
            />
            <div className="flex items-center justify-between gap-3">
              <SecondaryButton
                onClick={() => setSurveyPage("source")}
                className="inline-flex items-center gap-2"
              >
                <ChevronLeft size={16} /> 이전
              </SecondaryButton>
              <PrimaryButton
                type="button"
                onClick={handlePrepareMaterial}
                className="inline-flex items-center gap-2"
                disabled={
                  !hasConfirmedStudyGuideline ||
                  isPlanLearningGoalDirty ||
                  isPlanningGuideline ||
                  isPlanningWholeDocument ||
                  isPreparingMaterial
                }
              >
                {isPreparingMaterial ? "학습 내용 추출 중" : "학습 내용 추출"}
                <ChevronRight size={16} />
              </PrimaryButton>
            </div>
          </>
        ) : null}

        <Feedback error={error} notice={notice} />
      </div>
    );
  }

  const learningUnits = preparedResult.analysis.learningUnits ?? [];
  const sourceImportanceById = new Map(
    (wholeDocumentCorePlan?.learningOutline?.nodes ?? []).map((node) => [
      node.id,
      node.importance ?? 2,
    ]),
  );
  const learningUnitImportance = Object.fromEntries(
    learningUnits.map((unit) => [
      unit.id,
      sourceImportanceById.get(unit.sourceId) ?? 2,
    ]),
  );
  const includedLearningUnitCount =
    learningUnits.length - excludedLearningUnitIds.length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <SecondaryButton
          onClick={() =>
            preparedPage === "method"
              ? setPreparedPage("evidence")
              : clearPreparedResult()
          }
        >
          {preparedPage === "method" ? "근거 검토로 돌아가기" : "집중 영역으로 돌아가기"}
        </SecondaryButton>
        <p className="text-sm text-[#B2B6B1]">
          {includedLearningUnitCount} / {learningUnits.length}개 학습 내용 포함
        </p>
      </div>

      {preparedPage === "evidence" ? <>
      <Panel>
        <h3 className="text-base font-black text-[#F0F2EF]">PDF 근거 검토</h3>
        <p className="mt-1 text-sm leading-6 text-[#B2B6B1]">
          형광펜 표시를 눌러 원문과 추출 내용을 비교하고, 학습하지 않을 내용은
          오른쪽 목록에서 제외하세요.
        </p>
      </Panel>

      {pdfFiles.length > 0 ? (
        <PdfReviewViewer
          files={pdfFiles}
          learningUnits={learningUnits}
          excludedLearningUnitIds={excludedLearningUnitIds}
          activeLearningUnitId={activeLearningUnitId}
          onActiveLearningUnitChange={setActiveLearningUnitId}
          onToggleLearningUnit={toggleLearningUnit}
          learningUnitImportance={learningUnitImportance}
        />
      ) : (
        <Panel>
          <p className="text-sm text-[#B2B6B1]">
            PDF가 없어 원문 위치는 표시할 수 없습니다. 추출된 학습 내용 목록만
            검토할 수 있습니다.
          </p>
        </Panel>
      )}

      <div className="flex justify-end border-t border-[#3B3F3C] pt-4">
        <PrimaryButton
          type="button"
          onClick={() => setPreparedPage("method")}
          disabled={includedLearningUnitCount <= 0}
          className="inline-flex items-center gap-2"
        >
          문제 생성 설정 <ChevronRight size={16} />
        </PrimaryButton>
      </div>
      </> : <>

      <details className="border-y border-[#3B3F3C] bg-[#2A2E2B] py-3">
        <summary className="cursor-pointer text-sm font-black text-[#F0F2EF]">
          문제 방향을 직접 조정하기 <span className="ml-2 font-normal text-[#A6AAA5]">선택</span>
        </summary>
        <div className="mt-3 border-l-2 border-[#ECEEEB] pl-4">
          <p className="text-xs leading-5 text-[#A6AAA5]">
            비워 두면 학습목표와 자료를 기준으로 AI가 판단합니다.
          </p>
          <textarea
            aria-label="문제 만들기 방향"
            value={problemDesignAdvice}
            onChange={(event) => setProblemDesignAdvice(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="예: 개념 이름보다 새로운 상황에서 판단하는 문제를 우선해 주세요."
            className={`${inputClassName} mt-2 min-h-20 resize-y`}
          />
        </div>
      </details>

      <CompactChoiceRows<SourceExpressionMode>
        title="원문 표현 방식"
        description="무엇을 그대로 외울지 정합니다."
        value={form.sourceExpressionMode ?? "adapt"}
        disabled={isLearningUnitSelectionConfirmed}
        onChange={(sourceExpressionMode) =>
          setForm((current) => ({ ...current, sourceExpressionMode }))
        }
        options={[
          {
            value: "preserve",
            label: "원문 중심으로 만들기",
            description: "질문과 답의 재료를 원문에서 찾고 필요한 만큼만 정리합니다.",
            detail: "원문의 제목·맥락·문장·패턴·공식·사례를 우선 사용합니다. 문제를 자연스럽게 만들기 위한 축약과 작은 정리는 허용하며, 적용이 필요하면 원문에서 직접 이어지는 간단한 새 입력도 만들 수 있습니다.",
          },
          {
            value: "adapt",
            label: "AI가 학습용으로 다듬기",
            description: "뜻은 유지하면서 질문과 정답을 학습하기 좋게 정리합니다.",
            detail: "적용이 목표라면 새로운 예시나 상황을 만들 수 있습니다. 현재까지 사용하던 기본 방식입니다.",
          },
        ]}
      />

      <CompactChoiceRows
        title="문제 생성 진행 방식"
        description="AI 구성을 그대로 쓸지 직접 조정할지 정합니다."
        value={activitySelectionMode}
        disabled={isLearningUnitSelectionConfirmed}
        onChange={setActivitySelectionMode}
        options={[
          {
            value: "automatic",
            label: "AI 추천으로 구성",
            description: "각 내용에 맞는 방식을 AI가 고릅니다.",
            badge: "빠르게",
            detail: "AI가 정한 문제 구성을 확인한 뒤 한 번 눌러 문제를 생성합니다.",
          },
          {
            value: "manual",
            label: "추천을 보고 직접 선택",
            description: "내용별 추천을 확인하고 필요한 방식만 바꿉니다.",
            detail: "AI가 추천한 문제 방식과 포함 여부를 확인한 뒤 사용자가 직접 확정합니다.",
          },
        ]}
      />

      {activityDesign ? (
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-black text-[#F0F2EF]">
                {activitySelectionMode === "automatic" ? "AI가 정한 문제 구성" : "AI 추천 문제 방식"}
              </h3>
              <p className="mt-1 text-sm text-[#B2B6B1]">
                {activitySelectionMode === "automatic"
                  ? "구성을 확인한 뒤 문제 만들기를 시작하세요."
                  : "추천을 그대로 사용하거나 필요한 항목만 변경하세요."}
              </p>
            </div>
            <PrimaryButton
              type="button"
              disabled={isGenerating}
              onClick={() => generateLearningActivities()}
            >
              {isGenerating
                ? "문제 생성 중"
                : activitySelectionMode === "automatic"
                  ? "이 구성으로 문제 만들기"
                  : "선택한 방식으로 생성"}
            </PrimaryButton>
          </div>
          <div className="mt-4 space-y-3">
            {activityDesign.recommendations.map((recommendation, index) => {
              const recommendationKey = activityRecommendationKey(recommendation);
              const unit = learningUnits.find(
                (item) => item.id === recommendation.learningUnitId,
              );
              const objective = activityDesign.objectives?.find(
                (item) => item.id === recommendation.objectiveId,
              );
              const blueprint = activityDesign.blueprints?.find(
                (item) => item.id === recommendation.blueprintId,
              );
              return (
                <div
                  key={recommendationKey}
                  className="grid gap-3 rounded-md border border-[#393D3A] p-3 sm:grid-cols-[1fr_190px]"
                >
                  <div>
                    <p className="font-black text-[#F0F2EF]">
                      {index + 1}. {objective?.target ?? unit?.target ?? unit?.intent ?? recommendation.learningUnitId}
                    </p>
                    {blueprint ? (
                      <p className="mt-1 text-xs leading-5 text-[#B2B6B1]">
                        학생에게 제공: {blueprint.given.map((item) => item.description).join(" · ")}
                        <br />
                        학생이 답할 것: {blueprint.expectedResponse.description}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs leading-5 text-[#B2B6B1]">
                      {recommendation.assessmentLevel === "exact"
                        ? "직접 훈련"
                        : recommendation.assessmentLevel === "scaffold"
                          ? "보조 훈련"
                          : recommendation.assessmentLevel === "proxy"
                            ? "대체 연습"
                            : recommendation.supportLevel === "supported"
                              ? "지원"
                              : recommendation.supportLevel === "partial"
                                ? "부분 지원"
                                : "미지원"}
                      {recommendation.recommendedType
                        ? ` · 추천: ${getLearningActivityLabel(recommendation.recommendedType)}`
                        : ""}
                      {` · ${recommendation.reason}`}
                    </p>
                    {recommendation.limitation ? (
                      <p className="mt-1 text-xs leading-5 text-[#B54708]">
                        한계: {recommendation.limitation}
                      </p>
                    ) : null}
                    {recommendation.supportLevel !== "unsupported" ? (
                      <label className="mt-2 flex items-center gap-2 text-xs font-bold text-[#B2B6B1]">
                        <input
                          type="checkbox"
                          disabled={activitySelectionMode === "automatic"}
                          checked={
                            selectedActivityIncludes[recommendationKey] ??
                            recommendation.includeInGeneration
                          }
                          onChange={(event) =>
                            selectActivityInclude(
                              recommendationKey,
                              event.target.checked,
                            )
                          }
                        />
                        문제 생성에 포함
                      </label>
                    ) : null}
                  </div>
                  {recommendation.recommendedType ? (
                    <select
                      value={
                        selectedActivityTypes[recommendationKey] ??
                        recommendation.recommendedType
                      }
                      onChange={(event) =>
                        selectActivityType(
                          recommendationKey,
                          event.target.value as LearningActivityType,
                        )
                      }
                      disabled={
                        activitySelectionMode === "automatic" ||
                        !(selectedActivityIncludes[recommendationKey] ??
                          recommendation.includeInGeneration)
                      }
                      className={inputClassName}
                    >
                      <option value="flashcard">플래시카드</option>
                      <option value="cloze">빈칸</option>
                      <option value="true_false">OX</option>
                      <option value="multiple_choice">객관식</option>
                      <option value="structure_recall">구조복원</option>
                    </select>
                  ) : (
                    <div className="rounded-md bg-[#222523] px-3 py-2 text-sm font-bold text-[#A6AAA5]">
                      현재 문제 생성 불가
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#393D3A] bg-[#2A2E2B] p-4">
        <p className="text-sm font-bold text-[#B2B6B1]">
          {isLearningUnitSelectionConfirmed
            ? "학습 내용 선택을 확정했습니다."
            : "제외할 내용을 정한 뒤 선택을 확정하세요."}
        </p>
        <PrimaryButton
          type="button"
          onClick={confirmLearningUnits}
          disabled={
            includedLearningUnitCount <= 0 ||
            isDesigningActivities ||
            isGenerating ||
            isLearningUnitSelectionConfirmed
          }
        >
          {isDesigningActivities
            ? "AI 추천 중"
            : isGenerating
              ? "문제 생성 중"
              : isLearningUnitSelectionConfirmed
                ? "선택 확정됨"
                : "학습 내용 확정"}
        </PrimaryButton>
      </div>
      </>}

      <Feedback error={error} notice={notice} />
    </div>
  );
}
function SurveyPager({
  currentPage,
}: {
  currentPage: "analysis" | "source" | "focus";
}) {
  const pages = [
    { id: "analysis", label: "분석 결과" },
    { id: "source", label: "원문 범위" },
    { id: "focus", label: "학습 목차" },
  ] as const;
  const currentIndex = pages.findIndex((page) => page.id === currentPage);

  return (
    <div className="rounded-md border border-[#393D3A] bg-[#2A2E2B] px-4 py-3">
      <div className="flex items-center gap-2" aria-label="학습 설계 진행 단계">
        {pages.map((page, index) => {
          const active = page.id === currentPage;
          const complete = index < currentIndex;
          return (
            <div key={page.id} className="flex min-w-0 flex-1 items-center gap-2">
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-black ${
                  active
                    ? "bg-[#ECEEEB] text-[#202321]"
                    : complete
                      ? "bg-[#22A06B] text-white"
                      : "bg-[#393D3A] text-[#B2B6B1]"
                }`}
              >
                {index + 1}
              </span>
              <span
                className={`truncate text-xs font-bold ${
                  active ? "text-[#F0F2EF]" : "text-[#A6AAA5]"
                }`}
              >
                {page.label}
              </span>
              {index < pages.length - 1 ? (
                <span className="h-px min-w-3 flex-1 bg-[#393D3A]" />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Retained for the later post-selection editing step.
function PreparedMaterialEditor({
  material,
  onChange,
}: {
  material: OrganizedMaterial;
  onChange: (material: OrganizedMaterial) => void;
}) {
  function updateSection(
    index: number,
    field: "heading" | "content",
    value: string,
  ) {
    onChange({
      ...material,
      sections: material.sections.map((section, sectionIndex) =>
        sectionIndex === index ? { ...section, [field]: value } : section,
      ),
    });
  }

  return (
    <Panel>
      <div>
        <h3 className="text-base font-black text-[#F0F2EF]">학습 단위 추출 결과</h3>
        <p className="mt-1 text-sm leading-6 text-[#B2B6B1]">
          이 내용만 카드 생성에 사용됩니다. 불필요한 부분을 지우거나 표현을
          다듬은 뒤 생성하세요.
        </p>
      </div>

      <label className="mt-5 block space-y-2">
        <FieldLabel>학습 자료 제목</FieldLabel>
        <input
          value={material.title}
          onChange={(event) =>
            onChange({ ...material, title: event.target.value })
          }
          className={inputClassName}
        />
      </label>

      <div className="mt-5 space-y-4">
        {material.sections.map((section, index) => (
          <section
            key={index}
            className="rounded-md border border-[#393D3A] bg-[#202321] p-4"
          >
            <div className="flex items-start gap-3">
              <span className="mt-3 shrink-0 text-xs font-black text-[#B2B6B1]">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-3">
                {section.learningUnitIds?.length ? (
                  <p className="text-xs font-bold text-[#ECEEEB]">
                    연결된 학습 단위: {section.learningUnitIds.join(", ")}
                  </p>
                ) : null}
                <input
                  aria-label={`${index + 1}번 섹션 제목`}
                  value={section.heading}
                  onChange={(event) =>
                    updateSection(index, "heading", event.target.value)
                  }
                  className={inputClassName}
                  placeholder="섹션 제목"
                />
                <textarea
                  aria-label={`${index + 1}번 섹션 내용`}
                  value={section.content}
                  onChange={(event) =>
                    updateSection(index, "content", event.target.value)
                  }
                  className={`${inputClassName} min-h-40 resize-y text-sm leading-6`}
                  placeholder="카드로 만들 학습 내용"
                />
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...material,
                      sections: material.sections.filter(
                        (_, sectionIndex) => sectionIndex !== index,
                      ),
                    })
                  }
                  className="text-xs font-bold text-[#C9372C] hover:text-[#C9372C]"
                >
                  섹션 삭제
                </button>
              </div>
            </div>
          </section>
        ))}
      </div>

      <SecondaryButton
        className="mt-4"
        onClick={() =>
          onChange({
            ...material,
            sections: [
              ...material.sections,
              { heading: "", content: "", learningUnitIds: [] },
            ],
          })
        }
      >
        섹션 추가
      </SecondaryButton>
    </Panel>
  );
}

function StudyGuidelinePanel({
  guideline,
  selectedGroupId,
  onSelect,
}: {
  guideline: StudyGuidelineDraft;
  selectedGroupId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Panel>
      <div className="border-b border-[#393D3A] pb-5">
        <p className="text-xs font-bold uppercase text-[#22A06B]">자료 구조</p>
        <h3 className="mt-2 text-lg font-black text-[#F0F2EF]">학습 영역 선택</h3>
        <p className="mt-2 text-sm leading-6 text-[#B2B6B1]">
          {guideline.summary}
        </p>
      </div>

      <h4 className="mt-5 text-sm font-black text-[#F0F2EF]">
        {guideline.question}
      </h4>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {guideline.groups.map((group, index) => {
          const selected = selectedGroupId === group.id;
          const recommended = guideline.recommendedGroupId === group.id;
          return (
            <button
              key={group.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(group.id)}
              className={`min-h-32 rounded-md border p-4 text-left transition-colors ${
                selected
                  ? "border-[#ECEEEB] bg-[#ECEEEB]/15"
                  : "border-[#393D3A] bg-[#242725] hover:border-[#8590A2]"
              }`}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="text-sm font-black text-[#F0F2EF]">
                  {String.fromCharCode(65 + index)}. {group.title}
                </span>
                {recommended ? (
                  <span className="shrink-0 text-[11px] font-bold text-[#22A06B]">
                    추천
                  </span>
                ) : null}
              </span>
              <span className="mt-2 block text-xs leading-5 text-[#B2B6B1]">
                {group.description}
              </span>
              <span className="mt-3 block text-xs font-black text-[#F0F2EF]">
                {group.itemCount}개 {group.itemLabel}
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function WholeDocumentCoreExperimentPanel({
  runMode,
  plan,
  learningGoal,
  isLearningGoalDirty,
  isPlanning,
  onLearningGoalChange,
  onPlan,
  onReplan,
}: {
  runMode: BaselineRunMode;
  plan: WholeDocumentCorePlan | null;
  learningGoal: string;
  isLearningGoalDirty: boolean;
  isPlanning: boolean;
  onLearningGoalChange: (value: string) => void;
  onPlan: (
    mode: "whole_document_core" | "whole_document_core_soft_budget",
  ) => void;
  onReplan: () => void;
}) {
  const active = runMode !== "focused_area" && plan;

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase text-[#ECEEEB]">Plan</p>
          <h3 className="mt-2 text-base font-black text-[#F0F2EF]">
            핵심 학습 범위
          </h3>
          <p className="mt-2 text-sm leading-6 text-[#B2B6B1]">
            AI가 학습목표를 기준으로 전체 자료에서 핵심 범위를 선별했습니다.
          </p>
        </div>
        {!active && !isPlanning ? (
          <SecondaryButton
            onClick={() => onPlan("whole_document_core_soft_budget")}
            className="inline-flex items-center gap-2 border-[#ECEEEB] text-[#ECEEEB]"
          >
            <Sparkles size={16} />
            핵심 다시 선별
          </SecondaryButton>
        ) : null}
      </div>

      {isPlanning ? (
        <p className="mt-5 border-t border-[#393D3A] pt-4 text-sm font-bold text-[#B2B6B1]">
          학습목표에 맞는 핵심 범위를 다시 선별하고 있습니다.
        </p>
      ) : null}

      {active ? (
        <div className="mt-5 border-t border-[#393D3A] pt-4">
          <label className="block space-y-2">
            <FieldLabel>학습목표</FieldLabel>
            <textarea
              value={learningGoal}
              disabled={isPlanning}
              onChange={(event) => onLearningGoalChange(event.target.value)}
              className={`${inputClassName} min-h-24 resize-y text-sm leading-6 disabled:cursor-not-allowed disabled:opacity-50`}
            />
          </label>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs font-bold text-[#22A06B]">
              최대 {plan.maxLearningUnitCount}개
            </span>
            {isLearningGoalDirty ? (
              <PrimaryButton
                type="button"
                disabled={isPlanning || !learningGoal.trim()}
                onClick={onReplan}
                className="inline-flex items-center gap-2"
              >
                <Sparkles size={16} /> 수정한 목표로 핵심 다시 선별
              </PrimaryButton>
            ) : (
              <span className="text-xs font-bold text-[#B2B6B1]">
                이 목표와 핵심 범위로 진행할 수 있습니다.
              </span>
            )}
          </div>
          <p className="mt-2 text-sm leading-6 text-[#B2B6B1]">
            {plan.selectionRationale}
          </p>
          <div className="mt-4 divide-y divide-[#393D3A] border-y border-[#393D3A]">
            {plan.areas.map((area) => (
              <div key={area.id} className="py-3">
                <p className="text-sm font-black text-[#F0F2EF]">{area.title}</p>
                <p className="mt-1 text-xs leading-5 text-[#B2B6B1]">
                  {area.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function PdfAnalysisPanel({ analysis }: { analysis: PdfAnalysisResponse }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const file = analysis.files[activeIndex];

  if (!file) {
    return null;
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-black text-[#F0F2EF]">PDF 분석 결과</h3>
          <p className="mt-1 text-xs leading-5 text-[#B2B6B1]">
            {analysis.files.length}개 파일 중 {activeIndex + 1}번째 분석 결과
          </p>
        </div>
        {analysis.files.length > 1 ? (
          <div className="flex gap-2">
            <SecondaryButton
              onClick={() => setActiveIndex((index) => Math.max(index - 1, 0))}
              disabled={activeIndex === 0}
            >
              이전
            </SecondaryButton>
            <SecondaryButton
              onClick={() =>
                setActiveIndex((index) => Math.min(index + 1, analysis.files.length - 1))
              }
              disabled={activeIndex === analysis.files.length - 1}
            >
              다음
            </SecondaryButton>
          </div>
        ) : null}
      </div>

      <article className="mt-4 rounded-md border border-[#393D3A] bg-[#202321] p-4">
        <h4 className="font-black text-[#F0F2EF]">{file.fileName}</h4>
        <p className="mt-2 text-sm font-bold text-[#B2B6B1]">
          {file.documentType}
        </p>
        <p className="mt-2 text-sm leading-6 text-[#B2B6B1]">{file.summary}</p>
        <div className="mt-3">
          <p className="text-xs font-bold text-[#B2B6B1]">핵심 주제</p>
          <p className="mt-1 text-sm text-[#F0F2EF]">
            {file.keyTopics.join(" · ") || "추출된 주제가 없습니다."}
          </p>
        </div>
        <div className="mt-4 space-y-3">
          <p className="text-xs font-bold text-[#B2B6B1]">구조 및 목차식 정리</p>
          {file.outline.map((section, index) => (
            <div key={`${section.heading}-${index}`} className="border-l-2 border-[#ECEEEB] pl-3">
              <p className="text-sm font-black text-[#F0F2EF]">{section.heading}</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-sm leading-5 text-[#B2B6B1]">
                {section.points.map((point, pointIndex) => (
                  <li key={`${point}-${pointIndex}`}>{point}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-4 rounded-md bg-[#2A2E2B] p-3 text-sm leading-6 text-[#B2B6B1]">
          <span className="font-bold text-[#F0F2EF]">권장 역할: </span>
          {file.suggestedRole}
        </p>
      </article>
    </Panel>
  );
}

function ReviewView({
  pipelineResult,
  editableCards,
  formMode,
  addCard,
  removeCard,
  updateCard,
  handleSaveDeck,
  goCreate,
  notice,
  error,
}: {
  pipelineResult: GeneratePipelineResult | null;
  editableCards: Card[];
  formMode: StudyMode;
  addCard: () => void;
  removeCard: (id: string) => void;
  updateCard: (id: string, patch: Partial<Card>) => void;
  handleSaveDeck: () => void;
  goCreate: () => void;
  notice: string;
  error: string;
}) {
  const [isEditing, setIsEditing] = useState(false);

  if (!pipelineResult) {
    return (
      <EmptyState
        title="생성 결과가 없습니다."
        body="학습 자료를 먼저 생성하면 여기에서 카드를 수정할 수 있습니다."
        actionLabel="생성하러 가기"
        onAction={goCreate}
      />
    );
  }

  return (
    <div className="sf-review-view space-y-5">
      <div className="border-b border-[#5A5F5A] pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] tracking-[0.08em] text-[#858585]">
              문제 생성 완료
            </p>
            <h2 className="mt-2 text-xl font-medium text-[#E8E8E8]">
              실제 문제를 먼저 확인하세요
            </h2>
            <p className="mt-2 text-sm text-[#B2B6B1]">
              {editableCards.length}개 문제 · {getLearningActivityMixLabel(editableCards, formMode)}
              {isEditing ? " · 수정 중" : " · 학습 화면에 가깝게 표시 중"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
          <SecondaryButton onClick={() => setIsEditing((current) => !current)}>
            <span className="inline-flex items-center gap-2">
              <Pencil size={15} /> {isEditing ? "미리보기" : "문제 수정"}
            </span>
          </SecondaryButton>
          {isEditing ? <SecondaryButton onClick={addCard}>문제 추가</SecondaryButton> : null}
          <PrimaryButton type="button" onClick={handleSaveDeck}>
            저장하고 학습
          </PrimaryButton>
          </div>
        </div>
      </div>

      <Feedback error={error} notice={notice} />

      <div className="space-y-3">
        {editableCards.map((card, index) => (
          <div key={card.id} id={`review-card-${card.id}`}>
          {isEditing ? <Panel>
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm font-bold text-[#B2B6B1]">
                카드 {index + 1}
              </span>
              <button
                type="button"
                onClick={() => removeCard(card.id)}
                className="rounded-md border border-[#C9372C]/40 px-2 py-1 text-sm font-bold text-[#C9372C] hover:bg-[#C9372C]/10"
              >
                삭제
              </button>
            </div>
            {getLearningActivityType(card) !== "flashcard" ? (
              <GradedActivityReviewFields card={card} updateCard={updateCard} />
            ) : card.type === "flashcard" || card.type === "translation" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label={card.type === "translation" ? "한국어 cue" : "질문"}
                  value={card.front ?? ""}
                  onChange={(value) => updateCard(card.id, { front: value })}
                />
                <TextField
                  label={card.type === "translation" ? "영어 표현" : "답변"}
                  value={card.back ?? ""}
                  onChange={(value) => updateCard(card.id, { back: value })}
                />
              </div>
            ) : (
              <div className="grid gap-3">
                <TextField
                  label="빈칸 문장"
                  value={renderClozeText(card.clozeText ?? "")}
                  onChange={(value) => updateCard(card.id, { clozeText: value })}
                />
                <TextField
                  label="정답"
                  value={formatAnswersForEdit(card)}
                  onChange={(value) =>
                    updateCard(card.id, {
                      answer: splitAnswerText(value).join(", "),
                      answers: splitAnswerText(value),
                    })
                  }
                />
              </div>
            )}
            <details className="mt-3 rounded-md border border-[#393D3A] bg-[#242725] p-3">
              <summary className="cursor-pointer text-xs font-bold text-[#B2B6B1]">
                보조 정보: 힌트, 근거, 출처, 품질
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <TextField
                  label="힌트"
                  value={card.hint ?? ""}
                  onChange={(value) => updateCard(card.id, { hint: value })}
                />
                <TextField
                  label="근거"
                  value={card.basis ?? ""}
                  onChange={(value) => updateCard(card.id, { basis: value })}
                />
                <TextField
                  label="정답 판단 근거"
                  value={card.explanation ?? ""}
                  onChange={(value) => updateCard(card.id, { explanation: value })}
                />
              </div>
              <div className="mt-3 grid gap-2 rounded-md bg-[#222523] p-3 text-xs leading-5 text-[#B2B6B1] sm:grid-cols-2">
                <p>
                  <span className="font-black text-[#F0F2EF]">지식 단위: </span>
                  {card.learningUnitId || "직접 추가한 카드"}
                </p>
                <p>
                  <span className="font-black text-[#F0F2EF]">카드 전략: </span>
                  {getCardStrategyLabel(card.strategy)}
                </p>
                <p>
                  <span className="font-black text-[#F0F2EF]">출처: </span>
                  {formatCardSource(card)}
                </p>
                <p>
                  <span className="font-black text-[#F0F2EF]">난이도: </span>
                  {card.difficulty ? `${card.difficulty}/5` : "미평가"}
                </p>
                <p className="sm:col-span-2">
                  <span className="font-black text-[#F0F2EF]">설계 이유: </span>
                  {card.rationale || "없음"}
                </p>
                <p className="sm:col-span-2">
                  <span className="font-black text-[#F0F2EF]">품질 검사: </span>
                  {card.qualityPassed === undefined
                    ? "미검사"
                    : card.qualityPassed
                      ? "통과"
                      : "확인 필요"}
                  {card.qualityNotes?.length
                    ? ` · ${card.qualityNotes.join(" / ")}`
                    : ""}
                </p>
              </div>
            </details>
          </Panel> : <LearningActivityPreview card={card} index={index} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function LearningActivityPreview({ card, index }: { card: Card; index: number }) {
  const type = getLearningActivityType(card);
  const structureLabels = (card.structureNodes ?? []).map((node) => node.correctLabel);
  const structureChoices = getStructureRecallChoices(
    card.structureNodes ?? [],
    "preview",
    card.id,
  );

  return (
    <article className="rounded-[12px] border border-[#303030] bg-[#1E1E1E] px-5 py-5 shadow-[0_8px_24px_rgba(0,0,0,0.12)] sm:px-6">
      <div className="flex items-center justify-between gap-3 border-b border-[#303030] pb-3">
        <span className="text-xs font-black text-[#A6AAA5]">문제 {index + 1}</span>
        <span className="text-xs font-black text-[#ECEEEB]">
          {getLearningActivityLabel(type)}
        </span>
      </div>
      <p className="mt-5 text-base font-medium leading-7 text-[#E8E8E8]">
        {card.front || (card.type === "cloze" ? renderClozeText(card.clozeText ?? "") : "질문 없음")}
      </p>

      {type === "true_false" ? (
        <div className="mt-5 grid grid-cols-2 gap-2">
          <span className="rounded-[9px] border border-[#393939] px-4 py-3 text-center text-[#B5B5B5]">O</span>
          <span className="rounded-[9px] border border-[#393939] px-4 py-3 text-center text-[#B5B5B5]">X</span>
        </div>
      ) : null}
      {type === "cloze" ? (
        <div className="mt-5 rounded-[9px] border border-[#393939] bg-[#222222] px-4 py-3 text-sm text-[#B5B5B5]">
          {card.clozeText ?? card.front}
        </div>
      ) : null}
      {type === "multiple_choice" ? (
        <ol className="mt-5 grid gap-2 sm:grid-cols-2">
          {(card.options ?? []).map((option, optionIndex) => (
            <li key={`${option}-${optionIndex}`} className="rounded-[9px] border border-[#393939] bg-[#222222] px-4 py-3 text-sm text-[#B5B5B5]">
              <span className="mr-2 font-black text-[#A6AAA5]">{optionIndex + 1}</span>{option}
            </li>
          ))}
        </ol>
      ) : null}
      {type === "structure_recall" ? (
        <div className="mt-5 space-y-2">
          {structureLabels.map((_, nodeIndex) => (
            <div key={nodeIndex} className="border-b-2 border-dashed border-[#5A5F5A] px-3 py-3 text-sm font-bold text-[#898E89]">
              빈칸 {nodeIndex + 1}
            </div>
          ))}
          {getStructureRecallMode(card) === "word_bank" ? (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-[#E2E0D8] pt-4">
              {structureChoices.map((label, choiceIndex) => (
                <span key={`${label}-${choiceIndex}`} className="border border-[#3B3F3C] bg-[#242725] px-3 py-2 text-xs font-bold text-[#B2B6B1]">{label}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <details className="mt-5 border-t border-[#E2E0D8] pt-4">
        <summary className="cursor-pointer text-xs font-medium text-[#858585]">정답 미리보기</summary>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#D1D4D0]">
          {card.back || card.answer || structureLabels.join(" → ") || "저장된 정답이 없습니다."}
        </p>
      </details>
    </article>
  );
}

function GradedActivityReviewFields({
  card,
  updateCard,
}: {
  card: Card;
  updateCard: (id: string, patch: Partial<Card>) => void;
}) {
  const type = getLearningActivityType(card);
  const issues = validateLearningActivity(card);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-full bg-[#2D312E] px-3 py-1 text-xs font-black text-[#ECEEEB]">
          {getLearningActivityLabel(type)}
        </span>
        {card.recommendationReason ? (
          <span className="text-xs text-[#B2B6B1]">추천 이유: {card.recommendationReason}</span>
        ) : null}
      </div>
      <TextField
        label={type === "cloze" ? "빈칸 문장" : "문제"}
        value={type === "cloze" ? (card.clozeText ?? card.front ?? "") : (card.front ?? "")}
        onChange={(value) => updateCard(card.id, type === "cloze"
          ? { front: value, clozeText: value }
          : { front: value })}
      />
      {type === "cloze" ? (
        <TextField
          label="빈칸 정답"
          value={card.answer ?? ""}
          onChange={(value) => updateCard(card.id, { answer: value, answers: [value], back: value })}
        />
      ) : null}
      {type === "true_false" ? (
        <div>
          <FieldLabel>정답</FieldLabel>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[true, false].map((value) => (
              <button
                key={String(value)}
                type="button"
                onClick={() =>
                  updateCard(card.id, {
                    correctBoolean: value,
                    back: value ? "O" : "X",
                  })
                }
                className={`rounded-md border p-3 font-black ${
                  card.correctBoolean === value
                    ? "border-[#ECEEEB] bg-[#2D312E]"
                    : "border-[#393D3A]"
                }`}
              >
                {value ? "O" : "X"}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {type === "multiple_choice" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="선택지 — 줄바꿈으로 구분"
            value={(card.options ?? []).join("\n")}
            onChange={(value) =>
              updateCard(card.id, {
                options: value.split("\n").map((item) => item.trim()).filter(Boolean),
              })
            }
          />
          <label>
            <FieldLabel>정답 선택지</FieldLabel>
            <select
              value={card.correctOptionIndex ?? 0}
              onChange={(event) => {
                const index = Number(event.target.value);
                updateCard(card.id, {
                  correctOptionIndex: index,
                  back: card.options?.[index] ?? "",
                });
              }}
              className={`${inputClassName} mt-1`}
            >
              {(card.options ?? []).map((option, index) => (
                <option key={`${option}-${index}`} value={index}>
                  {index + 1}. {option}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {type === "structure_recall" ? (
        <div>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <FieldLabel>복원 대상</FieldLabel>
            <select
              value={getStructureRecallKind(card)}
              onChange={(event) =>
                updateCard(card.id, {
                  structureRecallKind: event.target.value as "sequence" | "hierarchy",
                })
              }
              className={`${inputClassName} mt-1`}
            >
              <option value="sequence">순서 복원</option>
              <option value="hierarchy">계층·분류 구조 복원</option>
            </select>
          </label>
          <label className="block">
            <FieldLabel>처음 보여줄 풀이</FieldLabel>
            <select
              value={getStructureRecallMode(card)}
              onChange={(event) => {
                const mode = event.target.value as "word_bank" | "free_input";
                updateCard(card.id, {
                  structureRecallMode: mode,
                  supportedStructureRecallModes: [
                    ...new Set([...getSupportedStructureRecallModes(card), mode]),
                  ],
                });
              }}
              className={`${inputClassName} mt-1`}
            >
              <option value="word_bank">보기에서 고르기</option>
              <option value="free_input">직접 입력하기</option>
            </select>
          </label>
          </div>
          <label className="mb-4 flex items-center gap-2 text-sm font-bold text-[#D1D4D0]">
            <input
              type="checkbox"
              checked={getSupportedStructureRecallModes(card).length === 2}
              onChange={(event) =>
                updateCard(card.id, {
                  supportedStructureRecallModes: event.target.checked
                    ? ["word_bank", "free_input"]
                    : [getStructureRecallMode(card)],
                })
              }
            />
            학습 중 보기형과 직접입력을 바꿀 수 있게 허용
          </label>
          <FieldLabel>구조의 빈자리와 정답 단어</FieldLabel>
          <div className="mt-2 space-y-2">
            {(card.structureNodes ?? []).map((node, index, nodes) => (
              <div
                key={node.id}
                className="grid grid-cols-[80px_1fr] items-center gap-2"
                style={{ marginLeft: `${getStructureNodeDepth(node.id, nodes) * 20}px` }}
              >
                <span className="text-xs font-black text-[#B2B6B1]">자리 {index + 1}</span>
                <input
                  value={node.correctLabel}
                  onChange={(event) =>
                    updateCard(card.id, {
                      structureNodes: nodes.map((item) =>
                        item.id === node.id
                          ? { ...item, correctLabel: event.target.value }
                          : item,
                      ),
                    })
                  }
                  className={inputClassName}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {issues.length > 0 ? (
        <p className="rounded-md bg-[#FFECEB] p-3 text-sm font-bold text-[#AE2E24]">
          {issues.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

function LearningManagerView({
  mode,
  decks,
  sessions,
  attempts,
  loading,
  startStudy,
  goCreate,
}: {
  mode: "today" | "records";
  decks: Deck[];
  sessions: StudySession[];
  attempts: StudyAttempt[];
  loading: boolean;
  startStudy: (deck: Deck) => void;
  goCreate: () => void;
}) {
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const date = new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const snapshot = useMemo(
    () => buildLearningManagerSnapshot(decks, sessions, attempts),
    [decks, sessions, attempts],
  );
  const history = useMemo(
    () => buildLearningHistory(decks, sessions, attempts).slice(0, 20),
    [decks, sessions, attempts],
  );
  const calendar = useMemo(
    () => buildLearningCalendar(decks, attempts, calendarMonth),
    [decks, attempts, calendarMonth],
  );
  const recommendedDeck = decks.find(
    (deck) => deck.id === snapshot.recommendedDeckId,
  );
  const estimatedMinutes = Math.max(3, Math.ceil(snapshot.dueCount * 1.5));
  const dueBreakdown = snapshot.decks
    .filter((item) => item.dueCount > 0)
    .slice(0, 3)
    .map((item) => `${item.title} ${item.dueCount}`)
    .join(" · ");

  if (decks.length === 0) {
    return (
      <EmptyState
        title="관리할 학습자료가 없습니다."
        body="문제를 생성해 덱으로 저장하면 오늘의 복습과 학습 기록을 여기에서 관리할 수 있습니다."
        actionLabel="첫 학습자료 만들기"
        onAction={goCreate}
      />
    );
  }

  return (
    <div className="space-y-5">
      {mode === "today" ? (
        <section className="grid overflow-hidden bg-[#1E211F] text-[#F0F2EF] lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="flex min-h-72 flex-col justify-between border-b border-[#3B413D] p-7 sm:p-9 lg:border-b-0 lg:border-r">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#AEB4AF]">
                오늘 해야 할 한 가지
              </p>
              <h3 className="mt-5 max-w-3xl text-3xl font-black leading-[1.12] tracking-[-0.045em] sm:text-5xl">
                {snapshot.dueCount > 0 ? "예정된 복습을 끝냅니다." : "오늘 복습을 모두 마쳤습니다."}
              </h3>
            </div>
            <p className="mt-8 text-sm font-bold text-[#C8CCC8]">
              {snapshot.dueCount > 0
                ? `약 ${estimatedMinutes}분${dueBreakdown ? ` · ${dueBreakdown}` : ""}`
                : `오늘 ${snapshot.todayCompletedCount}개 완료 · 새 문제 ${snapshot.newCount}개`}
            </p>
          </div>
          <div className="flex min-h-56 flex-col justify-between bg-[#1E211F] p-7 text-white sm:p-9">
            <div>
              <p className="text-sm font-black">오늘 복습</p>
              <strong className="mt-2 block text-7xl font-black tracking-[-0.08em]">
                {snapshot.dueCount}
              </strong>
            </div>
            {recommendedDeck ? (
              <button
                type="button"
                onClick={() => startStudy(recommendedDeck)}
                className="w-full border border-white/70 bg-[#ECEEEB] px-5 py-4 text-left text-sm font-black text-[#202321] transition hover:bg-[#D5D8D4]"
              >
                {snapshot.dueCount > 0 ? "복습 시작 →" : "새 학습 시작 →"}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <Panel className={mode === "records" ? "hidden" : ""}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-[#ECEEEB]">다음 학습 추천</p>
            <h3 className="mt-2 text-xl font-black text-[#F0F2EF]">
              {recommendedDeck?.title ?? "추천할 덱이 없습니다"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-[#B2B6B1]">
              {snapshot.recommendationReason}
            </p>
          </div>
          {recommendedDeck ? (
            <PrimaryButton onClick={() => startStudy(recommendedDeck)}>
              학습 범위 보기
            </PrimaryButton>
          ) : null}
        </div>
      </Panel>

      {mode === "records" ? (
        <>
          <LearningPlanner
            decks={decks}
            sessions={sessions}
            attempts={attempts}
            onStartStudy={startStudy}
          />
          <CollapsibleSessionLog history={history} />
        </>
      ) : null}

      <div className={mode === "today" ? "grid gap-5" : "grid gap-5 lg:grid-cols-[1.4fr_1fr]"}>
        <Panel className={mode === "records" ? "hidden" : ""}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-[#ECEEEB]">덱별 진행 상황</p>
              <h3 className="mt-1 text-lg font-black text-[#F0F2EF]">
                복습이 급한 순서
              </h3>
            </div>
            {loading ? (
              <span className="text-xs font-bold text-[#A6AAA5]">기록 갱신 중</span>
            ) : null}
          </div>
          <div className="mt-5 divide-y divide-[#393D3A]">
            {snapshot.decks.map((deckSummary) => {
              const deck = decks.find((item) => item.id === deckSummary.deckId);
              return (
                <div key={deckSummary.deckId} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-black text-[#F0F2EF]">
                        {deckSummary.title}
                      </p>
                      <p className="mt-1 text-xs text-[#A6AAA5]">
                        {deckSummary.subject || "과목 없음"} · 최근 학습 {formatLastStudiedAt(deckSummary.lastStudiedAt)}
                      </p>
                    </div>
                    {deck ? (
                      <button
                        type="button"
                        onClick={() => startStudy(deck)}
                        className="rounded-md border border-[#393D3A] px-3 py-2 text-xs font-black text-[#ECEEEB] hover:bg-[#2D312E]"
                      >
                        학습
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-[#B2B6B1]">
                    <span className={deckSummary.dueCount > 0 ? "text-[#C9372C]" : ""}>
                      복습 {deckSummary.dueCount}
                    </span>
                    <span>다시 보기 {deckSummary.reviewCount}</span>
                    <span>새 문제 {deckSummary.newCount}</span>
                    <span>누적 풀이 {deckSummary.completedAttemptCount}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-[#393D3A]">
                      <span
                        className="block h-full rounded-full bg-[#22A06B]"
                        style={{ width: `${deckSummary.progressPercent}%` }}
                      />
                    </span>
                    <span className="w-10 text-right text-xs font-black text-[#B2B6B1]">
                      {deckSummary.progressPercent}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel className="hidden">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-[#ECEEEB]">학습 캘린더</p>
              <h3 className="mt-1 text-lg font-black text-[#F0F2EF]">
                {calendar.year}년 {calendar.month}월
              </h3>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                aria-label="이전 달"
                onClick={() =>
                  setCalendarMonth(
                    (current) => new Date(current.getFullYear(), current.getMonth() - 1, 1),
                  )
                }
                className="grid h-9 w-9 place-items-center rounded-md border border-[#393D3A] text-[#B2B6B1] hover:bg-[#222523]"
              >
                <ChevronLeft size={17} />
              </button>
              <button
                type="button"
                aria-label="다음 달"
                onClick={() =>
                  setCalendarMonth(
                    (current) => new Date(current.getFullYear(), current.getMonth() + 1, 1),
                  )
                }
                className="grid h-9 w-9 place-items-center rounded-md border border-[#393D3A] text-[#B2B6B1] hover:bg-[#222523]"
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-7 text-center text-[10px] font-bold text-[#A6AAA5] sm:text-xs">
            {['일', '월', '화', '수', '목', '금', '토'].map((weekday) => (
              <span key={weekday} className="py-1">{weekday}</span>
            ))}
            {Array.from({ length: calendar.firstWeekday }, (_, index) => (
              <span key={`empty-${index}`} aria-hidden="true" />
            ))}
            {calendar.days.map((day) => (
              <div
                key={day.date}
                className={`min-h-14 border-t border-[#393D3A] px-0.5 py-1 text-left sm:min-h-16 sm:px-1 ${
                  day.isToday ? "bg-[#2D312E]" : ""
                }`}
              >
                <span className={`text-[11px] font-black sm:text-xs ${day.isToday ? "text-[#ECEEEB]" : "text-[#F0F2EF]"}`}>
                  {day.dayOfMonth}
                </span>
                {day.completedCount > 0 ? (
                  <span className="mt-1 block truncate rounded bg-[#E3FCEF] px-1 py-0.5 text-[9px] font-bold text-[#216E4E] sm:text-[10px]">
                    학습 {day.completedCount}
                  </span>
                ) : null}
                {day.scheduledReviewCount > 0 ? (
                  <span className="mt-1 block truncate rounded bg-[#FFF7D6] px-1 py-0.5 text-[9px] font-bold text-[#7F5F01] sm:text-[10px]">
                    복습 {day.scheduledReviewCount}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-[11px] font-bold text-[#B2B6B1]">
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded bg-[#E3FCEF]" />실제 학습</span>
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded bg-[#FFF7D6]" />예정 복습</span>
          </div>
        </Panel>
      </div>

      <Panel className="hidden">
        <div>
          <p className="text-sm font-bold text-[#ECEEEB]">학습 기록</p>
          <h3 className="mt-1 text-lg font-black text-[#F0F2EF]">
            최근 학습 세션
          </h3>
        </div>
        {history.length > 0 ? (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#4B4F4B] text-xs text-[#A6AAA5]">
                  <th className="px-2 py-2 font-bold">날짜</th>
                  <th className="px-2 py-2 font-bold">학습자료</th>
                  <th className="px-2 py-2 font-bold">상태</th>
                  <th className="px-2 py-2 text-right font-bold">완료</th>
                  <th className="px-2 py-2 text-right font-bold">기억남·정답</th>
                  <th className="px-2 py-2 text-right font-bold">다시 보기·오답</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#393D3A]">
                {history.map((item) => (
                  <tr key={item.sessionId}>
                    <td className="whitespace-nowrap px-2 py-3 text-xs text-[#B2B6B1]">
                      {formatStudyHistoryDate(item.startedAt)}
                    </td>
                    <td className="max-w-72 truncate px-2 py-3 font-bold text-[#F0F2EF]">
                      {item.deckTitle}
                    </td>
                    <td className="px-2 py-3 text-xs font-bold text-[#B2B6B1]">
                      {getStudySessionStatusLabel(item.status)}
                    </td>
                    <td className="px-2 py-3 text-right font-black text-[#F0F2EF]">
                      {item.completedCount}/{item.plannedCount}
                    </td>
                    <td className="px-2 py-3 text-right font-bold text-[#216E4E]">
                      {item.rememberedCount}
                    </td>
                    <td className="px-2 py-3 text-right font-bold text-[#AE2E24]">
                      {item.reviewCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-5 rounded-md bg-[#222523] p-5 text-center text-sm text-[#A6AAA5]">
            아직 저장된 학습 기록이 없습니다.
          </p>
        )}
        <p className="mt-4 text-xs leading-5 text-[#A6AAA5]">
          카드·문제 학습 세션을 기록합니다.
        </p>
      </Panel>
    </div>
  );
}

function formatLastStudiedAt(value: string | null) {
  if (!value) return "기록 없음";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "기록 없음";
  return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

function formatStudyHistoryDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "날짜 없음";
  return date.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStudySessionStatusLabel(status: StudySession["status"]) {
  return {
    active: "진행 중",
    completed: "완료",
    abandoned: "중단",
  }[status];
}

function DecksView({
  projectsOnly,
  decks,
  sessions,
  attempts,
  createFromProjectSources,
  projectCreationPanel,
  isProjectCreationOpen,
  cancelProjectCreation,
  renamingDeckId,
  renameValue,
  setRenameValue,
  startRename,
  cancelRename,
  saveRename,
  startStudy,
  moveDeck,
  deleteDeck,
  openDetail,
  goCreate,
}: {
  projectsOnly?: boolean;
  decks: Deck[];
  sessions: StudySession[];
  attempts: StudyAttempt[];
  createFromProjectSources: (
    files: File[],
    project: StudyProject,
    cachedAnalysis: PdfAnalysisResponse | null,
  ) => void;
  projectCreationPanel?: ReactNode;
  isProjectCreationOpen?: boolean;
  cancelProjectCreation?: () => void;
  renamingDeckId: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  startRename: (deck: Deck) => void;
  cancelRename: () => void;
  saveRename: (deck: Deck) => Promise<void>;
  startStudy: (deck: Deck) => void;
  moveDeck: (id: string, column: DeckBoardColumn) => void;
  deleteDeck: (id: string) => void;
  openDetail: (deck: Deck) => void;
  goCreate: () => void;
}) {
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [mobileStatusFilter, setMobileStatusFilter] = useState<
    "all" | DeckBoardColumn
  >("all");
  const [layout, setLayout] = useState<"list" | "board">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  if (projectsOnly) {
    return (
      <StudyProjectLibrary
        decks={decks}
        sessions={sessions}
        attempts={attempts}
        onCreateFromSources={createFromProjectSources}
        onStartStudy={startStudy}
        creationPanel={projectCreationPanel}
        isCreationOpen={isProjectCreationOpen}
        onCancelCreation={cancelProjectCreation}
      />
    );
  }

  const activeDeck = decks.find((deck) => deck.id === activeDeckId);
  const mobileDecks = [...decks]
    .filter(
      (deck) =>
        (mobileStatusFilter === "all" || deck.boardColumn === mobileStatusFilter) &&
        `${deck.title} ${deck.subject} ${deck.tags.join(" ")}`
          .toLocaleLowerCase("ko-KR")
          .includes(searchQuery.trim().toLocaleLowerCase("ko-KR")),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDeckId(null);
    const column = event.over?.data.current?.column as
      | DeckBoardColumn
      | undefined;
    if (column) moveDeck(String(event.active.id), column);
  };

  return (
    <div className="space-y-6">
      <StudyProjectLibrary
        decks={decks}
        sessions={sessions}
        attempts={attempts}
        onCreateFromSources={createFromProjectSources}
        onStartStudy={startStudy}
        creationPanel={projectCreationPanel}
        isCreationOpen={isProjectCreationOpen}
        onCancelCreation={cancelProjectCreation}
      />

      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#5A5F5A] pb-5">
        <div>
          <p className="text-sm font-black text-[#F0F2EF]">내 학습자료 {decks.length}개</p>
          <p className="mt-1 text-xs text-[#A6AAA5]">
            생성한 문제와 원문, 학습 기록을 자료별로 보관합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setLayout(layout === "list" ? "board" : "list")} className="border border-[#5A5F5A] px-3 py-2 text-xs font-black text-[#B2B6B1] hover:bg-[#2D312E]">
            {layout === "list" ? "상태 보드 보기" : "목록으로 보기"}
          </button>
          <button
            type="button"
            onClick={goCreate}
            className="inline-flex items-center gap-2 bg-[#ECEEEB] px-4 py-2.5 text-sm font-black text-[#202321] hover:bg-[#D5D8D4]"
          >
            <Plus size={17} />
            새 자료 생성
          </button>
        </div>
      </div>

      {decks.length === 0 ? (
        <EmptyState
          title="아직 생성한 문제가 없습니다."
          body="프로젝트에서 PDF를 선택해 문제를 만들거나 새 자료를 바로 생성하세요."
          actionLabel="새 자료 생성"
          onAction={goCreate}
        />
      ) : null}

      <div className={layout === "list" && decks.length > 0 ? "space-y-4" : "hidden"}>
        <div className="grid gap-3 border-y border-[#3B3F3C] py-3 sm:grid-cols-[minmax(0,1fr)_200px]">
          <label className="block">
            <span className="sr-only">학습자료 검색</span>
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="자료명, 과목, 태그 검색" className="w-full border-0 bg-transparent px-2 py-2 text-sm text-[#F0F2EF] outline-none placeholder:text-[#898E89]" />
          </label>
          <label className="block">
          <span className="sr-only">진행 상태</span>
          <select
            value={mobileStatusFilter}
            onChange={(event) =>
              setMobileStatusFilter(
                event.target.value as "all" | DeckBoardColumn,
              )
            }
            className="w-full border-0 border-l border-[#3B3F3C] bg-transparent px-3 py-2 text-sm font-bold text-[#B2B6B1] outline-none"
          >
            <option value="all">전체 덱 ({decks.length})</option>
            {deckBoardColumns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.title} ({decks.filter((deck) => deck.boardColumn === column.id).length})
              </option>
            ))}
          </select>
          </label>
        </div>

        <div className="border-t-2 border-[#F0F2EF]">
          <CompactDeckList
            decks={mobileDecks}
            onStartStudy={startStudy}
            onOpenDetail={openDetail}
            onRename={startRename}
            onDelete={deleteDeck}
            onChangeStatus={moveDeck}
            renamingDeckId={renamingDeckId}
            renameValue={renameValue}
            onRenameValueChange={setRenameValue}
            onSaveRename={saveRename}
            onCancelRename={cancelRename}
          />
          {mobileDecks.length === 0 ? (
            <p className="border border-dashed border-[#5A5F5A] bg-[#242725] p-8 text-center text-sm text-[#A6AAA5]">
              이 상태에 해당하는 덱이 없습니다.
            </p>
          ) : null}
        </div>
      </div>

      <div className={layout === "board" && decks.length > 0 ? "block" : "hidden"}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(event) => setActiveDeckId(String(event.active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDeckId(null)}
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {deckBoardColumns.map((column) => (
            <DeckBoardList
              key={column.id}
              column={column}
              decks={decks.filter((deck) => deck.boardColumn === column.id)}
              renamingDeckId={renamingDeckId}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              startRename={startRename}
              cancelRename={cancelRename}
              saveRename={saveRename}
              startStudy={startStudy}
              deleteDeck={deleteDeck}
              openDetail={openDetail}
            />
          ))}
        </div>
        <DragOverlay>
          {activeDeck ? <DeckCardPreview deck={activeDeck} /> : null}
        </DragOverlay>
      </DndContext>
      </div>
    </div>
  );
}

const deckBoardColumns: Array<{
  id: DeckBoardColumn;
  title: string;
  description: string;
  accent: string;
}> = [
  {
    id: "new",
    title: "새 덱",
    description: "아직 학습을 시작하지 않은 덱",
    accent: "bg-[#ECEEEB]",
  },
  {
    id: "learning",
    title: "학습 중",
    description: "현재 인출 연습을 진행하는 덱",
    accent: "bg-[#E2B203]",
  },
  {
    id: "completed",
    title: "완료",
    description: "모든 카드를 알고 있는 덱",
    accent: "bg-[#22A06B]",
  },
];

function DeckBoardList({
  column,
  decks,
  renamingDeckId,
  renameValue,
  setRenameValue,
  startRename,
  cancelRename,
  saveRename,
  startStudy,
  deleteDeck,
  openDetail,
}: {
  column: (typeof deckBoardColumns)[number];
  decks: Deck[];
  renamingDeckId: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  startRename: (deck: Deck) => void;
  cancelRename: () => void;
  saveRename: (deck: Deck) => Promise<void>;
  startStudy: (deck: Deck) => void;
  deleteDeck: (id: string) => void;
  openDetail: (deck: Deck) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `deck-column-${column.id}`,
    data: { column: column.id },
  });
  const orderedDecks = [...decks].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );

  return (
    <section
      ref={setNodeRef}
      className={`min-h-[32rem] rounded-lg border bg-[#222523] p-3 transition-colors ${
        isOver ? "border-[#AEB2AD] bg-[#2D312E]" : "border-[#393D3A]"
      }`}
    >
      <header className="mb-3 flex items-start justify-between gap-3 px-1 py-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${column.accent}`} />
            <h3 className="font-black text-[#F0F2EF]">{column.title}</h3>
            <span className="rounded-full bg-[#222523] px-2 py-0.5 text-xs font-bold text-[#B2B6B1]">
              {decks.length}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-[#A6AAA5]">
            {column.description}
          </p>
        </div>
      </header>

      <div className="space-y-3">
        {orderedDecks.map((deck) => (
          <DeckBoardCard
            key={deck.id}
            deck={deck}
            renaming={renamingDeckId === deck.id}
            renameValue={renameValue}
            setRenameValue={setRenameValue}
            startRename={startRename}
            cancelRename={cancelRename}
            saveRename={saveRename}
            startStudy={startStudy}
            deleteDeck={deleteDeck}
            openDetail={openDetail}
          />
        ))}
        {orderedDecks.length === 0 ? (
          <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed border-[#4B4F4B] px-4 text-center text-xs leading-5 text-[#A5A9A4]">
            덱 카드를 이 열로 옮길 수 있습니다.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DeckBoardCard({
  deck,
  renaming,
  renameValue,
  setRenameValue,
  startRename,
  cancelRename,
  saveRename,
  startStudy,
  deleteDeck,
  openDetail,
  draggable = true,
}: {
  deck: Deck;
  renaming: boolean;
  renameValue: string;
  setRenameValue: (value: string) => void;
  startRename: (deck: Deck) => void;
  cancelRename: () => void;
  saveRename: (deck: Deck) => Promise<void>;
  startStudy: (deck: Deck) => void;
  deleteDeck: (id: string) => void;
  openDetail: (deck: Deck) => void;
  draggable?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: deck.id, disabled: !draggable });
  const knownCount = deck.cards.filter((card) => card.status === "known").length;
  const dueCount = countDueReviews(deck.cards);
  const progress =
    deck.cards.length === 0
      ? 0
      : Math.round((knownCount / deck.cards.length) * 100);

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`${draggable ? "rounded-md border border-[#3B3F3C] bg-[#242725] shadow-sm" : "border-0 bg-transparent"} transition ${
        isDragging ? "opacity-30" : draggable ? "hover:border-[#5A5F5A] hover:shadow-md" : ""
      }`}
    >
      <div className={`flex items-start gap-1 ${draggable ? "p-2 pb-0" : "p-0"}`}>
        {draggable ? (
          <button
            type="button"
            className="mt-0.5 flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded text-[#A5A9A4] hover:bg-[#2D312E] hover:text-[#F0F2EF] active:cursor-grabbing"
            aria-label={`${deck.title} 이동`}
            title="드래그하여 이동"
            {...attributes}
            {...listeners}
          >
            <GripVertical size={17} />
          </button>
        ) : null}
        {renaming ? (
          <div className="min-w-0 flex-1 space-y-2 pb-2">
            <input
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              className={inputClassName}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveRename(deck);
                if (event.key === "Escape") cancelRename();
              }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void saveRename(deck)}
                className="rounded bg-[#ECEEEB] px-3 py-1.5 text-xs font-black text-[#202321]"
              >
                저장
              </button>
              <button
                type="button"
                onClick={cancelRename}
                className="rounded px-3 py-1.5 text-xs font-bold text-[#B2B6B1] hover:bg-[#2D312E]"
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => startStudy(deck)}
            className={`min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ECEEEB] ${draggable ? "rounded px-1 pb-3" : "py-1"}`}
          >
            <span className={`block truncate font-black text-[#F0F2EF] ${draggable ? "text-sm" : "text-base"}`}>
              {deck.title}
            </span>
            <span className="mt-1 block truncate text-xs text-[#B2B6B1]">
              {deck.subject || "과목 없음"} · {getLearningActivityMixLabel(deck.cards, deck.mode)}
            </span>
            <span className="mt-3 flex items-center justify-between text-[11px] font-bold text-[#A6AAA5]">
              <span>{deck.cards.length}개 카드</span>
              <span>{dueCount > 0 ? `오늘 복습 ${dueCount}개` : `${progress}%`}</span>
            </span>
            <span className="mt-1.5 block h-1 overflow-hidden bg-[#3B3F3C]">
              <span
                className="block h-full bg-[#ECEEEB] transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </span>
          </button>
        )}
      </div>

      {!renaming ? (
        <footer className={`flex items-center justify-between ${draggable ? "border-t border-[#3B3F3C] px-2 py-1.5" : "mt-2"}`}>
          <span className="px-1 text-[11px] text-[#A5A9A4]">
            {new Date(deck.updatedAt).toLocaleDateString("ko-KR")}
          </span>
          <div className="flex items-center gap-0.5">
            <DeckActionButton label="학습 시작" onClick={() => startStudy(deck)}>
              <BookOpen size={15} />
            </DeckActionButton>
            <DeckActionButton label="상세 정보" onClick={() => openDetail(deck)}>
              <Info size={15} />
            </DeckActionButton>
            <DeckActionButton label="이름 수정" onClick={() => startRename(deck)}>
              <Pencil size={15} />
            </DeckActionButton>
            <DeckActionButton label="삭제" danger onClick={() => deleteDeck(deck.id)}>
              <Trash2 size={15} />
            </DeckActionButton>
          </div>
        </footer>
      ) : null}
    </article>
  );
}

function DeckActionButton({
  label,
  danger = false,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded ${
        danger
          ? "text-[#B2B6B1] hover:bg-[#FFECEB] hover:text-[#F87171]"
          : "text-[#A6AAA5] hover:bg-[#2D312E] hover:text-[#F0F2EF]"
      }`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function DeckCardPreview({ deck }: { deck: Deck }) {
  return (
    <div className="w-72 rounded-md border border-[#AEB2AD] bg-[#2A2E2B] p-4 shadow-2xl">
      <p className="truncate text-sm font-black text-[#F0F2EF]">{deck.title}</p>
      <p className="mt-1 text-xs text-[#B2B6B1]">
        {deck.cards.length}개 카드 · {deck.subject || "과목 없음"}
      </p>
    </div>
  );
}

function StudyView({
  selectedDeck,
  error,
  currentStudyCard,
  studyIndex,
  plannedItemCount,
  sessionId,
  sessionCounts,
  completion,
  isAnswerVisible,
  gradedUserAnswer,
  gradedResult,
  isSaving,
  setGradedUserAnswer,
  submitGradedAnswer,
  advanceAfterGradedAnswer,
  toggleAnswer,
  markCard,
  closeStudy,
  startNewSession,
  retryReviewed,
}: {
  selectedDeck: Deck | null;
  error: string;
  currentStudyCard: Card | undefined;
  studyIndex: number;
  plannedItemCount: number;
  sessionId: string;
  sessionCounts: { known: number; review: number };
  completion: StudyCompletionSummary | null;
  isAnswerVisible: boolean;
  gradedUserAnswer: StudyAnswer;
  gradedResult: boolean | null;
  isSaving: boolean;
  setGradedUserAnswer: (answer: StudyAnswer) => void;
  submitGradedAnswer: () => void;
  advanceAfterGradedAnswer: () => void;
  toggleAnswer: () => void;
  markCard: (status: "known" | "review") => Promise<void>;
  closeStudy: () => void;
  startNewSession: (mode: StudySelectionMode, randomCount?: number) => void;
  retryReviewed: () => void;
}) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRetryMenuOpen, setIsRetryMenuOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState<StudySelectionMode>("all");
  const [randomCount, setRandomCount] = useState(
    Math.min(5, selectedDeck?.cards.length ?? 0),
  );

  const cardCount = selectedDeck?.cards.length ?? 0;
  const dueCount = selectedDeck ? countDueReviews(selectedDeck.cards) : 0;
  const reviewCount = selectedDeck?.cards.filter((card) => card.status === "review").length ?? 0;
  const newCount = selectedDeck?.cards.filter((card) => card.status === "new").length ?? 0;
  const selectedCount = selectionMode === "all"
    ? cardCount
    : selectionMode === "random"
      ? randomCount
      : selectionMode === "due"
        ? dueCount
        : selectionMode === "review_only"
          ? reviewCount
          : newCount;
  const isGraded = currentStudyCard
    ? isAutomaticallyGradedActivity(currentStudyCard)
    : false;
  const progress = completion
    ? 100
    : plannedItemCount > 0
      ? Math.min(100, ((studyIndex + 1) / plannedItemCount) * 100)
      : 0;

  const scopeOptions: Array<{
    mode: StudySelectionMode;
    label: string;
    count: number;
  }> = [
    { mode: "all", label: "전체", count: cardCount },
    { mode: "due", label: "오늘 복습", count: dueCount },
    { mode: "review_only", label: "모르는 것만", count: reviewCount },
    { mode: "new_only", label: "새 문제만", count: newCount },
    { mode: "random", label: "랜덤", count: randomCount },
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-3 backdrop-blur-[2px] sm:p-5">
      <section className="relative flex h-[min(760px,calc(100vh-24px))] w-[min(920px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-[#3B3B3B] bg-[#1B1B1B] shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="grid min-h-16 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center border-b border-[#303030] px-4 sm:px-5">
            <div className="min-w-0">
              <p className="text-[10px] text-[#767676]">
                {completion
                  ? `${completion.completedItemCount} / ${completion.completedItemCount}`
                  : `${Math.min(studyIndex + 1, plannedItemCount)} / ${plannedItemCount}`}
              </p>
              <h3 className="mt-0.5 truncate text-sm font-medium text-[#E8E8E8]">
                {selectedDeck?.title ?? "학습"}
              </h3>
            </div>
            <div className="flex items-center gap-1">
              {selectedDeck ? (
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen((open) => !open)}
                  aria-label="학습 설정"
                  aria-pressed={isSettingsOpen}
                  className="grid h-9 w-9 place-items-center rounded-[9px] text-[#767676] transition hover:bg-[#282828] hover:text-[#E8E8E8]"
                >
                  <Settings2 size={16} />
                </button>
              ) : null}
              <button
                type="button"
                onClick={closeStudy}
                aria-label="학습 창 닫기"
                className="grid h-9 w-9 place-items-center rounded-[9px] text-[#767676] transition hover:bg-[#282828] hover:text-[#E8E8E8]"
              >
                <X size={17} />
              </button>
            </div>
          </header>

          <div className="h-0.5 shrink-0 bg-[#292929]">
            <div className="h-full bg-[#E7E7E7] transition-[width]" style={{ width: `${progress}%` }} />
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {error ? <div className="px-5 pt-4"><Feedback error={error} notice="" /></div> : null}

            {selectedDeck && completion ? (
              <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
                <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-[#E7E7E7] text-[#171717]">
                  <Check size={18} />
                </span>
                <h4 className="mt-5 text-2xl font-medium text-[#E8E8E8]">오늘 학습 완료</h4>
                <p className="mt-2 text-xs text-[#858585]">진행 내용은 자동으로 저장됐습니다.</p>
                <dl className="mt-8 flex justify-center gap-8 sm:gap-12">
                  <StudyCompletionItem label="학습" value={completion.completedItemCount} />
                  <StudyCompletionItem label="알고 있음" value={completion.knownCount} />
                  <StudyCompletionItem label="다시 보기" value={completion.reviewCount} />
                </dl>
                <div className="mt-9 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={closeStudy}
                    className="min-h-11 rounded-[11px] border border-[#3B3B3B] bg-[#202020] px-5 text-xs font-medium text-[#B5B5B5]"
                  >
                    닫기
                  </button>
                  <div className="relative">
                    {isRetryMenuOpen ? (
                      <div className="absolute bottom-[calc(100%+8px)] right-0 z-10 w-52 overflow-hidden rounded-[11px] border border-[#3B3B3B] bg-[#202020] p-1.5 text-left shadow-[0_16px_44px_rgba(0,0,0,0.42)]">
                        {completion.reviewCount > 0 ? (
                          <StudyRetryOption
                            label="모르겠음만"
                            count={completion.reviewCount}
                            onClick={() => {
                              setIsRetryMenuOpen(false);
                              retryReviewed();
                            }}
                          />
                        ) : null}
                        <StudyRetryOption
                          label="오늘 복습"
                          count={dueCount}
                          disabled={dueCount === 0}
                          onClick={() => {
                            setIsRetryMenuOpen(false);
                            startNewSession("due");
                          }}
                        />
                        <StudyRetryOption
                          label="전체"
                          count={cardCount}
                          onClick={() => {
                            setIsRetryMenuOpen(false);
                            startNewSession("all");
                          }}
                        />
                        <StudyRetryOption
                          label="랜덤"
                          count={Math.min(5, cardCount)}
                          onClick={() => {
                            setIsRetryMenuOpen(false);
                            startNewSession("random", Math.min(5, cardCount));
                          }}
                        />
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setIsRetryMenuOpen((open) => !open)}
                      aria-expanded={isRetryMenuOpen}
                      className="inline-flex min-h-11 items-center gap-2 rounded-[11px] bg-[#E7E7E7] px-5 text-xs font-medium text-[#171717]"
                    >
                      다시 학습 <ChevronDown size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ) : selectedDeck && currentStudyCard ? (
              <>
                <div className="flex flex-1 flex-col justify-center px-6 py-8 sm:px-12">
                  <div className="mb-6 flex items-center justify-between gap-3 text-[11px] text-[#767676]">
                    <span className="text-[#B5B5B5]">
                      {isGraded
                        ? getLearningActivityLabel(getLearningActivityType(currentStudyCard))
                        : getStudyPromptLabel(currentStudyCard.type)}
                    </span>
                    <span>정답 {sessionCounts.known} · 다시 보기 {sessionCounts.review}</span>
                  </div>

                  {isGraded ? (
                    <GradedActivityInput
                      key={currentStudyCard.id}
                      card={currentStudyCard}
                      userAnswer={gradedUserAnswer}
                      result={gradedResult}
                      sessionId={sessionId}
                      onAnswer={setGradedUserAnswer}
                    />
                  ) : (
                    <div>
                      <div className="text-2xl font-medium leading-10 text-[#E8E8E8] sm:text-[28px]">
                        {currentStudyCard.type === "flashcard" || currentStudyCard.type === "translation"
                          ? currentStudyCard.front
                          : renderClozeForStudy(currentStudyCard, isAnswerVisible)}
                      </div>
                      {isAnswerVisible && currentStudyCard.type !== "cloze" ? (
                        <div className="mt-8 border-t border-[#303030] pt-6">
                          <p className="text-[11px] text-[#767676]">
                            {currentStudyCard.type === "translation" ? "영어 표현" : "답"}
                          </p>
                          <p className="mt-2 text-lg leading-8 text-[#B5B5B5]">{currentStudyCard.back}</p>
                          {currentStudyCard.hint ? (
                            <p className="mt-2 text-xs text-[#858585]">힌트: {currentStudyCard.hint}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                <footer className="shrink-0 border-t border-[#303030] p-3.5 sm:px-5">
                  {isGraded ? (
                    <button
                      type="button"
                      disabled={
                        isSaving ||
                        (gradedResult === null && !isCompleteGradedAnswer(currentStudyCard, gradedUserAnswer))
                      }
                      onClick={gradedResult === null ? submitGradedAnswer : advanceAfterGradedAnswer}
                      className="min-h-11 w-full rounded-[11px] bg-[#E7E7E7] px-4 text-sm font-medium text-[#171717] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {gradedResult === null ? "정답 확인" : "다음 문제"}
                    </button>
                  ) : isAnswerVisible ? (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => void markCard("review")}
                        disabled={isSaving}
                        className="min-h-11 rounded-[11px] border border-[#3B3B3B] bg-[#202020] px-4 text-sm font-medium text-[#B5B5B5] disabled:opacity-40"
                      >
                        다시 보기
                      </button>
                      <button
                        type="button"
                        onClick={() => void markCard("known")}
                        disabled={isSaving}
                        className="min-h-11 rounded-[11px] bg-[#E7E7E7] px-4 text-sm font-medium text-[#171717] disabled:opacity-40"
                      >
                        알고 있음
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={toggleAnswer}
                      className="min-h-11 w-full rounded-[11px] bg-[#E7E7E7] px-4 text-sm font-medium text-[#171717]"
                    >
                      답 보기
                    </button>
                  )}
                </footer>
              </>
            ) : (
              <div className="grid flex-1 place-items-center px-6 text-center">
                <div>
                  <p className="text-sm font-medium text-[#E8E8E8]">학습할 문제가 없습니다.</p>
                  <button type="button" onClick={closeStudy} className="mt-4 text-xs text-[#B5B5B5] underline underline-offset-4">닫기</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {isSettingsOpen && selectedDeck ? (
          <aside className="absolute inset-y-0 right-0 z-20 flex w-[min(300px,calc(100%-44px))] flex-col border-l border-[#303030] bg-[#202020] shadow-[-18px_0_50px_rgba(0,0,0,0.45)] sm:relative sm:w-[300px] sm:shrink-0 sm:shadow-none">
            <header className="flex min-h-16 items-center justify-between border-b border-[#303030] px-4">
              <h4 className="text-sm font-medium text-[#E8E8E8]">학습 설정</h4>
              <button type="button" onClick={() => setIsSettingsOpen(false)} aria-label="설정 닫기" className="grid h-9 w-9 place-items-center rounded-[9px] text-[#767676] hover:bg-[#282828] hover:text-[#E8E8E8]"><X size={16} /></button>
            </header>
            <div className="flex-1 overflow-y-auto p-4">
              <p className="mb-2 text-[11px] text-[#B5B5B5]">학습 범위</p>
              <div className="space-y-1" role="radiogroup" aria-label="학습 범위">
                {scopeOptions.map((option) => {
                  const selected = option.mode === selectionMode;
                  const disabled = option.count === 0;
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={disabled}
                      onClick={() => setSelectionMode(option.mode)}
                      className={`grid min-h-11 w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-[10px] border px-2.5 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-35 ${selected ? "border-[#3B3B3B] bg-[#282828] text-[#E8E8E8]" : "border-transparent text-[#B5B5B5] hover:bg-[#282828]"}`}
                    >
                      <span className={`grid h-4 w-4 place-items-center rounded-full border ${selected ? "border-[#E7E7E7]" : "border-[#555555]"}`}>
                        {selected ? <span className="h-2 w-2 rounded-full bg-[#E7E7E7]" /> : null}
                      </span>
                      <span>{option.label}</span>
                      <span className="text-[10px] text-[#767676]">{option.count}개</span>
                    </button>
                  );
                })}
              </div>
              {selectionMode === "random" ? (
                <label className="mt-4 flex items-center justify-between border-t border-[#303030] pt-4 text-xs text-[#B5B5B5]">
                  문제 수
                  <input
                    type="number"
                    min={1}
                    max={cardCount}
                    value={randomCount}
                    onChange={(event) => setRandomCount(Math.min(cardCount, Math.max(1, Number(event.target.value) || 1)))}
                    className="h-9 w-20 rounded-[9px] border border-[#3B3B3B] bg-[#1B1B1B] px-2 text-[#E8E8E8] outline-none"
                  />
                </label>
              ) : null}
            </div>
            <div className="border-t border-[#303030] p-3.5">
              <button
                type="button"
                disabled={selectedCount === 0 || isSaving}
                onClick={() => {
                  setIsSettingsOpen(false);
                  startNewSession(selectionMode, randomCount);
                }}
                className="min-h-11 w-full rounded-[11px] bg-[#E7E7E7] px-4 text-sm font-medium text-[#171717] disabled:cursor-not-allowed disabled:opacity-40"
              >
                이 범위로 시작
              </button>
            </div>
          </aside>
        ) : null}
      </section>
    </div>
  );
}

function StudyCompletionItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-16">
      <dd className="text-2xl font-medium text-[#E8E8E8]">{value}</dd>
      <dt className="mt-1 text-[10px] text-[#767676]">{label}</dt>
    </div>
  );
}

function StudyRetryOption({
  label,
  count,
  disabled = false,
  onClick,
}: {
  label: string;
  count: number;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[8px] px-2.5 text-left text-xs text-[#B5B5B5] transition hover:bg-[#282828] hover:text-[#E8E8E8] disabled:cursor-not-allowed disabled:opacity-35"
    >
      <span>{label}</span>
      <span className="text-[10px] text-[#767676]">{count}개</span>
    </button>
  );
}

function GradedActivityInput({
  card,
  userAnswer,
  result,
  sessionId,
  onAnswer,
}: {
  card: Card;
  userAnswer: StudyAnswer;
  result: boolean | null;
  sessionId: string;
  onAnswer: (answer: StudyAnswer) => void;
}) {
  const type = getLearningActivityType(card);
  const supportedStructureModes = getSupportedStructureRecallModes(card);
  const [structureMode, setStructureMode] = useState(getStudyStructureRecallMode(card));
  const [activeStructureNodeId, setActiveStructureNodeId] = useState<string | null>(null);
  const answerRecord = asStudyAnswerRecord(userAnswer);
  const structureChoices = type === "structure_recall"
    ? getStructureRecallChoices(card.structureNodes ?? [], sessionId, card.id)
    : [];
  const usedStructureChoiceCounts = new Map<string, number>();
  for (const answer of Object.values(answerRecord)) {
    if (typeof answer !== "string" || !answer) continue;
    usedStructureChoiceCounts.set(answer, (usedStructureChoiceCounts.get(answer) ?? 0) + 1);
  }
  const usedStructureChoiceIndexes = new Set<number>();
  for (let index = 0; index < structureChoices.length; index += 1) {
    const choice = structureChoices[index];
    const remaining = usedStructureChoiceCounts.get(choice) ?? 0;
    if (remaining <= 0) continue;
    usedStructureChoiceIndexes.add(index);
    usedStructureChoiceCounts.set(choice, remaining - 1);
  }
  return (
    <div className="mt-8">
      <p className="text-2xl font-black leading-10 text-[#F0F2EF]">{card.front}</p>

      {type === "true_false" ? (
        <div className="mt-6 grid grid-cols-2 gap-3">
          {[true, false].map((value) => (
            <button
              key={String(value)}
              type="button"
              disabled={result !== null}
              onClick={() => onAnswer(value)}
              className={`rounded-lg border px-4 py-6 text-2xl font-black ${
                userAnswer === value
                  ? "border-[#ECEEEB] bg-[#2D312E] text-[#ECEEEB]"
                  : "border-[#393D3A] bg-[#2A2E2B] text-[#F0F2EF]"
              } disabled:cursor-default`}
            >
              {value ? "O" : "X"}
            </button>
          ))}
        </div>
      ) : null}

      {type === "multiple_choice" ? (
        <div className="mt-6 space-y-2">
          {(card.options ?? []).map((option, index) => (
            <button
              key={`${option}-${index}`}
              type="button"
              disabled={result !== null}
              onClick={() => onAnswer(index)}
              className={`block w-full rounded-md border p-3 text-left font-bold ${
                userAnswer === index
                  ? "border-[#ECEEEB] bg-[#2D312E]"
                  : "border-[#393D3A] bg-[#2A2E2B]"
              } disabled:cursor-default`}
            >
              {index + 1}. {option}
            </button>
          ))}
        </div>
      ) : null}

      {type === "cloze" ? (
        <input
          aria-label="빈칸 정답"
          disabled={result !== null}
          value={typeof userAnswer === "string" ? userAnswer : ""}
          placeholder="정답 입력"
          onChange={(event) => onAnswer(event.target.value)}
          className={`${inputClassName} mt-6 min-h-12 text-base font-bold`}
        />
      ) : null}

      {type === "structure_recall" ? (
        <div className="mt-6 rounded-lg border border-[#393D3A] bg-[#202321] p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-xs font-black text-[#B2B6B1]">
              {getStructureRecallKind(card) === "sequence" ? "순서 복원" : "계층·분류 구조 복원"}
            </p>
            {supportedStructureModes.length > 1 && result === null ? (
              <div className="flex rounded-md border border-[#454945] p-0.5">
                {supportedStructureModes.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setStructureMode(mode);
                      setActiveStructureNodeId(null);
                      onAnswer(null);
                    }}
                    className={`rounded px-2.5 py-1 text-xs font-bold ${
                      structureMode === mode
                        ? "bg-[#ECEEEB] text-[#202321]"
                        : "text-[#A6AAA5]"
                    }`}
                  >
                    {mode === "word_bank" ? "보기" : "직접입력"}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {getStructureRecallKind(card) === "hierarchy" && hasUnorderedStructureGroup(card.structureNodes ?? []) ? (
            <p className="mb-3 text-xs font-bold text-[#B2B6B1]">
              같은 가지에 나란히 놓인 빈칸은 순서와 관계없이 채점됩니다.
            </p>
          ) : null}
          <div className="space-y-3">
            {(card.structureNodes ?? []).map((node, index, nodes) => {
              const answer = String(answerRecord[node.id] ?? "");
              const depth = getStructureNodeDepth(node.id, nodes);
              return (
                <div
                  key={node.id}
                  className="flex items-center gap-2"
                  style={{ marginLeft: `${getStructureRecallKind(card) === "hierarchy" ? depth * 28 : 0}px` }}
                >
                  <span className="w-5 shrink-0 text-center font-black text-[#A5A9A4]">
                    {getStructureRecallKind(card) === "sequence" ? index + 1 : depth > 0 ? "└" : "●"}
                  </span>
                  {structureMode === "word_bank" ? (
                    <button
                      type="button"
                      disabled={result !== null}
                      aria-label={`구조복원 빈칸 ${index + 1}`}
                      onClick={() => {
                        setActiveStructureNodeId(node.id);
                        if (answer) onAnswer(removeStructureAnswer(answerRecord, node.id));
                      }}
                      className={`min-h-12 min-w-40 flex-1 rounded-md border-2 border-dashed px-4 py-2 text-left font-black transition ${
                        activeStructureNodeId === node.id
                          ? "border-[#ECEEEB] bg-[#2D312E]"
                          : answer
                            ? "border-[#A6AAA5] bg-[#2A2E2B] text-[#F0F2EF]"
                            : "border-[#4B4F4B] bg-[#2A2E2B] text-[#A5A9A4]"
                      }`}
                    >
                      {answer || "빈칸"}
                    </button>
                  ) : (
                    <input
                      aria-label={`구조복원 빈칸 ${index + 1}`}
                      disabled={result !== null}
                      value={answer}
                      placeholder="답 입력"
                      onChange={(event) =>
                        onAnswer({ ...answerRecord, [node.id]: event.target.value })
                      }
                      className={`${inputClassName} min-h-12 border-2 border-dashed bg-[#2A2E2B] font-bold`}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {structureMode === "word_bank" ? (
            <div className="mt-6 border-t border-[#393D3A] pt-4">
              <p className="mb-3 text-xs font-black text-[#B2B6B1]">답 모음</p>
              <div className="flex flex-wrap gap-2">
                {structureChoices.map((choice, choiceIndex) => {
                  const used = usedStructureChoiceIndexes.has(choiceIndex);
                  return (
                    <button
                      key={`${choice}-${choiceIndex}`}
                      type="button"
                      disabled={result !== null || used}
                      onClick={() => {
                        const nodes = card.structureNodes ?? [];
                        const targetId = activeStructureNodeId ??
                          nodes.find((node) => !String(answerRecord[node.id] ?? ""))?.id;
                        if (!targetId) return;
                        const nextAnswer = { ...answerRecord, [targetId]: choice };
                        onAnswer(nextAnswer);
                        setActiveStructureNodeId(
                          nodes.find(
                            (node) => node.id !== targetId && !String(nextAnswer[node.id] ?? ""),
                          )?.id ?? null,
                        );
                      }}
                      className="rounded-md border border-[#4B4F4B] bg-[#2A2E2B] px-3 py-2 text-sm font-bold text-[#F0F2EF] hover:border-[#ECEEEB] disabled:opacity-35"
                    >
                      {choice}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-[#A6AAA5]">
                빈칸을 누른 뒤 아래 답을 고르세요. 채운 빈칸을 다시 누르면 답을 뺄 수 있습니다.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {result !== null ? (
        <div
          className={`mt-6 rounded-md border p-4 ${
            result
              ? "border-[#22A06B] bg-[#DCFFF1]"
              : "border-[#C9372C] bg-[#FFECEB]"
          }`}
        >
          <p className="font-black text-[#F0F2EF]">
            {result ? "정답입니다." : "틀렸습니다."}
          </p>
          <p className="mt-2 text-sm text-[#B2B6B1]">
            정답: {formatCorrectStudyAnswer(card)}
          </p>
          {card.explanation ? (
            <p className="mt-2 text-sm leading-6 text-[#B2B6B1]">
              판단 근거: {card.explanation}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function isCompleteGradedAnswer(card: Card, answer: StudyAnswer) {
  if (validateLearningActivity(card).length > 0) return false;
  const type = getLearningActivityType(card);
  if (type === "true_false") return typeof answer === "boolean";
  if (type === "multiple_choice") return typeof answer === "number";
  if (type === "cloze") return typeof answer === "string" && Boolean(answer.trim());
  if (type === "structure_recall") {
    const record = asStudyAnswerRecord(answer);
    return (card.structureNodes ?? []).every(
      (node) => typeof record[node.id] === "string" && String(record[node.id]).trim(),
    );
  }
  return false;
}

function asStudyAnswerRecord(answer: StudyAnswer) {
  return typeof answer === "object" && answer !== null && !Array.isArray(answer)
    ? answer
    : {};
}

function removeStructureAnswer(
  answers: Record<string, StudyAnswer>,
  nodeId: string,
) {
  return Object.fromEntries(
    Object.entries(answers).filter(([id]) => id !== nodeId),
  );
}

function getStructureNodeDepth(
  nodeId: string,
  nodes: NonNullable<Card["structureNodes"]>,
  visited = new Set<string>(),
): number {
  if (visited.has(nodeId)) return 0;
  const node = nodes.find((item) => item.id === nodeId);
  if (!node?.parentId) return 0;
  visited.add(nodeId);
  return 1 + getStructureNodeDepth(node.parentId, nodes, visited);
}

function hasUnorderedStructureGroup(
  nodes: NonNullable<Card["structureNodes"]>,
) {
  const childCounts = new Map<string | null, number>();
  for (const node of nodes) {
    childCounts.set(node.parentId, (childCounts.get(node.parentId) ?? 0) + 1);
  }
  return [...childCounts.values()].some((count) => count > 1);
}

function formatCorrectStudyAnswer(card: Card) {
  const type = getLearningActivityType(card);
  if (type === "true_false") return card.correctBoolean ? "O" : "X";
  if (type === "multiple_choice") {
    return card.options?.[card.correctOptionIndex ?? -1] ?? "정답 없음";
  }
  if (type === "cloze") return card.answer ?? card.answers?.[0] ?? "정답 없음";
  if (type === "structure_recall") {
    const nodes = card.structureNodes ?? [];
    const nodesByParent = new Map<string | null, typeof nodes>();
    for (const node of nodes) {
      const siblings = nodesByParent.get(node.parentId) ?? [];
      siblings.push(node);
      nodesByParent.set(node.parentId, siblings);
    }
    return [...nodesByParent.entries()]
      .map(([parentId, siblings]) => {
        if (siblings.length === 1) return siblings[0].correctLabel;
        const parent = nodes.find((node) => node.id === parentId);
        return `${parentId === null ? "최상위" : (parent?.correctLabel ?? "같은 가지")} 아래(순서 없음): ${siblings
          .map((node) => node.correctLabel)
          .join(", ")}`;
      })
      .join(" → ");
  }
  return card.back ?? card.answer ?? "";
}

const inputClassName =
  "w-full border border-[#4B4F4B] bg-[#242725] px-3 py-2 text-[#F0F2EF] outline-none placeholder:text-[#898E89] focus:border-[#AEB2AD]";

function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border border-[#3B3F3C] bg-[#242725] p-5 ${className}`}>
      {children}
    </section>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-sm font-bold text-[#F0F2EF]">{children}</span>;
}

function NavButton({
  active,
  neutral = false,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  neutral?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-h-10 w-full items-center gap-3 rounded-[9px] px-3 text-[12px] transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? neutral
            ? "bg-[#292929] text-[#E8E8E8]"
            : "bg-[#292929] text-[#E8E8E8]"
          : "text-[#8B8B8B] hover:bg-[#242424] hover:text-[#E8E8E8]"
      }`}
    >
      {children}
    </button>
  );
}

function MobileNavButton({
  active,
  neutral = false,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  neutral?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-w-0 items-center justify-center gap-1 whitespace-nowrap border-t-2 px-1 py-2 text-[10px] disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? neutral
            ? "border-[#D7DAD6] text-white"
            : "border-[#D7DAD6] text-white"
          : "border-transparent text-[#AEB4AF]"
      }`}
    >
      {children}
    </button>
  );
}

function PrimaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-[9px] bg-[#E6E6E6] px-4 py-2.5 font-medium text-[#171717] hover:bg-[#D4D4D4] disabled:cursor-not-allowed disabled:bg-[#4B4B4B] ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded-md border border-[#393D3A] bg-[#222523] px-4 py-2.5 font-black text-[#F0F2EF] hover:bg-[#2D312E] ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-bold text-[#B2B6B1]">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${inputClassName} min-h-24 resize-y text-sm leading-6`}
      />
    </label>
  );
}

function Feedback({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error ? (
        <p className="rounded-md border border-[#C9372C]/40 bg-[#C9372C]/10 px-3 py-2 text-sm font-bold text-[#AE2E24]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-md border border-[#22A06B]/40 bg-[#22A06B]/10 px-3 py-2 text-sm font-bold text-[#1F845A]">
          {notice}
        </p>
      ) : null}
    </>
  );
}

function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <Panel>
      <div className="mx-auto max-w-md py-14 text-center">
        <h3 className="text-2xl font-black text-[#F0F2EF]">{title}</h3>
        <p className="mt-3 text-sm leading-6 text-[#B2B6B1]">{body}</p>
        <div className="mt-6 flex justify-center gap-2">
          <PrimaryButton type="button" onClick={onAction}>
            {actionLabel}
          </PrimaryButton>
          {secondaryLabel && onSecondary ? (
            <SecondaryButton onClick={onSecondary}>{secondaryLabel}</SecondaryButton>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function LoadingOverlay({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-[#091E42]/55 px-5 backdrop-blur-[1px]">
      <div className="w-full max-w-sm rounded-lg border border-[#393D3A] bg-[#242725] p-5 text-center shadow-xl">
        <div className="mx-auto flex w-fit gap-1" aria-hidden="true">
          <span className="h-2 w-2 animate-bounce rounded-full bg-[#ECEEEB] [animation-delay:-0.2s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-[#ECEEEB] [animation-delay:-0.1s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-[#ECEEEB]" />
        </div>
        <p className="mt-4 font-black text-[#F0F2EF]">{message}</p>
        <p className="mt-2 text-sm text-[#B2B6B1]">
          분석, 정리, 카드 생성 단계를 차례로 실행하고 있습니다.
        </p>
      </div>
    </div>
  );
}

function DebugModal({
  result,
  onClose,
}: {
  result: GeneratePipelineResult;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-[#091E42]/60 p-4 backdrop-blur-[1px]">
      <section className="mx-auto max-h-[92vh] max-w-4xl overflow-auto rounded-lg border border-[#393D3A] bg-[#242725] p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-[#F0F2EF]">
            개발용 AI 파이프라인 디버그
          </h2>
          <SecondaryButton onClick={onClose}>닫기</SecondaryButton>
        </div>
        <div className="mt-4 grid gap-4">
          <DebugBlock title="1단계 분석 결과" value={result.analysis} />
          <DebugBlock title="2단계 검토한 학습 단위" value={result.organizedMaterial} />
          <DebugBlock title="3단계 카드 JSON" value={result.cards} />
        </div>
      </section>
    </div>
  );
}

function DeckDetailModal({
  deck,
  onClose,
}: {
  deck: Deck;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"cards" | "analysis" | "organized">("cards");

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#091E42]/60 p-4 backdrop-blur-[1px]">
      <section className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[#393D3A] bg-[#242725] shadow-xl">
        <div className="border-b border-[#393D3A] p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase text-[#B2B6B1]">
                Deck Detail
              </p>
              <h2 className="mt-1 truncate text-xl font-black text-[#F0F2EF]">
                {deck.title}
              </h2>
              <p className="mt-2 text-sm text-[#B2B6B1]">
                {deck.cards.length}개 · {deck.subject || "과목 없음"} ·{" "}
                {getLearningActivityMixLabel(deck.cards, deck.mode)}
              </p>
            </div>
            <SecondaryButton onClick={onClose}>닫기</SecondaryButton>
          </div>
        </div>

        <div className="space-y-5 overflow-y-auto p-5">
          <DetailSection title="기본 정보">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <DetailItem label="태그" value={deck.tags.join(", ") || "없음"} />
              <DetailItem
                label="최근 수정"
                value={new Date(deck.updatedAt).toLocaleString()}
              />
              <DetailItem
                label="생성일"
                value={new Date(deck.createdAt).toLocaleString()}
              />
              <DetailItem
                label="추가 지시사항"
                value={deck.instruction || "없음"}
              />
              <DetailItem label="PDF 파일" value={deck.sourceFileName || "없음"} />
            </dl>
          </DetailSection>

          <div className="flex flex-wrap gap-2">
            <TabButton active={tab === "cards"} onClick={() => setTab("cards")}>
              카드 목록
            </TabButton>
            <TabButton
              active={tab === "analysis"}
              onClick={() => setTab("analysis")}
            >
              1단계 분석
            </TabButton>
            <TabButton
              active={tab === "organized"}
              onClick={() => setTab("organized")}
            >
              검토한 학습 단위
            </TabButton>
          </div>

          {tab === "cards" ? (
            <div className="space-y-3">
              {deck.cards.map((card, index) => (
                <article
                  key={card.id}
                  className="rounded-md border border-[#393D3A] bg-[#222523] p-3"
                >
                  <p className="text-xs font-bold text-[#B2B6B1]">카드 {index + 1}</p>
                  {card.type === "flashcard" || card.type === "translation" ? (
                    <div className="mt-2 space-y-2 text-sm leading-6">
                      <p>
                        <span className="font-bold text-[#B2B6B1]">
                          {card.type === "translation" ? "한국어 cue: " : "질문: "}
                        </span>
                        {card.front}
                      </p>
                      <p>
                        <span className="font-bold text-[#B2B6B1]">
                          {card.type === "translation" ? "영어 표현: " : "답변: "}
                        </span>
                        {card.back}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-2 space-y-2 text-sm leading-6">
                      <p>
                        <span className="font-bold text-[#B2B6B1]">
                          빈칸 문장:{" "}
                        </span>
                        {renderClozeText(card.clozeText ?? "")}
                      </p>
                      <p>
                        <span className="font-bold text-[#B2B6B1]">정답: </span>
                        {formatAnswersForEdit(card).replace(/\n/g, ", ")}
                      </p>
                    </div>
                  )}
                  {card.basis ? (
                    <p className="mt-2 text-xs leading-5 text-[#A6AAA5]">
                      근거: {card.basis}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#A6AAA5]">
                    <span>{getCardStrategyLabel(card.strategy)}</span>
                    <span>{formatCardSource(card)}</span>
                    <span>난이도 {card.difficulty ?? "-"}/5</span>
                    <span>
                      품질 {card.qualityPassed === false ? "확인 필요" : "통과"}
                    </span>
                  </div>
                  {card.rationale ? (
                    <p className="mt-2 text-xs leading-5 text-[#A6AAA5]">
                      설계 이유: {card.rationale}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}

          {tab === "analysis" ? (
            <DetailSection title="1단계 분석 결과">
              <div className="space-y-3 text-sm leading-6 text-[#F0F2EF]">
                <p>
                  <span className="font-bold text-[#B2B6B1]">학습 목표: </span>
                  {deck.analysis.detectedGoal}
                </p>
                <p>
                  <span className="font-bold text-[#B2B6B1]">자료 성격: </span>
                  {deck.analysis.sourceType}
                </p>
                <p>
                  <span className="font-bold text-[#B2B6B1]">핵심 주제: </span>
                  {deck.analysis.keyTopics.join(", ") || "없음"}
                </p>
                <p>
                  <span className="font-bold text-[#B2B6B1]">추천 전략: </span>
                  {deck.analysis.recommendedStrategy}
                </p>
                <p>
                  <span className="font-bold text-[#B2B6B1]">주요 지식 유형: </span>
                  {getKnowledgeTypeLabel(deck.analysis.primaryKnowledgeType)}
                </p>
                {deck.analysis.learningUnits?.length ? (
                  <div>
                    <p className="font-bold text-[#B2B6B1]">
                      구조화된 학습 단위 {deck.analysis.learningUnits.length}개
                    </p>
                    <div className="mt-2 max-h-96 space-y-2 overflow-y-auto">
                      {deck.analysis.learningUnits.map((unit) => (
                        <article
                          key={unit.id}
                          className="rounded-md border border-[#393D3A] bg-[#202321] p-3"
                        >
                          <div className="flex flex-wrap justify-between gap-2 text-xs">
                            <span className="font-black text-[#F0F2EF]">
                              {unit.id} · {getKnowledgeTypeLabel(unit.knowledgeType)}
                            </span>
                            <span className="text-[#A6AAA5]">
                              {unit.sourceId}
                              {unit.sourcePage > 0 ? ` · ${unit.sourcePage}쪽` : ""}
                            </span>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-[#F0F2EF]">
                            {unit.sourceText}
                          </p>
                          {unit.generalizedForm ? (
                            <p className="mt-2 text-[#ECEEEB]">
                              일반화: {unit.generalizedForm}
                            </p>
                          ) : null}
                          <p className="mt-2 text-xs text-[#A6AAA5]">
                            {unit.rationale}
                          </p>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : null}
                {deck.analysis.extractedMaterial ? (
                  <div>
                    <p className="font-bold text-[#B2B6B1]">PDF/원문 추출 자료</p>
                    <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-[#393D3A] bg-[#202321] p-3 text-[#B2B6B1]">
                      {deck.analysis.extractedMaterial}
                    </p>
                  </div>
                ) : null}
              </div>
            </DetailSection>
          ) : null}

          {tab === "organized" ? (
            <DetailSection title="검토한 학습 단위">
              <div className="space-y-4">
                {deck.organizedMaterial.sections.map((section, index) => (
                  <article
                    key={`${section.heading}-${index}`}
                    className="rounded-md border border-[#393D3A] bg-[#222523] p-3"
                  >
                    <h4 className="font-black text-[#F0F2EF]">{section.heading}</h4>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#B2B6B1]">
                      {section.content}
                    </p>
                  </article>
                ))}
              </div>
            </DetailSection>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-2 text-sm font-black ${
        active
          ? "bg-[#ECEEEB] text-[#202321]"
          : "border border-[#393D3A] bg-[#222523] text-[#B2B6B1] hover:text-[#F0F2EF]"
      }`}
    >
      {children}
    </button>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-black text-[#F0F2EF]">{title}</h3>
      {children}
    </section>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-bold text-[#B2B6B1]">{label}</dt>
      <dd className="mt-1 break-words text-[#F0F2EF]">{value}</dd>
    </div>
  );
}

function DebugBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section>
      <h3 className="text-sm font-black text-[#F0F2EF]">{title}</h3>
      <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-[#171A18] p-3 text-xs leading-5 text-[#D8DCD7]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

function getViewTitle(
  view: View,
  hasPdfAnalysis = false,
  hasPreparedResult = false,
) {
  const titles: Record<View, string> = {
    create: hasPreparedResult
      ? "학습 내용 추출 결과"
      : hasPdfAnalysis
        ? "분석 결과"
        : "자료 분석",
    review: "생성 결과 수정",
    manager: "오늘의 작업실",
    records: "학습 기록",
    decks: "프로젝트",
    study: "학습",
  };
  return titles[view];
}

function getViewEyebrow(view: View) {
  const labels: Record<View, string> = {
    create: "Create",
    review: "Review",
    manager: "Today",
    records: "Records",
    decks: "Projects",
    study: "Study",
  };
  return labels[view];
}

function getModeLabel(mode: StudyMode) {
  const labels: Record<StudyMode, string> = {
    flashcard: "플래시카드",
    cloze: "빈칸 문제",
    translation: "영작 리콜",
  };
  return labels[mode];
}

function getLearningActivityMixLabel(cards: Card[], fallbackMode: StudyMode) {
  if (cards.length === 0) return getModeLabel(fallbackMode);

  const orderedTypes: LearningActivityType[] = [
    "flashcard",
    "cloze",
    "true_false",
    "multiple_choice",
    "structure_recall",
  ];
  const counts = orderedTypes
    .map((type) => ({
      type,
      count: cards.filter((card) => getLearningActivityType(card) === type).length,
    }))
    .filter(({ count }) => count > 0);

  if (counts.length === 1) return getLearningActivityLabel(counts[0].type);

  return `혼합 문제 · ${counts
    .map(({ type, count }) => `${getLearningActivityLabel(type)} ${count}`)
    .join(" / ")}`;
}

function getLearningActivityLabel(type: LearningActivityType) {
  const labels: Record<LearningActivityType, string> = {
    flashcard: "플래시카드",
    cloze: "빈칸",
    true_false: "OX",
    multiple_choice: "객관식",
    structure_recall: "구조복원",
  };
  return labels[type];
}

function getStudyPromptLabel(mode: StudyMode) {
  const labels: Record<StudyMode, string> = {
    flashcard: "질문",
    cloze: "빈칸 문제",
    translation: "한국어 cue",
  };
  return labels[mode];
}

function buildGenerateRequest(
  form: GenerateRequest,
  tagInput: string,
  pdfFiles: File[],
  pdfAnalysis: PdfAnalysisResponse | null,
  studyGuideline: ConfirmedStudyGuideline,
  stage: "prepare" | "design",
  projectId: string | null,
): RequestInit {
  const tags = parseTags(tagInput);

  if (pdfFiles.length === 0) {
    return {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        projectId: projectId ?? undefined,
        tags,
        studyGuideline: JSON.stringify(studyGuideline),
        analysisContext: pdfAnalysis ? JSON.stringify(pdfAnalysis) : "",
        stage,
      }),
    };
  }

  const formData = new FormData();
  if (projectId) formData.append("projectId", projectId);
  formData.append("title", form.title);
  formData.append("subject", form.subject);
  formData.append("tags", JSON.stringify(tags));
  formData.append("sourceText", form.sourceText);
  formData.append("instruction", form.instruction);
  formData.append("studyGuideline", JSON.stringify(studyGuideline));
  formData.append("stage", stage);
  formData.append(
    "analysisContext",
    pdfAnalysis ? JSON.stringify(pdfAnalysis) : "",
  );
  formData.append("mode", form.mode);
  formData.append("sourceExpressionMode", form.sourceExpressionMode ?? "adapt");
  pdfFiles.forEach((file) => formData.append("pdfs", file));

  return {
    method: "POST",
    body: formData,
  };
}

function buildLearningPlanGenerationRequest(
  form: GenerateRequest,
  tagInput: string,
  preparedResult: GeneratePipelineResult,
  material: OrganizedMaterial,
  studyGuideline: ConfirmedStudyGuideline,
  problemDesignAdvice: string,
  projectId: string | null,
): RequestInit {
  if (!preparedResult.learningDesign || !preparedResult.codexThreadId) {
    throw new Error("이어갈 학습 설계 대화가 없습니다.");
  }
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...form,
      projectId: projectId ?? undefined,
      instruction: buildProblemDesignInstruction(
        form.instruction,
        problemDesignAdvice,
      ),
      mode: "flashcard",
      tags: parseTags(tagInput),
      stage: "generate-from-plan",
      studyGuideline: JSON.stringify(studyGuideline),
      learningDesign: JSON.stringify(preparedResult.learningDesign),
      codexThreadId: preparedResult.codexThreadId,
      preparedAnalysis: JSON.stringify(preparedResult.analysis),
      preparedMaterial: JSON.stringify(material),
    }),
  };
}

function buildActivityDesignRequest(
  form: GenerateRequest,
  tagInput: string,
  analysis: GeneratePipelineResult["analysis"],
  material: OrganizedMaterial,
  studyGuideline: ConfirmedStudyGuideline,
  problemDesignAdvice: string,
  projectId: string | null,
): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...form,
      projectId: projectId ?? undefined,
      instruction: buildProblemDesignInstruction(
        form.instruction,
        problemDesignAdvice,
      ),
      tags: parseTags(tagInput),
      stage: "activity-design",
      studyGuideline: JSON.stringify(studyGuideline),
      preparedAnalysis: JSON.stringify(analysis),
      preparedMaterial: JSON.stringify(material),
    }),
  };
}

function buildLearningActivityRequest(
  form: GenerateRequest,
  tagInput: string,
  analysis: GeneratePipelineResult["analysis"],
  material: OrganizedMaterial,
  studyGuideline: ConfirmedStudyGuideline,
  activityDesign: ActivityDesign,
  activitySelectionMode: ActivitySelectionMode,
  problemDesignAdvice: string,
  projectId: string | null,
): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...form,
      projectId: projectId ?? undefined,
      instruction: buildProblemDesignInstruction(
        form.instruction,
        problemDesignAdvice,
      ),
      mode: "flashcard",
      tags: parseTags(tagInput),
      stage: "cards",
      studyGuideline: JSON.stringify(studyGuideline),
      activityDesign: JSON.stringify(activityDesign),
      activitySelectionMode,
      preparedAnalysis: JSON.stringify(analysis),
      preparedMaterial: JSON.stringify(material),
    }),
  };
}

function buildProblemDesignInstruction(
  generalInstruction: string,
  problemDesignAdvice: string,
) {
  return [
    generalInstruction.trim()
      ? `전체 추가 지시:\n${generalInstruction.trim()}`
      : "",
    problemDesignAdvice.trim()
      ? `문제 만들기 방향:\n${problemDesignAdvice.trim()}`
      : "",
  ].filter(Boolean).join("\n\n");
}

function filterOrganizedMaterial(
  material: OrganizedMaterial,
  excludedLearningUnitIds: string[],
) {
  const excludedIds = new Set(excludedLearningUnitIds);
  return {
    ...material,
    sections: material.sections.flatMap((section) => {
      if (!section.learningUnitIds) return [section];
      const learningUnitIds = section.learningUnitIds.filter(
        (id) => !excludedIds.has(id),
      );
      return learningUnitIds.length > 0 ? [{ ...section, learningUnitIds }] : [];
    }),
  };
}

function buildConfirmedStudyGuideline(
  draft: StudyGuidelineDraft | null,
  selectedGroupId: string | null,
): ConfirmedStudyGuideline | null {
  if (!draft || !selectedGroupId) {
    return null;
  }

  const selectedGroup = draft.groups.find(
    (group) => group.id === selectedGroupId,
  );
  if (!selectedGroup) {
    return null;
  }

  return {
    summary: draft.summary,
    selectedGroup,
  };
}

function buildWholeDocumentCoreGuideline(
  plan: WholeDocumentCorePlan,
  runMode: BaselineRunMode,
): ConfirmedStudyGuideline {
  const softBudget = createLearningUnitSoftBudget(plan);
  const usesSoftBudget = runMode === "whole_document_core_soft_budget";
  return {
    summary: plan.summary,
    selectedGroup: {
      id: "whole-document-core",
      title: "전체 자료 핵심 학습 범위",
      description: plan.selectionRationale,
      itemCount: plan.maxLearningUnitCount,
      itemLabel: "핵심 LearningUnit",
      selectionInstruction: usesSoftBudget
        ? [
            "특정 영역 하나로 제한하지 않고 wholeDocumentCore.areas 전체에서 핵심 단위를 추출합니다.",
            "learningUnitSoftBudget.max는 과다 추출 안전선입니다.",
            "최소 개수는 없으며 max를 채우기 위해 학습 가치가 낮은 내용을 추가하지 않습니다.",
            "의미적 완결성과 학습 가치가 soft budget보다 우선합니다.",
            "숫자를 맞추기 위해 독립 대상을 합치거나 낮은 가치 내용을 추가하지 않습니다.",
            "중요한 하위 영역은 누락하지 않고 wholeDocumentCore.exclusions는 핵심 단위로 만들지 않습니다.",
          ].join(" ")
        : [
            "특정 영역 하나로 제한하지 않고 wholeDocumentCore.areas 전체에서 핵심 단위를 추출합니다.",
            "모든 영역을 균등하게 배분하지 말고 learningValue와 학습목표의 관련성을 반영합니다.",
            "중요한 하위 영역은 누락하지 않되 예시, 반복 요약, 메타데이터는 핵심 단위보다 낮은 우선순위로 둡니다.",
            "wholeDocumentCore.exclusions에 포함된 내용은 핵심 LearningUnit으로 만들지 않습니다.",
          ].join(" "),
    },
    wholeDocumentCore: plan,
    ...(usesSoftBudget
      ? {
          countPolicy: "soft_budget" as const,
          learningUnitSoftBudget: softBudget,
        }
      : {}),
  };
}

function createLearningUnitSoftBudget(plan: WholeDocumentCorePlan) {
  return {
    max: plan.maxLearningUnitCount,
  };
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))}KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

function parseTags(input: string) {
  return input
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeCards(cards: Card[]) {
  return cards.map((card) => {
    if (card.type !== "cloze") {
      return card;
    }
    const answer = normalizeClozeAnswer(card.clozeText ?? "", card.answer ?? "");
    const answers = card.answers?.length ? card.answers : splitAnswerText(answer);
    return {
      ...card,
      clozeText: normalizeClozeText(card.clozeText ?? "", answers),
      answer: answers.join(", "),
      answers,
    };
  });
}

function renderClozeText(text: string) {
  return text.replace(/\{\{c\d+::([^}:]+)(?:::[^}]+)?\}\}/g, "____");
}

function normalizeClozeText(text: string, answers: string[]) {
  let nextText = renderClozeText(text);
  answers.forEach((answer) => {
    nextText = nextText.replace(answer, "____");
  });
  return nextText;
}

async function importPublishedMcpDecks(existingDecks: Deck[]) {
  const response = await fetch("/api/mcp-decks", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("MCP 발행 덱 목록을 불러오지 못했습니다.");
  }
  const payload = await response.json() as { decks?: unknown[] };
  const newDecks = selectNewPublishedMcpDecks(payload, existingDecks);
  for (const candidate of newDecks) {
    try {
      await saveDeck(await moveDeckConceptTreeToProject(candidate));
    } catch (error) {
      console.warn("MCP 학습트리를 프로젝트로 옮기지 못해 덱 내부 트리를 유지합니다.", error);
      await saveDeck(candidate);
    }
  }
  return newDecks.length;
}

async function migrateDeckConceptTreesToProjects(decks: Deck[]) {
  for (const deck of decks) {
    if (!deck.projectId || !deck.conceptTree) continue;
    try {
      await saveDeck(await moveDeckConceptTreeToProject(deck));
    } catch (error) {
      console.warn("기존 학습트리를 프로젝트로 옮기지 못해 덱 내부 트리를 유지합니다.", error);
    }
  }
}

async function moveDeckConceptTreeToProject(deck: Deck): Promise<Deck> {
  if (!deck.projectId || !deck.conceptTree) return deck;
  const response = await fetch(
    `/api/study-projects/${encodeURIComponent(deck.projectId)}/concept-trees`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tree: deck.conceptTree,
        sourceIds: deck.pdfSourceIds ?? [],
      }),
    },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message ?? "프로젝트 학습트리를 저장하지 못했습니다.");
  }
  const payload = await response.json() as { conceptTree: { id: string } };
  const migratedDeck: Deck = {
    ...deck,
    conceptTreeIds: [...new Set([...(deck.conceptTreeIds ?? []), payload.conceptTree.id])],
  };
  delete migratedDeck.conceptTree;
  return migratedDeck;
}

function normalizeClozeAnswer(text: string, answer: string) {
  const matches = Array.from(text.matchAll(/\{\{c\d+::([^}:]+)(?:::[^}]+)?\}\}/g));
  return matches.length > 0
    ? matches.map((match) => match[1].trim()).join(", ")
    : answer;
}

function splitAnswerText(answer: string) {
  return answer
    .split(/\n|,|;|\//)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatAnswersForEdit(card: Card) {
  const answers = card.answers?.length
    ? card.answers
    : splitAnswerText(card.answer ?? "");
  return answers.join("\n");
}

function getCardStrategyLabel(strategy: Card["strategy"]) {
  const labels: Record<NonNullable<Card["strategy"]>, string> = {
    production: "표현 생성",
    recognition: "의미 인식",
    concept: "개념 인출",
    contrast: "차이 비교",
    procedure: "절차 인출",
    application: "상황 적용",
  };
  return strategy ? labels[strategy] : "전략 미지정";
}

function getKnowledgeTypeLabel(
  type: GeneratePipelineResult["analysis"]["primaryKnowledgeType"],
) {
  const labels = {
    vocabulary: "어휘",
    fact: "사실",
    concept: "개념",
    relationship: "관계",
    procedure: "절차",
    formula: "공식",
    speaking_pattern: "스피킹 패턴",
    writing_pattern: "라이팅 패턴",
    problem_solving_pattern: "문제 해결 패턴",
    example: "예시",
    other: "기타",
  } as const;
  return type ? labels[type] : "미분류";
}

function formatCardSource(card: Card) {
  if (!card.sourceId) return "출처 미지정";
  const page = card.sourcePage && card.sourcePage > 0 ? ` · ${card.sourcePage}쪽` : "";
  const range = card.sourceRange ? ` · ${card.sourceRange}` : "";
  return `${card.sourceId}${page}${range}`;
}

function renderClozeForStudy(card: Card, isAnswerVisible: boolean) {
  const text = renderClozeText(card.clozeText ?? "");

  if (!isAnswerVisible) {
    return text;
  }

  const answers = card.answers?.length
    ? card.answers
    : splitAnswerText(card.answer ?? "");
  const parts = text.split("____");

  return parts.flatMap((part, index) => {
    const answer = answers[index];
    if (index === parts.length - 1) {
      return [part];
    }

    return [
      part,
      <mark
        key={`${card.id}-${index}`}
        className="mx-1 rounded bg-[#F5CD47] px-1.5 py-0.5 text-[#F0F2EF]"
      >
        {answer ?? "____"}
      </mark>,
    ];
  });
}
