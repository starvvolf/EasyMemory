"use client";

import { getLearningActivityType,getStructureRecallChoices,getStructureRecallKind,getStructureRecallMode,getSupportedStructureRecallModes,validateLearningActivity } from "@/lib/learning-activity";
import { activityRecommendationKey } from "@/lib/practice-blueprint";
import type { ActivityDesign,ActivitySelectionMode,BaselineRunMode,Card,GeneratePipelineResult,GenerateRequest,LearningActivityType,OrganizedMaterial,PdfAnalysisResponse,SourceExpressionMode,StudyGuidelineDraft,StudyMode,WholeDocumentCorePlan } from "@/lib/types";
import { ChevronLeft,ChevronRight,FileText,Pencil,Sparkles } from "lucide-react";
import { useEffect,useRef,useState } from "react";
import { CompactChoiceRows,CompactLearningOutlineSelector,GenerationProgressFocus } from "../GenerationFocusUI";
import PdfReviewViewer from "../PdfReviewViewer";
import { EmptyState,Feedback,FieldLabel,Panel,PrimaryButton,SecondaryButton,TextField,formatAnswersForEdit,formatCardSource,formatFileSize,getCardStrategyLabel,getLearningActivityLabel,getLearningActivityMixLabel,inputClassName,renderClozeText,splitAnswerText } from "../study-forge-shared";
import { getStructureNodeDepth } from "../study/StudyView";

export function ProjectLearningCreateView(
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

export function CreateView({
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
export function SurveyPager({
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


export function PreparedMaterialEditor({
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

export function StudyGuidelinePanel({
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

export function WholeDocumentCoreExperimentPanel({
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

export function PdfAnalysisPanel({ analysis }: { analysis: PdfAnalysisResponse }) {
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

export function ReviewView({
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

export function LearningActivityPreview({ card, index }: { card: Card; index: number }) {
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

export function GradedActivityReviewFields({
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
