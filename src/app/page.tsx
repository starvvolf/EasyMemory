"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { deleteDeck, listDecks, saveDeck } from "@/lib/storage";
import { authenticatedFetch } from "@/lib/firebase-client";
import { useAuthSession } from "@/components/AuthGate";
import PdfReviewViewer from "./PdfReviewViewer";
import type {
  Card,
  ConfirmedRecallDesign,
  ConfirmedStudyGuideline,
  Deck,
  PdfAnalysisResponse,
  GeneratePipelineResult,
  GenerateRequest,
  LearningUnitSample,
  OrganizedMaterial,
  RecallDesignDraft,
  StudyGuidelineDraft,
  StudyMode,
} from "@/lib/types";

const showAiDebug = process.env.NEXT_PUBLIC_SHOW_AI_DEBUG === "true";

type View = "create" | "review" | "decks" | "study";

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
  "학습용 정리본을 만들고 있습니다.",
  "선택한 방식에 맞춰 카드로 변환하고 있습니다.",
];

const pdfAnalysisPhases = [
  "업로드한 PDF를 확인하고 있습니다.",
  "문서의 내용과 구조를 읽고 있습니다.",
  "파일별 목차와 핵심 주제를 정리하고 있습니다.",
  "학습 방향을 설계하고 있습니다.",
];

export default function Home() {
  const { canUseAi } = useAuthSession();
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
  const [isPlanningGuideline, setIsPlanningGuideline] = useState(false);
  const [recallDesign, setRecallDesign] = useState<RecallDesignDraft | null>(null);
  const [selectedRecallOptionId, setSelectedRecallOptionId] = useState<
    string | null
  >(null);
  const [learningSample, setLearningSample] =
    useState<LearningUnitSample | null>(null);
  const [sampleFeedback, setSampleFeedback] = useState("");
  const [isDesigningRecall, setIsDesigningRecall] = useState(false);
  const [isGeneratingSample, setIsGeneratingSample] = useState(false);
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
  const [editableCards, setEditableCards] = useState<Card[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [selectedDeck, setSelectedDeck] = useState<Deck | null>(null);
  const [detailDeck, setDetailDeck] = useState<Deck | null>(null);
  const [renamingDeckId, setRenamingDeckId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [studyIndex, setStudyIndex] = useState(0);
  const [isAnswerVisible, setIsAnswerVisible] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingPhaseIndex, setLoadingPhaseIndex] = useState(0);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void refreshDecks();
  }, []);

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

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!preparedResult || !editableMaterial) {
      setError("카드로 만들 학습 내용 추출 결과가 필요합니다.");
      return;
    }

    const confirmedGuideline = buildConfirmedStudyGuideline(
      studyGuideline,
      selectedFocusGroupId,
    );
    if (!confirmedGuideline) {
      setError("학습 방향을 먼저 모두 선택해 주세요.");
      return;
    }
    const confirmedRecall = buildConfirmedRecallDesign(
      recallDesign,
      selectedRecallOptionId,
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
    setEditableCards([]);

    const interval = window.setInterval(() => {
      setLoadingPhaseIndex((index) =>
        Math.min(index + 1, loadingPhases.length - 1),
      );
    }, 1800);

    try {
      const response = await authenticatedFetch(
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

      setPipelineResult(data);
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

    const confirmedGuideline = buildConfirmedStudyGuideline(
      studyGuideline,
      selectedFocusGroupId,
    );
    if (!confirmedGuideline) {
      setIsPreparingMaterial(false);
      setError("학습 방향을 먼저 모두 선택해 주세요.");
      return;
    }
    const confirmedRecall = buildConfirmedRecallDesign(
      recallDesign,
      selectedRecallOptionId,
    );
    if (!confirmedRecall || !learningSample) {
      setIsPreparingMaterial(false);
      setError("인출 방식과 대표 예시를 먼저 확정해 주세요.");
      return;
    }

    try {
      const response = await authenticatedFetch(
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
        throw new Error(data.message ?? "학습 내용 추출에 실패했습니다.");
      }

      setPreparedResult(data);
      setEditableMaterial(data.organizedMaterial);
      setNotice("지시사항을 반영한 학습 내용을 추출했습니다.");
    } catch (prepareError) {
      setError(
        prepareError instanceof Error
          ? prepareError.message
          : "학습 내용 추출에 실패했습니다.",
      );
    } finally {
      setIsPreparingMaterial(false);
    }
  }

  function resetAnalysisFlow() {
    setPdfAnalysis(null);
    setStudyGuideline(null);
    setSelectedFocusGroupId(null);
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
      subject: form.subject.trim(),
      tags: parseTags(tagInput),
      mode: form.mode,
      sourceText: form.sourceText || pipelineResult.analysis.extractedMaterial || "",
      sourceFileName: pdfFiles.map((file) => file.name).join(", ") || undefined,
      instruction: form.instruction,
      studyGuideline:
        buildConfirmedStudyGuideline(studyGuideline, selectedFocusGroupId) ??
        undefined,
      recallDesign:
        buildConfirmedRecallDesign(recallDesign, selectedRecallOptionId) ??
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
      const response = await authenticatedFetch("/api/analyze", {
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
    setLearningSample(null);
    setSampleFeedback("");
    setPreparedResult(null);
    setEditableMaterial(null);
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
      const response = await authenticatedFetch("/api/plan", {
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
    const guideline = buildConfirmedStudyGuideline(
      studyGuideline,
      selectedFocusGroupId,
    );
    if (!pdfAnalysis || !guideline) {
      setError("집중할 학습 영역을 먼저 선택해 주세요.");
      return;
    }

    setError("");
    setNotice("");
    setIsDesigningRecall(true);
    setRecallDesign(null);
    setSelectedRecallOptionId(null);
    setLearningSample(null);
    try {
      const response = await authenticatedFetch("/api/recall-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis: pdfAnalysis, guideline }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message ?? "인출 방식을 설계하지 못했습니다.");
      }

      const draft = data as RecallDesignDraft;
      setRecallDesign(draft);
      setSelectedRecallOptionId(draft.recommendedOptionId);
      setNotice("자료에 맞는 인출 방식을 만들었습니다.");
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

  async function handleGenerateSample() {
    const guideline = buildConfirmedStudyGuideline(
      studyGuideline,
      selectedFocusGroupId,
    );
    const confirmedRecall = buildConfirmedRecallDesign(
      recallDesign,
      selectedRecallOptionId,
    );
    if (!guideline || !confirmedRecall) {
      setError("인출 방식을 먼저 선택해 주세요.");
      return;
    }

    setError("");
    setNotice("");
    setIsGeneratingSample(true);
    setLearningSample(null);
    try {
      const response = await authenticatedFetch(
        "/api/generate",
        buildGenerateRequest(
          form,
          tagInput,
          pdfFiles,
          pdfAnalysis,
          guideline,
          confirmedRecall,
          null,
          "",
          "sample",
        ),
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message ?? "대표 예시를 만들지 못했습니다.");
      }

      setLearningSample(data.sample);
      setNotice("대표 예시를 확인하고 필요한 수정 의견을 남겨 주세요.");
    } catch (sampleError) {
      setError(
        sampleError instanceof Error
          ? sampleError.message
          : "대표 예시를 만들지 못했습니다.",
      );
    } finally {
      setIsGeneratingSample(false);
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

  function startStudy(deck: Deck) {
    setSelectedDeck(deck);
    setStudyIndex(0);
    setIsAnswerVisible(false);
    setView("study");
  }

  async function markCard(status: "known" | "review") {
    if (!selectedDeck || !currentStudyCard) {
      return;
    }

    const updatedDeck: Deck = {
      ...selectedDeck,
      cards: selectedDeck.cards.map((card) =>
        card.id === currentStudyCard.id ? { ...card, status } : card,
      ),
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
    <main className="min-h-screen bg-[#313338] text-[#F2F3F5]">
      {isGenerating ? (
        <LoadingOverlay message={loadingPhases[loadingPhaseIndex]} />
      ) : null}
      {isPreparingMaterial ? (
        <LoadingOverlay message="지시사항을 반영해 학습 내용을 추출하고 있습니다." />
      ) : null}
      {showAiDebug && isDebugOpen && pipelineResult ? (
        <DebugModal result={pipelineResult} onClose={() => setIsDebugOpen(false)} />
      ) : null}
      {detailDeck ? (
        <DeckDetailModal deck={detailDeck} onClose={() => setDetailDeck(null)} />
      ) : null}

      <div className="min-h-screen md:grid md:grid-cols-[232px_minmax(0,1fr)]">
        <aside className="hidden border-r border-[#3F4147] bg-[#1E1F22] px-4 py-5 md:flex md:flex-col">
          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-wider text-[#B5BAC1]">
              Study Forge
            </p>
            <h1 className="mt-2 text-xl font-black text-white">AI 암기자료</h1>
          </div>

          <nav className="space-y-2">
            <NavButton active={view === "create"} onClick={() => setView("create")}>
              + 생성
            </NavButton>
            <NavButton active={view === "decks"} onClick={() => setView("decks")}>
              덱 목록
            </NavButton>
            <NavButton
              active={view === "study"}
              onClick={() => setView("study")}
              disabled={!selectedDeck}
            >
              학습
            </NavButton>
          </nav>

          <div className="mt-auto space-y-2">
            {showAiDebug && pipelineResult ? (
              <button
                type="button"
                onClick={() => setIsDebugOpen(true)}
                className="w-full rounded-md border border-[#3F4147] px-3 py-2 text-left text-sm font-bold text-[#B5BAC1] hover:bg-[#2B2D31] hover:text-white"
              >
                AI 디버그
              </button>
            ) : null}
            <p className="text-xs leading-5 text-[#7D828A]">
              자료 입력, 생성 결과 수정, 저장, 학습을 한 흐름으로 처리합니다.
            </p>
          </div>
        </aside>

        <div className="flex min-h-screen flex-col">
          <header className="sticky top-0 z-20 border-b border-[#3F4147] bg-[#313338]/95 px-5 py-4 backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#B5BAC1]">
                  {getViewEyebrow(view)}
                </p>
                <h2 className="mt-1 text-2xl font-black text-white">
                  {getViewTitle(
                    view,
                    Boolean(pdfAnalysis),
                    Boolean(preparedResult),
                  )}
                </h2>
              </div>
              {showAiDebug && pipelineResult ? (
                <button
                  type="button"
                  onClick={() => setIsDebugOpen(true)}
                  className="rounded-md border border-[#3F4147] bg-[#2B2D31] px-3 py-2 text-xs font-bold text-[#B5BAC1] md:hidden"
                >
                  디버그
                </button>
              ) : null}
            </div>
          </header>

          <section className="flex-1 px-5 py-6 pb-24 md:pb-6">
            <div
              className={`mx-auto ${
                view === "create" && pdfFiles.length > 0 && !pdfAnalysis
                  ? "max-w-[1800px]"
                  : "max-w-5xl"
              }`}
            >
              {view === "create" ? (
                <CreateView
                  canUseAi={canUseAi}
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
                  isPlanningGuideline={isPlanningGuideline}
                  recallDesign={recallDesign}
                  selectedRecallOptionId={selectedRecallOptionId}
                  learningSample={learningSample}
                  sampleFeedback={sampleFeedback}
                  isDesigningRecall={isDesigningRecall}
                  isGeneratingSample={isGeneratingSample}
                  preparedResult={preparedResult}
                  editableMaterial={editableMaterial}
                  setForm={setForm}
                  setEditableMaterial={setEditableMaterial}
                  selectFocusGroup={(id) => {
                    setSelectedFocusGroupId(id);
                    resetRecallFlow();
                  }}
                  selectRecallOption={(id) => {
                    setSelectedRecallOptionId(id);
                    setLearningSample(null);
                    setSampleFeedback("");
                  }}
                  setSampleFeedback={setSampleFeedback}
                  setPdfFiles={setPdfFiles}
                  clearPdfAnalysis={resetAnalysisFlow}
                  clearPreparedResult={() => {
                    setPreparedResult(null);
                    setEditableMaterial(null);
                    setError("");
                    setNotice("");
                  }}
                  handlePrepareMaterial={handlePrepareMaterial}
                  handleGenerate={handleGenerate}
                  handleAnalyzePdfs={handleAnalyzePdfs}
                  handleCreateRecallDesign={handleCreateRecallDesign}
                  handleGenerateSample={handleGenerateSample}
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
                  startStudy={startStudy}
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
                  goCreate={() => setView("create")}
                />
              ) : null}
            </div>
          </section>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-[#3F4147] bg-[#1E1F22] p-2 md:hidden">
        <MobileNavButton active={view === "create"} onClick={() => setView("create")}>
          생성
        </MobileNavButton>
        <MobileNavButton active={view === "decks"} onClick={() => setView("decks")}>
          덱
        </MobileNavButton>
        <MobileNavButton
          active={view === "study"}
          onClick={() => setView("study")}
          disabled={!selectedDeck}
        >
          학습
        </MobileNavButton>
      </nav>
    </main>
  );
}

function CreateView({
  canUseAi,
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
  isPlanningGuideline,
  recallDesign,
  selectedRecallOptionId,
  learningSample,
  sampleFeedback,
  isDesigningRecall,
  isGeneratingSample,
  preparedResult,
  editableMaterial,
  setForm,
  setPdfFiles,
  setEditableMaterial,
  selectFocusGroup,
  selectRecallOption,
  setSampleFeedback,
  clearPdfAnalysis,
  clearPreparedResult,
  handleGenerate,
  handlePrepareMaterial,
  handleAnalyzePdfs,
  handleCreateRecallDesign,
  handleGenerateSample,
  retryGuideline,
}: {
  canUseAi: boolean;
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
  isPlanningGuideline: boolean;
  recallDesign: RecallDesignDraft | null;
  selectedRecallOptionId: string | null;
  learningSample: LearningUnitSample | null;
  sampleFeedback: string;
  isDesigningRecall: boolean;
  isGeneratingSample: boolean;
  preparedResult: GeneratePipelineResult | null;
  editableMaterial: OrganizedMaterial | null;
  setForm: React.Dispatch<React.SetStateAction<GenerateRequest>>;
  setPdfFiles: (files: File[]) => void;
  setEditableMaterial: React.Dispatch<
    React.SetStateAction<OrganizedMaterial | null>
  >;
  selectFocusGroup: (id: string) => void;
  selectRecallOption: (id: string) => void;
  setSampleFeedback: (value: string) => void;
  clearPdfAnalysis: () => void;
  clearPreparedResult: () => void;
  handleGenerate: (event: FormEvent<HTMLFormElement>) => void;
  handlePrepareMaterial: (event: FormEvent<HTMLFormElement>) => void;
  handleAnalyzePdfs: () => void;
  handleCreateRecallDesign: () => void;
  handleGenerateSample: () => void;
  retryGuideline: () => void;
}) {
  if (!pdfAnalysis) {
    return (
      <form className="space-y-5">
        <Panel>
          <div className="rounded-md border border-dashed border-[#5865F2]/60 bg-[#5865F2]/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <FieldLabel>PDF 학습 자료</FieldLabel>
                <p className="mt-1 text-xs leading-5 text-[#B5BAC1]">
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
              className="mt-3 block w-full text-sm text-[#B5BAC1] file:mr-3 file:rounded-md file:border-0 file:bg-[#5865F2] file:px-3 file:py-2 file:font-black file:text-white hover:file:bg-[#4752C4] disabled:cursor-not-allowed disabled:opacity-50"
            />
            {pdfFiles.length > 0 ? (
              <>
                <div className="mt-3 space-y-1 text-xs text-[#F2F3F5]">
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
            disabled={!canUseAi || isAnalyzingPdfs || pdfFiles.length === 0}
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
      <form onSubmit={handlePrepareMaterial} className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <SecondaryButton onClick={clearPdfAnalysis}>
            자료 다시 선택
          </SecondaryButton>
          <p className="text-sm text-[#B5BAC1]">
            {pdfFiles.length}개 PDF 분석 완료
          </p>
        </div>

        <PdfAnalysisPanel analysis={pdfAnalysis} />

        {studyGuideline ? (
          <StudyGuidelinePanel
            guideline={studyGuideline}
            selectedGroupId={selectedFocusGroupId}
            onSelect={selectFocusGroup}
          />
        ) : (
          <Panel>
            <h3 className="text-base font-black text-white">학습 방향 준비</h3>
            <p className="mt-2 text-sm leading-6 text-[#B5BAC1]">
              {isPlanningGuideline
                ? "자료에 맞는 학습 목표와 카드 구성을 정하고 있습니다."
                : "학습 방향을 아직 만들지 못했습니다. 다시 시도해 주세요."}
            </p>
            {!isPlanningGuideline ? (
              <SecondaryButton
                className="mt-4"
                onClick={retryGuideline}
                disabled={!canUseAi}
              >
                학습 방향 다시 만들기
              </SecondaryButton>
            ) : null}
          </Panel>
        )}

        {!recallDesign ? (
          <PrimaryButton
            type="button"
            onClick={handleCreateRecallDesign}
            className="w-full sm:w-auto"
            disabled={
              !studyGuideline ||
              !selectedFocusGroupId ||
              isPlanningGuideline ||
              isDesigningRecall ||
              !canUseAi
            }
          >
            {isDesigningRecall ? "인출 방식 설계 중" : "인출 방식 정하기"}
          </PrimaryButton>
        ) : (
          <RecallDesignPanel
            design={recallDesign}
            selectedOptionId={selectedRecallOptionId}
            onSelect={selectRecallOption}
          />
        )}

        {recallDesign && !learningSample ? (
          <PrimaryButton
            type="button"
            onClick={handleGenerateSample}
            className="w-full sm:w-auto"
            disabled={!canUseAi || !selectedRecallOptionId || isGeneratingSample}
          >
            {isGeneratingSample ? "대표 예시 생성 중" : "대표 예시 1개 만들기"}
          </PrimaryButton>
        ) : null}

        {learningSample ? (
          <>
            <LearningSamplePanel sample={learningSample} />
            <Panel>
              <label className="block space-y-2">
                <FieldLabel>예시에 대한 수정 의견</FieldLabel>
                <textarea
                  value={sampleFeedback}
                  onChange={(event) => setSampleFeedback(event.target.value)}
                  className={`${inputClassName} min-h-28 resize-y text-sm leading-6`}
                  placeholder="예: Cue를 더 짧게 하고, Target에는 영어 패턴과 원문 예문을 함께 넣어 주세요."
                />
              </label>

              <label className="mt-5 block space-y-2">
                <FieldLabel>추가 지시사항</FieldLabel>
                <textarea
                  value={form.instruction}
                  onChange={(event) =>
                    setForm((value) => ({
                      ...value,
                      instruction: event.target.value,
                    }))
                  }
                  className={`${inputClassName} min-h-24 resize-y text-sm leading-6`}
                  placeholder="전체 자료에 함께 적용할 추가 지시가 있다면 입력하세요."
                />
              </label>
            </Panel>

            <PrimaryButton
              className="w-full sm:w-auto"
              disabled={!canUseAi}
            >
              이 구조로 전체 학습 내용 만들기
            </PrimaryButton>
          </>
        ) : null}

        <Feedback error={error} notice={notice} />
      </form>
    );
  }

  return (
    <form onSubmit={handleGenerate} className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <SecondaryButton onClick={clearPreparedResult}>
          지시사항 수정
        </SecondaryButton>
        <p className="text-sm text-[#B5BAC1]">
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

        <PrimaryButton disabled={!canUseAi || isGenerating}>
          {isGenerating ? "카드 생성 중" : "AI 카드 생성"}
        </PrimaryButton>
      </div>

      <Feedback error={error} notice={notice} />
    </form>
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
        <h3 className="text-base font-black text-white">학습 내용 추출 결과</h3>
        <p className="mt-1 text-sm leading-6 text-[#B5BAC1]">
          이 내용만 카드 생성에 사용됩니다. 불필요한 부분을 지우거나 표현을
          다듬은 뒤 생성하세요.
        </p>
      </div>

      <label className="mt-5 block space-y-2">
        <FieldLabel>정리 제목</FieldLabel>
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
            className="rounded-md border border-[#3F4147] bg-[#1E1F22] p-4"
          >
            <div className="flex items-start gap-3">
              <span className="mt-3 shrink-0 text-xs font-black text-[#B5BAC1]">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-3">
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
                  className="text-xs font-bold text-[#F23F42] hover:text-[#FF6B6E]"
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
              { heading: "", content: "" },
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
      <div className="border-b border-[#3F4147] pb-5">
        <p className="text-xs font-bold uppercase text-[#23A559]">자료 구조</p>
        <h3 className="mt-2 text-lg font-black text-white">학습 영역 선택</h3>
        <p className="mt-2 text-sm leading-6 text-[#DBDEE1]">
          {guideline.summary}
        </p>
      </div>

      <h4 className="mt-5 text-sm font-black text-white">
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
                  ? "border-[#5865F2] bg-[#5865F2]/15"
                  : "border-[#3F4147] bg-[#2B2D31] hover:border-[#686D73]"
              }`}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="text-sm font-black text-white">
                  {String.fromCharCode(65 + index)}. {group.title}
                </span>
                {recommended ? (
                  <span className="shrink-0 text-[11px] font-bold text-[#23A559]">
                    추천
                  </span>
                ) : null}
              </span>
              <span className="mt-2 block text-xs leading-5 text-[#B5BAC1]">
                {group.description}
              </span>
              <span className="mt-3 block text-xs font-black text-[#F2F3F5]">
                {group.itemCount}개 {group.itemLabel}
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function RecallDesignPanel({
  design,
  selectedOptionId,
  onSelect,
}: {
  design: RecallDesignDraft;
  selectedOptionId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Panel>
      <p className="text-xs font-bold uppercase text-[#23A559]">인출 설계</p>
      <h3 className="mt-2 text-lg font-black text-white">{design.question}</h3>
      <div className="mt-4 grid gap-2 lg:grid-cols-3">
        {design.options.map((option) => {
          const selected = selectedOptionId === option.id;
          const recommended = design.recommendedOptionId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(option.id)}
              className={`min-h-48 rounded-md border p-4 text-left transition-colors ${
                selected
                  ? "border-[#5865F2] bg-[#5865F2]/15"
                  : "border-[#3F4147] bg-[#2B2D31] hover:border-[#686D73]"
              }`}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="text-sm font-black leading-5 text-white">
                  {option.title}
                </span>
                {recommended ? (
                  <span className="shrink-0 text-[11px] font-bold text-[#23A559]">
                    추천
                  </span>
                ) : null}
              </span>
              <span className="mt-4 block text-xs font-black text-[#B5BAC1]">
                보고
              </span>
              <span className="mt-1 block text-xs leading-5 text-[#F2F3F5]">
                {option.cue}
              </span>
              <span className="mt-3 block text-xs font-black text-[#B5BAC1]">
                인출
              </span>
              <span className="mt-1 block text-xs leading-5 text-[#F2F3F5]">
                {option.target}
              </span>
              <span className="mt-3 block text-xs text-[#949BA4]">
                한 장: {option.unit}
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function LearningSamplePanel({ sample }: { sample: LearningUnitSample }) {
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase text-[#23A559]">대표 예시</p>
          <h3 className="mt-2 text-lg font-black text-white">{sample.title}</h3>
        </div>
        <span className="text-xs font-bold text-[#B5BAC1]">1개만 미리보기</span>
      </div>

      <div className="mt-5 border-y border-[#3F4147] py-4">
        <p className="text-xs font-black text-[#B5BAC1]">보고</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white">
          {sample.cue}
        </p>
      </div>
      <div className="border-b border-[#3F4147] py-4">
        <p className="text-xs font-black text-[#B5BAC1]">인출</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white">
          {sample.target}
        </p>
      </div>
      {sample.supportingInfo ? (
        <div className="pt-4">
          <p className="text-xs font-black text-[#B5BAC1]">참고</p>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#DBDEE1]">
            {sample.supportingInfo}
          </p>
        </div>
      ) : null}
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
          <h3 className="text-base font-black text-white">PDF 분석 중</h3>
          <p className="mt-1 text-sm text-[#B5BAC1]">{phase}</p>
        </div>
        <span className="shrink-0 text-sm font-black text-[#F2F3F5]">
          {progress}%
        </span>
      </div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-[#1E1F22]">
        <div
          className="h-full rounded-full bg-[#5865F2] transition-[width] duration-500"
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
          <h3 className="text-base font-black text-white">PDF 분석 결과</h3>
          <p className="mt-1 text-xs leading-5 text-[#B5BAC1]">
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

      <article className="mt-4 rounded-md border border-[#3F4147] bg-[#1E1F22] p-4">
        <h4 className="font-black text-[#F2F3F5]">{file.fileName}</h4>
        <p className="mt-2 text-sm font-bold text-[#B5BAC1]">
          {file.documentType}
        </p>
        <p className="mt-2 text-sm leading-6 text-[#DCDDDE]">{file.summary}</p>
        <div className="mt-3">
          <p className="text-xs font-bold text-[#B5BAC1]">핵심 주제</p>
          <p className="mt-1 text-sm text-[#F2F3F5]">
            {file.keyTopics.join(" · ") || "추출된 주제가 없습니다."}
          </p>
        </div>
        <div className="mt-4 space-y-3">
          <p className="text-xs font-bold text-[#B5BAC1]">구조 및 목차식 정리</p>
          {file.outline.map((section, index) => (
            <div key={`${section.heading}-${index}`} className="border-l-2 border-[#5865F2] pl-3">
              <p className="text-sm font-black text-[#F2F3F5]">{section.heading}</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-sm leading-5 text-[#DCDDDE]">
                {section.points.map((point, pointIndex) => (
                  <li key={`${point}-${pointIndex}`}>{point}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-4 rounded-md bg-[#313338] p-3 text-sm leading-6 text-[#B5BAC1]">
          <span className="font-bold text-[#F2F3F5]">권장 역할: </span>
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
        <p className="text-sm text-[#B5BAC1]">
          {editableCards.length}개 카드 · {getModeLabel(formMode)}
        </p>
        <div className="flex gap-2">
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
              <span className="text-sm font-bold text-[#B5BAC1]">
                카드 {index + 1}
              </span>
              <button
                type="button"
                onClick={() => removeCard(card.id)}
                className="rounded-md border border-[#F23F42]/40 px-2 py-1 text-sm font-bold text-[#FF777B] hover:bg-[#F23F42]/10"
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
            <details className="mt-3 rounded-md border border-[#3F4147] bg-[#2B2D31] p-3">
              <summary className="cursor-pointer text-xs font-bold text-[#B5BAC1]">
                보조 정보: 힌트, 근거
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
  deleteDeck: (id: string) => void;
  openDetail: (deck: Deck) => void;
  goCreate: () => void;
}) {
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

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <PrimaryButton type="button" onClick={goCreate}>
          새 자료 생성
        </PrimaryButton>
      </div>
      {decks.map((deck) => (
        <Panel key={deck.id}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {renamingDeckId === deck.id ? (
                <div className="flex max-w-xl flex-col gap-2 sm:flex-row">
                  <input
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    className={inputClassName}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <PrimaryButton type="button" onClick={() => void saveRename(deck)}>
                      저장
                    </PrimaryButton>
                    <SecondaryButton onClick={cancelRename}>취소</SecondaryButton>
                  </div>
                </div>
              ) : (
                <h3 className="truncate text-lg font-black text-white">
                  {deck.title}
                </h3>
              )}
              <p className="mt-1 text-sm text-[#B5BAC1]">
                {deck.cards.length}개 · {deck.subject || "과목 없음"} ·{" "}
                {getModeLabel(deck.mode)}
              </p>
              <p className="mt-1 text-xs text-[#949BA4]">
                최근 수정 {new Date(deck.updatedAt).toLocaleString()}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <PrimaryButton type="button" onClick={() => startStudy(deck)}>
                학습 시작
              </PrimaryButton>
              <SecondaryButton onClick={() => openDetail(deck)}>상세 정보</SecondaryButton>
              <SecondaryButton onClick={() => startRename(deck)}>이름 수정</SecondaryButton>
              <SecondaryButton onClick={() => void deleteDeck(deck.id)}>
                삭제
              </SecondaryButton>
            </div>
          </div>
        </Panel>
      ))}
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
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[#B5BAC1]">
        <div>
          <h3 className="text-xl font-black text-white">{selectedDeck.title}</h3>
          <p className="mt-1">
            {studyIndex + 1} / {selectedDeck.cards.length}
          </p>
        </div>
        <p>
          알고 있음 {cardStats.known} · 다시 보기 {cardStats.review}
        </p>
      </div>

      <section className="min-h-[360px] rounded-lg border border-[#3F4147] bg-[#2B2D31] p-6 shadow-xl">
        <p className="text-sm font-bold text-[#5865F2]">
          {getStudyPromptLabel(currentStudyCard.type)}
        </p>
        <div className="mt-8 text-2xl font-black leading-10 text-white">
          {currentStudyCard.type === "flashcard" ||
          currentStudyCard.type === "translation"
            ? currentStudyCard.front
            : renderClozeForStudy(currentStudyCard, isAnswerVisible)}
        </div>

        {isAnswerVisible && currentStudyCard.type !== "cloze" ? (
          <div className="mt-8 border-t border-[#3F4147] pt-5">
            <p className="text-sm font-bold text-[#B5BAC1]">
              {currentStudyCard.type === "translation" ? "영어 표현" : "답변"}
            </p>
            <p className="mt-2 text-lg leading-8 text-white">{currentStudyCard.back}</p>
            {currentStudyCard.hint ? (
              <p className="mt-2 text-sm text-[#B5BAC1]">
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
          className="rounded-md bg-[#F0B232] px-3 py-3 font-black text-[#1E1F22] hover:bg-[#ffd166]"
        >
          다시 보기
        </button>
        <button
          type="button"
          onClick={() => void markCard("known")}
          className="rounded-md bg-[#23A559] px-3 py-3 font-black text-white hover:bg-[#2dc96c]"
        >
          알고 있음
        </button>
      </div>
    </div>
  );
}

const inputClassName =
  "w-full rounded-md border border-[#3F4147] bg-[#383A40] px-3 py-2 text-[#F2F3F5] outline-none placeholder:text-[#7D828A] focus:border-[#5865F2]";

function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[#3F4147] bg-[#2B2D31] p-5 shadow-sm">
      {children}
    </section>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-sm font-bold text-[#F2F3F5]">{children}</span>;
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
      className={`w-full rounded-md px-3 py-2 text-left text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-[#5865F2] text-white"
          : "text-[#B5BAC1] hover:bg-[#2B2D31] hover:text-white"
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
      className={`rounded-md px-3 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-[#5865F2] text-white" : "text-[#B5BAC1]"
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
      className={`rounded-md bg-[#5865F2] px-4 py-2.5 font-black text-white hover:bg-[#4752C4] disabled:cursor-not-allowed disabled:bg-[#4E5058] ${props.className ?? ""}`}
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
      className={`rounded-md border border-[#3F4147] bg-[#383A40] px-4 py-2.5 font-black text-[#F2F3F5] hover:bg-[#404249] disabled:cursor-not-allowed disabled:opacity-40 ${props.className ?? ""}`}
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
      <span className="text-xs font-bold text-[#B5BAC1]">{label}</span>
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
        <p className="rounded-md border border-[#F23F42]/40 bg-[#F23F42]/10 px-3 py-2 text-sm font-bold text-[#FF999C]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-md border border-[#23A559]/40 bg-[#23A559]/10 px-3 py-2 text-sm font-bold text-[#7EE2A8]">
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
        <h3 className="text-2xl font-black text-white">{title}</h3>
        <p className="mt-3 text-sm leading-6 text-[#B5BAC1]">{body}</p>
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
    <div className="fixed inset-0 z-40 grid place-items-center bg-[#1E1F22]/70 px-5">
      <div className="w-full max-w-sm rounded-lg border border-[#3F4147] bg-[#2B2D31] p-5 text-center shadow-xl">
        <div className="mx-auto flex w-fit gap-1" aria-hidden="true">
          <span className="h-2 w-2 animate-bounce rounded-full bg-[#5865F2] [animation-delay:-0.2s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-[#5865F2] [animation-delay:-0.1s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-[#5865F2]" />
        </div>
        <p className="mt-4 font-black text-white">{message}</p>
        <p className="mt-2 text-sm text-[#B5BAC1]">
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
    <div className="fixed inset-0 z-50 bg-[#1E1F22]/75 p-4">
      <section className="mx-auto max-h-[92vh] max-w-4xl overflow-auto rounded-lg border border-[#3F4147] bg-[#2B2D31] p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-white">
            개발용 AI 파이프라인 디버그
          </h2>
          <SecondaryButton onClick={onClose}>닫기</SecondaryButton>
        </div>
        <div className="mt-4 grid gap-4">
          <DebugBlock title="1단계 분석 결과" value={result.analysis} />
          <DebugBlock title="2단계 정리본" value={result.organizedMaterial} />
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1E1F22]/75 p-4">
      <section className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[#3F4147] bg-[#2B2D31] shadow-xl">
        <div className="border-b border-[#3F4147] p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-[#B5BAC1]">
                Deck Detail
              </p>
              <h2 className="mt-1 truncate text-xl font-black text-white">
                {deck.title}
              </h2>
              <p className="mt-2 text-sm text-[#B5BAC1]">
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
              2단계 정리본
            </TabButton>
          </div>

          {tab === "cards" ? (
            <div className="space-y-3">
              {deck.cards.map((card, index) => (
                <article
                  key={card.id}
                  className="rounded-md border border-[#3F4147] bg-[#383A40] p-3"
                >
                  <p className="text-xs font-bold text-[#B5BAC1]">카드 {index + 1}</p>
                  {card.type === "flashcard" || card.type === "translation" ? (
                    <div className="mt-2 space-y-2 text-sm leading-6">
                      <p>
                        <span className="font-bold text-[#B5BAC1]">
                          {card.type === "translation" ? "한국어 cue: " : "질문: "}
                        </span>
                        {card.front}
                      </p>
                      <p>
                        <span className="font-bold text-[#B5BAC1]">
                          {card.type === "translation" ? "영어 표현: " : "답변: "}
                        </span>
                        {card.back}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-2 space-y-2 text-sm leading-6">
                      <p>
                        <span className="font-bold text-[#B5BAC1]">
                          빈칸 문장:{" "}
                        </span>
                        {renderClozeText(card.clozeText ?? "")}
                      </p>
                      <p>
                        <span className="font-bold text-[#B5BAC1]">정답: </span>
                        {formatAnswersForEdit(card).replace(/\n/g, ", ")}
                      </p>
                    </div>
                  )}
                  {card.basis ? (
                    <p className="mt-2 text-xs leading-5 text-[#949BA4]">
                      근거: {card.basis}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}

          {tab === "analysis" ? (
            <DetailSection title="1단계 분석 결과">
              <div className="space-y-3 text-sm leading-6 text-[#F2F3F5]">
                <p>
                  <span className="font-bold text-[#B5BAC1]">학습 목표: </span>
                  {deck.analysis.detectedGoal}
                </p>
                <p>
                  <span className="font-bold text-[#B5BAC1]">자료 성격: </span>
                  {deck.analysis.sourceType}
                </p>
                <p>
                  <span className="font-bold text-[#B5BAC1]">핵심 주제: </span>
                  {deck.analysis.keyTopics.join(", ") || "없음"}
                </p>
                <p>
                  <span className="font-bold text-[#B5BAC1]">추천 전략: </span>
                  {deck.analysis.recommendedStrategy}
                </p>
                {deck.analysis.extractedMaterial ? (
                  <div>
                    <p className="font-bold text-[#B5BAC1]">PDF/원문 추출 자료</p>
                    <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-[#3F4147] bg-[#1E1F22] p-3 text-[#DCDDDE]">
                      {deck.analysis.extractedMaterial}
                    </p>
                  </div>
                ) : null}
              </div>
            </DetailSection>
          ) : null}

          {tab === "organized" ? (
            <DetailSection title="2단계 정리본">
              <div className="space-y-4">
                {deck.organizedMaterial.sections.map((section, index) => (
                  <article
                    key={`${section.heading}-${index}`}
                    className="rounded-md border border-[#3F4147] bg-[#383A40] p-3"
                  >
                    <h4 className="font-black text-white">{section.heading}</h4>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#DCDDDE]">
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
          ? "bg-[#5865F2] text-white"
          : "border border-[#3F4147] bg-[#383A40] text-[#B5BAC1] hover:text-white"
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
      <h3 className="mb-3 text-sm font-black text-[#F2F3F5]">{title}</h3>
      {children}
    </section>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-bold text-[#B5BAC1]">{label}</dt>
      <dd className="mt-1 break-words text-[#F2F3F5]">{value}</dd>
    </div>
  );
}

function DebugBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section>
      <h3 className="text-sm font-black text-[#F2F3F5]">{title}</h3>
      <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-[#1E1F22] p-3 text-xs leading-5 text-[#F2F3F5]">
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
): ConfirmedRecallDesign | null {
  if (!draft || !selectedOptionId) {
    return null;
  }

  const selectedOption = draft.options.find(
    (option) => option.id === selectedOptionId,
  );
  return selectedOption ? { selectedOption } : null;
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
        className="mx-1 rounded bg-[#F0B232] px-1.5 py-0.5 text-[#1E1F22]"
      >
        {answer ?? "____"}
      </mark>,
    ];
  });
}
