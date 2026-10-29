// 자료 지도 (2026-10-29, 사용자 "문서 구조 목차와 지식을 잘 뽑으면 다른 방식으로 보여 줄 수 있지 않나"):
// one material on one screen — its outline, under each section the knowledge cards in their own shape, the learner's state
// on each (지식 저장소), and where a card's result feeds another card. Read-only: it shows what the engine (recaller) made
// and what the knowledge store holds; it changes neither. Page reading stays the way in for the first pass; this is for
// the second pass and the night before the exam.
import type { GenState } from "./gen/types.ts";
import type { Card } from "./gen/cards.ts";

export type MapState = "new" | "met" | "unknown" | "known" | "graduated";
export type MapKnowledge = { id: string; state: string; graduated?: boolean; dueAt?: string };
export type MapCard = {
  id: string; ref: string; kind: Card["kind"]; title: string; core: boolean; shape: Card["shape"];
  pages: number[]; quotes: string[]; mistakes: string[]; takes: string[]; gives: string[];
  /** Questions made from this card (basic + deep parts). */
  questions: number;
  /** Cards elsewhere that hold the same knowledge (the engine's dups / consolidation): shown once, here. */
  same: Array<{ id: string; pages: number[] }>;
  state: MapState; knowledgeId?: string; dueAt?: string;
  /** The whole-material pass (consolidated): its larger idea, and whether the weight came from it rather than the page. */
  topic?: string;
};
export type MapSection = { id: string; title: string; pages: number[]; cards: MapCard[] };
/** wording: one card's result is another's input (takes/gives); group: a deep question joins them; meaning: the whole-material pass. */
export type MapChain = { from: string; to: string; what: string; by: "wording" | "group" | "meaning" };
export type MaterialMap = {
  id: string; title: string; status: GenState["status"]; pages: number;
  sections: MapSection[]; chains: MapChain[];
  /** Larger ideas across the sections, in first-seen order (empty until the whole-material pass has run). */
  topics: string[];
  /** 자료 전체 정리: what each topic is there to say, and ideas used across topics (with the cards that use them). */
  topicNotes?: Record<string, string>;
  principles?: Array<{ title: string; line: string; cardIds: string[] }>;
  counts: Record<MapState, number> & { cards: number; questions: number; core: number };
};

const norm = (s: string) => s.toLowerCase().replace(/[\s·()[\]{}'"`.,:;!?-]+/g, "");
const stateOf = (k: MapKnowledge | undefined): MapState => !k ? "new" : k.graduated ? "graduated" : k.state === "known" ? "known" : k.state === "unknown" ? "unknown" : "met";

/** `knowledge`: the knowledge item saved for each card, by its ref (`<material id>:<card id>`, knowledge-contract.ts). */
export function materialMap(state: GenState, knowledge: Record<string, MapKnowledge>, title = state.input.fileName ?? state.id): MaterialMap | null {
  const rc = state.recaller;
  if (!rc) return null;
  // Questions per card, basic and deep.
  const asked = new Map<string, number>();
  const count = (ids: string[]) => { for (const id of ids) asked.set(id, (asked.get(id) ?? 0) + 1); };
  for (const unit of Object.values(rc.units)) for (const q of unit.questions ?? []) count(q.cardIds);
  for (const slot of Object.values(rc.deep ?? {})) for (const q of slot.parts ?? (slot.question ? [slot.question] : [])) count(q.cardIds);
  // The same knowledge on two pages: the engine marks it (dups: left without a question; consolidated: sameAs, 실험).
  const sameAs = new Map<string, string>(Object.entries(rc.dups ?? {}));
  for (const c of rc.consolidated?.cards ?? []) if (c.sameAs && c.sameAs !== c.id) sameAs.set(c.id, c.sameAs);
  const root = (id: string) => { let at = id; for (let i = 0; i < 5 && sameAs.has(at); i++) at = sameAs.get(at)!; return at; };
  const merged = new Map((rc.consolidated?.cards ?? []).map((c) => [c.id, c]));

  const all = state.sections.flatMap((section) => (rc.units[section.id]?.cards ?? []).map((card) => ({ section, card })));
  const byId = new Map(all.map(({ card }) => [card.id, card]));
  const extra = new Map<string, Array<{ id: string; pages: number[] }>>();
  for (const { card } of all) {
    const r = root(card.id);
    if (r !== card.id && byId.has(r)) extra.set(r, [...(extra.get(r) ?? []), { id: card.id, pages: [...new Set(card.evidence.map((e) => e.page))] }]);
  }
  const sections: MapSection[] = state.sections.map((section) => ({
    id: section.id, title: section.title, pages: section.pages,
    cards: (rc.units[section.id]?.cards ?? []).filter((card) => root(card.id) === card.id || !byId.has(root(card.id))).map((card): MapCard => {
      const ref = `${state.id}:${card.id}`, k = knowledge[ref];
      const same = extra.get(card.id) ?? [];
      const m = merged.get(card.id);
      return { id: card.id, ref, kind: card.kind, title: m?.title || card.title, core: (m?.weight ?? card.weight) === "핵심", shape: card.shape, ...(m?.topic ? { topic: m.topic } : {}),
        pages: [...new Set([...card.evidence.map((e) => e.page), ...same.flatMap((s) => s.pages)])].sort((a, b) => a - b),
        quotes: card.evidence.map((e) => e.quote).filter(Boolean), mistakes: card.mistakes, takes: card.takes ?? [], gives: card.gives ?? [],
        questions: (asked.get(card.id) ?? 0) + same.reduce((n, s) => n + (asked.get(s.id) ?? 0), 0), same,
        state: stateOf(k), ...(k ? { knowledgeId: k.id } : {}), ...(k?.dueAt ? { dueAt: k.dueAt } : {}) };
    }),
  })).filter((section) => section.cards.length);

  // Where one card's result is another card's input, in the material's own words (takes/gives, cards.ts).
  const shown = sections.flatMap((s) => s.cards);
  const givers = new Map<string, string[]>();
  for (const c of shown) for (const g of c.gives) givers.set(norm(g), [...(givers.get(norm(g)) ?? []), c.id]);
  const chains: MapChain[] = [];
  const seen = new Set<string>();
  for (const c of shown) for (const t of c.takes) for (const from of givers.get(norm(t)) ?? []) {
    const key = `${from}>${c.id}`;
    if (from === c.id || seen.has(key)) continue;
    seen.add(key); chains.push({ from, to: c.id, what: t, by: "wording" });
  }
  for (const group of rc.groups ?? []) for (let i = 1; i < group.cardIds.length; i++) {
    const from = root(group.cardIds[i - 1]), to = root(group.cardIds[i]), key = `${from}>${to}`;
    if (from !== to && !seen.has(key) && shown.some((c) => c.id === from) && shown.some((c) => c.id === to)) { seen.add(key); chains.push({ from, to, what: group.idea, by: "group" }); }
  }
  const ids = new Set(shown.map((c) => c.id));
  for (const c of rc.consolidated?.cards ?? []) for (const link of c.links ?? []) {
    const from = root(c.id), to = root(link.to), key = `${from}>${to}`;
    if (from !== to && ids.has(from) && ids.has(to) && !seen.has(key) && !seen.has(`${to}>${from}`)) { seen.add(key); chains.push({ from, to, what: link.why, by: "meaning" }); }
  }
  const topics = [...new Set(shown.map((c) => c.topic).filter((t): t is string => Boolean(t)))];

  const counts = { new: 0, met: 0, unknown: 0, known: 0, graduated: 0, cards: shown.length, questions: 0, core: 0 };
  for (const c of shown) { counts[c.state]++; counts.questions += c.questions; if (c.core) counts.core++; }
  const pages = state.input.pageNumbers?.length ? Math.max(...state.input.pageNumbers) : Math.max(0, ...state.sections.flatMap((s) => s.pages));
  const principles = (rc.consolidated?.principles ?? []).map((p) => ({ ...p, cardIds: [...new Set(p.cardIds.map(root))].filter((id) => ids.has(id)) })).filter((p) => p.cardIds.length >= 2);
  return { id: state.id, title, status: state.status, pages, sections, chains, topics, counts,
    ...(rc.consolidated?.topicNotes ? { topicNotes: rc.consolidated.topicNotes } : {}), ...(principles.length ? { principles } : {}) };
}
