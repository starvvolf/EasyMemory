"use client";

import {
  deleteDeck,
  listDecks,
  listStudyAttempts,
  listStudySessions,
  saveDeck,
} from "@/lib/storage";
import type {
  Deck,
  DeckBoardColumn,
  StudyAttempt,
  StudySession,
} from "@/lib/types";
import { useState } from "react";

type Props = {
  setError: (message: string) => void;
  setNotice: (message: string) => void;
};

export function useDeckLibraryController({ setError, setNotice }: Props) {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [studySessions, setStudySessions] = useState<StudySession[]>([]);
  const [studyAttempts, setStudyAttempts] = useState<StudyAttempt[]>([]);
  const [isLoadingManager, setIsLoadingManager] = useState(false);
  const [detailDeck, setDetailDeck] = useState<Deck | null>(null);
  const [renamingDeckId, setRenamingDeckId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  async function refreshDecks() {
    const savedDecks = await listDecks();
    setDecks(savedDecks);
    return savedDecks;
  }

  async function refreshLearningRecords() {
    setIsLoadingManager(true);
    try {
      const [sessions, attempts] = await Promise.all([
        listStudySessions(),
        listStudyAttempts(),
      ]);
      setStudySessions(sessions);
      setStudyAttempts(attempts);
      return { sessions, attempts };
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? `학습 기록을 불러오지 못했습니다: ${loadError.message}`
          : "학습 기록을 불러오지 못했습니다.",
      );
      return null;
    } finally {
      setIsLoadingManager(false);
    }
  }

  function startRename(deck: Deck) {
    setRenamingDeckId(deck.id);
    setRenameValue(deck.title);
  }

  function cancelRename() {
    setRenamingDeckId(null);
    setRenameValue("");
  }

  async function saveDeckTitle(deck: Deck) {
    const title = renameValue.trim();
    if (!title) {
      setError("덱 이름은 비워둘 수 없습니다.");
      return null;
    }
    const updatedDeck: Deck = {
      ...deck,
      title,
      updatedAt: new Date().toISOString(),
    };
    await saveDeck(updatedDeck);
    replaceDeck(updatedDeck);
    setRenamingDeckId(null);
    setRenameValue("");
    setNotice("덱 이름을 수정했습니다.");
    return updatedDeck;
  }

  async function moveDeckToColumn(id: string, boardColumn: DeckBoardColumn) {
    const deck = decks.find((item) => item.id === id);
    if (!deck || deck.boardColumn === boardColumn) return null;
    const updatedDeck: Deck = {
      ...deck,
      boardColumn,
      updatedAt: new Date().toISOString(),
    };
    await saveDeck(updatedDeck);
    replaceDeck(updatedDeck);
    return updatedDeck;
  }

  async function removeDeck(id: string) {
    const deck = decks.find((item) => item.id === id);
    const confirmed = window.confirm(
      `"${deck?.title ?? "이 덱"}"을 정말 삭제하시겠습니까?`,
    );
    if (!confirmed) return false;
    await deleteDeck(id);
    setDecks((items) => items.filter((item) => item.id !== id));
    setDetailDeck((current) => (current?.id === id ? null : current));
    return true;
  }

  function replaceDeck(updatedDeck: Deck) {
    setDecks((items) =>
      items.map((item) => (item.id === updatedDeck.id ? updatedDeck : item)),
    );
    setDetailDeck((current) =>
      current?.id === updatedDeck.id ? updatedDeck : current,
    );
  }

  return {
    decks,
    setDecks,
    studySessions,
    setStudySessions,
    studyAttempts,
    setStudyAttempts,
    isLoadingManager,
    setIsLoadingManager,
    detailDeck,
    setDetailDeck,
    renamingDeckId,
    renameValue,
    setRenameValue,
    refreshDecks,
    refreshLearningRecords,
    startRename,
    cancelRename,
    saveDeckTitle,
    moveDeckToColumn,
    removeDeck,
    replaceDeck,
  };
}
