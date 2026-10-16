"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { getFirebaseAuth } from "@/lib/firebase-client";
import type { McpRunDetail, McpRunSummary, McpStageName, McpStageView } from "@/lib/mcp-run-view";
import type { McpSourceCatalogEntry } from "@/lib/mcp-source-catalog";

const stageInfo: Record<McpStageName, { title: string; help: string }> = {
  analyze: { title: "1. Analyze · 원문 목차", help: "자료의 제목과 페이지 범위를 읽어 원문 구조를 남깁니다." },
  "concept-tree": { title: "2. Concept Tree · 개념 관계", help: "선택한 범위에서 개념과 그 관계를 정리합니다." },
  "learning-design": { title: "3. Learning Design · 학습 대상", help: "무엇을 익히고 어느 근거로 성공을 판단할지 정합니다." },
  "activity-design": { title: "4. Activity Design · 문제 설계", help: "각 학습 대상에 어떤 문제와 답 방식을 쓸지 정합니다." },
  cards: { title: "5. Cards · 실제 문제", help: "설계에 따라 만든 질문, 정답, 해설과 원문 근거를 남깁니다." },
};

const stageNames = Object.keys(stageInfo) as McpStageName[];
const requestModels = ["gpt-6-sol", "gpt-6-astra", "gpt-6-luna"] as const;
const requestEfforts = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;
function availableEfforts(model: string) {
  return model === "gpt-6-luna" ? requestEfforts.filter((effort) => effort !== "ultra") : requestEfforts;
}
type StageSetting = { model: string; effort: string };
type LearningDesignPrefill = { runId: string; revision: number };
type ReuseCandidate = McpSourceCatalogEntry["reuseCandidates"][number];
function reuseCandidateKey(candidate: ReuseCandidate): string {
  return `${candidate.runId}:${candidate.stage}:${candidate.sha256}`;
}
const defaultStageSettings: Record<McpStageName, StageSetting> = {
  analyze: { model: "gpt-6-sol", effort: "medium" },
  "concept-tree": { model: "gpt-6-sol", effort: "medium" },
  "learning-design": { model: "gpt-6-sol", effort: "medium" },
  "activity-design": { model: "gpt-6-sol", effort: "medium" },
  cards: { model: "gpt-6-sol", effort: "medium" },
};

function parsePageSelection(value: string, pageCount: number): { pages: number[]; error: string } {
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

function pageRangeText(pages: number[]): string {
  const ranges: string[] = [];
  for (let index = 0; index < pages.length;) {
    const start = pages[index];
    let end = start;
    while (pages[index + 1] === end + 1) end = pages[++index];
    ranges.push(start === end ? String(start) : `${start}-${end}`);
    index += 1;
  }
  return ranges.join(", ");
}

function learningDesignScope(run: McpRunDetail, source: McpSourceCatalogEntry): { leafIds: string[]; pages: number[]; error: string } {
  if (run.kind !== "mcp-pipeline" || !source.runIds.includes(run.id) || !source.matchesExpectedFile ||
      (run.executionRequest && run.executionRequest.sourceId !== source.id)) {
    return { leafIds: [], pages: [], error: "이 실행과 현재 원본 PDF가 일치하지 않아 학습설계를 재사용할 수 없습니다." };
  }
  const files = run.config.status === "recorded" ? list(record(run.config.value).files).map(record) : [];
  if (files.length !== 1 || string(files[0].fileName) !== source.fileName || Number(files[0].pageCount) !== source.pageCount) {
    return { leafIds: [], pages: [], error: "실행에 기록된 PDF 파일과 현재 자료가 다릅니다." };
  }
  const design = run.stages.find((stage) => stage.name === "learning-design");
  const analyze = run.stages.find((stage) => stage.name === "analyze");
  if (design?.output.status !== "recorded" || !design.computedOutputSha256 || analyze?.output.status !== "recorded" ||
      run.selectedOutlineLeafIds.status !== "recorded" || !run.selectedOutlineLeafIds.value.length) {
    return { leafIds: [], pages: [], error: "완료된 학습설계, 원문 목차 또는 선택 목차 기록이 없습니다." };
  }
  const leafIds = run.selectedOutlineLeafIds.value;
  const nodes = list(record(record(analyze.output.value).sourceOutline).nodes).map(record);
  const selectedNodes = leafIds.map((id) => nodes.find((node) => string(node.id) === id));
  if (selectedNodes.some((node) => !node)) return { leafIds: [], pages: [], error: "선택 목차를 원본 분석 기록에서 찾을 수 없습니다." };
  const pages = [...new Set(selectedNodes.flatMap((node) => list(node?.sourceRefs).flatMap((ref) => list(record(ref).pageNumbers).map(Number))))]
    .sort((a, b) => a - b);
  if (!pages.length || pages.some((page) => !Number.isInteger(page) || page < 1 || page > source.pageCount)) {
    return { leafIds: [], pages: [], error: "선택 목차의 PDF 쪽 근거가 완전하지 않습니다." };
  }
  return { leafIds, pages, error: "" };
}

const labels: Record<string, string> = {
  files: "자료 파일", fileName: "파일명", pageCount: "페이지 수", sourceOutline: "원문 목차", outline: "목차", nodes: "항목", title: "제목", summary: "요약", sourceRefs: "원문 위치", pageNumbers: "페이지", sourceEvidence: "원문 근거", selectedByDefault: "기본 선택", structureTags: "구조 표시", importance: "중요도", relation: "관계", description: "설명", outlineNodeIds: "연결된 목차", conceptNodeIds: "연결된 개념", parentId: "상위 항목", depth: "깊이", treeText: "개념트리 원문", warnings: "경고", learningDesignText: "학습 설계 원문", learningDesign: "학습 설계", objectives: "학습 목표", knowledgeUnits: "학습 내용", assessmentBlueprints: "평가 설계", target: "할 수 있어야 할 일", successCriteria: "성공 기준", required: "필수", content: "학습 내용", sourceText: "원문 구절", sourceId: "자료", sourcePage: "쪽", sourceRange: "범위", knowledgeType: "지식 종류", rationale: "선정 이유", objectiveId: "학습 목표 ID", learningUnitId: "학습 내용 ID", blueprintId: "문제 설계 ID", activityDesignText: "문제 설계 원문", activities: "문제 설계", recommendedType: "추천 방식", supportLevel: "지원 수준", reason: "이유", limitation: "제한", includeInGeneration: "생성 포함", generated: "생성 결과", cards: "문제", type: "유형", front: "질문", back: "뒷면", answer: "정답", answers: "인정 답", options: "선택지", explanation: "해설", basis: "근거", hint: "힌트", qualityStatus: "품질 상태", qualityNotes: "품질 메모", sourcePacket: "출제 입력 자료", document: "작성 문서", questions: "문항", blocks: "화면 요소", responses: "응답·정답 계약", cycleNote: "실행 기록", instruction: "사용자 지시", learningGoal: "사용자 목표", selectedOutlineLeafIds: "선택 목차 ID", sourceExpressionMode: "원문 표현 방식", tags: "태그", id: "ID",
};

type Data = Record<string, unknown>;
function record(value: unknown): Data { return value && typeof value === "object" && !Array.isArray(value) ? value as Data : {}; }
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function string(value: unknown): string { return typeof value === "string" ? value : ""; }
function show(value: unknown): string { return value === null || value === undefined || value === "" ? "미기록" : String(value); }
function label(key: string): string { return labels[key] ?? key; }
function when(value: string | null): string { if (!value) return "미기록"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ko-KR"); }
function requestStatus(value: unknown): string {
  return ({ "waiting-for-executor": "기획팀장 대화에서 실행 요청 필요", claimed: "담당자 접수", running: "실행 중", completed: "완료", failed: "실패" } as Record<string, string>)[string(value)] ?? show(value);
}
function runStatus(run: McpRunDetail): string {
  if (run.status === "stopped" && run.executionRequest?.status === "completed") return "지정 단계까지 완료";
  return ({ active: "진행 중", stopped: "중단", completed: "완료", published: "게시됨", cancelled: "취소됨" } as Record<string, string>)[run.status] ?? run.status;
}
function provenanceCorrection(note: string): { correction: string | null; remainder: string } {
  if (!note.startsWith("검수 정정:")) return { correction: null, remainder: note };
  const splitAt = note.indexOf(" 단계 출력은 ");
  if (splitAt < 0) return { correction: note, remainder: "" };
  return { correction: note.slice(0, splitAt).trim(), remainder: note.slice(splitAt + 1) };
}
function isOutsideRequestedStages(run: McpRunDetail, stageName: McpStageName): boolean {
  return run.status === "stopped" && run.executionRequest?.status === "completed" &&
    stageNames.indexOf(stageName) > stageNames.indexOf(run.executionRequest.stopAfterStage as McpStageName);
}

async function apiHeaders(): Promise<Headers> {
  const headers = new Headers();
  try {
    const user = getFirebaseAuth().currentUser;
    if (user) headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
  } catch {
    // Local experiment mode has no Firebase client configuration. The server still decides access.
  }
  return headers;
}

async function loadApi<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: await apiHeaders(), cache: "no-store" });
  const result = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(result.message ?? "실행 기록을 불러오지 못했습니다.");
  return result;
}

async function postApi<T>(url: string, body: unknown): Promise<T> {
  const headers = await apiHeaders();
  headers.set("Content-Type", "application/json");
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const result = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(result.message ?? "요청을 저장하지 못했습니다.");
  return result;
}

function Datum({ value, level = 0 }: { value: unknown; level?: number }) {
  if (value === null || value === undefined) return <span className="text-slate-500">미기록</span>;
  if (typeof value === "boolean") return <span>{value ? "예" : "아니요"}</span>;
  if (typeof value !== "object") return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-slate-500">항목 없음</span>;
    return <ol className="space-y-2">{value.map((item, index) => <li key={index} className="rounded-lg border border-slate-200 bg-white p-3"><span className="mb-1 block text-xs font-semibold text-slate-500">{index + 1}</span><Datum value={item} level={level + 1} /></li>)}</ol>;
  }
  const entries = Object.entries(value);
  if (!entries.length) return <span className="text-slate-500">기록 없음</span>;
  return <dl className={level > 2 ? "space-y-2" : "grid gap-2 sm:grid-cols-2"}>{entries.map(([key, item]) => <div key={key} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="mb-1 text-xs font-bold text-slate-500">{label(key)}</dt><dd className="text-sm leading-6 text-slate-800"><Datum value={item} level={level + 1} /></dd></div>)}</dl>;
}

function FullRecord({ value, title = "전체 기록 펼치기" }: { value: unknown; title?: string }) {
  return <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">{title}</summary><div className="border-t border-slate-200 p-4"><Datum value={value} /></div></details>;
}

function Field({ name, value }: { name: string; value: unknown }) {
  return <div><dt className="text-xs font-semibold text-slate-500">{name}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-900">{show(value)}</dd></div>;
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toLocaleString("ko-KR", { maximumFractionDigits: 3 })}초`;
}

function reportedStageWindow(rawStage: unknown): number | null {
  const actual = record(record(rawStage).actual);
  const start = Date.parse(string(actual.startedAt));
  const end = Date.parse(string(actual.finishedAt));
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

function ExecutionAudit({ audit }: { audit: NonNullable<McpRunDetail["executionAudit"]> }) {
  const copied = audit.finding === "copied-prior-output";
  return <section role={copied ? "alert" : "status"} className={`mt-3 rounded-lg border p-4 text-sm ${copied ? "border-amber-300 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-950"}`}>
    <h3 className="font-bold">{copied ? "검수 정정 · 새 Analyze 아님" : "실행자 증거 · 원문을 다시 읽은 새 Analyze"}</h3>
    <p className="mt-1 leading-6">{audit.note}</p>
    {!copied ? <dl className="mt-3 grid gap-3 sm:grid-cols-2">
      <Field name="초안 작성 근사" value={audit.approximateAuthoringMs === null ? "미기록" : `약 ${seconds(audit.approximateAuthoringMs)}`} />
      <Field name="MCP 시작 도구 왕복" value={audit.mcpRoundTripMs === null ? "미기록" : `${audit.mcpRoundTripMs.start}ms`} />
      <Field name="MCP Analyze 도구 왕복" value={audit.mcpRoundTripMs === null ? "미기록" : `${audit.mcpRoundTripMs.analyze}ms`} />
      <Field name="모델·추론 강도 출처" value="실행자 보고" />
    </dl> : null}
    {!copied ? <p className="mt-3 text-xs leading-5">초안 작성 근사와 MCP 도구 왕복은 서로 다른 구간입니다. 순수 AI 추론 시간은 계측되지 않았습니다.</p> : null}
  </section>;
}

function NodeList({ nodes, concept = false }: { nodes: unknown[]; concept?: boolean }) {
  if (!nodes.length) return <p className="text-sm text-slate-500">기록된 항목이 없습니다.</p>;
  return <ul className="space-y-2">{nodes.map((raw, index) => { const node = record(raw); const depth = Number(node.depth ?? 0); const refs = list(node.sourceRefs).map((ref) => { const source = record(ref); return `${show(source.fileName)} · ${list(source.pageNumbers).join(", ")}쪽`; }); return <li key={string(node.id) || index} className="rounded-lg border border-slate-200 bg-white p-3" style={{ marginLeft: `${Math.min(Math.max(depth, 0), 5) * 12}px` }}><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-indigo-700">{concept ? (string(node.relation) || "핵심 개념") : `목차 ${index + 1}`}</span><strong className="text-sm">{show(node.title)}</strong></div>{node.description || node.summary ? <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{show(node.description || node.summary)}</p> : null}<p className="mt-1 break-words text-xs text-slate-500">원문 {refs.length ? refs.join(" / ") : "미기록"}</p><details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">연결 정보</summary><p className="mt-1 break-words">ID {show(node.id)} · 상위 {show(node.parentId)}{concept ? ` · 연결 목차 ${list(node.outlineNodeIds).join(", ") || "미기록"}` : ""}</p></details></li>; })}</ul>;
}

function TypesetCardText({ value }: { value: string }) {
  const segments = value.split(/(\[[^\[\]\n]*;[^\[\]\n]*\])/g);
  return <>{segments.map((segment, index) => {
    if (!segment.startsWith("[") || !segment.endsWith("]")) return <span key={index}>{segment}</span>;
    const rows = segment.slice(1, -1).split(";").map((row) => row.trim().split(/\s+/));
    const width = rows[0]?.length ?? 0;
    if (rows.length < 2 || rows.length > 4 || width < 2 || width > 4 || rows.some((row) => row.length !== width)) return <span key={index}>{segment}</span>;
    const latex = `\\begin{bmatrix}${rows.map((row) => row.map((cell) => cell === "__" ? "\\square" : cell.replace(/cosθ/g, "\\cos\\theta").replace(/sinθ/g, "\\sin\\theta")).join("&")).join("\\\\")}\\end{bmatrix}`;
    try {
      return <span key={index} className="block max-w-full py-2" dangerouslySetInnerHTML={{ __html: katex.renderToString(latex, { displayMode: false, throwOnError: true, trust: false }) }} />;
    } catch {
      return <span key={index}>{segment}</span>;
    }
  })}</>;
}

function StageOutput({ stage }: { stage: McpStageView }) {
  if (stage.output.status === "not-recorded") return <p className="text-sm text-slate-500">출력이 기록되지 않았습니다.</p>;
  const output = record(stage.output.value);
  if (stage.name === "analyze") return <><NodeList nodes={list(record(output.sourceOutline).nodes)} /><FullRecord value={stage.output.value} title="파일별 분석과 목차 전체 펼치기" /></>;
  if (stage.name === "concept-tree") return <><NodeList nodes={list(output.nodes)} concept /><FullRecord value={stage.output.value} title="개념 관계 전체 펼치기" /></>;
  if (stage.name === "learning-design") { const design = record(output.learningDesign); const objectives = list(design.objectives); const units = list(design.knowledgeUnits); return <><div className="space-y-3">{objectives.map((raw, index) => { const item = record(raw); const related = units.filter((unit) => record(unit).objectiveId === item.id); return <article key={string(item.id) || index} className="rounded-xl border border-slate-200 bg-white p-4"><h4 className="font-semibold text-slate-900">{index + 1}. {show(item.target)}</h4><details className="mt-1 text-xs text-slate-500"><summary className="cursor-pointer">목표 연결 정보</summary><p>{show(item.id)} · 목차 {list(item.outlineNodeIds).join(", ") || "미기록"}</p></details><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field name="성공 기준" value={list(item.successCriteria).map((entry) => record(entry).description).join(" / ") || "미기록"} /><Field name="중요도" value={item.importance} /></div>{related.map((rawUnit, unitIndex) => { const unit = record(rawUnit); return <div key={string(unit.id) || unitIndex} className="mt-3 rounded-lg bg-indigo-50 p-3"><p className="font-semibold">{show(unit.content)}</p><p className="mt-1 text-sm">원문 근거: {show(unit.sourceText)}</p><p className="mt-1 text-xs text-slate-600">{show(unit.sourceId)} {show(unit.sourcePage)}쪽 · {show(unit.sourceRange)}</p><p className="mt-1 text-xs text-slate-600">선정 이유: {show(unit.rationale)}</p><details className="mt-1 text-xs text-slate-500"><summary className="cursor-pointer">학습 내용 연결 정보</summary><p>{show(unit.id)} · 개념 {list(unit.conceptNodeIds).join(", ") || "미기록"}</p></details></div>; })}</article>; })}</div><FullRecord value={stage.output.value} title="학습 설계와 배치 전체 펼치기" /></>; }
  if (stage.name === "activity-design") return <><div className="grid gap-3 md:grid-cols-2">{list(output.activities).map((raw, index) => { const item = record(raw); return <article key={string(item.blueprintId) || index} className="rounded-xl border border-slate-200 bg-white p-4"><h4 className="font-semibold">설계 {index + 1} · {show(item.recommendedType)}</h4><p className="mt-1 text-xs text-slate-500">설계 ID {show(item.blueprintId)} · 지원 {show(item.supportLevel)} · 생성 포함 {item.includeInGeneration === true ? "예" : "아니요"}</p><p className="mt-3 text-sm leading-6">{show(item.reason)}</p><p className="mt-2 text-sm text-amber-800">제한: {show(item.limitation)}</p></article>; })}</div><FullRecord value={stage.output.value} title="문제 설계 전체 펼치기" /></>;
  return <><div className="space-y-3">{list(output.cards).map((raw, index) => { const card = record(raw); return <article key={string(card.id) || index} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold text-indigo-700">문제 {index + 1} · {show(card.activityType || card.type)}</p><h4 className="mt-2 whitespace-pre-wrap text-base font-semibold"><TypesetCardText value={show(card.front)} /></h4>{list(card.options).length ? <ol className="mt-3 list-inside list-decimal space-y-1 text-sm">{list(card.options).map((option, optionIndex) => <li key={optionIndex}><TypesetCardText value={show(option)} /></li>)}</ol> : null}<details className="mt-3 rounded-lg bg-emerald-50 p-3"><summary className="cursor-pointer text-sm font-semibold text-emerald-900">정답과 해설 펼치기</summary><p className="mt-2 whitespace-pre-wrap text-sm">정답: <TypesetCardText value={show(card.answer || card.back)} /></p><p className="mt-1 whitespace-pre-wrap text-sm">해설: {show(card.explanation)}</p><p className="mt-1 whitespace-pre-wrap text-sm">원문 근거: {show(card.basis)}</p></details><p className="mt-3 text-xs text-slate-500">원문 {show(card.sourceId)} {show(card.sourcePage)}쪽</p><details className="mt-2 break-words text-xs text-slate-500"><summary className="cursor-pointer">문항 계보</summary><p>목표 {show(card.objectiveId)} · 학습 내용 {show(card.learningUnitId)} · 설계 {show(card.blueprintId)} · 개념 {list(card.conceptNodeIds).join(", ") || "미기록"}</p></details></article>; })}</div><FullRecord value={stage.output.value} title="문제 결과 전체 펼치기" /></>;
}

function ProblemDesignInput({ design }: { design: Data }) {
  const given = list(design.given).map(record);
  const hidden = list(design.hidden).map(record);
  const expected = record(design.expectedResponse);
  const names: Record<string, string> = { instruction: "지시문", context: "제시 상황", target_answer: "정답 대상", short_text: "짧은 글 답변", single_choice: "하나 선택" };
  const nameFor = (value: unknown) => names[string(value)] ?? string(value);
  return <li className="rounded-lg bg-slate-50 p-3 text-sm">
    <strong>{show(design.problemType)} · {show(design.learningContent)}</strong>
    <dl className="mt-2 grid gap-2 sm:grid-cols-2">
      {given.map((item, index) => <Field key={`given-${index}`} name={`보여줄 것 ${index + 1}${string(item.type) ? ` · ${nameFor(item.type)}` : ""}`} value={string(item.description) || "설명 미기록"} />)}
      {hidden.map((item, index) => <Field key={`hidden-${index}`} name={`감출 것 ${index + 1}${string(item.reason) ? ` · ${nameFor(item.reason)}` : ""}`} value={string(item.description) || "설명 미기록"} />)}
      <Field name="기대 응답 방식" value={nameFor(expected.kind) || "미기록"} />
      <Field name="기대 응답 내용" value={string(expected.description) || "미기록"} />
    </dl>
  </li>;
}

function StageInput({ stage }: { stage: McpStageView }) {
  if (stage.actualInput.status === "not-recorded") return <p className="mt-2 text-sm text-slate-600">이 단계의 MCP 입력 스냅샷은 보존되지 않았습니다.</p>;
  const stageInput = record(stage.actualInput.value);
  const input = record(stageInput.input);
  const selectedOutline = record(input.selectedSourceOutline);
  const targets = list(input.learningTargets);
  const designs = list(input.problemDesigns);
  const conceptTree = list(input.conceptTree);
  return <div className="mt-2 space-y-3">
    {input.title ? <Field name="자료·실행 제목" value={input.title} /> : null}
    {input.learningGoal ? <Field name="사용자 학습 목표" value={input.learningGoal} /> : null}
    {input.instruction ? <Field name="사용자 지시" value={input.instruction} /> : null}
    {list(input.files).length ? <Field name="등록 자료" value={list(input.files).map((file) => `${show(record(file).fileName)} · ${show(record(file).pageCount)}쪽`).join(" / ")} /> : null}
    {list(selectedOutline.nodes).length ? <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold">선택된 원문 목차 {list(selectedOutline.nodes).length}개 펼치기</summary><div className="mt-3"><NodeList nodes={list(selectedOutline.nodes)} /></div></details> : null}
    {conceptTree.length ? <div><p className="mb-2 text-sm font-semibold">이전 개념 관계 {conceptTree.length}개</p><ul className="space-y-1">{conceptTree.map((raw, index) => <li key={index} className="rounded-lg bg-slate-50 p-2 text-sm">{show(record(raw).title)} · {show(record(raw).relation)} · {show(record(raw).description)}</li>)}</ul></div> : null}
    {targets.length ? <div><p className="mb-2 text-sm font-semibold">이전 단계의 학습 대상 {targets.length}개</p><ul className="space-y-2">{targets.map((raw, index) => { const target = record(raw); return <li key={index} className="rounded-lg bg-slate-50 p-2 text-sm"><strong>{show(target.content)}</strong><p className="mt-1">목표: {show(target.objective)} · 성공 기준: {show(target.successCriterion)}</p><p className="mt-1">원문 근거: {show(target.sourceEvidence)}</p></li>; })}</ul></div> : null}
    {designs.length ? <div><p className="mb-2 text-sm font-semibold">이전 단계의 문제 설계 {designs.length}개</p><ul className="space-y-2">{designs.map((raw, index) => <ProblemDesignInput key={index} design={record(raw)} />)}</ul></div> : null}
    <FullRecord value={stage.actualInput.value} title="MCP 입력 스냅샷 전체 펼치기 · 지시문·출력 계약 포함" />
  </div>;
}

function ReuseNotice({ source }: { source: NonNullable<McpStageView["reusedFrom"]> }) {
  return <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950">
    <p className="font-semibold">저장된 이전 출력 재사용 · 이 단계의 새 모델 호출 없음</p>
    <p className="mt-1 break-all">출처 실행: {source.sourceRunId}</p>
    <details className="mt-2 text-xs"><summary className="cursor-pointer">재사용 출처 해시 보기</summary><p className="mt-1 break-all">출처 출력: {source.sourceArtifactSha256}</p><p className="break-all">출처 실행 파일: {source.sourceRunSha256}</p><p className="break-all">출처 PDF: {source.sourcePdfSha256}</p></details>
  </div>;
}

function StagePanel({ stage, outsideRequest, onUseLearningDesign }: { stage: McpStageView; outsideRequest: boolean; onUseLearningDesign?: () => void }) {
  const state = stage.reusedFrom ? "완료 · 저장 출력 재사용" : stage.status === "completed" ? "완료" : outsideRequest ? "요청 범위 밖 · 실행 안 함" : stage.validationFailures.length ? "실패 기록 있음" : stage.status === "active" ? "진행 중" : "시작 전";
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-bold">{stageInfo[stage.name].title}</h3><p className="mt-1 text-sm text-slate-600">{stageInfo[stage.name].help}</p></div><span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-800">{state}</span></div>{stage.reusedFrom ? <ReuseNotice source={stage.reusedFrom} /> : null}<dl className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-3"><Field name="완료" value={when(stage.completedAt)} /><Field name={stage.executionMetadataSource === "executor-reported" ? "MCP 처리 구간 (실행자 보고)" : "소요 시간"} value={stage.durationMs === null ? "미기록" : `${stage.durationMs}ms`} /><Field name={stage.executionMetadataSource === "executor-reported" ? "실행자 보고 모델" : "모델"} value={stage.model.status === "recorded" ? stage.model.value : "미기록"} /><Field name={stage.executionMetadataSource === "executor-reported" ? "실행자 보고 추론 강도" : "추론 강도"} value={stage.reasoningEffort.status === "recorded" ? stage.reasoningEffort.value : "미기록"} /></dl><details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">단계 기록 상세</summary><p className="mt-1 break-all">출력 식별 해시: {stage.computedOutputSha256 ?? "미기록"}</p></details><div className="mt-5"><div className="rounded-xl border border-slate-200 p-4"><h4 className="font-semibold">MCP 단계 입력 스냅샷</h4><StageInput stage={stage} /></div></div>{stage.validationFailures.length ? <details className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><summary className="cursor-pointer font-semibold text-amber-900">검증 실패 {stage.validationFailures.length}건</summary><ul className="mt-2 space-y-2 text-sm">{stage.validationFailures.map((failure, index) => <li key={index}>{when(failure.at)} · {failure.error}</li>)}</ul></details> : null}<div className="mt-5"><StageOutput stage={stage} /></div>{stage.name === "learning-design" && stage.output.status === "recorded" && onUseLearningDesign ? <div className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50 p-4"><p className="text-sm text-indigo-950">학습 목표를 확인했다면 같은 목적과 범위로 문제 생성을 요청할 수 있습니다.</p><button type="button" onClick={onUseLearningDesign} className="mt-3 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-bold text-white">이 학습목표로 문제 만들기</button><p className="mt-2 text-xs text-indigo-800">요청 양식만 채웁니다. 실행은 자동으로 시작되지 않습니다.</p></div> : null}</section>;
}


function SourcePdfPage({ bytes, pageNumber }: { bytes: Uint8Array; pageNumber: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const [renderedPage, setRenderedPage] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof import("pdfjs-dist").getDocument> | null = null;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        loadingTask = pdfjs.getDocument({ data: bytes.slice() });
        const loaded = await loadingTask.promise;
        if (!cancelled) setDocument(loaded);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "PDF를 읽지 못했습니다.");
      }
    })();
    return () => { cancelled = true; if (loadingTask) void loadingTask.destroy(); };
  }, [bytes]);
  useEffect(() => {
    if (!document || !canvasRef.current) return;
    let cancelled = false;
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | null = null;
    const canvas = canvasRef.current;
    setRenderedPage(null);
    void (async () => {
      try {
        const page = await document.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1.5 });
        const outputScale = window.devicePixelRatio || 1;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("PDF 화면을 초기화하지 못했습니다.");
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        task = page.render({ canvas, canvasContext: context, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
        await task.promise;
        if (!cancelled) { setRenderedPage(pageNumber); setError(""); }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "PDF 쪽을 표시하지 못했습니다.");
      }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [document, pageNumber]);
  return <div className="mt-3 overflow-auto rounded-lg border border-slate-200 bg-slate-100 p-2 text-center">
    {error ? <p role="alert" className="p-3 text-sm text-red-700">{error}</p> : null}
    {renderedPage !== pageNumber && !error ? <p className="p-3 text-sm text-slate-600">{pageNumber}쪽을 표시하는 중입니다.</p> : null}
    <canvas ref={canvasRef} aria-label={`원본 PDF ${pageNumber}쪽`} className={`mx-auto h-auto max-w-full bg-white shadow ${renderedPage === pageNumber ? "" : "invisible"}`} />
  </div>;
}

function ExperimentRequestPanel({ source, selectedRun, prefill, availableRunIds, onRequestCompleted, onOpenRun }: { source: McpSourceCatalogEntry; selectedRun: McpRunDetail | null; prefill: LearningDesignPrefill | null; availableRunIds: string[]; onRequestCompleted: () => void; onOpenRun: (runId: string) => void }) {
  const [pageChoice, setPageChoice] = useState<{ sourceId: string; text: string } | null>(null);
  const [leafChoice, setLeafChoice] = useState<{ sourceId: string; ids: string[] } | null>(null);
  const [purpose, setPurpose] = useState("자료의 핵심을 시험에 대비해 오래 기억하고 적용한다.");
  const [stopAfterStage, setStopAfterStage] = useState<McpStageName>("cards");
  const [settings, setSettings] = useState(defaultStageSettings);
  const [modelNotice, setModelNotice] = useState("");
  const [reuseStage, setReuseStage] = useState("");
  const [requests, setRequests] = useState<unknown[]>([]);
  const [requestAudits, setRequestAudits] = useState<Record<string, McpRunDetail["executionAudit"]>>({});
  const fetchedAuditRunIds = useRef(new Set<string>());
  const [requestError, setRequestError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [prefillMessage, setPrefillMessage] = useState("");
  const handledPrefillRevision = useRef(-1);
  const notifiedCompletedIds = useRef(new Set<string>());
  const onRequestCompletedRef = useRef(onRequestCompleted);
  const availableRunIdsRef = useRef(availableRunIds);
  const sourceRunIdsRef = useRef(source.runIds);
  useEffect(() => { onRequestCompletedRef.current = onRequestCompleted; }, [onRequestCompleted]);
  useEffect(() => { availableRunIdsRef.current = availableRunIds; }, [availableRunIds]);
  useEffect(() => { sourceRunIdsRef.current = source.runIds; }, [source.runIds]);
  const defaultPages = `1-${source.pageCount}`;
  const pageText = pageChoice?.sourceId === source.id ? pageChoice.text : defaultPages;
  const parsed = parsePageSelection(pageText, source.pageCount);
  const selectedPages = new Set(parsed.pages);
  const outlineNodes = source.outline.status === "recorded" ? list(record(source.outline.value).nodes).map(record) : [];
  const parentIds = new Set(outlineNodes.map((node) => string(node.parentId)).filter(Boolean));
  const eligibleLeaves = outlineNodes.filter((node) => !parentIds.has(string(node.id)) &&
    list(node.sourceRefs).some((ref) => list(record(ref).pageNumbers).some((page) => selectedPages.has(Number(page)))));
  const eligibleIds = new Set(eligibleLeaves.map((node) => string(node.id)));
  const chosenLeafIds = leafChoice?.sourceId === source.id
    ? leafChoice.ids.filter((id) => eligibleIds.has(id))
    : eligibleLeaves.map((node) => string(node.id));
  const reusable = source.matchesExpectedFile && source.sha256
    ? source.reuseCandidates.filter((candidate) => candidate.sourcePdfSha256 === source.sha256 && stageNames.indexOf(candidate.stage) <= stageNames.indexOf(stopAfterStage))
    : [];
  const chosenReuse = reusable.find((candidate) => reuseCandidateKey(candidate) === reuseStage)
    ?? reusable.find((candidate) => candidate.runId === selectedRun?.id && candidate.stage === reuseStage);
  const clearReuseForChangedIntent = () => {
    if (!reuseStage || chosenReuse?.stage === "analyze") return;
    setReuseStage("");
    setPrefillMessage("학습 목적이나 범위가 바뀌어 이전 단계 출력 재사용을 해제했습니다.");
  };
  useEffect(() => {
    if (!prefill || prefill.runId !== selectedRun?.id || handledPrefillRevision.current === prefill.revision) return;
    let active = true;
    queueMicrotask(() => {
    if (!active || handledPrefillRevision.current === prefill.revision) return;
    const scope = learningDesignScope(selectedRun, source);
    if (scope.error) {
      handledPrefillRevision.current = prefill.revision;
      setPrefillMessage(scope.error);
      return;
    }
    const originalRequest = selectedRun.executionRequestId
      ? requests.map(record).find((item) => string(item.id) === selectedRun.executionRequestId)
      : null;
    if (selectedRun.executionRequestId && !originalRequest) {
      setPrefillMessage("원래 요청의 학습 목적을 불러오는 중입니다.");
      return;
    }
    const originalPurpose = originalRequest
      ? string(record(originalRequest.input).purpose)
      : selectedRun.config.status === "recorded" ? string(record(selectedRun.config.value).learningGoal) : "";
    if (!originalPurpose) {
      handledPrefillRevision.current = prefill.revision;
      setPrefillMessage("원래 학습 목적이 기록되지 않아 요청 양식을 채울 수 없습니다.");
      return;
    }
    const catalogNodes = source.outline.status === "recorded" ? list(record(source.outline.value).nodes).map(record) : [];
    const catalogParents = new Set(catalogNodes.map((node) => string(node.parentId)).filter(Boolean));
    const catalogLeaves = new Set(catalogNodes.filter((node) => !catalogParents.has(string(node.id)) &&
      list(node.sourceRefs).some((ref) => list(record(ref).pageNumbers).some((page) => scope.pages.includes(Number(page)))))
      .map((node) => string(node.id)));
    if (scope.leafIds.some((id) => !catalogLeaves.has(id))) {
      handledPrefillRevision.current = prefill.revision;
      setPrefillMessage("현재 자료의 목차 버전에서 원래 선택 항목을 모두 찾지 못해 재사용하지 않았습니다.");
      return;
    }
    handledPrefillRevision.current = prefill.revision;
    setPageChoice({ sourceId: source.id, text: pageRangeText(scope.pages) });
    setLeafChoice({ sourceId: source.id, ids: scope.leafIds });
    setPurpose(originalPurpose);
    setStopAfterStage("cards");
    setReuseStage("learning-design");
    setPrefillMessage("원래 학습 목적·목차·쪽을 채웠습니다. Analyze부터 학습설계까지 재사용하고 문제 설계와 문제 생성은 새로 진행할 조건입니다. 저장 후 기획팀장 대화에서 실행을 요청하세요.");
    setNotice("");
    });
    return () => { active = false; };
  }, [prefill, selectedRun, source, requests]);
  const noteCompletedRequests = (items: unknown[]) => {
    let needsCatalogRefresh = false;
    for (const raw of items) {
      const item = record(raw);
      const id = string(item.id);
      if (id && item.status === "completed" && !notifiedCompletedIds.current.has(id)) {
        notifiedCompletedIds.current.add(id);
        needsCatalogRefresh = true;
      }
      const runId = string(item.runId);
      if (item.status === "completed" && runId) {
        const viewRunId = runId.startsWith("mcp:") ? runId : `mcp:${runId}`;
        if (!availableRunIdsRef.current.includes(viewRunId) || !sourceRunIdsRef.current.includes(viewRunId)) needsCatalogRefresh = true;
      }
    }
    if (needsCatalogRefresh) onRequestCompletedRef.current();
  };
  const refreshRequests = async () => {
    try {
      const result = await loadApi<{ requests: unknown[] }>("/api/mcp-experiment-requests");
      setRequests(result.requests);
      setRequestError("");
      noteCompletedRequests(result.requests);
    } catch (reason) {
      setRequestError(reason instanceof Error ? reason.message : "요청 상태를 불러오지 못했습니다.");
    }
  };
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const result = await loadApi<{ requests: unknown[] }>("/api/mcp-experiment-requests");
        if (active) { setRequests(result.requests); setRequestError(""); noteCompletedRequests(result.requests); }
      } catch (reason) {
        if (active) setRequestError(reason instanceof Error ? reason.message : "요청 상태를 불러오지 못했습니다.");
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    const runIds = requests.map(record).filter((item) => item.status === "completed").map((item) => string(item.runId)).filter(Boolean);
    const missing = runIds.filter((id) => !fetchedAuditRunIds.current.has(id));
    if (!missing.length) return;
    missing.forEach((id) => fetchedAuditRunIds.current.add(id));
    void Promise.all(missing.map(async (id) => {
      try {
        const result = await loadApi<{ run: McpRunDetail }>(`/api/mcp-runs/${encodeURIComponent(`mcp:${id}`)}`);
        return { id, audit: result.run.executionAudit };
      } catch {
        fetchedAuditRunIds.current.delete(id);
        return null;
      }
    })).then((results) => {
      setRequestAudits((current) => Object.fromEntries([...Object.entries(current), ...results.filter((result) => result !== null).map((result) => [result.id, result.audit])]));
    });
  }, [requests]);
  const submit = async () => {
    if (parsed.error || !parsed.pages.length || !purpose.trim()) return;
    setSaving(true);
    setNotice("");
    setRequestError("");
    const stageLimit = stageNames.indexOf(stopAfterStage);
    const requestedStages = Object.fromEntries(stageNames.slice(0, stageLimit + 1).map((name) => [name, settings[name]]));
    const reuse = chosenReuse ? { kind: "output" as const, runId: chosenReuse.runId, stage: chosenReuse.stage, sha256: chosenReuse.sha256 } : undefined;
    try {
      await postApi("/api/mcp-experiment-requests", {
        sourceId: source.id,
        scope: { pageNumbers: parsed.pages, outlineLeafIds: chosenLeafIds },
        purpose: purpose.trim(), requestedStages, stopAfterStage,
        ...(reuse ? { reuse } : {}),
      });
      setNotice("조건을 저장했습니다. 기획팀장 대화에서 실행을 요청하세요. 결과는 이 화면에 표시됩니다.");
      await refreshRequests();
    } catch (reason) {
      setRequestError(reason instanceof Error ? reason.message : "요청을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };
  const sourceRequests = requests.map(record).filter((item) => record(item.input).sourceId === source.id);
  return <section id="mcp-request-form" className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
    <h3 className="text-lg font-bold">생성 조건 설정</h3>
    {prefillMessage ? <p role="status" className="mt-3 rounded-lg border border-indigo-200 bg-white p-3 text-sm text-indigo-950">{prefillMessage}</p> : null}
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <label className="text-sm font-semibold">학습할 쪽 범위
        <input value={pageText} onChange={(event) => { clearReuseForChangedIntent(); setPageChoice({ sourceId: source.id, text: event.target.value }); setLeafChoice(null); }} placeholder="예: 2-7, 10" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 font-normal" />
        <span className={`mt-1 block text-xs ${parsed.error ? "text-red-700" : "text-slate-500"}`}>{parsed.error || (parsed.pages.length ? `기본은 전체 1-${source.pageCount}쪽 · 현재 ${parsed.pages.length}쪽 선택` : `학습할 쪽을 입력하세요 · 전체는 1-${source.pageCount}`)}</span>
      </label>
      <label className="text-sm font-semibold">학습 목적
        <textarea value={purpose} onChange={(event) => { clearReuseForChangedIntent(); setPurpose(event.target.value); }} rows={2} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 font-normal" />
      </label>
    </div>
    <details className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-semibold">학습할 하위목차 · {chosenLeafIds.length}개 선택</summary>
      <div className="mt-2 flex gap-2"><button type="button" onClick={() => { clearReuseForChangedIntent(); setLeafChoice({ sourceId: source.id, ids: [...eligibleIds] }); }} className="rounded border px-2 py-1 text-xs">모두 선택</button><button type="button" onClick={() => { clearReuseForChangedIntent(); setLeafChoice({ sourceId: source.id, ids: [] }); }} className="rounded border px-2 py-1 text-xs">모두 해제</button></div>
      <div className="mt-2 max-h-48 space-y-1 overflow-auto">{eligibleLeaves.length ? eligibleLeaves.map((node) => { const id = string(node.id); return <label key={id} className="flex items-start gap-2 rounded p-1 text-sm"><input type="checkbox" checked={chosenLeafIds.includes(id)} onChange={(event) => { clearReuseForChangedIntent(); setLeafChoice({ sourceId: source.id, ids: event.target.checked ? [...chosenLeafIds, id] : chosenLeafIds.filter((item) => item !== id) }); }} className="mt-1" /><span>{show(node.title)}</span></label>; }) : <p className="text-sm text-slate-500">선택 범위에 기록된 하위목차가 없습니다.</p>}</div>
    </details>
    <div className="mt-4 flex flex-wrap items-end gap-4"><label className="text-sm font-semibold">종료 단계<select value={stopAfterStage} onChange={(event) => setStopAfterStage(event.target.value as McpStageName)} className="mt-1 block rounded-lg border border-slate-300 bg-white p-2 font-normal">{stageNames.map((name) => <option key={name} value={name}>{stageInfo[name].title}</option>)}</select></label></div>
    <div className="mt-4 grid gap-2 md:grid-cols-2">{stageNames.slice(0, stageNames.indexOf(stopAfterStage) + 1).map((name) => <div key={name} className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-sm font-semibold">{stageInfo[name].title}</p>{chosenReuse && stageNames.indexOf(name) <= stageNames.indexOf(chosenReuse.stage) ? <p className="mt-1 text-xs text-indigo-700">저장 출력 재사용 · 이 단계의 모델은 호출하지 않음</p> : null}<div className="mt-2 flex flex-wrap gap-2"><label className="text-xs">요청 모델<select value={settings[name].model} onChange={(event) => { const model = event.target.value; const adjusted = model === "gpt-6-luna" && settings[name].effort === "ultra"; setSettings((current) => ({ ...current, [name]: { ...current[name], model, effort: adjusted ? "max" : current[name].effort } })); setModelNotice(adjusted ? `${stageInfo[name].title}: Luna는 ultra를 지원하지 않아 추론 강도를 max로 바꿨습니다.` : ""); }} className="mt-1 block rounded border p-1.5">{requestModels.map((model) => <option key={model}>{model}</option>)}</select></label><label className="text-xs">추론 강도<select value={settings[name].effort} onChange={(event) => setSettings((current) => ({ ...current, [name]: { ...current[name], effort: event.target.value } }))} className="mt-1 block rounded border p-1.5">{availableEfforts(settings[name].model).map((effort) => <option key={effort}>{effort}</option>)}</select></label></div></div>)}</div>
    {modelNotice ? <p role="status" className="mt-2 text-xs text-amber-800">{modelNotice}</p> : null}
    <label className="mt-4 block text-sm font-semibold">이전 단계 출력 재사용
      <select value={chosenReuse ? reuseCandidateKey(chosenReuse) : ""} onChange={(event) => setReuseStage(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 font-normal"><option value="">재사용하지 않음</option>{reusable.map((candidate) => <option key={reuseCandidateKey(candidate)} value={reuseCandidateKey(candidate)}>{candidate.origin === "verified-legacy" ? "동일 원본 확인 · 과거 실행" : "이 자료의 완료 실행"} · {stageInfo[candidate.stage].title} · {candidate.runId.slice(-12)}</option>)}</select>
    </label>
    <p className="mt-1 text-xs text-slate-600">{chosenReuse?.stage === "analyze" ? "동일 원본으로 검증된 목차 분석을 재사용합니다. 이후 단계는 현재 학습 목적과 선택 범위에 따라 진행됩니다." : "학습 설계 이후의 출력 재사용은 원래 학습 목적·선택 쪽·목차를 유지할 때만 적합합니다. 이 값을 수정하면 재사용 선택을 해제합니다."}</p>
    <button type="button" disabled={saving || !!parsed.error || !parsed.pages.length || !purpose.trim()} onClick={() => { void submit(); }} className="mt-4 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? "조건 저장 중" : "생성 조건 저장"}</button>
    {notice ? <p role="status" className="mt-2 text-sm text-emerald-800">{notice}</p> : null}
    {requestError ? <p role="alert" className="mt-2 text-sm text-red-700">{requestError}</p> : null}
    <div className="mt-5 border-t border-indigo-200 pt-4"><div className="flex items-center justify-between gap-2"><h4 className="text-sm font-bold">이 자료의 요청 상태</h4><button type="button" onClick={() => { void refreshRequests(); }} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs">새로고침</button></div>{sourceRequests.length ? <ul className="mt-2 space-y-2">{sourceRequests.map((item, index) => { const input = record(item.input); const scope = record(input.scope); const rawRunId = string(item.runId); const viewRunId = rawRunId.startsWith("mcp:") ? rawRunId : `mcp:${rawRunId}`; const audit = requestAudits[rawRunId]; const reportedWindow = reportedStageWindow(list(item.stages)[0]); return <li key={string(item.id) || index} className="rounded-lg bg-white p-3 text-sm"><p className="font-semibold">{show(input.purpose)}</p><p className="mt-1 text-xs text-slate-600">상태: {requestStatus(item.status)} · 종료 요청: {show(input.stopAfterStage)} · 선택 {list(scope.pageNumbers).join(", ")}쪽 · {list(scope.outlineLeafIds).length}개 목차</p><p className="mt-1 text-xs text-slate-500">요청 {when(string(item.createdAt))} · 완료한 단계 {list(item.stages).length}개</p>{audit ? <p role={audit.finding === "copied-prior-output" ? "alert" : "status"} className={`mt-2 rounded-lg border p-2 text-xs leading-5 ${audit.finding === "copied-prior-output" ? "border-amber-300 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-950"}`}>{audit.finding === "copied-prior-output" ? "검수 정정 · 새 분석 아님: " : "실행자 증거 · 새 원문 분석: "}{audit.note}</p> : null}{audit?.finding === "new-source-grounded" && reportedWindow !== null ? <p className="mt-2 text-xs text-slate-700">작성 시작→제출 완료 구간(실행자 보고): {seconds(reportedWindow)} · 초안 작성 근사와 별개</p> : null}{item.status === "completed" && rawRunId && availableRunIds.includes(viewRunId) ? <button type="button" onClick={() => onOpenRun(viewRunId)} className="mt-2 rounded-lg bg-indigo-700 px-3 py-2 text-xs font-bold text-white">새 결과 열기</button> : null}{item.failure ? <p className="mt-2 text-sm text-red-700">실패: {show(item.failure)}</p> : null}{list(item.stages).length ? <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold text-indigo-700">실제 적용 모델·결과 보기</summary><ul className="mt-2 space-y-1">{list(item.stages).map((rawStage, stageIndex) => { const stage = record(rawStage); const actual = record(stage.actual); return <li key={stageIndex} className="rounded bg-slate-50 p-2 text-xs">{show(stage.stage)} · {show(actual.model)} · {show(actual.effort)} · 완료 {when(string(actual.finishedAt))}{actual.reusedFrom ? ` · 재사용 ${show(record(actual.reusedFrom).stage)}` : ""}</li>; })}</ul></details> : <p className="mt-2 text-xs text-slate-500">실제 모델·강도 적용 기록은 아직 없습니다.</p>}<details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">요청 기록 상세</summary><p className="mt-1 break-all">요청 ID {show(item.id)} · 실행 ID {show(item.runId)}</p><FullRecord value={input} title="요청 입력 전체 펼치기" /></details></li>; })}</ul> : <p className="mt-2 text-sm text-slate-600">저장된 요청이 없습니다.</p>}</div>
  </section>;
}

function SourceCatalog({ sources, selectedRunId, selectedRun, prefill, availableRunIds, onSourcesUpdated, onRequestCompleted, onOpenRun }: { sources: McpSourceCatalogEntry[]; selectedRunId: string; selectedRun: McpRunDetail | null; prefill: LearningDesignPrefill | null; availableRunIds: string[]; onSourcesUpdated: (sources: McpSourceCatalogEntry[]) => void; onRequestCompleted: () => void; onOpenRun: (runId: string) => void }) {
  const [sourceSelection, setSourceSelection] = useState<{ runId: string; sourceId: string } | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadNotice, setUploadNotice] = useState("");
  const uploadInput = useRef<HTMLInputElement>(null);
  const [openPage, setOpenPage] = useState<{ sourceId: string; number: number } | null>(null);
  const [pdfRequested, setPdfRequested] = useState(false);
  const [pdf, setPdf] = useState<{ sourceId: string; bytes: Uint8Array } | null>(null);
  const [pdfError, setPdfError] = useState("");
  const source = sources.find((item) => item.id === sourceSelection?.sourceId && sourceSelection.runId === selectedRunId)
    ?? sources.find((item) => item.runIds.includes(selectedRunId)) ?? sources[0];
  const currentSourceId = source?.id;
  const currentOpenPage = openPage && openPage.sourceId === currentSourceId ? openPage.number : null;
  const pdfOpen = currentOpenPage !== null;
  const upload = async () => {
    if (!uploadFile || uploading) return;
    setUploading(true);
    setUploadError("");
    setUploadNotice("");
    try {
      const headers = await apiHeaders();
      const body = new FormData();
      body.set("pdf", uploadFile);
      const response = await fetch("/api/mcp-runs/sources", { method: "POST", headers, body });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(result?.message || `PDF를 등록하지 못했습니다 (${response.status}).`);
      }
      const result = await response.json().catch(() => null) as { source?: { id?: unknown } } | null;
      const registeredId = result?.source?.id;
      if (typeof registeredId !== "string" || !registeredId.trim()) throw new Error("등록 응답에서 자료 ID를 확인하지 못했습니다.");
      const refreshed = await loadApi<{ sources: McpSourceCatalogEntry[] }>("/api/mcp-runs/sources")
        .catch(() => { throw new Error("PDF는 등록됐지만 자료 목록을 갱신하지 못했습니다. 화면을 새로고침하세요."); });
      onSourcesUpdated(refreshed.sources);
      const registered = refreshed.sources.find((item) => item.id === registeredId);
      if (registered) setSourceSelection({ runId: selectedRunId, sourceId: registered.id });
      setUploadNotice(registered ? `${registered.fileName} 등록 완료 · 자료를 선택했습니다.` : "PDF를 등록했습니다. 아래 자료 목록에서 선택하세요.");
      setUploadFile(null);
      if (uploadInput.current) uploadInput.current.value = "";
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : "PDF를 등록하지 못했습니다.");
    } finally {
      setUploading(false);
    }
  };
  useEffect(() => {
    if (!currentSourceId || !pdfRequested || !pdfOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/mcp-runs/sources/${encodeURIComponent(currentSourceId)}/pdf`, {
          headers: await apiHeaders(), cache: "no-store",
        });
        if (!response.ok) throw new Error(`원본 PDF를 열지 못했습니다 (${response.status}).`);
        if (!response.headers.get("content-type")?.includes("application/pdf")) throw new Error("원본 파일의 형식이 PDF가 아닙니다.");
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;
        setPdf({ sourceId: currentSourceId, bytes });
        setPdfError("");
      } catch (error) {
        if (!cancelled) setPdfError(error instanceof Error ? error.message : "원본 PDF를 열지 못했습니다.");
      }
    })();
    return () => { cancelled = true; };
  }, [currentSourceId, pdfRequested, pdfOpen]);
  const uploadForm = <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
    <h3 className="font-semibold">PDF 자료 등록</h3>
    <p className="mt-1 text-sm text-slate-600">학습할 PDF를 등록한 뒤 자료를 선택하고 범위와 생성 조건을 정하세요.</p>
    <div className="mt-3 flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm font-semibold">PDF 파일
      <input ref={uploadInput} type="file" accept=".pdf,application/pdf" onChange={(event) => { setUploadFile(event.target.files?.[0] ?? null); setUploadError(""); setUploadNotice(""); }} className="mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm font-normal" />
    </label><button type="button" disabled={!uploadFile || uploading} onClick={() => { void upload(); }} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{uploading ? "등록 중" : "PDF 등록"}</button></div>
    {uploadNotice ? <p role="status" className="mt-2 text-sm text-emerald-800">{uploadNotice}</p> : null}
    {uploadError ? <p role="alert" className="mt-2 text-sm text-red-700">{uploadError}</p> : null}
  </div>;
  if (!source) return <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">{uploadForm}<p className="mt-4 text-sm text-slate-600">등록된 자료가 없습니다.</p></section>;
  const recorded = source.pages.filter((page) => page.recordedRunId).length;
  return <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
    {uploadForm}
    <div className="mt-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">원본 자료와 전체 범위</h2></div><label className="text-sm font-semibold">자료 선택<select value={source.id} onChange={(event) => { setSourceSelection({ runId: selectedRunId, sourceId: event.target.value }); setPdfRequested(false); setOpenPage(null); setPdf(null); setPdfError(""); }} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 font-normal">{sources.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.pageCount}쪽</option>)}</select></label></div>
    <div className="mt-4 rounded-xl bg-slate-50 p-4"><h3 className="font-semibold">{source.title}</h3><p className="mt-1 text-sm">{source.fileName} · 전체 {source.pageCount}쪽 · 실제 실행 기록이 연결된 쪽 {recorded}쪽</p><details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">원본 검증 정보</summary><p>상태: {source.available && source.matchesExpectedFile ? "등록 원본 일치" : source.available ? "등록 원본과 다름" : "원본 없음"}</p><p className="break-all">SHA-256: {source.matchesExpectedFile && source.sha256 ? source.sha256 : source.expectedSha256}</p></details></div>
    <div className="mt-4 grid grid-cols-6 gap-1.5 sm:grid-cols-11">{source.pages.map((page) => <button key={page.number} type="button" disabled={!source.matchesExpectedFile} onClick={() => { setOpenPage({ sourceId: source.id, number: page.number }); setPdfRequested(true); }} title={`${page.number}쪽 · ${page.recordedRunId ? "완료 실행 기록 연결" : "완료 실행 기록 없음"}`} aria-label={`원본 ${page.number}쪽 열기${page.recordedRunId ? " · 완료 실행 연결" : ""}`} className={`rounded-md border px-1 py-2 text-center text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${currentOpenPage === page.number ? "ring-2 ring-indigo-600 ring-offset-1" : ""} ${page.recordedRunId ? "border-indigo-300 bg-indigo-100 text-indigo-900" : "border-slate-200 bg-slate-50 text-slate-500"}`}>{page.number}</button>)}</div>
    
    {currentOpenPage !== null ? <div className="mt-4 rounded-xl border border-slate-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">원본 PDF · {currentOpenPage}쪽</h3><button type="button" onClick={() => { setOpenPage(null); setPdfRequested(false); setPdf(null); }} className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold">닫기</button></div>{pdfError ? <p role="alert" className="mt-3 text-sm text-red-700">{pdfError}</p> : pdf?.sourceId === source.id ? <SourcePdfPage key={source.id} bytes={pdf.bytes} pageNumber={currentOpenPage} /> : <p className="mt-3 text-sm text-slate-600">원본 PDF를 불러오는 중입니다.</p>}</div> : null}
    {source.outline.status === "recorded" ? <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold text-indigo-700">이 자료의 원문 목차 펼치기</summary><div className="mt-3"><NodeList nodes={list(record(source.outline.value).nodes)} /></div></details> : <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">이 자료의 MCP 목차는 아직 생성되지 않았습니다. 원본이 빈 자료라는 뜻은 아닙니다.</p>}
    <ExperimentRequestPanel source={source} selectedRun={selectedRun} prefill={prefill} availableRunIds={availableRunIds} onRequestCompleted={onRequestCompleted} onOpenRun={onOpenRun} />
  </section>;
}

function AuthoredMath({ latex }: { latex: string }) {
  let html: string | null = null;
  try {
    html = katex.renderToString(latex, { displayMode: true, throwOnError: true, trust: false });
  } catch { /* Show the source expression below when typesetting fails. */ }
  return html
    ? <span className="block overflow-x-auto py-1" dangerouslySetInnerHTML={{ __html: html }} />
    : <span className="whitespace-pre-wrap text-red-700">수식 표시 오류: {latex}</span>;
}

function AuthoredAnswer({ response }: { response: Data }) {
  if (response.kind !== "single-choice") return <>{list(response.acceptedAnswers).map(show).join(" / ") || "미기록"}</>;
  const option = list(response.options).map(record).find((item) => item.id === response.correctOptionId);
  return option?.latex ? <AuthoredMath latex={string(option.latex)} /> : <>{show(option?.text)}</>;
}

function AuthoringQuestion({ value, number }: { value: unknown; number: number }) {
  const question = record(value);
  const blocks = list(question.blocks).map(record).sort((a, b) => Number(record(a.frame).y ?? 0) - Number(record(b.frame).y ?? 0));
  const source = record(question.source);
  const heading = blocks.find((block) => block.kind === "text" && block.style === "heading");
  return <article className="rounded-xl border border-slate-200 bg-white p-4">
    <p className="text-xs font-bold text-indigo-700">문항 {number} · {show(source.sourcePage)}쪽</p>
    <h4 className="mt-2 text-lg font-semibold">{show(heading?.text || source.target)}</h4>
    <div className="mt-3 space-y-2">{blocks.filter((block) => block !== heading && ["text", "box", "math", "blank"].includes(string(block.kind))).map((block, index) => <div key={string(block.id) || index} className="rounded-lg bg-slate-50 px-3 py-2 text-sm leading-6">{block.kind === "math" ? <AuthoredMath latex={string(block.latex)} /> : block.kind === "blank" ? <p>{show(block.promptBefore)} <span className="inline-block min-w-20 border-b border-slate-500" /> {show(block.promptAfter)}</p> : <p className="whitespace-pre-wrap">{show(block.text ?? block.label)}</p>}</div>)}</div>
    {list(question.responses).map((raw, index) => { const response = record(raw); return <div key={string(response.id) || index} className="mt-3"><p className="text-xs font-semibold text-slate-500">{response.kind === "single-choice" ? "선택지" : "직접 답하기"}</p>{response.kind === "single-choice" ? <ol className="mt-2 grid gap-2 sm:grid-cols-2">{list(response.options).map((rawOption, optionIndex) => { const option = record(rawOption); return <li key={string(option.id) || optionIndex} className="rounded-lg border border-slate-200 p-2 text-sm"><span className="mr-2 font-bold text-indigo-700">{optionIndex + 1}</span>{option.latex ? <AuthoredMath latex={string(option.latex)} /> : show(option.text)}</li>; })}</ol> : null}<details className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm"><summary className="cursor-pointer font-semibold text-emerald-900">정답과 풀이</summary><p className="mt-2">정답: <AuthoredAnswer response={response} /></p><p className="mt-1 whitespace-pre-wrap">해설: {show(response.explanation)}</p></details></div>; })}
    <div className="mt-3 rounded-lg bg-indigo-50 p-3 text-sm"><p>학습 목표: {show(source.target)}</p><p className="mt-1 whitespace-pre-wrap">원문 근거: {show(source.sourceText)}</p><p className="mt-1 text-xs text-slate-600">{show(source.sourceId)} · {show(source.sourceRange)}</p></div>
    <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">문항 기록 상세</summary><div className="mt-2"><Datum value={question} /></div></details>
  </article>;
}

function AuthoringView({ run }: { run: McpRunDetail }) {
  if (run.authoring.status === "not-recorded") return <p>출제 실험 기록이 없습니다.</p>;
  const { sourcePacket, document, cycleNote } = run.authoring.value;
  const authored = record(document);
  return <div className="space-y-5"><section className="rounded-xl border border-slate-200 bg-white p-5"><h3 className="text-lg font-bold">작성한 문제</h3><div className="mt-4 space-y-3">{list(authored.questions).map((raw, index) => <AuthoringQuestion key={string(record(raw).id) || index} value={raw} number={index + 1} />)}</div><FullRecord value={document} title="작성 문서 전체 펼치기" /></section><section className="rounded-xl border border-slate-200 bg-white p-5"><h3 className="text-lg font-bold">출처와 실행 기록</h3><details className="text-xs text-slate-500"><summary className="cursor-pointer">원 실행 연결 정보</summary><p>{show(run.relatedRunId)}</p></details><FullRecord value={sourcePacket} title="MCP 출처 패킷 펼치기" /><details className="mt-3 rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer font-semibold">출제 사이클 기록 펼치기</summary><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{cycleNote}</p></details></section></div>;
}

export default function McpRunsPage() {
  const [runs, setRuns] = useState<McpRunSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [learningDesignPrefill, setLearningDesignPrefill] = useState<LearningDesignPrefill | null>(null);
  const [openRevision, setOpenRevision] = useState(0);
  const [detail, setDetail] = useState<McpRunDetail | null>(null);
  const [selectedStage, setSelectedStage] = useState<McpStageName>("analyze");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState<McpSourceCatalogEntry[]>([]);
  const [sourceError, setSourceError] = useState("");
  const refreshCompletedRuns = useCallback(async () => {
    const [runResult, sourceResult] = await Promise.allSettled([
      loadApi<{ runs: McpRunSummary[] }>("/api/mcp-runs"),
      loadApi<{ sources: McpSourceCatalogEntry[] }>("/api/mcp-runs/sources"),
    ]);
    if (runResult.status === "fulfilled") {
      setRuns(runResult.value.runs);
      setSelectedId((current) => current || runResult.value.runs[0]?.id || "");
      setError("");
    } else setError(runResult.reason instanceof Error ? runResult.reason.message : "실행 목록을 불러오지 못했습니다.");
    if (sourceResult.status === "fulfilled") {
      setSources(sourceResult.value.sources);
      setSourceError("");
    } else setSourceError(sourceResult.reason instanceof Error ? sourceResult.reason.message : "원본 목록을 불러오지 못했습니다.");
  }, []);
  const openCompletedRun = useCallback((runId: string) => {
    setDetail(null);
    setSelectedId(runId);
    setOpenRevision((current) => current + 1);
    document.getElementById("mcp-run")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const prepareLearningDesignRequest = useCallback(() => {
    if (!detail) return;
    setLearningDesignPrefill((current) => ({ runId: detail.id, revision: (current?.revision ?? 0) + 1 }));
    document.getElementById("mcp-request-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [detail]);

  useEffect(() => { let active = true; void loadApi<{ runs: McpRunSummary[] }>("/api/mcp-runs").then((result) => { if (!active) return; setRuns(result.runs); setSelectedId(result.runs[0]?.id ?? ""); setError(""); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "실행 목록을 불러오지 못했습니다."); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  useEffect(() => { let active = true; void loadApi<{ sources: McpSourceCatalogEntry[] }>("/api/mcp-runs/sources").then((result) => { if (active) setSources(result.sources); }).catch((reason: unknown) => { if (active) setSourceError(reason instanceof Error ? reason.message : "원본 목록을 불러오지 못했습니다."); }); return () => { active = false; }; }, []);
  useEffect(() => { if (!selectedId) return; let active = true; void loadApi<{ run: McpRunDetail }>(`/api/mcp-runs/${encodeURIComponent(selectedId)}`).then((result) => { if (!active) return; setDetail(result.run); setSelectedStage("analyze"); setError(""); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "실행 상세를 불러오지 못했습니다."); }); return () => { active = false; }; }, [selectedId, openRevision]);

  const stage = detail?.stages.find((item) => item.name === selectedStage);
  const config = detail?.config.status === "recorded" ? record(detail.config.value) : {};
  const packet = detail?.authoring.status === "recorded" ? record(detail.authoring.value.sourcePacket) : {};
  const provenance = detail ? provenanceCorrection(detail.provenanceNote) : null;
  return <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 md:px-8"><div className="mx-auto max-w-7xl"><header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="mt-2 text-3xl font-bold">실제 실행 기록</h1></div><Link href="/" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">앱으로 돌아가기</Link></header>{sourceError ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-900">{sourceError}</p> : null}<SourceCatalog sources={sources} onSourcesUpdated={(updated) => { setSources(updated); setSourceError(""); }} selectedRunId={selectedId} selectedRun={detail} prefill={learningDesignPrefill} availableRunIds={runs.map((run) => run.id)} onRequestCompleted={refreshCompletedRuns} onOpenRun={openCompletedRun} /><div className="mt-6 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]"><aside className="space-y-4"><section className="rounded-2xl border border-slate-200 bg-white p-4"><label htmlFor="mcp-run" className="text-sm font-bold">실행 선택</label><select id="mcp-run" value={selectedId} onChange={(event) => { setDetail(null); setSelectedId(event.target.value); }} className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"><option value="">{loading ? "불러오는 중" : "실행을 선택하세요"}</option>{runs.map((run) => <option key={run.id} value={run.id}>{run.kind === "authoring-lab" ? "별도 출제" : "MCP 5단계"} · {run.title}{run.requestRecordStatus === "not-recorded" ? " · 요청 기록 없음" : ""}</option>)}</select>{detail ? <p className="mt-3 break-words text-xs text-slate-600">상태: {runStatus(detail)} · 생성 {when(detail.createdAt)}{detail.requestRecordStatus === "not-recorded" ? " · 요청 기록 없음" : ""}</p> : null}</section>{detail?.kind === "mcp-pipeline" ? <nav className="rounded-2xl border border-slate-200 bg-white p-3" aria-label="생성 단계">{detail.stages.map((item) => <button key={item.name} type="button" onClick={() => setSelectedStage(item.name)} aria-current={selectedStage === item.name ? "step" : undefined} className={`mb-1 w-full rounded-lg p-3 text-left text-sm ${selectedStage === item.name ? "bg-indigo-100 font-bold text-indigo-900" : "hover:bg-slate-100"}`}><span className="block">{stageInfo[item.name].title}</span><span className="mt-1 block text-xs font-normal">{item.reusedFrom ? "완료 · 저장 출력 재사용" : item.status === "completed" ? "완료" : isOutsideRequestedStages(detail, item.name) ? "요청 범위 밖 · 실행 안 함" : item.validationFailures.length ? "실패 기록 있음" : item.status === "active" ? "진행 중" : "시작 전"}</span></button>)}</nav> : null}</aside><div className="min-w-0 space-y-5">{error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</div> : null}{!detail && !error ? <div className="rounded-xl bg-white p-6 text-sm text-slate-500">{loading || selectedId ? "기록을 불러오는 중입니다." : "열람할 실행 기록이 없습니다."}</div> : null}{detail ? <><section className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-bold text-indigo-700">{detail.kind === "authoring-lab" ? "별도 문제 출제 실험" : "MCP 5단계 실행"}</p><h2 className="mt-1 text-2xl font-bold">{detail.title}</h2>{detail.executionAudit ? <ExecutionAudit audit={detail.executionAudit} /> : provenance?.correction ? <p role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-950">{provenance.correction}</p> : null}<p className="mt-2 text-sm leading-6 text-slate-600">{provenance?.remainder}</p><dl className="mt-4 grid gap-4 sm:grid-cols-2"><Field name="원문 범위 · 사용자 목표" value={config.learningGoal ?? packet.learningGoal ?? "미기록"} /><Field name="사용자 지시" value={config.instruction ?? "미기록"} /><Field name="파일" value={list(config.files).map((file) => `${show(record(file).fileName)} (${show(record(file).pageCount)}쪽)`).join(" / ") || (packet.sourceFileName ? `${show(packet.sourceFileName)} · 선택 ${list(packet.selectedPdfPages).join(", ")}쪽` : "미기록")} /><Field name="선택 목차" value={detail.selectedOutlineLeafIds.status === "recorded" ? `${detail.selectedOutlineLeafIds.value.length}개 항목` : "미기록"} /></dl><details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">실행 기록 상세</summary><p className="mt-1 break-all">실행 ID: {detail.id}</p><p className="break-all">선택 목차 ID: {detail.selectedOutlineLeafIds.status === "recorded" ? detail.selectedOutlineLeafIds.value.join(", ") : "미기록"}</p><p className="break-all">기록 파일: {detail.source.root} · {detail.source.relativeFile}</p><p className="break-all">파일 해시: {detail.source.fileSha256}</p></details>{detail.config.status === "recorded" ? <FullRecord value={detail.config.value} title="사용자 조건 전체 펼치기" /> : null}</section>{detail.kind === "authoring-lab" ? <AuthoringView run={detail} /> : stage ? <StagePanel stage={stage} outsideRequest={isOutsideRequestedStages(detail, stage.name)} onUseLearningDesign={sources.some((source) => source.runIds.includes(detail.id) && source.matchesExpectedFile) ? prepareLearningDesignRequest : undefined} /> : null}</> : null}</div></div></div></main>;
}
