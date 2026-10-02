export type ArtifactScope = {
  authoringRunId: string;
  stage: "authoring-lab";
  artifactVersion: string;
  artifactSha256: string;
  originRunId: string;
  questionId: string;
  learningUnitId: string;
  sourceId: string;
  sourceRange: string;
};

type BaseEvent = { id: string; sessionId: string; scope: ArtifactScope; occurredAt: string; excluded?: boolean };
export type ExperimentEvent = BaseEvent & (
  | { kind: "started" }
  | { kind: "reveal" }
  | { kind: "submit"; responseId: string; correct: boolean | null; correction?: { correct: boolean | null; at: string } }
  | { kind: "rating"; rating: "remembered" | "unsure" | "forgot"; correction?: { rating: "remembered" | "unsure" | "forgot"; at: string } }
);
type AssessmentEvent = Extract<ExperimentEvent, { kind: "submit" | "rating" }>;

export type ReviewItem = {
  scope: ArtifactScope;
  status: "review" | "insufficient" | "not-now";
  reason: string;
  evidence: ExperimentEvent[];
};

const DAY = 24 * 60 * 60 * 1000;

export function scopeKey(scope: ArtifactScope): string {
  // Array encoding avoids delimiter collisions. Run + source + artifact version prevent cross-run ID reuse.
  return JSON.stringify([
    scope.originRunId, scope.authoringRunId, scope.stage, scope.artifactVersion,
    scope.artifactSha256, scope.questionId, scope.learningUnitId,
    scope.sourceId, scope.sourceRange,
  ]);
}

export function outcome(event: ExperimentEvent): "success" | "difficulty" | "unknown" {
  if (event.kind === "submit") {
    const correct = event.correction ? event.correction.correct : event.correct;
    return correct === null ? "unknown" : correct ? "success" : "difficulty";
  }
  if (event.kind === "rating") {
    const rating = event.correction?.rating ?? event.rating;
    return rating === "remembered" ? "success" : "difficulty";
  }
  return "unknown";
}

export function isAssisted(event: ExperimentEvent, events: ExperimentEvent[]): boolean {
  const index = events.findIndex((item) => item.id === event.id);
  if (index < 0) return false;
  return events.slice(0, index).some((prior) => prior.kind === "reveal" && prior.sessionId === event.sessionId && scopeKey(prior.scope) === scopeKey(event.scope));
}

export function recommend(scopes: ArtifactScope[], allEvents: ExperimentEvent[], now: string): ReviewItem[] {
  const nowMs = Date.parse(now);
  return scopes.map((scope) => {
    const events = allEvents.filter((event) => (event.kind === "reveal" || !event.excluded) && scopeKey(event.scope) === scopeKey(scope));
    const revealedSessions = new Set<string>();
    const assessed: Array<{ event: AssessmentEvent; assisted: boolean }> = [];
    for (const event of events) {
      if (event.kind === "reveal") revealedSessions.add(event.sessionId);
      else if (event.kind === "submit" || event.kind === "rating") assessed.push({ event, assisted: revealedSessions.has(event.sessionId) });
    }
    const independent = assessed.filter((item) => !item.assisted && outcome(item.event) !== "unknown");
    const latest = independent.at(-1);
    if (!latest) {
      return {
        scope, status: "insufficient" as const,
        reason: assessed.length ? "정답 공개 뒤 사용자 보고 또는 판정할 수 없는 제출만 있어 독립 인출 근거가 부족합니다. 기록 자체는 아래에 보존됩니다." : "아직 풀이·인출 기록이 없어 판단할 근거가 없습니다.",
        evidence: events,
      };
    }
    if (outcome(latest.event) === "difficulty") {
      const reason = latest.event.kind === "submit" ? "가장 최근 독립 풀이가 오답으로 기록됐습니다." :
        (latest.event.correction?.rating ?? latest.event.rating) === "forgot" ? "가장 최근 독립 인출에서 떠올리지 못했습니다." : "가장 최근 독립 인출에서 헷갈렸습니다.";
      return { scope, status: "review" as const, reason, evidence: events };
    }
    const days = Math.max(0, (nowMs - Date.parse(latest.event.occurredAt)) / DAY);
    if (days >= 1) return { scope, status: "review" as const, reason: `마지막 독립 성공 후 ${Math.floor(days)}일이 지났습니다. 다시 확인해 보세요.`, evidence: events };
    if (independent.slice(0, -1).some(({ event }) => outcome(event) === "difficulty")) {
      return { scope, status: "review" as const, reason: "최근에는 성공했지만 앞서 어려움이 있었습니다. 한 번의 성공만으로 숙달을 확정하지 않습니다.", evidence: events };
    }
    return { scope, status: "not-now" as const, reason: "최근 독립 성공이 있습니다. 숙달 확정은 아니며 시간이 지나면 다시 확인 후보가 됩니다.", evidence: events };
  }).sort((a, b) => ({ review: 0, insufficient: 1, "not-now": 2 })[a.status] - ({ review: 0, insufficient: 1, "not-now": 2 })[b.status]);
}

export function correctEvent(event: ExperimentEvent, correction: boolean | null | "remembered" | "unsure" | "forgot", at: string): ExperimentEvent {
  if (event.kind === "submit" && (typeof correction === "boolean" || correction === null)) return { ...event, correction: { correct: correction, at } };
  if (event.kind === "rating" && typeof correction === "string") return { ...event, correction: { rating: correction, at } };
  throw new Error("이 기록은 해당 방식으로 정정할 수 없습니다.");
}
