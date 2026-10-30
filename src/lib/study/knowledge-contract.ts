// 엔진 → 지식 저장소 약속 (2026-10-28, 협업/스레드분담_20261028.md): the one place where what the PDF engine makes
// meets what the knowledge store keeps. The engine (src/lib/study/gen, thread C) may change anything inside as long as
// `knowledgeLayer(state)` (src/lib/study/knowledge.ts) still gives a KnowledgeLayer these functions accept; the knowledge
// store (thread B) keeps accepting what they produce. knowledge-contract.test.ts runs a real (fake-model) engine run
// through both sides — run it before pushing a change on either side. Type imports only: the study screen uses this.
import type { KnowledgeLayer } from "./knowledge.ts";

/** What `/api/knowledge/import` accepts for one point (its zod schema in src/app/api/knowledge/[[...path]]/route.ts). */
export const IMPORT_LIMITS = { ref: 200, title: 120, essentials: 8, essential: 600, folder: 200, material: 200, points: 2000 } as const;
/** importance (B, 2026-10-30): core만 바로 지식이 되고, minor·pending은 기다렸다가 풀거나 "모름"을 누를 때 지식이 된다. 없으면 전부 지식. */
export type ImportPoint = { ref: string; title: string; essentials: string[]; folder: string; material: string; page?: number; importance?: "core" | "minor" | "pending" };

const materialOf = (deck: { sourceName?: string; title?: string }) => String(deck.sourceName || deck.title || "").replace(/\.pdf$/i, "");

/** A material's knowledge points as the knowledge store takes them: ref "자료id:포인트id", folder "자료 이름/구역". */
export function importPayload(deck: { id: string; sourceName?: string; title?: string }, layer: KnowledgeLayer | undefined): ImportPoint[] {
  const material = materialOf(deck);
  return (layer?.points ?? []).map((point) => ({
    ref: `${deck.id}:${point.id}`.slice(0, IMPORT_LIMITS.ref),
    title: point.title.slice(0, IMPORT_LIMITS.title),
    essentials: point.essentials.slice(0, 6).map((e) => e.slice(0, IMPORT_LIMITS.essential)),
    folder: `${material.slice(0, 60)}${point.section ? `/${point.section.slice(0, 60)}` : ""}`,
    material: material.slice(0, IMPORT_LIMITS.material),
    ...(point.pages[0] ? { page: point.pages[0] } : {}),
    ...(point.importance ? { importance: point.importance } : {}),
  }));
}

/** The refs a practice result on one question goes to: the points its objective covers. */
export function practiceRefs(deckId: string, layer: KnowledgeLayer | undefined, objectiveId: string | undefined) {
  if (!layer || !objectiveId) return [];
  return (layer.byObjective[objectiveId] ?? []).slice(0, 20).map((pid) => `${deckId}:${pid}`);
}

/** What is wrong with a layer for the knowledge store, or [] (the contract test asserts []). */
export function layerProblems(layer: KnowledgeLayer) {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const p of layer.points) {
    if (!p.id || ids.has(p.id)) problems.push(`포인트 id가 비었거나 겹침: "${p.id}"`);
    ids.add(p.id);
    if (!p.title.trim()) problems.push(`포인트 ${p.id}: 이름이 비었음`);
    if (!Array.isArray(p.essentials) || p.essentials.some((e) => typeof e !== "string")) problems.push(`포인트 ${p.id}: essentials는 문자열 배열이어야 함`);
    if (!Array.isArray(p.pages) || p.pages.some((n) => !Number.isInteger(n))) problems.push(`포인트 ${p.id}: pages는 정수 배열이어야 함`);
  }
  for (const [objective, pids] of Object.entries(layer.byObjective)) for (const pid of pids) if (!ids.has(pid)) problems.push(`목표 ${objective}가 없는 포인트 ${pid}를 가리킴`);
  return problems;
}
