import type { ExperimentRequest } from "../../src/lib/mcp-experiment-requests.ts";
import type { LearningDesignPlan } from "../../src/lib/types.ts";
import type { SourceContent } from "./contract.ts";

/** A completed five-stage request becomes the immutable authoring input; no old 2–7-page fixture rules. */
export function packetFromCompletedRequest(request: ExperimentRequest, sourceRunSha256: string) {
  if (request.status !== "completed" || !request.runId || request.input.stopAfterStage !== "cards" ||
    request.stages.at(-1)?.stage !== "cards" || !request.sourceSnapshot) throw new Error("5단계가 완료된 등록 PDF 요청만 출제 패킷으로 연결할 수 있습니다.");
  const design = (request.stages.find((stage) => stage.stage === "learning-design")?.output as { learningDesign?: LearningDesignPlan } | undefined)?.learningDesign;
  const cardsInputSha256 = request.stages.find((stage) => stage.stage === "cards")?.actual.inputSha256;
  if (!design?.objectives?.length || !design.knowledgeUnits?.length || !cardsInputSha256) throw new Error("학습 설계 또는 카드 단계의 연결 기록이 없습니다.");
  const selectedIds = request.input.selectedObjectiveIds;
  const selected = new Set(selectedIds ?? design.objectives.map((item) => item.id));
  if (selectedIds && selectedIds.some((id) => !design.objectives.some((objective) => objective.id === id))) throw new Error("선택한 목표가 원래 학습 설계에 없습니다.");
  const objectives = new Map(design.objectives.filter((item) => selected.has(item.id)).map((item) => [item.id, item]));
  const pageSet = new Set(request.input.scope.pageNumbers);
  const items = design.knowledgeUnits.filter((unit) => selected.has(unit.objectiveId)).map((unit): SourceContent & { knowledgeContent: string; outlineNodeIds: string[]; conceptNodeIds: string[] } => {
    const objective = objectives.get(unit.objectiveId);
    if (!objective || !pageSet.has(unit.sourcePage) || unit.sourceId !== request.sourceSnapshot!.fileName || !unit.sourceText.trim()) {
      throw new Error(`${unit.id}의 선택 목표·PDF 쪽·원문 연결이 일치하지 않습니다.`);
    }
    return {
      learningUnitId: unit.id, objectiveId: objective.id, sourceId: unit.sourceId, sourcePage: unit.sourcePage,
      sourcePages: [unit.sourcePage], sourceRange: unit.sourceRange.startsWith("PDF ") ? unit.sourceRange : `PDF ${unit.sourcePage}쪽 / ${unit.sourceRange}`,
      sourceText: unit.sourceText, target: objective.target,
      successCriteria: objective.successCriteria.map((criterion) => criterion.description),
      knowledgeContent: unit.content, outlineNodeIds: unit.outlineNodeIds, conceptNodeIds: unit.conceptNodeIds ?? [],
    };
  });
  if (!items.length || [...selected].some((id) => !items.some((item) => item.objectiveId === id))) throw new Error("선택 목표에 연결된 출제 단위가 없습니다.");
  return {
    schemaVersion: "authoring-source-packet-v3",
    packetId: `mcp-${request.runId}`,
    title: request.sourceSnapshot.fileName,
    learningGoal: request.input.purpose,
    sourceFileName: request.sourceSnapshot.fileName,
    selectedPdfPages: [...pageSet].sort((a, b) => a - b),
    origin: { runId: request.runId, publishedId: null, sourceRunSha256, cardsInputSha256, status: "completed-unpublished" },
    authoringRequest: { independentQuestions: items.length, sharedSetQuestions: 0, revisionLimit: 1, format: "author-choice" },
    items,
  } as const;
}
