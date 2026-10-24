// Recaller 2 knowledge layer (협업 설계 "Recaller 2 설계", 2026-10-24): what to know is kept apart from where it is.
// A knowledge point (지식 포인트) is the unit mastery is tracked in; a span is a place in the material that can be
// pointed at (a page, a region, later a paragraph or code lines). Points and spans are linked many-to-many by evidence,
// and every question reaches its points through its objective.
import type { GenState } from "./gen/types";

/** A place in a material. `page` for PDFs now; `para` / `lines` arrive with articles and code. */
export type Span = { page: number; kind: string; quote: string };
export type KnowledgePoint = {
  id: string;
  title: string;
  /** What the point says, in a few short lines (the plan's essentials, or the goal's recall). */
  essentials: string[];
  section: string;
  pages: number[];
  spans: Span[];
};
export type KnowledgeLayer = { points: KnowledgePoint[]; byObjective: Record<string, string[]> };

type ObjectiveLike = { id: string; statement: string; recall?: string; pages?: number[]; quotes?: string[]; astra?: { conceptIds?: string[] } };

/**
 * Knowledge points of one generated material. Plans that name concepts (astra, v4, v5, alpha) give one point per
 * concept with its evidence as spans; older engines without concepts get one point per goal, so every deck has points.
 */
export function knowledgeLayer(state: GenState): KnowledgeLayer {
  // recaller: the knowledge cards are the points (one card, one thing to know), with what learners confuse.
  if (state.recaller) {
    const units = state.recaller.units;
    const points: KnowledgePoint[] = state.sections.flatMap((section) => (units[section.id]?.cards ?? []).map((card) => ({
      id: card.id, title: card.title, essentials: [card.summary, ...card.mistakes.slice(0, 2).map((m) => `헷갈림: ${m.wrong}`)], section: section.title,
      pages: [...new Set(card.evidence.map((e) => e.page))].sort((a, b) => a - b), spans: card.evidence.map((e) => ({ page: e.page, kind: e.quote ? "text" : "figure", quote: e.quote })) })));
    const byObjective: Record<string, string[]> = {};
    for (const unit of Object.values(units)) for (const q of unit.questions ?? []) byObjective[q.objectiveId] = q.cardIds;
    for (const slot of Object.values(state.recaller.deep)) if (slot.question) byObjective[slot.question.objectiveId] = slot.question.cardIds;
    return { points, byObjective };
  }
  const plan = state.astra?.plan;
  const sectionTitle = (outlineIds: string[]) => state.sections.find((section) => outlineIds.includes(section.id))?.title ?? "";
  const objectives = state.sections.flatMap((section) => ((section.design?.objectives ?? []) as ObjectiveLike[]).map((objective) => ({ objective, section: section.title })));
  if (plan?.concepts?.length) {
    const points: KnowledgePoint[] = plan.concepts.map((concept) => ({
      id: concept.id,
      title: concept.title,
      essentials: [...concept.essentials, ...concept.conditions].filter((line) => line.trim()).slice(0, 6),
      section: sectionTitle(concept.outlineIds),
      pages: [...new Set(concept.evidence.map((evidence) => evidence.page))].sort((a, b) => a - b),
      spans: concept.evidence.map((evidence) => ({ page: evidence.page, kind: evidence.kind, quote: evidence.quote || evidence.supports })),
    }));
    const known = new Set(points.map((point) => point.id));
    const byObjective: Record<string, string[]> = {};
    for (const { objective } of objectives) {
      const ids = (objective.astra?.conceptIds ?? []).filter((id) => known.has(id));
      if (ids.length) byObjective[objective.id] = ids;
    }
    return { points, byObjective };
  }
  const points: KnowledgePoint[] = objectives.map(({ objective, section }) => ({
    id: `o:${objective.id}`,
    title: (objective.recall || objective.statement).slice(0, 80),
    essentials: [objective.statement],
    section,
    pages: [...new Set(objective.pages ?? [])],
    spans: (objective.pages ?? []).map((page, index) => ({ page, kind: "text", quote: objective.quotes?.[index] ?? "" })),
  }));
  return { points, byObjective: Object.fromEntries(objectives.map(({ objective }) => [objective.id, [`o:${objective.id}`]])) };
}
