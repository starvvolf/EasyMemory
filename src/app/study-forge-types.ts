import type { Deck } from "@/lib/types";

export type View =
  | "create"
  | "review"
  | "manager"
  | "records"
  | "decks"
  | "study";

export type StudyCompletionSummary = {
  completedItemCount: number;
  knownCount: number;
  reviewCount: number;
  reviewActivityIds: string[];
};

export type DeckStateUpdater = React.Dispatch<React.SetStateAction<Deck[]>>;
