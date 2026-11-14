// Recaller 2 knowledge layer (협업 설계 "Recaller 2 설계", 2026-10-24): what to know is kept apart from where it is.
// A knowledge point (지식 포인트) is the unit mastery is tracked in; a span is a place in the material that can be
// pointed at (a page, a region, later a paragraph or code lines). Points and spans are linked many-to-many by evidence,
// and every question reaches its points through its objective.
import type { GenState } from "./gen/types";
import { cardLine } from "./gen/cards.ts";

/** A place in a material. `page` for PDFs now; `para` / `lines` arrive with articles and code. */
export type Span = { page: number; kind: string; quote: string };
export type KnowledgePoint = {
  id: string;
  title: string;
  /** What the point says, in a few short lines (the plan's essentials, or the goal's recall). */
  essentials: string[];
  /** 질문·답 카드의 질문 (11/12) */
  ask?: string;
  section: string;
  pages: number[];
  spans: Span[];
  /**
   * [경계] B, 2026-10-30 (사용자 "핵심 카드만 지식으로"): recaller cards only. core = 핵심 카드(자료 전체 정리의 중요도, 없으면 쪽의
   * 중요도), minor = 보조, pending = 자료 전체 정리가 아직이라 중요도가 정해지지 않음. Other engines leave it out (전부 지식으로).
   */
  importance?: "core" | "minor" | "pending";
};
export type KnowledgeLayer = { points: KnowledgePoint[]; byObjective: Record<string, string[]> };


/**
 * Knowledge points of one generated material. Plans that name concepts (astra, v4, v5, alpha) give one point per
 * concept with its evidence as spans; older engines without concepts get one point per goal, so every deck has points.
 */
export function knowledgeLayer(state: GenState): KnowledgeLayer {
  // recaller: the knowledge cards are the points (one card, one thing to know), with what learners confuse.
  if (state.recaller) {
    const units = state.recaller.units;
    // 중요도는 자료 전체 정리가 정한다. 정리가 아직 돌고 있으면 쪽마다의 중요도(거의 다 핵심)로 넘기지 않고 기다린다.
    const merged = new Map((state.recaller.consolidated?.cards ?? []).map((c) => [c.id, c.weight]));
    const settled = Boolean(state.recaller.consolidated) || !["queued", "running", "awaiting-confirm"].includes(state.status);
    const importance = (card: { id: string; weight: "핵심" | "보조" }): KnowledgePoint["importance"] =>
      !settled ? "pending" : (merged.get(card.id) ?? card.weight) === "핵심" ? "core" : "minor";
    const points: KnowledgePoint[] = state.sections.flatMap((section) => (units[section.id]?.cards ?? []).map((card) => ({
      // 줄기 모드(11/10): 카드 한 장이 기억 하나 — 요지, 모양(단계·기준…), 모양에 없는 식·조건 순으로.
      id: card.id, title: card.title, ...(card.memo?.question ? { ask: card.memo.question } : {}),
      // 질문·답 카드(11/12)는 답 그대로가 뜻이다(첫 줄 + 모양 줄을 겹쳐 쓰지 않는다).
      essentials: card.memo?.answer ? [card.memo.answer, ...card.mistakes.slice(0, 2).map((m) => `헷갈림: ${m}`)] : [...(card.memo?.line ? [card.memo.line] : []), cardLine(card).replace(/^\[[^\]]+\] [^:]+: /, ""), ...(card.memo?.facts ?? []), ...card.mistakes.slice(0, 2).map((m) => `헷갈림: ${m}`)], section: section.title,
      pages: [...new Set(card.evidence.map((e) => e.page))].sort((a, b) => a - b), spans: card.evidence.map((e) => ({ page: e.page, kind: e.quote ? "text" : "figure", quote: e.quote })), importance: importance(card) })));
    const byObjective: Record<string, string[]> = {};
    for (const unit of Object.values(units)) for (const q of unit.questions ?? []) byObjective[q.objectiveId] = q.cardIds;
    for (const slot of Object.values(state.recaller.deep)) for (const q of slot.parts ?? (slot.question ? [slot.question] : [])) byObjective[q.objectiveId] = q.cardIds;
    return { points, byObjective };
  }
  // 11/15 리팩토링: 예전 엔진(astra · v2 …)의 계획·목표는 더 읽지 않는다. recaller 카드가 없으면 포인트도 없다.
  return { points: [], byObjective: {} };
}

/**
 * 자료 카드 → 기억 저장소 (11/15 리팩토링 중 찾은 빈틈): 예전에는 공부 화면(DejipgiStudy)이 목록을 읽을 때 카드를 넣었는데
 * (/api/knowledge/import), 문제 없이 카드만 만든 실행(questionsLater)은 그 길을 타지 않아 플래시카드 결과가 남지 않았다
 * ("N장은 기억 저장소에 남기지 못했어요"). 이제 카드 ref로 기록을 남길 때 그 자료의 카드를 먼저 넣는다(핵심은 바로, 보조는 기다림).
 * 같은 서버에서 다 만든 자료는 한 번만.
 */
const imported = new Set<string>();
export function importPayload(state: GenState) {
  const material = String(state.input.fileName ?? "").replace(/\.pdf$/i, "");
  return knowledgeLayer(state).points.map((point) => ({
    ref: `${state.id}:${point.id}`.slice(0, 200),
    title: point.title.slice(0, 120),
    essentials: point.essentials.slice(0, 6).map((e) => e.slice(0, 1500)),
    folder: `${material.slice(0, 60)}${point.section ? `/${point.section.slice(0, 60)}` : ""}`,
    material: material.slice(0, 120),
    ...(point.pages[0] ? { page: point.pages[0] } : {}),
    ...(point.importance ? { importance: point.importance } : {}),
    ...(point.ask ? { ask: point.ask.slice(0, 300) } : {}),
  }));
}
export async function importCardsOf(refs: string[]) {
  const ids = [...new Set(refs.map((r) => /^(gen_[a-z0-9]{8,64}):/.exec(r)?.[1]).filter((id): id is string => Boolean(id) && !imported.has(id!)))];
  if (!ids.length) return;
  const [{ loadGen }, { importPoints }] = await Promise.all([import("./gen/runner.ts"), import("../knowledge/store.ts")]);
  for (const id of ids) {
    const state = await loadGen(id);
    if (!state?.recaller) continue;
    const payload = importPayload(state);
    if (payload.length) await importPoints(payload.slice(0, 2000));
    if (state.status === "done") imported.add(id);
  }
}
