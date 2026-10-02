"use client";

import { useEffect, useRef } from "react";

import {
  getChildOutlineNodes,
  getOutlineNodeSelectionState,
  getRootOutlineNodes,
  getSelectableOutlineLeafIds,
  toggleOutlineNodeSelection,
  validateOutlineSelection,
  type LearningOutlineNode,
  type OutlineNodeSelectionState,
} from "@/lib/outline-selection";

type LearningOutlineSelectorProps = {
  nodes: readonly LearningOutlineNode[];
  selectedLeafIds: readonly string[];
  onSelectionChange: (selectedLeafIds: string[]) => void;
  disabled?: boolean;
  showMinimumSelectionError?: boolean;
};

export default function LearningOutlineSelector({
  nodes,
  selectedLeafIds,
  onSelectionChange,
  disabled = false,
  showMinimumSelectionError = false,
}: LearningOutlineSelectorProps) {
  const selectableLeafIds = getSelectableOutlineLeafIds(nodes);
  const selectedCount = new Set(
    selectedLeafIds.filter((id) => selectableLeafIds.includes(id)),
  ).size;
  const errors = showMinimumSelectionError
    ? validateOutlineSelection(nodes, selectedLeafIds)
    : [];

  function toggle(nodeId: string) {
    onSelectionChange(toggleOutlineNodeSelection(nodes, selectedLeafIds, nodeId));
  }

  return (
    <section className="rounded-md border border-[#393D3A] bg-[#2A2E2B] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-black text-[#F0F2EF]">학습 목차 선택</h3>
          <p className="mt-1 text-sm leading-6 text-[#B2B6B1]">
            부모를 선택하면 아래의 최종 목차가 모두 선택됩니다. 각 최종
            목차가 하나의 문제 대상입니다.
          </p>
        </div>
        <span className="shrink-0 text-sm font-black text-[#F0F2EF]">
          {selectedCount} / {selectableLeafIds.length}개
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {getRootOutlineNodes(nodes).map((node) => (
          <OutlineNodeRow
            key={node.id}
            node={node}
            nodes={nodes}
            selectedLeafIds={selectedLeafIds}
            depth={0}
            disabled={disabled}
            onToggle={toggle}
          />
        ))}
      </div>

      {errors.length > 0 ? (
        <p role="alert" className="mt-3 text-sm font-bold text-[#AE2E24]">
          {errors[0]}
        </p>
      ) : null}
    </section>
  );
}

function OutlineNodeRow({
  node,
  nodes,
  selectedLeafIds,
  depth,
  disabled,
  onToggle,
}: {
  node: LearningOutlineNode;
  nodes: readonly LearningOutlineNode[];
  selectedLeafIds: readonly string[];
  depth: number;
  disabled: boolean;
  onToggle: (nodeId: string) => void;
}) {
  const children = getChildOutlineNodes(nodes, node.id);
  const isLeaf = children.length === 0;
  const state = getOutlineNodeSelectionState(nodes, selectedLeafIds, node.id);

  return (
    <div>
      <label
        className={`flex gap-3 rounded-md border px-3 py-3 ${
          state === "selected"
            ? "border-[#ECEEEB]/50 bg-[#2D312E]"
            : state === "partial"
              ? "border-[#777267] bg-[#34332D]"
              : "border-[#393D3A] bg-[#2A2E2B]"
        } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
        style={{ marginLeft: `${depth * 20}px` }}
      >
        <SelectionCheckbox
          state={state}
          disabled={disabled}
          onChange={() => onToggle(node.id)}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-black text-[#F0F2EF]">{node.title}</span>
            {isLeaf ? (
              <span className="rounded bg-[#2D312E] px-1.5 py-0.5 text-[10px] font-bold text-[#ECEEEB]">
                문제 대상
              </span>
            ) : null}
          </span>
          {node.summary ? (
            <span className="mt-1 block text-xs leading-5 text-[#A6AAA5]">
              {node.summary}
            </span>
          ) : null}
        </span>
      </label>

      {children.length > 0 ? (
        <div className="mt-2 space-y-2">
          {children.map((child) => (
            <OutlineNodeRow
              key={child.id}
              node={child}
              nodes={nodes}
              selectedLeafIds={selectedLeafIds}
              depth={depth + 1}
              disabled={disabled}
              onToggle={onToggle}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SelectionCheckbox({
  state,
  disabled,
  onChange,
}: {
  state: OutlineNodeSelectionState;
  disabled: boolean;
  onChange: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = state === "partial";
  }, [state]);

  return (
    <input
      ref={inputRef}
      type="checkbox"
      checked={state === "selected"}
      aria-checked={state === "partial" ? "mixed" : state === "selected"}
      disabled={disabled}
      onChange={onChange}
      className="mt-0.5 size-4 shrink-0 accent-[#ECEEEB]"
    />
  );
}
