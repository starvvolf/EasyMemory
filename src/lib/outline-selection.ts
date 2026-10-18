import type { LearningStructureTag } from "./types.ts";

export type LearningOutlineNode = {
  id: string;
  parentId: string | null;
  order: number;
  title: string;
  summary?: string;
  structureTags?: LearningStructureTag[];
  importance?: 0 | 1 | 2 | 3;
};

export type OutlineNodeSelectionState = "selected" | "partial" | "unselected";

export function getSelectableOutlineLeafIds(
  nodes: readonly LearningOutlineNode[],
): string[] {
  const leafIds: string[] = [];

  function visit(node: LearningOutlineNode, ancestors: ReadonlySet<string>) {
    if (ancestors.has(node.id)) return;
    const children = getChildOutlineNodes(nodes, node.id);
    if (children.length === 0) {
      leafIds.push(node.id);
      return;
    }

    const nextAncestors = new Set(ancestors).add(node.id);
    children.forEach((child) => visit(child, nextAncestors));
  }

  getRootOutlineNodes(nodes).forEach((node) => visit(node, new Set()));
  return leafIds;
}

export function getDescendantOutlineLeafIds(
  nodes: readonly LearningOutlineNode[],
  nodeId: string,
): string[] {
  const childrenByParentId = groupChildren(nodes);
  const leafIds: string[] = [];

  function visit(id: string, ancestors: ReadonlySet<string>) {
    if (ancestors.has(id)) return;
    const children = childrenByParentId.get(id) ?? [];
    if (children.length === 0) {
      if (nodes.some((node) => node.id === id)) leafIds.push(id);
      return;
    }

    const nextAncestors = new Set(ancestors).add(id);
    children.forEach((child) => visit(child.id, nextAncestors));
  }

  visit(nodeId, new Set());
  return leafIds;
}

export function getOutlineNodeSelectionState(
  nodes: readonly LearningOutlineNode[],
  selectedLeafIds: readonly string[],
  nodeId: string,
): OutlineNodeSelectionState {
  const descendantLeafIds = getDescendantOutlineLeafIds(nodes, nodeId);
  const selected = new Set(selectedLeafIds);
  const selectedCount = descendantLeafIds.filter((id) => selected.has(id)).length;

  if (selectedCount === 0) return "unselected";
  if (selectedCount === descendantLeafIds.length) return "selected";
  return "partial";
}

export function toggleOutlineNodeSelection(
  nodes: readonly LearningOutlineNode[],
  selectedLeafIds: readonly string[],
  nodeId: string,
): string[] {
  const allLeafIds = getSelectableOutlineLeafIds(nodes);
  const descendantLeafIds = new Set(getDescendantOutlineLeafIds(nodes, nodeId));
  if (descendantLeafIds.size === 0) return selectedLeafIds.filter((id) => allLeafIds.includes(id));

  const selected = new Set(selectedLeafIds.filter((id) => allLeafIds.includes(id)));
  const shouldDeselect = [...descendantLeafIds].every((id) => selected.has(id));
  descendantLeafIds.forEach((id) => {
    if (shouldDeselect) selected.delete(id);
    else selected.add(id);
  });

  return allLeafIds.filter((id) => selected.has(id));
}

export function validateOutlineSelection(
  nodes: readonly LearningOutlineNode[],
  selectedLeafIds: readonly string[],
): string[] {
  const leafIds = new Set(getSelectableOutlineLeafIds(nodes));
  const errors: string[] = [];

  if (selectedLeafIds.length === 0) {
    errors.push("최소 1개의 최종 목차를 선택해야 합니다.");
  }
  if (selectedLeafIds.some((id) => !leafIds.has(id))) {
    errors.push("문제 대상은 자식이 없는 최종 목차만 선택할 수 있습니다.");
  }

  return errors;
}

export function getRootOutlineNodes(
  nodes: readonly LearningOutlineNode[],
): LearningOutlineNode[] {
  return nodes.filter((node) => node.parentId === null).sort(compareOutlineNodes);
}

export function getChildOutlineNodes(
  nodes: readonly LearningOutlineNode[],
  parentId: string,
): LearningOutlineNode[] {
  return nodes.filter((node) => node.parentId === parentId).sort(compareOutlineNodes);
}

function groupChildren(nodes: readonly LearningOutlineNode[]) {
  const childrenByParentId = new Map<string, LearningOutlineNode[]>();
  for (const node of nodes) {
    if (node.parentId === null) continue;
    const children = childrenByParentId.get(node.parentId) ?? [];
    children.push(node);
    childrenByParentId.set(node.parentId, children);
  }
  for (const children of childrenByParentId.values()) children.sort(compareOutlineNodes);
  return childrenByParentId;
}

function compareOutlineNodes(left: LearningOutlineNode, right: LearningOutlineNode) {
  return left.order - right.order || left.title.localeCompare(right.title);
}
