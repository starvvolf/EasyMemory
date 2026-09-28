import type { ExperimentEvent } from "./rule";

const PREFIX = "recaller:mcp-personalization:v1:";
const PROGRESS_PREFIX = "recaller:mcp-personalization:progress:v1:";

export type ExperimentProgress = {
  artifactId: string;
  artifactSha256: string;
  sessionId: string;
  lastQuestionId: string | null;
};
type ProgressStore = { version: 2; selectedKey: string; documents: Record<string, ExperimentProgress> };

function progressKey(progress: Pick<ExperimentProgress, "artifactId" | "artifactSha256">) {
  return JSON.stringify([progress.artifactId, progress.artifactSha256]);
}

function validProgress(value: unknown): value is ExperimentProgress {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.artifactId === "string" && typeof item.artifactSha256 === "string" && typeof item.sessionId === "string" && item.sessionId.length >= 8 && (item.lastQuestionId === null || typeof item.lastQuestionId === "string");
}

function readProgressStore(subjectId: string): ProgressStore {
  const empty: ProgressStore = { version: 2, selectedKey: "", documents: {} };
  if (!subjectId) return empty;
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(`${PROGRESS_PREFIX}${subjectId}`) ?? "null");
    if (validProgress(saved)) {
      const itemKey = progressKey(saved);
      return { version: 2, selectedKey: itemKey, documents: { [itemKey]: saved } };
    }
    if (!saved || typeof saved !== "object") return empty;
    const value = saved as Partial<ProgressStore>;
    if (value.version !== 2 || typeof value.selectedKey !== "string" || !value.documents || typeof value.documents !== "object") return empty;
    const documents = Object.fromEntries(Object.entries(value.documents).filter(([itemKey, item]) => validProgress(item) && progressKey(item) === itemKey));
    return { version: 2, selectedKey: value.selectedKey, documents };
  } catch { return empty; }
}

function key(subjectId: string) {
  if (!subjectId) throw new Error("실험 주체가 없습니다.");
  return `${PREFIX}${subjectId}`;
}

export function loadExperimentEvents(subjectId: string): ExperimentEvent[] {
  try {
    const raw = localStorage.getItem(key(subjectId));
    if (!raw) return [];
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || !("version" in saved) || saved.version !== 1 || !("events" in saved) || !Array.isArray(saved.events)) return [];
    return saved.events.filter((item): item is ExperimentEvent => Boolean(item && typeof item === "object" && typeof item.id === "string" && typeof item.kind === "string" && typeof item.occurredAt === "string" && item.scope && typeof item.scope.artifactSha256 === "string"));
  } catch {
    return [];
  }
}

export function saveExperimentEvents(subjectId: string, events: ExperimentEvent[]) {
  localStorage.setItem(key(subjectId), JSON.stringify({ version: 1, events }));
}

export function clearExperimentEvents(subjectId: string) {
  localStorage.removeItem(key(subjectId));
  localStorage.removeItem(`${PROGRESS_PREFIX}${subjectId}`);
}

export function loadExperimentProgress(subjectId: string): ExperimentProgress | null {
  const saved = readProgressStore(subjectId);
  return saved.documents[saved.selectedKey] ?? null;
}

export function loadExperimentProgressFor(subjectId: string, artifactId: string, artifactSha256: string): ExperimentProgress | null {
  const saved = readProgressStore(subjectId);
  return saved.documents[progressKey({ artifactId, artifactSha256 })] ?? null;
}

export function saveExperimentProgress(subjectId: string, progress: ExperimentProgress) {
  if (!subjectId) throw new Error("실험 주체가 없습니다.");
  const store = readProgressStore(subjectId);
  const itemKey = progressKey(progress);
  store.documents[itemKey] = progress;
  store.selectedKey = itemKey;
  localStorage.setItem(`${PROGRESS_PREFIX}${subjectId}`, JSON.stringify(store));
}
