// 하다가 나간 목표 정리(11/12 사용자 "하다가 나간 목표는 진행 중으로 정리를 해서 관리"): 손 놓고 15분 · 다른 실습으로 옮김 · 새 실습을 엶에서
// 지금 현재 목표를 그때까지로 정리한다(AI 1번, 그 뒤로 말이 늘지 않았으면 안 부름). 끄기 PC_ONGOING=0
const IDLE_MS = Number(process.env.PC_ONGOING_IDLE_MS ?? 15 * 60_000);
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const run = (runId: string) => void import("./practice.ts").then((P) => P.recordOngoing(runId)).catch(() => {});
export function ongoingLater(runId: string) {
  if (process.env.PC_ONGOING === "0") return;
  clearTimeout(timers.get(runId));
  const t = setTimeout(() => { timers.delete(runId); run(runId); }, IDLE_MS);
  t.unref?.();
  timers.set(runId, t);
}
export function ongoingNow(runId: string) {
  if (process.env.PC_ONGOING === "0") return;
  clearTimeout(timers.get(runId)); timers.delete(runId);
  run(runId);
}
