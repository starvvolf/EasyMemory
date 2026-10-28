// What runs after saves that made new items (the store tells the listener the knowledge API registers): first 주제 정리
// (classify.ts: 주제·종류, and a 목표 suggestion for new 자료), then 같은 지식 찾기 (dedupe.ts), which takes its candidates
// from the same 주제. A few seconds after the last save, off the request; a run that leaves work schedules another.
import { runClassify } from "./classify.ts";
import { runDuplicateCheck } from "./dedupe.ts";

const WAIT_MS = 4000;
const state = globalThis as unknown as { __afterSaveTimer?: ReturnType<typeof setTimeout> };
export function scheduleAfterSave(wait = WAIT_MS) {
  if (process.env.RECALLER_AFTER_SAVE === "off") return;
  if (state.__afterSaveTimer) clearTimeout(state.__afterSaveTimer);
  state.__afterSaveTimer = setTimeout(() => { state.__afterSaveTimer = undefined; void runAfterSave().catch((e) => console.warn("[knowledge:after-save]", e instanceof Error ? e.message : e)); }, wait);
}
export async function runAfterSave() {
  const sorted = await runClassify();
  const dupes = process.env.RECALLER_DEDUPE === "off" ? null : await runDuplicateCheck();
  if (sorted.left > 0 || (dupes?.left ?? 0) > 0) scheduleAfterSave(1000);
  return { sorted, dupes };
}
