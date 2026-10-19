// The model picks block kinds, their order and the answer form; code places the blocks top to bottom,
// wires the response, and fills the source from the confirmed objective (never copied by the model).
import type { AuthoredQuestion, AuthoringBlock, AuthoringDocument, ResponseContract, SourceContent } from "../../../../tools/problem-authoring-lab/contract.ts";
import { validateDocument } from "../../../../tools/problem-authoring-lab/contract.ts";
import { inspectQuality } from "../../../../tools/problem-authoring-lab/quality.ts";
import type { AuthoredReplyQuestion } from "./schemas.ts";
import type { Issue, Objective, Section } from "./types.ts";

export const PAGE_WIDTH = 760;
const MARGIN = 24, GAP = 12, INNER = PAGE_WIDTH - MARGIN * 2;
// Rough line capacity of the preview at body size; Korean runs ~1.6x wider than Latin per character.
const lines = (text: string, perLine = 44) => Math.max(1, text.split("\n").reduce((sum, line) => {
  const units = [...line].reduce((width, char) => width + (/[ㄱ-힣一-鿿]/.test(char) ? 1.6 : 1), 0) / 1.6;
  return sum + Math.max(1, Math.ceil(units / perLine));
}, 0));

/**
 * Instructions to the learner ("떠올린 뒤 모범 답과 비교하세요") next to the input box are meta text, not part of the
 * question (AGENTS.md 6). The box labels keep only short labels such as "자료구조:"; anything instruction-like is dropped.
 */
const META = /(떠올(린|려|리)|비교(하|해)|모범\s*답|확인(하|해)\s*(세요|보세요|봅시다)|생각(하|해)\s*보|(답|정답)을?\s*(쓰|적|입력)|적어\s*보|써\s*보|쓰세요|적으세요|입력하세요)/;
export function inputLabel(text: string | null) {
  const value = (text ?? "").trim();
  return META.test(value) ? "" : value;
}
/** Which input-box texts were instructions and get dropped (reported as a tier-3 warning). */
export function metaLabels(reply: AuthoredReplyQuestion) {
  return [reply.answer.before, reply.answer.after].filter((value): value is string => Boolean(value?.trim()) && inputLabel(value) === "");
}

export function sourceFor(objective: Objective, section: Section, fileName: string): SourceContent {
  return {
    learningUnitId: objective.id, objectiveId: objective.id, sourceId: fileName,
    sourcePage: objective.pages[0] ?? section.pages[0], sourcePages: objective.pages.length ? objective.pages : [section.pages[0]],
    sourceRange: `PDF ${(objective.pages.length ? objective.pages : section.pages).join(", ")}쪽 / ${section.title}`,
    knowledgeContent: objective.recall, sourceText: objective.quotes.join(" || "),
    target: objective.statement, successCriteria: [`${objective.cue} → ${objective.recall}`],
  };
}

/** Shape problems that make the question unanswerable; reported back to the model as tier-2 problems. */
export function answerShapeProblem(reply: AuthoredReplyQuestion): string | null {
  const answer = reply.answer;
  if (!reply.stem.some((block) => (block.text ?? block.latex ?? block.rows?.flat().join("") ?? "").trim())) return "문제 본문이 비어 있습니다.";
  if (answer.kind === "choice") {
    const options = answer.options ?? [];
    // v5 OX: a two-option choice whose options are exactly O and X.
    if (options.length === 2 && options.map((option) => (option.text ?? "").trim()).join() === "O,X") return answer.correctIndex === 0 || answer.correctIndex === 1 ? null : "OX의 correctIndex가 0(O) 또는 1(X)이 아닙니다.";
    if (options.length !== 4 || options.some((option) => !(option.text ?? option.latex ?? "").trim())) return "choice는 내용이 있는 보기가 정확히 4개여야 합니다.";
    if (answer.correctIndex === null || answer.correctIndex < 0 || answer.correctIndex > 3) return "choice의 correctIndex가 0~3이 아닙니다.";
    const keys = options.map((option) => (option.text ?? option.latex ?? "").trim().toLocaleLowerCase("ko-KR"));
    if (new Set(keys).size !== 4) return "choice 보기 중 같은 보기가 있습니다.";
  } else if (!(answer.accepted ?? []).some((value) => value.trim())) {
    return answer.kind === "short" ? "short의 인정 답안이 비어 있습니다." : "self-check의 모범 답이 비어 있습니다.";
  }
  return null;
}

export function layoutQuestion(reply: AuthoredReplyQuestion, objective: Objective, section: Section, fileName: string): AuthoredQuestion {
  const blocks: AuthoringBlock[] = [];
  // Response IDs must be unique across a whole document (a section, or all sections on the study screen).
  const rid = `r-${objective.id}`;
  let y = MARGIN;
  const place = (height: number) => { const frame = { x: MARGIN, y, width: INNER, height }; y += height + GAP; return frame; };
  reply.stem.forEach((block, index) => {
    const id = `b${index + 1}`;
    if (block.kind === "math" && block.latex?.trim()) blocks.push({ id, kind: "math", latex: block.latex.trim(), displayMode: true, frame: place(64) });
    else if (block.kind === "table" && block.rows?.length) blocks.push({ id, kind: "table", rows: block.rows, headerRows: 1, frame: place(block.rows.length * 36 + 16) });
    else if (block.kind === "box" && block.text?.trim()) blocks.push({ id, kind: "box", label: block.text.trim(), tone: "plain", frame: place(lines(block.text) * 26 + 24) });
    else if (block.text?.trim()) {
      const heading = block.kind === "heading";
      blocks.push({ id, kind: "text", text: block.text.trim(), style: heading ? "heading" : "body", frame: place(lines(block.text, heading ? 36 : 44) * (heading ? 30 : 26) + 12) });
    }
  });
  const answer = reply.answer;
  let response: ResponseContract;
  if (answer.kind === "choice") {
    const options = (answer.options ?? []).map((option, index): { id: string; text?: string; latex?: string } =>
      option.latex?.trim() ? { id: `o${index + 1}`, latex: option.latex.trim() } : { id: `o${index + 1}`, text: (option.text ?? "").trim() });
    response = { id: rid, kind: "single-choice", options, correctOptionId: `o${(answer.correctIndex ?? 0) + 1}`, grading: "exact", explanation: answer.explanation };
    const height = options.reduce((sum, option) => sum + lines(option.text ?? option.latex ?? "", 40) * 26 + 22, 8);
    blocks.push({ id: "choices", kind: "choice-set", responseId: rid, optionIds: options.map((option) => option.id), frame: place(height) });
  } else {
    const accepted = (answer.accepted ?? []).map((value) => value.trim()).filter(Boolean);
    response = { id: rid, kind: "short-text", acceptedAnswers: answer.kind === "short" ? accepted : accepted.slice(0, 1), grading: answer.kind === "short" ? "exact-normalized" : "self-check", explanation: answer.explanation };
    blocks.push({ id: "input", kind: "blank", responseId: rid, promptBefore: inputLabel(answer.before), promptAfter: inputLabel(answer.after), frame: place(answer.kind === "short" ? 56 : 120) });
  }
  const revealText = `${response.kind === "short-text" ? response.acceptedAnswers[0] ?? "" : ""} ${answer.explanation}`;
  blocks.push({ id: "reveal", kind: "answer-reveal", responseIds: [rid], frame: place(lines(revealText, 40) * 26 + 72) });
  return { id: `q-${objective.id}`, source: sourceFor(objective, section, fileName), page: { width: PAGE_WIDTH, height: y - GAP + MARGIN }, blocks, responses: [response] };
}

export function sectionDocument(genId: string, section: Section, fileName: string, questions: AuthoredQuestion[]): AuthoringDocument {
  return { schemaVersion: "problem-authoring-v1", id: `${genId}-${section.id}`, title: `${fileName.replace(/\.pdf$/i, "")} · ${section.title}`, questions };
}

/** Short answers that are a sequence of 2–6 short names joined by arrows. */
export function isOrderAnswer(question: AuthoredQuestion) {
  const response = question.responses[0];
  return response.kind === "short-text" && response.grading !== "self-check" && response.acceptedAnswers.length > 0
    && response.acceptedAnswers.every((answer) => { const parts = answer.split(/\s*(?:→|->)\s*/); return parts.length >= 2 && parts.length <= 6 && parts.every((part) => part.trim() && part.trim().length <= 20); });
}

/** Contract errors and quality errors are tier 2 (unsolvable or leaking); quality warnings are tier 3. */
export function inspectQuestion(question: AuthoredQuestion, options: { ignoreLatexFormatting?: boolean; astraSemanticWarnings?: boolean } = {}): { errors: Issue[]; warnings: Issue[] } {
  const document: AuthoringDocument = { schemaVersion: "problem-authoring-v1", id: "check", title: "check", questions: [question] };
  const issues = [...validateDocument(document), ...inspectQuality(document, options).map((issue) => options.astraSemanticWarnings && ["answer-leak-before-reveal", "composite-short-answer"].includes(issue.code) ? { ...issue, severity: "warning" as const } : issue)]
    // An order written with the given names ("A → B → C", 출제기준 단답-5) is one answer, not several in one box.
    .filter((issue) => !(issue.code === "composite-short-answer" && isOrderAnswer(question)))
    .map((issue) => ({ severity: issue.severity, code: issue.code, message: issue.message, ref: question.source.objectiveId }));
  return { errors: issues.filter((issue) => issue.severity === "error"), warnings: issues.filter((issue) => issue.severity === "warning") };
}
