"use client";

import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { Braces, Check, Workflow, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ModelConfig = Record<
  "default" | "extraction" | "critic",
  { model: string; reasoningEffort: string }
>;

type PipelineStep = {
  id: string;
  phase: string;
  title: string;
  summary: string;
  endpoint: string;
  input: string;
  output: string;
  systemPrompt?: string;
  userPrompt: string;
  color: string;
  position: { x: number; y: number };
};

const steps: PipelineStep[] = [
  {
    id: "input",
    phase: "INPUT",
    title: "자료 입력",
    summary: "PDF, 보조 텍스트와 사용자 지시사항을 하나의 생성 요청으로 묶습니다.",
    endpoint: "브라우저 상태",
    input: "PDF 최대 20개 · 보조 텍스트 · 사용자 지시사항",
    output: "FormData 또는 GenerateRequest",
    userPrompt:
      "AI 호출 없음\n\n사용자가 선택한 PDF와 직접 입력한 학습 자료를 다음 단계가 사용할 요청 데이터로 구성합니다.",
    color: "#626F86",
    position: { x: 0, y: 0 },
  },
  {
    id: "outline",
    phase: "UNDERSTAND",
    title: "PDF 구조 분석",
    summary: "각 PDF를 읽고 문서 성격, 핵심 주제와 실제 목차 구조를 추출합니다.",
    endpoint: "POST /api/analyze",
    input: "PDF 원본 파일",
    output: "PdfAnalysisResponse",
    systemPrompt:
      "당신은 학습 자료를 읽고 구조를 파악하는 분석가입니다. PDF의 실제 내용만 근거로 파일의 성격과 목차형 구조를 정리합니다. 결과는 한국어 JSON만 반환합니다.",
    userPrompt: [
      "파일명: {{fileName}}",
      "",
      "해야 할 일:",
      "- 자료의 용도를 documentType에 한 문장으로 작성",
      "- 실제 내용에 기반한 2~3문장 요약 작성",
      "- 핵심 주제를 3~8개로 추출",
      "- 실제 장·절·슬라이드 흐름을 목차로 정리",
      "- 이후 카드 생성에서 파일이 맡을 역할 제안",
      "- 문서에 없는 목차나 내용을 추측하지 않음",
    ].join("\n"),
    color: "#0C66E4",
    position: { x: 250, y: 0 },
  },
  {
    id: "focus",
    phase: "DESIGN",
    title: "학습 영역 설계",
    summary: "문서 구조를 겹치지 않는 학습 영역으로 나누고 집중할 부분을 제안합니다.",
    endpoint: "POST /api/plan",
    input: "PdfAnalysisResponse · 사용자 지시사항",
    output: "StudyGuidelineDraft",
    systemPrompt:
      "당신은 문서의 구조를 학습 가능한 영역으로 나누는 학습 설계자입니다. 사용자가 자료의 어느 부분에 집중할지 고를 수 있도록 실제 문서 구조와 개수를 정확히 설명합니다. 결과는 한국어 JSON만 반환합니다.",
    userPrompt: [
      "PDF 구조 분석 결과:",
      "{{pdfAnalysisJson}}",
      "",
      "사용자 추가 지시사항: {{instruction}}",
      "",
      "주요 학습 영역을 서로 겹치지 않게 2~6개로 나눕니다.",
      "실제 장·절과 내용 종류를 기준으로 나누고 단위 개수를 부풀리지 않습니다.",
      "각 영역의 포함·제외 범위를 명확히 쓰고 가장 학습 가치가 높은 영역을 추천합니다.",
    ].join("\n"),
    color: "#6554C0",
    position: { x: 500, y: 0 },
  },
  {
    id: "recall",
    phase: "DESIGN",
    title: "대표 예시 기반 인출 설계",
    summary: "PDF의 실제 학습 단위로 만든 앞면·뒷면 예시를 중심으로 인출 구조를 제안합니다.",
    endpoint: "POST /api/recall-design",
    input: "원문 PDF · PDF 분석 · 확정 학습 영역",
    output: "RecallDesignDraft · option.variants[]",
    systemPrompt:
      "당신은 학습 내용을 인출 훈련으로 설계하는 전문가입니다. 모든 선택지는 사용자가 무엇을 보고 무엇을 머릿속에서 꺼낼지 명확해야 합니다. 이해, 읽기, 복습처럼 인출 대상이 불분명한 활동은 제안하지 않습니다. 결과는 한국어 JSON만 반환합니다.",
    userPrompt: [
      "PDF 구조 분석: {{pdfAnalysisJson}}",
      "선택한 학습 영역: {{selectedGroupJson}}",
      "",
      "이 영역에 적합한 인출 방식 2~3개를 제안합니다.",
      "각 방식마다 변수 자리를 보존한 템플릿과 구체적인 값으로 채운 완성 예문을 함께 만듭니다.",
      "모든 선택지는 Cue → Target 관계여야 하며 전체 학습 단위에 동일한 구조를 적용합니다.",
      "target은 학습자가 직접 말하거나 써서 재생산할 원문 지식이어야 합니다.",
      "언어 자료에서는 영어를 직접 산출하는 능동 인출 방식을 우선합니다.",
    ].join("\n"),
    color: "#C25100",
    position: { x: 500, y: 210 },
  },
  {
    id: "sample",
    phase: "VALIDATE",
    title: "대표 예시 선택",
    summary: "사용자가 실제 앞면·뒷면 예시를 선택하면 해당 구조를 CardContract로 확정합니다.",
    endpoint: "브라우저 상태 · AI 호출 없음",
    input: "RecallDesignDraft.options[].variants[]",
    output: "확정 RecallDesign · SlotMode · LearningUnitSample · CardContract",
    userPrompt: [
      "AI 호출 없음",
      "",
      "선택한 예시의 cue, target, mode, slotMode와 플레이스홀더 보존 정책을 변경 불가능한 카드 계약으로 확정합니다.",
      "선택 즉시 추출, 카드 생성과 Critic 단계를 연속 실행합니다.",
    ].join("\n"),
    color: "#E2B203",
    position: { x: 250, y: 210 },
  },
  {
    id: "extract",
    phase: "REFINE",
    title: "학습 단위 추출·일반화",
    summary: "선택 영역에서 원문 근거가 있는 중립적인 학습 단위만 추출하고 지식 구조를 일반화합니다.",
    endpoint: "POST /api/generate · stage=prepare · analysis",
    input: "원문 PDF · 확정 학습 영역",
    output: "AnalysisResult.learningUnits · extractedMaterial",
    systemPrompt:
      "당신은 학습 자료를 암기 가능한 형태로 바꾸기 전에 자료의 성격과 학습 목적을 분석하는 전문가입니다. PDF가 제공되면 텍스트와 시각 정보에서 학습에 필요한 내용을 읽고, 다음 단계가 그대로 사용할 수 있는 추출 자료를 만듭니다. 결과는 한국어 JSON만 반환합니다.",
    userPrompt: [
      "제목/과목/태그: {{metadata}}",
      "사용자 추가 지시사항: {{instruction}}",
      "사전 구조 분석: {{analysisContext}}",
      "확정 학습 가이드: {{studyGuideline}}",
      "선택 영역만 추출하고 다른 영역은 제외합니다.",
      "itemCount만큼 독립 학습 단위를 빠짐없이 구분합니다.",
      "각 단위를 지식 유형으로 분류하고 원문 출처, 고정/가변 구조, 일반화 형태와 판단 이유를 기록합니다.",
      "패턴, 예문과 스크립트는 요약하지 않고 원문 표현과 번역을 보존합니다.",
      "이 단계에서는 Cue, Target, 질문, 답변 또는 카드 형식을 만들지 않습니다.",
    ].join("\n"),
    color: "#0C66E4",
    position: { x: 0, y: 210 },
  },
  {
    id: "organize",
    phase: "REFINE",
    title: "학습 단위 검토본 구성",
    summary: "서버가 추출한 학습 단위를 AI 재작성 없이 편집 가능한 섹션으로 배치합니다.",
    endpoint: "서버 내부 변환 · AI 호출 없음",
    input: "AnalysisResult.learningUnits",
    output: "편집 가능한 OrganizedMaterial",
    userPrompt: [
      "AI 호출 없음",
      "",
      "각 LearningUnit을 하나의 편집 섹션으로 배치하고 learningUnitId를 연결합니다.",
      "사용자가 수정한 텍스트는 reviewedText로 카드 생성 단계에 전달합니다.",
    ].join("\n"),
    color: "#00875A",
    position: { x: 0, y: 420 },
  },
  {
    id: "cards",
    phase: "GENERATE",
    title: "암기 카드 생성",
    summary: "검토된 학습 단위에 처음으로 Cue와 Target을 적용해 카드를 생성합니다.",
    endpoint: "POST /api/generate · stage=cards",
    input: "수정 완료한 OrganizedMaterial · 카드 유형",
    output: "Card[] · strategy · source · rationale",
    systemPrompt:
      "당신은 정리된 학습 자료를 사용자가 선택한 암기 카드 유형으로 변환하는 전문가입니다. 결과는 한국어 JSON만 반환합니다.",
    userPrompt: [
      "카드 유형: {{mode}}",
      "확정 가이드/인출 방식/대표 예시: {{confirmedDesign}}",
      "반드시 생성할 카드 수: {{selectedGroup.itemCount}}",
      "최종 학습 내용: {{organizedMaterialJson}}",
      "",
      "최종 학습 내용에서만 사실과 표현을 가져옵니다.",
      "독립 학습 단위 하나당 카드 하나를 만들고 앞면은 Cue, 뒷면은 Target으로 구성합니다.",
      "지식 유형에 따라 production, recognition, concept, contrast, procedure, application 전략을 선택합니다.",
      "대표 예시와 사용자 피드백의 구조를 모든 카드에 동일하게 적용합니다.",
      "중복 카드를 만들지 않고 원문 출처, 근거와 전략 선택 이유를 기록합니다.",
    ].join("\n"),
    color: "#22A06B",
    position: { x: 250, y: 420 },
  },
  {
    id: "critic",
    phase: "VERIFY",
    title: "카드 품질 검사",
    summary: "각 카드를 원문 학습 단위와 대조하고 인출 품질이 낮은 카드를 수정합니다.",
    endpoint: "POST /api/generate · stage=cards · critic",
    input: "LearningUnit[] · 생성 Card[]",
    output: "검수 완료 Card[] · qualityPassed · qualityNotes",
    systemPrompt:
      "당신은 암기 카드 품질 검사자입니다. 원문 학습 단위와 생성된 카드를 대조해 문제가 있는 카드는 직접 수정합니다. 결과는 한국어 JSON만 반환합니다.",
    userPrompt: [
      "구조화 학습 단위: {{learningUnits}}",
      "검사할 카드: {{generatedCards}}",
      "",
      "능동 인출 가능성, 한 카드 한 개념, 답변 길이, 재사용성, 원문 근거, 전략 적합성을 검사합니다.",
      "문제가 있으면 직접 수정하고 qualityNotes에 이유를 기록합니다.",
    ].join("\n"),
    color: "#BF63F3",
    position: { x: 500, y: 420 },
  },
  {
    id: "save",
    phase: "OUTPUT",
    title: "덱 카드 저장",
    summary: "생성 결과와 설계 이력을 하나의 덱으로 저장하고 보드의 새 덱 카드로 표시합니다.",
    endpoint: "IndexedDB · memory-transformer/decks",
    input: "GeneratePipelineResult · 확정 설계 · Card[]",
    output: "Deck · boardColumn=new",
    userPrompt:
      "AI 호출 없음\n\n사용자가 검토한 카드, 분석 결과, 정리본, 학습 가이드와 인출 설계를 하나의 Deck 객체로 저장합니다.",
    color: "#172B4D",
    position: { x: 750, y: 420 },
  },
];

const edges: Edge[] = [
  ["input", "outline", "PDF"],
  ["outline", "focus", "구조 JSON"],
  ["focus", "recall", "선택 영역"],
  ["recall", "sample", "인출 계약"],
  ["sample", "extract", "승인 예시"],
  ["extract", "organize", "LearningUnit[]"],
  ["organize", "cards", "검토 단위"],
  ["cards", "critic", "초안 카드"],
  ["critic", "save", "검수 카드"],
].map(([source, target, label]) => ({
  id: `${source}-${target}`,
  source,
  target,
  label,
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed, color: "#8590A2" },
  style: { stroke: "#8590A2", strokeWidth: 2 },
  labelStyle: { fill: "#44546F", fontSize: 11, fontWeight: 700 },
  labelBgStyle: { fill: "#F4F5F7", fillOpacity: 0.92 },
}));

export default function PipelineOperatorModal({
  completedNodeIds,
  onClose,
}: {
  completedNodeIds: string[];
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState("outline");
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null);
  const selected = steps.find((step) => step.id === selectedId) ?? steps[0];
  const modelSlot = getModelSlot(selected.id);
  const selectedModel = modelSlot === "none" ? null : modelConfig?.[modelSlot];

  useEffect(() => {
    let active = true;
    void fetch("/api/model-config")
      .then((response) => {
        if (!response.ok) throw new Error("모델 설정을 불러오지 못했습니다.");
        return response.json() as Promise<ModelConfig>;
      })
      .then((config) => {
        if (active) setModelConfig(config);
      })
      .catch(() => {
        if (active) setModelConfig(null);
      });
    return () => {
      active = false;
    };
  }, []);
  const completed = useMemo(
    () => new Set(completedNodeIds),
    [completedNodeIds],
  );
  const nodes = useMemo<Node[]>(
    () =>
      steps.map((step) => ({
        id: step.id,
        position: step.position,
        data: {
          label: (
            <div className="text-left">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black text-[#626F86]">
                  {step.phase}
                </span>
                {completed.has(step.id) ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-black text-[#1F845A]">
                    <Check size={11} /> 완료
                  </span>
                ) : null}
              </div>
              <strong className="mt-1 block text-sm text-[#172B4D]">
                {step.title}
              </strong>
              <span className="mt-1 block text-[11px] leading-4 text-[#626F86]">
                {step.output}
              </span>
            </div>
          ),
        },
        style: {
          width: 205,
          borderRadius: 6,
          border: `2px solid ${selectedId === step.id ? step.color : "#DCDFE4"}`,
          background: completed.has(step.id) ? "#F3FFF8" : "#FFFFFF",
          boxShadow:
            selectedId === step.id
              ? `inset 5px 0 0 ${step.color}, 0 0 0 3px rgb(12 102 228 / 14%)`
              : `inset 5px 0 0 ${step.color}, 0 1px 2px rgb(9 30 66 / 12%)`,
          padding: 12,
        },
      })),
    [completed, selectedId],
  );

  return (
    <div className="fixed inset-0 z-50 bg-[#091E42]/60 p-3 backdrop-blur-[1px] sm:p-5">
      <section className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden rounded-lg bg-[#F4F5F7] shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-[#DCDFE4] bg-white px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-[#E9F2FF] text-[#0C66E4]">
              <Workflow size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold text-[#626F86]">OPERATOR</p>
              <h2 className="truncate text-lg font-black text-[#172B4D]">
                자료 정제 파이프라인
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded text-[#626F86] hover:bg-[#E9EBEE] hover:text-[#172B4D]"
            aria-label="운영자 화면 닫기"
            title="닫기"
          >
            <X size={20} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(24rem,55vh)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_410px] lg:grid-rows-1">
          <div className="min-h-0 border-b border-[#DCDFE4] bg-[#F4F5F7] lg:border-b-0 lg:border-r">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodeClick={(_, node) => setSelectedId(node.id)}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              fitView
              fitViewOptions={{ padding: 0.14 }}
              minZoom={0.45}
              maxZoom={1.6}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#B6C2CF" gap={22} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>

          <aside className="min-h-0 overflow-y-auto bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black" style={{ color: selected.color }}>
                  {selected.phase}
                </p>
                <h3 className="mt-1 text-xl font-black text-[#172B4D]">
                  {selected.title}
                </h3>
              </div>
              {completed.has(selected.id) ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded bg-[#DCFFF1] px-2 py-1 text-xs font-black text-[#1F845A]">
                  <Check size={13} /> 완료
                </span>
              ) : (
                <span className="shrink-0 rounded bg-[#F1F2F4] px-2 py-1 text-xs font-bold text-[#626F86]">
                  대기
                </span>
              )}
            </div>

            <p className="mt-3 text-sm leading-6 text-[#44546F]">
              {selected.summary}
            </p>

            <dl className="mt-5 space-y-3 rounded-md border border-[#DCDFE4] bg-[#F7F8F9] p-4 text-sm">
              <PipelineMeta label="실행 위치" value={selected.endpoint} />
              <PipelineMeta
                label="사용 모델"
                value={
                  modelSlot === "none"
                    ? "AI 호출 없음"
                    : selectedModel?.model ?? "설정 확인 중"
                }
              />
              {selectedModel ? (
                <PipelineMeta
                  label="추론 강도"
                  value={selectedModel.reasoningEffort}
                />
              ) : null}
              <PipelineMeta label="입력" value={selected.input} />
              <PipelineMeta label="출력" value={selected.output} />
            </dl>

            <PromptBlock
              title="시스템 프롬프트"
              value={selected.systemPrompt ?? "이 단계에서는 AI를 호출하지 않습니다."}
            />
            <PromptBlock title="사용자 프롬프트 템플릿" value={selected.userPrompt} />

            <p className="mt-4 text-xs leading-5 text-[#7A869A]">
              중괄호로 표시된 값은 실행 시 현재 PDF 분석 결과와 사용자 선택값으로
              치환됩니다. API 키와 원본 파일 데이터는 이 화면에 표시하지 않습니다.
            </p>
          </aside>
        </div>
      </section>
    </div>
  );
}

function getModelSlot(stepId: string): "none" | "default" | "extraction" | "critic" {
  if (stepId === "input" || stepId === "save") return "none";
  if (stepId === "sample") return "none";
  if (stepId === "organize") return "none";
  if (stepId === "extract") return "extraction";
  if (stepId === "critic") return "critic";
  return "default";
}

function PipelineMeta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold text-[#626F86]">{label}</dt>
      <dd className="mt-1 break-words font-bold text-[#172B4D]">{value}</dd>
    </div>
  );
}

function PromptBlock({ title, value }: { title: string; value: string }) {
  return (
    <section className="mt-5">
      <h4 className="flex items-center gap-2 text-sm font-black text-[#172B4D]">
        <Braces size={16} className="text-[#0C66E4]" />
        {title}
      </h4>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-[#172B4D] p-4 text-xs leading-5 text-white">
        {value}
      </pre>
    </section>
  );
}
