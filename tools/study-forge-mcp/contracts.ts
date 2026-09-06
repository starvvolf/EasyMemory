import { z } from "zod";
import {
  combineSourceOutlines,
  pdfAnalysisResponseSchema,
} from "../../src/lib/pipeline/analyze.ts";
import {
  learningOutlineSchema,
  studyGuidelineDraftSchema,
  wholeDocumentCoreSchema,
} from "../../src/lib/pipeline/plan.ts";
import {
  activityDesignSchema,
  activityAuthoringResultSchema,
  analysisSchema,
  cardsSchema,
  generatedCardsContentSchema,
  finalizeActivityDesignResult,
  organizedMaterialSchema,
  materializeCards,
  buildReviewMaterial,
  parseActivityDesign,
  selectLearningUnitsForCards,
  validateBlueprintItem,
} from "../../src/lib/pipeline/generate.ts";
import {
  hydrateGeneratedCardContent,
  type GeneratedCardContent,
} from "../../src/lib/pipeline/compact-card-output.ts";
import {
  assertActivityDesignReady,
  assertGenerationSelectionReady,
  assertLearningUnitsReady,
} from "../../src/lib/pipeline/preflight.ts";
import { validateLearningActivity } from "../../src/lib/learning-activity.ts";
import {
  defaultGenerationPolicy,
  getRendererCapabilities,
} from "../../src/lib/practice-blueprint.ts";
import type { GenerationStage } from "./types.ts";

export const prepareResultSchema = z.object({
  analysis: analysisSchema,
  organizedMaterial: organizedMaterialSchema,
});

const schemaByStage = {
  analyze: pdfAnalysisResponseSchema,
  plan: studyGuidelineDraftSchema,
  prepare: analysisSchema,
  "activity-design": activityAuthoringResultSchema,
  cards: generatedCardsContentSchema,
} as const;

export function stageOutputJsonSchema(
  stage: GenerationStage,
  runMode: "focused_area" | "whole_document_core" | "whole_document_core_soft_budget" = "focused_area",
) {
  const schema = stage === "plan" && runMode !== "focused_area"
    ? wholeDocumentCoreSchema
    : schemaByStage[stage];
  return z.toJSONSchema(schema, {
    target: "draft-07",
    io: "input",
    unrepresentable: "any",
  });
}

export function stageValidationGuidance(
  stage: GenerationStage,
  outputContract: Record<string, unknown>,
  runMode: "focused_area" | "whole_document_core" | "whole_document_core_soft_budget" = "focused_area",
) {
  return {
    rules: stage === "plan" && runMode !== "focused_area"
      ? wholeDocumentPlanRules
      : stageRules[stage],
    enumValuesByPath: collectEnumValues(outputContract),
    activitySupport:
      stage === "activity-design" || stage === "cards"
        ? {
            sourceExpressionMode: "adapt",
            rendererCapabilities: getRendererCapabilities(),
            automaticGenerationPolicy: defaultGenerationPolicy,
            responseCapabilityMappings: {
              flashcard: {
                structured_text: "short_text",
                numeric: "short_text",
              },
              true_false: {
                single_choice: "boolean_choice",
              },
            },
            classificationRules: [
              "필수 입력 capability 또는 기대 응답 capability를 renderer가 지원하지 않으면, audio/code/graph_annotation/numeric/checklist 누락은 unsupported이고 그 밖의 누락은 proxy입니다.",
              "목표 operation과 renderer가 맞고 relationToObjective=direct이며 채점 capability도 지원하면 exact입니다. 단, flashcard의 자기채점 apply는 exact가 아니라 scaffold입니다.",
              "apply + flashcard + expectedResponse가 short_text/structured_text/numeric이면 자기채점 scaffold로 지원할 수 있습니다. 실제 음성 자동채점이 필수가 아니라면 requiredCapabilities에 audio를 넣지 마세요.",
              "relationToObjective=proxy이면 proxy입니다. relationToObjective=scaffold이거나 operation과 renderer가 맞으면 scaffold이고, 나머지는 proxy입니다.",
              "서버는 제출된 supportAssessment와 supportLevel을 blueprint에서 다시 계산합니다. 추천 라벨로 판정을 강제할 수 없습니다.",
              "자동 흐름은 exact와 scaffold만 포함합니다. proxy와 unsupported는 includeInGeneration=true로 제출하면 거부됩니다.",
            ],
          }
        : null,
  };
}

const stageRules: Record<GenerationStage, string[]> = {
  analyze: [
    "structureTags는 enumValuesByPath에 나온 값만 사용하고 노드당 최대 4개로 제한합니다. 실제 구조가 없으면 빈 배열을 사용합니다.",
    "sourceOutline node ID는 파일 안에서 고유해야 하고 parentId는 같은 파일의 실제 node ID 또는 null이어야 합니다.",
    "모든 sourceRefs.fileName은 해당 files 항목의 fileName과 같아야 하며 페이지 근거는 원문에 존재해야 합니다.",
  ],
  plan: [
    "group ID는 고유해야 하고 recommendedGroupId는 실제 groups 중 하나를 가리켜야 합니다.",
    "분석 결과와 학습 목표에서 서로 구분되는 선택 영역만 만들고 원문에 없는 범위를 추가하지 않습니다.",
  ],
  prepare: [
    "LearningUnit ID는 고유해야 하고 sourceId와 sourceRange 및 최종 학습내용이 비어 있으면 안 됩니다.",
    "organizedMaterial에는 모든 LearningUnit ID를 정확히 한 번씩 연결하고 존재하지 않는 ID를 넣지 않습니다.",
    "학습자가 실제로 값을 넣어 말하거나 적용해야 한다면 operation=apply를 유지합니다. 현재 renderer가 직접 채점하지 못한다는 이유로 recall로 낮추지 않습니다.",
    "반복 예시는 공통 패턴의 근거로 사용하되 variableSlots와 generalizedForm을 통해 고정 부분과 교체 자리를 구분합니다.",
    "시험 대비·전체 범위 목표라면 analyze의 핵심 주제와 plan의 추천 범위를 먼저 coverage audit하고, 중요 개념을 간결함이나 카드 수 감소만을 이유로 누락하지 않습니다. 각 핵심 주제는 적어도 하나의 LearningUnit에 근거로 연결합니다.",
  ],
  "activity-design": [
    "최소 제출 형식은 LearningUnit별 recommendations입니다. objectives, blueprints, supportAssessments, policy를 생략하면 서버가 기존 계약으로 파생·검증하므로 지원 수준을 모델이 직접 계산할 필요가 없습니다.",
    "각 LearningUnit에는 연결된 LearningObjective와 PracticeBlueprint가 있어야 하고 모든 필수 successCriterion ID가 coverageCriterionIds에 포함되어야 합니다.",
    "objective.terminalOperation은 prepare의 LearningUnit.operation을 보존하고, blueprint가 더 낮은 연습이면 relationToObjective=scaffold로 정직하게 표시합니다.",
    "requiredCapabilities에는 실제 renderer가 제공해야 하는 기능만 씁니다. 대괄호 템플릿의 교체 자리는 일반 텍스트이므로 dynamic_slot 같은 임의 capability를 추가하지 않습니다.",
    "최종 수행을 자동 채점할 수 없어도 구체 입력을 front에 주고 먼저 수행한 뒤 back과 비교하는 flashcard 자기채점 scaffold를 설계할 수 있습니다.",
    "지원 부족을 피하려고 prepare의 apply 목표를 템플릿 문자 자체의 recall로 바꾸지 않습니다. activitySupport의 실제 판정 규칙에 맞춰 blueprint를 설계합니다.",
  ],
  cards: [
    "includeInGeneration=true인 LearningUnit마다 카드가 정확히 한 장 필요하며 LearningUnit ID는 중복될 수 없습니다.",
    "type은 자료 mode와 같아야 하고 activityType은 Activity Design의 recommendedType과 같아야 합니다.",
    "sourceId/sourcePage/sourceRange와 objectiveId/blueprintId는 앞 단계 연결을 그대로 유지합니다.",
    "정답은 front에 노출하지 않고, template slotMode이면 변수 자리를 유지하며 filled_example이면 모든 변수를 구체 값으로 채웁니다.",
    "카드의 실제 학습 행동이 blueprint의 expectedResponse와 scoringRubric을 충족해야 합니다.",
  ],
};

const wholeDocumentPlanRules = [
  "areas는 사용자가 선택한 원문 범위 안의 서로 다른 핵심 의미 범위만 포함하고, 예시·반복·학습 방법·문서 안내는 학습목표 자체가 아닌 한 exclusions에 둡니다.",
  "maxLearningUnitCount는 채울 목표가 아니라 과다 추출 안전선이며, 독립적으로 질문·판정할 핵심 단위를 수용하는 상한입니다.",
  "원문 목차는 서버가 Analyze 결과와 사용자 선택에서 그대로 연결하므로 결과에 learningOutline을 다시 작성하지 않습니다.",
];

function collectEnumValues(schema: unknown) {
  const valuesByPath: Record<string, unknown[]> = {};
  const root = schema;
  const visitedReferences = new Set<string>();

  function visit(value: unknown, currentPath: string) {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, currentPath));
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.$ref === "string") {
      const referenceKey = `${currentPath}:${record.$ref}`;
      if (!visitedReferences.has(referenceKey)) {
        visitedReferences.add(referenceKey);
        const referenced = resolveJsonPointer(root, record.$ref);
        if (referenced !== undefined) visit(referenced, currentPath);
      }
    }
    if (Array.isArray(record.enum)) {
      addValues(currentPath, record.enum);
    }
    if (Object.hasOwn(record, "const")) {
      addValues(currentPath, [record.const]);
    }
    if (record.properties && typeof record.properties === "object") {
      for (const [key, child] of Object.entries(record.properties)) {
        visit(child, `${currentPath}.${key}`);
      }
    }
    if (record.items) visit(record.items, `${currentPath}[]`);
    for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
      if (Array.isArray(record[keyword])) {
        record[keyword].forEach((child) => visit(child, currentPath));
      }
    }
  }

  function addValues(path: string, values: unknown[]) {
    const existing = valuesByPath[path] ?? [];
    for (const value of values) {
      if (!existing.some((item) => Object.is(item, value))) existing.push(value);
    }
    valuesByPath[path] = existing;
  }

  visit(schema, "$result");
  return valuesByPath;
}

function resolveJsonPointer(root: unknown, reference: string) {
  if (!reference.startsWith("#/")) return undefined;
  return reference
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>((current, part) => {
      if (!current || typeof current !== "object") return undefined;
      return (current as Record<string, unknown>)[part];
    }, root);
}

export function validateStageResult(
  stage: GenerationStage,
  result: unknown,
  prior: Partial<Record<GenerationStage, unknown>>,
  mode: "flashcard" | "cloze" | "translation" = "flashcard",
  activitySelectionMode: "automatic" | "manual" = "automatic",
  runMode: "focused_area" | "whole_document_core" | "whole_document_core_soft_budget" = "focused_area",
  selectedSourceOutline?: unknown,
  prepareTitle = "",
) {
  if (stage === "analyze") return validateAnalyze(result);
  if (stage === "plan") {
    return runMode === "focused_area"
      ? validatePlan(result)
      : validateWholeDocumentPlan(result, selectedSourceOutline);
  }
  if (stage === "prepare") return validatePrepare(result, prepareTitle);
  if (stage === "activity-design") {
    const prepared = prepareResultSchema.parse(prior.prepare);
    const units = selectLearningUnitsForCards(
      prepared.analysis,
      prepared.organizedMaterial,
    );
    const normalized = finalizeActivityDesignResult(result, units);
    assertActivityDesignReady(units, normalized);
    assertGenerationSelectionReady({
      selections: normalized.recommendations,
      automatic: activitySelectionMode === "automatic",
    });
    return normalized;
  }

  return validateCards(result, prior, mode);
}

function validateWholeDocumentPlan(result: unknown, selectedSourceOutline: unknown) {
  const parsed = wholeDocumentCoreSchema.parse(result);
  if (!selectedSourceOutline) return parsed;
  const outline = learningOutlineSchema.parse(selectedSourceOutline);
  const selectedLeafCount = outline.nodes.filter((node) => node.selectedByDefault).length;
  return {
    ...parsed,
    learningOutline: outline,
    maxLearningUnitCount: Math.max(parsed.maxLearningUnitCount, selectedLeafCount),
  };
}

function validateAnalyze(result: unknown) {
  const parsed = pdfAnalysisResponseSchema.parse(result);
  for (const file of parsed.files) {
    validateUniqueIds(file.sourceOutline.nodes.map((node) => node.id), "원문 목차");
    const nodeIds = new Set(file.sourceOutline.nodes.map((node) => node.id));
    for (const node of file.sourceOutline.nodes) {
      if (node.parentId && !nodeIds.has(node.parentId)) {
        throw new Error(`원문 목차의 부모 ID가 없습니다: ${node.parentId}`);
      }
      if (node.sourceRefs.some((ref) => ref.fileName !== file.fileName)) {
        throw new Error(`원문 목차의 파일 연결이 잘못되었습니다: ${node.id}`);
      }
    }
  }
  return {
    ...parsed,
    sourceOutline: parsed.sourceOutline ?? combineSourceOutlines(parsed.files),
  };
}

function validatePlan(result: unknown) {
  const parsed = studyGuidelineDraftSchema.parse(result);
  validateUniqueIds(parsed.groups.map((group) => group.id), "학습 영역");
  if (!parsed.groups.some((group) => group.id === parsed.recommendedGroupId)) {
    throw new Error("recommendedGroupId가 groups에 존재하지 않습니다.");
  }
  return parsed;
}

function validatePrepare(result: unknown, title: string) {
  const analysis = analysisSchema.parse(result);
  const parsed = prepareResultSchema.parse({
    analysis,
    organizedMaterial: buildReviewMaterial({
      title,
      subject: "",
      tags: [],
      sourceText: "",
      instruction: "",
      analysisContext: "",
      studyGuideline: "",
      activityDesign: "",
      activitySelectionMode: "automatic",
      stage: "prepare",
      preparedAnalysis: "",
      preparedMaterial: "",
      mode: "flashcard",
    }, analysis),
  });
  const units = parsed.analysis.learningUnits;
  assertLearningUnitsReady({ learningUnits: units });
  const unitIds = new Set(units.map((unit) => unit.id));
  const mappedIds = parsed.organizedMaterial.sections.flatMap(
    (section) => section.learningUnitIds,
  );
  validateUniqueIds(mappedIds, "정리본의 학습내용 연결");
  if (mappedIds.some((id) => !unitIds.has(id))) {
    throw new Error("정리본에 존재하지 않는 LearningUnit ID가 있습니다.");
  }
  if (units.some((unit) => !mappedIds.includes(unit.id))) {
    throw new Error("정리본에서 누락된 LearningUnit이 있습니다.");
  }
  return parsed;
}

function validateCards(
  result: unknown,
  prior: Partial<Record<GenerationStage, unknown>>,
  mode: "flashcard" | "cloze" | "translation",
) {
  const compact = generatedCardsContentSchema.parse(result);
  const prepared = prepareResultSchema.parse(prior.prepare);
  const units = selectLearningUnitsForCards(
    prepared.analysis,
    prepared.organizedMaterial,
  );
  const design = parseActivityDesign(
    JSON.stringify(activityDesignSchema.parse(prior["activity-design"])),
    units,
  );
  const included = design.recommendations.filter(
    (item) => item.includeInGeneration,
  );
  const expectedIds = included.map((item) => item.learningUnitId).sort();
  const actualIds = compact.cards.map((card) => card.learningUnitId).sort();
  validateUniqueIds(actualIds, "카드의 LearningUnit 연결");
  if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) {
    throw new Error("포함하기로 한 LearningUnit마다 카드가 정확히 하나씩 필요합니다.");
  }

  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const recommendationByUnitId = new Map(
    included.map((item) => [item.learningUnitId, item]),
  );
  const blueprintById = new Map(
    (design.blueprints ?? []).map((blueprint) => [blueprint.id, blueprint]),
  );

  const hydrated = compact.cards.map((draft) => {
    const unit = unitById.get(draft.learningUnitId);
    const recommendation = recommendationByUnitId.get(draft.learningUnitId);
    if (!unit || !recommendation) {
      throw new Error(`카드 출처 연결을 확인할 수 없습니다: ${draft.learningUnitId}`);
    }
    if (draft.activityType !== recommendation.recommendedType) {
      throw new Error(`카드 형식이 Activity Design과 다릅니다: ${draft.learningUnitId}`);
    }
    return hydrateGeneratedCardContent(draft as GeneratedCardContent, {
      analysis: prepared.analysis,
      learningUnit: unit,
      recommendation,
    });
  });
  const parsed = cardsSchema.parse({ cards: hydrated });
  const materialized = materializeCards(parsed.cards, mode);

  parsed.cards.forEach((draft, index) => {
    const unit = unitById.get(draft.learningUnitId);
    const recommendation = recommendationByUnitId.get(draft.learningUnitId);
    if (!unit || !recommendation) {
      throw new Error(`카드 출처 연결을 확인할 수 없습니다: ${draft.learningUnitId}`);
    }
    if (draft.type !== mode) {
      throw new Error(`카드 mode가 자료 설정과 다릅니다: ${draft.learningUnitId}`);
    }
    if (draft.activityType !== recommendation.recommendedType) {
      throw new Error(`카드 형식이 Activity Design과 다릅니다: ${draft.learningUnitId}`);
    }
    if (
      draft.sourceId !== unit.sourceId ||
      draft.sourcePage !== unit.sourcePage ||
      draft.sourceRange !== unit.sourceRange
    ) {
      throw new Error(`카드의 원문 출처가 LearningUnit과 다릅니다: ${draft.learningUnitId}`);
    }
    const activityIssues = validateLearningActivity(materialized[index]);
    if (activityIssues.length > 0) {
      throw new Error(`${draft.learningUnitId}: ${activityIssues.join(" ")}`);
    }
    const blueprint = recommendation.blueprintId
      ? blueprintById.get(recommendation.blueprintId)
      : undefined;
    if (blueprint) {
      const issues = validateBlueprintItem(materialized[index], blueprint, unit);
      if (issues.length > 0) {
        throw new Error(`${draft.learningUnitId}: ${issues.join(" ")}`);
      }
    }
  });
  return parsed;
}

function validateUniqueIds(ids: string[], label: string) {
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label}에 중복 ID가 있습니다.`);
  }
}

