"use client";

import { getLearningActivityType } from "@/lib/learning-activity";
import { selectNewPublishedMcpDecks } from "@/lib/mcp-deck-import";
import { saveDeck } from "@/lib/storage";
import type { ActivityDesign,ActivitySelectionMode,BaselineRunMode,Card,ConfirmedStudyGuideline,Deck,GeneratePipelineResult,GenerateRequest,LearningActivityType,OrganizedMaterial,PdfAnalysisResponse,StudyGuidelineDraft,StudyMode,WholeDocumentCorePlan } from "@/lib/types";
import { type ReactNode,useState } from "react";
import type { View } from "./study-forge-types";

export const inputClassName =
  "w-full border border-[#4B4F4B] bg-[#242725] px-3 py-2 text-[#F0F2EF] outline-none placeholder:text-[#898E89] focus:border-[#AEB2AD]";

export function Panel({
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

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-sm font-bold text-[#F0F2EF]">{children}</span>;
}

export function NavButton({
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

export function MobileNavButton({
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

export function PrimaryButton({
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

export function SecondaryButton({
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

export function TextField({
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

export function Feedback({ error, notice }: { error: string; notice: string }) {
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

export function EmptyState({
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

export function LoadingOverlay({ message }: { message: string }) {
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

export function DebugModal({
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

export function DeckDetailModal({
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

export function TabButton({
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

export function DetailSection({
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

export function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-bold text-[#B2B6B1]">{label}</dt>
      <dd className="mt-1 break-words text-[#F0F2EF]">{value}</dd>
    </div>
  );
}

export function DebugBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section>
      <h3 className="text-sm font-black text-[#F0F2EF]">{title}</h3>
      <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-[#171A18] p-3 text-xs leading-5 text-[#D8DCD7]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

export function getViewTitle(
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

export function getViewEyebrow(view: View) {
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

export function getModeLabel(mode: StudyMode) {
  const labels: Record<StudyMode, string> = {
    flashcard: "플래시카드",
    cloze: "빈칸 문제",
    translation: "영작 리콜",
  };
  return labels[mode];
}

export function getLearningActivityMixLabel(cards: Card[], fallbackMode: StudyMode) {
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

export function getLearningActivityLabel(type: LearningActivityType) {
  const labels: Record<LearningActivityType, string> = {
    flashcard: "플래시카드",
    cloze: "빈칸",
    true_false: "OX",
    multiple_choice: "객관식",
    structure_recall: "구조복원",
  };
  return labels[type];
}

export function getStudyPromptLabel(mode: StudyMode) {
  const labels: Record<StudyMode, string> = {
    flashcard: "질문",
    cloze: "빈칸 문제",
    translation: "한국어 cue",
  };
  return labels[mode];
}

export function buildGenerateRequest(
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

export function buildLearningPlanGenerationRequest(
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

export function buildActivityDesignRequest(
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

export function buildLearningActivityRequest(
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

export function buildProblemDesignInstruction(
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

export function filterOrganizedMaterial(
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

export function buildConfirmedStudyGuideline(
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

export function buildWholeDocumentCoreGuideline(
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

export function createLearningUnitSoftBudget(plan: WholeDocumentCorePlan) {
  return {
    max: plan.maxLearningUnitCount,
  };
}

export function formatFileSize(size: number) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))}KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

export function parseTags(input: string) {
  return input
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function normalizeCards(cards: Card[]) {
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

export function renderClozeText(text: string) {
  return text.replace(/\{\{c\d+::([^}:]+)(?:::[^}]+)?\}\}/g, "____");
}

export function normalizeClozeText(text: string, answers: string[]) {
  let nextText = renderClozeText(text);
  answers.forEach((answer) => {
    nextText = nextText.replace(answer, "____");
  });
  return nextText;
}

export async function importPublishedMcpDecks(existingDecks: Deck[]) {
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

export async function migrateDeckConceptTreesToProjects(decks: Deck[]) {
  for (const deck of decks) {
    if (!deck.projectId || !deck.conceptTree) continue;
    try {
      await saveDeck(await moveDeckConceptTreeToProject(deck));
    } catch (error) {
      console.warn("기존 학습트리를 프로젝트로 옮기지 못해 덱 내부 트리를 유지합니다.", error);
    }
  }
}

export async function moveDeckConceptTreeToProject(deck: Deck): Promise<Deck> {
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

export function normalizeClozeAnswer(text: string, answer: string) {
  const matches = Array.from(text.matchAll(/\{\{c\d+::([^}:]+)(?:::[^}]+)?\}\}/g));
  return matches.length > 0
    ? matches.map((match) => match[1].trim()).join(", ")
    : answer;
}

export function splitAnswerText(answer: string) {
  return answer
    .split(/\n|,|;|\//)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatAnswersForEdit(card: Card) {
  const answers = card.answers?.length
    ? card.answers
    : splitAnswerText(card.answer ?? "");
  return answers.join("\n");
}

export function getCardStrategyLabel(strategy: Card["strategy"]) {
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

export function getKnowledgeTypeLabel(
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

export function formatCardSource(card: Card) {
  if (!card.sourceId) return "출처 미지정";
  const page = card.sourcePage && card.sourcePage > 0 ? ` · ${card.sourcePage}쪽` : "";
  const range = card.sourceRange ? ` · ${card.sourceRange}` : "";
  return `${card.sourceId}${page}${range}`;
}

export function renderClozeForStudy(card: Card, isAnswerVisible: boolean) {
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
