/** Account-scoped derived state; original records remain the source of truth. */
export type MemoryDomain = "algorithm" | "cs" | "opic" | "report";
export type MemoryBasis = "observation" | "self-report" | "inference";
/** Submitted summary snapshot; ownership is verified, educational truth is not certified. */
export interface LearnerMemoryRecordInput {
  recordId: string;
  summary: {
    throughMessageId: string;
    updatedAt: string;
    automatic: boolean;
    sections: { text: string; messageIds: string[]; codeIds: string[] }[];
    learnerMemoryCandidates: unknown;
  };
  evidenceIndex: { id: string; kind: "message" | "code"; contentHash: string }[];
}
export interface MemoryCandidate {
  domain: MemoryDomain;
  topic: string;
  confirmed: string[];
  uncertain: string[];
  evidenceIds: string[];
  basis: MemoryBasis;
}
export interface MemoryEntry {
  domain: MemoryDomain;
  topic: string;
  confirmed: string[];
  uncertain: string[];
  updatedAt: string;
  evidence: { recordId: string; throughSequence: number; evidenceIds: string[] };
  userEdited: boolean;
  deleted: boolean;
  basis: MemoryBasis;
}
export interface MemoryState {
  ownerUid: string;
  revision: number;
  entries: MemoryEntry[];
  appliedSources: { recordId: string; throughSequence: number }[];
}
/** Construct from the owned record's stable evidence index, never model-supplied positions. */
export interface MemorySource {
  ownerUid: string;
  recordId: string;
  throughSequence: number;
  events: { id: string; sequence: number }[];
}
export const MEMORY_LIMITS = Object.freeze({ candidates: 8, items: 4, text: 240, topic: 100, entries: 500, sources: 2000, contextEntries: 5, contextChars: 2400 });

function fail(message: string): never { throw new Error(message); }
function bounded(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail("Invalid learner memory text");
  return value.trim();
}
function position(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail("Invalid learner memory revision/position");
}
function domain(value: unknown): MemoryDomain {
  if (!["algorithm", "cs", "opic", "report"].includes(value as string)) fail("Invalid learner memory domain");
  return value as MemoryDomain;
}
function lines(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MEMORY_LIMITS.items) fail("Invalid learner memory items");
  return [...new Set(value.map((item) => bounded(item, MEMORY_LIMITS.text)))];
}
export function memoryEntryKey(value: { domain: MemoryDomain; topic: string }): string {
  return JSON.stringify([value.domain, value.topic.normalize("NFKC").trim().toLocaleLowerCase("en-US")]);
}
const key = memoryEntryKey;
export function validateMemoryCandidates(value: unknown): MemoryCandidate[] {
  if (!Array.isArray(value) || value.length > MEMORY_LIMITS.candidates) fail("Invalid learner memory candidates");
  const seen = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") fail("Invalid learner memory candidate");
    const item = raw as Record<string, unknown>;
    if (!Array.isArray(item.evidenceIds) || !item.evidenceIds.length || item.evidenceIds.length > 12) fail("Missing learner memory evidence");
    if (!["observation", "self-report", "inference"].includes(item.basis as string)) fail("Invalid learner memory basis");
    const candidate = { domain: domain(item.domain), topic: bounded(item.topic, MEMORY_LIMITS.topic), confirmed: lines(item.confirmed), uncertain: lines(item.uncertain), evidenceIds: [...new Set(item.evidenceIds.map((id) => bounded(id, 200)))], basis: item.basis as MemoryBasis };
    if (candidate.basis === "inference" && candidate.confirmed.length) fail("Inferred understanding must remain uncertain");
    if (!candidate.confirmed.length && !candidate.uncertain.length) fail("Empty learner memory candidate");
    if (seen.has(key(candidate))) fail("Duplicate learner memory topic");
    seen.add(key(candidate));
    return candidate;
  });
}
export function createMemoryState(ownerUid: string): MemoryState {
  return { ownerUid: bounded(ownerUid, 128), revision: 0, entries: [], appliedSources: [] };
}
function owned(state: MemoryState, uid: string, expectedRevision?: number) {
  bounded(uid, 128);
  if (state.ownerUid !== uid) fail("Learner memory owner mismatch");
  position(state.revision);
  if (expectedRevision !== undefined) {
    position(expectedRevision);
    if (expectedRevision !== state.revision) fail("Learner memory revision conflict");
  }
}
function date(now: string): string {
  if (!Number.isFinite(Date.parse(now))) fail("Invalid learner memory date");
  return new Date(now).toISOString();
}

/** Pure transition: persist the returned value atomically; publish only after success. */
export function applyMemorySummary(state: MemoryState, uid: string, expectedRevision: number, source: MemorySource, rawCandidates: unknown, now: string): MemoryState {
  owned(state, uid, expectedRevision);
  if (source.ownerUid !== uid) fail("Learner memory source owner mismatch");
  bounded(source.recordId, 200);
  position(source.throughSequence);
  const candidates = validateMemoryCandidates(rawCandidates);
  const updatedAt = date(now);
  const previous = state.appliedSources.find((item) => item.recordId === source.recordId)?.throughSequence ?? -1;
  const eventPositions = new Map<string, number>();
  for (const event of source.events) {
    bounded(event.id, 200); position(event.sequence);
    if (event.sequence > source.throughSequence || eventPositions.has(event.id)) fail("Invalid learner memory evidence position");
    eventPositions.set(event.id, event.sequence);
  }
  for (const candidate of candidates) {
    if (candidate.evidenceIds.some((id) => !eventPositions.has(id))) fail("Unknown learner memory evidence");
  }
  if (source.throughSequence <= previous) return state;
  const entries = structuredClone(state.entries);
  for (const candidate of candidates) {
    // Re-reading an old message in a newer summary is not fresh evidence.
    if (!candidate.evidenceIds.some((id) => eventPositions.get(id)! > previous)) continue;
    const index = entries.findIndex((entry) => key(entry) === key(candidate));
    if (index >= 0 && (entries[index].userEdited || entries[index].deleted)) continue;
    const { evidenceIds, ...content } = candidate;
    const entry: MemoryEntry = { ...content, updatedAt, evidence: { recordId: source.recordId, throughSequence: source.throughSequence, evidenceIds }, userEdited: false, deleted: false };
    if (index < 0) entries.push(entry); else entries[index] = entry;
  }
  const appliedSources = state.appliedSources.filter((item) => item.recordId !== source.recordId).concat({ recordId: source.recordId, throughSequence: source.throughSequence });
  // Never evict replay protection to make room: fail without modifying old state.
  if (entries.length > MEMORY_LIMITS.entries || appliedSources.length > MEMORY_LIMITS.sources) fail("Learner memory capacity reached");
  return { ...state, revision: state.revision + 1, entries, appliedSources };
}

export function editMemoryEntry(state: MemoryState, uid: string, expectedRevision: number, target: { domain: MemoryDomain; topic: string }, change: { confirmed: string[]; uncertain: string[] } | "delete" | "confirm", now: string): MemoryState {
  owned(state, uid, expectedRevision);
  domain(target.domain); bounded(target.topic, MEMORY_LIMITS.topic);
  const index = state.entries.findIndex((entry) => key(entry) === key(target) && !entry.deleted);
  if (index < 0) fail("Learner memory entry not found");
  const entries = structuredClone(state.entries);
  const entry = entries[index];
  if (change === "delete") {
    entry.confirmed = []; entry.uncertain = []; entry.deleted = true;
    entry.evidence.evidenceIds = [];
  } else if (change !== "confirm") {
    entry.confirmed = lines(change.confirmed); entry.uncertain = lines(change.uncertain);
    if (!entry.confirmed.length && !entry.uncertain.length) fail("Empty learner memory edit; use delete");
  }
  entry.userEdited = true;
  entry.basis = "self-report";
  entry.updatedAt = date(now);
  return { ...state, revision: state.revision + 1, entries };
}

/** Exact normalized topics only; consumers supply current question topics. No broad history fallback. */
export function selectMemoryContext(state: MemoryState, uid: string, requestedDomain: MemoryDomain, topics: string[]): { kind: "learner-memory-user-data"; entries: MemoryEntry[] } {
  owned(state, uid); domain(requestedDomain);
  if (!Array.isArray(topics) || topics.length > 20) fail("Invalid learner memory topics");
  const keys = new Set(topics.map((topic) => key({ domain: requestedDomain, topic: bounded(topic, MEMORY_LIMITS.topic) })));
  const result: { kind: "learner-memory-user-data"; entries: MemoryEntry[] } = { kind: "learner-memory-user-data", entries: [] };
  const related = state.entries.filter((entry) => !entry.deleted && keys.has(key(entry)))
    .sort((a, b) => Number(b.userEdited) - Number(a.userEdited) || b.updatedAt.localeCompare(a.updatedAt));
  for (const entry of related) {
    if (result.entries.length >= MEMORY_LIMITS.contextEntries) break;
    const proposed = { ...result, entries: [...result.entries, entry] };
    if (JSON.stringify(proposed).length <= MEMORY_LIMITS.contextChars) result.entries.push(structuredClone(entry));
  }
  return result;
}
