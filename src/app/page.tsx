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
  Cloud,
  Columns3,
  GraduationCap,
  GripVertical,
  Info,
  Sparkles,
  Pencil,
  Plus,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  RotateCcw,
  Trash2,
  Workflow,
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { deleteDeck, listDecks, saveDeck } from "@/lib/storage";
import PdfReviewViewer from "./PdfReviewViewer";
import PipelineOperatorModal from "./PipelineOperatorModal";
import type {
  BaselineRunMode,
  Card,
  ConfirmedRecallDesign,
  ConfirmedStudyGuideline,
  Deck,
  DeckBoardColumn,
  PdfAnalysisResponse,
  GeneratePipelineResult,
  GenerateRequest,
  LearningUnitSample,
  OrganizedMaterial,
  RecallDesignDraft,
  StudyGuidelineDraft,
  StudyMode,
  WholeDocumentCorePlan,
} from "@/lib/types";

const showAiDebug = process.env.NEXT_PUBLIC_SHOW_AI_DEBUG === "true";
const showBaselineExport = process.env.NODE_ENV === "development";

type View = "create" | "review" | "decks" | "study";

type GenerateBaselineTrace = {
  generatedCards: unknown[];
  criticCards: unknown[];
};

type GenerateCardsResponse = GeneratePipelineResult & {
  baselineTrace?: GenerateBaselineTrace;
};

type PublicModelConfig = {
  default: { model: string; reasoningEffort: string };
  extraction: { model: string; reasoningEffort: string };
  critic: { model: string; reasoningEffort: string };
};

const emptyForm: GenerateRequest = {
  title: "",
  subject: "",
  tags: [],
  sourceText: "",
  instruction: "",
  mode: "flashcard",
};

const loadingPhases = [
  "자료와 지시사항을 읽고 있습니다.",
  "공부해야 할 핵심을 분석하고 있습니다.",
  "독립적인 학습 단위를 추출하고 일반화하고 있습니다.",
  "선택한 방식에 맞춰 카드로 변환하고 있습니다.",
  "생성된 카드의 인출 품질과 원문 근거를 검사하고 있습니다.",
];

const pdfAnalysisPhases = [
  "업로드한 PDF를 확인하고 있습니다.",
  "문서의 내용과 구조를 읽고 있습니다.",
  "파일별 목차와 핵심 주제를 정리하고 있습니다.",
  "학습 방향을 설계하고 있습니다.",
];

export default function Home() {
  const [view, setView] = useState<View>("create");
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
  const [isPlanningGuideline, setIsPlanningGuideline] = useState(false);
  const [isPlanningWholeDocument, setIsPlanningWholeDocument] = useState(false);
  const [recallDesign, setRecallDesign] = useState<RecallDesignDraft | null>(null);
  const [selectedRecallOptionId, setSelectedRecallOptionId] = useState<
    string | null
  >(null);
  const [selectedRecallVariantId, setSelectedRecallVariantId] = useState<
    string | null
  >(null);
  const [learningSample, setLearningSample] =
    useState<LearningUnitSample | null>(null);
  const [sampleFeedback, setSampleFeedback] = useState("");
  const [isDesigningRecall, setIsDesigningRecall] = useState(false);
  const [preparedResult, setPreparedResult] =
    useState<GeneratePipelineResult | null>(null);
  const [editableMaterial, setEditableMaterial] =
    useState<OrganizedMaterial | null>(null);
  const [isAnalyzingPdfs, setIsAnalyzingPdfs] = useState(false);
  const [isPreparingMaterial, setIsPreparingMaterial] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisPhaseIndex, setAnalysisPhaseIndex] = useState(0);
  const [pipelineResult, setPipelineResult] =
    useState<GeneratePipelineResult | null>(null);
  const [generateBaselineTrace, setGenerateBaselineTrace] =
    useState<GenerateBaselineTrace | null>(null);
  const [editableCards, setEditableCards] = useState<Card[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [selectedDeck, setSelectedDeck] = useState<Deck | null>(null);
  const [detailDeck, setDetailDeck] = useState<Deck | null>(null);
  const [renamingDeckId, setRenamingDeckId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [studyIndex, setStudyIndex] = useState(0);
  const [isAnswerVisible, setIsAnswerVisible] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExportingBaseline, setIsExportingBaseline] = useState(false);
  const [loadingPhaseIndex, setLoadingPhaseIndex] = useState(0);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [isPipelineOpen, setIsPipelineOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void refreshDecks();
  }, []);

  const confirmedStudyGuideline = useMemo(
    () =>
      runMode !== "focused_area" && wholeDocumentCorePlan
        ? buildWholeDocumentCoreGuideline(wholeDocumentCorePlan, runMode)
        : buildConfirmedStudyGuideline(studyGuideline, selectedFocusGroupId),
    [runMode, wholeDocumentCorePlan, studyGuideline, selectedFocusGroupId],
  );

  const currentStudyCard = selectedDeck?.cards[studyIndex];

  const cardStats = useMemo(() => {
    if (!selectedDeck) {
      return { known: 0, review: 0, total: 0 };
    }

    return {
      known: selectedDeck.cards.filter((card) => card.status === "known").length,
      review: selectedDeck.cards.filter((card) => card.status === "review").length,
      total: selectedDeck.cards.length,
    };
  }, [selectedDeck]);

  async function refreshDecks() {
    setDecks(await listDecks());
  }

  async function handleExportBaseline() {
    const confirmedGuideline = confirmedStudyGuideline;
    const confirmedRecall = buildConfirmedRecallDesign(
      recallDesign,
      selectedRecallOptionId,
      selectedRecallVariantId,
    );

    if (
      !pdfAnalysis ||
      !confirmedGuideline ||
      (runMode !== "focused_area" && !wholeDocumentCorePlan) ||
      !recallDesign ||
      !confirmedRecall ||
      !learningSample ||
      !preparedResult ||
      !pipelineResult ||
      !generateBaselineTrace
    ) {
      setError("현재 실행의 전체 단계가 남아 있지 않아 baseline을 내보낼 수 없습니다.");
      return;
    }

    setError("");
    setIsExportingBaseline(true);

    try {
      const modelResponse = await fetch("/api/model-config", {
        cache: "no-store",
      });
      if (!modelResponse.ok) {
        throw new Error("실행 모델 설정을 확인하지 못했습니다.");
      }
      const models = (await modelResponse.json()) as PublicModelConfig;
      const capturedAt = new Date().toISOString();
      const learningUnits = preparedResult.analysis.learningUnits ?? [];
      const learningUnitCardCoverage = Object.fromEntries(
        learningUnits.map((unit) => [
          unit.id,
          pipelineResult.cards.filter(
            (card) => card.learningUnitId === unit.id,
          ).length,
        ]),
      );
      const zeroCardLearningUnitIds = Object.entries(learningUnitCardCoverage)
        .filter(([, count]) => count === 0)
        .map(([id]) => id);
      const multipleCardLearningUnitIds = Object.entries(
        learningUnitCardCoverage,
      )
        .filter(([, count]) => count >= 2)
        .map(([id]) => id);
      const baseline = {
        artifactType: "study-forge-production-baseline",
        artifactVersion: "v0",
        runMode,
        capturedAt,
        sourceFiles: pdfFiles.map((file) => ({
          name: file.name,
          type: file.type,
          size: file.size,
          lastModified: new Date(file.lastModified).toISOString(),
        })),
        modelConfiguration: {
          analyze: models.default,
          plan: models.default,
          wholeDocumentCorePlan:
            runMode !== "focused_area" ? models.default : null,
          recallDesign: models.default,
          prepare: models.extraction,
          cards: models.default,
          critic: models.critic,
        },
        userSelections: {
          instruction: form.instruction,
          countPolicy: confirmedGuideline.countPolicy ?? "exact",
          learningUnitSoftBudget:
            confirmedGuideline.learningUnitSoftBudget ?? null,
          learningArea:
            runMode === "focused_area"
              ? confirmedGuideline.selectedGroup
              : null,
          wholeDocumentCore:
            runMode !== "focused_area" ? wholeDocumentCorePlan : null,
          recallOption: confirmedRecall.selectedOption,
          recallVariant: confirmedRecall.selectedVariant,
          representativeExample: learningSample,
          sampleFeedback,
          cardMode: form.mode,
          variableHandling: {
            slotMode: confirmedRecall.selectedVariant.slotMode,
            exampleSource: confirmedRecall.selectedVariant.exampleSource,
            preservePlaceholders:
              confirmedRecall.selectedVariant.preservePlaceholders,
          },
        },
        stages: {
          analyze: pdfAnalysis,
          plan: studyGuideline,
          wholeDocumentCorePlan:
            runMode !== "focused_area" ? wholeDocumentCorePlan : null,
          selectedLearningArea:
            runMode === "focused_area" ? confirmedGuideline : null,
          effectiveStudyGuideline: confirmedGuideline,
          recallDesign,
          selectedRecallDesign: confirmedRecall,
          prepare: preparedResult,
          cards: generateBaselineTrace.generatedCards,
          critic: generateBaselineTrace.criticCards,
          finalCards: pipelineResult.cards,
        },
        observations: {
          generatedLearningUnitCount: learningUnits.length,
          generatedCardCount: generateBaselineTrace.generatedCards.length,
          criticCardCount: generateBaselineTrace.criticCards.length,
          finalCardCount: pipelineResult.cards.length,
          learningUnitCardCoverageBasis: "finalCards",
          learningUnitCardCoverage,
          zeroCardLearningUnitIds,
          multipleCardLearningUnitIds,
        },
      };

      downloadJson(
        baseline,
        `study-forge-baseline-${runMode}-${getBaselineSourceName(pdfFiles)}-${capturedAt.replace(/[:.]/g, "-")}.json`,
      );
      setNotice("현재 production 실행 결과를 baseline JSON으로 내보냈습니다.");
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "baseline JSON을 내보내지 못했습니다.",
      );
    } finally {
      setIsExportingBaseline(false);
    }
  }

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!preparedResult || !editableMaterial) {
      setError("카드로 만들 학습 단위 추출 결과가 필요합니다.");
      return;
    }

    const confirmedGuideline = confirmedStudyGuideline;
    if (!confirmedGuideline) {
      setError("학습 방향을 먼저 모두 선택해 주세요.");
      return;
    }
    const confirmedRecall = buildConfirmedRecallDesign(
      recallDesign,
      selectedRecallOptionId,
      selectedRecallVariantId,
    );
    if (!confirmedRecall || !learningSample) {
      setError("인출 방식과 대표 예시를 먼저 확정해 주세요.");
      return;
    }

    if (
      editableMaterial.sections.length === 0 ||
      editableMaterial.sections.every(
        (section) => !section.heading.trim() && !section.content.trim(),
      )
    ) {
      setError("카드로 만들 학습 내용을 한 개 이상 남겨 주세요.");
      return;
    }

    setIsGenerating(true);
    setLoadingPhaseIndex(0);
    setPipelineResult(null);
    setGenerateBaselineTrace(null);
    setEditableCards([]);

    const interval = window.setInterval(() => {
      setLoadingPhaseIndex((index) =>
        Math.min(index + 1, loadingPhases.length - 1),
      );
    }, 1800);

    try {
      const response = await fetch(
        "/api/generate",
        buildCardRequest(
          form,
          tagInput,
          preparedResult.analysis,
          editableMaterial,
          confirmedGuideline,
          confirmedRecall,
          learningSample,
          sampleFeedback,
        ),
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "암기자료 생성에 실패했습니다.");
      }

      const result = data as GenerateCardsResponse;
      setPipelineResult(result);
      setGenerateBaselineTrace(result.baselineTrace ?? null);
      setEditableCards(normalizeCards(data.cards));
      setNotice("AI 생성이 완료되었습니다. 저장 전에 카드를 확인하세요.");
      setView("review");
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "암기자료 생성에 실패했습니다.",
      );
    } finally {
      window.clearInterval(interval);
      setIsGenerating(false);
    }
  }

  async function handlePrepareMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsPreparingMaterial(true);
    setPreparedResult(null);
    setEditableMaterial(null);
    setGenerateBaselineTrace(null);

    const confirmedGuideline = confirmedStudyGuideline;
    if (!confirmedGuideline) {
      setIsPreparingMaterial(false);
      setError("학습 방향을 먼저 모두 선택해 주세요.");
      return;
    }
    const confirmedRecall = buildConfirmedRecallDesign(
      recallDesign,
      selectedRecallOptionId,
      selectedRecallVariantId,
    );
    if (!confirmedRecall || !learningSample) {
      setIsPreparingMaterial(false);
      setError("인출 방식과 대표 예시를 먼저 확정해 주세요.");
      return;
    }

    try {
      const response = await fetch(
        "/api/generate",
        buildGenerateRequest(
          form,
          tagInput,
          pdfFiles,
          pdfAnalysis,
          confirmedGuideline,
          confirmedRecall,
          learningSample,
          sampleFeedback,
          "prepare",
        ),
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "학습 단위 추출에 실패했습니다.");
      }

      setPreparedResult(data);
      setEditableMaterial(data.organizedMaterial);
      setNotice("선택 영역에서 학습 단위를 추출했습니다.");
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
    resetRecallFlow();
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

    const now = new Date().toISOString();
    const deckTitle =
      form.title.trim() ||
      pipelineResult.organizedMaterial.title ||
      pipelineResult.analysis.keyTopics[0] ||
      "새 학습 덱";
    const deck: Deck = {
      id: crypto.randomUUID(),
      title: deckTitle,
      boardColumn: "new",
      subject: form.subject.trim(),
      tags: parseTags(tagInput),
      mode: form.mode,
      sourceText: form.sourceText || pipelineResult.analysis.extractedMaterial || "",
      sourceFileName: pdfFiles.map((file) => file.name).join(", ") || undefined,
      instruction: form.instruction,
      studyGuideline: confirmedStudyGuideline ?? undefined,
      recallDesign:
        buildConfirmedRecallDesign(
          recallDesign,
          selectedRecallOptionId,
          selectedRecallVariantId,
        ) ??
        undefined,
      analysis: pipelineResult.analysis,
      organizedMaterial: pipelineResult.organizedMaterial,
      cards: normalizeCards(editableCards),
      createdAt: now,
      updatedAt: now,
    };

    await saveDeck(deck);
    await refreshDecks();
    setSelectedDeck(deck);
    setStudyIndex(0);
    setIsAnswerVisible(false);
    setNotice("덱을 저장했습니다.");
    setView("study");
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
    resetRecallFlow();
    setAnalysisProgress(8);
    setAnalysisPhaseIndex(0);

    const interval = window.setInterval(() => {
      setAnalysisProgress((progress) => Math.min(progress + 7, 92));
      setAnalysisPhaseIndex((index) =>
        Math.min(index + 1, pdfAnalysisPhases.length - 1),
      );
    }, 1100);

    try {
      const formData = new FormData();
      pdfFiles.forEach((file) => formData.append("pdfs", file));
      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "PDF 분석에 실패했습니다.");
      }

      setAnalysisProgress(100);
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      setPdfAnalysis(data);
      const planned = await requestStudyGuideline(data);
      setNotice(
        planned
          ? "PDF 분석과 학습 방향 설계가 완료되었습니다."
          : "PDF 분석은 완료되었습니다. 학습 방향 만들기를 다시 시도해 주세요.",
      );
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "PDF 분석에 실패했습니다.",
      );
    } finally {
      window.clearInterval(interval);
      setIsAnalyzingPdfs(false);
    }
  }

  function resetRecallFlow() {
    setRecallDesign(null);
    setSelectedRecallOptionId(null);
    setSelectedRecallVariantId(null);
    setLearningSample(null);
    setSampleFeedback("");
    setPreparedResult(null);
    setEditableMaterial(null);
    setGenerateBaselineTrace(null);
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
        body: JSON.stringify({ analysis, instruction: form.instruction }),
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

  async function handleCreateRecallDesign() {
    const guideline = confirmedStudyGuideline;
    if (!pdfAnalysis || !guideline) {
      setError("집중할 학습 영역을 먼저 선택해 주세요.");
      return;
    }

    setError("");
    setNotice("");
    setIsDesigningRecall(true);
    setRecallDesign(null);
    setSelectedRecallOptionId(null);
    setSelectedRecallVariantId(null);
    setLearningSample(null);
    try {
      const recallRequest: RequestInit =
        pdfFiles.length > 0
          ? (() => {
              const formData = new FormData();
              formData.append("analysis", JSON.stringify(pdfAnalysis));
              formData.append("guideline", JSON.stringify(guideline));
              pdfFiles.forEach((file) => formData.append("pdfs", file));
              return { method: "POST", body: formData };
            })()
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ analysis: pdfAnalysis, guideline }),
            };
      const response = await fetch("/api/recall-design", recallRequest);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message ?? "인출 방식을 설계하지 못했습니다.");
      }

      const draft = data as RecallDesignDraft;
      setRecallDesign(draft);
      setSelectedRecallOptionId(null);
      setSelectedRecallVariantId(null);
      setNotice("대표 예시를 보고 원하는 카드 구조를 선택하세요.");
    } catch (designError) {
      setError(
        designError instanceof Error
          ? designError.message
          : "인출 방식을 설계하지 못했습니다.",
      );
    } finally {
      setIsDesigningRecall(false);
    }
  }

  async function handleSelectRecallExample(optionId: string, variantId: string) {
    if (isGenerating) return;

    const guideline = confirmedStudyGuideline;
    const option = recallDesign?.options.find((item) => item.id === optionId);
    const variant = option?.variants.find((item) => item.id === variantId);
    if (!pdfAnalysis || !guideline || !option || !variant) {
      setError("선택한 대표 예시 정보를 확인하지 못했습니다.");
      return;
    }

    const selectedForm = { ...form, mode: option.mode };
    const confirmedRecall: ConfirmedRecallDesign = {
      selectedOption: option,
      selectedVariant: variant,
    };
    const sample = variant.sample;
    setForm(selectedForm);
    setSelectedRecallOptionId(optionId);
    setSelectedRecallVariantId(variantId);
    setLearningSample(sample);
    setSampleFeedback("");
    setPreparedResult(null);
    setEditableMaterial(null);
    setGenerateBaselineTrace(null);
    setPipelineResult(null);
    setEditableCards([]);
    setError("");
    setNotice("");
    setIsGenerating(true);
    setLoadingPhaseIndex(0);

    const interval = window.setInterval(() => {
      setLoadingPhaseIndex((index) =>
        Math.min(index + 1, loadingPhases.length - 1),
      );
    }, 1800);

    try {
      const prepareResponse = await fetch(
        "/api/generate",
        buildGenerateRequest(
          selectedForm,
          tagInput,
          pdfFiles,
          pdfAnalysis,
          guideline,
          confirmedRecall,
          sample,
          "",
          "prepare",
        ),
      );
      const prepared = await prepareResponse.json();
      if (!prepareResponse.ok) {
        throw new Error(prepared.message ?? "학습 단위를 추출하지 못했습니다.");
      }

      setPreparedResult(prepared);
      setEditableMaterial(prepared.organizedMaterial);
      setLoadingPhaseIndex(Math.max(2, loadingPhases.length - 2));

      const cardResponse = await fetch(
        "/api/generate",
        buildCardRequest(
          selectedForm,
          tagInput,
          prepared.analysis,
          prepared.organizedMaterial,
          guideline,
          confirmedRecall,
          sample,
          "",
        ),
      );
      const result = await cardResponse.json();
      if (!cardResponse.ok) {
        throw new Error(result.message ?? "암기 카드를 생성하지 못했습니다.");
      }

      const pipeline = result as GenerateCardsResponse;
      setPipelineResult(pipeline);
      setGenerateBaselineTrace(pipeline.baselineTrace ?? null);
      setEditableCards(normalizeCards(result.cards));
      setNotice("선택한 대표 예시 구조로 전체 카드를 생성했습니다.");
      setView("review");
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "대표 예시를 적용한 카드 생성에 실패했습니다.",
      );
    } finally {
      window.clearInterval(interval);
      setIsGenerating(false);
    }
  }

  async function requestWholeDocumentCorePlan(
    experimentRunMode:
      | "whole_document_core"
      | "whole_document_core_soft_budget",
  ) {
    if (!pdfAnalysis || pdfFiles.length === 0) {
      setError("전체 핵심 학습 실험에는 분석이 끝난 원본 PDF가 필요합니다.");
      return;
    }

    setError("");
    setNotice("");
    setIsPlanningWholeDocument(true);
    try {
      const formData = new FormData();
      formData.append("analysis", JSON.stringify(pdfAnalysis));
      formData.append("instruction", form.instruction);
      formData.append("runMode", "whole_document_core");
      pdfFiles.forEach((file) => formData.append("pdfs", file));

      const response = await fetch("/api/plan", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message ?? "전체 핵심 학습 범위를 결정하지 못했습니다.");
      }

      setWholeDocumentCorePlan(data as WholeDocumentCorePlan);
      setRunMode(experimentRunMode);
      setSelectedFocusGroupId(null);
      resetRecallFlow();
      setNotice("전체 PDF에서 핵심 학습 범위를 결정했습니다.");
    } catch (planningError) {
      setError(
        planningError instanceof Error
          ? planningError.message
          : "전체 핵심 학습 범위를 결정하지 못했습니다.",
      );
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

  async function startStudy(deck: Deck) {
    const studyDeck =
      deck.boardColumn === "new"
        ? {
            ...deck,
            boardColumn: "learning" as const,
            updatedAt: new Date().toISOString(),
          }
        : deck;

    if (studyDeck !== deck) {
      await saveDeck(studyDeck);
      setDecks((items) =>
        items.map((item) => (item.id === studyDeck.id ? studyDeck : item)),
      );
    }
    setSelectedDeck(studyDeck);
    setStudyIndex(0);
    setIsAnswerVisible(false);
    setView("study");
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
    if (!selectedDeck || !currentStudyCard) {
      return;
    }

    const updatedCards = selectedDeck.cards.map((card) =>
      card.id === currentStudyCard.id ? { ...card, status } : card,
    );
    const updatedDeck: Deck = {
      ...selectedDeck,
      boardColumn:
        updatedCards.length > 0 &&
        updatedCards.every((card) => card.status === "known")
          ? "completed"
          : "learning",
      cards: updatedCards,
      updatedAt: new Date().toISOString(),
    };

    await saveDeck(updatedDeck);
    setSelectedDeck(updatedDeck);
    setDecks((items) =>
      items.map((deck) => (deck.id === updatedDeck.id ? updatedDeck : deck)),
    );
    setIsAnswerVisible(false);
    setStudyIndex((index) =>
      Math.min(index + 1, Math.max(updatedDeck.cards.length - 1, 0)),
    );
  }

  return (
    <main className="min-h-screen bg-[#F4F5F7] text-[#172B4D]">
      {isGenerating ? (
        <LoadingOverlay message={loadingPhases[loadingPhaseIndex]} />
      ) : null}
      {isPreparingMaterial ? (
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
            ...(recallDesign &&
            selectedRecallOptionId &&
            selectedRecallVariantId
              ? ["recall"]
              : []),
            ...(learningSample ? ["sample"] : []),
            ...(preparedResult ? ["extract", "organize"] : []),
            ...(pipelineResult && editableCards.length > 0
              ? ["cards", "critic"]
              : []),
            ...(selectedDeck ? ["save"] : []),
          ]}
          onClose={() => setIsPipelineOpen(false)}
        />
      ) : null}

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 bg-[#0C66E4] px-4 shadow-sm">
          <div className="mx-auto flex h-14 max-w-[1800px] items-center gap-5">
            <button
              type="button"
              onClick={() => setView("create")}
              className="flex shrink-0 items-center gap-2 rounded px-2 py-1.5 text-white hover:bg-white/15"
            >
              <span className="grid h-7 w-7 place-items-center rounded bg-white text-[#0C66E4]">
                <BookOpen size={17} />
              </span>
              <span className="text-sm font-black">Study Forge</span>
            </button>

            <nav className="hidden items-center gap-1 md:flex">
              <NavButton active={view === "create"} onClick={() => setView("create")}>
                <Sparkles size={16} />
                자료 생성
              </NavButton>
              <NavButton active={view === "decks"} onClick={() => setView("decks")}>
                <Columns3 size={16} />
                덱 보드
              </NavButton>
              <NavButton
                active={view === "study"}
                onClick={() => setView("study")}
                disabled={!selectedDeck}
              >
                <GraduationCap size={17} />
                학습
              </NavButton>
            </nav>

            <div className="ml-auto flex items-center gap-2">
              <span className="hidden items-center gap-1.5 text-xs font-bold text-white/80 lg:flex">
                <Cloud size={15} />
                이 브라우저에 자동 저장
              </span>
              <button
                type="button"
                onClick={() => setIsPipelineOpen(true)}
                className="inline-flex items-center gap-2 rounded bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/20"
                title="자료 정제 파이프라인 보기"
              >
                <Workflow size={16} />
                <span className="hidden sm:inline">운영자</span>
              </button>
              {showAiDebug && pipelineResult ? (
                <button
                  type="button"
                  onClick={() => setIsDebugOpen(true)}
                  className="rounded bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/20"
                >
                  AI 디버그
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
          <header className="border-b border-[#DCDFE4] bg-white px-5 py-4 shadow-sm">
            <div className="mx-auto flex w-full max-w-[1800px] items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-[#626F86]">
                  {getViewEyebrow(view)}
                </p>
                <h2 className="mt-1 text-2xl font-black text-[#172B4D]">
                  {getViewTitle(
                    view,
                    Boolean(pdfAnalysis),
                    Boolean(preparedResult),
                  )}
                </h2>
              </div>
            </div>
          </header>

          <section className="flex-1 px-5 py-6 pb-24 md:pb-6">
            <div
              className={`mx-auto ${
                view === "create" && pdfFiles.length > 0 && !pdfAnalysis
                  ? "max-w-[1800px]"
                  : view === "decks"
                    ? "max-w-[1500px]"
                    : "max-w-5xl"
              }`}
            >
              {view === "create" ? (
                <CreateView
                  form={form}
                  error={error}
                  notice={notice}
                  isGenerating={isGenerating}
                  isAnalyzingPdfs={isAnalyzingPdfs}
                  analysisProgress={analysisProgress}
                  analysisPhase={pdfAnalysisPhases[analysisPhaseIndex]}
                  pdfFiles={pdfFiles}
                  pdfAnalysis={pdfAnalysis}
                  studyGuideline={studyGuideline}
                  selectedFocusGroupId={selectedFocusGroupId}
                  runMode={runMode}
                  wholeDocumentCorePlan={wholeDocumentCorePlan}
                  hasConfirmedStudyGuideline={Boolean(confirmedStudyGuideline)}
                  isPlanningGuideline={isPlanningGuideline}
                  isPlanningWholeDocument={isPlanningWholeDocument}
                  recallDesign={recallDesign}
                  selectedRecallOptionId={selectedRecallOptionId}
                  selectedRecallVariantId={selectedRecallVariantId}
                  isDesigningRecall={isDesigningRecall}
                  preparedResult={preparedResult}
                  editableMaterial={editableMaterial}
                  setForm={setForm}
                  setEditableMaterial={setEditableMaterial}
                  selectFocusGroup={(id) => {
                    setRunMode("focused_area");
                    setWholeDocumentCorePlan(null);
                    setSelectedFocusGroupId(id);
                    resetRecallFlow();
                  }}
                  selectRecallOption={(optionId, variantId) =>
                    void handleSelectRecallExample(optionId, variantId)
                  }
                  setPdfFiles={setPdfFiles}
                  clearPdfAnalysis={resetAnalysisFlow}
                  clearPreparedResult={() => {
                    setPreparedResult(null);
                    setEditableMaterial(null);
                    setGenerateBaselineTrace(null);
                    setError("");
                    setNotice("");
                  }}
                  handlePrepareMaterial={handlePrepareMaterial}
                  handleGenerate={handleGenerate}
                  handleAnalyzePdfs={handleAnalyzePdfs}
                  handleCreateRecallDesign={handleCreateRecallDesign}
                  requestWholeDocumentCorePlan={(mode) =>
                    void requestWholeDocumentCorePlan(mode)
                  }
                  retryGuideline={() => void requestStudyGuideline()}
                />
              ) : null}
              {view === "review" ? (
                <ReviewView
                  pipelineResult={pipelineResult}
                  editableCards={editableCards}
                  formMode={form.mode}
                  addCard={addCard}
                  removeCard={removeCard}
                  updateCard={updateCard}
                  handleSaveDeck={handleSaveDeck}
                  handleExportBaseline={() => void handleExportBaseline()}
                  isExportingBaseline={isExportingBaseline}
                  goCreate={() => setView("create")}
                  notice={notice}
                  error={error}
                />
              ) : null}
              {view === "decks" ? (
                <DecksView
                  decks={decks}
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
                  startStudy={(deck) => void startStudy(deck)}
                  moveDeck={(id, column) => void moveDeckToColumn(id, column)}
                  deleteDeck={handleDeleteDeck}
                  openDetail={setDetailDeck}
                  goCreate={() => setView("create")}
                />
              ) : null}
              {view === "study" ? (
                <StudyView
                  selectedDeck={selectedDeck}
                  currentStudyCard={currentStudyCard}
                  studyIndex={studyIndex}
                  cardStats={cardStats}
                  isAnswerVisible={isAnswerVisible}
                  setIsAnswerVisible={setIsAnswerVisible}
                  markCard={markCard}
                  goDecks={() => setView("decks")}
                  restartStudy={() => {
                    setStudyIndex(0);
                    setIsAnswerVisible(false);
                  }}
                  goCreate={() => setView("create")}
                />
              ) : null}
            </div>
          </section>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-[#DCDFE4] bg-white p-2 shadow-[0_-2px_8px_rgb(9_30_66/10%)] md:hidden">
        <MobileNavButton active={view === "create"} onClick={() => setView("create")}>
          <Sparkles size={17} /> 생성
        </MobileNavButton>
        <MobileNavButton active={view === "decks"} onClick={() => setView("decks")}>
          <Columns3 size={17} /> 덱
        </MobileNavButton>
        <MobileNavButton
          active={view === "study"}
          onClick={() => setView("study")}
          disabled={!selectedDeck}
        >
          <GraduationCap size={18} /> 학습
        </MobileNavButton>
      </nav>
    </main>
  );
}

function CreateView({
  form,
  error,
  notice,
  isGenerating,
  isAnalyzingPdfs,
  analysisProgress,
  analysisPhase,
  pdfFiles,
  pdfAnalysis,
  studyGuideline,
  selectedFocusGroupId,
  runMode,
  wholeDocumentCorePlan,
  hasConfirmedStudyGuideline,
  isPlanningGuideline,
  isPlanningWholeDocument,
  recallDesign,
  selectedRecallOptionId,
  selectedRecallVariantId,
  isDesigningRecall,
  preparedResult,
  editableMaterial,
  setForm,
  setPdfFiles,
  setEditableMaterial,
  selectFocusGroup,
  selectRecallOption,
  clearPdfAnalysis,
  clearPreparedResult,
  handleGenerate,
  handleAnalyzePdfs,
  handleCreateRecallDesign,
  requestWholeDocumentCorePlan,
  retryGuideline,
}: {
  form: GenerateRequest;
  error: string;
  notice: string;
  isGenerating: boolean;
  isAnalyzingPdfs: boolean;
  analysisProgress: number;
  analysisPhase: string;
  pdfFiles: File[];
  pdfAnalysis: PdfAnalysisResponse | null;
  studyGuideline: StudyGuidelineDraft | null;
  selectedFocusGroupId: string | null;
  runMode: BaselineRunMode;
  wholeDocumentCorePlan: WholeDocumentCorePlan | null;
  hasConfirmedStudyGuideline: boolean;
  isPlanningGuideline: boolean;
  isPlanningWholeDocument: boolean;
  recallDesign: RecallDesignDraft | null;
  selectedRecallOptionId: string | null;
  selectedRecallVariantId: string | null;
  isDesigningRecall: boolean;
  preparedResult: GeneratePipelineResult | null;
  editableMaterial: OrganizedMaterial | null;
  setForm: React.Dispatch<React.SetStateAction<GenerateRequest>>;
  setPdfFiles: (files: File[]) => void;
  setEditableMaterial: React.Dispatch<
    React.SetStateAction<OrganizedMaterial | null>
  >;
  selectFocusGroup: (id: string) => void;
  selectRecallOption: (optionId: string, variantId: string) => void;
  clearPdfAnalysis: () => void;
  clearPreparedResult: () => void;
  handleGenerate: (event: FormEvent<HTMLFormElement>) => void;
  handlePrepareMaterial: (event: FormEvent<HTMLFormElement>) => void;
  handleAnalyzePdfs: () => void;
  handleCreateRecallDesign: () => void;
  requestWholeDocumentCorePlan: (
    mode: "whole_document_core" | "whole_document_core_soft_budget",
  ) => void;
  retryGuideline: () => void;
}) {
  const [surveyPage, setSurveyPage] = useState<"analysis" | "focus" | "recall">(
    "analysis",
  );

  if (!pdfAnalysis) {
    return (
      <form className="space-y-5">
        <Panel>
          <div className="rounded-md border border-dashed border-[#0C66E4]/60 bg-[#0C66E4]/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <FieldLabel>PDF 학습 자료</FieldLabel>
                <p className="mt-1 text-xs leading-5 text-[#44546F]">
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
              className="mt-3 block w-full text-sm text-[#44546F] file:mr-3 file:rounded-md file:border-0 file:bg-[#0C66E4] file:px-3 file:py-2 file:font-black file:text-white hover:file:bg-[#0055CC] disabled:cursor-not-allowed disabled:opacity-50"
            />
            {pdfFiles.length > 0 ? (
              <>
                <div className="mt-3 space-y-1 text-xs text-[#172B4D]">
                  {pdfFiles.map((file) => (
                    <p key={`${file.name}-${file.size}`}>
                      {file.name} ({formatFileSize(file.size)})
                    </p>
                  ))}
                </div>
                <PdfReviewViewer files={pdfFiles} />
              </>
            ) : null}
          </div>

          <label className="mt-5 block space-y-2">
            <FieldLabel>학습 자료</FieldLabel>
            <textarea
              value={form.sourceText}
              disabled={isAnalyzingPdfs}
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  sourceText: event.target.value,
                }))
              }
              className={`${inputClassName} min-h-80 resize-y leading-6 disabled:cursor-not-allowed disabled:opacity-50`}
              placeholder="PDF에 덧붙일 자료나 참고 내용을 입력하세요."
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
        </Panel>

        {isAnalyzingPdfs ? (
          <PdfAnalysisProgress progress={analysisProgress} phase={analysisPhase} />
        ) : null}

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
          <p className="text-sm text-[#44546F]">
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
                onClick={() => setSurveyPage("focus")}
                className="inline-flex items-center gap-2"
              >
                집중 영역 선택 <ChevronRight size={16} />
              </PrimaryButton>
            </div>
          </>
        ) : null}

        {surveyPage === "focus" ? (
          <>
            {studyGuideline ? (
              <StudyGuidelinePanel
                guideline={studyGuideline}
                selectedGroupId={selectedFocusGroupId}
                onSelect={selectFocusGroup}
              />
            ) : (
              <Panel>
                <h3 className="text-base font-black text-[#172B4D]">학습 방향 준비</h3>
                <p className="mt-2 text-sm leading-6 text-[#44546F]">
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
            )}
            {showBaselineExport ? (
              <WholeDocumentCoreExperimentPanel
                runMode={runMode}
                plan={wholeDocumentCorePlan}
                isPlanning={isPlanningWholeDocument}
                onPlan={requestWholeDocumentCorePlan}
              />
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <SecondaryButton
                onClick={() => setSurveyPage("analysis")}
                className="inline-flex items-center gap-2"
              >
                <ChevronLeft size={16} /> 이전
              </SecondaryButton>
              <PrimaryButton
                type="button"
                onClick={() => {
                  setSurveyPage("recall");
                  void handleCreateRecallDesign();
                }}
                className="inline-flex items-center gap-2"
                disabled={
                  !hasConfirmedStudyGuideline ||
                  isPlanningGuideline ||
                  isPlanningWholeDocument ||
                  isDesigningRecall
                }
              >
                대표 예시 선택 <ChevronRight size={16} />
              </PrimaryButton>
            </div>
          </>
        ) : null}

        {surveyPage === "recall" ? (
          <>
            {recallDesign ? (
              <RecallDesignPanel
                design={recallDesign}
                selectedOptionId={selectedRecallOptionId}
                selectedVariantId={selectedRecallVariantId}
                disabled={isGenerating}
                onSelect={selectRecallOption}
              />
            ) : (
              <Panel>
                <h3 className="text-base font-black text-[#172B4D]">
                  {isDesigningRecall
                    ? "대표 예시를 만들고 있습니다"
                    : "대표 예시를 만들지 못했습니다"}
                </h3>
                <p className="mt-2 text-sm leading-6 text-[#44546F]">
                  {isDesigningRecall
                    ? "선택한 영역에서 카드 구조와 슬롯 처리 예시를 준비하고 있습니다."
                    : "오류 내용을 확인한 뒤 다시 시도해 주세요."}
                </p>
                {!isDesigningRecall ? (
                  <SecondaryButton className="mt-4" onClick={handleCreateRecallDesign}>
                    다시 만들기
                  </SecondaryButton>
                ) : null}
              </Panel>
            )}
            <SecondaryButton
              onClick={() => setSurveyPage("focus")}
              className="inline-flex items-center gap-2"
              disabled={isGenerating}
            >
              <ChevronLeft size={16} /> 이전
            </SecondaryButton>
          </>
        ) : null}

        <Feedback error={error} notice={notice} />
      </div>
    );
  }

  return (
    <form onSubmit={handleGenerate} className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <SecondaryButton onClick={clearPreparedResult}>
          지시사항 수정
        </SecondaryButton>
        <p className="text-sm text-[#44546F]">
          카드로 만들 내용을 확인하고 필요한 부분을 수정하세요.
        </p>
      </div>

      <PreparedMaterialEditor
        material={editableMaterial}
        onChange={setEditableMaterial}
      />

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="space-y-2">
          <FieldLabel>암기 방식</FieldLabel>
          <select
            value={form.mode}
            onChange={(event) => {
              const mode = event.target.value as StudyMode;
              setForm((value) => ({
                ...value,
                mode,
              }));
            }}
            className={inputClassName}
          >
            <option value="flashcard">플래시카드</option>
            <option value="cloze">빈칸 문제</option>
            <option value="translation">영작 리콜</option>
          </select>
        </label>

        <PrimaryButton disabled={isGenerating}>
          {isGenerating ? "카드 생성 중" : "AI 카드 생성"}
        </PrimaryButton>
      </div>

      <Feedback error={error} notice={notice} />
    </form>
  );
}

function SurveyPager({
  currentPage,
}: {
  currentPage: "analysis" | "focus" | "recall";
}) {
  const pages = [
    { id: "analysis", label: "분석 결과" },
    { id: "focus", label: "집중 영역" },
    { id: "recall", label: "대표 예시" },
  ] as const;
  const currentIndex = pages.findIndex((page) => page.id === currentPage);

  return (
    <div className="rounded-md border border-[#DCDFE4] bg-white px-4 py-3">
      <div className="flex items-center gap-2" aria-label="학습 설계 진행 단계">
        {pages.map((page, index) => {
          const active = page.id === currentPage;
          const complete = index < currentIndex;
          return (
            <div key={page.id} className="flex min-w-0 flex-1 items-center gap-2">
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-black ${
                  active
                    ? "bg-[#0C66E4] text-white"
                    : complete
                      ? "bg-[#22A06B] text-white"
                      : "bg-[#DCDFE4] text-[#44546F]"
                }`}
              >
                {index + 1}
              </span>
              <span
                className={`truncate text-xs font-bold ${
                  active ? "text-[#172B4D]" : "text-[#626F86]"
                }`}
              >
                {page.label}
              </span>
              {index < pages.length - 1 ? (
                <span className="h-px min-w-3 flex-1 bg-[#DCDFE4]" />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
        <h3 className="text-base font-black text-[#172B4D]">학습 단위 추출 결과</h3>
        <p className="mt-1 text-sm leading-6 text-[#44546F]">
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
            className="rounded-md border border-[#DCDFE4] bg-[#F7F8F9] p-4"
          >
            <div className="flex items-start gap-3">
              <span className="mt-3 shrink-0 text-xs font-black text-[#44546F]">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-3">
                {section.learningUnitIds?.length ? (
                  <p className="text-xs font-bold text-[#0C66E4]">
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
      <div className="border-b border-[#DCDFE4] pb-5">
        <p className="text-xs font-bold uppercase text-[#22A06B]">자료 구조</p>
        <h3 className="mt-2 text-lg font-black text-[#172B4D]">학습 영역 선택</h3>
        <p className="mt-2 text-sm leading-6 text-[#44546F]">
          {guideline.summary}
        </p>
      </div>

      <h4 className="mt-5 text-sm font-black text-[#172B4D]">
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
                  ? "border-[#0C66E4] bg-[#0C66E4]/15"
                  : "border-[#DCDFE4] bg-[#FFFFFF] hover:border-[#8590A2]"
              }`}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="text-sm font-black text-[#172B4D]">
                  {String.fromCharCode(65 + index)}. {group.title}
                </span>
                {recommended ? (
                  <span className="shrink-0 text-[11px] font-bold text-[#22A06B]">
                    추천
                  </span>
                ) : null}
              </span>
              <span className="mt-2 block text-xs leading-5 text-[#44546F]">
                {group.description}
              </span>
              <span className="mt-3 block text-xs font-black text-[#172B4D]">
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
  isPlanning,
  onPlan,
}: {
  runMode: BaselineRunMode;
  plan: WholeDocumentCorePlan | null;
  isPlanning: boolean;
  onPlan: (
    mode: "whole_document_core" | "whole_document_core_soft_budget",
  ) => void;
}) {
  const active = runMode !== "focused_area" && plan;

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase text-[#0C66E4]">
            Baseline Experiment
          </p>
          <h3 className="mt-2 text-base font-black text-[#172B4D]">
            전체 PDF 핵심 자동 선별
          </h3>
          <p className="mt-2 text-sm leading-6 text-[#44546F]">
            영역 하나를 고르지 않고 전체 자료에서 학습 가치와 인출 가치가
            높은 범위를 결정합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton
            onClick={() => onPlan("whole_document_core")}
            disabled={isPlanning}
            className="inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Sparkles size={16} />
            {isPlanning ? "핵심 범위 결정 중" : "Exact count"}
          </SecondaryButton>
          <SecondaryButton
            onClick={() => onPlan("whole_document_core_soft_budget")}
            disabled={isPlanning}
            className="inline-flex items-center gap-2 border-[#0C66E4] text-[#0C66E4] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Sparkles size={16} />
            {isPlanning ? "핵심 범위 결정 중" : "Soft budget 실험"}
          </SecondaryButton>
        </div>
      </div>

      {active ? (
        <div className="mt-5 border-t border-[#DCDFE4] pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-black text-[#172B4D]">{plan.learningGoal}</h4>
            <span className="text-xs font-bold text-[#22A06B]">
              핵심 LearningUnit 약 {plan.estimatedLearningUnitCount}개
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-[#44546F]">
            {plan.selectionRationale}
          </p>
          <div className="mt-4 divide-y divide-[#DCDFE4] border-y border-[#DCDFE4]">
            {plan.areas.map((area) => (
              <div
                key={area.id}
                className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4"
              >
                <div>
                  <p className="text-sm font-black text-[#172B4D]">
                    {area.title}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[#44546F]">
                    {area.description}
                  </p>
                </div>
                <span className="text-xs font-bold text-[#626F86]">
                  {runMode === "whole_document_core_soft_budget"
                    ? `약 ${Math.max(1, area.estimatedLearningUnitCount - 1)}~${area.estimatedLearningUnitCount + 1}개`
                    : `${area.estimatedLearningUnitCount}개`}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function RecallDesignPanel({
  design,
  selectedOptionId,
  selectedVariantId,
  disabled,
  onSelect,
}: {
  design: RecallDesignDraft;
  selectedOptionId: string | null;
  selectedVariantId: string | null;
  disabled: boolean;
  onSelect: (optionId: string, variantId: string) => void;
}) {
  const recommendedIndex = Math.max(
    0,
    design.options.findIndex((option) => option.id === design.recommendedOptionId),
  );
  const [activeIndex, setActiveIndex] = useState(recommendedIndex);
  const option = design.options[activeIndex];

  if (!option) return null;

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase text-[#22A06B]">인출 설계</p>
          <h3 className="mt-2 text-lg font-black text-[#172B4D]">
            {design.question}
          </h3>
        </div>
        <span className="text-xs font-bold text-[#626F86]">
          {activeIndex + 1} / {design.options.length}
        </span>
      </div>

      <div className="mt-5 border-y border-[#DCDFE4] py-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-base font-black text-[#172B4D]">{option.title}</h4>
              {design.recommendedOptionId === option.id ? (
                <span className="text-[11px] font-bold text-[#22A06B]">추천</span>
              ) : null}
            </div>
            <p className="mt-2 text-sm leading-6 text-[#44546F]">
              {option.cue} → {option.target}
            </p>
            <p className="mt-1 text-xs text-[#626F86]">
              {getModeLabel(option.mode)} · 한 장에 {option.unit}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              title="이전 인출 방식"
              aria-label="이전 인출 방식"
              onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
              disabled={activeIndex === 0 || disabled}
              className="grid size-9 place-items-center rounded border border-[#DCDFE4] bg-white text-[#44546F] hover:bg-[#F1F2F4] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              title="다음 인출 방식"
              aria-label="다음 인출 방식"
              onClick={() =>
                setActiveIndex((index) =>
                  Math.min(design.options.length - 1, index + 1),
                )
              }
              disabled={activeIndex === design.options.length - 1 || disabled}
              className="grid size-9 place-items-center rounded border border-[#DCDFE4] bg-white text-[#44546F] hover:bg-[#F1F2F4] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        <p className="mt-5 text-sm font-black text-[#172B4D]">
          변수 자리를 어떻게 학습할까요?
        </p>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {option.variants.map((variant) => {
            const selected =
              selectedOptionId === option.id && selectedVariantId === variant.id;
            return (
              <button
                key={variant.id}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => onSelect(option.id, variant.id)}
                className={`min-h-72 rounded-md border p-4 text-left transition-colors disabled:cursor-wait disabled:opacity-60 ${
                  selected
                    ? "border-[#0C66E4] bg-[#0C66E4]/10"
                    : "border-[#DCDFE4] bg-white hover:border-[#8590A2]"
                }`}
              >
                <span className="block text-sm font-black text-[#172B4D]">
                  {variant.label}
                </span>
                <span className="mt-1 block text-xs leading-5 text-[#626F86]">
                  {variant.description}
                </span>
                <span className="mt-4 block border-l-2 border-[#0C66E4] pl-3">
                  <span className="block text-[11px] font-black text-[#44546F]">앞면</span>
                  <span className="mt-1 block whitespace-pre-wrap text-sm font-bold leading-6 text-[#172B4D]">
                    {variant.sample.cue}
                  </span>
                </span>
                <span className="mt-4 block border-l-2 border-[#22A06B] pl-3">
                  <span className="block text-[11px] font-black text-[#44546F]">뒷면</span>
                  <span className="mt-1 block whitespace-pre-wrap text-sm leading-6 text-[#172B4D]">
                    {variant.sample.target}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

function PdfAnalysisProgress({
  progress,
  phase,
}: {
  progress: number;
  phase: string;
}) {
  return (
    <Panel>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-black text-[#172B4D]">PDF 분석 중</h3>
          <p className="mt-1 text-sm text-[#44546F]">{phase}</p>
        </div>
        <span className="shrink-0 text-sm font-black text-[#172B4D]">
          {progress}%
        </span>
      </div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-[#DCDFE4]">
        <div
          className="h-full rounded-full bg-[#0C66E4] transition-[width] duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
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
          <h3 className="text-base font-black text-[#172B4D]">PDF 분석 결과</h3>
          <p className="mt-1 text-xs leading-5 text-[#44546F]">
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

      <article className="mt-4 rounded-md border border-[#DCDFE4] bg-[#F7F8F9] p-4">
        <h4 className="font-black text-[#172B4D]">{file.fileName}</h4>
        <p className="mt-2 text-sm font-bold text-[#44546F]">
          {file.documentType}
        </p>
        <p className="mt-2 text-sm leading-6 text-[#44546F]">{file.summary}</p>
        <div className="mt-3">
          <p className="text-xs font-bold text-[#44546F]">핵심 주제</p>
          <p className="mt-1 text-sm text-[#172B4D]">
            {file.keyTopics.join(" · ") || "추출된 주제가 없습니다."}
          </p>
        </div>
        <div className="mt-4 space-y-3">
          <p className="text-xs font-bold text-[#44546F]">구조 및 목차식 정리</p>
          {file.outline.map((section, index) => (
            <div key={`${section.heading}-${index}`} className="border-l-2 border-[#0C66E4] pl-3">
              <p className="text-sm font-black text-[#172B4D]">{section.heading}</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-sm leading-5 text-[#44546F]">
                {section.points.map((point, pointIndex) => (
                  <li key={`${point}-${pointIndex}`}>{point}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-4 rounded-md bg-[#F4F5F7] p-3 text-sm leading-6 text-[#44546F]">
          <span className="font-bold text-[#172B4D]">권장 역할: </span>
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
  handleExportBaseline,
  isExportingBaseline,
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
  handleExportBaseline: () => void;
  isExportingBaseline: boolean;
  goCreate: () => void;
  notice: string;
  error: string;
}) {
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[#44546F]">
          {editableCards.length}개 카드 · {getModeLabel(formMode)}
        </p>
        <div className="flex gap-2">
          {showBaselineExport ? (
            <SecondaryButton
              onClick={handleExportBaseline}
              disabled={isExportingBaseline}
              className="inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download size={16} />
              {isExportingBaseline ? "내보내는 중" : "Baseline JSON"}
            </SecondaryButton>
          ) : null}
          <SecondaryButton onClick={addCard}>카드 추가</SecondaryButton>
          <PrimaryButton type="button" onClick={handleSaveDeck}>
            저장하고 학습
          </PrimaryButton>
        </div>
      </div>

      <Feedback error={error} notice={notice} />

      <div className="space-y-3">
        {editableCards.map((card, index) => (
          <Panel key={card.id}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm font-bold text-[#44546F]">
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
            {card.type === "flashcard" || card.type === "translation" ? (
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
            <details className="mt-3 rounded-md border border-[#DCDFE4] bg-[#FFFFFF] p-3">
              <summary className="cursor-pointer text-xs font-bold text-[#44546F]">
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
              </div>
              <div className="mt-3 grid gap-2 rounded-md bg-[#F1F2F4] p-3 text-xs leading-5 text-[#44546F] sm:grid-cols-2">
                <p>
                  <span className="font-black text-[#172B4D]">지식 단위: </span>
                  {card.learningUnitId || "직접 추가한 카드"}
                </p>
                <p>
                  <span className="font-black text-[#172B4D]">카드 전략: </span>
                  {getCardStrategyLabel(card.strategy)}
                </p>
                <p>
                  <span className="font-black text-[#172B4D]">출처: </span>
                  {formatCardSource(card)}
                </p>
                <p>
                  <span className="font-black text-[#172B4D]">난이도: </span>
                  {card.difficulty ? `${card.difficulty}/5` : "미평가"}
                </p>
                <p className="sm:col-span-2">
                  <span className="font-black text-[#172B4D]">설계 이유: </span>
                  {card.rationale || "없음"}
                </p>
                <p className="sm:col-span-2">
                  <span className="font-black text-[#172B4D]">품질 검사: </span>
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
          </Panel>
        ))}
      </div>
    </div>
  );
}

function DecksView({
  decks,
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
  decks: Deck[];
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  if (decks.length === 0) {
    return (
      <EmptyState
        title="저장된 덱이 없습니다."
        body="자료를 생성하고 저장하면 여기에서 다시 학습할 수 있습니다."
        actionLabel="새 자료 생성"
        onAction={goCreate}
      />
    );
  }

  const activeDeck = decks.find((deck) => deck.id === activeDeckId);

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDeckId(null);
    const column = event.over?.data.current?.column as
      | DeckBoardColumn
      | undefined;
    if (column) moveDeck(String(event.active.id), column);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-[#44546F]">내 학습 보드</p>
          <p className="mt-1 text-xs text-[#626F86]">
            덱을 열어 학습하거나 드래그해 진행 상태를 정리하세요.
          </p>
        </div>
        <button
          type="button"
          onClick={goCreate}
          className="inline-flex items-center gap-2 rounded-md bg-[#0C66E4] px-4 py-2.5 text-sm font-black text-white hover:bg-[#0055CC]"
        >
          <Plus size={17} />
          새 자료 생성
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(event) => setActiveDeckId(String(event.active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDeckId(null)}
      >
        <div className="grid auto-cols-[minmax(290px,85vw)] grid-flow-col gap-4 overflow-x-auto pb-3 lg:grid-flow-row lg:grid-cols-3 lg:overflow-visible">
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
    accent: "bg-[#0C66E4]",
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
      className={`min-h-[32rem] rounded-lg border bg-[#F1F2F4] p-3 transition-colors ${
        isOver ? "border-[#388BFF] bg-[#E9F2FF]" : "border-[#DCDFE4]"
      }`}
    >
      <header className="mb-3 flex items-start justify-between gap-3 px-1 py-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${column.accent}`} />
            <h3 className="font-black text-[#172B4D]">{column.title}</h3>
            <span className="rounded-full bg-[#F1F2F4] px-2 py-0.5 text-xs font-bold text-[#44546F]">
              {decks.length}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-[#626F86]">
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
          <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed border-[#B6C2CF] px-4 text-center text-xs leading-5 text-[#7A869A]">
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
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: deck.id });
  const knownCount = deck.cards.filter((card) => card.status === "known").length;
  const progress =
    deck.cards.length === 0
      ? 0
      : Math.round((knownCount / deck.cards.length) * 100);

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`rounded-md border border-[#DCDFE4] bg-white shadow-sm transition ${
        isDragging ? "opacity-30" : "hover:border-[#B6C2CF] hover:shadow-md"
      }`}
    >
      <div className="flex items-start gap-1 p-2 pb-0">
        <button
          type="button"
          className="mt-0.5 flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded text-[#7A869A] hover:bg-[#E9EBEE] hover:text-[#172B4D] active:cursor-grabbing"
          aria-label={`${deck.title} 이동`}
          title="드래그하여 이동"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={17} />
        </button>
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
                className="rounded bg-[#0C66E4] px-3 py-1.5 text-xs font-black text-white"
              >
                저장
              </button>
              <button
                type="button"
                onClick={cancelRename}
                className="rounded px-3 py-1.5 text-xs font-bold text-[#44546F] hover:bg-[#E9EBEE]"
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => startStudy(deck)}
            className="min-w-0 flex-1 rounded px-1 pb-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0C66E4]"
          >
            <span className="block truncate text-sm font-black text-[#172B4D]">
              {deck.title}
            </span>
            <span className="mt-1 block truncate text-xs text-[#44546F]">
              {deck.subject || "과목 없음"} · {getModeLabel(deck.mode)}
            </span>
            <span className="mt-3 flex items-center justify-between text-[11px] font-bold text-[#626F86]">
              <span>{deck.cards.length}개 카드</span>
              <span>{progress}%</span>
            </span>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[#DCDFE4]">
              <span
                className="block h-full rounded-full bg-[#22A06B] transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </span>
          </button>
        )}
      </div>

      {!renaming ? (
        <footer className="flex items-center justify-between border-t border-[#DCDFE4] px-2 py-1.5">
          <span className="px-1 text-[11px] text-[#7A869A]">
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
          ? "text-[#44546F] hover:bg-[#FFECEB] hover:text-[#F87171]"
          : "text-[#626F86] hover:bg-[#E9EBEE] hover:text-[#172B4D]"
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
    <div className="w-72 rounded-md border border-[#388BFF] bg-white p-4 shadow-2xl">
      <p className="truncate text-sm font-black text-[#172B4D]">{deck.title}</p>
      <p className="mt-1 text-xs text-[#44546F]">
        {deck.cards.length}개 카드 · {deck.subject || "과목 없음"}
      </p>
    </div>
  );
}

function StudyView({
  selectedDeck,
  currentStudyCard,
  studyIndex,
  cardStats,
  isAnswerVisible,
  setIsAnswerVisible,
  markCard,
  goDecks,
  restartStudy,
  goCreate,
}: {
  selectedDeck: Deck | null;
  currentStudyCard: Card | undefined;
  studyIndex: number;
  cardStats: { known: number; review: number; total: number };
  isAnswerVisible: boolean;
  setIsAnswerVisible: React.Dispatch<React.SetStateAction<boolean>>;
  markCard: (status: "known" | "review") => Promise<void>;
  goDecks: () => void;
  restartStudy: () => void;
  goCreate: () => void;
}) {
  if (!selectedDeck || !currentStudyCard) {
    return (
      <EmptyState
        title="학습할 덱을 선택하세요."
        body="저장된 덱에서 학습을 시작하거나 새 자료를 생성할 수 있습니다."
        actionLabel="덱 보기"
        onAction={goDecks}
        secondaryLabel="새 자료 생성"
        onSecondary={goCreate}
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[#44546F]">
        <div>
          <h3 className="text-xl font-black text-[#172B4D]">{selectedDeck.title}</h3>
          <p className="mt-1">
            {studyIndex + 1} / {selectedDeck.cards.length}
          </p>
        </div>
        <p>
          알고 있음 {cardStats.known} · 모르겠음 {cardStats.review}
        </p>
      </div>

      <section className="min-h-[360px] rounded-lg border border-[#DCDFE4] bg-[#FFFFFF] p-6 shadow-xl">
        <p className="text-sm font-bold text-[#0C66E4]">
          {getStudyPromptLabel(currentStudyCard.type)}
        </p>
        <div className="mt-8 text-2xl font-black leading-10 text-[#172B4D]">
          {currentStudyCard.type === "flashcard" ||
          currentStudyCard.type === "translation"
            ? currentStudyCard.front
            : renderClozeForStudy(currentStudyCard, isAnswerVisible)}
        </div>

        {isAnswerVisible && currentStudyCard.type !== "cloze" ? (
          <div className="mt-8 border-t border-[#DCDFE4] pt-5">
            <p className="text-sm font-bold text-[#44546F]">
              {currentStudyCard.type === "translation" ? "영어 표현" : "답변"}
            </p>
            <p className="mt-2 text-lg leading-8 text-[#172B4D]">{currentStudyCard.back}</p>
            {currentStudyCard.hint ? (
              <p className="mt-2 text-sm text-[#44546F]">
                힌트: {currentStudyCard.hint}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="grid grid-cols-3 gap-2">
        <SecondaryButton onClick={() => setIsAnswerVisible((visible) => !visible)}>
          답 {isAnswerVisible ? "숨기기" : "보기"}
        </SecondaryButton>
        <button
          type="button"
          onClick={() => void markCard("review")}
          className="rounded-md bg-[#E2B203] px-3 py-3 font-black text-[#172B4D] hover:bg-[#F5CD47]"
        >
          모르겠음
        </button>
        <button
          type="button"
          onClick={() => void markCard("known")}
          className="rounded-md bg-[#22A06B] px-3 py-3 font-black text-white hover:bg-[#1F845A]"
        >
          알고 있음
        </button>
      </div>

      <div className="flex flex-wrap justify-center gap-2 border-t border-[#DCDFE4] pt-4">
        <SecondaryButton onClick={goDecks} className="inline-flex items-center gap-2">
          <ArrowLeft size={16} />
          돌아가기
        </SecondaryButton>
        <SecondaryButton
          onClick={restartStudy}
          className="inline-flex items-center gap-2"
        >
          <RotateCcw size={16} />
          다시보기
        </SecondaryButton>
      </div>
    </div>
  );
}

const inputClassName =
  "w-full rounded-md border border-[#DCDFE4] bg-[#F1F2F4] px-3 py-2 text-[#172B4D] outline-none placeholder:text-[#7A869A] focus:border-[#0C66E4]";

function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[#DCDFE4] bg-[#FFFFFF] p-5 shadow-sm">
      {children}
    </section>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-sm font-bold text-[#172B4D]">{children}</span>;
}

function NavButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-white/20 text-white"
          : "text-white/85 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function MobileNavButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded px-3 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-[#0C66E4] text-white" : "text-[#44546F]"
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
      className={`rounded-md bg-[#0C66E4] px-4 py-2.5 font-black text-white hover:bg-[#0055CC] disabled:cursor-not-allowed disabled:bg-[#B6C2CF] ${props.className ?? ""}`}
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
      className={`rounded-md border border-[#DCDFE4] bg-[#F1F2F4] px-4 py-2.5 font-black text-[#172B4D] hover:bg-[#E9EBEE] ${props.className ?? ""}`}
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
      <span className="text-xs font-bold text-[#44546F]">{label}</span>
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
        <h3 className="text-2xl font-black text-[#172B4D]">{title}</h3>
        <p className="mt-3 text-sm leading-6 text-[#44546F]">{body}</p>
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
      <div className="w-full max-w-sm rounded-lg border border-[#DCDFE4] bg-[#FFFFFF] p-5 text-center shadow-xl">
        <div className="mx-auto flex w-fit gap-1" aria-hidden="true">
          <span className="h-2 w-2 animate-bounce rounded-full bg-[#0C66E4] [animation-delay:-0.2s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-[#0C66E4] [animation-delay:-0.1s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-[#0C66E4]" />
        </div>
        <p className="mt-4 font-black text-[#172B4D]">{message}</p>
        <p className="mt-2 text-sm text-[#44546F]">
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
      <section className="mx-auto max-h-[92vh] max-w-4xl overflow-auto rounded-lg border border-[#DCDFE4] bg-[#FFFFFF] p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-[#172B4D]">
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
      <section className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[#DCDFE4] bg-[#FFFFFF] shadow-xl">
        <div className="border-b border-[#DCDFE4] p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase text-[#44546F]">
                Deck Detail
              </p>
              <h2 className="mt-1 truncate text-xl font-black text-[#172B4D]">
                {deck.title}
              </h2>
              <p className="mt-2 text-sm text-[#44546F]">
                {deck.cards.length}개 · {deck.subject || "과목 없음"} ·{" "}
                {getModeLabel(deck.mode)}
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
                  className="rounded-md border border-[#DCDFE4] bg-[#F1F2F4] p-3"
                >
                  <p className="text-xs font-bold text-[#44546F]">카드 {index + 1}</p>
                  {card.type === "flashcard" || card.type === "translation" ? (
                    <div className="mt-2 space-y-2 text-sm leading-6">
                      <p>
                        <span className="font-bold text-[#44546F]">
                          {card.type === "translation" ? "한국어 cue: " : "질문: "}
                        </span>
                        {card.front}
                      </p>
                      <p>
                        <span className="font-bold text-[#44546F]">
                          {card.type === "translation" ? "영어 표현: " : "답변: "}
                        </span>
                        {card.back}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-2 space-y-2 text-sm leading-6">
                      <p>
                        <span className="font-bold text-[#44546F]">
                          빈칸 문장:{" "}
                        </span>
                        {renderClozeText(card.clozeText ?? "")}
                      </p>
                      <p>
                        <span className="font-bold text-[#44546F]">정답: </span>
                        {formatAnswersForEdit(card).replace(/\n/g, ", ")}
                      </p>
                    </div>
                  )}
                  {card.basis ? (
                    <p className="mt-2 text-xs leading-5 text-[#626F86]">
                      근거: {card.basis}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#626F86]">
                    <span>{getCardStrategyLabel(card.strategy)}</span>
                    <span>{formatCardSource(card)}</span>
                    <span>난이도 {card.difficulty ?? "-"}/5</span>
                    <span>
                      품질 {card.qualityPassed === false ? "확인 필요" : "통과"}
                    </span>
                  </div>
                  {card.rationale ? (
                    <p className="mt-2 text-xs leading-5 text-[#626F86]">
                      설계 이유: {card.rationale}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}

          {tab === "analysis" ? (
            <DetailSection title="1단계 분석 결과">
              <div className="space-y-3 text-sm leading-6 text-[#172B4D]">
                <p>
                  <span className="font-bold text-[#44546F]">학습 목표: </span>
                  {deck.analysis.detectedGoal}
                </p>
                <p>
                  <span className="font-bold text-[#44546F]">자료 성격: </span>
                  {deck.analysis.sourceType}
                </p>
                <p>
                  <span className="font-bold text-[#44546F]">핵심 주제: </span>
                  {deck.analysis.keyTopics.join(", ") || "없음"}
                </p>
                <p>
                  <span className="font-bold text-[#44546F]">추천 전략: </span>
                  {deck.analysis.recommendedStrategy}
                </p>
                <p>
                  <span className="font-bold text-[#44546F]">주요 지식 유형: </span>
                  {getKnowledgeTypeLabel(deck.analysis.primaryKnowledgeType)}
                </p>
                {deck.analysis.learningUnits?.length ? (
                  <div>
                    <p className="font-bold text-[#44546F]">
                      구조화된 학습 단위 {deck.analysis.learningUnits.length}개
                    </p>
                    <div className="mt-2 max-h-96 space-y-2 overflow-y-auto">
                      {deck.analysis.learningUnits.map((unit) => (
                        <article
                          key={unit.id}
                          className="rounded-md border border-[#DCDFE4] bg-[#F7F8F9] p-3"
                        >
                          <div className="flex flex-wrap justify-between gap-2 text-xs">
                            <span className="font-black text-[#172B4D]">
                              {unit.id} · {getKnowledgeTypeLabel(unit.knowledgeType)}
                            </span>
                            <span className="text-[#626F86]">
                              {unit.sourceId}
                              {unit.sourcePage > 0 ? ` · ${unit.sourcePage}쪽` : ""}
                            </span>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-[#172B4D]">
                            {unit.sourceText}
                          </p>
                          {unit.generalizedForm ? (
                            <p className="mt-2 text-[#0C66E4]">
                              일반화: {unit.generalizedForm}
                            </p>
                          ) : null}
                          <p className="mt-2 text-xs text-[#626F86]">
                            {unit.rationale}
                          </p>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : null}
                {deck.analysis.extractedMaterial ? (
                  <div>
                    <p className="font-bold text-[#44546F]">PDF/원문 추출 자료</p>
                    <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-[#DCDFE4] bg-[#F7F8F9] p-3 text-[#44546F]">
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
                    className="rounded-md border border-[#DCDFE4] bg-[#F1F2F4] p-3"
                  >
                    <h4 className="font-black text-[#172B4D]">{section.heading}</h4>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#44546F]">
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
          ? "bg-[#0C66E4] text-white"
          : "border border-[#DCDFE4] bg-[#F1F2F4] text-[#44546F] hover:text-[#172B4D]"
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
      <h3 className="mb-3 text-sm font-black text-[#172B4D]">{title}</h3>
      {children}
    </section>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-bold text-[#44546F]">{label}</dt>
      <dd className="mt-1 break-words text-[#172B4D]">{value}</dd>
    </div>
  );
}

function DebugBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section>
      <h3 className="text-sm font-black text-[#172B4D]">{title}</h3>
      <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-[#172B4D] p-3 text-xs leading-5 text-white">
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
    decks: "덱 목록",
    study: "학습",
  };
  return titles[view];
}

function getViewEyebrow(view: View) {
  const labels: Record<View, string> = {
    create: "Create",
    review: "Review",
    decks: "Decks",
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

function getStudyPromptLabel(mode: StudyMode) {
  const labels: Record<StudyMode, string> = {
    flashcard: "질문",
    cloze: "빈칸 문제",
    translation: "한국어 cue",
  };
  return labels[mode];
}

function getBaselineSourceName(files: File[]) {
  const rawName =
    files.length === 1
      ? files[0].name.replace(/\.pdf$/i, "")
      : `${files.length}-files`;
  return (
    rawName
      .normalize("NFKC")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 60) || "run"
  );
}

function downloadJson(value: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildGenerateRequest(
  form: GenerateRequest,
  tagInput: string,
  pdfFiles: File[],
  pdfAnalysis: PdfAnalysisResponse | null,
  studyGuideline: ConfirmedStudyGuideline,
  recallDesign: ConfirmedRecallDesign,
  approvedSample: LearningUnitSample | null,
  sampleFeedback: string,
  stage: "full" | "sample" | "prepare" = "full",
): RequestInit {
  const tags = parseTags(tagInput);

  if (pdfFiles.length === 0) {
    return {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        tags,
        studyGuideline: JSON.stringify(studyGuideline),
        recallDesign: JSON.stringify(recallDesign),
        approvedSample: approvedSample ? JSON.stringify(approvedSample) : "",
        sampleFeedback,
        stage,
      }),
    };
  }

  const formData = new FormData();
  formData.append("title", form.title);
  formData.append("subject", form.subject);
  formData.append("tags", JSON.stringify(tags));
  formData.append("sourceText", form.sourceText);
  formData.append("instruction", form.instruction);
  formData.append("studyGuideline", JSON.stringify(studyGuideline));
  formData.append("recallDesign", JSON.stringify(recallDesign));
  formData.append(
    "approvedSample",
    approvedSample ? JSON.stringify(approvedSample) : "",
  );
  formData.append("sampleFeedback", sampleFeedback);
  formData.append("stage", stage);
  formData.append(
    "analysisContext",
    pdfAnalysis ? JSON.stringify(pdfAnalysis) : "",
  );
  formData.append("mode", form.mode);
  pdfFiles.forEach((file) => formData.append("pdfs", file));

  return {
    method: "POST",
    body: formData,
  };
}

function buildCardRequest(
  form: GenerateRequest,
  tagInput: string,
  analysis: GeneratePipelineResult["analysis"],
  material: OrganizedMaterial,
  studyGuideline: ConfirmedStudyGuideline,
  recallDesign: ConfirmedRecallDesign,
  approvedSample: LearningUnitSample,
  sampleFeedback: string,
): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...form,
      tags: parseTags(tagInput),
      stage: "cards",
      studyGuideline: JSON.stringify(studyGuideline),
      recallDesign: JSON.stringify(recallDesign),
      approvedSample: JSON.stringify(approvedSample),
      sampleFeedback,
      preparedAnalysis: JSON.stringify(analysis),
      preparedMaterial: JSON.stringify(material),
    }),
  };
}

function buildConfirmedRecallDesign(
  draft: RecallDesignDraft | null,
  selectedOptionId: string | null,
  selectedVariantId: string | null,
): ConfirmedRecallDesign | null {
  if (!draft || !selectedOptionId || !selectedVariantId) {
    return null;
  }

  const selectedOption = draft.options.find(
    (option) => option.id === selectedOptionId,
  );
  const selectedVariant = selectedOption?.variants.find(
    (variant) => variant.id === selectedVariantId,
  );
  return selectedOption && selectedVariant
    ? { selectedOption, selectedVariant }
    : null;
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
      itemCount: plan.estimatedLearningUnitCount,
      itemLabel: "핵심 LearningUnit",
      selectionInstruction: usesSoftBudget
        ? [
            "특정 영역 하나로 제한하지 않고 wholeDocumentCore.areas 전체에서 핵심 단위를 추출합니다.",
            "learningUnitSoftBudget은 대략적인 분량 가이드이며 정확한 개수 계약이 아닙니다.",
            "의미적 완결성과 학습 가치가 soft budget보다 우선합니다.",
            "숫자를 맞추기 위해 독립 대상을 합치거나 낮은 가치 내용을 추가하지 않습니다.",
            "중요한 하위 영역은 누락하지 않고 wholeDocumentCore.exclusions는 핵심 단위로 만들지 않습니다.",
          ].join(" ")
        : [
            "특정 영역 하나로 제한하지 않고 wholeDocumentCore.areas 전체에서 핵심 단위를 추출합니다.",
            "모든 영역을 균등하게 배분하지 말고 learningValue와 estimatedLearningUnitCount의 상대적 비중을 반영합니다.",
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
    target: plan.estimatedLearningUnitCount,
    min: plan.areas.reduce(
      (sum, area) => sum + Math.max(1, area.estimatedLearningUnitCount - 1),
      0,
    ),
    max: plan.areas.reduce(
      (sum, area) => sum + area.estimatedLearningUnitCount + 1,
      0,
    ),
    areas: plan.areas.map((area) => ({
      areaId: area.id,
      target: area.estimatedLearningUnitCount,
      min: Math.max(1, area.estimatedLearningUnitCount - 1),
      max: area.estimatedLearningUnitCount + 1,
    })),
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
        className="mx-1 rounded bg-[#F5CD47] px-1.5 py-0.5 text-[#172B4D]"
      >
        {answer ?? "____"}
      </mark>,
    ];
  });
}
