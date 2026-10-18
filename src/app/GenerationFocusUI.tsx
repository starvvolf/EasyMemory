"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import {
  getChildOutlineNodes,
  getDescendantOutlineLeafIds,
  getOutlineNodeSelectionState,
  getRootOutlineNodes,
  getSelectableOutlineLeafIds,
  toggleOutlineNodeSelection,
  validateOutlineSelection,
  type LearningOutlineNode,
  type OutlineNodeSelectionState,
} from "@/lib/outline-selection";

export type GenerationProgressFocusProps = {
  stage: string;
  description: string;
  eyebrow?: string;
  detail?: string;
  onCancel?: () => void;
  cancelLabel?: string;
};

/**
 * 분석·추출처럼 사용자가 기다려야 하는 순간을 화면 중앙의 한 가지 상태에
 * 집중시킨다. 실제 진행률을 알 수 없으므로 퍼센트는 표시하지 않는다.
 */
export function GenerationProgressFocus({
  stage,
  description,
  eyebrow = "학습 자료 준비 중",
  detail,
  onCancel,
  cancelLabel = "취소",
}: GenerationProgressFocusProps) {
  return (
    <section
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="grid min-h-[420px] place-items-center px-5 py-12"
    >
      <div className="w-full max-w-md text-center">
        <span
          aria-hidden="true"
          className="mx-auto block size-9 animate-spin rounded-full border-[3px] border-[#D8DAD6] border-t-[#ECEEEB]"
        />
        <p className="mt-6 text-xs font-black tracking-[0.14em] text-[#ECEEEB] uppercase">
          {eyebrow}
        </p>
        <h2 className="mt-2 text-2xl font-black tracking-[-0.02em] text-[#F0F2EF]">
          {stage}
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#B2B6B1]">
          {description}
        </p>
        {detail ? (
          <p className="mt-3 text-xs leading-5 text-[#A6AAA5]">{detail}</p>
        ) : null}
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="mt-7 border-b border-[#A6AAA5] pb-0.5 text-sm font-bold text-[#B2B6B1] hover:border-[#F0F2EF] hover:text-[#F0F2EF]"
          >
            {cancelLabel}
          </button>
        ) : null}
      </div>
    </section>
  );
}

export type CompactLearningOutlineSelectorProps = {
  nodes: readonly LearningOutlineNode[];
  selectedLeafIds: readonly string[];
  onSelectionChange: (selectedLeafIds: string[]) => void;
  disabled?: boolean;
  showMinimumSelectionError?: boolean;
  title?: string;
  description?: string;
};

/** 체크박스를 고정된 첫 열에 두고, 목차 계층을 행·연결선·글꼴로 구분한다. */
export function CompactLearningOutlineSelector({
  nodes,
  selectedLeafIds,
  onSelectionChange,
  disabled = false,
  showMinimumSelectionError = false,
  title = "학습 목차 선택",
  description = "공부할 최종 목차를 고르세요. 상위 목차를 누르면 아래 항목이 함께 선택됩니다.",
}: CompactLearningOutlineSelectorProps) {
  const titleId = useId();
  const selectableLeafIds = getSelectableOutlineLeafIds(nodes);
  const selectedSet = new Set(selectedLeafIds);
  const selectedCount = selectableLeafIds.filter((id) => selectedSet.has(id)).length;
  const errors = showMinimumSelectionError
    ? validateOutlineSelection(nodes, selectedLeafIds)
    : [];

  function toggle(nodeId: string) {
    onSelectionChange(toggleOutlineNodeSelection(nodes, selectedLeafIds, nodeId));
  }

  return (
    <section aria-labelledby={titleId} className="bg-[#2A2E2B]">
      <header className="flex items-start justify-between gap-4 border-b border-[#393D3A] pb-3">
        <div className="min-w-0">
          <h3 id={titleId} className="text-base font-black text-[#F0F2EF]">
            {title}
          </h3>
          <p className="mt-1 text-sm leading-5 text-[#B2B6B1]">{description}</p>
        </div>
        <span className="shrink-0 pt-0.5 text-sm font-black tabular-nums text-[#F0F2EF]">
          {selectedCount}/{selectableLeafIds.length}
        </span>
      </header>

      <div className="divide-y divide-[#353936]">
        {getRootOutlineNodes(nodes).map((node) => (
          <CompactOutlineNodeRow
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
        <p role="alert" className="border-t border-[#F5CD47] pt-3 text-sm font-bold text-[#AE2E24]">
          {errors[0]}
        </p>
      ) : null}
    </section>
  );
}

function CompactOutlineNodeRow({
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
  const active = state !== "unselected";
  const depthStyles = [
    "text-[15px] font-black text-[#F0F2EF]",
    "text-sm font-extrabold text-[#D1D4D0]",
    "text-sm font-bold text-[#B2B6B1]",
  ];

  return (
    <div>
      <label
        className={`grid min-h-12 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 py-2 pr-1 transition-colors ${
          active ? "bg-[#2D312E]" : "hover:bg-[#292D2A]"
        } ${disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}
        style={{ paddingLeft: `${Math.min(depth, 6) * 18 + 4}px` }}
      >
        <MixedCheckbox
          state={state}
          disabled={disabled}
          label={`${node.title} ${state === "selected" ? "선택 해제" : "선택"}`}
          onChange={() => onToggle(node.id)}
        />
        <span
          className={`min-w-0 border-l pl-3 ${
            depth === 0
              ? "border-[#ECEEEB]"
              : depth === 1
                ? "border-[#E7A08F]"
                : "border-[#393D3A]"
          }`}
        >
          <span className={`block truncate ${depthStyles[Math.min(depth, 2)]}`}>
            {node.title}
          </span>
          {node.summary ? (
            <span className="mt-0.5 block truncate text-xs leading-4 text-[#A6AAA5]">
              {node.summary}
            </span>
          ) : null}
        </span>
        <span className="ml-2 flex shrink-0 items-center gap-2">
          {(node.structureTags ?? []).length > 0 ? (
            <span className="hidden items-center gap-1 lg:flex">
              {(node.structureTags ?? []).map((tag) => (
                <span
                  key={tag}
                  className="border border-[#D8DAD6] bg-[#2A2E2B] px-1.5 py-0.5 text-[10px] font-bold text-[#B2B6B1]"
                >
                  #{tag}
                </span>
              ))}
            </span>
          ) : null}
          <ImportanceSignal importance={node.importance ?? 2} />
          {!isLeaf ? (
            <span className="hidden text-[10px] font-bold tabular-nums text-[#A5A9A4] sm:inline">
              {getDescendantOutlineLeafIds(nodes, node.id).length}개
            </span>
          ) : null}
        </span>
      </label>

      {(node.structureTags ?? []).length > 0 ? (
        <div
          className="flex flex-wrap gap-1 pb-2 pr-2 lg:hidden"
          style={{ paddingLeft: `${Math.min(depth, 6) * 18 + 40}px` }}
        >
          {(node.structureTags ?? []).map((tag) => (
            <span
              key={tag}
              className="border border-[#D8DAD6] bg-[#2A2E2B] px-1.5 py-0.5 text-[10px] font-bold text-[#B2B6B1]"
            >
              #{tag}
            </span>
          ))}
        </div>
      ) : null}

      {children.map((child) => (
        <CompactOutlineNodeRow
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
  );
}

function ImportanceSignal({ importance }: { importance: 0 | 1 | 2 | 3 }) {
  const labels = ["낮은 우선순위", "참고", "중요", "핵심"] as const;
  const colors = ["bg-[#C7C9C5]", "bg-[#D6A86E]", "bg-[#EF8D56]", "bg-[#ECEEEB]"];
  const textColors = ["text-[#A6AAA5]", "text-[#8A5A22]", "text-[#B54708]", "text-[#D63C18]"];

  return (
    <span
      className="inline-flex items-center gap-1.5"
      role="img"
      aria-label={`학습 중요도: ${labels[importance]}`}
      title={`학습 중요도: ${labels[importance]}`}
    >
      <span className={`hidden text-[10px] font-black sm:inline ${textColors[importance]}`}>
        {labels[importance]}
      </span>
      <span className="inline-flex items-end gap-0.5" aria-hidden="true">
        {[0, 1, 2, 3].map((level) => (
          <span
            key={level}
            className={`block w-1 ${level <= importance ? colors[importance] : "bg-[#353936]"}`}
            style={{ height: `${4 + level * 3}px` }}
          />
        ))}
      </span>
    </span>
  );
}

function MixedCheckbox({
  state,
  disabled,
  label,
  onChange,
}: {
  state: OutlineNodeSelectionState;
  disabled: boolean;
  label: string;
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
      aria-label={label}
      disabled={disabled}
      onChange={onChange}
      className="size-4 justify-self-center accent-[#ECEEEB]"
    />
  );
}

export type CompactChoiceOption<Value extends string = string> = {
  value: Value;
  label: string;
  description?: string;
  detail?: ReactNode;
  disabled?: boolean;
  badge?: string;
};

export type CompactChoiceRowsProps<Value extends string = string> = {
  title: string;
  value: Value;
  options: readonly CompactChoiceOption<Value>[];
  onChange: (value: Value) => void;
  description?: string;
  disabled?: boolean;
  name?: string;
};

/** 문제 방식과 생성 진행 방식을 같은 짧은 행 패턴으로 표시한다. */
export function CompactChoiceRows<Value extends string = string>({
  title,
  value,
  options,
  onChange,
  description,
  disabled = false,
  name,
}: CompactChoiceRowsProps<Value>) {
  const generatedName = useId();
  const groupName = name ?? generatedName;

  return (
    <fieldset className="border-y border-[#393D3A] bg-[#2A2E2B]">
      <legend className="sr-only">{title}</legend>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[#393D3A] py-3">
        <h3 className="text-sm font-black text-[#F0F2EF]">{title}</h3>
        {description ? <p className="text-xs text-[#A6AAA5]">{description}</p> : null}
      </div>
      <div className="divide-y divide-[#353936]">
        {options.map((option) => {
          const checked = option.value === value;
          const optionDisabled = disabled || option.disabled;
          return (
            <div key={option.value} className={checked ? "bg-[#2D312E]" : "bg-[#2A2E2B]"}>
              <label
                className={`grid min-h-12 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2 ${
                  optionDisabled ? "cursor-not-allowed opacity-55" : "cursor-pointer hover:bg-[#202321]"
                }`}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={option.value}
                  checked={checked}
                  disabled={optionDisabled}
                  onChange={() => onChange(option.value)}
                  className="size-4 justify-self-center accent-[#ECEEEB]"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-extrabold text-[#F0F2EF]">
                    {option.label}
                  </span>
                  {option.description ? (
                    <span className="block truncate text-xs leading-4 text-[#A6AAA5]">
                      {option.description}
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-2">
                  {option.badge ? (
                    <span className="text-[10px] font-bold text-[#ECEEEB]">{option.badge}</span>
                  ) : null}
                  {option.detail ? (
                    <details className="group relative" onClick={(event) => event.stopPropagation()}>
                      <summary
                        aria-label={`${option.label} 자세히 보기`}
                        className="grid size-6 cursor-pointer list-none place-items-center rounded-full border border-[#4B4F4B] text-xs font-black text-[#B2B6B1] marker:hidden hover:border-[#ECEEEB] hover:text-[#ECEEEB]"
                      >
                        i
                      </summary>
                      <div className="absolute right-0 z-20 mt-2 w-72 rounded-md border border-[#4B4F4B] bg-[#2A2E2B] p-3 text-xs leading-5 text-[#B2B6B1] shadow-lg">
                        {option.detail}
                      </div>
                    </details>
                  ) : null}
                </span>
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
