// What runs after saves that made new items (the store tells the listener the knowledge API registers): first 주제 정리
// (classify.ts: 주제·종류, and a 목표 suggestion for new 자료), then 같은 지식 찾기 (dedupe.ts), which takes its candidates
// from the same 주제, then 층 나누기 (layer.ts: 뜻에서 만난 곳의 사연을 예로 옮김). A few seconds after the last save, off the
// request; a run that leaves work schedules another. RECALLER_LAYER=off skips 층 나누기.
import { runClassify } from "./classify.ts";
import { runLayer } from "./layer.ts";
import { runDuplicateCheck } from "./dedupe.ts";

const WAIT_MS = 4000;
// A failed run (the model busy while a PDF is being made, 10/30 실측: 주제 정리가 0.6초 만에 두 번 실패하고 그대로 멈춤) is tried
// again later instead of waiting for the next save: 15초, 30초, 60초, 120초.
const RETRY_MS = [15_000, 30_000, 60_000, 120_000];
const state = globalThis as unknown as { __afterSaveTimer?: ReturnType<typeof setTimeout>; __afterSaveTries?: number };
export function scheduleAfterSave(wait = WAIT_MS, retry = false) {
  if (process.env.RECALLER_AFTER_SAVE === "off") return;
  if (!retry) state.__afterSaveTries = 0;
  if (state.__afterSaveTimer) clearTimeout(state.__afterSaveTimer);
  state.__afterSaveTimer = setTimeout(() => {
    state.__afterSaveTimer = undefined;
    void runAfterSave().then(() => { state.__afterSaveTries = 0; }).catch((e) => {
      const tries = state.__afterSaveTries ?? 0;
      console.warn("[knowledge:after-save]", e instanceof Error ? e.message : e, tries < RETRY_MS.length ? `(${RETRY_MS[tries] / 1000}초 뒤 다시)` : "(그만)");
      if (tries < RETRY_MS.length) { state.__afterSaveTries = tries + 1; scheduleAfterSave(RETRY_MS[tries], true); }
    });
  }, wait);
}
export async function runAfterSave() {
  const sorted = await runClassify();
  const dupes = process.env.RECALLER_DEDUPE === "off" ? null : await runDuplicateCheck();
  const layered = process.env.RECALLER_LAYER === "off" ? null : await runLayer();
  if (sorted.left > 0 || (dupes?.left ?? 0) > 0 || (layered?.left ?? 0) > 0) scheduleAfterSave(1000, true);
  return { sorted, dupes, layered };
}
