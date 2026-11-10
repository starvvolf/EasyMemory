"use client";
import { useSyncExternalStore } from "react";

/* React로 옮기는 동안 (11/11): 바닐라 앱(dejipgi-app.js)이 상태를 들고 있고, render()가 끝날 때마다 ui.bump()로 알린다.
   React 화면은 그 알림에 맞춰 다시 그리고, 그릴 때 api.snapshot()으로 지금 값을 읽는다. */
export type Bridge = { subscribe(fn: () => void): () => void; version(): number };
export function useBridge(ui: Bridge) {
  return useSyncExternalStore(ui.subscribe, ui.version, ui.version);
}
