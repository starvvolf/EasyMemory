// Scorecard v0 for one run: numbers computed from the saved run, no model calls.
// It shows structure (formats, kinds, what the design left out, cost); meaning and depth need the judges (로드맵 3단계),
// whose results will sit in `judge` later.
import type { AuthoringDocument } from "../../../../tools/problem-authoring-lab/contract.ts";
import { purposeLabel, type GenCall, type GenState, type ItemKind } from "./types.ts";
import type { JudgeRun } from "./judge.ts";

/** Item kinds a design is expected to draw objectives from; examples, exercises and extras are material only. */
const TARGET_KINDS: readonly ItemKind[] = ["핵심 지식", "재사용 패턴", "설명"];
/** A recall that only points at the source ("the same way as …") instead of stating the knowledge. */
const POINTER = /(같은\s*(방법|방식)|위와\s*같|마찬가지|앞(의|에서)\s*(것|내용)|해당\s*(내용|방법)|원문(의|에)\s*(방법|내용))/;

export type Scorecard = {
  pastExam?: { checked: number; rejected: number; published: number; publishedPassed: number };
  run: { id: string; fileName: string; pages: string; purpose: string; guideDir: string; models: string; status: string;
    /** Set on a fixed-prefix rerun: calls, time and tokens then cover only the steps it redid. */
    forkOf: { genId: string; from: string } | null };
  counts: { sections: number; items: number; objectives: number; supportObjectives: number; chosen: number; questions: number; dropped: number };
  formats: { choice: number; short: number; selfCheck: number; selfCheckRatio: number };
  objectiveKinds: Record<string, number>;
  itemKinds: Record<string, number>;
  /** Items that could have been learning targets but no objective uses (by kind). */
  unusedTargets: Array<{ sectionId: string; n: number; kind: string; content: string }>;
  /** Structural hints that a person or the judges should look at. Not proof of a bad question. */
  suspects: Array<{ code: string; ref: string; message: string }>;
  warnings: Record<string, number>;
  calls: { total: number; failed: number; retries: number; ms: number; elapsedMs: number; inputTokens: number; outputTokens: number; formats: Record<string, number>; guideVersions: string[] };
  /** Latest finished judge run, if any (meaning and depth, from the judges). */
  judge: Pick<JudgeRun, "id" | "kind" | "createdAt" | "models" | "summary" | "trial" | "calls"> | null;
};

/** A short answer made of words (no digits, operators or arrows), e.g. "boolean 배열": spellings vary, so code grading misfires. */
export function wordyShort(answer: string) {
  const text = answer.trim();
  if (!text || /[0-9=+\-*/^→<>≤≥(){}\[\]⁻¹²³√∑∫]/.test(text)) return false;
  return /[A-Za-z가-힣]{2,}/.test(text);
}

const bump = (record: Record<string, number>, key: string, by = 1) => { record[key] = (record[key] ?? 0) + by; };

export function scorecard(state: GenState, calls: GenCall[], documents: Map<string, AuthoringDocument | null>, judge: JudgeRun | null = null): Scorecard {
  const objectives = state.sections.flatMap((section) => section.design?.objectives ?? []);
  const chosen = new Set(state.confirmedObjectiveIds ?? []);
  const questions = [...documents.values()].flatMap((document) => document?.questions ?? []);
  const formats = { choice: 0, short: 0, selfCheck: 0, selfCheckRatio: 0 };
  for (const question of questions) {
    for (const response of question.responses) {
      if (response.kind === "single-choice") formats.choice += 1;
      else if (response.grading === "self-check") formats.selfCheck += 1;
      else formats.short += 1;
    }
  }
  const answered = formats.choice + formats.short + formats.selfCheck;
  formats.selfCheckRatio = answered ? Math.round((formats.selfCheck / answered) * 100) / 100 : 0;

  const objectiveKinds: Record<string, number> = {};
  for (const objective of objectives) bump(objectiveKinds, objective.kind);
  const itemKinds: Record<string, number> = {};
  const unusedTargets: Scorecard["unusedTargets"] = [];
  for (const section of state.sections) {
    const used = new Set((section.design?.objectives ?? []).flatMap((objective) => objective.itemNumbers));
    for (const item of section.classify?.items ?? []) {
      bump(itemKinds, item.kind);
      if (section.design && TARGET_KINDS.includes(item.kind) && !used.has(item.n)) unusedTargets.push({ sectionId: section.id, n: item.n, kind: item.kind, content: item.content });
    }
  }

  const suspects: Scorecard["suspects"] = [];
  const formatOf = new Map(questions.map((question) => [question.source.objectiveId, question.responses[0]]));
  for (const objective of objectives) {
    if (POINTER.test(objective.recall)) suspects.push({ code: "recall-pointer", ref: objective.id, message: `떠올릴 것이 지식이 아니라 원문을 가리키는 말이에요: ${objective.recall.slice(0, 60)}` });
    const response = formatOf.get(objective.id);
    if (response && /고를\s*수/.test(objective.statement) && response.kind !== "single-choice") {
      suspects.push({ code: "verb-format", ref: objective.id, message: "목표는 '고를 수 있다'인데 보기 고르기 문제가 아니에요." });
    }
    // Code grading only works when the answer has one spelling (a value, symbol or sequence of given names).
    if (response && response.kind === "short-text" && response.grading !== "self-check" && wordyShort(response.acceptedAnswers[0] ?? "")) {
      suspects.push({ code: "short-wordy", ref: objective.id, message: `단답인데 같은 뜻을 여러 말로 쓸 수 있는 답이에요(플래시카드 후보): ${(response.acceptedAnswers[0] ?? "").slice(0, 40)}` });
    }
  }

  const warnings: Record<string, number> = {};
  for (const warning of [...(state.outlineWarnings ?? []), ...state.sections.flatMap((section) => [
    ...(section.classify?.warnings ?? []), ...(section.design?.warnings ?? []), ...(section.author?.warnings ?? [])])]) bump(warnings, warning.code);

  const callFormats: Record<string, number> = {};
  for (const call of calls) if (call.format) bump(callFormats, call.format);
  // Wall time of model work per phase (outline / classify+design / author), so waiting at the confirmation does not count.
  const span = (steps: string[]) => {
    const own = calls.filter((call) => steps.includes(call.step)).map((call) => [Date.parse(call.startedAt), Date.parse(call.startedAt) + call.ms]).filter(([start]) => Number.isFinite(start));
    return own.length ? Math.max(...own.map(([, end]) => end)) - Math.min(...own.map(([start]) => start)) : 0;
  };
  const models = [...new Set(calls.map((call) => `${call.step}:${call.model}·${call.effort}`))].join(", ");

  return {
    run: {
      id: state.id, fileName: state.input.fileName, pages: `${state.input.pageNumbers[0]}–${state.input.pageNumbers.at(-1)}`,
      purpose: purposeLabel[state.input.purpose], guideDir: state.input.guideDir ?? "출제기준", models, status: state.status,
      forkOf: state.forkOf ?? null,
    },
    counts: {
      sections: state.sections.length,
      items: state.sections.reduce((sum, section) => sum + (section.classify?.items.length ?? 0), 0),
      objectives: objectives.length,
      supportObjectives: objectives.filter((objective) => objective.importance === "support").length,
      chosen: chosen.size,
      questions: questions.length,
      dropped: state.sections.reduce((sum, section) => sum + (section.author?.dropped.length ?? 0), 0),
    },
    formats, objectiveKinds, itemKinds, unusedTargets, suspects, warnings,
    ...(state.pastExam ? { pastExam: {
      checked: state.pastExam.checks.length,
      rejected: state.pastExam.checks.filter((check) => !check.passed).length,
      published: questions.length,
      publishedPassed: questions.filter((question) => state.pastExam!.checks.filter((check) => check.objectiveId === question.source.objectiveId).at(-1)?.passed).length,
    } } : {}),
    calls: {
      total: calls.length, failed: calls.filter((call) => !call.ok).length, retries: calls.filter((call) => call.attempt > 1).length,
      ms: calls.reduce((sum, call) => sum + call.ms, 0),
      elapsedMs: span(["outline"]) + span(["classify", "design"]) + span(["author"]),
      inputTokens: calls.reduce((sum, call) => sum + (call.usage?.inputTokens ?? 0), 0),
      outputTokens: calls.reduce((sum, call) => sum + (call.usage?.outputTokens ?? 0), 0),
      formats: callFormats,
      guideVersions: [...new Set(calls.flatMap((call) => call.guide ? [`${call.step}:${call.guide.version}`] : []))],
    },
    judge: judge ? { id: judge.id, kind: judge.kind, createdAt: judge.createdAt, models: judge.models, summary: judge.summary, trial: judge.trial, calls: judge.calls } : null,
  };
}
