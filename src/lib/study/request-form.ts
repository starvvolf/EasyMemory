// 되짚기 "자료" 탭의 출제 요청 양식. /mcp-runs의 "생성 조건 설정"과 같은 기본값으로 요청 본문을 만든다.
// 요청은 대기 목록에 저장만 하고, 실제 생성은 담당 AI가 MCP로 가져가 실행한다.
import type { ExperimentRequest } from "../mcp-experiment-requests.ts";
import type { LearningDesignPlan } from "../types.ts";

export const requestStages = ["analyze", "concept-tree", "learning-design", "activity-design", "cards"] as const;
export const defaultPurpose = "자료의 핵심을 시험에 대비해 오래 기억하고 적용한다.";
const defaultSetting = { model: "gpt-6-sol", effort: "medium" } as const;

export type RequestSource = {
  id: string;
  pageCount: number;
  outline: { status: "recorded"; value: unknown } | { status: string };
};

export function parsePageSelection(value: string, pageCount: number): { pages: number[]; error: string } {
  if (!value.trim()) return { pages: [], error: "" };
  const pages = new Set<number>();
  for (const part of value.split(",").map((item) => item.trim())) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!match) return { pages: [], error: "쪽 범위는 2-7, 10 같은 형식으로 입력하세요." };
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end > pageCount || start > end) return { pages: [], error: `1~${pageCount}쪽 안에서 순서대로 선택하세요.` };
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  return { pages: [...pages].sort((a, b) => a - b), error: "" };
}

type OutlineNode = { id?: unknown; parentId?: unknown; sourceRefs?: unknown };

/** Leaf outline items that touch the chosen pages — the same default /mcp-runs selects. */
export function eligibleLeafIds(source: RequestSource, pages: number[]): string[] {
  if (source.outline.status !== "recorded" || !("value" in source.outline)) return [];
  const value = source.outline.value as { nodes?: unknown } | null;
  const nodes = Array.isArray(value?.nodes) ? (value.nodes as OutlineNode[]) : [];
  const parents = new Set(nodes.map((node) => String(node.parentId ?? "")).filter(Boolean));
  const chosen = new Set(pages);
  return nodes.filter((node) => typeof node.id === "string" && !parents.has(node.id) &&
    Array.isArray(node.sourceRefs) && node.sourceRefs.some((ref: { pageNumbers?: unknown }) =>
      Array.isArray(ref?.pageNumbers) && ref.pageNumbers.some((page) => chosen.has(Number(page)))))
    .map((node) => node.id as string);
}

export function buildRequestBody(
  source: RequestSource,
  pageText: string,
  purpose: string,
  options: {
    stopAfterStage?: (typeof requestStages)[number];
    reuse?: { kind: "output"; runId: string; stage: "learning-design"; sha256: string };
    selectedObjectiveIds?: string[];
  } = {},
) {
  const parsed = parsePageSelection(pageText, source.pageCount);
  if (parsed.error) return { error: parsed.error } as const;
  if (!parsed.pages.length) return { error: "학습할 쪽을 입력하세요." } as const;
  if (!purpose.trim()) return { error: "학습 목적을 적어 주세요." } as const;
  const stopAfterStage = options.stopAfterStage ?? "cards";
  const lastStage = requestStages.indexOf(stopAfterStage);
  return {
    body: {
      sourceId: source.id,
      scope: { pageNumbers: parsed.pages, outlineLeafIds: eligibleLeafIds(source, parsed.pages) },
      purpose: purpose.trim(),
      requestedStages: Object.fromEntries(requestStages.slice(0, lastStage + 1).map((stage) => [stage, { ...defaultSetting }])),
      stopAfterStage,
      ...(options.reuse ? { reuse: options.reuse } : {}),
      ...(options.selectedObjectiveIds ? { selectedObjectiveIds: options.selectedObjectiveIds } : {}),
    },
  } as const;
}

export function objectivesFromCompletedRequest(request: ExperimentRequest) {
  const stage = request.stages.find((item) => item.stage === "learning-design");
  const output = stage?.output as { learningDesign?: LearningDesignPlan } | undefined;
  const design = output?.learningDesign;
  if (!stage || !design?.objectives?.length) throw new Error("완료된 요청에 학습목표가 없습니다.");
  return {
    hash: stage.actual.outputSha256,
    objectives: design.objectives.map((objective) => {
      const units = design.knowledgeUnits.filter((unit) => unit.objectiveId === objective.id);
      return {
        id: objective.id,
        statement: objective.target,
        kind: objective.terminalOperation,
        importance: objective.importance >= 2 ? "core" as const : "support" as const,
        pages: [...new Set(units.map((unit) => unit.sourcePage))].sort((a, b) => a - b),
        quote: units[0]?.sourceText ?? "",
      };
    }),
  };
}
