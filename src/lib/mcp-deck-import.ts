import type { Deck } from "./types";

export function selectNewPublishedMcpDecks(
  payload: unknown,
  existingDecks: Deck[],
): Deck[] {
  if (!payload || typeof payload !== "object") return [];
  const decks = (payload as { decks?: unknown }).decks;
  if (!Array.isArray(decks)) return [];
  const existingIds = new Set(existingDecks.map((deck) => deck.id));
  const selected: Deck[] = [];
  for (const candidate of decks) {
    if (!isPublishedMcpDeck(candidate) || existingIds.has(candidate.id)) continue;
    selected.push(candidate);
    existingIds.add(candidate.id);
  }
  return selected;
}

function isPublishedMcpDeck(value: unknown): value is Deck {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Deck>;
  return (
    typeof candidate.id === "string" &&
    (candidate.id.startsWith("mcp-run-") || candidate.id.startsWith("mcp-chatgpt-")) &&
    typeof candidate.title === "string" &&
    Array.isArray(candidate.cards) &&
    candidate.cards.length > 0 &&
    candidate.cards.every((card) =>
      Boolean(card) &&
      typeof card.id === "string" &&
      Array.isArray(card.tags) &&
      typeof card.status === "string"
    ) &&
    Boolean(candidate.analysis) &&
    Boolean(candidate.organizedMaterial)
  );
}
