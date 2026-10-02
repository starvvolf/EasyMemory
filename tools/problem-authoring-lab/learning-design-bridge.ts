import { createHash } from "node:crypto";
import type {
  AssessmentBlueprint,
  ConfirmedStudyGuideline,
  GeneratePipelineResult,
  LearningDesignObjective,
  KnowledgeUnit,
  PdfAnalysisResponse,
} from "../../src/lib/types.ts";
import type { SourceContent } from "./contract.ts";

export type EngineLearningDesignArtifact = {
  schemaVersion: "engine-learning-design-artifact-v1";
  artifactId: string;
  title: string;
  analyze: PdfAnalysisResponse;
  plan: ConfirmedStudyGuideline;
  learningDesignResult: Pick<GeneratePipelineResult, "analysis" | "organizedMaterial" | "cards" | "learningDesign">;
  execution?: {
    sourceFileName: string;
    sourceSha256: string;
    learningGoal: string;
    instruction: string;
    startedAt: string;
    completedAt: string;
    modelConfiguration: unknown;
  };
};

export type LearningDesignAuthoringItem = SourceContent & {
  objective: LearningDesignObjective;
  knowledgeUnit: KnowledgeUnit;
  assessmentBlueprint: AssessmentBlueprint;
  outlineSources: Array<{
    outlineNodeId: string;
    title: string;
    sourceEvidence: string;
    sourceRefs: Array<{ sourceId?: string; fileName: string; pageNumbers: number[] }>;
  }>;
};

export type LearningDesignAuthoringPacket = {
  schemaVersion: "authoring-source-packet-v2";
  packetId: string;
  title: string;
  origin: {
    bridgeVersion: "learning-design-authoring-bridge-v1";
    artifactId: string;
    analyzeSha256: string;
    planSha256: string;
    learningDesignSha256: string;
  };
  context: {
    detectedGoal: string;
    keyTopics: string[];
    planSummary: string;
    learningGoal: string;
    exclusions: string[];
  };
  items: LearningDesignAuthoringItem[];
};

export type LearningDesignBridgeResult = {
  packet: LearningDesignAuthoringPacket;
  report: {
    status: "valid";
    counts: { objectives: number; knowledgeUnits: number; assessmentBlueprints: number; authoringItems: number };
    preserved: string[];
    notForwarded: string[];
  };
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function unique(values: string[]) {
  return new Set(values).size === values.length;
}

export function adaptLearningDesignArtifact(value: unknown): LearningDesignBridgeResult {
  const artifact = value as EngineLearningDesignArtifact;
  invariant(artifact?.schemaVersion === "engine-learning-design-artifact-v1", "지원하지 않는 엔진 산출물 계약입니다.");
  invariant(Boolean(artifact.artifactId?.trim()) && Boolean(artifact.title?.trim()), "산출물 ID와 제목이 필요합니다.");
  const design = artifact.learningDesignResult?.learningDesign;
  invariant(design, "Learning Design 결과가 필요합니다.");
  invariant(Array.isArray(artifact.learningDesignResult.cards) && artifact.learningDesignResult.cards.length === 0, "문제 작성 전 연결에는 기존 카드가 없어야 합니다.");
  invariant(design.objectives.length > 0 && design.knowledgeUnits.length > 0 && design.assessmentBlueprints.length > 0, "목표·지식 단위·평가 설계가 모두 필요합니다.");
  invariant(unique(design.objectives.map((item) => item.id)), "목표 ID가 중복됩니다.");
  invariant(unique(design.knowledgeUnits.map((item) => item.id)), "지식 단위 ID가 중복됩니다.");
  invariant(unique(design.assessmentBlueprints.map((item) => item.id)), "평가 설계 ID가 중복됩니다.");

  const objectiveById = new Map(design.objectives.map((item) => [item.id, item]));
  const unitById = new Map(design.knowledgeUnits.map((item) => [item.id, item]));
  const analysisUnitById = new Map((artifact.learningDesignResult.analysis.learningUnits ?? []).map((item) => [item.id, item]));
  const outlineNodes = artifact.plan.wholeDocumentCore?.learningOutline?.nodes ?? [];
  const outlineById = new Map(outlineNodes.map((item) => [item.id, item]));
  const blueprintUnitIds = design.assessmentBlueprints.map((item) => item.knowledgeUnitId);
  invariant(design.knowledgeUnits.every((unit) => blueprintUnitIds.includes(unit.id)), "평가 설계에서 누락된 지식 단위가 있습니다.");
  invariant(design.objectives.every((objective) => design.knowledgeUnits.some((unit) => unit.objectiveId === objective.id)), "지식 단위에서 누락된 목표가 있습니다.");
  const organizedIds = artifact.learningDesignResult.organizedMaterial.sections.flatMap((section) => section.learningUnitIds ?? []);
  invariant(unique(organizedIds), "검토 자료에 지식 단위가 중복 연결되었습니다.");
  invariant(design.knowledgeUnits.every((unit) => organizedIds.includes(unit.id)), "검토 자료에서 누락된 지식 단위가 있습니다.");
  invariant(organizedIds.every((id) => unitById.has(id)), "검토 자료에 없는 지식 단위 ID가 있습니다.");

  for (const objective of design.objectives) {
    invariant(objective.outlineNodeIds.length > 0, `목표에 원문 목차 연결이 없습니다: ${objective.id}`);
    invariant(objective.outlineNodeIds.every((id) => outlineById.has(id)), `목표가 Plan에 없는 목차를 참조합니다: ${objective.id}`);
  }

  for (const unit of design.knowledgeUnits) {
    const objective = objectiveById.get(unit.objectiveId);
    invariant(objective, `지식 단위가 없는 목표를 참조합니다: ${unit.id}`);
    invariant(unit.outlineNodeIds.length > 0, `지식 단위에 원문 목차 연결이 없습니다: ${unit.id}`);
    invariant(unit.outlineNodeIds.every((id) => objective.outlineNodeIds.includes(id)), `지식 단위와 목표의 원문 목차 연결이 다릅니다: ${unit.id}`);
    const linkedOutline = unit.outlineNodeIds.map((id) => outlineById.get(id));
    invariant(linkedOutline.every(Boolean), `지식 단위가 Plan에 없는 목차를 참조합니다: ${unit.id}`);
    invariant(linkedOutline.some((node) => node!.sourceRefs.some((ref) =>
      (ref.sourceId === unit.sourceId || ref.fileName === unit.sourceId) && ref.pageNumbers.includes(unit.sourcePage)
    )), `지식 단위 원문 출처가 Plan 목차 출처와 다릅니다: ${unit.id}`);
    const analysisUnit = analysisUnitById.get(unit.id);
    invariant(analysisUnit, `Learning Design을 반영한 analysis에 지식 단위가 없습니다: ${unit.id}`);
    invariant(
      analysisUnit.sourceId === unit.sourceId &&
      analysisUnit.sourcePage === unit.sourcePage &&
      analysisUnit.sourceRange === unit.sourceRange &&
      analysisUnit.sourceText === unit.sourceText &&
      analysisUnit.generalizedForm === unit.content &&
      analysisUnit.operation === objective.terminalOperation,
      `analysis와 Learning Design의 지식 단위가 다릅니다: ${unit.id}`,
    );
  }

  const items = design.assessmentBlueprints.map((blueprint) => {
    const unit = unitById.get(blueprint.knowledgeUnitId);
    invariant(unit, `평가 설계가 없는 지식 단위를 참조합니다: ${blueprint.id}`);
    const objective = objectiveById.get(blueprint.objectiveId);
    invariant(objective && objective.id === unit.objectiveId, `평가 설계의 목표 연결이 다릅니다: ${blueprint.id}`);
    const criterionById = new Map(objective.successCriteria.map((criterion) => [criterion.id, criterion]));
    invariant(blueprint.coverageCriterionIds.length > 0, `평가 설계에 성공 기준 연결이 없습니다: ${blueprint.id}`);
    invariant(blueprint.coverageCriterionIds.every((id) => criterionById.has(id)), `평가 설계가 목표에 없는 성공 기준을 참조합니다: ${blueprint.id}`);
    invariant(blueprint.scoringRubric.every((entry) => blueprint.coverageCriterionIds.includes(entry.criterionId)), `채점 기준이 coverage 밖의 성공 기준을 참조합니다: ${blueprint.id}`);
    const linkedOutline = unit.outlineNodeIds.map((id) => outlineById.get(id)!);
    return {
      learningUnitId: unit.id,
      objectiveId: objective.id,
      sourceId: unit.sourceId,
      sourcePage: unit.sourcePage,
      sourceRange: unit.sourceRange,
      sourceText: unit.sourceText,
      target: objective.target,
      successCriteria: blueprint.coverageCriterionIds.map((id) => criterionById.get(id)!.description),
      objective: structuredClone(objective),
      knowledgeUnit: structuredClone(unit),
      assessmentBlueprint: structuredClone(blueprint),
      outlineSources: linkedOutline.map((node) => ({
        outlineNodeId: node.id,
        title: node.title,
        sourceEvidence: node.sourceEvidence,
        sourceRefs: structuredClone(node.sourceRefs),
      })),
    } satisfies LearningDesignAuthoringItem;
  });

  const packet: LearningDesignAuthoringPacket = {
    schemaVersion: "authoring-source-packet-v2",
    packetId: `learning-design-${artifact.artifactId}`,
    title: artifact.title,
    origin: {
      bridgeVersion: "learning-design-authoring-bridge-v1",
      artifactId: artifact.artifactId,
      analyzeSha256: stableHash(artifact.analyze),
      planSha256: stableHash(artifact.plan),
      learningDesignSha256: stableHash(design),
    },
    context: {
      detectedGoal: artifact.learningDesignResult.analysis.detectedGoal,
      keyTopics: structuredClone(artifact.learningDesignResult.analysis.keyTopics),
      planSummary: artifact.plan.summary,
      learningGoal: artifact.plan.wholeDocumentCore?.learningGoal ?? "",
      exclusions: structuredClone(artifact.plan.wholeDocumentCore?.exclusions ?? []),
    },
    items,
  };

  return {
    packet,
    report: {
      status: "valid",
      counts: {
        objectives: design.objectives.length,
        knowledgeUnits: design.knowledgeUnits.length,
        assessmentBlueprints: design.assessmentBlueprints.length,
        authoringItems: items.length,
      },
      preserved: [
        "objective target, operation, importance, and all success criteria",
        "knowledge-unit content, rationale, kind, outline IDs, and exact source fields",
        "assessment blueprint given/hidden/response/rubric/difficulty/capabilities",
        "Plan outline titles, evidence, and source references linked to each unit",
        "Analyze, Plan, and Learning Design hashes for the original artifact",
      ],
      notForwarded: [
        "Analyze presentation metadata and legacy outline points; original artifact remains hash-linked",
        "Plan group question/count UI fields; selected goal and exclusions remain packet context",
        "organizedMaterial display text; its learning-unit coverage is validated before conversion",
        "cards and thread IDs; this bridge accepts only the pre-authoring result with zero cards",
      ],
    },
  };
}
