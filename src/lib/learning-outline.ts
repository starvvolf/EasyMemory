import type {
  LearningOutlineNode,
  WholeDocumentCorePlan,
} from "./types.ts";
import { getSelectableOutlineLeafIds } from "./outline-selection.ts";

export function getDefaultOutlineSelection(plan: WholeDocumentCorePlan) {
  return getDefaultNodeSelection(plan.learningOutline?.nodes ?? []);
}

export function getDefaultNodeSelection(nodes: LearningOutlineNode[]) {
  const leafIds = getSelectableOutlineLeafIds(nodes);
  const preferredIds = nodes
    .filter((node) => node.selectedByDefault && leafIds.includes(node.id))
    .map((node) => node.id);
  return preferredIds.length > 0 ? preferredIds : leafIds;
}

export function filterOutlineToSelection(
  outline: { title: string; summary: string; nodes: LearningOutlineNode[] },
  selectedLeafIds: string[],
) {
  const selected = new Set(selectedLeafIds);
  const includedIds = new Set(selectedLeafIds);
  const nodesById = new Map(outline.nodes.map((node) => [node.id, node]));
  for (const id of selectedLeafIds) {
    let parentId = nodesById.get(id)?.parentId ?? null;
    while (parentId) {
      includedIds.add(parentId);
      parentId = nodesById.get(parentId)?.parentId ?? null;
    }
  }
  return {
    ...outline,
    nodes: outline.nodes
      .filter((node) => includedIds.has(node.id))
      .map((node) => ({
        ...node,
        selectedByDefault: selected.has(node.id),
      })),
  };
}

export function buildSelectedOutlineSourceText(
  nodes: LearningOutlineNode[],
  selectedLeafIds: string[],
) {
  const selected = new Set(selectedLeafIds);
  return nodes
    .filter((node) => selected.has(node.id))
    .sort((left, right) => left.order - right.order)
    .map((node) => {
      const refs = node.sourceRefs
        .map((ref) => `${ref.fileName} p.${ref.pageNumbers.join(",")}`)
        .join("; ");
      return [
        `## ${node.title}`,
        refs ? `출처: ${refs}` : "",
        node.sourceEvidence.trim(),
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

export function filterPlanToOutlineSelection(
  plan: WholeDocumentCorePlan,
  selectedLeafIds: string[],
): WholeDocumentCorePlan {
  if (!plan.learningOutline) return plan;
  const selected = new Set(selectedLeafIds);
  const includedIds = new Set(selectedLeafIds);
  const nodesById = new Map(plan.learningOutline.nodes.map((node) => [node.id, node]));
  for (const id of selectedLeafIds) {
    let parentId = nodesById.get(id)?.parentId ?? null;
    while (parentId) {
      includedIds.add(parentId);
      parentId = nodesById.get(parentId)?.parentId ?? null;
    }
  }
  return {
    ...plan,
    learningOutline: {
      ...plan.learningOutline,
      nodes: plan.learningOutline.nodes
        .filter((node) => includedIds.has(node.id))
        .map((node) => ({
          ...node,
          selectedByDefault: selected.has(node.id),
        })),
    },
  };
}
