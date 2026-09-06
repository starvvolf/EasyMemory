import { MEMORY_LIMITS, selectMemoryContext } from "./index.ts";
import type { LearnerMemoryRecordInput, MemoryDomain, MemoryState } from "./index.ts";

export interface MemoryMutationOptions { expectedRevision: number; operationId: string }
export interface MemoryEdit {
  target: { domain: MemoryDomain; topic: string };
  change: "confirm" | "delete" | { confirmed: string[]; uncertain: string[] };
}
export interface MemoryHttpDependencies {
  authenticate(request: Request): Promise<{ uid: string }>;
  load(uid: string): Promise<MemoryState>;
  apply(uid: string, record: LearnerMemoryRecordInput, options: MemoryMutationOptions): Promise<unknown>;
  edit(uid: string, input: MemoryEdit, options: MemoryMutationOptions): Promise<unknown>;
  mapError(error: unknown): { status: number; message: string; currentRevision?: number };
}
class InputError extends Error {}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("요청 형식이 올바르지 않습니다.");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new InputError("입력 길이 또는 형식이 올바르지 않습니다.");
  return value.trim();
}
function domain(value: unknown): MemoryDomain {
  if (!["algorithm", "cs", "opic", "report"].includes(value as string)) throw new InputError("학습 영역이 올바르지 않습니다.");
  return value as MemoryDomain;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MEMORY_LIMITS.items) throw new InputError("기억 내용은 각각 4개 이하로 입력하세요.");
  return value.map((item) => text(item, MEMORY_LIMITS.text));
}
function options(value: Record<string, unknown>): MemoryMutationOptions {
  if (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) throw new InputError("최신 기억 revision이 필요합니다.");
  const operationId = text(value.operationId, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(operationId)) throw new InputError("저장 작업 ID가 올바르지 않습니다.");
  return { expectedRevision: value.expectedRevision as number, operationId };
}
async function body(request: Request, maxBytes = 16384) {
  // The apply endpoint accepts a bounded summary/evidence index, never raw source bodies.
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new InputError("JSON 요청이 필요합니다.");
  if (Number(request.headers.get("content-length")) > maxBytes) throw new InputError("요청 크기가 너무 큽니다.");
  const reader = request.body?.getReader();
  if (!reader) throw new InputError("요청 내용이 없습니다.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new InputError("요청 크기가 너무 큽니다."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return object(JSON.parse(new TextDecoder().decode(bytes))); }
  catch (error) { if (error instanceof InputError) throw error; throw new InputError("JSON 요청 형식이 올바르지 않습니다."); }
}
function keys(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new InputError("지원하지 않는 요청 필드입니다.");
}
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Authorization, Cookie" } });
}

/** Thin transport shared by route handlers; authentication and atomic storage stay in their existing owners. */
export function createMemoryHttpHandlers(deps: MemoryHttpDependencies) {
  const loadOwned = async (uid: string) => {
    const state = await deps.load(uid);
    if (state.ownerUid !== uid) throw new Error("Learner memory owner mismatch");
    return state;
  };
  const guarded = (handler: (request: Request, uid: string) => Promise<Response>) => async (request: Request) => {
    try {
      const { uid } = await deps.authenticate(request);
      return await handler(request, uid);
    } catch (error) {
      const failure = error instanceof InputError ? { status: 400, message: error.message } : deps.mapError(error);
      return json({ message: failure.status >= 500 ? "학습자 기억 요청을 처리하지 못했습니다. 기존 상태는 보존됩니다." : failure.message, currentRevision: failure.currentRevision }, failure.status);
    }
  };
  return {
    GET: guarded(async (_request, uid) => json({ state: await loadOwned(uid) })),
    POST: guarded(async (request, uid) => {
      const input = await body(request, 900 * 1024);
      keys(input, ["record", "expectedRevision", "operationId"]);
      const record = object(input.record);
      keys(record, ["recordId", "summary", "evidenceIndex"]);
      text(record.recordId, 200); object(record.summary);
      if (!Array.isArray(record.evidenceIndex)) throw new InputError("근거 목록이 필요합니다.");
      // Full record validation belongs to the same adapter transaction that saves it.
      return json(await deps.apply(uid, record as unknown as LearnerMemoryRecordInput, options(input)));
    }),
    PATCH: guarded(async (request, uid) => {
      const input = await body(request);
      keys(input, ["target", "change", "expectedRevision", "operationId"]);
      const target = object(input.target); keys(target, ["domain", "topic"]);
      let change: MemoryEdit["change"];
      if (input.change === "confirm" || input.change === "delete") change = input.change;
      else {
        const value = object(input.change); keys(value, ["confirmed", "uncertain"]);
        change = { confirmed: strings(value.confirmed), uncertain: strings(value.uncertain) };
        if (!change.confirmed.length && !change.uncertain.length) throw new InputError("내용을 비우려면 삭제를 사용하세요.");
      }
      return json(await deps.edit(uid, { target: { domain: domain(target.domain), topic: text(target.topic, MEMORY_LIMITS.topic) }, change }, options(input)));
    }),
    CONTEXT: guarded(async (request, uid) => {
      const params = new URL(request.url).searchParams;
      const requestedDomain = domain(params.get("domain"));
      const topics = params.getAll("topic");
      if (topics.length > 20) throw new InputError("관련 주제는 20개 이하로 요청하세요.");
      topics.forEach((topic) => text(topic, MEMORY_LIMITS.topic));
      const state = await loadOwned(uid);
      return json(selectMemoryContext(state, uid, requestedDomain, topics));
    }),
  };
}
