"use client";
import { useSyncExternalStore } from "react";

/* 앱과 화면의 다리 (11/11 화면을 전부 React로): 앱(dejipgi-app.js)이 상태·채점·기록·복습 날짜를 들고, 바뀔 때마다 ui.bump()로 알린다.
   React 화면(StudyApp.tsx 아래)은 그 알림에 맞춰 다시 그리고, 그릴 때 api.snapshot()으로 지금 값을 읽는다. */
export type Bridge = { subscribe(fn: () => void): () => void; version(): number };
export function useBridge(ui: Bridge) {
  return useSyncExternalStore(ui.subscribe, ui.version, ui.version);
}
