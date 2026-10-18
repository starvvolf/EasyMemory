import assert from "node:assert/strict";
import test from "node:test";
import { deriveObjectiveChecklist, type ObjectiveChecklistInput, type ObjectiveQuestionLink } from "./objective-checklist.ts";
import type { ArtifactScope, ExperimentEvent } from "./rule.ts";

const sha = (letter: string) => letter.repeat(64);
const now = "2026-09-28T12:00:00.000Z";
const scope: ArtifactScope = {
  authoringRunId: "authoring-a", stage: "authoring-lab", artifactVersion: "iteration-1",
  artifactSha256: sha("a"), originRunId: "run-a", questionId: "q-1",
  learningUnitId: "unit-1", sourceId: "source.pdf", sourceRange: "2쪽",
};
const link: ObjectiveQuestionLink = {
  verification: "verified", sourceSha256: sha("s"), learningDesignSha256: sha("l"),
  documentSha256: sha("a"), objectiveId: "objective-1", learningUnitId: "unit-1",
  criterionIds: ["criterion-1"], scope,
};
const base: ObjectiveChecklistInput = {
  sourceSha256: sha("s"), runId: "run-a", learningDesignSha256: sha("l"),
  objectives: [
    { id: "objective-1", target: "첫 목표", outlineNodeIds: ["outline-1"], successCriteria: [{ id: "criterion-1", description: "첫 기준", required: true }] },
    { id: "objective-2", target: "둘째 목표", outlineNodeIds: ["outline-2"], successCriteria: [{ id: "criterion-2", description: "둘째 기준", required: true }] },
  ],
  knowledgeUnits: [
    { id: "unit-1", objectiveId: "objective-1", sourceId: "source.pdf", sourcePage: 2 },
    { id: "unit-2", objectiveId: "objective-2", sourceId: "source.pdf", sourcePage: 3 },
  ],
  questionLinks: [link], events: [], now,
};
const event = (id: string, kind: "submit" | "reveal" | "rating", extra: object = {}): ExperimentEvent => ({
  id, sessionId: "session-1", scope, kind, occurredAt: "2026-09-28T11:00:00.000Z", ...extra,
} as ExperimentEvent);
const project = (changes: Partial<ObjectiveChecklistInput> = {}) => deriveObjectiveChecklist({ ...base, ...changes });

test("LD objectives without questions remain visible and linked questions begin unattempted", () => {
  const rows = project();
  assert.deepEqual(rows.map((row) => row.status), ["unattempted", "no-question"]);
  assert.equal(rows[1].objective.target, "둘째 목표");
  assert.equal(rows[1].knowledgeUnits[0].sourcePage, 3);
});

test("unverified links and run, LD, source, or document hash mismatches do not attach attempts", () => {
  const variations: ObjectiveQuestionLink[] = [
    { ...link, verification: "unverified" },
    { ...link, sourceSha256: sha("x") },
    { ...link, learningDesignSha256: sha("x") },
    { ...link, documentSha256: sha("x") },
    { ...link, scope: { ...scope, originRunId: "run-b" } },
  ];
  for (const candidate of variations) {
    const row = project({ questionLinks: [candidate], events: [event("pass", "submit", { responseId: "r", correct: true })] })[0];
    assert.equal(row.status, "no-question");
    assert.deepEqual(row.unverifiedQuestionIds, ["q-1"]);
  }
});

test("same IDs in a different authoring document or version cannot merge events", () => {
  const changedScopes = [
    { ...scope, artifactSha256: sha("b") },
    { ...scope, artifactVersion: "iteration-2" },
    { ...scope, authoringRunId: "authoring-b" },
  ];
  for (const otherScope of changedScopes) {
    const row = project({ events: [event("pass", "submit", { scope: otherScope, responseId: "r", correct: true })] })[0];
    assert.equal(row.status, "unattempted");
  }
});

test("independent error needs review; a post-reveal correct answer is assisted", () => {
  const wrong = project({ events: [event("wrong", "submit", { responseId: "r", correct: false })] })[0];
  assert.equal(wrong.status, "needs-review");
  const assisted = project({ events: [
    event("reveal", "reveal", { occurredAt: "2026-09-28T10:59:00.000Z" }),
    event("pass", "submit", { responseId: "r", correct: true }),
  ] })[0];
  assert.equal(assisted.status, "partial-evidence");
  assert.equal(assisted.evidence.independentCorrectCount, 0);
  assert.equal(assisted.evidence.assistedAssessmentCount, 1);
});

test("self-check is separate from independent correct answer", () => {
  const row = project({ events: [event("remembered", "rating", { rating: "remembered" })] })[0];
  assert.equal(row.status, "self-check");
  assert.equal(row.evidence.selfCheckCount, 1);
  assert.equal(row.evidence.independentCorrectCount, 0);
});

test("one correct question leaves a multi-unit, multi-criterion objective partially evidenced", () => {
  const objective = { ...base.objectives[0], successCriteria: [
    ...base.objectives[0].successCriteria,
    { id: "criterion-3", description: "추가 기준", required: true },
  ] };
  const row = project({
    objectives: [objective],
    knowledgeUnits: [base.knowledgeUnits[0], { id: "unit-3", objectiveId: "objective-1", sourceId: "source.pdf", sourcePage: 4 }],
    events: [event("pass", "submit", { responseId: "r", correct: true })],
  })[0];
  assert.equal(row.status, "partial-evidence");
  assert.equal(row.partialEvidence, true);
  assert.deepEqual(row.coveredLearningUnitIds, ["unit-1"]);
  assert.deepEqual(row.coveredCriterionIds, ["criterion-1"]);
});

test("verified recent independent successes cover every linked unit and criterion without asserting mastery", () => {
  const secondScope = { ...scope, questionId: "q-2", learningUnitId: "unit-3" };
  const secondLink = { ...link, scope: secondScope, learningUnitId: "unit-3", criterionIds: ["criterion-3"] };
  const row = project({
    objectives: [{ ...base.objectives[0], successCriteria: [
      ...base.objectives[0].successCriteria, { id: "criterion-3", description: "추가 기준", required: true },
    ] }],
    knowledgeUnits: [base.knowledgeUnits[0], { id: "unit-3", objectiveId: "objective-1", sourceId: "source.pdf", sourcePage: 4 }],
    questionLinks: [link, secondLink],
    events: [
      event("pass-1", "submit", { responseId: "r", correct: true }),
      event("pass-2", "submit", { scope: secondScope, responseId: "r", correct: true }),
    ],
  })[0];
  assert.equal(row.status, "recent-independent-success");
  assert.equal(row.partialEvidence, false);
});

test("a recent independent answer refreshes old successful evidence", () => {
  const old = event("old", "submit", { sessionId: "old-session", responseId: "r", correct: true, occurredAt: "2026-09-26T11:00:00.000Z" });
  assert.equal(project({ events: [old] })[0].status, "needs-review");
  const recent = event("recent", "submit", { sessionId: "new-session", responseId: "r", correct: true });
  assert.equal(project({ events: [old, recent] })[0].status, "recent-independent-success");
});

test("a prior wrong answer needs two later independent success sessions to recover", () => {
  const wrong = event("wrong", "submit", { sessionId: "wrong-session", responseId: "r", correct: false, occurredAt: "2026-09-28T09:00:00.000Z" });
  const first = event("first", "submit", { sessionId: "first-session", responseId: "r", correct: true, occurredAt: "2026-09-28T10:00:00.000Z" });
  const second = event("second", "submit", { sessionId: "second-session", responseId: "r", correct: true });
  assert.equal(project({ events: [wrong, first] })[0].status, "needs-review");
  assert.equal(project({ events: [wrong, first, second] })[0].status, "recent-independent-success");
  const newWrong = event("new-wrong", "submit", { sessionId: "latest-session", responseId: "r", correct: false, occurredAt: "2026-09-28T11:30:00.000Z" });
  assert.equal(project({ events: [wrong, first, second, newWrong] })[0].status, "needs-review");
});

test("same-session repeated answers do not count as independent recovery", () => {
  const wrong = event("wrong", "submit", { responseId: "r", correct: false, occurredAt: "2026-09-28T09:00:00.000Z" });
  const first = event("first", "submit", { sessionId: "repeat-session", responseId: "r", correct: true, occurredAt: "2026-09-28T10:00:00.000Z" });
  const second = event("second", "submit", { sessionId: "repeat-session", responseId: "r", correct: true });
  assert.equal(project({ events: [wrong, first, second] })[0].status, "needs-review");
});

test("same saved input reproduces the same checklist after JSON reload", () => {
  const input = { ...base, events: [event("pass", "submit", { responseId: "r", correct: true })] };
  assert.deepEqual(deriveObjectiveChecklist(JSON.parse(JSON.stringify(input))), deriveObjectiveChecklist(input));
});
