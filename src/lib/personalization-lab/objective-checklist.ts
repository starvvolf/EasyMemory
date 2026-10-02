import { outcome, scopeKey, type ArtifactScope, type ExperimentEvent } from "./rule.ts";
import type { KnowledgeUnit, LearningDesignObjective } from "../types";

export type LearningObjective = Pick<LearningDesignObjective, "id" | "target" | "outlineNodeIds" | "successCriteria">;

export type LearningKnowledgeUnit = Pick<KnowledgeUnit, "id" | "objectiveId" | "sourceId" | "sourcePage">;

/** The producer must validate this link against the recorded authoring document and LD output. */
export type ObjectiveQuestionLink = {
  verification: "verified" | "unverified";
  verificationBasis?: "blueprint-coverage" | "exact-criterion-text";
  artifactId?: string;
  sourceSha256: string;
  learningDesignSha256: string;
  documentSha256: string;
  objectiveId: string;
  learningUnitId: string;
  criterionIds: string[];
  scope: ArtifactScope;
};

export type ObjectiveChecklistInput = {
  sourceSha256: string;
  runId: string;
  learningDesignSha256: string;
  objectives: LearningObjective[];
  knowledgeUnits: LearningKnowledgeUnit[];
  questionLinks: ObjectiveQuestionLink[];
  events: ExperimentEvent[];
  now: string;
};

export type ObjectiveChecklistStatus =
  | "no-question"
  | "unattempted"
  | "needs-review"
  | "self-check"
  | "partial-evidence"
  | "recent-independent-success";

export type ObjectiveChecklistItem = {
  objective: LearningObjective;
  knowledgeUnits: LearningKnowledgeUnit[];
  status: ObjectiveChecklistStatus;
  questionLinks: ObjectiveQuestionLink[];
  unverifiedQuestionIds: string[];
  coveredLearningUnitIds: string[];
  coveredCriterionIds: string[];
  partialEvidence: boolean;
  evidence: {
    assessmentCount: number;
    independentCorrectCount: number;
    independentWrongCount: number;
    assistedAssessmentCount: number;
    selfCheckCount: number;
  };
};

function validLink(
  link: ObjectiveQuestionLink,
  input: ObjectiveChecklistInput,
  objectives: Map<string, LearningObjective>,
  units: Map<string, LearningKnowledgeUnit>,
): boolean {
  const objective = objectives.get(link.objectiveId);
  const unit = units.get(link.learningUnitId);
  return link.verification === "verified" &&
    link.sourceSha256 === input.sourceSha256 &&
    link.learningDesignSha256 === input.learningDesignSha256 &&
    link.documentSha256 === link.scope.artifactSha256 &&
    link.scope.originRunId === input.runId &&
    link.scope.learningUnitId === link.learningUnitId &&
    !!objective && !!unit && unit.objectiveId === objective.id &&
    link.scope.sourceId === unit.sourceId &&
    link.criterionIds.every((id) => objective.successCriteria.some((criterion) => criterion.id === id));
}

/** A read-only projection: event storage remains keyed by its original authoring document. */
export function deriveObjectiveChecklist(input: ObjectiveChecklistInput): ObjectiveChecklistItem[] {
  const objectives = new Map(input.objectives.map((objective) => [objective.id, objective]));
  const units = new Map(input.knowledgeUnits.map((unit) => [unit.id, unit]));
  const linked = new Map<string, ObjectiveQuestionLink[]>();
  const unverified = new Map<string, string[]>();
  for (const link of input.questionLinks) {
    if (!objectives.has(link.objectiveId)) continue;
    if (validLink(link, input, objectives, units)) {
      const list = linked.get(link.objectiveId) ?? [];
      if (!list.some((item) => scopeKey(item.scope) === scopeKey(link.scope) && item.learningUnitId === link.learningUnitId)) list.push(link);
      linked.set(link.objectiveId, list);
    } else {
      const list = unverified.get(link.objectiveId) ?? [];
      if (!list.includes(link.scope.questionId)) list.push(link.scope.questionId);
      unverified.set(link.objectiveId, list);
    }
  }

  const eventsByScope = new Map<string, ExperimentEvent[]>();
  input.events.forEach((event) => {
    const key = scopeKey(event.scope);
    const list = eventsByScope.get(key) ?? [];
    list.push(event);
    eventsByScope.set(key, list);
  });
  const nowMs = Date.parse(input.now);
  return input.objectives.map((objective) => {
    const questionLinks = linked.get(objective.id) ?? [];
    const knowledgeUnits = input.knowledgeUnits.filter((unit) => unit.objectiveId === objective.id);
    const coveredUnits = new Set<string>();
    const coveredCriteria = new Set<string>();
    const staleUnits = new Set<string>();
    const evidence = { assessmentCount: 0, independentCorrectCount: 0, independentWrongCount: 0, assistedAssessmentCount: 0, selfCheckCount: 0 };
    let needsReview = false;
    for (const link of questionLinks) {
      const events = (eventsByScope.get(scopeKey(link.scope)) ?? [])
        .filter((event) => event.kind === "reveal" || !event.excluded)
        .map((event, index) => ({ event, index }))
        .sort((a, b) => Date.parse(a.event.occurredAt) - Date.parse(b.event.occurredAt) || a.index - b.index)
        .map(({ event }) => event);
      const revealedSessions = new Set<string>();
      const independentSubmissions: Array<{ result: "success" | "difficulty"; sessionId: string; occurredAt: string }> = [];
      const signals: Array<{ result: "success" | "difficulty"; sessionId: string }> = [];
      for (const event of events) {
        if (event.kind === "reveal") {
          revealedSessions.add(event.sessionId);
          continue;
        }
        if (event.kind !== "submit" && event.kind !== "rating") continue;
        evidence.assessmentCount++;
        const assisted = revealedSessions.has(event.sessionId);
        if (assisted) evidence.assistedAssessmentCount++;
        if (event.kind === "rating") {
          evidence.selfCheckCount++;
          if (outcome(event) === "difficulty") signals.push({ result: "difficulty", sessionId: event.sessionId });
          continue;
        }
        if (assisted) continue;
        const result = outcome(event);
        if (result === "difficulty") {
          evidence.independentWrongCount++;
        } else if (result === "success") {
          evidence.independentCorrectCount++;
        }
        if (result !== "unknown") {
          independentSubmissions.push({ result, sessionId: event.sessionId, occurredAt: event.occurredAt });
          signals.push({ result, sessionId: event.sessionId });
        }
      }
      const lastDifficulty = signals.findLastIndex((signal) => signal.result === "difficulty");
      const recoverySessions = new Set(signals.slice(lastDifficulty + 1)
        .filter((signal) => signal.result === "success").map((signal) => signal.sessionId));
      const recovered = lastDifficulty < 0 || recoverySessions.size >= 2;
      if (!recovered) needsReview = true;
      const latestSubmit = independentSubmissions.at(-1);
      if (latestSubmit?.result === "success") {
        const ageMs = nowMs - Date.parse(latestSubmit.occurredAt);
        if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 24 * 60 * 60 * 1000 && recovered) {
          coveredUnits.add(link.learningUnitId);
          link.criterionIds.forEach((id) => coveredCriteria.add(id));
        } else if (recovered) staleUnits.add(link.learningUnitId);
      }
    }
    if ([...staleUnits].some((id) => !coveredUnits.has(id))) needsReview = true;
    const coveredLearningUnitIds = knowledgeUnits.filter((unit) => coveredUnits.has(unit.id)).map((unit) => unit.id);
    const coveredCriterionIds = objective.successCriteria.filter((criterion) => coveredCriteria.has(criterion.id)).map((criterion) => criterion.id);
    const partialEvidence = evidence.assessmentCount > 0 &&
      (coveredLearningUnitIds.length < knowledgeUnits.length || coveredCriterionIds.length < objective.successCriteria.length);
    const completeRecentEvidence = evidence.independentCorrectCount > 0 && !partialEvidence && knowledgeUnits.length > 0 && objective.successCriteria.length > 0;
    const status: ObjectiveChecklistStatus = !questionLinks.length ? "no-question" :
      !evidence.assessmentCount ? "unattempted" :
      needsReview ? "needs-review" :
      completeRecentEvidence ? "recent-independent-success" :
      evidence.independentCorrectCount ? "partial-evidence" :
      evidence.selfCheckCount ? "self-check" : "partial-evidence";
    return {
      objective, knowledgeUnits, status, questionLinks,
      unverifiedQuestionIds: unverified.get(objective.id) ?? [],
      coveredLearningUnitIds, coveredCriterionIds, partialEvidence, evidence,
    };
  });
}
