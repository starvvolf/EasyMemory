"use client";

import type { Deck } from "@/lib/types";

const DB_NAME = "memory-transformer";
const DB_VERSION = 1;
const DECK_STORE = "decks";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DECK_STORE)) {
        db.createObjectStore(DECK_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDeck(deck: Deck): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DECK_STORE, "readwrite");
    tx.objectStore(DECK_STORE).put(deck);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listDecks(): Promise<Deck[]> {
  const db = await openDb();
  const decks = await new Promise<Deck[]>((resolve, reject) => {
    const tx = db.transaction(DECK_STORE, "readonly");
    const request = tx.objectStore(DECK_STORE).getAll();
    request.onsuccess = () => resolve(request.result as Deck[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return decks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteDeck(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DECK_STORE, "readwrite");
    tx.objectStore(DECK_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
